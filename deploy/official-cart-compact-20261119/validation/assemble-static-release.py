#!/usr/bin/env python3
"""Offline assembly ONLY. Never collects production evidence or creates review.
Usage: python3 validation/assemble-static-release.py [--protection /absolute/actual.json]
No protection -> draft only, no runnable manifest. Protection -> externally reviewed
package candidate; no preflight/apply, no SSH/PM2/network/browser/DB/Git invocation.
"""
from pathlib import Path
import argparse,base64,hashlib,importlib.util,json,shutil,tarfile
W=Path('/home/ubuntu/work/cart-compact-20261119')
C=W/'packaging/ui-candidate/candidate-ui'
R=W/'release-cart-static-final'
P=R/'package'
H=lambda b:hashlib.sha256(b).hexdigest()
def need(v,c):
 if not v:raise RuntimeError(c)
def enc(x):return(json.dumps(x,ensure_ascii=False,indent=2)+'\n').encode()
def cp(src,dst):
 src=Path(src);target=P/dst;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,target);return {'source':dst,'sha256':H(target.read_bytes())}
def inverse(before,after,d):
 need(H(before)==d['beforeSha256'] and H(after)==d['afterSha256'] and d['inverseVerified']is True,'HTML_DELTA_PINS')
 value=after
 for e in reversed(d['patches']):
  old=base64.b64decode(e['oldBase64']);new=base64.b64decode(e['newBase64']);need(value[e['newStart']:e['newEnd']]==new,'HTML_DELTA_NEW_PREIMAGE');value=value[:e['newStart']]+old+value[e['newEnd']:]
 need(value==before,'HTML_EXACT_INVERSE_BYTES')
