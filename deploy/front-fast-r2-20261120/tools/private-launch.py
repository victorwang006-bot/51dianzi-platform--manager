#!/usr/bin/env python3
"""Fixed stage only. Existing daemon effective DB credential stays in memory.
Never source .env, change PM2/service environment, expose credentials, or call old apply.
"""
import ast,hashlib,json,os,subprocess,sys
from pathlib import Path
STAGE=Path('/opt/ops/front-fast-r2-20261120-qp4e5jVm')
ORIGINAL=Path('/opt/ops/front-fast-20261120-XM2KNK1v')
parsed=ast.parse((ORIGINAL/'launch-fast-release.py').read_text());nodes=[]
for node in parsed.body:
    if getattr(node,'lineno',0)>=63:break
    nodes.append(node)
ns={'__name__':'private_reviewed_memory_environment'}
exec(compile(ast.Module(body=nodes,type_ignores=[]),str(ORIGINAL/'launch-fast-release.py'),'exec'),ns)
need=ns['need'];H=ns['digest'];env,_,_=ns['inherited_environment']()
need(len(sys.argv)>=2,'EXPLICIT_MODE_REQUIRED');mode=sys.argv[1];args=sys.argv[2:]
if mode=='--close-recovery':
    os.execve(sys.executable,[sys.executable,'-B',str(STAGE/'controller/close-recovery.py'),*args],env)
elif mode in ('--capture','--preflight','--apply'):
    os.execve(sys.executable,[sys.executable,'-B',str(STAGE/'controller/release.py'),mode,*args],env)
elif mode=='--prepare-private':
    need(not args and not (STAGE/'receipt/attempt.json').exists(),'FIXED_PRIVATE_PREPARE_NO_ATTEMPT')
    pins=json.loads((STAGE/'tools-pins.json').read_bytes())
    for name,digest in pins.items():need(H((STAGE/name).read_bytes())==digest,'FIXED_TOOL_SOURCE_PIN')
    active=Path('/var/lib/dianzi51-private/official-technical/prepared-v1.json');original=active.read_bytes()
    need(H(original)=='ddf5b735d77f80a110cb4df682f3dce8d649423f03c93cd2699dc6fb881b0109','EXACT_OLD_ACTIVE_STORE_REQUIRED')
    candidate=STAGE/'prepared-candidate.json';need(not candidate.exists() and not candidate.is_symlink(),'PRIVATE_CANDIDATE_INITIAL_ONLY')
    with candidate.open('xb') as f:os.chmod(candidate,0o600);f.write(original);f.flush();os.fsync(f.fileno())
    worker=next(name for name in pins if name.endswith('.worker.mjs'))
    r=subprocess.run([ns['NODE'],str(STAGE/'tools/prepare-complaint-datasheets.mjs'),'--complaint-pair','--apply','--verify','--store',str(candidate),'--worker',str(STAGE/worker)],env=env,cwd=ns['ADMIN_CWD'],capture_output=True,timeout=240)
    need(r.returncode==0,'PRIVATE_PAIR_PREPARATION_FAILED')
    before=json.loads(original);after=json.loads(candidate.read_bytes());lookup={e['identity']['publicId']:e for e in after['entries']}
    need(len(lookup)==len(before['entries']),'EXACT_PUBLIC_ID_SET_REQUIRED')
    after['entries']=[lookup[e['identity']['publicId']] for e in before['entries']]
    with candidate.open('w') as f:f.write(json.dumps(after,separators=(',',':'),ensure_ascii=False)+'\n');f.flush();os.fsync(f.fileno())
    req={'schema':'fast-source-request-v1','ownerTask':'qp4e5jVmsAp0UHKwymyD5X','storePath':str(candidate),'storeSha256':H(candidate.read_bytes())}
    r=subprocess.run([ns['NODE'],str(STAGE/'tools/source-verifier.mjs'),'--verify-controller'],env=env,cwd=ns['ADMIN_CWD'],input=(json.dumps(req)+'\n').encode(),capture_output=True,timeout=240)
    need(r.returncode==0,'PRIVATE_CANDIDATE_FULL_SOURCE_FAILED')
    proof=json.loads(r.stdout);need(proof['storeSha256']==req['storeSha256'],'PRIVATE_FULL_SOURCE_RESULT_BINDING')
    with (STAGE/'source-proof.json').open('xb') as f:os.chmod(STAGE/'source-proof.json',0o600);f.write(r.stdout);f.flush();os.fsync(f.fileno())
    selected=[e for e in after['entries'] if e['identity']['partNumber'] in ('STM8S003F3P6TR','W25N04KVZEIR')]
    need(active.read_bytes()==original,'NO_ACTIVE_STORE_WRITES')
    print(json.dumps({'status':'private-current-candidate-verified','storeSha256':req['storeSha256'],'entries':len(after['entries']),'sourceKeys':len(proof['sourceVersions']),'selected':[{'part':e['identity']['partNumber'],'state':e['technicalResource']['state'],'parameters':len(e['technicalResource']['resource']['parameters']),'pdf':e['technicalResource']['resource']['datasheetUrl']} for e in selected],'databaseWrites':0,'activeStoreWrites':0,'reloads':0},ensure_ascii=False))
else:raise RuntimeError('MODE_NOT_ALLOWED')
