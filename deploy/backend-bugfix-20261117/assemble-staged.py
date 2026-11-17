#!/usr/bin/env python3
"""Staging-only reconstruction. Reads protected baselines; never changes a production target."""
from pathlib import Path
import argparse,base64,hashlib,json,os
H=lambda b:hashlib.sha256(b).hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--root',required=True);a=p.parse_args();R=Path(a.root).resolve()
 assert R==Path('/opt/backups/backend-bugfix-20261117-wHi4Q2Ds/release').resolve(),'STAGE_ONLY'
 m=json.loads((R/'manifest.json').read_text());assert m['scope']=='backend-bugfix-20261117' and m['noBusinessDml'] and m['noDDL']
 units=[]
 for f in m['replace']:
  if f['kind']!='api':continue
  name='front-api-delta.json' if f['processName']=='dianzi51' else 'admin-api-delta.json'
  units.append((f,Path(f['target']),json.loads((R/'evidence'/name).read_text())))
 oldUrls={'/assets/BusinessWorkbenchPage-company-stock-sales-ac088da77867d88b.js','/assets/BusinessWorkbenchPage-company-stock-sales-bebb998997257a8c.js'}
 for p in (R/'evidence').glob('BusinessWorkbenchPage-unified-bugfix-*.js.delta.json'):
  d=json.loads(p.read_text());assert d['oldUrl'] in oldUrls
  f=[f for f in m['add'] if f['kind']=='asset' and Path(f['target']).name==Path(d['url']).name];assert len(f)==1
  baseline=Path(m['adminHtmlTarget']).parent/d['oldUrl'].lstrip('/')
  units.append((f[0],baseline,d))
 assert len(units)==4
 for f,base,d in units:
  assert str(base).startswith('/opt/releases/') and not base.is_symlink()
  b=base.read_bytes();assert H(b)==d.get('beforeSha256',d.get('baselineSha256')),'EXACT_BASELINE_REQUIRED'
  if f['kind']=='api':assert H(b)==f['beforeSha256']
  edits=[]
  for q in d.get('patches',d.get('hunks',[])):
   if 'oldByteStart' in q:st,en=q['oldByteStart'],q['oldByteEnd'];old,new=base64.b64decode(q['oldBase64']),base64.b64decode(q['newBase64'])
   else:st,en=q['start'],q['end'];old,new=q['before'].encode(),q['after'].encode()
   assert b[st:en]==old;edits.append((st,en,old,new))
  edits.sort(key=lambda x:(x[0],x[1]))
  for prev,next in zip(edits,edits[1:]):assert next[0]>=prev[1],'NO_OVERLAP'
  result=b
  for st,en,old,new in reversed(edits):result=result[:st]+new+result[en:]
  assert H(result)==f['sha256'],'FROZEN_CANDIDATE_HASH_REQUIRED'
  dest=R/f['source'];assert not Path(f['source']).is_absolute() and '..' not in Path(f['source']).parts and dest.resolve().is_relative_to(R) and not dest.is_symlink()
  assert not dest.exists(),'STAGED_CANDIDATE_COLLISION'
  dest.parent.mkdir(parents=True,exist_ok=True)
  fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,'wb') as out:out.write(result);out.flush();os.fsync(out.fileno())
  assert H(dest.read_bytes())==f['sha256']
 print(json.dumps({'status':'staged-candidates-reconstructed','count':len(units),'frozenHashesVerified':True,'productionTargetsUntouched':True}))
if __name__=='__main__':main()
