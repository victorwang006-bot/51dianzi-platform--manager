#!/usr/bin/env python3
"""Offline source+data preparation after parent final pins. No production/application writes."""
import sys
sys.dont_write_bytecode=True
import argparse,hashlib,json,pathlib,subprocess
W=pathlib.Path('/home/ubuntu/work/channel-reference-remediation-20261115');P=W/'deploy-prep-v4-brand';V4=W/'deploy-prep-v4';REPO=pathlib.Path('/home/ubuntu/work/51dianzi-platform--manager');D=pathlib.Path(__file__).parent
REPORT='3cbc90793faa0339a629670d685e7cf5c59ebb4235dbaca1d4b7b791b3172163';ROOT='/opt/ops/20261115-channel-reference-remediation-cSy4W28-v4';OLD='/opt/ops/20261115-channel-reference-remediation-cSy4W28-v3'
sha=lambda b:hashlib.sha256(b).hexdigest()
def pinned(p,h):
 p=pathlib.Path(p).resolve();data=p.read_bytes();assert sha(data)==h,'PIN_DRIFT '+str(p);return data
def pin(p):
 p=pathlib.Path(p).resolve();return {'file':str(p),'sha256':sha(p.read_bytes())}
def put(p,obj):
 with pathlib.Path(p).open('x') as f:json.dump(obj,f,ensure_ascii=False,indent=2);f.write('\n')
def evidence(pin_,relative):
 pinned(pin_['file'],pin_['sha256']);return {**pin_,'relative':relative}
a=argparse.ArgumentParser();a.add_argument('--parent-final-inputs',required=True);a.add_argument('--sha256',required=True);a=a.parse_args()
parent=json.loads(pinned(a.parent_final_inputs,a.sha256))
assert parent['contractVersion']=='channel-remediation-v4-brand-parent-final-inputs-v1' and parent['finalizedForOfflineBuild'] is True and parent['productionAuthorized'] is False,'WAIT_PARENT_FINAL_DATA_AND_SOURCE_NOT_BUILDING'
assert parent['baselineReportSha256']==REPORT and parent['runtimeRoot']==ROOT
base=V4/'baseline-current-v4';b=json.loads(pinned(base/'live-baseline-current.json',REPORT));assert b['currentRuntimeRoot']==b['oldRuntimeRoot']==OLD and b['newRuntimeRoot']==ROOT
original=json.loads((V4/'offline-input-v4.json').read_bytes());assert original['baselineReportSha256']==REPORT
for k in ['captureScriptPin','captureContractPin','currentSourceReceiptPin','priorNativeBrowserPin']:pinned(original[k]['file'],original[k]['sha256'])
assert len(b['sourceHashes'])==147 and set(parent['sourceHashes'])==set(b['sourceHashes'])
allowed={'shared/channelReferenceBrand.ts','server/channelReference/snapshot.ts',*['server/channelReference/'+n+'.test.ts' for n in ['brandAliases','defaultLookup','manualRefresh','manualRefreshConfig','realBrandRegression','snapshot','worker']]}
assert b['sourceHashes']['server/channelReference/snapshot.ts']=='ae4057336e956e2bd11c557060833df77685b47e70c98376a8377332c05a272f','SNAPSHOT_CORE_ORIGINAL_BEFORE_PIN'
actual=[{'relative':n,'beforeSha256':b['sourceHashes'][n],'afterSha256':parent['sourceHashes'][n]} for n in sorted(b['sourceHashes']) if b['sourceHashes'][n]!=parent['sourceHashes'][n]]
assert actual==parent['approvedSourceDeltas'] and 1<=len(actual)<=9 and any(r['relative']=='shared/channelReferenceBrand.ts' for r in actual),'EXACT_PARENT_SOURCE_DELTA_LIST'
assert all(set(r)=={'relative','beforeSha256','afterSha256'} and r['relative'] in allowed for r in actual),'BRAND_OPTIONAL_SNAPSHOT_CORE_OR_EXACT_SEVEN_TESTS_ONLY'
assert all(r['afterSha256']=='63df6be84eac7267b621addd083cfe04c433d579979e70bae3c38aae5963f169' for r in actual if r['relative']=='server/channelReference/snapshot.ts'),'PARENT_REVIEWED_SNAPSHOT_CORE_EXACT_AFTER_PIN'
source_root=pathlib.Path(parent['sourceDir']).resolve();source_bytes={}
for n,h in parent['sourceHashes'].items():
 pinned(base/'source-snapshot'/n,b['sourceHashes'][n]);source_bytes[n]=pinned(source_root/n,h)
assert pin(REPO/'server/channelReference/channel-reference-snapshot.json')['sha256']==original['snapshotBefore']['sha256'],'APP_SNAPSHOT_BEFORE_BYTES_NOT_MODIFIED'
pinned(parent['snapshotAfter']['file'],parent['snapshotAfter']['sha256']);summary=parent['expectedDataSummary'];assert summary['totalSuccessCount']==189+summary['newSuccessCount']
assert parent['allowedChangedRecordKeys']['candidateSha256']==parent['snapshotAfter']['sha256'] and parent['allowedChangedRecordKeys']['beforeSha256']==original['snapshotBefore']['sha256']
preservation=json.loads(pinned(parent['oldSuccessByteProofPin']['file'],parent['oldSuccessByteProofPin']['sha256']));assert preservation['oldSuccessCount']==len(preservation['results'])==189 and preservation['allOldSuccessfulQuoteAndEvidenceOriginalBytesEqual'] is True and preservation['allOldSuccessfulTimesUntouched'] is True
validation=json.loads(pinned(parent['actualTSValidationPin']['file'],parent['actualTSValidationPin']['sha256']));execution=json.loads(pinned(parent['actualTSExecutionPin']['file'],parent['actualTSExecutionPin']['sha256']));assert execution['actualExitCode']==0
assert validation['snapshotSha256']==parent['snapshotAfter']['sha256'] and validation['validation']['sourceCount']==588 and validation['validation']['allValid'] is True and validation['validation']['positiveCount']==summary['totalSuccessCount']
for required in ['shared/channelReferenceBrand.ts','server/channelReference/snapshot.ts']:
 rows=[h for n,h in validation['sourceHashesAtBuild'].items() if n==required or n.endswith('/'+required)];assert rows==[parent['sourceHashes'][required]],'ACTUAL_TS_NEW_SOURCE_BUILD_PIN '+required
