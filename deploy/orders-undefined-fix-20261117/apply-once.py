from pathlib import Path
import json,subprocess,hashlib,time
D=Path(__file__).resolve().parent;m=json.loads((D/'manifest.json').read_text());p=json.loads((D/'preflight.json').read_text());v=json.loads((D/'verification.json').read_text());assert p['status']=='preflight-passed' and v['status']=='passed';assert v['manifestSha256']==hashlib.sha256((D/'manifest.json').read_bytes()).hexdigest();assert not (D/'apply-sent.json').exists()
for path,h in m['sourceHashes'].items():assert hashlib.sha256((Path('/home/ubuntu/work/51dianzi-platform--manager')/path).read_bytes()).hexdigest()==h,'SOURCE_DRIFT'
ssh=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ControlPath=none','-o','ConnectTimeout=15','root@47.97.108.147'];root='/opt/ops/20261117-orders-undefined-fix'
(D/'apply-sent.json').write_text(json.dumps({'sentAt':time.time(),'singleApplyOnly':True})+'\n');print('one authorized static apply sent',flush=True)
r=subprocess.run(ssh+[f'python3 {root}/apply.py'],capture_output=True,timeout=120);(D/'apply.log').write_bytes(r.stdout+r.stderr)
assert r.returncode==0,r.stderr.decode()[-1600:];x=json.loads(r.stdout);assert x['status']=='deployed';(D/'apply-result.json').write_text(json.dumps(x,indent=2)+'\n');print(json.dumps(x),flush=True)
