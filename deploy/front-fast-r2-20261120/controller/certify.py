#!/usr/bin/env python3
"""Read-only certification of the ORIGINAL failed attempt's restored baseline.
No apply, rollback, reload, coord write, receipt write, repair, environment replacement.
Historical capture is sealed evidence, not renewed deployment authorization. A later
operator close must independently bind this fresh certificate to all current state.
"""
import argparse
import copy
import os
from pathlib import Path
import stat
import subprocess
import sys
from contextlib import nullcontext

import release as c
from release import h, R, s
from pinned_reference import read_source, verify_sources, LIVE_REFERENCE

ORIGINAL_OWNER = 'XM2KNK1vALW96zjrdihS3h'
ORIGINAL_SCOPE = 'front-fast-20261120-XM2KNK1v'
ORIGINAL_STAGE = '/opt/ops/' + ORIGINAL_SCOPE
ORIGINAL_PINS = {
    'ownerTask': ORIGINAL_OWNER,
    'scope': ORIGINAL_SCOPE,
    'manifestSha256': '3ba4942e164e6b12b3902e3252cdbef40243ea2b8824d4a9136f6b3fc635d1fd',
    'reviewSha256': '0d843938bcf1426c504ebc0151bf80dd210e0616018252ad68f4750edf1cd9a9',
    'controllerSha256': '8712e7100c1330bc7f0fb24a05a7e1b261aed4afeee00549b1282dc0ac0377a2',
    'captureSha256': '707f2b40d6362ffaa4f922438c1cdcb4eefb3f13ac8d8956d1e70d889bf3a519',
    'failureSha256': '9e69d3f00107ee2b25ce20804932887bc4a5886f9b2ed78ef27b5dd584bf31ec',
    'attemptSha256': 'fa51b0ca0446e7fe93f5ed8b6b05691ef9a67b3648ef894835b46e28191b5b1f',
    'baselineProtectedFileCount': 19577,
    'immutableLeavesCount': 11,
}


def certifier_bundle():
    sources = dict(c.source_files(), **{'certify.py': h.H(read_source(Path(__file__).absolute()))})
    return dict(certifierSourceFiles=sources, certifierSha256=h.H(h.encode(sources)))


class RecoveryConfig(s.Config):
    @property
    def stage(self):
        return self.path(ORIGINAL_STAGE)


