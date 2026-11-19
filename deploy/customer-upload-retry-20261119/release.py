#!/usr/bin/env python3
"""One-shot, SHA-bound customer-upload release. No network, SQL or configuration writes."""
import argparse, contextlib, datetime, fcntl, hashlib, json, os, re, stat, subprocess, time, uuid
from pathlib import Path

OWNER = 'lRq82a3bSHrvLgTrLggfSY'
SCOPE = 'customer-upload-retry-20261119'
RELEASES = Path('/opt/releases')
FRONT = Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js')
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
OPS = Path('/opt/ops/customer-upload-retry-20261119-' + OWNER)
LOCKS = ['/var/lock/dianzi51-public-deploy.lock', '/var/lock/dianzi51-production-code.lock']
INFRA = {'/root/.pm2/dump.pm2', '/etc/nginx/nginx.conf', '/opt/config/dianzi51/runtime.env', '/opt/config/dianzi51-admin/runtime.env'}
KINDS = {'check-zip-flag', 'appendFile-guard'}

def need(ok, reason):
    if not ok: raise RuntimeError(reason)
def sha(b): return hashlib.sha256(b).hexdigest()
def encode(x): return (json.dumps(x, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode()
def loads(data):
    def unique(pairs):
        out = {}
        for k, v in pairs:
            need(k not in out, 'DUPLICATE_JSON_FIELD'); out[k] = v
        return out
    return json.loads(data, object_pairs_hook=unique)
def stamp(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def safe(p):
    p = Path(p); need(p.is_absolute() and '..' not in p.parts and p.resolve() == p, 'PATH_SYMLINK_OR_SCOPE'); return p

def read(p):
    p = safe(p); need(stat.S_ISREG(p.stat().st_mode), 'NOT_REGULAR_FILE')
    fd = os.open(p, os.O_RDONLY | os.O_NOATIME | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        a = os.fstat(f.fileno()); need(stat.S_ISREG(a.st_mode), 'NOT_REGULAR_FILE'); data = f.read(); b = os.fstat(f.fileno())
    need((a.st_dev, a.st_ino, a.st_size, a.st_mtime_ns, a.st_ctime_ns) == (b.st_dev, b.st_ino, b.st_size, b.st_mtime_ns, b.st_ctime_ns), 'READ_METADATA_DRIFT')
    need(p.stat().st_ino == a.st_ino, 'READ_PATH_DRIFT'); return data

def H(p): return sha(read(p))
def exclusive(p, data, mode=0o600):
    p = safe(p); fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as f: os.fchmod(f.fileno(), mode); f.write(data); f.flush(); os.fsync(f.fileno())
    syncdir(p.parent)
def syncdir(p):
    fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOATIME)
    try: os.fsync(fd)
    finally: os.close(fd)
def cas(p, before, after):
    p = safe(p); need(read(p) == before, 'FULL_BYTES_CAS_DRIFT'); info = p.stat(); tmp = p.parent / ('.upload-' + uuid.uuid4().hex)
    try:
        exclusive(tmp, after, stat.S_IMODE(info.st_mode)); os.chown(tmp, info.st_uid, info.st_gid); os.chmod(tmp, stat.S_IMODE(info.st_mode))
        need(read(p) == before, 'LAST_MOMENT_CAS_DRIFT'); os.replace(tmp, p); syncdir(p.parent)
    finally:
        if tmp.exists(): tmp.unlink()

def pm2_existing():
    need(os.environ.get('PM2_HOME', '/root/.pm2') == '/root/.pm2', 'PM2_HOME_DRIFT')
    pid = int(read(Path('/root/.pm2/pm2.pid')).strip()); need(pid > 1, 'PM2_DAEMON_REQUIRED'); os.kill(pid, 0)
    need(b'PM2' in read(Path('/proc') / str(pid) / 'cmdline'), 'PM2_DAEMON_IDENTITY')
    socket = Path('/root/.pm2/rpc.sock'); need(socket.is_socket() and not socket.is_symlink(), 'PM2_EXISTING_RPC_REQUIRED')
def run(args, data=None):
    if args[0] == 'pm2': pm2_existing()
    r = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=150)
    need(r.returncode == 0, 'SUBPROCESS_FAILED'); return r.stdout

def processes():
    rows = []
    for p in json.loads(run(['pm2', 'jlist'])):
        e = p['pm2_env']; need(p['pid'] > 0, 'PROCESS_PID_UNHEALTHY')
        rows.append(dict(id=p['pm_id'], pid=p['pid'], name=p['name'], status=e['status'], script=e['pm_exec_path'], cwd=e['pm_cwd'],
                         rawEnvSha=H(Path('/proc') / str(p['pid']) / 'environ'), configuredEnvSha=sha(encode(e.get('env', {})))))
    return sorted(rows, key=lambda p: p['id'])

def inventory(root):
    out = {}
    def walk(d):
        fd = os.open(safe(d), os.O_RDONLY | os.O_DIRECTORY | os.O_NOATIME | os.O_NOFOLLOW)
        try:
            with os.scandir(fd) as it: entries = list(it)
            for e in entries:
                p = d / e.name; need(not e.is_symlink(), 'ASSET_SYMLINK')
                if e.is_dir(follow_symlinks=False): walk(p)
                else: out[str(p.relative_to(root))] = H(p)
        finally: os.close(fd)
    walk(root); return out

@contextlib.contextmanager
def locks():
    handles = []
    try:
        for name in LOCKS:
            fd = os.open(name, os.O_RDWR | os.O_NOFOLLOW); handles.append(fd)  # /var/lock itself may be /run/lock
            need(stat.S_ISREG(os.fstat(fd).st_mode), 'LOCK_NOT_REGULAR')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        for fd in reversed(handles): os.close(fd)

class Release:
    def __init__(self, package, pins):
        self.root = safe(package); self.pins = pins
        self.mb = read(self.root / 'manifest.json'); self.rb = read(self.root / 'review.json')
        need(sha(self.mb) == pins['manifest'] and sha(self.rb) == pins['review'], 'STAGE_PIN_DRIFT')
        self.m = loads(self.mb); self.review = loads(self.rb)
        self.bb = self.staged(self.m['baseline']); need(sha(self.bb) == pins['baseline'], 'BASELINE_PIN_DRIFT')
        self.b = loads(self.bb); self.proof = self.staged(self.m['backend2Verified'])
        self.mutations = []; self.assets = []; self.owned = None; self.reloaded = False
        self.receipt_bytes = None
    def staged(self, row):
        rel = Path(row['source']); need(not rel.is_absolute() and '..' not in rel.parts, 'STAGED_PATH_SCOPE')
        data = read(self.root / rel); need(sha(data) == row['sha256'], 'STAGED_HASH_DRIFT'); return data
    def validate(self):
        m, b, r = self.m, self.b, self.review
        self.mutations = []; self.assets = []
        need(m['schemaVersion'] == 1 and m['ownerTask'] == OWNER and m['scope'] == SCOPE, 'EXACT_SCOPE')
        need(m['driverSha256'] == H(Path(__file__).resolve()), 'DRIVER_PIN_DRIFT')
        need(r['status'] == 'passed' and r['independent'] is True and isinstance(r['reviewerTask'], str) and r['reviewerTask'] and r['reviewerTask'] != OWNER
             and r['manifestSha256'] == sha(self.mb) and r['driverSha256'] == m['driverSha256']
             and r['baselineSha256'] == sha(self.bb) and r['backend2VerifiedSha256'] == sha(self.proof)
             and len(r['frontNodesVerified']) == 2 and set(r['frontNodesVerified']) == KINDS, 'INDEPENDENT_REVIEW_REQUIRED')
        front_public = safe(b['frontPublic']); need(front_public.is_relative_to(RELEASES) and front_public.is_dir(), 'REAL_FRONT_PUBLIC_REQUIRED')
        front_html = front_public / 'index.html'
        proof = loads(self.proof); need(proof['status'] == 'verified' and isinstance(proof['ownerTask'], str) and proof['ownerTask']
             and proof['ownerTask'] == m['backend2Verified']['ownerTask'] != OWNER
             and proof['frontHtmlSha256'] == b['files'][str(front_html)], 'BACKEND2_NOT_VERIFIED')
        need(b['coordSha256'] == self.pins['coord'], 'COORD_PIN_BINDING')
        public = safe(b['adminPublic']); need(public.is_relative_to(RELEASES) and not public.is_relative_to(FRONT.parent)
             and not FRONT.parent.is_relative_to(public), 'REAL_ADMIN_PUBLIC_REQUIRED')
        need(not public.is_relative_to(front_public) and not front_public.is_relative_to(public), 'PUBLIC_SCOPE_OVERLAP')
        self.public = public; rows = m['replace']; need(len(rows) == 2 and {x['kind'] for x in rows} == {'front-api', 'admin-html'}, 'REPLACE_SCOPE')
        need({x['target'] for x in rows} == {str(FRONT), str(public / 'index.html')}, 'SINGLE_FRONT_ADMIN_HTML_ONLY')
        need(all(x['target'] == str(FRONT if x['kind'] == 'front-api' else public / 'index.html') for x in rows), 'TARGET_ROLE_BINDING')
        need(len(m['add']) == 2, 'TWO_ASSETS_REQUIRED')
        for row in rows:
            safe(row['target']); before = self.staged({'source': row['beforeSource'], 'sha256': row['beforeSha256']}); after = self.staged(row)
            need(b['files'][row['target']] == sha(before) and before != after, 'REPLACE_BASELINE_BINDING')
            self.mutations.append((row, before, after))
        api = next(x for x in self.mutations if x[0]['kind'] == 'front-api'); before, expected = api[1], api[1]
        edits = sorted(m['frontEdits'], key=lambda e: e['start']); need(len(edits) == 2 and {e['kind'] for e in edits} == KINDS, 'TWO_FRONT_NODES_ONLY')
        for i, e in enumerate(edits):
            need(0 <= e['start'] < e['end'] <= len(before) and (i == 0 or edits[i-1]['end'] <= e['start']), 'FRONT_NODE_INTERVAL')
            need(sha(before[e['start']:e['end']]) == e['beforeSha256'], 'FRONT_NODE_BEFORE')
            fragment = self.staged(e); need(fragment and fragment != before[e['start']:e['end']], 'FRONT_NODE_NOOP_OR_DELETE')
        for e in reversed(edits): expected = expected[:e['start']] + self.staged(e) + expected[e['end']:]
        need(expected == api[2], 'FRONT_EXTRA_CHANGE')
        for row in m['add']:
            data = self.staged(row); relative = row['relative']
            need(re.fullmatch(r'assets/BusinessWorkbenchPage-[A-Za-z0-9_-]*' + sha(data)[:16] + r'\.js', relative) is not None, 'CONTENT_ADDRESSED_ASSET_SCOPE')
            need(re.fullmatch(r'/assets/BusinessWorkbenchPage-[A-Za-z0-9._-]+\.js', row['oldURL']) is not None, 'OLD_ASSET_URL_SCOPE')
            need(row['oldURL'][1:] in b['assets'], 'OLD_ASSET_NOT_PROTECTED')
            self.assets.append((public / relative, data))
        need(len({str(p) for p, _ in self.assets}) == 2 and len({sha(data) for _, data in self.assets}) == 2
             and len({x['oldURL'] for x in m['add']}) == 2, 'ASSET_UNIQUENESS')
        html = next(x for x in self.mutations if x[0]['kind'] == 'admin-html'); self.check_html(html[1], html[2])
        for row, _, data in self.mutations:
            if row['kind'] == 'front-api': run(['node', '--input-type=module', '--check'], data)
        for _, data in self.assets: run(['node', '--input-type=module', '--check'], data)
        procs = b['processes']; ids = m['reloadPmIds']
        need(len(procs) == 12 and len({x['id'] for x in procs}) == 12 and len(ids) == 4 and len(set(ids)) == 4
             and set(ids) == {x['id'] for x in procs if x['name'] == 'dianzi51'}, 'FOUR_FRESH_EXACT_PM_IDS')
        need(all(type(i) is int and i >= 0 for i in ids) and all(x['script'] == str(FRONT) for x in procs if x['id'] in ids), 'FRONT_PROCESS_BINDING')
        protected = set(b['files']); need(INFRA | {str(front_html)} | {x['script'] for x in procs} <= protected, 'INFRA_FRONT_HTML_WORKER_PROTECTION')
        need(any(x['name'] == 'dianzi51-admin' and '/admin/dist/index.js' in x['script'] for x in procs), 'ADMIN_API_PROTECTION')
        need(all(b['files'].get(str(public / p)) == h for p, h in b['assets'].items()), 'ALL_OLD_ASSET_PROTECTION')
    def check_html(self, before, after):
        text = before.decode(); maps = list(re.finditer(r'<script\b[^>]*\btype=[\"\']importmap[\"\'][^>]*>(.*?)</script\s*>', text, re.S | re.I))
        need(len(maps) == 1, 'ONE_IMPORTMAP_REQUIRED'); hit = maps[0]; raw = hit.group(1); obj = loads(raw)
        changes = {x['oldURL']: '/' + x['relative'] for x in self.m['add']}; counts = {x: 0 for x in changes}
        def replace(match):
            value = json.loads(match.group(2))
            if value not in changes: return match.group(0)
            counts[value] += 1; return match.group(1) + json.dumps(changes[value])
        rewritten = re.sub(r'("(?:\\.|[^"\\])*"\s*:\s*)("(?:\\.|[^"\\])*")', replace, raw)
        desired = loads(raw)
        for table in [desired.get('imports', {}), *desired.get('scopes', {}).values()]:
            need(isinstance(table, dict) and all(isinstance(v, str) for v in table.values()), 'IMPORTMAP_STRING_TABLE')
            for key, value in table.items(): table[key] = changes.get(value, value)
        need(all(counts.values()) and loads(rewritten) == desired and obj != desired, 'IMPORTMAP_VALUES_ONLY')
        clones = []
        for old, new in changes.items():
            need(old in desired['scopes'] and len(desired['scopes'][old]) == 44 and new not in desired['scopes'], 'EXACT_44_SCOPE_CLONE_REQUIRED')
            table = dict(desired['scopes'][old]); desired['scopes'][new] = table
            clones.append(json.dumps(new, ensure_ascii=False) + ':' + json.dumps(table, ensure_ascii=False, separators=(',', ':')))
        decoder = json.JSONDecoder(); pos = rewritten.index('{') + 1; close = None
        while pos < len(rewritten):
            while rewritten[pos].isspace() or rewritten[pos] == ',': pos += 1
            if rewritten[pos] == '}': break
            key, pos = decoder.raw_decode(rewritten, pos); pos = rewritten.index(':', pos) + 1
            while rewritten[pos].isspace(): pos += 1
            _, end = decoder.raw_decode(rewritten, pos)
            if key == 'scopes': close = end - 1; break
            pos = end
        need(close is not None and rewritten[close] == '}', 'EXACT_SCOPES_OBJECT_REQUIRED')
        final = rewritten[:close] + ',' + ','.join(clones) + rewritten[close:]
        need(loads(final) == desired, 'ONLY_TWO_EXACT_SCOPE_CLONES')
        need((text[:hit.start(1)] + final + text[hit.end(1):]).encode() == after, 'HTML_OUTSIDE_VALUES_CHANGED')
    def fresh(self):
        need(0 <= time.time() - self.b['capturedAtUnix'] <= 1800, 'LATEST_BASELINE_REQUIRED')
    def owned_check(self): need(self.owned is not None and read(COORD) == self.owned, 'WINDOW_OWNERSHIP_LOST')
    def check(self, overrides=None, rolling=False, additions=False):
        overrides = overrides or {}
        for p, h in self.b['files'].items(): need(H(p) == overrides.get(p, h), 'PROTECTED_FILE_HASH_DRIFT')
        expected = dict(self.b['assets'])
        if additions:
            for p, data in self.assets:
                if p.exists(): expected[str(p.relative_to(self.public))] = sha(data)
        need(inventory(self.public / 'assets') == {k.removeprefix('assets/'): v for k, v in expected.items()}, 'FULL_OLD_ASSET_INVENTORY_DRIFT')
        current = processes(); old = sorted(self.b['processes'], key=lambda x: x['id'])
        need(len(current) == 12 and len({x['id'] for x in current}) == 12, 'PROCESS_COUNT_DRIFT')
        for a, c in zip(old, current):
            need(c['status'] == 'online' and c['pid'] > 0, 'PROCESS_HEALTH')
            need(a == c if not rolling or a['id'] not in self.m['reloadPmIds'] else {k:v for k,v in a.items() if k != 'pid'} == {k:v for k,v in c.items() if k != 'pid'}, 'PROCESS_IDENTITY_ENV_DRIFT')
    def roll(self, overrides):
        for i in self.m['reloadPmIds']:
            self.owned_check(); self.check(overrides, rolling=True, additions=True)
            self.reloaded = True; run(['pm2', 'reload', str(i)])
            self.owned_check(); self.check(overrides, rolling=True, additions=True)
    def readonly(self, mode):
        self.validate()
        if mode == 'preflight':
            self.fresh(); raw = read(COORD); need(sha(raw) == self.pins['coord'], 'COORD_CAS_DRIFT')
            c = loads(raw); need(c.get('shared_release_active') is False, 'FOREIGN_OWNER_OR_BUSY')
            self.check(); need(all(not p.exists() for p, _ in self.assets), 'ADDITIVE_COLLISION')
        else:
            receipt = loads(read(OPS / 'receipt.json')); coord = loads(read(COORD))
            need(receipt['status'] == 'verified' and receipt['manifestSha256'] == sha(self.mb)
                 and coord.get('shared_release_active') is False and coord['window']['nonce'] == receipt['nonce']
                 and coord['window']['owner_task'] == OWNER and coord['window']['manifestSha256'] == sha(self.mb)
                 and coord['window']['status'] == 'closed', 'VERIFIED_RECEIPT_WINDOW_REQUIRED')
            self.check({r['target']: sha(a) for r, _, a in self.mutations}, rolling=True, additions=True)
            need(all(H(p) == sha(data) for p, data in self.assets), 'ADDITIVE_HASH_DRIFT')
        return {'status': 'preflight-passed' if mode == 'preflight' else 'verified', 'writes': 0, 'manifestSha256': sha(self.mb)}
    def persist_receipt(self, result):
        data = encode(result); path = OPS / 'receipt.json'
        if self.receipt_bytes is None: exclusive(path, data)
        else: cas(path, self.receipt_bytes, data)
        need(read(path) == data, 'RECEIPT_READBACK_DRIFT')
        self.receipt_bytes = data
    def close(self, outcome):
        self.owned_check(); c = loads(self.owned); c['shared_release_active'] = False
        c['window'].update(status='closed', outcome=outcome, closedAtUtc=stamp(), receipt=str(OPS / 'receipt.json'))
        c['window_history'].append(dict(c['window'])); c['updated_at'] = stamp(); closed = encode(c)
        try: cas(COORD, self.owned, closed)
        except BaseException:
            if read(COORD) == closed: cas(COORD, closed, self.owned)
            raise
    def apply(self, authorized):
        need(authorized, 'PARENT_EXPLICIT_REVIEWED_APPLY_REQUIRED'); need(not OPS.exists(), 'ONE_APPLY_NO_REPLAY'); self.validate()
        with locks():
            self.fresh(); raw = read(COORD); need(sha(raw) == self.pins['coord'], 'COORD_CAS_DRIFT')
            coord = loads(raw); need(coord.get('shared_release_active') is False, 'FOREIGN_OWNER_OR_BUSY')
            self.check(); need(all(not p.exists() for p, _ in self.assets), 'ADDITIVE_COLLISION')
            safe(OPS); OPS.mkdir(mode=0o700); syncdir(OPS.parent)  # irreversible attempt marker: no replay, including failure
            nonce = uuid.uuid4().hex; result = {'status': 'recovery-required', 'manifestSha256': sha(self.mb), 'nonce': nonce, 'ownerTask': OWNER, 'retryForbidden': True}
            receipt_failed = False
            try:
                for name, data in [('manifest.json', self.mb), ('review.json', self.rb), ('baseline.json', self.bb), ('backend2-verified.json', self.proof), ('coord-before.json', raw)]: exclusive(OPS / name, data)
                for n, (_, before, after) in enumerate(self.mutations):
                    exclusive(OPS / ('before-' + str(n)), before); exclusive(OPS / ('candidate-' + str(n)), after)
                coord.setdefault('window_history', [])
                if 'window' in coord: coord['window_history'].append(coord['window'])
                coord['shared_release_active'] = True; coord['updated_at'] = stamp()
                coord['window'] = dict(owner_task=OWNER, nonce=nonce, manifestSha256=sha(self.mb), status='applying', openedAtUtc=stamp(), opsDir=str(OPS), scope=SCOPE)
                owned = encode(coord); exclusive(OPS / 'coord-owned.json', owned); cas(COORD, raw, owned); self.owned = owned
                overrides = {}
                for p, data in self.assets:
                    self.owned_check(); self.check(overrides, additions=True); exclusive(p, data, 0o644); need(H(p) == sha(data), 'ADD_WRITE_HASH')
                for row, before, after in sorted(self.mutations, key=lambda x: x[0]['kind'] != 'front-api'):
                    self.owned_check(); self.check(overrides, rolling=self.reloaded, additions=True); cas(row['target'], before, after); overrides[row['target']] = sha(after)
                    if row['kind'] == 'front-api': self.roll(overrides)
                self.owned_check(); self.check(overrides, rolling=True, additions=True)
                need(all(H(p) == sha(data) for p, data in self.assets), 'FINAL_ADD_HASH')
                result['status'] = 'verified'
                try: self.persist_receipt(result)
                except BaseException: receipt_failed = True; raise
                self.close('verified')
            except BaseException:
                result['status'] = 'recovery-required'; result['foreignFilesNotTouched'] = []; result['ownFilesRestored'] = []
                try:
                    self.owned_check()
                    for row, before, after in reversed(self.mutations):
                        self.owned_check(); current = read(row['target'])
                        if current == after: cas(row['target'], after, before); result['ownFilesRestored'].append(row['target'])
                        elif current != before: result['foreignFilesNotTouched'].append(row['target'])
                    need(not result['foreignFilesNotTouched'], 'FOREIGN_BYTES_NOT_OVERWRITTEN')
                    self.check(rolling=True, additions=True)
                    if self.reloaded: self.roll({})
                    self.owned_check(); self.check(rolling=True, additions=True)
                    need(not receipt_failed, 'RECEIPT_PERSISTENCE_UNCONFIRMED')
                    result['status'] = 'rolled-back'
                    try: self.persist_receipt(result)
                    except BaseException: receipt_failed = True; raise
                    self.close('rolled-back')
                except BaseException:
                    result['status'] = 'recovery-required'
                    try:
                        self.owned_check(); c = loads(self.owned)
                        c['window'].update(status='recovery-required', receipt=str(OPS / 'receipt.json')); c['updated_at'] = stamp()
                        updated = encode(c); cas(COORD, self.owned, updated); self.owned = updated
                    except BaseException: result['ownershipUnconfirmed'] = True  # never overwrite foreign coordination
            if receipt_failed: result['receiptPersistenceUnconfirmed'] = True
            elif result['status'] == 'recovery-required': self.persist_receipt(result)
            return result

def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('mode', choices=['preflight', 'apply', 'verify'])
    p.add_argument('--package', required=True)
    for key in ['manifest', 'review', 'baseline', 'coord']: p.add_argument('--' + key + '-sha256', required=True)
    p.add_argument('--allow-reviewed-apply', action='store_true'); a = p.parse_args()
    pins = {k: getattr(a, k + '_sha256') for k in ['manifest', 'review', 'baseline', 'coord']}
    need(all(re.fullmatch('[0-9a-f]{64}', v) for v in pins.values()), 'EXPLICIT_SHA_PINS_REQUIRED')
    need(a.mode == 'apply' or not a.allow_reviewed_apply, 'AUTHORIZATION_ONLY_FOR_APPLY')
    release = Release(safe(Path(a.package)), pins)
    result = release.apply(a.allow_reviewed_apply) if a.mode == 'apply' else release.readonly(a.mode)
    print(json.dumps(result)); return 0 if result['status'] in {'verified', 'preflight-passed'} else 1

if __name__ == '__main__':
    try: raise SystemExit(main())
    except Exception: print(json.dumps({'status': 'failed-closed', 'detailsSuppressed': True})); raise SystemExit(1)
