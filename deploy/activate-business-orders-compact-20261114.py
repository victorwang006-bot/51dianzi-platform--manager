#!/usr/bin/env python3
"""Guarded additive frontend-only correction. No DB or API mutations/reloads."""
import argparse, concurrent.futures, datetime, fcntl, hashlib, json, os
from pathlib import Path
import subprocess, tempfile, urllib.request

TASK = 'CKSZQ7sVc7tADM21c3LWpu'
ROOT = Path('/opt/ops/20261114-business-orders-compact-CKSZQ7s')
PUBLIC = Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
def require(ok, text):
    if not ok: raise RuntimeError(text)
def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(path, data, mode=None):
    path = Path(path)
    previous = path.stat() if path.exists() else None
    fd, tmp = tempfile.mkstemp(prefix='.sales-template-', dir=path.parent)
    try:
        os.fchmod(fd, mode if mode is not None else (previous.st_mode & 0o777 if previous else 0o644))
        if previous: os.fchown(fd, previous.st_uid, previous.st_gid)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
def save(path, obj): atomic(path, (json.dumps(obj, ensure_ascii=False, indent=2)+'\n').encode(), 0o600)
def processes():
    rows = json.loads(subprocess.check_output(['pm2', 'jlist'], timeout=30))
    return [{'id': r['pm_id'], 'name': r['name'], 'pid': r['pid'], 'status': r['pm2_env']['status'],
             'script': r['pm2_env']['pm_exec_path'], 'cwd': r['pm2_env']['pm_cwd'],
             'environmentHash': hashlib.sha256(json.dumps(r['pm2_env'].get('env', {}), sort_keys=True).encode()).hexdigest()} for r in rows]
