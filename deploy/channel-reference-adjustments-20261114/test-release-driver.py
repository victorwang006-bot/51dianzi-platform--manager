#!/usr/bin/env python3
"""Offline fake filesystem + fake RPC ONLY; no production paths are touched."""
import importlib.util, pathlib, tempfile, json, copy, unittest, hashlib, builtins, contextlib
WORK=pathlib.Path('/home/ubuntu/work/channel-reference-adjustments-20261114/deploy-prep')
REPO=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('newrelease',REPO/'release-driver.py');D=importlib.util.module_from_spec(spec);spec.loader.exec_module(D)
class FakeIO(D.IO):
    def __init__(self):self.tmp=tempfile.TemporaryDirectory(prefix='driver-fixture-',dir=WORK);self.base=pathlib.Path(self.tmp.name);self.writes=[];self.drift_open=False
    def path(self,p):
        q=pathlib.Path(p)
        if str(q).startswith(str(self.base)+'/') or q==self.base:return q
        return self.base/str(q).lstrip('/')
    def seed(self,p,b=b''):
        q=self.path(p);q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(b)
    def put(self,p,b,exclusive=False):self.writes.append(('put',p));return super().put(p,b,exclusive)
    def append(self,p,b):self.writes.append(('append',p));return super().append(p,b)
    def add(self,p,b):self.writes.append(('add',p));return super().add(p,b)
    def cas(self,p,before,after):
        self.writes.append(('cas',p))
        if p==D.COORD and self.drift_open:
            self.drift_open=False;self.seed(p,before+b' ')
        return super().cas(p,before,after)
    def cleanup(self):self.tmp.cleanup()
