"""R2 local-only regressions; all HTTP/PM2/source operations are injected/mocked."""
import copy
import datetime as dt
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import release as c
from release import h, R, s
from test_release import Fixture, write


class R2Tests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.cleanup)

    def clock(self):
        real = dt.datetime
        class Clock(real):
            seconds = 0
            @classmethod
            def now(cls, tz=None):
                return real.now(tz) + dt.timedelta(seconds=cls.seconds)
        return Clock

    def retain_leaves(self):
        for spec in self.f.manifest['newFiles']:
            write(Path(spec['path']), self.f.data[spec['packageFile']], spec['mode'])
        self.f.ctl = self.f.controller()
        self.f.capture = self.f.ctl.capture()
        self.f.build_package()

    def test_fixed_new_scope_no_old_stage_replay(self):
        self.assertEqual(s.SCOPE, 'front-fast-r2-20261120-qp4e5jVm')
        self.assertEqual(s.OWNER, 'qp4e5jVmsAp0UHKwymyD5X')
        self.assertEqual(s.TTL, 900)
        self.assertNotEqual(s.STAGE, '/opt/ops/front-fast-20261120-XM2KNK1v')

    def test_browser_ua_get_origin_tls_flags_no_network(self):
        with patch.object(c.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=b'{}', stderr=b'')) as run:
            c.list_get('STM8S003F3P6TR')
        args = run.call_args.args[0]
        self.assertEqual(args[args.index('--user-agent') + 1], c.BROWSER_UA)
        self.assertTrue(c.BROWSER_UA.startswith('Mozilla/5.0 '))
        self.assertEqual(args[args.index('--request') + 1], 'GET')
        self.assertEqual(args[args.index('--resolve') + 1], '51dianzi.com:443:127.0.0.1')
        self.assertEqual(args[args.index('--proto') + 1], '=https')
        self.assertNotIn('--insecure', args)
        self.assertNotIn('--location', args)
        self.assertNotIn('env', run.call_args.kwargs)

    def test_transport_403_fail_closed_no_network(self):
        with patch.object(c.subprocess, 'run', return_value=SimpleNamespace(returncode=22, stdout=b'', stderr=b'403')):
            with self.assertRaisesRegex(h.ReleaseError, 'ACTUAL_OFFICIAL_MALL_GET_FAILED'):
                c.list_get('W25N04KVZEIR')

    def test_baseline_preflight_all_three_and_missing_allowed(self):
        before = self.f.snapshot(self.f.cfg)
        result = self.f.ctl.preflight(self.f.cfg.package, self.f.manifest_sha)
        self.assertEqual(self.f.list_log, [*s.TARGET_PARTS, 'CONTROL123'])
        self.assertEqual(len(result['businessPreflightEvents']), 3)
        self.assertEqual(before, self.f.snapshot(self.f.cfg))
        self.assertFalse(self.f.cfg.receipt.exists())

    def test_preflight_accepts_only_exact_canonical_known_unavailable(self):
        reader = self.f.ctl.list_reader
        def unavailable(part):
            raw, elapsed = reader(part)
            response = h.decode(raw)
            response['result']['data']['json']['items'][0]['technicalResource'] = {
                'state': 'unavailable', 'parameterVersion': None, 'resource': None}
            return h.encode(response), elapsed
        self.f.ctl.list_reader = unavailable
        result = self.f.ctl.preflight(self.f.cfg.package, self.f.manifest_sha)
        self.assertTrue(all(e['baselineKnownTechnicalUnavailable'] for e in result['businessPreflightEvents']))
        self.assertFalse(self.f.cfg.receipt.exists())

    def test_preflight_other_ready_version_mismatch_still_rejected(self):
        reader = self.f.ctl.list_reader
        def wrong(part):
            raw, elapsed = reader(part)
            response = h.decode(raw)
            response['result']['data']['json']['items'][0]['technicalResource']['parameterVersion'] = 'tp1_' + h.H(b'wrong')
            return h.encode(response), elapsed
        self.f.ctl.list_reader = wrong
        with self.assertRaisesRegex(h.ReleaseError, 'PREFLIGHT_BASELINE_TECHNICAL'):
            self.f.apply()
        self.assertFalse(self.f.cfg.receipt.exists())

    def test_preflight_get_failure_before_attempt_or_mutation(self):
        before = self.f.snapshot(self.f.cfg)
        def deny(_):
            raise h.ReleaseError('ACTUAL_OFFICIAL_MALL_GET_FAILED')
        self.f.ctl.list_reader = deny
        with self.assertRaises(h.ReleaseError):
            self.f.apply()
        self.assertFalse(self.f.cfg.receipt.exists())
        self.assertEqual(before, self.f.snapshot(self.f.cfg))
        self.assertEqual(self.f.reload_log, [])

    def test_preflight_http200_error_not_pass(self):
        self.f.ctl.list_reader = lambda _: (h.encode({'error': 'denied'}), 1)
        with self.assertRaisesRegex(h.ReleaseError, 'TRPC_RESULT_REQUIRED'):
            self.f.apply()
        self.assertFalse(self.f.cfg.receipt.exists())

    def test_preflight_store_drift_during_get_rejected(self):
        reader = self.f.ctl.list_reader
        def drift(part):
            answer = reader(part)
            write(self.f.store, h.regular(self.f.store) + b' ')
            return answer
        self.f.ctl.list_reader = drift
        with self.assertRaisesRegex(h.ReleaseError, 'PREFLIGHT_STORE_CHANGED'):
            self.f.apply()
        self.assertFalse(self.f.cfg.receipt.exists())

    def test_expired_before_admission_rejected_without_attempt(self):
        Clock = self.clock()
        Clock.seconds = s.TTL + 10
        with patch.object(dt, 'datetime', Clock):
            with self.assertRaisesRegex(h.ReleaseError, 'CAPTURE_EXPIRED_OR_FUTURE'):
                self.f.apply()
        self.assertFalse(self.f.cfg.receipt.exists())

    def test_expired_during_preflight_rejected_before_attempt(self):
        Clock = self.clock()
        reader = self.f.ctl.list_reader
        def expire(part):
            answer = reader(part)
            Clock.seconds = s.TTL + 10
            return answer
        self.f.ctl.list_reader = expire
        with patch.object(dt, 'datetime', Clock):
            with self.assertRaisesRegex(h.ReleaseError, 'CAPTURE_EXPIRED_OR_FUTURE'):
                self.f.apply()
        self.assertFalse(self.f.cfg.receipt.exists())
        self.assertEqual(self.f.reload_log, [])

    def test_mid_apply_expiry_still_completes_all_authentication(self):
        Clock = self.clock()
        self.f.reload_hook = lambda _: setattr(Clock, 'seconds', s.TTL + 10)
        with patch.object(dt, 'datetime', Clock):
            result = self.f.apply()
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(len(result['businessProbeEvents']), 6)
        self.assertEqual(self.f.reload_log, list(s.RELOAD_IDS))

    def test_mid_apply_expiry_business_failure_still_authenticates_rollback(self):
        Clock = self.clock()
        self.f.reload_hook = lambda _: setattr(Clock, 'seconds', s.TTL + 10)
        self.f.fail_business = True
        with patch.object(dt, 'datetime', Clock):
            with self.assertRaises(h.ReleaseError):
                self.f.apply()
        failure = h.decode(h.regular(self.f.cfg.receipt / 'failure.json'))
        self.assertEqual(failure['rollback']['status'], 'owned-bytes-process-listener-rollback-verified')
        self.assertEqual(self.f.reload_log, list(s.RELOAD_IDS) * 2)
        self.assertTrue(h.decode(h.regular(self.f.cfg.coord))['shared_release_active'])

    def test_mid_apply_expiry_does_not_allow_unknown_drift(self):
        Clock = self.clock()
        def drift(id_):
            Clock.seconds = s.TTL + 10
            if id_ == 191:
                write(self.f.cfg.nginx / 'nginx.conf', b'unknown drift')
        self.f.reload_hook = drift
        with patch.object(dt, 'datetime', Clock):
            with self.assertRaises(h.ReleaseError):
                self.f.apply()
        failure = h.decode(h.regular(self.f.cfg.receipt / 'failure.json'))
        self.assertIn('FULL_INVENTORY_FULL_METADATA_DRIFT', failure['error'])
        self.assertEqual(failure['rollback']['status'], 'unverified-recovery-required')

    def test_all_retained_leaves_reused_without_metadata_writes(self):
        self.retain_leaves()
        records = {x['path']: h.describe(Path(x['path'])) for x in self.f.manifest['newFiles']}
        result = self.f.apply()
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(self.f.ctl.new_records, {})
        self.assertEqual(records, {p: h.describe(Path(p)) for p in records})

    def test_uncaptured_existing_leaf_rejected(self):
        spec = self.f.manifest['newFiles'][0]
        write(Path(spec['path']), self.f.data[spec['packageFile']], spec['mode'])
        with self.assertRaisesRegex(h.ReleaseError, 'UNCAPTURED_EXISTING_IMMUTABLE_LEAF'):
            self.f.package()

    def test_retained_wrong_bytes_rejected_even_with_fresh_record(self):
        self.retain_leaves()
        spec = self.f.manifest['newFiles'][0]
        path = Path(spec['path'])
        write(path, b'wrong bytes', 0o644)
        self.f.ctl = self.f.controller()
        self.f.capture = self.f.ctl.capture()
        self.f.build_package()
        with self.assertRaisesRegex(h.ReleaseError, 'IMMUTABLE_EXACT_BYTES'):
            self.f.package()

    def test_retained_wrong_permissions_rejected_even_with_fresh_record(self):
        self.retain_leaves()
        Path(self.f.manifest['newFiles'][0]['path']).chmod(0o600)
        self.f.ctl = self.f.controller()
        self.f.capture = self.f.ctl.capture()
        self.f.build_package()
        with self.assertRaisesRegex(h.ReleaseError, 'IMMUTABLE_EXACT_BYTES'):
            self.f.package()

    def test_retained_hardlink_rejected(self):
        self.retain_leaves()
        spec = self.f.manifest['newFiles'][0]
        os.link(spec['path'], self.f.cfg.stage / 'hardlink')
        self.f.ctl = self.f.controller()
        self.f.capture = self.f.ctl.capture()
        self.f.build_package()
        with self.assertRaisesRegex(h.ReleaseError, 'IMMUTABLE_EXACT_BYTES'):
            self.f.package()

    def test_retained_metadata_drift_after_validation_guarded(self):
        self.retain_leaves()
        package = self.f.package()
        path = Path(self.f.manifest['newFiles'][0]['path'])
        os.utime(path, ns=(path.stat().st_atime_ns, path.stat().st_mtime_ns + 1))
        with self.assertRaisesRegex(h.ReleaseError, 'FULL_INVENTORY_FULL_METADATA_DRIFT'):
            self.f.ctl.guard(package)

    def test_terminal_durable_receipt_before_close_cas(self):
        replace = self.f.ctl.coord_replace
        def observe(before, after):
            if h.decode(after)['shared_release_active'] is False:
                terminal = h.decode(h.regular(self.f.cfg.receipt / 'confirmed.json'))
                self.assertEqual(terminal['status'], 'verified')
                self.assertTrue(terminal['verificationRequiresClosedCoordSha256'])
                self.assertEqual(terminal['closedCoordSha256'], h.H(after))
                self.assertTrue(h.decode(h.regular(self.f.cfg.coord))['shared_release_active'])
            return replace(before, after)
        self.f.ctl.coord_replace = observe
        self.assertEqual(self.f.apply()['status'], 'verified')

    def test_terminal_fsync_failure_cannot_make_closed_coord_visible(self):
        exclusive = h.exclusive
        closed_seen = []
        replace = self.f.ctl.coord_replace
        def observe(before, after):
            if h.decode(after)['shared_release_active'] is False:
                closed_seen.append(True)
            return replace(before, after)
        def fail(path, data, mode=0o600):
            if Path(path).name == 'confirmed.json':
                raise OSError('simulated durable terminal write failure')
            return exclusive(path, data, mode)
        self.f.ctl.coord_replace = observe
        with patch.object(h, 'exclusive', side_effect=fail):
            with self.assertRaises(h.ReleaseError):
                self.f.apply()
        self.assertEqual(closed_seen, [])
        self.assertTrue(h.decode(h.regular(self.f.cfg.coord))['shared_release_active'])
        self.assertTrue((self.f.cfg.receipt / 'failure.json').exists())

    def test_closed_coord_fsync_failure_reopens_only_owned_close(self):
        replace = self.f.ctl.coord_replace
        triggered = []
        def fail_once(before, after):
            replace(before, after)
            if h.decode(after)['shared_release_active'] is False and not triggered:
                triggered.append(True)
                raise OSError('simulated close durability failure after rename')
        self.f.ctl.coord_replace = fail_once
        with self.assertRaises(h.ReleaseError):
            self.f.apply()
        self.assertTrue(triggered)
        self.assertTrue((self.f.cfg.receipt / 'confirmed.json').exists())
        self.assertTrue((self.f.cfg.receipt / 'failure.json').exists())
        self.assertTrue(h.decode(h.regular(self.f.cfg.coord))['shared_release_active'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
