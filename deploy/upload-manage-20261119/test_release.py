#!/usr/bin/env python3
"""Offline tests: every writable path is below TemporaryDirectory.
No SSH/network/real production absolute path access. No PM2 CLI or reload.
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

SPEC = importlib.util.spec_from_file_location('compact_release', Path(__file__).with_name('release.py'))
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
            nginx=self.root/'nginx', ops=self.root/'ops', proc=self.root/'proc')
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
            self.raw_rows.append({'pm_id': i, 'name': name, 'pid': pid, 'pm2_env': {
                'status': 'online', 'pm_exec_path': str(script), 'pm_cwd': str(folder.parent),
                'exec_mode': 'cluster_mode' if i < 6 else 'fork_mode', 'restart_time': 3,
                'env': {'SECRET_TEST_TOKEN': 'never-output', 'SHLVL': '1', 'pm_uptime': 1},
                'SECRET_TEST_TOKEN': 'never-output', 'pm_uptime': 1,
                'axm_monitor': {'heap': 100}, 'created_at': 1}})
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
        self.controller = r.Controller(self.cfg, get_reader=self.static_get)
        self.make_package(css=False)

    def static_get(self, host, name):
        self.http_calls.append((host, name))
        root = self.cfg.public if host == 'admin.51dianzi.com' else self.cfg.front
        return (root/(name or 'index.html')).read_bytes()

    def make_package(self, css=False):
        for p in sorted(self.cfg.package.rglob('*'), reverse=True):
            if p.is_file():
                p.unlink()
            elif p.is_dir():
                p.rmdir()
        capture = self.controller.capture()
        (self.cfg.package/'capture.json').write_bytes(r.encode(capture))
        (self.cfg.package/'before-index.html').write_bytes(self.before)
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
            'cssRelative': css_name, 'packageFiles': {}}
        self.repin()

    def repin(self):
        self.m['packageFiles'] = {p.relative_to(self.cfg.package).as_posix(): r.H(p.read_bytes())
            for p in self.cfg.package.rglob('*') if p.is_file() and p.name not in ('manifest.json', 'review.json')}
        mb = r.encode(self.m)
        (self.cfg.package/'manifest.json').write_bytes(mb)
        self.manifest_sha = r.H(mb)
        self.review = {'status': 'passed', 'independent': True, 'manifestSha256': self.manifest_sha,
                       'controllerSha256': self.controller.controller_hash, 'reviewer': 'independent test reviewer'}
        self.review_bytes = r.encode(self.review)
        (self.cfg.package/'review.json').write_bytes(self.review_bytes)
        self.review_sha = r.H(self.review_bytes)

    def preflight(self):
        return self.controller.preflight(self.cfg.package, self.manifest_sha)

    def apply(self):
        return self.controller.apply(self.cfg.package, self.manifest_sha, self.review_sha)

    def unchanged_originals(self, capture, except_html=False):
        for name, record in capture['protectedFiles'].items():
            if except_html and name == str(self.cfg.html):
                continue
            self.assertEqual(r.describe(Path(name), allow_link=True), record, name)

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
        self.assertEqual(result['processReloads'], 0)
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
        self.unchanged_originals(capture)
        for a in self.assets:
            self.assertTrue((self.cfg.public/a['relative']).is_file())
        state = r.decode(self.cfg.coord.read_bytes())
        self.assertFalse(state['shared_release_active'])
        self.assertEqual(state['window']['outcome'], 'failed-rolled-back')
        self.assertEqual(state['window']['status'], 'closed')
        self.assertFalse(state['window']['needsOperatorRecovery'])
        failure = r.decode((self.cfg.receipt/'failure.json').read_bytes())
        self.assertTrue(failure['assetsRetained'])
        self.assertEqual(failure['processReloads'], 0)
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
        def fault(path, before, after, scratch):
            nonlocal fired
            original(path, before, after, scratch)
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
        def fault(path, before, after, scratch):
            nonlocal fired
            original(path, before, after, scratch)
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


if __name__ == '__main__':
    unittest.main()
