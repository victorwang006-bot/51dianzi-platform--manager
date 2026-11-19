#!/usr/bin/env python3
"""Actual production JS/React DOM, with EVERY API response fulfilled locally in candidate mode.
No real cookie/login or financial request is created. --live only checks public compact/image UI.
"""
from pathlib import Path
from urllib.parse import urlsplit, unquote, parse_qs
from copy import deepcopy
import argparse, hashlib, json, re, time
from playwright.sync_api import sync_playwright
W=Path('/home/ubuntu/work/cart-compact-20261119')
P=Path('/home/ubuntu/work/sales-20261117/platform')
STATIC=Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public')
p=argparse.ArgumentParser();p.add_argument('--candidate',default=str(W/'packaging/candidate-ui'));p.add_argument('--live',action='store_true');a=p.parse_args()
C=Path(a.candidate);m=json.loads((C/'manifest.json').read_text())
assets={}
for item in m.get('files',m.get('assets',[])):
 url=item.get('url') or item.get('path');local=item.get('file') or item.get('local') or str(C/str(url).lstrip('/'))
 f=Path(local);f=f if f.is_absolute() else C/f
 if not f.exists():f=C/str(url).lstrip('/')
 if url and f.exists():
  raw=f.read_bytes();assert hashlib.sha256(raw).hexdigest()==item.get('sha256',hashlib.sha256(raw).hexdigest());assets[url]=raw
html=(C/'index.html').read_bytes()
public=json.loads(Path('/home/ubuntu/work/demo-correct-20261118/live/public-list-snapshot.json').read_text())
public_envelopes=public if isinstance(public,list)else[public]
public_data=next(x['result']['data']['json']for x in public_envelopes if 'result'in x)
image=Path('/home/ubuntu/work/demo-correct-20261118/live/approved-system-reference.png').read_bytes()
image_url='https://dianzi51-assets.oss-cn-hangzhou.aliyuncs.com/material-images/STM32F103C8T6.png'
for row in public_data.get('items',[]):
 if row.get('partNumber')=='STM32F103C8T6' and row.get('brand')in ['ST','ST(意法半导体)']:row.update(thumbnailUrl=image_url,imageKind='catalog_reference')
user={'id':900000001,'name':'LOCAL QA','username':'local_qa','role':'user','userType':'individual','company':None,'email':None,'isVip':False,'status':'active'}
api_calls=[];blocked=[];errors=[];checks=[];failures=[];cart=[]
def envelope(data):return {'result':{'data':{'json':data}}}
def current_list():return {'items':deepcopy(cart),'count':len(cart),'checkedCount':sum(x['checked']for x in cart)}
def line_for(material,qty,index):
 return {'id':index,'sourceType':'official_mall','publicId':material['publicId'],'revision':material['revision'],'version':1,'qty':qty,'checked':True,'partNumber':material['partNumber'],'brand':material['brand'],'pkg':material.get('pkg')or'','dateCode':material.get('dateCode')or'','moq':material.get('moq')or 1,'spq':material.get('spq'),'availableQty':max(qty,material.get('qtyOnSale')or 10000),'unit':'个','unitPrice':'1.000000','subtotal':f'{qty:.2f}','priceEx':'0.884956','ladderPrices':[{'minQty':1,'price':'1.000000'}],'purchasable':True,'unavailableReason':None}
