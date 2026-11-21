#!/usr/bin/env python3
"""Offline derivation only. Reuse original Writer/CAS/roll/rollback. Never SSH or execute controller."""
import ast,copy,difflib,hashlib,json
from pathlib import Path
ROOT=Path('/home/ubuntu/51-manager')
BASE=ROOT/'deploy/customer-batch-actions-20261119/production-20261120-1900'
WORK=Path('/home/ubuntu/work/customer-stock-live-20261121')
OUT=WORK/'controller-draft';assert not OUT.exists();OUT.mkdir(mode=0o700)
H=lambda b:hashlib.sha256(b if isinstance(b,bytes) else b.encode()).hexdigest()
source=(BASE/'release-4f32de6aec3d7af5.py').read_text();tree=ast.parse(source)
policy=json.loads((BASE/'scope-policy-db8386b7.json').read_text())
current=json.loads((WORK/'current-target-read/result-private.json').read_text())
scope='customer-stock-compact-20261121-6Lfttf6o'
p=copy.deepcopy(policy);p['scope']=scope;p['authorizationAtLocal']='2026-11-21 01:18:09 用户按照已确认建议上线；维护尚未批准/启动'
p['fixedMaintenanceDeadlineEpoch']=None
p['maintenanceWindowRequestedSeconds']=2700
p['maintenanceApprovalRequiredBeforePause']=True
p['fixedPreservedSha256']={k:current['objects'][k]['sha256'] for k in policy['fixedPreservedSha256']}
assets=json.loads((WORK/'ui-build-v2/assets.json').read_text())
public='/opt/releases/20261031-wechat-chat-entry-v33/admin/dist/public'
p['files']=sorted(set(p['files'])|set(p['candidateAssets']))
p['candidateAssets']=[public+'/'+a['relative'] for a in assets]
p['currentTargetOnlyReadSha256']=H((WORK/'current-target-read/result-private.json').read_bytes())
p['currentCoordObservedSha256']=current['coordSha256']
p['writeApiKinds']=['front']
p['adminApiPhysicalWritesAllowed']=False
p['reloadPolicy']='original identity-bound six own slots, including two unchanged-code proxy slots; no other processes'
# Policy fields are observation/explicit planned authorization; none starts a maintenance window.
segments=[]
for n in tree.body:
 if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name):
  name=n.targets[0].id
  if name=='SCOPE_POLICY':segments.append((n.lineno,n.end_lineno,'SCOPE_POLICY = json.loads('+repr(json.dumps(p,sort_keys=True,separators=(',',':')))+')'))
  elif name=='SCOPE':segments.append((n.lineno,n.end_lineno,'SCOPE = '+repr(scope)))
  elif name=='LEAVES':segments.append((n.lineno,n.end_lineno,"LEAVES = {'mk/CustomerChannelInventory','bk/CustomerWorkbenchSupply'}"))
  elif name=='API_PATCH_NAMES':segments.append((n.lineno,n.end_lineno,"API_PATCH_NAMES = {'front': {'supply.context.ownBoundUploadPreparation'}, 'admin': set()}"))
lines=source.splitlines()
for start,end,text in reversed(segments):lines[start-1:end]=text.splitlines()
new='\n'.join(lines)+'\n'
def exact_replace(old,value):
 global new
 assert new.count(old)==1,('UNIQUE_DERIVATION_SLOT',old[:90],new.count(old));new=new.replace(old,value)
