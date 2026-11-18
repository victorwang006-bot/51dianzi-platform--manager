#!/usr/bin/env python3
import base64, copy, importlib.util, io, json, pathlib, tempfile, unittest, unittest.mock, contextlib
s=importlib.util.spec_from_file_location('release',pathlib.Path(__file__).with_name('release.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Safety(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.pack=self.root/'pack';self.public=self.root/'public';self.pack.mkdir();(self.public/'assets').mkdir(parents=True);(self.pack/'assets').mkdir();self.api=self.root/'front.js';self.api.write_bytes(b'a'*17);self.old_html=b'<html>old</html>\n';self.new_html=b'<html>new</html>\n';(self.public/'index.html').write_bytes(self.old_html);(self.pack/'baseline-index.html').write_bytes(self.old_html);(self.pack/'index.html').write_bytes(self.new_html)
        self.records=[{'byteStart':i,'byteEnd':i+1,'newByteStart':i,'newByteEnd':i+1,'oldBase64':base64.b64encode(b'a').decode(),'newBase64':base64.b64encode(b'b').decode(),'oldSha256':m.sha(b'a'),'newSha256':m.sha(b'b')}for i in range(17)];(self.pack/'api-delta.json').write_bytes(m.enc({'records':self.records}));self.coord=self.root/'coord.json';self.coord.write_bytes(m.enc({'shared_release_active':False,'foreignStats':'keep'}));self.admin=self.root/'admin.js';self.admin.write_bytes(b'foreign-stats-protected')
        self.assets=[]
        for i in range(2):
            r='assets/BusinessWorkbenchPage-inventory-source-read-test'+str(i)+'.js';data=('fake'+str(i)).encode();(self.pack/r).write_bytes(data);self.assets.append({'relative':r,'sha256':m.sha(data)})
        self.man={'ownerTask':m.OWNER,'scope':'inventory-source-read-only','databaseWrites':0,'adminApiWrites':0,'targetProcessName':'dianzi51','assets':self.assets,'apiNativeHunks':17,'uiNativeHunksPerAsset':4,'beforeHtmlSha256':m.sha(self.old_html),'afterHtmlSha256':m.sha(self.new_html),'beforeApiSha256':m.sha(b'a'*17),'afterApiSha256':m.sha(b'b'*17),'protectedFiles':[{'path':str(self.admin),'sha256':m.sha(self.admin.read_bytes())}]};self.mb=m.enc(self.man);(self.pack/'release-manifest.json').write_bytes(self.mb)
        self.man['requiredProtectedFiles']=copy.deepcopy(self.man['protectedFiles']);self.man['minimumProtectedFileCount']=1;self.mb=m.enc(self.man);(self.pack/'release-manifest.json').write_bytes(self.mb)
        self.current=[{'id':i,'name':'dianzi51' if i<4 else 'other-worker','pid':100+i,'status':'online','script':str(self.api) if i<4 else 'worker.js','cwd':'fake-cwd','mode':'cluster_mode' if i<4 else 'fork_mode'}for i in range(6)];self.locks=[]
        for i in range(2):
            p=self.root/('lock'+str(i));p.write_bytes(b'');self.locks.append(str(p))
        self.man['beforeProcesses']=copy.deepcopy(self.current);self.mb=m.enc(self.man);(self.pack/'release-manifest.json').write_bytes(self.mb)
        self.patches=[unittest.mock.patch.object(m,'PUBLIC',self.public),unittest.mock.patch.object(m,'FRONT',self.api),unittest.mock.patch.object(m,'COORD',self.coord),unittest.mock.patch.object(m,'ROOT',self.root/'receipt'),unittest.mock.patch.object(m,'LOCKS',self.locks),unittest.mock.patch.object(m,'health',return_value=None),unittest.mock.patch.object(m,'processes',side_effect=lambda:copy.deepcopy(self.current)),unittest.mock.patch.object(m.subprocess,'run',return_value=None)]
        for p in self.patches:p.start()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()
    def fake_roll(self,before):
        for p in self.current:
            if p['name']=='dianzi51':p['pid']+=1
        return copy.deepcopy(self.current)
    def run_release(self,apply=False):
        argv=['release.py','--package',str(self.pack),'--manifest-sha256',m.sha(self.mb)]+(['--apply']if apply else [])
        with unittest.mock.patch('sys.argv',argv),unittest.mock.patch.object(m,'roll',side_effect=self.fake_roll),contextlib.redirect_stdout(io.StringIO()) as output:m.main();return output.getvalue()
    def test_preflight_no_active_writes(self):
        c=self.coord.read_bytes();self.assertIn('PREFLIGHT_PASS',self.run_release());self.assertEqual(self.api.read_bytes(),b'a'*17);self.assertEqual(self.coord.read_bytes(),c)
    def test_apply_preserves_stats_and_non_target(self):
        workers=copy.deepcopy(self.current[4:]);self.assertIn('verified',self.run_release(True));self.assertEqual(self.api.read_bytes(),b'b'*17);self.assertEqual((self.public/'index.html').read_bytes(),self.new_html);self.assertEqual(workers,self.current[4:]);self.assertEqual(json.loads(self.coord.read_bytes())['foreignStats'],'keep')
    def test_api_drift_refused(self):
        self.api.write_bytes(b'foreign-new-api')
        with self.assertRaisesRegex(RuntimeError,'CURRENT_API_DRIFT'):self.run_release(True)
        self.assertEqual(self.api.read_bytes(),b'foreign-new-api');self.assertFalse((self.root/'receipt').exists())
    def test_html_drift_refused(self):
        (self.public/'index.html').write_bytes(b'foreign-profile-maps')
        with self.assertRaisesRegex(RuntimeError,'CURRENT_HTML_DRIFT'):self.run_release(True)
        self.assertEqual((self.public/'index.html').read_bytes(),b'foreign-profile-maps')
    def test_protected_stats_drift_refused(self):
        self.admin.write_bytes(b'foreign-admin')
        with self.assertRaisesRegex(RuntimeError,'PROTECTED_FILE_DRIFT'):self.run_release(True)
        self.assertEqual(self.admin.read_bytes(),b'foreign-admin')
    def test_failure_restores_only_owned_api(self):
        calls=0
        def roll(before):
            nonlocal calls;calls+=1
            if calls==1:raise RuntimeError('SYNTHETIC_ROLL_FAILURE')
            return self.fake_roll(before)
        argv=['release.py','--package',str(self.pack),'--manifest-sha256',m.sha(self.mb),'--apply']
        with unittest.mock.patch('sys.argv',argv),unittest.mock.patch.object(m,'roll',side_effect=roll),contextlib.redirect_stdout(io.StringIO()),self.assertRaisesRegex(RuntimeError,'SYNTHETIC_ROLL_FAILURE'):m.main()
        self.assertEqual(self.api.read_bytes(),b'a'*17);self.assertEqual((self.public/'index.html').read_bytes(),self.old_html);self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active'])
    def test_shared_window_busy_refused(self):
        self.coord.write_bytes(m.enc({'shared_release_active':True}))
        with self.assertRaisesRegex(RuntimeError,'SHARED_RELEASE_BUSY'):self.run_release(True)
    def test_delta_preimage_tamper_refused(self):
        bad=copy.deepcopy(self.records);bad[0]['oldSha256']='0'*64
        with self.assertRaisesRegex(RuntimeError,'DELTA_PREIMAGE_HASH'):m.reconstruct(b'a'*17,bad)
    def test_failed_recovery_retains_blocking_window(self):
        argv=['release.py','--package',str(self.pack),'--manifest-sha256',m.sha(self.mb),'--apply']
        with unittest.mock.patch('sys.argv',argv),unittest.mock.patch.object(m,'roll',side_effect=RuntimeError('ROLL_AND_RECOVERY_FAILED')),contextlib.redirect_stdout(io.StringIO()),self.assertRaisesRegex(RuntimeError,'ROLL_AND_RECOVERY_FAILED'):m.main()
        coord=json.loads(self.coord.read_bytes());self.assertTrue(coord['shared_release_active']);self.assertEqual(coord['window']['status'],'recovery-required')
    def test_foreign_api_is_not_overwritten_or_claimed_restored(self):
        def foreign_roll(before):self.api.write_bytes(b'FOREIGN_API');raise RuntimeError('FOREIGN_MUTATION')
        argv=['release.py','--package',str(self.pack),'--manifest-sha256',m.sha(self.mb),'--apply']
        with unittest.mock.patch('sys.argv',argv),unittest.mock.patch.object(m,'roll',side_effect=foreign_roll),contextlib.redirect_stdout(io.StringIO()),self.assertRaisesRegex(RuntimeError,'FOREIGN_MUTATION'):m.main()
        coord=json.loads(self.coord.read_bytes());self.assertEqual(self.api.read_bytes(),b'FOREIGN_API');self.assertTrue(coord['shared_release_active']);self.assertEqual(coord['window']['status'],'recovery-required')
if __name__=='__main__':unittest.main(verbosity=2)
