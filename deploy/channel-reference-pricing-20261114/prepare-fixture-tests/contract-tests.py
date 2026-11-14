#!/usr/bin/env python3
"""Finite contract regression fixtures only; never formal readiness or live evidence.

Reuses the existing explicitly labelled driver simulation. Its live_evidence
boundary accepts ONLY fixtureOnly=True, and is restored/tested below. No main(),
Git, production entry, HTTP, SSH, DB, PM2 or runtime service execution occurs.
"""
import argparse
import ast
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent
BASELINE = Path('/home/ubuntu/work/channel-reference-phase2-20261114/baseline')
RECEIPT = BASELINE / 'previous-source-receipt.json'
RECEIPT_SHA = '8e99c5975c8a8a6af1b78ab392fe32d3624d4431e00ce523fc41479707604010'
CONFIGS = {'package.json', 'pnpm-lock.yaml', 'tsconfig.json'}
RUNTIME = Path('/opt/ops/20261114-channel-reference-pricing-CKSZQ7s')


def module(file):
    value = types.ModuleType(file.stem.replace('-', '_'))
    value.__file__ = str(file)
    exec(compile(file.read_bytes(), str(file), 'exec'), value.__dict__)
    return value


p = module(TOOLS / 'prepare-snapshot-package.py')
offline = module(TOOLS / 'driver-test-offline.py')


