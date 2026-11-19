import importlib.util,json,pathlib,sys,tempfile,unittest,datetime
from contextlib import ExitStack,redirect_stdout
from io import StringIO
from unittest.mock import patch
W=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('release',W/'static-release.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class ReleaseSafety(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='cart-static-offline-');self.root=pathlib.Path(self.temp.name);self.public=self.root/'public';self.public.mkdir();self.stage=self.root/'stage';self.stage.mkdir();self.pack=self.stage/'package';self.pack.mkdir();(self.pack/'evidence').mkdir();self.receipt=self.stage/'receipt';self.coord=self.root/'coord.json';self.flag=self.root/'flag.json';self.oldflag=self.root/'oldflag.json'
  self.before=b'anonymous old HTML';self.after=b'anonymous new HTML';(self.public/'index.html').write_bytes(self.before)
  self.ps=[{'id':i,'pid':100+i,'status':'online','name':'anonymous-'+str(i),'script':'/fixed/script','cwd':'/fixed/cwd','envHash':mod.H(b'env')}for i in range(12)]
  self.apiHistory={'owner_task':mod.OWNER,'scope':'official-cart-api-20261119','manifestSha256':mod.H(b'api'),'nonce':'a'*32,'status':'verified','closedAtUtc':mod.now(),'needsOperatorRecovery':False}
  self.oldHistory={'owner_task':mod.OLD_OWNER,'manifestSha256':mod.OLD_MANIFEST,'status':'verified','closedAtUtc':mod.now()}
  self.coord.write_bytes(mod.encode({'shared_release_active':False,'window_history':[self.oldHistory,self.apiHistory]}))
  self.newFlag={'ownerTask':mod.OWNER,'scope':'official-cart-api-20261119','enabled':True,'manifestSha256':self.apiHistory['manifestSha256'],'nonce':'a'*32,'runtimeSha256':mod.H(b'cart runtime')};self.flag.write_bytes(mod.encode(self.newFlag));self.oldflag.write_bytes(b'old paid guard')
  self.initial=[]
  for i in range(276):
   p=self.root/('protected-'+str(i));p.write_bytes(b'protected');self.initial.append({'path':str(p),'sha256':mod.H(p.read_bytes())})
  self.initial.append({'path':str(self.oldflag),'sha256':mod.H(self.oldflag.read_bytes())});self.files=list(self.initial)
  self.apiPins={}
  for name,b in [('front.js',b'front after'),('refund.js',b'refund after'),('officialCart.test.runtime.mjs',b'cart runtime'),('officialCartStock.test.runtime.mjs',b'stock runtime')]:
   p=self.root/name;p.write_bytes(b);self.apiPins[str(p)]=mod.H(b);self.files.append({'path':str(p),'sha256':mod.H(b)})
  self.files.append({'path':str(self.flag),'sha256':mod.H(self.flag.read_bytes())})
  self.assets=[];self.assetPins={}
  for ext,prefix in [('official-cart-ui','assets/'),('search-official-cart','assets/'),('nav-official-cart',mod.SUBDIR),('cart-official-cart',mod.SUBDIR)]:
   b=('anonymous '+ext).encode();h=mod.H(b);name=prefix+ext+'-'+h+'.js';p=self.pack/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);self.assets.append({'relative':name,'sha256':h});self.assetPins[name]=h;(self.public/name).parent.mkdir(parents=True,exist_ok=True)
  (self.pack/'baseline-index.html').write_bytes(self.before);(self.pack/'candidate-index.html').write_bytes(self.after)
  ib=mod.encode({'protectedFiles':self.initial});(self.pack/'evidence/protection-initial.json').write_bytes(ib)
  self.capture={'capturedAtUtc':mod.now(),'beforeProcesses':self.ps,'protectedFiles':self.files,'coordinator':json.loads(self.coord.read_bytes()),'coordinatorSha256':mod.H(self.coord.read_bytes()),'newFlag':self.newFlag,'newFlagSha256':mod.H(self.flag.read_bytes())}
  self.manifest={'ownerTask':mod.OWNER,'scope':mod.SCOPE,'apiWrites':0,'databaseWrites':0,'processReloads':0,'adminHtmlWrites':0,'controllerSha256':mod.H((W/'static-release.py').read_bytes()),'protectedFiles':self.files,'beforeProcesses':self.ps,'beforeHtmlSha256':mod.H(self.before),'afterHtmlSha256':mod.H(self.after),'assets':self.assets,'apiHistory':self.apiHistory,'newFlag':self.newFlag,'packageFiles':{}}
  self.stack=ExitStack()
  for name,val in [('PUBLIC',self.public),('STAGE',self.stage),('RECEIPT',self.receipt),('COORD',self.coord),('FLAG',str(self.flag)),('OLD_FLAG',str(self.oldflag)),('ASSETS',self.assetPins),('API_PINS',self.apiPins),('BEFORE_HTML',mod.H(self.before)),('AFTER_HTML',mod.H(self.after)),('INITIAL_SHA',mod.H(ib))]:self.stack.enter_context(patch.object(mod,name,val))
  locks=[]
  for i in range(2):p=self.root/('lock-'+str(i));p.write_bytes(b'');locks.append(str(p))
  self.stack.enter_context(patch.object(mod,'LOCKS',locks));self.stack.enter_context(patch.object(mod,'processes',lambda:self.ps));self.stack.enter_context(patch.object(mod.subprocess,'check_output',self.served))
 def served(self,args,**kwargs):
  url=args[-1]
  if url=='https://51dianzi.com/':return(self.public/'index.html').read_bytes()
  return(self.public/url.split('https://51dianzi.com/',1)[1]).read_bytes()
 def tearDown(self):self.stack.close();self.temp.cleanup()
 def run_release(self,apply=False):
  sb=mod.encode(self.capture);(self.pack/'evidence/protection.json').write_bytes(sb);self.manifest['protectionSha256']=mod.H(sb);mb=mod.encode(self.manifest);(self.pack/'manifest.json').write_bytes(mb);rb=mod.encode({'status':'passed','independent':True,'manifestSha256':mod.H(mb),'controllerSha256':self.manifest['controllerSha256'],'protectionSha256':mod.H(sb)});(self.pack/'review.json').write_bytes(rb)
  args=['release.py','--package',str(self.pack),'--manifest-sha256',mod.H(mb),'--review-sha256',mod.H(rb)]+(['--apply']if apply else[])
  with patch.object(sys,'argv',args),redirect_stdout(StringIO()):mod.main()
 def receipt_status(self):return json.loads((self.receipt/'receipt.json').read_bytes())['status']
 def test_preflight_zero_active_write(self):
  old=self.coord.read_bytes();self.run_release();self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertFalse(self.receipt.exists());self.assertEqual(self.coord.read_bytes(),old);self.assertFalse(any((self.public/r['relative']).exists()for r in self.assets))
 def test_html_drift_rejected(self):
  (self.public/'index.html').write_bytes(b'foreign')
  with self.assertRaisesRegex(RuntimeError,'LATEST_FRONT_HTML_DRIFT'):self.run_release(True)
  self.assertEqual((self.public/'index.html').read_bytes(),b'foreign');self.assertFalse(self.receipt.exists())
 def test_protected_file_drift_rejected(self):
  pathlib.Path(self.files[0]['path']).write_bytes(b'changed')
  with self.assertRaisesRegex(RuntimeError,'PROTECTED_FILE_DRIFT'):self.run_release(True)
  self.assertFalse(self.receipt.exists())
 def test_process_drift_rejected(self):
  with patch.object(mod,'processes',lambda:[{**p,'pid':999}for p in self.ps]):
   with self.assertRaisesRegex(RuntimeError,'EXACT_PROCESS_AND_ENV_DRIFT'):self.run_release(True)
  self.assertFalse(self.receipt.exists())
 def test_scope_asset_path_rejected(self):
  self.manifest['assets'][0]['relative']='assets/../../index.js'
  with self.assertRaisesRegex(RuntimeError,'EXACT_FOUR'):self.run_release(True)
  self.assertFalse(self.receipt.exists())
 def test_diagnostic_write_failure_cannot_block_owned_rollback(self):
  original=pathlib.Path.write_text
  def failure(path,*args,**kwargs):
   if path.name=='error.txt':raise OSError('diagnostic write unavailable')
   return original(path,*args,**kwargs)
  with patch.object(mod.subprocess,'check_output',lambda *a,**k:b'wrong HTTPS bytes'),patch.object(pathlib.Path,'write_text',failure):
   with self.assertRaisesRegex(RuntimeError,'HTTPS_SERVED_HTML_PIN'):self.run_release(True)
  self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertEqual(self.receipt_status(),'rolled-back');self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active'])
 def test_success_static_only(self):
  originals={r['path']:pathlib.Path(r['path']).read_bytes()for r in self.files};self.run_release(True);self.assertEqual(self.receipt_status(),'verified');self.assertEqual((self.public/'index.html').read_bytes(),self.after);self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active']);self.assertEqual(len([r for r in self.assets if(self.public/r['relative']).exists()]),4);self.assertTrue(all(pathlib.Path(p).read_bytes()==b for p,b in originals.items()));mod.history(json.loads(self.coord.read_bytes()),self.manifest)
 def test_https_failure_rolls_back_own_html(self):
  with patch.object(mod.subprocess,'check_output',lambda *a,**k:b'wrong HTTPS bytes'):
   with self.assertRaisesRegex(RuntimeError,'HTTPS_SERVED_HTML_PIN'):self.run_release(True)
  self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertEqual(self.receipt_status(),'rolled-back')
 def test_replace_committed_then_error_rolls_back(self):
  original=mod.atomic;fired=False
  def partial(p,b,a):
   nonlocal fired
   original(p,b,a)
   if p==self.public/'index.html'and not fired:fired=True;raise OSError('after replace before fsync')
  with patch.object(mod,'atomic',partial):
   with self.assertRaises(OSError):self.run_release(True)
  self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertEqual(self.receipt_status(),'rolled-back')
 def test_foreign_html_never_rolled_back(self):
  def foreign(*a,**k):(self.public/'index.html').write_bytes(b'foreign');return b'bad HTTPS'
  with patch.object(mod.subprocess,'check_output',foreign):
   with self.assertRaises(RuntimeError):self.run_release(True)
  self.assertEqual((self.public/'index.html').read_bytes(),b'foreign');self.assertEqual(self.receipt_status(),'recovery-required');self.assertTrue(json.loads(self.coord.read_bytes())['shared_release_active'])
 def test_coordination_partial_commit_restored(self):
  original=mod.atomic;fired=False
  def partial(p,b,a):
   nonlocal fired
   original(p,b,a)
   if p==self.coord and not fired:fired=True;raise OSError('coordinate directory fsync after commit')
  with patch.object(mod,'atomic',partial):
   with self.assertRaises(OSError):self.run_release(True)
  self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active']);self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertFalse(any((self.public/r['relative']).exists()for r in self.assets))
 def test_postreplace_error_logfailure_prevents_foreign_rollback(self):
  original=mod.atomic;write=pathlib.Path.write_text;foreign=mod.encode({'shared_release_active':True,'window':{'owner_task':'foreign'}})
  def partial(p,b,a):
   original(p,b,a)
   if p==self.public/'index.html':self.coord.write_bytes(foreign);raise OSError('postreplace foreign coordination')
  def fail(p,*a,**k):
   if p.name in('error.txt','recovery-error.txt'):raise OSError('no diagnostic storage')
   return write(p,*a,**k)
  with patch.object(mod,'atomic',partial),patch.object(pathlib.Path,'write_text',fail):
   with self.assertRaises(OSError):self.run_release(True)
  self.assertEqual(self.coord.read_bytes(),foreign);self.assertEqual((self.public/'index.html').read_bytes(),self.after);self.assertEqual(self.receipt_status(),'recovery-required')
 def test_stale_capture_refused(self):
  self.capture['capturedAtUtc']='2020-01-01T00:00:00+00:00'
  with self.assertRaisesRegex(RuntimeError,'FRESH_AFTER_API'):self.run_release(True)
 def test_old_guard_history_cannot_disappear(self):
  self.capture['coordinator']['window_history']=[self.apiHistory]
  with self.assertRaisesRegex(RuntimeError,'OLD_PAID_GUARD'):self.run_release(True)
 def test_initial_277_cannot_be_dropped(self):
  self.capture['protectedFiles']=self.files[1:];self.manifest['protectedFiles']=self.files[1:]
  with self.assertRaisesRegex(RuntimeError,'ALL_277'):self.run_release(True)
 def test_api_before_hash_cannot_pass(self):
  self.files[277]['sha256']=mod.H(b'old api')
  with self.assertRaisesRegex(RuntimeError,'EXACT_VERIFIED_API'):self.run_release(True)
 def test_disabled_flag_cannot_pass(self):
  self.newFlag['enabled']=False
  with self.assertRaisesRegex(RuntimeError,'VERIFIED_CART_FLAG'):self.run_release(True)
 def test_normalized_env_four_exclusions_only(self):
  e={'env':{'businessLower':'x','unique_id':'one','NODE_UNIQUE_ID':'one','NODE_CHANNEL_FD':'one','NODE_CHANNEL_SERIALIZATION_MODE':'one'},'SECRET_CONFIG':'x','unique_id':'a'};h=mod.config_hash(e)
  for k in mod.VOLATILE:e['env'][k]='two'
  self.assertEqual(h,mod.config_hash(e));e['env']['businessLower']='changed';self.assertNotEqual(h,mod.config_hash(e))
if __name__=='__main__':unittest.main(verbosity=2)
