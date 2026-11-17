from pathlib import Path
import json,hashlib,requests
D=Path(__file__).resolve().parent;m=json.loads((D/'manifest.json').read_text());state=D/'public-verification.json';checks=json.loads(state.read_text())if state.exists()else{};session=requests.Session();session.headers.update({'User-Agent':'51Dianzi-Readonly-Release-Verification/1.0'});H=lambda b:hashlib.sha256(b).hexdigest()
for label,path,expected in [('business-order-page','/workbench/sales-orders',m['newHtmlSha256']),('purchase-demand-page','/workbench/procurement-demands',m['newHtmlSha256'])]+[(a['newUrl'],a['newUrl'],a['afterSha256'])for a in m['modules']]:
 if checks.get(label,{}).get('status')=='PASS':continue
 r=session.get('https://admin.51dianzi.com'+path,timeout=60);assert r.status_code==200 and H(r.content)==expected,{'label':label,'status':r.status_code,'hash':H(r.content),'expected':expected}
 if path.endswith('.js'):
  s=r.content.decode();assert '__niPageRows=($.data.items??[])'not in s and '__niPageRows=(Ee.data.items??[])'not in s and '__niPageRows=(Dt.data.items??[])'not in s
  checks[label]={'status':'PASS','sha256':H(r.content),'actualOrderGuardPresent':True}
 else:checks[label]={'status':'PASS','sha256':H(r.content)}
 state.write_text(json.dumps(checks,indent=2)+'\n');print('PASS '+label,flush=True)
print(json.dumps({'status':'public-static-verified','checks':len(checks),'noOrderMutation':True}),flush=True)
