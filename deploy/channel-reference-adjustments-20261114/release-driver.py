#!/usr/bin/env python3
"""New namespace exact-byte driver. All production execution belongs to parent.
No SSH/Git/DB/HTTP, PM2 startup, env override, whole restart or legacy-driver import.
"""
import argparse, contextlib, copy, datetime, fcntl, hashlib, json, os, pathlib, re, shutil, stat, subprocess, sys, uuid
ROOT='/opt/ops/20261114-channel-reference-adjustments-YFqDo2A'
OLD='/opt/ops/20261114-channel-reference-pricing-CKSZQ7s'
COORD='/opt/ops/51-project-release-coordination-20261027.json'
LOCKS=('/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock')
ADMIN='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js'
FRONT='/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'
PUBLIC='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'
IDS=(191,192)
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
                q=self.path(p);no_symlinks(q)
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
        if old['id'] not in IDS:need(p==old,'OTHER_10_ALL_CAPTURED_FIELDS_PID_FROZEN '+str(old['id']));continue
        need(old['name']=='dianzi51-admin' and old['script']==ADMIN and old['execMode']=='cluster_mode','EXACT_ADMIN_BINDING')
        need(config(p)==config(old),'ADMIN_CONFIG_ENV_CWD_SCRIPT_DRIFT')
        if old['id'] not in owned:need(p==old,'UNOWNED_ADMIN_PID_STATUS_DRIFT')
        if not offline or old['id'] not in owned:need(p['status']=='online' and p['pid']>0,'ALL_ONLINE_REQUIRED')
        if old['id'] in changed:need(p['pid']!=old['pid'],'ADMIN_PID_NOT_CHANGED')
    return rows
