#!/usr/bin/env python3
"""Fixed official-cart API release adapter. Importing this module performs NO I/O.

ONLY controller.py + test_controller.py are this unit's deliverables. No SQL,
SSH, browser, Git, plugins, candidate scripts, arbitrary commands or static writes.
This file is SOURCE, not a deployment/review/readiness receipt.

Root prepares EXACT stage graph (regular files, root-owned, no writable group/other):
  controller.py, manifest.json, review.json, package/{PACKAGE_NAMES below},
  optionally audit/ created by apply, plus separately root-operated fixed schema/.
  schema/ is never traversed/executed/written here. No other entries are accepted.
Manifest exact schema is MANIFEST_FIELDS; construct it from this annotated example:
  {schemaVersion:1, ownerTask:OWNER, scope:SCOPE, controllerSha256:H(controller.py),
   packageFiles:{each PACKAGE_NAMES:H(bytes)}, targets:[
    {role:'front',path:FRONT,beforeSha256:H(front.before.js),
     afterSha256:H(front.after.js),mode:420,uid:0,gid:0},
    {role:'refund',path:REFUND,beforeSha256:H(refund.before.js),
     afterSha256:H(refund.after.js),mode:420,uid:0,gid:0}],
   runtimes:[{role:'front',path:FRONT_RUNTIME+'/officialCart.'+H(cart.runtime.mjs)+
    '.runtime.mjs',sha256:H(cart.runtime.mjs),mode:420},
    {role:'refund',path:REFUND_RUNTIME+'/officialCartStock.'+H(stock.runtime.mjs)+
    '.runtime.mjs',sha256:H(stock.runtime.mjs),mode:420}],
   reloadIds:[190,193,194,200,203]}
Review EXACT fields: status:'PASS', independent:true, reviewedBy:'root',
manifestSha256, controllerSha256, captureSha256, schemaReceiptSha256,
sourceDeltaSha256, sourceBindingSha256; every H independently supplied by root.
Review H is a separate required CLI trust pin, NEVER candidate self-approval.

package/protection-initial.json MUST be byte-for-byte actual W/live baseline
(INITIAL_SHA), all 277 protectedFiles are retained, and no target is excluded.
package/capture.json EXACT fields: schemaVersion:1,ownerTask,nonce(32 hex),
capturedAtUtc,coordinatorSha256,newFlagBeforeSha256(null or own disabled hash),
protectedFiles,beforeProcesses,targets(same metadata schema as initial),
rawEnvironment:{provided:false,byId:{}} OR {provided:true,byId:{all 12 id strings:H}}
Fresh capture may update process PID/envHash and coordinator/new-flag pins, but
cannot change initial protected byte hashes, process IDs/name/script/cwd, roots.
Capture and schema receipt are at most 15 minutes old on preflight/apply.

package/effective-before.json is the ACTUAL root-saved effective-before.json:
capturedAtUtc,processes,coordinatorSha256,sharedReleaseActive,oldFlagSha256,
oldFlag,oldVerifiedHistory,oldVerifiedClosedHistoryPresent,newFlagExists,
newFlagSha256,availableBytes. Its process schema is the seven normalized keys plus
mode/rawEnvironSha256/embeddedUserConfigSha256/configuredUserConfigSha256/
rawEnvironmentEntryCount/userEnvironmentKeyCount. Non-reloaded raw bytes must
remain identical; cluster embedded user hash equals its configured baseline;
fork processes retain normalized/configured proof, not fictitious embedded proof.
If unavailable, explicit {provided:false} is accepted and output discloses the
weaker normalized-only boundary. Never substitute envHash for rawEnvironSha256.

source-delta.json EXACT: schemaVersion:1,targets:[{role,beforeSha256,afterSha256,
edits:[{offset:int,beforeHex:str,afterHex:str},...]}]. Offsets are byte offsets in
original bytes, ascending, nonoverlapping; both forward and inverse are checked.
source-binding.json EXACT: schemaVersion:1,status:'PASS',originalImportsPreserved:
true,old2fdPreserved:true,newFourMethodGuard:true,officialCartNamespace:true,
sameSourceStock:true,ordinaryFunctionsPreserved:true,guardImportMetaUrlHash:true,
closedRuntimeGraph:true. These are ROOT-REVIEWED build evidence, not controller AST
analysis or a claim of online financial testing. Root must inspect actual bytes.

schema-receipt.json EXACT actual schema-cart.cjs output: status:'verified',
action:'apply'|'verify',sqlSha256,migrationSha256,targetTables:TABLES,checkedAtUtc,
oldSchemasUnchanged:true,oldSingleUniquesUnchanged:true,
oldBusinessRecordsUnchanged:true,tables:[four actual metadata objects],
businessWrites:0. Both SQL hashes equal the packaged FINAL migration.sql bytes.
Copy separately reviewed fixed helper source to package/schema-verifier.cjs;
its H is bound by packageFiles and independent review's manifest pin. NEVER run
it here. Root separately performs fixed readonly SHOW verification and supplies
the actual receipt; no fabricated owner/nonce/signature/currentSchemaHash fields
are required. Partial/unverified migration MUST refuse apply. No database
unchanged or logged-in functional success is independently claimed by controller.

Root calls AFTER independent binding, never by this source-writing task:
 python3 /opt/backups/official-cart-20261119-yOJKWq2D/controller.py \
  --root /opt/backups/official-cart-20261119-yOJKWq2D --action preflight \
  --manifest-sha256 <H> --review-sha256 <independent H>
Same arguments --action apply or verify. CLI refuses non-root, wrong __file__,
wrong canonical stage. preflight/verify perform no active writes, not even locks
or coord tempfiles. verify only attests file/closed history/config + readonly GET,
NOT logged-in cart persistence, mutations, payment, refund or financial E2E.
"""
import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time
import uuid
from urllib.parse import quote