controls=['release-driver.py','attached-admin-reloader.cjs','validate-snapshot-helper.cjs'];driver=pin(P/'control-tests-v4-brand/fake-driver-qa.json');attached=pin(P/'fake-attached-qa-v4-brand.json')
for q,count,field,n in [(driver,31,'testedDriverSha256','release-driver.py'),(attached,25,'testedReloaderSha256','attached-admin-reloader.cjs')]:
 r=json.loads(pinned(q['file'],q['sha256']));assert r['status']=='PASS' and r['count']==count and r[field]==pin(D/n)['sha256']
execution_pins=[r for r in original['executionEvidencePins'] if not r['relative'].startswith('offline-qa/')]
execution_pins += [evidence(driver,'offline-qa/fake-driver-qa.json'),evidence(attached,'offline-qa/fake-attached-qa.json'),evidence(parent['actualTSValidationPin'],'data-evidence/brand-final/actual-ts-validation.json'),evidence(parent['actualTSExecutionPin'],'data-evidence/brand-final/actual-ts-execution.json')]
for n in ['control-driver.stdout.log','control-driver.stderr.log','control-attached.stdout.log','control-attached.stderr.log']:execution_pins.append(evidence(pin(P/n),'execution-evidence/v4-brand/'+n))
data_pins=parent['dataEvidencePins'];source_pins=parent['sourceEvidencePins']
for r in execution_pins+data_pins+source_pins:pinned(r['file'],r['sha256'])
assert data_pins and source_pins,'PARENT_REAL_DATA_AND_AFFECTED_SOURCE_EVIDENCE_REQUIRED'
assert len({r['relative'] for r in execution_pins+data_pins+source_pins})==len(execution_pins+data_pins+source_pins),'UNIQUE_EVIDENCE_PATHS'
source=P/'source-snapshot-v4-brand';candidate=P/'offline-candidate-brand-v4';output=P/'offline-input-v4-brand.json'
for q in [source,candidate,output,P/'actual-default-sibling-v4-brand.json']:assert not q.exists(),'NEW_LOCAL_PATH_ONLY '+str(q)
source.mkdir(mode=0o700)
for n,data in source_bytes.items():
 f=source/n;f.parent.mkdir(parents=True,exist_ok=True)
 with f.open('xb') as out:out.write(data)
program="const S=require(process.argv[1]);const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(process.argv[2]));const b=JSON.parse(fs.readFileSync(process.argv[3]));console.log(JSON.stringify(S.detect(process.argv[4],process.argv[5],b.sourceHashes,p.sourceHashes)));"
r=subprocess.run(['node','-e',program,str(D/'source-contract.cjs'),str(pathlib.Path(a.parent_final_inputs).resolve()),str(base/'live-baseline-current.json'),str(base/'source-snapshot'),str(source)],cwd=REPO,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
put(P/'source-descriptor-execution.json',{'argv':r.args,'actualExitCode':r.returncode,'stdoutSha256':sha(r.stdout),'stderrSha256':sha(r.stderr),'applicationWrites':0,'productionExecuted':False});assert r.returncode==0,r.stderr.decode();descriptors=json.loads(r.stdout)
assert sorted([{k:r[k] for k in ['relative','beforeSha256','afterSha256']} for r in descriptors],key=lambda r:r['relative'])==actual
input={**original,'parentFinalInputsPin':{'file':str(pathlib.Path(a.parent_final_inputs).resolve()),'sha256':a.sha256},'sourceDir':str(source),'sourceHashes':parent['sourceHashes'],'approvedSourceDeltas':actual,'authorizedSourceDeltas':descriptors,'outputDir':str(candidate),'snapshotAfter':parent['snapshotAfter'],'allowedChangedRecordKeys':parent['allowedChangedRecordKeys'],'expectedDataSummary':summary,'oldSuccessByteProofPin':parent['oldSuccessByteProofPin'],'actualTSValidationPin':parent['actualTSValidationPin'],'actualTSExecutionPin':parent['actualTSExecutionPin'],'controlPins':{n:pin(D/n)['sha256'] for n in controls},'driverQAPin':driver,'attachedQAPin':attached,'runtimeQAReportFile':str(P/'actual-default-sibling-v4-brand.json'),'executionEvidencePins':execution_pins,'dataEvidencePins':data_pins+source_pins,'scope':'exact approved backend brand+evidenceURL core and seven optional test deltas + final merged data; same147 paths and current-v3 prior147; HTML/native/CSS byte reuse; parent-only production','ready':False}
put(output,input);print(json.dumps({'status':'INPUT_PREPARED_BUILD_NOT_EXECUTED','input':pin(output),'sourceCount':147,'sourceDeltas':actual,'candidateDir':str(candidate),'ready':False},ensure_ascii=False,indent=2))
