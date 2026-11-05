"""Tool safety ONLY. Synthetic logs are unit fixtures, never application QA/build evidence."""
import argparse, contextlib, copy, importlib.util, io, json, os, subprocess, tempfile, threading, time, unittest
from pathlib import Path
from unittest.mock import patch
SPEC=importlib.util.spec_from_file_location('round3publish',Path(__file__).with_name('publish.py'))
p=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(p)
TOOLS=Path(__file__).parent
BASE=Path('/home/ubuntu/backend-optimization/round3/baseline')
def jb(v):return (json.dumps(v,ensure_ascii=False,indent=2)+'\n').encode()
def write(root,name,data):
    if isinstance(data,str):data=data.encode()
    target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    return {'path':name,'sha256':p.digest(data),'bytes':len(data)}
def fixture(root):
    q=p.CONFIG['projection'];ddl=[write(root,'front/'+q['runner'],b'SYNTHETIC RUNNER NOT EXECUTABLE'),write(root,'front/'+q['sql'],b'SYNTHETIC SQL NOT EXECUTABLE')]
    files=[{'path':a['path'].removeprefix('front/'),'sha256':a['sha256'],'bytes':a['bytes']} for a in ddl]
    sources={side:{'commit':'a'*40,'files':files if side=='front' else []} for side in ('admin','front')}
    for v in sources.values():v['treeSha256']=p.digest(p.compact(v['files']).encode())
    source_sha=p.digest(p.compact({s:v['treeSha256'] for s,v in sources.items()}).encode());namespaces={s:p.VERSION+'-'+s+'-'+source_sha[:12] for s in sources}
    assets=[];htmls={};evidence=[]
    for side,ns in namespaces.items():
        js="import fs from 'node:fs';import {assembleHtml,BASELINE} from './lib.mjs';const side=process.argv[1],ns=process.argv[2],old=fs.readFileSync(process.argv[3],'utf8');const built='<script type=\"module\" crossorigin src=\"/assets/'+ns+'/index-new.js\"></script><link rel=\"stylesheet\" crossorigin href=\"/assets/'+ns+'/index-new.css\"><link rel=\"modulepreload\" crossorigin href=\"/assets/'+ns+'/chunk-new.js\">';console.log(JSON.stringify(assembleHtml(old,built,ns,BASELINE[side+'-index.html'],side)));"
        r=subprocess.run(['node','--input-type=module','-e',js,side,ns,str(BASE/(side+'-index.html'))],cwd=TOOLS,capture_output=True,check=True);result=json.loads(r.stdout)
        for name in ('index-new.js','index-new.css','chunk-new.js'):
            a=write(root,'static/'+side+'/assets/'+ns+'/'+name,b'SYNTHETIC FIXTURE NOT A RELEASE');a.update(side=side,publicPath='assets/'+ns+'/'+name);assets.append(a)
        htmls[side]=write(root,'candidate-'+side+'-index.html',result['html']);evidence.append(write(root,'evidence/'+side+'-html-edits.json',jb(result['edits'])))
    apis=[write(root,side+'/dist/index.js',b'SYNTHETIC API DO NOT EXECUTE') for side in sources]
    tool=write(root,'tools/publish.py',(TOOLS/'publish.py').read_bytes())
    freeze={'schemaVersion':3,'release':p.VERSION,'sourceSha256':source_sha,'sources':sources,'baseline':p.BASELINE,'syntheticFixture':True,'typedMirror':{s:{'kind':'exact-unmodified-typed-source-copy','files':[],'treeSha256':p.digest(b'[]')} for s in sources},'toolFiles':[{'path':'publish.py','sha256':tool['sha256']}]}
    evidence.insert(0,write(root,'evidence/freeze.json',jb(freeze)));evidence.append(write(root,'evidence/processes-baseline.json',(BASE/'processes.json').read_bytes()))
    checks=[]
    for side in sources:
        for kind in ('tsc','vitest','vite','esbuild'):
            a=write(root,'evidence/'+side+'-'+kind+'.log',b'SYNTHETIC COMMAND LOG FOR TOOL TEST ONLY\n');evidence.append(a)
            cmd=['node','/synthetic/node_modules/typescript/bin/tsc','--noEmit'] if kind=='tsc' else ['node','/synthetic/node_modules/vitest/vitest.mjs','run'] if kind=='vitest' else ['node','/synthetic/vite-worker.mjs'] if kind=='vite' else ['node','/synthetic/build-service.mjs']
            checks.append({'side':side,'kind':kind,'exitCode':0,'envFilesLoaded':False,'networkBlockedByPreload':True,'command':cmd,'log':Path(a['path']).name,'logSha256':a['sha256'],'syntheticFixture':True})
    evidence.append(write(root,'evidence/checks.json',jb(checks)))
    for side in sources:evidence.append(write(root,'evidence/'+side+'-regression-suite.json',jb({'selected':['synthetic.test.tsx'],'dbSkipped':[{'path':'synthetic.mysql.test.ts','status':'skipped','reason':'no isolated DB authorized'}],'syntheticFixture':True})))
    m={'schemaVersion':3,'release':p.VERSION,'kind':'combined-api-dual-static','syntheticFixture':True,'sourceSha256':source_sha,'sources':{s:{'commit':v['commit'],'treeSha256':v['treeSha256']} for s,v in sources.items()},'sourceFreezeSha256':evidence[0]['sha256'],'namespaces':namespaces,'baseline':p.BASELINE,'projection':q,'assets':assets,'apis':apis,'ddl':ddl,'toolArtifacts':[tool],'evidence':evidence,'checks':checks,'htmls':htmls,'builtRootPublicEvidenceOnly':[],'guard':{k:True for k in ('actualChecksPassed','sourceStable','isolatedNoEnvFiles','networkBlockedInTests','oldHtmlOtherBytesPreserved','oldAssetsNeverDeleted')}}
    m['guard'].update({k:False for k in ('productionDeploymentPerformed','productionBrowserVerified','databaseTestsPassed')});write(root,'manifest.json',jb(m));return m
