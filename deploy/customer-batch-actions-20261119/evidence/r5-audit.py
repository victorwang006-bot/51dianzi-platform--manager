"""Offline AST/bytes/hash audit only; never imports controller or reference."""
import ast
import difflib
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT/'evidence/r5-baseline-4fe'
FILES = ('release.py','test_release.py','prepare-local.py','test_prepare_local.py','README.md','prepare-local.README.md')

def sha(data):
    return hashlib.sha256(data).hexdigest()

def parse(path):
    data=path.read_bytes();text=data.decode();return data,text,ast.parse(text)

def dump(n):
    return ast.dump(n,include_attributes=False)

def definitions(tree):
    return {n.name:n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))}

def tests(tree):
    return {n.name+'.'+m.name:m for n in tree.body if isinstance(n,ast.ClassDef)
            for m in n.body if isinstance(m,ast.FunctionDef) and m.name.startswith('test_')}

def source(text,n):
    # exact original method lines INCLUDING indentation and newline
    return ''.join(text.splitlines(keepends=True)[n.lineno-1:n.end_lineno])

oldb,oldt,old=parse(BASE/'release.py');newb,newt,new=parse(ROOT/'release.py')
assert sha(oldb)=='4fe2ad8a49982a2395a38254da473ebc958cd1ce9bc45310dba1481621fdc121'
od,nd=definitions(old),definitions(new)
oldc,newc=od['Controller'],nd['Controller']
om={n.name:n for n in oldc.body if isinstance(n,ast.FunctionDef)}
nm={n.name:n for n in newc.body if isinstance(n,ast.FunctionDef)}
assert om.keys()==nm.keys() and len(om)==30
assert dump(oldc)==dump(newc) and source(oldt,oldc)==source(newt,newc)
method_proof={name:dict(astSame=dump(om[name])==dump(nm[name]),
                       bytesSame=source(oldt,om[name])==source(newt,nm[name]),
                       sha256=sha(source(newt,nm[name]).encode())) for name in om}
assert all(x['astSame'] and x['bytesSame'] for x in method_proof.values())
changed=[name for name in od if dump(od[name])!=dump(nd[name])]
assert set(changed)=={'Config','external_protection'}
unchanged=[name for name in od if name not in changed]
assert all(source(oldt,od[name])==source(newt,nd[name]) for name in unchanged)
added=sorted(set(nd)-set(od))
assert all(n.startswith('dynamic_') for n in added)

def assignments(tree):
    return {n.targets[0].id:n for n in tree.body if isinstance(n,ast.Assign)
            and len(n.targets)==1 and isinstance(n.targets[0],ast.Name)}

oa,na=assignments(old),assignments(new)
changed_constants=[name for name in oa if dump(oa[name])!=dump(na[name])]
assert changed_constants==['SCOPE']
assert dump(oa['PM2_GENERATION_PINS'])==dump(na['PM2_GENERATION_PINS'])
assert source(oldt,oa['RPC'])==source(newt,na['RPC'])
oldfields={n.target.id:n for n in od['Config'].body if isinstance(n,ast.AnnAssign)}
newfields={n.target.id:n for n in nd['Config'].body if isinstance(n,ast.AnnAssign)}
assert all(dump(n)==dump(newfields[k]) and source(oldt,n)==source(newt,newfields[k]) for k,n in oldfields.items())
assert set(newfields)-set(oldfields)=={'execution_roots','execution_sources'}
prep_oldb,prep_oldt,prep_old=parse(BASE/'prepare-local.py')
prep_newb,prep_newt,prep_new=parse(ROOT/'prepare-local.py')
assert all(source(prep_oldt,n)==source(prep_newt,definitions(prep_new)[name]) for name,n in definitions(prep_old).items())
pa,pb=assignments(prep_old),assignments(prep_new)
assert [name for name in pa if dump(pa[name])!=dump(pb[name])]==['CONTROLLER_SHA']
assert ast.literal_eval(pb['CONTROLLER_SHA'].value)==sha(newb)

retained_tests={}
for name in ('test_release.py','test_prepare_local.py'):
    _,ot,otr=parse(BASE/name);_,nt,ntr=parse(ROOT/name)
    oldtests,newtests=tests(otr),tests(ntr)
    assert oldtests.keys()<=newtests.keys()
    modified=[k for k in oldtests if dump(oldtests[k])!=dump(newtests[k])]
    for k in modified:
        assert source(ot,oldtests[k]).replace('6Lfttf6o-R4','6Lfttf6o-R5')==source(nt,newtests[k])
    retained_tests[name]=dict(originalCount=len(oldtests),retainedCount=len(oldtests),
                             onlyScopeAssertionChanges=modified,newTests=sorted(newtests.keys()-oldtests.keys()),
                             newCount=len(newtests)-len(oldtests),totalCount=len(newtests))

