#!/usr/bin/env python3
"""New namespace exact-byte driver. All production execution belongs to parent.
No SSH/Git/DB/HTTP, PM2 startup, env override, whole restart or legacy-driver import.
"""
import argparse, contextlib, copy, datetime, fcntl, hashlib, json, os, pathlib, re, shutil, stat, subprocess, sys, uuid
sys.dont_write_bytecode=True
ROOT='/opt/ops/20261115-inventory-compact-edit-cSy4W28'
OLD='/opt/ops/20261115-channel-reference-remediation-cSy4W28-v4'
COORD='/opt/ops/51-project-release-coordination-20261027.json'
LOCKS=('/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock')
ADMIN='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js'
FRONT='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
TARGET_API=FRONT
PUBLIC='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'
IDS=(190,193,194,200)
sha=lambda b:hashlib.sha256(b).hexdigest()
enc=lambda x:(json.dumps(x,ensure_ascii=False,indent=2)+'\n').encode()
utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def need(value,label):
    if not value: raise RuntimeError(label)
def rel(n):
    need(isinstance(n,str) and re.fullmatch(r'[A-Za-z0-9._/-]{1,512}',n) and all(x not in ('','.','..') for x in n.split('/')), 'UNSAFE_RELATIVE')
    return n
def no_symlinks(p):
    p=pathlib.Path(p)
    for q in [p,*p.parents]:
        if q.exists() or q.is_symlink(): need(not q.is_symlink(),'SYMLINK_REFUSED '+str(q))
