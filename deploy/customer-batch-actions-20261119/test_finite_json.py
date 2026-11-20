#!/usr/bin/env python3
"""Pure JSON/token tests; no file fixtures, network, CLI, DB, capture or reload."""
import importlib.util
import math
from pathlib import Path
import sys
import unittest

spec = importlib.util.spec_from_file_location('customer_finite_json_test_release', Path(__file__).with_name('release.py'))
r = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = r
spec.loader.exec_module(r)


class FiniteJsonTests(unittest.TestCase):
    def reject(self, data):
        with self.assertRaisesRegex(r.ReleaseError, '^NONFINITE_JSON$'):
            r.decode(data)

    def test_positive_and_negative_overflow_at_root(self):
        for raw in (b'1e400', b'-1e400', b'1E309', b'-9.99e9999'):
            with self.subTest(raw=raw):
                self.reject(raw)

    def test_overflow_rejected_at_every_nested_shape(self):
        for raw in (b'{"opaque":{"n":1e400}}', b'{"opaque":[-1e400]}',
                    b'{"env":{"app":{"nested":[1e400]}}}', b'[{},[[-1e400]]]'):
            with self.subTest(raw=raw):
                self.reject(raw)
                with self.assertRaisesRegex(r.ReleaseError, '^NONFINITE_JSON$'):
                    r.pm2_top_tokens(raw)

    def test_literal_nonfinite_contract_unchanged(self):
        for raw in (b'NaN', b'Infinity', b'-Infinity', b'{"x":[NaN]}'):
            with self.subTest(raw=raw):
                self.reject(raw)

    def test_finite_decimals_and_exponents_accepted_without_reencoding(self):
        raw = b' { "opaque" : {"n":1e308,"small":-1.25E-9,"tiny":1e-400,"neg":-0.5} } '
        obj, text, spans = r.pm2_top_tokens(raw)
        self.assertTrue(math.isfinite(obj['opaque']['n']))
        self.assertTrue(math.isfinite(obj['opaque']['small']))
        self.assertEqual(obj['opaque']['tiny'], 0.0)
        self.assertEqual(text.encode('utf8'), raw)
        self.assertEqual(r.pm2_project(raw), raw)
        self.assertEqual(text[slice(*spans['opaque'])], '{"n":1e308,"small":-1.25E-9,"tiny":1e-400,"neg":-0.5}')

    def test_opaque_strings_and_escaped_bytes_remain_exact(self):
        raw = b'{"env":{"app":"1e400","escaped":"\\u0031e400"},"opaque":["NaN","Infinity","-Infinity"]}'
        obj = r.decode(raw)
        self.assertEqual(obj['env']['app'], '1e400')
        self.assertEqual(r.pm2_project(raw), raw)

    def test_duplicate_keys_still_rejected_before_any_projection(self):
        with self.assertRaisesRegex(r.ReleaseError, 'DUPLICATE_JSON_KEY'):
            r.pm2_project(b'{"env":{"a":1,"a":2}}')


if __name__ == '__main__':
    sys.dont_write_bytecode = True
    unittest.main()
