#!/usr/bin/env python3
"""Single-use fixed-owner static production controller. No SSH or lifecycle API.
Production injection does not exist. Missing independent fresh runtime policy or final
fullmanifest rejects before opening coord/attempt. Uncertified failure holds both locks.
"""
import argparse, copy, os, re, sys, time, uuid
from pathlib import Path
from html.parser import HTMLParser
sys.dont_write_bytecode=True
import safety_core as h
import static_scope as s
import adapters as a
SOURCE_SCOPE={'client/src/components/OfficialMallSearchResults.tsx','client/src/components/OfficialMaterialResources.tsx','client/src/pages/OfficialProductDetail.tsx','client/src/pages/ProductDetail.tsx'}
CAPTURE_KEYS=('schema','ownerTask','scope','captureNonce','capturedAtUtc','ttlSeconds','sourceBinding','coordBase64','coordRecord','state','captureMetadataSHA','htmlBeforeRecord','htmlBeforeBase64','productionWrites')
SEAL_KEYS=('schema','ownerTask','scope','captureSHA','captureFileRecord','captureMetadataSHA','controllerAggregateSHA','sourceFiles','manifestSHA','candidate','sealNonce','status')
REVIEW_KEYS=('schema','ownerTask','scope','status','independentReviewer','reviewNonce','captureNonce','captureSHA','captureMetadataSHA','controllerAggregateSHA','sourceFiles','manifestSHA','sealSHA','candidateSHA','runtimePolicySHA','sourceScope','releaseApproved','detailScopeFinalized')
def recent(c):
    h.need(c['ownerTask']==s.OWNER and c['scope']==s.SCOPE and c['ttlSeconds']==s.TTL,'CAPTURE_SCOPE_TTL')
    age=time.time()-h.timestamp(c['capturedAtUtc']);h.need(0<=age<=s.TTL,'CAPTURE_EXPIRED_OR_FUTURE')
def closed(data):
    c=h.decode(data);h.need(isinstance(c,dict) and c.get('shared_release_active') is False,'COORD_BUSY_ANY_SCOPE')
    w=c.get('window');h.need(isinstance(w,dict) and w.get('status') in ('closed','verified') and w.get('needsOperatorRecovery') is False and c.get('needsOperatorRecovery',False) is False,'COORD_NOT_CERTIFIED_CLOSED')
    h.timestamp(w.get('closedAtUtc'));return c
class Html(HTMLParser):
    def __init__(self):super().__init__();self.maps=[];self.active=False;self.body=[];self.refs=set()
    def asset(self,v):
        if isinstance(v,str) and v.startswith('/assets/'):
            h.need(re.fullmatch(r'/assets/[A-Za-z0-9._/-]+',v) and '..' not in v.split('/'),'HTML_ASSET_PATH');self.refs.add(v)
    def handle_starttag(self,t,attrs):
        if t not in ('script','link'):return
        h.need(len(attrs)==len(dict(attrs)),'DUPLICATE_HTML_RESOURCE_ATTRIBUTE');d=dict(attrs)
        if t=='script' and d.get('type')=='importmap':h.need(not self.active and 'src' not in d,'INLINE_IMPORTMAP');self.active=True;self.body=[]
        self.asset(d.get('src' if t=='script' else 'href'))
    def handle_data(self,x):
        if self.active:self.body.append(x)
    def handle_endtag(self,t):
        if t=='script' and self.active:self.maps.append(h.decode(''.join(self.body)));self.active=False

def html_refs(data):
    p=Html();p.feed(data.decode());p.close();h.need(not p.active and len(p.maps)==1,'SINGLE_IMPORTMAP')
    m=p.maps[0];h.need(isinstance(m,dict) and set(m)<={'imports','scopes'} and isinstance(m.get('imports'),dict) and isinstance(m.get('scopes',{}),dict),'IMPORTMAP_SCHEMA')
    for table in [m['imports'],*m.get('scopes',{}).values()]:
        h.need(isinstance(table,dict),'IMPORTMAP_TABLE')
        for v in table.values():p.asset(v)
    return m,sorted(p.refs)
def proof(before,after,p,*,allow_identity=False):
    h.exact(p,('beforeSHA','afterSHA','patches'),'FULL_BYTE_INVERSE_PROOF')
    h.need(p['beforeSHA']==h.H(before) and p['afterSHA']==h.H(after),'PROOF_FULL_HASH')
    if allow_identity and before==after:
        h.need(p['patches']==[],'IDENTITY_PROOF_EXACT_EMPTY_PATCH_SET');return
    h.need(isinstance(p['patches'],list) and p['patches'],'PROOF_NONEMPTY')
    pieces=[];end=0;growth=0;inverse=[]
    for r in p['patches']:
        h.exact(r,('start','end','outputStart','beforeBase64','afterBase64'),'BYTE_PATCH')
        x,z=r['start'],r['end'];old,new=h.unb64(r['beforeBase64']),h.unb64(r['afterBase64'])
        h.need(type(x) is int and type(z) is int and end<=x<=z<=len(before) and before[x:z]==old and old!=new and r['outputStart']==x+growth,'PROOF_RANGE')
        pieces.extend((before[end:x],new));inverse.append((x+growth,new,old));end=z;growth+=len(new)-len(old)
    pieces.append(before[end:]);h.need(b''.join(pieces)==after,'FORWARD_ALL_BYTES')
    restored=after
    for x,new,old in reversed(inverse):h.need(restored[x:x+len(new)]==new,'INVERSE_SPAN');restored=restored[:x]+old+restored[x+len(new):]
    h.need(restored==before,'INVERSE_ALL_BYTES')
