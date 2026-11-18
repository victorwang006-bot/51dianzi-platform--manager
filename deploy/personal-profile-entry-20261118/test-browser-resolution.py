from pathlib import Path
from playwright.sync_api import sync_playwright
import importlib.util,json,re
W=Path('/home/ubuntu/work/profile-entry-20261118')
spec=importlib.util.spec_from_file_location('fix',W/'fix-profile-entry.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
origin='https://admin.51dianzi.com'
entry=m.PREFIX+'index-new-information-fa1a2d10a628ef49.js'
reports=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 for filename,expected in [('index.before.html','OLD'),('index.after.html','NEW')]:
  text=(W/filename).read_text();block=re.search(r'<script\b[^>]*type=["\x27]importmap["\x27][^>]*>[\s\S]*?</script>',text).group(0)
  html='<!doctype html><head>'+block+'</head><body><script type="module" src="'+entry+'"></script></body>'
  page=browser.new_page();requested=[]
  def intercept(route):
   url=route.request.url;requested.append(url)
   if url==origin+'/_profile_resolution_probe':route.fulfill(status=200,content_type='text/html',body=html)
   elif url==origin+entry:route.fulfill(status=200,content_type='text/javascript',body='const m=await import("./Profile-Bb1hTfdM.js");window.__profileProbe=m.marker;')
   elif url==origin+m.OLD:route.fulfill(status=200,content_type='text/javascript',body='export const marker="OLD";')
   elif url==origin+m.NEW:route.fulfill(status=200,content_type='text/javascript',body='export const marker="NEW";')
   else:route.abort()
  page.route('**/*',intercept);page.goto(origin+'/_profile_resolution_probe');page.wait_for_function('window.__profileProbe!==undefined',timeout=15000)
  result=page.evaluate('window.__profileProbe');assert result==expected,(filename,result,expected)
  profile_requests=[u for u in requested if 'Profile-'in u];assert profile_requests==[origin+(m.OLD if expected=='OLD'else m.NEW)]
  reports.append({'html':filename,'expected':expected,'actual':result,'actualLazyImporter':origin+entry,'nativeBrowserResolvedRequests':profile_requests,'productionNetworkIO':0});page.close()
 browser.close()
(W/'browser-resolution-result.json').write_text(json.dumps({'status':'passed','engine':'Chromium native scoped importmap resolution','checks':reports},indent=2)+'\n')
print('PASS native Chromium: actual lazy importer resolves OLD before / NEW after; all network intercepted')
