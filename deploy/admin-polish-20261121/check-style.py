#!/usr/bin/env python3
"""Read-only directed CSS checks. No app server, build, network, Git or business calls.

Fixtures use the real component DOM contracts and original CSS (including lazy
page CSS after the override), not the Demo. They check geometry, not API behavior.
Run: python3 deploy/admin-polish-20261121/check-style.py
"""
from pathlib import Path
import hashlib
import json
import re
import subprocess
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
SCOPE = '.admin-workspace-shell[data-admin-layout="top-two-level-v1"]'
MARKER = b'/* admin-polish-20261121-v1 BEGIN'
BASELINE = json.loads((HERE / 'style-baseline.json').read_text())
CANDIDATE = (HERE / 'style-candidate.css').read_bytes()
DASHBOARD = 'client/src/components/DashboardLayout.css'
report = {'method': 'directed Chromium DOM/CSS fixtures; not a live authenticated app test', 'boundary': {}, 'geometry': []}

for name, old in BASELINE.items():
    data = (ROOT / name).read_bytes()
    if name == DASHBOARD:
        assert hashlib.sha256(data[:old['bytes']]).hexdigest() == old['sha256'], 'original Dashboard CSS changed'
        assert data[old['bytes']:] == CANDIDATE, 'candidate differs from appended CSS'
        assert data.count(MARKER) == 1
        report['boundary'][name] = 'PASS: original bytes unchanged; one exact candidate appended'
    elif name.endswith('.css'):
        assert hashlib.sha256(data).hexdigest() == old['sha256'], name + ' changed'
        report['boundary'][name] = 'PASS: unchanged'
    else:
        unchanged = hashlib.sha256(data).hexdigest() == old['sha256']
        report['boundary'][name] = ('PASS: unchanged since CSS baseline' if unchanged else 'CHANGED since baseline by concurrent work; this CSS script does not write TSX')

assert CANDIDATE.endswith(b'\n')
assert b'zoom:' not in CANDIDATE and not re.search(rb'scale\s*\(', CANDIDATE)
# Parse with the repository's existing PostCSS only, never compile the app.
parsed = subprocess.run(['node', '--input-type=module', '-e', """
import fs from 'node:fs'; import postcss from 'postcss';
const root=postcss.parse(fs.readFileSync(process.argv[1],'utf8'));
const selectors=[]; root.walkRules(r=>selectors.push(r.selector));
console.log(JSON.stringify(selectors));
""", str(HERE / 'style-candidate.css')], cwd=ROOT, text=True, capture_output=True, check=True)
selectors = json.loads(parsed.stdout)
assert all(s.lstrip().startswith(SCOPE) for s in selectors), 'unscoped rule'
assert not re.search(r'(^|[},])\s*(?:html|body|:root)\b', CANDIDATE.decode())
report['scope'] = {'rules': len(selectors), 'all_scoped': True, 'global_zoom_or_root_type_changes': False, 'candidate_sha256': hashlib.sha256(CANDIDATE).hexdigest()}

PREFIX = 'client/src/business/platform/client/src/'
common_names = ['client/src/styles/AdminReadability.css', 'client/src/styles/AdminUnifiedSystem.css', 'client/src/components/admin/AdminWorkspaceNavigation.css', 'client/src/components/admin/AdminNewInformationBadge.css']
common = '\n'.join((ROOT / name).read_text() for name in common_names)
dash = (ROOT / DASHBOARD).read_text()
lazy = '\n'.join((ROOT / (PREFIX + name)).read_text() for name in ['pages/ChannelInventoryHost.css', 'pages/MyInventory.css', 'pages/CustomerList.css', 'components/ui/CompactListToolbar.css'])
lazy += '\n' + (ROOT / 'client/src/pages/OfficialChannelInventory.css').read_text()
logo_src = (ROOT / 'client/src/components/Logo.tsx').read_text()
logo = re.search(r'<svg[\s\S]*?</svg>', logo_src).group()
logo = logo.replace('aria-label={alt}', 'aria-label="51电子网"').replace('className={className}', 'class="h-9 w-auto shrink-0"')
logo = re.sub(r'\s+style=\{\{[^\n]+\}\}', '', logo)
# Minimal utility equivalents are fixture-only; no file modifies html/body type.
utilities = '''
*{box-sizing:border-box} p{margin:0} button{font:inherit;cursor:pointer}
.h-9{height:36px}.w-auto{width:auto}.shrink-0{flex-shrink:0}
.text-base{font-size:16px}.text-sm{font-size:14px}.text-xs{font-size:12px}
.text-\\[11px\\]{font-size:11px}.leading-none{line-height:1}
.flex{display:flex}.flex-col{flex-direction:column}.gap-0\\.5{gap:2px}
.truncate{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.admin-workspace-shell__account{display:flex;align-items:center;flex-shrink:0;border:0;background:none;text-align:left}
[data-slot="avatar"]{display:flex;flex-shrink:0;width:32px;height:32px;border:1px solid #ddd;border-radius:50%;overflow:hidden}
[data-slot="avatar-fallback"]{display:flex;width:100%;height:100%;align-items:center;justify-content:center;background:#185fa5;color:white}
.absolute{position:absolute}.relative{position:relative}.top-nav{top:-3px;right:2px}
.fixture-account-layer{position:fixed;top:56px;right:18px;width:192px;background:white;z-index:60}
.fixture-account-layer[hidden]{display:none}
.fixture-table-panel{min-width:0;max-width:100%}.fixture-local-scroll{overflow-x:auto;max-width:100%}
'''

