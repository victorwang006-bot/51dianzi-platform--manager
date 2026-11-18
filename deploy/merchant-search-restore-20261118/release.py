#!/usr/bin/env python3
"""Selective merchant SearchPage restoration; never old whole-page rollback.
Only additive search assets and exact current front HTML mappings. No business
DB/API/adminHTML/config/process writes; preserve the separately reviewed catalog.
"""
import argparse,datetime,fcntl,hashlib,json,os,pathlib,stat,subprocess,uuid
OWNER='WJQ7iBxDiifmPZ8w6QPWZp'
PUBLIC=pathlib.Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public')
COORD=pathlib.Path('/opt/ops/51-project-release-coordination-20261027.json')
ROOT=pathlib.Path('/opt/backups/merchant-search-restore-20261118-WJQ7iBxD')
LOCKS=['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']
def H(b):return hashlib.sha256(b).hexdigest()
def need(v,c):
 if not v:raise RuntimeError(c)
def encode(x):return(json.dumps(x,ensure_ascii=False,indent=2)+'\n').encode()
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(p,before,after):
 need(p.read_bytes()==before,'FULL_BYTES_CAS_DRIFT '+str(p));s=p.stat();t=p.parent/('.merchant-search-'+uuid.uuid4().hex);fd=os.open(t,os.O_CREAT|os.O_EXCL|os.O_WRONLY,stat.S_IMODE(s.st_mode))
 try:
  with os.fdopen(fd,'wb')as f:os.fchmod(f.fileno(),stat.S_IMODE(s.st_mode));os.fchown(f.fileno(),s.st_uid,s.st_gid);f.write(after);f.flush();os.fsync(f.fileno())
  need(p.read_bytes()==before,'LAST_MOMENT_CAS_DRIFT');os.replace(t,p);d=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(d)
  finally:os.close(d)
 finally:
  if t.exists():t.unlink()
def processes():
 p=json.loads(subprocess.check_output(['pm2','jlist']));return sorted([{'id':x['pm_id'],'name':x['name'],'pid':x['pid'],'status':x['pm2_env']['status'],'script':x['pm2_env']['pm_exec_path'],'cwd':x['pm2_env']['pm_cwd'],'mode':x['pm2_env']['exec_mode'],'envSha256':H(canonical(x['pm2_env'].get('env',{})).encode())}for x in p],key=lambda x:x['id'])
def protect(m):
 for r in m['protectedFiles']:need(H(pathlib.Path(r['path']).read_bytes())==r['sha256'],'PROTECTED_FILE_DRIFT '+r['path'])
