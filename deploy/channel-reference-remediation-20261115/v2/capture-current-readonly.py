#!/usr/bin/env python3
"""Parent-run only; tar.gz to stdout. Existing-lock/attached-snapshot reads only.
Adapted from verified 20261114 capture; no SSH, HTTP, DB, startup or disk writes.
All current-root/baseline bindings come from the parent's pinned current contract.
"""
import argparse, datetime, hashlib, io, json, pathlib, re, stat, subprocess, sys, tarfile, types
NEW_ROOT = '/opt/ops/20261115-channel-reference-remediation-YFqDo2A'
HEX = re.compile(r'[0-9a-f]{64}')
sha = lambda b: hashlib.sha256(b).hexdigest()
def need(ok, msg):
    if not ok: raise RuntimeError(msg)
def regular(p):
    p = pathlib.Path(p)
    need(p.is_absolute(), 'ABSOLUTE_FILE_REQUIRED')
    for x in (p, *p.parents): need(not x.is_symlink(), 'SYMLINK_REFUSED ' + str(x))
    need(stat.S_ISREG(p.lstat().st_mode), 'REGULAR_FILE_REQUIRED')
    return p.read_bytes()
def rel(n):
    need(isinstance(n, str) and re.fullmatch(r'[A-Za-z0-9._/-]{1,512}', n) and all(x not in ('', '.', '..') for x in n.split('/')), 'UNSAFE_RELATIVE')
    return n
def pinned(p, h):
    need(isinstance(h, str) and HEX.fullmatch(h), 'FULL_SHA256_REQUIRED')
    b = regular(p); need(sha(b) == h, 'PIN_CHANGED: ' + str(p)); return b
