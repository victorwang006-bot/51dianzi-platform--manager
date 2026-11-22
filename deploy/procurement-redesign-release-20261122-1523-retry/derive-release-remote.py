#!/usr/bin/env python3
from pathlib import Path
import json,ast
W=Path(__file__).resolve().parent
BASE=Path('/home/ubuntu/work/customer-runtime-fix-20261122-1148/release-1214/release-remote.py')
s=BASE.read_text(); original=s
G=json.loads((W/'capture/runtime-guard.json').read_text());F=json.loads((W/'final/manifest.json').read_text());scope='demand-redesign-release-20261122-1523-retry'
def sub(old,new):
 global s
 assert s.count(old)==1,('unique upstream slot',old[:100]);s=s.replace(old,new)
sub('"""Bound customer unread static-only hotfix release. Run remotely only after a separate authorized handoff.\n\nInput: one pre-staged root:root 0600 regular file, never stdin. No SSH or DB client.\nFront HTML, both API entries and all runtime files are exact no-ops. No PM2 reload.\n"""','"""Authorized procurement + notification exact joint incremental release.\nPre-staged root 0600 payload; original dual-lock/CAS/inverse rollback retained.\nFront HTML and workers unchanged; only changed API groups reload. No business test writes.\n"""')
sub("SCOPE = 'customer-runtime-fix-release-20261122-1214'",'SCOPE = '+repr(scope))
start=s.index('ASSET_ALLOWLIST = ');end=s.index('\n',start);sub(s[start:end],'ASSET_ALLOWLIST = '+repr(set(a['url']for a in F['assets']))+'\nGUARD_CONFIG_KEYS = '+repr(G['configKeys'])+'\nGUARD_PROTECTED = '+repr(G['protectedFiles'])+'\nGUARD_PROCESSES = '+repr(G['processes']))
sub("INPUT_PATTERN = r'/opt/ops/\\.customer-runtime-fix-input-([a-f0-9]{32})\\.json'","INPUT_PATTERN = r'/opt/ops/\\.demand-redesign-input-([a-f0-9]{32})\\.json'")
sub("        need(path == ROOTS['admin'] + '/index.html' or target['beforeSHA'] == target['afterSHA'],\n             'STATIC_ONLY_FRONT_AND_APIS_MUST_BE_UNCHANGED')","        need(path != ROOTS['front'] + '/index.html' or target['beforeSHA'] == target['afterSHA'],\n             'FRONT_HTML_MUST_BE_UNCHANGED')")
sub('need(len(asset_keys) == 6 and','need(len(asset_keys) == len(ASSET_ALLOWLIST) and')
sub("            if path != ROOTS['admin'] + '/index.html':\n                need(p['targets'][path] is None and target['beforeSHA'] == target['afterSHA'] and target['size'] == len(data), 'STATIC_NOOP_FROM_LOCKED_BYTES')\n                candidate = data\n            else:\n                candidate = decode_pin(p['targets'][path], target['afterSHA'], target['size'], path)","            if target['beforeSHA'] == target['afterSHA']:\n                need(p['targets'][path] is None and target['size'] == len(data), 'NOOP_FROM_LOCKED_BYTES')\n                candidate = data\n            else:\n                candidate = decode_pin(p['targets'][path], target['afterSHA'], target['size'], path)")
sub("        # Existing authorization code unchanged; no business API call required.\n        need(not api_touched and not reload_ledger and not m['runtimes'], 'STATIC_NO_API_RELOAD_OR_RUNTIME_CHANGE')","        # Anonymous read-only authorization gate; no SQL business list or identity borrowing.\n        public_procurement_unauth()\n        expected_sides = {t['side'] for t in m['targets'] if t['kind'] == 'api' and t['beforeSHA'] != t['afterSHA']}\n        need(api_touched == expected_sides and not m['runtimes'], 'EXACT_CHANGED_API_GROUP_GUARD')")
sub("'verificationLimitations': 'Static HTML/assets and unchanged API files/processes only; no business API calls or authenticated unread/markDisplayed tests'","'verificationLimitations': 'Exact HTML/assets/API byte pins, affected API online reload, front anonymous auth and admin missing-merchant input gates plus all-process config/environment guards; no real-account procurement list, MySQL collation or unread/markDisplayed validation'")
sub("'immutableLedger': immutable_ledger, 'processLedger': process_ledger,","'immutableLedger': immutable_ledger, 'processLedger': process_ledger,\n                    'runtimeGuard': {'allProcesses': len(GUARD_PROCESSES), 'untouchedWorkersPreserved': True, 'configEnvironmentFingerprintsPreserved': True, 'protectedFiles': [x['path'] for x in GUARD_PROTECTED]},")
start=s.index('def processes():');end=s.index('\n\ndef check_processes',start);old=s[start:end]
new='''def processes():
    command = subprocess.run(['pm2', 'jlist'], capture_output=True, timeout=25, check=True)
    rows = []
    for x in json_load(command.stdout):
        e = x.get('pm2_env', {})
        cfg = {k: e[k] for k in GUARD_CONFIG_KEYS if k in e}
        env = {k: v for k, v in e.get('env', {}).items() if k != 'unique_id'}
        pin = lambda obj: H(json.dumps(obj, sort_keys=True, separators=(',', ':')).encode())
        rows.append({'name': x.get('name'), 'pid': x.get('pid'),
                     'id': x.get('pm_id', e.get('pm_id')), 'status': e.get('status'),
                     'entry': e.get('pm_exec_path'), 'configHash': pin(cfg), 'environmentHash': pin(env)})
    return rows


def runtime_protection(current):
    expected = {x['id']: x for x in GUARD_PROCESSES}
    need(len(current) == len(expected) and {x['id'] for x in current} == set(expected), 'ALL_PROCESS_IDENTITIES_DRIFT')
    changed_names = {GROUPS[t['side']] for t in m['targets'] if t['kind'] == 'api' and t['beforeSHA'] != t['afterSHA']}
    for row in current:
        prior = expected[row['id']]
        need(all(row[k] == prior[k] for k in ['name', 'entry', 'configHash', 'environmentHash']), 'RUNTIME_CONFIG_ENV_DRIFT ' + row['name'])
        need(row['status'] == 'online' and type(row['pid']) is int and row['pid'] > 0, 'ALL_PROCESS_NOT_ONLINE ' + row['name'])
        if row['name'] not in changed_names:
            need(row['pid'] == prior['pid'], 'NON_TARGET_PID_DRIFT ' + row['name'])
    for row in GUARD_PROTECTED:
        b, st = read(row['path'])
        need(H(b) == row['sha256'] and all(getattr(st, k) == v for k, v in row['stat'].items() if k != 'st_atime_ns'), 'PROTECTED_CONFIG_FILE_DRIFT ' + row['path'])


def public_procurement_unauth():
    route = 'customerDemand.procurementList'
    query = urllib.parse.quote('{"json":{"page":1,"pageSize":1,"sort":"latest","view":"all"}}')
    for side in ['front', 'admin']:
        prefix = '/api/trpc/' if side == 'front' else '/api/business-trpc/'
        body, row = public_get(ORIGINS[side], prefix + route + '?input=' + query, (401, 403) if side == 'front' else (400,))
        error = json_load(body).get('error', {})
        detail = error.get('json', error)
        info = detail.get('data', {})
        need(info.get('code') in (['UNAUTHORIZED', 'FORBIDDEN'] if side == 'front' else ['BAD_REQUEST']) and info.get('httpStatus') == row['status'] and info.get('path') == route, 'PROCUREMENT_ENTRY_GATE_NOT_OBSERVED ' + side)
        if side == 'admin':
            need(detail.get('message') == '请在请求头提供有效的业务商户标识', 'ADMIN_MISSING_MERCHANT_ENTRY_GUARD_REQUIRED')
        row['check'] = 'front anonymous auth gate only' if side == 'front' else 'admin missing business merchant header validation gate only; not authentication or business-list functional test'
        ledger.append(row)
'''
sub(old,new)
sub("    need(len(current) == 6, 'API_PROCESS_COUNT_DRIFT')","    runtime_protection(current)\n    need(len([x for x in current if x['name'] in GROUPS.values()]) == 6, 'API_PROCESS_COUNT_DRIFT')")
sub("    check_locks()\n    for dep in m['existingFiles']:","    check_locks()\n    runtime_protection(processes())\n    for dep in m['existingFiles']:")
# Frozen allowed guards prevent any payload relaxing worker/config protection.
sub("    return value, manifest, path_input_record(sys.argv[1], H(raw), actual)","    need(manifest['runtimeGuard'] == {'processes': GUARD_PROCESSES, 'protectedFiles': GUARD_PROTECTED}, 'EXACT_RUNTIME_GUARD_REQUIRED')\n    return value, manifest, path_input_record(sys.argv[1], H(raw), actual)")
s=s.replace('# Static-only release: no business-list request.','# Joint release: no authenticated business-list test request.')
s=s.replace('STATIC_ONLY_NO_RUNTIME_CHANGES','NO_BACKEND_RUNTIME_CHANGES').replace('NO_RUNTIME_BYTES_IN_STATIC_HOTFIX','NO_BACKEND_RUNTIME_BYTES')
ast.parse(s);(W/'release-remote.py').write_text(s)
(W/'publisher-derivation.json').write_text(json.dumps({'base':str(BASE),'baseSHA256':__import__('hashlib').sha256(original.encode()).hexdigest(),'scope':scope,'newLines':len(s.splitlines()),'changes':['scope and exact asset pins','front HTML fixed noop, changed API candidates','all process configuration/environment fingerprints and non-target PIDs','protected dump/nginx full bytes/stat','anonymous procurement auth-gate proof','unchanged dual locks/fullCAS/backup/rollback/durable close/client independent verification']},indent=2)+'\n')
print('REMOTE_PUBLISHER_DERIVED_NOT_EXECUTED',len(s.splitlines()))
