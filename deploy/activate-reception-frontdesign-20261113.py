#!/usr/bin/env python3
import argparse, pathlib, json, hashlib, subprocess, fcntl, os, tempfile, datetime, urllib.request, concurrent.futures
ROOT=pathlib.Path('/opt/ops/20261113-reception-frontdesign-IUpdaAmZ')
PUBLIC=pathlib.Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
COORD=pathlib.Path('/opt/ops/51-project-release-coordination-20261027.json')
TASK='IUpdaAmZm3xXTSJGJo5PDu'
def require(ok,msg):
 if not ok:raise RuntimeError(msg)
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def atomic(p,data,mode=None):
 p=pathlib.Path(p);old=p.stat()if p.exists()else None;fd,tmp=tempfile.mkstemp(prefix='.reception-experience-',dir=p.parent)
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
m=json.loads((ROOT/'manifest.json').read_text());files=m['files'];digest=sha(ROOT/'manifest.json');require(m['ownerTask']==TASK and len(files)==4,'FIXED_MANIFEST_SCOPE_FAILED')
require(len({x['relative']for x in files})==len(files),'DUPLICATE_UPLOAD_PATH')
require({x['relative']for x in files}=={'index.html',*m['coreAssetPaths'],*m['stickerAssetPaths']},'EXACT_FILE_SET_FAILED')
require(len(m['coreAssetPaths'])==3 and not m['stickerAssetPaths'],'EXACT_ASSET_COUNTS_FAILED')
for x in files:
 rel=pathlib.PurePosixPath(x['relative']);require(not rel.is_absolute()and '..'not in rel.parts,'UNSAFE_PATH')
 require(x['relative']=='index.html'or x['relative']in m['coreAssetPaths']or rel.parts[0]in ['chat-stickers','chat-sticker-tabs'],'OUTSIDE_ALLOWLIST')
 require((PUBLIC/x['relative']).resolve().is_relative_to(PUBLIC.resolve()),'OUTSIDE_PUBLIC_ROOT')
 require(sha(ROOT/'candidate'/x['relative'])==x['sha256'],'CANDIDATE_HASH_FAILED')
require(sha(ROOT/'activate-reception-frontdesign-20261113.py')==m['driverSha256'],'DRIVER_HASH_FAILED')
for name,expected in m['evidenceHashes'].items():require(sha(ROOT/name)==expected,'EVIDENCE_HASH_CHANGED_'+name)
ui=json.loads((ROOT/'actual-ui-tests.json').read_text());chat=json.loads((ROOT/'actual-chat-tests.json').read_text());deps=json.loads((ROOT/'dependency-resolution-proof.json').read_text())
require(ui['status']=='PASS'and len(ui['results'])>=10 and ui['actualCandidatePatchBytesExecuted'],'ACTUAL_UI_TESTS_REQUIRED')
require(chat['status']=='PASS'and deps['status']=='PASS','ACTUAL_CHAT_AND_DEPENDENCIES_REQUIRED')
for x in ui['inputs']:require(any(r['relative']==x['relative']and r['sha256']==x['sha256']for r in files),'UI_TESTED_INPUT_CHANGED')
require(chat['actualCandidatePatchBytesExecuted']and chat['identicalActualPsAcrossBothWorkbenches']and chat['identicalActualHelperAcrossBothWorkbenches'],'NATIVE_IDENTICAL_CODE_PROOF_REQUIRED')
require(len(chat['inputs'])==2,'BOTH_CHAT_INPUTS_REQUIRED')
for x in chat['inputs']:require(any(r['relative']==x['relative']and r['sha256']==x['sha256']for r in m['baselineAssets']),'PREVIOUS_CHAT_TESTED_BASELINE_CHANGED')
require(m['sourceTestFailures']==0 and m['tscPassed']and m['nativeInputVerificationPassed'],'SOURCE_OR_NATIVE_TEST_FAILURE')
for idx,x in enumerate(chat['inputs']):
 proof=json.loads((ROOT/f'workbench-{idx}-build-proof.json').read_text());require(proof['allPriorChatCodeUnchanged']and proof['exactInverse']and proof['chatFunctionSha256']==x['actualPsSha256']and proof['chatHelpersSha256']==x['actualHelpersSha256'],'PRIOR_CHAT_CODE_MUST_STAY_IDENTICAL')
html=next(x for x in files if x['relative']=='index.html');target=PUBLIC/'index.html'
if not args.apply and not args.rollback:
 print(json.dumps({'planOnly':True,'fileCount':len(files),'stickerFiles':0,'coreAssets':3,'databaseOperations':0,'backendChanges':0,'processReloads':0}));raise SystemExit()
