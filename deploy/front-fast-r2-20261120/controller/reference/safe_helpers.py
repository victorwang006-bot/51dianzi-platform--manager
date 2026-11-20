#!/usr/bin/env python3
"""Pure helpers extracted from reviewed legacy release.py; no legacy Controller/main/config.
Extraction source SHA256: 9bb7a96bb26b8998fcbd586fd7d5c4ac012dd6a9afb5ac4690634266e94d300b
All runtime operations are called explicitly by the new scope controller.
"""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import uuid
from contextlib import contextmanager
HEX = re.compile(r'[0-9a-f]{64}')
_ACTIVE_LOCKS = []

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


