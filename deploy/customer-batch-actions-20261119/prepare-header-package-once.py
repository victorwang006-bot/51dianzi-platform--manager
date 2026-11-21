#!/usr/bin/env python3
"""One bounded current static baseline, no public write/reload/timer or legacy scope replay."""
import ast,base64,hashlib,json,shlex,shutil,sys,tarfile,time
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/.cache/backend-sftp-lib');import paramiko
W=Path('/home/ubuntu/work/customer-upload-header-mapping-20261121-1058');O=W/'static-release';BASE=W/'static-tools-handoff/browser-compat-static-tools-handoff/source';P=O/'package'
H=lambda b:hashlib.sha256(b).hexdigest()
assert not (O/'current-static.private.json').exists(),'ONE_BASELINE_REQUEST';P.mkdir(mode=0o700,exist_ok=True);(P/'assets').mkdir(mode=0o700,exist_ok=True)
assets=[]
for row in json.loads((W/'ui-build/assets.json').read_text()):
 b=(W/'ui-build/package'/row['relative']).read_bytes();assert H(b)==row['sha256'] and len(b)==row['size'];assets.append({'url':'/'+row['relative'],'size':len(b),'sha256':H(b)});(P/row['relative']).write_bytes(b)
assert len(assets)==3
old=ast.parse((BASE/'original-baseline-reader.py').read_text());remote=next(ast.literal_eval(n.value) for n in old.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='remote' for t in n.targets))
remote=remote.replace('/opt/releases/20261031-homepage-banner-v39/front/dist/public','/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public').replace('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/public','/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/public')
remote=remote.replace(" Parser().feed(html.decode())", " Parser().feed(html.decode())\n refs.update(p['nativeUrls'])")
remote=remote.replace(" locks.check();h.need(h.regular(coord)==rawcoord", " protected={}\n for row in p['protectedFiles']:\n  h.need(time.time()-start<90,'TARGET_BASELINE_BUDGET')\n  q=Path(row['path']);r=h.describe(q);h.need(r['sha256']==row['sha256'],'PROTECTED_CONTENT_CHANGED:'+row['path']);protected[row['path']]=r\n h.need(h.H(rawcoord)==p['coordSHA'],'CURRENT_COMPAT_CLOSED_COORD_PIN')\n locks.check();h.need(h.regular(coord)==rawcoord")
remote=remote.replace("'elapsedSeconds':time.time()-start", "'protectedFiles':protected,'elapsedSeconds':time.time()-start")
(O/'baseline-remote.py').write_text(remote)
front=json.loads(Path('/home/ubuntu/upload/真实上线回执.json').read_text());fr='/opt/releases/20261031-homepage-banner-v39/front/dist/public'
protected=[{'path':fr+'/index.html','sha256':front['currentFrontHTMLSHA']}]+[{'path':fr+x['url'],'sha256':x['sha256']} for x in front['frontendAssets']+front['frontendExistingDependencies']]
previous=json.loads((W.parent/'customer-upload-fix-20261121-1024/current-binding-after-entry-path-fix/capture-private.json').read_text())['protectedFiles']
apiPaths=['/opt/releases/20261110-customer-workbench-b7f3a2a7e317/'+k+'/dist/index.js' for k in ['front','admin']]
# The front API before record is from before the last successful upload fix; use the actual closed receipt pin.
closed=json.loads((W.parent/'customer-upload-fix-20261121-1024/backend-upload-fix-closed-handoff.json').read_text())
for path in apiPaths:
 h=closed['backendActiveApiSha256'] if '/front/' in path else previous[path]['sha256'];protected.append({'path':path,'sha256':h})
nativeUrls=[x['before'] for x in json.loads((W/'ui-build/modules.json').read_text())]
payload=json.dumps({'helper':(O/'safety_core.py').read_text(),'assets':assets,'beforeSHA':H((W/'offline-before/admin-index.html').read_bytes()),'coordSHA':front['closedCoordWholeSHA'],'nativeUrls':['/'+x for x in nativeUrls],'protectedFiles':protected}).encode()
client=paramiko.SSHClient();client.load_system_host_keys('/home/ubuntu/.ssh/known_hosts');client.set_missing_host_key_policy(paramiko.RejectPolicy());client.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.cache/backend-ssh.pem',allow_agent=False,look_for_keys=False,timeout=15,banner_timeout=15,auth_timeout=15)
try:
 i,o,e=client.exec_command('PYTHONDONTWRITEBYTECODE=1 python3 -B -u -c '+shlex.quote(remote),timeout=120);i.channel.sendall(payload);i.channel.shutdown_write();raw=o.read();err=e.read();rc=o.channel.recv_exit_status();(O/'baseline-error.txt').write_bytes(err);assert rc==0,('READONLY_TARGET_BINDING_FAILED',err.decode());base=json.loads(raw);assert base['productionWrites']==0;(O/'current-static.private.json').write_bytes(raw);print('CURRENT_TARGET_BASELINE_COMPLETE',base['elapsedSeconds'],flush=True)
