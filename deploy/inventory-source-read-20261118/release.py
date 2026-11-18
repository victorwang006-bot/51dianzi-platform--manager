#!/usr/bin/env python3
"""Pinned native read-side delta + additive UI assets. No business/permission DML."""
import argparse, base64, datetime, fcntl, hashlib, json, os, pathlib, stat, subprocess, time, urllib.request, uuid
OWNER='WJQ7iBxDiifmPZ8w6QPWZp'
PUBLIC=pathlib.Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
FRONT=pathlib.Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js')
COORD=pathlib.Path('/opt/ops/51-project-release-coordination-20261027.json')
ROOT=pathlib.Path('/opt/ops/20261118-inventory-source-read-WJQ7iBxD')
LOCKS=['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']
HEALTH='http://127.0.0.1:3000/api/trpc/system.health?input=%7B%22json%22%3A%7B%22timestamp%22%3A0%7D%7D'
def need(ok,message):
    if not ok:raise RuntimeError(message)
def sha(data):return hashlib.sha256(data).hexdigest()
def enc(value):return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(path,before,after):
    need(path.read_bytes()==before,'CAS_DRIFT '+str(path));s=path.stat();tmp=path.parent/('.source-read-'+uuid.uuid4().hex);fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,stat.S_IMODE(s.st_mode))
    try:
        with os.fdopen(fd,'wb') as f:os.fchown(f.fileno(),s.st_uid,s.st_gid);f.write(after);f.flush();os.fsync(f.fileno())
        need(path.read_bytes()==before,'LAST_MOMENT_CAS_DRIFT');os.replace(tmp,path)
        d=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(d)
        finally:os.close(d)
    finally:
        if tmp.exists():tmp.unlink()
def processes():
    data=json.loads(subprocess.check_output(['pm2','jlist']))
    return sorted([{'id':p['pm_id'],'name':p['name'],'pid':p['pid'],'status':p['pm2_env']['status'],'script':p['pm2_env']['pm_exec_path'],'cwd':p['pm2_env']['pm_cwd'],'mode':p['pm2_env']['exec_mode']}for p in data],key=lambda p:p['id'])
def protection(manifest):
    for r in manifest['protectedFiles']:need(sha(pathlib.Path(r['path']).read_bytes())==r['sha256'],'PROTECTED_FILE_DRIFT '+r['path'])
def health():
    script=pathlib.Path(__file__).with_name('health-readonly.cjs')
    data=json.loads(subprocess.check_output(['node',str(script)],timeout=15))
    need(data.get('httpStatus')==200 and data.get('ok') is True,'AUTHORIZED_FRONT_HEALTH_SHAPE')
