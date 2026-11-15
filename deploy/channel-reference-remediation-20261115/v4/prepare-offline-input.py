#!/usr/bin/env python3
"""Offline-only NEW data-only input and exact147 source snapshot preparation.
Parent supplies actual fresh capture baseline/report plus confirmed staged-fourteen pin.
No application writes, SSH/Git/DB/HTTP, and never manufactures a fresh baseline.
"""
import sys
sys.dont_write_bytecode=True
import argparse,hashlib,json,pathlib,shutil
W=pathlib.Path('/home/ubuntu/work/channel-reference-remediation-20261115');P=W/'deploy-prep-v4';V3=W/'deploy-prep';REPO=pathlib.Path('/home/ubuntu/work/51dianzi-platform--manager');D=pathlib.Path(__file__).parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def pinned(p,h):
 p=pathlib.Path(p).resolve();b=p.read_bytes();assert sha(b)==h,'PIN_DRIFT '+str(p);return b
def pin(p):
 p=pathlib.Path(p).resolve();return {'file':str(p),'sha256':sha(p.read_bytes())}
def put(p,obj):
 b=(json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode()
 with p.open('xb') as f:f.write(b)
 return pin(p)
p=argparse.ArgumentParser();p.add_argument('--baseline',required=True);p.add_argument('--report-sha256',required=True);p.add_argument('--snapshot',required=True);p.add_argument('--snapshot-sha256',required=True);p.add_argument('--capture-execution',required=True);p.add_argument('--capture-execution-sha256',required=True);p.add_argument('--source-dir',required=True);p.add_argument('--candidate-dir',required=True);p.add_argument('--output',required=True);a=p.parse_args()
base=pathlib.Path(a.baseline).resolve();b=json.loads(pinned(base/'live-baseline-current.json',a.report_sha256));assert b['contractVersion']=='channel-remediation-fresh-baseline-v4-v1' and b['currentRuntimeRoot']=='/opt/ops/20261115-channel-reference-remediation-cSy4W28-v3' and b['newRuntimeRoot']=='/opt/ops/20261115-channel-reference-remediation-cSy4W28-v4'
assert b['captureScriptSha256']==pin(D/'capture-current-readonly.py')['sha256']
contract_pin=pin(P/'current-v3-capture-contract.json');assert b['captureContractSha256']==contract_pin['sha256']
execution=json.loads(pinned(a.capture_execution,a.capture_execution_sha256));assert execution.get('actualExitCode')==0,'PARENT_ACTUAL_CAPTURE_EXIT_ZERO_REQUIRED'
snapshot=pathlib.Path(a.snapshot).resolve();assert snapshot.parent==W/'data/final-fourteen' and snapshot.name=='channel-reference-snapshot.staged-fourteen.json','PARENT_CONFIRMED_FOURTEEN_PATH_ONLY';assert sha(snapshot.read_bytes())==a.snapshot_sha256
assert a.snapshot_sha256=='7436dd3b65cf7694937c63797bf9680dc5a48b8b78dc89a7a5a66ee355496685','CONFIRMED_FOURTEEN_DATA_PIN_REQUIRED'
assert b['sourceUnionCount']==len(b['sourceHashes'])==147
source=pathlib.Path(a.source_dir).resolve();candidate=pathlib.Path(a.candidate_dir).resolve();output=pathlib.Path(a.output).resolve()
for q in [source,candidate,output]:assert str(q).startswith(str(P)+'/') and not q.exists(),'NEW_V4_LOCAL_PATH_ONLY '+str(q)
assert source!=candidate and output!=source and output!=candidate
# Every app graph file is a read-only SHA check. Copy from captured source, not changed business source.
source_bytes={}
for n,h in b['sourceHashes'].items():
 source_bytes[n]=pinned(base/'source-snapshot'/n,h);pinned(REPO/n,h)
assert sha((REPO/'server/channelReference/channel-reference-snapshot.json').read_bytes())=='e21df84339d5265f9358be54c1935157ebe90e1088e67e6b05c0550a9e3af8dc','APP_SNAPSHOT_BEFORE_BYTES_NOT_MODIFIED'
source.mkdir(mode=0o700)
for n,data in source_bytes.items():
 f=source/n;f.parent.mkdir(parents=True,exist_ok=True)
 with f.open('xb') as out:out.write(data)
old=json.loads((base/'previous-manifest.json').read_bytes());urls=sorted('/'+r['relative'] for r in old['files'] if r['relative'].startswith('assets/BusinessWorkbenchPage-'))
assert len(urls)==2
controls=['release-driver.py','attached-admin-reloader.cjs','validate-snapshot-helper.cjs']
def ev(p,relative):return {**pin(p),'relative':relative}
execution_pins=[ev(a.capture_execution,'execution-evidence/v4/parent-capture.execution.json'),ev(P/'current-v3-preflight.json','execution-evidence/v4/current-v3-preflight.json'),ev(P/'current-v3-capture-contract.json','execution-evidence/v4/current-v3-capture-contract.json'),ev(P/'control-tests-v4/fake-driver-qa.json','offline-qa/fake-driver-qa.json'),ev(P/'fake-attached-qa-v4.json','offline-qa/fake-attached-qa.json'),ev(P/'control-driver.stdout.log','execution-evidence/v4/control-driver.stdout.log'),ev(P/'control-driver.stderr.log','execution-evidence/v4/control-driver.stderr.log'),ev(P/'control-attached.stdout.log','execution-evidence/v4/control-attached.stdout.log'),ev(P/'control-attached.stderr.log','execution-evidence/v4/control-attached.stderr.log'),ev(P/'control-source-v3-v4.diff','execution-evidence/v4/control-source-v3-v4.diff'),ev(V3/'parent-production-release-v3/affected-native-qa.json','execution-evidence/prior-v3/affected-native-qa.json')]
data_pins=[]
for q in sorted((W/'data/final-fourteen').rglob('*')):
 if q.is_file():data_pins.append(ev(q,'data-evidence/fourteen/'+q.relative_to(W/'data/final-fourteen').as_posix()))
input={'contractVersion':'channel-remediation-offline-input-v1','runtimeRoot':b['newRuntimeRoot'],'ownerTask':'cSy4W284Up1OQWfrwWJm6K','fixtureOnly':False,'appFrozen':True,'manualRefreshMode':'manual-default-disabled','configProvisioned':False,'cacheProvisioned':False,'activeProducerAccepted':False,'manualDisabledGuard':b['manualDisabledGuard'],'baselineDir':str(base),'baselineReportSha256':a.report_sha256,'captureScriptPin':pin(D/'capture-current-readonly.py'),'captureContractPin':contract_pin,'currentSourceReceiptPin':pin(W/'delivery/GitHub与ECS最新来源绑定.json'),'sourceDir':str(source),'sourceHashes':b['sourceHashes'],'authorizedSourceDeltas':[],'outputDir':str(candidate),'snapshotBefore':pin(base/'channel-reference-snapshot.json'),'snapshotAfter':pin(snapshot),'allowedChangedRecordKeys':json.loads((W/'data/final-fourteen/allowed-changed-record-keys.json').read_bytes()),'oldSuccessByteProofPin':pin(W/'data/final-fourteen/old-189-success-byte-preservation.json'),'currentWorkbenchUrls':urls,'priorCandidateDir':str(V3/'offline-candidate-final-five-v3'),'controlPins':{n:pin(D/n)['sha256'] for n in controls},'driverQAPin':pin(P/'control-tests-v4/fake-driver-qa.json'),'attachedQAPin':pin(P/'fake-attached-qa-v4.json'),'priorNativeBrowserPin':pin(V3/'parent-production-release-v3/affected-native-qa.json'),'runtimeQAReportFile':str(P/'actual-default-sibling-v4.json'),'executionEvidencePins':execution_pins,'dataEvidencePins':data_pins,'ready':False,'scope':'data-only fourteen new lcsc quotes; all147 graph and UI bytes frozen; no production authorization'}
r=put(output,input);print(json.dumps({'status':'INPUT_PREPARED_BUILD_NOT_EXECUTED','input':r,'sourceCount':147,'candidateDir':str(candidate),'dataEvidenceFiles':len(data_pins),'ready':False},ensure_ascii=False,indent=2))
