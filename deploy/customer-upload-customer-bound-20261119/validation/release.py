#!/usr/bin/env python3
"""Offline-prepared customer-bound release controller; stdlib only.

CLI --capture and --preflight are readonly. CLI injects source-pinned existing-daemon
reloadProcessId and proven listener GET / adapters; unverified production_* defaults
remain FAIL-CLOSED. Listener GET is not an upload/business test. No SSH,
PM2 CLI/connect/daemon-start fallback, env/DB writes, admin/worker reload, or
main-site HTML rollback. Tests inject transports and use TemporaryDirectory only.

Strict manifest fields: ownerTask, scope, captureSha256, controllerSha256,
beforeHtmlSha256, afterHtmlSha256, beforeApiSha256, afterApiSha256,
apiDeltaSha256, assets, replacements, cssRelative (must null), packageFiles.
Exactly two new BusinessWorkbenchPage-*-<sha-prefix>=16.js assets; replace every
complete quoted occurrence of two old URLs in admin HTML, with no other delta.
PackageFiles pins exactly capture.json, before/after-index.html, before/after-api.js,
api-delta.json, the two assets, and evidence/*; manifest/review are separately pinned.
Review must independently pin owner/scope, manifest, controller, capture, api delta,
and every packageFiles entry. Original scope/capture/receipts cannot replay.

api-delta.json v1: schema=customer-supply-source-delta-v1, apiPath, beforeSha256,
afterSha256, source={ownerOffset,start,end,headerEnd,beforeSha256,afterSha256,
abiSha256}, patches=[{kind,offset,beforeBase64,afterBase64}, ...]. Exactly two
sorted, disjoint original byte spans INSIDE customerSupply.source, original function
header ABI unchanged, exact full-file forward reconstruction (and therefore reversible).
Owner marker is function createCustomerSupplyService(deps) {; unchanged source ABI
is async function source(tx, scope, c, input) {. Kinds: profile-default-other changes
only const sourceProfile initializer input.sourceProfile to input.sourceProfile ??
{ type: "other" }; remove-first-required-fail deletes only the original
if (!sourceProfile) return fail11("PRECONDITION_FAILED", first-upload-message);.
Block scan tracks nested owner SQL templates without evaluation; source templates
are restricted to verified flat sql85 templates and property-read interpolations.
Original/full forward reconstruction protects all SQL and all other business bytes.

Locks are both original existing flock inodes. CAS preserves full bytes and mode/
uid/gid, rechecks immediately before atomic rename, private same-FS scratch only.
Advisory-lock CAS is not a kernel CAS against uncooperative writers. Capture TTL
is 900 seconds; prepare package material before fresh capture after Task2 R5.
Protection retains old graph and adds runtime full file inventory, public alias
link metadata, explicit R5 extra_links/extra_protected union pins, nginx and flags.
Only own API/admin HTML/new assets and four original cluster slots 190/193/194/200
may change. Other eight process/PID/raw environ/config/permission hashes stay exact.
Own raw env bytes are hashed before/after and semantics recursively canonicalized
(only /proc pm2_env JSON is decoded; application strings stay opaque), excluding
ONLY listed lifecycle/monitoring keys;
nonvolatile raw semantics, top/child config and OS permissions remain invariant.
Partial failure never silently repairs env or reloads other services. Own-byte and
metadata ownership must persist for API/admin rollback and already-loaded own slots.
Foreign coord/HTML/API/protection/permission drift => recovery-required; retain new
assets and durable attempt/failure; preserve complete coordinator past history.
"""
import argparse
import base64
import copy
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import uuid
from contextlib import contextmanager
from dataclasses import dataclass

OWNER = 'PnHdmd0yBiQfYpcPRYWNvD'
SCOPE = 'customer-upload-customer-bound-20261119-PnHdmd0yBi'
API_PATH = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
FRONT_IDS = (190, 193, 194, 200)
HEX = re.compile(r'[0-9a-f]{64}')
TTL = 900
_ACTIVE_LOCKS = []
# PM2's dynamic monitoring/lifecycle fields are not configured environment.
VOLATILE = frozenset({'status', 'pid', 'pm_id', 'pm_uptime', 'created_at',
    'restart_time', 'unstable_restarts', 'axm_actions', 'axm_monitor',
    'axm_dynamic', 'monit', 'vizion_running', 'prev_restart_delay',
    'exit_code',
    '_', 'SHLVL', 'PWD', 'OLDPWD', 'PM2_USAGE'})


class ReleaseError(RuntimeError):
    pass


def need(ok, message):
    if not ok:
        raise ReleaseError(message)


def H(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(',', ':')) + '\n').encode('utf-8')


def decode(data):
    def pairs(items):
        out = {}
        for key, value in items:
            need(key not in out, 'DUPLICATE_JSON_KEY')
            out[key] = value
        return out
    try:
        return json.loads(data, object_pairs_hook=pairs)
    except (ValueError, UnicodeError) as exc:
        raise ReleaseError('INVALID_JSON') from exc


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def timestamp(value):
    try:
        parsed = dt.datetime.fromisoformat(value)
        need(parsed.tzinfo is not None, 'TIMESTAMP_NEEDS_TIMEZONE')
        return parsed.timestamp()
    except (TypeError, ValueError) as exc:
        raise ReleaseError('INVALID_TIMESTAMP') from exc


def pin(value):
    need(isinstance(value, str) and HEX.fullmatch(value), 'FULL_SHA256_REQUIRED')
    return value


def relative(value):
    need(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9._/-]{1,240}', value)
         and all(x not in ('', '.', '..') for x in value.split('/')), 'UNSAFE_RELATIVE')
    return value


def no_symlink(path):
    path = Path(path)
    need(path.is_absolute(), 'ABSOLUTE_PATH_REQUIRED')
    for p in (path, *path.parents):
        need(not p.is_symlink(), 'SYMLINK_REFUSED: ' + str(p))
    return path


