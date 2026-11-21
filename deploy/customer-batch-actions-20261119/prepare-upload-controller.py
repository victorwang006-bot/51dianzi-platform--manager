#!/usr/bin/env python3
"""Offline current request parameters; reuse the entire proven Controller/Writer and exact-scope guards."""
import ast,difflib,hashlib,json,os
from pathlib import Path
os.umask(0o077)
W=Path('/home/ubuntu/work/customer-upload-fix-20261121-1024');OLD=Path('/home/ubuntu/work/customer-stock-live-20261121/exact-guard-fixed');OUT=W/'controller';assert not OUT.exists();OUT.mkdir(mode=0o700)
H=lambda b:hashlib.sha256(b).hexdigest()
SCOPE='customer-upload-file-fix-20261121-6Lfttf6o-1024'
old=(OLD/'release-exact.py').read_text();policy=json.loads((OLD/'scope-policy.json').read_text());oldpolicy=json.loads((OLD/'scope-policy.json').read_text())
handoff=json.loads(Path('/home/ubuntu/upload/frontend-closed-handoff-and-pins.json').read_text());front=handoff['frontProtectionPins'];assert handoff['status']=='VERIFIED_DURABLE_CLOSED' and handoff['locksReleased'] and handoff['closedCoordWholeFileSHA256'] is None
policy['scope']=SCOPE;policy['authorizationAtLocal']='2026-11-21 10:24:43 用户修复此bug,并按照方案实施优化页面；10:25:03 一个弹窗、三步完成'
policy['currentCoordObservedSha256']=None;policy['currentTargetOnlyReadSha256']=None
policy['maintenanceApprovalRequiredBeforePause']=True
files=set(policy['files']);fixed=policy['fixedPreservedSha256'];root=Path(front['root']);fixed[str(root/'index.html')]=front['html']['sha256'];files.add(str(root/'index.html'))
for item in front['assets']+front['existingHTMLDependencies']:
 p=str(root/item['url'].lstrip('/'));assert item['url'].startswith('/assets/');files.add(p);fixed[p]=item['sha256']
U=W/'ui-build';modules=json.loads((U/'modules.json').read_text());assets=json.loads((U/'assets.json').read_text());public=Path('/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public')
# Previous candidate bytes are now actual deployed baseline; keep them protected, not deleted.
files.update(oldpolicy['candidateAssets']);files.update(str(public/m['before']) for m in modules)
policy['files']=sorted(files);policy['candidateAssets']=sorted(str(public/a['relative']) for a in assets)
policy['frontClosedHandoffSha256']=H(Path('/home/ubuntu/upload/frontend-closed-handoff-and-pins.json').read_bytes());policy['frontClosedWholeCoordHashKnown']=False
raw=(json.dumps(policy,sort_keys=True,separators=(',',':'))+'\n').encode();(OUT/'scope-policy.json').write_bytes(raw)
new=old
replacements={"SCOPE = 'customer-stock-compact-20261121-6Lfttf6o-exact-fixed'":'SCOPE = '+repr(SCOPE),"API_PATCH_NAMES = {'front': {'supply.context.ownBoundUploadPreparation'}, 'admin': set()}":"API_PATCH_NAMES = {'front': {'privateStorage.checkedZip.deflateCompressionFlags'}, 'admin': set()}","LEAVES = {'mk/CustomerChannelInventory','bk/CustomerWorkbenchSupply'}":"LEAVES = {'T6/BatchUploadSession'}","return self.stage / 'package-customer-stock-compact'":"return self.stage / 'package-customer-upload-fix'","'@media (max-width: 640px)', '@media (max-width: 680px)'":"'@media (max-width: 640px)', '@media (max-width: 680px)', '@media (max-width: 560px)'"}
for a,b in replacements.items():assert new.count(a)==1,a;new=new.replace(a,b)
t=ast.parse(new);assignment=next(n for n in t.body if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id=='SCOPE_POLICY' for x in n.targets));oldexpr=ast.get_source_segment(new,assignment);assert oldexpr.startswith('SCOPE_POLICY = json.loads(');new=new.replace(oldexpr,'SCOPE_POLICY = json.loads('+repr(raw.decode().strip())+')',1)
compile(new,'<customer-upload-exact-controller>','exec');(OUT/'release-upload.py').write_text(new)
def funcs(s):
 t=ast.parse(s);r={}
 for n in t.body:
  if isinstance(n,(ast.FunctionDef,ast.ClassDef)):r[n.name]=ast.dump(n,include_attributes=False)
 return r
before,after=funcs(old),funcs(new);assert before.keys()==after.keys();changed=sorted(k for k in before if before[k]!=after[k]);assert changed==['Config','validate_payload'],changed
# Both changed function/class ASTs reverse exactly to the previous reviewed bytes.
normalized=new
for a,b in replacements.items():normalized=normalized.replace(b,a)
assert funcs(normalized)==before
proof={'scope':SCOPE,'controllerSha256':H(new.encode()),'oldControllerSha256':H(old.encode()),'policySha256':H(raw),'changedFunctionOrClassAST':changed,'controllerWriterBackupCASApplyReloadRollbackVerifyNoReplayASTExact':all(before[k]==after[k] for k in before if k not in changed),'onlyConfigPackageAndExistingMediaLiteralWhitelistDifferInMethods':True,'noGuardRemoved':True,'TTLSeconds':5400,'timerPause':False,'frontHtmlSha256':front['html']['sha256'],'frontAssetsProtected':len(front['assets']),'frontHtmlDependenciesProtected':len(front['existingHTMLDependencies']),'oldFixedPinsRetainedExceptActualNewFrontHTML':all(fixed.get(p)==h for p,h in oldpolicy['fixedPreservedSha256'].items() if p!=str(root/'index.html')),'oldFilesRetained':set(oldpolicy['files'])<=files,'staticTransportSourcesExact':policy['staticTransportSources']==oldpolicy['staticTransportSources'],'exactLinksUnchanged':policy['aliases']==oldpolicy['aliases'],'directoryIdentityFieldsUnchanged':policy['directoryIdentityFields']==oldpolicy['directoryIdentityFields'],'explicitFileCount':len(files),'necessaryShallowDirectoryCount':len(policy['shallowDirectories']),'candidateAssets':policy['candidateAssets'],'actualCurrentCoordWholeBytesWillBeCapturedNotAssumed':True}
(OUT/'tool-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
# Full patch includes changed embedded policy; separate method patch stays small for inspection.
(OUT/'controller-delta.patch').write_text(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='previous/release-exact.py',tofile='current/release-upload.py')))
methoddiff=[]
for name in changed:
 a=next(n for n in ast.parse(old).body if getattr(n,'name',None)==name);b=next(n for n in ast.parse(new).body if getattr(n,'name',None)==name)
 methoddiff.extend(difflib.unified_diff(ast.get_source_segment(old,a).splitlines(True),ast.get_source_segment(new,b).splitlines(True),fromfile='previous/'+name,tofile='current/'+name))
(OUT/'method-delta.patch').write_text(''.join(methoddiff));print(json.dumps(proof,indent=2))
