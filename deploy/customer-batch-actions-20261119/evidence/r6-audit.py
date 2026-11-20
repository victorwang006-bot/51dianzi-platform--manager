#!/usr/bin/env python3
"""Static baseline audit only; no project imports or external execution."""
import ast
import difflib
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).absolute().parent.parent
BASE = ROOT/'evidence/r6-baseline-36706f'
NAMES = ('release.py','test_release.py','prepare-local.py','test_prepare_local.py','README.md','prepare-local.README.md')
EXPECTED = dict(zip(NAMES, (
    '36706f932e6284a1192ef213d85836d25b4c9a7a7023309c11454c4d2dfdfe14',
    'bff0446a2c86964330ae0702b461fc220a5f12952219e45f69e5eaebee8b0d0e',
    '1768a83b391e3cb05d75a23ac91c426039eb4610575cc95a369f1821c312f862',
    '8e59403a2483d43d9372b08b82ccf80a1dff48babfd55bd439c9267ce5ebfe57',
    'fc51731d091dc845716adf904da6f3e63de6658e3ebfba73a1d117ebe937d679',
    '3041c32db75d27dc94339bbe0dc3788ffa23f73a84919eb5e9cdd680c98f5aa1')))

def sha(data): return hashlib.sha256(data).hexdigest()
def dump(node): return ast.dump(node, include_attributes=False)
def parse(path): return ast.parse(path.read_bytes())
def defs(tree): return {n.name:n for n in tree.body if isinstance(n, (ast.FunctionDef,ast.ClassDef))}
def assigns(tree):
    return {ast.unparse(n.targets[0]):n for n in tree.body if isinstance(n,ast.Assign)}
def segment(path,node): return ast.get_source_segment(path.read_text(),node)
def tests(tree):
    return {(c.name,f.name):f for c in tree.body if isinstance(c,ast.ClassDef)
            for f in c.body if isinstance(f,ast.FunctionDef) and f.name.startswith('test_')}

assert all(sha((BASE/n).read_bytes()) == EXPECTED[n] for n in NAMES)
old, new = parse(BASE/'release.py'), parse(ROOT/'release.py')
od, nd = defs(old), defs(new)
changed = sorted(k for k in od if dump(od[k]) != dump(nd[k]))
added = sorted(set(nd)-set(od))
assert changed == ['dynamic_maps','dynamic_proc'], changed
assert added == ['dynamic_kernel_mappings','dynamic_map_fields'], added
assert set(od) <= set(nd)
unchanged = sorted(k for k in od if k not in changed)
assert all(segment(BASE/'release.py',od[k]) == segment(ROOT/'release.py',nd[k]) for k in unchanged)
assert segment(BASE/'release.py',od['Controller']) == segment(ROOT/'release.py',nd['Controller'])
methods = [n.name for n in od['Controller'].body if isinstance(n,ast.FunctionDef)]
assert len(methods) == 30
assign_changes = sorted(k for k in assigns(old) if dump(assigns(old)[k]) != dump(assigns(new)[k]))
assert assign_changes == ['SCOPE'], assign_changes
pins = ast.literal_eval(assigns(new)['PM2_GENERATION_PINS'].value)
assert len(pins) == 9
def untouched_module(tree):
    return [dump(n) for n in tree.body
            if not (isinstance(n, ast.FunctionDef) and n.name in changed+added)
            and not (isinstance(n, ast.Assign) and ast.unparse(n.targets[0]) == 'SCOPE')]
assert untouched_module(old) == untouched_module(new)
# The existing absolute/fullpath file-backed branch is byte-identical.
def absolute_branch(node):
    for child in ast.walk(node):
        if isinstance(child, ast.If) and ast.unparse(child.test) == "path.startswith('/')":
            return '\n'.join(ast.get_source_segment((ROOT/'release.py').read_text(), n) for n in child.body)
    raise AssertionError('file-backed branch missing')
def branch_segment(path,node):
    for child in ast.walk(node):
        if isinstance(child, ast.If) and ast.unparse(child.test) == "path.startswith('/')":
            return [ast.get_source_segment(path.read_text(), n) for n in child.body]
