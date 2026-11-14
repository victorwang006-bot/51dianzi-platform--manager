'use strict';
/** Parent fresh capture rebind only. No compiler, DOM, transport, or production access. */
const C = require('../core.cjs');
const { assert, fs, BASE, OUT, REPO, read, json, sha, write } = C;
const parentReport = '/home/ubuntu/work/channel-reference-batch-299-20261114/baseline/live-baseline-current.json';
function run() {
  const baseline = C.baselineProof();
  assert(fs.readFileSync(BASE + '/live-baseline-current.json').equals(fs.readFileSync(parentReport)), 'copied report is exact parent fresh capture');
  const p = json(OUT + '/frontend-parts.json');
  const before = json(OUT + '/before-fresh-capture-frontend-proof.json');
  assert.equal(p.status, 'PASS');
  assert.deepEqual(p.files, before.files, 'candidate deployment files identical; no rebuild');
  assert.deepEqual(p.baselineAssets, baseline.assets, 'all 158 baseline asset records unchanged');
  assert.deepEqual(p.capturedProcessSnapshot, baseline.current.processes, 'actual same 12 process script/cwd/environmentHash snapshot');
  assert.equal(before.beforeHtmlSha256, baseline.current.beforeHtmlSha256);
  assert.equal(before.capturedBaseline.coordSha256, baseline.current.coordSha256);
  assert.equal(before.capturedBaseline.processSnapshotSha256, sha(JSON.stringify(baseline.current.processes)));
  for (const r of p.files) assert.equal(sha(fs.readFileSync(OUT + '/' + r.relative)), r.sha256);
  for (const [r, h] of Object.entries(p.sourceHashes)) assert.equal(sha(fs.readFileSync(REPO + '/' + r)), h);
  for (const [r, h] of Object.entries(p.dependencySourceHashes)) assert.equal(sha(fs.readFileSync(REPO + '/' + r)), h);
  const native = json(OUT + '/native-tests.json');
  const binding = json(OUT + '/native-binding-proof.json');
  const dependency = json(OUT + '/dependency-resolution-proof.json');
  assert.equal(native.status, 'PASS');
  assert.equal(native.passed, 8);
  assert.equal(native.failed, 0);
  assert.equal(before.actualCandidateQA.reportSha256, sha(read(OUT + '/native-tests.json')), 'native report preserved; not rerun or recounted');
  assert.equal(binding.status, 'PASS');
  assert.equal(dependency.status, 'PASS');
  assert.equal(dependency.checks.length, 110);
  assert(dependency.actualASTNodeKindSpans && dependency.allOldSpecifiersBytePreserved);
  const result = {
    status: 'PASS',
    phase: 'batch299-parent-fresh-capture-rebind',
    parentReport,
    actualReportPath: BASE + '/live-baseline-current.json',
    actualReportSha256: sha(fs.readFileSync(BASE + '/live-baseline-current.json')),
    oldCaptureUtc: before.capturedBaseline.capturedAtUtc,
    freshCaptureUtc: baseline.current.capturedAtUtc,
    unchangedHtmlSha256: baseline.current.beforeHtmlSha256,
    unchangedCoordSha256: baseline.current.coordSha256,
    unchangedProcessSnapshotSha256: sha(JSON.stringify(baseline.current.processes)),
    all158CapturedAssetsByteRetained: true,
    candidateFilesByteUnchanged: true,
    candidateFiles: p.files,
    oldIndependentCanonicalRetained: p.proofs.canonical.oldStaticHostCanonicalByteIdentical,
    retainedNativeQA: { report: 'native-tests.json', sha256: sha(read(OUT + '/native-tests.json')), passed: 8, failed: 0, rerun: false },
    retainedDependencyASTChecks: 110,
    compilerRun: false,
    wholeBuildRun: false,
    network: false,
    sourceWritten: false,
    parentCaptureOnly: true,
    livePricingValidated: false,
    productionActivated: false,
  };
  write('baseline-rebind-proof.json', result);
  p.freshBaselineBinding = { status: 'PASS', report: 'baseline-rebind-proof.json', sha256: sha(read(OUT + '/baseline-rebind-proof.json')), capturedAtUtc: baseline.current.capturedAtUtc, actualReportSha256: result.actualReportSha256, candidateRebuilt: false };
  write('frontend-parts.json', p);
  console.log(JSON.stringify(result));
  return result;
}
module.exports = { run };
if (require.main === module) {
  try { run(); } catch (error) {
    write('baseline-rebind-error.json', { status: 'FAIL', error: error.stack });
    console.error(error.stack);
    process.exitCode = 1;
  }
}
