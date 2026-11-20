#!/usr/bin/env python3
"""Fixed-scope local-built deployment harness. No SSH/browser/Git/build/SQL writes.
Production adapters run only when capture/preflight/apply is explicitly invoked.
Unfilled bindings fail closed. See schema.md for the exact sealing protocol.
"""
import argparse
import base64
import copy
import datetime as dt
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import uuid
from html.parser import HTMLParser
from urllib.parse import urlencode

from pinned_reference import R, H as h, S as old_scope, PINS, LIVE_REFERENCE, verify_sources
import scope as s

HERE = Path(__file__).absolute().parent
SOURCE_NAMES = ('release.py', 'scope.py', 'pinned_reference.py', 'bindings.json',
                'reference/release.py', 'reference/safe_helpers.py', 'reference/scope.py')
MANIFEST_KEYS = {'schema', 'ownerTask', 'scope', 'ttlSeconds', 'sourceFiles',
    'referenceSourceFiles', 'controllerSha256', 'bindingsSha256', 'captureSha256',
    'fullMetaSha256', 'coordSha256', 'targets', 'newFiles', 'reloadIds', 'storePolicy',
    'sourceVerification', 'forbiddenBusinessChanges', 'packageFiles'}
REVIEW_KEYS = {'schema', 'ownerTask', 'scope', 'status', 'independent', 'releaseApproved',
    'reviewer', 'reviewedAtUtc', 'manifestSha256', 'controllerSha256', 'sourceFiles',
    'captureSha256', 'fullMetaSha256', 'coordSha256', 'bindingsSha256'}
BINDING_KEYS = {'schema', 'files', 'evidenceFiles', 'sourceVerifier', 'prewarmVerifier',
    'frontReadyInsertionBase64', 'frontListenAnchorBase64', 'htmlTextEdits',
    'controlPublicId', 'probeMaxMs', 'probeSamples', 'technicalDeadlineMs',
    'businessSourceBundleSha256', 'htmlDeltaSha256'}
SNAPSHOT_KEYS = ('processes', 'servingRoots', 'protectedFiles', 'protectedDirectories')
PUBLIC_ID = re.compile(r'OM_[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}')
BROWSER_UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')


def source_files():
    return {name: h.H(h.regular(HERE / name)) for name in SOURCE_NAMES}


def bundle():
    sources = source_files()
    return dict(sourceFiles=sources, controllerSha256=h.H(h.encode(sources)),
                referenceSourceFiles=PINS, bindingsSha256=sources['bindings.json'])


def exact(value, keys, label):
    return R.exact(value, keys, label)


def b64(data):
    return R.b64(data)


def recent(value, seconds=60):
    age = dt.datetime.now(dt.timezone.utc).timestamp() - h.timestamp(value)
    h.need(0 <= age <= seconds, 'VERIFIER_EVIDENCE_EXPIRED_OR_FUTURE')


def html_refs(data):
    """Physical asset values only; import/scope keys are logical identifiers."""
    class References(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.maps, self.body, self.active, self.urls = [], [], False, set()

        def asset(self, value):
            h.need(isinstance(value, str), 'HTML_REFERENCE_STRING_REQUIRED')
            if value.startswith('/assets/'):
                h.relative(value[1:])
                self.urls.add(value)

        def handle_starttag(self, tag, attrs):
            if tag not in ('script', 'link'):
                return
            h.need(len(attrs) == len(dict(attrs)), 'DUPLICATE_HTML_RESOURCE_ATTRIBUTE')
            attrs = dict(attrs)
            if tag == 'script' and attrs.get('type', '').lower() == 'importmap':
                h.need(not self.active and 'src' not in attrs, 'INLINE_IMPORTMAP_REQUIRED')
                self.active, self.body = True, []
            key = 'src' if tag == 'script' else 'href'
            if key in attrs:
                self.asset(attrs[key])

        def handle_data(self, value):
            if self.active:
                self.body.append(value)

        def handle_endtag(self, tag):
            if tag == 'script' and self.active:
                self.maps.append(h.decode(''.join(self.body)))
                self.active = False

    parser = References()
    try:
        parser.feed(data.decode('utf-8'))
        parser.close()
    except UnicodeError:
        raise h.ReleaseError('HTML_UTF8_REQUIRED') from None
    h.need(not parser.active and len(parser.maps) == 1, 'SINGLE_IMPORTMAP_REQUIRED')
    mapping = parser.maps[0]
    h.need(isinstance(mapping, dict) and set(mapping) <= {'imports', 'scopes'}, 'IMPORTMAP_SCHEMA')
    imports, scopes = mapping.get('imports', {}), mapping.get('scopes', {})
    h.need(isinstance(imports, dict) and isinstance(scopes, dict), 'IMPORTMAP_TABLES')
    for table in [imports, *scopes.values()]:
        h.need(isinstance(table, dict), 'IMPORTMAP_TABLE')
        for value in table.values():
            parser.asset(value)
    return sorted(parser.urls)


def asset_relative(front, value):
    """Canonical lexical path plus full ancestor symlink guard, never resolve escapes."""
    h.need(isinstance(value, str) and value.startswith(str(front) + '/assets/'), 'FRONT_ASSET_PATH')
    relative = h.relative(value[len(str(front)) + 1:])
    h.need(str(front / relative) == value, 'CANONICAL_ASSET_PATH_REQUIRED')
    h.no_symlink(front / relative)
    return relative


def byte_delta(before, after, proof, path):
    exact(proof, {'schema', 'path', 'beforeSha256', 'afterSha256', 'patches'}, 'BYTE_DELTA')
    h.need(proof['schema'] == 'inline-byte-delta-v1' and proof['path'] == str(path)
           and proof['beforeSha256'] == h.H(before) and proof['afterSha256'] == h.H(after)
           and before != after, 'BYTE_DELTA_BINDING')
    patches = proof['patches']
    h.need(isinstance(patches, list) and 1 <= len(patches) <= 96, 'BOUNDED_PATCHES')
    out, inverse, end, growth, touched, old_total = [], [], 0, 0, 0, 0
    for p in patches:
        exact(p, {'kind', 'offset', 'beforeBase64', 'afterBase64'}, 'PATCH')
        at, old, new = p['offset'], b64(p['beforeBase64']), b64(p['afterBase64'])
        h.need(type(at) is int and 0 < at and end <= at and at + len(old) < len(before)
               and (not inverse or at > inverse[-1]['originalOffset'])
               and old != new and (old or new) and max(len(old), len(new)) <= 65536
               and before[at:at + len(old)] == old, 'PATCH_INTERIOR_PREIMAGE_OR_ORDER')
        out.extend([before[end:at], new])
        inverse.append(dict(originalOffset=at, offset=at + growth, before=new, after=old))
        end = at + len(old)
        growth += len(new) - len(old)
        touched += len(old) + len(new)
        old_total += len(old)
    out.append(before[end:])
    h.need(b''.join(out) == after and touched <= 524288 and old_total < len(before) // 4,
           'FORWARD_DELTA_OR_WHOLE_REPLACEMENT')
    restored = after
    for p in reversed(inverse):
        at = p['offset']
        h.need(restored[at:at + len(p['before'])] == p['before'], 'INVERSE_SPAN')
        restored = restored[:at] + p['after'] + restored[at + len(p['before']):]
    h.need(restored == before, 'FULL_INVERSE_PREIMAGE')
    return inverse


def target_entries(doc):
    h.need(isinstance(doc, dict) and isinstance(doc.get('entries'), list), 'STORE_ENTRIES_REQUIRED')
    result = {}
    for part in s.TARGET_PARTS:
        rows = [e for e in doc['entries'] if isinstance(e, dict)
                and isinstance(e.get('identity'), dict)
                and e['identity'].get('partNumber', '').strip().upper() == part]
        h.need(len(rows) == 1, 'EXACT_CANONICAL_TARGET:' + part)
        result[part] = rows[0]
    h.need(len({e['identity']['publicId'] for e in result.values()}) == 2, 'DISTINCT_TARGET_IDS')
    return result


def prewarm_sources_digest(doc):
    # Match technicalDocumentSchema.parse(): pendingWriterTickets defaults to [].
    # The worker hashes the whole parsed sources object, not a ticket-only map.
    normalized = {key: dict(value, pendingWriterTickets=value.get('pendingWriterTickets', []))
                  for key, value in doc['sources'].items()}
    return R.js_digest(normalized)


def store_delta(before, after, path):
    a, z = h.decode(before), h.decode(after)
    for doc in (a, z):
        exact(doc, {'schemaVersion', 'generation', 'sources', 'entries'}, 'STORE_DOCUMENT')
        h.need(doc['schemaVersion'] == 1 and type(doc['generation']) is int
               and doc['generation'] >= 0 and isinstance(doc['sources'], dict)
               and isinstance(doc['entries'], list), 'STORE_DOCUMENT_SCHEMA')
    old, new = target_entries(a), target_entries(z)
    ids = {e['identity']['publicId'] for e in old.values()}
    keys = {e['sourceKey'] for e in old.values()}
    h.need(len(keys) == 2 and set(a['sources']) == set(z['sources'])
           and z['generation'] >= a['generation'] and len(a['entries']) == len(z['entries']),
           'STORE_KEYS_COUNT_GENERATION')
    h.need([e['identity'] for e in a['entries']] == [e['identity'] for e in z['entries']],
           'STORE_IDENTITIES_ORDER_UNCHANGED')
    for part in s.TARGET_PARTS:
        h.need(old[part]['identity'] == new[part]['identity']
               and old[part]['sourceKey'] == new[part]['sourceKey'], 'STORE_CANONICAL_TARGET_IDENTITY')
        response = new[part]['technicalResource']
        resource = response.get('resource') or {}
        params = resource.get('parameters', [])
        old_resource = old[part].get('technicalResource', {}).get('resource') or {}
        h.need(response.get('state') == 'ready' and isinstance(params, list)
               and len(params) >= max(1, len(old_resource.get('parameters', [])))
               and isinstance(resource.get('datasheetUrl'), str)
               and resource['datasheetUrl'].startswith('https://'), 'TARGET_READY_PARAMETERS_PDF_REQUIRED')
        h.need(not z['sources'][new[part]['sourceKey']].get('pendingWriterTickets', []),
               'TARGET_PENDING_WRITER')
    unrelated_a = [e for e in a['entries'] if e['identity']['publicId'] not in ids]
    unrelated_z = [e for e in z['entries'] if e['identity']['publicId'] not in ids]
    sources_a = {k: v for k, v in a['sources'].items() if k not in keys}
    sources_z = {k: v for k, v in z['sources'].items() if k not in keys}
    h.need(unrelated_a == unrelated_z and sources_a == sources_z,
           'STORE_UNRELATED_PARSED_JSON_CHANGED')
    return dict(schema='fast-store-structural-v1', path=str(path), beforeSha256=h.H(before),
                afterSha256=h.H(after), targetPublicIds=sorted(ids),
                unrelatedEntriesSha256=h.H(h.encode(unrelated_a)),
                unrelatedSourcesSha256=h.H(h.encode(sources_a)),
                beforeGeneration=a['generation'], afterGeneration=z['generation'])


def list_get(part):
    query = urlencode({'input': json.dumps({'json': {'partNumber': part, 'page': 1,
                                                    'pageSize': 10}}, separators=(',', ':'))})
    url = 'https://51dianzi.com/api/trpc/officialMall.list?' + query
    start = time.perf_counter()
    result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--compressed',
        '--noproxy', '*', '--proto', '=https', '--max-time', '15', '--request', 'GET',
        '--resolve', '51dianzi.com:443:127.0.0.1', '--user-agent', BROWSER_UA,
        '-H', 'Cache-Control: no-cache', url],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=18)
    elapsed = (time.perf_counter() - start) * 1000
    h.need(result.returncode == 0, 'ACTUAL_OFFICIAL_MALL_GET_FAILED')
    return result.stdout, elapsed


