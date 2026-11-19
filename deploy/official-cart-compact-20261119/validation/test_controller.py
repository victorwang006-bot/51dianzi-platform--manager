#!/usr/bin/env python3
"""OFFLINE ONLY. No ProductionHost/CLI/main calls; no live paths are accessed.
Actual W/live baseline and saved root preimages are read as LOCAL evidence only.
State-machine fixtures are explicitly synthetic; they do not assert readiness.
"""
import copy
from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('cart_controller', Path(__file__).with_name('controller.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
W = Path(__file__).resolve().parent.parent


class MemoryFiles:
    """No syscall forwarding and no real path interpretation."""
    stage = c.STAGE
    def __init__(self, data):
        self.data = dict(data)
        self.calls = []
        self.fault = None
    def read(self, path):
        if path not in self.data:
            raise FileNotFoundError('fixture')
        return self.data[path]
    def optional(self, path):
        return self.data.get(path)
    def metadata(self, path):
        return {'mode': 0o644, 'uid': 0, 'gid': 0}
    def event(self, op, path, moment):
        if self.fault:
            self.fault(op, path, moment)
    def create(self, path, data, mode=0o600):
        self.event('create', path, 'before')
        c.need(path not in self.data, 'EXISTS')
        self.data[path] = data
        self.calls.append(('create', path))
        self.event('create', path, 'after')
    def cas(self, path, before, after):
        self.event('cas', path, 'before')
        c.need(self.read(path) == before, 'FULL_BYTE_CAS')
        self.data[path] = after
        self.calls.append(('cas', path))
        self.event('cas', path, 'after')
    def prepare_audit(self):
        self.calls.append(('mkdir', self.stage + '/audit'))
    @contextmanager
    def locks(self):
        self.calls.append(('locks', c.LOCKS))
        yield


class MemoryHost:
    def __init__(self, rows):
        self.rows = copy.deepcopy(rows)
        self.reloads = []
        self.probe_failure = False
        self.reload_failure = None
        self.raw = {str(r['id']): c.H(('raw-' + str(r['id'])).encode()) for r in rows}
    def processes(self):
        return copy.deepcopy(self.rows)
    def raw_environment(self, rows):
        return dict(self.raw)
    def reload(self, ident):
        self.reloads.append(ident)
        if ident == self.reload_failure:
            raise RuntimeError('synthetic reload failure')
        next(r for r in self.rows if r['id'] == ident)['pid'] += 100000
    def probes(self, legacy=False):
        if self.probe_failure and not legacy:
            raise RuntimeError('synthetic probe failure')
        return {'anonymousRouteGuardOnly': not legacy, 'financialCalls': 0, 'loggedInLogicalTested': False}


class AdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.initial_raw = (W / 'live/protection-initial.json').read_bytes()
        cls.initial = c.decode(cls.initial_raw)
        cls.controller_bytes = Path(c.__file__).read_bytes()
        p = {'protection-initial.json': cls.initial_raw,
             'front.before.js': (W / 'live/front-api.js').read_bytes(),
             'refund.before.js': (W / 'live/refund-worker.js').read_bytes(),
             'cart.runtime.mjs': b'export const syntheticOnly=true;\n',
             'stock.runtime.mjs': b'export const syntheticStockOnly=true;\n',
             'migration.sql': b'-- SYNTHETIC SQL NEVER EXECUTED\n',
             'schema-verifier.cjs': b'// SYNTHETIC HELPER NEVER EXECUTED\n',
             'effective-before.json': c.encode({'provided': False})}
        runtimes = []
        deltas = []
        targets = []
        for role, path, base, prefix, filename, key in (
            ('front', c.FRONT, c.FRONT_RUNTIME, 'officialCart', 'cart.runtime.mjs', 'frontApi'),
            ('refund', c.REFUND, c.REFUND_RUNTIME, 'officialCartStock', 'stock.runtime.mjs', 'refundWorker')):
            sha = c.H(p[filename])
            dest = base + '/' + prefix + '.' + sha + '.runtime.mjs'
            runtimes.append({'role': role, 'path': dest, 'sha256': sha, 'mode': 0o644})
            before = p[role + '.before.js']
            addition = ('\nimport "../runtime/' + Path(dest).name + '";\n').encode()
            after = before + addition
            p[role + '.after.js'] = after
            targets.append({'role': role, 'path': path, 'beforeSha256': c.H(before), 'afterSha256': c.H(after),
                            'mode': 0o644, 'uid': 0, 'gid': 0})
            deltas.append({'role': role, 'beforeSha256': c.H(before), 'afterSha256': c.H(after),
                           'edits': [{'offset': len(before), 'beforeHex': '', 'afterHex': addition.hex()}]})
        p['source-delta.json'] = c.encode({'schemaVersion': 1, 'targets': deltas})
        p['source-binding.json'] = c.encode({'schemaVersion': 1, 'status': 'PASS', **{k: True for k in c.BINDING_FIELDS}})
        cap = {'schemaVersion': 1, 'ownerTask': c.OWNER, 'nonce': 'a' * 32, 'capturedAtUtc': c.now(),
               'coordinatorSha256': cls.initial['coordinatorSha256'], 'newFlagBeforeSha256': None,
               'protectedFiles': cls.initial['protectedFiles'], 'beforeProcesses': cls.initial['beforeProcesses'],
               'targets': cls.initial['targets'], 'rawEnvironment': {'provided': False, 'byId': {}}}
        p['capture.json'] = c.encode(cap)
        p['schema-receipt.json'] = c.encode({'status': 'verified', 'action': 'apply',
            'sqlSha256': c.H(p['migration.sql']), 'migrationSha256': c.H(p['migration.sql']),
            'targetTables': c.TABLES, 'checkedAtUtc': c.now(), 'oldSchemasUnchanged': True,
            'oldSingleUniquesUnchanged': True, 'oldBusinessRecordsUnchanged': True, 'businessWrites': 0,
            'tables': [{'table': t, 'exists': True, 'create': 'SYNTHETIC ENGINE=InnoDB',
                        'columns': [], 'indexes': [], 'count': 0} for t in c.TABLES]})
        cls.package = p
        cls.manifest = {'schemaVersion': 1, 'ownerTask': c.OWNER, 'scope': c.SCOPE,
            'controllerSha256': c.H(cls.controller_bytes), 'packageFiles': {k: c.H(v) for k, v in p.items()},
            'targets': targets, 'runtimes': runtimes, 'reloadIds': list(c.IDS)}

    def sealed(self, m=None, p=None):
        m = copy.deepcopy(m or self.manifest)
        p = dict(p or self.package)
        m['packageFiles'] = {k: c.H(v) for k, v in p.items()}
        raw = c.encode(m)
        review = c.encode({'status': 'PASS', 'independent': True, 'reviewedBy': 'root',
            'manifestSha256': c.H(raw), 'controllerSha256': c.H(self.controller_bytes),
            'captureSha256': c.H(p['capture.json']), 'schemaReceiptSha256': c.H(p['schema-receipt.json']),
            'sourceDeltaSha256': c.H(p['source-delta.json']), 'sourceBindingSha256': c.H(p['source-binding.json'])})
        return raw, review, p, self.controller_bytes, c.H(raw), c.H(review)

    def machine(self):
        # SYNTHETIC state-machine hashes; NOT fed into validate_package or used as proof.
        m = copy.deepcopy(self.manifest)
        cap = c.decode(self.package['capture.json'])
        p = dict(self.package)
        data = {}
        for r in cap['protectedFiles']:
            data[r['path']] = ('fixture-protected:' + r['path']).encode()
            r['sha256'] = c.H(data[r['path']])
        html = cap['targets']['frontHtml']
        data[html['path']] = b'synthetic html'
        html['sha256'] = c.H(data[html['path']])
        for t in m['targets']:
            p[t['role'] + '.before.js'] = ('old-' + t['role']).encode()
            p[t['role'] + '.after.js'] = ('new-' + t['role']).encode()
            t['beforeSha256'] = c.H(p[t['role'] + '.before.js'])
            t['afterSha256'] = c.H(p[t['role'] + '.after.js'])
            data[t['path']] = p[t['role'] + '.before.js']
        foreign = {'owner_task': 'foreign-owner', 'status': 'verified', 'closedAtUtc': 'old', 'payload': ['keep']}
        data[c.COORD] = c.encode({'shared_release_active': False, 'foreignField': {'keep': 17},
                                  'window': foreign, 'window_history': [copy.deepcopy(foreign)]})
        cap['coordinatorSha256'] = c.H(data[c.COORD])
        fs, host = MemoryFiles(data), MemoryHost(cap['beforeProcesses'])
        return c.Controller(fs, host, m, cap, p, '9' * 64)

    def test_01_real_initial_277_and_closed_package_positive(self):
        self.assertEqual(c.H(self.initial_raw), c.INITIAL_SHA)
        self.assertEqual(len(self.initial['protectedFiles']), 277)
        self.assertEqual(c.process_partition(self.initial['beforeProcesses']), c.IDS)
        m, capture = c.validate_package(*self.sealed())
        self.assertEqual(capture['protectedFiles'], self.initial['protectedFiles'])
        self.assertFalse(capture['rawEnvironment']['provided'])

    def test_02_manifest_cannot_expand_namespace_script_owner_or_runtime(self):
        for mutate in (
            lambda m: m.update(command='anything'),
            lambda m: m.update(ownerTask='old-owner'),
            lambda m: m['targets'][0].update(path=c.FRONT.replace('/front/', '/admin/')),
            lambda m: m['runtimes'][0].update(path=c.FRONT_RUNTIME + '/impostor.runtime.mjs'),
            lambda m: m.update(reloadIds=[191, 193, 194, 200, 203])):
            changed = copy.deepcopy(self.manifest)
            mutate(changed)
            with self.subTest(mutate=mutate), self.assertRaises(c.Refusal):
                c.validate_package(*self.sealed(changed))
        p = dict(self.package)
        cap = c.decode(p['capture.json'])
        cap['beforeProcesses'][1]['script'] = c.FRONT + '.impostor'
        p['capture.json'] = c.encode(cap)
        with self.assertRaisesRegex(c.Refusal, 'SCRIPTS'):
            c.validate_package(*self.sealed(p=p))
        for runtime in (c.REFUND_RUNTIME + '/officialCart.' + 'a' * 64 + '.runtime.mjs', '/tmp/plugin.mjs'):
            with self.assertRaisesRegex(c.Refusal, 'CAPABILITY'):
                c.ProductionFiles(c.STAGE, (), (runtime,))

    def test_03_schema_receipt_missing_stale_false_wrong_table_and_review_seal(self):
        for field, value in (('status', 'pending'), ('targetTables', ['orders']), ('oldSingleUniquesUnchanged', False),
                             ('migrationSha256', '0' * 64), ('checkedAtUtc', '2020-01-01T00:00:00Z')):
            p = dict(self.package)
            receipt = c.decode(p['schema-receipt.json'])
            receipt[field] = value
            p['schema-receipt.json'] = c.encode(receipt)
            with self.subTest(field=field), self.assertRaises(c.Refusal):
                c.validate_package(*self.sealed(p=p))
        p = dict(self.package)
        p['schema-receipt.json'] = b'{}'
        with self.assertRaisesRegex(c.Refusal, 'RECEIPT_REQUIRED'):
            c.validate_package(*self.sealed(p=p))
        args = list(self.sealed())
        bad = c.decode(args[1]); bad['status'] = 'passed'; args[1] = c.encode(bad); args[5] = c.H(args[1])
        with self.assertRaisesRegex(c.Refusal, 'REVIEW_PASS'):
            c.validate_package(*args)
        args = list(self.sealed()); args[5] = '0' * 64
        with self.assertRaisesRegex(c.Refusal, 'TRUST_PINS'):
            c.validate_package(*args)

    def test_04_delta_exact_order_overlap_inverse_and_foreign_remainder(self):
        before, after = b'0123456789', b'01AA45B89'
        d = {'role': 'front', 'beforeSha256': c.H(before), 'afterSha256': c.H(after), 'edits': [
            {'offset': 2, 'beforeHex': b'23'.hex(), 'afterHex': b'AA'.hex()},
            {'offset': 6, 'beforeHex': b'67'.hex(), 'afterHex': b'B'.hex()}]}
        c.validate_delta(before, after, d)
        for edits in (list(reversed(d['edits'])), [d['edits'][0], d['edits'][0]],
                      [dict(d['edits'][0], offset=-1)], [dict(d['edits'][0], beforeHex='ff')]):
            with self.assertRaises(c.Refusal):
                c.validate_delta(before, after, dict(d, edits=edits))
        with self.assertRaises(c.Refusal):
            c.validate_delta(before, after + b'foreign', dict(d, afterSha256=c.H(after + b'foreign')))

    def test_05_exact_four_transients_unicode_lower_business_and_top_upper(self):
        env = {'env': {'business_lower': '保留', 'NODE_OPTIONS': 'keep'}, 'JWT_SECRET': 'synthetic', 'PATH': 'keep'}
        expected = c.H(json.dumps({'env': env['env'], 'topEnv': {k: v for k, v in env.items() if k.isupper()}},
                                  sort_keys=True, separators=(',', ':')).encode())
        self.assertEqual(c.config_hash(env), expected)
        for key in c.VOLATILE:
            value = copy.deepcopy(env); value[key] = 'new'; value['env'][key] = 'new'
            self.assertEqual(c.config_hash(value), expected)
        for key in ('business_lower', 'NODE_OPTIONS', 'DATABASE_URL', 'PATH'):
            value = copy.deepcopy(env); value['env'][key] = 'changed'
            self.assertNotEqual(c.config_hash(value), expected)
        before = self.initial['beforeProcesses']
        after = copy.deepcopy(before)
        for r in after:
            if r['id'] in c.IDS:
                r['pid'] += 123
        c.compare_processes(before, after, c.IDS)
        with self.assertRaises(c.Refusal):
            c.compare_processes(before, after)
        after[0]['pid'] += 1
        with self.assertRaises(c.Refusal):
            c.compare_processes(before, after, c.IDS)

    def test_06_preflight_zero_writes_no_locks_no_temp_coord(self):
        app = self.machine()
        before = dict(app.fs.data)
        result = app.preflight()
        self.assertEqual(result['activeWrites'], 0)
        self.assertFalse(result['rawEnvironVerified'])
        self.assertEqual(app.fs.data, before)
        self.assertEqual(app.fs.calls, [])
        self.assertEqual(app.host.reloads, [])

    def test_07_apply_success_exact_five_reload_preserves_foreign_history_and_closed_then_flag(self):
        app = self.machine()
        old = c.decode(app.fs.read(c.COORD))
        result = app.apply()
        self.assertEqual(result['status'], 'verified')
        self.assertEqual(app.host.reloads, list(c.IDS))
        coord, flag = c.decode(app.fs.read(c.COORD)), c.decode(app.fs.read(c.FLAG))
        self.assertEqual(coord['foreignField'], old['foreignField'])
        self.assertEqual(coord['window_history'][0], old['window_history'][0])
        self.assertEqual(coord['window_history'][-1], coord['window'])
        self.assertFalse(coord['shared_release_active'])
        self.assertTrue(flag['enabled'])
        self.assertEqual(flag['runtimeSha256'], app.m['runtimes'][0]['sha256'])
        exposure = ('create', app.stage + '/audit/exposure.json')
        activation = ('cas', c.FLAG)
        self.assertLess(app.fs.calls.index(exposure), app.fs.calls.index(activation))
        verify = app.verify()
        self.assertEqual(verify['status'], 'VERIFY_PASS')
        self.assertFalse(verify['probe']['loggedInLogicalTested'])

    def test_08_rename_fsync_partial_root_commit_is_owned_rollback(self):
        app = self.machine()
        fired = []
        def fault(op, path, moment):
            if path == c.FRONT and moment == 'after' and not fired:
                fired.append(True)
                raise OSError('synthetic directory fsync after committed rename')
        app.fs.fault = fault
        result = app.apply()
        self.assertEqual(result['status'], 'failed-rolled-back')
        self.assertEqual(app.fs.read(c.FRONT), app.package['front.before.js'])
        self.assertEqual(app.host.reloads, [])  # no PM2 reload had been attempted
        self.assertFalse(c.decode(app.fs.read(c.FLAG))['enabled'])

    def test_09_activation_fsync_partial_commit_latches_exposure_no_code_rollback(self):
        app = self.machine()
        fired = []
        def fault(op, path, moment):
            if path == c.FLAG and moment == 'after' and c.decode(app.fs.read(path)).get('enabled') is True and not fired:
                fired.append(True)
                raise OSError('synthetic rename succeeded then fsync failed')
        app.fs.fault = fault
        result = app.apply()
        self.assertEqual(result['status'], 'recovery-required')
        self.assertTrue(result['exposurePossible'])
        self.assertFalse(result['codeRollback'])
        self.assertFalse(c.decode(app.fs.read(c.FLAG))['enabled'])
        self.assertEqual(app.fs.read(c.FRONT), app.package['front.after.js'])
        self.assertEqual(app.fs.read(c.REFUND), app.package['refund.after.js'])
        self.assertEqual(app.host.reloads, list(c.IDS))

    def test_09b_exposure_intent_committed_then_io_error_retains_new_code(self):
        app = self.machine()
        def fault(op, path, moment):
            if path.endswith('/exposure.json') and op == 'create' and moment == 'after':
                raise OSError('synthetic intent committed then directory fsync failed')
        app.fs.fault = fault
        result = app.apply()
        self.assertEqual(result['status'], 'recovery-required')
        self.assertTrue(result['exposurePossible'])
        self.assertFalse(result['codeRollback'])
        self.assertFalse(c.decode(app.fs.read(c.FLAG))['enabled'])
        self.assertEqual(app.fs.read(c.FRONT), app.package['front.after.js'])
        self.assertEqual(app.fs.read(c.REFUND), app.package['refund.after.js'])
        self.assertEqual(app.host.reloads, list(c.IDS))
        self.assertTrue(c.decode(app.fs.read(c.COORD))['shared_release_active'])

    def test_10_diagnostic_and_receipt_failure_cannot_block_disable_or_owned_recovery(self):
        app = self.machine()
        def fault(op, path, moment):
            if path.endswith('/receipt.json') or path.endswith('/failclosed.json'):
                raise OSError('synthetic log disk unavailable')
        app.fs.fault = fault
        result = app.apply()
        self.assertEqual(result['status'], 'recovery-required')
        self.assertTrue(result['flagDisabled'])
        self.assertFalse(result['codeRollback'])
        self.assertEqual(app.fs.read(c.FRONT), app.package['front.after.js'])
        app = self.machine()
        app.host.probe_failure = True
        app.fs.fault = fault
        result = app.apply()
        self.assertEqual(result['status'], 'failed-rolled-back')
        self.assertTrue(result['codeRollback'])
        self.assertEqual(app.host.reloads, list(c.IDS) + list(c.IDS))

    def test_11_foreign_coord_root_flag_never_overwritten(self):
        for foreign in (c.COORD, c.FRONT, c.FLAG):
            app = self.machine()
            def probes(legacy=False):
                if not legacy:
                    app.fs.data[foreign] = b'foreign exact bytes'
                    raise RuntimeError('synthetic foreign writer')
                return {}
            app.host.probes = probes
            result = app.apply()
            self.assertEqual(app.fs.read(foreign), b'foreign exact bytes')
            self.assertEqual(result['status'], 'recovery-required')
            self.assertFalse(result['codeRollback'])

    def test_12_optional_raw_evidence_requires_real_hash_not_normalized_env(self):
        app = self.machine()
        app.c['rawEnvironment'] = {'provided': True, 'byId': dict(app.host.raw)}
        app.preflight()
        app.host.raw['191'] = 'e' * 64
        with self.assertRaisesRegex(c.Refusal, 'RAW_ENV_DRIFT'):
            app.preflight()
        p = dict(self.package)
        cap = c.decode(p['capture.json']); cap['rawEnvironment'] = {'provided': True, 'byId': {}}
        p['capture.json'] = c.encode(cap)
        with self.assertRaisesRegex(c.Refusal, 'RAW_ENV_NOT_FORGED'):
            c.validate_package(*self.sealed(p=p))

    def test_13_fixed_anonymous_query_probes_no_mutation_and_no_financial_success_claim(self):
        host = c.ProductionHost()
        seen = []
        def fake_get(route, payload):
            seen.append(route)
            if route.startswith('officialCart.'):
                return 401, {'error': {'json': {'code': -32001, 'message': 'Please login (10001)',
                    'data': {'code': 'UNAUTHORIZED', 'httpStatus': 401, 'path': route}}}}
            return 200, {'result': {'data': {'json': {'items': [], 'total': 0, 'page': 1, 'pageSize': 1}}}}
        with patch.object(host, 'get', side_effect=fake_get):
            result = host.probes()
        self.assertEqual(seen, ['officialCart.count', 'officialCart.list', 'officialMall.list'])
        self.assertEqual(result['financialCalls'], 0)
        self.assertFalse(result['loggedInLogicalTested'])
        self.assertTrue(all('prepare' not in route and 'create' not in route for route, _ in c.GET_PROBES))
        with self.assertRaises(c.Refusal):
            host.get('officialCheckout.prepareBasket', {})  # refuses BEFORE network construction

    def test_13b_existing_readonly_protected_hardlink_never_becomes_write_capability(self):
        with tempfile.TemporaryDirectory(prefix='controller-hardlink-offline-') as temp:
            original = Path(temp) / 'original'
            linked = Path(temp) / 'linked'
            original.write_bytes(b'protected-immutable')
            original.link_to(linked) if hasattr(original, 'link_to') else __import__('os').link(original, linked)
            fs = c.ProductionFiles(c.STAGE, [str(linked)], ())
            self.assertEqual(fs.read(str(linked)), b'protected-immutable')
            with self.assertRaises(c.Refusal):
                fs.path(str(linked), write=True)
            with patch.object(c, 'FRONT', str(linked)):
                fs = c.ProductionFiles(c.STAGE, [str(linked)], ())
                with self.assertRaisesRegex(c.Refusal, 'SINGLE_REGULAR_NO_SYMLINK'):
                    fs.path(str(linked))
                with self.assertRaisesRegex(c.Refusal, 'SINGLE_REGULAR_NO_SYMLINK'):
                    fs.path(str(linked), write=True)

    def test_13c_only_exact_system_lock_alias_resolves_to_same_fixed_lock(self):
        fs = c.ProductionFiles(c.STAGE, (), ())
        for name in c.LOCKS:
            with patch.object(c.Path, 'exists', return_value=False), patch.object(c.Path, 'is_symlink', return_value=False), patch.object(c.Path, 'resolve', return_value=Path('/run/lock')):
                self.assertEqual(fs.path(name), Path('/run/lock') / Path(name).name)
        with patch.object(c.Path, 'resolve', return_value=Path('/tmp/foreign')):
            with self.assertRaisesRegex(c.Refusal, 'FIXED_SYSTEM_LOCK_ALIAS'):
                fs.path(c.LOCKS[0])

    def test_13d_real_transport_fixed_3000_canonical_public_route(self):
        with patch.object(c.http.client, 'HTTPConnection') as connection:
            response = connection.return_value.getresponse.return_value
            response.status = 200
            response.read.return_value = c.encode({'result': {'data': {'json': {
                'items': [], 'total': 0, 'page': 1, 'pageSize': 1}}}})
            c.ProductionHost().probes(legacy=True)
            connection.assert_called_once_with('127.0.0.1', 3000, timeout=15)
            args = connection.return_value.request.call_args.args
            self.assertEqual(args[0], 'GET')
            self.assertTrue(args[1].startswith('/api/trpc/officialMall.list?input='))

    def test_13e_unhealthy_original_service_refuses_before_active_write(self):
        for action in ('preflight', 'apply'):
            app = self.machine()
            app.host.probes = lambda legacy=False: c.need(False, 'PUBLIC_READONLY_API_HEALTH')
            before = dict(app.fs.data)
            with self.assertRaisesRegex(c.Refusal, 'PUBLIC_READONLY_API_HEALTH'):
                getattr(app, action)()
            self.assertEqual(app.fs.data, before)
            self.assertTrue(all(call[0] == 'locks' for call in app.fs.calls))
            self.assertEqual(app.host.reloads, [])

    def test_14_real_atomic_primitive_only_mocked_scope_in_private_tmp(self):
        with tempfile.TemporaryDirectory(prefix='controller-adapter-offline-') as temp:
            root = Path(temp)
            target = root / 'target'
            target.write_bytes(b'before')
            target.chmod(0o640)
            old = target.stat()
            fs = c.ProductionFiles(c.STAGE, (), ())
            # Scope binding is mocked ONLY here, never exposed as a production constructor option.
            with patch.object(fs, 'path', return_value=target), patch.object(fs, 'read', side_effect=lambda _: target.read_bytes()):
                fs.cas(c.FRONT, b'before', b'after')
                s = target.stat()
                self.assertEqual((stat.S_IMODE(s.st_mode), s.st_uid, s.st_gid), (0o640, old.st_uid, old.st_gid))
                with patch.object(fs, 'syncdir', side_effect=OSError('offline fsync')):
                    with self.assertRaises(OSError):
                        fs.cas(c.FRONT, b'after', b'partial-committed')
                self.assertEqual(target.read_bytes(), b'partial-committed')
                with self.assertRaises(c.Refusal):
                    fs.cas(c.FRONT, b'after', b'not-written')
                self.assertEqual(target.read_bytes(), b'partial-committed')
            self.assertFalse(list(root.glob('.official-cart-cas-*')))
        fs = c.ProductionFiles(c.STAGE, (), ())
        for path in ('/tmp/not-allowed', c.OLD_FLAG, c.FRONT.replace('/front/', '/admin/')):
            with self.assertRaisesRegex(c.Refusal, 'CAPABILITY'):
                fs.path(path, write=True)

    def test_15_prior_flag_fresh_pin_own_disabled_only_no_foreign_takeover(self):
        for owner, enabled, pin_ok in ((c.OWNER, False, True), ('foreign', False, True), (c.OWNER, True, True), (c.OWNER, False, False)):
            app = self.machine()
            flag = c.encode({'ownerTask': owner, 'enabled': enabled, 'foreignExtra': 'preserve until own CAS'})
            app.fs.data[c.FLAG] = flag
            app.c['newFlagBeforeSha256'] = c.H(flag) if pin_ok else '0' * 64
            if owner == c.OWNER and not enabled and pin_ok:
                self.assertEqual(app.apply()['status'], 'verified')
            else:
                with self.assertRaises(c.Refusal):
                    app.preflight()
                self.assertEqual(app.fs.read(c.FLAG), flag)

    def test_16_actual_saved_effective_capture_and_strict_foreign_raw(self):
        evidence = c.decode((W / 'live/effective-before.json').read_bytes())
        rows = evidence['processes']
        c.compare_effective(rows, copy.deepcopy(rows))
        self.assertEqual([{k: r[k] for k in c.PROCESS_FIELDS} for r in rows], self.initial['beforeProcesses'])
        after = copy.deepcopy(rows)
        for r in after:
            if r['id'] in c.IDS:
                r['pid'] += 1000
                r['rawEnvironSha256'] = 'd' * 64
                r['rawEnvironmentEntryCount'] += 1
        c.compare_effective(rows, after, c.IDS)
        after[0]['rawEnvironSha256'] = '0' * 64
        with self.assertRaisesRegex(c.Refusal, 'RAW_ENV_BYTES_DRIFT'):
            c.compare_effective(rows, after, c.IDS)
        after = copy.deepcopy(rows)
        after[1]['embeddedUserConfigSha256'] = '0' * 64
        with self.assertRaisesRegex(c.Refusal, 'EMBEDDED_USER_CONFIG_DRIFT'):
            c.compare_effective(rows, after, c.IDS)
        p = dict(self.package)
        p['effective-before.json'] = c.encode(evidence)
        # Saved-shape offline fixture only; live CLI keeps check_fresh=True.
        c.validate_package(*self.sealed(p=p), check_fresh=False)

    def test_17_uncertain_reload_without_pid_change_is_not_blindly_retried(self):
        app = self.machine()
        app.host.reload_failure = c.IDS[0]
        result = app.apply()
        self.assertEqual(app.host.reloads, [c.IDS[0]])
        self.assertEqual(result['status'], 'failed-rolled-back')
        self.assertEqual(app.fs.read(c.FRONT), app.package['front.before.js'])

    def test_18_last_coord_drift_no_write_and_original_window_retained(self):
        app = self.machine()
        real = app.protect
        def drift(*args, **kwargs):
            real(*args, **kwargs)
            app.fs.data[c.COORD] = b'foreign-after-first-pin'
        with patch.object(app, 'protect', side_effect=drift):
            with self.assertRaisesRegex(c.Refusal, 'LAST_FRESH_COORD'):
                app.preflight()
        self.assertEqual(app.fs.calls, [])
        app = self.machine()
        coord = c.decode(app.fs.read(c.COORD)); prior = coord['window']; coord['window_history'] = []
        app.fs.data[c.COORD] = c.encode(coord)
        app.c['coordinatorSha256'] = c.H(app.fs.read(c.COORD))
        self.assertEqual(app.apply()['status'], 'verified')
        self.assertEqual(c.decode(app.fs.read(c.COORD))['window_history'][0], prior)

    def test_19_foreign_coord_during_final_receipt_disables_own_flag_retains_code(self):
        app = self.machine()
        def fault(op, path, moment):
            if path.endswith('/receipt.json') and moment == 'after':
                app.fs.data[c.COORD] = b'foreign-final-coordination'
        app.fs.fault = fault
        result = app.apply()
        self.assertEqual(result['status'], 'recovery-required')
        self.assertFalse(c.decode(app.fs.read(c.FLAG))['enabled'])
        self.assertEqual(app.fs.read(c.COORD), b'foreign-final-coordination')
        self.assertEqual(app.fs.read(c.FRONT), app.package['front.after.js'])
        self.assertEqual(app.host.reloads, list(c.IDS))


if __name__ == '__main__':
    unittest.main(verbosity=2)
