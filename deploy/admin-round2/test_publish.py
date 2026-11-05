"""Tool safety tests ONLY. All fabricated build logs/manifests are synthetic fixtures, never final QA."""
import argparse
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
SPEC=importlib.util.spec_from_file_location('round2publish',Path(__file__).with_name('publish.py'))
p=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(p)
TOOLS=Path(__file__).parent
BASE=Path('/home/ubuntu/backend-optimization/round2/baseline')
def write(root,n,b):
    if isinstance(b,str):b=b.encode()
    dest=root/n;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
    return {'path':n,'sha256':p.digest(b),'bytes':len(b)}
def jsonbytes(v):return (json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode()
def fixture(root):
    # Existing baseline bytes are read offline solely to exercise inverse verification.
    source_sha=None;files=[{'path':'scripts/apply-admin-staff-archives.mjs','sha256':p.digest(b'synthetic-script'),'bytes':16},{'path':'scripts/20261105-admin-staff-archives.sql','sha256':p.digest(b'synthetic-ddl'),'bytes':13}]
    sources={s:{'commit':'a'*40,'treeSha256':p.digest(p.compact(files if s=='admin' else []).encode()),'files':files if s=='admin' else []} for s in ['admin','front']}
    source_sha=p.digest(p.compact({s:v['treeSha256'] for s,v in sources.items()}).encode());namespace=p.VERSION+'-'+source_sha[:12]
    # Use the actual JS inverse-edit implementation but synthetic namespaced built tags.
    js="import fs from 'node:fs';import {assembleHtml} from './lib.mjs';const old=fs.readFileSync(process.argv[1],'utf8');const ns=process.argv[2];const built='<script type=\"module\" crossorigin src=\"/assets/'+ns+'/index-new.js\"></script><link rel=\"stylesheet\" crossorigin href=\"/assets/'+ns+'/index-new.css\"><link rel=\"modulepreload\" crossorigin href=\"/assets/'+ns+'/chunk-new.js\">';console.log(JSON.stringify(assembleHtml(old,built,ns)));"
    r=subprocess.run(['node','--input-type=module','-e',js,str(BASE/'index.html'),namespace],cwd=TOOLS,capture_output=True,check=True);html=json.loads(r.stdout)
    assets=[write(root,f'assets/{namespace}/{n}',b'SYNTHETIC FIXTURE NOT A RELEASE') for n in ['index-new.js','index-new.css','chunk-new.js']]
    apis=[write(root,s+'/dist/index.js',b'SYNTHETIC API DO NOT EXECUTE') for s in ['front','admin']]
    ddl=[write(root,'admin/scripts/apply-admin-staff-archives.mjs',b'synthetic-script'),write(root,'admin/scripts/20261105-admin-staff-archives.sql',b'synthetic-ddl')]
    tool=write(root,'tools/publish.py',(TOOLS/'publish.py').read_bytes())
    freeze={'schemaVersion':2,'release':p.VERSION,'sourceSha256':source_sha,'sources':sources,'baseline':p.BASELINE,'syntheticFixture':True,'toolFiles':[{'path':'publish.py','sha256':tool['sha256']} ]}
    evidence=[write(root,'evidence/freeze.json',jsonbytes(freeze)),write(root,'evidence/html-edits.json',jsonbytes(html['edits'])),write(root,'evidence/public-baseline.json',(BASE/'public-baseline.json').read_bytes()),write(root,'evidence/processes-baseline.json',(BASE/'processes.json').read_bytes())]
    checks=[]
    for side,kind in [('admin','tsc'),('front','tsc'),('admin','vitest'),('front','vitest'),('admin','vite'),('front','esbuild'),('admin','esbuild')]:
        log=write(root,f'evidence/{side}-{kind}.log',b'SYNTHETIC COMMAND LOG FOR TOOL TEST ONLY\n');evidence.append(log)
        cmd=['node','/synthetic/node_modules/typescript/bin/tsc','--noEmit'] if kind=='tsc' else ['node','/synthetic/node_modules/vitest/vitest.mjs','run'] if kind=='vitest' else ['node','/synthetic/vite-worker.mjs'] if kind=='vite' else ['node','/synthetic/build-service.mjs']
        checks.append({'side':side,'kind':kind,'exitCode':0,'envFilesLoaded':False,'command':cmd,'log':Path(log['path']).name,'logSha256':log['sha256'],'syntheticFixture':True})
    evidence.append(write(root,'evidence/checks.json',jsonbytes(checks)))
    for side in ['admin','front']:evidence.append(write(root,f'evidence/{side}-regression-suite.json',jsonbytes({'selected':['synthetic.test.tsx'],'dbSkipped':[{'path':'synthetic.mysql.test.ts','status':'skipped','reason':'no isolated DB connection'}],'syntheticFixture':True})))
    h=write(root,'candidate-index.html',html['html'])
    manifest={'schemaVersion':2,'release':p.VERSION,'kind':'combined-api-manager-static','syntheticFixture':True,'sourceSha256':source_sha,'sources':{s:{'commit':v['commit'],'treeSha256':v['treeSha256']} for s,v in sources.items()},'sourceFreezeSha256':evidence[0]['sha256'],'namespace':namespace,'baseline':p.BASELINE,'publicBaseline':json.loads((BASE/'public-baseline.json').read_bytes()),'assets':assets,'apis':apis,'ddl':ddl,'toolArtifacts':[tool],'evidence':evidence,'checks':checks,'html':h,'rootAssetsMustRemainUnchanged':[],'guard':{k:True for k in ['actualChecksPassed','sourceStable','isolatedNoEnvFiles','networkBlockedInTests','oldHtmlOtherBytesPreserved','oldAssetsNeverDeleted']}}
    manifest['guard'].update({k:False for k in ['productionDeploymentPerformed','productionBrowserVerified','databaseTestsPassed']});write(root,'manifest.json',jsonbytes(manifest));return manifest
class Safety(unittest.TestCase):
    def test_locked_dependency_patch_source_name_keeps_artifacts_strict(self):
        self.assertEqual(p.safe_source_relative('patches/wouter@3.7.1.patch'),'patches/wouter@3.7.1.patch')
        with self.assertRaises(p.Stop):p.safe_relative('assets/example@file.js')
        for name in ('../patches/wouter@3.patch','/patches/wouter@3.patch','patches/../wouter@3.patch','patches//wouter@3.patch','patches/wouter@3.patch\n'):
            with self.assertRaises(p.Stop):p.safe_source_relative(name)
    def setUp(self):self.tmp=tempfile.TemporaryDirectory(prefix='round2-SYNTHETIC-');self.root=Path(self.tmp.name);self.m=fixture(self.root)
    def tearDown(self):self.tmp.cleanup()
    def rewrite(self):write(self.root,'manifest.json',jsonbytes(self.m))
    def test_synthetic_package_validates_offline_only(self):
        with patch.object(p,'helper',side_effect=AssertionError('production helper forbidden')),patch.object(p.urllib.request,'urlopen',side_effect=AssertionError('network forbidden')):m,mb,candidate,old=p.validate_package(self.root)
        self.assertEqual(p.digest(old),p.BASELINE['index.html']);self.assertTrue(m['syntheticFixture'])
    def test_default_plan_no_runtime_or_network(self):
        with patch('sys.argv',['publish.py','--package',str(self.root),'--plan']),patch.object(p,'helper',side_effect=AssertionError('runtime forbidden')),patch.object(p,'mutate',side_effect=AssertionError('write forbidden')),contextlib.redirect_stdout(io.StringIO()) as out:p.main()
        self.assertTrue(json.loads(out.getvalue())['offlineOnly'])
    def test_local_verify_no_runtime(self):
        with patch('sys.argv',['publish.py','--package',str(self.root),'--verify-local']),patch.object(p,'helper',side_effect=AssertionError('runtime forbidden')),contextlib.redirect_stdout(io.StringIO()) as out:p.main()
        self.assertFalse(json.loads(out.getvalue())['productionAccessPerformed'])
    def test_no_mutation_without_explicit_authorization(self):
        a=argparse.Namespace(authorize_production=False)
        with patch.object(p,'processes',side_effect=AssertionError('PM2 forbidden')),self.assertRaises(p.Stop):p.mutate(a,self.root,self.m,b'',b'',b'')
    def test_offline_fixture_cannot_be_applied_even_with_authorization(self):
        a=argparse.Namespace(authorize_production=True)
        with patch.object(p,'processes',side_effect=AssertionError('PM2 forbidden')),self.assertRaises(p.Stop):p.mutate(a,self.root,self.m,b'',b'',b'')
    def test_tampered_asset_fails(self):
        (self.root/self.m['assets'][0]['path']).write_bytes(b'tampered')
        with self.assertRaises(p.Stop):p.validate_package(self.root)
    def test_tampered_actual_log_fails(self):
        (self.root/'evidence/admin-tsc.log').write_bytes(b'fake new log')
        with self.assertRaises(p.Stop):p.validate_package(self.root)
    def test_failure_guard_and_production_claims_rejected(self):
        self.m['guard']['actualChecksPassed']=False;self.rewrite()
        with self.assertRaises(p.Stop):p.validate_package(self.root)
        self.m['guard']['actualChecksPassed']=True;self.m['guard']['productionBrowserVerified']=True;self.rewrite()
        with self.assertRaises(p.Stop):p.validate_package(self.root)
    def test_path_escape_and_symlink_rejected(self):
        for n in ['../bad','/absolute','a//b','a/../b','a/./b','a?x']:
            with self.assertRaises(p.Stop):p.safe_relative(n)
        out=self.root/'link';out.symlink_to('/nonexistent')
        with self.assertRaises(p.Stop):p.regular(self.root,'link')
    def test_html_inline_tamper_even_with_new_hash_rejected(self):
        path=self.root/'candidate-index.html';text=path.read_text().replace('window.__MANUS_HOST_DEV__ = false','window.__MANUS_HOST_DEV__ = true');self.m['html']=write(self.root,'candidate-index.html',text);self.rewrite()
        with self.assertRaises(p.Stop):p.validate_package(self.root)
    def test_api_artifacts_and_ddl_whitelist_rejected(self):
        self.m['apis'][0]['path']='front/dist/worker.js';self.rewrite()
        with self.assertRaises(p.Stop):p.validate_package(self.root)
    def test_phase_order_explicit(self):
        self.assertEqual(p.phase_for('migrate'),('prepared','schema_ready'));self.assertEqual(p.phase_for('activate','front'),('schema_ready','front_active'));self.assertEqual(p.phase_for('activate','admin'),('front_active','admin_active'));self.assertEqual(p.phase_for('static'),('admin_active','static_active'))
    def test_immutable_no_overwrite_and_atomic_same_dir(self):
        source=self.root/'source';source.write_bytes(b'one');dest=self.root/'dest';p.immutable(source,dest,p.sha(source));p.immutable(source,dest,p.sha(source));source.write_bytes(b'two')
        with self.assertRaises(p.Stop):p.immutable(source,dest,p.sha(source))
        p.atomic(dest,b'new');self.assertEqual(dest.read_bytes(),b'new');self.assertFalse(list(self.root.glob('.admin-round2-*')))
    def test_qa_template_cannot_approve(self):
        write(self.root,'qa-approval.json',(TOOLS/'qa-approval.expected.json').read_bytes())
        with self.assertRaises(p.Stop):p.approval(self.root,p.sha(self.root/'manifest.json'),self.m)
    def simulated_mutation(self,phase):
        # All server paths and calls are replaced with private temporary fixture paths.
        # This in-memory simulation is not a deployable package or final application QA.
        self.m.pop('syntheticFixture',None)
        self.html=self.root/'fake-admin-index.html';self.html.write_bytes((BASE/'index.html').read_bytes())
        self.coord=self.root/'fake-coordination.json';write(self.root,self.coord.name,jsonbytes({'shared_release_active':True,'admin_round2_owner':p.VERSION}))
        state={'phase':phase,'lastProcesses':[{'synthetic':'newApi'}],'lastPersistence':{'synthetic':'newBootPath'},'htmlSha256':p.sha(self.html)}
        write(self.root,'state.json',jsonbytes(state));write(self.root,'before-index.html',(BASE/'index.html').read_bytes())
        self.stack=contextlib.ExitStack()
        for key,value in [('PACKAGE',self.root),('RELEASE',self.root/'fake-release'),('HTML',self.html),('LOCK',self.root/'fake-global.lock'),('COORD',self.coord),('__file__',str(self.root/'tools/publish.py'))]:self.stack.enter_context(patch.object(p,key,value))
        self.stack.enter_context(patch.object(p,'guard',return_value=state['lastProcesses']))
        self.stack.enter_context(patch.object(p,'processes',return_value=state['lastProcesses']))
        self.stack.enter_context(patch.object(p,'persistence',return_value=state['lastPersistence']))
        self.stack.enter_context(patch.object(p,'sha',wraps=p.sha))
        self.addCleanup(self.stack.close)
        return argparse.Namespace(authorize_production=True,prepare=False,migrate=False,activate=False,static=True,rollback_html=False,target=None)
    def test_synthetic_static_failure_restores_only_our_html_and_retains_api(self):
        a=self.simulated_mutation('admin_active');candidate=(self.root/'candidate-index.html').read_bytes();old=(BASE/'index.html').read_bytes()
        with patch.object(p,'sha',side_effect=lambda filename:p.digest(self.html.read_bytes()) if Path(filename)==self.html else next((x['sha256'] for x in self.m['assets'] if Path(filename).name==Path(x['path']).name),p.digest(b'synthetic'))),patch.object(p,'verify_http'),patch.object(p,'health',side_effect=p.Stop('SYNTHETIC readiness failure')):
            with self.assertRaises(p.Stop):p.mutate(a,self.root,self.m,b'SYNTHETIC',candidate,old)
        state=json.loads((self.root/'state.json').read_bytes());self.assertEqual(state['phase'],'stopped');self.assertTrue(state['newApisRetained']);self.assertEqual(self.html.read_bytes(),old);self.assertTrue(json.loads(self.coord.read_bytes())['shared_release_active'])
    def test_synthetic_repeated_apply_checks_state_without_replay(self):
        a=self.simulated_mutation('static_active')
        with patch.object(p,'atomic',side_effect=AssertionError('blind replay forbidden')),patch.object(p,'helper',side_effect=AssertionError('reload forbidden')),contextlib.redirect_stdout(io.StringIO()) as out:p.mutate(a,self.root,self.m,b'',b'',b'')
        self.assertFalse(json.loads(out.getvalue())['replayed'])
    def test_activation_boot_check_reload_save_order_and_partial_save_failure_retains_new_api(self):
        a=self.simulated_mutation('schema_ready');a.static=False;a.activate=True;a.target='front';calls=[];new=[{'synthetic':'new-front-API'}]
        def helper(package,name,args):
            calls.append((name,args[-1]))
            if '--boot-check' in args:return {'synthetic':'newBootPath'}
            if name=='reload-target.mjs':return {'side':'front','processes':new,'targetedSequentialReload':True,'environmentRetained':True}
            if '--save' in args:raise p.Stop('SYNTHETIC save failure')
            raise AssertionError('unexpected helper')
        with patch.object(p,'helper',side_effect=helper),patch.object(p,'processes',return_value=new),self.assertRaises(p.Stop):p.mutate(a,self.root,self.m,b'SYNTHETIC',b'',(BASE/'index.html').read_bytes())
        state=json.loads((self.root/'state.json').read_bytes())
        self.assertEqual(calls[0],('persist-targets.mjs','--boot-check'));self.assertEqual(calls[1][0],'reload-target.mjs');self.assertEqual(calls[2],('persist-targets.mjs','--save'))
        self.assertEqual(state['phase'],'stopped');self.assertEqual(state['lastProcesses'],new);self.assertEqual(state['observedProcesses'],new);self.assertTrue(state['newApisRetained']);self.assertTrue(json.loads(self.coord.read_bytes())['shared_release_active'])
    def test_boot_check_mutation_or_failure_stops_before_reload(self):
        a=self.simulated_mutation('schema_ready');a.static=False;a.activate=True;a.target='front'
        with patch.object(p,'helper',return_value={'unexpected':'changed-dump'}) as helper,self.assertRaises(p.Stop):p.mutate(a,self.root,self.m,b'SYNTHETIC',b'',(BASE/'index.html').read_bytes())
        self.assertEqual(helper.call_count,1);self.assertIn('--boot-check',helper.call_args.args[2]);self.assertNotIn('--config',helper.call_args.args[2]);self.assertEqual(json.loads((self.root/'state.json').read_bytes())['phase'],'stopped')
    def test_http_nonce_identity_and_exact_body_hash_without_network(self):
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):return b'SYNTHETIC asset content'
        with patch.object(p.urllib.request,'urlopen',return_value=Response()) as openurl:
            p.verify_http('http://synthetic.invalid/asset.js',p.digest(b'SYNTHETIC asset content'),'a'*32)
            req=openurl.call_args.args[0];self.assertEqual(req.full_url,'http://synthetic.invalid/asset.js?_round2='+'a'*32);self.assertEqual(req.get_header('Accept-encoding'),'identity');self.assertEqual(req.get_header('Cache-control'),'no-cache')
            with self.assertRaises(p.Stop):p.verify_http('http://synthetic.invalid/asset.js',p.digest(b'corrupt'),'a'*32)
    def test_all_100_assets_each_origin_are_hash_checked_with_hard_concurrency_8(self):
        assets=[{'path':f'assets/synthetic/{i}.js','sha256':p.digest(str(i).encode())} for i in range(100)]
        lock=threading.Lock();active=0;peak=0;seen=[]
        def verify(url,h,nonce):
            nonlocal active,peak
            with lock:active+=1;peak=max(peak,active)
            time.sleep(.005)
            with lock:seen.append((url,h,nonce));active-=1
        with patch.object(p,'verify_http',side_effect=verify):p.verify_assets_http({'assets':assets},('http://synthetic-a.invalid','http://synthetic-b.invalid'))
        self.assertEqual(len(seen),200);self.assertGreater(peak,1);self.assertLessEqual(peak,8);self.assertEqual(len({x[2] for x in seen}),1)
        self.assertEqual({(url,h) for url,h,_ in seen},{(origin+'/'+a['path'],a['sha256']) for origin in ('http://synthetic-a.invalid','http://synthetic-b.invalid') for a in assets})
    def test_parallel_asset_failure_propagates_without_sampling(self):
        seen=[]
        def verify(url,h,nonce):
            seen.append(url)
            if url.endswith('/bad.js'):raise p.Stop('SYNTHETIC asset mismatch')
        assets=[{'path':'assets/synthetic/'+n,'sha256':'a'*64} for n in ['one.js','bad.js','last.js']]
        with patch.object(p,'verify_http',side_effect=verify),self.assertRaises(p.Stop):p.verify_assets_http({'assets':assets},('http://synthetic.invalid',))
        self.assertEqual(len(seen),3)
    def test_static_runtime_fingerprint_allows_only_our_namespace_html_not_old_resources(self):
        public=self.root/'static';write(public,'index.html',b'old html');write(public,'assets/old.js',b'old asset');write(public,'unchanged-root.txt',b'root')
        with patch.object(p,'PUBLIC',public):
            before=p.fingerprint(public,'synthetic-round2');write(public,'assets/synthetic-round2/new.js',b'new');p.atomic(public/'index.html',b'candidate html');self.assertEqual(p.fingerprint(public,'synthetic-round2'),before)
            write(public,'assets/unapproved/new.js',b'not allowed');self.assertNotEqual(p.fingerprint(public,'synthetic-round2'),before)
            (public/'assets/unapproved/new.js').unlink();write(public,'unchanged-root.txt',b'changed');self.assertNotEqual(p.fingerprint(public,'synthetic-round2'),before)
    def test_runtime_links_keep_legacy_symlink_realpaths_and_every_dist_companion(self):
        old=self.root/'old';public=self.root/'admin-public';main=self.root/'main-public';public.mkdir();main.mkdir()
        for side in ('front','admin'):
            (old/side/'dist/helpers').mkdir(parents=True);(old/side/'deps').mkdir();(old/side/'node_modules').symlink_to(old/side/'deps',target_is_directory=True);write(old,side+'/package.json',b'{}');write(old,side+'/dist/index.js',b'old');write(old,side+'/dist/helpers/child.js',b'helper');write(old,side+'/dist/worker.js',b'worker');(old/side/'dist/public').symlink_to(main if side=='front' else public,target_is_directory=True);(old/side/'public').symlink_to(old/side/'dist/public',target_is_directory=True)
        with patch.object(p,'OLD',old),patch.object(p,'PUBLIC',public),patch.object(p,'MAIN_PUBLIC',main):
            links=p.runtime_links();self.assertEqual(links['admin/dist/public'],public);self.assertEqual(links['front/dist/public'],main);self.assertIn('admin/dist/helpers',links);self.assertIn('front/dist/worker.js',links);self.assertIn('admin/public',links);self.assertNotIn('admin/dist/index.js',links)
            before=p.fingerprint(links['admin/node_modules']);self.assertEqual(before['link'],str(old/'admin/deps'));(old/'admin/node_modules').unlink();(old/'admin/node_modules').symlink_to(main,target_is_directory=True);self.assertNotEqual(p.fingerprint(old/'admin/node_modules'),before)
    def test_api_file_symlink_and_symlink_ancestor_rejected_even_with_identical_bytes(self):
        release=self.root/'release';source=self.root/'identical-api.js';source.write_bytes(b'SYNTHETIC API');(release/'front/dist').mkdir(parents=True);(release/'front/dist/index.js').symlink_to(source)
        with self.assertRaises(p.Stop):p.regular(release,'front/dist/index.js')
        (release/'front/dist/index.js').unlink();(release/'front/dist').rmdir();(release/'front/dist').symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(p.Stop):p.regular(release,'front/dist/identical-api.js')
    def test_secret_runtime_companion_cannot_be_read_or_linked(self):
        secret=self.root/'.env';secret.write_bytes(b'NEVER READ')
        with patch.object(p,'sha',side_effect=AssertionError('secret read forbidden')),self.assertRaises(p.Stop):p.fingerprint(secret)
        alias=self.root/'harmless.js';alias.symlink_to(secret)
        with patch.object(p,'sha',side_effect=AssertionError('secret read forbidden')),self.assertRaises(p.Stop):p.fingerprint(alias)
    def test_temporary_server_full_prepare_activation_static_guards_without_ecosystem_scripts(self):
        # Every path, PM2 operation and HTTP request is isolated/replaced. This is NOT production QA.
        self.m.pop('syntheticFixture');self.rewrite();public=self.root/'fake-public';main=self.root/'fake-main-public';old=self.root/'fake-old';release=self.root/'fake-release';coord=self.root/'fake-coord.json';nginx=self.root/'fake-nginx.conf'
        write(public,'index.html',(BASE/'index.html').read_bytes());write(public,'assets/old-asset.js',b'old asset');write(main,'index.html',b'UNMODIFIED MAIN HTML');nginx.write_bytes(b'UNMODIFIED NGINX')
        ps=[]
        for side,(name,ids) in p.TARGETS.items():
            write(old,side+'/dist/index.js',b'UNMODIFIED OLD API '+side.encode());write(old,side+'/dist/helper.js',b'UNMODIFIED COMPANION');write(old,side+'/package.json',b'{}');(old/side/'deps').mkdir();(old/side/'node_modules').symlink_to(old/side/'deps',target_is_directory=True);(old/side/'dist/public').symlink_to(main if side=='front' else public,target_is_directory=True);(old/side/'public').symlink_to(old/side/'dist/public',target_is_directory=True)
            for id in ids:ps.append({'id':id,'name':name,'pid':id+1000,'script':str(old/side/'dist/index.js'),'sha256':p.sha(old/side/'dist/index.js'),'cwd':'/synthetic/'+side,'status':'online','restarts':0,'envHash':'hash-only','configHash':'hash-only'})
        holder={'processes':ps,'persistence':{'ecosystem':{'sha256':{'opaque-three-configs':'hash-only'},'semanticSha256':'stable','configs':[]},'bootAuthority':{'kind':'pm2-resurrect','dumpPath':'/root/.pm2/dump.pm2'},'dump':{'sha256':'before','semanticSha256':'launch-env-stable','scripts':{s:[str(old/s/'dist/index.js')]*len(ids) for s,(_,ids) in p.TARGETS.items()}}}}
        qa={'manifestSha256':p.sha(self.root/'manifest.json'),'uiEvidenceScope':'authorized-react-fixture','productionBrowserVerified':False,'ddlArtifactHashes':{a['path']:a['sha256'] for a in self.m['ddl']},**{k:True for k in ['frozenSourceReviewed','isolatedAuthorizedUiQaPassed','serverApiCompatibilityPassed','ddlReviewApproved']}}
        write(self.root,'qa-approval.json',jsonbytes(qa));write(self.root,coord.name,jsonbytes({'shared_release_active':False}))
        calls=[]
        def protected(_):return {str(x):p.sha(x) for x in [nginx,main/'index.html',old/'front/dist/index.js',old/'admin/dist/index.js']}
        def helper(package,name,args):
            calls.append((name,list(args)))
            if '--boot-check' in args:return holder['persistence']
            if name=='reload-target.mjs':
                side=args[args.index('--side')+1];name_,ids=p.TARGETS[side];rows=json.loads(json.dumps(holder['processes']))
                for row in rows:
                    if row['id'] in ids:row.update({'script':str(release/side/'dist/index.js'),'sha256':p.sha(release/side/'dist/index.js'),'pid':row['pid']+1,'restarts':row['restarts']+1})
                holder['processes']=rows;return {'side':side,'processes':rows,'targetedSequentialReload':True,'environmentRetained':True}
            if '--save' in args:
                side=args[args.index('--side')+1];v=json.loads(json.dumps(holder['persistence']));v['dump']['sha256']='fresh-'+side;v['dump']['scripts'][side]=[str(release/side/'dist/index.js')]*len(p.TARGETS[side][1]);holder['persistence']=v;return v
            raise AssertionError('real helper forbidden')
        a=argparse.Namespace(authorize_production=True,prepare=True,migrate=False,activate=False,static=False,rollback_html=False,target=None)
        candidate=(self.root/'candidate-index.html').read_bytes();before=(BASE/'index.html').read_bytes();mb=(self.root/'manifest.json').read_bytes()
        with contextlib.ExitStack() as stack:
            for key,value in [('PACKAGE',self.root),('RELEASE',release),('OLD',old),('PUBLIC',public),('MAIN_PUBLIC',main),('HTML',public/'index.html'),('LOCK',self.root/'fake-lock'),('COORD',coord),('__file__',str(self.root/'tools/publish.py'))]:stack.enter_context(patch.object(p,key,value))
            stack.enter_context(patch.object(p,'baseline_check'));stack.enter_context(patch.object(p,'protected_files',side_effect=protected));stack.enter_context(patch.object(p,'processes',side_effect=lambda _:holder['processes']));stack.enter_context(patch.object(p,'persistence',side_effect=lambda _:holder['persistence']));stack.enter_context(patch.object(p,'helper',side_effect=helper));stack.enter_context(patch.object(p,'health'));stack.enter_context(patch.object(p,'verify_http'));stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            p.mutate(a,self.root,self.m,mb,candidate,before);state=json.loads((self.root/'state.json').read_bytes());self.assertEqual(state['phase'],'prepared');self.assertFalse(calls);self.assertTrue((release/'admin/dist/index.js').is_file());self.assertFalse((release/'admin/dist/index.js').is_symlink());self.assertTrue((release/'admin/dist/helper.js').is_symlink());self.assertEqual((release/'admin/dist/public').resolve(),public);self.assertEqual((release/'front/dist/public').resolve(),main)
            # Simulate separately authorized schema readiness; no DDL is executed by this test.
            state['phase']='schema_ready';write(self.root,'state.json',jsonbytes(state));a.prepare=False;a.activate=True
            for side in ('front','admin'):
                a.target=side;p.mutate(a,self.root,self.m,mb,candidate,before);state=json.loads((self.root/'state.json').read_bytes());self.assertEqual(state['phase'],side+'_active');self.assertEqual(state['beforePersistence']['ecosystem'],state['lastPersistence']['ecosystem'])
                if side=='front':self.assertEqual(state['lastPersistence']['dump']['scripts']['admin'],[str(old/'admin/dist/index.js')]*2)
            a.activate=False;a.target=None;a.static=True;p.mutate(a,self.root,self.m,mb,candidate,before);state=json.loads((self.root/'state.json').read_bytes());self.assertEqual(state['phase'],'static_active');self.assertEqual((public/'index.html').read_bytes(),candidate);self.assertFalse(json.loads(coord.read_bytes())['shared_release_active']);p.guard(self.root,self.m,state)
        self.assertEqual([args[-1] for name,args in calls if name=='persist-targets.mjs'],['--boot-check','--save','--boot-check','--save']);self.assertEqual(nginx.read_bytes(),b'UNMODIFIED NGINX')
if __name__=='__main__':unittest.main(verbosity=2)
