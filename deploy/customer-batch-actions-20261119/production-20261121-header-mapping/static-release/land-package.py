#!/usr/bin/env python3
import base64,hashlib,json,shlex,time
from pathlib import Path
import sys;sys.path.insert(0,'/home/ubuntu/.cache/backend-sftp-lib');import paramiko
O=Path('/home/ubuntu/work/customer-upload-header-mapping-20261121-1058/static-release');STAGE='/opt/ops/customer-upload-header-mapping-20261121-6Lfttf6o-1156';H=lambda b:hashlib.sha256(b).hexdigest()
mr=(O/'package/manifest.json').read_bytes();m=json.loads(mr);rr=(O/'independent-review.json').read_bytes();review=json.loads(rr)
assert review['status']=='APPROVED' and review['manifestSHA']==H(mr)
assert review['releaseSHA']==H((O/'release.py').read_bytes()) and review['helperSHA']==H((O/'safety_core.py').read_bytes())
assert review['transportToolPins']['landPackageSHA']==H(Path(__file__).read_bytes())
summary=json.loads((O/'package-summary.json').read_text());base=json.loads((O/'current-static.private.json').read_text())
files={'release.py':(O/'release.py').read_bytes(),'safety_core.py':(O/'safety_core.py').read_bytes(),'review.json':rr,'candidate/manifest.json':mr,'candidate/index.html':(O/'package/index.html').read_bytes()}
archive=(O/'delta-assets.tar.gz').read_bytes();assert H(archive)==summary['archiveSHA']
payload=json.dumps({'files':{n:base64.b64encode(b).decode() for n,b in files.items()},'pins':{n:H(b) for n,b in files.items()},'archive':base64.b64encode(archive).decode(),'archiveSHA':H(archive),'missing':base['missingCandidateAssets']}).encode()
code='''import sys,os,json,base64,hashlib,io,tarfile
from pathlib import Path
sys.dont_write_bytecode=True
p=json.loads(sys.stdin.buffer.read());STAGE=Path('''+repr(STAGE)+''');front=Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
for q in (STAGE,*STAGE.parents):assert not q.is_symlink(),('STAGE_LINK',str(q))
assert not STAGE.exists(),'NEW_STAGE_ABSENT_REQUIRED'
H=lambda b:hashlib.sha256(b).hexdigest()
files={n:base64.b64decode(b) for n,b in p['files'].items()}
for n,b in files.items():assert H(b)==p['pins'][n],('PAYLOAD_PIN',n)
m=json.loads(files['candidate/manifest.json']);review=json.loads(files['review.json']);assert review['manifestSHA']==H(files['candidate/manifest.json']) and review['releaseSHA']==H(files['release.py']) and review['helperSHA']==H(files['safety_core.py']) and review['status']=='APPROVED'
archive=base64.b64decode(p['archive']);assert H(archive)==p['archiveSHA']
tar=tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz');members=tar.getmembers();assert len({x.name for x in members})==len(members)
assert all(x.isfile() and not x.issym() and not x.islnk() for x in members)
assert {x.name for x in members}=={u[1:] for u in p['missing']},'EXACT_ARCHIVE_ASSET_SET'
ns={};exec(files['safety_core.py'],ns)
class Helper:pass
h=Helper()
for k,v in ns.items():setattr(h,k,v)
STAGE.mkdir(mode=0o700);(STAGE/'candidate').mkdir(mode=0o700);(STAGE/'candidate/assets').mkdir(mode=0o700)
def exclusive(path,b):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  v=memoryview(b)
  while v:
   n=os.write(fd,v);assert n>0;v=v[n:]
  os.fsync(fd)
 finally:os.close(fd)
membermap={x.name:x for x in members};copied=0;transferred=0
for row in m['assets']:
 rel=row['url'][1:];assert row['url'].startswith('/assets/') and Path(rel).name==row['url'][8:],'FLAT_ASSET'
 if rel in membermap:
  member=membermap[rel];assert member.size==row['size'];b=tar.extractfile(member).read();transferred+=1
 else:
  r=h.describe(front/rel);assert r['sha256']==row['sha256'] and r['size']==row['size'] and r['nlink']==1 and r['uid']==0 and (r['statmode']&0o022)==0,('SERVER_REUSE_PIN',row['url']);b=h.regular(front/rel);copied+=1
 assert H(b)==row['sha256'] and len(b)==row['size'],('ASSET_FULL_PIN',row['url']);exclusive(STAGE/'candidate'/rel,b)
for n,b in files.items():exclusive(STAGE/n,b)
for d in [STAGE/'candidate/assets',STAGE/'candidate',STAGE]:h.fsync_dir(d)
for row in m['assets']:assert h.H(h.regular(STAGE/'candidate'/row['url'][1:]))==row['sha256']
print(json.dumps({'event':'PRIVATE_APPROVED_PACKAGE_LANDED','stage':str(STAGE),'manifestSHA':p['pins']['candidate/manifest.json'],'reviewSHA':p['pins']['review.json'],'releaseSHA':p['pins']['release.py'],'helperSHA':p['pins']['safety_core.py'],'assetCount':len(m['assets']),'copiedExistingAssets':copied,'transferredAssets':transferred,'archiveSHA':p['archiveSHA'],'activeWrites':0,'oldAttemptReplay':False}),flush=True)
'''
client=paramiko.SSHClient();client.load_system_host_keys('/home/ubuntu/.ssh/known_hosts');client.set_missing_host_key_policy(paramiko.RejectPolicy());start=time.monotonic()
client.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.cache/backend-ssh.pem',allow_agent=False,look_for_keys=False,compress=True,timeout=15,banner_timeout=15,auth_timeout=15)
try:
 i,o,e=client.exec_command('python3 -B -u -c '+shlex.quote(code),timeout=360)
 for offset in range(0,len(payload),65536):
  i.channel.sendall(payload[offset:offset+65536])
  if offset%262144==0:print('PRIVATE_DELTA_TRANSPORT_BYTES',min(offset+65536,len(payload)),'/',len(payload),flush=True)
 i.channel.shutdown_write();lines=[]
 for line in o:print(line.rstrip(),flush=True);lines.append(line)
 err=e.read().decode();rc=o.channel.recv_exit_status();assert rc==0,err
 u=json.loads(lines[-1]);u['elapsedSeconds']=time.monotonic()-start;(O/'upload-result.json').write_text(json.dumps(u,indent=2)+'\n')
 (O/'approved-bundle-binding.json').write_text(json.dumps({'manifestSHA':H(mr),'reviewSHA':H(rr),'releaseSHA':review['releaseSHA'],'helperSHA':review['helperSHA']},indent=2)+'\n')
finally:client.close();print('PRIVATE_DELTA_SSH_CLOSED',flush=True)
