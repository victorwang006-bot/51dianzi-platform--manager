#!/usr/bin/env python3
"""Parent-run capture of exact current 5d55 v4 for inventory compact/edit.
Stdout tar.gz only, original double locks, original lifecycle load_package + frozen.
No disk writes/startup/SSH/HTTP/DB. All old ROOT trees remain immutable.
"""
import sys
sys.dont_write_bytecode = True
import argparse, datetime, hashlib, io, json, pathlib, re, stat, subprocess, tarfile, types
CURRENT = '/opt/ops/20261115-channel-reference-remediation-cSy4W28-v4'
NEW_ROOT = '/opt/ops/20261115-inventory-compact-edit-cSy4W28'
MANIFEST_SHA = '5d55c8e639ec9dc6c4cbd3fbc55c5e60b6b3fd471d939579ea4f0d6a28b24a11'
RECEIPT_SHA = 'b9d56aa8c57c3fd096dda2dc5830dee6fb3f7961596262a25e0283fb402bb894'
DATA_SHA = 'a00f52da7e423addf6b40508c972ad34df0eecec71250b1206ce9cb35c5ae436'
HEX = re.compile(r'[0-9a-f]{64}')
sha = lambda b: hashlib.sha256(b).hexdigest()
enc = lambda x: (json.dumps(x, ensure_ascii=False, indent=2)+'\n').encode()
def need(ok, msg):
    if not ok: raise RuntimeError(msg)
def regular(p):
    p = pathlib.Path(p)
    need(p.is_absolute(), 'ABSOLUTE_FILE_REQUIRED')
    for q in (p, *p.parents): need(not q.is_symlink(), 'SYMLINK_REFUSED '+str(q))
    need(stat.S_ISREG(p.lstat().st_mode), 'REGULAR_FILE_REQUIRED '+str(p))
    return p.read_bytes()
def rel(n):
    need(isinstance(n,str) and re.fullmatch(r'[A-Za-z0-9._/-]{1,512}',n) and all(x not in ('','.','..') for x in n.split('/')), 'UNSAFE_RELATIVE')
    return n
def pinned(p,h):
    need(isinstance(h,str) and HEX.fullmatch(h), 'FULL_SHA256_REQUIRED')
    b=regular(p);need(sha(b)==h,'PIN_CHANGED '+str(p));return b
