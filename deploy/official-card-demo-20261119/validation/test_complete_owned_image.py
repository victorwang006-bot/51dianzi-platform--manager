#!/usr/bin/env python3
"""Offline only: every production observation and GET is mocked; no readiness claim."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('completion', Path(__file__).with_name('complete-owned-image.py'))
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class OfflineCompletion(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.target, self.coord, self.receipt = [self.root / x for x in ['root', 'coord', 'receipt']]
        self.before, self.after = b'original-before', b'exact-reviewed-after'
        self.target.write_bytes(self.before)
        self.owned = m.canonical({'shared_release_active': True, 'window': {
            'owner_task': m.OWNER, 'nonce': m.NONCE, 'scope': m.SCOPE,
            'manifestSha256': m.MH, 'status': 'recovery-required'}})
        self.coord.write_bytes(self.owned)
        self.old = [dict(id=i, name='dianzi51' if i < 4 else 'other-' + str(i), pid=100 + i,
                         status='online', script=str(m.TARGET), cwd='/fixed', mode='cluster_mode',
                         configuredEnvSha256='user-' + str(i), rawEnvSha256='old-raw-' + str(i))
                    for i in range(12)]
        self.current = copy.deepcopy(self.old)
        for r in self.current[:4]:
            r.update(pid=r['pid'] + 100, rawEnvSha256='current-' + str(r['id']))
        self.embedded = {r['id']: r['configuredEnvSha256'] for r in self.old}
        self.c = m.Completion()
        self.c.before, self.c.after, self.c.owned = self.before, self.after, self.owned
        self.c.ib, self.c.rb, self.c.ob = b'input', b'review', b'original-error-receipt'
        self.c.i = {'beforeProcesses': copy.deepcopy(self.current), 'originalPublicCanonical': {'prices': [1], 'qty': 7}}
        self.c.m = {'beforeProcesses': self.old}
        self.rounds = 0
        self.protected = b'244 protected bytes'
        self.runtime = b'existing runtime bytes'
        for name, value in [('TARGET', self.target), ('COORD', self.coord), ('RECEIPT', self.receipt)]:
            p = patch.object(m, name, value); p.start(); self.addCleanup(p.stop)
        p = patch.object(m, 'capture', side_effect=lambda: (copy.deepcopy(self.current), dict(self.embedded)))
        p.start(); self.addCleanup(p.stop)
        self.c.validate = self.validate
        self.c.check = self.check
        self.c.gates = self.gates

    def check(self):
        m.need(self.coord.read_bytes() == self.owned, 'COORD_OWN_BYTES')
        self.c.process_check()
        m.need(self.protected == b'244 protected bytes', 'PROTECTED_DRIFT')
        m.need(self.runtime == b'existing runtime bytes', 'RUNTIME_DRIFT')

    def validate(self):
        self.check()
        m.need(self.target.read_bytes() == self.before, 'ONLY_BEFORE_ROOT_ACCEPTED')
        m.need(not self.receipt.exists(), 'STANDALONE_ONCE_ONLY')

    def gates(self):
        # Four separate public require-image rounds; no HTTP or node actually run.
        for unused in range(4):
            self.rounds += 1

    def unchanged(self):
        self.assertEqual(self.protected, b'244 protected bytes')
        self.assertEqual(self.runtime, b'existing runtime bytes')
        self.assertEqual(self.current, self.c.i['beforeProcesses'])

    def test_success_accepts_original_front_raw_change_but_no_new_drift(self):
        result = self.c.complete()
        self.assertEqual(result['status'], 'verified-owned-completion')
        self.assertEqual(self.target.read_bytes(), self.after)
        c = json.loads(self.coord.read_bytes())
        self.assertFalse(c['shared_release_active'])
        self.assertEqual(c['window']['nonce'], m.NONCE)
        self.assertEqual(c['window']['status'], 'verified-recovered-completion')
        self.assertEqual(self.rounds, 8)
        self.unchanged()

    def test_foreign_root_no_mutation(self):
        self.target.write_bytes(b'foreign')
        with self.assertRaisesRegex(RuntimeError, 'ONLY_BEFORE_ROOT'):
            self.c.complete()
        self.assertEqual(self.target.read_bytes(), b'foreign')
        self.assertEqual(self.coord.read_bytes(), self.owned)
        self.assertFalse(self.receipt.exists())

    def test_foreign_coord_no_mutation(self):
        self.coord.write_bytes(b'foreign-owner')
        with self.assertRaisesRegex(RuntimeError, 'COORD_OWN_BYTES'):
            self.c.complete()
        self.assertEqual(self.coord.read_bytes(), b'foreign-owner')
        self.assertEqual(self.target.read_bytes(), self.before)

    def test_log_after_rename_failure_still_rolls_back_when_diagnostics_fail(self):
        real = m.atomic
        calls = []
        def fault(p, before, after):
            if p == self.receipt:
                calls.append(1)
                if len(calls) == 1:
                    real(p, before, after)
                raise OSError('receipt fsync / diagnostics unavailable')
            return real(p, before, after)
        with patch.object(m, 'atomic', side_effect=fault):
            with self.assertRaisesRegex(RuntimeError, 'FAILED_CLOSED'):
                self.c.complete()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.coord.read_bytes(), self.owned)
        self.unchanged()

    def test_root_postrename_fsync_error_rolls_back_exact_owned_bytes(self):
        real = m.atomic
        fired = []
        def fault(p, before, after):
            real(p, before, after)
            if p == self.target and after == self.after and not fired:
                fired.append(1)
                raise OSError('directory fsync after root rename')
        with patch.object(m, 'atomic', side_effect=fault):
            with self.assertRaisesRegex(RuntimeError, 'FAILED_CLOSED'):
                self.c.complete()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertEqual(self.coord.read_bytes(), self.owned)
        self.unchanged()

    def test_actual_embedded_user_config_diff_rejected(self):
        # jlist configured hash and all raw snapshot pins still match; embedded env differs.
        self.embedded[0] = 'changed-real-user-config'
        with self.assertRaisesRegex(RuntimeError, 'ACTUAL_USER_ENV_CHANGED'):
            self.c.complete()
        self.assertEqual(self.target.read_bytes(), self.before)
        self.assertFalse(self.receipt.exists())

    def test_new_current_raw_or_pid_drift_rejected(self):
        self.current[0]['rawEnvSha256'] = 'postreview-change'
        with self.assertRaisesRegex(RuntimeError, 'POSTREVIEW_PROCESS'):
            self.c.complete()
        self.assertEqual(self.target.read_bytes(), self.before)

    def test_foreign_root_after_own_rename_not_overwritten(self):
        real = m.atomic
        def fault(p, before, after):
            real(p, before, after)
            if p == self.target and after == self.after:
                p.write_bytes(b'foreign-after-own-write')
                raise OSError('foreign concurrent writer')
        with patch.object(m, 'atomic', side_effect=fault):
            with self.assertRaisesRegex(RuntimeError, 'FAILED_CLOSED'):
                self.c.complete()
        self.assertEqual(self.target.read_bytes(), b'foreign-after-own-write')
        self.assertEqual(self.coord.read_bytes(), self.owned)

    def test_coord_postrename_fsync_error_reopens_exact_owned_window(self):
        real = m.atomic
        fired = []
        def fault(p, before, after):
            real(p, before, after)
            if p == self.coord and before == self.owned and not fired:
                fired.append(1)
                raise OSError('coord fsync after rename')
        with patch.object(m, 'atomic', side_effect=fault):
            with self.assertRaisesRegex(RuntimeError, 'FAILED_CLOSED'):
                self.c.complete()
        self.assertEqual(self.coord.read_bytes(), self.owned)
        self.assertEqual(self.target.read_bytes(), self.before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