OWNER = 'yOJKWq2DYYh42oMQkoK7ow'
SCOPE = 'official-cart-api-20261119'
STAGE = '/opt/backups/official-cart-20261119-yOJKWq2D-r2'
ARCHIVE = '/data/archive/backups/official-cart-20261119-yOJKWq2D-r2'
FRONT = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
REFUND = '/opt/releases/20261018-multi-enterprise-v1/web/dist/refundWorker.js'
FRONT_RUNTIME = str(Path(FRONT).parent.parent / 'runtime')
REFUND_RUNTIME = str(Path(REFUND).parent.parent / 'runtime')
COORD = '/opt/ops/51-project-release-coordination-20261027.json'
FLAG = '/opt/ops/official-cart-active-20261119.json'
OLD_FLAG = '/opt/ops/official-checkout-active-20261118.json'
LOCKS = ('/var/lock/dianzi51-public-deploy.lock', '/var/lock/dianzi51-production-code.lock')
IDS = (190, 193, 194, 200, 203)
INITIAL_SHA = 'acc0efbba4abf98009d950f8ba56c9142c82c876afc60c33db2881aa7b7f7ecb'
VOLATILE = {'unique_id', 'NODE_UNIQUE_ID', 'NODE_CHANNEL_FD', 'NODE_CHANNEL_SERIALIZATION_MODE'}
PROCESS_FIELDS = {'id', 'name', 'pid', 'status', 'script', 'cwd', 'envHash'}
TABLES = ['official_cart_items', 'official_cart_checkout_sessions', 'official_basket_requests', 'official_basket_receipts']
PACKAGE_NAMES = frozenset(('front.before.js', 'front.after.js', 'refund.before.js', 'refund.after.js',
    'cart.runtime.mjs', 'stock.runtime.mjs', 'source-delta.json', 'source-binding.json',
    'protection-initial.json', 'effective-before.json', 'capture.json', 'schema-receipt.json', 'migration.sql', 'schema-verifier.cjs'))
MANIFEST_FIELDS = {'schemaVersion', 'ownerTask', 'scope', 'controllerSha256', 'packageFiles', 'targets', 'runtimes', 'reloadIds'}
BINDING_FIELDS = {'originalImportsPreserved', 'old2fdPreserved', 'newFourMethodGuard', 'officialCartNamespace',
    'sameSourceStock', 'ordinaryFunctionsPreserved', 'guardImportMetaUrlHash', 'closedRuntimeGraph'}
