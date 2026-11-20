#!/usr/bin/env python3
"""Offline customer-only preparation; no capture, review, approval or deployment."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

HERE = Path(__file__).absolute().parent
REPO = HERE.parent.parent
WORK = Path('/home/ubuntu/work/customer-batch')
CONTROLLER_SHA = 'f544c1663d84350df0ff036b7e1b330a8cfcb016e64d705027ff86411a26ed5d'
NODE = '/usr/bin/node'
# Exactly backend-builder.compile's transform options, but read original files twice.
BACKEND_HASH_CHECK = """
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const esbuild=require('esbuild'),b=require(process.argv[1]);
(async()=>{const hashes={};for(const rel of b.FILES){
 const r=await esbuild.transform(fs.readFileSync(path.join(process.argv[2],rel),'utf8'),
 {loader:'ts',format:'esm',target:'es2020',minify:false,legalComments:'none',sourcefile:rel,sourcemap:'external'});
 hashes[rel]=crypto.createHash('sha256').update(r.code).digest('hex');}
 process.stdout.write(JSON.stringify(hashes));})().catch(()=>process.exit(1));
"""
TOOLS = (
    'deploy/customer-batch-actions-20261119/build-native.mjs',
    'deploy/customer-batch-actions-20261119/backend-builder.cjs',
    'deploy/customer-batch-actions-20261119/backend-test.cjs',
    'deploy/customer-inventory-backend-20261114/core.cjs',
    'deploy/upload-manage-20261119/native-abi.mjs',
    'deploy/upload-manage-20261119/build-support.mjs',
    'deploy/customer-batch-actions-20261119/release.py',
    'deploy/customer-batch-actions-20261119/prepare-local.py',
)
FLAGS = dict(productionReads=0, productionWrites=0, networkAccess=False,
             captureExecuted=False, locksAcquired=False, entrypointExecuted=False,
             actualDatabaseAccess=False, reviewGenerated=False, approvalGenerated=False,
             preflightExecuted=False, applyExecuted=False, verifyExecuted=False,
             rollbackExecuted=False, noReplay=True)


class PrepareError(RuntimeError):
    pass


def need(ok, message):
    if not ok:
        raise PrepareError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def no_link(value):
    p = Path(value)
    need(p.is_absolute() and '..' not in p.parts and str(value) == str(p),
         'canonical absolute path required')
    for q in (p, *p.parents):
        need(not q.is_symlink(), 'symlink refused: ' + str(q))
    return p


def in_work(value):
    p = no_link(value)
    need(WORK in p.parents, 'path must be below ' + str(WORK))
    return p


def read(path):
    p = no_link(path)
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        a = os.fstat(fd)
        need(stat.S_ISREG(a.st_mode) and a.st_nlink == 1, 'single regular file required')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read()
        b = os.fstat(fd)
        need((a.st_dev, a.st_ino, a.st_size, a.st_mtime_ns, a.st_ctime_ns) ==
             (b.st_dev, b.st_ino, b.st_size, b.st_mtime_ns, b.st_ctime_ns)
             and p.lstat().st_ino == b.st_ino, 'input read race')
        return data
    finally:
        os.close(fd)


def put(path, data):
    p = in_work(path)
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with os.fdopen(os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as f:
        f.write(data)


def put_json(path, value):
    put(path, (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2,
                         allow_nan=False) + '\n').encode('ascii'))


def load_release():
    # Import has no execution side effects; never instantiate Controller or access Config.front.
    path = HERE / 'release.py'
    need(sha(read(path)) == CONTROLLER_SHA, 'controller drift')
    spec = importlib.util.spec_from_file_location('customer_batch_prepare_release', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def source_names(backend, native):
    """Read the fixed builders' declarative inventories; no JS evaluation or guessed sources."""
    constants = dict(re.findall(r"const (FRONT|SHARED)='([^']+)';", backend))
    match = re.search(r'const FILES=\[([^\]]+)\];', backend)
    need(match and set(constants) == {'FRONT', 'SHARED'}, 'backend FILES inventory changed')
    files = set()
    for item in match[1].split(','):
        m = re.fullmatch(r"\s*(?:(FRONT|SHARED)\+)?'([^']+)'\s*", item)
        need(m is not None, 'unsupported backend FILES expression')
        files.add(constants[m[1]] + m[2] if m[1] else m[2])
    prefix = re.search(r'const C = "([^"]+)";', native)
    need(prefix is not None, 'UI source prefix changed')
    ui = {prefix[1] + name for name in re.findall(r'C \+ "([^"]+)"', native)}
    need(files and ui, 'nonempty source inventories required')
    for name in files | ui | set(TOOLS):
        need(re.fullmatch(r'[A-Za-z0-9._/-]{1,240}', name) and
             all(part not in ('', '.', '..') for part in name.split('/')), 'unsafe source name')
    return files, ui


