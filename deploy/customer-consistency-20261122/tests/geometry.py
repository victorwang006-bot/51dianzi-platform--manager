#!/usr/bin/env python3
import json, hashlib, pathlib, re, traceback
from html.parser import HTMLParser
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
W=pathlib.Path('/home/ubuntu/work/customer-consistency-release-20261122-0034/layout')
R=pathlib.Path('/home/ubuntu/work/channel-release-20261121-1837/manager')
manifest=json.loads((W/'manifest.json').read_text())
# Final QA requires the parent's complete capture; never substitute source CSS.
full=W/'tests/current-css-chain.json'
raw=json.loads(full.read_text()); chain=raw.get('css',raw.get('assets',[]))
assert len(chain)==51,'complete captured current chain must contain 51 stylesheets'
final=json.loads((W.parent/'candidate/manifest.json').read_text())
new_css=next(x for x in final['assets'] if x['url']==final['cssURL'])
replacement_index=[i for i,x in enumerate(chain) if '0cd15c6df7928beb' in x['url']]
assert len(replacement_index)==1,'exactly one original unread CSS link position'
replacement_index=replacement_index[0]
css_records=[]
for i,x in enumerate(chain):
    original=pathlib.Path(x['local']); assert hashlib.sha256(original.read_bytes()).hexdigest()==x['sha256'],'captured CSS pin'
    chosen=new_css if i==replacement_index else x
    local=pathlib.Path(chosen['local']); digest=hashlib.sha256(local.read_bytes()).hexdigest()
    assert digest==chosen['sha256'],'effective CSS pin'
    css_records.append({'index':i,'url':chosen['url'],'local':str(local),'sha256':digest,'originalURL':x['url'],'replaced':i==replacement_index})
class StylesheetLinks(HTMLParser):
    def __init__(self):super().__init__();self.hrefs=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=='link' and 'stylesheet' in a.get('rel','').split():self.hrefs.append(urlparse(a['href']).path)
links=StylesheetLinks();links.feed((W.parent/'candidate/index.html').read_text())
assert links.hrefs==[x['url'] for x in css_records],'effective stylesheet order exactly equals final candidate HTML'
ex=json.loads((W/'tests/native-extract.json').read_text())
for m in final['modules']:
    assert hashlib.sha256(pathlib.Path(m['local']).read_bytes()).hexdigest()==m['afterSHA'],'final WB pin'
    assert ex[m['index']]['metadata']['bundleSHA256']==m['afterSHA'],'fixture executes final integrated WB'
