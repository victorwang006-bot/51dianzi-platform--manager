#!/usr/bin/env python3
import hashlib,json,subprocess,re
from pathlib import Path

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

def record_root_links(root, links):
    for path in [root, *root.parents]:
        if path.is_symlink():links[str(path)]=str(path.readlink())

def snapshot():
    pm=json.loads(subprocess.check_output(['pm2','jlist'],text=True))
    targets=[p for p in pm if p['name'].startswith('dianzi51')]
    services=[]; roots=set(); files=set(); links={}
    for p in targets:
        e=p['pm2_env'];entry=Path(e['pm_exec_path'])
        services.append({'id':p['pm_id'],'name':p['name'],'pid':p['pid'],'status':e['status'],'exec':str(entry),'cwd':e['pm_cwd'],'start':e['pm_uptime'],'restarts':e['restart_time']})
        files.add(entry)
        dist=Path(e['pm_cwd'])/'dist'
        if dist.is_dir(): roots.add(dist)
    nginx=Path('/etc/nginx/conf.d/dianzi51-https.conf')
    for root in re.findall(r'^\s*root\s+([^;]+);',nginx.read_text(),re.M):
        if Path(root).is_dir():roots.add(Path(root))
    for root in roots:
        record_root_links(root, links)
        for path in root.rglob('*'):
            if path.is_symlink():links[str(path)]=str(path.readlink())
            if path.is_file() and not path.is_symlink():files.add(path)
    for path in [Path('/etc/nginx/nginx.conf'),*Path('/etc/nginx/conf.d').glob('*')]:
        if path.is_file():files.add(path)
    hashes={str(p):sha(p) for p in sorted(files,key=str)}
    maps={}
    for p in sorted(files,key=str):
        if p.name!='index.html':continue
        raw=p.read_text(errors='replace')
        for m in re.finditer(r'<script\b[^>]*type=["\']importmap["\'][^>]*>(.*?)</script>',raw,re.S):
            maps[str(p)]=json.loads(m[1]).get('imports',{})
    return {'files':hashes,'fileCount':len(hashes),'services':sorted(services,key=lambda p:p['id']),'maps':maps,'roots':sorted(map(str,roots)),'links':links}

if __name__=='__main__':
    print(json.dumps(snapshot(),ensure_ascii=False,indent=2))
