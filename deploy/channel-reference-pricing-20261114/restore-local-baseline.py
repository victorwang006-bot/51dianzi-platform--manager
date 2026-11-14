#!/usr/bin/env python3
"""Restore verified local parent capture and receipt-bound C3 blobs only.
No remote IO or deployed writes. Reads Git blobs without checkout/commit/push.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

REPO = Path(__file__).resolve().parent.parent.parent
W = Path('/home/ubuntu/work/channel-reference-phase2-20261114')
C3 = 'aeaf9f87f2fc96e210a635eee17c491f43df757a'
sha = lambda b: hashlib.sha256(b).hexdigest()

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--parent-work', required=True)
    ap.add_argument('--capture-sha256', required=True)
    args = ap.parse_args()
    parent = Path(args.parent_work)
    assert parent.is_absolute() and parent.is_dir() and not parent.is_symlink()
    report_path = parent / 'baseline/live-baseline-current.json'
    report_bytes = report_path.read_bytes()
    assert sha(report_bytes) == args.capture_sha256
    assert report_bytes == (parent / 'live-baseline-current.json').read_bytes()
    c = json.loads(report_bytes)
    assert c['sourceCommit'] == C3 and c['allOnline'] is True and c['sharedReleaseActive'] is False
    assert c['processCount'] == len(c['processes']) == 12 and all(x['status'] == 'online' for x in c['processes'])
    assert len(c['baselineAssets']) == 158 and len(c['protectedFiles']) == 4
    assert c['productionRecordWrites'] == 0 and c['databaseAccess'] is False and c['environmentValuesExported'] is False
    rpath = W / 'baseline/previous-source-receipt.json'
    rb = rpath.read_bytes()
    assert sha(rb) == '8e99c5975c8a8a6af1b78ab392fe32d3624d4431e00ce523fc41479707604010'
    receipt = json.loads(rb)
    assert receipt['gitCommit'] == C3 and receipt['sourceFiles'] == len(receipt['sourceHashes']) == 105
    snapshots = {}
    for name, pin in receipt['sourceHashes'].items():
        assert not name.startswith('/') and all(p not in ('', '.', '..') for p in name.split('/'))
        result = subprocess.run(['git', 'show', C3 + ':' + name], cwd=REPO, capture_output=True, check=True)
        assert sha(result.stdout) == pin, 'C3_RECEIPT_BLOB_MISMATCH ' + name
        snapshots[W / 'baseline/source-snapshot' / name] = result.stdout
    copies = {}
    for source in sorted((parent / 'baseline').rglob('*')):
        assert not source.is_symlink()
        if source.is_file():
            dest = W / 'baseline' / source.relative_to(parent / 'baseline')
            copies[dest] = source.read_bytes()
    for row in c['baselineAssets']:
        assert sha(copies[W / 'baseline' / row['relative']]) == row['sha256']
    for key, file in [('admin', 'admin-index.js'), ('front', 'front-index.js')]:
        assert sha(copies[W / 'baseline' / file]) == c['api'][key] == receipt[key + 'ApiSha256']
    assert sha(copies[W / 'baseline/index.html']) == c['beforeHtmlSha256'] == receipt['htmlSha256']
    copies[W / 'live-baseline-current.json'] = report_bytes
    copies.update(snapshots)
    # Validate all conflicts before the first write. Never replace baseline bytes.
    existing = {p: sha(p.read_bytes()) for p in (W / 'baseline').rglob('*') if p.is_file()}
    for dest, data in copies.items():
        assert not dest.is_symlink()
        if dest.exists():
            assert dest.read_bytes() == data, 'EXISTING_BASELINE_CAS_CONFLICT ' + str(dest)
    assert report_path.read_bytes() == report_bytes, 'PARENT_CAPTURE_MOVED'
    for dest, data in copies.items():
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            with dest.open('xb') as out: out.write(data)
            dest.chmod(0o600)
        assert dest.read_bytes() == data
    for file, pin in existing.items(): assert sha(file.read_bytes()) == pin
    for source in (parent / 'baseline').rglob('*'):
        if source.is_file(): assert source.read_bytes() == copies[W / 'baseline' / source.relative_to(parent / 'baseline')]
    result = {'status':'LOCAL_BASELINE_RESTORED','captureSha256':args.capture_sha256,'capturedAtUtc':c['capturedAtUtc'],
              'preservedAssets':len(c['baselineAssets']),'sourceReceiptBlobs':len(snapshots),'localGitBlobReadsOnly':True,
              'networkOperations':0,'databaseOperations':0,'productSourceWritten':False,'baselineHashesUnchanged':True}
    (W / 'local-baseline-recovery.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))

if __name__ == '__main__': main()
