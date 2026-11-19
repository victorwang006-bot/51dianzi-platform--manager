#!/usr/bin/env python3
"""Fixed four-JS + front HTML release. No API/DB/worker/flag/admin/process writes.
Review is independently supplied. Import performs no I/O. Production execution is
NOT performed by the preparation task. PM2 is queried read-only; HTTP uses GET.
"""
import argparse,datetime,fcntl,hashlib,json,os,pathlib,re,stat,subprocess,uuid
OWNER='yOJKWq2DYYh42oMQkoK7ow'
SCOPE='cart-compact-static-20261119'
PUBLIC=pathlib.Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public')
STAGE=pathlib.Path('/opt/backups/cart-compact-static-20261119-yOJKWq2D')
RECEIPT=STAGE/'receipt'
COORD=pathlib.Path('/opt/ops/51-project-release-coordination-20261027.json')
FLAG='/opt/ops/official-cart-active-20261119.json'
OLD_FLAG='/opt/ops/official-checkout-active-20261118.json'
FRONT='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
REFUND='/opt/releases/20261018-multi-enterprise-v1/web/dist/refundWorker.js'
LOCKS=['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']
VOLATILE={'unique_id','NODE_UNIQUE_ID','NODE_CHANNEL_FD','NODE_CHANNEL_SERIALIZATION_MODE'}
PROCESS_FIELDS={'id','name','pid','status','script','cwd','envHash'}
BEFORE_HTML='19c7fcda7b346fb6297574094a1a275b6192c9c25ac2fc01ec1e0ff7bd89c4d6'
AFTER_HTML='56312af5e0a6028ec64e4cfd8a8c8b6f91d8cbf3d20267179180e1e629f0fb1f'
SUBDIR='assets/20261107-verified-master-search-reference-v24-front-1a960e4a5670/'
ASSETS={
 'assets/official-cart-ui-b573cdc8b4ba96a8ba71d0441411cc2e60fc189f98a87e5dfb0c7bcd4ceec723.js':'b573cdc8b4ba96a8ba71d0441411cc2e60fc189f98a87e5dfb0c7bcd4ceec723',
 'assets/search-official-cart-4e9a14958413634391570f67881e6f3c8f2b2af1520b3c1549fb604b2314e8da.js':'4e9a14958413634391570f67881e6f3c8f2b2af1520b3c1549fb604b2314e8da',
 SUBDIR+'nav-official-cart-8d5e7c8565cf1ec2fb3f41393194fab50796cbfb617162048a581f7af350922d.js':'8d5e7c8565cf1ec2fb3f41393194fab50796cbfb617162048a581f7af350922d',
 SUBDIR+'cart-official-cart-d01dc99cf86d9889a01ea38717c6ec529ca46b6956bf2a4e4d28edf6a520b0be.js':'d01dc99cf86d9889a01ea38717c6ec529ca46b6956bf2a4e4d28edf6a520b0be'}
API_PINS={FRONT:'f4ed2ae6fa4c24fd2e19986fffa0d5030c48640d217bceed1749b8b98a2d7e1f',REFUND:'a8727f0e3e158e09bd7001bedb41c19b4ad4755a6b91fe1a6dc518004f5c1828',
 '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/runtime/officialCart.9ced572cdfe03ceb8ea1340250c961a9e3394cb23f803d0527c7887612ab8e62.runtime.mjs':'9ced572cdfe03ceb8ea1340250c961a9e3394cb23f803d0527c7887612ab8e62',
 '/opt/releases/20261018-multi-enterprise-v1/web/runtime/officialCartStock.e6bd216e5ab36a8c321f6ee78a9d9f727240109c540ab37c1a070a32f6497eab.runtime.mjs':'e6bd216e5ab36a8c321f6ee78a9d9f727240109c540ab37c1a070a32f6497eab'}
