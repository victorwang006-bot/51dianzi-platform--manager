#!/usr/bin/env python3
"""Offline inputs + exact reconstruction plan. No SSH, current capture, approval, or production writes."""
import ast,base64,hashlib,importlib.util,json,os,shutil,subprocess,sys,zlib
from pathlib import Path
os.umask(0o077)
sys.dont_write_bytecode=True
R=Path('/home/ubuntu/51-manager');W=Path('/home/ubuntu/work/customer-stock-live-20261121')
OLD=Path('/home/ubuntu/work/customer-batch/minimal-M1-parent-fixed-current-bound-20261120/package')
D=W/'controller-draft';U=W/'ui-build-v2';A=W/'api-build-v2';B=W/'offline-before';OUT=W/'package-inputs-v2'
assert not OUT.exists();OUT.mkdir(mode=0o700)
H=lambda b:hashlib.sha256(b).hexdigest()
source=D/'release-stock-compact.py';spec=importlib.util.spec_from_file_location('stock_offline_contracts',source);m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m)
proof=json.loads((D/'tool-proof.json').read_text());assert H(source.read_bytes())==proof['controllerSha256']
plan={};payload={}
def add(name,b,operation=None):
 assert name not in payload; m.rel(name);payload[name]=b
 p=OUT/'payload'/name;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700);p.write_bytes(b);p.chmod(0o600)
 pin={'sha256':H(b),'size':len(b),'mode':0o600}
 if operation is None:operation={'operation':'inline','base64':base64.b64encode(b).decode()}
 plan[name]={'pin':pin,**operation}
def live(name,local,remote):
 b=Path(local).read_bytes();add(name,b,{'operation':'reuse-exact','path':remote,'inputSha256':H(b)})
for kind in ('front','admin'):
 remote=str(m.Config().apis[kind]);before=(B/(kind+'-api.js')).read_bytes()
 live('before-'+kind+'-api.js',B/(kind+'-api.js'),remote)
 if kind=='admin':
  records=(W/'admin-zero-patch-records.json').read_bytes();after=before
  live('after-admin-api.js',B/'admin-api.js',remote)
 else:
  records=(A/'front-patch-records.json').read_bytes();after=(A/'after-front-api.js').read_bytes()
  add('after-front-api.js',after,{'operation':'native-byte-patches','input': 'before-front-api.js','records':'front-patch-records.json'})
 add(kind+'-patch-records.json',records)
 m.native_api(records,before,after,Path(remote),json.loads((OLD/'manifest.json').read_text())['sourceHashes']|{ 'client/src/business/platform/front-router-types/server/services/customerSupply.ts':H((R/'client/src/business/platform/front-router-types/server/services/customerSupply.ts').read_bytes())})
assets=json.loads((U/'assets.json').read_text());modules=json.loads((U/'modules.json').read_text());replacements=json.loads((U/'replacements.json').read_text())
css=next(a['relative'] for a in assets if a['relative'].endswith('.css'))
live('before-index.html',B/'admin-index.html',str(m.Config().html))
add('after-index.html',(U/'package/after-index.html').read_bytes(),{'operation':'html-exact-mappings','input':'before-index.html','replacements':replacements,'cssRelative':css})
for a in assets:
 name=a['relative'];b=(U/'package'/name).read_bytes();assert H(b)==a['sha256'] and len(b)==a['size']
 if name.endswith('.css'):add(name,b)
 else:
  v=next(q for q in modules if q['after']==name);old=v['before'];delta='evidence/'+Path(old).name+'.delta.json'
  live('evidence/baseline/'+old,B/old,str(m.Config().public/old))
  add(name,b,{'operation':'ui-utf16-patches','input':'evidence/baseline/'+old,'records':delta})
  m.ui_inverse(json.loads((U/'package'/delta).read_text()),(B/old).read_bytes(),b)
for p in sorted((U/'package/evidence').glob('*')):add('evidence/'+p.name,p.read_bytes())
oldm=json.loads((OLD/'manifest.json').read_text());source_names=set(oldm['sourceHashes'])
sf=json.loads((U/'package/evidence/source-files.json').read_text());source_names.update(sf['sourceHashes'])
source_names.update(['deploy/customer-batch-actions-20261119/build-stock-compact.mjs','deploy/customer-batch-actions-20261119/build-stock-upload.cjs','deploy/customer-batch-actions-20261119/prepare-stock-controller.py','deploy/customer-batch-actions-20261119/prepare-stock-package.py','server/customerSupplyEmptyChannel.test.ts','client/src/business/platform/client/src/components/customers/CustomerWorkbenchSupply.test.ts','client/src/business/platform/client/src/components/customers/CustomerChannelInventory.test.ts','client/src/business/platform/client/src/components/customers/CustomerChannelInventory.unified.render.test.ts'])
source_hashes={};source_matrix=[]
for name in sorted(source_names):
 b=(R/name).read_bytes();h=H(b);source_hashes[name]=h
 reused=name in oldm['sourceHashes'] and oldm['sourceHashes'][name]==h
 op=None
 if reused:op={'operation':'reuse-exact','path':'/opt/ops/customer-batch-actions-20261120-6Lfttf6o-M1/package-minimal-actual-scope-M1/evidence/source/'+name,'inputSha256':h}
 add('evidence/source/'+name,b,op)
 source_matrix.append({'source':name,'beforeSha256':oldm['sourceHashes'].get(name),'afterSha256':h,'exactReuse':reused})