def snapshot(reloader, admin):
    r=subprocess.run(['node',str(reloader),'--snapshot'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45)
    need(r.returncode==0,'EXISTING_ATTACHED_PM2_SNAPSHOT_FAILED_NO_STARTUP_FALLBACK')
    rows=sorted(json.loads(r.stdout),key=lambda x:x['id'])
    fields={'id','name','pid','status','script','cwd','execMode','environmentHash'}
    need(len(rows)==12 and len({x['id'] for x in rows})==12 and all(set(x)==fields and x['status']=='online' and isinstance(x['pid'],int) and x['pid']>0 and HEX.fullmatch(x['environmentHash']) for x in rows),'EXACT_12_SANITIZED_ONLINE_REQUIRED')
    group=[x for x in rows if x['name']=='dianzi51-admin']
    need({x['id'] for x in group}=={191,192} and all(x['script']==admin and x['execMode']=='cluster_mode' for x in group),'EXACT_ADMIN_191_192_REQUIRED')
    return rows
def tree(root):
    root=pathlib.Path(root);regular(root/'manifest.json');rows=[]
    for p in sorted(root.rglob('*')):
        need(not p.is_symlink(),'TREE_SYMLINK_REFUSED '+str(p))
        if p.is_file(): rows.append([p.relative_to(root).as_posix(),sha(regular(p))])
        else: need(p.is_dir(),'NONREGULAR_TREE_ENTRY')
    # pathlib orders by path components; the contract orders relative strings.
    # Use one canonical order without dropping or rebasing any file or full pin.
    return sorted(rows)

def capture(c,contract_bytes):
    need(c.get('contractVersion')=='inventory-compact-edit-current-v4-capture-v1','EXACT_CONTRACT_REQUIRED')
    need(c.get('currentRuntimeRoot')==CURRENT and c.get('newRuntimeRoot')==NEW_ROOT,'CURRENT_V4_PLANNED_INVENTORY_ROOT_ONLY')
    old=pathlib.Path(CURRENT);meta=c['metadataPins'];controls=('release-driver.py','attached-admin-reloader.cjs','validate-snapshot-helper.cjs')
    need(set(meta)=={'manifest.json','input-contract.json',*controls} and meta['manifest.json']==MANIFEST_SHA,'EXACT_5D55_METADATA_SET_REQUIRED')
    need(c['sourceReceipt']['sha256']==RECEIPT_SHA,'EXACT_CURRENT_LATEST_BINDING_RECEIPT_REQUIRED')
    files={};frozen={}
    def remember(p,h,name=None):
        b=pinned(p,h)
        need(str(p) not in frozen or frozen[str(p)]==h,'CONFLICTING_FULL_PIN '+str(p))
        frozen[str(p)]=h
        if name: files[name]=b
        return b
    for n,h in meta.items():remember(old/rel(n),h,'old-runtime-metadata/'+n)
    m=json.loads(files['old-runtime-metadata/manifest.json'])
    need(m['runtimeRoot']==CURRENT and m['fixtureOnly'] is False and m['sourceUnionCount']==len(m['sourceHashes'])==147 and m['priorSourceUnionCount']==len(m['priorSourceHashes'])==147,'ACTUAL_V4_147_CURRENT_147_PRIOR_REQUIRED')
    need(set(m['priorSourceHashes']).issubset(m['sourceHashes']),'PRIOR_GRAPH_REMOVAL')
    need(m['inputContractSha256']==meta['input-contract.json'],'CURRENT_INPUT_BINDING')
    for n in controls:need(meta[n]==m['controlsPackageHashes'][n]==m['packageHashes'][n],'CURRENT_CONTROL_BINDING '+n)
    driver=types.ModuleType('pinned_current_v4_driver');driver.__file__=str(old/'release-driver.py')
    exec(compile(files['old-runtime-metadata/release-driver.py'],driver.__file__,'exec'),driver.__dict__)
    need(driver.ROOT==CURRENT and c['coordination']['file']==driver.COORD,'EXACT_CURRENT_DRIVER_PATH_BINDING')
    with driver.IO().locks():
        receipt_bytes=remember(c['sourceReceipt']['file'],c['sourceReceipt']['sha256'],'previous-source-receipt.json');receipt=json.loads(receipt_bytes)
        need(receipt.get('contractVersion')=='channel-remediation-final-github-ecs-source-binding-v1' and receipt.get('status')=='PARENT_VERIFIED_LATEST_GIT_EQUALS_IMMUTABLE_ECS_SOURCES' and receipt['latestGitCommit']==c['currentSourceCommit'] and receipt['runtimeRoot']==CURRENT,'EXACT_LATEST_GITHUB_ECS_SOURCE_RECEIPT_REQUIRED')
        need(re.fullmatch('[0-9a-f]{40}',receipt['latestGitCommit']),'FULL_LATEST_COMMIT_REQUIRED')
        need(receipt['manifestSha256']==meta['manifest.json'] and receipt['sourceUnionCount']==147 and receipt['sourceHashes']==m['sourceHashes'],'CURRENT_RECEIPT_PACKAGE_SOURCE_BINDING')
        need(receipt['controlHashes']==m['controlsPackageHashes'] and set(receipt['controlHashes'])==set(controls),'ACTUAL_LATEST_CONTROL_HASH_SCHEMA_REQUIRED')
        activation_bytes=remember(c['activationInput']['file'],c['activationInput']['sha256'],'current-activation-input.json');activation=json.loads(activation_bytes)
        need(activation['runtimeRoot']==CURRENT and activation['manifestSha256']==meta['manifest.json'] and activation['inputContractSha256']==meta['input-contract.json'],'CURRENT_EXACT_ACTIVATION_INPUT_BINDING')
        state_bytes=remember(c['activationState']['file'],c['activationState']['sha256'],'current-activation-state.json');state=json.loads(state_bytes)
        need(c['activationState']['file']==CURRENT+'/activation-state.json' and state['phase']=='verified' and state['manifestSha256']==meta['manifest.json'] and state['inputSha256']==sha(activation_bytes) and not state.get('closeIntent'),'CURRENT_VERIFIED_IDLE_STATE_REQUIRED')
        coord=remember(c['coordination']['file'],c['coordination']['sha256'],'coordination-before.json')
        need(state['coordClosedSha256']==sha(coord) and json.loads(coord).get('shared_release_active') is False,'EXACT_CLOSED_COORD_STATE_BINDING')
        # Execute the current package loader and lifecycle guard under both ORIGINAL locks.
        current_io=driver.IO()
        pkg=driver.load_package(activation,current_io,require_final=False)
        need(pkg['manifestBytes']==files['old-runtime-metadata/manifest.json'],'CURRENT_LOADED_MANIFEST_FULL_BYTES_BINDING')
        engine=driver.Engine(activation,sha(activation_bytes),pkg,io=current_io)
        engine.load_state();engine.check_root();engine.frozen()
        dynamic={driver.COORD:sha(coord),driver.ADMIN:m['backendFiles'][0]['sha256'],driver.PUBLIC+'/index.html':m['htmlSha256']}
        historical={driver.COORD:m['capturedCoordSha256'],driver.ADMIN:m['backendFiles'][0]['beforeSha256'],driver.PUBLIC+'/index.html':m['beforeHtmlSha256']}
        for p,h in historical.items():
            rows=[r for r in m['legacyFrozenFiles'] if r['path']==p]
            need(len(rows)==1 and rows[0]['sha256']==h,'EXACT_HISTORICAL_THREE_ROWS_REQUIRED '+p)
        for n,h in m['packageHashes'].items():need(n!='manifest.json','SELF_PIN_REFUSED');remember(old/rel(n),h)
        # Exact current runtime file tree includes immutable package AND permitted activation journals/owner.
        current_tree=tree(old)
        for n,h in current_tree:remember(old/rel(n),h)
        for r in m['runtimeHelpers']:remember(old/rel(r['relative']),r['sha256'],r['relative'])
        for r in m['legacyFrozenFiles']:remember(r['path'],dynamic.get(r['path'],r['sha256']))
        for n,h in m['sourceHashes'].items():remember(old/'source-snapshot'/rel(n),h,'source-snapshot/'+n)
        for n,h in m['priorSourceHashes'].items():remember(old/'prior-source-snapshot'/rel(n),h,'prior-source-snapshot/'+n)
        need(set(c['rootConfigPins'])=={'package.json','pnpm-lock.yaml','tsconfig.json'},'EXACT_CONFIG_PINS_REQUIRED')
        for n,h in c['rootConfigPins'].items():need(m['sourceHashes'][n]==h,'CURRENT_CONFIG_SOURCE_BINDING')
        public=pathlib.Path(m['publicRoot']);admin=m['apiPaths']['admin'];front=m['apiPaths']['front']
        need(str(public)==driver.PUBLIC and admin==driver.ADMIN and front==driver.FRONT,'CURRENT_STABLE_PATHS_BINDING')
        need(len(m['backendFiles'])==1 and m['backendFiles'][0]['path']==admin and m['backendFiles'][0]['ownedIds']==[191,192],'ONE_ADMIN_TWO_IDS_REQUIRED')
        html_hash=m['htmlSha256'];admin_hash=m['backendFiles'][0]['sha256'];front_hash=m['untouchedFrontApiSha256']
        need(receipt['snapshotSha256']==m['datasetAfterSha256']==DATA_SHA and receipt['positiveSourceCount']==213 and receipt['sourceCount']==588,'CURRENT_RECEIPT_RUNTIME_213_UNCHANGED_BINDING')
        need(c['currentRuntimePins']=={'html':html_hash,'admin':admin_hash,'front':front_hash,'snapshot':DATA_SHA},'PARENT_ACTUAL_RUNTIME_PIN_BINDING')
        remember(public/'index.html',html_hash,'index.html');remember(admin,admin_hash,'admin-index.js');remember(front,front_hash,'front-index.js')
        assets={r['relative']:r['sha256'] for r in m['baselineAssets']}
        for r in m['files']:
            if r['relative']!='index.html':assets[r['relative']]=r['sha256']
        existing_assets=[]
        for p in sorted((public/'assets').rglob('*')):
            need(not p.is_symlink(),'PUBLIC_ASSET_SYMLINK_REFUSED')
            if p.is_file():
                n=p.relative_to(public).as_posix();h=sha(regular(p));existing_assets.append(n)
                if n in assets:need(assets[n]==h,'PUBLIC_ASSET_DRIFT '+n)
                assets[n]=h
            else:need(p.is_dir(),'NONREGULAR_PUBLIC_ENTRY')
        need(set(existing_assets)==set(assets),'UNEXPECTED_MISSING_PUBLIC_ASSET')
        for n,h in sorted(assets.items()):remember(public/rel(n),h,n)
        for r in m['protectedFiles']:remember(r['path'],r['sha256'])
        need(len(m['protectedFiles'])==4,'ORIGINAL_FOUR_SPECIAL_PROTECTIONS_REQUIRED')
        failed_rows={}
        for f in c['failedRoots']:
            root=f['root'];need(root in ('/opt/ops/20261115-channel-reference-remediation-cSy4W28','/opt/ops/20261115-channel-reference-remediation-cSy4W28-v2','/opt/ops/20261115-channel-reference-remediation-cSy4W28-v3'),'EXACT_FAILED_ROOTS_ONLY')
            t=tree(root);need(len(t)==f['fileCount'] and sha(json.dumps(t,separators=(',',':')).encode())==f['fileTreeSha256'],'FAILED_ROOT_EXACT_TREE_DRIFT '+root)
            failed_rows[root]=t
            for n,h in t:remember(pathlib.Path(root)/rel(n),h)
        need(len(failed_rows)==3,'ALL_OLD_V1_V2_V3_ROOT_TREES_REQUIRED')
        reloader=old/'attached-admin-reloader.cjs';rows=snapshot(reloader,admin)
        need(driver.rows_check(rows,m['baselineProcesses'],owned=(191,192))==rows,'CURRENT_V4_CONFIGS_OTHER_TEN_PID_FIELDS_REQUIRED')
        need(rows==c['preflightProcesses'],'PARENT_PREFLIGHT_PROCESS_FULL_ROWS_DRIFT')
        front_group=[r for r in rows if r['name']=='dianzi51']
        need([r['id'] for r in front_group]==[190,193,194,200] and all(r['script']==front and r['execMode']=='cluster_mode' for r in front_group),'EXACT_FRONT_FOUR_TARGET_BINDING')
        completed={r['id']:r['pid'] for r in state['completed'] if r['direction']=='forward'}
        need(all(completed.get(r['id'])==r['pid'] for r in rows if r['id'] in (191,192)),'FRESH_CURRENT_VERIFIED_PIDS_NO_OLD_PID_SUBSTITUTION')
        # Repeat guard, every full pin, every file-tree shape and exact snapshot under both locks.
        engine.load_state();engine.check_root();engine.frozen()
        for p,h in frozen.items():pinned(p,h)
        need(tree(old)==current_tree,'CURRENT_ROOT_TREE_RACE')
        for root,t in failed_rows.items():need(tree(root)==t,'FAILED_ROOT_TREE_RACE')
        now_assets=[p.relative_to(public).as_posix() for p in sorted((public/'assets').rglob('*')) if p.is_file()]
        need(now_assets==existing_assets,'PUBLIC_ASSET_TREE_RACE')
        need(snapshot(reloader,admin)==rows,'PROCESS_DRIFT_DURING_CAPTURE')
        for n in ('runtime-build-contract.json','service-binding-proof.json','service-entry-proof.txt','service-metafile.json','worker-metafile.json','compiled-host.js','host-metafile.json','source-pin-receipt.json','source-delta-scope.json'):
            remember(old/rel(n),m['packageHashes'][n],'current-package/'+n)
        files['previous-manifest.json']=files['old-runtime-metadata/manifest.json']
        files['historical-legacy-frozen-rows.json']=enc(m['legacyFrozenFiles'])
        files['current-root-file-tree.json']=enc(current_tree)
        files['failed-root-file-trees.json']=enc(failed_rows)
        report={'contractVersion':'inventory-compact-edit-fresh-baseline-v1','capturedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'captureContractSha256':sha(contract_bytes),'captureScriptSha256':sha(regular(pathlib.Path(__file__).resolve())),'parentPreflightSha256':c['parentPreflightSha256'],'currentRuntimeRoot':CURRENT,'oldRuntimeRoot':CURRENT,'newRuntimeRoot':NEW_ROOT,'publicRoot':str(public),'apiPaths':m['apiPaths'],'beforeHtmlSha256':html_hash,'api':{'admin':admin_hash,'front':front_hash},'sourceCommit':receipt['latestGitCommit'],'sourceReceiptSha256':sha(receipt_bytes),'oldSourceManifestSha256':meta['manifest.json'],'currentInputContractSha256':meta['input-contract.json'],'currentActivationInputSha256':sha(activation_bytes),'currentActivationStateSha256':sha(state_bytes),'sourceHashes':m['sourceHashes'],'priorSourceHashes':m['priorSourceHashes'],'sourceUnionCount':147,'priorSourceUnionCount':147,'rootConfigPins':c['rootConfigPins'],'baselineAssets':[{'relative':n,'sha256':h} for n,h in sorted(assets.items())],'legacyFrozenFiles':[{'path':p,'sha256':h} for p,h in sorted(frozen.items())],'historicalLegacyRowsSha256':sha(files['historical-legacy-frozen-rows.json']),'exactCurrentLifecycleGuardUsed':True,'exactRebasedPaths':sorted(dynamic),'currentRootFileTreeSha256':sha(json.dumps(current_tree,separators=(',',':')).encode()),'failedRoots':c['failedRoots'],'protectedFiles':m['protectedFiles'],'processes':rows,'processCount':12,'allOnline':True,'sharedReleaseActive':False,'coordPath':driver.COORD,'coordSha256':sha(coord),'manualDisabledGuard':m['manualDisabledGuard'],'manualConfigurationAbsent':True,'productionRecordWrites':0,'apiWrites':0,'processReloads':0,'databaseAccess':False,'environmentValuesExported':False,'processSnapshotMethod':'current pinned v4 attached-admin-reloader --snapshot; existing daemon only','lockGuardSourceSha256':meta['release-driver.py'],'snapshotSha256':DATA_SHA,'sourceRecordsCheckedByCapture':0,'positiveSourceCount':213,'plannedOwnedIds':[190,193,194,200],'untouchedIds':[r['id'] for r in rows if r['id'] not in (190,193,194,200)],'adminApiUnchanged':True,'adminReloads':0,'runtimeHelperRecompiled':False,'scope':'fresh actual current 5d55 v4 bytes; all147 current/147 prior/source/root configs; exact lifecycle guarded three pins; current v4 and exact v1/v2/v3 immutable ROOT package trees; all public assets/protected4/two admin and other10 tuples; manual disabled; no writes'}
        files['live-baseline-current.json']=enc(report)
        out=io.BytesIO()
        with tarfile.open(fileobj=out,mode='w:gz') as t:
            for n,data in sorted(files.items()):
                item=tarfile.TarInfo(n);item.size=len(data);item.mode=0o600;t.addfile(item,io.BytesIO(data))
        sys.stdout.buffer.write(out.getvalue())
def main():
    p=argparse.ArgumentParser();p.add_argument('--contract',required=True);p.add_argument('--sha256',required=True);a=p.parse_args();b=pinned(a.contract,a.sha256);capture(json.loads(b),b)
if __name__=='__main__':
    try:main()
    except Exception as e:print('CAPTURE_ABORT: '+str(e),file=sys.stderr);sys.exit(1)
