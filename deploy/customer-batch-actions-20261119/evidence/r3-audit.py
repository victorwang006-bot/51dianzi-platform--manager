#!/usr/bin/env python3
"""Read local scoped bytes and AST, emit evidence/r3-* only; no imports/release CLI."""
from pathlib import Path
import ast, difflib, hashlib, json
ROOT=Path(__file__).absolute().parent.parent
E=ROOT/'evidence'
def H(b):return hashlib.sha256(b).hexdigest()
def put(name,value): (E/name).write_text(json.dumps(value,ensure_ascii=True,indent=2,sort_keys=True)+'\n')
def named(nodes):
 out={}; unnamed=0
 for node in nodes:
  if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):name=node.name
  elif isinstance(node,(ast.Assign,ast.AnnAssign)):
   targets=node.targets if isinstance(node,ast.Assign) else [node.target]
   name='assign:'+','.join(ast.unparse(t) for t in targets)
  else:
   name=f'unnamed:{unnamed}';unnamed+=1
  assert name not in out,name;out[name]=node
 return out
D=lambda n:ast.dump(n,include_attributes=False)
names=['release.py','test_release.py','prepare-local.py','test_prepare_local.py','README.md','prepare-local.README.md']
source={n:(ROOT/n).read_bytes() for n in names}; before={n:(E/('r3-baseline-'+n)).read_bytes() for n in names}
assert H(before['release.py'])=='d6f724847e205005060b6d11e0b15d7e31ba0ce373119187d062aba437e4cdec'
old=named(ast.parse(before['release.py']).body);new=named(ast.parse(source['release.py']).body)
changed=[k for k in old.keys()&new.keys() if D(old[k])!=D(new[k])]
added=sorted(new.keys()-old.keys()); deleted=sorted(old.keys()-new.keys())
allowed={'assign:SCOPE','Config','raw_semantics','transport','snapshot_rows','identity','Controller'}
assert set(changed)==allowed,(changed,allowed)
assert not deleted
methodsold=named(old['Controller'].body);methodsnew=named(new['Controller'].body)
methodchanged=sorted(k for k in methodsold if D(methodsold[k])!=D(methodsnew[k]))
assert methodchanged==['reload_one','state_invariants'],methodchanged
assert methodsold.keys()==methodsnew.keys()
co=named(old['Config'].body);cn=named(new['Config'].body)
configchanged=sorted(k for k in co if D(co[k])!=D(cn[k]))
assert configchanged==['assign:extra_protected']
bases=ast.literal_eval(co['assign:extra_protected'].value) if False else None
oldextra=co['assign:extra_protected'].value.elts;newextra=cn['assign:extra_protected'].value.elts
assert len(newextra)==len(oldextra)+1 and all(D(a)==D(b) for a,b in zip(oldextra,newextra))
assert ast.unparse(newextra[-1])=="Path('/var/lib/dianzi51-private')"
po=named(ast.parse(before['prepare-local.py']).body);pn=named(ast.parse(source['prepare-local.py']).body)
pchanged=[k for k in po if D(po[k])!=D(pn[k])]
assert pchanged==['assign:CONTROLLER_SHA'] and po.keys()==pn.keys()
assert ast.literal_eval(pn['assign:CONTROLLER_SHA'].value)==H(source['release.py'])
rpcold=ast.literal_eval(old['assign:RPC'].value);rpcnew=ast.literal_eval(new['assign:RPC'].value)
assert rpcold==rpcnew
unchanged=sorted(k for k in old if k not in changed)
for critical in ['union','inventory','shallow_pm2','assign:LIFECYCLE','locked','check_locks','cas','permissions',
                 'rpc','get_http','listener','fresh','encode','decode','validate_payload','validate_review',
                 'seal_candidate','config_binding','production_reload']:
 assert critical in unchanged,critical
for critical in ['__init__','snapshot','capture','bundle','preflight','baseline_guard','guard','checkpoint',
                 'change_file','change_coord','close','retain_owned_hold','fail','restore_journal','apply',
                 'verify','_verify','rollback','receipt_proof','durable_success','health']:
 assert D(methodsold[critical])==D(methodsnew[critical]),critical
pins=ast.literal_eval(new['assign:PM2_GENERATION_PINS'].value)
recordsfile=Path('/home/ubuntu/work/customer-batch/pm2-live-source/source-records.json')
records=json.loads(recordsfile.read_bytes()); pm2=Path('/home/ubuntu/work/customer-batch/pm2-live-source')
for remote,r in records.items():
 path=pm2/Path(remote).relative_to('/usr/local/lib/node_modules/pm2');b=path.read_bytes()
 assert H(b)==r['sha256'] and len(b)==r['size'],remote
for name,digest in pins.items():assert H((pm2/name).read_bytes())==digest
closurefile=Path('/home/ubuntu/work/customer-batch/pm2-dependency-closure/closure.json');cl=json.loads(closurefile.read_bytes())
for path,r in cl['records'].items():
 b=Path(r['local']).read_bytes();assert H(b)==r['sha256'] and len(b)==r['size']
assert all(Path('/usr/local/lib/node_modules/pm2') in Path(p).parents for p in cl['records'])
assert not cl['outsidePm2Base'] and not cl['unresolved'] and not cl['dynamicRequires']
relationsfile=Path('/home/ubuntu/work/customer-batch/pm2-relations-readonly.json');relations=json.loads(relationsfile.read_bytes())
assert len(relations['processes'])==6
assert relations['rootLoaderOptionsEmpty'] and relations['rootNodePathEmpty']
assert all(all(p['identity'].values()) and p['processNodeOptionsEmpty'] and p['processNodePathEmpty']
           and not p['appPm2EnvOverridePresent'] and all(v['matchesMonitor'] and v['numericInteger']
           and not v['appOverridePresent'] for v in p['relations'].values()) for p in relations['processes'])
