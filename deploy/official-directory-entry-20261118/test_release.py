import importlib.util,json,pathlib,sys,tempfile,unittest
from contextlib import ExitStack
from unittest.mock import patch
W=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('release',W/'release.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class ReleaseSafety(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.public=self.root/'public';self.public.mkdir();self.stage=self.root/'stage';self.stage.mkdir();self.pack=self.stage/'package';self.pack.mkdir();(self.pack/'assets').mkdir();self.receipt=self.stage/'receipt';self.coord=self.root/'coord.json';self.coord.write_bytes(mod.encode({'shared_release_active':False,'window_history':[]}));self.before=b'anonymous old HTML';self.after=b'anonymous new HTML';(self.public/'index.html').write_bytes(self.before);self.ps=[{'id':i,'pid':100+i,'status':'online','name':'anonymous-'+str(i),'envSha256':'anonymous','rawEnvSha256':'anonymous'}for i in range(12)]
  self.files=[]
  for i in range(200):
   p=self.root/('protected-'+str(i));p.write_bytes(b'protected');self.files.append({'path':str(p),'sha256':mod.H(p.read_bytes())})
  self.assets=[]
  for ext in ['js']:
   b=('anonymous '+ext).encode();h=mod.H(b);name='assets/SearchPage-official-directory-entry-'+h+'.js';(self.pack/'assets'/pathlib.Path(name).name).write_bytes(b);self.assets.append({'relative':name,'sha256':h})
   (self.public/name).parent.mkdir(parents=True,exist_ok=True)
  (self.pack/'baseline-index.html').write_bytes(self.before);(self.pack/'candidate-index.html').write_bytes(self.after)
  self.manifest={'ownerTask':mod.OWNER,'scope':'official-directory-entry-static','apiWrites':0,'databaseWrites':0,'processReloads':0,'adminHtmlWrites':0,'controllerSha256':mod.H((W/'release.py').read_bytes()),'protectedFiles':self.files,'beforeProcesses':self.ps,'beforeHtmlSha256':mod.H(self.before),'afterHtmlSha256':mod.H(self.after),'assets':self.assets,'allExistingMerchantAndCatalogBytesPreserved':True,'allOtherHtmlBytesPreserved':True,'actualScopedSearchEntryVerified':True}
  self.stack=ExitStack()
  for name,val in [('PUBLIC',self.public),('STAGE',self.stage),('RECEIPT',self.receipt),('COORD',self.coord)]:self.stack.enter_context(patch.object(mod,name,val))
  locks=[]
  for i in range(2):p=self.root/('lock-'+str(i));p.write_bytes(b'');locks.append(str(p))
  self.stack.enter_context(patch.object(mod,'LOCKS',locks));self.stack.enter_context(patch.object(mod,'processes',lambda:self.ps))
  def served(args,**kwargs):
   url=args[-1]
   if url=='https://51dianzi.com/':return(self.public/'index.html').read_bytes()
   return(self.public/url.split('https://51dianzi.com/',1)[1]).read_bytes()
  self.stack.enter_context(patch.object(mod.subprocess,'check_output',served))
 def tearDown(self):self.stack.close();self.temp.cleanup()
 def run_release(self,apply=False):
  mb=mod.encode(self.manifest);(self.pack/'manifest.json').write_bytes(mb);(self.pack/'review.json').write_bytes(mod.encode({'status':'passed','independent':True,'manifestSha256':mod.H(mb),'controllerSha256':self.manifest['controllerSha256']}));args=['release.py','--package',str(self.pack),'--manifest-sha256',mod.H(mb)]+(['--apply']if apply else[])
  with patch.object(sys,'argv',args):mod.main()
 def test_preflight_zero_active_write(self):
  self.run_release();self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertFalse(self.receipt.exists());self.assertFalse(json.loads(self.coord.read_text())['shared_release_active']);self.assertFalse(any((self.public/r['relative']).exists()for r in self.assets))
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
  with self.assertRaisesRegex(RuntimeError,'EXACT_CONTENT_ADDRESSED'):self.run_release(True)
  self.assertFalse(self.receipt.exists())
 def test_diagnostic_write_failure_cannot_block_owned_rollback(self):
  original=pathlib.Path.write_text
  def failure(path,*args,**kwargs):
   if path.name=='error.txt':raise OSError('diagnostic write unavailable')
   return original(path,*args,**kwargs)
  with patch.object(mod.subprocess,'check_output',lambda *a,**k:b'wrong HTTPS bytes'),patch.object(pathlib.Path,'write_text',failure):
   with self.assertRaisesRegex(RuntimeError,'HTTPS_SERVED_HTML_PIN'):self.run_release(True)
  self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertEqual(json.loads((self.receipt/'receipt.json').read_text())['status'],'rolled-back');self.assertFalse(json.loads(self.coord.read_text())['shared_release_active'])
 def test_success_static_only(self):
  self.run_release(True);r=json.loads((self.receipt/'receipt.json').read_text());self.assertEqual(r['status'],'verified');self.assertEqual((self.public/'index.html').read_bytes(),self.after);self.assertFalse(json.loads(self.coord.read_text())['shared_release_active']);self.assertEqual(r['apiWrites']+r['databaseWrites']+r['processReloads']+r['adminHtmlWrites'],0)
 def test_https_failure_rolls_back_own_html(self):
  with patch.object(mod.subprocess,'check_output',lambda *a,**k:b'wrong HTTPS bytes'):
   with self.assertRaisesRegex(RuntimeError,'HTTPS_SERVED_HTML_PIN'):self.run_release(True)
  self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertEqual(json.loads((self.receipt/'receipt.json').read_text())['status'],'rolled-back');self.assertFalse(json.loads(self.coord.read_text())['shared_release_active'])
 def test_replace_committed_then_error_rolls_back(self):
  original=mod.atomic;fired=False
  def partial(p,b,a):
   nonlocal fired
   original(p,b,a)
   if p==self.public/'index.html'and not fired:fired=True;raise OSError('after replace before fsync')
  with patch.object(mod,'atomic',partial):
   with self.assertRaises(OSError):self.run_release(True)
  self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertEqual(json.loads((self.receipt/'receipt.json').read_text())['status'],'rolled-back')
 def test_foreign_html_never_rolled_back(self):
  def foreign(*a,**k):(self.public/'index.html').write_bytes(b'foreign');return b'bad HTTPS'
  with patch.object(mod.subprocess,'check_output',foreign):
   with self.assertRaises(RuntimeError):self.run_release(True)
  self.assertEqual((self.public/'index.html').read_bytes(),b'foreign');self.assertEqual(json.loads((self.receipt/'receipt.json').read_text())['status'],'recovery-required');self.assertTrue(json.loads(self.coord.read_text())['shared_release_active'])
 def test_coordination_partial_commit_restored(self):
  original=mod.atomic;fired=False
  def partial(p,b,a):
   nonlocal fired
   original(p,b,a)
   if p==self.coord and not fired:fired=True;raise OSError('coordinate directory fsync after commit')
  with patch.object(mod,'atomic',partial):
   with self.assertRaises(OSError):self.run_release(True)
  self.assertFalse(json.loads(self.coord.read_text())['shared_release_active']);self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertFalse(any((self.public/r['relative']).exists()for r in self.assets))
if __name__=='__main__':unittest.main()
