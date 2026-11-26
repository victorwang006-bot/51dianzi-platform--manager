import sys,json,time,re
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/work/fe/shared')
from pw_helper import open_page
OUT=Path('/tmp/inb2');OUT.mkdir(exist_ok=True)
STAMP=str(int(time.time()))[-7:]
SINGLE='INB2-S'+STAMP
BULKS=['INB2-B'+STAMP+'-'+str(i) for i in range(1,4)]
errors=[];requests=[];created={}
with open_page(3102,'/workbench/inbound',1440,960) as (page,ctx):
 page.on('pageerror',lambda e:errors.append(str(e)))
 def req(r):
  if r.method=='POST' and ('businessMutation' in r.url or 'inbound.' in r.url):
   try: requests.append({'url':r.url.split('?')[0],'data':r.post_data_json})
   except:pass
 page.on('request',req)
 page.get_by_role('button',name='新建采购入库',exact=True).wait_for(timeout=180000)
 page.locator('table tbody tr').first.wait_for(timeout=180000)
 page.screenshot(path=str(OUT/'list-loaded.png'))
 def new():
  page.get_by_role('button',name='新建采购入库',exact=True).click()
  dlg=page.get_by_role('dialog',name='新建采购入库单',exact=True);dlg.wait_for()
  page.wait_for_function("() => document.querySelector('.i2-modal select[aria-label=采购员]')?.value",timeout=180000)
  return dlg
 def fill(d,index,pn,q,price):
  for label,value in [('料号/型号',pn),('品牌','TI'),('年份/DC','2026'),('数量',q),('单价',price)]:d.get_by_label(f'物料{index} {label}',exact=True).fill(value)
 def save_and_wait(d,name):
  d.get_by_role('button',name=name,exact=True).click()
  try:d.wait_for(state='hidden',timeout=180000)
  except:
   page.screenshot(path=str(OUT/'failed-save.png'));print('SAVEFAIL',d.inner_text());raise
 if '--resume' not in sys.argv:
  d=new();d.get_by_label('供应商名称',exact=True).fill('INB2单条完整验证')
  fill(d,1,SINGLE,'100','12.34');d.get_by_role('button',name='已入库',exact=True).click()
  d.get_by_role('button',name='更多',exact=True).click();d.get_by_label('物料1 仓位',exact=True).fill('INB2-A1')
  d.get_by_label('物料1 封装',exact=True).fill('SOIC-8');d.get_by_label('物料1 批次 / Lot No.',exact=True).fill('L001')
  d.get_by_label('费用1 金额',exact=True).fill('10.25')
  d.get_by_role('button',name='已付全款',exact=True).click()
  d.get_by_role('button',name='＋ 添加费用',exact=True).click();d.get_by_label('费用2 项目',exact=True).select_option(label='银行手续费');d.get_by_label('费用2 金额',exact=True).fill('20.50')
  page.screenshot(path=str(OUT/'new-single-filled.png'));print('SINGLE SUMMARY',d.locator('.i2-summary').inner_text())
  save_and_wait(d,'确认入库');created['single']=SINGLE
  row=page.locator('table tbody tr').filter(has_text=SINGLE);row.wait_for();page.screenshot(path=str(OUT/'list-single-saved.png'));print('SINGLE ROW',row.inner_text())
 else:
  SINGLE='INB2-S5665461';created['single']=SINGLE;row=page.locator('table tbody tr').filter(has_text=SINGLE);row.wait_for()
 # Edit via the row inline menu, the only edit entry.
 row.locator('button').last.click();page.get_by_role('menuitem',name='编辑',exact=True).click()
 edit=page.get_by_role('dialog',name='编辑入库单',exact=True);edit.wait_for();edit.get_by_label('费用1 金额',exact=True).wait_for(timeout=180000)
 print('EDIT BEFORE',edit.inner_text());page.screenshot(path=str(OUT/'edit-received-before.png'))
 edit.get_by_label('物料1 数量',exact=True).fill('120');edit.get_by_label('物料1 单价',exact=True).fill('13.21');edit.get_by_label('费用1 金额',exact=True).fill('12.50');edit.get_by_label('供应商联系人',exact=True).fill('采购验证联系人')
 page.screenshot(path=str(OUT/'edit-received-changed.png'));edit.get_by_role('button',name='保存修改',exact=True).click()
 confirm=page.get_by_role('dialog',name='确认修改',exact=True);confirm.wait_for();page.screenshot(path=str(OUT/'confirm-received.png'));print('CONFIRM',confirm.inner_text())
 confirm.get_by_label('修改原因',exact=True).fill('INB2浏览器验收：供应商更正数量单价和运费');confirm.get_by_role('button',name='确认保存',exact=True).click();edit.wait_for(state='hidden',timeout=180000)
 row=page.locator('table tbody tr').filter(has_text=SINGLE);page.wait_for_timeout(2000);print('EDIT AFTER ROW',row.inner_text());page.screenshot(path=str(OUT/'list-after-revision.png'))
 row.click();edit=page.get_by_role('dialog',name='编辑入库单',exact=True);edit.wait_for();edit.get_by_role('button',name=re.compile('修改记录')).click();hist=page.get_by_role('dialog',name='修改记录',exact=True);hist.wait_for();page.wait_for_timeout(1500);page.screenshot(path=str(OUT/'history-received.png'));print('HISTORY',hist.inner_text());hist.get_by_role('button',name='关闭修改记录',exact=True).click();edit.get_by_role('button',name='取消',exact=True).click()
 # Create multi-line in-transit order and exact fee allocation.
 d=new();d.get_by_label('供应商名称',exact=True).fill('INB2多物料验证');fill(d,1,BULKS[0],'100','12.34')
 for index,pn,q,price in [(2,BULKS[1],'30','0.38'),(3,BULKS[2],'7','21.123456')]:
  d.get_by_role('button',name='＋ 添加物料',exact=True).click();fill(d,index,pn,q,price)
 d.get_by_label('费用1 金额',exact=True).fill('30.01');d.get_by_role('button',name='＋ 添加费用',exact=True).click();d.get_by_label('费用2 项目',exact=True).select_option(label='报关费');d.get_by_label('费用2 金额',exact=True).fill('40.02')
 page.screenshot(path=str(OUT/'new-bulk3-filled.png'));print('BULK SUMMARY',d.locator('.i2-summary').inner_text());save_and_wait(d,'保存为在途');created['bulk']=BULKS
 row=page.locator('table tbody tr').filter(has_text=BULKS[0]);row.wait_for();page.screenshot(path=str(OUT/'list-bulk-saved.png'));print('BULK ROW',row.inner_text())
 row.click();edit=page.get_by_role('dialog',name='编辑入库单',exact=True);edit.wait_for();edit.get_by_label('费用1 金额',exact=True).wait_for(timeout=180000);page.screenshot(path=str(OUT/'edit-transit-before.png'))
 edit.get_by_label('物料1 数量',exact=True).fill('110');edit.get_by_label('物料1 单价',exact=True).fill('13.33');edit.get_by_label('费用1 金额',exact=True).fill('20.03');edit.get_by_label('供应商名称',exact=True).fill('INB2在途原子修改')
 edit.get_by_role('button',name='保存修改',exact=True).click();confirm=page.get_by_role('dialog',name='确认修改',exact=True);confirm.wait_for();page.screenshot(path=str(OUT/'confirm-transit.png'));confirm.get_by_label('修改原因',exact=True).fill('INB2在途原子修改验收');confirm.get_by_role('button',name='确认保存',exact=True).click();edit.wait_for(state='hidden',timeout=180000);page.wait_for_timeout(1500);print('TRANSIT AFTER',row.inner_text());page.screenshot(path=str(OUT/'list-transit-after.png'))
 print('JS_ERRORS',errors);print('CREATED',created)
 (OUT/'e2e-result.json').write_text(json.dumps({'errors':errors,'created':created,'requests':requests},ensure_ascii=False,indent=2))
