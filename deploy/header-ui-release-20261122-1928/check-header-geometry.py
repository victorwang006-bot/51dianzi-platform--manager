import json, hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright
W=Path(__file__).parent
R=Path('/home/ubuntu/work/channel-release-20261121-1837/manager')
css=[Path(p)for p in json.loads((W/'offline-css-chain.json').read_text())]
report={'scope':'OFFLINE_FINAL_NATIVE_HEADER_FACTORY_WITH_FRESH_CSS_CHAIN','productionConnected':False,'networkRequests':[],'rows':[],'sourcePins':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in css}}
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    try:
        page=browser.new_page()
        def route(req):
            if req.request.url.startswith(('http:','https:')):
                report['networkRequests'].append(req.request.url)
                req.abort()
            else: req.continue_()
        page.route('**/*',route)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        for width in [1920,1440,1280,768,390]:
            page.set_viewport_size({'width':width,'height':800})
            page.goto((W/'offline-header.html').as_uri())
            for f in css:page.add_style_tag(path=str(f))
            page.wait_for_timeout(160)
            states=[]
            for count in [82,0,100]:
                page.evaluate('(n)=>window.renderHeader(n)',count)
                page.wait_for_timeout(80)
                values=page.evaluate('''() => {
                  const r=n=>{const x=n.getBoundingClientRect();return {left:x.left,right:x.right,top:x.top,bottom:x.bottom,width:x.width,height:x.height}};
                  const nav=document.querySelector('[data-admin-navigation="unified-dropdown"]');
                  const cells=[...nav.querySelectorAll('[data-navigation-level="1"]')].map(n=>({id:n.dataset.workspaceNavTarget,rect:r(n),label:n.querySelector('.admin-workspace-nav__primary-label')?r(n.querySelector('.admin-workspace-nav__primary-label')):null,slot:n.querySelector('.admin-workspace-nav__badge-slot')?r(n.querySelector('.admin-workspace-nav__badge-slot')):null,badge:n.querySelector('[data-admin-new-information="count"]')?r(n.querySelector('[data-admin-new-information="count"]')):null,font:getComputedStyle(n).fontSize}));
                  return {header:r(document.querySelector('header')),nav:r(nav),cells,account:r(document.querySelector('.admin-workspace-nav__account')),bodyWidth:document.documentElement.scrollWidth,viewport:innerWidth,more:!!nav.querySelector('[data-workspace-nav-target="more"]'),status:!!document.querySelector('.admin-new-information-status')};
                }''')
                assert values['header']['height']==52,values
                assert values['bodyWidth']<=width+1,values
                assert values['account']['right']<=width+1,values
                assert not values['status'],values
                for n in values['cells']:
                    assert n['rect']['left']>=values['nav']['left']-.1 and n['rect']['right']<=values['nav']['right']+.1,(width,n,values)
                    assert n['font']=='14px',n
                    if n['slot']:
                        assert abs(n['slot']['width']-32)<.1,n
                        assert n['label']['right']<=n['slot']['left']+.1,n
                        if n['badge']:assert n['badge']['left']>=n['slot']['left']-.1 and n['badge']['right']<=n['slot']['right']+.1,n
                positions=[(n['id'],n['rect']['left'],n['rect']['width']) for n in values['cells']]
                if states:assert positions==states[0]['positions'],(width,count,positions,states[0]['positions'])
                states.append({'count':count,'positions':positions,'geometry':values})
            if width<1280:assert states[0]['geometry']['more'],(width,states)
            report['rows'].append({'viewport':width,'states':states})
            print('PASS real header + captured CSS',width,'stable 82/zero/99+ positions, overflow More reachable',flush=True)
        page.set_viewport_size({'width':1280,'height':800})
        page.goto((W/'offline-header.html').as_uri())
        for f in css:page.add_style_tag(path=str(f))
        page.wait_for_timeout(160)
        more=page.locator('[data-workspace-nav-target="more"]')
        assert more.count()==1
        more.click()
        direct=page.locator('[data-workspace-nav-target="inventory-management"]')
        direct.hover()
        assert page.locator('[data-workspace="more"][data-workspace-dropdown="panel"]').count()==1
        direct.click()
        clicks=page.evaluate('window.navClicks')
        assert len(clicks)==1 and clicks[0][0]['path']=='/workbench/inbound',clicks
        report['mouseMoreCheck']={'viewport':1280,'hoverThenClick':'inventory-management','originalPath':'/workbench/inbound','calls':1,'passed':True}
        print('PASS actual desktop mouse hover + click: More direct entry remains reachable',flush=True)
        assert not errors,errors
        assert not report['networkRequests'],report['networkRequests']
        report['checks']={'allPassed':True,'noNetwork':True,'zeroAndLargeCountsStable':True,'fiveViewports':True,'notAProductionBusinessTest':True}
    finally:
        browser.close()
        (W/'header-geometry.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