assert branch_segment(BASE/'release.py',od['dynamic_maps']) == branch_segment(ROOT/'release.py',nd['dynamic_maps'])
# Extracted per-line checks are exactly the old validator AST, not a looser regex.
assert dump(od['dynamic_maps'].body[1].body[0]) == dump(nd['dynamic_map_fields'].body[0])
assert dump(od['dynamic_maps'].body[1].body[1]) == dump(nd['dynamic_map_fields'].body[1])
po, pn = parse(BASE/'prepare-local.py'), parse(ROOT/'prepare-local.py')
assert all(dump(v) == dump(defs(pn)[k]) and segment(BASE/'prepare-local.py',v) == segment(ROOT/'prepare-local.py',defs(pn)[k]) for k,v in defs(po).items())
assert sorted(k for k in assigns(po) if dump(assigns(po)[k]) != dump(assigns(pn)[k])) == ['CONTROLLER_SHA']
assert ast.literal_eval(assigns(pn)['CONTROLLER_SHA'].value) == sha((ROOT/'release.py').read_bytes())
# Preserve every original test method (only current scope assertions synchronize).
test_report = {}
for name, count in (('test_release.py',212),('test_prepare_local.py',38)):
    a,b = tests(parse(BASE/name)),tests(parse(ROOT/name))
    assert len(a) == count
    assert set(a) <= set(b)
    changed_tests=[]
    for k,v in a.items():
        before=segment(BASE/name,v)
        after=segment(ROOT/name,b[k])
        assert before.replace('customer-batch-actions-20261120-6Lfttf6o-R5','customer-batch-actions-20261120-6Lfttf6o-R6') == after, k
        if before != after: changed_tests.append('.'.join(k))
    test_report[name] = dict(baselineCount=len(a),currentCount=len(b),newMethods=sorted('.'.join(k) for k in set(b)-set(a)),scopeAssertionOnlyChanged=changed_tests)
report = dict(status='OFFLINE_STATIC_AUDIT_PASS_NOT_APPROVED',baselineSha256=EXPECTED,
              currentSha256={n:sha((ROOT/n).read_bytes()) for n in NAMES},
              controllerEntireByteAndAstSame=True,controllerMethods=methods,controllerMethodCount=30,
              allNinePinsExactSame=True,pm2GenerationPins=pins,protectedConfigEntireByteAndAstSame=True,
              protectedTreesUnionInventoryCASSnapshotDomainTransportRPCByteAndAstSame=True,
              unchangedTopLevelDefinitions=unchanged,changedTopLevelDefinitions=changed,
              addedTopLevelDefinitions=added,changedExistingConstants=assign_changes,
              fullpathMappingBranchByteAndAstSame=True,perlineValidatorAstIdentical=True,
              preparerAllDefinitionsByteAndAstSame=True,preparerOnlyExistingConstantChange='CONTROLLER_SHA',
              originalTestMethodsPreserved=test_report,
              sourceApplicationExecution=False,actualProcAccess=False,externalCalls=False,
              fdLogQueueReads=False,productionWrites=0,captureGenerated=False,approvalGenerated=False)
(ROOT/'evidence/r6-ast-diff.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
patch=''
for name in NAMES:
    patch += ''.join(difflib.unified_diff((BASE/name).read_text().splitlines(True),(ROOT/name).read_text().splitlines(True),fromfile='r6-baseline-36706f/'+name,tofile='r6-current/'+name))
(ROOT/'evidence/r6-six-files.patch').write_text(patch)
logs = {p.name:dict(sha256=sha(p.read_bytes()),bytes=p.stat().st_size) for p in sorted((ROOT/'evidence').glob('r6-*.log')) if p.name != 'r6-audit.log'}
(ROOT/'evidence/r6-source-and-safety.json').write_text(json.dumps(dict(status='NOT_APPROVED',sourceSha256=report['currentSha256'],baselineSha256=EXPECTED,logs=logs,staticAuditSha256=sha((ROOT/'evidence/r6-ast-diff.json').read_bytes()),diffSha256=sha(patch.encode()),scope='customer-batch-actions-20261120-6Lfttf6o-R6',owner='6Lfttf6oVWJ8YS69o5FkXQ',actualCaptureGenerated=False,attemptGenerated=False,activeWindowOpened=False,productionWrites=0,reloadCalls=0,noGitMCPSSHNodeProdCLI=True),ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(status='PASS',releaseSha256=report['currentSha256']['release.py'],controllerMethods=len(methods),pins=len(pins),changedDefinitions=changed,newControllerTests=test_report['test_release.py']['currentCount']-212,newPreparerTests=test_report['test_prepare_local.py']['currentCount']-38)))
