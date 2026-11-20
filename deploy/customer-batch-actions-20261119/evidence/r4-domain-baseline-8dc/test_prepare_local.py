#!/usr/bin/env python3
"""Synthetic temp-only preparation tests; never capture or run a real build/seal."""
import argparse
import base64
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
HERE = Path(__file__).absolute().parent
spec = importlib.util.spec_from_file_location('prepare_local', HERE / 'prepare-local.py')
P = importlib.util.module_from_spec(spec)
spec.loader.exec_module(P)
R = P.load_release()
REAL_LOADER = P.load_release
REAL_NATIVE_API, REAL_UI_INVERSE = R.native_api, R.ui_inverse


class LocalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='prepare-local-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.work, self.repo = self.root / 'work', self.root / 'repo'
        self.work.mkdir(mode=0o700)
        self.repo.mkdir(mode=0o700)
        self.here = self.repo / 'deploy/customer-batch-actions-20261119'
        backend_text = (HERE / 'backend-builder.cjs').read_text()
        native_text = (HERE / 'build-native.mjs').read_text()
        self.backend_names, self.ui_names = P.source_names(backend_text, native_text)
        for name in self.backend_names | self.ui_names | set(P.TOOLS):
            data = ('// SYNTHETIC SOURCE ' + name + '\n').encode()
            if name == P.TOOLS[0]:
                data = native_text.encode()
            if name == P.TOOLS[1]:
                data = backend_text.encode()
            self.file(self.repo / name, data)
        self.base = self.work / 'handoff'
        self.base.mkdir(mode=0o700)
        self.blobs = {'front-api.js': b'// synthetic front baseline\n', 'admin-api.js': b'// synthetic admin baseline\n'}
        for value in (b'// synthetic UI one\n', b'// synthetic UI two\n'):
            self.blobs['assets/BusinessWorkbenchPage-upload-manage-' + P.sha(value)[:16] + '.js'] = value
        names = sorted(n for n in self.blobs if n.startswith('assets/'))
        self.blobs['admin-index.html'] = ('<head>' + ''.join('<script src="/' + n + '"></script>' for n in names) + '</head>').encode()
        cfg = R.Config()
        protected = {}
        for name, data in self.blobs.items():
            self.file(self.base / name, data)
            path = cfg.html if name == 'admin-index.html' else cfg.apis[name[:-7]] if name.endswith('-api.js') else cfg.public / name
            protected[str(path)] = dict(kind='file', nlink=1, sha256=P.sha(data), size=len(data))
        rows = []
        for i in range(12):
            own = i < 6
            kind = 'front' if i < 4 else 'admin'
            rows.append(dict(id=i, pid=100 + i, name=('dianzi51' if i < 4 else 'dianzi51-admin') if own else 'synthetic-worker-' + str(i),
                             status='online', script=str(cfg.apis[kind]) if own else '/synthetic/worker.js',
                             cwd='/synthetic', execMode='cluster_mode', restarts=0, listenerPort=3000 if own else None,
                             nodeUniqueId=i if own else None, pm2ReloadReady=True if own else None,
                             pm2RawMeta={k: 0 for k in R.PM2_RAW_GENERATED} if own else None, **{k: 'a' * 64 for k in
                             ('topConfigSha256', 'childConfigSha256', 'rawSha256', 'semanticSha256', 'permissionsSha256')}))
        coord = R.encode(dict(shared_release_active=False, window=dict(status='verified', needsOperatorRecovery=False,
                         scope='synthetic-frontend-owner', closedAtUtc=R.now()), window_history=[]))
        paths, links = R.union(cfg, R.decode(coord))
        self.cap = dict(schema='customer-batch-capture-v1', ownerTask=R.OWNER, scope=R.SCOPE, nonce='b' * 32,
                        capturedAtUtc=R.now(), ttlSeconds=900, controllerSha256=P.CONTROLLER_SHA,
                        config=R.config_binding(cfg), coordBase64=base64.b64encode(coord).decode(),
                        coordRecord=dict(sha256=P.sha(coord)), protectedFiles=protected, processes=rows, transport={},
                        protectionUnion=dict(paths=[str(p) for p in paths], links={str(a): str(t) for a, t in links.items()}),
                        environmentValuesExported=False, productionWrites=0, canonicalMetadataSha256=P.sha(R.encode(protected)))
        self.save_capture()
        self.nonce = self.work / 'owner-nonce.txt'
        self.file(self.nonce, b'SYNTHETIC-private-owner-nonce\n')
        self.out = self.work / 'backend-prepare-case'
        self.args = argparse.Namespace(base=str(self.base), out=str(self.out), owner_nonce_file=str(self.nonce),
                                       reviewer_report=None, reviewer_sha256=None, seal=False)
        self.calls = []
        self.fail_command = None
        self.native_count = 0
        self.backend_count = 0
        self.native_drift = False
        self.backend_drift = False
        self.source_drift = False
        self.patches = [patch.object(P, 'WORK', self.work), patch.object(P, 'REPO', self.repo), patch.object(P, 'HERE', self.here),
                        patch.object(P, 'load_release', return_value=R), patch.object(subprocess, 'run', side_effect=self.fake_run),
                        patch.object(R, 'native_api'), patch.object(R, 'ui_inverse'),
                        patch.object(R, 'Controller', side_effect=AssertionError('no production controller')),
                        patch.object(R, 'locked', side_effect=AssertionError('no locks')),
                        patch.object(R.fcntl, 'flock', side_effect=AssertionError('no flock')),
                        patch.object(socket, 'socket', side_effect=AssertionError('no network'))]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def file(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.write_bytes(data)
        path.chmod(0o600)

    def json(self, path, data):
        self.file(path, R.encode(data))

    def save_capture(self):
        self.json(self.base / 'capture.json', self.cap)

    def leaves(self):
        files = sorted(n for n in self.ui_names if n.endswith('.tsx'))
        return [dict(file=files[i % len(files)], name='synthetic-leaf-' + str(i), native='S' + str(i),
                     sourceSha256=P.sha(P.read(self.repo / files[i % len(files)])), compiledSha256=P.sha(('leaf-' + str(i)).encode())) for i in range(7)]

    def compile_hashes(self):
        return {n: P.sha(('synthetic-compiled ' + n).encode()) for n in self.backend_names}

    def fake_run(self, command, **kwargs):
        self.calls.append((command, kwargs))
        self.assertEqual(kwargs['env'].get('PYTHONDONTWRITEBYTECODE'), '1')
        self.assertNotIn('NODE_OPTIONS', kwargs['env'])
        self.assertNotIn('ESBUILD_BINARY_PATH', kwargs['env'])
        self.assertNotIn('PYTHONPATH', kwargs['env'])
        self.assertEqual(kwargs['cwd'], self.repo)
        if self.fail_command and self.fail_command in command:
            return subprocess.CompletedProcess(command, 1, b'', b'SYNTHETIC FAILURE')
        stdout = b'{}'
        if command[1] == '-e':
            self.assertEqual(command[2], P.BACKEND_HASH_CHECK)
            self.backend_count += 1
            hashes = self.compile_hashes()
            if self.backend_drift and self.backend_count == 2:
                hashes[next(iter(hashes))] = '0' * 64
            stdout = R.encode(hashes)
        elif command[1].endswith('build-native.mjs'):
            if '--verify-sources' in command:
                self.native_count += 1
                leaves = [{k: v[k] for k in ('name', 'native', 'sourceSha256', 'compiledSha256')} for v in self.leaves()]
                if self.native_drift and self.native_count == 2:
                    leaves[0]['compiledSha256'] = '0' * 64
                stdout = R.encode(dict(status='LOCAL_SOURCE_ABI_CHECKED_NO_CAPTURE', productionWrites=0, leaves=leaves,
                                       embeddedFailuresChecked=True, noUnboundNewIdentifiers=True, noNewImports=True))
            else:
                ui = Path(kwargs['env']['CUSTOMER_BATCH_OUT'])
                self.assertEqual(Path(kwargs['env']['CUSTOMER_BATCH_BASE']), self.out / 'baseline')
                modules, assets = [], []
                for name, data in self.blobs.items():
                    if not name.startswith('assets/'):
                        continue
                    new = data + b'// synthetic customer delta\n'
                    relative = 'assets/BusinessWorkbenchPage-customer-batch-' + P.sha(new)[:16] + '.js'
                    self.file(ui / 'package' / relative, new)
                    self.json(ui / 'package/evidence' / (Path(name).name + '.delta.json'), dict(synthetic=True))
                    self.json(ui / 'package/evidence' / (Path(name).name + '.abi.json'), dict(synthetic=True))
                    modules.append(dict(before=name, after=relative, sha256=P.sha(new), size=len(new)))
                    assets.append(dict(relative=relative, sha256=P.sha(new), size=len(new)))
                self.json(ui / 'modules.json', modules)
                self.json(ui / 'assets.json', assets)
                self.json(ui / 'replacements.json', [])
                self.file(ui / 'css-relative.txt', b'assets/synthetic.css\n')
                for name in ('before-index.html', 'after-index.html'):
                    self.file(ui / 'package' / name, self.blobs['admin-index.html'])
                self.json(ui / 'package/evidence/html.json', dict(synthetic=True))
                self.json(ui / 'package/evidence/sources.json', self.leaves())
                self.json(ui / 'package/evidence/source-files.json', dict(
                    sourceHashes={n: P.sha(P.read(self.repo / n)) for n in self.ui_names},
                    sourceStableDuringBuild=True, embeddedFailuresIncluded=True, compiler='esbuild.transform',
                    esbuildVersion='synthetic', builderSha256=P.sha(P.read(self.repo / P.TOOLS[0]))))
        elif command[1].endswith('backend-builder.cjs'):
            freeze = self.out / 'backend-freeze.json'
            if command[2] == 'freeze':
                sources = {}
                for n in self.backend_names:
                    data = P.read(self.repo / n)
                    self.file(self.out / 'backend-freeze-inputs/source' / n, data)
                    sources[n] = dict(sha256=P.sha(data), bytes=len(data))
                for kind in ('front', 'admin'):
                    self.file(self.out / 'backend-freeze-inputs' / (kind + '-api.js'), self.blobs[kind + '-api.js'])
                self.json(freeze, dict(inputRoot=str(self.out / 'backend-freeze-inputs'), sources=sources,
                     tools=dict(core=P.sha(P.read(self.repo / P.TOOLS[3])), builder=P.sha(P.read(self.repo / P.TOOLS[1])), test=P.sha(P.read(self.repo / P.TOOLS[2])))))
            elif command[2] == 'build':
                dest = self.out / 'backend-candidate'
                for kind in ('front', 'admin'):
                    self.file(dest / (kind + '-candidate.mjs'), b'// synthetic candidate\n')
                    self.json(dest / (kind + '-patch-records.json'), dict(patches=[]))
                for n in self.backend_names:
                    self.file(dest / 'compiled-source' / (n + '.js'), ('synthetic-compiled ' + n).encode())
                    self.file(dest / 'compiled-source' / (n + '.map'), b'SYNTHETIC source map')
                self.json(dest / 'vm-tests.json', dict(synthetic=True))
                self.json(dest / 'build-evidence.json', dict(nodeCheck=True, nativeVmTestsPassed=True,
                     entrypointExecuted=False, actualDatabaseAccess=False, freezeSha256=P.sha(P.read(freeze)),
                     nativeVmTestsSha256=P.sha(P.read(dest / 'vm-tests.json'))))
            else:
                self.fail('unknown backend operation')
        elif len(command) > 3 and command[2].endswith('release.py'):
            self.assertEqual(command[3], 'candidate')
            self.assertEqual(command[-1], str(self.out / 'sealed-candidate'))
            (self.out / 'sealed-candidate').mkdir(mode=0o700)
            stdout = R.encode(dict(status='candidate-sealed-not-approved', productionWrites=0))
        else:
            self.fail('unapproved subprocess: ' + repr(command))
        if self.source_drift and self.native_count == 2:
            self.file(self.repo / next(iter(self.backend_names)), b'SYNTHETIC drift')
        return subprocess.CompletedProcess(command, 0, stdout, b'')

    def test_spec_sources_evidence_and_no_production_alias(self):
        with patch.object(Path, 'resolve', side_effect=AssertionError('no alias filesystem resolve')):
            result = P.prepare(self.args)
        self.assertEqual(result['status'], 'prepared-not-sealed-not-approved')
        spec = R.decode(P.read(self.out / 'candidate-spec.json'))
        self.assertEqual(set(spec), set('schema ownerTask ownerNonce capture ui backend sources evidence'.split()))
        self.assertEqual(set(spec['sources']), self.backend_names | self.ui_names | set(P.TOOLS))
        for n, path in spec['sources'].items():
            self.assertEqual(P.sha(P.read(Path(path))), P.sha(P.read(self.repo / n)))
            self.assertTrue(Path(path).is_relative_to(self.out))
            if n in self.backend_names:
                self.assertIn('/backend-freeze-inputs/source/', path)
        for n in self.blobs:
            if n.startswith('assets/'):
                self.assertIn('evidence/baseline/' + n, spec['evidence'])
        self.assertFalse(any(n.startswith('evidence/reviewer/') for n in spec['evidence']))
        for path in [spec['capture'], spec['ui'], *spec['sources'].values(), *spec['evidence'].values()]:
            self.assertTrue(Path(path).is_relative_to(self.out))
        P.private_tree(self.out)
        self.assertEqual(R.native_api.call_count, 2)
        self.assertEqual(R.ui_inverse.call_count, 2)
        self.assertFalse((self.out / 'sealed-candidate').exists())
        self.assertFalse(any('release.py' in ' '.join(cmd) for cmd, _ in self.calls))
        self.assertTrue(all(result[k] == v for k, v in P.FLAGS.items()))

    def source_inputs(self):
        P.prepare(self.args)
        lock = R.decode(P.read(self.out / 'backend-freeze.json'))
        sf = R.decode(P.read(self.out / 'ui/package/evidence/source-files.json'))
        originals = {n: P.sha(P.read(self.repo / n)) for n in self.backend_names | self.ui_names | set(P.TOOLS)}
        return lock, sf, originals

    def test_freeze_source_path_escape_refused(self):
        lock, sf, originals = self.source_inputs()
        lock['inputRoot'] = '/opt/ops/foreign-inputs'
        with self.assertRaisesRegex(P.PrepareError, 'inputRoot escaped'):
            P.collect_sources(self.out, lock, sf, originals, self.backend_names, self.ui_names)

    def test_freeze_source_inventory_mismatch_refused(self):
        lock, sf, originals = self.source_inputs()
        lock['sources'].pop(next(iter(lock['sources'])))
        with self.assertRaisesRegex(P.PrepareError, 'inventory drift'):
            P.collect_sources(self.out, lock, sf, originals, self.backend_names, self.ui_names)

    def test_ui_compiler_source_pin_refused(self):
        lock, sf, originals = self.source_inputs()
        sf['sourceHashes'][next(iter(sf['sourceHashes']))] = '0' * 64
        with self.assertRaisesRegex(P.PrepareError, 'compiled source hash mismatch'):
            P.collect_sources(self.out, lock, sf, originals, self.backend_names, self.ui_names)

    def test_builder_source_bytes_pin_refused(self):
        lock, sf, originals = self.source_inputs()
        sf['builderSha256'] = '0' * 64
        with self.assertRaisesRegex(P.PrepareError, 'builder source SHA mismatch'):
            P.collect_sources(self.out, lock, sf, originals, self.backend_names, self.ui_names)

    def test_frozen_compiled_output_drift_refused(self):
        P.prepare(self.args)
        self.file(self.out / 'backend-candidate/compiled-source' / (next(iter(self.backend_names)) + '.js'), b'changed compilation')
        with self.assertRaisesRegex(P.PrepareError, 'frozen backend compiled hash mismatch'):
            P.check_backend_compilation(self.out, self.compile_hashes(), self.compile_hashes(), self.backend_names, R)

    def test_no_replay_existing_directory_before_subprocess(self):
        self.out.mkdir()
        with self.assertRaisesRegex(P.PrepareError, 'noReplay'):
            P.prepare(self.args)
        self.assertEqual(self.calls, [])

    def test_no_replay_partial_failure(self):
        self.fail_command = 'freeze'
        with self.assertRaisesRegex(P.PrepareError, 'failed'):
            P.prepare(self.args)
        count = len(self.calls)
        self.assertFalse((self.out / 'candidate-spec.json').exists())
        with self.assertRaisesRegex(P.PrepareError, 'noReplay'):
            P.prepare(self.args)
        self.assertEqual(len(self.calls), count)

    def test_existing_file_is_not_overwritten(self):
        self.file(self.out, b'keep')
        with self.assertRaises(P.PrepareError):
            P.prepare(self.args)
        self.assertEqual(self.out.read_bytes(), b'keep')

    def test_symlink_output_refused(self):
        self.out.symlink_to(self.base, target_is_directory=True)
        with self.assertRaisesRegex(P.PrepareError, 'symlink'):
            P.prepare(self.args)
        self.assertFalse(self.calls)

    def test_symlink_input_refused(self):
        p = self.base / 'front-api.js'
        p.unlink()
        p.symlink_to(self.base / 'admin-api.js')
        with self.assertRaisesRegex(P.PrepareError, 'symlink'):
            P.prepare(self.args)
        self.assertFalse(self.out.exists())

    def test_paths_and_argument_rejection(self):
        for value in ('/opt/ops/backend-prepare-x', str(self.work / 'build'), str(self.work / 'nested/backend-prepare-x'),
                      str(self.work / '../backend-prepare-x'), 'backend-prepare-relative'):
            with self.subTest(value=value), self.assertRaises(P.PrepareError):
                P.inputs(argparse.Namespace(**{**vars(self.args), 'out': value}), R)
        for option in ('--capture', '--preflight', '--apply', '--verify', '--rollback', '--approval', '--review', '--node', '--repo', '--mock', '--se'):
            with self.subTest(option=option), patch('sys.stderr'), self.assertRaises(SystemExit):
                P.parser().parse_args(['--base', str(self.base), '--out', str(self.out), '--owner-nonce-file', str(self.nonce), option])

    def test_private_nonce_required(self):
        self.nonce.chmod(0o644)
        with self.assertRaisesRegex(P.PrepareError, 'private'):
            P.prepare(self.args)
        self.assertFalse(self.calls)

    def test_seal_without_report_is_refused_before_build(self):
        self.args.seal = True
        with self.assertRaisesRegex(P.PrepareError, 'independent reviewer'):
            P.prepare(self.args)
        self.assertFalse(self.out.exists())

    def report(self):
        p = self.work / 'external-synthetic-report.txt'
        self.file(p, b'SYNTHETIC external reviewer fixture; NOT a real approval\n')
        self.args.reviewer_report, self.args.reviewer_sha256 = str(p), P.sha(p.read_bytes())
        return p

    def test_report_input_does_not_implicitly_seal(self):
        report = self.report()
        P.prepare(self.args)
        spec = R.decode(P.read(self.out / 'candidate-spec.json'))
        self.assertEqual(P.read(Path(spec['evidence']['evidence/reviewer/independent-report.txt'])), report.read_bytes())
        self.assertFalse((self.out / 'sealed-candidate').exists())

    def test_seal_calls_only_candidate_with_hash_bound_external_input(self):
        self.report()
        self.args.seal = True
        self.assertEqual(P.prepare(self.args)['status'], 'candidate-sealed-not-approved')
        commands = [cmd for cmd, _ in self.calls if 'release.py' in ' '.join(cmd)]
        self.assertEqual(len(commands), 1)
        self.assertEqual(commands[0][3], 'candidate')
        self.assertIn(P.CONTROLLER_SHA, commands[0])
        self.assertFalse(any((self.out / n).exists() for n in ('review.json', 'approval.json', 'receipt')))

    def test_report_hash_mismatch(self):
        self.report()
        self.args.reviewer_sha256 = '0' * 64
        with self.assertRaisesRegex(P.PrepareError, 'hash mismatch'):
            P.prepare(self.args)
        self.assertFalse(self.calls)

    def test_empty_and_missing_report_hash_refused(self):
        p = self.report()
        p.write_bytes(b'')
        self.args.reviewer_sha256 = P.sha(b'')
        with self.assertRaises(P.PrepareError):
            P.prepare(self.args)
        self.args.reviewer_sha256 = None
        with self.assertRaisesRegex(P.PrepareError, 'together'):
            P.prepare(self.args)

    def test_capture_expired_refused(self):
        self.cap['capturedAtUtc'] = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=901)).isoformat()
        self.save_capture()
        with self.assertRaises(R.ReleaseError):
            P.prepare(self.args)
        self.assertFalse(self.calls)

    def test_capture_config_and_meta_mismatch_refused(self):
        for field, value in [('config', {}), ('canonicalMetadataSha256', '0' * 64), ('productionWrites', 1)]:
            old = self.cap[field]
            self.cap[field] = value
            self.save_capture()
            with self.subTest(field=field), self.assertRaises(P.PrepareError):
                P.prepare(self.args)
            self.cap[field] = old
        self.assertFalse(self.calls)

    def test_current_baseline_hash_mismatch_refused(self):
        self.file(self.base / 'front-api.js', b'changed')
        with self.assertRaisesRegex(P.PrepareError, 'baseline mismatch'):
            P.prepare(self.args)
        self.assertFalse(self.out.exists())

    def test_missing_baseline_refused(self):
        (self.base / next(n for n in self.blobs if n.startswith('assets/'))).unlink()
        with self.assertRaises(FileNotFoundError):
            P.prepare(self.args)
        self.assertFalse(self.calls)

    def test_foreign_open_capture_coord_refused(self):
        coord = R.encode(dict(shared_release_active=True, window={}, window_history=[]))
        self.cap['coordBase64'], self.cap['coordRecord'] = base64.b64encode(coord).decode(), dict(sha256=P.sha(coord))
        self.save_capture()
        with self.assertRaisesRegex(R.ReleaseError, 'FOREIGN_OR_OPEN_WINDOW'):
            P.prepare(self.args)
        self.assertFalse(self.calls)

    def test_original_source_and_compilation_drifts_refused(self):
        for flag, message in [('source_drift', 'source drift'), ('native_drift', 'compilation hash'), ('backend_drift', 'backend compiled hash')]:
            with self.subTest(flag=flag):
                setattr(self, flag, True)
                with self.assertRaisesRegex(P.PrepareError, message):
                    P.prepare(self.args)
                self.assertFalse((self.out / 'candidate-spec.json').exists())
                # Each case gets a NEW directory; never deletes/reuses a failed output.
                self.out = self.work / ('backend-prepare-' + flag)
                self.args.out = str(self.out)
                setattr(self, flag, False)
                self.native_count = self.backend_count = 0

    def test_source_inventory_parser_refuses_dynamic_expressions(self):
        with self.assertRaisesRegex(P.PrepareError, 'FILES expression'):
            P.source_names("const FRONT='f/';const SHARED='s/';const FILES=[SHARED+'one.ts',extra()];", 'const C = "c/"; C + "one.tsx"')

    def test_original_controller_pin_refused(self):
        # Only the pin reader is tested; a drifted file is NEVER imported.
        with patch.object(P, 'read', return_value=b'drifted controller'), self.assertRaisesRegex(P.PrepareError, 'controller drift'):
            REAL_LOADER()

    def test_public_helpers_reject_fake_native_records(self):
        # Real helpers, not mocked success, must reject the synthetic empty records.
        for helper, operation in [(REAL_NATIVE_API, 'native_api'), (REAL_UI_INVERSE, 'ui_inverse')]:
            with self.subTest(operation=operation), self.assertRaises(R.ReleaseError):
                if operation == 'native_api':
                    helper(b'{}', b'old', b'new', R.Config().front_api, {})
                else:
                    helper({}, b'old', b'new')

    def test_r3_current_controller_sha_and_scope_fixed(self):
        self.assertEqual(P.CONTROLLER_SHA, P.sha((HERE/'release.py').read_bytes()))
        self.assertEqual(R.SCOPE, 'customer-batch-actions-20261120-6Lfttf6o-R4')
        self.assertEqual(str(R.Config().stage), '/opt/ops/customer-batch-actions-20261120-6Lfttf6o-R4')
        self.assertEqual(R.OWNER, '6Lfttf6oVWJ8YS69o5FkXQ')

    def test_old_failed_stage_scope_capture_is_not_reusable(self):
        self.cap['scope'] = 'customer-batch-actions-20261120-6Lfttf6o'
        self.save_capture()
        with self.assertRaisesRegex(P.PrepareError, 'fixed production capture binding'):
            P.prepare(self.args)
        self.assertFalse(self.out.exists())
        self.assertEqual(self.calls, [])

    def test_old_7fc9_controller_capture_is_not_reusable(self):
        self.cap['controllerSha256'] = '7fc9ec42ce21f6d0167b36ffbbe7642865a16f70fc31f8b99bf0da4862598423'
        self.save_capture()
        with self.assertRaisesRegex(P.PrepareError, 'fixed production capture binding'):
            P.prepare(self.args)
        self.assertFalse(self.out.exists())
        self.assertEqual(self.calls, [])


    def test_r2_scope_and_d6_controller_capture_not_reusable_in_r3(self):
        for key,value in [('scope','customer-batch-actions-20261120-6Lfttf6o-R2'),
                          ('controllerSha256','d6f724847e205005060b6d11e0b15d7e31ba0ce373119187d062aba437e4cdec')]:
            old=self.cap[key]; self.cap[key]=value; self.save_capture()
            with self.subTest(key=key),self.assertRaisesRegex(P.PrepareError,'fixed production capture binding'):
                P.prepare(self.args)
            self.cap[key]=old
        self.assertEqual(self.calls,[]); self.assertFalse(self.out.exists())

    def test_r3_private_root_union_cannot_be_omitted_from_capture(self):
        root='/var/lib/dianzi51-private'
        self.assertIn(root,self.cap['protectionUnion']['paths'])
        self.cap['protectionUnion']['paths'].remove(root); self.save_capture()
        with self.assertRaisesRegex(P.PrepareError,'protection union mismatch'):P.prepare(self.args)
        self.assertEqual(self.calls,[]); self.assertFalse(self.out.exists())

    def test_r3_scope_and_bf7_capture_not_reusable_in_r4(self):
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

if __name__ == '__main__':
    unittest.main()
