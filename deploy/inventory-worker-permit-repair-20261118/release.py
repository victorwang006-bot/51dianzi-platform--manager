#!/usr/bin/env python3
"""Reconcile exactly two reviewed worker artifacts to a root-controlled permit.
Existing native queues may then process previously authorized uploads; no direct
business DML, no epoch changes, no API/HTML changes, no other worker changes.
"""
import argparse,base64,datetime,fcntl,hashlib,json,os,pathlib,stat,subprocess,time,uuid
OWNER='WJQ7iBxDiifmPZ8w6QPWZp'
COORD=pathlib.Path('/opt/ops/51-project-release-coordination-20261027.json')
LOCKS=['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']
BACKUP=pathlib.Path('/opt/backups/inventory-worker-permit-repair-20261118-WJQ7iBxD')
TARGETS={'inventory-import':201,'inventory-publish':202}
def need(v,c):
    if not v:raise RuntimeError(c)
def H(b):return hashlib.sha256(b).hexdigest()
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def encode(x):return (json.dumps(x,ensure_ascii=False,indent=2)+'\n').encode()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(p,before,after):
    need(p.read_bytes()==before,'CAS_DRIFT '+str(p));st=p.stat();tmp=p.parent/('.permit-repair-'+uuid.uuid4().hex);fd=os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,stat.S_IMODE(st.st_mode))
    try:
        with os.fdopen(fd,'wb')as f:os.fchown(f.fileno(),st.st_uid,st.st_gid);f.write(after);f.flush();os.fsync(f.fileno())
        need(p.read_bytes()==before,'LAST_MOMENT_CAS_DRIFT');os.replace(tmp,p)
        d=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(d)
        finally:os.close(d)
    finally:
        if tmp.exists():tmp.unlink()
def proc():
    ps=json.loads(subprocess.check_output(['pm2','jlist']))
    return sorted([{'id':p['pm_id'],'name':p['name'],'pid':p['pid'],'status':p['pm2_env']['status'],'script':p['pm2_env']['pm_exec_path'],'cwd':p['pm2_env']['pm_cwd'],'mode':p['pm2_env']['exec_mode'],'envSha256':H(canonical(p['pm2_env'].get('env',{})).encode())}for p in ps],key=lambda x:x['id'])
def protect(m):
    for r in m['protectedFiles']:need(H(pathlib.Path(r['path']).read_bytes())==r['sha256'],'PROTECTED_FILE_DRIFT '+r['path'])
def untouched_processes(live,before):
    return [p for p in live if p['id']not in TARGETS.values()]==[p for p in before if p['id']not in TARGETS.values()]
def check_processes(live,before,status):
    need(untouched_processes(live,before),'NON_TARGET_PROCESS_DRIFT')
    for role,i in TARGETS.items():
        p=next(x for x in live if x['id']==i);b=next(x for x in before if x['id']==i)
        need(all(p[k]==b[k]for k in ['id','name','script','cwd','mode','envSha256'])and p['status']==status,'TARGET_PROCESS_IDENTITY_OR_STATUS_DRIFT '+role)
        if status=='online':need(p['pid']>0,'TARGET_PID_REQUIRED')
def command(name):
    for i in TARGETS.values():subprocess.run(['pm2',name,str(i)],check=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=90)
def rebuild(before,records):
    after=before
    for r in reversed(records):
        old=base64.b64decode(r['oldBase64']);new=base64.b64decode(r['newBase64']);need(before[r['byteStart']:r['byteEnd']]==old and H(old)==r['oldSha256'] and H(new)==r['newSha256'],'EXACT_HUNK_PREIMAGE')
        after=after[:r['byteStart']]+new+after[r['byteEnd']:]
    inverse=after
    for r in reversed(records):
        need(inverse[r['newByteStart']:r['newByteEnd']]==base64.b64decode(r['newBase64']),'INVERSE_HUNK_BYTES');inverse=inverse[:r['newByteStart']]+base64.b64decode(r['oldBase64'])+inverse[r['newByteEnd']:]
    need(inverse==before,'EXACT_WORKER_INVERSE');return after
