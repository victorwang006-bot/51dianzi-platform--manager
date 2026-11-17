#!/usr/bin/env python3
"""Offline packaging only: never uploads, opens credentials, executes API code or writes app files.
All outputs are restricted to this script's packaging directory. Plans are explicit.
"""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import shutil

ROOT = Path(__file__).resolve().parent
WORK = ROOT.parent
SENSITIVE = re.compile(r"(^|/)(?:\.env(?:\.[^/]*)?|previous-protection\.json|protection\.json|runtime\.env|dump\.pm2|[^/]*\.(?:pem|key|p12|pfx)|credentials[^/]*|secrets?[^/]*)(?:/|$)", re.I)

def require(condition, message):
    if not condition:
        raise ValueError(message)

def H(data):
    return hashlib.sha256(data).hexdigest()

def input_path(value):
    p = Path(value)
    require(p.is_absolute() and '..' not in p.parts, 'absolute input without traversal required')
    require(not p.is_symlink(), 'symlink input forbidden')
    r = p.resolve()
    require(r.is_relative_to(WORK), 'input outside authorized work directory')
    require(not SENSITIVE.search(str(r)), 'credential/protection input forbidden')
    require(r.is_file(), 'input file missing')
    return r

def output_path(value):
    p = Path(value)
    require(p.is_absolute() and '..' not in p.parts, 'absolute output without traversal required')
    require(p.resolve().is_relative_to(ROOT), 'output outside packaging forbidden')
    require(not p.is_symlink() and not p.exists(), 'output exists or is symlink; no overwrite/relock')
    return p

def load(value):
    return json.loads(input_path(value).read_bytes())

