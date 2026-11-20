#!/usr/bin/env python3
"""Only the user-approved per-release budget delta; no production or DB calls."""
import ast
import datetime as dt
import hashlib
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('r9_budget_release',ROOT/'release.py');r=importlib.util.module_from_spec(spec);sys.modules[spec.name]=r;spec.loader.exec_module(r)
class R9BudgetTests(unittest.TestCase):
 def capture(self,seconds=0,ttl=3600):
  return dict(capturedAtUtc=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=seconds)).isoformat(),ttlSeconds=ttl)
 def test_exact_user_approved_budget_and_new_scope(self):
  self.assertEqual(r.TTL,3600);self.assertEqual(r.SCOPE,'customer-batch-actions-20261120-6Lfttf6o-R9');self.assertEqual(str(r.Config().stage),'/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R9')
 def test_actual_now_and_40minute_frame_accepted(self):
  r.fresh(self.capture());r.fresh(self.capture(2400))
 def test_past3600_frame_still_refused(self):
  with self.assertRaisesRegex(r.ReleaseError,'FRESH_CAPTURE_REQUIRED'):r.fresh(self.capture(3601))
 def test_future_frame_still_refused(self):
  with self.assertRaisesRegex(r.ReleaseError,'FRESH_CAPTURE_REQUIRED'):r.fresh(self.capture(-1))
 def test_original900_frame_cannot_be_reused(self):
  with self.assertRaisesRegex(r.ReleaseError,'FRESH_CAPTURE_REQUIRED'):r.fresh(self.capture(ttl=900))
 def test_time_zone_and_invalid_fields_still_refused(self):
  with self.assertRaisesRegex(r.ReleaseError,'TIMEZONE_REQUIRED'):r.fresh(dict(capturedAtUtc=dt.datetime.now().isoformat(),ttlSeconds=3600))
  with self.assertRaisesRegex(r.ReleaseError,'INVALID_CAPTURE_TIME'):r.fresh(dict(capturedAtUtc='not-a-time',ttlSeconds=3600))
 def test_every_guard_and_helper_ast_exact_except_two_constants(self):
  a=ast.parse((ROOT/'evidence/r9-baseline-r8/release.py').read_text());b=ast.parse((ROOT/'evidence/r9-css-baseline/release.py').read_text());self.assertEqual(len(a.body),len(b.body))
  changed=[]
  for x,y in zip(a.body,b.body):
   if ast.dump(x,include_attributes=False)!=ast.dump(y,include_attributes=False):
    self.assertIsInstance(x,ast.Assign);self.assertIsInstance(y,ast.Assign);self.assertEqual(ast.dump(x.targets[0]),ast.dump(y.targets[0]));changed.append(x.targets[0].id)
  self.assertEqual(changed,['SCOPE','TTL'])
 def test_preparer_only_source_pin_changed(self):
  a=ast.parse((ROOT/'evidence/r9-baseline-r8/prepare-local.py').read_text());b=ast.parse((ROOT/'prepare-local.py').read_text());changed=[(x,y) for x,y in zip(a.body,b.body) if ast.dump(x,include_attributes=False)!=ast.dump(y,include_attributes=False)];self.assertEqual(len(a.body),len(b.body));self.assertEqual(len(changed),1);x,y=changed[0];self.assertEqual(x.targets[0].id,'CONTROLLER_SHA');self.assertEqual(y.value.value,hashlib.sha256((ROOT/'release.py').read_bytes()).hexdigest())
if __name__=='__main__':unittest.main()
