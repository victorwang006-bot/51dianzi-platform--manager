#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,shutil,tarfile
W=Path('/home/ubuntu/work/demo-correct-20261118');C=W/'packaging/candidate-ui';R=W/'release-static-0030';assert not R.exists();R.mkdir()
H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def cp(src,dst):
 p=R/dst;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,p);return {'source':dst,'sha256':H(p)}
u=json.loads((C/'manifest.json').read_text());s=json.loads((W/'live/protection-after-image.json').read_text());v=json.loads((W/'validation/browser-candidate-demo-result.json').read_text());n=json.loads((W/'packaging/ui-checks.json').read_text());assert v['status']=='passed'and len(v['checks'])==4 and n['status']=='passed'
cp(Path(json.loads((W/'packaging/ui-freeze.json').read_text())['inputs']['html']['local']),'baseline-index.html');cp(C/'index.html','candidate-index.html');cp(W/'validation/static-release.py','release.py');cp(W/'validation/test_static_release.py','tools/test_static_release.py')
assets=[]
for a in u['files']:
 name=a['url'].lstrip('/');cp(C/name,name);assert H(C/name)==a['sha256'];assets.append({'relative':name,'sha256':a['sha256']})
sources=[]
for src,h in u['sourceFiles'].items():
 assert H(src)==h
 rel='source/'+Path(src).relative_to('/home/ubuntu/work/sales-20261117/platform').as_posix();sources.append(cp(src,rel))
evidence=[]
for src in [C/'manifest.json',C/'search-patches.json',C/'html-patches.json',W/'packaging/ui-checks.json',W/'packaging/check-demo-ui.mjs',W/'packaging/pack-ui.mjs',W/'packaging/core.mjs',W/'validation/browser-candidate-demo-result.json',W/'validation/test-browser-demo.py',W/'validation/static-release-tests.log']:
 evidence.append(cp(src,'evidence/'+src.name))
m={'ownerTask':'yOJKWq2DYYh42oMQkoK7ow','scope':'demo-correct-card-static','apiWrites':0,'databaseWrites':0,'processReloads':0,'adminHtmlWrites':0,'beforeHtmlSha256':H(R/'baseline-index.html'),'afterHtmlSha256':H(R/'candidate-index.html'),'controllerSha256':H(R/'release.py'),'assets':assets,'protectedFiles':[x for x in s['protectedFiles']if x['path']!='/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html'],'beforeProcesses':s['beforeProcesses'],'allExistingMerchantAndLegacyCatalogBytesPreserved':True,'allOtherHtmlBytesPreserved':True,'actualNormalSearchFirstCardVerified':True,'selfFilterAndDirectoryJumpRemoved':True,'fiveZoneDemoBrowserVerified':True,'checkoutReadiness':False,'systemImageCandidateCanonical':True,'sources':sources,'evidence':evidence}
m['packageFiles']={p.relative_to(R).as_posix():H(p)for p in R.rglob('*')if p.is_file()};(R/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');(R/'review.json').write_text('{}\n')
with tarfile.open(W/'release-static-0030.tar.gz','w:gz')as t:
 for p in R.rglob('*'):
  if p.is_file():t.add(p,arcname=p.relative_to(R).as_posix())
print(json.dumps({'root':str(R),'manifestSha256':H(R/'manifest.json'),'controllerSha256':m['controllerSha256'],'protectedFiles':len(m['protectedFiles']),'bytes':(W/'release-static-0030.tar.gz').stat().st_size}))
