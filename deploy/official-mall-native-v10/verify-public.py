from pathlib import Path
import json,hashlib,requests,time
D=Path(__file__).resolve().parent;M=json.loads((D/'release-manifest.json').read_text());out=[]
def get(host,path):
 r=requests.get('https://'+host+path,headers={'Cache-Control':'no-cache, no-store','User-Agent':'51dianzi-official-mall-release-verifier/1.0'},timeout=35);return r
for f in M['replace']:
 if f['kind']!='html':continue
 r=get(f['host'],'/');r.raise_for_status();assert hashlib.sha256(r.content).hexdigest()==f['sha256'],'PUBLIC_HTML_DRIFT';out.append({'kind':'html','host':f['host'],'status':r.status_code,'sha256Matches':True})
for f in M['add']:
 if f['kind']!='static':continue
 r=get(f['host'],f['url']);r.raise_for_status();assert hashlib.sha256(r.content).hexdigest()==f['sha256'],'PUBLIC_RESOURCE_DRIFT';out.append({'kind':'resource','host':f['host'],'url':f['url'],'status':r.status_code,'sha256Matches':True})
for host,path in [('admin.51dianzi.com','officialMallPublic.list'),('51dianzi.com','officialMall.list')]:
 r=get(host,'/api/trpc/'+path+'?input='+requests.utils.quote(json.dumps({'json':{'page':1,'pageSize':30}},separators=(',',':'))));r.raise_for_status();x=r.json();data=x['result']['data']['json'];assert data['page']==1 and data['pageSize']==30;assert isinstance(data['items'],list)and isinstance(data['total'],int);out.append({'kind':'anonymousOfficialPublicRead','host':host,'status':r.status_code,'total':data['total'],'safeNativeSource':True,'noStore':r.headers.get('Cache-Control')})
for path in ['officialMall.status','officialMall.list']:
 r=get('admin.51dianzi.com','/api/trpc/'+path+('?input='+requests.utils.quote(json.dumps({'json':{}}))if path.endswith('.list')else''));assert r.status_code in [401,403];out.append({'kind':'anonymousManagementDenied','path':path,'status':r.status_code})
r=get('admin.51dianzi.com','/api/trpc/business.mallInventory.list?input='+requests.utils.quote(json.dumps({'json':{}})));assert r.status_code==404;out.append({'kind':'legacyWrongInventoryForwardingRetired','status':r.status_code})
r=get('admin.51dianzi.com','/workbench/mall-materials');r.raise_for_status();admin=next(x for x in M['replace']if x.get('host')=='admin.51dianzi.com');assert hashlib.sha256(r.content).hexdigest()==admin['sha256'];out.append({'kind':'nativeMallDeepLink','status':r.status_code,'sameFinalNativeAppHtml':True,'note':'HTTP success is not authenticated employee business verification'})
(D/'public-verification.json').write_text(json.dumps({'status':'verified','checks':out,'noAccountLoginOrBusinessWrites':True},ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':'verified','checks':len(out),'noBusinessWrites':True}))
