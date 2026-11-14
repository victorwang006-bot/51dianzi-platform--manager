#!/usr/bin/env python3
"""Prepare five static files and one admin API; never deploy or mutate business data."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parent.parent
WORK = Path('/home/ubuntu/work/profile-staff-20261114')
FRONTEND, BACKEND = WORK / 'frontend-candidate', WORK / 'backend-candidate'
PACKAGE = WORK / 'package'
EVIDENCE = REPO / 'deploy/profile-staff-evidence-20261114'
TASK = 'CKSZQ7sVc7tADM21c3LWpu'
BASE_COMMIT = '5abd9a35cc4ff53d008f49bff88f54a1f47c1d0c'
DRIVER, RELOAD = TOOLS / 'activate-profile-staff-20261114.py', TOOLS / 'reload-profile-staff-api-20261114.cjs'
FRONT_API = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
ADMIN_API = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js'

def load(file): return json.loads(Path(file).read_text())
def sha(file): return hashlib.sha256(Path(file).read_bytes()).hexdigest()
def save(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

def main():
    validation = load(WORK / 'source-validation-final.json')
    review = load(WORK / 'read-only-review-final.json')
    activation = load(WORK / 'activation-tests.json')
    reload_test = load(WORK / 'reload-tests.json')
    parts, actual, integrated = [load(FRONTEND / name) for name in ['frontend-parts.json', 'tests.json', 'integrated-tests.json']]
    merged, html, dependencies = [load(FRONTEND / name) for name in ['merged-summary.json', 'html-build-proof.json', 'dependency-resolution-proof.json']]
    backend, backend_test, backend_manifest = [load(BACKEND / name) for name in ['summary.json', 'test-report.json', 'admin-manifest.json']]
    for report in [validation, review, activation, reload_test, parts, actual, integrated, merged, dependencies]: assert report['status'] == 'PASS'
    assert validation['tscPassed'] and validation['sourceTestFailures'] == 0
    assert backend_test['pass'] and backend['qa']['pass'] and backend['testsPending'] is False
    assert actual['failed'] == activation['failed'] == 0
    assert all(actual['counts'][key] == 0 for key in ['actualNetworkIO', 'actualDatabaseIO', 'actualSMSIO', 'blockedNetworkAttempts'])
    assert actual['actualModuleWrappersExecuted']['Profile'] and actual['actualModuleWrappersExecuted']['Staff']
    assert actual['sourceOrCandidateWrapperRecompiled'] is False
    assert actual['nativeDialog']['actualNativeInputAndDialogModuleBodyExecuted']
    assert integrated['htmlSha256Inspected'] == merged['htmlSha256'] == sha(FRONTEND / 'index.html')
    assert activation['driverSha256'] == review['activationReview']['driverSha256'] == sha(DRIVER)
    assert activation['reloadHelperSha256'] == review['activationReview']['reloadHelperSha256'] == sha(RELOAD)
    assert reload_test['failed'] == 0 and reload_test['reloadHelperSha256'] == sha(RELOAD)
    assert reload_test['actualPM2Operations'] == 0 and reload_test['environmentOverlay'] is False
    assert html['exactInverse'] and merged['oldStylesheetsRetained'] and merged['nativeEntryByteAndUrlUnchanged']
    assert len(parts['relocations']) == 3 and merged['customerWorkbenchRelocations'] == 0
    for name in ['layout', 'profile', 'staff']:
        proof = parts['proofs'][name]
        assert proof['exactInverse'] and proof['allNonpatchBytesUnchanged'] and proof['allOldSpecifiersPreserved'] and proof['allOldImportBindingsPreserved'] and proof['exportsByteIdentical']
    css = parts['proofs']['css']
    assert css['sourceScoped'] and css['baselineStylesheetUnchanged']
    assert sha(FRONTEND / parts['cssUrl'].lstrip('/')) == css['sha256']
    for protected_file in parts['proofs']['protectedFiles']:
        assert protected_file['unchanged'] and sha(WORK / 'baseline' / protected_file['relative']) == protected_file['sha256']
    assert parts['proofs']['layout']['onlyWorkspaceDefinitionsInitializer']
    assert parts['proofs']['profile']['oldFactoryCanonicalByteIdentical'] and parts['proofs']['profile']['GWrapperByteIdentical']
    assert backend_manifest['inverse']['byteExact'] and backend_manifest['inverse']['allOutsideSlotsByteIdentical']
    assert backend_manifest['nonTargetDeclarationsByteIdentical'] and backend_manifest['initializationBeforeAppRouter'] and not backend_manifest['bundleWholeAPI']
    assert backend_manifest['sourceFreeze']['evidenceSha256'] == sha(WORK / 'staff-status-contract.json')
    assert backend['front']['unchanged'] and not backend['front']['rebuilt'] and not backend['front']['deployed']
    files = load(FRONTEND / 'files.json')
    assert len(files) == 5 and len({item['relative'] for item in files}) == 5
    for item in files: assert sha(FRONTEND / item['relative']) == item['sha256']
    reviewed_candidates = review['candidateHashes']
    assert reviewed_candidates['html'] == merged['htmlSha256']
    assert reviewed_candidates['frontend4'] == {item['relative']: item['sha256'] for item in files if item['relative'] != 'index.html'}

    # Retain the complete previous source binding, replacing only source pins
    # actually consumed by this round's authorized precise compilers.
    previous = load(WORK / 'baseline/previous-manifest.json')
    source_pins = dict(previous['sourceHashes'])
    source_pins.update(parts['sourceHashes'])
    for pin in backend_manifest['sourcePins']:
        assert pin['revision'] is None
        source_pins[pin['relativeFile']] = pin['sourceSha256']
    for relative, expected in source_pins.items(): assert sha(REPO / relative) == expected, 'source drift: ' + relative
    for group in [validation['compiledSourceHashes'], validation['checkedChangedSourceAndTestHashes'], review.get('sourceHashes', {}), parts.get('dependencySourceHashes', {})]:
        for relative, expected in group.items(): assert sha(REPO / relative) == expected, 'checked input drift: ' + relative
    for name, record in validation['testLogs'].items(): assert sha(WORK / name) == record['sha256']
    assert sha(WORK / 'parent-tsc-final.log') == validation['tscLogSha256']

    baseline = load(WORK / 'predeploy-baseline.json')
    assert not baseline['sharedReleaseActive'] and baseline['beforeHtmlSha256'] == html['beforeSha256']
    assert baseline['api']['admin'] == backend['admin']['baselineSha256']
    assert baseline['api']['front'] == backend['front']['sha256'] == sha(WORK / 'baseline/front-index.js')
    assert sha(BACKEND / 'admin-index.js') == backend['admin']['candidateSha256'] == backend_test['admin']['candidateSha256']
    assert reviewed_candidates['admin'] == backend['admin']['candidateSha256']
    assert reviewed_candidates['frontOriginal'] == baseline['api']['front']
    backend_files = [{'processName': 'dianzi51-admin', 'path': ADMIN_API, 'relative': 'api/admin-index.js', 'sha256': backend['admin']['candidateSha256'], 'beforeSha256': baseline['api']['admin']}]
    protected = list(baseline['protectedFiles'])
    if not any(item['path'] == FRONT_API for item in protected): protected.append({'path': FRONT_API, 'sha256': baseline['api']['front']})
    proof = {'status': 'PASS', 'sourceBound': True, 'unrelatedNativeBytesUnchanged': True, 'mallOperationsUnchanged': True, 'scopeAndArchiveUnchanged': True, 'latestGlobalOrdersBytesPreserved': True, 'files': files, 'sourceHashes': parts['sourceHashes'], 'allOldStylesheetsRetained': True, 'nativeEntryAndBWUnchanged': True, 'exactHtmlInverse': True, 'effectiveDependenciesValidated': merged['effectiveDependenciesValidated'], 'actualModuleTestsPassed': actual['passed'], 'integratedTestReportSha256': sha(FRONTEND / 'integrated-tests.json'), 'profileAndStaffProofs': parts['proofs'], 'loggedInBrowserAcceptancePerformed': False}
    backend_proof = {'status': 'PASS', 'sourceBound': True, 'unrelatedBytesUnchanged': True, 'sourceHashes': source_pins, 'admin': backend['admin'], 'frontUntouched': backend['front'], 'actualCandidateTestCount': backend_test['testCount'], 'exactInverse': backend_manifest['inverse'], 'protectedDeclarationCount': backend_manifest['protectedDeclarations']['count'], 'sourceRuntimeDeltaAudit': backend_manifest['sourceRuntimeDeltaAudit'], 'sourceFreezeSha256': backend_manifest['sourceFreeze']['evidenceSha256'], 'productionRecordWrites': 0, 'databaseMigrations': 0, 'bundleWholeAPI': False}
    save(FRONTEND / 'candidate-proof.json', proof); save(BACKEND / 'backend-candidate-proof.json', backend_proof)
    if PACKAGE.exists(): shutil.rmtree(PACKAGE)
    PACKAGE.mkdir(); EVIDENCE.mkdir(parents=True, exist_ok=True)
    for item in files:
        destination = PACKAGE / 'candidate' / item['relative']; destination.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(FRONTEND / item['relative'], destination)
    destination = PACKAGE / 'candidate/api/admin-index.js'; destination.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(BACKEND / 'admin-index.js', destination)
    assert not (PACKAGE / 'candidate/api/front-index.js').exists()
    evidence_paths = [FRONTEND / 'candidate-proof.json', BACKEND / 'backend-candidate-proof.json', FRONTEND / 'frontend-parts.json', FRONTEND / 'html-build-proof.json', FRONTEND / 'dependency-resolution-proof.json', FRONTEND / 'static-dependencies.json', FRONTEND / 'tests.json', FRONTEND / 'integrated-tests.json', BACKEND / 'test-report.json', WORK / 'read-only-review-final.json', WORK / 'source-validation-final.json', WORK / 'activation-tests.json', WORK / 'staff-status-contract.json', WORK / 'live-audit-schema-readonly.json', RELOAD]
    evidence_paths.append(WORK / 'reload-tests.json')
    evidence_paths.append(TOOLS / 'bind-source.py')
    evidence_hashes = {}
    for source in evidence_paths:
        shutil.copy2(source, PACKAGE / source.name); shutil.copy2(source, EVIDENCE / source.name); evidence_hashes[source.name] = sha(source)
    # No production bundles, reversible patch bodies, credentials or environment
    # dumps are placed in the public Git evidence directory.
    save(EVIDENCE / 'source-hashes.json', source_pins)
    shutil.copy2(DRIVER, PACKAGE / DRIVER.name)
    current = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip()
    manifest = {'ownerTask': TASK, 'scope': 'compact two-tab personal center, native security dialogs, workspace order swap; guarded/audited native admin status toggle only', 'sourceBaseCommit': BASE_COMMIT, 'preparedAtSourceCommit': current, 'preparedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'files': files, 'coreAssetPaths': [item['relative'] for item in files if item['relative'] != 'index.html'], 'backendFiles': backend_files, 'beforeHtmlSha256': baseline['beforeHtmlSha256'], 'driverSha256': sha(DRIVER), 'evidenceHashes': evidence_hashes, 'protectedFiles': protected, 'baselineAssets': baseline['baselineAssets'], 'baselineProcesses': baseline['processes'], 'untouchedFrontApiSha256': baseline['api']['front'], 'dependencies': load(FRONTEND / 'static-dependencies.json'), 'sourceHashes': source_pins, 'tscPassed': True, 'sourceTestFailures': 0, 'candidateTestsPassed': True, 'backendCandidateTestsPassed': True, 'reviewPassed': True, 'productionRecordWrites': 0, 'databaseMigrations': 0, 'onlyAdminOriginalProcessIds': [191, 192], 'frontReloadInstances': 0}
    save(PACKAGE / 'manifest.json', manifest); save(EVIDENCE / 'manifest.json', manifest)
    archive = WORK / 'profile-staff-20261114.tar.gz'
    with tarfile.open(archive, 'w:gz') as tar:
        for child in sorted(PACKAGE.iterdir()): tar.add(child, arcname=child.name)
    result = {'status': 'PASS', 'frontendFiles': len(files), 'backendFiles': 1, 'sourcePins': len(source_pins), 'archive': str(archive), 'archiveSha256': sha(archive), 'htmlSha256': merged['htmlSha256'], 'adminApiSha256': backend['admin']['candidateSha256'], 'frontApiSha256Unchanged': baseline['api']['front']}
    save(WORK / 'package-summary.json', result); print(json.dumps(result))

if __name__ == '__main__': main()
