#!/usr/bin/env python3
"""Local assembly only; never reviews, deploys, logs in or calls a business API."""
from pathlib import Path
import base64, datetime, hashlib, json, shutil, tarfile

W = Path('/home/ubuntu/work/profile-clean-20261119')
CART = Path('/home/ubuntu/work/cart-compact-20261119')
C = W / 'packaging/ui/personal-clean-final'
R = W / 'release-profile-final'
P = R / 'package'
PUBLIC = '/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'
H = lambda b: hashlib.sha256(b).hexdigest()
def encode(x):
    return (json.dumps(x, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()
def save(p, b):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b)

assert not R.exists(), 'FRESH_LOCAL_ASSEMBLY_ONLY'
native_bytes = (C / 'manifest.json').read_bytes()
native = json.loads(native_bytes)
assert len(native['modules']) == 1
module = native['modules'][0]
js = Path(module['local']).read_bytes()
assert H(js) == module['afterSha256'] == '885e55c18130ad8d2c2121cb09538f6f7413d4ffde3c7f8ee94d14f96c4209de'
old_js = (W / 'live/Profile-current.js').read_bytes()
assert H(old_js) == module['beforeSha256'] == 'd8d971b457e29c675d024106e2f463d3f4eb6f9d59a4a23f8e6110513108aef2'
delta = native['exactFactoryDeclarationBytesDelta']
assert delta['patchCount'] == 1
p = delta['byteRange']
a, b = p['byteStart'], p['byteEnd']
old_factory, new_factory = base64.b64decode(p['oldBase64']), base64.b64decode(p['newBase64'])
assert old_js[a:b] == old_factory
assert old_js[:a] + new_factory + old_js[b:] == js
before = (W / 'live/admin.html').read_bytes()
assert H(before) == 'a39cd2130e45bcc7343cf697817d72b621372a025b45528d7eaee91d65c518bb'
old = ('/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/'
       'Profile-commission-simple-d8d971b457e29c675d024106e2f463d3f4eb6f9d59a4a23f8e6110513108aef2.js')
new = module['url']
assert before.count(old.encode()) == 5, 'ALL_CURRENT_ALIAS_VALUES_REQUIRED'
after = before.replace(old.encode(), new.encode())
assert old.encode() not in after and after.count(new.encode()) == 5
assert after.replace(new.encode(), old.encode()) == before
cap_bytes = (W / 'live/protection-refreshed.json').read_bytes()
cap = json.loads(cap_bytes)
assert not cap['coordinator']['shared_release_active'] and cap['newFlag']['enabled'] is True
assert len(cap['protectedFiles']) >= 287 and len(cap['beforeProcesses']) == 12
histories = [x for x in cap['coordinator']['window_history']
             if x.get('manifestSha256') == cap['newFlag']['manifestSha256']
             and x.get('nonce') == cap['newFlag']['nonce'] and x.get('status') == 'verified']
assert len(histories) == 1 and histories[0].get('closedAtUtc') and not histories[0].get('needsOperatorRecovery')
freeze_bytes = (W / 'validation/source-freeze-final.json').read_bytes()
freeze = json.loads(freeze_bytes)
for name, expected in {
    'ProfilePerformanceResults.tsx': '76f1c06fc28d96d3183a4d1cec0e2264ab77b87757c3c3ccfe027fcc9c8f6650',
    'ProfileBusinessPanel.tsx': '0370337e655976f858e91e96aba10971f3b4bdfd64f01006994cf3a45ec91d46',
    'ProfileCommissionResults.tsx': 'bc3a7a68df9842fd466bd4e6cd7e70ce26e79dc3533bb8ed4dfd052ab6c44c8b',
}.items():
    assert H((Path('/home/ubuntu/work/sales-20261117/manager/client/src/pages') / name).read_bytes()) == expected
browser_bytes = (W / 'validation/browser-native-result.json').read_bytes()
browser = json.loads(browser_bytes)
assert browser['failed'] == 0 and browser['passed'] == 40 and browser['productionNetworkIO'] == 0
source = {
    'nativeManifestSha256': H(native_bytes), 'sourceFreezeSha256': H(freeze_bytes),
    'sourceFreeze': freeze, 'nativeBeforeSha256': H(old_js), 'nativeAfterSha256': H(js),
    'factoryOnlyDelta': delta, 'outsideFactoryExactBytesPreserved': True,
    'nativeCandidateHtmlSha256': native['html']['sha256'],
    'finalHtmlProof': {'beforeSha256': H(before), 'afterSha256': H(after),
        'oldTarget': old, 'newTarget': new, 'valuesReplaced': 5,
        'actualProfileSpecifierValues': 4, 'additionalDemandAliasValues': 1,
        'allOtherHtmlBytesPreserved': True, 'cssWrites': 0},
    'note': 'Native candidate four active mappings plus the existing demand alias all bind the same unchanged candidate JS. No source or JS rebuild.',
    'sourceTests': {'files': 6, 'tests': 102, 'typeCheckExitCode': 0},
    'nativeVmChecks': 15, 'browserReportSha256': H(browser_bytes), 'browserChecks': 40,
    'browserProductionNetworkIO': 0, 'realProductionFinancialTests': False,
}
R.mkdir(mode=0o700)
P.mkdir(mode=0o700)
shutil.copy2(W / 'validation/release.py', R / 'release.py')
asset_relative = new.lstrip('/')
files = {
    'baseline-index.html': before,
    'candidate-index.html': after,
    'evidence/protection.json': cap_bytes,
    'evidence/protection-initial.json': (CART / 'live/protection-initial.json').read_bytes(),
    'evidence/source-delta.json': encode(source),
    asset_relative: js,
}
for name, data in files.items():
    save(P / name, data)
m = {
    'ownerTask': 'yOJKWq2DYYh42oMQkoK7ow', 'scope': 'profile-clean-20261119',
    'apiWrites': 0, 'databaseWrites': 0, 'processReloads': 0, 'frontHtmlWrites': 0,
    'flagWrites': 0, 'cssWrites': 0, 'adminHtmlWrites': 1,
    'controllerSha256': H((R / 'release.py').read_bytes()),
    'protectionSha256': H(cap_bytes), 'sourceDeltaSha256': H(files['evidence/source-delta.json']),
    'beforeHtmlSha256': H(before), 'afterHtmlSha256': H(after),
    'assets': [{'relative': asset_relative, 'sha256': H(js)}],
    'protectedFiles': [x for x in cap['protectedFiles'] if x['path'] != PUBLIC + '/index.html'],
    'beforeProcesses': cap['beforeProcesses'], 'coordinator': cap['coordinator'],
    'newFlag': cap['newFlag'], 'apiHistory': histories[0],
    'packageFiles': {name: H(data) for name, data in files.items()},
}
manifest = encode(m)
save(P / 'manifest.json', manifest)
with tarfile.open(R / 'profile-final.tar.gz', 'w:gz') as t:
    t.add(R / 'release.py', arcname='release.py')
    t.add(P, arcname='package')
print(json.dumps({'status': 'ASSEMBLED_NOT_APPROVED_NOT_DEPLOYED', 'manifestSha256': H(manifest),
    'controllerSha256': m['controllerSha256'], 'protectionSha256': H(cap_bytes),
    'sourceDeltaSha256': m['sourceDeltaSha256'], 'afterHtmlSha256': H(after),
    'profileSha256': H(js), 'htmlMappings': 5, 'cssWrites': 0,
    'protectedFiles': len(m['protectedFiles']), 'captureAtUtc': cap['capturedAtUtc']}, ensure_ascii=False))
