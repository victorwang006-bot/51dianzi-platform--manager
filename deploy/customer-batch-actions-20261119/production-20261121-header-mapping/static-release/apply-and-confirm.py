#!/usr/bin/env python3
"""One exec of reviewed release, real anonymous GET DOM ACK, no blind replay."""
import hashlib,json,queue,shlex,subprocess,sys,threading,time
from pathlib import Path
import sys;sys.path.insert(0,'/home/ubuntu/.cache/backend-sftp-lib');import paramiko
O=Path('/home/ubuntu/work/customer-upload-header-mapping-20261121-1058/static-release');STAGE='/opt/ops/customer-upload-header-mapping-20261121-6Lfttf6o-1156'
H=lambda b:hashlib.sha256(b).hexdigest()
u=json.loads((O/'upload-result.json').read_text());binding=json.loads((O/'approved-bundle-binding.json').read_text())
assert u['event']=='PRIVATE_APPROVED_PACKAGE_LANDED' and u['manifestSHA']==binding['manifestSHA'] and u['reviewSHA']==binding['reviewSHA']
assert not (O/'apply-started.json').exists(),'LOCAL_NO_REPLAY'
review=json.loads((O/'independent-review.json').read_text());assert H((O/'confirm-pages.py').read_bytes())==review['transportToolPins']['confirmPagesSHA'],'PARENT_ACTUAL_CONFIRM_SOURCE_PIN'
client=paramiko.SSHClient();client.load_system_host_keys('/home/ubuntu/.ssh/known_hosts');client.set_missing_host_key_policy(paramiko.RejectPolicy())
client.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.cache/backend-ssh.pem',allow_agent=False,look_for_keys=False,timeout=15,banner_timeout=15,auth_timeout=15)
# Bound tool hashes checked remotely before exec; reviewed main independently checks them before locks.
bootstrap='''import os,hashlib
from pathlib import Path
p=Path('''+repr(STAGE)+''')
for name,pin in '''+repr({'release.py':binding['releaseSHA'],'safety_core.py':binding['helperSHA'],'review.json':binding['reviewSHA'],'candidate/manifest.json':binding['manifestSHA']})+'''.items():
 t=p/name
 for q in (t,*t.parents):assert not q.is_symlink(),str(q)
 fd=os.open(t,os.O_RDONLY|os.O_NOFOLLOW|os.O_NOATIME)
 try:
  chunks=[]
  while True:
   b=os.read(fd,1024*1024)
   if not b:break
   chunks.append(b)
 finally:os.close(fd)
 assert hashlib.sha256(b''.join(chunks)).hexdigest()==pin,('EXEC_SOURCE_PIN',name)
os.execv('/usr/bin/python3',['python3','-u',str(p/'release.py'),'''+repr(binding['manifestSHA'])+','+repr(binding['reviewSHA'])+'''])
'''
(O/'apply-started.json').write_text(json.dumps({'scope':'customer-upload-header-mapping-20261121-6Lfttf6o-1156','manifestSHA':binding['manifestSHA'],'reviewSHA':binding['reviewSHA'],'startedAtUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'oneExecRequested':True},indent=2)+'\n')
stdin,stdout,stderr=client.exec_command('python3 -u -c '+shlex.quote(bootstrap),timeout=None)
q=queue.Queue();logfile=open(O/'apply-live.log','x',buffering=1);events=[];ackSent=False;terminal=None

def reader(stream,label):
 try:
  for line in stream:q.put((label,line))
 finally:q.put((label,None))
threading.Thread(target=reader,args=(stdout,'STDOUT'),daemon=True).start();threading.Thread(target=reader,args=(stderr,'STDERR'),daemon=True).start()
ends=0
while ends<2:
 try:label,line=q.get(timeout=20)
 except queue.Empty:
  print('RELEASE_CONNECTION_ACTIVE_WAITING_OUTPUT; not replaying or killing',flush=True);continue
 if line is None:ends+=1;continue
 text=line.rstrip();print(label,text,flush=True);logfile.write(label+' '+text+'\n')
 if label!='STDOUT':continue
 try:event=json.loads(text)
 except ValueError:continue
 events.append(event)
 if event.get('event')=='INSTALLED_AWAITING_ACTUAL_PAGE_CONFIRMATION':
  assert not ackSent,'ONE_ACTUAL_CONFIRMATION'
  proc=subprocess.Popen([sys.executable,str(O/'confirm-pages.py')],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
  for confirmationLine in proc.stdout:
   print('DOM',confirmationLine.rstrip(),flush=True);logfile.write('DOM '+confirmationLine)
  status=proc.wait()
  resultpath=O/'live-confirmation/confirmation.json'
  ack=json.loads(resultpath.read_text()) if resultpath.exists() else {'status':'ACTUAL_CONFIRMATION_FAILED','error':'CONFIRM_PROGRAM_EXIT_WITHOUT_RESULT','exitCode':status}
  if status!=0:ack.update(status='ACTUAL_CONFIRMATION_FAILED',error='CONFIRM_PROGRAM_NONZERO_EXIT',exitCode=status)
  stdin.write(json.dumps(ack,ensure_ascii=False)+'\n');stdin.flush();ackSent=True
  print('ACTUAL_DOM_ACK_SENT',ack['status'],flush=True)
 if event.get('event') in ('VERIFIED_DURABLE_CLOSED','PRECISE_ROLLBACK_CLOSED'):terminal=event
 if event.get('event','').startswith('FAILUREHOLD'):
  print('OWNED_FAILUREHOLD_REMAINS_CONNECTED; exact failure above; no second apply/kill/unlock',flush=True)
exitcode=stdout.channel.recv_exit_status();logfile.close()
durable=None
if exitcode==0 and terminal and terminal.get('event')=='VERIFIED_DURABLE_CLOSED':
 code="import sys,json;sys.dont_write_bytecode=True;sys.path.insert(0,"+repr(STAGE)+");import safety_core as h;from pathlib import Path;p=Path("+repr(STAGE)+");r=h.regular(p/'confirmed.json');d=h.decode(r);coordraw=h.regular(Path('/opt/ops/51-project-release-coordination-20261027.json'));c=h.decode(coordraw);w=c['window'];assert h.H(r)=="+repr(terminal['receiptSHA'])+";assert c['shared_release_active'] is False and w['status']=='closed' and w['owner_task']==d['ownerTask'] and w['scope']==d['scope'] and w['receiptSHA']==h.H(r);assert h.H(h.regular(Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public/index.html')))==d['htmlAfterSHA'];print(json.dumps(dict(receipt=d,receiptSHA=h.H(r),coordStatus=w['status'],coordOwner=w['owner_task'],coordScope=w['scope'],coordReceiptSHA=w['receiptSHA'],sharedReleaseActive=c['shared_release_active'],coordWholeSHA=h.H(coordraw),currentHTMLSHA=d['htmlAfterSHA'],originalSSHExecExited=True)))"
 ri,ro,re=client.exec_command('python3 -B -c '+shlex.quote(code),timeout=30);ri.close();raw=ro.read();err=re.read().decode();rc=ro.channel.recv_exit_status()
 if rc==0:
  durable=json.loads(raw);(O/'durable-closed-receipt.json').write_text(json.dumps(durable,ensure_ascii=False,indent=2)+'\n');print('DURABLE_RECEIPT_CLOSED_FIELDS_RETRIEVED',durable['receiptSHA'],flush=True)
 else:print('RECEIPT_READ_ERROR',rc,err,flush=True)
client.close()
result={'sshExitCode':exitcode,'terminal':terminal,'events':events,'actualACKSent':ackSent,'durableReceiptRetrieved':durable is not None,'connectionClosed':True}
(O/'apply-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result['terminal'] or {'error':'NO_DURABLE_TERMINAL','exitCode':exitcode}),flush=True)
if exitcode!=0 or not terminal or terminal.get('event')!='VERIFIED_DURABLE_CLOSED':raise SystemExit(1)
