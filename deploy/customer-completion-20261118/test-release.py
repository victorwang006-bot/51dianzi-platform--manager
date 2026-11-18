#!/usr/bin/env python3
"""Entirely local fake filesystem; never touches production or invokes PM2."""
import contextlib, hashlib, importlib.util, io, json, pathlib, tempfile, unittest, unittest.mock
SCRIPT=pathlib.Path(__file__).with_name('release.py')
spec=importlib.util.spec_from_file_location('release',SCRIPT);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class ReleaseSafety(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.dir=pathlib.Path(self.temp.name);self.public=self.dir/'public';self.public.mkdir();self.pack=self.dir/'package';(self.pack/'candidate/assets').mkdir(parents=True);(self.pack/'baseline').mkdir()
        self.coord=self.dir/'coord.json';self.coord.write_text(json.dumps({'shared_release_active':False,'otherTask':'preserved'}))
        self.before=b'<html>OLD_FAKE_MAP</html>\n';self.after=b'<html>NEW_FAKE_MAP</html>\n';(self.public/'index.html').write_bytes(self.before);(self.pack/'baseline/index.html').write_bytes(self.before);(self.pack/'candidate/index.html').write_bytes(self.after)
        (self.public/'assets').mkdir();new='assets/BusinessWorkbenchPage-customer-completion-test.js';old='assets/BusinessWorkbenchPage-old-test.js';(self.pack/'candidate'/new).write_bytes(b'new-fake-asset');(self.public/old).write_bytes(b'old-fake-asset');api=self.dir/'api.js';api.write_bytes(b'protected-fake-api')
        self.manifest={'ownerTask':module.OWNER,'scope':'static-customer-completion-only','apiWrites':0,'databaseWrites':0,'processReloads':0,'beforeHtmlSha256':module.sha(self.before),'afterHtmlSha256':module.sha(self.after),'assets':[{'relative':new,'sha256':module.sha(b'new-fake-asset')}],'baselineAssets':[{'relative':old,'sha256':module.sha(b'old-fake-asset')}],'protectedApis':[{'path':str(api),'sha256':module.sha(b'protected-fake-api')} ]}
        second_api=self.dir/'second-api.js';second_api.write_bytes(b'second-protected-fake-api')
        self.manifest['protectedApis'].append({'path':str(second_api),'sha256':module.sha(b'second-protected-fake-api')})
        self.manifest['protectedApisPendingOwnerFill']=False
        self.mb=module.encode(self.manifest);(self.pack/'release-manifest.json').write_bytes(self.mb);self.pin=module.sha(self.mb)
        self.locks=[]
        for i in range(2):
            p=self.dir/('lock'+str(i));p.write_bytes(b'');self.locks.append(str(p))
        self.processes=[{'id':1,'pid':123,'name':'fake','status':'online','script':'fake','cwd':'fake'}]
        self.patches=[unittest.mock.patch.object(module,'PUBLIC',self.public),unittest.mock.patch.object(module,'COORD',self.coord),unittest.mock.patch.object(module,'ROOT',self.dir/'receipt'),unittest.mock.patch.object(module,'LOCKS',self.locks)]
        for p in self.patches:p.start()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    def run_release(self,apply=False,snapshots=None):
        argv=['release.py','--package',str(self.pack),'--manifest-sha256',self.pin]+(['--apply'] if apply else [])
        with unittest.mock.patch('sys.argv',argv),unittest.mock.patch.object(module,'process_snapshot',side_effect=snapshots or (lambda:self.processes)),contextlib.redirect_stdout(io.StringIO()) as output:
            module.main();return output.getvalue()
    def test_preflight_has_no_writes(self):
        old=self.coord.read_bytes();self.assertIn('PREFLIGHT_PASS',self.run_release());self.assertEqual(self.coord.read_bytes(),old);self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertFalse((self.dir/'receipt').exists())
    def test_apply_preserves_foreign_state_and_old_asset(self):
        self.assertIn('verified',self.run_release(True));self.assertEqual((self.public/'index.html').read_bytes(),self.after);self.assertEqual(json.loads(self.coord.read_bytes())['otherTask'],'preserved');self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active']);self.assertEqual((self.public/self.manifest['baselineAssets'][0]['relative']).read_bytes(),b'old-fake-asset')
    def test_html_drift_refused(self):
        (self.public/'index.html').write_bytes(b'FOREIGN_UPDATE');old=self.coord.read_bytes()
        with self.assertRaisesRegex(RuntimeError,'CURRENT_HTML_DRIFT'):self.run_release(True)
        self.assertEqual(self.coord.read_bytes(),old);self.assertEqual((self.public/'index.html').read_bytes(),b'FOREIGN_UPDATE')
    def test_busy_window_refused(self):
        self.coord.write_text(json.dumps({'shared_release_active':True}));old=self.coord.read_bytes()
        with self.assertRaisesRegex(RuntimeError,'SHARED_RELEASE_BUSY'):self.run_release(True)
        self.assertEqual(self.coord.read_bytes(),old)
    def test_post_switch_failure_rolls_back_only_own_html(self):
        altered=[{**self.processes[0],'pid':124}]
        with self.assertRaisesRegex(RuntimeError,'PROCESS_CHANGED'):self.run_release(True,[self.processes,self.processes,altered,altered])
        self.assertEqual((self.public/'index.html').read_bytes(),self.before);self.assertFalse(json.loads(self.coord.read_bytes())['shared_release_active']);self.assertEqual(json.loads((self.dir/'receipt/receipt.json').read_bytes())['status'],'rolled-back')
if __name__=='__main__':unittest.main(verbosity=2)
