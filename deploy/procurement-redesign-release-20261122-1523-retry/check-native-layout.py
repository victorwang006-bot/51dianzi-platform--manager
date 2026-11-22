#!/usr/bin/env python3
from pathlib import Path
import hashlib,json,re
from playwright.sync_api import sync_playwright
W=Path(__file__).resolve().parent;I=Path('/home/ubuntu/work/demand-redesign-implementation-20261122-1302'); E=W/'evidence/native-layout';E.mkdir(parents=True,exist_ok=True)
r=json.loads((W/'capture/records.json').read_text()); nm=json.loads((W/'notification-candidate/manifest.json').read_text());html=(W/'capture/admin-html.html').read_text();urls=re.findall(r'<link\b[^>]*rel=["\x27]stylesheet["\x27][^>]*href=["\x27]([^"\x27]+)',html)
root='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'
by={v['path'][len(root):]:v for v in r.values() if v['path'].startswith(root)}
csspaths=[Path(by[u]['local'])for u in urls];assert len(csspaths)==51
# Preserve live lazy CSS, which loads after head links; new scoped notification rules must survive it.
lazy=[Path(v['local'])for v in r.values()if v['path'].endswith('.css') and any(x in v['path']for x in ['DashboardLayout','BusinessWorkbenchPage'])]
suffix=Path(next(a['local']for a in nm['assets']if a['url']==nm['cssURL']))
css='\n'.join(p.read_text()for p in csspaths+[suffix]+lazy)
proc=(I/'frontend/dom-fixture.html').read_text().replace('</head>','<style>'+css.replace('</style','<\\/style')+'</style></head>').replace('<body>','<body><div class="admin-workspace-shell" data-admin-layout="top-two-level-v1">').replace('</body>','</div></body>')
fixtures=json.loads((I/'notification/layout-fixtures.json').read_text())
out={'status':'OFFLINE_NATIVE_CAPTURE_CSS_SYNTHETIC_DOM_NOT_AUTHENTICATED_PRODUCTION','cssPins':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}for p in csspaths+[suffix]+lazy],'procurement':[],'notification':[],'networkRequests':0,'limitations':'Actual captured native CSS plus exact proposed suffix and existing lazy Dashboard CSS. DOM from real source mocked procurement/NI fixtures; not a logged-in live header.'}
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-background-networking']);c=b.new_context();c.route('**/*',lambda route:(out.update(networkRequests=out['networkRequests']+1),route.abort()));p=c.new_page()
 for width in [1560,1280,390]:
  p.set_viewport_size({'width':width,'height':844});p.set_content(proc,wait_until='load')
  v=p.evaluate('''()=>{const r=n=>{const a=n.getBoundingClientRect();return {left:a.left,right:a.right,width:a.width}};const t=document.querySelector('.procurement-demands-table'),s=document.querySelector('.procurement-demands-table-scroll');return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,table:r(t),scroll:r(s),groups:t.querySelectorAll('thead th').length,rows:[...t.querySelectorAll('tbody tr')].map(n=>{const c=n.querySelector('td:last-child'),a=c.querySelector('button'),m=n.querySelector('.procurement-demand-model');return {actions:c.querySelectorAll('button').length,button:r(a),cell:r(c),modelFits:m.scrollWidth<=m.clientWidth+1}})}}''')
  assert v['pageWidth']<=width+1 and v['groups']==5 and v['table']['width']>=919,v
  for q in v['rows']:assert q['actions']==1 and q['modelFits'] and q['button']['left']>=q['cell']['left'] and q['button']['right']<=q['cell']['right']+1,q
  out['procurement'].append(v)
  for f in fixtures:
   body='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css.replace('</style','<\\/style')+'</style></head><body>'+f['html']+'</body></html>';p.set_content(body,wait_until='load')
   v=p.evaluate('''()=>{const r=n=>{const a=n.getBoundingClientRect();return {left:a.left,right:a.right,top:a.top,bottom:a.bottom,width:a.width}};return {modules:[...document.querySelectorAll('.admin-workspace-nav__tab')].map(n=>{const s=n.querySelector('.admin-new-information-nav-slot'),b=s.querySelector('[data-admin-new-information]'),l=n.querySelector('[data-fixture-label]');return {slot:r(s),label:r(l),badge:b?r(b):null,position:b?getComputedStyle(b).position:null}})}}''')
   for q in v['modules']:
    assert abs(q['slot']['width']-32)<.1 and q['label']['right']<=q['slot']['left']+.1,q
    if q['badge']:assert q['position']=='static' and q['badge']['left']>=q['slot']['left']-.1 and q['badge']['right']<=q['slot']['right']+.1 and abs(q['badge']['top']+q['badge']['bottom']-q['label']['top']-q['label']['bottom'])<1,q
   out['notification'].append({'state':f['name'],'viewport':width,**v})
  print('PASS native captured CSS geometry',width,flush=True)
 assert out['networkRequests']==0,out['networkRequests'];b.close()
(E/'results.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print('PASS 3 procurement + 27 NI cases; 0 network; synthetic DOM limits retained')
