#!/usr/bin/env python3
"""Offline only: stdlib, TemporaryDirectory, existing fixture, mocked transports.
Run PYTHONDONTWRITEBYTECODE=1 python3 -B test_recover.py -v.
"""
import base64
import copy
from dataclasses import replace
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bound_recovery', Path(__file__).with_name('recover.py'))
k = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = k
spec.loader.exec_module(k)
r = k.r
spec2 = importlib.util.spec_from_file_location('original_test_fixture', Path(__file__).with_name('test_release.py'))
f = importlib.util.module_from_spec(spec2)
sys.modules[spec2.name] = f
spec2.loader.exec_module(f)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = f.ReleaseTests('test_capture_stdout_payload_readonly_and_no_secret_export')
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        x = self.fixture
        for row in x.raw_rows:
            rawpath = x.cfg.proc/str(row['pid'])/'environ'
            with rawpath.open('ab') as stream:
                stream.write(b'NODE_UNIQUE_ID=' + (b'1335' if row['pm_id'] == 190 else str(row['pm_id']).encode()) +
                             b'\0NODE_APP_INSTANCE=KEEP\0APP_JSON={"status":"business","tenant":"KEEP"}\0NODE_CHANNEL_FD=19\0')
        x.make_package()
        x.review['releaseApproved'] = True
        x.review_bytes = r.encode(x.review)
        (x.cfg.package/'review.json').write_bytes(x.review_bytes)
        x.review_sha = r.H(x.review_bytes)
        self.cfg = replace(x.cfg, stage=x.cfg.ops/'recovery-stage')
        self.cfg.stage.mkdir(mode=0o700)
        self.cfg.package.mkdir(mode=0o700)
        self.before_rows = x.controller.process_reader(x.cfg)
        before = next(z for z in self.before_rows if z['id'] == 190)
        x.mock_reload(x.cfg, 190, r.H(x.cfg.api.read_bytes()))
        row190 = next(z for z in x.raw_rows if z['pm_id'] == 190)
        envpath = x.cfg.proc/str(row190['pid'])/'environ'
        envpath.write_bytes(envpath.read_bytes().replace(b'NODE_UNIQUE_ID=1335\0', b'NODE_UNIQUE_ID=1339\0'))
        after = next(z for z in x.controller.process_reader(x.cfg) if z['id'] == 190)
        self.event = dict(id=190, beforePid=before['pid'], afterPid=after['pid'],
            beforeRestart=before['restarts'], afterRestart=after['restarts'],
            beforeRawEnvironSha256=before['rawProcEnvironSha256'], afterRawEnvironSha256=after['rawProcEnvironSha256'],
            beforeSemanticSha256=before['rawProcEnvironSemanticSha256'], afterSemanticSha256=after['rawProcEnvironSemanticSha256'],
            apiSha256=x.m['afterApiSha256'], rollback=False, transportPassed=True, observedPidChange=True)
        self.failure = dict(ownerTask=r.OWNER, scope=r.SCOPE, manifestSha256=x.manifest_sha,
            reviewSha256=x.review_sha, controllerSha256=k.OLD_CONTROLLER, processReloads=1,
            processReloadEvents=[self.event], processRollbacks=[], nonce='own-original-nonce',
            status='recovery-required-rollback-or-process-guard',
            error='ReleaseError: ROLLING_NONVOLATILE_ENV_CONFIG_PERMISSION_DRIFT')
        x.cfg.receipt.mkdir(mode=0o700)
        self.failure_path = x.cfg.receipt/'failure.json'
        self.failure_path.write_bytes(r.encode(self.failure))
        self.pins = patch.multiple(k, OLD_MANIFEST=x.manifest_sha, OLD_REVIEW=x.review_sha,
                                   OLD_FAILURE=r.H(self.failure_path.read_bytes()))
        self.pins.start()
        self.addCleanup(self.pins.stop)
        state = copy.deepcopy(x.coord_state)
        state['shared_release_active'] = True
        state['window'] = dict(owner_task=r.OWNER, scope=r.SCOPE, nonce=self.failure['nonce'],
            status='open', manifestSha256=x.manifest_sha, controllerSha256=k.OLD_CONTROLLER,
            reloadScope=list(r.FRONT_IDS), needsOperatorRecovery=False)
        x.cfg.coord.write_bytes(r.encode(state))
        self.coord_before = x.cfg.coord.read_bytes()
        for a in x.assets:
            r.exclusive(x.cfg.public/a['relative'], (x.cfg.package/a['relative']).read_bytes(), 0o644)
        r.atomic_cas(x.cfg.api, x.cfg.api.read_bytes(), (x.cfg.package/'after-api.js').read_bytes(), x.cfg.stage)
        self.reload_calls = []
        self.c = k.Recovery(self.cfg, x.cfg.stage, process_reader=x.controller.process_reader,
            get_reader=x.static_get, reload_adapter=self.reload, api_health_reader=x.mock_health,
            source_reader=lambda:k.NODE_PRIMARY,
            expected_original_records=len(r.decode((x.cfg.package/'capture.json').read_bytes())['protectedFiles']))
        self.capture = self.c.capture_recovery()
        self.package()

    def reload(self, cfg, slot, sha):
        self.reload_calls.append(slot)
        self.fixture.mock_reload(cfg, slot, sha)
        row = next(z for z in self.fixture.raw_rows if z['pm_id'] == slot)
        path = cfg.proc/str(row['pid'])/'environ'
        path.write_bytes(path.read_bytes().replace(b'NODE_UNIQUE_ID='+str(slot).encode()+b'\0',
                         b'NODE_UNIQUE_ID='+str(slot+9999).encode()+b'\0'))

    def package(self):
        cb = r.encode(self.capture)
        self.capture_sha = r.H(cb)
        self.manifest = k.manifest_for(self.capture, self.capture_sha)
        mb = r.encode(self.manifest)
        self.manifest_sha = r.H(mb)
        self.review = k.review_for(self.manifest, self.manifest_sha)
        rb = r.encode(self.review)
        self.review_sha = r.H(rb)
        for name, data in [('capture.json',cb),('manifest.json',mb),('review.json',rb)]:
            (self.cfg.package/name).write_bytes(data)

    def complete(self):
        return self.c.complete_recovery(self.cfg.package, self.manifest_sha, self.review_sha, self.capture_sha)

    def preflight(self):
        return self.c.preflight_recovery(self.cfg.package, self.manifest_sha, self.review_sha, self.capture_sha)

    def mutate_env(self, slot, old, new):
        row = next(z for z in self.fixture.raw_rows if z['pm_id'] == slot)
        p = self.cfg.proc/str(row['pid'])/'environ'
        p.write_bytes(p.read_bytes().replace(old,new))

    def test_success_remaining_three_only_full_protection_and_one_history(self):
        oldfailure = self.failure_path.read_bytes()
        before190 = next(z for z in self.capture['processes'] if z['id'] == 190)
        api_record = r.describe(self.cfg.api)
        asset_records = [r.describe(self.cfg.public/a['relative']) for a in self.fixture.assets]
        state = r.decode(self.coord_before)
        out = self.complete()
        self.assertEqual(self.reload_calls, [193,194,200])
        self.assertEqual(out['processReloads'],4)
        self.assertEqual(out['originalProcessReloads'],1)
        self.assertEqual(out['recoveryProcessReloads'],3)
        self.assertEqual(out['processReloadEvents'][0],self.event)
        self.assertEqual(self.failure_path.read_bytes(),oldfailure)
        self.assertEqual(r.describe(self.cfg.api),api_record)
        self.assertEqual([r.describe(self.cfg.public/a['relative']) for a in self.fixture.assets],asset_records)
        after190 = next(z for z in out['processesAfter'] if z['id'] == 190)
        self.assertEqual(after190,before190)
        current = r.decode(self.cfg.coord.read_bytes())
        self.assertEqual(current['window_history'][:-1],state['window_history'])
        self.assertEqual(current['pastFailures'],state['pastFailures'])
        self.assertFalse(current['shared_release_active'])
        self.assertEqual(current['window']['nonce'],state['window']['nonce'])
        self.assertEqual(current['window']['outcome'],'verified-recovered')
        self.assertTrue((self.cfg.receipt/'receipt.json').is_file())

    def test_preflight_readonly(self):
        self.assertEqual(self.preflight()['productionWrites'],0)
        self.assertEqual(self.reload_calls,[])
        self.assertFalse(self.cfg.receipt.exists())
        self.assertEqual(self.cfg.coord.read_bytes(),self.coord_before)

    def test_node_app_instance_rejected(self):
        self.mutate_env(193,b'NODE_APP_INSTANCE=KEEP',b'NODE_APP_INSTANCE=BAD')
        with self.assertRaises(r.ReleaseError): self.preflight()

    def test_app_json_status_rejected(self):
        self.mutate_env(193,b'"status":"business"',b'"status":"changed"')
        with self.assertRaises(r.ReleaseError): self.preflight()

    def test_node_channel_fd_rejected(self):
        self.mutate_env(193,b'NODE_CHANNEL_FD=19',b'NODE_CHANNEL_FD=20')
        with self.assertRaises(r.ReleaseError): self.preflight()

    def test_permissions_rejected(self):
        row = next(z for z in self.fixture.raw_rows if z['pm_id']==193)
        p=self.cfg.proc/str(row['pid'])/'status'
        p.write_bytes(p.read_bytes().replace(b'1000',b'1001'))
        with self.assertRaises(r.ReleaseError): self.preflight()

    def test_daemon_config_rejected(self):
        row=next(z for z in self.fixture.raw_rows if z['pm_id']==193)
        row['pm2_env']['env']['NODE_APP_INSTANCE']='BAD'
        with self.assertRaises(r.ReleaseError): self.preflight()

    def test_foreign_coord_rejected(self):
        state=r.decode(self.cfg.coord.read_bytes());state['window']['nonce']='FOREIGN'
        self.cfg.coord.write_bytes(r.encode(state))
        with self.assertRaises(r.ReleaseError): self.preflight()
        self.assertEqual(self.reload_calls,[])

    def test_old_failure_changed_rejected(self):
        self.failure_path.write_bytes(self.failure_path.read_bytes()+b' ')
        with self.assertRaisesRegex(r.ReleaseError,'OLD_FAILURE_CHANGED'): self.preflight()

    def test_old_package_file_changed_rejected(self):
        p=self.fixture.cfg.package/'after-index.html';p.write_bytes(p.read_bytes()+b' ')
        with self.assertRaisesRegex(r.ReleaseError,'OLD_PACKAGE_FILE_CHANGED'): self.preflight()

    def test_fullmeta_only_drift_rejected(self):
        p=self.cfg.public/'favicon.ico';p.chmod(0o600)
        with self.assertRaisesRegex(r.ReleaseError,'CURRENT_FULL_META_DRIFT'): self.preflight()

    def test_asset_permission_rejected(self):
        p=self.cfg.public/self.fixture.assets[0]['relative'];p.chmod(0o600)
        with self.assertRaises(r.ReleaseError): self.preflight()

    def test_expired_new_capture_rejected(self):
        self.capture['capturedAtUtc']='2026-01-01T00:00:00+00:00';self.package()
        with self.assertRaisesRegex(r.ReleaseError,'CAPTURE_EXPIRED'): self.preflight()

    def test_future_capture_rejected(self):
        self.capture['capturedAtUtc']='2099-01-01T00:00:00+00:00';self.package()
        with self.assertRaisesRegex(r.ReleaseError,'CAPTURE_EXPIRED'): self.preflight()

    def test_review_not_approved_rejected(self):
        self.review['recoveryApproved']=False
        rb=r.encode(self.review);(self.cfg.package/'review.json').write_bytes(rb);self.review_sha=r.H(rb)
        with self.assertRaisesRegex(r.ReleaseError,'APPROVAL_BINDING'): self.preflight()

    def test_repeated_recovery_receipt_rejected(self):
        self.complete()
        with self.assertRaisesRegex(r.ReleaseError,'RECEIPT_EXISTS_NO_REPLAY'): self.complete()
        self.assertEqual(self.reload_calls,[193,194,200])

    def test_attempt_alone_blocks_replay(self):
        self.cfg.receipt.mkdir(mode=0o700)
        (self.cfg.receipt/'attempt.json').write_bytes(b'{}')
        with self.assertRaisesRegex(r.ReleaseError,'RECEIPT_EXISTS_NO_REPLAY'): self.complete()
        self.assertEqual(self.reload_calls,[])

    def test_node_unique_allowed_four_only_and_other_eight_fullraw(self):
        for slot in (188,189,210,211,212,213,214,215):
            row=next(z for z in self.fixture.raw_rows if z['pm_id']==slot)
            p=self.cfg.proc/str(row['pid'])/'environ';old=p.read_bytes()
            p.write_bytes(old.replace(b'NODE_UNIQUE_ID='+str(slot).encode(),b'NODE_UNIQUE_ID=999999'))
            with self.assertRaisesRegex(r.ReleaseError,'OTHER_EIGHT_FULL_RAW_DRIFT'): self.preflight()
            p.write_bytes(old)
        for slot in r.FRONT_IDS:
            row=next(z for z in self.fixture.raw_rows if z['pm_id']==slot)
            p=self.cfg.proc/str(row['pid'])/'environ';old=p.read_bytes()
            worker=1339 if slot==190 else slot
            p.write_bytes(old.replace(b'NODE_UNIQUE_ID='+str(worker).encode()+b'\0',b'NODE_UNIQUE_ID=80000\0'))
            self.preflight()
            p.write_bytes(old)

    def test_html_fullmeta_cas(self):
        original_cas=r.atomic_cas
        def race(path,*args,**kwargs):
            if Path(path)==self.cfg.html:
                self.cfg.html.chmod(0o600)
            return original_cas(path,*args,**kwargs)
        with patch.object(r,'atomic_cas',side_effect=race):
            with self.assertRaisesRegex(r.ReleaseError,'FULL_METADATA_CAS'): self.complete()
        self.assertEqual(self.reload_calls,[193,194,200])
        self.assertEqual(self.cfg.coord.read_bytes(),self.coord_before)
        self.assertTrue((self.cfg.receipt/'failure.json').is_file())

    def test_reload_failure_no_retry_no_repair_blocked_window(self):
        def fail(cfg,slot,sha):
            self.reload(cfg,slot,sha)
            self.mutate_env(slot,b'NODE_APP_INSTANCE=KEEP',b'NODE_APP_INSTANCE=BAD')
        self.c.reload_adapter=fail
        with self.assertRaises(r.ReleaseError):self.complete()
        self.assertEqual(self.reload_calls,[193])
        self.assertEqual(self.cfg.coord.read_bytes(),self.coord_before)
        receipt=r.decode((self.cfg.receipt/'failure.json').read_bytes())
        self.assertEqual(receipt['processReloads'],2)
        with self.assertRaisesRegex(r.ReleaseError,'RECEIPT_EXISTS_NO_REPLAY'):self.complete()
        self.assertEqual(self.reload_calls,[193])

    def test_single_field_reconstruction_rejects_extra_change(self):
        self.mutate_env(190,b'APP_JSON={"status":"business"',b'APP_JSON={"status":"BAD"')
        with self.assertRaises(r.ReleaseError):self.c.capture_recovery()

    def test_unique_parser_rejects_missing_duplicate_or_noninteger(self):
        for raw in (b'X=1\0',b'NODE_UNIQUE_ID=1\0NODE_UNIQUE_ID=2\0',b'NODE_UNIQUE_ID=x\0'):
            with self.assertRaises(r.ReleaseError):k.outer_unique(raw)
        raw=b'NODE_UNIQUE_ID=42\0APP_JSON={"NODE_UNIQUE_ID":42}\0NODE_APP_INSTANCE=42\0'
        stable=k.outer_unique(raw)
        self.assertIn(b'APP_JSON={"NODE_UNIQUE_ID":42}',stable)
        self.assertIn(b'NODE_APP_INSTANCE=42',stable)
        self.assertTrue(stable.startswith(b'NODE_UNIQUE_ID=0\0'))

    def test_coord_close_cas_failure_keeps_open_and_failure_supersedes_prepared_receipt(self):
        original_cas=r.atomic_cas
        def fail_close(path,*args,**kwargs):
            if Path(path)==self.cfg.coord:
                raise r.ReleaseError('TEST_CLOSE_CAS_REFUSED')
            return original_cas(path,*args,**kwargs)
        with patch.object(r,'atomic_cas',side_effect=fail_close):
            with self.assertRaisesRegex(r.ReleaseError,'CLOSE_CAS_REFUSED'):self.complete()
        self.assertEqual(self.cfg.coord.read_bytes(),self.coord_before)
        self.assertTrue((self.cfg.receipt/'failure.json').exists())
        prepared=r.decode((self.cfg.receipt/'receipt.json').read_bytes())
        self.assertTrue(prepared['verificationRequiresClosedCoordSha256'])
        self.assertNotEqual(r.H(self.cfg.coord.read_bytes()),prepared['coordSha256'])
        self.assertEqual(self.reload_calls,[193,194,200])

    def test_final_receipt_write_failure_keeps_window_open(self):
        original_exclusive=r.exclusive
        def fail_receipt(path,*args,**kwargs):
            if Path(path)==self.cfg.receipt/'receipt.json':
                raise r.ReleaseError('TEST_RECEIPT_WRITE_REFUSED')
            return original_exclusive(path,*args,**kwargs)
        with patch.object(r,'exclusive',side_effect=fail_receipt):
            with self.assertRaisesRegex(r.ReleaseError,'RECEIPT_WRITE_REFUSED'):self.complete()
        self.assertEqual(self.cfg.coord.read_bytes(),self.coord_before)
        self.assertTrue((self.cfg.receipt/'failure.json').exists())

    def test_exec_mode_and_top_child_config_drift_during_reload_rejected(self):
        def bad_reload(cfg,slot,sha):
            self.reload(cfg,slot,sha)
            row=next(z for z in self.fixture.raw_rows if z['pm_id']==slot)
            row['pm2_env']['env']['TENANT']='FOREIGN'
        self.c.reload_adapter=bad_reload
        with self.assertRaises(r.ReleaseError):self.complete()
        self.assertEqual(self.reload_calls,[193])
        self.assertEqual(self.cfg.coord.read_bytes(),self.coord_before)
        self.assertTrue((self.cfg.receipt/'failure.json').exists())

    def test_node_primary_source_drift_rejected(self):
        self.c.source_reader=lambda:'0'*64
        with self.assertRaisesRegex(r.ReleaseError,'NODE_PRIMARY_SOURCE_CHANGED'):self.preflight()
        self.assertEqual(self.reload_calls,[])

    def test_old_package_drift_during_reload_stops_next_slot(self):
        def changed_pkg(cfg,slot,sha):
            self.reload(cfg,slot,sha)
            p=self.fixture.cfg.package/'before-index.html'
            p.write_bytes(p.read_bytes()+b' ')
        self.c.reload_adapter=changed_pkg
        with self.assertRaisesRegex(r.ReleaseError,'OLD_PACKAGE_FILE_CHANGED'):self.complete()
        self.assertEqual(self.reload_calls,[193])
        self.assertEqual(self.cfg.coord.read_bytes(),self.coord_before)

    def test_postrename_close_failure_reopens_only_own_recorded_window(self):
        original_cas=r.atomic_cas
        def after_rename(path,before,after,*args,**kwargs):
            result=original_cas(path,before,after,*args,**kwargs)
            if Path(path)==self.cfg.coord and before==self.coord_before:
                raise r.ReleaseError('TEST_POST_RENAME_FSYNC_FAILURE')
            return result
        with patch.object(r,'atomic_cas',side_effect=after_rename):
            with self.assertRaisesRegex(r.ReleaseError,'POST_RENAME_FSYNC_FAILURE'):self.complete()
        self.assertEqual(self.cfg.coord.read_bytes(),self.coord_before)
        failure=r.decode((self.cfg.receipt/'failure.json').read_bytes())
        self.assertTrue(failure['ownBlockedWindowReopened'])
        self.assertEqual(self.reload_calls,[193,194,200])

if __name__=='__main__':
    unittest.main()