def parser():
    p = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    p.add_argument('--base', required=True, help='handoff directory containing local capture.json and baselines')
    p.add_argument('--out', required=True, help='NEW direct WORK child named backend-prepare-*')
    p.add_argument('--owner-nonce-file', required=True, help='private UTF-8 owner nonce file in WORK')
    p.add_argument('--reviewer-report', help='existing genuine independent report in WORK; never generated here')
    p.add_argument('--reviewer-sha256', help='explicit SHA256 of the independent report bytes')
    p.add_argument('--seal', action='store_true', help='candidate only; requires existing independently supplied report')
    return p


def inputs(args, release):
    base, out = in_work(args.base), in_work(args.out)
    need(base.is_dir(), 'local baseline directory required')
    need(out.parent == WORK and re.fullmatch(r'backend-prepare-[A-Za-z0-9][A-Za-z0-9_-]{0,79}', out.name),
         'output must be a direct WORK child named backend-prepare-*')
    need(not out.exists(), 'noReplay: output already exists; do not retry or overwrite')
    need(out not in base.parents and out != base, 'input/output overlap')
    nonce_path = in_work(args.owner_nonce_file)
    m = nonce_path.stat()
    need(m.st_uid == os.geteuid() and stat.S_IMODE(m.st_mode) == 0o600, 'nonce file must be private 0600')
    nonce = read(nonce_path).decode('utf8').rstrip('\n')
    need(16 <= len(nonce) <= 4096 and '\x00' not in nonce, 'owner nonce length/value')
    need(bool(args.reviewer_report) == bool(args.reviewer_sha256), 'report and explicit SHA256 required together')
    need(not args.seal or args.reviewer_report, '--seal requires an existing real independent reviewer report')
    reviewer = None
    if args.reviewer_report:
        p = in_work(args.reviewer_report)
        data = read(p)
        need(data.strip() and re.fullmatch(r'[a-f0-9]{64}', args.reviewer_sha256)
             and sha(data) == args.reviewer_sha256, 'reviewer report missing/empty/hash mismatch')
        reviewer = (p, data)
    raw = read(base / 'capture.json')
    cap = release.decode(raw)
    release.exact(cap, 'schema ownerTask scope nonce capturedAtUtc ttlSeconds controllerSha256 config '
                  'coordBase64 coordRecord protectedFiles processes transport protectionUnion '
                  'environmentValuesExported productionWrites canonicalMetadataSha256', 'CAPTURE_EXACT_SCHEMA')
    cfg = release.Config()
    need(cap['schema'] == 'customer-batch-capture-v1' and cap['ownerTask'] == release.OWNER
         and cap['scope'] == release.SCOPE and cap['controllerSha256'] == CONTROLLER_SHA
         and cap['config'] == release.config_binding(cfg)
         and re.fullmatch(r'[a-f0-9]{32}', cap['nonce'])
         and cap['environmentValuesExported'] is False and cap['productionWrites'] == 0,
         'fixed production capture binding required (object-only check)')
    release.fresh(cap)
    coord = release.unb64(cap['coordBase64'])
    need(sha(coord) == cap['coordRecord']['sha256'], 'raw coordinator hash mismatch')
    paths, links = release.union(cfg, release.coord_closed(coord))
    need(cap['protectionUnion'] == dict(paths=[str(p) for p in paths],
         links={str(a): str(t) for a, t in sorted(links.items())}), 'protection union mismatch')
    release.identity(cfg, cap['processes'])
    need(sha(release.encode(cap['protectedFiles'])) == cap['canonicalMetadataSha256'], 'capture metadata hash mismatch')
    blobs = {'capture.json': raw}
    def baseline(local, production):
        data = read(base / local)
        r = cap['protectedFiles'].get(str(production), {})
        need(r.get('kind') == 'file' and r.get('nlink') == 1 and r.get('sha256') == sha(data)
             and r.get('size') == len(data), 'fresh local baseline mismatch: ' + local)
        data.decode('utf8')
        blobs[local] = data
    baseline('admin-index.html', cfg.html)
    for kind, path in cfg.apis.items():
        baseline(kind + '-api.js', path)
    names = sorted(set(re.findall(rb'assets/BusinessWorkbenchPage-upload-manage-[a-f0-9]+\.js', blobs['admin-index.html'])))
    need(len(names) == 2, 'exactly two current upload-manage modules required')
    for name in names:
        name = name.decode('ascii')
        baseline(name, cfg.public / name)
        digest = re.search(r'-([a-f0-9]+)\.js$', name)[1]
        need(sha(blobs[name]).startswith(digest), 'immutable baseline filename hash mismatch')
    return base, out, nonce, cap, blobs, reviewer


