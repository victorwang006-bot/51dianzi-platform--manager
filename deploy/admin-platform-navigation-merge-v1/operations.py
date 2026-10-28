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


def assert_asset_absent(path):
    assert not path.exists() and not path.is_symlink(), 'Candidate asset already exists'


def validate_manifest_binding(raw, expected):
    assert re.fullmatch(r'[a-f0-9]{64}', expected)
    assert digest(raw) == expected, 'Candidate manifest changed'


def atomic(path, data, mode=0o600, expected=None):
    path = Path(path)
    temp = path.with_name(path.name + '.platform-nav-' + uuid.uuid4().hex + '.next')
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


def snapshot():
    spec = importlib.util.spec_from_file_location('nav_capture', OPS / 'capture-protection.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data = module.snapshot()
    data['roots'] = sorted(set(data['roots']) | {str(HTML.parent)})
    module.record_root_links(HTML.parent, data['links'])
    for path in HTML.parent.rglob('*'):
        if path.is_symlink():
            data['links'][str(path)] = str(path.readlink())
        elif path.is_file():
            data['files'][str(path)] = digest(path.read_bytes())
    data['files'] = dict(sorted(data['files'].items()))
    data['fileCount'] = len(data['files'])
    script = 'import{inspectOriginalPermit}from ' + json.dumps('file://' + INSPECTOR) + ';const g=await inspectOriginalPermit();console.log(JSON.stringify({allowed:g.allowed,path:g.permitPath}));'
    permit = json.loads(subprocess.check_output(['/usr/bin/node-22', '--input-type=module', '-e', script], text=True))
    assert permit['allowed'] and Path(permit['path']).is_file(), 'Worker permit gate refused'
    data['workerPermit'] = {'path':permit['path'], 'sha256':digest(Path(permit['path']).read_bytes())}
    return data


def check_retired():
    for action, expected in [('is-active','inactive'),('is-enabled','disabled')]:
        result = subprocess.run(['systemctl',action,'dianzi51-zhijie-access.service'],capture_output=True,text=True)
        assert result.stdout.strip() == expected, 'Retired sidecar changed'
    assert not re.search(r':3019(?:\s|$)',subprocess.check_output(['ss','-lnt'],text=True))
    for route in ['/zhijie','/api/zhijie']:
        code = subprocess.check_output(['curl','--silent','--show-error','--max-time','12','--resolve','admin.51dianzi.com:443:127.0.0.1','--output','/dev/null','--write-out','%{http_code}','https://admin.51dianzi.com'+route],text=True).strip()
        assert code == '404', 'Retired route changed: '+route


def prepare_html(raw, m):
    assert digest(raw) == m['oldHtmlSha256'], 'Current admin HTML changed'
    text = raw.decode('utf-8')
    maps = list(re.finditer(r'<script\b[^>]*type=["\']importmap["\'][^>]*>(.*?)</script>',text,re.S))
    assert len(maps) == 1
    before = json.loads(maps[0][1])
    assert before['imports'][m['key']] == m['oldTarget']
    assert text.count(m['oldTarget']) == 1 and text.count(m['layout']) == 0
    after = text.replace(m['oldTarget'],m['layout'],1)
    assert after.replace(m['layout'],m['oldTarget'],1) == text
    assert digest(after.encode()) == m['newHtmlSha256']
    result_map = json.loads(re.search(r'<script\b[^>]*type=["\']importmap["\'][^>]*>(.*?)</script>',after,re.S)[1])
    assert result_map == {**before,'imports':{**before['imports'],m['key']:m['layout']}}
    return after.encode()


def validate_payload(m):
    assert m['schema'] == 'admin-platform-navigation-merge-v1' and len(m['files']) == 2
    assert m['key'] == '/assets/51-ordering-information-a40a0c1191ff8253/DashboardLayout-D56MNqM7.js'
    assert m['oldTarget'] == '/assets/DashboardLayout-workbench-navigation-092c0021d3342d8e.js'
    assert m['oldLayoutSha256'] == '092c0021d3342d8eeccf030115a8932ff1d1e9f43e7093346821179f90970ce0'
    assert m['exactHtmlOneLiteral'] is True and m['exactLayoutOneDependencyLiteral'] is True
    assert digest((ASSETS/Path(m['oldTarget']).name).read_bytes()) == m['oldLayoutSha256']
    assert digest((ASSETS/Path(m['oldRuntime']).name).read_bytes()) == m['oldRuntimeSha256']
    assert digest((ASSETS/Path(m['stylesheet']).name).read_bytes()) == m['stylesheetSha256']
    staged = OPS/'staged'
    assert staged.is_dir() and not staged.is_symlink() and staged.stat().st_uid == 0 and staged.stat().st_mode & 0o077 == 0
    assert {p.name for p in staged.iterdir()} == {f['name'] for f in m['files']}, 'Unexpected staged assets'
    for f in m['files']:
        assert re.fullmatch(r'(?:AdminWorkbenchNavigation-platform|DashboardLayout-platform-navigation)-[a-f0-9]{16}\.js',f['name'])
        assert f['sha256'][:16] in f['name']
        source = staged/f['name']
        assert source.is_file() and not source.is_symlink() and source.stat().st_uid == 0 and source.stat().st_mode & 0o077 == 0
        assert digest(source.read_bytes()) == f['sha256']
    layout = (staged/Path(m['layout']).name).read_bytes()
    original = (ASSETS/Path(m['oldTarget']).name).read_bytes()
    old = json.dumps(m['oldRuntime']).encode()
    new = json.dumps(m['runtime']).encode()
    assert original.count(old) == 1 and layout == original.replace(old,new,1), 'Layout beyond dependency changed'


def verify_original(baseline,current,m,after):
    expected = dict(baseline['files'])
    if after:
        expected[str(HTML)] = m['newHtmlSha256']
        expected.update({str(ASSETS/f['name']):f['sha256'] for f in m['files']})
    assert current['files'] == expected, 'Protected file content or set changed'
    assert current['services'] == baseline['services'], 'Business process changed'
    assert current['links'] == baseline['links'] and current['roots'] == baseline['roots'], 'Managed roots or links changed'
    assert current['workerPermit'] == baseline['workerPermit'], 'Worker permit changed'


def rollback_pointer(m):
    current = HTML.read_bytes()
    text = current.decode()
    assert text.count(m['layout']) == 1, 'Unknown current navigation pointer; stop'
    maps = re.findall(r'<script\b[^>]*type=["\']importmap["\'][^>]*>(.*?)</script>',text,re.S)
    assert len(maps) == 1 and json.loads(maps[0])['imports'][m['key']] == m['layout']
    restored = text.replace(m['layout'],m['oldTarget'],1).encode()
    atomic(HTML,restored,0o644,digest(current))
    return digest(restored)


def main(action, expected_manifest):
    assert os.getuid() == 0
    assert not OPS.is_symlink() and OPS.stat().st_uid == 0 and OPS.stat().st_mode & 0o077 == 0
    with open(LOCK,'a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        validate_manifest_binding((OPS/'manifest.json').read_bytes(),expected_manifest)
        m = load(OPS/'manifest.json')
        validate_payload(m)
        check_retired()
        coordination = load(COORD)
        if action == 'capture':
            assert not (OPS/'apply-attempted.json').exists()
            assert not coordination['shared_release_active'], 'Another release window is active'
            baseline = snapshot()
            assert baseline['fileCount'] >= 45000
            candidate = prepare_html(HTML.read_bytes(),m)
            for f in m['files']:
                assert_asset_absent(ASSETS/f['name'])
            record('baseline.json',baseline)
            atomic(OPS/'index-before.html',HTML.read_bytes())
            atomic(OPS/'index-candidate.html',candidate)
            record('preflight.json',{'passed':True,'manifestSha256':expected_manifest,'protectedFiles':baseline['fileCount'],'htmlBefore':m['oldHtmlSha256'],'htmlAfter':m['newHtmlSha256'],'databaseWrites':0,'serviceReloads':0})
            print('Preflight passed; managed files/services unchanged')
            return
        preflight = load(OPS/'preflight.json')
        assert preflight['passed'] and preflight['manifestSha256'] == expected_manifest
        baseline = load(OPS/'baseline.json')
        if action in ['verify','close']:
            assert load(OPS/'applied.json')['phase'] == 'successful'
            verify_original(baseline,snapshot(),m,True)
            assert HTML.read_bytes() == prepare_html((OPS/'index-before.html').read_bytes(),m)
            if action == 'close':
                public = load(OPS/'public-verification.json')
                assert public['passed'] is True and public['manifestSha256'] == expected_manifest
                window = coordination['window']
                assert window['owner_task'] == TASK and window['ops_dir'] == str(OPS) and window['manifestSha256'] == expected_manifest
                window.update(status='completed',write_permission_revoked=True,completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
                coordination['shared_release_active'] = False
                atomic(COORD,(json.dumps(coordination,ensure_ascii=False,indent=2)+'\n').encode())
                record('closed.json',{'completed':True,'manifestSha256':expected_manifest,'databaseWrites':0,'serviceReloads':0,'protectedFiles':baseline['fileCount'],'onlyOneHtmlLiteral':True})
            print('Protected state verified'+('; release window completed' if action=='close' else ''))
            return
        assert action == 'apply' and not (OPS/'apply-attempted.json').exists(), 'Repeated apply refused'
        assert not coordination['shared_release_active'], 'Another release window is active'
        verify_original(baseline,snapshot(),m,False)
        candidate = prepare_html(HTML.read_bytes(),m)
        coordination.setdefault('window_history',[]).append(coordination.get('window'))
        coordination['shared_release_active'] = True
        coordination['window'] = {'owner_task':TASK,'status':'applying','scope':m['scope'],'ops_dir':str(OPS),'manifestSha256':expected_manifest}
        atomic(COORD,(json.dumps(coordination,ensure_ascii=False,indent=2)+'\n').encode())
        record('apply-attempted.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'manifestSha256':expected_manifest})
        replaced = False
        added = []
        try:
            for f in m['files']:
                target = ASSETS/f['name']
                assert_asset_absent(target)
                atomic(target,(OPS/'staged'/f['name']).read_bytes(),0o644)
                added.append(str(target))
            atomic(HTML,candidate,0o644,m['oldHtmlSha256'])
            replaced = True
            verify_original(baseline,snapshot(),m,True)
            check_retired()
            record('applied.json',{'phase':'successful','completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'manifestSha256':expected_manifest,'htmlBefore':m['oldHtmlSha256'],'htmlAfter':m['newHtmlSha256'],'onlyOneHtmlLiteral':True,'allOriginalFilesProtected':baseline['fileCount'],'allProcessesUnchanged':True,'workerPermitUnchanged':True,'retiredAdminBoundaryPreserved':True,'databaseWrites':0,'serviceReloads':0,'added':added})
            coordination['window'].update(status='applied_pending_public_verification')
            print('Platform navigation merged; no service reload or database writes')
        except Exception as error:
            failure = {'phase':'inspection-required','error':str(error),'added':added,'databaseWrites':0,'serviceReloads':0}
            if replaced:
                try:
                    failure['restoredHtmlSha256'] = rollback_pointer(m)
                    failure['phase'] = 'navigation-pointer-restored-assets-retained'
                except Exception as rollback_error:
                    failure['rollbackError'] = str(rollback_error)
            record('failure.json',failure)
            coordination['window'].update(status=failure['phase'],write_permission_revoked=True)
            coordination['shared_release_active'] = False
            raise
        finally:
            atomic(COORD,(json.dumps(coordination,ensure_ascii=False,indent=2)+'\n').encode())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action',choices=['capture','apply','verify','close'])
    parser.add_argument('--manifest-sha256',required=True)
    args = parser.parse_args()
    main(args.action,args.manifest_sha256)
