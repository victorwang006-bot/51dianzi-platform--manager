from pathlib import Path
import json,hashlib,subprocess,fcntl,time,re
R=Path('/opt/ops/20261117-orders-undefined-fix');m=json.loads((R/'manifest.json').read_text());S=Path(m['staticRoot']);html=S/'index.html';H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def run(args):return subprocess.check_output(args,timeout=30)
def procs():
 rows=json.loads(run(['pm2','jlist']));return sorted([{'id':x['pm_id'],'pid':x['pid'],'name':x['name'],'status':x['pm2_env']['status'],'script':x['pm2_env']['pm_exec_path'],'cwd':x['pm2_env']['pm_cwd'],'env':hashlib.sha256((Path('/proc')/str(x['pid'])/'environ').read_bytes()).hexdigest()}for x in rows],key=lambda x:x['id'])
def atomic(content,p):
 t=p.with_name(p.name+'.orders-empty-next');assert not t.exists();t.write_bytes(content);t.chmod(0o644);t.replace(p)
def validate():
 assert m['scope']=='orders-four-nullable-data-static-only' and len(m['modules'])==2
 assert H(html)==m['oldHtmlSha256'] and H(R/'index.html')==m['newHtmlSha256']
 assert sum(len(a['patches'])for a in m['modules'])==8 and sum(len(a['functions'])for a in m['modules'])==4
 for a in m['modules']:
  old=S/a['oldUrl'].lstrip('/');new=S/a['newUrl'].lstrip('/');candidate=R/Path(a['newUrl']).name
  assert re.fullmatch(r'/assets/BusinessWorkbenchPage-orders-empty-safe-[0-9a-f]{16}\.js',a['newUrl']) and old.parent==new.parent
  assert H(old)==a['beforeSha256'] and H(candidate)==a['afterSha256'];before=old.read_bytes();expected=before
  assert len(a['patches'])==4
  for p in sorted(a['patches'],key=lambda x:x['beforeByteStart'],reverse=True):
   i=p['beforeByteStart'];j=p['beforeByteEnd'];assert before[i:j]==p['before'].encode()
   if p['kind']=='nullable-current-CRM-data':
    assert re.fullmatch(r'\([\w$]+\.data\.items\?\?\[\]\)',p['before']);assert p['after']==p['before'].replace('.data.items','.data?.items')
   else:
    assert p['kind']=='only-current-readable-page-notification-refs' and p['before']=='__niPageRows.map(row=>"crm-sales:"+row.id)' and p['after']=='__niListReady?'+p['before']+':[]'
   expected=expected[:i]+p['after'].encode()+expected[j:]
  assert candidate.read_bytes()==expected,'NON_ORDER_BYTE_CHANGE'
  subprocess.run(['node','--input-type=module','--check'],input=expected,capture_output=True,check=True)
 before=html.read_text();after=(R/'index.html').read_text();pat=r'(<script[^>]*type="importmap"[^>]*>)([\s\S]*?)(</script>)';b=re.search(pat,before);a=re.search(pat,after);assert b and a
 assert after[:a.start(2)]+b.group(2)+after[a.end(2):]==before,'NON_IMPORTMAP_HTML_CHANGE'
 oldmap=json.loads(b.group(2));newmap=json.loads(a.group(2));rewrites=m['rewrites'];assert rewrites=={a['oldUrl']:a['newUrl']for a in m['modules']}
 for k,v in oldmap['imports'].items():assert newmap['imports'][k]==rewrites.get(v,v)
 for scope,table in oldmap.get('scopes',{}).items():
  for k,v in table.items():assert newmap['scopes'][scope][k]==rewrites.get(v,v)
 ps=procs();assert len(ps)==12 and all(x['status']=='online'for x in ps)
 return ps
locks=[]
for name in ['dianzi51-public-deploy.lock','dianzi51-production-code.lock']:
 f=open('/var/lock/'+name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
assert not (R/'apply-attempt.json').exists(),'SINGLE_APPLY_ONLY';ps=validate()
paths={x['script']for x in ps}|{'/root/.pm2/dump.pm2','/etc/nginx/nginx.conf','/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html'}|{str(S/v.lstrip('/'))for v in m['protectedEntries'].values()}|{str(S/a['oldUrl'].lstrip('/'))for a in m['modules']}
paths|={str(p)for p in Path('/etc/nginx/conf.d').glob('*')if p.is_file()};protected={p:H(p)for p in paths}
(R/'index.before.html').write_bytes(html.read_bytes());(R/'protection.json').write_text(json.dumps({'files':protected,'processes':ps},indent=2)+'\n');(R/'apply-attempt.json').write_text(json.dumps({'started':time.time(),'singleStaticApply':True})+'\n');switched=False
try:
 for a in m['modules']:
  new=S/a['newUrl'].lstrip('/');candidate=(R/Path(a['newUrl']).name).read_bytes()
  if new.exists():assert H(new)==a['afterSha256'],'ASSET_COLLISION'
  else:atomic(candidate,new)
  served=run(['curl','-fsS','--compressed','--max-time','20','--resolve','admin.51dianzi.com:443:127.0.0.1','https://admin.51dianzi.com'+a['newUrl']]);assert hashlib.sha256(served).hexdigest()==a['afterSha256']
 assert H(html)==m['oldHtmlSha256'] and procs()==ps and all(H(p)==h for p,h in protected.items())
 atomic((R/'index.html').read_bytes(),html);switched=True
 served=run(['curl','-fsS','--compressed','--max-time','20','--resolve','admin.51dianzi.com:443:127.0.0.1','https://admin.51dianzi.com/workbench/sales-orders']);assert hashlib.sha256(served).hexdigest()==m['newHtmlSha256']
 assert procs()==ps and all(H(p)==h for p,h in protected.items())
 receipt={'status':'deployed','finishedAt':time.time(),'fourCRMFunctionsAndReadableRefsOnly':True,'modules':[a['newUrl']for a in m['modules']],'htmlBefore':m['oldHtmlSha256'],'htmlAfter':m['newHtmlSha256'],'all12ProcessesUnchanged':True,'protectedFileCount':len(protected),'protectedFilesUnchanged':True,'noApiWorkerNginxOrDatabaseChanges':True,'sourceHashes':m['sourceHashes']};(R/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
except Exception as e:
 rollback='not-needed'
 if switched:
  if H(html)==m['newHtmlSha256']:atomic((R/'index.before.html').read_bytes(),html);rollback='own-html-restored'
  else:rollback='foreign-html-not-overwritten'
 (R/'receipt.json').write_text(json.dumps({'status':'failed','error':str(e),'rollback':rollback})+'\n');raise
