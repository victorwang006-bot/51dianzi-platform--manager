#!/usr/bin/env python3
"""Offline source audit only; no production reads or executable native sources."""
import ast
import difflib
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).absolute().parent.parent
EVIDENCE = ROOT / 'evidence'
BASE = EVIDENCE / 'r7-baseline'
NAMES = ('release.py', 'test_release.py', 'prepare-local.py', 'test_prepare_local.py', 'README.md', 'prepare-local.README.md')
OLD_SCOPE = 'customer-batch-actions-20261120-6Lfttf6o-R6'
NEW_SCOPE = 'customer-batch-actions-20261120-6Lfttf6o-R7'
OLD_H = 'fbb5302cf59974433d9775de3e0ee5e788eb58ec13916fa5101655d2badb7348'

def h(data):
    return hashlib.sha256(data).hexdigest()

def put(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, ensure_ascii=True, indent=2, sort_keys=True) + '\n')

def dump(node):
    return ast.dump(node, include_attributes=False)

def tree(path):
    text = path.read_text()
    return text, ast.parse(text)

def nodes(t):
    out = {}
    for i, n in enumerate(t.body):
        if isinstance(n, (ast.FunctionDef, ast.ClassDef)):
            key = n.name
        elif isinstance(n, ast.Assign):
            key = ','.join(dump(v) for v in n.targets)
        else:
            key = dump(n)
        assert key not in out
        out[key] = n
    return out

def source(text, n):
    return ''.join(text.splitlines(keepends=True)[n.lineno-1:n.end_lineno]).encode()

old, ot = tree(BASE/'release.py'); new, nt = tree(ROOT/'release.py')
assert h(old.encode()) == OLD_H
compile(new, str(ROOT/'release.py'), 'exec')
a, b = nodes(ot), nodes(nt)
changed = [k for k in a if k in b and dump(a[k]) != dump(b[k])]
added = [k for k in b if k not in a]
deleted = [k for k in a if k not in b]
assert set(changed) == {"Name(id='SCOPE', ctx=Store())", 'dynamic_read', 'dynamic_source'}
assert set(added) == {"Name(id='DYNAMIC_FIXED_NATIVE_SOURCE_PINS', ctx=Store())", 'dynamic_native_stat_meta', 'dynamic_native_source_meta'}
assert not deleted
preserved = {}
for name in ('Controller', 'Config', 'cas', 'inventory', 'union', 'RPC', 'PM2_GENERATION_PINS',
             'dynamic_maps', 'dynamic_kernel_mappings', 'dynamic_protection_sample',
             'dynamic_protection', 'dynamic_owned', 'transport', 'pm2_publish_ready'):
    key = name if name in a else f"Name(id='{name}', ctx=Store())"
    x, y = source(old, a[key]), source(new, b[key])
    assert x == y, name
    preserved[name] = {'byteIdentical': True, 'sha256': h(x), 'bytes': len(x)}
methods = [n.name for n in a['Controller'].body if isinstance(n, ast.FunctionDef)]
assert len(methods) == 30
old_read = next(n for n in ast.walk(a['dynamic_read']) if isinstance(n, ast.If) and isinstance(n.test, ast.Name) and n.test.id == 'source')
new_read = next(n for n in ast.walk(b['dynamic_read']) if isinstance(n, ast.If) and isinstance(n.test, ast.Name) and n.test.id == 'source')
assert [dump(n) for n in old_read.body] == [dump(n) for n in new_read.body[0].orelse]
old_source_gate = next(n for n in a['dynamic_source'].body if isinstance(n, ast.Expr))
new_source_gate = next(n for n in b['dynamic_source'].body if isinstance(n, ast.If))
assert dump(old_source_gate) == dump(new_source_gate.orelse[0])
# Pin constant is literal paths and literal numeric/digest values; no data loader.
pin_node = b["Name(id='DYNAMIC_FIXED_NATIVE_SOURCE_PINS', ctx=Store())"].value
fixed = {}
assert isinstance(pin_node, ast.Dict)
for key, value in zip(pin_node.keys, pin_node.values):
    assert isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == 'dict' and not value.args
    fixed[ast.literal_eval(key)] = {k.arg: ast.literal_eval(k.value) for k in value.keywords}
