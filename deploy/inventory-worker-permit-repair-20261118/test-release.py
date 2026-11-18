#!/usr/bin/env python3
import base64,copy,contextlib,importlib.util,io,json,pathlib,stat,tempfile,types,unittest,unittest.mock
spec=importlib.util.spec_from_file_location('repair_release',pathlib.Path(__file__).with_name('release.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Safety(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.pack=self.root/'pack';self.pack.mkdir();self.coord=self.root/'coord.json';self.coord.write_bytes(m.encode({'shared_release_active':False,'otherTask':'preserve'}));self.permit=self.root/'permit.json';self.other=self.root/'other-api.js';self.other.write_bytes(b'other-stats-api');self.backup=self.root/'backup';self.locks=[]
  for i in range(2):
   p=self.root/('lock'+str(i));p.touch();self.locks.append(str(p))
  self.ps=[];self.workers=[]
  for role,i in m.TARGETS.items():
   path=self.root/(role+'.js');path.write_bytes(b'a');self.ps.append({'id':i,'name':'dianzi51-'+role,'pid':100+i,'status':'online','script':str(path),'cwd':'same','mode':'fork_mode','envSha256':'env-unchanged'})
   record={'byteStart':0,'byteEnd':1,'newByteStart':0,'newByteEnd':1,'oldBase64':base64.b64encode(b'a').decode(),'newBase64':base64.b64encode(b'b').decode(),'oldSha256':m.H(b'a'),'newSha256':m.H(b'b')};d=role+'-delta.json';(self.pack/d).write_bytes(m.encode({'records':[record]}));self.workers.append({'role':role,'target':str(path),'beforeSha256':m.H(b'a'),'afterSha256':m.H(b'b'),'delta':d,'deltaSha256':m.H((self.pack/d).read_bytes())})
  self.ps.append({'id':190,'name':'dianzi51','pid':99,'status':'online','script':str(self.other),'cwd':'other','mode':'cluster_mode','envSha256':'other-env'});self.ps.sort(key=lambda x:x['id']);self.before=copy.deepcopy(self.ps)
  old={'epochId':'fixed-epoch','proofSha256':'1'*64,'confirmedActive':True,'preActiveReadinessSha256':'2'*64,'postActiveReadinessSha256':'3'*64,'candidateManifestSha256':'4'*64,'workerArtifactSha256':{r:m.H(b'previous-approved')for r in m.TARGETS},'issuedAt':'2026-11-12T00:00:00.000Z'}
  for r in ['refund','chat-sync','forum-quote']:old['workerArtifactSha256'][r]=m.H(r.encode())
  old['contentSha256']=m.H(m.canonical(old).encode());self.old=m.encode(old);self.permit.write_bytes(self.old);(self.pack/'native-permit-readonly.cjs').write_bytes(b'fake-mocked-probe')
  self.man={'ownerTask':m.OWNER,'scope':'inventory-worker-permit-reconciliation','directBusinessDml':0,'apiHtmlWrites':0,'workers':self.workers,'protectedFiles':[{'path':str(self.other),'sha256':m.H(self.other.read_bytes())}],'beforeProcesses':copy.deepcopy(self.ps),'permitPath':str(self.permit),'beforePermitSha256':m.H(self.old),'probeSha256':m.H((self.pack/'native-permit-readonly.cjs').read_bytes()),'controllerSha256':m.H(pathlib.Path(m.__file__).read_bytes())};self.man['afterPermitSha256']=m.H(m.build_permit(self.old,self.man));self.mb=m.encode(self.man);(self.pack/'manifest.json').write_bytes(self.mb)
  original_lstat=pathlib.Path.lstat
  def fake_stat(path,*args,**kwargs):
   if path==self.permit:return types.SimpleNamespace(st_uid=0,st_mode=stat.S_IFREG|0o600,st_nlink=1)
   return original_lstat(path,*args,**kwargs)
  def command(name):
   for p in self.ps:
    if p['id']in m.TARGETS.values():p['status']='stopped'if name=='stop'else'online';p['pid']=0 if name=='stop'else 500+p['id']
  self.command=command
  self.patches=[unittest.mock.patch.object(m,'COORD',self.coord),unittest.mock.patch.object(m,'LOCKS',self.locks),unittest.mock.patch.object(m,'BACKUP',self.backup),unittest.mock.patch.object(m,'proc',side_effect=lambda:copy.deepcopy(self.ps)),unittest.mock.patch.object(m,'command',side_effect=command),unittest.mock.patch.object(m,'native_probe',return_value=[]),unittest.mock.patch.object(m.subprocess,'run',return_value=None),unittest.mock.patch.object(pathlib.Path,'lstat',fake_stat)]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.tmp.cleanup()
 def run_release(self,apply=False):
  with unittest.mock.patch('sys.argv',['release.py','--package',str(self.pack),'--manifest-sha256',m.H(self.mb)]+(['--apply']if apply else[])),contextlib.redirect_stdout(io.StringIO())as o:m.main();return o.getvalue()
 def test_preflight_no_active_writes(self):
  self.assertIn('PREFLIGHT_PASS',self.run_release());self.assertEqual(self.permit.read_bytes(),self.old);self.assertEqual(self.ps,self.before)
 def test_success_exact_two_roles_and_other_preserved(self):
  self.assertIn('verified',self.run_release(True));x=json.loads(self.permit.read_bytes());old=json.loads(self.old)
  for role in ['refund','chat-sync','forum-quote']:self.assertEqual(x['workerArtifactSha256'][role],old['workerArtifactSha256'][role])
  for k in old:
   if k not in ['workerArtifactSha256','contentSha256']:self.assertEqual(x[k],old[k])
  self.assertEqual(self.other.read_bytes(),b'other-stats-api');self.assertEqual(json.loads(self.coord.read_bytes())['otherTask'],'preserve');self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active'])
 def test_worker_drift_refused(self):
  pathlib.Path(self.workers[0]['target']).write_bytes(b'foreign')
  with self.assertRaisesRegex(RuntimeError,'WORKER_FRONTIMAGE_DRIFT'):self.run_release(True)
  self.assertEqual(self.permit.read_bytes(),self.old)
 def test_permit_drift_refused(self):
  self.permit.write_bytes(b'foreign permit')
  with self.assertRaisesRegex(RuntimeError,'PERMIT_FRONTIMAGE_DRIFT'):self.run_release(True)
 def test_other_api_drift_refused(self):
  self.other.write_bytes(b'foreign new stats')
  with self.assertRaisesRegex(RuntimeError,'PROTECTED_FILE_DRIFT'):self.run_release(True)
 def test_busy_window_refused(self):
  self.coord.write_bytes(m.encode({'shared_release_active':True}))
  with self.assertRaisesRegex(RuntimeError,'SHARED_WINDOW_BUSY'):self.run_release(True)
 def test_process_env_drift_refused(self):
  self.ps[0]['envSha256']='changed'
  with self.assertRaisesRegex(RuntimeError,'EXACT_PROCESS_FRONTIMAGE_DRIFT'):self.run_release(True)
 def test_invalid_content_digest_refused(self):
  x=json.loads(self.old);x['contentSha256']='0'*64
  with self.assertRaisesRegex(RuntimeError,'ORIGINAL_PERMIT_CONTENT_DIGEST'):m.build_permit(m.encode(x),self.man)
 def test_guard_rejection_recovers_before_state(self):
  count=0
  def probe(script,required=None):
   nonlocal count;count+=1
   if count==2:raise RuntimeError('AFTER_GUARD_FALSE')
   return []
  with unittest.mock.patch.object(m,'native_probe',side_effect=probe),self.assertRaisesRegex(RuntimeError,'AFTER_GUARD_FALSE'):self.run_release(True)
  self.assertEqual(self.permit.read_bytes(),self.old);self.assertTrue(all(pathlib.Path(r['target']).read_bytes()==b'a'for r in self.workers));self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active'])
 def test_foreign_worker_not_overwritten_and_blocking_window(self):
  def probe(script,required=None):
   if required is True:pathlib.Path(self.workers[0]['target']).write_bytes(b'FOREIGN');raise RuntimeError('FOREIGN_MUTATION')
   return []
  with unittest.mock.patch.object(m,'native_probe',side_effect=probe),self.assertRaisesRegex(RuntimeError,'FOREIGN_MUTATION'):self.run_release(True)
  self.assertEqual(pathlib.Path(self.workers[0]['target']).read_bytes(),b'FOREIGN');self.assertTrue(json.loads(self.coord.read_bytes())['shared_release_active']);self.assertEqual(json.loads(self.coord.read_bytes())['window']['status'],'recovery-required')
if __name__=='__main__':unittest.main(verbosity=2)