def run(command, out, label, env_extra=None):
    # No inherited NODE_OPTIONS, ESBUILD_BINARY_PATH, PYTHONPATH or application secrets.
    env = {'PATH': '/usr/bin:/bin', 'LC_ALL': 'C.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}
    env.update(env_extra or {})
    result = subprocess.run(command, cwd=REPO, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=300, check=False)
    put(out / 'evidence' / (label + '.stdout.txt'), result.stdout)
    put(out / 'evidence' / (label + '.stderr.txt'), result.stderr)
    put_json(out / 'evidence' / (label + '.command.json'), dict(argv=command, returncode=result.returncode))
    need(result.returncode == 0, label + ' failed; partial output is not reusable')
    return result.stdout


def private_tree(out):
    for root, dirs, files in os.walk(out, followlinks=False):
        for p in [Path(root), *(Path(root) / n for n in dirs)]:
            s = no_link(p).lstat()
            need(stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid()
                 and stat.S_IMODE(s.st_mode) == 0o700, 'nonprivate output directory')
        for n in files:
            s = no_link(Path(root) / n).lstat()
            need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and s.st_uid == os.geteuid()
                 and stat.S_IMODE(s.st_mode) == 0o600, 'nonprivate output file')


def collect_sources(out, lock, sf, originals, backend_names, ui_names):
    """Use actual freeze provenance for backend and pinned original snapshots for UI/tools."""
    need(set(lock['sources']) == backend_names and set(sf['sourceHashes']) == ui_names, 'builder source inventory drift')
    need(sf.get('sourceStableDuringBuild') is True and sf.get('embeddedFailuresIncluded') is True
         and sf.get('compiler') == 'esbuild.transform', 'native source checks incomplete')
    need(Path(lock['inputRoot']) == out / 'backend-freeze-inputs', 'freeze inputRoot escaped')
    hashes, mapping, origins = {}, {}, {}
    for name in sorted(originals):
        original = REPO / name
        frozen = (out / 'backend-freeze-inputs' / 'source' / name if name in backend_names
                  else out / 'evidence' / 'source' / name)
        data = read(in_work(frozen))
        digest = sha(data)
        need(digest == originals[name] and sha(read(original)) == digest, 'original/frozen source drift: ' + name)
        if name in backend_names:
            need(lock['sources'][name] == dict(sha256=digest, bytes=len(data)), 'backend frozen hash/size mismatch')
        if name in ui_names:
            need(sf['sourceHashes'][name] == digest, 'UI compiled source hash mismatch')
        hashes[name], mapping[name] = digest, str(frozen)
        origins[name] = dict(original=str(original), frozen=str(frozen), sha256=digest,
                             provenance='backend freeze' if name in backend_names else 'original pre-build snapshot')
    need(sf['builderSha256'] == hashes[TOOLS[0]], 'native builder source SHA mismatch')
    need(lock['tools'] == dict(core=hashes[TOOLS[3]], builder=hashes[TOOLS[1]], test=hashes[TOOLS[2]]), 'backend tool hash mismatch')
    put_json(out / 'evidence' / 'source-provenance.json', origins)
    return hashes, mapping


