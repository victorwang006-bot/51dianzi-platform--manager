#!/usr/bin/env python3
"""One private preparation and one actual new scoped capture; no apply, timer pause or business writes."""
import ast,base64,hashlib,json,os,select,sys,time,zlib
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/.cache/backend-sftp-lib');import paramiko
os.umask(0o077)
W=Path('/home/ubuntu/work/customer-upload-fix-20261121-1024');OUT=W/'current-binding-after-entry-path-fix';assert not OUT.exists()
P=W/'package-inputs';plan=json.loads((P/'reconstruction-plan.json').read_bytes());budget=json.loads((W/'budget.json').read_text());assert budget['timerPause'] is False and budget['estimatedPrepareCaptureReviewApplyVerifyRecoverySeconds']<5400
OUT.mkdir(mode=0o700)
# Reuse the already exercised reconstruction block byte-for-byte.
oldscript=Path('/home/ubuntu/work/customer-stock-live-20261121/install_private_inputs_once.py').read_text();tree=ast.parse(oldscript);literal=next(n.value for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=='RECONSTRUCT' for x in n.targets));reconstruct=ast.literal_eval(literal);start=reconstruct.index(' files={};todo=');end=reconstruct.index(' root=stage/');block=reconstruct[start:end];assert block.startswith(' files={};todo=dict(j[\'payloadWithoutCapture\'])')
REMOTE=r'''import base64,hashlib,importlib.util,json,os,sys,time,uuid,zlib
from pathlib import Path
os.umask(0o077)
old=Path('/opt/ops/customer-stock-compact-20261121-6Lfttf6o-exact-fixed')/('release-'+'6ff5f1677bc0352d3f989b4720d3ca268b97da8f7620a4ea3afd65ea657b5b9e'[:16]+'.py')
for p in (old,*old.parents):assert not p.is_symlink(),'OLD_REVIEWED_SOURCE_SYMLINK:'+str(p)
assert hashlib.sha256(old.read_bytes()).hexdigest()=='6ff5f1677bc0352d3f989b4720d3ca268b97da8f7620a4ea3afd65ea657b5b9e'
s=importlib.util.spec_from_file_location('previous_exact_definitions',old);m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
j=json.loads(zlib.decompress(base64.b64decode(PLAN,validate=True)));stage=Path('/opt/ops/'+j['scope']);pin=j['controllerSha256'];started=time.monotonic()
with m.locked(m.Config()):
 coord=m.regular(m.Config().coord);cc=m.decode(coord);w=cc['window']
 assert cc.get('shared_release_active') is False and w.get('status')=='closed' and w.get('needsOperatorRecovery') is False and cc.get('needsOperatorRecovery',False) is False,'CURRENT_COORD_CLOSED_REQUIRED'
 assert w['owner_task']=='qp4e5jVmsAp0UHKwymyD5X' and w['scope']=='merchant-inquiry-release-20261121-1012' and w['receiptSHA']=='05c7a88e466bc38a0695b2b918357b6b6f66b7eb924addb809dcf28dc99fc22d','CURRENT_FRONTEND_CLOSED_HANDOFF_FIELDS'
 assert not stage.exists() and not stage.is_symlink(),'NEW_STAGE_EXCLUSIVE_NO_REPLAY';stage.mkdir(mode=0o700);m.fsync_dir(stage.parent);m.private(stage)
 code=base64.b64decode(j['controllerSourceBase64'],validate=True);policy=base64.b64decode(j['policyBase64'],validate=True);assert m.H(code)==pin and m.H(policy)==j['policySha256']
 source=stage/('release-'+pin[:16]+'.py');m.exclusive(source,code);m.exclusive(stage/'scope-policy.json',policy)
 print(json.dumps({'progress':'UPLOAD_FIX_PRIVATE_SOURCE_INSTALLED','controllerSha256':pin,'actualCurrentCoordSha256':m.H(coord),'publicWrites':0,'timerPaused':False}),file=sys.stderr,flush=True)
s=importlib.util.spec_from_file_location('current_upload_exact_contract',source);n=importlib.util.module_from_spec(s);sys.modules[s.name]=n;s.loader.exec_module(n);assert n.SCOPE_POLICY==json.loads(policy);n.coord_closed(coord)
# Before bytes are read once for reconstruction, already exact-hash checked by the plan.
with n.locked(n.Config()):
 assert n.regular(n.Config().coord)==coord,'PRIVATE_PREPARE_COORD_CAS'
__RECONSTRUCTION__
 n.exclusive(stage/'prepared-input-pin-matrix.json',n.encode({name:n.file_pin(b) for name,b in sorted(files.items())}))
 print(json.dumps({'progress':'UPLOAD_FIX_ALL_INPUTS_RECONSTRUCTED_INVERSE_VERIFIED','files':len(files),'elapsedSeconds':time.monotonic()-started,'publicWrites':0}),file=sys.stderr,flush=True)
c=n.Controller();cap=c.capture();capb=n.encode(cap);assert cap['coordRecord']['sha256']==n.H(coord),'CURRENT_CAPTURE_HANDOFF_COORD_CAS';files['capture.json']=capb
manifest=dict(schema='customer-batch-sealed-manifest-v1',ownerTask=n.OWNER,scope=n.SCOPE,ownerNonce=uuid.uuid4().hex+uuid.uuid4().hex,nonce=cap['nonce'],controllerSha256=pin,captureSha256=n.H(capb),packageFiles={name:n.file_pin(b) for name,b in sorted(files.items())},sourceHashes=j['sourceHashes'],assets=j['assets'],replacements=j['replacements'],cssRelative=j['cssRelative'],modules=j['modules'])
n.validate_payload(n.Config(),manifest,files,pin)
with n.locked(n.Config()):
 assert n.regular(n.Config().coord)==coord,'SEAL_COORD_CAS';n.exclusive(stage/'capture.json',capb);package=n.Config().package;assert not package.exists();package.mkdir(mode=0o700)
 for name,b in sorted(files.items()):
  p=package/name;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700);n.exclusive(p,b)
 mb=n.encode(manifest);n.exclusive(package/'manifest.json',mb);n.fsync_dir(package)
 summary={'status':'UPLOAD_FIX_ACTUAL_CURRENT_SCOPE_SEALED_NOT_APPLIED_NOT_APPROVED','scope':n.SCOPE,'controllerSha256':pin,'policySha256':j['policySha256'],'manifestSha256':n.H(mb),'captureSha256':n.H(capb),'capturedAtUtc':cap['capturedAtUtc'],'ttlSeconds':cap['ttlSeconds'],'protectedRecords':len(cap['protectedFiles']),'packageFiles':len(files),'sourceFiles':len(j['sourceHashes']),'sixReloadReady':[r['pm2ReloadReady'] for r in cap['processes'] if r['id'] in n.identity(n.Config(),cap['processes'])],'coordSha256':cap['coordRecord']['sha256'],'frontendHtmlSha256':cap['protectedFiles'][str(n.Config().front/'index.html')]['sha256'],'currentBeforeTargetHashes':{p:cap['protectedFiles'][p]['sha256'] for p in j['beforeTargetHashes']},'lastSnapshotSeconds':c.last_snapshot_seconds,'elapsedPrepareCaptureSealSeconds':time.monotonic()-started,'timerPause':False,'publicWrites':0,'businessWrites':0,'newMaintenanceWindow':False,'privateAllAncestorsMode0700ViaUmask077':True}
 assert summary['currentBeforeTargetHashes']==j['beforeTargetHashes'],'CURRENT_BEFOREIMAGES_EXACT';n.exclusive(stage/'current-binding-summary.json',n.encode(summary))
print(json.dumps({'summary':summary,'manifestBase64':base64.b64encode(mb).decode(),'captureZlibBase64':base64.b64encode(zlib.compress(capb,9)).decode()}),flush=True)
'''
REMOTE=REMOTE.replace('__RECONSTRUCTION__',block.rstrip())
code='PLAN='+repr(base64.b64encode(zlib.compress((P/'reconstruction-plan.json').read_bytes(),9)).decode())+'\n'+REMOTE;compile(code,'<upload-fix-private-capture-seal-once>','exec');wire=zlib.compress(code.encode(),9)
c=paramiko.SSHClient();c.load_system_host_keys();c.load_host_keys('/home/ubuntu/.ssh/known_hosts');c.set_missing_host_key_policy(paramiko.RejectPolicy());err=bytearray();out=bytearray()
try:
 c.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.cache/backend-ssh.pem',look_for_keys=False,allow_agent=False,timeout=15);ch=c.get_transport().open_session();ch.exec_command('PYTHONDONTWRITEBYTECODE=1 python3 -B -c "import sys,zlib; b=sys.stdin.buffer.read('+str(len(wire))+'); assert len(b)=='+str(len(wire))+'; exec(zlib.decompress(b))"');ch.sendall(wire);ch.shutdown_write()
 print(json.dumps({'progress':'UPLOAD_FIX_ONE_PRIVATE_PREPARE_CAPTURE_STARTED','wireBytes':len(wire),'timerPause':False,'publicWrites':0}),flush=True)
 while True:
  if ch.recv_ready():out+=ch.recv(65536)
  if ch.recv_stderr_ready():b=ch.recv_stderr(65536);err+=b;print(b.decode(errors='replace'),end='',flush=True)
  if ch.eof_received and not ch.recv_ready() and not ch.recv_stderr_ready():break
  select.select([ch],[],[],.1)
 rc=ch.recv_exit_status();(OUT/'progress-error.txt').write_bytes(err);assert rc==0,'UPLOAD_BIND_REFUSED:'+err.decode(errors='replace')[-3000:]
 d=json.loads(out);mb=base64.b64decode(d['manifestBase64']);capb=zlib.decompress(base64.b64decode(d['captureZlibBase64']));sm=d['summary'];assert hashlib.sha256(mb).hexdigest()==sm['manifestSha256'] and hashlib.sha256(capb).hexdigest()==sm['captureSha256']
 (OUT/'manifest.json').write_bytes(mb);(OUT/'capture-private.json').write_bytes(capb);(OUT/'current-coord-private.json').write_bytes(base64.b64decode(json.loads(capb)['coordBase64']));(OUT/'summary.json').write_text(json.dumps(sm,indent=2)+'\n');print(json.dumps(sm,indent=2),flush=True)
except BaseException as e:
 (OUT/'error.json').write_text(json.dumps({'error':str(e),'publicWrites':0,'timerPause':False,'noReplay':True},indent=2)+'\n');raise
finally:
 (OUT/'progress-error.txt').write_bytes(err);c.close()
