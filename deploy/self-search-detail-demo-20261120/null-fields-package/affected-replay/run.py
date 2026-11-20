#!/usr/bin/env python3
import asyncio, ast, hashlib, json, mimetypes, os, re, shutil, time, traceback
from pathlib import Path
from urllib.parse import urlsplit,parse_qs,unquote
import requests
import tempfile
from playwright.async_api import async_playwright
OUT=Path(__file__).resolve().parent
BASE=OUT.parent
CAND=BASE/'detail-native-null-fields/candidate-visual-final'
OLD=BASE/'native-browser-check'
ORIGIN='https://51dianzi.com'
ST='STM8S003F3P6TR'; W='W25N04KVZEIR'; DETAIL='/product/OM_bba7cf49-fd93-401e-bf11-8ac2ab33eb14'
sha=lambda b:hashlib.sha256(b).hexdigest()
def write(n,x): (OUT/n).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n')
def progress(s): print(time.strftime('%H:%M:%S'),s,flush=True)
manifest=json.loads((CAND/'manifest.json').read_text())
ASSETS={a['url']:a for a in manifest['assets']}; MEMORY={k:Path(v['local']).read_bytes() for k,v in ASSETS.items()}
HTML=(CAND/'index.html').read_bytes()
paths=[CAND/'manifest.json',CAND/'index.html',*[Path(a['local']) for a in ASSETS.values()],*[Path(manifest['input']['inputSourceDir'])/p for p in manifest['input']['files']],Path(manifest['input']['sourceShaFile']),BASE/'detail-native-null-fields/verify-nullfields.json',BASE/'detail-native-null-fields/readonly-nullfields.json']
def pins(): return {str(p):{'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size} for p in paths}
BEFORE=pins();write('source-pins-before.json',BEFORE)
assert len(ASSETS)==5 and len(manifest['input']['files'])==19
for k,a in ASSETS.items(): assert sha(MEMORY[k])==a['sha256'] and len(MEMORY[k])==a['size']
for p,h in manifest['input']['files'].items():assert sha((Path(manifest['input']['inputSourceDir'])/p).read_bytes())==h
assert manifest['input']['files']['client/src/components/OfficialMallSearchResults.tsx']=='3e3e355de1bccc0327318ef0a5139b2b28b79c072c91cd445e09474af04680bc'
assert BEFORE[str(CAND/'manifest.json')]['sha256']=='91863042689520a9f8b0cdf5f88d0575a96416f32b43482cb88044a589547c7e'
assert sha(HTML)=='349cbe260fe908ceb17fe4d04517f6c3ad043ec69d1cf8fe8324935c44a5c19f'
EVID=BASE/'existing-binary-dependencies/existing-binary-read.json'; e=json.loads(EVID.read_text());CACHE={}
for item in e['dependencies']:
 b=Path(item['local']).read_bytes(); assert sha(b)==item['sha256'] and len(b)==item['size'] and item['httpStatus']==200
 CACHE[item['url']]={'body':b,'mime':item['mime'],'proof':item}
write('existing-cache-pins.json',{'evidenceSHA256':sha(EVID.read_bytes()),'dependencies':e['dependencies']})
PRIOR=BASE/'native-browser-null-fields-retry/static-request-log.json'
for row in json.loads(PRIOR.read_text()):
 if row.get('status')!=200:continue
 b=Path(row['local']).read_bytes();assert sha(b)==row['bodySHA256'] and len(b)==row['bodySize']
 CACHE[urlsplit(row['url']).path]={'body':b,'mime':row['mime'],'proof':row}
write('additional-static-cache-pins.json',{'source':str(PRIOR),'sourceSHA':sha(PRIOR.read_bytes()),'entries':[{'url':row['url'],'sha256':row['bodySHA256'],'size':row['bodySize']}for row in json.loads(PRIOR.read_text())if row.get('status')==200]})

oldlog=json.loads((OLD/'request-log.json').read_text());csps=[r['originCSP'] for r in oldlog if 'originCSP' in r];assert csps and all(x is None for x in csps)
CSP=None
REPLAYS=[]
for f in ['public-dto-002.json','public-dto-004.json','public-dto-001.json']:
 p=OLD/f; d=json.loads(p.read_text()); u=urlsplit(d['url']); payload=json.loads(parse_qs(u.query)['input'][0]); b=json.dumps(d['body'],ensure_ascii=False,separators=(',',':')).encode()
 proof={'file':str(p),'fileSHA256':sha(p.read_bytes()),'url':d['url'],'procedure':unquote(u.path.removeprefix('/api/trpc/')),'decodedInput':payload,'originalWireSHA256':d['sha256'],'reencodedBodySHA256':sha(b),'wireHashDifferent':sha(b)!=d['sha256'],'parsedObjectDeepEquality':json.loads(b)==d['body'],'classification':'recorded-public-response-replay/NOT_FRESH_API'}
 REPLAYS.append({'data':d,'body':b,'proof':proof})
write('dto-replay-pins.json',[r['proof'] for r in REPLAYS])
# Reuse only the read-only DOM measurement expression and launch arguments, not old network behavior.
tree=ast.parse((OLD/'run.py').read_text());MEASURE=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='MEASURE' for t in n.targets))
launch=next(n for n in ast.walk(tree) if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute) and n.func.attr=='launch');ARGS=next(ast.literal_eval(k.value) for k in launch.keywords if k.arg=='args')
log=[];blocked=[];errors=[];console=[];snapshots=[];interactions=[];navpins=[];newstatic=[];inflight={}
receipt={'candidateInMemory':True,'productionApprovalGranted':False,'productionDeployment':False,'httpServicesStarted':0,'anonymousNewContext':True,'userProfileUsed':False,'cookieOrAccountStorageRead':False,'browserTransportFence':'all request interception + proxy 127.0.0.1:9 + MAP * ~NOTFOUND DNS deny','originCSP':CSP,'CSPSource':str(OLD/'request-log.json'),'navigationLimit':3,'webSocketPolicy':'all blocked','downloadsPolicy':'all blocked','DOMInjection':False,'routingHooksMockProviders':'none','remoteDebugging':'Playwright pipe only'}
sem=asyncio.Semaphore(24)
def static_allowed(url):
 u=urlsplit(url)
 return u.scheme=='https' and u.netloc=='51dianzi.com' and u.path.startswith('/assets/') and '..' not in unquote(u.path) and bool(re.search(r'\.(?:js|css|png|webp|jpe?g|gif|svg|ico|avif)$',u.path,re.I)) and u.path not in ASSETS

