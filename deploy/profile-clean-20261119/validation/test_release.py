import importlib.util,json,pathlib,sys,tempfile,unittest,datetime
from contextlib import ExitStack,redirect_stdout
from io import StringIO
from unittest.mock import patch
W=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('release',W/'release.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class ReleaseSafety(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='profile-clean-offline-',dir=W);self.root=pathlib.Path(self.temp.name);self.public=self.root/'public';self.public.mkdir();self.stage=self.root/'stage';self.stage.mkdir();self.pack=self.stage/'package';self.pack.mkdir();(self.pack/'evidence').mkdir();self.receipt=self.stage/'receipt';self.coord=self.root/'coord.json';self.flag=self.root/'flag.json';self.oldflag=self.root/'oldflag.json'
  self.before=b'<script>'+mod.PROFILE_OLD.encode()+b'</script>';self.after=b'';(self.public/'index.html').write_bytes(self.before)
  self.ps=[{'id':i,'pid':100+i,'status':'online','name':'anonymous-'+str(i),'script':'/fixed/script','cwd':'/fixed/cwd','envHash':mod.H(b'env')}for i in range(12)]
  self.apiHistory={'owner_task':mod.OWNER,'scope':'official-cart-api-20261119','manifestSha256':mod.H(b'api'),'nonce':'a'*32,'status':'verified','closedAtUtc':mod.now(),'needsOperatorRecovery':False}
  self.oldHistory={'owner_task':mod.OLD_OWNER,'manifestSha256':mod.OLD_MANIFEST,'status':'verified','closedAtUtc':mod.now(),'needsOperatorRecovery':False,'nonce':mod.OLD_NONCE}
  self.coord.write_bytes(mod.encode({'shared_release_active':False,'window_history':[self.oldHistory,self.apiHistory]}))
  self.newFlag={'ownerTask':mod.OWNER,'enabled':True,'manifestSha256':self.apiHistory['manifestSha256'],'nonce':'a'*32,'runtimeSha256':mod.H(b'cart runtime')};self.flag.write_bytes(mod.encode(self.newFlag));self.oldflag.write_bytes(mod.encode({'enabled':True,'ownerTask':mod.OLD_OWNER,'manifestSha256':mod.OLD_MANIFEST,'nonce':mod.OLD_NONCE}))
  self.initial=[]
  for i in range(274):
   p=self.root/('protected-'+str(i));p.write_bytes(b'protected');self.initial.append({'path':str(p),'sha256':mod.H(p.read_bytes())})
  profile=self.public/mod.PROFILE_OLD;profile.parent.mkdir(parents=True);profile.write_bytes(b'old profile')
  self.initial.extend([{'path':str(self.public/'index.html'),'sha256':mod.H(self.before)},{'path':str(profile),'sha256':mod.H(b'old profile')}])
  self.initial.append({'path':str(self.oldflag),'sha256':mod.H(self.oldflag.read_bytes())});self.files=list(self.initial)
  self.apiPins={}
  for name,b in [('front.js',b'front after'),('refund.js',b'refund after'),('officialCart.test.runtime.mjs',b'cart runtime'),('officialCartStock.test.runtime.mjs',b'stock runtime')]:
   p=self.root/name;p.write_bytes(b);self.apiPins[str(p)]=mod.H(b);self.files.append({'path':str(p),'sha256':mod.H(b)})
  self.files.append({'path':str(self.flag),'sha256':mod.H(self.flag.read_bytes())})
  self.cartHTML=self.root/'cart-index.html';self.cartHTML.write_bytes(b'cart published');self.files.append({'path':str(self.cartHTML),'sha256':mod.H(b'cart published')})
  self.cartAssets={}
  for i in range(4):
   name='assets/cart-'+str(i)+'.js';q=self.root/('cart-'+str(i));q.write_bytes(str(i).encode());self.cartAssets[name]=mod.H(q.read_bytes());self.files.append({'path':'/opt/releases/20261031-homepage-banner-v39/front/dist/public/'+name,'sha256':mod.H(q.read_bytes())})
  self.assets=[];self.assetPins={}
  for ext,prefix in [('Profile-personal-clean',mod.PROFILE_DIR)]:
   b=('anonymous '+ext).encode();h=mod.H(b);name=prefix+ext+'-'+h+'.js';p=self.pack/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b);self.assets.append({'relative':name,'sha256':h});self.assetPins[name]=h;(self.public/name).parent.mkdir(parents=True,exist_ok=True)
  self.after=self.before.replace(mod.PROFILE_OLD.encode(),self.assets[0]['relative'].encode())
  (self.pack/'evidence/source-delta.json').write_bytes(b'{}')
  (self.pack/'baseline-index.html').write_bytes(self.before);(self.pack/'candidate-index.html').write_bytes(self.after)
  ib=mod.encode({'protectedFiles':self.initial});(self.pack/'evidence/protection-initial.json').write_bytes(ib)
  self.capture={'capturedAtUtc':mod.now(),'beforeProcesses':self.ps,'protectedFiles':self.files,'coordinator':json.loads(self.coord.read_bytes()),'coordinatorSha256':mod.H(self.coord.read_bytes()),'newFlag':self.newFlag,'newFlagSha256':mod.H(self.flag.read_bytes())}
  self.manifest={'ownerTask':mod.OWNER,'scope':mod.SCOPE,'apiWrites':0,'databaseWrites':0,'processReloads':0,'adminHtmlWrites':1,'frontHtmlWrites':0,'flagWrites':0,'cssWrites':0,'controllerSha256':mod.H((W/'release.py').read_bytes()),'protectedFiles':[r for r in self.files if r['path']!=str(self.public/'index.html')],'beforeProcesses':self.ps,'beforeHtmlSha256':mod.H(self.before),'afterHtmlSha256':mod.H(self.after),'assets':self.assets,'apiHistory':self.apiHistory,'newFlag':self.newFlag,'coordinator':self.capture['coordinator'],'sourceDeltaSha256':mod.H(b'{}'),'packageFiles':{}}
  self.stack=ExitStack()
  for name,val in [('PUBLIC',self.public),('STAGE',self.stage),('RECEIPT',self.receipt),('COORD',self.coord),('FLAG',str(self.flag)),('OLD_FLAG',str(self.oldflag)),('CART_ASSETS',self.cartAssets),('CART_HTML',str(self.cartHTML)),('CART_HTML_SHA',mod.H(b'cart published')),('PROFILE_BEFORE',mod.H(b'old profile')),('API_PINS',self.apiPins),('BEFORE_HTML',mod.H(self.before)),('INITIAL_SHA',mod.H(ib))]:self.stack.enter_context(patch.object(mod,name,val))
  locks=[]
  for i in range(2):p=self.root/('lock-'+str(i));p.write_bytes(b'');locks.append(str(p))
  original_protect=mod.protect
  def protect(m):
   translated={**m,'protectedFiles':[{**r,'path':str(self.root/('cart-'+r['path'].rsplit('-',1)[1].split('.')[0]))} if r['path'].startswith('/opt/releases/20261031-homepage-banner-v39/front/dist/public/assets/cart-') else r for r in m['protectedFiles']]}
   return original_protect(translated)
  self.stack.enter_context(patch.object(mod,'protect',protect))
  self.stack.enter_context(patch.object(mod,'LOCKS',locks));self.stack.enter_context(patch.object(mod,'processes',lambda:self.ps));self.stack.enter_context(patch.object(mod.subprocess,'check_output',self.served))
 def served(self,args,**kwargs):
  url=args[-1]
  if url=='https://admin.51dianzi.com/':return(self.public/'index.html').read_bytes()+b'\n200'
  return(self.public/url.split('https://admin.51dianzi.com/',1)[1]).read_bytes()+b'\n200'
 def tearDown(self):self.stack.close();self.temp.cleanup()
 def run_release(self,apply=False):
  self.manifest['packageFiles']={name:mod.H((self.pack/name).read_bytes()) if (self.pack/name).is_file() else mod.H(b'invalid') for name in ['baseline-index.html','candidate-index.html','evidence/protection-initial.json','evidence/source-delta.json',self.assets[0]['relative']]}
  sb=mod.encode(self.capture);(self.pack/'evidence/protection.json').write_bytes(sb);self.manifest['protectionSha256']=mod.H(sb);self.manifest['packageFiles']['evidence/protection.json']=mod.H(sb);mb=mod.encode(self.manifest);(self.pack/'manifest.json').write_bytes(mb);rb=mod.encode({'status':'passed','independent':True,'manifestSha256':mod.H(mb),'controllerSha256':self.manifest['controllerSha256'],'protectionSha256':mod.H(sb)});(self.pack/'review.json').write_bytes(rb)
  args=['release.py','--package',str(self.pack),'--manifest-sha256',mod.H(mb),'--review-sha256',mod.H(rb)]+(['--apply']if apply else['--preflight'])
  with patch.object(sys,'argv',args),redirect_stdout(StringIO()):mod.main()
 def receipt_status(self):return json.loads((self.receipt/'receipt.json').read_bytes())['status']
 def test_optional_flag_scope_rejects_foreign_when_present(self):
  self.newFlag['scope']='foreign'
  with self.assertRaisesRegex(RuntimeError,'VERIFIED_CART_FLAG_ENABLED_REQUIRED'):mod.validate_protection(self.capture)
 def test_preflight_zero_active_write(self):
  old=self.coord.read_bytes();self.run_release();self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertFalse(self.receipt.exists());self.assertEqual(self.coord.read_bytes(),old);self.assertFalse(any((self.public/r['relative']).exists()for r in self.assets))
 def test_html_drift_rejected(self):
  (self.public/'index.html').write_bytes(b'foreign')
  with self.assertRaisesRegex(RuntimeError,'LATEST_ADMIN_HTML_DRIFT'):self.run_release(True)
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
  with self.assertRaisesRegex(RuntimeError,'EXACT_ONE'):self.run_release(True)
  self.assertFalse(self.receipt.exists())
 def test_diagnostic_write_failure_cannot_block_owned_rollback(self):
  original=pathlib.Path.write_text
  def failure(path,*args,**kwargs):
   if path.name=='error.txt':raise OSError('diagnostic write unavailable')
   return original(path,*args,**kwargs)
  with patch.object(mod.subprocess,'check_output',lambda *a,**k:b'wrong HTTPS bytes\n200'),patch.object(pathlib.Path,'write_text',failure):
   with self.assertRaisesRegex(RuntimeError,'HTTPS_SERVED_HTML_PIN'):self.run_release(True)
  self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertEqual(self.receipt_status(),'rolled-back');self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active'])
 def test_success_static_only(self):
  originals={r['path']:pathlib.Path(r['path']).read_bytes()for r in self.files if pathlib.Path(r['path']).exists() and r['path']!=str(self.public/'index.html')};self.run_release(True);self.assertEqual(self.receipt_status(),'verified');self.assertEqual((self.public/'index.html').read_bytes(),self.after);self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active']);self.assertEqual(len([r for r in self.assets if(self.public/r['relative']).exists()]),1);self.assertTrue(all(pathlib.Path(p).read_bytes()==b for p,b in originals.items()));mod.history(json.loads(self.coord.read_bytes()),self.manifest)
 def test_https_failure_rolls_back_own_html(self):
  with patch.object(mod.subprocess,'check_output',lambda *a,**k:b'wrong HTTPS bytes\n200'):
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
  def foreign(*a,**k):(self.public/'index.html').write_bytes(b'foreign');return b'bad HTTPS\n200'
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
  with self.assertRaisesRegex(RuntimeError,'FRESH_AFTER_CART_STATIC'):self.run_release(True)
 def test_old_guard_history_cannot_disappear(self):
  self.capture['coordinator']['window_history']=[self.apiHistory]
  with self.assertRaisesRegex(RuntimeError,'OLD_PAID_GUARD'):self.run_release(True)
 def test_initial_277_cannot_be_dropped(self):
  self.capture['protectedFiles']=self.files[1:];self.manifest['protectedFiles']=[r for r in self.files[1:] if r['path']!=str(self.public/'index.html')]
  with self.assertRaisesRegex(RuntimeError,'ALL_277|ALL_BASELINE'):self.run_release(True)
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
 def test_two_assets_rejected(self):
  self.manifest['assets'].append(dict(self.assets[0]))
  with self.assertRaisesRegex(RuntimeError,'EXACT_ONE'):self.run_release(True)
 def test_css_path_rejected(self):
  self.manifest['assets'][0]['relative']=mod.PROFILE_DIR+'Profile-personal-clean-'+self.assets[0]['sha256']+'.css'
  with self.assertRaisesRegex(RuntimeError,'EXACT_ONE'):self.run_release(True)
 def test_wrong_filename_hash_rejected(self):
  self.manifest['assets'][0]['relative']=mod.PROFILE_DIR+'Profile-personal-clean-'+'0'*64+'.js'
  with self.assertRaisesRegex(RuntimeError,'EXACT_ONE'):self.run_release(True)
 def test_other_html_delta_rejected(self):
  self.after+=b'<style>bad</style>';(self.pack/'candidate-index.html').write_bytes(self.after);self.manifest['afterHtmlSha256']=mod.H(self.after)
  with self.assertRaisesRegex(RuntimeError,'ONLY_PROFILE_REFERENCE'):self.run_release(True)
 def test_cart_not_published_rejected(self):
  next(r for r in self.files if r['path']==str(self.cartHTML))['sha256']=mod.H(b'cart before')
  with self.assertRaisesRegex(RuntimeError,'CART_STATIC_ACTUALLY'):self.run_release(True)
 def test_refund_before_hash_rejected(self):
  self.files[278]['sha256']=mod.H(b'old refund')
  with self.assertRaisesRegex(RuntimeError,'EXACT_VERIFIED_API'):self.run_release(True)
 def test_old_flag_disabled_rejected(self):
  old=json.loads(self.oldflag.read_bytes());old['enabled']=False;self.oldflag.write_bytes(mod.encode(old));next(r for r in self.files if r['path']==str(self.oldflag))['sha256']=mod.H(self.oldflag.read_bytes())
  # Frozen initial pin still contains the prior enabled flag; either protection layer must refuse.
  with self.assertRaises(RuntimeError):self.run_release(True)
 def test_old_history_nonce_rejected(self):
  self.oldHistory['nonce']='f'*32
  self.capture['coordinator']['window_history'][0]['nonce']='f'*32
  with self.assertRaisesRegex(RuntimeError,'OLD_PAID_GUARD'):self.run_release(True)
 def test_cart_flag_nonce_rejected(self):
  self.newFlag['nonce']='f'*32
  with self.assertRaisesRegex(RuntimeError,'API_FLAG_EXACT_HISTORY'):self.run_release(True)
 def test_foreign_coord_after_open_exception_not_restored(self):
  original=mod.atomic;foreign=mod.encode({'shared_release_active':True,'window':{'owner_task':'foreign'}})
  def partial(p,b,a):
   original(p,b,a)
   if p==self.coord:self.coord.write_bytes(foreign);raise OSError('foreign after open replace')
  with patch.object(mod,'atomic',partial):
   with self.assertRaises(OSError):self.run_release(True)
  self.assertEqual(self.coord.read_bytes(),foreign);self.assertEqual((self.public/'index.html').read_bytes(),self.before)
 def test_missing_lock_is_not_created(self):
  p=pathlib.Path(mod.LOCKS[0]);p.unlink()
  with self.assertRaises(FileNotFoundError):self.run_release(True)
  self.assertFalse(p.exists());self.assertFalse(self.receipt.exists())
 def test_exact_https_200_required(self):
  with patch.object(mod.subprocess,'check_output',lambda *a,**k:self.after+b'\n201'):
   with self.assertRaisesRegex(RuntimeError,'HTTPS_EXACT_GET_200'):self.run_release(True)
  self.assertEqual((self.public/'index.html').read_bytes(),self.before)
 def test_new_asset_corrupt_bytes_rejected(self):
  (self.pack/self.assets[0]['relative']).write_bytes(b'corrupt')
  with self.assertRaisesRegex(RuntimeError,'ASSET_PACKAGE_PIN'):self.run_release(True)
 def test_11_processes_rejected(self):
  self.capture['beforeProcesses']=self.ps[:-1]
  with self.assertRaisesRegex(RuntimeError,'ALL_TWELVE'):self.run_release(True)
 def test_write_scope_cannot_expand(self):
  for key in ('apiWrites','databaseWrites','processReloads','frontHtmlWrites','flagWrites','cssWrites'):
   self.manifest[key]=1
   with self.assertRaisesRegex(RuntimeError,'NO_BACKEND'):self.run_release(True)
   self.manifest[key]=0
 def test_review_is_required_before_active_writes(self):
  encode=mod.encode
  def bad_review(obj):
   if isinstance(obj,dict) and obj.get('independent') is True:return encode({**obj,'independent':False})
   return encode(obj)
  with patch.object(mod,'encode',bad_review):
   with self.assertRaisesRegex(RuntimeError,'CURRENT_INDEPENDENT_REVIEW'):self.run_release(True)
  self.assertFalse(self.receipt.exists());self.assertEqual((self.public/'index.html').read_bytes(),self.before)
 def test_actual_html_directory_fsync_error_restores_only_own(self):
  fsync=mod.os.fsync;fired=False;inode=self.public.stat().st_ino
  def fail(fd):
   nonlocal fired
   if mod.os.fstat(fd).st_ino==inode and not fired:fired=True;raise OSError('actual HTML directory fsync failure')
   return fsync(fd)
  with patch.object(mod.os,'fsync',fail):
   with self.assertRaises(OSError):self.run_release(True)
  self.assertTrue(fired);self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertEqual(self.receipt_status(),'rolled-back')
 def test_actual_coord_directory_fsync_error_restores_only_own(self):
  fsync=mod.os.fsync;fired=False;inode=self.coord.parent.stat().st_ino;before=self.coord.read_bytes()
  def fail(fd):
   nonlocal fired
   if mod.os.fstat(fd).st_ino==inode and not fired:fired=True;raise OSError('actual coordinator directory fsync failure')
   return fsync(fd)
  with patch.object(mod.os,'fsync',fail):
   with self.assertRaises(OSError):self.run_release(True)
  self.assertTrue(fired);self.assertEqual(self.coord.read_bytes(),before);self.assertEqual((self.public/'index.html').read_bytes(),self.before)
 def test_actual_legacy_old_flag_has_no_nonce(self):
  old=json.loads(self.oldflag.read_bytes());del old['nonce'];self.oldflag.write_bytes(mod.encode(old));next(r for r in self.files if r['path']==str(self.oldflag))['sha256']=mod.H(self.oldflag.read_bytes())
  ib=mod.encode({'protectedFiles':self.initial});(self.pack/'evidence/protection-initial.json').write_bytes(ib)
  with patch.object(mod,'INITIAL_SHA',mod.H(ib)):self.run_release(True)
  self.assertEqual(self.receipt_status(),'verified')
 def test_current_cart_static_verified_window_accepted(self):
  w={'owner_task':mod.OWNER,'scope':'cart-compact-static-20261119','manifestSha256':mod.H(b'cart static'),'nonce':'c'*32,'status':'verified','needsOperatorRecovery':False,'closedAtUtc':mod.now()}
  c=self.capture['coordinator'];c['window_history'].append(w);c['window']=w;self.coord.write_bytes(mod.encode(c));self.capture['coordinatorSha256']=mod.H(self.coord.read_bytes());self.run_release()
if __name__=='__main__':unittest.main(verbosity=2)