class IO:
    """Production IO; fixture tests use a separate subclass mapping every path."""
    def path(self,p): return pathlib.Path(p)
    def exists(self,p): return self.path(p).exists()
    def files(self,p):
        q=self.path(p);no_symlinks(q);need(q.is_dir(),'PACKAGE_DIRECTORY_REQUIRED')
        out=[]
        for f in q.rglob('*'):
            no_symlinks(f)
            if f.is_file():out.append(f.relative_to(q).as_posix())
            else:need(f.is_dir(),'NON_REGULAR_PACKAGE_ENTRY')
        return set(out)
    def read(self,p):
        q=self.path(p);no_symlinks(q);need(q.is_file(),'REGULAR_FILE_REQUIRED '+p)
        return q.read_bytes()
    def pinned(self,p,h):
        need(isinstance(h,str) and re.fullmatch('[0-9a-f]{64}',h),'FULL_SHA_REQUIRED')
        b=self.read(p);need(sha(b)==h,'PIN_DRIFT '+p);return b
    def put(self,p,b,exclusive=False):
        q=self.path(p);no_symlinks(q);need(q.parent.is_dir(),'EXISTING_PARENT_REQUIRED')
        if exclusive:
            fd=os.open(q,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
            self.sync(q.parent);return
        self.atomic(q,b)
    def atomic(self,q,b,expected=None):
        no_symlinks(q);old=q.stat() if q.exists() else None
        if expected is not None:need(self.read(str(q))==expected,'FULL_BYTES_CAS_DRIFT '+str(q))
        tmp=q.parent/('.channel-adjustments-'+uuid.uuid4().hex+'.tmp')
        fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,stat.S_IMODE(old.st_mode) if old else 0o600)
        try:
            with os.fdopen(fd,'wb') as f:
                if old:os.fchmod(f.fileno(),stat.S_IMODE(old.st_mode));os.fchown(f.fileno(),old.st_uid,old.st_gid)
                f.write(b);f.flush();os.fsync(f.fileno())
            if expected is not None:need(self.read(str(q))==expected,'LAST_FULL_BYTES_CAS_DRIFT '+str(q))
            os.replace(tmp,q);self.sync(q.parent)
        finally:
            if tmp.exists():tmp.unlink()
    def cas(self,p,before,after):
        q=self.path(p);need(self.read(p)==before,'FULL_BYTES_CAS_DRIFT '+p)
        # Data-only HTML has identical full bytes: retain exact CAS double guard, no file write.
        if before==after:
            need(self.read(p)==after,'POST_CAS_CHANGED '+p);return
        # self.atomic receives real resolved path, including in fixture IO.
        self.atomic(q,after,expected=before)
        need(self.read(p)==after,'POST_CAS_CHANGED '+p)
    def add(self,p,b):
        q=self.path(p);no_symlinks(q);need(not q.exists(),'ADDITIVE_PUBLIC_ASSET_ALREADY_EXISTS '+p)
        q.parent.mkdir(parents=True,exist_ok=True);self.put(p,b,exclusive=True)
        # Public leaves must be readable; old public modes are untouched.
        os.chmod(q,0o644);self.sync(q.parent)
    def append(self,p,b):
        q=self.path(p);no_symlinks(q);fd=os.open(q,os.O_WRONLY|os.O_CREAT|os.O_APPEND|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as f:f.write(b);f.flush();os.fsync(f.fileno())
    @staticmethod
    def sync(q):
        fd=os.open(q,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
    @contextlib.contextmanager
    def locks(self):
        handles=[]
        try:
            for p in LOCKS:
                q=self.path(p);need(not q.is_symlink(),'SYMLINK_REFUSED '+str(q))
                if q.parent.is_symlink():
                    need(q.parent==self.path('/var/lock') and q.parent.resolve(strict=True)==self.path('/run/lock'),'SYMLINK_REFUSED '+str(q.parent))
                    q=self.path('/run/lock')/q.name
                no_symlinks(q);need(stat.S_ISREG(q.stat().st_mode),'REGULAR_LOCK_FILE_REQUIRED '+str(q))
                f=open(q,'r+b');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);handles.append(f)
            yield
        finally:
            for f in reversed(handles):fcntl.flock(f,fcntl.LOCK_UN);f.close()
def inverse(before,after,proof):
    need(sha(before)==proof['beforeSha256'] and sha(after)==proof['afterSha256'],'INVERSE_PIN_MISMATCH')
    import base64
    restored=after
    for p in reversed(proof['patches']):
        pre=base64.b64decode(p['beforeBase64']);post=base64.b64decode(p['afterBase64'])
        need(before[p['start']:p['end']]==pre and after[p['afterStart']:p['afterEnd']]==post,'INVERSE_SLICE_MISMATCH')
        restored=restored[:p['afterStart']]+pre+restored[p['afterEnd']:]
    need(restored==before,'FULL_NATIVE_INVERSE_FAILED')
    for p in proof['unchangedPartitions']:need(before[p['beforeStart']:p['beforeEnd']]==after[p['afterStart']:p['afterEnd']],'NATIVE_GUARD_UNCHANGED_PARTITION_DRIFT')
def config(p):return {k:v for k,v in p.items() if k not in ('pid','status')}
def rows_check(rows,before,owned=(),changed=(),offline=False):
    need(len(rows)==len(before)==12 and len({p['id'] for p in rows})==12,'EXACT_EXISTING_12_REQUIRED')
    current={p['id']:p for p in rows}
    for old in before:
        need(old['id'] in current,'PROCESS_ID_DRIFT');p=current[old['id']]
        if old['id'] not in IDS:need(p==old,'OTHER_8_ALL_CAPTURED_FIELDS_PID_FROZEN '+str(old['id']));continue
        need(old['name']=='dianzi51' and old['script']==TARGET_API and old['execMode']=='cluster_mode','EXACT_FRONT_190_193_194_200_BINDING')
        need(config(p)==config(old),'FRONT_CONFIG_ENV_CWD_SCRIPT_DRIFT')
        if old['id'] not in owned:need(p==old,'UNOWNED_FRONT_PID_STATUS_DRIFT')
        if not offline or old['id'] not in owned:need(p['status']=='online' and p['pid']>0,'ALL_ONLINE_REQUIRED')
        if old['id'] in changed:need(p['pid']!=old['pid'],'FRONT_PID_NOT_CHANGED')
    return rows
def source_delta_guard(prior,current,approved,additions=()):
    need(isinstance(prior,dict) and isinstance(current,dict) and len(prior)==147 and set(prior).issubset(current),'CURRENT_147_GRAPH_NO_REMOVAL')
    need(isinstance(approved,list) and 1<=len(approved)<=24 and len({r.get('relative') for r in approved})==len(approved),'UNIQUE_PARENT_APPROVED_SOURCE_DELTAS')
    actual=[]
    for n in sorted(prior):
        need(all(isinstance(h,str) and re.fullmatch('[0-9a-f]{64}',h) for h in (prior[n],current[n])),'FULL_SOURCE_SHA_REQUIRED')
        if prior[n]!=current[n]:actual.append({'relative':n,'beforeSha256':prior[n],'afterSha256':current[n]})
    for r in approved:
        need(set(r)=={'relative','beforeSha256','afterSha256'} and r['relative'] in prior and r['beforeSha256']!=r['afterSha256'],'EXACT_EXISTING_SOURCE_DELTA_REQUIRED')
        need(not r['relative'].startswith('server/channelReference/') and r['relative'] not in ('server/channelReferenceRouter.ts','shared/channelReference.ts','shared/channelReferenceBrand.ts','shared/channelReferenceRefresh.ts'),'REFERENCE_RUNTIME_SOURCE_MUST_REMAIN_UNCHANGED')
    need(actual==sorted(approved,key=lambda r:r['relative']),'EXACT_PARENT_APPROVED_SOURCE_DELTA_HASHES')
    need(isinstance(additions,list) and len({r.get('relative') for r in additions})==len(additions),'EXACT_UNIQUE_PARENT_APPROVED_ADDITIONS')
    need(sorted(additions,key=lambda r:r['relative'])==[{'relative':n,'sha256':current[n]} for n in sorted(set(current)-set(prior))],'NO_UNAPPROVED_NEW_SOURCE_PATH')
    for r in additions:rel(r['relative']);need(re.fullmatch('[0-9a-f]{64}',r['sha256']),'FULL_ADDED_SOURCE_SHA_REQUIRED')
    return actual
def load_package(c,io,require_final=True):
    need(c['contractVersion']=='inventory-compact-edit-activation-v1' and c['runtimeRoot']==ROOT,'ACTIVATION_CONTRACT_VERSION_ROOT')
    need(c['ownerTask']=='cSy4W284Up1OQWfrwWJm6K' and re.fullmatch(r'[A-Za-z0-9_-]{16,96}',c['attemptId']) and re.fullmatch(r'[A-Za-z0-9_-]{16,96}',c['rootOwnershipNonce']),'NEW_ATTEMPT_OWNER_REQUIRED')
    candidate=str(pathlib.Path(c['candidateDir']).resolve());mbytes=io.pinned(candidate+'/manifest.json',c['manifestSha256']);m=json.loads(mbytes)
    need(m['contractVersion']=='inventory-compact-edit-release-v1' and m['runtimeRoot']==ROOT and m['priorRuntimeRoot']==OLD and m['fixtureOnly'] is False,'ACTUAL_NEW_MANIFEST_ONLY')
    need(m['ownerTask']==c['ownerTask'] and m['inputContractSha256']==c['inputContractSha256'],'INPUT_SOURCE_BINDING')
    need(io.files(candidate)=={'manifest.json',*m['packageHashes']},'UNKNOWN_EXTRA_OR_MISSING_PACKAGE_FILE')
    need(m['publicRoot']==PUBLIC and m['apiPaths']=={'admin':ADMIN,'front':FRONT},'STABLE_PRODUCTION_PATHS')
    need(len(m['backendFiles'])==1 and m['backendFiles'][0]['path']==TARGET_API and m['backendFiles'][0]['ownedIds']==list(IDS),'ONE_FRONT_API_FOUR_ORIGINAL_IDS')
    need(len(m['baselineProcesses'])==12 and len(m['baselineAssets'])>0,'REAL_CURRENT_BASELINE_REQUIRED')
    need(sorted(r['relative'] for r in m['runtimeHelpers'])==['channel-reference-service.mjs','channel-reference-snapshot.json','channel-reference-worker.mjs'],'EXACT_THREE_PRIVATE_HELPERS')
    for n,h in m['packageHashes'].items():io.pinned(candidate+'/'+rel(n),h)
    for n,h in m['sourceHashes'].items():io.pinned(candidate+'/source-snapshot/'+rel(n),h)
    deltas=source_delta_guard(m['priorSourceHashes'],m['sourceHashes'],m['approvedSourceDeltas'],m['approvedSourceAdditions'])
    need(m['priorSourceReceiptSha256']=='b9d56aa8c57c3fd096dda2dc5830dee6fb3f7961596262a25e0283fb402bb894' and m['priorSourceManifestSha256']=='5d55c8e639ec9dc6c4cbd3fbc55c5e60b6b3fd471d939579ea4f0d6a28b24a11','EXACT_CURRENT_V4_RECEIPT_MANIFEST_REQUIRED')
    prior_receipt=json.loads(io.pinned(candidate+'/previous-source-receipt.json',m['priorSourceReceiptSha256']));baseline=json.loads(io.pinned(candidate+'/live-baseline-current.json',m['baselineReportSha256']))
    need(prior_receipt['contractVersion']=='channel-remediation-final-github-ecs-source-binding-v1' and prior_receipt['status']=='PARENT_VERIFIED_LATEST_GIT_EQUALS_IMMUTABLE_ECS_SOURCES' and prior_receipt['sourceHashes']==baseline['sourceHashes']==m['priorSourceHashes'],'ACTUAL_CURRENT_V4_PRIOR147_PIN')
    need(baseline['contractVersion']=='inventory-compact-edit-fresh-baseline-v1' and baseline['currentRuntimeRoot']==OLD and baseline['newRuntimeRoot']==ROOT and baseline['oldSourceManifestSha256']==m['priorSourceManifestSha256'] and baseline['sourceReceiptSha256']==m['priorSourceReceiptSha256'] and baseline['exactCurrentLifecycleGuardUsed'] is True,'FRESH_CAPTURE_NOT_HISTORICAL_ASSUMPTION')
    need(baseline['api']['front']==m['backendFiles'][0]['beforeSha256'] and baseline['api']['admin']==m['untouchedAdminApiSha256'] and baseline['beforeHtmlSha256']==m['beforeHtmlSha256'] and baseline['coordSha256']==m['capturedCoordSha256'],'ACTUAL_FULL_BEFORE_PINS_REQUIRED')
    need(baseline['protectedFiles']==m['protectedFiles'] and baseline['legacyFrozenFiles']==m['legacyFrozenFiles'] and baseline['processes']==m['baselineProcesses'] and baseline['baselineAssets']==m['baselineAssets'],'NO_CAPTURED_PROTECTION_ROWS_REMOVED_OR_SUBSTITUTED')
    need(m['datasetAfterSha256']==baseline['snapshotSha256']=='a00f52da7e423addf6b40508c972ad34df0eecec71250b1206ce9cb35c5ae436' and baseline['positiveSourceCount']==213,'EXACT_UNCHANGED_213_SNAPSHOT')
    prior_manifest=json.loads(io.pinned(candidate+'/previous-manifest.json',m['priorSourceManifestSha256']))
    need(prior_receipt['controlHashes']==prior_manifest['controlsPackageHashes'],'LATEST_CONTROL_BINDING')
    for r in m['runtimeHelpers']:need(r['sha256']==next(x['sha256'] for x in prior_manifest['runtimeHelpers'] if x['relative']==r['relative']),'RUNTIME_HELPERS_ALL_COPIED_BYTE_IDENTICAL')
    need(m['runtimeHelperRecompiled'] is False and m['adminApiUnchanged'] is True and m['adminReloads']==0 and m['datasetChanges']==0,'NO_ADMIN_RUNTIME_DATA_MUTATION')
    for n,h in m['priorSourceHashes'].items():io.pinned(candidate+'/prior-source-snapshot/'+rel(n),h)
    inputbytes=io.pinned(candidate+'/input-contract.json',c['inputContractSha256']);source_input=json.loads(inputbytes)
    need(source_input['sourceHashes']==m['sourceHashes'] and source_input['approvedSourceDeltas']==deltas and source_input['approvedSourceAdditions']==m['approvedSourceAdditions'],'ACTUAL_COMPUTED_APPROVED_SOURCE_HASHES_NOT_SUBSTITUTED')
    need(source_input['authorizedSourceDeltas']==m['sourceChanges'],'EXACT_AST_SOURCE_DESCRIPTOR_BINDING')
    need([{k:r[k] for k in ('relative','beforeSha256','afterSha256')} for r in sorted(m['sourceChanges'],key=lambda r:r['relative'])]==deltas,'AST_DESCRIPTOR_EXACT_APPROVED_HASH_TRIPLES')
    parent=json.loads(io.pinned(candidate+'/parent-final-inputs.json',source_input['parentFinalInputsPin']['sha256']))
    need(parent['finalizedForOfflineBuild'] is True and parent['sourceHashes']==m['sourceHashes'] and parent['approvedSourceDeltas']==deltas and parent['approvedSourceAdditions']==m['approvedSourceAdditions'],'PARENT_FINAL_SOURCE_INPUT_PIN')
    receipt=json.loads(io.read(candidate+'/source-pin-receipt.json'));need(receipt['frozen'] is True and receipt['sourceHashes']==m['sourceHashes'] and receipt['priorSourceHashes']==m['priorSourceHashes'] and receipt['approvedSourceDeltas']==deltas,'COMPLETE_EXACT_SOURCE_PIN_RECEIPT')
    for n in ('release-driver.py','attached-admin-reloader.cjs','validate-snapshot-helper.cjs'):need(n in m['packageHashes'],'CONTROL_TOOL_NOT_IN_MANIFEST '+n)
    need(sha(io.read(str(pathlib.Path(__file__).resolve())))==m['packageHashes']['release-driver.py'],'ACTUAL_EXECUTING_DRIVER_PIN')
    front_proof=json.loads(io.read(candidate+'/front-api-delta.json'));need(len(front_proof['patches'])==3,'EXACT_THREE_APPROVED_FRONT_AST_SLICES');inverse(io.read(candidate+'/baseline/front-index.js'),io.read(candidate+'/candidate/api/front-index.js'),front_proof)
    need(source_input['frontPatchProofPin']['sha256']==m['frontPatchProofSha256']==m['packageHashes']['front-api-delta.json'],'PARENT_EXACT_FRONT_PROOF_PIN')
    inverse(io.read(candidate+'/baseline/index.html'),io.read(candidate+'/candidate/index.html'),json.loads(io.read(candidate+'/html-delta.json')))
    for n in ('workbench-0-delta.json','workbench-1-delta.json'):
        p=json.loads(io.read(candidate+'/'+n));inverse(io.read(candidate+'/baseline/'+p['beforeUrl'].lstrip('/')),io.read(candidate+'/candidate/'+p['afterUrl'].lstrip('/')),p)
    for kind in ('affectedNativeQA','parentReview'):
        if not require_final:continue
        r=c[kind];receipt=json.loads(io.pinned(r['file'],r['sha256']));need(receipt['manifestSha256']==c['manifestSha256'] and receipt['fixtureOnly'] is False,'ACTUAL_QA_REVIEW_RECEIPT_MANIFEST')
        if kind=='affectedNativeQA':need(receipt['status']=='PASS','AFFECTED_NATIVE_QA_REQUIRED')
        else:need(receipt['approved'] is True and receipt['inputContractSha256']==c['inputContractSha256'],'INDEPENDENT_PARENT_REVIEW_REQUIRED')
    need(m.get('manualRefreshMode')=='manual-default-disabled' and m.get('configProvisioned') is False and m.get('cacheProvisioned') is False and m.get('activeProducerAccepted') is False,'DEFAULT_DISABLED_RELEASE_ONLY')
    need(m.get('manualDisabledGuard')=={'path':'/var/lib/51dianzi/channel-reference-manual-v1/manual-refresh-config.json','expected':'absent'},'FIXED_CONFIG_ABSENCE_GUARD_REQUIRED')
    need(m['workerSha256']==m['packageHashes']['channel-reference-worker.mjs'],'ACTUAL_COPIED_SIBLING_DIGEST')
    need(source_input['cssApprovalPin']['sha256']==m['cssApprovalSha256']==m['packageHashes']['css-parent-approval.json'],'PRECISE_PARENT_CSS_APPROVAL_BINDING')
    raw=io.pinned(candidate+'/backend-projection-descriptor.json',m['backendProjectionDescriptorSha256']);need(front_proof['approvedProjectionDescriptorSha256']==sha(raw),'EXACT_RAW_THREE_AST_PROJECTION_BINDING')
    need(m['independentSourceHashes']=={r['relative']:r['sha256'] for r in source_input['independentBackendSources']},'MAIN_MIRROR_SOURCE_OUTSIDE147_SEPARATE_PINS')
    need(m['priorIndependentSourceHashes']=={r['relative']:r['beforeSha256'] for r in source_input['independentBackendSources'] if r.get('beforeFile')},'EXACT_INDEPENDENT_SOURCE_BEFORE_PINS')
    for n,h in m['independentSourceHashes'].items():io.pinned(candidate+'/independent-source-snapshot/'+rel(n),h)
    for n,h in m['priorIndependentSourceHashes'].items():io.pinned(candidate+'/prior-independent-source-snapshot/'+rel(n),h)
    need({r['root'] for r in m['frozenRootTrees']}=={OLD,*[r['root'] for r in baseline['failedRoots']]},'ALL_OLD_V1_V2_V3_V4_TREE_SHAPES_REQUIRED')
    return {'candidate':candidate,'m':m,'manifestBytes':mbytes,'inputBytes':inputbytes}
class Engine:
    def __init__(self,c,inputsha,pkg,io=None,rpc=None):
        self.c,self.inputsha,self.pkg=c,inputsha,pkg;self.m=pkg['m'];self.io=io or IO();self.rpc=rpc or self.production_rpc;self.state=None
    def production_rpc(self,id=None,rollback=False):
        wrapper=self.pkg['candidate']+'/attached-admin-reloader.cjs' if id is None else ROOT+'/attached-admin-reloader.cjs'
        self.io.pinned(wrapper,self.m['packageHashes']['attached-admin-reloader.cjs'])
        argv=['node',wrapper]+(['--snapshot'] if id is None else (['--rollback'] if rollback else [])+['--manifest-sha256',self.c['manifestSha256'],'--attempt',self.c['attemptId'],'--id',str(id)])
        result=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120,check=False)
        if self.state is not None and id is not None:self.event('rpc-result',{'argv':argv,'innerExitCode':result.returncode,'stdoutSha256':sha(result.stdout),'stderrSha256':sha(result.stderr)})
        need(result.returncode==0,'ATTACHED_RPC_NONZERO '+str(result.returncode))
        value=json.loads(result.stdout);return value if id is None else value['processes']
    def event(self,name,fields=None):self.io.append(ROOT+'/activation-events.jsonl',enc({'atUtc':utc(),'event':name,'attemptId':self.c['attemptId'],**(fields or {})}).replace(b'\n',b'')+b'\n')
    def save(self,phase=None,**fields):
        if phase:self.state['phase']=phase
        self.state.update(fields);self.state['updatedAtUtc']=utc();self.io.put(ROOT+'/activation-state.json',enc(self.state));self.event('checkpoint',{'phase':self.state['phase']})
    def frozen(self):
        guard=self.m['manualDisabledGuard'];need(guard=={'path':'/var/lib/51dianzi/channel-reference-manual-v1/manual-refresh-config.json','expected':'absent'},'FIXED_DISABLED_CONFIG_GUARD');q=self.io.path(guard['path']);no_symlinks(q);need(not self.io.exists(guard['path']),'MANUAL_CONFIG_APPEARED_ABORT_NO_ENABLE')
        for r in self.m['baselineAssets']:self.io.pinned(PUBLIC+'/'+rel(r['relative']),r['sha256'])
        for r in self.m['protectedFiles']+self.m['legacyFrozenFiles']:
            if r['path']==COORD:self.frozen_coord(r)
            elif r['path'] in (TARGET_API,PUBLIC+'/index.html'):self.frozen_mutable(r)
            else:self.io.pinned(r['path'],r['sha256'])
        self.io.pinned(ADMIN,self.m['untouchedAdminApiSha256'])
        # Complete baseline/new owned asset shape, not just a convenient subset.
        expected={r['relative'] for r in self.m['baselineAssets']};allowed=set(expected)
        for r in self.state.get('assetIntents',[]) if self.state else []:
            need(r in [{'relative':x['relative'],'sha256':x['sha256']} for x in self.m['files'] if x['relative']!='index.html'],'UNKNOWN_OR_UNOWNED_ASSET_INTENT')
            allowed.add(r['relative'])
            if self.io.exists(PUBLIC+'/'+r['relative']):self.io.pinned(PUBLIC+'/'+r['relative'],r['sha256'])
        actual={'assets/'+n for n in self.io.files(PUBLIC+'/assets')}
        need(expected.issubset(actual) and actual.issubset(allowed),'UNKNOWN_EXTRA_OR_MISSING_PUBLIC_ASSET_DRIFT')
        for r in self.m.get('frozenRootTrees',[]):need(self.io.files(r['root'])==set(r['relativeFiles']),'IMMUTABLE_OLD_ROOT_TREE_SHAPE_DRIFT '+r['root'])
    def frozen_mutable(self,r):
        api=r['path']==TARGET_API;before=self.m['backendFiles'][0]['beforeSha256'] if api else self.m['beforeHtmlSha256'];after=self.m['backendFiles'][0]['sha256'] if api else self.m['htmlSha256']
        need(r['path'] in (TARGET_API,PUBLIC+'/index.html') and r['sha256']==before,'CAPTURED_MUTABLE_ROW_PIN_MISMATCH '+r['path'])
        if self.state is None:self.io.pinned(r['path'],before);return
        need(self.state['attemptId']==self.c['attemptId'] and self.state['manifestSha256']==self.c['manifestSha256'] and self.state['inputSha256']==self.inputsha and self.state['ownerTask']==self.c['ownerTask'],'EXACT_RECOVERY_OWNERSHIP')
        phase=self.state['phase'];installed='apiInstalled' if api else 'htmlInstalled';intent='apiIntent' if api else 'htmlIntent'
        if phase in ('recovering','rolled-back-pending-verify','rolled-back'):expected=before
        elif phase in ('applied-pending-verify','verified'):expected=after
        elif phase in ('prepared','opening'):expected=before
        elif phase=='applying':expected=after if self.state.get(installed) else before
        elif phase=='recovery-required':
            # Only a durable exact-file CAS intent admits the two OWNED full byte images.
            # Normal forward/rollback checkpoints always select a single full pin.
            if not self.state.get(intent):self.io.pinned(r['path'],before);return
            self.owned_coord();self.check_root();prefix='baseline/front-index.js' if api else 'baseline/index.html';post='candidate/api/front-index.js' if api else 'candidate/index.html'
            b=self.io.pinned(ROOT+'/'+prefix,before);a=self.io.pinned(ROOT+'/'+post,after);now=self.io.read(r['path']);need(now in (b,a),'AMBIGUOUS_INTENT_UNOWNED_FULL_BYTES '+r['path']);return
        else:raise RuntimeError('UNKNOWN_MUTABLE_LIFECYCLE_PHASE '+str(phase))
        self.io.pinned(r['path'],expected)
    def frozen_coord(self,r):
        # Only the exact captured coordination row is stateful; never omit it.
        need(r['path']==COORD and r['sha256']==self.m['capturedCoordSha256'],'CAPTURED_COORD_ROW_PIN_MISMATCH')
        if self.state is None:
            self.io.pinned(COORD,r['sha256']);return
        need(self.state['attemptId']==self.c['attemptId'] and self.state['manifestSha256']==self.c['manifestSha256'] and self.state['inputSha256']==self.inputsha and self.state['ownerTask']==self.c['ownerTask'],'EXACT_RECOVERY_OWNERSHIP')
        if self.state['phase'] in ('verified','rolled-back'):
            before=self.io.pinned(COORD,self.state['coordClosedSha256'])
            need(self.io.pinned(COORD,self.state['coordClosedSha256'])==before,'CLOSED_COORD_DOUBLE_VERIFY_DRIFT');return
        before=self.owned_coord()
        need(self.owned_coord()==before,'OWNED_COORD_DOUBLE_VERIFY_DRIFT')
    def owned_coord(self):
        need(self.state and self.state['attemptId']==self.c['attemptId'] and self.state['manifestSha256']==self.c['manifestSha256'] and self.state['inputSha256']==self.inputsha and self.state['ownerTask']==self.c['ownerTask'],'EXACT_RECOVERY_OWNERSHIP')
        b=self.io.read(ROOT+'/coordination-owned.json');need(sha(b)==self.state['coordOwnedSha256'] and self.io.read(COORD)==b,'FULL_COORDINATION_OWNED_BYTES_CHANGED')
        co=json.loads(b);need(co['shared_release_active'] is True and co['window']['attemptId']==self.state['attemptId'] and co['window']['nonce']==self.state['nonce'] and co['window']['owner_task']==self.state['ownerTask'],'WINDOW_NONCE_OWNER_CAS');return b
    def root_owner(self):
        return {'ownerTask':self.c['ownerTask'],'runtimeRoot':ROOT,'manifestSha256':self.c['manifestSha256'],'inputContractSha256':self.c['inputContractSha256'],'nonce':self.c['rootOwnershipNonce']}
    def check_root(self):
        if not self.io.exists(ROOT):return
        need(json.loads(self.io.read(ROOT+'/release-owner.json'))==self.root_owner(),'EXISTING_ROOT_OWNER_NONCE_MISMATCH')
        known={'manifest.json',*self.m['packageHashes'],'release-owner.json','activation-state.json','activation-events.jsonl','coordination-owned.json','actual-helper-validation.json'}
        need(self.io.files(ROOT).issubset(known),'UNKNOWN_EXTRA_RUNTIME_ROOT_FILE')
        for n,h in self.m['packageHashes'].items():self.io.pinned(ROOT+'/'+n,h)
        self.io.pinned(ROOT+'/manifest.json',self.c['manifestSha256'])
    def install(self):
        self.check_root()
        if not self.io.exists(ROOT):
            target=self.io.path(ROOT);no_symlinks(target);target.mkdir(mode=0o700)
            self.io.put(ROOT+'/release-owner.json',enc(self.root_owner()),exclusive=True)
            for n in ['manifest.json',*self.m['packageHashes']]:
                q=self.io.path(ROOT+'/'+rel(n));q.parent.mkdir(parents=True,exist_ok=True);self.io.put(ROOT+'/'+n,self.io.read(self.pkg['candidate']+'/'+n),exclusive=True)
        for n,h in self.m['packageHashes'].items():self.io.pinned(ROOT+'/'+n,h)
        self.io.pinned(ROOT+'/manifest.json',self.c['manifestSha256'])
    def validate_helper(self):
        # Parent runs the copied real sibling loader exactly once for final package.
        # Apply re-pins its complete actual receipt; never compiles or invokes producer.
        pin=self.c['actualReadonlyHelperQA'];b=self.io.pinned(pin['file'],pin['sha256']);proof=json.loads(b)
        need(proof['status']=='PASS' and proof['fixtureOnly'] is False and proof['defaultRealSiblingLoaderUsed'] is True and proof['manifestSha256']==self.c['manifestSha256'],'ACTUAL_ONCE_FINAL_LOADER_QA_RECEIPT')
        need(proof['snapshotSha256']==self.m['datasetAfterSha256'] and proof['sourceHashes']==self.m['sourceHashes'] and proof['helperHashes']==self.m['runtimeHelpers'] and proof['sourceRecordsChecked']==588,'EXACT_COPIED_HELPER_588_SOURCE_BINDING')
        need(proof['statusCounts'].get('lcsc:ok',0)+proof['statusCounts'].get('ickey:ok',0)==213 and proof['readonly'] is True and proof['http'] is False and proof['db'] is False and proof['businessWrites']==0,'EXACT_UNCHANGED_213_NO_PRODUCER_IO')
        return b
    def plan(self):
        # No mkdir, locks, journal, install or helper execution. PM2 attach snapshot only.
        self.check_root()
        self.frozen();self.io.pinned(TARGET_API,self.m['backendFiles'][0]['beforeSha256']);self.io.pinned(PUBLIC+'/index.html',self.m['beforeHtmlSha256']);coord=self.io.pinned(COORD,self.m['capturedCoordSha256']);need(json.loads(coord)['shared_release_active'] is False,'CURRENT_WINDOW_NOT_IDLE')
        rows_check(self.rpc(),self.m['baselineProcesses'])
        need(not self.io.exists(ROOT+'/activation-state.json'),'ATTEMPT_ALREADY_STARTED_NO_REPLAY')
        for r in self.m['files']:
            if r['relative']!='index.html':need(not self.io.exists(PUBLIC+'/'+r['relative']),'NEW_PUBLIC_ASSET_EXISTS')
        return {'mode':'plan','writes':0,'ready':False,'targets':list(IDS),'newRoot':ROOT,'manifestSha256':self.c['manifestSha256'],'inputSha256':self.inputsha,'status':'CHECKED_OFFLINE_PACKAGE_AND_CURRENT_CAS_NO_ACTIVATION'}
    def load_state(self):
        self.state=json.loads(self.io.read(ROOT+'/activation-state.json'));need(self.state['inputSha256']==self.inputsha and self.state['attemptId']==self.c['attemptId'] and self.state['manifestSha256']==self.c['manifestSha256'] and self.state['ownerTask']==self.c['ownerTask'],'STATE_DIFFERENT_ATTEMPT_NO_REPLAY');return self.state
    def intent(self,id,direction):
        self.owned_coord();self.check_root();self.frozen();api=self.m['backendFiles'][0];self.io.pinned(TARGET_API,api['sha256' if direction=='forward' else 'beforeSha256'])
        entry={'id':id,'direction':direction,'attemptId':self.state['attemptId'],'ownerTask':self.state['ownerTask'],'apiHash':api['sha256' if direction=='forward' else 'beforeSha256'],'intentAtUtc':utc()}
        self.state['intents'].append(entry);self.save('applying' if direction=='forward' else 'recovering');self.event('persisted-intent-before-rpc',entry)
        try:rows=self.rpc(id,rollback=direction=='rollback')
        except BaseException as error:self.event('rpc-failed-after-durable-intent',{'id':id,'direction':direction,'failure':str(error)});raise
        owned={x['id'] for x in self.state['intents']};rows_check(rows,self.m['baselineProcesses'],owned=owned,changed=[id]);self.state.setdefault('completed',[]).append({'id':id,'direction':direction,'pid':next(p['pid'] for p in rows if p['id']==id)});self.save();self.event('rpc-completed-before-next-target',{'id':id,'direction':direction})
    def verify(self):
        state=self.load_state();self.check_root();self.frozen();self.io.pinned(ROOT+'/manifest.json',self.c['manifestSha256']);
        for n,h in self.m['packageHashes'].items():self.io.pinned(ROOT+'/'+n,h)
        forward=state['phase'] in ('applied-pending-verify','verified')
        recovered=state['phase'] in ('rolled-back-pending-verify','rolled-back')
        need(forward or recovered,'RECOVERY_INCOMPLETE_USE_EXPLICIT_RECOVER_NOT_APPLY')
        if state['phase'] in ('verified','rolled-back'):self.io.pinned(COORD,state['coordClosedSha256'])
        else:self.owned_coord()
        self.io.pinned(TARGET_API,self.m['backendFiles'][0]['sha256' if forward else 'beforeSha256']);self.io.pinned(PUBLIC+'/index.html',self.m['htmlSha256' if forward else 'beforeHtmlSha256'])
        if forward:
            for r in self.m['files']:self.io.pinned(PUBLIC+'/'+r['relative'],r['sha256'])
        changed=list(IDS) if forward else sorted({x['id'] for x in state.get('completed',[]) if x['direction']=='rollback'})
        owned=IDS if forward else {x['id'] for x in state.get('intents',[])}
        rows=rows_check(self.rpc(),self.m['baselineProcesses'],owned=owned,changed=changed)
        need(all(any(x['id']==id and x['direction']==('forward' if forward else 'rollback') for x in state.get('completed',[])) for id in changed),'TARGET_RELOAD_COMPLETION_RECEIPTS_MISSING')
        return {'mode':'verify','writes':0,'status':'VERIFIED_APPLIED_BYTES_PM2_ONLY' if forward else 'VERIFIED_OWNED_ROLLBACK_BYTES_PM2_ONLY','manifestSha256':self.c['manifestSha256'],'allOnline':True,'other8CapturedFieldsAndPidsUnchanged':True,'frontIds':list(IDS),'adminIdsUntouched':[191,192],'processes':rows,'uiNormalClaim':False,'ready':False,'windowClosed':state['phase'] in ('verified','rolled-back')}
    def close(self):
        proof=self.verify();need(not proof['windowClosed'],'ALREADY_CLOSED_NO_REPLAY');before=self.owned_coord();co=json.loads(before);forward=self.state['phase']=='applied-pending-verify';window=copy.deepcopy(co['window']);window.update(status='verified' if forward else 'rolled-back',closedAtUtc=utc(),receipt=ROOT+'/activation-state.json');co['window']=window;co['shared_release_active']=False;co.setdefault('window_history',[]).append(copy.deepcopy(window));co['updated_at']=utc();after=enc(co)
        self.save(coordClosedSha256=sha(after),closeIntent=True);self.io.cas(COORD,before,after);self.save('verified' if forward else 'rolled-back',closeIntent=False);return {**proof,'mode':'close','writes':'coordination+private-journal-only','windowClosed':True}
    def recover(self):
        self.load_state();need(self.state['phase'] not in ('verified','rolled-back'),'CLOSED_ATTEMPT_NO_REPLAY')
        original=self.io.read(ROOT+'/coordination-before.json');current=self.io.read(COORD)
        if current==original and self.state['phase'] in ('opening','prepared','recovery-required') and not self.state.get('apiIntent'):
            # Crash before opening CAS: nothing public/PM2 was exposed.
            self.save('rolled-back',coordClosedSha256=sha(original),noWindowOpened=True);return {'status':'NO_WINDOW_OPENED_NO_PUBLIC_OR_RPC_REPLAY'}
        self.owned_coord();self.save('recovering');api=self.m['backendFiles'][0]
        for live,bef,aft in [(PUBLIC+'/index.html',ROOT+'/baseline/index.html',ROOT+'/candidate/index.html'),(TARGET_API,ROOT+'/baseline/front-index.js',ROOT+'/candidate/api/front-index.js')]:
            b=self.io.read(bef);a=self.io.read(aft);now=self.io.read(live);need(now in (a,b),'ROLLBACK_UNOWNED_BYTES_REFUSED '+live)
            if now==a:self.event('rollback-cas-intent',{'path':live,'from':sha(a),'to':sha(b)});self.io.cas(live,a,b)
        self.frozen();rows=self.rpc();rows_check(rows,self.m['baselineProcesses'],owned={x['id'] for x in self.state['intents']},offline=True)
        affected={x['id'] for x in self.state['intents'] if x['direction']=='forward'}
        # API file CAS never authorizes blanket reloads: only durable forward intent IDs own RPC recovery.
        intended=set(affected)
        for p in rows:
            if p['id'] in IDS and p['id'] not in intended:need(p==next(x for x in self.m['baselineProcesses'] if x['id']==p['id']),'UNINTENDED_FRONT_PID_DRIFT_RECOVERY_REFUSED')
        affected.update(p['id'] for p in rows if p['id'] in IDS and (p['pid']!=next(x['pid'] for x in self.m['baselineProcesses'] if x['id']==p['id']) or p['status']!='online'))
        for id in sorted(affected):
            latest=next((x for x in reversed(self.state.get('completed',[])) if x['id']==id),None)
            row=next(x for x in rows if x['id']==id)
            if latest and latest['direction']=='rollback' and row['status']=='online' and row['pid']==latest['pid']:continue
            self.intent(id,'rollback')
        self.save('rolled-back-pending-verify',ownedAdditiveAssetDisposition='retained-owned-quarantine-no-delete-no-auto-retry');return self.verify()
    def apply(self,helper_proof):
        need(not self.io.exists(ROOT+'/activation-state.json'),'REPEATED_APPLY_FORBIDDEN_USE_VERIFY_OR_RECOVER')
        self.install();self.frozen();rows_check(self.rpc(),self.m['baselineProcesses']);api=self.m['backendFiles'][0];self.io.pinned(TARGET_API,api['beforeSha256']);self.io.pinned(PUBLIC+'/index.html',self.m['beforeHtmlSha256']);before=self.io.pinned(COORD,self.m['capturedCoordSha256']);co=json.loads(before);need(co['shared_release_active'] is False,'WINDOW_BUSY')
        self.state={'contractVersion':'channel-remediation-activation-state-v1','phase':'prepared','inputSha256':self.inputsha,'inputContractSha256':self.c['inputContractSha256'],'manifestSha256':self.c['manifestSha256'],'attemptId':self.c['attemptId'],'ownerTask':self.c['ownerTask'],'rootOwnershipNonce':self.c['rootOwnershipNonce'],'nonce':uuid.uuid4().hex,'openedAtUtc':utc(),'intents':[],'completed':[],'apiIntent':False}
        co['shared_release_active']=True;co['window']={'owner_task':self.state['ownerTask'],'task':self.state['ownerTask'],'attemptId':self.state['attemptId'],'nonce':self.state['nonce'],'manifestSha256':self.state['manifestSha256'],'status':'applying','scope':'approved compact/source/edit UI; exactly three front API AST slices; sequential original front 190/193/194/200 only; HTML after all four online; admin API/import/PIDs/ENV unchanged; no DB or business writes','opsDir':ROOT,'openedAtUtc':self.state['openedAtUtc']};co['updated_at']=utc();owned=enc(co)
        self.io.put(ROOT+'/coordination-before.json',before);self.io.put(ROOT+'/coordination-owned.json',owned);self.io.put(ROOT+'/actual-helper-validation.json',helper_proof);self.state['coordOwnedSha256']=sha(owned);self.save('opening')
        try:
            self.io.cas(COORD,before,owned);self.save('applying');self.owned_coord();self.frozen()
            for r in self.m['files']:
                if r['relative']=='index.html':continue
                n=rel(r['relative']);v=self.io.pinned(ROOT+'/candidate/'+n,r['sha256']);entry={'relative':n,'sha256':r['sha256']};self.state.setdefault('assetIntents',[]).append(entry);self.save();self.event('public-add-intent',entry);self.io.add(PUBLIC+'/'+n,v);self.io.pinned(PUBLIC+'/'+n,r['sha256']);self.save()
            self.save(apiIntent=True);self.io.cas(TARGET_API,self.io.read(ROOT+'/baseline/front-index.js'),self.io.read(ROOT+'/candidate/api/front-index.js'));self.save(apiInstalled=True)
            for id in IDS:self.intent(id,'forward')
            self.owned_coord();self.frozen();self.io.pinned(TARGET_API,api['sha256']);self.save(htmlIntent=True);self.io.cas(PUBLIC+'/index.html',self.io.read(ROOT+'/baseline/index.html'),self.io.read(ROOT+'/candidate/index.html'));self.save('applied-pending-verify',htmlInstalled=True)
            proof=self.verify();self.event('readonly-final-verification',{'status':proof['status']});return self.close()
        except BaseException as error:
            self.save('recovery-required',failureType=type(error).__name__,failure=str(error));self.event('failure-retain-window',{'failure':str(error)})
            try:
                recovery=self.recover();self.event('owned-rollback-await-independent-readonly-verify',{'status':recovery.get('status')})
            except BaseException as recovery_error:self.save('recovery-required',recoveryError=str(recovery_error))
            raise

def main(argv=None):
    p=argparse.ArgumentParser(description='New namespace only; parent production execution. Plan/verify are read-only; no PM2 startup.')
    p.add_argument('--input',required=True);p.add_argument('--sha256',required=True)
    mode=p.add_mutually_exclusive_group(required=True)
    for n in ('plan','apply','verify','recover','close'):mode.add_argument('--'+n,action='store_true')
    a=p.parse_args(argv);io=IO();inputbytes=io.pinned(str(pathlib.Path(a.input).resolve()),a.sha256);c=json.loads(inputbytes);pkg=load_package(c,io,require_final=not a.plan);engine=Engine(c,a.sha256,pkg,io)
    if a.plan:result=engine.plan()
    elif a.verify:result=engine.verify()
    elif a.apply:
        helper=engine.validate_helper() # pinned source/data/helper validated before any release window
        with io.locks():result=engine.apply(helper)
    elif a.recover:
        with io.locks():result=engine.recover()
    else:
        with io.locks():result=engine.close()
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:main()
    except BaseException as e:print('NEW_NAMESPACE_RELEASE_ABORT: '+str(e),file=sys.stderr);sys.exit(1)
