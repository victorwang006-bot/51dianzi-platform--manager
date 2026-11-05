#!/usr/bin/env python3
"""Static-only publisher. No SSH, server build, DB, installs, reload/restart or deletion.
Default --plan is read-only. --verify-local does not access production paths.
Apply/rollback require explicit flags and run only after separate production authorization.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import fcntl
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import urllib.request

VERSION = '20261105-admin-navigation-priority-v1'
TASK = 'FCQEBhhCo90HxcTxZAQUMk'
PUBLIC = Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
HTML = PUBLIC / 'index.html'
RELEASE = Path('/opt/ops') / VERSION
LOCK = Path('/var/lock/dianzi51-public-deploy.lock')
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
ADMIN_SCRIPT = '/opt/releases/20261104-channel-inventory-ci-management-v1/admin/dist/index.js'
BASELINE = {
    'index.html': 'be09a54a98a8818489747f126b842eb190e9aeb51cd434b4418d8aa48d86e53e',
    'BusinessWorkbenchPage-channel-topnav-8a87eab5f4411680.js': '8a87eab5f44116805d58f8f1c4e67dd3aa343fadb64c89c298a66472d291f7db',
    'DashboardLayout-hierarchy-0d8df8ea8ac13048.js': '0d8df8ea8ac13048b624c2a58a69fbc205d684c7ec00c16e8e03aa24e51ec97e',
    'index-CG0lkwm6.js': '602034896c9cb13cf9ad805dc07aae113ea907cb4291cff09189398f2c727bd8',
    'index-C0vPar7R.css': '871768387861545514e30d482d34a3cf7a15a0f783bde72c998ab89e2863b5d2',
    'channel-inventory-management-6180ba0776bef02e.css': '6180ba0776bef02e9c256c349be63feeb15235246fb3340121d9dbd2b7cd9980',
    'workbench-dropdown-db9a38c798c52dd6.css': 'db9a38c798c52dd6c905db76fb7224eb36db221339db4a4dfb610b2dd3d9e96e',
    'workspace-hierarchy-e7d8dc9d788ea1bb.css': 'e7d8dc9d788ea1bb9710dac406fd972067957d49b83ce2e5a901703d0547ab69',
}
class Stop(Exception):
    pass

def require(ok, label):
    if not ok:
        raise Stop(label)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()

def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()

def now():
    return datetime.now(timezone.utc).isoformat()

def atomic(path, data, mode=None):
    path = Path(path)
    require(not path.is_symlink(), 'atomic target symlink forbidden')
    old = path.stat() if path.exists() else None
    require(mode is not None or old is not None, 'explicit mode required for new file')
    fd, tmp = tempfile.mkstemp(prefix='.admin-priority-', dir=path.parent)
    try:
        os.fchmod(fd, mode if mode is not None else stat.S_IMODE(old.st_mode))
        if old:
            os.fchown(fd, old.st_uid, old.st_gid)
        with os.fdopen(fd, 'wb') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
        d = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(d)
        finally:
            os.close(d)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def record(package, name, value):
    atomic(package / name, encode(value), 0o600)

def safe_relative(name):
    require(isinstance(name, str) and bool(name) and re.fullmatch(r'[A-Za-z0-9_./-]+', name), 'invalid relative artifact path')
    p = PurePosixPath(name)
    require(not p.is_absolute() and all(x not in ('', '.', '..') for x in name.split('/')), 'path escape forbidden')
    return p

def regular_under(root, rel):
    p = Path(root)
    require(not p.is_symlink(), 'package root symlink forbidden')
    for part in safe_relative(rel).parts:
        p = p / part
        require(not p.is_symlink(), 'artifact ancestor symlink forbidden')
    require(p.is_file(), 'artifact missing')
    require(p.resolve().is_relative_to(Path(root).resolve()), 'artifact outside package')
    return p

class GraphParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.assets = []; self.modules = []; self.importmaps = 0
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'script' and a.get('type') == 'importmap':
            self.importmaps += 1
        if tag == 'script' and a.get('type') == 'module':
            self.modules.append(a.get('src'))
        url = a.get('src') if tag == 'script' else a.get('href') if tag == 'link' else None
        if url and url.startswith('/assets/'):
            self.assets.append(url[1:])

def validate_package(package):
    package = Path(package)
    manifest_bytes = regular_under(package, 'manifest.json').read_bytes()
    m = json.loads(manifest_bytes)
    require(m.get('schemaVersion') == 1 and m.get('release') == VERSION and m.get('task') == TASK, 'wrong release/task/schema')
    require(m.get('kind') == 'frozen-full-production-frontend', 'wrong build strategy')
    require(m.get('baseline') == BASELINE, 'wrong frozen baseline')
    require(re.fullmatch(r'[a-f0-9]{40}', m.get('sourceCommit', '')) is not None, 'real git HEAD required')
    require(re.fullmatch(r'[a-f0-9]{64}', m.get('sourceTreeSha256', '')) is not None, 'source SHA required')
    namespace = m.get('namespace', '')
    require(namespace == VERSION + '-' + m['sourceTreeSha256'][:12], 'namespace must bind full source SHA')
    g = m.get('guard', {})
    for flag in ('actualTypecheckPassed', 'actualRegressionTestsPassed', 'frontendOnlyProductionBuildPassed', 'sourceStable', 'isolatedNoEnvFiles', 'currentChannelFeaturesBundled', 'oldHtmlOtherBytesPreserved', 'oldAssetsNeverDeleted'):
        require(g.get(flag) is True, 'missing build guard: ' + flag)
    require(g.get('serverBundleBuilt') is False and g.get('productionDeploymentPerformed') is False, 'forbidden build/deploy scope')
    require(len(m.get('checks', [])) == 3 and all(c.get('exitCode') == 0 for c in m['checks']), 'actual checks not all successful')
    assets = m.get('assets', [])
    require(len(assets) >= 2, 'asset graph absent')
    names = [a['path'] for a in assets]
    require(len(set(names)) == len(names), 'duplicate asset paths')
    for item in assets + m.get('evidence', []) + [m['html']]:
        p = regular_under(package, item['path'])
        require(re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', '')) is not None and sha(p) == item['sha256'] and p.stat().st_size == item['bytes'], 'artifact/evidence hash mismatch')
    for name in names:
        require(name.startswith('assets/' + namespace + '/') and not name.endswith(('.map', '.html')), 'new namespace only')
    for item in m.get('rootAssetsMustRemainUnchanged', []):
        safe_relative(item['path']); require(not item['path'].startswith('assets/') and item['path'] != 'index.html', 'root resource whitelist')
    require(m['html']['path'] == 'candidate-index.html', 'HTML whitelist')
    require(sha(regular_under(package, 'evidence/freeze.json')) == m['sourceFreezeSha256'], 'source freeze not bound')
    freeze = json.loads(regular_under(package, 'evidence/freeze.json').read_bytes())
    require(freeze['sourceCommit'] == m['sourceCommit'] and freeze['sourceTreeSha256'] == m['sourceTreeSha256'], 'freeze/source mismatch')
    checks = json.loads(regular_under(package, 'evidence/checks.json').read_bytes())
    require(len(checks) == 3 and all(c['exitCode'] == 0 for c in checks), 'check evidence failed')
    for c in checks:
        require(sha(regular_under(package, 'evidence/' + c['log'])) == c['logSha256'], 'actual log hash mismatch')
    require(checks[0]['command'][:3] == ['pnpm', 'exec', 'tsc'] and '--noEmit' in checks[0]['command'], 'real typecheck command absent')
    require(checks[1]['command'][:4] == ['pnpm', 'exec', 'vitest', 'run'], 'real tests command absent')
    candidate = regular_under(package, 'candidate-index.html').read_bytes()
    parser = GraphParser(); parser.feed(candidate.decode('utf-8'))
    require(len(parser.modules) == 1 and parser.importmaps == 0 and set(parser.assets).issubset(set(names)), 'HTML graph not entirely new assets')
    require(parser.modules[0] and parser.modules[0][1:] in names, 'entry asset missing')
    edits = json.loads(regular_under(package, 'evidence/html-edits.json').read_bytes())
    require(len(edits) == 5, 'only five known asset-graph HTML edits allowed')
    for e, marker in zip(edits[:3], ('ci-management-v1', 'workbench-dropdown-nav-v1', 'workspace-hierarchy-nav-v1')):
        require(e['after'] == '' and e['before'].startswith('<!-- ' + marker + ':start -->') and e['before'].endswith('<!-- ' + marker + ':end -->\n'), 'only superseded overlay blocks may be deactivated')
    require(edits[3]['before'] == '<script type="module" crossorigin src="/assets/index-CG0lkwm6.js"></script>', 'only original entry tag may change')
    require(edits[4]['before'] == '<link rel="stylesheet" crossorigin href="/assets/index-C0vPar7R.css">', 'only original stylesheet tag may change')
    escaped_namespace = re.escape(namespace)
    require(re.fullmatch(r'<script type="module" crossorigin src="/assets/' + escaped_namespace + r'/[A-Za-z0-9_.-]+\.js"></script>', edits[3]['after']) is not None, 'new entry tag whitelist')
    for tag in edits[4]['after'].split('\n    '):
        require(re.fullmatch(r'<link rel="(?:stylesheet|modulepreload)" crossorigin href="/assets/' + escaped_namespace + r'/[A-Za-z0-9_.-]+\.(?:css|js)">', tag) is not None, 'new CSS/preload tag whitelist')
    # JS offsets are UTF-16 code units; avoid Python/code-point offset mismatch.
    restored = candidate.decode('utf-8').encode('utf-16-le')
    for e in reversed(edits):
        before, after = e['before'].encode('utf-16-le'), e['after'].encode('utf-16-le')
        start = e['start'] * 2
        require(digest(e['before'].encode()) == e['beforeSha256'] and digest(e['after'].encode()) == e['afterSha256'], 'HTML edit hash invalid')
        require(restored[start:start + len(after)] == after, 'HTML inverse range drift')
        restored = restored[:start] + before + restored[start + len(after):]
    require(digest(restored.decode('utf-16-le').encode('utf-8')) == BASELINE['index.html'], 'other HTML bytes changed')
    return m, manifest_bytes, candidate

def processes():
    # Existing deployment discipline: capture PM2 read-only result, emit/persist
    # only process metadata and a one-way env digest, never credential values.
    p = subprocess.run(['/usr/bin/node-22', '/usr/local/lib/node_modules/pm2/bin/pm2', 'jlist'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=25)
    require(p.returncode == 0, 'PM2 read failed')
    rows = []
    for x in json.loads(p.stdout):
        e = x['pm2_env']
        rows.append({'id': x['pm_id'], 'name': x['name'], 'pid': x['pid'], 'script': e.get('pm_exec_path'), 'cwd': e.get('pm_cwd'), 'status': e.get('status'), 'restarts': e.get('restart_time'), 'mode': e.get('exec_mode'), 'envHash': digest(json.dumps(e.get('env', {}), sort_keys=True, default=str).encode())})
    return sorted(rows, key=lambda r: r['id'])

def protected_snapshot():
    ps = processes(); roots = {}; paths = set()
    for p in ps:
        require(p['script'] and Path(p['script']).is_file(), 'running process script missing')
        paths.add(p['script'])
        if p['name'] not in ('dianzi51', 'dianzi51-admin'):
            continue
        served = (Path(p['script']).parent / 'public/index.html').resolve(strict=True)
        require(served.is_file(), 'running app static root missing')
        if p['name'] == 'dianzi51':
            require(served != HTML.resolve(), 'front must never serve admin HTML')
        else:
            require(served == HTML.resolve(), 'actual admin static root changed')
            require(p['script'] == ADMIN_SCRIPT, 'tombstone-aware admin backend must remain active')
        roots[str(p['id'])] = {'name': p['name'], 'html': str(served)}
    require(any(r['name'] == 'dianzi51' for r in roots.values()) and any(r['name'] == 'dianzi51-admin' for r in roots.values()), 'required serving roots missing')
    paths.update(r['html'] for r in roots.values())
    paths.update(['/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html', '/etc/nginx/conf.d/dianzi51-admin-subdomain.conf', '/etc/nginx/conf.d/dianzi51-https.conf', '/opt/config/dianzi51/ecosystem.config.cjs', '/root/.pm2/dump.pm2'])
    paths.discard(str(HTML.resolve()))
    require(all(Path(p).is_file() for p in paths), 'protection file missing')
    # Files are hashed as opaque bytes; no config/environment secrets are parsed or printed.
    return {'processes': ps, 'servingRoots': roots, 'protectedFiles': {p: sha(p) for p in sorted(paths)}}

def inventory_tree(exclude_namespace=None):
    rows = []
    for p in sorted((PUBLIC / 'assets').rglob('*')):
        rel = p.relative_to(PUBLIC / 'assets')
        if exclude_namespace and rel.parts[0] == exclude_namespace:
            continue
        if not p.is_file() and not p.is_symlink():
            continue
        s = p.lstat()
        rows.append([str(rel), s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_mode, s.st_uid, s.st_gid, s.st_ino, os.readlink(p) if p.is_symlink() else None, None if p.is_symlink() else sha(p)])
    return rows

def guard(before, package, m):
    require(sha(package / 'manifest.json') == before['manifestSha256'], 'frozen manifest drift')
    require(protected_snapshot() == before['protected'], 'backend/process/env/config/front drift')
    require(inventory_tree(m['namespace']) == before['assetTree'], 'old asset bytes/metadata drift')
    for a in m['rootAssetsMustRemainUnchanged']:
        require(sha(regular_under(PUBLIC, a['path'])) == a['sha256'], 'root public resource drift')

def health():
    rows = []
    for url in ('http://127.0.0.1:3001/login', 'http://127.0.0.1:3000/'):
        with urllib.request.urlopen(url, timeout=20) as r:
            require(r.status == 200, 'HTTP health failed'); r.read(); rows.append({'url': url, 'status': r.status})
    return rows

def verify_url(url, expected):
    with urllib.request.urlopen(url, timeout=45) as r:
        require(r.status == 200 and digest(r.read()) == expected, 'HTTP/hash verification failed')

def production_baseline(m):
    require(not HTML.is_symlink() and sha(HTML) == BASELINE['index.html'], 'admin HTML changed; rebase needed')
    for name, expected in BASELINE.items():
        if name != 'index.html':
            require(sha(PUBLIC / 'assets' / name) == expected, 'static baseline drift: ' + name)
    for a in m['rootAssetsMustRemainUnchanged']:
        require(sha(regular_under(PUBLIC, a['path'])) == a['sha256'], 'existing favicon/public asset differs; no root overwrite permitted')

def approve(package, manifest_sha):
    p = regular_under(package, 'qa-approval.json'); qa = json.loads(p.read_bytes())
    require(qa.get('manifestSha256') == manifest_sha and qa.get('approvedByTask') == TASK, 'QA receipt is not bound to this task/manifest')
    require(qa.get('isolatedAuthorizedUiQaPassed') is True and qa.get('serverApiCompatibilityPassed') is True, 'isolated authorized UI/API QA not approved')
    return sha(p)

def copy_new_asset(package, a):
    src = regular_under(package, a['path']); dest = PUBLIC / a['path']
    require(not dest.exists() and not dest.is_symlink(), 'immutable asset exists; inspect partial release')
    p = PUBLIC
    for part in PurePosixPath(a['path']).parts[:-1]:
        p = p / part; require(not p.is_symlink(), 'static ancestor symlink forbidden')
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.admin-priority-', dir=dest.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(src.read_bytes()); f.flush(); os.fsync(f.fileno()); os.fchmod(f.fileno(), 0o644)
        require(sha(tmp) == a['sha256'], 'immutable copy hash failed')
        os.link(tmp, dest)  # EEXIST is fatal; never overwrites an old asset.
        d = os.open(dest.parent, os.O_RDONLY)
        try:
            os.fsync(d)
        finally:
            os.close(d)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def execute(package, rollback=False):
    require(package.resolve() == RELEASE.resolve() and not package.is_symlink(), 'apply package must be exact release directory')
    require(not LOCK.is_symlink() and not COORD.is_symlink(), 'coord/lock symlink forbidden')
    with open(LOCK, 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Stop('another deployment holds shared global lock')
        m, manifest_bytes, candidate = validate_package(package)
        coord = json.loads(COORD.read_bytes()); require(not coord.get('shared_release_active'), 'another release active or interrupted; inspect coordination')
        if rollback:
            before = json.loads(regular_under(package, 'applied.json').read_bytes())
            require(sha(HTML) == m['html']['sha256'], 'HTML no longer this release; do not roll back')
            guard(before, package, m)
            backup = regular_under(package, 'before-index.html').read_bytes()
            require(digest(backup) == BASELINE['index.html'], 'backup hash invalid')
            atomic(HTML, backup); guard(before, package, m); health()
            record(package, 'html-rollback.json', {'at': now(), 'htmlSha256': sha(HTML), 'assetsAndBackendDataPreserved': True})
            print('Only this release admin HTML rolled back; all assets/backends/data retained.'); return
        require(not any((package / n).exists() for n in ('before-state.json', 'before-index.html', 'applied.json', 'verified.json')), 'partial/already applied release exists; inspect private receipts, do not replay')
        production_baseline(m)
        require(not (PUBLIC / 'assets' / m['namespace']).exists() and not (PUBLIC / 'assets' / m['namespace']).is_symlink(), 'new namespace already exists; inspect partial staging')
        manifest_sha = digest(manifest_bytes); qa_sha = approve(package, manifest_sha)
        before = {'protected': protected_snapshot(), 'assetTree': inventory_tree(), 'manifestSha256': manifest_sha, 'htmlSha256': sha(HTML), 'qaApprovalSha256': qa_sha}
        require(all(p['status'] == 'online' for p in before['protected']['processes']), 'a process is not online')
        record(package, 'before-state.json', before)
        with open(package / 'before-index.html', 'xb') as f:
            os.fchmod(f.fileno(), 0o600); f.write(HTML.read_bytes()); f.flush(); os.fsync(f.fileno())
        guard(before, package, m); health()
        coord.setdefault('navigation_windows', []).append({'owner_task': TASK, 'release': str(RELEASE), 'status': 'applying', 'manifestSha256': manifest_sha})
        coord['shared_release_active'] = True; atomic(COORD, encode(coord))
        try:
            for a in m['assets']:
                copy_new_asset(package, a)
                verify_url('http://127.0.0.1:3001/' + a['path'], a['sha256'])
            asset_root = os.open(PUBLIC / 'assets', os.O_RDONLY)
            try:
                os.fsync(asset_root)
            finally:
                os.close(asset_root)
            guard(before, package, m)
            require(sha(package / 'qa-approval.json') == qa_sha, 'QA approval changed')
            require(sha(HTML) == BASELINE['index.html'], 'HTML changed before activation')
            # Verify the entire frozen package again immediately before the sole mutable switch.
            validate_package(package)
            atomic(HTML, candidate)
            record(package, 'applied.json', {**before, 'at': now(), 'htmlAfterSha256': sha(HTML)})
            guard(before, package, m)
            result_health = health()
            for origin in ('http://127.0.0.1:3001', 'https://admin.51dianzi.com'):
                verify_url(origin + '/login', m['html']['sha256'])
                # Bounded, read-only hash checks; every future must succeed.
                with ThreadPoolExecutor(max_workers=6) as executor:
                    futures = [executor.submit(verify_url, origin + '/' + a['path'], a['sha256']) for a in m['assets']]
                    for future in futures:
                        future.result()
            guard(before, package, m)
            verified = {'ok': True, 'verifiedAt': now(), 'htmlSha256': sha(HTML), 'sourceCommit': m['sourceCommit'], 'sourceTreeSha256': m['sourceTreeSha256'], 'manifestSha256': manifest_sha, 'assets': len(m['assets']), 'noProcessRestart': True, 'backendsWorkersEnvNginxFrontUnchanged': True, 'oldAssetBytesAndMetadataUnchanged': True, 'databaseTouched': False, 'health': result_health}
            record(package, 'verified.json', verified)
            coord['navigation_windows'][-1]['status'] = 'verified'; coord['navigation_windows'][-1]['receipt'] = str(package / 'verified.json')
            print(json.dumps(verified, ensure_ascii=False))
        except Exception:
            # Never clobber a later HTML release. Auto-revert only our own switch.
            reverted = False
            if sha(HTML) == m['html']['sha256']:
                backup = regular_under(package, 'before-index.html').read_bytes()
                require(digest(backup) == BASELINE['index.html'], 'failure backup invalid; manual review required')
                atomic(HTML, backup); reverted = True
                record(package, 'failure-html-rollback.json', {'at': now(), 'htmlSha256': sha(HTML), 'oldAssetsAndNewAssetsRetained': True})
            record(package, 'stopped.json', {'at': now(), 'htmlRolledBack': reverted, 'currentHtmlSha256': sha(HTML), 'inspectBeforeRetry': True})
            coord['navigation_windows'][-1]['status'] = 'stopped; HTML reverted' if reverted else 'stopped; inspect current HTML'
            raise
        finally:
            coord['shared_release_active'] = False; atomic(COORD, encode(coord))

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package', type=Path, default=RELEASE)
    g = p.add_mutually_exclusive_group()
    g.add_argument('--verify-local', action='store_true')
    g.add_argument('--plan', action='store_true')
    g.add_argument('--apply', action='store_true')
    g.add_argument('--rollback-html', action='store_true')
    args = p.parse_args()
    m, manifest_bytes, _ = validate_package(args.package)
    if args.verify_local:
        print(json.dumps({'ok': True, 'offlineOnly': True, 'package': str(args.package), 'manifestSha256': digest(manifest_bytes), 'sourceCommit': m['sourceCommit'], 'sourceTreeSha256': m['sourceTreeSha256'], 'assets': len(m['assets'])}, ensure_ascii=False)); return
    if args.apply or args.rollback_html:
        execute(args.package, rollback=args.rollback_html); return
    production_baseline(m)
    protected = protected_snapshot()
    print(json.dumps({'planOnly': True, 'scope': 'immutable namespaced frontend assets + sole admin HTML atomic switch; old assets retained', 'htmlBefore': sha(HTML), 'htmlAfter': m['html']['sha256'], 'manifestSha256': digest(manifest_bytes), 'assets': len(m['assets']), 'allProcessesOnline': all(p['status'] == 'online' for p in protected['processes']), 'noProductionWritesPerformed': True}, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Stop as e:
        print('STOP: ' + str(e)); raise SystemExit(1)
    except Exception:
        print('STOP: operation failed; inspect local/private evidence. No raw environment or credentials are emitted. Do not replay or roll back backends.'); raise SystemExit(1)