for name,h in sf['sourceHashes'].items():assert source_hashes[name]==h
assert sf['builderSha256'] in source_hashes.values()
for name in ('backend-test.log','ui-test.log','ui-test-compact.log','typecheck.log','ui-business-prefix-proof.json','backend-source.patch'):
 add('evidence/stock/'+name,(W/name).read_bytes())
add('evidence/stock/backend-implementation-notes.md',(W/'短结论.md').read_bytes())
ui_paths=[n for n in source_names if '/customers/' in n and (n.endswith('.tsx') or n.endswith('.css')) and n in sf['sourceHashes']]
patch=subprocess.check_output(['git','diff','--',*sorted(ui_paths)],cwd=R);add('evidence/stock/ui-source-final.patch',patch)
for p in sorted((A/'compiled-source').glob('*')):add('evidence/stock/backend-compiled/'+p.name,p.read_bytes())
add('evidence/stock/backend-build-evidence.json',(A/'build-evidence.json').read_bytes())
for name in ('release-stock-compact.py','scope-policy.json','controller-delta.patch','tool-proof.json'):add('evidence/stock/tool/'+name,(D/name).read_bytes())
for name in ('evidence/reviewer/independent-report.txt','evidence/reviewer/r9-current-delta-binding.md','evidence/minimal-M1/coordinator-tool-scope-review.json','evidence/minimal-M1/previous-nine-tests.json','evidence/minimal-M1/scope-delta-tests.json'):
 b=(OLD/name).read_bytes();add(name,b,{'operation':'reuse-exact','path':'/opt/ops/customer-batch-actions-20261120-6Lfttf6o-M1/package-minimal-actual-scope-M1/'+name,'inputSha256':H(b)})
# Keep current observation as actual prior bounded read, never relabel it a new scoped capture.
add('evidence/stock/current-target-read-summary.json',(W/'current-target-read/summary.json').read_bytes())
add('evidence/stock/source-matrix.json',(json.dumps(source_matrix,indent=2)+'\n').encode())
metadata={'schema':'customer-stock-prepared-reconstruction-v1','status':'READY_INPUTS_NOT_CAPTURED_NOT_SEALED_NOT_APPROVED','scope':m.SCOPE,'controllerSha256':proof['controllerSha256'],'policySha256':proof['policySha256'],'assets':assets,'modules':modules,'replacements':replacements,'cssRelative':css,'sourceHashes':source_hashes,'payloadWithoutCapture':plan,'currentObservedCoordSha256':proof['currentObservedCoordSha256'],'controllerSourceBase64':base64.b64encode(source.read_bytes()).decode(),'policyBase64':base64.b64encode((D/'scope-policy.json').read_bytes()).decode(),'noProductionWrite':True,'captureMustBeActualNewBeforeSeal':True}
raw=(json.dumps(metadata,sort_keys=True,separators=(',',':'))+'\n').encode();compressed=zlib.compress(raw,9)
(OUT/'reconstruction-plan.json').write_bytes(raw);(OUT/'private-inputs.zlib').write_bytes(compressed)
summary={'status':metadata['status'],'payloadFilesWithoutCapture':len(payload),'sourceFiles':len(source_hashes),'unchangedPreviousSources':sum(v['exactReuse'] for v in source_matrix),'newOrChangedSources':sum(not v['exactReuse'] for v in source_matrix),'fullPayloadBytesWithoutCapture':sum(map(len,payload.values())),'transferCompressedBytes':len(compressed),'transferSha256':H(compressed),'rawPlanSha256':H(raw),'frontApiPhysicalWrites':1,'adminApiPhysicalWrites':0,'reloadScope':'four front plus two unchanged-code admin proxy slots, original identity model','apiAndUiInverseContractsExecuted':True,'newActualCaptureGenerated':False,'reviewGenerated':False,'publicWrites':0,'maintenanceStarted':False,'sourceMatrixSha256':H((OUT/'payload/evidence/stock/source-matrix.json').read_bytes())}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
