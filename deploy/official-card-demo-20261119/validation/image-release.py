#!/usr/bin/env python3
"""Exact official-system-images frontAPI release; no static/DB/auth/worker actions.

Manifest contract: packageFiles (all regular files except manifest/review),
protectedFiles [{path,sha256}], beforeProcesses (processes() schema),
frozenSources [{source,sha256}], evidence [{source,sha256}], publicReadGate
{source,sha256,expectedImageUrl}. See offline test fixture for complete schema.
Gate is the parent's fixed read-public-images.cjs. Additional fixed GETs bind
same-SKU list/detail DTOs and their quantity, price and array sequence across
release/recovery, excluding only thumbnailUrl/imageKind. No generic commands.
"""
import argparse
import base64
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from urllib.parse import urlsplit, urlencode, parse_qsl
import uuid

OWNER = 'yOJKWq2DYYh42oMQkoK7ow'
SCOPE = 'official-system-images-readonly'
STAGE = Path('/opt/backups/demo-correct-images-20261118-yOJKWq2D/package')
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
LOCKS = ['/var/lock/dianzi51-public-deploy.lock', '/var/lock/dianzi51-production-code.lock']
TARGET = Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js')
BEFORE_H = '00fc0697ba47fb9e547137795619c2d3c2a5caf2c31b0150c156d247332ae6b0'
AFTER_H = '78d84941c69e028c2f9eadd055d745b543d7382171eee01276f785a46a04f330'
RUNTIME_H = '55f436a63721c859e0570dccdce8d7f68a93f0b13f9e621c2526845a7bf302ae'
EXPECTED_IMAGE = 'https://dianzi51-assets.oss-cn-hangzhou.aliyuncs.com/material-images/STM32F103C8T6.png'
RUNTIME = TARGET.parent.parent / 'runtime' / ('officialMall.front.' + RUNTIME_H + '.runtime.mjs')
OLD_IMPORT = b'"../runtime/officialMall.front.759959d8c853b70aef02457dea86e40c5d8aaeee6ec1ab304b88d3bd9f751227.runtime.mjs"'
NEW_IMPORT = ('"../runtime/' + RUNTIME.name + '"').encode()
OLD_NATIVE = b'{router,publicProcedure}'
NEW_NATIVE = b'{router,publicProcedure,materialThumbnailUrls,readGeneratedImageDictionaryRows,warmupMaterialThumbnailIndex,approvedUploadedMaterialImageItemMap,approvedMaterialGeneratedImageItemMap,normalizeGeneratedImageBrand,normalizeGeneratedImagePartNumber,createUploadedMaterialImageBrandMatcher,isApprovedUploadedMaterialImageUrl,packagingAppearanceLookupKeys}'


def H(b):
    return hashlib.sha256(b).hexdigest()


