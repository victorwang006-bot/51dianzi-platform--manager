from pathlib import Path
import json,subprocess,tarfile,io,hashlib
D=Path(__file__).resolve().parent;root='/opt/ops/20261117-orders-undefined-fix';m=json.loads((D/'manifest.json').read_text());ssh=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ControlPath=none','-o','ConnectTimeout=15','root@47.97.108.147'];buf=io.BytesIO()
assert not (D/'apply-sent.json').exists()
for p,h in m['sourceHashes'].items():assert hashlib.sha256((Path('/home/ubuntu/work/51dianzi-platform--manager')/p).read_bytes()).hexdigest()==h,'SOURCE_DRIFT'
with tarfile.open(fileobj=buf,mode='w:gz')as tar:
 for p,n in [(D/'manifest.json','manifest.json'),(D/'apply.py','apply.py'),(D/'candidate/index.html','index.html')]+[(Path(a['newLocal']),Path(a['newUrl']).name)for a in m['modules']]:tar.add(p,arcname=n)
print(json.dumps({'phase':'upload-small-private-static-package','bytes':len(buf.getvalue())}),flush=True)
remote=f'umask 077; mkdir -p {root}; test ! -e {root}/apply-attempt.json && tar xzf - -C {root}'
subprocess.run(ssh+[remote],input=buf.getvalue(),check=True,timeout=180)
print('private static package uploaded; read-only preflight',flush=True)
code='''from pathlib import Path
import json,hashlib,subprocess
R=Path(ROOT);m=json.loads((R/'manifest.json').read_text());S=Path(m['staticRoot']);H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert not (R/'apply-attempt.json').exists();assert H(S/'index.html')==m['oldHtmlSha256'] and H(R/'index.html')==m['newHtmlSha256'];compile((R/'apply.py').read_text(),'apply.py','exec')
for a in m['modules']:
 assert H(S/a['oldUrl'].lstrip('/'))==a['beforeSha256'] and H(R/Path(a['newUrl']).name)==a['afterSha256'];subprocess.run(['node','--input-type=module','--check'],input=(R/Path(a['newUrl']).name).read_bytes(),capture_output=True,check=True)
ps=json.loads(subprocess.check_output(['pm2','jlist']));assert len(ps)==12 and all(p['pm2_env']['status']=='online'for p in ps)
print(json.dumps({'status':'preflight-passed','currentHtmlAndTwoModuleHashMatched':True,'syntaxPassed':True,'moduleCount':2,'functionCount':4,'processCount':12}))
'''.replace('ROOT',repr(root))
r=subprocess.run(ssh+['python3 -'],input=code.encode(),capture_output=True,timeout=90);(D/'preflight.log').write_bytes(r.stdout+r.stderr);assert r.returncode==0,r.stderr.decode()[-1000:];x=json.loads(r.stdout);(D/'preflight.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps(x),flush=True)