OLD_OWNER='hAqs2hYu4pcg9uqd4th0Sj'
OLD_MANIFEST='bcff9e2df7ef262512542f4f1bb144dc0b28e11169ac1c54ed4b3241c5ad7e16'
INITIAL_SHA='acc0efbba4abf98009d950f8ba56c9142c82c876afc60c33db2881aa7b7f7ecb'
def H(b):return hashlib.sha256(b).hexdigest()
def need(v,c):
 if not v:raise RuntimeError(c)
def encode(x):return(json.dumps(x,ensure_ascii=False,indent=2)+'\n').encode()
def canonical(x):return json.dumps(x,sort_keys=True,separators=(',',':'),ensure_ascii=False)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def fresh(t):
  age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(t.replace('Z','+00:00'))).total_seconds();need(0<=age<=900,'FRESH_AFTER_API_CAPTURE_REQUIRED')
def atomic(p,before,after):
 need(p.read_bytes()==before,'FULL_BYTES_CAS_DRIFT '+str(p));s=p.stat();t=p.parent/('.cart-static-'+uuid.uuid4().hex)
 fd=os.open(t,os.O_CREAT|os.O_EXCL|os.O_WRONLY,stat.S_IMODE(s.st_mode))
 try:
  with os.fdopen(fd,'wb')as f:
   os.fchmod(f.fileno(),stat.S_IMODE(s.st_mode));os.fchown(f.fileno(),s.st_uid,s.st_gid);f.write(after);f.flush();os.fsync(f.fileno())
  need(p.read_bytes()==before,'LAST_MOMENT_CAS_DRIFT');os.replace(t,p);d=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY)
  try:os.fsync(d)
  finally:os.close(d)
 finally:
  if t.exists():t.unlink()
def config_hash(e):
 value={'env':{k:v for k,v in e.get('env',{}).items() if k not in VOLATILE},'topEnv':{k:v for k,v in e.items() if k.isupper() and k not in VOLATILE}}
 return H(json.dumps(value,sort_keys=True,separators=(',',':')).encode())
def processes():
 ps=json.loads(subprocess.check_output(['pm2','jlist'],stderr=subprocess.PIPE,timeout=30))
 return sorted([{'id':x['pm_id'],'name':x['name'],'pid':x['pid'],'status':x['pm2_env']['status'],'script':x['pm2_env']['pm_exec_path'],'cwd':x['pm2_env']['pm_cwd'],'envHash':config_hash(x['pm2_env'])}for x in ps],key=lambda x:x['id'])
def validate_processes(ps):
 need(len(ps)==12 and len({x['id'] for x in ps})==12 and all(set(x)==PROCESS_FIELDS and x['status']=='online' and type(x['pid'])is int and x['pid']>0 and re.fullmatch('[a-f0-9]{64}',x['envHash']) for x in ps),'ALL_TWELVE_NORMALIZED_PROCESSES_ONLINE')
def history(c,m):
 need(c.get('shared_release_active')is False,'SHARED_WINDOW_BUSY')
 a=m['apiHistory'];need(a.get('owner_task')==OWNER and a.get('scope')=='official-cart-api-20261119' and a.get('status')=='verified' and a.get('closedAtUtc') and a.get('needsOperatorRecovery')is False and a in c.get('window_history',[]),'API_OWN_CLOSED_VERIFIED_HISTORY_REQUIRED')
 need(any(x.get('owner_task')==OLD_OWNER and x.get('manifestSha256')==OLD_MANIFEST and x.get('status')=='verified' and x.get('closedAtUtc') for x in c.get('window_history',[])),'OLD_PAID_GUARD_HISTORY_REQUIRED')
