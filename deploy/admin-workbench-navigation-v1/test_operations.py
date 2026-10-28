import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('nav_operations', ROOT / 'operations.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class ChangeBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = json.loads((ROOT / 'dist/manifest.json').read_text())
        cls.before = (ROOT / 'baseline/index.html').read_bytes()

    def test_only_layout_pointer_and_style_added(self):
        after = ops.prepare_html(self.before, self.m)
        self.assertEqual(after, (ROOT / 'dist/index.html').read_bytes())
        self.assertEqual(after.decode().replace(self.m['cssTag'] + '\n', '').replace(self.m['layout'], self.m['oldTarget']), self.before.decode())

    def test_drifted_html_refused(self):
        with self.assertRaises(AssertionError):
            ops.prepare_html(self.before + b'\n', self.m)

    def test_unknown_original_layout_refused(self):
        m = {**self.m, 'oldTarget': '/assets/unapproved-layout.js'}
        with self.assertRaises(AssertionError):
            ops.prepare_html(self.before, m)

    def test_exact_current_files_and_processes_only(self):
        b = {'files': {str(ops.HTML): self.m['oldHtmlSha256'], '/original.js': 'fixed'}, 'services': [{'id': 1, 'pid': 2}], 'roots': ['/root'], 'links': {}, 'workerPermit': {'sha256': 'permit'}}
        current = copy.deepcopy(b)
        ops.verify_original(b, current, self.m, False)
        current['files'][str(ops.HTML)] = self.m['newHtmlSha256']
        current['files'].update({str(ops.ASSETS / f['name']): f['sha256'] for f in self.m['files']})
        ops.verify_original(b, current, self.m, True)
        for field, change in [('files', {'/unexpected.js': 'unknown'}), ('links', {'/new-link': '/elsewhere'}), ('workerPermit', {'sha256': 'changed'})]:
            bad = copy.deepcopy(current)
            bad[field].update(change)
            with self.assertRaises(AssertionError):
                ops.verify_original(b, bad, self.m, True)
        current['services'][0]['pid'] = 3
        with self.assertRaises(AssertionError):
            ops.verify_original(b, current, self.m, True)

    def test_atomic_compare_and_swap_does_not_overwrite_unknown_content(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'index.html'
            target.write_bytes(b'current')
            with self.assertRaises(AssertionError):
                ops.atomic(target, b'candidate', expected=ops.digest(b'old'))
            self.assertEqual(target.read_bytes(), b'current')
            ops.atomic(target, b'candidate', expected=ops.digest(b'current'))
            self.assertEqual(target.read_bytes(), b'candidate')

    def test_manifest_replacement_after_preflight_refused(self):
        raw = json.dumps(self.m).encode()
        fixed = ops.digest(raw)
        ops.validate_manifest_binding(raw, fixed)
        replacement = copy.deepcopy(self.m)
        replacement['files'][0]['sha256'] = 'f' * 64
        with self.assertRaises(AssertionError):
            ops.validate_manifest_binding(json.dumps(replacement).encode(), fixed)

    def test_root_link_change_detected_even_with_identical_files(self):
        spec = importlib.util.spec_from_file_location('nav_capture', ROOT / 'capture-protection.py')
        capture = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(capture)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ['release-a', 'release-b']:
                (root / name).mkdir()
                (root / name / 'same.js').write_text('same')
            link = root / 'current'
            link.symlink_to(root / 'release-a', target_is_directory=True)
            before = {}
            capture.record_root_links(link, before)
            self.assertIn(str(link), before)
            link.unlink()
            link.symlink_to(root / 'release-b', target_is_directory=True)
            after = {}
            capture.record_root_links(link, after)
            self.assertNotEqual(before, after)


if __name__ == '__main__':
    unittest.main()