def safe_relative(x):h.need(isinstance(x,str) and re.fullmatch(r'[A-Za-z0-9._/-]+',x) and all(v not in ('','.','..') for v in x.split('/')),'RELATIVE_PATH');return x

def apply_importmap_changes(before,changes):
    maps=copy.deepcopy(before);seen=set();h.need(isinstance(changes,list),'IMPORTMAP_CHANGES')
    def target(value):
        h.need(isinstance(value,str) and value.startswith('/assets/'),'IMPORTMAP_NEW_ASSET_ONLY')
        safe_relative(value[1:])
    for change in changes:
        h.need(isinstance(change,dict),'IMPORTMAP_CHANGE')
        if set(change)=={'key','before','after'}:
            key=change['key'];token=('imports',key)
            h.need(isinstance(key,str) and token not in seen and maps['imports'].get(key)==change['before'],'IMPORTMAP_EXACT_OLD_KEY')
            target(change['after']);maps['imports'][key]=change['after']
        else:
            h.exact(change,('scope','before','after'),'IMPORTMAP_SCOPES_SNAPSHOT')
            token=('scopes',None)
            h.need(change['scope']=='scopes' and token not in seen and maps.get('scopes')==change['before'],'IMPORTMAP_EXACT_OLD_SCOPES')
            tables=change['after'];h.need(tables is None or isinstance(tables,dict),'IMPORTMAP_SCOPES_TYPE')
            for prefix,table in (tables or {}).items():
                h.need(isinstance(prefix,str) and prefix.startswith('/assets/') and isinstance(table,dict),'IMPORTMAP_STATIC_SCOPE')
                for key,value in table.items():h.need(isinstance(key,str),'IMPORTMAP_SCOPE_KEY');target(value)
            if tables is None:maps.pop('scopes',None)
            else:maps['scopes']=copy.deepcopy(tables)
        seen.add(token)
    return maps

