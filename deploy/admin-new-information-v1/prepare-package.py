from pathlib import Path
import json,hashlib,shutil,subprocess,re
D=Path(__file__).resolve().parent;O=D/'package';O.mkdir(exist_ok=True);H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
n=json.loads((D/'native/manifest.json').read_text());nav=json.loads((D/'static-navigation/manifest.json').read_text());pages=json.loads((D/'static-pages/manifest.json').read_text());live=json.loads((D/'baseline/targets.json').read_text());old=json.loads(Path('/home/ubuntu/work/official-mall-native-v10-20261117/package/release-manifest.json').read_text());replace=[];adds=[];expected={};sources={}
def put(p,name):
 q=O/name;q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,q);return name,H(q)
def pin(p,h):
 assert H(p)==h,'CURRENT_SOURCE_DRIFT:'+p;sources[p]=h
for role in ['front','admin']:
 target=live['paths'][role+'Api'];expected[target]=live['hashes'][role+'Api'];assert expected[target]==n['api'][role]['before']
 src,h=put(D/'native'/f'{role}Api.js','api/'+role+'.js');assert h==n['api'][role]['after'];replace.append(dict(kind='api',source=src,target=target,sha256=h))
 for typ in [role,'contracts']:
  r=n['compiled'][typ];src,h=put(D/'native'/r['name'],'runtime/'+r['name']);assert h==r['sha256'];adds.append(dict(kind='runtime',source=src,target=str(Path(target).parent.parent/'runtime'/r['name']),sha256=h,role=role))
for p,h in n['sourceHashes'].items():pin(p,h)
for p,h in nav['sources'].items():pin(p,h)
for p,h in pages['sourceHashes'].items():pin(p,h)
assert H(D/'static-navigation/manifest.json')==pages['navigation']['manifestSha256']
assert pages['htmlBaseSha256']==nav['after']['htmlSha256'] and nav['before']['htmlSha256']==live['hashes']['html']
assert pages['checks']['allNineRealPages'] and pages['checks']['oneNotificationContext'] and pages['checks']['allImportmapAliasesInherited']
src,h=put(pages['finalHtml'],'html/admin.html');assert h==pages['finalHtmlSha256'];replace.append(dict(kind='html',source=src,target=live['paths']['html'],sha256=h,host='admin.51dianzi.com'));expected[live['paths']['html']]=live['hashes']['html'];expected[live['paths']['nav']]=live['hashes']['nav'];root=live['staticRoot']
for url in nav['assets']:
 src,h=put(D/'static-navigation'/Path(url).name,'static/'+Path(url).name);adds.append(dict(kind='static',source=src,target=root+url,sha256=h,host='admin.51dianzi.com',url=url))
for f in pages['assets']:
 src,h=put(f['local'],'static/'+Path(f['url']).name);assert h==f['sha256'];adds.append(dict(kind='static',source=src,target=root+f['url'],sha256=h,host='admin.51dianzi.com',url=f['url']))
for mod in pages['modules']:expected[root+mod['actualtargetURL']]=mod['beforeSha256']
for f in old['add']:expected.setdefault(f['target'],f['sha256'])
for f in old['replace']:expected.setdefault(f['target'],f['sha256'])
expected[old['bindingTarget']]=old['bindingSha256']
meta={'admin':[Path('/home/ubuntu/work/51dianzi-platform--manager/drizzle/migrations/20261117_admin_new_information.sql')],'front':[Path('/home/ubuntu/work/51dianzi-platform/drizzle/migrations/20261117_admin_new_information_assignments.sql'),Path('/home/ubuntu/work/51dianzi-platform/drizzle/migrations/20261117_admin_new_information_origins.sql')]}
databases={}
for role,files in meta.items():
 text='\n'.join(p.read_text()for p in files);(O/(role+'-new-information.sql')).write_text(text)
 tables=[];cols={};keys={}
 for name,body in re.findall(r'CREATE TABLE IF NOT EXISTS `?([a-z_]+)`?\s*\((.*?)\)\s*ENGINE=',text,re.S):
  tables.append(name);cols[name]=re.findall(r'^\s*`?([A-Za-z][A-Za-z0-9_]*)`?\s+(?:INT|BIGINT|ENUM|VARCHAR|JSON|DATETIME)\b',body,re.M|re.I)
  keys[name]=[[v.strip().strip('`')for v in k.split(',')]for k in re.findall(r'(?:PRIMARY KEY|UNIQUE KEY\s+[A-Za-z0-9_]+)\s*\(([^)]+)\)',body)]
  assert cols[name] and keys[name],name
 for p in files:sources[str(p)]=H(p)
 databases[role]=dict(processName='dianzi51-admin'if role=='admin'else'dianzi51',packageCwd=str(Path(live['paths'][role+'Api']).parent.parent),ddlSource=role+'-new-information.sql',ddlSha256=H(O/(role+'-new-information.sql')),tables=tables,tableColumns=cols,uniqueKeys=keys,dependencies=['admin_users','admin_user_permissions','admin_staff_archives','official_mall_materials']if role=='admin'else['users','enterprise_members','crm_customers','crm_customer_demands','crm_customer_demand_audits','crm_sales_orders','orders'])
