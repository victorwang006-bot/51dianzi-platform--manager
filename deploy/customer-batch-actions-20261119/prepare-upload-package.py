#!/usr/bin/env python3
"""Offline package plan; reuse live beforeimages and old hash-equal evidence, never stale captures."""
import base64,hashlib,importlib.util,json,os,subprocess,sys,zlib
from pathlib import Path
os.umask(0o077);sys.dont_write_bytecode=True
R=Path('/home/ubuntu/51-manager');W=Path('/home/ubuntu/work/customer-upload-fix-20261121-1024');PREV=Path('/home/ubuntu/work/customer-stock-live-20261121');OUT=W/'package-inputs';assert not OUT.exists();OUT.mkdir(mode=0o700)
OLDPKG='/opt/ops/customer-stock-compact-20261121-6Lfttf6o-exact-fixed/package-customer-stock-compact'
D=W/'controller';U=W/'ui-build';A=W/'api-build';B=W/'offline-before'
spec=importlib.util.spec_from_file_location('upload_offline_exact_contract',D/'release-upload.py');c=importlib.util.module_from_spec(spec);sys.modules[spec.name]=c;spec.loader.exec_module(c)
H=lambda b:hashlib.sha256(b).hexdigest();proof=json.loads((D/'tool-proof.json').read_text());assert H((D/'release-upload.py').read_bytes())==proof['controllerSha256']
oldm=json.loads((PREV/'exact-current-fixed-once/manifest.json').read_text());oldpayload=PREV/'package-inputs-v2/payload';plan={};payload={}
def add(name,b,op=None):
 assert name not in payload;c.rel(name);payload[name]=b
 p=OUT/'payload'/name;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700);p.write_bytes(b)
 if op is None:
  previous=oldm['packageFiles'].get(name)
  op={'operation':'reuse-exact','path':OLDPKG+'/'+name,'inputSha256':H(b)} if previous==c.file_pin(b) else {'operation':'inline','base64':base64.b64encode(b).decode()}
 plan[name]={'pin':c.file_pin(b),**op}
def live(name,p,remote):
 b=p.read_bytes();add(name,b,{'operation':'reuse-exact','path':remote,'inputSha256':H(b)})
for kind in ('front','admin'):
 remote=str(c.Config().apis[kind]);live('before-'+kind+'-api.js',B/(kind+'-api.js'),remote)
 if kind=='admin':live('after-admin-api.js',B/'admin-api.js',remote);records=(PREV/'admin-zero-patch-records.json').read_bytes()
 else:
  records=(A/'front-patch-records.json').read_bytes();add('after-front-api.js',(A/'after-front-api.js').read_bytes(),{'operation':'native-byte-patches','input':'before-front-api.js','records':'front-patch-records.json'})
 add(kind+'-patch-records.json',records)
assets=json.loads((U/'assets.json').read_text());modules=json.loads((U/'modules.json').read_text());replacements=json.loads((U/'replacements.json').read_text());css=next(a['relative'] for a in assets if a['relative'].endswith('.css'))
live('before-index.html',B/'admin-index.html',str(c.Config().html));add('after-index.html',(U/'package/after-index.html').read_bytes(),{'operation':'html-exact-mappings','input':'before-index.html','replacements':replacements,'cssRelative':css})
for a in assets:
 name=a['relative'];b=(U/'package'/name).read_bytes();assert H(b)==a['sha256']
 if name.endswith('.css'):add(name,b)
 else:
  module=next(m for m in modules if m['after']==name);old=module['before'];delta='evidence/'+Path(old).name+'.delta.json'
  live('evidence/baseline/'+old,B/old,str(c.Config().public/old));add(name,b,{'operation':'ui-utf16-patches','input':'evidence/baseline/'+old,'records':delta});c.ui_inverse(json.loads((U/'package'/delta).read_text()),(B/old).read_bytes(),b)
for p in sorted((U/'package/evidence').glob('*')):add('evidence/'+p.name,p.read_bytes())
sources=set(oldm['sourceHashes'])|set(json.loads((U/'package/evidence/source-files.json').read_text())['sourceHashes'])
sources.update(['client/src/business/platform/front-router-types/server/services/customerUploadPrivateStorage.ts','server/customerUploadPrivateStorage.test.ts','client/src/business/platform/client/src/components/channelInventory/BatchUpload.compact.test.ts'])
sources.update('deploy/customer-batch-actions-20261119/'+n for n in ['build-upload-file-fix.mjs','build-upload-zip-fix.cjs','test-upload-native-format.mjs','prepare-upload-controller.py','prepare-upload-package.py','prepare-bind-upload-once.py','apply-upload-once.py','verify-upload-live-format.cjs'])
sourcehashes={};matrix=[]
for name in sorted(sources):
 b=(R/name).read_bytes();sourcehashes[name]=H(b);add('evidence/source/'+name,b);matrix.append({'source':name,'oldSha256':oldm['sourceHashes'].get(name),'newSha256':H(b),'exactReuse':oldm['sourceHashes'].get(name)==H(b)})
