from pathlib import Path
import json,hashlib,subprocess,fcntl,os,time
root=Path('/opt/ops/20261027-zhijie-business-v1');service=Path('/opt/services/zhijie-access-v1/service.mjs');new=root/'service-audit-fix.mjs'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def run(args):return subprocess.check_output(args,text=True,timeout=30)
def processes():return [{'id':x['pm_id'],'name':x['name'],'pid':x['pid'],'cwd':x['pm2_env'].get('pm_cwd'),'script':x['pm2_env'].get('pm_exec_path')} for x in json.loads(run(['pm2','jlist']))]
def health():return json.loads(run(['curl','-fsS','--max-time','3','http://127.0.0.1:3019/health']))
def atomic(p,b):t=p.with_suffix('.next');t.write_bytes(b);t.chmod(0o600);os.replace(t,p)
with open('/var/lock/dianzi51-public-deploy.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 assert not (root/'audit-fix-applied.json').exists(),'already applied; do not repeat'
 assert new.is_file() and sha(service)==sha(root/'payload/service.mjs'),'concurrent own-service change'
 beforeProcesses=processes();paths=[Path('/etc/nginx/conf.d/dianzi51-admin-subdomain.conf'),Path('/opt/releases/20261018-multi-enterprise-v1/admin/dist/public/index.html'),Path('/opt/services/zhijie-access-v1/start.mjs'),Path('/etc/systemd/system/dianzi51-zhijie-access.service')]
 for row in beforeProcesses:
  p=Path(row['script'] or '')
  if p.is_file() and row['name'].startswith('dianzi51'):paths.append(p)
 manifest=json.loads((root/'payload/manifest.json').read_text());paths.extend(Path('/opt/releases/20261018-multi-enterprise-v1/admin/dist/public/assets')/f['name'] for f in manifest['files'])
 protected={str(p):sha(p) for p in paths};assert health()['businessBridge']=='disconnected'
 old=service.read_bytes();backup=root/'service-before-audit-fix.mjs';assert not backup.exists();backup.write_bytes(old);backup.chmod(0o600)
 def check():
  assert all(sha(p)==h for p,h in protected.items()),'concurrent protected change'
  assert processes()==beforeProcesses,'original PM2 process changed'
 try:
  check();atomic(service,new.read_bytes());run(['systemctl','restart','dianzi51-zhijie-access.service'])
  for n in range(15):
   try:assert health()['businessBridge']=='disconnected';break
   except Exception:
    if n==14:raise
    time.sleep(1)
  check()
  # New code is verified with read-only real DB calls; no grant or session is created.
  validation=json.loads(run(['node',str(root/'readonly-acceptance.mjs')]))
  assert all(validation['checks'].values()) and not validation['createdSessions'] and not validation['changedBusinessData']
  r=run(['curl','-sS','--max-time','10','--resolve','admin.51dianzi.com:443:127.0.0.1','-w','\n%{http_code}','https://admin.51dianzi.com/api/zhijie/context']);body,status=r.rsplit('\n',1);assert status=='401' and json.loads(body)['error']=='LOCAL_ADMIN_REQUIRED'
  check();result={'time':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'applied':True,'oldServiceSha256':hashlib.sha256(old).hexdigest(),'newServiceSha256':sha(service),'protectedCurrentFiles':len(protected),'originalPM2ProcessesUnchanged':True,'currentConcurrentUpdatesPreserved':True,'businessRecordsUnchanged':True,'readOnlyAcceptance':validation}
  atomic(root/'audit-fix-applied.json',(json.dumps(result,indent=2)+'\n').encode());print(json.dumps(result))
 except Exception:
  if sha(service)==sha(new):atomic(service,old);subprocess.run(['systemctl','restart','dianzi51-zhijie-access.service'],check=False)
  raise