for name in FILES:
    data=(ROOT/name).read_bytes();compile(data,str(ROOT/name),'exec') if name.endswith('.py') else None
    (ROOT/'evidence'/('r5-'+name.replace('.py','').replace('.md','')+'.diff')).write_text(''.join(difflib.unified_diff(
        (BASE/name).read_text().splitlines(keepends=True),(ROOT/name).read_text().splitlines(keepends=True),
        fromfile='baseline-4fe/'+name,tofile='R5/'+name)))

logs={}
for label,file in [('baselineRelease','r5-baseline-release-tests.txt'),('baselinePrepare','r5-baseline-prepare-tests.txt'),
                   ('baselineFinite','r5-baseline-finite-tests.txt'),('release','r5-release-tests.txt'),
                   ('prepare','r5-prepare-tests.txt'),('finite','r5-finite-tests.txt'),('newMock','r5-new-tests.txt')]:
    path=ROOT/'evidence'/file;data=path.read_bytes();text=data.decode()
    count=int(re.search(r'Ran (\d+) tests',text)[1]);passed=text.rstrip().endswith('OK')
    assert passed
    logs[label]=dict(path=str(path),sha256=sha(data),count=count,passed=passed)
ref=Path('/home/ubuntu/51-manager/deploy/self-search-detail-demo-20261120/read-only/probe-live-runtime.py')
assert sha(ref.read_bytes())=='64df69ac84db1a4a662eabc70b91b06f46130f0675d29a1798ebedf0bd440782'
pins=ast.literal_eval(na['PM2_GENERATION_PINS'].value)
ast_evidence=dict(baselineSha256=sha(oldb),currentSha256=sha(newb),
                  controllerMethodCount=30,controllerMethods=method_proof,wholeControllerASTAndBytesSame=True,
                  existingDefinitionsChanged=changed,existingDefinitionsASTAndBytesUnchanged=unchanged,
                  newHelpers=added,existingConstantsChanged=changed_constants,
                  rpcLiteralASTAndBytesSame=True,allNinePinsSame=True,pins=pins,
                  originalConfigAllFieldsASTAndBytesSame=True,newConfigFields=['execution_roots','execution_sources'],
                  configBindingASTAndBytesSame=True,inventoryASTAndBytesSame=True,transportASTAndBytesSame=True,
                  preparerAllDefinitionsASTAndBytesSame=True,preparerOnlyChangedConstant='CONTROLLER_SHA',
                  retainedTests=retained_tests)
(ROOT/'evidence/r5-ast-diff.json').write_text(json.dumps(ast_evidence,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
safety=dict(ownerTask=ast.literal_eval(na['OWNER'].value),scope=ast.literal_eval(na['SCOPE'].value),
            controllerApproved=False,releaseApproved=False,finalDeployApproval=False,reloadApproved=False,
            productionReads=0,productionWrites=0,serverExecutions=0,actualProcReads=0,
            networkAccess=False,probeExecuted=False,actualNodeExecuted=False,actualRpcExecuted=False,
            cliExecuted=False,sshExecuted=False,mcpExecuted=False,gitExecuted=False,
            actualAppModuleExecuted=False,actualDatabaseAccess=False,reloadExecuted=False,
            stageExecuted=False,captureExecuted=False,attemptExecuted=False,reviewGenerated=False,
            sourceDiscoveryReference=dict(path=str(ref),sha256=sha(ref.read_bytes()),readOnlySource=True,
                                          imported=False,executed=False,formalCapture=False,approval=False),
            baseline={f:sha((BASE/f).read_bytes()) for f in FILES},
            current={f:sha((ROOT/f).read_bytes()) for f in FILES},tests=logs,
            astEvidenceSha256=sha((ROOT/'evidence/r5-ast-diff.json').read_bytes()),
            notes=['TemporaryDirectory mocks only; unchanged tests use local fixture locks, never production locks.',
                   'Two finite complete samples; not a kernel-atomic snapshot or continuous stability guarantee.',
                   'Unknown actual loaded JS dependencies remain mandatory independent source-graph review, not semantics-closed.',
                   'Mutable owned API files remain protected by the unchanged inventory/full-CAS chain; normal cluster container argv/maps sources remain transport-fullMETA pinned.'])
(ROOT/'evidence/r5-source-and-safety.json').write_text(json.dumps(safety,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
print(json.dumps(dict(sha=sha(newb),changed=changed,newHelpers=added,counts={k:v['count'] for k,v in logs.items()},
                     retained=retained_tests),ensure_ascii=False,sort_keys=True,indent=2))