def validate_protection(s):
 fresh(s['capturedAtUtc']);validate_processes(s['beforeProcesses']);rows=s['protectedFiles'];pins={r['path']:r['sha256'] for r in rows}
 need(len(rows)==len(pins) and len(rows)>=280,'ALL_BASELINE_AND_AFTER_API_PROTECTION_REQUIRED')
 need(all(pins.get(k)==v for k,v in API_PINS.items()),'EXACT_VERIFIED_API_AFTER_AND_TWO_RUNTIMES_REQUIRED')
 need(FLAG in pins and OLD_FLAG in pins,'BOTH_ACTIVE_FLAGS_PROTECTED')
 f=s['newFlag'];need(f.get('enabled')is True and f.get('ownerTask')==OWNER and f.get('runtimeSha256')==API_PINS[next(k for k in API_PINS if '/officialCart.' in k)],'VERIFIED_CART_FLAG_ENABLED_REQUIRED')
 need(pins[FLAG]==s['newFlagSha256'],'FLAG_CAPTURE_HASH_PIN');c=s['coordinator'];a=[x for x in c.get('window_history',[]) if x.get('owner_task')==OWNER and x.get('scope')=='official-cart-api-20261119' and x.get('manifestSha256')==f.get('manifestSha256') and x.get('nonce')==f.get('nonce')]
 need(len(a)==1,'API_FLAG_EXACT_HISTORY_BINDING');history(c,{'apiHistory':a[0]});return a[0]
def protect(m):
 for r in m['protectedFiles']:need(H(pathlib.Path(r['path']).read_bytes())==r['sha256'],'PROTECTED_FILE_DRIFT '+r['path'])
 flag=json.loads(pathlib.Path(FLAG).read_bytes());need(flag==m['newFlag'] and flag.get('enabled')is True,'ACTIVE_API_FLAG_DRIFT')
def asset_path(r):
 name=r['relative'];need(name in ASSETS and ASSETS[name]==r['sha256'],'EXACT_CONTENT_ADDRESSED_FOUR_JS_SCOPE');return PUBLIC/name
def verify_assets(pack,m):
 need(len(m['assets'])==4 and {r['relative']:r['sha256'] for r in m['assets']}==ASSETS,'EXACT_FOUR_CANDIDATE_JS_NO_CSS')
 for r in m['assets']:
  asset_path(r);need(H((pack/r['relative']).read_bytes())==r['sha256'],'ASSET_PACKAGE_PIN')
