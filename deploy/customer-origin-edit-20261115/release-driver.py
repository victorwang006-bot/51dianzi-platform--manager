#!/usr/bin/env python3
"""Fixed this-round package only. Parent execution; never SSH/Git/DB/HTTP/start PM2.
Every write uses complete CAS/add-only semantics, durable intent, owned rollback.
"""
import argparse, base64, contextlib, copy, datetime, fcntl, hashlib, json, os, pathlib, re, stat, subprocess, sys, uuid
sys.dont_write_bytecode=True
ROOT='/opt/ops/20261115-customer-origin-edit-JfFQcJM'
OLD='/opt/ops/20261115-inventory-compact-edit-cSy4W28'
OWNER='JfFQcJMqqFudyf4S9Egg7M'
CANDIDATE=ROOT+'-candidate'
COORD='/opt/ops/51-project-release-coordination-20261027.json'
LOCKS=('/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock')
ADMIN='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js'
FRONT='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
PUBLIC='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'
IDS=(190,193,194,200,191,192)
DATA='a00f52da7e423addf6b40508c972ad34df0eecec71250b1206ce9cb35c5ae436'
MANIFEST='ff1bc36f2f68ca01755154215fc99c97e614cc8f2b210a01a8573abfce4094db'
sha=lambda b:hashlib.sha256(b).hexdigest()
enc=lambda x:(json.dumps(x,ensure_ascii=False,indent=2)+'\n').encode()
utc=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def need(ok,label):
    if not ok:raise RuntimeError(label)
def rel(n):
    need(isinstance(n,str) and re.fullmatch(r'[A-Za-z0-9._/-]{1,512}',n) and all(x not in ('','.','..') for x in n.split('/')),'UNSAFE_RELATIVE');return n
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
        tmp=q.parent/('.customer-origin-edit-'+uuid.uuid4().hex+'.tmp')
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
def inverse(before,after,p):
    need(sha(before)==p['beforeSha256'] and sha(after)==p['afterSha256'],'INVERSE_FULL_PINS');cursor=0;parts=[];gaps=[];at=0
    for x in p['patches']:
        pre=base64.b64decode(x['beforeBase64'],validate=True);post=base64.b64decode(x['afterBase64'],validate=True)
        need(isinstance(x['start'],int) and isinstance(x['end'],int) and cursor<=x['start']<=x['end']<=len(before),'INVERSE_ORDER_RANGE');need(before[x['start']:x['end']]==pre and sha(pre)==x['beforeSha256'] and sha(post)==x['afterSha256'],'INVERSE_ACTUAL_SLICES')
        gap=before[cursor:x['start']];gaps.append({'beforeStart':cursor,'beforeEnd':x['start'],'afterStart':at,'afterEnd':at+len(gap),'sha256':sha(gap)});parts.append(gap);at+=len(gap);need(x['afterStart']==at and x['afterEnd']==at+len(post),'AFTER_OFFSET_PROOF');parts.append(post);at+=len(post);cursor=x['end']
    tail=before[cursor:];parts.append(tail);gaps.append({'beforeStart':cursor,'beforeEnd':len(before),'afterStart':at,'afterEnd':at+len(tail),'sha256':sha(tail)});need(b''.join(parts)==after and gaps==p['unchangedPartitions'],'FULL_FORWARD_PARTITION_PROOF');restored=after
    for x in reversed(p['patches']):restored=restored[:x['afterStart']]+base64.b64decode(x['beforeBase64'])+restored[x['afterEnd']:]
    need(restored==before and p['exactInverse'] is True and p['allUnmodifiedBytesPreserved'] is True,'EXACT_FULL_INVERSE')
