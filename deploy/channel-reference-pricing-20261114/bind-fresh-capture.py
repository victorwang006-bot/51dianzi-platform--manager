#!/usr/bin/env python3
import pathlib, json, hashlib
W = pathlib.Path('/home/ubuntu/work/channel-reference-phase2-20261114')
NEW = pathlib.Path('/home/ubuntu/work/channel-reference-batch-299-20261114')
sha = lambda b: hashlib.sha256(b).hexdigest()
r = (NEW / 'baseline/live-baseline-current.json').read_bytes()
c = json.loads(r)
assert r == (NEW / 'live-baseline-current.json').read_bytes()
assert c['capturedAtUtc'] == '2026-11-14T10:14:51.133996+00:00'
assert sha(r) == 'edb88edac677c0b9eba5773c8e986b31421af80254b71a31bfad665ab88414cf'
assert c['sourceCommit'] == 'aeaf9f87f2fc96e210a635eee17c491f43df757a'
assert c['processCount'] == 12 and c['allOnline'] and not c['sharedReleaseActive']
assert len(c['processes']) == 12 and all(p['status'] == 'online' for p in c['processes'])
assert len(c['baselineAssets']) == 158 and len(c['protectedFiles']) == 4
assert c['productionRecordWrites'] == 0 and c['databaseAccess'] is False and c['environmentValuesExported'] is False
files = []
for f in sorted((W / 'baseline').rglob('*')):
    if f.is_file() and f.name != 'live-baseline-current.json':
        relative = str(f.relative_to(W / 'baseline'))
        other = NEW / 'baseline' / relative
        b = f.read_bytes()
        if other.is_file():
            assert b == other.read_bytes(), 'FRESH_ARTIFACT_BYTE_DRIFT ' + relative
        files.append({'relative': relative, 'sha256': sha(b), 'parentFreshCounterpart': other.is_file(), 'preserveUnchanged': True})
for f in (NEW / 'baseline').rglob('*'):
    if f.is_file() and f.name != 'live-baseline-current.json':
        assert (W / 'baseline' / f.relative_to(NEW / 'baseline')).read_bytes() == f.read_bytes()
for a in c['baselineAssets']:
    assert sha((W / 'baseline' / a['relative']).read_bytes()) == a['sha256']
for key, f in [('admin', 'admin-index.js'), ('front', 'front-index.js')]:
    assert sha((W / 'baseline' / f).read_bytes()) == c['api'][key]
assert sha((W / 'baseline/index.html').read_bytes()) == c['beforeHtmlSha256']
(W / 'baseline/live-baseline-current.json').write_bytes(r)
(W / 'live-baseline-current.json').write_bytes(r)
p = W / 'backend-source-pins.json'
pins = json.loads(p.read_text())
pins['captureSha256'] = sha(r)
pins['captureProvenance'] = {'source': str(NEW / 'baseline/live-baseline-current.json'), 'capturedAtUtc': c['capturedAtUtc'], 'completedBy': 'parent fresh readonly capture; no remote call by backend subtask', 'archiveSha256': sha((NEW / 'baseline-capture.tar.gz').read_bytes()), 'allOtherBaselineFilesPreserved': True, 'allParentFreshArtifactsByteIdentical': True}
pins['parentRestoredEvidence']['scope'] = 'Archived prior router/publicPage and legacy-factory service tests only; current default snapshot lookup source binding/runtime is NOT supported by this report'
pins['parentRestoredEvidence']['currentDefaultLookupSourcePinSupport'] = False
pins['snapshotCodeEvidence'] = {'path': str(W / 'recovery-history/snapshot-code-handoff.md'), 'sha256': sha((W / 'recovery-history/snapshot-code-handoff.md').read_bytes()), 'reportedPassed': 226, 'reportedSkipped': 4, 'snapshotPassed': 201, 'rerunThisTask': False, 'serviceTestLegacyFactoryScopeOnly': True}
p.write_text(json.dumps(pins, indent=2) + '\n')
for row in files:
    assert sha((W / 'baseline' / row['relative']).read_bytes()) == row['sha256']
report = {'status': 'PASS', 'captureSha256': sha(r), 'capturedAtUtc': c['capturedAtUtc'], 'otherBaselineFiles': files, 'allOtherBaselineFilesPreserved': True, 'allParentFreshArtifactsByteIdentical': True, 'copiedReportsOnly': True, 'historicalPreliminaryCheckFailure': 'First overly-strict counterpart check rejected local pre-existing ChannelInventoryHost.reference.render.test.ts; no writes occurred. Corrected scope verifies all parent fresh artifacts and preserves every additional local baseline file.', 'databaseAccess': False, 'networkExecution': False}
(W / 'backend-candidate/baseline-byte-protection.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': 'PASS', 'captureSha256': sha(r), 'otherBaselineFileCount': len(files), 'archiveSha256': pins['captureProvenance']['archiveSha256']}))