locks=[];opened=False;switched=False;record={'owner_task':TASK,'status':'preflight','scope':'front ChatPage three-column inquiry UI and CSS only; all chat code untouched','openedAtUtc':now(),'manifestSha256':digest}
try:
 for path in ['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']:
  f=open(path,'a+');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
 state=json.loads(COORD.read_text());require(not state.get('shared_release_active'),'OTHER_RELEASE_ACTIVE')
 if args.rollback:
  require(sha(target)==html['sha256']and sha(ROOT/'index-before.html')==m['beforeHtmlSha256'],'ROLLBACK_EXACT_CAS_FAILED')
  atomic(target,(ROOT/'index-before.html').read_bytes());save(ROOT/'rolled-back.json',{'status':'rolled-back','atUtc':now(),'restoredHtmlSha256':sha(target),'additiveAssetsRetained':True});print('exact HTML rollback complete');raise SystemExit()
 require(not(ROOT/'verified.json').exists(),'ALREADY_VERIFIED');require(sha(target)==m['beforeHtmlSha256'],'FRESH_HTML_BASELINE_CAS_FAILED')
 before=processes();require(any(x['name']=='dianzi51-admin'and x['status']=='online'for x in before),'ADMIN_NOT_ONLINE')
 protected=[]
 for path in m['protectedPaths']:
  require(pathlib.Path(path).is_file(),'PROTECTED_PATH_MISSING');protected.append({'path':path,'sha256':sha(path)})
 for x in m['baselineAssets']:require(sha(PUBLIC/x['relative'])==x['sha256'],'BASELINE_ASSET_CHANGED')
 for dep in m['dependencies']:
  require(dep.startswith('/assets/'),'DEPENDENCY_PREFIX_FAILED');rel=dep.lstrip('/');require((PUBLIC/rel).is_file()or(rel in m['coreAssetPaths']and(ROOT/'candidate'/rel).is_file()),'DEPENDENCY_MISSING_'+rel)
 for x in files:
  if x['relative']!='index.html'and(PUBLIC/x['relative']).exists():require(sha(PUBLIC/x['relative'])==x['sha256'],'NO_OVERWRITE_EXISTING_ASSETS_'+x['relative'])
 save(ROOT/'process-before.json',before);save(ROOT/'protected-files.json',protected);atomic(ROOT/'index-before.html',target.read_bytes(),0o600)
 get('https://www.51dianzi.com/');check,_=get('https://admin.51dianzi.com/workbench/inquiries');require(check['sha256']==m['beforeHtmlSha256'],'PUBLIC_BASELINE_HTML_MISMATCH')
 state=json.loads(COORD.read_text());require(not state.get('shared_release_active')and sha(target)==m['beforeHtmlSha256'],'WINDOW_OR_HTML_CHANGED')
 record['status']='activating';state['shared_release_active']=True;state['window']=record;state['updated_at']=now();save(COORD,state);opened=True
 print('Installing additive assets; original HTML remains live',flush=True)
 for x in files:
  if x['relative']=='index.html':continue
  dest=PUBLIC/x['relative']
  if not dest.parent.exists():
   require(pathlib.PurePosixPath(x['relative']).parts[0]in ['chat-stickers','chat-sticker-tabs'],'NO_NEW_UNRELATED_DIRECTORIES');dest.parent.mkdir(parents=True,exist_ok=True)
  if dest.exists():require(sha(dest)==x['sha256'],'ASSET_CAS_CHANGED')
  else:atomic(dest,(ROOT/'candidate'/x['relative']).read_bytes(),0o644)
 checks=[];verify=[x for x in files if x['relative']!='index.html']+m['existingCatalogImages']
 def verify_one(x):
  r,body=get('https://admin.51dianzi.com/'+x['relative']);require(r['sha256']==x['sha256'],'PUBLIC_ASSET_HASH_FAILED_'+x['relative']);require(not body.lstrip().lower().startswith(b'<!doctype html'),'ASSET_SPA_FALLBACK');return r
 with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
  for i,result in enumerate(pool.map(verify_one,verify),1):
   checks.append(result)
   if i%25==0 or i==len(verify):print(f'Public resource verification {i}/{len(verify)}',flush=True)
 require(sha(target)==m['beforeHtmlSha256'],'FINAL_HTML_CAS_FAILED');atomic(target,(ROOT/'candidate/index.html').read_bytes());switched=True
 health=[]
 for url in ['https://admin.51dianzi.com/login','https://admin.51dianzi.com/workbench/inquiries','https://admin.51dianzi.com/workbench/customers']:
  check,_=get(url);require(check['sha256']==html['sha256'],'PUBLIC_HTML_HASH_FAILED');health.append(check)
 health.append(get('https://www.51dianzi.com/')[0]);require(processes()==before,'PROCESS_CHANGED')
 for x in protected:require(sha(x['path'])==x['sha256'],'PROTECTED_FILE_CHANGED')
 for x in m['baselineAssets']:require(sha(PUBLIC/x['relative'])==x['sha256'],'OLD_ASSET_CHANGED')
 require(sha(target)==html['sha256'],'FINAL_HTML_HASH_FAILED')
 state=json.loads(COORD.read_text());require(state.get('window',{}).get('owner_task')==TASK,'WINDOW_OWNERSHIP_LOST');record.update(status='verified',closedAtUtc=now(),receipt=str(ROOT/'verified.json'));state['shared_release_active']=False;state['window']=record;state.setdefault('window_history',[]).append(record);state['updated_at']=now();save(COORD,state)
 receipt={'status':'verified','atUtc':now(),'manifestSha256':digest,'htmlSha256':html['sha256'],'files':files,'publicAssets':checks,'health':health,'sourceTests':m['sourceTestCount'],'actualUITests':m['actualUITestCount'],'nativeChatTests':m['nativeChatTestCount'],'allProtectedFilesUnchanged':True,'oldAssetsUnchanged':True,'allProcessesUnchanged':True,'databaseOperations':0,'backendChanges':0,'permissionChanges':0,'processReloads':0,'loggedInBusinessInteractionVerified':False};save(ROOT/'verified.json',receipt);print(json.dumps({'status':'verified','receipt':str(ROOT/'verified.json'),'files':len(files),'processReloads':0}))
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
