#!/usr/bin/env python3
"""Local fixtures only. No production paths, PM2, network, SSH or deploy are accessed."""
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('priority_publish', HERE / 'publish.py')
pub = importlib.util.module_from_spec(spec); spec.loader.exec_module(pub)
BASE = Path('/home/ubuntu/backend-optimization/baseline')

class PublisherSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='priority-static-tests-')
        self.root = Path(self.temp.name); self.package = self.root / 'package'; self.public = self.root / 'public'
        self.package.mkdir(); (self.public / 'assets').mkdir(parents=True)
        (self.package / 'evidence').mkdir()
        for name in pub.BASELINE:
            shutil.copyfile(BASE / name, self.public / ('index.html' if name == 'index.html' else 'assets/' + name))
        self.source_sha = '0' * 64; self.namespace = pub.VERSION + '-' + self.source_sha[:12]
        assets = []
        for name, data in [('index-TEST.js', b'/* fixture only */'), ('index-TEST.css', b'/* fixture CSS */')]:
            rel = 'assets/' + self.namespace + '/' + name; p = self.package / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(data)
            assets.append({'path': rel, 'sha256': pub.digest(data), 'bytes': len(data)})
        env = {'PATH': os.environ['PATH'], 'HOME': os.environ.get('HOME', '/home/ubuntu')}
        js = "import fs from 'node:fs';import {assembleHtml} from './lib.mjs';const [base,out,ns]=process.argv.slice(1);const old=fs.readFileSync(base,'utf8');const built=`<script type=\"module\" crossorigin src=\"/assets/${ns}/index-TEST.js\"></script><link rel=\"stylesheet\" crossorigin href=\"/assets/${ns}/index-TEST.css\">`;const x=assembleHtml(old,built,ns);fs.writeFileSync(out+'/candidate-index.html',x.html);fs.writeFileSync(out+'/evidence/html-edits.json',JSON.stringify(x.edits));"
        subprocess.run(['node', '--input-type=module', '-e', js, str(BASE / 'index.html'), str(self.package), self.namespace], cwd=HERE, env=env, check=True, stdout=subprocess.DEVNULL)
        freeze = {'sourceCommit': 'b' * 40, 'sourceTreeSha256': self.source_sha, 'fixtureOnly': True}
        self.json('evidence/freeze.json', freeze)
        checks = []
        for name, command in [('typecheck.log', ['pnpm', 'exec', 'tsc', '--noEmit']), ('regression-tests.log', ['pnpm', 'exec', 'vitest', 'run']), ('frontend-build.log', ['node', 'fixture-worker'])]:
            (self.package / 'evidence' / name).write_text('Synthetic unit-test fixture, not actual build evidence.\n')
            checks.append({'command': command, 'exitCode': 0, 'log': name, 'logSha256': pub.sha(self.package / 'evidence' / name)})
        self.json('evidence/checks.json', checks)
        evidence = [{'path': 'evidence/' + p.name, 'sha256': pub.sha(p), 'bytes': p.stat().st_size} for p in sorted((self.package / 'evidence').iterdir())]
        candidate = self.package / 'candidate-index.html'
        self.m = {'schemaVersion': 1, 'release': pub.VERSION, 'task': pub.TASK, 'kind': 'frozen-full-production-frontend', 'sourceCommit': 'b' * 40, 'sourceTreeSha256': self.source_sha, 'namespace': self.namespace, 'baseline': pub.BASELINE, 'assets': assets, 'rootAssetsMustRemainUnchanged': [], 'html': {'path': candidate.name, 'sha256': pub.sha(candidate), 'bytes': candidate.stat().st_size}, 'evidence': evidence, 'sourceFreezeSha256': pub.sha(self.package / 'evidence/freeze.json'), 'checks': checks, 'guard': {k: True for k in ('actualTypecheckPassed', 'actualRegressionTestsPassed', 'frontendOnlyProductionBuildPassed', 'sourceStable', 'isolatedNoEnvFiles', 'currentChannelFeaturesBundled', 'oldHtmlOtherBytesPreserved', 'oldAssetsNeverDeleted')}}
        self.m['guard'].update({'serverBundleBuilt': False, 'productionDeploymentPerformed': False})
        self.save_manifest()
        self.json('qa-approval.json', {'manifestSha256': pub.sha(self.package / 'manifest.json'), 'approvedByTask': pub.TASK, 'isolatedAuthorizedUiQaPassed': True, 'serverApiCompatibilityPassed': True, 'fixtureOnly': True})
        self.coord = self.root / 'coord.json'; self.coord.write_text('{"shared_release_active":false,"unrelated":"keep"}\n')
        self.lock = self.root / 'shared.lock'
        self.protected = {'processes': [{'status': 'online'}], 'servingRoots': {'fixture': {}}, 'protectedFiles': {'fixture-only': 'hash'}}
        self.patches = [patch.object(pub, 'PUBLIC', self.public), patch.object(pub, 'HTML', self.public / 'index.html'), patch.object(pub, 'RELEASE', self.package), patch.object(pub, 'LOCK', self.lock), patch.object(pub, 'COORD', self.coord), patch.object(pub, 'protected_snapshot', return_value=self.protected), patch.object(pub, 'health', return_value=[{'status': 200}]), patch.object(pub, 'verify_url', return_value=None)]
        for p in self.patches: p.start()
    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()
    def json(self, name, value):
        (self.package / name).write_bytes(pub.encode(value))
    def save_manifest(self):
        self.json('manifest.json', self.m)
    def test_local_manifest_and_inverse_html(self):
        m, _, _ = pub.validate_package(self.package); self.assertEqual(m['release'], pub.VERSION)
    def test_asset_tamper_rejected(self):
        (self.package / self.m['assets'][0]['path']).write_bytes(b'tampered')
        with self.assertRaises(pub.Stop): pub.validate_package(self.package)
    def test_asset_traversal_rejected(self):
        self.m['assets'][0]['path'] = '../escape.js'; self.save_manifest()
        with self.assertRaises(pub.Stop): pub.validate_package(self.package)
    def test_symlink_artifact_rejected(self):
        p = self.package / self.m['assets'][0]['path']; p.unlink(); p.symlink_to(BASE / 'index-CG0lkwm6.js')
        with self.assertRaises(pub.Stop): pub.validate_package(self.package)
    def test_failed_typecheck_guard_rejected(self):
        self.m['guard']['actualTypecheckPassed'] = False; self.save_manifest()
        with self.assertRaises(pub.Stop): pub.validate_package(self.package)
    def test_missing_real_log_rejected(self):
        (self.package / 'evidence/typecheck.log').unlink()
        with self.assertRaises(pub.Stop): pub.validate_package(self.package)
    def test_apply_retains_old_asset_bytes_and_allows_only_html_switch(self):
        old = pub.inventory_tree(); pub.execute(self.package)
        self.assertEqual(pub.sha(pub.HTML), self.m['html']['sha256']); self.assertEqual(pub.inventory_tree(self.namespace), old)
        self.assertTrue((self.package / 'verified.json').exists()); self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active'])
        self.assertEqual(json.loads(self.coord.read_bytes())['unrelated'], 'keep')
    def test_partial_release_cannot_replay(self):
        pub.execute(self.package)
        with self.assertRaises(pub.Stop): pub.execute(self.package)
    def test_explicit_rollback_keeps_new_assets(self):
        pub.execute(self.package); pub.execute(self.package, rollback=True)
        self.assertEqual(pub.sha(pub.HTML), pub.BASELINE['index.html'])
        self.assertTrue(all((self.public / a['path']).exists() for a in self.m['assets']))
    def test_rollback_refuses_later_html(self):
        pub.execute(self.package); pub.HTML.write_bytes(b'later-release')
        with self.assertRaises(pub.Stop): pub.execute(self.package, rollback=True)
        self.assertEqual(pub.HTML.read_bytes(), b'later-release')
    def test_global_lock_conflict(self):
        with open(self.lock, 'a') as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(pub.Stop): pub.execute(self.package)
        self.assertEqual(pub.sha(pub.HTML), pub.BASELINE['index.html'])
        self.assertFalse((self.package / 'before-state.json').exists())
    def test_active_coordination_rejected(self):
        self.coord.write_text('{"shared_release_active":true}')
        with self.assertRaises(pub.Stop): pub.execute(self.package)
    def test_missing_qa_rejected(self):
        (self.package / 'qa-approval.json').unlink()
        with self.assertRaises(pub.Stop): pub.execute(self.package)
    def test_baseline_drift_rejected(self):
        pub.HTML.write_bytes(b'drift')
        with self.assertRaises(pub.Stop): pub.execute(self.package)
    def test_failed_public_verification_reverts_only_our_html(self):
        def verification(url, expected):
            if url.startswith('https://'): raise pub.Stop('fixture offline failure')
        with patch.object(pub, 'verify_url', side_effect=verification):
            with self.assertRaises(pub.Stop): pub.execute(self.package)
        self.assertEqual(pub.sha(pub.HTML), pub.BASELINE['index.html'])
        self.assertTrue(all((self.public / a['path']).exists() for a in self.m['assets']))
        self.assertTrue((self.package / 'failure-html-rollback.json').exists()); self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active'])
    def test_failed_verification_does_not_clobber_later_html(self):
        def verification(url, expected):
            if url.startswith('https://'):
                pub.HTML.write_bytes(b'later-owner-html'); raise pub.Stop('fixture later release')
        with patch.object(pub, 'verify_url', side_effect=verification):
            with self.assertRaises(pub.Stop): pub.execute(self.package)
        self.assertEqual(pub.HTML.read_bytes(), b'later-owner-html')
        self.assertFalse((self.package / 'failure-html-rollback.json').exists())
    def test_immutable_asset_copy_cannot_overwrite(self):
        a = self.m['assets'][0]; pub.copy_new_asset(self.package, a)
        with self.assertRaises(pub.Stop): pub.copy_new_asset(self.package, a)
        self.assertEqual(pub.sha(self.public / a['path']), a['sha256'])
    def test_asset_target_symlink_refused_before_external_directory_write(self):
        external = self.root / 'external'; external.mkdir()
        (self.public / 'assets' / self.namespace).symlink_to(external, target_is_directory=True)
        with self.assertRaises(pub.Stop): pub.copy_new_asset(self.package, self.m['assets'][0])
        self.assertEqual(list(external.iterdir()), [])
    def test_atomic_html_target_symlink_refused(self):
        target = self.root / 'outside.html'; target.write_bytes(b'outside')
        link = self.root / 'html-link'; link.symlink_to(target)
        with self.assertRaises(pub.Stop): pub.atomic(link, b'forbidden')
        self.assertEqual(target.read_bytes(), b'outside')
    def test_old_asset_hash_drift_guard(self):
        before = {'manifestSha256': pub.sha(self.package / 'manifest.json'), 'protected': copy.deepcopy(self.protected), 'assetTree': pub.inventory_tree()}
        (self.public / 'assets/index-C0vPar7R.css').write_bytes(b'not allowed')
        with self.assertRaises(pub.Stop): pub.guard(before, self.package, self.m)
    def test_protected_process_drift_guard(self):
        before = {'manifestSha256': pub.sha(self.package / 'manifest.json'), 'protected': copy.deepcopy(self.protected), 'assetTree': pub.inventory_tree()}
        self.protected['processes'][0]['status'] = 'restarted'
        with self.assertRaises(pub.Stop): pub.guard(before, self.package, self.m)

if __name__ == '__main__':
    unittest.main(verbosity=2)
