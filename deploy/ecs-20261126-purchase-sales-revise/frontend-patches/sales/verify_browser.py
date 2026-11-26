import sys,json,time,os
sys.path.insert(0,'/home/ubuntu/work/fe/shared')
from pw_helper import open_page
os.makedirs('/tmp/sal2',exist_ok=True)
with open_page(3103,'/workbench/sales-orders?orderSource=business') as (page,ctx):
 errors=[];requests=[]
 page.on('pageerror',lambda e: errors.append(str(e)))
 page.on('request',lambda r: requests.append(r.url) if '/api/trpc/' in r.url else None)
 page.wait_for_selector('.__sv2_list',timeout=120000)
 page.wait_for_timeout(7000)
 page.screenshot(path='/tmp/sal2/stg-list.png')
 print('LIST',page.locator('.__sv2_list').inner_text())
 print('GET REQUESTS',sum(u.count('crmSalesOrder.get') for u in requests),requests)
 for tab in ['待收款','待出货','已完成','已取消','全部']:
  page.get_by_role('tab',name=tab,exact=True).click();page.wait_for_timeout(400)
  page.screenshot(path='/tmp/sal2/stg-tab-'+tab+'.png')
 page.get_by_role('button',name='XS20261126-8',exact=True).click();page.wait_for_selector('input[aria-label="第1行销售数量"]');page.wait_for_timeout(1500)
 page.screenshot(path='/tmp/sal2/stg-existing-8.png')
 print('EDITOR',page.locator('.__sv2_dialog').inner_text())
 page.get_by_role('button',name='修改记录 6',exact=True).click();page.screenshot(path='/tmp/sal2/stg-history.png');page.get_by_role('button',name='关闭修改记录',exact=True).click()
 page.get_by_role('textbox',name='第1行销售数量',exact=True).fill('1');page.get_by_role('button',name='保存修改',exact=True).click();page.screenshot(path='/tmp/sal2/stg-qty-validation.png')
 print('QTY ERROR',page.get_by_role('alert').all_text_contents())
 page.get_by_role('textbox',name='第1行销售数量',exact=True).fill('3');page.get_by_role('textbox',name='第1行销售单价',exact=True).fill('1');page.get_by_role('textbox',name='第2行销售单价',exact=True).fill('1');page.get_by_role('button',name='保存修改',exact=True).click();page.screenshot(path='/tmp/sal2/stg-paid-validation.png');print('PAID ERROR',page.get_by_role('alert').all_text_contents())
 page.get_by_role('textbox',name='第1行销售单价',exact=True).fill('20');page.get_by_role('textbox',name='第2行销售单价',exact=True).fill('30')
 page.get_by_role('button',name='关闭订单弹窗',exact=True).click();
 page.get_by_role('button',name='新建业务订单',exact=True).click();page.wait_for_timeout(1000);page.screenshot(path='/tmp/sal2/stg-new-empty.png');print('NEW',page.locator('.__sv2_dialog').inner_text())
 json.dump({'errors':errors,'requests':requests},open('/home/ubuntu/work/fe/sal2/browser-initial.json','w'),ensure_ascii=False,indent=2)