class Fixture:
    def __init__(self):
        self.io=FakeIO();self.before=json.loads((WORK.parent/'baseline/live-baseline-current.json').read_bytes())['processes'];self.rows=copy.deepcopy(self.before);self.calls=[];self.failure=None
        self.c={'ownerTask':'YFqDo2AR0TXSRSf6EV1KvK','rootOwnershipNonce':'fixture_root_ownership_nonce','attemptId':'fixture_attempt_20261115','manifestSha256':'a'*64,'inputContractSha256':'b'*64}
        self.inputsha='c'*64;self.candidate='/private-incoming/fixture';self.oldapi=b'old api exact';self.newapi=b'new api exact';self.oldhtml=b'old html exact';self.newhtml=b'new html exact';self.coord=D.enc({'shared_release_active':False,'window':{'status':'idle'},'unrelated':'preserve'})
        files={'baseline/admin-index.js':self.oldapi,'candidate/api/admin-index.js':self.newapi,'baseline/index.html':self.oldhtml,'candidate/index.html':self.newhtml,'candidate/assets/new.js':b'new asset','coordination-before.json':self.coord,'channel-reference-service.mjs':b'fixture helper','channel-reference-snapshot.json':b'fixture data'}
        for n in ('release-driver.py','attached-admin-reloader.cjs','validate-snapshot-helper.cjs'):files[n]=(REPO/n).read_bytes()
        self.m={'ownerTask':self.c['ownerTask'],'runtimeRoot':D.ROOT,'baselineProcesses':self.before,'packageHashes':{n:D.sha(b) for n,b in files.items()},'baselineAssets':[{'relative':'assets/old.js','sha256':D.sha(b'oldasset')}],'protectedFiles':[{'path':'/protected/source.ts','sha256':D.sha(b'frozen source')}],'legacyFrozenFiles':[{'path':D.OLD+'/old.js','sha256':D.sha(b'old helper')}],'untouchedFrontApiSha256':D.sha(b'front frozen'),'beforeHtmlSha256':D.sha(self.oldhtml),'htmlSha256':D.sha(self.newhtml),'capturedCoordSha256':D.sha(self.coord),'backendFiles':[{'beforeSha256':D.sha(self.oldapi),'sha256':D.sha(self.newapi)}],'files':[{'relative':'assets/new.js','sha256':D.sha(b'new asset')},{'relative':'index.html','sha256':D.sha(self.newhtml)}]}
        self.manifest=D.enc(self.m);self.c['manifestSha256']=D.sha(self.manifest)
        for n,b in files.items():self.io.seed(self.candidate+'/'+n,b)
        self.io.seed(self.candidate+'/manifest.json',self.manifest)
        for p,b in [(D.ADMIN,self.oldapi),(D.FRONT,b'front frozen'),(D.PUBLIC+'/index.html',self.oldhtml),(D.PUBLIC+'/assets/old.js',b'oldasset'),('/protected/source.ts',b'frozen source'),(D.OLD+'/old.js',b'old helper'),(D.COORD,self.coord)]:self.io.seed(p,b)
        self.io.path(D.ROOT).parent.mkdir(parents=True,exist_ok=True)
        for p in D.LOCKS:self.io.seed(p,b'existing lock')
        self.engine=D.Engine(self.c,self.inputsha,{'candidate':self.candidate,'m':self.m},self.io,self.rpc)
    def rpc(self,id=None,rollback=False):
        if id is None:return copy.deepcopy(self.rows)
        assert id in D.IDS
        state=json.loads(self.io.read(D.ROOT+'/activation-state.json'));direction='rollback' if rollback else 'forward';assert state['intents'][-1]['id']==id and state['intents'][-1]['direction']==direction
        owned=self.io.read(D.ROOT+'/coordination-owned.json');assert self.io.read(D.COORD)==owned;assert json.loads(owned)['window']['nonce']==state['nonce'];assert self.io.read(D.ADMIN)==(self.oldapi if rollback else self.newapi)
        assert any(x['event']=='persisted-intent-before-rpc' and x['id']==id and x['direction']==direction for x in map(json.loads,self.io.read(D.ROOT+'/activation-events.jsonl').splitlines()))
        if id==192 and not rollback:assert any(x['id']==191 and x['direction']=='forward' for x in state['completed'])
        self.calls.append((id,direction))
        if self.failure and self.failure(id,rollback):raise RuntimeError('FAKE_RPC_FAILURE_'+str(id))
        row=next(x for x in self.rows if x['id']==id);row['pid']+=10000;row['status']='online';return copy.deepcopy(self.rows)
    def apply(self):
        with self.io.locks():return self.engine.apply(b'{"fixtureOnly":true}')
    def snapshot(self):return {str(p.relative_to(self.io.base)):p.read_bytes() for p in self.io.base.rglob('*') if p.is_file()}
    def close(self):self.io.cleanup()
