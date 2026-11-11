#!/usr/bin/env python3
"""Fixed-candidate static-only transaction; --check is read-only.
No Git writes, PM2 control, env access, database connections or global-freeze changes.
"""
from pathlib import Path
import argparse, contextlib, fcntl, hashlib, json, os, stat, subprocess, sys, tempfile, time
sys.dont_write_bytecode = True
ROOTS = {
    'admin': Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'),
}
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
LOCKS = [Path('/run/lock/51dianzi-release.lock'), Path('/var/lock/dianzi51-public-deploy.lock')]
PROTECTED = [COORD, Path('/root/.pm2/dump.pm2'),
    Path('/etc/nginx/conf.d/dianzi51-https.conf'),
    Path('/etc/nginx/conf.d/dianzi51-admin-subdomain.conf'),
    Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js'),
    Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'),
    Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html')]
DOMAINS = {'admin': 'admin.51dianzi.com'}

def sha(b): return hashlib.sha256(b).hexdigest()
def require(condition, message):
    if not condition: raise RuntimeError(message)
def loads(p): return json.loads(Path(p).read_bytes())
def write_json(p, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    os.chmod(p, 0o600)
def meta(p):
    s = p.stat()
    return {'mode': stat.S_IMODE(s.st_mode), 'uid': s.st_uid, 'gid': s.st_gid,
            'size': s.st_size, 'mtimeNs': s.st_mtime_ns}
def file_state(p):
    require(p.is_file() and not p.is_symlink(), 'PROTECTED_FILE_MISSING_OR_SYMLINK:' + str(p))
    return {**meta(p), 'sha256': sha(p.read_bytes())}
def processes():
    result = subprocess.run(['pm2', 'jlist'], capture_output=True, check=True, timeout=20)
    data = json.loads(result.stdout)
    rows = []
    for p in data:
        e = p.get('pm2_env', {})
        rows.append({'name': p['name'], 'pid': p['pid'], 'status': e.get('status'),
                     'script': e.get('pm_exec_path'), 'cwd': e.get('pm_cwd'),
                     'uptime': e.get('pm_uptime')})
    return sorted(rows, key=lambda p: (p['name'], p['pid']))
def static_inventory():
    # All pre-existing files remain protected; fresh immutable assets are the only additions.
    result = {}
    for side, root in ROOTS.items():
        files = {}
        for p in root.rglob('*'):
            if p.is_file(): files[p.relative_to(root).as_posix()] = meta(p)
        result[side] = files
    return result

def get_static(side, url):
    domain = DOMAINS[side]
    command = ['curl', '--fail', '--silent', '--show-error', '--max-time', '20',
               '--resolve', domain + ':443:127.0.0.1', 'https://' + domain + url]
    return subprocess.run(command, capture_output=True, check=True, timeout=25).stdout

def asset_path(side, url):
    require(url.startswith('/assets/') and '..' not in url and '?' not in url and '#' not in url,
            'INVALID_ASSET_URL')
    require(url.endswith(('.js', '.css')), 'ONLY_JS_CSS_ALLOWED')
    p = ROOTS[side] / url.lstrip('/')
    require(p.parent.is_dir() and not p.parent.is_symlink(), 'EXISTING_ASSET_DIRECTORY_REQUIRED')
    require(p.resolve().is_relative_to(ROOTS[side].resolve()), 'ASSET_PATH_ESCAPE')
    return p

def verify_stage(root, release):
    require(release['schemaVersion'] == 1 and release['scope'] == 'inventory-navigation-admin-static-only', 'SCOPE')
    require(set(release['sides']) == set(ROOTS), 'EXACT_ADMIN_ONLY_SIDE')
    require(release['databaseChanges'] is False and release['apiChanges'] is False
            and release['processChanges'] is False and release['globalFreezeChanges'] is False, 'FORBIDDEN_SCOPE')
    require(sha(COORD.read_bytes()) == release['coordSha256'], 'COORDINATION_CHANGED')
    require(loads(COORD).get('shared_release_active') is False, 'CONCURRENT_RELEASE_ACTIVE')
    for name, expected in release['stageFiles'].items():
        p = root / name
        require(p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(root.resolve()), 'STAGED_PATH')
        require(sha(p.read_bytes()) == expected, 'STAGED_HASH:' + name)
    require(sha((root / 'publish-inventory-navigation.py').read_bytes()) == release['publisherSha256'], 'PUBLISHER_HASH')
    for side, spec in release['sides'].items():
        require(file_state(ROOTS[side] / 'index.html')['sha256'] == spec['beforeIndexSha256'], 'LATEST_INDEX_DRIFT:' + side)
        require(sha((root / side / 'index.html').read_bytes()) == spec['indexSha256'], 'CANDIDATE_INDEX:' + side)
        require((root / side / 'runtime-test.json').is_file() and loads(root / side / 'runtime-test.json')['passed'] is True, 'RUNTIME_TEST:' + side)
        for asset in spec['assets']:
            p = asset_path(side, asset['url'])
            require(not p.exists(), 'IMMUTABLE_DESTINATION_ALREADY_EXISTS:' + str(p))
            require(sha((root / side / asset['file']).read_bytes()) == asset['sha256'], 'ASSET_HASH')
            if asset.get('originalUrl'):
                original = asset_path(side, asset['originalUrl'])
                require(file_state(original)['sha256'] == asset['beforeSha256'], 'LIVE_BASE_ASSET_CHANGED')
    for file, expected in release['protectedFiles'].items():
        require(file_state(Path(file)) == expected, 'PROTECTED_STATE_CHANGED:' + file)
    require(processes() == release['processes'], 'PROCESS_STATE_CHANGED')

@contextlib.contextmanager
def locks():
    handles = []
    try:
        for p in LOCKS:
            fd = os.open(p, os.O_RDWR | os.O_CREAT, 0o600)
            handles.append(fd)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        for fd in reversed(handles): os.close(fd)

def atomic_replace(destination, data, metadata=None):
    fd, filename = tempfile.mkstemp(prefix='.inventory-navigation-', dir=destination.parent)
    temp = Path(filename)
    try:
        remaining = memoryview(data)
        while remaining:
            written = os.write(fd, remaining)
            require(written > 0, 'INCOMPLETE_ATOMIC_WRITE')
            remaining = remaining[written:]
        os.fsync(fd)
        if metadata:
            os.fchmod(fd, metadata['mode'])
            os.fchown(fd, metadata['uid'], metadata['gid'])
        else: os.fchmod(fd, 0o644)
        os.close(fd); fd = None
        os.replace(temp, destination)
        parent_fd = os.open(destination.parent, os.O_DIRECTORY)
        try: os.fsync(parent_fd)
        finally: os.close(parent_fd)
    finally:
        if fd is not None: os.close(fd)
        if temp.exists(): temp.unlink()

def apply(root, release, release_sha):
    approval_path = root / 'fixed-candidate-approval.json'
    approval = loads(approval_path)
    require(approval.get('approved') is True and approval.get('releaseManifestSha256') == release_sha,
            'FRESH_EXACT_CANDIDATE_APPROVAL_REQUIRED')
    require(approval.get('approvedAt') and approval.get('authorizedAction') == 'publish-this-static-candidate-only', 'APPROVAL_BOUNDARY')
    require(not (root / 'receipt.json').exists(), 'RECEIPT_EXISTS_INSPECT_BEFORE_RETRY')
    verify_stage(root, release)
    initial_static = static_inventory()
    before_indexes = {side: (ROOTS[side] / 'index.html').read_bytes() for side in ROOTS}
    index_metadata = {side: meta(ROOTS[side] / 'index.html') for side in ROOTS}
    backup = root / 'backup'; backup.mkdir(mode=0o700)
    for side in ROOTS:
        (backup / (side + '-index.html')).write_bytes(before_indexes[side])
        os.chmod(backup / (side + '-index.html'), 0o600)
    write_json(backup / 'index-metadata.json', index_metadata)
    switched = []
    try:
        # New content-addressed assets are installed before any page points to them.
        for side, spec in release['sides'].items():
            for asset in spec['assets']:
                destination = asset_path(side, asset['url'])
                fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
                try:
                    data = (root / side / asset['file']).read_bytes()
                    with os.fdopen(fd, 'wb') as stream:
                        stream.write(data); stream.flush(); os.fsync(stream.fileno())
                except Exception:
                    raise
                require(sha(destination.read_bytes()) == asset['sha256'], 'INSTALLED_ASSET_HASH')
                require(sha(get_static(side, asset['url'])) == asset['sha256'], 'INSTALLED_HTTP_ASSET_HASH')
        # Exact CAS at activation, under both existing release locks.
        for side, spec in release['sides'].items():
            index = ROOTS[side] / 'index.html'
            require(sha(index.read_bytes()) == spec['beforeIndexSha256'], 'INDEX_CAS_FAILED:' + side)
            require(sha(COORD.read_bytes()) == release['coordSha256'], 'COORD_CAS_FAILED')
            atomic_replace(index, (root / side / 'index.html').read_bytes(), index_metadata[side])
            switched.append(side)
            require(sha(get_static(side, '/index.html')) == spec['indexSha256'], 'LIVE_HTTP_INDEX_HASH:' + side)
        for file, expected in release['protectedFiles'].items():
            require(file_state(Path(file)) == expected, 'PROTECTED_AFTER:' + file)
        require(processes() == release['processes'], 'PROCESS_AFTER')
        after_static = static_inventory()
        for side, before in initial_static.items():
            for filename, metadata in before.items():
                if filename != 'index.html': require(after_static[side].get(filename) == metadata, 'UNRELATED_STATIC_CHANGED:' + side + ':' + filename)
            additions = set(after_static[side]) - set(before)
            allowed = {a['url'].lstrip('/') for a in release['sides'][side]['assets']}
            require(additions == allowed, 'UNEXPECTED_STATIC_ADDITION:' + side)
        receipt = {'schemaVersion': 1, 'status': 'verified', 'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                   'releaseManifestSha256': release_sha, 'sourceCommits': release['sourceCommits'],
                   'indexes': {side: spec['indexSha256'] for side, spec in release['sides'].items()},
                   'assets': {side: spec['assets'] for side, spec in release['sides'].items()},
                   'processesUnchanged': True, 'protectedFilesUnchanged': True,
                   'allPriorStaticFilesUnchanged': True, 'globalHoldPreserved': True,
                   'databaseConnected': False, 'apiChanged': False, 'pm2ControlOperations': False,
                   'rollbackBackupDirectory': str(backup), 'approvedAt': approval['approvedAt']}
        write_json(root / 'receipt.json', receipt)
        print(json.dumps({k: receipt[k] for k in ['status', 'sourceCommits', 'indexes', 'globalHoldPreserved']}, ensure_ascii=False, indent=2))
    except Exception as error:
        restored = []
        for side in reversed(switched):
            index = ROOTS[side] / 'index.html'
            # Never roll back a concurrent update by another task.
            require(sha(index.read_bytes()) == release['sides'][side]['indexSha256'], 'ROLLBACK_CAS_FAILED:' + side)
            atomic_replace(index, before_indexes[side], index_metadata[side])
            os.utime(index, ns=(index_metadata[side]['mtimeNs'], index_metadata[side]['mtimeNs']))
            restored.append(side)
        write_json(root / 'failure-receipt.json', {'status': 'failed-and-rollback-attempted', 'error': str(error), 'restoredIndexes': restored, 'newImmutableAssetsMayRemainUnreferenced': True})
        raise

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--release-sha', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    root = Path(args.root).resolve()
    require(str(root).startswith('/opt/ops/20261111-inventory-navigation-'), 'FIXED_OPS_DIRECTORY')
    manifest = root / 'release-manifest.json'
    require(sha(manifest.read_bytes()) == args.release_sha, 'EXPLICIT_MANIFEST_HASH')
    release = loads(manifest)
    with locks():
        if args.apply: apply(root, release, args.release_sha)
        else:
            verify_stage(root, release)
            print(json.dumps({'status': 'candidate-verified-read-only', 'releaseManifestSha256': args.release_sha,
                              'sourceCommits': release['sourceCommits'], 'globalFreezeChanged': False,
                              'productionStaticWrites': False}, indent=2))

if __name__ == '__main__': main()
