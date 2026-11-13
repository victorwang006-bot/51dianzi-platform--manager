#!/usr/bin/env node
'use strict';
// Offline source-bound build; never executes API entrypoints or opens a database.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { make, SOURCE_PATHS, PINNED } = require('./customer-inventory-backend-20261114/factory.cjs');
const { runChecks, bffAndBootChecks } = require('./customer-inventory-backend-20261114/test.cjs');
const { sha, assert } = require('./customer-inventory-backend-20261114/core.cjs');
const REPO = path.resolve(__dirname, '..');
const BASE = '/home/ubuntu/tmp/customer-live/api';
const OUT = '/home/ubuntu/work/customer-workbench-20261114/backend-candidate';
const TARGETS = {
  admin: { processName: 'dianzi51-admin', path: '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js' },
  front: { processName: 'dianzi51', path: '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js' },
};
const writeJSON = (name, value) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(value, null, 2) + '\n');
(async () => {
  assert(process.argv.includes('--source-ready'), 'SOURCE_READY_REQUIRED');
  fs.mkdirSync(path.join(OUT, 'api'), { recursive: true });
  const build = await make({ repo: REPO, baselineDir: BASE });
  console.log('Exact API baseline pins and source-bound AST selections verified.');
  const inventory = await runChecks(build);
  console.log(inventory.log.join('\n'));
  const bff = await bffAndBootChecks(build);
  console.log(bff.log.join('\n'));
  const sourceHashes = Object.fromEntries(Object.keys(SOURCE_PATHS).map(key => [SOURCE_PATHS[key], build.compiled[key].meta.sourceSha256]));
  for (const [source, hash] of Object.entries(sourceHashes)) assert(sha(fs.readFileSync(path.join(REPO, source))) === hash, 'SOURCE_CHANGED_DURING_BUILD ' + source);
  for (const key of ['admin', 'front']) assert(sha(fs.readFileSync(path.join(BASE, `${key}-index.js`))) === PINNED[key], 'BASELINE_CHANGED_DURING_BUILD ' + key);
  const files = [];
  for (const key of ['admin', 'front']) {
    const result = build.results[key];
    assert(result.manifest.inverse.byteExact && result.manifest.nonTargetDeclarationsByteIdentical, 'INVERSE_PROOF_REQUIRED');
    const relative = `api/${key}-index.js`;
    fs.writeFileSync(path.join(OUT, relative), result.text);
    const syntax = path.join(OUT, `${key}-syntax.mjs`);
    fs.writeFileSync(syntax, result.text);
    try { execFileSync(process.execPath, ['--check', syntax], { stdio: 'pipe' }); }
    finally { fs.unlinkSync(syntax); }
    files.push({ ...TARGETS[key], relative, sha256: sha(result.text), beforeSha256: PINNED[key], bytes: Buffer.byteLength(result.text) });
    writeJSON(`${key}-build-proof.json`, result.manifest);
  }
  const checks = [...inventory.checks, ...bff.checks];
  assert(checks.every(check => check.passed === true), 'ACTUAL_CANDIDATE_CHECK_FAILED');
  const tests = { status: 'PASS', checks, caseGroups: checks.length, realDatabaseUsed: false, productionNetworkCalls: 0,
    boot: bff.boot, sourceHashes, sourceBound: true, actualCandidateDeclarationsExecuted: true,
    sqlEvidence: inventory.sqlEvidence, nativeClosure: inventory.nativeClosure,
    caveat: 'Synthetic SQL transport and current-identity fixtures; not authenticated production acceptance.' };
  writeJSON('actual-backend-candidate-tests.json', tests);
  writeJSON('source-meta.json', { sourceHashes, compiled: Object.fromEntries(Object.entries(build.compiled).map(([key, value]) => [key, value.meta])),
    sourceStableDuringBuild: true, baselineStableDuringBuild: true, entrypointExecuted: false, bundle: false });
  writeJSON('backend-files.json', files);
  writeJSON('backend-candidate-proof.json', { status: 'PASS', releaseType: 'OFFLINE_SOURCE_BOUND_API_CANDIDATE_NOT_DEPLOYED',
    sourceBound: true, unrelatedBytesUnchanged: true, originalGlobalScopeUnchanged: true,
    existingGlobalDtoFieldsUnchanged: true, additiveAuthorizedGlobalCompanyProjection: true,
    nativeUploadBatchSourcePublicationSemanticsUnchanged: true, customerInventoryAndCrmIntersectionEnforced: true,
    actualCandidateTestsPassed: true, actualRouterBootOrderPassed: true, sourceSnapshotStable: true,
    noNewDatabaseOrProvider: true, databaseOperations: 0, productionRecordWrites: 0, sourceHashes,
    files, testsSha256: sha(fs.readFileSync(path.join(OUT, 'actual-backend-candidate-tests.json'))),
    patchProofs: Object.fromEntries(['admin', 'front'].map(key => [key, { sha256: sha(fs.readFileSync(path.join(OUT, `${key}-build-proof.json`))),
      inverse: build.results[key].manifest.inverse, unchangedDeclarationCount: build.results[key].manifest.unchangedDeclarationCount }])), deployed: false });
  console.log(JSON.stringify({ status: 'PASS_BUILT_NOT_DEPLOYED', output: OUT, apiFiles: files.length, checkGroups: checks.length }));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