def save(value, data):
    p = output_path(value)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    fd = os.open(p.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def save_json(value, data):
    save(value, (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode())

def freeze(plan_path, out):
    plan_bytes = input_path(plan_path).read_bytes()
    plan = json.loads(plan_bytes)
    require(plan.get('finalReady') is True, 'explicit finalReady required')
    root = output_path(out)
    require(plan.get('files'), 'explicit input files required')
    entries = []
    seen = set()
    for f in plan['files']:
        name = f['name']
        require(not Path(name).is_absolute() and '..' not in Path(name).parts and name not in seen, 'unique safe frozen name required')
        seen.add(name)
        original = input_path(f['path'])
        data = original.read_bytes()
        require(H(data) == f['sha256'], 'input SHA drift; no auto relock')
        entries.append((original, name, data))
    # Validation happens before creating any output. Record both originals and frozen copies.
    root.mkdir(mode=0o700)
    records = []
    for original, name, data in entries:
        dst = root / name
        save(dst, data)
        records.append({'originalPath': str(original), 'frozenPath': str(dst), 'sha256': H(data), 'bytes': len(data)})
    tool = Path(__file__).resolve()
    record = {'status': 'EXPLICIT_OFFLINE_INPUTS_FROZEN_NOT_DEPLOYED', 'noAutoRelock': True,
              'planSha256': H(plan_bytes), 'toolPath': str(tool), 'toolSha256': H(tool.read_bytes()), 'files': records}
    save_json(root / 'inputs.lock.json', record)
    return {'status': record['status'], 'lock': str(root / 'inputs.lock.json'), 'files': len(records)}

def verify(lock_path):
    lock = load(lock_path)
    require(lock.get('status') == 'EXPLICIT_OFFLINE_INPUTS_FROZEN_NOT_DEPLOYED', 'lock status')
    require(H(input_path(lock['toolPath']).read_bytes()) == lock['toolSha256'], 'tool drift')
    for f in lock['files']:
        for key in ['originalPath', 'frozenPath']:
            require(H(input_path(f[key]).read_bytes()) == f['sha256'], 'source/frozen drift; archive and review a new freeze, never relock')
    return {'status': 'OFFLINE_FREEZE_VERIFIED', 'files': len(lock['files'])}

def normalize(delta, baseline):
    require(delta.get('beforeSha256', delta.get('baselineSha256')) == H(baseline), 'delta baseline SHA mismatch')
    out = []
    for q in delta.get('patches', delta.get('hunks', [])):
        # No ambiguous JS UTF16 index -> byte conversion. Agents must normalize first.
        if 'oldByteStart' in q:
            start, end = q['oldByteStart'], q['oldByteEnd']
        else:
            require('byteStart' in q, 'explicit byte offsets required; do not treat JS start/end as bytes')
            start, end = q['byteStart'], q['byteEnd']
        old = base64.b64decode(q['oldBase64'], validate=True)
        new = base64.b64decode(q['newBase64'], validate=True)
        require(isinstance(start, int) and isinstance(end, int) and 0 <= start <= end <= len(baseline), 'invalid byte range')
        require(baseline[start:end] == old, 'exact hunk preimage mismatch')
        out.append({'oldByteStart': start, 'oldByteEnd': end, 'oldBase64': q['oldBase64'],
                    'newBase64': q['newBase64'], 'reason': q.get('reason', 'reviewed explicit patch')})
    require(out, 'empty patch manifest forbidden')
    return out

def apply_bytes(baseline, patches):
    patches = sorted(patches, key=lambda p: (p['oldByteStart'], p['oldByteEnd']))
    shift = 0
    previous = None
    for q in patches:
        start, end = q['oldByteStart'], q['oldByteEnd']
        if previous:
            require(start >= previous['oldByteEnd'] and start != previous['oldByteStart'], 'overlap or ambiguous same-anchor insertion')
        new = base64.b64decode(q['newBase64'], validate=True)
        q['newByteStart'] = start + shift
        q['newByteEnd'] = q['newByteStart'] + len(new)
        shift += len(new) - (end - start)
        previous = q
    result = baseline
    for q in reversed(patches):
        result = result[:q['oldByteStart']] + base64.b64decode(q['newBase64'], validate=True) + result[q['oldByteEnd']:]
    inverse = result
    for q in reversed(patches):
        require(inverse[q['newByteStart']:q['newByteEnd']] == base64.b64decode(q['newBase64'], validate=True), 'inverse postimage mismatch')
        inverse = inverse[:q['newByteStart']] + base64.b64decode(q['oldBase64'], validate=True) + inverse[q['newByteEnd']:]
    require(inverse == baseline, 'entire byte inverse failed')
    return result, patches

def syntax(data):
    # Parses stdin as an ES module without importing/evaluating it or opening its dependencies.
    node = shutil.which('node')
    require(node is not None, 'Node executable unavailable')
    r = subprocess.run([node, '--input-type=module', '--check'], input=data, capture_output=True,
                       env={'PATH': '/usr/local/bin:/usr/bin:/bin'}, timeout=30)
    require(r.returncode == 0, 'candidate ES module syntax failed (API was not executed)')

def merge(plan_path):
    plan = load(plan_path)
    require(plan.get('units'), 'explicit merge units required')
    pending = []
    outputs = set()
    for unit in plan['units']:
        base = input_path(unit['base'])
        baseline = base.read_bytes()
        require(H(baseline) == unit['expectedSha256'], 'current baseline SHA drift')
        output = output_path(unit['output'])
        require(str(output) not in outputs, 'duplicate output')
        outputs.add(str(output))
        output_path(str(output) + '.delta.json')
        patches = []
        for name in unit['patchManifests']:
            patches.extend(normalize(load(name), baseline))
        result, patches = apply_bytes(baseline, patches)
        require('expectedAfterSha256' not in unit or H(result) == unit['expectedAfterSha256'], 'reviewed candidate SHA mismatch')
        syntax(result)
        record = {'status': 'LOCAL_BYTE_CANDIDATE_NOT_DEPLOYED', 'base': str(base), 'output': str(output),
                  'beforeSha256': H(baseline), 'afterSha256': H(result), 'inverseVerified': True,
                  'allOutsidePatchBytesPreserved': True, 'patches': patches}
        pending.append((output, result, record))
    for output, result, record in pending:
        save(output, result)
        save_json(str(output) + '.delta.json', record)
    return {'status': 'OFFLINE_MERGED_NOT_DEPLOYED', 'outputs': [{'path': str(p), 'sha256': H(b)} for p, b, _ in pending]}

def rebuild_html(plan_path):
    p = load(plan_path)
    baseline = input_path(p['base']).read_bytes()
    require(H(baseline) == p['expectedSha256'], 'HTML baseline SHA drift')
    output_path(p['output'])
    output_path(p['output'] + '.proof.json')
    spans = list(re.finditer(rb'<script\b[^>]*\btype=[\"\']importmap[\"\'][^>]*>([\s\S]*?)</script>', baseline))
    require(len(spans) == 1, 'one effective importmap required')
    span = spans[0]
    old = json.loads(span[1])
    rewrites = p['rewrites']
    require(len(rewrites) == 2 and all('BusinessWorkbenchPage' in k for k in rewrites), 'exact two current Workbench URLs required')
    require(all(k.startswith('/assets/') and v.startswith('/assets/') and k != v for k, v in rewrites.items()), 'asset URL scope')
    new = json.loads(json.dumps(old))
    counts = {k: 0 for k in rewrites}
    for table in [new.get('imports', {}), *new.get('scopes', {}).values()]:
        for k, value in list(table.items()):
            if value in rewrites:
                table[k] = rewrites[value]
                counts[value] += 1
    require(all(counts.values()), 'both current workbench URLs must be effective mapping values')
    # Preserve old scopes and copy each original effective longest-prefix scope to new URL.
    for original, replacement in rewrites.items():
        scope = max((s for s in old.get('scopes', {}) if original.startswith(s)), key=len, default=None)
        if scope:
            require(replacement not in new.setdefault('scopes', {}), 'new scope collision')
            new['scopes'][replacement] = {k: rewrites.get(v, v) for k, v in old['scopes'][scope].items()}
    raw = json.dumps(new, ensure_ascii=False, separators=(',', ':')).encode()
    result = baseline[:span.start(1)] + raw + baseline[span.end(1):]
    stylesheet = p.get('stylesheet')
    if stylesheet:
        css = input_path(stylesheet['local']).read_bytes()
        require(H(css) == stylesheet['sha256'], 'CSS candidate SHA drift')
        url = stylesheet['url']
        require(url == '/assets/' + Path(stylesheet['local']).name and re.fullmatch(r'/assets/crm-sales-order-delta-[a-f0-9]{16}\.css', url), 'exact content-addressed scoped CRM CSS URL')
        require(stylesheet.get('deltaOnly') is True and stylesheet.get('selectorsScoped') is True, 'scoped delta stylesheet required')
        require(b'data-crm-sales-order-delta' not in baseline and result.count(b'</head>') == 1, 'one head and no prior delta link')
        link = f'<link rel="stylesheet" href="{url}" data-crm-sales-order-delta="1">\n'.encode()
        result = result.replace(b'</head>', link + b'</head>', 1)
    if p.get('expectedAfterSha256'):
        require(H(result) == p['expectedAfterSha256'], 'HTML candidate SHA mismatch')
    proof = {'status': 'LOCAL_IMPORTMAP_CANDIDATE_NOT_DEPLOYED', 'beforeSha256': H(baseline), 'afterSha256': H(result),
             'rewrites': rewrites, 'mappingCounts': counts, 'originalImportCount': len(old.get('imports', {})),
             'originalScopeCount': len(old.get('scopes', {})), 'finalScopeCount': len(new.get('scopes', {})),
             'existingKeysAndUnrelatedValuesPreserved': True, 'htmlOutsideImportmapAndOptionalScopedLinkBytesPreserved': True,
             'htmlOutsideImportmapBytesPreserved': not bool(stylesheet), 'stylesheet': stylesheet,
             'copiedOriginalEffectiveLongestPrefixScopes': True}
    save(p['output'], result)
    save_json(p['output'] + '.proof.json', proof)
    return proof

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest='mode', required=True)
    p = sub.add_parser('freeze'); p.add_argument('--plan', required=True); p.add_argument('--out', required=True)
    p = sub.add_parser('verify'); p.add_argument('--lock', required=True)
    p = sub.add_parser('merge'); p.add_argument('--plan', required=True)
    p = sub.add_parser('html'); p.add_argument('--plan', required=True)
    a = ap.parse_args()
    if a.mode == 'freeze': result = freeze(a.plan, a.out)
    elif a.mode == 'verify': result = verify(a.lock)
    elif a.mode == 'merge': result = merge(a.plan)
    else: result = rebuild_html(a.plan)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        # Never print API bytes or complete input objects.
        print(json.dumps({'status': 'OFFLINE_FAILED_CLOSED', 'reason': str(e)}, ensure_ascii=False))
        raise SystemExit(1)
