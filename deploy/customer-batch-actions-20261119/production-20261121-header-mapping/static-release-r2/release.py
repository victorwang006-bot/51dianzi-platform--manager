#!/usr/bin/env python3
"""One owned static attempt; reuses original Locks/Writer, no API/process operations."""
import copy,json,os,select,sys,time,traceback
from pathlib import Path
import safety_core as h
HERE=Path(__file__).resolve().parent
class Config:
 stage=HERE
 front=Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
 assets=front/'assets';html=front/'index.html'
 coord=Path('/opt/ops/51-project-release-coordination-20261027.json')
 locks=(Path('/var/lock/dianzi51-public-deploy.lock'),Path('/var/lock/dianzi51-production-code.lock'))
 fixture_root=None
C=Config();OWNER='6Lfttf6oVWJ8YS69o5FkXQ';SCOPE='customer-upload-header-mapping-20261121-6Lfttf6o-r2-1216'
def emit(event,**kw): print(json.dumps(dict(event=event,**kw),ensure_ascii=False),flush=True)
def identity(r): return {k:v for k,v in r.items() if k!='atimeNs'}
class Guard:
 def __init__(self,locks,records,dirs,absent,sourcepins,servingAlias):
  self.locks=locks;self.expected={'protectedFiles':copy.deepcopy(records),'protectedDirectories':copy.deepcopy(dirs)}
  self.cache=copy.deepcopy(records);self.absent=set(absent);self.sourcepins=sourcepins;self.started=time.time();self.atime={};self.servingAlias=servingAlias
 def read(self,path):
  key=str(path);meta=h.metadata(path);old=self.cache.get(key)
  # Full bytes already hashed; exact non-atime inode/size/mtime/ctime/owner/mode/link identity binds reuse.
  if old and identity(meta)==identity({k:v for k,v in old.items() if k not in ('sha256','kind')}):
   result=dict(old,atimeNs=meta['atimeNs'])
  else: result=h.describe(path);self.cache[key]=result
  return result
 def check(self):
  self.locks.check();h.need(time.time()-self.started<900,'CURRENT_TARGET_BUDGET_EXPIRED')
  for key,pin in self.sourcepins.items():
   h.need(h.H(h.regular(HERE/key))==pin,'TOOL_OR_MANIFEST_DRIFT:'+key)
  alias=Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/public')
  h.need(alias.is_symlink() and os.readlink(alias)==str(C.front),'SERVING_ALIAS_DRIFT')
  h.need(str(alias)==self.servingAlias['path'] and h.metadata(alias)==self.servingAlias['metadata'],'SERVING_ALIAS_FULL_IDENTITY_DRIFT')
  for key,expected in self.expected['protectedFiles'].items():
   actual=self.read(Path(key))
   if identity(actual)!=identity(expected):
    fields={k:{'expected':expected.get(k),'actual':actual.get(k)} for k in set(expected)|set(actual) if k!='atimeNs' and expected.get(k)!=actual.get(k)}
    raise h.ReleaseError('TARGET_OR_DEPENDENCY_DRIFT:'+key+':'+json.dumps(fields,sort_keys=True))
   if actual.get('atimeNs')!=expected.get('atimeNs'):self.atime[key]={'baseline':expected['atimeNs'],'observed':actual['atimeNs'],'otherFieldsExact':True}
  for key in self.absent:h.need(not Path(key).exists() and not Path(key).is_symlink(),'IMMUTABLE_COLLISION:'+key)
  for key,expected in self.expected['protectedDirectories'].items():
   actual=h.metadata(h.no_symlink(Path(key)))
   h.need(h.stable(actual)==h.stable(expected),'PARENT_IDENTITY_PERMISSION_DRIFT:'+key)
  self.locks.check()
 def own_file(self,p,old,new):
  key=str(p);expected=self.expected['protectedFiles'].get(key)
  h.need((expected is None and old is None) or identity(expected)==identity(old),'OWN_FILE_DELTA:'+key)
  if new is None:self.expected['protectedFiles'].pop(key,None);self.cache.pop(key,None)
  else:self.expected['protectedFiles'][key]=copy.deepcopy(new);self.cache[key]=copy.deepcopy(new);self.absent.discard(key)
 def own_directory(self,p,old,new):
  expected=self.expected['protectedDirectories'][str(p)]
  h.need(h.stable(expected)==h.stable(old)==h.stable(new),'OWN_PARENT_DELTA:'+str(p))
  self.expected['protectedDirectories'][str(p)]=new
 def current_owned(self,p,record):
  actual=h.describe(p);h.need(identity(actual)==identity(record),'CURRENT_OWNED_CAS:'+str(p));return actual