class ContractFixtures(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('NETWORK_FORBIDDEN')))
        self.stack.enter_context(mock.patch.object(subprocess, 'run', side_effect=AssertionError('SUBPROCESS_FORBIDDEN')))
        self.f = offline.Fixture()
        self.addCleanup(self.f.close)
        self.d = self.f.d
        self.proofs = tuple(self.d.json_file(n) for n in ('candidate-proof.json', 'backend-candidate-proof.json'))
        self.meta = self.d.json_file('service-metafile.json')

    def source_graph(self, prior, front=None):
        return p.source_graph(prior, self.proofs[0]['sourceHashes'] if front is None else front,
                              self.proofs[1]['sourceHashes'],
                              {n: self.f.manifest['sourceHashes'][n] for n in self.meta['inputs']}, self.meta)

    def test_actual_complete_105_prior_config_admission_sha_and_gitblob(self):
        e = p.Inputs()
        raw = e.read(RECEIPT, RECEIPT_SHA)
        receipt = p.decode(raw)
        original = copy.deepcopy(receipt)
        prior = receipt['sourceHashes']
        self.assertEqual(receipt['gitCommit'], p.C3)
        self.assertEqual(len(prior), 105)
        self.assertEqual(set(prior) - {n for n in prior if n.startswith(('client/', 'server/', 'shared/'))}, CONFIGS)
        self.assertEqual(set(receipt['sourceBlobIds']), set(prior))
        current, graph = self.source_graph(prior)
        self.assertEqual(set(current), set(prior) | set(graph))
        for name, pin in prior.items():
            data = e.read(BASELINE / 'source-snapshot' / name, pin)
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            self.assertEqual(blob, receipt['sourceBlobIds'][name], name)
            self.assertEqual(current[name], pin, name)
            offline.write(self.f.root / 'source-snapshot' / name, data)
        # Preserve the COMPLETE receipt bytes and every field, not a reduced receipt.
        offline.write(self.f.root / 'previous-source-receipt.json', raw)
        manifest = copy.deepcopy(self.f.manifest)
        manifest.update(sourceHashes=current, sourceHashSnapshot=current, priorSourceHashes=prior, newSourceGraphPaths=graph)
        self.d.source_contract(manifest, self.proofs)
        self.assertEqual(receipt, original)
        self.assertEqual((self.f.root / 'previous-source-receipt.json').read_bytes(), raw)
        e.cas()

    def test_root_env_packageother_external_paths_refused_by_both(self):
        paths = ('.env', '.env.production', 'packageother.json', 'package.json.bak',
                 'pnpm-lock.yaml.bak', 'tsconfig.other.json', 'external/package.json',
                 'deploy/.env', '/etc/passwd', '../package.json', 'client/../../.env')
        for name in paths:
            with self.subTest(name=name):
                prior = dict(self.f.manifest['priorSourceHashes'], **{name: '0' * 64})
                with self.assertRaisesRegex(RuntimeError, 'UNSAFE_PRIOR_SOURCE_PIN|UNSAFE_RELATIVE_PATH'):
                    self.source_graph(prior)
                manifest = copy.deepcopy(self.f.manifest)
                manifest['priorSourceHashes'][name] = '0' * 64
                manifest['sourceHashes'][name] = '0' * 64
                manifest['sourceHashSnapshot'] = manifest['sourceHashes']
                self.d.save(self.f.root / 'previous-source-receipt.json', {'gitCommit': p.C3, 'sourceHashes': prior, 'fixtureOnly': True})
                with self.assertRaisesRegex(RuntimeError, 'UNSAFE_SOURCE_PIN|UNSAFE_PATH'):
                    self.d.source_contract(manifest, self.proofs)

    def test_root_configs_cannot_enter_new_graph(self):
        for name in sorted(CONFIGS):
            with self.subTest(name=name):
                front = dict(self.proofs[0]['sourceHashes'], **{name: self.f.manifest['sourceHashes'][name]})
                with self.assertRaisesRegex(RuntimeError, 'PRIVATE_OR_NON_SOURCE_GRAPH_PATH'):
                    self.source_graph(self.f.manifest['priorSourceHashes'], front)
                proofs = copy.deepcopy(self.proofs)
                proofs[0]['sourceHashes'] = front
                manifest = copy.deepcopy(self.f.manifest)
                manifest['newSourceGraphPaths'].append(name)
                with self.assertRaisesRegex(RuntimeError, 'UNSAFE_SOURCE_PIN'):
                    self.d.source_contract(manifest, proofs)

    def test_config_hash_drift_and_complete_union_still_refused(self):
        for name in sorted(CONFIGS):
            with self.subTest(name=name):
                file = self.f.root / 'source-snapshot' / name
                before = file.read_bytes()
                file.write_bytes(b'CHANGED EXPLICIT OFFLINE FIXTURE')
                with self.assertRaisesRegex(RuntimeError, 'SOURCE_SNAPSHOT_CHANGED'):
                    self.d.source_contract(self.f.manifest, self.proofs)
                file.write_bytes(before)
                manifest = copy.deepcopy(self.f.manifest)
                manifest['sourceHashes'].pop(name)
                manifest['sourceHashSnapshot'] = manifest['sourceHashes']
                with self.assertRaisesRegex(RuntimeError, 'CURRENT_SOURCE_SNAPSHOT_UNION_REQUIRED'):
                    self.d.source_contract(manifest, self.proofs)
                manifest = copy.deepcopy(self.f.manifest)
                manifest['sourceHashes'][name] = offline.write(file, b'NEW UNRELATED CONFIG FIXTURE')
                manifest['sourceHashSnapshot'] = manifest['sourceHashes']
                with self.assertRaisesRegex(RuntimeError, 'UNRELATED_PRIOR_SOURCE_CHANGED'):
                    self.d.source_contract(manifest, self.proofs)
                file.write_bytes(before)

    def change_import(self, value):
        native = self.d.json_file('fixture-admin-native.json')
        native['serviceImportBridge']['fixedImport'] = value
        self.d.save(self.f.root / 'fixture-admin-native.json', native)
        self.f.manifest['evidenceHashes']['fixture-admin-native.json'] = self.d.sha(self.f.root / 'fixture-admin-native.json')
        self.f.refresh_package()

    def test_false_fixed_import_refused_even_when_all_metadata_rehashed(self):
        for value in (str(self.f.root / 'channel-reference-service.mjs'),
                      str(RUNTIME / 'other.mjs'), '/opt/ops/foreign/channel-reference-service.mjs'):
            with self.subTest(value=value):
                self.change_import(value)
                with self.assertRaisesRegex(RuntimeError, 'SERVICE_ARTIFACT_SOURCE_BOUND_METADATA_REQUIRED'):
                    self.d.validate_manifest(self.f.manifest)

    def test_local_package_pure_validator_and_prepare_export_no_production_io(self):
        self.assertEqual(self.d.RUNTIME_ROOT, RUNTIME)
        self.assertNotEqual(self.d.ROOT, self.d.RUNTIME_ROOT)
        e = p.Inputs()
        for name, pin in self.f.manifest['packageHashes'].items():
            e.package[name] = e.read(self.f.root / name, pin)
        # An explicit local parent, always removed; no enduring deployable fixture.
        with tempfile.TemporaryDirectory(prefix='contract-fixture-', dir=p.WORK_ROOT) as stage:
            allowed = (self.f.base, Path(stage))
            original_open, original_os_open = io.open, os.open
            def check(path):
                if isinstance(path, int):
                    return
                target = Path(path).absolute()
                self.assertTrue(any(target.is_relative_to(base) for base in allowed), 'NONLOCAL_IO_FORBIDDEN: ' + str(target))
            def guarded_open(path, *args, **kwargs):
                check(path)
                return original_open(path, *args, **kwargs)
            def guarded_os_open(path, *args, **kwargs):
                dir_fd = kwargs.get('dir_fd')
                check(Path(os.readlink('/proc/self/fd/' + str(dir_fd))) / path
                      if dir_fd is not None and not Path(path).is_absolute() else path)
                return original_os_open(path, *args, **kwargs)
            old_root = self.d.ROOT
            with mock.patch.object(io, 'open', side_effect=guarded_open), mock.patch.object(os, 'open', side_effect=guarded_os_open), \
                    mock.patch.object(self.d, 'main', side_effect=AssertionError('MAIN_FORBIDDEN')):
                self.d.validate_manifest(self.f.manifest)
                output = p.export(e, self.d, self.f.manifest, str(Path(stage) / 'fixture-export'))
                self.assertTrue(output.is_dir())
                for name, pin in self.f.manifest['packageHashes'].items():
                    self.assertEqual(p.sha((output / name).read_bytes()), pin)
                self.assertEqual(json.loads((output / 'fixture-admin-native.json').read_text())['serviceImportBridge']['fixedImport'], str(RUNTIME / 'channel-reference-service.mjs'))
            self.assertEqual(self.d.ROOT, old_root)
            self.assertEqual(self.d.RUNTIME_ROOT, RUNTIME)
            self.assertEqual(self.f.reloads, [])

    def test_unmocked_fixture_gate_still_refuses_and_failed_export_restores_root(self):
        e = p.Inputs()
        for name, pin in self.f.manifest['packageHashes'].items():
            e.package[name] = e.read(self.f.root / name, pin)
        self.d.live_evidence = self.f.real_live_evidence
        with self.assertRaisesRegex(RuntimeError, 'SIMULATED_EVIDENCE_NOT_LIVE'):
            self.d.validate_manifest(self.f.manifest)
        old_root = self.d.ROOT
        with tempfile.TemporaryDirectory(prefix='contract-refusal-fixture-', dir=p.WORK_ROOT) as stage:
            output = Path(stage) / 'must-not-export'
            with self.assertRaisesRegex(RuntimeError, 'ACTUAL_DRIVER_OFFLINE_VALIDATOR_REFUSED.*SIMULATED_EVIDENCE_NOT_LIVE'):
                p.export(e, self.d, self.f.manifest, str(output))
            self.assertFalse(output.exists())
        self.assertEqual(self.d.ROOT, old_root)
        self.assertEqual(self.d.RUNTIME_ROOT, RUNTIME)

    def test_prepare_readiness_pending_and_fixture_gates_unchanged(self):
        for value in ({'status': 'PASS', 'fixtureOnly': False, 'ready': False},
                      {'status': 'PASS', 'fixtureOnly': False, 'formalJSONNotReady': True},
                      {'status': 'PASS', 'fixtureOnly': False, 'liveEvidencePendingResearch': True},
                      {'status': 'PASS', 'fixtureOnly': True}):
            with self.subTest(value=value), self.assertRaisesRegex(RuntimeError, 'NOT_READY|MARKED_FIXTURE_NOT_FORMAL'):
                p.passed(value, 'pending fixture', formal=True)
        # Structural guard: full prepare cannot read/copy source pins before readiness.
        body = next(n for n in ast.parse((TOOLS / 'prepare-snapshot-package.py').read_bytes()).body if isinstance(n, ast.FunctionDef) and n.name == 'prepare')
        text = ast.unparse(body)
        self.assertLess(text.index("passed(obj['snapshotReadinessProof']"), text.index('source_graph('))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--test', action='append', help='exact method name; omitted means these eight contract fixtures only')
    args = parser.parse_args()
    suite = unittest.TestSuite(ContractFixtures(name) for name in args.test) if args.test else unittest.defaultTestLoader.loadTestsFromTestCase(ContractFixtures)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print(json.dumps({'fixtureOnly': True, 'liveEvidence': False, 'productionActivationReady': False,
                      'scope': 'two contract conflicts only', 'testsRun': result.testsRun,
                      'failures': len(result.failures), 'errors': len(result.errors),
                      'formalValidationStatus': 'PENDING_PARENT_FINAL_VALIDATION'}, ensure_ascii=False))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