def regular(path):
    path = no_symlink(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        s = os.fstat(fd)
        need(stat.S_ISREG(s.st_mode), 'REGULAR_FILE_REQUIRED: ' + str(path))
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read()
        end = os.fstat(fd)
        need((s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns) ==
             (end.st_dev, end.st_ino, end.st_size, end.st_mtime_ns, end.st_ctime_ns),
             'FILE_CHANGED_DURING_READ: ' + str(path))
        return data
    finally:
        os.close(fd)


def metadata(path):
    s = Path(path).lstat()
    return dict(size=s.st_size, statmode=s.st_mode, uid=s.st_uid, gid=s.st_gid,
                dev=s.st_dev, ino=s.st_ino, nlink=s.st_nlink,
                mtimeNs=s.st_mtime_ns, ctimeNs=s.st_ctime_ns)


def directory_link(path):
    target = Path(path).resolve(strict=True)
    s = no_symlink(target).lstat()
    need(stat.S_ISDIR(s.st_mode), 'DIRECTORY_LINK_TARGET_REQUIRED')
    return dict(metadata(path), kind='directory-symlink', link=os.readlink(path),
                target=str(target), targetRoot=dict(dev=s.st_dev, ino=s.st_ino,
                    uid=s.st_uid, gid=s.st_gid, mode=stat.S_IMODE(s.st_mode)))


def describe(path, allow_link=False):
    path = Path(path)
    if path.is_symlink():
        need(allow_link, 'PROTECTED_SYMLINK_REFUSED: ' + str(path))
        target = path.resolve(strict=True)
        need(target.is_file(), 'CONFIG_LINK_NOT_FILE: ' + str(path))
        return dict(metadata(path), kind='symlink', link=os.readlink(path),
                    target=str(target), targetRecord=describe(target))
    return dict(metadata(path), kind='file', sha256=H(regular(path)))


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def check_lock_inodes():
    for path, fd, old in _ACTIVE_LOCKS:
        current = path.lstat()
        need((current.st_dev, current.st_ino) == (old.st_dev, old.st_ino),
             'LOCK_INODE_CHANGED')


def exclusive(path, data, mode=0o600):
    check_lock_inodes()
    path = no_symlink(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    fsync_dir(path.parent)


def atomic_cas(path, before, after, scratch, on_replace=None, expected_record=None):
    """Preserve mode/uid/gid; temp writes confined to private stage, not service dirs."""
    check_lock_inodes()
    path, scratch = no_symlink(path), no_symlink(scratch)
    need(regular(path) == before, 'FULL_BYTES_CAS: ' + str(path))
    old = metadata(path)
    need(expected_record is None or describe(path) == expected_record,
         'OWN_TARGET_FULL_METADATA_CAS: ' + str(path))
    need(path.stat().st_dev == scratch.stat().st_dev, 'CAS_REQUIRES_SAME_FILESYSTEM')
    tmp = scratch / ('.cas-' + uuid.uuid4().hex)
    try:
        exclusive(tmp, after, stat.S_IMODE(old['statmode']))
        fd = os.open(tmp, os.O_RDWR | os.O_NOFOLLOW)
        try:
            os.fchown(fd, old['uid'], old['gid'])
            os.fchmod(fd, stat.S_IMODE(old['statmode']))
            os.fsync(fd)
        finally:
            os.close(fd)
        need(regular(path) == before and metadata(path) == old,
             'LAST_BYTES_METADATA_CAS: ' + str(path))
        check_lock_inodes()
        os.replace(tmp, path)
        if on_replace is not None:
            on_replace(describe(path))  # establish own exact record before fsync can fail
        fsync_dir(path.parent)
        fsync_dir(scratch)
    finally:
        if tmp.exists():
            tmp.unlink()  # only our new private-stage scratch file
            fsync_dir(scratch)


@dataclass(frozen=True)
class Config:
    public: Path = Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
    front: Path = Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public')
    coord: Path = Path('/opt/ops/51-project-release-coordination-20261027.json')
    stage: Path = Path('/opt/ops/customer-upload-customer-bound-20261119-PnHdmd0yBi')
    locks: tuple = (Path('/var/lock/dianzi51-public-deploy.lock'),
                    Path('/var/lock/dianzi51-production-code.lock'))
    nginx: Path = Path('/etc/nginx')
    ops: Path = Path('/opt/ops')
    proc: Path = Path('/proc')
    server_alias: Path = Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/server')
    server_target: Path = Path('/opt/releases/20261104-admin-upload-stars-layout-v22/front/dist/server')
    api: Path = Path(API_PATH)
    extra_links: tuple = ()  # ((absolute alias, verified target), ...); R5 union pins
    extra_protected: tuple = ()  # additional verified absolute files/trees

    @property
    def package(self):
        return self.stage / 'package'

    @property
    def receipt(self):
        return self.stage / 'receipt'

    @property
    def html(self):
        return self.public / 'index.html'


@contextmanager
def locked(cfg):
    handles = []
    try:
        for path in cfg.locks:
            # /var/lock commonly aliases /run/lock. Accept a canonical existing
            # parent alias, never a symlink lock file, and pin its original inode.
            need(not path.is_symlink(), 'LOCK_FILE_SYMLINK_REFUSED')
            canonical = no_symlink(path.resolve(strict=True))
            fd = os.open(canonical, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                need(stat.S_ISREG(os.fstat(fd).st_mode), 'LOCK_MUST_BE_REGULAR')
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                os.close(fd)
                raise ReleaseError('LOCK_BUSY: ' + str(path)) from exc
            except BaseException:
                os.close(fd)
                raise
            handles.append((path, fd, os.fstat(fd)))
        for path, fd, old in handles:
            current = path.lstat()
            need((current.st_dev, current.st_ino) == (old.st_dev, old.st_ino),
                 'LOCK_INODE_CHANGED')
        _ACTIVE_LOCKS.extend(handles)
        yield
    finally:
        for item in handles:
            if item in _ACTIVE_LOCKS:
                _ACTIVE_LOCKS.remove(item)
        for path, fd, old in reversed(handles):
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)


def coord_closed(data):
    state = decode(data)
    need(isinstance(state, dict) and state.get('shared_release_active') is False,
         'COORD_BUSY_SHARED')
    w = state.get('window')
    need(isinstance(w, dict) and w.get('status') in ('closed', 'verified')
         and w.get('needsOperatorRecovery') is False
         and state.get('needsOperatorRecovery', False) is False
         and isinstance(w.get('closedAtUtc'), str) and w['closedAtUtc'],
         'COORD_BUSY_OR_RECOVERY_OR_UNCLOSED')
    timestamp(w['closedAtUtc'])
    need(isinstance(state.get('window_history', []), list), 'COORD_HISTORY_INVALID')
    return state


# Direct existing-daemon RPC only. Do NOT require pm2's CLI or call pm2.connect().
PM2_RPC = r'''
const fs=require('fs'), path=require('path');
const home=process.env.PM2_HOME || path.join(process.env.HOME || '/root','.pm2');
const socket=path.join(home,'rpc.sock'), pidfile=path.join(home,'pm2.pid');
let done=false, req;
function fail(){if(done)return;done=true;process.stderr.write('PM2_EXISTING_RPC_FAILED');process.exit(2)}
try {
 const pid=Number(fs.readFileSync(pidfile,'utf8').trim());
 if(!Number.isInteger(pid)||pid<=0||!fs.statSync(socket).isSocket()) fail();
 process.kill(pid,0);
 let axon,rpc;
 for(const base of ['/usr/local/lib/node_modules/pm2','/usr/lib/node_modules/pm2','/opt/node/lib/node_modules/pm2']) {
   for(const layout of ['modules','node_modules']) {
     try {axon=require(base+'/'+layout+'/pm2-axon');rpc=require(base+'/'+layout+'/pm2-axon-rpc');break} catch(_){}
   }
   if(axon&&rpc)break;
 }
 if(!axon||!rpc)fail();
 req=axon.socket('req');req.on('error',fail);req.connect(socket);
 const client=new rpc.Client(req);
 client.call('getMonitorData',{},(err,rows)=>{
   if(err||!Array.isArray(rows))return fail();
   done=true;process.stdout.write(JSON.stringify(rows),()=>{req.close();process.exit(0)});
 });
 setTimeout(fail,12000);
} catch(_) {fail()}
'''


def filter_env(value):
    if isinstance(value, dict):
        return {k: filter_env(v) for k, v in value.items() if k not in VOLATILE}
    if isinstance(value, list):
        return [filter_env(v) for v in value]
    return value


def raw_environment_semantics(data):
    need(data.endswith(b'\0'), 'RAW_ENV_MUST_BE_NUL_TERMINATED')
    values = {}
    for item in data[:-1].split(b'\0'):
        need(b'=' in item, 'RAW_ENV_ENTRY_INVALID')
        key, value = item.split(b'=', 1)
        need(key and key not in values, 'RAW_ENV_DUPLICATE_OR_EMPTY_KEY')
        values[key] = value
    # Use surrogateescape for arbitrary OS environment bytes, with no values exported.
    normalized = {k.decode('utf-8', 'surrogateescape'):
        v.decode('utf-8', 'surrogateescape')
        for k, v in values.items() if k.decode('utf-8', 'surrogateescape') not in VOLATILE}
    if 'pm2_env' in normalized:
        parsed = decode(values[b'pm2_env'])
        need(isinstance(parsed, dict), 'RAW_PM2_ENV_OBJECT_REQUIRED')
        normalized['pm2_env'] = filter_env(parsed)
    return H(json.dumps(normalized, sort_keys=True, ensure_ascii=True,
                        separators=(',', ':')).encode('ascii'))


def process_permissions(cfg, pid):
    data = (cfg.proc / str(pid) / 'status').read_bytes()
    fields = {}
    for line in data.splitlines():
        key, _, value = line.partition(b':')
        if key in (b'Uid', b'Gid', b'Groups', b'Umask'):
            need(key.decode() not in fields, 'PROC_PERMISSION_DUPLICATE')
            fields[key.decode()] = value.split()
    need(set(fields) == {'Uid', 'Gid', 'Groups', 'Umask'}, 'PROC_PERMISSION_FIELDS_REQUIRED')
    return H(encode({k: [v.decode('ascii') for v in vs] for k, vs in fields.items()}))


def process_snapshot(cfg):
    node = '/usr/bin/node-22' if Path('/usr/bin/node-22').is_file() else '/usr/bin/node'
    result = subprocess.run([node, '-e', PM2_RPC], stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=16)
    need(result.returncode == 0, 'PM2_EXISTING_RPC_FAILED_NO_START_FALLBACK')
    rows = decode(result.stdout)
    need(isinstance(rows, list), 'PM2_LIST_REQUIRED')
    out = []
    for row in rows:
        e, pid = row['pm2_env'], row['pid']
        need(isinstance(pid, int) and not isinstance(pid, bool) and pid > 0
             and e.get('status') == 'online', 'ALL_PM2_MUST_BE_ONLINE')
        env = e.get('env', {})
        top = {k: v for k, v in e.items() if k != 'env'}
        raw = (cfg.proc / str(pid) / 'environ').read_bytes()
        out.append(dict(id=row['pm_id'], name=row['name'], pid=pid,
            status=e['status'], script=e['pm_exec_path'], cwd=e['pm_cwd'],
            execMode=e['exec_mode'], restarts=e.get('restart_time'),
            configenvHash=H(encode({'env': filter_env(env), 'topEnv': filter_env(top)})),
            topConfigSha256=H(encode(filter_env(top))),
            childConfigSha256=H(encode(filter_env(env))),
            rawProcEnvironSha256=H(raw),
            rawProcEnvironSemanticSha256=raw_environment_semantics(raw),
            permissionsSha256=process_permissions(cfg, pid)))
    out.sort(key=lambda r: r['id'])
    validate_processes(out)
    return out


def validate_processes(rows):
    need(len(rows) == 12 and len({r['id'] for r in rows}) == 12
         and len({r['pid'] for r in rows}) == 12
         and all(r['pid'] > 0 and r['status'] == 'online'
                 and all(isinstance(r.get(k), str) and HEX.fullmatch(r[k]) for k in
                     ('configenvHash', 'topConfigSha256', 'childConfigSha256',
                      'rawProcEnvironSha256', 'rawProcEnvironSemanticSha256',
                      'permissionsSha256')) for r in rows),
         'EXACT_12_DISTINCT_ONLINE_REQUIRED')


def http_get(host, relative_path):
    need(host in ('admin.51dianzi.com', '51dianzi.com'), 'FIXED_HTTP_HOST_ONLY')
    need(relative_path == '' or relative(relative_path), 'FIXED_STATIC_GET_ONLY')
    result = subprocess.run(['curl', '--fail', '--silent', '--show-error',
        '--compressed', '--noproxy', '*', '--proto', '=https', '--max-time', '20',
        '--request', 'GET', '--resolve', host + ':443:127.0.0.1',
        '-H', 'Cache-Control: no-cache', 'https://' + host + '/' + relative_path],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=25)
    need(result.returncode == 0, 'HTTPS_STATIC_GET_FAILED: ' + host + '/' + relative_path)
    return result.stdout


def serving_roots(cfg, rows):
    roots = {}
    for name, expected, count in [('dianzi51-admin', cfg.public, 2),
                                  ('dianzi51', cfg.front, 4)]:
        group = [r for r in rows if r['name'] == name]
        need(len(group) == count, 'SERVING_PROCESS_COUNT: ' + name)
        for row in group:
            alias = Path(row['script']).parent / 'public'
            need(alias.resolve(strict=True) == no_symlink(expected).resolve(strict=True),
                 'ACTUAL_SERVING_ROOT_CHANGED: ' + name)
            roots[str(row['id'])] = dict(name=name, alias=str(alias),
                root=str(expected), aliasLink=os.readlink(alias) if alias.is_symlink() else None,
                aliasMetadata=metadata(alias) if alias.is_symlink() else
                    {k:v for k,v in metadata(alias).items() if k in ('dev','ino','uid','gid','statmode')},
                targetRoot={k:v for k,v in metadata(expected).items()
                            if k in ('dev','ino','uid','gid','statmode')})
    return roots


def inventory(cfg, rows):
    files = {}

    def tree(root, suffixes=None, config_links=False):
        root = no_symlink(root)
        need(root.is_dir(), 'PROTECTED_DIRECTORY_MISSING: ' + str(root))
        for base, dirs, names in os.walk(root, followlinks=False):
            for name in list(dirs):
                directory = Path(base) / name
                if directory.is_symlink():
                    if directory == cfg.server_alias or directory in dict(cfg.extra_links):
                        target = directory.resolve(strict=True)
                        expected = dict(cfg.extra_links).get(directory, cfg.server_target)
                        need(target == no_symlink(expected), 'KNOWN_SERVER_ALIAS_TARGET_DRIFT')
                        files[str(directory)] = directory_link(directory)
                        tree(target, suffixes, config_links=True)
                        dirs.remove(name)
                        continue
                    # Runtime public aliases are validated separately; do not traverse
                    # aliases and duplicate the already protected fixed public trees.
                    need(name == 'public'
                         and directory.resolve(strict=True) in (cfg.public, cfg.front),
                         'DIRECTORY_SYMLINK_REFUSED')
                    files[str(directory)] = directory_link(directory)
                    dirs.remove(name)
            for name in names:
                p = Path(base) / name
                if suffixes is None or p.suffix in suffixes:
                    files[str(p)] = describe(p, allow_link=config_links or suffixes is not None)
                    if p.is_symlink():
                        files[str(p.resolve(strict=True))] = describe(p.resolve(strict=True))

    tree(cfg.public)
    tree(cfg.front)
    tree(cfg.nginx, config_links=True)
    scripts = sorted({r['script'] for r in rows})
    for name in scripts:
        script = Path(name)
        no_symlink(script.parent)
        files[str(script)] = describe(script, allow_link=True)
        tree(script.parent, config_links=True)
        for env_file in script.parent.parent.glob('.env*'):
            if env_file.is_file():
                files[str(env_file)] = describe(env_file)
        for runtime in {script.parent / 'runtime', script.parent.parent / 'runtime'}:
            if runtime.exists():
                tree(runtime, config_links=True)
    for flag in sorted(cfg.ops.glob('official*.json')):
        files[str(flag)] = describe(flag)
    files[str(cfg.api)] = describe(cfg.api)
    for alias, expected in cfg.extra_links:
        need(alias.is_symlink() and alias.resolve(strict=True) == no_symlink(expected),
             'EXPLICIT_LINK_PIN_DRIFT')
        if expected.is_dir():
            files[str(alias)] = directory_link(alias)
            tree(expected, config_links=True)
        else:
            files[str(alias)] = describe(alias, allow_link=True)
            files[str(expected)] = describe(expected)
    for extra in cfg.extra_protected:
        if extra.is_dir() and not extra.is_symlink():
            tree(extra, config_links=True)
        else:
            files[str(extra)] = describe(extra, allow_link=True)
    return dict(sorted(files.items()))


def production_reload(cfg, pm_id, api_sha256):
    """Parent must replace only after read-only verification of live PM2 v7 RPC ABI.

    Contract: exact single FRONT_IDS slot, existing rpc.sock only, no connect/CLI,
    daemon start, --update-env, admin or worker action; wait for single slot online.
    On errors the controller observes actual processes; adapters must not repair env.
    """
    raise ReleaseError('PM2_V7_RELOAD_ADAPTER_UNVERIFIED_FAIL_CLOSED')


def production_api_health(cfg, api_sha256):
    """No guessed business endpoint. Parent pins a proven readonly GET health adapter."""
    raise ReleaseError('READONLY_API_HEALTH_ADAPTER_UNVERIFIED_FAIL_CLOSED')


PM2_SOURCE_PINS = {
    '/usr/local/lib/node_modules/pm2/lib/God/Reload.js':
        '5e90112e447c4634009ea35005ffd477aab93064f55390288c56b51eee25992e',
    '/usr/local/lib/node_modules/pm2/lib/Daemon.js':
        'c4e27c6a2b0f380c9846e298b7a1ef4c745c8f33f00bbd61d9a10eee19ee2fb9'}
R5_LINK_EVIDENCE = Path(__file__).resolve().parent / 'seven-fixed-links.json'
R5_LINKS = {
    '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/public':
        '/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public',
    '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/public':
        '/opt/releases/20261031-homepage-banner-v39/front/dist/public',
    **{'/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/'+name:
       '/opt/releases/20261104-admin-upload-stars-layout-v22/front/dist/'+name
       for name in ('forumPdfScanWorker.mjs', 'marketSnapshotRefresh.js',
                    'publicHotSnapshotRefresh.js', 'recommendationValueRefresh.js', 'server')}}


def production_config():
    evidence = decode(regular(R5_LINK_EVIDENCE))
    need(evidence.get('schema') == 'r5-seven-fixed-links-verified-v1'
         and isinstance(evidence.get('records'), dict)
         and set(evidence['records']) == set(R5_LINKS), 'FIXED_SEVEN_LINK_EVIDENCE_REQUIRED')
    need(all(evidence['records'][alias].get('target') == target
             and evidence['records'][alias].get('link') == target
             for alias, target in R5_LINKS.items()), 'FIXED_SEVEN_LINK_TARGET_MISMATCH')
    # Only fixed link identities are reused, never stale META/capture approval.
    return Config(extra_links=tuple((Path(a), Path(t)) for a,t in sorted(R5_LINKS.items())),
                  extra_protected=tuple(Path(p) for p in PM2_SOURCE_PINS) + (
                      Path('/opt/config/dianzi51-admin/runtime.env'),
                      Path('/opt/config/dianzi51/runtime.env'),
                      Path('/root/.pm2/dump.pm2')))


def verify_pm2_sources(cfg, api_sha256):
    need(str(cfg.api) == API_PATH, 'VERIFIED_ADAPTER_FIXED_API_PATH_REQUIRED')
    pin(api_sha256)
    for path, digest in PM2_SOURCE_PINS.items():
        need(H(regular(Path(path))) == digest, 'VERIFIED_PM2_SOURCE_HASH_MISMATCH')
    need(H(regular(cfg.api)) == api_sha256, 'VERIFIED_ADAPTER_API_HASH_MISMATCH')


PM2_RELOAD_RPC = r'''
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const id=Number(process.argv[1]),api=process.argv[2],apiSha=process.argv[3];
const pins=JSON.parse(process.argv[4]);
const home=process.env.PM2_HOME || path.join(process.env.HOME || '/root','.pm2');
const socket=path.join(home,'rpc.sock'),pidfile=path.join(home,'pm2.pid');
let done=false,req;
function fail(){if(done)return;done=true;process.stderr.write('VERIFIED_PM2_RPC_FAILED');process.exit(2)}
function hashes(){
 for(const [p,h] of Object.entries({...pins,[api]:apiSha})) {
  const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {if(!fs.fstatSync(fd).isFile() || crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex')!==h)throw Error('pin')}finally{fs.closeSync(fd)}
 }
}
function target(rows){
 if(!Array.isArray(rows))throw Error('rows');
 const matches=rows.filter(r=>r.pm_id===id);if(matches.length!==1)throw Error('slot');
 const r=matches[0],e=r.pm2_env;
 if(!e||r.name!=='dianzi51'||e.status!=='online'||e.pm_exec_path!==api||
    e.exec_mode!=='cluster_mode'||String(e.PORT)!=='3000'||
    (e.env&&e.env.PORT!==undefined&&String(e.env.PORT)!=='3000')||e.wait_ready||
    !Number.isInteger(r.pid)||r.pid<=0||!Number.isInteger(e.restart_time)||e.restart_time<0)throw Error('identity');
 return {pid:r.pid,restarts:e.restart_time};
}
try {
 if(![190,193,194,200].includes(id)||api!=='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js')throw Error('scope');
 hashes();
 const daemonPid=Number(fs.readFileSync(pidfile,'utf8').trim());
 if(!Number.isInteger(daemonPid)||daemonPid<=0||!fs.statSync(socket).isSocket())throw Error('daemon');
 process.kill(daemonPid,0);
 const axon=require('/usr/local/lib/node_modules/pm2/modules/pm2-axon');
 const rpc=require('/usr/local/lib/node_modules/pm2/modules/pm2-axon-rpc');
 req=axon.socket('req');req.on('error',fail);req.connect(socket);
 const client=new rpc.Client(req);
 setTimeout(fail,44000);
 client.call('getMonitorData',{},(err,rows)=>{
  try {
   if(err)throw Error('monitor');const before=target(rows);hashes();
   client.call('reloadProcessId',{id:id,env:{}},(err)=>{
    if(err)return fail();
    client.call('getMonitorData',{},(err,rows)=>{
     try {
      if(err)throw Error('monitor');const after=target(rows);hashes();
      if(after.pid===before.pid||after.restarts!==before.restarts+1)throw Error('transition');
      done=true;process.stdout.write(JSON.stringify({id,beforePid:before.pid,beforeRestart:before.restarts,
       afterPid:after.pid,afterRestart:after.restarts}),()=>{req.close();process.exit(0)});
     }catch(_){fail()}
    });
   });
  }catch(_){fail()}
 });
}catch(_){fail()}
'''


def verified_pm2_reload(cfg, pm_id, api_sha256):
    need(type(pm_id) is int and pm_id in FRONT_IDS, 'VERIFIED_RELOAD_FIXED_SLOT_REQUIRED')
    verify_pm2_sources(cfg, api_sha256)
    node = '/usr/bin/node-22' if Path('/usr/bin/node-22').is_file() else '/usr/bin/node'
    try:
        result = subprocess.run([node, '-e', PM2_RELOAD_RPC, str(pm_id), str(cfg.api),
            api_sha256, json.dumps(PM2_SOURCE_PINS, sort_keys=True)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
    except subprocess.TimeoutExpired:
        raise ReleaseError('VERIFIED_PM2_RPC_TIMEOUT') from None
    need(result.returncode == 0, 'VERIFIED_PM2_RPC_FAILED_NO_FALLBACK')
    event = decode(result.stdout)
    need(isinstance(event, dict) and set(event) ==
         {'id','beforePid','beforeRestart','afterPid','afterRestart'}
         and all(type(v) is int for v in event.values()) and event['id'] == pm_id
         and event['beforePid'] > 0 and event['afterPid'] > 0
         and event['beforePid'] != event['afterPid'] and event['beforeRestart'] >= 0
         and event['afterRestart'] == event['beforeRestart']+1,
         'VERIFIED_PM2_RPC_TRANSITION_INVALID')
    verify_pm2_sources(cfg, api_sha256)
    return event


def verified_front_listener(cfg, api_sha256):
    """Pinned readonly listener GET /; NOT an upload/business health test."""
    need(str(cfg.api) == API_PATH, 'VERIFIED_ADAPTER_FIXED_API_PATH_REQUIRED')
    need(H(regular(cfg.api)) == pin(api_sha256), 'VERIFIED_LISTENER_API_HASH_MISMATCH')
    expected = describe(cfg.front / 'index.html')
    try:
        result = subprocess.run(['curl', '--fail', '--silent', '--show-error',
            '--noproxy', '*', '--proto', '=http', '--max-time', '15',
            '--request', 'GET', 'http://127.0.0.1:3000/'],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    except subprocess.TimeoutExpired:
        raise ReleaseError('VERIFIED_FRONT_LISTENER_TIMEOUT') from None
    need(result.returncode == 0 and H(result.stdout) == expected['sha256'],
         'VERIFIED_FRONT_LISTENER_BODY_HASH_MISMATCH')
    need(describe(cfg.front / 'index.html') == expected
         and H(regular(cfg.api)) == api_sha256, 'VERIFIED_LISTENER_FILE_DRIFT')
    return True


def b64(value):
    try:
        need(isinstance(value, str), 'API_SPAN_BASE64_STRING_REQUIRED')
        return base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise ReleaseError('INVALID_API_SPAN_BASE64') from exc


def block_end(data, start, depth_at=None):
    """Readonly block scan with nested template-expression brace tracking.

    Supports the verified factory's nested sql85 tagged templates. Templates are
    never evaluated. The editable source body is separately restricted to verified
    flat sql85 templates whose interpolations are identifiers/property reads only.
    """
    need(data[start:start+1] == b'{', 'SOURCE_BLOCK_REQUIRED')

    def string_end(i, quote):
        i += 1
        while i < len(data):
            if data[i:i+1] == b'\\':
                i += 2; continue
            if data[i:i+1] == quote:
                return i+1
            if quote == b'`' and data[i:i+2] == b'${':
                i = block_end(data, i+1); continue
            i += 1
        raise ReleaseError('SOURCE_QUOTE_UNTERMINATED')

    depth, i = 0, start
    while i < len(data):
        if i == depth_at:
            return depth
        c = data[i:i+1]
        if c in (b'"', b"'", b'`'):
            i = string_end(i, c); continue
        if data[i:i+2] == b'//':
            end = data.find(b'\n', i+2)
            need(end >= 0, 'SOURCE_COMMENT_UNTERMINATED')
            i = end; continue
        if data[i:i+2] == b'/*':
            end = data.find(b'*/', i+2)
            need(end >= 0, 'SOURCE_COMMENT_UNTERMINATED')
            i = end+2; continue
        if c == b'{':
            depth += 1
        elif c == b'}':
            depth -= 1
            if depth == 0:
                return i+1
        i += 1
    raise ReleaseError('SOURCE_BLOCK_UNTERMINATED')


def source_sql_templates(data):
    templates = list(re.finditer(rb'sql85`([^`]*)`', data))
    need(data.count(b'`') == 2*len(templates), 'SOURCE_ONLY_VERIFIED_SQL85_TEMPLATES')
    for template in templates:
        body = template.group(1)
        expressions = re.findall(rb'\$\{([^{}]*)\}', body)
        need(body.count(b'${') == len(expressions)
             and all(re.fullmatch(rb'\s*[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*\s*', e)
                     for e in expressions), 'SOURCE_SQL_INTERPOLATION_PROPERTY_READ_ONLY')


def api_delta(cfg, data, before, after):
    delta = decode(data)
    need(isinstance(delta, dict) and set(delta) ==
         {'schema', 'apiPath', 'beforeSha256', 'afterSha256', 'source', 'patches'},
         'EXACT_API_DELTA_FIELDS')
    need(delta['schema'] == 'customer-supply-source-delta-v1'
         and delta['apiPath'] == str(cfg.api)
         and delta['beforeSha256'] == H(before)
         and delta['afterSha256'] == H(after) and before != after,
         'API_DELTA_PATH_OR_BYTES_BINDING')
    source = delta['source']
    need(isinstance(source, dict) and set(source) ==
         {'ownerOffset', 'start', 'end', 'headerEnd', 'beforeSha256',
          'afterSha256', 'abiSha256'}, 'EXACT_SOURCE_EVIDENCE_FIELDS')
    o, s, e, he = (source[k] for k in ('ownerOffset', 'start', 'end', 'headerEnd'))
    need(all(isinstance(v, int) and not isinstance(v, bool) for v in (o,s,e,he))
         and 0 <= o < s < he < e <= len(before), 'SOURCE_SPAN_BOUNDS')
    owner = re.match(rb'function\s+createCustomerSupplyService\s*\(deps\)\s*\{', before[o:])
    need(owner is not None, 'CUSTOMER_SUPPLY_FACTORY_MARKER_REQUIRED')
    owner_open = o + owner.end()-1
    need(e <= block_end(before, owner_open)
         and block_end(before, owner_open, depth_at=s) == 1,
         'SOURCE_NOT_DIRECTLY_IN_CUSTOMER_SUPPLY')
    header = before[s:he]
    need(re.fullmatch(rb'async\s+function\s+source\s*\(tx,\s*scope,\s*c,\s*input\)\s*\{', header)
         and block_end(before, he-1) == e
         and H(header) == pin(source['abiSha256'])
         and H(before[s:e]) == pin(source['beforeSha256']), 'SOURCE_FUNCTION_ABI_BINDING')
    need(before.count(b'function createCustomerSupplyService(deps) {') == 1
         and before[o:block_end(before, owner_open)].count(
             b'async function source(tx, scope, c, input) {') == 1,
         'UNIQUE_FACTORY_SOURCE_DECLARATION_REQUIRED')
    source_sql_templates(before[he:e])
    patches = delta['patches']
    need(isinstance(patches, list) and len(patches) == 2, 'EXACT_TWO_API_PATCHES')
    reconstructed, previous, kinds, growth = before, he, set(), 0
    for p in patches:
        need(isinstance(p, dict) and set(p) ==
             {'kind', 'offset', 'beforeBase64', 'afterBase64'}, 'EXACT_API_PATCH_FIELDS')
        offset, old, new = p['offset'], b64(p['beforeBase64']), b64(p['afterBase64'])
        need(isinstance(offset, int) and not isinstance(offset, bool)
             and previous <= offset and offset+len(old) < e
             and 0 < len(old) <= 1024 and before[offset:offset+len(old)] == old,
             'API_SOURCE_SPAN_ORIGINAL_BYTES_REQUIRED')
        kind = p['kind']
        need(kind not in kinds, 'API_PATCH_KIND_DUPLICATE')
        kinds.add(kind)
        if kind == 'profile-default-other':
            need(old == b'input.sourceProfile' and re.fullmatch(
                 rb'input\.sourceProfile\s*\?\?\s*\{\s*type\s*:\s*(?:"other"|\'other\')\s*\}', new),
                 'ONLY_OTHER_FALLBACK_DELTA_ALLOWED')
            need(re.search(rb'const\s+sourceProfile\s*=\s*$', before[max(he,offset-80):offset])
                 and before[offset+len(old):offset+len(old)+1] == b';',
                 'ONLY_SOURCE_PROFILE_INITIALIZER_SPAN_ALLOWED')
        elif kind == 'remove-first-required-fail':
            need(new == b'' and re.fullmatch(
                 rb'\s*if\s*\(\s*!sourceProfile\s*\)\s*return\s+fail11\("PRECONDITION_FAILED",\s*"(?:[^"\\]|\\.)*"\);\s*', old)
                 and b'\\u9996\\u6B21' in old
                 and before[he:e].count(b'if (!sourceProfile) return fail11(') == 1,
                 'ONLY_FIRST_REQUIRED_FAIL_REMOVAL_ALLOWED')
        else:
            raise ReleaseError('API_PATCH_KIND_REFUSED')
        pos = offset+growth
        reconstructed = reconstructed[:pos]+new+reconstructed[pos+len(old):]
        growth += len(new)-len(old)
        previous = offset+len(old)
    need(kinds == {'profile-default-other', 'remove-first-required-fail'}
         and reconstructed == after
         and before[s:he] == after[s:he]
         and block_end(after, he-1) == e+growth
         and H(after[s:e+growth]) == pin(source['afterSha256']),
         'API_EXACT_REVERSIBLE_TWO_SPAN_DELTA_REQUIRED')
    return delta


class Controller:
    def __init__(self, cfg=None, process_reader=None, get_reader=None,
                 reload_adapter=None, api_health_reader=None):
        self.cfg = cfg or Config()
        self.process_reader = process_reader or process_snapshot
        self.get_reader = get_reader or http_get
        self.reload_adapter = reload_adapter or production_reload
        self.api_health_reader = api_health_reader or production_api_health
        self.controller_hash = H(regular(Path(__file__).absolute()))
        self.expected_rolled_pids = {}
        self.new_asset_records = {}
        self.own_target_records = {}

    def readonly_adapters(self, api_sha):
        if self.reload_adapter is verified_pm2_reload:
            verify_pm2_sources(self.cfg, api_sha)
        if self.api_health_reader is verified_front_listener:
            need(self.api_health_reader(self.cfg, api_sha) is True,
                 'VERIFIED_FRONT_LISTENER_FAILED')

    def target_cas(self, path, before, after):
        def remember(record):
            need(record['sha256'] == H(after), 'OWN_CAS_POST_RENAME_BYTES_DRIFT')
            self.own_target_records[str(path)] = record
        atomic_cas(path, before, after, self.cfg.stage, on_replace=remember,
                   expected_record=self.own_target_records[str(path)])

    def snapshot(self):
        check_lock_inodes()
        rows = self.process_reader(self.cfg)
        validate_processes(rows)
        self.front_identity(rows)
        return dict(processes=rows, servingRoots=serving_roots(self.cfg, rows),
                    protectedFiles=inventory(self.cfg, rows))

    def capture(self):
        with locked(self.cfg):
            captured_at = now()
            coord = regular(self.cfg.coord)
            coord_closed(coord)
            first = self.snapshot()
            html = regular(self.cfg.html)
            for host, path in [('admin.51dianzi.com', self.cfg.html),
                               ('51dianzi.com', self.cfg.front / 'index.html')]:
                need(H(self.get_reader(host, '')) == H(regular(path)),
                     'ACTUAL_HTTPS_ROOT_HTML_MISMATCH: ' + host)
            self.readonly_adapters(H(regular(self.cfg.api)))
            need(self.snapshot() == first, 'PROTECT_OR_PROCESS_DRIFT_DURING_CAPTURE')
            need(regular(self.cfg.html) == html and regular(self.cfg.coord) == coord,
                 'HTML_OR_COORD_DRIFT_DURING_CAPTURE')
            self.fresh({'capturedAtUtc': captured_at})
            return dict(schema='customer-upload-customer-bound-capture-v1', ownerTask=OWNER,
                scope=SCOPE, capturedAtUtc=captured_at, ttlSeconds=TTL,
                controllerSha256=self.controller_hash, publicRoot=str(self.cfg.public),
                frontRoot=str(self.cfg.front), apiPath=str(self.cfg.api),
                beforeApiSha256=H(regular(self.cfg.api)), apiRecord=describe(self.cfg.api),
                beforeHtmlSha256=H(html),
                adminHtmlRecord=describe(self.cfg.html), coordSha256=H(coord),
                coordBase64=base64.b64encode(coord).decode('ascii'), **first,
                environmentValuesExported=False, productionWrites=0,
                processSnapshotMethod='existing-daemon-direct-rpc-no-start-fallback')

    def private(self, path):
        path = no_symlink(path)
        s = path.stat()
        need(stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid()
             and stat.S_IMODE(s.st_mode) & 0o077 == 0,
             'PRIVATE_OWNED_DIRECTORY_REQUIRED: ' + str(path))

    def validate(self, package, manifest_sha, review_sha=None):
        cfg = self.cfg
        need(Path(package).absolute() == cfg.package, 'EXACT_PACKAGE_PATH_REQUIRED')
        self.private(cfg.stage)
        self.private(cfg.package)
        mb = regular(cfg.package / 'manifest.json')
        need(H(mb) == pin(manifest_sha), 'MANIFEST_SHA256_MISMATCH')
        m = decode(mb)
        keys = {'ownerTask', 'scope', 'captureSha256', 'controllerSha256',
                'beforeHtmlSha256', 'afterHtmlSha256', 'assets', 'replacements',
                'cssRelative', 'packageFiles', 'beforeApiSha256', 'afterApiSha256',
                'apiDeltaSha256'}
        need(isinstance(m, dict) and set(m) == keys, 'EXACT_MANIFEST_FIELDS_REQUIRED')
        need(m['ownerTask'] == OWNER and m['scope'] == SCOPE, 'OWNER_SCOPE_MISMATCH')
        need(m['controllerSha256'] == self.controller_hash, 'CONTROLLER_SHA256_MISMATCH')
        pf = m['packageFiles']
        need(isinstance(pf, dict), 'PACKAGE_FILES_DICTIONARY_REQUIRED')
        actual, actual_dirs = set(), set()
        for base, dirs, names in os.walk(cfg.package, followlinks=False):
            for name in dirs + names:
                need(not (Path(base) / name).is_symlink(), 'PACKAGE_SYMLINK_REFUSED')
            actual_dirs.update((Path(base) / n).relative_to(cfg.package).as_posix() for n in dirs)
            actual.update((Path(base) / n).relative_to(cfg.package).as_posix() for n in names)
        optional_review = {'review.json'} if 'review.json' in actual else set()
        need(actual == set(pf) | {'manifest.json'} | optional_review,
             'EXACT_PACKAGE_CONTENTS_REQUIRED')
        expected_dirs = {parent.as_posix() for name in pf for parent in Path(name).parents
                         if parent.as_posix() != '.'}
        need(actual_dirs == expected_dirs, 'EXACT_PACKAGE_DIRECTORIES_REQUIRED')
        contents = {}
        for name, digest in pf.items():
            relative(name)
            need(name in ('capture.json', 'before-index.html', 'after-index.html',
                         'before-api.js', 'after-api.js', 'api-delta.json')
                 or name.startswith(('assets/', 'evidence/')), 'PACKAGE_FILE_SCOPE')
            data = regular(cfg.package / name)
            need(H(data) == pin(digest), 'PACKAGE_FILE_DRIFT: ' + name)
            contents[name] = data
        need({'capture.json', 'before-index.html', 'after-index.html',
              'before-api.js', 'after-api.js', 'api-delta.json'} <= set(pf)
             and any(n.startswith('evidence/') for n in pf), 'PACKAGE_BASELINE_EVIDENCE_REQUIRED')
        need(H(contents['capture.json']) == pin(m['captureSha256']), 'CAPTURE_PIN_MISMATCH')
        capture = decode(contents['capture.json'])
        need(capture['schema'] == 'customer-upload-customer-bound-capture-v1'
             and capture['ownerTask'] == OWNER and capture['scope'] == SCOPE
             and capture['controllerSha256'] == self.controller_hash
             and capture['publicRoot'] == str(cfg.public)
             and capture['frontRoot'] == str(cfg.front) and capture['apiPath'] == str(cfg.api)
             and capture['ttlSeconds'] == TTL,
             'CAPTURE_IDENTITY_ROOTS_MISMATCH')
        self.fresh(capture)
        before, after = contents['before-index.html'], contents['after-index.html']
        need(H(before) == pin(m['beforeHtmlSha256']) == capture['beforeHtmlSha256']
             and H(after) == pin(m['afterHtmlSha256']) and before != after,
             'HTML_PINS_MISMATCH')
        assets = m['assets']
        need(isinstance(assets, list) and len(assets) == 2, 'EXACT_TWO_JS_NO_NEW_CSS')
        names = set()
        for a in assets:
            need(isinstance(a, dict) and set(a) == {'relative', 'sha256', 'size'},
                 'EXACT_ASSET_FIELDS')
            name = relative(a['relative'])
            need(re.fullmatch(r'assets/[A-Za-z0-9_.-]+\.(js|css)', name), 'DIRECT_STATIC_ASSET_ONLY')
            need(name not in names, 'DUPLICATE_ASSET')
            names.add(name)
            digest = pin(a['sha256'])
            match = re.search(r'-([0-9a-f]{16,64})\.(js|css)$', name)
            need(match and digest.startswith(match.group(1)), 'CONTENT_HASH_FILENAME_REQUIRED')
            need(name in contents and H(contents[name]) == digest
                 and isinstance(a['size'], int) and not isinstance(a['size'], bool)
                 and len(contents[name]) == a['size'], 'ASSET_PIN_SIZE_MISMATCH')
            need(str(cfg.public / name) not in capture['protectedFiles']
                 and not (cfg.public / name).exists() and not (cfg.public / name).is_symlink(),
                 'ASSET_ALREADY_EXISTS_NO_OVERWRITE: ' + name)
        need({n for n in pf if n.startswith('assets/')} == names, 'ASSET_PACKAGE_EXACT_SET')
        js = {n for n in names if n.endswith('.js')}
        css = {n for n in names if n.endswith('.css')}
        need(len(js) == 2 and all(Path(n).name.startswith('BusinessWorkbenchPage-') for n in js),
             'EXACT_TWO_BUSINESS_WORKBENCH_JS_REQUIRED')
        css_name = m['cssRelative']
        need(css_name is None and not css, 'CSS_RELATIVE_MISMATCH_NO_NEW_CSS')
        replacements = m['replacements']
        need(isinstance(replacements, list) and len(replacements) == 2, 'EXACT_TWO_REPLACEMENTS')
        patched, olds, news = before, set(), set()
        for r in replacements:
            need(isinstance(r, dict) and set(r) == {'before', 'after'}, 'EXACT_REPLACEMENT_FIELDS')
            old, new = r['before'], r['after']
            need(isinstance(old, str) and re.fullmatch(r'/assets/BusinessWorkbenchPage-[A-Za-z0-9_.-]+\.js', old)
                 and isinstance(new, str) and new.startswith('/') and new[1:] in js,
                 'ONLY_BUSINESS_WORKBENCH_URL_REPLACEMENTS')
            need(old not in olds and new not in news and old != new, 'DISTINCT_REPLACEMENTS_REQUIRED')
            olds.add(old); news.add(new)
            ob, nb = old.encode(), new.encode()
            need(before.count(ob) >= 1 and nb not in before, 'OLD_URL_PRESENT_NEW_ABSENT')
            for occurrence in re.finditer(re.escape(ob), before):
                pos = occurrence.start()
                need(pos > 0 and before[pos-1:pos] in (b'"', b"'")
                     and before[pos+len(ob):pos+len(ob)+1] == before[pos-1:pos],
                     'URL_MUST_BE_ENTIRE_QUOTED_REFERENCE')
            old_record = capture['protectedFiles'].get(str(cfg.public / old[1:]))
            need(old_record is not None and old_record.get('kind') == 'file', 'OLD_ASSET_NOT_CAPTURED')
            patched = patched.replace(ob, nb)
        need(news == {'/' + n for n in js}, 'TWO_NEW_JS_BOTH_REFERENCED')
        need(patched == after, 'MANIFEST_ONLY_HTML_DELTA_VIOLATION')
        try:
            cb = base64.b64decode(capture['coordBase64'], validate=True)
        except (ValueError, TypeError) as exc:
            raise ReleaseError('INVALID_CAPTURE_COORD_BASE64') from exc
        need(H(cb) == pin(capture['coordSha256']), 'COORD_CAPTURE_PIN_MISMATCH')
        coord_closed(cb)
        validate_processes(capture['processes'])
        need(capture['adminHtmlRecord'] == capture['protectedFiles'].get(str(cfg.html))
             and capture['adminHtmlRecord']['sha256'] == H(before), 'HTML_METADATA_CAPTURE_BINDING')
        before_api, after_api = contents['before-api.js'], contents['after-api.js']
        need(H(before_api) == pin(m['beforeApiSha256']) == capture['beforeApiSha256']
             and H(after_api) == pin(m['afterApiSha256'])
             and H(contents['api-delta.json']) == pin(m['apiDeltaSha256'])
             and capture['apiRecord'] == capture['protectedFiles'].get(str(cfg.api))
             and capture['apiRecord'].get('sha256') == H(before_api), 'API_CAPTURE_PINS_BINDING')
        delta = api_delta(cfg, contents['api-delta.json'], before_api, after_api)
        self.front_identity(capture['processes'])
        if review_sha is not None:
            rb = regular(cfg.package / 'review.json')
            need(H(rb) == pin(review_sha), 'REVIEW_SHA256_MISMATCH')
            review = decode(rb)
            need(review.get('status') == 'passed' and review.get('independent') is True
                 and review.get('manifestSha256') == H(mb)
                 and review.get('controllerSha256') == self.controller_hash
                 and review.get('captureSha256') == m['captureSha256']
                 and review.get('apiDeltaSha256') == m['apiDeltaSha256']
                 and review.get('packageFiles') == pf
                 and review.get('ownerTask') == OWNER and review.get('scope') == SCOPE,
                 'INDEPENDENT_REVIEW_REQUIRED')
        return dict(m=m, mb=mb, contents=contents, capture=capture, coord=cb,
                    before=before, after=after, beforeApi=before_api, afterApi=after_api,
                    delta=delta, reviewSha256=review_sha)

    def fresh(self, capture):
        age = dt.datetime.now(dt.timezone.utc).timestamp() - timestamp(capture['capturedAtUtc'])
        need(0 <= age <= TTL, 'CAPTURE_EXPIRED_OR_FUTURE: fresh capture required')

    def front_identity(self, rows):
        group = [r for r in rows if r['name'] == 'dianzi51']
        need({r['id'] for r in group} == set(FRONT_IDS)
             and all(r['script'] == str(self.cfg.api) and r['execMode'] == 'cluster_mode'
                     for r in group), 'EXACT_ORIGINAL_FOUR_FRONT_SLOTS_SCRIPT_CLUSTER_REQUIRED')

    def process_guard(self, before, current, rolls):
        validate_processes(current)
        self.front_identity(current)
        need({r['id'] for r in before} == {r['id'] for r in current}, 'PROCESS_ID_SET_DRIFT')
        old = {r['id']: r for r in before}
        for row in current:
            baseline = old[row['id']]
            count = rolls.get(row['id'], 0)
            if count:
                need(row['id'] in FRONT_IDS
                     and row['pid'] == self.expected_rolled_pids.get(row['id'])
                     and row['pid'] != baseline['pid']
                     and row['restarts'] == baseline['restarts'] + count,
                     'ROLLING_PID_OR_RESTART_RANGE_DRIFT')
                allowed = {'pid', 'restarts', 'rawProcEnvironSha256'}
                need({k:v for k,v in row.items() if k not in allowed} ==
                     {k:v for k,v in baseline.items() if k not in allowed},
                     'ROLLING_NONVOLATILE_ENV_CONFIG_PERMISSION_DRIFT')
            else:
                need(row == baseline, 'PROCESS_OR_ENV_DRIFT_STOP_NO_RELOAD')

    def guard(self, bundle, after=False, added=(), api_after=False, rolls=None,
              check_assets=True):
        self.fresh(bundle['capture'])
        snap = self.snapshot()
        old = bundle['capture']
        self.process_guard(old['processes'], snap['processes'], rolls or {})
        need(snap['servingRoots'] == old['servingRoots'], 'SERVING_ROOT_DRIFT')
        files = dict(snap['protectedFiles'])
        protected = dict(old['protectedFiles'])
        for name in added:
            files.pop(str(self.cfg.public / name), None)
        for path, value, record in [
            (self.cfg.html, bundle['after'] if after else bundle['before'], old['adminHtmlRecord']),
            (self.cfg.api, bundle['afterApi'] if api_after else bundle['beforeApi'], old['apiRecord'])]:
            current = files.get(str(path))
            need(current is not None and current.get('sha256') == H(value),
                 'PROTECTED_FILE_EXPECTED_API_OR_HTML_BYTES_DRIFT')
            need(current == self.own_target_records.get(str(path), record),
                 'API_HTML_METADATA_DRIFT')
            need(regular(path) == value, 'API_HTML_FULL_BYTES_DRIFT')
            files.pop(str(path), None)
            protected.pop(str(path), None)
        need(files == protected, 'PROTECTED_FILE_OR_INVENTORY_DRIFT_STOP_NO_WRITE')
        if check_assets:
            for name in added:
                need(regular(self.cfg.public / name) == bundle['contents'][name], 'NEW_ASSET_DRIFT')
                need(describe(self.cfg.public / name) == self.new_asset_records.get(name),
                     'NEW_ASSET_METADATA_DRIFT')
        return snap

    def ownership(self, owned, bundle, api_after, html_after):
        need(regular(self.cfg.coord) == owned, 'OWN_COORD_BYTES_LOST')
        for path, value, record in [
            (self.cfg.api, bundle['afterApi'] if api_after else bundle['beforeApi'], bundle['capture']['apiRecord']),
            (self.cfg.html, bundle['after'] if html_after else bundle['before'], bundle['capture']['adminHtmlRecord'])]:
            need(regular(path) == value, 'OWN_API_OR_HTML_BYTES_LOST')
            need(describe(path) == self.own_target_records.get(str(path), record),
                 'OWN_API_OR_HTML_METADATA_LOST')

    def reload_one(self, bundle, pm_id, api_sha, rolls, events, owned, html_after=False,
                   api_after=True, rollback=False):
        self.ownership(owned, bundle, api_after, html_after)
        snap = self.guard(bundle, after=html_after,
                          added=[a['relative'] for a in bundle['m']['assets']],
                          api_after=api_after, rolls=rolls, check_assets=not rollback)
        previous = next(r for r in snap['processes'] if r['id'] == pm_id)
        failure = None
        try:
            self.reload_adapter(self.cfg, pm_id, api_sha)
        except BaseException as exc:
            failure = exc
        # Never infer success from transport: observe exact single-slot change.
        current = self.process_reader(self.cfg)
        validate_processes(current)
        row = next((r for r in current if r['id'] == pm_id), None)
        need(row is not None, 'ROLLING_SLOT_DISAPPEARED')
        changed = row['pid'] != previous['pid']
        event = dict(id=pm_id, beforePid=previous['pid'], afterPid=row['pid'],
            beforeRestart=previous['restarts'], afterRestart=row['restarts'],
            beforeRawEnvironSha256=previous['rawProcEnvironSha256'],
            afterRawEnvironSha256=row['rawProcEnvironSha256'],
            beforeSemanticSha256=previous['rawProcEnvironSemanticSha256'],
            afterSemanticSha256=row['rawProcEnvironSemanticSha256'],
            apiSha256=api_sha, rollback=rollback, transportPassed=failure is None,
            observedPidChange=changed)
        events.append(event)
        if changed:
            self.expected_rolled_pids[pm_id] = row['pid']
            rolls[pm_id] = rolls.get(pm_id, 0) + 1
        self.process_guard(bundle['capture']['processes'], current, rolls)
        self.ownership(owned, bundle, api_after, html_after)
        need(changed or failure is not None, 'ROLLING_ADAPTER_NO_OBSERVED_PID_CHANGE')
        if failure is not None:
            raise failure
        return row

    def no_replay(self):
        receipt = self.cfg.receipt
        if receipt.exists() or receipt.is_symlink():
            self.private(receipt)
            need(not any(receipt.iterdir()), 'RECEIPT_EXISTS_NO_REPLAY')

    def preflight(self, package, manifest_sha):
        with locked(self.cfg):
            b = self.validate(package, manifest_sha)
            self.no_replay()
            self.guard(b)
            self.readonly_adapters(H(b['beforeApi']))
            self.guard(b)
            need(regular(self.cfg.coord) == b['coord'], 'COORD_FULL_BYTES_CAS_MISMATCH')
            coord_closed(regular(self.cfg.coord))
            need(self.cfg.stage.stat().st_dev == self.cfg.html.stat().st_dev ==
                 self.cfg.coord.stat().st_dev == self.cfg.api.stat().st_dev,
                 'CAS_REQUIRES_SAME_FILESYSTEM')
            return dict(status='preflight-passed', manifestSha256=H(b['mb']),
                        protectedFiles=len(b['capture']['protectedFiles']), processCount=12,
                        productionWrites=0, reviewRequiredForApply=True,
                        reloadScope=list(FRONT_IDS),
                        reloadAdapterReady=self.reload_adapter is not production_reload,
                        apiHealthAdapterReady=self.api_health_reader is not production_api_health)

    def close(self, owned, window, status, error=None):
        cfg = self.cfg
        need(regular(cfg.coord) == owned, 'OWN_COORD_BYTES_LOST_DO_NOT_TOUCH_FOREIGN_WINDOW')
        state = decode(owned)
        need(state['window']['nonce'] == window['nonce']
             and state['window']['owner_task'] == OWNER
             and state['window']['manifestSha256'] == window['manifestSha256'], 'OWN_WINDOW_LOST')
        closed = dict(window, status='closed', outcome=status, closedAtUtc=now(),
                      needsOperatorRecovery=False, receipt=str(cfg.receipt /
                          ('receipt.json' if status == 'verified' else 'failure.json')))
        if error:
            closed['error'] = error
        state['window'] = closed
        state['shared_release_active'] = False
        state.setdefault('window_history', []).append(copy.deepcopy(closed))
        state['updated_at'] = now()
        final = encode(state)
        atomic_cas(cfg.coord, owned, final, cfg.stage)
        return final

    def apply(self, package, manifest_sha, review_sha):
        pin(review_sha)
        cfg = self.cfg
        # Default unverified stubs remain fail-closed; CLI explicitly injects verified adapters.
        need(self.reload_adapter is not production_reload,
             'PM2_V7_RELOAD_ADAPTER_UNVERIFIED_FAIL_CLOSED')
        need(self.api_health_reader is not production_api_health,
             'READONLY_API_HEALTH_ADAPTER_UNVERIFIED_FAIL_CLOSED')
        with locked(cfg):
            b = self.validate(package, manifest_sha, review_sha)
            self.no_replay()
            self.guard(b)
            self.readonly_adapters(H(b['beforeApi']))
            self.guard(b)
            need(regular(cfg.coord) == b['coord'], 'COORD_FULL_BYTES_CAS_MISMATCH')
            state = coord_closed(b['coord'])
            need(cfg.stage.stat().st_dev == cfg.html.stat().st_dev == cfg.coord.stat().st_dev
                 == cfg.api.stat().st_dev, 'CAS_REQUIRES_SAME_FILESYSTEM')
            added, owned, rolls, reloads, rollbacks = [], None, {}, [], []
            self.expected_rolled_pids, self.new_asset_records = {}, {}
            self.own_target_records = {str(cfg.api): b['capture']['apiRecord'],
                                       str(cfg.html): b['capture']['adminHtmlRecord']}
            window = dict(owner_task=OWNER, scope=SCOPE, nonce=uuid.uuid4().hex,
                manifestSha256=H(b['mb']), controllerSha256=self.controller_hash,
                openedAtUtc=now(), status='open', needsOperatorRecovery=False,
                reloadScope=list(FRONT_IDS), beforeApiSha256=H(b['beforeApi']),
                afterApiSha256=H(b['afterApi']))
            if not cfg.receipt.exists():
                cfg.receipt.mkdir(mode=0o700)
                fsync_dir(cfg.stage)
            exclusive(cfg.receipt / 'attempt.json', encode(dict(window,
                reviewSha256=review_sha, captureSha256=b['m']['captureSha256'])))
            history = state.setdefault('window_history', [])
            if state['window'] not in history:
                history.append(copy.deepcopy(state['window']))
            state['shared_release_active'] = True
            state['window'] = window
            state['updated_at'] = now()
            opened_bytes = encode(state)
            try:
                self.guard(b)
                atomic_cas(cfg.coord, b['coord'], opened_bytes, cfg.stage)
                owned = opened_bytes
                for a in b['m']['assets']:
                    self.ownership(owned, b, False, False)
                    name = a['relative']
                    need((cfg.public / name).parent.is_dir(), 'ASSET_PARENT_MUST_PREEXIST')
                    added.append(name)
                    exclusive(cfg.public / name, b['contents'][name], 0o644)
                    self.new_asset_records[name] = describe(cfg.public / name)
                self.guard(b, added=added)
                self.ownership(owned, b, False, False)
                self.target_cas(cfg.api, b['beforeApi'], b['afterApi'])
                self.guard(b, added=added, api_after=True)
                for pm_id in FRONT_IDS:
                    self.reload_one(b, pm_id, H(b['afterApi']), rolls, reloads, owned)
                self.guard(b, added=added, api_after=True, rolls=rolls)
                self.ownership(owned, b, True, False)
                self.target_cas(cfg.html, b['before'], b['after'])
                need(H(self.get_reader('admin.51dianzi.com', '')) == H(b['after']),
                     'HTTPS_NEW_HTML_SHA256_MISMATCH')
                front_record = b['capture']['protectedFiles'][str(cfg.front / 'index.html')]
                need(H(self.get_reader('51dianzi.com', '')) == front_record['sha256'],
                     'HTTPS_FRONT_R5_ROOT_SHA256_MISMATCH')
                for a in b['m']['assets']:
                    need(H(self.get_reader('admin.51dianzi.com', a['relative'])) == a['sha256'],
                         'HTTPS_NEW_ASSET_SHA256_MISMATCH')
                need(self.api_health_reader(cfg, H(b['afterApi'])) is True,
                     'READONLY_API_GET_HEALTH_FAILED')
                final_snap = self.guard(b, after=True, added=added, api_after=True, rolls=rolls)
                self.ownership(owned, b, True, True)
                window['processReloads'] = copy.deepcopy(reloads)
                window['newFrontPids'] = {str(r['id']):r['pid'] for r in final_snap['processes']
                                          if r['id'] in FRONT_IDS}
                final = self.close(owned, window, 'verified')
                receipt = dict(status='verified', ownerTask=OWNER, scope=SCOPE,
                    nonce=window['nonce'], manifestSha256=H(b['mb']), reviewSha256=review_sha,
                    controllerSha256=self.controller_hash, captureSha256=b['m']['captureSha256'],
                    beforeHtmlSha256=H(b['before']), afterHtmlSha256=H(b['after']),
                    beforeApiSha256=H(b['beforeApi']), afterApiSha256=H(b['afterApi']),
                    apiDeltaSha256=b['m']['apiDeltaSha256'], addedAssets=added,
                    protectedFiles=len(b['capture']['protectedFiles']), reloadScope=list(FRONT_IDS),
                    processReloads=len([e for e in reloads if e['observedPidChange']]),
                    processReloadEvents=reloads, processRollbacks=rollbacks,
                    processesBefore=b['capture']['processes'], processesAfter=final_snap['processes'],
                    otherEightProcessesRawExact=True, ownFourEnvironmentSemanticsUnchanged=True,
                    allOriginalFilesExceptOwnApiAndAdminHtmlUnchanged=True,
                    processCount=12, apiWrites=1, databaseWrites=0, envWrites=0,
                    frontHtmlWrites=0, coordSha256=H(final), closedAtUtc=now())
                exclusive(cfg.receipt / 'receipt.json', encode(receipt))
                return receipt
            except BaseException as exc:
                error = type(exc).__name__ + (': '+str(exc) if isinstance(exc, ReleaseError) else '')
                status = 'failed-before-production-write'
                if owned is None and regular(cfg.coord) == opened_bytes:
                    owned = opened_bytes
                if owned is not None:
                    if regular(cfg.coord) != owned:
                        status = 'recovery-required-coord-ownership-lost'
                    elif regular(cfg.html) not in (b['before'], b['after']):
                        status = 'recovery-required-html-cas-lost'
                    elif regular(cfg.api) not in (b['beforeApi'], b['afterApi']):
                        status = 'recovery-required-api-cas-lost'
                    else:
                        try:
                            html_after = regular(cfg.html) == b['after']
                            api_after = regular(cfg.api) == b['afterApi']
                            # Includes all original protection, semantics, permissions;
                            # incomplete new files are retained and never repaired.
                            self.ownership(owned, b, api_after, html_after)
                            self.guard(b, after=html_after, added=added, api_after=api_after,
                                       rolls=rolls, check_assets=False)
                            if html_after:
                                self.ownership(owned, b, api_after, True)
                                self.target_cas(cfg.html, b['after'], b['before'])
                            if api_after:
                                self.ownership(owned, b, True, False)
                                self.target_cas(cfg.api, b['afterApi'], b['beforeApi'])
                            loaded = [i for i in FRONT_IDS if rolls.get(i, 0)]
                            for pm_id in loaded:
                                self.reload_one(b, pm_id, H(b['beforeApi']), rolls,
                                    rollbacks, owned, api_after=False, rollback=True)
                            self.guard(b, added=added, rolls=rolls, check_assets=False)
                            self.ownership(owned, b, False, False)
                            window['processReloads'] = copy.deepcopy(reloads)
                            window['processRollbacks'] = copy.deepcopy(rollbacks)
                            self.close(owned, window, 'failed-rolled-back', error)
                            status = 'failed-rolled-back'
                        except BaseException:
                            status = 'recovery-required-rollback-or-process-guard'
                failure = dict(status=status, ownerTask=OWNER, scope=SCOPE,
                    nonce=window['nonce'], manifestSha256=H(b['mb']), reviewSha256=review_sha,
                    controllerSha256=self.controller_hash, error=error, addedAssets=added,
                    assetsRetained=True, reloadScope=list(FRONT_IDS),
                    processReloads=len([e for e in reloads if e['observedPidChange']]),
                    processReloadEvents=reloads, processRollbacks=rollbacks,
                    beforeApiSha256=H(b['beforeApi']), afterApiSha256=H(b['afterApi']),
                    databaseWrites=0, envWrites=0, frontHtmlWrites=0, failedAtUtc=now(),
                    needsOperatorRecovery=status.startswith('recovery-required'))
                try:
                    exclusive(cfg.receipt / 'failure.json', encode(failure))
                except BaseException:
                    pass
                raise ReleaseError(status + ': ' + error) from exc


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--capture', action='store_true')
    group.add_argument('--preflight', action='store_true')
    group.add_argument('--apply', action='store_true')
    parser.add_argument('--package')
    parser.add_argument('--manifest-sha256')
    parser.add_argument('--review-sha256')
    args = parser.parse_args()
    controller = Controller(production_config(), reload_adapter=verified_pm2_reload,
                            api_health_reader=verified_front_listener)
    if args.capture:
        need(not any((args.package, args.manifest_sha256, args.review_sha256)), 'CAPTURE_HAS_NO_PACKAGE_ARGS')
        result = controller.capture()
    else:
        need(args.package and args.manifest_sha256, 'PACKAGE_AND_MANIFEST_PIN_REQUIRED')
        if args.apply:
            need(args.review_sha256, 'APPLY_REQUIRES_REVIEW_SHA256')
            result = controller.apply(args.package, args.manifest_sha256, args.review_sha256)
        else:
            need(not args.review_sha256, 'REVIEW_PIN_FOR_APPLY_ONLY')
            result = controller.preflight(args.package, args.manifest_sha256)
    sys.stdout.buffer.write(encode(result))


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        # Never echo raw PM2 responses, nginx bytes, or subprocess stderr (secrets).
        if isinstance(exc, (ReleaseError, KeyboardInterrupt)):
            print('RELEASE_ABORT: ' + str(exc), file=sys.stderr)
        else:
            print('RELEASE_ABORT: ' + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
