import ast
import copy
import difflib
import hashlib
import json
from pathlib import Path

BASE = Path('/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119')
EVIDENCE = BASE / 'evidence'
OLD = EVIDENCE / 'r4-baseline-bf7ec85b'
FILES = ('release.py','test_release.py','prepare-local.py','test_prepare_local.py','README.md','prepare-local.README.md')
EXPECTED = {
    'release.py':'bf7ec85b902ae2474ded779bfad110e7ac791e7d4c244d67ca6f912614d375ab',
    'test_release.py':'57e089aa2cb90ff3c6fb2ce5eb21a67d6c7b3d12417b6bc183ae3f114e186157',
    'prepare-local.py':'48fbfaecdb81c65dff8722b88c701fbccf5202457e2d080f0c24cbcd2993aa79',
    'test_prepare_local.py':'91f2f078bfd6759a3dc1bb89013fc826801b2975f09a73b41eefafcbe58c013b',
    'README.md':'8f729dde52c611cbcf658983c6ae945634bf8a00e16243f172da9f1aea757c41',
    'prepare-local.README.md':'fbd20614cefdf48ad8ce32eb27bbeebb71b3dd5fa1fabecd36dae29c3b51bb57',
}

def H(data):
    return hashlib.sha256(data).hexdigest()

def put(name, value):
    (EVIDENCE/name).write_text(json.dumps(value,ensure_ascii=True,sort_keys=True,indent=2)+'\n')

def node_name(node):
    if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):
        return node.name
    if isinstance(node,ast.Assign):
        return ','.join(ast.dump(t) for t in node.targets)
    if isinstance(node,ast.AnnAssign):
        return ast.dump(node.target)
    return type(node).__name__ + ':' + ast.dump(node,include_attributes=False)

def source_record(data,node):
    lines=data.splitlines(keepends=True)
    offsets=[0]
    for line in lines: offsets.append(offsets[-1]+len(line))
    start=offsets[node.lineno-1]+node.col_offset
    end=offsets[node.end_lineno-1]+node.end_col_offset
    if getattr(node,'decorator_list',None):
        start=min(start,offsets[node.decorator_list[0].lineno-1])
    raw=data[start:end]
    dump=ast.dump(node,include_attributes=False).encode()
    return dict(byteStart=start,byteEnd=end,bytes=len(raw),sourceSha256=H(raw),astSha256=H(dump))

def index(data):
    tree=ast.parse(data)
    records={node_name(n):(n,source_record(data,n)) for n in tree.body}
    for n in tree.body:
        if isinstance(n,ast.ClassDef):
            for method in n.body:
                if isinstance(method,(ast.FunctionDef,ast.AsyncFunctionDef)):
                    records[n.name+'.'+method.name]=(method,source_record(data,method))
    return tree,records

def label(k):
    prefix="Name(id='"
    return k[len(prefix):].split("'",1)[0] if k.startswith(prefix) else k

hashes={}
diffs=[]
for name in FILES:
    old,new=(OLD/name).read_bytes(),(BASE/name).read_bytes()
    assert H(old)==EXPECTED[name],name+' baseline mismatch'
    hashes[name]=dict(baselineSha256=H(old),currentSha256=H(new),baselineBytes=len(old),currentBytes=len(new))
    diffs.extend(difflib.unified_diff(old.decode().splitlines(keepends=True),new.decode().splitlines(keepends=True),
                                     fromfile='bf7-baseline/'+name,tofile='R4/'+name))
(EVIDENCE/'r4-allowed-files.diff').write_text(''.join(diffs))

