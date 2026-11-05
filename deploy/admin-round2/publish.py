#!/usr/bin/env python3
"""Offline plan/verify by default. Server-local mutation requires explicit parent authorization.
No SSH/copy transport, install, worker reload, front UI, env file, business DML or old-API rollback.
"""
import argparse
import contextlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import stat
import subprocess
import tempfile
import urllib.request

VERSION='20261105-admin-compact-priority-v2'
PACKAGE=Path('/opt/ops')/VERSION
RELEASE=Path('/opt/releases')/VERSION
OLD=Path('/opt/releases/20261104-channel-inventory-ci-management-v1')
PUBLIC=Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
MAIN_PUBLIC=Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public')
HTML=PUBLIC/'index.html'
LOCK=Path('/var/lock/dianzi51-public-deploy.lock')
COORD=Path('/opt/ops/51-project-release-coordination-20261027.json')
TARGETS={'front':('dianzi51',[190,193,194,200]),'admin':('dianzi51-admin',[191,192])}
BASELINE={'index.html':'331750172d2921992a57470bb2361bd3ce1334aa279f4a3d4414b9529b766965','public-baseline.json':'7e0206e39174fbcd1125b31b562dc626b1e388291a2388409aaf62f04c12759b','processes.json':'cc8d5a894ac651fba0060de1e07c24130a7f97185969e02dbf2cb998c9db5a63','front-live-index.js':'122b60ca94947042765327623db3430c2a8411c72b2b272a937b2d434e15e1af','admin-live-index.js':'73013efffa4f3cd840c9f49f45f72d04bf47ca733348d2c498b8d6b5aa77e8b7'}
OLD_ENTRY='<script type="module" crossorigin src="/assets/20261105-admin-navigation-priority-v1-9aca212e491a/index-Bpi0HiVr.js"></script>'
OLD_STYLE='<link rel="stylesheet" crossorigin href="/assets/20261105-admin-navigation-priority-v1-9aca212e491a/index-srXaB4c0.css">'
class Stop(Exception): pass
def require(ok,label):
    if not ok: raise Stop(label)
