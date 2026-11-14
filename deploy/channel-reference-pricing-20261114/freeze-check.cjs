'use strict';
const H = require('/home/ubuntu/work/51dianzi-platform--manager/deploy/channel-reference-pricing-20261114/backend-helper.cjs');
const { fs, path, ts, sha, assert, read, W, OUT, ROOT, ORDER } = H;
const { spawnSync } = require('node:child_process');
const tools = ['service-build.cjs', 'backend-helper.cjs', 'backend-build.cjs', 'backend-test.cjs'].map(f => path.join(ROOT, 'deploy/channel-reference-pricing-20261114', f));
const checks = [];
for (const file of [...tools, path.join(W, 'channel-reference-service.mjs'), path.join(W, 'channel-reference-worker.mjs'), path.join(OUT, 'invariant-test.cjs')]) {
  const p = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  checks.push({ file, command: 'node --check', exitCode: p.status, sha256: sha(fs.readFileSync(file)), stderr: p.stderr });
  assert(p.status === 0, 'SYNTAX_CHECK_FAILED ' + file);
}
const p = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: fs.readFileSync(path.join(OUT, 'admin-index.js')), encoding: 'utf8' });
checks.push({ file: path.join(OUT, 'admin-index.js'), command: 'node --input-type=module --check < candidate', exitCode: p.status, sha256: sha(fs.readFileSync(path.join(OUT, 'admin-index.js'))), stderr: p.stderr });
assert(p.status === 0, 'CANDIDATE_SYNTAX_ONLY_CHECK_FAILED');
const { pins, capture } = H.baseline(), final = H.finalGraphEvidence(pins);
const m = H.json(path.join(OUT, 'admin-manifest.json')), tests = H.json(path.join(OUT, 'tests.json')), invariants = H.json(path.join(OUT, 'invariant-checks.json'));
const bytes = read(path.join(OUT, 'admin-index.js'));
assert(m.status === 'PASS' && tests.status === 'PASS' && invariants.status === 'PASS', 'ALL_CURRENT_OFFLINE_RESULTS_PASS');
assert(m.candidateSha256 === sha(bytes) && tests.testedCandidateSha256 === sha(bytes) && invariants.testedCandidateSha256 === sha(bytes), 'CURRENT_CANDIDATE_DISK_PIN');
assert(m.sourceBaselineReceipt.sourcePinsFileSha256 === sha(read(path.join(W, 'backend-source-pins.json'))), 'CURRENT_PINS_METADATA_MATCH');
assert(tests.count === 44 && tests.tests.length === 44 && tests.tests.every(t => t.status === 'PASS'), 'ACTUAL_44_NATIVE_FOCUSED_TESTS');
assert(invariants.count === 8 && invariants.negativeMutations === 6, 'EIGHT_INVARIANTS_SIX_MUTATIONS');
const old = H.nativeParse('freeze-baseline.js', read(path.join(W, 'baseline/admin-index.js'))), candidate = H.nativeParse('freeze-candidate.js', bytes);
const importDelta = H.importGuard(old, candidate), root = H.rootGuard(old, candidate), protections = H.S.protections(old, candidate, m.nativePatches);
const records = H.json(path.join(OUT, 'source-compile-records.json'));
const captures = H.S.captureChecks(candidate, records, m.nativePatches), initialization = H.initialization(candidate, records.filter(r => ORDER.includes(r.name)));
assert(protections.count === 1092 && protections.digest === m.protectedDeclarations.digest && importDelta.oldCount === 130 && root.protectedCount === 24 && m.nativePatches.length === 8 && m.nativePatches.every(p => p.start === p.end), 'EXACT_PRESERVED_NATIVE_BOUNDARIES');
let inverse = bytes;
for (const patch of [...m.nativePatches].reverse()) {
  assert(sha(inverse.slice(patch.newStart, patch.newEnd)) === patch.newSha256, 'INVERSE_INSERTED_DISK_BYTES');
  inverse = inverse.slice(0, patch.newStart) + old.text.slice(patch.start, patch.end) + inverse.slice(patch.newEnd);
}
assert(Buffer.from(inverse).equals(Buffer.from(old.text)), 'FINAL_INDEPENDENT_DISK_BYTE_INVERSE');
const nativeProfileStaff = [];
H.walk(old.byName('appRouter').node, n => {
  if ((ts.isPropertyAssignment(n) || ts.isShorthandPropertyAssignment(n)) && ['profile', 'updateProfile', 'salesStaffCodes', 'staffOrganization'].includes(n.name?.getText(old.sf))) nativeProfileStaff.push({ property: n.name.getText(old.sf), sha256: sha(n.getText(old.sf)), bytes: Buffer.byteLength(n.getText(old.sf)) });
});
assert(['profile', 'updateProfile', 'salesStaffCodes', 'staffOrganization'].every(name => nativeProfileStaff.some(r => r.property === name)), 'ACTUAL_NATIVE_PROFILE_STAFF_ROUTE_NAMES');
assert(old.byName('appRouter').node.getText(old.sf) === candidate.byName('appRouter').node.getText(candidate.sf), 'COMPLETE_APP_ROUTER_OLD_HANDLERS_PROFILE_STAFF_BYTES');
const profileHelpers = protections.declarations.filter(d => d.module === 'server/services/officialChannelProfileRead.ts');
assert(profileHelpers.some(d => d.name === 'withOfficialChannelProfileRead') && profileHelpers.some(d => d.name === 'officialChannelProfileAuthorityRows'), 'EXACT_PROFILE_HELPER_OWNER_PROTECTED');
const baseline = H.json(path.join(OUT, 'baseline-byte-protection.json'));
for (const row of baseline.otherBaselineFiles) assert(sha(fs.readFileSync(path.join(W, 'baseline', row.relative))) === row.sha256, 'FINAL_BASELINE_CAS ' + row.relative);
assert(capture.capturedAtUtc === '2026-11-14T10:14:51.133996+00:00' && baseline.captureSha256 === pins.captureSha256, 'CURRENT_FRESH_CAPTURE_TIME_SHA');
for (const [file, hash] of Object.entries(m.sourcePins)) assert(sha(fs.readFileSync(path.join(ROOT, file))) === hash, 'FINAL_SOURCE_PIN_DRIFT ' + file);
for (const [file, hash] of Object.entries(pins.snapshotCodeEvidence.sourcePins)) assert(sha(fs.readFileSync(path.join(ROOT, file))) === hash, 'SNAPSHOT_CODE_EVIDENCE_SOURCE_MOVED ' + file);
assert(sha(fs.readFileSync(pins.snapshotCodeEvidence.path)) === pins.snapshotCodeEvidence.sha256, 'SNAPSHOT_CODE_HANDOFF_BYTE_PIN');
const formalPaths = [path.join(ROOT, 'server/channelReference/channel-reference-snapshot.json'), path.join(W, 'channel-reference-snapshot.json')];
assert(formalPaths.every(f => !fs.existsSync(f)), 'FORMAL_RESEARCH_JSON_NOT_READY_MUST_NOT_FAKE');
assert(!fs.readdirSync(OUT).some(f => f.startsWith('.NON-LIVE-snapshot-default-test-')), 'TEMP_TEST_FIXTURE_REMOVED');
const nativeCheck = {
  status: 'PASS', statusScope: 'current byte-incremental native artifact and exact-source graph offline freeze; no deployment/live acceptance',
  capturedAtUtc: capture.capturedAtUtc, captureSha256: pins.captureSha256,
  sourcePinsFileSha256: sha(read(path.join(W, 'backend-source-pins.json'))),
  candidateSha256: sha(bytes), completeNativeManifestSha256: sha(read(path.join(OUT, 'admin-manifest.json'))), completeNativeManifest: path.join(OUT, 'admin-manifest.json'),
  nativePatchCount: m.nativePatches.length, nativePatches: m.nativePatches, insertionOnly: true, newDeclarations: ORDER,
  protectedDeclarations: protections, protectedOldImports: importDelta, protectedOldRootProperties: root,
  all1092OriginalDeclarationsByteIdentical: true, allOldHandlersByteIdentical: true,
  appRouterSha256: sha(old.byName('appRouter').node.getText(old.sf)), appRouterProfileStaffBytesUnchanged: true, nativeProfileStaff, nativeProfileHelperOwnerProtections: profileHelpers,
  retainedNativeCanonicalGuards: m.retainedNativeCanonicalGuards, captureChecks: captures, initializationChecks: initialization,
  sourceC3Inverse: H.baselineSource('server/businessRouter.ts').proof, independentNativeDiskByteInverse: true,
  serviceImportBridge: m.serviceImportBridge, actualSourceUnion: final.graph.actualSourceUnion, actualSourceHashes: final.sourceHashes,
  finalGraphPins: pins.finalGraph, defaultRuntimeProofSha256: final.runtimeProofSha256,
  nativeFocusedTests: { count: 44, executedOnceThisTask: true, nativeIOAuthServiceStubs: true, reportSha256: sha(read(path.join(OUT, 'tests.json'))) },
  invariants: { count: 8, negativeMutations: 6, executedOnceThisTask: true, reportSha256: sha(read(path.join(OUT, 'invariant-checks.json'))) },
  snapshotCodeEvidence: pins.snapshotCodeEvidence, reusedAuthEvidence: m.priorAuthEvidence,
  parentRestoredEvidenceSupportsCurrentDefaultLookup: false, oldBrowserAndTypecheckEvidenceReused: false,
  baselineCAS: { otherLocalFilesPreserved: baseline.otherBaselineFiles.length, protectedPublicAssets: capture.baselineAssets.length, protectedFiles: capture.protectedFiles.length, allHashesStillMatch: true },
  noNETExecution: true, networkExecution: false, databaseAccess: false, candidateEntrypointExecuted: false, wholeApiBundled: false,
  defaultLookupSnapshotOnly: true, legacyNetworkCapableExportsPresent: true, workerUnusedNotDeployment: true,
  liveEvidencePendingResearch: true, formalJSONNotReady: true, formalJSONWritten: false,
  futureSourceMutationRequiresLimitedRebind: true
};
H.output('native-check-manifest.json', nativeCheck);
const result = {
  status: 'PASS', scope: nativeCheck.statusScope, frozenAtUtc: new Date().toISOString(), syntaxChecks: checks,
  sourcePinsFileSha256: nativeCheck.sourcePinsFileSha256, candidateSha256: sha(bytes), nativeCheckManifestSha256: sha(read(path.join(OUT, 'native-check-manifest.json'))),
  completeNativeBuildManifestSha256: nativeCheck.completeNativeManifestSha256,
  actualDefaultRuntime: { count: 8, actualByteIdenticalDefaultExportInvoked: true, temporaryNonLiveFixture: true, readonly: true, refreshIgnored: true, pendingAbsent: true, no20MinuteExpiry: true, forbiddenIOAttempts: 0, reportSha256: final.runtimeProofSha256 },
  nativeFunctionalTestsActuallyExecuted: 44, independentInvariantChecks: 8, negativeInMemoryGuardMutations: 6, nativeTestRuns: 1, invariantTestRuns: 1,
  reusedLegacyAuthTests: 96, legacyTestsRerun: false, parentRestoredServiceTestsSupportNewDefaultBinding: false, snapshotSourceTestsRerun: false,
  snapshotCodeEvidence: pins.snapshotCodeEvidence, currentSourceGraph: pins.finalGraph,
  currentServiceDefaultSourceSha256: final.binding.sourceSha256, currentSnapshotSourceSha256: final.binding.snapshotSourceSha256,
  baselineCapturedAtUtc: capture.capturedAtUtc, captureSha256: pins.captureSha256, baselineOtherFilesCASPreserved: true,
  historicalFailureReferences: ['service-default-runtime-failure1.json', 'service-default-runtime-failure2.json', 'service-build-failure1.log', 'service-build-failure2.log', 'freeze-check-failure1.log'],
  failureExplanation: 'Historical handoff only, not failures executed or restored in the current recovery: initial harness wrongly blocked ESM loader readonly open and fixture-only harness writes; no service network/write was executed. Corrected harness retains service blocks. Preliminary fresh counterpart check rejected a pre-existing local test extra; no writes occurred; every local baseline file was subsequently CAS preserved. First freeze check wrongly assumed a profileStaff property; current AST has actual profile/updateProfile/salesStaffCodes/staffOrganization names, now recorded under full unchanged appRouter proof.',
  archivedEvidenceNotCurrentSupport: ['evidence/previous-artifact-checks.json', 'evidence/previous-files.sha256', 'pre-refresh-integrity.log'],
  gitExecuted: false, ssh: false, noNETExecution: true, networkExecution: false, databaseAccess: false, applicationEntryExecuted: false, wholeApiBuild: false,
  actualServiceDefaultExecutedOffline: true, legacyFactoryInvoked: false, legacyNetworkCapableExportsPresent: true, productSourceWritten: false,
  workerUnusedNotDeployment: true, liveEvidencePendingResearch: true, formalJSONNotReady: true, formalSnapshotPathsAbsent: formalPaths, toolHashes: Object.fromEntries(tools.map(f => [f, sha(fs.readFileSync(f))])),
  aliasMutationWarning: 'Any later finite observed-brand alias/schema patch changes frozen snapshot source SHA; this freeze validates ONLY current source pins. Rebuild both graphs, rebind exact source union/runtime proof and native import metadata before claiming amended-source support.'
};
H.output('artifact-checks.json', result);
console.log(JSON.stringify({ status: 'PASS', candidateSha256: sha(bytes), nativeTests: 44, invariants: 8, defaultRuntimeChecks: 8, actualSourceFiles: final.graph.sourceFiles, nativeCheckManifestSha256: result.nativeCheckManifestSha256, sourcePinsSha256: result.sourcePinsFileSha256 }));
