from pathlib import Path

root = Path(__file__).absolute().parent.parent
path = root / 'test_release.py'
text = path.read_text()
marker = "if __name__ == '__main__':\n    unittest.main()\n"
assert text.count(marker) == 1
addition = r'''
class R4DomainTests(unittest.TestCase):
    """Only synthetic Python JSON trees; actual fclone evidence is already offline."""
    def fixture(self):
        case = R3RawTests('test_exact_source_generated_projection_preserves_all_retained_bytes')
        case.setUp()
        return case

    def put(self, tree, location, value):
        if location == 'root': tree['__proto__'] = value
        elif location == 'env': tree['env']['__proto__'] = value
        elif location == 'opaque': tree['opaque'] = {'deep': {'__proto__': value}}
        else: tree['opaque'] = [1, {'deep': [{'__proto__': value}]}]

    def test_proto_root_env_nestedopaque_list_in_model_and_actual_refused_without_cleaning(self):
        for side in ('model', 'actual'):
            for location in ('root', 'env', 'opaque', 'list'):
                for payload in ({'inherited': 'x'}, None, 'ignored-by-setter'):
                    case = self.fixture()
                    model, value = copy.deepcopy(case.model), copy.deepcopy(case.v)
                    self.put(model['pm2_env'] if side == 'model' else value, location, payload)
                    before_model, before_value = copy.deepcopy(model), copy.deepcopy(value)
                    raw = case.bytes(value); original_raw = bytes(raw)
                    with self.subTest(side=side, location=location, payload=payload), \
                         patch.object(r.copy, 'deepcopy', side_effect=AssertionError('GUARD_BEFORE_FORECAST')), \
                         self.assertRaisesRegex(r.ReleaseError, '^PM2_JSON_DOMAIN_PROTO_KEY$'):
                        r.pm2_raw_binding(raw, model)
                    self.assertEqual(model, before_model); self.assertEqual(value, before_value)
                    self.assertEqual(raw, original_raw)
                    self.assertEqual(r.decode(r.raw_values(raw)[b'pm2_env']), value)

    def test_fifteen_finite_utf8_json_guard_samples_keep_values_keys_and_deepcopy(self):
        samples = [None, [True, False], '', {}, [],
            [0, -0.0, 1, -1, 0.125, -0.125, 1.0, 1e-7, 1e20, 5e-324,
             1.7976931348623157e308, 2**53-1, -(2**53-1)],
            {'值': '汉字𠮷😀', 'escape': 'quote" slash/ backslash\\ line\n tab\t nul\0'},
            {'pair': '😀', 'empty': ''},
            {'z': 1, '10': 10, '2': 2, '01': 1, '4294967294': 4, '0': 0},
            {'x': {'b': 1, '9': 9, '1': 1}, 'a': [{'4': 4, '2': 2, 'c': 3}]},
            {'a': [1, None, False, {'b': ['x', {'n': -2.5}]}], 'empty': {}},
            {'status': 'online', 'env': {'nested': {'status': 'launching', 'axm_actions': []}}},
            {'0': 'x', 'length': 1, 'indexOf': 'not-a-function', 'extra': True},
            {'constructor': {'prototype': {'safe': 1}}, 'prototype': 'data', 'toString': 'data'},
            {'a': {'v': [1, 2]}, 'b': {'v': [1, 2]}}]
        self.assertEqual(len(samples), 15)
        for value in samples:
            before = copy.deepcopy(value); wire = r.encode(value)
            self.assertIsNone(r.pm2_json_domain(value))
            cloned = copy.deepcopy(value)
            self.assertEqual(cloned, before); self.assertEqual(r.encode(value), wire)
            if isinstance(value, (dict, list)): self.assertIsNot(cloned, value)
            if isinstance(value, dict): self.assertEqual(list(cloned), list(value))

    def test_ordinary_constructor_prototype_keys_and_opaque_string_preserved_in_binding(self):
        case = self.fixture(); model, value = copy.deepcopy(case.model), copy.deepcopy(case.v)
        plain = {'constructor': {'prototype': {'safe': 1}}, 'prototype': 'data', 'toString': 'data',
                 'opaqueJSON': '{"__proto__":{"not":"a parsed key"}}'}
        model['pm2_env']['ordinary'] = copy.deepcopy(plain); value['ordinary'] = copy.deepcopy(plain)
        raw = case.bytes(value); before = copy.deepcopy(model)
        self.assertTrue(r.pm2_raw_binding(raw, model)[2])
        self.assertEqual(model, before); self.assertIn(b'"constructor"', raw)
        self.assertEqual(r.decode(r.raw_values(raw)[b'pm2_env'])['ordinary'], plain)

    def test_nonjson_types_nonstring_keys_and_python_special_subclasses_refused(self):
        class CustomDict(dict): pass
        class CustomInt(int): pass
        for bad in (b'x', (1,), {1}, object(), lambda: None, {1: 'x'}, CustomDict(x=1), CustomInt(1)):
            with self.subTest(kind=type(bad).__name__), self.assertRaisesRegex(r.ReleaseError, 'PM2_JSON_DOMAIN'):
                r.pm2_json_domain({'opaque': [bad]})
        for side in ('model', 'actual'):
            case = self.fixture(); model = copy.deepcopy(case.model); value = copy.deepcopy(case.v)
            if side == 'model': model['pm2_env']['opaque'] = b'not-JSON'
            else: value['opaque'] = 2**53 + 1
            with self.subTest(side=side), self.assertRaisesRegex(r.ReleaseError, 'PM2_JSON_DOMAIN'):
                r.pm2_raw_binding(case.bytes(value), model)

    def test_nonfinite_and_unsafe_integer_domain_both_inputs_refused(self):
        for bad in (float('inf'), float('-inf'), float('nan'), 2**53, -(2**53), 2**53+1):
            with self.subTest(bad=repr(bad)), self.assertRaisesRegex(r.ReleaseError, 'DOMAIN_NONFINITE|DOMAIN_UNSAFE_INTEGER'):
                r.pm2_json_domain({'opaque': [{'n': bad}]})
        for bad in (float('inf'), float('-inf'), float('nan'), 2**53, -(2**53)):
            case = self.fixture(); model = copy.deepcopy(case.model); model['pm2_env']['opaque'] = [bad]
            with self.subTest(model=repr(bad)), self.assertRaisesRegex(r.ReleaseError, 'PM2_JSON_DOMAIN'):
                r.pm2_raw_binding(case.raw, model)
        for token in (b'9007199254740993', b'-9007199254740992', b'1e400', b'-1e400', b'NaN'):
            case = self.fixture(); data = r.raw_values(case.raw)[b'pm2_env']
            raw = case.raw.replace(data, data[:-1]+b',"opaque":[{"n":'+token+b'}]}')
            with self.subTest(actual=token), self.assertRaisesRegex(r.ReleaseError, 'DOMAIN_UNSAFE_INTEGER|NONFINITE_JSON'):
                r.pm2_raw_binding(raw, case.model)

    def test_lone_surrogates_refused_no_replacement_decode_policy_unchanged(self):
        for string in ('\ud800', '\udfff'):
            for is_key in (False, True):
                bad = {string: 'x'} if is_key else {'x': string}
                wire = json.dumps(bad, ensure_ascii=True).encode('ascii')
                decoded = r.decode(wire); before = copy.deepcopy(decoded)
                self.assertEqual(decoded, bad)  # original decoder still accepts JS UTF-16 data
                with self.assertRaisesRegex(r.ReleaseError, 'PM2_JSON_DOMAIN_UTF8_OR_DEPTH'):
                    r.pm2_json_domain(decoded)
                self.assertEqual(decoded, before)
                case = self.fixture(); model = copy.deepcopy(case.model); model['pm2_env']['opaque'] = bad
                with self.assertRaisesRegex(r.ReleaseError, 'PM2_JSON_DOMAIN_UTF8_OR_DEPTH'):
                    r.pm2_raw_binding(case.raw, model)
                data = r.raw_values(case.raw)[b'pm2_env']
                raw = case.raw.replace(data, data[:-1]+b',"opaque":'+wire+b'}')
                with self.assertRaisesRegex(r.ReleaseError, 'PM2_JSON_DOMAIN_UTF8_OR_DEPTH'):
                    r.pm2_raw_binding(raw, case.model)
        with self.assertRaises(r.ReleaseError): r.pm2_raw_binding(b'pm2_env={"env":{},"x":"\xff"}\0', self.fixture().model)

    def test_cycles_and_shared_python_containers_not_json_trees(self):
        cycle = {}; cycle['self'] = cycle
        shared = {'x': [1]}
        for value in (cycle, {'a': shared, 'b': shared}):
            with self.assertRaisesRegex(r.ReleaseError, 'PM2_JSON_DOMAIN_TREE_REQUIRED'):
                r.pm2_json_domain(value)
        self.assertIs(cycle['self'], cycle)


class R4PublishGateTests(unittest.TestCase):
    def fixture(self, mode):
        case = SafetyTests('test_new_identity_and_fixed_boundary'); case.setUp(); self.addCleanup(case.doCleanups)
        # Production six IDs, but all paths/process bytes remain purely synthetic.
        ids = [190, 191, 192, 193, 194, 200]
        for index, slot in enumerate(ids):
            row = case.raw_rows[index]; row['pm_id'] = slot; row['pm2_env']['pm_id'] = slot
            path = case.cfg.proc / str(row['pid']) / 'environ'; raw = path.read_bytes()
            data = r.raw_values(raw)[b'pm2_env']; value = r.decode(data); value['pm_id'] = slot
            path.write_bytes(raw.replace(data, json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()))
            if mode == 'allfalse' or (mode == 'mixed' and index >= 4):
                row['pm2_env']['version'] = 'diagnostic-monitor-added'
        case.make_synthetic_package()
        return case, ids

    def full_tree(self, case):
        out = {}
        for path in [case.root, *sorted(case.root.rglob('*'))]:
            out[str(path)] = (r.describe(path), path.read_bytes() if path.is_file() and not path.is_symlink() else None)
        return out

    def reject_entry(self, mode, method):
        case, ids = self.fixture(mode); c = case.controller
        own = [row for row in case.cap['processes'] if row['id'] in ids]
        self.assertEqual([row['pm2ReloadReady'] for row in own], [False]*6 if mode == 'allfalse' else [True]*4+[False]*2)
        self.assertEqual(r.identity(case.cfg, case.cap['processes']), ids)
        before = self.full_tree(case)
        with patch.object(r, 'exclusive', wraps=r.exclusive) as create, \
             patch.object(r, 'cas', wraps=r.cas) as cas, \
             patch.object(c, 'change_coord', wraps=c.change_coord) as window, \
             patch.object(c, 'add_asset', wraps=c.add_asset) as asset, \
             patch.object(c, 'change_file', wraps=c.change_file) as api, \
             patch.object(c, 'checkpoint', wraps=c.checkpoint) as intent, \
             patch.object(c, 'reload_adapter', wraps=c.reload_adapter) as adapter, \
             patch.object(r, 'rpc', side_effect=AssertionError('NO_RPC_FOR_KNOWN_FALSE')) as rpc, \
             self.assertRaisesRegex(r.ReleaseError, '^PM2_SIX_OWN_NOT_ALL_READY_NO_ATTEMPT_NO_PUBLISH$'):
            getattr(c, method)(case.cfg.package, case.ms, case.rs)
        self.assertEqual([x.call_count for x in (create, cas, window, asset, api, intent, adapter, rpc)], [0]*8)
        self.assertFalse(case.cfg.receipt.exists()); self.assertEqual(case.reload_calls, [])
        self.assertEqual(c.sequence, 0); self.assertIsNone(c.st); self.assertIsNone(c.state_hash)
        self.assertEqual(self.full_tree(case), before)

    def test_allfalse_preflight_zero_attempt_receipt_window_assets_api_intent_rpc_fullbefore(self):
        self.reject_entry('allfalse', 'preflight')

    def test_allfalse_apply_zero_attempt_receipt_window_assets_api_intent_rpc_fullbefore(self):
        self.reject_entry('allfalse', 'apply')

    def test_mixed_fronttrue_adminfalse_preflight_zero_writes_fullbefore(self):
        self.reject_entry('mixed', 'preflight')

    def test_mixed_fronttrue_adminfalse_apply_zero_writes_fullbefore(self):
        self.reject_entry('mixed', 'apply')

    def test_capture_snapshot_diagnostic_false_still_returns_identity_accepts(self):
        case, ids = self.fixture('allfalse')
        # Exercise unchanged capture method with no CLI, real RPC, production or output capture file.
        before = self.full_tree(case)
        with patch.object(r, 'exclusive', side_effect=AssertionError('NO_CAPTURE_FILE')), \
             patch.object(r, 'cas', side_effect=AssertionError('NO_CAPTURE_WRITE')):
            diagnostic = case.controller.capture()
        self.assertEqual(r.identity(case.cfg, diagnostic['processes']), ids)
        self.assertTrue(all(row['pm2ReloadReady'] is False for row in diagnostic['processes'] if row['id'] in ids))
        self.assertEqual(diagnostic['productionWrites'], 0); self.assertEqual(self.full_tree(case), before)
        self.assertFalse(case.cfg.receipt.exists()); self.assertEqual(case.reload_calls, [])

    def test_allready_own_only_unowned_none_accepted_not_approval(self):
        case, ids = self.fixture('alltrue')
        r.pm2_publish_ready(case.cap['processes'], ids)
        self.assertTrue(all(row['pm2ReloadReady'] is None for row in case.cap['processes'] if row['id'] not in ids))
        self.assertEqual(case.preflight()['reloadScope'], ids)
        self.assertFalse(case.cfg.receipt.exists()); self.assertEqual(case.reload_calls, [])

    def test_ready_requires_literal_true_and_exact_six_only(self):
        case, ids = self.fixture('alltrue')
        rows = copy.deepcopy(case.cap['processes'])
        for bad in (1, None, 'true', False):
            rows[-6]['pm2ReloadReady'] = bad
            with self.subTest(value=bad), self.assertRaisesRegex(r.ReleaseError, 'NO_ATTEMPT_NO_PUBLISH'):
                r.pm2_publish_ready(rows, ids)
        for bad_ids in (ids[:-1], ids+[ids[0]], ids[:-1]+[6]):
            with self.assertRaisesRegex(r.ReleaseError, 'NO_ATTEMPT_NO_PUBLISH'):
                r.pm2_publish_ready(case.cap['processes'], bad_ids)

    def test_false_diagnostic_baseline_can_still_restore_manually_opened_journal(self):
        case, ids = self.fixture('allfalse'); c = case.prepare_state()
        with r.locked(case.cfg):
            case.open_window(c)
            c.restore_journal(case.cfg.package, case.ms, case.rs, c.attempt_hash, c.state_hash)
            c.guard()
        self.assertEqual(r.identity(case.cfg, c.st['processes']), ids)
        self.assertEqual(case.reload_calls, [])

'''
path.write_text(text.replace(marker, addition + marker))

