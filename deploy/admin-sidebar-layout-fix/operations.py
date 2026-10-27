from pathlib import Path
import json,hashlib,subprocess,fcntl,os,time,re,sys
ROOT=Path('/opt/ops/20261027-admin-sidebar-layout-fix');LIVE=Path('/opt/releases/20261018-multi-enterprise-v1/admin/dist/public');HTML=LIVE/'index.html';ROOT.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def run(a):return subprocess.check_output(a,text=True,timeout=40)
def pm2():return [{'id':x['pm_id'],'name':x['name'],'pid':x['pid'],'status':x['pm2_env'].get('status'),'script':x['pm2_env'].get('pm_exec_path'),'cwd':x['pm2_env'].get('pm_cwd')} for x in json.loads(run(['pm2','jlist']))]
def atomic(p,b,mode=0o644):t=p.with_suffix(p.suffix+'.sidebar-next');t.write_bytes(b);t.chmod(mode);os.replace(t,p)
def public(path):return run(['curl','-fsS','--max-time','10','--resolve','admin.51dianzi.com:443:127.0.0.1','https://admin.51dianzi.com'+path]).encode()
def check(s,except_html=False):
 for p,h in s['files'].items():
  if except_html and p==str(HTML):continue
  assert Path(p).is_file() and sha(p)==h,'protected file changed: '+p
 assert pm2()==s['processes'],'PM2 processes changed; stop without rollback of other work'
mode=sys.argv[1]
with open('/var/lock/dianzi51-public-deploy.lock','a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 if mode=='capture':
  assert not (ROOT/'before.json').exists(),'capture already exists; inspect before reusing'
  procs=pm2();files=[p for p in LIVE.rglob('*') if p.is_file()];files+=[Path('/etc/nginx/conf.d/dianzi51-admin-subdomain.conf'),Path('/opt/services/zhijie-access-v1/service.mjs'),Path('/etc/systemd/system/dianzi51-zhijie-access.service')]
  files += [Path(x['script']) for x in procs if x['script'] and Path(x['script']).is_file()]
  before=HTML.read_bytes();text=before.decode();links=re.findall(r'href="([^"]*ZhijieSidebar[^\"]*\.css)"',text);assert len(links)==1,'current unique sidebar CSS not found'
  s={'time':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'html':hashlib.sha256(before).hexdigest(),'oldCssUrl':links[0],'files':{str(p):sha(p) for p in files},'processes':procs}
  check(s);atomic(ROOT/'before-index.html',before,0o600);atomic(ROOT/'before.json',(json.dumps(s,indent=2)+'\n').encode(),0o600);print(json.dumps({'captured':True,'protectedFiles':len(s['files']),'oldCssUrl':links[0],'html':s['html']}));sys.exit()
 s=json.loads((ROOT/'before.json').read_text());m=json.loads((ROOT/'payload/manifest.json').read_text());asset=ROOT/'payload'/m['name'];assert re.fullmatch(r'AdminSidebar-layout-fixed-[0-9a-f]{16}\.css',m['name']);assert sha(asset)==m['sha256'];old=(ROOT/'before-index.html').read_bytes();text=old.decode();assert text.count('href="'+s['oldCssUrl']+'"')==1
 url='/assets/'+m['name'];new=text.replace('href="'+s['oldCssUrl']+'"','href="'+url+'"',1).encode();newhash=hashlib.sha256(new).hexdigest()
 if mode=='apply':
  assert not (ROOT/'applied.json').exists(),'already applied; do not repeat'
  check(s);target=LIVE/'assets'/m['name']
  if target.exists():assert sha(target)==m['sha256'],'CSS hash collision'
  else:atomic(target,asset.read_bytes())
  try:
   check(s);atomic(HTML,new);check(s,True)
   assert hashlib.sha256(public('/')).hexdigest()==newhash,'public HTML mismatch'
   assert hashlib.sha256(public(url)).hexdigest()==m['sha256'],'public CSS mismatch'
   receipt={'time':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'applied':True,'oldHtmlSha256':s['html'],'newHtmlSha256':newhash,'newCssUrl':url,'newCssSha256':m['sha256'],'protectedFiles':len(s['files'])-1,'originalFilesExceptHtmlUnchanged':True,'processesUnchanged':True,'databaseTouched':False,'scope':'One CSS link replacement only'}
   atomic(ROOT/'applied.json',(json.dumps(receipt,indent=2)+'\n').encode(),0o600);print(json.dumps(receipt))
  except Exception:
   if sha(HTML)==newhash:atomic(HTML,old)
   raise
 elif mode=='verify':
  check(s,True);assert sha(HTML)==newhash;assert hashlib.sha256(public(url)).hexdigest()==m['sha256'];print(json.dumps({'verified':True,'html':newhash,'protectedFiles':len(s['files'])-1,'processesUnchanged':True,'newCssUrl':url}))
 elif mode=='rollback':
  check(s,True);assert sha(HTML)==newhash,'HTML already changed by others; do not overwrite';atomic(HTML,old);check(s);print(json.dumps({'ownHtmlRestored':True,'noOtherFilesOrServicesChanged':True}))
 else:raise SystemExit('unknown operation')
