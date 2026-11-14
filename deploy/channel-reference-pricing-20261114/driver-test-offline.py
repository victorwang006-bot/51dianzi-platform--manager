#!/usr/bin/env python3
"""Offline only: synthetic temp namespace, mocked HTTP/PM2, AST and Node VM.
No production CLI apply/deploy, network, Git, SSH, DB or browser execution.
"""
import argparse
import ast
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import py_compile
import socket
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
W = Path('/home/ubuntu/work/channel-reference-batch-299-20261114')
DRIVER = HERE / 'activate-channel-reference-pricing.py'
RELOADER = HERE / 'reload-channel-reference-api.cjs'
BINDER = HERE / 'bind-source.py'


def module(file):
    m = types.ModuleType(file.stem.replace('-', '_'))
    m.__file__ = str(file)
    exec(compile(file.read_bytes(), str(file), 'exec'), m.__dict__)
    return m


def hs(data):
    return hashlib.sha256(data).hexdigest()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return hs(data)


class Fixture:
    """Every file is under tmp; collection evidence is explicitly fixtureOnly=True.
    Only a mocked live_evidence boundary accepts it in simulations. No live pass fabricated.
    """
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory(prefix='offline-pricing-fixture-')
        self.base = Path(self.temp.name)
        self.d = module(DRIVER)
        self.real_live_evidence = self.d.live_evidence
        self.d.live_evidence = lambda value: self.d.require(value.get('fixtureOnly') is True, 'SIMULATION_MUST_BE_LABELLED')
        self.root = self.base / 'namespace'; self.root.mkdir()
        self.public = self.base / 'public'; self.public.mkdir(); (self.public / 'assets').mkdir()
        self.admin = self.base / 'admin.js'; self.front = self.base / 'front.js'
        self.front_html = self.base / 'protected/front/dist/public/index.html'
        self.protected = [self.front_html, self.base / 'protected/nginx.conf', self.base / 'protected/dump.pm2', self.front]
        self.coord = self.base / 'coord.json'
        self.d.ROOT = self.root; self.d.PUBLIC = self.public; self.d.COORD = self.coord
        self.d.APIS = {'dianzi51-admin': str(self.admin)}; self.d.FRONT_API = str(self.front)
        self.d.PROTECTED_PATHS = {str(p) for p in self.protected}
        self.d.LOCK_PATHS = (str(self.base / 'public.lock'), str(self.base / 'code.lock'))
        self.state = {'shared_release_active': False, 'window': {'owner_task': 'prior', 'task': 'prior'}, 'window_history': []}
        self.d.save(self.coord, self.state)
        self.rows = []
        for ident in [0, 190, 191, 192, 193, 200, 201, 202, 203, 204, 205, 206]:
            self.rows.append({'id': ident, 'name': 'dianzi51-admin' if ident in (191, 192) else ('dianzi51' if ident in (190, 193, 200) else 'worker-' + str(ident)),
                'pid': 10000 + ident, 'status': 'online', 'script': str(self.admin) if ident in (191, 192) else str(self.front),
                'cwd': '/frozen/cwd', 'execMode': 'cluster_mode' if ident in (191, 192) else 'fork_mode', 'environmentHash': hs(b'frozen-environment')})
        imports = [{'text': 'import { x as i%d } from "fixture-%d";' % (i, i), 'specifier': 'fixture-%d' % i} for i in range(130)]
        declarations = [{'name': 'f%d' % i, 'sha256': hs(('const f%d=%d;' % (i, i)).encode()), 'bytes': len(('const f%d=%d;' % (i, i)).encode())} for i in range(1092)]
        old_admin_bytes = ('\n'.join(x['text'] for x in imports) + '\n' + '\n'.join('const f%d=%d;' % (i, i) for i in range(1092)) + '\nconst businessRouter={channelInventory:1};\n').encode()
        self.old_admin = write(self.admin, old_admin_bytes)
        write(self.root / 'baseline/admin-index.js', old_admin_bytes)
        write(self.front, b'frozen-front'); self.d.FIXED_FRONT_API_SHA256 = self.d.sha(self.front)
        for p in self.protected:
            if not p.exists(): write(p, b'protected-' + p.name.encode())
        protected = [{'path': str(p), 'sha256': self.d.sha(p)} for p in self.protected]
        oldassets = []
        files = []; inverses = []
        relocations = {}; oldmap = {'imports': {}, 'scopes': {}}
        for i in range(2):
            old_bytes = ('import { a } from "fixture";\nexport const workbench%d="😀";\n' % i).encode()
            oldrel = 'assets/BusinessWorkbenchPage-%d-native-%s.js' % (i, hs(old_bytes))
            oldassets.append({'relative': oldrel, 'sha256': write(self.public / oldrel, old_bytes)})
            write(self.root / 'baseline' / oldrel, old_bytes)
            new_bytes = old_bytes + b'// offline fixture new host body\n'
            newrel = 'assets/BusinessWorkbenchPage-%d-channel-reference-pricing-%s.js' % (i, hs(new_bytes))
            files.append({'relative': newrel, 'sha256': write(self.root / 'candidate' / newrel, new_bytes)})
            length = len(old_bytes.decode().encode('utf-16-le')) // 2
            nlength = len(new_bytes.decode().encode('utf-16-le')) // 2
            inv = {'sha256': hs(new_bytes), 'beforeSha256': hs(old_bytes), **{f: True for f in ('exactInverse', 'allNonpatchBytesUnchanged', 'allOldSpecifiersPreserved', 'importsByteIdentical', 'exportsByteIdentical')},
                'beforeUrl': '/' + oldrel, 'url': '/' + newrel, 'fixtureOnly': True,
                'unchangedPartitions': [{'beforeStart': 0, 'beforeEnd': length, 'afterStart': 0, 'afterEnd': length, 'sha256': hs(old_bytes)}, {'beforeStart': length, 'beforeEnd': length, 'afterStart': nlength, 'afterEnd': nlength, 'sha256': hs(b'')}],
                'patches': [{'start': length, 'end': length, 'afterStart': length, 'afterEnd': nlength, 'beforeSha256': hs(b''), 'afterSha256': hs(new_bytes[len(old_bytes):])}]}
            name = 'fixture-frontend-%d-inverse.json' % i
            self.d.save(self.root / name, inv); inverses.append(name)
            oldmap['imports']['/alias/%d' % i] = '/' + oldrel
            oldmap['scopes']['/' + oldrel] = {'fixture': '/' + oldrel}
            relocations['/' + oldrel] = '/' + newrel
        oldassets.append({'relative': 'assets/old-main.js', 'sha256': write(self.public / 'assets/old-main.js', b'public-main-preserved')})
        write(self.root / 'baseline/assets/old-main.js', b'public-main-preserved')
        old_html_bytes = ('<!doctype html><html><script type="importmap">' + json.dumps(oldmap) + '</script></html>').encode()
        self.old_html = write(self.public / 'index.html', old_html_bytes); write(self.root / 'baseline/index.html', old_html_bytes)
        newmap = copy.deepcopy(oldmap)
        for table in [newmap['imports'], *newmap['scopes'].values()]:
            for k, v in table.items(): table[k] = relocations.get(v, v)
        for old, new in relocations.items():
            newmap['imports'][old] = new; newmap['scopes'][new] = copy.deepcopy(newmap['scopes'][old])
        new_html_bytes = ('<!doctype html><html><script type="importmap">' + json.dumps(newmap) + '</script></html>').encode()
        files.insert(0, {'relative': 'index.html', 'sha256': write(self.root / 'candidate/index.html', new_html_bytes)})
        patches = []; newadmin = old_admin_bytes
        newpos = len(old_admin_bytes)
        for i in range(8):
            data = ('\n// insert-only fixture %d\n' % i).encode()
            patches.append({'name': 'fixture-%d' % i, 'oldByteStart': len(old_admin_bytes), 'oldByteEnd': len(old_admin_bytes), 'newByteStart': newpos, 'newByteEnd': newpos + len(data), 'oldSha256': hs(b''), 'newSha256': hs(data)})
            newadmin += data; newpos += len(data)
        backend = {'processName': 'dianzi51-admin', 'path': str(self.admin), 'relative': 'api/admin-index.js', 'sha256': write(self.root / 'candidate/api/admin-index.js', newadmin), 'beforeSha256': self.old_admin}
        pins = {}
        for i in range(102):
            relative = 'client/prior-%d.ts' % i
            pins[relative] = write(self.root / 'source-snapshot' / relative, ('prior-%d' % i).encode())
        for relative in ('package.json', 'pnpm-lock.yaml', 'tsconfig.json'):
            pins[relative] = write(self.root / 'source-snapshot' / relative, ('EXPLICIT OFFLINE CONFIG FIXTURE ' + relative).encode())
        prior = dict(pins)
        sources = {'client/new.ts': b'client-fixture', 'server/new.ts': b'server-fixture', 'shared/new.ts': b'shared-fixture',
            'server/channelReference/service.ts': b'import { createChannelReferenceSnapshotService } from "./snapshot";\nconst service = createChannelReferenceSnapshotService();\nexport const lookupChannelReferences = service.lookup;\n',
            'server/channelReference/snapshot.ts': b'const SNAPSHOT_FILE = new URL("./channel-reference-snapshot.json", import.meta.url);\n'}
        for relative, data in sources.items(): pins[relative] = write(self.root / 'source-snapshot' / relative, data)
        self.d.save(self.root / 'previous-source-receipt.json', {'gitCommit': 'aeaf9f87f2fc96e210a635eee17c491f43df757a', 'sourceHashes': prior, 'fixtureOnly': True})
        meta = {'inputs': {r: {} for r in ['server/channelReference/service.ts', 'server/channelReference/snapshot.ts', 'shared/new.ts']}, 'outputs': {'channel-reference-service.mjs': {'entryPoint': 'server/channelReference/service.ts', 'exports': ['lookupChannelReferences'], 'imports': [{'external': True, 'path': 'node:fs'}]}}}
        self.d.save(self.root / 'service-metafile.json', meta)
        self.when = '2026-11-14T08:00:00.000Z'
        records = []
        capture = []
        for i in range(294):
            part, brand = 'OFFLINE-FIXTURE-%03d' % i, 'FIXTURE-BRAND'
            capture.append({'materialId': i + 1, 'partNumber': part, 'brand': brand})
            q = {source: self.empty_quote(source) for source in ('lcsc', 'ickey')}
            records.append({'partNumber': part, 'brand': brand, 'references': q, 'evidence': {'lcsc': None, 'ickey': None}})
        for i in range(5): capture.append({'materialId': 295 + i, 'partNumber': records[i]['partNumber'], 'brand': records[i]['brand']})
        # A positive source and real-negative-shaped sources exercise both branches.
        q = records[0]['references']['lcsc']
        q.update(status='ok', matchedPartNumber=records[0]['partNumber'], matchedBrand='FIXTURE-BRAND', pageUrl='https://item.szlcsc.com/123.html', stockQuantity=2, unitPrice='0.01', tierQuantity=1000, tiers=[{'minQuantity': 1000, 'unitPrice': '0.01'}], currency='CNY', stockInsufficientForTier=True)
        records[0]['evidence']['lcsc'] = {'expectedPartNumber': records[0]['partNumber'], 'expectedBrand': records[0]['brand'], 'observedPartNumber': q['matchedPartNumber'], 'observedBrand': q['matchedBrand'], 'brandMatch': 'exact', 'literalReason': None, 'pageUrl': q['pageUrl'], 'collectedAt': self.when, 'observedMaxQuantity': 1000, 'observedMaxUnitPrice': '0.01', 'maxTierConfirmed': True}
        scope = {'confirmed': True, 'nativeVisibleCount': 299, 'uniquePairCount': 294, 'optionalNarrowingFiltersApplied': [], 'stockFieldsSelected': ['materialId', 'partNumber', 'brand'], 'moduleReadConfirmed': True, 'officialSuperAdminBusinessLeaderReadProofConfirmed': True, 'deployedFrontSourcePath': str(self.front), 'deployedFrontSourceSha256': self.d.sha(self.front), 'deployedAdminSourcePath': str(self.admin), 'deployedAdminSourceSha256': self.old_admin}
        self.d.save(self.root / 'inventory-input.json', {'fixtureOnly': True, 'capturedAt': self.when, 'count': 299, 'records': capture, 'scopeEvidence': scope})
        self.d.save(self.root / 'channel-reference-snapshot.json', {'schemaVersion': 1, 'collectionMode': 'public-web-batch', 'generatedAt': self.when, 'records': records})
        pairs = {}
        for row in capture: pairs.setdefault((row['partNumber'], row['brand']), []).append(row['materialId'])
        identity = [{'partNumber': p, 'brand': b, 'materialIds': sorted(ids)} for (p, b), ids in sorted(pairs.items())]
        observations = []
        (self.root / 'collection-evidence').mkdir()
        for i, r in enumerate(records):
            for source in ('lcsc', 'ickey'):
                quote = r['references'][source]
                url = quote['pageUrl'] or ('https://www.szlcsc.com/' if source == 'lcsc' else 'https://www.ickey.cn/')
                rel = 'collection-evidence/fixture-%03d-%s.json' % (i, source)
                entry = {'partNumber': r['partNumber'], 'brand': r['brand'], 'source': source, 'status': quote['status'], 'queryPerformed': True, 'collectedAt': self.when, 'sourceUrl': url}
                evidence = {**entry, 'fixtureOnly': True, 'observationKind': 'product-detail' if quote['status'] == 'ok' else 'search-results', 'observedText': 'EXPLICIT OFFLINE SIMULATION %s %s 0.01 1000' % (r['partNumber'], r['brand']), 'positiveEvidence': r['evidence'][source], 'negativeReason': 'EXPLICIT OFFLINE SIMULATION no exact result'}
                self.d.save(self.root / rel, evidence)
                observations.append({**entry, 'file': rel, 'sha256': self.d.sha(self.root / rel)})
        receipt = {'contractVersion': 'public-web-collection-v1', 'ownerTask': self.d.TASK, 'collectionMode': 'public-web-batch', 'collectedAt': self.when, 'snapshotFileSha256': self.d.sha(self.root / 'channel-reference-snapshot.json'), 'inventoryCaptureSha256': self.d.sha(self.root / 'inventory-input.json'), 'identityMapSha256': self.d.digest(identity), 'fixtureOnly': True, 'observations': observations}
        self.d.save(self.root / 'collection-receipt.json', receipt)
        binding = {'snapshotFile': 'channel-reference-snapshot.json', 'fileSha256': receipt['snapshotFileSha256'], 'collectedAt': self.when, 'collectionReceiptSha256': self.d.sha(self.root / 'collection-receipt.json'), 'inventoryCaptureSha256': receipt['inventoryCaptureSha256'], 'identityMapSha256': receipt['identityMapSha256'], 'notGitPrivateInventory': True}
        self.d.save(self.root / 'snapshot-readiness-proof.json', {'status': 'PASS', 'ready': True, 'snapshotBinding': binding, 'recordCount': 294, 'capturedCount': 299, 'queriedSourcePairs': 588, 'identityMap': identity, 'sourceIdentityRechecked': True, 'snapshotSchemaStrictlyValidated': True, 'fixtureOnly': True})
        helpers = [{'relative': name, 'sha256': self.d.sha(self.root / name) if name.endswith('.json') else write(self.root / name, b'// INERT OFFLINE FIXTURE service, never executed\n')} for name in sorted(self.d.HELPERS)]
        self.d.save(self.root / 'service-graph-proof.json', {'status': 'PASS', 'snapshotOnly': True, 'fixtureOnly': True, 'independentlyBuiltTwice': True, 'outputAndMetafileReproductionByteExact': True, 'artifact': 'channel-reference-service.mjs', 'artifactSha256': self.d.sha(self.root / 'channel-reference-service.mjs'), 'metafileSha256': self.d.sha(self.root / 'service-metafile.json'), 'sourceHashes': {r: pins[r] for r in meta['inputs']}, 'executed': False, 'networkExecution': False, 'databaseAccess': False, 'browserWorkerRequired': False})
        proof = {'status': 'PASS', **{key: True for key in self.d.PROOF_FLAGS}, 'sourceBindingsVerified': True, 'sourceHashes': {'client/new.ts': pins['client/new.ts']}, 'standaloneHelpers': helpers, 'files': files, 'nativeProofEvidence': inverses}
        backend_proof = {'status': 'PASS', **{key: True for key in ('sourceBound', 'sourceBindingsVerified', 'unrelatedBytesUnchanged', 'newRootRegistered', 'anonymousAuthorizationBeforeBusinessIO', 'runtimeHelperSourceGraphVerified')}, 'sourceHashes': {r: pins[r] for r in sources if r.startswith(('server/', 'shared/'))}, 'standaloneHelpers': helpers, 'backendFiles': [backend], 'nativeProofEvidence': 'fixture-admin-native.json'}
        native = {'status': 'PASS', 'candidateSha256': backend['sha256'], 'sourceBound': True, 'unrelatedBytesUnchanged': True, 'sourcePins': backend_proof['sourceHashes'], 'inverse': {'byteExact': True, 'sha256': self.old_admin, 'allOutsideSlotsByteIdentical': True}, 'protectedDeclarations': {'count': 1092, 'declarations': declarations}, 'nativePatches': patches,
            'importDelta': {'oldCount': 130, 'oldImports': imports}, 'rootProtection': {'protectedCount': 24, 'protectedProperties': [{'name': 'root%d' % i, 'sha256': hs(('fixture-root-%d' % i).encode()), 'bytes': 14} for i in range(24)]},
            'productionEntryExecuted': False, 'entireApiBundled': False, 'frontUnchanged': True, 'appRouterProfileStaffBytesUnchanged': True,
            'serviceImportBridge': {'fixedImport': str(self.d.RUNTIME_ROOT / 'channel-reference-service.mjs'), 'sourceModule': 'server/channelReference/service.ts', 'sourceExport': 'lookupChannelReferences', 'serviceArtifact': {'sourceGraphReproductionProved': True, 'sha256': self.d.sha(self.root / 'channel-reference-service.mjs'), 'metafileSha256': self.d.sha(self.root / 'service-metafile.json'), 'sourceSha256': pins['server/channelReference/service.ts']}}}
        self.d.save(self.root / 'fixture-admin-native.json', native)
        self.d.save(self.root / 'candidate-proof.json', proof); self.d.save(self.root / 'backend-candidate-proof.json', backend_proof)
        self.d.save(self.root / 'html-build-proof.json', {'status': 'PASS', 'beforeSha256': self.old_html, 'sha256': files[0]['sha256'], 'relocations': relocations, **{k: True for k in ('exactInverse', 'htmlOnlyImportmap', 'noCssAdded', 'allOldTagsByteIdentical', 'oldNativeEntryByteAndUrlUnchanged', 'allOldStylesheetTagsByteRetained')}})
        baseline = {'capturedAtUtc': self.when, 'beforeHtmlSha256': self.old_html, 'api': {'admin': self.old_admin, 'front': self.d.sha(self.front)}, 'apiPaths': {'admin': str(self.admin), 'front': str(self.front)}, 'publicRoot': str(self.public), 'baselineAssets': oldassets, 'protectedFiles': protected, 'processes': copy.deepcopy(self.rows), 'coordSha256': self.d.sha(self.coord), 'sharedReleaseActive': False}
        self.d.save(self.root / 'live-baseline-current.json', baseline)
        for file in (DRIVER, RELOADER, BINDER, Path(__file__)): write(self.root / file.name, file.read_bytes())
        self.validation_checks = []
        for kind in ['typecheck', 'source-tests', 'frontend-native-tests', 'backend-native-tests', 'driver-offline-tests', 'review']:
            name = 'fixture-validation-' + kind + '.json'
            self.d.save(self.root / name, {'status': 'PASS', 'sourceHashes': pins, 'fixtureOnly': True, 'checks': [{'status': 'PASS', 'finding': 'EXPLICIT OFFLINE SIMULATED review finding only'}]})
            self.validation_checks.append({'kind': kind, 'status': 'PASS', 'exitCode': 0, 'command': ['OFFLINE_SIMULATED_NO_COMMAND_EXECUTED', kind], 'completedAt': self.when, 'evidenceFile': name, 'evidenceSha256': self.d.sha(self.root / name), 'passed': 1, 'failed': 0})
        self.d.save(self.root / 'validation-proof.json', {'contractVersion': 'offline-validation-v1', 'ownerTask': self.d.TASK, 'status': 'PASS', 'fixtureOnly': True, 'sourceHashes': pins, 'checks': self.validation_checks})
        names = ['candidate-proof.json', 'backend-candidate-proof.json', RELOADER.name, BINDER.name, 'live-baseline-current.json', 'previous-source-receipt.json', 'service-metafile.json', 'service-graph-proof.json', 'snapshot-readiness-proof.json', 'collection-receipt.json', 'inventory-input.json', 'validation-proof.json', 'html-build-proof.json', 'fixture-admin-native.json', *inverses, *[r['evidenceFile'] for r in self.validation_checks]]
        self.manifest = {'contractVersion': 'snapshot-pricing-v1', 'snapshotOnly': True, 'ownerTask': self.d.TASK, 'files': files, 'coreAssetPaths': [item['relative'] for item in files if item['relative'] != 'index.html'], 'backendFiles': [backend], 'driverSha256': self.d.sha(self.root / DRIVER.name), 'evidenceHashes': {name: self.d.sha(self.root / name) for name in names}, 'tscPassed': True, 'sourceTestFailures': 0, 'candidateTestsPassed': True, 'backendCandidateTestsPassed': True, 'reviewPassed': True, 'protectedFiles': protected, 'baselineAssets': oldassets, 'baselineProcesses': copy.deepcopy(self.rows), 'dependencies': ['/assets/old-main.js'], 'sourceHashes': pins, 'sourceHashSnapshot': pins, 'priorSourceHashes': prior, 'newSourceGraphPaths': list(sources), 'beforeHtmlSha256': self.old_html, 'untouchedFrontApiSha256': self.d.sha(self.front), 'standaloneHelpers': helpers, 'runtimeHelpers': helpers, 'snapshotBinding': binding, 'capturedCoordSha256': self.d.sha(self.coord), 'packageHashes': {}}
        self.refresh_package()
        self.reloads = []

    def empty_quote(self, source):
        return {'source': source, 'status': 'not_found', 'matchedPartNumber': None, 'matchedBrand': None, 'productCode': None, 'pageUrl': None, 'stockQuantity': None, 'unitPrice': None, 'tierQuantity': None, 'tiers': [], 'currency': None, 'unit': None, 'taxStatus': 'unknown', 'packaging': None, 'fetchedAt': self.when, 'expiresAt': None, 'stockInsufficientForTier': False, 'message': None}

    def refresh_package(self):
        names = set(self.manifest['evidenceHashes']) | {DRIVER.name, Path(__file__).name}
        names |= {'candidate/' + item['relative'] for item in self.manifest['files'] + self.manifest['backendFiles']}
        names |= {item['relative'] for item in self.manifest['standaloneHelpers']}
        names |= {'source-snapshot/' + name for name in self.manifest['sourceHashes']}
        names |= {'baseline/index.html', 'baseline/admin-index.js'} | {'baseline/' + item['relative'] for item in self.manifest['baselineAssets']}
        names |= {row['file'] for row in json.loads((self.root / 'collection-receipt.json').read_text())['observations']}
        self.manifest['packageHashes'] = {name: self.d.sha(self.root / name) for name in names}
        self.persist()

    def persist(self): self.d.save(self.root / 'manifest.json', self.manifest)

    def get(self, url):
        if url == 'https://www.51dianzi.com/': p = self.front_html
        elif '/assets/' in url: p = self.public / url.split('https://admin.51dianzi.com/')[1]
        else: p = self.public / 'index.html'
        body = p.read_bytes()
        return {'url': url, 'status': 200, 'sha256': hs(body), 'contentType': 'text/javascript' if p.suffix == '.js' else 'text/html'}, body

    def reload(self, row, rollback=False):
        intents = json.loads((self.root / 'reload-intents.json').read_text())
        assert any(x['id'] == row['id'] and x['ownerTask'] == self.d.TASK and x['attemptId'] for x in intents)
        self.reloads.append((row['id'], rollback))
        current = next(x for x in self.rows if x['id'] == row['id'])
        current['pid'] += 1; current['status'] = 'online'

    def run(self, action='apply', extra=None):
        args = argparse.Namespace(apply=action == 'apply', rollback=action == 'rollback', plan=action == 'plan')
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(self.d.argparse.ArgumentParser, 'parse_args', return_value=args))
            stack.enter_context(mock.patch.object(self.d, 'processes', side_effect=lambda: copy.deepcopy(self.rows)))
            stack.enter_context(mock.patch.object(self.d, 'reload_instance', side_effect=self.reload))
            stack.enter_context(mock.patch.object(self.d, 'get', side_effect=self.get))
            stack.enter_context(mock.patch.object(self.d, 'protected_api_health', side_effect=lambda *args: {'status': 401, 'newRouteRegistered': True, 'fixtureOnly': True}))
            if extra: extra(stack)
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            self.d.main()

    def close(self): self.temp.cleanup()


