"""Synthetic anonymous /tmp recovery fixtures only; never production receipts."""
import copy
from pathlib import Path
import shutil
import unittest

import certify as k
import release as c
from release import h, s
from test_release import Fixture, source_proof, write


class CertifyTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture()
        self.addCleanup(self.f.cleanup)
        reader = self.f.ctl.list_reader
        def transport(part):
            if h.decode(h.regular(self.f.store))['generation'] != self.f.doc['generation']:
                raise h.ReleaseError('ACTUAL_OFFICIAL_MALL_GET_FAILED')
            return reader(part)
        self.f.ctl.list_reader = transport
        with self.assertRaises(h.ReleaseError):
            self.f.apply()
        # Model the old-controller TTL-only terminal failure in a NEW tmp fixture.
        path = self.f.cfg.receipt / 'failure.json'
        failure = h.decode(h.regular(path))
        failure['rollback'] = {'status': 'unverified-recovery-required', 'error': 'ReleaseError: CAPTURE_EXPIRED_OR_FUTURE'}
        write(path, h.encode(failure))
        for name in c.SOURCE_NAMES:
            target = self.f.cfg.stage / 'controller' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(c.HERE / name, target)
        # Seal this synthetic tmp stage with its fixture bindings, not the real
        # controller's production bindings. No actual evidence/receipt is changed.
        write(self.f.cfg.stage / 'controller/bindings.json', h.encode(self.f.bindings))
        sources = {name: h.H(h.regular(self.f.cfg.stage / 'controller' / name)) for name in c.SOURCE_NAMES}
        controller_sha = h.H(h.encode(sources))
        self.f.capture.update(sourceFiles=sources, controllerSha256=controller_sha)
        self.f.data['capture.json'] = h.encode(self.f.capture)
        self.f.manifest.update(sourceFiles=sources, controllerSha256=controller_sha,
                               captureSha256=h.H(self.f.data['capture.json']))
        self.f.save()
        updates = dict(manifestSha256=self.f.manifest_sha, reviewSha256=self.f.review_sha,
                       controllerSha256=controller_sha, captureSha256=self.f.manifest['captureSha256'])
        attempt = h.decode(h.regular(self.f.cfg.receipt / 'attempt.json'))
        attempt.update(updates)
        write(self.f.cfg.receipt / 'attempt.json', h.encode(attempt))
        state = h.decode(h.regular(self.f.cfg.coord))
        state['window'].update(updates)
        write(self.f.cfg.coord, h.encode(state))
        self.pins = dict(ownerTask=s.OWNER, scope=s.SCOPE, baselineProtectedFileCount=self.f.capture['protectedFileCount'],
                         immutableLeavesCount=len(self.f.manifest['newFiles']), controllerSha256=controller_sha)
        for name, path in {'manifest': self.f.cfg.package / 'manifest.json', 'review': self.f.cfg.package / 'review.json',
                           'capture': self.f.cfg.package / 'capture.json', 'failure': self.f.cfg.receipt / 'failure.json',
                           'attempt': self.f.cfg.receipt / 'attempt.json'}.items():
            self.pins[name + 'Sha256'] = h.H(h.regular(path))
        self.source_calls = []
        def old_source(evidence, digest):
            self.source_calls.append(digest)
            raw = h.regular(self.f.store)
            return h.encode(source_proof(h.decode(raw), raw))
        self.ctl = k.Certifier(self.f.cfg, pins=self.pins, snapshot_reader=self.f.snapshot,
            process_reader=lambda _: copy.deepcopy(self.f.rows), get_reader=self.f.get,
            list_reader=self.f.list, health_reader=lambda *_: True,
            retired_reader=lambda *_: True, source_reader=old_source)
        self.coord = h.regular(self.f.cfg.coord)
        self.coordsha = h.H(self.coord)
        self.recordsha = h.H(h.encode(h.describe(self.f.cfg.coord)))

    def certify(self):
        return self.ctl.certify(self.coordsha, self.recordsha)

    def test_complete_old_projection_recovery_is_readonly_and_not_business_success(self):
        before = self.f.snapshot(self.f.cfg)
        coord = h.describe(self.f.cfg.coord)
        receipt_names = sorted(p.name for p in self.f.cfg.receipt.iterdir())
        result = self.certify()
        self.assertEqual(result['status'], 'restored-baseline-readonly-certified')
        self.assertFalse(result['deploymentBusinessAcceptanceVerified'])
        self.assertFalse(result['coordinationClosed'])
        self.assertEqual(result['oldProjectionSourceVerifierSha256'], c.old_scope.SOURCE_VERIFIER_SHA)
        self.assertEqual(len(self.source_calls), 1)
        self.assertEqual(before, self.f.snapshot(self.f.cfg))
        self.assertEqual(coord, h.describe(self.f.cfg.coord))
        self.assertEqual(receipt_names, sorted(p.name for p in self.f.cfg.receipt.iterdir()))
        self.assertNotIn('sourceTickets', result)
        self.assertNotIn('entries', result)

    def test_old_source_authentication_failure_blocks(self):
        def fail(*_):
            raise h.ReleaseError('FIXTURE_OLD_SOURCE_FAILURE')
        self.ctl.source_reader = fail
        with self.assertRaises(h.ReleaseError):
            self.certify()
        self.assertEqual(self.coord, h.regular(self.f.cfg.coord))

    def test_old_source_wrong_version_blocks(self):
        original = self.ctl.source_reader
        def wrong(*args):
            proof = h.decode(original(*args))
            proof['sourceVersions'][next(iter(proof['sourceVersions']))] = h.H(b'wrong')
            return h.encode(proof)
        self.ctl.source_reader = wrong
        with self.assertRaises(h.ReleaseError):
            self.certify()

    def test_source_changed_store_blocks(self):
        original = self.ctl.source_reader
        def drift(*args):
            proof = original(*args)
            write(self.f.store, h.regular(self.f.store) + b' ')
            return proof
        self.ctl.source_reader = drift
        with self.assertRaises(h.ReleaseError):
            self.certify()

    def test_health_time_drift_caught_by_final_snapshot(self):
        def drift(*_):
            write(self.f.cfg.nginx / 'nginx.conf', b'drift after first snapshot')
            return True
        self.ctl.health_reader = drift
        with self.assertRaises(h.ReleaseError):
            self.certify()

    def test_foreign_process_raw_change_blocks(self):
        next(r for r in self.f.rows if r['id'] == 201)['rawProcEnvironSha256'] = h.H(b'foreign')
        with self.assertRaises(h.ReleaseError):
            self.certify()

    def test_wrong_final_rolled_pid_blocks(self):
        next(r for r in self.f.rows if r['id'] == 191)['pid'] += 1
        with self.assertRaises(h.ReleaseError):
            self.certify()

    def test_sealed_original_receipt_tamper_blocks(self):
        path = self.f.cfg.receipt / 'failure.json'
        write(path, h.regular(path) + b' ')
        with self.assertRaisesRegex(h.ReleaseError, 'RECOVERY_PIN_MISMATCH'):
            self.certify()

    def test_locked_api_never_bypasses_locks(self):
        with self.assertRaisesRegex(h.ReleaseError, 'CERTIFY_BOTH_LOCKS'):
            self.ctl.certify_locked(self.coordsha, self.recordsha)
        with h.locked(self.f.cfg):
            result = self.ctl.certify_locked(self.coordsha, self.recordsha)
            k.assert_certificate_current(self.ctl, result, self.coord)
        with self.assertRaisesRegex(h.ReleaseError, 'RECOVERY_CLOSE_BOTH_LOCKS'):
            k.assert_certificate_current(self.ctl, result, self.coord)

    def test_terminal_wrapper_last_state_cas_detects_post_certification_drift(self):
        with h.locked(self.f.cfg):
            result = self.ctl.certify_locked(self.coordsha, self.recordsha)
            write(self.f.cfg.nginx / 'nginx.conf', b'late foreign drift')
            with self.assertRaises(h.ReleaseError):
                k.assert_certificate_current(self.ctl, result, self.coord)
        self.assertEqual(h.regular(self.f.cfg.coord), self.coord)


if __name__ == '__main__':
    unittest.main(verbosity=2)