def rows_check(rows,before,owned=(),changed=(),offline=False):
    need(len(rows)==len(before)==12 and len({r['id'] for r in rows})==12,'EXACT12_PROCESSES');current={r['id']:r for r in rows}
    for b in before:
        need(b['id'] in current,'PROCESS_ID_DRIFT');r=current[b['id']]
        if b['id'] not in IDS:need(r==b,'OTHER6_PID_AND_ALL_FIELDS_FROZEN');continue
        api=FRONT if b['id'] in (190,193,194,200) else ADMIN;name='dianzi51' if api==FRONT else 'dianzi51-admin';need(b['script']==api and b['name']==name and b['execMode']=='cluster_mode' and b['status']=='online' and b['pid']>0,'EXACT_TARGET_BINDING')
        need({k:v for k,v in r.items() if k not in ('pid','status')}=={k:v for k,v in b.items() if k not in ('pid','status')},'TARGET_ENV_CWD_SCRIPT_CONFIG_FROZEN')
        if b['id'] not in owned:need(r==b,'UNOWNED_TARGET_PID_STATUS_FROZEN')
        if not offline or b['id'] not in owned:need(r['status']=='online' and r['pid']>0,'ALL_ONLINE_REQUIRED')
        if b['id'] in changed:need(r['pid']!=b['pid'],'TARGET_PID_NOT_CHANGED')
    return rows
