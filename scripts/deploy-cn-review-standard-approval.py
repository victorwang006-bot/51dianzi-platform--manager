#!/usr/bin/env python3
"""Execute on ECS via stdin. Code/asset deployment only; no business DML or approvals."""
from pathlib import Path
import hashlib, json, os, shutil, stat, subprocess, fcntl, datetime
ROOT=Path('/opt/releases/20261020-erp-certification-unified-v1/admin')
BACKEND=ROOT/'dist/index.js'
PUBLIC=Path('/opt/releases/20261019-approval-sync-v1/admin/dist/public')
UPLOAD=Path('/tmp/cn-review-standard-RP8XvX8GVfYKmIsx3rS8D5')
MANIFEST_SHA='9278e244b0127d0a0c33e2befd73d6906620aa609b0443cbda34aa8455d83d76'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def require(ok,message):
 if not ok:raise RuntimeError(message)
require(digest(UPLOAD/'manifest.json')==MANIFEST_SHA,'Unexpected manifest')
m=json.loads((UPLOAD/'manifest.json').read_text())
OLD={'merchant':'Merchants-review-display-adc6198c54ccaa09.js','messages':'Messages-review-display-fd62d9eb834a9f60.js','dashboard':'DashboardLayout-review-display-f47b71280a7dfdff.js'}
KEYS=['merchant','messages','dashboard']
def check_baselines():
 require(digest(BACKEND)==m['before']['backend'],'Backend conflict; refuse overwrite')
 require(digest(PUBLIC/'index.html')==m['before']['html'],'HTML conflict; refuse overwrite')
 for k,name in OLD.items():require(digest(PUBLIC/'assets'/name)==m['before'][k],'Old asset conflict: '+k)
def apps():
 return [p for p in json.loads(subprocess.check_output(['pm2','jlist'],text=True)) if p['name']=='dianzi51-admin']
def verify_apps():
 p=apps();require(len(p)==2 and all(x['pm2_env']['status']=='online' and x['pm2_env']['pm_cwd']==str(ROOT) and x['pm2_env']['pm_exec_path']==str(BACKEND) and x['pm2_env']['exec_mode']=='cluster_mode' for x in p),'Unexpected PM2 target/status');return p
