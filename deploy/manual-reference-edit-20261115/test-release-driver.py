#!/usr/bin/env python3
"""Finite fixtures only. Maps ALL /opt,/var paths into a TemporaryDirectory. No real PM2.
Production loader is separately pinned; these tests exercise IO/Engine failure ownership.
"""
import sys
sys.dont_write_bytecode=True
import copy, importlib.util, json, pathlib, tempfile, unittest, hashlib, fcntl, os, base64
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('driver',HERE/'release-driver.py');D=importlib.util.module_from_spec(spec);spec.loader.exec_module(D)
class FakeIO(D.IO):
    def __init__(self,root):self.root=pathlib.Path(root);self.fail_cas_path=None;self.failed=False;self.crash_after=False
    def path(self,p):
        p=pathlib.Path(p)
        if str(p).startswith(str(self.root)+'/'):return p
        return self.root/str(p).lstrip('/')
    def cas(self,p,b,a):
        if p==self.fail_cas_path and not self.failed:
            self.failed=True
            if self.crash_after:super().cas(p,b,a)
            raise RuntimeError('FIXTURE_CAS_INJECTED')
        return super().cas(p,b,a)
class Harness:
    def __init__(self):
        self.t=tempfile.TemporaryDirectory();self.io=FakeIO(self.t.name);self.calls=[];self.fail_forward=None;self.fail_rollback=None;self.failed=False
        self.rows=[]
        for id in [0,201,202,203,204,205,190,191,192,193,194,200]:
            front=id in (190,193,194,200);admin=id in (191,192);self.rows.append({'id':id,'name':'dianzi51' if front else 'dianzi51-admin' if admin else 'other'+str(id),'pid':id+1000,'status':'online','script':D.FRONT if front else D.ADMIN if admin else '/opt/other/script.js','cwd':'/opt/existing-cwd','execMode':'cluster_mode','environmentHash':D.sha(('unchanged-'+str(id)).encode())})
        self.before=copy.deepcopy(self.rows);coord=D.enc({'shared_release_active':False,'window':{'status':'verified','opsDir':D.OLD},'other':{'preserve':True}})
        data={'baseline/index.html':b'<html>old</html>','candidate/index.html':b'<html>new</html>','baseline/front-index.js':b'front old','candidate/api/front-index.js':b'front new','baseline/admin-index.js':b'admin old','candidate/api/admin-index.js':b'admin new','candidate/assets/new-a.js':b'new A','candidate/assets/new-b.js':b'new B','coordination-before.json':coord,'attached-reloader.cjs':b'fixture bridge','release-driver.py':b'fixture driver'}
        self.m={'packageHashes':{n:D.sha(b) for n,b in data.items()},'backendFiles':[{'kind':kind,'path':api,'relative':'api/'+kind+'-index.js','ownedIds':ids,'beforeSha256':D.sha(data['baseline/'+kind+'-index.js']),'sha256':D.sha(data['candidate/api/'+kind+'-index.js'])} for kind,api,ids in [('front',D.FRONT,[190,193,194,200]),('admin',D.ADMIN,[191,192])]],'beforeHtmlSha256':D.sha(data['baseline/index.html']),'htmlSha256':D.sha(data['candidate/index.html']),'capturedCoordSha256':D.sha(coord),'baselineProcesses':self.before,'baselineAssets':[{'relative':'assets/old.js','sha256':D.sha(b'IMMUTABLE OLD')}],'files':[{'relative':n[10:],'sha256':D.sha(b)} for n,b in data.items() if n.startswith('candidate/assets/')]+[{'relative':'index.html','sha256':D.sha(data['candidate/index.html'])}],'manualDisabledGuard':{'path':'/var/lib/51dianzi/channel-reference-manual-v1/manual-refresh-config.json','expected':'absent'},'protectedFiles':[],'protectedEnvFiles':[{'path':'/opt/protected/test.env','sha256':D.sha(b'PRIVATE FIXTURE')}],'legacyFrozenFiles':[],'frozenRootTrees':[{'root':D.OLD,'files':[['immutable.txt',D.sha(b'OLD ROOT')]]}]}
        for p,b in [(D.COORD,coord),(D.FRONT,data['baseline/front-index.js']),(D.ADMIN,data['baseline/admin-index.js']),(D.PUBLIC+'/index.html',data['baseline/index.html']),(D.PUBLIC+'/assets/old.js',b'IMMUTABLE OLD'),('/opt/protected/test.env',b'PRIVATE FIXTURE'),(D.OLD+'/immutable.txt',b'OLD ROOT')]:self.put(p,b)
        self.m['legacyFrozenFiles']=[{'path':p,'sha256':D.sha(self.io.read(p))} for p in [D.COORD,D.FRONT,D.ADMIN,D.PUBLIC+'/index.html',D.OLD+'/immutable.txt']]
        for n,b in data.items():self.put(D.CANDIDATE+'/'+n,b)
        mb=D.enc(self.m);self.put(D.CANDIDATE+'/manifest.json',mb)
        self.c={'ownerTask':D.OWNER,'runtimeRoot':D.ROOT,'candidateDir':D.CANDIDATE,'manifestSha256':D.sha(mb),'inputContractSha256':'a'*64,'attemptId':'fixture-attempt-0001','rootOwnershipNonce':'fixture-root-nonce-0001'}
        self.e=D.Engine(self.c,'b'*64,{'m':self.m},self.io,self.rpc)
    def put(self,p,b):q=self.io.path(p);q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(b)
    def rpc(self,id=None,rollback=False):
        if id is None:return copy.deepcopy(self.rows)
        state=json.loads(self.io.read(D.ROOT+'/activation-state.json'));assert state['intents'][-1]['id']==id and state['intents'][-1]['direction']==('rollback' if rollback else 'forward');assert json.loads(self.io.read(D.COORD))['shared_release_active'] is True
        row=next(r for r in self.rows if r['id']==id);row['pid']+=10000;self.calls.append((id,rollback))
        if ((id==self.fail_forward and not rollback) or (id==self.fail_rollback and rollback)) and not self.failed:self.failed=True;raise RuntimeError('FIXTURE_RPC_ACK_LOSS')
        return copy.deepcopy(self.rows)
    def close(self):self.t.cleanup()
    def assertOld(self,test):
        test.assertEqual(self.io.read(D.FRONT),b'front old');test.assertEqual(self.io.read(D.ADMIN),b'admin old');test.assertEqual(self.io.read(D.PUBLIC+'/index.html'),b'<html>old</html>');test.assertEqual(self.io.read(D.PUBLIC+'/assets/old.js'),b'IMMUTABLE OLD');test.assertEqual(self.io.read(D.OLD+'/immutable.txt'),b'OLD ROOT');test.assertFalse(self.io.exists(D.PUBLIC+'/assets/new-a.js'));test.assertFalse(self.io.exists(D.PUBLIC+'/assets/new-b.js'));test.assertFalse(json.loads(self.io.read(D.COORD))['shared_release_active']);test.assertTrue(all(r['status']=='online' for r in self.rows));test.assertEqual([r for r in self.rows if r['id'] not in D.IDS],[r for r in self.before if r['id'] not in D.IDS])
