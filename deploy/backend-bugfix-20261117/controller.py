#!/usr/bin/env python3
"""Narrow, reviewed hotfix controller. No SQL, grant, environment or worker changes."""
from pathlib import Path
import argparse
import fcntl
import hashlib
import json
import os
import subprocess
import time

SCOPE = 'backend-bugfix-20261117'
LOCKS = ['/var/lock/dianzi51-public-deploy.lock', '/var/lock/dianzi51-production-code.lock']
API_NAMES = {'dianzi51', 'dianzi51-admin'}

def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)

def H(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def canonical(x):
    return json.dumps(x, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()

def run(args, timeout=90):
    return subprocess.check_output(args, stderr=subprocess.PIPE, timeout=timeout)

def save(p, x, exclusive=False):
    p = Path(p)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC), 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(canonical(x) + b'\n'); f.flush(); os.fsync(f.fileno())
    fd = os.open(p.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def atomic(src, target):
    target = Path(target)
    require(not target.is_symlink(), 'SYMLINK_TARGET')
    tmp = target.with_name(target.name + '.backend-bugfix-20261117-next')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    with os.fdopen(fd, 'wb') as f:
        f.write(Path(src).read_bytes()); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, target)
    fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def processes():
    out = []
    for x in json.loads(run(['pm2', 'jlist'])):
        e, pid = x['pm2_env'], x['pid']
        out.append(dict(id=x['pm_id'], name=x['name'], pid=pid, status=e['status'],
            script=e['pm_exec_path'], cwd=e['pm_cwd'],
            rawEnvSha=hashlib.sha256((Path('/proc') / str(pid) / 'environ').read_bytes()).hexdigest(),
            configuredEnvSha=hashlib.sha256(canonical(e.get('env', {}))).hexdigest()))
    return sorted(out, key=lambda x: x['id'])

def http(host, url='/'):
    require(host in {'51dianzi.com', 'admin.51dianzi.com'}, 'HOST_SCOPE')
    return run(['curl', '-fsS', '--compressed', '--max-time', '20', '--resolve',
        host + ':443:127.0.0.1', 'https://' + host + url], 25)

class Controller:
    def __init__(self, root):
        self.R = Path(root).resolve()
        self.M = json.loads((self.R / 'manifest.json').read_text())
        self.B = json.loads((self.R / 'protection.json').read_text())

    def staged(self, relative):
        p = self.R / relative
        require(not Path(relative).is_absolute() and '..' not in Path(relative).parts and not p.is_symlink()
            and p.resolve().is_relative_to(self.R), 'STAGED_PATH_SCOPE')
        return p

    def validate(self, audit=False):
        m = self.M
        require(m['scope'] == SCOPE and m['noBusinessDml'] and m['noDDL'] and m['noGrantEdits'], 'SCOPE')
        require(set(m['reloadNames']) <= API_NAMES and len(m['reloadNames']) == len(set(m['reloadNames'])), 'RELOAD_SCOPE')
        require(H(self.R / 'controller.py') == m['controllerSha256'], 'CONTROLLER_HASH')
        require(H(self.R / 'protection.json') == m['protectionSha256'], 'PROTECTION_HASH')
        replace, add = m['replace'], m['add']
        require(len([f for f in replace if f['kind'] == 'html']) == 1, 'ONE_ADMIN_HTML_REQUIRED')
        require(1 <= len([f for f in replace if f['kind'] == 'api']) <= 2, 'API_COUNT')
        require({f['processName'] for f in replace if f['kind'] == 'api'} == set(m['reloadNames']), 'API_RELOAD_BINDING')
        require(len({f['target'] for f in replace + add}) == len(replace + add), 'DUPLICATE_TARGET')
        for f in replace + add:
            p = Path(f['target'])
            require(p.is_absolute() and '..' not in p.parts and not p.is_symlink()
                and str(p).startswith('/opt/releases/'), 'TARGET_PATH_SCOPE')
            if f in replace:
                require(str(p) in self.B['files'] and self.B['files'][str(p)] == f['beforeSha256'], 'CAS_BINDING')
                require((f['kind'] == 'api' and str(p).endswith('/dist/index.js'))
                    or (f['kind'] == 'html' and str(p) == m['adminHtmlTarget']), 'REPLACE_SCOPE')
                if f['kind'] == 'api':
                    rows = [x for x in self.B['processes'] if x['name'] == f['processName']]
                    require(rows and all(x['script'] == str(p) for x in rows), 'API_EXECUTABLE_BINDING')
            else:
                require((f['kind'] == 'runtime' and '/runtime/' in str(p)) or
                    (f['kind'] == 'asset' and '/dist/public/assets/' in str(p)), 'ADD_SCOPE')
                require(f['sha256'][:16] in p.name, 'CONTENT_ADDRESS_REQUIRED')
                if p.exists(): require(H(p) == f['sha256'], 'ADDITIVE_COLLISION')
            require(H(self.staged(f['source'])) == f['sha256'], 'STAGED_HASH')
            if p.suffix in {'.js', '.mjs'}:
                r = subprocess.run(['node', '--input-type=module', '--check'],
                    input=self.staged(f['source']).read_bytes(), capture_output=True)
                require(r.returncode == 0, 'CANDIDATE_SYNTAX')
        for f in m['evidence']:
            require(H(self.staged(f['source'])) == f['sha256'], 'EVIDENCE_HASH')
        for f in m['frozenSources']:
            require(H(self.staged(f['source'])) == f['sha256'], 'SOURCE_HASH')
        require(len(self.B['processes']) == 12 and len({x['id'] for x in self.B['processes']}) == 12, 'PROCESS_BASELINE')
        require({'/root/.pm2/dump.pm2', '/etc/nginx/nginx.conf', '/opt/config/dianzi51/runtime.env',
            '/opt/config/dianzi51-admin/runtime.env'} <= set(self.B['files']), 'INFRASTRUCTURE_PROTECTION_REQUIRED')
        require(self.B['workersProtected'] and self.B['environmentProtected'], 'WORKER_ENV_PROTECTION_REQUIRED')
        if audit:
            r = json.loads((self.R / 'review.json').read_text())
            require(r['status'] == 'passed' and r['independent'] is True
                and r['manifestSha256'] == H(self.R / 'manifest.json')
                and r['controllerSha256'] == H(self.R / 'controller.py')
                and r['protectionSha256'] == H(self.R / 'protection.json'), 'INDEPENDENT_REVIEW_REQUIRED')

    def check(self, after=False):
        allowed = {f['target']: f['sha256'] for f in self.M['replace']} if after else {}
        for p, h in self.B['files'].items(): require(H(p) == allowed.get(p, h), 'PROTECTED_HASH_DRIFT')
        now = processes()
        require(len(now) == 12 and all(x['status'] == 'online' for x in now), 'PROCESS_HEALTH')
        for old, new in zip(self.B['processes'], now):
            if after and old['name'] in self.M['reloadNames']:
                require(all(old[k] == new[k] for k in ['id', 'name', 'status', 'script', 'cwd', 'configuredEnvSha']), 'RELOAD_IDENTITY_ENV_DRIFT')
            else: require(old == new, 'UNRELATED_PROCESS_DRIFT')

    def health(self):
        for host in ['51dianzi.com', 'admin.51dianzi.com']: require(bool(http(host)), 'HEALTH')
        auth = json.loads(http('admin.51dianzi.com', '/api/trpc/auth.me'))
        require(isinstance(auth, dict) and 'result' in auth, 'ADMIN_RPC_HEALTH')
        raw = run(['curl', '-sS', '--compressed', '--max-time', '20', '--resolve',
            '51dianzi.com:443:127.0.0.1', '-w', '\n%{http_code}',
            'https://51dianzi.com/api/trpc/auth.me'], 25)
        body, status = raw.rsplit(b'\n', 1)
        require(status == b'403' and json.loads(body).get('error') == 'Forbidden', 'FRONT_EXISTING_RPC_GATE')

    def verify_served(self):
        for f in self.M['add']: require(H(f['target']) == f['sha256'], 'ADDITIVE_HASH')
        for f in self.M['replace']:
            if f['kind'] == 'html': require(hashlib.sha256(http('admin.51dianzi.com')).hexdigest() == f['sha256'], 'SERVED_HTML')
        for x in self.M['publicAssets']:
            require(hashlib.sha256(http('admin.51dianzi.com', x['url'])).hexdigest() == x['sha256'], 'SERVED_ASSET')

    def apply(self, allow):
        require(allow, 'EXPLICIT_APPLY_FLAG')
        marker = self.R / 'apply-attempt.json'
        save(marker, {'status': 'started', 'at': time.time()}, exclusive=True)
        changed, reload_started, backups = [], False, self.R / 'backup'
        try:
            self.validate(audit=True)
            p = json.loads((self.R / 'preflight-result.json').read_text())
            require(p['status'] == 'preflight-passed' and p['manifestSha256'] == H(self.R / 'manifest.json'), 'PREFLIGHT_BINDING')
            self.check(); self.health()
            backups.mkdir(mode=0o700, exist_ok=False)
            for i, f in enumerate(self.M['replace']):
                dest = backups / str(i); atomic(f['target'], dest); dest.chmod(0o600)
            for f in self.M['add']:
                dest = Path(f['target'])
                require(dest.parent.exists(), 'ADD_PARENT_MISSING')
                if not dest.exists(): atomic(self.staged(f['source']), dest)
                require(H(dest) == f['sha256'], 'ADDITIVE_HASH')
            for f in self.M['replace']:
                if f['kind'] != 'api': continue
                require(H(f['target']) == f['beforeSha256'], 'API_CAS')
                atomic(self.staged(f['source']), f['target']); changed.append(f)
            reload_started = True
            for name in self.M['reloadNames']: run(['pm2', 'reload', name], 150)
            self.health()
            for f in self.M['replace']:
                if f['kind'] != 'html': continue
                require(H(f['target']) == f['beforeSha256'], 'HTML_CAS')
                atomic(self.staged(f['source']), f['target']); changed.append(f)
            self.check(after=True); self.verify_served()
            result = {'status': 'applied', 'at': time.time(), 'processCount': 12,
                'reloadNames': self.M['reloadNames'], 'noBusinessDml': True, 'noDDL': True,
                'workersEnvironmentNginxDumpUnchanged': True}
            save(self.R / 'apply-result.json', result); save(marker, {'status': 'succeeded', 'at': time.time()})
            return result
        except Exception:
            restored, foreign, errors = [], [], []
            for f in reversed(changed):
                try:
                    if H(f['target']) == f['sha256']:
                        atomic(backups / str(self.M['replace'].index(f)), f['target']); restored.append(f['target'])
                    else: foreign.append(f['target'])
                except Exception: errors.append(f['target'])
            reload_ok = not reload_started
            if reload_started and not foreign and not errors:
                reload_ok = True
                for name in self.M['reloadNames']:
                    try: run(['pm2', 'reload', name], 150)
                    except Exception: reload_ok = False
                try: self.health()
                except Exception: reload_ok = False
            result = {'status': 'failed', 'ownFilesRestored': restored, 'foreignFilesNotTouched': foreign,
                'rollbackFileFailures': errors, 'rollbackReloadHealthy': reload_ok, 'retryForbidden': True,
                'additiveFilesPreserved': True, 'noBusinessDml': True}
            save(self.R / 'apply-result.json', result); save(marker, {'status': 'failed', 'retryForbidden': True})
            raise RuntimeError('FAILED_CLOSED_NO_RETRY') from None

def main():
    p = argparse.ArgumentParser(); p.add_argument('mode', choices=['preflight', 'apply', 'verify'])
    p.add_argument('--root', required=True); p.add_argument('--allow-reviewed-apply', action='store_true'); a = p.parse_args()
    locks = []
    try:
        for name in LOCKS:
            f = open(name, 'a'); fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(f)
        c = Controller(a.root)
        if a.mode == 'apply': result = c.apply(a.allow_reviewed_apply)
        else:
            c.validate(audit=a.mode == 'verify'); c.check(after=a.mode == 'verify'); c.health()
            if a.mode == 'verify': c.verify_served()
            result = {'status': 'preflight-passed' if a.mode == 'preflight' else 'verified',
                'manifestSha256': H(c.R / 'manifest.json'), 'protectionSha256': H(c.R / 'protection.json'),
                'processCount': 12, 'noLiveWrites': True}
            save(c.R / (a.mode + '-result.json'), result)
        print(json.dumps(result, ensure_ascii=False))
    finally:
        for f in reversed(locks): f.close()

if __name__ == '__main__':
    try: main()
    except Exception:
        print(json.dumps({'status': 'failed-closed', 'detailsSuppressed': True})); raise SystemExit(1)