def count(placement='nav', text='3'):
    return f'<span class="absolute top-nav inline-flex text-[11px]" data-admin-new-information="count" data-placement="{placement}" aria-label="{text} 条新信息" role="status">{text}</span>'

labels = ['客户列表', '库存列表', '商城物料', '询价接待', '采购需求', '采购入库', '销售订单', '个人中心', '平台运营', '组织与权限']
nav_items = []
for i, label in enumerate(labels):
    badge = count() if i == 0 else count(text='99+') if i == 4 else '<span class="inquiry-reception-nav-badge">8</span>' if i == 3 else ''
    nav_items.append(f'<button class="admin-workspace-nav__tab admin-workspace-nav__workspace" data-active="{str(i == 1).lower()}" aria-haspopup="menu">{label}{badge}</button>')
header = f'''
<div class="admin-workspace-shell__navigation"><header class="admin-workspace-shell__header">
<a class="admin-workspace-shell__brand" href="#">{logo}<div class="flex flex-col gap-0.5"><span class="truncate text-base leading-none">51电子网</span><span class="truncate text-[11px] leading-none">后台管理系统</span></div></a>
<nav class="admin-workspace-nav__tabs admin-workspace-nav__tabs--workspaces" data-admin-navigation="unified-dropdown" aria-label="主菜单">{''.join(nav_items)}
<div class="admin-workspace-nav__workspace-layer" hidden><section class="admin-workspace-nav__workspace-panel" data-workspace="operations" data-navigation-level="root" style="top:56px;left:18px;max-height:650px"><div class="admin-workspace-nav__workspace-content"><button class="admin-workspace-nav__tab admin-workspace-nav__module admin-workspace-nav__dropdown-item">消息中心{count('inline','99+')}</button></div></section></div></nav>
<button class="admin-workspace-shell__account"><span data-slot="avatar"><span data-slot="avatar-fallback" class="text-xs">V</span></span><div><p class="text-sm leading-none">Victor</p><p class="text-xs">超级管理员</p></div></button>
</header></div>'''
company = '深圳市宝龙达信息技术股份有限公司国际电子元器件事业部'
stock = f'''<section class="ci-page ci-host" data-channel-inventory-host="root"><div class="ci-toolbar"><select><option>全部可见库存</option></select><input aria-label="搜索型号"><button class="ci-button">搜索</button><input type="checkbox" aria-label="仅看未读"></div><div class="ci-tablewrap ci-compact-tablewrap"><table class="ci-table ci-compact-stock-table admin-table-readable" style="--ci-stock-min-width:1160px"><colgroup><col style="width:220px"><col style="width:120px"><col style="width:100px"><col style="width:200px"><col style="width:140px"><col style="width:200px"><col style="width:180px"></colgroup><thead><tr><th>型号</th><th>品牌</th><th>负责人</th><th>来源客户</th><th>可供数量</th><th>报价</th><th>操作</th></tr></thead><tbody><tr><td><span class="admin-cell-primary">RR1005L3R30FT</span></td><td>SUP</td><td>Victor</td><td class="ci-material-source-col"><button class="ci-inline-link ci-source-link">{company}</button></td><td>9,432</td><td>¥0.0017</td><td><div class="ci-row-actions"><button class="ci-inline-link ci-edit-entry">编辑</button><button class="ci-inline-link">更多</button></div></td></tr></tbody></table></div></section>'''
customer = f'''<section class="aui-page customer-list-page"><div class="d51-compact-list-toolbar"><div class="d51-compact-list-toolbar__row"><div class="d51-compact-list-toolbar__filters"><input data-slot="input" aria-label="搜索公司"><select><option>全部客户</option></select><button data-slot="button">搜索</button><input type="checkbox" aria-label="仅看未读"></div></div></div><div class="customer-list-table-scroll"><div class="customer-list-table-inner" data-slot="table-container"><table class="customer-list-table admin-table-readable" data-slot="table"><colgroup><col style="width:240px"><col style="width:200px"><col style="width:864px"></colgroup><thead><tr><th>客户名称</th><th>联系人</th><th>操作</th></tr></thead><tbody><tr><td><div class="customer-list-name-line"><button class="customer-list-name truncate text-sm">{company}</button><button class="customer-list-star">☆</button></div></td><td>Victor</td><td>原操作</td></tr></tbody></table></div></div></section>'''

