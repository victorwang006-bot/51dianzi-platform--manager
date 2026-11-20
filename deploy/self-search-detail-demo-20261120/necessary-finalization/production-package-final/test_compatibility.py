"""Local packaging contract checks only; never production capture or approval."""
import copy
import unittest
from pathlib import Path
import pack

class Compatibility(unittest.TestCase):
    def test_actual_frozen_importmap_migration(self):
        m=pack.input_data()
        before=pack.ctl.html_refs(pack.read(m['baseline']['html']['local']))[0]
        after=pack.ctl.html_refs(pack.read(pack.ENGINEERING/'index.html'))[0]
        changes=pack.import_changes(before,after)
        self.assertEqual(pack.ctl.apply_importmap_changes(before,changes),after)
        self.assertEqual(sum('scope' in row for row in changes),1)
    def mapping(self):
        return {'imports':{'/assets/main.js':'/assets/old.js'},'scopes':{'/assets/old.js':{'x':'/assets/x.js'}}}
    def test_wrong_scope_before_rejected(self):
        with self.assertRaises(pack.h.ReleaseError):
            pack.ctl.apply_importmap_changes(self.mapping(),[{'scope':'scopes','before':{},'after':None}])
    def test_duplicate_scope_snapshot_rejected(self):
        m=self.mapping();row={'scope':'scopes','before':m['scopes'],'after':None}
        with self.assertRaises(pack.h.ReleaseError):pack.ctl.apply_importmap_changes(m,[row,row])
    def test_external_scope_target_rejected(self):
        m=self.mapping()
        with self.assertRaises(pack.h.ReleaseError):
            pack.ctl.apply_importmap_changes(m,[{'scope':'scopes','before':m['scopes'],'after':{'/assets/n.js':{'x':'https://example.invalid/a.js'}}}])
    def test_legacy_imports_change_kept(self):
        m=self.mapping();result=pack.ctl.apply_importmap_changes(m,[{'key':'/assets/main.js','before':'/assets/old.js','after':'/assets/new.js'}])
        self.assertEqual(result['scopes'],m['scopes']);self.assertEqual(result['imports']['/assets/main.js'],'/assets/new.js')
    def fixture(self):
        url='/assets/shared.js';body=b'fixture shared module'
        cache={url:(body,'anonymous-fixture-not-production')}
        deps=[dict(url=url,sha256=pack.h.H(body),size=len(body))]
        graph=[dict(fromUrl='/assets/new.js',toUrl=url)]
        refs=['/assets/new.js','/assets/old-route.js']
        protected={str(Path(pack.s.FRONT_PUBLIC)/url.lstrip('/')):dict(kind='file',sha256=pack.h.H(body),size=len(body)),
                   str(Path(pack.s.FRONT_PUBLIC)/'assets/old-route.js'):dict(kind='file',sha256=pack.h.H(b'old fixture route'),size=17)}
        return cache,graph,refs,deps,{'/assets/new.js'},protected
    def test_html_only_ref_uses_fresh_full_hash(self):
        result=pack.complete_dependencies(*self.fixture())
        self.assertEqual(len(result),2)
        self.assertEqual(next(row for row in result if row['url']=='/assets/old-route.js')['sha256'],pack.h.H(b'old fixture route'))
    def test_new_code_import_still_requires_reviewed_bytes(self):
        args=list(self.fixture());args[0]={}
        with self.assertRaises(pack.h.ReleaseError):pack.complete_dependencies(*args)
    def test_captured_hash_conflict_rejected(self):
        args=list(self.fixture());args[-1][str(Path(pack.s.FRONT_PUBLIC)/'assets/shared.js')]['sha256']='0'*64
        with self.assertRaises(pack.h.ReleaseError):pack.complete_dependencies(*args)
    def test_missing_html_capture_record_rejected(self):
        args=list(self.fixture());args[-1].pop(str(Path(pack.s.FRONT_PUBLIC)/'assets/old-route.js'))
        with self.assertRaises(pack.h.ReleaseError):pack.complete_dependencies(*args)
    def test_actual_new_code_dependencies_already_have_bytes(self):
        m=pack.input_data();cache,after,imap,refs,graph,deps,sources=pack.material(m,allow_missing=True)
        new={row['url'] for row in m['assets']}
        self.assertFalse({row['toUrl'] for row in graph}-new-set(cache))

if __name__=='__main__':unittest.main(verbosity=2)
