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
        for i in range(105):
            relative = 'client/prior-%d.ts' % i
            pins[relative] = write(self.root / 'source-snapshot' / relative, ('prior-%d' % i).encode())
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
            'serviceImportBridge': {'fixedImport': str(self.root / 'channel-reference-service.mjs'), 'sourceModule': 'server/channelReference/service.ts', 'sourceExport': 'lookupChannelReferences', 'serviceArtifact': {'sourceGraphReproductionProved': True, 'sha256': self.d.sha(self.root / 'channel-reference-service.mjs'), 'metafileSha256': self.d.sha(self.root / 'service-metafile.json'), 'sourceSha256': pins['server/channelReference/service.ts']}}}
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
