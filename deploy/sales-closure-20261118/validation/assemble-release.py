#!/usr/bin/env python3
from pathlib import Path
import argparse,hashlib,json,shutil,sys
W=Path('/home/ubuntu/work/sales-20261117')
H=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(p,x):Path(p).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def main():
 p=argparse.ArgumentParser();p.add_argument('--api',required=True);p.add_argument('--ui',required=True);p.add_argument('--out',required=True);a=p.parse_args()
 A,U,R=map(lambda x:Path(x).resolve(),[a.api,a.ui,a.out])
 assert not R.exists(),'Fresh release directory required'
 am,um=json.loads((A/'manifest.json').read_text()),json.loads((U/'manifest.json').read_text())
 for m in[am,um]:
  for f,h in m['sourceHashes'].items():assert H(f)==h,'Source drift: '+f
 assert (A/'evidence/api-execution-check.json').exists(),'API execution validation required'
 assert json.loads((A/'evidence/api-execution-check.json').read_text())['status']=='passed'
 assert (U/'ui-check-results.json').exists(),'UI execution validation required'
 assert json.loads((U/'ui-check-results.json').read_text())['failed']==0,'UI validation failed'
 assert (U/'index.html').exists(),'Current rewritten HTML required'
 R.mkdir(mode=0o700);(R/'api').mkdir();(R/'assets').mkdir();(R/'runtime').mkdir();(R/'evidence').mkdir();(R/'sources').mkdir()
 controller=W/'manager/deploy/backend-bugfix-20261117/controller.py';shutil.copy2(controller,R/'controller.py');shutil.copy2(W/'live/current-protection.json',R/'protection.json')
 B=json.loads((R/'protection.json').read_text());replace=[];add=[];public=[]
 targets={'front':'/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js','admin':'/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js'}
 for role,target in targets.items():
  f=A/'api'/f'{role}-index.js';dest=R/'api'/f.name;shutil.copy2(f,dest);assert am['api'][role]['beforeSha256']==B['files'][target]
  replace.append({'source':str(dest.relative_to(R)),'target':target,'kind':'api','sha256':H(dest),'beforeSha256':B['files'][target],'processName':'dianzi51' if role=='front'else'dianzi51-admin'})
 htmlTarget='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public/index.html';shutil.copy2(U/'index.html',R/'index.html');replace.append({'source':'index.html','target':htmlTarget,'kind':'html','sha256':H(R/'index.html'),'beforeSha256':B['files'][htmlTarget]})
 assert H(W/'live/admin.html')==B['files'][htmlTarget]
 for f in sorted((A/'runtime').iterdir()):
  assert f.is_file();shutil.copy2(f,R/'runtime'/f.name);add.append({'source':'runtime/'+f.name,'target':'/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/runtime/'+f.name,'kind':'runtime','sha256':H(f)})
 # Contracts are needed in both actual API release roots. Other native runtimes stay front-only.
 ct=am['compiled']['contracts']['name'];add.append({'source':'runtime/'+ct,'target':'/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/runtime/'+ct,'kind':'runtime','sha256':H(A/'runtime'/ct)})
 for f in sorted((U/'assets').iterdir()):
  assert f.is_file()and f.suffix in{'.js','.css'};shutil.copy2(f,R/'assets'/f.name);add.append({'source':'assets/'+f.name,'target':'/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public/assets/'+f.name,'kind':'asset','sha256':H(f)});public.append({'url':'/assets/'+f.name,'sha256':H(f)})
 evidence=[]
 for prefix,folder in [('api',A/'evidence'),('ui',U/'evidence')]:
  for f in sorted(folder.iterdir()):
   if not f.is_file():continue
   dest=R/'evidence'/(prefix+'-'+f.name);shutil.copy2(f,dest);evidence.append({'source':str(dest.relative_to(R)),'sha256':H(dest)})
 for name,m in [('api-source-manifest.json',am),('ui-source-manifest.json',um)]:save(R/'evidence'/name,m);evidence.append({'source':'evidence/'+name,'sha256':H(R/'evidence'/name)})
 shutil.copy2(U/'ui-check-results.json',R/'evidence/ui-execution-check.json');evidence.append({'source':'evidence/ui-execution-check.json','sha256':H(R/'evidence/ui-execution-check.json')})
 sources={}
 for m in[am,um]:
  for f,h in {**m['sourceHashes'],**m['toolHashes']}.items():
   if f in sources:assert sources[f]==h
   sources[f]=h
 for f in ['validation/check-api-candidate.mjs','validation/assemble-release.py','packaging/check-current-ui.mjs','packaging/current-tools/native-dom-harness.mjs']:
  sources[str(W/f)]=H(W/f)
 frozen=[]
 for f,h in sorted(sources.items()):
  fp=Path(f)
  if not any(fp.is_relative_to(W/x) for x in['platform','manager','packaging','validation']):continue
  rel=fp.relative_to(W);dest=R/'sources'/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(fp,dest);assert H(dest)==h;frozen.append({'source':str(dest.relative_to(R)),'sha256':h})
 m={'scope':'backend-bugfix-20261117','taskScope':'sales-closure-20261117-yOJKWq2D','authorizationRef':'Current user explicitly approved stock association, concise order UI, searchable stock dropdown, persistent/server drafts and true sales reservation fixes','noBusinessDml':True,'noDDL':True,'noGrantEdits':True,'databaseMigrationSeparate':True,'inventoryReconciliationAlreadySeparatelyVerified':True,'adminHtmlTarget':htmlTarget,'reloadNames':['dianzi51','dianzi51-admin'],'replace':replace,'add':add,'publicAssets':public,'controllerSha256':H(R/'controller.py'),'protectionSha256':H(R/'protection.json'),'evidence':evidence,'frozenSources':frozen}
 save(R/'manifest.json',m);save(R/'assembly-result.json',{'status':'assembled-not-reviewed-not-deployed','manifestSha256':H(R/'manifest.json'),'sourceCount':len(frozen),'addFiles':len(add),'replaceFiles':len(replace)})
 print(json.dumps({'status':'assembled-not-reviewed-not-deployed','root':str(R),'manifestSha256':H(R/'manifest.json'),'sourceCount':len(frozen),'addFiles':len(add),'replaceFiles':len(replace)}))
if __name__=='__main__':main()
