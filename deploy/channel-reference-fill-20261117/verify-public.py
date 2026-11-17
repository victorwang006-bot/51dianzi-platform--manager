from pathlib import Path
import json,hashlib,requests,time
D=Path(__file__).resolve().parent;M=json.loads((D/'release-manifest.json').read_text());P=D/'public-verification.json';out=json.loads(P.read_text())if P.exists()else{'checks':[]};s=requests.Session();s.headers.update({'User-Agent':'51Dianzi-Readonly-Release-Verification/1.0','Accept':'application/json,text/html,*/*','X-Business-Merchant-Id':'1'})
def done(k):return any(x['key']==k and x.get('passed')for x in out['checks'])
def save(k,data):out['checks'].append(dict(key=k,passed=True,**data));P.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print('PASS',k,flush=True)
def get(url,**kw):
 err=None
 for i in range(3):
  try:return s.get(url,timeout=45,**kw)
  except requests.RequestException as e:err=e;time.sleep(1+i)
 raise err
for f in M['replace']+M['add']:
 if f['kind']not in ['html','static']:continue
 host=f.get('host','admin.51dianzi.com');url='https://'+host+('/'if f['kind']=='html'else f['source'].removeprefix('static'));k='resource:'+url
 if done(k):continue
 r=get(url,params={'release_verification':'channel-reference-inbound-documents-v2'});assert r.status_code==200 and hashlib.sha256(r.content).hexdigest()==f['sha256'],'PUBLIC_RESOURCE_MISMATCH:'+url;save(k,{'status':r.status_code,'sha256':f['sha256']})
key='inbound-documents/1/2/11111111-1111-4111-8111-111111111111_abcd1234.png'
for host,prefix in [('admin.51dianzi.com','business.'),('51dianzi.com','')]:
 for label,method,input in [('documents','documents',{'id':1}),('preview','documentAccess',{'id':1,'key':key,'mode':'preview'}),('download','documentAccess',{'id':1,'key':key,'mode':'download'})]:
  k='anonymous-denied:'+host+'/'+label
  if done(k):continue
  r=get('https://'+host+'/api/trpc/'+prefix+'inbound.'+method,params={'input':json.dumps({'json':input})});body=r.text.upper();assert r.status_code in[401,403]and('UNAUTHORIZED'in body or'FORBIDDEN'in body)and'NOT_FOUND'not in body and'BAD_REQUEST'not in body,'READ_GATE_FAILURE:'+host+'/'+label+':'+str(r.status_code);save(k,{'status':r.status_code,'noPrivateRead':True})
 k='anonymous-save-documents-denied:'+host
 if not done(k):
  r=s.post('https://'+host+'/api/trpc/'+prefix+'inbound.saveDocuments',json={'json':{'id':1,'documents':[]}},timeout=30);body=r.text.upper();assert r.status_code in[401,403]and('UNAUTHORIZED'in body or'FORBIDDEN'in body)and'NOT_FOUND'not in body and'BAD_REQUEST'not in body,'WRITE_GATE_FAILURE:'+host+':'+str(r.status_code);save(k,{'status':r.status_code,'unauthenticatedSyntheticOnly':True,'noSaveOrderOrUpload':True})
k='public-image-proxy-private-directory-denied'
if not done(k):
 r=get('https://51dianzi.com/api/img',params={'src':'https://dianzi51-assets.oss-cn-hangzhou.aliyuncs.com/'+key+'?Expires=1&Signature=synthetic-not-valid'});assert r.status_code==403,'PRIVATE_PROXY_FAILURE';save(k,{'status':403,'privateDirectoryBlockedBeforeUpstreamAndCache':True})
out.update(status='passed',noAuthenticatedBusinessWriteTest=True,noRealContractsBankReceiptsOrOrdersCreated=True);P.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print('PUBLIC_COMBINED_VERIFICATION_PASSED',len(out['checks']))
