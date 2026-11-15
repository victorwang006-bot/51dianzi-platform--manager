#!/usr/bin/env python3
"""Offline contract preparation only; parent executes remote read-only capture separately."""
import sys
sys.dont_write_bytecode=True
import argparse, pathlib, hashlib, json, re, base64
WORK=pathlib.Path('/home/ubuntu/work/inventory-compact-edit-20261115/deploy')
MIRROR=pathlib.Path('/home/ubuntu/work/channel-reference-remediation-20261115/deploy-prep-v4-brand/offline-candidate-brand-v4')
CURRENT='/opt/ops/20261115-channel-reference-remediation-cSy4W28-v4'
NEW='/opt/ops/20261115-inventory-compact-edit-cSy4W28'
MANIFEST='5d55c8e639ec9dc6c4cbd3fbc55c5e60b6b3fd471d939579ea4f0d6a28b24a11'
RECEIPT='b9d56aa8c57c3fd096dda2dc5830dee6fb3f7961596262a25e0283fb402bb894'
DATA='a00f52da7e423addf6b40508c972ad34df0eecec71250b1206ce9cb35c5ae436'
sha=lambda b:hashlib.sha256(b).hexdigest()
def full(h):
 assert isinstance(h,str) and re.fullmatch('[0-9a-f]{64}',h),'FULL_SHA256_REQUIRED'
 return h
def pin(p,h):
 p=pathlib.Path(p).resolve()
 for q in (p,*p.parents):assert not q.is_symlink(),'SYMLINK_REFUSED'
 b=p.read_bytes();assert sha(b)==full(h),'PIN_DRIFT '+str(p);return b
p=argparse.ArgumentParser();p.add_argument('--parent-preflight',required=True);p.add_argument('--sha256',required=True);p.add_argument('--output',required=True);a=p.parse_args()
prebytes=pin(a.parent_preflight,a.sha256);pre=json.loads(prebytes)
assert pre['contractVersion']=='inventory-compact-edit-parent-live-preflight-v1' and pre['parentExecuted'] is True
assert pre['currentRuntimeRoot']==CURRENT and pre['newRuntimeRoot']==NEW
assert pre['phase']=='verified' and pre['sharedReleaseActive'] is False and pre['manualConfigurationAbsent'] is True
assert pre['plannedOwnedIds']==[190,193,194,200] and len(pre['processes'])==12 and len(pre['untouchedIds'])==8
assert all(r['status']=='online' and r['pid']>0 and full(r['environmentHash']) for r in pre['processes'])
assert pre['businessWrites']==pre['processReloads']==0 and pre['databaseAccess'] is False and pre['environmentValuesExported'] is False
mbytes=pin(MIRROR/'manifest.json',MANIFEST);m=json.loads(mbytes)
assert m['runtimeRoot']==CURRENT and m['sourceUnionCount']==m['priorSourceUnionCount']==147
assert pre['sourceHashes']==m['sourceHashes'] and pre['priorSourceHashes']==m['priorSourceHashes'] and pre['protectedFiles']==m['protectedFiles']
controls=('release-driver.py','attached-admin-reloader.cjs','validate-snapshot-helper.cjs')
assert pre['metadataPins']=={'manifest.json':MANIFEST,'input-contract.json':m['inputContractSha256'],**m['controlsPackageHashes']}
for n in controls:pin(MIRROR/n,m['controlsPackageHashes'][n])
files=pre['files'];assert files['latest-github-source-bind-v4-brand.json']['sha256']==RECEIPT
assert files['activation-input.json']['path']=='/opt/ops/.incoming/channel-reference-remediation-cSy4W28-v4-brand-20261115T045901/activation-input.json'
assert files['latest-github-source-bind-v4-brand.json']['path']=='/opt/ops/.incoming/channel-reference-remediation-cSy4W28-v4-brand-20261115T045901/latest-github-source-bind-v4-brand.json'
# Actual local delivery contains the independently verified latest git source graph;
# remote receipt itself is read and checked by capture, never synthesized here.
rb=pathlib.Path('/home/ubuntu/work/channel-reference-remediation-20261115/delivery/GitHub与ECS本轮最新来源绑定.json').read_bytes();r=json.loads(rb)
assert r['contractVersion']=='channel-remediation-final-github-ecs-source-binding-v1' and r['status']=='PARENT_VERIFIED_LATEST_GIT_EQUALS_IMMUTABLE_ECS_SOURCES'
assert r['manifestSha256']==MANIFEST and r['runtimeRoot']==CURRENT and r['sourceHashes']==m['sourceHashes'] and r['controlHashes']==m['controlsPackageHashes']
assert r['snapshotSha256']==DATA==m['datasetAfterSha256'] and r['positiveSourceCount']==213 and r['sourceCount']==588
assert r['remoteReceipt']['privateReceiptSha256']==RECEIPT
assert sha(base64.b64decode(pre['coordBytesBase64'],validate=True))==full(pre['coordSha256'])
assert json.loads(base64.b64decode(pre['coordBytesBase64']))['shared_release_active'] is False
oldtrees=[]
for root in ['/opt/ops/20261115-channel-reference-remediation-cSy4W28','/opt/ops/20261115-channel-reference-remediation-cSy4W28-v2','/opt/ops/20261115-channel-reference-remediation-cSy4W28-v3']:
 rows=sorted([[x['path'][len(root)+1:],x['sha256']] for x in m['legacyFrozenFiles'] if x['path'].startswith(root+'/')])
 assert rows and len(rows)==len({x[0] for x in rows})
 oldtrees.append({'root':root,'fileCount':len(rows),'fileTreeSha256':sha(json.dumps(rows,separators=(',',':')).encode())})
