#!/usr/bin/env python3
"""Static customer-completion release only; no API, DB, configuration or process writes."""
import argparse, datetime, fcntl, hashlib, json, os, pathlib, stat, subprocess, uuid
OWNER = 'WJQ7iBxDiifmPZ8w6QPWZp'
PUBLIC = pathlib.Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
COORD = pathlib.Path('/opt/ops/51-project-release-coordination-20261027.json')
ROOT = pathlib.Path('/opt/ops/20261118-customer-completion-WJQ7iBxD')
LOCKS = ['/var/lock/dianzi51-public-deploy.lock', '/var/lock/dianzi51-production-code.lock']
def sha(data): return hashlib.sha256(data).hexdigest()
def need(ok, message):
    if not ok: raise RuntimeError(message)
def encode(value): return (json.dumps(value, ensure_ascii=False, indent=2)+'\n').encode()
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(path, before, after):
    need(path.read_bytes() == before, 'FULL_BYTES_CAS_DRIFT '+str(path))
    info=path.stat(); temp=path.parent/('.customer-completion-'+uuid.uuid4().hex)
    fd=os.open(temp, os.O_WRONLY|os.O_CREAT|os.O_EXCL, stat.S_IMODE(info.st_mode))
    try:
        with os.fdopen(fd,'wb') as f:
            os.fchown(f.fileno(),info.st_uid,info.st_gid); f.write(after); f.flush(); os.fsync(f.fileno())
        need(path.read_bytes() == before, 'LAST_MOMENT_CAS_DRIFT '+str(path))
        os.replace(temp,path)
        d=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try: os.fsync(d)
        finally: os.close(d)
    finally:
        if temp.exists(): temp.unlink()
def process_snapshot():
    data=json.loads(subprocess.check_output(['pm2','jlist']))
    return sorted([{'id':x['pm_id'],'pid':x['pid'],'name':x['name'], 'status':x['pm2_env']['status'], 'script':x['pm2_env']['pm_exec_path'], 'cwd':x['pm2_env']['pm_cwd']} for x in data],key=lambda x:x['id'])
