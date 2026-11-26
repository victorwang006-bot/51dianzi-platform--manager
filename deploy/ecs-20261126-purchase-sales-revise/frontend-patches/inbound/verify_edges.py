import sys,json,time,re
from pathlib import Path
sys.path.insert(0,'/home/ubuntu/work/fe/shared');from pw_helper import open_page
OUT=Path('/tmp/inb2');STAMP=str(int(time.time()))[-7:];results={};errors=[];sent=[]
def trpc_error(message,code='BAD_REQUEST',status=400,path='inbound.create'):
 return json.dumps([{'error':{'json':{'message':message,'code':-32003 if status==403 else -32600,'data':{'code':code,'httpStatus':status,'path':path}}}}])
with open_page(3102,'/workbench/inbound',1440,960) as (page,ctx):
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda req: sent.append({'url':req.url.split('?')[0],'data':req.post_data_json}) if req.method=='POST' and 'business-trpc' in req.url else None)
 page.get_by_role('button',name='新建采购入库',exact=True).wait_for(timeout=180000);page.locator('table tbody tr').first.wait_for(timeout=180000)
 page.screenshot(path=str(OUT/'final-list-all.png'));results['all_count']=page.locator('table tbody tr').count()
 tab=page.get_by_role('tab',name=re.compile('已作废'));tab.click();page.wait_for_timeout(2000);page.screenshot(path=str(OUT/'cancelled-list.png'))
 if page.locator('table tbody tr').count():
  page.locator('table tbody tr').first.click();d=page.get_by_role('dialog',name='编辑入库单',exact=True)
  try:
   d.wait_for(timeout=15000);page.screenshot(path=str(OUT/'cancelled-editor.png'));results['cancelled_open']=True;d.get_by_role('button',name='取消',exact=True).click()
  except Exception:
   results['cancelled_open']=False;results['cancelled_error']=page.locator('body').inner_text()[-900:];page.screenshot(path=str(OUT/'cancelled-open-error.png'));print('CANCELLED BLOCK',results['cancelled_error'])
 page.get_by_role('tab',name=re.compile('全部')).click();page.wait_for_timeout(1500)
 def new(pn):
  page.get_by_role('button',name='新建采购入库',exact=True).click();d=page.get_by_role('dialog',name='新建采购入库单',exact=True);d.wait_for();page.wait_for_function("() => document.querySelector('.i2-modal select[aria-label=采购员]')?.value",timeout=180000)
  d.get_by_label('供应商名称',exact=True).fill('INB2边界与附件验证');d.get_by_label('物料1 料号/型号',exact=True).fill(pn);d.get_by_label('物料1 数量',exact=True).fill('10');d.get_by_label('物料1 单价',exact=True).fill('1.23');d.get_by_label('费用1 金额',exact=True).fill('2.01');return d
 # Frontend friendly validation; no create request allowed for a malformed fee.
 d=new('INB2-N'+STAMP);d.get_by_label('费用1 金额',exact=True).fill('1.234');n=len(sent);print('PREVALIDATE ACTIONS',d.locator('.i2-actions').inner_text());d.get_by_role('button',name='保存为在途',exact=True).click();page.wait_for_timeout(500);results['fee_validation']=d.locator('[role=alert]').inner_text();assert len(sent)==n;page.screenshot(path=str(OUT/'validation-fee.png'));d.get_by_label('费用1 金额',exact=True).fill('2.01')
 # Network injection aborts before backend; same request is retried by the UI.
 page.route('**/api/business-trpc/inbound.create*',lambda route:route.abort('failed'))
 d.get_by_role('button',name='保存为在途',exact=True).click();d.get_by_role('button',name='重试原请求',exact=True).wait_for(timeout=90000);results['network_message']=d.locator('[role=alert]').inner_text();assert d.get_by_label('物料1 数量',exact=True).is_disabled();page.screenshot(path=str(OUT/'network-retry.png'));page.unroute('**/api/business-trpc/inbound.create*');d.get_by_role('button',name='重试原请求',exact=True).click();d.wait_for(state='hidden',timeout=180000);results['network_retry_saved']=True;print('NETWORK OK',results['network_message'])
 # Fee-step partial failure injection AFTER the real create, followed by replay.
 d=new('INB2-P'+STAMP);done={'first':False}
 def partial_create(route):
  response=route.fetch()
  if not done['first']:
   done['first']=True;route.fulfill(status=400,content_type='application/json',body=trpc_error('入库单 RK模拟 已创建，但采购费用未保存：联调模拟费用步骤暂不可用'))
  else:route.fulfill(response=response)
 page.route('**/api/business-trpc/inbound.create*',partial_create);d.get_by_role('button',name='保存为在途',exact=True).click();d.get_by_role('button',name='重试原请求',exact=True).wait_for(timeout=90000);results['create_partial_message']=d.locator('[role=alert]').inner_text();page.screenshot(path=str(OUT/'create-partial-retry.png'));d.get_by_role('button',name='重试原请求',exact=True).click();d.wait_for(state='hidden',timeout=180000);page.unroute('**/api/business-trpc/inbound.create*');results['create_partial_retry_saved']=True;print('CREATE PARTIAL RETRY OK',results['create_partial_message'])
 # Received order: real revision succeeds, injected details 403 fails, clear partial notice.
 page.locator('table tbody tr').filter(has_text='INB2-S5665461').click();d=page.get_by_role('dialog',name='编辑入库单',exact=True);d.wait_for();d.get_by_label('费用1 金额',exact=True).wait_for(timeout=180000)
 original_qty=d.get_by_label('物料1 数量',exact=True).input_value();d.get_by_label('物料1 数量',exact=True).fill(str(int(original_qty)+1));d.get_by_label('供应商联系人',exact=True).fill('INB2资料步骤失败待补录')
 page.route('**/api/business-trpc/inbound.updateDetails*',lambda route:route.fulfill(status=403,content_type='application/json',body=trpc_error('Forbidden','FORBIDDEN',403,'inbound.updateDetails')))
 d.get_by_role('button',name='保存修改',exact=True).click();confirm=page.get_by_role('dialog',name='确认修改',exact=True);confirm.get_by_label('修改原因',exact=True).fill('INB2模拟资料步骤失败，校验部分成功提示');confirm.get_by_role('button',name='确认保存',exact=True).click();d.get_by_role('button',name='关闭并重新打开',exact=True).wait_for(timeout=30000);results['revision_partial_message']=d.locator('[role=alert]').inner_text();assert '已成功' in results['revision_partial_message'];assert '权限' in results['revision_partial_message'];page.screenshot(path=str(OUT/'revision-partial-failure.png'));d.get_by_role('button',name='关闭并重新打开',exact=True).click();page.unroute('**/api/business-trpc/inbound.updateDetails*')
 # Reopen, save only unfinished details, and exercise attachments UI and actual uploads.
 page.locator('table tbody tr').filter(has_text='INB2-S5665461').click();d=page.get_by_role('dialog',name='编辑入库单',exact=True);d.wait_for();d.get_by_label('供应商联系人',exact=True).fill('INB2资料步骤已补录')
 d.get_by_role('button',name=re.compile('照片与备注')).click();page.screenshot(path=str(OUT/'photos-documents-expanded.png'));print('ATTACH INPUTS',d.locator('input[type=file]').evaluate_all('(nodes)=>nodes.map(n=>n.getAttribute("aria-label"))'))
 try:
  d.locator('input[type=file]').first.set_input_files('/home/ubuntu/work/demo/p-edit.png');page.wait_for_function("() => document.querySelectorAll('.i2-photos img').length>0",timeout=90000);results['photo_upload']=True
 except Exception as e:results['photo_upload']=str(e)[:180]
 docInputs=d.locator('[data-testid=inbound-documents] input[type=file]')
 if docInputs.count():
  try:
   docInputs.first.set_input_files('/home/ubuntu/work/demo/p-edit.png');page.wait_for_timeout(3500);results['document_ui']=d.locator('[data-testid=inbound-documents]').inner_text();page.screenshot(path=str(OUT/'photos-documents-uploaded.png'))
  except Exception as e:results['document_upload']=str(e)[:180]
 # If an upload failed, do not allow it to block finishing details; save only if enabled.
 if d.get_by_role('button',name='保存修改',exact=True).is_enabled():
  d.get_by_role('button',name='保存修改',exact=True).click();d.wait_for(state='hidden',timeout=180000);results['details_recovery_saved']=True
 else:results['details_recovery_saved']=False;page.screenshot(path=str(OUT/'attachment-blocked.png'))
 results['errors']=errors
 (OUT/'edge-results.json').write_text(json.dumps({'results':results,'requests':sent},ensure_ascii=False,indent=2));print('RESULTS',json.dumps(results,ensure_ascii=False));assert not errors