def load_package(c,io,require_final=True):
    need(c['contractVersion']=='customer-origin-edit-activation-v1' and c['runtimeRoot']==ROOT and c['ownerTask']==OWNER and c['candidateDir']==CANDIDATE,'FIXED_ROUND_ACTIVATION')
    for k in ('attemptId','rootOwnershipNonce'):need(re.fullmatch('[A-Za-z0-9_-]{16,96}',c[k]),'ATTEMPT_NONCE_REQUIRED')
    mb=io.pinned(CANDIDATE+'/manifest.json',c['manifestSha256']);m=json.loads(mb);need(m['contractVersion']=='customer-origin-edit-release-v1' and m['runtimeRoot']==ROOT and m['priorRuntimeRoot']==OLD and m['ownerTask']==OWNER and m['candidateDir']==CANDIDATE and m['fixtureOnly'] is False,'EXACT_CURRENT_NEW_PACKAGE');need(m['inputContractSha256']==c['inputContractSha256'] and m['previousManifestSha256']==MANIFEST,'INPUT_CURRENT_MANIFEST_PINS');need(io.files(CANDIDATE)=={'manifest.json',*m['packageHashes']},'PACKAGE_UNKNOWN_MISSING_FILES')
    for n,h in m['packageHashes'].items():io.pinned(CANDIDATE+'/'+rel(n),h)
    need(m['publicRoot']==PUBLIC and m['apiPaths']=={'admin':ADMIN,'front':FRONT} and m['ownedIds']==list(IDS),'EXACT_SCOPE_PATH_IDS');need([(r['kind'],r['path'],r['ownedIds']) for r in m['backendFiles']]==[('front',FRONT,[190,193,194,200]),('admin',ADMIN,[191,192])],'TWO_API_SIX_ORIGINAL_TARGETS')
    i=json.loads(io.pinned(CANDIDATE+'/input-contract.json',c['inputContractSha256']));review=json.loads(io.read(CANDIDATE+'/parent-source-review.json'));need(review['approved'] is True and sha(io.read(CANDIDATE+'/parent-source-review.json'))==i['parentSourceReviewPin']['sha256'],'PINNED_SOURCE_REVIEW_REQUIRED')
    for k in ('sourceHashes','allowedSourcePaths','approvedSourceDescriptors','backend','currentWorkbenchUrls'):need(review[k]==i[k],'SOURCE_PARENT_REVIEW_FIELD')
    need(m['sourceHashes']==i['sourceHashes'] and m['sourceChanges']==i['approvedSourceDescriptors'],'FULL_SOURCE_AST_BINDING');prior=json.loads(io.pinned(CANDIDATE+'/previous-manifest.json',MANIFEST));b=json.loads(io.pinned(CANDIDATE+'/live-baseline-current.json',m['baselineReportSha256']));need(b['contractVersion']=='customer-origin-edit-fresh-baseline-v1' and b['currentRuntimeRoot']==OLD and b['newRuntimeRoot']==ROOT and b['exactCurrentLifecycleGuardUsed'] is True,'ACTUAL_FRESH_BASELINE');need(m['priorSourceHashes']=={**prior['sourceHashes'],**prior['independentSourceHashes']}=={**b['sourceHashes'],**b['independentSourceHashes']} and len(m['priorSourceHashes'])==150,'CURRENT148_PLUS2_PINS');need(set(m['priorSourceHashes']).issubset(m['sourceHashes']),'SOURCE_GRAPH_REMOVAL')
    actual=[{'relative':n,'beforeSha256':m['priorSourceHashes'].get(n),'afterSha256':h} for n,h in sorted(m['sourceHashes'].items()) if h!=m['priorSourceHashes'].get(n)];need(actual==sorted([{k:r[k] for k in ('relative','beforeSha256','afterSha256')} for r in m['sourceChanges']],key=lambda r:r['relative']),'EXACT_SOURCE_DELTA_HASH_TRIPLES');need(set(r['relative'] for r in actual)==set(i['allowedSourcePaths']),'NO_EXTRA_SOURCE_PERMISSION')
    for n,h in m['sourceHashes'].items():io.pinned(CANDIDATE+'/source-snapshot/'+rel(n),h)
    for n,h in m['priorSourceHashes'].items():io.pinned(CANDIDATE+'/prior-source-snapshot/'+rel(n),h)
    for k in ('baselineAssets','baselineProcesses','protectedFiles','protectedEnvFiles','legacyFrozenFiles'):need(m[k]==b[k.replace('baselineProcesses','processes')],'NO_CAPTURED_GUARD_ROW_OMISSION')
    need(m['frozenRootTrees']==[{'root':OLD,'files':b['currentRootTree']},*b['frozenRootTrees']],'COMPLETE_OLD_ROOT_TREES');need(m['runtimeHelpers']==b['runtimeHelpers']==prior['runtimeHelpers'] and m['snapshotSha256']==b['snapshotSha256']==DATA and m['positiveSourceCount']==213,'BYTE_IDENTICAL213_HELPERS');need(m['runtimeHelperRecompiled'] is False and m['datasetChanges']==0 and m['manualDisabledGuard']==b['manualDisabledGuard']=={'path':'/var/lib/51dianzi/channel-reference-manual-v1/manual-refresh-config.json','expected':'absent'},'NO_RUNTIME_OR_MANUAL_ENABLE');need(len(m['protectedEnvFiles'])>0 and len(m['hostCompileSourceHashes'])==25,'NO_ENV_OR25_GRAPH_GUARD_OMISSION');need(m['capturedCoordSha256']==b['coordSha256'] and m['beforeHtmlSha256']==b['beforeHtmlSha256'],'FULL_BASELINE_COORD_HTML')
    for r in m['backendFiles']:
        need(r['beforeSha256']==b['api'][r['kind']],'CURRENT_ACTUAL_API_BEFORE_PIN');inverse(io.pinned(CANDIDATE+'/baseline/'+r['kind']+'-index.js',r['beforeSha256']),io.pinned(CANDIDATE+'/candidate/'+r['relative'],r['sha256']),json.loads(io.read(CANDIDATE+'/'+r['proofRelative'])));need(r['rawProofSha256']==i['backend'][r['kind']]['proofPin']['sha256']==m['packageHashes'][r['kind']+'-raw-backend-proof.json'],'PINNED_RAW_BACKEND_PROOF');need(r['approvedOwners']==i['backend'][r['kind']]['approvedOwners'],'EXACT_BACKEND_OWNER_BINDING')
    inverse(io.pinned(CANDIDATE+'/baseline/index.html',m['beforeHtmlSha256']),io.pinned(CANDIDATE+'/candidate/index.html',m['htmlSha256']),json.loads(io.read(CANDIDATE+'/html-delta.json')))
    for n in ('workbench-0-delta.json','workbench-1-delta.json'):
        p=json.loads(io.read(CANDIDATE+'/'+n));need(len(p['patches'])==1,'ONE_GETTER_BODY_ONLY');inverse(io.read(CANDIDATE+'/baseline/'+p['beforeUrl'][1:]),io.read(CANDIDATE+'/candidate/'+p['afterUrl'][1:]),p)
    need(m['controlsPackageHashes']==i['controlPins'] and sha(io.read(str(pathlib.Path(__file__).resolve())))==m['packageHashes']['release-driver.py']==m['controlsPackageHashes']['release-driver.py'],'EXECUTING_DRIVER_PIN')
    if require_final:
        for key in ('parentApproval','affectedNativeQA'):
            r=c[key];p=json.loads(io.pinned(r['file'],r['sha256']));need(p['manifestSha256']==c['manifestSha256'] and p['fixtureOnly'] is False,'FINAL_RECEIPT_EXACT_MANIFEST');need(p.get('approved') is True if key=='parentApproval' else p.get('status')=='PASS','INDEPENDENT_PARENT_NATIVE_APPROVAL')
        r=c['readonlyHelperQA'];p=json.loads(io.pinned(r['file'],r['sha256']));need(p['status']=='PASS' and p['fixtureOnly'] is False and p['defaultRealSiblingLoaderUsed'] is True and p['snapshotSha256']==DATA and p['helperHashes']==m['runtimeHelpers'] and p['readonly'] is True and p['http'] is False and p['db'] is False and p['businessWrites']==0,'ACTUAL_COPIED_READONLY_HELPER_PROOF');need(p['manifestSha256'] in (MANIFEST,c['manifestSha256']) and p['sourceRecordsChecked']==588 and p['statusCounts'].get('lcsc:ok',0)+p['statusCounts'].get('ickey:ok',0)==213,'EXACT_EXISTING_HELPER213_PROOF_NO_RESEARCH_REPLAY')
    return {'m':m,'manifestBytes':mb,'candidate':CANDIDATE}
