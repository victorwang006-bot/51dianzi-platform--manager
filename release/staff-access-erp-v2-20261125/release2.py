import os,sys,json,fcntl,hashlib,time,shutil,datetime,tempfile
cfg=json.load(open('/opt/ops/staff-access-erp-v2-20261125/cfg.json'))
W='/opt/ops/staff-access-erp-v2-20261125'
ADMIN='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'
HTML=ADMIN+'/index.html'; ASSET=ADMIN+'/'+cfg['name']
COORD='/opt/ops/51-project-release-coordination-20261027.json'
LOCKS=['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']
OWNER='eJapJsCGyh39J1FCKC4wSR'; SCOPE='staff-access-erp-v2-20261125'
H=lambda b:hashlib.sha256(b).hexdigest()
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def need(c,m):
    if not c: raise SystemExit('FAIL '+m)
def wr(path,data,mode,ref=None):
    d=os.path.dirname(path); fd,t=tempfile.mkstemp(dir=d,prefix='.tmp-')
    os.write(fd,data)
    if ref: os.fchown(fd,ref.st_uid,ref.st_gid); os.fchmod(fd,ref.st_mode&0o7777)
    else: os.fchmod(fd,mode)
    os.fsync(fd); os.close(fd); os.rename(t,path)
    dfd=os.open(d,os.O_RDONLY); os.fsync(dfd); os.close(dfd)
fds=[]
for p in LOCKS:
    fd=os.open(p,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600); fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB); fds.append(fd)
print('DUAL_LOCKS_ACQUIRED',flush=True)
coord_raw=open(COORD,'rb').read(); coord=json.loads(coord_raw); cst=os.stat(COORD)
need(coord.get('shared_release_active') is False and not coord.get('needsOperatorRecovery') and coord['window']['status']=='closed','RELEASE_WINDOW_BUSY')
html_old=open(HTML,'rb').read(); hst=os.stat(HTML)
need(H(html_old)==cfg['oldHtmlSha'],'HTML_DRIFT')
js=open(W+'/staff-v2.js','rb').read(); html_new=open(W+'/index-v2.html','rb').read()
need(H(js)==cfg['jsSha'] and H(html_new)==cfg['htmlSha'],'PAYLOAD_HASH')
open(W+'/before-index.html','wb').write(html_old); open(W+'/before-coord.json','wb').write(coord_raw)
need(not os.path.exists(ASSET),'ASSET_EXISTS')
o=dict(coord); o['shared_release_active']=True; o['needsOperatorRecovery']=False
o['window']={'status':'opening','owner_task':OWNER,'scope':SCOPE,'openedAtUtc':now(),'needsOperatorRecovery':False,'kind':'frontend-static'}
wr(COORD,json.dumps(o,ensure_ascii=False,indent=2).encode(),0,cst); print('WINDOW_OPENED',flush=True)
result='VERIFIED'; err=None
try:
    wr(ASSET,js,0o644,hst); need(H(open(ASSET,'rb').read())==cfg['jsSha'],'ASSET_WRITE')
    wr(HTML,html_new,0,hst); need(H(open(HTML,'rb').read())==cfg['htmlSha'],'HTML_WRITE')
    print('APPLIED',flush=True)
except BaseException as e:
    err=repr(e); result='ROLLED_BACK'
    wr(HTML,html_old,0,hst)
    if os.path.exists(ASSET): os.unlink(ASSET)
    need(H(open(HTML,'rb').read())==cfg['oldHtmlSha'],'ROLLBACK_FAIL')
    print('ROLLED_BACK',err,flush=True)
c=json.loads(open(COORD,'rb').read()); c['shared_release_active']=False; c['needsOperatorRecovery']=False
c['window']=dict(c['window'],status='closed',closedAtUtc=now(),result=result,needsOperatorRecovery=False)
wr(COORD,json.dumps(c,ensure_ascii=False,indent=2).encode(),0,cst)
json.dump({'scope':SCOPE,'result':result,'error':err,'asset':cfg['name'],'htmlBefore':cfg['oldHtmlSha'],'htmlAfter':cfg['htmlSha'],'finishedAtUtc':now()},open(W+'/receipt.json','w'),indent=1)
print('WINDOW_CLOSED',result,flush=True)
