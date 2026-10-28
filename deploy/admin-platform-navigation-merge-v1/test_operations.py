import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('nav_ops',ROOT/'operations.py')
ops=importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)

class ChangeBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m=json.loads((ROOT/'dist/manifest.json').read_text())
        cls.before=(ROOT/'baseline/index.html').read_bytes()

    def test_only_one_literal_changed(self):
        after=ops.prepare_html(self.before,self.m)
        self.assertEqual(after,(ROOT/'dist/index.html').read_bytes())
        self.assertEqual(after,self.before.replace(self.m['oldTarget'].encode(),self.m['layout'].encode(),1))
        self.assertEqual(after.replace(self.m['layout'].encode(),self.m['oldTarget'].encode(),1),self.before)

    def test_html_drift_refused(self):
        with self.assertRaises(AssertionError):
            ops.prepare_html(self.before+b'\n',self.m)

    def test_unknown_pointer_refused(self):
        with self.assertRaises(AssertionError):
            ops.prepare_html(self.before,{**self.m,'oldTarget':'/assets/unknown.js'})

    def test_assets_are_two_js_no_css(self):
        self.assertEqual(len(self.m['files']),2)
        self.assertTrue(all(x['name'].endswith('.js') for x in self.m['files']))
        original=(ROOT/'baseline/DashboardLayout-live.js').read_bytes()
        modified=(ROOT/'dist'/Path(self.m['layout']).name).read_bytes()
        self.assertEqual(modified,original.replace(json.dumps(self.m['oldRuntime']).encode(),json.dumps(self.m['runtime']).encode(),1))

    def test_exact_files_processes_links_and_permit(self):
        b={'files':{str(ops.HTML):self.m['oldHtmlSha256'],'/original.js':'fixed'},'services':[{'id':1,'pid':2}],'roots':['/root'],'links':{},'workerPermit':{'sha256':'permit'}}
        current=copy.deepcopy(b)
        ops.verify_original(b,current,self.m,False)
        current['files'][str(ops.HTML)]=self.m['newHtmlSha256']
        current['files'].update({str(ops.ASSETS/f['name']):f['sha256'] for f in self.m['files']})
        ops.verify_original(b,current,self.m,True)
        for field,value in [('files',{'/unexpected.js':'unknown'}),('links',{'/link':'/elsewhere'}),('workerPermit',{'sha256':'changed'})]:
            changed=copy.deepcopy(current);changed[field].update(value)
            with self.assertRaises(AssertionError):ops.verify_original(b,changed,self.m,True)
        current['services'][0]['pid']=3
        with self.assertRaises(AssertionError):ops.verify_original(b,current,self.m,True)

    def test_atomic_compare_and_swap(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'index.html';target.write_bytes(b'current')
            with self.assertRaises(AssertionError):ops.atomic(target,b'candidate',expected=ops.digest(b'old'))
            self.assertEqual(target.read_bytes(),b'current')
            ops.atomic(target,b'candidate',expected=ops.digest(b'current'))
            self.assertEqual(target.read_bytes(),b'candidate')

    def test_existing_and_dangling_symlink_assets_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'asset.js'
            ops.assert_asset_absent(target)
            target.symlink_to(Path(folder)/'missing.js')
            with self.assertRaises(AssertionError):ops.assert_asset_absent(target)
            self.assertTrue(target.is_symlink())
            target.unlink();target.write_bytes(b'current')
            with self.assertRaises(AssertionError):ops.assert_asset_absent(target)
            self.assertEqual(target.read_bytes(),b'current')

    def test_manifest_change_refused(self):
        raw=json.dumps(self.m).encode();sha=ops.digest(raw)
        ops.validate_manifest_binding(raw,sha)
        altered=copy.deepcopy(self.m);altered['files'][0]['sha256']='f'*64
        with self.assertRaises(AssertionError):ops.validate_manifest_binding(json.dumps(altered).encode(),sha)

    def test_rollback_preserves_newer_unrelated_html(self):
        with tempfile.TemporaryDirectory() as folder:
            actual=Path(folder)/'index.html'
            actual.write_bytes((ROOT/'dist/index.html').read_bytes().replace(b'</head>',b'<meta name="other-change">\n</head>'))
            original_path=ops.HTML;ops.HTML=actual
            try:
                ops.rollback_pointer(self.m)
                self.assertEqual(actual.read_bytes(),self.before.replace(b'</head>',b'<meta name="other-change">\n</head>'))
            finally:ops.HTML=original_path

    def test_unknown_rollback_target_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            actual=Path(folder)/'index.html';actual.write_bytes(self.before)
            original_path=ops.HTML;ops.HTML=actual
            try:
                with self.assertRaises(AssertionError):ops.rollback_pointer(self.m)
                self.assertEqual(actual.read_bytes(),self.before)
            finally:ops.HTML=original_path

if __name__=='__main__':
    unittest.main()