manifest = json.loads((EVIDENCE/'r7-native-source-pin-manifest.json').read_text())
expected = {}
for f in manifest['files']:
    assert re.fullmatch('[a-f0-9]{64}', f['sha256']) and re.fullmatch('[a-f0-9]{64}', f['packageSha256'])
    expected[f['path']] = dict(dev=f['dev'], ino=f['ino'], statmode=f['mode'], uid=f['uid'], gid=f['gid'], nlink=f['nlink'], size=f['bytes'], sha256=f['sha256'])
assert fixed == expected and len(fixed) == 2
assert all(v['nlink'] == 86 and v['statmode'] == 33188 and v['uid'] == v['gid'] == 0 for v in fixed.values())
assert all(not p.endswith('package.json') for p in fixed)
po, pot = tree(BASE/'prepare-local.py'); pn, pnt = tree(ROOT/'prepare-local.py')
pa, pb = nodes(pot), nodes(pnt)
assert set(pa) == set(pb)
pchanged = [k for k in pa if dump(pa[k]) != dump(pb[k])]
assert pchanged == ["Name(id='CONTROLLER_SHA', ctx=Store())"]
assert ast.literal_eval(pb[pchanged[0]].value) == h(new.encode())
compile(pn, str(ROOT/'prepare-local.py'), 'exec')

def test_methods(t, text):
    out = {}
    for c in t.body:
        if isinstance(c, ast.ClassDef):
            for n in c.body:
                if isinstance(n, ast.FunctionDef) and n.name.startswith('test_'):
                    out[c.name + '.' + n.name] = source(text, n)
    return out

old_test_changes = []; test_inventory = {}
for file in ('test_release.py', 'test_prepare_local.py'):
    x, xt = tree(BASE/file); y, yt = tree(ROOT/file)
    compile(y, str(ROOT/file), 'exec')
    xm, ym = test_methods(xt, x), test_methods(yt, y)
    assert set(xm) <= set(ym)
    normalized_changes = []
    for key, data in xm.items():
        normalized = data.replace(OLD_SCOPE.encode(), NEW_SCOPE.encode())
        assert ym[key] == normalized, (file, key)
        if ym[key] != data:
            normalized_changes.append(key)
    old_test_changes.extend(file + ':' + k for k in normalized_changes)
    test_inventory[file] = dict(originalMethods=len(xm), currentMethods=len(ym), addedMethods=sorted(set(ym)-set(xm)), deletedMethods=[], oldMethodsByteIdenticalExceptScopeLiteral=normalized_changes)
assert len(old_test_changes) == 3
assert test_inventory['test_release.py']['originalMethods'] == 246
assert test_inventory['test_prepare_local.py']['originalMethods'] == 40
put('r7-ast-diff.json', dict(changedTopLevel=changed, addedTopLevel=added, deletedTopLevel=deleted,
    preparerChangedTopLevel=pchanged, bytePreserved=preserved, controllerMethods=methods,
    ordinarySingleSourceTypeBranchASTIdentical=True, ordinarySingleSourceReadGateASTIdentical=True,
    oldTestsChangedOnlyThreeScopeAssertionMethods=old_test_changes, testInventory=test_inventory))

files = {}
diffs = []
for name in NAMES:
    before, after = (BASE/name).read_bytes(), (ROOT/name).read_bytes()
    files[name] = dict(baselineSha256=h(before), baselineBytes=len(before), currentSha256=h(after), currentBytes=len(after))
    diffs.extend(difflib.unified_diff(before.decode().splitlines(keepends=True), after.decode().splitlines(keepends=True), fromfile='r7-baseline/'+name, tofile=name))
