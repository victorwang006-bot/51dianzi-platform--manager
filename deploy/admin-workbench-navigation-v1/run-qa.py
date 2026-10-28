import functools
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
m = json.loads((ROOT / 'dist/manifest.json').read_text())
checks = []
errors = []
external = []
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
server = ThreadingHTTPServer(('127.0.0.1', 3102), functools.partial(Quiet, directory=str(ROOT / 'dist/qa')))
threading.Thread(target=server.serve_forever, daemon=True).start()

def passed(name, condition, detail=None):
    assert condition, (name, detail)
    checks.append({'name': name, 'passed': True, 'detail': detail})

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1366, 'height': 900})
        page.on('pageerror', lambda err: errors.append(str(err)))
        def route(r):
            if r.request.url.startswith('http://127.0.0.1:3102/'):
                r.continue_()
            else:
                external.append(r.request.url)
                r.abort()
        page.route('**/*', route)
        page.goto('http://127.0.0.1:3102/', wait_until='networkidle')
        page.wait_for_selector('[data-admin-navigation="workbench-v1"]')
        passed('four groups and ten original menu entries', page.locator('.admin-workbench-nav__group').count() == 4 and page.locator('[data-sidebar=menu-button]').count() == 10)
        dims = page.evaluate('''() => {const n=document.querySelector('[data-admin-navigation]'),g=document.querySelector('.admin-workbench-nav__group-toggle'),b=document.querySelector('[data-sidebar=menu-button]');return {width:document.querySelector('[data-qa-shell]').getBoundingClientRect().width,title:parseFloat(getComputedStyle(g).fontSize),item:parseFloat(getComputedStyle(b).fontSize),height:b.getBoundingClientRect().height,icons:[...n.querySelectorAll('[data-sidebar=menu-button]>svg')].every(s=>getComputedStyle(s).display==='none')}}''')
        passed('approved width typography rows and expanded icon hiding', dims == {'width': 220, 'title': 14, 'item': 13, 'height': 40, 'icons': True}, dims)
        toggle = page.locator('[data-group=data-operations] .admin-workbench-nav__group-toggle')
        toggle.click()
        passed('group collapse actually hides flex menu', not page.get_by_role('button', name='物料数据库', exact=True).is_visible())
        page.reload(wait_until='networkidle')
        passed('account A collapse memory restored', not page.get_by_role('button', name='物料数据库', exact=True).is_visible())
        page.evaluate('window.__navTest.setAccount("qa-B")')
        page.wait_for_timeout(50)
        passed('different account does not inherit collapse', page.get_by_role('button', name='物料数据库', exact=True).is_visible())
        page.evaluate('window.__navTest.setAccount("qa-A")')
        page.wait_for_timeout(50)
        passed('switch back restores only account A state', not page.get_by_role('button', name='物料数据库', exact=True).is_visible())
        page.evaluate('window.__navTest.setLocation("/analytics/monthly")')
        page.wait_for_timeout(50)
        passed('direct detail route opens correct group and one current menu', page.get_by_role('button', name='运营数据', exact=True).is_visible() and page.locator('[data-sidebar=menu-button][data-active=true]').count() == 1 and page.locator('[data-sidebar=menu-button][data-active=true]').get_attribute('aria-label') == '运营数据')
        page.get_by_role('button', name='消息中心', exact=True).click()
        passed('menu callback receives original item and badge remains', page.evaluate('window.__navTest.clicks.at(-1)') == '/messages' and page.locator('[data-qa-badge=messages]').inner_text() == '3')
        page.evaluate('window.__navTest.setPaths(["/admins","/profile"])')
        page.wait_for_timeout(50)
        passed('pre-filtered permissions hide missing items and empty groups', page.locator('.admin-workbench-nav__group').count() == 1 and page.locator('[data-sidebar=menu-button]').count() == 2 and page.get_by_role('button', name='商户管理', exact=True).count() == 0)
        page.evaluate('window.__navTest.setPaths(null);window.__navTest.setCollapsed(true)')
        page.wait_for_timeout(50)
        passed('global collapsed sidebar keeps all ten entries reachable', page.locator('[data-sidebar=menu-button]:visible').count() == 10 and page.locator('.admin-workbench-nav__group-toggle:visible').count() == 0)
        page.evaluate('window.__navTest.setCollapsed(false);window.__navTest.setAccount("qa-all-open")')
        page.set_viewport_size({'width': 1024, 'height': 240})
        page.wait_for_timeout(60)
        geometry = page.evaluate('''()=>{const c=document.querySelector('[data-sidebar=content]'),f=document.querySelector('footer'),rows=[...document.querySelectorAll('[data-sidebar=menu-button]')].filter(x=>x.getBoundingClientRect().height>0);return{scroll:c.scrollHeight>c.clientHeight,noOverlap:rows.every((x,i)=>!i||x.getBoundingClientRect().top>=rows[i-1].getBoundingClientRect().bottom-.1),withinFooter:c.getBoundingClientRect().bottom<=f.getBoundingClientRect().top+.1,minRow:Math.min(...rows.map(x=>x.getBoundingClientRect().height))}}''')
        passed('low-height expanded menu scrolls without shrinking overlap or footer cover', geometry['scroll'] and geometry['noOverlap'] and geometry['withinFooter'] and geometry['minRow'] == 40, geometry)
        last = page.get_by_role('button', name='个人信息', exact=True)
        last.scroll_into_view_if_needed()
        last.click()
        passed('last menu remains clickable after scrolling', page.evaluate('window.__navTest.clicks.at(-1)') == '/profile')
        page.set_viewport_size({'width': 375, 'height': 640})
        page.wait_for_timeout(50)
        passed('mobile text menu stays within horizontal viewport', page.evaluate('document.documentElement.scrollWidth<=window.innerWidth') and page.get_by_role('button', name='个人信息', exact=True).is_visible())
        passed('no browser exception or external production request', not errors and not external, {'errors': errors, 'externalRequests': external})
        browser.close()
    result = {'passed': True, 'cases': len(checks), 'checks': checks, 'navigationRuntimeSha256': next(f['sha256'] for f in m['files'] if '/assets/' + f['name'] == m['runtime']), 'layoutSha256': next(f['sha256'] for f in m['files'] if '/assets/' + f['name'] == m['layout']), 'productionRequests': 0, 'boundary': 'actual final compiled navigation runtime; isolated React bridge and menu callback fixture with actual existing CSS, not authenticated full backend or production business write test'}
    (ROOT / 'evidence').mkdir(exist_ok=True)
    (ROOT / 'evidence/layout-qa.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'passed': True, 'cases': len(checks), 'productionRequests': 0}, ensure_ascii=False))
finally:
    server.shutdown()
    server.server_close()
