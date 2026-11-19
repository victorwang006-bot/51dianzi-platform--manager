#!/usr/bin/env python3
"""Offline only: independent synthetic bindings; no parent manifest or real PM2 is used."""
import copy, importlib.util, json, os, subprocess, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('upload_release', Path(__file__).with_name('release-r2.py'))
r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
REAL_PROCESSES = r.processes
REAL_PM2_EXISTING = r.pm2_existing

class OfflineRelease(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='upload-release-offline-'); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.package = self.root / 'package'; self.package.mkdir()
        releases = self.root / 'opt/releases'; self.front = releases / '20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
        self.public = releases / 'captured-real-admin/admin/dist/public'; self.public.mkdir(parents=True)
        self.coord = self.root / 'opt/ops/coord.json'; self.ops = self.root / 'opt/ops/one-attempt'
        infra = {str(self.root / x.removeprefix('/')) for x in r.INFRA}
        self.lock_paths = [str(self.root / 'locks' / str(i)) for i in range(2)]
        for p in self.lock_paths: self.put(p, b'')
        for name, value in [('RELEASES', releases), ('FRONT', self.front), ('COORD', self.coord), ('OPS', self.ops), ('LOCKS', self.lock_paths), ('INFRA', infra)]:
            p = patch.object(r, name, value); p.start(); self.addCleanup(p.stop)
        self.coord_original = r.encode({'shared_release_active': False, 'window': {'status': 'closed', 'owner_task': 'previous', 'opaque': {'keep': 9}}, 'window_history': [], 'unknown': {'preserve': [1, 2]}, 'arbitrary': 'not-normalized-away'})
        self.put(self.coord, self.coord_original)
        self.old_front = b'const zipFlag = 0;\nfunction appendFile(f) { return f; }\nmodule.exports = { zipFlag, appendFile };\n'
        self.new_front = self.old_front.replace(b'const zipFlag = 0;', b'const zipFlag = 8;').replace(b'function appendFile(f) { return f; }', b'function appendFile(f) { if (!f) return; return f; }')
        self.put(self.front, self.old_front); self.put(self.front.parent / 'public/index.html', b'front-main-backend2-protected')
        self.old_urls = ['/assets/BusinessWorkbenchPage-old-a.js', '/assets/BusinessWorkbenchPage-old-b.js']
        for i, url in enumerate(self.old_urls): self.put(self.public / url[1:], ('export const old=' + str(i) + ';').encode())
        self.put(self.public / 'assets/other.js', b'export const keep = 1;')
        self.put(self.public / 'assets/nested/keep.css', b'body{}')
        for p in infra: self.put(p, b'SYNTHETIC_SECRET_DO_NOT_LOG')
        self.base_procs = []
        front_ids = [1, 4, 8, 12]
        for i in sorted(front_ids + [2, 3, 5, 6, 7, 9, 10, 11]):
            name = 'dianzi51' if i in front_ids else ('dianzi51-admin' if i in [2, 3] else 'worker-' + str(i))
            script = self.front if i in front_ids else (self.public.parent.parent / 'dist/index.js' if name == 'dianzi51-admin' else releases / ('workers/' + name + '.js'))
            if i not in front_ids: self.put(script, b'console.log("protected");')
            self.base_procs.append(dict(id=i, pid=1000+i, name=name, status='online', script=str(script), cwd=str(script.parent), rawEnvSha=r.sha(b'fake-live-env'), configuredEnvSha=r.sha(b'fake-configured-env'), actualEnvEvidence={'sha256': r.sha(b'fake-semantic-env'), 'decodedConfigHash': r.sha(b'fake-child-config'), 'outerHashes': {'TOKEN': r.sha(b'fake-outer')}}))
        self.live = copy.deepcopy(self.base_procs)
        p = patch.object(r, 'processes', side_effect=lambda: copy.deepcopy(self.live)); p.start(); self.addCleanup(p.stop)
        p = patch.object(r, 'pm2_existing', return_value=None); p.start(); self.addCleanup(p.stop)
        self.calls = []; self.reload_count = 0; self.reload_hook = None
        p = patch.object(r.subprocess, 'run', side_effect=self.fake_run); p.start(); self.addCleanup(p.stop)
        self.m = {'schemaVersion': 1, 'ownerTask': r.OWNER, 'scope': r.SCOPE, 'driverSha256': r.H(Path(r.__file__).resolve()), 'baseline': {}, 'backend2Verified': {}, 'replace': [], 'add': [], 'frontEdits': [], 'reloadPmIds': front_ids}
        for kind, target, before, after in [('front-api', self.front, self.old_front, self.new_front)]:
            self.m['replace'].append(self.replace_row(kind, target, before, after))
        for i, old_url in enumerate(self.old_urls):
            data = ('export const customerUploadRetry=' + str(i) + ';').encode(); relative = 'assets/BusinessWorkbenchPage-upload-retry-' + r.sha(data)[:16] + '.js'
            row = self.stage('candidate/asset-' + str(i) + '.js', data); row.update(relative=relative, oldURL=old_url); self.m['add'].append(row)
        self.old_map = {'imports': {'workbench-a': self.old_urls[0], 'workbench-b': self.old_urls[1], 'other': '/assets/other.js'}, 'scopes': {'/assets/': {'scoped-a': self.old_urls[0]}}}
        for i, old_url in enumerate(self.old_urls):
            self.old_map['scopes'][old_url] = {('dependency-' + str(n)): (self.old_urls[n] if n < 2 else '/assets/dependency-' + str(i) + '-' + str(n) + '.js') for n in range(44)}
        raw_before = json.dumps(self.old_map); raw_after = raw_before; rewritten = copy.deepcopy(self.old_map)
        for row in self.m['add']:
            old, new = row['oldURL'], '/' + row['relative']
            raw_after = raw_after.replace(': ' + json.dumps(old), ': ' + json.dumps(new))
            for table in [rewritten['imports'], *rewritten['scopes'].values()]:
                for key, value in table.items():
                    if value == old: table[key] = new
        clones = [json.dumps('/' + row['relative']) + ':' + json.dumps(rewritten['scopes'][row['oldURL']], separators=(',', ':')) for row in self.m['add']]
        raw_after = raw_after[:-2] + ',' + ','.join(clones) + raw_after[-2:]
        prefix, suffix = '<!doctype html><title>unchanged</title><script type="importmap">', '</script><main>preserved</main>'
        self.old_html = (prefix + raw_before + suffix).encode(); self.new_html = (prefix + raw_after + suffix).encode()
        self.put(self.public / 'index.html', self.old_html); self.m['replace'].append(self.replace_row('admin-html', self.public / 'index.html', self.old_html, self.new_html))
        for kind, before, after in [('check-zip-flag', b'const zipFlag = 0;', b'const zipFlag = 8;'), ('appendFile-guard', b'function appendFile(f) { return f; }', b'function appendFile(f) { if (!f) return; return f; }')]:
            row = self.stage('candidate/' + kind + '.fragment', after); start = self.old_front.index(before)
            row.update(kind=kind, start=start, end=start+len(before), beforeSha256=r.sha(before)); self.m['frontEdits'].append(row)
        files = {str(p): r.H(p) for p in [self.front, self.public / 'index.html', self.front.parent / 'public/index.html', *map(Path, infra), *[Path(x['script']) for x in self.base_procs]]}
        assets = {'assets/' + k: v for k, v in r.inventory(self.public / 'assets').items()}
        files.update({str(self.public / k): v for k, v in assets.items()})
        self.b = {'capturedAtUnix': time.time(), 'coordSha256': r.sha(self.coord_original), 'adminPublic': str(self.public), 'frontPublic': str(self.front.parent / 'public'), 'files': files, 'assets': assets, 'processes': copy.deepcopy(self.base_procs)}
        self.proof = {'status': 'verified', 'ownerTask': 'backend2-task-synthetic', 'frontHtmlSha256': files[str(self.front.parent / 'public/index.html')]}
        self.review_overrides = {}; self.seal()
    def put(self, p, data):
        p = Path(p); p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
    def stage(self, source, data):
        self.put(self.package / source, data); return {'source': source, 'sha256': r.sha(data)}
    def replace_row(self, kind, target, before, after):
        row = self.stage('candidate/' + kind, after); self.stage('baseline/' + kind, before)
        row.update(kind=kind, target=str(target), beforeSource='baseline/' + kind, beforeSha256=r.sha(before)); return row
    def html_map(self, html):
        return json.loads(html.split(b'<script type="importmap">', 1)[1].split(b'</script>', 1)[0])
    def candidate_html(self, data):
        row = self.m['replace'][1]; self.put(self.package / row['source'], data); row['sha256'] = r.sha(data); self.seal()
    def relocate_front_public(self):
        alias = self.front.parent / 'public'; actual = self.root / 'opt/releases/captured-real-front/public'
        actual.parent.mkdir(parents=True); alias.rename(actual); alias.symlink_to(actual, target_is_directory=True)
        self.b['files'][str(actual / 'index.html')] = self.b['files'].pop(str(alias / 'index.html'))
        self.b['frontPublic'] = str(actual); self.seal(); return alias, actual
    def seal(self):
        self.m['baseline'] = self.stage('baseline.json', r.encode(self.b))
        self.m['backend2Verified'] = self.stage('backend2-verified.json', r.encode(self.proof)); self.m['backend2Verified']['ownerTask'] = self.proof['ownerTask']
        self.put(self.package / 'manifest.json', r.encode(self.m))
        review = dict(status='passed', independent=True, reviewerTask='independent-synthetic-task', manifestSha256=r.H(self.package / 'manifest.json'), driverSha256=self.m['driverSha256'], baselineSha256=self.m['baseline']['sha256'], backend2VerifiedSha256=self.m['backend2Verified']['sha256'], frontNodesVerified=sorted(r.KINDS))
        review.update(self.review_overrides); self.put(self.package / 'review.json', r.encode(review))
        self.pins = {'manifest': r.H(self.package / 'manifest.json'), 'review': r.H(self.package / 'review.json'), 'baseline': self.m['baseline']['sha256'], 'coord': self.b['coordSha256']}
    def fake_run(self, args, **kwargs):
        self.calls.append(list(args)); self.assertEqual(set(kwargs), {'input', 'stdout', 'stderr', 'timeout'})
        if args in [['node', '--check'], ['node', '--input-type=module', '--check']]:
            self.assertIsInstance(kwargs['input'], bytes); return subprocess.CompletedProcess(args, 0, b'', b'')
        self.assertEqual(args[:2], ['pm2', 'reload']); self.assertEqual(len(args), 3); self.assertIn(int(args[2]), self.m['reloadPmIds'])
        self.reload_count += 1
        if self.reload_hook:
            status = self.reload_hook(args)
            if status: return subprocess.CompletedProcess(args, status, b'', b'SYNTHETIC_SECRET_DO_NOT_LOG')
        for row in self.live:
            if row['id'] == int(args[2]): row['pid'] += 100
        return subprocess.CompletedProcess(args, 0, b'', b'')
    def release(self): return r.Release(self.package, self.pins)
    def apply(self): return self.release().apply(True)
    def state(self): return json.loads(r.read(self.coord))
    def receipt(self): return json.loads(r.read(self.ops / 'receipt.json'))
    def reloads(self): return [c for c in self.calls if c[0] == 'pm2']
    def assert_closed(self, outcome):
        state = self.state(); self.assertIs(state['shared_release_active'], False); self.assertEqual(state['window']['status'], 'closed'); self.assertEqual(state['window']['outcome'], outcome)
        self.assertEqual(state['unknown'], {'preserve': [1, 2]}); self.assertEqual(state['window_history'][0]['opaque'], {'keep': 9})
    def assert_recovery(self, result):
        self.assertEqual(result['status'], 'recovery-required'); self.assertEqual(self.receipt()['status'], 'recovery-required'); self.assertIs(self.state()['shared_release_active'], True)

    def test_success_preflight_apply_verify_and_protections(self):
        self.assertEqual(self.release().readonly('preflight')['writes'], 0); self.assertFalse(self.ops.exists())
        result = self.apply(); self.assertEqual(result['status'], 'verified'); self.assert_closed('verified')
        self.assertEqual(self.reloads(), [['pm2', 'reload', str(i)] for i in self.m['reloadPmIds']])
        self.assertEqual(r.read(self.front), self.new_front); self.assertEqual(r.read(self.public / 'index.html'), self.new_html)
        self.assertEqual(self.release().readonly('verify')['status'], 'verified')
        for p, h in self.b['files'].items():
            if p not in [str(self.front), str(self.public / 'index.html')]: self.assertEqual(r.H(p), h)
        for x in self.base_procs:
            if x['id'] not in self.m['reloadPmIds']: self.assertEqual(x, next(p for p in self.live if p['id'] == x['id']))
        self.assertEqual(sum(c[0] == 'node' for c in self.calls), 9)
        self.assertNotIn('SYNTHETIC_SECRET_DO_NOT_LOG', r.read(self.ops / 'receipt.json').decode())
    def test_readonly_has_no_locks_writes_or_attempt(self):
        before = {p: (p.stat().st_atime_ns, p.stat().st_mtime_ns, p.stat().st_size) for p in [self.coord, self.front, self.public / 'index.html']}
        with patch.object(r, 'locks', side_effect=AssertionError('read-only must not take locks')), patch.object(r, 'exclusive', side_effect=AssertionError('read-only write')):
            self.release().readonly('preflight')
        self.assertEqual(before, {p: (p.stat().st_atime_ns, p.stat().st_mtime_ns, p.stat().st_size) for p in before}); self.assertEqual(self.reloads(), [])
    def test_apply_requires_explicit_parent_authorization(self):
        with self.assertRaisesRegex(RuntimeError, 'PARENT_EXPLICIT'): self.release().apply(False)
        self.assertFalse(self.ops.exists())
    def test_one_apply_no_replay_even_new_baseline(self):
        self.apply()
        self.b['coordSha256'] = r.H(self.coord); self.b['capturedAtUnix'] = time.time(); self.seal()
        with self.assertRaisesRegex(RuntimeError, 'ONE_APPLY_NO_REPLAY'): self.apply()
        self.assertEqual(len(self.reloads()), 4)
    def test_coord_cas_drift_even_whitespace(self):
        self.put(self.coord, self.coord_original + b' ')
        with self.assertRaisesRegex(RuntimeError, 'COORD_CAS_DRIFT'): self.apply()
        self.assertFalse(self.ops.exists()); self.assertEqual(self.reloads(), [])
    def test_busy_foreign_owner_is_not_claimed(self):
        state = self.state(); state.update(shared_release_active=True, window={'owner_task': 'foreign', 'nonce': 'foreign'})
        self.put(self.coord, r.encode(state)); self.b['coordSha256'] = r.H(self.coord); self.seal()
        with self.assertRaisesRegex(RuntimeError, 'FOREIGN_OWNER_OR_BUSY'): self.apply()
        self.assertEqual(self.state(), state); self.assertFalse(self.ops.exists())
    def test_lock_contention_does_not_claim(self):
        with patch.object(r.fcntl, 'flock', side_effect=BlockingIOError('mock busy')):
            with self.assertRaises(BlockingIOError): self.apply()
        self.assertEqual(r.read(self.coord), self.coord_original); self.assertFalse(self.ops.exists())
    def test_stale_baseline_rejected(self):
        self.b['capturedAtUnix'] -= 1801; self.seal()
        with self.assertRaisesRegex(RuntimeError, 'LATEST_BASELINE'): self.apply()
    def test_front_target_cannot_be_admin_api(self):
        self.m['replace'][0]['target'] = next(x['script'] for x in self.base_procs if x['name'] == 'dianzi51-admin'); self.seal()
        with self.assertRaisesRegex(RuntimeError, 'SINGLE_FRONT'): self.apply()
    def test_html_target_cannot_be_front_main(self):
        self.m['replace'][1]['target'] = str(self.front.parent / 'public/index.html'); self.seal()
        with self.assertRaisesRegex(RuntimeError, 'SINGLE_FRONT'): self.apply()
    def test_front_extra_byte_change_rejected(self):
        row = self.m['replace'][0]; self.put(self.package / row['source'], self.new_front + b'// unrelated change'); row['sha256'] = r.H(self.package / row['source']); self.seal()
        with self.assertRaisesRegex(RuntimeError, 'FRONT_EXTRA_CHANGE'): self.apply()
    def test_front_node_overlap_rejected(self):
        self.m['frontEdits'][1]['start'] = 1; self.seal()
        with self.assertRaises(RuntimeError): self.apply()
    def test_html_outside_importmap_change_rejected(self):
        row = self.m['replace'][1]; self.put(self.package / row['source'], self.new_html.replace(b'unchanged', b'changed')); row['sha256'] = r.H(self.package / row['source']); self.seal()
        with self.assertRaisesRegex(RuntimeError, 'HTML_OUTSIDE'): self.apply()
    def test_html_import_key_change_rejected(self):
        row = self.m['replace'][1]; self.put(self.package / row['source'], self.new_html.replace(b'workbench-a', b'new-key')); row['sha256'] = r.H(self.package / row['source']); self.seal()
        with self.assertRaisesRegex(RuntimeError, 'HTML_OUTSIDE'): self.apply()
    def test_html_two_exact_44_scope_clones_pass_values_only(self):
        self.assertEqual(self.release().readonly('preflight')['status'], 'preflight-passed')
        old, new = self.html_map(self.old_html), self.html_map(self.new_html)
        new_urls = ['/' + row['relative'] for row in self.m['add']]
        self.assertEqual(list(new['scopes']), list(old['scopes']) + new_urls)
        changes = dict(zip(self.old_urls, new_urls))
        for key, table in old['scopes'].items():
            self.assertEqual(new['scopes'][key], {name: changes.get(value, value) for name, value in table.items()})
        for old_url, new_url in changes.items():
            self.assertEqual(len(old['scopes'][old_url]), 44)
            self.assertTrue(all(isinstance(value, str) for value in old['scopes'][old_url].values()))
            self.assertEqual(new['scopes'][new_url], new['scopes'][old_url])
        compact = ','.join(json.dumps(url) + ':' + json.dumps(new['scopes'][url], separators=(',', ':')) for url in new_urls).encode()
        self.assertIn(b',' + compact + b'}}</script>', self.new_html); self.assertFalse(self.ops.exists())
    def test_html_third_scope_rejected(self):
        close = self.new_html.index(b'</script>') - 2
        self.candidate_html(self.new_html[:close] + b',"/assets/third-scope.js":{"dependency":"/assets/other.js"}' + self.new_html[close:])
        with self.assertRaisesRegex(RuntimeError, 'HTML_OUTSIDE'): self.apply()
        self.assertFalse(self.ops.exists()); self.assertEqual(self.reloads(), [])
    def test_html_clone_dependency_change_rejected(self):
        before = b'"dependency-2":"/assets/dependency-0-2.js"'; self.assertEqual(self.new_html.count(before), 1)
        self.candidate_html(self.new_html.replace(before, b'"dependency-2":"/assets/foreign.js"'))
        with self.assertRaisesRegex(RuntimeError, 'HTML_OUTSIDE'): self.apply()
        self.assertFalse(self.ops.exists()); self.assertEqual(self.reloads(), [])
    def test_html_old_scope_dependency_change_rejected(self):
        before = b'"dependency-2": "/assets/dependency-0-2.js"'; self.assertEqual(self.new_html.count(before), 1)
        self.candidate_html(self.new_html.replace(before, b'"dependency-2": "/assets/foreign.js"'))
        with self.assertRaisesRegex(RuntimeError, 'HTML_OUTSIDE'): self.apply()
        self.assertFalse(self.ops.exists()); self.assertEqual(self.reloads(), [])
    def test_html_missing_clone_rejected(self):
        for row in self.m['add']:
            with self.subTest(oldURL=row['oldURL']):
                url = '/' + row['relative']; table = self.html_map(self.new_html)['scopes'][url]
                clone = (',' + json.dumps(url) + ':' + json.dumps(table, separators=(',', ':'))).encode()
                self.assertEqual(self.new_html.count(clone), 1); self.candidate_html(self.new_html.replace(clone, b''))
                with self.assertRaisesRegex(RuntimeError, 'HTML_OUTSIDE'): self.apply()
                self.assertFalse(self.ops.exists()); self.assertEqual(self.reloads(), [])
    def test_html_old_scope_keys_cannot_be_replaced(self):
        key = (json.dumps(self.old_urls[0]) + ': {').encode(); self.assertEqual(self.new_html.count(key), 1)
        self.candidate_html(self.new_html.replace(key, b'"/assets/renamed-old-scope.js": {'))
        with self.assertRaisesRegex(RuntimeError, 'HTML_OUTSIDE'): self.apply()
        self.assertFalse(self.ops.exists())
    def test_non_content_addressed_asset_rejected(self):
        self.m['add'][0]['relative'] = 'assets/BusinessWorkbenchPage-guess.js'; self.seal()
        with self.assertRaisesRegex(RuntimeError, 'CONTENT_ADDRESSED'): self.apply()
    def test_existing_asset_collision_rejected(self):
        row = self.m['add'][0]; self.put(self.public / row['relative'], r.read(self.package / row['source']))
        with self.assertRaises(RuntimeError): self.apply()
        self.assertFalse(self.ops.exists())
    def test_all_old_assets_including_non_workbench_protected(self):
        self.put(self.public / 'assets/other.js', b'foreign')
        with self.assertRaisesRegex(RuntimeError, 'PROTECTED_FILE'): self.apply()
    def test_unlisted_asset_rejected(self):
        self.put(self.public / 'assets/new-foreign.js', b'foreign')
        with self.assertRaisesRegex(RuntimeError, 'FULL_OLD_ASSET'): self.apply()
    def test_baseline_env_hash_drift_rejected(self):
        self.live[0]['rawEnvSha'] = r.sha(b'foreign env')
        with self.assertRaisesRegex(RuntimeError, 'PROCESS_IDENTITY_ENV'): self.apply()
    def test_candidate_syntax_checks_all_three(self):
        self.release().readonly('preflight')
        self.assertEqual(self.calls, [['node', '--input-type=module', '--check']] * 3)
    def test_candidate_syntax_failure_rejected(self):
        with patch.object(r.subprocess, 'run', return_value=subprocess.CompletedProcess(['node'], 1, b'', b'secret')):
            with self.assertRaisesRegex(RuntimeError, 'SUBPROCESS_FAILED'): self.apply()
        self.assertFalse(self.ops.exists())
    def test_review_manifest_and_independence_pins_required(self):
        self.review_overrides['independent'] = False; self.seal()
        with self.assertRaisesRegex(RuntimeError, 'INDEPENDENT_REVIEW'): self.apply()
    def test_backend2_must_be_verified_and_front_html_bound(self):
        self.proof['status'] = 'pending'; self.seal()
        with self.assertRaisesRegex(RuntimeError, 'BACKEND2_NOT_VERIFIED'): self.apply()
    def test_pinned_manifest_cannot_be_rewritten(self):
        self.put(self.package / 'manifest.json', r.read(self.package / 'manifest.json') + b' ')
        with self.assertRaisesRegex(RuntimeError, 'STAGE_PIN_DRIFT'): self.release()
    def test_failed_reload_precise_healthy_rollback_closes(self):
        self.reload_hook = lambda args: 1 if self.reload_count == 1 else 0
        result = self.apply(); self.assertEqual(result['status'], 'rolled-back'); self.assert_closed('rolled-back')
        self.assertEqual(r.read(self.front), self.old_front); self.assertEqual(r.read(self.public / 'index.html'), self.old_html)
        self.assertEqual(len(self.reloads()), 5)
        for row in self.m['add']: self.assertTrue((self.public / row['relative']).exists())
    def receipt_failure(self, failure, rollback=False):
        if rollback: self.reload_hook = lambda args: 1 if self.reload_count == 1 else 0
        target = self.ops / 'receipt.json'
        original_exclusive, original_fsync, original_syncdir, original_read = r.exclusive, r.os.fsync, r.syncdir, r.read
        def exclusive(path, data, mode=0o600):
            if failure == 'write' and Path(path) == target: raise OSError('synthetic receipt write failure')
            return original_exclusive(path, data, mode)
        def fsync(fd):
            if failure == 'fsync' and os.readlink('/proc/self/fd/' + str(fd)) == str(target): raise OSError('synthetic receipt fsync failure')
            return original_fsync(fd)
        def syncdir(path):
            if failure == 'dirsync' and Path(path) == self.ops and target.exists(): raise OSError('synthetic receipt directory fsync failure')
            return original_syncdir(path)
        def read(path):
            if failure == 'readback' and Path(path) == target: raise OSError('synthetic receipt readback failure')
            return original_read(path)
        with patch.object(r, 'exclusive', side_effect=exclusive), patch.object(r.os, 'fsync', side_effect=fsync), patch.object(r, 'syncdir', side_effect=syncdir), patch.object(r, 'read', side_effect=read):
            result = self.apply()
        self.assertEqual(result['status'], 'recovery-required'); self.assertIs(result['receiptPersistenceUnconfirmed'], True)
        self.assertIs(self.state()['shared_release_active'], True); self.assertEqual(self.state()['window']['status'], 'recovery-required')
        self.assertEqual(r.read(self.front), self.old_front); self.assertEqual(r.read(self.public / 'index.html'), self.old_html)
        self.assertFalse(any(w.get('owner_task') == r.OWNER and w.get('status') == 'closed' for w in self.state()['window_history']))
        with self.assertRaises(Exception): self.release().readonly('verify')
    def test_success_receipt_write_failure_holds_window(self): self.receipt_failure('write')
    def test_success_receipt_fsync_failure_holds_window(self): self.receipt_failure('fsync')
    def test_success_receipt_directory_fsync_failure_holds_window(self): self.receipt_failure('dirsync')
    def test_success_receipt_readback_failure_holds_window(self): self.receipt_failure('readback')
    def test_rollback_receipt_write_failure_holds_window(self): self.receipt_failure('write', True)
    def test_rollback_receipt_fsync_failure_holds_window(self): self.receipt_failure('fsync', True)
    def test_rollback_receipt_directory_fsync_failure_holds_window(self): self.receipt_failure('dirsync', True)
    def test_rollback_receipt_readback_failure_holds_window(self): self.receipt_failure('readback', True)
    def test_persistent_coord_directory_fsync_failure_restores_visible_recovery_hold(self):
        original = r.syncdir; failing = False
        def syncdir(path):
            nonlocal failing
            state = self.state()
            if Path(path) == self.coord.parent and (failing or state.get('window', {}).get('owner_task') == r.OWNER and state['window']['status'] == 'closed'):
                failing = True; raise OSError('persistent coordination directory fsync failure')
            return original(path)
        with patch.object(r, 'syncdir', side_effect=syncdir): result = self.apply()
        self.assertTrue(failing); self.assert_recovery(result)
        self.assertEqual(self.state()['window']['status'], 'recovery-required')
        self.assertIs(result['coordReopenDurabilityUnconfirmed'], True)
        self.assertEqual(r.read(self.front), self.old_front); self.assertEqual(r.read(self.public / 'index.html'), self.old_html)
        self.assertEqual(len(self.reloads()), 8)
    def test_visible_compensation_never_overwrites_foreign_bytes(self):
        target = self.root / 'compensation'; self.put(target, b'closed'); original = r.os.fsync
        def race(fd):
            original(fd)
            if '.upload-recovery-' in os.readlink('/proc/self/fd/' + str(fd)): self.put(target, b'foreign')
        with patch.object(r.os, 'fsync', side_effect=race):
            with self.assertRaisesRegex(RuntimeError, 'REOPEN_LAST_MOMENT_CAS'): r.reopen_visible(target, b'closed', b'owned')
        self.assertEqual(r.read(target), b'foreign')
    def test_visible_compensation_keeps_file_metadata(self):
        target = self.root / 'compensation'; self.put(target, b'closed'); target.chmod(0o640)
        self.assertIs(r.reopen_visible(target, b'closed', b'owned'), False)
        self.assertEqual(r.read(target), b'owned'); self.assertEqual(target.stat().st_mode & 0o777, 0o640)
    def test_foreign_front_bytes_are_never_overwritten(self):
        def fail(args):
            self.put(self.front, b'foreign-owner-code'); return 1
        self.reload_hook = fail; result = self.apply(); self.assert_recovery(result)
        self.assertEqual(r.read(self.front), b'foreign-owner-code'); self.assertIn(str(self.front), result['foreignFilesNotTouched']); self.assertEqual(len(self.reloads()), 1)
    def test_foreign_html_preserved_but_own_front_restored(self):
        def drift(args):
            if self.reload_count == 4: self.put(self.public / 'index.html', b'foreign-admin-html')
            return 0
        self.reload_hook = drift; result = self.apply(); self.assert_recovery(result)
        self.assertEqual(r.read(self.front), self.old_front); self.assertEqual(r.read(self.public / 'index.html'), b'foreign-admin-html')
    def test_restored_but_unhealthy_keeps_shared_true(self):
        def fail(args):
            self.live[0]['status'] = 'errored'; return 1
        self.reload_hook = fail; result = self.apply(); self.assert_recovery(result)
        self.assertEqual(r.read(self.front), self.old_front); self.assertEqual(self.state()['window']['status'], 'recovery-required')
    def test_ownership_loss_never_rolls_back_or_closes_foreign_window(self):
        def steal(args):
            state = self.state(); state['window']['owner_task'] = 'foreign'; state['window']['nonce'] = 'foreign'; state['external'] = 'preserve'
            self.put(self.coord, r.encode(state)); return 1
        self.reload_hook = steal; result = self.apply(); self.assert_recovery(result)
        self.assertEqual(self.state()['window']['owner_task'], 'foreign'); self.assertEqual(r.read(self.front), self.new_front); self.assertEqual(len(self.reloads()), 1)
    def test_unrelated_process_drift_cannot_be_hidden_by_front_reload(self):
        def drift(args):
            self.live[1]['pid'] += 10; return 0
        self.reload_hook = drift; result = self.apply(); self.assert_recovery(result)
        self.assertEqual(r.read(self.front), self.old_front); self.assertEqual(len(self.reloads()), 1)
    def test_cas_last_moment_change_is_not_overwritten(self):
        target = self.root / 'cas-target'; self.put(target, b'before'); original = r.exclusive
        def race(p, data, mode=0o600):
            original(p, data, mode)
            if Path(p).name.startswith('.upload-'): self.put(target, b'foreign')
        with patch.object(r, 'exclusive', side_effect=race):
            with self.assertRaisesRegex(RuntimeError, 'LAST_MOMENT_CAS'): r.cas(target, b'before', b'after')
        self.assertEqual(r.read(target), b'foreign')
    def test_noatime_read_and_symlink_refusal(self):
        p = self.root / 'noatime'; self.put(p, b'read'); os.utime(p, ns=(1_000_000_000, time.time_ns()))
        atime = p.stat().st_atime_ns; self.assertEqual(r.read(p), b'read'); self.assertEqual(p.stat().st_atime_ns, atime)
        link = self.root / 'symlink'; link.symlink_to(p)
        with self.assertRaisesRegex(RuntimeError, 'PATH_SYMLINK'): r.read(link)
    def test_both_locks_held_for_reload_and_recovery(self):
        held = []
        def flock(fd, flag):
            self.assertEqual(flag, r.fcntl.LOCK_EX | r.fcntl.LOCK_NB); held.append(fd)
        def inspect(args):
            self.assertEqual(len(held), 2)
            for fd in held: os.fstat(fd)
            return 1 if self.reload_count == 1 else 0
        self.reload_hook = inspect
        with patch.object(r.fcntl, 'flock', side_effect=flock): self.assertEqual(self.apply()['status'], 'rolled-back')
        for fd in held:
            with self.assertRaises(OSError): os.fstat(fd)
    def test_process_capture_only_hashes_environment(self):
        secret = b'TOKEN=SYNTHETIC_SECRET_DO_NOT_LOG\x00'
        row = {'pm_id': 3, 'pid': 12345, 'name': 'dianzi51', 'pm2_env': {'status': 'online', 'pm_exec_path': str(self.front), 'pm_cwd': str(self.front.parent), 'env': {'TOKEN': 'SYNTHETIC_SECRET_DO_NOT_LOG'}}}
        def mocked_read(path):
            self.assertEqual(str(path), '/proc/12345/environ'); return secret
        with patch.object(r, 'run', return_value=r.encode([row])) as mocked_run, patch.object(r, 'read', side_effect=mocked_read):
            result = REAL_PROCESSES()
        mocked_run.assert_called_once_with(['pm2', 'jlist'])
        self.assertEqual(result[0]['rawEnvSha'], r.sha(secret)); self.assertNotIn('SYNTHETIC_SECRET_DO_NOT_LOG', r.encode(result).decode())
    def test_duplicate_json_coord_rejected_without_losing_fields(self):
        raw = b'{"shared_release_active":true,"shared_release_active":false}'
        self.put(self.coord, raw); self.b['coordSha256'] = r.sha(raw); self.seal()
        with self.assertRaisesRegex(RuntimeError, 'DUPLICATE_JSON_FIELD'): self.apply()
        self.assertEqual(r.read(self.coord), raw); self.assertFalse(self.ops.exists())
    def test_exact_file_mode_preserved(self):
        self.front.chmod(0o750); self.apply(); self.assertEqual(self.front.stat().st_mode & 0o777, 0o750)
    def test_admin_public_must_be_real_not_symlink(self):
        link = self.root / 'opt/releases/linked-admin'; link.symlink_to(self.public.parent.parent, target_is_directory=True)
        self.b['adminPublic'] = str(link / 'dist/public'); self.seal()
        with self.assertRaisesRegex(RuntimeError, 'PATH_SYMLINK'): self.apply()
    def test_actual_front_public_realpath_protected_old_alias_never_read(self):
        alias, actual = self.relocate_front_public(); original = r.read; info = alias.lstat()
        def no_alias_read(path):
            self.assertFalse(Path(path).is_relative_to(alias), 'old symlink alias must never be read')
            return original(path)
        with patch.object(r, 'read', side_effect=no_alias_read):
            self.assertEqual(self.release().readonly('preflight')['status'], 'preflight-passed')
            self.assertEqual(self.apply()['status'], 'verified'); self.assertEqual(self.release().readonly('verify')['status'], 'verified')
        self.assertEqual(r.H(actual / 'index.html'), self.proof['frontHtmlSha256'])
        self.assertEqual(alias.readlink(), actual); self.assertEqual(alias.lstat().st_ino, info.st_ino)
        self.assertEqual(alias.lstat().st_mtime_ns, info.st_mtime_ns); self.assert_closed('verified')
    def test_actual_front_html_drift_rejected_with_old_alias_symlink(self):
        alias, actual = self.relocate_front_public(); self.put(actual / 'index.html', b'foreign-front-html')
        with self.assertRaisesRegex(RuntimeError, 'PROTECTED_FILE'): self.apply()
        self.assertTrue(alias.is_symlink()); self.assertFalse(self.ops.exists()); self.assertEqual(self.reloads(), [])
    def test_old_front_public_alias_cannot_be_baseline_front_public(self):
        alias, _ = self.relocate_front_public(); self.b['frontPublic'] = str(alias); self.seal()
        with self.assertRaisesRegex(RuntimeError, 'PATH_SYMLINK'): self.apply()
        self.assertFalse(self.ops.exists()); self.assertEqual(self.reloads(), [])
    def test_actual_front_html_must_be_listed_not_old_alias(self):
        alias, actual = self.relocate_front_public()
        self.b['files'][str(alias / 'index.html')] = self.b['files'].pop(str(actual / 'index.html')); self.seal()
        with self.assertRaises(KeyError): self.apply()
        self.assertFalse(self.ops.exists()); self.assertEqual(self.reloads(), [])
    def test_front_public_cannot_overlap_admin_public(self):
        self.b['frontPublic'] = str(self.public); self.proof['frontHtmlSha256'] = self.b['files'][str(self.public / 'index.html')]; self.seal()
        with self.assertRaisesRegex(RuntimeError, 'PUBLIC_SCOPE_OVERLAP'): self.apply()
        self.assertFalse(self.ops.exists())
    def test_replace_kind_target_cannot_be_swapped(self):
        a, b = self.m['replace']; a['target'], b['target'] = b['target'], a['target']; self.seal()
        with self.assertRaisesRegex(RuntimeError, 'TARGET_ROLE_BINDING'): self.apply()
    def test_after_both_switches_failure_restores_only_exact_own_bytes(self):
        original = r.Release.check; failed = False
        def check(release, *args, **kwargs):
            nonlocal failed
            if not failed and r.read(self.public / 'index.html') == self.new_html:
                failed = True; raise RuntimeError('MOCK_FINAL_VERIFICATION_FAIL')
            return original(release, *args, **kwargs)
        with patch.object(r.Release, 'check', new=check): result = self.apply()
        self.assertEqual(result['status'], 'rolled-back'); self.assert_closed('rolled-back')
        self.assertEqual(set(result['ownFilesRestored']), {str(self.front), str(self.public / 'index.html')})
        self.assertEqual(r.read(self.front), self.old_front); self.assertEqual(r.read(self.public / 'index.html'), self.old_html)
        self.assertEqual(len(self.reloads()), 8)
    def test_rollback_reload_failure_does_not_close_window(self):
        self.reload_hook = lambda args: 1
        result = self.apply(); self.assert_recovery(result)
        self.assertEqual(r.read(self.front), self.old_front); self.assertEqual(self.state()['window']['status'], 'recovery-required')
        self.assertEqual(len(self.reloads()), 2)
    def test_missing_pm2_daemon_does_not_invoke_cli(self):
        with patch.object(r, 'pm2_existing', side_effect=RuntimeError('PM2_DAEMON_REQUIRED')), patch.object(r.subprocess, 'run') as command:
            with self.assertRaisesRegex(RuntimeError, 'PM2_DAEMON_REQUIRED'): r.run(['pm2', 'jlist'])
        command.assert_not_called()
    def test_pm2_daemon_read_guard_contains_no_start_operation(self):
        with patch.dict(os.environ, {'PM2_HOME': '/root/.pm2'}), patch.object(r, 'read', side_effect=[b'24680\n', b'PM2 God Daemon']), patch.object(r.os, 'kill') as kill, patch.object(r.Path, 'is_socket', return_value=True), patch.object(r.Path, 'is_symlink', return_value=False):
            REAL_PM2_EXISTING()
        kill.assert_called_once_with(24680, 0)
    def test_non_regular_read_cannot_block_on_fifo(self):
        p = self.root / 'foreign-fifo'; os.mkfifo(p)
        with self.assertRaisesRegex(RuntimeError, 'NOT_REGULAR_FILE'): r.read(p)
    def test_empty_reviewer_identity_is_not_independent_review(self):
        self.review_overrides['reviewerTask'] = ''; self.seal()
        with self.assertRaisesRegex(RuntimeError, 'INDEPENDENT_REVIEW'): self.apply()
    def test_binding_schema_json_references_patterns_and_fixture_shape(self):
        schema = json.loads(r.read(Path(__file__).with_name('binding.schema.json').resolve()))
        self.assertEqual(schema['$schema'], 'https://json-schema.org/draft/2020-12/schema')
        def walk(node):
            if isinstance(node, dict):
                if '$ref' in node:
                    value = schema
                    for key in node['$ref'].removeprefix('#/').split('/'): value = value[key]
                if 'pattern' in node: r.re.compile(node['pattern'])
                for value in node.values(): walk(value)
            elif isinstance(node, list):
                for value in node: walk(value)
        walk(schema)
        for name, data in [('manifest', self.m), ('baseline', self.b), ('review', json.loads(r.read(self.package / 'review.json'))), ('backend2Verified', self.proof)]:
            shape = schema['$defs'][name]
            self.assertTrue(set(shape['required']) <= set(data)); self.assertTrue(set(data) <= set(shape['properties']))
        absolute = schema['$defs']['absolute']['pattern']
        for p in ['/../escape', '/a/../escape']: self.assertIsNone(r.re.match(absolute, p))
        self.assertIsNotNone(r.re.match(absolute, '/opt/releases/real/file'))
    def test_each_front_node_must_change_without_empty_deletion(self):
        row = self.m['frontEdits'][0]
        for fragment in [self.old_front[row['start']:row['end']], b'']:
            with self.subTest(fragmentBytes=len(fragment)):
                self.put(self.package / row['source'], fragment); row['sha256'] = r.sha(fragment); self.seal()
                with self.assertRaisesRegex(RuntimeError, 'FRONT_NODE_NOOP_OR_DELETE'): self.apply()
        self.assertFalse(self.ops.exists())
    def test_two_new_assets_require_distinct_content_hashes(self):
        first, second = self.m['add']; data = r.read(self.package / first['source'])
        self.put(self.package / second['source'], data); second['sha256'] = r.sha(data)
        second['relative'] = 'assets/BusinessWorkbenchPage-distinct-name-' + r.sha(data)[:16] + '.js'; self.seal()
        with self.assertRaisesRegex(RuntimeError, 'ASSET_UNIQUENESS'): self.apply()


    def target(self): return next(p for p in self.live if p['id'] in self.m['reloadPmIds'])
    def seed_candidates(self, wrong=False):
        for row in self.m['add']:
            data = b'wrong' if wrong else r.read(self.package / row['source']); p = self.public / row['relative']
            self.put(p, data); self.b['assets'][row['relative']] = r.sha(data); self.b['files'][str(p)] = r.sha(data)
        self.seal()
    def test_r2_four_targets_raw_and_pid_only_allowed_rolling(self):
        release = self.release(); release.validate()
        for p in self.live:
            if p['id'] in self.m['reloadPmIds']: p['pid'] += 10; p['rawEnvSha'] = r.sha(b'runtime-order')
        release.check(rolling=True)
    def test_r2_reload_raw_drift_apply_and_verify(self):
        def drift(args): next(p for p in self.live if p['id'] == int(args[2]))['rawEnvSha'] = r.sha(b'runtime-order')
        self.reload_hook = drift
        self.assertEqual(self.apply()['status'], 'verified'); self.assert_closed('verified')
        self.assertEqual(self.release().readonly('verify')['status'], 'verified'); self.assertEqual(len(self.reloads()), 4)
    def test_r2_actual_business_semantic_drift_rejected(self):
        release = self.release(); release.validate(); self.target()['actualEnvEvidence']['sha256'] = r.sha(b'business')
        with self.assertRaisesRegex(RuntimeError, 'PROCESS_IDENTITY_ENV'): release.check(rolling=True)
    def test_r2_decoded_child_drift_rejected(self):
        release = self.release(); release.validate(); self.target()['actualEnvEvidence']['decodedConfigHash'] = r.sha(b'child')
        with self.assertRaisesRegex(RuntimeError, 'PROCESS_IDENTITY_ENV'): release.check(rolling=True)
    def test_r2_unknown_outer_value_added_or_removed_rejected(self):
        release = self.release(); release.validate(); original = copy.deepcopy(self.live)
        for outer in [{'TOKEN': r.sha(b'changed')}, {'TOKEN': r.sha(b'fake-outer'), 'UNKNOWN': r.sha(b'new')}, {}]:
            with self.subTest(outer=outer):
                self.live = copy.deepcopy(original); self.target()['actualEnvEvidence']['outerHashes'] = outer
                with self.assertRaisesRegex(RuntimeError, 'PROCESS_IDENTITY_ENV'): release.check(rolling=True)
    def test_r2_all_target_identity_fields_and_configured_env_strict(self):
        release = self.release(); release.validate(); original = copy.deepcopy(self.live)
        for key in ['id', 'name', 'status', 'script', 'cwd', 'configuredEnvSha', 'unknownIdentity']:
            with self.subTest(key=key):
                self.live = copy.deepcopy(original); p = self.target(); p[key] = 999 if key == 'id' else 'changed'
                with self.assertRaises(RuntimeError): release.check(rolling=True)
    def test_r2_nonrolling_raw_drift_rejected(self):
        release = self.release(); release.validate(); self.target()['rawEnvSha'] = r.sha(b'raw')
        with self.assertRaisesRegex(RuntimeError, 'PROCESS_IDENTITY_ENV'): release.check()
    def test_r2_each_eight_nontarget_raw_drift_still_rejected(self):
        release = self.release(); release.validate(); original = copy.deepcopy(self.live)
        ids = [p['id'] for p in self.live if p['id'] not in self.m['reloadPmIds']]; self.assertEqual(len(ids), 8)
        for i in ids:
            with self.subTest(id=i):
                self.live = copy.deepcopy(original); next(p for p in self.live if p['id'] == i)['rawEnvSha'] = r.sha(b'raw')
                with self.assertRaisesRegex(RuntimeError, 'PROCESS_IDENTITY_ENV'): release.check(rolling=True)
    def test_r2_preexisting_exact_assets_accept_nooverwrite(self):
        self.seed_candidates(); targets = {self.public / row['relative'] for row in self.m['add']}; original = r.exclusive
        before = {p: (p.stat().st_ino, p.stat().st_mtime_ns, p.stat().st_ctime_ns, r.read(p)) for p in targets}
        def exclusive(p, data, mode=0o600):
            self.assertNotIn(Path(p), targets); return original(p, data, mode)
        with patch.object(r, 'exclusive', side_effect=exclusive):
            self.assertEqual(self.release().readonly('preflight')['status'], 'preflight-passed')
            self.assertEqual(self.apply()['status'], 'verified'); self.assertEqual(self.release().readonly('verify')['status'], 'verified')
        self.assertEqual(before, {p: (p.stat().st_ino, p.stat().st_mtime_ns, p.stat().st_ctime_ns, r.read(p)) for p in targets})
    def test_r2_preexisting_wronghash_reject_nooverwrite(self):
        self.seed_candidates(wrong=True)
        with self.assertRaisesRegex(RuntimeError, 'ADDITIVE_COLLISION'): self.release().readonly('preflight')
        with self.assertRaisesRegex(RuntimeError, 'ADDITIVE_COLLISION'): self.apply()
        for row in self.m['add']: self.assertEqual(r.read(self.public / row['relative']), b'wrong')
        self.assertFalse(self.ops.exists()); self.assertEqual(self.reloads(), [])
    def test_r2_preexisting_does_not_weaken_oldasset_protection(self):
        self.seed_candidates(); self.put(self.public / self.old_urls[0][1:], b'changed')
        with self.assertRaisesRegex(RuntimeError, 'PROTECTED_FILE'): self.apply()
    def test_r2_preexisting_candidate_still_baseline_protected(self):
        self.seed_candidates(); self.put(self.public / self.m['add'][0]['relative'], b'changed')
        with self.assertRaisesRegex(RuntimeError, 'PROTECTED_FILE'): self.apply()
    def test_r2_latest_process_file_coord_checked_before_full_coord_cas(self):
        original = r.exclusive
        def drift(p, data, mode=0o600):
            original(p, data, mode)
            if Path(p) == self.ops / 'coord-owned.json': self.target()['rawEnvSha'] = r.sha(b'late')
        with patch.object(r, 'exclusive', side_effect=drift): result = self.apply()
        self.assertEqual(result['status'], 'recovery-required'); self.assertEqual(r.read(self.coord), self.coord_original)
        self.assertEqual(r.read(self.front), self.old_front); self.assertEqual(self.reloads(), [])
    def test_r2_latest_file_drift_checked_before_coord_cas(self):
        original = r.exclusive
        def drift(p, data, mode=0o600):
            original(p, data, mode)
            if Path(p) == self.ops / 'coord-owned.json': self.put(self.public / 'assets/other.js', b'late')
        with patch.object(r, 'exclusive', side_effect=drift): result = self.apply()
        self.assertEqual(result['status'], 'recovery-required'); self.assertEqual(r.read(self.coord), self.coord_original)
        self.assertEqual(r.read(self.front), self.old_front); self.assertEqual(self.reloads(), [])
    def test_r2_latest_foreign_hold_never_claimed(self):
        original = r.exclusive; foreign = r.encode({'shared_release_active': True, 'window': {'owner_task': 'foreign', 'nonce': 'new-hold'}})
        def drift(p, data, mode=0o600):
            original(p, data, mode)
            if Path(p) == self.ops / 'coord-owned.json': self.put(self.coord, foreign)
        with patch.object(r, 'exclusive', side_effect=drift): result = self.apply()
        self.assertEqual(result['status'], 'recovery-required'); self.assertEqual(r.read(self.coord), foreign)
        self.assertEqual(r.read(self.front), self.old_front); self.assertEqual(self.reloads(), [])