def roll(before):
    target=[p for p in before if p['name']=='dianzi51'];need(len(target)==4 and all(p['script']==str(FRONT) and p['mode']=='cluster_mode' for p in target),'EXACT_FOUR_FRONT_API_TARGETS')
    print('ROLL_ONLY_FOUR_FRONT_API_INSTANCES',flush=True);subprocess.run(['pm2','reload','dianzi51'],check=True,timeout=120,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    deadline=time.monotonic()+45
    while True:
        live=processes();need([p for p in live if p['name']!='dianzi51']==[p for p in before if p['name']!='dianzi51'],'NON_TARGET_PROCESSES_DRIFT')
        a=[p for p in live if p['name']=='dianzi51'];ready=len(a)==4 and {p['id']for p in a}=={p['id']for p in target} and all(p['status']=='online' and p['pid']>0 and p['script']==str(FRONT) and p['cwd']==target[0]['cwd']for p in a)
        if ready:
            try:health();return live
            except (OSError,RuntimeError):pass
        need(time.monotonic()<deadline,'FRONT_ROLL_READINESS_TIMEOUT');time.sleep(1)
def reconstruct(before,records):
    after=before
    for r in reversed(records):
        need(sha(before[r['byteStart']:r['byteEnd']])==r['oldSha256'],'DELTA_PREIMAGE_HASH');need(before[r['byteStart']:r['byteEnd']]==base64.b64decode(r['oldBase64']),'DELTA_PREIMAGE_BYTES')
        new=base64.b64decode(r['newBase64']);need(sha(new)==r['newSha256'],'DELTA_NEW_HASH');after=after[:r['byteStart']]+new+after[r['byteEnd']:]
    inverse=after
    for r in reversed(records):
        need(inverse[r['newByteStart']:r['newByteEnd']]==base64.b64decode(r['newBase64']),'DELTA_INVERSE_PREIMAGE');inverse=inverse[:r['newByteStart']]+base64.b64decode(r['oldBase64'])+inverse[r['newByteEnd']:]
    need(inverse==before,'EXACT_DELTA_INVERSE');return after
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--package',required=True);parser.add_argument('--manifest-sha256',required=True);parser.add_argument('--apply',action='store_true');a=parser.parse_args();pack=pathlib.Path(a.package).resolve();mb=(pack/'release-manifest.json').read_bytes();need(sha(mb)==a.manifest_sha256,'MANIFEST_PIN');m=json.loads(mb)
    need(m['ownerTask']==OWNER and m['scope']=='inventory-source-read-only' and m['databaseWrites']==0 and m['adminApiWrites']==0 and m['targetProcessName']=='dianzi51','EXACT_SCOPE')
    need(len(m['assets'])==2 and m['apiNativeHunks']==17 and m['uiNativeHunksPerAsset']==4,'FIXED_REVIEWED_NATIVE_SCOPE')
    required=m['requiredProtectedFiles'];protected={r['path']:r['sha256']for r in m['protectedFiles']}
    need(len(protected)==len(m['protectedFiles']) and len(protected)>=m['minimumProtectedFileCount'] and all(protected.get(r['path'])==r['sha256']for r in required),'COMPLETE_REQUIRED_PROTECTION')
    html_before=(pack/'baseline-index.html').read_bytes();html_after=(pack/'index.html').read_bytes();need(sha(html_before)==m['beforeHtmlSha256'] and sha(html_after)==m['afterHtmlSha256'],'HTML_PACKAGE_PIN')
    for r in m['assets']:
        need(r['relative'].startswith('assets/BusinessWorkbenchPage-inventory-source-read-') and '..' not in pathlib.PurePosixPath(r['relative']).parts,'ASSET_PATH');need(sha((pack/r['relative']).read_bytes())==r['sha256'],'ASSET_PACKAGE_PIN')
    records=json.loads((pack/'api-delta.json').read_bytes())['records'];need(len(records)==17,'API_HUNK_COUNT')
    handles=[]
    try:
        for p in LOCKS:
            f=open(p,'r+b');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);handles.append(f)
        coord_before=COORD.read_bytes();coord=json.loads(coord_before);need(coord.get('shared_release_active') is False,'SHARED_RELEASE_BUSY');need((PUBLIC/'index.html').read_bytes()==html_before,'CURRENT_HTML_DRIFT_REBUILD')
        api_before=FRONT.read_bytes();need(sha(api_before)==m['beforeApiSha256'],'CURRENT_API_DRIFT_REBUILD');api_after=reconstruct(api_before,records);need(sha(api_after)==m['afterApiSha256'],'RECONSTRUCTED_API_FINAL_PIN');protection(m);before=processes();need(before==m['beforeProcesses'],'PINNED_PROCESS_FRONTIMAGE_DRIFT');need(all(p['status']=='online' and p['pid']>0 for p in before),'ALL_CURRENT_PROCESSES_ONLINE');health()
        # Syntax check only: never initialize the server or execute its bundle here.
        staged=pack/'staged-front-index.mjs'
        if staged.exists():need(staged.read_bytes()==api_after,'PREEXISTING_STAGE_DRIFT')
        else:staged.write_bytes(api_after)
        subprocess.run(['node','--check',str(staged)],check=True,capture_output=True)
        if not a.apply:print(json.dumps({'status':'PREFLIGHT_PASS','activeWrites':0,'manifestSha256':sha(mb),'apiSha256':sha(api_after)}));return
        need(not ROOT.exists(),'OWN_NAMESPACE_EXISTS_NO_REPLAY');ROOT.mkdir(mode=0o700);(ROOT/'manifest.json').write_bytes(mb);(ROOT/'before-api.js').write_bytes(api_before);(ROOT/'before-index.html').write_bytes(html_before)
        window={'owner_task':OWNER,'task':OWNER,'nonce':uuid.uuid4().hex,'manifestSha256':sha(mb),'status':'applying','opsDir':str(ROOT),'scope':m['scope'],'openedAtUtc':now()};coord['shared_release_active']=True;coord['window']=window;coord['updated_at']=now();owned=enc(coord);atomic(COORD,coord_before,owned);api_changed=False;html_changed=False;added=[];post=before;status='recovery-required'
        try:
            for r in m['assets']:
                path=PUBLIC/r['relative'];data=(pack/r['relative']).read_bytes()
                if path.exists():need(path.read_bytes()==data,'PREEXISTING_ADDITIVE_ASSET_DRIFT')
                else:
                    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
                    with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
                    added.append(r['relative'])
                need(sha(path.read_bytes())==r['sha256'],'ADDITIVE_ASSET_WRITE_PIN')
            need(COORD.read_bytes()==owned and processes()==before,'PRE_SWITCH_AUTHORITY_DRIFT');protection(m);atomic(FRONT,api_before,api_after);api_changed=True;post=roll(before);protection(m);need(sha(FRONT.read_bytes())==m['afterApiSha256'],'AFTER_API_ROLL_DRIFT');atomic(PUBLIC/'index.html',html_before,html_after);html_changed=True
            health();protection(m);need((PUBLIC/'index.html').read_bytes()==html_after and FRONT.read_bytes()==api_after,'POST_SWITCH_BYTES');need(processes()==post,'POST_SWITCH_PROCESSES_DRIFT');status='verified';print('SOURCE_READ_API_AND_UI_VERIFIED',flush=True)
        except BaseException as error:
            (ROOT/'error.txt').write_text(str(error)+'\n')
            try:
                if html_changed:
                    current=(PUBLIC/'index.html').read_bytes();need(current in (html_before,html_after),'FOREIGN_HTML_PREVENTS_SAFE_RECOVERY')
                    if current==html_after:atomic(PUBLIC/'index.html',html_after,html_before)
                if api_changed:
                    current=FRONT.read_bytes();need(current in (api_before,api_after),'FOREIGN_API_PREVENTS_SAFE_RECOVERY')
                    if current==api_after:atomic(FRONT,api_after,api_before)
                    post=roll(before)
                need(FRONT.read_bytes()==api_before and (PUBLIC/'index.html').read_bytes()==html_before,'RECOVERY_PREIMAGE_BYTES_NOT_RESTORED')
                protection(m);health();need([p for p in processes()if p['name']!='dianzi51']==[p for p in before if p['name']!='dianzi51'],'RECOVERY_NON_TARGET_DRIFT')
                status='rolled-back'
            except BaseException as recovery_error:
                status='recovery-required';(ROOT/'recovery-error.txt').write_text(str(recovery_error)+'\n')
            raise
        finally:
            if COORD.read_bytes()==owned:
                closed=json.loads(owned);complete=status in ('verified','rolled-back');window.update(status=status,receipt=str(ROOT/'receipt.json'),needsOperatorRecovery=not complete)
                if complete:window['closedAtUtc']=now()
                closed['window']=window;closed['shared_release_active']=not complete;closed.setdefault('window_history',[]).append(window);closed['updated_at']=now();atomic(COORD,owned,enc(closed))
            receipt={'status':status,'ownerTask':OWNER,'manifestSha256':sha(mb),'frontApiSha256':sha(FRONT.read_bytes()),'htmlSha256':sha((PUBLIC/'index.html').read_bytes()),'assets':m['assets'],'apiNativeHunks':17,'databaseWrites':0,'adminApiWrites':0,'nonTargetProcessesUnchanged':[p for p in processes()if p['name']!='dianzi51']==[p for p in before if p['name']!='dianzi51'],'closedAtUtc':now()};(ROOT/'receipt.json').write_bytes(enc(receipt))
        print(json.dumps(receipt,ensure_ascii=False))
    finally:
        for f in reversed(handles):fcntl.flock(f,fcntl.LOCK_UN);f.close()
if __name__=='__main__':main()
