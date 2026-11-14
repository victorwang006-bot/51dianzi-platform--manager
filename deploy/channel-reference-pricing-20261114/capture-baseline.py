#!/usr/bin/env python3
import subprocess,json,pathlib,tarfile,io,hashlib
W=pathlib.Path('/home/ubuntu/work/channel-reference-batch-299-20261114')
REMOTE=r'''
import pathlib,json,hashlib,subprocess,tarfile,io,re,sys,datetime,fcntl
locks=[]
for name in ['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']:
 f=open(name,'a+');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
P=pathlib.Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
OPS=pathlib.Path('/opt/ops/20261114-navigation-reference-ui-CKSZQ7s')
sha=lambda b:hashlib.sha256(b).hexdigest()
old=json.loads((OPS/'manifest.json').read_text());base=json.loads((OPS/'baseline.json').read_text());verified=json.loads((OPS/'verified.json').read_text());receipt=json.loads((OPS/'git-source-receipt.json').read_text())
assert old['sourceCommit']=='aeaf9f87f2fc96e210a635eee17c491f43df757a'
assert receipt['gitCommit']==old['sourceCommit']
assets={r['relative']:r['sha256'] for r in base['baselineAssets']}
assets.update({r['relative']:r['sha256'] for r in old['dependencyFiles']})
assets.update({r['relative']:r['sha256'] for r in old['files'] if r['relative']!='index.html'})
for f,h in assets.items():assert sha((P/f).read_bytes())==h,'PROTECTED_ASSET_CHANGED '+f
html=(P/'index.html').read_bytes()
assert sha(html)==old['htmlSha256']=='b026128dc2a13383a40f12886d7db437db803b2915c5b75fdb0cc1dbfd8e45a9'
api=base['apiPaths'];apiHashes={k:sha(pathlib.Path(v).read_bytes()) for k,v in api.items()}
assert apiHashes==base['api']
cp=pathlib.Path('/opt/ops/51-project-release-coordination-20261027.json');coordBytes=cp.read_bytes();coord=json.loads(coordBytes)
assert coord.get('shared_release_active') is False,'ACTIVE_COORDINATION'
procs=json.loads(subprocess.check_output(['pm2','jlist']));assert len(procs)==12 and all(p['pm2_env']['status']=='online' for p in procs)
processes=[]
for p in procs:
 e=p['pm2_env'];processes.append({'id':p['pm_id'],'name':p['name'],'pid':p['pid'],'status':e['status'],'script':e.get('pm_exec_path'),'cwd':e.get('pm_cwd'),'execMode':e.get('exec_mode'),'environmentHash':sha(json.dumps(e.get('env',{}),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode())})
processes.sort(key=lambda p:p['id'])
for r in base['protectedFiles']:assert sha(pathlib.Path(r['path']).read_bytes())==r['sha256'],'PROTECTED_FILE_CHANGED '+r['path']
im=json.loads(re.search(r'<script[^>]*type="importmap"[^>]*>([\s\S]*?)</script>',html.decode())[1]);urls=set(assets)
for mapping in [im.get('imports',{}),*im.get('scopes',{}).values()]:
 for v in mapping.values():
  if isinstance(v,str) and v.startswith('/assets/') and '?' not in v and '..' not in v.split('/'):urls.add(v.lstrip('/'))
for v in re.findall(r'(?:src|href)="(/assets/[^"?]+)"',html.decode()):urls.add(v.lstrip('/'))
files={'index.html':html,'admin-index.js':pathlib.Path(api['admin']).read_bytes(),'front-index.js':pathlib.Path(api['front']).read_bytes(),'previous-source-receipt.json':(OPS/'git-source-receipt.json').read_bytes(),'previous-manifest.json':(OPS/'manifest.json').read_bytes(),'previous-verified.json':(OPS/'verified.json').read_bytes(),'previous-baseline.json':(OPS/'baseline.json').read_bytes()}
for f in urls:
 p=P/f
 if p.is_file():files[f]=p.read_bytes()
report={'capturedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'beforeHtmlSha256':sha(html),'api':apiHashes,'apiPaths':api,'publicRoot':str(P),'allOnline':True,'processCount':12,'processes':processes,'sharedReleaseActive':False,'coordSha256':sha(coordBytes),'baselineAssets':[{'relative':f,'sha256':h} for f,h in sorted(assets.items())],'protectedFiles':base['protectedFiles'],'homepage':base.get('homepage'),'productionRecordWrites':0,'databaseAccess':False,'environmentValuesExported':False,'sourceReceiptPath':str(OPS/'git-source-receipt.json'),'sourceCommit':old['sourceCommit']}
files['live-baseline-current.json']=(json.dumps(report,indent=2)+'\n').encode()
b=io.BytesIO()
with tarfile.open(fileobj=b,mode='w:gz') as t:
 for name,data in files.items():
  i=tarfile.TarInfo(name);i.size=len(data);i.mode=0o600;t.addfile(i,io.BytesIO(data))
sys.stdout.buffer.write(b.getvalue())
'''
r=subprocess.run(['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','ConnectTimeout=10','root@47.97.108.147','python3 -'],input=REMOTE.encode(),capture_output=True,timeout=90)
if r.returncode:
 (W/'baseline-capture-error.txt').write_bytes(r.stderr);raise RuntimeError(r.stderr.decode()[-3000:])
(W/'baseline-capture.tar.gz').write_bytes(r.stdout);base=W/'baseline';base.mkdir(exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(r.stdout),mode='r:gz') as t:
 for m in t.getmembers():
  assert m.isfile() and not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts
  p=base/m.name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(t.extractfile(m).read())
report=json.loads((base/'live-baseline-current.json').read_text());(W/'live-baseline-current.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'capturedAtUtc':report['capturedAtUtc'],'HTML':report['beforeHtmlSha256'],'api':report['api'],'protectedAssets':len(report['baselineAssets']),'processCount':12,'coordinationActive':False,'recordWrites':0,'archiveSha256':hashlib.sha256(r.stdout).hexdigest()},indent=2))
