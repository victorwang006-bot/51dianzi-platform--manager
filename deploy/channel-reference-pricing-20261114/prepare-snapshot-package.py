#!/usr/bin/env python3
"""Deterministic local snapshot-pricing-v1 packaging; never builds or deploys.

--inputs is an absolute, hash-pinned local input declaration (see --help and
prepare-snapshot-handoff.md). --plan reads only, including no temporary files.
--output-dir creates a new explicit staging directory under /home/ubuntu/work,
never in the repository. No Git, subprocess, network, DB, PM2 or live entry.
The actual driver's validate_manifest is called only on a temporary local root,
not its main(), and no evidence or source pins are relaxed for that call.
"""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import types

TOOLS = Path(__file__).resolve().parent
REPO = TOOLS.parent.parent
WORK_ROOT = Path('/home/ubuntu/work')
DRIVER = 'activate-channel-reference-pricing.py'
TOOL_NAMES = (DRIVER, 'reload-channel-reference-api.cjs', 'bind-source.py', 'driver-test-offline.py')
HEX = re.compile(r'[0-9a-f]{64}')
C3 = 'aeaf9f87f2fc96e210a635eee17c491f43df757a'
INPUT_NAMES = {
    'baselineReport', 'previousSourceReceipt', 'frontendProof', 'frontendParts',
    'frontendInverse0', 'frontendInverse1', 'htmlProof', 'frontendNativeTests',
    'frontendDependencies', 'backendNativeManifest', 'backendCheckManifest',
    'backendTests', 'serviceArtifact', 'serviceMetafile', 'serviceGraphProof',
    'snapshot', 'inventory', 'collectionReceipt', 'snapshotReadinessProof', 'validationProof',
}
DIR_NAMES = {'baselineDir', 'frontendDir', 'backendDir', 'collectionDir', 'sourceDir'}
NATIVE_FLAGS = ('exactInverse', 'allNonpatchBytesUnchanged', 'allOldSpecifiersPreserved',
                'importsByteIdentical', 'exportsByteIdentical')
CHECK_KINDS = {'typecheck', 'source-tests', 'frontend-native-tests',
               'backend-native-tests', 'driver-offline-tests', 'review'}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def unique(items):
    result = {}
    for name, value in items:
        require(name not in result, 'DUPLICATE_JSON_KEY: ' + name)
        result[name] = value
    return result


def decode(data):
    return json.loads(data.decode('utf-8'), object_pairs_hook=unique,
                      parse_constant=lambda v: (_ for _ in ()).throw(RuntimeError('NONFINITE_JSON: ' + v)))


def relative(value):
    require(isinstance(value, str) and 0 < len(value) <= 240
            and re.fullmatch(r'[A-Za-z0-9._/-]+', value)
            and all(x not in ('', '.', '..') for x in value.split('/')),
            'UNSAFE_RELATIVE_PATH: ' + str(value))
    return value


def absolute(value, directory=False):
    require(isinstance(value, str) and Path(value).is_absolute(), 'ABSOLUTE_LOCAL_PATH_REQUIRED')
    p = Path(value)
    require('..' not in p.parts and '.git' not in p.parts, 'UNSAFE_INPUT_PATH: ' + value)
    for q in (p, *p.parents):
        require(not q.is_symlink(), 'INPUT_SYMLINK_REFUSED: ' + str(q))
    require(p.exists(), 'MISSING_INPUT: ' + value)
    mode = p.lstat().st_mode
    require(stat.S_ISDIR(mode) if directory else stat.S_ISREG(mode), 'REGULAR_LOCAL_INPUT_REQUIRED: ' + value)
    return p


def passed(obj, label, formal=False):
    require(isinstance(obj, dict) and obj.get('status') == 'PASS', 'NOT_READY: ' + label)
    require(obj.get('fixtureOnly') is not True, 'MARKED_FIXTURE_NOT_FORMAL: ' + label)
    if formal:
        require(obj.get('fixtureOnly') is False, 'LIVE_EVIDENCE_MARKER_REQUIRED: ' + label)
    require(obj.get('ready') is not False and obj.get('formalJSONNotReady') is not True
            and obj.get('liveEvidencePendingResearch') is not True, 'NOT_READY: ' + label)


def flags(obj, names, label):
    require(all(obj.get(k) is True for k in names), 'REAL_PROOF_FLAGS_REQUIRED: ' + label)


def same(a, b, label):
    require(a == b, 'EVIDENCE_MISMATCH: ' + label)


class Inputs:
    """All bytes are snapshotted on first read and CAS checked before exporting."""
    def __init__(self):
        self.reads = {}
        self.package = {}
        self.evidence = {}

    def read(self, path, expected=None):
        p = absolute(str(path))
        fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            require(stat.S_ISREG(os.fstat(fd).st_mode), 'REGULAR_INPUT_REQUIRED')
            with os.fdopen(fd, 'rb', closefd=False) as stream:
                data = stream.read()
        finally:
            os.close(fd)
        pin = sha(data)
        require(self.reads.setdefault(p, pin) == pin, 'INPUT_CHANGED: ' + str(p))
        if expected is not None:
            require(isinstance(expected, str) and HEX.fullmatch(expected) and pin == expected,
                    'INPUT_HASH_MISMATCH: ' + str(p))
        return data

    def descriptor(self, row):
        require(isinstance(row, dict) and set(row) == {'path', 'sha256'}, 'EXACT_INPUT_DESCRIPTOR_REQUIRED')
        return self.read(row['path'], row['sha256'])

    def add(self, name, data, evidence=False):
        relative(name)
        require(name != 'manifest.json' and name not in self.package, 'DUPLICATE_PACKAGE_PATH: ' + name)
        require(not name.startswith('browser/') and name not in ('worker-metafile.json', 'channel-reference-worker.mjs'),
                'OLD_WORKER_HELPER_REFUSED')
        self.package[name] = data
        if evidence:
            require('/' not in name, 'FLAT_EVIDENCE_REQUIRED')
            self.evidence[name] = sha(data)

    def cas(self):
        for path, expected in self.reads.items():
            self.read(path, expected)


