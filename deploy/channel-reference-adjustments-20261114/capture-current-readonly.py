#!/usr/bin/env python3
"""Parent-run on production; stdout is tar.gz. No SSH, DB, HTTP, PM2 startup or writes.
Requires a parent-pinned JSON contract; takes existing locks without creating files.
"""
import argparse, datetime, fcntl, hashlib, io, json, pathlib, re, stat, subprocess, sys, tarfile
OLD_ROOT = pathlib.Path('/opt/ops/20261114-channel-reference-pricing-CKSZQ7s')
NEW_ROOT = '/opt/ops/20261114-channel-reference-adjustments-YFqDo2A'
PUBLIC = pathlib.Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
ADMIN = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js'
FRONT = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
COORD = '/opt/ops/51-project-release-coordination-20261027.json'
LOCKS = ('/var/lock/dianzi51-public-deploy.lock', '/var/lock/dianzi51-production-code.lock')
HEX = re.compile(r'[0-9a-f]{64}')
sha = lambda b: hashlib.sha256(b).hexdigest()
def need(ok, msg):
    if not ok: raise RuntimeError(msg)
def regular(p):
    p = pathlib.Path(p)
    need(p.is_absolute(), 'ABSOLUTE_FILE_REQUIRED')
    for x in (p, *p.parents): need(not x.is_symlink(), 'SYMLINK_REFUSED')
    need(stat.S_ISREG(p.lstat().st_mode), 'REGULAR_FILE_REQUIRED')
    return p.read_bytes()
def rel(n):
    need(isinstance(n, str) and re.fullmatch(r'[A-Za-z0-9._/-]{1,240}', n) and all(x not in ('', '.', '..') for x in n.split('/')), 'UNSAFE_RELATIVE')
    return n
def pinned(p, h):
    need(isinstance(h, str) and HEX.fullmatch(h), 'FULL_SHA256_REQUIRED')
    b = regular(p); need(sha(b) == h, 'PIN_CHANGED: ' + str(p)); return b
