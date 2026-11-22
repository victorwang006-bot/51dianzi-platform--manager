#!/usr/bin/env python3
from pathlib import Path
import datetime,hashlib,json,subprocess
W=Path(__file__).resolve().parent;ROOT=Path('/home/ubuntu/work/channel-release-20261121-1837');COMMIT='200194c5834babfb79251ae17f20342d26ab62db'
H=lambda b:hashlib.sha256(b).hexdigest()
def git(r,*args):return subprocess.check_output(['git','-C',str(r),*args]).decode().strip()
m=json.loads((ROOT/'manager/deploy/header-notification-removal-20261122-1902/manifest.json').read_text());repos={}
for name in ['manager','platform']:
 r=ROOT/name;head=git(r,'rev-parse','HEAD');assert head==git(r,'rev-parse','origin/main'),name
 assert not git(r,'status','--porcelain'),name+' dirty before source freeze'
 if name=='manager':assert head==COMMIT
 pins={}
 if name=='manager':
  for rel,sha in m['sourcePins'].items():
   b=subprocess.check_output(['git','-C',str(r),'show',head+':'+rel]);assert (r/rel).read_bytes()==b and H(b)==sha
   pins[rel]={'sha256':sha,'gitBlob':git(r,'rev-parse',head+':'+rel)}
 repos[name]={'sourceCommit':head,'sourceTree':git(r,'rev-parse',head+'^{tree}'),'sourceRemoteConfirmed':True,'changedCodePins':pins,'deployedThisWindow':name=='manager'}
protected={}
for p,h in m['protectedSourcePins'].items():assert H((ROOT/'manager'/p).read_bytes())==h;protected[str(ROOT/'manager'/p)]=h
for p in m['deleted']:assert not (ROOT/'manager'/p).exists()
c=json.loads((W/'capture/records.json').read_text())
result={'scope':W.name,'createdAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'repositories':repos,'protectedBusinessSourcePins':protected,'deletedStatusSource':m['deleted'],'authorization':'2026-11-22 19:28:40 用户上线；19:02批准的三项UI源码局部增量发布','productionAPIs':{side:c[side+'-api']['sha256']for side in ['front','admin']},'frontHTMLBaselineSHA':c['front-html']['sha256'],'openLimits':{'realAccountBusinessTest':False,'realSQLOrMySQLCollationExecuted':False,'realUnreadMarksOrBusinessWrites':False,'inspect503RootCauseClosed':False,'historicalNavigationTests':{'sameBaselineFailures':17,'newFailures':0},'platformNotDeployed':True},'deployment':'Only exact admin static UI assets and admin HTML; no API/runtimes/reload/DB migration. Retain 17:46 customer filter and diagnosis.'}
(W/'source-version.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print('GITHUB_SOURCE_FROZEN',COMMIT,'protected files',len(protected))
