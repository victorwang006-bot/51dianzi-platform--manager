#!/usr/bin/env python3
"""Offline text updates; no controller execution, real proc or external calls."""
from pathlib import Path
import hashlib

ROOT = Path(__file__).absolute().parent.parent
path = ROOT / 'prepare-local.py'
old = "CONTROLLER_SHA = '36706f932e6284a1192ef213d85836d25b4c9a7a7023309c11454c4d2dfdfe14'"
new = "CONTROLLER_SHA = '" + hashlib.sha256((ROOT/'release.py').read_bytes()).hexdigest() + "'"
text = path.read_text()
assert old in text
path.write_text(text.replace(old, new, 1))
for name in ('test_release.py', 'test_prepare_local.py'):
    path = ROOT/name
    text = path.read_text()
    # Existing current-scope assertions only; historical R4 rejection stays intact.
    text = text.replace('customer-batch-actions-20261120-6Lfttf6o-R5', 'customer-batch-actions-20261120-6Lfttf6o-R6')
    path.write_text(text)

new_tests = r'''

def r6_ring(address='4000-5000', permissions='rw-s', offset='00000000', device='00:0f', inode='123', name='anon_inode:[io_uring]'):
    # Typed maps data ONLY: device/inode do not represent any fixture FS source.
    return f'{address} {permissions} {offset} {device} {inode} {name}\n'.encode()


class R6KernelMappingTests(unittest.TestCase):
    """Exact source-defined anonymous ring type; synthetic TempDir proc only."""
    setUp = R5DynamicTests.setUp
    proc = R5DynamicTests.proc
    ownproc = R5DynamicTests.ownproc
    collect = R5DynamicTests.collect
    second = R5DynamicTests.second
    remove = R5DynamicTests.remove

    def rings(self, pid, *records):
        path = self.cfg.proc/str(pid)/'maps'
        lines = path.read_bytes().splitlines(keepends=True)
        path.write_bytes(b''.join(line for line in lines if b'anon_inode:' not in line) + b''.join(records))

    def drift(self, **change):
        self.rings(11000, r6_ring())
        self.second(lambda: self.rings(11000, r6_ring(**change)))

    def test_exact_io_uring_pure_record_without_filesystem_read(self):
        with patch.object(r, 'no_link', side_effect=AssertionError('PURE_NO_FS')):
            self.assertEqual(r.dynamic_kernel_mappings(r6_ring()),
                             [['anon_inode:[io_uring]', 'rw-s', '00000000', '00:0f', '123', 4096]])
            self.assertEqual(r.dynamic_maps(r6_ring()), {})

    def test_known_nonexec_shared_permissions_only(self):
        for perms in ('rw-s', 'r--s', '-w-s', '---s'):
            with self.subTest(perms=perms):
                self.assertEqual(r.dynamic_kernel_mappings(r6_ring(permissions=perms))[0][1], perms)

    def test_unknown_and_lookalike_kernel_names_failclosed(self):
        for name in ('anon_inode:[eventpoll]', 'anon_inode:[io_uring2]', 'anon_inode:io_uring',
                     'anon_inode:[io_uring]extra', 'anon_inode:[IO_URING]', 'relative/io_uring'):
            for helper in (r.dynamic_maps, r.dynamic_kernel_mappings):
                with self.subTest(name=name, helper=helper.__name__), self.assertRaisesRegex(r.ReleaseError, 'UNSUPPORTED_MAPPING'):
                    helper(r6_ring(name=name))

    def test_deleted_kernel_name_failclosed(self):
        for helper in (r.dynamic_maps, r.dynamic_kernel_mappings):
            with self.assertRaisesRegex(r.ReleaseError, 'UNSUPPORTED_MAPPING'):
                helper(r6_ring(name='anon_inode:[io_uring] (deleted)'))

    def test_executable_ring_failclosed(self):
        for perms in ('rwx s', 'rwxs', 'r-xs', '--xs'):
            for helper in (r.dynamic_maps, r.dynamic_kernel_mappings):
                with self.subTest(perms=perms, helper=helper.__name__), self.assertRaises(r.ReleaseError):
                    helper(r6_ring(permissions=perms))

    def test_nonshared_ring_failclosed(self):
        for helper in (r.dynamic_maps, r.dynamic_kernel_mappings):
            with self.assertRaisesRegex(r.ReleaseError, 'KERNEL_MAPPING_TYPE'):
                helper(r6_ring(permissions='rw-p'))

    def test_zero_ring_inode_failclosed(self):
        for helper in (r.dynamic_maps, r.dynamic_kernel_mappings):
            with self.assertRaisesRegex(r.ReleaseError, 'KERNEL_MAPPING_TYPE'):
                helper(r6_ring(inode='0'))

    def test_kernel_perline_format_is_validated_before_classification(self):
        variants = [r6_ring(address='bad'), r6_ring(permissions='rrrr'), r6_ring(offset='-1'),
                    r6_ring(device='00:zz'), r6_ring(device='00'), r6_ring(inode='-1'), r6_ring(inode='1.0')]
        for raw in variants:
            for helper in (r.dynamic_maps, r.dynamic_kernel_mappings):
                with self.subTest(digest=r.H(raw), helper=helper.__name__), self.assertRaisesRegex(r.ReleaseError, 'MAPS_FORMAT'):
                    helper(raw)

    def test_empty_or_reversed_ring_range_rejected(self):
        for address in ('4000-4000', '5000-4000'):
            for helper in (r.dynamic_maps, r.dynamic_kernel_mappings):
                with self.subTest(address=address), self.assertRaisesRegex(r.ReleaseError, 'KERNEL_MAPPING_TYPE'):
                    helper(r6_ring(address=address))

    def test_absolute_io_uring_lookalike_remains_filebacked_not_kernel(self):
        source = self.root/'anon_inode:[io_uring]'
        source.write_bytes(b'synthetic absolute file must remain source-protected')
        self.rings(11000, r5_map(source, '5000-6000'))
        result = self.collect()
        row = next(x for x in result['processes'] if x['pid'] == 11000)
        self.assertEqual(row['kernelAnonymousMappings'], [])
        self.assertIn(str(source), row['mappedSourcePaths'])
        self.assertEqual(result['fullSourceMeta'][str(source)], r.describe(source))
        self.second(lambda: source.chmod(0o600))

    def test_absolute_deleted_io_uring_lookalike_not_supported(self):
        source = self.root/'anon_inode:[io_uring]'
        source.write_bytes(b'synthetic source')
        with self.assertRaisesRegex(r.ReleaseError, 'DELETED_OR_ESCAPED_MAPPING'):
            r.dynamic_maps(r5_map(source).rstrip(b'\n')+b' (deleted)\n')

    def test_kernel_records_do_not_masquerade_as_filesystem_sources(self):
        self.rings(11000, r6_ring(), r6_ring(address='6000-8000', inode='456'))
        real = r.dynamic_source
        def source(path, budget):
            self.assertTrue(str(path).startswith('/'))
            self.assertNotIn('anon_inode:', str(path))
            return real(path, budget)
        with patch.object(r, 'dynamic_source', side_effect=source):
            result = self.collect()
        self.assertTrue(all('anon_inode:' not in path for path in result['sources']))
        self.assertTrue(all('anon_inode:' not in path for path in result['fullSourceMeta']))
        self.assertIn(str(self.lib), result['fullSourceMeta'])
        self.assertNotIn(b'PRIVATE_SENTINEL', r.encode(result))
        self.assertNotIn(b'synthetic-secret', r.encode(result))

    def test_all_gods_unowned_six_and_parent_exact_kernel_records(self):
        pids = (1, 1279, 491174, 493698, *self.unowned)
        for pid in pids:
            self.rings(pid, r6_ring(inode=str(pid+100)))
        result = self.collect()
        for row in result['processes']:
            self.assertEqual(row['kernelAnonymousMappings'],
                             r.dynamic_kernel_mappings(r6_ring(inode=str(row['pid']+100))))
        self.second(lambda: self.rings(493698, r6_ring(inode='999999')))

    def test_foreign_ring_birth_guard_reject(self):
        self.second(lambda: self.rings(11000, r6_ring()))

    def test_foreign_ring_drop_guard_reject(self):
        self.rings(11000, r6_ring())
        self.second(lambda: self.rings(11000))

    def test_foreign_ring_multiplicity_guard_reject(self):
        self.rings(11000, r6_ring())
        self.second(lambda: self.rings(11000, r6_ring(), r6_ring(address='9000-a000')))

    def test_foreign_ring_length_guard_reject(self):
        self.drift(address='4000-6000')

    def test_foreign_ring_offset_guard_reject(self):
        self.drift(offset='00001000')

    def test_foreign_ring_device_guard_reject(self):
        self.drift(device='00:10')

    def test_foreign_ring_inode_guard_reject(self):
        self.drift(inode='124')

    def test_foreign_ring_permissions_guard_reject(self):
        self.drift(permissions='r--s')

    def test_same_length_aslr_move_noninterfering(self):
        self.rings(11000, r6_ring())
        before = self.collect()
        self.rings(11000, r6_ring(address='9000-a000'))
        self.assertEqual(self.collect(), before)

    def test_kernel_mapping_order_not_identity_but_duplicates_retained(self):
        a, b = r6_ring(), r6_ring(inode='456')
        self.assertEqual(r.dynamic_kernel_mappings(a+b), r.dynamic_kernel_mappings(b+a))
        self.assertEqual(len(r.dynamic_kernel_mappings(a+a+b)), 3)
        self.assertNotEqual(r.dynamic_kernel_mappings(a+b), r.dynamic_kernel_mappings(a+a+b))

    def test_second_maps_read_rechecks_same_kernel_record(self):
        self.rings(11000, r6_ring())
        real = r.dynamic_read
        calls = []
        def read(path, *args, **kwargs):
            value = real(path, *args, **kwargs)
            if Path(path) == self.cfg.proc/'11000/maps':
                calls.append(1)
                if len(calls) == 2:
                    return value.replace(b' 123 anon_inode:', b' 124 anon_inode:')
            return value
        with patch.object(r, 'dynamic_read', side_effect=read), self.assertRaisesRegex(r.ReleaseError, 'FULL_PROC_READ_RACE'):
            self.collect()

    def test_final_proc_record_rechecks_kernel_after_source_phase(self):
        self.rings(11000, r6_ring())
        real = r.dynamic_source
        changed = []
        def source(path, budget):
            value = real(path, budget)
            if Path(path) == self.script and not changed:
                changed.append(1)
                self.rings(11000, r6_ring(inode='124'))
            return value
        with patch.object(r, 'dynamic_source', side_effect=source), self.assertRaisesRegex(r.ReleaseError, 'FINAL_FULL_PROC_DRIFT'):
            self.collect()

    def test_owned_normal_roll_new_kernel_inodes_keeps_stable_transport(self):
        for slot, pid in self.owned.items():
            self.rings(pid, r6_ring(inode=str(slot)))
        before = self.collect()
        old = self.owned[190]
        self.remove(old)
        self.ownproc(190, 29900, 9500)
        self.rings(29900, r6_ring(inode='999999'), r6_ring(address='6000-8000', inode='999998'))
        self.assertEqual(self.collect(), before)
        for slot in before['ownedSlotsStable']['slots']:
            self.assertNotIn('kernelAnonymousMappings', slot)
            self.assertTrue(all('anon_inode:' not in p for p in slot['executionSourcePaths']))
            self.assertIn(str(self.lib), slot['executionSourcePaths'])

    def test_owned_between_samples_roll_new_ring_still_own_proof_bound(self):
        self.rings(self.owned[190], r6_ring())
        real = r.dynamic_protection_sample
        calls = []
        def sample(*args):
            calls.append(1)
            if len(calls) == 2:
                self.remove(self.owned[190])
                self.ownproc(190, 29900, 9500)
                self.rings(29900, r6_ring(inode='987654'))
            return real(*args)
        with patch.object(r, 'dynamic_protection_sample', side_effect=sample):
            self.collect()
        self.assertEqual(len(calls), 2)

    def test_owned_executable_ring_cannot_hide_in_stable_slots(self):
        self.rings(self.owned[190], r6_ring(permissions='rwxs'))
        with self.assertRaisesRegex(r.ReleaseError, 'KERNEL_MAPPING_TYPE'):
            self.collect()

    def test_owned_kernel_type_does_not_weaken_owned_source_mapping_guard(self):
        self.rings(self.owned[190], r6_ring())
        path = self.cfg.proc/str(self.owned[190])/'maps'
        self.second(lambda: path.write_bytes(path.read_bytes()+r5_map(self.init, '9000-a000')))

    def test_unknown_node_birth_with_legal_ring_still_guard_reject(self):
        def birth():
            self.proc(27000, 1, 8200, self.node, self.root, b'node\0-e\0opaque\0', b'UNKNOWN=opaque\0')
            self.rings(27000, r6_ring(inode='5678'))
        self.second(birth)

    def test_fresh_unknown_dynamic_set_not_fixed_count_or_semantic_approval(self):
        for pid in (27000, 28000):
            self.proc(pid, 1, 8200, self.node, self.root, b'node\0-e\0opaque\0', b'UNKNOWN=opaque\0')
            self.rings(pid, r6_ring(inode=str(pid)))
        result = self.collect()
        self.assertTrue({27000, 28000} <= set(result['activeForeignNodePids']))
        self.assertTrue(result['sourceGraphReviewRequired'])
        self.assertFalse(result['semanticsClosed'])


class R6KernelTransportTests(unittest.TestCase):
    setUp = R5TransportTests.setUp
    fake_run = R5TransportTests.fake_run
    attach = R5TransportTests.attach

    def test_foreign_kernel_drift_rejected_by_whole_transport(self):
        case = self.attach()
        path = case.cfg.proc/'491174/maps'
        path.write_bytes(path.read_bytes()+r6_ring())
        self.native_hook = lambda: path.write_bytes(path.read_bytes().replace(b' 123 anon_inode:', b' 124 anon_inode:'))
        with self.assertRaisesRegex(r.ReleaseError, 'EXTERNAL_TRANSPORT_DRIFT'):
            r.transport(self.cfg)

    def test_owned_roll_with_new_kernel_inode_preserves_whole_transport(self):
        case = self.attach()
        path = case.cfg.proc/str(case.owned[190])/'maps'
        path.write_bytes(path.read_bytes()+r6_ring())
        before = r.transport(self.cfg)
        def roll():
            case.remove(case.owned[190])
            case.ownproc(190, 29000, 8400)
            new = case.cfg.proc/'29000/maps'
            new.write_bytes(new.read_bytes()+r6_ring(inode='98765'))
        self.native_hook = roll
        self.assertEqual(r.transport(self.cfg), before)

    def test_gods_unowned_six_kernel_record_kept_in_full_transport(self):
        case = self.attach()
        pids = (1279, 491174, 493698, *case.unowned)
        for pid in pids:
            path = case.cfg.proc/str(pid)/'maps'
            path.write_bytes(path.read_bytes()+r6_ring(inode=str(pid)))
        result = r.transport(self.cfg)
        for row in result['externalProtection']['processes']:
            if row['pid'] in pids:
                self.assertEqual(row['kernelAnonymousMappings'], r.dynamic_kernel_mappings(r6_ring(inode=str(row['pid']))))
        self.assertEqual(result['externalProtection'], case.collect())
'''
path = ROOT/'test_release.py'
text = path.read_text()
marker = "if __name__ == '__main__':\n    unittest.main()"
assert text.count(marker) == 1
path.write_text(text.replace(marker, new_tests + '\n' + marker))

