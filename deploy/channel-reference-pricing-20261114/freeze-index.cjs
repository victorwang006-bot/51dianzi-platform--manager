'use strict';
const H = require('/home/ubuntu/work/51dianzi-platform--manager/deploy/channel-reference-pricing-20261114/backend-helper.cjs');
const { fs, path, sha, assert, read, W, OUT, ROOT } = H;
const BATCH = '/home/ubuntu/work/channel-reference-batch-299-20261114';
const { pins } = H.baseline(); H.finalGraphEvidence(pins);
const m = H.json(path.join(OUT, 'admin-manifest.json'));
for (const [file, hash] of Object.entries(m.sourcePins)) assert(sha(fs.readFileSync(path.join(ROOT, file))) === hash, 'FREEZE_INDEX_SOURCE_MOVED ' + file);
const files = new Set([
  path.join(BATCH, 'backend-build-handoff.md'),
  ...['backend-source-pins.json', 'baseline/live-baseline-current.json', 'live-baseline-current.json', 'baseline/previous-source-receipt.json', 'channel-reference-service.mjs', 'channel-reference-worker.mjs', 'service-metafile.json', 'worker-metafile.json', 'service-graph-proof.json', 'service-default-runtime-proof.json'].map(f => path.join(W, f)),
  ...['service-build.cjs', 'backend-helper.cjs', 'backend-build.cjs', 'backend-test.cjs'].map(f => path.join(ROOT, 'deploy/channel-reference-pricing-20261114', f)),
  ...Object.keys(pins.finalGraph.sourceHashes).map(f => path.join(ROOT, f)),
  path.join(ROOT, 'server/channelReference/snapshot.test.ts'),
  pins.snapshotCodeEvidence.path
]);
function collect(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, item.name); if (item.isDirectory()) collect(full); else if (item.isFile() && item.name !== 'files.sha256' && item.name !== 'freeze-index.log') files.add(full); } }
collect(OUT);
const entries = [...files].sort().map(file => ({ file, hash: sha(fs.readFileSync(file)) }));
const text = entries.map(e => e.hash + '  ' + e.file).join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'files.sha256'), text);
fs.writeFileSync(path.join(BATCH, 'backend-build-sha256.txt'), text);
for (const e of entries) assert(sha(fs.readFileSync(e.file)) === e.hash, 'FREEZE_INDEX_ARTIFACT_MOVED ' + e.file);
console.log(JSON.stringify({ status: 'PASS', entries: entries.length, indexSha256: sha(text), sourcePinsSha256: sha(read(path.join(W, 'backend-source-pins.json'))), handoffSha256: sha(read(path.join(BATCH, 'backend-build-handoff.md'))), artifactChecksSha256: sha(read(path.join(OUT, 'artifact-checks.json'))), finalGraphProofSha256: pins.finalGraph.proofSha256, finalizedCurrentSourceOnly: true, aliasesRequireRebind: true }));
