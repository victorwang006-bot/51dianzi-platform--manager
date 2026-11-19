#!/usr/bin/env python3
"""Check copied actual receipts only; no connection, publication or DB calls."""
import base64,hashlib,json,pathlib
BASE=pathlib.Path('/home/ubuntu/work/upload-compact')
H=lambda b:hashlib.sha256(b).hexdigest()
receipt=json.loads((BASE/'receipt.remote-original.json').read_text())
coord_bytes=(BASE/'coordinator.remote-original.json').read_bytes();coord=json.loads(coord_bytes)
manifest_bytes=(BASE/'package/manifest.json').read_bytes();manifest=json.loads(manifest_bytes)
capture=json.loads((BASE/'package/capture.json').read_bytes());prior=json.loads(base64.b64decode(capture['coordBase64']))
assert receipt['status']=='verified' and receipt['ownerTask']==manifest['ownerTask']
assert receipt['manifestSha256']==H(manifest_bytes)
assert receipt['afterHtmlSha256']==manifest['afterHtmlSha256']
assert receipt['coordSha256']==H(coord_bytes)
assert coord['shared_release_active'] is False
assert coord['window']['status']=='closed' and coord['window']['outcome']=='verified'
assert coord['window']['owner_task']==manifest['ownerTask']
assert coord['window']['needsOperatorRecovery'] is False
assert coord['window']['nonce']==receipt['nonce']
for key in set(prior)|set(coord):
    if key not in {'window','window_history','shared_release_active','updated_at'}:
        assert prior.get(key)==coord.get(key),('foreign coordination field changed',key)
assert coord['window_history'][:len(prior['window_history'])]==prior['window_history']
assert len([w for w in coord['window_history'] if w.get('owner_task')==manifest['ownerTask'] and w.get('nonce')==receipt['nonce']])==1
assets=[{'url':'https://admin.51dianzi.com/'+a['relative'],'relative':'/'+a['relative'],'sha256':a['sha256'],'size':a['size']} for a in manifest['assets']]
assert set(receipt['addedAssets'])=={a['relative'] for a in manifest['assets']}
assert receipt['allOriginalFilesExceptAdminHtmlUnchanged'] and receipt['processesAndEnvironUnchanged']
assert all(receipt[k]==0 for k in ['apiWrites','databaseWrites','envWrites','processReloads','frontHtmlWrites'])
handoff={'status':'actual-verified-closed','ownerTask':manifest['ownerTask'],'scope':manifest['scope'],'nonce':receipt['nonce'],'manifestSha256':H(manifest_bytes),'reviewSha256':receipt['reviewSha256'],'controllerSha256':receipt['controllerSha256'],'receiptSha256':H((BASE/'receipt.remote-original.json').read_bytes()),'coordinatorSha256':H(coord_bytes),'adminHtmlSha256':manifest['afterHtmlSha256'],'task2FrontHtmlSha256Unchanged':'cc2c2ded94893eb1b0efec434c6a278c5a36fb8e4d63a4e9003297a5c65ec186','assets':assets,'retainedUnreferencedPublicAssetsCreatedByThisTask':[],'oldPublicAssetsNeverDeleted':True,'noFailedApplyOrReplay':True,'protectedFiles':receipt['protectedFiles'],'processCount':receipt['processCount'],'processesAndEnvironmentUnchanged':True,'productionInventoryWriteTests':0,'closedAtUtc':receipt['closedAtUtc']}
(BASE/'final-live-handoff.json').write_text(json.dumps(handoff,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(handoff,ensure_ascii=False,indent=2))
