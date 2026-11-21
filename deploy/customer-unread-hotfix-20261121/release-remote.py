#!/usr/bin/env python3
"""Bound customer unread static-only hotfix release. Run remotely only after a separate authorized handoff.

Input: one pre-staged root:root 0600 regular file, never stdin. No SSH or DB client.
Front HTML, both API entries and all runtime files are exact no-ops. No PM2 reload.
"""
import base64
import datetime
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SCOPE = 'customer-unread-hotfix-20261121-2353'
OWNER = 'ebvPYDkJVIW0yJK27DsOEU'
STAGE = '/opt/ops/' + SCOPE
COORD = '/opt/ops/51-project-release-coordination-20261027.json'
LOCKS = ['/var/lock/dianzi51-public-deploy.lock',
         '/var/lock/dianzi51-production-code.lock']
RELEASE = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317'
ROOTS = {
    'front': '/opt/releases/20261031-homepage-banner-v39/front/dist/public',
    'admin': '/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public',
}
TARGETS = {
    ROOTS['front'] + '/index.html': ('front', 'html'),
    ROOTS['admin'] + '/index.html': ('admin', 'html'),
    RELEASE + '/front/dist/index.js': ('front', 'api'),
    RELEASE + '/admin/dist/index.js': ('admin', 'api'),
}
GROUPS = {'front': 'dianzi51', 'admin': 'dianzi51-admin'}
ORIGINS = {'front': 'https://51dianzi.com', 'admin': 'https://admin.51dianzi.com'}
STAT_KEYS = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink',
             'st_size', 'st_atime_ns', 'st_mtime_ns', 'st_ctime_ns')
SHA_PATTERN = r'[a-f0-9]{64}'
INPUT_PATTERN = r'/opt/ops/\.customer-unread-hotfix-input-([a-f0-9]{32})\.json'
RUNTIME_PATTERN = (re.escape(RELEASE + '/admin/runtime/') +
                   r'newInformation\.admin\.([a-f0-9]{64})\.runtime\.mjs')
MAX_PAYLOAD = 256 * 1024 * 1024


def H(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def need(ok, message):
    if not ok:
        raise RuntimeError(message)


def emit(event, **kw):
    # A lost SSH stdout must not skip recovery or accidentally close a live window.
    try:
        print(json.dumps(dict(event=event, at=now(), **kw), ensure_ascii=False), flush=True)
    except (BrokenPipeError, OSError):
        pass  # The durable stage/coord/receipt, not the transport, is authoritative.


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def no_duplicates(pairs):
    obj = {}
    for key, value in pairs:
        need(key not in obj, 'DUPLICATE_JSON_KEY')
        obj[key] = value
    return obj


def json_load(data):
    return json.loads(data, object_pairs_hook=no_duplicates)


def meta(st):
    return tuple(getattr(st, key) for key in STAT_KEYS)


def ownership_meta(st):
    # Public GETs and Node can access the inode. No field other than atime is waived.
    return tuple(getattr(st, key) for key in STAT_KEYS if key != 'st_atime_ns')


def stat_record(st):
    return {key: getattr(st, key) for key in STAT_KEYS}


def safe_path(path):
    # Ubuntu's verified /var/lock -> ../run/lock directory alias is the only
    # exception. Final lock files remain O_NOFOLLOW and fstat/inode protected.
    if path in LOCKS:
        need(os.path.realpath('/var/lock') == '/run/lock' and
             os.path.realpath(path) == '/run/lock/' + os.path.basename(path),
             'SYSTEM_LOCK_ALIAS_DRIFT ' + path)
        return
    need(isinstance(path, str) and path.startswith('/') and
         os.path.normpath(path) == path and os.path.realpath(path) == path,
         'PATH_ALIAS_OR_NONCANONICAL ' + str(path))


def read(path):
    safe_path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    try:
        st = os.fstat(fd)
        need(stat.S_ISREG(st.st_mode) and st.st_nlink == 1,
             'SINGLE_LINK_REGULAR_REQUIRED ' + path)
        chunks = []
        while True:
            part = os.read(fd, 1024 * 1024)
            if not part:
                break
            chunks.append(part)
        last = os.fstat(fd)
        current = os.stat(path, follow_symlinks=False)
        need(meta(st) == meta(last) == meta(current), 'READ_DRIFT ' + path)
        data = b''.join(chunks)
        need(len(data) == st.st_size, 'READ_SIZE_DRIFT ' + path)
        return data, st
    finally:
        os.close(fd)


def fsync_dir(path):
    safe_path(path)
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def durable(path, data, mode=0o600):
    safe_path(os.path.dirname(path))
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, mode)
        view = memoryview(data)
        while view:
            count = os.write(fd, view)
            need(count > 0, 'SHORT_DURABLE_WRITE')
            view = view[count:]
        os.fsync(fd)
    finally:
        os.close(fd)
    fsync_dir(os.path.dirname(path))