path = root / 'test_prepare_local.py'
text = path.read_text()
marker = "if __name__ == '__main__':\n    unittest.main()\n"
assert text.count(marker) == 1
addition = '''class R4DomainPrepareTests(LocalTests):
    # New diagnostic test only; do not inherit/re-run all LocalTests.
    pass

'''
# Add methods inside existing class instead of duplicating inherited tests.
addition = '''    def test_r4_domain_old_8dc_capture_pin_not_reusable(self):
        self.cap['controllerSha256'] = '8dc23eb3865e65bfc0a60d8b20f3548dc1a087cf533478ad89cdae88c86766f0'
        self.save_capture()
        with self.assertRaisesRegex(P.PrepareError, 'fixed production capture binding'):
            P.inputs(self.args, R)
        self.assertEqual(self.calls, []); self.assertFalse(self.out.exists())

    def test_r4_domain_false_readiness_diagnostic_inputs_not_publication_approval(self):
        for row in self.cap['processes'][:6]: row['pm2ReloadReady'] = False
        self.save_capture()
        result = P.inputs(self.args, R)
        self.assertTrue(all(row['pm2ReloadReady'] is False for row in result[3]['processes'][:6]))
        self.assertEqual(self.calls, []); self.assertFalse(self.out.exists())

'''
path.write_text(text.replace(marker, addition + marker))
