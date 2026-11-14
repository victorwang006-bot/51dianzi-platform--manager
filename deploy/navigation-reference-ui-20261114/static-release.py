#!/usr/bin/env python3
"""Phase1 only: five static files; no API activation, database, or PM2 mutation."""
import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request
import uuid

TASK = 'CKSZQ7sVc7tADM21c3LWpu'
ROOT = Path('/opt/ops/20261114-navigation-reference-ui-CKSZQ7s')
PUBLIC = Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
LOCKS = ('/var/lock/dianzi51-public-deploy.lock', '/var/lock/dianzi51-production-code.lock')
API_PATHS = {k: '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/'+k+'/dist/index.js' for k in ('admin', 'front')}
API_SHA = {'admin': '0f2bc286a3a1d6643544cc5270c113214795de3531e66123164b296a857a8ad8', 'front': 'db920e472f854dd41ae6f610f2c0d1c37df28c5260afee4ab3f924b24c83c2c9'}
BEFORE_SHA = '83500e995e5cdeebeba90b8cc59be93e8e45ff2dadd933e27fdb4671b154eb51'
PROTECTED = {'/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html', '/etc/nginx/conf.d/dianzi51-admin-subdomain.conf', '/root/.pm2/dump.pm2', API_PATHS['front']}
ADMIN = 'https://admin.51dianzi.com'
HOME = 'https://www.51dianzi.com/'
ROUTES = ('/', '/login', '/workbench/customers', '/workbench/inventory', '/workbench/orders?orderSource=business', '/workbench/orders?orderSource=mall', '/workbench/inquiries', '/workbench/procurement', '/workbench/inbound')
HEX = re.compile(r'[0-9a-f]{64}')
FRONT_FLAGS = ('sourceBound', 'unrelatedNativeBytesUnchanged', 'mallOperationsUnchanged', 'scopeAndArchiveUnchanged', 'latestGlobalOrdersBytesPreserved', 'navigationBusinessOrderCorrect', 'referenceNoQuoteTextOnlyActualBound', 'exactHTMLInverse')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def sha(path):
    return digest(Path(path).read_bytes())


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def unique(items):
    out = {}
    for k, v in items:
        require(k not in out, 'DUPLICATE_JSON_KEY')
        out[k] = v
    return out


def load(path):
    return json.loads(Path(path).read_bytes(), object_pairs_hook=unique)


def encoded(obj):
    return (json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=2)+'\n').encode()


def safe(name):
    require(isinstance(name, str) and 0 < len(name) <= 240 and re.fullmatch(r'[A-Za-z0-9._/-]+', name) and all(p not in ('', '.', '..') for p in name.split('/')), 'UNSAFE_PATH')
    return Path(name)


def regular(base, name):
    base = Path(base)
    path = base / safe(name)
    require(not base.is_symlink(), 'SYMLINK_BASE')
    for p in (path, *path.parents):
        require(not p.is_symlink(), 'SYMLINK_PATH')
    require(path.resolve().is_relative_to(base.resolve()) and path.is_file(), 'NONREGULAR_FILE')
    return path


def atomic(path, data, mode=None):
    path = Path(path)
    require(not path.is_symlink(), 'SYMLINK_WRITE')
    previous = path.stat() if path.exists() else None
    fd, temp = tempfile.mkstemp(prefix='.static-phase1-', dir=path.parent)
    try:
        os.fchmod(fd, mode if mode is not None else (previous.st_mode & 0o777 if previous else 0o644))
        if previous:
            os.fchown(fd, previous.st_uid, previous.st_gid)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def save(path, obj):
    atomic(path, encoded(obj), 0o600)


@contextmanager
def locks():
    opened = []
    try:
        # Existing lock inodes only: even verify/capture never create lock files.
        for name in LOCKS:
            stream = open(name, 'rb')
            opened.append(stream)
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        for stream in reversed(opened):
            fcntl.flock(stream, fcntl.LOCK_UN)
            stream.close()