def check_locks():
    need(len(fds) == 2, 'TWO_LOCKS_REQUIRED')
    for path, fd in zip(LOCKS, fds):
        safe_path(path)
        a = os.stat(path, follow_symlinks=False)
        b = os.fstat(fd)
        need(stat.S_ISREG(a.st_mode) and a.st_nlink == 1 and
             (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino), 'LOCK_INODE_DRIFT')


def target_cas(path, data, expected):
    check_locks()
    current, st = read(path)
    need(current == data and meta(st) == meta(expected), 'FULL_TARGET_CAS ' + path)


def private_temp(data, template=None, mode=0o644):
    global serial
    serial += 1
    tmp = STAGE + '/.prepared-' + m['nonce'] + '-' + str(serial)
    durable(tmp, data)
    fd = os.open(tmp, os.O_RDONLY | os.O_NOFOLLOW | os.O_NOATIME)
    try:
        if template is not None:
            os.fchown(fd, template.st_uid, template.st_gid)
            os.fchmod(fd, stat.S_IMODE(template.st_mode))
            os.utime(fd, ns=(template.st_atime_ns, template.st_mtime_ns))
        else:
            os.fchown(fd, 0, 0)
            os.fchmod(fd, mode)
        os.fsync(fd)
        prepared = os.fstat(fd)
    finally:
        os.close(fd)
    return tmp, prepared


def atomic(path, data, template, expected_data, expected_stat):
    """Prepare privately, then full bytes+metadata CAS immediately before rename."""
    global coord_owned_data, coord_owned_stat
    check_locks()
    safe_path(os.path.dirname(path))
    tmp, prepared = private_temp(data, template)
    need(prepared.st_dev == os.stat(os.path.dirname(path)).st_dev,
         'PRIVATE_STAGE_CROSS_DEVICE ' + path)
    target_cas(path, expected_data, expected_stat)
    os.replace(tmp, path)
    # Witness/record ownership BEFORE durability checks, so failed fsync is recoverable.
    witnessed = os.stat(path, follow_symlinks=False)
    good = ((witnessed.st_dev, witnessed.st_ino, witnessed.st_size) ==
            (prepared.st_dev, prepared.st_ino, prepared.st_size))
    if path in TARGETS:
        owned_metas[path] = witnessed if good else prepared
        if good and TARGETS[path][1] == 'api':
            api_touched.add(TARGETS[path][0])
    elif path == COORD:
        coord_owned_data = data
        coord_owned_stat = witnessed if good else prepared
    need(good, 'REPLACED_INODE_WITNESS ' + path)
    fsync_dir(STAGE)
    fsync_dir(os.path.dirname(path))
    verify_data, verify_stat = read(path)
    need(verify_data == data and meta(verify_stat) == meta(witnessed),
         'ATOMIC_DURABLE_VERIFY ' + path)


def coord_write(value):
    atomic(COORD, encoded(value), coord_template, coord_owned_data, coord_owned_stat)


def immutable_install(path, data, sha):
    """Never replace: link fully fsynced private inode into final name, then unlink temp."""
    check_locks()
    safe_path(os.path.dirname(path))
    if os.path.lexists(path):
        need(H(read(path)[0]) == sha, 'IMMUTABLE_COLLISION ' + path)
        return False
    tmp, prepared = private_temp(data)
    need(prepared.st_dev == os.stat(os.path.dirname(path)).st_dev,
         'PRIVATE_STAGE_CROSS_DEVICE ' + path)
    check_locks()
    try:
        os.link(tmp, path, follow_symlinks=False)
    except FileExistsError:
        # Another creator is acceptable only if the complete immutable bytes match.
        need(H(read(path)[0]) == sha, 'IMMUTABLE_RACING_COLLISION ' + path)
        os.unlink(tmp)
        fsync_dir(STAGE)
        return False
    os.unlink(tmp)
    fsync_dir(STAGE)
    fsync_dir(os.path.dirname(path))
    need(H(read(path)[0]) == sha, 'IMMUTABLE_DURABLE_VERIFY ' + path)
    return True


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = urllib.request.build_opener(NoRedirect())


