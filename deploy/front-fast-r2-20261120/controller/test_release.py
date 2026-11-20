"""Pure local unit/integration tests: anonymous /tmp fixtures, no network/PM2/SQL/Git."""
import base64
import copy
from pathlib import Path
import tempfile
import unittest
import uuid

import release as c
from release import h, R, s


def B(data):
    return base64.b64encode(data).decode()


def write(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    path.chmod(mode)


def make_response(identity, version, count, pdf):
    resource = dict(**identity, category='MCU', description='source verified technical fields',
                    parameters=[{'name': 'Feature' + str(i), 'value': str(i)} for i in range(count)],
                    datasheetUrl=pdf)
    digest = R.js_digest(dict(identity=identity, sourceVersion=version,
                            projectionVersion='official-safe-technical-v1', resource=resource))
    return dict(state='ready' if count else 'missing', parameterVersion='tp1_' + digest, resource=resource)


def document():
    doc = dict(schemaVersion=1, generation=100, sources={}, entries=[])
    for index, (part, count) in enumerate([('STM8S003F3P6TR', 12), ('W25N04KVZEIR', 0), ('CONTROL123', 2)]):
        identity = dict(publicId='OM_' + str(uuid.UUID(int=index + 1)), revision=1,
                        partNumber=part, brand='ST' if index == 0 else 'Winbond', pkg='SMD')
        key, version = R.js_digest(part), h.H(('source-' + part).encode())
        doc['sources'][key] = dict(ticket=str(uuid.UUID(int=index + 100)), version=version)
        doc['entries'].append(dict(identity=identity, sourceKey=key, sourceVersion=version,
            projectionVersion='official-safe-technical-v1', preparedAt=h.now(),
            technicalResource=make_response(identity, version, count,
                                             'https://example.org/control.pdf' if index == 2 else None)))
    return doc


def source_proof(doc, data, fast=False):
    result = dict(schema='fast-source-evidence-v1' if fast else 'inline-store-source-verification-v1',
        storeSha256=h.H(data), method='readonly-current-source-version-and-restart',
        sourceVersions={k: v['version'] for k, v in doc['sources'].items()},
        identityRevisions={e['identity']['publicId']: e['identity']['revision'] for e in doc['entries']},
        databaseWrites=0, environmentWrites=0, synthetic=True, verifiedAtUtc=h.now())
    if fast:
        result['sourceTickets'] = {k: v['ticket'] for k, v in doc['sources'].items()}
    return result


def delta(before, replacements, path):
    patches = []
    for kind, old, new in replacements:
        at = before.index(old) if old else before.index(b'  server.listen(')
        patches.append(dict(kind=kind, offset=at, beforeBase64=B(old), afterBase64=B(new)))
    patches.sort(key=lambda p: p['offset'])
    pieces, end = [], 0
    for p in patches:
        at, old, new = p['offset'], c.b64(p['beforeBase64']), c.b64(p['afterBase64'])
        pieces.extend([before[end:at], new])
        end = at + len(old)
    pieces.append(before[end:])
    after = b''.join(pieces)
    return after, dict(schema='inline-byte-delta-v1', path=str(path), beforeSha256=h.H(before),
                       afterSha256=h.H(after), patches=patches)


class Fixture:
    def __init__(self, *, nested_asset=False):
        self.tmp = tempfile.TemporaryDirectory(prefix='fast-controller-', dir='/tmp')
        self.root = Path(self.tmp.name)
        self.root.chmod(0o700)
        self.cfg = s.Config(self.root)
        self.cfg.stage.mkdir(parents=True, mode=0o700)
        self.cfg.package.mkdir(mode=0o700)
        self.files = {}
        self.roots = {self.cfg.front, self.cfg.public, self.cfg.api.parent,
                      self.cfg.admin_api.parent, *self.cfg.runtime_roots.values(), self.cfg.nginx}
        for p in self.roots:
            p.mkdir(parents=True, exist_ok=True)
        for p in self.cfg.locks:
            write(p, b'lock')
        self.coord_original = h.encode(dict(shared_release_active=False,
            window={'status': 'closed', 'needsOperatorRecovery': False, 'closedAtUtc': h.now(), 'foreign': 'keep'},
            window_history=[{'owner_task': 'other', 'result': 'keep'}], foreignFlag={'deep': [1, 2, 3]}))
        write(self.cfg.coord, self.coord_original)
        self.old_asset = self.cfg.front / 'assets' / ('old-search-' + h.H(b'old') + '.js')
        write(self.old_asset, b'old', 0o644)
        html = b'<html><head><script type="module" src="/assets/' + self.old_asset.name.encode() + b'"></script>'
        html += b'<script type="importmap">{"imports":{},"scopes":{}}</script>'
        html += b'<!--' + b' untouched ' * 200 + b'--></head><body>home</body></html>\n'
        write(self.cfg.html, html, 0o644)
        write(self.cfg.public / 'index.html', b'<html>admin protected</html>\n', 0o644)
        for role, value in [('front', c.old_scope.FRONT_RUNTIME), ('admin', c.old_scope.ADMIN_RUNTIME),
                            ('helper', c.old_scope.TECH_HELPER)]:
            p = self.cfg.path(value)
            write(p, ('// old ' + role + '\n').encode(), 0o644)
        self.front_old_pointer = ('../runtime/' + Path(c.old_scope.FRONT_RUNTIME).name).encode()
        self.admin_old_pointer = ('../runtime/' + Path(c.old_scope.ADMIN_RUNTIME).name).encode()
        self.helper_old_pointer = ('../runtime/' + Path(c.old_scope.TECH_HELPER).name).encode()
        front = b'import x from "' + self.front_old_pointer + b'";\n'
        front += b'// ' + b'x' * 4096 + b'\nasync function startServer() {\n  server.listen(port);\n}\nstartServer();\n'
        admin = b'import x from "' + self.admin_old_pointer + b'";\nimport y from "' + self.helper_old_pointer + b'";\n'
        admin += b'// ' + b'x' * 4096 + b'\nconsole.log("admin");\n'
        write(self.cfg.api, front, 0o644)
        write(self.cfg.admin_api, admin, 0o644)
        write(self.cfg.nginx / 'nginx.conf', b'protected config', 0o644)
        self.doc = document()
        self.store = self.cfg.targets['technical-store']
        write(self.store, h.encode(self.doc))
        self.roots.add(self.store.parent)
        self.rows = []
        for id_ in s.ALL_IDS:
            front, admin = id_ in s.FRONT_IDS, id_ in s.ADMIN_IDS
            script = self.cfg.api if front else self.cfg.admin_api if admin else self.cfg.path(f'/opt/other/{id_}/index.js')
            cwd = self.cfg.path(c.old_scope.FRONT_CWD if front else c.old_scope.ADMIN_CWD) if front or admin else script.parent
            if not front and not admin:
                write(script, ('protected other ' + str(id_)).encode(), 0o644)
                self.roots.add(script.parent)
            row = dict(id=id_, name='dianzi51' if front else 'dianzi51-admin' if admin else 'worker-' + str(id_),
                pid=1000 + id_, status='online', script=str(script), cwd=str(cwd),
                execMode='cluster_mode' if front or admin else 'fork_mode', restarts=1)
            row.update({key: h.H((key + str(id_)).encode()) for key in R.PROCESS_HASH_FIELDS})
            self.rows.append(row)
        self.bindings = dict(schema='fast-bindings-v1', files=[], evidenceFiles=[
            'evidence/build-proof.json', 'evidence/html-references.json', 'evidence/store-source-verification.json',
            'evidence/source-verifier.mjs', 'evidence/prewarm-verifier.mjs'],
            sourceVerifier={'file': 'evidence/source-verifier.mjs', 'sha256': h.H(b'// source verifier fixture\n')},
            prewarmVerifier={'file': 'evidence/prewarm-verifier.mjs', 'sha256': h.H(b'// prewarm verifier fixture\n')},
            frontReadyInsertionBase64=B(b'  await native.ready;\n'), frontListenAnchorBase64=B(b'  server.listen('),
            htmlTextEdits=[], controlPublicId=self.doc['entries'][2]['identity']['publicId'],
            probeMaxMs=200, probeSamples=2, technicalDeadlineMs=150, businessSourceBundleSha256=h.H(b'business source'))
        self.leaf_data = {}
        for role, root, payload in [('front-runtime', self.cfg.runtime_roots['front-runtime'], b'// new front'),
            ('admin-runtime', self.cfg.runtime_roots['admin-runtime'], b'// new admin'),
            ('technical-helper', self.cfg.runtime_roots['technical-helper'], b'// new helper'),
            ('front-helper', self.cfg.runtime_roots['front-helper'], b'// new front helper'),
            ('runtime-worker', self.cfg.runtime_roots['front-runtime'], b'// shared worker'),
            ('runtime-worker', self.cfg.runtime_roots['admin-runtime'], b'// shared worker'),
            ('asset', self.cfg.front / 'assets', b'// new search')]:
            name = ('search-' if role == 'asset' else role + '.') + h.H(payload) + ('.js' if role == 'asset' else '.runtime.mjs')
            package = ('assets/' if role == 'asset' else 'runtimes/') + name
            self.bindings['files'].append(dict(role=role, path=str(root / name), packageFile=package))
            self.leaf_data[package] = payload
        if nested_asset:
            asset = self.bindings['files'][-1]
            parent = self.cfg.front / 'assets' / 'existing' / 'shared'
            parent.mkdir(parents=True)
            old_package = asset['packageFile']
            asset['path'] = str(parent / Path(asset['path']).name)
            asset['packageFile'] = (parent / Path(asset['path']).name).relative_to(self.cfg.front).as_posix()
            self.leaf_data[asset['packageFile']] = self.leaf_data.pop(old_package)
        # Test builder approves this exact proof before constructing the bundle/capture.
        # save() deliberately NEVER repins it after mutations.
        asset = next(f for f in self.bindings['files'] if f['role'] == 'asset')
        _, html_proof = delta(html, [('asset-pointer', ('/assets/' + self.old_asset.name).encode(),
                                     ('/' + asset['packageFile']).encode())], self.cfg.html)
        self.bindings['htmlDeltaSha256'] = h.H(h.encode(html_proof))
        self.reload_log, self.source_calls, self.prewarm_log, self.list_log = [], [], [], []
        self.fail_source = False
        self.fail_prewarmer = False
        self.fail_business = False
        self.list_elapsed = 40
        self.reload_hook = None
        self.ctl = self.controller()
        self.capture = self.ctl.capture()
        self.build_package()

    def controller(self):
        return c.Controller(self.cfg, process_reader=lambda _: copy.deepcopy(self.rows),
            snapshot_reader=self.snapshot, get_reader=self.get, list_reader=self.list,
            reload_adapter=self.reload, health_reader=lambda *_: True,
            source_verifier=self.source, prewarm_verifier=self.prewarm,
            retired_reader=lambda *_: True, bindings=self.bindings)

    def snapshot(self, cfg):
        files, dirs = {}, {}
        for root in self.roots:
            for p in root.rglob('*'):
                if p.is_file():
                    files[str(p)] = h.describe(p)
            for p in [root, *[p for p in root.rglob('*') if p.is_dir()]]:
                dirs[str(p)] = {k: v for k, v in h.metadata(p).items() if k in ('statmode', 'uid', 'gid', 'dev', 'ino')}
        return dict(processes=copy.deepcopy(self.rows), servingRoots={'fixture': 'exact'},
                    protectedFiles=dict(sorted(files.items())), protectedDirectories=dict(sorted(dirs.items())))

    def get(self, host, relative):
        root = self.cfg.front if host == '51dianzi.com' else self.cfg.public
        return h.regular(root / (relative or 'index.html'))

    def reload(self, cfg, id_, api_sha):
        self.reload_log.append(id_)
        if self.reload_hook:
            self.reload_hook(id_)
        row = next(r for r in self.rows if r['id'] == id_)
        row['pid'] += 10000
        row['restarts'] += 1
        row['rawProcEnvironSha256'] = h.H(('new raw' + str(row['pid'])).encode())
        return {'id': id_}

    def source(self, cfg, digest):
        self.source_calls.append(digest)
        h.need(not self.fail_source, 'FIXTURE_REAL_SOURCE_MISMATCH')
        data = h.regular(self.store)
        return source_proof(h.decode(data), data, fast=True)

    def prewarm(self, cfg, request):
        self.prewarm_log.append(copy.deepcopy(request))
        return dict(request, schema='fast-prewarm-evidence-v1', prewarmComplete=not self.fail_prewarmer,
                    readyBeforeListen=not self.fail_prewarmer, technicalDeadlineMs=150, verifiedAtUtc=h.now())

    def list(self, part):
        self.list_log.append(part)
        doc = h.decode(h.regular(self.store))
        e = next(e for e in doc['entries'] if e['identity']['partNumber'] == part)
        resource = copy.deepcopy(e['technicalResource'])
        if self.fail_business and doc['generation'] != self.doc['generation']:
            resource['state'] = 'unavailable'
        return h.encode({'result': {'data': {'json': {'items': [dict(publicId=e['identity']['publicId'],
            partNumber=part, technicalResource=resource)]}}}}), self.list_elapsed

    def build_package(self):
        post = copy.deepcopy(self.doc)
        post['generation'] += 2
        for index in (0, 1):
            e = post['entries'][index]
            version = h.H(('new source ' + str(index)).encode())
            post['sources'][e['sourceKey']]['version'] = version
            post['sources'][e['sourceKey']]['ticket'] = str(uuid.UUID(int=500 + index))
            e['sourceVersion'] = version
            e['technicalResource'] = make_response(e['identity'], version, 12 if index == 0 else 13,
                                                    'https://example.org/' + str(index) + '.pdf')
        changes = {}
        new = {f['role']: Path(f['path']).name for f in self.bindings['files']}
        for role, path, replacements in [
            ('front-api', self.cfg.api, [('runtime-pointer', self.front_old_pointer,
                ('../runtime/' + new['front-runtime']).encode()), ('prelisten-await', b'', b'  await native.ready;\n')]),
            ('admin-api', self.cfg.admin_api, [('runtime-pointer', self.admin_old_pointer,
                ('../runtime/' + new['admin-runtime']).encode()), ('runtime-pointer', self.helper_old_pointer,
                ('../runtime/' + new['technical-helper']).encode())]),
            ('main-html', self.cfg.html, [('asset-pointer', ('/assets/' + self.old_asset.name).encode(),
                ('/' + next(f['packageFile'] for f in self.bindings['files'] if f['role'] == 'asset')).encode())])]:
            before = h.regular(path)
            after, proof = delta(before, replacements, path)
            changes[role] = before, after, proof
        before, after = h.regular(self.store), h.encode(post)
        changes['technical-store'] = before, after, c.store_delta(before, after, self.store)
        data = dict(self.leaf_data)
        data['capture.json'] = h.encode(self.capture)
        targets = []
        for role in s.TARGET_ROLES:
            before, after, proof = changes[role]
            payloads = {f'preimages/{role}.bin': before, f'postimages/{role}.bin': after,
                        f'deltas/{role}.json': h.encode(proof)}
            data.update(payloads)
            targets.append(dict(role=role, path=str(self.cfg.targets[role]), beforeFile=f'preimages/{role}.bin',
                afterFile=f'postimages/{role}.bin', deltaFile=f'deltas/{role}.json',
                beforeSha256=h.H(before), afterSha256=h.H(after)))
        data['evidence/source-verifier.mjs'] = b'// source verifier fixture\n'
        data['evidence/prewarm-verifier.mjs'] = b'// prewarm verifier fixture\n'
        data['evidence/store-source-verification.json'] = h.encode(source_proof(post, h.encode(post)))
        data['evidence/html-references.json'] = h.encode(dict(schema='fast-html-references-v1',
            before=c.html_refs(changes['main-html'][0]), after=c.html_refs(changes['main-html'][1])))
        data['evidence/build-proof.json'] = h.encode(dict(schema='fast-build-proof-v1', technicalDeadlineMs=150,
            frontAwaitBeforeListen=True, rejectPrewarmPreventsListen=True, currentFileAcrossTickets=True,
            noFirstPaintWaitAdded=True, financialAndInventoryBytesPreserved=True, scopeReviewed=True,
            sourceBundleSha256=self.bindings['businessSourceBundleSha256']))
        new_files = []
        for f in self.bindings['files']:
            path = Path(f['path'])
            parent = path.parent.stat()
            new_files.append(dict(f, sha256=h.H(data[f['packageFile']]), size=len(data[f['packageFile']]),
                                  mode=0o644, uid=parent.st_uid, gid=parent.st_gid))
        self.manifest = dict(schema='fast-manifest-v1', ownerTask=s.OWNER, scope=s.SCOPE, ttlSeconds=s.TTL,
            sourceFiles=self.ctl.sources, referenceSourceFiles=c.PINS, controllerSha256=self.ctl.controller_hash,
            bindingsSha256=self.ctl.binding_hash, captureSha256=h.H(data['capture.json']),
            fullMetaSha256=self.capture['fullMetaSha256'], coordSha256=self.capture['coordSha256'],
            targets=targets, newFiles=new_files, reloadIds=list(s.RELOAD_IDS), storePolicy=s.STORE_POLICY,
            sourceVerification=s.SOURCE_SEQUENCE, forbiddenBusinessChanges=s.FORBIDDEN,
            packageFiles={n: h.H(v) for n, v in data.items()})
        self.data = data
        self.save()

    def save(self):
        self.manifest['packageFiles'] = {n: h.H(v) for n, v in self.data.items()}
        for name, content in self.data.items():
            write(self.cfg.package / name, content)
        mb = h.encode(self.manifest)
        write(self.cfg.package / 'manifest.json', mb)
        self.manifest_sha = h.H(mb)
        review = dict(schema='fast-independent-review-v1', status='passed', independent=True,
            releaseApproved=True, reviewer='fixture-independent-review', reviewedAtUtc=h.now(),
            manifestSha256=self.manifest_sha)
        for key in ('ownerTask', 'scope', 'controllerSha256', 'sourceFiles', 'captureSha256',
                    'fullMetaSha256', 'coordSha256', 'bindingsSha256'):
            review[key] = self.manifest[key]
        rb = h.encode(review)
        write(self.cfg.package / 'review.json', rb)
        self.review_sha = h.H(rb)

    def package(self):
        b = self.ctl.package_data(self.manifest_sha, self.review_sha)
        self.ctl.coord_record = b['capture']['coordRecord']
        self.ctl.current_coord = b['coord']
        return b

    def apply(self):
        return self.ctl.apply(self.cfg.package, self.manifest_sha, self.review_sha)

    def cleanup(self):
        self.tmp.cleanup()


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.cleanup)

    def test_reference_pins_and_bundle(self):
        self.assertEqual(set(c.PINS), {'release.py', 'safe_helpers.py', 'scope.py'})
        self.assertEqual(c.bundle()['referenceSourceFiles'], c.PINS)

    def test_capture_private_tmp_and_exact_metadata(self):
        self.assertEqual(len(self.f.capture['processes']), 12)
        self.assertEqual(self.f.capture['targets']['technical-store']['sha256'], h.H(h.regular(self.f.store)))
        with self.assertRaises(ValueError):
            s.Config(Path('/home/ubuntu'))

    def test_complete_preflight_is_readonly(self):
        before = self.f.snapshot(self.f.cfg)
        result = self.f.ctl.preflight(self.f.cfg.package, self.f.manifest_sha)
        self.assertEqual(result['productionWrites'], 0)
        self.assertEqual(before, self.f.snapshot(self.f.cfg))
        self.assertEqual(self.f.reload_log, [])
        self.assertEqual(h.regular(self.f.cfg.coord), self.f.coord_original)

    def test_complete_apply_order_probes_and_history(self):
        result = self.f.apply()
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(self.f.reload_log, list(s.RELOAD_IDS))
        self.assertEqual([p['id'] for p in self.f.prewarm_log], list(s.FRONT_IDS))
        self.assertEqual(len(self.f.list_log), 9)
        self.assertGreaterEqual(len(self.f.source_calls), 4)
        state = h.decode(h.regular(self.f.cfg.coord))
        self.assertFalse(state['shared_release_active'])
        self.assertEqual(state['foreignFlag'], {'deep': [1, 2, 3]})
        self.assertEqual(state['window_history'][0], {'owner_task': 'other', 'result': 'keep'})
        self.assertEqual(len(state['window_history']), 2)
        self.assertEqual(state['window']['previousWindow']['foreign'], 'keep')
        self.assertTrue((self.f.cfg.receipt / 'confirmed.json').exists())
        with self.assertRaises(h.ReleaseError):
            self.f.controller().apply(self.f.cfg.package, self.f.manifest_sha, self.f.review_sha)

    def test_unfilled_bindings_fail_closed(self):
        self.f.ctl.bindings['sourceVerifier']['sha256'] = None
        with self.assertRaises(h.ReleaseError):
            self.f.package()

    def test_manifest_unknown_fields_scope_and_ids_rejected(self):
        for key, value in [('unknown', 1), ('reloadIds', [201]), ('ownerTask', 'foreign')]:
            original = copy.deepcopy(self.f.manifest)
            self.f.manifest[key] = value
            self.f.save()
            with self.assertRaises(h.ReleaseError):
                self.f.package()
            self.f.manifest = original

    def test_extra_package_file_and_empty_directory_rejected(self):
        p = self.f.cfg.package / 'extra.bin'
        write(p, b'extra')
        with self.assertRaises(h.ReleaseError):
            self.f.package()
        p.unlink()
        (self.f.cfg.package / 'surprise').mkdir()
        with self.assertRaises(h.ReleaseError):
            self.f.package()

    def test_review_pin_and_manifest_bind_rejected(self):
        path = self.f.cfg.package / 'review.json'
        rv = h.decode(h.regular(path))
        rv['manifestSha256'] = h.H(b'foreign')
        rb = h.encode(rv)
        write(path, rb)
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.package_data(self.f.manifest_sha, h.H(rb))

    def test_inverse_proof_rejects_hidden_byte_change(self):
        b = self.f.package()
        t = next(t for t in b['m']['targets'] if t['role'] == 'front-api')
        before, after = b['data'][t['beforeFile']], b['data'][t['afterFile']]
        proof = h.decode(b['data'][t['deltaFile']])
        c.byte_delta(before, after, proof, self.f.cfg.api)
        with self.assertRaises(h.ReleaseError):
            c.byte_delta(before, after[:-1] + b'X', proof, self.f.cfg.api)

    def test_api_prewarm_insertion_must_be_exact_and_unique(self):
        b = self.f.package()
        proof = h.decode(b['data']['deltas/front-api.json'])
        patch = next(p for p in proof['patches'] if p['kind'] == 'prelisten-await')
        patch['offset'] += 1
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.api_scope('front-api', b['changes']['front-api']['before'], proof,
                                 b['additions'], b['capture'])

    def test_store_unrelated_entry_change_rejected_even_same_bytes_length(self):
        b = self.f.package()
        before, after = b['changes']['technical-store']['before'], b['changes']['technical-store']['after']
        doc = h.decode(after)
        doc['entries'][2]['technicalResource']['resource']['description'] = 'changed unrelated'
        with self.assertRaises(h.ReleaseError):
            c.store_delta(before, h.encode(doc), self.f.store)

    def test_store_unrelated_source_and_entry_reordering_rejected(self):
        b = self.f.package()
        before, after = b['changes']['technical-store']['before'], b['changes']['technical-store']['after']
        doc = h.decode(after)
        doc['sources'][doc['entries'][2]['sourceKey']]['ticket'] = str(uuid.uuid4())
        with self.assertRaises(h.ReleaseError):
            c.store_delta(before, h.encode(doc), self.f.store)
        doc = h.decode(after)
        doc['entries'].reverse()
        with self.assertRaises(h.ReleaseError):
            c.store_delta(before, h.encode(doc), self.f.store)

    def test_store_serialization_and_two_generation_steps_allowed(self):
        b = self.f.package()
        before, after = b['changes']['technical-store']['before'], b['changes']['technical-store']['after']
        encoded = __import__('json').dumps(h.decode(after), indent=2).encode()
        proof = c.store_delta(before, encoded, self.f.store)
        self.assertEqual(proof['afterGeneration'] - proof['beforeGeneration'], 2)

    def test_initial_store_mutation_is_strict_CAS_not_ignored(self):
        write(self.f.store, h.regular(self.f.store) + b' ')
        with self.assertRaises(h.ReleaseError):
            self.f.apply()
        self.assertFalse(self.f.cfg.receipt.exists())
        self.assertEqual(self.f.reload_log, [])

    def test_atomic_cas_detects_content_and_metadata(self):
        path = self.f.cfg.html
        old, record = h.regular(path), h.describe(path)
        path.chmod(0o600)
        with self.assertRaises(h.ReleaseError):
            h.atomic_cas(path, old, b'new', self.f.cfg.stage, expected_record=record)
        self.assertEqual(h.regular(path), old)
        with self.assertRaises(h.ReleaseError):
            h.atomic_cas(path, b'wrong', b'new', self.f.cfg.stage)

    def test_closed_coord_gate_and_freshness(self):
        for update in [dict(shared_release_active=True), dict(needsOperatorRecovery=True)]:
            state = h.decode(self.f.coord_original)
            state.update(update)
            with self.assertRaises(h.ReleaseError):
                self.f.ctl.coord_closed(h.encode(state))
        capture = copy.deepcopy(self.f.capture)
        capture['capturedAtUtc'] = '2000-01-01T00:00:00+00:00'
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.fresh(capture)

    def test_unknown_file_mutation_and_creation_guarded(self):
        b = self.f.package()
        write(self.f.cfg.nginx / 'nginx.conf', b'drift')
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.guard(b)
        write(self.f.cfg.nginx / 'nginx.conf', b'protected config')
        write(self.f.cfg.nginx / 'unknown.conf', b'unknown')
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.guard(b)

    def test_unreloaded_process_pid_and_raw_env_exact(self):
        for key, value in [('pid', 100000), ('rawProcEnvironSha256', h.H(b'drift'))]:
            changed = copy.deepcopy(self.f.rows)
            row = next(r for r in changed if r['id'] == 201)
            row[key] = value
            with self.assertRaises(h.ReleaseError):
                self.f.ctl.process_guard(self.f.capture['processes'], changed)

    def test_own_reload_stable_env_config_cannot_change(self):
        changed = copy.deepcopy(self.f.rows)
        row = next(r for r in changed if r['id'] == 191)
        row.update(pid=60000, restarts=2, rawProcEnvironSha256=h.H(b'new raw'), childConfigSha256=h.H(b'evil'))
        self.f.ctl.rolls[191], self.f.ctl.pids[191] = 1, 60000
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.process_guard(self.f.capture['processes'], changed)

    def test_prewarmer_failure_rolls_back_only_owned_and_holds_coord(self):
        self.f.fail_prewarmer = True
        with self.assertRaises(h.ReleaseError):
            self.f.apply()
        state = h.decode(h.regular(self.f.cfg.coord))
        self.assertTrue(state['shared_release_active'])
        self.assertTrue(state['window']['needsOperatorRecovery'])
        self.assertEqual(state['window']['status'], 'recovery-required')
        self.assertEqual(h.regular(self.f.cfg.api), self.f.data['preimages/front-api.bin'])
        self.assertEqual(h.regular(self.f.store), self.f.data['preimages/technical-store.bin'])
        self.assertTrue(all(id_ in s.RELOAD_IDS for id_ in self.f.reload_log))
        self.assertTrue((self.f.cfg.receipt / 'failure.json').exists())
        self.assertFalse((self.f.cfg.receipt / 'confirmed.json').exists())

    def test_business_http200_unavailable_rejected_and_rolled_back(self):
        self.f.fail_business = True
        with self.assertRaises(h.ReleaseError):
            self.f.apply()
        self.assertEqual(h.regular(self.f.cfg.html), self.f.data['preimages/main-html.bin'])
        self.assertEqual(h.regular(self.f.cfg.api), self.f.data['preimages/front-api.bin'])
        self.assertEqual(self.f.reload_log, list(s.RELOAD_IDS) + list(s.RELOAD_IDS))

    def test_business_time_target_not_http200_only(self):
        self.f.list_elapsed = 201
        with self.assertRaises(h.ReleaseError):
            self.f.apply()
        self.assertTrue((self.f.cfg.receipt / 'failure.json').exists())

    def test_unknown_drift_during_reload_refuses_rollback_and_holds(self):
        def drift(id_):
            if id_ == 191:
                write(self.f.cfg.nginx / 'nginx.conf', b'foreign config drift')
        self.f.reload_hook = drift
        with self.assertRaises(h.ReleaseError):
            self.f.apply()
        self.assertEqual(h.regular(self.f.cfg.nginx / 'nginx.conf'), b'foreign config drift')
        self.assertEqual(h.regular(self.f.cfg.api), self.f.data['postimages/front-api.bin'])
        failure = h.decode(h.regular(self.f.cfg.receipt / 'failure.json'))
        self.assertEqual(failure['rollback']['status'], 'unverified-recovery-required')
        self.assertTrue(failure['ownedRecoveryFlagConfirmed'])

    def test_coord_lost_never_forceclosed_or_overwritten(self):
        foreign = h.encode(dict(shared_release_active=True, window={'owner_task': 'foreign'}))
        def drift(id_):
            if id_ == 191:
                write(self.f.cfg.coord, foreign)
        self.f.reload_hook = drift
        with self.assertRaises(h.ReleaseError):
            self.f.apply()
        self.assertEqual(h.regular(self.f.cfg.coord), foreign)
        failure = h.decode(h.regular(self.f.cfg.receipt / 'failure.json'))
        self.assertFalse(failure['ownedRecoveryFlagConfirmed'])

    def test_live_writer_must_be_independently_reverified_each_observation(self):
        b = self.f.package()
        change = b['changes']['technical-store']
        self.f.ctl.owned_records[str(self.f.store)] = change['record']
        self.f.ctl.replace(self.f.store, change['before'], change['after'])
        self.f.ctl.live_mode = True
        doc = h.decode(h.regular(self.f.store))
        entry = doc['entries'][2]
        version = h.H(b'legitimate writer source')
        doc['sources'][entry['sourceKey']].update(version=version, ticket=str(uuid.uuid4()))
        entry['sourceVersion'] = version
        entry['technicalResource'] = make_response(entry['identity'], version, 3, 'https://example.org/new.pdf')
        write(self.f.store, h.encode(doc))
        self.f.ctl.guard(b)
        self.assertEqual(len(self.f.source_calls), 1)
        self.f.ctl.guard(b)
        self.assertEqual(len(self.f.source_calls), 1)
        doc['generation'] += 1
        write(self.f.store, h.encode(doc))
        self.f.ctl.guard(b)
        self.assertEqual(len(self.f.source_calls), 2)
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.rollback_owned(b, b['coord'])

    def test_live_writer_unverifiable_source_fails_closed(self):
        b = self.f.package()
        change = b['changes']['technical-store']
        self.f.ctl.owned_records[str(self.f.store)] = change['record']
        self.f.ctl.replace(self.f.store, change['before'], change['after'])
        self.f.ctl.live_mode = True
        self.f.fail_source = True
        write(self.f.store, h.regular(self.f.store) + b' ')
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.guard(b)
        self.assertEqual(self.f.ctl.store_observations, [])

    def test_dual_lock_contention_and_symlink_refused(self):
        import fcntl
        import os
        fd = os.open(self.f.cfg.locks[0], os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(h.ReleaseError):
                with h.locked(self.f.cfg):
                    pass
        finally:
            os.close(fd)
        lock = self.f.cfg.locks[0]
        lock.unlink()
        lock.symlink_to(self.f.cfg.locks[1])
        with self.assertRaises(h.ReleaseError):
            with h.locked(self.f.cfg):
                pass

    def test_source_ticket_and_resource_version_mismatch_rejected(self):
        b = self.f.package()
        data = b['changes']['technical-store']['after']
        doc = h.decode(data)
        proof = source_proof(doc, data)
        proof['sourceVersions'][doc['entries'][0]['sourceKey']] = h.H(b'wrong')
        with self.assertRaises(h.ReleaseError):
            R.technical_store(data, h.encode(proof), True)

    def test_no_injection_without_private_fixture(self):
        with self.assertRaises(h.ReleaseError):
            c.Controller(get_reader=lambda *_: b'')


    def test_prewarm_digest_matches_whole_parsed_sources_and_defaults(self):
        raw = copy.deepcopy(self.f.doc)
        parsed = copy.deepcopy(raw)
        for record in parsed['sources'].values():
            record['pendingWriterTickets'] = []
        self.assertEqual(c.prewarm_sources_digest(raw), R.js_digest(parsed['sources']))
        self.assertEqual(c.prewarm_sources_digest(raw), c.prewarm_sources_digest(parsed))
        self.assertNotEqual(c.prewarm_sources_digest(raw),
                            R.js_digest({k: v['ticket'] for k, v in raw['sources'].items()}))

    def test_package_whitelist_rechecked_after_initial_validation(self):
        b = self.f.package()
        write(self.f.cfg.package / 'evidence' / 'late-unlisted.json', b'{}')
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.guard(b)

    def test_origin_asset_wrong_body_fails_before_api_store_writes(self):
        actual_get = self.f.ctl.get_reader
        self.f.ctl.get_reader = lambda host, path: b'wrong origin bytes' if path.startswith('assets/') else actual_get(host, path)
        with self.assertRaises(h.ReleaseError):
            self.f.apply()
        self.assertEqual(self.f.reload_log, [])
        self.assertEqual(h.regular(self.f.cfg.api), self.f.data['preimages/front-api.bin'])
        self.assertEqual(h.regular(self.f.store), self.f.data['preimages/technical-store.bin'])
        self.assertTrue(h.decode(h.regular(self.f.cfg.coord))['window']['needsOperatorRecovery'])

    def test_lock_inode_replacement_detected_inside_held_dual_lock(self):
        lock = self.f.cfg.locks[0]
        with h.locked(self.f.cfg):
            lock.rename(lock.with_name(lock.name + '.old'))
            write(lock, b'replaced inode')
            with self.assertRaises(h.ReleaseError):
                h.check_lock_inodes()

    def test_live_source_ticket_proof_must_bind_actual_current_ticket(self):
        b = self.f.package()
        change = b['changes']['technical-store']
        self.f.ctl.owned_records[str(self.f.store)] = change['record']
        self.f.ctl.replace(self.f.store, change['before'], change['after'])
        real_source = self.f.ctl.source_verifier
        def wrong_ticket(cfg, digest):
            proof = real_source(cfg, digest)
            proof['sourceTickets'][next(iter(proof['sourceTickets']))] = str(uuid.uuid4())
            return proof
        self.f.ctl.source_verifier = wrong_ticket
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.verify_source_record(h.describe(self.f.store))

    def test_old_raw_env_helper_does_not_normalize_nested_application_values(self):
        a = b'NODE_UNIQUE_ID=2\0OPAQUE={"NODE_UNIQUE_ID":"app-2"}\0'
        b = b'NODE_UNIQUE_ID=8\0OPAQUE={"NODE_UNIQUE_ID":"app-2"}\0'
        changed = b'NODE_UNIQUE_ID=8\0OPAQUE={"NODE_UNIQUE_ID":"app-8"}\0'
        self.assertEqual(R.raw_stable(a, True), R.raw_stable(b, True))
        self.assertNotEqual(R.raw_stable(a, True), R.raw_stable(changed, True))
        self.assertNotEqual(R.raw_stable(a, False), R.raw_stable(b, False))

    def test_unknown_reload_id_cannot_invoke_adapter(self):
        b = self.f.package()
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.reload_one(b, 201, b['coord'])
        self.assertEqual(self.f.reload_log, [])


    def test_source_change_after_business_probe_cannot_close_even_when_authentic(self):
        def health_with_real_writer(*_):
            doc = h.decode(h.regular(self.f.store))
            e = doc['entries'][2]
            version = h.H(b'after-probe-real-source-change')
            doc['sources'][e['sourceKey']].update(version=version, ticket=str(uuid.uuid4()))
            e['sourceVersion'] = version
            e['technicalResource'] = make_response(e['identity'], version, 4, 'https://example.org/latest.pdf')
            write(self.f.store, h.encode(doc))
            return True
        self.f.ctl.health_reader = health_with_real_writer
        with self.assertRaises(h.ReleaseError):
            self.f.apply()
        failure = h.decode(h.regular(self.f.cfg.receipt / 'failure.json'))
        self.assertIn('STORE_CHANGED_SINCE_BUSINESS_PROBE', failure['error'])
        self.assertTrue(h.decode(h.regular(self.f.cfg.coord))['shared_release_active'])
        self.assertEqual(failure['rollback']['status'], 'unverified-recovery-required')
        self.assertGreater(len(list(self.f.cfg.receipt.glob('source-check-*.json'))), 0)

    def test_actual_list_input_superjson_partnumber_without_network(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        from urllib.parse import parse_qs, urlsplit
        with patch.object(c.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=b'{}', stderr=b'')) as run:
            c.list_get('STM8S003F3P6TR')
            url = run.call_args.args[0][-1]
        parsed = h.decode(parse_qs(urlsplit(url).query)['input'][0])
        self.assertEqual(parsed, {'json': {'partNumber': 'STM8S003F3P6TR', 'page': 1, 'pageSize': 10}})
        self.assertEqual(urlsplit(url).path, '/api/trpc/officialMall.list')

    def test_json_schema_and_runtime_exact_manifest_keys_agree(self):
        schema = h.decode(h.regular(c.HERE / 'manifest.schema.json'))
        self.assertEqual(set(schema['properties']), c.MANIFEST_KEYS)
        self.assertEqual(set(schema['required']), c.MANIFEST_KEYS)
        self.assertEqual(schema['properties']['reloadIds']['const'], list(s.RELOAD_IDS))
        self.assertEqual(set(schema['$defs']['newFile']['properties']['role']['enum']),
                         {'asset', 'front-runtime', 'admin-runtime', 'technical-helper', 'front-helper', 'runtime-worker'})

    def test_nested_asset_complete_apply_and_full_origin_path(self):
        f = Fixture(nested_asset=True)
        self.addCleanup(f.cleanup)
        requested, actual = [], f.ctl.get_reader
        def get(host, relative):
            requested.append(relative)
            return actual(host, relative)
        f.ctl.get_reader = get
        self.assertEqual(f.apply()['status'], 'verified')
        asset = next(x for x in f.bindings['files'] if x['role'] == 'asset')
        self.assertIn(asset['packageFile'], requested)
        self.assertTrue(asset['packageFile'].startswith('assets/existing/shared/'))

    def test_asset_path_escape_symlink_missing_and_uncaptured_parent_rejected(self):
        f = self.f
        original = copy.deepcopy(f.manifest['newFiles'])
        index = next(i for i, x in enumerate(original) if x['role'] == 'asset')
        leaf = Path(original[index]['path']).name
        escape = f.cfg.front / 'assets-escape'
        escape.mkdir()
        (f.cfg.front / 'assets' / 'linked').symlink_to(escape, target_is_directory=True)
        (f.cfg.front / 'assets' / 'late').mkdir()
        bad_paths = [str(f.cfg.front / 'assets') + '/../assets-escape/' + leaf,
                     str(f.cfg.front / 'assets') + '//'+leaf,
                     str(f.cfg.front / 'assets') + '/./'+leaf,
                     str(escape / leaf), str(f.cfg.front / 'assets' / 'linked' / leaf),
                     str(f.cfg.front / 'assets' / 'missing' / leaf),
                     str(f.cfg.front / 'assets' / 'late' / leaf)]
        for path in bad_paths:
            with self.subTest(path=path):
                files = copy.deepcopy(original)
                files[index]['path'] = path
                f.ctl.bindings['files'] = [{k: x[k] for k in ('role', 'path', 'packageFile')} for x in files]
                with self.assertRaises(h.ReleaseError):
                    f.ctl.validate_additions(files, f.data, f.capture)

    def test_nested_asset_package_path_and_full_hash_still_required(self):
        f = Fixture(nested_asset=True)
        self.addCleanup(f.cleanup)
        files = copy.deepcopy(f.manifest['newFiles'])
        asset = next(x for x in files if x['role'] == 'asset')
        asset['packageFile'] = 'assets/' + Path(asset['path']).name
        f.ctl.bindings['files'] = [{k: x[k] for k in ('role', 'path', 'packageFile')} for x in files]
        with self.assertRaises(h.ReleaseError):
            f.ctl.validate_additions(files, f.data, f.capture)
        asset['packageFile'] = next(x['packageFile'] for x in f.manifest['newFiles'] if x['role'] == 'asset')
        asset['sha256'] = h.H(b'other content')
        f.ctl.bindings['files'] = [{k: x[k] for k in ('role', 'path', 'packageFile')} for x in files]
        with self.assertRaises(h.ReleaseError):
            f.ctl.validate_additions(files, f.data, f.capture)

    def html_case(self):
        b = self.f.package()
        target = '/' + next(x['packageFile'] for x in self.f.bindings['files'] if x['role'] == 'asset')
        old = '/assets/' + self.f.old_asset.name
        logical = '/assets/useGuestQuery-BHlnM91Z.js'
        mapping = {'imports': {logical: old}, 'scopes': {logical: {'guest': old}}}
        before = (b'<html><head><script type="importmap">' + h.encode(mapping).strip() +
                  b'</script><script src="' + old.encode() + b'"></script></head><body>' +
                  b'keep navigation ' * 200 + b'</body></html>')
        # Exact guest global alias insertion plus nested scope migration; logical keys stay.
        new_mapping = copy.deepcopy(mapping)
        new_mapping['imports'][logical] = target
        new_mapping['imports']['/assets/guest-physical-old.js'] = target
        new_mapping['scopes'] = {target: {'guest': target}}
        old_json = h.encode(mapping).strip()
        after, proof = delta(before, [('asset-alias', old_json, h.encode(new_mapping).strip())], self.f.cfg.html)
        data = dict(b['data'])
        data['deltas/main-html.json'] = h.encode(proof)
        data['evidence/html-references.json'] = h.encode(dict(schema='fast-html-references-v1',
            before=c.html_refs(before), after=c.html_refs(after)))
        self.f.ctl.bindings['htmlDeltaSha256'] = h.H(data['deltas/main-html.json'])
        return b, before, after, proof, data, logical, target

    def test_logical_keys_and_scopekeys_not_physical_references(self):
        b, before, after, proof, data, logical, target = self.html_case()
        self.assertIn(logical.encode(), after)
        self.assertNotIn(logical, c.html_refs(after))
        self.assertIn(target, c.html_refs(after))
        # The retained old URL is still a real script reference and is allowed.
        self.assertIn('/assets/' + self.f.old_asset.name, c.html_refs(after))
        self.f.ctl.html_scope(before, after, proof, b['additions'], b['capture'], data)

    def test_bound_html_still_rejects_unknown_mapping_value_or_script_link_asset(self):
        b, before, after, proof, data, _, target = self.html_case()
        for bad in [after.replace(target.encode(), b'/assets/missing.js'),
                    after.replace(b'</head>', b'<link href="/assets/missing.css"></head>'),
                    after.replace(b'</head>', b'<script src="/assets/missing.js"></script></head>')]:
            # Explicit independent test seal cannot bypass physical-reference validation.
            # A single small prefix replacement covers these controlled fixture changes.
            end = before.index(b'</head>') + len(b'</head>')
            bad_end = bad.index(b'</head>') + len(b'</head>')
            changed, p = delta(before, [('asset-alias', before[1:end], bad[1:bad_end])], self.f.cfg.html)
            d = dict(data, **{'deltas/main-html.json': h.encode(p)})
            d['evidence/html-references.json'] = h.encode(dict(schema='fast-html-references-v1',
                before=c.html_refs(before), after=c.html_refs(changed)))
            self.f.ctl.bindings['htmlDeltaSha256'] = h.H(d['deltas/main-html.json'])
            with self.assertRaisesRegex(h.ReleaseError, 'HTML_REFERENCE_UNKNOWN_OR_MISSING_ASSET'):
                self.f.ctl.html_scope(before, changed, p, b['additions'], b['capture'], d)

    def test_html_proof_seal_rejects_tamper_even_when_manifest_and_inverse_valid(self):
        b, before, after, proof, data, _, _ = self.html_case()
        for field in ('offset', 'beforeBase64', 'afterBase64', 'kind'):
            p = copy.deepcopy(proof)
            if field == 'offset':
                p['patches'][0][field] += 1
            else:
                p['patches'][0][field] += 'X'
            d = dict(data, **{'deltas/main-html.json': h.encode(p)})
            with self.assertRaises(h.ReleaseError):
                self.f.ctl.html_scope(before, after, p, b['additions'], b['capture'], d)
        changed, p = delta(before, [('asset-alias', b'keep navigation', b'evil navigation')], self.f.cfg.html)
        d = dict(data, **{'deltas/main-html.json': h.encode(p)})
        with self.assertRaisesRegex(h.ReleaseError, 'HTML_DELTA_NOT_IN_SEALED_BINDING'):
            self.f.ctl.html_scope(before, changed, p, b['additions'], b['capture'], d)
        # Reformatting the JSON also changes the raw approval seal.
        d = dict(data, **{'deltas/main-html.json': data['deltas/main-html.json'] + b' '})
        with self.assertRaisesRegex(h.ReleaseError, 'HTML_DELTA_NOT_IN_SEALED_BINDING'):
            self.f.ctl.html_scope(before, after, proof, b['additions'], b['capture'], d)

    def test_html_seal_mandatory_and_kind_cannot_claim_home_copy(self):
        b, before, after, proof, data, _, _ = self.html_case()
        self.f.ctl.bindings['htmlDeltaSha256'] = None
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.validate_bindings()
        proof['patches'][0]['kind'] = 'home-copy'
        data['deltas/main-html.json'] = h.encode(proof)
        self.f.ctl.bindings['htmlDeltaSha256'] = h.H(data['deltas/main-html.json'])
        with self.assertRaisesRegex(h.ReleaseError, 'HTML_SCOPE_ONLY'):
            self.f.ctl.html_scope(before, after, proof, b['additions'], b['capture'], data)

    def test_empty_old_alias_insertion_and_full_quoted_pointers_are_exactly_bound(self):
        import re
        b, before, _, _, data, logical, target = self.html_case()
        old = ('"/assets/' + self.f.old_asset.name + '"').encode()
        patches = [dict(kind='asset-pointer', offset=m.start(), beforeBase64=B(old),
                        afterBase64=B(('"' + target + '"').encode())) for m in re.finditer(re.escape(old), before)]
        at = before.index(b'"imports":{') + len(b'"imports":{')
        patches.append(dict(kind='asset-alias', offset=at, beforeBase64='',
                            afterBase64=B(('"/assets/old-nested-guest.js":"' + target + '",').encode())))
        patches.sort(key=lambda p: p['offset'])
        after = before
        for p in reversed(patches):
            at = p['offset']
            after = after[:at] + c.b64(p['afterBase64']) + after[at + len(c.b64(p['beforeBase64'])):]
        proof = dict(schema='inline-byte-delta-v1', path=str(self.f.cfg.html), beforeSha256=h.H(before),
                     afterSha256=h.H(after), patches=patches)
        data['deltas/main-html.json'] = h.encode(proof)
        data['evidence/html-references.json'] = h.encode(dict(schema='fast-html-references-v1',
            before=c.html_refs(before), after=c.html_refs(after)))
        self.f.ctl.bindings['htmlDeltaSha256'] = h.H(data['deltas/main-html.json'])
        self.assertIn(logical.encode(), after)
        self.f.ctl.html_scope(before, after, proof, b['additions'], b['capture'], data)
        p = copy.deepcopy(proof)
        alias = next(x for x in p['patches'] if x['kind'] == 'asset-alias')
        alias['afterBase64'] = B(c.b64(alias['afterBase64']).replace(b'old-nested', b'bad-nested'))
        d = dict(data, **{'deltas/main-html.json': h.encode(p)})
        with self.assertRaises(h.ReleaseError):
            self.f.ctl.html_scope(before, after, p, b['additions'], b['capture'], d)

    def test_package_rehash_and_new_review_do_not_self_authorize_unknown_html(self):
        before = self.f.data['preimages/main-html.bin']
        asset = next(x for x in self.f.bindings['files'] if x['role'] == 'asset')
        after, proof = delta(before, [
            ('asset-pointer', ('/assets/' + self.f.old_asset.name).encode(), ('/' + asset['packageFile']).encode()),
            ('asset-pointer', b'>home<', b'>evil<')], self.f.cfg.html)
        self.f.data['postimages/main-html.bin'] = after
        self.f.data['deltas/main-html.json'] = h.encode(proof)
        next(t for t in self.f.manifest['targets'] if t['role'] == 'main-html')['afterSha256'] = h.H(after)
        self.f.save()
        with self.assertRaisesRegex(h.ReleaseError, 'HTML_DELTA_NOT_IN_SEALED_BINDING'):
            self.f.package()

    def test_importmap_single_json_duplicate_keys_and_unsafe_values_rejected(self):
        for text in [b'<script type="importmap">{}</script>' * 2,
                     b'<script type="importmap">{"imports":{"x":"a","x":"b"}}</script>',
                     b'<script type="importmap">{"imports":{"x":"/assets/a/../bad.js"}}</script>',
                     b'<script type="importmap">{"imports":{"x":{}}}</script>',
                     b'<script type="importmap">{"scopes":{"x":[]}}</script>',
                     b'<script type="importmap">{bad}</script>', b'<html></html>']:
            with self.subTest(text=text), self.assertRaises(h.ReleaseError):
                c.html_refs(text)

    def test_bindings_schema_exact_keys_and_fixture_seal_agree(self):
        schema = h.decode(h.regular(c.HERE / 'bindings.schema.json'))
        self.assertEqual(set(schema['properties']), c.BINDING_KEYS)
        self.assertEqual(set(schema['required']), c.BINDING_KEYS)
        self.assertEqual(self.f.bindings['htmlDeltaSha256'], h.H(self.f.data['deltas/main-html.json']))


if __name__ == '__main__':
    unittest.main(verbosity=2)
