#!/usr/bin/env python3
import hashlib,json,shlex,sys
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/.cache/backend-sftp-lib');import paramiko
O=Path('/home/ubuntu/work/customer-upload-header-mapping-20261121-1058/static-release');assert not (O/'restored-durable-current.json').exists(),'ONE_RESTORED_READ';m=json.loads((O/'package/manifest.json').read_bytes());stage='/opt/ops/'+m['scope'];receiptSHA='bfb3e2df21b450fc37624ef7bc987aead0059608e44adef2da1886d30dc95868'
code="""import sys,json
from pathlib import Path
p=json.loads(sys.stdin.buffer.read());sys.dont_write_bytecode=True;sys.path.insert(0,p['stage']);import safety_core as h
h.need(h.H(h.regular(Path(p['stage'])/'safety_core.py'))==p['helperSHA'],'CORE_PIN')
class C:locks=(Path('/var/lock/dianzi51-public-deploy.lock'),Path('/var/lock/dianzi51-production-code.lock'))
l=h.Locks(C()).acquire()
try:
 root=Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public');r=h.regular(Path(p['stage'])/'restored.json');receipt=h.decode(r);h.need(h.H(r)==p['receiptSHA'],'RESTORED_RECEIPT_FULL_PIN');cr=h.regular(Path('/opt/ops/51-project-release-coordination-20261027.json'));c=h.decode(cr);w=c['window'];h.need(c['shared_release_active'] is False and w['status']=='closed' and w['scope']==p['scope'] and w['owner_task']==p['owner'] and w['receiptSHA']==p['receiptSHA'] and w['result']=='restored' and w['needsOperatorRecovery'] is False,'RESTORED_CLOSED_FIELDS');html=h.describe(root/'index.html');h.need(html['sha256']==p['beforeSHA'],'EXACT_OLD_HTML_RESTORED');assets={}
 for row in p['assets']:
  record=h.describe(root/row['url'][1:]);h.need(record['sha256']==row['sha256'] and record['size']==row['size'] and record['nlink']==1,'RETAINED_IMMUTABLE_PIN:'+row['url']);assets[row['url']]=record
 l.check();print(json.dumps(dict(status='RESTORED_DURABLE_CLOSED_CONFIRMED',receipt=receipt,receiptSHA=h.H(r),coordWholeSHA=h.H(cr),coord=c,coordRecord=h.describe(Path('/opt/ops/51-project-release-coordination-20261027.json')),htmlRecord=html,retainedAssetRecords=assets,capturedAtUtc=h.now(),productionWrites=0,reloads=0,timerPauses=0,dualLocksAcquiredAndReleased=True)),flush=True)
finally:l.release()
"""
payload=json.dumps({'stage':stage,'scope':m['scope'],'owner':m['ownerTask'],'helperSHA':m['toolPins']['helperSHA'],'receiptSHA':receiptSHA,'beforeSHA':m['htmlBeforeSHA'],'assets':m['assets']}).encode();client=paramiko.SSHClient();client.load_system_host_keys('/home/ubuntu/.ssh/known_hosts');client.set_missing_host_key_policy(paramiko.RejectPolicy());client.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.cache/backend-ssh.pem',allow_agent=False,look_for_keys=False,timeout=15,banner_timeout=15,auth_timeout=15)
try:
 i,o,e=client.exec_command('python3 -B -u -c '+shlex.quote(code),timeout=30);i.channel.sendall(payload);i.channel.shutdown_write();raw=o.read();err=e.read();rc=o.channel.recv_exit_status();assert rc==0,err.decode();d=json.loads(raw);d['clientClosed']=True;(O/'restored-durable-current.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:d[k] for k in ['status','receiptSHA','coordWholeSHA','capturedAtUtc','productionWrites','dualLocksAcquiredAndReleased']},indent=2),flush=True)
finally:client.close();print('RESTORED_CURRENT_READ_SSH_CLOSED',flush=True)