def public_get(origin, url, allowed_status=(200,)):
    need(origin in ORIGINS.values() and url.startswith('/') and not url.startswith('//'),
         'PUBLIC_GET_SCOPE')
    request = urllib.request.Request(origin + url, method='GET', headers={
        'User-Agent': 'Mozilla/5.0', 'Referer': origin + '/',
        'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity',
    })
    try:
        response = HTTP.open(request, timeout=25)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        body = response.read()
        need(response.code in allowed_status and response.geturl() == origin + url,
             'PUBLIC_HTTP ' + url)
        need(response.headers.get('Content-Encoding', 'identity') == 'identity',
             'PUBLIC_UNEXPECTED_ENCODING ' + url)
        return body, {'url': origin + url, 'method': 'GET', 'status': response.code,
                      'sha256': H(body), 'size': len(body), 'authenticated': False}


def public_list():
    query = urllib.parse.quote(json.dumps({'json': {
        'query': 'STM32', 'pricedOnly': False, 'sort': 'recent', 'limit': 1, 'offset': 0,
    }}, separators=(',', ':')))
    body, row = public_get(ORIGINS['front'], '/api/trpc/factoryChannel.list?input=' + query)
    obj = json_load(body)
    need(isinstance(obj, dict) and 'result' in obj and 'error' not in obj,
         'PUBLIC_LIST_NOT_AVAILABLE')
    row['check'] = 'factoryChannel.list read-only'
    ledger.append(row)


def public_unread_unauth():
    route = 'newInformation.unreadRefs'
    query = urllib.parse.quote('{"json":{"module":"customers"}}')
    body, row = public_get(ORIGINS['admin'], '/api/trpc/' + route + '?input=' + query,
                           (401, 403))
    obj = json_load(body)
    error = obj.get('error', {}) if isinstance(obj, dict) else {}
    detail = error.get('json', error)
    info = detail.get('data', {}) if isinstance(detail, dict) else {}
    need(info.get('code') in ('UNAUTHORIZED', 'FORBIDDEN') and
         info.get('httpStatus') == row['status'] and info.get('path') == route,
         'UNREAD_REFS_UNAUTH_GATE_NOT_OBSERVED')
    row['check'] = 'newInformation.unreadRefs unauthenticated read-only auth gate only'
    row['notFunctionalUnreadValidation'] = True
    ledger.append(row)


def processes():
    command = subprocess.run(['pm2', 'jlist'], capture_output=True, timeout=25, check=True)
    return [{'name': x.get('name'), 'pid': x.get('pid'),
             'id': x.get('pm_id', x.get('pm2_env', {}).get('pm_id')),
             'status': x.get('pm2_env', {}).get('status'),
             'entry': x.get('pm2_env', {}).get('pm_exec_path')}
            for x in json_load(command.stdout) if x.get('name') in GROUPS.values()]


def check_processes(before_processes=None, changed_sides=()):
    current = processes()
    need(len(current) == 6, 'API_PROCESS_COUNT_DRIFT')
    for side, count in [('front', 4), ('admin', 2)]:
        name = GROUPS[side]
        group = [x for x in current if x['name'] == name]
        need(len(group) == count, 'API_GROUP_COUNT_DRIFT ' + name)
        expected = RELEASE + '/' + side + '/dist/index.js'
        need(all(x['status'] == 'online' and isinstance(x['pid'], int) and
                 x['pid'] > 0 and x['entry'] == expected for x in group),
             'API_GROUP_NOT_ONLINE ' + name)
    ids = [x['id'] for x in current]
    need(all(isinstance(i, int) for i in ids) and len(set(ids)) == len(ids),
         'API_PROCESS_IDS_INVALID')
    if before_processes is not None:
        prior = {x['id']: x for x in before_processes}
        need(set(prior) == set(ids), 'API_PROCESS_IDS_DRIFT')
        need(all(prior[x['id']]['name'] == x['name'] for x in current),
             'API_PROCESS_GROUP_ID_DRIFT')
        names = {GROUPS[side] for side in changed_sides}
        need(all(prior[x['id']]['pid'] != x['pid'] for x in current if x['name'] in names),
             'CHANGED_API_RELOAD_NOT_OBSERVED')
    return current


def reload_apis(sides, phase):
    for side in ('front', 'admin'):
        if side not in sides:
            continue
        name = GROUPS[side]
        reload_ledger.append({'name': name, 'phase': phase, 'startedAtUtc': now(),
                              'completed': False})
        emit('API_RELOAD_START', name=name, phase=phase)
        command = subprocess.run(['pm2', 'reload', name], capture_output=True, timeout=180)
        need(command.returncode == 0, 'API_RELOAD_FAILED ' + name)
        reload_ledger[-1].update(completed=True, completedAtUtc=now())
        emit('API_RELOAD_COMPLETE', name=name, phase=phase)