SAFE_ENV = {'PATH': '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'HOME': '/root', 'PM2_HOME': '/root/.pm2', 'LANG': 'C.UTF-8'}


class Refusal(RuntimeError):
    """Only fixed, non-secret error classes escape the CLI."""


def need(ok, code):
    if not ok:
        raise Refusal(code)


def H(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode()


def decode(raw):
    def pairs(rows):
        result = {}
        for k, v in rows:
            need(k not in result, 'DUPLICATE_JSON_KEY')
            result[k] = v
        return result
    return json.loads(raw, object_pairs_hook=pairs)


def digest(value):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value) is not None


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def fresh(value):
    try:
        moment = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        age = (dt.datetime.now(dt.timezone.utc) - moment).total_seconds()
        need(0 <= age <= 900, 'STALE_ROOT_EVIDENCE')
    except (ValueError, TypeError, AttributeError):
        raise Refusal('INVALID_EVIDENCE_TIMESTAMP') from None


def config_hash(e):
    # Exact release_common.py: ALL nested lower-case business env + top UPPER;
    # ensure_ascii=True default; ONLY these four transient exclusions.
    need(isinstance(e, dict) and isinstance(e.get('env', {}), dict), 'PROCESS_ENV_SHAPE')
    value = {'env': {k: v for k, v in e.get('env', {}).items() if k not in VOLATILE},
             'topEnv': {k: v for k, v in e.items() if k.isupper() and k not in VOLATILE}}
    return H(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def normalize_processes(rows):
    result = []
    for p in rows:
        e = p['pm2_env']
        result.append(dict(id=p['pm_id'], name=p['name'], pid=p['pid'], status=e['status'],
                           script=e['pm_exec_path'], cwd=e['pm_cwd'], envHash=config_hash(e)))
    return sorted(result, key=lambda p: p['id'])


def process_partition(rows):
    need(len(rows) == 12 and len({r['id'] for r in rows}) == 12 and
         all(set(r) == PROCESS_FIELDS and type(r['id']) is int and type(r['pid']) is int and
             r['pid'] > 0 and r['status'] == 'online' and digest(r['envHash']) for r in rows), 'TWELVE_EXACT_PROCESSES')
    front = tuple(sorted(r['id'] for r in rows if r['name'] == 'dianzi51' and r['script'] == FRONT))
    refund = tuple(r['id'] for r in rows if r['name'] == 'dianzi51-refund' and r['script'] == REFUND)
    need(front == IDS[:4] and refund == IDS[4:] and
         sum(r['name'] == 'dianzi51' for r in rows) == 4 and
         sum(r['name'] == 'dianzi51-refund' for r in rows) == 1, 'EXACT_FRONT4_REFUND1_SCRIPTS')
    return front + refund


def compare_processes(before, after, reloaded=()):
    process_partition(before)
    process_partition(after)
    need(set(reloaded) <= set(IDS), 'RELOAD_IDS_SCOPE')
    a, b = {r['id']: r for r in before}, {r['id']: r for r in after}
    need(set(a) == set(b), 'PROCESS_IDS_DRIFT')
    for i in a:
        ignored = {'pid'} if i in reloaded else set()
        need({k: v for k, v in a[i].items() if k not in ignored} ==
             {k: v for k, v in b[i].items() if k not in ignored}, 'PROCESS_CONFIG_OR_FOREIGN_PID_DRIFT')


def compare_effective(before, after, reloaded=()):
    fields = PROCESS_FIELDS | {'mode', 'rawEnvironSha256', 'embeddedUserConfigSha256',
        'configuredUserConfigSha256', 'rawEnvironmentEntryCount', 'userEnvironmentKeyCount'}
    need(len(before) == len(after) == 12 and all(set(r) == fields for r in before + after), 'EFFECTIVE_CAPTURE_SCHEMA')
    compare_processes([{k: r[k] for k in PROCESS_FIELDS} for r in before],
                      [{k: r[k] for k in PROCESS_FIELDS} for r in after], reloaded)
    a, b = {r['id']: r for r in before}, {r['id']: r for r in after}
    for i, x in a.items():
        y = b[i]
        need(x['mode'] == y['mode'] and digest(x['rawEnvironSha256']) and digest(y['rawEnvironSha256']) and
             digest(x['configuredUserConfigSha256']) and x['configuredUserConfigSha256'] == y['configuredUserConfigSha256'] and
             x['userEnvironmentKeyCount'] == y['userEnvironmentKeyCount'], 'EFFECTIVE_USER_CONFIG_DRIFT')
        if x['embeddedUserConfigSha256'] is not None:
            need(x['embeddedUserConfigSha256'] == x['configuredUserConfigSha256'] ==
                 y['embeddedUserConfigSha256'], 'EMBEDDED_USER_CONFIG_DRIFT')
        elif y['embeddedUserConfigSha256'] is not None:
            need(y['embeddedUserConfigSha256'] == y['configuredUserConfigSha256'], 'NEW_EMBEDDED_USER_CONFIG_DRIFT')
        if i not in reloaded:
            need(x['rawEnvironSha256'] == y['rawEnvironSha256'] and
                 x['rawEnvironmentEntryCount'] == y['rawEnvironmentEntryCount'], 'FOREIGN_RAW_ENV_BYTES_DRIFT')


def validate_delta(before, after, delta):
    need(set(delta) == {'role', 'beforeSha256', 'afterSha256', 'edits'} and
         H(before) == delta['beforeSha256'] and H(after) == delta['afterSha256'], 'DELTA_ROOT_PIN')
    edits, cursor, pieces, inverse = delta['edits'], 0, [], []
    need(isinstance(edits, list) and edits, 'DELTA_EDITS_REQUIRED')
    previous = -1
    for e in edits:
        need(set(e) == {'offset', 'beforeHex', 'afterHex'} and type(e['offset']) is int, 'EXACT_DELTA_SCHEMA')
        start = e['offset']
        need(start > previous and cursor <= start <= len(before), 'DELTA_ORDER_OVERLAP')
        need(all(isinstance(e[k], str) and re.fullmatch('(?:[a-f0-9]{2})*', e[k]) is not None
                 for k in ('beforeHex', 'afterHex')), 'DELTA_HEX')
        old, new = bytes.fromhex(e['beforeHex']), bytes.fromhex(e['afterHex'])
        need(old != new and before[start:start + len(old)] == old, 'EXACT_PATCH_PREIMAGE')
        pieces.extend((before[cursor:start], new))
        inverse.append((sum(map(len, pieces)) - len(new), new, old))
        cursor, previous = start + len(old), start
    pieces.append(before[cursor:])
    need(b''.join(pieces) == after, 'DELTA_EXACT_FORWARD_BYTES')
    restored = after
    for start, new, old in reversed(inverse):
        need(restored[start:start + len(new)] == new, 'DELTA_INVERSE_PREIMAGE')
        restored = restored[:start] + old + restored[start + len(new):]
    need(restored == before, 'DELTA_EXACT_INVERSE_BYTES')


def validate_package(manifest_raw, review_raw, package, controller_bytes, manifest_pin, review_pin, *, check_fresh=True):
    need(digest(manifest_pin) and digest(review_pin) and H(manifest_raw) == manifest_pin and
         H(review_raw) == review_pin, 'ROOT_EXTERNAL_TRUST_PINS')
    m, review = decode(manifest_raw), decode(review_raw)
    need(set(m) == MANIFEST_FIELDS and m['schemaVersion'] == 1 and m['ownerTask'] == OWNER and
         m['scope'] == SCOPE and m['controllerSha256'] == H(controller_bytes), 'EXACT_MANIFEST_CONTROLLER_SCOPE')
    need(set(package) == PACKAGE_NAMES and set(m['packageFiles']) == PACKAGE_NAMES, 'CLOSED_PACKAGE_GRAPH')
    for name in PACKAGE_NAMES:
        need(digest(m['packageFiles'][name]) and H(package[name]) == m['packageFiles'][name], 'PACKAGE_BYTES_DRIFT')
    expected_review = {'status': 'PASS', 'independent': True, 'reviewedBy': 'root',
        'manifestSha256': manifest_pin, 'controllerSha256': H(controller_bytes),
        'captureSha256': H(package['capture.json']), 'schemaReceiptSha256': H(package['schema-receipt.json']),
        'sourceDeltaSha256': H(package['source-delta.json']), 'sourceBindingSha256': H(package['source-binding.json'])}
    need(review == expected_review and review.get('independent') is True, 'INDEPENDENT_ROOT_REVIEW_PASS_REQUIRED')
    need(H(package['protection-initial.json']) == INITIAL_SHA, 'ACTUAL_INITIAL_BASELINE_REQUIRED')
    initial, capture = decode(package['protection-initial.json']), decode(package['capture.json'])
    need(set(capture) == {'schemaVersion', 'ownerTask', 'nonce', 'capturedAtUtc', 'coordinatorSha256',
        'newFlagBeforeSha256', 'protectedFiles', 'beforeProcesses', 'targets', 'rawEnvironment'}, 'EXACT_CAPTURE_SCHEMA')
    need(capture['schemaVersion'] == 1 and capture['ownerTask'] == OWNER and
         re.fullmatch('[a-f0-9]{32}', capture['nonce']) is not None and
         digest(capture['coordinatorSha256']) and
         (capture['newFlagBeforeSha256'] is None or digest(capture['newFlagBeforeSha256'])), 'CAPTURE_PINS')
    if check_fresh:
        fresh(capture['capturedAtUtc'])
    protected = capture['protectedFiles']
    need(protected == initial['protectedFiles'] and len(protected) == 277 and
         len({r['path'] for r in protected}) == 277 and
         all(set(r) == {'path', 'sha256'} and digest(r['sha256']) and
             str(Path(r['path'])) == r['path'] and Path(r['path']).is_absolute() and
             '..' not in Path(r['path']).parts for r in protected), 'ALL_277_PROTECTED_BYTES_PINNED')
    need(not {FRONT, REFUND, COORD, FLAG} & {r['path'] for r in protected} and
         OLD_FLAG in {r['path'] for r in protected}, 'PROTECTED_NO_TARGET_EXCLUSIONS')
    need(capture['targets'] == initial['targets'], 'INITIAL_ROOT_METADATA_PINS')
    process_partition(initial['beforeProcesses'])
    process_partition(capture['beforeProcesses'])
    old = {r['id']: r for r in initial['beforeProcesses']}
    need(set(old) == {r['id'] for r in capture['beforeProcesses']} and all(
         all(row[k] == old[row['id']][k] for k in ('name', 'script', 'cwd'))
         for row in capture['beforeProcesses']), 'FRESH_BASELINE_CANNOT_EXPAND_SCRIPTS')
    raw = capture['rawEnvironment']
    need(set(raw) == {'provided', 'byId'} and type(raw['provided']) is bool and isinstance(raw['byId'], dict), 'RAW_ENV_EXPLICIT_EVIDENCE')
    need((raw == {'provided': False, 'byId': {}}) or
         (raw['provided'] is True and set(raw['byId']) == {str(i) for i in old} and
          all(digest(h) for h in raw['byId'].values())), 'RAW_ENV_NOT_FORGED_OR_PARTIAL')
    need(m['reloadIds'] == list(IDS), 'EXACT_FIVE_RELOAD_IDS')
    need(isinstance(m['targets'], list) and len(m['targets']) == 2, 'EXACT_TWO_ROOTS')
    deltas = decode(package['source-delta.json'])
    need(set(deltas) == {'schemaVersion', 'targets'} and deltas['schemaVersion'] == 1 and
         len(deltas['targets']) == 2, 'EXACT_SOURCE_DELTA_SCHEMA')
    for t, role, path, delta in zip(m['targets'], ('front', 'refund'), (FRONT, REFUND), deltas['targets']):
        need(set(t) == {'role', 'path', 'beforeSha256', 'afterSha256', 'mode', 'uid', 'gid'} and
             t['role'] == role and t['path'] == path and t['uid'] == t['gid'] == 0 and
             type(t['mode']) is int and 0 < t['mode'] <= 0o777 and not t['mode'] & 0o022,
             'EXACT_ROOT_PATH_MODE_OWNER')
        key = 'frontApi' if role == 'front' else 'refundWorker'
        need(t['beforeSha256'] == initial['targets'][key]['sha256'] and
             initial['targets'][key]['path'] == path and delta['role'] == role and
             t['beforeSha256'] == delta['beforeSha256'] and t['afterSha256'] == delta['afterSha256'], 'ROOT_AND_DELTA_BINDING')
        validate_delta(package[role + '.before.js'], package[role + '.after.js'], delta)
    need(isinstance(m['runtimes'], list) and len(m['runtimes']) == 2, 'EXACT_TWO_RUNTIMES')
    for r, role, base, prefix, file in zip(m['runtimes'], ('front', 'refund'),
            (FRONT_RUNTIME, REFUND_RUNTIME), ('officialCart', 'officialCartStock'), ('cart.runtime.mjs', 'stock.runtime.mjs')):
        sha = H(package[file])
        need(set(r) == {'role', 'path', 'sha256', 'mode'} and r ==
             {'role': role, 'path': base + '/' + prefix + '.' + sha + '.runtime.mjs', 'sha256': sha, 'mode': 0o644},
             'FIXED_CONTENT_ADDRESSED_RUNTIME_SCOPE')
        need(('../runtime/' + Path(r['path']).name).encode() in package[role + '.after.js'], 'ROOT_IMPORT_RUNTIME_BINDING')
    binding = decode(package['source-binding.json'])
    need(binding == {'schemaVersion': 1, 'status': 'PASS', **{k: True for k in BINDING_FIELDS}} and
         all(binding.get(k) is True for k in BINDING_FIELDS), 'ROOT_BUILD_SOURCE_PROOFS')
    effective = decode(package['effective-before.json'])
    if effective != {'provided': False}:
        need(set(effective) == {'capturedAtUtc', 'processes', 'coordinatorSha256', 'sharedReleaseActive',
            'oldFlagSha256', 'oldFlag', 'oldVerifiedHistory', 'oldVerifiedClosedHistoryPresent',
            'newFlagExists', 'newFlagSha256', 'availableBytes'}, 'ROOT_EFFECTIVE_EVIDENCE_SCHEMA')
        compare_effective(effective['processes'], effective['processes'])
        need([{k: r[k] for k in PROCESS_FIELDS} for r in effective['processes']] == capture['beforeProcesses'] and
             effective['coordinatorSha256'] == capture['coordinatorSha256'] and
             effective['sharedReleaseActive'] is False and effective['oldVerifiedClosedHistoryPresent'] is True and
             effective['newFlagSha256'] == capture['newFlagBeforeSha256'] and
             effective['newFlagExists'] == (capture['newFlagBeforeSha256'] is not None) and
             effective['oldFlagSha256'] == next(r['sha256'] for r in protected if r['path'] == OLD_FLAG), 'ROOT_EFFECTIVE_EVIDENCE_BINDING')
        if check_fresh:
            fresh(effective['capturedAtUtc'])
    receipt = decode(package['schema-receipt.json'])
    need(set(receipt) == {'status', 'action', 'sqlSha256', 'migrationSha256', 'targetTables', 'checkedAtUtc',
        'oldSchemasUnchanged', 'oldSingleUniquesUnchanged', 'oldBusinessRecordsUnchanged', 'tables', 'businessWrites'}, 'SCHEMA_RECEIPT_REQUIRED')
    need(receipt['status'] == 'verified' and receipt['action'] in ('apply', 'verify') and
         receipt['targetTables'] == TABLES and receipt['sqlSha256'] == receipt['migrationSha256'] == H(package['migration.sql']) and
         receipt['oldSchemasUnchanged'] is True and receipt['oldSingleUniquesUnchanged'] is True and
         receipt['oldBusinessRecordsUnchanged'] is True and receipt['businessWrites'] == 0 and
         isinstance(receipt['tables'], list) and len(receipt['tables']) == 4 and
         [r.get('table') for r in receipt['tables']] == TABLES and
         all(r.get('exists') is True and 'ENGINE=InnoDB' in r.get('create', '') and
             isinstance(r.get('columns'), list) and isinstance(r.get('indexes'), list) for r in receipt['tables']),
         'SEALED_ROOT_CURRENT_SCHEMA_RECEIPT')
    if check_fresh:
        fresh(receipt['checkedAtUtc'])
    return m, capture


class ProductionFiles:
    """No generic path capability: every read/write authorized by sealed fixed graph.

    Public methods take exact allowlisted strings; no fixture-root escape switch.
    Offline tests exercise this class only with mocked syscalls, never real /opt I/O.
    """
    def __init__(self, stage, protected, runtimes):
        need(stage in (STAGE, ARCHIVE), 'FIXED_STAGE_ONLY')
        need(all((str(Path(p).parent) == FRONT_RUNTIME and re.fullmatch(r'officialCart\.[a-f0-9]{64}\.runtime\.mjs', Path(p).name)) or
                 (str(Path(p).parent) == REFUND_RUNTIME and re.fullmatch(r'officialCartStock\.[a-f0-9]{64}\.runtime\.mjs', Path(p).name))
                 for p in runtimes), 'CLOSED_RUNTIME_WRITE_CAPABILITY')
        self.stage = stage
        self.reads = {FRONT, REFUND, COORD, FLAG, *LOCKS, *protected, *runtimes}
        self.writes = {FRONT, REFUND, COORD, FLAG, *runtimes}
        self.reads |= {stage + '/' + n for n in ('controller.py', 'manifest.json', 'review.json')}
        self.reads |= {stage + '/package/' + n for n in PACKAGE_NAMES}
        self.audit_names = {'front.original.js', 'refund.original.js', 'intent.json', 'exposure.json', 'receipt.json', 'failclosed.json'}
        self.reads |= {stage + '/audit/' + n for n in self.audit_names}
        self.writes |= {stage + '/audit/' + n for n in self.audit_names}
        self.readonly_protected = set(protected) - self.writes

    def path(self, name, write=False):
        need(name in (self.writes if write else self.reads), 'FIXED_FILE_CAPABILITY')
        p = Path(name)
        if name in LOCKS:
            need(p.parent == Path('/var/lock') and p.parent.resolve() == Path('/run/lock'), 'FIXED_SYSTEM_LOCK_ALIAS')
            p = Path('/run/lock') / p.name
        # /opt/backups alias is resolved only once at CLI, never targets / package files.
        need(p.parent.resolve() == p.parent, 'CANONICAL_PARENT_REQUIRED')
        if p.exists() or p.is_symlink():
            s = p.lstat()
            need(stat.S_ISREG(s.st_mode) and not p.is_symlink() and
                 (s.st_nlink == 1 or (not write and name in self.readonly_protected)), 'SINGLE_REGULAR_NO_SYMLINK')
        return p

    def read(self, name):
        p = self.path(name)
        fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, 'rb') as f:
            need(stat.S_ISREG(os.fstat(f.fileno()).st_mode), 'REGULAR_READ_REQUIRED')
            return f.read()

    def optional(self, name):
        try:
            return self.read(name)
        except FileNotFoundError:
            return None

    def metadata(self, name):
        s = self.path(name).stat()
        return {'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid}

    def syncdir(self, p):
        fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def create(self, name, data, mode=0o600):
        p = self.path(name, True)
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, 'wb') as f:
            os.fchmod(f.fileno(), mode)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        self.syncdir(p.parent)
        need(self.read(name) == data, 'EXCLUSIVE_CREATE_READBACK')

    def cas(self, name, before, after):
        p = self.path(name, True)
        need(self.read(name) == before, 'FULL_BYTE_CAS')
        s = p.stat()
        temp = p.parent / ('.official-cart-cas-' + uuid.uuid4().hex)
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, stat.S_IMODE(s.st_mode))
        try:
            with os.fdopen(fd, 'wb') as f:
                os.fchmod(f.fileno(), stat.S_IMODE(s.st_mode))
                os.fchown(f.fileno(), s.st_uid, s.st_gid)
                f.write(after)
                f.flush()
                os.fsync(f.fileno())
            need(self.read(name) == before, 'LAST_FULL_BYTE_CAS')
            os.replace(temp, p)
            self.syncdir(p.parent)  # may raise AFTER commit: caller tracks intended bytes BEFORE call
            need(self.read(name) == after, 'CAS_READBACK')
        finally:
            if temp.exists():
                temp.unlink()

    def prepare_audit(self):
        p = Path(self.stage) / 'audit'
        need(p.parent.resolve() == p.parent, 'AUDIT_CANONICAL_STAGE')
        p.mkdir(mode=0o700, exist_ok=False)
        self.syncdir(p.parent)

    @contextmanager
    def locks(self):
        handles = []
        try:
            for name in LOCKS:
                p = self.path(name)
                h = open(p, 'r+b')  # lock files must ALREADY exist; never preflight-create
                handles.append(h)
                fcntl.flock(h, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally:
            for h in reversed(handles):
                fcntl.flock(h, fcntl.LOCK_UN)
                h.close()


class ProductionHost:
    def processes(self):
        data = subprocess.check_output(['pm2', 'jlist'], stderr=subprocess.PIPE, timeout=30, env=SAFE_ENV, cwd='/root')
        self._last_rows = decode(data)
        return normalize_processes(self._last_rows)

    def effective_processes(self, expected_rows):
        rows = self._last_rows
        need(normalize_processes(rows) == expected_rows, 'EFFECTIVE_SAME_PROCESS_SNAPSHOT')
        result = []
        for p in rows:
            e = p['pm2_env']
            raw = Path('/proc', str(p['pid']), 'environ').read_bytes()
            entries = {}
            for piece in raw.split(b'\0'):
                if b'=' in piece:
                    k, v = piece.split(b'=', 1)
                    entries[k.decode('utf8', 'replace')] = v
            env = {k: v for k, v in e.get('env', {}).items() if k not in VOLATILE}
            hashed = lambda v: H(json.dumps(v, sort_keys=True, separators=(',', ':')).encode())
            embedded = None
            if 'pm2_env' in entries:
                obj = decode(entries['pm2_env'])
                if isinstance(obj, dict) and isinstance(obj.get('env'), dict):
                    embedded = hashed({k: v for k, v in obj['env'].items() if k not in VOLATILE})
            result.append(dict(id=p['pm_id'], name=p['name'], pid=p['pid'], status=e['status'],
                script=e['pm_exec_path'], cwd=e['pm_cwd'], envHash=config_hash(e), mode=e['exec_mode'],
                rawEnvironSha256=H(raw), embeddedUserConfigSha256=embedded, configuredUserConfigSha256=hashed(env),
                rawEnvironmentEntryCount=len(entries), userEnvironmentKeyCount=len(env)))
        need(self.processes() == expected_rows, 'PROCESS_CHANGED_DURING_PROC_CAPTURE')
        return sorted(result, key=lambda r: r['id'])

    def raw_environment(self, rows):
        # Only current twelve PIDs derived from sealed script/config-checked records.
        process_partition(rows)
        return {str(r['id']): H(Path('/proc', str(r['pid']), 'environ').read_bytes()) for r in rows}

    def reload(self, ident):
        need(type(ident) is int and ident in IDS, 'FIXED_RELOAD_ID')
        # No retries: an uncertain timeout/PID is recovery-required, never blind autoreload.
        subprocess.run(['pm2', 'reload', str(ident)], check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.PIPE, timeout=90, env=SAFE_ENV, cwd='/root')

    def get(self, route, payload):
        need((route, payload) in GET_PROBES, 'FIXED_GET_ONLY')
        conn = http.client.HTTPConnection('127.0.0.1', 3000, timeout=15)
        try:
            path = '/api/trpc/' + route + '?input=' + quote(json.dumps({'json': payload}, separators=(',', ':')))
            conn.request('GET', path, headers={'Host': '51dianzi.com', 'Origin': 'https://51dianzi.com',
                'Referer': 'https://51dianzi.com/', 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
            response = conn.getresponse()
            body = response.read(1048577)
            need(len(body) <= 1048576, 'GET_RESPONSE_LIMIT')
            return response.status, decode(body)
        finally:
            conn.close()

    def probes(self, legacy=False):
        if not legacy:
            for route, payload in GET_PROBES[:2]:
                status, result = self.get(route, payload)
                error = result.get('error', {}).get('json', {})
                need(status == 401 and error.get('code') == -32001 and
                     error.get('message') == 'Please login (10001)' and
                     error.get('data', {}).get('code') == 'UNAUTHORIZED' and
                     error.get('data', {}).get('httpStatus') == 401 and
                     error.get('data', {}).get('path') == route, 'ANONYMOUS_ROUTE_UNAUTHORIZED_10001')
        status, result = self.get(*GET_PROBES[2])
        data = result.get('result', {}).get('data', {}).get('json', {})
        need(status == 200 and isinstance(data, dict) and isinstance(data.get('items'), list) and
             len(data['items']) <= 1 and type(data.get('total')) is int and data['total'] >= 0 and
             data.get('page') == 1 and data.get('pageSize') == 1, 'PUBLIC_READONLY_API_HEALTH')
        return {'anonymousRouteGuardOnly': not legacy, 'publicGet': True, 'financialCalls': 0, 'loggedInLogicalTested': False}


GET_PROBES = (('officialCart.count', {}), ('officialCart.list', {}),
              ('officialMall.list', {'partNumber': 'STM32F103C8T6', 'page': 1, 'pageSize': 1}))


class Controller:
    """State machine uses a testable port; CLI ONLY binds ProductionFiles/Host."""
    def __init__(self, fs, host, manifest, capture, package, manifest_sha, review_sha=None):
        self.fs, self.host, self.m, self.c, self.package, self.sha = fs, host, manifest, capture, package, manifest_sha
        self.review_sha = review_sha
        self.stage = fs.stage
        self.nonce = capture['nonce']
        self.owned_coord = None
        self.disabled = encode(self.flag_payload(False))
        self.active = None
        self.exposed = False
        self.reloaded = set()
        self.reload_attempted = set()
        self.flag_attempted = False
        self.original_flag = None
        self.errors = []
        self.effective = decode(package['effective-before.json'])

    def proof_fields(self):
        provided = self.effective != {'provided': False}
        return {'rawEnvironVerified': provided or self.c['rawEnvironment']['provided'],
                'actualUserConfigurationProof': 'embedded-cluster-and-normalized-fork' if provided else 'normalized-pm2-only'}

    def flag_payload(self, enabled):
        return {'schemaVersion': 1, 'enabled': enabled, 'ownerTask': OWNER, 'nonce': self.nonce,
                'manifestSha256': self.sha, 'runtimeSha256': self.m['runtimes'][0]['sha256']}

    def audit(self, name, value):
        self.fs.create(self.stage + '/audit/' + name, value if isinstance(value, bytes) else encode(value))

    def diagnostic(self, value):
        try:
            self.audit('receipt.json', value)
        except BaseException:
            self.errors.append('DIAGNOSTIC_WRITE_FAILURE')

    def owned(self):
        need(self.owned_coord is not None and self.fs.read(COORD) == self.owned_coord, 'FOREIGN_COORD_UNTOUCHED')

    def coord_write(self, data):
        before = self.owned_coord
        # Keep last intended owned bytes even if rename then fsync raises.
        self.owned_coord = data
        try:
            self.fs.cas(COORD, before, data)
        except BaseException:
            try:
                if self.fs.read(COORD) == before:
                    self.owned_coord = before
            except BaseException:
                pass
            raise

    def baseline(self):
        fresh(self.c['capturedAtUtc'])
        fresh(decode(self.package['schema-receipt.json'])['checkedAtUtc'])
        if self.effective != {'provided': False}:
            fresh(self.effective['capturedAtUtc'])
        if self.review_sha is not None:
            current_package = {name: self.fs.read(self.stage + '/package/' + name) for name in PACKAGE_NAMES}
            validate_package(self.fs.read(self.stage + '/manifest.json'), self.fs.read(self.stage + '/review.json'),
                current_package, self.fs.read(self.stage + '/controller.py'), self.sha, self.review_sha)
            need(current_package == self.package, 'SEALED_PACKAGE_CHANGED_BEFORE_APPLY')
        coord_raw = self.fs.read(COORD)
        need(H(coord_raw) == self.c['coordinatorSha256'], 'FRESH_COORD_PIN')
        coord = decode(coord_raw)
        need(coord.get('shared_release_active') is False and isinstance(coord.get('window_history', []), list), 'FOREIGN_WINDOW_ACTIVE_OR_HISTORY')
        need(not any(isinstance(w, dict) and w.get('nonce') == self.nonce for w in
                     [coord.get('window', {})] + coord.get('window_history', [])), 'NONCE_ALREADY_USED_NO_REPLAY')
        current = self.fs.optional(FLAG)
        pin = self.c['newFlagBeforeSha256']
        need((current is None and pin is None) or (current is not None and H(current) == pin and
             decode(current).get('ownerTask') == OWNER and decode(current).get('enabled') is False), 'FRESH_OWN_DISABLED_FLAG_OR_ABSENT')
        self.original_flag = current
        self.protect((), (), require_disabled=False)
        need(self.fs.read(COORD) == coord_raw, 'LAST_FRESH_COORD_FULL_BYTES')
        return coord_raw

    def protect(self, installed_roles, reloaded, *, require_disabled=True):
        for item in self.c['protectedFiles']:
            need(H(self.fs.read(item['path'])) == item['sha256'], 'PROTECTED_BYTES_DRIFT')
        html = self.c['targets']['frontHtml']
        need(H(self.fs.read(html['path'])) == html['sha256'], 'FRONT_HTML_PROTECTED')
        for t in self.m['targets']:
            key = 'afterSha256' if t['role'] in installed_roles else 'beforeSha256'
            need(H(self.fs.read(t['path'])) == t[key], 'ACTIVE_ROOT_DRIFT')
            need(self.fs.metadata(t['path']) == {k: t[k] for k in ('mode', 'uid', 'gid')}, 'ROOT_METADATA_DRIFT')
        for r in self.m['runtimes']:
            current = self.fs.optional(r['path'])
            if current is not None:
                need(H(current) == r['sha256'] and self.fs.metadata(r['path']) == {'mode': 0o644, 'uid': 0, 'gid': 0}, 'RUNTIME_COLLISION_OR_METADATA')
            elif r['role'] in installed_roles:
                raise Refusal('INSTALLED_RUNTIME_MISSING')
        ps = self.host.processes()
        compare_processes(self.c['beforeProcesses'], ps, reloaded)
        if self.effective != {'provided': False}:
            compare_effective(self.effective['processes'], self.host.effective_processes(ps), reloaded)
        raw = self.c['rawEnvironment']
        if raw['provided']:
            actual = self.host.raw_environment(ps)
            need(all(actual[str(r['id'])] == raw['byId'][str(r['id'])] for r in ps if r['id'] not in reloaded), 'NON_TARGET_ACTUAL_RAW_ENV_DRIFT')
        if require_disabled:
            need(self.fs.read(FLAG) == self.disabled, 'OWN_NEW_GUARD_NOT_DISABLED')

    def observed_roles(self):
        roles = set()
        for t in self.m['targets']:
            data = self.fs.read(t['path'])
            if H(data) == t['afterSha256']:
                roles.add(t['role'])
            else:
                need(H(data) == t['beforeSha256'], 'FOREIGN_ROOT_UNTOUCHED')
        return roles

    def close(self, status, recovery=False):
        self.owned()
        c = decode(self.owned_coord)
        window = dict(c['window'])
        need(window.get('nonce') == self.nonce and window.get('owner_task') == OWNER and
             window.get('manifestSha256') == self.sha, 'OWN_WINDOW_BINDING')
        window.update(status=status, needsOperatorRecovery=recovery)
        if not recovery:
            window['closedAtUtc'] = now()
        else:
            window.pop('closedAtUtc', None)
        history = c.setdefault('window_history', [])
        matched = [i for i, w in enumerate(history) if isinstance(w, dict) and w.get('nonce') == self.nonce]
        need(len(matched) <= 1, 'DUPLICATED_OWN_HISTORY')
        if matched:
            need(history[matched[0]].get('owner_task') == OWNER and history[matched[0]].get('manifestSha256') == self.sha, 'FOREIGN_HISTORY_UNTOUCHED')
            history[matched[0]] = dict(window)
        else:
            history.append(dict(window))
        c.update(window=window, shared_release_active=recovery, updated_at=now())
        self.coord_write(encode(c))
        self.owned()
        return self.owned_coord

    def verify_closure(self):
        self.owned()
        c = decode(self.owned_coord)
        w = c.get('window', {})
        need(c.get('shared_release_active') is False and w.get('owner_task') == OWNER and
             w.get('nonce') == self.nonce and w.get('manifestSha256') == self.sha and
             w.get('status') == 'verified' and bool(w.get('closedAtUtc')) and
             w.get('needsOperatorRecovery') is False and
             [v for v in c.get('window_history', []) if isinstance(v, dict) and v.get('nonce') == self.nonce] == [w], 'DURABLE_OWN_VERIFIED_CLOSURE_REQUIRED')

    def recover(self):
        """Safety actions are independent of logging; never overwrite foreign bytes."""
        disabled_ok = False
        try:
            flag = self.fs.optional(FLAG)
            if flag == self.active and self.active is not None:
                self.exposed = True
                try:
                    self.fs.cas(FLAG, self.active, self.disabled)
                finally:
                    disabled_ok = self.fs.optional(FLAG) == self.disabled
            elif flag == self.disabled:
                disabled_ok = True
            elif not self.flag_attempted and flag == self.original_flag:
                disabled_ok = flag is None or decode(flag).get('enabled') is False
            else:
                self.exposed = True
                self.errors.append('FOREIGN_FLAG_UNTOUCHED')
        except BaseException:
            self.exposed = True
            self.errors.append('FLAG_DISABLE_UNCERTAIN')
        try:
            self.audit('failclosed.json', {'status': 'failclosed', 'exposurePossible': self.exposed, 'nonce': self.nonce})
        except BaseException:
            self.errors.append('FAILCLOSED_DIAGNOSTIC_FAILURE')
        rolled_back = False
        if not self.exposed and disabled_ok:
            try:
                self.owned()
                # Independent per-file attempts: one foreign file can never authorize its overwrite.
                restore_errors = []
                for t in reversed(self.m['targets']):
                    try:
                        self.owned()
                        data = self.fs.read(t['path'])
                        if data == self.package[t['role'] + '.after.js']:
                            self.fs.cas(t['path'], data, self.package[t['role'] + '.before.js'])
                        else:
                            need(data == self.package[t['role'] + '.before.js'], 'FOREIGN_ROOT_UNTOUCHED')
                    except BaseException:
                        restore_errors.append(t['role'])
                need(not restore_errors and not self.observed_roles(), 'ROOT_RESTORE_INCOMPLETE')
                # Read/check actual IDs/status/scripts/config BEFORE deciding a rollback reload.
                # A failed apply reload with its original PID is not blindly retried.
                current = self.host.processes()
                compare_processes(self.c['beforeProcesses'], current, self.reload_attempted)
                original_pids = {r['id']: r['pid'] for r in self.c['beforeProcesses']}
                rollback_reload = self.reloaded | {r['id'] for r in current if r['id'] in self.reload_attempted and
                                                    r['pid'] != original_pids[r['id']]}
                for ident in IDS:
                    if ident in rollback_reload:
                        self.owned()
                        self.host.reload(ident)
                self.protect((), self.reload_attempted, require_disabled=self.flag_attempted)
                self.host.probes(legacy=True)
                need(not self.observed_roles(), 'PREIMAGES_NOT_RESTORED')
                self.close('failed-rolled-back', recovery=False)
                rolled_back = True
            except BaseException:
                self.errors.append('OWNED_RECOVERY_INCOMPLETE')
        if not rolled_back:
            try:
                self.close('recovery-required', recovery=True)
            except BaseException:
                self.errors.append('FOREIGN_OR_UNAVAILABLE_COORD_UNTOUCHED')
        result = {'status': 'failed-rolled-back' if rolled_back else 'recovery-required',
                  'flagDisabled': disabled_ok, 'codeRollback': rolled_back, 'exposurePossible': self.exposed,
                  'schemaRetained': True, 'errors': self.errors}
        self.diagnostic(result)
        return result

    def preflight(self):
        self.baseline()
        self.host.probes(legacy=True)
        return {'status': 'PREFLIGHT_PASS', 'activeWrites': 0, 'protectedFiles': 277,
                'schemaVerification': 'root-sealed-readonly-receipt', **self.proof_fields(), 'productionApplied': False}

    def apply(self):
        with self.fs.locks():
            before = self.baseline()
            self.host.probes(legacy=True)
            self.fs.prepare_audit()
            self.audit('intent.json', {'nonce': self.nonce, 'manifestSha256': self.sha, 'status': 'installing', 'atUtc': now()})
            coord = decode(before)
            history = coord.setdefault('window_history', [])
            previous_window = coord.get('window')
            if previous_window is not None and previous_window not in history:
                history.append(previous_window)
            window = {'owner_task': OWNER, 'scope': SCOPE, 'nonce': self.nonce, 'manifestSha256': self.sha,
                      'runtimeSha256': self.m['runtimes'][0]['sha256'], 'status': 'installing', 'openedAtUtc': now(),
                      'needsOperatorRecovery': False, 'audit': self.stage + '/audit/intent.json',
                      'probeMode': 'anonymous-fixed-readonly-only'}
            history.append(dict(window))
            coord.update(shared_release_active=True, window=window, updated_at=now())
            self.owned_coord = before
            try:
                self.coord_write(encode(coord))
                self.owned()
                self.flag_attempted = True
                if self.original_flag is None:
                    self.fs.create(FLAG, self.disabled)
                else:
                    self.fs.cas(FLAG, self.original_flag, self.disabled)
                self.protect((), ())
                for t in self.m['targets']:
                    self.audit(t['role'] + '.original.js', self.fs.read(t['path']))
                for r, name in zip(self.m['runtimes'], ('cart.runtime.mjs', 'stock.runtime.mjs')):
                    self.owned()
                    need(self.fs.read(FLAG) == self.disabled, 'NEW_GUARD_FALSE_ENTIRE_WINDOW')
                    if self.fs.optional(r['path']) is None:
                        self.fs.create(r['path'], self.package[name], mode=r['mode'])
                installed = set()
                for t in self.m['targets']:
                    self.owned()
                    self.protect(installed, self.reloaded)
                    # Mark roles by observed bytes during recovery, not a post-CAS success boolean.
                    self.fs.cas(t['path'], self.package[t['role'] + '.before.js'], self.package[t['role'] + '.after.js'])
                    installed.add(t['role'])
                    ids = IDS[:4] if t['role'] == 'front' else IDS[4:]
                    for ident in ids:
                        self.owned()
                        self.protect(installed, self.reloaded)
                        self.reload_attempted.add(ident)  # uncertain reload failure is never silently retried here
                        self.host.reload(ident)
                        self.reloaded.add(ident)
                        self.protect(installed, self.reloaded)
                self.owned()
                probes = self.host.probes()
                self.protect({'front', 'refund'}, self.reloaded)
                self.close('verified')
                self.verify_closure()
                self.protect({'front', 'refund'}, self.reloaded)
                # Durable intent MUST precede any possibly true flag. Never clear this latch.
                self.exposed = True  # An intent create/fsync may commit before raising.
                self.audit('exposure.json', {'status': 'activation-intent', 'nonce': self.nonce,
                                           'manifestSha256': self.sha, 'atUtc': now()})
                self.verify_closure()
                self.active = encode({**self.flag_payload(True), 'activatedAtUtc': now()})
                self.fs.cas(FLAG, self.disabled, self.active)
                self.verify_closure()
                self.protect({'front', 'refund'}, self.reloaded, require_disabled=False)
                need(self.fs.read(FLAG) == self.active, 'ACTIVE_OWN_FLAG_READBACK')
                result = {'status': 'verified', 'manifestSha256': self.sha, 'reloadIds': list(IDS),
                          'schemaRetained': True, 'probe': probes, 'financialCalls': 0,
                          **self.proof_fields()}
                # Receipt failures are failures AFTER exposure: disable, retain new code.
                self.audit('receipt.json', result)
                self.verify_closure()
                need(self.fs.read(FLAG) == self.active, 'FINAL_ACTIVE_OWN_FLAG_READBACK')
                return result
            except BaseException as exc:
                result = self.recover()
                result['failureClass'] = exc.args[0] if isinstance(exc, Refusal) else type(exc).__name__
                return result

    def verify(self):
        self.owned_coord = self.fs.read(COORD)
        self.verify_closure()
        flag = self.fs.read(FLAG)
        value = decode(flag)
        need(set(value) == set(self.flag_payload(True)) | {'activatedAtUtc'} and
             all(value.get(k) == v for k, v in self.flag_payload(True).items()) and bool(value['activatedAtUtc']), 'EXACT_ACTIVE_OWN_FLAG')
        self.protect({'front', 'refund'}, IDS, require_disabled=False)
        probes = self.host.probes()
        self.owned()
        need(self.fs.read(FLAG) == flag, 'VERIFY_FLAG_DRIFT')
        return {'status': 'VERIFY_PASS', 'activeWrites': 0, 'probe': probes,
                **self.proof_fields()}


def stage_context(root):
    need(os.geteuid() == 0, 'ROOT_CALLER_REQUIRED')
    need(root in (STAGE, ARCHIVE), 'FIXED_ROOT_ARGUMENT')
    canonical = str(Path(root).resolve())
    need(canonical in (STAGE, ARCHIVE) and Path(canonical).is_dir(), 'FIXED_ACTUAL_CANONICAL_STAGE')
    need(str(Path(__file__).resolve()) == canonical + '/controller.py', 'ACTIVE_CONTROLLER_STAGE_ONLY')
    p = Path(canonical)
    need(not p.is_symlink() and p.stat().st_uid == 0 and not p.stat().st_mode & 0o022, 'PRIVATE_ROOT_STAGE_REQUIRED')
    entries = {x.name for x in p.iterdir()}
    need({'controller.py', 'manifest.json', 'review.json', 'package'} <= entries and
         entries <= {'controller.py', 'manifest.json', 'review.json', 'package', 'audit', 'schema'}, 'CLOSED_STAGE_GRAPH')
    # The separate root-operated SQL unit is NOT traversed, executed, or writable here.
    if 'schema' in entries:
        schema = p / 'schema'
        need(schema.is_dir() and not schema.is_symlink() and schema.resolve() == schema and
             schema.stat().st_uid == 0 and not schema.stat().st_mode & 0o022, 'SEPARATE_FIXED_SCHEMA_DIRECTORY')
    package_dir = p / 'package'
    need(package_dir.is_dir() and not package_dir.is_symlink() and package_dir.resolve() == package_dir and
         {x.name for x in package_dir.iterdir()} == PACKAGE_NAMES, 'CLOSED_PACKAGE_DIRECTORY')
    for f in [p, package_dir, p / 'controller.py', p / 'manifest.json', p / 'review.json', *package_dir.iterdir()]:
        s = f.lstat()
        need(not f.is_symlink() and s.st_uid == 0 and not s.st_mode & 0o022 and
             (stat.S_ISDIR(s.st_mode) or (stat.S_ISREG(s.st_mode) and s.st_nlink == 1)), 'ROOT_OWNED_SEALED_GRAPH')
    if 'audit' in entries:
        a = p / 'audit'
        need(a.is_dir() and not a.is_symlink() and a.resolve() == a and a.stat().st_uid == 0 and
             not a.stat().st_mode & 0o077 and {f.name for f in a.iterdir()} <=
             {'front.original.js', 'refund.original.js', 'intent.json', 'exposure.json', 'receipt.json', 'failclosed.json'}, 'CLOSED_PRIVATE_AUDIT_GRAPH')
    return canonical


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--action', choices=('preflight', 'apply', 'verify'), required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--review-sha256', required=True)
    args = parser.parse_args(argv)
    try:
        root = stage_context(args.root)
        # First closed reader has no runtime/protected capability until package validation.
        reader = ProductionFiles(root, (), ())
        package = {name: reader.read(root + '/package/' + name) for name in PACKAGE_NAMES}
        raw, review = reader.read(root + '/manifest.json'), reader.read(root + '/review.json')
        m, capture = validate_package(raw, review, package, reader.read(root + '/controller.py'),
            args.manifest_sha256, args.review_sha256, check_fresh=args.action != 'verify')
        protected = {r['path'] for r in capture['protectedFiles']} | {capture['targets']['frontHtml']['path']}
        fs = ProductionFiles(root, protected, {r['path'] for r in m['runtimes']})
        controller = Controller(fs, ProductionHost(), m, capture, package, H(raw), args.review_sha256)
        result = getattr(controller, args.action)()
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result['status'] in ('PREFLIGHT_PASS', 'VERIFY_PASS', 'verified') else 1
    except BaseException as exc:
        code = exc.args[0] if isinstance(exc, Refusal) else type(exc).__name__
        print(json.dumps({'status': 'REFUSED', 'failureClass': code, 'secretsLogged': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
