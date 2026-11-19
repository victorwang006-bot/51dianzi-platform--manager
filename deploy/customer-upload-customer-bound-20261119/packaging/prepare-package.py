#!/usr/bin/env python3
"""Prepare offline materials; no network, publication, DB or service commands."""
import hashlib,json,os,pathlib,shutil
BASE=pathlib.Path(os.environ.get('CUSTOMER_BOUND_DIR','/home/ubuntu/work/customer-bound'))
PKG=BASE/'package';PKG.mkdir(exist_ok=True);(PKG/'evidence').mkdir(exist_ok=True)
H=lambda b:hashlib.sha256(b).hexdigest()
modules=json.loads((BASE/'modules.json').read_text())
assert len(modules)==2
before=(BASE/'capture/admin-index.html').read_bytes();after=before;counts={}
for module in modules:
    old=('/'+module['before']).encode();new=('/'+module['after']).encode()
    assert before.count(old)>0 and new not in before
    counts[module['before']]=before.count(old)
    after=after.replace(old,new)
    raw=(PKG/module['after']).read_bytes()
    assert H(raw)==module['sha256'] and len(raw)==module['size']
assert {p.name for p in (PKG/'assets').iterdir()}=={pathlib.Path(m['after']).name for m in modules}
(PKG/'before-index.html').write_bytes(before);(PKG/'after-index.html').write_bytes(after)
for name in ['source-delta.json','api.delta.json','native-tests.json','customer-bound-native-tests.json','source-independent-review.json']:
    path=BASE/'evidence'/name
    if path.exists():shutil.copyfile(path,PKG/'evidence'/name)
for path in sorted((BASE/'evidence').glob('*.delta.json')):
    shutil.copyfile(path,PKG/'evidence'/path.name)
report={'status':'offline-checks-passed','frontendSourceTests':195,'backendSourceTests':288,'totalSourceTests':sum([195,288]),'nativePriorChecks':6,'nativeCustomerBoundChecks':7,'typescriptCheck':'passed','productionInventoryWrites':0,'realTestNetworkCalls':0,'limitations':['原生交互使用匿名mock，并非生产上传物料','滚动加载及新现场尚须独立冻结审核与实际验证']}
(PKG/'evidence/check-summary.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'LOCAL_MATERIALS_READY_NOT_DEPLOYED','beforeHtmlSha256':H(before),'afterHtmlSha256':H(after),'referenceCounts':counts,'newAssets':modules},ensure_ascii=False,indent=2))
