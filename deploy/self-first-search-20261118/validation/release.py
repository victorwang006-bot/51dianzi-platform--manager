#!/usr/bin/env python3
"""Scoped official published material first-in-search static release. No DB/API/worker/process mutations."""
import argparse,datetime,fcntl,hashlib,json,os,pathlib,re,stat,subprocess,uuid
OWNER='yOJKWq2DYYh42oMQkoK7ow'
PUBLIC=pathlib.Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public')
STAGE=pathlib.Path('/opt/backups/self-first-20261118-yOJKWq2D')
RECEIPT=STAGE/'receipt'
COORD=pathlib.Path('/opt/ops/51-project-release-coordination-20261027.json')
LOCKS=['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']
def H(b):return hashlib.sha256(b).hexdigest()
def need(v,c):
 if not v:raise RuntimeError(c)
def encode(x):return(json.dumps(x,ensure_ascii=False,indent=2)+'\n').encode()
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(p,before,after):
 need(p.read_bytes()==before,'FULL_BYTES_CAS_DRIFT '+str(p));s=p.stat();t=p.parent/('.commission-simple-'+uuid.uuid4().hex)
 fd=os.open(t,os.O_CREAT|os.O_EXCL|os.O_WRONLY,stat.S_IMODE(s.st_mode))
 try:
  with os.fdopen(fd,'wb')as f:
   os.fchmod(f.fileno(),stat.S_IMODE(s.st_mode));os.fchown(f.fileno(),s.st_uid,s.st_gid);f.write(after);f.flush();os.fsync(f.fileno())
  need(p.read_bytes()==before,'LAST_MOMENT_CAS_DRIFT');os.replace(t,p);d=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(d)
  finally:os.close(d)
 finally:
  if t.exists():t.unlink()
def processes():
 ps=json.loads(subprocess.check_output(['pm2','jlist'],stderr=subprocess.PIPE,timeout=30))
 return sorted([{'id':x['pm_id'],'name':x['name'],'pid':x['pid'],'status':x['pm2_env']['status'],'script':x['pm2_env']['pm_exec_path'],'cwd':x['pm2_env']['pm_cwd'],'mode':x['pm2_env']['exec_mode'],'envSha256':H(canonical(x['pm2_env'].get('env',{})).encode()),'rawEnvSha256':H((pathlib.Path('/proc')/str(x['pid'])/'environ').read_bytes())}for x in ps],key=lambda x:x['id'])
def protect(m):
 for r in m['protectedFiles']:need(H(pathlib.Path(r['path']).read_bytes())==r['sha256'],'PROTECTED_FILE_DRIFT '+r['path'])
def asset_path(r):
 name=r['relative'];need(re.fullmatch(r'assets/(?:SearchPage-self-first|OfficialMall-search-first)-[a-f0-9]{64}\.js',name),'EXACT_CONTENT_ADDRESSED_PROFILE_OR_CSS_SCOPE');return PUBLIC/name
def verify_assets(pack,m):
 for r in m['assets']:asset_path(r)
 need(len(m['assets'])==2 and {r['relative'].split('/')[-1].rsplit('-',1)[0] for r in m['assets']}=={'SearchPage-self-first','OfficialMall-search-first'},'EXACT_SEARCH_AND_PUBLIC_CARD_JS_NO_CSS')
 for r in m['assets']:
  asset_path(r);need(H((pack/'assets'/pathlib.Path(r['relative']).name).read_bytes())==r['sha256'],'ASSET_PACKAGE_PIN')
