#!/usr/bin/env python3
"""Local evidence only: snapshot old source and compare AST/file boundaries; no release CLI."""
import ast
import difflib
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / 'evidence'
ALLOWED = {'release.py', 'test_release.py', 'prepare-local.py', 'test_prepare_local.py',
           'README.md', 'prepare-local.README.md'}
OLD_SHA = '7fc9ec42ce21f6d0167b36ffbbe7642865a16f70fc31f8b99bf0da4862598423'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def write_new(path, data):
    with path.open('xb') as f:
        f.write(data)

def encoded(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + '\n').encode()

def nodes(text):
    result = {}
    other = 0
    for node in ast.parse(text).body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            key = node.name
        elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            key = node.targets[0].id
        else:
            key = 'other-' + str(other)
            other += 1
        assert key not in result
        result[key] = ast.dump(node, include_attributes=False)
    return result

def tests(text):
    return {c.name + '.' + n.name: ast.dump(n, include_attributes=False)
            for c in ast.parse(text).body if isinstance(c, ast.ClassDef)
            for n in c.body if isinstance(n, ast.FunctionDef) and n.name.startswith('test_')}

if sys.argv[1:] == ['before']:
    assert sha((ROOT / 'release.py').read_bytes()) == OLD_SHA
    files = {p.relative_to(ROOT).as_posix(): sha(p.read_bytes())
             for p in ROOT.rglob('*') if p.is_file() and not p.name.startswith('r2-')}
    source = {n: (ROOT / n).read_text() for n in sorted(ALLOWED)}
    write_new(EVIDENCE / 'r2-before.json', encoded({'files': files, 'source': source}))
    print('OLD_CONTROLLER_SHA_CONFIRMED', OLD_SHA)
