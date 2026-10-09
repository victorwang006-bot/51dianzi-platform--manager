#!/usr/bin/env python3
"""后台统计提示条最小补丁。prepare本地生成；stage/activate在ECS执行，失败回滚两静态软链接。"""
import argparse, fcntl, hashlib, json, os, re, shutil, signal, subprocess, tarfile, tempfile
from pathlib import Path
OLD = Path('/opt/apps/releases/dianzi51-admin-20261005-1500-login-fullheight-c3dba08')
LINKS = [Path('/opt/apps/dianzi51-admin'), Path('/opt/apps/dianzi51-admin-subdomain')]
HTML_SHA = '1367b951cf9ebe46a41a9e01def4c3aec9573168a1c82c124502061b39a8f7eb'
BACKEND_SHA = 'c90486ee1dfc7049e3efcfcb2a47e0b66eabc35dde842084a57441001c78f955'
CHUNK = 'assets/Analytics-B9XRlroS.js'
REMOVE = 'k.jsxs(ht,{"data-loc":"client/src/pages/Analytics.tsx:170",className:"border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 shadow-none",children:["网站访问从 ",a.firstEventAt||"统计功能上线时"," 开始累计，不包含此前历史。"]}),'
sha = lambda b: hashlib.sha256(b).hexdigest()
file_sha = lambda p: sha(p.read_bytes())
def tree(root):
    result={}
    for p in sorted(root.rglob('*')):
        assert not p.is_symlink()
        if p.is_file():result[str(p.relative_to(root))]=file_sha(p)
    return result

def snapshot():
    rows=json.loads(subprocess.check_output(['pm2','jlist'],text=True))
    rows=[r for r in rows if r['name'].startswith('dianzi51')]
    assert all(r['pm2_env']['status']=='online' for r in rows)
    assert sum(r['name']=='dianzi51-admin' for r in rows)==2
    assert sum(r['name']=='dianzi51' for r in rows)==4
    assert any(r['name']=='dianzi51-inventory-import' for r in rows)
    return sorted((r['name'],r['pid']) for r in rows)

def fresh(path,data):
    fd,temp=tempfile.mkstemp(dir=path.parent,prefix='.analytics-copy-')
    try:
        os.fchmod(fd,0o644)
        with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def link_to(link,target):
    temp=link.with_name('.'+link.name+'.analytics-copy-'+str(os.getpid()))
    os.symlink(target,temp)
    try:os.replace(temp,link)
    finally:
        if temp.is_symlink():temp.unlink()

def get(uri):
    return subprocess.check_output(['curl','--noproxy','*','--resolve','admin.51dianzi.com:443:127.0.0.1','-fsS','--max-time','15','https://admin.51dianzi.com'+uri])

parser=argparse.ArgumentParser()
parser.add_argument('mode',choices=['prepare','stage','activate'])
parser.add_argument('--baseline');parser.add_argument('--package');parser.add_argument('--new');parser.add_argument('--commit');parser.add_argument('--archive');parser.add_argument('--archive-sha')
a=parser.parse_args()
if a.mode=='prepare':
    root=Path(a.baseline);out=Path(a.package);assert not out.exists()
    assert file_sha(root/'index.html')==HTML_SHA
    text=(root/CHUNK).read_text();assert text.count(REMOVE)==1
    edited=text.replace(REMOVE,'');assert '网站访问从' not in edited and '不包含此前历史' not in edited
    assert '数据始于' in edited and '小程序打开量从1.12.15' in edited
    name='assets/Analytics-copy-'+sha(edited.encode())[:12]+'.js'
    html=(root/'index.html').read_text();assert 'type="importmap"' not in html
    mapping={prefix+CHUNK:prefix+name for prefix in ('/','/admin/')}
    marker='    <script type="module" crossorigin src="/assets/index-DLgFRkpf.js"></script>'
    assert html.count(marker)==1
    changed=html.replace(marker,'    <script type="importmap">'+json.dumps({'imports':mapping},separators=(',',':'))+'</script>\n'+marker)
    out.mkdir();(out/'dist/public/assets').mkdir(parents=True)
    (out/'dist/public'/name).write_text(edited);(out/'dist/public/index.html').write_text(changed)
    manifest={'oldRelease':str(OLD),'newRelease':a.new,'sourceCommit':a.commit,'oldHtmlSha':HTML_SHA,'backendSha':BACKEND_SHA,'oldTree':tree(root),'newChunk':name,'files':{'dist/public/index.html':sha(changed.encode()),'dist/public/'+name:sha(edited.encode())},'change':'仅移除网站累计提示Card，保留图表日期、统计查询、主JS和既有CSS'}
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True)+'\n')
    print(json.dumps({'prepared':True,'newChunk':name,'changedFiles':2,'legacyResourcesPreserved':True},ensure_ascii=False))
