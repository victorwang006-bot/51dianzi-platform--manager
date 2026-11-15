#!/usr/bin/env python3
"""Parent-run only, read-only. stdout=tar.gz, stderr=errors only. No SSH/HTTP/DB/reloads.
Capture the exact current verified inventory namespace, preserving every historical guard.
Protected environment file bytes and PM2 environment values are NEVER archived.
"""
import sys
sys.dont_write_bytecode=True
import argparse, contextlib, datetime, fcntl, hashlib, io, json, pathlib, re, stat, subprocess, tarfile
OLD='/opt/ops/20261115-inventory-compact-edit-cSy4W28'
ROOT='/opt/ops/20261115-customer-origin-edit-JfFQcJM'
COORD='/opt/ops/51-project-release-coordination-20261027.json'
ADMIN='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js'
FRONT='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
PUBLIC='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'
DATA='a00f52da7e423addf6b40508c972ad34df0eecec71250b1206ce9cb35c5ae436'
CURRENT_MANIFEST='ff1bc36f2f68ca01755154215fc99c97e614cc8f2b210a01a8573abfce4094db'
LOCKS=('/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock')
sha=lambda b:hashlib.sha256(b).hexdigest()
enc=lambda x:(json.dumps(x,ensure_ascii=False,indent=2)+'\n').encode()
def need(ok,label):
    if not ok:raise RuntimeError(label)
def no_symlinks(p):
    for q in [pathlib.Path(p),*pathlib.Path(p).parents]:need(not q.is_symlink(),'SYMLINK_REFUSED '+str(q))
def regular(p):
    p=pathlib.Path(p);need(p.is_absolute(),'ABSOLUTE_REQUIRED');no_symlinks(p);need(stat.S_ISREG(p.lstat().st_mode),'REGULAR_REQUIRED');return p.read_bytes()
def pin(p,h):
    need(isinstance(h,str) and re.fullmatch('[0-9a-f]{64}',h),'FULL_HASH_REQUIRED');b=regular(p);need(sha(b)==h,'PIN_DRIFT '+str(p));return b
def rel(n):
    need(isinstance(n,str) and re.fullmatch('[A-Za-z0-9._/-]{1,512}',n) and all(s not in ('','.','..') for s in n.split('/')),'UNSAFE_RELATIVE');return n
@contextlib.contextmanager
def locks():
    handles=[]
    try:
        for name in LOCKS:
            p=pathlib.Path(name)
            if p.parent.is_symlink():
                need(p.parent==pathlib.Path('/var/lock') and p.parent.resolve()==pathlib.Path('/run/lock'),'LOCK_SYMLINK_REFUSED');p=pathlib.Path('/run/lock')/p.name
            no_symlinks(p);need(stat.S_ISREG(p.lstat().st_mode),'EXISTING_REGULAR_LOCK_REQUIRED')
            f=open(p,'r+b');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);handles.append(f)
        yield
    finally:
        for f in reversed(handles):fcntl.flock(f,fcntl.LOCK_UN);f.close()
def tree(p):
    p=pathlib.Path(p);no_symlinks(p);need(p.is_dir(),'ROOT_DIRECTORY_REQUIRED');out=[]
    for f in p.rglob('*'):
        no_symlinks(f)
        if f.is_file():out.append([f.relative_to(p).as_posix(),sha(regular(f))])
        else:need(f.is_dir(),'TREE_NONREGULAR')
    return sorted(out)
