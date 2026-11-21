import sys,os,json,time,base64
from pathlib import Path
from html.parser import HTMLParser
p=json.loads(sys.stdin.buffer.read());ns={};exec(p['helper'],ns)
class H:pass
h=H()
for k,v in ns.items():setattr(h,k,v)
class Config:locks=(Path('/var/lock/dianzi51-public-deploy.lock'),Path('/var/lock/dianzi51-production-code.lock'))
locks=h.Locks(Config()).acquire();start=time.time();front=Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public');coord=Path('/opt/ops/51-project-release-coordination-20261027.json')
try:
 rawcoord=h.regular(coord);c=h.decode(rawcoord);w=c.get('window',{})
 h.need(c.get('shared_release_active') is False and c.get('needsOperatorRecovery',False) is False and w.get('status') in ('closed','verified') and w.get('needsOperatorRecovery') is False,'COORD_NOT_CLOSED')
 html=h.regular(front/'index.html');h.need(h.H(html)==p['beforeSHA'],'CURRENT_FRONT_CHANGED')
 refs=set()
 class Parser(HTMLParser):
  def handle_starttag(self,t,a):
   for k,v in a:
    if k in ('src','href') and v and v.startswith('/assets/'):refs.add(v)
 Parser().feed(html.decode())
 refs.update(p['nativeUrls'])
 files={url:h.describe(front/url[1:]) for url in sorted(refs)}
 reuse={};missing=[]
 for row in p['assets']:
  h.need(time.time()-start<90,'TARGET_BASELINE_BUDGET')
  path=front/row['url'][1:];h.no_symlink(path)
  if path.exists():
   record=h.describe(path);h.need(record['sha256']==row['sha256'] and record['size']==row['size'] and record['nlink']==1 and record['uid']==0 and (record['statmode']&0o022)==0,'EXISTING_ASSET_COLLISION:'+row['url']);reuse[row['url']]=record
  else:missing.append(row['url'])
 alias=Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/public');h.need(alias.is_symlink() and os.readlink(alias)==str(front),'SERVING_ALIAS_CHANGED')
 protected={}
 for row in p['protectedFiles']:
  h.need(time.time()-start<90,'TARGET_BASELINE_BUDGET')
  q=Path(row['path']);r=h.describe(q);h.need(r['sha256']==row['sha256'],'PROTECTED_CONTENT_CHANGED:'+row['path']);protected[row['path']]=r
 h.need(h.H(rawcoord)==p['coordSHA'],'CURRENT_COMPAT_CLOSED_COORD_PIN')
 locks.check();h.need(h.regular(coord)==rawcoord and h.regular(front/'index.html')==html,'READONLY_BASELINE_CHANGED')
 out={'capturedAtUtc':h.now(),'htmlBase64':h.b64(html),'htmlRecord':h.describe(front/'index.html'),'coordRecord':h.describe(coord),'existingStaticFiles':files,'reusableCandidateAssets':reuse,'missingCandidateAssets':missing,'servingAlias':{'path':str(alias),'link':os.readlink(alias),'metadata':h.metadata(alias)},'protectedFiles':protected,'elapsedSeconds':time.time()-start,'productionWrites':0}
 sys.stdout.buffer.write(h.encode(out));sys.stdout.buffer.flush()
finally:locks.release()