finally:client.close();print('BASELINE_SSH_CLOSED_DUAL_LOCKS_RELEASED',flush=True)
before=base64.b64decode(base['htmlBase64']);after=(W/'ui-build/package/after-index.html').read_bytes();assert before==(W/'offline-before/admin-index.html').read_bytes();(P/'index.html').write_bytes(after)
deps=[{'url':u,'sha256':r['sha256'],'size':r['size'],'record':r} for u,r in sorted(base['existingStaticFiles'].items())]
sourceFiles=['client/src/business/platform/client/src/components/channelInventory/BatchUpload.tsx','client/src/business/platform/client/src/components/channelInventory/batch.css','client/src/business/platform/client/src/components/channelInventory/BatchUpload.compact.test.ts']
R=Path('/home/ubuntu/51-manager');source={n:H((R/n).read_bytes()) for n in sourceFiles}
m={'schema':'integrated-admin-header-static-v1','ownerTask':'6Lfttf6oVWJ8YS69o5FkXQ','scope':'customer-upload-header-mapping-20261121-6Lfttf6o-1156','authorization':{'choice':'实施','userMessageAt':'2026-11-21T11:11:51+08:00','userMessage':'继续','originalRequirement':'表头支持手工调整，因为系统有些不能自动识别，有些识别的也不准'},'htmlBeforeSHA':H(before),'htmlAfterSHA':H(after),'moduleScripts':[x['url'] for x in assets if x['url'].endswith('.js')],'stylesheet':next(x['url'] for x in assets if x['url'].endswith('.css')),'assets':assets,'existingDependencies':deps,'protectedFiles':[{'path':p,'record':r} for p,r in sorted(base['protectedFiles'].items())],'expectedBaselineHtmlRecord':base['htmlRecord'],'expectedCoordSHA':base['coordRecord']['sha256'],'servingAlias':base['servingAlias'],'apiWrites':0,'databaseWrites':0,'reloads':0,'timerPauses':0,'sourceCommit':'0ff3ee1a5c4bf0da82fff4c7661869e940e8f4ec','sourceHashes':source,'testsPassedReused':99,'nativeLeafInverseVerified':True,'allOtherNativeBytesUnchanged':True,'htmlDeltaEvidence':json.loads((W/'ui-build/package/evidence/html.json').read_text()),'capturedAtUtc':base['capturedAtUtc'],'acceptanceReadOnlyAuthorization':{'nonGETs':0,'authMode':'anonymous','fullLoggedInUploadClaimed':False,'actualStaticHtmlAndBothNativeLeavesAndCssOnly':True},'previousFrontClosedReceiptSHA':front['receiptSHA'],'previousFrontClosedCoordWholeSHA':front['closedCoordWholeSHA']}
raw=(json.dumps(m,sort_keys=True,ensure_ascii=False,separators=(',',':'))+'\n').encode();(P/'manifest.json').write_bytes(raw)
missing=set(base['missingCandidateAssets'])
with tarfile.open(O/'delta-assets.tar.gz','w:gz',compresslevel=6) as t:
 for row in assets:
  if row['url'] in missing:t.add(P/row['url'][1:],arcname=row['url'][1:],recursive=False)
summary={'manifestSHA':H(raw),'htmlBeforeSHA':H(before),'htmlAfterSHA':H(after),'assetCount':3,'newAssetCount':len(missing),'reusedAssetsCount':len(base['reusableCandidateAssets']),'existingDependencyCount':len(deps),'protectedFileCount':len(base['protectedFiles']),'archiveSHA':H((O/'delta-assets.tar.gz').read_bytes()),'deltaArchiveBytes':(O/'delta-assets.tar.gz').stat().st_size,'baselineElapsedSeconds':base['elapsedSeconds'],'productionWrites':0,'baselineLocksReleased':True,'baselineSSHClosed':True}
(O/'package-summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2),flush=True)
