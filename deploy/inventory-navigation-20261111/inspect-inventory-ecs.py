#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,stat,subprocess
ROOT=Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
COORD=Path('/opt/ops/51-project-release-coordination-20261027.json')
PROTECTED=[COORD,Path('/root/.pm2/dump.pm2'),Path('/etc/nginx/conf.d/dianzi51-https.conf'),Path('/etc/nginx/conf.d/dianzi51-admin-subdomain.conf'),Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js'),Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js'),Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html')]
PREFIX='assets/20261106-one-click-review-images-v11-admin-4ebf4856da0f/'
ASSETS=['DashboardLayout-demand-navigation-0573716bc08061ed.js','BusinessWorkbenchPage-demand-navigation-1afdb6c381dcfc25.js','index-demand-navigation-bb20946d992bbfe5.js','procurement-demands-navigation-403b8716333e170e.css']
def sha(b):return hashlib.sha256(b).hexdigest()
def state(p):
 assert p.is_file() and not p.is_symlink()
 s=p.stat();return {'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid,'size':s.st_size,'mtimeNs':s.st_mtime_ns,'sha256':sha(p.read_bytes())}
pm=json.loads(subprocess.run(['pm2','jlist'],capture_output=True,check=True,timeout=20).stdout)
processes=sorted([{'name':p['name'],'pid':p['pid'],'status':p.get('pm2_env',{}).get('status'),'script':p.get('pm2_env',{}).get('pm_exec_path'),'cwd':p.get('pm2_env',{}).get('pm_cwd'),'uptime':p.get('pm2_env',{}).get('pm_uptime')} for p in pm],key=lambda p:(p['name'],p['pid']))
result={'protectedFiles':{str(p):state(p) for p in PROTECTED},'processes':processes,'coordSha256':sha(COORD.read_bytes()),'sharedReleaseActive':json.loads(COORD.read_bytes()).get('shared_release_active'),'adminIndexSha256':sha((ROOT/'index.html').read_bytes()),'baselineAssets':{n:sha((ROOT/PREFIX/n).read_bytes()) for n in ASSETS},'readOnly':True}
print(json.dumps(result,indent=2))
