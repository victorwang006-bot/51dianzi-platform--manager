#!/usr/bin/env python3
"""Offline-only adaptation of the previously closed static release, not the API controller."""
import ast,difflib,hashlib,json,shutil
from pathlib import Path
W=Path('/home/ubuntu/work/customer-upload-header-mapping-20261121-1058')
BASE=W/'static-tools-handoff/browser-compat-static-tools-handoff/source'
O=W/'static-release';O.mkdir(mode=0o700,exist_ok=True)
assert not (O/'independent-review.json').exists(),'OFFLINE_TOOL_FREEZE_AFTER_REVIEW'
H=lambda b:hashlib.sha256(b).hexdigest()
helper=(BASE/'safety_core.py').read_bytes();assert H(helper)=='463d5822c057df2fc0e6f2277c6eb14dd630e5fa71eb2b714b3bdebd38eee01e'
(O/'safety_core.py').write_bytes(helper)
s=(BASE/'release.py').read_text();changes=[]
def replace(old,new):
 global s
 assert s.count(old)==1,old[:80]
 s=s.replace(old,new);changes.append({'before':old,'after':new})
replace("front=Path('/opt/releases/20261031-homepage-banner-v39/front/dist/public')", "front=Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')")
replace("C=Config();OWNER='qp4e5jVmsAp0UHKwymyD5X';SCOPE='browser-compat-release-20261121-1131'", "C=Config();OWNER='6Lfttf6oVWJ8YS69o5FkXQ';SCOPE='customer-upload-header-mapping-20261121-6Lfttf6o-1156'")
replace("  alias=Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/public')\n  h.need(alias.is_symlink() and os.readlink(alias)==str(C.front),'SERVING_ALIAS_DRIFT')", "  alias=Path('/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/public')\n  h.need(alias.is_symlink() and os.readlink(alias)==str(C.front),'SERVING_ALIAS_DRIFT')")
replace("urllib.request.Request('https://51dianzi.com'+url", "urllib.request.Request('https://admin.51dianzi.com'+url")
replace(" def __init__(self,locks,records,dirs,absent,sourcepins):", " def __init__(self,locks,records,dirs,absent,sourcepins,servingAlias):")
replace("  self.cache=copy.deepcopy(records);self.absent=set(absent);self.sourcepins=sourcepins;self.started=time.time();self.atime={}", "  self.cache=copy.deepcopy(records);self.absent=set(absent);self.sourcepins=sourcepins;self.started=time.time();self.atime={};self.servingAlias=servingAlias")
replace("  h.need(alias.is_symlink() and os.readlink(alias)==str(C.front),'SERVING_ALIAS_DRIFT')", "  h.need(alias.is_symlink() and os.readlink(alias)==str(C.front),'SERVING_ALIAS_DRIFT')\n  h.need(str(alias)==self.servingAlias['path'] and h.metadata(alias)==self.servingAlias['metadata'],'SERVING_ALIAS_FULL_IDENTITY_DRIFT')")
replace("  before=h.regular(C.html);br=h.describe(C.html);h.need(h.H(before)==beforeSHA,'CURRENT_FRONT_CHANGED')", "  h.need(h.H(coordraw)==m['expectedCoordSHA'],'CURRENT_CLOSED_COORD_BINDING')\n  before=h.regular(C.html);br=h.describe(C.html);h.need(h.H(before)==beforeSHA,'CURRENT_ADMIN_CHANGED')")
replace("  for row in assets:\n   p=C.front/row['url'][1:];h.no_symlink(p)", "  for row in m['protectedFiles']:\n   p=Path(row['path']);r=h.describe(p);h.need(identity(r)==identity(row['record']),'CURRENT_PROTECTED_FILE_CHANGED:'+row['path']);records[str(p)]=r\n  for row in assets:\n   p=C.front/row['url'][1:];h.no_symlink(p)")
replace("  guard=Guard(locks,records,dirs,absent,sourcepins);guard.check();writer=h.Writer(C,locks,guard)", "  guard=Guard(locks,records,dirs,absent,sourcepins,m['servingAlias']);guard.check();writer=h.Writer(C,locks,guard)")
replace("  h.need(ack.get('status')=='ACTUAL_BROWSER_COMPAT_CONFIRMED' and ack.get('htmlSHA')==m['htmlAfterSHA'] and ack.get('transportedNonGET')==0 and ack.get('transportedGuestGrantPOSTs')==0 and ack.get('transportedGuestSearchGETs')==0 and ack.get('anonymousNoCookies') is True and ack.get('personalWorkspaceDOMConfirmed') is True and ack.get('mallWorkbenchEntryDOMConfirmed') is True and ack.get('enterpriseAnonymousGateConfirmed') is True and ack.get('actualOldEngineCompatCSSAndLayoutConfirmed') is True and ack.get('actualModernEngineOriginalCSSConfirmed') is True,'ACTUAL_BROWSER_COMPAT_CONFIRMATION_FAILED:'+str(ack.get('status')))", "  h.need(ack.get('status')=='ACTUAL_HEADER_MAPPING_STATIC_CONFIRMED' and ack.get('htmlSHA')==m['htmlAfterSHA'] and ack.get('transportedNonGET')==0 and ack.get('anonymousNoCookies') is True and ack.get('actualBothNativeUploadLeavesPinned') is True and ack.get('actualHeaderMappingCssPinned') is True and ack.get('actualHtmlReferencesPinned') is True and ack.get('fullLoggedInUploadClaimed') is False,'ACTUAL_HEADER_MAPPING_CONFIRMATION_FAILED:'+str(ack.get('status')))")
# Unchanged acquire/write/backup/close/rollback and failurehold control-flow remain visible.
reverse=s
for change in reversed(changes):reverse=reverse.replace(change['after'],change['before'],1)
assert reverse==(BASE/'release.py').read_text()
compile(s,str(O/'release.py'),'exec');(O/'release.py').write_text(s)
(O/'release-delta.patch').write_text(''.join(difflib.unified_diff((BASE/'release.py').read_text().splitlines(True),s.splitlines(True),fromfile='original/release.py',tofile='header/release.py')))
(O/'tool-proof.json').write_text(json.dumps({'originalReleaseSHA':H((BASE/'release.py').read_bytes()),'releaseSHA':H(s.encode()),'helperSHA':H(helper),'safetyCoreBytesExact':True,'fullReleaseInverseVerified':True,'changes':changes,'originalSource':str(BASE/'release.py'),'scope':'customer-upload-header-mapping-20261121-6Lfttf6o-1156','apiWrites':0,'reloads':0,'timerPause':False},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':'OFFLINE_STATIC_TOOL_ADAPTED_NOT_APPLIED','releaseSHA':H(s.encode()),'helperSHA':H(helper),'inverseVerified':True}))