def load_driver(e):
    """Compile inspected real driver as a non-main module; no pycache or CLI."""
    path = TOOLS / DRIVER
    data = e.read(path)
    tree = ast.parse(data, filename=str(path))
    for node in tree.body:
        require(isinstance(node, (ast.Expr, ast.Import, ast.ImportFrom, ast.Assign,
                                 ast.FunctionDef, ast.If)), 'DRIVER_TOPLEVEL_CONTRACT_CHANGED')
        if isinstance(node, ast.Expr):
            require(isinstance(node.value, ast.Constant) and isinstance(node.value.value, str),
                    'DRIVER_TOPLEVEL_EXECUTION_REFUSED')
        if isinstance(node, ast.Assign):
            # Current driver has only literals, Path(), re.compile() and name references.
            for call in (x for x in ast.walk(node.value) if isinstance(x, ast.Call)):
                allowed = (isinstance(call.func, ast.Name) and call.func.id == 'Path') or (
                    isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name)
                    and call.func.value.id == 're' and call.func.attr == 'compile')
                require(allowed, 'DRIVER_TOPLEVEL_CALL_CHANGED')
        if isinstance(node, ast.If):
            require(ast.unparse(node.test) in ("__name__ == '__main__'", "__name__ == '__main__'"),
                    'DRIVER_ENTRY_GUARD_CHANGED')
    module = types.ModuleType('snapshot_prepare_readonly_validator')
    module.__file__ = str(path)
    exec(compile(tree, str(path), 'exec'), module.__dict__)
    require(callable(getattr(module, 'validate_manifest', None)), 'PURE_DRIVER_VALIDATOR_REQUIRED')
    return module, data


def source_graph(prior, front, back, graph, meta):
    """Do not drop receipt pins or include the independent historical worker graph."""
    require(isinstance(prior, dict) and prior, 'COMPLETE_PRIOR_RECEIPT_REQUIRED')
    for name, pin in prior.items():
        relative(name)
        require((name.split('/')[0] in ('client', 'server', 'shared')
                or name in ('package.json', 'pnpm-lock.yaml', 'tsconfig.json'))
                and isinstance(pin, str) and HEX.fullmatch(pin), 'UNSAFE_PRIOR_SOURCE_PIN: ' + name)
    frozen = {}
    for group in (front, back, graph):
        require(isinstance(group, dict) and group, 'REAL_SOURCE_HASHES_REQUIRED')
        for name, pin in group.items():
            relative(name)
            require(name.split('/')[0] in ('client', 'server', 'shared')
                    and isinstance(pin, str) and HEX.fullmatch(pin), 'PRIVATE_OR_NON_SOURCE_GRAPH_PATH: ' + name)
            require(name not in frozen or frozen[name] == pin, 'SOURCE_GRAPH_MISMATCH: ' + name)
            frozen[name] = pin
    require(set(graph) == set(meta['inputs']), 'SOURCE_GRAPH_MISMATCH: service meta inputs')
    new_paths = sorted(set(front) | set(back) | set(meta['inputs']))
    current = dict(prior)
    current.update(frozen)
    same(set(current), set(prior) | set(new_paths), 'complete source receipt union')
    return current, new_paths


def helper_contract(rows):
    require(isinstance(rows, list) and len(rows) == 2
            and {r.get('relative') for r in rows} == {'channel-reference-service.mjs', 'channel-reference-snapshot.json'}
            and all(set(r) == {'relative', 'sha256'} and HEX.fullmatch(r.get('sha256', '')) for r in rows),
            'OLD_WORKER_HELPER_REFUSED')


def public_shape(snapshot):
    require(isinstance(snapshot, dict) and set(snapshot) == {'schemaVersion', 'collectionMode', 'generatedAt', 'records'},
            'PRIVATE_JSON_LEAK_OR_SNAPSHOT_SCHEMA')
    require(type(snapshot['schemaVersion']) is int and snapshot['schemaVersion'] == 1
            and snapshot['collectionMode'] == 'public-web-batch'
            and isinstance(snapshot['records'], list), 'STRICT_PUBLIC_SNAPSHOT_REQUIRED')
    for row in snapshot['records']:
        require(isinstance(row, dict) and set(row) == {'partNumber', 'brand', 'references', 'evidence'},
                'PRIVATE_JSON_LEAK_OR_RECORD_SCHEMA')