def check_native(out, blobs, hashes, before, after, release):
    need(before == after and before.get('status') == 'LOCAL_SOURCE_ABI_CHECKED_NO_CAPTURE'
         and before.get('productionWrites') == 0 and before.get('embeddedFailuresChecked') is True
         and before.get('noUnboundNewIdentifiers') is True and before.get('noNewImports') is True,
         'original source compilation hash/check drift')
    ui = out / 'ui'
    leaves = release.decode(read(ui / 'package/evidence/sources.json'))
    expected = [{k: v[k] for k in ('name', 'native', 'sourceSha256', 'compiledSha256')} for v in leaves]
    need(before['leaves'] == expected, 'UI build compiled hashes differ from original source checks')
    for leaf in leaves:
        need(hashes.get(leaf['file']) == leaf['sourceSha256'], 'UI leaf source mismatch')
    for kind, path in release.Config().apis.items():
        records = read(out / 'backend-candidate' / (kind + '-patch-records.json'))
        release.native_api(records, blobs[kind + '-api.js'],
                           read(out / 'backend-candidate' / (kind + '-candidate.mjs')), path, hashes)
    modules = release.decode(read(ui / 'modules.json'))
    need(len(modules) == 2 and {m['before'] for m in modules} == {n for n in blobs if n.startswith('assets/')}, 'UI baseline module scope mismatch')
    for module in modules:
        release.rel(module['before']); release.rel(module['after'])
        need(module['after'].startswith('assets/'), 'UI output asset scope')
        release.ui_inverse(release.decode(read(ui / 'package/evidence' / (Path(module['before']).name + '.delta.json'))),
                           blobs[module['before']], read(ui / 'package' / module['after']))
    be = release.decode(read(out / 'backend-candidate/build-evidence.json'))
    need(be.get('nodeCheck') is True and be.get('nativeVmTestsPassed') is True
         and be.get('entrypointExecuted') is False and be.get('actualDatabaseAccess') is False
         and be['freezeSha256'] == sha(read(out / 'backend-freeze.json'))
         and be['nativeVmTestsSha256'] == sha(read(out / 'backend-candidate/vm-tests.json')), 'native backend evidence incomplete')
    return be


def check_backend_compilation(out, before, after, names, release):
    need(before == after and set(before) == names, 'original backend compiled hash drift')
    compiled = out / 'backend-candidate/compiled-source'
    for path in sorted(compiled.rglob('*.js')):
        name = path.relative_to(compiled).as_posix()[:-3]
        need(before.get(name) == sha(read(in_work(path))), 'frozen backend compiled hash mismatch')
    for kind in ('front', 'admin'):
        records = release.decode(read(out / 'backend-candidate' / (kind + '-patch-records.json')))
        for patch in records['patches']:
            source = patch['source']
            if 'compiledSha256' in source:
                need(before.get(source['sourceFile']) == source['compiledSha256'], 'API original compilation hash mismatch')


