#!/usr/bin/env python3
"""Authorized finite joint release; private SFTP stage, exact four targets, dual-lock publisher."""
import base64,gzip,hashlib,json,os,secrets,sys
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/.cache/channel-ssh-lib');import paramiko
W=Path(__file__).resolve().parent;SCOPE='demand-redesign-release-20261122-1523-retry';OWNER='ebvPYDkJVIW0yJK27DsOEU';KEYS=['st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_atime_ns','st_mtime_ns','st_ctime_ns']
H=lambda b:hashlib.sha256(b).hexdigest();J=lambda p:json.loads(Path(p).read_text());C=paramiko.SSHClient();C.load_host_keys('/home/ubuntu/work/channel-release-20261121-1837/known_hosts');C.set_missing_host_key_policy(paramiko.RejectPolicy());sftp=channel=None

def command(cmd):
 i,o,e=C.exec_command(cmd,timeout=180);i.close();out=o.read();err=e.read();rc=o.channel.recv_exit_status();assert rc==0,(rc,err.decode()[:1000]);return out

def check_sources(final):
 assert final['scope']==SCOPE
 for p,sha in final['sourcePins'].items():assert H(Path(p).read_bytes())==sha,'SOURCE_DRIFT '+p
 freeze=J('/home/ubuntu/work/demand-redesign-implementation-20261122-1302/source-version.json')
 for side,rec in freeze['repositories'].items():
  root=Path('/home/ubuntu/work/channel-release-20261121-1837')/side
  for p,pin in rec['changedCodePins'].items():assert H((root/p).read_bytes())==pin['sha256'],'FREEZE_CODE_DRIFT '+p
 assert final['tests']['status']=='TARGETED_NATIVE_PASS_WITH_DISCLOSED_LIMITS'
 review=J(W/'integration-release-review.json');assert review['result']=='PASS' and review['manifestSHA256']==H((W/'final/manifest.json').read_bytes()),'EXACT_RELEASE_REVIEW_REQUIRED'
 for a in final['assets']:
  b=Path(a['local']).read_bytes();assert H(b)==a['sha256'] and len(b)==a['size']
 for a in final['apis']:
  b=Path(a['local']).read_bytes();assert H(b)==a['afterSHA'] and len(b)==a['size']
 assert H(Path(final['html']['local']).read_bytes())==final['html']['afterSHA']

