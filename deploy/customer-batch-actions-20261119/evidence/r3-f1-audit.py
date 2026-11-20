#!/usr/bin/env python3
"""Read local source/log bytes only; produce exact F1 AST and SHA evidence."""
import ast
import difflib
import hashlib
import json
from pathlib import Path
HERE = Path(__file__).absolute().parent
ROOT = HERE.parent

def H(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def trimmed(text, preparer=False):
    tree = ast.parse(text)
    kept = []
    for n in tree.body:
        if not preparer and isinstance(n, ast.FunctionDef) and n.name == 'decode':
            continue
        if not preparer and isinstance(n, ast.Import) and [a.name for a in n.names] == ['math']:
            continue
        if preparer and isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'CONTROLLER_SHA' for t in n.targets):
            continue
        kept.append(n)
    return ast.dump(ast.Module(body=kept, type_ignores=[]), include_attributes=False)

before = HERE/'r3-f1-baseline-release.py'
after = ROOT/'release.py'
old_p = HERE/'r3-f1-baseline-prepare-local.py'
new_p = ROOT/'prepare-local.py'
assert H(before) == 'ec2f541d4cee799a21a9b21633110a183c8efaf162451876ad5aea415359bde5'
assert trimmed(before.read_text()) == trimmed(after.read_text())
assert trimmed(old_p.read_text(), True) == trimmed(new_p.read_text(), True)
ptree = ast.parse(new_p.read_text())
pin = next(ast.literal_eval(n.value) for n in ptree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'CONTROLLER_SHA' for t in n.targets))
assert pin == H(after)
logs = {'finite':('r3-f1-finite-tests.txt',6),'controller':('r3-f1-release-tests.txt',89),'preparer':('r3-f1-prepare-tests.txt',32)}
tests = {}
for name, (file, count) in logs.items():
    p = HERE/file
    text = p.read_text()
    assert text.rstrip().endswith('OK') and ('Ran '+str(count)+' tests') in text
    tests[name] = {'count':count,'logSha256':H(p),'status':'OK'}
for p in [after,new_p,ROOT/'test_finite_json.py']:
    compile(p.read_bytes(),str(p),'exec')
result = {'status':'F1_OFFLINE_CORRECTED_NOT_APPROVED','controllerBeforeSha256':H(before),'controllerAfterSha256':H(after),'preparerSha256':H(new_p),'finiteTestSourceSha256':H(ROOT/'test_finite_json.py'),'sourceChangesOnly':['import math','decode nested finite_float and parse_float hook','preparer CONTROLLER_SHA'],'allOtherControllerASTUnchanged':True,'allOtherPreparerASTUnchanged':True,'tests':tests,'scopeUnchanged':'customer-batch-actions-20261120-6Lfttf6o-R3','scopeNeverCapturedOrAttempted':True,'productionAccess':False,'productionWrites':0,'reloads':0,'captureCreated':False,'approvalCreated':False,'controllerApproved':False,'finalDeployApproval':False,'hold':'ECS backup/capacity and frontend latest static scope; clone/retained/fresh/full-package approval still missing'}
(HERE/'r3-f1-source-and-safety.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
(HERE/'r3-f1-controller.diff').write_text(''.join(difflib.unified_diff(before.read_text().splitlines(True),after.read_text().splitlines(True),fromfile='ec2-reviewed-release.py',tofile='bf7-finite-release.py')))
print(json.dumps(result,ensure_ascii=False,indent=2))
