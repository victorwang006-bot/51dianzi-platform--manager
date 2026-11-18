#!/usr/bin/env python3
from pathlib import Path
import argparse,base64,fcntl,hashlib,json,os,re,subprocess
ROOT=Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
TARGET=ROOT/'index.html'
PREFIX='/assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/'
REQUEST=PREFIX+'Profile-Bb1hTfdM.js'
OLD=PREFIX+'Profile-profile-staff-89e21d19ad99792f57a8435442f7e9be1f765f5ab7b263e0110aa445c2ee9b73.js'
NEW=PREFIX+'Profile-personal-business-3ba04bab14ab3934e2d628e40420f20b8a8ec6a0579458055d2a28a8ad64f009.js'
EXPECTED='490acea37ec380048e289eb1ab5f29558b5aee2222f735f595cdad285559066f'
H=lambda b:hashlib.sha256(b).hexdigest()
def proof(b):
 text=b.decode();maps=list(re.finditer(r'<script\b[^>]*type=[\"\x27]importmap[\"\x27][^>]*>([\s\S]*?)</script>',text));found=[]
 for match in maps:
  data=json.loads(match.group(1));imports=data.get('imports',{})
  if REQUEST in imports:found.append((match,imports))
 assert len(found)==1,'One actual requested Profile importmap required'
 return found[0]
def build(b):
 assert H(b)==EXPECTED,'Latest HTML CAS preimage changed'
 match,imports=proof(b);assert imports[REQUEST]==OLD
 pattern=r'("(?:\\.|[^"\\])*")\s*:\s*("(?:\\.|[^"\\])*")'
 values=[v for v in re.finditer(pattern,match.group(1)) if json.loads(v.group(1))==REQUEST and json.loads(v.group(2))==OLD];assert len(values)==4
 original=json.loads(match.group(1));scopes={k:v[REQUEST] for k,v in original.get('scopes',{}).items()if REQUEST in v};assert len(scopes)==3 and all(v==OLD for v in scopes.values())
 before=b.decode();after=before
 for value in reversed(values):
  start=match.start(1)+value.start(2);end=match.start(1)+value.end(2);after=after[:start]+json.dumps(NEW)+after[end:]
 out=after.encode()
 _,nextmap=proof(out);assert nextmap[REQUEST]==NEW
 assert {k:v for k,v in imports.items()if k!=REQUEST}=={k:v for k,v in nextmap.items()if k!=REQUEST}
 newmatch,_=proof(out);updated=json.loads(newmatch.group(1));expected=json.loads(match.group(1));expected['imports'][REQUEST]=NEW
 for scope in scopes:expected['scopes'][scope][REQUEST]=NEW
 assert updated==expected,'Every other global and scoped mapping preserved'
 reverse=after;offset=0;positions=[]
 for value in values:
  start=match.start(1)+value.start(2)+offset;positions.append((start,value.group(2)));offset+=len(json.dumps(NEW))-len(value.group(2))
 for start,oldraw in reversed(positions):reverse=reverse[:start]+oldraw+reverse[start+len(json.dumps(NEW)):]
 assert reverse.encode()==b
 return out,{'requested':REQUEST,'beforeTarget':OLD,'afterTarget':NEW,'beforeSha256':H(b),'afterSha256':H(out),'otherMappingsAndBytesPreserved':True,'patchCount':4,'scopeCount':3}
def run(args):return subprocess.check_output(args,stderr=subprocess.PIPE,timeout=30)
def processes():
 return sorted([{'id':x['pm_id'],'name':x['name'],'pid':x['pid'],'status':x['pm2_env']['status'],'script':x['pm2_env']['pm_exec_path'],'cwd':x['pm2_env']['pm_cwd'],'environmentSha256':H((Path('/proc')/str(x['pid'])/'environ').read_bytes())}for x in json.loads(run(['pm2','jlist']))],key=lambda x:x['id'])
def atomic(data):
 assert not TARGET.is_symlink()
 tmp=TARGET.with_name('index.html.profile-entry-yOJKWq2D.next')
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o644)
 with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
 os.replace(tmp,TARGET)
 fd=os.open(TARGET.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def apply(stage):
 stage=Path(stage).resolve();assert stage==Path('/opt/backups/profile-entry-20261118-yOJKWq2D').resolve(),'Exact private canonical stage scope'
 locks=[]
 try:
  for name in ['/var/lock/dianzi51-public-deploy.lock','/var/lock/dianzi51-production-code.lock']:
   f=open(name,'a');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
  assert not(stage/'attempt.json').exists(),'Single attempt only'
  before=TARGET.read_bytes();after,record=build(before)
  codepaths=['/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js','/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js']
  protected={str(ROOT/url.lstrip('/')):H((ROOT/url.lstrip('/')).read_bytes())for url in [OLD,NEW,'/assets/profile-personal-business-14204a7659639fa0e9cc9c334534cf8b98224c3f386cf1f35f473483989a7e66.css','/assets/BusinessWorkbenchPage-inventory-source-read-590bd5b997e31a09.js','/assets/BusinessWorkbenchPage-inventory-source-read-64fbe16f1df802a0.js']}
  assert protected[str(ROOT/NEW.lstrip('/'))]=='3ba04bab14ab3934e2d628e40420f20b8a8ec6a0579458055d2a28a8ad64f009'
  scripts=re.findall(r'<script\b[^>]*\bsrc=[\"\x27]([^\"\x27]+)',before.decode());entries=[]
  for url in scripts:
   p=ROOT/url.lstrip('/')
   if p.is_file() and 'profile:()=>ue(()=>import("./Profile-Bb1hTfdM.js")' in p.read_text():entries.append(p)
  assert len(entries)==1,'Original actual lazy profile request must be proven'
  for p in entries+list(map(Path,codepaths)):protected[str(p)]=H(p.read_bytes())
  ps=processes();assert len(ps)==12 and all(p['status']=='online'for p in ps)
  (stage/'index.before.html').write_bytes(before);(stage/'index.after.html').write_bytes(after)
  (stage/'attempt.json').write_text(json.dumps(record)+'\n')
  try:
   assert TARGET.read_bytes()==before;atomic(after)
   served=run(['curl','-fsS','--compressed','--max-time','15','--resolve','admin.51dianzi.com:443:127.0.0.1','https://admin.51dianzi.com/']);assert H(served)==H(after),'HTTPS served HTML must match'
   _,resolved=proof(served);assert resolved[REQUEST]==NEW
   assert processes()==ps,'No process restart/change allowed'
   assert all(H(Path(p).read_bytes())==h for p,h in protected.items()),'No API or asset changes allowed'
   receipt={**record,'status':'applied-and-verified','apiFilesUnchanged':True,'processesUnchanged':True,'databaseAccessed':False,'httpServedSha256':H(served)}
   (stage/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
  except Exception:
   # os.replace can commit before a following directory fsync raises.
   # Ownership is proven by the exact target hash, not a post-return flag.
   if H(TARGET.read_bytes())==H(after):atomic(before)
   raise
 finally:
  for f in reversed(locks):f.close()
def main():
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['build','apply']);p.add_argument('--root',required=True);a=p.parse_args();stage=Path(a.root)
 if a.mode=='build':
  before=(stage/'index.before.html').read_bytes();after,r=build(before);(stage/'index.after.html').write_bytes(after);(stage/'delta.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
 else:apply(stage)
if __name__=='__main__':main()
