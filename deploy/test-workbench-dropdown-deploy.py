#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import tempfile
import unittest
spec = importlib.util.spec_from_file_location('nav_deploy', Path(__file__).with_name('deploy-workbench-dropdown.py'))
nav = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nav)
class ServingRootProtection(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.admin = self.base/'admin-public'
        self.front_a = self.base/'front-public-a'
        self.front_b = self.base/'front-public-b'
        for p in [self.admin, self.front_a, self.front_b]:
            p.mkdir(); (p/'index.html').write_text('same-page-content\n')
        self.rows = []
        for number, name, target in [(190,'dianzi51',self.front_a),(191,'dianzi51-admin',self.admin)]:
            dist = self.base/name/'dist'; dist.mkdir(parents=True)
            (dist/'index.js').write_text('synthetic-backend\n')
            (dist/'public').symlink_to(target,target_is_directory=True)
            self.rows.append({'id':number,'name':name,'script':str(dist/'index.js')})
        self.previous = nav.HTML
        nav.HTML = self.admin/'index.html'
        self.front_link = self.base/'dianzi51/dist/public'
    def tearDown(self):
        nav.HTML = self.previous
        self.tmp.cleanup()
    def point_front(self,path):
        self.front_link.unlink();self.front_link.symlink_to(path,target_is_directory=True)
    def test_service_mapping_detects_same_hash_different_target(self):
        before=nav.serving_roots(self.rows)
        self.point_front(self.front_b)
        self.assertNotEqual(before,nav.serving_roots(self.rows))
        self.assertEqual(nav.sha(self.front_a/'index.html'),nav.sha(self.front_b/'index.html'))
    def test_front_can_never_be_hidden_as_admin_html(self):
        self.point_front(self.admin)
        with self.assertRaisesRegex(nav.Stop,'front must never serve admin HTML'):
            nav.serving_roots(self.rows)
    def test_missing_actual_static_target_is_not_silently_skipped(self):
        self.point_front(self.base/'missing')
        with self.assertRaises(FileNotFoundError):nav.serving_roots(self.rows)
if __name__=='__main__':unittest.main()