def main():
 p=argparse.ArgumentParser();p.add_argument('--protection');a=p.parse_args()
 spec=importlib.util.spec_from_file_location('fixed_static_release',W/'validation/static-release.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 R.mkdir(exist_ok=True);P.mkdir(exist_ok=True)
 # Existing evidence is never represented as a new build or a real financial test.
 u=json.loads((C/'manifest.json').read_bytes());f=json.loads((W/'packaging/ui-final-freeze.json').read_bytes());b=json.loads((W/'validation/browser-candidate-result.json').read_bytes());vm=json.loads((W/'packaging/ui-tests-actual.json').read_bytes());supp=json.loads((W/'validation/ui-inherited-dependency-proof.json').read_bytes())
 need(b['status']=='passed' and b['actualProductionMutationsSent']==0 and b['productionSessionMinted']is False and b['noRealProviderInvoked']is True and b['noRealCartItemCreated']is True,'ACTUAL_BROWSER_LOCAL_MOCK_ONLY_PROOF')
 need(vm['status']=='passed' and vm['testCount']==54 and all(x['passed'] for x in vm['checks']),'ACTUAL_54_VM_CHECKS')
 need(supp['status']=='PASS' and supp['candidateByteChange']is False and supp['allEightAlreadyProtectedBeforeBuild']is True and len(supp['files'])==8,'INHERITED_SUPPLEMENT_NOT_REBUILD')
 need(f['approvedSourceFreeze']is True and u['sourceFiles']==f['sourceFiles'],'EXACT_FROZEN_SOURCE_BINDING')
 cp(f['inputs']['frontHtml']['local'],'baseline-index.html');cp(C/'index.html','candidate-index.html');before=(P/'baseline-index.html').read_bytes();after=(P/'candidate-index.html').read_bytes();need(H(before)==mod.BEFORE_HTML and H(after)==mod.AFTER_HTML,'EXACT_HTML_BASELINE_AND_CANDIDATE');inverse(before,after,json.loads((C/'html-delta.json').read_bytes()))
 cp(W/'validation/static-release.py','static-release.py');cp(W/'validation/test_static_release.py','test_static_release.py');cp(W/'validation/assemble-static-release.py','tools/assemble-static-release.py')
 assets=[]
 for row in u['files']:
  rel=row['url'].lstrip('/');need(mod.ASSETS.get(rel)==row['sha256'] and H((C/rel).read_bytes())==row['sha256'],'EXACT_FOUR_SOURCE_BOUND_ASSETS');cp(C/rel,rel);assets.append({'relative':rel,'sha256':row['sha256']})
 need(len(assets)==4,'EXACT_FOUR_JS')
 sources=[]
 for src,h in u['sourceFiles'].items():
  need(H(Path(src).read_bytes())==h,'SOURCE_FILE_CHANGED '+src);rel='source/'+Path(src).relative_to('/home/ubuntu').as_posix();sources.append(cp(src,rel))
 evidence=[]
 for src in [C/'manifest.json',C/'html-delta.json',C/'search-delta.json',C/'nav-delta.json',C/'cart-delta.json',W/'packaging/ui-final-freeze.json',W/'packaging/ui-tests-actual.json',W/'validation/ui-inherited-dependency-proof.json',W/'validation/browser-candidate-result.json',W/'validation/ui-production-react-build.log',W/'validation/ui-production-react-tests.log',W/'validation/frontend-compact-final.log',W/'validation/frontend-final-tests.log',R/'static-release-tests.log']:
  dst='evidence/'+('ui-candidate-manifest.json' if src==C/'manifest.json' else src.name);evidence.append(cp(src,dst))
 initial=(W/'live/protection-initial.json').read_bytes();need(H(initial)==mod.INITIAL_SHA,'ACTUAL_INITIAL_277');cp(W/'live/protection-initial.json','evidence/protection-initial.json');initial=json.loads(initial);ip={r['path']:r['sha256'] for r in initial['protectedFiles']}
 for row in supp['files']:need(ip.get(row['path'])==row['sha256'],'INHERITED_ALREADY_PROTECTED_PIN')
 schema={'required':['capturedAtUtc','protectedFiles','beforeProcesses','coordinator','coordinatorSha256','newFlag','newFlagSha256'],'capturedAtUtc':'actual UTC after API verified, <=15 minutes old','beforeProcesses':'12 actual normalized rows: id,name,pid,status,script,cwd,envHash; same helper and four volatile exclusions; NO synthetic fresh PIDs','protectedFiles':'all original 277 plus exact API after roots, two new runtime files and enabled new flag; HTML preimage remains fixed separately','coordinator':'actual complete JSON object including own verified API history and original paid guard history','coordinatorSha256':'SHA256 of actual coordinator raw bytes, not reserialization','newFlag':'actual new active flag JSON object, enabled true','newFlagSha256':'SHA256 of actual new active flag raw bytes, also protectedFiles pin'}
 (R/'protection-input-schema.json').write_bytes(enc(schema))
 common={'schemaVersion':1,'ownerTask':mod.OWNER,'scope':mod.SCOPE,'apiWrites':0,'databaseWrites':0,'processReloads':0,'adminHtmlWrites':0,'beforeHtmlSha256':mod.BEFORE_HTML,'afterHtmlSha256':mod.AFTER_HTML,'controllerSha256':H((P/'static-release.py').read_bytes()),'assets':assets,'sources':sources,'evidence':evidence,'uiCandidateOriginalStatus':u['status'],'inheritedSupplementOnlyNoRebuild':True,'browserEvidenceBoundary':'actual native React/browser; ALL APIs local mocks; no real production POST/session/order/payment','processEvidenceBoundary':'readonly exact 12 PIDs and normalized configured envHash, no fictitious raw /proc proof','stageAlias':str(mod.STAGE),'onlyActiveWrites':['four exclusive-create content-addressed JavaScript assets','front index.html full-byte CAS','shared coordination full-byte CAS'],'independentReviewRequired':True}
 if not a.protection:
  need(not(P/'manifest.json').exists(),'FROZEN_PACKAGE_EXISTS_NO_DOWNGRADE');common['status']='WAITING_FOR_ACTUAL_AFTER_API_PROTECTION_NOT_DEPLOYABLE';(R/'draft-manifest.json').write_bytes(enc(common));(P/'review.json').write_bytes(b'{}\n');summary={'status':common['status'],'productionOperations':0,'root':str(R),'package':str(P),'controllerSha256':common['controllerSha256'],'freezeCommand':'python3 '+str(W/'validation/assemble-static-release.py')+' --protection /absolute/actual-after-api-protection.json','inputSchema':str(R/'protection-input-schema.json')}
 else:
  capture=Path(a.protection);need(capture.is_absolute() and capture.is_file(),'EXPLICIT_ABSOLUTE_REAL_PROTECTION');sb=capture.read_bytes();s=json.loads(sb);api_history=mod.validate_protection(s);sp={r['path']:r['sha256']for r in s['protectedFiles']};need(all(sp.get(k)==v for k,v in ip.items()),'ALL_ORIGINAL_277_REQUIRED')
  for key,role in [('frontApi',mod.FRONT),('refundWorker',mod.REFUND)]:
   if 'targets'in s and key in s['targets']:need(s['targets'][key]['sha256']==mod.API_PINS[role],'NO_PRE_API_TARGET_BASELINE')
  if 'targets'in s and 'frontHtml'in s['targets']:need(s['targets']['frontHtml']['sha256']==mod.BEFORE_HTML,'CAPTURE_FRONT_PREIMAGE_REQUIRED')
  cp(capture,'evidence/protection.json');common.update(status='FROZEN_CANDIDATE_AWAITING_INDEPENDENT_REVIEW',protectionSha256=H(sb),protectedFiles=[r for r in s['protectedFiles']if r['path']!=str(mod.PUBLIC/'index.html')],beforeProcesses=s['beforeProcesses'],newFlag=s['newFlag'],apiHistory=api_history)
  common['packageFiles']={q.relative_to(P).as_posix():H(q.read_bytes())for q in P.rglob('*')if q.is_file() and q.name not in('manifest.json','review.json')};(P/'manifest.json').write_bytes(enc(common));(P/'review.json').write_bytes(b'{}\n');manifest_sha=H((P/'manifest.json').read_bytes());summary={'status':common['status'],'productionOperations':0,'root':str(R),'package':str(P),'manifestSha256':manifest_sha,'controllerSha256':common['controllerSha256'],'protectionSha256':H(sb),'protectedFiles':len(common['protectedFiles']),'reviewExactFields':{'status':'passed','independent':True,'manifestSha256':manifest_sha,'controllerSha256':common['controllerSha256'],'protectionSha256':H(sb)},'reviewWarning':'Independent reviewer MUST supply actual approval. This assembler never self-approves. Apply additionally requires --review-sha256 of independently supplied review.json.'}
  archive=R/'release-cart-static-final.tar.gz'
  with tarfile.open(archive,'w:gz')as t:
   for q in sorted(P.rglob('*')):
    if q.is_file():t.add(q,arcname=q.relative_to(P).as_posix())
  summary['archive']=str(archive);summary['archiveSha256']=H(archive.read_bytes())
 if not a.protection:
  draft=R/'release-cart-static-draft-NOT-DEPLOYABLE.tar.gz'
  with tarfile.open(draft,'w:gz')as t:
   for q in sorted(P.rglob('*')):
    if q.is_file():t.add(q,arcname='package/'+q.relative_to(P).as_posix())
   t.add(R/'draft-manifest.json',arcname='draft-manifest.json')
   t.add(R/'protection-input-schema.json',arcname='protection-input-schema.json')
  summary['draftArchive']=str(draft);summary['draftArchiveSha256']=H(draft.read_bytes())
 (R/'assembly-summary.json').write_bytes(enc(summary));print(json.dumps(summary,ensure_ascii=False))
if __name__=='__main__':main()