def candidate(cfg,c):
    directory=h.no_symlink(cfg.candidate);raw=h.regular(directory/'manifest.json');m=h.decode(raw)
    h.need(raw==h.encode(m),'MANIFEST_CANONICAL')
    h.exact(m,('schema','ownerTask','scope','detailScopeFinalized','presentationOnly','sourceScope','files','assets','dependencies','importGraph','html','importMapChanges','sourceChanges','independentEvidenceFile'),'FULLMANIFEST')
    h.need(m['schema']=='static-fullmanifest-v1' and m['ownerTask']==s.OWNER and m['scope']==s.SCOPE and m['detailScopeFinalized'] is True and m['presentationOnly'] is True,'FINAL_DETAIL_PRESENTATION_MANIFEST_REQUIRED')
    h.need(isinstance(m['sourceScope'],list) and len(m['sourceScope'])==len(set(m['sourceScope'])) and set(m['sourceScope'])==SOURCE_SCOPE,'EXACT_AUTHORIZED_FOUR_SOURCE_SCOPE')
    expected={'manifest.json'};pins={'manifest.json':h.H(raw)};dirs=set()
    for row in m['files']:
        h.exact(row,('path','sha256','size','role'),'PACKAGE_FILE');name=safe_relative(row['path'])
        h.need(name not in expected and row['role'] in ('html-after','new-asset','seed','source-before','source-after','independent-report'),'PACKAGE_EXACT_UNIQUE_ROLE')
        data=h.regular(directory/name);h.need(type(row['size']) is int and row['size']==len(data) and h.H(data)==h.pin(row['sha256']),'PACKAGE_ALL_BYTES_PIN')
        expected.add(name);pins[name]=row['sha256']
        dirs.update(str(p) for p in Path(name).parents if str(p)!='.')
    actual=set();actualdirs=set()
    for q in directory.rglob('*'):
        h.no_symlink(q);name=str(q.relative_to(directory))
        if q.is_dir():actualdirs.add(name)
        elif q.is_file():actual.add(name)
        else:raise h.ReleaseError('CANDIDATE_SPECIAL')
    h.need(actual==expected and actualdirs==dirs,'CANDIDATE_EXACT_FULL_PATH_SET')
    h.need('index.html' in pins and isinstance(m['assets'],list) and m['assets'],'HTML_AND_NONEMPTY_EXACT_ASSETS')
    after=h.regular(directory/'index.html');before=h.unb64(c['htmlBeforeBase64'])
    h.exact(m['html'],('beforeSHA','afterSHA','proof'),'HTML_MANIFEST');h.need(m['html']['beforeSHA']==h.H(before) and m['html']['afterSHA']==h.H(after),'HTML_SEED_BINDING');proof(before,after,m['html']['proof'])
    oldmap,oldrefs=html_refs(before);newmap,refs=html_refs(after)
    maps=apply_importmap_changes(oldmap,m['importMapChanges'])
    h.need(maps==newmap,'IMPORTMAP_NO_OTHER_CHANGES')
    names=set();assets=[]
    for r in m['assets']:
        h.exact(r,('url','sha256','size','beforeUrl','beforeFile','proof'),'EXACT_ASSET');digest=h.pin(r['sha256']);url=r['url']
        h.need(isinstance(url,str) and re.fullmatch(r'/assets/[A-Za-z0-9._-]+-'+digest+r'\.(?:js|webp)',url),'CONTENT_ADDRESSED_BASENAME_ONLY')
        name=url[1:];h.need(name not in names and pins.get(name)==digest,'ASSET_EXACT_SET_PIN');names.add(name)
        data=h.regular(directory/name);h.need(r['size']==len(data),'ASSET_SIZE')
        seed=h.regular(directory/safe_relative(r['beforeFile']))
        if r['beforeUrl'] is None:h.need(seed==b'','NEW_MODULE_EMPTY_BEFORE_SEED_ONLY')
        else:
            oldurl=r['beforeUrl'];h.need(isinstance(oldurl,str) and oldurl.startswith('/assets/'),'EXISTING_SEED_URL')
            safe_relative(oldurl[1:]);oldrecord=c['state']['protectedFiles'].get(str(cfg.front/oldurl[1:]))
            h.need(oldrecord and oldrecord.get('sha256')==h.H(seed) and oldrecord.get('size')==len(seed),'SEED_REAL_CAPTURE_BYTES_BINDING')
        proof(seed,data,r['proof'],allow_identity=url.endswith('.webp') and r['beforeUrl'] is not None);assets.append(r)
    h.need(names=={r['path'] for r in m['files'] if r['role']=='new-asset'},'ASSET_FULLMANIFEST_EXACT_SET')
    h.need(isinstance(m['dependencies'],list),'EXACT_DEPENDENCY_SET');dependency_urls=set()
    for row in m['dependencies']:
        h.exact(row,('url','sha256','size'),'CURRENT_STATIC_DEPENDENCY');url=row['url'];h.need(isinstance(url,str) and url.startswith('/assets/'),'DEPENDENCY_STATIC_URL');safe_relative(url[1:])
        h.need(url not in dependency_urls and url not in {r['url'] for r in assets},'DEPENDENCY_UNIQUE_EXISTING_ONLY');dependency_urls.add(url)
        record=c['state']['protectedFiles'].get(str(cfg.front/url[1:]))
        h.need(record and record.get('sha256')==h.pin(row['sha256']) and record.get('size')==row['size'],'DEPENDENCY_REAL_CAPTURE_PIN')
    h.need(set(refs)-{r['url'] for r in assets}<=dependency_urls,'HTML_EXISTING_REFS_EXACT_DEPENDENCY_PIN')
    new_urls={r['url'] for r in assets};reachable=set(refs);edges=set()
    h.need(isinstance(m['importGraph'],list),'AST_IMPORT_GRAPH_REQUIRED')
    for row in m['importGraph']:
        h.exact(row,('fromUrl','toUrl'),'STATIC_IMPORT_GRAPH_EDGE');edge=(row['fromUrl'],row['toUrl'])
        h.need(edge not in edges and edge[0] in new_urls and edge[1] in new_urls|dependency_urls,'AST_IMPORT_GRAPH_EXACT_BOUNDARY');edges.add(edge)
    for _ in range(len(new_urls)+1):reachable.update(to for fr,to in edges if fr in reachable)
    h.need(new_urls<=reachable,'EVERY_NEW_ASSET_REACHABLE_FROM_HTML_OR_AUDITED_IMPORT_GRAPH')
    h.need(set(r['path'] for r in m['sourceChanges'])==SOURCE_SCOPE and len(m['sourceChanges'])==len(SOURCE_SCOPE),'SOURCE_CHANGE_EXACT_SET')
    for r in m['sourceChanges']:
        h.exact(r,('path','beforeFile','afterFile','proof'),'SOURCE_CHANGE')
        proof(h.regular(directory/safe_relative(r['beforeFile'])),h.regular(directory/safe_relative(r['afterFile'])),r['proof'])
    report=h.decode(h.regular(directory/safe_relative(m['independentEvidenceFile'])))
    h.exact(report,('status','detailScopeFinalized','presentationOnly','fullRebuildParity','nonTargetBytesExact','apiStoreFlagsEnvUntouched','staticImportClosureExact','importGraphSHA','dependencySHAs','sourceScope','assetSHAs'),'INDEPENDENT_BUILD_REPORT')
    h.need(report['status']=='INDEPENDENT_REVIEW_PASSED' and all(report[k] is True for k in ('detailScopeFinalized','presentationOnly','fullRebuildParity','nonTargetBytesExact','apiStoreFlagsEnvUntouched','staticImportClosureExact')) and report['importGraphSHA']==h.H(h.encode(m['importGraph'])) and report['dependencySHAs']=={r['url']:r['sha256'] for r in m['dependencies']} and set(report['sourceScope'])==SOURCE_SCOPE and report['assetSHAs']==[r['sha256'] for r in assets],'INDEPENDENT_FINAL_SCOPE_BUILD_EVIDENCE')
    return {'manifestSHA':h.H(raw),'packageFiles':pins,'fileRecords':{n:h.describe(directory/n) for n in sorted(expected)},'directoryRecords':{'.':h.metadata(directory),**{n:h.metadata(directory/n) for n in sorted(dirs)}},'assets':assets,'dependencies':m['dependencies'],'beforeHtmlSHA':h.H(before),'afterHtmlSHA':h.H(after),'htmlReferences':refs,'beforeReferences':oldrefs,'sourceScope':m['sourceScope'],'independentEvidenceSHA':pins[m['independentEvidenceFile']]}

