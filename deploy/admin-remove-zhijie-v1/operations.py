#!/usr/bin/env python3
"""Retire only Zhijie, preserving current unrelated production changes."""
from pathlib import Path
import datetime
import fcntl
import hashlib
import json
import os
import subprocess
import sys
from transform import restore_html, retire_nginx

ROOT = Path('/opt/ops/20261028-admin-remove-zhijie-v1')
ADMIN = Path('/opt/releases/20261018-multi-enterprise-v1/admin/dist/public')
WEB = Path('/opt/releases/20261018-brand-zone-hotfix-v1/web/dist/public')
HTML = ADMIN / 'index.html'
NGINX = Path('/etc/nginx/conf.d/dianzi51-admin-subdomain.conf')
ORIGINAL = Path('/opt/ops/20261027-zhijie-business-v1')
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
UNIT = 'dianzi51-zhijie-access.service'
TASK = 'fiF8fDI9qLrd1eknH81ZzQ'
MUTABLE = {str(HTML), str(NGINX)}
sha = lambda b: hashlib.sha256(b).hexdigest()
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()


def run(argv):
    return subprocess.check_output(argv, text=True, timeout=180).strip()


def state(command):
    return subprocess.run(['systemctl', command, UNIT], capture_output=True, text=True).stdout.strip()


def atomic(path, data, mode=0o600):
    temp = path.with_name(path.name + '.retire-next-' + str(os.getpid()))
    temp.write_bytes(data)
    temp.chmod(mode)
    os.replace(temp, path)


def save(path, value):
    atomic(path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())


def processes():
    rows = json.loads(run(['/usr/bin/node-22', '/usr/local/lib/node_modules/pm2/bin/pm2', 'jlist']))
    return [{
        'id': x['pm_id'], 'name': x['name'], 'pid': x['pid'],
        'status': x['pm2_env']['status'], 'started': x['pm2_env']['pm_uptime'],
        'restarts': x['pm2_env'].get('restart_time'),
        'path': x['pm2_env'].get('pm_exec_path'), 'cwd': x['pm2_env'].get('pm_cwd'),
    } for x in rows]


def capture_files():
    prior = json.loads(Path('/opt/ops/20261027-inventory-compact-layout-v1/baseline.json').read_text())
    names = {Path(name) for name in prior['files']}
    for root in [ADMIN, WEB, Path('/etc/nginx/conf.d')]:
        names.update(p for p in root.rglob('*') if p.is_file() or p.is_symlink())
    names.add(Path('/etc/nginx/nginx.conf'))
    for row in processes():
        if row['path'] and Path(row['path']).is_file():
            names.add(Path(row['path']))
    files, links = {}, {}
    for name in sorted(names):
        if name.is_symlink():
            links[str(name)] = os.readlink(name)
        elif name.is_file():
            files[str(name)] = sha(name.read_bytes())
        else:
            raise AssertionError('protected input disappeared: ' + str(name))
    return files, links


def check_protected(snapshot, allow_mutation=False):
    for name, digest in snapshot['files'].items():
        if allow_mutation and name in MUTABLE:
            continue
        assert Path(name).is_file() and sha(Path(name).read_bytes()) == digest, 'protected file drift: ' + name
    for name, target in snapshot['links'].items():
        assert Path(name).is_symlink() and os.readlink(name) == target, 'protected link drift: ' + name
    assert processes() == snapshot['processes'], 'original PM2 processes changed'


def probe(path):
    output = run(['curl', '-sS', '--max-time', '15', '--resolve', 'admin.51dianzi.com:443:127.0.0.1',
                  '-w', '\n%{http_code}', 'https://admin.51dianzi.com' + path])
    body, code = output.rsplit('\n', 1)
    return body, int(code)


