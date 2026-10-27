from pathlib import Path
import json
import unittest
from transform import restore_html, retire_nginx, MAP

BASE = Path(__file__).parent / 'baseline'


class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.current = (BASE / 'current-index.html').read_text()
        self.original = (BASE / 'pre-zhijie-index.html').read_text()
        self.manifest = json.loads((BASE / 'introduced-manifest.json').read_text())
        self.nginx = (BASE / 'current-nginx.conf').read_text()

    def test_restore_known_entries_and_original_routes(self):
        result, proof = restore_html(self.current, self.original, self.manifest)
        mappings = json.loads(MAP.search(result).group(2))['imports']
        old = json.loads(MAP.search(self.original).group(2))['imports']
        self.assertEqual(mappings[self.manifest['layoutOriginal']], old[self.manifest['layoutOriginal']])
        self.assertNotIn(self.manifest['mainOriginal'], mappings)
        self.assertIn('src="' + self.manifest['mainOriginal'] + '"', result)
        self.assertNotIn('ZhijieBusiness-', result)
        for key, value in proof['unrelatedImportMappingsPreserved'].items():
            self.assertEqual(mappings[key], value)

    def test_preserve_new_unrelated_map_and_html(self):
        changed = self.current.replace('"imports":{', '"imports":{"/assets/new-user.js":"/assets/new-user-v9.js",')
        changed = changed.replace('</head>', '<meta name="new-other-task" content="keep" /></head>')
        result, _ = restore_html(changed, self.original, self.manifest)
        self.assertIn('"/assets/new-user.js":"/assets/new-user-v9.js"', result)
        self.assertIn('<meta name="new-other-task" content="keep" />', result)
        self.assertIn('AdminPageMemory-core-', result)
        self.assertIn('manus-runtime', result)

    def test_reject_changed_zhijie_pointer(self):
        changed = self.current.replace('Admin-main-zhijie-', 'Admin-main-unrelated-')
        with self.assertRaises(AssertionError):
            restore_html(changed, self.original, self.manifest)

    def test_deny_old_pages_and_api_without_changing_other_rules(self):
        changed = self.nginx + '\n# unrelated subsequent rule retained\n'
        result = retire_nginx(changed)
        self.assertIn('location = /zhijie { return 404; }', result)
        self.assertIn('location ^~ /zhijie/ { return 404; }', result)
        self.assertIn('location ^~ /api/zhijie/ { return 404; }', result)
        self.assertIn('# unrelated subsequent rule retained', result)
        self.assertNotIn('proxy_pass http://127.0.0.1:3019;', result)
        self.assertIn('location ^~ /api/ {', result)

    def test_no_second_apply(self):
        result, _ = restore_html(self.current, self.original, self.manifest)
        with self.assertRaises((AssertionError, KeyError)):
            restore_html(result, self.original, self.manifest)
        with self.assertRaises(AssertionError):
            retire_nginx(retire_nginx(self.nginx))


if __name__ == '__main__':
    unittest.main()
