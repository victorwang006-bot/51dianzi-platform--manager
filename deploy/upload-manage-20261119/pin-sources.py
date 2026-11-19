#!/usr/bin/env python3
"""Only after source owners finish: explicitly pin TSX/CSS without compiling it."""
import argparse
import hashlib
import json
import os
from pathlib import Path
HERE = Path(__file__).absolute().parent
REPO = HERE.parent.parent
P = 'client/src/business/platform/client/src/components/'
TARGETS = {
    'BatchUploadSession': P+'channelInventory/BatchUpload.tsx',
    'CustomerSupplyUploadSession': P+'customers/CustomerSupplyUploadDialog.tsx',
    'CustomerChannelInventory': P+'customers/CustomerChannelInventory.tsx',
    'CustomerInventoryMore': P+'customers/CustomerChannelInventory.tsx',
}
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--confirm-frozen', action='store_true', required=True)
p.add_argument('--supply-native-safety-reviewed', action='store_true', required=True,
               help='Caller has reviewed preservation of already-live B3 original-file UUID/lock semantics')
p.add_argument('--more-changed', action='store_true', help='ONLY if CustomerInventoryMore genuinely changed')
p.add_argument('--helper', action='append', default=[], metavar='TARGET=PRIVATE_HELPER',
               help='Explicitly approved same-source private helper nested only inside that target wrapper')
p.add_argument('--retry-native-alias', action='append', default=[], help='Existing __customerUploadRetry20261119_* alias needed by final B3 source')
p.add_argument('--batch-css', help='Optional same-source CSS path whose new customer-supply-dialog rules are needed')
p.add_argument('--output', type=Path, default=HERE/'evidence/source-pins.json')
a = p.parse_args()
output = a.output.absolute()
for q in [output, *output.parents]: assert not q.is_symlink(), 'symlink refused'
output = Path(os.path.abspath(str(output)))
assert output.is_relative_to(HERE) and output != HERE and not output.exists(), 'fresh output in current directory required'
helpers = {}
for item in a.helper:
    target, name = item.split('=', 1)
    assert target in TARGETS and name.isidentifier() and name != 'initialSession'
    helpers.setdefault(TARGETS[target], {}).setdefault(target, []).append(name)
paths = list(dict.fromkeys(TARGETS.values()))+[P+'customers/CustomerChannelInventory.css']
paths += [P+'customers/customerUploadOriginalRetry.ts', P+'customers/CustomerParseUpload.tsx']
if a.batch_css:
    assert a.batch_css in [P+'channelInventory/batch.css', P+'customers/CustomerSupplyUploadDialog.css']
    paths.append(a.batch_css)
sources = []
for name in paths:
    data = (REPO/name).read_bytes()
    record = {'path': name, 'sha256': hashlib.sha256(data).hexdigest()}
    if name in helpers: record['localHelperAllowlist'] = helpers[name]
    sources.append(record)
result = {'schema': 'upload-manage-source-freeze-v1', 'ownerTask': '6hBIbUvPpWI2Wkj3jxYdIQ',
          'scope': 'upload-manage-20261119-6hBIbUvP', 'frozen': True, 'supplyNativeSafetyReviewed': True,
          'sources': sources, 'changedTargets': ['T6/BatchUploadSession','B3/CustomerSupplyUploadSession','mk/CustomerChannelInventory'],
          'supplyRetryNativeAliases': a.retry_native_alias}
if a.more_changed: result['changedTargets'].append('Z3/CustomerInventoryMore')
if a.batch_css: result['batchCss'] = a.batch_css
result['beforeHtmlSha256'] = hashlib.sha256((HERE/'evidence/baseline-after-index.html').read_bytes()).hexdigest()
output.parent.mkdir(parents=True, exist_ok=True)
with output.open('xb') as stream: stream.write((json.dumps(result, indent=2)+'\n').encode())
print(json.dumps({'status':'EXPLICIT_CALLER_CONFIRMED_SOURCE_PINS_NOT_BUILD_OR_TEST','path':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}))