def snapshot(reloader, admin):
    r = subprocess.run(['node', str(reloader), '--snapshot'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
    need(r.returncode == 0, 'EXISTING_ATTACHED_PM2_SNAPSHOT_FAILED_NO_STARTUP_FALLBACK')
    rows = sorted(json.loads(r.stdout), key=lambda x: x['id'])
    need(len(rows) == 12 and len({x['id'] for x in rows}) == 12 and all(x['status'] == 'online' and x['pid'] > 0 for x in rows), 'EXACT_12_ONLINE_REQUIRED')
    group = [x for x in rows if x['name'] == 'dianzi51-admin']
    need({x['id'] for x in group} == {191, 192} and all(x['script'] == admin and x['execMode'] == 'cluster_mode' for x in group), 'EXACT_ADMIN_191_192_REQUIRED')
    fields = {'id','name','pid','status','script','cwd','execMode','environmentHash'}
    need(all(set(x) == fields and HEX.fullmatch(x['environmentHash']) for x in rows), 'SANITIZED_SNAPSHOT_REQUIRED')
    return rows

def capture(c, contract_bytes):
    need(c.get('contractVersion') == 'channel-remediation-current-capture-v1', 'CONTRACT_VERSION_REQUIRED')
    old = pathlib.Path(c['currentRuntimeRoot'])
    need(old.is_absolute() and str(old).startswith('/opt/ops/') and str(old) != NEW_ROOT and c.get('newRuntimeRoot') == NEW_ROOT, 'PARENT_CURRENT_DISTINCT_ROOT_REQUIRED')
    files, frozen = {}, {}
    def remember(p, h, name=None):
        b = pinned(p,h); frozen[str(p)] = h
        if name: files[name] = b
        return b
    meta = c['metadataPins']
    need(set(meta) == {'manifest.json','input-contract.json','release-driver.py','attached-admin-reloader.cjs'}, 'EXACT_CURRENT_METADATA_SET_REQUIRED')
    for n,h in meta.items(): remember(old/rel(n),h,'old-runtime-metadata/'+n)
    m = json.loads(files['old-runtime-metadata/manifest.json'])
    need(m['runtimeRoot'] == str(old) and m['fixtureOnly'] is False, 'CURRENT_MANIFEST_ROOT_BINDING')
    need(m['sourceUnionCount'] == len(m['sourceHashes']) == 130 and m['priorSourceUnionCount'] == len(m['priorSourceHashes']) == 129, 'CURRENT_129_TO_130_GRAPH_REQUIRED')
    need(set(m['priorSourceHashes']).issubset(m['sourceHashes']), 'PRIOR_GRAPH_REMOVAL')
    need(m['inputContractSha256'] == meta['input-contract.json'], 'CURRENT_INPUT_PIN_BINDING')
    for n in ('release-driver.py','attached-admin-reloader.cjs'):
        need(meta[n] == m['controlsPackageHashes'][n] == m['packageHashes'][n], 'CURRENT_CONTROL_BINDING')
    driver = types.ModuleType('pinned_current_release_driver')
    driver.__file__ = str(old/'release-driver.py')
    exec(compile(files['old-runtime-metadata/release-driver.py'], driver.__file__, 'exec'), driver.__dict__)
    need(driver.ROOT == str(old), 'CURRENT_LOCK_GUARD_ROOT_BINDING')
    need(c['coordination']['file'] == driver.COORD, 'COORD_PATH_CURRENT_DRIVER_BINDING')
    with driver.IO().locks(): # exact current18-tested /var/lock -> /run/lock guard; r+b existing files
        receipt_bytes = remember(c['sourceReceipt']['file'],c['sourceReceipt']['sha256'],'previous-source-receipt.json')
        receipt = json.loads(receipt_bytes)
        need(receipt.get('status') == 'VERIFIED_GITHUB_ECS_SOURCE_MATCH' and receipt['gitCommit'] == c['currentSourceCommit'], 'CURRENT_VERIFIED_SOURCE_RECEIPT_REQUIRED')
        need(re.fullmatch(r'[0-9a-f]{40}',receipt['gitCommit']) and receipt['runtimeRoot'] == str(old), 'CURRENT_COMMIT_ROOT_BINDING')
        need(receipt['manifestSha256'] == meta['manifest.json'] and receipt['inputContractSha256'] == meta['input-contract.json'], 'CURRENT_RECEIPT_PACKAGE_BINDING')
        need(receipt['sourceHashes'] == m['sourceHashes'] and receipt['controlsPackageHashes'] == m['controlsPackageHashes'], 'CURRENT_130_SOURCE_CONTROL_BINDING')
        files['previous-manifest.json'] = files['old-runtime-metadata/manifest.json']
        for n,h in m['packageHashes'].items():
            need(n != 'manifest.json','SELF_MANIFEST_PIN_REFUSED'); remember(old/rel(n),h)
        for r in m['runtimeHelpers']: remember(old/rel(r['relative']),r['sha256'],r['relative'])
        for r in m['legacyFrozenFiles']: remember(r['path'],r['sha256'])
        for n,h in m['sourceHashes'].items(): remember(old/'source-snapshot'/rel(n),h,'source-snapshot/'+n)
        need(set(c['rootConfigPins']) == {'package.json','pnpm-lock.yaml','tsconfig.json'}, 'EXACT_ROOT_CONFIG_PINS')
        for n,h in c['rootConfigPins'].items(): need(m['sourceHashes'][n] == h, 'CURRENT_ROOT_CONFIG_HASH_BINDING '+n)
        public = pathlib.Path(m['publicRoot']); admin = m['apiPaths']['admin']; front = m['apiPaths']['front']
        need(str(public) == driver.PUBLIC and admin == driver.ADMIN and front == driver.FRONT, 'CURRENT_PATHS_DRIVER_MANIFEST_COMPATIBILITY')
        need(len(m['backendFiles']) == 1 and m['backendFiles'][0]['path'] == admin and m['backendFiles'][0]['ownedIds'] == [191,192], 'CURRENT_ADMIN_191_192_BINDING')
        html_hash = m['htmlSha256']; admin_hash = m['backendFiles'][0]['sha256']; front_hash = m['untouchedFrontApiSha256']
        need(receipt['htmlSha256'] == html_hash and receipt['adminApiSha256'] == admin_hash, 'CURRENT_RECEIPT_RUNTIME_BINDING')
        remember(public/'index.html',html_hash,'index.html'); remember(admin,admin_hash,'admin-index.js'); remember(front,front_hash,'front-index.js')
        coord = remember(c['coordination']['file'],c['coordination']['sha256'],'coordination-before.json')
        need(json.loads(coord).get('shared_release_active') is False, 'ACTIVE_COORDINATION_ABORT')
        state_bytes = remember(c['activationState']['file'],c['activationState']['sha256'],'current-activation-state.json')
        state = json.loads(state_bytes)
        need(c['activationState']['file'] == str(old/'activation-state.json') and state['phase'] == 'verified' and state['manifestSha256'] == meta['manifest.json'], 'CURRENT_VERIFIED_STATE_BINDING')
        need(state['coordClosedSha256'] == sha(coord) and not state.get('closeIntent'), 'VERIFIED_IDLE_COORDINATION_BINDING')
        assets = {r['relative']:r['sha256'] for r in m['baselineAssets']}
        for r in m['files']:
            if r['relative'] != 'index.html': assets[r['relative']] = r['sha256']
        for p in sorted((public/'assets').rglob('*')):
            need(not p.is_symlink(), 'PUBLIC_ASSET_SYMLINK_REFUSED')
            if p.is_file():
                n=p.relative_to(public).as_posix(); b=regular(p)
                if n in assets: need(sha(b) == assets[n], 'CURRENT_PUBLIC_ARTIFACT_DRIFT '+n)
                assets[n]=sha(b)
        for n,h in sorted(assets.items()): remember(public/rel(n),h,n)
        for r in m['protectedFiles']: remember(r['path'],r['sha256'])
        reloader=old/'attached-admin-reloader.cjs'; rows=snapshot(reloader,admin)
        need(driver.rows_check(rows,m['baselineProcesses'],owned=(191,192)) == rows, 'CURRENT_CONFIGS_OTHER10_REQUIRED')
        completed={r['id']:r['pid'] for r in state['completed'] if r['direction']=='forward'}
        need(all(completed.get(r['id']) == r['pid'] for r in rows if r['id'] in (191,192)), 'CURRENT_VERIFIED_191_192_PIDS_REQUIRED')
        # C3 current-base bindings are fresh here, not copied from old baseline or proof namespaces.
        for p,h in frozen.items(): pinned(p,h)
        need(snapshot(reloader,admin) == rows, 'PROCESS_DRIFT_DURING_CAPTURE')
        report={'contractVersion':'channel-remediation-fresh-baseline-v1','capturedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'captureContractSha256':sha(contract_bytes),'currentRuntimeRoot':str(old),'oldRuntimeRoot':str(old),'newRuntimeRoot':NEW_ROOT,'publicRoot':str(public),'apiPaths':m['apiPaths'],'beforeHtmlSha256':html_hash,'api':{'admin':admin_hash,'front':front_hash},'sourceCommit':receipt['gitCommit'],'sourceReceiptSha256':sha(receipt_bytes),'oldSourceManifestSha256':meta['manifest.json'],'currentInputContractSha256':meta['input-contract.json'],'sourceHashes':m['sourceHashes'],'priorSourceHashes':m['priorSourceHashes'],'rootConfigPins':c['rootConfigPins'],'baselineAssets':[{'relative':n,'sha256':h} for n,h in sorted(assets.items())],'legacyFrozenFiles':[{'path':p,'sha256':h} for p,h in sorted(frozen.items())],'protectedFiles':m['protectedFiles'],'processes':rows,'processCount':12,'allOnline':True,'sharedReleaseActive':False,'coordPath':c['coordination']['file'],'coordSha256':sha(coord),'productionRecordWrites':0,'databaseAccess':False,'environmentValuesExported':False,'processSnapshotMethod':'current pinned attached-admin-reloader --snapshot; existing daemon only','lockGuardSourceSha256':meta['release-driver.py'],'scope':'fresh current admin HTML/API/all assets/130 sources/129 prior union/root configs/12 PIDs/protected nginx dump main API+HTML/current+legacy ROOT packages; no cache or business writes'}
        files['live-baseline-current.json']=(json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode()
        archive=io.BytesIO()
        with tarfile.open(fileobj=archive,mode='w:gz') as t:
            for n,data in sorted(files.items()):
                item=tarfile.TarInfo(n);item.size=len(data);item.mode=0o600;t.addfile(item,io.BytesIO(data))
        sys.stdout.buffer.write(archive.getvalue())
def main():
    p=argparse.ArgumentParser();p.add_argument('--contract',required=True);p.add_argument('--sha256',required=True);a=p.parse_args()
    b=pinned(a.contract,a.sha256);capture(json.loads(b),b)
if __name__ == '__main__':
    try: main()
    except Exception as e: print('CAPTURE_ABORT: '+str(e),file=sys.stderr);sys.exit(1)
