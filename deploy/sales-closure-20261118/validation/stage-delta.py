#!/usr/bin/env python3
from pathlib import Path
import base64,hashlib,json,shutil,tarfile,sys,re
H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
W=Path('/home/ubuntu/work/sales-20261117')
STAGE=Path('/opt/backups/sales-closure-20261117-yOJKWq2D').resolve()
name=sys.argv[2] if len(sys.argv)>2 else 'release-final-0108'
assert re.fullmatch(r'release-final-[0-9]{4}',name),'Fresh stage name'
if sys.argv[1]=='pack':
 old,new=W/'release-final-0054',W/name
 oldfiles={str(p.relative_to(old)):H(p) for p in old.rglob('*') if p.is_file()}
 files={str(p.relative_to(new)):H(p) for p in new.rglob('*') if p.is_file()}
 changed=[p for p,h in files.items() if oldfiles.get(p)!=h and not(p.startswith('assets/')and p.endswith('.js'))]
 plan={'oldManifestSha256':H(old/'manifest.json'),'manifestSha256':H(new/'manifest.json'),'files':files,'remove':sorted(set(oldfiles)-set(files))}
 (W/'stage-delta-plan.json').write_text(json.dumps(plan)+'\n')
 with tarfile.open(W/(name+'.delta.tar.gz'),'w:gz') as t:
  for p in changed:t.add(new/p,arcname=p,recursive=False)
  t.add(W/'stage-delta-plan.json',arcname='stage-delta-plan.json',recursive=False)
 print(json.dumps({'status':'delta-packed','changedFiles':len(changed),'bytes':(W/(name+'.delta.tar.gz')).stat().st_size}))
elif sys.argv[1]=='hydrate':
 old,new=STAGE/'release-final-0054',STAGE/name
 assert not new.exists() and not(old/'apply-attempt.json').exists(),'Inactive fresh stage required'
 with tarfile.open(STAGE/(name+'.delta.tar.gz'),'r:gz') as t:
  plan=json.load(t.extractfile('stage-delta-plan.json'))
  assert H(old/'manifest.json')==plan['oldManifestSha256'],'Old staging manifest drift'
  shutil.copytree(old,new)
  for rel in plan['remove']+['preflight-result.json','review.json','verify-result.json']:
   p=new/rel;assert not Path(rel).is_absolute()and '..'not in Path(rel).parts and p.resolve().is_relative_to(new)
   if p.is_file():p.unlink()
  for m in t.getmembers():
   if m.name=='stage-delta-plan.json':continue
   assert m.isreg()and m.name in plan['files']and not Path(m.name).is_absolute()and'..'not in Path(m.name).parts
   p=new/m.name;assert p.resolve().is_relative_to(new)and not p.is_symlink();p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(t.extractfile(m).read());p.chmod(0o600)
 assert H(new/'manifest.json')==plan['manifestSha256'],'Final staging manifest drift'
 ui=json.loads((new/'evidence/ui-source-manifest.json').read_text())
 for m in ui['modules']:
  prefix='/home/ubuntu/work/sales-20261117/live/extracted';assert m['input'].startswith(prefix+'/opt/releases/')
  source=Path(m['input'][len(prefix):]);assert source.name.startswith('BusinessWorkbenchPage-unified-bugfix-')and'/admin/dist/public/assets/'in str(source)
  b=source.read_bytes();assert hashlib.sha256(b).hexdigest()==m['beforeSha256'],'Actual immutable UI preimage drift'
  name=Path(m['newURL']).name;d=json.loads((new/('evidence/ui-'+name+'.delta.json')).read_text())
  for p in reversed(d['patches']):
   before=base64.b64decode(p['oldBase64']);assert b[p['byteStart']:p['byteEnd']]==before,'Exact hunk preimage'
   b=b[:p['byteStart']]+base64.b64decode(p['newBase64'])+b[p['byteEnd']:]
  assert hashlib.sha256(b).hexdigest()==m['afterSha256'],'Rebuilt asset SHA'
  (new/'assets'/name).write_bytes(b)
 for rel,h in plan['files'].items():assert H(new/rel)==h,'Staging payload drift '+rel
 print(json.dumps({'status':'inactive-stage-hydrated','manifestSha256':plan['manifestSha256'],'filesChecked':len(plan['files']),'noActiveCodeWrites':True}))
else:raise ValueError('mode')
