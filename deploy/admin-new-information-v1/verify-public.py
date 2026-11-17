from pathlib import Path
import json,hashlib,requests,time
D=Path(__file__).resolve().parent;M=json.loads((D/'release-manifest.json').read_text());P=D/'public-verification.json';out=json.loads(P.read_text())if P.exists()else{'checks':[]};s=requests.Session();s.headers.update({'User-Agent':'51Dianzi-Readonly-Release-Verification/1.0','Accept':'application/json,text/html,*/*'})
def done(k):return any(x['key']==k and x.get('passed')for x in out['checks'])
def save(k,data):out['checks'].append(dict(key=k,passed=True,**data));P.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print('PASS',k,flush=True)
def get(url,**kw):
 err=None
 for i in range(3):
  try:return s.get(url,timeout=25,**kw)
  except requests.RequestException as e:err=e;time.sleep(1+i)
 raise err
for f in M['replace']+M['add']:
 if f['kind']not in['html','static']:continue
 url='https://'+f['host']+(f.get('url')or'/');key='resource:'+url
 if done(key):continue
 r=get(url,params={'release_verification':'admin-new-information-v1'});assert r.status_code==200,'HTTP_STATUS:'+url+':'+str(r.status_code);assert hashlib.sha256(r.content).hexdigest()==f['sha256'],'PUBLIC_SHA_MISMATCH:'+url;save(key,{'status':r.status_code,'sha256':f['sha256'],'bytes':len(r.content)})
nav=json.loads((D/'static-navigation/manifest.json').read_text());pages=json.loads((D/'static-pages/manifest.json').read_text());html=get('https://admin.51dianzi.com/workbench/mall-materials',params={'release_verification':'admin-new-information-v1'});assert html.status_code==200 and hashlib.sha256(html.content).hexdigest()==pages['finalHtmlSha256'];save('native-mall-route',{'status':200,'currentHeaderAndIndependentMallPreserved':True})if not done('native-mall-route')else None
for host,path in [('admin.51dianzi.com','newInformation.summary'),('admin.51dianzi.com','business.customer.newInformationFacts'),('51dianzi.com','customer.newInformationFacts')]:
 key='anonymous-denied:'+host+'/'+path
 if done(key):continue
 r=get('https://'+host+'/api/trpc/'+path,params={}if path.endswith('summary')else{'input':json.dumps({'json':{'refs':[]}})});body=r.text.upper();assert r.status_code in[401,403]and('UNAUTHORIZED'in body or'FORBIDDEN'in body)and'NOT_FOUND'not in body and'BAD_REQUEST'not in body,'ANONYMOUS_GATE_FAILURE:'+path+':'+str(r.status_code);save(key,{'status':r.status_code,'noAuthenticatedSourceRead':True})
key='anonymous-markDisplayed-denied'
if not done(key):
 r=s.post('https://admin.51dianzi.com/api/trpc/newInformation.markDisplayed',json={'json':{'receipts':['opaque-not-an-authenticated-signed-receipt']}},timeout=25);body=r.text.upper();assert r.status_code in[401,403]and('UNAUTHORIZED'in body or'FORBIDDEN'in body)and'NOT_FOUND'not in body and'BAD_REQUEST'not in body;save(key,{'status':r.status_code,'noNativeAccountNoMetadataAcknowledgement':True})
out.update(status='passed',noRealAccountBusinessWriteTest=True,anonymousRequestsOnly=True,noCustomersStocksOrdersOrPaymentsCreated=True);P.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print('PUBLIC_VERIFICATION_PASSED',len(out['checks']))
