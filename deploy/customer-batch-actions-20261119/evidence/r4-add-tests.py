from pathlib import Path
import hashlib
base = Path('/home/ubuntu/51-manager/deploy/customer-batch-actions-20261119')
p = base / 'test_release.py'
s = p.read_text().replace('/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R3', '/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R4')
s = s.replace("Path('/opt/config/dianzi51/runtime.env'),Path('/var/lib/dianzi51-private')))", "Path('/opt/config/dianzi51/runtime.env'),Path('/var/lib/dianzi51-private'),\n            r.EXTERNAL_OPS,r.EXTERNAL_CWD))")
s = s.replace("data = (measured/name).read_bytes(); self.assertEqual(r.H(data), digest)", "source = (Path('/home/ubuntu/work/customer-batch/fclone-resolved-once/fclone.js')\n                      if name == 'modules/fclone.js' else measured/name)\n            data = source.read_bytes(); self.assertEqual(r.H(data), digest)")
tests = r'''

def r4_stat(pid, ppid, ticks, name):
    fields = ['S', str(ppid), *(['0'] * 17), str(ticks), '0']
    return str(pid).encode() + b' (' + name.encode() + b') ' + ' '.join(fields).encode() + b'\n'

def r4_external_fixture(root, cfg):
    """Fake proc links/files only in a unique caller-owned TemporaryDirectory."""
    ops = root/'external-ops'; cwd = root/'external-child-cwd'; parentcwd = root/'external-parent-cwd'
    script = ops/'releases/20261112-forum12-1255b7b84aa3adac09cb8c05/worker-runtime-bootstrap.mjs'
    script.parent.mkdir(parents=True); script.write_bytes(b'// synthetic bootstrap, never imported\n')
    cwd.mkdir(); parentcwd.mkdir(); (cwd/'empty').mkdir()
    (cwd/'dep.txt').write_bytes(b'synthetic full protected dependency')
    (ops/'empty').mkdir(); (ops/'retained.data').write_bytes(b'synthetic retained Ops file')
    binary = root/'external-bin'; binary.mkdir()
    flock = binary/'flock'; node = binary/'node-22'
    flock.write_bytes(b'synthetic flock, never executed'); node.write_bytes(cfg.node.read_bytes())
    for pid, ppid, ticks, exe, work in [(2060125, 1234, 51001, flock, parentcwd),
                                       (2060126, 2060125, 51002, node, cwd)]:
        proc = cfg.proc/str(pid); proc.mkdir(parents=True)
        (proc/'stat').write_bytes(r4_stat(pid,ppid,ticks,exe.name))
        (proc/'exe').symlink_to(exe); (proc/'cwd').symlink_to(work, target_is_directory=True)
        (proc/'status').write_bytes(b'Uid:\t1000 1000 1000 1000\nGid:\t1000 1000 1000 1000\nGroups:\t1000\nUmask:\t0022\n')
        cmd = os.fsencode(exe) + b'\0'
        if pid == 2060126: cmd += os.fsencode(script) + b'\0'
        else: cmd += b'-n\0SYNTHETIC-opaque-parent-arg\0'
        (proc/'cmdline').write_bytes(cmd)
        (proc/'environ').write_bytes(b'PRIVATE_SENTINEL_DO_NOT_EXPORT=synthetic-secret\0NODE_UNIQUE_ID=17\0pm_uptime=opaque-app\0')
    cfg = replace(cfg, extra_protected=(*cfg.extra_protected,ops,cwd))
    return cfg, dict(ops=ops,cwd=cwd,script=script)

class R4ExternalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='r4-external-only-')
        self.addCleanup(self.tmp.cleanup); self.root = Path(self.tmp.name)
        node = self.root/'node-22'; node.write_bytes(b'synthetic node binary')
        self.cfg,self.fixture = r4_external_fixture(self.root,r.Config(proc=self.root/'proc',node=node,
                                                           extra_protected=(),mock=True))
        for obj,name in [(r.subprocess,'run'),(r.os,'kill'),(r.socket,'socket'),(r.fcntl,'flock')]:
            guard=patch.object(obj,name,side_effect=AssertionError('PURE_READONLY_EXTERNAL_REQUIRED'))
            guard.start(); self.addCleanup(guard.stop)

    def collect(self):
        return r.external_protection(self.cfg,self.fixture)

    def mutate_second(self, change, error='EXTERNAL_TWO_SAMPLE_DRIFT'):
        real=r.external_protection_sample; count=[]
        def sample(*args):
            count.append(1)
            if len(count)==2:change()
            return real(*args)
        with patch.object(r,'external_protection_sample',side_effect=sample),self.assertRaisesRegex(r.ReleaseError,error):
            self.collect()
        self.assertEqual(len(count),2)

    def test_fixed_two_nonpm2_identities_whole_opaque_hashes_and_full_file_meta(self):
        real=r.external_protection_sample
        with patch.object(r,'external_protection_sample',wraps=real) as samples:
            result=self.collect()
        self.assertEqual(samples.call_count,2)
        parent,child=result['processes']
        self.assertEqual((parent['pid'],child['pid'],child['ppid']),(2060125,2060126,2060125))
        self.assertEqual((parent['exeName'],child['exeName']),('flock','node-22'))
        self.assertEqual((parent['startTicks'],child['startTicks']),(51001,51002))
        self.assertEqual(child['knownScript'],str(self.fixture['script']))
        self.assertEqual(child['cwd'],str(self.fixture['cwd']))
        for row in (parent,child):
            proc=self.cfg.proc/str(row['pid'])
            self.assertEqual(row['rawSha256'],r.H((proc/'environ').read_bytes()))
            self.assertEqual(row['cmdlineSha256'],r.H((proc/'cmdline').read_bytes()))
            self.assertEqual(row['permissionsSha256'],r.permissions(self.cfg,row['pid']))
            self.assertEqual(result['fullSourceMeta'][row['exe']],r.describe(row['exe']))
        self.assertEqual(result['fullSourceMeta'][str(self.fixture['script'])],r.describe(self.fixture['script']))
        self.assertEqual(result['sources'][child['exe']],result['sources'][str(self.cfg.node)])
        self.assertNotIn(b'PRIVATE_SENTINEL',r.encode(result))
        self.assertNotIn(b'synthetic-secret',r.encode(result))
        self.assertNotIn(b'SYNTHETIC-opaque-parent-arg',r.encode(result))
        self.assertTrue(result['fixtureOnly'])

    def test_fixture_only_skip_is_explicit_never_a_production_override(self):
        with patch.object(Path,'read_bytes',side_effect=AssertionError('NO_PROC_READ_FOR_FIXTURE_SKIP')):
            empty=r.external_protection(self.cfg)
            self.assertEqual(empty,dict(fixtureOnly=True,processes=[],sources={},fullSourceMeta={},rootMeta={}))
            with self.assertRaisesRegex(r.ReleaseError,'NO_PRODUCTION_OVERRIDE'):
                r.external_protection(replace(self.cfg,mock=False),self.fixture)
            with self.assertRaisesRegex(r.ReleaseError,'FIXED_PRODUCTION_PROC'):
                r.external_protection(replace(self.cfg,mock=False))

    def test_parent_is_flock_not_another_node(self):
        link=self.cfg.proc/'2060125/exe'; link.unlink(); link.symlink_to(self.root/'external-bin/node-22')
        with self.assertRaisesRegex(r.ReleaseError,'ACTUAL_EXE_NAME'):self.collect()

    def test_wrong_child_exe_and_argv0_fail_closed(self):
        path=self.cfg.proc/'2060126/cmdline'; path.write_bytes(b'other-node\0'+os.fsencode(self.fixture['script'])+b'\0')
        with self.assertRaisesRegex(r.ReleaseError,'CMDLINE_EXE_BINDING'):self.collect()

    def test_wrong_ppid_and_parent_cycle_are_rejected(self):
        for pid,ppid,name in [(2060126,1234,'node-22'),(2060125,2060126,'flock'),(2060125,2060125,'flock')]:
            path=self.cfg.proc/str(pid)/'stat'; old=path.read_bytes()
            path.write_bytes(r4_stat(pid,ppid,51001 if pid==2060125 else 51002,name))
            with self.subTest(pid=pid,ppid=ppid),self.assertRaisesRegex(r.ReleaseError,'EXACT_PARENT_CHILD'):self.collect()
            path.write_bytes(old)

    def test_missing_either_proc_has_no_pid_search_or_fallback(self):
        for pid in (2060125,2060126):
            path=self.cfg.proc/str(pid)/'stat'; old=path.read_bytes(); path.unlink()
            with self.subTest(pid=pid),self.assertRaises(FileNotFoundError):self.collect()
            path.write_bytes(old)

    def test_pid_reuse_startticks_between_complete_samples_is_rejected(self):
        self.mutate_second(lambda:(self.cfg.proc/'2060126/stat').write_bytes(r4_stat(2060126,2060125,999999,'node-22')))

    def test_pid_reuse_inside_single_proc_sample_is_rejected(self):
        real=Path.read_bytes; seen=[]; target=self.cfg.proc/'2060125/stat'
        def read(path):
            if path==target:
                seen.append(1)
                if len(seen)==2:target.write_bytes(r4_stat(2060125,1234,999999,'flock'))
            return real(path)
        with patch.object(Path,'read_bytes',read),self.assertRaisesRegex(r.ReleaseError,'IDENTITY_READ_RACE'):self.collect()

    def test_invalid_stat_identity_or_dead_pid_is_rejected(self):
        path=self.cfg.proc/'2060126/stat'
        good=r4_stat(2060126,2060125,51002,'node-22')
        for raw in (r4_stat(42,2060125,51002,'node-22'),r4_stat(2060126,2060125,0,'node-22'),
                    good.replace(b') S ',b') Z '),b'incomplete'):
            path.write_bytes(raw)
            with self.subTest(case=r.H(raw)),self.assertRaisesRegex(r.ReleaseError,'PROC_STAT_IDENTITY'):self.collect()

    def test_parent_cmdline_drift_is_opaque_no_normalization(self):
        path=self.cfg.proc/'2060125/cmdline'
        self.mutate_second(lambda:path.write_bytes(path.read_bytes().replace(b'parent-arg',b'parent-drift')))

    def test_whole_environment_drift_has_no_nodeunique_or_pm2_exception(self):
        path=self.cfg.proc/'2060126/environ'
        self.mutate_second(lambda:path.write_bytes(path.read_bytes().replace(b'NODE_UNIQUE_ID=17',b'NODE_UNIQUE_ID=19')))

    def test_permissions_drift_between_samples_is_rejected(self):
        path=self.cfg.proc/'2060125/status'
        self.mutate_second(lambda:path.write_bytes(path.read_bytes().replace(b'0022',b'0077')))

    def test_exact_script_and_no_unknown_child_loader_flags(self):
        path=self.cfg.proc/'2060126/cmdline'; node=os.fsencode(self.root/'external-bin/node-22')
        for args in (b'/unknown-bootstrap.mjs\0',b'--require\0/unknown-loader.js\0'+os.fsencode(self.fixture['script'])+b'\0',
                     os.fsencode(self.fixture['script'])+b'\0extra-arg\0'):
            path.write_bytes(node+b'\0'+args)
            with self.subTest(case=r.H(args)),self.assertRaisesRegex(r.ReleaseError,'EXACT_CHILD_SCRIPT_ARGV'):self.collect()

    def test_child_cwd_exact_not_a_normalized_or_guessed_path(self):
        link=self.cfg.proc/'2060126/cwd'; link.unlink(); link.symlink_to(self.root/'external-parent-cwd')
        with self.assertRaisesRegex(r.ReleaseError,'EXACT_CHILD_CWD'):self.collect()

    def test_node_full_executable_sha_bound_not_name_only(self):
        (self.root/'external-bin/node-22').write_bytes(b'other node binary')
        with self.assertRaisesRegex(r.ReleaseError,'NODE_FULL_SHA_BINDING'):self.collect()

    def test_actual_flock_path_is_kernel_observed_and_sticky(self):
        other=self.root/'other-bin'; other.mkdir(); exe=other/'flock'
        exe.write_bytes((self.root/'external-bin/flock').read_bytes())
        link=self.cfg.proc/'2060125/exe'
        def change():link.unlink(); link.symlink_to(exe)
        self.mutate_second(change)

    def test_source_script_full_bytes_drift_is_rejected(self):
        path=self.fixture['script']; self.mutate_second(lambda:path.write_bytes(path.read_bytes()+b'// drift\n'))

    def test_executable_source_full_meta_drift_even_same_hash_is_rejected(self):
        path=self.root/'external-bin/flock'; self.mutate_second(lambda:path.chmod(0o600))

    def test_script_full_meta_drift_even_same_hash_is_rejected(self):
        self.mutate_second(lambda:self.fixture['script'].chmod(0o600))

    def test_proc_directory_meta_drift_is_rejected(self):
        self.mutate_second(lambda:(self.cfg.proc/'2060125').chmod(0o700))

    def test_root_meta_drift_is_rejected(self):
        self.mutate_second(lambda:self.fixture['ops'].chmod(0o700))

    def test_parent_cwd_is_shallow_unknown_not_recursive_root_protection(self):
        parentcwd=self.root/'external-parent-cwd'; os.mkfifo(parentcwd/'not-enumerated-fifo')
        first=self.collect(); self.assertEqual(first['processes'][0]['cwdMeta'],r.describe(parentcwd))
        self.assertNotIn(str(parentcwd),first['rootMeta'])
        self.mutate_second(lambda:parentcwd.chmod(0o700))

    def test_deleted_actual_exe_and_unsupported_source_links_fail_closed(self):
        link=self.cfg.proc/'2060125/exe'; link.unlink(); link.symlink_to(str(self.root/'external-bin/flock')+' (deleted)')
        with self.assertRaisesRegex(r.ReleaseError,'DELETED_OR_NONCANONICAL'):self.collect()
        link.unlink(); link.symlink_to(self.root/'external-bin/flock')
        alias=self.root/'alias-flock'; alias.symlink_to(self.root/'external-bin/flock')
        link.unlink(); link.symlink_to(alias)
        with self.assertRaisesRegex(r.ReleaseError,'SYMLINK_ESCAPE'):self.collect()

    def test_hardlinked_exe_or_bootstrap_not_widened(self):
        for path in (self.root/'external-bin/flock',self.fixture['script']):
            hard=self.root/'extra-hardlink'; os.link(path,hard)
            with self.subTest(path=path.name),self.assertRaisesRegex(r.ReleaseError,'SINGLE_REGULAR_SOURCE'):self.collect()
            hard.unlink()

    def test_missing_exact_protection_roots_not_replaced_by_ancestor(self):
        for missing in (self.fixture['ops'],self.fixture['cwd']):
            cfg=replace(self.cfg,extra_protected=tuple(p for p in self.cfg.extra_protected if p!=missing)+(self.root,))
            with self.subTest(root=missing.name),self.assertRaisesRegex(r.ReleaseError,'REQUIRED_EXACT_ROOTS'):
                r.external_protection(cfg,self.fixture)

class R4TransportTests(unittest.TestCase):
    setUp=AdapterFilesTests.setUp
    fake_run=AdapterFilesTests.fake_run

    def attach(self):
        self.cfg,fixture=r4_external_fixture(self.root,self.cfg)
        real=r.external_protection
        guard=patch.object(r,'external_protection',side_effect=lambda cfg:real(cfg,fixture))
        guard.start(); self.addCleanup(guard.stop)
        return fixture

    def test_transport_includes_actual_exe_script_sources_and_fullmeta_with_original_pins(self):
        fixture=self.attach(); tr=r.transport(self.cfg); external=tr['externalProtection']
        self.assertEqual(len(external['processes']),2)
        self.assertTrue(external['fixtureOnly'])
        self.assertTrue(set(external['sources'])<=set(tr['sources']))
        for path,digest in external['sources'].items():
            self.assertEqual(tr['sources'][path],digest)
            self.assertEqual(external['fullSourceMeta'][path],r.describe(path))
        self.assertEqual(len(r.PM2_GENERATION_PINS),9)
        self.assertEqual(r.PM2_GENERATION_PINS['modules/fclone.js'],
                         '9b921f33e5d4e36dd030f5d2e736ea2af0c95f4fb795ada696160e2db7fe2fe6')

    def test_external_drift_during_mock_node_probe_rejected_before_transport_returns(self):
        fixture=self.attach()
        self.native_hook=lambda:(self.cfg.proc/'2060125/environ').write_bytes(b'DRIFT=1\0')
        with self.assertRaisesRegex(r.ReleaseError,'EXTERNAL_TRANSPORT_DRIFT'):r.transport(self.cfg)

    def test_fclone_fixed_source_missing_and_drift_are_failclosed(self):
        target=self.cfg.pm2_base/'modules/fclone.js'; target.write_bytes(b'unknown cloning source')
        with self.assertRaisesRegex(r.ReleaseError,'GENERATION_SOURCE_PIN_DRIFT'):r.transport(self.cfg)
        target.unlink()
        with self.assertRaises(FileNotFoundError):r.transport(self.cfg)

class R4ProtectedGraphTests(unittest.TestCase):
    def fixture(self):
        case=SafetyTests('test_new_identity_and_fixed_boundary'); case.setUp(); self.addCleanup(case.doCleanups)
        case.cfg,fixture=r4_external_fixture(case.root,case.cfg); case.controller.cfg=case.cfg
        def tr(cfg):
            external=r.external_protection(cfg,fixture)
            return dict(mockTransport=True,rpcSourceSha256=r.H(r.RPC.encode()),externalProtection=external,
                        sources=external['sources'])
        case.tr=tr(case.cfg); case.controller.transport_reader=tr
        case.make_synthetic_package()
        return case,fixture

    def test_both_complete_extra_trees_files_dirs_emptydirs_and_set_not_only_pm2(self):
        case,fixture=self.fixture(); original=case.cap['protectedFiles']
        for root in (fixture['ops'],fixture['cwd']):
            self.assertTrue({str(p) for p in (root,*root.rglob('*'))}<=set(original))
        self.assertEqual(len(case.cap['processes']),12); self.assertEqual(r.identity(case.cfg,case.cap['processes']),list(range(6)))
        self.assertEqual(len(case.cap['transport']['externalProtection']['processes']),2)
        extra=fixture['cwd']/'new-empty'; extra.mkdir()
        paths,links=r.union(case.cfg,case.original_coord)
        self.assertNotEqual(set(r.inventory(case.cfg,case.cap['processes'],paths,links)),set(original))
        with self.assertRaisesRegex(r.ReleaseError,'FOREIGN_FULLMETA_PROCESS_DRIFT'):
            case.controller.baseline_guard(case.controller.bundle(case.cfg.package,case.ms,case.rs))

    def test_original_controller_guard_binds_external_opaque_identity_without_schema_change(self):
        case,fixture=self.fixture(); c=case.prepare_state()
        (case.cfg.proc/'2060126/environ').write_bytes(b'CHANGED_WHOLE_OPAQUE=1\0')
        with self.assertRaisesRegex(r.ReleaseError,'SOCKET_ADAPTER_SOURCE_DRIFT'):c.guard()
        self.assertEqual(case.reload_calls,[])

    def test_default_exact_roots_no_parentcwd_or_root_recursion(self):
        cfg=r.Config(); self.assertEqual(cfg.extra_protected[-2:],(r.EXTERNAL_OPS,r.EXTERNAL_CWD))
        self.assertNotIn(Path('/root'),cfg.extra_protected); self.assertNotIn(Path('/'),cfg.extra_protected)
        self.assertEqual(r.EXTERNAL_SCRIPT,r.EXTERNAL_OPS/'releases/20261112-forum12-1255b7b84aa3adac09cb8c05/worker-runtime-bootstrap.mjs')
        self.assertEqual(r.SCOPE,'customer-batch-actions-20261120-6Lfttf6o-R4')
'''
s = s.replace("if __name__ == '__main__':\n    unittest.main()", tests + "\nif __name__ == '__main__':\n    unittest.main()")
p.write_text(s)
p = base / 'test_prepare_local.py'
s = p.read_text().replace('customer-batch-actions-20261120-6Lfttf6o-R3', 'customer-batch-actions-20261120-6Lfttf6o-R4')
new = '''    def test_r3_scope_and_bf7_capture_not_reusable_in_r4(self):
        for key,value in [('scope','customer-batch-actions-20261120-6Lfttf6o-R3'),
                          ('controllerSha256','bf7ec85b902ae2474ded779bfad110e7ac791e7d4c244d67ca6f912614d375ab')]:
            old=self.cap[key]; self.cap[key]=value; self.save_capture()
            with self.subTest(key=key),self.assertRaisesRegex(P.PrepareError,'fixed production capture binding'):
                P.prepare(self.args)
            self.cap[key]=old
        self.assertEqual(self.calls,[]); self.assertFalse(self.out.exists())

    def test_r4_both_external_exact_roots_cannot_be_omitted(self):
        for root in (str(R.EXTERNAL_OPS),str(R.EXTERNAL_CWD)):
            self.assertIn(root,self.cap['protectionUnion']['paths'])
            self.cap['protectionUnion']['paths'].remove(root); self.save_capture()
            with self.subTest(root=root),self.assertRaisesRegex(P.PrepareError,'protection union mismatch'):
                P.prepare(self.args)
            self.cap['protectionUnion']['paths'].append(root)
            self.cap['protectionUnion']['paths'].sort()
        self.assertEqual(self.calls,[]); self.assertFalse(self.out.exists())

'''
s = s.replace("if __name__ == '__main__':\n    unittest.main()", new + "if __name__ == '__main__':\n    unittest.main()")
p.write_text(s)
p = base / 'prepare-local.py'
s = p.read_text(); old = next(line for line in s.splitlines() if line.startswith('CONTROLLER_SHA = '))
s = s.replace(old,"CONTROLLER_SHA = '"+hashlib.sha256((base/'release.py').read_bytes()).hexdigest()+"'")
p.write_text(s)
print('R4 tests installed and preparer pin synced')
