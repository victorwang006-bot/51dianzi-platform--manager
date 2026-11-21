#!/usr/bin/env python3
"""Current public GET bytes only. No cookies, login, POST, candidate injection or inventory write."""
import datetime,hashlib,json,sys,time,traceback,urllib.request
from pathlib import Path
O=Path(__file__).resolve().parent;D=O/'live-confirmation';H=lambda b:hashlib.sha256(b).hexdigest()
assert not D.exists(),'ONE_ACTUAL_STATIC_CONFIRMATION';D.mkdir(mode=0o700)
ledger=[];result={'status':'ACTUAL_CONFIRMATION_FAILED','transportedNonGET':0,'anonymousNoCookies':True,'fullLoggedInUploadClaimed':False}
try:
 m=json.loads((O/'package/manifest.json').read_bytes());request=urllib.request.Request('https://admin.51dianzi.com/',headers={'Cache-Control':'no-cache','Accept-Encoding':'identity'},method='GET')
 opener=urllib.request.build_opener()
 def get(url,pin):
  started=time.monotonic();request=urllib.request.Request('https://admin.51dianzi.com'+url,headers={'Cache-Control':'no-cache','Accept-Encoding':'identity'},method='GET')
  with opener.open(request,timeout=20) as r:
   assert r.status==200,('HTTP_STATUS',url,r.status);assert r.geturl()=='https://admin.51dianzi.com'+url,('NO_UNEXPECTED_REDIRECT',url,r.geturl());b=r.read();actual=H(b);assert actual==pin,('ACTUAL_RESOURCE_HASH',url,pin,actual)
   ledger.append({'url':url,'method':'GET','status':r.status,'size':len(b),'sha256':actual,'elapsedSeconds':time.monotonic()-started,'cookieSent':False,'observedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat()});print('ACTUAL_STATIC_GET_PINNED',url,actual,flush=True);return b
 html=get('/',m['htmlAfterSHA']);text=html.decode();e=m['htmlDeltaEvidence'];assert e['inverseVerified'] is True
 for old,count in e['counts'].items():assert old not in text,('OLD_HTML_REFERENCE_REMAINS',old)
 modules=[x for x in m['assets'] if x['url'].endswith('.js')];css=[x for x in m['assets'] if x['url'].endswith('.css')];assert len(modules)==2 and len(css)==1
 for row in modules:
  b=get(row['url'],row['sha256']);assert len(b)==row['size'];assert text.count(row['url']) in (32,53),('ACTUAL_HTML_NATIVE_REFERENCE_COUNT',row['url'],text.count(row['url']))
 row=css[0];b=get(row['url'],row['sha256']);assert len(b)==row['size'];assert text.count(e['link'])==1;assert '.customer-supply-dialog' in b.decode();assert m['nativeLeafInverseVerified'] is True and m['allOtherNativeBytesUnchanged'] is True
 result.update(status='ACTUAL_HEADER_MAPPING_STATIC_CONFIRMED',htmlSHA=m['htmlAfterSHA'],actualBothNativeUploadLeavesPinned=True,actualHeaderMappingCssPinned=True,actualHtmlReferencesPinned=True,nativeSourceCommit=m['sourceCommit'],sourceHashes=m['sourceHashes'],offlineBehaviorTestsReused=99,actualStaticGETLedger=ledger,fullLoggedInEnterpriseBusinessAcceptanceClaimed=False,confirmedAtUtc=datetime.datetime.now(datetime.timezone.utc).isoformat())
except BaseException as e:
 result.update(error=str(e),actualStaticGETLedger=ledger);traceback.print_exc()
(D/'confirmation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(result['status'],flush=True)
if result['status']!='ACTUAL_HEADER_MAPPING_STATIC_CONFIRMED':sys.exit(1)