mode='complete current 51 stylesheet chain; original unread CSS replaced in situ; exact final HTML order'
report={'offline':True,'businessInterfaces':'Explicit mock customer/TRPC, supply/contacts, identity and unread responses; no production reads or writes.','renderer':'Headless /usr/bin/chromium; full pinned native list functions + actual React Table/CompactListToolbar/CustomerSupplyCell/CustomerSupplyAction/CustomerContactsSummary/RowBadge + unchanged pageMemory module.','cssMode':mode,'cssFiles':css_records,'cssReplacementIndex':replacement_index,'native':final['modules'],'nativeExtraction':[x['metadata'] for x in ex],'cases':[],'errors':[]}
styles=''.join('<style>'+pathlib.Path(x['local']).read_text().replace('</style','<\\/style')+'</style>' for x in css_records)
html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+'</head><body data-business-native-fonts="true"><div id="root"></div><script type="module" src="/browser-fixture.js"></script></body></html>'
measure=r'''() => {
 const q=s=>document.querySelector(s),rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 const sc=q('.customer-list-table-scroll'),t=q('.customer-list-table'),filter=q('.d51-compact-list-toolbar__filters'),actions=q('.d51-compact-list-toolbar__actions');
 return {viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,table:rect(t),scroll:rect(sc),scrollWidth:sc.scrollWidth,scrollLeft:sc.scrollLeft,innerOverflow:getComputedStyle(q('[data-slot="table-container"]')).overflowX,cols:[...t.querySelectorAll('thead th')].map(rect),rows:[...t.querySelectorAll('tbody tr')].map(row=>({rect:rect(row),cells:[...row.cells].map(rect),name:rect(row.querySelector('.customer-list-name')),nameText:row.querySelector('.customer-list-name').textContent,nameTitle:row.querySelector('.customer-list-name').title,nameCSS:getComputedStyle(row.querySelector('.customer-list-name')).whiteSpace,star:rect(row.querySelector('.customer-list-star')),unread:row.querySelector('.customer-list-unread-label')?rect(row.querySelector('.customer-list-unread-label')):null,supply:[...row.querySelectorAll('.customer-list-supply-actions button')].map(b=>({text:b.textContent,rect:rect(b),scrollWidth:b.scrollWidth,clientWidth:b.clientWidth,overflow:getComputedStyle(b).overflow,disabled:b.getAttribute('aria-disabled')})),status:!!row.querySelector('.customer-list-name-statuses')})),toolbar:{filters:rect(filter),actions:rect(actions),controls:[...filter.querySelectorAll('input,button,label.customer-list-unread-filter')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({text:e.textContent||e.getAttribute('aria-label'),rect:rect(e)}))},sticky:[...t.querySelectorAll('tbody tr:first-child .customer-list-demand-column,tbody tr:first-child .customer-list-actions-column')].map(e=>({rect:rect(e),position:getComputedStyle(e).position,right:getComputedStyle(e).right}))};
}'''
def near(a,b,tol=1):return abs(a-b)<=tol
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    for wb,width in [(0,1920),(0,1560),(0,1280),(0,390),(1,1560),(1,390)]:
        case={'wb':wb,'viewport':width};report['cases'].append(case)
        page=browser.new_page(viewport={'width':width,'height':900})
        page.on('pageerror',lambda e:report['errors'].append(str(e)))
        forbidden=[]
        def route(r):
            u=r.request.url
            if not u.startswith('http://layout.fixture/'):
                forbidden.append(u);r.abort();return
            name=u.split('?')[0].split('/')[-1]
            if name=='browser-fixture.js':r.fulfill(body=(W/'tests/browser-fixture.js').read_bytes(),content_type='application/javascript')
            elif name=='native-extract.json':r.fulfill(body=(W/'tests/native-extract.json').read_bytes(),content_type='application/json')
            else:r.fulfill(body=html,content_type='text/html')
        page.route('**/*',route)
        try:
            page.goto(f'http://layout.fixture/customers?wb={wb}')
            page.wait_for_selector('.customer-list-table',timeout=15000)
            page.wait_for_function('document.querySelectorAll(".customer-list-supply-view").length >= 1',timeout=10000)
            page.wait_for_timeout(200)
            before=page.evaluate(measure);case['shortPage']=before
            assert near(before['table']['width'],1392 if width-36>=1392 else 1312), 'finite table width'
            assert before['pageWidth']<=width+1,'page overflow must not mask extra scroller'
            assert before['innerOverflow']=='visible','one outer horizontal scroller'
            assert near(before['rows'][0]['rect']['height'],before['rows'][1]['rect']['height']),'normal one/two supply operations same base row'
            assert near(before['rows'][0]['supply'][0]['rect']['y'],before['rows'][0]['supply'][1]['rect']['y']),'common supply dual actions same row'
            for row in before['rows']:
                for col,cell in zip(before['cols'],row['cells']): assert near(col['width'],cell['width']), 'header and row aligned'
                assert row['nameCSS']=='nowrap' and row['star']['right']<=row['cells'][0]['right']+1,'name/visible star budget'
                if row['unread']:assert row['unread']['right']<=row['cells'][0]['right']+1,'unread retained inside name cell'
                for b in row['supply']:assert b['rect']['right']<=row['cells'][5]['right']+1 and b['rect']['x']>=row['cells'][5]['x']-1,'supply action not clipped by cell'
            if width>680:assert near(before['toolbar']['filters']['y'],before['toolbar']['actions']['y']),'primary action top aligned on desktop'
            else:assert before['toolbar']['actions']['y']<=before['toolbar']['filters']['y'],'narrow primary action its own first row'
            # Reach every supply action separately through the sole scroller, including mobile sticky overlap.
            reached=[]
            buttons=page.locator('tbody tr:first-child .customer-list-supply-actions button')
            for n in range(buttons.count()):
                item=buttons.nth(n)
                result=item.evaluate('''b=>{const sc=b.closest('.customer-list-table-scroll'),r=sc.getBoundingClientRect(),br=b.getBoundingClientRect();sc.scrollLeft+=br.x-r.x-14;const x=b.getBoundingClientRect();return {text:b.textContent,visible:x.x>=r.x-1 && x.right<=r.right-216+1,hit:document.elementFromPoint(x.x+x.width/2,x.y+x.height/2)===b,rect:{x:x.x,right:x.right,width:x.width},scrollLeft:sc.scrollLeft};}''')
                assert result['visible'] and result['hit'],'each supply action fully reachable outside sticky overlay'
                reached.append(result)
            case['supplyReachability']=reached
            # Restore neutral scroll before inspecting page-independent geometry.
            page.evaluate('document.querySelector(".customer-list-table-scroll").scrollLeft=0')
            page.get_by_role('button',name='下一页',exact=True).click()
            page.wait_for_function('window.__nativeRun.listInput.page === 2')
            page.wait_for_timeout(150)
            after=page.evaluate(measure);case['longPage']=after
            assert near(before['table']['width'],after['table']['width']),'page independent table width'
            assert all(near(a['x'],b['x']) and near(a['width'],b['width']) for a,b in zip(before['cols'],after['cols'])),'page independent columns'
            assert after['rows'][0]['nameTitle'].endswith(after['rows'][0]['nameText']),'full company title retained'
            assert near(before['rows'][0]['rect']['height'],after['rows'][0]['rect']['height']),'long single-line company does not grow row'
            # Actual unchanged pageMemory: click original name navigation then actual source return.
            if width in [1280,390]:
                target=80 if width==1280 else 450
                page.evaluate('(x)=>{const sc=document.querySelector(".customer-list-table-scroll");sc.scrollLeft=x;window.__memory.flushPagePosition();}',target)
                saved=page.evaluate('document.querySelector(".customer-list-table-scroll").scrollLeft')
                # Dispatch the native DOM click without auto-scroll-to-name; memory's capture witness remains genuine.
                page.locator('tbody tr:first-child .customer-list-name').evaluate('e=>e.click()')
                page.wait_for_selector('#fixture-return')
                page.locator('#fixture-return').click()
                page.wait_for_selector('.customer-list-table')
                page.wait_for_timeout(200)
                restored=page.evaluate(measure)
                case['memory']={'saved':saved,'restored':restored['scrollLeft'],'page':page.evaluate('window.__nativeRun.listInput.page'),'sticky':restored['sticky']}
                assert near(saved,restored['scrollLeft']),'actual pageMemory horizontal source restoration'
                assert all(x['position']=='sticky' for x in restored['sticky']),'sticky retained after return'
            case['fixtureErrors']=page.evaluate('window.__fixtureErrors');assert not case['fixtureErrors'],'no React runtime errors'
            case['forbiddenNetwork']=forbidden;assert not forbidden,'no production/network requests'
            case['status']='PASS'
        except Exception as e:
            case['status']='FAIL';case['error']=str(e);case['traceback']=traceback.format_exc()
            try:case['html']=page.locator('#root').inner_html()[:500]
            except:pass
        print(wb,width,case['status'],case.get('error',''),flush=True)
        page.close()
    browser.close()
report['status']='PASS' if all(c['status']=='PASS' for c in report['cases']) and not report['errors'] else 'FAIL'
(W/'evidence/geometry.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print('GEOMETRY',report['status'],'CSS MODE',mode)
raise SystemExit(0 if report['status']=='PASS' else 1)