class Controller:
    def __init__(self,cfg=None,*,adapter=None,hook=None):
        self.cfg=cfg or s.StaticConfig();h.need(self.cfg.fixture_root is not None or (adapter is None and hook is None),'INJECTION_TMP_ONLY')
        self.adapter=adapter or a.Adapter(self.cfg);self.hook=hook or (lambda _:None);self.src=a.sources();self.hold_locks=None
    def acquire(self):return h.Locks(self.cfg).acquire()
    def no_replay(self,fresh=False):
        for n in ('attempt.json','confirmed.json','restored.json','failure.json','failure-status.json','before.html','before.json'):
            p=self.cfg.stage/n;h.need(not p.exists() and not p.is_symlink(),'NO_REPLAY:'+n)
        if fresh:h.need(not (self.cfg.stage/'capture.json').exists() and not (self.cfg.stage/'capture.json').is_symlink(),'FRESH_CAPTURE_REQUIRED')
    def valid_capture(self,c):
        h.exact(c,CAPTURE_KEYS,'CAPTURE');h.need(c['schema']=='static-production-capture-v2' and c['productionWrites']==0 and c['sourceBinding']==self.src,'CAPTURE_SOURCE_SCHEMA')
        recent(c);h.need(re.fullmatch('[0-9a-f]{32}',c['captureNonce']) and c['captureMetadataSHA']==h.H(h.encode(c['state'])),'CAPTURE_META_NONCE')
        cb=h.unb64(c['coordBase64']);closed(cb);h.need(c['coordRecord']['sha256']==h.H(cb) and c['htmlBeforeRecord']['sha256']==h.H(h.unb64(c['htmlBeforeBase64'])),'CAPTURE_BYTES_RECORD_BINDING')
        return cb
    def guard(self,c,locks):self.valid_capture(c);return a.Guard(self.adapter,locks,c['state'],self.src,lambda:recent(c))
    def get_roots(self,html=None):
        h.need(self.adapter.get('51dianzi.com','')==(html if html is not None else h.regular(self.cfg.html)),'PUBLIC_FRONT_ROOT_BYTES')
        h.need(self.adapter.get('admin.51dianzi.com','')==h.regular(self.cfg.path(s.ADMIN_PUBLIC)/'index.html'),'PUBLIC_ADMIN_ROOT_BYTES')
    def get_refs(self,info,new=False):
        newurls={r['url'] for r in info['assets']}
        for url in sorted(set(info['htmlReferences'])|{r['url'] for r in info['dependencies']}):
            if not new and url in newurls:continue
            data=h.regular(self.cfg.front/url[1:]);h.need(self.adapter.get('51dianzi.com',url[1:])==data,'PUBLIC_ASSET_BYTES:'+url)
    def capture(self):
        locks=self.acquire()
        try:
            self.no_replay(True);h.need(a.sources()==self.src,'SOURCE_DRIFT')
            stage=h.no_symlink(self.cfg.stage);st=stage.stat();h.need(st.st_uid==os.geteuid() and not stat_mode(st)&0o077,'PRIVATE_FRESH_STAGE')
            at=h.now();cb=h.regular(self.cfg.coord);closed(cb);cr=h.describe(self.cfg.coord)
            self.get_roots();state=self.adapter.snapshot();before=h.regular(self.cfg.html);hr=h.describe(self.cfg.html)
            _,refs=html_refs(before)
            for url in refs:h.need(str(self.cfg.front/url[1:]) in state['protectedFiles'],'CURRENT_STATIC_REF_NOT_PROTECTED')
            c={'schema':'static-production-capture-v2','ownerTask':s.OWNER,'scope':s.SCOPE,'captureNonce':uuid.uuid4().hex,'capturedAtUtc':at,'ttlSeconds':s.TTL,'sourceBinding':self.src,'coordBase64':h.b64(cb),'coordRecord':cr,'state':state,'captureMetadataSHA':h.H(h.encode(state)),'htmlBeforeRecord':hr,'htmlBeforeBase64':h.b64(before),'productionWrites':0}
            self.guard(c,locks).check();h.need(h.describe(self.cfg.coord)==cr,'CAPTURE_COORD_FINAL_CAS');return c
        finally:locks.release()
    def save_capture(self,raw):
        c=h.decode(raw);h.need(raw==h.encode(c),'CAPTURE_CANONICAL');locks=self.acquire()
        try:
            self.no_replay(True);guard=self.guard(c,locks);guard.check()
            # Save only after the complete stdout was received. The capture excludes
            # preparation namespace; its immutable record is sealed separately below.
            p=h.no_symlink(self.cfg.stage/'capture.json');fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            try:
                view=memoryview(raw)
                while view:n=os.write(fd,view);h.need(n>0,'CAPTURE_SHORT_WRITE');view=view[n:]
                os.fsync(fd)
            finally:os.close(fd)
            h.fsync_dir(p.parent);guard.check();return {'captureSHA':h.H(raw),'record':h.describe(p),'status':'durable-capture-saved'}
        finally:locks.release()
    def load(self,name,digest):
        raw=h.regular(self.cfg.stage/name);h.need(h.H(raw)==h.pin(digest),'CLI_PIN:'+name);x=h.decode(raw);h.need(raw==h.encode(x),'CANONICAL:'+name);return x
    def preflight(self,c):
        locks=self.acquire()
        try:
            self.no_replay();guard=self.guard(c,locks);guard.check();info=candidate(self.cfg,c)
            h.need(h.describe(self.cfg.html)==c['htmlBeforeRecord'],'HTML_FULL_META_BEFORE')
            for p in (self.cfg.html,self.cfg.coord,self.cfg.assets):h.no_symlink(p);h.need(p.stat().st_dev==self.cfg.stage.stat().st_dev,'ATOMIC_SAME_FILESYSTEM')
            h.need(self.cfg.assets.is_dir(),'EXISTING_ASSET_ROOT_ONLY')
            for r in info['assets']:
                target=self.cfg.front/r['url'][1:];h.no_symlink(target);h.need(not target.exists() and not target.is_symlink(),'NOOVERWRITE_NO_BORROW:'+r['url'])
            self.get_roots();self.get_refs(info);guard.check();h.need(candidate(self.cfg,c)==info,'PACKAGE_FINAL_META_CAS')
            return {'schema':'static-production-seal-v2','ownerTask':s.OWNER,'scope':s.SCOPE,'captureSHA':h.H(h.encode(c)),'captureFileRecord':h.describe(self.cfg.stage/'capture.json'),'captureMetadataSHA':c['captureMetadataSHA'],'controllerAggregateSHA':self.src['controllerAggregateSHA'],'sourceFiles':self.src['sourceFiles'],'manifestSHA':info['manifestSHA'],'candidate':info,'sealNonce':uuid.uuid4().hex,'status':'PREFLIGHT_PASSED_INDEPENDENT_REVIEW_REQUIRED'}
        finally:locks.release()
    def approved(self,c,seal,review):
        h.exact(seal,SEAL_KEYS,'SEAL');h.exact(review,REVIEW_KEYS,'INDEPENDENT_REVIEW')
        h.need(seal['schema']=='static-production-seal-v2' and seal['ownerTask']==s.OWNER and seal['scope']==s.SCOPE and seal['status']=='PREFLIGHT_PASSED_INDEPENDENT_REVIEW_REQUIRED','SEAL_SCHEMA_SCOPE')
        h.need(seal['captureSHA']==h.H(h.encode(c)) and seal['captureMetadataSHA']==c['captureMetadataSHA'] and seal['controllerAggregateSHA']==self.src['controllerAggregateSHA'] and seal['sourceFiles']==self.src['sourceFiles'],'SEAL_SOURCE_CAPTURE_BINDING')
        h.need(h.describe(self.cfg.stage/'capture.json')==seal['captureFileRecord'],'CAPTURE_SAVED_FULL_META_PIN')
        h.need(review['schema']=='static-production-review-v2' and review['ownerTask']==s.OWNER and review['scope']==s.SCOPE and review['status']=='APPROVED' and review['releaseApproved'] is True and review['detailScopeFinalized'] is True,'INDEPENDENT_APPROVAL_REQUIRED')
        h.need(isinstance(review['independentReviewer'],str) and review['independentReviewer'] not in ('',s.OWNER) and re.fullmatch('[0-9a-f]{32}',review['reviewNonce']),'INDEPENDENT_REVIEW_ID_NONCE')
        binds={'captureNonce':c['captureNonce'],'captureSHA':h.H(h.encode(c)),'captureMetadataSHA':c['captureMetadataSHA'],'controllerAggregateSHA':self.src['controllerAggregateSHA'],'sourceFiles':self.src['sourceFiles'],'manifestSHA':seal['manifestSHA'],'sealSHA':h.H(h.encode(seal)),'candidateSHA':h.H(h.encode(seal['candidate'])),'runtimePolicySHA':c['state']['policySha256'],'sourceScope':seal['candidate']['sourceScope']}
        h.need(all(review[k]==v for k,v in binds.items()),'INDEPENDENT_FULLHASH_BINDING')
    def apply(self,c,seal,review):
        locks=self.acquire();opened=None;html_after=None;writer=None;terminal_started=False;closed_owned=None;confirmed=False
        try:
            self.no_replay();self.valid_capture(c);self.approved(c,seal,review)
            guard=self.guard(c,locks);guard.check();info=candidate(self.cfg,c);h.need(info==seal['candidate'] and info['manifestSHA']==seal['manifestSHA'],'APPLY_FULL_PACKAGE_PIN')
            # Repeat full public/root/target preflight under uninterrupted apply locks.
            for r in info['assets']:
                q=self.cfg.front/r['url'][1:];h.no_symlink(q);h.need(not q.exists() and not q.is_symlink(),'IMMUTABLE_ALREADY_EXISTS')
            self.get_roots();self.get_refs(info);guard.check()
            self.adapter.include_stage=True;full=self.adapter.snapshot()
            base=copy.deepcopy(full);base['protectedFiles']={k:v for k,v in base['protectedFiles'].items() if not Path(k).is_relative_to(self.cfg.stage)};base['protectedDirectories']={k:v for k,v in base['protectedDirectories'].items() if not Path(k).is_relative_to(self.cfg.stage)}
            h.need(base==c['state'],'STAGE_ACTIVATION_NOT_BASELINE_REFRESH')
            guard=a.Guard(self.adapter,locks,full,self.src,lambda:recent(c));writer=h.Writer(self.cfg,locks,guard,self.hook);guard.check()
            cb=self.valid_capture(c);opening=copy.deepcopy(closed(cb));opening['shared_release_active']=True;opening['needsOperatorRecovery']=False
            opening['window']={'status':'opening','owner_task':s.OWNER,'scope':s.SCOPE,'captureNonce':c['captureNonce'],'reviewSHA':h.H(h.encode(review)),'openedAtUtc':h.now(),'needsOperatorRecovery':False}
            opening_bytes=h.encode(opening)
            def own_open(rec):
                nonlocal opened;opened=(opening_bytes,rec)
            writer.replace(self.cfg.coord,cb,opening_bytes,c['coordRecord'],on_replace=own_open)
            before=h.unb64(c['htmlBeforeBase64']);before_record=c['htmlBeforeRecord']
            writer.exclusive(self.cfg.stage/'before.html',before)
            before_evidence={'bytesSHA':h.H(before),'originalRecord':before_record,'savedRecord':h.describe(self.cfg.stage/'before.html'),'sourceAggregateSHA':self.src['controllerAggregateSHA'],'captureSHA':h.H(h.encode(c))}
            writer.exclusive(self.cfg.stage/'before.json',h.encode(before_evidence));guard.check()
            writer.exclusive(self.cfg.stage/'attempt.json',h.encode({'ownerTask':s.OWNER,'scope':s.SCOPE,'captureNonce':c['captureNonce'],'reviewNonce':review['reviewNonce'],'reviewSHA':h.H(h.encode(review)),'sealSHA':h.H(h.encode(seal)),'manifestSHA':info['manifestSHA'],'beforeEvidenceSHA':h.H(h.encode(before_evidence))}))
            assets={}
            for r in info['assets']:
                path=self.cfg.front/r['url'][1:];assets[str(path)]=writer.publish(path,h.regular(self.cfg.candidate/r['url'][1:]))
                writer.exclusive(self.cfg.stage/('asset-'+r['sha256']+'.json'),h.encode({'path':str(path),'createdRecord':assets[str(path)],'retainOnFailure':True,'foreignNeverDelete':True}))
            guard.check();h.need(candidate(self.cfg,c)==info and h.describe(self.cfg.stage/'before.html')==before_evidence['savedRecord'],'PRECOMMIT_SOURCE_PACKAGE_BEFOREIMAGE_CAS')
            after=h.regular(self.cfg.candidate/'index.html')
            def own_html(rec):
                nonlocal html_after;html_after=(after,rec)
            writer.replace(self.cfg.html,before,after,before_record,preserve=before_record,on_replace=own_html)
            h.need(html_after and all(html_after[1][k]==before_record[k] for k in ('statmode','uid','gid','atimeNs','mtimeNs')),'INSTALLED_PRESERVABLE_METADATA')
            self.get_roots(after);self.get_refs(info,True);guard.check()
            receipt={'schema':'static-production-receipt-v2','ownerTask':s.OWNER,'scope':s.SCOPE,'status':'confirmed','captureSHA':h.H(h.encode(c)),'manifestSHA':info['manifestSHA'],'reviewSHA':h.H(h.encode(review)),'controllerAggregateSHA':self.src['controllerAggregateSHA'],'htmlBeforeRecord':before_record,'htmlInstalledRecord':html_after[1],'retainedImmutableRecords':assets,'protectedStateSHA':h.H(h.encode(guard.expected)),'ownOperationWindows':writer.events,'confirmedAtUtc':h.now()}
            terminal_started=True;terminal_bytes=h.encode(receipt);writer.exclusive(self.cfg.stage/'confirmed.json',terminal_bytes)
            self.hook('terminal-durable');guard.check();h.need(candidate(self.cfg,c)==info,'TERMINAL_PACKAGE_CAS')
            closing=copy.deepcopy(opening);closing['shared_release_active']=False;closing['window'].update(status='closed',closedAtUtc=h.now(),receiptSHA=h.H(terminal_bytes),needsOperatorRecovery=False)
            closing_bytes=h.encode(closing)
            def own_closed(rec):
                nonlocal closed_owned;closed_owned=(closing_bytes,rec)
            writer.replace(self.cfg.coord,opening_bytes,closing_bytes,opened[1],on_replace=own_closed)
            # Durable close is followed by full CAS; foreign late mutation => hold.
            guard.check();confirmed=True;locks.release()
            return {'status':'confirmed','receiptSHA':h.H(terminal_bytes),'closedRecord':closed_owned[1],'postcloseStateSHA':h.H(h.encode(guard.expected)),'controllerAggregateSHA':self.src['controllerAggregateSHA']}
        except BaseException as error:
            if opened is None:
                if writer is None:
                    # Invalid review/TTL/source/foreign state before any write:
                    # no release window was opened, so refuse without claiming restore.
                    locks.release();raise
                # If an opening write renamed without a usable witness, never unlock.
                try:
                    self.valid_capture(c);h.need(h.describe(self.cfg.coord)==c['coordRecord'],'UNWITNESSED_OPENING');self.guard(c,locks).check()
                except BaseException:
                    self.hold_locks=locks;raise h.HoldRequired('PREOPEN_STATE_OR_DURABILITY_UNCERTIFIED:'+type(error).__name__) from error
                locks.release();raise
            # Any terminal fsync/close/postclose error is explicitly failurehold;
            # receipt is not confirmation. Inverse only our exact owned closed coord.
            if terminal_started:
                try:
                    owned=closed_owned or opened
                    hold=copy.deepcopy(opening);hold['needsOperatorRecovery']=True;hold['window'].update(status='failurehold',needsOperatorRecovery=True,errorType=type(error).__name__)
                    writer.replace(self.cfg.coord,owned[0],h.encode(hold),owned[1])
                    writer.exclusive(self.cfg.stage/'failure.json',h.encode({'status':'failurehold','ownerTask':s.OWNER,'scope':s.SCOPE,'errorType':type(error).__name__,'confirmedReceiptInvalid':True,'manualRecoveryRequired':True}))
                except BaseException:pass
                self.hold_locks=locks;raise h.HoldRequired('TERMINAL_OR_CLOSED_FSYNC_FAILURE_MANUAL_RECOVERY:'+type(error).__name__) from error
            try:
                # No blind refresh: retain only existing ledger owned assets, preserve
                # target exact own after inode/full meta. Foreign drift prohibits restore.
                writer.guard.check()
                if html_after:
                    original=c['htmlBeforeRecord'];restored=writer.replace(self.cfg.html,html_after[0],h.unb64(c['htmlBeforeBase64']),html_after[1],preserve=original)
                    h.need(all(restored[k]==original[k] for k in ('statmode','uid','gid','atimeNs','mtimeNs')) and restored['sha256']==original['sha256'],'RESTORE_BYTES_PRESERVABLE_METADATA')
                else:restored=h.describe(self.cfg.html);h.need(restored==c['htmlBeforeRecord'],'PREHTML_ORIGINAL_FULLMETA')
                self.get_roots(h.unb64(c['htmlBeforeBase64']));writer.guard.check()
                retained={k:v for k,v in writer.owned.items() if Path(k).parent==self.cfg.assets}
                receipt={'schema':'static-production-restored-v2','ownerTask':s.OWNER,'scope':s.SCOPE,'status':'restored','captureSHA':h.H(h.encode(c)),'manifestSHA':seal['manifestSHA'],'reviewSHA':h.H(h.encode(review)),'controllerAggregateSHA':self.src['controllerAggregateSHA'],'errorType':type(error).__name__,'htmlRestoredRecord':restored,'retainedOwnImmutable':retained,'protectedStateSHA':h.H(h.encode(writer.guard.expected)),'restoredAtUtc':h.now()}
                raw=h.encode(receipt);writer.exclusive(self.cfg.stage/'restored.json',raw);self.hook('restore-terminal-durable');writer.guard.check()
                close=copy.deepcopy(opening);close['shared_release_active']=False;close['window'].update(status='closed',closedAtUtc=h.now(),receiptSHA=h.H(raw),result='restored',needsOperatorRecovery=False)
                inverse_owned=None
                def own_inverse(rec):
                    nonlocal inverse_owned;inverse_owned=(h.encode(close),rec)
                writer.replace(self.cfg.coord,opened[0],h.encode(close),opened[1],on_replace=own_inverse);writer.guard.check()
                locks.release();return {'status':'restored','receiptSHA':h.H(raw),'closedRecord':inverse_owned[1],'originalFailure':str(error)}
            except BaseException as recovery:
                # Closed inverse cannot count as certified after its fsync failure.
                if 'inverse_owned' in locals() and inverse_owned:
                    try:
                        hold=copy.deepcopy(opening);hold['needsOperatorRecovery']=True;hold['window'].update(status='failurehold',needsOperatorRecovery=True)
                        writer.replace(self.cfg.coord,inverse_owned[0],h.encode(hold),inverse_owned[1])
                    except BaseException:pass
                self.hold_locks=locks;raise h.HoldRequired('ROLLBACK_UNCERTIFIED_LOCKS_RETAINED:'+type(recovery).__name__) from error
        finally:
            if confirmed:self.adapter.include_stage=False
    def verify(self,c,seal,review,receipt_sha,postclose_sha):
        locks=self.acquire()
        try:
            self.valid_capture(c);self.approved(c,seal,review)
            raw=h.regular(self.cfg.stage/'confirmed.json');h.need(h.H(raw)==h.pin(receipt_sha),'RECEIPT_FULLSHA');r=h.decode(raw)
            h.need(r['status']=='confirmed' and r['captureSHA']==h.H(h.encode(c)) and r['manifestSHA']==seal['manifestSHA'] and r['reviewSHA']==h.H(h.encode(review)) and r['controllerAggregateSHA']==self.src['controllerAggregateSHA'],'RECEIPT_BINDING')
            coord=closed(h.regular(self.cfg.coord));w=coord['window'];h.need(w.get('owner_task')==s.OWNER and w.get('scope')==s.SCOPE and w.get('receiptSHA')==receipt_sha,'OWN_CLOSED_RECEIPT_BINDING')
            h.need(h.describe(self.cfg.html)==r['htmlInstalledRecord'],'VERIFY_INSTALLED_FULLMETA')
            for path,record in r['retainedImmutableRecords'].items():h.need(h.describe(Path(path))==record,'VERIFY_ASSET_FULLMETA')
            info=candidate(self.cfg,c);h.need(info==seal['candidate'],'VERIFY_PACKAGE');self.get_roots();self.get_refs(info,True)
            # Required pin comes from complete apply stdout after durable terminal,
            # closing fsync and final full guard. Never infer a fresh baseline.
            self.adapter.include_stage=True;state=self.adapter.snapshot()
            h.need(h.H(h.encode(state))==h.pin(postclose_sha),'VERIFY_POSTCLOSE_FULL_STATE_PIN')
            locks.check();h.need(a.sources()==self.src,'VERIFY_SOURCE_PIN');recent(c)
            h.need(h.H(h.encode(self.adapter.snapshot()))==postclose_sha,'VERIFY_LAST_FULL_CAS')
            return {'status':'verified','receiptSHA':receipt_sha,'stateSHA':postclose_sha}
        finally:locks.release();self.adapter.include_stage=False

