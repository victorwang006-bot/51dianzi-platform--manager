#!/usr/bin/env python3
"""Exact additive frontend activation; never executes business/database mutations."""
import argparse, pathlib, json, hashlib, subprocess, fcntl, os, tempfile, datetime, urllib.request, concurrent.futures
ROOT = pathlib.Path('/opt/ops/20261113-sales-order-consolidation-4kOS3RBC')
PUBLIC = pathlib.Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
COORD = pathlib.Path('/opt/ops/51-project-release-coordination-20261027.json')
TASK = '4kOS3RBCdJO2Kn7BhbvH6T'
def require(ok, message):
    if not ok: raise RuntimeError(message)
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(p, data, mode=None):
    p = pathlib.Path(p); old = p.stat() if p.exists() else None
    fd, tmp = tempfile.mkstemp(prefix='.sales-orders-', dir=p.parent)
    try:
        os.fchmod(fd, mode if mode is not None else (old.st_mode & 0o777 if old else 0o644))
        if old: os.fchown(fd, old.st_uid, old.st_gid)
        with os.fdopen(fd, 'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, p)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
def save(p, obj): atomic(p, (json.dumps(obj, ensure_ascii=False, indent=2)+'\n').encode(), 0o600)
def processes():
    rows = json.loads(subprocess.check_output(['pm2', 'jlist'], timeout=30))
    return [{'id':r['pm_id'], 'name':r['name'], 'pid':r['pid'], 'status':r['pm2_env']['status'], 'script':r['pm2_env']['pm_exec_path'], 'cwd':r['pm2_env']['pm_cwd'], 'environmentHash':hashlib.sha256(json.dumps(r['pm2_env'].get('env',{}), sort_keys=True).encode()).hexdigest()} for r in rows]
def get(url):
    req=urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0','Cache-Control':'no-cache','Accept-Encoding':'identity'})
    with urllib.request.urlopen(req, timeout=30) as r:
        body=r.read(); require(r.status==200, 'HTTP_FAILED_'+url)
        return {'url':url,'status':r.status,'sha256':hashlib.sha256(body).hexdigest()}, body
p=argparse.ArgumentParser(); p.add_argument('--apply',action='store_true'); p.add_argument('--rollback',action='store_true'); args=p.parse_args()
m=json.loads((ROOT/'manifest.json').read_text()); files=m['files']; target=PUBLIC/'index.html'
require(m['ownerTask']==TASK and len(files)==5, 'EXACT_MANIFEST_SCOPE_REQUIRED')
require(len({x['relative'] for x in files})==5 and {x['relative'] for x in files}=={'index.html',*m['coreAssetPaths']}, 'EXACT_ALLOWLIST_FAILED')
require(len(m['coreAssetPaths'])==4 and sum(x.endswith('.js') for x in m['coreAssetPaths'])==3 and sum(x.endswith('.css') for x in m['coreAssetPaths'])==1, 'ASSET_COUNTS_FAILED')
for x in files:
    rel=pathlib.PurePosixPath(x['relative'])
    require(not rel.is_absolute() and '..' not in rel.parts and (x['relative']=='index.html' or rel.parts[0]=='assets'), 'UNSAFE_PATH')
    require((PUBLIC/x['relative']).resolve().is_relative_to(PUBLIC.resolve()), 'OUTSIDE_PUBLIC')
    require(sha(ROOT/'candidate'/x['relative'])==x['sha256'], 'CANDIDATE_CHANGED')
require(sha(ROOT/pathlib.Path(__file__).name)==m['driverSha256'], 'DRIVER_CHANGED')
for name, expected in m['evidenceHashes'].items(): require(sha(ROOT/name)==expected,'EVIDENCE_CHANGED_'+name)
ui=json.loads((ROOT/'actual-candidate-tests.json').read_text()); deps=json.loads((ROOT/'dependency-resolution-proof.json').read_text())
require(ui['status']=='PASS' and ui['actualCandidatePatchBytesExecuted'] and len(ui['results'])>=10, 'ACTUAL_CANDIDATE_TESTS_REQUIRED')
require(deps['status']=='PASS' and m['sourceTestFailures']==0 and m['tscPassed'], 'SOURCE_OR_DEPENDENCY_FAILURE')
for x in ui['inputs']: require(any(f['relative']==x['relative'] and f['sha256']==x['sha256'] for f in files), 'TEST_INPUT_CHANGED')
for i in [0,1]:
    proof=json.loads((ROOT/f'workbench-{i}-build-proof.json').read_text())
    require(proof['exactInverse'] and proof['allNonpatchBytesUnchanged'] and proof['allPriorChatCodeUnchanged'] and proof['originalOrderOperationsUnchanged'] and proof['originalAccessProviderUnchanged'], 'ISOLATION_PROOF_REQUIRED')
html=next(x for x in files if x['relative']=='index.html')
if not args.apply and not args.rollback:
    print(json.dumps({'planOnly':True,'files':5,'backendChanges':0,'databaseOperations':0,'processReloads':0})); raise SystemExit()
locks=[]; opened=False; switched=False
record={'owner_task':TASK,'status':'preflight','scope':'sales-order frontend container/navigation only; no order data mutations','openedAtUtc':now(),'manifestSha256':sha(ROOT/'manifest.json')}
try:
    for name in ['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']:
        f=open(name,'a+'); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); locks.append(f)
    state=json.loads(COORD.read_text()); require(not state.get('shared_release_active'),'OTHER_RELEASE_ACTIVE')
    if args.rollback:
        require(sha(target)==html['sha256'] and sha(ROOT/'index-before.html')==m['beforeHtmlSha256'],'ROLLBACK_CAS_FAILED')
        atomic(target,(ROOT/'index-before.html').read_bytes()); save(ROOT/'rolled-back.json',{'status':'rolled-back','atUtc':now(),'restoredHtmlSha256':sha(target)}); print('exact HTML rollback complete'); raise SystemExit()
    require(not (ROOT/'verified.json').exists(),'ALREADY_VERIFIED')
    require(sha(target)==m['beforeHtmlSha256'],'BASELINE_CAS_FAILED')
    before=processes(); require(any(x['name']=='dianzi51-admin' and x['status']=='online' for x in before),'ADMIN_NOT_ONLINE')
    protected=[{'path':x,'sha256':sha(x)} for x in m['protectedPaths']]
    for x in m['baselineAssets']: require(sha(PUBLIC/x['relative'])==x['sha256'],'OLD_ASSET_CHANGED')
    for dep in m['dependencies']:
        require(dep.startswith('/assets/'),'DEPENDENCY_PREFIX_FAILED')
        require((PUBLIC/dep.lstrip('/')).is_file() or dep.lstrip('/') in m['coreAssetPaths'],'DEPENDENCY_MISSING_'+dep)
    for x in files:
        if x['relative']!='index.html' and (PUBLIC/x['relative']).exists(): require(sha(PUBLIC/x['relative'])==x['sha256'],'ASSET_OVERWRITE_REFUSED')
    save(ROOT/'process-before.json',before); save(ROOT/'protected-files.json',protected); atomic(ROOT/'index-before.html',target.read_bytes(),0o600)
    get('https://www.51dianzi.com/'); check,_=get('https://admin.51dianzi.com/workbench/orders'); require(check['sha256']==m['beforeHtmlSha256'],'PUBLIC_BASELINE_MISMATCH')
    state=json.loads(COORD.read_text()); require(not state.get('shared_release_active') and sha(target)==m['beforeHtmlSha256'],'WINDOW_CHANGED')
    record['status']='activating'; state['shared_release_active']=True; state['window']=record; state['updated_at']=now(); save(COORD,state); opened=True
    print('Installing additive sales-order assets; original HTML remains live',flush=True)
    for x in files:
        if x['relative']!='index.html' and not (PUBLIC/x['relative']).exists(): atomic(PUBLIC/x['relative'],(ROOT/'candidate'/x['relative']).read_bytes())
    def verify(x):
        check,body=get('https://admin.51dianzi.com/'+x['relative']); require(check['sha256']==x['sha256'] and not body.lstrip().lower().startswith(b'<!doctype html'),'PUBLIC_ASSET_FAILED'); return check
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: checks=list(pool.map(verify,[x for x in files if x['relative']!='index.html']))
    require(sha(target)==m['beforeHtmlSha256'],'FINAL_CAS_FAILED'); atomic(target,(ROOT/'candidate/index.html').read_bytes()); switched=True
    health=[]
    for url in ['https://admin.51dianzi.com/login','https://admin.51dianzi.com/workbench/orders','https://admin.51dianzi.com/workbench/outbound','https://admin.51dianzi.com/workbench/inquiries']:
        check,_=get(url); require(check['sha256']==html['sha256'],'PUBLIC_HTML_FAILED'); health.append(check)
    health.append(get('https://www.51dianzi.com/')[0]); require(processes()==before,'PROCESS_CHANGED')
    for x in protected: require(sha(x['path'])==x['sha256'],'PROTECTED_FILE_CHANGED')
    for x in m['baselineAssets']: require(sha(PUBLIC/x['relative'])==x['sha256'],'OLD_ASSET_CHANGED')
    require(sha(target)==html['sha256'],'FINAL_HTML_CHANGED')
    state=json.loads(COORD.read_text()); require(state.get('window',{}).get('owner_task')==TASK,'WINDOW_OWNERSHIP_LOST')
    record.update(status='verified',closedAtUtc=now(),receipt=str(ROOT/'verified.json')); state['shared_release_active']=False; state['window']=record; state.setdefault('window_history',[]).append(record); state['updated_at']=now(); save(COORD,state)
    receipt={'status':'verified','atUtc':now(),'htmlSha256':html['sha256'],'files':files,'publicAssets':checks,'health':health,'sourceTests':m['sourceTestCount'],'actualUITests':len(ui['results']),'allProtectedFilesUnchanged':True,'allProcessesUnchanged':True,'oldAssetsUnchanged':True,'backendChanges':0,'databaseOperations':0,'permissionChanges':0,'processReloads':0,'loggedInOrderMutationTested':False}
    save(ROOT/'verified.json',receipt); print(json.dumps({'status':'verified','receipt':str(ROOT/'verified.json'),'files':5}))
except BaseException as error:
    if isinstance(error,SystemExit) and args.rollback: raise
    restored=False
    if switched and sha(target)==html['sha256'] and sha(ROOT/'index-before.html')==m['beforeHtmlSha256']:
        atomic(target,(ROOT/'index-before.html').read_bytes()); restored=True
    if opened:
        state=json.loads(COORD.read_text())
        if state.get('window',{}).get('owner_task')==TASK:
            record.update(status='failed',closedAtUtc=now()); state['shared_release_active']=False; state['window']=record; state.setdefault('window_history',[]).append(record); save(COORD,state)
    failure={'status':'failed','reason':str(error),'exactHtmlRollback':restored,'atUtc':now()}; save(ROOT/'failed.json',failure); print(json.dumps(failure)); raise SystemExit(1)
finally:
    for f in reversed(locks): fcntl.flock(f,fcntl.LOCK_UN); f.close()
