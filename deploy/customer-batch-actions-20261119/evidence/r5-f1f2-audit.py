#!/usr/bin/env python3
import ast,hashlib,json,difflib
from pathlib import Path
root=Path(__file__).parent.parent;base=root/'evidence/r5-f1f2-baseline-f544';out=root/'evidence'
H=lambda b:hashlib.sha256(b).hexdigest()
def defs(text):
 lines=text.splitlines(keepends=True);tree=ast.parse(text)
 def key(n):
  if isinstance(n,(ast.FunctionDef,ast.ClassDef)):return n.name
  if isinstance(n,ast.Assign):return '|'.join(ast.dump(v) for v in n.targets)
  return ast.dump(n,include_attributes=False)
 return {key(n):(ast.dump(n,include_attributes=False),''.join(lines[n.lineno-1:n.end_lineno]).encode()) for n in tree.body}
a=(base/'release.py').read_text();b=(root/'release.py').read_text();ad,bd=defs(a),defs(b)
changed={k for k in ad if ad[k]!=bd[k]};assert set(ad)==set(bd) and changed=={'dynamic_maps','dynamic_owned'}
assert ad['Controller']==bd['Controller']
old_pre=(base/'prepare-local.py').read_text();new_pre=(root/'prepare-local.py').read_text();old_pin=H(a.encode());new_pin=H(b.encode())
assert new_pre.replace(new_pin,old_pin)==old_pre
assert new_pin=='36706f932e6284a1192ef213d85836d25b4c9a7a7023309c11454c4d2dfdfe14'
old_test=(base/'test_release.py').read_text();new_test=(root/'test_release.py').read_text();old_defs=defs(old_test);new_defs=defs(new_test)
assert all(new_defs[k]==v for k,v in old_defs.items())
assert (base/'test_prepare_local.py').read_bytes()==(root/'test_prepare_local.py').read_bytes()
for name,expected in [('eight',8),('release',212),('prepare',38),('finite',6)]:
 p=out/f'r5-f1f2-{name}-tests.txt';t=p.read_text();assert f'Ran {expected} tests' in t and t.rstrip().endswith('OK')
files={str(p.relative_to(root)):{'sha256':H(p.read_bytes()),'bytes':p.stat().st_size} for p in [root/'release.py',root/'prepare-local.py',root/'test_release.py',root/'test_prepare_local.py',*[out/f'r5-f1f2-{n}-tests.txt' for n in ('eight','release','prepare','finite')]]}
result={'baselineSha256':old_pin,'controllerSha256':new_pin,'changedExistingTopDefinitions':sorted(changed),'entireControllerAstAndBytesUnchanged':True,'otherExistingDefinitionsAstAndBytesUnchanged':True,'preparerOnlyPinChanged':True,'allOldTestDefinitionsAstAndBytesUnchanged':True,'testPrepareSourceUnchanged':True,'tests':{'eight':8,'release':212,'prepare':38,'finite':6},'files':files,'controllerApproved':False,'releaseApproved':False,'finalDeployApproval':False,'actualSixReadyWitness':False,'capture':False,'serverWrites':0,'reloads':0}
(out/'r5-f1f2-source-and-safety.json').write_text(json.dumps(result,indent=2)+'\n')
(out/'r5-f1f2-controller.diff').write_text(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='f544-baseline-release.py',tofile='3670-current-release.py')))
print(json.dumps(result,indent=2))
