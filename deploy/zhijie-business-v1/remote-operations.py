#!/usr/bin/env python3
"""Additive first-phase release; no business records or original processes changed."""
from pathlib import Path
import fcntl, hashlib, json, os, subprocess, sys, time
ROOT=Path('/opt/ops/20261027-zhijie-business-v1')
LIVE=Path('/opt/releases/20261018-multi-enterprise-v1/admin/dist/public')
NGINX=Path('/etc/nginx/conf.d/dianzi51-admin-subdomain.conf')
SERVICE=Path('/opt/services/zhijie-access-v1')
UNIT=Path('/etc/systemd/system/dianzi51-zhijie-access.service')
ENV=Path('/opt/config/dianzi51-admin/runtime.env')
sha=lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
def run(args):return subprocess.check_output(args,text=True,timeout=90)
def processes():
 return [{'id':x['pm_id'],'name':x['name'],'pid':x['pid'],'cwd':x['pm2_env'].get('pm_cwd'),'started':x['pm2_env'].get('pm_uptime'),'restarts':x['pm2_env'].get('restart_time')} for x in json.loads(run(['pm2','jlist']))]
def atomic(path,content,mode=0o644):
 temp=path.with_suffix(path.suffix+'.zhijie-next');temp.write_bytes(content);temp.chmod(mode);os.replace(temp,path)
def http(path,expected=None):
 output=run(['curl','--silent','--show-error','--max-time','15','--resolve','admin.51dianzi.com:443:127.0.0.1','-w','\n%{http_code}','https://admin.51dianzi.com'+path]);body,status=output.rsplit('\n',1)
 if expected is not None:assert int(status)==expected,('HTTP',path,status)
 return body