def main():
 os.umask(0o077);p=argparse.ArgumentParser();p.add_argument('--package',required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args();pack=pathlib.Path(a.package);mb=(pack/'manifest.json').read_bytes();need(H(mb)==a.manifest_sha256,'FROZEN_MANIFEST_PIN');m=json.loads(mb)
 need(m['ownerTask']==OWNER and m['scope']=='merchant-search-selective-restoration','EXACT_STATIC_SCOPE');need(m['apiWrites']==0 and m['databaseWrites']==0 and m['processReloads']==0 and m['adminHtmlWrites']==0,'NO_BACKEND_OR_ADMIN_SCOPE');need(H(pathlib.Path(__file__).read_bytes())==m['controllerSha256'],'CONTROLLER_PIN');need(len(m['protectedFiles'])>=200,'ALL_EXISTING_ASSETS_AND_RUNTIME_PROTECTION_REQUIRED');need(str(PUBLIC/'index.html')not in{r['path']for r in m['protectedFiles']},'FRONT_HTML_MUST_HAVE_ITS_OWN_CAS')
 before=(pack/'baseline-index.html').read_bytes();after=(pack/'candidate-index.html').read_bytes();need(H(before)==m['beforeHtmlSha256'] and H(after)==m['afterHtmlSha256'],'HTML_PACKAGE_PIN');need(m['catalogEntryUnchanged']and m['merchantOnlyRenderAndScopedStyle']and m['htmlInverseUnchangedOtherBytes'],'RESTORATION_NOT_WHOLE_PAGE_ROLLBACK')
 for r in m['assets']:
  name=r['relative'];need(name.startswith(('assets/SearchPage-merchant-restore-','assets/SearchPage-merchant-scope-'))and '..'not in pathlib.PurePosixPath(name).parts and len(pathlib.PurePosixPath(name).parts)==2,'EXACT_SEARCH_ASSET_PREFIX');need(H((pack/'assets'/pathlib.Path(name).name).read_bytes())==r['sha256'],'ASSET_PACKAGE_PIN')
 handles=[]
 try:
  for x in LOCKS:
   f=open(x,'r+b');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);handles.append(f)
  cb=COORD.read_bytes();c=json.loads(cb);need(c.get('shared_release_active')is False,'SHARED_WINDOW_BUSY');need((PUBLIC/'index.html').read_bytes()==before,'LATEST_FRONT_HTML_DRIFT_REBUILD_REQUIRED');protect(m);ps=processes();need(ps==m['beforeProcesses'],'EXACT_PROCESS_AND_ENV_DRIFT');need(len(ps)==12 and all(x['status']=='online'and x['pid']>0 for x in ps),'ALL_TWELVE_PROCESSES_ONLINE')
  for r in m['assets']:need(not(PUBLIC/r['relative']).exists(),'NEW_ASSET_ALREADY_EXISTS_NO_REPLAY')
  if not a.apply:print(json.dumps({'status':'PREFLIGHT_PASS','activeWrites':0,'manifestSha256':H(mb)}));return
  need(not ROOT.exists(),'OWNED_NAMESPACE_EXISTS_NO_REPLAY');ROOT.mkdir(mode=0o700);(ROOT/'manifest.json').write_bytes(mb);(ROOT/'before-index.html').write_bytes(before);(ROOT/'after-index.html').write_bytes(after);w={'owner_task':OWNER,'scope':m['scope'],'manifestSha256':H(mb),'status':'applying','nonce':uuid.uuid4().hex,'openedAtUtc':now(),'receipt':str(ROOT/'receipt.json')};c['shared_release_active']=True;c['window']=w;c['updated_at']=now();owned=encode(c);atomic(COORD,cb,owned);added=[];status='recovery-required'
  try:
   for r in m['assets']:
    target=PUBLIC/r['relative'];b=(pack/'assets'/pathlib.Path(r['relative']).name).read_bytes();fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o644)
    with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
    os.chmod(target,0o644);added.append(r['relative']);need(H(target.read_bytes())==r['sha256'],'ADDITIVE_ASSET_PIN')
   protect(m);need(processes()==ps,'PROCESS_CHANGED_BEFORE_HTML_SWITCH');need(COORD.read_bytes()==owned,'OWNED_WINDOW_LOST');atomic(PUBLIC/'index.html',before,after);need((PUBLIC/'index.html').read_bytes()==after,'AFTER_HTML_CAS_DRIFT');protect(m);need(processes()==ps,'PROCESS_OR_ENV_CHANGED');status='verified'
  except BaseException as e:
   (ROOT/'error.txt').write_text(str(e)+'\n')
   try:
    current=(PUBLIC/'index.html').read_bytes();need(current in(before,after),'FOREIGN_HTML_DO_NOT_ROLLBACK')
    if current==after:atomic(PUBLIC/'index.html',after,before)
    protect(m);need(processes()==ps,'PROCESS_DRIFT_DURING_RECOVERY');need((PUBLIC/'index.html').read_bytes()==before,'RECOVERY_NOT_VERIFIED');status='rolled-back'
   except BaseException as recovery:(ROOT/'recovery-error.txt').write_text(str(recovery)+'\n');status='recovery-required'
   raise
  finally:
   if COORD.read_bytes()==owned:
    closed=json.loads(owned);ok=status in('verified','rolled-back');w.update(status=status,needsOperatorRecovery=not ok)
    if ok:w['closedAtUtc']=now()
    closed['window']=w;closed['shared_release_active']=not ok;closed.setdefault('window_history',[]).append(w);closed['updated_at']=now();atomic(COORD,owned,encode(closed))
   receipt={'status':status,'manifestSha256':H(mb),'frontHtmlSha256':H((PUBLIC/'index.html').read_bytes()),'assets':added,'allOldFilesPreserved':True,'apiWrites':0,'databaseWrites':0,'processReloads':0,'adminHtmlWrites':0,'processesAndEnvUnchanged':processes()==ps,'protectedFiles':len(m['protectedFiles']),'closedAtUtc':now()};(ROOT/'receipt.json').write_bytes(encode(receipt))
  print(json.dumps(receipt))
 finally:
  for f in reversed(handles):fcntl.flock(f,fcntl.LOCK_UN);f.close()
if __name__=='__main__':main()
