#!/usr/bin/env python3
"""Offline tools preparation; independent single formal current is a separate explicit command."""
import ast,base64,difflib,hashlib,json,re,shutil,tarfile,uuid
from pathlib import Path
R=Path('/home/ubuntu/51-manager');W=Path('/home/ubuntu/work/customer-profile-refined-20261121-1250');OLD=Path('/home/ubuntu/work/customer-upload-header-mapping-20261121-1058/static-release-r2');O=W/'static-release';P=O/'package'
SCOPE='customer-profile-refined-20261121-6Lfttf6o-1250';OLDSCOPE='customer-upload-header-mapping-20261121-6Lfttf6o-r2-1216';H=lambda b:hashlib.sha256(b).hexdigest()
assert not O.exists(),'NEW_PRIVATE_SCOPE_ONLY';O.mkdir(mode=0o700);P.mkdir(mode=0o700);(P/'assets').mkdir(mode=0o700)
def write(n,b):
 p=O/n;p.parent.mkdir(mode=0o700,parents=True,exist_ok=True);p.write_bytes(b if isinstance(b,bytes) else b.encode())
def js(n,b):write(n,json.dumps(b,ensure_ascii=False,indent=2)+'\n')
proof={}
changes=[(OLDSCOPE,SCOPE),(str(OLD),str(O)),('ACTUAL_HEADER_MAPPING_STATIC_CONFIRMED','ACTUAL_CUSTOMER_PROFILE_STATIC_CONFIRMED'),('ACTUAL_HEADER_MAPPING_CONFIRMATION_FAILED','ACTUAL_CUSTOMER_PROFILE_CONFIRMATION_FAILED'),('actualBothNativeUploadLeavesPinned','actualBothNativeCustomerProfileLeavesPinned'),('actualHeaderMappingCssPinned','actualCustomerProfileCssPinned'),('fullLoggedInUploadClaimed','fullLoggedInCustomerBusinessClaimed'),('offlineBehaviorTestsReused=99','offlineUploadBehaviorTestsReused=99,offlineProfileDisplayTestsPassed=8'),('nativeSourceCommit=m[\'sourceCommit\']','nativeBaselineSourceCommit=m[\'sourceCommit\']'),("'.customer-supply-dialog' in b.decode()","'.erp-ui.customer-workbench.customer-profile-tight' in b.decode()"),("READONLY_BROWSER_COMPAT_CONFIRMATION_REQUIRED","READONLY_PROFILE_STATIC_CONFIRMATION_REQUIRED")]
for name in ['release.py','safety_core.py','land-package.py','apply-and-confirm.py','confirm-pages.py']:
 old=(OLD/name).read_bytes();s=old.decode();used=[]
 if name!='safety_core.py':
  for a,b in changes:
   if a in s:
    assert b not in s,(name,'new literal absent',b);used.append({'before':a,'after':b,'count':s.count(a)});s=s.replace(a,b)
 reverse=s
 for c in reversed(used):reverse=reverse.replace(c['after'],c['before'])
 assert reverse.encode()==old,(name,'WHOLE_INVERSE_EXACT');compile(s,name,'exec');write(name,s);write('tool-source-before/'+name,old);write(name+'.delta.patch',''.join(difflib.unified_diff(old.decode().splitlines(True),s.splitlines(True),fromfile='old/'+name,tofile='new/'+name)))
 proof[name]={'previousSHA':H(old),'newSHA':H(s.encode()),'fullInverseExact':True,'literalChanges':used}
assert H((O/'safety_core.py').read_bytes())=='463d5822c057df2fc0e6f2277c6eb14dd630e5fa71eb2b714b3bdebd38eee01e'
oldtree=ast.parse((OLD/'release.py').read_text());newtree=ast.parse((O/'release.py').read_text());oldguard=next(n for n in oldtree.body if isinstance(n,ast.ClassDef) and n.name=='Guard');newguard=next(n for n in newtree.body if isinstance(n,ast.ClassDef) and n.name=='Guard');assert ast.dump(oldguard,include_attributes=False)==ast.dump(newguard,include_attributes=False);proof['release.py']['fullGuardASTExact']=True
baseline=OLD.parent/'static-release/baseline-remote.py';write('baseline-remote.py',baseline.read_bytes());js('tool-proof.json',proof)
for row in json.loads((W/'ui-build/assets.json').read_text()):
 b=(W/'ui-build/package'/row['relative']).read_bytes();assert H(b)==row['sha256'] and len(b)==row['size'];write('package/'+row['relative'],b)
