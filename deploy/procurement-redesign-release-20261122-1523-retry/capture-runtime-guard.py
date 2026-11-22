#!/usr/bin/env python3
import sys,json
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/.cache/channel-ssh-lib');import paramiko
W=Path(__file__).resolve().parent
# Values remain on the server; hashes and key names only leave it.
CONFIG_KEYS=['name','pm_exec_path','pm_cwd','exec_mode','exec_interpreter','node_args','args','instances','watch','ignore_watch','autorestart','max_memory_restart','restart_delay','exp_backoff_restart_delay','min_uptime','max_restarts','kill_timeout','listen_timeout','wait_ready','shutdown_with_message','namespace','cron_restart','merge_logs','pm_out_log_path','pm_err_log_path','pm_pid_path','log_date_format','source_map_support','instance_var','filter_env','cwd','interpreter','vizion','treekill','uid','gid']
CODE=r'''
import os,subprocess,json,hashlib,stat
config_keys=%r
keys=['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_atime_ns','st_mtime_ns','st_ctime_ns']
def H(x):return hashlib.sha256(x).hexdigest()
def encoded(x):return json.dumps(x,sort_keys=True,separators=(',',':')).encode()
ps=json.loads(subprocess.run(['pm2','jlist'],capture_output=True,check=True,timeout=30).stdout)
rows=[]; paths=set(['/root/.pm2/dump.pm2','/etc/nginx/nginx.conf'])
for p in ps:
 e=p.get('pm2_env',{});env={k:v for k,v in e.get('env',{}).items() if k not in ['unique_id']}
 cfg={k:e[k] for k in config_keys if k in e}
 rows.append({'id':p.get('pm_id',e.get('pm_id')),'name':p['name'],'pid':p.get('pid'),'status':e.get('status'),'entry':e.get('pm_exec_path'),'configHash':H(encoded(cfg)),'environmentHash':H(encoded(env)),'environmentKeys':sorted(env),'configKeys':sorted(cfg)})
 for root in [e.get('pm_cwd'),os.path.dirname(e.get('pm_exec_path',''))]:
  if root:
   for parent in [root,os.path.dirname(root)]:
    for f in ['.env','.env.production','ecosystem.config.js','ecosystem.config.cjs']:
     x=os.path.join(parent,f)
     if os.path.isfile(x) and os.path.realpath(x)==x:paths.add(x)
protected=[]
for path in sorted(paths):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:st=os.fstat(f.fileno());b=f.read();end=os.fstat(f.fileno())
 assert stat.S_ISREG(st.st_mode) and st.st_nlink==1 and all(getattr(st,k)==getattr(end,k)==getattr(os.stat(path,follow_symlinks=False),k) for k in keys)
 protected.append({'path':path,'sha256':H(b),'stat':{k:getattr(st,k)for k in keys}})
print(json.dumps({'processes':rows,'configKeys':config_keys,'protectedFiles':protected},separators=(',',':')))
'''%CONFIG_KEYS
C=paramiko.SSHClient();C.load_host_keys('/home/ubuntu/work/channel-release-20261121-1837/known_hosts');C.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
 C.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.secrets/channel-deploy-0.pem',allow_agent=False,look_for_keys=False,timeout=15,compress=True)
 i,o,e=C.exec_command("python3 - <<'PY'\n"+CODE+'\nPY\n',timeout=60);i.close();raw=o.read();err=e.read();assert o.channel.recv_exit_status()==0,err.decode()[:600];j=json.loads(raw)
 old=json.loads((W/'capture/environment.json').read_text())['processes'];assert [{k:r[k]for k in ['id','name','pid','status','entry']}for r in j['processes']]==old,'CAPTURE_PROCESS_DRIFT'
 (W/'capture/runtime-guard.json').write_text(json.dumps(j,indent=2)+'\n');print(json.dumps({'status':'READ_ONLY_RUNTIME_GUARD_CAPTURED','processes':len(j['processes']),'protectedFiles':len(j['protectedFiles']),'envValuesPrinted':0}))
finally:C.close();print('SSH_CLOSED')