def main():
    p=argparse.ArgumentParser();p.add_argument('--package',required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
    package=pathlib.Path(a.package).resolve();mb=(package/'release-manifest.json').read_bytes();need(sha(mb)==a.manifest_sha256,'MANIFEST_PIN_DRIFT');m=json.loads(mb)
    need(m['ownerTask']==OWNER and m['scope']=='static-customer-completion-only','EXACT_RELEASE_SCOPE')
    need(m['apiWrites']==0 and m['databaseWrites']==0 and m['processReloads']==0,'NO_BACKEND_SCOPE')
    need(m.get('protectedApisPendingOwnerFill') is False and len(m['protectedApis'])==2,'FINAL_API_PROTECTION_PINS_REQUIRED')
    before=(package/'baseline/index.html').read_bytes();after=(package/'candidate/index.html').read_bytes()
    need(sha(before)==m['beforeHtmlSha256'] and sha(after)==m['afterHtmlSha256'],'HTML_PACKAGE_PIN')
    for r in m['assets']:
        need(r['relative'].startswith('assets/BusinessWorkbenchPage-customer-completion-') and '..' not in pathlib.PurePosixPath(r['relative']).parts,'ASSET_WHITELIST')
        need(sha((package/'candidate'/r['relative']).read_bytes())==r['sha256'],'ASSET_PACKAGE_PIN')
    handles=[]
    try:
        for lock in LOCKS:
            f=open(lock,'r+b');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);handles.append(f)
        coord_before=COORD.read_bytes();coord=json.loads(coord_before);need(coord.get('shared_release_active') is False,'SHARED_RELEASE_BUSY')
        need((PUBLIC/'index.html').read_bytes()==before,'CURRENT_HTML_DRIFT_REBUILD_REQUIRED')
        for r in m['baselineAssets']:need(sha((PUBLIC/r['relative']).read_bytes())==r['sha256'],'OLD_WORKBENCH_DRIFT')
        for r in m['protectedApis']:need(sha(pathlib.Path(r['path']).read_bytes())==r['sha256'],'API_DRIFT_REBUILD_REQUIRED')
        processes=process_snapshot();need(all(x['status']=='online' and x['pid']>0 for x in processes),'ALL_PROCESSES_ONLINE')
        if not a.apply:
            print(json.dumps({'status':'PREFLIGHT_PASS','writes':0,'manifestSha256':sha(mb)}));return
        need(not ROOT.exists(),'OWNED_NAMESPACE_EXISTS_NO_REPLAY');ROOT.mkdir(mode=0o700)
        (ROOT/'manifest.json').write_bytes(mb);(ROOT/'before-index.html').write_bytes(before);(ROOT/'after-index.html').write_bytes(after)
        nonce=uuid.uuid4().hex;window={'owner_task':OWNER,'task':OWNER,'nonce':nonce,'attemptId':nonce,'manifestSha256':sha(mb),'status':'applying','opsDir':str(ROOT),'openedAtUtc':now(),'scope':'static customer completion; 2 additive JS and exact HTML maps; no API/DB/process changes'}
        coord['shared_release_active']=True;coord['window']=window;coord['updated_at']=now();owned=encode(coord)
        (ROOT/'coord-before.json').write_bytes(coord_before);(ROOT/'coord-owned.json').write_bytes(owned)
        added=[];html_changed=False
        atomic(COORD,coord_before,owned)
        try:
            for r in m['assets']:
                target=PUBLIC/r['relative'];data=(package/'candidate'/r['relative']).read_bytes()
                need(not target.exists(),'NEW_ASSET_ALREADY_EXISTS')
                fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
                with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
                added.append(r['relative']);need(sha(target.read_bytes())==r['sha256'],'NEW_ASSET_WRITE_PIN')
            need(COORD.read_bytes()==owned,'WINDOW_OWNERSHIP_LOST')
            for r in m['protectedApis']:need(sha(pathlib.Path(r['path']).read_bytes())==r['sha256'],'API_CHANGED_BEFORE_SWITCH')
            need(process_snapshot()==processes,'PROCESS_CHANGED_BEFORE_SWITCH')
            atomic(PUBLIC/'index.html',before,after);html_changed=True
            need((PUBLIC/'index.html').read_bytes()==after,'POST_SWITCH_HTML_DRIFT')
            for r in m['baselineAssets']:need(sha((PUBLIC/r['relative']).read_bytes())==r['sha256'],'OLD_ASSET_CHANGED')
            for r in m['protectedApis']:need(sha(pathlib.Path(r['path']).read_bytes())==r['sha256'],'API_CHANGED')
            need(process_snapshot()==processes,'PROCESS_CHANGED')
            status='verified'
        except BaseException as error:
            if html_changed and (PUBLIC/'index.html').read_bytes()==after:atomic(PUBLIC/'index.html',after,before)
            status='rolled-back';(ROOT/'error.txt').write_text(str(error)+'\n')
            raise
        finally:
            if COORD.read_bytes()==owned:
                closed=json.loads(owned);window.update(status=locals().get('status','recovery-required'),closedAtUtc=now(),receipt=str(ROOT/'receipt.json'));closed['window']=window;closed['shared_release_active']=False;closed.setdefault('window_history',[]).append(window);closed['updated_at']=now();atomic(COORD,owned,encode(closed))
            receipt={'status':locals().get('status','recovery-required'),'ownerTask':OWNER,'manifestSha256':sha(mb),'afterHtmlSha256':sha((PUBLIC/'index.html').read_bytes()),'addedAssets':added,'oldAssetsPreserved':True,'apiWrites':0,'databaseWrites':0,'processReloads':0,'processesUnchanged':process_snapshot()==processes,'closedAtUtc':now()};(ROOT/'receipt.json').write_bytes(encode(receipt))
        print(json.dumps(receipt,ensure_ascii=False))
    finally:
        for f in reversed(handles):fcntl.flock(f,fcntl.LOCK_UN);f.close()
if __name__=='__main__':main()