def need(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def canonical(x):
    return json.dumps(x, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def encode(x):
    return canonical(x) + b'\n'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def fsync_dir(p):
    fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(p, before, after):
    """Full-byte CAS; caller must inspect target even when post-replace fsync raises."""
    need(not p.is_symlink() and p.read_bytes() == before, 'FULL_BYTE_CAS')
    s = p.stat()
    tmp = p.parent / ('.image-release-' + uuid.uuid4().hex)
    fd = os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, stat.S_IMODE(s.st_mode))
    try:
        with os.fdopen(fd, 'wb') as f:
            os.fchmod(f.fileno(), stat.S_IMODE(s.st_mode))
            os.fchown(f.fileno(), s.st_uid, s.st_gid)
            f.write(after); f.flush(); os.fsync(f.fileno())
        need(p.read_bytes() == before and not p.is_symlink(), 'LAST_BYTE_CAS')
        os.replace(tmp, p)
        fsync_dir(p.parent)
    finally:
        if tmp.exists():
            tmp.unlink()


def exclusive(p, data, mode=0o600):
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(fd, 'wb') as f:
        os.fchmod(f.fileno(), mode)
        f.write(data); f.flush(); os.fsync(f.fileno())
    fsync_dir(p.parent)


def diagnostic(p, data):
    try:
        p.write_bytes(data)
    except BaseException:
        pass


def processes():
    rows = json.loads(subprocess.check_output(['pm2', 'jlist'], stderr=subprocess.PIPE, timeout=30))
    out = []
    for x in rows:
        e, pid = x['pm2_env'], x['pid']
        out.append(dict(id=x['pm_id'], name=x['name'], pid=pid, status=e['status'],
                        script=e['pm_exec_path'], cwd=e['pm_cwd'], mode=e['exec_mode'],
                        configuredEnvSha256=H(canonical(e.get('env', {}))),
                        rawEnvSha256=H((Path('/proc') / str(pid) / 'environ').read_bytes())))
    return sorted(out, key=lambda x: x['id'])


def reload_front():
    subprocess.check_output(['pm2', 'reload', 'dianzi51'], stderr=subprocess.PIPE, timeout=150)


def public_image(url):
    u = urlsplit(url)
    return (u.scheme + '://' + u.netloc + u.path == EXPECTED_IMAGE
            and not u.fragment and all(k == 'v' for k, value in parse_qsl(u.query, keep_blank_values=True)))


def without_images(x):
    if isinstance(x, dict):
        return {k: without_images(v) for k, v in x.items() if k not in {'thumbnailUrl', 'imageKind'}}
    if isinstance(x, list):
        return [without_images(v) for v in x]
    return x


def public_query(kind, payload):
    need(kind in {'list', 'detail'}, 'PUBLIC_QUERY_KIND')
    if kind == 'list':
        need(payload == {'partNumber': 'STM32F103C8T6', 'brand': 'ST', 'page': 1, 'pageSize': 100}, 'FIXED_PUBLIC_LIST')
    else:
        need(set(payload) == {'publicId'} and isinstance(payload['publicId'], str), 'PUBLIC_DETAIL_ID')
    url = 'https://51dianzi.com/api/trpc/officialMall.' + kind + '?' + urlencode({'input': json.dumps({'json': payload}, separators=(',', ':'))})
    raw = subprocess.check_output(['curl', '-fsS', '--compressed', '--max-time', '15', '-A', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', '--resolve',
        '51dianzi.com:443:127.0.0.1', '-H', 'Origin: https://51dianzi.com', '-H',
        'Referer: https://51dianzi.com/search?q=STM32F103C8T6', url], stderr=subprocess.PIPE, timeout=20)
    envelope = json.loads(raw)
    need('error' not in envelope, 'PUBLIC_QUERY_ERROR')
    return envelope['result']['data']['json']


class Controller:
    def __init__(self, package, manifest_hash):
        self.pack = Path(package).resolve()
        need(self.pack == STAGE.resolve(), 'EXACT_CANONICAL_PACKAGE')
        self.mb = (self.pack / 'manifest.json').read_bytes()
        need(H(self.mb) == manifest_hash, 'FROZEN_MANIFEST')
        self.m = json.loads(self.mb)
        self.receipt = self.pack.parent / 'receipt'
        self.before = self.after = None

    def staged(self, name):
        p = self.pack / name
        need(isinstance(name, str) and not Path(name).is_absolute() and '..' not in Path(name).parts,
             'STAGED_SCOPE')
        need(p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(self.pack), 'STAGED_FILE')
        return p

    def validate(self, apply=False):
        m = self.m
        need(m['ownerTask'] == OWNER and m['scope'] == SCOPE, 'EXACT_OWNER_SCOPE')
        need(m['apiWrites'] == 1 and m['databaseWrites'] == 0 and m['adminHtmlWrites'] == 0
             and m['otherHtmlWrites'] == 0 and m['reloadNames'] == ['dianzi51'], 'API_ONLY_SCOPE')
        need(m['kind'] == 'runtime/frontJS' and m['target'] == str(TARGET)
             and m['runtimeTarget'] == str(RUNTIME), 'EXACT_TARGETS')
        need(m['beforeApiSha256'] == BEFORE_H and m['afterApiSha256'] == AFTER_H
             and m['runtimeSha256'] == RUNTIME_H, 'FIXED_BYTE_PINS')
        need(H(Path(__file__).read_bytes()) == m['controllerSha256'], 'CONTROLLER_PIN')
        actual = {str(p.relative_to(self.pack)) for p in self.pack.rglob('*') if p.is_file()}
        need(not any(p.is_symlink() for p in self.pack.rglob('*')), 'PACKAGE_SYMLINK')
        need(actual == set(m['packageFiles']) | {'manifest.json', 'review.json'}, 'EXACT_PACKAGE_CONTENTS')
        for name, sha in m['packageFiles'].items():
            need(H(self.staged(name).read_bytes()) == sha, 'PACKAGE_FILE_PIN')
        self.before = self.staged('baseline-front.js').read_bytes()
        self.after = self.staged('candidate-front.js').read_bytes()
        need(H(self.before) == BEFORE_H and H(self.after) == AFTER_H, 'API_PACKAGE_PIN')
        need(H(self.staged('runtime/' + RUNTIME.name).read_bytes()) == RUNTIME_H, 'RUNTIME_PACKAGE_PIN')
        delta = json.loads(self.staged('root-patches.json').read_bytes())
        expected = [(2096, OLD_IMPORT, NEW_IMPORT), (5900323, OLD_NATIVE, NEW_NATIVE)]
        need(delta['schema'] == 'native-byte-delta-v1' and delta['inverseVerified'] is True
             and delta['beforeSha256'] == BEFORE_H and delta['afterSha256'] == AFTER_H
             and len(delta['patches']) == 2, 'TWO_HUNKS_ONLY')
        patched = self.before
        for r, (offset, old, new) in reversed(list(zip(delta['patches'], expected))):
            need(r['oldStart'] == offset and r['newStart'] == offset
                 and base64.b64decode(r['oldBase64'], validate=True) == old
                 and base64.b64decode(r['newBase64'], validate=True) == new
                 and patched[offset:offset + len(old)] == old, 'EXISTING_NATIVE_IMPORT_HUNK')
            patched = patched[:offset] + new + patched[offset + len(old):]
        need(patched == self.after, 'FULL_BYTES_NO_OTHER_DELTA')
        need(m['frozenSources'] and m['evidence'], 'SOURCE_EVIDENCE_REQUIRED')
        for r in m['frozenSources'] + m['evidence']:
            need(m['packageFiles'].get(r['source']) == r['sha256'], 'FROZEN_SOURCE_EVIDENCE_BINDING')
        need(all(m['proofs'].get(k) is True for k in ['noMoneyChange', 'noRouterRoleContextChange',
             'readOnlySystemGallery', 'nativeOfflineUnitPassed', 'workerRefundPermitBackupsPinned']), 'SOURCE_PROOFS')
        paths = [r['path'] for r in m['protectedFiles']]
        need(len(paths) >= 200 and len(set(paths)) == len(paths) and str(TARGET) not in paths,
             'ACTUAL_PROTECTED_BASELINE')
        need(all(Path(p).is_absolute() and '..' not in Path(p).parts for p in paths), 'PROTECT_PATHS')
        ps = m['beforeProcesses']
        need(len(ps) == 12 and len({x['id'] for x in ps}) == 12
             and ps == sorted(ps, key=lambda x: x['id']) and all(x['pid'] > 0 and x['status'] == 'online' for x in ps),
             'TWELVE_BASELINE_PROCESSES')
        front = [x for x in ps if x['name'] == 'dianzi51']
        need(len(front) == 4 and all(x['script'] == str(TARGET) for x in front), 'FOUR_FRONT_EXECUTABLES')
        gate = m['publicReadGate']
        need(gate['source'] == 'validation/read-public-images.cjs'
             and m['packageFiles'].get(gate['source']) == gate['sha256'], 'EXACT_GATE_PIN')
        image = urlsplit(gate['expectedImageUrl'])
        need(gate['expectedImageUrl'] == EXPECTED_IMAGE and not image.query, 'SYSTEM_IMAGE_PUBLIC_CANONICAL_URL')
        # Gate capabilities are independently reviewed source evidence, not arbitrary CLI options.
        need(m['proofs'].get('gateOnlyPublicGETNoAuthNoDmlDdl') is True, 'GATE_SOURCE_PROOF')
        if apply:
            r = json.loads((self.pack / 'review.json').read_bytes())
            need(r['status'] == 'passed' and r['independent'] is True
                 and r['manifestSha256'] == H(self.mb) and r['controllerSha256'] == m['controllerSha256'],
                 'INDEPENDENT_REVIEW')

    def protect(self):
        for r in self.m['protectedFiles']:
            need(H(Path(r['path']).read_bytes()) == r['sha256'], 'PROTECTED_FILE_DRIFT')

    def process_check(self, changed=False, recovering=False):
        ps = processes()
        need(len(ps) == 12 and len({x['id'] for x in ps}) == 12, 'PROCESS_COUNT')
        for old, current in zip(self.m['beforeProcesses'], ps):
            if not (recovering and old['name'] == 'dianzi51'):
                need(current['pid'] > 0 and current['status'] == 'online', 'PROCESS_HEALTH')
            if changed and old['name'] == 'dianzi51':
                ignored = {'pid', 'status'} if recovering else {'pid'}
                need({k: v for k, v in old.items() if k not in ignored} ==
                     {k: v for k, v in current.items() if k not in ignored}, 'FRONT_IDENTITY_ENV_DRIFT')
            else:
                need(old == current, 'PROTECTED_PROCESS_ENV_PID_DRIFT')
        return ps

    def gate(self, require_image=False):
        g = self.m['publicReadGate']
        script = self.staged(g['source'])
        need(H(script.read_bytes()) == g['sha256'], 'GATE_HASH_DRIFT')
        args = ['node', str(script)] + (['--require-image'] if require_image else [])
        r = json.loads(subprocess.check_output(args, stderr=subprocess.PIPE, timeout=150))
        need(r['status'] == 'public-image-readonly-passed' and r['readonlyGET'] is True
             and r['browserSessionMinted'] is False and r['ordersSubmitted'] == 0
             and r['methods'] == ['officialMall.list', 'officialMall.detail'], 'PUBLIC_GATE_FAILED')
        if require_image:
            need(r['systemImageMatched'] is True and r['imageKind'] == 'catalog_reference', 'SYSTEM_IMAGE_GATE')
        # Independently preserve every list/detail DTO field and array sequence except
        # the two image projection fields this exact release is intended to change.
        rows = public_query('list', {'partNumber': 'STM32F103C8T6', 'brand': 'ST', 'page': 1, 'pageSize': 100})
        exact = [x for x in rows['items'] if x['partNumber'] == 'STM32F103C8T6' and x['brand'] == 'ST']
        need(bool(exact), 'EXACT_PUBLIC_SKU')
        detail = public_query('detail', {'publicId': exact[0]['publicId']})
        item = detail['item']
        need(item['publicId'] == exact[0]['publicId'] and item['revision'] == exact[0]['revision'], 'SAME_SKU_REVISION')
        if require_image:
            need(item['imageKind'] == 'catalog_reference' and public_image(item['thumbnailUrl']), 'EXACT_DETAIL_IMAGE')
            need(any(x['publicId'] == item['publicId'] and x.get('thumbnailUrl') == item['thumbnailUrl']
                     for x in rows['items']), 'EXACT_LIST_IMAGE')
        return without_images({'list': rows, 'detail': detail})

    def preflight(self):
        self.validate()
        need(not self.receipt.exists(), 'APPLY_ONCE_RECEIPT_EXISTS')
        need(not TARGET.is_symlink() and TARGET.read_bytes() == self.before, 'BEFORE_API_DRIFT')
        need(not RUNTIME.exists() and not RUNTIME.is_symlink() and RUNTIME.parent.is_dir(), 'NEW_RUNTIME_COLLISION')
        need(json.loads(COORD.read_bytes()).get('shared_release_active') is False, 'SHARED_WINDOW_BUSY')
        self.protect(); self.process_check()
        return self.gate()

    def apply(self, allow=False):
        need(allow, 'EXPLICIT_FROZEN_APPLY_ALLOW')
        self.validate(apply=True)
        baseline = self.preflight()
        self.receipt.mkdir(mode=0o700, exist_ok=False)
        exclusive(self.receipt / 'manifest.json', self.mb)
        exclusive(self.receipt / 'before-front.js', self.before)
        exclusive(self.receipt / 'after-front.js', self.after)
        cb = COORD.read_bytes(); c = json.loads(cb)
        need(c.get('shared_release_active') is False, 'COORD_BUSY')
        w = dict(owner_task=OWNER, nonce=uuid.uuid4().hex, scope=SCOPE, status='applying',
                 manifestSha256=H(self.mb), openedAtUtc=now())
        c.update(shared_release_active=True, window=w)
        owned = encode(c)
        status, api_attempted, reload_started = 'recovery-required', False, False
        # Acquisition itself can commit before fsync raises. Restore only exact own bytes.
        try:
            atomic(COORD, cb, owned)
        except BaseException:
            try:
                if COORD.read_bytes() == owned:
                    atomic(COORD, owned, cb)
                recovered = COORD.read_bytes() == cb
            except BaseException:
                recovered = False
            diagnostic(self.receipt / 'receipt.json', encode({'status': 'rolled-back' if recovered
                       else 'recovery-required', 'retryForbidden': True}))
            raise RuntimeError('COORD_ACQUISITION_FAILED_NO_RETRY') from None
        try:
            exclusive(RUNTIME, self.staged('runtime/' + RUNTIME.name).read_bytes(), 0o644)
            need(H(RUNTIME.read_bytes()) == RUNTIME_H, 'ADDED_RUNTIME_PIN')
            self.protect(); self.process_check()
            need(COORD.read_bytes() == owned, 'COORD_OWNERSHIP_LOST')
            api_attempted = True
            atomic(TARGET, self.before, self.after)
            need(TARGET.read_bytes() == self.after, 'AFTER_API_DRIFT')
            need(COORD.read_bytes() == owned, 'COORD_OWNERSHIP_LOST')
            self.process_check()
            reload_started = True
            reload_front()
            need(TARGET.read_bytes() == self.after and COORD.read_bytes() == owned, 'AFTER_RELOAD_OWNERSHIP')
            need(canonical(self.gate(True)) == canonical(baseline), 'QTY_PRICE_DTO_SEQUENCE_CHANGED')
            self.protect(); self.process_check(True)
            need(TARGET.read_bytes() == self.after, 'FINAL_API_DRIFT')
            status = 'verified'
        except BaseException:
            diagnostic(self.receipt / 'error.json', encode({'status': 'apply-failed', 'detailsSuppressed': True}))
            try:
                need(COORD.read_bytes() == owned, 'COORD_OWNERSHIP_LOST_NO_MUTATION')
                current = TARGET.read_bytes()
                need(current in (self.before, self.after), 'FOREIGN_API_NO_ROLLBACK_NO_RELOAD')
                if api_attempted and current == self.after:
                    need((self.receipt / 'before-front.js').read_bytes() == self.before, 'OWN_BACKUP_PIN')
                    atomic(TARGET, self.after, self.before)
                need(TARGET.read_bytes() == self.before, 'ROOT_RECOVERY_NOT_VERIFIED')
                self.protect(); self.process_check(reload_started, recovering=True)
                if reload_started:
                    need(COORD.read_bytes() == owned, 'COORD_LOST_BEFORE_RECOVERY_RELOAD')
                    reload_front()
                self.protect(); self.process_check(reload_started)
                need(canonical(self.gate()) == canonical(baseline), 'RECOVERY_PUBLIC_PROJECTION')
                need(TARGET.read_bytes() == self.before and COORD.read_bytes() == owned, 'RECOVERY_OWNERSHIP')
                status = 'rolled-back'
            except BaseException:
                diagnostic(self.receipt / 'recovery-error.json', encode({'status': 'recovery-required'}))
            raise RuntimeError('FAILED_CLOSED_NO_RETRY') from None
        finally:
            # Lost coordination bytes are never overwritten. An unverified window stays blocking.
            try:
                if COORD.read_bytes() == owned:
                    closed = json.loads(owned)
                    ok = status in ('verified', 'rolled-back')
                    closed['shared_release_active'] = not ok
                    closed['window'].update(status=status, needsOperatorRecovery=not ok)
                    atomic(COORD, owned, encode(closed))
                else:
                    status = 'recovery-required'
            except BaseException:
                status = 'recovery-required'
            diagnostic(self.receipt / 'receipt.json', encode(dict(status=status, manifestSha256=H(self.mb),
                retryForbidden=True, reloadNames=['dianzi51'], apiWrites=1, databaseWrites=0,
                adminHtmlWrites=0, otherHtmlWrites=0, additiveRuntimePreserved=True)))
        need(status == 'verified', 'COORD_CLOSE_NOT_VERIFIED')
        return {'status': status, 'manifestSha256': H(self.mb), 'reloadNames': ['dianzi51']}


def main():
    os.umask(0o077)
    p = argparse.ArgumentParser()
    p.add_argument('mode', choices=['preflight', 'apply'])
    p.add_argument('--package', required=True)
    p.add_argument('--manifest-sha256', required=True)
    p.add_argument('--allow-reviewed-apply', action='store_true')
    a = p.parse_args()
    handles = []
    try:
        for name in LOCKS:
            f = open(name, 'r+b'); handles.append(f)
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        c = Controller(a.package, a.manifest_sha256)
        if a.mode == 'apply':
            result = c.apply(a.allow_reviewed_apply)
        else:
            c.preflight()
            result = {'status': 'preflight-passed', 'activeWrites': 0, 'manifestSha256': H(c.mb)}
        print(json.dumps(result))
    finally:
        for f in reversed(handles):
            f.close()


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        print(json.dumps({'status': 'failed-closed', 'detailsSuppressed': True}))
        raise SystemExit(1)