def digest(b): return hashlib.sha256(b).hexdigest()
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
def encode(v): return (json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode()
def now(): return datetime.now(timezone.utc).isoformat()
def compact(v): return json.dumps(v,ensure_ascii=False,separators=(',',':'))
def safe_relative(n):
    require(isinstance(n,str) and re.fullmatch(r'[A-Za-z0-9_./-]+',n),'invalid artifact path')
    require(not PurePosixPath(n).is_absolute() and all(p not in ('','.','..') for p in n.split('/')),'path escape')
    return n
def safe_source_relative(n):
    require(isinstance(n,str) and re.fullmatch(r'[A-Za-z0-9_./@-]+',n),'invalid source path')
    require(not PurePosixPath(n).is_absolute() and all(p not in ('','.','..') for p in n.split('/')),'source path escape')
    return n
def regular(root,n):
    root=Path(root);require(not root.is_symlink(),'root symlink forbidden');p=root
    for part in safe_relative(n).split('/'):
        p=p/part;require(not p.is_symlink(),'artifact ancestor symlink forbidden')
    require(p.is_file() and p.resolve().is_relative_to(root.resolve()),'artifact missing/outside package');return p
def atomic(p,b,mode=None):
    p=Path(p);require(not p.is_symlink(),'atomic symlink forbidden');old=p.stat() if p.exists() else None
    require(old is not None or mode is not None,'new atomic mode required')
    fd,tmp=tempfile.mkstemp(prefix='.admin-round2-',dir=p.parent)
    try:
        os.fchmod(fd,mode if mode is not None else stat.S_IMODE(old.st_mode))
        if old and os.geteuid()==0: os.fchown(fd,old.st_uid,old.st_gid)
        with os.fdopen(fd,'wb') as f: f.write(b);f.flush();os.fsync(f.fileno())
        os.replace(tmp,p);d=os.open(p.parent,os.O_RDONLY)
        try: os.fsync(d)
        finally: os.close(d)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
def save(p,v): atomic(p,encode(v),0o600)
def validate_html(candidate,edits,namespace):
    require(len(edits)==3 and [e['reason'] for e in edits]==['main-module','styles','preloads'],'exact three graph ranges required')
    require(edits[0]['before']==OLD_ENTRY and edits[1]['before']==OLD_STYLE and edits[2]['before']=='','old graph whitelist')
    ns=re.escape(namespace)
    require(re.fullmatch(r'<script type="module" crossorigin src="/assets/'+ns+r'/[A-Za-z0-9_.-]+\.js"></script>',edits[0]['after']),'entry whitelist')
    for e,rel in [(edits[1],'stylesheet'),(edits[2],'modulepreload')]:
        text=e['after']
        if rel=='modulepreload' and text: require(text.endswith('\n    '),'preload insertion separator');text=text[:-5]
        if not text: require(rel=='modulepreload','styles required');continue
        for tag in text.split('\n    '): require(re.fullmatch(r'<link rel="'+rel+r'" crossorigin href="/assets/'+ns+r'/[A-Za-z0-9_.-]+\.(?:css|js)">',tag),'graph tag whitelist')
    restored=candidate.decode().encode('utf-16-le')
    for e in reversed(edits):
        require(digest(e['before'].encode())==e['beforeSha256'] and digest(e['after'].encode())==e['afterSha256'],'edit hash mismatch')
        start=e['start']*2;after=e['after'].encode('utf-16-le');before=e['before'].encode('utf-16-le')
        require(restored[start:start+len(after)]==after,'inverse range drift');restored=restored[:start]+before+restored[start+len(after):]
    require(digest(restored.decode('utf-16-le').encode())==BASELINE['index.html'],'non-graph HTML changed')
    text=candidate.decode();require('type="importmap"' not in text and len(re.findall(r'<script\b[^>]*type="module"[^>]*src=',text))==1,'unexpected importmap/entry')
    return restored.decode('utf-16-le').encode()
def validate_package(package):
    package=Path(package);mb=regular(package,'manifest.json').read_bytes();m=json.loads(mb)
    require(m.get('schemaVersion')==2 and m.get('release')==VERSION and m.get('kind')=='combined-api-manager-static','release/schema/kind mismatch')
    require(m.get('baseline')==BASELINE,'baseline mismatch');require(re.fullmatch('[a-f0-9]{64}',m.get('sourceSha256','')),'source SHA absent')
    require(m.get('namespace')==VERSION+'-'+m['sourceSha256'][:12],'namespace not bound to full source SHA')
    g=m.get('guard',{})
    for k in ['actualChecksPassed','sourceStable','isolatedNoEnvFiles','networkBlockedInTests','oldHtmlOtherBytesPreserved','oldAssetsNeverDeleted']: require(g.get(k) is True,'unproven build guard: '+k)
    for k in ['productionDeploymentPerformed','productionBrowserVerified','databaseTestsPassed']: require(g.get(k) is False,'offline evidence must not claim production/DB QA: '+k)
    entries=m.get('assets',[])+m.get('apis',[])+m.get('ddl',[])+m.get('toolArtifacts',[])+m.get('evidence',[])+[m['html']]
    require(len({a['path'] for a in entries})==len(entries),'duplicate artifacts')
    for a in entries:
        p=regular(package,a['path']);require(re.fullmatch('[a-f0-9]{64}',a.get('sha256','')) and sha(p)==a['sha256'] and p.stat().st_size==a['bytes'],'artifact/evidence hash mismatch')
    require({a['path'] for a in m['apis']}=={'front/dist/index.js','admin/dist/index.js'},'exact two API artifacts')
    require({a['path'] for a in m['ddl']}=={'admin/scripts/apply-admin-staff-archives.mjs','admin/scripts/20261105-admin-staff-archives.sql'},'sidecar-only DDL artifacts')
    require(len(m['assets'])>=2 and all(a['path'].startswith('assets/'+m['namespace']+'/') and not a['path'].endswith(('.map','.html')) for a in m['assets']),'asset namespace mismatch')
    for a in m.get('rootAssetsMustRemainUnchanged',[]): require(safe_relative(a['path']) and not a['path'].startswith('assets/') and a['path']!='index.html','root asset whitelist')
    require(m['html']['path']=='candidate-index.html','HTML artifact whitelist')
    fb=regular(package,'evidence/freeze.json').read_bytes();f=json.loads(fb);require(digest(fb)==m['sourceFreezeSha256'],'freeze not bound')
    require(f['release']==VERSION and f['schemaVersion']==2 and f['baseline']==BASELINE and f['sourceSha256']==m['sourceSha256'],'freeze identity mismatch')
    require(set(f['sources'])=={'admin','front'},'both frozen sources required')
    trees={}
    for side,v in f['sources'].items():
        require(re.fullmatch('[a-f0-9]{40}',v['commit']),'full source commit required')
        require(digest(compact(v['files']).encode())==v['treeSha256'],'frozen file list digest mismatch')
        require(m['sources'][side]=={'commit':v['commit'],'treeSha256':v['treeSha256']},'source manifest mismatch');trees[side]=v['treeSha256']
        for item in v['files']:safe_source_relative(item['path']);require(not re.search(r'(^|/)\.env(?:\.|$)|\.(pem|key|p12)$',item['path']),'secret source filename')
    require(digest(compact(trees).encode())==m['sourceSha256'],'combined source digest mismatch')
    expected_tools={'tools/'+a['path']:a['sha256'] for a in f['toolFiles']}
    require({a['path']:a['sha256'] for a in m['toolArtifacts']}==expected_tools,'tools not frozen')
    for a in m['ddl']:
        rel=a['path'].removeprefix('admin/');require(any(x['path']==rel and x['sha256']==a['sha256'] for x in f['sources']['admin']['files']),'DDL not from frozen source')
    checks=json.loads(regular(package,'evidence/checks.json').read_bytes());require(checks==m['checks'] and len(checks)==7,'seven actual command checks required')
    require(sorted((c['side'],c['kind']) for c in checks)==sorted([('admin','tsc'),('front','tsc'),('admin','vitest'),('front','vitest'),('admin','vite'),('front','esbuild'),('admin','esbuild')]),'actual command coverage mismatch')
    for c in checks:
        require(c['exitCode']==0 and c['envFilesLoaded'] is False and sha(regular(package,'evidence/'+c['log']))==c['logSha256'],'command/log evidence failed')
        cmd=c['command'];require(cmd and ('tsc' in cmd[1] and '--noEmit' in cmd if c['kind']=='tsc' else 'vitest' in cmd[1] and 'run' in cmd if c['kind']=='vitest' else cmd[1].endswith('vite-worker.mjs') if c['kind']=='vite' else cmd[1].endswith('build-service.mjs')),'actual executable contract mismatch')
    for side in ('admin','front'):
        suite=json.loads(regular(package,f'evidence/{side}-regression-suite.json').read_bytes());require(len(suite['selected'])>0,'empty test suite')
        require(all(x['status']=='skipped' and x['reason'] for x in suite['dbSkipped']),'DB skip evidence unclear')
    candidate=regular(package,'candidate-index.html').read_bytes();old=validate_html(candidate,json.loads(regular(package,'evidence/html-edits.json').read_bytes()),m['namespace'])
    urls=re.findall(r'<(?:script|link)\b[^>]*(?:src|href)="(/assets/[^"]+)"',candidate.decode());require(set(u[1:] for u in urls).issubset({a['path'] for a in m['assets']}),'HTML graph missing asset')
    require(m['publicBaseline'].get('index.html')==BASELINE['index.html'],'public baseline identity')
    pb=regular(package,'evidence/public-baseline.json').read_bytes();require(digest(pb)==BASELINE['public-baseline.json'] and json.loads(pb)==m['publicBaseline'],'public baseline bytes not frozen')
    require(sha(regular(package,'evidence/processes-baseline.json'))==BASELINE['processes.json'],'process baseline bytes not frozen')
    return m,mb,candidate,old

def helper(package,name,args):
    env={k:os.environ[k] for k in ('PATH','LANG','LC_ALL') if k in os.environ};env['HOME']='/root'
    p=subprocess.run(['node',str(regular(package,'tools/'+name)),*args],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300,check=False)
    require(p.returncode==0,'helper stopped: '+name+'; sensitive output suppressed')
    try:return json.loads(p.stdout)
    except Exception:raise Stop('helper receipt invalid: '+name) from None
def processes(package):return helper(package,'reload-target.mjs',['--snapshot'])
def persistence(package):return helper(package,'persist-targets.mjs',['--snapshot'])
def fingerprint(p,namespace=None):
    p=Path(p);require(not re.search(r'(^|/)\.env(?:\.|$)|\.(pem|key|p12)$',str(p)),'secret runtime resource forbidden')
    s=p.lstat();resolved=p.resolve(strict=True);row={'realpath':str(resolved),'link':os.readlink(p) if p.is_symlink() else None,'mode':s.st_mode,'uid':s.st_uid,'gid':s.st_gid,'ino':s.st_ino,'dev':s.st_dev}
    require(not re.search(r'(^|/)\.env(?:\.|$)|\.(pem|key|p12)$',str(resolved)),'secret runtime symlink target forbidden')
    mutable_static=namespace is not None and resolved==PUBLIC.resolve(strict=True)
    if not mutable_static:row.update({'size':s.st_size,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns})
    if p.is_file():row['sha256']=sha(p)
    elif p.is_dir() and p.name=='node_modules':row['dependencyManifests']={n:sha(p/n/'package.json') for n in ('mysql2','esbuild','express') if (p/n/'package.json').is_file()}
    elif p.is_dir():
        row['children']={str(x.relative_to(p)):fingerprint(x) for x in sorted(p.rglob('*')) if (x.is_file() or x.is_symlink()) and not (mutable_static and (str(x.relative_to(p))=='index.html' or x.relative_to(p).parts[:2]==('assets',namespace)))}
    else:raise Stop('unsupported runtime resource')
    return row
def assets_inventory(namespace=None):
    rows=[]
    for p in sorted((PUBLIC/'assets').rglob('*')):
        rel=p.relative_to(PUBLIC/'assets')
        if namespace and rel.parts[0]==namespace:continue
        if not p.is_file() and not p.is_symlink():continue
        s=p.lstat();rows.append([str(rel),s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid,s.st_gid,s.st_ino,os.readlink(p) if p.is_symlink() else None,None if p.is_symlink() else sha(p)])
    return rows
def runtime_links():
    result={}
    for side in ('front','admin'):
        old=OLD/side
        for n in ('node_modules','package.json'):result[f'{side}/{n}']=old/n
        result[f'{side}/dist/public']=[MAIN_PUBLIC,PUBLIC][side=='admin']
        if (old/'public').exists() or (old/'public').is_symlink():result[f'{side}/public']=old/'public'
        for p in sorted((old/'dist').iterdir()):
            if p.name not in ('index.js','public'):
                safe_relative(p.name);require(not re.search(r'(^|/)\.env(?:\.|$)|\.(pem|key|p12)$',p.name),'secret runtime companion forbidden');result[f'{side}/dist/{p.name}']=p
    return result
def baseline_check(package,m,ps):
    require(not HTML.is_symlink() and sha(HTML)==BASELINE['index.html'],'admin HTML baseline drift')
    for n,h in m['publicBaseline'].items():require(sha(PUBLIC/safe_relative(n))==h,'static baseline drift')
    frozen=json.loads(regular(package,'evidence/freeze.json').read_bytes())
    # Captured processes.json is SHA-bound; production read is a fresh metadata-only snapshot.
    baseline=json.loads(regular(package,'evidence/processes-baseline.json').read_bytes())
    require(sha(regular(package,'evidence/processes-baseline.json'))==BASELINE['processes.json'],'process baseline not bound')
    require(len(ps)==len(baseline),'process count drift')
    for b in baseline:
        p=next((x for x in ps if x['id']==b['id']),None);require(p is not None,'process ID absent')
        for k in ('id','name','pid','script','sha256','cwd','status','restarts'):require(p[k]==b[k],'fresh process baseline drift: '+k)
        require(b['envHash'] in p['legacyEnvHashes'],'legacy initial envHash drift')
    for side,(_,ids) in TARGETS.items():require([p['id'] for p in ps if p['name']==TARGETS[side][0]]==ids,'target instance IDs mismatch')
    for a in m['rootAssetsMustRemainUnchanged']:require(sha(PUBLIC/a['path'])==a['sha256'],'root public resource drift')
def approval(package,mhash,m):
    p=regular(package,'qa-approval.json');q=json.loads(p.read_bytes());require(q.get('manifestSha256')==mhash,'QA not manifest-bound')
    for k in ('frozenSourceReviewed','isolatedAuthorizedUiQaPassed','serverApiCompatibilityPassed','ddlReviewApproved'):require(q.get(k) is True,'parent approval pending: '+k)
    require(q.get('uiEvidenceScope')=='authorized-react-fixture' and q.get('productionBrowserVerified') is not True,'fixture QA must not be labelled production browser')
    require(q.get('ddlArtifactHashes')=={a['path']:a['sha256'] for a in m['ddl']},'DDL approval not artifact-bound');return sha(p)
def immutable(src,dest,expected):
    dest=Path(dest);p=dest.parent
    while p!=p.parent:require(not p.is_symlink(),'immutable ancestor symlink');p=p.parent
    dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists() or dest.is_symlink():require(dest.is_file() and not dest.is_symlink() and sha(dest)==expected,'immutable conflict');return
    fd,tmp=tempfile.mkstemp(prefix='.admin-round2-',dir=dest.parent)
    try:
        with os.fdopen(fd,'wb') as f:f.write(Path(src).read_bytes());f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),0o644)
        require(sha(tmp)==expected,'immutable copy hash');os.link(tmp,dest)
        d=os.open(dest.parent,os.O_RDONLY)
        try:os.fsync(d)
        finally:os.close(d)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def protected_files(ps):
    paths={p['script'] for p in ps}|{str(MAIN_PUBLIC/'index.html'),'/etc/nginx/conf.d/dianzi51-admin-subdomain.conf','/etc/nginx/conf.d/dianzi51-https.conf'}
    return {p:sha(p) for p in sorted(paths)}