try:
 final=J(W/'final/manifest.json');records=J(W/'capture/records.json');guard=J(W/'capture/runtime-guard.json');check_sources(final)
 C.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.secrets/channel-deploy-0.pem',allow_agent=False,look_for_keys=False,timeout=15,compress=True)
 paths={label:x['path']for label,x in records.items()}
 code='''import os,json,hashlib,stat
paths=%r
out={}
for label,path in paths.items():
 assert os.path.normpath(path)==os.path.realpath(path)==path
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:st=os.fstat(f.fileno());b=f.read();end=os.fstat(f.fileno())
 assert stat.S_ISREG(st.st_mode) and all(getattr(st,k)==getattr(end,k)==getattr(os.stat(path,follow_symlinks=False),k)for k in %r)
 out[label]={'sha256':hashlib.sha256(b).hexdigest(),'stat':{k:getattr(st,k)for k in %r}}
 if label=='coord':out[label]['content']=json.loads(b)
print(json.dumps(out))
'''%(paths,KEYS,KEYS)
 fresh=json.loads(command("python3 - <<'PY'\n"+code+'\nPY\n'));coord=fresh['coord']['content'];assert coord.get('shared_release_active')is False and coord.get('window',{}).get('status')=='closed' and not coord.get('needsOperatorRecovery')and not coord.get('window',{}).get('needsOperatorRecovery'),'RELEASE_WINDOW_BUSY'
 for label,row in records.items():
  assert fresh[label]['sha256']==row['sha256'],'FRESH_BASELINE_DRIFT '+label
  for key,val in row['stat'].items():
   if key!='st_atime_ns':assert fresh[label]['stat'][key]==val,'FRESH_METADATA_DRIFT '+label+' '+key
 nonce=secrets.token_hex(16);manifest={'scope':SCOPE,'owner':OWNER,'nonce':nonce,'coordBeforeSHA':fresh['coord']['sha256'],'sourceCommits':final['sourceCommits'],'targets':[],'assets':[],'runtimes':[],'existingFiles':[],'runtimeGuard':{'processes':guard['processes'],'protectedFiles':guard['protectedFiles']}};payload={'manifest':manifest,'targets':{},'assets':{},'runtimes':{}}
 for label,side,kind in [('front-html','front','html'),('admin-html','admin','html'),('front-api','front','api'),('admin-api','admin','api')]:
  rec=records[label]
  candidate=final['html']if label=='admin-html'else next((a for a in final['apis']if a['side']==side),None)if kind=='api'else None
  if candidate:
   assert candidate['beforeSHA']==rec['sha256'];b=Path(candidate['local']).read_bytes();sha=H(b);size=len(b);value=base64.b64encode(b).decode()if sha!=rec['sha256']else None;assert sha==candidate['afterSHA']and size==candidate['size']
  else:sha=rec['sha256'];size=rec['size'];value=None
  manifest['targets'].append({'path':rec['path'],'side':side,'kind':kind,'beforeSHA':rec['sha256'],'afterSHA':sha,'size':size,'beforeStat':rec['stat']});payload['targets'][rec['path']]=value
 for asset in final['assets']:
  b=Path(asset['local']).read_bytes();assert H(b)==asset['sha256']and len(b)==asset['size'];row={k:asset[k]for k in ['side','url','sha256','size']};assert row['side']=='admin';manifest['assets'].append(row);payload['assets'][row['side']+row['url']]=base64.b64encode(b).decode()
 deps={x['path']:x['sha256']for label,x in records.items()if label.startswith(('dependency-','lazy-css-'))};manifest['existingFiles']=[{'path':p,'sha256':sha}for p,sha in sorted(deps.items())]
 raw=(json.dumps(payload,separators=(',',':'))+'\n').encode();compressed=gzip.compress((json.dumps({'manifest':manifest},separators=(',',':'))+'\n').encode(),compresslevel=6,mtime=0);(W/'payload.json.gz').write_bytes(compressed);os.chmod(W/'payload.json.gz',0o600);(W/'release-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 input_path='/opt/ops/.demand-redesign-input-'+nonce+'.json';compressed_path=input_path+'.gz';script_path='/opt/ops/.demand-redesign-release-'+nonce+'.py';script=(W/'release-remote.py').read_bytes();sftp=C.open_sftp()
 for data,remote in [(compressed,compressed_path),(script,script_path)]:
  with sftp.open(remote,'wx')as f:
   f.chmod(0o600);f.set_pipelined(True)
   for pos in range(0,len(data),1024*1024):f.write(data[pos:pos+1024*1024]);print('PRIVATE_PIPELINED_UPLOAD',pos,len(data),flush=True)
   f.flush()
  sftp.chmod(remote,0o600)
 sftp.close();sftp=None
 decompress='''import os,gzip,hashlib
items=%r
for path,sha,size in items:
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 with os.fdopen(fd,'rb')as f:st=os.fstat(f.fileno());b=f.read()
 assert st.st_uid==0 and st.st_gid==0 and st.st_nlink==1 and st.st_mode&0o777==0o600
 assert len(b)==size and hashlib.sha256(b).hexdigest()==sha
 if path.endswith('.gz'):raw=gzip.decompress(b)
import json,stat
seed_path='/opt/ops/.demand-redesign-input-14df6b66831034c2ba6261114d652d51.json'
assert os.path.realpath(seed_path)==seed_path
fd=os.open(seed_path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
with os.fdopen(fd,'rb')as f:st=os.fstat(f.fileno());seed_bytes=f.read();end=os.fstat(f.fileno())
assert stat.S_ISREG(st.st_mode) and st.st_uid==0 and st.st_gid==0 and st.st_nlink==1 and st.st_mode&0o777==0o600 and len(seed_bytes)==28082112
assert hashlib.sha256(seed_bytes).hexdigest()=='c5e1703804f1202d411a230941f92fdc00d82b37fcff01a2743d458f8efe66d0'
assert (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns,end.st_ctime_ns)
seed=json.loads(seed_bytes);new=json.loads(raw);assert set(new)=={'manifest'} and seed['manifest']['scope']=='demand-redesign-release-20261122-1455'
seed['manifest']=new['manifest'];raw=(json.dumps(seed,separators=(',',':'))+chr(10)).encode()
assert hashlib.sha256(raw).hexdigest()==%r and len(raw)==%r
fd=os.open(%r,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
try:
 view=memoryview(raw)
 while view:
  n=os.write(fd,view);assert n>0;view=view[n:]
 os.fsync(fd)
finally:os.close(fd)
fd=os.open('/opt/ops',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
print('PRIVATE_COMPRESSED_STAGING_FULL_HASH_VERIFIED')
'''%([(compressed_path,H(compressed),len(compressed)),(script_path,H(script),len(script))],H(raw),len(raw),input_path)
 __import__('ast').parse(decompress)
 print(command("python3 - <<'PY'\n"+decompress+'\nPY\n').decode().strip(),flush=True);check_sources(final)
 print('EXECUTING_AUTHORIZED_JOINT_RELEASE',flush=True);channel=C.get_transport().open_session();channel.settimeout(900);channel.exec_command('python3 '+script_path+' '+input_path+' 2>&1');channel.shutdown_write();lines=[]
 with channel.makefile('r')as stream:
  for line in stream:lines.append(line);print(line.rstrip(),flush=True)
 rc=channel.recv_exit_status();(W/'release-events.log').write_text(''.join(lines));channel.close();channel=None
 eventreceipt=next((json.loads(x[len('RECEIPT '):])for x in lines if x.startswith('RECEIPT ')),None)
 if eventreceipt and eventreceipt.get('backupDirectory'):
  sftp=C.open_sftp();sftp.get('/opt/ops/'+SCOPE+'/receipt.json',str(W/'receipt.json'));sftp.close();sftp=None
  receipt=J(W/'receipt.json');assert receipt==eventreceipt,'DURABLE_RECEIPT_TRANSPORT_MISMATCH'
 else:
  (W/'not-applied-receipt.json').write_text(json.dumps(eventreceipt,indent=2)+'\n');raise RuntimeError('NO_DURABLE_STAGE_RECEIPT; inspect release-events.log, do not retry blindly')
 assert rc==0 and receipt['result']=='VERIFIED'and receipt['closed']is True and receipt['scope']==SCOPE and receipt['businessTestWrites']==0,'RELEASE_NOT_VERIFIED'
 expectedgroups=[{'front':'dianzi51','admin':'dianzi51-admin'}[t['side']]for t in manifest['targets']if t['kind']=='api'and t['beforeSHA']!=t['afterSHA']];assert receipt['apiReloadGroups']==expectedgroups and receipt['runtimes']==[]
 assert records['front-html']['path']in receipt['unchangedTargets'];assert set(receipt['changedTargets'])=={t['path']for t in manifest['targets']if t['beforeSHA']!=t['afterSHA']}
 finalcode='''import os,json,hashlib,fcntl
p='/opt/ops/51-project-release-coordination-20261027.json'
fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
with os.fdopen(fd,'rb')as f:b=f.read()
c=json.loads(b)
assert hashlib.sha256(b).hexdigest()==%r
assert c['shared_release_active']is False and c['window']['status']=='closed'and c['window']['owner_task']==%r and not c.get('needsOperatorRecovery')and not c['window'].get('needsOperatorRecovery')
locks=[]
try:
 for p in %r:
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(fd)
 print(json.dumps({'status':'DURABLE_RECEIPT_CLOSED_AND_DUAL_LOCKS_RELEASED','coordSHA':hashlib.sha256(b).hexdigest()}))
finally:
 for fd in reversed(locks):fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)
'''%(receipt['coordFinalSHA'],OWNER,['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock'])
 proof=command("python3 - <<'PY'\n"+finalcode+'\nPY\n').decode().strip();(W/'post-release-check.json').write_text(proof+'\n');print(proof,flush=True);print('LIVE_PROCUREMENT_AND_NOTIFICATION_VERIFIED',flush=True)
finally:
 if sftp:sftp.close()
 if channel:channel.close()
 C.close();print('SSH_CLOSED',flush=True)
