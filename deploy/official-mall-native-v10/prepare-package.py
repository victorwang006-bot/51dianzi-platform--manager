from pathlib import Path
import json,hashlib,shutil,subprocess,re
D=Path(__file__).resolve().parent;O=D/'package';O.mkdir(exist_ok=True);H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
old=json.loads((D/'previous-release-manifest.json').read_text());nm=json.loads((D/'native/manifest.json').read_text());live=json.loads((D/'live-targets.json').read_text());replacements=[];adds=[];expected={};sourceHashes={}
def put(p,name):
 q=O/name;q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,q);return name,H(q)
for role in ['front','admin']:
 f=next(x for x in old['replace']if x['kind']=='api'and '/'+role+'/dist/'in x['target']);expected[f['target']]=f['sha256'];src,h=put(D/'native'/f'{role}.js','api/'+role+'.js');replacements.append(dict(kind='api',source=src,target=f['target'],sha256=h))
 r=nm['compiled'][role];src,h=put(D/'native'/r['name'],'runtime/'+r['name']);assert h==r['sha256'];target=str(Path(f['target']).parent.parent/'runtime'/r['name']);adds.append(dict(kind='runtime',source=src,target=target,sha256=h))
for r in nm['extraRuntime']:
 f=next(x for x in old['replace']if x['kind']=='api'and '/front/dist/'in x['target']);src,h=put(D/'native'/r['name'],'runtime/'+r['name']);assert h==r['sha256'];adds.append(dict(kind='runtime',source=src,target=str(Path(f['target']).parent.parent/'runtime'/r['name']),sha256=h))
for role,host in [('admin','admin.51dianzi.com'),('front','51dianzi.com')]:
 S=D/('static-'+role);sm=json.loads((S/'manifest.json').read_text());f=next(x for x in live['static']if '/'+role+'/dist/'in x['path']);assert f['sha256']==sm['htmlBeforeSha256'],'HTML_BASELINE_DRIFT';expected[f['path']]=f['sha256'];src,h=put(S/'index.html','html/'+role+'.html');assert h==sm['htmlAfterSha256'];replacements.append(dict(kind='html',source=src,target=f['path'],sha256=h,host=host));root=str(Path(f['path']).parent)
 for url in sm['assets']:
  src,h=put(S/Path(url).name,'static/'+role+'/'+Path(url).name);adds.append(dict(kind='static',source=src,target=root+url,sha256=h,host=host,url=url))
 for p,h in sm['sources'].items():assert H(p)==h,'STATIC_SOURCE_DRIFT:'+p;sourceHashes[p]=h
 oldEntries=sm.get('entryBefore')or sm.get('rootBefore');expected[root+oldEntries]=H(D/'baseline'/f'{role}-entry.js')
for p,h in nm['sourceHashes'].items():assert H(p)==h,'NATIVE_SOURCE_DRIFT:'+p;sourceHashes[p]=h
for f in old['add']:expected[f['target']]=f['sha256']
expected[old['bindingTarget']]=old['bindingSha256']
ddl=Path('/home/ubuntu/work/51dianzi-platform--manager/drizzle/migrations/20261117_official_mall_native.sql');src,ddlh=put(ddl,'official-mall-native.sql');sourceHashes[str(ddl)]=ddlh
columns={};text=ddl.read_text()
for name,body in re.findall(r'CREATE TABLE IF NOT EXISTS `(official_mall_\w+)`\s*\((.*?)\) ENGINE=',text,re.S):
 columns[name]=re.findall(r'`([A-Za-z][A-Za-z0-9_]*)`\s+(?:INT|VARCHAR|JSON|BOOLEAN|TEXT|TIMESTAMP|ENUM)',body)
assert sorted(columns)==['official_mall_materials','official_mall_publications','official_mall_requests']
_,controllerh=put(D/'release.py','release.py')
M=dict(scope='official-mall-native-v10',independentReview='passed',reviewBasis='single independent read-only review plus explicit parent closure of its P1 findings; final source/native/static checks; no live goods/order write test',replace=replacements,add=adds,bindingTarget=old['bindingTarget'],bindingSha256=old['bindingSha256'],dbCwd=live['adminCwd'][0],reloadNames=['dianzi51','dianzi51-admin'],sourceHashes=sourceHashes,emptyTablesOnly=True,noBusinessDml=True,noBindingInstallation=True,noAutomaticPublication=True,tables=['official_mall_materials','official_mall_publications','official_mall_requests'],tableColumns=columns,ddlSha256=ddlh,controllerSha256=controllerh)
for p in [O/'release-manifest.json',D/'release-manifest.json']:p.write_text(json.dumps(M,ensure_ascii=False,indent=2)+'\n')
remote=r'''from pathlib import Path
import json,hashlib,subprocess
expected=EXPECTED
rows=json.loads(subprocess.check_output(['pm2','jlist']));ps=[]
for x in rows:
 e=x['pm2_env'];p=Path('/proc')/str(x['pid']);ps.append(dict(id=x['pm_id'],name=x['name'],pid=x['pid'],status=e['status'],script=e['pm_exec_path'],cwd=e['pm_cwd'],env=hashlib.sha256((p/'environ').read_bytes()).hexdigest(),configuredEnv=hashlib.sha256(json.dumps(e.get('env',{}),sort_keys=True,separators=(',',':'),default=str).encode()).hexdigest()))
assert len(ps)==12 and all(x['status']=='online'for x in ps);assert sum(x['name']in ['dianzi51','dianzi51-admin']for x in ps)==6
for p,h in expected.items():assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h,'LIVE_BASELINE_DRIFT:'+p
paths=set(expected)|{x['script']for x in ps}|{'/root/.pm2/dump.pm2','/etc/nginx/nginx.conf'}
paths|={str(p)for p in Path('/etc/nginx/conf.d').glob('*')if p.is_file()}
files={p:hashlib.sha256(Path(p).read_bytes()).hexdigest()for p in sorted(paths)}
print(json.dumps(dict(files=files,processes=sorted(ps,key=lambda x:x['id']),expectedApiInstances=6,workersProtected=True,noLiveWrites=True)))
'''.replace('EXPECTED',repr(expected))
ssh=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ControlPath=none','-o','ConnectTimeout=15','root@47.97.108.147'];r=subprocess.run(ssh+['python3 -'],input=remote.encode(),capture_output=True,timeout=80);assert r.returncode==0,r.stderr.decode()[-500:];B=json.loads(r.stdout)
for p in [O/'protection.json',D/'protection.json']:p.write_text(json.dumps(B,indent=2)+'\n')
print('PRIVATE_NATIVE_MALL_V10_PACKAGE_READY',len(replacements),len(adds),'protected',len(B['files']),'emptyTablesOnly/noBusinessDml/noWorkerReload')
