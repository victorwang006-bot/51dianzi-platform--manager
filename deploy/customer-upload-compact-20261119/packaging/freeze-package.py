#!/usr/bin/env python3
"""Freeze one local package after native tests. Does not connect or publish."""
import hashlib,json,pathlib,shutil
ROOT=pathlib.Path(__file__).resolve().parents[3]
BASE=pathlib.Path('/home/ubuntu/work/upload-compact')
PACK=BASE/'package'
H=lambda b:hashlib.sha256(b).hexdigest()
controller=ROOT/'deploy/customer-upload-compact-20261119/validation/release.py'
controller_hash=H(controller.read_bytes())
capture=json.loads((PACK/'capture.json').read_bytes())
assert capture['controllerSha256']==controller_hash,'capture must use final controller'
assert capture['productionWrites']==0 and len(capture['processes'])==12
native=json.loads((BASE/'evidence/native-tests.json').read_bytes())
assert native['status']=='passed' and native['realNetworkCalls']==0
assets=json.loads((BASE/'assets.json').read_text())
checks={c['sha256'] for c in native['checks']}
assert checks=={a['sha256'] for a in assets if a['relative'].endswith('.js')}
for a in assets:
    b=(PACK/a['relative']).read_bytes()
    assert H(b)==a['sha256'] and len(b)==a['size']
for name in ['manifest.json','review.json']:
    p=PACK/name
    if p.exists():p.unlink()
for p in (BASE/'evidence').glob('*.json'):shutil.copyfile(p,PACK/'evidence'/p.name)
for name in ['all-tests.log','native-tests.log','controller-tests.log']:shutil.copyfile(BASE/name,PACK/'evidence'/name)
replacements=json.loads((BASE/'replacements.json').read_text())
before=(PACK/'before-index.html').read_bytes()
counts={r['before']:before.count(r['before'].encode()) for r in replacements}
assert all(c>0 for c in counts.values())
(PACK/'evidence/reference-counts.json').write_text(json.dumps({'counts':counts,'onlyTwoResourceURLsChanged':True,'beforeHash':H(before)},indent=2)+'\n')
manifest={'ownerTask':'PnHdmd0yBiQfYpcPRYWNvD','scope':'customer-upload-compact-20261119-PnHdmd0yBi','captureSha256':H((PACK/'capture.json').read_bytes()),'controllerSha256':controller_hash,'beforeHtmlSha256':H(before),'afterHtmlSha256':H((PACK/'after-index.html').read_bytes()),'assets':assets,'replacements':replacements,'cssRelative':(BASE/'css-relative.txt').read_text().strip(),'packageFiles':{p.relative_to(PACK).as_posix():H(p.read_bytes()) for p in sorted(PACK.rglob('*')) if p.is_file()}}
b=(json.dumps(manifest,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode()
(PACK/'manifest.json').write_bytes(b)
(BASE/'manifest-sha256.txt').write_text(H(b)+'\n')
print(json.dumps({'status':'FROZEN_LOCAL_PACKAGE_NOT_DEPLOYED','manifestSha256':H(b),'controllerSha256':controller_hash,'captureSha256':manifest['captureSha256'],'capturedAtUtc':capture['capturedAtUtc'],'afterHtmlSha256':manifest['afterHtmlSha256'],'referenceCounts':counts,'protectedFiles':len(capture['protectedFiles']),'assets':assets},indent=2))
