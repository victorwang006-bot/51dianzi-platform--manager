#!/usr/bin/env python3
"""Derive the mature publisher without changing its lock/recovery primitives."""
import ast,json,re
from pathlib import Path
W=Path(__file__).resolve().parent
J=lambda p:json.loads(Path(p).read_text())
final=J(W/'final/manifest.json');guard=J(W/'capture/runtime-guard.json');records=J(W/'capture/records.json')
assert final['scope']==W.name and final['assets']==[]
assert {r['side'] for r in final['runtimes']}=={'front','admin'} and len(final['runtimes'])==2
old=Path('/home/ubuntu/work/demand-redesign-release-20261122-1523-retry/release-remote.py').read_text()
def sub(before,after):
 global old
 assert old.count(before)==1,'ONE_DRIVER_PREIMAGE '+before[:90]
 old=old.replace(before,after)
def line(name,value):
 global old
 old,n=re.subn(r'^'+name+r' = .+$',lambda _match:name+' = '+repr(value),old,flags=re.M);assert n==1,name
line('SCOPE',W.name);line('ASSET_ALLOWLIST',set());line('GUARD_CONFIG_KEYS',guard['configKeys']);line('GUARD_PROTECTED',guard['protectedFiles']);line('GUARD_PROCESSES',guard['processes'])
line('INPUT_PATTERN',r'/opt/ops/\.customer-unread-notification-input-([a-f0-9]{32})\.json')
runtimes=[{k:r[k] for k in ('side','path','sha256','size')} for r in final['runtimes']]
sub("RUNTIME_PATTERN = (re.escape(RELEASE + '/admin/runtime/') +\n                   r'newInformation\\.admin\\.([a-f0-9]{64})\\.runtime\\.mjs')",'RUNTIME_ALLOWLIST = '+repr(runtimes)+'\nSOURCE_COMMITS = '+repr(final['sourceCommits'])+'\nTARGET_PINS = '+repr({records[a['side']+'-api']['path']:{'beforeSHA':a['beforeSHA'],'afterSHA':a['afterSHA'],'size':a['size']} for a in final['apis']}))
sub("need(path != ROOTS['front'] + '/index.html' or target['beforeSHA'] == target['afterSHA'],\n             'FRONT_HTML_MUST_BE_UNCHANGED')","need(target['kind'] != 'html' or target['beforeSHA'] == target['afterSHA'],\n             'BOTH_HTML_MUST_BE_UNCHANGED')\n        if target['kind'] == 'api':\n            need({k: target[k] for k in ('beforeSHA', 'afterSHA', 'size')} == TARGET_PINS[path], 'EXACT_API_CANDIDATE_PINS')")
sub("need(runtimes == [] and value['runtimes'] == {}, 'NO_BACKEND_RUNTIME_CHANGES')", "need(runtimes == RUNTIME_ALLOWLIST and manifest['sourceCommits'] == SOURCE_COMMITS, 'EXACT_TWO_RUNTIME_AND_SOURCE_PINS')")
sub("runtime_match = re.fullmatch(RUNTIME_PATTERN, runtime['path'])\n        need(runtime_match is not None and runtime_match.group(1) == runtime['sha256'],\n             'RUNTIME_CONTENT_ADDRESS_ALLOWLIST')", "side = runtime['side']\n        stem = r'customerPicker\\.' if side == 'front' else r'newInformation\\.admin\\.'\n        pattern = re.escape(RELEASE + '/' + side + '/runtime/') + stem + r'([a-f0-9]{64})\\.runtime\\.mjs'\n        runtime_match = re.fullmatch(pattern, runtime['path'])\n        need(runtime_match is not None and runtime_match.group(1) == runtime['sha256'],\n             'RUNTIME_CONTENT_ADDRESS_ALLOWLIST')")
sub("need(value['runtimes'] == {}, 'NO_BACKEND_RUNTIME_BYTES')", "need(isinstance(value['runtimes'], dict) and set(value['runtimes']) == {r['path'] for r in RUNTIME_ALLOWLIST}, 'EXACT_TWO_RUNTIME_BYTES')")
sub("admin_entry = after[RELEASE + '/admin/dist/index.js']\n            need(('../runtime/' + os.path.basename(path)).encode() in admin_entry,\n                 'ADMIN_ENTRY_NEW_RUNTIME_REFERENCE_REQUIRED')", "side_entry = after[RELEASE + '/' + runtime['side'] + '/dist/index.js']\n            need(side_entry.count(('../runtime/' + os.path.basename(path)).encode()) == 1,\n                 'EXACT_CORRESPONDING_API_RUNTIME_REFERENCE_REQUIRED')")
sub("need(api_touched == expected_sides and not m['runtimes'], 'EXACT_CHANGED_API_GROUP_GUARD')", "need(api_touched == expected_sides == {r['side'] for r in RUNTIME_ALLOWLIST} == {'front', 'admin'}, 'EXACT_CHANGED_API_GROUP_GUARD')")
old=old.replace('public_procurement_unauth','public_customer_unauth')
sub("route = 'customerDemand.procurementList'", "route = 'customer.list'")
sub("query = urllib.parse.quote('{\"json\":{\"page\":1,\"pageSize\":1,\"sort\":\"latest\",\"view\":\"all\"}}')", "query = urllib.parse.quote('{\"json\":{\"page\":1,\"pageSize\":1,\"customerIds\":[1]}}')")
sub("public_customer_unauth()\n        expected_sides", "public_customer_unauth()\n        public_unread_unauth()\n        expected_sides")
old=old.replace('PROCUREMENT_ENTRY_GATE_NOT_OBSERVED','CUSTOMER_ENTRY_GATE_NOT_OBSERVED').replace('admin-runtime-candidate','notification-or-picker-runtime-candidate').replace('installed-admin-runtime','installed-notification-or-picker-runtime')
old=old.replace('Exact HTML/assets/API byte pins, affected API online reload, front anonymous auth and admin missing-merchant input gates plus all-process config/environment guards; no real-account procurement list, MySQL collation or unread/markDisplayed validation','Exact unchanged HTML and API/runtime byte pins, affected API online reload, anonymous customer and notification authorization gates plus all-process config/environment guards; no real-account customer filter, MySQL query, sales 503 reproduction or markDisplayed validation')
ast.parse(old);(W/'release-remote.py').write_text(old)
print(json.dumps({'status':'EXACT_DERIVED_DRIVER_PREPARED','runtimePaths':[r['path'] for r in runtimes],'sourceCommits':final['sourceCommits'],'assets':0,'htmlChanges':0}))
