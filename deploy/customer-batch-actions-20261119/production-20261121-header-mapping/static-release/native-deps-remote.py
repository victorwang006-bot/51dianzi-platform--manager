import sys,json,time
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