preparer_tests = '''

    def test_r6_old_r5_scope_capture_not_reusable(self):
        self.cap['scope'] = 'customer-batch-actions-20261120-6Lfttf6o-R5'
        self.save_capture()
        with self.assertRaisesRegex(P.PrepareError, 'fixed production capture binding'):
            P.inputs(self.args, R)
        self.assertEqual(self.calls, []); self.assertFalse(self.out.exists())

    def test_r6_old_exact_36706f_source_and_capture_pin_rejected_without_import(self):
        old = (HERE/'evidence/r6-baseline-36706f/release.py').read_bytes()
        self.assertEqual(P.sha(old), '36706f932e6284a1192ef213d85836d25b4c9a7a7023309c11454c4d2dfdfe14')
        with patch.object(P, 'read', return_value=old), patch.object(P.importlib.util, 'spec_from_file_location', side_effect=AssertionError('OLD_SOURCE_NOT_IMPORTED')):
            with self.assertRaisesRegex(P.PrepareError, 'controller drift'):
                REAL_LOADER()
        self.cap['controllerSha256'] = P.sha(old)
        self.save_capture()
        with self.assertRaisesRegex(P.PrepareError, 'fixed production capture binding'):
            P.inputs(self.args, R)
        self.assertEqual(self.calls, []); self.assertFalse(self.out.exists())
'''
path = ROOT/'test_prepare_local.py'
text = path.read_text()
assert text.count(marker) == 1
path.write_text(text.replace(marker, preparer_tests + '\n' + marker))
