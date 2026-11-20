#!/usr/bin/env python3
"""Isolated synthetic unit tests, NOT a production/full-builder release test.
No capture() invocation. All mutable fixtures live in a unique TemporaryDirectory.
Production subprocess, HTTP and RPC adapters are blocked/replaced before use.
Run: PYTHONDONTWRITEBYTECODE=1 python3 -B test_release.py -v
"""
import base64
import copy
import datetime as dt
import fcntl
import importlib.util
import json
import time
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from dataclasses import replace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('customer_batch_release_offline', Path(__file__).with_name('release.py'))
r = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = r
SPEC.loader.exec_module(r)


class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='customer-batch-isolated-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.cfg = r.Config(public=self.root/'admin-public',
            front_api=self.root/'release/front/dist/index.js', admin_api=self.root/'release/admin/dist/index.js',
            coord=self.root/'ops/coord.json', stage=self.root/'ops/fresh-test-stage',
            locks=(self.root/'locks/public.lock', self.root/'locks/code.lock'),
            nginx=self.root/'nginx', ops=self.root/'ops', proc=self.root/'proc',
            pm2_home=self.root/'pm2-home', pm2_base=self.root/'pm2-base', node=self.root/'node',
            extra_protected=(), mock=True)
        for p in [self.cfg.public/'assets', self.root/'front-public/assets', self.cfg.stage, self.cfg.package,
                  self.cfg.nginx, self.cfg.pm2_home, self.cfg.pm2_base, self.root/'locks', self.cfg.proc,
                  self.cfg.front_api.parent, self.cfg.admin_api.parent]:
            p.mkdir(parents=True, exist_ok=True)
        self.cfg.stage.chmod(0o700)
        self.cfg.package.chmod(0o700)
        for p in self.cfg.locks:
            p.write_bytes(b'preexisting-test-lock\n')
        self.cfg.front_alias.symlink_to(self.root/'front-public', target_is_directory=True)
        (self.cfg.admin_api.parent/'public').symlink_to(self.cfg.public, target_is_directory=True)
        for n in ('forumPdfScanWorker.mjs','marketSnapshotRefresh.js','publicHotSnapshotRefresh.js',
                  'recommendationValueRefresh.js','server'):
            target = self.root/('alias-target-'+n)
            if n == 'server':
                target.mkdir(); (target/'helper.mjs').write_bytes(b'untouched server helper')
            else:
                target.write_bytes(b'untouched worker helper')
            (self.cfg.front_api.parent/n).symlink_to(target, target_is_directory=n == 'server')
        (self.cfg.front/'index.html').write_bytes(b'front static must remain unchanged')
        (self.cfg.public/'favicon.ico').write_bytes(b'untouched favicon')
        (self.cfg.nginx/'nginx.conf').write_bytes(b'synthetic nginx bytes')
        self.cfg.node.write_bytes(b'synthetic node pin')
        (self.cfg.pm2_base/'adapter.js').write_bytes(b'synthetic existing adapter')
        (self.cfg.pm2_home/'dump.pm2').write_bytes(b'opaque synthetic dump')
        (self.cfg.pm2_home/'pm2.pid').write_bytes(b'999999\n')
        (self.cfg.ops/'official-test.json').write_bytes(b'{"original":true}\n')
        self.original_coord = dict(shared_release_active=False, updated_at='original',
            window=dict(owner_task='FOREIGN-CLOSED', scope='foreign-closed-scope', status='verified',
                        needsOperatorRecovery=False, closedAtUtc='2026-11-19T00:00:00+00:00', ownerNonce='opaque==signed'),
            window_history=[dict(owner_task='FOREIGN-HISTORY', scope='foreign-history-scope', status='failed',
                                 ownerNonce='signed==opaque-history', protectedFiles=17)],
            opaque_foreign=dict(signed='preserve===', failures=['historic failure']))
        self.cfg.coord.write_bytes(r.encode(self.original_coord))
        self.raw_rows = []
        for i in range(12):
            own = i < 6
            name = 'dianzi51' if i < 4 else 'dianzi51-admin' if i < 6 else 'worker-'+str(i)
            script = self.cfg.front_api if i < 4 else self.cfg.admin_api if i < 6 else self.root/f'workers/w{i}/dist/index.js'
            script.parent.mkdir(parents=True, exist_ok=True)
            if not script.exists():
                script.write_bytes(b'untouched worker executable')
            pid = 30000+i
            proc = self.cfg.proc/str(pid)
            proc.mkdir()
            env = dict(CUSTOM_VALUE='synthetic-only', NODE_UNIQUE_ID='nested-must-stay', pid='app-value')
            e = dict(status='online', name=name, pm_id=i, pm_exec_path=str(script),
                pm_cwd=str(script.parent.parent), exec_mode='cluster_mode' if own else 'fork_mode',
                restart_time=0, PORT='5100' if i < 4 else '5200' if own else None,
                env=env, NODE_APP_INSTANCE=str(i), NODE_CHANNEL_FD='3',
                autostart=True, pm_uptime=1000000, created_at=900000, unstable_restarts=0,
                prev_restart_delay=0, axm_actions=[], axm_monitor={}, axm_options={}, axm_dynamic={},
                vizion_running=False, _pm2_version='7.0.3')
            e.update(env)
            serialized = json.dumps(dict(e, status='launching'), ensure_ascii=False, separators=(',', ':')).encode()
            raw = b'ROLE='+name.encode()+b'\0NODE_APP_INSTANCE='+str(i).encode()+b'\0NODE_CHANNEL_FD=3\0'
            raw += b'CUSTOM_VALUE=synthetic-only\0pm_uptime=application-value\0'
            raw += b'pm2_env='+serialized+b'\0'
            if own:
                raw += b'NODE_UNIQUE_ID='+str(i+10).encode()+b'\0'
            (proc/'environ').write_bytes(raw)
            (proc/'status').write_bytes(b'Uid:\t1000 1000 1000 1000\nGid:\t1000 1000 1000 1000\nGroups:\t1000\nUmask:\t0022\n')
            self.raw_rows.append(dict(pm_id=i, name=name, pid=pid, pm2_env=e))
        self.tr = dict(mockTransport=True, rpcSourceSha256=r.H(r.RPC.encode()))
        self.reload_calls = []
        for target, name in [(r.subprocess,'run'), (r.http.client,'HTTPConnection'), (r,'production_reload')]:
            guard = patch.object(target, name, side_effect=AssertionError('PRODUCTION_ADAPTER_FORBIDDEN'))
            guard.start(); self.addCleanup(guard.stop)
        rpc_mock = patch.object(r, 'rpc', side_effect=lambda *_: copy.deepcopy(self.raw_rows))
        rpc_mock.start(); self.addCleanup(rpc_mock.stop)
        self.controller = r.Controller(self.cfg, row_reader=r.snapshot_rows,
            transport_reader=lambda _: copy.deepcopy(self.tr), reload_adapter=self.simulate_reload,
            get_reader=self.static_get, listener_reader=self.local_listener)
        self.make_synthetic_package()  # manually constructs synthetic capture; no capture() call

    def static_get(self, cfg, host, relative):
        root = cfg.public if host == 'admin.51dianzi.com' else cfg.front
        return (root/(relative or 'index.html')).read_bytes()

    def local_listener(self, cfg, row, expected):
        root = cfg.public if row['name'] == 'dianzi51-admin' else cfg.front
        return r.H((root/'index.html').read_bytes()) == expected

    def simulate_reload(self, cfg, tr, before):
        self.reload_calls.append(before['id'])
        row = next(v for v in self.raw_rows if v['pm_id'] == before['id'])
        oldpid = row['pid']; newpid = oldpid+1000
        old = cfg.proc/str(oldpid); new = cfg.proc/str(newpid)
        new.mkdir()
        raw = (old/'environ').read_bytes()
        raw = raw.replace(b'NODE_UNIQUE_ID='+str(before['nodeUniqueId']).encode()+b'\0',
                          b'NODE_UNIQUE_ID='+str(before['nodeUniqueId']+100).encode()+b'\0')
        time.sleep(0.002)  # deterministic distinct millis, no production timer/budget change
        stamp = int(dt.datetime.now(dt.timezone.utc).timestamp()*1000)
        old_serialized = r.raw_values(raw)[b'pm2_env']
        serialized = r.decode(old_serialized)
        serialized.update(pm_uptime=stamp, created_at=stamp,
                          restart_time=before['restarts']+1, unstable_restarts=0, prev_restart_delay=0)
        raw = raw.replace(b'pm2_env='+old_serialized+b'\0',
                          b'pm2_env='+json.dumps(serialized, ensure_ascii=False, separators=(',', ':')).encode()+b'\0')
        (new/'environ').write_bytes(raw)
        (new/'status').write_bytes((old/'status').read_bytes())
        row['pid'] = newpid
        row['pm2_env'].update({k: serialized[k] for k in r.PM2_RAW_GENERATED})

    def api_fixture(self, kind):
        chunks = [b'// synthetic baseline, unchanged bytes '+b'x'*1200+b'\n']
        patches = []
        old_pos = new_pos = len(chunks[0]); new_chunks = list(chunks)
        source = dict(sourceFile='fixture.js', sourceSha256=r.H(b'synthetic source binding\n'),
                      composition='exact bundled exports bound once; no alternate native identity')
        for i, name in enumerate(sorted(r.API_PATCH_NAMES[kind])):
            old = ('const slot%d="old";\n' % i).encode()
            new = ('const slot%d="new";\n' % i).encode()
            patches.append(dict(name=name, start=old_pos, end=old_pos+len(old), newStart=new_pos,
                newEnd=new_pos+len(new), oldByteStart=old_pos, oldByteEnd=old_pos+len(old),
                newByteStart=new_pos, newByteEnd=new_pos+len(new), oldSha256=r.H(old), newSha256=r.H(new),
                oldText=old.decode(), newText=new.decode(), source=copy.deepcopy(source)))
            chunks.append(old); new_chunks.append(new); old_pos += len(old); new_pos += len(new)
        before, after = b''.join(chunks), b''.join(new_chunks)
        record = dict(format='customer-batch-native-patches-v1',
            baseline=dict(sha256=r.H(before), bytes=len(before), capturedPath='synthetic-only', productionPath=str(self.cfg.apis[kind])),
            candidate=dict(sha256=r.H(after), bytes=len(after)), patches=patches,
            inverse=dict(byteExact=True, sha256=r.H(before), unchangedBytes=len(chunks[0]), allOutsideSlotsByteIdentical=True),
            importsAllByteIdentical=True, nonTargetDeclarationsAllByteIdentical=True,
            nonTargetDeclarationCount=1, nonTargetDeclarationDigest=r.H(chunks[0]), strictNewIdentifiersResolved=True,
            entrypointExecuted=False, actualDatabaseAccess=False)
        return before, after, r.encode(record)

    def ui_fixture(self, old_name):
        old_chunks, new_chunks, patches = [], [], []
        old_pos = new_pos = 0
        for leaf in sorted(r.LEAVES):
            native = leaf.split('/')[0]
            old = ('function '+native+'(x){return "old";}\n').encode()
            marker = '/* __customerBatchFailures CustomerUploadFailuresDialog */' if native == 'z3' else ''
            new = ('function '+native+'(x){'+marker+'return "new";}\n').encode()
            patches.append(dict(name=leaf, oldStart=old_pos, oldEnd=old_pos+len(old), newStart=new_pos,
                newEnd=new_pos+len(new), oldSha256=r.H(old), newSha256=r.H(new),
                oldBase64=base64.b64encode(old).decode(), newBase64=base64.b64encode(new).decode()))
            old_chunks.append(old); new_chunks.append(new); old_pos += len(old); new_pos += len(new)
        before, after = b''.join(old_chunks), b''.join(new_chunks)
        # Distinct modules with the same allowed seven synthetic wrappers.
        after += ('// '+old_name+'\n').encode()
        before += ('// '+old_name+'\n').encode()
        new_name = 'assets/BusinessWorkbenchPage-customer-batch-'+r.H(after)[:16]+'.js'
        delta = dict(input=old_name, output=new_name, beforeSha256=r.H(before), afterSha256=r.H(after),
            patches=patches, inverseVerified=True, allBytesOutsideCustomerFunctionsUnchanged=True)
        return before, after, new_name, delta

    def make_synthetic_package(self):
        payload = {'evidence/source/fixture.js': b'synthetic source binding\n',
                   'evidence/reviewer/unit.txt': b'synthetic unit reviewer; NOT release approval\n'}
        for kind, path in self.cfg.apis.items():
            before, after, record = self.api_fixture(kind)
            path.write_bytes(before)
            payload['before-'+kind+'-api.js'] = before
            payload['after-'+kind+'-api.js'] = after
            payload[kind+'-patch-records.json'] = record
        self.assets, modules, replacements = [], [], []
        old_names = ['assets/BusinessWorkbenchPage-old-main.js','assets/BusinessWorkbenchPage-old-customer.js']
        self.before_html = ('<html><head>\n<script src="/'+old_names[0]+'"></script>\n<script src="/'+old_names[1]+
                            '"></script>\n</head><body>unchanged</body></html>\n').encode()
        self.cfg.html.write_bytes(self.before_html)
        after_html = self.before_html
        counts = {}
        for old in old_names:
            before, after, new, delta = self.ui_fixture(old)
            (self.cfg.public/old).write_bytes(before)
            payload[new] = after
            payload['evidence/baseline/'+old] = before
            payload['evidence/'+Path(old).name+'.delta.json'] = r.encode(delta)
            payload['evidence/'+Path(old).name+'.abi.json'] = b'{"syntheticABI":true}\n'
            self.assets.append(dict(relative=new, sha256=r.H(after), size=len(after)))
            modules.append(dict(before=old, after=new, sha256=r.H(after), size=len(after)))
            replacements.append(dict(before='/'+old, after='/'+new))
            counts['/'+old] = self.before_html.count(('/'+old).encode())
            after_html = after_html.replace(('/'+old).encode(), ('/'+new).encode())
        css = b'.customer-upload-history .row{display:block}\n'
        css_name = 'assets/customer-batch-actions-'+r.H(css)[:16]+'.css'
        payload[css_name] = css
        self.assets.append(dict(relative=css_name, sha256=r.H(css), size=len(css)))
        link = '<link rel="stylesheet" href="/'+css_name+'">\n'
        after_html = after_html.replace(b'</head>', link.encode()+b'</head>')
        payload.update({'before-index.html':self.before_html, 'after-index.html':after_html,
            'evidence/html.json':r.encode(dict(beforeSha256=r.H(self.before_html), afterSha256=r.H(after_html),
                counts=counts, link=link, inverseVerified=True))})
        sh = {'fixture.js':r.H(payload['evidence/source/fixture.js'])}
        payload['evidence/source-files.json'] = r.encode(dict(sourceHashes=sh, sourceStableDuringBuild=True,
            embeddedFailuresIncluded=True, compiler='esbuild.transform', esbuildVersion='synthetic', builderSha256=sh['fixture.js']))
        payload['evidence/sources.json'] = r.encode([dict(file='fixture.js', native=n.split('/')[0],
            name=n.split('/')[1], sourceSha256=sh['fixture.js'], compiledSha256=r.H(n.encode())) for n in sorted(r.LEAVES)])
        raw = self.cfg.coord.read_bytes(); cr = r.describe(self.cfg.coord)
        rows = self.controller.row_reader(self.cfg, self.tr)
        paths, links = r.union(self.cfg, r.coord_closed(raw))
        inventory = r.inventory(self.cfg, rows, paths, links)
        self.cap = dict(schema='customer-batch-capture-v1', ownerTask=r.OWNER, scope=r.SCOPE,
            nonce='1234567890abcdef1234567890abcdef', capturedAtUtc=r.now(), ttlSeconds=r.TTL,
            controllerSha256=self.controller.hash, config=r.config_binding(self.cfg),
            coordBase64=base64.b64encode(raw).decode(), coordRecord=cr,
            protectedFiles=inventory, processes=rows, transport=self.tr,
            protectionUnion=dict(paths=[str(p) for p in paths], links={str(a):str(t) for a,t in links.items()}),
            environmentValuesExported=False, productionWrites=0, canonicalMetadataSha256=r.H(r.encode(inventory)))
        payload['capture.json'] = r.encode(self.cap)
        self.payload = payload
        self.m = dict(schema='customer-batch-sealed-manifest-v1', ownerTask=r.OWNER, scope=r.SCOPE,
            ownerNonce='synthetic-owner-nonce-at-least-16', nonce=self.cap['nonce'], controllerSha256=self.controller.hash,
            captureSha256=r.H(payload['capture.json']), packageFiles={n:r.file_pin(b) for n,b in payload.items()},
            sourceHashes=sh, assets=self.assets, replacements=replacements, cssRelative=css_name, modules=modules)
        for n, data in payload.items():
            p = self.cfg.package/n
            p.parent.mkdir(parents=True, exist_ok=True)
            for parent in p.parents:
                if parent == self.cfg.package or self.cfg.package in parent.parents:
                    parent.chmod(0o700)
            p.write_bytes(data); p.chmod(0o600)
        self.repin()

    def repin(self):
        mb = r.encode(self.m)
        (self.cfg.package/'manifest.json').write_bytes(mb); (self.cfg.package/'manifest.json').chmod(0o600)
        self.ms = r.H(mb)
        self.review = dict(schema='customer-batch-independent-review-v1', status='passed', independent=True,
            releaseApproved=True, ownerTask=r.OWNER, scope=r.SCOPE, reviewerScope='independent-synthetic-unit',
            reviewerHash=self.m['packageFiles']['evidence/reviewer/unit.txt']['sha256'], bindings=r.manifest_bindings(self.m,self.ms))
        rb = r.encode(self.review)
        (self.cfg.package/'review.json').write_bytes(rb); (self.cfg.package/'review.json').chmod(0o600)
        self.rs = r.H(rb)

    def preflight(self):
        return self.controller.preflight(self.cfg.package, self.ms, self.rs)

    def prepare_state(self, require_fresh=True):
        self.controller.b = self.controller.bundle(self.cfg.package, self.ms, self.rs, require_fresh=require_fresh)
        self.cfg.receipt.mkdir(mode=0o700)
        c = self.controller
        c.st = dict(**{k:copy.deepcopy(self.cap[k]) for k in ('processes','protectedFiles','transport')},
            coordBase64=self.cap['coordBase64'], coordRecord=self.cap['coordRecord'],
            targets=dict(front='before',admin='before',html='before'), assets=[],loadedSlots=[],events=[])
        attempt = dict(schema='customer-batch-attempt-v1', **c.common(), startedAtUtc=r.now(), reloadScope=c.b['ids'],
            originalCoordSha256=r.H(c.b['coord']), canonicalMetadataSha256=self.cap['canonicalMetadataSha256'])
        raw = r.encode(attempt); r.exclusive(self.cfg.receipt/'attempt.json', raw); c.attempt_hash = r.H(raw)
        c.checkpoint('attempt-before-production-write')
        return c

    def open_window(self, c):
        coord = copy.deepcopy(self.original_coord)
        coord['window_history'].append(copy.deepcopy(coord['window']))
        coord['window'] = dict(owner_task=r.OWNER,scope=r.SCOPE,nonce=c.b['m']['nonce'],ownerNonce=c.b['m']['ownerNonce'],
            manifestSha256=self.ms,controllerSha256=c.hash,reviewSha256=self.rs,captureSha256=c.b['m']['captureSha256'],
            attemptSha256=c.attempt_hash,reloadScope=c.b['ids'],status='open',needsOperatorRecovery=False,openedAtUtc=r.now())
        coord['shared_release_active'] = True
        c.change_coord(r.encode(coord),'open-own-attempt')

    def test_new_identity_and_fixed_boundary(self):
        cfg = r.Config()
        self.assertEqual(r.OWNER, '6Lfttf6oVWJ8YS69o5FkXQ')
        self.assertEqual(str(cfg.stage), '/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R3')
        self.assertEqual(len(cfg.aliases), 7)
        self.assertEqual(r.identity(self.cfg,self.cap['processes']), list(range(6)))
        with self.assertRaisesRegex(r.ReleaseError,'PRODUCTION_ADAPTER_INJECTION_REFUSED'):
            r.Controller(cfg, row_reader=lambda *_: [])

    def test_synthetic_sealed_bundle_validates_without_bypassing_payload(self):
        b = self.controller.bundle(self.cfg.package,self.ms,self.rs)
        self.assertEqual(len(b['ids']),6)
        self.assertEqual(len(b['m']['assets']),3)
        self.assertEqual(b['payload'],self.payload)

    def test_manifest_source_scope_and_nonce_seals(self):
        for key, value in [('ownerTask','foreign'),('scope','foreign'),('controllerSha256','0'*64),('ownerNonce','short')]:
            with self.subTest(key=key):
                old = self.m[key]; self.m[key] = value; self.repin()
                with self.assertRaisesRegex(r.ReleaseError,'MANIFEST_SCOPE_SOURCE_NONCE'):
                    self.preflight()
                self.m[key] = old; self.repin()
        self.assertFalse(self.cfg.receipt.exists())

    def test_payload_drift_and_unknown_files_are_rejected(self):
        p = self.cfg.package/'evidence/source/fixture.js'
        p.write_bytes(b'changed')
        with self.assertRaisesRegex(r.ReleaseError,'PAYLOAD_HASH_SIZE_MODE'):
            self.preflight()
        p.write_bytes(self.payload['evidence/source/fixture.js'])
        (self.cfg.package/'unexpected').write_bytes(b'unknown')
        with self.assertRaisesRegex(r.ReleaseError,'NO_UNKNOWN_PACKAGE_FILES'):
            self.preflight()

    def test_review_is_independent_manifest_and_report_bound(self):
        for key, value in [('independent',False),('releaseApproved',False),('reviewerScope',r.SCOPE),('reviewerHash','0'*64)]:
            with self.subTest(key=key):
                review = dict(self.review,**{key:value}); rb = r.encode(review)
                (self.cfg.package/'review.json').write_bytes(rb)
                with self.assertRaises(r.ReleaseError):
                    self.controller.bundle(self.cfg.package,self.ms,r.H(rb))
        self.repin()
        with self.assertRaisesRegex(r.ReleaseError,'REVIEW_PIN'):
            self.controller.bundle(self.cfg.package,self.ms,'0'*64)

    def test_raw_only_one_outer_unique_id_is_exception(self):
        raw = (self.cfg.proc/'30000/environ').read_bytes()
        changed = raw.replace(b'NODE_UNIQUE_ID=10\0',b'NODE_UNIQUE_ID=999\0')
        self.assertEqual(r.raw_semantics(raw,True),r.raw_semantics(changed,True))
        self.assertNotEqual(r.raw_semantics(raw,False),r.raw_semantics(changed,False))
        self.assertNotEqual(r.H(raw),r.H(changed))
        for before, after in [(b'NODE_APP_INSTANCE=0',b'NODE_APP_INSTANCE=1'),
                              (b'NODE_CHANNEL_FD=3',b'NODE_CHANNEL_FD=4'),
                              (b'CUSTOM_VALUE=synthetic-only',b'CUSTOM_VALUE=drift'),
                              (b'pm_uptime=application-value',b'pm_uptime=changed'),
                              (b'nested-must-stay',b'nested-changed')]:
            with self.subTest(key=before):
                self.assertNotEqual(r.raw_semantics(raw,True),r.raw_semantics(raw.replace(before,after),True))

    def test_raw_malformed_duplicate_and_nondeci_unique_refused(self):
        for raw in [b'A=1', b'A=1\0A=2\0NODE_UNIQUE_ID=1\0', b'A=1\0',
                    b'NODE_UNIQUE_ID=nondecimal\0', b'NODE_UNIQUE_ID=1\0NODE_UNIQUE_ID=2\0']:
            with self.subTest(raw=raw):
                with self.assertRaises(r.ReleaseError):
                    r.raw_semantics(raw,True)

    def test_preflight_readonly_no_attempt_no_reload_no_production_write(self):
        before = {str(p):r.describe(p) for p in [self.cfg.coord,self.cfg.html,*self.cfg.apis.values(),*self.cfg.locks]}
        with patch.object(r,'cas',side_effect=AssertionError('WRITE_FORBIDDEN')), \
             patch.object(r,'exclusive',side_effect=AssertionError('WRITE_FORBIDDEN')):
            result = self.preflight()
        self.assertEqual(result['status'],'preflight-passed')
        self.assertEqual(result['productionWrites'],0)
        self.assertEqual(self.reload_calls,[])
        self.assertFalse(self.cfg.receipt.exists())
        self.assertEqual(before,{p:r.describe(Path(p)) for p in before})

    def test_foreign_recovery_busy_rejected_without_write(self):
        state = dict(self.original_coord,shared_release_active=True,
                     window=dict(owner_task='XM2KNK1v',status='recovery-required',needsOperatorRecovery=True))
        raw = r.encode(state); self.cfg.coord.write_bytes(raw)
        # Public preflight validates the sealed baseline and refuses observed foreign raw/meta.
        with self.assertRaisesRegex(r.ReleaseError,'COORD_FULL_CAS'):
            self.preflight()
        with self.assertRaisesRegex(r.ReleaseError,'FOREIGN_OR_OPEN_WINDOW'):
            r.coord_closed(raw)
        self.assertEqual(self.cfg.coord.read_bytes(),raw)
        self.assertFalse(self.cfg.receipt.exists())
        self.assertEqual(self.reload_calls,[])

    def test_foreign_dual_lock_busy_preserves_inode_and_held_external_lock(self):
        for path in self.cfg.locks:
            with self.subTest(path=path), path.open('rb') as outside:
                fcntl.flock(outside,fcntl.LOCK_EX|fcntl.LOCK_NB)
                record = r.describe(path)
                with self.assertRaisesRegex(r.ReleaseError,'DUAL_LOCK_BUSY_NO_CLEAR'):
                    self.preflight()
                self.assertEqual(r.describe(path),record)
                with path.open('rb') as contender:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(contender,fcntl.LOCK_EX|fcntl.LOCK_NB)
                self.assertEqual(r.ACTIVE_LOCKS,[])
        self.assertFalse(self.cfg.receipt.exists())

    def test_replay_rejected_for_empty_receipt_failed_attempt_and_symlink(self):
        self.cfg.receipt.mkdir(mode=0o700)
        for method in (self.controller.preflight,self.controller.apply):
            with self.assertRaisesRegex(r.ReleaseError,'DURABLE_ATTEMPT_NO_REPLAY'):
                method(self.cfg.package,self.ms,self.rs)
        self.cfg.receipt.rmdir(); self.cfg.receipt.symlink_to(self.root/'missing')
        with self.assertRaisesRegex(r.ReleaseError,'DURABLE_ATTEMPT_NO_REPLAY'):
            self.preflight()
        self.assertEqual(self.reload_calls,[])

    def test_capture_ttl_forward_only_and_fresh_recovery_approval(self):
        c = self.prepare_state()
        c.b['c']['capturedAtUtc'] = (dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=r.TTL+1)).isoformat()
        with r.locked(self.cfg):
            c.guard()  # restoration does not depend on original capture freshness
            with self.assertRaisesRegex(r.ReleaseError,'FRESH_CAPTURE_REQUIRED'):
                c.guard(True)
            report = b'synthetic recovery reviewer\n'
            c.recovery_approval = dict(approvedAtUtc=r.now(),ttlSeconds=r.TTL,reviewerHash=r.H(report))
            raw = r.encode(c.recovery_approval)
            (self.cfg.stage/'rollback-review.json').write_bytes(raw)
            (self.cfg.stage/'rollback-reviewer-report.txt').write_bytes(report)
            c.recovery_approval_sha = r.H(raw)
            c.guard()
            for seconds in (-r.TTL-1,60):
                c.recovery_approval['approvedAtUtc'] = (dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=seconds)).isoformat()
                with self.assertRaisesRegex(r.ReleaseError,'FRESH_CAPTURE_REQUIRED'):
                    c.guard()

    def test_full_coord_close_preserves_opaque_foreign_and_all_history(self):
        c = self.prepare_state()
        with r.locked(self.cfg):
            self.open_window(c)
            prior = r.decode(self.cfg.coord.read_bytes())['window_history']
            c.close('rolled-back')
            c.guard()
        closed = r.decode(self.cfg.coord.read_bytes())
        self.assertFalse(closed['shared_release_active'])
        self.assertFalse(closed['window']['needsOperatorRecovery'])
        self.assertEqual(closed['window']['status'],'closed')
        self.assertTrue(closed['window']['closedAtUtc'])
        self.assertEqual(closed['window_history'][:-1],prior)
        self.assertEqual(closed['window_history'][-1],closed['window'])
        self.assertEqual(closed['opaque_foreign'],self.original_coord['opaque_foreign'])
        self.assertEqual(closed['window_history'][0]['ownerNonce'],'signed==opaque-history')
        self.assertEqual(r.H(self.cfg.coord.read_bytes()),c.st['coordRecord']['sha256'])

    def test_coord_missing_closed_proof_or_history_and_replay_refused(self):
        for state in [dict(self.original_coord,window=dict(self.original_coord['window'],closedAtUtc='')),
                      dict(self.original_coord,window_history=None),
                      dict(self.original_coord,window_history=[dict(scope=r.SCOPE)]),
                      dict(self.original_coord,needsOperatorRecovery=True)]:
            with self.assertRaises(r.ReleaseError):
                r.coord_closed(r.encode(state))

    def test_coord_history_protection_union_preserves_counts_and_extensions(self):
        path = self.root/'historical-protected'
        alias = self.root/'historical-alias'; target = self.root/'historical-target'
        state = copy.deepcopy(self.original_coord)
        state['window_history'].append(dict(extra_protected=[str(path)],extra_links={str(alias):str(target)}))
        paths, links = r.union(self.cfg,state)
        self.assertIn(path,paths); self.assertEqual(links[alias],target)
        state['window_history'].append(dict(extra_links={str(alias):str(self.root/'other-target')}))
        with self.assertRaisesRegex(r.ReleaseError,'CONFLICTING_COORD_LINK_TARGETS'):
            r.union(self.cfg,state)

    def test_state_invariants_refuse_foreign_fields_and_history_rewrite(self):
        c = self.prepare_state()
        with r.locked(self.cfg):
            self.open_window(c)
        for change in ('foreign','history'):
            state = copy.deepcopy(c.st); coord = r.decode(base64.b64decode(state['coordBase64']))
            if change == 'foreign':
                coord['opaque_foreign']['signed'] = 'tampered'
            else:
                coord['window_history'][0]['ownerNonce'] = 'rewritten'
            raw = r.encode(coord); state['coordBase64'] = base64.b64encode(raw).decode()
            state['coordRecord']['sha256'] = r.H(raw)
            with self.assertRaisesRegex(r.ReleaseError,'STATE_COORD_FOREIGN_FIELDS|STATE_FULL_HISTORY'):
                c.state_invariants(state)

    def test_raw_drift_without_reload_is_rejected_even_unique_exception(self):
        c = self.prepare_state()
        path = self.cfg.proc/'30000/environ'
        path.write_bytes(path.read_bytes().replace(b'NODE_UNIQUE_ID=10\0',b'NODE_UNIQUE_ID=11\0'))
        with r.locked(self.cfg), self.assertRaisesRegex(r.ReleaseError,'FULLGUARD_FOREIGN_DRIFT|OWN_NODE_UNIQUE_ID_COLLISION'):
            c.guard()

    def test_reload_single_mock_slot_accepts_unique_only_and_preserves_other_eleven(self):
        c = self.prepare_state(); original = copy.deepcopy(c.st['processes'])
        with r.locked(self.cfg):
            self.open_window(c); c.change_file('front',True,True); c.reload_one(0)
            c.state_invariants(c.st)
        self.assertEqual(c.st['loadedSlots'],[0])
        self.assertEqual(c.st['processes'][1:],original[1:])
        self.assertEqual(c.st['processes'][0]['semanticSha256'],original[0]['semanticSha256'])
        self.assertNotEqual(c.st['processes'][0]['rawSha256'],original[0]['rawSha256'])
        self.assertEqual(self.reload_calls,[0])

    def test_reload_refuses_env_permissions_and_other_slot_drift(self):
        for drift in ('NODE_APP_INSTANCE','NODE_CHANNEL_FD','CUSTOM_VALUE','permissions','other-slot'):
            with self.subTest(drift=drift):
                # Each subcase uses a genuinely separate TemporaryDirectory and controller.
                case = SafetyTests('test_new_identity_and_fixed_boundary'); case.setUp()
                try:
                    c = case.prepare_state(); base_adapter = case.simulate_reload
                    def adapter(cfg,tr,before):
                        base_adapter(cfg,tr,before)
                        pid = next(v['pid'] for v in case.raw_rows if v['pm_id'] == before['id'])
                        if drift == 'permissions':
                            path = cfg.proc/str(pid)/'status'
                            path.write_bytes(path.read_bytes().replace(b'0022',b'0077'))
                        elif drift == 'other-slot':
                            path = cfg.proc/'30011/environ'; path.write_bytes(path.read_bytes()+b'DRIFT=1\0')
                        else:
                            path = cfg.proc/str(pid)/'environ'
                            path.write_bytes(path.read_bytes().replace((drift+'=').encode(),('DRIFT_'+drift+'=').encode()))
                    c.reload_adapter = adapter
                    with r.locked(case.cfg):
                        case.open_window(c); c.change_file('front',True,True)
                        with self.assertRaisesRegex(r.ReleaseError,'NODE_PM2_ONLY_LIFECYCLE|OTHER_ELEVEN_SLOT_DRIFT'):
                            c.reload_one(0)
                finally:
                    case.doCleanups()

    def test_cas_last_race_never_overwrites_foreign_bytes(self):
        path = self.cfg.html; before = path.read_bytes(); expected = r.describe(path)
        original = r.exclusive
        def raced(p,data,*args):
            original(p,data,*args)
            if p.name.startswith('.cas-'):
                path.write_bytes(b'foreign racing bytes')
        with r.locked(self.cfg), patch.object(r,'exclusive',side_effect=raced):
            with self.assertRaisesRegex(r.ReleaseError,'LAST_FULL_CAS'):
                r.cas(path,expected,before,b'candidate',self.cfg.stage,lambda _:self.fail('should not remember'))
        self.assertEqual(path.read_bytes(),b'foreign racing bytes')
        self.assertFalse(list(self.cfg.stage.glob('.cas-*')))

    def test_cas_remember_precedes_target_dir_fsync_failure_and_is_recoverable(self):
        path = self.cfg.html; before = path.read_bytes(); record = r.describe(path); remembered = []
        original = r.fsync_dir
        def fail_parent(p):
            if p == path.parent:
                self.assertTrue(remembered)
                self.assertEqual(remembered[-1],r.describe(path))
                raise OSError('synthetic directory fsync fault')
            return original(p)
        with r.locked(self.cfg):
            with patch.object(r,'fsync_dir',side_effect=fail_parent), self.assertRaises(OSError):
                r.cas(path,record,before,b'candidate',self.cfg.stage,remembered.append)
            self.assertEqual(path.read_bytes(),b'candidate')
            r.cas(path,remembered[-1],b'candidate',before,self.cfg.stage,remembered.append)
        self.assertEqual(path.read_bytes(),before)
        self.assertEqual(stat.S_IMODE(path.stat().st_mode),stat.S_IMODE(record['statmode']))

    def test_change_file_journal_failure_after_rename_tracks_memory_no_replay(self):
        c = self.prepare_state(); original = r.exclusive
        def fail_log(p,data,*args):
            if p.name == 'state-000002.json':
                raise OSError('synthetic journal create fault')
            return original(p,data,*args)
        with r.locked(self.cfg), patch.object(r,'exclusive',side_effect=fail_log):
            with self.assertRaises(OSError):
                c.change_file('front',True,True)
            self.assertEqual(c.st['targets']['front'],'candidate')
            self.assertEqual(c.st['protectedFiles'][str(self.cfg.front_api)],r.describe(self.cfg.front_api))
            self.assertTrue(c.journal_uncertain); self.assertIsNotNone(c.pending_state_hash)
            with self.assertRaisesRegex(r.ReleaseError,'JOURNAL_DURABILITY_UNCERTAIN'):
                c.change_file('front',False)
            with self.assertRaisesRegex(r.ReleaseError,'JOURNAL_DURABILITY_UNCERTAIN'):
                c.checkpoint('no retry')
        with self.assertRaisesRegex(r.ReleaseError,'DURABLE_ATTEMPT_NO_REPLAY'):
            c.apply(self.cfg.package,self.ms,self.rs)

    def test_checkpoint_dir_fsync_fault_never_claims_durable_or_replays(self):
        c = self.prepare_state(); original = r.fsync_dir
        def fail_receipt(p):
            if p == self.cfg.receipt:
                raise OSError('synthetic receipt directory fsync fault')
            return original(p)
        with patch.object(r,'fsync_dir',side_effect=fail_receipt), self.assertRaises(OSError):
            c.checkpoint('faulting-checkpoint')
        path = self.cfg.receipt/'state-000002.json'
        self.assertTrue(path.exists()); original_bytes = path.read_bytes()
        self.assertTrue(c.journal_uncertain)
        with self.assertRaisesRegex(r.ReleaseError,'JOURNAL_DURABILITY_UNCERTAIN'):
            c.checkpoint('retry-refused')
        self.assertEqual(path.read_bytes(),original_bytes)

    def test_restore_journal_latest_pin_and_hashchain_no_stale_replay(self):
        c = self.prepare_state(); first = c.state_hash
        with r.locked(self.cfg):
            self.open_window(c)
            latest = c.state_hash
            c.restore_journal(self.cfg.package,self.ms,self.rs,c.attempt_hash,latest)
            with self.assertRaisesRegex(r.ReleaseError,'LATEST_STATE_EXPLICIT_PIN_NO_STALE_REPLAY'):
                c.restore_journal(self.cfg.package,self.ms,self.rs,c.attempt_hash,first)
        p = self.cfg.receipt/'state-000002.json'; doc = r.decode(p.read_bytes()); doc['previousSha256'] = '0'*64
        p.write_bytes(r.encode(doc))
        with r.locked(self.cfg), self.assertRaisesRegex(r.ReleaseError,'JOURNAL_HASHCHAIN_SCOPE'):
            c.restore_journal(self.cfg.package,self.ms,self.rs,c.attempt_hash,r.H(p.read_bytes()))

    def test_fail_foreign_coord_never_changes_foreign_bytes_or_external_lock(self):
        c = self.prepare_state()
        foreign = r.encode(dict(shared_release_active=True,window=dict(owner_task='FOREIGN',status='recovery-required')))
        self.cfg.coord.write_bytes(foreign)
        with r.locked(self.cfg):
            out = c.fail(r.ReleaseError('synthetic failure'))
            self.assertEqual(len(r.ACTIVE_LOCKS),2)
        self.assertEqual(self.cfg.coord.read_bytes(),foreign)
        self.assertIsNone(out['ownedHoldSha256'])
        self.assertTrue(out['needsOperatorRecovery'])
        self.assertFalse(out['successProven'])

    def test_fail_after_close_retains_owned_recovery_hold_and_history(self):
        c = self.prepare_state()
        with r.locked(self.cfg):
            self.open_window(c); c.close('rolled-back')
            closed = r.decode(self.cfg.coord.read_bytes()); history = closed['window_history']
            out = c.fail(r.ReleaseError('closure receipt proof failed'))
        state = r.decode(self.cfg.coord.read_bytes())
        self.assertTrue(state['shared_release_active'])
        self.assertEqual(state['window']['status'],'recovery-required')
        self.assertTrue(state['window']['needsOperatorRecovery'])
        self.assertEqual(state['window_history'],history)
        self.assertEqual(state['opaque_foreign'],closed['opaque_foreign'])
        self.assertEqual(out['ownedHoldSha256'],r.H(self.cfg.coord.read_bytes()))
        self.assertFalse(out['successProven'])

    def rollback_receipt_fixture(self):
        c = self.prepare_state()
        self.open_window(c); c.close('rolled-back')
        rb = b'synthetic rollback-attempt, not a real recovery approval\n'
        r.exclusive(self.cfg.receipt/'rollback-attempt.json',rb)
        receipt = dict(schema='customer-batch-rollback-receipt-v1',**c.common(),status='rolled-back',
            attemptSha256=c.attempt_hash,rollbackAttemptSha256=r.H(rb),stateSha256=c.state_hash,
            stateSequence=c.sequence,assetsRetained=True,reloadEvents=c.st['events'],
            coordSha256=r.H(self.cfg.coord.read_bytes()),databaseWrites=0,envWrites=0)
        return c,receipt

    def test_durable_success_requires_actual_closed_raw_and_latest_state(self):
        with r.locked(self.cfg):
            c,receipt = self.rollback_receipt_fixture()
            result = c.durable_success(receipt,'rollback-receipt.json','rolled-back')
            self.assertEqual(result,receipt)
            self.assertEqual(r.decode((self.cfg.receipt/'rollback-receipt.json').read_bytes()),receipt)
            bad = dict(receipt,coordSha256='0'*64)
            with self.assertRaisesRegex(r.ReleaseError,'DURABLE_RECEIPT_ACTUAL_COORD_BINDING'):
                c.receipt_proof(bad,'rolled-back')
            self.cfg.coord.write_bytes(self.cfg.coord.read_bytes()+b' \n')
            with self.assertRaisesRegex(r.ReleaseError,'COORD_OWNERSHIP_FULLMETA_LOST'):
                c.receipt_proof(receipt,'rolled-back')

    def test_status_only_closed_coord_is_not_success_receipt(self):
        with r.locked(self.cfg):
            c,receipt = self.rollback_receipt_fixture()
            with self.assertRaisesRegex(r.ReleaseError,'DURABLE_RECEIPT_ACTUAL_COORD_BINDING'):
                c.durable_success({'status':'rolled-back'},'rollback-receipt.json','rolled-back')
            self.assertFalse((self.cfg.receipt/'rollback-receipt.json').exists())
            (self.cfg.receipt/('state-%06d.json' % c.sequence)).write_bytes(b'{"status":"closed"}\n')
            with self.assertRaisesRegex(r.ReleaseError,'DURABLE_LATEST_STATE_ATTEMPT_BINDING'):
                c.receipt_proof(receipt,'rolled-back')

    def test_receipt_fsync_failure_never_returns_success_and_can_keep_owned_hold(self):
        with r.locked(self.cfg):
            c,receipt = self.rollback_receipt_fixture(); original = r.fsync_dir
            def fail_receipt(p):
                if p == self.cfg.receipt:
                    raise OSError('synthetic receipt directory fsync fault')
                return original(p)
            with patch.object(r,'fsync_dir',side_effect=fail_receipt), self.assertRaises(OSError):
                c.durable_success(receipt,'rollback-receipt.json','rolled-back')
            failure = c.fail(r.ReleaseError('durable receipt unproven'),'rollback-failure.json')
            self.assertFalse(failure['successProven'])
            self.assertTrue(r.decode(self.cfg.coord.read_bytes())['shared_release_active'])

    def test_candidate_wrong_controller_pin_creates_no_output(self):
        spec = self.root/'candidate-spec.json'; spec.write_bytes(b'{}\n'); out = self.root/'new-output'
        with self.assertRaisesRegex(r.ReleaseError,'CONTROLLER_PIN'):
            r.seal_candidate(spec,out,'0'*64)
        self.assertFalse(out.exists())

    def test_json_duplicate_nonfinite_and_relative_escape_refused(self):
        for raw in [b'{"scope":1,"scope":2}',b'{"x":NaN}']:
            with self.assertRaises(r.ReleaseError):
                r.decode(raw)
        for value in ['../escape','/absolute','a//b','a/./b']:
            with self.assertRaises(r.ReleaseError):
                r.rel(value)

    def recovery_fixture(self, expired_capture=False):
        if expired_capture:
            self.cap['capturedAtUtc'] = (dt.datetime.now(dt.timezone.utc)-dt.timedelta(seconds=r.TTL+60)).isoformat()
            raw = r.encode(self.cap)
            self.payload['capture.json'] = raw
            (self.cfg.package/'capture.json').write_bytes(raw)
            self.m['packageFiles']['capture.json'] = r.file_pin(raw)
            self.m['captureSha256'] = r.H(raw)
            self.repin()
        c = self.prepare_state(require_fresh=not expired_capture)
        with r.locked(self.cfg):
            self.open_window(c)
            c.fail(r.ReleaseError('synthetic owned failure'))
        outcome = (self.cfg.receipt/'failure.json').read_bytes()
        expected = dict(**c.common(),attemptSha256=c.attempt_hash,stateSha256=c.state_hash,
            outcomeSha256=r.H(outcome),packageFiles=c.b['m']['packageFiles'],targets=c.st['targets'],
            reloadOnlyLoadedSlots=c.st['loadedSlots'],retainAllAssets=True)
        report = b'synthetic independent recovery report; not production approval\n'
        approval = dict(schema='customer-batch-rollback-review-v1',independent=True,rollbackApproved=True,
            reviewerScope='independent-synthetic-recovery',reviewerHash=r.H(report),bindings=expected,
            approvedAtUtc=r.now(),ttlSeconds=r.TTL)
        (self.cfg.stage/'rollback-reviewer-report.txt').write_bytes(report)
        return c,approval,r.H(outcome)

    def invoke_synthetic_rollback(self, c, approval, outcome_sha):
        raw = r.encode(approval)
        (self.cfg.stage/'rollback-review.json').write_bytes(raw)
        return c.rollback(self.cfg.package,self.ms,self.rs,c.attempt_hash,c.state_hash,r.H(raw),outcome_sha)

    def test_public_rollback_stale_or_future_approval_refused_without_new_attempt(self):
        c,approval,outcome_sha = self.recovery_fixture(expired_capture=True)
        coord = self.cfg.coord.read_bytes()
        for seconds in (-r.TTL-1,60):
            approval['approvedAtUtc'] = (dt.datetime.now(dt.timezone.utc)+dt.timedelta(seconds=seconds)).isoformat()
            # Reset only in-memory readonly approval so restore can independently reload the journal.
            c.recovery_approval = None; c.recovery_approval_sha = None
            with self.assertRaisesRegex(r.ReleaseError,'FRESH_CAPTURE_REQUIRED'):
                self.invoke_synthetic_rollback(c,approval,outcome_sha)
            self.assertFalse((self.cfg.receipt/'rollback-attempt.json').exists())
            self.assertEqual(self.cfg.coord.read_bytes(),coord)
        self.assertEqual(self.reload_calls,[])

    def test_public_rollback_requires_fresh_fields_and_independent_exact_binding(self):
        c,approval,outcome_sha = self.recovery_fixture()
        coord = self.cfg.coord.read_bytes()
        for key, value in [('approvedAtUtc',None),('independent',False),('reviewerScope',r.OWNER),('bindings',{})]:
            bad = copy.deepcopy(approval)
            if key == 'approvedAtUtc':
                del bad[key]
            else:
                bad[key] = value
            with self.subTest(key=key), self.assertRaises(r.ReleaseError):
                self.invoke_synthetic_rollback(c,bad,outcome_sha)
            self.assertEqual(self.cfg.coord.read_bytes(),coord)
            self.assertFalse((self.cfg.receipt/'rollback-attempt.json').exists())

    def test_public_rollback_baseline_only_expired_capture_fresh_approval(self):
        # Only an owned baseline-only recovery fixture: no six-slot/customer build release claim.
        c,approval,outcome_sha = self.recovery_fixture(expired_capture=True)
        result = self.invoke_synthetic_rollback(c,approval,outcome_sha)
        self.assertEqual(result['status'],'rolled-back')
        self.assertEqual(result['coordSha256'],r.H(self.cfg.coord.read_bytes()))
        self.assertEqual(self.reload_calls,[])
        self.assertEqual(r.decode((self.cfg.receipt/'rollback-receipt.json').read_bytes()),result)
        with self.assertRaisesRegex(r.ReleaseError,'ROLLBACK_ATTEMPT_NO_REPLAY'):
            self.invoke_synthetic_rollback(c,approval,outcome_sha)

    def test_recovery_approval_file_and_report_are_rechecked_by_guard(self):
        c,approval,outcome_sha = self.recovery_fixture()
        raw = r.encode(approval); (self.cfg.stage/'rollback-review.json').write_bytes(raw)
        c.recovery_approval = approval; c.recovery_approval_sha = r.H(raw)
        with r.locked(self.cfg):
            c.guard()
            path = self.cfg.stage/'rollback-reviewer-report.txt'; original = path.read_bytes()
            path.write_bytes(b'foreign reviewer change')
            with self.assertRaisesRegex(r.ReleaseError,'RECOVERY_APPROVAL_REPORT_SEAL_DRIFT'):
                c.guard()
            path.write_bytes(original)
            (self.cfg.stage/'rollback-review.json').write_bytes(raw+b' \n')
            with self.assertRaisesRegex(r.ReleaseError,'RECOVERY_APPROVAL_REPORT_SEAL_DRIFT'):
                c.guard()

    def test_public_verify_status_only_is_explicit_readonly_recovery_failure(self):
        c = self.prepare_state(); raw = r.encode(dict(status='verified'))
        r.exclusive(self.cfg.receipt/'receipt.json',raw)
        coord = self.cfg.coord.read_bytes(); files = sorted(p.name for p in self.cfg.receipt.iterdir())
        with self.assertRaisesRegex(r.ReleaseError,'VERIFICATION_RECOVERY_REQUIRED_NO_SUCCESS'):
            c.verify(self.cfg.package,self.ms,self.rs,c.attempt_hash,c.state_hash,r.H(raw))
        self.assertEqual(self.cfg.coord.read_bytes(),coord)
        self.assertEqual(sorted(p.name for p in self.cfg.receipt.iterdir()),files)
        self.assertEqual(self.reload_calls,[])

    def test_public_apply_proof_failure_after_close_has_no_success_and_keeps_owned_hold(self):
        with patch.object(self.controller,'durable_success',side_effect=r.ReleaseError('synthetic post-close proof failure')):
            with self.assertRaisesRegex(r.ReleaseError,'RECOVERY_REQUIRED'):
                self.controller.apply(self.cfg.package,self.ms,self.rs)
        self.assertFalse((self.cfg.receipt/'receipt.json').exists())
        failure = r.decode((self.cfg.receipt/'failure.json').read_bytes())
        coord = r.decode(self.cfg.coord.read_bytes())
        self.assertFalse(failure['successProven'])
        self.assertTrue(coord['shared_release_active'])
        self.assertEqual(coord['window']['status'],'recovery-required')
        self.assertEqual(coord['window_history'][-1]['status'],'closed')
        self.assertEqual(coord['opaque_foreign'],self.original_coord['opaque_foreign'])
        self.assertEqual(self.reload_calls,list(range(6)))  # mock callbacks, never RPC/reload

    def test_public_apply_failure_receipt_io_failure_is_explicit_recovery(self):
        original = r.exclusive
        def fail_failure_receipt(p,data,*args):
            if p.name == 'failure.json':
                raise OSError('synthetic failure receipt io fault')
            return original(p,data,*args)
        with patch.object(self.controller,'durable_success',side_effect=r.ReleaseError('synthetic closure proof fault')), \
             patch.object(r,'exclusive',side_effect=fail_failure_receipt):
            with self.assertRaisesRegex(r.ReleaseError,'RECOVERY_REQUIRED_FAILURE_RECEIPT_UNPROVEN'):
                self.controller.apply(self.cfg.package,self.ms,self.rs)
        self.assertTrue(r.decode(self.cfg.coord.read_bytes())['shared_release_active'])
        self.assertFalse((self.cfg.receipt/'receipt.json').exists())

    def test_change_coord_journal_failure_remembers_owned_raw_immediately(self):
        c = self.prepare_state(); original = r.exclusive
        def fail_log(p,data,*args):
            if p.name == 'state-000002.json':
                raise OSError('synthetic coord journal fault')
            return original(p,data,*args)
        with r.locked(self.cfg):
            with patch.object(r,'exclusive',side_effect=fail_log), self.assertRaises(OSError):
                self.open_window(c)
            self.assertEqual(base64.b64decode(c.st['coordBase64']),self.cfg.coord.read_bytes())
            self.assertEqual(c.st['coordRecord'],r.describe(self.cfg.coord))
            self.assertTrue(c.journal_uncertain)
            failure = c.fail(r.ReleaseError('journal uncertain'))
            self.assertTrue(failure['journalDurabilityUncertain'])
            self.assertFalse(failure['successProven'])
            self.assertTrue(r.decode(self.cfg.coord.read_bytes())['shared_release_active'])

    def test_sealed_guard_checks_payload_mode_and_controller_source_hash(self):
        c = self.prepare_state(); path = self.cfg.package/'evidence/source/fixture.js'
        path.chmod(0o644)
        with self.assertRaisesRegex(r.ReleaseError,'SEALED_SOURCE_PAYLOAD_DRIFT'):
            c.sealed_guard()
        path.chmod(0o600); original = c.hash; c.hash = '0'*64
        with self.assertRaisesRegex(r.ReleaseError,'CONTROLLER_SOURCE_DRIFT'):
            c.sealed_guard()
        c.hash = original

    def test_preflight_refuses_foreign_worker_drift_without_writes(self):
        path = self.root/'workers/w11/dist/index.js'; path.write_bytes(b'newer foreign executable')
        coord = self.cfg.coord.read_bytes()
        with self.assertRaisesRegex(r.ReleaseError,'FOREIGN_FULLMETA_PROCESS_DRIFT'):
            self.preflight()
        self.assertEqual(self.cfg.coord.read_bytes(),coord)
        self.assertFalse(self.cfg.receipt.exists())
        self.assertEqual(self.reload_calls,[])

    def test_preflight_refuses_missing_fixed_alias_without_write(self):
        alias = self.cfg.front_api.parent/'forumPdfScanWorker.mjs'; alias.unlink()
        coord = self.cfg.coord.read_bytes()
        with self.assertRaisesRegex(r.ReleaseError,'FIXED_ALIAS_MUST_BE_SYMLINK'):
            self.preflight()
        self.assertEqual(self.cfg.coord.read_bytes(),coord)
        self.assertFalse(alias.exists())
        self.assertFalse(self.cfg.receipt.exists())

    def test_public_verify_synthetic_receipt_is_actual_raw_bound(self):
        # Synthetic fixtures validate public receipt protocol only, NOT actual customer bundles/RPC.
        c = self.controller
        result = c.apply(self.cfg.package,self.ms,self.rs)
        raw = (self.cfg.receipt/'receipt.json').read_bytes()
        self.assertEqual(r.decode(raw),result)
        self.assertEqual(result['coordSha256'],r.H(self.cfg.coord.read_bytes()))
        self.assertEqual(result['stateSha256'],c.state_hash)
        verified = c.verify(self.cfg.package,self.ms,self.rs,c.attempt_hash,c.state_hash,r.H(raw))
        self.assertEqual(verified['status'],'verified-live-matching-own-receipt')
        self.cfg.coord.write_bytes(self.cfg.coord.read_bytes()+b' \n')
        changed = self.cfg.coord.read_bytes()
        with self.assertRaisesRegex(r.ReleaseError,'VERIFICATION_RECOVERY_REQUIRED_NO_SUCCESS'):
            c.verify(self.cfg.package,self.ms,self.rs,c.attempt_hash,c.state_hash,r.H(raw))
        self.assertEqual(self.cfg.coord.read_bytes(),changed)
        self.assertFalse((self.cfg.receipt/'failure.json').exists())

