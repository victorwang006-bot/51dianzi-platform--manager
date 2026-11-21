#!/usr/bin/env python3
"""One exact current static binding followed by complete review bundle; no public target writes."""
import base64,hashlib,json,shlex,sys,tarfile,time
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/.cache/backend-sftp-lib');import paramiko
O=Path('/home/ubuntu/work/customer-profile-refined-20261121-1250/static-release');P=O/'package';H=lambda b:hashlib.sha256(b).hexdigest()
assert not (O/'current-requested.json').exists(),'ONE_FORMAL_CURRENT_BINDING_ONLY'
m=json.loads((O/'manifest-template.private.json').read_text());payload=(O/'formal-baseline-payload.private.json').read_bytes();code=(O/'baseline-remote.py').read_text();assert H(code.encode())==m['toolPins']['baselineRemoteSHA']
# Offline template bytes and transport tools have all been prepared before this sole server read.
for key,name in [('releaseSHA','release.py'),('helperSHA','safety_core.py'),('landPackageSHA','land-package.py'),('applyAndConfirmSHA','apply-and-confirm.py'),('confirmPagesSHA','confirm-pages.py')]:assert H((O/name).read_bytes())==m['toolPins'][key]
(O/'current-requested.json').write_text(json.dumps({'scope':m['scope'],'remoteSourceSHA':H(code.encode()),'payloadSHA':H(payload),'requestedAtUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'oneRequestOnly':True},indent=2)+'\n')
client=paramiko.SSHClient();client.load_system_host_keys('/home/ubuntu/.ssh/known_hosts');client.set_missing_host_key_policy(paramiko.RejectPolicy());started=time.monotonic()
try:
 client.connect('47.97.108.147',username='root',key_filename='/home/ubuntu/.cache/backend-ssh.pem',allow_agent=False,look_for_keys=False,compress=True,timeout=15,banner_timeout=15,auth_timeout=15)
 i,o,e=client.exec_command('python3 -B -u -c '+shlex.quote(code),timeout=120);i.channel.sendall(payload);i.channel.shutdown_write();raw=o.read();err=e.read();rc=o.channel.recv_exit_status();(O/'baseline-error.txt').write_bytes(err);assert rc==0,('EXACT_CURRENT_BINDING_REJECTED',err.decode());base=json.loads(raw);assert base['productionWrites']==0;(O/'current-static.private.json').write_bytes(raw);print('ONE_CURRENT_TARGET_BASELINE_COMPLETE',base['elapsedSeconds'],flush=True)
finally:client.close();print('BASELINE_SSH_CLOSED_DUAL_LOCKS_RELEASED',flush=True)
assert base64.b64decode(base['htmlBase64'])==(P/'before-index.html').read_bytes()
m.update(existingDependencies=[{'url':u,'sha256':r['sha256'],'size':r['size'],'record':r} for u,r in sorted(base['existingStaticFiles'].items())],protectedFiles=[{'path':p,'record':r} for p,r in sorted(base['protectedFiles'].items())],expectedBaselineHtmlRecord=base['htmlRecord'],expectedCoordSHA=base['coordRecord']['sha256'],servingAlias=base['servingAlias'],capturedAtUtc=base['capturedAtUtc'])
(P/'manifest.json').write_bytes((json.dumps(m,sort_keys=True,ensure_ascii=False,separators=(',',':'))+'\n').encode())
missing=set(base['missingCandidateAssets'])
with tarfile.open(O/'delta-assets.tar.gz','w:gz',compresslevel=6) as t:
 for a in m['assets']:
  if a['url'] in missing:t.add(P/a['url'][1:],arcname=a['url'][1:],recursive=False)
summary={'scope':m['scope'],'manifestSHA':H((P/'manifest.json').read_bytes()),'htmlBeforeSHA':m['htmlBeforeSHA'],'htmlAfterSHA':m['htmlAfterSHA'],'assetCount':3,'newAssetCount':len(missing),'reusedAssetsCount':len(base['reusableCandidateAssets']),'existingDependencyCount':len(m['existingDependencies']),'protectedFileCount':len(m['protectedFiles']),'archiveSHA':H((O/'delta-assets.tar.gz').read_bytes()),'deltaArchiveBytes':(O/'delta-assets.tar.gz').stat().st_size,'baselineElapsedSeconds':base['elapsedSeconds'],'clientBaselineSeconds':time.monotonic()-started,'productionWrites':0,'baselineLocksReleased':True,'baselineSSHClosed':True,'releaseSHA':m['toolPins']['releaseSHA'],'helperSHA':m['toolPins']['helperSHA']}
(O/'package-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
current={k:v for k,v in base.items() if k!='htmlBase64'};(O/'current-binding-summary.json').write_text(json.dumps(current,ensure_ascii=False,indent=2)+'\n')
locations={a['url']:{'sha256':a['sha256'],'size':a['size'],'reviewStorage':('delta-assets.tar.gz!'+a['url'][1:]) if a['url'] in missing else ('package'+a['url'])} for a in m['assets']}
(O/'candidate-asset-locations.json').write_text(json.dumps(locations,indent=2)+'\n')
# Full source and actual candidates in one attachment, never just paths or script attachments.
files={str(p.relative_to(O)):p for p in O.rglob('*') if p.is_file() and p.name not in ['formal-baseline-payload.private.json','current-static.private.json','profile-static-review.tar.gz'] and not (str(p.relative_to(O)).startswith('package/assets/') and '/'+str(p.relative_to(P)) in missing)}
index={n:{'sha256':H(p.read_bytes()),'size':p.stat().st_size} for n,p in sorted(files.items())};(O/'file-index.json').write_text(json.dumps(index,indent=2)+'\n')
with tarfile.open(O/'profile-static-review.tar.gz','w:gz',compresslevel=6) as t:
 for n,p in sorted(files.items()):t.add(p,arcname=n,recursive=False)
 t.add(O/'file-index.json',arcname='file-index.json',recursive=False)
a=O/'profile-static-review.tar.gz';print(json.dumps({'summary':summary,'reviewBundleBytes':a.stat().st_size,'reviewBundleSHA':H(a.read_bytes()),'currentCoordWholeSHA':m['expectedCoordSHA'],'newNonce':m['nonce'],'fullOfflineReady':True},indent=2),flush=True)
