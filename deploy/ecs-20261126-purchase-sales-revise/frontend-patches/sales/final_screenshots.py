import sys,json
sys.path.insert(0,'/home/ubuntu/work/fe/shared')
from pw_helper import open_page
with open_page(3103,'/workbench/sales-orders?orderSource=business') as (p,c):
 p.on('dialog',lambda d:d.accept());errors=[];p.on('pageerror',lambda e:errors.append(str(e)));p.wait_for_selector('.__sv2_list');p.wait_for_timeout(4500);p.screenshot(path='/tmp/sal2/final-list.png')
 for id in [8,13,14,15]:
  p.get_by_role('button',name='XS20261126-'+str(id),exact=True).click();p.wait_for_selector('input[aria-label="第1行销售数量"]');p.wait_for_timeout(700);p.locator('.__sv2_body').evaluate('(e)=>e.scrollTop=0');p.screenshot(path='/tmp/sal2/final-order-'+str(id)+'.png');assert p.get_by_role('textbox',name='第1行销售数量',exact=True).is_disabled()==(id in [13,14]);
  if id==15:
   p.get_by_role('textbox',name='第1行销售单价',exact=True).fill('27.1111');p.get_by_role('button',name='保存修改',exact=True).click();p.screenshot(path='/tmp/sal2/final-review.png');p.get_by_role('button',name='返回修改',exact=True).click();p.get_by_role('textbox',name='第1行销售单价',exact=True).fill('26.1111')
  p.get_by_role('button',name='关闭订单弹窗',exact=True).click()
 p.get_by_role('button',name='新建业务订单',exact=True).click();p.screenshot(path='/tmp/sal2/final-new.png');p.get_by_role('button',name='需求采购',exact=True).click();p.screenshot(path='/tmp/sal2/final-demand-new.png');p.get_by_role('button',name='关闭订单弹窗',exact=True).click();json.dump({'pageErrors':errors,'readonlyCompleted13':True,'readonlyCancelled14':True,'finalList':True,'newAndDemandSource':True},open('/home/ubuntu/work/fe/sal2/final-browser.json','w'),ensure_ascii=False,indent=2)