class DriverOfflineTests(unittest.TestCase):
    def setUp(self):
        self.f = Fixture(); self.d = self.f.d
        self.network = mock.patch.object(socket.socket, 'connect', side_effect=AssertionError('NETWORK_FORBIDDEN')); self.network.start()
    def tearDown(self): self.network.stop(); self.f.close()

    def test_manifest_valid_exact_three_and_dynamic_protected_assets(self):
        self.d.validate_manifest(self.f.manifest)
        self.assertEqual(len(self.f.manifest['files']), 3)
        self.assertEqual(len(self.f.manifest['baselineAssets']), 3) # NOT a hard-coded live count.
        m = copy.deepcopy(self.f.manifest)
        m['files'].append({'relative': 'assets/extra-channel-reference-pricing.css', 'sha256': '0'*64})
        m['coreAssetPaths'].append(m['files'][-1]['relative'])
        with self.assertRaisesRegex(RuntimeError, 'ASSET_ALLOWLIST'): self.d.validate_manifest(m)

    def test_paths_core_bound_duplicate_and_traversal(self):
        for relative in ['/root/secret', '../secret', 'assets/../secret', 'assets//x.js', 'assets/./x.js', 'browser/../../public/index.js', 'assets/x?token']:
            with self.subTest(relative=relative), self.assertRaises(RuntimeError): self.d.safe_relative(relative)
        for count in (0, 1, 9):
            m = copy.deepcopy(self.f.manifest); m['coreAssetPaths'] = ['assets/x-channel-reference-pricing-%d.js' % i for i in range(count)]
            with self.subTest(count=count), self.assertRaises(RuntimeError): self.d.validate_manifest(m)
        m = copy.deepcopy(self.f.manifest); m['files'].append(m['files'][1])
        with self.assertRaisesRegex(RuntimeError, 'DUPLICATE_PATH'): self.d.validate_manifest(m)
        m = copy.deepcopy(self.f.manifest); m['coreAssetPaths'][0] = 'assets/foreign.js'
        with self.assertRaises(RuntimeError): self.d.validate_manifest(m)
        m = copy.deepcopy(self.f.manifest); m['dependencies'].append('/assets/../../etc/shadow')
        with self.assertRaisesRegex(RuntimeError, 'DEPENDENCY_ALLOWLIST'): self.d.validate_manifest(m)

    def test_proof_booleans_not_truthy_and_source_snapshot_union(self):
        for key in ('tscPassed', 'candidateTestsPassed', 'backendCandidateTestsPassed', 'reviewPassed'):
            m = copy.deepcopy(self.f.manifest); m[key] = 1
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'VALIDATION'): self.d.validate_manifest(m)
        m = copy.deepcopy(self.f.manifest); m['sourceHashes'].pop('client/prior-0.ts')
        with self.assertRaisesRegex(RuntimeError, 'UNION|EXACT_COMPLETE_PACKAGE_REQUIRED'): self.d.validate_manifest(m)
        write(self.f.root / 'source-snapshot/server/new.ts', b'changed')
        with self.assertRaisesRegex(RuntimeError, 'SOURCE_SNAPSHOT_CHANGED|PACKAGE_CHANGED'): self.d.validate_manifest(self.f.manifest)

    def test_helper_hash_before_execution_and_full_exact_list(self):
        helper = self.f.root / 'channel-reference-service.mjs'; helper.write_bytes(b'changed')
        with mock.patch.object(self.d.subprocess, 'run', side_effect=AssertionError('EXECUTION_FORBIDDEN')):
            with self.assertRaisesRegex(RuntimeError, 'HELPER_SHA_CHANGED'): self.d.reload_instance(self.f.rows[2])
        m = copy.deepcopy(self.f.manifest); m['runtimeHelpers'] = m['runtimeHelpers'][:-1]
        with self.assertRaisesRegex(RuntimeError, 'EXACT_SNAPSHOT_HELPERS_REQUIRED'): self.d.verify_helpers(m)

    def test_exact_snapshot_helpers_no_browser_dependency_or_worker(self):
        write(self.f.root / 'browser/old/inert', b'EXISTING NONEXECUTED BROWSER FIXTURE')
        self.d.verify_helpers(self.f.manifest)
        m = copy.deepcopy(self.f.manifest)
        m['standaloneHelpers'].append({'relative':'channel-reference-worker.mjs', 'sha256':'a'*64})
        m['runtimeHelpers'] = copy.deepcopy(m['standaloneHelpers'])
        with self.assertRaisesRegex(RuntimeError, 'EXACT_SNAPSHOT_HELPERS'): self.d.verify_helpers(m)
        file = self.f.root / 'channel-reference-service.mjs'; old = file.read_bytes(); file.unlink(); file.symlink_to(self.f.front)
        with self.assertRaisesRegex(RuntimeError, 'SYMLINK|PATH_ESCAPE'): self.d.verify_helpers(self.f.manifest)


    def test_plan_only_no_locks_writes_http_subprocess(self):
        before = {str(p): p.read_bytes() for p in self.f.base.rglob('*') if p.is_file()}
        with mock.patch.object(self.d.fcntl, 'flock', side_effect=AssertionError('LOCK_FORBIDDEN')), mock.patch.object(self.d, 'save', side_effect=AssertionError('WRITE_FORBIDDEN')), mock.patch.object(self.d, 'get', side_effect=AssertionError('HTTP_FORBIDDEN')), mock.patch.object(self.d.subprocess, 'run', side_effect=AssertionError('EXECUTION_FORBIDDEN')):
            self.f.run('plan')
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.f.base.rglob('*') if p.is_file()})

    def test_double_lock_failure_releases_and_prevents_ops(self):
        calls = []
        def flock(file, flags):
            calls.append((Path(file.name).name, flags))
            if file.name.endswith('code.lock') and flags & self.d.fcntl.LOCK_EX: raise BlockingIOError('held')
        with self.assertRaises(SystemExit):
            self.f.run(extra=lambda stack: stack.enter_context(mock.patch.object(self.d.fcntl, 'flock', side_effect=flock)))
        self.assertEqual([x[0] for x in calls[:2]], ['public.lock', 'code.lock'])
        self.assertTrue(any(name == 'public.lock' and flags == self.d.fcntl.LOCK_UN for name, flags in calls))
        self.assertEqual(self.d.sha(self.f.admin), self.f.old_admin); self.assertEqual(self.f.reloads, [])

    def test_fresh_pid_cas_and_protected_front_drift(self):
        self.f.rows[2]['pid'] += 1
        with self.assertRaises(SystemExit): self.f.run()
        self.assertFalse((self.f.root / 'activation-started.json').exists())
        self.f.rows[2]['pid'] -= 1; self.f.front.write_bytes(b'foreign-front')
        with self.assertRaises(SystemExit): self.f.run()
        self.assertEqual(self.d.sha(self.f.admin), self.f.old_admin)

    def test_success_exact_two_reload_and_all_protected_unchanged(self):
        frozen = copy.deepcopy(self.f.rows)
        self.f.run()
        self.assertEqual(self.f.reloads, [(191, False), (192, False)])
        self.d.verify_frozen(self.f.manifest)
        self.assertEqual([x for x in frozen if x['id'] not in (191, 192)], [x for x in self.f.rows if x['id'] not in (191, 192)])
        state = json.loads(self.f.coord.read_text()); self.assertFalse(state['shared_release_active'])
        self.assertEqual(state['window']['owner_task'], state['window']['task'])
        receipt = json.loads((self.f.root / 'verified.json').read_text())
        self.assertEqual(receipt['frontReloadInstances'], 0); self.assertTrue(receipt['runtimeHelperHashesVerified'])

    def test_failed_reload_exact_owned_intent_recovery_only(self):
        normal = self.f.reload
        def reload(row, rollback=False):
            if not rollback:
                self.f.reloads.append((row['id'], False))
                current = next(x for x in self.f.rows if x['id'] == row['id']); current.update(pid=0, status='errored')
                raise RuntimeError('injected-reload-failure')
            current = next(x for x in self.f.rows if x['id'] == row['id']); current['pid'] = 20000
            normal(row, rollback)
        self.f.reload = reload
        with self.assertRaises(SystemExit): self.f.run()
        self.assertEqual(self.f.reloads, [(191, False), (191, True)])
        self.assertEqual(self.d.sha(self.f.admin), self.f.old_admin)
        self.assertEqual(self.d.sha(self.f.public / 'index.html'), self.f.old_html)
        self.assertFalse(json.loads((self.f.root / 'failed.json').read_text())['manualRecoveryRequired'])

    def test_foreign_window_never_rolled_back_or_overwritten(self):
        foreign = {'shared_release_active': True, 'window': {'owner_task': 'FOREIGN', 'task': 'FOREIGN', 'openedAtUtc': 'foreign'}, 'window_history': []}
        original = self.f.reload
        def reload(row, rollback=False):
            original(row, rollback)
            self.d.save(self.f.coord, foreign)
            raise RuntimeError('ownership-lost')
        self.f.reload = reload
        with self.assertRaises(SystemExit): self.f.run()
        self.assertEqual(json.loads(self.f.coord.read_text()), foreign)
        self.assertEqual(self.d.sha(self.f.admin), self.f.manifest['backendFiles'][0]['sha256'])
        self.assertEqual(self.f.reloads, [(191, False)])
        self.assertTrue(json.loads((self.f.root / 'failed.json').read_text())['manualRecoveryRequired'])

    def test_foreign_api_cas_not_overwritten(self):
        def reload(row, rollback=False):
            self.f.admin.write_bytes(b'FOREIGN-API')
            raise RuntimeError('foreign-api')
        self.f.reload = reload
        with self.assertRaises(SystemExit): self.f.run()
        self.assertEqual(self.f.admin.read_bytes(), b'FOREIGN-API')
        self.assertTrue(json.loads((self.f.root / 'failed.json').read_text())['manualRecoveryRequired'])

    def test_pid_environment_cwd_script_and_front_workers_protected(self):
        for index, key, value in [(1, 'pid', 999), (1, 'environmentHash', 'x'), (1, 'cwd', '/other'), (1, 'script', '/other.js'), (4, 'status', 'offline'), (2, 'environmentHash', 'x')]:
            changed = copy.deepcopy(self.f.rows); changed[index][key] = value
            with self.subTest(index=index, key=key), self.assertRaises(RuntimeError): self.d.compatible(self.f.rows, changed)
        with self.assertRaisesRegex(RuntimeError, 'FOREIGN_RECOVERY'): self.d.compatible(self.f.rows, self.f.rows, {190})

    def test_reload_intent_owner_duplicate_hash_and_foreign_id(self):
        backend = self.f.manifest['backendFiles'][0]
        self.d.save(self.f.root / 'activation-started.json', {'attemptId': 'fixture-attempt'})
        valid = {'attemptId':'fixture-attempt', 'ownerTask': self.d.TASK, 'id': 191, 'name': 'dianzi51-admin', 'apiHash': backend['sha256']}
        self.d.save(self.f.root / 'reload-intents.json', [valid]); self.assertEqual(self.d.reload_intents([backend], self.f.rows)[1], {191})
        invalids = [[valid, valid], [{**valid, 'ownerTask': 'foreign'}], [{**valid, 'id': 190}], [{**valid, 'apiHash': '0' * 64}]]
        for intents in invalids:
            self.d.save(self.f.root / 'reload-intents.json', intents)
            with self.subTest(intents=intents), self.assertRaises(RuntimeError): self.d.reload_intents([backend], self.f.rows)

    def test_anonymous_health_strict_superjson_route_status_and_headers(self):
        procedure = 'channelReference.lookup'
        def response(code, body=None, content='application/json'):
            expected = ('UNAUTHORIZED', -32001) if code == 401 else ('FORBIDDEN', -32003)
            if body is None: body = {'error': {'json': {'message': 'denied', 'code': expected[1], 'data': {'code': expected[0], 'httpStatus': code, 'path': procedure}}}}
            data = json.dumps(body).encode() if not isinstance(body, bytes) else body
            class R:
                status = code; headers = {'Content-Type': content}
                def read(self, *args): return data
                def __enter__(self): return self
                def __exit__(self, *args): pass
            return R()
        seen = []
        def urlopen(req, timeout):
            seen.append(req); return response(401)
        with mock.patch.object(self.d.urllib.request, 'urlopen', side_effect=urlopen): self.d.protected_api_health('dianzi51-admin')
        req = seen[0]; self.assertEqual(req.get_method(), 'GET'); self.assertEqual(req.get_header('X-business-merchant-id'), '1')
        self.assertIsNone(req.get_header('Authorization')); self.assertIsNone(req.get_header('Cookie'))
        parsed = self.d.urllib.parse.parse_qs(self.d.urllib.parse.urlsplit(req.full_url).query)
        self.assertEqual(json.loads(parsed['input'][0]), {'json': {'listInput': {'page': 1, 'pageSize': 20}, 'materialIds': [1]}})
        self.assertEqual(self.d.urllib.parse.urlsplit(req.full_url).path, '/api/business-trpc/channelReference.lookup')
        with mock.patch.object(self.d.urllib.request, 'urlopen', return_value=response(403)): self.d.protected_api_health('dianzi51-admin')
        invalids = [response(200), response(404), response(400), response(401, b'<html>login</html>', 'text/html'), response(401, {'code': 'UNAUTHORIZED'}), response(401, {'error': {'json': {'code': -32001, 'data': {'code': 'UNAUTHORIZED', 'httpStatus': 401, 'path': 'wrong.route'}}}})]
        for r in invalids:
            with self.subTest(status=r.status), mock.patch.object(self.d.urllib.request, 'urlopen', return_value=r), self.assertRaises((RuntimeError, json.JSONDecodeError)): self.d.protected_api_health('dianzi51-admin')
        with self.assertRaises(RuntimeError): self.d.protected_api_health('dianzi51', 'native.userInfo')

    def test_html_failure_cas_restore_and_manual_replay_block(self):
        original = self.f.get
        def get(url):
            check, body = original(url)
            if url == 'https://admin.51dianzi.com/' and self.d.sha(self.f.public / 'index.html') != self.f.old_html: check['sha256'] = 'bad'
            return check, body
        self.f.get = get
        with self.assertRaises(SystemExit): self.f.run()
        self.assertEqual(self.d.sha(self.f.public / 'index.html'), self.f.old_html)
        self.assertEqual(self.d.sha(self.f.admin), self.f.old_admin)
        self.assertEqual(self.f.reloads, [(191, False), (192, False), (191, True), (192, True)])
        with self.assertRaises(SystemExit): self.f.run()
        self.assertEqual(len(self.f.reloads), 4)

    def test_bind_request_helper_metadata_and_complete_graph(self):
        b = module(BINDER); b.ROOT = self.f.root
        m = self.f.manifest
        request = {'ownerTask': self.d.TASK, 'gitCommit': 'a' * 40, 'sourceCommit': 'b' * 40, 'githubMainVerified': True, 'gitCurrentAllNewGraphVerified': True,
            **{key: copy.deepcopy(m[key]) for key in ('sourceHashes', 'sourceHashSnapshot', 'newSourceGraphPaths', 'priorSourceHashes', 'standaloneHelpers', 'snapshotBinding')}, 'manifestSha256': self.d.sha(self.f.root / 'manifest.json'), 'driverSha256': m['driverSha256']}
        b.validate_request(request, m)
        for key, value in [('githubMainVerified', 1), ('gitCurrentAllNewGraphVerified', False), ('standaloneHelpers', []), ('manifestSha256', '0' * 64), ('newSourceGraphPaths', [])]:
            bad = copy.deepcopy(request); bad[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError): b.validate_request(bad, m)

    def test_ast_and_syntax_no_production_or_global_operations(self):
        for path in (DRIVER, BINDER, Path(__file__)):
            tree = ast.parse(path.read_text())
            self.assertFalse(any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ('system', 'popen') for n in ast.walk(tree)))
        text = DRIVER.read_text() + BINDER.read_text() + RELOADER.read_text()
        for forbidden in ('D51_EXACT_ROLLBACK', '"pm2", "jlist"', 'pm2.connect(', 'Client.start(', 'executeRemote(', '--update-env', 'nginx -s', 'git push', 'ssh ', 'rpm -i'):
            self.assertNotIn(forbidden, text)
        self.assertIn('{ id, env: {} }', RELOADER.read_text())
        self.assertIn("client.call('getMonitorData'", RELOADER.read_text())
        with tempfile.TemporaryDirectory(prefix='offline-compile-') as td:
            for i, path in enumerate((DRIVER, BINDER, Path(__file__))): py_compile.compile(str(path), cfile=str(Path(td) / ('code-' + str(i) + '.pyc')), doraise=True)
        subprocess.run(['node', '--check', str(RELOADER)], check=True, capture_output=True)

    def test_explicit_exact_rollback_owned_ids_and_frozen_front(self):
        self.f.run()
        self.f.run('rollback')
        self.assertEqual(self.f.reloads, [(191, False), (192, False), (191, True), (192, True)])
        self.assertEqual(self.d.sha(self.f.public / 'index.html'), self.f.old_html)
        self.assertEqual(self.d.sha(self.f.admin), self.f.old_admin)
        self.d.verify_frozen(self.f.manifest)
        self.assertEqual(json.loads(self.f.coord.read_text())['window']['status'], 'rolled-back')

    def test_static_html_mime_refused_before_api_execution(self):
        original = self.f.get
        def get(url):
            check, body = original(url)
            if '/assets/' in url: check['contentType'] = 'text/html'
            return check, body
        self.f.get = get
        with self.assertRaises(SystemExit): self.f.run()
        self.assertEqual(self.f.reloads, [])
        self.assertEqual(self.d.sha(self.f.admin), self.f.old_admin)

    def test_bind_and_verify_only_runtime_helper_hash_before_snapshot(self):
        self.f.run()
        b = module(BINDER); b.ROOT = self.f.root; b.PUBLIC = self.f.public; b.COORD = self.f.coord; b.LOCK_PATHS = self.d.LOCK_PATHS
        m = self.f.manifest
        request = {'ownerTask': self.d.TASK, 'gitCommit': 'a' * 40, 'sourceCommit': 'b' * 40, 'githubMainVerified': True, 'gitCurrentAllNewGraphVerified': True,
            **{key: copy.deepcopy(m[key]) for key in ('sourceHashes', 'sourceHashSnapshot', 'newSourceGraphPaths', 'priorSourceHashes', 'standaloneHelpers', 'snapshotBinding')}, 'manifestSha256': self.d.sha(self.f.root / 'manifest.json'), 'driverSha256': m['driverSha256']}
        self.d.save(self.f.root / 'git-source-request.json', request)
        args = argparse.Namespace(request_sha256=self.d.sha(self.f.root / 'git-source-request.json'), verify_only=True, apply=False, plan=False)
        with mock.patch.object(b.argparse.ArgumentParser, 'parse_args', return_value=args), mock.patch.object(b, 'load_driver', return_value=self.d), mock.patch.object(self.d, 'processes', return_value=copy.deepcopy(self.f.rows)), mock.patch.object(self.d, 'save', side_effect=AssertionError('VERIFY_WRITE_FORBIDDEN')), mock.patch.object(b.fcntl, 'flock', side_effect=AssertionError('VERIFY_LOCK_FORBIDDEN')), contextlib.redirect_stdout(io.StringIO()):
            b.main()
        self.assertFalse((self.f.root / 'git-source-receipt.json').exists())
        args.verify_only = False; args.apply = True
        with mock.patch.object(b.argparse.ArgumentParser, 'parse_args', return_value=args), mock.patch.object(b, 'load_driver', return_value=self.d), mock.patch.object(self.d, 'processes', return_value=copy.deepcopy(self.f.rows)), contextlib.redirect_stdout(io.StringIO()):
            b.main()
        receipt = json.loads((self.f.root / 'git-source-receipt.json').read_text())
        self.assertTrue(receipt['runtimeHelperHashesVerified']); self.assertEqual(receipt['snapshotBinding'], m['snapshotBinding'])
        (self.f.root / 'channel-reference-snapshot.json').write_bytes(b'DRIFT')
        for verify_only in (True, False):
            args.verify_only = verify_only; args.apply = not verify_only
            with mock.patch.object(b.argparse.ArgumentParser, 'parse_args', return_value=args), mock.patch.object(b, 'load_driver', return_value=self.d), mock.patch.object(self.d, 'processes', side_effect=AssertionError('SNAPSHOT_BEFORE_HASH_FORBIDDEN')), self.assertRaisesRegex(RuntimeError, 'HELPER_SHA_CHANGED'):
                b.main()

    def test_http_error_json_branch_auth_route_registered(self):
        payload = {'error': {'json': {'code': -32001, 'data': {'code': 'UNAUTHORIZED', 'httpStatus': 401, 'path': 'channelReference.lookup'}}}}
        err = self.d.urllib.error.HTTPError('https://admin.51dianzi.com/api/business-trpc/channelReference.lookup', 401, 'denied', {'Content-Type': 'application/json'}, io.BytesIO(json.dumps(payload).encode()))
        with mock.patch.object(self.d.urllib.request, 'urlopen', side_effect=err):
            self.assertTrue(self.d.protected_api_health('dianzi51-admin')['newRouteRegistered'])

    def test_native_proof_stub_rejected_even_when_flags_true(self):
        proof = json.loads((self.f.root / 'candidate-proof.json').read_text()); proof['files'] = []
        self.d.save(self.f.root / 'candidate-proof.json', proof); self.f.manifest['evidenceHashes']['candidate-proof.json'] = self.d.sha(self.f.root / 'candidate-proof.json')
        with self.assertRaisesRegex(RuntimeError, 'PROOF_OUTPUT_BINDING_REQUIRED'): self.d.validate_manifest(self.f.manifest)

    def test_node_vm_rpc_intent_protected_pid_and_no_daemon(self):
        harness = r'''
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const file = process.argv[1], source = fs.readFileSync(file, 'utf8');
const root = '/opt/ops/20261114-channel-reference-pricing-CKSZQ7s', admin = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js', task = 'CKSZQ7sVc7tADM21c3LWpu';
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const load = () => { const sandbox = { module: {exports:{}}, console:{log:()=>{},error:()=>{}}, process:{argv:[],env:{}}, require: name => { if (name === '/usr/local/lib/node_modules/pm2') throw Error('UNEXPECTED_REAL_PM2'); return require(name); } }; vm.runInNewContext(source, sandbox); return sandbox.module.exports; };
const api = load();
const raw = [0,190,191,192,193,200,201,202,203,204,205,206].map(id => ({pm_id:id,name:[191,192].includes(id)?'dianzi51-admin':'worker',pid:10000+id,pm2_env:{status:'online',pm_exec_path:[191,192].includes(id)?admin:'/protected.js',pm_cwd:'/frozen',exec_mode:[191,192].includes(id)?'cluster_mode':'fork_mode',env:{SAFE:'fixed'}}}));
const snapshot = raw.map(api.project), backend = {processName:'dianzi51-admin',path:admin,relative:'api/admin-index.js',sha256:sha(Buffer.from('new')),beforeSha256:sha(Buffer.from('old'))};
const valid = {attemptId:'fixture-attempt',ownerTask:task,id:191,name:'dianzi51-admin',apiHash:backend.sha256};
assert.equal(api.verifyIntent([valid],snapshot,backend,'fixture-attempt').has(191),true);
for(const bad of [[valid,valid],[{...valid,id:190}],[{...valid,ownerTask:'foreign'}],[{...valid,apiHash:'bad'}]]) assert.throws(()=>api.verifyIntent(bad,snapshot,backend,'fixture-attempt'));
api.verifyRows(raw,snapshot,new Set([191]),false);
for(const field of ['pid','pm_cwd','env','pm_exec_path']) { const x=JSON.parse(JSON.stringify(raw)); if(field==='pid')x[1].pid++;else x[1].pm2_env[field]=field==='env'?{CHANGED:'1'}:'/changed'; assert.throws(()=>api.verifyRows(x,snapshot,new Set([191]),false)); }
const offline = JSON.parse(JSON.stringify(raw)); offline[2].pid=0;offline[2].pm2_env.status='errored'; assert.throws(()=>api.verifyRows(offline,snapshot,new Set(),true)); api.verifyRows(offline,snapshot,new Set([191]),true);
for(const rel of ['/root/a','../a','browser/../../public.js','browser/chrome-headless-shell-linux64/evil.so']) assert.throws(()=>api.helperPath(rel));
const files = new Map(); const put=(p,v)=>files.set(p,Buffer.from(typeof v==='string'?v:JSON.stringify(v)));
const names=['channel-reference-service.mjs','channel-reference-snapshot.json'];
for(const name of names) put(root+'/'+name,'inert-offline-only');
const helpers=names.map(relative=>({relative,sha256:sha(files.get(root+'/'+relative))}));
const binding={snapshotFile:'channel-reference-snapshot.json',fileSha256:sha(files.get(root+'/channel-reference-snapshot.json')),notGitPrivateInventory:true};
put(root+'/snapshot-readiness-proof.json',{status:'PASS',ready:true,snapshotBinding:binding,recordCount:294,capturedCount:299,fixtureOnly:true});
put(root+'/source-snapshot/server/fixture.ts','OFFLINE-FIXTURE');
const sourceHashes={'server/fixture.ts':sha(files.get(root+'/source-snapshot/server/fixture.ts'))};
const packageHashes=Object.fromEntries([...names,'snapshot-readiness-proof.json','source-snapshot/server/fixture.ts'].map(relative=>[relative,sha(files.get(root+'/'+relative))]));
put(root+'/manifest.json',{contractVersion:'snapshot-pricing-v1',snapshotOnly:true,ownerTask:task,backendFiles:[backend],standaloneHelpers:helpers,runtimeHelpers:helpers,protectedFiles:[],snapshotBinding:binding,sourceHashes,packageHashes}); put(root+'/process-before.json',snapshot); put(root+'/reload-intents.json',[valid]); put(root+'/activation-started.json',{ownerTask:task,attemptId:'fixture-attempt',openedAtUtc:'same'}); put('/opt/ops/51-project-release-coordination-20261027.json',{shared_release_active:true,window:{owner_task:task,task:task,attemptId:'fixture-attempt',openedAtUtc:'same'}}); put(admin,'new'); put(root+'/before-dianzi51-admin.js','old');
async function run(recovery=false,hashDrift=false,daemon=true) {
 put(root+'/activation-started.json',{ownerTask:task,attemptId:'fixture-attempt',openedAtUtc:'same',manifestSha256:sha(files.get(root+'/manifest.json'))});
 let pm2Loads=0,calls=[],rows=JSON.parse(JSON.stringify(recovery?offline:raw));
 const fakefs={readFileSync:(p,enc)=>{if(!files.has(p))throw Error('missing:'+p);return enc?files.get(p).toString():files.get(p)},realpathSync:p=>p,lstatSync:p=>({isFile:()=>true,isSymbolicLink:()=>false})};
 const pm2={Client:{pingDaemon:fn=>fn(daemon),launchRPC:fn=>fn(null),client:{call:(method,args,fn)=>{calls.push({method,args});if(method==='getMonitorData')return fn(null,rows);if(!['reloadProcessId','restartProcessId'].includes(method))throw Error('FORBIDDEN_RPC');assert.equal(args.id,191);assert.deepEqual(Object.keys(args.env),[]);rows[2].pid=22222;rows[2].pm2_env.status='online';fn(null)}}},disconnect:()=>{}};
 const sandbox={module:{exports:{}},console:{log:()=>{},error:()=>{}},process:{argv:[],env:{}},require:name=>{if(name==='node:fs')return fakefs;if(name==='/usr/local/lib/node_modules/pm2'){pm2Loads++;return pm2;}return require(name)}};vm.runInNewContext(source,sandbox);
 put(admin,recovery?'old':'new'); if(hashDrift)put(root+'/channel-reference-service.mjs','changed');
 try { await sandbox.module.exports.main(recovery?['--rollback','--id','191']:['--id','191']); if(hashDrift||!daemon)throw Error('SHOULD_FAIL'); } catch(e) { if(!hashDrift&&daemon)throw e; }
 if(hashDrift){assert.equal(pm2Loads,0);assert.equal(calls.length,0);put(root+'/channel-reference-service.mjs','inert-offline-only');}
 else if(!daemon)assert.equal(calls.length,0);
 else assert.equal(calls.filter(x=>x.method!=='getMonitorData')[0].method,recovery?'restartProcessId':'reloadProcessId');
}
(async()=>{await run(false,true);await run(false,false,false);await run();await run(true);console.log('VM_OFFLINE_PASS');})().catch(e=>{console.error(e);process.exitCode=1});
'''
        result = subprocess.run(['node', '-e', harness, str(RELOADER)], capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr); self.assertIn('VM_OFFLINE_PASS', result.stdout)

    def test_snapshot_readiness_requires_real_not_simulated_evidence(self):
        self.d.live_evidence = self.f.real_live_evidence
        with self.assertRaisesRegex(RuntimeError, 'SIMULATED_EVIDENCE_NOT_LIVE'): self.d.verify_snapshot(self.f.manifest)

    def test_snapshot_294_299_mapping_and_unknown_source_status_fail_closed(self):
        self.d.verify_snapshot(self.f.manifest)
        p = self.f.root / 'channel-reference-snapshot.json'
        doc = json.loads(p.read_text()); doc['records'].pop(); self.d.save(p, doc)
        self.f.manifest['snapshotBinding']['fileSha256'] = self.d.sha(p)
        with self.assertRaisesRegex(RuntimeError, '294_RECORDS'): self.d.verify_snapshot(self.f.manifest)
        q = self.f.empty_quote('lcsc'); q['status'] = 'pending'
        with self.assertRaisesRegex(RuntimeError, 'NO_PENDING'): self.d.verify_quote(q, None, 'lcsc', {'partNumber':'fixture','brand':'fixture'}, self.d.timestamp(self.f.when))

    def test_uncaptured_sourceidentity_and_unqueried_negative_rejected(self):
        file = self.f.root / 'collection-evidence/fixture-001-lcsc.json'
        doc = json.loads(file.read_text()); doc['queryPerformed'] = False; self.d.save(file, doc)
        with self.assertRaisesRegex(RuntimeError, 'EVIDENCE_FILE'): self.d.verify_snapshot(self.f.manifest)
        q = self.f.empty_quote('lcsc'); q['unitPrice'] = '0.01'
        with self.assertRaisesRegex(RuntimeError, 'NEGATIVE_NUMBERS'): self.d.verify_quote(q, None, 'lcsc', {'partNumber':'fixture','brand':'fixture'}, self.d.timestamp(self.f.when))

    def test_positive_full_mpn_actualbrand_max_tier_and_url(self):
        doc = json.loads((self.f.root / 'channel-reference-snapshot.json').read_text()); r=doc['records'][0]
        q=r['references']['lcsc']; e=r['evidence']['lcsc']; latest=self.d.timestamp(self.f.when)
        self.d.verify_quote(q,e,'lcsc',r,latest)
        for key, value in [('matchedPartNumber',r['partNumber']+'-suffix'),('unitPrice','0'),('expiresAt',self.f.when),('pageUrl','https://item.szlcsc.com/123.html?x=1')]:
            bad=copy.deepcopy(q); bad[key]=value
            with self.subTest(key=key), self.assertRaises(RuntimeError): self.d.verify_quote(bad,e,'lcsc',r,latest)
        bad=copy.deepcopy(e);bad['maxTierConfirmed']=False
        with self.assertRaisesRegex(RuntimeError,'MAX_TIER'): self.d.verify_quote(q,bad,'lcsc',r,latest)

    def test_full_coord_bytes_cas_even_same_semantics_never_overwrites(self):
        original = self.f.coord.read_bytes()
        self.f.coord.write_text(json.dumps(json.loads(original), separators=(',',':')))
        changed=self.f.coord.read_bytes()
        with self.assertRaises(SystemExit): self.f.run()
        self.assertEqual(self.f.coord.read_bytes(),changed);self.assertEqual(self.f.reloads,[])
        self.assertFalse((self.f.root/'activation-started.json').exists())

    def test_foreign_coord_history_bytes_during_owned_window_not_written(self):
        original=self.f.reload; injected=[]
        def reload(row,rollback=False):
            original(row,rollback)
            state=json.loads(self.f.coord.read_text());state['foreign_metadata']='foreign bytes retained';self.f.coord.write_text(json.dumps(state,separators=(',',':')));injected.append(self.f.coord.read_bytes())
            raise RuntimeError('COORD-BYTE-DRIFT')
        self.f.reload=reload
        with self.assertRaises(SystemExit):self.f.run()
        self.assertEqual(self.f.coord.read_bytes(),injected[0]);self.assertEqual(self.f.reloads,[(191,False)])
        self.assertTrue(json.loads((self.f.root/'failed.json').read_text())['manualRecoveryRequired'])

    def test_package_unlisted_source_and_worker_dependency_refused(self):
        m=copy.deepcopy(self.f.manifest);m['packageHashes']['worker-metafile.json']='0'*64
        with self.assertRaisesRegex(RuntimeError,'EXACT_COMPLETE_PACKAGE'):self.d.verify_package(m)
        m=copy.deepcopy(self.f.manifest);m['packageHashes'].pop('source-snapshot/server/new.ts')
        with self.assertRaisesRegex(RuntimeError,'EXACT_COMPLETE_PACKAGE'):self.d.verify_package(m)

    def test_native_recomputed_inverse_and_actual_html_map_not_stub(self):
        proof=json.loads((self.f.root/'candidate-proof.json').read_text());native=json.loads((self.f.root/'fixture-admin-native.json').read_text())
        self.d.verify_native_bytes(self.f.manifest,proof,native)
        file=self.f.root/'candidate'/self.f.manifest['files'][1]['relative'];file.write_bytes(b'FOREIGN'+file.read_bytes())
        with self.assertRaisesRegex(RuntimeError,'NATIVE_NONPATCH'):self.d.verify_native_bytes(self.f.manifest,proof,native)

    def test_validation_boolean_flags_without_structured_evidence_rejected(self):
        self.d.save(self.f.root/'validation-proof.json',{'status':'PASS','fixtureOnly':True})
        with self.assertRaisesRegex(RuntimeError,'VALIDATION_STRUCTURE'):self.d.verify_validation(self.f.manifest)

    def test_backup_hash_and_reload_attempt_binding(self):
        self.f.run()
        file=self.f.root/'before-dianzi51-admin.js';file.write_bytes(b'CORRUPTED-BACKUP')
        with self.assertRaises(SystemExit):self.f.run('rollback')
        self.assertEqual(file.read_bytes(),b'CORRUPTED-BACKUP')


