#!/usr/bin/env python3
"""Bound, one-shot continuation, not original apply. Stdlib only.

Prepare private fixed recovery stage/package; keep ORIGINAL stage/package and
receipt/failure.json untouched. Place this file, SHA-pinned release.py and
seven-fixed-links.json together. --capture-recovery prints readonly fresh JSON.
Save exact stdout as recovery package/capture.json. Build manifest with
manifest_for(capture, SHA(exact capture bytes)); independently review and produce
review_for(manifest, SHA(exact manifest bytes)) ONLY after actual independent
approval. Those helpers describe the protocol, not an approval service.
Exactly three package files: capture.json, manifest.json, review.json.
CLI --preflight and --complete-recovery require all four explicit SHA pins.
No API/assets writes, no 190 repeat, no rollback/env repair/retry. A new failure
or attempt receipt permanently blocks replay; original owned open window remains
blocked on failure (foreign coordination is never touched). Advisory full-META
CAS cannot protect against uncooperative writers outside the existing flock.
"""
import argparse
import base64
import copy
from dataclasses import replace
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import sys

OLD_CONTROLLER = '9bb7a96bb26b8998fcbd586fd7d5c4ac012dd6a9afb5ac4690634266e94d300b'
OLD_MANIFEST = 'd44feb14524326501770e2053463a44b78d4e39f74e12d8ad236dc2f7c2da14b'
OLD_REVIEW = 'd80b251a9554686bcb52626679401b986853f8bfa4a6efc134bf34a97bc4643d'
OLD_FAILURE = '1fc0767021ae4a855feab8e8103ef10048a789598c7e07bf410cad2101cbb6a4'
NODE_PRIMARY = '59fff5090a10b5234baab900d2e34de50f385b68ac1f4561dc2d5e5b8ccf14a0'
EXACT_PROOF = '98994bfe9eed8c388e1082376022f0cb386ea3c6e616843f686a1dfecd8055ef'
PRIMARY_PROOF = 'dcd29cbc207688b02fabfa3b3e8384c9099a0692c106eb365e55a712e10dba8b'
SCOPE = 'customer-upload-customer-bound-recovery-20261119-PnHdmd0yBi'
STAGE = Path('/opt/ops') / SCOPE
OLD_STAGE = Path('/opt/ops/customer-upload-customer-bound-20261119-PnHdmd0yBi')
REMAINING = (193, 194, 200)