def native_probe(script,required=None):
    p=subprocess.run(['node',str(script)],capture_output=True,timeout=40);need(p.returncode==0,'READ_ONLY_NATIVE_GUARD_PROBE_FAILED')
    x=[json.loads(line)for line in p.stdout.decode().splitlines()if line.startswith('{')];roles=[r for r in x if r.get('role')in TARGETS];need(len(roles)==2 and {r['role']for r in roles}==set(TARGETS),'EXACT_NATIVE_PROBE_ROLES')
    for r in roles:
        need(r['dbReadiness']and r['permitFilesystemValid']and r['permitContentValid']and r['physicalEntryValid']and r['sqlReadsOnly'],'NATIVE_READINESS_OR_PERMIT_VALIDITY_REQUIRED')
        if required is not None:need(r['businessPermitted'] is required,'NATIVE_BUSINESS_PERMIT_EXPECTATION '+r['role'])
    return roles
def build_permit(raw,m):
    old=json.loads(raw);content={k:v for k,v in old.items()if k!='contentSha256'};need(H(canonical(content).encode())==old['contentSha256'],'ORIGINAL_PERMIT_CONTENT_DIGEST')
    new=json.loads(raw)
    for r in m['workers']:new['workerArtifactSha256'][r['role']]=r['afterSha256']
    new['contentSha256']=H(canonical({k:v for k,v in new.items()if k!='contentSha256'}).encode())
    other=[role for role in old['workerArtifactSha256']if role not in TARGETS];need(all(old['workerArtifactSha256'][role]==new['workerArtifactSha256'][role]for role in other),'OTHER_ROLE_PERMIT_SHA_DRIFT')
    need(all(old[k]==new[k]for k in old if k not in ['workerArtifactSha256','contentSha256']),'AUDIT_EPOCH_READINESS_OR_ISSUANCE_DRIFT')
    return encode(new)