class Certifier:
    def __init__(self, cfg=None, *, pins=None, snapshot_reader=None, process_reader=None,
                 get_reader=None, list_reader=None, health_reader=None, source_reader=None,
                 retired_reader=None):
        self.cfg = cfg or RecoveryConfig()
        injected = any(x is not None for x in (pins, snapshot_reader, process_reader, get_reader,
            list_reader, health_reader, source_reader, retired_reader))
        h.need(not injected or self.cfg.fixture_root is not None, 'CERTIFY_INJECTION_TMP_ONLY')
        h.need(self.cfg.fixture_root is not None or type(self.cfg) is RecoveryConfig,
               'CERTIFY_FIXED_ORIGINAL_STAGE_ONLY')
        self.pins = copy.deepcopy(ORIGINAL_PINS if pins is None else pins)
        self.owner = self.pins['ownerTask']
        self.process_reader = process_reader or R.process_snapshot
        self.snapshot_reader = snapshot_reader
        self.get_reader = get_reader or h.http_get
        self.list_reader = list_reader or c.list_get
        self.health_reader = health_reader or R.verified_listener_health
        self.source_reader = source_reader or self.reference_source
        self.retired_reader = retired_reader or R.retired_process_absent
        self.reference = R.Controller(self.cfg, process_reader=self.process_reader)
        self.self_bundle = certifier_bundle()

    def snapshot(self):
        h.check_lock_inodes()
        h.need(certifier_bundle() == self.self_bundle, 'CERTIFIER_SOURCE_DRIFT')
        if self.cfg.fixture_root is None:
            verify_sources(LIVE_REFERENCE)
        result = self.snapshot_reader(self.cfg) if self.snapshot_reader else self.reference.snapshot()
        c.exact(result, c.SNAPSHOT_KEYS, 'RECOVERY_SNAPSHOT')
        R.validate_processes(self.cfg, result['processes'])
        return result

    def load_evidence(self):
        self.reference.private(self.cfg.stage)
        self.reference.private(self.cfg.package)
        self.reference.private(self.cfg.receipt)
        paths = {'manifest': self.cfg.package / 'manifest.json', 'review': self.cfg.package / 'review.json',
                 'capture': self.cfg.package / 'capture.json', 'failure': self.cfg.receipt / 'failure.json',
                 'attempt': self.cfg.receipt / 'attempt.json'}
        raw = {}
        for name, path in paths.items():
            raw[name] = h.regular(path)
            h.need(h.H(raw[name]) == self.pins[name + 'Sha256'], 'RECOVERY_PIN_MISMATCH:' + name)
        m = c.exact(h.decode(raw['manifest']), c.MANIFEST_KEYS, 'ORIGINAL_MANIFEST')
        rv = c.exact(h.decode(raw['review']), c.REVIEW_KEYS, 'ORIGINAL_REVIEW')
        capture, failure, attempt = (h.decode(raw[n]) for n in ('capture', 'failure', 'attempt'))
        h.need(m['schema'] == 'fast-manifest-v1' and m['ownerTask'] == self.owner
               and m['scope'] == self.pins['scope'] and m['ttlSeconds'] == s.TTL
               and m['controllerSha256'] == self.pins['controllerSha256']
               and m['reloadIds'] == list(s.RELOAD_IDS) and m['forbiddenBusinessChanges'] == s.FORBIDDEN
               and m['storePolicy'] == s.STORE_POLICY and m['sourceVerification'] == s.SOURCE_SEQUENCE,
               'ORIGINAL_MANIFEST_IDENTITY')
        sources = {n: h.H(read_source(self.cfg.stage / 'controller' / n)) for n in c.SOURCE_NAMES}
        h.need(sources == m['sourceFiles'] and h.H(h.encode(sources)) == m['controllerSha256']
               and m['referenceSourceFiles'] == c.PINS, 'ORIGINAL_SOURCE_BUNDLE_DRIFT')
        bindings = h.decode(h.regular(self.cfg.stage / 'controller/bindings.json'))
        c.exact(bindings, c.BINDING_KEYS, 'ORIGINAL_BINDINGS')
        h.need(sources['bindings.json'] == m['bindingsSha256'], 'ORIGINAL_BINDING_PIN')
        h.need(rv['status'] == 'passed' and rv['independent'] is True and rv['releaseApproved'] is True
               and rv['manifestSha256'] == self.pins['manifestSha256']
               and all(rv[k] == m[k] for k in ('ownerTask', 'scope', 'controllerSha256', 'sourceFiles',
                   'captureSha256', 'fullMetaSha256', 'coordSha256', 'bindingsSha256')), 'ORIGINAL_REVIEW_BINDING')
        h.need(capture['schema'] == 'fast-capture-v1' and capture['ownerTask'] == self.owner
               and capture['scope'] == self.pins['scope'] and capture['ttlSeconds'] == s.TTL
               and capture['sourceFiles'] == sources and capture['referenceSourceFiles'] == c.PINS
               and capture['controllerSha256'] == m['controllerSha256']
               and capture['bindingsSha256'] == m['bindingsSha256']
               and m['captureSha256'] == self.pins['captureSha256']
               and capture['roots'] == dict(front=str(self.cfg.front), admin=str(self.cfg.public),
                   stage=str(self.cfg.stage), coord=str(self.cfg.coord)), 'ORIGINAL_CAPTURE_BINDING')
        baseline = {k: capture[k] for k in c.SNAPSHOT_KEYS}
        h.need(h.H(h.encode(baseline)) == capture['fullMetaSha256'] == m['fullMetaSha256']
               and capture['protectedFileCount'] == len(capture['protectedFiles'])
               == self.pins['baselineProtectedFileCount'], 'ORIGINAL_FULL_META_BINDING')
        historical_coord = c.b64(capture['coordBase64'])
        h.need(h.H(historical_coord) == m['coordSha256'] == capture['coordSha256']
               and capture['coordRecord']['sha256'] == capture['coordSha256'], 'ORIGINAL_COORD_BINDING')
        self.reference.coord_closed(historical_coord)
        R.validate_processes(self.cfg, capture['processes'])
        h.need(failure['ownerTask'] == attempt['owner_task'] == self.owner
               and failure['scope'] == attempt['scope'] == self.pins['scope']
               and failure['nonce'] == attempt['nonce'] and failure['permanentNoReplay'] is True
               and failure['needsOperatorRecovery'] is True and failure['ownedRecoveryFlagConfirmed'] is True
               and failure['status'] == 'recovery-required-no-replay'
               and attempt['manifestSha256'] == self.pins['manifestSha256']
               and attempt['reviewSha256'] == self.pins['reviewSha256']
               and attempt['controllerSha256'] == m['controllerSha256']
               and attempt['captureSha256'] == m['captureSha256'], 'ORIGINAL_ATTEMPT_FAILURE_BINDING')
        h.need(failure['error'] == 'ReleaseError: ACTUAL_OFFICIAL_MALL_GET_FAILED'
               and failure['rollback'] == {'error': 'ReleaseError: CAPTURE_EXPIRED_OR_FUTURE',
                                          'status': 'unverified-recovery-required'}, 'FIXED_FAILURE_CLASS')
        data = {}
        for name, digest in m['packageFiles'].items():
            h.relative(name)
            data[name] = h.regular(self.cfg.package / name)
            h.need(h.H(data[name]) == h.pin(digest), 'ORIGINAL_PACKAGE_PAYLOAD_DRIFT')
        names, dirs = set(), set()
        for base, children, files in os.walk(self.cfg.package, followlinks=False):
            for name in children + files:
                h.need(not (Path(base) / name).is_symlink(), 'ORIGINAL_PACKAGE_SYMLINK')
            names.update((Path(base) / n).relative_to(self.cfg.package).as_posix() for n in files)
            dirs.update((Path(base) / n).relative_to(self.cfg.package).as_posix() for n in children)
        expected_dirs = {p.as_posix() for n in m['packageFiles'] for p in Path(n).parents if p.as_posix() != '.'}
        h.need(names == set(m['packageFiles']) | {'manifest.json', 'review.json'}
               and dirs == expected_dirs, 'ORIGINAL_PACKAGE_WHITELIST')
        h.need(len(m['newFiles']) == self.pins['immutableLeavesCount']
               and [{k: x[k] for k in ('role', 'path', 'packageFile')} for x in m['newFiles']] == bindings['files'],
               'ORIGINAL_IMMUTABLE_WHITELIST')
        h.need([t['role'] for t in m['targets']] == list(s.TARGET_ROLES)
               and all(t['path'] == str(self.cfg.targets[t['role']]) for t in m['targets']), 'ORIGINAL_TARGET_PATHS')
        return dict(m=m, capture=capture, failure=failure, attempt=attempt, bindings=bindings, data=data)

    def check_processes(self, evidence, rows):
        before = {r['id']: r for r in evidence['capture']['processes']}
        events = evidence['failure']['processReloadEvents']
        h.need([e['id'] for e in events] == list(s.RELOAD_IDS) * 2
               and [e['rollback'] for e in events] == [False] * 6 + [True] * 6, 'RECOVERY_EXACT_EVENT_SEQUENCE')
        for row in rows:
            baseline = before[row['id']]
            if row['id'] not in s.RELOAD_IDS:
                h.need(row == baseline, 'RECOVERY_OTHER_SIX_RAW_CONFIG_EXACT')
                continue
            chain = [e for e in events if e['id'] == row['id']]
            pid, restart, raw = baseline['pid'], baseline['restarts'], baseline['rawProcEnvironSha256']
            role = 'front-api' if row['id'] in s.FRONT_IDS else 'admin-api'
            for event in chain:
                image = evidence['data'][('preimages/' if event['rollback'] else 'postimages/') + role + '.bin']
                h.need(event['beforePid'] == pid and event['beforeRestart'] == restart
                       and event['beforeRawSha256'] == raw and event['afterPid'] != pid
                       and event['afterRestart'] == restart + 1 and event['transportPassed'] is True
                       and event['observedPidChange'] is True and event['apiSha256'] == h.H(image)
                       and event['rawStableSha256'] == baseline['rawStableSha256'], 'RECOVERY_EVENT_CHAIN')
                h.need(self.retired_reader(self.cfg, pid) is True, 'RECOVERY_RETIRED_PID_STILL_PRESENT')
                pid, restart, raw = event['afterPid'], event['afterRestart'], event['afterRawSha256']
            permitted = {'pid', 'restarts', 'rawProcEnvironSha256'}
            h.need(row['pid'] == pid and row['restarts'] == restart and row['rawProcEnvironSha256'] == raw
                   and {k: v for k, v in row.items() if k not in permitted}
                   == {k: v for k, v in baseline.items() if k not in permitted}, 'RECOVERY_OWN_STABLE_CONFIG_PERMISSIONS_EXACT')

    def check_state(self, evidence, snap):
        capture, m, data = evidence['capture'], evidence['m'], evidence['data']
        self.check_processes(evidence, snap['processes'])
        h.need(snap['servingRoots'] == capture['servingRoots']
               and snap['protectedDirectories'] == capture['protectedDirectories'], 'RECOVERY_ROOT_ALIAS_DIRECTORY_DRIFT')
        expected = copy.deepcopy(capture['protectedFiles'])
        targets = {t['path']: t for t in m['targets']}
        for path, target in targets.items():
            current = snap['protectedFiles'].get(path)
            original = capture['targets'][target['role']]
            before = data[target['beforeFile']]
            h.need(original == capture['protectedFiles'][path] and h.H(before) == target['beforeSha256']
                   == original['sha256'] and h.regular(Path(path)) == before, 'RECOVERY_FOUR_BEFORE_BYTES_REQUIRED')
            if target['role'] == 'main-html':
                h.need(current == original, 'RECOVERY_UNSWITCHED_HTML_FULL_METADATA')
            else:
                # These three were atomic forward+inverse replaced. ONLY inode and
                # mtime/ctime may differ; all fresh metadata is frozen through close.
                excluded = {'ino', 'mtimeNs', 'ctimeNs'}
                h.need(current is not None and current['kind'] == 'file' and current['nlink'] == 1
                       and {k: v for k, v in current.items() if k not in excluded}
                       == {k: v for k, v in original.items() if k not in excluded}, 'RECOVERY_TARGET_REPLACEMENT_METADATA')
            expected[path] = current
        for spec in m['newFiles']:
            path = Path(spec['path'])
            h.need(str(path) not in expected and path.parent.is_dir()
                   and spec['mode'] == 0o644 and spec['size'] == len(data[spec['packageFile']])
                   and h.H(data[spec['packageFile']]) == spec['sha256'], 'RECOVERY_RETAINED_LEAF_BINDING')
            record = h.describe(path)
            h.need(record == snap['protectedFiles'].get(str(path)) and record['kind'] == 'file'
                   and record['nlink'] == 1 and record['sha256'] == spec['sha256']
                   and record['size'] == spec['size'] and record['statmode'] == (stat.S_IFREG | spec['mode'])
                   and (record['uid'], record['gid']) == (spec['uid'], spec['gid'])
                   and h.regular(path) == data[spec['packageFile']], 'RECOVERY_RETAINED_LEAF_EXACT_BYTES_METADATA')
            expected[str(path)] = record
        h.need(snap['protectedFiles'] == expected and len(expected) == self.pins['baselineProtectedFileCount']
               + self.pins['immutableLeavesCount'], 'RECOVERY_COMPLETE_INVENTORY_EXACT')

    def reference_source(self, evidence, digest):
        h.need(self.cfg.fixture_root is None, 'CERTIFY_PRODUCTION_SOURCE_ONLY')
        # The new candidate adapter has a DIFFERENT technical projection. Recovery
        # must use the independently pinned OLD projection's full-source verifier.
        reference_cfg = c.old_scope.Config()
        h.need(str(reference_cfg.stage / 'controller') == str(LIVE_REFERENCE), 'RECOVERY_FIXED_REFERENCE_STAGE')
        return R.verified_source(reference_cfg, digest)

    def certify(self, coord_sha, coord_record_sha):
        return self.certify_locked(coord_sha, coord_record_sha, acquire_locks=True)

    def certify_locked(self, coord_sha, coord_record_sha, *, acquire_locks=False):
        # A caller preparing a durable receipt/close can retain these SAME locks.
        # This is not a lock bypass: an already-held path requires both pinned FDs.
        if not acquire_locks:
            active = {str(path) for path, fd, old in h._ACTIVE_LOCKS}
            h.need(all(str(path) in active for path in self.cfg.locks), 'CERTIFY_BOTH_LOCKS_MUST_ALREADY_BE_HELD')
            h.check_lock_inodes()
        with h.locked(self.cfg) if acquire_locks else nullcontext():
            evidence = self.load_evidence()
            coord, record = h.regular(self.cfg.coord), h.describe(self.cfg.coord)
            h.need(h.H(coord) == h.pin(coord_sha) and h.H(h.encode(record)) == h.pin(coord_record_sha), 'RECOVERY_FRESH_COORD_PIN')
            state = h.decode(coord)
            window = state.get('window', {})
            h.need(state.get('shared_release_active') is True and state.get('needsOperatorRecovery') is True
                   and window.get('status') == 'recovery-required' and window.get('needsOperatorRecovery') is True
                   and window.get('owner_task') == self.owner and window.get('scope') == self.pins['scope']
                   and window.get('nonce') == evidence['attempt']['nonce']
                   and window.get('manifestSha256') == self.pins['manifestSha256']
                   and window.get('reviewSha256') == self.pins['reviewSha256']
                   and window.get('controllerSha256') == self.pins['controllerSha256'], 'RECOVERY_OWN_HOLD_IDENTITY')
            first = self.snapshot()
            self.check_state(evidence, first)
            store = self.cfg.targets['technical-store']
            lock = Path(str(store) + '.lock')
            h.need(not lock.exists() and not lock.is_symlink(), 'RECOVERY_STORE_WRITER_LOCK')
            store_bytes, store_record = h.regular(store), h.describe(store)
            proof_bytes = self.source_reader(evidence, store_record['sha256'])
            h.need(isinstance(proof_bytes, bytes), 'RECOVERY_OLD_SOURCE_EXACT_PROOF_BYTES')
            proof = h.decode(proof_bytes)
            c.recent(proof['verifiedAtUtc'])
            doc = R.technical_store(store_bytes, proof_bytes, self.cfg.fixture_root is not None)
            h.need(h.regular(store) == store_bytes and h.describe(store) == store_record,
                   'RECOVERY_OLD_FULL_SOURCE_STORE_CAS')
            # Old missing/ready/noPDF is legitimate restored before, not candidate
            # ready/PDF success. Full current source authentication remains required.
            entries = list(c.target_entries(doc).values()) + [e for e in doc['entries']
                if e['identity']['publicId'] == evidence['bindings']['controlPublicId']]
            h.need(len(entries) == 3, 'RECOVERY_TWO_TARGETS_AND_CONTROL')
            business = []
            for entry in entries:
                identity = entry['identity']
                raw, elapsed = self.list_reader(identity['partNumber'])
                rows = c.response_items(raw)
                h.need(len(rows) == 1 and rows[0].get('publicId') == identity['publicId']
                       and rows[0].get('partNumber') == identity['partNumber'], 'RECOVERY_BASELINE_CANONICAL_IDENTITY')
                technical = rows[0].get('technicalResource')
                unavailable = {'state': 'unavailable', 'parameterVersion': None, 'resource': None}
                h.need(technical == entry['technicalResource'] or technical == unavailable,
                       'RECOVERY_BASELINE_TECHNICAL_OR_EXACT_KNOWN_UNAVAILABLE_REQUIRED')
                h.need(h.regular(store) == store_bytes and h.describe(store) == store_record,
                       'RECOVERY_STORE_CHANGED_DURING_BASELINE_GET')
                business.append(dict(publicId=identity['publicId'], responseSha256=h.H(raw), elapsedMs=elapsed,
                                     baselineKnownTechnicalUnavailable=technical == unavailable))
            for host, path in [('51dianzi.com', self.cfg.html), ('admin.51dianzi.com', self.cfg.public / 'index.html')]:
                h.need(h.H(self.get_reader(host, '')) == h.H(h.regular(path)), 'RECOVERY_ORIGIN_HTML')
            for spec in evidence['m']['newFiles']:
                if spec['role'] == 'asset':
                    relative = c.asset_relative(self.cfg.front, spec['path'])
                    h.need(h.H(self.get_reader('51dianzi.com', relative)) == spec['sha256'], 'RECOVERY_RETAINED_ORIGIN_ASSET')
            sha = {role: h.H(evidence['data']['preimages/' + role + '.bin']) for role in ('front-api', 'admin-api')}
            h.need(self.health_reader(self.cfg, sha) is True, 'RECOVERY_LISTENER_BASELINE')
            final = self.snapshot()
            self.check_state(evidence, final)
            h.need(final == first and h.regular(store) == store_bytes and h.describe(store) == store_record
                   and not lock.exists() and not lock.is_symlink()
                   and h.regular(self.cfg.coord) == coord and h.describe(self.cfg.coord) == record,
                   'RECOVERY_DOUBLE_SNAPSHOT_OR_COORD_DRIFT')
            h.need(self.load_evidence() == evidence, 'RECOVERY_EVIDENCE_CHANGED_DURING_CERTIFY')
            c.recent(proof['verifiedAtUtc'])
            return dict(schema='front-fast-recovery-certificate-v1', status='restored-baseline-readonly-certified',
                ownerTask=self.owner, scope=self.pins['scope'], nonce=evidence['attempt']['nonce'],
                originalManifestSha256=self.pins['manifestSha256'], originalFailureSha256=self.pins['failureSha256'],
                certifierSha256=self.self_bundle['certifierSha256'], certifiedAtUtc=h.now(), certificateTtlSeconds=60,
                coordBeforeSha256=h.H(coord), coordBeforeRecord=record,
                freshFullMetaSha256=h.H(h.encode(final)), protectedFileCount=len(final['protectedFiles']),
                freshProtectedFiles=final['protectedFiles'], freshProtectedDirectories=final['protectedDirectories'],
                freshServingRoots=final['servingRoots'], processesAfter=final['processes'],
                storeRecord=store_record, historicalCaptureUsedAsEvidenceOnly=True,
                oldProjectionFullSourceProofSha256=h.H(proof_bytes), oldSourceVerifiedAtUtc=proof['verifiedAtUtc'],
                oldProjectionSourceVerifierSha256=c.old_scope.SOURCE_VERIFIER_SHA,
                sourceVerifiedAtUtc=proof['verifiedAtUtc'], entriesCount=len(doc['entries']),
                sourceKeysCount=len(doc['sources']),
                baselineBusinessChecks=business,
                allFourBeforeBytesExact=True, otherSixRawExact=True, ownStableConfigEnvPermissionsExact=True,
                immutableLeavesRetained=True, originalStagePermanentNoReplay=True,
                deploymentBusinessAcceptanceVerified=False, coordinationClosed=False,
                requiresSameLockFreshFullStateCasBeforeOperatorClose=True,
                databaseWrites=0, environmentWrites=0, productionWrites=0)