def load_original(path, expected=OLD_CONTROLLER):
    """Verify raw source before executing it; original __main__ never runs."""
    path = Path(path).absolute()
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected or expected != OLD_CONTROLLER:
        raise RuntimeError('ORIGINAL_CONTROLLER_SHA_MISMATCH')
    spec = importlib.util.spec_from_file_location('recovery_original_release', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    for name in ('regular', 'describe', 'inventory', 'serving_roots', 'process_snapshot',
                 'raw_environment_semantics', 'process_permissions', 'locked',
                 'atomic_cas', 'exclusive', 'verified_pm2_reload', 'verified_front_listener'):
        if not callable(getattr(module, name, None)):
            raise RuntimeError('ORIGINAL_FUNCTION_CONTRACT')
    return module


r = load_original(Path(__file__).with_name('release.py'))


def node_primary_hash():
    node = '/usr/bin/node-22' if Path('/usr/bin/node-22').is_file() else '/usr/bin/node'
    result = subprocess.run([node, '-e', "process.stdout.write(process.binding('natives')['internal/cluster/primary'])"],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=12)
    r.need(result.returncode == 0, 'NODE_PRIMARY_READ_FAILED')
    return r.H(result.stdout)


def outer_unique(raw, replacement=0, expected=None):
    # Validate complete NUL format/duplicates with original parser first. Never
    # decode any application JSON, nor replace a nested pm2_env field.
    r.raw_environment_semantics(raw)
    parts = raw[:-1].split(b'\0')
    hits = [i for i, v in enumerate(parts) if v.startswith(b'NODE_UNIQUE_ID=')]
    r.need(len(hits) == 1, 'EXACT_OUTER_NODE_UNIQUE_ID_REQUIRED')
    i = hits[0]
    number = parts[i].split(b'=', 1)[1]
    r.need(re.fullmatch(rb'[0-9]+', number) is not None, 'NODE_UNIQUE_ID_INTEGER_REQUIRED')
    if expected is not None:
        r.need(number == str(expected).encode(), 'NODE_UNIQUE_ID_EXACT_PROOF_MISMATCH')
    parts[i] = b'NODE_UNIQUE_ID=' + str(replacement).encode()
    return b'\0'.join(parts) + b'\0'


def manifest_for(capture, capture_sha):
    return dict(schema='customer-bound-recovery-manifest-v1', ownerTask=r.OWNER,
        scope=SCOPE, originalScope=r.SCOPE, controllerSha256=capture['controllerSha256'],
        captureSha256=r.pin(capture_sha), originalManifestSha256=OLD_MANIFEST,
        originalReviewSha256=OLD_REVIEW, originalControllerSha256=OLD_CONTROLLER,
        originalFailureSha256=OLD_FAILURE, oldPackageFilesSHA=capture['oldPackageFilesSHA'],
        currentMetaSha256=r.H(r.encode(capture['protectedFiles'])),
        coordSha256=capture['coordSha256'], nonce=capture['nonce'], ttlSeconds=r.TTL,
        remainingReloads=list(REMAINING), nodePrimarySourceSha256=NODE_PRIMARY,
        exactProofSha256=EXACT_PROOF, primaryProofSha256=PRIMARY_PROOF)


def review_for(manifest, manifest_sha):
    """Exact independent review schema; calling this is NOT independent review."""
    return dict(schema='customer-bound-recovery-review-v1', status='passed',
        independent=True, recoveryApproved=True, ownerTask=r.OWNER, scope=SCOPE,
        manifestSha256=r.pin(manifest_sha), controllerSha256=manifest['controllerSha256'],
        captureSha256=manifest['captureSha256'], originalManifestSha256=OLD_MANIFEST,
        originalFailureSha256=OLD_FAILURE, currentMetaSha256=manifest['currentMetaSha256'],
        coordSha256=manifest['coordSha256'], nonce=manifest['nonce'],
        oldPackageFilesSHA=manifest['oldPackageFilesSHA'], remainingReloads=list(REMAINING))


class Recovery(r.Controller):
    def __init__(self, cfg, old_stage, process_reader=None, get_reader=None,
                 reload_adapter=None, api_health_reader=None, source_reader=None,
                 expected_original_records=19559):
        super().__init__(cfg, process_reader, get_reader, reload_adapter, api_health_reader)
        self.controller_hash = r.H(r.regular(Path(__file__).absolute()))
        self.old_stage = Path(old_stage)
        self.source_reader = source_reader or node_primary_hash
        self.expected_original_records = expected_original_records
        self.rolled = {}
        self.html_record = None

    def original(self):
        # Expired original capture is exclusively immutable evidence, not approval.
        self.private(self.old_stage)
        pkg = self.old_stage / 'package'
        self.private(pkg)
        mb, rb = r.regular(pkg/'manifest.json'), r.regular(pkg/'review.json')
        r.need(r.H(mb) == OLD_MANIFEST and r.H(rb) == OLD_REVIEW, 'ORIGINAL_MANIFEST_REVIEW_CHANGED')
        m, review = r.decode(mb), r.decode(rb)
        r.need(m['ownerTask'] == r.OWNER and m['scope'] == r.SCOPE
               and m['controllerSha256'] == OLD_CONTROLLER
               and review.get('status') == 'passed' and review.get('independent') is True
               and review.get('releaseApproved') is True
               and review['manifestSha256'] == OLD_MANIFEST
               and review['controllerSha256'] == OLD_CONTROLLER
               and review['captureSha256'] == m['captureSha256']
               and review['packageFiles'] == m['packageFiles'], 'ORIGINAL_BINDINGS')
        contents = {}
        for name, digest in m['packageFiles'].items():
            r.relative(name)
            data = r.regular(pkg / name)
            r.need(r.H(data) == r.pin(digest), 'OLD_PACKAGE_FILE_CHANGED: ' + name)
            contents[name] = data
        actual = {p.relative_to(pkg).as_posix() for p in pkg.rglob('*') if p.is_file() or p.is_symlink()}
        r.need(actual == set(m['packageFiles']) | {'manifest.json', 'review.json'}, 'OLD_PACKAGE_CONTENTS_CHANGED')
        old = r.decode(contents['capture.json'])
        r.need(r.H(contents['capture.json']) == m['captureSha256']
               and old['ownerTask'] == r.OWNER and old['scope'] == r.SCOPE
               and old['controllerSha256'] == OLD_CONTROLLER and old['ttlSeconds'] == r.TTL
               and old['publicRoot'] == str(self.cfg.public)
               and old['frontRoot'] == str(self.cfg.front) and old['apiPath'] == str(self.cfg.api)
               and len(old['protectedFiles']) == self.expected_original_records,
               'ORIGINAL_CAPTURE_BINDING')
        r.validate_processes(old['processes'])
        self.front_identity(old['processes'])
        for name, field in [('before-api.js','beforeApiSha256'), ('after-api.js','afterApiSha256'),
                            ('before-index.html','beforeHtmlSha256'), ('after-index.html','afterHtmlSha256')]:
            r.need(r.H(contents[name]) == m[field], 'ORIGINAL_PAYLOAD_HASH')
        r.need(r.H(contents['api-delta.json']) == m['apiDeltaSha256'], 'ORIGINAL_API_DELTA_HASH')
        r.api_delta(self.cfg, contents['api-delta.json'], contents['before-api.js'], contents['after-api.js'])
        patched = contents['before-index.html']
        for item in m['replacements']:
            patched = patched.replace(item['before'].encode(), item['after'].encode())
        r.need(patched == contents['after-index.html'], 'ORIGINAL_HTML_DELTA')
        fb = r.regular(self.old_stage/'receipt'/'failure.json')
        r.need(r.H(fb) == OLD_FAILURE, 'OLD_FAILURE_CHANGED')
        f = r.decode(fb)
        r.need(f['ownerTask'] == r.OWNER and f['scope'] == r.SCOPE
               and f['manifestSha256'] == OLD_MANIFEST and f['reviewSha256'] == OLD_REVIEW
               and f['controllerSha256'] == OLD_CONTROLLER and f['processReloads'] == 1
               and f['status'] == 'recovery-required-rollback-or-process-guard'
               and f['error'] == 'ReleaseError: ROLLING_NONVOLATILE_ENV_CONFIG_PERMISSION_DRIFT'
               and f['processRollbacks'] == [] and len(f['processReloadEvents']) == 1,
               'ORIGINAL_FAILURE_BINDING')
        event = f['processReloadEvents'][0]
        r.need(event['id'] == 190 and event['transportPassed'] is True
               and event['observedPidChange'] is True and event['rollback'] is False
               and event['apiSha256'] == m['afterApiSha256'], 'ORIGINAL_SUCCESS_EVENT')
        r.need(self.source_reader() == NODE_PRIMARY, 'NODE_PRIMARY_SOURCE_CHANGED')
        return dict(m=m, capture=old, contents=contents, failure=f, event=event)

    def owned(self, coord, b):
        state = r.decode(coord)
        w = state.get('window', {})
        r.need(state.get('shared_release_active') is True and w.get('status') == 'open'
               and w.get('owner_task') == r.OWNER and w.get('scope') == r.SCOPE
               and w.get('nonce') == b['failure']['nonce']
               and w.get('manifestSha256') == OLD_MANIFEST
               and w.get('controllerSha256') == OLD_CONTROLLER
               and w.get('reloadScope') == list(r.FRONT_IDS), 'FOREIGN_OR_UNOWNED_COORD')
        r.need(isinstance(state.get('window_history', []), list), 'COORD_HISTORY_INVALID')
        return state

    def snapshot(self):
        snap = super().snapshot()
        for row in snap['processes']:
            raw = (self.cfg.proc / str(row['pid']) / 'environ').read_bytes()
            r.need(r.H(raw) == row['rawProcEnvironSha256']
                   and r.raw_environment_semantics(raw) == row['rawProcEnvironSemanticSha256'],
                   'CURRENT_RAW_CHANGED_DURING_READ')
            if row['id'] in r.FRONT_IDS:
                row['nodeStableRawSha256'] = r.raw_environment_semantics(outer_unique(raw))
        return snap

    def initial_guard(self, b, snap, revalidate_raw=True):
        old, m = b['capture'], b['m']
        r.need(snap['servingRoots'] == old['servingRoots'], 'ORIGINAL_SERVING_ROOT_DRIFT')
        files = dict(snap['protectedFiles'])
        assets = {str(self.cfg.public/a['relative']) for a in m['assets']}
        r.need(len(assets) == 2 and set(files) == set(old['protectedFiles']) | assets,
               'ORIGINAL_INVENTORY_SET_DRIFT')
        for name, record in old['protectedFiles'].items():
            if name == str(self.cfg.api):
                current = files[name]
                r.need(current['sha256'] == m['afterApiSha256']
                       and current['size'] == len(b['contents']['after-api.js'])
                       and all(current[k] == record[k] for k in ('kind','statmode','uid','gid','dev','nlink')),
                       'API_AFTER_METADATA_DRIFT')
            else:
                r.need(files[name] == record, 'ORIGINAL_FULL_META_DRIFT: ' + name)
        htmlmode = files[str(self.cfg.html)]['statmode']
        for a in m['assets']:
            current = files[str(self.cfg.public/a['relative'])]
            r.need(current['kind'] == 'file' and current['sha256'] == a['sha256']
                   and current['size'] == a['size'] and current['statmode'] == (htmlmode & ~0o777) | 0o644
                   and current['uid'] == os.geteuid() and current['gid'] == os.getegid()
                   and current['nlink'] == 1, 'EXISTING_ASSET_HASH_OR_PERMISSION')
        original = {x['id']: x for x in old['processes']}
        ignore = {'pid','restarts','rawProcEnvironSha256','rawProcEnvironSemanticSha256','nodeStableRawSha256'}
        for row in snap['processes']:
            baseline = original[row['id']]
            plain = {k:v for k,v in row.items() if k != 'nodeStableRawSha256'}
            if row['id'] != 190:
                r.need(plain == baseline, 'ORIGINAL_UNRELOADED_PROCESS_DRIFT')
            else:
                e = b['event']
                for field, ef in [('pid','afterPid'),('restarts','afterRestart'),
                                  ('rawProcEnvironSha256','afterRawEnvironSha256'),
                                  ('rawProcEnvironSemanticSha256','afterSemanticSha256')]:
                    r.need(row[field] == e[ef], 'ORIGINAL_190_FAILURE_EVENT_MISMATCH')
                r.need(e['beforePid'] == baseline['pid'] and e['beforeRestart'] == baseline['restarts']
                       and e['afterRestart'] == baseline['restarts'] + 1
                       and e['beforeRawEnvironSha256'] == baseline['rawProcEnvironSha256']
                       and e['beforeSemanticSha256'] == baseline['rawProcEnvironSemanticSha256'], 'ORIGINAL_190_BEFORE_EVENT')
                r.need({k:v for k,v in row.items() if k not in ignore} ==
                       {k:v for k,v in baseline.items() if k not in ignore}, '190_CONFIG_PERMISSION_DRIFT')
                if revalidate_raw:
                    raw = (self.cfg.proc/str(row['pid'])/'environ').read_bytes()
                    reconstructed = outer_unique(raw, 1335, expected=1339)
                    r.need(r.H(raw) == row['rawProcEnvironSha256'] and
                           r.raw_environment_semantics(reconstructed) == baseline['rawProcEnvironSemanticSha256'],
                           '190_SINGLE_FIELD_OLD_SEMANTIC_RECONSTRUCTION_FAILED')
        r.need(r.regular(self.cfg.api) == b['contents']['after-api.js']
               and r.regular(self.cfg.html) == b['contents']['before-index.html'], 'CURRENT_API_HTML_BYTES')

    def capture_recovery(self):
        with r.locked(self.cfg):
            self.private(self.cfg.stage)
            self.private(self.cfg.package)
            self.no_replay()
            at = r.now()
            b = self.original()
            coord = r.regular(self.cfg.coord)
            self.owned(coord, b)
            first = self.snapshot()
            self.initial_guard(b, first)
            self.check_http(b, after=False)
            r.need(self.snapshot() == first and r.regular(self.cfg.coord) == coord,
                   'RECOVERY_CAPTURE_CURRENT_DRIFT')
            capture = dict(schema='customer-bound-recovery-capture-v1', ownerTask=r.OWNER,
                scope=SCOPE, originalScope=r.SCOPE, capturedAtUtc=at, ttlSeconds=r.TTL,
                controllerSha256=self.controller_hash, originalControllerSha256=OLD_CONTROLLER,
                originalManifestSha256=OLD_MANIFEST, originalReviewSha256=OLD_REVIEW,
                originalFailureSha256=OLD_FAILURE, originalFailurePath=str(self.old_stage/'receipt'/'failure.json'),
                oldPackagePath=str(self.old_stage/'package'), oldPackageFilesSHA=b['m']['packageFiles'],
                coordSha256=r.H(coord), coordBase64=base64.b64encode(coord).decode(),
                coordRecord=r.describe(self.cfg.coord), nonce=b['failure']['nonce'],
                nodePrimarySourceSha256=NODE_PRIMARY, exactProofSha256=EXACT_PROOF,
                primaryProofSha256=PRIMARY_PROOF, beforeHtmlSha256=b['m']['beforeHtmlSha256'],
                afterHtmlSha256=b['m']['afterHtmlSha256'], currentApiSha256=b['m']['afterApiSha256'],
                remainingReloads=list(REMAINING), environmentValuesExported=False, productionWrites=0, **first)
            self.fresh(capture)
            return capture

    def check_http(self, b, after):
        m = b['m']
        for host, name, digest in [('admin.51dianzi.com','',m['afterHtmlSha256'] if after else m['beforeHtmlSha256']),
                ('51dianzi.com','',b['capture']['protectedFiles'][str(self.cfg.front/'index.html')]['sha256'])] + [
                ('admin.51dianzi.com',a['relative'],a['sha256']) for a in m['assets']]:
            r.need(r.H(self.get_reader(host, name)) == digest, 'ROOT_OR_ASSET_FULL_BODY_HASH')
        self.readonly_adapters(m['afterApiSha256'])
        r.need(self.api_health_reader(self.cfg, m['afterApiSha256']) is True, 'LISTENER_FULL_BODY_HASH')

    def validate_recovery(self, package, manifest_sha, review_sha, capture_sha):
        r.need(Path(package).absolute() == self.cfg.package, 'EXACT_RECOVERY_PACKAGE_PATH')
        self.private(self.cfg.stage)
        self.private(self.cfg.package)
        self.no_replay()
        r.need({p.name for p in self.cfg.package.iterdir()} == {'capture.json','manifest.json','review.json'}, 'EXACT_THREE_RECOVERY_FILES')
        cb, mb, rb = [r.regular(self.cfg.package/n) for n in ('capture.json','manifest.json','review.json')]
        r.need(r.H(cb) == r.pin(capture_sha) and r.H(mb) == r.pin(manifest_sha)
               and r.H(rb) == r.pin(review_sha), 'RECOVERY_PACKAGE_SHA_MISMATCH')
        c, m, review = r.decode(cb), r.decode(mb), r.decode(rb)
        r.need(m == manifest_for(c, r.H(cb)) and review == review_for(m, r.H(mb)), 'INDEPENDENT_RECOVERY_APPROVAL_BINDING')
        self.fresh(c)
        b = self.original()
        coord = r.b64(c['coordBase64'])
        r.need(c['schema'] == 'customer-bound-recovery-capture-v1' and c['ownerTask'] == r.OWNER
               and c['scope'] == SCOPE and c['originalScope'] == r.SCOPE and c['ttlSeconds'] == r.TTL
               and c['controllerSha256'] == self.controller_hash
               and c['oldPackagePath'] == str(self.old_stage/'package')
               and c['originalFailurePath'] == str(self.old_stage/'receipt'/'failure.json')
               and c['oldPackageFilesSHA'] == b['m']['packageFiles']
               and c['originalControllerSha256'] == OLD_CONTROLLER and c['originalManifestSha256'] == OLD_MANIFEST
               and c['originalReviewSha256'] == OLD_REVIEW and c['originalFailureSha256'] == OLD_FAILURE
               and c['nodePrimarySourceSha256'] == NODE_PRIMARY and c['exactProofSha256'] == EXACT_PROOF
               and c['primaryProofSha256'] == PRIMARY_PROOF and c['remainingReloads'] == list(REMAINING)
               and c['beforeHtmlSha256'] == b['m']['beforeHtmlSha256']
               and c['afterHtmlSha256'] == b['m']['afterHtmlSha256']
               and c['currentApiSha256'] == b['m']['afterApiSha256']
               and c['nonce'] == b['failure']['nonce'] and r.H(coord) == c['coordSha256'], 'RECOVERY_CAPTURE_BINDING')
        self.owned(coord, b)
        self.initial_guard(b, c, revalidate_raw=False)
        b.update(current=c, coord=coord, manifestSha256=r.H(mb), reviewSha256=r.H(rb), captureSha256=r.H(cb))
        return b

    def continuation_guard(self, b):
        self.fresh(b['current'])
        r.need(r.H(r.regular(Path(__file__).absolute())) == self.controller_hash
               and r.H(r.regular(Path(r.__file__).absolute())) == OLD_CONTROLLER,
               'CONTROLLER_BYTES_CHANGED')
        r.need(r.H(r.regular(self.old_stage/'package'/'manifest.json')) == OLD_MANIFEST
               and r.H(r.regular(self.old_stage/'package'/'review.json')) == OLD_REVIEW,
               'ORIGINAL_MANIFEST_REVIEW_CHANGED')
        for name, digest in b['m']['packageFiles'].items():
            r.need(r.H(r.regular(self.old_stage/'package'/name)) == digest,
                   'OLD_PACKAGE_FILE_CHANGED: ' + name)
        r.need(r.regular(self.old_stage/'receipt'/'failure.json') and
               r.H(r.regular(self.old_stage/'receipt'/'failure.json')) == OLD_FAILURE, 'OLD_FAILURE_CHANGED')
        r.need(r.regular(self.cfg.coord) == b['coord']
               and r.describe(self.cfg.coord) == b['current']['coordRecord'], 'OWN_COORD_FULL_CAS_LOST')
        self.owned(b['coord'], b)
        snap = self.snapshot()
        c = b['current']
        r.need(snap['servingRoots'] == c['servingRoots'], 'CURRENT_SERVING_ROOT_DRIFT')
        expected = dict(c['protectedFiles'])
        if self.html_record is not None:
            expected[str(self.cfg.html)] = self.html_record
        r.need(snap['protectedFiles'] == expected, 'CURRENT_FULL_META_DRIFT')
        baseline = {x['id']:x for x in c['processes']}
        ignored = {'pid','restarts','rawProcEnvironSha256','rawProcEnvironSemanticSha256'}
        for row in snap['processes']:
            old = baseline[row['id']]
            if row['id'] not in r.FRONT_IDS:
                r.need(row == old, 'OTHER_EIGHT_FULL_RAW_DRIFT')
            else:
                r.need(row['pid'] == self.rolled.get(row['id'], old['pid'])
                       and row['restarts'] == old['restarts'] + int(row['id'] in self.rolled), 'RECOVERY_PID_RESTART_DRIFT')
                r.need({k:v for k,v in row.items() if k not in ignored} ==
                       {k:v for k,v in old.items() if k not in ignored}, 'FRONT_NODE_STABLE_CONFIG_PERMISSION_DRIFT')
        return snap

    def preflight_recovery(self, package, manifest_sha, review_sha, capture_sha):
        with r.locked(self.cfg):
            b = self.validate_recovery(package, manifest_sha, review_sha, capture_sha)
            self.continuation_guard(b)
            self.check_http(b, after=False)
            self.continuation_guard(b)
            r.need(self.cfg.stage.stat().st_dev == self.cfg.html.stat().st_dev == self.cfg.coord.stat().st_dev,
                   'CAS_REQUIRES_SAME_FILESYSTEM')
            return dict(status='recovery-preflight-passed', productionWrites=0, remainingReloads=list(REMAINING),
                        manifestSha256=manifest_sha, recoveryApprovalSha256=review_sha, captureSha256=capture_sha)

    def complete_recovery(self, package, manifest_sha, review_sha, capture_sha):
        r.need(self.reload_adapter is not r.production_reload and self.api_health_reader is not r.production_api_health,
               'RECOVERY_VERIFIED_ADAPTERS_REQUIRED')
        with r.locked(self.cfg):
            b = self.validate_recovery(package, manifest_sha, review_sha, capture_sha)
            self.continuation_guard(b)
            self.check_http(b, after=False)
            self.continuation_guard(b)
            r.need(self.cfg.stage.stat().st_dev == self.cfg.html.stat().st_dev == self.cfg.coord.stat().st_dev,
                   'CAS_REQUIRES_SAME_FILESYSTEM')
            self.cfg.receipt.mkdir(mode=0o700, exist_ok=True)
            r.fsync_dir(self.cfg.stage)
            common = dict(ownerTask=r.OWNER, scope=SCOPE, originalScope=r.SCOPE, nonce=b['failure']['nonce'],
                originalManifestSha256=OLD_MANIFEST, originalFailureSha256=OLD_FAILURE,
                originalFailurePath=str(self.old_stage/'receipt'/'failure.json'),
                manifestSha256=manifest_sha, recoveryApprovalSha256=review_sha,
                captureSha256=capture_sha, controllerSha256=self.controller_hash,
                alreadyCompleted190NotRepeated=True, remaining3Only=True, noAPIorAssetRewrite=True,
                apiWrites=0, assetWrites=0, envWrites=0, databaseWrites=0, frontHtmlWrites=0)
            r.exclusive(self.cfg.receipt/'attempt.json', r.encode(dict(common, startedAtUtc=r.now())))
            events = []
            self.rolled, self.html_record = {}, None
            closed_record = []
            try:
                for slot in REMAINING:
                    before = next(x for x in self.continuation_guard(b)['processes'] if x['id'] == slot)
                    error = None
                    try:
                        self.reload_adapter(self.cfg, slot, b['m']['afterApiSha256'])
                    except BaseException as exc:
                        error = exc
                    after = next(x for x in self.snapshot()['processes'] if x['id'] == slot)
                    event = dict(id=slot, beforePid=before['pid'], afterPid=after['pid'],
                        beforeRestart=before['restarts'], afterRestart=after['restarts'],
                        beforeRawEnvironSha256=before['rawProcEnvironSha256'],
                        afterRawEnvironSha256=after['rawProcEnvironSha256'],
                        nodeStableRawSha256=after['nodeStableRawSha256'],
                        apiSha256=b['m']['afterApiSha256'], observedPidChange=after['pid'] != before['pid'],
                        transportPassed=error is None, rollback=False)
                    events.append(event)
                    if event['observedPidChange']:
                        self.rolled[slot] = after['pid']
                    self.continuation_guard(b)
                    r.need(event['observedPidChange'] and after['restarts'] == before['restarts'] + 1,
                           'RECOVERY_SINGLE_RELOAD_TRANSITION')
                    if error is not None:
                        raise error
                self.continuation_guard(b)
                def remember(record):
                    self.html_record = record
                    r.need(record['sha256'] == b['m']['afterHtmlSha256'], 'HTML_CAS_POST_HASH')
                r.atomic_cas(self.cfg.html, b['contents']['before-index.html'], b['contents']['after-index.html'],
                    self.cfg.stage, on_replace=remember, expected_record=b['current']['protectedFiles'][str(self.cfg.html)])
                self.check_http(b, after=True)
                final_snap = self.continuation_guard(b)
                state = self.owned(b['coord'], b)
                closed = dict(state['window'], status='closed', outcome='verified-recovered', closedAtUtc=r.now(),
                    needsOperatorRecovery=False, recoveryScope=SCOPE, recoveryApprovalSha256=review_sha,
                    recoveryManifestSha256=manifest_sha, originalFailureSha256=OLD_FAILURE,
                    originalFailurePath=common['originalFailurePath'], processReloads=b['failure']['processReloadEvents'] + events,
                    totalProcessReloads=4, receipt=str(self.cfg.receipt/'receipt.json'))
                state['window'] = closed
                state['shared_release_active'] = False
                if 'needsOperatorRecovery' in state:
                    state['needsOperatorRecovery'] = False
                state.setdefault('window_history', []).append(copy.deepcopy(closed))
                state['updated_at'] = r.now()
                result = dict(common, status='verified-recovered', processReloads=4,
                    originalProcessReloads=1, recoveryProcessReloads=3,
                    processReloadEvents=b['failure']['processReloadEvents'] + events,
                    recoveryProcessReloadEvents=events, adminHtmlWrites=1, processesAfter=final_snap['processes'],
                    otherEightProcessesRawExact=True, currentMetaSha256=r.H(r.encode(final_snap['protectedFiles'])),
                    coordSha256=r.H(r.encode(state)), closedAtUtc=closed['closedAtUtc'])
                # Receipt is durable before close. Success requires BOTH this raw
                # receipt AND actual coordinator bytes matching coordSha256.
                # If close CAS fails, failure.json supersedes this prepared outcome
                # and original window is untouched. Never overwrite either receipt.
                result['verificationRequiresClosedCoordSha256'] = True
                r.exclusive(self.cfg.receipt/'receipt.json', r.encode(result))
                self.continuation_guard(b)
                r.atomic_cas(self.cfg.coord, b['coord'], r.encode(state), self.cfg.stage,
                             expected_record=b['current']['coordRecord'],
                             on_replace=lambda record: closed_record.append(record))
                return result
            except BaseException as exc:
                # Rename may succeed before directory fsync raises. Reopen ONLY
                # our exact recorded closed bytes/META, preserving original nonce
                # and all prior history. Never repair foreign coordinator state.
                reopened = False
                if closed_record:
                    try:
                        r.atomic_cas(self.cfg.coord, r.encode(state), b['coord'], self.cfg.stage,
                                     expected_record=closed_record[-1])
                        reopened = True
                    except BaseException:
                        pass  # report actual state; no retries or blind clearing
                failure = dict(common, status='recovery-required-new-failure-no-retry', needsOperatorRecovery=True,
                    error=type(exc).__name__ + (': ' + str(exc) if isinstance(exc, r.ReleaseError) else ''),
                    recoveryProcessReloadEvents=events,
                    recoveryProcessReloads=sum(e['observedPidChange'] for e in events),
                    processReloads=1 + sum(e['observedPidChange'] for e in events),
                    adminHtmlWrites=int(self.html_record is not None), failedAtUtc=r.now(),
                    coordinationUntouchedOnFailure=not closed_record,
                    ownBlockedWindowReopened=reopened,
                    observedCoordinatorSha256=r.H(r.regular(self.cfg.coord)))
                r.exclusive(self.cfg.receipt/'failure.json', r.encode(failure))
                raise r.ReleaseError('RECOVERY_BLOCKED_NO_RETRY: ' + failure['error']) from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--capture-recovery', action='store_true')
    group.add_argument('--preflight', action='store_true')
    group.add_argument('--complete-recovery', action='store_true')
    parser.add_argument('--original-release', required=True)
    parser.add_argument('--original-controller-sha256', required=True)
    parser.add_argument('--controller-sha256', required=True)
    parser.add_argument('--old-failure-sha256', required=True)
    parser.add_argument('--package')
    parser.add_argument('--capture-sha256')
    parser.add_argument('--manifest-sha256')
    parser.add_argument('--review-sha256')
    args = parser.parse_args()
    r.need(Path(args.original_release).absolute() == Path(__file__).with_name('release.py').absolute()
           and args.original_controller_sha256 == OLD_CONTROLLER, 'EXPLICIT_ORIGINAL_CONTROLLER_PIN')
    load_original(args.original_release, args.original_controller_sha256)
    r.need(args.controller_sha256 == r.H(r.regular(Path(__file__).absolute()))
           and args.old_failure_sha256 == OLD_FAILURE, 'EXPLICIT_RECOVERY_CONTROLLER_FAILURE_PIN')
    cfg = replace(r.production_config(), stage=STAGE)
    c = Recovery(cfg, OLD_STAGE, reload_adapter=r.verified_pm2_reload, api_health_reader=r.verified_front_listener)
    if args.capture_recovery:
        r.need(not any((args.package,args.capture_sha256,args.manifest_sha256,args.review_sha256)), 'CAPTURE_HAS_NO_APPROVAL_ARGS')
        result = c.capture_recovery()
    else:
        r.need(all((args.package,args.capture_sha256,args.manifest_sha256,args.review_sha256)), 'EXACT_RECOVERY_APPROVAL_PINS_REQUIRED')
        operation = c.complete_recovery if args.complete_recovery else c.preflight_recovery
        result = operation(args.package,args.manifest_sha256,args.review_sha256,args.capture_sha256)
    sys.stdout.buffer.write(r.encode(result))


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        print('RECOVERY_ABORT: ' + (str(exc) if isinstance(exc, r.ReleaseError) else type(exc).__name__), file=sys.stderr)
        sys.exit(1)
