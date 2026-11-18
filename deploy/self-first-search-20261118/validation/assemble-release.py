#!/usr/bin/env python3
"""Assemble immutable search-first static package after actual normal-page acceptance."""
from pathlib import Path
import hashlib,json,shutil,argparse
W=Path('/home/ubuntu/work/self-first-20261118');C=W/'packaging/candidate'
H=lambda b:hashlib.sha256(b).hexdigest()
def need(value,message):
    if not value:raise RuntimeError(message)
def load(p):return json.loads(p.read_text())
p=argparse.ArgumentParser();p.add_argument('--label',default='release-self-first-final');a=p.parse_args();O=W/a.label;need(not O.exists(),'FRESH_IMMUTABLE_PACKAGE_REQUIRED')
c=load(C/'manifest.json');native=load(W/'validation/packaging-native-checks.json');browser=load(W/'validation/browser-candidate-result.json');protection=load(W/'live/protection-final.json');sourceReview=load(W/'validation/source-independent-review.json')
need(native['status']=='passed'and native['count']==27 and native['manifestSha256']==H((C/'manifest.json').read_bytes()),'NATIVE_CURRENT_MANIFEST_PIN')
need(browser['status']=='passed'and browser['actualPublicOfficialGET']and browser['productionNonGETSent']==0,'REAL_NORMAL_SEARCH_BROWSER_REQUIRED')
need(len(browser['checks'])>=4 and sum('grid'in x['case'] for x in browser['checks'])>=2,'BOTH_SCREEN_SIZES_AND_BOTH_VIEW_MODES_REQUIRED')
need(sourceReview['status']=='passed','INDEPENDENT_SOURCE_REVIEW_REQUIRED')
need(c['html']['baseline']==protection['frontHtmlSha256']and H((W/'live/index.before.html').read_bytes())==protection['frontHtmlSha256'],'LATEST_FULL_HTML_PREIMAGE')
need(c['html']['sha256']==browser['htmlSha256']==H((C/'index.html').read_bytes()),'SAME_BROWSER_AND_NATIVE_HTML_CANDIDATE')
for file,h in c['sourceFiles'].items():need(H(Path(file).read_bytes())==h,'SOURCE_FROZEN_CAS '+file)
for file,h in c['tools'].items():need(H(Path(file).read_bytes())==h,'COMPILER_FROZEN_CAS '+file)
for x in c['files']:
    need(H(Path(x['local']).read_bytes())==x['sha256']==browser['assetHashes'][x['url']],'BROWSER_ASSET_PIN '+x['url'])
need(len(protection['beforeProcesses'])==12 and len(protection['protectedFiles'])>=240,'FULL_CURRENT_ASSET_AND_PROCESS_PROTECTION')
need(c['projection']['checks']['sourceOutsideAllowedNodesTokenExact']and c['projection']['checks']['sourceResultBeforeActualRoot'],'APPROVED_NODE_SCOPE_AND_ACTUAL_SIBLING')
O.mkdir();(O/'assets').mkdir();(O/'evidence').mkdir();(O/'sources').mkdir();(O/'tools').mkdir();(O/'validation').mkdir()
assets=[]
for x in c['files']:
    name=Path(x['url']).name;shutil.copy2(x['local'],O/'assets'/name);assets.append({'relative':x['url'].lstrip('/'),'sha256':x['sha256']})
shutil.copy2(W/'live/index.before.html',O/'baseline-index.html');shutil.copy2(C/'index.html',O/'candidate-index.html')
for name in ['native-patches.json','html-patches.json','scope-proof.json','metafile.json','manifest.json']:shutil.copy2(C/name,O/'evidence'/('candidate-'+name))
for name in ['packaging-native-checks.json','browser-candidate-result.json','source-independent-review.json','release-tests.log']:shutil.copy2(W/'validation'/name,O/'evidence'/name)
for name in ['core.mjs','build.mjs','runtime.mjs','native-checks.mjs']:shutil.copy2(W/'packaging'/name,O/'tools'/name)
for name in ['release.py','test_release.py','test-browser-candidate.py','assemble-release.py']:shutil.copy2(W/'validation'/name,O/'validation'/name)
shutil.copy2(W/'validation/release.py',O/'release.py')
for file,h in c['sourceFiles'].items():
    f=Path(file);relative=f.relative_to('/home/ubuntu/work/sales-20261117/platform');target=O/'sources'/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(f,target)
for screenshot in (W/'validation').glob('candidate-normal-*.png'):shutil.copy2(screenshot,O/'evidence'/screenshot.name)
m={'ownerTask':'yOJKWq2DYYh42oMQkoK7ow','scope':'self-first-search-static','apiWrites':0,'databaseWrites':0,'processReloads':0,'adminHtmlWrites':0,'controllerSha256':H((O/'release.py').read_bytes()),'beforeHtmlSha256':c['html']['baseline'],'afterHtmlSha256':c['html']['sha256'],'assets':assets,'protectedFiles':protection['protectedFiles'],'beforeProcesses':protection['beforeProcesses'],'allExistingMerchantAndLegacyCatalogBytesPreserved':True,'allOtherHtmlBytesPreserved':True,'actualNormalSearchFirstCardVerified':True,'selfFilterAndDirectoryJumpRemoved':True,'normalPublicReadOnlySourceOnly':True,'nativePatchCount':4,'htmlReferenceCount':13,'nativeManifestSha256':H((C/'manifest.json').read_bytes()),'sourceFiles':c['sourceFiles'],'compilerTools':c['tools'],'sourceWhitespaceByteExact':c['projection']['checks']['sourceOutsideAllowedNodesWhitespaceByteExact'],'evidence':{},'sourceHead':c['sourcePreimage']['head'],'knownValidationLimitations':['Anonymous browser does not create a user session or call merchant guest quota writes. Original authenticated merchant result/cart nodes are preserved byte-for-byte and full K1 hooks are covered by source/native tests.','Existing unmodified URL test expects no selfOperatedOnly:false default; 99 affected tests pass, not a claim that every repository test passes.']}
for f in O.rglob('*'):
    if f.is_file():m['evidence'][str(f.relative_to(O))]=H(f.read_bytes())
(O/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'package':str(O),'manifestSha256':H((O/'manifest.json').read_bytes()),'controllerSha256':m['controllerSha256'],'assets':assets,'frontHtmlAfter':m['afterHtmlSha256'],'protectedFiles':len(m['protectedFiles']),'processes':12},ensure_ascii=False,indent=2))