def assert_certificate_current(certifier, certificate, coord_before):
    """Read-only last gate for an authorized close wrapper, after terminal fsync."""
    active = {str(path) for path, fd, old in h._ACTIVE_LOCKS}
    h.need(all(str(path) in active for path in certifier.cfg.locks), 'RECOVERY_CLOSE_BOTH_LOCKS_REQUIRED')
    h.check_lock_inodes()
    h.need(certificate['status'] == 'restored-baseline-readonly-certified'
           and certificate['certifierSha256'] == certifier.self_bundle['certifierSha256']
           and certificate['coordBeforeSha256'] == h.H(coord_before)
           and certificate['coordinationClosed'] is False
           and certificate['deploymentBusinessAcceptanceVerified'] is False, 'RECOVERY_CERTIFICATE_BINDING')
    c.recent(certificate['certifiedAtUtc'], certificate['certificateTtlSeconds'])
    c.recent(certificate['oldSourceVerifiedAtUtc'])
    expected = dict(processes=certificate['processesAfter'], servingRoots=certificate['freshServingRoots'],
                    protectedFiles=certificate['freshProtectedFiles'],
                    protectedDirectories=certificate['freshProtectedDirectories'])
    evidence = certifier.load_evidence()
    h.need(evidence['failure']['nonce'] == certificate['nonce']
           and certifier.pins['manifestSha256'] == certificate['originalManifestSha256'], 'RECOVERY_CLOSE_EVIDENCE_BINDING')
    snapshot = certifier.snapshot()
    certifier.check_state(evidence, snapshot)
    h.need(snapshot == expected and h.H(h.encode(snapshot)) == certificate['freshFullMetaSha256']
           and h.regular(certifier.cfg.coord) == coord_before
           and h.describe(certifier.cfg.coord) == certificate['coordBeforeRecord'], 'RECOVERY_LAST_FULL_STATE_COORD_CAS')
    lock = Path(str(certifier.cfg.targets['technical-store']) + '.lock')
    h.need(not lock.exists() and not lock.is_symlink(), 'RECOVERY_CLOSE_STORE_WRITER_LOCK')
    c.recent(certificate['certifiedAtUtc'], certificate['certificateTtlSeconds'])
    c.recent(certificate['oldSourceVerifiedAtUtc'])
    return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--bundle', action='store_true')
    group.add_argument('--certify', action='store_true')
    parser.add_argument('--certifier-sha256')
    parser.add_argument('--coord-sha256')
    parser.add_argument('--coord-record-sha256')
    args = parser.parse_args()
    if args.bundle:
        h.need(not any((args.certifier_sha256, args.coord_sha256, args.coord_record_sha256)), 'CERTIFIER_BUNDLE_LOCAL_ONLY')
        result = certifier_bundle()
    else:
        h.need(args.certifier_sha256 == certifier_bundle()['certifierSha256'], 'CERTIFIER_EXPLICIT_SOURCE_PIN')
        h.need(args.coord_sha256 and args.coord_record_sha256, 'CERTIFIER_FRESH_COORD_PINS_REQUIRED')
        result = Certifier().certify(args.coord_sha256, args.coord_record_sha256)
    sys.stdout.buffer.write(h.encode(result))


if __name__ == '__main__':
    try:
        main()
    except (Exception, KeyboardInterrupt) as exc:
        # Do not stringify external exceptions or print verifier streams/private data.
        print('READONLY_RECOVERY_CERTIFICATION_FAILED: ' + type(exc).__name__, file=sys.stderr)
        sys.exit(1)