def dependency_check():
    check_locks()
    for dep in m['existingFiles']:
        need(H(read(dep['path'])[0]) == dep['sha256'],
             'EXISTING_DEPENDENCY_DRIFT ' + dep['path'])


def verify_targets(expected):
    for target in m['targets']:
        path = target['path']
        data, st = read(path)
        need(H(data) == target[expected], 'TARGET_VERIFY ' + path)
        exact = after[path] if expected == 'afterSHA' else before[path]
        need(data == exact, 'TARGET_EXACT_BYTES_VERIFY ' + path)
        original = metas[path]
        need(all(getattr(st, key) == getattr(original, key) for key in
                 ('st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_mtime_ns')) and
             st.st_size == len(exact), 'TARGET_TEMPLATE_METADATA_VERIFY ' + path)
        # No-op targets must keep their original inode and metadata (except atime).
        if before[path] == after[path]:
            need(ownership_meta(st) == ownership_meta(metas[path]),
                 'UNCHANGED_TARGET_INODE_DRIFT ' + path)
    dependency_check()
    check_processes()
    public_list()
    for side, urls in [('front', ['/', '/search']), ('admin', ['/'])]:
        html = next(t for t in m['targets'] if t['side'] == side and t['kind'] == 'html')
        exact = after[html['path']] if expected == 'afterSHA' else before[html['path']]
        for url in urls:
            body, row = public_get(ORIGINS[side], url)
            need(H(body) == html[expected] and body == exact, 'PUBLIC_HTML_FULL_PIN ' + side + url)
            ledger.append(row)


def validate_sha(value, label):
    need(isinstance(value, str) and re.fullmatch(SHA_PATTERN, value) is not None,
         'SHA256_REQUIRED ' + label)


def decode_pin(value, sha, size, label):
    validate_sha(sha, label)
    need(type(size) is int and 0 <= size <= MAX_PAYLOAD, 'SIZE_REQUIRED ' + label)
    need(isinstance(value, str), 'BASE64_STRING_REQUIRED ' + label)
    data = base64.b64decode(value, validate=True)
    need(H(data) == sha and len(data) == size, 'CANDIDATE_PIN ' + label)
    return data