def get(url):
 import urllib.request
 request=urllib.request.Request('https://admin.51dianzi.com'+url,headers={'Cache-Control':'no-cache','Accept-Encoding':'identity'})
 with urllib.request.urlopen(request,timeout=15) as response:
  h.need(response.status==200,'PUBLIC_HTTP_STATUS:'+url);return response.read()

def main():
 h.need(len(sys.argv)==3,'PINNED_ARGUMENTS_REQUIRED')
 raw=h.regular(HERE/'candidate/manifest.json');h.need(h.H(raw)==sys.argv[1],'MANIFEST_FULL_SHA')
 review=h.decode(h.regular(HERE/'review.json'));h.need(h.H(h.regular(HERE/'review.json'))==sys.argv[2] and review['manifestSHA']==sys.argv[1] and review['status']=='APPROVED' and review['reviewer']!=OWNER,'ONE_INDEPENDENT_APPROVAL_REQUIRED')
 h.need(review.get('schema')=='integrated-front-review-v1' and review.get('reviewer')=='independent-integrated-review','FIXED_REVIEW_SCHEMA_REVIEWER')
 h.need(h.H(h.regular(HERE/'release.py'))==h.pin(review.get('releaseSHA')),'REVIEW_RELEASE_SOURCE_PIN')
 h.need(h.H(h.regular(HERE/'safety_core.py'))==h.pin(review.get('helperSHA')),'REVIEW_HELPER_SOURCE_PIN')
 m=h.decode(raw);h.need(m['ownerTask']==OWNER and m['scope']==SCOPE and m['authorization']['choice']=='实施','AUTHORIZED_SCOPE')
 h.need(m['apiWrites']==m['databaseWrites']==m['reloads']==m['timerPauses']==0,'STATIC_ONLY')
 h.need(m.get('acceptanceReadOnlyAuthorization',{}).get('nonGETs')==0 and m['acceptanceReadOnlyAuthorization']['authMode']=='anonymous','READONLY_BROWSER_COMPAT_CONFIRMATION_REQUIRED')
 beforeSHA=m['htmlBeforeSHA'];after=h.regular(HERE/'candidate/index.html');h.need(h.H(after)==m['htmlAfterSHA'],'HTML_AFTER_FULL_SHA')
 assets=m['assets'];h.need(len({x['url'] for x in assets})==len(assets),'UNIQUE_ASSETS')
 for row in assets:
  h.need(row['url'].startswith('/assets/') and Path(row['url']).name==row['url'][8:],'FLAT_IMMUTABLE_ASSETS')
  data=h.regular(HERE/'candidate'/row['url'][1:]);h.need(h.H(data)==row['sha256'] and len(data)==row['size'],'CANDIDATE_ASSET_PIN:'+row['url'])
 locks=h.Locks(C).acquire();opened=None;installed=None;writer=None;guard=None;opening_attempted=False
 try:
  for name in ('attempt.json','confirmed.json','restored.json','before.html','before.json'):
   h.need(not (HERE/name).exists(),'NO_REPLAY:'+name)
  coordraw=h.regular(C.coord);coord=h.decode(coordraw);w=coord.get('window',{})
  h.need(coord.get('shared_release_active') is False and coord.get('needsOperatorRecovery',False) is False and w.get('status') in ('closed','verified') and w.get('needsOperatorRecovery') is False,'COORD_NOT_CLOSED')
  h.need(h.H(coordraw)==m['expectedCoordSHA'],'CURRENT_CLOSED_COORD_BINDING')
  before=h.regular(C.html);br=h.describe(C.html);h.need(h.H(before)==beforeSHA,'CURRENT_ADMIN_CHANGED')
  h.need(identity(br)==identity(m['expectedBaselineHtmlRecord']),'CURRENT_HTML_IDENTITY_CHANGED')
  records={str(C.coord):h.describe(C.coord),str(C.html):br};dirs={str(p):h.metadata(h.no_symlink(p)) for p in (C.front,C.assets,C.coord.parent,HERE)};absent=[];reuse=[]
  for row in m['existingDependencies']:
   p=C.front/row['url'][1:];r=h.describe(p);h.need(identity(r)==identity(row['record']),'CURRENT_EXISTING_DEPENDENCY_CHANGED:'+row['url']);records[str(p)]=r
  for row in m['protectedFiles']:
   p=Path(row['path']);r=h.describe(p);h.need(identity(r)==identity(row['record']),'CURRENT_PROTECTED_FILE_CHANGED:'+row['path']);records[str(p)]=r
  for row in assets:
   p=C.front/row['url'][1:];h.no_symlink(p)
   if p.exists():
    r=h.describe(p);h.need(r['sha256']==row['sha256'] and r['size']==row['size'] and r['nlink']==1 and r['uid']==0 and (r['statmode']&0o022)==0,'EXISTING_ASSET_COLLISION:'+row['url']);records[str(p)]=r;reuse.append(row['url'])
   else:absent.append(str(p))
  sourcepins={'release.py':review['releaseSHA'],'safety_core.py':review['helperSHA'],'candidate/manifest.json':sys.argv[1],'review.json':sys.argv[2]}
  guard=Guard(locks,records,dirs,absent,sourcepins,m['servingAlias']);guard.check();writer=h.Writer(C,locks,guard)
  captured=h.now();emit('CURRENT_TARGET_BINDING_COMPLETE',assets=len(assets),reuse=len(reuse),capturedAtUtc=captured,deadlineSeconds=900)
  opening=copy.deepcopy(coord);opening['shared_release_active']=True;opening['needsOperatorRecovery']=False;opening['window']={'status':'opening','owner_task':OWNER,'scope':SCOPE,'openedAtUtc':h.now(),'manifestSHA':sys.argv[1],'needsOperatorRecovery':False}
  openingraw=h.encode(opening)
  def open_witness(rec):
   nonlocal opened;opened=(openingraw,rec)
  opening_attempted=True
  writer.replace(C.coord,coordraw,openingraw,records[str(C.coord)],on_replace=open_witness)
  writer.exclusive(HERE/'before.html',before);writer.exclusive(HERE/'before.json',h.encode({'originalRecord':br,'bytesSHA':beforeSHA,'savedRecord':h.describe(HERE/'before.html')}))
  writer.exclusive(HERE/'attempt.json',h.encode({'ownerTask':OWNER,'scope':SCOPE,'manifestSHA':sys.argv[1],'reviewSHA':sys.argv[2],'capturedAtUtc':captured,'singleUse':True}))
  for i,row in enumerate(assets):
   if row['url'] not in reuse:
    data=h.regular(HERE/'candidate'/row['url'][1:])
    h.need(h.H(data)==row['sha256'] and len(data)==row['size'],'ACTUAL_PUBLISH_BYTES_PIN:'+row['url'])
    writer.publish(C.front/row['url'][1:],data)
   if i%50==0:emit('IMMUTABLE_ASSET_PROGRESS',completed=i+1,total=len(assets))
  guard.check();current=guard.current_owned(C.html,br);guard.expected['protectedFiles'][str(C.html)]=current
  def html_witness(rec):
   nonlocal installed;installed=(after,rec)
  writer.replace(C.html,before,after,current,preserve=current,on_replace=html_witness)
  h.need(get('/')==after,'PUBLIC_INSTALLED_HTML_FULL_BYTES')
  for url in (*m['moduleScripts'],m['stylesheet']):
   row=next(r for r in assets if r['url']==url);h.need(h.H(get(url))==row['sha256'],'PUBLIC_ENTRY_HASH:'+url)
  guard.check();emit('INSTALLED_AWAITING_ACTUAL_PAGE_CONFIRMATION',htmlSHA=m['htmlAfterSHA'],confirmBudgetSeconds=240)
  ready=select.select([sys.stdin],[],[],240)[0];ack=h.decode(sys.stdin.buffer.readline()) if ready else {'status':'TIMEOUT'}
  h.need(ack.get('status')=='ACTUAL_HEADER_MAPPING_STATIC_CONFIRMED' and ack.get('htmlSHA')==m['htmlAfterSHA'] and ack.get('transportedNonGET')==0 and ack.get('anonymousNoCookies') is True and ack.get('actualBothNativeUploadLeavesPinned') is True and ack.get('actualHeaderMappingCssPinned') is True and ack.get('actualHtmlReferencesPinned') is True and ack.get('fullLoggedInUploadClaimed') is False,'ACTUAL_HEADER_MAPPING_CONFIRMATION_FAILED:'+str(ack.get('status')))
  guard.check();receipt={'schema':'integrated-front-release-receipt-v1','status':'verified','ownerTask':OWNER,'scope':SCOPE,'manifestSHA':sys.argv[1],'htmlBeforeSHA':beforeSHA,'htmlAfterSHA':m['htmlAfterSHA'],'assetCount':len(assets),'reusedAssets':reuse,'observedAtimeChanges':guard.atime,'pageConfirmation':ack,'acceptanceGuestQueryLedgerWritesAuthorized':False,'acceptanceGuestBeginCount':0,'acceptanceGuestPrimaryQueryCount':0,'fullLoggedInEnterpriseBusinessAcceptanceClaimed':False,'deploymentBusinessDataWrites':0,'confirmedAtUtc':h.now(),'apiWrites':0,'databaseWrites':0,'reloads':0,'timerPauses':0}
  receiptRaw=h.encode(receipt);writer.exclusive(HERE/'confirmed.json',receiptRaw)
  closing=copy.deepcopy(opening);closing['shared_release_active']=False;closing['window'].update(status='closed',closedAtUtc=h.now(),receiptSHA=h.H(receiptRaw),needsOperatorRecovery=False)
  writer.replace(C.coord,opened[0],h.encode(closing),opened[1]);guard.check();locks.release();emit('VERIFIED_DURABLE_CLOSED',receiptSHA=h.H(receiptRaw),htmlSHA=m['htmlAfterSHA'],locksReleased=True);return
 except BaseException as error:
  emit('RELEASE_ERROR',error=str(error),installed=installed is not None,opened=opened is not None)
  if opened is None:
   if opening_attempted:
    try:
     locks.check();h.need(h.describe(C.coord)==records[str(C.coord)] and h.regular(C.coord)==coordraw,'UNWITNESSED_OPENING_NOT_UNCHANGED')
    except BaseException as uncertain:
     emit('FAILUREHOLD_UNWITNESSED_OPENING',error=str(uncertain));locks.hold(str(uncertain));raise
   locks.release();raise
  try:
   guard.check()
   if installed:
    current=guard.current_owned(C.html,installed[1]);guard.expected['protectedFiles'][str(C.html)]=current
    writer.replace(C.html,installed[0],before,current,preserve=br)
   h.need(get('/')==before,'ROLLBACK_PUBLIC_HTML_BYTES');guard.check()
   receipt={'status':'restored','ownerTask':OWNER,'scope':SCOPE,'error':str(error),'restoredHTMLSHA':beforeSHA,'restoredAtUtc':h.now(),'retainedOwnImmutable':True}
   raw=h.encode(receipt);writer.exclusive(HERE/'restored.json',raw)
   closed=copy.deepcopy(opening);closed['shared_release_active']=False;closed['window'].update(status='closed',closedAtUtc=h.now(),receiptSHA=h.H(raw),result='restored',needsOperatorRecovery=False)
   writer.replace(C.coord,opened[0],h.encode(closed),opened[1]);guard.check();locks.release();emit('PRECISE_ROLLBACK_CLOSED',receiptSHA=h.H(raw),locksReleased=True);return
  except BaseException as inverse:
   emit('FAILUREHOLD_REQUIRED',originalError=str(error),rollbackError=str(inverse));locks.hold(str(inverse));raise
if __name__=='__main__':
 try:main()
 except BaseException:traceback.print_exc();sys.exit(1)
