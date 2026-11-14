#!/usr/bin/env python3
import pathlib, json, hashlib, datetime
W = pathlib.Path('/home/ubuntu/work/channel-reference-phase2-20261114')
ROOT = pathlib.Path('/home/ubuntu/work/51dianzi-platform--manager')
sha = lambda b: hashlib.sha256(b).hexdigest()
g = json.loads((W / 'service-graph-proof.json').read_text())
assert g['status'] == 'PASS' and g['actualDefaultRuntimePassed'] is True
union = {}
for part in (g['service'], g['worker']):
    assert part['independentlyBuiltTwice'] and part['outputAndMetafileReproductionByteExact']
    assert sha((W / part['artifact']).read_bytes()) == part['artifactSha256']
    assert sha((W / part['metafile']).read_bytes()) == part['metafileSha256']
    meta = json.loads((W / part['metafile']).read_text())
    assert set(meta['inputs']) == set(part['sourceHashes'])
    for f, h in part['sourceHashes'].items():
        assert f not in union or union[f] == h
        union[f] = h
union.update(g['typeOnlySourceHashes'])
assert union == g['sourceHashes']
assert set(union) == set(g['actualSourceUnion']) and len(union) == g['sourceFiles']
for f, h in union.items():
    assert sha((ROOT / f).read_bytes()) == h, 'CURRENT_SOURCE_MOVED ' + f
assert union['server/channelReference/snapshot.ts'] == 'd7a2aae41574189e3c3a678885e4b86acb962f827eb7886991968072b2e0ff93'
assert union['server/channelReference/service.ts'] == '90c770c12049938beacca69246f36a99b050595c2d19a4ae466ff48be057bb66'
freeze = W / 'recovery/finite-source-freeze.json'
assert sha(freeze.read_bytes()) == '93dfb5bc56f0361de4c95173a749d53e2ae68f5fbfe49a75cedd01826920af0d'
approved = json.loads(freeze.read_bytes())['sourcePins']
assert approved == {
    'server/channelReference/snapshot.ts': 'd7a2aae41574189e3c3a678885e4b86acb962f827eb7886991968072b2e0ff93',
    'server/channelReference/snapshot.test.ts': 'd539ce112601c977f7a4c673db62998b5bc771a2069c2fa8242882d00fa2b783',
    'server/channelReference/service.ts': '90c770c12049938beacca69246f36a99b050595c2d19a4ae466ff48be057bb66',
}
for f, h in approved.items():
    assert sha((ROOT / f).read_bytes()) == h, 'EXACT_APPROVED_SOURCE_REQUIRED ' + f
p = W / 'backend-source-pins.json'
pins = json.loads(p.read_text())
old = pins['finalGraph']['sourceHashes']
assert set(old) == set(union)
assert all(old[f] == h for f, h in union.items() if f != 'server/channelReference/snapshot.ts'), 'UNAPPROVED_OTHER_SOURCE_CHANGE'
pins['finalGraph'] = {'proofSha256': sha((W / 'service-graph-proof.json').read_bytes()), 'serviceSha256': g['service']['artifactSha256'], 'workerSha256': g['worker']['artifactSha256'], 'sourceFiles': len(union), 'sourceHashes': dict(sorted(union.items())), 'defaultRuntimeProofSha256': g['defaultRuntimeProofSha256'], 'snapshotOnlyDefaultLookup': True, 'legacyNetworkCapableExportsPresent': True, 'workerUnusedNotDeployment': True, 'liveEvidencePendingResearch': True, 'formalJSONNotReady': True}
pins['snapshotCodeEvidence'] = {'path': str(freeze), 'sha256': sha(freeze.read_bytes()), 'sourcePins': approved,
    'scope': 'Finite raw-evidenced literals and exact public detail paths; 455 actual snapshot tests; source helper change only; not formal READY.'}
pins['verifiedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
p.write_text(json.dumps(pins, indent=2) + '\n')
print(json.dumps({'status': 'PASS', 'exactActualSourceFiles': len(union), 'sourcePinsSha256': sha(p.read_bytes()), 'finalGraph': pins['finalGraph']}))
