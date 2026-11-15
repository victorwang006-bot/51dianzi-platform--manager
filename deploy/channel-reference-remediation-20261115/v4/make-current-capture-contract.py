#!/usr/bin/env python3
"""Offline only. Pins parent-supplied fresh preflight SHA plus actual state/coord SHA.
Does not contact ECS or claim preflight/capture success. Creates a NEW local contract only.
"""
import sys
sys.dont_write_bytecode=True
import argparse, hashlib, json, pathlib, re
WORK=pathlib.Path('/home/ubuntu/work/channel-reference-remediation-20261115')
PREP=WORK/'deploy-prep'
CURRENT='/opt/ops/20261115-channel-reference-remediation-cSy4W28-v3'
NEW='/opt/ops/20261115-channel-reference-remediation-cSy4W28-v4'
sha=lambda b:hashlib.sha256(b).hexdigest()
def pin(p,h):
    b=pathlib.Path(p).read_bytes();assert sha(b)==h, 'PIN_DRIFT '+str(p);return b
def full(h):
    assert re.fullmatch('[0-9a-f]{64}',h),'FULL_SHA256_REQUIRED';return h
p=argparse.ArgumentParser()
p.add_argument('--state-sha256',required=True);p.add_argument('--coord-sha256',required=True)
p.add_argument('--parent-preflight',required=True);p.add_argument('--preflight-sha256',required=True)
p.add_argument('--output',required=True)
a=p.parse_args()
preflight=pin(a.parent_preflight,full(a.preflight_sha256))
assert preflight, 'ACTUAL_PARENT_PREFLIGHT_BYTES_REQUIRED'
mbytes=pin(PREP/'offline-candidate-final-five-v3/manifest.json','9821de2b8c778efcc005ad3f9da7fb753fdf6b3d9c0ad71d7e4fcee51cf6d594');m=json.loads(mbytes)
receipt_bytes=pin(WORK/'delivery/GitHub与ECS最新来源绑定.json','a2e0b4f62352c5a15b6aa220412f344f45b1fc7373bbe66334c5ceae97568174');r=json.loads(receipt_bytes)
summary=json.loads((PREP/'parent-production-release-v3/release-summary.json').read_bytes())
activation=pin(PREP/'parent-production-release-v3/activation-input.json',r['activationInputSha256'])
assert m['runtimeRoot']==CURRENT==r['runtimeRoot'] and m['sourceHashes']==r['sourceHashes']
assert m['sourceUnionCount']==len(m['sourceHashes'])==r['sourceHashCount']==147
assert m['priorSourceUnionCount']==len(m['priorSourceHashes'])==130
controls=('release-driver.py','attached-admin-reloader.cjs','validate-snapshot-helper.cjs')
assert r['controlsRepoHashes']=={'deploy/channel-reference-remediation-20261115/v3/'+n:m['controlsPackageHashes'][n] for n in controls}
for n in controls:pin(PREP/'offline-candidate-final-five-v3'/n,m['controlsPackageHashes'][n])
assert summary['manifestSha256']==sha(mbytes) and summary['inputContractSha256']==m['inputContractSha256']
failed=json.loads((PREP/'parent-baseline-refresh-v3.json').read_bytes())['failedRoots']
assert len(failed)==2 and {x['root'] for x in failed}=={'/opt/ops/20261115-channel-reference-remediation-cSy4W28','/opt/ops/20261115-channel-reference-remediation-cSy4W28-v2'}
c={'contractVersion':'channel-remediation-current-v3-capture-for-v4-v1','currentRuntimeRoot':CURRENT,'newRuntimeRoot':NEW,'currentSourceCommit':r['gitCommit'],'metadataPins':{'manifest.json':sha(mbytes),'input-contract.json':m['inputContractSha256'],**m['controlsPackageHashes']},'sourceReceipt':{'file':summary['incoming']+'/git-source-receipt.final.json','sha256':sha(receipt_bytes)},'activationInput':{'file':summary['incoming']+'/activation-input.json','sha256':sha(activation)},'activationState':{'file':CURRENT+'/activation-state.json','sha256':full(a.state_sha256)},'coordination':{'file':'/opt/ops/51-project-release-coordination-20261027.json','sha256':full(a.coord_sha256)},'rootConfigPins':{n:m['sourceHashes'][n] for n in ['package.json','pnpm-lock.yaml','tsconfig.json']},'failedRoots':failed,'parentPreflightSha256':sha(preflight),'ready':False,'scope':'READONLY_CAPTURE_ONLY_NOT_ACTIVATION; supplied state/coord hashes must be from parent fresh preflight, never old PID fabrication'}
output=pathlib.Path(a.output).resolve();assert str(output).startswith(str(WORK/'deploy-prep-v4')+'/') and not output.exists(),'NEW_LOCAL_PREP_V4_OUTPUT_ONLY'
output.parent.mkdir(parents=True,exist_ok=True)
b=(json.dumps(c,ensure_ascii=False,indent=2)+'\n').encode()
with output.open('xb') as f:f.write(b)
script=pathlib.Path(__file__).with_name('capture-current-readonly.py')
print(json.dumps({'status':'CONTRACT_CREATED_CAPTURE_NOT_EXECUTED','contractFile':str(output),'contractSha256':sha(b),'captureScriptSha256':sha(script.read_bytes()),'stateSha256':a.state_sha256,'coordSha256':a.coord_sha256,'sourceUnionCount':147,'priorSourceUnionCount':130,'ready':False},indent=2))
