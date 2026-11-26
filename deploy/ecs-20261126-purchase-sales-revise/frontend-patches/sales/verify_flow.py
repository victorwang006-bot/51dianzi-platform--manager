import sys,json,os
sys.path.insert(0,'/home/ubuntu/work/fe/shared')
from pw_helper import open_page
with open_page(3103,'/workbench/sales-orders?orderSource=business') as (p,ctx):
 p.on('dialog',lambda d:d.accept())
 errors=[];req=[];p.on('pageerror',lambda e:errors.append(str(e)));p.on('request',lambda r:req.append({'url':r.url,'body':r.post_data}) if 'crmSalesOrder.' in r.url else None)
 p.wait_for_selector('.__sv2_list');p.wait_for_timeout(5000)
 p.get_by_role('button',name='新建业务订单',exact=True).click();p.get_by_role('button',name='选择客户',exact=True).click();p.wait_for_timeout(1500)
 p.screenshot(path='/tmp/sal2/stg-customer-picker.png');print(p.locator('.__sv2_picker').inner_text())
 p.get_by_role('combobox',name='客户搜索范围',exact=True).select_option('enterprise');p.get_by_role('textbox',name='搜索有权限客户',exact=True).fill('A');p.get_by_role('button',name='搜索',exact=True).click();p.wait_for_timeout(1000);print('CUSTOMERS',p.locator('.__sv2_picker').inner_text());
 p.locator('.__sv2_picker tr').filter(has_text='æµ‹è¯•å®¢æˆ·A').get_by_role('button',name='选择客户',exact=True).click()
 p.get_by_role('button',name='＋ 添加物料',exact=True).click();p.wait_for_timeout(1500);p.locator('.__sv2_lot').filter(has_text='STG-PN-001').click();p.get_by_role('textbox',name='第1行销售数量',exact=True).fill('2');p.get_by_role('textbox',name='第1行销售单价',exact=True).fill('25.1256')
 p.get_by_role('button',name='＋ 添加物料',exact=True).click();p.wait_for_timeout(500);p.locator('.__sv2_lot').filter(has_text='STG-PN-002').click();p.get_by_role('textbox',name='第2行销售数量',exact=True).fill('3');p.get_by_role('textbox',name='第2行销售单价',exact=True).fill('31.2345')
 for k,(title,amount,note) in enumerate([('运费','1.2345','sal2多物料测试'),('客户返点','2.1111','精确金额测试')],1):
  p.get_by_role('button',name='＋ 添加费用',exact=True).click();p.locator(f'input[aria-label="费用第{k}行项目"]').fill(title);p.get_by_role('textbox',name=f'费用第{k}行金额',exact=True).fill(amount);p.get_by_role('textbox',name=f'费用第{k}行备注',exact=True).fill(note)
 p.get_by_role('textbox',name='约定交付日期',exact=True).fill('2026-12-10');p.get_by_role('textbox',name='客户确认说明',exact=True).fill('sal2 浏览器验证：客户确认两行物料、销售价格和交期');p.get_by_role('checkbox',name='客户已确认',exact=True).check();p.wait_for_timeout(1800)
 p.screenshot(path='/tmp/sal2/stg-new-filled.png');p.get_by_role('button',name='保存订单',exact=True).click();p.wait_for_timeout(4500);p.screenshot(path='/tmp/sal2/stg-create-success.png');print('CREATE',p.locator('.__sv2_dialog').inner_text())
 assert '订单已创建，销售费用已保存' in p.locator('.__sv2_dialog').inner_text()
 no=p.locator('.__sv2_meta').inner_text();print('NUMBER',no)
 p.get_by_role('textbox',name='第1行销售数量',exact=True).fill('3');p.get_by_role('textbox',name='第1行销售单价',exact=True).fill('26.1111');p.get_by_role('textbox',name='费用第2行金额',exact=True).fill('3.3333');p.wait_for_timeout(1800);p.get_by_role('button',name='保存修改',exact=True).click();p.wait_for_timeout(300);p.screenshot(path='/tmp/sal2/stg-review.png');print('REVIEW',p.locator('.__sv2_review').inner_text());assert p.get_by_role('button',name='确认保存',exact=True).is_disabled();p.get_by_role('textbox',name='修改原因',exact=True).fill('sal2 浏览器验收数量、单价和费用同时修改');p.get_by_role('button',name='确认保存',exact=True).click();p.wait_for_timeout(3500);p.screenshot(path='/tmp/sal2/stg-edit-saved.png');print('SAVED',p.get_by_role('alert').all_text_contents());assert '保存修改成功' in p.locator('.__sv2_dialog').inner_text()
 json.dump({'errors':errors,'requests':req,'orderMetadata':no},open('/home/ubuntu/work/fe/sal2/browser-flow.json','w'),ensure_ascii=False,indent=2)
