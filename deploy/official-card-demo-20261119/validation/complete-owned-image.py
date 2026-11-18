#!/usr/bin/env python3
"""One owned-window disk completion, NOT retry/apply. Only fixed public GETs.

Input/review live in BASE/owned-completion. Review pins SHA256(canonical(input
without recoveryReviewSha256)), this script and original R20 manifest. All writes
are root full-byte CAS, own coord full-byte CAS, and standalone receipt only.
Read-only pm2 jlist is used; no PM2 mutation, reload, runtime or source writes.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import uuid

OWNER = 'yOJKWq2DYYh42oMQkoK7ow'
NONCE = '644c9cb89d3f4f7a95055d933ed228d4'
SCOPE = 'official-system-images-readonly'
MH = '45ce7095042540a1ae0b4fa5ff6f847b3d4ed159564b3adbe58ace11ad1b1d74'
BEFORE_H = '00fc0697ba47fb9e547137795619c2d3c2a5caf2c31b0150c156d247332ae6b0'
AFTER_H = '78d84941c69e028c2f9eadd055d745b543d7382171eee01276f785a46a04f330'
RUNTIME_H = '55f436a63721c859e0570dccdce8d7f68a93f0b13f9e621c2526845a7bf302ae'
BASE = Path('/opt/backups/demo-correct-images-20261118-yOJKWq2D')
STAGE = BASE / 'package'
OWN = BASE / 'owned-completion'
INPUT = OWN / 'recovery-input.json'
REVIEW = OWN / 'recovery-review.json'
RECEIPT = OWN / 'receipt.json'
ORIGINAL = BASE / 'receipt'
TARGET = Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js')
RUNTIME = TARGET.parent.parent / 'runtime' / ('officialMall.front.' + RUNTIME_H + '.runtime.mjs')
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
LOCKS = ['/var/lock/dianzi51-public-deploy.lock', '/var/lock/dianzi51-production-code.lock']


def H(b):
    return hashlib.sha256(b).hexdigest()


def canonical(x):
    return json.dumps(x, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def need(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def read(p):
    need(p.is_file() and not p.is_symlink(), 'REGULAR_FILE_REQUIRED')
    return p.read_bytes()


def syncdir(p):
    fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(p, before, after):
    need(read(p) == before, 'FULL_BYTE_CAS')
    s = p.stat()
    tmp = p.parent / ('.owned-image-' + uuid.uuid4().hex)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IMODE(s.st_mode))
    try:
        with os.fdopen(fd, 'wb') as f:
            os.fchmod(f.fileno(), stat.S_IMODE(s.st_mode))
            os.fchown(f.fileno(), s.st_uid, s.st_gid)
            f.write(after); f.flush(); os.fsync(f.fileno())
        need(read(p) == before, 'LAST_FULL_BYTE_CAS')
        os.replace(tmp, p)
        syncdir(p.parent)
    finally:
        if tmp.exists():
            tmp.unlink()


def exclusive(p, b):
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(b); f.flush(); os.fsync(f.fileno())
    syncdir(p.parent)


def capture():
    rows = json.loads(subprocess.check_output(['pm2', 'jlist'], stderr=subprocess.PIPE, timeout=30))
    out, embedded = [], {}
    for x in rows:
        e, pid = x['pm2_env'], x['pid']
        raw = read(Path('/proc') / str(pid) / 'environ')
        if x['name'] == 'dianzi51':
            values = [v.split(b'=', 1)[1] for v in raw.split(b'\0') if v.startswith(b'pm2_env=')]
            need(len(values) == 1, 'RAW_PM2_ENV_REQUIRED')
            parsed = json.loads(values[0])
            need(isinstance(parsed, dict) and isinstance(parsed.get('env'), dict), 'RAW_PM2_ENV_DICT')
            embedded[x['pm_id']] = H(canonical(parsed['env']))
        out.append(dict(id=x['pm_id'], name=x['name'], pid=pid, status=e['status'],
                        script=e['pm_exec_path'], cwd=e['pm_cwd'], mode=e['exec_mode'],
                        configuredEnvSha256=H(canonical(e.get('env', {}))), rawEnvSha256=H(raw)))
    return sorted(out, key=lambda x: x['id']), embedded


class Completion:
    def validate(self):
        self.ib, self.rb = read(INPUT), read(REVIEW)
        self.i, self.r = json.loads(self.ib), json.loads(self.rb)
        need(set(self.i) == {'schema', 'recoveryReviewSha256', 'coordSha256', 'originalReceiptSha256',
                            'beforeProcesses', 'originalPublicCanonical'}, 'EXACT_INPUT_SCHEMA')
        need(self.i['schema'] == 'owned-image-completion-v1', 'INPUT_SCHEMA')
        payload = {k: v for k, v in self.i.items() if k != 'recoveryReviewSha256'}
        need(H(self.rb) == self.i['recoveryReviewSha256'] and self.r['status'] == 'passed'
             and self.r['independent'] is True and self.r['scriptSha256'] == H(read(Path(__file__)))
             and self.r['originalManifestSha256'] == MH
             and self.r['inputPayloadSha256'] == H(canonical(payload)), 'RECOVERY_REVIEW_PIN')
        self.mb = read(STAGE / 'manifest.json')
        need(H(self.mb) == MH, 'ORIGINAL_R20_MANIFEST')
        self.m = json.loads(self.mb)
        real = Path('/data/archive/backups/demo-correct-images-20261118-yOJKWq2D')
        need(STAGE.resolve() == real / 'package' and OWN.resolve() == real / 'owned-completion'
             and ORIGINAL.resolve() == real / 'receipt',
             'EXACT_REAL_DIRECTORIES')
        need(TARGET.resolve() == TARGET and RUNTIME.resolve() == RUNTIME and COORD.resolve() == COORD,
             'EXACT_REAL_TARGETS')
        # Load only original reviewed bytes, AFTER all package hashes are checked.
        actual = {str(p.relative_to(STAGE)) for p in STAGE.rglob('*') if p.is_file()}
        need(not any(p.is_symlink() for p in STAGE.rglob('*')), 'NO_PACKAGE_LINKS')
        need(actual == set(self.m['packageFiles']) | {'manifest.json', 'review.json'}, 'EXACT_R20_FILES')
        for name, sha in self.m['packageFiles'].items():
            need(not Path(name).is_absolute() and '..' not in Path(name).parts, 'PACKAGE_SCOPE')
            need(H(read(STAGE / name)) == sha, 'R20_FILE_PIN')
        p = STAGE / 'image-release.py'
        need(H(read(p)) == self.m['controllerSha256'], 'ORIGINAL_CONTROLLER_PIN')
        spec = importlib.util.spec_from_file_location('reviewed_original_image_release', p)
        module = importlib.util.module_from_spec(spec)
        # Do not create __pycache__ or otherwise modify the frozen package.
        exec(compile(read(p), str(p), 'exec'), module.__dict__)
        self.original = module.Controller(str(STAGE), MH)
        self.original.validate(apply=True)
        self.before, self.after = self.original.before, self.original.after
        need(H(self.before) == BEFORE_H and H(self.after) == AFTER_H, 'ROOT_BYTE_PINS')
        need(read(ORIGINAL / 'manifest.json') == self.mb, 'ORIGINAL_RECEIPT_MANIFEST')
        need(read(ORIGINAL / 'before-front.js') == self.before
             and read(ORIGINAL / 'after-front.js') == self.after, 'OWN_SAVED_BYTES')
        self.ob = read(ORIGINAL / 'receipt.json')
        o = json.loads(self.ob)
        need(H(self.ob) == self.i['originalReceiptSha256'] and o['status'] == 'recovery-required'
             and o['retryForbidden'] is True, 'ORIGINAL_RETRY_FORBIDDEN_UNCHANGED')
        need(len(self.m['protectedFiles']) == 244, 'EXACT_244_PROTECTED')
        self.owned = read(COORD)
        c = json.loads(self.owned)
        w = c['window']
        need(H(self.owned) == self.i['coordSha256'] and c['shared_release_active'] is True
             and w['owner_task'] == OWNER and w['nonce'] == NONCE and w['scope'] == SCOPE
             and w['status'] == 'recovery-required' and w['manifestSha256'] == MH, 'EXACT_OWN_WINDOW')
        need(not RECEIPT.exists() and not RECEIPT.is_symlink(), 'STANDALONE_ONCE_ONLY')
        self.check()
        need(read(TARGET) == self.before, 'ONLY_BEFORE_ROOT_ACCEPTED')

    def process_check(self):
        current, embedded = capture()
        snap, old = self.i['beforeProcesses'], self.m['beforeProcesses']
        need(len(current) == 12 and len({x['id'] for x in current}) == 12, 'TWELVE_PROCESSES')
        need(current == snap, 'POSTREVIEW_PROCESS_OR_RAW_ENV_DRIFT')
        need(len(old) == 12 and [x['id'] for x in old] == [x['id'] for x in current], 'ORIGINAL_PROCESS_IDS')
        front = 0
        for a, b in zip(old, current):
            need(b['pid'] > 0 and b['status'] == 'online', 'ONLINE_REQUIRED')
            if a['name'] == 'dianzi51':
                front += 1
                ignored = {'pid', 'rawEnvSha256'}
                need({k: v for k, v in a.items() if k not in ignored} ==
                     {k: v for k, v in b.items() if k not in ignored}, 'FRONT_CONFIG_IDENTITY')
                need(embedded[b['id']] == a['configuredEnvSha256'], 'ACTUAL_USER_ENV_CHANGED')
            else:
                need(a == b, 'NONFRONT_EIGHT_EXACT')
        need(front == 4, 'FOUR_FRONTS')

    def check(self):
        need(read(INPUT) == self.ib and read(REVIEW) == self.rb, 'REVIEW_INPUT_DRIFT')
        need(read(COORD) == self.owned, 'COORD_OWN_BYTES')
        need(read(ORIGINAL / 'receipt.json') == self.ob, 'ORIGINAL_RECEIPT_DRIFT')
        need(H(read(RUNTIME)) == RUNTIME_H, 'EXISTING_RUNTIME_EXACT')
        self.original.protect()
        self.process_check()

    def gates(self):
        for unused in range(4):
            dto = self.original.gate(require_image=True)
            need(canonical(dto) == canonical(self.i['originalPublicCanonical']), 'ORIGINAL_PUBLIC_DTO_CHANGED')

    def complete(self):
        self.validate()
        # Original reviewed gate must pass ALL four rounds before any root write.
        self.gates()
        self.check()
        need(read(TARGET) == self.before, 'PREWRITE_BEFORE_BYTES')
        attempted = False
        closed = None
        try:
            # Durable standalone intent precedes root mutation; never touch original receipt.
            exclusive(RECEIPT, canonical({'status': 'recovery-required', 'retryForbidden': True,
                                         'originalManifestSha256': MH}) + b'\n')
            attempted = True
            atomic(TARGET, self.before, self.after)
            need(read(TARGET) == self.after, 'AFTER_FULL_BYTES')
            self.gates()
            self.check()
            need(read(TARGET) == self.after, 'FINAL_AFTER_FULL_BYTES')
            c = json.loads(self.owned)
            c['shared_release_active'] = False
            c['window'].update(status='verified-recovered-completion', needsOperatorRecovery=False,
                               recoveryReviewSha256=H(self.rb), recoveryScriptSha256=H(read(Path(__file__))),
                               recoveryInputSha256=H(self.ib))
            closed = canonical(c) + b'\n'
            # Any success-receipt failure reopens only our exact closed bytes and
            # rolls our own root back, independently of diagnostic availability.
            final = canonical(dict(status='verified-owned-completion', retryForbidden=True,
                originalManifestSha256=MH, recoveryReviewSha256=H(self.rb), recoveryInputSha256=H(self.ib),
                scriptSha256=H(read(Path(__file__))), nonce=NONCE, reloadNames=[], runtimeWrites=0,
                rootBeforeSha256=BEFORE_H, rootAfterSha256=AFTER_H,
                originalReceiptSha256=H(self.ob), processSnapshotSha256=H(canonical(self.i['beforeProcesses'])),
                publicCanonicalSha256=H(canonical(self.i['originalPublicCanonical'])))) + b'\n'
            self.check()
            need(read(TARGET) == self.after, 'ROOT_BEFORE_CLOSE')
            atomic(COORD, self.owned, closed)
            need(read(COORD) == closed and read(TARGET) == self.after, 'CLOSE_NOT_VERIFIED')
            atomic(RECEIPT, read(RECEIPT), final)
            return json.loads(final)
        except BaseException:
            # Never let diagnostic failures bypass own-root rollback. A post-rename
            # fsync error is a possible commit, not proof nothing changed.
            try:
                cb = read(COORD)
                if closed is not None and cb == closed:
                    try:
                        atomic(COORD, closed, self.owned)
                    except BaseException:
                        pass
                if attempted and read(COORD) == self.owned and read(TARGET) == self.after:
                    atomic(TARGET, self.after, self.before)
            finally:
                try:
                    atomic(RECEIPT, read(RECEIPT), canonical({'status': 'recovery-required',
                        'retryForbidden': True, 'originalManifestSha256': MH}) + b'\n')
                except BaseException:
                    pass
            raise RuntimeError('OWNED_COMPLETION_FAILED_CLOSED_NO_RELOAD') from None


def main():
    os.umask(0o077)
    p = argparse.ArgumentParser()
    p.add_argument('--complete-reviewed-owned-release', action='store_true', required=True)
    p.parse_args()
    handles = []
    try:
        for path in LOCKS:
            f = open(path, 'r+b'); handles.append(f)
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(Completion().complete()))
    finally:
        for f in reversed(handles):
            f.close()


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        print(json.dumps({'status': 'failed-closed', 'detailsSuppressed': True}))
        raise SystemExit(1)
