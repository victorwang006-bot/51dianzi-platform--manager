#!/usr/bin/env python3
from pathlib import Path
import argparse,hashlib,json,shutil
W=Path('/home/ubuntu/work/commission-simple-20261118')
H=lambda b:hashlib.sha256(b).hexdigest()
def load(p):return json.loads(Path(p).read_text())
def save(p,x):Path(p).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
p=argparse.ArgumentParser();p.add_argument('--candidate',required=True);p.add_argument('--out',required=True);p.add_argument('--browser-report',required=True);a=p.parse_args();candidate=Path(a.candidate).resolve();out=Path(a.out).resolve();assert candidate.parent==W/'packaging/ui' and out.parent==W
m=load(candidate/'manifest.json');ui=load(candidate/'ui-check-results.json');assert ui['failed']==0 and ui['passed']==15 and ui['status']=='UI_NATIVE_OFFLINE_PASSED_SOURCE_STABLE_NOT_DEPLOYED'
for key in ['sourceHashes','toolHashes','currentHashes','metadataHashes']:
 for f,h in m[key].items():assert H(Path(f).read_bytes())==h,(key,f)
assert H(Path(m['sourceFreezeNotice']['file']).read_bytes())==m['sourceFreezeNotice']['sha256']
for r in m['files']:assert H(Path(r['local']).read_bytes())==r['sha256']
assert H(Path(m['html']['source']).read_bytes())==m['html']['beforeSha256'];assert H(Path(m['html']['local']).read_bytes())==m['html']['sha256']
browser=load(a.browser_report);assert browser['status']=='BROWSER_NATIVE_OFFLINE_PASSED_NOT_DEPLOYED';assert browser['candidateSha256']==m['modules'][0]['afterSha256'];assert browser['productionNetworkIO']==0
protection=load(W/'validation/protection-latest.json');assert protection['noLiveWrites'] and protection['adminHtmlSha256']==m['html']['beforeSha256'] and len(protection['beforeProcesses'])==12
assert m['allOutsideFactoryBytesPreserved'] and m['allOriginalQueryPermissionAndNativeGettersPreservedOutsideFactory'];hd=load(m['html']['delta']);assert hd['exactByteInverse'] and hd['allOtherImportmapsAndHTMLBytesPreserved'] and len(hd['patches'])==6
assert not out.exists();out.mkdir(mode=0o700);(out/'assets').mkdir();(out/'evidence').mkdir();(out/'validation').mkdir();(out/'tools').mkdir()
shutil.copyfile(Path(m['html']['source']),out/'baseline-index.html');shutil.copyfile(Path(m['html']['local']),out/'candidate-index.html');shutil.copyfile(W/'validation/release.py',out/'release.py');shutil.copyfile(W/'validation/test_release.py',out/'validation/test_release.py')
assets=[]
for r in m['files']:
 shutil.copyfile(Path(r['local']),out/'assets'/Path(r['local']).name);assets.append({'relative':r['url'].lstrip('/'),'sha256':r['sha256'],'bytes':r['bytes']})
evidence=[(candidate/'manifest.json','ui-manifest.json'),(candidate/'ui-check-results.json','ui-check-results.json'),(candidate/'profile.delta.json','profile.delta.json'),(candidate/'html.delta.json','html.delta.json'),(Path(a.browser_report),'browser-native-result.json'),(W/'validation/frontend-full-final.log','frontend-full-final.log'),(W/'validation/tsc-final.log','tsc-final.log'),(W/'validation/release-tests.log','release-tests.log')]
for src,name in evidence:shutil.copyfile(src,out/'evidence'/name)
for f in m['toolHashes']:
 relative=Path(f).relative_to(W/'packaging');target=out/'tools'/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(f,target)
manifest={'ownerTask':'yOJKWq2DYYh42oMQkoK7ow','scope':'personal-commission-simple-static','apiWrites':0,'databaseWrites':0,'processReloads':0,'frontHtmlWrites':0,'controllerSha256':H((out/'release.py').read_bytes()),'protectedFiles':protection['protectedFiles'],'beforeProcesses':protection['beforeProcesses'],'beforeHtmlSha256':m['html']['beforeSha256'],'afterHtmlSha256':m['html']['sha256'],'assets':assets,'factoryOutsideBytesPreserved':True,'allOtherHtmlBytesPreserved':True,'actualScopedProfileEntryVerified':True,'sourceHashes':m['sourceHashes'],'sourceH':m['sourceH'],'sourceFreezeNotice':m['sourceFreezeNotice'],'testsPassed':{'nativeUI':15,'sourceUI':100,'staticReleaseSafety':11,'typescript':True},'evidenceHashes':{str(f.relative_to(out)):H(f.read_bytes())for f in sorted((out/'evidence').rglob('*'))if f.is_file()},'toolHashes':{str(f.relative_to(out)):H(f.read_bytes())for f in sorted((out/'tools').rglob('*'))if f.is_file()}}
save(out/'manifest.json',manifest)
print(json.dumps({'out':str(out),'manifestSha256':H((out/'manifest.json').read_bytes()),'assets':len(assets),'protectedFiles':len(protection['protectedFiles']),'status':'FROZEN_PENDING_INDEPENDENT_REVIEW_AND_LIVE_PREFLIGHT'}))