class AdapterFilesTests(unittest.TestCase):
    """Real temp filesystem/helper/transport; synthetic Node/socket/daemon only.
    No Node execution, actual RPC, production paths, capture or release CLI.
    """
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='customer-batch-adapter-r2-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.cfg = r.Config(pm2_base=self.root/'pm2', pm2_home=self.root/'home',
                            node=self.root/'node', proc=self.root/'proc', mock=True)
        self.cfg.pm2_home.mkdir()
        (self.cfg.proc/'12345').mkdir(parents=True)
        self.cfg.node.write_bytes(b'synthetic Node binary')
        (self.cfg.pm2_home/'pm2.pid').write_bytes(b'12345\n')
        self.sock = self.cfg.pm2_home/'rpc.sock'
        self.sock.write_bytes(b'synthetic socket record, never connected')
        self.roots = [self.cfg.pm2_base/'modules'/n for n in ('pm2-axon', 'pm2-axon-rpc')]
        self.entries = [str(p/'index.js') for p in self.roots]
        for i, p in enumerate(self.roots):
            (p/'lib/nested').mkdir(parents=True)
            (p/'empty').mkdir()
            (p/'index.js').write_bytes(b"module.exports = require('./lib');\n" if i == 0 else
                                      b"exports.Client = require('./lib/client');\n")
            (p/'lib/client.js').write_bytes(b'// synthetic vendored source\n')
            (p/'lib/nested/data.txt').write_bytes(b'non-JS file also pinned\n')
            (p/'README.md').write_bytes(b'all regular files bound\n')
            self.assertFalse((p/'package.json').exists())
        (self.cfg.pm2_base/'lib/God').mkdir(parents=True)
        measured = Path('/home/ubuntu/work/customer-batch/pm2-live-source')
        for name, digest in r.PM2_GENERATION_PINS.items():
            file = self.cfg.pm2_base/name; file.parent.mkdir(parents=True, exist_ok=True)
            data = (measured/name).read_bytes(); self.assertEqual(r.H(data), digest)
            file.write_bytes(data)  # measured source bytes pinned, never evaluated/imported
        (self.cfg.pm2_base/'lib/Daemon.js').write_bytes(b'synthetic Daemon source')
        self.calls = []
        self.native_hook = None
        real_describe = r.describe
        def describe(p):
            record = real_describe(p)
            return dict(record, kind='socket', statmode=stat.S_IFSOCK | 0o600) if Path(p) == self.sock else record
        for guard in [patch.object(r, 'describe', side_effect=describe), patch.object(r.os, 'kill'),
                      patch.dict(r.os.environ, {'NODE_OPTIONS':'', 'NODE_PATH':''}),
                      patch.object(r.subprocess, 'run', side_effect=self.fake_run)]:
            guard.start(); self.addCleanup(guard.stop)

    def fake_run(self, command, **kwargs):
        self.calls.append(command)
        self.assertEqual(command[:2], [str(self.cfg.node), '-e'])
        if command[2] == "const b=process.argv[1];process.stdout.write(JSON.stringify(['pm2-axon','pm2-axon-rpc'].map(n=>require.resolve(b+'/modules/'+n))))":
            self.assertEqual(command[3:], [str(self.cfg.pm2_base)])
            self.assertEqual(kwargs['timeout'], 15)
            return r.subprocess.CompletedProcess(command, 0, r.encode(self.entries), b'')
        if command[2] == "process.stdout.write(process.binding('natives')['internal/cluster/primary'])":
            if self.native_hook:
                self.native_hook()
            return r.subprocess.CompletedProcess(command, 0, b'// synthetic NODE_UNIQUE_ID primary', b'')
        self.fail('no Node module execution or RPC allowed in this fixture')

    def test_full_vendor_files_dirs_meta_and_root_package_pins(self):
        actual = r.adapter_files(self.cfg, self.entries)
        expected = {str(p) for root in self.roots for p in (root, *root.rglob('*'))}
        self.assertEqual(set(actual), expected)
        self.assertEqual(actual, {p: r.describe(Path(p)) for p in sorted(expected)})
        tr = r.transport(self.cfg)
        files = {p for p, record in actual.items() if record['kind'] == 'file'}
        original = {str(self.cfg.node), str(self.cfg.pm2_base/'lib/Daemon.js'),
                    *(str(self.cfg.pm2_base/n) for n in r.PM2_GENERATION_PINS)}
        self.assertEqual(set(tr['sources']), files | original)
        self.assertEqual(tr['fullAdapterMeta'], actual)
        for p, digest in tr['sources'].items():
            self.assertEqual(digest, r.H(r.regular(Path(p))))
        self.assertTrue(set(self.entries) <= set(tr['sources']))
        self.assertEqual(tr['rpcSourceSha256'], r.H(r.RPC.encode()))

    def test_file_and_empty_directory_set_changes_bound(self):
        original = r.adapter_files(self.cfg, self.entries)
        file = self.roots[0]/'new.data'; file.write_bytes(b'added')
        self.assertNotEqual(r.adapter_files(self.cfg, self.entries), original)
        file.unlink(); (self.roots[0]/'empty').rmdir()
        self.assertNotEqual(r.adapter_files(self.cfg, self.entries), original)

    def test_same_bytes_metadata_change_bound(self):
        tr = r.transport(self.cfg)
        file = self.roots[0]/'lib/client.js'
        file.chmod(0o600 if stat.S_IMODE(file.stat().st_mode) != 0o600 else 0o644)
        after = r.transport(self.cfg)
        self.assertEqual(tr['sources'], after['sources'])
        self.assertNotEqual(tr['fullAdapterMeta'], after['fullAdapterMeta'])

    def test_source_change_between_snapshot_and_pins_refused(self):
        target = self.roots[0]/'lib/client.js'; real = r.regular; reads = []
        def read(p):
            if Path(p) == target:
                reads.append(p)
                if len(reads) == 2:
                    target.write_bytes(b'changed between snapshot and source pin')
            return real(p)
        with patch.object(r, 'regular', side_effect=read), self.assertRaisesRegex(r.ReleaseError, 'ADAPTER_SOURCE_SNAPSHOT_DRIFT'):
            r.transport(self.cfg)

    def test_late_source_change_refused(self):
        self.native_hook = lambda: (self.roots[1]/'lib/client.js').write_bytes(b'late code change')
        with self.assertRaisesRegex(r.ReleaseError, 'ADAPTER_FULL_META_SET_DRIFT'):
            r.transport(self.cfg)

    def test_late_file_meta_change_refused(self):
        self.native_hook = lambda: (self.roots[1]/'lib/client.js').chmod(0o400)
        with self.assertRaisesRegex(r.ReleaseError, 'ADAPTER_FULL_META_SET_DRIFT'):
            r.transport(self.cfg)

    def test_late_directory_addition_refused(self):
        self.native_hook = lambda: (self.roots[1]/'new-empty').mkdir()
        with self.assertRaisesRegex(r.ReleaseError, 'ADAPTER_FULL_META_SET_DRIFT'):
            r.transport(self.cfg)

    def test_late_file_deletion_refused(self):
        self.native_hook = lambda: (self.roots[1]/'lib/client.js').unlink()
        with self.assertRaisesRegex(r.ReleaseError, 'ADAPTER_FULL_META_SET_DRIFT'):
            r.transport(self.cfg)

    def test_enumeration_race_refused(self):
        real = Path.iterdir; changed = []
        def iterdir(p):
            children = list(real(p))
            if p == self.roots[0] and not changed:
                changed.append(True); (p/'unknown-during-enumeration').write_bytes(b'race')
            return iter(children)
        with patch.object(Path, 'iterdir', iterdir), self.assertRaisesRegex(r.ReleaseError, 'ADAPTER_ENUMERATION_META_DRIFT'):
            r.adapter_files(self.cfg, self.entries)

    def test_symlink_file_and_directory_dependency_escape_refused(self):
        outside = self.root/'outside'; outside.mkdir(); (outside/'dep.js').write_bytes(b'outside dependency')
        for target in (outside, outside/'dep.js', self.roots[1]/'lib/client.js'):
            link = self.roots[0]/'escape'; link.symlink_to(target)
            with self.subTest(target=target), self.assertRaisesRegex(r.ReleaseError, 'SYMLINK_ESCAPE'):
                r.adapter_files(self.cfg, self.entries)
            link.unlink()

    def test_hardlink_dependency_escape_refused(self):
        outside = self.root/'outside-file'; outside.write_bytes(b'outside hardlinked bytes')
        os.link(outside, self.roots[0]/'hardlink')
        with self.assertRaisesRegex(r.ReleaseError, 'ADAPTER_SINGLE_REGULAR_REQUIRED'):
            r.adapter_files(self.cfg, self.entries)

    def test_special_unknown_entry_refused(self):
        os.mkfifo(self.roots[0]/'unknown-fifo')
        with self.assertRaisesRegex(r.ReleaseError, 'SPECIAL_FILE_REFUSED'):
            r.adapter_files(self.cfg, self.entries)

    def test_wrong_resolved_entries_and_npm_fallback_refused(self):
        candidates = [[str(self.cfg.pm2_base/'node_modules/pm2-axon/index.js'), self.entries[1]],
                      [str(self.roots[0]/'lib/client.js'), self.entries[1]],
                      [str(self.root/'outside.js'), self.entries[1]], self.entries[::-1],
                      [self.entries[0], self.entries[0]], [self.entries[0]+'/../index.js', self.entries[1]],
                      [None, self.entries[1]], tuple(self.entries), []]
        for entries in candidates:
            with self.subTest(entries=entries), self.assertRaisesRegex(r.ReleaseError, 'EXACT_VENDORED_ADAPTER_ENTRIES'):
                r.adapter_files(self.cfg, entries)

    def test_failed_resolve_has_no_npm_or_other_fallback(self):
        with patch.object(r.subprocess, 'run', return_value=r.subprocess.CompletedProcess([], 1, b'', b'failed')) as run:
            with self.assertRaisesRegex(r.ReleaseError, 'FRESH_ADAPTER_RESOLVE_REQUIRED'):
                r.transport(self.cfg)
        self.assertEqual(run.call_count, 1)
        self.assertIn("require.resolve(b+'/modules/'+n)", run.call_args.args[0][2])

    def test_missing_root_package_never_drops_pin_or_falls_back(self):
        (self.cfg.pm2_base/'package.json').unlink()
        with self.assertRaises(FileNotFoundError):
            r.transport(self.cfg)
        self.assertEqual(len(self.calls), 1)

    def test_missing_index_is_refused(self):
        (self.roots[0]/'index.js').unlink()
        with self.assertRaisesRegex(r.ReleaseError, 'ADAPTER_INDEX_FILE_REQUIRED'):
            r.adapter_files(self.cfg, self.entries)

    def test_rpc_arguments_keep_original_specifiers_and_all_source_pins(self):
        tr = r.transport(self.cfg); real_fake = self.fake_run; rpc_args = []
        def run(command, **kwargs):
            if command[2] == r.RPC:
                rpc_args.append(r.decode(command[3].encode()))
                return r.subprocess.CompletedProcess(command, 0, b'[]', b'')
            return real_fake(command, **kwargs)
        with patch.object(r.subprocess, 'run', side_effect=run):
            self.assertEqual(r.rpc(self.cfg, tr), [])
        self.assertEqual(len(rpc_args), 1)
        self.assertEqual(rpc_args[0]['pins'], tr['sources'])
        self.assertEqual(rpc_args[0]['base'], str(self.cfg.pm2_base))
        self.assertFalse(rpc_args[0]['reload'])
        self.assertIn("require(a.base+'/modules/pm2-axon')", r.RPC)
        self.assertIn("require(a.base+'/modules/pm2-axon-rpc')", r.RPC)
        self.assertIn('for(const [p,h] of Object.entries(a.pins))', r.RPC)
        self.assertNotIn('node_modules', r.RPC)
        # Argument preservation only; never an actual RPC usability assertion.