def load_payload():
    need(os.geteuid() == 0, 'ROOT_REQUIRED')
    need(len(sys.argv) == 2, 'ONE_STAGED_PAYLOAD_ARGUMENT_REQUIRED_NO_STDIN')
    path = sys.argv[1]
    match = re.fullmatch(INPUT_PATTERN, path)
    need(match is not None, 'STAGED_PAYLOAD_PATH_SCOPE')
    safe_path(path)
    st = os.stat(path, follow_symlinks=False)
    need(stat.S_ISREG(st.st_mode) and stat.S_IMODE(st.st_mode) == 0o600 and
         st.st_uid == 0 and st.st_gid == 0 and st.st_nlink == 1 and
         0 < st.st_size <= MAX_PAYLOAD, 'STAGED_PAYLOAD_ROOT_0600_REGULAR_REQUIRED')
    raw, actual = read(path)
    need(meta(st) == meta(actual), 'STAGED_PAYLOAD_METADATA_DRIFT')
    value = json_load(raw)
    need(isinstance(value, dict) and set(value) == {'manifest', 'targets', 'assets', 'runtimes'},
         'PAYLOAD_EXACT_KEYS')
    manifest = value['manifest']
    need(isinstance(manifest, dict) and manifest['scope'] == SCOPE and
         manifest['owner'] == OWNER, 'RELEASE_IDENTITY')
    need(manifest['nonce'] == match.group(1), 'NONCE_PATH_MANIFEST_MISMATCH')
    validate_sha(manifest['coordBeforeSHA'], 'coordBeforeSHA')
    targets = manifest['targets']
    need(isinstance(targets, list) and len(targets) == 4 and
         {t['path'] for t in targets} == set(TARGETS), 'EXACT_FOUR_TARGETS')
    need(isinstance(value['targets'], dict) and set(value['targets']) == set(TARGETS),
         'EXACT_TARGET_BYTES')
    for target in targets:
        path = target['path']
        need((target['side'], target['kind']) == TARGETS[path], 'TARGET_KIND_SIDE_PIN ' + path)
        validate_sha(target['beforeSHA'], path + ' beforeSHA')
        validate_sha(target['afterSHA'], path + ' afterSHA')
        need(path == ROOTS['admin'] + '/index.html' or target['beforeSHA'] == target['afterSHA'],
             'STATIC_ONLY_FRONT_AND_APIS_MUST_BE_UNCHANGED')
        capture = target['beforeStat']
        need(isinstance(capture, dict) and set(capture) == set(STAT_KEYS) and
             all(type(capture[key]) is int for key in STAT_KEYS), 'INITIAL_CAPTURE_FULL_STAT ' + path)
        need(stat.S_ISREG(capture['st_mode']) and capture['st_nlink'] == 1,
             'INITIAL_CAPTURE_REGULAR ' + path)
    assets = manifest['assets']
    need(isinstance(assets, list) and isinstance(value['assets'], dict), 'ASSETS_REQUIRED')
    asset_keys = []
    for asset in assets:
        need(asset['side'] in ROOTS and isinstance(asset['url'], str) and
             re.fullmatch(r'/assets/[A-Za-z0-9_.-]+\.(?:js|css|png)', asset['url']) is not None,
             'ASSET_SCOPE')
        validate_sha(asset['sha256'], 'asset')
        asset_keys.append(asset['side'] + asset['url'])
    need(len(set(asset_keys)) == len(asset_keys) and set(value['assets']) == set(asset_keys),
         'EXACT_ASSET_BYTES')
    runtimes = manifest['runtimes']
    need(runtimes == [] and value['runtimes'] == {}, 'STATIC_ONLY_NO_RUNTIME_CHANGES')
    for runtime in runtimes:
        runtime_match = re.fullmatch(RUNTIME_PATTERN, runtime['path'])
        need(runtime_match is not None and runtime_match.group(1) == runtime['sha256'],
             'RUNTIME_CONTENT_ADDRESS_ALLOWLIST')
    need(value['runtimes'] == {}, 'NO_RUNTIME_BYTES_IN_STATIC_HOTFIX')
    deps = manifest['existingFiles']
    need(isinstance(deps, list) and len({d['path'] for d in deps}) == len(deps),
         'EXISTING_DEPENDENCIES_REQUIRED')
    need(len(deps) > 0, 'EXISTING_DEPENDENCIES_EMPTY')
    for dep in deps:
        path = dep['path']
        validate_sha(dep['sha256'], 'dependency')
        public_dep = any(path.startswith(root + '/assets/') for root in ROOTS.values())
        runtime_dep = any(path.startswith(RELEASE + '/' + side + '/runtime/') and
                          re.fullmatch(r'[A-Za-z0-9_.-]+\.mjs', os.path.basename(path))
                          for side in ROOTS)
        need((public_dep or runtime_dep) and path not in TARGETS and
             os.path.normpath(path) == path, 'EXISTING_DEPENDENCY_SCOPE ' + path)
    return value, manifest, path_input_record(sys.argv[1], H(raw), actual)


def path_input_record(path, sha, st):
    return {'path': path, 'sha256': sha, 'size': st.st_size, 'stat': stat_record(st),
            'source': 'pre-staged SFTP file; not stdin'}


def failurehold(reason):
    """Never clobber foreign coordinator; never voluntarily unlock on ambiguous recovery."""
    global result
    result = 'FAILUREHOLD'
    try:
        if opened and coord_owned_data is not None:
            target_cas(COORD, coord_owned_data, coord_owned_stat)
            value = json_load(coord_owned_data)
            need(value.get('window', {}).get('owner_task') == OWNER or
                 coord_owned_data == coord_before, 'RECOVERY_OWNER_LOST')
            value['shared_release_active'] = True
            value['needsOperatorRecovery'] = True
            value['window'] = dict(value.get('window', {}), status='failurehold',
                                   owner_task=OWNER, scope=SCOPE, result=result,
                                   needsOperatorRecovery=True, recoveryError=str(reason))
            coord_write(value)
            if stage_ready and not os.path.lexists(STAGE + '/failurehold.json'):
                durable(STAGE + '/failurehold.json', encoded(value['window']))
    except BaseException as persist_error:
        try:
            emit('PERSIST_RECOVERY_FLAG_FAILED', message=str(persist_error))
        except BaseException:
            pass
    while True:
        try:
            emit('FAILUREHOLD_LOCKS_RETAINED', result=result, message=str(reason))
            time.sleep(60)
        except BaseException:
            # Broken transport/KeyboardInterrupt must not silently release either lock.
            time.sleep(1)


def remote_check(path, label):
    command = subprocess.run(['node', '--check', path], capture_output=True, timeout=30)
    need(command.returncode == 0, 'REMOTE_NODE_SYNTAX ' + label)


