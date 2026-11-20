import sys,shutil,json,hashlib
from pathlib import Path
R=Path('/home/ubuntu/work/resume-frontend')
sys.path.insert(0,str(R/'controller-r2'))
import release as c,certify as q
out=R/'upload-r2';out.mkdir(exist_ok=True);(out/'tools').mkdir(exist_ok=True)
for name in c.SOURCE_NAMES+('certify.py',):
    dst=out/'controller'/name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(R/'controller-r2'/name,dst)
shutil.copy2(R/'close-recovery.py',out/'controller/close-recovery.py')
shutil.copy2(R/'private-launch.py',out/'private-launch.py')
b=json.loads((R/'r2-build/manifest.json').read_bytes())
worker=next(f for f in b['files'] if f['role']=='runtime-worker')
shutil.copy2(R/'r2-build'/worker['packageFile'],out/'tools'/Path(worker['path']).name)
for name in ['source-verifier','prewarm-verifier']:
    shutil.copy2(R/'r2-build/evidence'/f'{name}.mjs',out/'tools'/f'{name}.mjs')
shutil.copy2(R/'r2-build/prepare-complaint-datasheets.mjs',out/'tools/prepare-complaint-datasheets.mjs')
H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
pins={p.relative_to(out).as_posix():H(p) for p in (out/'tools').iterdir()}
(out/'tools-pins.json').write_text(json.dumps(pins,sort_keys=True,indent=2)+'\n')
allpins={p.relative_to(out).as_posix():H(p) for p in out.rglob('*') if p.is_file()}
(R/'upload-r2-pins.json').write_text(json.dumps(allpins,sort_keys=True,indent=2)+'\n')
inv={'certifierSha256':q.certifier_bundle()['certifierSha256'],'wrapperSha256':H(R/'close-recovery.py'),'launcherSha256':H(R/'private-launch.py')}
(R/'recovery-invocation-pins.json').write_text(json.dumps(inv,indent=2)+'\n')
assert all((out/'controller'/n).is_file() for n in c.SOURCE_NAMES)
print(json.dumps({'files':len(allpins),'invocationPins':inv},indent=2))
