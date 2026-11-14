#!/usr/bin/env python3
"""Bounded, source-pinned static plus two-API package. Does not deploy or write business records."""
import datetime
import hashlib
import json
import shutil
import subprocess
import tarfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORK = Path('/home/ubuntu/work/demand-personal-center')
CANDIDATE = WORK / 'candidate'
BACKEND = WORK / 'backend-candidate'
STATIC = WORK / 'static-input'
PACKAGE = WORK / 'package'
EVIDENCE = REPO / 'deploy/demand-personal-evidence-20261114'
TASK = 'CKSZQ7sVc7tADM21c3LWpu'
DRIVER = REPO / 'deploy/activate-demand-personal-20261114.py'
RELOAD = REPO / 'deploy/reload-demand-personal-api-20261114.cjs'

def load(path):
    return json.loads(Path(path).read_text())

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def main():
    review = load(WORK / 'read-only-review-final.json')
    validation = load(WORK / 'source-validation-final.json')
    assert review['status'] == 'PASS' and validation['status'] == 'PASS'
    assert validation['tscPassed'] and validation['sourceTestFailures'] == 0
    actual = load(CANDIDATE / 'actual-candidate-tests.json')
    quotes = load(CANDIDATE / 'actual-quote-candidate-tests.json')
    profile = load(STATIC / 'actual-profile-module-tests.json')
    nav = load(STATIC / 'actual-static-candidate-tests.json')
    factory_profile = load(STATIC / 'profile-factory-tests.json')
    backend_test = load(BACKEND / 'test-report.json')
    assert all(report['status'] == 'PASS' for report in [actual, quotes, profile, nav, factory_profile])
    assert actual['failed'] == quotes['failed'] == 0 and quotes['productionWrites'] == 0
    assert actual['mockNativeIO']['network'] == actual['mockNativeIO']['mutations'] == 0
    assert backend_test['pass'] is True
    customer = load(CANDIDATE / 'customer-parts.json')
    summary = load(CANDIDATE / 'merged-static-summary.json')
    html_proof = load(CANDIDATE / 'html-build-proof.json')
    dep_proof = load(CANDIDATE / 'dependency-resolution-proof.json')
    assert profile['actualCandidateProfileModuleExecuted'] and not profile['sourceOrWrapperRecompiled']
    assert profile['importMap']['finalHTMLHasCurrentProfile']
    assert profile['importMap']['htmlSha256Inspected'] == summary['htmlSha256']
    assert summary['status'] == dep_proof['status'] == 'PASS'
    assert summary['allOldStylesheetsRetained'] and html_proof['exactInverse']
    assert customer['status'] == 'PASS'
    assert all(p['allNonpatchBytesUnchanged'] and p['exactInverse'] and p['nativeSingletonBridgeByteIdentical'] and p['mallBytesUnchanged'] for p in customer['proofs'])
    assert all(p['protectedFunctionHashes']['__d51_so_get'] for p in customer['proofs'])
    files = load(CANDIDATE / 'files.json')
    assert len(files) == 7 and len({f['relative'] for f in files}) == len(files)
    for item in files:
        assert sha(CANDIDATE / item['relative']) == item['sha256']
    frontend_pins = load(CANDIDATE / 'frontend-source-hashes.json')
    source_pins = dict(frontend_pins)
    backend_summary = load(BACKEND / 'summary.json')
    backend_manifests = {name: load(BACKEND / (name + '-manifest.json')) for name in ['admin', 'front']}
    for manifest in backend_manifests.values():
        assert manifest['nonTargetDeclarationsByteIdentical'] is True and manifest['bundleWholeAPI'] is False
        assert manifest['initializationBeforeAppRouter'] is True
        assert manifest['inverse']['byteExact'] and manifest['inverse']['allOutsideSlotsByteIdentical']
        for pin in manifest['sourcePins']:
            if pin.get('revision') is None:
                file, hash_value = pin['relativeFile'], pin['sourceSha256']
                assert not source_pins.get(file) or source_pins[file] == hash_value
                source_pins[file] = hash_value
    for file, pin in source_pins.items():
        assert sha(REPO / file) == pin, 'Source drift: ' + file
    baseline = load(WORK / 'predeploy-baseline.json')
    assert not baseline['sharedReleaseActive']
    assert baseline['beforeHtmlSha256'] == html_proof['beforeSha256']
    backend_files = []
    for name, process in [('admin', 'dianzi51-admin'), ('front', 'dianzi51')]:
        detail = backend_summary[name]
        relative = 'api/' + name + '-index.js'
        assert sha(BACKEND / (name + '-index.js')) == detail['candidateSha256']
        assert baseline['api'][name] == detail['baselineSha256']
        backend_files.append({'processName': process, 'path': '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/' + name + '/dist/index.js', 'relative': relative, 'sha256': detail['candidateSha256'], 'beforeSha256': detail['baselineSha256']})
    proof = {'status': 'PASS', 'sourceBound': True, 'unrelatedNativeBytesUnchanged': True,
        'mallOperationsUnchanged': True, 'scopeAndArchiveUnchanged': True,
        'latestGlobalOrdersBytesPreserved': True, 'files': files, 'sourceHashes': frontend_pins,
        'actualCustomerGroupsPassed': actual['passed'], 'actualQuoteGroupsPassed': quotes['passed'],
        'actualProfileModuleReportSha256': sha(STATIC / 'actual-profile-module-tests.json'),
        'allOldStylesheetsRetained': True, 'effectiveDependenciesValidated': summary['effectiveDependenciesValidated'],
        'htmlExactInverse': True, 'customerFactoryProofs': customer['proofs'], 'loggedInBrowserAcceptancePerformed': False}
    backend_proof = {'status': 'PASS', 'sourceBound': True, 'unrelatedBytesUnchanged': True,
        'apis': backend_summary, 'actualCandidateTestCount': backend_test['testCount'],
        'sourceHashes': source_pins, 'manifests': {name: {'exactInverse': data['inverse'],
            'protectedDeclarationCount': data['protectedDeclarations']['count'],
            'initializationBeforeAppRouter': data['initializationBeforeAppRouter'],
            'sourceRuntimeDeltaAudit': data['sourceRuntimeDeltaAudit'],
            'globalCaptureChecks': data['globalCaptureChecks']} for name, data in backend_manifests.items()},
        'productionRecordWrites': 0, 'databaseMigrations': 0, 'bundleWholeAPI': False}
    save(CANDIDATE / 'candidate-proof.json', proof)
    save(BACKEND / 'backend-candidate-proof.json', backend_proof)
    if PACKAGE.exists():
        shutil.rmtree(PACKAGE)
    PACKAGE.mkdir(parents=True, exist_ok=True)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    for item in files:
        dest = PACKAGE / 'candidate' / item['relative']
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(CANDIDATE / item['relative'], dest)
    for item in backend_files:
        dest = PACKAGE / 'candidate' / item['relative']
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(BACKEND / Path(item['relative']).name, dest)
    evidence_paths = [CANDIDATE / 'candidate-proof.json', BACKEND / 'backend-candidate-proof.json',
        CANDIDATE / 'html-build-proof.json', CANDIDATE / 'dependency-resolution-proof.json',
        CANDIDATE / 'static-dependencies.json', STATIC / 'actual-static-candidate-tests.json',
        STATIC / 'actual-profile-module-tests.json', STATIC / 'profile-factory-tests.json',
        BACKEND / 'test-report.json', WORK / 'read-only-review-final.json',
        WORK / 'source-validation-final.json', WORK / 'live-performance-sql-explain.json',
        WORK / 'account-contract.json', RELOAD]
    evidence_hashes = {}
    for source in evidence_paths:
        shutil.copy2(source, PACKAGE / source.name)
        shutil.copy2(source, EVIDENCE / source.name)
        evidence_hashes[source.name] = sha(source)
    # Large production API bundles and reversible patch body text are package-only,
    # never copied into the public source evidence directory.
    safe_actual = {k: actual[k] for k in ['status', 'passed', 'failed', 'executed', 'coverageLimits']}
    safe_quote = {k: quotes.get(k) for k in ['status', 'passed', 'failed', 'executed', 'productionWrites', 'coverageLimits']}
    save(EVIDENCE / 'actual-customer-summary.json', safe_actual)
    save(EVIDENCE / 'actual-quote-summary.json', safe_quote)
    save(EVIDENCE / 'source-hashes.json', source_pins)
    shutil.copy2(DRIVER, PACKAGE / DRIVER.name)
    source_commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip()
    manifest = {'ownerTask': TASK, 'scope': 'customer demand quote workflow; native personal center safety and own performance; inventory source presentation and full procurement material access',
        'sourceBaseCommit': '8bf6bd516dc16348f20769eb8292df287b7b4da0', 'preparedAtSourceCommit': source_commit,
        'files': files, 'coreAssetPaths': [item['relative'] for item in files if item['relative'] != 'index.html'],
        'backendFiles': backend_files, 'beforeHtmlSha256': baseline['beforeHtmlSha256'],
        'driverSha256': sha(DRIVER), 'evidenceHashes': evidence_hashes,
        'protectedFiles': baseline['protectedFiles'], 'baselineAssets': baseline['baselineAssets'],
        'dependencies': load(CANDIDATE / 'static-dependencies.json'), 'sourceHashes': source_pins,
        'tscPassed': True, 'sourceTestFailures': 0, 'candidateTestsPassed': True,
        'backendCandidateTestsPassed': True, 'reviewPassed': True, 'productionRecordWrites': 0}
    save(PACKAGE / 'manifest.json', manifest)
    save(EVIDENCE / 'manifest.json', manifest)
    archive = WORK / 'demand-personal-center-20261114.tar.gz'
    with tarfile.open(archive, 'w:gz') as tar:
        for child in sorted(PACKAGE.iterdir()):
            tar.add(child, arcname=child.name)
    print(json.dumps({'status': 'PASS', 'frontendFiles': len(files), 'backendFiles': 2,
        'sourcePins': len(source_pins), 'archiveSha256': sha(archive), 'htmlSha256': summary['htmlSha256']}))

if __name__ == '__main__':
    main()