def response_items(data):
    value = h.decode(data)
    h.need(isinstance(value, dict) and 'result' in value and 'error' not in value,
           'TRPC_RESULT_REQUIRED_NOT_HTTP200_ONLY')
    payload = value['result'].get('data')
    if isinstance(payload, dict) and 'json' in payload:
        payload = payload['json']
    h.need(isinstance(payload, dict) and isinstance(payload.get('items'), list), 'TRPC_ITEMS_REQUIRED')
    return payload['items']


class Controller:
    def __init__(self, cfg=None, *, process_reader=None, snapshot_reader=None, get_reader=None,
                 list_reader=None, reload_adapter=None, health_reader=None, source_verifier=None,
                 prewarm_verifier=None, retired_reader=None, bindings=None):
        self.cfg = cfg or s.Config()
        injected = any(x is not None for x in (process_reader, snapshot_reader, get_reader,
            list_reader, reload_adapter, health_reader, source_verifier, prewarm_verifier,
            retired_reader, bindings))
        h.need(not injected or self.cfg.fixture_root is not None, 'DEPENDENCY_INJECTION_TMP_FIXTURES_ONLY')
        self.process_reader = process_reader or R.process_snapshot
        self.snapshot_reader = snapshot_reader
        self.get_reader = get_reader or h.http_get
        self.list_reader = list_reader or list_get
        self.reload_adapter = reload_adapter or R.verified_reload
        self.health_reader = health_reader or R.verified_listener_health
        self.source_verifier = source_verifier or self.external_source
        self.prewarm_verifier = prewarm_verifier or self.external_prewarm
        self.retired_reader = retired_reader or R.retired_process_absent
        self.legacy = R.Controller(self.cfg, process_reader=self.process_reader)
        self.sources = source_files()
        self.controller_hash = h.H(h.encode(self.sources))
        self.binding_bytes = h.regular(HERE / 'bindings.json') if bindings is None else h.encode(bindings)
        self.bindings = h.decode(self.binding_bytes)
        self.binding_hash = h.H(self.binding_bytes)
        self.owned_records, self.new_records = {}, {}
        self.rolls, self.pids, self.events = {}, {}, []
        self.store_observations, self.source_checks = [], []
        self.live_mode, self.live_record = False, None
        self.last_verified_store, self.current_doc = None, None
        self.business_verified_store = None
        self.coord_record, self.current_coord = None, None
        self.active_package = None

    private = R.Controller.private
    fresh = R.Controller.fresh
    coord_closed = R.Controller.coord_closed
    no_replay = R.Controller.no_replay
    process_guard = R.Controller.process_guard
    replace = R.Controller.replace
    coord_replace = R.Controller.coord_replace
    same_fs = R.Controller.same_fs

    def roots(self):
        return dict(front=str(self.cfg.front), admin=str(self.cfg.public),
                    stage=str(self.cfg.stage), coord=str(self.cfg.coord))

    def snapshot(self):
        h.check_lock_inodes()
        h.need(source_files() == self.sources, 'CONTROLLER_SOURCE_CHANGED')
        if self.cfg.fixture_root is None:
            verify_sources(LIVE_REFERENCE)
        snap = self.snapshot_reader(self.cfg) if self.snapshot_reader else self.legacy.snapshot()
        exact(snap, SNAPSHOT_KEYS, 'SNAPSHOT')
        R.validate_processes(self.cfg, snap['processes'])
        return snap

    def capture(self):
        with h.locked(self.cfg):
            at = h.now()
            coord = h.regular(self.cfg.coord)
            self.coord_closed(coord)
            cr, first = h.describe(self.cfg.coord), self.snapshot()
            if self.cfg.fixture_root is None:
                h.need(len(first['protectedFiles']) == s.EXPECTED_PROTECTED_FILES,
                       'EXACT_BASELINE_FILE_COUNT_REQUIRES_REVIEW')
            for host, path in [('51dianzi.com', self.cfg.html),
                               ('admin.51dianzi.com', self.cfg.public / 'index.html')]:
                h.need(h.H(self.get_reader(host, '')) == h.H(h.regular(path)), 'CAPTURE_ORIGIN_HTML')
            h.need(self.snapshot() == first and h.regular(self.cfg.coord) == coord
                   and h.describe(self.cfg.coord) == cr, 'CAPTURE_CONCURRENT_DRIFT')
            targets = {role: h.describe(path) for role, path in self.cfg.targets.items()}
            h.need(all(first['protectedFiles'].get(str(self.cfg.targets[r])) == rec
                       for r, rec in targets.items()), 'TARGETS_MUST_BE_IN_FULL_INVENTORY')
            return dict(schema='fast-capture-v1', ownerTask=s.OWNER, scope=s.SCOPE,
                capturedAtUtc=at, ttlSeconds=s.TTL, sourceFiles=self.sources,
                referenceSourceFiles=PINS, controllerSha256=self.controller_hash,
                bindingsSha256=self.binding_hash, coordSha256=h.H(coord), coordRecord=cr,
                coordBase64=base64.b64encode(coord).decode(), roots=self.roots(), targets=targets,
                protectedFileCount=len(first['protectedFiles']), fullMetaSha256=h.H(h.encode(first)),
                environmentValuesExported=False, productionWrites=0, **first)

    def validate_bindings(self):
        b = exact(self.bindings, BINDING_KEYS, 'BINDINGS')
        h.need(b['schema'] == 'fast-bindings-v1' and b['technicalDeadlineMs'] == 150,
               'FIXED_BINDINGS_SCHEMA_DEADLINE')
        h.need(isinstance(b['files'], list) and b['files'], 'BUSINESS_FILES_NOT_BOUND')
        h.need(isinstance(b['evidenceFiles'], list) and len(b['evidenceFiles']) == len(set(b['evidenceFiles']))
               and all(isinstance(n, str) and n.startswith('evidence/') and h.relative(n)
                       for n in b['evidenceFiles']), 'FIXED_EVIDENCE_WHITELIST')
        h.need({'evidence/build-proof.json', 'evidence/html-references.json',
                'evidence/store-source-verification.json'} <= set(b['evidenceFiles']), 'REQUIRED_EVIDENCE')
        for name in ('sourceVerifier', 'prewarmVerifier'):
            adapter = exact(b[name], {'file', 'sha256'}, 'PINNED_ADAPTER')
            h.need(adapter['file'] in b['evidenceFiles'] and adapter['file'].endswith('.mjs'),
                   'PINNED_MJS_ADAPTER')
            h.pin(adapter['sha256'])
        ready, anchor = b64(b['frontReadyInsertionBase64']), b64(b['frontListenAnchorBase64'])
        h.need(0 < len(ready) <= 2048 and re.search(rb'\bawait\b', ready)
               and not re.search(rb'\b(?:setTimeout|setInterval|sleep)\b', ready)
               and 0 < len(anchor) <= 1024
               and (b'server.listen(' in anchor or anchor == b'async function startServer() {\n'),
               'SMALL_EXACT_PRELISTEN_AWAIT')
        h.need(isinstance(b['htmlTextEdits'], list) and len(b['htmlTextEdits']) <= 2, 'HTML_TEXT_EDIT_LIMIT')
        for edit in b['htmlTextEdits']:
            exact(edit, {'beforeBase64', 'afterBase64'}, 'HTML_COPY')
            old, new = b64(edit['beforeBase64']), b64(edit['afterBase64'])
            h.need(old and new and old != new and max(len(old), len(new)) <= 4096, 'SMALL_EXACT_HOME_COPY')
        h.pin(b['htmlDeltaSha256'])
        h.need(b['htmlTextEdits'] == [], 'HTML_COPY_MUST_BE_IN_REVIEWED_ASSET')
        h.need(isinstance(b['controlPublicId'], str) and PUBLIC_ID.fullmatch(b['controlPublicId']),
               'CANONICAL_CONTROL_ID_NOT_BOUND')
        h.need(type(b['probeMaxMs']) is int and 1 <= b['probeMaxMs'] <= 15000
               and type(b['probeSamples']) is int and 1 <= b['probeSamples'] <= 5,
               'EXPLICIT_BUSINESS_TIMING_TARGET_REQUIRED')
        h.pin(b['businessSourceBundleSha256'])

    def package_data(self, manifest_sha, review_sha=None):
        self.validate_bindings()
        self.private(self.cfg.stage)
        self.private(self.cfg.package)
        mb = h.regular(self.cfg.package / 'manifest.json')
        h.need(h.H(mb) == h.pin(manifest_sha), 'MANIFEST_SHA_MISMATCH')
        m = exact(h.decode(mb), MANIFEST_KEYS, 'MANIFEST')
        h.need(m['schema'] == 'fast-manifest-v1' and m['ownerTask'] == s.OWNER
               and m['scope'] == s.SCOPE and m['ttlSeconds'] == s.TTL
               and m['sourceFiles'] == self.sources and m['referenceSourceFiles'] == PINS
               and m['controllerSha256'] == self.controller_hash and m['bindingsSha256'] == self.binding_hash
               and m['reloadIds'] == list(s.RELOAD_IDS) and m['storePolicy'] == s.STORE_POLICY
               and m['sourceVerification'] == s.SOURCE_SEQUENCE
               and m['forbiddenBusinessChanges'] == s.FORBIDDEN, 'MANIFEST_FIXED_SCOPE')
        names, dirs = set(), set()
        for base, children, files in os.walk(self.cfg.package, followlinks=False):
            for name in children + files:
                h.need(not (Path(base) / name).is_symlink(), 'PACKAGE_SYMLINK')
            names.update((Path(base) / n).relative_to(self.cfg.package).as_posix() for n in files)
            dirs.update((Path(base) / n).relative_to(self.cfg.package).as_posix() for n in children)
        pf = m['packageFiles']
        h.need(isinstance(pf, dict), 'PACKAGE_FILES_MAP')
        required = {'capture.json'} | set(self.bindings['evidenceFiles'])
        for role in s.TARGET_ROLES:
            required |= {f'preimages/{role}.bin', f'postimages/{role}.bin', f'deltas/{role}.json'}
        bound_files = []
        for f in self.bindings['files']:
            exact(f, {'role', 'path', 'packageFile'}, 'BOUND_NEW_FILE')
            bound_files.append(f['packageFile'])
        # Identical content-addressed workers may intentionally share one package
        # payload while being added to both existing front/admin runtime dirs.
        required |= set(bound_files)
        h.need(set(pf) == required and names in (required | {'manifest.json'},
               required | {'manifest.json', 'review.json'}), 'EXACT_FIXED_PACKAGE_FILE_WHITELIST')
        for name in required:
            h.relative(name)
        expected_dirs = {p.as_posix() for n in required for p in Path(n).parents if p.as_posix() != '.'}
        h.need(dirs == expected_dirs, 'EXTRA_PACKAGE_DIRECTORY')
        data = {n: h.regular(self.cfg.package / n) for n in required}
        for name, content in data.items():
            h.need(h.H(content) == h.pin(pf[name]), 'PACKAGE_PAYLOAD_SHA:' + name)
        for key in ('sourceVerifier', 'prewarmVerifier'):
            spec = self.bindings[key]
            h.need(h.H(data[spec['file']]) == spec['sha256'], 'FIXED_EXTERNAL_VERIFIER_PIN')
        c = h.decode(data['capture.json'])
        h.need(h.H(data['capture.json']) == h.pin(m['captureSha256'])
               and c['schema'] == 'fast-capture-v1' and c['ownerTask'] == s.OWNER
               and c['scope'] == s.SCOPE and c['ttlSeconds'] == s.TTL and c['roots'] == self.roots()
               and c['sourceFiles'] == self.sources and c['referenceSourceFiles'] == PINS
               and c['controllerSha256'] == self.controller_hash and c['bindingsSha256'] == self.binding_hash,
               'CAPTURE_FIXED_IDENTITY')
        self.fresh(c)
        R.validate_processes(self.cfg, c['processes'])
        full = {k: c[k] for k in SNAPSHOT_KEYS}
        h.need(c['fullMetaSha256'] == m['fullMetaSha256'] == h.H(h.encode(full))
               and c['protectedFileCount'] == len(c['protectedFiles']), 'FULL_META_SHA')
        if self.cfg.fixture_root is None:
            h.need(c['protectedFileCount'] == s.EXPECTED_PROTECTED_FILES, 'EXACT_FULL_BASELINE_COUNT')
        coord = b64(c['coordBase64'])
        h.need(h.H(coord) == c['coordSha256'] == m['coordSha256']
               and c['coordRecord']['sha256'] == h.H(coord), 'COORD_CAPTURE_BINDING')
        self.coord_closed(coord)
        additions = self.validate_additions(m['newFiles'], data, c)
        h.need(isinstance(m['targets'], list) and [x.get('role') for x in m['targets']] == list(s.TARGET_ROLES),
               'FOUR_FIXED_TARGETS_ORDER')
        changes = {}
        for t in m['targets']:
            exact(t, {'role', 'path', 'beforeFile', 'afterFile', 'deltaFile', 'beforeSha256', 'afterSha256'}, 'TARGET')
            role, path = t['role'], self.cfg.targets[t['role']]
            h.need(t['path'] == str(path) and t['beforeFile'] == f'preimages/{role}.bin'
                   and t['afterFile'] == f'postimages/{role}.bin' and t['deltaFile'] == f'deltas/{role}.json',
                   'FIXED_TARGET_PATH_PAYLOAD')
            before, after = data[t['beforeFile']], data[t['afterFile']]
            record = c['protectedFiles'].get(str(path))
            h.need(record == c['targets'][role] and record['kind'] == 'file' and record['nlink'] == 1
                   and record['sha256'] == t['beforeSha256'] == h.H(before)
                   and t['afterSha256'] == h.H(after) and before != after, 'TARGET_FULL_PREIMAGE')
            proof = h.decode(data[t['deltaFile']])
            if role == 'technical-store':
                h.need(proof == store_delta(before, after, path), 'STORE_STRUCTURAL_PROOF')
                R.technical_store(after, data['evidence/store-source-verification.json'], self.cfg.fixture_root is not None)
            else:
                byte_delta(before, after, proof, path)
                if role in ('front-api', 'admin-api'):
                    self.api_scope(role, before, proof, additions, c)
                else:
                    self.html_scope(before, after, proof, additions, c, data)
            changes[role] = dict(path=path, before=before, after=after, record=record)
        self.validate_build(data['evidence/build-proof.json'])
        postdoc = h.decode(changes['technical-store']['after'])
        control = [e for e in postdoc['entries'] if e['identity']['publicId'] == self.bindings['controlPublicId']]
        target_ids = {e['identity']['publicId'] for e in target_entries(postdoc).values()}
        h.need(len(control) == 1 and self.bindings['controlPublicId'] not in target_ids
               and control[0]['identity']['partNumber'].strip().upper() not in s.TARGET_PARTS,
               'DISTINCT_UNRELATED_CONTROL_ENTRY')
        if review_sha is not None:
            rb = h.regular(self.cfg.package / 'review.json')
            h.need(h.H(rb) == h.pin(review_sha), 'REVIEW_SHA_MISMATCH')
            rv = exact(h.decode(rb), REVIEW_KEYS, 'REVIEW')
            h.need(rv['schema'] == 'fast-independent-review-v1' and rv['status'] == 'passed'
                   and rv['independent'] is True and rv['releaseApproved'] is True
                   and isinstance(rv['reviewer'], str) and rv['reviewer'].strip(), 'INDEPENDENT_APPROVAL_REQUIRED')
            h.timestamp(rv['reviewedAtUtc'])
            h.need(rv['manifestSha256'] == h.H(mb) and all(rv[k] == m[k] for k in (
                'ownerTask', 'scope', 'controllerSha256', 'sourceFiles', 'captureSha256',
                'fullMetaSha256', 'coordSha256', 'bindingsSha256')), 'REVIEW_FULL_MANIFEST_BUNDLE_BINDING')
        return dict(m=m, data=data, capture=c, coord=coord, changes=changes, additions=additions,
                    manifestSha=h.H(mb), reviewSha=review_sha, newDirectories=[])

    def validate_additions(self, files, data, capture):
        h.need(isinstance(files, list) and len(files) == len(self.bindings['files']), 'FIXED_NEW_FILE_COUNT')
        h.need([{k: f.get(k) for k in ('role', 'path', 'packageFile')} for f in files]
               == self.bindings['files'], 'NEW_FILES_NOT_IN_SEALED_WHITELIST')
        additions, counts = {}, {}
        roots = self.cfg.runtime_roots
        for f in files:
            exact(f, {'role', 'path', 'packageFile', 'sha256', 'size', 'mode', 'uid', 'gid'}, 'NEW_FILE')
            role, path, name = f['role'], Path(f['path']), f['packageFile']
            digest = h.pin(f['sha256'])
            h.need(role in ('asset', 'front-runtime', 'admin-runtime', 'technical-helper', 'front-helper', 'runtime-worker')
                   and str(path) == f['path'] and str(path) not in additions
                   and not path.is_symlink(), 'CANONICAL_IMMUTABLE_LEAF_ONLY')
            h.no_symlink(path.parent)
            h.need(path.parent.is_dir(), 'EXISTING_SAME_DIRECTORY_REQUIRED')
            if role == 'asset':
                relative = asset_relative(self.cfg.front, f['path'])
                h.need(name == relative and str(path.parent) in capture['protectedDirectories']
                       and path.suffix in ('.js', '.mjs', '.css', '.wasm'), 'FRONT_ASSET_EXISTING_DIR_ONLY')
            elif role == 'runtime-worker':
                h.need(path.parent in set(roots.values()) and name == 'runtimes/' + path.name
                       and path.suffix in ('.js', '.mjs'), 'RUNTIME_WORKER_LEAF_ONLY_NO_JOB')
            else:
                h.need(path.parent == roots[role] and name == 'runtimes/' + path.name
                       and path.suffix == '.mjs', 'RUNTIME_ROLE_SAME_DIR_ONLY')
            parent = path.parent.stat()
            h.need(type(f['size']) is int and f['size'] == len(data[name]) and h.H(data[name]) == digest
                   and type(f['mode']) is int and f['mode'] == 0o644
                   and type(f['uid']) is int and type(f['gid']) is int
                   and (f['uid'], f['gid']) == (parent.st_uid, parent.st_gid)
                   and re.search(r'(?:^|[.-])' + digest + r'(?=[.-])', path.name), 'FULL_HASH_LEAF_METADATA')
            captured = capture['protectedFiles'].get(str(path))
            if captured is not None:
                # A retained leaf from a failed stage is not owned by this attempt.
                # No overwrite/chown/chmod: bind all bytes and captured metadata.
                self.exact_immutable(path, f, data[name], captured)
            else:
                h.need(not path.exists(), 'UNCAPTURED_EXISTING_IMMUTABLE_LEAF')
            additions[str(path)] = dict(spec=f, data=data[name], existingRecord=captured)
            counts[role] = counts.get(role, 0) + 1
        h.need(all(counts.get(role) == 1 for role in ('front-runtime', 'admin-runtime', 'technical-helper'))
               and counts.get('front-helper', 0) <= 1
               and counts.get('asset', 0) >= 1, 'THREE_RUNTIME_ROLES_AND_ASSETS_REQUIRED')
        return additions

    def exact_immutable(self, path, spec, data, expected):
        record = h.describe(path)
        h.need(record == expected and record['kind'] == 'file' and record['nlink'] == 1
               and record['sha256'] == spec['sha256'] and record['size'] == spec['size']
               and record['statmode'] == stat.S_IFREG | spec['mode']
               and (record['uid'], record['gid']) == (spec['uid'], spec['gid'])
               and h.regular(path) == data and h.describe(path) == record,
               'IMMUTABLE_EXACT_BYTES_AND_FULL_METADATA_REQUIRED')
        return record

    def api_scope(self, role, before, proof, additions, capture):
        expected = {'front-api': {'front-runtime': old_scope.FRONT_RUNTIME},
                    'admin-api': {'admin-runtime': old_scope.ADMIN_RUNTIME,
                                  'technical-helper': old_scope.TECH_HELPER}}[role]
        seen, await_count = set(), 0
        for patch in proof['patches']:
            old, new = b64(patch['beforeBase64']), b64(patch['afterBase64'])
            if patch['kind'] == 'prelisten-await':
                anchor = b64(self.bindings['frontListenAnchorBase64'])
                at = before.index(anchor) if before.count(anchor) == 1 else -1
                if anchor == b'async function startServer() {\n' and at >= 0:
                    at += len(anchor)
                h.need(role == 'front-api' and old == b''
                       and new == b64(self.bindings['frontReadyInsertionBase64'])
                       and before.count(anchor) == 1 and patch['offset'] == at,
                       'EXACT_FRONT_PRELISTEN_AWAIT_ONLY')
                await_count += 1
                continue
            h.need(patch['kind'] == 'runtime-pointer', 'API_POINTERS_AND_SMALL_AWAIT_ONLY')
            found = []
            for runtime_role, old_path in expected.items():
                old_path = self.cfg.path(old_path)
                leaf = next(v['spec']['path'] for v in additions.values() if v['spec']['role'] == runtime_role)
                pairs = [(str(old_path).encode(), leaf.encode()),
                         (('../runtime/' + old_path.name).encode(), ('../runtime/' + Path(leaf).name).encode())]
                if (old, new) in pairs:
                    h.need(str(old_path) in capture['protectedFiles'], 'OLD_RUNTIME_NOT_CAPTURED')
                    found.append(runtime_role)
            h.need(len(found) == 1 and found[0] not in seen, 'EXACT_RUNTIME_POINTER_ROLE')
            seen.add(found[0])
        h.need(seen == set(expected) and await_count == (1 if role == 'front-api' else 0),
               'EXACT_API_PATCH_ROLE_SET')

    def html_scope(self, before, after, proof, additions, capture, data):
        # The seal is an independent approval input, never derived from package data here.
        # It authorizes exact offsets/before/after bytes, not arbitrary JSON insertions.
        byte_delta(before, after, proof, self.cfg.html)
        raw = data['deltas/main-html.json']
        h.need(h.H(raw) == h.pin(self.bindings['htmlDeltaSha256']) and h.decode(raw) == proof,
               'HTML_DELTA_NOT_IN_SEALED_BINDING')
        h.need(self.bindings['htmlTextEdits'] == [] and all(
            p['kind'] in ('asset-pointer', 'asset-alias') for p in proof['patches']), 'HTML_SCOPE_ONLY')
        new_urls = {'/' + asset_relative(self.cfg.front, a['spec']['path'])
                    for a in additions.values() if a['spec']['role'] == 'asset'}
        expected = dict(schema='fast-html-references-v1', before=html_refs(before), after=html_refs(after))
        h.need(h.decode(data['evidence/html-references.json']) == expected, 'HTML_BYTE_REFERENCE_PROOF')
        for url in expected['after']:
            record = capture['protectedFiles'].get(str(self.cfg.front / url.lstrip('/')))
            h.need(url in new_urls or (record is not None and record['kind'] == 'file'),
                   'HTML_REFERENCE_UNKNOWN_OR_MISSING_ASSET')

    def validate_build(self, data):
        proof = exact(h.decode(data), {'schema', 'technicalDeadlineMs', 'frontAwaitBeforeListen',
            'rejectPrewarmPreventsListen', 'currentFileAcrossTickets', 'noFirstPaintWaitAdded',
            'financialAndInventoryBytesPreserved', 'scopeReviewed', 'sourceBundleSha256'}, 'BUILD_PROOF')
        h.need(proof['schema'] == 'fast-build-proof-v1' and proof['technicalDeadlineMs'] == 150
               and proof['sourceBundleSha256'] == self.bindings['businessSourceBundleSha256']
               and all(proof[k] is True for k in ('frontAwaitBeforeListen', 'rejectPrewarmPreventsListen',
                'currentFileAcrossTickets', 'noFirstPaintWaitAdded', 'financialAndInventoryBytesPreserved',
                'scopeReviewed')), 'BUILDER_PRELISTEN_150MS_CURRENTFILE_SCOPE_PROOF_REQUIRED')

    def run_verifier(self, kind, request):
        h.need(self.cfg.fixture_root is None and self.active_package is not None, 'PRODUCTION_VERIFIER_CONTEXT')
        spec = self.bindings[kind]
        script = self.cfg.package / spec['file']
        h.need(h.H(h.regular(script)) == spec['sha256'], 'PINNED_VERIFIER_CHANGED')
        # Inherits the effective current environment provided by an authorized private launcher.
        # No env replacement, .env sourcing, SQL updater, prepare/apply mode or credential output.
        result = subprocess.run([R.node(), str(script), '--verify-controller'], input=h.encode(request),
            cwd=str(self.cfg.path(old_scope.FRONT_CWD)), stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=240)
        h.need(result.returncode == 0, 'PINNED_ZERO_WRITE_VERIFIER_FAILED:' + kind)
        return h.decode(result.stdout)

    def external_source(self, cfg, digest):
        return self.run_verifier('sourceVerifier', dict(schema='fast-source-request-v1',
            storePath=str(self.cfg.targets['technical-store']), storeSha256=digest, ownerTask=s.OWNER))

    def external_prewarm(self, cfg, request):
        return self.run_verifier('prewarmVerifier', request)

    def verify_source_record(self, record):
        path = self.cfg.targets['technical-store']
        h.need(not Path(str(path) + '.lock').exists() and not Path(str(path) + '.lock').is_symlink(),
               'STORE_WRITER_LOCK_ACTIVE_OR_STALE_STOP_REBUILD')
        data = h.regular(path)
        h.need(h.describe(path) == record and h.H(data) == record['sha256'], 'STORE_CHANGED_BEFORE_SOURCE_VERIFY')
        proof = exact(self.source_verifier(self.cfg, record['sha256']), {
            'schema', 'storeSha256', 'method', 'sourceVersions', 'sourceTickets', 'identityRevisions',
            'databaseWrites', 'environmentWrites', 'synthetic', 'verifiedAtUtc'}, 'CURRENT_SOURCE_EVIDENCE')
        h.need(proof['schema'] == 'fast-source-evidence-v1', 'REAL_CURRENT_SOURCE_EVIDENCE_SCHEMA')
        recent(proof['verifiedAtUtc'])
        converted = {k: v for k, v in proof.items() if k != 'sourceTickets'}
        converted['schema'] = 'inline-store-source-verification-v1'
        doc = R.technical_store(data, h.encode(converted), self.cfg.fixture_root is not None)
        h.need(proof['sourceTickets'] == {k: v['ticket'] for k, v in doc['sources'].items()},
               'REAL_CURRENT_SOURCE_TICKET_BINDING')
        h.need(set(doc['sources']) == {entry['sourceKey'] for entry in doc['entries']},
               'ALL_SOURCE_KEYS_MUST_HAVE_VERIFIED_CURRENT_IDENTITY')
        h.need(h.regular(path) == data and h.describe(path) == record, 'STORE_CHANGED_DURING_SOURCE_VERIFY')
        target_entries(doc)
        # Live writers may change source/revision only with independent current-source proof.
        # They may not silently turn the release's intended models unavailable or drop the PDF.
        for e in target_entries(doc).values():
            resource = e['technicalResource'].get('resource') or {}
            h.need(e['technicalResource']['state'] == 'ready' and resource.get('parameters')
                   and resource.get('datasheetUrl'), 'CURRENT_SOURCE_TARGET_NO_LONGER_READY_WITH_PDF')
        self.last_verified_store, self.current_doc = record, doc
        event = dict(storeSha256=record['sha256'], proofSha256=h.H(h.encode(proof)),
                     verifiedAtUtc=proof['verifiedAtUtc'])
        if self.active_package is not None:
            name = 'source-check-' + str(len(self.source_checks) + 1).zfill(3) + '.json'
            h.exclusive(self.cfg.receipt / name, h.encode(proof))
            event['proofFile'] = name
        self.source_checks.append(event)
        return event

    def guard(self, package, owned_coord=None):
        # TTL authorizes admission only. In-flight authentication/rollback retains
        # every state CAS below; elapsed wall time must not suppress these checks.
        snap = self.snapshot()
        self.process_guard(package['capture']['processes'], snap['processes'])
        expected = dict(package['capture']['protectedFiles'])
        expected.update(self.owned_records)
        expected.update(self.new_records)
        store = str(self.cfg.targets['technical-store'])
        if self.live_mode:
            baseline = self.live_record or self.owned_records.get(store)
            current = snap['protectedFiles'].get(store)
            h.need(baseline is not None and current is not None and current['kind'] == 'file'
                   and current['nlink'] == 1 and all(current[k] == baseline[k]
                       for k in ('statmode', 'uid', 'gid', 'dev')), 'LIVE_STORE_PERMISSIONS_OR_LINK_DRIFT')
            if current != baseline:
                # No whole-file ignore: authenticate every new observed store version now,
                # before any subsequent mutation/reload. Failure retains the recovery hold.
                self.verify_source_record(current)
                self.live_record = current
                self.store_observations.append(copy.deepcopy(current))
            expected[store] = self.live_record or baseline
        h.need(snap['protectedFiles'] == expected, 'FULL_INVENTORY_FULL_METADATA_DRIFT')
        h.need(snap['servingRoots'] == package['capture']['servingRoots']
               and snap['protectedDirectories'] == package['capture']['protectedDirectories'], 'ALIAS_ROOT_CONFIG_DIRECTORY_DRIFT')
        coord = package['coord'] if owned_coord is None else owned_coord
        h.need(h.regular(self.cfg.coord) == coord and h.describe(self.cfg.coord) == self.coord_record,
               'COORD_FULL_BYTES_METADATA_OWNERSHIP_LOST')
        h.need(source_files() == self.sources and (self.cfg.fixture_root is not None
               or h.regular(HERE / 'bindings.json') == self.binding_bytes), 'SELF_BUNDLE_DRIFT')
        names, dirs = set(), set()
        for base, children, files in os.walk(self.cfg.package, followlinks=False):
            for name in children + files:
                h.need(not (Path(base) / name).is_symlink(), 'PACKAGE_SYMLINK_DURING_ATTEMPT')
            names.update((Path(base) / n).relative_to(self.cfg.package).as_posix() for n in files)
            dirs.update((Path(base) / n).relative_to(self.cfg.package).as_posix() for n in children)
        required = set(package['m']['packageFiles'])
        expected_dirs = {p.as_posix() for n in required for p in Path(n).parents if p.as_posix() != '.'}
        h.need(names in (required | {'manifest.json'}, required | {'manifest.json', 'review.json'})
               and dirs == expected_dirs, 'PACKAGE_WHITELIST_DRIFT_DURING_ATTEMPT')
        for name, digest in package['m']['packageFiles'].items():
            h.need(h.H(h.regular(self.cfg.package / name)) == digest, 'PACKAGE_DRIFT_DURING_ATTEMPT')
        h.need(h.H(h.regular(self.cfg.package / 'manifest.json')) == package['manifestSha'], 'MANIFEST_DRIFT')
        if package['reviewSha'] is not None:
            h.need(h.H(h.regular(self.cfg.package / 'review.json')) == package['reviewSha'], 'REVIEW_DRIFT')
        return snap

    def verify_current_store(self, package, owned):
        self.guard(package, owned)
        record = h.describe(self.cfg.targets['technical-store'])
        result = self.verify_source_record(record)
        self.guard(package, owned)
        return result

    def business_preflight(self, package):
        # Baseline reachability/identity only, not candidate business acceptance:
        # old runtime may be missing/unavailable. Final ready/PDF/timing is strict.
        self.guard(package)
        change = package['changes']['technical-store']
        h.need(h.regular(change['path']) == change['before']
               and h.describe(change['path']) == change['record'], 'PREFLIGHT_STORE_CAS')
        doc = h.decode(change['before'])
        entries = list(target_entries(doc).values()) + [e for e in doc['entries']
            if e['identity']['publicId'] == self.bindings['controlPublicId']]
        h.need(len(entries) == 3, 'PREFLIGHT_TWO_TARGETS_AND_ONE_CONTROL')
        events = []
        for entry in entries:
            identity = entry['identity']
            raw, elapsed = self.list_reader(identity['partNumber'])
            rows = response_items(raw)
            h.need(len(rows) == 1 and rows[0].get('publicId') == identity['publicId']
                   and rows[0].get('partNumber') == identity['partNumber'],
                   'PREFLIGHT_ACTUAL_TRPC_CANONICAL_IDENTITY_MISMATCH')
            technical = rows[0].get('technicalResource')
            unavailable = {'state': 'unavailable', 'parameterVersion': None, 'resource': None}
            h.need(technical == entry['technicalResource'] or technical == unavailable,
                   'PREFLIGHT_BASELINE_TECHNICAL_OR_EXACT_KNOWN_UNAVAILABLE_REQUIRED')
            h.need(h.regular(change['path']) == change['before']
                   and h.describe(change['path']) == change['record'], 'PREFLIGHT_STORE_CHANGED_DURING_GET')
            self.guard(package)
            events.append(dict(publicId=identity['publicId'], elapsedMs=elapsed,
                               responseSha256=h.H(raw), baselineOnly=True,
                               baselineKnownTechnicalUnavailable=technical == unavailable))
        return events

    def preflight(self, package, manifest_sha):
        h.need(Path(package).absolute() == self.cfg.package, 'FIXED_PACKAGE_PATH')
        with h.locked(self.cfg):
            b = self.package_data(manifest_sha)
            self.no_replay()
            self.coord_record = b['capture']['coordRecord']
            self.guard(b)
            self.same_fs(b)
            self.guard(b)
            business = self.business_preflight(b)
            self.fresh(b['capture'])
            return dict(status='preflight-passed', productionWrites=0, reviewRequiredForApply=True,
                        manifestSha256=b['manifestSha'], controllerSha256=self.controller_hash,
                        reloadIds=list(s.RELOAD_IDS), protectedFileCount=b['capture']['protectedFileCount'],
                        businessPreflightEvents=business)

    def reload_one(self, package, id_, owned, *, rollback=False):
        h.need(type(id_) is int and id_ in s.RELOAD_IDS, 'ALLOWED_SIX_IDS_ONLY')
        before = next(r for r in self.guard(package, owned)['processes'] if r['id'] == id_)
        role = 'front-api' if id_ in s.FRONT_IDS else 'admin-api'
        image = package['changes'][role]['before' if rollback else 'after']
        digest = h.H(image)
        prewarm_record = h.describe(self.cfg.targets['technical-store'])
        failure = None
        try:
            # The reviewed adapter pins PM2 Reload.js/Daemon.js and this exact API SHA.
            # It uses the existing RPC only, no PM2 CLI/connect/start/update-env.
            self.reload_adapter(self.cfg, id_, digest)
        except BaseException as exc:
            failure = exc
        current = self.process_reader(self.cfg)
        R.validate_processes(self.cfg, current)
        after = next(r for r in current if r['id'] == id_)
        changed = after['pid'] != before['pid']
        self.events.append(dict(id=id_, beforePid=before['pid'], afterPid=after['pid'],
            beforeRestart=before['restarts'], afterRestart=after['restarts'], apiSha256=digest,
            beforeRawSha256=before['rawProcEnvironSha256'], afterRawSha256=after['rawProcEnvironSha256'],
            rawStableSha256=after['rawStableSha256'], transportPassed=failure is None,
            observedPidChange=changed, rollback=rollback))
        if changed:
            self.rolls[id_] = self.rolls.get(id_, 0) + 1
            self.pids[id_] = after['pid']
        self.process_guard(package['capture']['processes'], current)
        self.guard(package, owned)
        h.need(changed, 'RELOAD_NO_OBSERVED_PID_CHANGE')
        if failure is not None:
            raise failure
        h.need(self.retired_reader(self.cfg, before['pid']) is True, 'RETIRED_PID_NOT_CONFIRMED_GONE')
        if id_ in s.FRONT_IDS and not rollback:
            h.need(h.describe(self.cfg.targets['technical-store']) == prewarm_record,
                   'SOURCE_CHANGED_DURING_NEW_WORKER_PREWARM_STOP_REBUILD')
            request = dict(schema='fast-prewarm-request-v1', id=id_, pid=after['pid'],
                apiSha256=digest, storeSha256=prewarm_record['sha256'],
                sourceTicketsDigest=prewarm_sources_digest(self.current_doc),
                entries=len(self.current_doc['entries']), ownerTask=s.OWNER)
            proof = exact(self.prewarm_verifier(self.cfg, request), set(request) | {
                'prewarmComplete', 'readyBeforeListen', 'technicalDeadlineMs', 'verifiedAtUtc'}, 'PREWARM_EVIDENCE')
            h.need(proof['schema'] == 'fast-prewarm-evidence-v1'
                   and all(proof[k] == v for k, v in request.items() if k != 'schema')
                   and proof['prewarmComplete'] is True and proof['readyBeforeListen'] is True
                   and proof['technicalDeadlineMs'] == 150, 'NEW_PID_PREWARM_MUST_COMPLETE_BEFORE_LISTEN')
            recent(proof['verifiedAtUtc'])
            self.events[-1]['prewarmProofSha256'] = h.H(h.encode(proof))
            self.guard(package, owned)

    def business_probe(self, package, owned):
        self.verify_current_store(package, owned)
        doc = self.current_doc
        entries = list(target_entries(doc).values()) + [e for e in doc['entries']
            if e['identity']['publicId'] == self.bindings['controlPublicId']]
        h.need(len(entries) == 3, 'TWO_TARGETS_AND_ONE_CONTROL')
        store_record = self.last_verified_store
        events = []
        for e in entries:
            identity = e['identity']
            for _ in range(self.bindings['probeSamples']):
                raw, elapsed = self.list_reader(identity['partNumber'])
                rows = response_items(raw)
                h.need(len(rows) == 1 and rows[0].get('publicId') == identity['publicId']
                       and rows[0].get('partNumber') == identity['partNumber']
                       and rows[0].get('technicalResource') == e['technicalResource'],
                       'ACTUAL_TRPC_CURRENT_FILE_READY_COUNT_PDF_VERSION_MISMATCH')
                h.need(isinstance(elapsed, (int, float)) and 0 <= elapsed <= self.bindings['probeMaxMs'],
                       'ACTUAL_TRPC_TIME_TARGET_EXCEEDED')
                resource = e['technicalResource'].get('resource') or {}
                events.append(dict(publicId=identity['publicId'], elapsedMs=elapsed,
                    state=e['technicalResource']['state'], readyCount=len(resource.get('parameters', [])),
                    datasheetUrl=resource.get('datasheetUrl'), parameterVersion=e['technicalResource']['parameterVersion']))
                h.need(h.describe(self.cfg.targets['technical-store']) == store_record,
                       'SOURCE_CHANGED_DURING_BUSINESS_PROBE_REVERIFY_REQUIRED')
                self.guard(package, owned)
        self.business_verified_store = store_record
        return events

    def verify_static(self, package, *, switched):
        for a in package['additions'].values():
            spec = a['spec']
            if spec['role'] == 'asset':
                relative = asset_relative(self.cfg.front, spec['path'])
                h.need(h.H(self.get_reader('51dianzi.com', relative)) == spec['sha256'],
                       'ORIGIN_NEW_HASHED_ASSET_BODY_NOT_EXACT')
        html = package['changes']['main-html']['after' if switched else 'before']
        h.need(h.H(self.get_reader('51dianzi.com', '')) == h.H(html), 'ORIGIN_HTML_BODY_NOT_EXACT')
        admin = package['capture']['protectedFiles'][str(self.cfg.public / 'index.html')]
        h.need(h.H(self.get_reader('admin.51dianzi.com', '')) == admin['sha256'], 'ADMIN_HTML_CHANGED')

    def rollback_owned(self, package, owned):
        self.guard(package, owned)
        candidates = [role for role in s.TARGET_ROLES if str(package['changes'][role]['path']) in self.owned_records]
        # Validate ALL forwardimages before restoring ANY. A verified normal writer is not owned.
        for role in candidates:
            change = package['changes'][role]
            path = change['path']
            h.need(h.regular(path) == change['after'] and h.describe(path) == self.owned_records[str(path)],
                   'ROLLBACK_REFUSES_FOREIGN_OR_LIVE_WRITER_IMAGE')
        self.live_mode, self.live_record = False, None
        for role in reversed(candidates):
            change = package['changes'][role]
            self.guard(package, owned)
            self.replace(change['path'], change['after'], change['before'])
            self.guard(package, owned)
        rolled = set(self.rolls)
        for id_ in s.RELOAD_IDS:
            if id_ in rolled:
                self.reload_one(package, id_, owned, rollback=True)
        sha = {role: h.H(package['changes'][role]['before']) for role in ('admin-api', 'front-api')}
        h.need(self.health_reader(self.cfg, sha) is True, 'ROLLBACK_LISTENER_HEALTH_UNVERIFIED')
        h.need(h.H(self.get_reader('51dianzi.com', '')) == h.H(package['changes']['main-html']['before']),
               'ROLLBACK_ORIGIN_HTML_UNVERIFIED')
        self.guard(package, owned)
        return dict(status='owned-bytes-process-listener-rollback-verified', restoredRoles=candidates,
                    businessAcceptanceVerified=False, coordinationMayNotClose=True, immutableLeavesRetained=True)

    def mark_recovery(self, error, rollback):
        # Never modify or force-close coordination if its exact owned CAS was lost.
        try:
            h.need(h.regular(self.cfg.coord) == self.current_coord
                   and h.describe(self.cfg.coord) == self.coord_record, 'COORD_NOT_OWNED')
            doc = h.decode(self.current_coord)
            h.need(doc['window']['owner_task'] == s.OWNER and doc['shared_release_active'] is True, 'NOT_OWN_OPEN_WINDOW')
            doc['window'].update(status='recovery-required', needsOperatorRecovery=True,
                                 failure=error, rollback=rollback, failedAtUtc=h.now())
            doc['needsOperatorRecovery'] = True
            doc['updated_at'] = h.now()
            self.coord_replace(self.current_coord, h.encode(doc))
            return True
        except BaseException:
            return False

    def apply(self, package, manifest_sha, review_sha):
        h.need(Path(package).absolute() == self.cfg.package, 'FIXED_PACKAGE_PATH')
        h.pin(review_sha)
        with h.locked(self.cfg):
            b = self.package_data(manifest_sha, review_sha)
            self.no_replay()
            self.active_package = b
            self.coord_record, self.current_coord = b['capture']['coordRecord'], b['coord']
            self.guard(b)
            self.same_fs(b)
            preflight_events = self.business_preflight(b)
            state = self.coord_closed(b['coord'])
            window = dict(owner_task=s.OWNER, scope=s.SCOPE, nonce=uuid.uuid4().hex,
                status='open', needsOperatorRecovery=True, openedAtUtc=h.now(),
                manifestSha256=b['manifestSha'], reviewSha256=review_sha,
                controllerSha256=self.controller_hash, captureSha256=b['m']['captureSha256'],
                reloadScope=list(s.RELOAD_IDS), previousWindow=copy.deepcopy(state['window']))
            opened = copy.deepcopy(state)
            opened.update(shared_release_active=True, window=window, updated_at=h.now())
            owned = h.encode(opened)
            self.guard(b)
            self.fresh(b['capture'])  # last admission check, before permanent attempt
            if not self.cfg.receipt.exists():
                self.cfg.receipt.mkdir(mode=0o700)
                h.fsync_dir(self.cfg.stage)
            h.exclusive(self.cfg.receipt / 'attempt.json', h.encode(dict(window, permanentNoReplay=True)))
            try:
                self.guard(b)
                self.coord_replace(b['coord'], owned)
                self.guard(b, owned)
                for path, addition in b['additions'].items():
                    self.guard(b, owned)
                    p, spec = Path(path), addition['spec']
                    if addition['existingRecord'] is not None:
                        self.exact_immutable(p, spec, addition['data'], addition['existingRecord'])
                        self.guard(b, owned)
                        continue  # captured immutable: never claim ownership or touch metadata
                    h.exclusive(p, addition['data'], spec['mode'])
                    # Creation must be ours before any further metadata operations can fail.
                    self.new_records[path] = h.describe(p)
                    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
                    try:
                        os.fchown(fd, spec['uid'], spec['gid'])
                        os.fchmod(fd, spec['mode'])
                        os.fsync(fd)
                    finally:
                        os.close(fd)
                    self.new_records[path] = h.describe(p)
                    h.need(self.new_records[path]['sha256'] == spec['sha256']
                           and self.new_records[path]['nlink'] == 1, 'NEW_LEAF_POSTIMAGE_DRIFT')
                    self.guard(b, owned)
                self.verify_static(b, switched=False)  # every new static GET before HTML can point to it
                for role in ('admin-api', 'front-api', 'technical-store'):
                    self.guard(b, owned)
                    change = b['changes'][role]
                    self.owned_records[str(change['path'])] = change['record']
                    self.replace(change['path'], change['before'], change['after'])
                    self.guard(b, owned)
                self.verify_current_store(b, owned)  # strict initial store CAS; no live exception yet
                self.live_mode = True
                for id_ in s.ADMIN_IDS:
                    self.reload_one(b, id_, owned)
                self.verify_current_store(b, owned)
                for id_ in s.FRONT_IDS:
                    self.reload_one(b, id_, owned)
                probe_events = self.business_probe(b, owned)
                change = b['changes']['main-html']
                self.guard(b, owned)
                self.owned_records[str(change['path'])] = change['record']
                self.replace(change['path'], change['before'], change['after'])
                self.guard(b, owned)
                self.verify_static(b, switched=True)
                sha = {role: h.H(b['changes'][role]['after']) for role in ('admin-api', 'front-api')}
                h.need(self.health_reader(self.cfg, sha) is True, 'ACTUAL_LISTENER_HTML_HEALTH_UNVERIFIED')
                self.verify_current_store(b, owned)
                final = self.guard(b, owned)
                h.need(h.describe(self.cfg.targets['technical-store']) == self.last_verified_store
                       == self.business_verified_store,
                       'STORE_CHANGED_SINCE_BUSINESS_PROBE_OR_FINAL_SOURCE_VERIFY')
                closed = dict(window, status='closed', outcome='verified', needsOperatorRecovery=False,
                              closedAtUtc=h.now(), processReloadEvents=copy.deepcopy(self.events))
                complete = copy.deepcopy(opened)
                complete.update(window=closed, shared_release_active=False, updated_at=h.now())
                complete.setdefault('window_history', []).append(copy.deepcopy(closed))
                closed_bytes = h.encode(complete)
                receipt = dict(status='prepared-not-valid-until-closed-coord-confirmed', ownerTask=s.OWNER,
                    scope=s.SCOPE, nonce=window['nonce'], manifestSha256=b['manifestSha'], reviewSha256=review_sha,
                    controllerSha256=self.controller_hash, closedCoordSha256=h.H(closed_bytes),
                    processReloadEvents=self.events, sourceVerificationEvents=self.source_checks,
                    mutableStoreObservedRecords=self.store_observations, businessProbeEvents=probe_events,
                    businessPreflightEvents=preflight_events,
                    processesAfter=final['processes'], otherSixProcessesRawExact=True,
                    ownStableEnvironmentConfigPermissionsExact=True, databaseWrites=0, environmentWrites=0,
                    adminHtmlWrites=0, automaticRollbackPerformed=False, immutableLeavesRetained=True)
                h.exclusive(self.cfg.receipt / 'receipt.json', h.encode(receipt))
                # Persist the TERMINAL receipt, including its closed-coord digest,
                # before making a closed window externally visible. It is valid
                # only with that exact closed coord and no overriding failure.
                result = dict(receipt, status='verified', verificationRequiresClosedCoordSha256=True)
                terminal_bytes = h.encode(result)
                terminal_path = self.cfg.receipt / 'confirmed.json'
                h.exclusive(terminal_path, terminal_bytes)
                terminal_record = h.describe(terminal_path)
                self.guard(b, owned)
                h.need(h.describe(self.cfg.targets['technical-store']) == self.last_verified_store
                       == self.business_verified_store, 'STORE_CHANGED_AFTER_BUSINESS_PROBE_BEFORE_CLOSE')
                h.need(h.regular(terminal_path) == terminal_bytes and h.describe(terminal_path) == terminal_record
                       and not (self.cfg.receipt / 'failure.json').exists()
                       and not (self.cfg.receipt / 'failure.json').is_symlink(), 'TERMINAL_RECEIPT_CAS_BEFORE_CLOSE')
                self.coord_replace(owned, closed_bytes)
                h.need(h.regular(self.cfg.coord) == closed_bytes and h.describe(self.cfg.coord) == self.coord_record,
                       'CLOSED_COORD_CONFIRMATION_FAILED')
                self.guard(b, closed_bytes)
                h.need(h.regular(terminal_path) == terminal_bytes and h.describe(terminal_path) == terminal_record,
                       'TERMINAL_RECEIPT_CHANGED_AT_CLOSE')
                return result
            except BaseException as exc:
                error = type(exc).__name__ + (': ' + str(exc) if isinstance(exc, h.ReleaseError) else '')
                rollback = dict(status='not-attempted')
                # If close succeeded but a subsequent durable operation failed, CAS-reopen OUR close only.
                try:
                    current = h.decode(self.current_coord)
                    if current.get('shared_release_active') is False and current.get('window', {}).get('nonce') == window['nonce']:
                        self.coord_replace(self.current_coord, owned)
                except BaseException:
                    pass
                try:
                    rollback = self.rollback_owned(b, self.current_coord)
                except BaseException as rollback_error:
                    rollback = dict(status='unverified-recovery-required',
                        error=type(rollback_error).__name__ + (': ' + str(rollback_error)
                              if isinstance(rollback_error, h.ReleaseError) else ''))
                owned_hold = self.mark_recovery(error, rollback)
                failure = dict(status='recovery-required-no-replay', error=error, rollback=rollback,
                    ownerTask=s.OWNER, scope=s.SCOPE, nonce=window['nonce'], needsOperatorRecovery=True,
                    ownedRecoveryFlagConfirmed=owned_hold, permanentNoReplay=True, immutableLeavesRetained=True,
                    processReloadEvents=self.events, databaseWrites=0, environmentWrites=0, adminHtmlWrites=0,
                    failedAtUtc=h.now())
                try:
                    h.exclusive(self.cfg.receipt / 'failure.json', h.encode(failure))
                except BaseException:
                    pass
                raise h.ReleaseError('RECOVERY_REQUIRED_NO_REPLAY: ' + error) from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    for command in ('bundle', 'capture', 'preflight', 'apply'):
        group.add_argument('--' + command, action='store_true')
    parser.add_argument('--controller-sha256')
    parser.add_argument('--package')
    parser.add_argument('--manifest-sha256')
    parser.add_argument('--review-sha256')
    args = parser.parse_args()
    if args.bundle:
        h.need(not any((args.controller_sha256, args.package, args.manifest_sha256, args.review_sha256)),
               'BUNDLE_LOCAL_ONLY_NO_OPERATION_ARGS')
        result = bundle()
    else:
        ctl = Controller()
        h.need(args.controller_sha256 == ctl.controller_hash, 'EXPLICIT_CONTROLLER_BUNDLE_PIN_REQUIRED')
        if args.capture:
            h.need(not any((args.package, args.manifest_sha256, args.review_sha256)), 'CAPTURE_NO_APPROVAL_ARGS')
            ctl.validate_bindings()
            result = ctl.capture()
        else:
            h.need(args.package and args.manifest_sha256, 'PACKAGE_MANIFEST_PINS_REQUIRED')
            if args.apply:
                h.need(args.review_sha256, 'INDEPENDENT_REVIEW_PIN_REQUIRED')
                result = ctl.apply(args.package, args.manifest_sha256, args.review_sha256)
            else:
                h.need(not args.review_sha256, 'PREFLIGHT_IS_NOT_APPROVAL')
                result = ctl.preflight(args.package, args.manifest_sha256)
    sys.stdout.buffer.write(h.encode(result))


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        print('FAST_RELEASE_ABORT: ' + (str(exc) if isinstance(exc, h.ReleaseError) else type(exc).__name__), file=sys.stderr)
        sys.exit(1)
