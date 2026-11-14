#!/usr/bin/env python3
"""Five bounded prepare unit tests plus one actual read-only frontend mapping.
All written test artifacts in this directory are fixtures, never live evidence.
"""
import hashlib
import json
from pathlib import Path
import types

HERE = Path(__file__).resolve().parent
REPO = Path('/home/ubuntu/work/51dianzi-platform--manager')
P = Path('/home/ubuntu/work/channel-reference-phase2-20261114')
W = Path('/home/ubuntu/work/channel-reference-batch-299-20261114')
FILE = REPO / 'deploy/channel-reference-pricing-20261114/prepare-snapshot-package.py'
m = types.ModuleType('prepare_fixture_test_module')
m.__file__ = str(FILE)
exec(compile(FILE.read_bytes(), str(FILE), 'exec'), m.__dict__)
results = []

def test(name, fn):
    try:
        detail = fn()
        results.append({'name': name, 'status': 'PASS', 'detail': detail})
    except Exception as error:
        results.append({'name': name, 'status': 'FAIL', 'detail': str(error)})

def refused(fn, expected):
    try: fn()
    except RuntimeError as error:
        if expected not in str(error): raise AssertionError(str(error))
        return str(error)
    raise AssertionError('expected refusal')

def missing_formal():
    e = m.Inputs()
    return refused(lambda: e.descriptor({'path': str(HERE / 'MISSING-formal-snapshot.json'), 'sha256': '0' * 64}), 'MISSING_INPUT')

def old_helper():
    return refused(lambda: m.helper_contract([
        {'relative': 'channel-reference-service.mjs', 'sha256': '0' * 64},
        {'relative': 'channel-reference-worker.mjs', 'sha256': '0' * 64}]), 'OLD_WORKER_HELPER_REFUSED')

def source_mismatch():
    return refused(lambda: m.source_graph({'client/old.ts': '0' * 64},
        {'client/new.ts': '1' * 64}, {'client/new.ts': '2' * 64},
        {'server/channelReference/service.ts': '3' * 64},
        {'inputs': {'server/channelReference/service.ts': {}}}), 'SOURCE_GRAPH_MISMATCH')

def private_leak():
    s = {'schemaVersion': 1, 'collectionMode': 'public-web-batch', 'generatedAt': '2026-11-14T00:00:00.000Z',
         'records': [{'partNumber': 'TEST-ONLY', 'brand': 'TEST-ONLY', 'materialId': 1, 'references': {}, 'evidence': {}}]}
    return refused(lambda: m.public_shape(s), 'PRIVATE_JSON_LEAK')

def bookkeeping():
    # Deliberately small marked fixture, not 299-row data or a production package.
    e = m.Inputs()
    manifest = {'evidenceHashes': {'collection-receipt.json': ''},
                'files': [{'relative': 'index.html'}], 'backendFiles': [{'relative': 'api/admin-index.js'}],
                'standaloneHelpers': [{'relative': 'channel-reference-service.mjs'}, {'relative': 'channel-reference-snapshot.json'}],
                'sourceHashes': {'client/test.ts': ''}, 'baselineAssets': [{'relative': 'assets/old.js'}]}
    receipt = {'fixtureOnly': True, 'observations': [{'file': 'collection-evidence/TEST-ONLY.json'}]}
    expected = set(m.TOOL_NAMES) | {'collection-receipt.json', 'candidate/index.html', 'candidate/api/admin-index.js',
        'channel-reference-service.mjs', 'channel-reference-snapshot.json', 'source-snapshot/client/test.ts',
        'baseline/index.html', 'baseline/admin-index.js', 'baseline/assets/old.js', 'collection-evidence/TEST-ONLY.json'}
    assert m.package_paths(manifest, receipt) == expected
    for name in sorted(expected): e.add(name, b'TEST ONLY fixture bytes\n', evidence=name == 'collection-receipt.json')
    pins = {n: m.sha(v) for n,v in e.package.items()}
    assert set(pins) == expected and pins['collection-receipt.json'] == e.evidence['collection-receipt.json']
    e.package.pop('baseline/assets/old.js')
    assert set(e.package) != expected
    return {'exactPaths': len(expected), 'missingBaselineDetected': True, 'manifestExcluded': 'manifest.json' not in pins,
            'workerExcluded': 'channel-reference-worker.mjs' not in pins}

def actual_frontend():
    e = m.Inputs()
    d, driver = m.load_driver(e)
    names = {'frontendProof': 'frontend-proof.json', 'frontendParts': 'frontend-parts.json',
             'frontendInverse0': 'workbench-0-byteinverse.json', 'frontendInverse1': 'workbench-1-byteinverse.json',
             'htmlProof': 'html-build-proof.json', 'frontendNativeTests': 'native-tests.json',
             'frontendDependencies': 'static-dependencies.json'}
    raw = {key: e.read(P / 'frontend-candidate' / name) for key,name in names.items()}
    obj = {key: m.decode(v) for key,v in raw.items()}
    base = m.decode(e.read(W / 'baseline/live-baseline-current.json'))
    # Only the mapping's helper-binding field is given marked fixture bytes;
    # no full prepare/driver acceptance and no formal receipt are created.
    helpers = [{'relative': 'channel-reference-service.mjs', 'sha256': m.sha(b'fixtureOnly service')},
               {'relative': 'channel-reference-snapshot.json', 'sha256': m.sha(b'fixtureOnly snapshot')}]
    mapped, files, deps = m.frontend_mapping(e, d,
        {'frontendDir': P / 'frontend-candidate', 'baselineDir': W / 'baseline'}, raw, obj, helpers, base)
    assert len(files) == 3 and len(mapped['nativeProofEvidence']) == 2
    for name in mapped['nativeProofEvidence']:
        inverse=m.decode(e.package[name]); assert inverse['beforeUrl'] and inverse['url']
    e.cas()
    return {'actualFrontendFiles': len(files), 'actualInverseProofs': 2, 'dependencies': len(deps),
            'actualUTF16InverseChecked': True, 'fullPackageAccepted': False, 'helperBindingFixtureOnly': True,
            'driverSha256Observed': m.sha(driver)}

test('missing formal data refuses', missing_formal)
test('old worker helper refuses', old_helper)
test('source graph conflicting pin refuses', source_mismatch)
test('private JSON materialId leakage refuses', private_leak)
test('exact package graph bookkeeping', bookkeeping)
test('actual frontend native proof mapping and byte inverses (not full acceptance)', actual_frontend)
report = {'fixtureOnly': True, 'liveEvidence': False, 'productionActivationReady': False,
          'checks': results, 'passed': sum(r['status']=='PASS' for r in results),
          'failed': sum(r['status']=='FAIL' for r in results)}
(HERE / 'test-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
raise SystemExit(0 if report['failed']==0 else 1)
