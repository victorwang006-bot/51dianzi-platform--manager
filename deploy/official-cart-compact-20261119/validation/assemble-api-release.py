#!/usr/bin/env python3
from pathlib import Path
import base64,datetime,hashlib,importlib.util,json,secrets,shutil
W=Path('/home/ubuntu/work/cart-compact-20261119');A=W/'packaging/candidate-api';R=W/'release-api-final';P=R/'package';FR=Path('/home/ubuntu/work/sales-20261117/platform')
H=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(Path(p).read_text())
def save(p,x):p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
assert not R.exists();P.mkdir(parents=True)
initial=load(W/'live/protection-initial.json');effective=load(W/'live/effective-final.json');meta=load(W/'live/root-metadata-final.json');validation=load(A/'validation.json');api=load(A/'manifest.json')
assert validation['status']=='passed-offline-only' and len(validation['checks'])==15 and all(x['status']=='passed' for x in validation['checks']) and not validation['realDB'] and not validation['realProvider']
assert not effective['sharedReleaseActive'] and not effective['newFlagExists'] and effective['oldVerifiedClosedHistoryPresent']
assert H((W/'live/protection-initial.json').read_bytes())=='acc0efbba4abf98009d950f8ba56c9142c82c876afc60c33db2881aa7b7f7ecb'
assert all(H(Path(p).read_bytes())==h for p,h in api['sourceFiles'].items())
for name,src in {'front.before.js':W/'live/front-api.js','front.after.js':A/'front-api.js','refund.before.js':W/'live/refund-worker.js','refund.after.js':A/'refund-worker.js','protection-initial.json':W/'live/protection-initial.json','effective-before.json':W/'live/effective-final.json','schema-receipt.json':W/'live/schema-receipt.json','migration.sql':FR/'migrationdrizzle/official-cart-20261119.sql','schema-verifier.cjs':W/'validation/schema-cart-v2.cjs'}.items():shutil.copy2(src,P/name)
cart=next((A/'runtime').glob('officialCart.*.runtime.mjs'));stock=next((A/'runtime').glob('officialCartStock.*.runtime.mjs'));shutil.copy2(cart,P/'cart.runtime.mjs');shutil.copy2(stock,P/'stock.runtime.mjs')
deltas=[];targets=[]
for role,alias,targetkey in [('front','front-api','frontApi'),('refund','refund-worker','refundWorker')]:
 d=load(A/(alias+'-delta.json'));before=(P/(role+'.before.js')).read_bytes();after=(P/(role+'.after.js')).read_bytes();assert H(before)==d['beforeSha256'] and H(after)==d['afterSha256'] and d['inverseVerified']
 edits=[]
 for e in d['patches']:
  b=base64.b64decode(e['oldBase64']);v=base64.b64decode(e['newBase64']);assert before[e['oldStart']:e['oldEnd']]==b;edits.append({'offset':e['oldStart'],'beforeHex':b.hex(),'afterHex':v.hex()})
 built=before
 for e in reversed(edits):i=e['offset'];b=bytes.fromhex(e['beforeHex']);v=bytes.fromhex(e['afterHex']);built=built[:i]+v+built[i+len(b):]
 assert built==after
 deltas.append({'role':role,'beforeSha256':H(before),'afterSha256':H(after),'edits':edits})
 actual=next(x for x in meta if x['path']==initial['targets'][targetkey]['path']);assert actual['sha256']==H(before)
 targets.append({'role':role,'path':actual['path'],'beforeSha256':H(before),'afterSha256':H(after),'mode':actual['mode'],'uid':actual['uid'],'gid':actual['gid']})
save(P/'source-delta.json',{'schemaVersion':1,'targets':deltas})
# These are reviewed build evidence, not a claim of live financial testing.
assert 'officialCheckout.2fd80afeff6aec5d6705eaad2160e99990065105677a3f111e3a72358eebcf0b.runtime.mjs' in (P/'front.after.js').read_text()
assert 'officialCheckoutStock.21671021e1ce8f5709179181df077fe5daad0e708c73fd8cafbcc32160d2055a.runtime.mjs' in (P/'refund.after.js').read_text()
assert '/opt/ops/official-cart-active-20261119.json' in cart.read_text() and 'import.meta.url' in cart.read_text()
save(P/'source-binding.json',{'schemaVersion':1,'status':'PASS','originalImportsPreserved':True,'old2fdPreserved':True,'newFourMethodGuard':True,'officialCartNamespace':True,'sameSourceStock':True,'ordinaryFunctionsPreserved':True,'guardImportMetaUrlHash':True,'closedRuntimeGraph':True})
keys=['id','name','pid','status','script','cwd','envHash'];processes=[{k:x[k]for k in keys}for x in effective['processes']]
capture={'schemaVersion':1,'ownerTask':'yOJKWq2DYYh42oMQkoK7ow','nonce':secrets.token_hex(16),'capturedAtUtc':effective['capturedAtUtc'],'coordinatorSha256':effective['coordinatorSha256'],'newFlagBeforeSha256':effective['newFlagSha256'],'protectedFiles':initial['protectedFiles'],'beforeProcesses':processes,'targets':initial['targets'],'rawEnvironment':{'provided':True,'byId':{str(x['id']):x['rawEnvironSha256']for x in effective['processes']}}};save(P/'capture.json',capture)
runtimes=[{'role':'front','path':str(Path(targets[0]['path']).parent.parent/'runtime'/cart.name),'sha256':H(cart.read_bytes()),'mode':0o644},{'role':'refund','path':str(Path(targets[1]['path']).parent.parent/'runtime'/stock.name),'sha256':H(stock.read_bytes()),'mode':0o644}]
shutil.copy2(W/'validation/controller.py',R/'controller.py')
manifest={'schemaVersion':1,'ownerTask':capture['ownerTask'],'scope':'official-cart-api-20261119','controllerSha256':H((R/'controller.py').read_bytes()),'packageFiles':{x.name:H(x.read_bytes())for x in P.iterdir()},'targets':targets,'runtimes':runtimes,'reloadIds':[190,193,194,200,203]};save(R/'manifest.json',manifest)
print(json.dumps({'status':'assembled-not-approved','root':str(R),'manifestSha256':H((R/'manifest.json').read_bytes()),'controllerSha256':manifest['controllerSha256'],'captureSha256':manifest['packageFiles']['capture.json'],'schemaReceiptSha256':manifest['packageFiles']['schema-receipt.json'],'sourceDeltaSha256':manifest['packageFiles']['source-delta.json'],'sourceBindingSha256':manifest['packageFiles']['source-binding.json']}))