def load_package(c,io,require_final=True):
    need(c['contractVersion']=='channel-adjustments-activation-v1' and c['runtimeRoot']==ROOT,'ACTIVATION_CONTRACT_VERSION_ROOT')
    need(c['ownerTask']=='YFqDo2AR0TXSRSf6EV1KvK' and re.fullmatch(r'[A-Za-z0-9_-]{16,96}',c['attemptId']) and re.fullmatch(r'[A-Za-z0-9_-]{16,96}',c['rootOwnershipNonce']),'NEW_ATTEMPT_OWNER_REQUIRED')
    candidate=str(pathlib.Path(c['candidateDir']).resolve());mbytes=io.pinned(candidate+'/manifest.json',c['manifestSha256']);m=json.loads(mbytes)
    need(m['contractVersion']=='channel-reference-adjustments-v1' and m['runtimeRoot']==ROOT and m['priorRuntimeRoot']==OLD and m['fixtureOnly'] is False,'ACTUAL_NEW_MANIFEST_ONLY')
    need(m['ownerTask']==c['ownerTask'] and m['inputContractSha256']==c['inputContractSha256'],'INPUT_SOURCE_BINDING')
    need(io.files(candidate)=={'manifest.json',*m['packageHashes']},'UNKNOWN_EXTRA_OR_MISSING_PACKAGE_FILE')
    need(m['publicRoot']==PUBLIC and m['apiPaths']=={'admin':ADMIN,'front':FRONT},'STABLE_PRODUCTION_PATHS')
    need(len(m['backendFiles'])==1 and m['backendFiles'][0]['path']==ADMIN and m['backendFiles'][0]['ownedIds']==list(IDS),'ONE_API_TWO_ORIGINAL_IDS')
    need(len(m['baselineProcesses'])==12 and len(m['baselineAssets'])>0,'REAL_CURRENT_BASELINE_REQUIRED')
    need(sorted(r['relative'] for r in m['runtimeHelpers'])==['channel-reference-service.mjs','channel-reference-snapshot.json'],'ONLY_TWO_HELPERS')
    for n,h in m['packageHashes'].items():io.pinned(candidate+'/'+rel(n),h)
    for n,h in m['sourceHashes'].items():io.pinned(candidate+'/source-snapshot/'+rel(n),h)
    need(set(m['priorSourceHashes']).issubset(m['sourceHashes']) and len(m['priorSourceHashes'])==129,'OLD_129_UNION_FROZEN_SUBSET')
    for n,h in m['priorSourceHashes'].items():io.pinned(candidate+'/prior-source-snapshot/'+rel(n),h)
    inputbytes=io.pinned(candidate+'/input-contract.json',c['inputContractSha256']);source_input=json.loads(inputbytes)
    need(source_input['sourceHashes']==m['sourceHashes'],'ACTUAL_COMPUTED_SOURCE_HASHES_NOT_SUBSTITUTED')
    receipt=json.loads(io.read(candidate+'/source-pin-receipt.json'));need(receipt['frozen'] is True and receipt['sourceHashes']==m['sourceHashes'],'COMPLETE_CURRENT_SOURCE_FREEZE')
    for n in ('release-driver.py','attached-admin-reloader.cjs','validate-snapshot-helper.cjs'):need(n in m['packageHashes'],'CONTROL_TOOL_NOT_IN_MANIFEST '+n)
    need(sha(io.read(str(pathlib.Path(__file__).resolve())))==m['packageHashes']['release-driver.py'],'ACTUAL_EXECUTING_DRIVER_PIN')
    inverse(io.read(candidate+'/baseline/admin-index.js'),io.read(candidate+'/candidate/api/admin-index.js'),json.loads(io.read(candidate+'/api-import-delta.json')))
    inverse(io.read(candidate+'/baseline/index.html'),io.read(candidate+'/candidate/index.html'),json.loads(io.read(candidate+'/html-delta.json')))
    for n in ('workbench-0-delta.json','workbench-1-delta.json'):
        p=json.loads(io.read(candidate+'/'+n));inverse(io.read(candidate+'/baseline/'+p['beforeUrl'].lstrip('/')),io.read(candidate+'/candidate/'+p['afterUrl'].lstrip('/')),p)
    for kind in ('affectedNativeQA','parentReview'):
        if not require_final:continue
        r=c[kind];receipt=json.loads(io.pinned(r['file'],r['sha256']));need(receipt['manifestSha256']==c['manifestSha256'] and receipt['fixtureOnly'] is False,'ACTUAL_QA_REVIEW_RECEIPT_MANIFEST')
        if kind=='affectedNativeQA':need(receipt['status']=='PASS','AFFECTED_NATIVE_QA_REQUIRED')
        else:need(receipt['approved'] is True and receipt['inputContractSha256']==c['inputContractSha256'],'INDEPENDENT_PARENT_REVIEW_REQUIRED')
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
        for r in self.m['baselineAssets']:self.io.pinned(PUBLIC+'/'+rel(r['relative']),r['sha256'])
        for r in self.m['protectedFiles']+self.m['legacyFrozenFiles']:self.io.pinned(r['path'],r['sha256'])
        self.io.pinned(FRONT,self.m['untouchedFrontApiSha256'])
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
        tool=self.pkg['candidate']+'/validate-snapshot-helper.cjs';self.io.pinned(tool,self.m['packageHashes']['validate-snapshot-helper.cjs'])
        result=subprocess.run(['node',tool,'--candidate',self.pkg['candidate'],'--manifest-sha256',self.c['manifestSha256']],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=120)
        need(result.returncode==0,'ACTUAL_READONLY_HELPER_VALIDATION_FAILED '+str(result.returncode));proof=json.loads(result.stdout);need(proof['status']=='PASS' and proof['defaultRealSiblingLoaderUsed'] is True and proof['manifestSha256']==self.c['manifestSha256'],'ACTUAL_LOADER_PROOF');return result.stdout
    def plan(self):
        # No mkdir, locks, journal, install or helper execution. PM2 attach snapshot only.
        self.check_root()
        self.frozen();self.io.pinned(ADMIN,self.m['backendFiles'][0]['beforeSha256']);self.io.pinned(PUBLIC+'/index.html',self.m['beforeHtmlSha256']);coord=self.io.pinned(COORD,self.m['capturedCoordSha256']);need(json.loads(coord)['shared_release_active'] is False,'CURRENT_WINDOW_NOT_IDLE')
        rows_check(self.rpc(),self.m['baselineProcesses'])
        need(not self.io.exists(ROOT+'/activation-state.json'),'ATTEMPT_ALREADY_STARTED_NO_REPLAY')
        for r in self.m['files']:
            if r['relative']!='index.html':need(not self.io.exists(PUBLIC+'/'+r['relative']),'NEW_PUBLIC_ASSET_EXISTS')
        return {'mode':'plan','writes':0,'ready':False,'targets':list(IDS),'newRoot':ROOT,'manifestSha256':self.c['manifestSha256'],'inputSha256':self.inputsha,'status':'CHECKED_OFFLINE_PACKAGE_AND_CURRENT_CAS_NO_ACTIVATION'}
    def load_state(self):
        self.state=json.loads(self.io.read(ROOT+'/activation-state.json'));need(self.state['inputSha256']==self.inputsha and self.state['attemptId']==self.c['attemptId'] and self.state['manifestSha256']==self.c['manifestSha256'] and self.state['ownerTask']==self.c['ownerTask'],'STATE_DIFFERENT_ATTEMPT_NO_REPLAY');return self.state
    def intent(self,id,direction):
        self.owned_coord();self.check_root();self.frozen();api=self.m['backendFiles'][0];self.io.pinned(ADMIN,api['sha256' if direction=='forward' else 'beforeSha256'])
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
        self.io.pinned(ADMIN,self.m['backendFiles'][0]['sha256' if forward else 'beforeSha256']);self.io.pinned(PUBLIC+'/index.html',self.m['htmlSha256' if forward else 'beforeHtmlSha256'])
        if forward:
            for r in self.m['files']:self.io.pinned(PUBLIC+'/'+r['relative'],r['sha256'])
        changed=list(IDS) if forward else sorted({x['id'] for x in state.get('completed',[]) if x['direction']=='rollback'})
        rows=rows_check(self.rpc(),self.m['baselineProcesses'],owned=IDS,changed=changed)
        need(all(any(x['id']==id and x['direction']==('forward' if forward else 'rollback') for x in state.get('completed',[])) for id in changed),'TARGET_RELOAD_COMPLETION_RECEIPTS_MISSING')
        return {'mode':'verify','writes':0,'status':'VERIFIED_APPLIED_BYTES_PM2_ONLY' if forward else 'VERIFIED_OWNED_ROLLBACK_BYTES_PM2_ONLY','manifestSha256':self.c['manifestSha256'],'allOnline':True,'other10CapturedFieldsAndPidsUnchanged':True,'adminIds':list(IDS),'processes':rows,'uiNormalClaim':False,'ready':False,'windowClosed':state['phase'] in ('verified','rolled-back')}
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
        for live,bef,aft in [(PUBLIC+'/index.html',ROOT+'/baseline/index.html',ROOT+'/candidate/index.html'),(ADMIN,ROOT+'/baseline/admin-index.js',ROOT+'/candidate/api/admin-index.js')]:
            b=self.io.read(bef);a=self.io.read(aft);now=self.io.read(live);need(now in (a,b),'ROLLBACK_UNOWNED_BYTES_REFUSED '+live)
            if now==a:self.event('rollback-cas-intent',{'path':live,'from':sha(a),'to':sha(b)});self.io.cas(live,a,b)
        self.frozen();rows=self.rpc();rows_check(rows,self.m['baselineProcesses'],owned=IDS,offline=True)
        affected={x['id'] for x in self.state['intents'] if x['direction']=='forward'}
        if self.state.get('apiIntent'):affected.update(IDS) # uncertainty after API switch owns both original admins
        affected.update(p['id'] for p in rows if p['id'] in IDS and (p['pid']!=next(x['pid'] for x in self.m['baselineProcesses'] if x['id']==p['id']) or p['status']!='online'))
        for id in sorted(affected):self.intent(id,'rollback')
        self.save('rolled-back-pending-verify');return self.verify()
    def apply(self,helper_proof):
        need(not self.io.exists(ROOT+'/activation-state.json'),'REPEATED_APPLY_FORBIDDEN_USE_VERIFY_OR_RECOVER')
        self.install();self.frozen();rows_check(self.rpc(),self.m['baselineProcesses']);api=self.m['backendFiles'][0];self.io.pinned(ADMIN,api['beforeSha256']);self.io.pinned(PUBLIC+'/index.html',self.m['beforeHtmlSha256']);before=self.io.pinned(COORD,self.m['capturedCoordSha256']);co=json.loads(before);need(co['shared_release_active'] is False,'WINDOW_BUSY')
        self.state={'contractVersion':'channel-adjustments-activation-state-v1','phase':'prepared','inputSha256':self.inputsha,'inputContractSha256':self.c['inputContractSha256'],'manifestSha256':self.c['manifestSha256'],'attemptId':self.c['attemptId'],'ownerTask':self.c['ownerTask'],'rootOwnershipNonce':self.c['rootOwnershipNonce'],'nonce':uuid.uuid4().hex,'openedAtUtc':utc(),'intents':[],'completed':[],'apiIntent':False}
        co['shared_release_active']=True;co['window']={'owner_task':self.state['ownerTask'],'task':self.state['ownerTask'],'attemptId':self.state['attemptId'],'nonce':self.state['nonce'],'manifestSha256':self.state['manifestSha256'],'status':'applying','scope':'only two current native Host chunks, scoped CSS, one admin helper import and exact 191/192 reload; no business writes','opsDir':ROOT,'openedAtUtc':self.state['openedAtUtc']};co['updated_at']=utc();owned=enc(co)
        self.io.put(ROOT+'/coordination-before.json',before);self.io.put(ROOT+'/coordination-owned.json',owned);self.io.put(ROOT+'/actual-helper-validation.json',helper_proof);self.state['coordOwnedSha256']=sha(owned);self.save('opening')
        try:
            self.io.cas(COORD,before,owned);self.save('applying');self.owned_coord();self.frozen()
            for r in self.m['files']:
                if r['relative']=='index.html':continue
                n=rel(r['relative']);v=self.io.pinned(ROOT+'/candidate/'+n,r['sha256']);self.event('public-add-intent',{'relative':n,'sha256':r['sha256']});self.io.add(PUBLIC+'/'+n,v)
            self.save(apiIntent=True);self.io.cas(ADMIN,self.io.read(ROOT+'/baseline/admin-index.js'),self.io.read(ROOT+'/candidate/api/admin-index.js'));self.save(apiInstalled=True)
            for id in IDS:self.intent(id,'forward')
            self.owned_coord();self.frozen();self.io.pinned(ADMIN,api['sha256']);self.save(htmlIntent=True);self.io.cas(PUBLIC+'/index.html',self.io.read(ROOT+'/baseline/index.html'),self.io.read(ROOT+'/candidate/index.html'));self.save('applied-pending-verify',htmlInstalled=True)
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