def verify(snapshot, proof):
    assert sha(HTML.read_bytes()) == snapshot['afterHtmlSha256']
    assert sha(NGINX.read_bytes()) == snapshot['afterNginxSha256']
    check_protected(snapshot, allow_mutation=True)
    assert state('is-active') == 'inactive', 'Zhijie service still active'
    assert state('is-enabled') == 'disabled', 'Zhijie service auto-start still enabled'
    for path in ['/zhijie', '/zhijie/team-access', '/zhijie/customers', '/api/zhijie', '/api/zhijie/context']:
        _, code = probe(path)
        assert code == 404, (path, code)
    for path in ['/', '/login', '/merchants', '/users']:
        body, code = probe(path)
        assert code == 200 and '<!doctype html>' in body.lower(), (path, code)
        assert 'src="' + proof['restoredMain'] + '"' in body
        assert 'Admin-main-zhijie-' not in body
    for url, digest in snapshot['originalResources'].items():
        data = subprocess.check_output(['curl', '-fsS', '--max-time', '15', '--resolve',
            'admin.51dianzi.com:443:127.0.0.1', 'https://admin.51dianzi.com' + url], timeout=20)
        assert sha(data) == digest, 'restored resource HTTP drift: ' + url
    archive = json.loads(run(['/usr/bin/node-22', str(ROOT / 'archive-access.cjs'), 'verify']))
    return {'retiredRoutesHttp404': True, 'originalPageEntrypointsHttp200': True,
            'restoredResourceHashesVerified': True, 'allOriginalPM2ProcessesUnchanged': True,
            'protectedFiles': len(snapshot['files']), 'protectedLinks': len(snapshot['links']),
            'tablesRetainedAndUnchanged': archive['tables'], 'databaseWrites': 0,
            'zhijieServiceActive': False, 'zhijieServiceEnabled': False,
            'authenticatedBrowserInteractionTested': False}