elif sys.argv[1:] == ['after']:
    old = json.loads((EVIDENCE / 'r2-before.json').read_bytes())
    changed = sorted(n for n, h in old['files'].items() if sha((ROOT / n).read_bytes()) != h)
    assert set(changed) == ALLOWED, changed
    current = {n: (ROOT / n).read_text() for n in ALLOWED}
    old_nodes, new_nodes = nodes(old['source']['release.py']), nodes(current['release.py'])
    changed_nodes = sorted(k for k in old_nodes if old_nodes[k] != new_nodes.get(k))
    added_nodes = sorted(set(new_nodes) - set(old_nodes))
    assert changed_nodes == ['SCOPE', 'transport'], changed_nodes
    assert added_nodes == ['adapter_files'], added_nodes
    assert set(old_nodes) <= set(new_nodes)
    assert ast.literal_eval(next(n.value for n in ast.parse(current['release.py']).body
                                if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
                                and n.targets[0].id == 'SCOPE')) == 'customer-batch-actions-20261120-6Lfttf6o-R2'
    assert old_nodes['RPC'] == new_nodes['RPC']
    old_transport = next(n for n in ast.parse(old['source']['release.py']).body
                         if isinstance(n, ast.FunctionDef) and n.name == 'transport')
    new_transport = next(n for n in ast.parse(current['release.py']).body
                         if isinstance(n, ast.FunctionDef) and n.name == 'transport')
    dump = lambda n: ast.dump(n, include_attributes=False)
    # Existing socket, daemon, resolve-only invocation, pins reader and Node
    # cluster-source probe are unchanged, not just the other functions.
    for old_i, new_i in [(i, i) for i in range(7)] + [(8, 8), (9, 9), (10, 10), (11, 11),
                                                   (13, 14), (14, 16), (15, 17)]:
        assert dump(old_transport.body[old_i]) == dump(new_transport.body[new_i])
    assert all(dump(a) == dump(b) for a, b in zip(old_transport.body[7].value.elts[:3],
                                                 new_transport.body[7].value.elts[:3]))
    assert len(new_transport.body[7].value.elts) == 4
    final = new_transport.body[-1]
    assert [k.arg for k in final.value.keywords].count('fullAdapterMeta') == 1
    final.value.keywords = [k for k in final.value.keywords if k.arg != 'fullAdapterMeta']
    assert dump(final) == dump(old_transport.body[-1])
    old_prepare, new_prepare = nodes(old['source']['prepare-local.py']), nodes(current['prepare-local.py'])
    assert sorted(k for k in old_prepare if old_prepare[k] != new_prepare.get(k)) == ['CONTROLLER_SHA']
    assert set(old_prepare) == set(new_prepare)
    new_sha = sha(current['release.py'].encode())
    assert "CONTROLLER_SHA = '" + new_sha + "'" in current['prepare-local.py']
    test_report = {}
    for filename, expected in [('test_release.py', 43), ('test_prepare_local.py', 27)]:
        prior, latest = tests(old['source'][filename]), tests(current[filename])
        assert len(prior) == expected, (filename, len(prior))
        assert set(prior) <= set(latest)
        modified_tests = sorted(n for n in prior if prior[n] != latest[n])
        if filename == 'test_release.py':
            assert modified_tests == ['SafetyTests.test_new_identity_and_fixed_boundary']
            before = prior[modified_tests[0]].replace('customer-batch-actions-20261120-6Lfttf6o',
                                                    'customer-batch-actions-20261120-6Lfttf6o-R2')
            assert before == latest[modified_tests[0]]
        else:
            assert not modified_tests
        test_report[filename] = {'originalTests': len(prior), 'originalTestsRetained': True,
                                 'modifiedOriginalTests': modified_tests,
                                 'newTests': sorted(set(latest) - set(prior)), 'totalTests': len(latest)}
    for filename in ('release.py', 'test_release.py', 'prepare-local.py', 'test_prepare_local.py', 'evidence/r2-audit.py'):
        compile((ROOT/filename).read_bytes(), str(ROOT/filename), 'exec')
    assert not list(ROOT.rglob('__pycache__'))
    source_dir = Path('/home/ubuntu/work/customer-batch/adapter-source')
    proof = {}
    for filename, size, digest in [
        ('package.json', 3718, 'f2819cffb2aae16bb813596575410877570a253be11949260caa33c8038788d6'),
        ('modules__pm2-axon__index.js', 36, '564748a7a82ddd5cf0e2fbc4204556d1b5078ceea2eba651fb183f8e2c43f4ab'),
        ('modules__pm2-axon-rpc__index.js', 84, 'f5177ff52b4950dc70c5957b677909d34d2bcd9aca797a1a72244d92a4bfb656')]:
        data = (source_dir/filename).read_bytes()
        assert len(data) == size and sha(data) == digest
        proof[filename] = {'localPath': str(source_dir/filename), 'size': size, 'sha256': digest,
                           'source': 'parent-provided readonly production evidence; locally hash-checked only'}
    write_new(EVIDENCE / 'r2-static-checks.json', encoded({
        'status': 'offline-static-checks-passed-not-approved', 'memoryCompilePassed': True,
        'pycacheCreated': False, 'rpcConstantUnchanged': True,
        'transportNonPinSocketDaemonResolveNodeClusterStatementsUnchanged': True,
        'nodeGodDaemonSourcesUnchanged': True, 'parentProvidedSourceProof': proof,
        'vendorLibSourcesAvailableLocally': False, 'dynamicExternalDependencyAuditPassed': False,
        'captureExecuted': False, 'realRpcExecuted': False, 'productionAccess': False}))
    diff = ''.join(difflib.unified_diff(old['source']['release.py'].splitlines(True),
                                     current['release.py'].splitlines(True),
                                     fromfile='release.py@' + OLD_SHA, tofile='release.py@' + new_sha))
    write_new(EVIDENCE / 'r2-controller.diff', diff.encode())
    all_diff = ''.join(''.join(difflib.unified_diff(old['source'][n].splitlines(True), current[n].splitlines(True),
                    fromfile=n+'@before', tofile=n+'@R2')) for n in sorted(ALLOWED))
    write_new(EVIDENCE / 'r2-allowed-files.diff', all_diff.encode())
    result = {'schema': 'customer-batch-r2-local-delta-audit-v1', 'status': 'locally-checked-not-independent-not-approved',
              'oldControllerSha256': OLD_SHA, 'controllerSha256': new_sha,
              'changedExistingFiles': changed, 'newTopLevelNodes': added_nodes,
              'changedTopLevelNodes': changed_nodes,
              'unchangedControllerAstNodes': sorted(set(old_nodes) - set(changed_nodes)),
              'rpcAstByteConstantUnchanged': True, 'configAstUnchangedExceptDerivedScopeStage': True,
              'pm2BaseFullInventoryAstUnchanged': True, 'preparerOnlyControllerPinChanged': True,
              'transportNonPinSocketDaemonResolveNodeClusterStatementsUnchanged': True,
              'tests': test_report,
              'filesSha256': {n: sha((ROOT/n).read_bytes()) for n in sorted(ALLOWED)},
              'unchangedExistingFilesSha256': {n: h for n, h in old['files'].items() if n not in ALLOWED},
              'productionAccess': False, 'captureCliExecuted': False, 'preflightCliExecuted': False,
              'applyCliExecuted': False, 'gitSshMcpUsed': False, 'independentReviewPassed': False,
              'realReadonlyCapturePassed': False, 'approved': False}
    write_new(EVIDENCE / 'r2-source-and-safety.json', encoded(result))
    print(json.dumps({'controllerSha256': new_sha, 'changedNodes': changed_nodes,
                      'newNodes': added_nodes, 'tests': test_report}, ensure_ascii=False, indent=2))
else:
    raise SystemExit('expected before or after')