def main():
 os.umask(0o077);p=argparse.ArgumentParser();p.add_argument('--package',required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--review-sha256');p.add_argument('--apply',action='store_true');a=p.parse_args();pack=pathlib.Path(a.package).resolve()
 need(pack==(STAGE/'package').resolve(),'EXACT_PRIVATE_CANONICAL_PACKAGE_SCOPE');mb=(pack/'manifest.json').read_bytes();need(H(mb)==a.manifest_sha256,'FROZEN_MANIFEST_PIN');m=json.loads(mb)
 need(m['ownerTask']==OWNER and m['scope']==SCOPE,'EXACT_CART_STATIC_SCOPE');need(m['apiWrites']==0 and m['databaseWrites']==0 and m['processReloads']==0 and m['adminHtmlWrites']==0,'NO_BACKEND_ADMIN_OR_PROCESS_SCOPE');need(H(pathlib.Path(__file__).read_bytes())==m['controllerSha256'],'CONTROLLER_PIN')
 sb=(pack/'evidence/protection.json').read_bytes();need(H(sb)==m['protectionSha256'],'PROTECTION_CAPTURE_PIN');s=json.loads(sb);need(validate_protection(s)==m['apiHistory'],'API_HISTORY_PIN');need(m['beforeProcesses']==s['beforeProcesses'] and m['newFlag']==s['newFlag'],'FRESH_CAPTURE_BINDING')
 ib=(pack/'evidence/protection-initial.json').read_bytes();need(H(ib)==INITIAL_SHA,'ACTUAL_INITIAL_277_PIN');initial=json.loads(ib);ip={r['path']:r['sha256'] for r in initial['protectedFiles']};sp={r['path']:r['sha256'] for r in s['protectedFiles']};need(len(ip)==277 and all(sp.get(k)==v for k,v in ip.items()),'ALL_277_ORIGINAL_BYTES_RETAINED')
 need(m['protectedFiles']==[r for r in s['protectedFiles'] if r['path']!=str(PUBLIC/'index.html')],'ALL_CAPTURED_FILES_EXCEPT_HTML_CAS_REQUIRED');need(str(PUBLIC/'index.html')not in{r['path']for r in m['protectedFiles']},'FRONT_HTML_HAS_OWN_CAS')
 before=(pack/'baseline-index.html').read_bytes();after=(pack/'candidate-index.html').read_bytes();need(H(before)==m['beforeHtmlSha256']==BEFORE_HTML and H(after)==m['afterHtmlSha256']==AFTER_HTML,'HTML_PACKAGE_PIN');verify_assets(pack,m)
 for name,h in m['packageFiles'].items():
  q=pathlib.PurePosixPath(name);need(not q.is_absolute() and '..'not in q.parts and H((pack/name).read_bytes())==h,'CLOSED_PACKAGE_FILE_PIN')
 if a.apply:
  rb=(pack/'review.json').read_bytes();need(a.review_sha256 and H(rb)==a.review_sha256,'EXTERNAL_INDEPENDENT_REVIEW_PIN');review=json.loads(rb);need(review=={'status':'passed','independent':True,'manifestSha256':H(mb),'controllerSha256':m['controllerSha256'],'protectionSha256':m['protectionSha256']},'CURRENT_INDEPENDENT_REVIEW_PIN')
 handles=[]
 try:
  for lock in LOCKS:
   f=open(lock,'r+b');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);handles.append(f)
  cb=COORD.read_bytes();c=json.loads(cb);history(c,m);need(H(cb)==s['coordinatorSha256'],'FRESH_COORDINATOR_PIN');need((PUBLIC/'index.html').read_bytes()==before,'LATEST_FRONT_HTML_DRIFT_REBUILD_REQUIRED');protect(m);ps=processes();need(ps==m['beforeProcesses'],'EXACT_PROCESS_AND_ENV_DRIFT');validate_processes(ps)
  for r in m['assets']:need(not asset_path(r).exists(),'NEW_ASSET_EXISTS_NO_REPLAY')
  if not a.apply:print(json.dumps({'status':'PREFLIGHT_PASS','activeWrites':0,'manifestSha256':H(mb),'protectedFiles':len(m['protectedFiles']),'environmentProof':'normalized-config-only-no-raw-proc-claim'}));return
  need(not RECEIPT.exists(),'OWNED_RECEIPT_EXISTS_NO_REPLAY');RECEIPT.mkdir(mode=0o700);(RECEIPT/'manifest.json').write_bytes(mb);(RECEIPT/'before-index.html').write_bytes(before);(RECEIPT/'after-index.html').write_bytes(after)
  w={'owner_task':OWNER,'scope':m['scope'],'manifestSha256':H(mb),'status':'applying','nonce':uuid.uuid4().hex,'openedAtUtc':now(),'receipt':str(RECEIPT/'receipt.json')};c['shared_release_active']=True;c['window']=w;c['updated_at']=now();owned=encode(c)
  try:atomic(COORD,cb,owned)
  except BaseException:
   if COORD.read_bytes()==owned:atomic(COORD,owned,cb)
   raise
  added=[];status='recovery-required'
  try:
   for r in m['assets']:
    target=asset_path(r);b=(pack/r['relative']).read_bytes();fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o644)
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
    need(COORD.read_bytes()==owned,'FOREIGN_COORD_DO_NOT_ROLLBACK');current=(PUBLIC/'index.html').read_bytes();need(current in(before,after),'FOREIGN_HTML_DO_NOT_ROLLBACK')
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
   receipt={'status':status,'manifestSha256':H(mb),'frontHtmlSha256':H((PUBLIC/'index.html').read_bytes()),'assets':added,'allOldFilesPreserved':True,'apiWrites':0,'databaseWrites':0,'processReloads':0,'adminHtmlWrites':0,'processesAndNormalizedEnvUnchanged':processes()==ps,'protectedFiles':len(m['protectedFiles']),'closedAtUtc':now()};(RECEIPT/'receipt.json').write_bytes(encode(receipt))
  print(json.dumps(receipt))
 finally:
  for f in reversed(handles):fcntl.flock(f,fcntl.LOCK_UN);f.close()
if __name__=='__main__':main()
