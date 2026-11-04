#!/usr/bin/env python3
"""Server-local, thin release deployment. No SSH, build, install or history deletion.
Default is a plan and does not inspect PM2, create files, or connect to a database.

Staged release/manifest.json (parent must freeze all hashes):
 {"schemaVersion":1,"artifacts": {
   "front/dist/index.js":"<sha256>", "admin/dist/index.js":"<sha256>",
   "front/scripts/apply-channel-inventory-management-schema.mjs":"<sha256>",
   "front/scripts/channel-inventory-management-schema.mjs":"<sha256>",
   "frontend/manifest.json":"<sha256>", "frontend/candidate-index.html":"<sha256>",
   "frontend/<manifest.outputs.js basename>":"<sha256>",
   "frontend/<manifest.outputs.css basename>":"<sha256>"}}
Copy both deployment scripts next to each other on the server. The overlay manifest
retains its original local paths; only their basenames are used for staged files.
Phases each require --apply: --prepare, --migrate, --activate, --rollback.
Rollback restores ONLY this release's HTML; new sidecar schema and backends remain.
Old-backend rollback is deliberately unsupported: tombstones can expose stock.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

OLD = Path('/opt/releases/20261104-admin-upload-stars-layout-v22')
MAIN_PUBLIC = Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public')
ADMIN_PUBLIC = Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
ADMIN_HTML = ADMIN_PUBLIC / 'index.html'
ECOSYSTEM = Path('/opt/config/dianzi51/ecosystem.config.cjs')
HELPER = Path(__file__).resolve().with_name('prepare-runtime-config.mjs')
RELOAD_HELPER = Path(__file__).resolve().with_name('reload-target.mjs')
NAMES = ('dianzi51', 'dianzi51-admin')
BASE = {
 str(OLD/'front/dist/index.js'): '1ad07f91ce19012969ffe1924475d41052c6596a8d02b700781e5a9862b5c7c9',
 str(OLD/'admin/dist/index.js'): '280729cc333b7a20784448c186b30b1e9edb4a9af112915637a70961f369e8c0',
 str(ADMIN_HTML): 'bda9ddbf37c704bdc5936542f7d64b618763c90f719f5415a3f82c5cf9b04135',
 str(ADMIN_PUBLIC/'assets/index-CG0lkwm6.js'): '602034896c9cb13cf9ad805dc07aae113ea907cb4291cff09189398f2c727bd8',
 str(ADMIN_PUBLIC/'assets/BusinessWorkbenchPage-DZYOmou-.js'): 'e5ac178e1f375777e8b01ec67d02cb4a51964a159e983b49237a5102bf43e156',
 str(ADMIN_PUBLIC/'assets/BusinessWorkbenchPage-DnkGIroY.css'): 'c6d9560d767b681275ffa5600beb63411172847ac27b1c0296c1f6bc5355e7a7',
 str(ADMIN_PUBLIC/'assets/index-C0vPar7R.css'): '871768387861545514e30d482d34a3cf7a15a0f783bde72c998ab89e2863b5d2',
 str(MAIN_PUBLIC/'index.html'): 'a698abc9300d1e8e1a8ffe70d4ad7c28cf69ef3d37cee078adb3168eeea6e1e6',
 '/etc/nginx/conf.d/dianzi51-admin-subdomain.conf': '987cf4987f65f6a13923b7b3edc7148b3bf788812a20133a0dc222deb6486aea',
 '/etc/nginx/conf.d/dianzi51-https.conf': 'd13e4aa6e785bf13d0fbc44e78a115b98576f40f1a732bb4dbd1943063001744',
}
TABLES = ['channel_inventory_material_management', 'channel_inventory_upload_batches',
          'channel_inventory_upload_batch_materials', 'channel_inventory_management_requests']
class Stop(Exception):
    pass

def require(condition, label):
    if not condition:
        raise Stop(label)

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()

def private_json(path, value):
    atomic(path, (json.dumps(value, indent=2, ensure_ascii=False)+'\n').encode(), 0o600)

def atomic(path, data, mode=None):
    """Never replaces HTML before an entire durable same-directory temp exists."""
    metadata = path.stat() if path.exists() else None
    fd, temp = tempfile.mkstemp(prefix='.ci-management-', dir=path.parent)
    try:
        os.fchmod(fd, mode if mode is not None else stat.S_IMODE(metadata.st_mode))
        if metadata and os.geteuid() == 0:
            os.fchown(fd, metadata.st_uid, metadata.st_gid)
        with os.fdopen(fd, 'wb') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        os.replace(temp, path)
        d = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(d)
        finally: os.close(d)
    finally:
        if os.path.exists(temp): os.unlink(temp)

def run(command, label, timeout=120):
    # Capture *both* streams. Migration/PM2 errors can contain credentials.
    try:
        p = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Stop(label+' failed; output suppressed') from None
    require(p.returncode == 0, label+' failed; output suppressed')
    return p.stdout

def snapshot():
    return json.loads(run(['node', str(HELPER), '--snapshot'], 'PM2 snapshot'))

def health():
    # Known HTTP page routes only; no assumption of /api/health or material RPC.
    for url in ('http://127.0.0.1:3000/', 'http://127.0.0.1:3001/login'):
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                require(r.status == 200, 'HTTP readiness not 200')
        except Exception:
            raise Stop('HTTP readiness failed (root/login); no response body logged') from None

def links(release):
    result = {}
    cwds = [Path('/opt/releases/20261031-forum-quote-v34/front'),
            Path('/opt/releases/20261031-wechat-chat-entry-v33/admin')]
    for i, side in enumerate(('front', 'admin')):
        result[release/side/'node_modules'] = Path('/opt/releases/20261030-migration-v14')/side/'node_modules'
        result[release/side/'package.json'] = cwds[i]/'package.json'
        result[release/side/'dist/public'] = [MAIN_PUBLIC, ADMIN_PUBLIC][i]
    legacy_public = Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/public')
    if legacy_public.exists():
        result[release/'admin/public'] = legacy_public
    for name in ('forumPdfScanWorker.mjs', 'server', 'marketSnapshotRefresh.js',
                 'publicHotSnapshotRefresh.js', 'recommendationValueRefresh.js'):
        result[release/'front/dist'/name] = OLD/'front/dist'/name
    return result

def artifacts(release):
    manifest = json.loads((release/'manifest.json').read_text())
    require(manifest.get('schemaVersion') == 1, 'staged manifest version')
    entries = manifest.get('artifacts', {})
    required = {'front/dist/index.js', 'admin/dist/index.js',
                'front/scripts/apply-channel-inventory-management-schema.mjs',
                'front/scripts/channel-inventory-management-schema.mjs',
                'frontend/manifest.json', 'frontend/candidate-index.html'}
    overlay = json.loads((release/'frontend/manifest.json').read_text())
    require(overlay.get('smoke', {}).get('passed') is True, 'overlay smoke proof missing')
    for kind in ('js', 'css'):
        out = overlay['outputs'][kind]
        name = Path(out['path']).name
        require(re.fullmatch(r'[A-Za-z0-9_-]+\.'+kind, name) is not None, 'invalid asset basename')
        require(out['assetUrl'] == '/assets/'+name, 'asset URL contract')
        required.add('frontend/'+name)
        require(entries.get('frontend/'+name) == out['sha256'], 'overlay/staging hash disagreement')
    require(set(entries) == required, 'staged artifact whitelist mismatch')
    for name, digest in entries.items():
        require(re.fullmatch('[a-f0-9]{64}', digest) is not None, 'invalid artifact digest')
        p = release/name
        require(p.is_file() and not p.is_symlink(), 'staged artifact must be regular file')
        require(sha(p) == digest, 'staged artifact hash mismatch')
    require(entries['frontend/candidate-index.html'] == overlay['outputs']['html']['sha256'], 'HTML manifest mismatch')
    for key, live in [('html', ADMIN_HTML), ('chunk', ADMIN_PUBLIC/'assets/BusinessWorkbenchPage-DZYOmou-.js'),
                      ('entry', ADMIN_PUBLIC/'assets/index-CG0lkwm6.js'), ('css', ADMIN_PUBLIC/'assets/BusinessWorkbenchPage-DnkGIroY.css')]:
        require(overlay['baseline'][key]['sha256'] == BASE[str(live)], 'overlay baseline mismatch')
    candidate = (release/'frontend/candidate-index.html').read_bytes()
    marker = rb'<!-- ci-management-v1:start -->[\s\S]*?<!-- ci-management-v1:end -->\n'
    pieces = re.findall(marker, candidate)
    require(len(pieces) == 1, 'HTML single additive marker required')
    old = re.sub(marker, b'', candidate)
    require(hashlib.sha256(old).hexdigest() == BASE[str(ADMIN_HTML)], 'HTML non-additive change')
    fragment = pieces[0].decode('utf8')
    maps = re.findall(r'<script type="importmap">([\s\S]*?)</script>', fragment)
    require(len(maps) == 1 and json.loads(maps[0]) == {'imports': {'/assets/BusinessWorkbenchPage-DZYOmou-.js': overlay['outputs']['js']['assetUrl']}}, 'importmap contract')
    require(overlay['outputs']['css']['assetUrl'] in fragment, 'local CSS link missing')
    expected_fragment = '<!-- ci-management-v1:start -->\n<script type="importmap">'+json.dumps({'imports': {'/assets/BusinessWorkbenchPage-DZYOmou-.js': overlay['outputs']['js']['assetUrl']}}, separators=(',', ':'))+'</script>\n<link rel="stylesheet" href="'+overlay['outputs']['css']['assetUrl']+'">\n<!-- ci-management-v1:end -->\n'
    require(fragment == expected_fragment, 'unexpected HTML addition beyond map/local CSS')
    return entries, overlay

def guard(release, state, reloaded=None):
    artifacts(release)
    require(sha(release/'manifest.json') == state['manifestSha256'], 'staged manifest drift')
    for name, digest in state['configHashes'].items():
        config = release/'records'/name
        require(config.is_file() and not config.is_symlink() and stat.S_IMODE(config.stat().st_mode) == 0o600 and sha(config) == digest, 'private runtime config drift')
    for filename, digest in BASE.items():
        expected = state['htmlSha256'] if filename == str(ADMIN_HTML) else digest
        require(sha(filename) == expected, 'protected baseline drift: '+Path(filename).name)
    for dest, source in links(release).items():
        require(dest.is_symlink() and dest.resolve() == source.resolve(), 'runtime link drift')
        frozen = state['runtimeSources'][str(source)]
        require(str(source.resolve()) == frozen['realpath'], 'runtime source target drift')
        if frozen['sha256'] is not None:
            require(sha(source) == frozen['sha256'], 'runtime companion/package drift')
    current = snapshot()
    original = state['original']
    workers = lambda rows: [r for r in rows if r['name'] not in NAMES]
    require(workers(current) == workers(original), 'independent worker identity drift')
    for i, name in enumerate(NAMES):
        rows = [r for r in current if r['name'] == name]
        before = [r for r in original if r['name'] == name]
        if name != reloaded:
            last = [r for r in state['lastProcesses'] if r['name'] == name]
            require(rows == last, 'target process identity drift between steps')
        require(len(rows) == [4, 2][i] and all(r['status'] == 'online' for r in rows), 'target running count')
        require(sorted((r['cwd'], r['exec_mode'], r['envSha256'], r['runtimeSha256']) for r in rows) ==
                sorted((r['cwd'], r['exec_mode'], r['envSha256'], r['runtimeSha256']) for r in before), 'runtime/environment drift')
        require(all(r['script'] == state['scripts'][name] for r in rows), 'target execution path drift')
    return current

def immutable(src, dest, expected):
    if dest.exists() or dest.is_symlink():
        require(dest.is_file() and not dest.is_symlink() and sha(dest) == expected, 'immutable asset conflict')
        return
    fd, temp = tempfile.mkstemp(prefix='.ci-management-', dir=dest.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(src.read_bytes()); f.flush(); os.fsync(f.fileno()); os.fchmod(f.fileno(), 0o644)
        require(sha(temp) == expected, 'asset copy verification')
        try: os.link(temp, dest)  # atomic exclusive publication; never overwrite a hash file
        except FileExistsError:
            require(dest.is_file() and not dest.is_symlink() and sha(dest) == expected, 'immutable concurrent conflict')
    finally:
        if os.path.exists(temp): os.unlink(temp)

def execute(args):
    release = Path(args.release).absolute()
    require(re.fullmatch(r'/opt/releases/[A-Za-z0-9_-]+-ci-management-v1', str(release)) is not None,
            'release must be /opt/releases/<name>-ci-management-v1')
    require(release.is_dir() and not release.is_symlink(), 'staged release directory required')
    records = release/'records'
    # Cross-release exclusion plus this release's lock. Baseline guards still reject
    # unrelated deployers which do not cooperate with this advisory flock.
    with contextlib.ExitStack() as stack:
        for lock in (release.parent/'.channel-inventory-management-v1.lock', release/'.deploy.lock'):
            fd = stack.enter_context(open(lock, 'a'))
            os.chmod(lock, 0o600)
            try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise Stop('another release operation holds flock') from None
        entries, overlay = artifacts(release)
        if args.prepare:
            require(not records.exists(), 'prepare already started; inspect records privately before retry')
            for p, digest in BASE.items(): require(sha(p) == digest, 'baseline drift before prepare: '+Path(p).name)
            before = snapshot()
            records.mkdir(mode=0o700)
            for dest, source in links(release).items():
                require(source.exists(), 'missing existing runtime companion')
                dest.parent.mkdir(parents=True, exist_ok=True)
                if dest.exists() or dest.is_symlink():
                    require(dest.is_symlink() and dest.resolve() == source.resolve(), 'runtime link conflict')
                else: dest.symlink_to(source, target_is_directory=source.is_dir())
            run(['node', str(HELPER), '--apply', '--release', str(release)], 'runtime config generation')
            original = json.loads((records/'processes-original.json').read_text())
            require(original == before, 'PM2 drift during preparation')
            state = {'manifestSha256': sha(release/'manifest.json'), 'original': original,
                     'htmlSha256': BASE[str(ADMIN_HTML)], 'scripts': {n: str(OLD/s/'dist/index.js') for n,s in zip(NAMES, ('front','admin'))},
                     'migrated': False, 'uiExposed': False, 'lastProcesses': original,
                     'runtimeSources': {str(source): {'realpath': str(source.resolve()), 'sha256': sha(source) if source.is_file() else None} for source in links(release).values()},
                     'configHashes': {name: sha(records/name) for name in ('runtime-new.config.cjs', 'runtime-rollback.config.cjs')}}
            private_json(records/'state.json', state)
            guard(release, state); health()
            print('Prepared links/configs; no database connected or process reloaded.'); return
        require(records.is_dir() and not records.is_symlink() and stat.S_IMODE(records.stat().st_mode) == 0o700, 'private records missing')
        state = json.loads((records/'state.json').read_text())
        guard(release, state)
        if args.migrate:
            require(not state['uiExposed'], 'migration must precede UI exposure')
            meta = ECOSYSTEM.lstat()
            require(stat.S_ISREG(meta.st_mode) and stat.S_IMODE(meta.st_mode) == 0o600 and meta.st_uid == os.geteuid(), 'ecosystem must be owned 0600 regular file')
            run(['node', str(release/'front/scripts/apply-channel-inventory-management-schema.mjs'), '--apply',
                 '--from-ecosystem-config', str(ECOSYSTEM), '--expected-database', 'dianzi51'], 'explicit sidecar migration', 240)
            state['migrated'] = True
            private_json(records/'migration.json', {'verifiedAt': int(time.time()), 'database': 'dianzi51',
                         'tables': TABLES, 'backfill': False, 'physicalDeletion': False})
            private_json(records/'state.json', state)
            guard(release, state); print('Four additive sidecars verified; no inventory backfill/deletion.'); return
        if args.activate:
            require(state['migrated'], 'explicit successful migration required')
            require(not state['uiExposed'], 'UI already exposed; do not reactivate')
            config = records/'runtime-new.config.cjs'
            require(config.is_file() and not config.is_symlink() and stat.S_IMODE(config.stat().st_mode) == 0o600, 'private new config contract')
            for name, side in zip(NAMES, ('front', 'admin')):
                guard(release, state)
                new_script = str(release/side/'dist/index.js')
                if state['scripts'][name] != new_script:
                    private_json(records/('before-'+name+'.json'), snapshot())
                    run(['node', str(RELOAD_HELPER), '--apply', '--release', str(release), '--name', name], 'targeted '+name+' entry reload', 240)
                    # Journal successful command before readiness checks; never auto-roll
                    # back a newer backend if readiness or the next boundary fails.
                    state['scripts'][name] = new_script
                    private_json(records/'state.json', state)
                    state['lastProcesses'] = guard(release, state, reloaded=name)
                    private_json(records/'state.json', state)
                guard(release, state); health()
                private_json(records/('after-'+name+'.json'), snapshot())
            for kind in ('js', 'css'):
                guard(release, state)
                out = overlay['outputs'][kind]; basename = Path(out['path']).name
                immutable(release/'frontend'/basename, ADMIN_PUBLIC/'assets'/basename, out['sha256'])
            guard(release, state); health()
            old_html = ADMIN_HTML.read_bytes()
            require(hashlib.sha256(old_html).hexdigest() == BASE[str(ADMIN_HTML)], 'HTML drift before backup')
            backup = records/'old-admin-index.html'
            require(not backup.exists(), 'existing HTML backup conflict')
            with open(backup, 'xb') as f:
                os.chmod(backup, 0o600); f.write(old_html); f.flush(); os.fsync(f.fileno())
            guard(release, state)
            candidate = (release/'frontend/candidate-index.html').read_bytes()
            # Persist exposure intent first: crash recovery can only revert UI, never
            # assume that old backends are safe after management was reachable.
            state['uiExposed'] = True
            state['htmlSha256'] = overlay['outputs']['html']['sha256']
            private_json(records/'state.json', state)
            atomic(ADMIN_HTML, candidate)
            guard(release, state); health()
            if args.pm2_save:
                guard(release, state); run(['pm2', 'save'], 'PM2 save'); guard(release, state)
            private_json(records/'activated.json', {'at': int(time.time()), 'processes': snapshot(), 'http200': True})
            print('Main, admin, then additive UI activated. Existing assets/Nginx/workers protected.'); return
        if args.rollback:
            require(not args.backend_rollback, 'old backend rollback prohibited: tombstones/management requests may expose inventory')
            backup = records/'old-admin-index.html'
            require(backup.is_file() and not backup.is_symlink() and sha(backup) == BASE[str(ADMIN_HTML)], 'verified HTML backup required')
            require(state['uiExposed'], 'no UI exposure recorded')
            atomic(ADMIN_HTML, backup.read_bytes())
            state['htmlSha256'] = BASE[str(ADMIN_HTML)]
            state['uiWithdrawn'] = True
            private_json(records/'state.json', state)
            guard(release, state); health()
            print('Only UI withdrawn. New backends and sidecars retained; no tables/data/assets deleted.'); return

def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--release')
    p.add_argument('--apply', action='store_true')
    phases = p.add_mutually_exclusive_group()
    for phase in ('prepare', 'migrate', 'activate', 'rollback'):
        phases.add_argument('--'+phase, action='store_true')
    p.add_argument('--pm2-save', action='store_true', help='save targeted new entry state after successful activation')
    p.add_argument('--backend-rollback', action='store_true', help='deliberately refused; separate audited database evidence is needed')
    args = p.parse_args()
    selected = any(getattr(args, v) for v in ('prepare','migrate','activate','rollback'))
    if not args.apply:
        print('Plan only: --apply --release /opt/releases/<name>-ci-management-v1 plus one phase required. No side effects.')
        return
    require(selected and args.release, 'explicit release and one phase required')
    require(not args.backend_rollback, 'backend rollback unsupported; retain tombstone-aware backend')
    require(not args.pm2_save or args.activate, '--pm2-save only with activate')
    execute(args)

if __name__ == '__main__':
    try: main()
    except Stop as e:
        print('STOP: '+str(e), file=sys.stderr); sys.exit(1)
    except Exception:
        print('STOP: operation failed; details suppressed to protect secrets. Inspect private records/state, do not auto-revert backends.', file=sys.stderr)
        sys.exit(1)
