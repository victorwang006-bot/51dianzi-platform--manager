#!/usr/bin/env python3
"""Local synthetic files/processes/HTTP only; never connects to production."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
WORK = Path('/home/ubuntu/work/profile-staff-20261114')
DRIVER = HERE / 'activate-profile-staff-20261114.py'
RELOAD = HERE / 'reload-profile-staff-api-20261114.cjs'
spec = importlib.util.spec_from_file_location('profile_staff_activate', DRIVER)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

class Response:
    def __init__(self, status, body): self.status, self.body = status, body
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def read(self): return self.body

class Activation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root, self.public = self.base / 'ops', self.base / 'public'
        for folder in [self.root / 'candidate/assets', self.root / 'candidate/api', self.public / 'assets']: folder.mkdir(parents=True)
        self.coord = self.base / 'coord.json'
        driver.save(self.coord, {'shared_release_active': False, 'unrelated': {'keep': 42}})
        (self.public / 'index.html').write_text('old html')
        (self.public / 'assets/old.js').write_text('unchanged old asset')
        (self.root / 'candidate/index.html').write_text('new html')
        self.assets = ['assets/profile-staff-layout.js', 'assets/profile-staff-profile.js', 'assets/profile-staff-staff.js', 'assets/profile-staff-style.css']
        for item in self.assets: (self.root / 'candidate' / item).write_text('bounded candidate ' + item)
        for item in [DRIVER, RELOAD]: shutil.copy2(item, self.root / item.name)
        self.admin_path, self.front_path = str(self.base / 'admin.js'), str(self.base / 'front.js')
        Path(self.admin_path).write_text('old admin')
        Path(self.front_path).write_text('protected front')
        (self.root / 'candidate/api/admin-index.js').write_text('new admin')
        self.backend = {'processName': 'dianzi51-admin', 'path': self.admin_path, 'relative': 'api/admin-index.js', 'sha256': driver.sha(self.root / 'candidate/api/admin-index.js'), 'beforeSha256': driver.sha(self.admin_path)}
        self.before = []
        for index, name in [(190, 'dianzi51'), (191, 'dianzi51-admin'), (192, 'dianzi51-admin'), (193, 'dianzi51'), (194, 'dianzi51'), (200, 'dianzi51')] + [(201 + i, 'worker-' + str(i)) for i in range(6)]:
            self.before.append({'id': index, 'name': name, 'pid': 1000 + index, 'status': 'online', 'script': self.admin_path if name == 'dianzi51-admin' else self.front_path if name == 'dianzi51' else '/original/worker', 'cwd': '/original/' + name, 'execMode': 'cluster_mode' if name in ['dianzi51', 'dianzi51-admin'] else 'fork_mode', 'environmentHash': 'unchanged-env-' + name})
        self.current, self.reloaded = copy.deepcopy(self.before), []
        for name, proof in [('candidate-proof.json', {'status': 'PASS', **{flag: True for flag in driver.PROOF_FLAGS}}), ('backend-candidate-proof.json', {'status': 'PASS', 'sourceBound': True, 'unrelatedBytesUnchanged': True})]: driver.save(self.root / name, proof)
        evidence = ['candidate-proof.json', 'backend-candidate-proof.json', RELOAD.name]
        self.manifest = {'ownerTask': driver.TASK, 'files': [{'relative': name, 'sha256': driver.sha(self.root / 'candidate' / name)} for name in ['index.html', *self.assets]], 'coreAssetPaths': self.assets.copy(), 'backendFiles': [self.backend], 'driverSha256': driver.sha(DRIVER), 'evidenceHashes': {name: driver.sha(self.root / name) for name in evidence}, 'tscPassed': True, 'sourceTestFailures': 0, 'candidateTestsPassed': True, 'backendCandidateTestsPassed': True, 'reviewPassed': True, 'beforeHtmlSha256': driver.sha(self.public / 'index.html'), 'protectedFiles': [{'path': self.front_path, 'sha256': driver.sha(self.front_path)}], 'untouchedFrontApiSha256': driver.sha(self.front_path), 'baselineAssets': [{'relative': 'assets/old.js', 'sha256': driver.sha(self.public / 'assets/old.js')}], 'baselineProcesses': copy.deepcopy(self.before), 'dependencies': ['/assets/old.js', *['/' + item for item in self.assets]]}
        self.save_manifest()
        self.stack = contextlib.ExitStack()
        self.stack.enter_context(patch.multiple(driver, ROOT=self.root, PUBLIC=self.public, COORD=self.coord, APIS={'dianzi51-admin': self.admin_path}, FRONT_API=self.front_path))
        self.stack.enter_context(patch.object(driver, 'processes', side_effect=lambda: copy.deepcopy(self.current)))
        self.stack.enter_context(patch.object(driver, 'get', side_effect=self.http))
        self.stack.enter_context(patch.object(driver, 'reload_instance', side_effect=self.reload))
        self.stack.enter_context(patch.object(driver.urllib.request, 'urlopen', side_effect=self.auth_http))
        self.stack.enter_context(patch.object(driver.fcntl, 'flock'))
        native_open = open
        def local_open(filename, *args, **kwargs):
            if str(filename).startswith('/var/lock/'): filename = self.base / Path(filename).name
            return native_open(filename, *args, **kwargs)
        self.stack.enter_context(patch('builtins.open', side_effect=local_open))
    def tearDown(self): self.stack.close(); self.temp.cleanup()
    def save_manifest(self): driver.save(self.root / 'manifest.json', self.manifest)
    def row(self, index=191): return next(row for row in self.current if row['id'] == index)
    def http(self, url):
        body = b'unchanged front site' if url.startswith('https://www.') else (self.public / url.split('51dianzi.com/', 1)[1].split('?', 1)[0]).read_bytes() if '/assets/' in url else (self.public / 'index.html').read_bytes()
        return {'url': url, 'status': 200, 'sha256': hashlib.sha256(body).hexdigest()}, body
    def auth_http(self, request, timeout):
        self.assertEqual(request.get_header('User-agent'), 'Mozilla/5.0')
        self.assertIsNone(request.get_header('Cookie')); self.assertIsNone(request.get_header('Authorization'))
        self.assertEqual(request.get_method(), 'GET')
        self.assertIn(request.full_url.split('/api/trpc/')[1], ['personalCenter.profile', 'adminUser.list'])
        return Response(401, json.dumps({'error': {'json': {'data': {'code': 'UNAUTHORIZED'}}}}).encode())
    def reload(self, row, rollback=False):
        self.assertIn(row['id'], [191, 192])
        self.assertEqual(row['name'], 'dianzi51-admin')
        self.reloaded.append((row['id'], rollback))
        intents = json.loads((self.root / 'reload-intents.json').read_text())
        self.assertTrue(any(intent['ownerTask'] == driver.TASK and intent['id'] == row['id'] and intent['apiHash'] == self.backend['sha256'] for intent in intents))
        self.row(row['id']).update(pid=2000 + row['id'], status='online')
    def run_driver(self, *args):
        with patch.object(sys, 'argv', ['activate', *args]), contextlib.redirect_stdout(io.StringIO()): driver.main()
    def no_business_change(self):
        self.assertEqual(Path(self.front_path).read_text(), 'protected front')
        self.assertEqual((self.public / 'assets/old.js').read_text(), 'unchanged old asset')
        for old in self.before:
            if old['name'] != 'dianzi51-admin': self.assertEqual(self.row(old['id']), old)
    def test_plan_has_no_process_network_or_record_IO(self):
        with patch.object(driver, 'processes', side_effect=AssertionError('PM2 forbidden')), patch.object(driver, 'get', side_effect=AssertionError('HTTP forbidden')): self.run_driver()
        self.assertFalse((self.root / 'activation-started.json').exists())
    def test_success_only_two_original_admin_ids(self):
        self.run_driver('--apply')
        self.assertEqual(self.reloaded, [(191, False), (192, False)])
        self.no_business_change()
        self.assertFalse(json.loads(self.coord.read_text())['shared_release_active'])
        receipt = json.loads((self.root / 'verified.json').read_text())
        self.assertEqual(receipt['rollingReloadInstances'], 2); self.assertEqual(len(receipt['newProtectedApiHealth']), 2)
    def test_foreign_coord_blocks_every_write(self):
        driver.save(self.coord, {'shared_release_active': True, 'window': {'owner_task': 'foreign'}})
        with self.assertRaises(SystemExit): self.run_driver('--apply')
        self.assertFalse(self.reloaded); self.assertEqual(Path(self.admin_path).read_text(), 'old admin')
    def test_html_or_admin_baseline_CAS_drift_is_not_overwritten(self):
        for item in [self.public / 'index.html', Path(self.admin_path)]:
            original = item.read_text(); item.write_text('foreign version')
            with self.assertRaises(SystemExit): self.run_driver('--apply')
            self.assertEqual(item.read_text(), 'foreign version'); self.assertFalse(self.reloaded)
            item.write_text(original)
    def test_front_API_and_worker_drift_refuse_activation(self):
        Path(self.front_path).write_text('foreign front')
        with self.assertRaises(SystemExit): self.run_driver('--apply')
        self.assertFalse(self.reloaded); Path(self.front_path).write_text('protected front')
        self.row(201)['pid'] += 1
        with self.assertRaises(SystemExit): self.run_driver('--apply')
        self.assertFalse(self.reloaded)
    def test_front_protection_and_extra_static_or_API_scope_refused(self):
        self.manifest['protectedFiles'] = []; self.save_manifest()
        with self.assertRaises(RuntimeError): self.run_driver()
        self.manifest['protectedFiles'] = [{'path': self.front_path, 'sha256': driver.sha(self.front_path)}]
        self.manifest['backendFiles'].append({**self.backend, 'processName': 'dianzi51'}); self.save_manifest()
        with self.assertRaises(RuntimeError): self.run_driver()
    def test_foreign_original_admin_id_is_refused(self):
        self.row()['id'] = 999
        with self.assertRaises(SystemExit): self.run_driver('--apply')
        self.assertFalse(self.reloaded)
    def test_post_HTML_failure_restores_exact_HTML_admin_and_closes_coord(self):
        original = self.http
        def fail(url):
            if (self.public / 'index.html').read_text() == 'new html' and url.endswith('/login'): raise RuntimeError('offline health failure')
            return original(url)
        with patch.object(driver, 'get', side_effect=fail):
            with self.assertRaises(SystemExit): self.run_driver('--apply')
        self.assertEqual((self.public / 'index.html').read_text(), 'old html'); self.assertEqual(Path(self.admin_path).read_text(), 'old admin')
        self.assertEqual(self.reloaded, [(191, False), (192, False), (191, True), (192, True)])
        self.no_business_change(); self.assertFalse(json.loads(self.coord.read_text())['shared_release_active'])
    def test_interrupted_first_reload_only_recovers_persisted_original_id(self):
        def fail_once(row, rollback=False):
            if not rollback: self.row(row['id']).update(status='errored', pid=0); raise RuntimeError('offline reload interruption')
            self.reload(row, True)
        with patch.object(driver, 'reload_instance', side_effect=fail_once):
            with self.assertRaises(SystemExit): self.run_driver('--apply')
        self.assertEqual(self.reloaded, [(191, True)]); self.assertEqual(Path(self.admin_path).read_text(), 'old admin')
        self.no_business_change(); self.assertFalse(json.loads(self.coord.read_text())['shared_release_active'])
    def test_failed_recovery_keeps_coord_occupied(self):
        def fail(row, rollback=False): self.row(row['id']).update(status='errored', pid=0); raise RuntimeError('offline recovery failed')
        with patch.object(driver, 'reload_instance', side_effect=fail):
            with self.assertRaises(SystemExit): self.run_driver('--apply')
        state = json.loads(self.coord.read_text()); self.assertTrue(state['shared_release_active']); self.assertEqual(state['window']['status'], 'recovery-required')
        self.no_business_change()
    def test_foreign_admin_after_reload_failure_is_never_restored_over(self):
        def fail(row, rollback=False): self.row(row['id']).update(status='stopped', pid=0); Path(self.admin_path).write_text('foreign admin'); raise RuntimeError('offline foreign drift')
        with patch.object(driver, 'reload_instance', side_effect=fail):
            with self.assertRaises(SystemExit): self.run_driver('--apply')
        self.assertEqual(Path(self.admin_path).read_text(), 'foreign admin'); self.assertTrue(json.loads(self.coord.read_text())['shared_release_active'])
    def test_generic403_404_success_and_nonJSON_cannot_fake_route_health(self):
        for status, body, succeeds in [(401, b'{"error":{"json":{"data":{"code":"UNAUTHORIZED"}}}}', True), (403, b'{"error":{"data":{"code":"FORBIDDEN"}}}', True), (403, b'{"error":"Forbidden"}', False), (404, b'{"error":{"code":"NOT_FOUND"}}', False), (200, b'{"result":{}}', False), (401, b'<!doctype html>', False)]:
            accepted = False
            with patch.object(driver.urllib.request, 'urlopen', return_value=Response(status, body)):
                try: driver.protected_api_health('dianzi51-admin', 'adminUser.list'); accepted = True
                except (RuntimeError, json.JSONDecodeError): pass
            self.assertEqual(accepted, succeeds)
        with self.assertRaises(RuntimeError): driver.protected_api_health('dianzi51')
        with self.assertRaises(RuntimeError): driver.protected_api_health('dianzi51-admin', 'adminUser.toggleStatus')

if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Activation))
    report = {'status': 'PASS' if result.wasSuccessful() else 'FAIL', 'passed': result.testsRun - len(result.failures) - len(result.errors), 'failed': len(result.failures) + len(result.errors), 'driverSha256': driver.sha(DRIVER), 'reloadHelperSha256': driver.sha(RELOAD), 'actualNetworkIO': 0, 'productionRecordWrites': 0, 'syntheticFilesystemAndProcessFixturesOnly': True, 'strictAuthenticationHealthRetained': True, 'frontAPIAndFourFrontPIDsProtected': True, 'globalRestart': False}
    (WORK / 'activation-tests.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report)); sys.exit(0 if result.wasSuccessful() else 1)
