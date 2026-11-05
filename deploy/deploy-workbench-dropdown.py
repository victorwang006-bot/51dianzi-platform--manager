#!/usr/bin/env python3
"""Static-only navigation release. No DB, restart, reload, install or deletion."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import urllib.request
from datetime import datetime, timezone
PUBLIC = Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
HTML = PUBLIC / 'index.html'
RELEASE = Path('/opt/ops/20261105-workbench-dropdown-nav-v1')
LOCK = Path('/var/lock/dianzi51-public-deploy.lock')
COORD = Path('/opt/ops/51-project-release-coordination-20261027.json')
TASK = 'OAfXZkj03WiC7JtMQKhqm5'
EXPECTED_HTML = 'f0db887956a41a3c1cb2457a4d65fb9b1156a2592bc923696bf7640f8dad764a'
class Stop(Exception): pass
def require(ok, label):
    if not ok: raise Stop(label)
def sha(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def encode(x):return (json.dumps(x,ensure_ascii=False,indent=2)+'\n').encode()
def atomic(path, data, mode=None):
    old=path.stat() if path.exists() else None
    fd,tmp=tempfile.mkstemp(prefix='.nav-dropdown-',dir=path.parent)
    try:
        os.fchmod(fd,mode if mode is not None else stat.S_IMODE(old.st_mode))
        if old:os.fchown(fd,old.st_uid,old.st_gid)
        with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(tmp,path)
        d=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(d)
        finally:os.close(d)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def private_record(name,value):atomic(RELEASE/name,encode(value),0o600)
def processes():
    p=subprocess.run(['/usr/bin/node-22','/usr/local/lib/node_modules/pm2/bin/pm2','jlist'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False,timeout=25)
    require(p.returncode==0,'PM2 read failed')
    rows=[]
    for x in json.loads(p.stdout):
        e=x['pm2_env'];env={**e.get('env',{})}
        rows.append({'id':x['pm_id'],'name':x['name'],'pid':x['pid'],'script':e.get('pm_exec_path'),'cwd':e.get('pm_cwd'),'status':e.get('status'),'restarts':e.get('restart_time'),'mode':e.get('exec_mode'),'envHash':hashlib.sha256(json.dumps(env,sort_keys=True,default=str).encode()).hexdigest()})
    return sorted(rows,key=lambda r:r['id'])
def inventory_tree():
    rows=[]
    for p in sorted((PUBLIC/'assets').rglob('*')):
        if not p.is_file() and not p.is_symlink():continue
        s=p.lstat();rows.append([str(p.relative_to(PUBLIC/'assets')),s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid,s.st_gid,s.st_ino,os.readlink(p) if p.is_symlink() else None])
    return rows
def protected_snapshot():
    ps=processes();paths=set()
    for p in ps:
        require(p['script'] and Path(p['script']).is_file(),'running process script missing')
        paths.add(p['script'])
        if p['name'] in ['dianzi51','dianzi51-admin']:
            served=(Path(p['script']).parent/'public/index.html').resolve(strict=True)
            require(served.is_file(),'actual running application public HTML missing')
            paths.add(str(served))
    paths.update([
        '/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html',
        '/etc/nginx/conf.d/dianzi51-admin-subdomain.conf',
        '/etc/nginx/conf.d/dianzi51-https.conf',
        '/opt/config/dianzi51/ecosystem.config.cjs',
        '/root/.pm2/dump.pm2',
    ])
    paths.discard(str(HTML.resolve()))
    for filename in paths:require(Path(filename).is_file(),'required protection file missing')
    return {'processes':ps,'protectedFiles':{p:sha(p) for p in sorted(paths)}}
def guard(before,names):
    require(sha(RELEASE/'manifest.json')==before['manifestSha256'],'frozen manifest changed; STOP')
    require(protected_snapshot()==before['protected'],'backend/process/config/front drift; STOP')
    current=inventory_tree();existing=[x for x in current if x[0] not in names]
    require(existing==before['assetTree'],'existing static assets changed; STOP')
def health():
    result=[]
    for url in ['http://127.0.0.1:3001/login','http://127.0.0.1:3000/']:
        with urllib.request.urlopen(url,timeout=20) as r:
            require(r.status==200,'HTTP health failed');r.read();result.append({'url':url,'status':r.status})
    return result
def verify_asset(origin,name,digest):
    with urllib.request.urlopen(origin+'/assets/'+name,timeout=45) as r:
        b=r.read();require(r.status==200 and hashlib.sha256(b).hexdigest()==digest,'asset HTTP/hash verification failed')
def manifest():
    frozen_manifest=(RELEASE/'manifest.json').read_bytes()
    m=json.loads(frozen_manifest);require(m['schemaVersion']==1 and m['release']=='20261105-workbench-dropdown-nav-v1','wrong release')
    require(m['baseline']['index.html']==EXPECTED_HTML,'wrong baseline')
    for flag in ['previousChannelInventoryOverlayPreserved','importsExportsUnchanged','allOtherChunkBytesPreserved','allOtherHtmlBytesPreserved','oldCssBytesPreserved','noRuntimeOrServerDependencies']:require(m.get(flag) is True,'missing build guard '+flag)
    for kind in ['js','css','html']:
        item=m['outputs'][kind];name=item['name'];require(re.fullmatch(r'[A-Za-z0-9_.-]+',name) is not None,'invalid artifact name')
        p=RELEASE/name;require(p.is_file() and not p.is_symlink() and sha(p)==item['sha256'],'artifact hash mismatch')
    require(m['outputs']['html']['name']=='candidate-index.html','HTML whitelist')
    names=[m['outputs'][k]['name'] for k in ['js','css']]
    require(names[0].startswith('DashboardLayout-workbench-dropdown-') and names[1].startswith('workbench-dropdown-'),'asset whitelist')
    for filename,digest in m['baseline'].items():
        if filename!='index.html':require(sha(PUBLIC/'assets'/filename)==digest,'static baseline drift '+filename)
    frozen_html=(RELEASE/'candidate-index.html').read_bytes()
    require(hashlib.sha256(frozen_html).hexdigest()==m['outputs']['html']['sha256'],'frozen candidate HTML hash mismatch')
    return m,names,frozen_manifest,frozen_html
def main():
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--plan',action='store_true');p.add_argument('--rollback-html',action='store_true');args=p.parse_args()
    m,names,frozen_manifest,frozen_html=manifest()
    require(not RELEASE.is_symlink(),'release symlink forbidden')
    if not args.apply:
        require(sha(HTML)==EXPECTED_HTML,'current HTML changed; rebase needed')
        print(json.dumps({'planOnly':True,'scope':'two immutable admin assets + admin HTML; no backend/DB change','htmlBefore':sha(HTML),'outputs':m['outputs']},ensure_ascii=False));return
    with open(LOCK,'a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Stop('another deployment holds shared lock')
        m,names,frozen_manifest,frozen_html=manifest()
        coord=json.loads(COORD.read_text());require(not coord.get('shared_release_active'),'another release active')
        if args.rollback_html:
            record=json.loads((RELEASE/'applied.json').read_text());require(sha(HTML)==m['outputs']['html']['sha256'],'HTML no longer ours; do not roll back')
            guard(record,names);require(sha(RELEASE/'before-index.html')==EXPECTED_HTML,'invalid backup')
            atomic(HTML,(RELEASE/'before-index.html').read_bytes());guard(record,names);health()
            private_record('html-rollback.json',{'at':datetime.now(timezone.utc).isoformat(),'htmlSha256':sha(HTML),'newBackendsPreserved':True});print('Only this release HTML reverted; backends/assets/data retained.');return
        require(not (RELEASE/'applied.json').exists(),'already applied; inspect existing receipt instead of replay')
        require(sha(HTML)==EXPECTED_HTML,'HTML changed; rebase needed')
        for name in names:require(not (PUBLIC/'assets'/name).exists() and not (PUBLIC/'assets'/name).is_symlink(),'asset already exists; inspect partial staging')
        before={'protected':protected_snapshot(),'assetTree':inventory_tree(),'htmlSha256':sha(HTML),'manifestSha256':hashlib.sha256(frozen_manifest).hexdigest()}
        require(all(p['status']=='online' for p in before['protected']['processes']),'a process is not online')
        require([p for p in before['protected']['processes'] if p['name']=='dianzi51-admin'] and all(p['script']=='/opt/releases/20261104-channel-inventory-ci-management-v1/admin/dist/index.js' for p in before['protected']['processes'] if p['name']=='dianzi51-admin'),'tombstone-aware backend must remain active')
        private_record('before-state.json',before)
        require(not (RELEASE/'before-index.html').exists(),'backup already exists; inspect partial operation')
        with open(RELEASE/'before-index.html','xb') as f:os.fchmod(f.fileno(),0o600);f.write(HTML.read_bytes());f.flush();os.fsync(f.fileno())
        old=HTML.read_text();candidate=frozen_html.decode('utf-8')
        pattern=r'<script type="importmap">([\s\S]*?)</script>'
        oldMaps=re.findall(pattern,old);newMaps=re.findall(pattern,candidate);require(len(oldMaps)==len(newMaps)==1,'single importmap required')
        mapping=json.loads(newMaps[0]);require(mapping['imports'].pop(m['importMapKey'],None)=='/assets/'+names[0],'wrong new importmap key')
        require(mapping==json.loads(oldMaps[0]),'existing importmap changed')
        stripped=re.sub(r'<!-- workbench-dropdown-nav-v1:start -->\n[\s\S]*?<!-- workbench-dropdown-nav-v1:end -->\n','',candidate)
        stripped=stripped.replace(newMaps[0],oldMaps[0],1);require(stripped==old,'non-navigation HTML change')
        guard(before,names);health()
        coord.setdefault('navigation_windows',[]).append({'owner_task':TASK,'release':str(RELEASE),'status':'applying','manifestSha256':before['manifestSha256']})
        coord['shared_release_active']=True;atomic(COORD,encode(coord))
        try:
            for name in names:
                item=m['outputs']['js' if name.endswith('.js') else 'css'];src=RELEASE/name;dest=PUBLIC/'assets'/name
                fd,tmp=tempfile.mkstemp(prefix='.nav-dropdown-',dir=dest.parent)
                try:
                    with os.fdopen(fd,'wb') as f:f.write(src.read_bytes());f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),0o644)
                    require(sha(tmp)==item['sha256'],'immutable copy hash');os.link(tmp,dest)
                finally:
                    if os.path.exists(tmp):os.unlink(tmp)
                verify_asset('http://127.0.0.1:3001',name,item['sha256'])
            directory=os.open(PUBLIC/'assets',os.O_RDONLY)
            try:os.fsync(directory)
            finally:os.close(directory)
            guard(before,names);require(sha(HTML)==EXPECTED_HTML,'HTML changed before activation')
            atomic(HTML,frozen_html)
            record={**before,'appliedAt':datetime.now(timezone.utc).isoformat(),'htmlAfterSha256':sha(HTML),'assets':m['outputs']}
            private_record('applied.json',record)
            guard(before,names);require(sha(HTML)==m['outputs']['html']['sha256'],'HTML hash after activation')
            healthResult=health()
            for origin in ['http://127.0.0.1:3001','https://admin.51dianzi.com']:
                with urllib.request.urlopen(origin+'/login',timeout=45) as r:require(r.status==200 and hashlib.sha256(r.read()).hexdigest()==m['outputs']['html']['sha256'],'HTTP HTML must be candidate')
                for kind in ['js','css']:verify_asset(origin,m['outputs'][kind]['name'],m['outputs'][kind]['sha256'])
            guard(before,names)
            verified={'ok':True,'verifiedAt':datetime.now(timezone.utc).isoformat(),'htmlSha256':sha(HTML),'outputs':m['outputs'],'noProcessRestart':True,'backendsWorkersEnvNginxFrontUnchanged':True,'existingAssetsUnchanged':True,'databaseTouched':False,'channelInventoryOverlayPreserved':True,'health':healthResult}
            private_record('verified.json',verified)
            coord['navigation_windows'][-1]['status']='verified';coord['navigation_windows'][-1]['receipt']=str(RELEASE/'verified.json')
            print(json.dumps(verified,ensure_ascii=False))
        except Exception:
            coord['navigation_windows'][-1]['status']='stopped; inspect applied.json and current HTML before any retry'
            raise
        finally:
            coord['shared_release_active']=False;atomic(COORD,encode(coord))
if __name__=='__main__':
    try:main()
    except Stop as e:print('STOP: '+str(e));raise SystemExit(1)
    except Exception:print('STOP: operation failed; inspect private receipts; do not replay or roll back backends.');raise SystemExit(1)
