#!/usr/bin/env python3
"""Customer batch scope: capture/candidate/preflight/apply/verify/rollback.
Stdlib only. No SSH, PM2 CLI, daemon start, env write, DDL or whole-dist copy.
Production execution is exclusively an operator action, never an import side effect.
See README.md for the sealing and independent-review protocol. Offline preparation only.
"""
import argparse
import base64
import copy
import datetime as dt
import fcntl
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
import uuid
from contextlib import contextmanager
from dataclasses import dataclass

OWNER = '6Lfttf6oVWJ8YS69o5FkXQ'
SCOPE = 'customer-batch-actions-20261120-6Lfttf6o-R4'
API_BASE = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317'
FRONT_API = API_BASE + '/front/dist/index.js'
ADMIN_API = API_BASE + '/admin/dist/index.js'
PUBLIC = '/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'
TTL = 900
HEX = re.compile(r'[a-f0-9]{64}')
LIFECYCLE = frozenset({'status', 'pid', 'pm_id', 'pm_uptime', 'created_at',
    'restart_time', 'unstable_restarts', 'axm_actions', 'axm_monitor',
    'axm_dynamic', 'monit', 'vizion_running', 'prev_restart_delay', 'exit_code'})
ACTIVE_LOCKS = []

class ReleaseError(RuntimeError):
    pass

def need(ok, message):
    if not ok:
        raise ReleaseError(message)

def H(data):
    return hashlib.sha256(data).hexdigest()

def encode(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'),
                       allow_nan=False) + '\n').encode('ascii')

def decode(data):
    def pairs(items):
        result = {}
        for k, v in items:
            need(k not in result, 'DUPLICATE_JSON_KEY')
            result[k] = v
        return result
    def finite_float(token):
        value = float(token)
        need(math.isfinite(value), 'NONFINITE_JSON')
        return value
    try:
        return json.loads(data, object_pairs_hook=pairs,
                          parse_float=finite_float,
                          parse_constant=lambda _: need(False, 'NONFINITE_JSON'))
    except (ValueError, UnicodeError, TypeError) as exc:
        raise ReleaseError('INVALID_JSON') from exc

def exact(value, keys, message):
    need(isinstance(value, dict) and set(value) == set(keys.split()), message)

def pin(value):
    need(isinstance(value, str) and HEX.fullmatch(value), 'FULL_SHA256_REQUIRED')
    return value

def integer(v):
    return type(v) is int

def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def fresh(c):
    try:
        t = dt.datetime.fromisoformat(c['capturedAtUtc'])
        need(t.tzinfo is not None, 'TIMEZONE_REQUIRED')
        age = dt.datetime.now(dt.timezone.utc).timestamp() - t.timestamp()
        need(0 <= age <= TTL and c['ttlSeconds'] == TTL, 'FRESH_CAPTURE_REQUIRED')
    except (KeyError, ValueError, TypeError) as exc:
        raise ReleaseError('INVALID_CAPTURE_TIME') from exc

def rel(value):
    need(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9._/-]{1,240}', value)
         and all(p not in ('', '.', '..') for p in value.split('/')), 'UNSAFE_RELATIVE')
    return value

def no_link(path):
    p = Path(path)
    need(p.is_absolute(), 'ABSOLUTE_PATH_REQUIRED')
    for q in (p, *p.parents):
        need(not q.is_symlink(), 'SYMLINK_ESCAPE: ' + str(q))
    return p

def meta(path):
    s = Path(path).lstat()
    return dict(dev=s.st_dev, ino=s.st_ino, statmode=s.st_mode, uid=s.st_uid,
                gid=s.st_gid, nlink=s.st_nlink, size=s.st_size,
                mtimeNs=s.st_mtime_ns, ctimeNs=s.st_ctime_ns)

def regular(path):
    p = no_link(path)
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        need(stat.S_ISREG(before.st_mode), 'REGULAR_FILE_REQUIRED')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read()
        after = os.fstat(fd)
        need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
              before.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_size,
              after.st_mtime_ns, after.st_ctime_ns), 'READ_RACE')
        need(meta(p)['ino'] == after.st_ino, 'READ_RENAME_RACE')
        return data
    finally:
        os.close(fd)

def describe(path):
    p = Path(path)
    s = p.lstat()
    r = meta(p)
    if stat.S_ISLNK(s.st_mode):
        target = p.resolve(strict=True)
        return dict(r, kind='symlink', link=os.readlink(p), target=str(target))
    no_link(p)
    if stat.S_ISREG(s.st_mode):
        return dict(r, kind='file', sha256=H(regular(p)))
    if stat.S_ISDIR(s.st_mode):
        return dict(r, kind='directory')
    if stat.S_ISSOCK(s.st_mode):
        return dict(r, kind='socket')
    raise ReleaseError('SPECIAL_FILE_REFUSED: ' + str(p))

def private(path):
    p = no_link(path)
    m = meta(p)
    need(stat.S_ISDIR(m['statmode']) and m['uid'] == os.geteuid()
         and stat.S_IMODE(m['statmode']) == 0o700, 'PRIVATE_0700_DIRECTORY_REQUIRED')

def fsync_dir(path):
    fd = os.open(no_link(path), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def check_locks():
    for p, fd, record in ACTIVE_LOCKS:
        need(meta(p) == record and os.fstat(fd).st_ino == record['ino'], 'LOCK_META_DRIFT')

def exclusive(path, data, mode=0o600, uid=None, gid=None):
    check_locks()
    p = no_link(path)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        if uid is not None:
            os.fchown(stream.fileno(), uid, gid)
        os.fchmod(stream.fileno(), mode)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    fsync_dir(p.parent)

def cas(path, expected, before, after, scratch, remember):
    """Full-META + full-byte advisory CAS, same FS, ownership preserved.
    remember runs immediately after rename (before directory fsync can fail).
    Cooperative dual locks are essential: rename is not a kernel compare-and-swap.
    """
    check_locks()
    p, scratch = no_link(path), no_link(scratch)
    private(scratch)
    need(describe(p) == expected and regular(p) == before, 'FULL_CAS')
    need(expected['kind'] == 'file' and expected['nlink'] == 1, 'TARGET_SINGLE_REGULAR_ONLY')
    need(meta(scratch)['dev'] == expected['dev'], 'SAME_FS_REQUIRED')
    temp = scratch / ('.cas-' + uuid.uuid4().hex)
    try:
        exclusive(temp, after, stat.S_IMODE(expected['statmode']), expected['uid'], expected['gid'])
        need(describe(p) == expected and regular(p) == before, 'LAST_FULL_CAS')
        check_locks()
        os.replace(temp, p)
        remember(describe(p))
        fsync_dir(p.parent)
        fsync_dir(scratch)
    finally:
        if temp.exists():
            temp.unlink()  # only this newly created private scratch, never assets
            fsync_dir(scratch)

@dataclass(frozen=True)
class Config:
    public: Path = Path(PUBLIC)
    front_api: Path = Path(FRONT_API)
    admin_api: Path = Path(ADMIN_API)
    coord: Path = Path('/opt/ops/51-project-release-coordination-20261027.json')
    stage: Path = Path('/opt/ops/' + SCOPE)
    locks: tuple = (Path('/var/lock/dianzi51-public-deploy.lock'),
                    Path('/var/lock/dianzi51-production-code.lock'))
    nginx: Path = Path('/etc/nginx')
    ops: Path = Path('/opt/ops')
    proc: Path = Path('/proc')
    pm2_home: Path = Path('/root/.pm2')
    pm2_base: Path = Path('/usr/local/lib/node_modules/pm2')
    node: Path = Path('/usr/bin/node-22')
    extra_protected: tuple = (Path('/opt/config/dianzi51-admin/runtime.env'),
                              Path('/opt/config/dianzi51/runtime.env'),
                              Path('/var/lib/dianzi51-private'),
                              Path('/opt/ops/dianzi51-recommendation'),
                              Path('/opt/releases/20261009T170014Z-memory-isolation/dianzi51-platform'))
    extra_links: tuple = ()
    mock: bool = False  # never selectable by CLI

    @property
    def html(self):
        return self.public / 'index.html'

    @property
    def front_alias(self):
        return self.front_api.parent / 'public'

    @property
    def front(self):
        return self.front_alias.resolve(strict=True)

    @property
    def package(self):
        return self.stage / 'package'

    @property
    def receipt(self):
        return self.stage / 'receipt'

    @property
    def apis(self):
        return {'front': self.front_api, 'admin': self.admin_api}

    @property
    def aliases(self):
        return (self.front_alias, self.admin_api.parent / 'public',
                *(self.front_api.parent / n for n in ('forumPdfScanWorker.mjs',
                'marketSnapshotRefresh.js', 'publicHotSnapshotRefresh.js',
                'recommendationValueRefresh.js', 'server')), *self.extra_links)

@contextmanager
def locked(cfg):
    handles = []
    try:
        need(len(cfg.locks) == 2 and len(set(cfg.locks)) == 2, 'EXACT_DUAL_LOCKS')
        for alias in cfg.locks:
            need(not alias.is_symlink(), 'LOCK_FILE_SYMLINK')
            p = no_link(alias.resolve(strict=True))  # /var/lock parent may alias /run/lock
            fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                need(stat.S_ISREG(os.fstat(fd).st_mode), 'LOCK_REGULAR_REQUIRED')
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BaseException:
                os.close(fd)
                raise
            item = (p, fd, meta(p))
            handles.append(item)
            ACTIVE_LOCKS.append(item)
        check_locks()
        yield
    except BlockingIOError as exc:
        raise ReleaseError('DUAL_LOCK_BUSY_NO_CLEAR') from exc
    finally:
        for item in reversed(handles):
            ACTIVE_LOCKS.remove(item)
            fcntl.flock(item[1], fcntl.LOCK_UN)
            os.close(item[1])

def coord_closed(raw):
    c = decode(raw)
    need(isinstance(c, dict) and c.get('shared_release_active') is False,
         'FOREIGN_OR_OPEN_WINDOW')
    w = c.get('window')
    need(isinstance(w, dict) and w.get('status') in ('closed', 'verified')
         and w.get('needsOperatorRecovery') is False
         and c.get('needsOperatorRecovery', False) is False
         and isinstance(w.get('closedAtUtc'), str) and w['closedAtUtc'], 'UNCLOSED_COORD')
    need(isinstance(c.get('window_history'), list), 'FULL_HISTORY_REQUIRED')
    need(all(isinstance(v, dict) for v in c['window_history']), 'HISTORY_RECORD_OBJECTS')
    for item in [w, *c['window_history']]:
        need(item.get('scope') != SCOPE, 'SCOPE_COORD_REPLAY')
    return c

def union(cfg, coord):
    """Collect extension protection from the ENTIRE coordination tree, never drop history.
    Recognized extra_links accept alias->target map or [{alias,target}], protected
    extensions are lists or path->record maps. An unknown representation blocks.
    """
    paths, links = set(cfg.extra_protected), {}
    def absolute(p):
        need(isinstance(p, str) and p.startswith('/') and '\x00' not in p,
             'COORD_PROTECTION_ABSOLUTE')
        return Path(p)
    def walk(v):
        if isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, dict):
            for k, x in v.items():
                if k in ('extra_protected', 'extraProtected', 'protectedFiles'):
                    # Older closed receipts use protectedFiles as a nonnegative
                    # count, not a path extension. Explicit extensions stay strict.
                    if k == 'protectedFiles' and integer(x) and x >= 0:
                        continue
                    need(isinstance(x, (dict, list)), 'COORD_PROTECTED_FORMAT')
                    for p in (x.keys() if isinstance(x, dict) else x):
                        paths.add(absolute(p))
                elif k in ('extra_links', 'extraLinks'):
                    need(isinstance(x, (dict, list)), 'COORD_LINK_FORMAT')
                    entries = x.items() if isinstance(x, dict) else (
                        (item['alias'], item['target']) for item in x)
                    for a, t in entries:
                        if isinstance(t, dict):
                            t = t.get('target')
                        a, t = absolute(a), absolute(t)
                        need(a not in links or links[a] == t, 'CONFLICTING_COORD_LINK_TARGETS')
                        links[a] = t
                else:
                    walk(x)
    walk(coord)
    paths.discard(cfg.coord)  # own coordinator is separately full-CAS protected
    need(not any(p == cfg.stage or cfg.stage in p.parents for p in paths),
         'COORD_PROTECTION_INCLUDES_OWN_STAGE')
    return tuple(sorted(paths)), links

def inventory(cfg, rows, extra_paths=(), pinned_links=None):
    out, visited = {}, set()
    pinned_links = pinned_links or {}
    def visit(p):
        p = Path(p)
        if p == cfg.coord:
            return
        need(p != cfg.stage and cfg.stage not in p.parents, 'STAGE_IN_PROTECTED_GRAPH')
        r = describe(p)
        out[str(p)] = r
        if r['kind'] == 'symlink':
            target = Path(r['target'])
            if p in pinned_links:
                need(target == pinned_links[p], 'COORD_ALIAS_TARGET_DRIFT')
            visit(target)
        elif r['kind'] == 'directory':
            if p in visited:
                return
            visited.add(p)
            for child in sorted(p.iterdir()):
                visit(child)
        else:
            need(r['kind'] == 'file', 'INVENTORY_NONFILE')
    for p in cfg.aliases:
        need(p.is_symlink(), 'FIXED_ALIAS_MUST_BE_SYMLINK: ' + str(p))
        visit(p)
    need((cfg.admin_api.parent / 'public').resolve(strict=True) == cfg.public,
         'ADMIN_FIXED_PUBLIC_ROOT')
    for p in [cfg.public, cfg.front, cfg.nginx, cfg.pm2_base, cfg.node,
              cfg.pm2_home / 'dump.pm2', cfg.pm2_home / 'pm2.pid', *extra_paths]:
        visit(p)
    for script in sorted({r['script'] for r in rows}):
        p = Path(script)
        visit(p.parent)
        for env in sorted(p.parent.parent.glob('.env*')):
            visit(env)
        runtime = p.parent.parent / 'runtime'
        if runtime.exists():
            visit(runtime)
    for flag in sorted(cfg.ops.glob('official*.json')):
        visit(flag)
    for a, t in pinned_links.items():
        need(a.is_symlink() and a.resolve(strict=True) == t, 'COORD_PIN_LINK_DRIFT')
        visit(a)
    return dict(sorted(out.items()))

def shallow_pm2(v):
    need(isinstance(v, dict), 'PM2_CONFIG_OBJECT')
    # No recursive application-value interpretation or stripping.
    return {k: value for k, value in v.items() if k not in LIFECYCLE}

# These measured generating/reset sources define the ONLY serialized exceptions.
# Node/Daemon and both complete vendor trees remain separately source/META pinned.
PM2_GENERATION_PINS = {
    'lib/God.js': 'f598e5113890418827e31dd52fc3538e8f19287fad212cafd9388b0216fe500d',
    'lib/God/ClusterMode.js': 'b4a9304e12f468f87a039c174c6ea4a1001f21d9dd1f5317121ed217bc389119',
    'lib/God/Reload.js': '5e90112e447c4634009ea35005ffd477aab93064f55390288c56b51eee25992e',
    'lib/God/Methods.js': '577a8505074225dfe73ce2c955c844662c6bc9d76c31d8102f809a1691262044',
    'lib/Utility.js': '66cd15711be69f40f6ee3c3f60adcf07e58d0bcdec9552ec5104530b22ba28f1',
    'lib/ProcessContainer.js': '712b414f248a460f58d4365898fa7b27d39bf7f571ac889359e3a7b6a32419d1',
    'constants.js': '5a4adce0c3c277d4974c0ebdefb22d62ffcad74edcf910bfeeff287dacb8a853',
    'package.json': 'f2819cffb2aae16bb813596575410877570a253be11949260caa33c8038788d6',
    'modules/fclone.js': '9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6',
}
PM2_RAW_GENERATED = ('pm_uptime', 'restart_time', 'created_at',
                     'unstable_restarts', 'prev_restart_delay')

def raw_values(data):
    need(data.endswith(b'\0'), 'RAW_NUL_REQUIRED')
    values = {}
    for entry in data[:-1].split(b'\0'):
        need(b'=' in entry, 'RAW_ENTRY_REQUIRED')
        k, v = entry.split(b'=', 1)
        need(k and k not in values, 'RAW_DUPLICATE_OR_EMPTY')
        values[k] = v
    return values