c={'contractVersion':'inventory-compact-edit-current-v4-capture-v1','currentRuntimeRoot':CURRENT,'newRuntimeRoot':NEW,'currentSourceCommit':r['latestGitCommit'],'metadataPins':pre['metadataPins'],'sourceReceipt':{'file':files['latest-github-source-bind-v4-brand.json']['path'],'sha256':RECEIPT},'activationInput':{'file':files['activation-input.json']['path'],'sha256':full(files['activation-input.json']['sha256'])},'activationState':{'file':files['activation-state.json']['path'],'sha256':full(files['activation-state.json']['sha256'])},'coordination':{'file':pre['coordPath'],'sha256':full(pre['coordSha256'])},'rootConfigPins':{n:m['sourceHashes'][n] for n in ['package.json','pnpm-lock.yaml','tsconfig.json']},'currentRuntimePins':{'html':files['public-index.html']['sha256'],'admin':files['admin-index.js']['sha256'],'front':files['front-index.js']['sha256'],'snapshot':DATA},'failedRoots':oldtrees,'preflightProcesses':pre['processes'],'parentPreflightSha256':sha(prebytes),'ready':False,'scope':'READONLY_CAPTURE_ONLY; double original locks; current load_package/frozen; 147 current/147 prior; unchanged 213/588 snapshot; original rows never dropped; old v1/v2/v3/v4 ROOTs immutable; no activation/reloads/DB/HTTP/Git/SSH'}
out=pathlib.Path(a.output).resolve();assert out.is_relative_to(WORK) and not out.exists(),'NEW_LOCAL_OUTPUT_ONLY';out.parent.mkdir(parents=True,exist_ok=True)
b=(json.dumps(c,ensure_ascii=False,indent=2)+'\n').encode()
with out.open('xb') as f:f.write(b)
script=pathlib.Path(__file__).with_name('capture-current-readonly.py')
print(json.dumps({'status':'CONTRACT_CREATED_REMOTE_CAPTURE_NOT_EXECUTED','contractFile':str(out),'contractSha256':sha(b),'captureScriptFile':str(script),'captureScriptSha256':sha(script.read_bytes()),'parentPreflightSha256':sha(prebytes),'sourceUnionCount':147,'priorSourceUnionCount':147,'plannedOwnedIds':[190,193,194,200],'untouchedProcessCount':8,'ready':False},indent=2))