class R3RawTests(unittest.TestCase):
    """Strict source-derived raw transformations; synthetic bytes, no Node or RPC."""
    def setUp(self):
        self.env = dict(APP='A', NODE_UNIQUE_ID='nested-keep', pid='application-pid',
                        opaque='{"pm_uptime":123,"NODE_UNIQUE_ID":"app"}')
        self.e = dict(name='dianzi51', pm_id=190, pm_exec_path='/fixed/front/dist/index.js',
                      pm_cwd='/fixed/front', exec_mode='cluster_mode', status='online',
                      autostart=True, wait_ready=False, env=self.env.copy(),
                      pm_uptime=1000, created_at=900, restart_time=2, unstable_restarts=3,
                      prev_restart_delay=4, axm_actions=[], axm_monitor={}, axm_options={},
                      axm_dynamic={}, vizion_running=False, _pm2_version='7.0.3',
                      nested=dict(pm_uptime='app', created_at='app', NODE_UNIQUE_ID='nested'))
        self.e.update(self.env)
        self.model = dict(name='dianzi51', pm_id=190, pid=9001, pm2_env=self.e)
        self.v = dict(self.e, status='launching')
        self.raw = self.bytes(self.v)

    def bytes(self, value, outer=b'pm_uptime=app\0created_at=app\0restart_time=app\0pid=app\0status=app\0'):
        return outer+b'pm2_env='+json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()+b'\0NODE_UNIQUE_ID=15\0'

    def semantic(self, raw, model=None):
        return r.pm2_raw_binding(raw, model or self.model)[0]

    def test_exact_source_generated_projection_preserves_all_retained_bytes(self):
        semantic, meta, ready = r.pm2_raw_binding(self.raw, self.model)
        self.assertTrue(ready)
        after = dict(self.v, pm_uptime=1201, created_at=1200, restart_time=3,
                     unstable_restarts=0, prev_restart_delay=0)
        model = copy.deepcopy(self.model); model['pm2_env'].update({k:after[k] for k in r.PM2_RAW_GENERATED})
        self.assertEqual(semantic, self.semantic(self.bytes(after), model))
        r.pm2_meta_transition(meta, {k:after[k] for k in r.PM2_RAW_GENERATED}, 1100, 1300)
        self.assertNotEqual(r.H(self.raw),r.H(self.bytes(after)))
        projected=r.pm2_project(r.raw_values(self.raw)[b'pm2_env'])
        self.assertIn(b'"env":{"APP":"A","NODE_UNIQUE_ID":"nested-keep","pid":"application-pid"',projected)
        self.assertIn(b'"nested":{"pm_uptime":"app","created_at":"app","NODE_UNIQUE_ID":"nested"}',projected)

    def test_every_outer_lifecycle_looking_application_value_is_byte_exact(self):
        for key in sorted(r.LIFECYCLE | {'NODE_APP_INSTANCE','NODE_CHANNEL_FD'}):
            original = self.bytes(self.v, (key+'=app\0').encode())
            changed = self.bytes(self.v, (key+'=changed\0').encode())
            with self.subTest(key=key):
                self.assertNotEqual(self.semantic(original), self.semantic(changed))

    def test_env_lifecycle_values_not_deleted_even_when_monitor_strip_would(self):
        for key in sorted(r.LIFECYCLE):
            model=copy.deepcopy(self.model); value=copy.deepcopy(self.v)
            model['pm2_env']['env'][key]='app'; value['env'][key]='app'
            raw=self.bytes(value)
            with self.subTest(key=key):
                if key in set(r.PM2_RAW_GENERATED) | {'pm_id','status','axm_actions','axm_monitor','axm_dynamic'}:
                    with self.assertRaisesRegex(r.ReleaseError,'OVERRIDE_AMBIGUITY'):
                        self.semantic(raw,model)
                else:
                    first=self.semantic(raw,model)
                    value['env'][key]='changed'; model['pm2_env']['env'][key]='changed'
                    self.assertNotEqual(first,self.semantic(self.bytes(value),model))

    def test_nested_life_values_and_nested_unique_never_transform(self):
        for key in ('pm_uptime','created_at','NODE_UNIQUE_ID'):
            value=copy.deepcopy(self.v); value['nested'][key]='changed'
            with self.subTest(key=key):
                self.assertNotEqual(self.semantic(self.raw),self.semantic(self.bytes(value)))
        value=copy.deepcopy(self.v); model=copy.deepcopy(self.model)
        value['env']['NODE_UNIQUE_ID']='changed'; model['pm2_env']['env']['NODE_UNIQUE_ID']='changed'
        self.assertNotEqual(self.semantic(self.raw),self.semantic(self.bytes(value),model))

    def test_application_escape_bytes_not_recursive_canonicalized(self):
        # Identical JSON values, different retained bytes must have different SHA.
        changed=self.raw.replace(b'"APP":"A"', rb'"APP":"\u0041"')
        self.assertEqual(r.decode(r.raw_values(self.raw)[b'pm2_env']),r.decode(r.raw_values(changed)[b'pm2_env']))
        self.assertNotEqual(self.semantic(self.raw),self.semantic(changed))
        self.assertFalse(r.pm2_raw_binding(changed,self.model)[2])
        changed=self.raw.replace(b'"pm_uptime":"app"', rb'"pm_uptime":"\u0061pp"')
        self.assertNotEqual(self.semantic(self.raw),self.semantic(changed))
        changed=self.raw.replace(b'\"app\"',rb'"\u0061pp"')
        self.assertNotEqual(self.semantic(self.raw),self.semantic(changed))

    def test_top_order_whitespace_and_unproved_field_exact(self):
        for raw in (self.raw.replace(b'"nested":',b'"nested" :'),
                    self.bytes(dict(self.v, node_version='unproved-new')),
                    self.bytes(dict(self.v, arbitrary='unproved')),
                    self.raw.replace(b'"vizion_running":false',b'"vizion_running":true')):
            self.assertNotEqual(self.semantic(self.raw),self.semantic(raw))
        value=dict(reversed(list(self.v.items())))
        self.assertNotEqual(self.semantic(self.raw),self.semantic(self.bytes(value)))

    def test_duplicate_keys_at_top_env_nested_and_escaped_alias_rejected(self):
        old=r.raw_values(self.raw)[b'pm2_env']
        for changed in (old[:-1]+b',"pm_id":190}',old.replace(b'"APP":"A"',b'"APP":"A","APP":"A"'),
                        old.replace(b'"pm_uptime":"app"',rb'"pm_uptime":"app","pm_\u0075ptime":"app"')):
            with self.subTest(raw=changed),self.assertRaisesRegex(r.ReleaseError,'DUPLICATE_JSON_KEY'):
                self.semantic(self.raw.replace(old,changed))

    def test_generated_integer_types_and_noncanonical_tokens_refused(self):
        for key in r.PM2_RAW_GENERATED:
            for bad in (True,None,'1000',1.5,-1,2**53):
                value=copy.deepcopy(self.v); model=copy.deepcopy(self.model)
                value[key]=bad; model['pm2_env'][key]=bad
                with self.subTest(key=key,bad=bad),self.assertRaises(r.ReleaseError):
                    self.semantic(self.bytes(value),model)
        for token in (b'1e3',b'1000.0',b'-0'):
            changed=self.raw.replace(b'"pm_uptime":1000',b'"pm_uptime":'+token)
            with self.subTest(token=token),self.assertRaises(r.ReleaseError):self.semantic(changed)

    def test_wait_ready_truthiness_type_ambiguity_refused(self):
        for value in (0,'',None,[],{}):
            model=copy.deepcopy(self.model); model['pm2_env']['wait_ready']=value
            with self.subTest(value=value),self.assertRaisesRegex(r.ReleaseError,'SOURCE_SHAPE'):
                self.semantic(self.bytes(dict(self.v,wait_ready=value)),model)

    def test_stable_identity_and_wrong_container_types_rejected(self):
        for key,value in [('name','other'),('pm_id','190'),('pm_id',True),('pm_exec_path','/other'),
                          ('pm_cwd','/other'),('exec_mode','fork_mode'),('_pm2_version','other')]:
            with self.subTest(key=key),self.assertRaisesRegex(r.ReleaseError,'IDENTITY_BINDING'):
                self.semantic(self.bytes(dict(self.v,**{key:value})))
        for value in ([],{}, {'env':[]}):
            with self.assertRaises(r.ReleaseError):self.semantic(self.bytes(value))

    def test_current_model_generated_relation_required(self):
        for key in r.PM2_RAW_GENERATED:
            model=copy.deepcopy(self.model); model['pm2_env'][key]+=1
            with self.subTest(key=key),self.assertRaisesRegex(r.ReleaseError,'GENERATED_BINDING'):
                self.semantic(self.raw,model)

    def test_generation_override_and_container_override_ambiguity_refused(self):
        for key in set(r.PM2_RAW_GENERATED)|{'pm_id','name','pm2_env','__proto__','pm_exec_path'}:
            value=copy.deepcopy(self.v); model=copy.deepcopy(self.model)
            model['pm2_env']['env'][key]=value['env'][key]='app'
            with self.subTest(key=key),self.assertRaisesRegex(r.ReleaseError,'OVERRIDE_AMBIGUITY'):
                self.semantic(self.bytes(value),model)

    def test_monitor_added_field_is_not_proven_reload_ready(self):
        model=copy.deepcopy(self.model); model['pm2_env']['version']='monitor-added'
        self.assertFalse(r.pm2_raw_binding(self.raw,model)[2])
        value=dict(self.v); value.pop('prev_restart_delay'); model=copy.deepcopy(self.model)
        model['pm2_env'].pop('prev_restart_delay')
        self.assertFalse(r.pm2_raw_binding(self.bytes(value),model)[2])

    def test_merge_object_coercion_ambiguity_refused(self):
        for app in ({'nested':'app'}, ['nested-app']):
            value=copy.deepcopy(self.v); model=copy.deepcopy(self.model)
            value['env']['APP']=app; model['pm2_env']['env']['APP']=app
            with self.assertRaisesRegex(r.ReleaseError,'COERCION_AMBIGUITY'):
                self.semantic(self.bytes(value),model)

    def test_restart_time_reset_and_time_window_are_exact_not_whitelisted(self):
        before={k:self.v[k] for k in r.PM2_RAW_GENERATED}
        good=dict(pm_uptime=1201,created_at=1200,restart_time=3,unstable_restarts=0,prev_restart_delay=0)
        for key,value in [('restart_time',2),('restart_time',4),('unstable_restarts',1),
                          ('prev_restart_delay',1),('created_at',900),('created_at',1400),
                          ('pm_uptime',1000),('pm_uptime',1500),('restart_time',True)]:
            with self.subTest(key=key,value=value),self.assertRaises(r.ReleaseError):
                r.pm2_meta_transition(before,dict(good,**{key:value}),1100,1300)