coordfile=Path('/home/ubuntu/work/customer-batch/coord-front-closed.json');assert H(coordfile.read_bytes())=='8a130860aefec8087cebfab27d2bc7782f30a6790a300a75546fb48436f0af89'
for n,b in source.items():
 if n.endswith('.py'):compile(b,n,'exec')
for filename,count in [('r3-release-tests.txt',89),('r3-prepare-tests.txt',32)]:
 log=(E/filename).read_text();assert f'Ran {count} tests in ' in log and log.rstrip().endswith('OK')
statics={'schema':'customer-batch-r3-static-checks-v1','controllerSha256':H(source['release.py']),
         'pythonCompileInMemoryPassed':['release.py','test_release.py','prepare-local.py','test_prepare_local.py'],
         'pycacheWrittenByCommands':False,'rpcBytesExact':True,'controllerTests':89,'preparerTests':32,
         'actualRpcOrReloadTested':False,'controllerApproved':False,'finalDeployApproval':False}
put('r3-static-checks.json',statics)
astdiff={'schema':'customer-batch-r3-exact-ast-diff-v1','baselineSha256':H(before['release.py']),
         'controllerSha256':H(source['release.py']),'changedExistingTopLevelNodes':sorted(changed),
         'addedTopLevelNodes':added,'deletedTopLevelNodes':deleted,'unchangedTopLevelNodes':unchanged,
         'configOnlyChangedMember':configchanged,'configExactRootAppendedPreservingOriginalEntries':True,
         'changedControllerMethods':methodchanged,'unchangedControllerMethods':sorted(k for k in methodsold if k not in methodchanged),
         'preparerChangedNodes':pchanged,'preparerPinMatchesController':True,'rpcSha256':H(rpcnew.encode()),
         'rpcBytesExact':True,'pm2BaseInventoryAstExact':True,
         'ttlBudgetsNoReplayCasLocksPermissionsEnvShallowHealthCaptureApprovalReceiptRecoveryOtherProtocolAstExact':True}
put('r3-ast-diff.json',astdiff)
combined=[]
for n in names:
 diff=''.join(difflib.unified_diff(before[n].decode().splitlines(True),source[n].decode().splitlines(True),
                                 fromfile='d6-baseline/'+n,tofile='R3/'+n))
 combined.append(diff)
 if n=='release.py':(E/'r3-controller.diff').write_text(diff)
(E/'r3-allowed-files.diff').write_text(''.join(combined))
proof={'schema':'customer-batch-r3-source-and-safety-v1','status':'NOT_APPROVED',
       'controllerApproved':False,'finalDeployApproval':False,
       'owner':'6Lfttf6oVWJ8YS69o5FkXQ','scope':'customer-batch-actions-20261120-6Lfttf6o-R3',
       'before':{n:H(b) for n,b in before.items()},'after':{n:H(b) for n,b in source.items()},
       'generationSourcePins':pins,'generationSourceRecordsSha256':H(recordsfile.read_bytes()),
       'actualPm2SourceRecordsHashesAndSizesVerified':len(records),
       'rpcDependencyClosureSha256':H(closurefile.read_bytes()),'rpcDependencyFilesVerified':len(cl['records']),
       'rpcDependencyEdges':len(cl['edges']),'rpcOutsidePm2Base':cl['outsidePm2Base'],
       'rpcDynamicRequires':cl['dynamicRequires'],'rpcUnresolved':cl['unresolved'],
       'relationsSha256':H(relationsfile.read_bytes()),'actualSixIdentityAndFiveNumericRelationsVerified':True,
       'rootAndSixLoaderFlagsEmptyAtEvidenceTime':True,'actualCoordSha256':H(coordfile.read_bytes()),
       'testLogs':{n:H((E/n).read_bytes()) for n in ('r3-release-tests.txt','r3-prepare-tests.txt')},
       'controllerIsolatedMockTests':89,'preparerIsolatedMockTests':32,
       'notProductionCompatibilityProof':True,
       'constraints':{'onlySixAllowedFilesAndEvidenceR3Writes':True,'businessOrUiOrJsBuilderModified':False,
                      'businessTestsExecuted':False,'gitOperations':0,'sshOperations':0,'mcpOperations':0,
                      'productionConnections':0,'productionWrites':0,'productionReloads':0,
                      'releaseCliExecuted':False,'realPrepareExecuted':False,'approvalGenerated':False},
       'blockers':['Actual complete R3 fresh capture/full private tree and frontend protection set binding absent',
                   'Actual six-slot full retained-byte model-to-fork forecast/reset shape not supplied',
                   'Utility.clone modules/fclone source semantics not in supplied generation or RPC records',
                   'Actual fresh package/manifest/packageFiles/source/tool pins and independent delta approval absent'],
       'exactAstEvidence':'evidence/r3-ast-diff.json','controllerDiff':'evidence/r3-controller.diff'}
put('r3-source-and-safety.json',proof)
print(json.dumps({'controllerSha256':H(source['release.py']),'changedNodes':sorted(changed),
                  'changedMethods':methodchanged,'unchangedTopLevelCount':len(unchanged),
                  'controllerTests':89,'preparerTests':32,'status':'NOT_APPROVED'},indent=2))