def existing_pm2():
    import stat
    home = Path('/root/.pm2')
    daemon = int(regular(home, 'pm2.pid').read_text().strip())
    require(daemon > 0 and stat.S_ISSOCK((home/'rpc.sock').stat().st_mode), 'PM2_DAEMON_MUST_ALREADY_EXIST')
    os.kill(daemon, 0)  # Signal 0: existence/permission check, no process mutation.


def processes():
    existing_pm2()
    rows = json.loads(subprocess.check_output(['pm2', 'jlist'], timeout=30, env=dict(os.environ, PM2_HOME='/root/.pm2')))
    out = []
    for r in rows:
        e = r['pm2_env']
        out.append({'id': r['pm_id'], 'name': r['name'], 'pid': r['pid'], 'status': e['status'], 'script': e.get('pm_exec_path'), 'cwd': e.get('pm_cwd'), 'execMode': e.get('exec_mode'), 'environmentHash': digest(json.dumps(e.get('env', {}), sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode())})
    return sorted(out, key=lambda x: x['id'])


def validate_processes(rows):
    keys = {'id', 'name', 'pid', 'status', 'script', 'cwd', 'execMode', 'environmentHash'}
    require(len(rows) == 12 and len({r['id'] for r in rows}) == 12, 'EXACT_12_PROCESSES')
    require(rows == sorted(rows, key=lambda x: x['id']), 'PROCESS_ORDER')
    for r in rows:
        require(set(r) == keys and r['status'] == 'online' and type(r['pid']) is int and r['pid'] > 0 and HEX.fullmatch(r['environmentHash']) and r['script'] and r['cwd'], 'INVALID_PROCESS')
    require({r['id'] for r in rows if r['name'] == 'dianzi51-admin'} == {191, 192}, 'ADMIN_IDS')
    require(all(r['script'] == API_PATHS['admin'] for r in rows if r['id'] in (191, 192)), 'ADMIN_SCRIPT')


def rows_map(rows, key):
    require(isinstance(rows, list) and rows, 'EMPTY_FILE_PINS')
    out = {}
    for r in rows:
        require(set(r) == {key, 'sha256'} and r[key] not in out and isinstance(r['sha256'], str) and HEX.fullmatch(r['sha256']), 'INVALID_FILE_PIN')
        if key == 'relative':
            safe(r[key])
            require(r[key].startswith('assets/'), 'BASELINE_ASSET_PREFIX')
        out[r[key]] = r['sha256']
    return out


def validate_baseline(b, fresh=False):
    require(b['publicRoot'] == str(PUBLIC) and b['beforeHtmlSha256'] == BEFORE_SHA and b['apiPaths'] == API_PATHS and b['api'] == API_SHA, 'FIXED_BASELINE_MISMATCH')
    require(b['allOnline'] is True and b['processCount'] == 12 and b['sharedReleaseActive'] is False and b['environmentValuesExported'] is False and b['databaseAccess'] is False and b['productionRecordWrites'] == 0, 'BASELINE_SCOPE')
    validate_processes(b['processes'])
    require(len(rows_map(b['baselineAssets'], 'relative')) == 114, 'EXACT_114_OLD_ASSETS')
    require(set(rows_map(b['protectedFiles'], 'path')) == PROTECTED, 'PROTECTED_SET')
    stamp = dt.datetime.fromisoformat(b['capturedAtUtc'].replace('Z', '+00:00'))
    require(stamp.tzinfo is not None, 'BASELINE_TIMEZONE')
    if fresh:
        age = (dt.datetime.now(dt.timezone.utc) - stamp).total_seconds()
        require(-30 <= age <= 1800, 'BASELINE_STALE_CAPTURE_AGAIN')
        require(HEX.fullmatch(b.get('coordSha256', '')) and b['homepage']['url'] == HOME and b['homepage']['status'] == 200 and HEX.fullmatch(b['homepage']['sha256']), 'FRESH_COORD_HOME_REQUIRED')


def get(url):
    # No arbitrary endpoint / API / supplier URL accepted, including redirects.
    allowed = url == HOME or url in {ADMIN+r for r in ROUTES} or (url.startswith(ADMIN+'/assets/') and safe(url[len(ADMIN)+1:]))
    require(allowed, 'HTTP_ALLOWLIST')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise RuntimeError('HTTP_REDIRECT_REFUSED')
    request = urllib.request.Request(url, headers={'User-Agent': 'phase1-static-release', 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity'})
    with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
        body = response.read()
        require(response.status == 200, 'HTTP_NOT_200')
        return {'url': url, 'status': response.status, 'sha256': digest(body), 'contentType': response.headers.get('Content-Type', '')}, body


def verify_http_asset(relative, expected):
    record, body = get(ADMIN+'/'+relative)
    require(record['sha256'] == expected and 'text/html' not in record['contentType'].lower() and not re.match(br'\s*(?:<!doctype\s+html|<html|<head|<body)', body, re.I), 'ASSET_HTTP_SHA_OR_HTML')
    return record


def check_files(b):
    for r in b['protectedFiles']:
        require(sha(regular(Path(r['path']).parent, Path(r['path']).name)) == r['sha256'], 'PROTECTED_CHANGED')
    for r in b['baselineAssets']:
        require(sha(regular(PUBLIC, r['relative'])) == r['sha256'], 'OLD_ASSET_CHANGED')
    require({k: sha(regular(Path(p).parent, Path(p).name)) for k, p in API_PATHS.items()} == API_SHA, 'API_BYTES_CHANGED')


def cas_coord(expected, replacement):
    require(sha(COORD) == expected, 'COORD_FRESH_CAS_FAILED')
    save(COORD, replacement)
    return sha(COORD)


def owned(state, record):
    window = state.get('window', {})
    return state.get('shared_release_active') is True and all(window.get(k) == record.get(k) for k in ('owner_task', 'attempt', 'manifestSha256', 'openedAtUtc'))


def close_window(record, status, extra=None):
    current_sha = sha(COORD)
    state = load(COORD)
    require(owned(state, record), 'OWNED_WINDOW_LOST')
    final = dict(state['window'], status=status, closedAtUtc=now(), **(extra or {}))
    state.update(shared_release_active=False, window=final)
    state.setdefault('window_history', []).append(final)
    cas_coord(current_sha, state)
    return final


def rollback_owned(root, m, record):
    # A foreign window (even same task, another attempt) must never be touched.
    if not owned(load(COORD), record):
        return False
    target = regular(PUBLIC, 'index.html')
    if sha(target) != m['htmlSha256'] or sha(regular(root, 'index-before.html')) != m['beforeHtmlSha256']:
        return False
    require(owned(load(COORD), record), 'ROLLBACK_OWNER_CHANGED')
    atomic(target, (root/'index-before.html').read_bytes())
    return True


def validate_proofs(front, qa, files):
    require(front.get('status') == 'PASS' and all(front.get(k) is True for k in FRONT_FLAGS) and front['files'] == files, 'FRONTEND_PROOF')
    require(qa.get('status') == 'PASS' and qa['failed'] == 0 and type(qa['passed']) is int and qa['passed'] > 0 and len(qa['checks']) == qa['passed'] and all(c['status'] == 'PASS' for c in qa['checks']), 'ACTUAL_CANDIDATE_QA')
    zero = qa['zeroIO']
    require(zero['network'] == zero['database'] == zero['nativeMutations'] == 0 and zero['browser'] is False and zero['ssh'] is False, 'OFFLINE_QA_ONLY')
    require(front.get('phase') == 'ui-only' and front.get('referenceFetchDisabled') is True and front.get('noNewReferenceTransport') is True and front.get('typeOnlyDependencies') == {}, 'PHASE1_STATIC_PROOF_REQUIRED')
    require(qa['passed'] == 9 and front['actualCandidateQA']['passed'] == 9 and front['actualCandidateQA']['failed'] == 0, 'NINE_ACTUAL_CANDIDATE_CHECKS')


def additional_dependency_pins(m, baseline):
    dependencies = m['dependencies']
    require(isinstance(dependencies, list) and 0 < len(dependencies) <= 512 and len(dependencies) == len(set(dependencies)), 'DEPENDENCY_LIST')
    for url in dependencies:
        require(isinstance(url, str) and url.startswith('/assets/'), 'DEPENDENCY_ASSET_PREFIX')
        safe(url.lstrip('/'))
    rows = m.get('dependencyFiles', [])
    extra = rows_map(rows, 'relative') if rows else {}
    known = {r['relative'] for r in baseline['baselineAssets']} | {r['relative'] for r in m['files'] if r['relative'] != 'index.html'}
    require(set(extra).isdisjoint(known) and set(dependencies) <= {'/'+r for r in known | set(extra)} and all('/'+r in dependencies for r in extra), 'DEPENDENCY_FILE_SCOPE')
    return extra


def check_dependency_files(m):
    for row in m.get('dependencyFiles', []):
        require(sha(regular(PUBLIC, row['relative'])) == row['sha256'], 'OLD_NATIVE_DEPENDENCY_CHANGED')


def package(root, expected_sha):
    root = Path(root)
    manifest_path = regular(root, 'manifest.json')
    mh = sha(manifest_path)
    require(mh == expected_sha, 'MANIFEST_EXTERNAL_SHA_REQUIRED')
    m = load(manifest_path)
    require(m['schema'] == 1 and m['phase'] == 'phase1-static-navigation-reference-ui' and m['ownerTask'] == TASK and m['opsRoot'] == str(ROOT), 'MANIFEST_SCOPE')
    require(m['publicRoot'] == str(PUBLIC) and m['beforeHtmlSha256'] == BEFORE_SHA, 'MANIFEST_TARGET')
    require(re.fullmatch(r'[0-9a-f]{40}', m['sourceCommit']) and m['sourceBranch'] == 'main', 'SOURCE_COMMIT')
    files = m['files']
    require(len(files) == 5 and len({r['relative'] for r in files}) == 5, 'EXACT_FIVE_FILES')
    assets = [r['relative'] for r in files if r['relative'] != 'index.html']
    require(len(assets) == 4 and all(safe(p).parts[0] == 'assets' for p in assets) and sum(p.endswith('.js') for p in assets) == 3 and sum(p.endswith('.css') for p in assets) == 1, 'EXACT_3JS_1CSS')
    require('index.html' in {r['relative'] for r in files}, 'HTML_REQUIRED')
    for r in files:
        require(set(r) == {'relative', 'sha256'} and sha(regular(root/'candidate', r['relative'])) == r['sha256'], 'CANDIDATE_CHANGED')
    require(m['htmlSha256'] == next(r['sha256'] for r in files if r['relative'] == 'index.html'), 'HTML_SHA')
    for name, expected in m['packageHashes'].items():
        require(sha(regular(root, name)) == expected, 'PACKAGE_CHANGED_'+name)
    require(m['packageHashes']['static-release.py'] == sha(Path(__file__)), 'DRIVER_CHANGED')
    required = {'static-release.py', 'prepare-static.py', 'baseline.json', 'index-before.html', 'source-pins.json', 'git-source-receipt.json', 'evidence/frontend-proof.json', 'evidence/native-tests.json'}
    require(required <= set(m['packageHashes']), 'MISSING_PACKAGE_BINDING')
    snapshot = m['sourceHashes']
    require(len(snapshot) >= 100 and set(snapshot) == set(m['sourceBlobIds']), 'SOURCE_UNION')
    for name, h in snapshot.items():
        data = regular(root/'source-snapshot', name).read_bytes()
        require(digest(data) == h and hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest() == m['sourceBlobIds'][name], 'SNAPSHOT_OR_BLOB_CHANGED')
        require(m['packageHashes']['source-snapshot/'+name] == h, 'SNAPSHOT_NOT_PACKAGE_BOUND')
    pins = load(root/'source-pins.json')
    require(all(snapshot.get(k) == v for k, v in pins['sourceHashes'].items()), 'SOURCE_PINS_RECEIPT_MISMATCH')
    receipt = load(root/'git-source-receipt.json')
    require(receipt['status'] == 'PREPARED_GIT_SOURCE_MATCH' and receipt['sourceCommit'] == receipt['gitCommit'] == m['sourceCommit'] and receipt['branch'] == 'main' and receipt['sourceHashes'] == snapshot and receipt['sourceBlobIds'] == m['sourceBlobIds'] and receipt['files'] == files, 'GIT_RECEIPT_BINDING')
    baseline = load(root/'baseline.json')
    validate_baseline(baseline)
    require(sha(root/'index-before.html') == BEFORE_SHA and set(assets).isdisjoint(rows_map(baseline['baselineAssets'], 'relative')), 'ADDITIVE_SCOPE')
    extra = additional_dependency_pins(m, baseline)
    if extra:
        require('evidence/dependency-resolution-proof.json' in m['packageHashes'], 'OLD_DEPENDENCY_PROOF_REQUIRED')
        dependency_proof = load(root/'evidence/dependency-resolution-proof.json')
        for relative, h in extra.items():
            require({r['capturedNativeSha256'] for r in dependency_proof['checks'] if r['resolved'] == '/'+relative} == {h}, 'OLD_DEPENDENCY_PROOF_SHA')
    front, qa = load(root/'evidence/frontend-proof.json'), load(root/'evidence/native-tests.json')
    require(front['actualCandidateQA']['reportSha256'] == sha(root/'evidence/native-tests.json'), 'RAW_QA_SHA')
    validate_proofs(front, qa, files)
    require(front['sourceHashes'] == pins['sourceHashes'] and front['beforeHtmlSha256'] == BEFORE_SHA, 'FRONT_SOURCE_BINDING')
    return m, baseline, mh


def capture(contract):
    b = load(contract)
    validate_baseline(b)
    with locks():
        coord_sha = sha(COORD)
        require(load(COORD).get('shared_release_active') is False, 'FOREIGN_COORD_ACTIVE')
        check_files(b)
        require(sha(regular(PUBLIC, 'index.html')) == BEFORE_SHA, 'CAPTURE_HTML_CAS')
        rows = processes()
        validate_processes(rows)
        require(rows == b['processes'], 'CAPTURE_PROCESS_DRIFT')
        homepage, _ = get(HOME)
        for route in ROUTES:
            require(get(ADMIN+route)[0]['sha256'] == BEFORE_SHA, 'CAPTURE_ROUTE_SHA')
        require(processes() == rows and sha(COORD) == coord_sha, 'CAPTURE_CHANGED')
        check_files(b)
        fields = ('beforeHtmlSha256', 'api', 'apiPaths', 'publicRoot', 'allOnline', 'processCount', 'sharedReleaseActive', 'baselineAssets', 'protectedFiles', 'productionRecordWrites', 'databaseAccess', 'environmentValuesExported', 'sourceReceiptPath')
        sanitized = {k: b[k] for k in fields if k in b}
        return dict(sanitized, capturedAtUtc=now(), coordSha256=coord_sha, homepage=homepage, processes=rows)


def final_checks(root, m, b):
    require(sha(regular(PUBLIC, 'index.html')) == m['htmlSha256'], 'FINAL_HTML_CAS')
    assets = [verify_http_asset(r['relative'], r['sha256']) for r in m['files'] if r['relative'] != 'index.html']
    routes = []
    for route in ROUTES:
        r, _ = get(ADMIN+route)
        require(r['sha256'] == m['htmlSha256'], 'ROUTE_HTML_SHA')
        routes.append(r)
    home, _ = get(HOME)
    require(home['sha256'] == b['homepage']['sha256'], 'HOMEPAGE_CHANGED')
    # Filesystem hash as well as public hash, old assets and protected/API files.
    for r in m['files']:
        require(sha(regular(PUBLIC, r['relative'])) == r['sha256'], 'LIVE_CANDIDATE_CHANGED')
    check_files(b)
    check_dependency_files(m)
    rows = processes()
    validate_processes(rows)
    require(rows == b['processes'], 'ANY_PROCESS_CHANGED')
    return {'publicAssets': assets, 'routes': routes, 'homepage': home, 'processes': rows}


def apply(root, m, b, mh):
    root = Path(root)
    record = {'owner_task': TASK, 'attempt': uuid.uuid4().hex, 'manifestSha256': mh, 'openedAtUtc': now(), 'status': 'activating', 'scope': m['phase']}
    opened = committed = False
    with locks():
        try:
            checked_m, checked_b, _ = package(root, mh)
            require(checked_m == m and checked_b == b, 'PACKAGE_PREFLIGHT_CHANGED')
            validate_baseline(b, fresh=True)
            require(not (root/'verified.json').exists(), 'ALREADY_VERIFIED_USE_VERIFY')
            require(sha(COORD) == b['coordSha256'] and load(COORD).get('shared_release_active') is False, 'COORD_BASELINE_CAS')
            require(sha(regular(PUBLIC, 'index.html')) == BEFORE_SHA, 'BASELINE_HTML_CAS')
            require(processes() == b['processes'], 'BASELINE_PROCESS_CAS')
            check_files(b)
            check_dependency_files(m)
            require(get(HOME)[0]['sha256'] == b['homepage']['sha256'], 'HOME_BASELINE_CAS')
            for route in ROUTES:
                require(get(ADMIN+route)[0]['sha256'] == BEFORE_SHA, 'ROUTE_BASELINE_CAS')
            for r in m['files']:
                if r['relative'] != 'index.html':
                    target = PUBLIC/safe(r['relative'])
                    require(len(safe(r['relative']).parts) == 2 and target.parent.is_dir() and not target.parent.is_symlink() and not target.is_symlink(), 'ASSET_PARENT_OR_SYMLINK')
                    if target.exists():
                        require(sha(regular(PUBLIC, r['relative'])) == r['sha256'], 'ASSET_OVERWRITE_REFUSED')
            state = load(COORD)
            require(sha(regular(PUBLIC, 'index.html')) == BEFORE_SHA and processes() == b['processes'], 'OPEN_FINAL_BASELINE_CAS')
            state.update(shared_release_active=True, window=record)
            opened = True
            cas_coord(b['coordSha256'], state)
            for r in m['files']:
                if r['relative'] != 'index.html':
                    require(owned(load(COORD), record), 'ASSET_OWNER_LOST')
                    target = PUBLIC/safe(r['relative'])
                    if not target.exists():
                        # Link a fully flushed temp inode, never overwrite an existing name.
                        fd, temp = tempfile.mkstemp(prefix='.static-phase1-', dir=target.parent)
                        try:
                            data = regular(root/'candidate', r['relative']).read_bytes()
                            require(digest(data) == r['sha256'], 'CANDIDATE_ASSET_CHANGED')
                            with os.fdopen(fd, 'wb') as stream:
                                stream.write(data)
                                stream.flush()
                                os.fsync(stream.fileno())
                            os.chmod(temp, 0o644)
                            os.link(temp, target)
                        finally:
                            os.unlink(temp)
                    require(sha(regular(PUBLIC, r['relative'])) == r['sha256'], 'ADDED_ASSET_CHANGED')
                    verify_http_asset(r['relative'], r['sha256'])
            require(owned(load(COORD), record) and sha(regular(PUBLIC, 'index.html')) == BEFORE_SHA and processes() == b['processes'], 'HTML_LAST_CAS')
            check_files(b)
            check_dependency_files(m)
            data = regular(root/'candidate', 'index.html').read_bytes()
            require(digest(data) == m['htmlSha256'], 'CANDIDATE_HTML_CHANGED')
            atomic(PUBLIC/'index.html', data)
            checks = final_checks(root, m, b)
            require(package(root, mh)[:2] == (m, b), 'PACKAGE_CHANGED_DURING_APPLY')
            require(owned(load(COORD), record), 'VERIFY_OWNER_LOST')
            receipt = {'status': 'verified', 'atUtc': now(), 'ownerTask': TASK, 'attempt': record['attempt'], 'manifestSha256': mh, 'htmlSha256': m['htmlSha256'], 'sourceCommit': m['sourceCommit'], 'sourceReceiptSha256': m['packageHashes']['git-source-receipt.json'], 'sourcePinsSha256': m['packageHashes']['source-pins.json'], 'backendChanges': 0, 'databaseOperations': 0, 'processReloads': 0, 'productionRecordWrites': 0, 'loggedInBrowserAcceptancePerformed': False, **checks}
            save(root/'verified.json', receipt)
            close_window(record, 'verified', {'receipt': str(root/'verified.json'), 'verifiedSha256': sha(root/'verified.json'), 'sourceReceiptSha256': receipt['sourceReceiptSha256']})
            committed = True
            return receipt
        except BaseException:
            if opened and not committed:
                restored = rollback_owned(root, m, record)
                if owned(load(COORD), record):
                    close_window(record, 'failed', {'exactHtmlRollback': restored})
            raise


def verify(root, m, b, mh):
    with locks():
        checked_m, checked_b, _ = package(root, mh)
        require(checked_m == m and checked_b == b, 'VERIFY_PACKAGE_CHANGED')
        coord_sha = sha(COORD)
        state, receipt = load(COORD), load(regular(root, 'verified.json'))
        w = state.get('window', {})
        require(state.get('shared_release_active') is False and w.get('status') == receipt.get('status') == 'verified' and w.get('owner_task') == TASK and w.get('attempt') == receipt.get('attempt') and w.get('manifestSha256') == receipt.get('manifestSha256') == mh and w.get('verifiedSha256') == sha(root/'verified.json'), 'FINAL_COORD_RECEIPT_MISMATCH')
        require(receipt['sourceCommit'] == m['sourceCommit'] and receipt['sourceReceiptSha256'] == w['sourceReceiptSha256'] == m['packageHashes']['git-source-receipt.json'] and receipt['sourcePinsSha256'] == m['packageHashes']['source-pins.json'] and receipt['htmlSha256'] == m['htmlSha256'], 'FINAL_SOURCE_RECEIPT_MISMATCH')
        final_checks(root, m, b)
        require(package(root, mh)[:2] == (m, b), 'PACKAGE_CHANGED_DURING_VERIFY')
        require(sha(COORD) == coord_sha, 'VERIFY_COORD_CHANGED')
        return {'status': 'verified', 'readOnly': True, 'manifestSha256': mh, 'sourceCommit': m['sourceCommit'], 'processReloads': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--capture', action='store_true')
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--verify', action='store_true')
    parser.add_argument('--baseline-contract', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--package', type=Path, default=ROOT)
    parser.add_argument('--manifest-sha')
    args = parser.parse_args()
    if args.capture:
        require(args.baseline_contract and args.output, 'CAPTURE_CONTRACT_AND_OUTPUT_REQUIRED')
        require(not args.output.resolve().is_relative_to(PUBLIC) and args.output.resolve() != COORD, 'CAPTURE_OUTPUT_PRODUCTION_REFUSED')
        result = capture(args.baseline_contract)
        save(args.output, result)
        print(json.dumps({'status': 'captured', 'output': str(args.output), 'processCount': 12, 'baselineAssets': 114, 'environmentValuesExported': False}))
        return
    require(args.manifest_sha and HEX.fullmatch(args.manifest_sha), 'PIN_MANIFEST_SHA_OUT_OF_BAND')
    m, b, mh = package(args.package, args.manifest_sha)
    if args.apply or args.verify:
        require(args.package.resolve() == ROOT and Path(__file__).resolve() == ROOT/'static-release.py', 'LIVE_OPS_ROOT_REQUIRED')
    result = apply(args.package, m, b, mh) if args.apply else verify(args.package, m, b, mh) if args.verify else {'planOnly': True, 'productionReads': 0, 'productionWrites': 0, 'files': 5, 'backendChanges': 0, 'databaseOperations': 0, 'processReloads': 0, 'sourceCommit': m['sourceCommit'], 'manifestSha256': mh}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never log raw pm2 output or environment values.
        print(json.dumps({'status': 'failed', 'reason': str(error)}, ensure_ascii=False))
        raise SystemExit(1)