def snapshot(h):
    pin(OLD+'/attached-admin-reloader.cjs',h)
    r=subprocess.run(['node',OLD+'/attached-admin-reloader.cjs','--snapshot'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=50,check=False)
    need(r.returncode==0,'EXISTING_ATTACHED_DAEMON_SNAPSHOT_FAILED_NO_FALLBACK')
    rows=sorted(json.loads(r.stdout),key=lambda r:r['id']);fields={'id','name','pid','status','script','cwd','execMode','environmentHash'}
    need(len(rows)==12 and len({r['id'] for r in rows})==12 and all(set(r)==fields and r['status']=='online' and r['pid']>0 and re.fullmatch('[0-9a-f]{64}',r['environmentHash']) for r in rows),'EXACT_12_SANITIZED_ONLINE')
    for ids,name,api in [((190,193,194,200),'dianzi51',FRONT),((191,192),'dianzi51-admin',ADMIN)]:
        need({r['id'] for r in rows if r['name']==name}==set(ids),'TARGET_GROUP_EXACT')
        need(all(r['script']==api and r['execMode']=='cluster_mode' for r in rows if r['id'] in ids),'TARGET_SCRIPT_MODE_EXACT')
    return rows
def capture(c,contract_bytes):
    need(c['contractVersion']=='customer-origin-edit-capture-contract-v1' and c['currentRuntimeRoot']==OLD and c['newRuntimeRoot']==ROOT and c['ownerTask']=='JfFQcJMqqFudyf4S9Egg7M','FIXED_ROUND_CONTRACT')
    need(c['metadataPins']['manifest.json']==CURRENT_MANIFEST and c['coordPath']==COORD,'EXACT_CURRENT_MANIFEST_COORD')
    need(set(c['metadataPins'])=={'manifest.json','input-contract.json','activation-state.json','release-owner.json','release-driver.py','attached-admin-reloader.cjs'},'EXACT_METADATA_REQUIRED')
    need(c['requiredSourceGraphCounts']=={'ui':148,'independent':2},'EXACT_CURRENT_SOURCE_GRAPHS')
    need(isinstance(c['protectedEnvFiles'],list) and len(c['protectedEnvFiles'])>0,'PROTECTED_ENV_HASH_ROWS_MUST_NOT_BE_OMITTED')
    files={};frozen={}
    def remember(p,h,n=None):
        b=pin(p,h);need(p not in frozen or frozen[p]==h,'CONFLICTING_PIN '+p);frozen[p]=h
        if n is not None:need(n not in files or files[n]==b,'CONFLICTING_ARCHIVE_PATH');files[n]=b
        return b
    with locks():
        for n,h in c['metadataPins'].items():remember(OLD+'/'+rel(n),h,'old-runtime-metadata/'+n)
        m=json.loads(files['old-runtime-metadata/manifest.json']);state=json.loads(files['old-runtime-metadata/activation-state.json']);owner=json.loads(files['old-runtime-metadata/release-owner.json'])
        need(m['contractVersion']=='inventory-compact-edit-release-v1' and m['fixtureOnly'] is False and m['runtimeRoot']==OLD,'ACTUAL_OLD_RELEASE_MANIFEST')
        need(m['apiPaths']=={'admin':ADMIN,'front':FRONT} and m['publicRoot']==PUBLIC,'EXACT_PRODUCTION_PATHS')
        need(m['sourceUnionCount']==len(m['sourceHashes'])==148 and len(m['independentSourceHashes'])==2,'CURRENT148_PLUS2_NO_FALLBACK')
        need(state['phase']=='verified' and state.get('closeIntent') is False and state['manifestSha256']==CURRENT_MANIFEST and state['inputContractSha256']==m['inputContractSha256'],'EXACT_VERIFIED_IDLE_LIFECYCLE')
        need(owner=={'ownerTask':state['ownerTask'],'runtimeRoot':OLD,'manifestSha256':CURRENT_MANIFEST,'inputContractSha256':m['inputContractSha256'],'nonce':state['rootOwnershipNonce']},'EXACT_OLD_ROOT_OWNER')
        need(c['metadataPins']['input-contract.json']==m['inputContractSha256'],'EXACT_INPUT_BINDING')
        for n in ('release-driver.py','attached-admin-reloader.cjs'):need(c['metadataPins'][n]==m['packageHashes'][n]==m['controlsPackageHashes'][n],'CURRENT_CONTROL_PIN')
        coord=remember(COORD,c['coordSha256'],'coordination-before.json');co=json.loads(coord)
        need(state['coordClosedSha256']==sha(coord) and co['shared_release_active'] is False and co['window']['opsDir']==OLD and co['window']['status']=='verified' and co['window']['owner_task']==state['ownerTask'] and co['window']['attemptId']==state['attemptId'] and co['window']['manifestSha256']==CURRENT_MANIFEST,'EXACT_CLOSED_CURRENT_WINDOW')
        need(c['api']=={'front':m['backendFiles'][0]['sha256'],'admin':m['untouchedAdminApiSha256']} and c['htmlSha256']==m['htmlSha256'],'CURRENT_API_HTML_PINS')
        dynamic={COORD:sha(coord),FRONT:c['api']['front'],ADMIN:c['api']['admin'],PUBLIC+'/index.html':c['htmlSha256']}
        need(m['manualDisabledGuard']==c['manualDisabledGuard']=={'path':'/var/lib/51dianzi/channel-reference-manual-v1/manual-refresh-config.json','expected':'absent'},'MANUAL_DISABLED_CONTRACT')
        no_symlinks(c['manualDisabledGuard']['path']);need(not pathlib.Path(c['manualDisabledGuard']['path']).exists(),'MANUAL_CONFIG_APPEARED')
        for n,h in m['packageHashes'].items():remember(OLD+'/'+rel(n),h)
        old_tree=tree(OLD);need(old_tree==c['currentRootTree'],'EXACT_FULL_CURRENT_ROOT_TREE')
        for n,h in old_tree:remember(OLD+'/'+rel(n),h)
        prior_trees=[]
        for r in m['frozenRootTrees']:
            t=tree(r['root']);need([n for n,h in t]==sorted(r['relativeFiles']),'OLD_FROZEN_ROOT_TREE_SHAPE_DRIFT');prior_trees.append({'root':r['root'],'files':t})
            for n,h in t:remember(r['root']+'/'+rel(n),h)
        # Rebase ONLY explicit live coordinator/API/HTML rows. All other 23k+ full pins retained.
        approved_historical={COORD:{m['capturedCoordSha256'],state['coordClosedSha256']},FRONT:{m['backendFiles'][0]['beforeSha256'],m['backendFiles'][0]['sha256']},ADMIN:{m['untouchedAdminApiSha256']},PUBLIC+'/index.html':{m['beforeHtmlSha256'],m['htmlSha256']}}
        rebases=[]
        for collection in ('legacyFrozenFiles','protectedFiles'):
            for r in m[collection]:
                if r['path'] in dynamic:
                    need(r['sha256'] in approved_historical[r['path']],'UNKNOWN_HISTORICAL_MUTABLE_PIN_NO_SILENT_REBASE '+r['path'])
                    if r['sha256']!=dynamic[r['path']]:rebases.append({'collection':collection,'path':r['path'],'priorSha256':r['sha256'],'currentSha256':dynamic[r['path']],'basis':'exact previous verified manifest API/HTML output or closed coordinator CAS'})
                remember(r['path'],dynamic.get(r['path'],r['sha256']))
        protected=[{'path':r['path'],'sha256':dynamic.get(r['path'],r['sha256'])} for r in m['protectedFiles']]
        for r in c['protectedEnvFiles']:
            need(set(r)=={'path','sha256'} and r['path'].startswith('/') and r['path'] not in dynamic,'ENV_PROTECTED_PATH_CONTRACT');remember(r['path'],r['sha256'])
        for kind in ('source','independent-source'):
            for n,h in m['sourceHashes' if kind=='source' else 'independentSourceHashes'].items():remember(OLD+'/'+kind+'-snapshot/'+rel(n),h,kind+'-snapshot/'+n)
        need(sorted(r['relative'] for r in m['runtimeHelpers'])==['channel-reference-service.mjs','channel-reference-snapshot.json','channel-reference-worker.mjs'],'EXACT_THREE_HELPERS')
        for r in m['runtimeHelpers']:remember(OLD+'/'+r['relative'],r['sha256'],r['relative'])
        need(m['datasetAfterSha256']==DATA and m['positiveSourceCount']==213 and m['runtimeHelperRecompiled'] is False and m['datasetChanges']==0,'EXACT_UNCHANGED213_NO_RUNTIME_REBUILD')
        remember(PUBLIC+'/index.html',c['htmlSha256'],'index.html');remember(FRONT,c['api']['front'],'front-index.js');remember(ADMIN,c['api']['admin'],'admin-index.js')
        assets={r['relative']:r['sha256'] for r in m['baselineAssets']}
        for r in m['files']:
            if r['relative']!='index.html':need(r['relative'] not in assets,'OLD_RELEASE_ASSET_COLLISION');assets[r['relative']]=r['sha256']
        actual=tree(PUBLIC+'/assets');need({'assets/'+n:h for n,h in actual}==assets,'ALL_CURRENT_ASSET_BYTES_AND_SHAPE_EXACT_NO_EXTRA')
        for n,h in sorted(assets.items()):remember(PUBLIC+'/'+rel(n),h,n)
        rows=snapshot(c['metadataPins']['attached-admin-reloader.cjs']);need(rows==c['preflightProcesses'],'PARENT_PREFLIGHT_FULL_ROWS_DRIFT')
        completed={r['id']:r['pid'] for r in state['completed'] if r['direction']=='forward'}
        for row in rows:
            b=next(r for r in m['baselineProcesses'] if r['id']==row['id']);need(row==({**b,'pid':completed[row['id']]} if row['id'] in (190,193,194,200) else b),'CURRENT_LIFECYCLE_COMPLETION_AND_8_FROZEN')
        # All hashes and every tree/PM2/disabled check repeated under BOTH original locks.
        for p,h in frozen.items():pin(p,h)
        need(tree(OLD)==old_tree and tree(PUBLIC+'/assets')==actual,'TREE_RACE')
        for r in prior_trees:need(tree(r['root'])==r['files'],'FROZEN_OLD_TREE_RACE')
        need(snapshot(c['metadataPins']['attached-admin-reloader.cjs'])==rows,'PROCESS_RACE')
        need(not pathlib.Path(c['manualDisabledGuard']['path']).exists(),'MANUAL_CONFIG_RACE')
        report={'contractVersion':'customer-origin-edit-fresh-baseline-v1','currentRuntimeRoot':OLD,'newRuntimeRoot':ROOT,'capturedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'captureContractSha256':sha(contract_bytes),'captureScriptSha256':sha(regular(pathlib.Path(__file__).resolve())),'previousManifestSha256':CURRENT_MANIFEST,'currentActivationStateSha256':c['metadataPins']['activation-state.json'],'currentRootTree':old_tree,'frozenRootTrees':prior_trees,'coordPath':COORD,'coordSha256':sha(coord),'apiPaths':m['apiPaths'],'publicRoot':PUBLIC,'api':c['api'],'beforeHtmlSha256':c['htmlSha256'],'sourceHashes':m['sourceHashes'],'independentSourceHashes':m['independentSourceHashes'],'sourceUnionCount':148,'independentSourceCount':2,'runtimeHelpers':m['runtimeHelpers'],'snapshotSha256':DATA,'positiveSourceCount':213,'processes':rows,'processCount':12,'baselineAssets':[{'relative':n,'sha256':h} for n,h in sorted(assets.items())],'protectedFiles':protected,'protectedEnvFiles':c['protectedEnvFiles'],'legacyFrozenFiles':[{'path':p,'sha256':h} for p,h in sorted(frozen.items())],'manualDisabledGuard':c['manualDisabledGuard'],'allOnline':True,'sharedReleaseActive':False,'environmentValuesExported':False,'productionRecordWrites':0,'apiWrites':0,'processReloads':0,'databaseAccess':False,'runtimeHelperRecompiled':False,'exactCurrentLifecycleGuardUsed':True,'exactRebasedPaths':sorted(dynamic),'doubleNonBlockingLocksUsed':list(LOCKS)}
        report['legitimatePriorReleaseRebases']=rebases
        files['previous-manifest.json']=files['old-runtime-metadata/manifest.json'];files['capture-contract.json']=contract_bytes;files['live-baseline-current.json']=enc(report)
        # Protected files are hash-only; archive contains approved code/static/source and public metadata only.
        out=io.BytesIO()
        with tarfile.open(fileobj=out,mode='w:gz') as t:
            for n,b in sorted(files.items()):
                item=tarfile.TarInfo(n);item.size=len(b);item.mode=0o600;t.addfile(item,io.BytesIO(b))
        sys.stdout.buffer.write(out.getvalue())
def main():
    p=argparse.ArgumentParser();p.add_argument('--contract',required=True);p.add_argument('--sha256',required=True);a=p.parse_args();b=pin(str(pathlib.Path(a.contract).resolve()),a.sha256);capture(json.loads(b),b)
if __name__=='__main__':
    try:main()
    except Exception as e:print('FRESH_CAPTURE_ABORT: '+str(e),file=sys.stderr);sys.exit(1)