write('package/index.html',(W/'ui-build/package/after-index.html').read_bytes())
write('package/before-index.html',(W/'offline-before/admin-index.html').read_bytes())
for p in (W/'ui-build/package/evidence').iterdir():write('package/evidence/'+p.name,p.read_bytes())
oldm=json.loads((OLD/'package/manifest.json').read_text());closed=json.loads((OLD/'durable-closed-receipt.json').read_text());assert closed['receipt']['scope']==OLDSCOPE and closed['coordStatus']=='closed' and closed['sharedReleaseActive'] is False
write('reused-evidence/previous-manifest.json',(OLD/'package/manifest.json').read_bytes());write('reused-evidence/previous-review.json',(OLD/'independent-review.json').read_bytes());write('reused-evidence/previous-closed-receipt.json',(OLD/'durable-closed-receipt.json').read_bytes())
for name in ['affected-tests.log','compact-corrected-tests.log','typecheck.log']:
 write('reused-evidence/'+name,(OLD.parent/name).read_bytes())
html=(W/'offline-before/admin-index.html').read_text();maps=re.findall(r'<script[^>]*type=["\x27]importmap["\x27][^>]*>(.*?)</script>',html,re.S);assert len(maps)==1;im=json.loads(maps[0]);resolved=[];modules=json.loads((W/'ui-build/modules.json').read_text())
for row in modules:
 leaf='/'+row['before'];scopes=[(k,v) for k,v in im['scopes'].items() if leaf.startswith(k)];assert len(scopes)==1
 from urllib.parse import urljoin
 source=(W/'offline-before'/row['before']).read_text()
 candidate=(W/'ui-build/package'/row['after']).read_text()
 pat=r'(?:from|import)\s*["\x27](\./[^"\x27]+)["\x27]';specs=sorted(set(re.findall(pat,source)));assert specs==sorted(set(re.findall(pat,candidate)))
 for spec in specs:
  norm=urljoin(leaf,spec);url=scopes[0][1].get(norm,im['imports'].get(norm,norm));assert url.startswith('/assets/');resolved.append({'leaf':leaf,'specifier':spec,'normalized':norm,'actualUrl':url})
js('native-import-resolution.json',resolved)
assets=[{'url':'/'+r['relative'],'size':r['size'],'sha256':r['sha256']} for r in json.loads((W/'ui-build/assets.json').read_text())]
protected=[{'path':r['path'],'sha256':r['record']['sha256']} for r in oldm['protectedFiles']]
payload={'helper':(O/'safety_core.py').read_text(),'assets':assets,'beforeSHA':H((W/'offline-before/admin-index.html').read_bytes()),'coordSHA':closed['coordWholeSHA'],'nativeUrls':sorted(set(['/assets/'+Path(r['before']).name for r in modules]+[r['actualUrl'] for r in resolved])),'protectedFiles':protected}
js('formal-baseline-payload.private.json',payload)
sourceFiles=['client/src/business/platform/client/src/pages/CustomerDetail.tsx','client/src/business/platform/client/src/pages/CustomerProfileCompact.css','client/src/business/platform/client/src/pages/CustomerProfileRefined.test.ts']
sourceHashes={f:H((R/f).read_bytes()) for f in sourceFiles}
for f in sourceFiles:write('actual-source/'+Path(f).name,(R/f).read_bytes())
for p in (R/'deploy/customer-profile-refined-20261121/source-before').iterdir():write('source-before/'+p.name,p.read_bytes())
write('source.delta.patch',''.join(difflib.unified_diff((R/'deploy/customer-profile-refined-20261121/source-before/CustomerDetail.tsx').read_text().splitlines(True),(R/sourceFiles[0]).read_text().splitlines(True),fromfile='before/CustomerDetail.tsx',tofile='after/CustomerDetail.tsx'))+'\n'+''.join(difflib.unified_diff((R/'deploy/customer-profile-refined-20261121/source-before/CustomerProfileCompact.css').read_text().splitlines(True),(R/sourceFiles[1]).read_text().splitlines(True),fromfile='before/CustomerProfileCompact.css',tofile='after/CustomerProfileCompact.css')))
for name in ['profile-tests-pass.log','typecheck.log','native-build-pass.log']:
 write('offline-tests/'+name,(W/'offline-tests'/name).read_bytes())