class Tests(unittest.TestCase):
    def setUp(self):self.f=Fixture();self.addCleanup(self.f.close)
    def test_two_existing_locks_rplusb_no_creation(self):
        seen=[];real=builtins.open
        def opened(p,mode='r',*a,**k):seen.append((str(p),mode));return real(p,mode,*a,**k)
        from unittest.mock import patch
        with patch('builtins.open',opened):
            with self.f.io.locks():pass
        self.assertEqual([m for p,m in seen],['r+b','r+b'])
        self.f.io.path(D.LOCKS[1]).unlink()
        with self.assertRaises(FileNotFoundError):
            with self.f.io.locks():pass
        self.assertFalse(self.f.io.exists(D.LOCKS[1]))
    def test_plan_has_zero_writes_and_zero_reload(self):
        before=self.f.snapshot();r=self.f.engine.plan();self.assertEqual(r['writes'],0);self.assertEqual(before,self.f.snapshot());self.assertEqual(self.f.calls,[])
    def test_success_exact_targets_sequential_intents_and_frozen_other10(self):
        r=self.f.apply();self.assertTrue(r['windowClosed']);self.assertEqual(self.f.calls,[(191,'forward'),(192,'forward')]);D.rows_check(self.f.rows,self.f.before,owned=D.IDS,changed=D.IDS)
        self.assertEqual(self.f.io.read(D.ADMIN),self.f.newapi);self.assertEqual(self.f.io.read(D.PUBLIC+'/index.html'),self.f.newhtml);self.assertEqual(self.f.io.read(D.PUBLIC+'/assets/old.js'),b'oldasset');self.assertEqual(self.f.io.read(D.OLD+'/old.js'),b'old helper')
        state=self.f.engine.load_state();self.assertEqual(state['phase'],'verified');self.assertEqual(len(state['intents']),2);self.assertEqual(state['ownerTask'],self.f.c['ownerTask']);self.assertEqual(json.loads(self.f.io.read(D.COORD))['shared_release_active'],False)
    def test_verify_is_full_zero_write(self):
        self.f.apply();before=self.f.snapshot();writes=len(self.f.io.writes);self.f.engine.verify();self.assertEqual(before,self.f.snapshot());self.assertEqual(len(self.f.io.writes),writes)
    def test_repeated_apply_refused_without_second_reload(self):
        self.f.apply();calls=copy.deepcopy(self.f.calls)
        with self.assertRaisesRegex(RuntimeError,'REPEATED_APPLY'):self.f.apply()
        self.assertEqual(self.f.calls,calls)
    def test_192_failure_owned_exact_rollback_and_retained_window(self):
        self.f.failure=lambda id,rollback:id==192 and not rollback
        with self.assertRaisesRegex(RuntimeError,'FAKE_RPC_FAILURE'):self.f.apply()
        self.assertEqual(self.f.io.read(D.ADMIN),self.f.oldapi);self.assertEqual(self.f.io.read(D.PUBLIC+'/index.html'),self.f.oldhtml);state=self.f.engine.load_state();self.assertEqual(state['phase'],'rolled-back-pending-verify');self.assertTrue(json.loads(self.f.io.read(D.COORD))['shared_release_active']);self.assertIn('failure',state);self.assertEqual(self.f.calls,[(191,'forward'),(192,'forward'),(191,'rollback'),(192,'rollback')]);D.rows_check(self.f.rows,self.f.before,owned=D.IDS,changed=D.IDS)
        before=self.f.snapshot();self.f.engine.verify();self.assertEqual(before,self.f.snapshot());self.f.engine.close();self.assertEqual(self.f.engine.load_state()['phase'],'rolled-back');self.assertIn(b'FAKE_RPC_FAILURE',self.f.io.read(D.ROOT+'/activation-events.jsonl'))
    def test_partial_recovery_failure_durable_then_explicit_recover_only_two(self):
        self.f.failure=lambda id,rollback:id==192
        with self.assertRaises(RuntimeError):self.f.apply()
        state=self.f.engine.load_state();self.assertEqual(state['phase'],'recovery-required');self.assertIn('recoveryError',state);self.assertEqual({x['id'] for x in state['intents']},{191,192});self.assertTrue(json.loads(self.f.io.read(D.COORD))['shared_release_active'])
        self.f.failure=None;r=self.f.engine.recover();self.assertEqual(r['status'],'VERIFIED_OWNED_ROLLBACK_BYTES_PM2_ONLY');self.f.engine.close();self.assertTrue(all(i in D.IDS for i,d in self.f.calls));D.rows_check(self.f.rows,self.f.before,owned=D.IDS)
    def test_full_coord_byte_cas_drift_before_window_no_public_or_reload(self):
        self.f.io.drift_open=True
        with self.assertRaisesRegex(RuntimeError,'CAS_DRIFT'):self.f.apply()
        self.assertEqual(self.f.calls,[]);self.assertEqual(self.f.io.read(D.ADMIN),self.f.oldapi);self.assertEqual(self.f.io.read(D.PUBLIC+'/index.html'),self.f.oldhtml);self.assertFalse(self.f.io.exists(D.PUBLIC+'/assets/new.js'))
    def test_before_window_frozen_source_asset_api_html_oldroot_drift_refused(self):
        for p in ('/protected/source.ts',D.PUBLIC+'/assets/old.js',D.OLD+'/old.js',D.ADMIN,D.PUBLIC+'/index.html'):
            with self.subTest(path=p):
                f=Fixture()
                try:
                    f.io.seed(p,b'DRIFT')
                    with self.assertRaisesRegex(RuntimeError,'PIN_DRIFT'):f.apply()
                    self.assertEqual(f.calls,[]);self.assertEqual(f.io.read(D.COORD),f.coord);self.assertFalse(f.io.exists(D.PUBLIC+'/assets/new.js'))
                finally:f.close()
    def test_coordinator_semantic_same_extra_byte_drift_close_refused(self):
        self.f.failure=lambda id,rollback:id==192 and not rollback
        with self.assertRaises(RuntimeError):self.f.apply()
        b=self.f.io.read(D.COORD);self.f.io.seed(D.COORD,b+b' ')
        with self.assertRaisesRegex(RuntimeError,'FULL_COORDINATION'):self.f.engine.close()
        self.assertTrue(json.loads(self.f.io.read(D.COORD))['shared_release_active'])
    def test_recover_refuses_unowned_api_bytes_and_keeps_evidence(self):
        self.f.failure=lambda id,rollback:True
        with self.assertRaises(RuntimeError):self.f.apply()
        self.f.io.seed(D.ADMIN,b'foreign edit')
        with self.assertRaisesRegex(RuntimeError,'UNOWNED_BYTES'):self.f.engine.recover()
        self.assertEqual(self.f.io.read(D.ADMIN),b'foreign edit');self.assertTrue(json.loads(self.f.io.read(D.COORD))['shared_release_active'])
    def test_existing_root_owner_nonce_and_extra_file_refused_before_window(self):
        self.f.engine.install();owner=json.loads(self.f.io.read(D.ROOT+'/release-owner.json'));owner['nonce']='different';self.f.io.seed(D.ROOT+'/release-owner.json',D.enc(owner))
        with self.assertRaisesRegex(RuntimeError,'OWNER_NONCE'):self.f.apply()
        self.assertEqual(self.f.calls,[]);self.assertEqual(self.f.io.read(D.COORD),self.f.coord)
        self.f.io.seed(D.ROOT+'/release-owner.json',D.enc(self.f.engine.root_owner()));self.f.io.seed(D.ROOT+'/unknown.js',b'foreign')
        with self.assertRaisesRegex(RuntimeError,'UNKNOWN_EXTRA'):self.f.apply()
    def test_existing_owned_private_root_safe_reuse(self):
        self.f.engine.install();self.f.engine.plan();self.f.apply();self.assertEqual(self.f.calls,[(191,'forward'),(192,'forward')])
    def test_other10_and_admin_config_env_cwd_script_exact(self):
        for id,key,value in [(self.f.before[0]['id'],'pid',999999),(191,'environmentHash','foreign'),(192,'cwd','foreign'),(191,'script','foreign'),(192,'execMode','fork_mode')]:
            rows=copy.deepcopy(self.f.before);next(p for p in rows if p['id']==id)[key]=value
            with self.assertRaises(RuntimeError):D.rows_check(rows,self.f.before,owned=D.IDS)
    def test_recovery_owner_attempt_and_nonce_drift_refused(self):
        self.f.failure=lambda id,rollback:True
        with self.assertRaises(RuntimeError):self.f.apply()
        self.f.engine.load_state();original=copy.deepcopy(self.f.engine.state);self.f.engine.state['nonce']='wrong'
        with self.assertRaisesRegex(RuntimeError,'NONCE_OWNER'):self.f.engine.owned_coord()
        self.f.engine.state=original;self.f.engine.state['ownerTask']='foreign'
        with self.assertRaisesRegex(RuntimeError,'OWNERSHIP'):self.f.engine.owned_coord()
if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(Tests);result=unittest.TextTestRunner(verbosity=2).run(suite);report={'contractVersion':'channel-adjustments-fake-driver-qa-v1','status':'PASS' if result.wasSuccessful() else 'FAIL','fixtureOnly':True,'productionRPC':False,'db':False,'ssh':False,'count':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'testedDriverSha256':hashlib.sha256((REPO/'release-driver.py').read_bytes()).hexdigest(),'testNames':unittest.defaultTestLoader.getTestCaseNames(Tests)};(WORK/'fake-driver-qa.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2));raise SystemExit(not result.wasSuccessful())