def main():
    mode = sys.argv[1]
    assert mode in ['capture', 'apply', 'verify']
    if mode == 'verify':
        result = verify(json.loads((ROOT / 'before.json').read_text()),
                        json.loads((ROOT / 'transform-proof.json').read_text()))
        print(json.dumps(result, ensure_ascii=False))
        return
    with open('/var/lock/dianzi51-public-deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        coord = json.loads(COORD.read_text())
        assert coord['coordinator_task'] == TASK
        if mode == 'capture':
            assert not coord.get('shared_release_active'), 'another release owns window'
            assert not (ROOT / 'before.json').exists(), 'already captured; inspect existing state'
            (ROOT / 'private').mkdir(parents=True, exist_ok=True, mode=0o700)
            ROOT.chmod(0o700)
            original_html = (ORIGINAL / 'before-index.html').read_text()
            manifest = json.loads((ORIGINAL / 'payload/manifest.json').read_text())
            html, proof = restore_html(HTML.read_text(), original_html, manifest)
            nginx = retire_nginx(NGINX.read_text())
            resources = {
                proof['restoredMain']: manifest['oldMainSha256'],
                proof['restoredLayout']: manifest['oldLayoutSha256'],
            }
            for url, digest in resources.items():
                assert sha((ADMIN / url.removeprefix('/')).read_bytes()) == digest
            introduced = {'/assets/' + item['name']: item['sha256'] for item in manifest['files']}
            for url in [proof['oldZhijieMain'], proof['oldZhijieLayout']]:
                assert url in introduced, 'unknown replacement asset; stop rather than overwrite'
                assert sha((ADMIN / url.removeprefix('/')).read_bytes()) == introduced[url]
            assert state('is-active') == 'active' and state('is-enabled') == 'enabled'
            health = json.loads(run(['curl', '-fsS', '--max-time', '3', 'http://127.0.0.1:3019/health']))
            assert health['businessBridge'] == 'disconnected'
            print('Capturing current protected files and processes...', flush=True)
            files, links = capture_files()
            snapshot = {'time': now(), 'files': files, 'links': links, 'processes': processes(),
                'beforeHtmlSha256': sha(HTML.read_bytes()), 'beforeNginxSha256': sha(NGINX.read_bytes()),
                'afterHtmlSha256': sha(html.encode()), 'afterNginxSha256': sha(nginx.encode()),
                'originalResources': resources, 'serviceActive': True, 'serviceEnabled': True}
            atomic(ROOT / 'index-before.html', HTML.read_bytes())
            atomic(ROOT / 'nginx-before.conf', NGINX.read_bytes())
            atomic(ROOT / 'index-after.html', html.encode())
            atomic(ROOT / 'nginx-after.conf', nginx.encode())
            save(ROOT / 'before.json', snapshot)
            save(ROOT / 'transform-proof.json', proof)
            archive = json.loads(run(['/usr/bin/node-22', str(ROOT / 'archive-access.cjs'), 'archive']))
            save(ROOT / 'archive-summary.json', archive)
            coord['window_history'] = coord.get('window_history', []) + [coord['window']]
            coord['shared_release_active'] = True
            coord['window'] = {'owner_task': TASK, 'status': 'granted_pending_receipt',
                'scope': 'approved removal of Zhijie only; restore original admin frontend and stop independent service',
                'ops_dir': str(ROOT), 'databaseWritesAllowed': False, 'originalServicesRestartAllowed': False}
            coord['updated_at'] = now()
            save(COORD, coord)
            print(json.dumps({'captured': True, 'protectedFiles': len(files), 'protectedLinks': len(links),
                'privateTablesArchived': archive['tables'], 'businessBridge': 'disconnected'}))
            return
        assert coord['window']['owner_task'] == TASK and coord['shared_release_active']
        assert coord['window']['ops_dir'] == str(ROOT)
        assert not (ROOT / 'attempt.json').exists(), 'apply attempted; verify/inspect, never blind retry'
        snapshot = json.loads((ROOT / 'before.json').read_text())
        proof = json.loads((ROOT / 'transform-proof.json').read_text())
        check_protected(snapshot)
        for name, digest in {
            'index-before.html': snapshot['beforeHtmlSha256'],
            'nginx-before.conf': snapshot['beforeNginxSha256'],
            'index-after.html': snapshot['afterHtmlSha256'],
            'nginx-after.conf': snapshot['afterNginxSha256'],
        }.items():
            assert sha((ROOT / name).read_bytes()) == digest, 'staged artifact drift: ' + name
        assert state('is-active') == 'active' and state('is-enabled') == 'enabled'
        run(['nginx', '-t'])
        save(ROOT / 'attempt.json', {'startedAt': now(), 'scope': 'no DB writes; only two files and independent service'})
        try:
            atomic(NGINX, (ROOT / 'nginx-after.conf').read_bytes(), 0o644)
            run(['nginx', '-t'])
            atomic(HTML, (ROOT / 'index-after.html').read_bytes(), 0o644)
            run(['systemctl', 'reload', 'nginx'])
            run(['systemctl', 'disable', '--now', UNIT])
            result = verify(snapshot, proof)
            result.update(successful=True, completedAt=now(), htmlSha256=snapshot['afterHtmlSha256'],
                          nginxSha256=snapshot['afterNginxSha256'], originalWorktableDataUntouched=True,
                          retiredService=UNIT, oldReleasesRetainedUnreferenced=True)
            save(ROOT / 'applied.json', result)
            coord = json.loads(COORD.read_text())
            assert coord['window']['owner_task'] == TASK
            coord['shared_release_active'] = False
            coord['window'].update(status='completed_and_verified', write_permission_revoked=True,
                                   receipt=str(ROOT / 'applied.json'))
            coord['release_hold'] = {'status': 'Zhijie removed as user approved; no further changes authorized',
                                    'admin_rollback_permission': False}
            coord['updated_at'] = now()
            save(COORD, coord)
            print(json.dumps(result, ensure_ascii=False))
        except Exception as error:
            save(ROOT / 'failed.json', {'error': str(error), 'time': now(), 'databaseWrites': 0})
            assert sha(HTML.read_bytes()) in [snapshot['beforeHtmlSha256'], snapshot['afterHtmlSha256']], 'HTML concurrent drift: do not overwrite'
            assert sha(NGINX.read_bytes()) in [snapshot['beforeNginxSha256'], snapshot['afterNginxSha256']], 'Nginx concurrent drift: do not overwrite'
            assert sha((ROOT / 'index-before.html').read_bytes()) == snapshot['beforeHtmlSha256']
            assert sha((ROOT / 'nginx-before.conf').read_bytes()) == snapshot['beforeNginxSha256']
            atomic(HTML, (ROOT / 'index-before.html').read_bytes(), 0o644)
            atomic(NGINX, (ROOT / 'nginx-before.conf').read_bytes(), 0o644)
            run(['nginx', '-t'])
            run(['systemctl', 'reload', 'nginx'])
            # Do not resurrect the retired service or override another operator's systemd decision.
            check_protected(snapshot)
            save(ROOT / 'failed-rollback.json', {'onlyOwnChangesRestored': True, 'time': now(), 'databaseWrites': 0})
            coord['shared_release_active'] = False
            coord['window'].update(status='failed_and_own_changes_restored', write_permission_revoked=True)
            save(COORD, coord)
            raise


if __name__ == '__main__':
    main()