def raw_semantics(data, own=False, serialized=None):
    values = raw_values(data)
    if own:
        need(b'NODE_UNIQUE_ID' in values and re.fullmatch(rb'[0-9]+', values[b'NODE_UNIQUE_ID']),
             'OWN_OUTER_NODE_UNIQUE_ID_DECIMAL')
        del values[b'NODE_UNIQUE_ID']
        if serialized is not None:
            need(b'pm2_env' in values, 'PM2_SERIALIZED_CONTAINER_REQUIRED')
            values[b'pm2_env'] = serialized
    # No recursive canonicalization: each retained value is its original byte string.
    norm = {k.decode('utf8', 'surrogateescape'): v.decode('utf8', 'surrogateescape')
            for k, v in values.items()}
    return H(encode(norm))

def pm2_top_tokens(raw):
    """Strict JSON first; then locate just top value spans without re-encoding them."""
    value = decode(raw)
    need(isinstance(value, dict), 'PM2_SERIALIZED_OBJECT')
    try:
        text = raw.decode('utf8')
        scanner = json.JSONDecoder()
        def ws(i):
            while i < len(text) and text[i] in ' \t\r\n':
                i += 1
            return i
        i = ws(0)
        need(text[i:i+1] == '{', 'PM2_TOP_OBJECT')
        i = ws(i+1); spans = {}
        while text[i:i+1] != '}':
            key, i = scanner.raw_decode(text, i)
            need(isinstance(key, str) and key not in spans, 'PM2_TOP_KEY')
            i = ws(i); need(text[i:i+1] == ':', 'PM2_TOP_COLON')
            a = ws(i+1); _, b = scanner.raw_decode(text, a)
            spans[key] = (a, b)
            i = ws(b)
            if text[i:i+1] == '}':
                break
            need(text[i:i+1] == ',', 'PM2_TOP_COMMA'); i = ws(i+1)
        need(text[i:i+1] == '}' and ws(i+1) == len(text) and set(spans) == set(value),
             'PM2_TOP_COMPLETE')
        return value, text, spans
    except (ValueError, UnicodeError, IndexError) as exc:
        raise ReleaseError('PM2_TOP_INVALID') from exc

def pm2_project(raw):
    value, text, spans = pm2_top_tokens(raw)
    replacements = []
    for key in PM2_RAW_GENERATED:
        if key in value:
            a, b = spans[key]
            need(integer(value[key]) and 0 <= value[key] < 2**53
                 and re.fullmatch(r'0|[1-9][0-9]*', text[a:b]), 'PM2_GENERATED_INTEGER_TOKEN')
            replacements.append((a, b))
    for a, b in sorted(replacements, reverse=True):
        text = text[:a] + '0' + text[b:]
    return text.encode('utf8')