lock=open('/var/lock/dianzi51-admin-cn-review-date.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
check_baselines();verify_apps()
require(digest(UPLOAD/'index.backend.js')==m['after']['backend'],'Uploaded backend mismatch')
require(digest(UPLOAD/'index.html')==m['after']['html'],'Uploaded HTML mismatch')
subprocess.run(['node','--check',str(UPLOAD/'index.backend.js')],check=True)
a=BACKEND.read_text();b=(UPLOAD/'index.backend.js').read_text()
def owner_prefix(s,marker):
 start=s.index('function cnReviewAssertSubject(');return s[start:s.index(marker,start)]
require(owner_prefix(a,'  // A legal-subject')==owner_prefix(b,'  // Authorized profile reviews'),'Credit/owner guards changed')
def audit(s):
 start=s.index('    await tx.insert(auditLogs).values({',s.index('async function reviewCnRegistrationDraft('));return s[start:s.index('function cnPendingReviewMerchantCondition(',start)]
require(audit(a)==audit(b),'Existing audit/return contract changed')
old_html=(PUBLIC/'index.html').read_text();expected_html=old_html
for k in KEYS:
 name=m['names'][k];require('/' not in name and name.endswith('.js'),'Unsafe new asset name')
 require(digest(UPLOAD/name)==m['after'][k],'Uploaded asset mismatch: '+k)
 require(not(PUBLIC/'assets'/name).exists(),'Refuse to overwrite immutable new asset: '+k)
 subprocess.run(['node','--check',str(UPLOAD/name)],check=True)
 old='/assets/'+OLD[k];new='/assets/'+name
 require(expected_html.count(json.dumps(old))==1,'Nonunique import-map destination')
 expected_html=expected_html.replace(json.dumps(old),json.dumps(new))
require(expected_html==(UPLOAD/'index.html').read_text(),'Unexpected HTML change')
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=Path('/opt/backups/dianzi51-admin')/('cn-review-standard-approval-'+stamp);backup.mkdir(parents=True,exist_ok=False)
shutil.copy2(BACKEND,backup/'index.js.before');shutil.copy2(PUBLIC/'index.html',backup/'index.html.before')
for k,name in OLD.items():shutil.copy2(PUBLIC/'assets'/name,backup/(k+'.before.js'))
shutil.copy2(UPLOAD/'manifest.json',backup/'manifest.json')
backend_temp=ROOT/'dist'/('.index.cn-review-standard-'+stamp+'.new.js');html_temp=PUBLIC/('.index.cn-review-standard-'+stamp+'.new.html')
backend_meta=BACKEND.stat();html_meta=(PUBLIC/'index.html').stat()
backend_swapped=False;html_swapped=False
try:
 for k in KEYS:
  target=PUBLIC/'assets'/m['names'][k]
  with target.open('xb') as f:f.write((UPLOAD/m['names'][k]).read_bytes());f.flush();os.fsync(f.fileno())
  os.chmod(target,0o644);require(digest(target)==m['after'][k],'Installed asset mismatch')
 shutil.copy2(UPLOAD/'index.backend.js',backend_temp);os.chmod(backend_temp,stat.S_IMODE(backend_meta.st_mode));os.chown(backend_temp,backend_meta.st_uid,backend_meta.st_gid)
 shutil.copy2(UPLOAD/'index.html',html_temp);os.chmod(html_temp,stat.S_IMODE(html_meta.st_mode));os.chown(html_temp,html_meta.st_uid,html_meta.st_gid)
 require(digest(backend_temp)==m['after']['backend'] and digest(html_temp)==m['after']['html'],'Staged file mismatch')
 check_baselines()
 os.replace(backend_temp,BACKEND);backend_swapped=True
 subprocess.run(['pm2','reload','dianzi51-admin'],check=True);p=verify_apps()
 subprocess.run(['curl','--max-time','15','-fsS','http://127.0.0.1:3001/api/trpc/auth.me'],check=True,stdout=subprocess.DEVNULL)
 require(digest(PUBLIC/'index.html')==m['before']['html'],'HTML changed during reload')
 os.replace(html_temp,PUBLIC/'index.html');html_swapped=True
 require(digest(BACKEND)==m['after']['backend'] and digest(PUBLIC/'index.html')==m['after']['html'],'Final file drift')
 for k,name in OLD.items():require(digest(PUBLIC/'assets'/name)==m['before'][k],'Old asset changed')
 print(json.dumps({'status':'STANDARD_APPROVAL_CODE_DEPLOY_SUCCESS','backup':str(backup),'before':m['before'],'after':m['after'],'backendReloaded':True,'oldAssetsPreserved':True,'pm2':[{'id':x['pm_id'],'pid':x['pid'],'status':x['pm2_env']['status']} for x in p],'businessApprovalExecuted':False,'businessDmlExecuted':False}))
except Exception:
 if html_swapped:
  require(digest(PUBLIC/'index.html')==m['after']['html'],'External HTML change; manual resolution required')
  shutil.copy2(backup/'index.html.before',html_temp);os.chown(html_temp,html_meta.st_uid,html_meta.st_gid);os.replace(html_temp,PUBLIC/'index.html')
 if backend_swapped:
  require(digest(BACKEND)==m['after']['backend'],'External backend change; manual resolution required')
  shutil.copy2(backup/'index.js.before',backend_temp);os.chown(backend_temp,backend_meta.st_uid,backend_meta.st_gid);os.replace(backend_temp,BACKEND)
  subprocess.run(['pm2','reload','dianzi51-admin'],check=True)
 print('STANDARD_RULE_STAGE_ROLLED_BACK; prior date/detail/display patches preserved; no business data reverted')
 raise
finally:fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
