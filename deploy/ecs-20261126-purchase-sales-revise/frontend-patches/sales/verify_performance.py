import sys,json,copy,urllib.parse
sys.path.insert(0,'/home/ubuntu/work/fe/shared')
from pw_helper import open_page
base=json.load(open('/home/ubuntu/work/fe/sal2/get-8.json'))['result']['data']['json']
rows=[]
for k in range(20):
 x=copy.deepcopy(base);x['id']=100000+k;x['orderNumber']='VISIBLE-TEST-'+str(k+1);x.pop('items',None);x.pop('audits',None);x.pop('profitBreakdown',None);x.pop('commissionPreview',None);rows.append(x)
gets=[];http=[]
with open_page(3103,'/workbench/sales-orders?orderSource=business') as (p,c):
 def list_response(route):
  route.fulfill(status=200,content_type='application/json',body=json.dumps([{'result':{'data':{'json':{'items':rows,'total':20,'page':1,'pageSize':20}}}}]))
 def get_response(route):
  url=route.request.url;input=json.loads(urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)['input'][0]);ids=[i['json']['id'] for i in input.values()];http.append(ids);gets.extend(ids);out=[]
  for id in ids:
   data=copy.deepcopy(base);data['id']=id;data['orderNumber']='VISIBLE-TEST-'+str(id-99999);out.append({'result':{'data':{'json':data}}})
  route.fulfill(status=200,content_type='application/json',body=json.dumps(out))
 p.route('**/api/business-trpc/crmSalesOrder.list*',list_response);p.route('**/api/business-trpc/crmSalesOrder.get*',get_response);p.wait_for_selector('.__sv2_list');p.wait_for_timeout(4500);initial=list(gets);initialHttp=list(http);visible=p.locator('[data-order-id]').evaluate_all('(els)=>els.filter(x=>{let r=x.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight}).length');p.screenshot(path='/tmp/sal2/stg-visible-performance.png');p.get_by_role('tab',name='待出货',exact=True).click();p.get_by_role('tab',name='全部',exact=True).click();p.wait_for_timeout(1500);afterTab=list(gets);p.evaluate('window.scrollTo(0,document.body.scrollHeight)');p.wait_for_timeout(2000);bottom=list(gets)
 result={'syntheticResponseOnly':True,'rows':20,'visibleInitially':visible,'initialGetProcedures':len(initial),'initialGetHttp':len(initialHttp),'initialBatches':initialHttp,'maxBatch':max(map(len,http)),'tabExtraGetProcedures':len(afterTab)-len(initial),'totalAfterScroll':len(bottom),'uniqueAfterScroll':len(set(bottom))};assert len(initial)<20 and max(map(len,http))<=3 and len(afterTab)==len(initial);json.dump(result,open('/home/ubuntu/work/fe/sal2/performance.json','w'),ensure_ascii=False,indent=2);print(result)