def guard(package,m,state,allow_helper=False):
    validate_package(package);require(sha(package/'manifest.json')==state['manifestSha256'],'manifest drift');require(sha(package/'qa-approval.json')==state['qaApprovalSha256'],'approval drift')
    require(protected_files(state['beforeProcesses'])==state['protectedFiles'],'old API/worker/main HTML/nginx drift')
    require(assets_inventory(m['namespace'])==state['oldAssets'],'old assets bytes/metadata drift')
    for a in m['rootAssetsMustRemainUnchanged']:require(sha(PUBLIC/a['path'])==a['sha256'],'root resource drift')
    for rel,info in state['links'].items():
        dest=RELEASE/rel;source=Path(info['source']);require(dest.is_symlink() and os.readlink(dest)==info['source'] and dest.resolve()==source.resolve(),'runtime link drift');require(fingerprint(source,m['namespace'])==info['fingerprint'],'runtime companion/package/source drift')
    for a in m['apis']+m['ddl']:require(sha(regular(RELEASE,a['path']))==a['sha256'],'staged API/DDL drift')
    ps=processes(package)
    require(ps==state['lastProcesses'],'process pid/restarts/source/env/config drift between phases')
    require(persistence(package)==state['lastPersistence'],'startup/dump drift between phases')
    require(sha(HTML)==state['htmlSha256'],'admin HTML drift');return ps
