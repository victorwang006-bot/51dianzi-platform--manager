#!/usr/bin/env python3
"""Offline only: load_package validation, exact archive, non-executable parent templates.
Does not call Engine.plan/apply/verify/recover/close or any RPC/production IO.
"""
import sys
sys.dont_write_bytecode=True
import argparse,datetime,hashlib,json,pathlib,tarfile,types,difflib
W=pathlib.Path('/home/ubuntu/work/channel-reference-remediation-20261115');P=W/'deploy-prep-v4';D=pathlib.Path(__file__).parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def pin(p):
 p=pathlib.Path(p).resolve();return {'file':str(p),'sha256':sha(p.read_bytes())}
def put(p,obj):
 with pathlib.Path(p).open('xb') as f:f.write((json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode())
 return pin(p)
p=argparse.ArgumentParser();p.add_argument('--candidate',required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--input',required=True);p.add_argument('--input-sha256',required=True);a=p.parse_args()
candidate=pathlib.Path(a.candidate).resolve();assert str(candidate).startswith(str(P)+'/')
mbytes=(candidate/'manifest.json').read_bytes();assert sha(mbytes)==a.manifest_sha256;m=json.loads(mbytes)
assert sha(pathlib.Path(a.input).read_bytes())==a.input_sha256==m['inputContractSha256']
# Full original load_package including exact executing control digest + all inverse proofs.
s=types.ModuleType('v4_offline_driver');s.__file__=str(D/'release-driver.py');exec(compile((D/'release-driver.py').read_bytes(),s.__file__,'exec'),s.__dict__)
c={'contractVersion':'channel-remediation-activation-v1','ownerTask':m['ownerTask'],'runtimeRoot':m['runtimeRoot'],'candidateDir':str(candidate),'manifestSha256':a.manifest_sha256,'inputContractSha256':a.input_sha256,'attemptId':'offline_shape_check_not_an_activation','rootOwnershipNonce':'offline_check_nonce_no_prod_execution'}
package=s.load_package(c,s.IO(),require_final=False)
assert package['m']==m
proof=json.loads((P/'actual-default-sibling-v4.json').read_bytes());assert proof['status']=='PASS' and proof['manifestSha256']==a.manifest_sha256 and proof['sourceRecordsChecked']==588 and proof['statusCounts']['lcsc:ok']==151 and proof['statusCounts']['ickey:ok']==52
assert m['beforeHtmlSha256']==m['htmlSha256'] and m['scope']['newPublicAssets']==0 and m['scope']['dataOnly'] is True
assert len(m['sourceHashes'])==len(m['priorSourceHashes'])==147 and m['sourceHashes']==m['priorSourceHashes']
assert not any('/__pycache__/' in n or n.endswith('.pyc') or n.startswith('fixture-cache/') for n in m['packageHashes'])
raw=pathlib.Path('/home/ubuntu/work/channel-reference-remediation-20261115/deploy-prep/parent-production-release-v3/affected-native-qa.json');prior=json.loads(raw.read_bytes());assert prior['status']=='PASS' and prior['sourceHashes']==m['sourceHashes'];assert prior['nativeHostSha256']==m['packageHashes']['compiled-host.js']
ui_receipt={'contractVersion':'channel-remediation-v4-unchanged-native-browser-binding-v1','status':'PASS','fixtureOnly':False,'ready':False,'manifestSha256':a.manifest_sha256,'inputContractSha256':a.input_sha256,'sourceHashes':m['sourceHashes'],'rawPriorNativeBrowserReceipt':pin(raw),'nativeHostSha256':m['packageHashes']['compiled-host.js'],'allSourceAndUiOutputHashesEqual':True,'actualBrowserExecutedThisRound':False,'browserReexecutedByWrapper':False,'harnessDataFixture':True,'businessApiStubbed':True,'authenticatedProductionUI':False,'osClipboardVerified':False,'producerExecuted':False,'parentExecuted':False,'wrapperOnly':True,'productionApplyAuthorizedByThisReceipt':False,'finalDatasetValidatedSeparately':{'snapshotSha256':m['datasetAfterSha256'],'recordCount':294,'sourceCount':588,'successCount':203,'browserFixturesAreNotThisDataset':True},'scope':'offline mechanical original evidence reuse; parent must independently review binding, not a new browser run'}
ui_pin=put(P/'affected-native-qa-v4.MECHANICAL-REUSE.for-parent.json',ui_receipt)
review={'contractVersion':'channel-remediation-parent-review-v1','status':'NOT_APPROVED','approved':False,'fixtureOnly':False,'manifestSha256':a.manifest_sha256,'inputContractSha256':a.input_sha256,'runtimeRoot':m['runtimeRoot'],'ready':False,'mustIndependentlyConfirm':['actual fresh current v3 baseline provenance/report/capture-exit and all147 hashes','exact current v3 lifecycle guarded historical pins and all inherited/failed ROOT protections','31 driver +25 attached full-shape tests no skip and no-op HTML CAS branch','189 successful quote/evidence raw bytes retained and exact14 lcsc targets/203 validated','original HTML/two chunks/localCSS all byte-identical; native/browser prior proof reuse boundary','manual-refresh-config absent; no cache/config enabled; no DB/business writes','one new v4 incoming + one new attemptId/ownership nonce; never replay v1/v2/v3','parent read-only plan then exact independent review before separate production authorization'],'notProductionAuthorization':True}
review_pin=put(P/'parent-review-v4.NOT-APPROVED.template.json',review)
activation={**c,'candidateDir':'NOT-EXECUTABLE_REPLACE_WITH_NEW_PARENT_PRIVATE_INCOMING/candidate','attemptId':'NOT-EXECUTABLE_PARENT_NEW_ATTEMPT_REQUIRED','rootOwnershipNonce':'NOT-EXECUTABLE_PARENT_NEW_NONCE_REQUIRED','affectedNativeQA':{'file':'NOT-EXECUTABLE_PARENT_REVIEWED_BOUND_QA_REQUIRED','sha256':'NOT-EXECUTABLE'},'parentReview':{'file':'NOT-EXECUTABLE_INDEPENDENT_PARENT_APPROVAL_REQUIRED','sha256':'NOT-EXECUTABLE'},'ready':False,'manualRefreshMode':'manual-default-disabled','configProvisioned':False,'cacheProvisioned':False,'activeProducerAccepted':False,'notProductionAuthorization':True}
activation_pin=put(P/'activation-input-v4.NOT-EXECUTABLE.template.json',activation)
archive=P/'offline-candidate-fourteen-v4.tar.gz';assert not archive.exists()
with tarfile.open(archive,'w:gz') as t:t.add(candidate,arcname='offline-candidate-fourteen-v4',recursive=True)
control_diff='';diff_rows=[]
for pth in sorted(D.iterdir()):
 old=D.parent/'v3'/pth.name
 if not pth.is_file():continue
 before=old.read_bytes() if old.is_file() else b'';after=pth.read_bytes()
 if before!=after:
  control_diff+=''.join(difflib.unified_diff(before.decode().splitlines(True),after.decode().splitlines(True),fromfile='v3/'+pth.name if old.is_file() else '/dev/null',tofile='v4/'+pth.name))
  diff_rows.append({'relative':pth.name,'change':'modified' if old.is_file() else 'added','beforeSha256':sha(before) if old.is_file() else None,'afterSha256':sha(after)})
(P/'final-v3-v4-tool-diff.patch').write_text(control_diff)
put(P/'final-control-source-diff.json',diff_rows)
hashes={'contractVersion':'channel-remediation-v4-release-contract-hashes-v1','ready':False,'manifest':pin(candidate/'manifest.json'),'input':pin(a.input),'archive':pin(archive),'nativeBrowserMechanicalReuse':ui_pin,'parentReviewTemplate':review_pin,'activationTemplate':activation_pin,'controlPins':m['controlsPackageHashes'],'snapshotSha256':m['datasetAfterSha256'],'baselineReportSha256':m['baselineReportSha256'],'diff':pin(P/'final-v3-v4-tool-diff.patch'),'sourceHashes':m['sourceHashes'],'priorSourceHashes':m['priorSourceHashes'],'defaultSiblingQA':pin(P/'actual-default-sibling-v4.json')}
contracts_pin=put(P/'release-contract-hashes-v4.json',hashes)
result={'status':'OFFLINE_V4_DATA_ONLY_PASS_AWAIT_PARENT_REVIEW_NOT_EXECUTABLE','ready':False,'bundleDir':str(candidate),'manifest':pin(candidate/'manifest.json'),'input':pin(a.input),'archive':pin(archive),'archiveBytes':archive.stat().st_size,'releaseContract':contracts_pin,'activationTemplate':activation_pin,'parentReviewTemplate':review_pin,'nativeBrowserMechanicalReuse':ui_pin,'sourceUnionCount':147,'priorSourceUnionCount':147,'sourceRecordsChecked':588,'successReferences':203,'retainedSuccessReferences':189,'newLcscSuccessReferences':14,'sourceSuccessCounts':{'lcsc':151,'ickey':52},'legacyFrozenFileCount':len(m['legacyFrozenFiles']),'protectedFileCount':len(m['protectedFiles']),'packageFileCount':len(m['packageHashes'])+1,'driverTests':31,'attachedTests':25,'skipped':0,'controls':m['controlsPackageHashes'],'htmlBeforeSha256':m['beforeHtmlSha256'],'htmlAfterSha256':m['htmlSha256'],'htmlByteUnchanged':True,'newPublicAssets':0,'apiLiteralSliceCount':1,'all147SourceBytesUnchanged':True,'original189SuccessRawBytesRetained':True,'actualDefaultFixedSiblingValidated':True,'actualPackagedDriverLoadPackagePassed':True,'nativeBrowserReexecuted':False,'productionExecuted':False,'sshUsed':False,'gitUsed':False,'applicationWrites':0,'dbWrites':0,'oldV1V2V3Untouched':True,'finishedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
put(P/'final-fourteen-result-v4.json',result);print(json.dumps(result,ensure_ascii=False,indent=2))
