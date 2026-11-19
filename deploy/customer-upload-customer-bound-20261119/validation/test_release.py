#!/usr/bin/env python3
"""Offline tests: every writable path is below TemporaryDirectory.
No SSH/network/real production absolute path access. PM2 reload is injected mock only.
Run PYTHONDONTWRITEBYTECODE=1 python3 -B test_release.py -v.
"""
import base64
import copy
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from dataclasses import replace
from unittest.mock import patch

LOCAL_RUN = subprocess.run  # used only for isolated Node VM with fully fake fs/RPC/process

SPEC = importlib.util.spec_from_file_location('customer_bound_release', Path(__file__).with_name('release.py'))
r = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = r
SPEC.loader.exec_module(r)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='compact-release-offline-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.cfg = r.Config(public=self.root/'admin-public', front=self.root/'front-public',
            coord=self.root/'ops'/'coord.json', stage=self.root/'ops'/'stage',
            locks=(self.root/'locks'/'public.lock', self.root/'locks'/'code.lock'),
            nginx=self.root/'nginx', ops=self.root/'ops', proc=self.root/'proc',
            api=self.root/'runtime'/'front'/'dist'/'index.js')
        for p in [self.cfg.public/'assets', self.cfg.front/'assets', self.cfg.nginx,
                  self.cfg.ops, self.cfg.stage, self.cfg.package, self.root/'locks', self.cfg.proc]:
            p.mkdir(parents=True, exist_ok=True)
        self.cfg.stage.chmod(0o700)
        self.cfg.package.chmod(0o700)
        for p in self.cfg.locks:
            p.write_bytes(b'existing lock inode\n')
        self.before = (b'<!doctype html><html><head>\n<script type="importmap">'
            b'{"workbench":"/assets/BusinessWorkbenchPage-old-main.js",'
            b'"customer":"/assets/BusinessWorkbenchPage-old-customer.js"}'
            b'</script>\n</head><body>UNCHANGED CUSTOMER AND CHANNEL</body></html>\n')
        self.cfg.html.write_bytes(self.before)
        (self.cfg.public/'assets'/'BusinessWorkbenchPage-old-main.js').write_bytes(b'old main')
        (self.cfg.public/'assets'/'BusinessWorkbenchPage-old-customer.js').write_bytes(b'old customer')
        (self.cfg.public/'favicon.ico').write_bytes(b'favicon original')
        (self.cfg.front/'index.html').write_bytes(b'task2 already online: never rollback')
        (self.cfg.front/'assets'/'task2.js').write_bytes(b'task2 official card original')
        (self.cfg.nginx/'nginx.conf').write_bytes(b'private opaque nginx configuration')
        (self.cfg.nginx/'enabled.conf').symlink_to(self.cfg.nginx/'nginx.conf')
        (self.cfg.ops/'official-upload-flags.json').write_bytes(b'{"alreadyLive":true}')
        self.coord_state = {'shared_release_active': False, 'updated_at': 'original',
            'window': {'owner_task': 'TASK2', 'status': 'verified',
                'closedAtUtc': '2026-11-19T09:00:00+00:00', 'needsOperatorRecovery': False},
            'window_history': [{'owner_task': 'OLD-FAILED', 'status': 'failed',
                'error': 'must remain forever'}], 'pastFailures': ['retain original failure']}
        self.cfg.coord.write_bytes(r.encode(self.coord_state))
        self.raw_rows = []
        for i in range(12):
            name = 'dianzi51-admin' if i < 2 else 'dianzi51' if i < 6 else 'worker'+str(i)
            folder = self.root/'runtime'/('admin' if i < 2 else 'front' if i < 6 else name)/'dist'
            folder.mkdir(parents=True, exist_ok=True)
            script = folder/'index.js'
            script.write_bytes(('runtime original ' + name).encode())
            helper = folder.parent/'runtime'
            helper.mkdir(exist_ok=True)
            (helper/'helper.mjs').write_bytes(b'opaque runtime helper original')
            if i in (0, 2):
                (folder/'public').symlink_to(self.cfg.public if i == 0 else self.cfg.front,
                                             target_is_directory=True)
            pid = 5000+i
            (self.cfg.proc/str(pid)).mkdir()
            (self.cfg.proc/str(pid)/'environ').write_bytes(b'SECRET_TEST_TOKEN=never-output\0ROLE='+name.encode()+b'\0')
            (self.cfg.proc/str(pid)/'status').write_bytes(
                b'Uid:\t1000 1000 1000 1000\nGid:\t1000 1000 1000 1000\nGroups:\t1000\nUmask:\t0022\n')
            with (self.cfg.proc/str(pid)/'environ').open('ab') as stream:
                stream.write(b'pm2_env={"pm_uptime":1,"env":{"SECRET_TEST_TOKEN":"never-output","pm_uptime":1}}\0')
            self.raw_rows.append({'pm_id': [188,189,190,193,194,200,210,211,212,213,214,215][i], 'name': name, 'pid': pid, 'pm2_env': {
                'status': 'online', 'pm_exec_path': str(script), 'pm_cwd': str(folder.parent),
                'exec_mode': 'cluster_mode' if i < 6 else 'fork_mode', 'restart_time': 3,
                'env': {'SECRET_TEST_TOKEN': 'never-output', 'SHLVL': '1', 'pm_uptime': 1},
                'SECRET_TEST_TOKEN': 'never-output', 'pm_uptime': 1,
                'axm_monitor': {'heap': 100}, 'created_at': 1}})
        self.api_before = (b'function createCustomerSupplyService(deps) {\n'
            b' async function context() { return sql85`SELECT ${sql85`id = ${input.id}`}`; }\n'
            b' async function source(tx, scope, c, input) {\n'
            b' if (!link) {\n const sourceProfile = input.sourceProfile;\n'
            b' if (!sourceProfile) return fail11("PRECONDITION_FAILED", "\\u9996\\u6B21required");\n'
            b' }\n const occupied = sql85`SELECT id WHERE eid = ${scope.enterpriseId}`;\n'
            b' return sourceProfile;\n }\n}\nconst protectedBusinessApi = "unchanged";\n')
        self.cfg.api.write_bytes(self.api_before)
        self.reload_calls = []
        self.health_calls = []
        self.calls = []
        self.http_calls = []

        def only_existing_rpc(argv, **kwargs):
            self.calls.append(argv)
            self.assertEqual(argv[1:], ['-e', r.PM2_RPC])
            self.assertTrue(argv[0].endswith('/node') or argv[0].endswith('/node-22'))
            return subprocess.CompletedProcess(argv, 0, json.dumps(self.raw_rows).encode(), b'')
        self.command_patch = patch.object(r.subprocess, 'run', side_effect=only_existing_rpc)
        self.command_patch.start()
        self.addCleanup(self.command_patch.stop)
        self.controller = r.Controller(self.cfg, get_reader=self.static_get,
            reload_adapter=self.mock_reload, api_health_reader=self.mock_health)
        self.make_package(css=False)

    def mock_reload(self, cfg, pm_id, api_sha):
        self.assertIn(pm_id, r.FRONT_IDS)
        self.assertEqual(r.H(cfg.api.read_bytes()), api_sha)
        self.reload_calls.append((pm_id, api_sha))
        row = next(row for row in self.raw_rows if row['pm_id'] == pm_id)
        oldpid, newpid = row['pid'], row['pid'] + 100
        previous = cfg.proc/str(oldpid)
        target = cfg.proc/str(newpid)
        target.mkdir()
        raw = (previous/'environ').read_bytes().replace(b'"pm_uptime":1', b'"pm_uptime":999')
        (target/'environ').write_bytes(raw)
        (target/'status').write_bytes((previous/'status').read_bytes())
        row['pid'] = newpid
        row['pm2_env']['restart_time'] += 1
        row['pm2_env']['pm_uptime'] += 10

    def mock_health(self, cfg, api_sha):
        self.assertEqual(r.H(cfg.api.read_bytes()), api_sha)
        self.health_calls.append(api_sha)
        return True

    def static_get(self, host, name):
        self.http_calls.append((host, name))
        root = self.cfg.public if host == 'admin.51dianzi.com' else self.cfg.front
        return (root/(name or 'index.html')).read_bytes()

    def make_package(self, css=False):
        # Legacy callers requesting CSS now reuse preexisting CSS, no new CSS.
        css = False
        for p in sorted(self.cfg.package.rglob('*'), reverse=True):
            if p.is_file():
                p.unlink()
            elif p.is_dir():
                p.rmdir()
        capture = self.controller.capture()
        (self.cfg.package/'capture.json').write_bytes(r.encode(capture))
        (self.cfg.package/'before-index.html').write_bytes(self.before)
        api_before = self.cfg.api.read_bytes()
        expression = b'input.sourceProfile'
        required = b' if (!sourceProfile) return fail11("PRECONDITION_FAILED", "\\u9996\\u6B21required");\n'
        api_after = api_before.replace(expression, expression + b' ?? { type: "other" }').replace(required, b'')
        patches = [dict(kind='profile-default-other', offset=api_before.index(expression),
            beforeBase64=base64.b64encode(expression).decode(),
            afterBase64=base64.b64encode(expression + b' ?? { type: "other" }').decode()),
            dict(kind='remove-first-required-fail', offset=api_before.index(required),
            beforeBase64=base64.b64encode(required).decode(), afterBase64='')]
        start = api_before.index(b'async function source(')
        header_end = api_before.index(b'{', start)+1
        end = r.block_end(api_before, header_end-1)
        after_end = r.block_end(api_after, header_end-1)
        delta = dict(schema='customer-supply-source-delta-v1', apiPath=str(self.cfg.api),
            beforeSha256=r.H(api_before), afterSha256=r.H(api_after), patches=patches,
            source=dict(ownerOffset=api_before.index(b'function createCustomerSupplyService(deps) {'), start=start, end=end,
                headerEnd=header_end, abiSha256=r.H(api_before[start:header_end]),
                beforeSha256=r.H(api_before[start:end]), afterSha256=r.H(api_after[start:after_end])))
        (self.cfg.package/'before-api.js').write_bytes(api_before)
        (self.cfg.package/'after-api.js').write_bytes(api_after)
        (self.cfg.package/'api-delta.json').write_bytes(r.encode(delta))
        self.assets = []
        self.replacements = []
        after = self.before
        for label in ('main', 'customer'):
            data = ('export const compactUpload="'+label+'";\n').encode()
            name = 'assets/BusinessWorkbenchPage-customer-upload-compact-'+label+'-'+r.H(data)[:16]+'.js'
            (self.cfg.package/name).parent.mkdir(exist_ok=True)
            (self.cfg.package/name).write_bytes(data)
            self.assets.append({'relative': name, 'sha256': r.H(data), 'size': len(data)})
            old = '/assets/BusinessWorkbenchPage-old-'+label+'.js'
            new = '/'+name
            self.replacements.append({'before': old, 'after': new})
            after = after.replace(old.encode(), new.encode())
        css_name = None
        if css:
            data = b'.compact-upload{display:flex;gap:4px}\n'
            css_name = 'assets/customer-upload-compact-'+r.H(data)[:16]+'.css'
            (self.cfg.package/css_name).write_bytes(data)
            self.assets.append({'relative': css_name, 'sha256': r.H(data), 'size': len(data)})
            after = after.replace(b'</head>', ('<link rel="stylesheet" href="/'+css_name+'">\n</head>').encode())
        (self.cfg.package/'after-index.html').write_bytes(after)
        (self.cfg.package/'evidence').mkdir()
        (self.cfg.package/'evidence'/'source.json').write_bytes(b'{"tests":"offline fixture"}\n')
        self.m = {'ownerTask': r.OWNER, 'scope': r.SCOPE,
            'captureSha256': r.H((self.cfg.package/'capture.json').read_bytes()),
            'controllerSha256': self.controller.controller_hash,
            'beforeHtmlSha256': r.H(self.before), 'afterHtmlSha256': r.H(after),
            'assets': copy.deepcopy(self.assets), 'replacements': copy.deepcopy(self.replacements),
            'cssRelative': css_name, 'packageFiles': {},
            'beforeApiSha256': r.H(api_before), 'afterApiSha256': r.H(api_after),
            'apiDeltaSha256': r.H(r.encode(delta))}
        self.repin()

    def repin(self):
        self.m['packageFiles'] = {p.relative_to(self.cfg.package).as_posix(): r.H(p.read_bytes())
            for p in self.cfg.package.rglob('*') if p.is_file() and p.name not in ('manifest.json', 'review.json')}
        mb = r.encode(self.m)
        (self.cfg.package/'manifest.json').write_bytes(mb)
        self.manifest_sha = r.H(mb)
        self.review = {'status': 'passed', 'independent': True, 'manifestSha256': self.manifest_sha,
                       'controllerSha256': self.controller.controller_hash, 'reviewer': 'independent test reviewer',
                       'ownerTask': r.OWNER, 'scope': r.SCOPE,
                       'captureSha256': self.m['captureSha256'], 'apiDeltaSha256': self.m['apiDeltaSha256'],
                       'packageFiles': copy.deepcopy(self.m['packageFiles'])}
        self.review_bytes = r.encode(self.review)
        (self.cfg.package/'review.json').write_bytes(self.review_bytes)
        self.review_sha = r.H(self.review_bytes)

    def preflight(self):
        return self.controller.preflight(self.cfg.package, self.manifest_sha)

    def apply(self):
        return self.controller.apply(self.cfg.package, self.manifest_sha, self.review_sha)

    def unchanged_originals(self, capture, except_html=False):
        for name, record in capture['protectedFiles'].items():
            if except_html and name in (str(self.cfg.html), str(self.cfg.api)):
                continue
            if record['kind'] == 'directory-symlink':
                path = Path(name)
                actual = r.directory_link(path)
            else:
                actual = r.describe(Path(name), allow_link=True)
            self.assertEqual(actual, record, name)

    def test_capture_stdout_payload_readonly_and_no_secret_export(self):
        coord = self.cfg.coord.read_bytes()
        capture = self.controller.capture()
        self.assertEqual(base64.b64decode(capture['coordBase64']), coord)
        self.assertEqual(capture['coordSha256'], r.H(coord))
        self.assertNotIn(b'never-output', r.encode(capture))
        self.assertEqual(len(capture['processes']), 12)
        self.assertEqual(capture['productionWrites'], 0)
        self.assertFalse(self.cfg.receipt.exists())
        self.unchanged_originals(capture)
        self.assertIn(str(self.cfg.front/'assets'/'task2.js'), capture['protectedFiles'])
        self.assertIn(str(self.cfg.public/'favicon.ico'), capture['protectedFiles'])
        self.assertIn(str(self.cfg.ops/'official-upload-flags.json'), capture['protectedFiles'])
        self.assertTrue(any(p.endswith('helper.mjs') for p in capture['protectedFiles']))
        self.assertEqual(self.cfg.coord.read_bytes(), coord)

    def test_preflight_readonly_no_review_required(self):
        (self.cfg.package/'review.json').unlink()
        coord = self.cfg.coord.read_bytes()
        out = self.preflight()
        self.assertEqual(out['status'], 'preflight-passed')
        self.assertFalse(self.cfg.receipt.exists())
        self.assertEqual(self.cfg.html.read_bytes(), self.before)
        self.assertEqual(self.cfg.coord.read_bytes(), coord)
        self.assertTrue(all(not (self.cfg.public/a['relative']).exists() for a in self.assets))

    def test_apply_success_css_preserves_task2_old_assets_procs_and_history(self):
        self.make_package(css=True)
        capture = r.decode((self.cfg.package/'capture.json').read_bytes())
        old_front = (self.cfg.front/'index.html').read_bytes()
        result = self.apply()
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(result['processReloads'], 4)
        self.assertEqual(self.cfg.html.read_bytes(), (self.cfg.package/'after-index.html').read_bytes())
        self.assertEqual((self.cfg.front/'index.html').read_bytes(), old_front)
        self.unchanged_originals(capture, except_html=True)
        for a in self.assets:
            self.assertEqual(r.H((self.cfg.public/a['relative']).read_bytes()), a['sha256'])
            self.assertIn(('admin.51dianzi.com', a['relative']), self.http_calls)
        coord = r.decode(self.cfg.coord.read_bytes())
        self.assertFalse(coord['shared_release_active'])
        self.assertEqual(coord['window']['status'], 'closed')
        self.assertEqual(coord['window']['outcome'], 'verified')
        self.assertFalse(coord['window']['needsOperatorRecovery'])
        self.assertTrue(coord['window']['closedAtUtc'])
        self.assertEqual(coord['window_history'][0], self.coord_state['window_history'][0])
        self.assertEqual(coord['pastFailures'], self.coord_state['pastFailures'])
        self.assertEqual(coord['window']['manifestSha256'], self.manifest_sha)
        self.assertTrue((self.cfg.receipt/'receipt.json').is_file())
        self.assertFalse(any(p.name.startswith('.cas-') for p in self.cfg.stage.iterdir()))

    def test_success_receipt_prevents_replay(self):
        self.apply()
        with self.assertRaises(r.ReleaseError):
            self.apply()

    def test_existing_failure_receipt_blocks_before_any_production_write(self):
        self.cfg.receipt.mkdir(mode=0o700)
        (self.cfg.receipt/'failure.json').write_bytes(b'old failure must survive')
        coord = self.cfg.coord.read_bytes()
        with self.assertRaisesRegex(r.ReleaseError, 'RECEIPT_EXISTS_NO_REPLAY'):
            self.preflight()
        self.assertEqual(self.cfg.coord.read_bytes(), coord)
        self.assertEqual((self.cfg.receipt/'failure.json').read_bytes(), b'old failure must survive')

    def test_lockbusy_each_existing_inode(self):
        for path in self.cfg.locks:
            with self.subTest(path=path):
                with path.open('rb') as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    with self.assertRaisesRegex(r.ReleaseError, 'LOCK_BUSY'):
                        self.controller.capture()
                    self.assertFalse(self.cfg.receipt.exists())

    def test_missing_lock_not_created(self):
        self.cfg.locks[0].unlink()
        with self.assertRaises(FileNotFoundError):
            self.controller.capture()
        self.assertFalse(self.cfg.locks[0].exists())

    def test_original_lock_parent_alias_supported_but_lock_file_link_refused(self):
        alias = self.root/'locks-alias'
        alias.symlink_to(self.root/'locks', target_is_directory=True)
        cfg = replace(self.cfg, locks=(alias/'public.lock', alias/'code.lock'))
        controller = r.Controller(cfg, get_reader=self.static_get)
        self.assertEqual(len(controller.capture()['processes']), 12)
        link = self.root/'lock-file-link'
        link.symlink_to(self.cfg.locks[0])
        cfg = replace(self.cfg, locks=(link, self.cfg.locks[1]))
        with self.assertRaisesRegex(r.ReleaseError, 'LOCK_FILE_SYMLINK'):
            r.Controller(cfg, get_reader=self.static_get).capture()

    def test_apply_lockbusy_no_stage_or_production_write(self):
        before = self.cfg.coord.read_bytes()
        with self.cfg.locks[1].open('rb') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(r.ReleaseError, 'LOCK_BUSY'):
                self.apply()
        self.assertEqual(self.cfg.coord.read_bytes(), before)
        self.assertFalse(self.cfg.receipt.exists())

    def test_coordbusy_open_missing_close_and_recovery_failclosed(self):
        variants = [dict(self.coord_state, shared_release_active=True),
            dict(self.coord_state, window=dict(self.coord_state['window'], status='open')),
            dict(self.coord_state, window=dict(self.coord_state['window'], closedAtUtc=None)),
            dict(self.coord_state, window=dict(self.coord_state['window'], needsOperatorRecovery=True)),
            dict(self.coord_state, needsOperatorRecovery=True)]
        for state in variants:
            with self.subTest(state=state):
                data = r.encode(state)
                self.cfg.coord.write_bytes(data)
                with self.assertRaisesRegex(r.ReleaseError, 'COORD_BUSY'):
                    self.controller.capture()
                self.assertEqual(self.cfg.coord.read_bytes(), data)
                self.assertFalse(self.cfg.receipt.exists())

    def test_coord_fullbytes_cas_even_same_json(self):
        coord = self.cfg.coord.read_bytes()+b' \n'
        self.cfg.coord.write_bytes(coord)
        with self.assertRaisesRegex(r.ReleaseError, 'COORD_FULL_BYTES_CAS'):
            self.apply()
        self.assertEqual(self.cfg.coord.read_bytes(), coord)
        self.assertFalse(self.cfg.receipt.exists())

    def test_html_fullbytes_drift_no_attempt_or_window(self):
        self.cfg.html.write_bytes(self.before+b'externally changed')
        coord = self.cfg.coord.read_bytes()
        with self.assertRaisesRegex(r.ReleaseError, 'PROTECTED_FILE'):
            self.apply()
        self.assertEqual(self.cfg.coord.read_bytes(), coord)
        self.assertFalse(self.cfg.receipt.exists())

    def test_protected_drift_bytes_mode_uid_shape_and_added_file(self):
        capture_file = self.cfg.package/'capture.json'
        for target, mutation in [
            (self.cfg.front/'index.html', lambda p: p.write_bytes(b'TASK2 NEWER DO NOT REVERT')),
            (self.cfg.public/'favicon.ico', lambda p: p.chmod(0o600)),
            (self.cfg.nginx/'nginx.conf', lambda p: p.write_bytes(b'new config')),
            (self.cfg.ops/'official-upload-flags.json', lambda p: p.write_bytes(b'{"new":true}'))]:
            with self.subTest(target=target):
                original = target.read_bytes(); mode = stat.S_IMODE(target.stat().st_mode)
                mutation(target)
                with self.assertRaisesRegex(r.ReleaseError, 'PROTECTED_FILE'):
                    self.apply()
                self.assertFalse(self.cfg.receipt.exists())
                target.write_bytes(original); target.chmod(mode)
        (self.cfg.front/'new-original.txt').write_bytes(b'new concurrent front original')
        with self.assertRaisesRegex(r.ReleaseError, 'PROTECTED_FILE'):
            self.apply()
        self.assertTrue(capture_file.is_file())
        self.assertFalse(self.cfg.receipt.exists())

    def test_pid_or_config_env_or_raw_env_drift_stops_before_write(self):
        original = copy.deepcopy(self.raw_rows)
        for key in ('pid', 'env', 'raw'):
            with self.subTest(key=key):
                self.raw_rows = copy.deepcopy(original)
                env_path = self.cfg.proc/'5000'/'environ'
                env_before = env_path.read_bytes()
                if key == 'pid':
                    self.raw_rows[0]['pid'] = 5001
                elif key == 'env':
                    self.raw_rows[0]['pm2_env']['env']['SECRET_TEST_TOKEN'] = 'changed-secret'
                else:
                    env_path.write_bytes(env_before+b'CHANGED=1\0')
                with self.assertRaises(r.ReleaseError):
                    self.apply()
                self.assertFalse(self.cfg.receipt.exists())
                env_path.write_bytes(env_before)
        self.raw_rows = original

    def test_pm2_volatile_env_top_env_filtered(self):
        self.raw_rows[0]['pm2_env']['pm_uptime'] = 999999
        self.raw_rows[0]['pm2_env']['env']['pm_uptime'] = 999999
        self.raw_rows[0]['pm2_env']['env']['SHLVL'] = '12'
        self.raw_rows[0]['pm2_env']['axm_monitor'] = {'heap': 999}
        self.assertEqual(self.preflight()['status'], 'preflight-passed')

    def test_requires_all_twelve_online(self):
        self.raw_rows[8]['pm2_env']['status'] = 'stopped'
        with self.assertRaisesRegex(r.ReleaseError, 'ALL_PM2_MUST_BE_ONLINE'):
            self.controller.capture()

    def test_actual_front_alias_not_assumed(self):
        alias = Path(self.raw_rows[2]['pm2_env']['pm_exec_path']).parent/'public'
        alias.unlink(); alias.symlink_to(self.cfg.public, target_is_directory=True)
        with self.assertRaisesRegex(r.ReleaseError, 'ACTUAL_SERVING_ROOT_CHANGED'):
            self.controller.capture()

    def test_capture_https_root_binding(self):
        self.controller.get_reader = lambda host, name: b'wrong serving root'
        with self.assertRaisesRegex(r.ReleaseError, 'ACTUAL_HTTPS_ROOT_HTML'):
            self.controller.capture()
        self.assertFalse(self.cfg.receipt.exists())

    def test_capture_ttl_and_future(self):
        for seconds in (-901, 60):
            with self.subTest(seconds=seconds):
                cp = self.cfg.package/'capture.json'
                c = r.decode(cp.read_bytes())
                c['capturedAtUtc'] = (dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=seconds)).isoformat()
                cp.write_bytes(r.encode(c))
                self.m['captureSha256'] = r.H(cp.read_bytes())
                self.repin()
                with self.assertRaisesRegex(r.ReleaseError, 'CAPTURE_EXPIRED_OR_FUTURE'):
                    self.preflight()

    def test_manifest_only_html_rejects_other_bytes(self):
        candidate = self.cfg.package/'after-index.html'
        candidate.write_bytes(candidate.read_bytes().replace(b'UNCHANGED', b'UNAUTHORIZED'))
        self.m['afterHtmlSha256'] = r.H(candidate.read_bytes()); self.repin()
        with self.assertRaisesRegex(r.ReleaseError, 'MANIFEST_ONLY_HTML_DELTA'):
            self.apply()
        self.assertFalse(self.cfg.receipt.exists())

    def test_manifest_only_html_rejects_css_beyond_independent_canonical_link(self):
        self.make_package(css=True)
        candidate = self.cfg.package/'after-index.html'
        candidate.write_bytes(candidate.read_bytes().replace(b'<body>', b'<body style="color:red">'))
        self.m['afterHtmlSha256'] = r.H(candidate.read_bytes()); self.repin()
        with self.assertRaisesRegex(r.ReleaseError, 'MANIFEST_ONLY_HTML_DELTA'):
            self.apply()

    def test_manifest_wrong_controller_owner_or_scope(self):
        for key, value in [('controllerSha256', '0'*64), ('ownerTask', 'other-task'), ('scope', 'other')]:
            with self.subTest(key=key):
                old = self.m[key]; self.m[key] = value; self.repin()
                with self.assertRaises(r.ReleaseError):
                    self.preflight()
                self.m[key] = old; self.repin()

    def test_manifest_duplicate_reference_or_nonbusiness_target_rejected(self):
        self.m['replacements'][0]['before'] = '/assets/index.js'
        self.repin()
        with self.assertRaisesRegex(r.ReleaseError, 'ONLY_BUSINESS_WORKBENCH'):
            self.preflight()

    def test_all_complete_quoted_business_references_are_replaced(self):
        repeated = (b'<script>const boot=["/assets/BusinessWorkbenchPage-old-main.js",'
                    b'"/assets/BusinessWorkbenchPage-old-customer.js",'
                    b'"/assets/BusinessWorkbenchPage-old-main.js"];</script>')
        self.before = self.before.replace(b'</head>', repeated + b'</head>')
        self.cfg.html.write_bytes(self.before)
        self.make_package(css=True)
        self.assertEqual(self.preflight()['status'], 'preflight-passed')
        self.assertEqual(self.apply()['status'], 'verified')
        after = self.cfg.html.read_bytes()
        for replacement in self.replacements:
            self.assertNotIn(replacement['before'].encode(), after)
            self.assertEqual(after.count(replacement['after'].encode()),
                             self.before.count(replacement['before'].encode()))

    def test_unquoted_business_reference_remains_refused(self):
        self.before = self.before.replace(b'</head>',
            b'<!-- /assets/BusinessWorkbenchPage-old-main.js -->\n</head>')
        self.cfg.html.write_bytes(self.before)
        self.make_package(css=True)
        with self.assertRaisesRegex(r.ReleaseError, 'URL_MUST_BE_ENTIRE_QUOTED_REFERENCE'):
            self.preflight()
        self.assertEqual(self.cfg.html.read_bytes(), self.before)

    def test_runtime_file_link_and_target_content_drift_are_protected(self):
        folder = Path(self.raw_rows[2]['pm2_env']['pm_exec_path']).parent
        target = self.root / 'original-worker.mjs'
        target.write_bytes(b'original worker implementation')
        alias = folder / 'forumPdfScanWorker.mjs'
        alias.symlink_to(target)
        self.make_package(css=True)
        capture = r.decode((self.cfg.package / 'capture.json').read_bytes())
        self.assertEqual(capture['protectedFiles'][str(alias)]['kind'], 'symlink')
        self.assertEqual(capture['protectedFiles'][str(alias)]['targetRecord']['sha256'],
                         r.H(b'original worker implementation'))
        target.write_bytes(b'foreign worker modification')
        with self.assertRaisesRegex(r.ReleaseError, 'PROTECTED_FILE_OR_INVENTORY_DRIFT'):
            self.preflight()
        self.assertEqual(self.cfg.html.read_bytes(), self.before)

    def test_package_unpinned_extra_file_and_symlink_refused(self):
        extra = self.cfg.package/'unreviewed.py'
        extra.write_bytes(b'do not execute')
        with self.assertRaisesRegex(r.ReleaseError, 'EXACT_PACKAGE_CONTENTS'):
            self.preflight()
        extra.unlink(); extra.symlink_to(self.cfg.html)
        with self.assertRaisesRegex(r.ReleaseError, 'PACKAGE_SYMLINK'):
            self.preflight()

    def test_package_file_drift(self):
        (self.cfg.package/'evidence'/'source.json').write_bytes(b'changed evidence')
        with self.assertRaisesRegex(r.ReleaseError, 'PACKAGE_FILE_DRIFT'):
            self.apply()

    def test_apply_requires_independent_pinned_review(self):
        for key, value in [('independent', False), ('status', 'pending'),
                           ('manifestSha256', '0'*64), ('controllerSha256', '0'*64)]:
            with self.subTest(key=key):
                review = dict(self.review, **{key: value})
                rb = r.encode(review)
                (self.cfg.package/'review.json').write_bytes(rb)
                with self.assertRaisesRegex(r.ReleaseError, 'INDEPENDENT_REVIEW'):
                    self.controller.apply(self.cfg.package, self.manifest_sha, r.H(rb))
                self.assertFalse(self.cfg.receipt.exists())
        (self.cfg.package/'review.json').write_bytes(self.review_bytes)
        with self.assertRaisesRegex(r.ReleaseError, 'REVIEW_SHA256'):
            self.controller.apply(self.cfg.package, self.manifest_sha, '0'*64)

    def test_new_asset_existing_never_overwritten(self):
        asset = self.cfg.public/self.assets[0]['relative']
        asset.write_bytes(b'foreign content')
        with self.assertRaisesRegex(r.ReleaseError, 'ASSET_ALREADY_EXISTS'):
            self.apply()
        self.assertEqual(asset.read_bytes(), b'foreign content')
        self.assertFalse(self.cfg.receipt.exists())

    def test_rollback_retains_new_assets_and_never_front_rollback_or_reload(self):
        capture = r.decode((self.cfg.package/'capture.json').read_bytes())
        self.controller.get_reader = lambda host, name: b'HTTP validation failed'
        with self.assertRaisesRegex(r.ReleaseError, 'failed-rolled-back'):
            self.apply()
        self.assertEqual(self.cfg.html.read_bytes(), self.before)
        self.unchanged_originals(capture, except_html=True)
        for path in (self.cfg.api, self.cfg.html):
            self.assertEqual(r.describe(path), self.controller.own_target_records[str(path)])
        for a in self.assets:
            self.assertTrue((self.cfg.public/a['relative']).is_file())
        state = r.decode(self.cfg.coord.read_bytes())
        self.assertFalse(state['shared_release_active'])
        self.assertEqual(state['window']['outcome'], 'failed-rolled-back')
        self.assertEqual(state['window']['status'], 'closed')
        self.assertFalse(state['window']['needsOperatorRecovery'])
        failure = r.decode((self.cfg.receipt/'failure.json').read_bytes())
        self.assertTrue(failure['assetsRetained'])
        self.assertEqual(failure['processReloads'], 4)
        self.assertEqual(len(failure['processRollbacks']), 4)
        with self.assertRaises(r.ReleaseError):
            self.apply()

    def test_failure_never_rollback_foreign_html(self):
        foreign = self.before+b'FOREIGN NEWER HTML'
        def takeover(host, name):
            self.cfg.html.write_bytes(foreign)
            return b'wrong'
        self.controller.get_reader = takeover
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required-html-cas-lost'):
            self.apply()
        self.assertEqual(self.cfg.html.read_bytes(), foreign)
        state = r.decode(self.cfg.coord.read_bytes())
        self.assertTrue(state['shared_release_active'])
        self.assertEqual(state['window']['status'], 'open')
        self.assertNotIn('closedAtUtc', state['window'])

    def test_failure_never_touch_foreign_coord_window_or_html(self):
        foreign_coord = r.encode(dict(self.coord_state, shared_release_active=True,
            window={'owner_task': 'OTHER-TASK', 'nonce': 'foreign', 'status': 'open'}))
        def takeover(host, name):
            self.cfg.coord.write_bytes(foreign_coord)
            return b'wrong'
        self.controller.get_reader = takeover
        after = (self.cfg.package/'after-index.html').read_bytes()
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required-coord-ownership-lost'):
            self.apply()
        self.assertEqual(self.cfg.coord.read_bytes(), foreign_coord)
        self.assertEqual(self.cfg.html.read_bytes(), after)

    def test_partial_new_asset_failure_retains_both_created_files_and_baseline_html(self):
        original = r.exclusive
        second = self.cfg.public/self.assets[1]['relative']
        def fault(path, data, mode=0o600):
            if path == second:
                original(path, data[:5], mode)
                raise OSError('simulated partial write after exclusive creation')
            return original(path, data, mode)
        with patch.object(r, 'exclusive', side_effect=fault):
            with self.assertRaisesRegex(r.ReleaseError, 'failed-rolled-back'):
                self.apply()
        self.assertEqual(self.cfg.html.read_bytes(), self.before)
        self.assertTrue((self.cfg.public/self.assets[0]['relative']).is_file())
        self.assertEqual(second.read_bytes(), (self.cfg.package/self.assets[1]['relative']).read_bytes()[:5])
        self.assertEqual(r.decode(self.cfg.coord.read_bytes())['window']['outcome'], 'failed-rolled-back')

    def test_atomic_cas_preserves_mode_uid_gid(self):
        self.cfg.html.chmod(0o640)
        old = r.metadata(self.cfg.html)
        r.atomic_cas(self.cfg.html, self.before, b'new private test bytes', self.cfg.stage)
        new = r.metadata(self.cfg.html)
        self.assertEqual({k: old[k] for k in ('statmode', 'uid', 'gid')},
                         {k: new[k] for k in ('statmode', 'uid', 'gid')})

    def test_atomic_cas_wrong_before_and_last_read_race(self):
        coord = self.cfg.coord.read_bytes()
        with self.assertRaisesRegex(r.ReleaseError, 'FULL_BYTES_CAS'):
            r.atomic_cas(self.cfg.coord, b'wrong', b'new', self.cfg.stage)
        self.assertEqual(self.cfg.coord.read_bytes(), coord)
        original_exclusive = r.exclusive
        def staged_race(path, data, mode=0o600):
            original_exclusive(path, data, mode)
            if path.name.startswith('.cas-'):
                self.cfg.coord.write_bytes(b'FOREIGN RACING CAS')
        with patch.object(r, 'exclusive', side_effect=staged_race):
            with self.assertRaisesRegex(r.ReleaseError, 'LAST_BYTES_METADATA_CAS'):
                r.atomic_cas(self.cfg.coord, coord, b'new', self.cfg.stage)
        self.assertEqual(self.cfg.coord.read_bytes(), b'FOREIGN RACING CAS')
        self.assertFalse(any(p.name.startswith('.cas-') for p in self.cfg.stage.iterdir()))

    def test_html_rename_then_fsync_failure_still_cas_rolled_back(self):
        original = r.atomic_cas
        fired = False
        def fault(path, before, after, scratch, **kwargs):
            nonlocal fired
            original(path, before, after, scratch, **kwargs)
            if path == self.cfg.html and not fired:
                fired = True
                raise OSError('simulated fsync-after-rename failure')
        with patch.object(r, 'atomic_cas', side_effect=fault):
            with self.assertRaisesRegex(r.ReleaseError, 'failed-rolled-back'):
                self.apply()
        self.assertEqual(self.cfg.html.read_bytes(), self.before)
        self.assertTrue(all((self.cfg.public/a['relative']).exists() for a in self.assets))

    def test_coord_open_rename_then_fsync_failure_closes_only_own_window(self):
        original = r.atomic_cas
        fired = False
        def fault(path, before, after, scratch, **kwargs):
            nonlocal fired
            original(path, before, after, scratch, **kwargs)
            if path == self.cfg.coord and not fired:
                fired = True
                raise OSError('simulated coord fsync-after-rename failure')
        with patch.object(r, 'atomic_cas', side_effect=fault):
            with self.assertRaisesRegex(r.ReleaseError, 'failed-rolled-back'):
                self.apply()
        state = r.decode(self.cfg.coord.read_bytes())
        self.assertFalse(state['shared_release_active'])
        self.assertEqual(state['window']['outcome'], 'failed-rolled-back')
        self.assertEqual(self.cfg.html.read_bytes(), self.before)

    def test_known_server_directory_alias_and_target_files_are_protected(self):
        alias = Path(self.raw_rows[2]['pm2_env']['pm_exec_path']).parent / 'server'
        target = self.root / 'original-server-target'
        target.mkdir()
        (target / 'service.mjs').write_bytes(b'original real server implementation')
        alias.symlink_to(target, target_is_directory=True)
        cfg = replace(self.cfg, server_alias=alias, server_target=target)
        controller = r.Controller(cfg, get_reader=self.static_get)
        captured = controller.capture()
        self.assertEqual(captured['protectedFiles'][str(alias)]['kind'], 'directory-symlink')
        self.assertEqual(captured['protectedFiles'][str(alias)]['target'], str(target))
        self.assertEqual(captured['protectedFiles'][str(target / 'service.mjs')]['sha256'],
                         r.H(b'original real server implementation'))

    def test_known_server_directory_alias_target_drift_is_refused(self):
        alias = Path(self.raw_rows[2]['pm2_env']['pm_exec_path']).parent / 'server'
        original = self.root / 'original-server-target'
        foreign = self.root / 'foreign-server-target'
        original.mkdir(); foreign.mkdir()
        alias.symlink_to(foreign, target_is_directory=True)
        cfg = replace(self.cfg, server_alias=alias, server_target=original)
        controller = r.Controller(cfg, get_reader=self.static_get)
        with self.assertRaisesRegex(r.ReleaseError, 'KNOWN_SERVER_ALIAS_TARGET_DRIFT'):
            controller.capture()
        self.assertEqual(self.cfg.html.read_bytes(), self.before)

    def test_json_duplicates_rejected(self):
        with self.assertRaisesRegex(r.ReleaseError, 'DUPLICATE_JSON_KEY'):
            r.decode(b'{"ownerTask":"a","ownerTask":"b"}')

    def test_no_service_commands_source_and_all_offline_calls_rpc_only(self):
        # Test execution never uses shell, PM2 CLI, nginx command, API, or reload.
        self.apply()
        self.assertGreater(len(self.calls), 0)
        self.assertTrue(all(c[1:] == ['-e', r.PM2_RPC] for c in self.calls))
        self.assertNotIn('pm2.connect(', r.PM2_RPC)
        self.assertNotIn('launchDaemon', r.PM2_RPC)
        self.assertNotIn('spawn', r.PM2_RPC)
        self.assertIn("client.call('getMonitorData'", r.PM2_RPC)

    def mutate_delta(self, mutation):
        path = self.cfg.package/'api-delta.json'
        delta = r.decode(path.read_bytes())
        mutation(delta)
        path.write_bytes(r.encode(delta))
        self.m['apiDeltaSha256'] = r.H(path.read_bytes())
        self.repin()

    def test_default_production_reload_failclosed_before_attempt_or_write(self):
        self.controller.reload_adapter = r.production_reload
        coord = self.cfg.coord.read_bytes()
        with self.assertRaisesRegex(r.ReleaseError, 'RELOAD_ADAPTER_UNVERIFIED'):
            self.apply()
        self.assertEqual(self.cfg.coord.read_bytes(), coord)
        self.assertEqual(self.cfg.api.read_bytes(), self.api_before)
        self.assertFalse(self.cfg.receipt.exists())

    def test_default_health_failclosed_before_attempt_or_write(self):
        self.controller.api_health_reader = r.production_api_health
        with self.assertRaisesRegex(r.ReleaseError, 'HEALTH_ADAPTER_UNVERIFIED'):
            self.apply()
        self.assertFalse(self.cfg.receipt.exists())
        self.assertFalse(self.reload_calls)

    def test_exact_api_delta_source_and_abi_bound(self):
        result = self.controller.validate(self.cfg.package, self.manifest_sha, self.review_sha)
        self.assertEqual(len(result['delta']['patches']), 2)
        self.assertEqual(result['beforeApi'], self.api_before)
        self.assertNotEqual(result['beforeApi'], result['afterApi'])
        self.assertIn(b'const protectedBusinessApi = "unchanged";', result['afterApi'])

    def test_api_delta_three_patches_rejected(self):
        self.mutate_delta(lambda d: d['patches'].append(copy.deepcopy(d['patches'][0])))
        with self.assertRaisesRegex(r.ReleaseError, 'EXACT_TWO_API_PATCHES'):
            self.apply()
        self.assertFalse(self.cfg.receipt.exists())

    def test_api_delta_path_abi_offset_and_original_span_rejected(self):
        original = (self.cfg.package/'api-delta.json').read_bytes()
        mutations = [lambda d: d.update(apiPath=str(self.cfg.public/'index.js')),
            lambda d: d['source'].update(abiSha256='0'*64),
            lambda d: d['patches'][0].update(offset=0),
            lambda d: d['patches'][0].update(beforeBase64=base64.b64encode(b'profile evil').decode()),
            lambda d: d['patches'][1].update(offset=d['patches'][0]['offset'])]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                (self.cfg.package/'api-delta.json').write_bytes(original)
                self.mutate_delta(mutation)
                with self.assertRaises(r.ReleaseError):
                    self.preflight()
                self.assertFalse(self.cfg.receipt.exists())

    def test_api_delta_other_literal_or_wide_logic_rejected(self):
        self.mutate_delta(lambda d: d['patches'][0].update(
            afterBase64=base64.b64encode(b'profile || "admin"').decode()))
        with self.assertRaisesRegex(r.ReleaseError, 'ONLY_OTHER_FALLBACK'):
            self.apply()
        self.assertFalse(self.reload_calls)

    def test_api_full_file_broad_delta_rejected_even_repin(self):
        path = self.cfg.package/'after-api.js'
        path.write_bytes(path.read_bytes().replace(b'protectedBusinessApi', b'alteredBusinessApi'))
        self.m['afterApiSha256'] = r.H(path.read_bytes())
        self.mutate_delta(lambda d: d.update(afterSha256=self.m['afterApiSha256']))
        with self.assertRaisesRegex(r.ReleaseError, 'EXACT_REVERSIBLE_TWO_SPAN'):
            self.apply()
        self.assertFalse(self.cfg.receipt.exists())

    def test_new_css_forbidden_and_old_css_protected(self):
        self.m['cssRelative'] = 'assets/new.css'
        self.repin()
        with self.assertRaisesRegex(r.ReleaseError, 'NO_NEW_CSS'):
            self.preflight()

    def test_review_explicit_package_capture_delta_scope_pins(self):
        for key, value in [('packageFiles', {}), ('captureSha256', '0'*64),
                           ('apiDeltaSha256', '0'*64), ('scope', 'previous-scope'),
                           ('ownerTask', 'other')]:
            rb = r.encode(dict(self.review, **{key:value}))
            (self.cfg.package/'review.json').write_bytes(rb)
            with self.assertRaisesRegex(r.ReleaseError, 'INDEPENDENT_REVIEW'):
                self.controller.apply(self.cfg.package, self.manifest_sha, r.H(rb))
            self.assertFalse(self.cfg.receipt.exists())

    def test_api_preimage_drift_preserved_before_any_attempt(self):
        foreign = self.api_before+b'FOREIGN_API'
        self.cfg.api.write_bytes(foreign)
        with self.assertRaisesRegex(r.ReleaseError, 'PROTECTED_FILE'):
            self.apply()
        self.assertEqual(self.cfg.api.read_bytes(), foreign)
        self.assertFalse(self.cfg.receipt.exists())
        self.assertFalse(self.reload_calls)

    def test_api_cas_race_never_overwrites_or_rolls_foreign(self):
        original = r.atomic_cas
        foreign = self.api_before+b'FOREIGN_API_RACE'
        def race(path, before, after, scratch, **kwargs):
            if path == self.cfg.api:
                path.write_bytes(foreign)
            return original(path, before, after, scratch, **kwargs)
        with patch.object(r, 'atomic_cas', side_effect=race):
            with self.assertRaisesRegex(r.ReleaseError, 'recovery-required-api-cas-lost'):
                self.apply()
        self.assertEqual(self.cfg.api.read_bytes(), foreign)
        self.assertEqual(self.cfg.html.read_bytes(), self.before)
        self.assertFalse(self.reload_calls)

    def test_partial_reload_failure_restores_only_loaded_front_slots(self):
        def fail(cfg, pm_id, api_sha):
            if pm_id == 194:
                raise r.ReleaseError('TRANSPORT_FAIL')
            self.mock_reload(cfg, pm_id, api_sha)
        self.controller.reload_adapter = fail
        with self.assertRaisesRegex(r.ReleaseError, 'failed-rolled-back'):
            self.apply()
        self.assertEqual([i for i,_ in self.reload_calls], [190,193,190,193])
        self.assertEqual(self.cfg.api.read_bytes(), self.api_before)
        self.assertEqual(self.cfg.html.read_bytes(), self.before)
        self.assertEqual((self.cfg.front/'index.html').read_bytes(), b'task2 already online: never rollback')
        failure = r.decode((self.cfg.receipt/'failure.json').read_bytes())
        self.assertEqual(failure['processReloads'], 2)
        self.assertEqual([e['id'] for e in failure['processRollbacks']], [190,193])
        self.assertTrue(all(e['observedPidChange'] for e in failure['processRollbacks']))
        self.assertTrue(all((self.cfg.public/a['relative']).exists() for a in self.assets))

    def test_transport_failure_after_observed_reload_tracks_and_restores_that_slot(self):
        fired = False
        def fail(cfg, pm_id, api_sha):
            nonlocal fired
            self.mock_reload(cfg, pm_id, api_sha)
            if pm_id == 193 and not fired:
                fired = True
                raise r.ReleaseError('FAIL_AFTER_PID_CHANGE')
        self.controller.reload_adapter = fail
        with self.assertRaisesRegex(r.ReleaseError, 'failed-rolled-back'):
            self.apply()
        self.assertEqual([i for i,_ in self.reload_calls], [190,193,190,193])
        self.assertEqual(self.cfg.api.read_bytes(), self.api_before)

    def test_no_observed_reload_is_not_synthetic_success(self):
        self.controller.reload_adapter = lambda cfg, pm_id, api_sha: None
        with self.assertRaisesRegex(r.ReleaseError, 'failed-rolled-back'):
            self.apply()
        self.assertEqual(self.cfg.api.read_bytes(), self.api_before)
        failure = r.decode((self.cfg.receipt/'failure.json').read_bytes())
        self.assertEqual(failure['processReloads'], 0)
        self.assertFalse(failure['processRollbacks'])

    def test_own_four_only_pid_restart_and_known_raw_volatile_may_change(self):
        capture = r.decode((self.cfg.package/'capture.json').read_bytes())
        result = self.apply()
        self.assertEqual([i for i,_ in self.reload_calls], list(r.FRONT_IDS))
        old = {row['id']:row for row in capture['processes']}
        for row in result['processesAfter']:
            baseline = old[row['id']]
            if row['id'] in r.FRONT_IDS:
                self.assertNotEqual(row['pid'], baseline['pid'])
                self.assertNotEqual(row['rawProcEnvironSha256'], baseline['rawProcEnvironSha256'])
                self.assertEqual(row['rawProcEnvironSemanticSha256'], baseline['rawProcEnvironSemanticSha256'])
                self.assertEqual(row['topConfigSha256'], baseline['topConfigSha256'])
                self.assertEqual(row['childConfigSha256'], baseline['childConfigSha256'])
            else:
                self.assertEqual(row, baseline)
        self.assertEqual(result['databaseWrites'], 0)
        self.assertEqual(result['envWrites'], 0)
        self.assertEqual(result['frontHtmlWrites'], 0)
        self.assertEqual(self.health_calls, [self.m['afterApiSha256']])

    def test_own_nonvolatile_raw_env_drift_no_silent_repair_or_other_reload(self):
        def drift(cfg, pm_id, api_sha):
            self.mock_reload(cfg, pm_id, api_sha)
            row = next(row for row in self.raw_rows if row['pm_id'] == pm_id)
            path = cfg.proc/str(row['pid'])/'environ'
            path.write_bytes(path.read_bytes().replace(b'never-output', b'FOREIGN_CREDENTIAL'))
        self.controller.reload_adapter = drift
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required'):
            self.apply()
        self.assertEqual([i for i,_ in self.reload_calls], [190])
        self.assertEqual(r.H(self.cfg.api.read_bytes()), self.m['afterApiSha256'])
        row = next(row for row in self.raw_rows if row['pm_id'] == 190)
        self.assertIn(b'FOREIGN_CREDENTIAL', (self.cfg.proc/str(row['pid'])/'environ').read_bytes())
        self.assertNotIn(b'FOREIGN_CREDENTIAL', (self.cfg.receipt/'failure.json').read_bytes())

    def test_own_top_and_child_config_drift_no_silent_repair(self):
        def drift(cfg, pm_id, api_sha):
            self.mock_reload(cfg, pm_id, api_sha)
            row = next(row for row in self.raw_rows if row['pm_id'] == pm_id)
            row['pm2_env']['env']['SECRET_TEST_TOKEN'] = 'FOREIGN'
        self.controller.reload_adapter = drift
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required'):
            self.apply()
        self.assertEqual([i for i,_ in self.reload_calls], [190])
        self.assertEqual(self.cfg.html.read_bytes(), self.before)

    def test_own_permissions_drift_no_repair_or_further_reload(self):
        def drift(cfg, pm_id, api_sha):
            self.mock_reload(cfg, pm_id, api_sha)
            row = next(row for row in self.raw_rows if row['pm_id'] == pm_id)
            path = cfg.proc/str(row['pid'])/'status'
            path.write_bytes(path.read_bytes().replace(b'0022', b'0077'))
        self.controller.reload_adapter = drift
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required'):
            self.apply()
        self.assertEqual([i for i,_ in self.reload_calls], [190])

    def test_other_eight_raw_exact_even_known_volatile(self):
        def drift(cfg, pm_id, api_sha):
            self.mock_reload(cfg, pm_id, api_sha)
            path = cfg.proc/'5008'/'environ'
            path.write_bytes(path.read_bytes()+b'SHLVL=99\0')
        self.controller.reload_adapter = drift
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required'):
            self.apply()
        self.assertEqual([i for i,_ in self.reload_calls], [190])

    def test_not_yet_loaded_own_slot_cannot_change_pid(self):
        def drift(cfg, pm_id, api_sha):
            self.mock_reload(cfg, pm_id, api_sha)
            self.mock_reload(cfg, 200, api_sha)
        self.controller.reload_adapter = drift
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required'):
            self.apply()
        self.assertEqual([i for i,_ in self.reload_calls], [190,200])
        self.assertEqual(self.cfg.html.read_bytes(), self.before)

    def test_main_site_newer_r5_during_health_never_reverted(self):
        newer = b'TASK2 NEW R5 FRONT HTML NEVER REVERT'
        def health(cfg, api_sha):
            (cfg.front/'index.html').write_bytes(newer)
            return True
        self.controller.api_health_reader = health
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required'):
            self.apply()
        self.assertEqual((self.cfg.front/'index.html').read_bytes(), newer)
        self.assertEqual([i for i,_ in self.reload_calls], list(r.FRONT_IDS))

    def test_foreign_coord_during_roll_never_touched(self):
        foreign = r.encode({'shared_release_active':True, 'window':{'nonce':'FOREIGN'}})
        def drift(cfg, pm_id, api_sha):
            self.mock_reload(cfg, pm_id, api_sha)
            cfg.coord.write_bytes(foreign)
        self.controller.reload_adapter = drift
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required-coord'):
            self.apply()
        self.assertEqual(self.cfg.coord.read_bytes(), foreign)
        self.assertEqual([i for i,_ in self.reload_calls], [190])

    def test_foreign_html_during_roll_never_touched(self):
        foreign = self.before+b'FOREIGN ADMIN'
        def drift(cfg, pm_id, api_sha):
            self.mock_reload(cfg, pm_id, api_sha)
            cfg.html.write_bytes(foreign)
        self.controller.reload_adapter = drift
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required-html'):
            self.apply()
        self.assertEqual(self.cfg.html.read_bytes(), foreign)
        self.assertEqual([i for i,_ in self.reload_calls], [190])

    def test_foreign_api_during_roll_never_touched(self):
        foreign = self.api_before+b'FOREIGN API'
        def drift(cfg, pm_id, api_sha):
            self.mock_reload(cfg, pm_id, api_sha)
            cfg.api.write_bytes(foreign)
        self.controller.reload_adapter = drift
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required-api'):
            self.apply()
        self.assertEqual(self.cfg.api.read_bytes(), foreign)
        self.assertEqual([i for i,_ in self.reload_calls], [190])

    def test_raw_nested_json_canonicalization_volatile_only(self):
        a = b'pm2_env={"pm_uptime":1,"env":{"SECRET":"x","restart_time":2}}\0ROLE=front\0'
        b = b'ROLE=front\0pm2_env={"env":{"restart_time":7,"SECRET":"x"},"pm_uptime":9}\0'
        self.assertNotEqual(r.H(a), r.H(b))
        self.assertEqual(r.raw_environment_semantics(a), r.raw_environment_semantics(b))
        self.assertNotEqual(r.raw_environment_semantics(a),
                            r.raw_environment_semantics(b.replace(b'"x"', b'"different"')))

    def test_existing_lock_inode_replaced_after_attempt_stops_first_prod_write(self):
        original = r.exclusive
        coord = self.cfg.coord.read_bytes()
        def replace_inode(path, data, mode=0o600):
            original(path, data, mode)
            if path.name == 'attempt.json':
                lock = self.cfg.locks[0]
                lock.unlink()
                lock.write_bytes(b'NEW INODE')
        with patch.object(r, 'exclusive', side_effect=replace_inode):
            with self.assertRaisesRegex(r.ReleaseError, 'LOCK_INODE_CHANGED'):
                self.apply()
        self.assertEqual(self.cfg.coord.read_bytes(), coord)
        self.assertEqual(self.cfg.api.read_bytes(), self.api_before)
        self.assertFalse(self.reload_calls)

    def test_extra_package_empty_directory_rejected(self):
        (self.cfg.package/'unreviewed-empty').mkdir()
        with self.assertRaisesRegex(r.ReleaseError, 'EXACT_PACKAGE_DIRECTORIES'):
            self.preflight()

    def test_runtime_env_and_non_js_inventory_preserved(self):
        runtime = self.cfg.api.parent
        (runtime/'opaque-config.json').write_bytes(b'{"PRIVATE":"never-output"}')
        (runtime.parent/'.env').write_bytes(b'PRIVATE=never-output\n')
        self.make_package()
        capture = r.decode((self.cfg.package/'capture.json').read_bytes())
        self.assertIn(str(runtime/'opaque-config.json'), capture['protectedFiles'])
        self.assertIn(str(runtime.parent/'.env'), capture['protectedFiles'])
        self.assertNotIn(b'never-output', r.encode(capture))
        (runtime.parent/'.env').write_bytes(b'PRIVATE=FOREIGN\n')
        with self.assertRaisesRegex(r.ReleaseError, 'PROTECTED_FILE'):
            self.apply()

    def test_already_loaded_slot_foreign_pid_not_counted_as_owned_reload(self):
        def drift(cfg, pm_id, api_sha):
            self.mock_reload(cfg, pm_id, api_sha)
            if pm_id == 193:
                row = next(row for row in self.raw_rows if row['pm_id'] == 190)
                previous = cfg.proc/str(row['pid'])
                row['pid'] += 1000  # foreign PID switch without own restart event
                target = cfg.proc/str(row['pid'])
                target.mkdir()
                for name in ('environ','status'):
                    (target/name).write_bytes((previous/name).read_bytes())
        self.controller.reload_adapter = drift
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required'):
            self.apply()
        self.assertEqual([i for i,_ in self.reload_calls], [190,193])
        self.assertEqual(self.cfg.html.read_bytes(), self.before)

    def test_new_asset_metadata_drift_not_accepted_as_verified(self):
        def health(cfg, api_sha):
            (cfg.public/self.assets[0]['relative']).chmod(0o600)
            return True
        self.controller.api_health_reader = health
        with self.assertRaisesRegex(r.ReleaseError, 'failed-rolled-back'):
            self.apply()
        self.assertEqual(self.cfg.api.read_bytes(), self.api_before)
        self.assertEqual(self.cfg.html.read_bytes(), self.before)

    def test_explicit_r5_union_link_and_target_pins_add_not_subtract_old_graph(self):
        alias = self.cfg.api.parent/'pinned-runtime.mjs'
        target = self.root/'pinned-target.mjs'
        target.write_bytes(b'PINNED R5 ORIGINAL')
        alias.symlink_to(target)
        self.cfg = replace(self.cfg, extra_links=((alias,target),))
        self.controller = r.Controller(self.cfg, get_reader=self.static_get,
            reload_adapter=self.mock_reload, api_health_reader=self.mock_health)
        self.make_package()
        capture = r.decode((self.cfg.package/'capture.json').read_bytes())
        self.assertIn(str(target), capture['protectedFiles'])
        self.assertIn(str(self.cfg.front/'assets'/'task2.js'), capture['protectedFiles'])
        target.write_bytes(b'FOREIGN PINNED TARGET')
        with self.assertRaisesRegex(r.ReleaseError, 'PROTECTED_FILE'):
            self.apply()


    def test_fullmeta_has_all_required_fields(self):
        record = r.describe(self.cfg.html)
        self.assertTrue({'dev','ino','nlink','mtimeNs','ctimeNs','size','statmode','uid','gid'} <= set(record))

    def test_untargeted_same_bytes_touch_is_drift(self):
        path = self.cfg.public/'favicon.ico'
        s = path.stat()
        os.utime(path, ns=(s.st_atime_ns, s.st_mtime_ns+1000000))
        with self.assertRaisesRegex(r.ReleaseError, 'PROTECTED_FILE'):
            self.preflight()
        self.assertFalse(self.cfg.receipt.exists())

    def test_untargeted_same_bytes_inode_replace_is_drift(self):
        path = self.cfg.public/'favicon.ico'
        temp = self.root/'replacement'
        temp.write_bytes(path.read_bytes()); temp.chmod(stat.S_IMODE(path.stat().st_mode))
        os.replace(temp, path)
        with self.assertRaisesRegex(r.ReleaseError, 'PROTECTED_FILE'):
            self.preflight()

    def test_untargeted_hardlink_nlink_is_drift(self):
        os.link(self.cfg.public/'favicon.ico', self.root/'extra-hardlink')
        with self.assertRaisesRegex(r.ReleaseError, 'PROTECTED_FILE'):
            self.preflight()

    def test_symlink_own_lstat_touch_is_drift(self):
        path = self.cfg.nginx/'enabled.conf'
        s = path.lstat()
        os.utime(path, ns=(s.st_atime_ns, s.st_mtime_ns+1000000), follow_symlinks=False)
        with self.assertRaisesRegex(r.ReleaseError, 'PROTECTED_FILE'):
            self.preflight()

    def test_target_preimage_same_bytes_touch_is_drift(self):
        for path in (self.cfg.api, self.cfg.html):
            with self.subTest(path=path):
                self.make_package()
                s = path.stat(); os.utime(path, ns=(s.st_atime_ns, s.st_mtime_ns+1000000))
                with self.assertRaisesRegex(r.ReleaseError, 'API_HTML_METADATA_DRIFT'):
                    self.preflight()
                self.assertFalse(self.cfg.receipt.exists())

    def test_own_target_touch_after_reload_blocks_rollback(self):
        def drift(cfg, pm_id, api_sha):
            self.mock_reload(cfg, pm_id, api_sha)
            s = cfg.api.stat(); os.utime(cfg.api, ns=(s.st_atime_ns, s.st_mtime_ns+1000000))
        self.controller.reload_adapter = drift
        with self.assertRaisesRegex(r.ReleaseError, 'recovery-required'):
            self.apply()
        self.assertEqual([i for i,_ in self.reload_calls], [190])
        self.assertEqual(r.H(self.cfg.api.read_bytes()), self.m['afterApiSha256'])

    def test_target_cas_same_bytes_metadata_race_refused(self):
        original = r.atomic_cas
        def race(path, before, after, scratch, **kwargs):
            if path == self.cfg.api:
                s = path.stat(); os.utime(path, ns=(s.st_atime_ns, s.st_mtime_ns+1000000))
            return original(path, before, after, scratch, **kwargs)
        with patch.object(r, 'atomic_cas', side_effect=race):
            with self.assertRaisesRegex(r.ReleaseError, 'recovery-required'):
                self.apply()
        self.assertEqual(self.cfg.api.read_bytes(), self.api_before)
        self.assertFalse(self.reload_calls)

    def test_directory_link_target_root_ignores_times_not_identity_mode(self):
        alias = self.cfg.api.parent/'public'
        before = r.directory_link(alias)
        (self.cfg.front/'new-entry').write_bytes(b'new directory entry')
        self.assertEqual(r.directory_link(alias), before)
        self.cfg.front.chmod(0o700)
        self.assertNotEqual(r.directory_link(alias), before)

    def test_directory_link_target_root_inode_replace_is_drift(self):
        alias = self.root/'dir-alias'; target = self.root/'dir-target'
        target.mkdir(); alias.symlink_to(target, target_is_directory=True)
        before = r.directory_link(alias)
        target.rename(self.root/'old-target'); target.mkdir()
        self.assertNotEqual(r.directory_link(alias), before)

    def test_filter_env_application_json_strings_opaque(self):
        a = '{"status":"customer-active","nested":{"pid":123}}'
        b = '{"status":"customer-disabled","nested":{"pid":123}}'
        self.assertEqual(r.filter_env(a), a)
        for value in ({'APP': a}, {'env': {'APP': a}}):
            self.assertNotEqual(r.filter_env(value), r.filter_env(json.loads(json.dumps(value).replace('customer-active','customer-disabled'))))
        self.assertNotEqual(r.filter_env({'APP':a}), r.filter_env({'APP':b}))

    def test_raw_application_json_status_is_exact(self):
        a = b'APP={"status":"active","pid":123}\0'
        self.assertNotEqual(r.raw_environment_semantics(a),
                            r.raw_environment_semantics(a.replace(b'active', b'disabled')))
        self.assertNotEqual(r.raw_environment_semantics(a),
                            r.raw_environment_semantics(a.replace(b'123', b'456')))

    def test_unknown_pm2_json_key_stays_opaque(self):
        a = b'PM2_CONFIG={"status":"online"}\0'
        self.assertNotEqual(r.raw_environment_semantics(a),
                            r.raw_environment_semantics(a.replace(b'online', b'stopped')))

    def test_raw_pm2_env_application_json_string_is_exact(self):
        a = r.encode({'status':'online','env':{'APP':'{"status":"active"}'}}).rstrip()
        raw = b'pm2_env='+a+b'\0'
        self.assertNotEqual(r.raw_environment_semantics(raw),
                            r.raw_environment_semantics(raw.replace(b'active',b'disabled')))

    def test_malformed_pm2_env_failclosed(self):
        for raw in (b'pm2_env=opaque\0', b'pm2_env=[]\0'):
            with self.assertRaises(r.ReleaseError):
                r.raw_environment_semantics(raw)

    def adapter_cfg(self):
        return replace(self.cfg, api=Path(r.API_PATH))

    def test_verified_pm2_reload_fixed_slot_path_source_hash(self):
        cfg = self.adapter_cfg()
        for slot in (188, '190', True):
            with self.assertRaisesRegex(r.ReleaseError, 'FIXED_SLOT'):
                r.verified_pm2_reload(cfg, slot, self.m['beforeApiSha256'])
        with self.assertRaisesRegex(r.ReleaseError, 'FIXED_API_PATH'):
            r.verified_pm2_reload(self.cfg, 190, self.m['beforeApiSha256'])
        with patch.object(r, 'regular', return_value=b'wrong-source'):
            with self.assertRaisesRegex(r.ReleaseError, 'SOURCE_HASH'):
                r.verified_pm2_reload(cfg, 190, self.m['beforeApiSha256'])
        self.assertFalse(self.reload_calls)

    def test_verified_pm2_reload_mock_transport_and_timeout(self):
        cfg = self.adapter_cfg(); sha = self.m['beforeApiSha256']
        event = {'id':190,'beforePid':7,'beforeRestart':5,'afterPid':8,'afterRestart':6}
        with patch.object(r, 'verify_pm2_sources') as verify, patch.object(r.subprocess, 'run',
                return_value=subprocess.CompletedProcess([],0,r.encode(event),b'')) as run:
            self.assertEqual(r.verified_pm2_reload(cfg,190,sha), event)
            argv = run.call_args.args[0]
            self.assertEqual(argv[1:3], ['-e',r.PM2_RELOAD_RPC])
            self.assertEqual(argv[3:6], ['190',r.API_PATH,sha])
            self.assertEqual(run.call_args.kwargs['timeout'],45)
            self.assertEqual(verify.call_count,2)
        with patch.object(r, 'verify_pm2_sources'), patch.object(r.subprocess, 'run',
                side_effect=subprocess.TimeoutExpired('mock',45,stderr=b'never-output')):
            with self.assertRaisesRegex(r.ReleaseError,'VERIFIED_PM2_RPC_TIMEOUT') as caught:
                r.verified_pm2_reload(cfg,190,sha)
            self.assertNotIn('never-output',str(caught.exception))

    def test_verified_pm2_invalid_callback_or_failure_never_passes(self):
        cfg = self.adapter_cfg()
        for result in (subprocess.CompletedProcess([],2,b'',b'never-output'),
                       subprocess.CompletedProcess([],0,r.encode({'id':190}),b'')):
            with patch.object(r,'verify_pm2_sources'), patch.object(r.subprocess,'run',return_value=result):
                with self.assertRaises(r.ReleaseError) as caught:
                    r.verified_pm2_reload(cfg,190,self.m['beforeApiSha256'])
                self.assertNotIn('never-output',str(caught.exception))

    def test_verified_rpc_source_fixed_call_order_and_no_fallback(self):
        source = r.PM2_RELOAD_RPC
        self.assertEqual(source.count("client.call('reloadProcessId'"),1)
        self.assertEqual(source.count("client.call('getMonitorData'"),2)
        self.assertIn("{id:id,env:{}}",source)
        self.assertLess(source.index("client.call('getMonitorData'"), source.index("client.call('reloadProcessId'"))
        self.assertIn("after.restarts!==before.restarts+1",source)
        for forbidden in ('pm2.connect(', 'launchDaemon', 'restartProcessId', 'updateEnv', 'spawn(', '/usr/lib/'):
            self.assertNotIn(forbidden,source)

    def test_verified_listener_fixed_get_body_api_and_timeout(self):
        cfg = self.adapter_cfg(); api = self.api_before; sha = r.H(api)
        original = r.regular
        def read(path):
            return api if Path(path) == cfg.api else original(path)
        body = (cfg.front/'index.html').read_bytes()
        with patch.object(r,'regular',side_effect=read), patch.object(r.subprocess,'run',
                return_value=subprocess.CompletedProcess([],0,body,b'')) as run:
            self.assertTrue(r.verified_front_listener(cfg,sha))
            argv = run.call_args.args[0]
            self.assertEqual(argv[-1], 'http://127.0.0.1:3000/')
            self.assertIn('--noproxy',argv); self.assertIn('*',argv)
            self.assertEqual(argv[argv.index('--request')+1],'GET')
            self.assertEqual(run.call_args.kwargs['timeout'],15)
        with patch.object(r,'regular',side_effect=read), patch.object(r.subprocess,'run',
                return_value=subprocess.CompletedProcess([],0,b'wrong-body',b'never-output')):
            with self.assertRaisesRegex(r.ReleaseError,'BODY_HASH'):
                r.verified_front_listener(cfg,sha)
        with patch.object(r,'regular',side_effect=read):
            with self.assertRaisesRegex(r.ReleaseError,'API_HASH'):
                r.verified_front_listener(cfg,'0'*64)

    def test_production_config_fixed_seven_only_not_global_defaults(self):
        data = {'schema':'r5-seven-fixed-links-verified-v1',
                'records':{a:{'target':t,'link':t} for a,t in r.R5_LINKS.items()}}
        with patch.object(r,'regular',return_value=r.encode(data)) as read:
            cfg = r.production_config()
            read.assert_called_once_with(r.R5_LINK_EVIDENCE)
        self.assertEqual(len(cfg.extra_links),7)
        self.assertEqual(set(map(str,cfg.extra_protected)),set(r.PM2_SOURCE_PINS) | {
            '/opt/config/dianzi51-admin/runtime.env', '/opt/config/dianzi51/runtime.env',
            '/root/.pm2/dump.pm2'})
        self.assertEqual(r.Config().extra_links,())
        data['records'].pop(next(iter(data['records'])))
        with patch.object(r,'regular',return_value=r.encode(data)):
            with self.assertRaisesRegex(r.ReleaseError,'FIXED_SEVEN'):
                r.production_config()

    def test_cli_injects_verified_adapters_not_stub(self):
        output = type('Output',(),{'buffer':type('Buffer',(),{'write':lambda self,data:None})()})()
        with (patch.object(r,'production_config',return_value=self.cfg), patch.object(r,'Controller') as ctor,
                patch.object(sys,'argv',['release.py','--capture']), patch.object(sys,'stdout',output)):
            ctor.return_value.capture.return_value = {'productionWrites':0}
            r.main()
            ctor.assert_called_once_with(self.cfg,reload_adapter=r.verified_pm2_reload,
                                         api_health_reader=r.verified_front_listener)
            ctor.return_value.capture.assert_called_once_with()
            ctor.return_value.apply.assert_not_called()

    def test_verified_readonly_adapters_preflight_ready_without_reload(self):
        self.controller.reload_adapter = r.verified_pm2_reload
        with patch.object(r,'verify_pm2_sources') as verify, patch.object(r.subprocess,'run'):
            # Mock ONLY listener execution; process_reader bypasses transport with saved snapshot.
            rows = r.decode((self.cfg.package/'capture.json').read_bytes())['processes']
            self.controller.process_reader = lambda cfg: copy.deepcopy(rows)
            with patch.object(r,'verified_front_listener',return_value=True) as listener:
                self.controller.api_health_reader = listener
                result = self.preflight()
                listener.assert_called_once_with(self.cfg,self.m['beforeApiSha256'])
            self.assertTrue(result['reloadAdapterReady'])
            self.assertTrue(result['apiHealthAdapterReady'])
            verify.assert_called_once_with(self.cfg,self.m['beforeApiSha256'])
        self.assertFalse(self.reload_calls); self.assertFalse(self.cfg.receipt.exists())


    def test_verified_rpc_vm_mock_execution_success_and_failclosed(self):
        harness = r'''
const vm=require('vm'),spec=JSON.parse(process.argv[1]);
let calls=[],out='',err='',exit=null,monitor=0;
const rows=[{pm_id:190,name:'dianzi51',pid:7,pm2_env:{PORT:'3000',env:{PORT:'3000'},
 status:'online',pm_exec_path:spec.api,exec_mode:'cluster_mode',restart_time:5}}];
if(spec.mode==='before-status')rows[0].pm2_env.status='stopped';
if(spec.mode==='before-port')rows[0].pm2_env.PORT='3001';
if(spec.mode==='before-script')rows[0].pm2_env.pm_exec_path='foreign';
if(spec.mode==='before-mode')rows[0].pm2_env.exec_mode='fork_mode';
const files={...spec.pins,[spec.api]:spec.sha};
const fs={constants:{O_RDONLY:0,O_NOFOLLOW:1},openSync:p=>p,closeSync:()=>{},
 fstatSync:()=>({isFile:()=>true}),statSync:()=>({isSocket:()=>true}),
 readFileSync:p=>p.endsWith('pm2.pid')?'9':files[p]};
const req={on:()=>{},connect:p=>calls.push(['socket',p]),close:()=>{}};
class Client {call(method,args,cb){
 calls.push([method,args]);
 if(method==='getMonitorData'){
  monitor++;
  if(monitor===2){rows[0].pid=spec.mode==='samepid'?7:8;
   rows[0].pm2_env.restart_time=spec.mode==='restart'?8:6;
   if(spec.mode==='after-status')rows[0].pm2_env.status='stopped';}
  return cb(null,rows);
 }
 if(method!=='reloadProcessId')throw Error('unexpected RPC');
 return cb(spec.mode==='callback-error'?Error('private-env'):null);
}}
const fakeProcess={argv:['node','190',spec.api,spec.sha,JSON.stringify(spec.pins)],
 env:{HOME:'/mock'},kill:()=>{},stdout:{write:(s,cb)=>{out+=s;if(cb)cb()}},
 stderr:{write:s=>{err+=s}},exit:code=>{exit=code;throw Error('mock-exit')}};
const crypto={createHash:()=>({update:v=>({digest:()=>v})})};
const modules={'fs':fs,'path':require('path'),'crypto':crypto,
 '/usr/local/lib/node_modules/pm2/modules/pm2-axon':{socket:()=>req},
 '/usr/local/lib/node_modules/pm2/modules/pm2-axon-rpc':{Client}};
try{vm.runInNewContext(spec.source,{require:name=>{if(!(name in modules))throw Error('module');return modules[name]},
 process:fakeProcess,setTimeout:()=>{}},{timeout:1000})}catch(e){if(e.message!=='mock-exit')throw e}
process.stdout.write(JSON.stringify({calls,out,err,exit}));
'''
        for mode in ('ok','before-status','before-port','before-script','before-mode',
                     'samepid','restart','callback-error','after-status'):
            with self.subTest(mode=mode):
                spec = {'mode':mode,'source':r.PM2_RELOAD_RPC,'pins':r.PM2_SOURCE_PINS,
                        'api':r.API_PATH,'sha':self.m['beforeApiSha256']}
                result = LOCAL_RUN(['node','-e',harness,json.dumps(spec)],
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=3)
                self.assertEqual(result.returncode,0,result.stderr)
                value = r.decode(result.stdout)
                reloads = [c for c in value['calls'] if c[0]=='reloadProcessId']
                if mode.startswith('before-'):
                    self.assertEqual(reloads,[])
                else:
                    self.assertEqual(reloads,[['reloadProcessId',{'id':190,'env':{}}]])
                if mode=='ok':
                    self.assertEqual(value['exit'],0)
                    self.assertEqual(r.decode(value['out'].encode())['afterRestart'],6)
                    self.assertEqual([c[0] for c in value['calls']],
                                     ['socket','getMonitorData','reloadProcessId','getMonitorData'])
                else:
                    self.assertEqual(value['exit'],2)
                    self.assertEqual(value['out'],'')
                    self.assertEqual(value['err'],'VERIFIED_PM2_RPC_FAILED')


if __name__ == '__main__':
    unittest.main()
