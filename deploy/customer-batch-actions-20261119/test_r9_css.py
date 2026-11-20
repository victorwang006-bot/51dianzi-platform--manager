#!/usr/bin/env python3
import ast,re,sys,importlib.util,hashlib,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('r9_css_release',HERE/'release.py');r=importlib.util.module_from_spec(spec);sys.modules[spec.name]=r;spec.loader.exec_module(r)
t=ast.parse((HERE/'release.py').read_text());f=next(n for n in t.body if isinstance(n,ast.FunctionDef) and n.name=='validate_payload');assignment=next(n for n in f.body if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id=='css_clean');loop=next(n for n in f.body if isinstance(n,ast.For) and isinstance(n.target,ast.Name) and n.target.id=='selector');fn=ast.FunctionDef(name='scope_css',args=ast.arguments(posonlyargs=[],args=[ast.arg(arg='css')],kwonlyargs=[],kw_defaults=[],defaults=[]),body=[assignment,loop],decorator_list=[]);ns={'re':re,'need':r.need};exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'<actual-css-guard-only>','exec'),ns)
class CSSNarrowTests(unittest.TestCase):
 def test_actual_samebyte_approved_stylesheet(self):
  d=Path('/home/ubuntu/work/customer-batch/backend-prepare-r9-current-001/ui');p=d/'package'/(d/'css-relative.txt').read_text().strip();b=p.read_bytes();self.assertEqual(hashlib.sha256(b).hexdigest(),'0abf3e1aacf580cfda4a0f9f45db055a549ed5cb4e59d2c09b96b8e22c23fb97');ns['scope_css'](b.decode())
 def test_three_only_exact_known_wrappers(self):
  for media in ('@media (max-width:900px)','@media (max-width:600px)','@media (max-width: 640px)'):ns['scope_css'](media+'{.customer-supply-dialog .ci-test{display:block}}')
 def test_unscoped_inside_known_media_still_rejected(self):
  with self.assertRaisesRegex(r.ReleaseError,'CUSTOMER_SCOPED_CSS_ONLY'):ns['scope_css']('@media (max-width:900px){body{display:none}}')
 def test_unscoped_comma_still_rejected(self):
  with self.assertRaisesRegex(r.ReleaseError,'CUSTOMER_SCOPED_CSS_ONLY'):ns['scope_css']('.customer-upload-history,body{color:red}')
 def test_unknown_media_still_rejected(self):
  with self.assertRaisesRegex(r.ReleaseError,'CUSTOMER_SCOPED_CSS_ONLY'):ns['scope_css']('@media (max-width:800px){.customer-supply-dialog{color:red}}')
 def test_font_and_supports_still_rejected(self):
  for s in ('@font-face{font-family:x}','@supports(display:grid){.customer-supply-dialog{display:grid}}'):
   with self.assertRaisesRegex(r.ReleaseError,'CUSTOMER_SCOPED_CSS_ONLY'):ns['scope_css'](s)
 def test_scope_ttl_capture_reload_every_other_ast_exact(self):
  a=ast.parse((HERE/'evidence/r9-css-baseline/release.py').read_text());changed=[n.name if isinstance(n,ast.FunctionDef) else type(n).__name__ for n,m in zip(a.body,t.body) if ast.dump(n,include_attributes=False)!=ast.dump(m,include_attributes=False)];self.assertEqual(len(a.body),len(t.body));self.assertEqual(changed,['validate_payload']);self.assertEqual(r.TTL,3600);self.assertEqual(r.SCOPE,'customer-batch-actions-20261120-6Lfttf6o-R9')
 def test_preparer_only_new_pin(self):
  a=ast.parse((HERE/'evidence/r9-css-baseline/prepare-local.py').read_text());b=ast.parse((HERE/'prepare-local.py').read_text());changed=[(n,m) for n,m in zip(a.body,b.body) if ast.dump(n,include_attributes=False)!=ast.dump(m,include_attributes=False)];self.assertEqual(len(a.body),len(b.body));self.assertEqual(len(changed),1);self.assertEqual(changed[0][0].targets[0].id,'CONTROLLER_SHA');self.assertEqual(changed[0][1].value.value,hashlib.sha256((HERE/'release.py').read_bytes()).hexdigest())
if __name__=='__main__':unittest.main()
