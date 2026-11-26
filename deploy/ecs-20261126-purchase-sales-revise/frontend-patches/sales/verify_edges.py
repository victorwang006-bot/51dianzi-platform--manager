import sys,json,re
sys.path.insert(0,'/home/ubuntu/work/fe/shared')
from pw_helper import open_page
summary={}
with open_page(3103,'/workbench/sales-orders?orderSource=business') as (p,ctx):
 p.on('dialog',lambda d:d.accept());requests=[];errors=[];p.on('pageerror',lambda e:errors.append(str(e)));p.on('request',lambda r:requests.append(r.url) if 'crmSalesOrder.' in r.url else None)
 p.wait_for_selector('.__sv2_list');p.wait_for_timeout(4500);initial=list(requests)
 for tab in ['待出货','待收款','已完成','已取消','全部']:p.get_by_role('tab',name=tab,exact=True).click();p.wait_for_timeout(250)
 p.wait_for_timeout(500);summary['initialRequests']=initial;summary['tabExtraRequests']=requests[len(initial):]
 p.get_by_role('button',name='XS20261126-8',exact=True).click();p.wait_for_selector('input[aria-label="第1行销售数量"]');p.get_by_role('textbox',name='第1行销售单价',exact=True).fill('21');p.get_by_role('button',name='保存修改',exact=True).click();p.get_by_role('textbox',name='修改原因',exact=True).fill('sal2 验收后端数量拒绝（拦截请求模拟状态漂移）')
 def reject_qty(route):
  data=json.loads(route.request.post_data)
  if '0' in data:data['0']['json']['lines'][0]['orderedQty']=1
  else:data['json']['lines'][0]['orderedQty']=1
  route.continue_(post_data=json.dumps(data))
 p.route('**/api/business-trpc/crmSalesOrder.revise*',reject_qty);p.get_by_role('button',name='确认保存',exact=True).click();p.wait_for_timeout(1200);p.screenshot(path='/tmp/sal2/stg-backend-qty-reject.png');summary['quantityReject']=p.get_by_role('alert').all_text_contents();assert any('不能少于已出货' in x for x in summary['quantityReject']);p.unroute('**/api/business-trpc/crmSalesOrder.revise*',reject_qty)
 def reject_paid(route):
  data=json.loads(route.request.post_data);payload=data['0']['json'] if '0' in data else data['json']
  for l in payload['lines']:l['unitPrice']='0.01'
  route.continue_(post_data=json.dumps(data))
 p.route('**/api/business-trpc/crmSalesOrder.revise*',reject_paid);p.get_by_role('button',name='确认保存',exact=True).click();p.wait_for_timeout(1200);p.screenshot(path='/tmp/sal2/stg-backend-paid-reject.png');summary['paidReject']=p.get_by_role('alert').all_text_contents();assert any('不能低于已收款' in x for x in summary['paidReject']);summary['pageErrors']=errors
with open_page(3103,'/workbench/sales-orders?orderSource=business') as (p,ctx):
 def strip_cost(route):
  response=route.fetch();data=response.json()
  def clean(o):
   if isinstance(o,dict):
    for k in list(o):
     if k in ['profitBreakdown','commissionPreview','costSnapshot'] or re.search(r'cost|Cost|Profit|profit|commission|Commission|goodsAmount|procurementExpenseAmount',k):del o[k]
     else:clean(o[k])
   elif isinstance(o,list):
    for x in o:clean(x)
  clean(data);route.fulfill(response=response,json=data)
 p.route('**/api/business-trpc/crmSalesOrder.*',strip_cost);p.wait_for_selector('.__sv2_list');p.wait_for_timeout(4500);p.screenshot(path='/tmp/sal2/stg-no-cost-list.png');assert '净利润' not in p.locator('.__sv2_scope').first.inner_text();p.get_by_role('button',name='XS20261126-8',exact=True).click();p.wait_for_selector('input[aria-label="第1行销售数量"]');p.wait_for_timeout(1200);p.screenshot(path='/tmp/sal2/stg-no-cost-editor.png');text=p.locator('.__sv2_dialog').inner_text();assert all(t not in text for t in ['利润与提成','净利润','采购成本','单件成本','单件差价']);summary['noCostEditorText']=text
json.dump(summary,open('/home/ubuntu/work/fe/sal2/browser-edges.json','w'),ensure_ascii=False,indent=2);print(json.dumps(summary,ensure_ascii=False,indent=2))