def get(url):
    req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0', 'Cache-Control':'no-cache', 'Accept-Encoding':'identity'})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read(); require(response.status == 200, 'HTTP_FAILED_'+url)
        return {'url':url, 'status':response.status, 'sha256':hashlib.sha256(body).hexdigest()}, body

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true'); parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    manifest = json.loads((ROOT/'manifest.json').read_text())
    files = manifest['files']; target = PUBLIC/'index.html'
    require(manifest['ownerTask'] == TASK and len(files) == 4, 'EXACT_SCOPE_REQUIRED')
    require({x['relative'] for x in files} == {'index.html', *manifest['coreAssetPaths']}, 'ALLOWLIST_FAILED')
    require(len(manifest['coreAssetPaths']) == 3 and sum(x.endswith('.js') for x in manifest['coreAssetPaths']) == 3 and sum(x.endswith('.css') for x in manifest['coreAssetPaths']) == 0, 'ASSET_COUNT_FAILED')
    for item in files:
        rel = Path(item['relative'])
        require(not rel.is_absolute() and '..' not in rel.parts and (item['relative']=='index.html' or rel.parts[0]=='assets'), 'UNSAFE_PATH')
        require((PUBLIC/rel).resolve().is_relative_to(PUBLIC.resolve()), 'OUTSIDE_PUBLIC')
        require(sha(ROOT/'candidate'/rel) == item['sha256'], 'CANDIDATE_CHANGED')
    require(sha(ROOT/Path(__file__).name) == manifest['driverSha256'], 'DRIVER_CHANGED')
    for name, expected in manifest['evidenceHashes'].items(): require(sha(ROOT/name) == expected, 'EVIDENCE_CHANGED_'+name)
    proof = json.loads((ROOT/'candidate-proof.json').read_text())
    require(proof['status']=='PASS' and proof['onlyGlobalBusinessUIChanged'] and proof['unrelatedNativeBytesUnchanged'] and proof['mallBytesUnchanged'] and proof['embeddedBehaviorUnchanged'] and proof['scopeAndArchiveUnchanged'], 'PATCH_PROOF_REQUIRED')
    require(manifest['tscPassed'] and manifest['sourceTestFailures']==0 and manifest['reviewPassed'], 'VALIDATION_REQUIRED')
    html = next(item for item in files if item['relative']=='index.html')
    if not args.apply and not args.rollback:
        print(json.dumps({'planOnly':True,'files':4,'backendChanges':0,'databaseOperations':0,'processReloads':0})); return
    locks=[]; opened=False; switched=False
    record={'owner_task':TASK,'status':'preflight','scope':'global business compact eight columns; embedded and mall unchanged; frontend only','openedAtUtc':now()}
    try:
        for name in ['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']:
            lock=open(name,'a+'); fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB); locks.append(lock)
        state=json.loads(COORD.read_text()); require(not state.get('shared_release_active'),'OTHER_RELEASE_ACTIVE')
        if args.rollback:
            require(sha(target)==html['sha256'] and sha(ROOT/'index-before.html')==manifest['beforeHtmlSha256'],'ROLLBACK_CAS_FAILED')
            atomic(target,(ROOT/'index-before.html').read_bytes())
            save(ROOT/'rolled-back.json',{'status':'rolled-back','atUtc':now(),'restoredHtmlSha256':sha(target)})
            print('Exact HTML rollback complete'); return
        require(not (ROOT/'verified.json').exists(),'ALREADY_VERIFIED')
        require(sha(target)==manifest['beforeHtmlSha256'],'BASELINE_CAS_FAILED')
        before=processes(); require(any(x['name']=='dianzi51-admin' and x['status']=='online' for x in before),'ADMIN_NOT_ONLINE')
        for item in manifest['protectedFiles']: require(sha(item['path'])==item['sha256'],'PROTECTED_BASELINE_CHANGED')
        for item in manifest['baselineAssets']: require(sha(PUBLIC/item['relative'])==item['sha256'],'OLD_ASSET_CHANGED')
        for dependency in manifest['dependencies']:
            require(dependency.startswith('/assets/'),'DEPENDENCY_PREFIX_FAILED')
            require((PUBLIC/dependency.lstrip('/')).is_file() or dependency.lstrip('/') in manifest['coreAssetPaths'],'DEPENDENCY_MISSING_'+dependency)
        for item in files:
            if item['relative']!='index.html' and (PUBLIC/item['relative']).exists(): require(sha(PUBLIC/item['relative'])==item['sha256'],'ASSET_OVERWRITE_REFUSED')
        save(ROOT/'process-before.json',before); atomic(ROOT/'index-before.html',target.read_bytes(),0o600)
        front_before=get('https://www.51dianzi.com/')[0]
        check,_=get('https://admin.51dianzi.com/workbench/orders');require(check['sha256']==manifest['beforeHtmlSha256'],'PUBLIC_BASELINE_MISMATCH')
        state=json.loads(COORD.read_text());require(not state.get('shared_release_active') and sha(target)==manifest['beforeHtmlSha256'],'WINDOW_CHANGED')
        record['status']='activating';state['shared_release_active']=True;state['window']=record;state['updated_at']=now();save(COORD,state);opened=True
        print('Installing isolated frontend correction; old HTML still active',flush=True)
        for item in files:
            if item['relative']!='index.html' and not (PUBLIC/item['relative']).exists(): atomic(PUBLIC/item['relative'],(ROOT/'candidate'/item['relative']).read_bytes())
        def verify(item):
            check,body=get('https://admin.51dianzi.com/'+item['relative'])
            require(check['sha256']==item['sha256'] and not body.lstrip().lower().startswith(b'<!doctype html'),'PUBLIC_ASSET_FAILED')
            return check
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            checks=list(pool.map(verify,[item for item in files if item['relative']!='index.html']))
        require(sha(target)==manifest['beforeHtmlSha256'],'FINAL_CAS_FAILED');atomic(target,(ROOT/'candidate/index.html').read_bytes());switched=True
        health=[]
        for url in ['https://admin.51dianzi.com/','https://admin.51dianzi.com/login','https://admin.51dianzi.com/workbench/customers','https://admin.51dianzi.com/workbench/orders?orderSource=business','https://admin.51dianzi.com/workbench/orders?orderSource=mall','https://admin.51dianzi.com/workbench/inquiries']:
            check,_=get(url);require(check['sha256']==html['sha256'],'PUBLIC_HTML_FAILED');health.append(check)
        front_after=get('https://www.51dianzi.com/')[0];require(front_after['sha256']==front_before['sha256'],'FRONT_CHANGED');health.append(front_after)
        require(processes()==before,'PROCESS_CHANGED')
        for item in manifest['protectedFiles']:require(sha(item['path'])==item['sha256'],'PROTECTED_FILE_CHANGED')
        for item in manifest['baselineAssets']:require(sha(PUBLIC/item['relative'])==item['sha256'],'OLD_ASSET_CHANGED')
        state=json.loads(COORD.read_text());require(state.get('window',{}).get('owner_task')==TASK,'WINDOW_OWNERSHIP_LOST')
        record.update(status='verified',closedAtUtc=now(),receipt=str(ROOT/'verified.json'))
        state['shared_release_active']=False;state['window']=record;state.setdefault('window_history',[]).append(record);state['updated_at']=now();save(COORD,state)
        receipt={'status':'verified','atUtc':now(),'htmlSha256':html['sha256'],'files':files,'publicAssets':checks,'health':health,'globalBusinessCompact':True,'embeddedBehaviorUnchanged':True,'mallBytesUnchanged':True,'allProtectedFilesUnchanged':True,'allProcessesUnchanged':True,'oldAssetsUnchanged':True,'backendChanges':0,'databaseOperations':0,'permissionChanges':0,'processReloads':0,'productionRecordWrites':0,'loggedInBrowserAcceptancePerformed':False}
        save(ROOT/'verified.json',receipt);print(json.dumps({'status':'verified','receipt':str(ROOT/'verified.json'),'files':4}))
    except BaseException as error:
        restored=False
        if switched and sha(target)==html['sha256'] and sha(ROOT/'index-before.html')==manifest['beforeHtmlSha256']:
            atomic(target,(ROOT/'index-before.html').read_bytes());restored=True
        if opened:
            state=json.loads(COORD.read_text())
            if state.get('window',{}).get('owner_task')==TASK:
                record.update(status='failed',closedAtUtc=now());state['shared_release_active']=False;state['window']=record;state.setdefault('window_history',[]).append(record);save(COORD,state)
        failure={'status':'failed','reason':str(error),'exactHtmlRollback':restored,'atUtc':now()};save(ROOT/'failed.json',failure);print(json.dumps(failure));raise SystemExit(1)
    finally:
        for lock in reversed(locks):fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
if __name__=='__main__':main()
