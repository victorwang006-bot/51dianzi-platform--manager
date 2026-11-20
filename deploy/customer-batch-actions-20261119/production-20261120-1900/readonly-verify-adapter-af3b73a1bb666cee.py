#!/usr/bin/env python3
"""Explicit additional READ-ONLY verification. Never a new apply or original-strict-pass.
Only inherited restore_journal's first baseline equality uses the existing authorized
single-directory two-time comparison. All bytes, signatures, nonce, latest chain,
state invariants, current RPC/health/targets/assets/receipt/closed checks are inherited.
No modification of original source, capture, journals, manifest or receipt.
"""
import hashlib,importlib.util,inspect,json,sys,textwrap
from pathlib import Path
SOURCE=Path('/opt/ops/customer-batch-actions-20261120-6Lfttf6o-M1/release-4f32de6aec3d7af5.py')
SOURCE_H='4f32de6aec3d7af51828aff6ee3d3e76be68f14b48f66e513573bc44324e625c'
ROOT='/opt/releases/20261009T170014Z-memory-isolation/dianzi51-platform'
PARAMS={'manifestSha256': '093d5476c2a16cc1fce2e2810de018bea35f22c7dbba9b22744ccb7abf6d64b4', 'reviewSha256': '7218090baa6296e7bb22a4ab1c9d9963582ef76b5011d884a2fc82dd175a78fd', 'attemptSha256': '3a287307181cab6ea01a95d0fbe5780d6c02a655754dea986393b852ffd7fd26', 'stateSha256': '54f73dd6aae8cc0efe010bbfe069c06d5c3535eea0e8ccffba64f757e38cf480', 'receiptSha256': 'ae28cf371f764f514a507044caae554d6a431576a77be98c558187e07c4da4e3'}
METHOD_H='c8bd6b71206d7c9c5111c8d0543b2d423cb8224fc96713bec97a5285367ee178'
OLD="need(d['state'] == original, 'FIRST_JOURNAL_FRESH_CAPTURE_BINDING')"
NEW="need(root_times_equal(d['state'], original), 'FIRST_JOURNAL_FRESH_CAPTURE_BINDING')"
def main():
 s=importlib.util.spec_from_file_location('immutable_4f_delegated_readonly_verify',SOURCE);m=importlib.util.module_from_spec(s);sys.modules[s.name]=m;s.loader.exec_module(m)
 assert m.H(m.regular(SOURCE))==SOURCE_H
 method=inspect.getsource(m.Controller.restore_journal)
 assert m.H(method.encode())==METHOD_H and method.count(OLD)==1
 changed=method.replace(OLD,NEW);assert changed.replace(NEW,OLD)==method
 with m.locked(m.Config()):
  first=m.decode(m.regular(m.Config().receipt/'state-000001.json'))['state'];cap=m.decode(m.regular(m.Config().package/'capture.json'))
  expected={k:cap[k] for k in ('processes','protectedFiles','transport')};expected.update(coordBase64=cap['coordBase64'],coordRecord=cap['coordRecord'],targets={'front':'before','admin':'before','html':'before'},assets=[],loadedSlots=[],events=[])
  assert m.root_times_equal(first,expected),'ONLY_AUTHORIZED_TWO_ROOT_TIMES_ALLOWED'
  # Show only these two fields may differ; retained records and all other fields exact.
  import copy
  a,b=copy.deepcopy(first),copy.deepcopy(expected)
  for k in ('mtimeNs','ctimeNs'):a['protectedFiles'][ROOT][k]=b['protectedFiles'][ROOT][k]
  assert a==b,'NO_OTHER_FIRST_JOURNAL_DIFFERENCE_ALLOWED'
 namespace={};exec(compile(textwrap.dedent(changed),'<explicit-readonly-first-root-time-comparison>','exec'),m.__dict__,namespace)
 class ExplicitReadOnlyRootTimeVerifier(m.Controller):
  restore_journal=namespace['restore_journal']
 verifier=ExplicitReadOnlyRootTimeVerifier()
 result=verifier.verify(verifier.cfg.package,PARAMS['manifestSha256'],PARAMS['reviewSha256'],PARAMS['attemptSha256'],PARAMS['stateSha256'],PARAMS['receiptSha256'])
 assert result['status']=='verified-live-matching-own-receipt' and result['productionWrites']==0
 return dict(status='adapted-read-only-verify',originalStrictVerifyPassed=False,originalStrictFailureRetained='FIRST_JOURNAL_FRESH_CAPTURE_BINDING',onlyComparisonAdapted='first-journal-single-approved-root-mtimeNs-ctimeNs',originalControllerSha256=SOURCE_H,adapterSha256=m.H(m.regular(Path(__file__).absolute())),originalRestoreJournalMethodSha256=METHOD_H,allOtherOriginalMethodBytesUnchanged=True,inheritedVerifyResult=result,productionWrites=0,reloads=0,timerOperations=0,receiptSha256=PARAMS['receiptSha256'],stateSha256=PARAMS['stateSha256'],verifiedAtUtc=m.now())
if __name__=='__main__':
 print(json.dumps(main(),sort_keys=True),flush=True)