def read_declaration(e, path):
    declaration = decode(e.read(path))
    require(isinstance(declaration, dict) and set(declaration) == {'contractVersion', 'files', 'directories', 'evidenceFiles'}
            and declaration['contractVersion'] == 'local-snapshot-prepare-input-v1', 'INPUT_DECLARATION_SCHEMA_REQUIRED')
    files = declaration['files']
    require(isinstance(files, dict) and set(files) == INPUT_NAMES,
            'MISSING_OR_UNKNOWN_INPUTS: ' + ','.join(sorted(INPUT_NAMES - set(files))))
    require(isinstance(declaration['directories'], dict) and set(declaration['directories']) == DIR_NAMES,
            'EXACT_INPUT_DIRECTORIES_REQUIRED')
    dirs = {k: absolute(v, directory=True) for k, v in declaration['directories'].items()}
    require(dirs['sourceDir'] == REPO, 'FIXED_LOCAL_REPO_SOURCE_REQUIRED')
    raw = {name: e.descriptor(files[name]) for name in sorted(files)}
    obj = {name: decode(data) for name, data in raw.items() if name != 'serviceArtifact'}
    evidence_files = declaration['evidenceFiles']
    require(isinstance(evidence_files, dict), 'EXPLICIT_EVIDENCE_INPUTS_REQUIRED')
    return declaration, dirs, raw, obj, evidence_files


def validate_service(e, raw, obj, extra):
    graph, meta = obj['serviceGraphProof'], obj['serviceMetafile']
    # Historical nested proof has service.executed=true and a separate worker graph.
    # Turning it into executed=false would invent evidence; require real final flat proof.
    require('service' not in graph and 'worker' not in graph, 'FINAL_FLAT_SERVICE_GRAPH_REQUIRED_NO_LEGACY_REWRITE')
    passed(graph, 'final service graph', formal=True)
    flags(graph, ('snapshotOnly', 'independentlyBuiltTwice', 'outputAndMetafileReproductionByteExact'), 'service graph')
    require(graph.get('executed') is False and graph.get('networkExecution') is False
            and graph.get('databaseAccess') is False and graph.get('browserWorkerRequired') is False,
            'ACTUAL_OFFLINE_SERVICE_BUILD_SCOPE_REQUIRED')
    same(graph.get('artifact'), 'channel-reference-service.mjs', 'service artifact name')
    same(graph.get('artifactSha256'), sha(raw['serviceArtifact']), 'service artifact bytes')
    same(graph.get('metafileSha256'), sha(raw['serviceMetafile']), 'service metafile bytes')
    require(isinstance(meta.get('inputs'), dict) and meta['inputs'] and isinstance(meta.get('outputs'), dict)
            and len(meta['outputs']) == 1, 'SINGLE_ACTUAL_ESM_GRAPH_REQUIRED')
    require(set(graph['sourceHashes']) == set(meta['inputs']), 'SOURCE_GRAPH_MISMATCH: final graph inputs')
    require({'server/channelReference/service.ts', 'server/channelReference/snapshot.ts'} <= set(meta['inputs'])
            and all(n.startswith(('server/channelReference/', 'shared/')) for n in meta['inputs']), 'BOUNDED_SERVICE_INPUTS_REQUIRED')
    output_name, output = next(iter(meta['outputs'].items()))
    require(Path(output_name).name == graph['artifact'] and output.get('entryPoint') == 'server/channelReference/service.ts'
            and 'lookupChannelReferences' in output.get('exports', [])
            and output.get('bytes') == len(raw['serviceArtifact'])
            and set(output.get('inputs', {})) <= set(meta['inputs']), 'REAL_SERVICE_OUTPUT_BINDING_REQUIRED')
    for imp in output.get('imports', []):
        require(imp.get('external') is True and imp.get('path', '').startswith('node:'), 'SERVICE_EXTERNAL_IMPORT_REFUSED')
    for record in meta['inputs'].values():
        for imp in record.get('imports', []):
            require((imp.get('external') is True and imp.get('path', '').startswith('node:'))
                    or (not imp.get('external') and imp.get('path') in meta['inputs']), 'SERVICE_INPUT_IMPORT_ESCAPES_GRAPH')
    builds = graph.get('buildEvidence')
    require(isinstance(builds, list) and len(builds) == 2
            and len({r.get('evidenceFile') for r in builds}) == 2, 'TWO_REAL_FINAL_BUILD_EVIDENCE_FILES_REQUIRED')
    for row in builds:
        require(set(row) == {'evidenceFile', 'sha256'} and row['evidenceFile'] in extra, 'BUILD_EVIDENCE_DESCRIPTOR_REQUIRED')
        data = e.descriptor(extra[row['evidenceFile']])
        same(sha(data), row['sha256'], 'build evidence SHA')
        proof = decode(data)
        passed(proof, 'independent final build', formal=True)
        require(proof.get('executed') is False and proof.get('networkExecution') is False
                and proof.get('databaseAccess') is False, 'BUILD_EXECUTION_SCOPE_REQUIRED')
        for key in ('artifactSha256', 'metafileSha256', 'sourceHashes'):
            same(proof.get(key), graph[key], 'final build ' + key)
    return graph, meta


