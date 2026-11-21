#!/usr/bin/env python3
"""One original apply/verify, then exact live-native original-file read-only acceptance. No timer or DB writes."""
import base64,hashlib,json,os,select,sys,time,zlib
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/.cache/backend-sftp-lib');import paramiko
os.umask(0o077)
W=Path('/home/ubuntu/work/customer-upload-fix-20261121-1024');C=W/'current-binding-after-entry-path-fix';OUT=W/'once-apply';assert not OUT.exists()
mb=(C/'manifest.json').read_bytes();rb=(C/'review.json').read_bytes();m=json.loads(mb);r=json.loads(rb);sm=json.loads((C/'summary.json').read_text());H=lambda b:hashlib.sha256(b).hexdigest();assert r['releaseApproved'] is True and r['bindings']=={'manifestSha256':H(mb),'manifest':m}
samples=[]
for line in (C/'progress-error.txt').read_text().splitlines():
 try:j=json.loads(line)
 except ValueError:continue
 if j.get('progress')=='MINIMAL_ACTUAL_SCOPE_SNAPSHOT_COMPLETED':samples.append(j['seconds'])
assert len(samples)==2,'ONE_REAL_CAPTURE_TWO_SNAPSHOTS';per=max(samples);deadline=__import__('datetime').datetime.fromisoformat(sm['capturedAtUtc']).timestamp()+sm['ttlSeconds'];minimum=53*per+1200;assert deadline-time.time()>minimum,'CURRENT_TTL_APPLY_VERIFY_ACCEPTANCE_RECOVERY_BUDGET'
original=Path('/home/ubuntu/upload/pasted_file_NXFfxM_工作簿1--宝.xlsx').read_bytes();assert H(original)=='869c66b352c06b9e2864793a9c005bc812c81f794b84763795b23640f583d001'
acceptance='deploy/customer-batch-actions-20261119/verify-upload-live-format.cjs';assert acceptance in m['sourceHashes']
OUT.mkdir(mode=0o700);(OUT/'launch-budget.json').write_text(json.dumps({'captureDeadlineEpoch':deadline,'actualSnapshotSeconds':samples,'remainingBeforeApplySeconds':deadline-time.time(),'applyVerifyAcceptanceRecoveryConservativeSeconds':minimum,'maintenanceDeadline':None,'timerPause':False,'noOldCaptureOrDeadlineReused':True},indent=2)+'\n')
REMOTE=r'''import base64,hashlib,importlib.util,json,subprocess,sys,threading,time
from pathlib import Path
source=Path(STAGE)/('release-'+PIN[:16]+'.py');assert hashlib.sha256(source.read_bytes()).hexdigest()==PIN
s=importlib.util.spec_from_file_location('upload_exact_once_original_core',source);n=importlib.util.module_from_spec(s);sys.modules[s.name]=n;s.loader.exec_module(n)
package=n.Config().package;assert n.H(n.regular(package/'manifest.json'))==MH;manifest=n.decode(n.regular(package/'manifest.json'))
review=base64.b64decode(REVIEW,validate=True);n.validate_review(review,manifest,MH);assert not (package/'review.json').exists() and not n.Config().receipt.exists(),'CURRENT_ONE_REVIEW_ONE_APPLY_NO_REPLAY'
assert DEADLINE-time.time()>MINIMUM,'CURRENT_TTL_REMAINING_RECOVERY_BUDGET';n.exclusive(package/'review.json',review)
c=n.Controller();done=threading.Event()
def heartbeat():
 while not done.wait(30):
  st=c.st if isinstance(c.st,dict) else {};print(json.dumps({'progress':'UPLOAD_FIX_ORIGINAL_CORE_ONE_APPLY','stateSequence':c.sequence,'targets':st.get('targets',{}),'loadedSlots':st.get('loadedSlots',[]),'lastStateSha256':c.state_hash,'remainingCurrentTtlSeconds':DEADLINE-time.time(),'lastSnapshotSeconds':getattr(c,'last_snapshot_seconds',None),'timerPause':False}),file=sys.stderr,flush=True)
threading.Thread(target=heartbeat,daemon=True).start()
try:
 receipt=c.apply(package,MH,RH);assert receipt['status']=='verified';raw=n.regular(n.Config().receipt/'receipt.json');assert n.decode(raw)==receipt
 print(json.dumps({'progress':'UPLOAD_FIX_ACTUAL_DURABLE_VERIFIED_CLOSED','receiptSha256':n.H(raw),'reloadEvents':len(receipt['reloadEvents'])}),file=sys.stderr,flush=True)
 verified=n.Controller().verify(package,MH,RH,receipt['attemptSha256'],receipt['stateSha256'],n.H(raw));assert verified['status']=='verified-live-matching-own-receipt'
 with n.locked(n.Config()):
  coord=n.regular(n.Config().coord);cc=n.decode(coord);assert cc['shared_release_active'] is False and cc['window']['status']=='closed' and cc['window']['outcome']=='verified'
  api=n.regular(n.Config().front_api);assert n.H(api)==manifest['packageFiles']['after-front-api.js']['sha256']
  script=n.regular(package/('evidence/source/'+ACCEPTANCE));assert n.H(script)==manifest['sourceHashes'][ACCEPTANCE]
  original=base64.b64decode(ORIGINAL_FILE,validate=True);assert n.H(original)==ORIGINAL_FILE_SHA
  p=subprocess.run([str(n.Config().node),'-e',script.decode(),ACCEPTANCE,str(n.Config().front_api),n.H(api),ORIGINAL_FILE_SHA,EXPECTED_MANIFEST_SHA],input=original,capture_output=True,timeout=25)
  assert p.returncode==0,'LIVE_FORMAT_READ_ONLY_REFUSED:'+p.stderr.decode(errors='replace')[-2000:];actual=json.loads(p.stdout);assert actual['status']=='ACTUAL_LIVE_NATIVE_ORIGINAL_FILE_FORMAT_PASSED'
 result={'status':'UPLOAD_FIX_ACTUAL_APPLY_VERIFY_FORMAT_PASSED_CLOSED','scope':n.SCOPE,'controllerSha256':PIN,'manifestSha256':MH,'reviewSha256':RH,'receiptSha256':n.H(raw),'closedCoordSha256':n.H(coord),'closedAtUtc':receipt['closedAtUtc'],'receipt':receipt,'readOnlyVerify':verified,'actualOriginalFileFormatAcceptance':actual,'adminApiPhysicalWrites':0,'frontApiPhysicalWrites':1,'actualReloadEvents':len(receipt['reloadEvents']),'frontStaticWrites':receipt['frontStaticWrites'],'businessWrites':receipt['databaseWrites'],'envWrites':receipt['envWrites'],'timerPause':False,'newMaintenanceWindow':False}
 n.exclusive(Path(STAGE)/'upload-fix-apply-verify-result.json',n.encode(result));print(json.dumps(result),flush=True)
except BaseException as e:
 print('UPLOAD_ACTUAL_APPLY_VERIFY_ERROR:'+type(e).__name__+':'+str(e),file=sys.stderr,flush=True);raise
finally:done.set()
'''
constants={'STAGE':'/opt/ops/'+m['scope'],'PIN':m['controllerSha256'],'MH':H(mb),'RH':H(rb),'REVIEW':base64.b64encode(rb).decode(),'DEADLINE':deadline,'MINIMUM':minimum,'ORIGINAL_FILE':base64.b64encode(original).decode(),'ORIGINAL_FILE_SHA':H(original),'ACCEPTANCE':acceptance,'EXPECTED_MANIFEST_SHA':json.loads((W/'native-format-result.json').read_text())['manifestSha256']};code='\n'.join(k+'='+repr(v) for k,v in constants.items())+'\n'+REMOTE;compile(code,'<upload-fix-once-apply-verify>','exec');wire=zlib.compress(code.encode(),9)
c=paramiko.SSHClient();c.load_system_host_keys();c.load_host_keys('/home/ubuntu/.ssh/known_hosts');c.set_missing_host_key_policy(paramiko.RejectPolicy());out=bytearray();err=bytearray();started=time.monotonic()
try:
 c.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.cache/backend-ssh.pem',look_for_keys=False,allow_agent=False,timeout=15);ch=c.get_transport().open_session();ch.exec_command('PYTHONDONTWRITEBYTECODE=1 python3 -B -c "import sys,zlib; b=sys.stdin.buffer.read('+str(len(wire))+'); assert len(b)=='+str(len(wire))+'; exec(zlib.decompress(b))"');ch.sendall(wire);ch.shutdown_write();print('本轮原Controller一次apply已调用；先执行原零写准入；不暂停定时器。',flush=True)
 while True:
  if ch.recv_ready():out+=ch.recv(65536)
  if ch.recv_stderr_ready():b=ch.recv_stderr(65536);err+=b;print(b.decode(errors='replace'),end='',flush=True)
  if ch.eof_received and not ch.recv_ready() and not ch.recv_stderr_ready():break
  select.select([ch],[],[],.1)
 rc=ch.recv_exit_status();(OUT/'progress-error.txt').write_bytes(err);(OUT/'result-private.json').write_bytes(out)
 if rc:raise RuntimeError('UPLOAD_ONCE_APPLY_VERIFY_EXIT_'+str(rc)+':'+err.decode(errors='replace')[-3000:])
 result=json.loads(out);assert result['status']=='UPLOAD_FIX_ACTUAL_APPLY_VERIFY_FORMAT_PASSED_CLOSED';result['elapsedSeconds']=round(time.monotonic()-started,3);(OUT/'summary.json').write_text(json.dumps({k:v for k,v in result.items() if k!='receipt'},indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='receipt'},indent=2),flush=True)
except BaseException as e:
 (OUT/'error.json').write_text(json.dumps({'error':str(e),'noReplay':True,'forceUnlock':False,'timerPause':False},indent=2)+'\n');raise
finally:
 (OUT/'progress-error.txt').write_bytes(err);c.close()