def verify_http(url,h=None,nonce=None):
    nonce=nonce or secrets.token_hex(16);require(re.fullmatch('[a-f0-9]{32}',nonce),'HTTP nonce invalid')
    require('#' not in url,'HTTP fragment forbidden');url+=('&' if '?' in url else '?')+'_round2='+nonce
    request=urllib.request.Request(url,headers={'Cache-Control':'no-cache','Pragma':'no-cache','Accept-Encoding':'identity'})
    with urllib.request.urlopen(request,timeout=30) as r:
        require(r.status==200,'read-only readiness failed');b=r.read();require(h is None or digest(b)==h,'HTTP content hash failed')
def verify_assets_http(m,origins,local=False):
    if local:
        for a in m['assets']:require(sha(regular(PUBLIC,a['path']))==a['sha256'],'staged asset hash')
    nonce=secrets.token_hex(16)
    jobs=[(origin+'/'+a['path'],a['sha256']) for origin in origins for a in m['assets']]
    # Hard upper bound across all origins. Every object is fetched and byte-hashed; no sampling.
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures=[pool.submit(verify_http,url,h,nonce) for url,h in jobs]
        for future in futures:future.result()
def health():
    for u in ('http://127.0.0.1:3000/','http://127.0.0.1:3001/login'):verify_http(u)