def frontend_mapping(e, d, dirs, raw, obj, helpers, base):
    front, parts = obj['frontendProof'], obj['frontendParts']
    passed(front, 'frontend native candidate')
    passed(parts, 'frontend parts')
    flags(front, d.PROOF_FLAGS, 'frontend candidate')
    same(front['files'], parts['files'], 'frontend files')
    same(front['sourceHashes'], parts['sourceHashes'], 'frontend source graph')
    same(front['beforeHtmlSha256'], base['beforeHtmlSha256'], 'frontend baseline HTML')
    same(parts['baselineAssets'], base['baselineAssets'], 'frontend full baseline assets')
    files = front['files']
    require(len(files) == 3 and files[0]['relative'] == 'index.html', 'EXACT_3_FRONTEND_FILES_REQUIRED')
    d.hash_items(files)
    for row in files:
        name = relative(row['relative'])
        require(set(row) == {'relative', 'sha256'} and (name == 'index.html' or re.fullmatch(
            r'assets/BusinessWorkbenchPage-[01]-channel-reference-pricing-[0-9a-f]{64}\.js', name)), 'NO_CSS_NAV_OR_EXTRA_FRONTEND')
        e.add('candidate/' + name, e.read(dirs['frontendDir'] / name, row['sha256']))
    same(front['htmlSha256'], files[0]['sha256'], 'frontend HTML hash field')
    html = obj['htmlProof']
    passed(html, 'HTML proof')
    same(html['relocations'], parts['relocations'], 'actual HTML relocations')
    same(html['beforeSha256'], base['beforeHtmlSha256'], 'HTML before bytes')
    same(html['sha256'], files[0]['sha256'], 'HTML after bytes')
    names = []
    for number in (0, 1):
        p = obj['frontendInverse' + str(number)]
        flags(p, NATIVE_FLAGS, 'workbench inverse')
        actual = parts['proofs']['workbenches'][number]
        require(all(actual.get(k) == v for k, v in p.items()), 'ACTUAL_FRONTEND_INVERSE_FIELDS_MISMATCH')
        before_url, url = actual['beforeUrl'], actual['url']
        same(parts['relocations'].get(before_url), url, 'inverse actual URL')
        before_path, after_path = relative(before_url.lstrip('/')), relative(url.lstrip('/'))
        before = e.read(dirs['baselineDir'] / before_path, p['beforeSha256'])
        after = e.package['candidate/' + after_path]
        same(sha(after), p['sha256'], 'inverse candidate SHA')
        d.inverse_bytes(before, after, p['patches'], p['unchangedPartitions'], js_offsets=True)
        require(p.get('encoding') == 'UTF-8 hashes; JS character offsets' and p.get('oldSpecifiers')
                and all(s.encode() in before and s.encode() in after for s in p['oldSpecifiers']), 'ACTUAL_OLD_IMPORT_EXPORT_TEXT_REQUIRED')
        mapped = dict(p, beforeUrl=before_url, url=url)
        name = 'workbench-' + str(number) + '-byteinverse.json'
        e.add(name, encode(mapped), evidence=True)
        names.append(name)
    tests = obj['frontendNativeTests']
    passed(tests, 'frontend native tests')
    same(front['actualCandidateQA']['reportSha256'], sha(raw['frontendNativeTests']), 'frontend actual QA hash')
    require(type(tests.get('passed')) is int and tests['passed'] > 0 and type(tests.get('failed')) is int
            and tests['failed'] == 0, 'REAL_FRONTEND_NATIVE_TESTS_REQUIRED')
    dependency = obj['frontendDependencies']
    require(isinstance(dependency, list) and len(dependency) == len(set(dependency)) and len(dependency) <= 512,
            'REAL_FRONTEND_DEPENDENCIES_REQUIRED')
    for key in ('sourceDependencyPins',):
        for name, pin in front.get(key, {}).items():
            require(name.startswith('node_modules/.pnpm/') and re.fullmatch(r'[A-Za-z0-9._/@+=-]+', name)
                    and all(p not in ('', '.', '..') for p in name.split('/')), 'UNSAFE_COMPILER_DEPENDENCY_PIN')
            e.read(REPO / name, pin)
    freeze = parts['freeze']
    e.read(freeze['handoffFile'], freeze['handoffSha256'])
    frozen = decode(e.read(freeze['pinFile'], freeze['pinFileSha256']))
    same(frozen, freeze['pins'], 'actual frontend freeze pins')
    for name, pin in freeze['pins'].items():
        e.read(REPO / relative(name), pin)
    mapped = dict(front)
    mapped.update(sourceBindingsVerified=True, nativeProofEvidence=names, standaloneHelpers=helpers,
                  prepareMapping={'rawEvidenceFile': 'frontend-native-proof.json',
                                  'partsEvidenceFile': 'frontend-parts.json',
                                  'sourceBindingsMethod': 'actual local file SHA equality; no Git attestation',
                                  'helperBindingMethod': 'actual supplied final artifact/formal JSON bytes'})
    return mapped, files, dependency