ast_report={}
for name in FILES[:4]:
    old,new=(OLD/name).read_bytes(),(BASE/name).read_bytes()
    compile(new,name,'exec')
    ot,oi=index(old); nt,ni=index(new)
    changes=[]; unchanged=[]
    for key in oi.keys() & ni.keys():
        before,after=oi[key][1],ni[key][1]
        entry=dict(name=label(key),before=before,after=after,
                   astEqual=before['astSha256']==after['astSha256'],
                   byteEqual=before['sourceSha256']==after['sourceSha256'])
        (unchanged if entry['astEqual'] and entry['byteEqual'] else changes).append(entry)
    ast_report[name]=dict(changed=sorted(changes,key=lambda r:r['name']),
                          added=sorted([dict(name=label(k),record=ni[k][1]) for k in ni.keys()-oi.keys()],key=lambda r:r['name']),
                          removed=sorted(label(k) for k in oi.keys()-ni.keys()),
                          unchanged=sorted(unchanged,key=lambda r:r['name']))
    if name=='release.py':
        changed={r['name'] for r in changes}
        assert changed=={'SCOPE','Config','PM2_GENERATION_PINS','transport'},changed
        assert not ast_report[name]['removed']
        for key in oi:
            if key.startswith('Controller.'):
                assert oi[key][1]['sourceSha256']==ni[key][1]['sourceSha256']
                assert oi[key][1]['astSha256']==ni[key][1]['astSha256']
        assert oi['Controller'][1]['sourceSha256']==ni['Controller'][1]['sourceSha256']
        assert oi['rpc'][1]['sourceSha256']==ni['rpc'][1]['sourceSha256']
        def assignment(tree,name):
            return next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in n.targets))
        rpc_old=ast.literal_eval(assignment(ot,'RPC').value).encode()
        rpc_new=ast.literal_eval(assignment(nt,'RPC').value).encode()
        assert rpc_old==rpc_new
        old_pins=ast.literal_eval(assignment(ot,'PM2_GENERATION_PINS').value)
        new_pins=ast.literal_eval(assignment(nt,'PM2_GENERATION_PINS').value)
        assert all(new_pins[k]==v for k,v in old_pins.items())
        assert set(new_pins)-set(old_pins)=={'modules/fclone.js'}
        assert len(old_pins)==8 and len(new_pins)==9
        assert new_pins['modules/fclone.js']=='9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6'
        old_cfg=copy.deepcopy(oi['Config'][0]); new_cfg=copy.deepcopy(ni['Config'][0])
        for node in (old_cfg,new_cfg):
            node.body=[n for n in node.body if not (isinstance(n,ast.AnnAssign) and isinstance(n.target,ast.Name) and n.target.id=='extra_protected')]
        assert ast.dump(old_cfg,include_attributes=False)==ast.dump(new_cfg,include_attributes=False)
        r4scope=ast.literal_eval(assignment(nt,'SCOPE').value)
        assert r4scope=='customer-batch-actions-20261120-6Lfttf6o-R4'
        assert ast.literal_eval(assignment(nt,'OWNER').value)=='6Lfttf6oVWJ8YS69o5FkXQ'
        ast_report['rpcProof']=dict(rpcPayloadSha256=H(rpc_new),rpcLiteralBefore=oi[node_name(assignment(ot,'RPC'))][1],
                                  rpcLiteralAfter=ni[node_name(assignment(nt,'RPC'))][1],
                                  rpcFunctionBefore=oi['rpc'][1],rpcFunctionAfter=ni['rpc'][1],byteIdentical=True)
        ast_report['controllerProof']=dict(methodCount=sum(k.startswith('Controller.') for k in oi),
                                         allMethodsAstAndBytesEqual=True,classBefore=oi['Controller'][1],classAfter=ni['Controller'][1])
        ast_report['pinProof']=dict(originalEightRetained=old_pins,onlyAdded={'modules/fclone.js':new_pins['modules/fclone.js']})
        line_diff=''.join(difflib.unified_diff(old.decode().splitlines(keepends=True),new.decode().splitlines(keepends=True),
                                               fromfile='bf7/release.py',tofile='R4/release.py'))
        (EVIDENCE/'r4-controller.diff').write_text(line_diff)
        (EVIDENCE/'r4-transport.diff').write_text(''.join(difflib.unified_diff(
            ast.get_source_segment(old.decode(),oi['transport'][0]).splitlines(keepends=True),
            ast.get_source_segment(new.decode(),ni['transport'][0]).splitlines(keepends=True),
            fromfile='bf7/transport',tofile='R4/transport')))
        def ranges(lines):
            out=[0]
            for x in lines:out.append(out[-1]+len(x))
            return out
        a=old.splitlines(keepends=True);b=new.splitlines(keepends=True);ao=ranges(a);bo=ranges(b)
        blocks=[]
        for op,i,j,k,l in difflib.SequenceMatcher(None,a,b,autojunk=False).get_opcodes():
            if op!='equal':
                blocks.append(dict(operation=op,beforeByteStart=ao[i],beforeByteEnd=ao[j],afterByteStart=bo[k],afterByteEnd=bo[l],
                                   beforeSha256=H(old[ao[i]:ao[j]]),afterSha256=H(new[bo[k]:bo[l]])))
        ast_report['releaseByteDiffBlocks']=blocks
    elif name=='prepare-local.py':
        assert {r['name'] for r in changes}=={'CONTROLLER_SHA'}
        assert not ast_report[name]['added'] and not ast_report[name]['removed']
        current=next(n for n in nt.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CONTROLLER_SHA' for t in n.targets))
        assert ast.literal_eval(current.value)==hashes['release.py']['currentSha256']
    else:
        old_tests={k for k in oi if '.test_' in k}
        new_tests={k for k in ni if '.test_' in k}
        assert old_tests <= new_tests
        ast_report[name]['baselineTestCount']=len(old_tests)
        ast_report[name]['currentTestCount']=len(new_tests)
        ast_report[name]['allBaselineTestMethodNamesRetained']=True

put('r4-ast-diff.json',ast_report)
put('r4-source-and-safety.json',dict(status='NOT_APPROVED',sourceFiles=hashes,
    controllerApproved=False,finalDeployApproval=False,
    productionReads=0,productionWrites=0,remoteStageCreated=False,captureExecuted=False,
    actualNodeExecuted=False,actualRPCExecuted=False,actualLocksAcquired=False,
    actualReloadExecuted=False,gitExecuted=False,mcpExecuted=False,sshExecuted=False,
    onlyLocalTempMockTests=True,allBaselineHashesVerified=True))
logs={}
for name in ('r4-release-tests.txt','r4-prepare-tests.txt','r4-finite-tests.txt'):
    data=(EVIDENCE/name).read_bytes();logs[name]=dict(sha256=H(data),bytes=len(data))
    assert b'\nOK\n' in data and b'FAILED' not in data
put('r4-test-log-hashes.json',logs)
print(json.dumps(dict(status='NOT_APPROVED',controllerSha256=hashes['release.py']['currentSha256'],
    preparerSha256=hashes['prepare-local.py']['currentSha256'],rpcPayloadSha256=ast_report['rpcProof']['rpcPayloadSha256'],
    controllerMethodsUnchanged=ast_report['controllerProof']['methodCount'],
    originalReleaseTests=ast_report['test_release.py']['baselineTestCount'],currentReleaseTests=ast_report['test_release.py']['currentTestCount'],
    originalPreparerTests=ast_report['test_prepare_local.py']['baselineTestCount'],currentPreparerTests=ast_report['test_prepare_local.py']['currentTestCount'],
    changedReleaseAst=[c['name'] for c in ast_report['release.py']['changed']],
    addedReleaseAst=[c['name'] for c in ast_report['release.py']['added']]),sort_keys=True))