def snapshot(reloader):
    r = subprocess.run(['node', str(reloader), '--snapshot'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
    need(r.returncode == 0, 'EXISTING_ATTACHED_PM2_SNAPSHOT_FAILED_NO_STARTUP_FALLBACK')
    rows = sorted(json.loads(r.stdout), key=lambda x: x['id'])
    need(len(rows) == 12 and len({x['id'] for x in rows}) == 12 and all(x['status'] == 'online' and x['pid'] > 0 for x in rows), 'EXACT_12_ONLINE_REQUIRED')
    group = [x for x in rows if x['name'] == 'dianzi51-admin']
    need({x['id'] for x in group} == {191, 192} and all(x['script'] == ADMIN and x['execMode'] == 'cluster_mode' for x in group), 'EXACT_ADMIN_191_192_REQUIRED')
    fields = {'id','name','pid','status','script','cwd','execMode','environmentHash'}
    need(all(set(x) == fields and HEX.fullmatch(x['environmentHash']) for x in rows), 'SANITIZED_SNAPSHOT_REQUIRED')
    return rows

def capture(c):
    need(c.get('contractVersion') == 'channel-adjustments-current-capture-v1', 'CONTRACT_VERSION_REQUIRED')
    need(c.get('oldRuntimeRoot') == str(OLD_ROOT) and c.get('newRuntimeRoot') == NEW_ROOT, 'FIXED_NAMESPACES_REQUIRED')
    need(c.get('currentSourceCommit','').startswith('442bebfc') and re.fullmatch(r'[0-9a-f]{40}', c['currentSourceCommit']), 'ACTUAL_CURRENT_COMMIT_REQUIRED')
    locks = []
    try:
        for p in LOCKS:
            # Existing locks only; never a+ and never create a lock pathname.
            f = open(p, 'r+b'); fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(f)
        meta = c['metadataPins']
        required = {'manifest.json', 'git-source-receipt.json', 'verified.json', 'live-baseline-current.json', 'reload-channel-reference-api.cjs'}
        need(set(meta) == required, 'EXACT_OLD_METADATA_PIN_SET_REQUIRED')
        files = {}; frozen = {}
        for n,h in meta.items():
            b = pinned(OLD_ROOT / rel(n), h); files['old-runtime-metadata/' + n] = b; frozen[str(OLD_ROOT/n)] = h
        manifest = json.loads(files['old-runtime-metadata/manifest.json'])
        receipt = json.loads(files['old-runtime-metadata/git-source-receipt.json'])
        need(meta['manifest.json'] == '53a81df12bc08b704e8a82141af65411f8da5959408e5850b3bd8793b30f20ef', 'ACTUAL_OLD_SOURCE_MANIFEST_REQUIRED')
        need(receipt.get('gitCommit') == c['currentSourceCommit'], 'CURRENT_SOURCE_RECEIPT_REQUIRED_NOT_C3')
        need(receipt.get('sourceHashes') == manifest.get('sourceHashes') and len(receipt['sourceHashes']) == 129, 'CURRENT_129_SOURCE_UNION_REQUIRED')
        # Preserve original namespace and actual package hash scope; never rebind old source hashes.
        for n,h in manifest['packageHashes'].items():
            need(n != 'manifest.json', 'LEGACY_SELF_PIN_REFUSED')
            pinned(OLD_ROOT / rel(n), h); frozen[str(OLD_ROOT/n)] = h
        for row in manifest['standaloneHelpers']:
            pinned(OLD_ROOT / rel(row['relative']), row['sha256']); frozen[str(OLD_ROOT/row['relative'])] = row['sha256']
        need({r['relative'] for r in manifest['standaloneHelpers']} == {'channel-reference-service.mjs','channel-reference-snapshot.json'}, 'OLD_TWO_HELPERS_REQUIRED')
        for n,h in receipt['sourceHashes'].items():
            files['source-snapshot/' + rel(n)] = pinned(OLD_ROOT/'source-snapshot'/n, h)
        coord = pinned(COORD, c['coordSha256']); need(json.loads(coord).get('shared_release_active') is False, 'ACTIVE_COORDINATION_ABORT')
        files['coordination-before.json'] = coord
        html = pinned(PUBLIC/'index.html', c['htmlSha256']); admin = pinned(ADMIN, c['adminSha256']); front = pinned(FRONT, c['frontSha256'])
        need(sha(html).startswith('f2845') and sha(admin).startswith('13bd'), 'CURRENT_ACTUAL_BYTES_REQUIRED_NOT_PHASE1')
        need(receipt.get('htmlSha256') == sha(html) and receipt.get('adminApiSha256') == sha(admin) and receipt.get('frontApiSha256') == sha(front), 'SOURCE_RECEIPT_RUNTIME_BINDING_REQUIRED')
        files.update({'index.html':html,'admin-index.js':admin,'front-index.js':front,'previous-source-receipt.json':files['old-runtime-metadata/git-source-receipt.json'],'previous-manifest.json':files['old-runtime-metadata/manifest.json']})
        assets = {r['relative']:r['sha256'] for r in manifest['baselineAssets']}
        for r in manifest['files']:
            if r['relative'] != 'index.html': assets[r['relative']] = r['sha256']
        # Every existing asset is frozen, including assets outside the older manifest union.
        for p in sorted((PUBLIC/'assets').rglob('*')):
            need(not p.is_symlink(), 'PUBLIC_ASSET_SYMLINK_REFUSED')
            if p.is_file():
                n = p.relative_to(PUBLIC).as_posix(); b = regular(p)
                if n in assets: need(sha(b) == assets[n], 'LEGACY_PUBLIC_ARTIFACT_DRIFT: ' + n)
                assets[n] = sha(b)
        for n,h in sorted(assets.items()): files[rel(n)] = pinned(PUBLIC/n,h)
        protected = manifest['protectedFiles']
        for r in protected: pinned(r['path'], r['sha256'])
        rows = snapshot(OLD_ROOT/'reload-channel-reference-api.cjs')
        before = {'html':sha(html),'admin':sha(admin),'front':sha(front)}
        # Repeat all external reads and process snapshot before emitting archive; fail closed on racing deploy.
        for p,h in frozen.items(): pinned(p,h)
        for n,h in assets.items(): pinned(PUBLIC/n,h)
        pinned(PUBLIC/'index.html',before['html']); pinned(ADMIN,before['admin']); pinned(FRONT,before['front']); pinned(COORD,sha(coord))
        for r in protected: pinned(r['path'],r['sha256'])
        need(snapshot(OLD_ROOT/'reload-channel-reference-api.cjs') == rows, 'PROCESS_DRIFT_DURING_CAPTURE')
        report = {'contractVersion':'channel-adjustments-fresh-baseline-v1','capturedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'captureContractSha256':sha((json.dumps(c,sort_keys=True,separators=(',',':'),ensure_ascii=False)).encode()),'oldRuntimeRoot':str(OLD_ROOT),'newRuntimeRoot':NEW_ROOT,'publicRoot':str(PUBLIC),'beforeHtmlSha256':before['html'],'api':{'admin':before['admin'],'front':before['front']},'apiPaths':{'admin':ADMIN,'front':FRONT},'sourceCommit':receipt['gitCommit'],'sourceReceiptSha256':meta['git-source-receipt.json'],'oldSourceManifestSha256':meta['manifest.json'],'sourceHashes':receipt['sourceHashes'],'baselineAssets':[{'relative':n,'sha256':h} for n,h in sorted(assets.items())],'legacyFrozenFiles':[{'path':p,'sha256':h} for p,h in sorted(frozen.items())],'protectedFiles':protected,'processes':rows,'processCount':12,'allOnline':True,'sharedReleaseActive':False,'coordSha256':sha(coord),'productionRecordWrites':0,'databaseAccess':False,'environmentValuesExported':False,'processSnapshotMethod':'existing-pinned-reloader --snapshot; pingDaemon+launchRPC; no connect/start fallback'}
        files['live-baseline-current.json'] = (json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode()
        b = io.BytesIO()
        with tarfile.open(fileobj=b,mode='w:gz') as t:
            for n,data in sorted(files.items()):
                item=tarfile.TarInfo(n);item.size=len(data);item.mode=0o600;t.addfile(item,io.BytesIO(data))
        sys.stdout.buffer.write(b.getvalue())
    finally:
        for f in reversed(locks): fcntl.flock(f,fcntl.LOCK_UN);f.close()
def main():
    p=argparse.ArgumentParser();p.add_argument('--contract',required=True);a=p.parse_args()
    capture(json.loads(regular(pathlib.Path(a.contract))))
if __name__ == '__main__':
    try: main()
    except Exception as e: print('CAPTURE_ABORT: '+str(e),file=sys.stderr);sys.exit(1)
