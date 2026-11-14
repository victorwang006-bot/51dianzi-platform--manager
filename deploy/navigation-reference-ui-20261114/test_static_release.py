#!/usr/bin/env python3
"""Offline unittest: real driver control flow, temp filesystem and mocked read-only IO."""
from contextlib import ExitStack
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('tested_static_release', TOOLS/'static-release.py')
D = importlib.util.module_from_spec(spec)
spec.loader.exec_module(D)
specp = importlib.util.spec_from_file_location('tested_prepare_static', TOOLS/'prepare-static.py')
P = importlib.util.module_from_spec(specp)
specp.loader.exec_module(P)


class StaticRelease(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root, self.public = self.base/'ops', self.base/'public'
        self.root.mkdir()
        (self.public/'assets').mkdir(parents=True)
        self.coord = self.base/'coord.json'
        self.before, self.after, self.home = b'<html>before</html>', b'<html>phase1</html>', b'<html>home unchanged</html>'
        (self.public/'index.html').write_bytes(self.before)
        apis = {}
        api_sha = {}
        for k in ('admin', 'front'):
            p = self.base/(k+'.js')
            p.write_bytes(k.encode())
            apis[k], api_sha[k] = str(p), D.sha(p)
        protected = []
        for n in ('homepage.html', 'nginx.conf', 'dump.pm2'):
            p = self.base/n
            p.write_bytes(n.encode())
            protected.append({'path': str(p), 'sha256': D.sha(p)})
        protected.append({'path': apis['front'], 'sha256': api_sha['front']})
        lock_paths = [self.base/'one.lock', self.base/'two.lock']
        for p in lock_paths:
            p.touch()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for k, v in {'ROOT': self.root, 'PUBLIC': self.public, 'COORD': self.coord, 'API_PATHS': apis, 'API_SHA': api_sha, 'PROTECTED': {r['path'] for r in protected}, 'BEFORE_SHA': D.digest(self.before), 'LOCKS': tuple(map(str, lock_paths))}.items():
            self.stack.enter_context(patch.object(D, k, v))
        rows = []
        for pid in (0, 190, 191, 192, 193, 200, 201, 202, 203, 204, 205, 206):
            admin = pid in (191, 192)
            rows.append({'id': pid, 'name': 'dianzi51-admin' if admin else 'worker-'+str(pid), 'pid': 10000+pid, 'status': 'online', 'script': apis['admin' if admin else 'front'], 'cwd': str(self.base), 'execMode': 'cluster_mode', 'environmentHash': D.digest(b'private-env-not-exported')})
        self.rows = rows
        self.pm2_calls = []
        self.stack.enter_context(patch.object(D, 'existing_pm2'))
        def pm2(args, **kwargs):
            self.pm2_calls.append(args)
            self.assertEqual(args, ['pm2', 'jlist'])
            return json.dumps([{'pm_id': r['id'], 'name': r['name'], 'pid': r['pid'], 'pm2_env': {'status': r['status'], 'pm_exec_path': r['script'], 'pm_cwd': r['cwd'], 'exec_mode': r['execMode'], 'env': {'secret': 'never exported'}}} for r in rows]).encode()
        self.stack.enter_context(patch.object(D.subprocess, 'check_output', side_effect=pm2))
        # Match the actual driver's environment canonicalization exactly.
        envhash = D.digest(json.dumps({'secret': 'never exported'}, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode())
        for r in rows:
            r['environmentHash'] = envhash
        self.http = []
        def http(url):
            self.http.append(url)
            self.assertTrue(url == D.HOME or url.startswith(D.ADMIN+'/'))
            data = self.home if url == D.HOME else (self.public/url[len(D.ADMIN)+1:]).read_bytes() if url.startswith(D.ADMIN+'/assets/') else (self.public/'index.html').read_bytes()
            return {'url': url, 'status': 200, 'sha256': D.digest(data), 'contentType': 'text/html' if url == D.HOME or not url.startswith(D.ADMIN+'/assets/') else 'application/javascript'}, data
        self.stack.enter_context(patch.object(D, 'get', side_effect=http))
        assets = []
        for n in range(114):
            p = self.public/'assets'/('old-'+str(n)+'.js')
            p.write_bytes(str(n).encode())
            assets.append({'relative': p.relative_to(self.public).as_posix(), 'sha256': D.sha(p)})
        D.save(self.coord, {'shared_release_active': False, 'window': {'owner_task': 'prior'}, 'window_history': [], 'untouched': {'keep': 1}})
        self.baseline = {'capturedAtUtc': D.now(), 'beforeHtmlSha256': D.BEFORE_SHA, 'api': api_sha, 'apiPaths': apis, 'publicRoot': str(self.public), 'allOnline': True, 'processCount': 12, 'processes': rows, 'sharedReleaseActive': False, 'baselineAssets': assets, 'protectedFiles': protected, 'productionRecordWrites': 0, 'databaseAccess': False, 'environmentValuesExported': False, 'coordSha256': D.sha(self.coord), 'homepage': {'url': D.HOME, 'status': 200, 'sha256': D.digest(self.home)}}
        payload = {'static-release.py': (TOOLS/'static-release.py').read_bytes(), 'prepare-static.py': (TOOLS/'prepare-static.py').read_bytes(), 'baseline.json': D.encoded(self.baseline), 'index-before.html': self.before}
        files = [{'relative': 'index.html', 'sha256': D.digest(self.after)}]
        payload['candidate/index.html'] = self.after
        for n, ext in enumerate(('js', 'js', 'js', 'css')):
            data = ('phase1 asset '+str(n)).encode()
            name = 'assets/new-'+str(n)+'.'+ext
            files.append({'relative': name, 'sha256': D.digest(data)})
            payload['candidate/'+name] = data
        sources, blobs = {}, {}
        for n in range(100):
            name, data = 'server/old-'+str(n)+'.ts', ('old preserved '+str(n)).encode()
            sources[name] = D.digest(data)
            blobs[name] = hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
            payload['source-snapshot/'+name] = data
        pins = {'sourceHashes': {next(iter(sources)): next(iter(sources.values()))}}
        payload['source-pins.json'] = D.encoded(pins)
        receipt = {'status': 'PREPARED_GIT_SOURCE_MATCH', 'sourceCommit': 'a'*40, 'gitCommit': 'a'*40, 'branch': 'main', 'sourceHashes': sources, 'sourceBlobIds': blobs, 'files': files}
        payload['git-source-receipt.json'] = D.encoded(receipt)
        qa = {'status': 'PASS', 'failed': 0, 'passed': 9, 'checks': [{'status': 'PASS', 'name': str(n)} for n in range(9)], 'zeroIO': {'network': 0, 'database': 0, 'nativeMutations': 0, 'browser': False, 'ssh': False}}
        payload['evidence/native-tests.json'] = D.encoded(qa)
        front = dict.fromkeys(D.FRONT_FLAGS, True)
        front.update(status='PASS', phase='ui-only', referenceFetchDisabled=True, noNewReferenceTransport=True, typeOnlyDependencies={}, files=files, sourceHashes=pins['sourceHashes'], htmlSha256=D.digest(self.after), beforeHtmlSha256=D.BEFORE_SHA, actualCandidateQA={'reportSha256': D.digest(payload['evidence/native-tests.json']), 'passed': 9, 'failed': 0})
        payload['evidence/frontend-proof.json'] = D.encoded(front)
        self.manifest = {'schema': 1, 'phase': 'phase1-static-navigation-reference-ui', 'ownerTask': D.TASK, 'opsRoot': str(self.root), 'publicRoot': str(self.public), 'sourceCommit': 'a'*40, 'sourceBranch': 'main', 'beforeHtmlSha256': D.BEFORE_SHA, 'htmlSha256': D.digest(self.after), 'files': files, 'sourceHashes': sources, 'sourceBlobIds': blobs, 'packageHashes': {k: D.digest(v) for k, v in payload.items()}}
        for name, data in payload.items():
            p = self.root/name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
        D.save(self.root/'manifest.json', self.manifest)
        self.mh = D.sha(self.root/'manifest.json')

    def apply(self):
        return D.apply(self.root, self.manifest, self.baseline, self.mh)

    def owner(self, attempt='one'):
        return {'owner_task': D.TASK, 'attempt': attempt, 'manifestSha256': self.mh, 'openedAtUtc': 'same-time', 'status': 'activating'}

    def test_path_and_symlink_refused(self):
        for name in ('/etc/passwd', '../a', 'assets/../a', 'assets//a', 'assets/a?x', 'assets/a\\b', '.', ''):
            with self.assertRaises(RuntimeError):
                D.safe(name)
        (self.root/'evil').symlink_to(self.public, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            D.regular(self.root, 'evil/index.html')

    def test_manifest_pin_and_source_snapshot_cas(self):
        D.package(self.root, self.mh)
        with self.assertRaises(RuntimeError):
            D.package(self.root, 'f'*64)
        (self.root/'source-snapshot/server/old-0.ts').write_bytes(b'drift')
        with self.assertRaises(RuntimeError):
            D.package(self.root, self.mh)

    def test_coord_fresh_cas_foreign_untouched(self):
        before = self.coord.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'CAS'):
            D.cas_coord('f'*64, {'window': 'wrong'})
        self.assertEqual(before, self.coord.read_bytes())
        D.save(self.coord, {'shared_release_active': True, 'window': self.owner('foreign')})
        before = self.coord.read_bytes()
        with self.assertRaises(RuntimeError):
            self.apply()
        self.assertEqual(before, self.coord.read_bytes())
        self.assertEqual((self.public/'index.html').read_bytes(), self.before)
        self.assertEqual(len(list((self.public/'assets').iterdir())), 114)

    def test_owned_rollback_requires_attempt_manifest_and_html(self):
        record = self.owner()
        (self.public/'index.html').write_bytes(self.after)
        for key in ('attempt', 'manifestSha256', 'openedAtUtc', 'owner_task'):
            changed = dict(record, **{key: 'foreign'})
            D.save(self.coord, {'shared_release_active': True, 'window': changed})
            self.assertFalse(D.rollback_owned(self.root, self.manifest, record))
            self.assertEqual((self.public/'index.html').read_bytes(), self.after)
        D.save(self.coord, {'shared_release_active': True, 'window': record})
        (self.public/'index.html').write_bytes(b'foreign html')
        self.assertFalse(D.rollback_owned(self.root, self.manifest, record))
        (self.public/'index.html').write_bytes(self.after)
        self.assertTrue(D.rollback_owned(self.root, self.manifest, record))
        self.assertEqual((self.public/'index.html').read_bytes(), self.before)

    def test_apply_verify_real_flow_zero_reload_and_no_mutating_verify(self):
        result = self.apply()
        self.assertEqual(result['processReloads'], 0)
        self.assertEqual((self.public/'index.html').read_bytes(), self.after)
        self.assertEqual(len(list((self.public/'assets').iterdir())), 118)
        coord = D.load(self.coord)
        self.assertFalse(coord['shared_release_active'])
        self.assertEqual(coord['window']['status'], 'verified')
        self.assertEqual(coord['untouched'], {'keep': 1})
        self.assertTrue(self.pm2_calls)
        self.assertTrue(all(args == ['pm2', 'jlist'] for args in self.pm2_calls))
        before = {p: p.read_bytes() for p in self.base.rglob('*') if p.is_file()}
        with patch.object(D, 'atomic', side_effect=AssertionError('verify must not write')):
            self.assertTrue(D.verify(self.root, self.manifest, self.baseline, self.mh)['readOnly'])
        self.assertEqual(before, {p: p.read_bytes() for p in self.base.rglob('*') if p.is_file()})
        first_route = self.http.index(D.ADMIN+D.ROUTES[0], len(D.ROUTES)+5)
        for r in self.manifest['files'][1:]:
            self.assertIn(D.ADMIN+'/'+r['relative'], self.http[:first_route])

    def test_owned_failure_restores_html_but_keeps_additive_assets(self):
        with patch.object(D, 'final_checks', side_effect=RuntimeError('injected post-switch failure')):
            with self.assertRaises(RuntimeError):
                self.apply()
        self.assertEqual((self.public/'index.html').read_bytes(), self.before)
        self.assertEqual(len(list((self.public/'assets').iterdir())), 118)
        self.assertEqual(D.load(self.coord)['window']['status'], 'failed')
        self.assertTrue(D.load(self.coord)['window']['exactHtmlRollback'])

    def test_lost_window_never_rollback_or_close_foreign(self):
        foreign = {'shared_release_active': True, 'window': self.owner('foreign'), 'doNotTouch': 1}
        def loss(*args):
            D.save(self.coord, foreign)
            raise RuntimeError('owner lost')
        with patch.object(D, 'final_checks', side_effect=loss):
            with self.assertRaises(RuntimeError):
                self.apply()
        self.assertEqual(D.load(self.coord), foreign)
        self.assertEqual((self.public/'index.html').read_bytes(), self.after)

    def test_process_pid_drift_and_asset_html_block_switch(self):
        with patch.object(D, 'processes', return_value=[dict(r, pid=r['pid']+1) for r in self.rows]):
            with self.assertRaises(RuntimeError):
                self.apply()
        self.assertEqual((self.public/'index.html').read_bytes(), self.before)
        with patch.object(D, 'verify_http_asset', side_effect=RuntimeError('HTML fallback')):
            with self.assertRaises(RuntimeError):
                self.apply()
        self.assertEqual((self.public/'index.html').read_bytes(), self.before)

    def test_capture_exports_no_env_values(self):
        contract = self.base/'contract.json'
        D.save(contract, self.baseline)
        b = D.capture(contract)
        self.assertEqual(b['processCount'], 12)
        self.assertFalse(b['environmentValuesExported'])
        self.assertNotIn('never exported', json.dumps(b))
        self.assertNotIn('secret', json.dumps(b))
        self.assertEqual(b['coordSha256'], D.sha(self.coord))

    def test_real_http_supplier_and_api_rejected_before_network(self):
        # Undo only get mock; opener must never run for disallowed URLs.
        spec = importlib.util.spec_from_file_location('allowlist_driver', TOOLS/'static-release.py')
        raw = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(raw)
        with patch.object(raw.urllib.request, 'build_opener', side_effect=AssertionError('network forbidden')):
            for url in ('https://search.ickey.cn/', raw.ADMIN+'/api/trpc', raw.ADMIN+'/assets/../api/trpc', raw.ADMIN+'/assets/a.js?x=1'):
                with self.assertRaises(RuntimeError):
                    raw.get(url)

    def test_prepare_report_binding_counts_and_hash(self):
        pins, pin_sha = {'client/src/a.ts': '1'*64}, '2'*64
        valid = {'status': 'PASS', 'sourcePinsSha256': pin_sha, 'passed': 5, 'failed': 0}
        P.report_binding(valid, 'affected', pins, pin_sha, '3'*64, 'a'*40)
        for bad in (dict(valid, failed=1), dict(valid, passed=0), dict(valid, sourcePinsSha256='4'*64)):
            with self.assertRaises(RuntimeError):
                P.report_binding(bad, 'affected', pins, pin_sha, '3'*64, 'a'*40)

    def test_automatic_reference_proof_cannot_be_reused(self):
        front = D.load(self.root/'evidence/frontend-proof.json')
        qa = D.load(self.root/'evidence/native-tests.json')
        for key, value in (('phase', 'automatic'), ('referenceFetchDisabled', False), ('noNewReferenceTransport', False), ('typeOnlyDependencies', {'shared/channelReference.ts': 'f'*64})):
            with self.assertRaises(RuntimeError):
                D.validate_proofs(dict(front, **{key: value}), qa, self.manifest['files'])

    def test_missing_lock_does_not_create_it(self):
        absent = self.base/'missing.lock'
        with patch.object(D, 'LOCKS', (str(absent),)):
            with self.assertRaises(FileNotFoundError):
                with D.locks():
                    self.fail('missing lock must fail closed')
        self.assertFalse(absent.exists())

    def test_html_atomic_write_then_error_still_owned_rolls_back(self):
        actual = D.atomic
        def write_then_error(path, data, mode=None):
            actual(path, data, mode)
            if Path(path) == self.public/'index.html' and data == self.after:
                raise OSError('injected fsync failure after replace')
        with patch.object(D, 'atomic', side_effect=write_then_error):
            with self.assertRaises(OSError):
                self.apply()
        self.assertEqual((self.public/'index.html').read_bytes(), self.before)
        self.assertTrue(D.load(self.coord)['window']['exactHtmlRollback'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