for name in ['build-profile-native.mjs','prepare-profile-static.py','bind-profile-current.py']:write('actual-source/'+name,(R/'deploy/customer-profile-refined-20261121'/name).read_bytes())
write('actual-source/build-support.mjs',(R/'deploy/upload-manage-20261119/build-support.mjs').read_bytes())
# The actual apply guard starts after transfer/current binding, never during review or transport.
budget={'offlineReviewAllowance':180,'formalBaseline':90,'privateTransport':360,'privateInstall':45,'currentBindingAndApply':100,'actualPublicGetConfirmation':120,'durableClose':45,'preciseRollbackAndCloseReserve':240}
js('budget.json',{'allStagesSeconds':sum(budget.values()),'applyGuardStageSeconds':100+120+45+240,'stages':budget,'guardSeconds':900,'guardStart':'actual apply current binding, not transfer or independent review','reloads':0,'timerPauses':0,'maintenanceWindowRequested':False,'transferEstimate':'two new native JS 11.94MB raw; compression size measured in final archive; last similar r2 private transfer32.233s is history, not future guarantee','baselineCount':1,'noSeparateRepeatedPreflight':True})
m={'schema':'integrated-admin-profile-static-v1','ownerTask':'6Lfttf6oVWJ8YS69o5FkXQ','scope':SCOPE,'nonce':uuid.uuid4().hex,'authorization':{'choice':'实施','userMessageAt':'2026-11-21T12:50:44+08:00','userMessage':'按照此建议上线','originalRequirement':'删除客户名称下负责人/创建时间整行，实施已确认客户档案紧凑Demo视觉差量'},'htmlBeforeSHA':payload['beforeSHA'],'htmlAfterSHA':H((P/'index.html').read_bytes()),'moduleScripts':[a['url'] for a in assets if a['url'].endswith('.js')],'stylesheet':next(a['url'] for a in assets if a['url'].endswith('.css')),'assets':assets,'apiWrites':0,'databaseWrites':0,'reloads':0,'timerPauses':0,'sourceCommit':'45f707ff450a60ff145a29f2e1284d73437c7a3b','sourceCommitMeaning':'baseline Git commit; this approved application delta is precisely pinned by sourceHashes/native inverse; subsequent Git archive separate','sourceHashes':sourceHashes,'testsPassedReused':99,'profileDisplayTestsPassed':8,'nativeLeafInverseVerified':True,'allOtherNativeBytesUnchanged':True,'htmlDeltaEvidence':json.loads((P/'evidence/html.json').read_text()),'nativeImportResolution':resolved,'acceptanceReadOnlyAuthorization':{'nonGETs':0,'authMode':'anonymous','fullLoggedInCustomerBusinessClaimed':False,'actualStaticHtmlAndBothNativeLeavesAndCssOnly':True},'previousAdminClosedReceiptSHA':closed['receiptSHA'],'previousAdminClosedCoordWholeSHA':closed['coordWholeSHA'],'previousFrontClosedReceiptSHA':oldm['previousFrontClosedReceiptSHA'],'previousFrontClosedCoordWholeSHA':'historical-before-admin-release; new formal coord bound separately','demoFixedDataIncluded':False,'businessHandlersAndAllNonTargetNativeBytesUnchanged':True,'budget':json.loads((O/'budget.json').read_text()),'toolPins':{k:H((O/n).read_bytes()) for k,n in [('releaseSHA','release.py'),('helperSHA','safety_core.py'),('landPackageSHA','land-package.py'),('applyAndConfirmSHA','apply-and-confirm.py'),('confirmPagesSHA','confirm-pages.py'),('baselineRemoteSHA','baseline-remote.py'),('builderSHA','actual-source/build-profile-native.mjs'),('preparerSHA','actual-source/prepare-profile-static.py'),('currentBinderSHA','actual-source/bind-profile-current.py')]}}
js('manifest-template.private.json',m)
print(json.dumps({'status':'COMPLETE_OFFLINE_PACKAGE_READY_FOR_ONE_CURRENT_BINDING','scope':SCOPE,'assetCount':3,'sourceFiles':sourceHashes,'coreSHA':m['toolPins']['helperSHA'],'applyGuardBudgetSeconds':505,'formalNativeURLCount':len(payload['nativeUrls']),'protectedFileCount':len(protected)},ensure_ascii=False,indent=2),flush=True)