def run_release():
    global opened, stage_ready, result, error, recovered, coord_before
    global coord_template, coord_owned_data, coord_owned_stat
    receipt = None
    try:
        for path in LOCKS:
            safe_path(path)
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BaseException:
                os.close(fd)
                raise
            fds.append(fd)
        check_locks()
        emit('DUAL_LOCKS_ACQUIRED')
        need(not os.path.lexists(STAGE), 'STAGE_ALREADY_EXISTS_NO_REUSE')
        coord_before, coord_template = read(COORD)
        coord_owned_data, coord_owned_stat = coord_before, coord_template
        need(H(coord_before) == m['coordBeforeSHA'], 'FRESH_COORD_BASELINE_DRIFT')
        coord = json_load(coord_before)
        need(coord.get('shared_release_active') is False and not coord.get('needsOperatorRecovery') and
             coord.get('window', {}).get('status') == 'closed' and
             not coord.get('window', {}).get('needsOperatorRecovery'), 'RELEASE_WINDOW_BUSY')
        prior_processes = check_processes()
        for target in m['targets']:
            path = target['path']
            data, st = read(path)
            need(H(data) == target['beforeSHA'], 'INITIAL_CAPTURE_SHA_DRIFT ' + path)
            capture = target['beforeStat']
            # Capture GETs may have advanced atime. CAS below uses ALL lock-read fields.
            need(all(getattr(st, key) == capture[key] for key in STAT_KEYS if key != 'st_atime_ns'),
                 'INITIAL_CAPTURE_STAT_DRIFT ' + path)
            if path != ROOTS['admin'] + '/index.html':
                need(p['targets'][path] is None and target['beforeSHA'] == target['afterSHA'] and target['size'] == len(data), 'STATIC_NOOP_FROM_LOCKED_BYTES')
                candidate = data
            else:
                candidate = decode_pin(p['targets'][path], target['afterSHA'], target['size'], path)
            need(target['beforeSHA'] != target['afterSHA'] or candidate == data,
                 'SAME_SHA_DIFFERENT_BYTES ' + path)
            metas[path], before[path], after[path] = st, data, candidate
        dependency_check()
        for asset in m['assets']:
            key = asset['side'] + asset['url']
            path = ROOTS[asset['side']] + asset['url']
            immutable_data[path] = decode_pin(p['assets'][key], asset['sha256'], asset['size'], key)
            safe_path(os.path.dirname(path))
            if os.path.lexists(path):
                need(H(read(path)[0]) == asset['sha256'], 'IMMUTABLE_ASSET_COLLISION ' + path)
        for runtime in m['runtimes']:
            path = runtime['path']
            immutable_data[path] = decode_pin(p['runtimes'][path], runtime['sha256'], runtime['size'], path)
            safe_path(os.path.dirname(path))
            if os.path.lexists(path):
                need(H(read(path)[0]) == runtime['sha256'], 'IMMUTABLE_RUNTIME_COLLISION ' + path)
            admin_entry = after[RELEASE + '/admin/dist/index.js']
            need(('../runtime/' + os.path.basename(path)).encode() in admin_entry,
                 'ADMIN_ENTRY_NEW_RUNTIME_REFERENCE_REQUIRED')
        public_list()
        os.mkdir(STAGE, 0o700)
        stage_ready = True
        os.chmod(STAGE, 0o700)
        fsync_dir('/opt/ops')
        durable(STAGE + '/manifest.json', encoded(m))
        durable(STAGE + '/input-record.json', encoded(input_record))
        durable(STAGE + '/before-coord.json', coord_before)
        durable(STAGE + '/before-stats.json', encoded({
            path: {'sha256': H(before[path]), 'stat': stat_record(metas[path])}
            for path in TARGETS}))
        for target in m['targets']:
            path = target['path']
            label = target['side'] + '-' + target['kind']
            candidate = STAGE + '/candidate-' + label + ('.mjs' if target['kind'] == 'api' else '.html')
            durable(STAGE + '/before-' + label, before[path])
            durable(candidate, after[path])
            need(read(STAGE + '/before-' + label)[0] == before[path], 'EXACT_BACKUP_VERIFY ' + label)
            if target['kind'] == 'api' and before[path] != after[path]:
                remote_check(candidate, label)
        for runtime in m['runtimes']:
            candidate = STAGE + '/candidate-' + os.path.basename(runtime['path'])
            durable(candidate, immutable_data[runtime['path']])
            remote_check(candidate, 'admin-runtime-candidate')
        # Preflight filesystem affinity avoids a cross-device error after any mutation.
        device = os.stat(STAGE).st_dev
        for path in [COORD] + list(TARGETS) + list(immutable_data):
            need(os.stat(os.path.dirname(path)).st_dev == device, 'PRIVATE_STAGE_CROSS_DEVICE ' + path)
        dependency_check()
        for path in TARGETS:
            target_cas(path, before[path], metas[path])
        opening = dict(coord)
        opening['shared_release_active'] = True
        opening['needsOperatorRecovery'] = False
        opening['window'] = {'status': 'opening', 'owner_task': OWNER, 'scope': SCOPE,
                             'openedAtUtc': now(), 'needsOperatorRecovery': False}
        opened = True  # Conservative mutation-attempt marker, including a failed fsync.
        coord_write(opening)
        emit('WINDOW_OPENED')
        for asset in m['assets']:
            path = ROOTS[asset['side']] + asset['url']
            created = immutable_install(path, immutable_data[path], asset['sha256'])
            immutable_ledger.append({'path': path, 'kind': 'asset', 'sha256': asset['sha256'], 'created': created})
        for runtime in m['runtimes']:
            path = runtime['path']
            created = immutable_install(path, immutable_data[path], runtime['sha256'])
            immutable_ledger.append({'path': path, 'kind': 'runtime', 'sha256': runtime['sha256'], 'created': created})
            remote_check(path, 'installed-admin-runtime')
        emit('IMMUTABLE_DEPENDENCIES_READY', assets=len(m['assets']), runtimes=len(m['runtimes']))
        dependency_check()
        for kind in ('api', 'html'):
            for target in [t for t in m['targets'] if t['kind'] == kind]:
                path = target['path']
                target_cas(path, before[path], metas[path])
                if before[path] == after[path]:
                    emit('TARGET_UNCHANGED_INODE_PRESERVED', side=target['side'], kind=kind,
                         sha256=target['beforeSHA'], inode=metas[path].st_ino)
                    continue
                applied.append(target)
                atomic(path, after[path], metas[path], before[path], metas[path])
                emit(kind.upper() + '_SWAPPED', side=target['side'], sha256=target['afterSHA'])
            if kind == 'api':
                reload_apis(api_touched, 'apply')
                current = check_processes(prior_processes, api_touched)
                process_ledger.append({'phase': 'apply', 'processes': current})
                public_list()
        verify_targets('afterSHA')
        for asset in m['assets']:
            path = ROOTS[asset['side']] + asset['url']
            need(read(path)[0] == immutable_data[path], 'ASSET_REMOTE_FULL_PIN ' + path)
            body, row = public_get(ORIGINS[asset['side']], asset['url'])
            need(H(body) == asset['sha256'] and len(body) == asset['size'] and
                 body == immutable_data[path], 'PUBLIC_ASSET_FULL_PIN ' + asset['url'])
            ledger.append(row)
        for runtime in m['runtimes']:
            need(read(runtime['path'])[0] == immutable_data[runtime['path']], 'RUNTIME_REMOTE_FULL_PIN')
        public_unread_unauth()
        need(not api_touched and not reload_ledger and not m['runtimes'], 'STATIC_NO_API_RELOAD_OR_RUNTIME_CHANGE')
        result = 'VERIFIED'
        emit('PUBLIC_AND_API_VERIFIED', businessTestWrites=0)
    except BaseException as problem:
        error = str(problem)
        emit('ERROR', message=error)
        if opened:
            try:
                check_locks()
                target_cas(COORD, coord_owned_data, coord_owned_stat)
                for target in reversed(applied):
                    path = target['path']
                    current, st = read(path)
                    need(current in (after[path], before[path]), 'RECOVERY_TARGET_FOREIGN_DRIFT ' + path)
                    need(ownership_meta(st) == ownership_meta(owned_metas.get(path, metas[path])),
                         'RECOVERY_INODE_NOT_OWNED ' + path)
                    if current != before[path]:
                        atomic(path, before[path], metas[path], current, st)
                if api_touched:
                    reload_apis(api_touched, 'rollback')
                # Rollback needs online/count/entry consistency, NOT all six changed PIDs.
                current = check_processes()
                process_ledger.append({'phase': 'rollback', 'processes': current})
                verify_targets('beforeSHA')
                recovered = True
                result = 'ROLLED_BACK_VERIFIED'
                emit('EXACT_ROLLBACK_VERIFIED', businessTestWrites=0)
            except BaseException as recovery_error:
                emit('RECOVERY_FAILED', message=str(recovery_error))
                failurehold(recovery_error)
    finally:
        if result != 'FAILUREHOLD':
            try:
                closed = False
                coord_final_sha = None
                if opened:
                    target_cas(COORD, coord_owned_data, coord_owned_stat)
                    closing = json_load(coord_owned_data)
                    window = closing.get('window', {})
                    need(window.get('owner_task') == OWNER or coord_owned_data == coord_before,
                         'COORD_OWNER_LOST_BEFORE_CLOSE')
                    closing['shared_release_active'] = False
                    closing['needsOperatorRecovery'] = False
                    closing['window'] = dict(window, status='closed', owner_task=OWNER, scope=SCOPE,
                                             closedAtUtc=now(), result=result, needsOperatorRecovery=False)
                    coord_write(closing)
                    raw, st = read(COORD)
                    need(raw == coord_owned_data and meta(st) == meta(coord_owned_stat), 'DURABLE_CLOSE_CAS')
                    final = json_load(raw)
                    need(final['shared_release_active'] is False and not final['needsOperatorRecovery'] and
                         final['window']['status'] == 'closed' and final['window']['owner_task'] == OWNER and
                         not final['window']['needsOperatorRecovery'], 'DURABLE_CLOSE_FAILED')
                    closed = True
                    coord_final_sha = H(raw)
                    emit('WINDOW_DURABLY_CLOSED', result=result)
                elif len(fds) == 2 and coord_owned_data is not None:
                    target_cas(COORD, coord_owned_data, coord_owned_stat)
                    final = json_load(coord_owned_data)
                    closed = (final.get('shared_release_active') is False and
                              final.get('window', {}).get('status') == 'closed' and
                              not final.get('needsOperatorRecovery') and
                              not final.get('window', {}).get('needsOperatorRecovery'))
                    coord_final_sha = H(coord_owned_data)
                receipt = {
                    'scope': SCOPE, 'ownerTask': OWNER, 'result': result, 'error': error,
                    'targets': m['targets'], 'assets': m['assets'], 'runtimes': m['runtimes'],
                    'input': input_record, 'publicGETLedger': ledger,
                    'immutableLedger': immutable_ledger, 'processLedger': process_ledger,
                    'businessTestWrites': 0, 'zeroBusinessTestWrites': True,
                    'databaseWriteGuarantee': 'NOT_ASSERTED: application startup/reload may perform database writes',
                    'verificationLimitations': 'unreadRefs is unauthenticated auth-gate GET only; no authenticated unread/markDisplayed tests',
                    'changedTargets': sorted(owned_metas),
                    'attemptedTargets': [t['path'] for t in applied],
                    'unchangedTargets': [path for path in before if before[path] == after[path]],
                    'apiReloadGroups': [GROUPS[side] for side in ('front', 'admin') if side in api_touched],
                    'apiReloadLedger': reload_ledger, 'rollbackVerified': recovered,
                    'backupDirectory': STAGE if stage_ready else None,
                    'windowOpened': opened, 'closed': closed, 'coordFinalSHA': coord_final_sha,
                    'finishedAtUtc': now(),
                }
                if stage_ready:
                    receipt_raw = encoded(receipt)
                    durable(STAGE + '/receipt.json', receipt_raw)
                    need(read(STAGE + '/receipt.json')[0] == receipt_raw, 'DURABLE_RECEIPT_VERIFY')
                    if opened:
                        target_cas(COORD, coord_owned_data, coord_owned_stat)
            except BaseException as close_error:
                emit('CLOSE_OR_RECEIPT_FAILURE', message=str(close_error))
                failurehold(close_error)
            for fd in reversed(fds):
                fcntl.flock(fd, fcntl.LOCK_UN)
                os.close(fd)
            fds.clear()
            emit('DUAL_LOCKS_RELEASED')
            print('RECEIPT ' + json.dumps(receipt, ensure_ascii=False), flush=True)
    return 0 if result == 'VERIFIED' else 1


if __name__ == '__main__':
    # No imports/commands can launch a release; entry point is intentionally explicit.
    try:
        p, m, input_record = load_payload()
    except BaseException as input_error:
        emit('PAYLOAD_REJECTED', message=str(input_error), businessTestWrites=0)
        sys.exit(1)
    fds = []
    opened = False
    stage_ready = False
    serial = 0
    applied = []
    metas, owned_metas, before, after, immutable_data = {}, {}, {}, {}, {}
    ledger, immutable_ledger, process_ledger, reload_ledger = [], [], [], []
    api_touched = set()
    result, error, recovered = 'NOT_APPLIED', None, False
    coord_before = coord_template = coord_owned_data = coord_owned_stat = None
    sys.exit(run_release())
