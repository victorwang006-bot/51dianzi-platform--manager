#!/usr/bin/env python3
"""Activate one exact BFF-only archive filter; never writes order/finance/stock tables."""
import pathlib,json,hashlib,argparse,subprocess,fcntl,os,tempfile,datetime,time,urllib.request
ROOT=pathlib.Path('/opt/ops/20261113-test-order-archive-4kOS3RBC')
TARGET=pathlib.Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js')
COORD=pathlib.Path('/opt/ops/51-project-release-coordination-20261027.json')
TASK='4kOS3RBCdJO2Kn7BhbvH6T'
def require(ok,msg):
    if not ok: raise RuntimeError(msg)
def sha(p): return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(p,data,mode=None):
    p=pathlib.Path(p);old=p.stat() if p.exists() else None;fd,tmp=tempfile.mkstemp(prefix='.test-archive-',dir=p.parent)
    try:
        os.fchmod(fd,mode if mode is not None else old.st_mode&0o777 if old else 0o600)
        if old: os.fchown(fd,old.st_uid,old.st_gid)
        with os.fdopen(fd,'wb') as f: f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(tmp,p)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def save(name,obj): atomic(ROOT/name,(json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode(),0o600)
def processes():
    rows=json.loads(subprocess.check_output(['pm2','jlist'],timeout=30));return [{'id':r['pm_id'],'name':r['name'],'pid':r['pid'],'status':r['pm2_env']['status'],'cwd':r['pm2_env']['pm_cwd'],'script':r['pm2_env']['pm_exec_path'],'environmentHash':hashlib.sha256(json.dumps(r['pm2_env'].get('env',{}),sort_keys=True).encode()).hexdigest()} for r in rows]
def health():
    checks=[]
    for url in ['https://admin.51dianzi.com/api/trpc/auth.me','https://admin.51dianzi.com/workbench/orders','https://www.51dianzi.com/']:
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Accept-Encoding':'identity','Cache-Control':'no-cache'})
        with urllib.request.urlopen(req,timeout=20) as r:
            body=r.read();require(r.status==200,'HTTP_HEALTH_FAILED');checks.append({'url':url,'status':r.status,'sha256':hashlib.sha256(body).hexdigest()})
            if '/api/trpc/' in url:require(b'"result"' in body and not body.lstrip().startswith(b'<'),'API_NOT_JSON')
    return checks
def reload_admin():
    subprocess.run(['pm2','reload','191'],check=True,capture_output=True,timeout=60)
    for _ in range(30):
        rows=processes();a=next((x for x in rows if x['id']==191),None)
        if a and a['status']=='online': return
        time.sleep(1)
    raise RuntimeError('ADMIN_RELOAD_NOT_READY')
p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--rollback',action='store_true');args=p.parse_args()
m=json.loads((ROOT/'api-manifest.json').read_text());require(m['ownerTask']==TASK and m['target']==str(TARGET),'MANIFEST_SCOPE_FAILED')
require(sha(ROOT/'admin-index-candidate.js')==m['candidateSha256'],'CANDIDATE_CHANGED');require(sha(ROOT/pathlib.Path(__file__).name)==m['driverSha256'],'DRIVER_CHANGED')
for name,expected in m['evidenceHashes'].items():require(sha(ROOT/name)==expected,'EVIDENCE_CHANGED_'+name)
proof=json.loads((ROOT/'api-build-proof.json').read_text());test=json.loads((ROOT/'actual-api-tests.json').read_text())
require(proof['exactInverse'] and proof['allNonpatchBytesUnchanged'] and proof['originalAuthorizationUnchanged'] and proof['originalPlatformCommandUnchanged'],'ISOLATION_PROOF_FAILED')
require(test['status']=='PASS' and test['actualCandidatePatchBytesExecuted'] and len(test['results'])>=10 and test['candidateSha256']==m['candidateSha256'] and m['tscPassed'] and m['sourceTestFailures']==0,'TESTS_REQUIRED')
if not args.apply and not args.rollback:print(json.dumps({'planOnly':True,'apiFiles':1,'onlyReload':'dianzi51-admin','originalDatabaseWrites':0}));raise SystemExit()
locks=[];opened=False;switched=False;before=None;protected=[];record={'owner_task':TASK,'status':'preflight','scope':'BFF test archive exact tuple filter only; one admin process reload','openedAtUtc':now()}
try:
    for name in ['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']:
        f=open(name,'a+');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
    state=json.loads(COORD.read_text());require(not state.get('shared_release_active'),'OTHER_RELEASE_ACTIVE')
    if args.rollback:
        require(sha(TARGET)==m['candidateSha256'] and sha(ROOT/'admin-index-before.js')==m['baselineSha256'],'ROLLBACK_CAS_FAILED')
        atomic(TARGET,(ROOT/'admin-index-before.js').read_bytes());reload_admin();save('api-rolled-back.json',{'status':'rolled-back','atUtc':now(),'sha256':sha(TARGET),'metadataRetained':True});print('exact BFF API rollback complete; metadata retained');raise SystemExit()
    receipt=json.loads((ROOT/'archive-apply-receipt.json').read_text());require(receipt['status']=='archived' and receipt['registryRowsInserted']==10 and receipt['originalDatabaseWrites']==0 and receipt['allOriginalTablesUnchanged'],'EXACT_ARCHIVE_RECEIPT_REQUIRED')
    require(not (ROOT/'api-verified.json').exists() and sha(TARGET)==m['baselineSha256'],'ALREADY_VERIFIED_OR_BASELINE_CHANGED')
    before=processes();a=next(x for x in before if x['id']==191);require(a['name']=='dianzi51-admin' and a['status']=='online' and a['script']==str(TARGET),'ADMIN_IDENTITY_FAILED')
    for x in m['protectedFiles']:require(sha(x['path'])==x['sha256'],'PROTECTED_BASELINE_CHANGED')
    protected=m['protectedFiles'];save('api-process-before.json',before);atomic(ROOT/'admin-index-before.js',TARGET.read_bytes(),0o600)
    subprocess.run(['node','--check',str(ROOT/'admin-index-candidate.js')],check=True,capture_output=True,timeout=30);health()
    state=json.loads(COORD.read_text());require(not state.get('shared_release_active') and sha(TARGET)==m['baselineSha256'],'FINAL_CAS_FAILED');record['status']='activating';state['shared_release_active']=True;state['window']=record;state['updated_at']=now();atomic(COORD,(json.dumps(state,ensure_ascii=False,indent=2)+'\n').encode());opened=True
    atomic(TARGET,(ROOT/'admin-index-candidate.js').read_bytes());switched=True;reload_admin();checks=health();after=processes();require(len(after)==len(before),'PROCESS_SET_CHANGED')
    for x in before:
        y=next(z for z in after if z['id']==x['id'])
        if x['id']==191:require({k:v for k,v in x.items() if k!='pid'}=={k:v for k,v in y.items() if k!='pid'},'ADMIN_IDENTITY_OR_ENV_CHANGED')
        else:require(x==y,'UNRELATED_PROCESS_CHANGED')
    for x in protected:require(sha(x['path'])==x['sha256'],'PROTECTED_FILE_CHANGED')
    require(sha(TARGET)==m['candidateSha256'],'FINAL_API_CHANGED');require(next(x for x in checks if '/workbench/orders' in x['url'])['sha256']==next(x['sha256'] for x in protected if x['path']=='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public/index.html'),'PUBLIC_FRONTEND_CHANGED')
    state=json.loads(COORD.read_text());require(state.get('window',{}).get('owner_task')==TASK,'WINDOW_OWNERSHIP_LOST');record.update(status='verified',closedAtUtc=now(),receipt=str(ROOT/'api-verified.json'));state['shared_release_active']=False;state['window']=record;state.setdefault('window_history',[]).append(record);atomic(COORD,(json.dumps(state,ensure_ascii=False,indent=2)+'\n').encode())
    result={'status':'verified','atUtc':now(),'candidateSha256':m['candidateSha256'],'onlyAdminProcessReloaded':True,'frontAPIAndFrontendUnchanged':True,'allUnrelatedProcessesUnchanged':True,'originalAuthorizationUnchanged':True,'originalDatabaseWrites':0,'metadataArchivedCount':10,'sourceTests':m['sourceTestCount'],'actualAPITests':len(test['results']),'health':checks,'loggedInOrderMutationTested':False};save('api-verified.json',result);print(json.dumps({'status':'verified','receipt':str(ROOT/'api-verified.json')}))
except BaseException as error:
    if isinstance(error,SystemExit) and args.rollback:raise
    restored=False;rollback_reload_error=None
    if switched and sha(TARGET)==m['candidateSha256'] and sha(ROOT/'admin-index-before.js')==m['baselineSha256']:
        atomic(TARGET,(ROOT/'admin-index-before.js').read_bytes());restored=True
        try:reload_admin()
        except Exception as rollback_error:rollback_reload_error=str(rollback_error)
    if opened:
        state=json.loads(COORD.read_text())
        if state.get('window',{}).get('owner_task')==TASK:
            record.update(status='failed',closedAtUtc=now());state['shared_release_active']=False;state['window']=record;state.setdefault('window_history',[]).append(record);atomic(COORD,(json.dumps(state,ensure_ascii=False,indent=2)+'\n').encode())
    failure={'status':'failed','reason':str(error),'exactAPIRollback':restored,'metadataRetained':True,'rollbackReloadError':rollback_reload_error,'atUtc':now()};save('api-failed.json',failure);print(json.dumps(failure));raise SystemExit(1)
finally:
    for f in reversed(locks):fcntl.flock(f,fcntl.LOCK_UN);f.close()
