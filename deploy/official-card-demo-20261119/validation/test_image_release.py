#!/usr/bin/env python3
"""Offline only. All live paths, PM2, public HTTP, locks and hashes are fixtures."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('image_release', Path(__file__).with_name('image-release.py'))
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pack = self.root / 'stage' / 'package'
        self.pack.mkdir(parents=True)
        self.target = self.root / 'front' / 'dist' / 'index.js'
        self.target.parent.mkdir(parents=True)
        self.runtime = self.root / 'front' / 'runtime' / r.RUNTIME.name
        self.runtime.parent.mkdir()
        self.coord = self.root / 'coord.json'
        self.coord.write_bytes(b'{"shared_release_active":false,"untouched":17}\n')
        self.oldcoord = self.coord.read_bytes()
        self.before = b'x' * 2096 + r.OLD_IMPORT
        self.before += b'x' * (5900323 - len(self.before)) + r.OLD_NATIVE + b';existing'
        self.after = self.before[:5900323] + r.NEW_NATIVE + self.before[5900323 + len(r.OLD_NATIVE):]
        self.after = self.after[:2096] + r.NEW_IMPORT + self.after[2096 + len(r.OLD_IMPORT):]
        self.target.write_bytes(self.before)
        self.runtimebytes = b'export const fixture = true;\n'
        for name, value in [('STAGE', self.pack), ('TARGET', self.target), ('RUNTIME', self.runtime),
                            ('COORD', self.coord), ('BEFORE_H', r.H(self.before)),
                            ('AFTER_H', r.H(self.after)), ('RUNTIME_H', r.H(self.runtimebytes))]:
            p = patch.object(r, name, value); p.start(); self.addCleanup(p.stop)
        self.ps = [dict(id=i, name='dianzi51' if i < 4 else ('dianzi51-admin' if i < 6 else 'protected-' + str(i)),
                        pid=100 + i, status='online', script=str(self.target) if i < 4 else '/protected/' + str(i),
                        cwd='/fixed', mode='cluster_mode', configuredEnvSha256='config', rawEnvSha256='raw')
                   for i in range(12)]
        self.reloads = 0
        self.process_patch = patch.object(r, 'processes', side_effect=lambda: copy.deepcopy(self.ps))
        self.process_patch.start(); self.addCleanup(self.process_patch.stop)
        self.reload_patch = patch.object(r, 'reload_front', side_effect=self.reload)
        self.reload_patch.start(); self.addCleanup(self.reload_patch.stop)
        self.gets = []
        self.http_patch = patch.object(r.subprocess, 'check_output', side_effect=self.public_get)
        self.http_patch.start(); self.addCleanup(self.http_patch.stop)
        files = {'baseline-front.js': self.before, 'candidate-front.js': self.after,
                 'runtime/' + self.runtime.name: self.runtimebytes,
                 'validation/read-public-images.cjs': b'// independently reviewed GET-only fixture\n',
                 'evidence/source.txt': b'frozen native source; no money changes\n'}
        delta = dict(schema='native-byte-delta-v1', beforeSha256=r.BEFORE_H, afterSha256=r.AFTER_H,
                     inverseVerified=True, patches=[])
        for offset, old, new in [(2096, r.OLD_IMPORT, r.NEW_IMPORT), (5900323, r.OLD_NATIVE, r.NEW_NATIVE)]:
            delta['patches'].append(dict(oldStart=offset, newStart=offset,
                oldBase64=base64.b64encode(old).decode(), newBase64=base64.b64encode(new).decode()))
        files['root-patches.json'] = r.encode(delta)
        for name, value in files.items():
            p = self.pack / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(value)
        protected = []
        for i in range(200):
            p = self.root / ('protected-' + str(i)); p.write_bytes(b'unchanged')
            protected.append(dict(path=str(p), sha256=r.H(p.read_bytes())))
        self.m = dict(ownerTask=r.OWNER, scope=r.SCOPE, kind='runtime/frontJS', apiWrites=1,
            databaseWrites=0, adminHtmlWrites=0, otherHtmlWrites=0, reloadNames=['dianzi51'],
            target=str(self.target), runtimeTarget=str(self.runtime), beforeApiSha256=r.BEFORE_H,
            afterApiSha256=r.AFTER_H, runtimeSha256=r.RUNTIME_H,
            controllerSha256=r.H(Path(r.__file__).read_bytes()), packageFiles={k: r.H(v) for k, v in files.items()},
            frozenSources=[dict(source='evidence/source.txt', sha256=r.H(files['evidence/source.txt']))],
            evidence=[dict(source='root-patches.json', sha256=r.H(files['root-patches.json']))],
            proofs={k: True for k in ['noMoneyChange', 'noRouterRoleContextChange', 'readOnlySystemGallery',
                'nativeOfflineUnitPassed', 'workerRefundPermitBackupsPinned', 'gateOnlyPublicGETNoAuthNoDmlDdl']},
            protectedFiles=protected, beforeProcesses=copy.deepcopy(self.ps), expectedSku='same-sku',
            publicReadGate=dict(source='validation/read-public-images.cjs',
                sha256=r.H(files['validation/read-public-images.cjs']), expectedImageUrl=r.EXPECTED_IMAGE),
            publicQueryPaths=dict(list='/api/trpc/officialMall.list', detail='/api/trpc/officialMall.detail'))
        self.freeze()

    def freeze(self):
        self.mb = r.encode(self.m); (self.pack / 'manifest.json').write_bytes(self.mb)
        (self.pack / 'review.json').write_bytes(r.encode(dict(status='passed', independent=True,
            manifestSha256=r.H(self.mb), controllerSha256=self.m['controllerSha256'])))
        self.c = r.Controller(self.pack, r.H(self.mb))

    def reload(self):
        self.reloads += 1
        for x in self.ps[:4]:
            x['pid'] += 100; x['status'] = 'online'

    def public_get(self, args, **kwargs):
        if args[0] == 'curl':
            self.assertNotIn('-X', args)
            self.assertNotIn('--cookie', args)
            self.assertNotIn('--data', args)
            self.assertTrue(args[-1].startswith('https://51dianzi.com/api/trpc/officialMall.'))
            row = dict(publicId='public-id', revision='revision', partNumber='STM32F103C8T6', brand='ST',
                       qty=2, price='12.00', thumbnailUrl=r.EXPECTED_IMAGE + '?v=1', imageKind='catalog_reference')
            data = {'items': [row], 'total': 1} if '/officialMall.list?' in args[-1] else {'item': row}
            return r.encode({'result': {'data': {'json': data}}})
        self.assertEqual(args[:2], ['node', str(self.pack / 'validation/read-public-images.cjs')])
        self.assertIn(args[2:], [[], ['--require-image']])
        self.gets.append(args)
        return r.encode(dict(status='public-image-readonly-passed', readonlyGET=True,
            browserSessionMinted=False, ordersSubmitted=0, methods=['officialMall.list', 'officialMall.detail'],
            systemImageMatched=True, imageKind='catalog_reference'))

    def receipt_status(self):
        return json.loads((self.c.receipt / 'receipt.json').read_bytes())['status']

    def test_preflight_zero_writes(self):
        before = {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.c.preflight()
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.root.rglob('*') if p.is_file()})
        self.assertEqual(self.reloads, 0)

    def test_apply_once_and_only_four_pids_change(self):
        old = copy.deepcopy(self.ps)
        self.assertEqual(self.c.apply(True)['status'], 'verified')
        self.assertEqual(self.target.read_bytes(), self.after)
        self.assertEqual(self.ps[4:], old[4:])
        self.assertEqual(self.reloads, 1)
        self.assertEqual(self.runtime.stat().st_mode & 0o777, 0o644)
        with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.reloads, 1)

    def test_wrong_path_and_runtime_collision(self):
        with self.assertRaises(RuntimeError): r.Controller(self.root, r.H(self.mb))
        self.runtime.write_bytes(self.runtimebytes)
        with self.assertRaises(RuntimeError): self.c.preflight()
        self.assertEqual(self.reloads, 0)

    def test_before_drift_zero_writes(self):
        self.target.write_bytes(b'foreign')
        with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.coord.read_bytes(), self.oldcoord)
        self.assertFalse(self.c.receipt.exists())

    def test_target_env_drift(self):
        self.ps[0]['rawEnvSha256'] = 'changed'
        with self.assertRaises(RuntimeError): self.c.preflight()
        self.assertFalse(self.runtime.exists())

    def test_gate_failure_restores_only_api(self):
        good = self.public_get
        def fail(args, **kw):
            if '--require-image' in args: raise RuntimeError('HTTP fixture failure')
            return good(args, **kw)
        self.http_patch.side_effect = fail
        # Patch the started mock rather than its patcher.
        with patch.object(r.subprocess, 'check_output', side_effect=fail):
            with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.reloads, 2)
        self.assertTrue(self.runtime.exists())
        self.assertEqual(self.receipt_status(), 'rolled-back')
        self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active'])

    def test_atomic_replace_commits_then_raises(self):
        real = r.atomic
        def atomic(p, before, after):
            real(p, before, after)
            if p == self.target and after == self.after: raise OSError('directory fsync failed after commit')
        with patch.object(r, 'atomic', side_effect=atomic):
            with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.receipt_status(), 'rolled-back')
        self.assertEqual(self.reloads, 0)

    def test_coord_replace_commits_then_raises(self):
        real = r.atomic
        def atomic(p, before, after):
            real(p, before, after)
            if p == self.coord and before == self.oldcoord: raise OSError('coord fsync after commit')
        with patch.object(r, 'atomic', side_effect=atomic):
            with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.coord.read_bytes(), self.oldcoord)
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.receipt_status(), 'rolled-back')

    def test_error_log_write_failure_does_not_block_restore(self):
        original_write = Path.write_bytes
        real = r.atomic
        def writing(p, value):
            if p.name == 'error.json': raise OSError('log full')
            return original_write(p, value)
        def atomic(p, before, after):
            real(p, before, after)
            if p == self.target and after == self.after: raise OSError('postcommit')
        with patch.object(Path, 'write_bytes', writing), patch.object(r, 'atomic', side_effect=atomic):
            with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.receipt_status(), 'rolled-back')

    def test_foreign_overwrite_never_rollback_or_reload(self):
        real = r.atomic
        def atomic(p, before, after):
            real(p, before, after)
            if p == self.target and after == self.after:
                p.write_bytes(b'foreign'); raise OSError('foreign now owns API')
        with patch.object(r, 'atomic', side_effect=atomic):
            with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.target.read_bytes(), b'foreign')
        self.assertEqual(self.reloads, 0)
        self.assertEqual(self.receipt_status(), 'recovery-required')
        self.assertTrue(json.loads(self.coord.read_bytes())['shared_release_active'])

    def test_partial_pm2_failure_restores_root_then_front_only(self):
        def partial():
            self.reloads += 1
            if self.reloads == 1:
                self.ps[0]['pid'] += 100; self.ps[1]['status'] = 'launching'
                raise RuntimeError('partial PM2 reload')
            self.assertEqual(self.target.read_bytes(), self.before)
            for x in self.ps[:4]: x['pid'] += 100; x['status'] = 'online'
        with patch.object(r, 'reload_front', side_effect=partial):
            with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.reloads, 2)
        self.assertEqual(self.receipt_status(), 'rolled-back')

    def test_coord_ownership_lost_no_overwrite(self):
        real = r.atomic
        foreign = b'{"shared_release_active":true,"window":{"nonce":"foreign"}}'
        def atomic(p, before, after):
            real(p, before, after)
            if p == self.target and after == self.after: self.coord.write_bytes(foreign)
        with patch.object(r, 'atomic', side_effect=atomic):
            with self.assertRaises(RuntimeError): self.c.apply(True)
        self.assertEqual(self.coord.read_bytes(), foreign)
        self.assertEqual(self.target.read_bytes(), self.after)
        self.assertEqual(self.reloads, 0)
        self.assertEqual(self.receipt_status(), 'recovery-required')

    def test_gate_rejects_auth_session_post_wrong_image(self):
        self.c.validate()
        template = json.loads(self.public_get(['node', str(self.pack / 'validation/read-public-images.cjs')]))
        for change in ['auth', 'method', 'image']:
            response = copy.deepcopy(template)
            if change == 'auth': response['browserSessionMinted'] = True
            if change == 'method': response['readonlyGET'] = False
            if change == 'image': response['systemImageMatched'] = False
            with patch.object(r.subprocess, 'check_output', return_value=r.encode(response)):
                with self.assertRaises(RuntimeError): self.c.gate(True)
        self.assertTrue(r.public_image(r.EXPECTED_IMAGE + '?v=123'))
        self.assertFalse(r.public_image(r.EXPECTED_IMAGE + '?redirect=evil'))
        self.assertFalse(r.public_image(r.EXPECTED_IMAGE + '/foreign'))

    def test_strict_reload_command(self):
        self.reload_patch.stop()
        self.addCleanup(self.reload_patch.start)
        with patch.object(r.subprocess, 'check_output', return_value=b'') as p:
            r.reload_front()
            self.assertEqual(p.call_args.args[0], ['pm2', 'reload', 'dianzi51'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