def prepare(args):
    old_umask = os.umask(0o077)
    try:
        release = load_release()
        base, out, nonce, cap, blobs, reviewer = inputs(args, release)
        backend_names, ui_names = source_names(read(HERE / 'backend-builder.cjs').decode(), read(HERE / 'build-native.mjs').decode())
        originals = {name: sha(read(REPO / name)) for name in sorted(backend_names | ui_names | set(TOOLS))}
        out.mkdir(mode=0o700)  # Atomic refusal if another preparer won; never resume/clean a partial run.
        for name, data in blobs.items():
            put(out / 'baseline' / name, data)
        for name in sorted(ui_names | set(TOOLS)):
            data = read(REPO / name)
            need(sha(data) == originals[name], 'source changed before snapshot')
            put(out / 'evidence/source' / name, data)
        native, backend = str(HERE / 'build-native.mjs'), str(HERE / 'backend-builder.cjs')
        before = release.decode(run([NODE, native, '--verify-sources'], out, 'native-before'))
        backend_before = release.decode(run([NODE, '-e', BACKEND_HASH_CHECK, backend, str(REPO)], out, 'backend-source-before'))
        freeze = out / 'backend-freeze.json'
        run([NODE, backend, 'freeze', '--freeze', str(freeze), '--repo', str(REPO), '--capture', str(out / 'baseline')], out, 'backend-freeze')
        run([NODE, backend, 'build', '--freeze', str(freeze), '--out', str(out / 'backend-candidate')], out, 'backend-build')
        run([NODE, native], out, 'native-build', dict(CUSTOMER_BATCH_BASE=str(out / 'baseline'), CUSTOMER_BATCH_OUT=str(out / 'ui')))
        after = release.decode(run([NODE, native, '--verify-sources'], out, 'native-after'))
        backend_after = release.decode(run([NODE, '-e', BACKEND_HASH_CHECK, backend, str(REPO)], out, 'backend-source-after'))
        lock = release.decode(read(freeze))
        sf = release.decode(read(out / 'ui/package/evidence/source-files.json'))
        hashes, sources = collect_sources(out, lock, sf, originals, backend_names, ui_names)
        be = check_native(out, blobs, hashes, before, after, release)
        check_backend_compilation(out, backend_before, backend_after, backend_names, release)
        evidence = {'evidence/backend-freeze.json': str(freeze)}
        for name, data in blobs.items():
            if name.startswith('assets/'):
                evidence['evidence/baseline/' + name] = str(out / 'baseline' / name)
        for name in ('build-evidence.json', 'vm-tests.json'):
            evidence['evidence/backend/' + name] = str(out / 'backend-candidate' / name)
        compiled = out / 'backend-candidate/compiled-source'
        for path in sorted(compiled.rglob('*')):
            if path.is_file():
                read(in_work(path))
                evidence['evidence/backend/compiled-source/' + path.relative_to(compiled).as_posix()] = str(path)
        if reviewer:
            need(read(reviewer[0]) == reviewer[1], 'external reviewer report drift')
            report = out / 'evidence/reviewer/independent-report.txt'
            put(report, reviewer[1])
            evidence['evidence/reviewer/independent-report.txt'] = str(report)
        put_json(out / 'evidence/local-preparation.json', dict(
            schema='customer-batch-local-preparation-v1', status='prepared-not-reviewed-not-approved',
            controllerSha256=CONTROLLER_SHA, captureSha256=sha(blobs['capture.json']),
            sourceHashes=hashes, originalSourceHashesStable=True, originalCompiledHashesStable=True,
            nativeSourceChecks=before, backendOriginalCompiledHashes=backend_before,
            backendChecks=be, reviewerReportSha256=sha(reviewer[1]) if reviewer else None,
            externalReviewerAuthenticityVerified=False, **FLAGS))
        for path in sorted((out / 'evidence').rglob('*')):
            if path.is_file() and 'source' not in path.relative_to(out / 'evidence').parts:
                name = path.relative_to(out).as_posix()
                need(name not in evidence or evidence[name] == str(path), 'evidence name collision')
                evidence[name] = str(path)
        spec = dict(schema='customer-batch-candidate-spec-v1', ownerTask=release.OWNER,
                    ownerNonce=nonce, capture=str(out / 'baseline/capture.json'), ui=str(out / 'ui'),
                    backend={kind: dict(before=str(out / 'baseline' / (kind + '-api.js')),
                             after=str(out / 'backend-candidate' / (kind + '-candidate.mjs')),
                             records=str(out / 'backend-candidate' / (kind + '-patch-records.json')))
                             for kind in ('front', 'admin')}, sources=sources, evidence=evidence)
        release.fresh(cap)
        spec_path = out / 'candidate-spec.json'
        put_json(spec_path, spec)
        private_tree(out)
        result = dict(status='prepared-not-sealed-not-approved', spec=str(spec_path), output=str(out),
                      independentReviewRequired=True, **FLAGS)
        if args.seal:
            release.fresh(cap)
            # The sole release.py operation permitted here. No production aliases are resolved.
            sealed = run([sys.executable, '-B', str(HERE / 'release.py'), 'candidate',
                          '--controller-sha256', CONTROLLER_SHA, '--spec', str(spec_path),
                          '--out', str(out / 'sealed-candidate')], out, 'candidate-seal')
            result['sealResult'] = release.decode(sealed)
            need(result['sealResult'].get('status') == 'candidate-sealed-not-approved', 'unexpected candidate result')
            result['status'] = 'candidate-sealed-not-approved'
            private_tree(out)
        put_json(out / 'prepare-result.json', result)
        return result
    finally:
        os.umask(old_umask)


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        result = prepare(args)
    except (Exception, KeyboardInterrupt) as exc:
        # Do not dump capture/nonce/environment or subprocess output to the terminal.
        print('PREPARE_ABORT: ' + (str(exc) if isinstance(exc, (PrepareError, OSError)) else type(exc).__name__), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.dont_write_bytecode = True
    sys.exit(main())