def phase_for(operation,side=None):return {'migrate':('prepared','schema_ready'),'activate':('schema_ready' if side=='front' else 'front_active',side+'_active' if side else None),'static':('admin_active','static_active'),'rollback-html':('static_active','html_rolled_back')}[operation]
def mutate(args,package,m,mb,candidate,old):
    require(args.authorize_production,'explicit --authorize-production required; this task must NOT execute production')
    require(m.get('syntheticFixture') is not True,'synthetic fixture can never be activated')
    require(package.absolute()==PACKAGE and not package.is_symlink(),'exact staged /opt/ops release package required')
    require(Path(__file__).resolve()==regular(package,'tools/publish.py').resolve(),'use frozen packaged publisher')
    require(not LOCK.is_symlink() and not COORD.is_symlink(),'lock/coord symlink forbidden')
    with open(LOCK,'a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Stop('shared deployment lock busy') from None
        coord=json.loads(COORD.read_bytes());state_path=package/'state.json'
        if args.prepare:
            require(not state_path.exists() and not RELEASE.exists() and not RELEASE.is_symlink(),'prepared/partial release exists; inspect, never blindly replay')
            require(not coord.get('shared_release_active'),'another shared release active/interrupted')
            qa=approval(package,digest(mb),m);ps=processes(package);baseline_check(package,m,ps);persist=persistence(package)
            require(persist['bootAuthority']['kind']=='pm2-resurrect' and persist['bootAuthority']['dumpPath']=='/root/.pm2/dump.pm2','root resurrect boot authority required')
            require(persist['ecosystem']['configs']==[],'ecosystem must remain opaque protected fingerprints')
            for side,(_,ids) in TARGETS.items():
                require(persist['dump']['scripts'].get(side)==[str(OLD/side/'dist/index.js')]*len(ids),'dump baseline script drift')
            links={rel:{'source':str(src),'fingerprint':fingerprint(src,m['namespace'])} for rel,src in runtime_links().items()}
            state={'phase':'preparing','manifestSha256':digest(mb),'qaApprovalSha256':qa,'beforeProcesses':ps,'lastProcesses':ps,'beforePersistence':persist,'lastPersistence':persist,'protectedFiles':protected_files(ps),'oldAssets':assets_inventory(),'htmlSha256':sha(HTML),'links':links,'at':now()}
            save(state_path,state);atomic(package/'before-index.html',old,0o600);coord['shared_release_active']=True;coord['admin_round2_owner']=VERSION;atomic(COORD,encode(coord))
            try:
                for a in m['apis']+m['ddl']:immutable(regular(package,a['path']),RELEASE/a['path'],a['sha256'])
                for rel,info in links.items():
                    dest=RELEASE/rel;dest.parent.mkdir(parents=True,exist_ok=True);require(not dest.exists() and not dest.is_symlink(),'runtime link conflict');dest.symlink_to(info['source'],target_is_directory=Path(info['source']).is_dir())
                for a in m['assets']:immutable(regular(package,a['path']),PUBLIC/a['path'],a['sha256'])
                guard(package,m,state);health();state['phase']='prepared';save(state_path,state)
            except Exception:state['phase']='stopped';state['partialApisRetained']=True;save(state_path,state);raise
            print(json.dumps({'phase':'prepared','noApiReloadYet':True,'noSchemaExecutionYet':True}));return
        require(state_path.is_file(),'prepare required');state=json.loads(state_path.read_bytes())
        require(coord.get('admin_round2_owner')==VERSION,'coord owner mismatch')
        op='migrate' if args.migrate else 'activate' if args.activate else 'static' if args.static else 'rollback-html'
        expected,completed=phase_for(op,args.target)
        if state['phase']==completed:guard(package,m,state);print(json.dumps({'alreadyComplete':True,'phase':completed,'replayed':False}));return
        require(state['phase']==expected,'wrong/partial phase: inspect state, never blindly replay');guard(package,m,state)
        if args.rollback_html:
            require(not coord.get('shared_release_active'),'another release active');coord['shared_release_active']=True;atomic(COORD,encode(coord))
        else:require(coord.get('shared_release_active') is True,'shared coordination phase not active')
        try:
            if args.migrate:
                state['phase']='migrating';save(state_path,state);receipt=helper(package,'migrate-sidecar.mjs',['--apply','--authorize-production']);save(package/'schema-receipt.json',receipt)
                require(processes(package)==state['lastProcesses'] and persistence(package)==state['lastPersistence'],'schema phase changed runtime')
            elif args.activate:
                side=args.target;state['phase']='activating_'+side;save(state_path,state)
                persist=helper(package,'persist-targets.mjs',['--apply','--authorize-production','--side',side,'--boot-check'])
                require(persist==state['lastPersistence'],'boot check must not modify config/dump');save(state_path,state)
                result=helper(package,'reload-target.mjs',['--apply','--authorize-production','--release',str(RELEASE),'--side',side,'--state',str(state_path)])
                require(result.get('side')==side and result.get('targetedSequentialReload') is True and result.get('environmentRetained') is True,'target reload receipt invalid')
                state['lastProcesses']=result['processes'];save(state_path,state)
                state['lastPersistence']=helper(package,'persist-targets.mjs',['--apply','--authorize-production','--side',side,'--save']);save(state_path,state)
                save(package/(side+'-reload-receipt.json'),{'processes':state['lastProcesses'],'persistence':state['lastPersistence'],'at':now(),'newApiRetainedOnFailure':True})
                health()
            elif args.static:
                verify_assets_http(m,('http://127.0.0.1:3001',),local=True)
                guard(package,m,state);atomic(HTML,candidate);state['htmlSha256']=m['html']['sha256'];save(state_path,state);health()
                for origin in ('http://127.0.0.1:3001','https://admin.51dianzi.com'):
                    verify_http(origin+'/login',m['html']['sha256'])
                verify_assets_http(m,('http://127.0.0.1:3001','https://admin.51dianzi.com'))
            else:
                require(sha(HTML)==m['html']['sha256'],'only this round HTML may roll back');require(sha(package/'before-index.html')==BASELINE['index.html'],'HTML backup mismatch');atomic(HTML,old);state['htmlSha256']=BASELINE['index.html']
            guard(package,m,state);state['phase']=completed;save(state_path,state)
            if completed in ('static_active','html_rolled_back'):
                coord['shared_release_active']=False;coord['admin_round2_status']=completed;atomic(COORD,encode(coord))
            print(json.dumps({'phase':completed,'oldApisNeverRestored':True,'businessDataWrites':False,'schemaOnlyPhase':args.migrate,'productionBrowserVerified':False}))
        except Exception:
            # Restore ONLY our HTML if we actually switched it. Never restore tombstone-blind API.
            reverted=False
            if sha(HTML)==m['html']['sha256']:
                require(digest(old)==BASELINE['index.html'],'backup invalid');atomic(HTML,old);reverted=True
            state.update({'phase':'stopped','htmlRolledBack':reverted,'htmlSha256':sha(HTML),'newApisRetained':True,'manualInspectionRequired':True,'at':now()})
            try:state['observedProcesses']=processes(package);state['observedPersistence']=persistence(package)
            except Exception:state['runtimeInspectionUnavailable']=True
            save(state_path,state);coord['admin_round2_status']='stopped-partial; preserve new APIs and sidecar';atomic(COORD,encode(coord));raise

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,default=PACKAGE);p.add_argument('--authorize-production',action='store_true');p.add_argument('--target',choices=('front','admin'))
    g=p.add_mutually_exclusive_group();g.add_argument('--plan',action='store_true');g.add_argument('--verify-local',action='store_true');g.add_argument('--prepare',action='store_true');g.add_argument('--migrate',action='store_true');g.add_argument('--activate',action='store_true');g.add_argument('--static',action='store_true');g.add_argument('--rollback-html',action='store_true');a=p.parse_args()
    if a.activate:require(a.target is not None,'--activate requires --target front|admin')
    else:require(a.target is None,'--target only valid with --activate')
    m,mb,candidate,old=validate_package(a.package)
    if not any((a.prepare,a.migrate,a.activate,a.static,a.rollback_html)):
        print(json.dumps({'offlineOnly':True,'planOnly':not a.verify_local,'syntheticFixture':m.get('syntheticFixture') is True,'evidenceScope':'synthetic-tool-safety-fixture' if m.get('syntheticFixture') else 'actual-offline-frozen-build','manifestSha256':digest(mb),'sourceSha256':m['sourceSha256'],'apiArtifacts':[x['path'] for x in m['apis']],'steps':['prepare (immutable staging + opaque config fingerprints + root resurrect boot check)','migrate (explicit parent-reviewed sidecar CREATE only)','activate --target front (boot-check no writes, 4 sequential exact IDs, fresh pm2 save; admin paths stay old)','activate --target admin (boot-check no writes, 2 sequential exact IDs, fresh pm2 save)','static (all assets nonce/hash verified with concurrency <=8; sole admin HTML switch)'],'productionAccessPerformed':False,'productionBrowserVerified':False}));return
    mutate(a,a.package,m,mb,candidate,old)
if __name__=='__main__':
    try:main()
    except Stop as e:print('STOP: '+str(e));raise SystemExit(1)
    except Exception:print('STOP: operation failed; sensitive details suppressed. Inspect partial state. Never replay or roll back old APIs.');raise SystemExit(1)
