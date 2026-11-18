#!/usr/bin/env python3
import contextlib,copy,importlib.util,io,json,pathlib,stat,tempfile,unittest,unittest.mock
s=importlib.util.spec_from_file_location('merchant_release',pathlib.Path(__file__).with_name('release.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class SafeStatic(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();r=pathlib.Path(self.temp.name);self.public=r/'public';self.public.mkdir();(self.public/'assets').mkdir();self.pack=r/'pack';self.pack.mkdir();(self.pack/'assets').mkdir();self.coord=r/'coord.json';self.coord.write_bytes(m.encode({'shared_release_active':False,'otherTask':'preserve'}));self.root=r/'private';self.before=b'<html>old merchant and preserved catalog</html>';self.after=b'<html>restored merchant and preserved catalog</html>';self.html=self.public/'index.html';self.html.write_bytes(self.before);self.html.chmod(0o644);(self.pack/'baseline-index.html').write_bytes(self.before);(self.pack/'candidate-index.html').write_bytes(self.after);self.locks=[]
  for i in range(2):p=r/('lock'+str(i));p.touch();self.locks.append(str(p))
  self.protected=[]
  for i in range(200):p=r/('protected'+str(i));p.write_bytes(b'preserve-api-profile-worker-runtime');self.protected.append({'path':str(p),'sha256':m.H(p.read_bytes())})
  self.ps=[{'id':i,'name':'fixed-'+str(i),'pid':i+1000,'status':'online','script':'fixed','cwd':'fixed','mode':'fork_mode','envSha256':'fixed'}for i in [0,190,191,192,193,194,200,201,202,203,204,205]];self.assets=[]
  for n,b in [('SearchPage-merchant-restore-fake.js',b'export{}'),('SearchPage-merchant-restore-fake.css',b'.merchant-only{}')]:
   (self.pack/'assets'/n).write_bytes(b);self.assets.append({'relative':'assets/'+n,'sha256':m.H(b)})
  self.man={'ownerTask':m.OWNER,'scope':'merchant-search-selective-restoration','apiWrites':0,'databaseWrites':0,'processReloads':0,'adminHtmlWrites':0,'controllerSha256':m.H(pathlib.Path(m.__file__).read_bytes()),'protectedFiles':self.protected,'beforeProcesses':self.ps,'beforeHtmlSha256':m.H(self.before),'afterHtmlSha256':m.H(self.after),'catalogEntryUnchanged':True,'merchantOnlyRenderAndScopedStyle':True,'htmlInverseUnchangedOtherBytes':True,'assets':self.assets};self.mb=m.encode(self.man);(self.pack/'manifest.json').write_bytes(self.mb)
  self.patches=[unittest.mock.patch.object(m,'PUBLIC',self.public),unittest.mock.patch.object(m,'COORD',self.coord),unittest.mock.patch.object(m,'ROOT',self.root),unittest.mock.patch.object(m,'LOCKS',self.locks),unittest.mock.patch.object(m,'processes',side_effect=lambda:copy.deepcopy(self.ps))]
  for p in self.patches:p.start()
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.temp.cleanup()
 def invoke(self,apply=False):
  with unittest.mock.patch('sys.argv',['release.py','--package',str(self.pack),'--manifest-sha256',m.H(self.mb)]+(['--apply']if apply else[])),contextlib.redirect_stdout(io.StringIO())as o:m.main();return o.getvalue()
 def test_preflight_no_active_write(self):
  self.assertIn('PREFLIGHT_PASS',self.invoke());self.assertEqual(self.html.read_bytes(),self.before);self.assertFalse(self.root.exists())
 def test_success_preserves_original_html_mode_and_other_files(self):
  self.assertIn('verified',self.invoke(True));self.assertEqual(self.html.read_bytes(),self.after);self.assertEqual(stat.S_IMODE(self.html.stat().st_mode),0o644)
  for a in self.assets:self.assertEqual(stat.S_IMODE((self.public/a['relative']).stat().st_mode),0o644)
  self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active']);self.assertEqual(json.loads(self.coord.read_bytes())['otherTask'],'preserve')
 def test_html_drift_refuses_without_write(self):
  self.html.write_bytes(b'other task')
  with self.assertRaisesRegex(RuntimeError,'LATEST_FRONT_HTML_DRIFT'):self.invoke(True)
 def test_protected_worker_or_api_drift_refused(self):
  pathlib.Path(self.protected[0]['path']).write_bytes(b'other new worker')
  with self.assertRaisesRegex(RuntimeError,'PROTECTED_FILE_DRIFT'):self.invoke(True)
 def test_busy_window_refused(self):
  self.coord.write_bytes(m.encode({'shared_release_active':True}))
  with self.assertRaisesRegex(RuntimeError,'SHARED_WINDOW_BUSY'):self.invoke(True)
 def test_process_env_drift_refused(self):
  expected=self.mb;self.ps[0]['envSha256']='other-environment'
  with self.assertRaisesRegex(RuntimeError,'EXACT_PROCESS_AND_ENV_DRIFT'):self.invoke(True)
 def test_failed_postcheck_restores_only_owned_html(self):
  calls=0;original=m.protect
  def fault(man):
   nonlocal calls;calls+=1
   if calls==3:raise RuntimeError('INJECTED_POSTCHECK_FAIL')
   return original(man)
  with unittest.mock.patch.object(m,'protect',side_effect=fault),self.assertRaisesRegex(RuntimeError,'INJECTED_POSTCHECK_FAIL'):self.invoke(True)
  self.assertEqual(self.html.read_bytes(),self.before);self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active'])
 def test_foreign_html_not_rolled_back_window_blocks(self):
  calls=0;original=m.protect
  def foreign(man):
   nonlocal calls;calls+=1
   if calls==3:self.html.write_bytes(b'foreign version');raise RuntimeError('INJECTED_FOREIGN')
   return original(man)
  with unittest.mock.patch.object(m,'protect',side_effect=foreign),self.assertRaisesRegex(RuntimeError,'INJECTED_FOREIGN'):self.invoke(True)
  self.assertEqual(self.html.read_bytes(),b'foreign version');self.assertTrue(json.loads(self.coord.read_bytes())['shared_release_active']);self.assertEqual(json.loads(self.coord.read_bytes())['window']['status'],'recovery-required')
if __name__=='__main__':unittest.main(verbosity=2)
