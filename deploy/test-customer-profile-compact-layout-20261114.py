#!/usr/bin/env python3
"""Pixel/layout measurements from actual candidate React DOM; no production login or writes."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
W=Path('/home/ubuntu/work/customer-profile-compact');B=W/'baseline';C=W/'candidate'
def page_html(snapshot,new=False):
 css='\n'.join((B/u.lstrip('/')).read_text() for u in json.loads((W/'visual-styles.json').read_text()))
 if new:css+='\n'+(C/json.loads((C/'css-build-proof.json').read_text())['url'].lstrip('/')).read_text()
 return '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body data-admin-readability="true"><div class="admin-workspace-shell__main">'+(C/snapshot).read_text()+'</div></body></html>'
def metric(page):
 return page.evaluate('''()=>{const rect=s=>{const n=document.querySelector(s);if(!n)return null;const r=n.getBoundingClientRect(),c=getComputedStyle(n);return {x:r.x,y:r.y,width:r.width,height:r.height,display:c.display,paddingLeft:c.paddingLeft,paddingTop:c.paddingTop,marginBottom:c.marginBottom,textAlign:c.textAlign}};return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,base:rect('#customer-base'),heading:rect('#customer-base h2'),contacts:rect('#customer-contacts'),follow:rect('#customer-followups'),contactRows:[...document.querySelectorAll('.customer-workbench-contacts article')].map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,display:getComputedStyle(n).display}}),sectionCount:document.querySelectorAll('#customer-panel-company > section').length,editor:rect('#customer-base-editor')}}''')
def main():
 results=[];blocked=[]
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  for width in [1440,390]:
   page=browser.new_page(viewport={'width':width,'height':1000},device_scale_factor=1)
   page.route('**/*',lambda route:(blocked.append(route.request.url),route.abort()))
   page.set_content(page_html('visual-before-collapsed.html'),wait_until='domcontentloaded');before=metric(page)
   page.set_content(page_html('visual-after-collapsed.html',True),wait_until='domcontentloaded');after=metric(page)
   page.screenshot(path=str(C/f'layout-after-{width}.png'),full_page=True)
   try:
    assert after['sectionCount']==2,'Only customer profile and followups cards'
    assert after['scrollWidth']<=width+2,'No horizontal overflow'
    assert after['base']['width']>=width-40,'Full-width card, not centered narrow block'
    assert 10<=after['heading']['x']-after['base']['x']<=20,'Title consistently left aligned 12–16px padding'
    assert after['contacts']['display']!='none' and len(after['contactRows'])==2,'Contacts visible while basic fields collapsed'
    assert after['base']['height']<before['base']['height']+before['contacts']['height'],'Merged card uses less height than old two cards'
    if width>680:assert all(r['height']<72 for r in after['contactRows']),'Desktop contact rows compact'
    page.set_content(page_html('visual-after-expanded.html',True),wait_until='domcontentloaded');expanded=metric(page)
    assert expanded['editor'] and expanded['editor']['display']!='none','Original editor expands'
    assert expanded['contacts']['display']!='none' and len(expanded['contactRows'])==2,'Contacts retained expanded'
    assert expanded['base']['height']>after['base']['height'],'Expanded card grows naturally'
    assert expanded['scrollWidth']<=width+2,'Expanded form no horizontal overflow'
    results.append({'width':width,'status':'PASS','before':before,'after':after,'expanded':expanded})
   except AssertionError as e:results.append({'width':width,'status':'FAIL','error':str(e),'before':before,'after':after})
   page.close()
  browser.close()
 report={'status':'PASS' if all(r['status']=='PASS' for r in results) else 'FAIL','actualCandidateDOM':True,'original23StylesAndScopedIncrement':True,'offlineChromium':True,'productionLoginUsed':False,'productionRecordWrites':0,'externalRequestsBlocked':len(blocked),'results':results,'coverageLimits':['Layout uses real candidate React DOM snapshots and all current CSS with local fixture data, not a production logged-in session. Native menus/dialog styling not pixel-accepted.']}
 (C/'visual-layout-tests.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':report['status'],'results':[{'width':r['width'],'status':r['status'],'error':r.get('error'),'oldBaseHeight':r['before']['base']['height'],'oldContactsHeight':r['before']['contacts']['height'],'newMergedHeight':r['after']['base']['height']} for r in results]}));assert report['status']=='PASS'
if __name__=='__main__':main()
