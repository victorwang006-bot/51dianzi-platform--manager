#!/usr/bin/env python3
import contextlib, fcntl, hashlib, importlib.util, json, os, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('publisher', Path(__file__).with_name('publish-demand-navigation.py'))
publisher = importlib.util.module_from_spec(spec); spec.loader.exec_module(publisher)

class PublisherSafety(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='demand-publisher-unit-')
        self.root = Path(self.tmp.name)
        self.roots = {side: self.root / ('public-' + side) for side in ['admin', 'front']}
        self.stage = self.root / 'stage'; self.stage.mkdir()
        self.coord = self.root / 'coord.json'; self.coord.write_text('{"shared_release_active":false,"release_hold":{"status":"frozen"}}')
        self.original = {}
        self.release = {'schemaVersion': 1, 'scope': 'demand-navigation-static-only',
                        'databaseChanges': False, 'apiChanges': False, 'processChanges': False,
                        'globalFreezeChanges': False, 'coordSha256': publisher.sha(self.coord.read_bytes()),
                        'stageFiles': {}, 'protectedFiles': {}, 'processes': [], 'sourceCommits': {'admin': 'fixture', 'front': 'fixture'}, 'sides': {}}
        (self.stage / 'publish-demand-navigation.py').write_bytes(b'unit-fixture-only')
        self.release['publisherSha256'] = publisher.sha(b'unit-fixture-only')
        for side, root in self.roots.items():
            (root / 'assets').mkdir(parents=True)
            old = ('old-' + side).encode(); (root / 'index.html').write_bytes(old); self.original[side] = old
            staged = self.stage / side; staged.mkdir()
            new = ('new-' + side).encode(); (staged / 'index.html').write_bytes(new)
            (staged / 'asset-test.js').write_bytes(b'const unitFixture=true;')
            (staged / 'runtime-test.json').write_text('{"passed":true}')
            self.release['sides'][side] = {'beforeIndexSha256': publisher.sha(old), 'indexSha256': publisher.sha(new),
                'assets': [{'url': '/assets/asset-test.js', 'file': 'asset-test.js', 'sha256': publisher.sha(b'const unitFixture=true;')}]}
        self.patches = [patch.object(publisher, 'ROOTS', self.roots), patch.object(publisher, 'COORD', self.coord), patch.object(publisher, 'processes', lambda: [])]
        for p in self.patches: p.start()
    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.tmp.cleanup()
    def approval(self, approved=True, digest='exact-fixture-sha'):
        (self.stage / 'fixed-candidate-approval.json').write_text(json.dumps({'approved': approved, 'releaseManifestSha256': digest, 'approvedAt': 'LOCAL-UNIT-TEST-NOT-USER-APPROVAL', 'authorizedAction': 'publish-this-static-candidate-only'}))
    def local_get(self, side, url):
        return (self.roots[side] / url.lstrip('/')).read_bytes()
    def assert_old(self):
        for side, root in self.roots.items(): self.assertEqual((root / 'index.html').read_bytes(), self.original[side])
    def test_unapproved_candidate_cannot_write(self):
        self.approval(False)
        with self.assertRaisesRegex(RuntimeError, 'FRESH_EXACT_CANDIDATE'): publisher.apply(self.stage, self.release, 'exact-fixture-sha')
        self.assert_old()
    def test_approval_bound_to_exact_manifest(self):
        self.approval(True, 'other-sha')
        with self.assertRaisesRegex(RuntimeError, 'FRESH_EXACT_CANDIDATE'): publisher.apply(self.stage, self.release, 'exact-fixture-sha')
        self.assert_old()
    def test_changed_index_blocks_candidate(self):
        (self.roots['admin'] / 'index.html').write_bytes(b'new-concurrent-version')
        with self.assertRaisesRegex(RuntimeError, 'LATEST_INDEX_DRIFT'): publisher.verify_stage(self.stage, self.release)
        self.assertEqual((self.roots['admin'] / 'index.html').read_bytes(), b'new-concurrent-version')
    def test_changed_coordination_blocks_candidate(self):
        self.coord.write_text('{"shared_release_active":true}')
        with self.assertRaisesRegex(RuntimeError, 'COORDINATION_CHANGED'): publisher.verify_stage(self.stage, self.release)
        self.assert_old()
    def test_complete_static_transaction_without_services(self):
        self.approval()
        with patch.object(publisher, 'get_static', self.local_get): publisher.apply(self.stage, self.release, 'exact-fixture-sha')
        receipt=json.loads((self.stage / 'receipt.json').read_text()); self.assertEqual(receipt['status'], 'verified'); self.assertTrue(receipt['globalHoldPreserved'])
        self.assertEqual(self.coord.read_text(), '{"shared_release_active":false,"release_hold":{"status":"frozen"}}')
        for side, root in self.roots.items(): self.assertEqual((root / 'index.html').read_bytes(), ('new-' + side).encode())
    def test_failed_http_index_verification_rolls_back_exactly(self):
        self.approval()
        def broken(side,url): return b'wrong-index' if side=='front' and url=='/index.html' else self.local_get(side,url)
        with patch.object(publisher, 'get_static', broken):
            with self.assertRaisesRegex(RuntimeError, 'LIVE_HTTP_INDEX_HASH'): publisher.apply(self.stage, self.release, 'exact-fixture-sha')
        self.assert_old(); self.assertTrue((self.stage / 'failure-receipt.json').is_file())
    def test_dual_lock_contention_refuses_and_releases_first_lock(self):
        locks = [self.root/'first.lock',self.root/'second.lock']
        fd=os.open(locks[1],os.O_RDWR|os.O_CREAT,0o600); fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with patch.object(publisher,'LOCKS',locks):
            try:
                with self.assertRaises(BlockingIOError):
                    with publisher.locks(): self.fail('lock must block')
            finally: os.close(fd)
            with publisher.locks(): pass
    def test_asset_path_escape_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'INVALID_ASSET_URL'): publisher.asset_path('admin','/assets/../unsafe.js')

if __name__ == '__main__': unittest.main(verbosity=2)
