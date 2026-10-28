#!/usr/bin/env python3
"""Execute on ECS via stdin. Publishes only three content-addressed assets and HTML."""
from pathlib import Path
import hashlib, json, os, shutil, stat, subprocess, fcntl, datetime
PUBLIC = Path('/opt/releases/20261019-approval-sync-v1/admin/dist/public')
BACKEND = Path('/opt/releases/20261020-erp-certification-unified-v1/admin/dist/index.js')
UPLOAD = Path('/tmp/cn-review-display-RP8XvX8GVfYKmIsx3rS8D5')
manifest = json.loads((UPLOAD / 'manifest.json').read_text())
EXPECTED = {
 'merchant':'148b184dd7bdde0f6ef08184a40df03d9363a5333f952c4aaf5d40a9d28d9de0',
 'messages':'e0e10f0fd8ffa44a4ac56a03a2a22f8257d4ea85ccd269bb9ef0279a1f09e534',
 'dashboard':'7f6d6fc75a8bf67581d0c90d9ff688204f70ae0a788521e92e91f38679b4f687',
 'html':'9381eca8adefa5d320efb15ca370fe73762a2c26856ef1c4fb67cab25bbd53aa'}
EXPECTED_NEW = {
 'merchant':'adc6198c54ccaa09c96288f1350da7a2debe106310b68d264265e850903e42e4',
 'messages':'fd62d9eb834a9f60ee3184e2b8b626920baaf74d58b4fa9a3b670c90b24c9923',
 'dashboard':'f47b71280a7dfdff408798597ba545f1fc6aa8525481ca2cfeeca5a8ee4ff024',
 'html':'3c722250846fe8bf7411f3ba59440f3c1c8e875f123b8adcb5e6a2f9fbbe2c2a'}
OLD = {'merchant':'Merchants-review-readable-148b184dd7bdde0f.js','messages':'Messages-review-dialog-notice-e0e10f0fd8ffa44a.js','dashboard':'DashboardLayout-platform-navigation-7f6d6fc75a8bf675.js'}
NAMES = {'merchant':'Merchants-review-display-adc6198c54ccaa09.js','messages':'Messages-review-display-fd62d9eb834a9f60.js','dashboard':'DashboardLayout-review-display-f47b71280a7dfdff.js'}
BACKEND_SHA = '236ea7579bae39126dcb3ab27dcad8a90348e13fc59a5cf2083985a40ba5e369'
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def require(ok, msg):
 if not ok: raise RuntimeError(msg)
def check_baselines():
 require(digest(BACKEND) == BACKEND_SHA, 'Backend changed; no overwrite or reload permitted')
 require(digest(PUBLIC/'index.html') == EXPECTED['html'], 'HTML baseline conflict')
 for key, name in OLD.items(): require(digest(PUBLIC/'assets'/name)==EXPECTED[key], 'Old asset conflict: '+key)
lock = open('/var/lock/dianzi51-admin-cn-review-date.lock','a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
require(manifest['before']==EXPECTED and manifest['after']==EXPECTED_NEW and manifest['names']==NAMES, 'Unexpected manifest')
check_baselines()
require(digest(UPLOAD/'index.html')==EXPECTED_NEW['html'],'Upload HTML mismatch')
old_html=(PUBLIC/'index.html').read_text()
new_html=(UPLOAD/'index.html').read_text()
expected_html=old_html
for key in OLD:
 name=NAMES[key]
 require(digest(UPLOAD/name)==EXPECTED_NEW[key], 'New asset mismatch: '+key)
 require(not (PUBLIC/'assets'/name).exists(),'Refuse to overwrite existing content-addressed asset')
 subprocess.run(['node','--check',str(UPLOAD/name)],check=True)
 a='/assets/'+OLD[key];b='/assets/'+name
 require(expected_html.count(json.dumps(a))==1,'Nonunique import-map destination')
 expected_html=expected_html.replace(json.dumps(a),json.dumps(b))
require(expected_html==new_html,'Unexpected HTML change outside the three import-map destinations')
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=Path('/opt/backups/dianzi51-admin')/('cn-review-display-consistency-'+stamp)
backup.mkdir(parents=True,exist_ok=False)
shutil.copy2(PUBLIC/'index.html',backup/'index.html.before')
for key,name in OLD.items(): shutil.copy2(PUBLIC/'assets'/name,backup/(key+'.before.js'))
shutil.copy2(UPLOAD/'manifest.json',backup/'manifest.json')
require(digest(backup/'index.html.before')==EXPECTED['html'],'Backup mismatch')
swapped=False
temp=PUBLIC/('.index.cn-review-display-'+stamp+'.new.html')
try:
 for key,name in NAMES.items():
  target=PUBLIC/'assets'/name
  with open(target,'xb') as f: f.write((UPLOAD/name).read_bytes());f.flush();os.fsync(f.fileno())
  os.chmod(target,0o644)
  require(digest(target)==EXPECTED_NEW[key],'Installed asset mismatch')
 shutil.copy2(UPLOAD/'index.html',temp)
 metadata=(PUBLIC/'index.html').stat();os.chmod(temp,stat.S_IMODE(metadata.st_mode));os.chown(temp,metadata.st_uid,metadata.st_gid)
 require(digest(temp)==EXPECTED_NEW['html'],'Staged HTML mismatch')
 check_baselines()
 os.replace(temp,PUBLIC/'index.html');swapped=True
 require(digest(PUBLIC/'index.html')==EXPECTED_NEW['html'],'Final HTML mismatch')
 require(digest(BACKEND)==BACKEND_SHA,'Unexpected backend changed concurrently')
 for key,name in OLD.items(): require(digest(PUBLIC/'assets'/name)==EXPECTED[key],'Old immutable asset changed')
 print(json.dumps({'status':'FRONTEND_DEPLOY_SUCCESS','backup':str(backup),'before':EXPECTED,'after':EXPECTED_NEW,'backendSha256':digest(BACKEND),'backendReloaded':False,'oldAssetsPreserved':True},ensure_ascii=False))
except Exception:
 if swapped:
  require(digest(PUBLIC/'index.html')==EXPECTED_NEW['html'],'External HTML change after swap; manual resolution required')
  shutil.copy2(backup/'index.html.before',temp);os.chown(temp,metadata.st_uid,metadata.st_gid);os.replace(temp,PUBLIC/'index.html')
  print('FRONTEND_ROLLED_BACK; backend left untouched; new unused hash assets retained')
 raise
finally:
 fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