(EVIDENCE/'r7-diff.patch').write_text(''.join(diffs))
(EVIDENCE/'r7-release.diff').write_text(''.join(difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True), fromfile='fbb530/release.py', tofile='r7/release.py')))
log_names = ('r7-release-tests.txt', 'r7-prepare-tests.txt', 'r7-finite-tests.txt', 'r7-r6-kernel-tests.txt', 'r7-native-tests.txt')
logs = {}
for name in log_names:
    raw = (EVIDENCE/name).read_bytes(); text = raw.decode()
    m = re.search(r'Ran (\d+) tests in ([0-9.]+)s\n\nOK\s*$', text)
    assert m, name
    logs[name] = dict(sha256=h(raw), tests=int(m[1]), seconds=float(m[2]), passed=True)
assert [logs[n]['tests'] for n in log_names] == [276, 42, 6, 34, 30]
put('r7-source-safety.json', dict(status='SOURCE_TYPE_FIX_NOT_APPROVED', controllerSha256=h(new.encode()),
    oldControllerSha256=OLD_H, scope=NEW_SCOPE, owner='6Lfttf6oVWJ8YS69o5FkXQ', files=files, logs=logs,
    sourcePinConstantExactMachineObservation=True, fixedNativePaths=sorted(fixed),
    fixedNativeMetaKeys=['dev','ino','statmode','uid','gid','nlink','size'],
    readRaceComparedFields=['dev','ino','statmode','uid','gid','nlink','size','mtimeNs','ctimeNs'],
    directSourceReadFullHashAndELFBeforeReturn=True, fullPathMetaBeforeAndAfter=True,
    unknownHardlinkDefaultReject=True, knownSingleCloneReject=True, noGenericHardlinkExemption=True,
    packageMetadataIsSourceExemption=False, controllerClassBytesUnchanged=True, controllerMethodsUnchanged=30,
    configClassBytesUnchanged=True, pm2GenerationPinsUnchanged=9,
    actualProcRead=False, actualCaptureExecuted=False, productionReads=0, productionWrites=0,
    nodeExecuted=False, nativeLibraryLoaded=False, databaseAccess=False, networkAccess=False,
    actualReloadExecuted=False, pubExecuted=False, actualAttemptWritten=False, oldR6StageTouched=False,
    kernelMappingPolicyUnchanged=True, timersOrBudgetsOrCLIOptionsAdded=False,
    allAliasNamespaceScanned=False, atomicKernelCASClaim=False, continuousFreezeClaim=False,
    controllerApproved=False, releaseApproved=False, finalDeployApproval=False, reloadApproved=False,
    pending=['actual R7 fresh capture/fullMETA', 'unknown JS/source graph review', 'Typed/retained witness and sixReady', 'new full package and independent approval']))
# A machine-written fixture source JSON proves full metadata shape without native bytes.
sys.path.insert(0, str(ROOT))
import test_release
case = test_release.R7NativeSourceTests('test_known_exact_two_link_whole_file_and_full_meta_source_json')
case.setUp()
try:
    result = case.collect()
    put('r7-synthetic-source-json.json', dict(status='TEMP_ONLY_SYNTHETIC_SOURCE_RECORDS_NOT_CAPTURE',
        fullSourceMeta={str(p): result['fullSourceMeta'][str(p)] for p in case.native_paths},
        sources={str(p): result['sources'][str(p)] for p in case.native_paths}, nativeBytesCopied=False,
        fixtureOnly=True, sourceGraphReviewRequired=result['sourceGraphReviewRequired'], semanticsClosed=result['semanticsClosed']))
finally:
    case.doCleanups()
print(json.dumps(dict(status='SOURCE_TYPE_FIX_NOT_APPROVED', controllerSha256=h(new.encode()),
    controllerMethods=30, generationPins=9, testCounts=[276,42,6], r6KernelTests=34,
    r7NativeTests=30, oldTestsRetained=True, changedOldTestMethods=3), sort_keys=True))