def native_authorization_order(native, before, candidate):
    slots = {p['name']: candidate[p['newByteStart']:p['newByteEnd']].decode('utf-8')
             for p in native['nativePatches']}
    router = slots['createChannelReferenceRouter']
    reader = slots['readApprovedChannelReferenceMaterials']
    require('await readApprovedMaterials(ctx, input.listInput, input.materialIds)' in router
            and 'await __channelReferenceLookup(' in router
            and router.index('await readApprovedMaterials(') < router.index('await __channelReferenceLookup('),
            'ACTUAL_ROUTER_AUTH_BEFORE_SERVICE_REQUIRED')
    require('return withCurrentBusinessAuthorization(' in reader and 'await callPlatformBusinessCommand(' in reader
            and reader.index('return withCurrentBusinessAuthorization(') < reader.index('await callPlatformBusinessCommand('),
            'ACTUAL_READER_AUTH_BEFORE_BUSINESS_IO_REQUIRED')
    guard_pattern = (rb'async function withCurrentBusinessAuthorization\(ctx, merchantId, capability, operation\)\s*\{\s*'
                     rb'const account = requireBusinessAdminAccount\(ctx\);\s*'
                     rb'return [A-Za-z0-9_]+\.withBusinessAuthorizationFence')
    anon_pattern = (rb'function requireBusinessAdminAccount\(ctx\)\s*\{\s*'
                    rb'if \(!ctx\.user \|\| ctx\.user\.role !== "admin" \|\| !ctx\.adminAccount\)\s*\{\s*'
                    rb'throw new [A-Za-z0-9_]+\(\{\s*code: "UNAUTHORIZED"')
    result = {}
    for name, pattern in (('nativeAuthorizationPrefixSha256', guard_pattern), ('nativeAnonymousGuardPrefixSha256', anon_pattern)):
        old, new = re.search(pattern, before), re.search(pattern, candidate)
        require(old is not None and new is not None and old.group() == new.group(), 'ACTUAL_UNCHANGED_ANONYMOUS_GUARD_REQUIRED')
        result[name] = sha(old.group())
    result.update(routerInsertionSha256=sha(router.encode()), readerInsertionSha256=sha(reader.encode()),
                  method='Actual insert-only ranges; reader before service, native account check before fence/business IO; static only')
    return result


def backend_mapping(e, d, dirs, raw, obj, helpers, base, graph):
    native, check, tests = obj['backendNativeManifest'], obj['backendCheckManifest'], obj['backendTests']
    for name, value in (('admin native manifest', native), ('backend native check', check), ('backend native tests', tests)):
        passed(value, name)
    same(check['completeNativeManifestSha256'], sha(raw['backendNativeManifest']), 'native complete manifest hash')
    for ck, nk in (('nativePatches', 'nativePatches'), ('protectedDeclarations', 'protectedDeclarations'),
                   ('protectedOldImports', 'importDelta'), ('protectedOldRootProperties', 'rootProtection'),
                   ('serviceImportBridge', 'serviceImportBridge')):
        same(check[ck], native[nk], 'full native/check ' + nk)
    same(native['baseline'], {'admin': base['api']['admin'], 'front': base['api']['front'], 'html': base['beforeHtmlSha256']}, 'backend fresh bytes')
    same(check['captureSha256'], sha(raw['baselineReport']), 'backend actual capture SHA')
    same(check['candidateSha256'], native['candidateSha256'], 'backend candidate SHA')
    candidate = e.read(dirs['backendDir'] / 'admin-index.js', native['candidateSha256'])
    before = e.read(dirs['baselineDir'] / 'admin-index.js', base['api']['admin'])
    d.inverse_bytes(before, candidate, native['nativePatches'], insert_only=True)
    authorization_order = native_authorization_order(native, before, candidate)
    flags(native, ('sourceBound', 'unrelatedBytesUnchanged', 'frontUnchanged', 'appRouterProfileStaffBytesUnchanged'), 'backend native')
    require(len(native['nativePatches']) == 8 and len(native['protectedDeclarations']['declarations']) == 1092
            and len(native['importDelta']['oldImports']) == 130 and len(native['rootProtection']['protectedProperties']) == 24,
            'COMPLETE_BACKEND_LISTS_REQUIRED')
    same(tests['independentNativeProtections'], native['protectedDeclarations'], '1092 independent declarations')
    same(tests['rootProof'], native['rootProtection'], '24 actual protected root properties')
    same(tests['testedCandidateSha256'], native['candidateSha256'], 'backend actual tested candidate')
    same(check['nativeFocusedTests']['reportSha256'], sha(raw['backendTests']), 'backend focused tests bytes')
    require(tests.get('actualNativeRootPropertyRegistered') is True and type(tests.get('count')) is int
            and tests['count'] == len(tests['tests']) > 0 and all(r.get('status') == 'PASS' for r in tests['tests']), 'REAL_BACKEND_NATIVE_TESTS_REQUIRED')
    names = {r['name'] for r in tests['tests']}
    require({'cache hit/poll/refresh reauthorize each time and release both locks',
             'revoked authorization after cache hit never reaches service'} <= names
            and len([n for n in names if n.startswith('native authorization-boundary denial ')]) >= 6,
            'REAL_AUTHORIZATION_BOUNDARY_TESTS_REQUIRED')
    bridge, artifact = native['serviceImportBridge'], native['serviceImportBridge']['serviceArtifact']
    same(bridge['fixedImport'], str(d.RUNTIME_ROOT / 'channel-reference-service.mjs'), 'fixed production import (metadata only)')
    same(bridge['sourceModule'], 'server/channelReference/service.ts', 'service source module')
    same(bridge['sourceExport'], 'lookupChannelReferences', 'service source export')
    same(artifact['sha256'], graph['artifactSha256'], 'actual native service artifact')
    same(artifact['metafileSha256'], graph['metafileSha256'], 'actual native service metafile')
    same(artifact['sourceSha256'], graph['sourceHashes']['server/channelReference/service.ts'], 'actual service source pin')
    same(artifact['snapshotSourceSha256'], graph['sourceHashes']['server/channelReference/snapshot.ts'], 'actual snapshot source pin')
    same(artifact['finalGraphProofSha256'], sha(raw['serviceGraphProof']), 'native final graph proof')
    flags(artifact, ('sourceGraphReproductionProved',), 'native helper provenance')
    require(artifact.get('currentSourceHashesAreObservationNotArtifactProvenance') is False
            and artifact.get('finalParentServiceGraphPinsRequired') is False
            and artifact.get('formalJSONNotReady') is not True and artifact.get('liveEvidencePendingResearch') is not True,
            'NOT_READY: native final service bridge')
    backend_files = [{'processName': 'dianzi51-admin', 'path': d.APIS['dianzi51-admin'],
                      'relative': 'api/admin-index.js', 'sha256': sha(candidate), 'beforeSha256': sha(before)}]
    e.add('candidate/api/admin-index.js', candidate)
    # Derived only from complete native inverse and actual root/auth test evidence;
    # offline status is not upgraded to a formal/readiness claim.
    mapped = {'status': native['status'], 'sourceBound': native['sourceBound'],
              'sourceBindingsVerified': True, 'unrelatedBytesUnchanged': native['unrelatedBytesUnchanged'],
              'newRootRegistered': tests['actualNativeRootPropertyRegistered'],
              'anonymousAuthorizationBeforeBusinessIO': bool(authorization_order), 'runtimeHelperSourceGraphVerified': True,
              'anonymousAuthorizationOrderEvidence': authorization_order,
              'sourceHashes': native['sourcePins'], 'backendFiles': backend_files,
              'standaloneHelpers': helpers, 'nativeProofEvidence': 'backend-admin-native-proof.json',
              'prepareMapping': {'nativeEvidenceFile': 'backend-admin-native-proof.json',
                                 'checkEvidenceFile': 'backend-native-check-manifest.json',
                                 'authEvidenceFile': 'backend-native-tests.json',
                                 'sourceBindingsMethod': 'actual local file SHA equality; no Git attestation'}}
    return mapped, backend_files


