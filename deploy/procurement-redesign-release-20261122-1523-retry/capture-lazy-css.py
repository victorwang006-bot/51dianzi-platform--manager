#!/usr/bin/env python3
import sys,json,hashlib,gzip,base64
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/.cache/channel-ssh-lib');import paramiko
W=Path(__file__).resolve().parent;root='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public';urls=['/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/BusinessWorkbenchPage-Y3iALNaz.css','/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/DashboardLayout-DJvFUGq1.css']
code=r'''
import os,stat,json,hashlib,base64,gzip,sys
keys=['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_atime_ns','st_mtime_ns','st_ctime_ns'];out=[]
for path in %r:
 assert os.path.normpath(path)==os.path.realpath(path)==path
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:st=os.fstat(f.fileno());b=f.read();end=os.fstat(f.fileno())
 assert stat.S_ISREG(st.st_mode) and st.st_nlink>0 and all(getattr(st,k)==getattr(end,k)==getattr(os.stat(path,follow_symlinks=False),k)for k in keys)
 out.append({'path':path,'sha256':hashlib.sha256(b).hexdigest(),'size':len(b),'stat':{k:getattr(st,k)for k in keys},'bytes':base64.b64encode(b).decode()})
sys.stdout.buffer.write(gzip.compress(json.dumps(out).encode()))
'''%[root+u for u in urls]
C=paramiko.SSHClient();C.load_host_keys('/home/ubuntu/work/channel-release-20261121-1837/known_hosts');C.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
 C.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.secrets/channel-deploy-0.pem',allow_agent=False,look_for_keys=False,timeout=15,compress=True)
 i,o,e=C.exec_command("python3 - <<'PY'\n"+code+'\nPY\n',timeout=60);i.close();raw=o.read();err=e.read();assert o.channel.recv_exit_status()==0,err.decode()[:600];j=json.loads(gzip.decompress(raw));records=json.loads((W/'capture/records.json').read_text())
 for n,row in enumerate(j):
  b=base64.b64decode(row.pop('bytes'));assert hashlib.sha256(b).hexdigest()==row['sha256'];p=W/'capture'/('lazy-css-'+str(n)+'.css');p.write_bytes(b);row['local']=str(p);records['lazy-css-'+str(n)]=row
 (W/'capture/records.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps({'status':'READ_ONLY_ACTUAL_LAZY_CSS_CAPTURED','css':urls,'files':len(records),'businessRPCs':0}))
finally:C.close();print('SSH_CLOSED')
