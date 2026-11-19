#!/usr/bin/env python3
"""Parent-run static-only release controller (Python standard library).

--capture: locks existing inodes, read-only inventory, sanitized processes, actual
serving roots and HTTPS root byte checks; JSON stdout only, no production writes.
--preflight --package FIXED_PACKAGE --manifest-sha256 FULL_SHA256: read-only.
--apply additionally requires --review-sha256 FULL_SHA256 and independent review.
No SSH, installs, business API calls, DB/env writes, reloads, or service commands.

Manifest v1 has exactly: ownerTask, scope, captureSha256, controllerSha256,
beforeHtmlSha256, afterHtmlSha256, assets [{relative,sha256,size}], replacements
[{before,after}] (two distinct /assets/BusinessWorkbenchPage*.js URLs), cssRelative
(null or assets/*.css), packageFiles {relative:sha256}. Two new direct assets/*.js
files, optionally one CSS; filename trailing lowercase SHA prefix is >=16 chars.
packageFiles pins every package file except manifest.json and review.json; includes
capture.json, before-index.html, after-index.html, assets/*, and evidence/*.
All occurrences of the two old URLs must be complete quoted references and are
replaced; counts are bound by the frozen full-byte HTML preimage. No other URLs.
Optional CSS delta is exactly '<link rel="stylesheet" href="/REL">\n' immediately
before the sole '</head>'. No other HTML changes. review.json must pin manifest
and controller and have status='passed', independent=true; its raw bytes are pinned
by --review-sha256. stage and package must be private (mode 0700, invoking owner).
CLI offers no path override; tests inject Config with temporary roots only.

CAS uses full bytes plus original metadata, cooperating original flock inodes,
and a final read immediately before atomic rename. It is advisory-lock CAS, not
a kernel compare-and-swap against non-cooperating writers. Staged temp files must
be on the same filesystem as HTML and coordinator. New assets survive failures.
Any receipt content (including attempt.json) prevents replay after crash/failure.
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

OWNER = '6hBIbUvPpWI2Wkj3jxYdIQ'
SCOPE = 'upload-manage-20261119-6hBIbUvP'
HEX = re.compile(r'[0-9a-f]{64}')
TTL = 900
# PM2's dynamic monitoring/lifecycle fields are not configured environment.
VOLATILE = frozenset({'status', 'pid', 'pm_id', 'pm_uptime', 'created_at',
    'restart_time', 'unstable_restarts', 'axm_actions', 'axm_monitor', 'axm_options',
    'axm_dynamic', 'monit', 'vizion_running', 'versioning', 'prev_restart_delay',
    'exit_code', 'pm_err_log_path', 'pm_out_log_path', 'merge_logs',
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
    return dict(size=s.st_size, statmode=s.st_mode, uid=s.st_uid, gid=s.st_gid)


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


def exclusive(path, data, mode=0o600):
    path = no_symlink(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    fsync_dir(path.parent)


def atomic_cas(path, before, after, scratch):
    """Preserve mode/uid/gid; temp writes confined to private stage, not service dirs."""
    path, scratch = no_symlink(path), no_symlink(scratch)
    need(regular(path) == before, 'FULL_BYTES_CAS: ' + str(path))
    old = metadata(path)
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
        os.replace(tmp, path)
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
    stage: Path = Path('/opt/ops/upload-manage-20261119-6hBIbUvP')
    locks: tuple = (Path('/var/lock/dianzi51-public-deploy.lock'),
                    Path('/var/lock/dianzi51-production-code.lock'))
    nginx: Path = Path('/etc/nginx')
    ops: Path = Path('/opt/ops')
    proc: Path = Path('/proc')
    server_alias: Path = Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/server')
    server_target: Path = Path('/opt/releases/20261104-admin-upload-stars-layout-v22/front/dist/server')

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
        yield
    finally:
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
        out.append(dict(id=row['pm_id'], name=row['name'], pid=pid,
            status=e['status'], script=e['pm_exec_path'], cwd=e['pm_cwd'],
            execMode=e['exec_mode'], restarts=e.get('restart_time'),
            configenvHash=H(encode({'env': filter_env(env), 'topEnv': filter_env(top)})),
            rawProcEnvironSha256=H((cfg.proc / str(pid) / 'environ').read_bytes())))
    out.sort(key=lambda r: r['id'])
    validate_processes(out)
    return out


def validate_processes(rows):
    need(len(rows) == 12 and len({r['id'] for r in rows}) == 12
         and len({r['pid'] for r in rows}) == 12
         and all(r['pid'] > 0 and r['status'] == 'online'
                 and HEX.fullmatch(r['configenvHash'])
                 and HEX.fullmatch(r['rawProcEnvironSha256']) for r in rows),
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
                root=str(expected), aliasLink=os.readlink(alias) if alias.is_symlink() else None)
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
                    if suffixes is not None and directory == cfg.server_alias:
                        target = directory.resolve(strict=True)
                        need(target == no_symlink(cfg.server_target), 'KNOWN_SERVER_ALIAS_TARGET_DRIFT')
                        files[str(directory)] = dict(metadata(directory), kind='directory-symlink',
                            link=os.readlink(directory), target=str(target))
                        tree(target, suffixes)
                        dirs.remove(name)
                        continue
                    # Runtime public aliases are validated separately; do not traverse
                    # aliases and duplicate the already protected fixed public trees.
                    need(suffixes is not None and name == 'public'
                         and directory.resolve(strict=True) in (cfg.public, cfg.front),
                         'DIRECTORY_SYMLINK_REFUSED')
                    dirs.remove(name)
            for name in names:
                p = Path(base) / name
                if suffixes is None or p.suffix in suffixes:
                    files[str(p)] = describe(p, allow_link=config_links or suffixes is not None)

    tree(cfg.public)
    tree(cfg.front)
    tree(cfg.nginx, config_links=True)
    scripts = sorted({r['script'] for r in rows})
    for name in scripts:
        script = Path(name)
        no_symlink(script.parent)
        files[str(script)] = describe(script, allow_link=True)
        tree(script.parent, {'.mjs', '.js', '.cjs'})
        for runtime in {script.parent / 'runtime', script.parent.parent / 'runtime'}:
            if runtime.exists():
                tree(runtime, {'.mjs', '.js', '.cjs'})
    for flag in sorted(cfg.ops.glob('official*.json')):
        files[str(flag)] = describe(flag)
    return dict(sorted(files.items()))


class Controller:
    def __init__(self, cfg=None, process_reader=None, get_reader=None):
        self.cfg = cfg or Config()
        self.process_reader = process_reader or process_snapshot
        self.get_reader = get_reader or http_get
        self.controller_hash = H(regular(Path(__file__).absolute()))

    def snapshot(self):
        rows = self.process_reader(self.cfg)
        validate_processes(rows)
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
            need(self.snapshot() == first, 'PROTECT_OR_PROCESS_DRIFT_DURING_CAPTURE')
            need(regular(self.cfg.html) == html and regular(self.cfg.coord) == coord,
                 'HTML_OR_COORD_DRIFT_DURING_CAPTURE')
            self.fresh({'capturedAtUtc': captured_at})
            return dict(schema='upload-manage-capture-v1', ownerTask=OWNER,
                scope=SCOPE, capturedAtUtc=captured_at, ttlSeconds=TTL,
                controllerSha256=self.controller_hash, publicRoot=str(self.cfg.public),
                frontRoot=str(self.cfg.front), beforeHtmlSha256=H(html),
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
                'cssRelative', 'packageFiles'}
        need(isinstance(m, dict) and set(m) == keys, 'EXACT_MANIFEST_FIELDS_REQUIRED')
        need(m['ownerTask'] == OWNER and m['scope'] == SCOPE, 'OWNER_SCOPE_MISMATCH')
        need(m['controllerSha256'] == self.controller_hash, 'CONTROLLER_SHA256_MISMATCH')
        pf = m['packageFiles']
        need(isinstance(pf, dict), 'PACKAGE_FILES_DICTIONARY_REQUIRED')
        actual = set()
        for base, dirs, names in os.walk(cfg.package, followlinks=False):
            for name in dirs + names:
                need(not (Path(base) / name).is_symlink(), 'PACKAGE_SYMLINK_REFUSED')
            actual.update((Path(base) / n).relative_to(cfg.package).as_posix() for n in names)
        optional_review = {'review.json'} if 'review.json' in actual else set()
        need(actual == set(pf) | {'manifest.json'} | optional_review,
             'EXACT_PACKAGE_CONTENTS_REQUIRED')
        contents = {}
        for name, digest in pf.items():
            relative(name)
            need(name in ('capture.json', 'before-index.html', 'after-index.html')
                 or name.startswith(('assets/', 'evidence/')), 'PACKAGE_FILE_SCOPE')
            data = regular(cfg.package / name)
            need(H(data) == pin(digest), 'PACKAGE_FILE_DRIFT: ' + name)
            contents[name] = data
        need({'capture.json', 'before-index.html', 'after-index.html'} <= set(pf)
             and any(n.startswith('evidence/') for n in pf), 'PACKAGE_BASELINE_EVIDENCE_REQUIRED')
        need(H(contents['capture.json']) == pin(m['captureSha256']), 'CAPTURE_PIN_MISMATCH')
        capture = decode(contents['capture.json'])
        need(capture['schema'] == 'upload-manage-capture-v1'
             and capture['ownerTask'] == OWNER and capture['scope'] == SCOPE
             and capture['controllerSha256'] == self.controller_hash
             and capture['publicRoot'] == str(cfg.public)
             and capture['frontRoot'] == str(cfg.front) and capture['ttlSeconds'] == TTL,
             'CAPTURE_IDENTITY_ROOTS_MISMATCH')
        self.fresh(capture)
        before, after = contents['before-index.html'], contents['after-index.html']
        need(H(before) == pin(m['beforeHtmlSha256']) == capture['beforeHtmlSha256']
             and H(after) == pin(m['afterHtmlSha256']) and before != after,
             'HTML_PINS_MISMATCH')
        assets = m['assets']
        need(isinstance(assets, list) and len(assets) in (2, 3), 'TWO_JS_OPTIONAL_CSS_ONLY')
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
        need((css_name is None and not css) or (isinstance(css_name, str) and css == {css_name}),
             'CSS_RELATIVE_MISMATCH')
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
        if css_name is not None:
            need(patched.count(b'</head>') == 1 and ('/' + css_name).encode() not in before,
                 'CSS_HEAD_INSERTION_REQUIRED')
            link = ('<link rel="stylesheet" href="/' + css_name + '">\n').encode()
            patched = patched.replace(b'</head>', link + b'</head>', 1)
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
        if review_sha is not None:
            rb = regular(cfg.package / 'review.json')
            need(H(rb) == pin(review_sha), 'REVIEW_SHA256_MISMATCH')
            review = decode(rb)
            need(review.get('status') == 'passed' and review.get('independent') is True
                 and review.get('manifestSha256') == H(mb)
                 and review.get('controllerSha256') == self.controller_hash,
                 'INDEPENDENT_REVIEW_REQUIRED')
        return dict(m=m, mb=mb, contents=contents, capture=capture, coord=cb,
                    before=before, after=after, reviewSha256=review_sha)

    def fresh(self, capture):
        age = dt.datetime.now(dt.timezone.utc).timestamp() - timestamp(capture['capturedAtUtc'])
        need(0 <= age <= TTL, 'CAPTURE_EXPIRED_OR_FUTURE: fresh capture required')

    def guard(self, bundle, after=False, added=()):
        self.fresh(bundle['capture'])
        snap = self.snapshot()
        old = bundle['capture']
        need(snap['processes'] == old['processes'], 'PROCESS_OR_ENV_DRIFT_STOP_NO_RELOAD')
        need(snap['servingRoots'] == old['servingRoots'], 'SERVING_ROOT_DRIFT')
        files = snap['protectedFiles']
        for name in added:
            files.pop(str(self.cfg.public / name), None)
        if after:
            current = files.pop(str(self.cfg.html), None)
            need(current is not None and current.get('sha256') == H(bundle['after']), 'AFTER_HTML_DRIFT')
            need({k: current[k] for k in ('statmode', 'uid', 'gid')} ==
                 {k: old['adminHtmlRecord'][k] for k in ('statmode', 'uid', 'gid')}, 'HTML_METADATA_DRIFT')
            protected = {k: v for k, v in old['protectedFiles'].items() if k != str(self.cfg.html)}
        else:
            protected = old['protectedFiles']
        need(files == protected, 'PROTECTED_FILE_OR_INVENTORY_DRIFT_STOP_NO_WRITE')
        expected_html = bundle['after'] if after else bundle['before']
        need(regular(self.cfg.html) == expected_html, 'ADMIN_HTML_FULL_BYTES_DRIFT')
        for name in added:
            need(regular(self.cfg.public / name) == bundle['contents'][name], 'NEW_ASSET_DRIFT')

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
            need(regular(self.cfg.coord) == b['coord'], 'COORD_FULL_BYTES_CAS_MISMATCH')
            coord_closed(regular(self.cfg.coord))
            need(self.cfg.stage.stat().st_dev == self.cfg.html.stat().st_dev ==
                 self.cfg.coord.stat().st_dev, 'CAS_REQUIRES_SAME_FILESYSTEM')
            return dict(status='preflight-passed', manifestSha256=H(b['mb']),
                        protectedFiles=len(b['capture']['protectedFiles']), processCount=12,
                        productionWrites=0, reviewRequiredForApply=True)

    def close(self, owned, window, status, error=None):
        cfg = self.cfg
        need(regular(cfg.coord) == owned, 'OWN_COORD_BYTES_LOST_DO_NOT_TOUCH_FOREIGN_WINDOW')
        state = decode(owned)
        need(state['window']['nonce'] == window['nonce']
             and state['window']['owner_task'] == OWNER
             and state['window']['manifestSha256'] == window['manifestSha256'], 'OWN_WINDOW_LOST')
        closed = dict(window, status='closed', outcome=status, closedAtUtc=now(),
                      needsOperatorRecovery=False, receipt=str(cfg.receipt / 'receipt.json'))
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
        with locked(cfg):
            b = self.validate(package, manifest_sha, review_sha)
            self.no_replay()
            self.guard(b)
            need(regular(cfg.coord) == b['coord'], 'COORD_FULL_BYTES_CAS_MISMATCH')
            state = coord_closed(b['coord'])
            need(cfg.stage.stat().st_dev == cfg.html.stat().st_dev == cfg.coord.stat().st_dev,
                 'CAS_REQUIRES_SAME_FILESYSTEM')
            added, owned, html_switched = [], None, False
            window = dict(owner_task=OWNER, scope=SCOPE, nonce=uuid.uuid4().hex,
                manifestSha256=H(b['mb']), controllerSha256=self.controller_hash,
                openedAtUtc=now(), status='open', needsOperatorRecovery=False)
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
                # Recheck baseline before the FIRST production write, after durable attempt.
                self.guard(b)
                atomic_cas(cfg.coord, b['coord'], opened_bytes, cfg.stage)
                owned = opened_bytes
                for a in b['m']['assets']:
                    need(regular(cfg.coord) == owned, 'OWN_COORD_BYTES_LOST')
                    name = a['relative']
                    need((cfg.public / name).parent.is_dir(), 'ASSET_PARENT_MUST_PREEXIST')
                    # Keep path in added even if write/fsync raises after creating it.
                    added.append(name)
                    exclusive(cfg.public / name, b['contents'][name], 0o644)
                self.guard(b, added=added)
                need(regular(cfg.coord) == owned, 'OWN_COORD_BYTES_LOST')
                atomic_cas(cfg.html, b['before'], b['after'], cfg.stage)
                html_switched = True
                need(H(self.get_reader('admin.51dianzi.com', '')) == H(b['after']),
                     'HTTPS_NEW_HTML_SHA256_MISMATCH')
                for a in b['m']['assets']:
                    need(H(self.get_reader('admin.51dianzi.com', a['relative'])) == a['sha256'],
                         'HTTPS_NEW_ASSET_SHA256_MISMATCH: ' + a['relative'])
                self.guard(b, after=True, added=added)
                need(regular(cfg.coord) == owned, 'OWN_COORD_BYTES_LOST')
                final = self.close(owned, window, 'verified')
                receipt = dict(status='verified', ownerTask=OWNER, scope=SCOPE,
                    nonce=window['nonce'], manifestSha256=H(b['mb']), reviewSha256=review_sha,
                    controllerSha256=self.controller_hash, captureSha256=b['m']['captureSha256'],
                    beforeHtmlSha256=H(b['before']), afterHtmlSha256=H(b['after']),
                    addedAssets=added, protectedFiles=len(b['capture']['protectedFiles']),
                    allOriginalFilesExceptAdminHtmlUnchanged=True, processesAndEnvironUnchanged=True,
                    processCount=12, apiWrites=0, databaseWrites=0, envWrites=0,
                    processReloads=0, frontHtmlWrites=0, coordSha256=H(final), closedAtUtc=now())
                exclusive(cfg.receipt / 'receipt.json', encode(receipt))
                return receipt
            except BaseException as exc:
                # Atomic rename may have happened even when fsync subsequently raised.
                error = type(exc).__name__ + ': ' + str(exc)
                status = 'failed-before-production-write'
                # Recover ownership after an open-window rename+fsync exception.
                if owned is None and regular(cfg.coord) == opened_bytes:
                    owned = opened_bytes
                if owned is not None:
                    if regular(cfg.coord) != owned:
                        status = 'recovery-required-coord-ownership-lost'
                    else:
                        current = regular(cfg.html)
                        switched = html_switched or current == b['after']
                        if switched and current == b['after']:
                            try:
                                atomic_cas(cfg.html, b['after'], b['before'], cfg.stage)
                                status = 'failed-rolled-back'
                            except BaseException:
                                status = ('failed-rolled-back' if regular(cfg.html) == b['before']
                                          else 'recovery-required-rollback-cas')
                        elif not switched and current == b['before']:
                            status = 'failed-rolled-back'  # no HTML switch; baseline already intact
                        else:
                            status = 'recovery-required-html-cas-lost'
                        if status == 'failed-rolled-back':
                            try:
                                self.close(owned, window, status, error)
                            except BaseException:
                                status = 'recovery-required-close-cas'
                # Unsafe ownership/CAS failure never edits someone else's HTML/window.
                failure = dict(status=status, ownerTask=OWNER, scope=SCOPE,
                    nonce=window['nonce'], manifestSha256=H(b['mb']), reviewSha256=review_sha,
                    error=error, addedAssets=added, assetsRetained=True,
                    processReloads=0, apiWrites=0, databaseWrites=0, failedAtUtc=now(),
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
    controller = Controller()
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