for kind in ('front','admin'):c.native_api(payload[kind+'-patch-records.json'],payload['before-'+kind+'-api.js'],payload['after-'+kind+'-api.js'],c.Config().apis[kind],sourcehashes)
for name in ('affected-tests.log','typecheck.log','native-format-result.json'):add('evidence/upload-fix/'+name,(W/name).read_bytes())
for p in sorted((A/'compiled-source').glob('*')):add('evidence/upload-fix/compiled/'+p.name,p.read_bytes())
add('evidence/upload-fix/api-build-evidence.json',(A/'build-evidence.json').read_bytes())
add('evidence/upload-fix/frontend-closed-handoff-and-pins.json',Path('/home/ubuntu/upload/frontend-closed-handoff-and-pins.json').read_bytes())
changes=['client/src/business/platform/front-router-types/server/services/customerUploadPrivateStorage.ts','client/src/business/platform/client/src/components/channelInventory/BatchUpload.tsx','client/src/business/platform/client/src/components/channelInventory/batch.css','server/customerUploadPrivateStorage.test.ts','client/src/business/platform/client/src/components/channelInventory/BatchUpload.compact.test.ts']
add('evidence/upload-fix/source-delta.patch',subprocess.check_output(['git','diff','--',*changes],cwd=R))
for name in ('release-upload.py','scope-policy.json','tool-proof.json','controller-delta.patch','method-delta.patch'):add('evidence/upload-fix/tool/'+name,(D/name).read_bytes())
for name in ('evidence/reviewer/independent-report.txt','evidence/reviewer/r9-current-delta-binding.md'):
 b=(oldpayload/name).read_bytes();assert c.file_pin(b)==oldm['packageFiles'][name];add(name,b)
# Historical semantic evidence is explicitly historical; no claim its review signs the current manifest.
for name in ('backend-test.log','ui-test.log','ui-test-compact.log','backend-source.patch','ui-business-prefix-proof.json'):
 p=oldpayload/'evidence/stock'/name
 if p.exists():add('evidence/previous-stock/'+name,p.read_bytes(),{'operation':'reuse-exact','path':OLDPKG+'/evidence/stock/'+name,'inputSha256':H(p.read_bytes())})
add('evidence/upload-fix/source-matrix.json',(json.dumps(matrix,indent=2)+'\n').encode())
metadata={'schema':'customer-upload-prepared-reconstruction-v1','status':'OFFLINE_COMPLETE_NOT_CAPTURED_NOT_SEALED_NOT_APPROVED','scope':c.SCOPE,'controllerSha256':proof['controllerSha256'],'policySha256':proof['policySha256'],'assets':assets,'modules':modules,'replacements':replacements,'cssRelative':css,'sourceHashes':sourcehashes,'payloadWithoutCapture':plan,'controllerSourceBase64':base64.b64encode((D/'release-upload.py').read_bytes()).decode(),'policyBase64':base64.b64encode((D/'scope-policy.json').read_bytes()).decode(),'beforeTargetHashes':{str(c.Config().apis[k]):H(payload['before-'+k+'-api.js']) for k in ('front','admin')}|{str(c.Config().html):H(payload['before-index.html'])},'frontHandoffSha256':H(Path('/home/ubuntu/upload/frontend-closed-handoff-and-pins.json').read_bytes()),'captureMustBeActualNewBeforeSeal':True}
raw=c.encode(metadata);wire=zlib.compress(raw,9);(OUT/'reconstruction-plan.json').write_bytes(raw);(OUT/'private-inputs.zlib').write_bytes(wire)
summary={'status':metadata['status'],'scope':c.SCOPE,'payloadFilesWithoutCapture':len(payload),'sourceFiles':len(sourcehashes),'unchangedPreviousSources':sum(v['exactReuse'] for v in matrix),'changedOrNewSources':sum(not v['exactReuse'] for v in matrix),'fullPayloadBytesWithoutCapture':sum(map(len,payload.values())),'transferCompressedBytes':len(wire),'transferSha256':H(wire),'rawPlanSha256':H(raw),'apiAndUiInverseContractsExecuted':True,'frontApiPhysicalWrites':1,'adminApiPhysicalWrites':0,'sixActualReloads':True,'timerPause':False,'productionWrites':0}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary,indent=2))