def request_once(url):
 assert static_allowed(url)
 r=requests.get(url,headers={'Accept':'*/*','Cache-Control':'no-cache','User-Agent':'Mozilla/5.0 Chromium anonymous static verification'},timeout=(5,12),allow_redirects=False)
 return r.status_code,dict(r.headers),r.content
async def fetch_static(url):
 raise RuntimeError('FULLY_OFFLINE_TARGETED_REPLAY_MISSING_STATIC:'+url)
async def abort(route,reason):
 r=route.request;rec={'url':r.url,'method':r.method,'resourceType':r.resource_type,'decision':reason,'transported':False,'at':time.time()};blocked.append(rec);log.append(rec)
 await route.abort('blockedbyclient')
async def handler(route):
 r=route.request;u=urlsplit(r.url)
 try:
  if r.method!='GET':return await abort(route,'blocked-all-non-GET')
  if u.scheme!='https' or u.netloc!='51dianzi.com':return await abort(route,'blocked-external-or-scheme')
  if r.resource_type=='document':
   if r.url not in {ORIGIN+'/search?q='+ST,ORIGIN+'/search?q='+W,ORIGIN+DETAIL}:return await abort(route,'blocked-unknown-document')
   body=HTML;mime='text/html; charset=utf-8';decision='exactHTML-memory-no-root-HTTP'
  elif u.path in ASSETS:
   body=MEMORY[u.path];mime='image/webp' if u.path.endswith('.webp') else 'text/javascript';decision='new5-exact-memory-never-publicGET'
  elif u.path.startswith('/api/trpc/'):
   proc=unquote(u.path.removeprefix('/api/trpc/'));q=parse_qs(u.query);match=None;isbatch=False
   try:
    inp=json.loads(q['input'][0])
    for replay in REPLAYS:
     if proc!=replay['proof']['procedure']:continue
     expected=replay['proof']['decodedInput']
     if inp==expected and not q.get('batch'):match=replay;break
     if q.get('batch')==['1'] and isinstance(inp,dict) and len(inp)==1 and next(iter(inp.values()))==expected:match=replay;isbatch=True;break
   except Exception:pass
   if not match:return await abort(route,'blocked-unsaved-or-nonexact-API-including-auth')
   body=json.dumps([match['data']['body']],ensure_ascii=False,separators=(',',':')).encode() if isbatch else match['body'];mime='application/json';decision='recorded-public-response-replay/NOT_FRESH_API'
   log.append({'url':r.url,'method':'GET','decision':decision,'transported':False,'source':match['proof']['file'],'decodedInputDeepEqual':True,'batchEncoding':isbatch,'bodySHA256':sha(body),'originalWireSHA256':match['proof']['originalWireSHA256']})
   return await route.fulfill(status=match['data']['status'],body=body,content_type=mime,headers={'Cache-Control':'no-store'})
  elif u.path in CACHE:
   x=CACHE[u.path];body=x['body'];mime=x['mime'];decision='existing-actual-GET-pinned-51-map'
  elif static_allowed(r.url):
   if r.url not in inflight:inflight[r.url]=asyncio.create_task(fetch_static(r.url))
   x=await inflight[r.url];body=x['body'];mime=x['mime'];decision='new-static-cached-pinned'
  else:return await abort(route,'blocked-unknown-path-or-API-image-or-font')
  log.append({'url':r.url,'method':'GET','resourceType':r.resource_type,'decision':decision,'transported':False,'status':200,'bodySHA256':sha(body),'bodySize':len(body),'mime':mime})
  await route.fulfill(status=200,body=body,content_type=mime,headers={'Cache-Control':'no-store'})
 except Exception as ex:
  errors.append({'type':'route','url':r.url,'message':str(ex)})
  try:await route.abort('failed')
  except Exception:pass