exact_replace("return self.stage / 'package-minimal-actual-scope-M1'","return self.stage / 'package-customer-stock-compact'")
exact_replace("need(d['state'] == original, 'FIRST_JOURNAL_FRESH_CAPTURE_BINDING')","need(root_times_equal(d['state'], original), 'FIRST_JOURNAL_FRESH_CAPTURE_BINDING')")
exact_replace("    inverse_patches(before, after, d['patches'], native=True)","    if before == after:\n        need(str(path).endswith('/admin/dist/index.js') and d['patches'] == []\n             and d['inverse']['unchangedBytes'] == len(before), 'ONLY_ADMIN_EXACT_ZERO_API_DELTA')\n    else:\n        inverse_patches(before, after, d['patches'], native=True)")
exact_replace("and len(d['patches']) == 7, 'ONLY_CUSTOMER_SEVEN_TOPLEVEL_LEAVES_WITH_EMBEDDED_EIGHTH')","and len(d['patches']) == len(LEAVES), 'ONLY_TWO_CUSTOMER_STOCK_TOPLEVEL_LEAVES')")
exact_replace("inverse_patches(before, after, normalized, expected_count=7)","inverse_patches(before, after, normalized, expected_count=len(LEAVES))")
exact_replace("need(isinstance(sources, list) and len(sources) == 7, 'SEVEN_SOURCE_LEAVES_AND_EMBEDDED_FAILURES')","need(isinstance(sources, list) and len(sources) == len(LEAVES), 'TWO_STOCK_SOURCE_LEAVES_NATIVE_FAILURES_RETAINED')")
exact_replace("{'@media (max-width:900px)', '@media (max-width:600px)', '@media (max-width: 640px)'}","{'@media (max-width:900px)', '@media (max-width:600px)', '@media (max-width: 640px)', '@media (max-width: 680px)'}")
exact_replace("('.customer-upload-history', '.customer-channel-inventory', '.customer-supply-dialog'))","('.customer-upload-history', '.customer-channel-inventory', '.customer-supply-dialog',\n              '.customer-stock-workbench', '.customer-workbench-top-buttons'))")
exact_replace("        expected = self.st['protectedFiles'][str(path)]\n        def remember(record):","        expected = self.st['protectedFiles'][str(path)]\n        if content == before:\n            need(key == 'admin' and self.b['payload'][before_name] == self.b['payload'][after_name],\n                 'ONLY_ADMIN_NO_PHYSICAL_WRITE')\n            self.st['targets'][key] = 'candidate' if after else 'before'\n            self.checkpoint(('retain-' if after else 'restore-retained-') + key + '-exact-bytes')\n            self.guard(forward)\n            return\n        def remember(record):")
oldtree,newtree=ast.parse(source),ast.parse(new)
def functions(t):
 out={}
 for n in t.body:
  if isinstance(n,ast.FunctionDef):out[n.name]=ast.dump(n,include_attributes=False)
  if isinstance(n,ast.ClassDef):
   for q in n.body:
    if isinstance(q,ast.FunctionDef):out[n.name+'.'+q.name]=ast.dump(q,include_attributes=False)
 return out
oldf,newf=functions(oldtree),functions(newtree);assert set(oldf)==set(newf)
changed=[k for k in oldf if oldf[k]!=newf[k]]
assert set(changed)=={'native_api','ui_inverse','validate_payload','Config.package','Controller.change_file','Controller.restore_journal'},changed
protected=['cas','Controller.apply','Controller.fail','Controller.rollback','Controller.reload_one','Controller.baseline_guard','Controller.guard','Controller._verify','Controller.state_invariants','Controller.durable_success','Controller.receipt_proof']
for k in protected:assert oldf[k]==newf[k],k
policy_bytes=(json.dumps(p,sort_keys=True,indent=2)+'\n').encode();code_bytes=new.encode()
(OUT/'release-stock-compact.py').write_bytes(code_bytes);(OUT/'scope-policy.json').write_bytes(policy_bytes)
patch=''.join(difflib.unified_diff(source.splitlines(True),new.splitlines(True),fromfile='original-4f32de6a.py',tofile='new-stock-compact.py'))
(OUT/'controller-delta.patch').write_text(patch)
proof={'status':'OFFLINE_TOOL_DRAFT_NOT_EXECUTED_NO_MAINTENANCE_APPROVAL','originalControllerSha256':H(source),'controllerSha256':H(code_bytes),'policySha256':H(policy_bytes),'scope':scope,'changedFunctionASTs':changed,'allOtherFunctionASTExact':True,'noFunctionAddedOrRemoved':True,'originalWriterCASApplyReloadRollbackCoreExact':True,'protectedExactMethods':protected,'journalOnlyExistingRootTimeComparator':True,'adminApiContentUnchangedAndNoPhysicalCASWrite':True,'reloadSlotsStillOriginalSix':True,'draftMaintenanceWindowSeconds':2700,'maintenanceNotStarted':True,'ttlSecondsUnchanged':5400,'currentObservedCoordSha256':current['coordSha256'],'currentFrontendHtmlSha256':p['fixedPreservedSha256']['/opt/releases/20261031-homepage-banner-v39/front/dist/public/index.html']}
(OUT/'tool-proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(json.dumps(proof,indent=2))