def package_paths(manifest, receipt):
    result = set(TOOL_NAMES) | set(manifest['evidenceHashes'])
    result |= {'candidate/' + r['relative'] for r in manifest['files'] + manifest['backendFiles']}
    result |= {r['relative'] for r in manifest['standaloneHelpers']}
    result |= {'source-snapshot/' + n for n in manifest['sourceHashes']}
    result |= {'baseline/index.html', 'baseline/admin-index.js'}
    result |= {'baseline/' + r['relative'] for r in manifest['baselineAssets']}
    result |= {r['file'] for r in receipt['observations']}
    return result


def prepare(input_path):
    e = Inputs()
    d, driver_bytes = load_driver(e)
    declaration, dirs, raw, obj, extra = read_declaration(e, input_path)
    public_shape(obj['snapshot'])
    require(0 < len(raw['snapshot']) <= 5 * 1024 * 1024, 'FORMAL_JSON_SIZE_REQUIRED')
    passed(obj['snapshotReadinessProof'], 'snapshot readiness', formal=True)
    require(obj['snapshotReadinessProof'].get('ready') is True, 'NOT_READY: actual snapshot readiness')
    passed(obj['validationProof'], 'six final validation classes', formal=True)
    require(obj['collectionReceipt'].get('fixtureOnly') is False, 'NOT_READY: actual collection receipt')
    graph, meta = validate_service(e, raw, obj, extra)
    base = obj['baselineReport']
    require(base.get('sharedReleaseActive') is False and base.get('allOnline') is True
            and base.get('processCount') == len(base['processes']) == 12, 'FRESH_INACTIVE_BASELINE_REQUIRED')
    same(base['publicRoot'], str(d.PUBLIC), 'public root')
    same(base['apiPaths'], {'admin': d.APIS['dianzi51-admin'], 'front': d.FRONT_API}, 'fixed API paths')
    same(base['api']['front'], d.FIXED_FRONT_API_SHA256, 'fixed front SHA')
    same({r['path'] for r in base['protectedFiles']}, d.PROTECTED_PATHS, 'actual protected files, not local extras')
    prior = obj['previousSourceReceipt']
    same(prior['gitCommit'], C3, 'complete prior C3 receipt')
    helpers = [{'relative': 'channel-reference-service.mjs', 'sha256': sha(raw['serviceArtifact'])},
               {'relative': 'channel-reference-snapshot.json', 'sha256': sha(raw['snapshot'])}]
    helper_contract(helpers)
    for key in ('frontendProof', 'backendNativeManifest'):
        if 'standaloneHelpers' in obj[key]:
            helper_contract(obj[key]['standaloneHelpers'])
            same(obj[key]['standaloneHelpers'], helpers, 'actual proof helpers')
    source_hashes, graph_paths = source_graph(prior['sourceHashes'], obj['frontendProof']['sourceHashes'],
                                             obj['backendNativeManifest']['sourcePins'], graph['sourceHashes'], meta)
    for name, pin in source_hashes.items():
        relative(name)
        data = e.read(dirs['sourceDir'] / name, pin)
        if name in meta['inputs']:
            same(len(data), meta['inputs'][name]['bytes'], 'source meta bytes ' + name)
        e.add('source-snapshot/' + name, data)
    front, files, dependencies = frontend_mapping(e, d, dirs, raw, obj, helpers, base)
    back, backend_files = backend_mapping(e, d, dirs, raw, obj, helpers, base, graph)
    inventory = obj['inventory']
    pairs = {}
    for row in inventory['records']:
        require(set(row) == {'materialId', 'partNumber', 'brand'}, 'PRIVATE_CAPTURE_MINIMAL_ROWS_REQUIRED')
        pairs.setdefault((row['partNumber'], row['brand']), []).append(row['materialId'])
    identity = [{'partNumber': p, 'brand': b, 'materialIds': sorted(ids)} for (p, b), ids in sorted(pairs.items())]
    binding = {'snapshotFile': 'channel-reference-snapshot.json', 'fileSha256': sha(raw['snapshot']),
               'collectedAt': obj['snapshot']['generatedAt'], 'collectionReceiptSha256': sha(raw['collectionReceipt']),
               'inventoryCaptureSha256': sha(raw['inventory']), 'identityMapSha256': d.digest(identity),
               'notGitPrivateInventory': True}
    same(obj['snapshotReadinessProof']['snapshotBinding'], binding, 'actual readiness binding')
    validation = obj['validationProof']
    same(validation['sourceHashes'], source_hashes, 'final validation exact source union')
    checks = validation['checks']
    require(len(checks) == 6 and {r['kind'] for r in checks} == CHECK_KINDS, 'EXACT_SIX_FINAL_VALIDATIONS_REQUIRED')
    for row in checks:
        require(row.get('status') == 'PASS' and type(row.get('exitCode')) is int and row['exitCode'] == 0,
                'NOT_READY: validation check')
        require(row['evidenceFile'] in extra, 'MISSING_VALIDATION_EVIDENCE_INPUT: ' + row['evidenceFile'])
        same(extra[row['evidenceFile']]['sha256'], row['evidenceSha256'], 'validation evidence descriptor')
    root_mapping = {'baselineReport': 'live-baseline-current.json', 'previousSourceReceipt': 'previous-source-receipt.json',
                    'frontendProof': 'frontend-native-proof.json', 'frontendParts': 'frontend-parts.json',
                    'htmlProof': 'html-build-proof.json', 'frontendNativeTests': 'frontend-native-tests.json',
                    'frontendDependencies': 'frontend-static-dependencies.json',
                    'backendNativeManifest': 'backend-admin-native-proof.json', 'backendCheckManifest': 'backend-native-check-manifest.json',
                    'backendTests': 'backend-native-tests.json', 'serviceMetafile': 'service-metafile.json',
                    'serviceGraphProof': 'service-graph-proof.json', 'inventory': 'inventory-input.json',
                    'collectionReceipt': 'collection-receipt.json', 'snapshotReadinessProof': 'snapshot-readiness-proof.json',
                    'validationProof': 'validation-proof.json'}
    for key, alias in root_mapping.items():
        e.add(alias, raw[key], evidence=True)
    for name, row in extra.items():
        e.add(name, e.descriptor(row), evidence=True)
    for name in TOOL_NAMES:
        e.add(name, driver_bytes if name == DRIVER else e.read(TOOLS / name), evidence=name not in (DRIVER, 'driver-test-offline.py'))
    e.add('candidate-proof.json', encode(front), evidence=True)
    e.add('backend-candidate-proof.json', encode(back), evidence=True)
    e.add('channel-reference-service.mjs', raw['serviceArtifact'])
    e.add('channel-reference-snapshot.json', raw['snapshot'])
    e.add('baseline/index.html', e.read(dirs['baselineDir'] / 'index.html', base['beforeHtmlSha256']))
    e.add('baseline/admin-index.js', e.read(dirs['baselineDir'] / 'admin-index.js', base['api']['admin']))
    for row in base['baselineAssets']:
        e.add('baseline/' + relative(row['relative']), e.read(dirs['baselineDir'] / row['relative'], row['sha256']))
    receipt = obj['collectionReceipt']
    for row in receipt['observations']:
        name = relative(row['file'])
        require(name.startswith('collection-evidence/') and name.endswith('.json'), 'COLLECTION_EVIDENCE_NAMESPACE_REQUIRED')
        # collectionDir is the receipt's package root, not the nested evidence dir.
        e.add(name, e.read(dirs['collectionDir'] / name, row['sha256']))
    manifest = {'contractVersion': 'snapshot-pricing-v1', 'snapshotOnly': True, 'ownerTask': d.TASK,
                'driverSha256': sha(driver_bytes), 'capturedCoordSha256': base['coordSha256'],
                'files': files, 'coreAssetPaths': [r['relative'] for r in files if r['relative'] != 'index.html'],
                'backendFiles': backend_files, 'standaloneHelpers': helpers, 'runtimeHelpers': helpers,
                'sourceHashes': source_hashes, 'sourceHashSnapshot': source_hashes, 'priorSourceHashes': prior['sourceHashes'],
                'newSourceGraphPaths': graph_paths, 'snapshotBinding': binding,
                'beforeHtmlSha256': base['beforeHtmlSha256'], 'untouchedFrontApiSha256': base['api']['front'],
                'baselineAssets': base['baselineAssets'], 'protectedFiles': base['protectedFiles'],
                'baselineProcesses': base['processes'], 'dependencies': dependencies,
                'tscPassed': next(r['status'] for r in checks if r['kind'] == 'typecheck') == 'PASS',
                'candidateTestsPassed': next(r['status'] for r in checks if r['kind'] == 'frontend-native-tests') == 'PASS',
                'backendCandidateTestsPassed': next(r['status'] for r in checks if r['kind'] == 'backend-native-tests') == 'PASS',
                'reviewPassed': next(r['status'] for r in checks if r['kind'] == 'review') == 'PASS',
                'sourceTestFailures': next(r['failed'] for r in checks if r['kind'] == 'source-tests'),
                'evidenceHashes': dict(sorted(e.evidence.items())),
                'packageHashes': {n: sha(b) for n, b in sorted(e.package.items())}}
    require(len(e.evidence) <= 64, 'TOO_MANY_ROOT_EVIDENCE_FILES')
    same(set(e.package), package_paths(manifest, receipt), 'exact complete package bookkeeping')
    # --plan remains strictly read-only: run the driver's pure byte/schema routines
    # against immutable in-memory bytes, without writing a temporary package.
    # Rebind only filesystem readers in this isolated non-main module and restore
    # them afterward. No proof/schema/flags are mocked or upgraded to PASS.
    # Full validate_manifest runs on real temporary files before any export.
    old_json, old_text, old_sha, old_inside = d.json_file, d.json_file_text, d.sha, d.inside
    def memory_bytes(path):
        p = Path(path)
        require(p.is_relative_to(d.ROOT), 'OFFLINE_VALIDATOR_READ_OUTSIDE_PACKAGE')
        return e.package[p.relative_to(d.ROOT).as_posix()]
    try:
        d.json_file = lambda name: decode(e.package[name])
        d.json_file_text = lambda name: e.package[name].decode('utf-8')
        d.sha = lambda path: sha(memory_bytes(path))
        # Pure snapshot verification uses inside(...).read_bytes(); return a tiny
        # immutable byte reader, never change ROOT or formal evidence fields.
        class MemoryFile:
            def __init__(self, path): self.path = path
            def __fspath__(self): return str(self.path)
            def read_bytes(self): return memory_bytes(self.path)
        d.inside = lambda base_path, name, regular=False: MemoryFile(Path(base_path) / relative(name))
        d.verify_snapshot(manifest)
        d.verify_validation(manifest)
        d.verify_service_graph(manifest)
        d.verify_native_bytes(manifest, front, obj['backendNativeManifest'])
    finally:
        d.json_file, d.json_file_text, d.sha, d.inside = old_json, old_text, old_sha, old_inside
    e.cas()
    return e, d, manifest


