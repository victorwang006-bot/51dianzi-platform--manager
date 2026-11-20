#!/usr/bin/env python3
import sys
sys.dont_write_bytecode=True
import base64, contextlib, copy, hashlib, importlib.util, io, json, os, pathlib, stat, subprocess, tempfile, unittest
from unittest.mock import patch
HERE=pathlib.Path(__file__).absolute().parent

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
c=module('collector','collect-runtime.py'); f=module('filler','fill-policy.py')
class ReadonlyTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory(prefix='.unit-',dir=HERE);self.root=pathlib.Path(self.tmp.name)
    def tearDown(self):self.tmp.cleanup()
    def file(self,name='file.js',data=b'const answer=42;'):
        p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);return p
    def test_regular_full_bytes_sha(self):
        p=self.file();b,r=c.Reader().regular(str(p),export=True);self.assertEqual(b,p.read_bytes());self.assertEqual(r['sha256'],hashlib.sha256(b).hexdigest())
    def test_metadata_excludes_atime(self):self.assertNotIn('atimeNs',c.metadata(self.file()))
    def test_noatime_preserved(self):
        p=self.file();os.utime(p,ns=(1000000000,2000000000));a=p.stat().st_atime_ns;c.Reader().regular(p);self.assertEqual(p.stat().st_atime_ns,a)
    def test_wrong_pin_rejected(self):
        with self.assertRaises(c.Reject):c.Reader().regular(self.file(),expected='0'*64)
    def test_repeated_source_drift(self):
        p=self.file();r=c.Reader();r.regular(p);p.write_bytes(b'changed')
        with self.assertRaises(c.Reject):r.regular(p)
    def test_symlink_final_rejected(self):
        p=self.file();l=self.root/'link.js';l.symlink_to(p)
        with self.assertRaises(c.Reject):c.Reader().regular(l)
    def test_symlink_ancestor_rejected(self):
        p=self.file('sub/file.js');l=self.root/'alias';l.symlink_to(p.parent)
        with self.assertRaises(c.Reject):c.Reader().regular(l/'file.js')
    def test_noatime_failure_has_no_fallback(self):
        p=self.file();orig=c.os.open;calls=[]
        def denied(path,flags,*a,**kw):
            calls.append(flags)
            if flags&os.O_NOATIME:raise PermissionError()
            return orig(path,flags,*a,**kw)
        with patch.object(c.os,'open',side_effect=denied):
            with self.assertRaises(PermissionError):c.Reader().regular(p)
        self.assertEqual(len(calls),1)
    def test_file_budget_abort(self):
        with patch.object(c,'MAX_FILE',1):
            with self.assertRaises(c.Reject):c.Reader().regular(self.file())
    def test_total_budget_abort(self):
        with patch.object(c,'MAX_CODE',1):
            with self.assertRaises(c.Reject):c.Reader().regular(self.file())
    def test_code_timeout_abort(self):
        r=c.Reader();r.codeStarted=c.time.monotonic()-41
        with self.assertRaises(c.Reject):r.regular(self.file())
    def test_tree_no_symlink_follow(self):
        p=self.file('source/a.js');outside=self.file('outside');l=p.parent/'link';l.symlink_to(outside);t=c.Reader().tree(str(p.parent));self.assertEqual(t[str(l)]['kind'],'link');self.assertNotIn(str(outside),t)
    def test_tree_namespace_has_every_child(self):
        p=self.file('source/a.js');self.file('source/b.txt');t=c.Reader().tree(str(p.parent));self.assertEqual(t[str(p.parent)]['children'],['a.js','b.txt'])
    def test_shadow_tree_bytes_refused(self):
        with self.assertRaises(c.Reject):c.Reader().tree(c.SHADOW)
    def test_namespace_nofollow_child(self):
        p=self.file();l=self.root/'alias';l.symlink_to(p);n=c.namespace(str(self.root));self.assertEqual(n['children'][str(l)]['link'],str(p))
    def test_namespace_special_socket_not_bytes(self):
        import socket
        s=socket.socket(socket.AF_UNIX);p=self.root/'rpc.sock';s.bind(str(p))
        try:self.assertEqual(c.namespace(str(self.root))['children'][str(p)]['kind'],'socket')
        finally:s.close()
    def test_safe_alias_record(self):
        p=self.file();l=self.root/'alias';l.symlink_to(p);r=c.Reader();actual,aliases=r.resolve_alias(str(l),(str(self.root),));self.assertEqual(actual,str(p));self.assertEqual(aliases,[str(l)])
    def test_alias_outside_roots_rejected(self):
        p=self.file();l=self.root/'alias';l.symlink_to('/etc/passwd')
        with self.assertRaises(c.Reject):c.Reader().resolve_alias(str(l),(str(self.root),))
    def test_home_fields_hash_only_after_sanitize(self):
        x=c.home_fields(b'PASSWORD=never-export\0HOME=/root\0');self.assertTrue(x['HOME']['present']);self.assertFalse(x['PM2_HOME']['present']);self.assertEqual(x['HOME']['sha256'],c.H(b'/root'));self.assertNotIn('PASSWORD',x)
    def test_duplicate_home_rejected(self):
        with self.assertRaises(c.Reject):c.home_fields(b'HOME=/root\0HOME=/tmp\0')
    def test_relative_home_rejected(self):
        with self.assertRaises(c.Reject):c.home_fields(b'HOME=relative\0')
    def test_home_absence_explicit(self):self.assertEqual(c.home_fields(b'OTHER=x\0')['HOME'],{'present':False,'sha256':None,'_memoryPath':None})
    def test_json_duplicate_rejected(self):
        with self.assertRaises(c.Reject):c.decode(b'{"a":1,"a":2}')
    def test_json_nan_rejected(self):
        with self.assertRaises(c.Reject):c.decode(b'{"a":NaN}')
    def test_unsafe_path_rejected(self):
        for p in ('relative','/a/../b','/a//b','/a\nx'):
            with self.subTest(p=p),self.assertRaises(c.Reject):c.exactpath(p)
    def test_two_existing_locks_release(self):
        paths=(str(self.file('lock1',b'')),str(self.file('lock2',b'')))
        with c.Locks(paths) as locks:locks.check()
        with c.Locks(paths):pass
    def test_missing_lock_never_created(self):
        p=self.root/'missing'
        with self.assertRaises(FileNotFoundError):
            with c.Locks((str(p),str(p))):pass
        self.assertFalse(p.exists())
    def test_contended_lock_nonblocking(self):
        paths=(str(self.file('lock1',b'')),str(self.file('lock2',b'')))
        with c.Locks(paths):
            with self.assertRaises(BlockingIOError):
                with c.Locks(paths):pass
    def test_lock_replaced_inode_rejected(self):
        paths=(str(self.file('lock1',b'')),str(self.file('lock2',b'')))
        with c.Locks(paths) as locks:
            os.unlink(paths[0]);pathlib.Path(paths[0]).write_bytes(b'')
            with self.assertRaises(c.Reject):locks.check()
    def test_lock_directory_alias_binds_real_files(self):
        self.file('real/lock1',b'');self.file('real/lock2',b'')
        alias=self.root/'alias';alias.symlink_to(self.root/'real',target_is_directory=True)
        paths=(str(alias/'lock1'),str(alias/'lock2'))
        with c.Locks(paths) as locks:locks.check()
        with c.Locks(paths):pass
    def test_lock_directory_alias_retarget_rejected(self):
        for directory in ('real','other'):
            self.file(directory+'/lock1',b'');self.file(directory+'/lock2',b'')
        alias=self.root/'alias';alias.symlink_to(self.root/'real',target_is_directory=True)
        with c.Locks((str(alias/'lock1'),str(alias/'lock2'))) as locks:
            alias.unlink();alias.symlink_to(self.root/'other',target_is_directory=True)
            with self.assertRaises(c.Reject):locks.check()
    def test_secret_name_not_export_candidate(self):
        self.assertTrue(c.secret('/a/.env.production'));self.assertTrue(c.secret('/a/key.pem'));self.assertFalse(c.secret('/a/package.json'))
    def test_locator_hints_never_complete_assertion(self):self.assertEqual(c.locator_hints(b'require("actual"); import("dyn");'),'actual dyn'.split())
    def test_child_inherited_loader_reject_before_spawn(self):
        with patch.dict(os.environ,{'NODE_OPTIONS':'--require forbidden'}),patch.object(c.subprocess,'run') as run:
            with self.assertRaises(c.Reject):c.node_child({},'rpc')
            run.assert_not_called()
    def test_cli_invalid_payload_one_json_no_traceback(self):
        rr=subprocess.run([sys.executable,'-B',str(HERE/'collect-runtime.py')],input=b'{}',stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        self.assertEqual(rr.returncode,2);d=json.loads(rr.stdout);self.assertEqual(d['status'],'ABORTED_NO_APPROVAL');self.assertNotIn(b'Traceback',rr.stderr)
    def test_helper_has_only_monitor_rpc(self):
        text=(HERE/'node-helper.js').read_text();self.assertEqual(text.count(".call('getMonitorData'"),1);self.assertNotIn('pm2.connect',text);self.assertNotIn("require('/usr/local/lib/node_modules/pm2/lib/God",text)
    def test_static_allowlist_fixed_trace(self):
        allow=json.loads((HERE/'static-deps-allowlist.json').read_bytes());self.assertEqual(allow['physicalCount'],51);self.assertEqual(c.STATIC_ALLOW,allow['logicalAliases'])
    def test_embedded_helper_exact(self):self.assertEqual(c.JS,(HERE/'node-helper.js').read_text())
    def test_node_helper_syntax_only(self):
        rr=subprocess.run(['node','--check',str(HERE/'node-helper.js')],stdout=subprocess.PIPE,stderr=subprocess.PIPE);self.assertEqual(rr.returncode,0,rr.stderr)
    def test_payload_offline_real_inputs_no_static_bytes(self):
        rr=subprocess.run([sys.executable,'-B',str(HERE/'make-payload.py'),'--static-hashes',str(HERE.parent/'existing-binary-dependencies/existing-binary-read.json')],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        self.assertEqual(rr.returncode,0,rr.stderr);q=json.loads(rr.stdout);c.validate_payload(q);self.assertEqual(len(q['staticDeps']),51);self.assertEqual(q['nodeSha256'],c.NODE_SHA);self.assertNotIn('base64',q['staticDeps'][0]);self.assertEqual(len(q['pm2Inventory']),3328)
    def test_filler_aborted_proof_rejected(self):
        with self.assertRaises(f.Invalid):f.fill({'schema':'static-runtime-policy-v2'},{'status':'ABORTED_NO_APPROVAL'},'0'*64)
    def test_filler_real_shape_stays_pending_report_null(self):
        ident={'kind':'dir','dev':1,'ino':2,'statmode':16832,'uid':0,'gid':0,'nlink':2,'link':None};root=c.SHADOW;child=root+'/unknown'
        policy={'schema':'static-runtime-policy-v2','status':'PENDING_INDEPENDENT_REVIEW','reviewRequirements':['ORIGINAL_UNRESOLVED'],'identityOnlyNamespaces':{root:{}},'liveLogs':[],'shadowLiveContainers':[],'shadowLiveRoots':[],'shadowLiveFiles':[],'opaqueShadowArchives':[],'identityOnlyShadowPaths':[],'runtimePins':{},'scriptClosures':{},'daemonRoles':{},'evidence':[]}
        proof={'schema':'runtime-completion-readonly-proof-v1','status':'PENDING_INDEPENDENT_REVIEW','productionWrites':0,'rawEnvironmentValuesExported':False,'reviewRequirements':['TRANSITIVE_INCOMPLETE'],'identityOnlyNamespaces':{root:{'identity':ident,'children':{child:ident}}},'daemonObservations':{},'sourcePins':{},'scriptSources':{},'pm2':[],'shadowReferences':[{'path':child+'/userdata','field':'fd'}],'dependencyResolution':{'locators':[]},'allLiveNodeAndPM2':{}}
        result=f.fill(policy,proof,'a'*64);out=result['policy'];report=result['completionReport']
        self.assertEqual(out['status'],'PENDING_INDEPENDENT_REVIEW');self.assertIsNone(report['independentSemanticReport']);self.assertFalse(report['readySet']);self.assertEqual(out['identityOnlyNamespaces'][root]['children'][child]['classification'],'identity-only');self.assertEqual(out['opaqueShadowArchives'],[]);self.assertTrue(report['shadowGuardBlockers']);self.assertIn('ORIGINAL_UNRESOLVED',out['reviewRequirements'])
    def test_filler_wrong_semantic_exact_proof_rejected(self):
        # Missing real proof schema cannot be upgraded by a supplied review flag.
        with self.assertRaises(f.Invalid):f.fill({'schema':'static-runtime-policy-v2'},{'status':'READY'},'0'*64,{'status':'REVIEWED_OBSERVATIONS_NOT_APPROVAL'},'1'*64)
    def test_ast_no_compiled_execution_and_local_require(self):
        src=b'function wrapper(require){require("fake-local")} require("actual");import("dynamic",{with:{type:"json"}});import(dynamicName);'
        proof={'scriptSources':{'/opt/releases/test/index.js':{'base64':base64.b64encode(src).decode(),'record':{'sha256':c.H(src)}}}}
        rr=subprocess.run(['node',str(HERE/'ast-locators.mjs')],input=json.dumps(proof).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        self.assertEqual(rr.returncode,0,rr.stderr);out=json.loads(rr.stdout);self.assertFalse(out['compiledModulesExecuted']);self.assertFalse(out['closureComplete']);self.assertNotIn('fake-local',[r['specifier'] for r in out['requests']]);self.assertIn('actual',[r['specifier'] for r in out['requests']]);self.assertTrue(out['reviewItems'])
    def test_proc_mixed_byte_script_suffixes(self):
        fields=[b'S',b'1']+[b'0']*20;fields[19]=b'12345'
        data={'stat':b'123 (fixture) '+b' '.join(fields),'environ':b'HOME=/root\0',
              'cmdline':b'/usr/bin/python3\0/a.py\0/b.sh\0/c.cjs\0/d.mjs\0/e.js\0/ignore.txt\0',
              'status':b'Uid:\t0 0 0 0\nGid:\t0 0 0 0\nGroups:\t0\nUmask:\t0022\n'}
        with patch.object(c,'proc_read',side_effect=lambda root,name:data[name]),patch.object(c.os,'readlink',side_effect=lambda p:'/tmp' if p.name=='cwd' else '/usr/bin/python3'),patch.object(c.Path,'iterdir',return_value=iter(())):
            rec,_=c.proc_record(123,None,pin_execution=False)
        self.assertEqual(rec['scriptPaths'],['/a.py','/b.sh','/c.cjs','/d.mjs','/e.js'])
    def test_exception_type_visible_without_secret_message(self):
        output=io.BytesIO();inp=io.TextIOWrapper(io.BytesIO(b'{}'));out=io.TextIOWrapper(output)
        with patch.object(c.sys,'stdin',inp),patch.object(c.sys,'stdout',out),patch.object(c,'collect',side_effect=TypeError('DO_NOT_EXPORT')):
            self.assertEqual(c.main(),2)
        result=json.loads(output.getvalue());self.assertEqual(result['errorCode'],'EXCEPTION_TYPEERROR')
        self.assertNotIn(b'DO_NOT_EXPORT',output.getvalue())

if __name__=='__main__':unittest.main(verbosity=2)