async def sample(page,name):
 d=await page.evaluate(MEASURE);d['allDTNames']=await page.locator('dt').all_text_contents();d['name']=name;snapshots.append(d);write(name+'-dom.json',d)
 (OUT/(name+'-native-dom.html')).write_text(await page.content())
 await page.screenshot(path=str(OUT/(name+'-replay-notproduction.png')),full_page=True,timeout=10000)
 progress(name+' cards='+str(len(d['cards'])));return d
async def ready(page,part,detail=False):
 selector='.opd-root .omr-card-detail' if detail else '.omr-card'
 await page.wait_for_function("([s,p])=>[...document.querySelectorAll(s)].some(e=>e.innerText.includes(p))",arg=[selector,part],timeout=26000)
async def nav(page,part):
 assert len(navpins)<3;current=pins();assert current==BEFORE
 navpins.append({'type':'document-navigation','url':ORIGIN+'/search?q='+part,'pinsUnchanged':True,'at':time.time()});write('navigation-pins.json',navpins)
 async def go():
  await page.goto(ORIGIN+'/search?q='+part,wait_until='domcontentloaded',timeout=28000)
  await ready(page,part)
 await asyncio.wait_for(go(),30)
async def main():
 browser=None;context=None;fatal=None
 tmp=Path(tempfile.mkdtemp(prefix='omr-nf-',dir='/tmp'));os.environ['TMPDIR']=str(tmp)
 pre={int(p.name) for p in Path('/proc').iterdir() if p.name.isdigit()}
 try:
  async with async_playwright() as p:
   browser=await p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,timeout=20000,args=ARGS)
   owned=[]
   for proc in Path('/proc').iterdir():
    if not proc.name.isdigit() or int(proc.name) in pre:continue
    try:cmd=(proc/'cmdline').read_bytes().decode(errors='replace').replace('\0',' ')
    except Exception:continue
    if str(tmp) in cmd and 'chromium' in cmd:owned.append({'pid':int(proc.name),'cmdline':cmd})
   receipt.update(browserVersion=browser.version,ownedChromiumProcesses=owned,profilePaths=sorted(set(re.findall(r'--user-data-dir=([^ ]+)', ' '.join(x['cmdline'] for x in owned)))))
   context=await browser.new_context(viewport={'width':1280,'height':1000},device_scale_factor=1,service_workers='block',accept_downloads=False)
   await context.route('**/*',handler)
   async def wsblock(ws):
    blocked.append({'url':ws.url,'method':'WebSocket','decision':'blocked-WebSocket','transported':False});await ws.close()
   await context.route_web_socket('**/*',wsblock)
   page=await context.new_page();page.set_default_timeout(10000)
   async def cancel_download(d):
    blocked.append({'url':d.url,'method':'download','decision':'blocked-download','transported':False});await d.cancel()
   page.on('download',cancel_download)
   page.on('pageerror',lambda e:errors.append({'type':'pageerror','message':str(e)}))
   page.on('console',lambda m:console.append({'type':m.type,'text':m.text,'location':m.location}))
   assert DETAIL in json.dumps(json.loads((OLD/'native-validation-result.json').read_text()),ensure_ascii=False)
   progress('targeted ST detail direct navigation; previously observed real public Link')
   navpins.append({'type':'previously-observed-public-detail-direct-document','url':ORIGIN+DETAIL,'pinsUnchanged':pins()==BEFORE});write('navigation-pins.json',navpins)
   await page.goto(ORIGIN+DETAIL,wait_until='domcontentloaded',timeout=25000);await ready(page,ST,True)
   await sample(page,'st-detail-1280');await page.set_viewport_size({'width':375,'height':1000});await sample(page,'st-detail-375');await page.set_viewport_size({'width':1280,'height':1000})
   progress('W25 recorded-public-list replay');await nav(page,W);await sample(page,'w25-search-1280');await page.set_viewport_size({'width':375,'height':1000});await sample(page,'w25-search-375')
 except BaseException as ex:
  fatal=traceback.format_exc();errors.append({'type':'fatal','message':str(ex),'stack':fatal});progress(fatal)
  if context:
   try:await sample(context.pages[0],'blocked-final')
   except Exception:pass
 finally:
  if context:
   try:await context.close();receipt['contextClosed']=True
   except Exception as ex:receipt['contextCloseError']=str(ex)
  if browser:
   try:await browser.close();receipt['browserClosed']=True
   except Exception as ex:receipt['browserCloseError']=str(ex)
  if inflight:await asyncio.gather(*inflight.values(),return_exceptions=True)
  await asyncio.sleep(.3)
  receipt['processCleanup']=[{'pid':x['pid'],'absent':not Path('/proc',str(x['pid'])).exists()} for x in receipt.get('ownedChromiumProcesses',[])]
  receipt['allOwnedChromiumPIDsAbsent']=bool(receipt.get('ownedChromiumProcesses')) and all(x['absent'] for x in receipt['processCleanup'])
  for path in receipt.get('profilePaths',[]):
   q=Path(path)
   if q.is_relative_to(tmp):shutil.rmtree(q,ignore_errors=True)
  shutil.rmtree(tmp,ignore_errors=True);receipt['profilesRemoved']=all(not Path(q).exists() for q in receipt.get('profilePaths',[]));receipt['tmpRemoved']=not tmp.exists()
  after=pins();write('source-pins-after.json',after);receipt['allSourcesAndCandidateUnchanged']=after==BEFORE
  write('request-log.json',log);write('blocked-attempts.json',blocked);write('static-request-log.json',newstatic);write('browser-errors.json',errors);write('console-log.json',console);write('interactions.json',interactions);write('process-cleanup-receipt.json',receipt)
  write('raw-result.json',{'fatal':fatal,'snapshots':[d['name'] for d in snapshots],'receipt':receipt,'errors':errors,'actualNetworkCount':sum(x.get('transported',False) for x in log),'staticOnly':all(static_allowed(x['url']) and x['method']=='GET' for x in log if x.get('transported')),'navigationCount':len(navpins),'originCSP':None})
  progress('DONE native run; allOwnedPIDsAbsent='+str(receipt['allOwnedChromiumPIDsAbsent']))
if __name__=='__main__':asyncio.run(main())