class R3ProtocolTests(unittest.TestCase):
    def fixture(self):
        case=SafetyTests('test_new_identity_and_fixed_boundary'); case.setUp()
        self.addCleanup(case.doCleanups)
        return case

    def test_no_reload_intent_when_current_model_forecast_unproved(self):
        case=self.fixture(); case.raw_rows[0]['pm2_env']['version']='monitor-added'
        case.make_synthetic_package(); c=case.prepare_state()
        with r.locked(case.cfg):
            case.open_window(c); c.change_file('front',True,True); sequence=c.sequence
            with self.assertRaisesRegex(r.ReleaseError,'UNPROVEN_NO_RELOAD'):c.reload_one(0)
        self.assertEqual(c.sequence,sequence); self.assertEqual(case.reload_calls,[])
        self.assertEqual(c.st['events'],[]); self.assertEqual(c.st['loadedSlots'],[])

    def test_illegal_observation_leaves_only_intent_never_loaded_or_unlock(self):
        case=self.fixture(); c=case.prepare_state(); base=case.simulate_reload
        def adapter(cfg,tr,before):
            base(cfg,tr,before)
            row=next(v for v in case.raw_rows if v['pm_id']==before['id'])
            path=cfg.proc/str(row['pid'])/'environ'
            path.write_bytes(path.read_bytes().replace(b'pm_uptime=application-value',b'pm_uptime=changed'))
        c.reload_adapter=adapter
        with r.locked(case.cfg):
            case.open_window(c); c.change_file('front',True,True)
            with self.assertRaisesRegex(r.ReleaseError,'NODE_PM2_ONLY_LIFECYCLE'):c.reload_one(0)
            latest=r.decode((case.cfg.receipt/('state-%06d.json'%c.sequence)).read_bytes())
            self.assertEqual(latest['operation'],'reload-intent-0')
            self.assertEqual(c.st['events'],[]); self.assertEqual(c.st['loadedSlots'],[])
            self.assertEqual(c.st['processes'][0]['pid'],30000)
            result=c.fail(r.ReleaseError('illegal raw observation'))
            self.assertFalse(result['successProven']); self.assertEqual(len(r.ACTIVE_LOCKS),2)
            self.assertTrue(r.decode(case.cfg.coord.read_bytes())['shared_release_active'])

    def test_uncertain_adapter_error_keeps_only_proved_observation_then_recovery(self):
        case=self.fixture(); c=case.prepare_state(); base=case.simulate_reload
        def adapter(cfg,tr,before):
            base(cfg,tr,before)
            raise RuntimeError('synthetic transport uncertainty after legal transition')
        c.reload_adapter=adapter
        with r.locked(case.cfg):
            case.open_window(c); c.change_file('front',True,True)
            with self.assertRaises(RuntimeError):c.reload_one(0)
            self.assertEqual(c.st['loadedSlots'],[0])
            self.assertTrue(c.st['events'][0]['observedPidChange'])
            self.assertFalse(c.st['events'][0]['transportPassed'])
            c.state_invariants(c.st)
            failure=c.fail(r.ReleaseError('uncertain reload'))
            self.assertFalse(failure['successProven'])
            self.assertTrue(r.decode(case.cfg.coord.read_bytes())['shared_release_active'])

    def test_observation_checkpoint_failure_keeps_memory_and_durable_intent_uncertain(self):
        case=self.fixture(); c=case.prepare_state(); real=r.exclusive
        def fail_observed(path,data,*args):
            if Path(path).name.startswith('state-') and r.decode(data)['operation'].startswith('observed-single-slot-'):
                raise OSError('synthetic observed journal fault')
            return real(path,data,*args)
        with r.locked(case.cfg):
            case.open_window(c); c.change_file('front',True,True)
            with patch.object(r,'exclusive',side_effect=fail_observed),self.assertRaises(OSError):c.reload_one(0)
            self.assertTrue(c.journal_uncertain); self.assertIsNotNone(c.pending_state_hash)
            self.assertEqual(c.st['loadedSlots'],[0]); self.assertEqual(len(c.st['events']),1)
            durable=r.decode((case.cfg.receipt/('state-%06d.json'%(c.sequence-1))).read_bytes())
            self.assertEqual(durable['operation'],'reload-intent-0')
            self.assertEqual(durable['state']['loadedSlots'],[])
            with self.assertRaisesRegex(r.ReleaseError,'JOURNAL_DURABILITY_UNCERTAIN'):c.guard()
            failure=c.fail(r.ReleaseError('observation not durably recorded'))
            self.assertFalse(failure['successProven']); self.assertTrue(failure['journalDurabilityUncertain'])
            self.assertTrue(r.decode(case.cfg.coord.read_bytes())['shared_release_active'])

    def test_partial_journal_intent_cannot_forge_observed_transition(self):
        case=self.fixture(); c=case.prepare_state()
        with r.locked(case.cfg):
            case.open_window(c); c.change_file('front',True,True); c.reload_one(0)
            good=copy.deepcopy(c.st)
            for field,value in [('intentStateSha256','0'*64),('attemptSha256','0'*64),
                                ('intentSequence',1),('afterPm2RawMeta',{})]:
                bad=copy.deepcopy(good); bad['events'][0][field]=value
                with self.subTest(field=field),self.assertRaises(r.ReleaseError):c.state_invariants(bad)
            bad=copy.deepcopy(good); bad['events']=[]
            with self.assertRaises(r.ReleaseError):c.state_invariants(bad)

    def test_multiple_slot_unique_collision_and_unrolled_raw_are_rejected(self):
        for drift in ('two-pid','own-unique','unowned-raw','own-unrolled-generated'):
            case=self.fixture(); c=case.prepare_state(); base=case.simulate_reload
            def adapter(cfg,tr,before):
                base(cfg,tr,before)
                if drift=='two-pid':base(cfg,tr,c.st['processes'][1])
                elif drift=='own-unique':
                    row=case.raw_rows[0]; path=cfg.proc/str(row['pid'])/'environ'
                    path.write_bytes(path.read_bytes().replace(b'NODE_UNIQUE_ID=110\0',b'NODE_UNIQUE_ID=11\0'))
                else:
                    pid=30011 if drift=='unowned-raw' else 30001
                    path=cfg.proc/str(pid)/'environ'; path.write_bytes(path.read_bytes()+b'UNROLLED_DRIFT=1\0')
            c.reload_adapter=adapter
            with r.locked(case.cfg):
                case.open_window(c); c.change_file('front',True,True)
                with self.subTest(drift=drift),self.assertRaises(r.ReleaseError):c.reload_one(0)
            self.assertEqual(c.st['events'],[]); self.assertEqual(c.st['loadedSlots'],[])

    def test_observed_source_drift_rejected_before_event_is_recorded(self):
        case=self.fixture(); c=case.prepare_state(); base=case.simulate_reload
        def adapter(cfg,tr,before):
            base(cfg,tr,before); case.tr['sourceDrift']='different source'
        c.reload_adapter=adapter
        with r.locked(case.cfg):
            case.open_window(c); c.change_file('front',True,True)
            with self.assertRaisesRegex(r.ReleaseError,'SOURCE_DRIFT'):c.reload_one(0)
        self.assertEqual(c.st['events'],[]); self.assertEqual(c.st['loadedSlots'],[])

    def test_exact_default_private_root_keeps_all_prior_protection(self):
        cfg=r.Config()
        self.assertEqual(cfg.extra_protected,(Path('/opt/config/dianzi51-admin/runtime.env'),
            Path('/opt/config/dianzi51/runtime.env'),Path('/var/lib/dianzi51-private')))
        self.assertNotIn(Path('/var/lib'),cfg.extra_protected)
        self.assertEqual(len(cfg.aliases),7)

    def test_private_root_full_files_emptydirs_meta_set_and_existing_union(self):
        case=self.fixture(); root=case.root/'private'; (root/'official-technical').mkdir(parents=True)
        (root/'empty').mkdir(); store=root/'official-technical/prepared-v1.json'; store.write_bytes(b'{"synthetic":true}')
        cfg=replace(case.cfg,extra_protected=(root,))
        paths,links=r.union(cfg,case.original_coord)
        original=r.inventory(cfg,case.cap['processes'],paths,links)
        self.assertTrue({str(p) for p in (root,*root.rglob('*'))}<=set(original))
        self.assertEqual(original[str(root/'empty')],r.describe(root/'empty'))
        store.chmod(0o600)
        self.assertNotEqual(r.inventory(cfg,case.cap['processes'],paths,links),original)
        store.write_bytes(b'{"synthetic":false}')
        self.assertNotEqual(r.inventory(cfg,case.cap['processes'],paths,links),original)
        (root/'new-empty').mkdir()
        self.assertNotEqual(set(r.inventory(cfg,case.cap['processes'],paths,links)),set(original))
        (root/'empty').rmdir()
        self.assertNotIn(str(root/'empty'),r.inventory(cfg,case.cap['processes'],paths,links))

    def test_private_root_special_entry_fail_closed(self):
        case=self.fixture(); root=case.root/'private'; root.mkdir(); os.mkfifo(root/'fifo')
        with self.assertRaisesRegex(r.ReleaseError,'SPECIAL_FILE_REFUSED'):
            r.inventory(case.cfg,case.cap['processes'],(root,))