def stat_mode(st):return st.st_mode&0o7777

def main():
    ap=argparse.ArgumentParser(description=__doc__);sub=ap.add_subparsers(dest='cmd',required=True);sub.add_parser('bundle')
    for cmd in ('capture','save-capture','preflight','apply','verify'):
        p=sub.add_parser(cmd);p.add_argument('--controller-sha256',required=True)
        if cmd!='capture':p.add_argument('--capture-sha256',required=True)
        if cmd in ('apply','verify'):
            p.add_argument('--manifest-sha256',required=True);p.add_argument('--seal-sha256',required=True);p.add_argument('--review-sha256',required=True)
        if cmd=='verify':
            p.add_argument('--receipt-sha256',required=True);p.add_argument('--postclose-state-sha256',required=True)
    args=ap.parse_args()
    if args.cmd=='bundle':out=dict(a.sources(),ownerTask=s.OWNER,scope=s.SCOPE,runtimePolicyStatus=h.decode(h.regular(a.HERE/'runtime-policy.json'))['status'])
    else:
        h.need(a.sources()['controllerAggregateSHA']==h.pin(args.controller_sha256),'CLI_CONTROLLER_AGGREGATE_PIN');ctrl=Controller()
        try:
            if args.cmd=='capture':out=ctrl.capture()
            elif args.cmd=='save-capture':
                raw=sys.stdin.buffer.read();h.need(h.H(raw)==h.pin(args.capture_sha256),'STDIN_CAPTURE_FULLSHA');out=ctrl.save_capture(raw)
            else:
                c=ctrl.load('capture.json',args.capture_sha256)
                if args.cmd=='preflight':out=ctrl.preflight(c)
                else:
                    seal=ctrl.load('seal.json',args.seal_sha256);review=ctrl.load('review.json',args.review_sha256)
                    h.need(seal['manifestSHA']==h.pin(args.manifest_sha256),'CLI_FINALMANIFEST_PIN')
                    out=ctrl.apply(c,seal,review) if args.cmd=='apply' else ctrl.verify(c,seal,review,args.receipt_sha256,args.postclose_state_sha256)
        except h.HoldRequired as e:
            h.need(ctrl.hold_locks is not None,'HOLD_DESCRIPTORS_REQUIRED');print(str(e),file=sys.stderr,flush=True);ctrl.hold_locks.hold(str(e));raise
    sys.stdout.buffer.write(h.encode(out));sys.stdout.buffer.flush()
if __name__=='__main__':
    try:main()
    except BaseException as e:
        print('STATIC_PRODUCTION_STOPPED '+(str(e) if isinstance(e,h.ReleaseError) else type(e).__name__),file=sys.stderr);sys.exit(1)