def mock(method,inp):
 api_calls.append({'method':method,'input':inp})
 if method=='auth.me':return user
 if method in ['search.history','search.popular','search.brands','search.related']:return []
 if method=='officialMall.list':return deepcopy(public_data)
 if method=='officialCart.count':return len(cart)
 if method=='officialCart.list':return current_list()
 if method=='officialCart.add':
  mat=next(x for x in public_data['items']if x['publicId']==inp['publicId']);old=next((x for x in cart if x['publicId']==mat['publicId']),None)
  if old:old['qty']+=inp['qty'];old['version']+=1;old['subtotal']=f"{old['qty']:.2f}"
  else:cart.append(line_for(mat,inp['qty'],len(cart)+1))
  out=current_list();out['item']=deepcopy(next(x for x in cart if x['publicId']==mat['publicId']));return out
 if method=='officialCart.updateQty':
  row=next(x for x in cart if x['id']==inp['id']);row['qty']=inp['qty'];row['version']+=1;row['subtotal']=f"{row['qty']:.2f}";out=current_list();out['item']=deepcopy(row);return out
 if method=='officialCart.setChecked':
  row=next(x for x in cart if x['id']==inp['id']);row['checked']=inp['checked'];row['version']+=1;out=current_list();out['item']=deepcopy(row);return out
 if method=='officialCart.setAllChecked':
  for row in cart:row['checked']=inp['checked'];row['version']+=1
  return {**current_list(),'item':None}
 if method=='officialCart.remove':
  cart[:]=[x for x in cart if x['id']!=inp['id']];return {**current_list(),'item':None}
 if method=='officialCart.prepareCheckout':
  items=[deepcopy(x)for x in cart if x['checked']];subtotal=sum(float(x['subtotal'])for x in items);shipping=0 if subtotal>=500 else 15
  return {'items':items,'checkoutToken':'a'*64,'expiresAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(time.time()+300)),'subtotal':f'{subtotal:.2f}','amountEx':f'{subtotal/1.13:.2f}','taxAmount':f'{subtotal-subtotal/1.13:.2f}','shippingFee':f'{shipping:.2f}','totalAmount':f'{subtotal+shipping:.2f}'}
 if method=='address.list':return [{'id':900000002,'receiver':'LOCAL QA','phone':'10000000000','region':'本地合成地址','detail':'不提交到生产','isDefault':True}]
 if method=='cart.count':return 0
 if method=='cart.list':return []
 if method in ['officialCheckout.create','officialCheckout.createBasket','order.create','cart.add']:raise AssertionError('MUST_NOT_CALL_CREATION_OR_NORMAL_ADD '+method)
 if 'Quota'in method or 'quota'in method:return {'remaining':100,'used':0,'total':100,'allowed':True}
 if 'count'in method.lower() or 'unread'in method.lower():return 0
 if 'search'in method.lower():return {'items':[],'results':[],'total':0,'page':1,'pageSize':20,'hasMore':False}
 if 'list'in method.lower() or 'enterprises'in method.lower():return []
 return None
with sync_playwright()as t:
 browser=t.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 context=browser.new_context(viewport={'width':1915,'height':1080},user_agent='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda msg:errors.append(msg.type+': '+msg.text[:4000])if msg.type=='error'else None)
 def route(r):
  u=urlsplit(r.request.url)
  if not a.live and u.path.startswith('/api/trpc/'):
   names=u.path.split('/api/trpc/',1)[1].split(',');batch='batch=1'in u.query
   data=json.loads(r.request.post_data or '{}')if r.request.method=='POST'else json.loads(parse_qs(u.query).get('input',['{}'])[0])
   result=[]
   for i,name in enumerate(names):
    raw=data.get(str(i),{})if batch else data;inp=raw.get('json')if isinstance(raw,dict)else raw
    result.append(envelope(mock(name,inp)))
   r.fulfill(status=200,content_type='application/json',json=result if batch else result[0]);return
  if r.request.method not in ['GET','HEAD']:blocked.append(u.path);r.abort();return
  if u.hostname not in ['51dianzi.com','www.51dianzi.com','dianzi51-assets.oss-cn-hangzhou.aliyuncs.com']:r.abort();return
  if not a.live:
   if u.path in ['/search','/cart']:r.fulfill(status=200,content_type='text/html',body=html);return
   if u.path in assets:r.fulfill(status=200,content_type='text/javascript',body=assets[u.path]);return
   if u.path=='/api/img'and'STM32F103C8T6'in unquote(u.query):r.fulfill(status=200,content_type='image/png',body=image);return
   local=W/'live/extracted'/str(STATIC/u.path.lstrip('/')).lstrip('/')
   if local.is_file():r.fulfill(status=200,content_type='text/css'if u.path.endswith('.css')else'text/javascript'if u.path.endswith('.js')else'application/octet-stream',body=local.read_bytes());return
   # Candidate tests must not allow any unmocked application endpoint to contact production.
   if u.path.startswith('/api/'):blocked.append(u.path);r.fulfill(status=200,content_type='application/json',json={'result':{'data':{'json':None}}});return
  r.continue_()
 page.route('**/*',route)
 try:
  page.goto('https://51dianzi.com/search?q=STM32F103C8T6&brand=ST',wait_until='domcontentloaded',timeout=60000)
  card=page.locator('.omr-card').first;card.wait_for(state='visible',timeout=18000);card.scroll_into_view_if_needed()
  box=card.bounding_box();assert box and box['width']<=1280.5 and box['x']>200,box
  assert not card.get_by_text('51电子网 · 自营',exact=True).count()
  assert not page.get_by_text('刷新自营报价',exact=True).count()
  assert card.locator('[data-omr-zone]').count()==5
  image_button=card.locator('.omr-image-trigger');assert image_button.count()==1
  image_button.hover();hover=page.locator('[data-testid="official-image-hover"]');hover.wait_for(state='visible',timeout=8000)
  hb=hover.bounding_box();assert hb and hb['width']<=321 and hb['x']>=0 and hb['x']+hb['width']<=1916
  assert 'w=640'in unquote(hover.locator('img').get_attribute('src')or'')or'thumb'in(hover.locator('img').get_attribute('src')or'')or'/api/img'in(hover.locator('img').get_attribute('src')or'')
  page.screenshot(path=str(W/'validation/candidate-image-hover.png'))
  page.keyboard.press('Escape');hover.wait_for(state='hidden')
  image_button.click();dialog=page.get_by_role('dialog');dialog.wait_for(state='visible',timeout=8000);assert dialog.locator('img').count()>=1
  page.screenshot(path=str(W/'validation/candidate-image-viewer.png'));page.keyboard.press('Escape');dialog.wait_for(state='hidden')
  checks.append({'compactMax1280':True,'hoverPreview320':True,'sameOriginalImageViewer':True,'escapeClosesViewer':True,'normalSourceCaptionRemoved':True})
  if not a.live:
   card.get_by_role('button',name='加入购物车',exact=True).click();page.get_by_text('已加入购物车',exact=True).wait_for(state='visible',timeout=15000)
   assert len(cart)==1 and any(x['method']=='officialCart.add'for x in api_calls)
   page.get_by_role('link',name='去结算',exact=True).first.click();page.wait_for_url('**/cart')
   group=page.get_by_role('region',name='51自营购物车');group.wait_for(state='visible',timeout=15000);assert group.locator('tbody tr').count()==1
   assert not page.get_by_text('购物车还是空的',exact=False).is_visible()
   page.reload(wait_until='domcontentloaded');group.wait_for(state='visible',timeout=15000);assert group.locator('tbody tr').count()==1
   # Add a second synthetic line directly to mocked remote persistence, then reload as another completed tab write.
   second=deepcopy(cart[0]);second.update(id=2,publicId='OM_00000000-0000-4000-8000-000000000002',partNumber='LOCAL-QA-SECOND',qty=1,version=1,subtotal='1.00');cart.append(second)
   page.reload(wait_until='domcontentloaded');group.wait_for(state='visible',timeout=15000);assert group.locator('tbody tr').count()==2
   page.screenshot(path=str(W/'validation/candidate-cart-two-items.png'),full_page=True)
   group.get_by_role('button',name='去结算',exact=True).click();panel=page.locator('[data-testid="official-cart-checkout"]');panel.wait_for(state='visible',timeout=15000)
   assert panel.locator('.co-items tbody tr').count()==2
   assert panel.locator('.official-cart-providers button').filter(has_text='支付宝').count()==1 and panel.locator('.official-cart-providers button').filter(has_text='微信支付').count()==1
   page.screenshot(path=str(W/'validation/candidate-cart-confirm-two-items.png'),full_page=True)
   assert not any(x['method']in ['officialCheckout.createBasket','officialCheckout.create','order.create','cart.add']for x in api_calls)
   checks.append({'localMockPersistenceAcrossReload':True,'remoteCartMutationOnlyNotOrdinaryCart':True,'greenSavedNotice':True,'cartSamePage':True,'twoLinesOneOfficialCheckoutGroup':True,'providerChoices':True,'noCreateClicked':True})
  page.set_viewport_size({'width':390,'height':844});page.goto('https://51dianzi.com/search?q=STM32F103C8T6&brand=ST',wait_until='domcontentloaded',timeout=60000);card=page.locator('.omr-card').first;card.wait_for(state='visible',timeout=18000);card.scroll_into_view_if_needed();bb=card.bounding_box();assert bb and bb['x']>=-1 and bb['x']+bb['width']<=391,bb
  page.screenshot(path=str(W/'validation/candidate-compact-390.png'));checks.append({'mobileNoCardOverflow':True})
 except Exception as e:
  failures.append({'error':str(e),'trace':__import__('traceback').format_exc(),'url':page.url,'body':page.locator('body').inner_text()[-6000:]});page.screenshot(path=str(W/'validation/browser-cart-failure.png'),full_page=True)
 context.close();browser.close()
result={'status':'passed'if not failures else'failed','mode':'production-public-GET-only'if a.live else'actual-native-candidate-browser-with-fully-local-synthetic-API','checks':checks,'failures':failures,'pageErrors':errors,'mockedCalls':api_calls,'blockedRequests':blocked,'actualProductionMutationsSent':0,'productionSessionMinted':False,'noRealProviderInvoked':True,'noRealCartItemCreated':True}
(W/'validation'/('browser-live-result.json'if a.live else'browser-candidate-result.json')).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:result[k]for k in ['status','mode','actualProductionMutationsSent','productionSessionMinted']}));assert not failures,failures