class Tests(unittest.TestCase):
    def setUp(self):self.h=Harness();self.addCleanup(self.h.close)
    def test_success_exact_six_order_and_idle(self):
        result=self.h.e.apply();self.assertTrue(result['windowClosed']);self.assertEqual(self.h.calls,[(id,False) for id in D.IDS]);self.assertEqual(self.h.io.read(D.FRONT),b'front new');self.assertEqual(self.h.io.read(D.ADMIN),b'admin new');self.assertEqual(self.h.io.read(D.PUBLIC+'/index.html'),b'<html>new</html>');self.assertEqual(self.h.io.read(D.PUBLIC+'/assets/old.js'),b'IMMUTABLE OLD');self.assertEqual(self.h.e.verify()['status'],'VERIFIED_APPLIED')
    def test_plan_zero_writes(self):
        self.assertEqual(self.h.e.preflight()['writes'],0);self.assertFalse(self.h.io.exists(D.ROOT));self.assertEqual(self.h.calls,[])
    def test_failure_each_of_six_precise_rollback(self):
        self.h.close()
        for n,id in enumerate(D.IDS):
            with self.subTest(id=id):
                h=Harness();h.fail_forward=id
                try:
                    with self.assertRaises(RuntimeError):h.e.apply()
                    h.assertOld(self);self.assertEqual([i for i,r in h.calls if not r],list(D.IDS[:n+1]));self.assertEqual([i for i,r in h.calls if r],list(D.IDS[:n+1]));self.assertEqual(h.e.verify()['status'],'VERIFIED_OWNED_ROLLBACK')
                finally:h.close()
    def test_front_cas_fail_no_reload(self):
        self.h.io.fail_cas_path=D.FRONT
        with self.assertRaises(RuntimeError):self.h.e.apply()
        self.h.assertOld(self);self.assertEqual(self.h.calls,[])
    def test_admin_cas_crash_after_write(self):
        self.h.io.fail_cas_path=D.ADMIN;self.h.io.crash_after=True
        with self.assertRaises(RuntimeError):self.h.e.apply()
        self.h.assertOld(self);self.assertEqual(self.h.calls,[])
    def test_html_cas_crash_after_write(self):
        self.h.io.fail_cas_path=D.PUBLIC+'/index.html';self.h.io.crash_after=True
        with self.assertRaises(RuntimeError):self.h.e.apply()
        self.h.assertOld(self);self.assertEqual(len(self.h.calls),12)
    def test_coordinator_open_failure_no_write_or_reload(self):
        self.h.io.fail_cas_path=D.COORD
        with self.assertRaises(RuntimeError):self.h.e.apply()
        self.h.assertOld(self);self.assertEqual(self.h.calls,[])
    def test_env_drift_blocks_preflight(self):
        self.h.put('/opt/protected/test.env',b'DRIFT')
        with self.assertRaisesRegex(RuntimeError,'PIN_DRIFT'):self.h.e.preflight()
        self.assertFalse(self.h.io.exists(D.ROOT))
    def test_unknown_asset_blocks(self):
        self.h.put(D.PUBLIC+'/assets/extra.js',b'EXTRA')
        with self.assertRaisesRegex(RuntimeError,'ASSET_SHAPE'):self.h.e.preflight()
    def test_oldroot_extra_blocks(self):
        self.h.put(D.OLD+'/extra.txt',b'EXTRA')
        with self.assertRaisesRegex(RuntimeError,'ROOT_SHAPE'):self.h.e.preflight()
    def test_manual_config_blocks(self):
        self.h.put(self.h.m['manualDisabledGuard']['path'],b'{}')
        with self.assertRaisesRegex(RuntimeError,'MANUAL_CONFIG'):self.h.e.preflight()
    def test_other6_pid_drift_blocks(self):
        self.h.rows[0]['pid']+=1
        with self.assertRaisesRegex(RuntimeError,'OTHER6'):self.h.e.preflight()
    def test_target_env_drift_blocks(self):
        next(r for r in self.h.rows if r['id']==191)['environmentHash']='f'*64
        with self.assertRaisesRegex(RuntimeError,'ENV_CWD'):self.h.e.preflight()
    def test_repeat_apply_refused(self):
        self.h.e.apply()
        with self.assertRaisesRegex(RuntimeError,'ROOT_ALREADY'):self.h.e.apply()
    def test_cas_wrong_full_bytes_refused(self):
        with self.assertRaisesRegex(RuntimeError,'CAS_DRIFT'):self.h.io.cas(D.FRONT,b'WRONG',b'NEW')
    def test_symlink_refused(self):
        q=self.h.io.path('/opt/sym');q.symlink_to(self.h.io.path(D.FRONT))
        with self.assertRaisesRegex(RuntimeError,'SYMLINK'):self.h.io.read('/opt/sym')
    def test_both_nonblocking_locks(self):
        for p in D.LOCKS:self.h.put(p,b'')
        with self.h.io.locks():
            with self.assertRaises(BlockingIOError):
                with self.h.io.locks():pass
    def test_native_inverse_partition_tamper(self):
        b=b'abcXYZtail';a=b'abcNEWtail';x={'start':3,'end':6,'afterStart':3,'afterEnd':6,'beforeBase64':base64.b64encode(b'XYZ').decode(),'afterBase64':base64.b64encode(b'NEW').decode(),'beforeSha256':D.sha(b'XYZ'),'afterSha256':D.sha(b'NEW')};p={'beforeSha256':D.sha(b),'afterSha256':D.sha(a),'patches':[x],'unchangedPartitions':[{'beforeStart':0,'beforeEnd':3,'afterStart':0,'afterEnd':3,'sha256':D.sha(b'abc')},{'beforeStart':6,'beforeEnd':10,'afterStart':6,'afterEnd':10,'sha256':D.sha(b'tail')}],'exactInverse':True,'allUnmodifiedBytesPreserved':True};D.inverse(b,a,p);p['unchangedPartitions'].pop()
        with self.assertRaisesRegex(RuntimeError,'PARTITION'):D.inverse(b,a,p)
if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(Tests);r=unittest.TextTestRunner(verbosity=2).run(suite);out={'status':'PASS' if r.wasSuccessful() else 'FAIL','fixtureOnly':True,'tests':r.testsRun,'skipped':len(r.skipped),'testedDriverSha256':D.sha((HERE/'release-driver.py').read_bytes()),'productionExecuted':False};(HERE/'driver-fixture-qa.json').write_bytes(D.enc(out));sys.exit(0 if r.wasSuccessful() else 1)
