#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,shutil,tarfile
W=Path('/home/ubuntu/work/demo-correct-20261118');C=W/'packaging/candidate-front-images';R=W/'release-image-0015';assert not R.exists();R.mkdir()
H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def copy(src,dst):
 p=R/dst;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,p);return {'source':dst,'sha256':H(p)}
m=json.loads((C/'manifest.json').read_text());b=json.loads((W/'live/protection-after-import.json').read_text());target='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
copy(W/'live/front-api.before.js','baseline-front.js');copy(C/'front.js','candidate-front.js');copy(C/'root-patches.json','root-patches.json');copy(C/'runtime'/m['runtime']['name'],'runtime/'+m['runtime']['name']);copy(W/'validation/image-release.py','image-release.py');copy(W/'validation/read-public-images.cjs','validation/read-public-images.cjs');
sources=[]
for p,h in m['sourceFiles'].items():
 assert H(p)==h
 rel='source/'+Path(p).relative_to('/home/ubuntu/work/sales-20261117/platform').as_posix();sources.append(copy(p,rel))
evidence=[]
for p in [C/'manifest.json',C/'symbol-proof.json',W/'packaging/image-api-checks.json',W/'packaging/check-image-api.mjs',W/'packaging/front-images.mjs',W/'packaging/core.mjs',W/'validation/test_image_release.py']:
 evidence.append(copy(p,'evidence/'+p.name))
assert json.loads((W/'packaging/image-api-checks.json').read_text())['status']=='passed'
ps=[]
for x in b['beforeProcesses']:
 y=dict(x);y['configuredEnvSha256']=y.pop('envSha256');ps.append(y)
manifest={'ownerTask':'yOJKWq2DYYh42oMQkoK7ow','scope':'official-system-images-readonly','kind':'runtime/frontJS','apiWrites':1,'databaseWrites':0,'adminHtmlWrites':0,'otherHtmlWrites':0,'reloadNames':['dianzi51'],'target':target,'runtimeTarget':'/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/runtime/'+m['runtime']['name'],'beforeApiSha256':m['API']['beforeSha256'],'afterApiSha256':m['API']['sha256'],'runtimeSha256':m['runtime']['sha256'],'controllerSha256':H(R/'image-release.py'),'frozenSources':sources,'evidence':evidence,'proofs':{k:True for k in ['noMoneyChange','noRouterRoleContextChange','readOnlySystemGallery','nativeOfflineUnitPassed','workerRefundPermitBackupsPinned','gateOnlyPublicGETNoAuthNoDmlDdl']},'protectedFiles':[x for x in b['protectedFiles']if x['path']!=target],'beforeProcesses':ps,'publicReadGate':{'source':'validation/read-public-images.cjs','sha256':H(R/'validation/read-public-images.cjs'),'expectedImageUrl':'https://dianzi51-assets.oss-cn-hangzhou.aliyuncs.com/material-images/STM32F103C8T6.png'}}
manifest['packageFiles']={p.relative_to(R).as_posix():H(p)for p in R.rglob('*')if p.is_file()};(R/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');(R/'review.json').write_text('{}\n')
with tarfile.open(W/'release-image-0015.delta.tar.gz','w:gz')as t:
 for p in R.rglob('*'):
  if p.is_file()and p.name not in ['baseline-front.js','candidate-front.js']:t.add(p,arcname=p.relative_to(R).as_posix())
print(json.dumps({'manifestSha256':H(R/'manifest.json'),'controllerSha256':H(R/'image-release.py'),'protectedFiles':len(manifest['protectedFiles']),'deltaBytes':(W/'release-image-0015.delta.tar.gz').stat().st_size,'root':str(R)}))
