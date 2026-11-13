#!/usr/bin/env python3
import argparse, pathlib, json, hashlib, subprocess, fcntl, os, tempfile, datetime, urllib.request
ROOT=pathlib.Path('/opt/ops/20261113-primary-menu-reminders-IUpdaAmZ')
PUBLIC=pathlib.Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
COORD=pathlib.Path('/opt/ops/51-project-release-coordination-20261027.json')
TASK='IUpdaAmZm3xXTSJGJo5PDu'
def require(ok,msg):
 if not ok:raise RuntimeError(msg)
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(p,data,mode=None):
 p=pathlib.Path(p);old=p.stat()if p.exists()else None;fd,tmp=tempfile.mkstemp(prefix='.menu-reminders-',dir=p.parent)
 try:
  os.fchmod(fd,mode if mode is not None else(old.st_mode&0o777 if old else 0o644))
  if old:os.fchown(fd,old.st_uid,old.st_gid)
  with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.replace(tmp,p)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def save(p,obj):atomic(p,(json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode(),0o600)
def processes():
 p=subprocess.run(['pm2','jlist'],capture_output=True,check=True,timeout=30)
 return [{'id':r['pm_id'],'name':r['name'],'pid':r['pid'],'status':r['pm2_env']['status'],'script':r['pm2_env']['pm_exec_path'],'cwd':r['pm2_env']['pm_cwd'],'environmentHash':hashlib.sha256(json.dumps(r['pm2_env'].get('env',{}),sort_keys=True).encode()).hexdigest()}for r in json.loads(p.stdout)]
def get(url):
 req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0','Cache-Control':'no-cache','Accept-Encoding':'identity'})
 with urllib.request.urlopen(req,timeout=25)as r:
  require(r.status==200,'HTTP_STATUS_FAILED_'+url);body=r.read();return {'url':url,'status':r.status,'sha256':hashlib.sha256(body).hexdigest(),'contentType':r.headers.get('content-type','')},body
p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--rollback',action='store_true');args=p.parse_args()
m=json.loads((ROOT/'manifest.json').read_text());files=m['files'];manifestSha=sha(ROOT/'manifest.json')
require(m['ownerTask']==TASK and len(files)==4,'MANIFEST_SCOPE_FAILED')
require({x['relative']for x in files}=={'index.html',*m['assetPaths']},'EXACT_UPLOAD_SCOPE_FAILED')
for x in files:
 rel=pathlib.PurePosixPath(x['relative']);require(not rel.is_absolute()and '..'not in rel.parts,'UNSAFE_FILE_PATH')
 require(sha(ROOT/'candidate'/x['relative'])==x['sha256'],'CANDIDATE_HASH_FAILED')
require(sha(ROOT/'activate-menu-reminders-20261113.py')==m['driverSha256'],'DRIVER_HASH_FAILED')
require(sha(ROOT/'actual-candidate-tests.json')==m['actualTestsSha256'],'ACTUAL_TEST_PROOF_HASH_FAILED')
proof=json.loads((ROOT/'actual-candidate-tests.json').read_text());require(proof['status']=='PASS'and proof['layoutSha256']==m['layoutSha256']and len(proof['results'])==10,'TESTED_LAYOUT_MISMATCH')
require(sha(ROOT/'source-tests.log')==m['sourceTestsSha256'],'SOURCE_TEST_LOG_HASH_FAILED')
require(sha(ROOT/'dependency-resolution-proof.json')==m['dependencyProofSha256'],'DEPENDENCY_PROOF_HASH_FAILED')
require(json.loads((ROOT/'dependency-resolution-proof.json').read_text())['status']=='PASS','DEPENDENCY_MAPPING_FAILED')
html=next(x for x in files if x['relative']=='index.html');target=PUBLIC/'index.html'
if not args.apply and not args.rollback:
 print(json.dumps({'planOnly':True,'files':files,'databaseOperations':0,'backendChanges':0,'processReloads':0}));raise SystemExit()
locks=[];opened=False;switched=False;record={'owner_task':TASK,'status':'preflight','scope':'primary menus and operations unread frontend only','openedAtUtc':now(),'manifestSha256':manifestSha}
try:
 for path in ['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']:
  f=open(path,'a+');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 state=json.loads(COORD.read_text());require(not state.get('shared_release_active'),'OTHER_RELEASE_ACTIVE')
 if args.rollback:
  require(sha(target)==html['sha256']and sha(ROOT/'index-before.html')==m['beforeHtmlSha256'],'ROLLBACK_EXACT_CAS_FAILED')
  atomic(target,(ROOT/'index-before.html').read_bytes());save(ROOT/'rolled-back.json',{'status':'rolled-back','atUtc':now(),'restoredHtmlSha256':sha(target),'immutableAssetsRetained':True});print('exact HTML rollback complete');raise SystemExit()
 require(not(ROOT/'verified.json').exists(),'ALREADY_DEPLOYED')
 require(sha(target)==m['beforeHtmlSha256'],'FRESH_HTML_BASELINE_CAS_FAILED')
 before=processes();require(any(x['name']=='dianzi51-admin'and x['status']=='online'for x in before),'ADMIN_PROCESS_NOT_ONLINE')
 protected=[]
 for path in m['protectedPaths']:
  require(pathlib.Path(path).exists(),'PROTECTED_PATH_MISSING');protected.append({'path':path,'sha256':sha(path)})
 for x in m['baselineAssets']:
  require(sha(PUBLIC/x['url'].lstrip('/'))==x['sha256'],'BASELINE_ASSET_CHANGED')
 for dependency in m['dependencies']:
  rel=dependency.lstrip('/')
  staged=rel in m['assetPaths']and(ROOT/'candidate'/rel).is_file()
  require(dependency.startswith('/assets/')and((PUBLIC/rel).is_file()or staged),'DEPENDENCY_MISSING_'+dependency)
 save(ROOT/'process-before.json',before);save(ROOT/'protected-files.json',protected);atomic(ROOT/'index-before.html',target.read_bytes(),0o600)
 prehealth=[get('https://www.51dianzi.com/')[0],get('https://admin.51dianzi.com/login')[0]]
 state=json.loads(COORD.read_text());require(not state.get('shared_release_active'),'WINDOW_CHANGED');require(sha(target)==m['beforeHtmlSha256'],'HTML_CHANGED_DURING_PREFLIGHT')
 record['status']='activating';state['shared_release_active']=True;state['window']=record;state['updated_at']=now();save(COORD,state);opened=True
 for x in files:
  if x['relative']=='index.html':continue
  dest=PUBLIC/x['relative'];require(dest.parent.is_dir(),'ASSET_DIRECTORY_MISSING')
  if dest.exists():require(sha(dest)==x['sha256'],'IMMUTABLE_ASSET_CONFLICT')
  else:atomic(dest,(ROOT/'candidate'/x['relative']).read_bytes(),0o644)
 # Fetch immutable resources before switching HTML: no restart or serving gap.
 checks=[]
 for x in files:
  if x['relative']=='index.html':continue
  check,body=get('https://admin.51dianzi.com/'+x['relative']);require(check['sha256']==x['sha256'],'PUBLIC_ASSET_HASH_FAILED');require(not body.lstrip().startswith(b'<!doctype html'),'ASSET_SPA_FALLBACK');checks.append(check)
 require(sha(target)==m['beforeHtmlSha256'],'FINAL_HTML_CAS_FAILED');atomic(target,(ROOT/'candidate/index.html').read_bytes());switched=True
 afterHealth=[]
 for url in ['https://admin.51dianzi.com/login','https://admin.51dianzi.com/workbench/customers']:
  check,body=get(url);require(check['sha256']==html['sha256'],'PUBLIC_HTML_HASH_FAILED');afterHealth.append(check)
 afterHealth.append(get('https://www.51dianzi.com/')[0]);require(processes()==before,'PROCESS_CHANGED')
 for x in protected:require(sha(x['path'])==x['sha256'],'PROTECTED_FILE_CHANGED')
 for x in m['baselineAssets']:require(sha(PUBLIC/x['url'].lstrip('/'))==x['sha256'],'OLD_ASSET_CHANGED')
 require(sha(target)==html['sha256'],'FINAL_HTML_HASH_FAILED')
 state=json.loads(COORD.read_text());require(state.get('window',{}).get('owner_task')==TASK,'COORDINATOR_OWNERSHIP_LOST')
 record.update(status='verified',closedAtUtc=now(),receipt=str(ROOT/'verified.json'));state['shared_release_active']=False;state['window']=record;state.setdefault('window_history',[]).append(record);state['updated_at']=now();save(COORD,state)
 receipt={'status':'verified','manifestSha256':manifestSha,'htmlSha256':html['sha256'],'files':files,'publicAssets':checks,'health':afterHealth,'dependenciesVerified':len(m['dependencies']),'allProcessesUnchanged':True,'allProtectedFilesUnchanged':True,'oldAssetsUnchanged':True,'sourceTests':291,'actualCandidateTests':10,'databaseOperations':0,'backendChanges':0,'permissionChanges':0,'processReloads':0,'loggedInBusinessInteractionVerified':False,'atUtc':now()};save(ROOT/'verified.json',receipt);print(json.dumps({'status':'verified','receipt':str(ROOT/'verified.json'),'files':len(files),'processReloads':0}))
except BaseException as e:
 if isinstance(e,SystemExit)and args.rollback:raise
 rollback=False
 if switched and sha(target)==html['sha256']and sha(ROOT/'index-before.html')==m['beforeHtmlSha256']:
  atomic(target,(ROOT/'index-before.html').read_bytes());rollback=True
 if opened:
  state=json.loads(COORD.read_text())
  if state.get('window',{}).get('owner_task')==TASK:
   record.update(status='failed',closedAtUtc=now());state['shared_release_active']=False;state['window']=record;state.setdefault('window_history',[]).append(record);save(COORD,state)
 failure={'status':'failed','reason':str(e),'exactHtmlRollback':rollback,'atUtc':now()};save(ROOT/'failed.json',failure);print(json.dumps(failure));raise SystemExit(1)
finally:
 for f in reversed(locks):fcntl.flock(f,fcntl.LOCK_UN);f.close()
