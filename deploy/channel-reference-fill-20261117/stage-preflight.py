from pathlib import Path
import subprocess,json,hashlib
D=Path(__file__).resolve().parent;O=D/'package';root='/opt/ops/20261117-channel-reference-fill-v1';M=json.loads((O/'release-manifest.json').read_text());archive=D/'package-private.tar.gz';freeze=json.loads((D/'freeze-final.json').read_text());H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert H(archive)==freeze['packageSha256'] and H(O/'release-manifest.json')==freeze['manifestSha256']
for p,h in M['sourceHashes'].items():assert H(p)==h,'SOURCE_DRIFT'
ssh=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ControlPath=none','-o','ConnectTimeout=15','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3','root@47.97.108.147']
remote=f"umask 077; mkdir -p {root}; test ! -e {root}/apply-attempt.json && tar -xzf - -C {root} && python3 {root}/release.py preflight --root {root}"
print('PRIVATE_COMPRESSED_STAGE_BEGIN',archive.stat().st_size,'bytes','NO_APPLY/NO_DB/NO_RELOAD',flush=True)
r=subprocess.run(ssh+[remote],input=archive.read_bytes(),capture_output=True,timeout=240);(D/'preflight-current.log').write_bytes(r.stdout+r.stderr);assert r.returncode==0,r.stderr.decode()[-700:]
r=subprocess.run(ssh+['cat '+root+'/preflight-result.json'],capture_output=True,timeout=35);assert r.returncode==0;(D/'preflight-result.json').write_bytes(r.stdout);x=json.loads(r.stdout);assert x['status']=='preflight-passed';print(json.dumps(x));(D/'stage-location.json').write_text(json.dumps({'root':root,'manifestSha256':H(O/'release-manifest.json')},indent=2)+'\n')
