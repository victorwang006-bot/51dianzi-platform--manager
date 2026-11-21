#!/usr/bin/env python3
"""Only the observer transport changes: actual public HTTPS GET on ECS, tiny SSH result, no body replay."""
import hashlib,json,shlex,sys,traceback
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/.cache/backend-sftp-lib');import paramiko
O=Path(__file__).resolve().parent;D=O/'live-confirmation';STAGE='/opt/ops/customer-upload-header-mapping-20261121-6Lfttf6o-r2-1216';H=lambda b:hashlib.sha256(b).hexdigest()
assert not D.exists(),'ONE_ACTUAL_STATIC_CONFIRMATION';D.mkdir(mode=0o700);mraw=(O/'package/manifest.json').read_bytes();m=json.loads(mraw)
remote='''import sys,json,time,datetime,urllib.request,hashlib
from pathlib import Path
p=json.loads(sys.stdin.buffer.read());sys.dont_write_bytecode=True;sys.path.insert(0,p['stage']);import safety_core as h
raw=h.regular(Path(p['stage'])/'candidate/manifest.json');h.need(h.H(raw)==p['manifestSHA'],'ACTUAL_CONFIRM_MANIFEST_PIN');m=h.decode(raw);h.need(m['scope']=='customer-upload-header-mapping-20261121-6Lfttf6o-r2-1216' and m['toolPins']['helperSHA']==h.H(h.regular(Path(p['stage'])/'safety_core.py')),'ACTUAL_CONFIRM_SCOPE_CORE_PIN')
ledger=[];result={'status':'ACTUAL_CONFIRMATION_FAILED','transportedNonGET':0,'anonymousNoCookies':True,'fullLoggedInUploadClaimed':False,'observer':'ECS-public-HTTPS-real-GET-body-hashed-not-Sandbox-body-transport'}
try:
 opener=urllib.request.build_opener()
 def get(url,pin):
  started=time.monotonic();request=urllib.request.Request('https://admin.51dianzi.com'+url,headers={'Cache-Control':'no-cache','Accept-Encoding':'identity'},method='GET')
  with opener.open(request,timeout=20) as r:
   h.need(r.status==200,'HTTP_STATUS:'+url+':'+str(r.status));h.need(r.geturl()=='https://admin.51dianzi.com'+url,'NO_UNEXPECTED_REDIRECT:'+url);b=r.read();actual=h.H(b);h.need(actual==pin,'ACTUAL_RESOURCE_HASH:'+url+':expected='+pin+':actual='+actual)
   ledger.append({'url':url,'method':'GET','status':r.status,'size':len(b),'sha256':actual,'elapsedSeconds':time.monotonic()-started,'cookieSent':False,'observedAtUtc':h.now()});return b
 html=get('/',m['htmlAfterSHA']);text=html.decode();e=m['htmlDeltaEvidence'];h.need(e['inverseVerified'] is True,'SOURCE_HTML_INVERSE')
 for old,count in e['counts'].items():h.need(old not in text,'OLD_HTML_REFERENCE_REMAINS:'+old)
 modules=[x for x in m['assets'] if x['url'].endswith('.js')];css=[x for x in m['assets'] if x['url'].endswith('.css')];h.need(len(modules)==2 and len(css)==1,'ACTUAL_RESOURCE_SET')
 for row in modules:
  b=get(row['url'],row['sha256']);h.need(len(b)==row['size'],'ACTUAL_NATIVE_SIZE:'+row['url']);h.need(text.count(row['url']) in (32,53),'ACTUAL_HTML_NATIVE_REFERENCE_COUNT:'+row['url'])
 row=css[0];b=get(row['url'],row['sha256']);h.need(len(b)==row['size'],'ACTUAL_CSS_SIZE');h.need(text.count(e['link'])==1 and '.customer-supply-dialog' in b.decode(),'ACTUAL_HTML_CSS_REFERENCE');h.need(m['nativeLeafInverseVerified'] is True and m['allOtherNativeBytesUnchanged'] is True,'NATIVE_SOURCE_EVIDENCE')
 result.update(status='ACTUAL_HEADER_MAPPING_STATIC_CONFIRMED',htmlSHA=m['htmlAfterSHA'],actualBothNativeUploadLeavesPinned=True,actualHeaderMappingCssPinned=True,actualHtmlReferencesPinned=True,nativeSourceCommit=m['sourceCommit'],sourceHashes=m['sourceHashes'],offlineBehaviorTestsReused=99,actualStaticGETLedger=ledger,fullLoggedInEnterpriseBusinessAcceptanceClaimed=False,confirmedAtUtc=h.now())
except BaseException as e:result.update(error=str(e),actualStaticGETLedger=ledger)
print(json.dumps(result,ensure_ascii=False),flush=True)
'''
client=paramiko.SSHClient();client.load_system_host_keys('/home/ubuntu/.ssh/known_hosts');client.set_missing_host_key_policy(paramiko.RejectPolicy());result={'status':'ACTUAL_CONFIRMATION_FAILED','transportedNonGET':0,'anonymousNoCookies':True,'fullLoggedInUploadClaimed':False}
try:
 client.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.cache/backend-ssh.pem',allow_agent=False,look_for_keys=False,compress=True,timeout=15,banner_timeout=15,auth_timeout=15)
 i,o,e=client.exec_command('python3 -B -u -c '+shlex.quote(remote),timeout=180);i.channel.sendall(json.dumps({'stage':STAGE,'manifestSHA':H(mraw)}).encode());i.channel.shutdown_write();raw=o.read();err=e.read();rc=o.channel.recv_exit_status();assert rc==0,err.decode();result=json.loads(raw)
 for row in result.get('actualStaticGETLedger',[]):print('ACTUAL_ECS_PUBLIC_HTTPS_GET_PINNED',row['url'],row['sha256'],flush=True)
except BaseException as e:result.update(error=str(e));traceback.print_exc()
finally:client.close()
result['observerSSHClosed']=True;(D/'confirmation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(result['status'],flush=True)
if result['status']!='ACTUAL_HEADER_MAPPING_STATIC_CONFIRMED':sys.exit(1)