def export(e, d, manifest, output_dir):
    require(output_dir is not None and Path(output_dir).is_absolute(), 'EXPLICIT_ABSOLUTE_OUTPUT_DIR_REQUIRED')
    output = Path(output_dir)
    require('..' not in output.parts and output.is_relative_to(WORK_ROOT)
            and not output.is_relative_to(REPO) and not output.exists(), 'NEW_LOCAL_NON_REPO_STAGING_DIR_REQUIRED')
    parent = absolute(str(output.parent), directory=True)
    # All temporary writes stay in the explicit staging parent, not /tmp or repo.
    with tempfile.TemporaryDirectory(prefix='prepare-validator-', dir=parent) as temp:
        root = Path(temp)
        root.chmod(0o700)
        for name, data in e.package.items():
            path = root / relative(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o600)
        (root / 'manifest.json').write_bytes(encode(manifest))
        (root / 'manifest.json').chmod(0o600)
        real_root = d.ROOT
        try:
            # Only package reads move to staging; RUNTIME_ROOT/fixedImport stay fixed.
            d.ROOT = root
            d.validate_manifest(manifest)
        except Exception as error:
            raise RuntimeError('ACTUAL_DRIVER_OFFLINE_VALIDATOR_REFUSED: ' + str(error)
                               + '; no evidence/ROOT fixedImport bypass and no output exported') from error
        finally:
            d.ROOT = real_root
        e.cas()
        require(not output.exists(), 'OUTPUT_CHANGED_DURING_VALIDATION')
        shutil.copytree(root, output, symlinks=False)
        # Verify every exported regular path; no unlisted extra data or browser.
        actual = {p.relative_to(output).as_posix() for p in output.rglob('*') if p.is_file()}
        same(actual, set(e.package) | {'manifest.json'}, 'exported exact path set')
        for name, pin in manifest['packageHashes'].items():
            same(sha((output / name).read_bytes()), pin, 'exported SHA ' + name)
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--inputs', required=True, help='absolute hash-pinned local input declaration JSON')
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--plan', action='store_true', help='strictly read-only; default if no output-dir')
    actions.add_argument('--output-dir', help='new absolute local staging directory under /home/ubuntu/work, outside repo')
    args = parser.parse_args(argv)
    try:
        e, d, manifest = prepare(args.inputs)
        result = {'status': 'OFFLINE_PLAN_INPUTS_VERIFIED', 'planOnly': args.output_dir is None,
                  'productionActivationReady': False, 'liveEvidenceGenerated': False,
                  'snapshotEvidenceProvidedByParent': True, 'networkOperations': 0, 'databaseOperations': 0,
                  'frontendFiles': len(manifest['files']), 'backendFiles': len(manifest['backendFiles']),
                  'standaloneHelpers': len(manifest['standaloneHelpers']), 'sourceFiles': len(manifest['sourceHashes']),
                  'packageFiles': len(manifest['packageHashes']), 'manifestSha256': sha(encode(manifest)),
                  'inputHashes': {str(p): pin for p, pin in sorted(e.reads.items())}}
        if args.output_dir:
            result['outputDir'] = str(export(e, d, manifest, args.output_dir))
            result['status'] = 'LOCAL_PACKAGE_PURE_DRIVER_VALIDATED'
        else:
            result['fullDriverValidatorDeferredUntilExplicitStaging'] = True
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (RuntimeError, KeyError, TypeError, ValueError, OSError) as error:
        print(json.dumps({'status': 'REFUSED_NOT_READY', 'reason': str(error), 'productionActivationReady': False,
                          'liveEvidenceGenerated': False, 'outputExported': False}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
