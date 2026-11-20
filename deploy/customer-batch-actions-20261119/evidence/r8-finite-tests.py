#!/usr/bin/env python3
"""Six finite-JSON decoder revalidation methods within the R8 allowed scope.
Does not read the separate historical test_finite_json.py file. Baseline/current
decode source and AST are independently audited unchanged in r8-ast-diff.json.
"""
import importlib.util
import math
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
MODELS = []
for label, path in [('baseline_a555', ROOT/'evidence/r8-baseline-a555/release.py'),
                    ('current_r8', ROOT/'release.py')]:
    spec = importlib.util.spec_from_file_location('r8_finite_' + label, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    MODELS.append((label, module))

class FiniteTests(unittest.TestCase):
    def reject(self, values, error):
        for label, module in MODELS:
            for value in values:
                with self.subTest(model=label, value=value), self.assertRaisesRegex(module.ReleaseError, error):
                    module.decode(value)

    def test_positive_exponent_overflow_rejected(self):
        self.reject([b'1e400', b'{"value":1e400}', b'[1e400]'], 'NONFINITE_JSON')

    def test_negative_exponent_overflow_rejected(self):
        self.reject([b'-1e400', b'{"value":-1e400}', b'[-1e400]'], 'NONFINITE_JSON')

    def test_nonfinite_json_constants_rejected(self):
        self.reject([b'NaN', b'Infinity', b'-Infinity', b'{"v":[NaN]}'], 'NONFINITE_JSON')

    def test_nested_overflow_and_duplicate_keys_rejected(self):
        self.reject([b'{"v":{"w":[1e400]}}', b'{"v":[{"w":-1e400}]}'], 'NONFINITE_JSON')
        self.reject([b'{"x":1,"x":2}', b'{"v":{"x":1,"x":2}}'], 'DUPLICATE_JSON_KEY')

    def test_finite_extremes_underflow_and_integers_preserved(self):
        for label, module in MODELS:
            values = module.decode(b'[1e308,-1e308,1e-400,-1e-400,0,9007199254740991]')
            with self.subTest(model=label):
                self.assertTrue(all(math.isfinite(x) for x in values))
                self.assertEqual(values, [1e308, -1e308, 0.0, -0.0, 0, 9007199254740991])
                self.assertIs(type(values[-1]), int)

    def test_opaque_strings_and_finite_unicode_roundtrip_preserved(self):
        for label, module in MODELS:
            original = {'opaque': '1e400 NaN Infinity', 'unicode': '客户', 'number': 1.25,
                        'nested': [False, None, {'value': 'unknown'}]}
            with self.subTest(model=label):
                self.assertEqual(module.decode(module.encode(original)), original)

if __name__ == '__main__':
    unittest.main()