class ActualEnvironmentNormalization(unittest.TestCase):
    def config(self):
        return {'env': {'TOKEN': 'SYNTHETIC_SECRET_DO_NOT_LOG', 'BUSINESS': 'safe', 'unique_id': 'old'}, 'BUSINESS_TOP': 'top',
                'status': 'online', 'pm_exec_path': '/example/index.js', 'pm_cwd': '/example', 'pm_uptime': 123, 'log_date_format': 'old', 'unique_id': 'old'}
    def raw(self, config=None, compact=True):
        return b'TOKEN=SYNTHETIC_SECRET_DO_NOT_LOG\0UNKNOWN_OUTER=unchanged\0pm2_env=' + json.dumps(self.config() if config is None else config, separators=(',', ':') if compact else None).encode() + b'\0NODE_CHANNEL_FD=5\0'
    def evidence(self, raw, config=None): return r.actual_proc_environment(raw, r.config_hash(self.config() if config is None else config))
    def test_runtime_order_log_time_and_volatile_normalized_only(self):
        a = self.config(); b = dict(reversed(list(a.items()))); b['env'] = dict(reversed(list(a['env'].items())))
        b['env']['unique_id'] = 'new'; b.update(pm_uptime=9999, log_date_format='new', unique_id='new')
        ra, rb = self.raw(a), self.raw(b, compact=False); ea, eb = self.evidence(ra, a), self.evidence(rb, b)
        self.assertNotEqual(r.sha(ra), r.sha(rb)); self.assertNotEqual(ea['legacyRawSha256'], eb['legacyRawSha256'])
        for key in ['sha256', 'decodedConfigHash', 'outerHashes']: self.assertEqual(ea[key], eb[key])
    def test_actual_business_change_not_normalized_away(self):
        a = self.config(); b = copy.deepcopy(a); b['env']['BUSINESS'] = 'changed'
        self.assertNotEqual(r.config_hash(a), r.config_hash(b)); self.assertNotEqual(self.evidence(self.raw(a), a)['sha256'], self.evidence(self.raw(b), b)['sha256'])
    def test_uppercase_top_config_change_not_normalized_away(self):
        a = self.config(); b = copy.deepcopy(a); b['BUSINESS_TOP'] = 'changed'; self.assertNotEqual(r.config_hash(a), r.config_hash(b))
    def test_unknown_outer_change_not_normalized_away(self):
        a = self.evidence(self.raw()); b = self.evidence(self.raw().replace(b'UNKNOWN_OUTER=unchanged', b'UNKNOWN_OUTER=changed'))
        self.assertNotEqual(a['sha256'], b['sha256']); self.assertNotEqual(a['outerHashes'], b['outerHashes'])
    def test_daemon_child_mismatch_rejected(self):
        b = self.config(); b['env']['BUSINESS'] = 'child-changed'
        with self.assertRaisesRegex(RuntimeError, 'ACTUAL_CHILD_DAEMON_CONFIG_MISMATCH'): self.evidence(self.raw(b))
    def test_duplicate_raw_env_keys_even_volatile_rejected(self):
        for key in [b'TOKEN', b'NODE_CHANNEL_FD', b'pm2_env']:
            with self.subTest(key=key):
                with self.assertRaisesRegex(RuntimeError, 'DUPLICATE_OUTER_KEY'): self.evidence(self.raw() + key + b'=duplicate\0')
    def test_duplicate_decoded_json_keys_rejected(self):
        for child in [b'{"env":{},"env":{}}', b'{"env":{"TOKEN":"one","TOKEN":"two"}}']:
            with self.subTest(child=child):
                with self.assertRaisesRegex(RuntimeError, 'DUPLICATE_JSON_KEY'): self.evidence(b'pm2_env=' + child + b'\0')
    def test_nonfinite_json_values_rejected(self):
        for value in [b'NaN', b'Infinity', b'-Infinity', b'1e9999', b'-1e9999']:
            with self.subTest(value=value):
                with self.assertRaisesRegex(RuntimeError, 'NONFINITE_JSON'): self.evidence(b'pm2_env={"env":{"BAD":' + value + b'}}\0')
    def test_malformed_raw_env_rejected(self):
        for raw in [b'', b'A=x', b'NOVALUE\0', b'=empty-name\0', b'A=x\0\0']:
            with self.subTest(raw=raw):
                with self.assertRaises(RuntimeError): self.evidence(raw)
    def test_without_pm2_env_retains_all_outer_hashes(self):
        ev = self.evidence(b'A=1\0UNKNOWN=2\0NODE_CHANNEL_FD=8\0')
        self.assertIsNone(ev['decodedConfigHash']); self.assertEqual(ev['sha256'], r.sha(b'A=1\0UNKNOWN=2\0'))
        self.assertEqual(ev['outerHashes'], {'A': r.sha(b'1'), 'UNKNOWN': r.sha(b'2')})
    def test_processes_use_actual_config_hash_not_configured_env_sha(self):
        config = self.config(); raw = self.raw(config); row = {'pm_id': 190, 'pid': 12345, 'name': 'dianzi51', 'pm2_env': config}
        with patch.object(r, 'run', return_value=r.encode([row])) as run, patch.object(r, 'read', return_value=raw) as read: result = REAL_PROCESSES()
        run.assert_called_once_with(['pm2', 'jlist']); read.assert_called_once_with(Path('/proc/12345/environ'))
        p = result[0]; self.assertEqual(p['rawEnvSha'], r.sha(raw)); self.assertEqual(p['configuredEnvSha'], r.sha(r.encode(config['env'])))
        self.assertNotEqual(p['configuredEnvSha'], r.config_hash(config)); self.assertEqual(p['actualEnvEvidence']['decodedConfigHash'], r.config_hash(config))
        self.assertEqual(set(p['actualEnvEvidence']), {'sha256', 'decodedConfigHash', 'outerHashes'})
        self.assertNotIn('SYNTHETIC_SECRET_DO_NOT_LOG', r.encode(result).decode())
    def test_processes_reject_actual_child_mismatch(self):
        config = self.config(); child = copy.deepcopy(config); child['env']['TOKEN'] = 'changed'
        row = {'pm_id': 190, 'pid': 12345, 'name': 'dianzi51', 'pm2_env': config}
        with patch.object(r, 'run', return_value=r.encode([row])), patch.object(r, 'read', return_value=self.raw(child)):
            with self.assertRaisesRegex(RuntimeError, 'ACTUAL_CHILD_DAEMON_CONFIG_MISMATCH'): REAL_PROCESSES()
    def test_processes_reject_duplicate_daemon_json(self):
        with patch.object(r, 'run', return_value=b'[{"pm_id":1,"pm_id":2}]'), patch.object(r, 'read') as read:
            with self.assertRaisesRegex(RuntimeError, 'DUPLICATE_JSON_KEY'): REAL_PROCESSES()
        read.assert_not_called()
    def test_processes_reject_nonfinite_daemon_json(self):
        with patch.object(r, 'run', return_value=b'[{"pm_id":NaN}]'), patch.object(r, 'read') as read:
            with self.assertRaisesRegex(RuntimeError, 'NONFINITE_JSON'): REAL_PROCESSES()
        read.assert_not_called()

if __name__ == '__main__': unittest.main(verbosity=2)
