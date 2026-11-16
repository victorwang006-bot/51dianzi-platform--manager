from pathlib import Path
import subprocess,tarfile,json,hashlib
D=Path(__file__).resolve().parent;O=D/'package';root='/opt/ops/20261117-official-mall-native-v10';M=json.loads((O/'release-manifest.json').read_text());archive=D/'package-private.tar.gz'
for p,h in M['sourceHashes'].items():assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h,'SOURCE_DRIFT'
with tarfile.open(archive,'w:gz',compresslevel=6)as t:
 for p in sorted(O.rglob('*')):
  if p.is_file():t.add(p,arcname=str(p.relative_to(O)),recursive=False)
ssh=['ssh','-i','/home/ubuntu/.ssh/51-ecs.pem','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','ControlPath=none','-o','ConnectTimeout=15','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3','root@47.97.108.147']
remote=f"umask 077; mkdir -p {root}; test ! -e {root}/apply-attempt.json && tar -xzf - -C {root} && python3 {root}/release.py preflight --root {root}"
r=subprocess.run(ssh+[remote],input=archive.read_bytes(),capture_output=True,timeout=210);(D/'preflight-current.log').write_bytes(r.stdout+r.stderr);assert r.returncode==0,r.stderr.decode()[-700:]
r=subprocess.run(ssh+['cat '+root+'/preflight-result.json'],capture_output=True,timeout=30);assert r.returncode==0;(D/'preflight-result.json').write_bytes(r.stdout);x=json.loads(r.stdout);assert x['status']=='preflight-passed';print(json.dumps(x));(D/'stage-location.json').write_text(json.dumps({'root':root,'manifestSha256':hashlib.sha256((O/'release-manifest.json').read_bytes()).hexdigest()},indent=2)+'\n')