class Safety(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='round3-SYNTHETIC-');self.root=Path(self.tmp.name)
        config=copy.deepcopy(p.CONFIG);config['projection'].update(status='ready',dbEnvKey='DATABASE_URL',runnerArgs=['--apply']);self.cfg=patch.object(p,'CONFIG',config);self.cfg.start();self.addCleanup(self.cfg.stop)
        self.m=fixture(self.root)
    def tearDown(self):self.tmp.cleanup()
    def rewrite(self):write(self.root,'manifest.json',jb(self.m))
    def test_offline_validates_both_html_no_runtime_or_network(self):
        with patch.object(p,'helper',side_effect=AssertionError('PM2 forbidden')),patch.object(p.urllib.request,'urlopen',side_effect=AssertionError('network forbidden')):m,mb,candidate,old=p.validate_package(self.root)
        for side in old:self.assertEqual(p.digest(old[side]),p.BASELINE[side+'-index.html'])
        self.assertTrue(m['syntheticFixture'])
    def test_default_plan_and_local_verify_never_runtime(self):
        for flag in ('--plan','--verify-local'):
            with patch('sys.argv',['publish.py','--package',str(self.root),flag]),patch.object(p,'helper',side_effect=AssertionError('PM2 forbidden')),contextlib.redirect_stdout(io.StringIO()) as output:p.main()
            self.assertFalse(json.loads(output.getvalue())['productionAccessPerformed'])
    def test_source_at_patch_paths_but_artifact_paths_strict(self):
        self.assertEqual(p.safe_source_relative('patches/wouter@3.7.1.patch'),'patches/wouter@3.7.1.patch')
        for n in ('assets/a@b.js','../bad','/absolute','a//b','a/../b','a/./b','a?x','a\n'):
            with self.assertRaises(p.Stop):p.safe_relative(n)
        for n in ('../a@b','a/../b@c','a//b@c'):
            with self.assertRaises(p.Stop):p.safe_source_relative(n)
    def test_all_artifact_and_actual_log_tamper_rejected(self):
        for a in [self.m['assets'][0],self.m['apis'][0],self.m['ddl'][0],self.m['htmls']['front'],next(x for x in self.m['evidence'] if x['path']=='evidence/front-tsc.log')]:
            path=self.root/a['path'];old=path.read_bytes();path.write_bytes(b'tampered')
            with self.assertRaises(p.Stop):p.validate_package(self.root)
            path.write_bytes(old)
    def test_any_non_graph_html_change_rejected_even_rehashed(self):
        for side in ('admin','front'):
            a=self.m['htmls'][side];text=(self.root/a['path']).read_text();self.m['htmls'][side]=write(self.root,a['path'],text+'unrelated inline change');self.rewrite()
            with self.assertRaises(p.Stop):p.validate_package(self.root)
            self.m['htmls'][side]=write(self.root,a['path'],text);self.rewrite()
    def test_namespace_side_identity_and_eight_commands_fail_closed(self):
        self.m['namespaces']['front']=self.m['namespaces']['admin'];self.rewrite()
        with self.assertRaises(p.Stop):p.validate_package(self.root)
    def test_pending_projection_not_implicitly_approved(self):
        self.m['projection']={**self.m['projection'],'status':'pending'};self.rewrite()
        with self.assertRaises(p.Stop):p.validate_package(self.root)
    def test_ddl_never_admin_archives(self):
        self.m['ddl'][0]['path']='admin/scripts/apply-admin-staff-archives.mjs';self.rewrite()
        with self.assertRaises(p.Stop):p.validate_package(self.root)
    def test_guard_and_false_production_claims_required(self):
        for key in ('productionDeploymentPerformed','productionBrowserVerified','databaseTestsPassed'):
            self.m['guard'][key]=True;self.rewrite()
            with self.assertRaises(p.Stop):p.validate_package(self.root)
            self.m['guard'][key]=False
    def test_synthetic_cannot_apply_even_with_authorization(self):
        for authorized in (False,True):
            with patch.object(p,'processes',side_effect=AssertionError('PM2 forbidden')),self.assertRaises(p.Stop):p.mutate(argparse.Namespace(authorize_production=authorized),self.root,self.m,b'',{}, {})
    def test_phase_order_preserves_schema_front_admin_static_last(self):
        self.assertEqual(p.phase_for('migrate'),('prepared','schema_ready'));self.assertEqual(p.phase_for('activate','front'),('schema_ready','front_active'));self.assertEqual(p.phase_for('activate','admin'),('front_active','admin_active'));self.assertEqual(p.phase_for('static'),('admin_active','static_active'))
    def test_immutable_no_overwrite_and_regular_symlink_ancestors(self):
        source=self.root/'source';source.write_bytes(b'one');dest=self.root/'dest';p.immutable(source,dest,p.sha(source));p.immutable(source,dest,p.sha(source));source.write_bytes(b'two')
        with self.assertRaises(p.Stop):p.immutable(source,dest,p.sha(source))
        link=self.root/'link';link.symlink_to(dest)
        with self.assertRaises(p.Stop):p.regular(self.root,'link')
        directory=self.root/'linked';directory.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(p.Stop):p.regular(self.root,'linked/dest')
        p.atomic(dest,b'new');self.assertEqual(dest.read_bytes(),b'new')
    def test_parent_approval_manifest_and_exact_ddl_hash_bound(self):
        write(self.root,'qa-approval.json',(TOOLS/'qa-approval.expected.json').read_bytes())
        with self.assertRaises(p.Stop):p.approval(self.root,p.sha(self.root/'manifest.json'),self.m)
    def test_network_nonce_identity_exact_hash_all_assets_concurrency_8(self):
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):return b'synthetic'
        with patch.object(p.urllib.request,'urlopen',return_value=Response()) as request:p.verify_http('http://synthetic.invalid/asset.js',p.digest(b'synthetic'),'a'*32)
        req=request.call_args.args[0];self.assertIn('_round3='+'a'*32,req.full_url);self.assertEqual(req.get_header('Accept-encoding'),'identity')
        active=0;peak=0;seen=[];lock=threading.Lock()
        def verify(url,h,nonce):
            nonlocal active,peak
            with lock:active+=1;peak=max(active,peak)
            time.sleep(.001)
            with lock:seen.append((url,h,nonce));active-=1
        assets=[{'side':'front','publicPath':'assets/synthetic/'+str(i)+'.js','sha256':p.digest(str(i).encode())} for i in range(100)]
        with patch.object(p,'verify_http',side_effect=verify):p.verify_assets_http({'assets':assets},('http://synthetic-a.invalid','http://synthetic-b.invalid'),side='front')
        self.assertEqual(len(seen),200);self.assertLessEqual(peak,8);self.assertEqual(len({x[2] for x in seen}),1)
    def test_asset_failure_not_sampled_or_suppressed(self):
        seen=[]
        def verify(url,h,nonce):
            seen.append(url)
            if url.endswith('/bad.js'):raise p.Stop('synthetic mismatch')
        assets=[{'side':'front','publicPath':'assets/synthetic/'+n,'sha256':'a'*64} for n in ('one.js','bad.js','last.js')]
        with patch.object(p,'verify_http',side_effect=verify),self.assertRaises(p.Stop):p.verify_assets_http({'assets':assets},('http://synthetic.invalid',),side='front')
        self.assertEqual(len(seen),3)
    def test_dual_public_fingerprint_ignores_only_this_namespace_and_root_html(self):
        admin=self.root/'admin-public';front=self.root/'front-public'
        for root in (admin,front):write(root,'index.html',b'old');write(root,'assets/old.js',b'old');write(root,'logo.svg',b'original')
        with patch.object(p,'PUBLIC',admin),patch.object(p,'MAIN_PUBLIC',front):
            for root,side in ((admin,'admin'),(front,'front')):
                ns=self.m['namespaces'][side];before=p.fingerprint(root,ns);write(root,'assets/'+ns+'/new.js',b'new');p.atomic(root/'index.html',b'new html');self.assertEqual(p.fingerprint(root,ns),before);write(root,'logo.svg',b'changed');self.assertNotEqual(p.fingerprint(root,ns),before)
    def test_built_root_public_difference_reports_without_overwriting_logo(self):
        public=self.root/'public';write(public,'logo.svg',b'original');self.m['builtRootPublicEvidenceOnly']=[{'side':'front','path':'logo.svg','sha256':p.digest(b'new')}]
        with patch.object(p,'MAIN_PUBLIC',public),self.assertRaises(p.Stop):p.built_public_report(self.root,self.m)
        self.assertEqual((public/'logo.svg').read_bytes(),b'original');self.assertFalse(json.loads((self.root/'built-root-public-differences.json').read_bytes())['rootFilesCopied'])
    def lifecycle(self,fail=None,foreign_owner=False):
        # All server paths/PM2/HTTP are private synthetic fixtures; real guard is retained.
        self.m.pop('syntheticFixture');self.rewrite();admin=self.root/'server-admin-public';front=self.root/'server-front-public';old=self.root/'server-old';release=self.root/'server-release';coord=self.root/'server-coord.json';nginx=self.root/'server-nginx.conf'
        for side,root in (('admin',admin),('front',front)):write(root,'index.html',(BASE/(side+'-index.html')).read_bytes());write(root,'assets/old.js',b'original assets');write(root,'logo.svg',b'original logo')
        nginx.write_bytes(b'original nginx');ps=[]
        for side,(name,ids) in p.TARGETS.items():
            write(old,side+'/dist/index.js',b'original executable '+side.encode());write(old,side+'/dist/helper.js',b'original companion');write(old,side+'/package.json',b'{}');(old/side/'deps').mkdir();(old/side/'node_modules').symlink_to(old/side/'deps',target_is_directory=True);(old/side/'dist/public').symlink_to(admin if side=='admin' else front,target_is_directory=True)
            for id in ids:ps.append({'id':id,'name':name,'pid':id+1000,'script':str(old/side/'dist/index.js'),'sha256':p.sha(old/side/'dist/index.js'),'cwd':'/synthetic/'+side,'status':'online','restarts':0,'envHash':'hash-only','configHash':'hash-only'})
        holder={'processes':ps,'persistence':{'ecosystem':{'sha256':{'three-opaque-configs':'hash'},'semanticSha256':'stable','configs':[]},'bootAuthority':{'kind':'pm2-resurrect','dumpPath':'/root/.pm2/dump.pm2'},'dump':{'scripts':{s:[str(old/s/'dist/index.js')]*len(ids) for s,(_,ids) in p.TARGETS.items()},'semanticSha256':'all-ENV-config-stable'}}}
        qa={'manifestSha256':p.sha(self.root/'manifest.json'),'uiEvidenceScope':'authorized-react-fixture','productionBrowserVerified':False,'ddlArtifactHashes':{a['path']:a['sha256'] for a in self.m['ddl']},**{k:True for k in ('frozenSourceReviewed','isolatedAuthorizedUiQaPassed','serverApiCompatibilityPassed','ddlReviewApproved')}};write(self.root,'qa-approval.json',jb(qa));write(self.root,coord.name,jb({'shared_release_active':foreign_owner,'admin_round3_owner':'other' if foreign_owner else None,'admin_round2_owner':'round2-owner-preserved'}))
        def protected(_):return {str(x):p.sha(x) for x in (nginx,old/'front/dist/index.js',old/'admin/dist/index.js')}
        captured={'processes':ps,'beforePersistence':copy.deepcopy(holder['persistence']),'coordination':json.loads(coord.read_bytes()),'protectedFiles':protected(ps)}
        calls=[]
        def helper(package,name,args):
            calls.append((name,list(args)))
            if name=='migrate-sidecar.mjs':return {'ok':True,'businessDataWrites':False,'existingTablesChanged':False,'tables':self.m['projection']['tables']}
            if '--boot-check' in args:return holder['persistence']
            if name=='reload-target.mjs':
                side=args[args.index('--side')+1];rows=copy.deepcopy(holder['processes'])
                for row in rows:
                    if row['id'] in p.TARGETS[side][1]:row.update(script=str(release/side/'dist/index.js'),sha256=p.sha(release/side/'dist/index.js'),pid=row['pid']+1,restarts=row['restarts']+1)
                holder['processes']=rows;return {'side':side,'processes':rows,'targetedSequentialReload':True,'environmentRetained':True}
            if '--save' in args:
                if fail=='save':raise p.Stop('synthetic dump save failure')
                side=args[args.index('--side')+1];holder['persistence']=copy.deepcopy(holder['persistence']);holder['persistence']['dump']['scripts'][side]=[str(release/side/'dist/index.js')]*len(p.TARGETS[side][1]);return holder['persistence']
            raise AssertionError('unexpected helper')
        def http(url,h=None,nonce=None):
            if fail=='front-static' and url=='http://127.0.0.1:3000/' and h==self.m['htmls']['front']['sha256']:raise p.Stop('synthetic front root hash failure')
        a=argparse.Namespace(authorize_production=True,prepare=True,migrate=False,activate=False,static=False,rollback_html=False,target=None)
        candidate={s:(self.root/v['path']).read_bytes() for s,v in self.m['htmls'].items()};before={s:(BASE/(s+'-index.html')).read_bytes() for s in candidate};mb=(self.root/'manifest.json').read_bytes()
        with contextlib.ExitStack() as stack:
            for key,value in [('PACKAGE',self.root),('RELEASE',release),('OLD',old),('PUBLIC',admin),('MAIN_PUBLIC',front),('HTMLS',{'admin':admin/'index.html','front':front/'index.html'}),('LOCK',self.root/'server-lock'),('COORD',coord),('__file__',str(self.root/'tools/publish.py'))]:stack.enter_context(patch.object(p,key,value))
            stack.enter_context(patch.object(p,'baseline_check'));stack.enter_context(patch.object(p,'protected_files',side_effect=protected));stack.enter_context(patch.object(p,'processes',side_effect=lambda _:holder['processes']));stack.enter_context(patch.object(p,'persistence',side_effect=lambda _:holder['persistence']));stack.enter_context(patch.object(p,'helper',side_effect=helper));stack.enter_context(patch.object(p,'health'));stack.enter_context(patch.object(p,'verify_http',side_effect=http));stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            original_regular=p.regular
            class Bytes:
                def read_bytes(self):return jb(captured)
            stack.enter_context(patch.object(p,'regular',side_effect=lambda root,n:Bytes() if Path(root)==self.root and n=='evidence/processes-baseline.json' else original_regular(root,n)))
            # Real package validator consumes hash-bound real baseline; runtime comparison consumes synthetic wrapper only.
            realvalidate=p.validate_package
            def validate(package):
                with patch.object(p,'regular',side_effect=original_regular):return realvalidate(package)
            stack.enter_context(patch.object(p,'validate_package',side_effect=validate))
            if foreign_owner:
                with self.assertRaises(p.Stop):p.mutate(a,self.root,self.m,mb,candidate,before)
                self.assertEqual(json.loads(coord.read_bytes())['admin_round3_owner'],'other');self.assertFalse((self.root/'state.json').exists());return
            p.mutate(a,self.root,self.m,mb,candidate,before);self.assertEqual(json.loads((self.root/'state.json').read_bytes())['phase'],'prepared');self.assertTrue((release/'front/dist/index.js').is_file());self.assertTrue((release/'front/dist/helper.js').is_symlink());self.assertEqual((release/'front/dist/public').resolve(),front)
            a.prepare=False;a.migrate=True;p.mutate(a,self.root,self.m,mb,candidate,before);self.assertTrue(json.loads((self.root/'state.json').read_bytes())['schemaCreated']);a.migrate=False;a.activate=True
            if fail=='save':
                a.target='front'
                with self.assertRaises(p.Stop):p.mutate(a,self.root,self.m,mb,candidate,before)
            else:
                for side in ('front','admin'):
                    a.target=side;p.mutate(a,self.root,self.m,mb,candidate,before)
                    if side=='front':self.assertEqual(holder['persistence']['dump']['scripts']['admin'],[str(old/'admin/dist/index.js')]*2)
                a.activate=False;a.target=None;a.static=True
                if fail:
                    with self.assertRaises(p.Stop):p.mutate(a,self.root,self.m,mb,candidate,before)
                else:
                    p.mutate(a,self.root,self.m,mb,candidate,before);p.guard(self.root,self.m,json.loads((self.root/'state.json').read_bytes()))
                    # Completed phase validates only; no replay and no mutation.
                    with patch.object(p,'atomic',side_effect=AssertionError('replay forbidden')):p.mutate(a,self.root,self.m,mb,candidate,before)
            state=json.loads((self.root/'state.json').read_bytes());coordination=json.loads(coord.read_bytes());self.assertEqual(coordination['admin_round2_owner'],'round2-owner-preserved')
            if fail:
                self.assertEqual(state['phase'],'stopped');self.assertTrue(state['newApisRetained']);self.assertTrue(coordination['shared_release_active']);self.assertEqual(state['observedProcesses'],holder['processes'])
                for side,root in (('admin',admin),('front',front)):self.assertEqual((root/'index.html').read_bytes(),before[side])
                if fail=='front-static':self.assertEqual(state['htmlAppliedSides'],['admin','front']);self.assertEqual(state['htmlRolledBackSides'],['admin','front'])
                self.assertIn(str(release/'front/dist/index.js'),[x['script'] for x in holder['processes']])
            else:
                self.assertEqual(state['phase'],'static_active');self.assertEqual(state['activatedSides'],['front','admin']);self.assertEqual(state['htmlAppliedSides'],['admin','front']);self.assertFalse(coordination['shared_release_active'])
                for side,root in (('admin',admin),('front',front)):self.assertEqual((root/'index.html').read_bytes(),candidate[side]);self.assertEqual((root/'assets/old.js').read_bytes(),b'original assets');self.assertEqual((root/'logo.svg').read_bytes(),b'original logo')
            self.assertEqual(nginx.read_bytes(),b'original nginx');self.assertEqual((old/'front/dist/index.js').read_bytes(),b'original executable front')
    def test_full_prepare_schema_front_admin_then_dual_static_real_guard(self):self.lifecycle()
    def test_partial_save_failure_retains_new_api_and_shared_active(self):self.lifecycle('save')
    def test_front_static_failure_restores_only_two_html_retains_new_apis(self):self.lifecycle('front-static')
    def test_foreign_coord_owner_never_overwritten(self):self.lifecycle(foreign_owner=True)
if __name__=='__main__':unittest.main(verbosity=2)