def main():
    os.umask(0o077)
    p=argparse.ArgumentParser();p.add_argument('--package',required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args();pack=pathlib.Path(a.package);raw=(pack/'manifest.json').read_bytes();need(H(raw)==a.manifest_sha256,'FINAL_MANIFEST_PIN');m=json.loads(raw)
    need(m['ownerTask']==OWNER and m['scope']=='inventory-worker-permit-reconciliation'and m['directBusinessDml']==0 and m['apiHtmlWrites']==0,'EXACT_RELEASE_SCOPE');need({r['role']for r in m['workers']}==set(TARGETS)and len(m['workers'])==2,'EXACT_TWO_WORKERS')
    probe=pack/'native-permit-readonly.cjs';need(H(probe.read_bytes())==m['probeSha256'],'NATIVE_GUARD_PROBE_PIN');need(H(pathlib.Path(__file__).read_bytes())==m['controllerSha256'],'CONTROLLER_PIN')
    locks=[]
    try:
        for s in LOCKS:
            f=open(s,'r+b');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
        coord_before=COORD.read_bytes();c=json.loads(coord_before);need(c.get('shared_release_active') is False,'SHARED_WINDOW_BUSY');protect(m);before=proc();need(before==m['beforeProcesses'],'EXACT_PROCESS_FRONTIMAGE_DRIFT');need(all(x['status']=='online'and x['pid']>0 for x in before),'ALL_PROCESSES_ONLINE')
        permit=pathlib.Path(m['permitPath']);st=permit.lstat();need(st.st_uid==0 and stat.S_IMODE(st.st_mode)==0o600 and st.st_nlink==1 and stat.S_ISREG(st.st_mode)and not permit.is_symlink(),'ROOT_CONTROLLED_PERMIT');permit_before=permit.read_bytes();need(H(permit_before)==m['beforePermitSha256'],'PERMIT_FRONTIMAGE_DRIFT');permit_after=build_permit(permit_before,m);need(H(permit_after)==m['afterPermitSha256'],'RECONCILED_PERMIT_FINAL_PIN')
        native_probe(probe,False);workers=[]
        for r in m['workers']:
            path=pathlib.Path(r['target']);b=path.read_bytes();need(H(b)==r['beforeSha256'],'WORKER_FRONTIMAGE_DRIFT');d=json.loads((pack/r['delta']).read_bytes());need(H((pack/r['delta']).read_bytes())==r['deltaSha256'],'DELTA_PIN');n=rebuild(b,d['records']);need(H(n)==r['afterSha256'],'REBUILT_WORKER_FINAL_PIN');workers.append((r,path,b,n));stage=pack/(r['role']+'.mjs')
            if stage.exists():need(stage.read_bytes()==n,'STAGE_PREEXISTING_BYTES_DRIFT')
            else:stage.write_bytes(n)
            subprocess.run(['node','--check',str(stage)],check=True,capture_output=True,timeout=30)
        if not a.apply:print(json.dumps({'status':'PREFLIGHT_PASS','activeWrites':0,'manifestSha256':H(raw),'permitBefore':H(permit_before),'permitAfter':H(permit_after)}));return
        need(not BACKUP.exists(),'BACKUP_NAMESPACE_EXISTS_NO_REPLAY');BACKUP.mkdir(mode=0o700);(BACKUP/'manifest.json').write_bytes(raw);(BACKUP/'permit-before.private.json').write_bytes(permit_before)
        for r,path,b,n in workers:(BACKUP/(r['role']+'-before.js')).write_bytes(b)
        window={'owner_task':OWNER,'scope':m['scope'],'status':'applying','nonce':uuid.uuid4().hex,'manifestSha256':H(raw),'openedAtUtc':now(),'receipt':str(BACKUP/'receipt.json')};c['window']=window;c['shared_release_active']=True;c['updated_at']=now();owned=encode(c);atomic(COORD,coord_before,owned);status='recovery-required';after_readiness=[];business_activated=False
        try:
            print('STOP_ONLY_IMPORT_AND_PUBLISH_WORKERS',flush=True);command('stop');check_processes(proc(),before,'stopped');protect(m)
            for r,path,b,n in workers:atomic(path,b,n)
            atomic(permit,permit_before,permit_after);after_readiness=native_probe(probe,True);protect(m);need(COORD.read_bytes()==owned,'OWNED_WINDOW_AUTHORITY_DRIFT')
            print('RESTART_TWO_WORKERS_WITH_VERIFIED_NATIVE_PERMIT',flush=True);command('restart');business_activated=True;deadline=time.monotonic()+45
            while True:
                try:check_processes(proc(),before,'online');break
                except RuntimeError:
                    need(time.monotonic()<deadline,'WORKER_RESTART_READINESS_TIMEOUT');time.sleep(1)
            protect(m);native_probe(probe,True);need(permit.read_bytes()==permit_after,'FINAL_PERMIT_BYTES_DRIFT');need(all(path.read_bytes()==n for r,path,b,n in workers),'FINAL_WORKER_BYTES_DRIFT');status='verified';print('WORKER_PERMIT_AND_HEALTH_PATCH_VERIFIED',flush=True)
        except BaseException as error:
            (BACKUP/'error.txt').write_text(str(error)+'\n')
            try:
                command('stop');check_processes(proc(),before,'stopped')
                need(permit.read_bytes()in(permit_before,permit_after),'FOREIGN_PERMIT_NO_ROLLBACK')
                for r,path,b,n in workers:need(path.read_bytes()in(b,n),'FOREIGN_WORKER_NO_ROLLBACK')
                if permit.read_bytes()==permit_after:atomic(permit,permit_after,permit_before)
                for r,path,b,n in workers:
                    if path.read_bytes()==n:atomic(path,n,b)
                protect(m);native_probe(probe,False);command('restart');check_processes(proc(),before,'online');status='rolled-back'
            except BaseException as recovery:
                status='recovery-required';(BACKUP/'recovery-error.txt').write_text(str(recovery)+'\n')
            raise
        finally:
            if COORD.read_bytes()==owned:
                closed=json.loads(owned);complete=status in('verified','rolled-back');window.update(status=status,needsOperatorRecovery=not complete)
                if complete:window['closedAtUtc']=now()
                closed['window']=window;closed['shared_release_active']=not complete;closed['updated_at']=now();closed.setdefault('window_history',[]).append(window);atomic(COORD,owned,encode(closed))
            result={'status':status,'manifestSha256':H(raw),'directBusinessDml':0,'apiHtmlWrites':0,'onlyWorkerIds':list(TARGETS.values()),'businessActivated':business_activated,'beforePermitSha256':H(permit_before),'afterPermitSha256':H(permit.read_bytes()),'workers':[{'role':r['role'],'sha256':H(path.read_bytes())}for r,path,b,n in workers],'nonTargetProcessesUnchanged':untouched_processes(proc(),before),'protectedFiles':len(m['protectedFiles']),'guardChecks':after_readiness,'closedAtUtc':now()};(BACKUP/'receipt.json').write_bytes(encode(result))
        print(json.dumps(result))
    finally:
        for f in reversed(locks):fcntl.flock(f,fcntl.LOCK_UN);f.close()
if __name__=='__main__':main()
