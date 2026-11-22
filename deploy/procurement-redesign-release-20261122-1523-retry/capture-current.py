#!/usr/bin/env python3
"""Read-only fresh capture through pinned SSH. No business RPC, locks or writes on server."""
import base64,gzip,hashlib,json,sys
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/.cache/channel-ssh-lib')
import paramiko
W=Path(__file__).resolve().parent; O=W/'capture'; O.mkdir(exist_ok=True)
ROOTS={'front':'/opt/releases/20261031-homepage-banner-v39/front/dist/public','admin':'/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'}
REL='/opt/releases/20261110-customer-workbench-b7f3a2a7e317'
old=json.loads(Path('/home/ubuntu/work/customer-runtime-fix-20261122-1148/release-1214/release-manifest.json').read_text())
extra=[x['path'] for x in old['existingFiles']]+[ROOTS[x['side']]+x['url'] for x in old['assets']]
code=r'''
import os,sys,stat,json,re,hashlib,base64,gzip,subprocess
roots=%r
rel=%r
extra=%r
keys=['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_atime_ns','st_mtime_ns','st_ctime_ns']
records={}; blobs={}
def take(label,path):
 assert os.path.normpath(path)==path and os.path.realpath(path)==path,path
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb') as f: st=os.fstat(f.fileno()); b=f.read();last=os.fstat(f.fileno())
 assert stat.S_ISREG(st.st_mode) and st.st_nlink>0 and len(b)==st.st_size
 assert all(getattr(st,k)==getattr(last,k)==getattr(os.stat(path,follow_symlinks=False),k) for k in keys)
 if not path.startswith(roots['admin']+'/assets/'): assert st.st_nlink==1,path
 records[label]={'path':path,'sha256':hashlib.sha256(b).hexdigest(),'size':len(b),'stat':{k:getattr(st,k) for k in keys}}
 blobs[label]=base64.b64encode(b).decode(); return b
for side in roots:
 take(side+'-html',roots[side]+'/index.html');take(side+'-api',rel+'/'+side+'/dist/index.js')
c=json.loads(take('coord','/opt/ops/51-project-release-coordination-20261027.json'))
assert c.get('shared_release_active') is False and c.get('window',{}).get('status')=='closed' and not c.get('needsOperatorRecovery') and not c.get('window',{}).get('needsOperatorRecovery'),'WINDOW_BUSY'
paths=set(extra)
admin=base64.b64decode(blobs['admin-html']).decode()
maps=re.findall(r'<script[^>]*type=[\"\x27]importmap[\"\x27][^>]*>(.*?)</script>',admin,re.S)
assert len(maps)==1,len(maps)
imports=json.loads(maps[0])['imports']
for u in imports.values():
 if u.startswith('/assets/'): paths.add(roots['admin']+u)
for u in re.findall(r'<(?:link|script)[^>]*(?:href|src)=[\"\x27](/assets/[^\"\x27]+)',admin): paths.add(roots['admin']+u)
for side in roots:
 api=base64.b64decode(blobs[side+'-api']).decode()
 for u in re.findall(r'[\"\x27](\.\./runtime/[^\"\x27]+\.mjs)[\"\x27]',api): paths.add(os.path.normpath(rel+'/'+side+'/dist/'+u))
for i,path in enumerate(sorted(paths)):take('dependency-'+str(i),path)
proc=subprocess.run(['pm2','jlist'],capture_output=True,check=True,timeout=30)
processes=[]
for p in json.loads(proc.stdout):
 e=p.get('pm2_env',{}); processes.append({'id':p.get('pm_id',e.get('pm_id')),'name':p['name'],'pid':p.get('pid'),'status':e.get('status'),'entry':e.get('pm_exec_path')})
# Preserve configuration fingerprints privately; do not expose environment values.
for path in ['/root/.pm2/dump.pm2','/etc/nginx/nginx.conf']:
 if os.path.isfile(path):take('protected-'+str(len(records)),path)
result={'records':records,'blobs':blobs,'adminImports':imports,'processes':processes,'coord':c}
sys.stdout.buffer.write(gzip.compress(json.dumps(result,separators=(',',':')).encode(),6))
''' % (ROOTS,REL,extra)
C=paramiko.SSHClient();C.load_host_keys('/home/ubuntu/work/channel-release-20261121-1837/known_hosts');C.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
 C.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.secrets/channel-deploy-0.pem',allow_agent=False,look_for_keys=False,timeout=15,compress=True)
 i,o,e=C.exec_command("python3 - <<'PY'\n"+code+'\nPY\n',timeout=180);i.close();raw=o.read();err=e.read();assert o.channel.recv_exit_status()==0,err.decode()[:1500]
 j=json.loads(gzip.decompress(raw)); records=j.pop('records');blobs=j.pop('blobs')
 for label,row in records.items():
  data=base64.b64decode(blobs[label]);assert hashlib.sha256(data).hexdigest()==row['sha256']
  if label.startswith('protected-'): continue # configuration bytes never delivered or shared
  ext='.html' if label.endswith('html') else '.json' if label=='coord' else Path(row['path']).suffix
  out=O/(label+ext);out.write_bytes(data);row['local']=str(out)
 (O/'records.json').write_text(json.dumps(records,indent=2)+'\n');(O/'environment.json').write_text(json.dumps(j,indent=2)+'\n')
 print(json.dumps({'status':'FRESH_CLOSED_READ_ONLY_CAPTURE','files':len(records),'api':{s:records[s+'-api']['sha256'] for s in ROOTS},'html':{s:records[s+'-html']['sha256'] for s in ROOTS},'processes':len(j['processes']),'businessRPCs':0},ensure_ascii=False),flush=True)
finally:C.close();print('SSH_CLOSED',flush=True)
