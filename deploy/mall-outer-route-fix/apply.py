from pathlib import Path
import json,hashlib,subprocess,os,fcntl,time
R=Path('/opt/ops/20261116-mall-outer-route-fix');m=json.loads((R/'manifest.json').read_text());S=Path(m['staticRoot']);html=S/'index.html';old=S/m['oldEntry'].lstrip('/');new=S/m['newEntry'].lstrip('/');H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def run(args):return subprocess.check_output(args,timeout=30)
def procs():
 rows=json.loads(run(['pm2','jlist']));return sorted([{'id':x['pm_id'],'pid':x['pid'],'name':x['name'],'status':x['pm2_env']['status'],'script':x['pm2_env']['pm_exec_path'],'cwd':x['pm2_env']['pm_cwd'],'env':hashlib.sha256((Path('/proc')/str(x['pid'])/'environ').read_bytes()).hexdigest()}for x in rows],key=lambda x:x['id'])
def atomic(content,p):
 t=p.with_name(p.name+'.mall-route-next');assert not t.exists();t.write_bytes(content);t.chmod(0o644);os.replace(t,p)
locks=[]
for name in ['dianzi51-public-deploy.lock','dianzi51-production-code.lock']:
 f=open('/var/lock/'+name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
assert not (R/'apply-attempt.json').exists(),'SINGLE_APPLY_ONLY';assert m['scope']=='mall-outer-router-404-only'
assert H(html)==m['oldHtmlSha256'] and H(old)==m['oldModuleSha256'];assert H(R/'index.html')==m['newHtmlSha256'] and H(R/m['files'][0]['name'])==m['newModuleSha256'];assert old.parent==new.parent and new.parent.exists()
# One byte insertion into the actual root module; no other original bytes may change.
p=m['patch'][0];before=old.read_bytes();candidate=(R/m['files'][0]['name']).read_bytes();i=p['beforeByteStart'];insert=p['after'].encode();assert len(m['patch'])==1 and p['before']=='' and candidate==before[:i]+insert+before[i:]
subprocess.run(['node','--input-type=module','--check'],input=candidate,capture_output=True,check=True)
ps=procs();assert len(ps)==12 and all(x['status']=='online' for x in ps);paths={x['script']for x in ps}|{'/root/.pm2/dump.pm2','/etc/nginx/nginx.conf','/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/public/index.html'};paths|={str(p)for p in Path('/etc/nginx/conf.d').glob('*')if p.is_file()};protected={p:H(p)for p in paths}
(R/'index.before.html').write_bytes(html.read_bytes());(R/'protection.json').write_text(json.dumps({'files':protected,'processes':ps},indent=2)+'\n');(R/'apply-attempt.json').write_text(json.dumps({'started':time.time(),'singleStaticApply':True})+'\n');switched=False
try:
 if new.exists():assert H(new)==m['newModuleSha256'],'ASSET_COLLISION'
 else:atomic(candidate,new)
 served=run(['curl','-fsS','--compressed','--max-time','15','--resolve','admin.51dianzi.com:443:127.0.0.1','https://admin.51dianzi.com'+m['newEntry']]);assert hashlib.sha256(served).hexdigest()==m['newModuleSha256']
 assert H(html)==m['oldHtmlSha256'] and procs()==ps;assert all(H(p)==h for p,h in protected.items())
 atomic((R/'index.html').read_bytes(),html);switched=True
 served=run(['curl','-fsS','--compressed','--max-time','15','--resolve','admin.51dianzi.com:443:127.0.0.1','https://admin.51dianzi.com/workbench/mall-materials']);assert hashlib.sha256(served).hexdigest()==m['newHtmlSha256']
 assert procs()==ps and all(H(p)==h for p,h in protected.items()) and H(old)==m['oldModuleSha256']
 receipt={'status':'deployed','finishedAt':time.time(),'oneOuterRouteOnly':True,'oldEntry':m['oldEntry'],'newEntry':m['newEntry'],'htmlBefore':m['oldHtmlSha256'],'htmlAfter':m['newHtmlSha256'],'newModuleSha256':m['newModuleSha256'],'all12ProcessesUnchanged':True,'protectedFilesUnchanged':True,'noApiWorkerNginxOrDatabaseChanges':True,'sourceSha256':m['sourceSha256']};(R/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
except Exception as e:
 rollback='not-needed'
 if switched:
  if H(html)==m['newHtmlSha256']:atomic((R/'index.before.html').read_bytes(),html);rollback='own-html-restored'
  else:rollback='foreign-html-not-overwritten'
 (R/'receipt.json').write_text(json.dumps({'status':'failed','error':str(e),'rollback':rollback})+'\n');raise
