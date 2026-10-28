#!/usr/bin/env python3
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import uuid

OPS = Path(__file__).resolve().parent
HTML = Path('/opt/releases/20261018-multi-enterprise-v1/admin/dist/public/index.html')
ASSETS = HTML.parent / 'assets'
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
TASK = 'fiF8fDI9qLrd1eknH81ZzQ'
LOCK = '/var/lock/dianzi51-public-deploy.lock'
INSPECTOR = '/opt/ops/20261028-inventory-clear-dismiss-v1/permit-inspector.mjs'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(Path(path).read_text())


def validate_manifest_binding(raw, expected):
    assert re.fullmatch(r'[a-f0-9]{64}', expected)
    assert digest(raw) == expected, 'Candidate manifest changed'


def atomic(path, data, mode=0o600, expected=None):
    path = Path(path)
    temp = path.with_name(path.name + '.nav-' + uuid.uuid4().hex + '.next')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        if expected is not None:
            assert path.is_file() and not path.is_symlink() and digest(path.read_bytes()) == expected, 'Target drift: ' + str(path)
        os.replace(temp, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if temp.exists():
            temp.unlink()


def record(name, value):
    atomic(OPS / name, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())


def gate():
    script = 'import{inspectOriginalPermit}from ' + json.dumps('file://' + INSPECTOR) + ';const g=await inspectOriginalPermit();console.log(JSON.stringify({allowed:g.allowed,path:g.permitPath}));'
    value = json.loads(subprocess.check_output(['/usr/bin/node-22', '--input-type=module', '-e', script], text=True))
    assert value['allowed'] and Path(value['path']).is_file(), 'Worker permit gate refused'
    return {'path': value['path'], 'sha256': digest(Path(value['path']).read_bytes())}


def snapshot():
    spec = importlib.util.spec_from_file_location('nav_capture', OPS / 'capture-protection.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = module.snapshot()
    # Admin PM2 runs a newer server release than its separately served static
    # release. Protect the actual Nginx static root as well as every runtime root.
    static_root = str(HTML.parent)
    data['roots'] = sorted(set(data['roots']) | {static_root})
    module.record_root_links(HTML.parent, data['links'])
    for path in HTML.parent.rglob('*'):
        if path.is_symlink():
            data['links'][str(path)] = str(path.readlink())
        elif path.is_file():
            data['files'][str(path)] = digest(path.read_bytes())
    data['files'] = dict(sorted(data['files'].items()))
    data['fileCount'] = len(data['files'])
    for match in re.finditer(r'<script\b[^>]*type=["\']importmap["\'][^>]*>(.*?)</script>', HTML.read_text(), re.S):
        data['maps'][str(HTML)] = json.loads(match[1]).get('imports', {})
    data['workerPermit'] = gate()
    return data


def check_retired():
    for action, expected in [('is-active', 'inactive'), ('is-enabled', 'disabled')]:
        result = subprocess.run(['systemctl', action, 'dianzi51-zhijie-access.service'], capture_output=True, text=True)
        assert result.stdout.strip() == expected, 'Retired sidecar changed'
    assert not re.search(r':3019(?:\s|$)', subprocess.check_output(['ss', '-lnt'], text=True))
    for route in ['/zhijie', '/api/zhijie']:
        code = subprocess.check_output(['curl', '--silent', '--show-error', '--max-time', '12', '--resolve', 'admin.51dianzi.com:443:127.0.0.1', '--output', '/dev/null', '--write-out', '%{http_code}', 'https://admin.51dianzi.com' + route], text=True).strip()
        assert code == '404', 'Retired route changed: ' + route


def prepare_html(raw, manifest):
    assert digest(raw) == manifest['oldHtmlSha256'], 'Current admin HTML changed'
    text = raw.decode('utf-8')
    maps = list(re.finditer(r'<script\b[^>]*type=["\']importmap["\'][^>]*>(.*?)</script>', text, re.S))
    assert len(maps) == 1
    before_map = json.loads(maps[0][1])
    assert before_map['imports'][manifest['key']] == manifest['oldTarget']
    assert text.count(manifest['oldTarget']) == 1 and 'data-admin-workbench-navigation' not in text
    after = text.replace(manifest['oldTarget'], manifest['layout'], 1).replace('</head>', manifest['cssTag'] + '\n</head>', 1)
    assert after.replace(manifest['cssTag'] + '\n', '', 1).replace(manifest['layout'], manifest['oldTarget'], 1) == text
    assert digest(after.encode()) == manifest['newHtmlSha256']
    after_maps = list(re.finditer(r'<script\b[^>]*type=["\']importmap["\'][^>]*>(.*?)</script>', after, re.S))
    assert len(after_maps) == 1
    after_map = json.loads(after_maps[0][1])
    assert after_map == {**before_map, 'imports': {**before_map['imports'], manifest['key']: manifest['layout']}}
    return after.encode()


def validate_payload(m):
    assert m['schema'] == 'admin-workbench-navigation-v1' and len(m['files']) == 3
    assert m['key'].endswith('/DashboardLayout-D56MNqM7.js')
    assert m['exactHtmlOnlyOneMapKeyAndOneStyleTag'] is True
    assert digest((ASSETS / Path(m['oldTarget']).name).read_bytes()) == m['oldLayoutSha256']
    assert {p.name for p in (OPS / 'staged').iterdir()} == {f['name'] for f in m['files']}, 'Unexpected staged assets'
    for f in m['files']:
        assert re.fullmatch(r'(?:AdminWorkbenchNavigation|DashboardLayout-workbench-navigation)-[a-f0-9]{16}\.(?:js|css)', f['name'])
        assert f['sha256'][:16] in f['name']
        source = OPS / 'staged' / f['name']
        assert source.is_file() and not source.is_symlink() and source.stat().st_uid == 0 and source.stat().st_mode & 0o077 == 0
        assert digest(source.read_bytes()) == f['sha256']
    return True


def verify_original(baseline, current, manifest, after):
    expected = dict(baseline['files'])
    if after:
        expected[str(HTML)] = manifest['newHtmlSha256']
        expected.update({str(ASSETS / f['name']): f['sha256'] for f in manifest['files']})
    assert current['files'] == expected, 'Protected file content or set changed'
    assert current['services'] == baseline['services'], 'A business process changed'
    assert current['links'] == baseline['links'] and current['roots'] == baseline['roots'], 'Managed root or symlink changed'
    assert current['workerPermit'] == baseline['workerPermit'], 'Worker permit changed'


def rollback_pointer(manifest):
    current = HTML.read_bytes()
    text = current.decode('utf-8')
    assert text.count(manifest['layout']) == 1 and text.count(manifest['cssTag']) == 1, 'Unknown current navigation pointer; do not overwrite'
    restored = text.replace(manifest['layout'], manifest['oldTarget'], 1).replace(manifest['cssTag'] + '\n', '', 1).encode()
    atomic(HTML, restored, 0o644, digest(current))
    return digest(restored)


def main(action, expected_manifest):
    assert os.getuid() == 0
    assert OPS.stat().st_uid == 0 and OPS.stat().st_mode & 0o077 == 0
    with open(LOCK, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        validate_manifest_binding((OPS / 'manifest.json').read_bytes(), expected_manifest)
        m = load(OPS / 'manifest.json')
        if action != 'capture':
            preflight = load(OPS / 'preflight.json')
            assert preflight['passed'] is True and preflight['manifestSha256'] == expected_manifest, 'Preflight manifest does not match approved candidate'
        validate_payload(m)
        check_retired()
        if action == 'capture':
            assert not (OPS / 'apply-attempted.json').exists()
            b = snapshot()
            assert b['fileCount'] >= 45000 and b['files'][str(HTML)] == m['oldHtmlSha256']
            assert not load(COORD)['shared_release_active'], 'Another release window is active'
            for f in m['files']:
                assert not (ASSETS / f['name']).exists()
            candidate = prepare_html(HTML.read_bytes(), m)
            atomic(OPS / 'index-before.html', HTML.read_bytes())
            atomic(OPS / 'index-candidate.html', candidate)
            record('baseline.json', b)
            record('preflight.json', {'passed': True, 'protectedFiles': b['fileCount'], 'manifestSha256': digest((OPS / 'manifest.json').read_bytes()), 'htmlBefore': m['oldHtmlSha256'], 'htmlAfter': m['newHtmlSha256'], 'serviceChanges': 0, 'databaseWrites': 0})
            print('Preflight passed; current sidebar, services and data unchanged')
            return
        baseline = load(OPS / 'baseline.json')
        if action == 'verify':
            verify_original(baseline, snapshot(), m, True)
            assert HTML.read_bytes() == prepare_html((OPS / 'index-before.html').read_bytes(), m)
            print('Applied navigation content and protected state verified')
            return
        assert action == 'apply' and not (OPS / 'apply-attempted.json').exists(), 'Unknown action or repeated attempt'
        coordination = load(COORD)
        assert not coordination['shared_release_active'], 'Another release is active'
        verify_original(baseline, snapshot(), m, False)
        before = HTML.read_bytes()
        candidate = prepare_html(before, m)
        coordination.setdefault('window_history', []).append(coordination.get('window'))
        coordination['shared_release_active'] = True
        coordination['window'] = {'owner_task': TASK, 'status': 'applying', 'scope': m['scope'], 'ops_dir': str(OPS), 'manifestSha256': digest((OPS / 'manifest.json').read_bytes())}
        atomic(COORD, (json.dumps(coordination, ensure_ascii=False, indent=2) + '\n').encode())
        record('apply-attempted.json', {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'manifestSha256': digest((OPS / 'manifest.json').read_bytes())})
        replaced = False
        added = []
        try:
            for f in m['files']:
                target = ASSETS / f['name']
                assert not target.exists(), 'Asset appeared during publication'
                atomic(target, (OPS / 'staged' / f['name']).read_bytes(), 0o644)
                added.append(str(target))
            atomic(HTML, candidate, 0o644, m['oldHtmlSha256'])
            replaced = True
            verify_original(baseline, snapshot(), m, True)
            check_retired()
            record('applied.json', {'phase': 'successful', 'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'manifestSha256': digest((OPS / 'manifest.json').read_bytes()), 'htmlBefore': m['oldHtmlSha256'], 'htmlAfter': m['newHtmlSha256'], 'onlyLayoutPointerAndStyleTag': True, 'allOriginalFilesProtected': baseline['fileCount'], 'allProcessesUnchanged': True, 'workerPermitUnchanged': True, 'retiredAdminBoundaryPreserved': True, 'databaseWrites': 0, 'serviceReloads': 0, 'added': added})
            coordination['window'].update(status='applied_pending_public_verification', receipt=str(OPS / 'applied.json'))
            print('Navigation applied; no service reload or database write')
        except Exception as error:
            failure = {'phase': 'inspection-required', 'error': str(error), 'added': added, 'databaseWrites': 0, 'serviceReloads': 0}
            if replaced:
                try:
                    failure['restoredHtmlSha256'] = rollback_pointer(m)
                    failure['phase'] = 'navigation-pointer-restored-assets-retained'
                except Exception as rollback_error:
                    failure['rollbackError'] = str(rollback_error)
            record('failure.json', failure)
            coordination['window'].update(status=failure['phase'], write_permission_revoked=True)
            coordination['shared_release_active'] = False
            raise
        finally:
            atomic(COORD, (json.dumps(coordination, ensure_ascii=False, indent=2) + '\n').encode())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['capture', 'apply', 'verify'])
    parser.add_argument('--manifest-sha256', required=True)
    args = parser.parse_args()
    main(args.action, args.manifest_sha256)
