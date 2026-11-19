#!/usr/bin/env python3
"""Offline freeze validator fixtures only; no capture/native pass artifact produced."""
import base64
import copy
import importlib.util
from pathlib import Path
import unittest
HERE = Path(__file__).absolute().parent
SPEC = importlib.util.spec_from_file_location('local_freeze_tests', HERE/'freeze-package.py')
f = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(f)

class FreezeTests(unittest.TestCase):
    def setUp(self):
        self.approved = ['T6/BatchUploadSession','B3/CustomerSupplyUploadSession','mk/CustomerChannelInventory']
        self.original = '/*🔒 中文*/' + ''.join('function '+n+'(){return 1;}' for n in ['z3','uk','bk','ok','T6','B3','mk'])
        units = lambda s: len(s.encode('utf-16-le'))//2
        self.protected = {}
        for name in ['z3','uk','bk','ok']:
            old = 'function '+name+'(){return 1;}'
            start = self.original.index(old)
            self.protected[name] = {'oldStart':units(self.original[:start]),'oldEnd':units(self.original[:start]+old),'sha256':f.r.H(old.encode())}
        self.records = []
        after = self.original
        shift = 0
        for name in self.approved:
            native = name.split('/')[0]
            old, new = 'function '+native+'(){return 1;}', 'function '+native+'(){return "真正变化中文🔒";}'
            start = self.original.index(old)
            ustart = units(self.original[:start])
            self.records.append({'name':name,'oldStart':ustart,'oldEnd':ustart+units(old),'newStart':ustart+shift,'newEnd':ustart+shift+units(new),
                'oldBase64':base64.b64encode(old.encode()).decode(),'newBase64':base64.b64encode(new.encode()).decode(),
                'oldSha256':f.r.H(old.encode()),'newSha256':f.r.H(new.encode())})
            shift += units(new)-units(old)
            after = after.replace(old,new)
        self.after = after.encode()
        self.delta = {'beforeSha256':f.r.H(self.original.encode()),'afterSha256':f.r.H(self.after),'forwardVerified':True,'inverseVerified':True,
            'allBytesOutsideAuthorizedFunctionsUnchanged':True,'changedSpanCount':3,'approvedTargets':self.approved,
            'patches':self.records,'protectedFunctions':self.protected}
    def test_utf16_nonbmp_forward_inverse_full_bytes(self):
        self.assertEqual(f.exact_inverse(self.after,self.delta,self.approved),self.original.encode())
    def test_wrong_real_span_count_rejected(self):
        self.delta['changedSpanCount']=4
        with self.assertRaises(f.r.ReleaseError): f.exact_inverse(self.after,self.delta,self.approved)
    def test_history_target_forbidden(self):
        self.delta['patches'][0]['name']='z3/HistorySession'
        with self.assertRaises(f.r.ReleaseError): f.exact_inverse(self.after,self.delta,self.approved)
    def test_wrong_offset_rejected(self):
        self.delta['patches'][0]['newStart']+=1
        with self.assertRaises(f.r.ReleaseError): f.exact_inverse(self.after,self.delta,self.approved)
    def test_protected_hash_rejected(self):
        self.delta['protectedFunctions']['z3']['sha256']='0'*64
        with self.assertRaises(f.r.ReleaseError): f.exact_inverse(self.after,self.delta,self.approved)
    def test_css_customer_only(self):
        f.css_scopes('.customer-channel-inventory input{color:red}@media (max-width:600px){.customer-supply-dialog input{width:100%}}')
        with self.assertRaises(f.r.ReleaseError): f.css_scopes('.ci-host input{color:red}')
    def test_writes_confined(self):
        with self.assertRaises(f.r.ReleaseError): f.confined(HERE.parent/'bad')

if __name__=='__main__': unittest.main()
