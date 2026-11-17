from pathlib import Path
import json,subprocess,hashlib,time
D=Path(__file__).resolve().parent;s=json.loads((D/'stage-location.json').read_text());root=s['root'];assert json.loads((D/'preflight-result.json').read_text())['status']=='preflight-passed';assert hashlib.sha256((D/'package/release-manifest.json').read_bytes()).hexdigest()==s['manifestSha256'];M=json.loads((D/'package/release-manifest.json').read_text())
for p,h in M['sourceHashes'].items():assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h,'SOURCE_DRIFT'
assert not (D/'apply-sent.json').exists(),'SINGLE_APPLY_ALREADY_SENT';(D/'apply-sent.json').write_text(json.dumps({'sentAt':time.time(),'root':root},indent=2)+'\n')
ssh=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ControlPath=none','-o','ConnectTimeout=15','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3','root@47.97.108.147'];cmd=f'python3 {root}/release.py apply --root {root}'
r=subprocess.run(ssh+[cmd],capture_output=True,timeout=450);(D/'apply-current.log').write_bytes(r.stdout+r.stderr)
read=subprocess.run(ssh+['cat '+root+'/apply-result.json'],capture_output=True,timeout=35);assert read.returncode==0,'APPLY_STATE_UNKNOWN_READ_ONLY_CHECK_REQUIRED';(D/'apply-result.json').write_bytes(read.stdout);x=json.loads(read.stdout);print(json.dumps(x));assert r.returncode==0 and x['status']=='applied','APPLY_FAILED_OR_UNKNOWN_DO_NOT_RESEND'