def document(content, production):
    css = common + dash + lazy + (CANDIDATE.decode() if production else '')
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>{utilities}</style><style>{css}</style></head><body data-admin-readability="true" style="margin:0"><div class="admin-workspace-shell" data-admin-layout="top-two-level-v1">{header}<main class="admin-workspace-shell__main admin-unified-content"><nav class="admin-workspace-nav__location" data-admin-navigation="current-location" data-admin-list-location-layout="root-hidden" aria-label="当前位置"></nav><section data-business-context-verification><div data-business-context-content><div class="business-native-content">{content}</div></div></section></main></div><section class="fixture-account-layer" data-slot="dropdown-menu-content" hidden>个人中心 / 退出登录</section></body></html>'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    for width in [1440, 1280, 390]:
        for family, content in [('stock', stock), ('customer', customer)]:
            for production in [False, True]:
                page = browser.new_page(viewport={'width':width,'height':900}, device_scale_factor=1)
                page.route('**/*', lambda route: route.abort())
                page.set_content(document(content, production))
                result = page.evaluate('''() => {
                  const q=s=>document.querySelector(s), rect=s=>{const r=q(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}}, css=s=>getComputedStyle(q(s));
                  const nav=q('.admin-workspace-nav__tabs--workspaces'), badge=q('.admin-workspace-nav__workspace [data-admin-new-information]');
                  const b=badge.getBoundingClientRect(), n=nav.getBoundingClientRect(), t=badge.parentElement.getBoundingClientRect();
                  const scroll=q('.ci-tablewrap,.customer-list-table-scroll'), company=q('.ci-source-link,.customer-list-name');
                  const controls=[...document.querySelectorAll('.ci-toolbar input:not([type=checkbox]),.ci-toolbar select,.ci-toolbar button,.d51-compact-list-toolbar input:not([type=checkbox]),.d51-compact-list-toolbar select,.d51-compact-list-toolbar button')];
                  return {header:rect('header'),navigation:rect('.admin-workspace-shell__navigation'), logo:rect('.admin-workspace-shell__brand > svg'), brand:[css('.admin-workspace-shell__brand > div > span:first-child').fontSize,css('.admin-workspace-shell__brand > div > span:last-child').fontSize],account:[css('.admin-workspace-shell__account > div > p:first-child').fontSize,css('.admin-workspace-shell__account > div > p:last-child').fontSize],avatar:rect('[data-slot=avatar]'),navFont:css('.admin-workspace-nav__workspace').fontSize,navGap:getComputedStyle(nav).gap,navOverflow:getComputedStyle(nav).overflowX, navScrollWidth:nav.scrollWidth,navClientWidth:nav.clientWidth, badge:{height:b.height,font:getComputedStyle(badge).fontSize,position:getComputedStyle(badge).position,shadow:getComputedStyle(badge).boxShadow,centered:Math.abs((b.top+b.bottom)/2-(t.top+t.bottom-2)/2)<2,notClipped:b.top>=n.top&&b.bottom<=n.bottom},controls:controls.map(x=>x.getBoundingClientRect().height),checkbox:q('input[type=checkbox]').getBoundingClientRect().height,th:rect('th').height,thFont:css('th').fontSize,bodyFont:css('tbody td').fontSize,companyFont:getComputedStyle(company).fontSize,companyHeight:company.getBoundingClientRect().height,companyWhiteSpace:getComputedStyle(company).whiteSpace,scroll:{client:scroll.clientWidth,total:scroll.scrollWidth,overflow:getComputedStyle(scroll).overflowX},documentWidth:document.documentElement.scrollWidth,viewport:innerWidth};
                }''')
                assert result['header']['height'] == 52 and result['navigation']['height'] == 52, result
                assert result['logo']['height'] == 28 and result['avatar']['height'] == 28, result
                assert result['brand'] == ['14px','10px'] and result['account'] == ['12px','10px'], result
                assert result['navFont'] == '14px' and result['navOverflow'] == 'auto', result
                assert result['badge']['height'] == 15 and result['badge']['font'] == '10px' and result['badge']['position'] == 'static' and result['badge']['shadow'] == 'none' and result['badge']['notClipped'] and result['badge']['centered'], result
                assert all(x == 34 for x in result['controls']), result
                assert page.evaluate('''selectors => !selectors.some(s => s.includes('toolbar') && document.querySelector('input[type=checkbox]').matches(s))''', selectors), 'new toolbar rules select a checkbox'
                result['checkboxExcludedFromNewRules'] = True
                assert result['th'] == 32 and result['thFont'] == '12px', result
                assert result['bodyFont'] == '13px' and result['companyFont'] == '13px', result
                assert result['companyWhiteSpace'] == 'normal' and result['companyHeight'] > 20, result
                assert result['documentWidth'] <= width, result
                if width == 390:
                    assert result['scroll']['total'] > result['scroll']['client'] and result['scroll']['overflow'] == 'auto', result
                    assert result['navScrollWidth'] > result['navClientWidth'], result
                    last = page.locator('.admin-workspace-nav__workspace').last
                    last.evaluate("el=>el.scrollIntoView({block:'nearest',inline:'nearest'})")
                    assert last.is_visible()
                    assert page.locator('header').bounding_box()['height'] == 52
                    result['mobileLastMenuReachable'] = page.evaluate('''() => {const e=document.querySelectorAll('.admin-workspace-nav__workspace');const r=e[e.length-1].getBoundingClientRect(), n=document.querySelector('nav[aria-label="主菜单"]').getBoundingClientRect();return r.left>=n.left-1&&r.right<=n.right+1}''')
                    assert result['mobileLastMenuReachable']
                page.locator('.admin-workspace-nav__workspace-layer').evaluate('el=>el.hidden=false')
                panel = page.locator('.admin-workspace-nav__workspace-panel')
                panel_state = panel.evaluate('''el=>{const r=el.getBoundingClientRect(), c=getComputedStyle(el), b=el.querySelector('[data-admin-new-information]');return {position:c.position,zIndex:c.zIndex,pointerEvents:c.pointerEvents,x:r.x,right:r.right,height:r.height,badgeHeight:b.getBoundingClientRect().height,badgePosition:getComputedStyle(b).position}}''')
                assert panel_state['position'] == 'fixed' and panel_state['zIndex'] == '52' and panel_state['pointerEvents'] == 'auto' and panel_state['badgeHeight'] == 16 and panel_state['badgePosition'] == 'static', panel_state
                if width == 390:
                    assert panel_state['x'] >= 0 and panel_state['right'] <= width and panel_state['height'] == 900, panel_state
                result['nativeDropdownGeometry'] = panel_state
                result.update({'width':width,'family':family,'cssLoad':'production candidate last' if production else 'repo candidate before lazy page CSS'})
                report['geometry'].append(result)
                page.close()
    browser.close()

report['status'] = 'PASS'
report['limitations'] = ['Fixtures check real DOM/CSS contracts and both CSS load orders, not authenticated application navigation, permissions, API unread updates or stock publishing.', 'No full build, application server, Git, SSH or production operation was performed.']
(HERE / 'style-check-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':report['status'],'fixtures':len(report['geometry']),'scope_rules':len(selectors),'boundary':report['boundary'],'report':str(HERE/'style-check-results.json')},ensure_ascii=False,indent=2))