def main():
 os.umask(0o077);p=argparse.ArgumentParser();p.add_argument('--package',required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args();pack=pathlib.Path(a.package).resolve()
 need(pack== (STAGE/'package').resolve(),'EXACT_PRIVATE_CANONICAL_PACKAGE_SCOPE');mb=(pack/'manifest.json').read_bytes();need(H(mb)==a.manifest_sha256,'FROZEN_MANIFEST_PIN');m=json.loads(mb)
 need(m['ownerTask']==OWNER and m['scope']=='self-first-search-static','EXACT_COMMISSION_UI_SCOPE');need(m['apiWrites']==0 and m['databaseWrites']==0 and m['processReloads']==0 and m['adminHtmlWrites']==0,'NO_BACKEND_FRONT_HTML_OR_PROCESS_SCOPE');need(H(pathlib.Path(__file__).read_bytes())==m['controllerSha256'],'CONTROLLER_PIN')
 need(len(m['protectedFiles'])>=200,'CURRENT_ALL_ASSET_RUNTIME_PROTECTION_REQUIRED');need(str(PUBLIC/'index.html')not in{r['path']for r in m['protectedFiles']},'ADMIN_HTML_HAS_OWN_CAS')
 before=(pack/'baseline-index.html').read_bytes();after=(pack/'candidate-index.html').read_bytes();need(H(before)==m['beforeHtmlSha256'] and H(after)==m['afterHtmlSha256'],'HTML_PACKAGE_PIN');need(m['allExistingMerchantAndLegacyCatalogBytesPreserved']and m['allOtherHtmlBytesPreserved']and m['actualNormalSearchFirstCardVerified']and m['selfFilterAndDirectoryJumpRemoved'],'SOURCE_FACTORY_AND_ACTUAL_ENTRY_PROOF_REQUIRED');verify_assets(pack,m)
 if a.apply:
  review=json.loads((pack/'review.json').read_text());need(review['status']=='passed'and review['independent'] and review['manifestSha256']==H(mb) and review['controllerSha256']==m['controllerSha256'],'CURRENT_INDEPENDENT_REVIEW_PIN')
 handles=[]
 try:
  for lock in LOCKS:
   f=open(lock,'r+b');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);handles.append(f)
  cb=COORD.read_bytes();c=json.loads(cb);need(c.get('shared_release_active')is False,'SHARED_WINDOW_BUSY');need((PUBLIC/'index.html').read_bytes()==before,'LATEST_ADMIN_HTML_DRIFT_REBUILD_REQUIRED');protect(m);ps=processes();need(ps==m['beforeProcesses'],'EXACT_PROCESS_AND_ENV_DRIFT');need(len(ps)==12 and all(x['status']=='online'and x['pid']>0 for x in ps),'ALL_TWELVE_PROCESSES_ONLINE')
  for r in m['assets']:need(not asset_path(r).exists(),'NEW_ASSET_EXISTS_NO_REPLAY')
  if not a.apply:print(json.dumps({'status':'PREFLIGHT_PASS','activeWrites':0,'manifestSha256':H(mb),'protectedFiles':len(m['protectedFiles'])}));return
  need(not RECEIPT.exists(),'OWNED_RECEIPT_EXISTS_NO_REPLAY');RECEIPT.mkdir(mode=0o700);(RECEIPT/'manifest.json').write_bytes(mb);(RECEIPT/'before-index.html').write_bytes(before);(RECEIPT/'after-index.html').write_bytes(after)
  w={'owner_task':OWNER,'scope':m['scope'],'manifestSha256':H(mb),'status':'applying','nonce':uuid.uuid4().hex,'openedAtUtc':now(),'receipt':str(RECEIPT/'receipt.json')};c['shared_release_active']=True;c['window']=w;c['updated_at']=now();owned=encode(c)
  # If replace commits but directory fsync fails, restore only our own coordination bytes.
  try:atomic(COORD,cb,owned)
  except BaseException:
   if COORD.read_bytes()==owned:atomic(COORD,owned,cb)
   raise
  added=[];status='recovery-required'
  try:
   for r in m['assets']:
    target=asset_path(r);b=(pack/'assets'/pathlib.Path(r['relative']).name).read_bytes();fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o644)
    with os.fdopen(fd,'wb')as f:f.write(b);f.flush();os.fsync(f.fileno())
    os.chmod(target,0o644);added.append(r['relative']);need(H(target.read_bytes())==r['sha256'],'ADDITIVE_ASSET_PIN')
   protect(m);need(processes()==ps,'PROCESS_CHANGED_BEFORE_HTML_SWITCH');need(COORD.read_bytes()==owned,'OWNED_WINDOW_LOST');atomic(PUBLIC/'index.html',before,after);need((PUBLIC/'index.html').read_bytes()==after,'AFTER_HTML_CAS_DRIFT')
   served=subprocess.check_output(['curl','-fsS','--compressed','--max-time','15','--resolve','51dianzi.com:443:127.0.0.1','https://51dianzi.com/'],stderr=subprocess.PIPE,timeout=20);need(H(served)==H(after),'HTTPS_SERVED_HTML_PIN')
   for r in m['assets']:
    url='https://51dianzi.com/'+r['relative'];served=subprocess.check_output(['curl','-fsS','--compressed','--max-time','15','--resolve','51dianzi.com:443:127.0.0.1',url],stderr=subprocess.PIPE,timeout=20);need(H(served)==r['sha256'],'HTTPS_SERVED_ASSET_PIN')
   protect(m);need(processes()==ps,'PROCESS_OR_ENV_CHANGED');status='verified'
  except BaseException as e:
   try:(RECEIPT/'error.txt').write_text(str(e)+'\n')
   except BaseException:pass
   try:
    current=(PUBLIC/'index.html').read_bytes();need(current in(before,after),'FOREIGN_HTML_DO_NOT_ROLLBACK')
    if current==after:atomic(PUBLIC/'index.html',after,before)
    protect(m);need(processes()==ps,'PROCESS_DRIFT_DURING_RECOVERY');need((PUBLIC/'index.html').read_bytes()==before,'RECOVERY_NOT_VERIFIED');status='rolled-back'
   except BaseException as recovery:
    status='recovery-required'
    try:(RECEIPT/'recovery-error.txt').write_text(str(recovery)+'\n')
    except BaseException:pass
   raise
  finally:
   if COORD.read_bytes()==owned:
    closed=json.loads(owned);ok=status in('verified','rolled-back');w.update(status=status,needsOperatorRecovery=not ok)
    if ok:w['closedAtUtc']=now()
    closed['window']=w;closed['shared_release_active']=not ok;closed.setdefault('window_history',[]).append(w);closed['updated_at']=now();atomic(COORD,owned,encode(closed))
   receipt={'status':status,'manifestSha256':H(mb),'frontHtmlSha256':H((PUBLIC/'index.html').read_bytes()),'assets':added,'allOldFilesPreserved':True,'apiWrites':0,'databaseWrites':0,'processReloads':0,'adminHtmlWrites':0,'processesAndEnvUnchanged':processes()==ps,'protectedFiles':len(m['protectedFiles']),'closedAtUtc':now()};(RECEIPT/'receipt.json').write_bytes(encode(receipt))
  print(json.dumps(receipt))
 finally:
  for f in reversed(handles):fcntl.flock(f,fcntl.LOCK_UN);f.close()
if __name__=='__main__':main()