else:
    with open('/run/lock/dianzi51-admin-css-only.lock','w') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert all(p.is_symlink() and p.resolve()==OLD for p in LINKS)
        assert file_sha(OLD/'dist/index.js')==BACKEND_SHA
        if a.mode=='stage':
            archive=Path(a.archive);assert file_sha(archive)==a.archive_sha
            with tarfile.open(archive,'r:gz') as tar:
                entries=tar.getmembers();assert all(e.isfile() for e in entries)
                manifest=json.load(tar.extractfile('manifest.json'))
                assert set(manifest['files'])=={'dist/public/index.html','dist/public/'+manifest['newChunk']}
                assert re.fullmatch(r'assets/Analytics-copy-[a-f0-9]{12}\.js',manifest['newChunk'])
                assert set(tar.getnames())=={'manifest.json',*manifest['files']}
                assert all(not n.startswith('/') and '..' not in n.split('/') for n in tar.getnames())
                payloads={n:tar.extractfile(n).read() for n in manifest['files']}
            new=Path(manifest['newRelease'])
            assert manifest['oldRelease']==str(OLD) and re.fullmatch(r'/opt/apps/releases/dianzi51-admin-20\d{6}T\d{6}Z-analytics-copy',str(new))
            assert re.fullmatch('[a-f0-9]{40}',manifest['sourceCommit'])
            assert not new.exists() and tree(OLD/'dist/public')==manifest['oldTree']
            assert shutil.disk_usage(OLD).free>1024**3
            assert all(sha(payloads[n])==digest for n,digest in manifest['files'].items())
            assert not (OLD/'dist/public'/manifest['newChunk']).exists()
            assert payloads['dist/public/'+manifest['newChunk']].decode()==(OLD/('dist/public/'+CHUNK)).read_text().replace(REMOVE,'')
            subprocess.run(['cp','-al','--',str(OLD),str(new)],check=True)
            for name,data in payloads.items():fresh(new/name,data)
            fresh(new/'ADMIN_STATIC_PATCH.json',(json.dumps(manifest,ensure_ascii=False,sort_keys=True)+'\n').encode())
            assert file_sha(new/'dist/index.js')==BACKEND_SHA and (new/'uploads').resolve()==(OLD/'uploads').resolve()
            for name,digest in manifest['oldTree'].items():
                if name!='index.html':assert file_sha(new/'dist/public'/name)==digest
            print(json.dumps({'stage':'ready','newRelease':str(new),'activeUnchanged':True,'backendUnchanged':True,'uploadsUnchanged':True}))
        else:
            new=Path(a.new);manifest=json.loads((new/'ADMIN_STATIC_PATCH.json').read_text())
            assert manifest['oldRelease']==str(OLD) and manifest['newRelease']==str(new)
            assert tree(OLD/'dist/public')==manifest['oldTree']
            for name,digest in manifest['files'].items():assert file_sha(new/name)==digest
            assert file_sha(new/'dist/index.js')==BACKEND_SHA
            assert (new/'uploads').resolve()==(OLD/'uploads').resolve()
            for name,digest in manifest['oldTree'].items():
                if name!='index.html':assert file_sha(new/'dist/public'/name)==digest
            before=snapshot();assert sha(get('/login'))==HTML_SHA
            def cancel(signum,frame):raise InterruptedError('activation interrupted')
            for sig in (signal.SIGTERM,signal.SIGHUP):signal.signal(sig,cancel)
            try:
                for link in LINKS:link_to(link,new)
                for route in ('/login','/analytics'):assert sha(get(route))==manifest['files']['dist/public/index.html']
                assert sha(get('/'+manifest['newChunk']))==manifest['files']['dist/public/'+manifest['newChunk']]
                assert sha(get('/'+CHUNK))==manifest['oldTree'][CHUNK]
                assert snapshot()==before
            except BaseException:
                for link in LINKS:link_to(link,OLD)
                assert sha(get('/login'))==HTML_SHA
                print('activation_failed_old_links_restored=true')
                raise
            print(json.dumps({'activation':'passed','newRelease':str(new),'allPidsUnchanged':True,'backendRestarted':False,'uploadsUnchanged':True,'databaseTouched':False}))