def pm2_raw_binding(raw, model):
    """Source-defined narrow proof; unresolved monitor/fork bytes yield not-ready.
    No new/deleted top field, application escape or opaque byte gets an exception.
    """
    outer = raw_values(raw)
    need(b'pm2_env' in outer, 'PM2_SERIALIZED_CONTAINER_REQUIRED')
    data = outer[b'pm2_env']; value, _, _ = pm2_top_tokens(data)
    e = model['pm2_env']
    need(isinstance(e, dict) and isinstance(e.get('env'), dict)
         and isinstance(value.get('env'), dict), 'PM2_ENV_OBJECT_REQUIRED')
    bindings = {'name': model['name'], 'pm_id': model['pm_id'],
                'pm_exec_path': e['pm_exec_path'], 'pm_cwd': e['pm_cwd'],
                'exec_mode': 'cluster_mode', '_pm2_version': '7.0.3'}
    need(integer(model['pm_id']) and model['pm_id'] >= 0
         and all(isinstance(bindings[k], str) and bindings[k] for k in
                 ('name', 'pm_exec_path', 'pm_cwd'))
         and all(k in value and encode(value[k]) == encode(v) for k, v in bindings.items())
         and integer(e.get('pm_id')) and e['pm_id'] == model['pm_id']
         and e.get('name') == model['name']
         and e.get('exec_mode') == 'cluster_mode', 'PM2_RAW_IDENTITY_BINDING')
    generated = set(PM2_RAW_GENERATED) | {'status', 'axm_actions', 'axm_monitor', 'axm_options', 'axm_dynamic'}
    need(not (set(e['env']) & (set(bindings) | generated |
              {'autostart', 'wait_ready', 'pm2_env', '__proto__'})),
         'PM2_ENV_OVERRIDE_AMBIGUITY')
    need(encode(value['env']) == encode(e['env']), 'PM2_RAW_MODEL_ENV_BINDING')
    need(e.get('autostart') is True and ('wait_ready' not in e or e['wait_ready'] is False)
         and value.get('autostart') is True
         and ('wait_ready' not in value or value['wait_ready'] is False)
         and value.get('status') == 'launching' and e.get('status') == 'online'
         and value.get('axm_actions') == []
         and all(value.get(k) == {} for k in ('axm_monitor', 'axm_options', 'axm_dynamic')),
         'PM2_GENERATION_SOURCE_SHAPE')
    need(all(k in value for k in ('pm_uptime', 'restart_time', 'created_at')),
         'PM2_REQUIRED_GENERATED_FIELDS')
    projected = pm2_project(data)
    metadata = {k: value.get(k) for k in PM2_RAW_GENERATED}
    need(all(k not in value or (k in e and encode(value[k]) == encode(e[k]))
             for k in PM2_RAW_GENERATED), 'PM2_RAW_MODEL_GENERATED_BINDING')
    need(metadata['pm_uptime'] > 0 and metadata['created_at'] > 0,
         'PM2_GENERATED_TIME_POSITIVE')
    # Conservative forecast of Reload -> resetState -> executeApp -> cluster.fork.
    # Python serialization is used ONLY as a byte-equality gate, never to replace
    # retained application bytes. A JS/Python escape/order difference blocks.
    forecast = copy.deepcopy(e)
    for k, v in e['env'].items():
        need(not isinstance(v, (dict, list)), 'PM2_ENV_MERGE_COERCION_AMBIGUITY')
        if v != '[object Object]':
            forecast[k] = v
    forecast.update(status='launching', pm_uptime=0, restart_time=0,
                    created_at=0, unstable_restarts=0, prev_restart_delay=0,
                    axm_actions=[], axm_monitor={}, axm_options={}, axm_dynamic={})
    forecast['vizion_running'] = forecast.get('vizion_running', False)
    forecast['_pm2_version'] = '7.0.3'
    predicted = json.dumps(forecast, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf8')
    ready = pm2_project(predicted) == projected
    return raw_semantics(raw, True, projected), metadata, ready

def pm2_meta_transition(before, after, earliest, latest):
    exact(before, ' '.join(PM2_RAW_GENERATED), 'PM2_BEFORE_META_SCHEMA')
    exact(after, ' '.join(PM2_RAW_GENERATED), 'PM2_AFTER_META_SCHEMA')
    need(all(integer(v) and 0 <= v < 2**53 for v in before.values())
         and all(integer(v) and 0 <= v < 2**53 for v in after.values()), 'PM2_TRANSITION_META_INTEGER')
    need(after['restart_time'] == before['restart_time'] + 1
         and earliest <= after['created_at'] <= after['pm_uptime'] <= latest
         and after['pm_uptime'] > before['pm_uptime']
         and after['created_at'] > before['created_at']
         and after['unstable_restarts'] == after['prev_restart_delay'] == 0,
         'PM2_SOURCE_DEFINED_EXACT_TRANSITION')


def permissions(cfg, pid):
    fields = {}
    for line in (cfg.proc / str(pid) / 'status').read_bytes().splitlines():
        k, _, v = line.partition(b':')
        if k in (b'Uid', b'Gid', b'Groups', b'Umask'):
            need(k not in fields, 'PERMISSION_DUPLICATE')
            fields[k.decode()] = [x.decode('ascii') for x in v.split()]
    need(set(fields) == {'Uid', 'Gid', 'Groups', 'Umask'}, 'PERMISSION_FIELDS')
    return H(encode(fields))

RPC = r'''
const fs=require('fs'),crypto=require('crypto'),path=require('path');
const a=JSON.parse(process.argv[1]);let req,done=false;
function fail(){if(done)return;done=true;process.stderr.write('EXISTING_SOCKET_RPC_FAILED');process.exit(2)}
function verify(){for(const [p,h] of Object.entries(a.pins)){let fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{if(!fs.fstatSync(fd).isFile()||crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex')!==h)throw Error('pin')}finally{fs.closeSync(fd)}}
const s=fs.lstatSync(a.socket);for(const k of ['dev','ino','uid','gid','mode'])if(s[k]!==a.socketStat[k])throw Error('socket');if(!s.isSocket())throw Error('socket');
const pid=Number(fs.readFileSync(a.pidfile,'utf8').trim());if(pid!==a.daemonPid)throw Error('daemon');process.kill(pid,0)}
function target(rows){if(!Array.isArray(rows))throw Error('rows');const group=rows.filter(r=>r.pm_id===a.id);if(group.length!==1)throw Error('id');const r=group[0],e=r.pm2_env;if(r.name!==a.name||e.pm_exec_path!==a.script||e.exec_mode!=='cluster_mode'||e.status!=='online'||e.wait_ready||r.pid!==a.beforePid||e.restart_time!==a.beforeRestart)throw Error('identity')}
try{verify();const axon=require(a.base+'/modules/pm2-axon'),rpc=require(a.base+'/modules/pm2-axon-rpc');req=axon.socket('req');req.on('error',fail);req.connect(a.socket);const c=new rpc.Client(req);setTimeout(fail,a.reload?45000:12000);
c.call('getMonitorData',{},(err,rows)=>{try{if(err)throw Error('monitor');verify();if(!a.reload){done=true;process.stdout.write(JSON.stringify(rows),()=>{req.close();process.exit(0)});return}target(rows);c.call('reloadProcessId',{id:a.id,env:{}},(err)=>{try{if(err)throw Error('reload');verify();done=true;process.stdout.write('{}',()=>{req.close();process.exit(0)})}catch(_){fail()}})}catch(_){fail()}})}catch(_){fail()}
'''

def adapter_files(cfg, entries):
    """Pure fixed vendor closure snapshot, not guessed npm package metadata.
    Only the two measured absolute index.js resolutions are accepted. Every
    file and directory (including lib and empty dirs) is full-META bound;
    symlinks, hardlinked files, special entries and enumeration drift refuse.
    Actual transitive dependencies remain protected by full pm2_base inventory.
    """
    roots = [cfg.pm2_base / 'modules' / n for n in ('pm2-axon', 'pm2-axon-rpc')]
    need(isinstance(entries, list) and entries == [str(p / 'index.js') for p in roots],
         'EXACT_VENDORED_ADAPTER_ENTRIES')
    out = {}
    def visit(p, root):
        p = no_link(p)
        need(p == root or root in p.parents, 'ADAPTER_TREE_ESCAPE')
        record = describe(p)
        need(record['kind'] in ('file', 'directory'), 'ADAPTER_FILE_OR_DIRECTORY_ONLY')
        if record['kind'] == 'file':
            need(record['nlink'] == 1, 'ADAPTER_SINGLE_REGULAR_REQUIRED')
        out[str(p)] = record
        if record['kind'] == 'directory':
            children = sorted(p.iterdir())
            for child in children:
                visit(child, root)
            need(sorted(p.iterdir()) == children and describe(p) == record,
                 'ADAPTER_ENUMERATION_META_DRIFT')
    for root in roots:
        root = no_link(root)
        need(describe(root)['kind'] == 'directory', 'ADAPTER_DIRECTORY_REQUIRED')
        visit(root, root)
        need(out.get(str(root / 'index.js'), {}).get('kind') == 'file', 'ADAPTER_INDEX_FILE_REQUIRED')
    return dict(sorted(out.items()))

# Fixed non-PM2 protection: no CLI selector, discovery, fallback or lifecycle action.
EXTERNAL_PARENT_PID = 2060125
EXTERNAL_CHILD_PID = 2060126
EXTERNAL_OPS = Path('/opt/ops/dianzi51-recommendation')
EXTERNAL_CWD = Path('/opt/releases/20261009T170014Z-memory-isolation/dianzi51-platform')
EXTERNAL_SCRIPT = EXTERNAL_OPS / 'releases/20261112-forum12-1255b7b84aa3adac09cb8c05/worker-runtime-bootstrap.mjs'

def external_proc_identity(cfg, pid):
    # procfs bytes are virtual (often st_size=0): use the existing read_bytes
    # semantics, not regular-file size checks. State is live-only, not normalized.
    data = (cfg.proc / str(pid) / 'stat').read_bytes()
    head, sep, tail = data.rpartition(b') ')
    prefix = str(pid).encode() + b' ('
    fields = tail.split()
    need(sep and head.startswith(prefix) and len(fields) >= 20
         and fields[0] not in (b'Z', b'X', b'x')
         and re.fullmatch(rb'[0-9]+', fields[1])
         and re.fullmatch(rb'[1-9][0-9]*', fields[19]), 'EXTERNAL_PROC_STAT_IDENTITY')
    return dict(pid=pid, ppid=int(fields[1]), startTicks=int(fields[19]),
                nameSha256=H(head[len(prefix):]))

def external_proc_link(cfg, pid, name):
    value = os.readlink(cfg.proc / str(pid) / name)
    p = Path(value)
    need(p.is_absolute() and str(p) == value and '..' not in p.parts
         and not value.endswith(' (deleted)'), 'EXTERNAL_DELETED_OR_NONCANONICAL_LINK')
    # Only the kernel's actual path is used; unsupported file links fail closed.
    return no_link(p)

def external_source(path):
    record = describe(no_link(path))
    need(record['kind'] == 'file' and record['nlink'] == 1,
         'EXTERNAL_SINGLE_REGULAR_SOURCE')
    need(describe(path) == record, 'EXTERNAL_SOURCE_META_READ_RACE')
    return record

def external_proc_sample(cfg, pid, expected_exe, script=None, cwd=None):
    identity_before = external_proc_identity(cfg, pid)
    proc = no_link(cfg.proc / str(pid))
    proc_record = meta(proc)
    need(stat.S_ISDIR(proc_record['statmode']), 'EXTERNAL_PROC_DIRECTORY')
    exe = external_proc_link(cfg, pid, 'exe')
    current_cwd = external_proc_link(cfg, pid, 'cwd')
    link_meta = {name: meta(proc / name) for name in ('exe', 'cwd')}
    need(exe.name == expected_exe, 'EXTERNAL_ACTUAL_EXE_NAME')
    cwd_record = describe(current_cwd)
    need(cwd_record['kind'] == 'directory', 'EXTERNAL_CWD_DIRECTORY')
    if cwd is not None:
        need(current_cwd == cwd, 'EXTERNAL_EXACT_CHILD_CWD')
    cmdline = (proc / 'cmdline').read_bytes()
    need(cmdline.endswith(b'\0'), 'EXTERNAL_CMDLINE_NUL')
    args = cmdline[:-1].split(b'\0')
    need(args and all(args) and Path(os.fsdecode(args[0])).name == expected_exe,
         'EXTERNAL_CMDLINE_EXE_BINDING')
    if script is not None:
        # Only plain known bootstrap argv is supported. Unknown loader/flags
        # are not inferred, executed or excused by opaque-byte equality.
        need(len(args) == 2 and args[1] == os.fsencode(script),
             'EXTERNAL_EXACT_CHILD_SCRIPT_ARGV')
    raw = (proc / 'environ').read_bytes()
    need(not raw or raw.endswith(b'\0'), 'EXTERNAL_ENV_NUL')
    permission_hash = permissions(cfg, pid)
    record = dict(identity_before, exeName=expected_exe, exe=str(exe), cwd=str(current_cwd),
                  knownScript=str(script) if script is not None else None,
                  rawSha256=H(raw), cmdlineSha256=H(cmdline),
                  permissionsSha256=permission_hash, procMeta=proc_record,
                  kernelLinkMeta=link_meta, cwdMeta=cwd_record)
    need(external_proc_identity(cfg, pid) == identity_before
         and meta(proc) == proc_record
         and all(external_proc_link(cfg, pid, name) == path
                 for name, path in (('exe', exe), ('cwd', current_cwd)))
         and {name: meta(proc / name) for name in ('exe', 'cwd')} == link_meta,
         'EXTERNAL_PROC_IDENTITY_READ_RACE')
    return record

def external_protection_sample(cfg, ops, cwd, script):
    roots = {str(p): describe(no_link(p)) for p in (ops, cwd)}
    need(all(v['kind'] == 'directory' for v in roots.values()), 'EXTERNAL_ROOT_DIRECTORIES')
    parent = external_proc_sample(cfg, EXTERNAL_PARENT_PID, 'flock')
    child = external_proc_sample(cfg, EXTERNAL_CHILD_PID, 'node-22', script, cwd)
    need(child['ppid'] == parent['pid'] and parent['ppid'] > 0
         and child['startTicks'] >= parent['startTicks'] and parent['ppid'] not in
         (parent['pid'], child['pid']), 'EXTERNAL_EXACT_PARENT_CHILD')
    files = {Path(parent['exe']), Path(child['exe']), cfg.node, script}
    source_meta = {str(p): external_source(p) for p in sorted(files)}
    need(source_meta[child['exe']]['sha256'] == source_meta[str(cfg.node)]['sha256'],
         'EXTERNAL_NODE_FULL_SHA_BINDING')
    need({str(p): describe(p) for p in (ops, cwd)} == roots,
         'EXTERNAL_ROOT_META_READ_RACE')
    return dict(fixtureOnly=cfg.mock, processes=[parent, child],
                sources={p: v['sha256'] for p, v in source_meta.items()},
                fullSourceMeta=source_meta, rootMeta=roots)

def external_protection(cfg, fixture=None):
    """Pure readonly, two COMPLETE samples; fixture routing exists only in mock.
    Parent cwd is observed shallowly, never guessed or recursively enumerated.
    Dependency/loader semantics still require actual-source/full-tree review.
    """
    need(fixture is None or cfg.mock, 'EXTERNAL_FIXTURE_ONLY_NO_PRODUCTION_OVERRIDE')
    if cfg.mock and fixture is None:
        return dict(fixtureOnly=True, processes=[], sources={}, fullSourceMeta={}, rootMeta={})
    if fixture is None:
        need(cfg.proc == Path('/proc'), 'EXTERNAL_FIXED_PRODUCTION_PROC')
        ops, cwd, script = EXTERNAL_OPS, EXTERNAL_CWD, EXTERNAL_SCRIPT
    else:
        exact(fixture, 'ops cwd script', 'EXTERNAL_FIXTURE_PATH_SCHEMA')
        ops, cwd, script = (no_link(fixture[k]) for k in ('ops', 'cwd', 'script'))
    need(ops in cfg.extra_protected and cwd in cfg.extra_protected
         and ops in script.parents, 'EXTERNAL_REQUIRED_EXACT_ROOTS')
    first = external_protection_sample(cfg, ops, cwd, script)
    second = external_protection_sample(cfg, ops, cwd, script)
    need(first == second, 'EXTERNAL_TWO_SAMPLE_DRIFT')
    return first

def transport(cfg):
    external = external_protection(cfg)
    sock = cfg.pm2_home / 'rpc.sock'
    r = describe(sock)
    need(r['kind'] == 'socket', 'EXISTING_PM2_SOCKET_REQUIRED')
    pid = regular(cfg.pm2_home / 'pm2.pid').strip()
    need(re.fullmatch(rb'[1-9][0-9]*', pid), 'DAEMON_PID_REQUIRED')
    os.kill(int(pid), 0)
    need((cfg.proc / str(int(pid))).is_dir(), 'DAEMON_PROC_REQUIRED')
    sources = [cfg.node, cfg.pm2_base / 'lib/Daemon.js',
               *(cfg.pm2_base / n for n in PM2_GENERATION_PINS)]
    need(all(os.environ.get(k) in (None, '') for k in ('NODE_OPTIONS', 'NODE_PATH')),
         'ROOT_NODE_LOADER_ENV_NOT_EMPTY_NO_NODE_EXECUTION')
    resolved = subprocess.run([str(cfg.node), '-e',
        "const b=process.argv[1];process.stdout.write(JSON.stringify(['pm2-axon','pm2-axon-rpc'].map(n=>require.resolve(b+'/modules/'+n))))",
        str(cfg.pm2_base)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    need(resolved.returncode == 0, 'FRESH_ADAPTER_RESOLVE_REQUIRED')
    entries = decode(resolved.stdout)
    need(isinstance(entries, list) and len(entries) == 2, 'EXACT_ADAPTER_ENTRIES')
    adapters = adapter_files(cfg, entries)
    sources.extend(Path(p) for p, record in adapters.items() if record['kind'] == 'file')
    pins = {str(p): H(regular(p)) for p in sources}
    need(all(p not in pins or pins[p] == h for p, h in external['sources'].items()),
         'EXTERNAL_TRANSPORT_SOURCE_COLLISION')
    pins.update(external['sources'])
    need(all(pins[str(cfg.pm2_base/n)] == h for n, h in PM2_GENERATION_PINS.items()),
         'PM2_GENERATION_SOURCE_PIN_DRIFT')
    need(all(pins[p] == record['sha256'] for p, record in adapters.items()
             if record['kind'] == 'file'), 'ADAPTER_SOURCE_SNAPSHOT_DRIFT')
    # Node cluster primary implementation binds the specifically allowed NODE_UNIQUE_ID exception.
    result = subprocess.run([str(cfg.node), '-e',
        "process.stdout.write(process.binding('natives')['internal/cluster/primary'])"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    need(result.returncode == 0 and b'NODE_UNIQUE_ID' in result.stdout, 'NODE_CLUSTER_SOURCE_REQUIRED')
    need(adapter_files(cfg, entries) == adapters, 'ADAPTER_FULL_META_SET_DRIFT')
    need(external_protection(cfg) == external, 'EXTERNAL_TRANSPORT_DRIFT')
    return dict(socket=r, daemonPid=int(pid), pidfile=describe(cfg.pm2_home / 'pm2.pid'),
                sources=pins, fullAdapterMeta=adapters, externalProtection=external,
                nodeClusterPrimarySha256=H(result.stdout), rpcSourceSha256=H(RPC.encode()))

def rpc(cfg, tr, reload_row=None):
    need(transport(cfg) == tr, 'SOCKET_ADAPTER_SOURCE_DRIFT')
    sm = tr['socket']
    a = dict(pins=tr['sources'], socket=str(cfg.pm2_home / 'rpc.sock'),
             socketStat={k: sm['statmode'] if k == 'mode' else sm[k] for k in ('dev','ino','uid','gid','mode')},
             daemonPid=tr['daemonPid'], pidfile=str(cfg.pm2_home / 'pm2.pid'), base=str(cfg.pm2_base),
             reload=reload_row is not None)
    if reload_row:
        a.update(id=reload_row['id'], name=reload_row['name'], script=reload_row['script'],
                 beforePid=reload_row['pid'], beforeRestart=reload_row['restarts'])
    try:
        p = subprocess.run([str(cfg.node), '-e', RPC, json.dumps(a)], stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=48 if reload_row else 16)
    except subprocess.TimeoutExpired as exc:
        raise ReleaseError('SOCKET_RPC_TIMEOUT_NO_FALLBACK') from exc
    need(p.returncode == 0, 'SOCKET_RPC_FAILED_NO_FALLBACK')
    need(transport(cfg) == tr, 'SOCKET_ADAPTER_POST_DRIFT')
    return decode(p.stdout)

def snapshot_rows(cfg, tr):
    rows = rpc(cfg, tr)
    need(isinstance(rows, list), 'MONITOR_LIST')
    out = []
    for r in rows:
        e, pid = r['pm2_env'], r['pid']
        need(integer(pid) and pid > 0 and e.get('status') == 'online', 'ALL_ONLINE')
        own = (r.get('name'), e.get('pm_exec_path')) in (
            ('dianzi51', str(cfg.front_api)), ('dianzi51-admin', str(cfg.admin_api)))
        top = shallow_pm2({k: v for k, v in e.items() if k != 'env'})
        child = shallow_pm2(e.get('env', {}))
        port = e.get('PORT', child.get('PORT'))
        if own:
            need(str(port).isdigit() and 1 <= int(port) <= 65535 and not e.get('wait_ready')
                 and ('PORT' not in child or str(child['PORT']) == str(port)), 'CAPTURE_LISTENER_PORT_REQUIRED')
        raw = (cfg.proc / str(pid) / 'environ').read_bytes()
        semantic, metadata, ready = pm2_raw_binding(raw, r) if own else (raw_semantics(raw), None, None)
        out.append(dict(id=r['pm_id'], name=r['name'], pid=pid, status=e['status'],
            script=e['pm_exec_path'], cwd=e['pm_cwd'], execMode=e['exec_mode'],
            restarts=e.get('restart_time'), listenerPort=int(port) if own else None,
            topConfigSha256=H(encode(top)), childConfigSha256=H(encode(child)),
            rawSha256=H(raw), semanticSha256=semantic, pm2RawMeta=metadata, pm2ReloadReady=ready,
            nodeUniqueId=int(next(v.split(b'=',1)[1] for v in raw[:-1].split(b'\0')
                                 if v.startswith(b'NODE_UNIQUE_ID='))) if own else None,
            permissionsSha256=permissions(cfg, pid)))
    return sorted(out, key=lambda x: x['id'])

def identity(cfg, rows):
    need(isinstance(rows, list) and len(rows) == 12 and len({r['id'] for r in rows}) == 12
         and len({r['pid'] for r in rows}) == 12, 'TWELVE_UNIQUE_SLOTS')
    for r in rows:
        exact(r, 'id name pid status script cwd execMode restarts listenerPort topConfigSha256 '
              'childConfigSha256 rawSha256 semanticSha256 nodeUniqueId permissionsSha256 pm2RawMeta pm2ReloadReady', 'PROCESS_SCHEMA')
        need(integer(r['id']) and integer(r['pid']) and r['pid'] > 0 and r['status'] == 'online'
             and integer(r['restarts']) and r['restarts'] >= 0, 'PROCESS_ONLINE_IDENTITY')
        for k in ('topConfigSha256', 'childConfigSha256', 'rawSha256', 'semanticSha256', 'permissionsSha256'):
            pin(r[k])
    ids = []
    for name, path, count in [('dianzi51', cfg.front_api, 4), ('dianzi51-admin', cfg.admin_api, 2)]:
        group = [r for r in rows if r['name'] == name]
        need(len(group) == count and all(r['script'] == str(path) and r['execMode'] == 'cluster_mode'
             and integer(r['listenerPort']) and 1 <= r['listenerPort'] <= 65535
             and integer(r['nodeUniqueId']) and r['nodeUniqueId'] >= 0
             and type(r['pm2ReloadReady']) is bool and isinstance(r['pm2RawMeta'], dict)
             and set(r['pm2RawMeta']) == set(PM2_RAW_GENERATED)
             and r['pm2RawMeta']['restart_time'] == r['restarts']
             and all(v is None or (integer(v) and 0 <= v < 2**53)
                     for v in r['pm2RawMeta'].values()) for r in group),
             'FRESH_UNIQUE_FIXED_EXEC_PATH_SCOPE')
        need(len({r['listenerPort'] for r in group}) == 1, 'SINGLE_LISTENER_PORT_PER_API')
        ids.extend(r['id'] for r in group)
    need(all(r['pm2RawMeta'] is None and r['pm2ReloadReady'] is None
             for r in rows if r['id'] not in ids), 'UNOWNED_RAW_NO_EXCEPTION')
    need(len({r['nodeUniqueId'] for r in rows if r['id'] in ids}) == 6,
         'OWN_NODE_UNIQUE_ID_COLLISION')
    need(len(set(ids)) == 6, 'EXACT_SIX_OWN_SLOTS')
    return ids

def get_http(cfg, host, relative):
    need(host in ('admin.51dianzi.com', '51dianzi.com'), 'FIXED_HTTPS_HOST')
    need(relative == '' or rel(relative), 'STATIC_GET_ONLY')
    p = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--noproxy', '*',
        '--compressed', '--proto', '=https', '--max-time', '20', '--request', 'GET',
        '--resolve', host + ':443:127.0.0.1', '-H', 'Cache-Control: no-cache',
        'https://' + host + '/' + relative], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=25)
    need(p.returncode == 0, 'STATIC_HTTPS_GET_FAILED')
    return p.stdout

def listener(cfg, row, expected):
    conn = http.client.HTTPConnection('127.0.0.1', row['listenerPort'], timeout=15)
    try:
        conn.request('GET', '/', headers={'Cache-Control': 'no-cache', 'Host':
            'admin.51dianzi.com' if row['name'] == 'dianzi51-admin' else '51dianzi.com'})
        response = conn.getresponse()
        data = response.read()
        need(response.status == 200 and H(data) == expected, 'CAPTURED_LISTENER_GET_BODY')
    finally:
        conn.close()
    return True

def utf16_offset(text, offset):
    return len(text[:offset].encode('utf-16-le')) // 2

def inverse_patches(before, after, patches, native=False, expected_count=None):
    """Reconstruct BOTH directions; all unlisted byte runs must be identical.
    Multiple stable-order insertions at the same original offset are permitted.
    """
    need(before != after and isinstance(patches, list) and patches, 'NONEMPTY_SOURCEPATCH_REQUIRED')
    if expected_count is not None:
        need(len(patches) == expected_count, 'EXACT_PATCH_COUNT')
    bs, ns = before.decode('utf8'), after.decode('utf8')
    need(bs.encode() == before and ns.encode() == after, 'STRICT_UTF8')
    out, reverse, old_pos, new_pos, names = [], [], 0, 0, set()
    for p in patches:
        if native:
            exact(p, 'name start end newStart newEnd oldSha256 newSha256 oldByteStart oldByteEnd '
                  'newByteStart newByteEnd source oldText newText', 'NATIVE_PATCH_SCHEMA')
            a, b, c, d = (p[k] for k in ('oldByteStart','oldByteEnd','newByteStart','newByteEnd'))
            old, new = p['oldText'].encode(), p['newText'].encode()
            need(utf16_offset(bs, len(before[:a].decode('utf8'))) == p['start']
                 and utf16_offset(bs, len(before[:b].decode('utf8'))) == p['end']
                 and utf16_offset(ns, len(after[:c].decode('utf8'))) == p['newStart']
                 and utf16_offset(ns, len(after[:d].decode('utf8'))) == p['newEnd'], 'CHAR_BYTE_OFFSETS')
        else:
            exact(p, 'name oldByteStart oldByteEnd newByteStart newByteEnd oldSha256 newSha256 '
                  'oldText newText source', 'NORMALIZED_PATCH_SCHEMA')
            a, b, c, d = (p[k] for k in ('oldByteStart','oldByteEnd','newByteStart','newByteEnd'))
            old, new = p['oldText'].encode(), p['newText'].encode()
        need(isinstance(p['name'], str) and p['name'] not in names, 'UNIQUE_PATCH_NAME')
        names.add(p['name'])
        need(all(integer(x) for x in (a,b,c,d)) and old_pos <= a <= b <= len(before)
             and new_pos <= c <= d <= len(after) and b-a == len(old) and d-c == len(new), 'PATCH_SORT_BOUNDS')
        need(before[a:b] == old and after[c:d] == new and H(old) == pin(p['oldSha256'])
             and H(new) == pin(p['newSha256']), 'PATCH_BYTES_HASH')
        need(before[old_pos:a] == after[new_pos:c], 'OUTSIDE_PATCH_BYTES_CHANGED')
        out += [before[old_pos:a], new]
        reverse += [after[new_pos:c], old]
        old_pos, new_pos = b, d
    out.append(before[old_pos:]); reverse.append(after[new_pos:])
    need(b''.join(out) == after and b''.join(reverse) == before, 'EXACT_FORWARD_REVERSE')
    return True

API_PATCH_NAMES = {
    'front': set(('front.native-ids.customerUploadProblemsExport '
        'front.native-ids.customerUploadRepairPrepareConfirmation '
        'front.native-policies.customerUploadProblemsExport '
        'front.native-policies.customerUploadRepairPrepareConfirmation '
        'front.official-requirement.repair-one-literal listUploadBatchesSchema.customerId '
        'reconcileMaterialCreate.formal-create-lock createChannelInventoryService.formal-create-lock '
        'management.listUploadBatches supply.createCustomerMaterial.formal-history-lock '
        'supply.repairWriteFence.native-wrapper history.approved-local-namespace history.formal-fence-exports '
        'front.router.customerUploadProblemsExport front.router.customerUploadRepairPrepareConfirmation').split()),
    'admin': set(('admin.closed-capability.customerUploadProblemsExport '
        'admin.closed-capability.customerUploadRepairPrepareConfirmation listUploadBatchesSchema.customerId '
        'history.approved-local-namespace admin.router.customerUploadProblemsExport '
        'admin.router.customerUploadRepairPrepareConfirmation admin.readonly-fixed-export-helper').split())}

BINDING_SCHEMAS = [set(x.split()) for x in (
    'exported import nativeDeclarationSha256 nativeEnd nativeStart rule runtimeModule runtimeName sourceImport sourceModule sourceName',
    'exported rule runtimeName sourceModule sourceName', 'exported rule runtimeName sourceName',
    'nativeDeclarationSha256 nativeEnd nativeStart rule runtimeModule runtimeName sourceImport sourceModule sourceName',
    'nativeDeclarationSha256 nativeEnd nativeStart rule runtimeModule runtimeName sourceModule sourceName')]
FACADE_SCHEMAS = [set(x.split()) for x in (
    'exported import nativeDeclarationSha256 nativeEnd nativeStart runtimeModule runtimeName sourceExport sourceFile sourceSha256 sourceSpecifier',
    'nativeDeclarationSha256 nativeEnd nativeStart runtimeModule runtimeName sourceExport sourceFile sourceSha256 sourceSpecifier',
    'rule runtimeName sourceExport sourceFile sourceSha256 sourceSpecifier')]

def validate_api_source(s, hashes):
    need(isinstance(s, dict), 'API_SOURCE_OBJECT')
    def bind(file, digest):
        need(hashes.get(rel(file)) == pin(digest), 'API_SOURCE_BYTES_BINDING')
    if 'compiler' in s:
        exact(s, 'compiler esbuildVersion approvedLocalModules sourceSha256s facades bundleSha256 '
              'entrypointExecuted newProviderOrPool', 'NAMESPACE_SOURCE_SCHEMA')
        need(s['compiler'] == 'esbuild.bundle-controlled-native-facades' and s['entrypointExecuted'] is False
             and s['newProviderOrPool'] is False and isinstance(s['approvedLocalModules'], list)
             and set(s['approvedLocalModules']) == set(s['sourceSha256s']), 'CONTROLLED_FACADE_NO_PROVIDER')
        pin(s['bundleSha256'])
        for f,h in s['sourceSha256s'].items():
            bind(f,h)
        need(isinstance(s['facades'], list) and s['facades'], 'NATIVE_FACADES_REQUIRED')
        for f in s['facades']:
            need(isinstance(f, dict) and set(f) in FACADE_SCHEMAS, 'FACADE_EXACT_SCHEMA')
            bind(f['sourceFile'],f['sourceSha256'])
            if 'nativeDeclarationSha256' in f:
                pin(f['nativeDeclarationSha256'])
                need(integer(f['nativeStart']) and integer(f['nativeEnd']) and
                     0 <= f['nativeStart'] < f['nativeEnd'], 'FACADE_NATIVE_SPAN')
    elif 'composition' in s:
        exact(s, 'sourceSha256 sourceFile composition', 'COMPOSITION_SOURCE_SCHEMA')
        bind(s['sourceFile'], s['sourceSha256'])
        need(s['composition'] == 'exact bundled exports bound once; no alternate native identity', 'EXACT_COMPOSITION')
    else:
        fields = 'sourceFile sourceSha256 compiledSha256 compiledStart compiledEnd identifierOnlyEdits bindings'
        if 'nativeLocalBindings' in s:
            fields += ' nativeLocalBindings'
            exact(s['nativeLocalBindings'], 'payloadHash rule', 'NATIVE_LOCAL_SCHEMA')
            need(s['nativeLocalBindings']['payloadHash'] == 'payloadHash4' and s['nativeLocalBindings']['rule'] in
                 ('original-reconcile-fourth-parameter-symbol','original-create-fields-hash-call-declaration-symbol'),
                 'NATIVE_LOCAL_IDENTITY')
        exact(s, fields, 'API_SOURCE_SCHEMA')
        bind(s['sourceFile'],s['sourceSha256']); pin(s['compiledSha256'])
        need(integer(s['compiledStart']) and integer(s['compiledEnd']) and 0 <= s['compiledStart'] <= s['compiledEnd']
             and isinstance(s['identifierOnlyEdits'], list) and isinstance(s['bindings'], list), 'API_COMPILED_SPAN')
        for edit in s['identifierOnlyEdits']:
            exact(edit, 'start end text', 'IDENTIFIER_EDIT_SCHEMA')
            need(integer(edit['start']) and integer(edit['end']) and edit['start'] <= edit['end']
                 and isinstance(edit['text'],str), 'IDENTIFIER_EDIT_VALUES')
        for b in s['bindings']:
            need(isinstance(b, dict) and set(b) in BINDING_SCHEMAS, 'BINDING_EXACT_SCHEMA')
            if 'nativeDeclarationSha256' in b:
                pin(b['nativeDeclarationSha256'])

def native_api(data, before, after, path, source_hashes):
    d = decode(data)
    exact(d, 'format baseline candidate patches inverse importsAllByteIdentical '
          'nonTargetDeclarationsAllByteIdentical nonTargetDeclarationCount nonTargetDeclarationDigest '
          'strictNewIdentifiersResolved entrypointExecuted actualDatabaseAccess', 'API_RECORD_SCHEMA')
    exact(d['baseline'], 'sha256 bytes capturedPath productionPath', 'BASELINE_SCHEMA')
    exact(d['candidate'], 'sha256 bytes', 'CANDIDATE_SCHEMA')
    exact(d['inverse'], 'byteExact sha256 unchangedBytes allOutsideSlotsByteIdentical', 'INVERSE_SCHEMA')
    need(d['format'] == 'customer-batch-native-patches-v1' and d['baseline']['productionPath'] == str(path)
         and d['baseline']['sha256'] == H(before) and d['baseline']['bytes'] == len(before)
         and d['candidate'] == {'sha256': H(after), 'bytes': len(after)}, 'FRESH_API_RECORD_BINDING')
    need(all(d[k] is True for k in ('importsAllByteIdentical', 'nonTargetDeclarationsAllByteIdentical',
         'strictNewIdentifiersResolved')) and d['entrypointExecuted'] is False
         and d['actualDatabaseAccess'] is False and d['inverse']['byteExact'] is True
         and d['inverse']['allOutsideSlotsByteIdentical'] is True
         and d['inverse']['sha256'] == H(before), 'NATIVE_FACADE_PROOF_REQUIRED')
    pin(d['nonTargetDeclarationDigest'])
    inverse_patches(before, after, d['patches'], native=True)
    kind = 'front' if str(path).endswith('/front/dist/index.js') else 'admin'
    need({p['name'] for p in d['patches']} == API_PATCH_NAMES[kind], 'FIXED_CUSTOMER_API_PATCH_SCOPE')
    need(re.findall(rb'^import\b[^;]*;', before, re.M) == re.findall(rb'^import\b[^;]*;', after, re.M),
         'IMPORTS_COMPUTED_BYTE_IDENTICAL')
    unchanged = len(before) - sum(p['oldByteEnd']-p['oldByteStart'] for p in d['patches'])
    need(d['inverse']['unchangedBytes'] == unchanged and unchanged >= len(before)*0.70,
         'SOURCEPATCH_NOT_WHOLE_API')
    for p in d['patches']:
        validate_api_source(p['source'], source_hashes)
    # Source compilation/AST binding decisions are independently reviewed, not trusted boolean approval.
    return d

LEAVES = {'T6/BatchUploadSession', 'B3/CustomerSupplyUploadSession', 'mk/CustomerChannelInventory',
          'V3/customerInventoryInput', 'H3/verifiedCustomerInventory',
          'bk/CustomerWorkbenchSupply', 'z3/HistorySession'}

def unb64(value):
    try:
        need(isinstance(value, str), 'BASE64_STRING')
        return base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise ReleaseError('INVALID_BASE64') from exc

def ui_inverse(d, before, after):
    exact(d, 'input output beforeSha256 afterSha256 patches inverseVerified '
          'allBytesOutsideCustomerFunctionsUnchanged', 'UI_DELTA_SCHEMA')
    need(d['beforeSha256'] == H(before) and d['afterSha256'] == H(after)
         and d['inverseVerified'] is True and d['allBytesOutsideCustomerFunctionsUnchanged'] is True,
         'UI_INVERSE_PIN')
    need(isinstance(d['patches'], list) and {p['name'] for p in d['patches']} == LEAVES
         and len(d['patches']) == 7, 'ONLY_CUSTOMER_SEVEN_TOPLEVEL_LEAVES_WITH_EMBEDDED_EIGHTH')
    old16, new16 = before.decode('utf8').encode('utf-16-le'), after.decode('utf8').encode('utf-16-le')
    normalized = []
    for p in d['patches']:
        exact(p, 'name oldStart oldEnd newStart newEnd oldSha256 newSha256 oldBase64 newBase64', 'UI_PATCH_SCHEMA')
        vals = [p[k] for k in ('oldStart','oldEnd','newStart','newEnd')]
        need(all(integer(x) and x >= 0 for x in vals), 'UI_CHAR_OFFSETS')
        a,b,c,e = vals
        old, new = unb64(p['oldBase64']), unb64(p['newBase64'])
        need(old16[a*2:b*2].decode('utf-16-le').encode() == old
             and new16[c*2:e*2].decode('utf-16-le').encode() == new, 'UI_CHAR_SPAN')
        native = p['name'].split('/')[0]
        need(old.startswith(('function ' + native + '(').encode())
             and new.startswith(('function ' + native + '(').encode()), 'SAME_NATIVE_WRAPPER_ABI')
        if native == 'z3':
            need(b'__customerBatchFailures' in new and b'CustomerUploadFailuresDialog' in new,
                 'EMBEDDED_EIGHTH_FAILURES_LEAF_REQUIRED')
        normalized.append(dict(name=p['name'], oldByteStart=len(old16[:a*2].decode('utf-16-le').encode()),
            oldByteEnd=len(old16[:b*2].decode('utf-16-le').encode()),
            newByteStart=len(new16[:c*2].decode('utf-16-le').encode()),
            newByteEnd=len(new16[:e*2].decode('utf-16-le').encode()), oldSha256=p['oldSha256'],
            newSha256=p['newSha256'], oldText=old.decode(), newText=new.decode(), source={}))
    inverse_patches(before, after, normalized, expected_count=7)

def file_pin(data, mode=0o600):
    return dict(sha256=H(data), size=len(data), mode=mode)

def tree_files(root):
    root = no_link(root)
    files, dirs = set(), set()
    for base, ds, ns in os.walk(root, followlinks=False):
        for n in ds + ns:
            p = Path(base) / n
            need(not p.is_symlink(), 'PACKAGE_SYMLINK')
        dirs.update((Path(base)/n).relative_to(root).as_posix() for n in ds)
        files.update((Path(base)/n).relative_to(root).as_posix() for n in ns)
    return files, dirs

def manifest_bindings(m, manifest_sha):
    return dict(manifestSha256=pin(manifest_sha), manifest=m)

def validate_review(data, m, manifest_sha):
    r = decode(data)
    exact(r, 'schema status independent releaseApproved ownerTask scope reviewerScope reviewerHash bindings',
          'REVIEW_EXACT_SCHEMA')
    need(r['schema'] == 'customer-batch-independent-review-v1' and r['status'] == 'passed'
         and r['independent'] is True and r['releaseApproved'] is True
         and r['ownerTask'] == OWNER and r['scope'] == SCOPE
         and isinstance(r['reviewerScope'], str) and len(r['reviewerScope']) >= 8
         and r['reviewerScope'] != SCOPE and r['reviewerScope'] != OWNER
         and r['bindings'] == manifest_bindings(m, manifest_sha), 'INDEPENDENT_HASH_BOUND_REVIEW')
    pin(r['reviewerHash'])
    need(r['reviewerHash'] in [p['sha256'] for n,p in m['packageFiles'].items()
                              if n.startswith('evidence/reviewer/')], 'REVIEWER_REPORT_BYTES_REQUIRED')
    return r

def seal_candidate(spec_path, output, controller_sha):
    """Local packaging only. Does not issue approval or call network/production adapters."""
    need(H(regular(Path(__file__).absolute())) == pin(controller_sha), 'CONTROLLER_PIN')
    s = decode(regular(Path(spec_path).absolute()))
    exact(s, 'schema ownerTask ownerNonce capture ui backend sources evidence', 'CANDIDATE_SPEC_SCHEMA')
    need(s['schema'] == 'customer-batch-candidate-spec-v1' and s['ownerTask'] == OWNER
         and isinstance(s['ownerNonce'], str) and 16 <= len(s['ownerNonce']) <= 4096,
         'RAW_OWNER_NONCE_REQUIRED')
    out = no_link(Path(output).absolute())
    need(not out.exists(), 'NEW_CANDIDATE_DIRECTORY_REQUIRED')
    payload = {}
    def add(name, data):
        rel(name); need(name not in payload, 'PACKAGE_NAME_COLLISION')
        payload[name] = data
    add('capture.json', regular(Path(s['capture']).absolute()))
    cap = decode(payload['capture.json'])
    cfg = Config()
    # A mock capture can be sealed for tests only via direct validate helpers, not this CLI.
    need(cap.get('config') == config_binding(cfg), 'CANDIDATE_FIXED_PRODUCTION_CAPTURE')
    ui = no_link(Path(s['ui']).absolute())
    for n in ('before-index.html','after-index.html'):
        add(n, regular(ui/'package'/n))
    ui_files, _ = tree_files(ui/'package')
    for n in sorted(ui_files - {'before-index.html','after-index.html'}):
        need(n.startswith(('assets/','evidence/')), 'UI_PACKAGE_SCOPE')
        add(n, regular(ui/'package'/n))
    assets = decode(regular(ui/'assets.json'))
    replacements = decode(regular(ui/'replacements.json'))
    css = regular(ui/'css-relative.txt').decode('ascii').strip()
    modules = decode(regular(ui/'modules.json'))
    exact(s['backend'], 'front admin', 'BACKEND_SPEC_SCHEMA')
    for kind, v in s['backend'].items():
        exact(v, 'before after records', 'API_PATH_SPEC_SCHEMA')
        for key, name in [('before','before-' + kind + '-api.js'),
                          ('after','after-' + kind + '-api.js'), ('records',kind + '-patch-records.json')]:
            add(name, regular(Path(v[key]).absolute()))
    need(isinstance(s['sources'], dict) and s['sources'], 'SOURCE_PAYLOAD_REQUIRED')
    hashes = {}
    for name, path in sorted(s['sources'].items()):
        rel(name); data = regular(Path(path).absolute())
        hashes[name] = H(data); add('evidence/source/' + name, data)
    need(isinstance(s['evidence'], dict) and s['evidence'], 'REVIEW_REPORT_AND_BUILD_EVIDENCE_REQUIRED')
    for name, path in sorted(s['evidence'].items()):
        need(rel(name).startswith('evidence/') and not name.startswith('evidence/source/'), 'EVIDENCE_SCOPE')
        add(name, regular(Path(path).absolute()))
    m = dict(schema='customer-batch-sealed-manifest-v1', ownerTask=OWNER, scope=SCOPE,
        ownerNonce=s['ownerNonce'], nonce=cap['nonce'], controllerSha256=controller_sha,
        captureSha256=H(payload['capture.json']), packageFiles={n:file_pin(b) for n,b in sorted(payload.items())},
        sourceHashes=hashes, assets=assets, replacements=replacements, cssRelative=css, modules=modules)
    # Validate from in-memory payload BEFORE creating any directory. TTL is checked by preflight/apply.
    validate_payload(cfg, m, payload, controller_sha)
    out.mkdir(mode=0o700)
    for name, data in payload.items():
        p = out/name
        current = out
        for part in Path(name).parts[:-1]:
            current = current/part
            if not current.exists():
                current.mkdir(mode=0o700)
            private(current)
        exclusive(p, data)
    exclusive(out/'manifest.json', encode(m))
    fsync_dir(out)
    return dict(status='candidate-sealed-not-approved', manifestSha256=H(encode(m)),
                captureSha256=m['captureSha256'], output=str(out),
                packageFiles=len(payload), independentReviewRequired=True, productionWrites=0)

def config_binding(cfg):
    return dict(public=str(cfg.public), apis={k:str(v) for k,v in cfg.apis.items()},
        frontAlias=str(cfg.front_alias), coord=str(cfg.coord), stage=str(cfg.stage),
        locks=[str(x) for x in cfg.locks], nginx=str(cfg.nginx), ops=str(cfg.ops),
        proc=str(cfg.proc), pm2Home=str(cfg.pm2_home), pm2Base=str(cfg.pm2_base), node=str(cfg.node),
        extraProtected=[str(p) for p in cfg.extra_protected], aliases=[str(p) for p in cfg.aliases])

def validate_payload(cfg, m, payload, controller_hash):
    exact(m, 'schema ownerTask scope ownerNonce nonce controllerSha256 captureSha256 packageFiles '
          'sourceHashes assets replacements cssRelative modules', 'MANIFEST_EXACT_SCHEMA')
    need(m['schema'] == 'customer-batch-sealed-manifest-v1' and m['ownerTask'] == OWNER
         and m['scope'] == SCOPE and m['controllerSha256'] == controller_hash
         and isinstance(m['ownerNonce'], str) and 16 <= len(m['ownerNonce']) <= 4096,
         'MANIFEST_SCOPE_SOURCE_NONCE')
    need(set(payload) == set(m['packageFiles']), 'SEALED_PAYLOAD_SET')
    required = {'capture.json', 'before-index.html', 'after-index.html', 'before-front-api.js',
        'after-front-api.js', 'front-patch-records.json', 'before-admin-api.js', 'after-admin-api.js',
        'admin-patch-records.json', 'evidence/html.json', 'evidence/source-files.json', 'evidence/sources.json'}
    need(required <= set(payload) and any(n.startswith('evidence/reviewer/') for n in payload), 'REQUIRED_EVIDENCE')
    for n, b in payload.items():
        rel(n)
        need(n in required or n.startswith(('assets/','evidence/')), 'PACKAGE_SCOPE')
        exact(m['packageFiles'][n], 'sha256 size mode', 'PAYLOAD_PIN_SCHEMA')
        need(m['packageFiles'][n] == file_pin(b), 'PAYLOAD_HASH_SIZE_MODE')
    c = decode(payload['capture.json'])
    exact(c, 'schema ownerTask scope nonce capturedAtUtc ttlSeconds controllerSha256 config '
          'coordBase64 coordRecord protectedFiles processes transport protectionUnion environmentValuesExported '
          'productionWrites canonicalMetadataSha256', 'CAPTURE_EXACT_SCHEMA')
    need(c['schema'] == 'customer-batch-capture-v1' and c['ownerTask'] == OWNER and c['scope'] == SCOPE
         and c['controllerSha256'] == controller_hash and c['config'] == config_binding(cfg)
         and c['nonce'] == m['nonce'] and re.fullmatch(r'[a-f0-9]{32}', c['nonce'])
         and H(payload['capture.json']) == pin(m['captureSha256']) and c['ttlSeconds'] == TTL
         and c['environmentValuesExported'] is False and c['productionWrites'] == 0,
         'CAPTURE_SCOPE_BINDING')
    coord = unb64(c['coordBase64'])
    need(H(coord) == c['coordRecord']['sha256'], 'RAW_COORD_PIN')
    state = coord_closed(coord)
    paths, links = union(cfg, state)
    expected_union = dict(paths=[str(p) for p in paths], links={str(a):str(t) for a,t in sorted(links.items())})
    need(c['protectionUnion'] == expected_union, 'FULL_COORD_PROTECTED_UNION_BINDING')
    ids = identity(cfg, c['processes'])
    need(H(encode(c['protectedFiles'])) == c['canonicalMetadataSha256'], 'CANONICAL_FULL_METADATA_PIN')
    need(isinstance(m['sourceHashes'], dict) and m['sourceHashes'], 'SOURCE_HASH_MAP')
    for src, digest in m['sourceHashes'].items():
        rel(src)
        need('evidence/source/' + src in payload and H(payload['evidence/source/' + src]) == pin(digest),
             'SOURCE_BYTES_HASH_BOUND')
    need({n for n in payload if n.startswith('evidence/source/')} ==
         {'evidence/source/' + n for n in m['sourceHashes']}, 'EXACT_SOURCE_PAYLOAD_SET')
    for kind, path in cfg.apis.items():
        before, after = payload['before-'+kind+'-api.js'], payload['after-'+kind+'-api.js']
        r = c['protectedFiles'].get(str(path))
        need(r and r['kind'] == 'file' and r['sha256'] == H(before) and r['size'] == len(before)
             and r['nlink'] == 1, 'FRESH_FULL_API_BASELINE')
        native_api(payload[kind+'-patch-records.json'], before, after, path, m['sourceHashes'])
    before, after = payload['before-index.html'], payload['after-index.html']
    need(c['protectedFiles'][str(cfg.html)]['sha256'] == H(before), 'FRESH_HTML_SOURCE')
    need(isinstance(m['assets'], list) and len(m['assets']) == 3, 'TWO_JS_ONE_SCOPED_CSS')
    aset = {}
    for a in m['assets']:
        exact(a, 'relative sha256 size', 'ASSET_SCHEMA')
        n = rel(a['relative']); h = pin(a['sha256'])
        need(re.fullmatch(r'assets/(BusinessWorkbenchPage-customer-batch-[a-f0-9]{16,64}\.js|'
             r'customer-batch-actions-[a-f0-9]{16,64}\.css)', n), 'ASSET_FIXED_NAMES')
        suffix = re.search(r'-([a-f0-9]+)\.(js|css)$', n)
        need(h.startswith(suffix[1]) and n not in aset and payload.get(n) is not None
             and H(payload[n]) == h and integer(a['size']) and len(payload[n]) == a['size'], 'IMMUTABLE_ASSET_PROOF')
        aset[n] = a
        oldrecord = c['protectedFiles'].get(str(cfg.public/n))
        if oldrecord is not None:
            need(oldrecord['kind'] == 'file' and oldrecord['sha256'] == h and oldrecord['size'] == a['size']
                 and stat.S_IMODE(oldrecord['statmode']) == 0o644 and oldrecord['nlink'] == 1,
                 'PREEXISTING_ASSET_ONLY_IDENTICAL')
    js = {n for n in aset if n.endswith('.js')}
    need(len(js) == 2 and m['cssRelative'] in aset and m['cssRelative'].endswith('.css')
         and {n for n in payload if n.startswith('assets/')} == set(aset), 'EXACT_ASSET_SET')
    css = payload[m['cssRelative']].decode('utf8')
    # CSS selector safety is independently AST-reviewed; require scoped roots on every selector prelude.
    css_clean = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    for selector in re.findall(r'([^{}]+)\{', css_clean):
        need(not selector.strip().startswith('@') and all(any(root in one for root in
             ('.customer-upload-history', '.customer-channel-inventory', '.customer-supply-dialog'))
             for one in selector.split(',')), 'CUSTOMER_SCOPED_CSS_ONLY')
    need(isinstance(m['modules'], list) and len(m['modules']) == 2
         and isinstance(m['replacements'], list) and len(m['replacements']) == 2, 'EXACT_TWO_MODULES')
    olds, news, patched, counts = set(), set(), before, {}
    for module, replacement in zip(m['modules'], m['replacements']):
        exact(module, 'before after sha256 size', 'MODULE_SCHEMA')
        exact(replacement, 'before after', 'HTML_REPLACEMENT_SCHEMA')
        old, new = module['before'], module['after']
        need(re.fullmatch(r'assets/BusinessWorkbenchPage-[A-Za-z0-9_.-]+\.js', rel(old))
             and new in js and old not in olds and new not in news
             and replacement == {'before':'/'+old, 'after':'/'+new}
             and module['sha256'] == aset[new]['sha256'] and module['size'] == aset[new]['size'], 'ONLY_TWO_QUOTED_MAPPING')
        olds.add(old); news.add(new)
        ob, nb = ('/'+old).encode(), ('/'+new).encode()
        need(nb not in before and before.count(ob) > 0, 'OLD_PRESENT_NEW_ABSENT')
        for hit in re.finditer(re.escape(ob), before):
            i = hit.start(); q = before[i-1:i]
            need(i > 0 and q in (b'\"', b"'") and before[i+len(ob):i+len(ob)+1] == q,
                 'ONLY_COMPLETE_QUOTED_HTML_REFERENCE')
        counts['/'+old] = before.count(ob)
        patched = patched.replace(ob, nb)
        old_payload = 'evidence/baseline/' + old
        need(old_payload in payload and c['protectedFiles'][str(cfg.public/old)]['sha256'] == H(payload[old_payload]),
             'CAPTURED_WORKBENCH_SOURCE_BYTES_REQUIRED')
        delta = decode(payload['evidence/' + Path(old).name + '.delta.json'])
        need(delta['input'] == old and delta['output'] == new, 'UI_DELTA_MODULE_SCOPE')
        ui_inverse(delta, payload[old_payload], payload[new])
        need('evidence/' + Path(old).name + '.abi.json' in payload, 'NATIVE_ABI_SOURCE_EVIDENCE')
    need(news == js and before.count(b'</head>') == 1, 'NEW_BOTH_REFERENCED_SINGLE_HEAD')
    link = ('<link rel="stylesheet" href="/' + m['cssRelative'] + '">\n').encode()
    need(('/'+m['cssRelative']).encode() not in before and before != after, 'NEW_CSS_ONLY')
    patched = patched.replace(b'</head>', link+b'</head>')
    inverse = after.replace(link, b'', 1)
    for r in m['replacements']:
        inverse = inverse.replace(r['after'].encode(), r['before'].encode())
    need(patched == after and inverse == before, 'HTML_QUOTED_MAP_PLUS_CSSLINK_EXACT_INVERSE')
    he = decode(payload['evidence/html.json'])
    need(he == dict(beforeSha256=H(before), afterSha256=H(after), counts=counts,
         link=link.decode(), inverseVerified=True), 'HTML_SOURCE_EVIDENCE_EXACT')
    sf = decode(payload['evidence/source-files.json'])
    exact(sf, 'sourceHashes sourceStableDuringBuild embeddedFailuresIncluded compiler esbuildVersion builderSha256',
          'UI_SOURCE_FILE_SCHEMA')
    need(sf['sourceStableDuringBuild'] is True and sf['embeddedFailuresIncluded'] is True
         and sf['compiler'] == 'esbuild.transform' and all(m['sourceHashes'].get(n) == h
         for n,h in sf['sourceHashes'].items()), 'UI_SOURCE_HASH_BINDING')
    need(pin(sf['builderSha256']) in m['sourceHashes'].values(), 'BUILDER_SOURCE_BYTES_REQUIRED')
    sources = decode(payload['evidence/sources.json'])
    need(isinstance(sources, list) and len(sources) == 7, 'SEVEN_SOURCE_LEAVES_AND_EMBEDDED_FAILURES')
    for v in sources:
        exact(v, 'file name native sourceSha256 compiledSha256', 'UI_SOURCE_LEAF_SCHEMA')
        need(v['native']+'/'+v['name'] in LEAVES and m['sourceHashes'].get(v['file']) == v['sourceSha256'],
             'UI_LEAF_COMPILED_SOURCE_BINDING')
        pin(v['compiledSha256'])
    return dict(c=c, coord=coord, ids=ids, m=m, payload=payload)

class Controller:
    def __init__(self, cfg=None, row_reader=None, transport_reader=None, reload_adapter=None,
                 get_reader=None, listener_reader=None):
        self.cfg = cfg or Config()
        self.hash = H(regular(Path(__file__).absolute()))
        if not self.cfg.mock:
            need(all(x is None for x in (row_reader, transport_reader, reload_adapter, get_reader, listener_reader)),
                 'PRODUCTION_ADAPTER_INJECTION_REFUSED')
        self.row_reader = row_reader or snapshot_rows
        self.transport_reader = transport_reader or transport
        self.reload_adapter = reload_adapter or rpc
        self.get_reader = get_reader or get_http
        self.listener_reader = listener_reader or listener
        self.sequence = 0
        self.state_hash = None
        self.b = None
        self.st = None
        self.recovery_approval = None
        self.recovery_approval_sha = None
        self.journal_uncertain = False
        self.pending_state_hash = None

    def no_replay(self):
        if self.cfg.receipt.exists() or self.cfg.receipt.is_symlink():
            raise ReleaseError('DURABLE_ATTEMPT_NO_REPLAY')

    def snapshot(self, tr, paths, links):
        check_locks()
        need(H(regular(Path(__file__).absolute())) == self.hash, 'CONTROLLER_SOURCE_DRIFT')
        need(self.transport_reader(self.cfg) == tr, 'SOCKET_ADAPTER_SOURCE_DRIFT')
        rows = self.row_reader(self.cfg, tr)
        identity(self.cfg, rows)
        return dict(processes=rows, protectedFiles=inventory(self.cfg, rows, paths, links), transport=tr)

    def health(self, snap, include_assets=False):
        cfg = self.cfg
        for name, host, root in [('dianzi51','51dianzi.com',cfg.front),
                                 ('dianzi51-admin','admin.51dianzi.com',cfg.public)]:
            expected = snap['protectedFiles'][str(root/'index.html')]['sha256']
            need(H(self.get_reader(cfg, host, '')) == expected, 'HTTPS_ROOT_BODY')
            row = next(r for r in snap['processes'] if r['name'] == name)
            need(self.transport_reader(cfg) == snap['transport'], 'HEALTH_PRE_SOCKET_SHA')
            need(self.listener_reader(cfg, row, expected) is True, 'LISTENER_GET_VERIFY')
            need(self.transport_reader(cfg) == snap['transport'], 'HEALTH_POST_SOCKET_SHA')
        if include_assets:
            for a in self.b['m']['assets']:
                need(H(self.get_reader(cfg, 'admin.51dianzi.com', a['relative'])) == a['sha256'], 'HTTPS_ASSET_BODY')

    def capture(self):
        with locked(self.cfg):
            self.no_replay()
            at = now()
            raw = regular(self.cfg.coord); cr = describe(self.cfg.coord)
            state = coord_closed(raw)
            paths, links = union(self.cfg, state)
            tr = self.transport_reader(self.cfg)
            snap = self.snapshot(tr, paths, links)
            self.health(snap)
            need(self.snapshot(tr, paths, links) == snap and regular(self.cfg.coord) == raw
                 and describe(self.cfg.coord) == cr, 'CAPTURE_FULLMETA_DRIFT')
            c = dict(schema='customer-batch-capture-v1', ownerTask=OWNER, scope=SCOPE,
                nonce=uuid.uuid4().hex, capturedAtUtc=at, ttlSeconds=TTL, controllerSha256=self.hash,
                config=config_binding(self.cfg), coordBase64=base64.b64encode(raw).decode(), coordRecord=cr,
                protectionUnion=dict(paths=[str(p) for p in paths], links={str(a):str(t) for a,t in sorted(links.items())}),
                environmentValuesExported=False, productionWrites=0,
                canonicalMetadataSha256=H(encode(snap['protectedFiles'])), **snap)
            fresh(c)
            return c

    def bundle(self, package, manifest_sha, review_sha=None, require_fresh=True):
        p = no_link(Path(package).absolute())
        private(p)
        mb = regular(p/'manifest.json')
        need(H(mb) == pin(manifest_sha), 'MANIFEST_PIN')
        m = decode(mb)
        files, dirs = tree_files(p)
        need(files == set(m['packageFiles']) | {'manifest.json'} | ({'review.json'} if 'review.json' in files else set()),
             'NO_UNKNOWN_PACKAGE_FILES')
        expected_dirs = {v.as_posix() for n in m['packageFiles'] for v in Path(n).parents if v.as_posix() != '.'}
        need(dirs == expected_dirs, 'NO_UNKNOWN_PACKAGE_DIRECTORIES')
        payload = {}
        for n, r in m['packageFiles'].items():
            rel(n); payload[n] = regular(p/n)
            need(stat.S_IMODE(meta(p/n)['statmode']) == 0o600 and meta(p/n)['nlink'] == 1,
                 'PACKAGE_FILE_MODE_OR_HARDLINK')
        for d in dirs:
            private(p/d)
        for name in ('manifest.json', 'review.json'):
            if name in files:
                need(stat.S_IMODE(meta(p/name)['statmode']) == 0o600 and meta(p/name)['nlink'] == 1,
                     'CONTROL_FILE_MODE_OR_HARDLINK')
        b = validate_payload(self.cfg, m, payload, self.hash)
        if require_fresh:
            fresh(b['c'])
        if review_sha is not None:
            rb = regular(p/'review.json')
            need(H(rb) == pin(review_sha), 'REVIEW_PIN')
            validate_review(rb, m, manifest_sha)
        b.update(package=str(p), manifestSha256=manifest_sha, reviewSha256=review_sha)
        return b

    def baseline_guard(self, b):
        paths = tuple(Path(p) for p in b['c']['protectionUnion']['paths'])
        links = {Path(a):Path(t) for a,t in b['c']['protectionUnion']['links'].items()}
        snap = self.snapshot(b['c']['transport'], paths, links)
        need(snap == {k:b['c'][k] for k in ('processes','protectedFiles','transport')}, 'FOREIGN_FULLMETA_PROCESS_DRIFT')
        need(regular(self.cfg.coord) == b['coord'] and describe(self.cfg.coord) == b['c']['coordRecord'], 'COORD_FULL_CAS')
        return snap

    def preflight(self, package, manifest_sha, review_sha):
        with locked(self.cfg):
            self.no_replay()
            private(self.cfg.stage)
            need(Path(package).absolute() == self.cfg.package, 'FIXED_STAGE_PACKAGE')
            b = self.bundle(package, manifest_sha, review_sha)
            snap = self.baseline_guard(b)
            self.b = b
            self.health(snap)
            self.baseline_guard(b)
            need(all(meta(p)['dev'] == meta(self.cfg.stage)['dev'] for p in
                     [self.cfg.coord,self.cfg.html,*self.cfg.apis.values()]), 'SAME_FS_REQUIRED')
            return dict(status='preflight-passed', productionWrites=0, reloadScope=b['ids'],
                manifestSha256=manifest_sha, reviewSha256=review_sha,
                captureSha256=b['m']['captureSha256'], protectedRecords=len(snap['protectedFiles']))

    def sealed_guard(self):
        b = self.b; p = Path(b['package'])
        private(self.cfg.stage); private(p); private(self.cfg.receipt)
        need(H(regular(Path(__file__).absolute())) == self.hash, 'CONTROLLER_SOURCE_DRIFT')
        need(H(regular(p/'manifest.json')) == b['manifestSha256']
             and H(regular(p/'review.json')) == b['reviewSha256'], 'MANIFEST_REVIEW_DRIFT')
        files, dirs = tree_files(p)
        need(files == set(b['m']['packageFiles']) | {'manifest.json','review.json'}, 'PACKAGE_SET_DRIFT')
        expected_dirs = {v.as_posix() for n in b['m']['packageFiles'] for v in Path(n).parents if v.as_posix() != '.'}
        need(dirs == expected_dirs, 'SEALED_DIRECTORY_SET_DRIFT')
        for d in dirs:
            private(p/d)
        for n in ('manifest.json','review.json'):
            need(stat.S_IMODE(meta(p/n)['statmode']) == 0o600 and meta(p/n)['nlink'] == 1, 'CONTROL_MODE_DRIFT')
        for n, r in b['m']['packageFiles'].items():
            need(file_pin(regular(p/n)) == r and stat.S_IMODE(meta(p/n)['statmode']) == 0o600
                 and meta(p/n)['nlink'] == 1, 'SEALED_SOURCE_PAYLOAD_DRIFT')

    def state_invariants(self, st):
        base = self.b['c']['protectedFiles']
        files = st['protectedFiles']
        own = {str(self.cfg.html), *(str(p) for p in self.cfg.apis.values())}
        parents = {str(Path(p).parent) for p in own} | {str(self.cfg.public/'assets')}
        allowed_assets = {a['relative']:a for a in self.b['m']['assets']}
        need(len(st['assets']) == len(set(st['assets'])) and set(st['assets']) <= set(allowed_assets), 'STATE_ASSET_SCOPE')
        added = {str(self.cfg.public/n) for n in st['assets']} - set(base)
        need(set(files) == set(base) | added, 'STATE_FULL_INVENTORY_SCOPE')
        need(set(st['targets']) == {'front','admin','html'} and all(v in ('before','candidate')
             for v in st['targets'].values()), 'STATE_TARGET_MODES')
        for key, path in [('html',self.cfg.html), *self.cfg.apis.items()]:
            n = (('after-' if st['targets'][key] == 'candidate' else 'before-') +
                 ('index.html' if key == 'html' else key+'-api.js'))
            need(files[str(path)]['sha256'] == H(self.b['payload'][n])
                 and files[str(path)]['size'] == len(self.b['payload'][n]), 'STATE_ONLY_OWN_TARGET_BYTES')
        raw = unb64(st['coordBase64'])
        need(st['coordRecord']['sha256'] == H(raw) and all(st['coordRecord'][k] == self.b['c']['coordRecord'][k]
             for k in ('kind','statmode','uid','gid','dev','nlink')), 'STATE_COORD_BYTES_OWNER_MODE')
        if raw != self.b['coord']:
            beforecoord, currentcoord = decode(self.b['coord']), decode(raw)
            mutable = {'shared_release_active','window','window_history','updated_at'}
            need({k:v for k,v in beforecoord.items() if k not in mutable} ==
                 {k:v for k,v in currentcoord.items() if k not in mutable}, 'STATE_COORD_FOREIGN_FIELDS')
            history = beforecoord['window_history']
            need(currentcoord['window_history'][:len(history)] == history, 'STATE_FULL_HISTORY_RAW_SIGNED_OWNER_NONCE')
            w = currentcoord['window']
            need(all(w.get(k) == v for k,v in dict(owner_task=OWNER,scope=SCOPE,nonce=self.b['m']['nonce'],
                ownerNonce=self.b['m']['ownerNonce'],manifestSha256=self.b['manifestSha256'],
                controllerSha256=self.hash,attemptSha256=self.attempt_hash,reloadScope=self.b['ids']).items()),
                'STATE_OWN_COORD_ATTEMPT')
        fixed = ('kind','statmode','uid','gid','dev','nlink')
        for path, old in base.items():
            current = files[path]
            if path in own:
                need(all(current[k] == old[k] for k in fixed), 'STATE_TARGET_OWNER_MODE')
            elif path in parents:
                need(old['kind'] == current['kind'] == 'directory' and all(current[k] == old[k]
                     for k in (*fixed,'ino')), 'STATE_OWN_PARENT_IDENTITY')
            else:
                need(current == old, 'STATE_FOREIGN_FULLMETA_NOT_REBASEABLE')
        hm = base[str(self.cfg.html)]
        for n in st['assets']:
            path = str(self.cfg.public/n)
            if path not in base:
                a = allowed_assets[n]; current = files[path]
                need(current['kind'] == 'file' and current['sha256'] == a['sha256'] and current['size'] == a['size']
                     and stat.S_IMODE(current['statmode']) == 0o644 and current['uid'] == hm['uid']
                     and current['gid'] == hm['gid'] and current['nlink'] == 1, 'STATE_IMMUTABLE_ASSET_BYTES_OWNER')
        original = {x['id']:x for x in self.b['c']['processes']}
        expected = {i:dict(pid=x['pid'],restarts=x['restarts'],rawSha256=x['rawSha256'],nodeUniqueId=x['nodeUniqueId'],
                          pm2RawMeta=x['pm2RawMeta'])
                    for i,x in original.items()}
        loaded = set()
        for event_index, e in enumerate(st['events']):
            exact(e, 'id rollback beforePid afterPid beforeRestart afterRestart observedPidChange transportPassed '
                  'apiSha256 beforeRawSha256 afterRawSha256 semanticSha256 beforeUniqueId afterUniqueId '
                  'beforePm2RawMeta afterPm2RawMeta attemptSha256 intentStateSha256 intentSequence observedAtUtc',
                  'EVENT_EXACT_SCHEMA')
            i = e['id']
            need(i in expected and e['beforePm2RawMeta'] == expected[i]['pm2RawMeta'],
                 'STATE_PM2_META_CHAIN')
            need(integer(e['intentSequence']) and e['intentSequence'] > 0
                 and e['attemptSha256'] == self.attempt_hash, 'STATE_DURABLE_INTENT_ATTEMPT')
            intent_raw = regular(self.cfg.receipt/('state-%06d.json' % e['intentSequence']))
            intent = decode(intent_raw)
            need(H(intent_raw) == pin(e['intentStateSha256'])
                 and intent.get('attemptSha256') == self.attempt_hash
                 and intent.get('sequence') == e['intentSequence']
                 and all(intent.get(k) == v for k,v in self.common().items())
                 and intent.get('operation') == (('rollback-reload-intent-' if e['rollback'] else 'reload-intent-') + str(i))
                 and intent['state']['events'] == st['events'][:event_index]
                 and intent['state']['transport'] == self.b['c']['transport']
                 and intent['state']['processes'] == [dict(original[j], **expected[j]) for j in sorted(original)]
                 and set(intent['state']['loadedSlots']) == loaded
                 and len(intent['state']['loadedSlots']) == len(loaded)
                 and (event_index == 0 or e['intentSequence'] > st['events'][event_index-1]['intentSequence']),
                 'STATE_DURABLE_SINGLE_SLOT_INTENT')
            need(i in self.b['ids'] and type(e['rollback']) is bool and type(e['transportPassed']) is bool
                 and type(e['observedPidChange']) is bool and e['beforePid'] == expected[i]['pid']
                 and e['beforeRestart'] == expected[i]['restarts'] and e['beforeRawSha256'] == expected[i]['rawSha256']
                 and e['semanticSha256'] == original[i]['semanticSha256'], 'STATE_EVENT_TRANSITION_BINDING')
            kind = 'front' if original[i]['script'] == str(self.cfg.front_api) else 'admin'
            content = self.b['payload'][('before-' if e['rollback'] else 'after-')+kind+'-api.js']
            need(e['apiSha256'] == H(content)
                 and intent['state']['targets'][kind] == ('before' if e['rollback'] else 'candidate')
                 and intent['state']['protectedFiles'][original[i]['script']]['sha256'] == e['apiSha256'],
                 'STATE_EVENT_ONLY_OWN_API_PAYLOAD')
            if e['observedPidChange']:
                pm2_meta_transition(e['beforePm2RawMeta'], e['afterPm2RawMeta'],
                    int(dt.datetime.fromisoformat(intent['recordedAtUtc']).timestamp()*1000),
                    int(dt.datetime.fromisoformat(e['observedAtUtc']).timestamp()*1000))
                need(e['afterPid'] != e['beforePid'] and e['afterRestart'] == e['beforeRestart']+1
                     and e['beforeUniqueId'] == expected[i]['nodeUniqueId']
                     and integer(e['afterUniqueId']) and e['afterUniqueId'] > e['beforeUniqueId']
                     and (i in loaded if e['rollback'] else i not in loaded), 'STATE_SINGLE_RELOAD_EVENT')
                if e['rollback']:loaded.remove(i)
                else:loaded.add(i)
            else:
                need(e['afterPid'] == e['beforePid'] and e['afterRestart'] == e['beforeRestart']
                     and e['afterRawSha256'] == e['beforeRawSha256']
                     and e['beforeUniqueId'] == e['afterUniqueId'] == expected[i]['nodeUniqueId']
                     and e['beforePm2RawMeta'] == e['afterPm2RawMeta'], 'STATE_NONTRANSITION_EXACT')
            expected[i] = dict(pid=e['afterPid'],restarts=e['afterRestart'],rawSha256=e['afterRawSha256'],
                               nodeUniqueId=e['afterUniqueId'],pm2RawMeta=e['afterPm2RawMeta'])
        need(set(st['loadedSlots']) == loaded and len(st['loadedSlots']) == len(loaded), 'STATE_LOADED_EVENT_PROOF')
        ignore = {'pid','restarts','rawSha256','nodeUniqueId','pm2RawMeta'}
        need(set(original) == {x['id'] for x in st['processes']}, 'STATE_PROCESS_ID_SET')
        for row in st['processes']:
            old = original[row['id']]
            need({k:v for k,v in row.items() if k not in ignore} == {k:v for k,v in old.items() if k not in ignore}
                 and all(row[k] == v for k,v in expected[row['id']].items()), 'STATE_OTHER_SIX_RAW_CONFIG_SEMANTICS')

    def current_snapshot(self):
        c = self.b['c']
        return self.snapshot(c['transport'], tuple(Path(p) for p in c['protectionUnion']['paths']),
                             {Path(a):Path(t) for a,t in c['protectionUnion']['links'].items()})

    def guard(self, forward=False):
        if forward:
            fresh(self.b['c'])
        if self.recovery_approval is not None:
            fresh(dict(capturedAtUtc=self.recovery_approval['approvedAtUtc'],
                       ttlSeconds=self.recovery_approval['ttlSeconds']))
            approval_raw = regular(self.cfg.stage/'rollback-review.json')
            need(H(approval_raw) == self.recovery_approval_sha and decode(approval_raw) == self.recovery_approval
                 and H(regular(self.cfg.stage/'rollback-reviewer-report.txt')) == self.recovery_approval['reviewerHash'],
                 'RECOVERY_APPROVAL_REPORT_SEAL_DRIFT')
        need(not self.journal_uncertain, 'JOURNAL_DURABILITY_UNCERTAIN_NO_CONTINUE')
        self.sealed_guard()
        self.state_invariants(self.st)
        need(regular(self.cfg.coord) == unb64(self.st['coordBase64'])
             and describe(self.cfg.coord) == self.st['coordRecord'], 'COORD_OWNERSHIP_FULLMETA_LOST')
        snap = self.current_snapshot()
        need(snap == {k:self.st[k] for k in ('processes','protectedFiles','transport')}, 'FULLGUARD_FOREIGN_DRIFT')
        return snap

    def common(self):
        b = self.b
        return dict(ownerTask=OWNER, scope=SCOPE, nonce=b['m']['nonce'], ownerNonce=b['m']['ownerNonce'],
                    controllerSha256=self.hash, manifestSha256=b['manifestSha256'],
                    reviewSha256=b['reviewSha256'], captureSha256=b['m']['captureSha256'])

    def checkpoint(self, operation):
        need(not self.journal_uncertain, 'JOURNAL_DURABILITY_UNCERTAIN_NO_REPLAY')
        self.sequence += 1
        doc = dict(schema='customer-batch-durable-state-v1', **self.common(),
                   attemptSha256=self.attempt_hash, sequence=self.sequence, previousSha256=self.state_hash,
                   operation=operation, recordedAtUtc=now(), state=copy.deepcopy(self.st))
        data = encode(doc)
        self.pending_state_hash = H(data)
        try:
            exclusive(self.cfg.receipt/('state-%06d.json' % self.sequence), data)
        except BaseException:
            self.journal_uncertain = True
            raise
        self.state_hash = H(data)
        self.pending_state_hash = None
        return doc

    def set_parent(self, path):
        parent = str(Path(path).parent)
        if parent in self.st['protectedFiles']:
            old, new = self.st['protectedFiles'][parent], describe(Path(parent))
            need(old['kind'] == new['kind'] == 'directory' and all(old[k] == new[k]
                 for k in ('dev','ino','statmode','uid','gid','nlink')), 'OWN_PARENT_IDENTITY_DRIFT')
            self.st['protectedFiles'][parent] = new

    def change_file(self, key, after, forward=False):
        path = self.cfg.html if key == 'html' else self.cfg.apis[key]
        before_name = 'before-index.html' if key == 'html' else 'before-'+key+'-api.js'
        after_name = 'after-index.html' if key == 'html' else 'after-'+key+'-api.js'
        old_after = self.st['targets'][key] == 'candidate'
        need(after != old_after, 'NO_REPEATED_TARGET_WRITE')
        self.guard(forward)
        before = self.b['payload'][after_name if old_after else before_name]
        content = self.b['payload'][after_name if after else before_name]
        expected = self.st['protectedFiles'][str(path)]
        def remember(record):
            self.st['protectedFiles'][str(path)] = record
            self.st['targets'][key] = 'candidate' if after else 'before'
            self.set_parent(path)
            self.checkpoint(('apply-' if after else 'rollback-') + key + '-rename')
        cas(path, expected, before, content, self.cfg.stage, remember)
        self.guard(forward)

    def change_coord(self, raw, operation):
        expected, old = self.st['coordRecord'], unb64(self.st['coordBase64'])
        self.guard()
        def remember(record):
            self.st['coordBase64'] = base64.b64encode(raw).decode()
            self.st['coordRecord'] = record
            self.checkpoint(operation + '-coord-rename')
        cas(self.cfg.coord, expected, old, raw, self.cfg.stage, remember)
        self.guard()

    def owned_window(self):
        c = decode(unb64(self.st['coordBase64']))
        w = c.get('window', {})
        need(isinstance(w, dict) and all(w.get(k) == v for k,v in
             dict(owner_task=OWNER, scope=SCOPE, nonce=self.b['m']['nonce'],
                  ownerNonce=self.b['m']['ownerNonce'], manifestSha256=self.b['manifestSha256'],
                  controllerSha256=self.hash, attemptSha256=self.attempt_hash,
                  reviewSha256=self.b['reviewSha256'], captureSha256=self.b['m']['captureSha256'],
                  reloadScope=self.b['ids']).items()), 'OWN_ATTEMPT_WINDOW_REQUIRED')
        return c

    def close(self, outcome):
        self.guard()
        c = self.owned_window()
        need(c.get('shared_release_active') is True and c['window'].get('status') == 'open', 'OWN_OPEN_WINDOW_REQUIRED')
        closed = dict(c['window'], status='closed', outcome=outcome, closedAtUtc=now(),
                      needsOperatorRecovery=False, stateBeforeCloseSha256=self.state_hash)
        # Preserve all prior history objects and opaque signed ownerNonce strings unchanged.
        c['window_history'].append(copy.deepcopy(closed))
        c['window'] = closed; c['shared_release_active'] = False; c['updated_at'] = now()
        self.change_coord(encode(c), 'close-' + outcome)

    def receipt_proof(self, receipt, outcome):
        """No status-only success: actual closed raw bytes + durable latest state."""
        self.guard()
        c = self.owned_window()
        raw = regular(self.cfg.coord)
        need(c.get('shared_release_active') is False and c['window'].get('status') == 'closed'
             and c['window'].get('outcome') == outcome
             and c['window'].get('needsOperatorRecovery') is False
             and c.get('needsOperatorRecovery', False) is False
             and isinstance(c['window'].get('closedAtUtc'), str) and c['window']['closedAtUtc']
             and c['window_history'] and c['window_history'][-1] == c['window'],
             'ACTUAL_OWN_CLOSED_COORD_REQUIRED')
        latest = regular(self.cfg.receipt/('state-%06d.json' % self.sequence))
        state_doc = decode(latest)
        need(H(latest) == self.state_hash and state_doc.get('state') == self.st
             and state_doc.get('sequence') == self.sequence
             and state_doc.get('attemptSha256') == self.attempt_hash
             and all(state_doc.get(k) == v for k,v in self.common().items())
             and H(regular(self.cfg.receipt/'attempt.json')) == self.attempt_hash,
             'DURABLE_LATEST_STATE_ATTEMPT_BINDING')
        need(receipt.get('schema') == ('customer-batch-receipt-v1' if outcome == 'verified'
             else 'customer-batch-rollback-receipt-v1')
             and receipt.get('status') == outcome and receipt.get('stateSha256') == self.state_hash
             and receipt.get('stateSequence') == self.sequence
             and receipt.get('attemptSha256') == self.attempt_hash
             and all(receipt.get(k) == v for k,v in self.common().items())
             and receipt.get('coordSha256') == H(raw) == H(unb64(self.st['coordBase64']))
             and receipt.get('reloadEvents') == self.st['events']
             and receipt.get('assetsRetained') is True
             and receipt.get('databaseWrites') == receipt.get('envWrites') == 0,
             'DURABLE_RECEIPT_ACTUAL_COORD_BINDING')
        target = 'candidate' if outcome == 'verified' else 'before'
        need(self.st['targets'] == dict(front=target, admin=target, html=target)
             and set(self.st['loadedSlots']) == (set(self.b['ids']) if outcome == 'verified' else set()),
             'RECEIPT_TARGET_RELOAD_COMPLETENESS')
        if outcome == 'verified':
            need(receipt.get('canonicalMetadataSha256') == H(encode(self.st['protectedFiles']))
                 and receipt.get('reloadScope') == self.b['ids']
                 and receipt.get('otherSixSlotsRawExact') is True and receipt.get('frontStaticWrites') == 0,
                 'VERIFIED_FULL_BOUNDARIES_RECEIPT')
        else:
            need(receipt.get('rollbackAttemptSha256') == H(regular(self.cfg.receipt/'rollback-attempt.json')),
                 'ROLLBACK_RECEIPT_ATTEMPT_BINDING')
        return H(raw)

    def durable_success(self, receipt, name, outcome):
        self.receipt_proof(receipt, outcome)
        raw = encode(receipt)
        exclusive(self.cfg.receipt/name, raw)  # file AND receipt directory fsynced
        need(regular(self.cfg.receipt/name) == raw, 'DURABLE_RECEIPT_READBACK')
        self.receipt_proof(decode(regular(self.cfg.receipt/name)), outcome)
        return receipt

    def retain_owned_hold(self):
        """Narrow full-CAS failure hold only; never repair foreign coord or clear locks."""
        check_locks()
        need(len(ACTIVE_LOCKS) == 2 and {x[0] for x in ACTIVE_LOCKS} ==
             {p.resolve(strict=True) for p in self.cfg.locks}, 'OWN_DUAL_LOCKS_REQUIRED_FOR_HOLD')
        c = self.owned_window()
        old = unb64(self.st['coordBase64'])
        need(regular(self.cfg.coord) == old and describe(self.cfg.coord) == self.st['coordRecord'],
             'FAILURE_HOLD_FOREIGN_COORD_NO_WRITE')
        need((c.get('shared_release_active') is True and c['window'].get('status') in ('open','recovery-required'))
             or (c.get('shared_release_active') is False and c['window'].get('status') == 'closed'),
             'FAILURE_HOLD_ONLY_OWN_WINDOW')
        c['window'] = dict(c['window'], status='recovery-required', needsOperatorRecovery=True,
                           recoveryRequiredAtUtc=now())
        c['shared_release_active'] = True; c['updated_at'] = now()
        raw = encode(c)
        def remember(record):
            self.st['coordBase64'] = base64.b64encode(raw).decode()
            self.st['coordRecord'] = record
            self.checkpoint('failure-owned-hold-coord-rename')
        cas(self.cfg.coord, self.st['coordRecord'], old, raw, self.cfg.stage, remember)
        return H(raw)

    def add_asset(self, a):
        self.guard(True)
        n = a['relative']; p = self.cfg.public/n
        if str(p) in self.st['protectedFiles']:
            need(regular(p) == self.b['payload'][n], 'EXISTING_ASSET_IMMUTABLE')
            self.st['assets'].append(n)
            self.checkpoint('identical-existing-asset')
            return
        need(not p.exists() and not p.is_symlink() and p.parent.is_dir(), 'NEW_ASSET_ABSENT_CAS')
        htmlmeta = self.b['c']['protectedFiles'][str(self.cfg.html)]
        exclusive(p, self.b['payload'][n], 0o644, htmlmeta['uid'], htmlmeta['gid'])
        self.st['protectedFiles'][str(p)] = describe(p)
        self.st['assets'].append(n)
        self.set_parent(p)
        self.checkpoint('new-immutable-asset')
        self.guard(True)

    def reload_one(self, slot, rollback=False):
        self.guard(not rollback)
        need(slot in self.b['ids'] and (slot in self.st['loadedSlots'] if rollback
             else slot not in self.st['loadedSlots']), 'ONLY_CAPTURED_UNLOADED_OR_OWN_LOADED_SLOT')
        before = next(r for r in self.st['processes'] if r['id'] == slot)
        kind = 'front' if before['script'] == str(self.cfg.front_api) else 'admin'
        need(before['script'] == str(self.cfg.apis[kind]) and self.st['targets'][kind] ==
             ('before' if rollback else 'candidate'), 'RELOAD_ONLY_OWN_API_VERSION')
        need(before['pm2ReloadReady'] is True, 'PM2_MODEL_FORK_RETAINED_BYTES_UNPROVEN_NO_RELOAD')
        # Bind exact target API and all adapter source bytes inside the actual Node RPC.
        tr = copy.deepcopy(self.st['transport'])
        # API bytes are already full-CAS guarded. Adapter RPC validates this pin as well.
        intent = self.checkpoint('rollback-reload-intent-%d' % slot if rollback else 'reload-intent-%d' % slot)
        intent_sha, intent_sequence = self.state_hash, self.sequence
        error = None
        try:
            if self.cfg.mock:
                self.reload_adapter(self.cfg, tr, before)
            else:
                production_reload(self.cfg, tr, before, self.st['protectedFiles'][before['script']]['sha256'])
        except BaseException as exc:
            error = exc
        observed = self.row_reader(self.cfg, tr)
        identity(self.cfg, observed)
        row = next(r for r in observed if r['id'] == slot)
        changed = row['pid'] != before['pid']
        observed_at = now()
        ignore = {'pid','restarts','rawSha256','nodeUniqueId','pm2RawMeta'}
        if changed:
            pm2_meta_transition(before['pm2RawMeta'], row['pm2RawMeta'],
                int(dt.datetime.fromisoformat(intent['recordedAtUtc']).timestamp()*1000),
                int(dt.datetime.fromisoformat(observed_at).timestamp()*1000))
            need(row['restarts'] == before['restarts'] + 1
                 and row['nodeUniqueId'] > before['nodeUniqueId']
                 and {k:v for k,v in row.items() if k not in ignore} ==
                 {k:v for k,v in before.items() if k not in ignore}, 'NODE_PM2_ONLY_LIFECYCLE_SEMANTICS_CONFIG_PERMISSION')
        else:
            need(row == before, 'NONTRANSITION_RAW_PROCESS_DRIFT')
        need([r for r in observed if r['id'] != slot] ==
             [r for r in self.st['processes'] if r['id'] != slot], 'OTHER_ELEVEN_SLOT_DRIFT')
        # Prove source, all twelve rows, permissions and full META BEFORE observation
        # becomes a journal fact. Failed validation leaves only the durable intent.
        snap = self.current_snapshot()
        need(snap == dict(processes=observed, protectedFiles=self.st['protectedFiles'], transport=tr),
             'OBSERVED_SOURCE_FULLMETA_SET_DRIFT')
        event = dict(id=slot, rollback=rollback, beforePid=before['pid'], afterPid=row['pid'],
            beforeRestart=before['restarts'], afterRestart=row['restarts'], observedPidChange=changed,
            transportPassed=error is None, apiSha256=self.st['protectedFiles'][before['script']]['sha256'],
            beforeRawSha256=before['rawSha256'], afterRawSha256=row['rawSha256'],
            beforeUniqueId=before['nodeUniqueId'],afterUniqueId=row['nodeUniqueId'],
            semanticSha256=row['semanticSha256'], beforePm2RawMeta=before['pm2RawMeta'],
            afterPm2RawMeta=row['pm2RawMeta'], attemptSha256=self.attempt_hash,
            intentStateSha256=intent_sha, intentSequence=intent_sequence, observedAtUtc=observed_at)
        self.st['events'].append(event)
        self.st['processes'] = observed
        if changed:
            if rollback:
                self.st['loadedSlots'].remove(slot)
            else:
                self.st['loadedSlots'].append(slot)
        self.checkpoint('observed-single-slot-%d' % slot)
        self.guard(not rollback)  # full inventory, socket, source, ALL12 after EACH reload
        self.health(self.st, include_assets=self.st['targets']['html'] == 'candidate')
        self.guard(not rollback)
        need(changed, 'SINGLE_RELOAD_NO_PID_TRANSITION')
        if error:
            raise error

    def fail(self, exc, name='failure.json'):
        # No automatic repair or rollback. Keep own blocked window and retained assets.
        hold_sha, hold_error = None, None
        try:
            hold_sha = self.retain_owned_hold()
        except BaseException as hold_exc:
            hold_error = type(hold_exc).__name__ + (': ' + str(hold_exc)
                         if isinstance(hold_exc, ReleaseError) else '')
        d = dict(schema='customer-batch-failure-v1', **self.common(), status='recovery-required',
                 needsOperatorRecovery=True, error=type(exc).__name__ +
                 (': ' + str(exc) if isinstance(exc, ReleaseError) else ''),
                 attemptSha256=self.attempt_hash, lastStateSha256=self.state_hash,
                 lastStateSequence=self.sequence, failedAtUtc=now(),
                 assetsRetained=True, automaticRollback=False, databaseWrites=0, envWrites=0,
                 reloadOnlyCapturedSix=True, observedCoordinatorSha256=None,
                 ownedHoldSha256=hold_sha, holdProofError=hold_error,
                 journalDurabilityUncertain=self.journal_uncertain, pendingStateSha256=self.pending_state_hash,
                 successProven=False, operatorRecoveryRequiredEvenIfCoordinatorLooksClosed=True)
        try:
            d['observedCoordinatorSha256'] = H(regular(self.cfg.coord))
        except BaseException:
            pass
        exclusive(self.cfg.receipt/name, encode(d))
        return d

    def apply(self, package, manifest_sha, review_sha):
        with locked(self.cfg):
            self.no_replay(); private(self.cfg.stage)
            need(Path(package).absolute() == self.cfg.package, 'FIXED_STAGE_PACKAGE')
            self.b = self.bundle(package, manifest_sha, review_sha)
            snap = self.baseline_guard(self.b)
            self.health(snap); self.baseline_guard(self.b)
            need(all(meta(p)['dev'] == meta(self.cfg.stage)['dev'] for p in
                 [self.cfg.coord,self.cfg.html,*self.cfg.apis.values()]), 'SAME_FS_REQUIRED')
            self.st = dict(**copy.deepcopy(snap), coordBase64=self.b['c']['coordBase64'],
                coordRecord=self.b['c']['coordRecord'], targets={'front':'before','admin':'before','html':'before'},
                assets=[], loadedSlots=[], events=[])
            self.cfg.receipt.mkdir(mode=0o700); fsync_dir(self.cfg.stage)
            attempt = dict(schema='customer-batch-attempt-v1', **self.common(), startedAtUtc=now(),
                reloadScope=self.b['ids'], originalCoordSha256=H(self.b['coord']),
                canonicalMetadataSha256=self.b['c']['canonicalMetadataSha256'])
            ab = encode(attempt)
            exclusive(self.cfg.receipt/'attempt.json', ab)
            self.attempt_hash = H(ab)
            self.checkpoint('attempt-before-production-write')
            try:
                self.guard(True)
                coord = coord_closed(self.b['coord'])
                if coord['window'] not in coord['window_history']:
                    coord['window_history'].append(copy.deepcopy(coord['window']))
                coord['window'] = dict(owner_task=OWNER, scope=SCOPE, nonce=self.b['m']['nonce'],
                    ownerNonce=self.b['m']['ownerNonce'], manifestSha256=manifest_sha,
                    controllerSha256=self.hash, reviewSha256=review_sha, captureSha256=self.b['m']['captureSha256'],
                    attemptSha256=self.attempt_hash, status='open', needsOperatorRecovery=False,
                    openedAtUtc=now(), reloadScope=self.b['ids'])
                coord['shared_release_active'] = True; coord['updated_at'] = now()
                self.change_coord(encode(coord), 'open-own-attempt')
                for a in self.b['m']['assets']:
                    self.add_asset(a)
                for kind in ('front','admin'):
                    self.change_file(kind, True, True)
                    slots = [r['id'] for r in self.st['processes'] if r['script'] == str(self.cfg.apis[kind])
                             and r['id'] in self.b['ids']]
                    for slot in slots:
                        self.reload_one(slot)
                self.change_file('html', True, True)
                self.health(self.guard(True), True); self.guard(True)
                self.close('verified')
                self.guard()
                receipt = dict(schema='customer-batch-receipt-v1', **self.common(), status='verified',
                    attemptSha256=self.attempt_hash, stateSha256=self.state_hash, stateSequence=self.sequence,
                    coordSha256=H(unb64(self.st['coordBase64'])), canonicalMetadataSha256=H(encode(self.st['protectedFiles'])),
                    reloadScope=self.b['ids'], reloadEvents=self.st['events'], assetsRetained=True,
                    otherSixSlotsRawExact=True, databaseWrites=0, envWrites=0, frontStaticWrites=0, closedAtUtc=now())
                return self.durable_success(receipt, 'receipt.json', 'verified')
            except BaseException as exc:
                try:
                    failure = self.fail(exc)
                except BaseException as proof_exc:
                    raise ReleaseError('RECOVERY_REQUIRED_FAILURE_RECEIPT_UNPROVEN: ' +
                                       type(proof_exc).__name__) from exc
                raise ReleaseError('RECOVERY_REQUIRED: ' + failure['error']) from exc

    def restore_journal(self, package, manifest_sha, review_sha, attempt_sha, state_sha):
        private(self.cfg.stage); private(self.cfg.receipt)
        need(Path(package).absolute() == self.cfg.package, 'FIXED_STAGE_PACKAGE')
        self.b = self.bundle(package, manifest_sha, review_sha, require_fresh=False)
        ab = regular(self.cfg.receipt/'attempt.json')
        need(H(ab) == pin(attempt_sha), 'ATTEMPT_PIN')
        a = decode(ab)
        exact(a, 'schema ownerTask scope nonce ownerNonce controllerSha256 manifestSha256 reviewSha256 '
              'captureSha256 startedAtUtc reloadScope originalCoordSha256 canonicalMetadataSha256', 'ATTEMPT_SCHEMA')
        need(a['schema'] == 'customer-batch-attempt-v1' and all(a[k] == v for k,v in self.common().items())
             and a['reloadScope'] == self.b['ids'] and a['originalCoordSha256'] == H(self.b['coord'])
             and a['canonicalMetadataSha256'] == self.b['c']['canonicalMetadataSha256'], 'ATTEMPT_SCOPE_BINDING')
        self.attempt_hash = attempt_sha
        previous, latest, count = None, None, 0
        statefiles = sorted(self.cfg.receipt.glob('state-*.json'))
        need(statefiles, 'DURABLE_STATE_REQUIRED')
        for p in statefiles:
            count += 1
            need(p.name == 'state-%06d.json' % count, 'CONTIGUOUS_IMMUTABLE_JOURNAL')
            raw = regular(p); d = decode(raw)
            exact(d, 'schema ownerTask scope nonce ownerNonce controllerSha256 manifestSha256 reviewSha256 '
                  'captureSha256 attemptSha256 sequence previousSha256 operation recordedAtUtc state', 'STATE_SCHEMA')
            need(d['schema'] == 'customer-batch-durable-state-v1' and d['sequence'] == count
                 and d['previousSha256'] == previous and d['attemptSha256'] == attempt_sha
                 and all(d[k] == v for k,v in self.common().items()), 'JOURNAL_HASHCHAIN_SCOPE')
            exact(d['state'], 'processes protectedFiles transport coordBase64 coordRecord targets assets loadedSlots events',
                  'STATE_EXACT_SCHEMA')
            self.state_invariants(d['state'])
            if count == 1:
                original = dict(**{k:self.b['c'][k] for k in ('processes','protectedFiles','transport')},
                    coordBase64=self.b['c']['coordBase64'],coordRecord=self.b['c']['coordRecord'],
                    targets={'front':'before','admin':'before','html':'before'},assets=[],loadedSlots=[],events=[])
                need(d['state'] == original, 'FIRST_JOURNAL_FRESH_CAPTURE_BINDING')
            previous, latest = H(raw), d
        need(previous == pin(state_sha), 'LATEST_STATE_EXPLICIT_PIN_NO_STALE_REPLAY')
        self.sequence, self.state_hash, self.st = count, previous, latest['state']
        identity(self.cfg, self.st['processes'])
        need(self.st['transport'] == self.b['c']['transport'], 'STATE_ADAPTER_PIN')
        need(set(self.st['targets']) == {'front','admin','html'} and all(v in ('before','candidate')
             for v in self.st['targets'].values()), 'STATE_TARGET_MODES')
        need(len(set(self.st['loadedSlots'])) == len(self.st['loadedSlots'])
             and set(self.st['loadedSlots']) <= set(self.b['ids']), 'STATE_ONLY_OWN_LOADED_SLOTS')
        for key, path in [('html',self.cfg.html), *self.cfg.apis.items()]:
            n = (('after-' if self.st['targets'][key] == 'candidate' else 'before-') +
                 ('index.html' if key == 'html' else key+'-api.js'))
            need(self.st['protectedFiles'][str(path)]['sha256'] == H(self.b['payload'][n]), 'STATE_TARGET_PAYLOAD_PIN')
        # Independently pinned hashchain is an operator receipt, never an automatic ownership guess.
        self.guard()
        return latest

    def verify(self, package, manifest_sha, review_sha, attempt_sha, state_sha, receipt_sha):
        try:
            return self._verify(package, manifest_sha, review_sha, attempt_sha, state_sha, receipt_sha)
        except BaseException as exc:
            raise ReleaseError('VERIFICATION_RECOVERY_REQUIRED_NO_SUCCESS: ' +
                               (str(exc) if isinstance(exc, ReleaseError) else type(exc).__name__)) from exc

    def _verify(self, package, manifest_sha, review_sha, attempt_sha, state_sha, receipt_sha):
        with locked(self.cfg):
            need(not (self.cfg.receipt/'failure.json').exists()
                 and not (self.cfg.receipt/'rollback-failure.json').exists()
                 and not (self.cfg.receipt/'rollback-attempt.json').exists(), 'FAILURE_OR_ROLLBACK_SUPERSEDES_RECEIPT')
            self.restore_journal(package, manifest_sha, review_sha, attempt_sha, state_sha)
            raw = regular(self.cfg.receipt/'receipt.json')
            need(H(raw) == pin(receipt_sha), 'RECEIPT_PIN')
            r = decode(raw)
            need(r.get('status') == 'verified' and r.get('stateSha256') == state_sha
                 and r.get('attemptSha256') == attempt_sha and all(r.get(k) == v for k,v in self.common().items())
                 and r.get('coordSha256') == H(unb64(self.st['coordBase64']))
                 and self.st['targets'] == {'front':'candidate','admin':'candidate','html':'candidate'}
                 and set(self.st['loadedSlots']) == set(self.b['ids']), 'VERIFIED_RECEIPT_BINDING')
            c = self.owned_window()
            need(c['shared_release_active'] is False and c['window']['status'] == 'closed'
                 and c['window']['outcome'] == 'verified', 'VERIFIED_OWN_CLOSED_COORD')
            self.health(self.guard(), True); self.guard()
            self.receipt_proof(r, 'verified')
            need(regular(self.cfg.receipt/'receipt.json') == raw, 'DURABLE_RECEIPT_POST_DRIFT')
            return dict(status='verified-live-matching-own-receipt', stateSha256=state_sha,
                        receiptSha256=receipt_sha, productionWrites=0, processCount=12)

    def rollback(self, package, manifest_sha, review_sha, attempt_sha, state_sha, rollback_review_sha, outcome_sha):
        with locked(self.cfg):
            need(not (self.cfg.receipt/'rollback-attempt.json').exists(), 'ROLLBACK_ATTEMPT_NO_REPLAY')
            self.restore_journal(package, manifest_sha, review_sha, attempt_sha, state_sha)
            source = 'failure.json' if (self.cfg.receipt/'failure.json').exists() else 'receipt.json'
            raw = regular(self.cfg.receipt/source)
            need(H(raw) == pin(outcome_sha), 'EXPLICIT_FAILURE_OR_RECEIPT_PIN')
            outcome = decode(raw)
            need(all(outcome.get(k) == v for k,v in self.common().items())
                 and outcome.get('attemptSha256') == attempt_sha, 'OUTCOME_SCOPE_BINDING')
            approval_raw = regular(self.cfg.stage/'rollback-review.json')
            need(H(approval_raw) == pin(rollback_review_sha), 'ROLLBACK_REVIEW_PIN')
            approval = decode(approval_raw)
            exact(approval, 'schema independent rollbackApproved reviewerScope reviewerHash bindings approvedAtUtc ttlSeconds',
                  'ROLLBACK_APPROVAL_SCHEMA')
            expected = dict(**self.common(), attemptSha256=attempt_sha, stateSha256=state_sha,
                outcomeSha256=outcome_sha, packageFiles=self.b['m']['packageFiles'],
                targets=self.st['targets'], reloadOnlyLoadedSlots=self.st['loadedSlots'], retainAllAssets=True)
            need(approval['schema'] == 'customer-batch-rollback-review-v1' and approval['independent'] is True
                 and approval['rollbackApproved'] is True and approval['bindings'] == expected
                 and isinstance(approval['reviewerScope'], str) and len(approval['reviewerScope']) >= 8
                 and approval['reviewerScope'] not in (SCOPE,OWNER), 'INDEPENDENT_ROLLBACK_BOUND_APPROVAL')
            pin(approval['reviewerHash'])
            report = regular(self.cfg.stage/'rollback-reviewer-report.txt')
            need(H(report) == approval['reviewerHash'], 'ROLLBACK_REVIEWER_REPORT_PIN')
            self.recovery_approval = approval
            self.recovery_approval_sha = rollback_review_sha
            self.guard()
            coord = self.owned_window()
            need((coord['shared_release_active'] is True and coord['window']['status'] in ('open','recovery-required'))
                 or (coord['shared_release_active'] is False and coord['window']['status'] == 'closed'
                     and coord['window'].get('outcome') == 'verified'), 'NO_FOREIGN_OR_ALREADY_ROLLEDBACK_WINDOW')
            rb = encode(dict(schema='customer-batch-rollback-attempt-v1', **expected,
                             approvalSha256=rollback_review_sha, startedAtUtc=now()))
            exclusive(self.cfg.receipt/'rollback-attempt.json', rb)
            try:
                if coord['shared_release_active'] is False or coord['window']['status'] == 'recovery-required':
                    coord['window'] = dict(coord['window'], status='open', needsOperatorRecovery=False,
                                           rollbackAttemptSha256=H(rb))
                    coord['shared_release_active'] = True
                    self.change_coord(encode(coord), 'reopen-own-verified-rollback')
                if self.st['targets']['html'] == 'candidate':
                    self.change_file('html', False)
                for kind in ('admin','front'):
                    if self.st['targets'][kind] == 'candidate':
                        self.change_file(kind, False)
                    loaded = [slot for slot in self.st['loadedSlots'] if next(r for r in self.st['processes']
                              if r['id'] == slot)['script'] == str(self.cfg.apis[kind])]
                    for slot in loaded:
                        self.reload_one(slot, rollback=True)
                self.health(self.guard()); self.guard()
                self.close('rolled-back')
                receipt = dict(schema='customer-batch-rollback-receipt-v1', **self.common(), status='rolled-back',
                    attemptSha256=attempt_sha, rollbackAttemptSha256=H(rb), stateSha256=self.state_hash,
                    stateSequence=self.sequence, assetsRetained=True, reloadEvents=self.st['events'],
                    coordSha256=H(unb64(self.st['coordBase64'])), databaseWrites=0, envWrites=0)
                return self.durable_success(receipt, 'rollback-receipt.json', 'rolled-back')
            except BaseException as exc:
                try:
                    failure = self.fail(exc, 'rollback-failure.json')
                except BaseException as proof_exc:
                    raise ReleaseError('ROLLBACK_RECOVERY_REQUIRED_FAILURE_RECEIPT_UNPROVEN: ' +
                                       type(proof_exc).__name__) from exc
                raise ReleaseError('ROLLBACK_RECOVERY_REQUIRED: ' + failure['error']) from exc

def production_reload(cfg, tr, row, api_sha):
    need((row['name'],row['script']) in [('dianzi51',str(cfg.front_api)),
         ('dianzi51-admin',str(cfg.admin_api))], 'FIXED_EXEC_SINGLE_RELOAD')
    need(H(regular(Path(row['script']))) == pin(api_sha), 'RPC_API_PIN')
    # rpc() verifies the captured adapter set; add target SHA only to child call pins.
    need(transport(cfg) == tr, 'PRE_RELOAD_ADAPTER_SHA')
    sm = tr['socket']
    a = dict(pins={**tr['sources'], row['script']:api_sha}, socket=str(cfg.pm2_home/'rpc.sock'),
        socketStat={k:sm['statmode'] if k == 'mode' else sm[k] for k in ('dev','ino','uid','gid','mode')},
        daemonPid=tr['daemonPid'], pidfile=str(cfg.pm2_home/'pm2.pid'), base=str(cfg.pm2_base), reload=True,
        id=row['id'], name=row['name'], script=row['script'], beforePid=row['pid'], beforeRestart=row['restarts'])
    p = subprocess.run([str(cfg.node), '-e', RPC, json.dumps(a)], stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE, timeout=48)
    need(p.returncode == 0, 'SINGLE_SOCKET_RELOAD_FAILED_NO_FALLBACK')
    need(decode(p.stdout) == {} and transport(cfg) == tr and H(regular(Path(row['script']))) == api_sha,
         'POST_RELOAD_SOCKET_ADAPTER_API_SHA')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('operation', choices=['capture','candidate','preflight','apply','verify','rollback'])
    p.add_argument('--controller-sha256', required=True)
    p.add_argument('--spec'); p.add_argument('--out'); p.add_argument('--package')
    for name in ('manifest','review','attempt','state','receipt','rollback-review','outcome'):
        p.add_argument('--'+name+'-sha256')
    a = p.parse_args()
    need(pin(a.controller_sha256) == H(regular(Path(__file__).absolute())), 'EXPLICIT_CURRENT_CONTROLLER_SHA')
    if a.operation == 'candidate':
        need(a.spec and a.out and not any(getattr(a,k) for k in ('package','manifest_sha256','review_sha256',
             'attempt_sha256','state_sha256','receipt_sha256','rollback_review_sha256','outcome_sha256')), 'CANDIDATE_ARGS')
        result = seal_candidate(a.spec, a.out, a.controller_sha256)
    else:
        need(not a.spec and not a.out, 'UNKNOWN_OPERATION_ARGS')
        c = Controller()
        if a.operation == 'capture':
            need(not any(getattr(a,k) for k in ('package','manifest_sha256','review_sha256','attempt_sha256',
                 'state_sha256','receipt_sha256','rollback_review_sha256','outcome_sha256')), 'CAPTURE_READONLY_ARGS')
            result = c.capture()
        else:
            need(a.package and a.manifest_sha256 and a.review_sha256, 'SEALED_PACKAGE_INDEPENDENT_REVIEW_REQUIRED')
            args = [a.package,pin(a.manifest_sha256),pin(a.review_sha256)]
            if a.operation in ('verify','rollback'):
                need(a.attempt_sha256 and a.state_sha256, 'DURABLE_ATTEMPT_LATEST_STATE_PINS')
                args += [pin(a.attempt_sha256),pin(a.state_sha256)]
                if a.operation == 'verify':
                    need(a.receipt_sha256 and not a.rollback_review_sha256 and not a.outcome_sha256, 'VERIFY_PINS')
                    args += [pin(a.receipt_sha256)]
                else:
                    need(a.rollback_review_sha256 and a.outcome_sha256 and not a.receipt_sha256, 'ROLLBACK_APPROVAL_PINS')
                    args += [pin(a.rollback_review_sha256),pin(a.outcome_sha256)]
            else:
                need(not any((a.attempt_sha256,a.state_sha256,a.receipt_sha256,a.rollback_review_sha256,a.outcome_sha256)),
                     'NO_EXTRANEOUS_OPERATION_PINS')
            result = getattr(c,a.operation)(*args)
    sys.stdout.buffer.write(encode(result))

if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        print('RELEASE_ABORT: ' + (str(exc) if isinstance(exc, ReleaseError) else type(exc).__name__), file=sys.stderr)
        sys.exit(1)