class RecordedResult(unittest.TextTestResult):
    def startTest(self, test): super().startTest(test); self.entries.append({'test': test.id(), 'status': 'RUNNING'})
    def addSuccess(self, test): super().addSuccess(test); self.entries[-1]['status'] = 'PASS'
    def addError(self, test, err): super().addError(test, err); self.entries[-1].update(status='ERROR', detail=self._exc_info_to_string(err, test))
    def addFailure(self, test, err): super().addFailure(test, err); self.entries[-1].update(status='FAIL', detail=self._exc_info_to_string(err, test))


if __name__ == '__main__':
    RecordedResult.entries = []
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(DriverOfflineTests)
    result = unittest.TextTestRunner(verbosity=2, resultclass=RecordedResult).run(suite)
    report = {'status': 'PASS' if result.wasSuccessful() else 'FAIL', 'testsRun': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors), 'offlineOnly': True, 'fixtureOnly': True, 'liveEvidence': False, 'syntheticEvidenceFilesAreNotLiveProof': True, 'productionApplyExecuted': False, 'productionDeployExecuted': False, 'networkRequests': 0, 'databaseOperations': 0, 'gitOperations': 0, 'browserExecutions': 0, 'syntaxChecks': ['Python py_compile with ephemeral cfile', 'Node --check'], 'tests': result.entries, 'driverHashes': {path.name: hs(path.read_bytes()) for path in (DRIVER, RELOADER, BINDER)}}
    (W / 'driver-tests.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)