class R3SourcePinTests(unittest.TestCase):
    setUp = AdapterFilesTests.setUp
    fake_run = AdapterFilesTests.fake_run
    def test_generation_pins_all_measured_exact_no_missing_sources(self):
        tr=r.transport(self.cfg)
        for name,digest in r.PM2_GENERATION_PINS.items():
            self.assertEqual(tr['sources'][str(self.cfg.pm2_base/name)],digest)
        for name in ('lib/God.js','lib/God/ClusterMode.js','lib/God/Methods.js',
                     'lib/Utility.js','lib/ProcessContainer.js','constants.js'):
            self.assertIn(name,r.PM2_GENERATION_PINS)

    def test_loader_env_refused_before_any_node_probe_without_unsetting(self):
        for key in ('NODE_OPTIONS','NODE_PATH'):
            with self.subTest(key=key),patch.dict(r.os.environ,{key:'synthetic-untrusted-loader'}):
                before=dict(r.os.environ); self.calls.clear()
                with self.assertRaisesRegex(r.ReleaseError,'NO_NODE_EXECUTION'):r.transport(self.cfg)
                self.assertEqual(self.calls,[])
                self.assertEqual(dict(r.os.environ),before)

    def test_absent_and_empty_loader_env_allowed_only_with_mock_node(self):
        with patch.dict(r.os.environ,{},clear=True):
            r.transport(self.cfg)
        with patch.dict(r.os.environ,{'NODE_OPTIONS':'','NODE_PATH':''}):
            r.transport(self.cfg)
        self.assertEqual(len(self.calls),4)

    def test_each_generating_source_drift_fail_closed(self):
        for name in r.PM2_GENERATION_PINS:
            path=self.cfg.pm2_base/name; original=path.read_bytes(); path.write_bytes(original+b'\n// drift')
            with self.subTest(name=name),self.assertRaisesRegex(r.ReleaseError,'GENERATION_SOURCE_PIN_DRIFT'):
                r.transport(self.cfg)
            path.write_bytes(original)

if __name__ == '__main__':
    unittest.main()
