import importlib.util,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,'/home/ubuntu/work/resume-frontend/controller-r2')
spec=importlib.util.spec_from_file_location('closure','/home/ubuntu/work/resume-frontend/close-recovery.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
h=m.h
class CloseTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory();self.root=Path(self.t.name);self.root.chmod(0o700)
        m.NEW_STAGE=self.root;m.RECOVERY=self.root/'recovery';m.RECOVERY.mkdir(mode=0o700)
        self.cfg=SimpleNamespace(coord=self.root/'coord.json',locks=[self.root/'lock1',self.root/'lock2'])
        for x in self.cfg.locks:x.touch(mode=0o600)
        self.before=h.encode({'shared_release_active':True,'needsOperatorRecovery':True,'window':{'status':'recovery-required','needsOperatorRecovery':True,'nonce':'owned'}})
        self.closed=h.encode({'shared_release_active':False,'needsOperatorRecovery':False,'window':{'status':'closed','needsOperatorRecovery':False,'nonce':'owned','closedAtUtc':h.now()}})
        h.exclusive(self.cfg.coord,self.before);self.record=h.describe(self.cfg.coord)
        self.terminal=m.RECOVERY/'confirmed.json';self.data=b'validated-terminal\n';h.exclusive(self.terminal,self.data);self.tr=h.describe(self.terminal)
    def tearDown(self):self.t.cleanup()
    def run_close(self):
        with h.locked(self.cfg):m.close_cas(self.cfg,self.before,self.record,self.closed,self.terminal,self.data,self.tr)
    def test_success(self):
        self.run_close();self.assertEqual(h.regular(self.cfg.coord),self.closed);self.assertFalse((m.RECOVERY/'failure.json').exists())
    def test_late_fsync_restores_owned_hold(self):
        real=h.fsync_dir;fired=False
        def fail(path):
            nonlocal fired
            if not fired and h.regular(self.cfg.coord)==self.closed:
                fired=True;raise OSError('injected late fsync')
            return real(path)
        with patch.object(h,'fsync_dir',fail),self.assertRaisesRegex(h.ReleaseError,'HOLD_CONFIRMED'):self.run_close()
        self.assertTrue(fired);self.assertEqual(h.regular(self.cfg.coord),self.before);self.assertTrue((m.RECOVERY/'failure.json').exists())
    def test_terminal_drift_restores_owned_hold(self):
        real=h.atomic_cas
        def change(*a,**k):
            result=real(*a,**k)
            if a[2]==self.closed:self.terminal.write_bytes(b'changed')
            return result
        with patch.object(h,'atomic_cas',change),self.assertRaisesRegex(h.ReleaseError,'HOLD_CONFIRMED'):self.run_close()
        self.assertEqual(h.regular(self.cfg.coord),self.before)
    def test_foreign_after_rename_is_not_overwritten(self):
        real=h.atomic_cas;foreign=b'foreign-coordination\n'
        def replace(*a,**k):
            real(*a,**k);self.cfg.coord.write_bytes(foreign);raise OSError('late failure with foreign write')
        with patch.object(h,'atomic_cas',replace),self.assertRaisesRegex(h.ReleaseError,'OWNERSHIP_UNCONFIRMED'):self.run_close()
        self.assertEqual(h.regular(self.cfg.coord),foreign);self.assertTrue((m.RECOVERY/'failure.json').exists())
    def test_before_rename_failure_keeps_original_hold(self):
        with patch.object(h,'atomic_cas',side_effect=OSError('before rename')),self.assertRaisesRegex(h.ReleaseError,'HOLD_CONFIRMED'):self.run_close()
        self.assertEqual(h.regular(self.cfg.coord),self.before)
if __name__=='__main__':unittest.main(verbosity=2)