assert len(databases['admin']['tables'])==2 and len(databases['front']['tables'])==4
src,ch=put(D/'release.py','release.py')
review=D/'review-closure-result.json';reviewed=review.exists()and json.loads(review.read_text()).get('status')=='passed'
M=dict(scope='admin-new-information-v1',independentReview='passed'if reviewed else'pending',reviewBasis='one independent read-only review and explicit parent closure; native 12 checks; original typed and DOM/source tests; no live goods/order write test',replace=replace,add=adds,databases=databases,sourceHashes=sources,reloadNames=['dianzi51','dianzi51-admin'],emptyTablesOnly=True,noBusinessDml=True,noBindingInstallation=True,noAutomaticPublication=True,bindingTarget=old['bindingTarget'],bindingSha256=old['bindingSha256'],controllerSha256=ch)
for p in [O/'release-manifest.json',D/'release-manifest.json']:p.write_text(json.dumps(M,ensure_ascii=False,indent=2)+'\n')
remote=r'''from pathlib import Path
import json,hashlib,subprocess
expected=EXPECTED
rows=json.loads(subprocess.check_output(['pm2','jlist']));ps=[];ready={}
for x in rows:
 e=x['pm2_env'];p=Path('/proc')/str(x['pid']);raw=(p/'environ').read_bytes();ps.append(dict(id=x['pm_id'],name=x['name'],pid=x['pid'],status=e['status'],script=e['pm_exec_path'],cwd=e['pm_cwd'],env=hashlib.sha256(raw).hexdigest(),configuredEnv=hashlib.sha256(json.dumps(e.get('env',{}),sort_keys=True,separators=(',',':'),default=str).encode()).hexdigest()))
 if x['name']in ['dianzi51','dianzi51-admin']:
  vals={**e,**e.get('env',{})};r={key:bool(str(vals.get(key,'')).strip())for key in ['DATABASE_URL','JWT_SECRET','PORTAL_API_KEY']};ready.setdefault(x['name'],[]).append(r)
assert len(ps)==12 and all(x['status']=='online'for x in ps);assert sum(x['name']in ['dianzi51','dianzi51-admin']for x in ps)==6
assert all(len(v)>0 and all(r['DATABASE_URL']and r['PORTAL_API_KEY']for r in v)for v in ready.values());assert all(r['JWT_SECRET']for r in ready['dianzi51-admin']),'EXISTING_NOTIFICATION_SIGNING_SECRET_UNAVAILABLE'
for p,h in expected.items():assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h,'LIVE_BASELINE_DRIFT:'+p
paths=set(expected)|{x['script']for x in ps}|{'/root/.pm2/dump.pm2','/etc/nginx/nginx.conf'}
paths|={str(p)for p in Path('/etc/nginx/conf.d').glob('*')if p.is_file()}
files={p:hashlib.sha256(Path(p).read_bytes()).hexdigest()for p in sorted(paths)}
print(json.dumps(dict(files=files,processes=sorted(ps,key=lambda x:x['id']),existingSecretsReady=ready,expectedApiInstances=6,workersProtected=True,noLiveWrites=True)))
'''.replace('EXPECTED',repr(expected))
ssh=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ControlPath=none','-o','ConnectTimeout=15','root@47.97.108.147'];r=subprocess.run(ssh+['python3 -'],input=remote.encode(),capture_output=True,timeout=100);assert r.returncode==0,r.stderr.decode()[-500:];B=json.loads(r.stdout)
for role,d in M['databases'].items():
 rows=[x for x in B['processes']if x['name']==d['processName']];cwds={x['cwd']for x in rows};assert len(cwds)==1;d['packageCwd']=cwds.pop();d['expectedInstances']=len(rows)
for p in [O/'release-manifest.json',D/'release-manifest.json']:p.write_text(json.dumps(M,ensure_ascii=False,indent=2)+'\n')
for p in [O/'protection.json',D/'protection.json']:p.write_text(json.dumps(B,indent=2)+'\n')
print('PRIVATE_NEW_INFORMATION_PACKAGE_READY',len(replace),len(adds),'protected',len(B['files']),'review',M['independentReview'],'sixEmptyMetadataTables/noBusinessDml/noWorkerReload')
