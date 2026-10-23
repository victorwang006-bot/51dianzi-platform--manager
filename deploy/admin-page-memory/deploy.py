#!/usr/bin/env python3
"""Atomic update of the actual admin Nginx static root only; no business writes."""
from pathlib import Path
import hashlib,json,os,subprocess,sys
R=Path(__file__).resolve().parent
KEY=os.environ.get('D51_MEMORY_SSH_KEY','')
HOST='root@47.97.108.147'
LIVE='/opt/releases/20261018-multi-enterprise-v1/admin/dist/public'
OPS='/opt/ops/20261024-admin-page-memory-final'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def ssh(command,input=None):
 return subprocess.run(['ssh','-i',KEY,'-o','BatchMode=yes',HOST,command],input=input,text=True,check=True,capture_output=True).stdout
def scp(source,target):subprocess.run(['scp','-q','-i',KEY,str(source),HOST+':'+target],check=True)
REMOTE=r'''
from pathlib import Path
import fcntl,hashlib,json,os,subprocess,sys,time
root=Path('/opt/ops/20261024-admin-page-memory-final');p=json.loads((root/'release-plan.json').read_text());live=Path(p['live']);sha=lambda f:hashlib.sha256(Path(f).read_bytes()).hexdigest()
def processes():
 result=json.loads(subprocess.check_output(['pm2','jlist'],text=True,timeout=20));return [{'name':x['name'],'id':x['pm_id'],'pid':x['pid'],'cwd':x['pm2_env'].get('pm_cwd'),'status':x['pm2_env']['status'],'started':x['pm2_env'].get('pm_uptime'),'restarts':x['pm2_env'].get('restart_time')} for x in result]
def check(files):
 for file,digest in files.items():assert sha(file)==digest,'PROTECTED_CHANGED '+file
 assert processes()==p['processes'],'PROCESS_CHANGED'
 for file,target in p['pointers'].items():assert str(Path(file).resolve())==target,'POINTER_CHANGED '+file
 return len(files)
def http(path):return subprocess.check_output(['curl','-fsS','--max-time','20','--resolve','admin.51dianzi.com:443:127.0.0.1','https://admin.51dianzi.com'+path],timeout=25)
def payload():
 for name,digest in p['changed'].items():assert sha(root/'payload'/name)==digest,'INPUT_HASH '+name
 assert p['changed']['index.html']==p['htmlSha256']
mode=sys.argv[1]
if mode=='stage':
 payload();count=check(p['before']);assert sha(live/'index.html')==p['oldHtmlSha256'];print(json.dumps({'stageOnly':True,'protectedPassed':count,'noProductionActivation':True}));sys.exit(0)
if mode=='verify':
 assert sha(live/'index.html')==p['htmlSha256'];count=check(p['after']);print(json.dumps({'verified':True,'protectedPassed':count,'htmlSha256':p['htmlSha256'],'processesUnchanged':True}));sys.exit(0)
assert mode=='apply'
with open('/var/lock/dianzi51-public-deploy.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);assert not (root/'applied.json').exists(),'ALREADY_APPLIED';payload();count=check(p['before']);assert sha(live/'index.html')==p['oldHtmlSha256']
 for name,digest in p['changed'].items():
  if name=='index.html':continue
  destination=live/name;assert name.startswith('assets/') and destination.parent==live/'assets';destination.parent.mkdir(exist_ok=True)
  if destination.exists():assert sha(destination)==digest,'HASH_COLLISION'
  else:
   temp=destination.with_suffix('.next');temp.write_bytes((root/'payload'/name).read_bytes());temp.chmod(0o644);os.replace(temp,destination)
 backup=root/'before-index.html';assert not backup.exists();backup.write_bytes((live/'index.html').read_bytes());assert sha(backup)==p['oldHtmlSha256']
 check(p['before']);nextfile=live/'.admin-page-memory-next.html';nextfile.write_bytes((root/'payload/index.html').read_bytes());nextfile.chmod(0o644);assert sha(nextfile)==p['htmlSha256'];os.replace(nextfile,live/'index.html')
 count=check(p['after']);assert hashlib.sha256(http('/merchants?page=12')).hexdigest()==p['htmlSha256']
 for name,digest in p['changed'].items():assert hashlib.sha256(http('/'+name)).hexdigest()==digest,'LIVE_HTTP '+name
 result={'applied':True,'time':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'live':str(live),'ops':str(root),'htmlSha256':p['htmlSha256'],'oldHtmlSha256':p['oldHtmlSha256'],'changed':p['changed'],'imports':p['imports'],'main':p['main'],'core':p['core'],'runtime':p['runtime'],'protectedAfter':p['after'],'postChecks':{'hashesPassed':count,'processesUnchanged':True,'nginxAndBackendsUnchanged':True,'crmUntouched':True},'scope':p['scope']}
 temp=root/'applied.next.json';temp.write_text(json.dumps(result,indent=2)+'\n');os.replace(temp,root/'applied.json');print(json.dumps({'APPLY_OK':True,'htmlSha256':p['htmlSha256'],'protectedPassed':count,'newJS':4,'processesUnchanged':True}))
'''
if __name__=='__main__':
 mode=sys.argv[1]
 if mode=='prepare':
  m=json.loads((R/'dist/manifest.json').read_text())
  previous=Path(os.environ.get('D51_CRM_RECEIPT','/home/ubuntu/crm-page-memory-v2/evidence/release-result.json'))
  protected=json.loads(previous.read_text())['protectedAfter']
  script="""from pathlib import Path
import hashlib,json,subprocess
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
live=Path('/opt/releases/20261018-multi-enterprise-v1/admin/dist/public')
files={str(p):sha(p) for p in live.rglob('*') if p.is_file()}
for p in Path('/etc/nginx/conf.d').glob('*'):
 if p.is_file() and p.suffix in ('.conf','.inc'):files[str(p)]=sha(p)
rows=json.loads(subprocess.check_output(['pm2','jlist'],text=True,timeout=20));processes=[{'name':x['name'],'id':x['pm_id'],'pid':x['pid'],'cwd':x['pm2_env'].get('pm_cwd'),'status':x['pm2_env']['status'],'started':x['pm2_env'].get('pm_uptime'),'restarts':x['pm2_env'].get('restart_time')} for x in rows]
pointers={str(p):str(p.resolve()) for p in Path('/opt/apps').glob('dianzi51*') if p.is_symlink()}
print(json.dumps({'files':files,'processes':processes,'pointers':pointers}))
"""
  snapshot=json.loads(ssh('python3 -',script));before={**protected,**snapshot['files']};assert before[LIVE+'/index.html']==m['oldHtmlSha256'];changed={'index.html':m['newHtmlSha256'],**{'assets/'+f['name']:f['sha256'] for f in m['files']}};after={**before,**{LIVE+'/'+n:h for n,h in changed.items()}}
  plan={'live':LIVE,'ops':OPS,'oldHtmlSha256':m['oldHtmlSha256'],'htmlSha256':m['newHtmlSha256'],'changed':changed,'before':before,'after':after,'processes':snapshot['processes'],'pointers':snapshot['pointers'],'imports':m['imports'],'main':m['main'],'core':m['core'],'runtime':m['runtime'],'scope':m['scope']};(R/'release-plan.json').write_text(json.dumps(plan,indent=2)+'\n');(R/'remote-apply.py').write_text(REMOTE);print(json.dumps({'prepared':True,'beforeProtected':len(before),'afterProtected':len(after),'htmlSha256':m['newHtmlSha256'],'newJS':len(m['files'])}))
 elif mode=='stage':
  p=json.loads((R/'release-plan.json').read_text());ssh('mkdir -p '+OPS+'/payload/assets');scp(R/'release-plan.json',OPS+'/release-plan.json');scp(R/'remote-apply.py',OPS+'/remote-apply.py');scp(R/'dist/index.html',OPS+'/payload/index.html')
  for f in json.loads((R/'dist/manifest.json').read_text())['files']:scp(R/'dist'/f['name'],OPS+'/payload/assets/'+f['name'])
  print(ssh('python3 '+OPS+'/remote-apply.py stage'))
 elif mode in ('apply','verify'):
  print(ssh('python3 '+OPS+'/remote-apply.py '+mode));
  if mode=='apply':subprocess.run(['scp','-q','-i',KEY,HOST+':'+OPS+'/applied.json',str(R/'evidence/release-result.json')],check=True)
 else:raise ValueError('prepare|stage|apply|verify')