mode=sys.argv[1]
if mode=='capture':
 ROOT.mkdir(parents=True,exist_ok=True)
 assert not (ROOT/'before.json').exists(),'baseline already exists'
 assert ENV.is_file() and (ENV.stat().st_mode&0o077)==0,'unsafe runtime env'
 files={str(p):sha(p) for p in LIVE.rglob('*') if p.is_file()}
 for p in Path('/etc/nginx/conf.d').glob('*'):
  if p.is_file() and p.suffix in ('.conf','.inc'):files[str(p)]=sha(p)
 rows=processes();admins=[p for p in rows if p['name']=='dianzi51-admin'];assert admins and len(set(p['cwd'] for p in admins))==1
 backend=Path(admins[0]['cwd']);assert (backend/'node_modules').exists()
 for p in rows:
  if p['name'].startswith('dianzi51'):
   script=Path(p['cwd'])/'dist/index.js'
   if script.exists():files[str(script)]=sha(script)
 snapshot={'files':files,'processes':rows,'backend':str(backend),'html':sha(LIVE/'index.html'),'nginx':sha(NGINX),'time':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
 (ROOT/'before.json').write_text(json.dumps(snapshot,indent=2)+'\n');(ROOT/'before-index.html').write_bytes((LIVE/'index.html').read_bytes());(ROOT/'before-nginx.conf').write_bytes(NGINX.read_bytes())
 print(json.dumps({'captured':True,'protectedFiles':len(files),'html':snapshot['html'],'adminProcesses':len(admins)}));sys.exit()
snapshot=json.loads((ROOT/'before.json').read_text());manifest=json.loads((ROOT/'payload/manifest.json').read_text())
def check(excluded=()):
 for p,digest in snapshot['files'].items():
  if p not in excluded:assert sha(p)==digest,'protected file changed '+p
 assert processes()==snapshot['processes'],'original process changed'
 assert sha(ROOT/'payload/index.html')==manifest['newHtmlSha256'],'input HTML mismatch'
 for f in manifest['files']:assert sha(ROOT/'payload'/f['name'])==f['sha256'],'input asset mismatch'
 assert snapshot['html']==manifest['oldHtmlSha256'],'not captured HTML baseline'
 assert sha(LIVE/manifest['mainOriginal'].lstrip('/'))==manifest['oldMainSha256'],'main baseline changed'
 oldmap=json.loads(__import__('re').findall(r'<script type="importmap">([\s\S]*?)</script>',(ROOT/'before-index.html').read_text())[0])['imports']
 oldlayout=oldmap[manifest['layoutOriginal']]
 assert sha(LIVE/oldlayout.lstrip('/'))==manifest['oldLayoutSha256'],'layout baseline changed'
 return len(snapshot['files'])
if mode=='stage':
 count=check();assert sha(NGINX)==snapshot['nginx'];assert not SERVICE.exists() and not UNIT.exists(),'service already exists'
 run(['nginx','-t']);print(json.dumps({'staged':True,'protectedFiles':count,'businessDataDisconnected':True}));sys.exit()
if mode=='recover-stage':
 count=check();assert sha(NGINX)==snapshot['nginx'];assert not UNIT.exists(),'unit exists; inspect rather than reset'
 assert SERVICE.exists() and (SERVICE/'start.mjs').is_file(),'not the failed staged service'
 assert sha(SERVICE/'service.mjs')==sha(ROOT/'payload/service.mjs'),'unexpected staged code'
 probe=subprocess.run(['curl','-fsS','--max-time','2','http://127.0.0.1:3019/health'],capture_output=True)
 assert probe.returncode!=0,'service is running; inspect instead of replacing'
 backup=ROOT/'failed-service-schema-check';assert not backup.exists(),'failed stage already preserved'
 SERVICE.rename(backup);print(json.dumps({'recoveredStagingOnly':True,'protectedFiles':count,'failedFilesPreserved':True,'tablesRetained':True}));sys.exit()
if mode=='loading-fix':
 with open('/var/lock/dianzi51-public-deploy.lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  receipt=json.loads((ROOT/'applied.json').read_text());assert sha(LIVE/'index.html')==snapshot['html'],'expected safely restored old HTML'
  assert sha(NGINX)==receipt['nginx'],'concurrent Nginx change'
  check([str(NGINX)]);assert json.loads(run(['curl','-fsS','http://127.0.0.1:3019/health']))['businessBridge']=='disconnected'
  for f in manifest['files']:
   target=LIVE/'assets'/f['name']
   if target.exists():assert sha(target)==f['sha256'],'hash collision'
   else:atomic(target,(ROOT/'payload'/f['name']).read_bytes())
  try:
   atomic(LIVE/'index.html',(ROOT/'payload/index.html').read_bytes());check([str(LIVE/'index.html'),str(NGINX)])
   assert hashlib.sha256(http('/zhijie/team-access',200).encode()).hexdigest()==manifest['newHtmlSha256']
   for f in manifest['files']:assert hashlib.sha256(http('/assets/'+f['name'],200).encode()).hexdigest()==f['sha256']
   receipt['html']=manifest['newHtmlSha256'];receipt['loadingOrderFixed']=True;receipt['isolatedAnonymousLoginAndModuleImportsPassed']=True
   receipt['time']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());atomic(ROOT/'applied.json',(json.dumps(receipt,indent=2)+'\n').encode(),0o600)
   print(json.dumps({'loadingFixApplied':True,'html':receipt['html'],'originalProcessesUnchanged':True,'businessBridge':'disconnected'}))
  except Exception:
   if sha(LIVE/'index.html')==manifest['newHtmlSha256']:atomic(LIVE/'index.html',(ROOT/'before-index.html').read_bytes())
   raise
 sys.exit()
if mode=='verify':
 assert sha(LIVE/'index.html')==manifest['newHtmlSha256'];count=check([str(LIVE/'index.html'),str(NGINX)])
 assert json.loads(run(['curl','-fsS','http://127.0.0.1:3019/health']))['businessBridge']=='disconnected'
 assert hashlib.sha256(http('/zhijie/team-access',200).encode()).hexdigest()==manifest['newHtmlSha256']
 for f in manifest['files']:assert hashlib.sha256(http('/assets/'+f['name'],200).encode()).hexdigest()==f['sha256']
 assert json.loads(http('/api/zhijie/context',401))['error']=='LOCAL_ADMIN_REQUIRED'
 print(json.dumps({'verified':True,'protectedFiles':count,'anonymousDenied':True,'originalProcessesUnchanged':True,'businessBridge':'disconnected'}));sys.exit()
assert mode=='apply'
with open('/var/lock/dianzi51-public-deploy.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);assert not (ROOT/'applied.json').exists(),'already applied'
 check();assert not SERVICE.exists() and not UNIT.exists();assert sha(NGINX)==snapshot['nginx']
 SERVICE.mkdir(parents=True);(SERVICE/'node_modules').symlink_to(Path(snapshot['backend'])/'node_modules',target_is_directory=True)
 for name in ['service.mjs','apply-zhijie-access-schema.mjs','zhijie-access-schema.mjs']:(SERVICE/name).write_bytes((ROOT/'payload'/name).read_bytes())
 launcher="import dotenv from 'dotenv';\ndotenv.config({path:'/opt/config/dianzi51-admin/runtime.env',override:true});\nprocess.env.NODE_ENV='production';process.env.HOST='127.0.0.1';process.env.PORT='3019';\nawait import('./service.mjs');\n"
 (SERVICE/'start.mjs').write_text(launcher)
 unit='[Unit]\nDescription=51dianzi Zhijie business access (phase one)\nAfter=network-online.target\n[Service]\nType=simple\nWorkingDirectory=/opt/services/zhijie-access-v1\nExecStart=/usr/bin/node /opt/services/zhijie-access-v1/start.mjs\nRestart=on-failure\nRestartSec=5\nUMask=0077\n[Install]\nWantedBy=multi-user.target\n'
 swapped=False
 try:
  # This migration creates only two empty access tables. Original CRM/order DB is untouched.
  schema=run(['node',str(SERVICE/'apply-zhijie-access-schema.mjs'),'--from-runtime-env',str(ENV)])
  (ROOT/'schema-verification.txt').write_text(schema)
  atomic(UNIT,unit.encode());run(['systemctl','daemon-reload']);run(['systemctl','enable','--now','dianzi51-zhijie-access.service'])
  for attempt in range(15):
   try:
    health=json.loads(run(['curl','-fsS','--max-time','3','http://127.0.0.1:3019/health']));assert health['businessBridge']=='disconnected';break
   except Exception:
    if attempt==14:raise
    time.sleep(1)
  nginx=NGINX.read_text();marker='    location ^~ /api/ {';assert nginx.count(marker)==1
  location='    # Zhijie phase-one access API: original business bridge remains disconnected\n    location ^~ /api/zhijie/ {\n        proxy_pass http://127.0.0.1:3019;\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n        proxy_read_timeout 20s;\n        add_header Cache-Control "private, no-store, max-age=0" always;\n    }\n\n'
  for f in manifest['files']:
   target=LIVE/'assets'/f['name']
   if target.exists():assert sha(target)==f['sha256'],'hash collision'
   else:atomic(target,(ROOT/'payload'/f['name']).read_bytes())
  check();atomic(NGINX,nginx.replace(marker,location+marker).encode());run(['nginx','-t']);run(['systemctl','reload','nginx'])
  atomic(LIVE/'index.html',(ROOT/'payload/index.html').read_bytes());swapped=True
  check([str(LIVE/'index.html'),str(NGINX)])
  assert json.loads(http('/api/zhijie/context',401))['error']=='LOCAL_ADMIN_REQUIRED'
  assert hashlib.sha256(http('/zhijie/team-access',200).encode()).hexdigest()==manifest['newHtmlSha256']
  for f in manifest['files']:assert hashlib.sha256(http('/assets/'+f['name'],200).encode()).hexdigest()==f['sha256']
  result={'applied':True,'time':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'html':manifest['newHtmlSha256'],'nginx':sha(NGINX),'service':'dianzi51-zhijie-access','privateListener':'127.0.0.1:3019','protectedFiles':len(snapshot['files']),'originalProcessesUnchanged':True,'businessDataDisconnected':True,'staffAuthorizationsSeeded':False,'authenticatedUiVerification':'pending real admin login'}
  (ROOT/'applied.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
 except Exception:
  if swapped and sha(LIVE/'index.html')==manifest['newHtmlSha256']:atomic(LIVE/'index.html',(ROOT/'before-index.html').read_bytes())
  atomic(NGINX,(ROOT/'before-nginx.conf').read_bytes());subprocess.run(['nginx','-t'],check=True);subprocess.run(['systemctl','reload','nginx'],check=True)
  subprocess.run(['systemctl','disable','--now','dianzi51-zhijie-access.service'],check=False)
  raise