class Engine:
    def __init__(self,c,inputsha,pkg,io=None,rpc=None):self.c=c;self.inputsha=inputsha;self.pkg=pkg;self.m=pkg['m'];self.io=io or IO();self.rpc=rpc or self.production_rpc;self.state=None
    def production_rpc(self,id=None,rollback=False):
        p=(CANDIDATE if id is None else ROOT)+'/attached-reloader.cjs';self.io.pinned(p,self.m['packageHashes']['attached-reloader.cjs']);args=['node',p]+(['--snapshot'] if id is None else (['--rollback'] if rollback else [])+['--manifest-sha256',self.c['manifestSha256'],'--attempt',self.c['attemptId'],'--id',str(id)]);r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120,check=False)
        if id is not None:self.event('rpc-result',id=id,direction='rollback' if rollback else 'forward',exitCode=r.returncode,stdoutSha256=sha(r.stdout),stderrSha256=sha(r.stderr))
        need(r.returncode==0,'ATTACHED_RPC_FAILED_NO_DAEMON_FALLBACK');x=json.loads(r.stdout);return x if id is None else x['processes']
    def event(self,name,**fields):self.io.append(ROOT+'/activation-events.jsonl',json.dumps({'event':name,'atUtc':utc(),'attemptId':self.c['attemptId'],**fields},ensure_ascii=False).encode()+b'\n')
    def save(self,phase=None,**fields):
        if phase:self.state['phase']=phase
        self.state.update(fields);self.state['updatedAtUtc']=utc();self.io.put(ROOT+'/activation-state.json',enc(self.state));self.event('checkpoint',phase=self.state['phase'])
    def owner(self):return {'ownerTask':OWNER,'runtimeRoot':ROOT,'manifestSha256':self.c['manifestSha256'],'inputContractSha256':self.c['inputContractSha256'],'nonce':self.c['rootOwnershipNonce']}
    def check_root(self):
        if not self.io.exists(ROOT):return
        need(json.loads(self.io.read(ROOT+'/release-owner.json'))==self.owner(),'EXACT_ROOT_NONCE_OWNER');need(self.io.files(ROOT).issubset({'manifest.json',*self.m['packageHashes'],'release-owner.json','activation-state.json','activation-events.jsonl','coordination-owned.json'}),'UNKNOWN_NEW_ROOT_FILE')
        for n,h in self.m['packageHashes'].items():self.io.pinned(ROOT+'/'+n,h)
        self.io.pinned(ROOT+'/manifest.json',self.c['manifestSha256'])
    def install(self):
        need(not self.io.exists(ROOT),'FIXED_ROOT_MUST_BE_NEW_NO_REPLAY');q=self.io.path(ROOT);no_symlinks(q);q.mkdir(mode=0o700);self.io.put(ROOT+'/release-owner.json',enc(self.owner()),exclusive=True)
        for n in ['manifest.json',*self.m['packageHashes']]:
            p=self.io.path(ROOT+'/'+rel(n));p.parent.mkdir(parents=True,exist_ok=True);self.io.put(ROOT+'/'+n,self.io.read(CANDIDATE+'/'+n),exclusive=True)
        self.check_root()
    def load_state(self):
        self.state=json.loads(self.io.read(ROOT+'/activation-state.json'));need(self.state['attemptId']==self.c['attemptId'] and self.state['inputSha256']==self.inputsha and self.state['manifestSha256']==self.c['manifestSha256'] and self.state['ownerTask']==OWNER and self.state['rootOwnershipNonce']==self.c['rootOwnershipNonce'],'EXACT_DURABLE_ATTEMPT_STATE');return self.state
    def owned_coord(self):
        need(self.state is not None,'STATE_REQUIRED');b=self.io.pinned(ROOT+'/coordination-owned.json',self.state['coordOwnedSha256']);need(self.io.read(COORD)==b,'FULL_OWNED_COORD_CAS');x=json.loads(b);need(x['shared_release_active'] is True and x['window']['attemptId']==self.c['attemptId'] and x['window']['nonce']==self.state['nonce'] and x['window']['owner_task']==OWNER and x['window']['manifestSha256']==self.c['manifestSha256'],'OWNED_WINDOW_NONCE');return b
    def mutable_expected(self,p):
        if p==PUBLIC+'/index.html':before=self.m['beforeHtmlSha256'];after=self.m['htmlSha256'];key='html'
        else:r=next(x for x in self.m['backendFiles'] if x['path']==p);before=r['beforeSha256'];after=r['sha256'];key=r['kind']
        if self.state is None:return before
        phase=self.state['phase']
        if phase in ('verified','applied-pending-verify'):return after
        if phase in ('prepared','opening','rolled-back','rolled-back-pending-verify','recovering'):return before
        need(phase in ('applying','recovery-required'),'KNOWN_LIFECYCLE_REQUIRED');return after if self.state.get('filesInstalled',{}).get(key) else before
    def frozen(self,recovery=False):
        guard=self.m['manualDisabledGuard']['path'];no_symlinks(self.io.path(guard));need(not self.io.exists(guard),'MANUAL_CONFIG_APPEARED_NO_ENABLE');mutable={FRONT,ADMIN,PUBLIC+'/index.html'}
        for r in self.m['legacyFrozenFiles']+self.m['protectedFiles']+self.m['protectedEnvFiles']:
            p=r['path']
            if p==COORD:
                need(r['sha256']==self.m['capturedCoordSha256'],'CAPTURED_COORD_ROW_BINDING')
                if self.state is None:self.io.pinned(COORD,r['sha256'])
                elif self.state['phase'] in ('verified','rolled-back'):self.io.pinned(COORD,self.state['coordClosedSha256'])
                else:self.owned_coord()
            elif p in mutable:
                captured=self.m['beforeHtmlSha256'] if p==PUBLIC+'/index.html' else next(x['beforeSha256'] for x in self.m['backendFiles'] if x['path']==p);need(r['sha256']==captured,'MUTABLE_CAPTURED_GUARD_PIN_MISMATCH_NO_OMISSION')
                if recovery and self.state and self.state.get('fileIntents',{}).get('html' if p==PUBLIC+'/index.html' else 'front' if p==FRONT else 'admin'):
                    h=sha(self.io.read(p));before=self.m['beforeHtmlSha256'] if p==PUBLIC+'/index.html' else next(x['beforeSha256'] for x in self.m['backendFiles'] if x['path']==p);after=self.m['htmlSha256'] if p==PUBLIC+'/index.html' else next(x['sha256'] for x in self.m['backendFiles'] if x['path']==p);need(h in (before,after),'RECOVERY_UNOWNED_FULL_BYTES')
                else:self.io.pinned(p,self.mutable_expected(p))
            else:self.io.pinned(p,r['sha256'])
        for r in self.m['baselineAssets']:self.io.pinned(PUBLIC+'/'+rel(r['relative']),r['sha256'])
        for r in self.m['frozenRootTrees']:
            need(self.io.files(r['root'])=={n for n,h in r['files']},'OLD_ROOT_SHAPE_FROZEN')
            for n,h in r['files']:self.io.pinned(r['root']+'/'+rel(n),h)
        expected={r['relative'] for r in self.m['baselineAssets']};allowed=set(expected)
        for r in self.state.get('assetIntents',[]) if self.state else []:
            need({'relative':r['relative'],'sha256':r['sha256']} in self.m['files'],'EXACT_OWNED_ASSET_INTENT');allowed.add(r['relative'])
            if self.io.exists(PUBLIC+'/'+r['relative']):self.io.pinned(PUBLIC+'/'+r['relative'],r['sha256'])
        actual={'assets/'+n for n in self.io.files(PUBLIC+'/assets')};need(expected.issubset(actual) and actual.issubset(allowed),'ALL_ASSET_SHAPE_NO_DELETE_EXTRA')
    def preflight(self):
        need(not self.io.exists(ROOT),'ROOT_ALREADY_PRESENT');self.frozen();rows_check(self.rpc(),self.m['baselineProcesses']);need(json.loads(self.io.pinned(COORD,self.m['capturedCoordSha256']))['shared_release_active'] is False,'WINDOW_BUSY')
        for r in self.m['backendFiles']:self.io.pinned(r['path'],r['beforeSha256'])
        self.io.pinned(PUBLIC+'/index.html',self.m['beforeHtmlSha256'])
        for r in self.m['files']:
            if r['relative']!='index.html':need(not self.io.exists(PUBLIC+'/'+r['relative']),'NEW_ASSET_ALREADY_EXISTS')
        return {'status':'READONLY_CAS_PLAN_PASS_NOT_AUTHORIZATION','writes':0,'targets':list(IDS),'ready':False}
    def add_asset(self,r):
        p=ROOT+'/candidate/'+r['relative'];q=PUBLIC+'/'+r['relative'];self.io.pinned(p,r['sha256']);src=self.io.path(p);dst=self.io.path(q);no_symlinks(src);no_symlinks(dst);need(dst.parent.is_dir() and src.stat().st_dev==dst.parent.stat().st_dev,'OWNED_EXCLUSIVE_LINK_SAME_FILESYSTEM_REQUIRED');os.chmod(src,0o644);info=src.stat();entry={**r,'device':info.st_dev,'inode':info.st_ino};self.state.setdefault('assetIntents',[]).append(entry);self.save();self.event('exclusive-add-intent',**entry);os.link(src,dst,follow_symlinks=False);self.io.sync(dst.parent);need(dst.stat().st_ino==info.st_ino and dst.stat().st_dev==info.st_dev,'OWNED_LINK_IDENTITY');self.io.pinned(q,r['sha256']);self.save()
    def reload(self,id,direction):
        self.owned_coord();self.check_root();self.frozen();api=next(x for x in self.m['backendFiles'] if id in x['ownedIds']);h=api['sha256' if direction=='forward' else 'beforeSha256'];self.io.pinned(api['path'],h);entry={'id':id,'direction':direction,'attemptId':self.c['attemptId'],'ownerTask':OWNER,'apiHash':h};self.state['intents'].append(entry);self.save('applying' if direction=='forward' else 'recovering');self.event('durable-reload-intent',**entry);rows=self.rpc(id,rollback=direction=='rollback');rows_check(rows,self.m['baselineProcesses'],owned={r['id'] for r in self.state['intents']},changed=[id]);self.state['completed'].append({'id':id,'direction':direction,'pid':next(r['pid'] for r in rows if r['id']==id)});self.save();return rows
    def verify(self):
        self.load_state();self.check_root();self.frozen();phase=self.state['phase'];need(phase in ('applied-pending-verify','verified','rolled-back-pending-verify','rolled-back'),'INCOMPLETE_USE_RECOVER');forward=phase in ('applied-pending-verify','verified');owned=set(IDS) if forward else {r['id'] for r in self.state['intents']};changed=set(IDS) if forward else {r['id'] for r in self.state['completed'] if r['direction']=='rollback'};rows=rows_check(self.rpc(),self.m['baselineProcesses'],owned=owned,changed=changed)
        for r in self.m['backendFiles']:self.io.pinned(r['path'],r['sha256' if forward else 'beforeSha256'])
        self.io.pinned(PUBLIC+'/index.html',self.m['htmlSha256' if forward else 'beforeHtmlSha256'])
        if forward:
            for r in self.m['files']:self.io.pinned(PUBLIC+'/'+r['relative'],r['sha256'])
        else:
            for r in self.state.get('assetIntents',[]):need(not self.io.exists(PUBLIC+'/'+r['relative']),'ROLLBACK_NEW_ASSET_NOT_REMOVED')
        for id in changed:need(any(r['id']==id and r['direction']==('forward' if forward else 'rollback') and r['pid']==next(x['pid'] for x in rows if x['id']==id) for r in self.state['completed']),'EXACT_CURRENT_RELOAD_RECEIPT_REQUIRED')
        return {'status':'VERIFIED_APPLIED' if forward else 'VERIFIED_OWNED_ROLLBACK','writes':0,'allOnline':True,'other6Unchanged':True,'windowClosed':phase in ('verified','rolled-back'),'manifestSha256':self.c['manifestSha256'],'processes':rows,'uiNormalClaim':False}
    def close(self):
        proof=self.verify();need(not proof['windowClosed'],'CLOSED_NO_REPLAY');before=self.owned_coord();co=json.loads(before);phase='verified' if self.state['phase']=='applied-pending-verify' else 'rolled-back';window=copy.deepcopy(co['window']);window.update(status=phase,closedAtUtc=utc(),receipt=ROOT+'/activation-state.json');co['window']=window;co['shared_release_active']=False;co.setdefault('window_history',[]).append(copy.deepcopy(window));co['updated_at']=utc();after=enc(co);self.save(closeIntent=True,coordClosedSha256=sha(after),closeTargetPhase=phase);self.io.cas(COORD,before,after);self.save(phase,closeIntent=False);return {**proof,'windowClosed':True,'writes':'coordination+private-journal-only'}
    def recover(self):
        self.load_state();self.check_root();need(self.state['phase'] not in ('verified','rolled-back'),'CLOSED_ATTEMPT_NO_REPLAY')
        if self.state.get('closeIntent') and sha(self.io.read(COORD))==self.state.get('coordClosedSha256'):self.save(self.state['closeTargetPhase'],closeIntent=False);return self.verify()
        original=self.io.read(ROOT+'/coordination-before.json')
        if self.io.read(COORD)==original and self.state['phase'] in ('prepared','opening','recovery-required') and not self.state['fileIntents'] and not self.state['intents'] and not self.state.get('assetIntents'):self.save('rolled-back',coordClosedSha256=sha(original),noWindowOpened=True);return self.verify()
        self.owned_coord();self.frozen(recovery=True);self.save('recovery-required',driverPid=os.getpid());operations=[('html',PUBLIC+'/index.html','baseline/index.html','candidate/index.html')]+[(r['kind'],r['path'],'baseline/'+r['kind']+'-index.js','candidate/'+r['relative']) for r in self.m['backendFiles']]
        for key,p,bn,an in operations:
            b=self.io.read(ROOT+'/'+bn);a=self.io.read(ROOT+'/'+an);now=self.io.read(p);need(now in (b,a),'UNOWNED_ROLLBACK_BYTES_REFUSED')
            if now==a:need(self.state['fileIntents'].get(key),'NO_OWNED_CAS_INTENT');self.event('rollback-cas-intent',path=p,beforeSha256=sha(a),afterSha256=sha(b));self.io.cas(p,a,b)
            self.state['filesInstalled'][key]=False;self.save()
        self.save('recovering');self.frozen();owned={r['id'] for r in self.state['intents']};rows=rows_check(self.rpc(),self.m['baselineProcesses'],owned=owned,offline=True);affected={r['id'] for r in self.state['intents'] if r['direction']=='forward'}
        for id in IDS:
            row=next(r for r in rows if r['id']==id);old=next(r for r in self.m['baselineProcesses'] if r['id']==id)
            if id not in affected:need(row==old,'NO_BLANKET_RELOAD_UNOWNED_PID')
        for id in IDS:
            if id not in affected:continue
            latest=next((r for r in reversed(self.state['completed']) if r['id']==id),None);row=next(r for r in rows if r['id']==id)
            if latest and latest['direction']=='rollback' and latest['pid']==row['pid'] and row['status']=='online':continue
            rows=self.reload(id,'rollback')
        for r in self.state.get('assetIntents',[]):
            p=PUBLIC+'/'+r['relative']
            if not self.io.exists(p):continue
            self.io.pinned(p,r['sha256']);s=self.io.path(p).stat();need(s.st_dev==r['device'] and s.st_ino==r['inode'],'UNOWNED_IDENTICAL_ASSET_DO_NOT_DELETE');self.event('owned-new-leaf-remove-intent',relative=r['relative'],sha256=r['sha256'],inode=r['inode']);self.io.path(p).unlink();self.io.sync(self.io.path(p).parent)
        self.save('rolled-back-pending-verify');return self.close()
    def apply(self):
        self.preflight();self.install();self.frozen();before=self.io.pinned(COORD,self.m['capturedCoordSha256']);co=json.loads(before);self.state={'contractVersion':'customer-origin-edit-state-v1','phase':'prepared','ownerTask':OWNER,'attemptId':self.c['attemptId'],'inputSha256':self.inputsha,'inputContractSha256':self.c['inputContractSha256'],'manifestSha256':self.c['manifestSha256'],'rootOwnershipNonce':self.c['rootOwnershipNonce'],'nonce':uuid.uuid4().hex,'intents':[],'completed':[],'fileIntents':{},'filesInstalled':{},'driverPid':os.getpid()};co['shared_release_active']=True;co['window']={'owner_task':OWNER,'task':OWNER,'attemptId':self.c['attemptId'],'nonce':self.state['nonce'],'manifestSha256':self.c['manifestSha256'],'status':'applying','opsDir':ROOT,'openedAtUtc':utc(),'scope':'fixed this-round front/admin AST patches; original four front and two admin sequential; additive Host chunks/CSS; no DB/business/manual refresh'};co['updated_at']=utc();owned=enc(co);self.io.put(ROOT+'/coordination-owned.json',owned,exclusive=True);self.state['coordOwnedSha256']=sha(owned);self.save('opening')
        try:
            self.io.cas(COORD,before,owned);self.save('applying');self.owned_coord();self.frozen()
            for r in self.m['files']:
                if r['relative']!='index.html':self.add_asset(r)
            for r in self.m['backendFiles']:
                self.state['fileIntents'][r['kind']]=True;self.save();self.io.cas(r['path'],self.io.read(ROOT+'/baseline/'+r['kind']+'-index.js'),self.io.read(ROOT+'/candidate/'+r['relative']));self.state['filesInstalled'][r['kind']]=True;self.save()
            for id in IDS:self.reload(id,'forward')
            self.owned_coord();self.frozen();self.state['fileIntents']['html']=True;self.save();self.io.cas(PUBLIC+'/index.html',self.io.read(ROOT+'/baseline/index.html'),self.io.read(ROOT+'/candidate/index.html'));self.state['filesInstalled']['html']=True;self.save('applied-pending-verify');return self.close()
        except BaseException as e:
            self.save('recovery-required',failureType=type(e).__name__,failure=str(e));self.event('failure-owned-rollback',failureType=type(e).__name__)
            try:self.recover()
            except BaseException as r:self.save('recovery-required',recoveryErrorType=type(r).__name__,recoveryError=str(r))
            raise

def main(argv=None):
    p=argparse.ArgumentParser(description='Fixed new namespace parent execution. No SSH/DB/HTTP/PM2 startup.');p.add_argument('--input',required=True);p.add_argument('--sha256',required=True);g=p.add_mutually_exclusive_group(required=True)
    for k in ('plan','apply','verify','recover','close'):g.add_argument('--'+k,action='store_true')
    a=p.parse_args(argv);io=IO();b=io.pinned(str(pathlib.Path(a.input).resolve()),a.sha256);c=json.loads(b);pkg=load_package(c,io,require_final=not a.plan);e=Engine(c,a.sha256,pkg,io)
    if a.plan:result=e.preflight()
    elif a.verify:result=e.verify()
    else:
        with io.locks():result=e.apply() if a.apply else e.recover() if a.recover else e.close()
    print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':
    try:main()
    except BaseException as e:print('CUSTOMER_ORIGIN_RELEASE_ABORT: '+str(e),file=sys.stderr);sys.exit(1)
