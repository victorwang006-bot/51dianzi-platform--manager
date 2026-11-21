#!/usr/bin/env python3
import base64,hashlib,json,re,shlex,sys
from pathlib import Path
from urllib.parse import urljoin
sys.path.insert(0,'/home/ubuntu/.cache/backend-sftp-lib');import paramiko
W=Path('/home/ubuntu/work/customer-upload-header-mapping-20261121-1058');O=W/'static-release';P=O/'package';H=lambda b:hashlib.sha256(b).hexdigest()
assert not (O/'native-dependency-binding.json').exists(),'ONE_NATIVE_DEPENDENCY_BINDING'
m=json.loads((P/'manifest.json').read_bytes());html=(P/'index.html').read_text();maps=re.findall(r'<script[^>]*type=["\x27]importmap["\x27][^>]*>(.*?)</script>',html,re.S);assert len(maps)==1;im=json.loads(maps[0]);resolved=[]
for asset in m['assets']:
 if not asset['url'].endswith('.js'):continue
 leaf=asset['url'];scopes=[(k,v) for k,v in im['scopes'].items() if leaf.startswith(k)];assert len(scopes)==1,(leaf,scopes)
 for specifier in sorted(set(re.findall(r'(?:from|import)\s*["\x27](\./[^"\x27]+)["\x27]',(P/leaf[1:]).read_text()))):
  normalized=urljoin(leaf,specifier);url=scopes[0][1].get(normalized,im['imports'].get(normalized,normalized));assert url.startswith('/assets/');resolved.append({'leaf':leaf,'specifier':specifier,'normalized':normalized,'actualUrl':url})
needed=sorted({x['actualUrl'] for x in resolved}-set(x['url'] for x in m['existingDependencies']))
code="""import sys,json,time
from pathlib import Path
p=json.loads(sys.stdin.buffer.read());ns={};exec(p['helper'],ns)
class H:pass
h=H()
for k,v in ns.items():setattr(h,k,v)
class Config:locks=(Path('/var/lock/dianzi51-public-deploy.lock'),Path('/var/lock/dianzi51-production-code.lock'))
locks=h.Locks(Config()).acquire();root=Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public');coord=Path('/opt/ops/51-project-release-coordination-20261027.json');start=time.time()
try:
 h.need(h.H(h.regular(coord))==p['coordSHA'] and h.H(h.regular(root/'index.html'))==p['htmlSHA'],'NATIVE_DEPENDENCY_BINDING_CURRENT_CHANGED')
 records={}
 for url in p['urls']:
  h.need(time.time()-start<60,'NATIVE_DEPENDENCY_BINDING_BUDGET');records[url]=h.describe(root/url[1:])
 h.need(h.H(h.regular(coord))==p['coordSHA'] and h.H(h.regular(root/'index.html'))==p['htmlSHA'],'NATIVE_DEPENDENCY_BINDING_FINAL_CHANGED');locks.check()
 print(json.dumps(dict(capturedAtUtc=h.now(),records=records,elapsedSeconds=time.time()-start,publicWrites=0,reloads=0,timerPauses=0)),flush=True)
finally:locks.release()
"""
(O/'native-deps-remote.py').write_text(code);payload=json.dumps({'helper':(O/'safety_core.py').read_text(),'urls':needed,'coordSHA':m['expectedCoordSHA'],'htmlSHA':m['htmlBeforeSHA']}).encode()
client=paramiko.SSHClient();client.load_system_host_keys('/home/ubuntu/.ssh/known_hosts');client.set_missing_host_key_policy(paramiko.RejectPolicy());client.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.cache/backend-ssh.pem',allow_agent=False,look_for_keys=False,timeout=15,banner_timeout=15,auth_timeout=15)
try:
 i,o,e=client.exec_command('python3 -B -u -c '+shlex.quote(code),timeout=75);i.channel.sendall(payload);i.channel.shutdown_write();raw=o.read();err=e.read();rc=o.channel.recv_exit_status();(O/'native-deps-error.txt').write_bytes(err);assert rc==0,err.decode();d=json.loads(raw)
finally:client.close();print('NATIVE_DEPS_DUAL_LOCKS_RELEASED_SSH_CLOSED',flush=True)
d['resolvedImports']=resolved;d['initialBaselineCapturedAtUtc']=m['capturedAtUtc'];d['initial684ProtectedFilesNotRepeated']=True;(O/'native-dependency-binding.json').write_text(json.dumps(d,indent=2)+'\n')
m['nativeImportResolution']=resolved;m['nativeDependencySupplementCapturedAtUtc']=d['capturedAtUtc'];m['existingDependencies'].extend({'url':u,'sha256':r['sha256'],'size':r['size'],'record':r} for u,r in sorted(d['records'].items()));(P/'manifest.json').write_text(json.dumps(m,sort_keys=True,ensure_ascii=False,separators=(',',':'))+'\n')
s=json.loads((O/'package-summary.json').read_bytes());s.update(manifestSHA=H((P/'manifest.json').read_bytes()),existingDependencyCount=len(m['existingDependencies']),nativeImports=len(resolved),nativeImportUniqueAdditional=len(needed),nativeDependencySupplementSeconds=d['elapsedSeconds']);(O/'package-summary.json').write_text(json.dumps(s,indent=2)+'\n');print(json.dumps(s,indent=2),flush=True)
