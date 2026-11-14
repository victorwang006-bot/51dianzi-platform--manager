'use strict';
const C = require('../demand-personal-backend-20261114/core.cjs');
const S = require('../demand-personal-backend-20261114/source.cjs');
const P = require('../profile-staff-20261114/backend-native.cjs');
const { fs, ts, path, sha, assert, read, parse, walk } = C;
const ROOT = '/home/ubuntu/work/51dianzi-platform--manager';
const W = '/home/ubuntu/work/channel-reference-phase2-20261114';
const OUT = path.join(W, 'backend-candidate');
const HEAD = 'aeaf9f87f2fc96e210a635eee17c491f43df757a';
const PIN = { admin: '0f2bc286a3a1d6643544cc5270c113214795de3531e66123164b296a857a8ad8', front: 'db920e472f854dd41ae6f610f2c0d1c37df28c5260afee4ab3f924b24c83c2c9', html: 'b026128dc2a13383a40f12886d7db437db803b2915c5b75fdb0cc1dbfd8e45a9' };
const SERVICE = '/opt/ops/20261114-channel-reference-pricing-CKSZQ7s/channel-reference-service.mjs';
const IMPORT_NAME = '__channelReferenceLookup';
const ORDER = ['channelReferenceMaterialIdsSchema', 'channelReferenceLookupInputSchema', 'createChannelReferenceRouter', 'channelReferenceApprovedPageSchema', 'readApprovedChannelReferenceMaterials', 'channelReferenceBusinessRouter'];
const AUTH_EVIDENCE_SHA256 = 'f5dbdef251fdca25d827f2b859d1629990d85daf006d71d146b8c32f68459902';
const json = f => JSON.parse(read(f));
function output(name, value) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); }
function progress(stage) { console.log(new Date().toISOString() + ' ' + stage); }
function nativeParse(file, text) {
  const p = parse(file, text), annotated = [...text.matchAll(/^\/\/ (server\/services\/officialChannelProfileRead\.ts) \(candidate helper\)\r?$/gm)];
  for (const declaration of p.decls) {
    if (!['officialChannelProfileAuthorityRows', 'withOfficialChannelProfileRead'].includes(declaration.name)) continue;
    const before = annotated.filter(a => a.index < declaration.node.getStart(p.sf)).at(-1);
    assert(before, 'EXACT_PROFILE_HELPER_MODULE_ANNOTATION ' + declaration.name);
    assert(!/^\/\/ [^\r\n]+\.ts\r?$/m.test(text.slice(before.index + before[0].length, declaration.node.getStart(p.sf))), 'PROFILE_HELPER_ANNOTATION_OWNER_RANGE');
    declaration.module = before[1];
  }
  return p;
}
function baseline() {
  const names = { admin: 'admin-index.js', front: 'front-index.js', html: 'index.html' };
  for (const [k, f] of Object.entries(names)) { const file = path.join(W, 'baseline', f); assert(fs.existsSync(file), 'BLOCKED_MISSING_FRESH_BASELINE ' + f); assert(sha(fs.readFileSync(file)) === PIN[k], 'BASELINE_PIN ' + f); }
  const capture = json(path.join(W, 'baseline/live-baseline-current.json'));
  const pins = json(path.join(W, 'backend-source-pins.json'));
  assert(sha(read(path.join(W, 'baseline/live-baseline-current.json'))) === pins.captureSha256 && sha(read(path.join(W, 'live-baseline-current.json'))) === pins.captureSha256, 'FRESH_CAPTURE_DUPLICATE_PIN');
  assert(capture.sourceCommit === HEAD && capture.processCount === 12 && capture.allOnline === true && capture.processes.length === 12 && capture.processes.every(p => p.status === 'online') && capture.sharedReleaseActive === false, 'BASELINE_COORDINATOR_PIN');
  assert(capture.api.admin === PIN.admin && capture.api.front === PIN.front && capture.beforeHtmlSha256 === PIN.html, 'FRESH_CAPTURE_ARTIFACT_PINS');
  assert(capture.baselineAssets.length === 158 && capture.protectedFiles.length === 4 && capture.productionRecordWrites === 0 && capture.databaseAccess === false && capture.environmentValuesExported === false, 'FRESH_CAPTURE_SCOPE_PIN');
  for (const asset of capture.baselineAssets) assert(sha(fs.readFileSync(path.join(W, 'baseline', asset.relative))) === asset.sha256, 'CAPTURED_PROTECTED_ASSET_PIN ' + asset.relative);
  assert(pins.baseCommit === HEAD, 'AUTH_BASE_HEAD');
  for (const [f, hash] of Object.entries({ ...pins.pins, ...pins.retainedSourcePins, ...pins.compilerSupportPins })) assert(sha(fs.readFileSync(path.join(ROOT, f))) === hash, 'FROZEN_SOURCE_PIN ' + f);
  const receiptFile = path.join(W, pins.sourceReceipt.path);
  assert(sha(read(receiptFile)) === pins.sourceReceipt.sha256, 'CAPTURED_SOURCE_RECEIPT_PIN');
  const receipt = json(receiptFile);
  assert(receipt.gitCommit === HEAD && receipt.sourceCommit === HEAD && receipt.adminApiSha256 === PIN.admin && receipt.frontApiSha256 === PIN.front && receipt.htmlSha256 === PIN.html && receipt.sourceFiles === 105 && Object.keys(receipt.sourceHashes).length === 105, 'AEAF_SOURCE_RECEIPT_ARTIFACT_BINDING');
  assert(receipt.sourceHashes['server/businessRouter.ts'] === pins.sourceReceipt.originalBusinessRouterSha256, 'C3_BASELINE_SOURCE_RECEIPT_PIN');
  const source = read(path.join(ROOT, 'server/businessRouter.ts')), sf = ts.createSourceFile('frozen-businessRouter.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const [name, hash] of Object.entries(pins.preservedDeclarations)) {
    const declarations = sf.statements.flatMap(n => ts.isVariableStatement(n) ? [...n.declarationList.declarations] : [n]).filter(n => n.name?.text === name);
    assert(declarations.length === 1 && sha(declarations[0].getText(sf)) === hash, 'ORIGINAL_DECLARATION_BYTES_PIN ' + name);
  }
  return { capture, pins, receipt };
}
// Always supply explicit text to S.compile; its optional Git reader is never
// called. The source inverse must match the complete aeaf receipt SHA.
function baselineSource(relative) {
  const pins = json(path.join(W, 'backend-source-pins.json')), receiptFile = path.join(W, pins.sourceReceipt.path);
  assert(sha(read(receiptFile)) === pins.sourceReceipt.sha256, 'BASELINE_SOURCE_RECEIPT_SHA');
  const receipt = json(receiptFile), original = read(S.repoPath(ROOT, relative));
  if (relative !== 'server/businessRouter.ts') {
    const expected = pins.retainedSourcePins[relative] || receipt.sourceHashes[relative];
    assert(expected && sha(original) === expected, 'RETAINED_DEPENDENCY_RECEIPT_OR_FROZEN_PIN ' + relative);
    return { text: original, proof: { relativeFile: relative, sha256: expected, baselineRevision: HEAD, sourceBytesUnchanged: true, sourceReceiptSha256: pins.sourceReceipt.sha256, gitExecuted: false } };
  }
  assert(sha(original) === pins.pins[relative], 'CURRENT_ROOT_SOURCE_FROZEN');
  const ranges = [];
  function removeExact(text) { const start = original.indexOf(text); assert(start >= 0 && original.indexOf(text, start + 1) === -1, 'UNIQUE_ADDITIVE_SOURCE_RANGE'); ranges.push({ start, end: start + text.length, sha256: sha(text) }); }
  removeExact('import { createChannelReferenceRouter, channelReferenceMaterialIdsSchema, type ApprovedChannelReferenceMaterial } from "./channelReferenceRouter";\n');
  const first = '// Parse only the attested page/identity fields we need;', next = '/** Fixed mirrored DTOs for the only added customer-contact BFF methods. */';
  const start = original.indexOf(first), end = original.indexOf(next, start);
  assert(start >= 0 && end > start && original.indexOf(first, start + 1) === -1, 'UNIQUE_ADDITIVE_PAGE_SOURCE_RANGE');
  removeExact(original.slice(start, end));
  removeExact('const channelReferenceBusinessRouter = createChannelReferenceRouter(readApprovedChannelReferenceMaterials);\n\n');
  removeExact('  channelReference: channelReferenceBusinessRouter,\n');
  ranges.sort((a, b) => a.start - b.start);
  let text = '', cursor = 0;
  for (const r of ranges) { assert(r.start >= cursor, 'SOURCE_INVERSE_RANGES_OVERLAP'); text += original.slice(cursor, r.start); cursor = r.end; }
  text += original.slice(cursor);
  assert(original.split('\n').length - text.split('\n').length === 85 && sha(text) === receipt.sourceHashes[relative] && sha(text) === pins.sourceReceipt.originalBusinessRouterSha256, 'FULL_SOURCE_85_LINE_BYTE_INVERSE_TO_AEAF_RECEIPT');
  return { text, proof: { relativeFile: relative, currentSha256: sha(original), sha256: sha(text), baselineRevision: HEAD, sourceReceiptSha256: pins.sourceReceipt.sha256, insertionRegions: ranges, addedLines: 85, fullByteInverseReceiptMatched: true, gitExecuted: false } };
}
async function compileBaseline(relative) {
  const source = baselineSource(relative), result = await S.compile(ROOT, relative, { revision: HEAD, text: source.text });
  result.meta.sourceAcquisition = 'explicit receipt-bound offline text; no Git reader'; result.meta.baselineSourceProof = source.proof;
  return result;
}
function priorAuthEvidence() {
  const pins = json(path.join(W, 'backend-source-pins.json')), e = pins.priorAuthEvidence, file = path.join(W, e.path), log = read(file);
  assert(e.sha256 === AUTH_EVIDENCE_SHA256 && sha(log) === AUTH_EVIDENCE_SHA256 && /75 tests/.test(log) && /96 passed/.test(log), 'FROZEN_PRIOR_AUTH_EVIDENCE_REQUIRED');
  const oldFile = path.join(W, e.originalManifestPath); assert(sha(read(oldFile)) === e.originalManifestSha256, 'FROZEN_ORIGINAL_AUTH_SOURCE_RECORD');
  const old = json(oldFile);
  for (const [f, hash] of Object.entries({ ...pins.pins, ...pins.retainedSourcePins })) assert(old.sourcePins[f] === hash && sha(fs.readFileSync(path.join(ROOT, f))) === hash, 'REUSED_AUTH_UNMODIFIED_OWNER_ONLY ' + f);
  return { ...e, path: file, frozenSha256: AUTH_EVIDENCE_SHA256, unmodifiedSourcePinsVerified: true, serviceGraphEvidenceReused: false, oldCandidateAcceptanceReused: false };
}
function parentRestoredEvidence() {
  const pins = json(path.join(W, 'backend-source-pins.json')), e = pins.parentRestoredEvidence, file = path.join(W, e.path); assert(sha(read(file)) === e.sha256, 'PARENT_RESTORED_TEST_EVIDENCE_PIN');
  const report = json(file);
  assert(report.success === true && report.numFailedTests === 0 && report.numTotalTests === e.total && report.numPassedTests === e.passed && report.numPendingTests === e.skipped, 'PARENT_RESTORED_TEST_TRUE_COUNTS');
  const rows = report.testResults.flatMap(suite => suite.assertionResults), actual = { passed: rows.filter(r => r.status === 'passed').length, skipped: rows.filter(r => ['pending', 'skipped'].includes(r.status)).length };
  assert(actual.passed === e.passed && actual.skipped === e.skipped && report.testResults.length === 3, 'PARENT_RESTORED_ASSERTION_COUNTS');
  return { ...e, path: file, rerunThisTask: false, liveAcceptanceClaimed: false };
}
function object(p, owner = 'businessRouter') { const d = p.byName(owner); assert(d.module === 'server/businessRouter.ts', 'ROOT_MODULE'); const obj = d.node.initializer?.arguments?.find(ts.isObjectLiteralExpression); assert(obj, 'ROOT_OBJECT'); return obj; }
function guard(old, compiled, name, context = ['businessRouter', 'forwardBusinessMethod', 'withCurrentBusinessAuthorization']) {
  const ref = compiled.p, runtime = old;
  const keepNamespace = compiled.p.module === 'server/businessRouter.ts';
  const m = keepNamespace ? C.createMapper(runtime, ref, ROOT, [], [name]) : S.nativeMapper(runtime, ref, ROOT, [], [name]);
  const d = ref.byName(name), b = m.resolve(d);
  assert(b.target?.module === compiled.p.module, 'GUARD_NATIVE_OWNER ' + name);
  const e = m.extract(d.node, { renameDeclaration: true });
  const namespaceProofs = [];
  for (const binding of e.bindings.filter(x => x.exported === '*')) {
    assert(binding.import === './db' && binding.runtimeName === '__ir_admin_d67f0938_namespace_db', 'ONLY_PINNED_DB_NAMESPACE');
    const container = old.byName(binding.runtimeName), sourceImport = ref.byName(binding.sourceName), members = new Set();
    walk(d.node, n => { if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && ref.symbolAt(n.expression) === sourceImport.symbol) members.add(n.name.text); });
    const proofs = [];
    for (const member of members) {
      const getter = container.node.initializer.properties.find(n => ts.isGetAccessorDeclaration(n) && n.name?.text === member);
      assert(getter?.body?.statements.length === 1 && ts.isReturnStatement(getter.body.statements[0]) && ts.isIdentifier(getter.body.statements[0].expression), 'NATIVE_DB_NAMESPACE_GETTER ' + member);
      const returnRef = getter.body.statements[0].expression, target = old.symbols.get(old.symbolAt(returnRef));
      assert(target && target.name === member, 'NATIVE_DB_NAMESPACE_GETTER_CAPTURE ' + member);
      const expectedModule = member === 'withBusinessAuthorizationFence' ? 'server/businessAuthorizationFence.ts' : 'server/db.ts';
      assert(target.module === expectedModule, 'NATIVE_DB_NAMESPACE_SOURCE_OWNER ' + member);
      if (member === 'withBusinessAuthorizationFence') assert(/export\s*\{\s*withBusinessAuthorizationFence\s*\}\s*from\s*["']\.\/businessAuthorizationFence["']/.test(read(path.join(ROOT, 'server/db.ts'))), 'DB_REEXPORT_SOURCE_PROOF');
      proofs.push({ member, runtimeModule: target.module, getterSha256: sha(getter.getText(old.sf)), nativeTargetSha256: sha(target.node.getText(old.sf)), sourceOwnerSha256: sha(read(path.join(ROOT, expectedModule))) });
    }
    namespaceProofs.push({ sourceImport: binding.import, nativeNamespace: binding.runtimeName, containerSha256: sha(container.node.getText(old.sf)), members: proofs });
  }
  const isolated = parse('source-bound-guard.js', ts.isVariableDeclaration(d.node) ? 'var ' + e.text + ';' : e.text, b.target.module);
  function compilerCanonical(p, node) {
    const value = JSON.parse(P.canonical(p, node));
    function normalize(v) {
      if (!Array.isArray(v)) return v;
      if (v.length === 2 && v[0] === 'VoidExpression' && Array.isArray(v[1]) && v[1][0] === ts.SyntaxKind[ts.SyntaxKind.NumericLiteral] && v[1][1] === '0') return ['Identifier', 'undefined'];
      return v.map(normalize);
    }
    return JSON.stringify(normalize(value));
  }
  const actual = compilerCanonical(old, b.target.node), expected = compilerCanonical(isolated, isolated.byName(b.runtimeName).node);
  assert(actual === expected, 'SOURCE_NATIVE_CANONICAL_DIVERGENCE ' + name + ' ' + sha(actual) + ' != ' + sha(expected));
  return { sourceName: name, runtimeName: b.runtimeName, source: compiled.meta, gitRevision: HEAD, nativeModule: b.target.module, nativeDeclarationSha256: sha(b.target.node.getText(old.sf)), canonicalSha256: sha(actual), sourceReproducesNativeCanonicalAST: true, canonicalNormalization: 'checker-local-symbols, esbuild-local-shorthand, compiler void-0 versus unbound-undefined only', namespaceProofs, bindings: e.bindings };
}
function imports(p) { return p.sf.statements.filter(ts.isImportDeclaration).map(n => ({ text: n.getText(p.sf), specifier: n.moduleSpecifier.text, start: n.getStart(p.sf), end: n.end })); }
function importGuard(old, candidate) {
  const a = imports(old), b = imports(candidate), extra = b.filter(n => !a.some(x => x.text === n.text));
  assert(extra.length === 1 && extra[0].specifier === SERVICE, 'ONLY_FIXED_SERVICE_IMPORT');
  const newNode = candidate.sf.statements.find(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === SERVICE);
  const list = newNode.importClause?.namedBindings?.elements;
  assert(!newNode.importClause?.name && list?.length === 1 && list[0].propertyName?.text === 'lookupChannelReferences' && list[0].name.text === IMPORT_NAME, 'SERVICE_IMPORT_EXACT_EXPORT');
  assert(JSON.stringify(a.map(x => x.text)) === JSON.stringify(b.filter(x => x.specifier !== SERVICE).map(x => x.text)), 'OLD_IMPORT_BYTES_AND_ORDER');
  return { oldCount: a.length, oldSpecifierCount: new Set(a.map(x => x.specifier)).size, oldImportsSha256: sha(JSON.stringify(a.map(x => x.text))), oldImports: a.map(x => ({ text: x.text, specifier: x.specifier })), oldBytesUnchanged: true, added: extra.map(x => ({ text: x.text, specifier: x.specifier })) };
}
function rootGuard(old, candidate) {
  const a = object(old), b = object(candidate), before = a.properties.map(x => x.name?.text), after = b.properties.map(x => x.name?.text);
  assert(!before.includes('channelReference') && JSON.stringify(after.filter(x => x !== 'channelReference')) === JSON.stringify(before) && b.properties.length === a.properties.length + 1, 'ROOT_ONLY_ONE_FIELD');
  const protectedProperties = a.properties.map(n => { const fresh = b.properties.find(x => x.name?.text === n.name?.text); assert(n.getText(old.sf) === fresh?.getText(candidate.sf), 'OLD_ROOT_PROPERTY_BYTES ' + n.name?.text); return { name: n.name.text, sha256: sha(n.getText(old.sf)), bytes: Buffer.byteLength(n.getText(old.sf)) }; });
  const added = b.properties.find(x => x.name?.text === 'channelReference');
  assert(added.initializer.text === 'channelReferenceBusinessRouter', 'ROOT_NATIVE_CHILD');
  return { added: 'channelReference', protectedCount: protectedProperties.length, protectedProperties, allOldPropertiesByteIdentical: true };
}
function initialization(candidate, records) {
  const results = [];
  for (const r of records) {
    const owner = candidate.byName(r.name), checks = [];
    for (const b of r.extracted.bindings) {
      const target = candidate.byName(b.runtimeName);
      // Conservatively require all captured globals even in function bodies to be
      // imported, hoisted, or initialized before the inserted declaration.
      assert(target.import || ts.isFunctionDeclaration(target.node) || target.node.end < owner.node.getStart(candidate.sf), 'TDZ_OR_UNINITIALIZED ' + r.name + ' -> ' + b.runtimeName);
      checks.push({ runtimeName: b.runtimeName, module: target.module, importedOrHoistedOrEarlier: true });
    }
    results.push({ slot: r.name, checks });
  }
  return results;
}
function dependencyPins(old, records, guards) {
  const files = new Set(), dtoDeclarations = [], seen = new Set();
  for (const b of [...records.flatMap(r => r.extracted.bindings), ...guards.flatMap(g => g.bindings)]) if (b.runtimeModule) files.add(b.runtimeModule);
  function dto(d) {
    if (seen.has(d.name)) return; seen.add(d.name);
    if (d.import) { assert(d.import === 'zod' && d.exported === 'z', 'PURE_DTO_PIN_EXTERNAL_ONLY'); return; }
    assert(ts.isVariableDeclaration(d.node) && ['server/channelInventoryListBusinessInput.ts', 'client/src/business/platform/shared/businessIndustry.ts'].includes(d.module), 'PURE_DTO_PIN_OWNER_ONLY');
    files.add(d.module); dtoDeclarations.push({ name: d.name, module: d.module, nativeSha256: sha(d.node.getText(old.sf)) });
    for (const b of C.refs(old, d.node)) if (b !== d) dto(b);
  }
  dto(old.byName('channelInventoryListBusinessInputSchema'));
  files.add('server/channelInventoryListBusinessInput.test.ts'); files.add('server/customerChannelInventory.contract.test.ts');
  const sourcePins = {}, proofs = [];
  for (const file of files) {
    if (file === 'server/businessRouter.ts') continue; // Exact retained declarations + current frozen file pin are checked by build.
    const current = read(path.join(ROOT, file)), base = baselineSource(file);
    assert(current === base.text, 'CURRENT_RETAINED_DEPENDENCY_SOURCE_CHANGED ' + file);
    sourcePins[file] = sha(current); proofs.push({ file, ...base.proof, sha256: sourcePins[file], baselineRevision: HEAD, sourceBytesUnchanged: true });
  }
  return { sourcePins, proofs, dtoDeclarations, scope: 'direct mapped retained owners and recursive pure DTO declarations only; no unrelated router mapping' };
}
function finalGraphEvidence(pins) {
  const graph = json(path.join(W, 'service-graph-proof.json'));
  assert(graph.status === 'PASS' && graph.sourceGraphReproductionProved === true && graph.actualDefaultRuntimePassed === true, 'FINAL_ACTUAL_GRAPH_AND_DEFAULT_RUNTIME_REQUIRED');
  assert(sha(read(path.join(W, 'service-graph-proof.json'))) === pins.finalGraph.proofSha256, 'FINAL_GRAPH_PROOF_PIN');
  assert(graph.noSecretOrApplicationImports === true && graph.databaseAccess === false && graph.noNETExecution === true && graph.networkExecution === false && graph.applicationEntryExecuted === false, 'OFFLINE_GRAPH_SCOPE');
  assert(graph.defaultLookupSnapshotOnly === true && graph.legacyNetworkCapableExportsPresent === true && graph.workerUnusedNotDeployment === true && graph.liveEvidencePendingResearch === true && graph.formalJSONNotReady === true, 'SNAPSHOT_DEFAULT_NOT_LEGACY_NETWORK_FREE_BUNDLE');
  const union = {};
  for (const part of [graph.service, graph.worker]) {
    assert(part.independentlyBuiltTwice === true && part.noApplicationDatabaseAccountGraph === true && part.outputAndMetafileReproductionByteExact === true, 'TWO_ACTUAL_SOURCE_GRAPH_REPRODUCTIONS');
    assert(sha(fs.readFileSync(path.join(W, part.artifact))) === part.artifactSha256, 'FINAL_GRAPH_ARTIFACT_DRIFT');
    assert(sha(fs.readFileSync(path.join(W, part.metafile))) === part.metafileSha256, 'FINAL_GRAPH_METAFILE_DRIFT');
    const meta = json(path.join(W, part.metafile));
    assert(JSON.stringify(Object.keys(meta.inputs).sort()) === JSON.stringify(Object.keys(part.sourceHashes).sort()), 'EXACT_GRAPH_METADATA_INPUT_SET');
    assert(Object.keys(meta.inputs).every(f => f.startsWith('server/channelReference/')) && Object.values(meta.outputs).every(o => o.imports.every(i => i.external && i.path.startsWith('node:'))), 'FIXED_REFERENCE_ONLY_GRAPH_WITH_NODE_EXTERNALS');
    for (const [file, hash] of Object.entries(part.sourceHashes)) { assert(!union[file] || union[file] === hash, 'GRAPH_UNION_HASH_CONFLICT'); union[file] = hash; }
  }
  assert(graph.service.executed === true && graph.service.snapshotOnlyDefaultLookup === true && graph.service.legacyNetworkCapableExportsPresent === true && graph.worker.executed === false && graph.worker.unusedNotDeployment === true && graph.worker.deploymentRequired === false, 'DEFAULT_ONLY_RUNTIME_WORKER_UNUSED');
  assert(graph.service.entryPoint === 'server/channelReference/service.ts' && graph.service.artifact === 'channel-reference-service.mjs' && graph.service.sourceHashes['server/channelReference/snapshot.ts'], 'SAME_SERVICE_ENTRY_LAYOUT_ACTUAL_SNAPSHOT_SOURCE');
  assert(JSON.stringify(Object.keys(graph.typeOnlySourceHashes)) === JSON.stringify(['shared/channelReference.ts']), 'EXACT_TYPE_ONLY_SOURCE_SET');
  Object.assign(union, graph.typeOnlySourceHashes);
  const sorted = value => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  assert(sorted(union) === sorted(graph.sourceHashes) && sorted(union) === sorted(pins.finalGraph.sourceHashes), 'STRICT_PIN_EXACT_ACTUAL_SOURCE_UNION');
  assert(JSON.stringify(Object.keys(union).sort()) === JSON.stringify(graph.actualSourceUnion.slice().sort()) && Object.keys(union).length === graph.sourceFiles && graph.sourceFiles === pins.finalGraph.sourceFiles, 'ACTUAL_SOURCE_COUNT_NOT_OLD_HARDCODED_COUNT');
  for (const [file, hash] of Object.entries(union)) assert(sha(fs.readFileSync(path.join(ROOT, file))) === hash, 'FINAL_GRAPH_CURRENT_SOURCE_DRIFT ' + file);
  assert(graph.service.artifactSha256 === pins.finalGraph.serviceSha256 && graph.worker.artifactSha256 === pins.finalGraph.workerSha256, 'FINAL_ARTIFACT_PINS');
  const binding = require('./service-build.cjs').bindingProof();
  assert(sorted(binding) === sorted(graph.defaultBindingProof), 'CURRENT_SOURCE_SNAPSHOT_FACTORY_EXPORT_BINDING_DRIFT');
  const runtimePath = path.join(W, graph.defaultRuntimeProof), runtime = json(runtimePath);
  assert(sha(read(runtimePath)) === graph.defaultRuntimeProofSha256 && graph.defaultRuntimeProofSha256 === pins.finalGraph.defaultRuntimeProofSha256, 'FINAL_DEFAULT_RUNTIME_REPORT_PIN');
  assert(runtime.status === 'PASS' && runtime.artifactSha256 === graph.service.artifactSha256 && runtime.actualDefaultExportInvoked === true && runtime.snapshotOnlyDefaultLookup === true && runtime.legacyFactoryExportPresentButNotInvoked === true, 'ACTUAL_BYTE_IDENTICAL_DEFAULT_LOOKUP_RUNTIME');
  assert(runtime.count === 8 && runtime.checks.length === runtime.count && runtime.checks.every(c => c.status === 'PASS') && runtime.fixtureSyntheticNonLive === true && runtime.fixtureRemoved === true && runtime.formalJSONWritten === false, 'NON_LIVE_TEMPORARY_RUNTIME_FIXTURE_ONLY');
  assert(runtime.noNETExecution === true && runtime.networkExecution === false && runtime.spawnExecution === false && runtime.databaseAccess === false && runtime.defaultLookupFileWrites === false && runtime.forbiddenIOAttemptCount === 0 && runtime.forbiddenIOAttempts.length === 0 && runtime.refreshIgnored === true && runtime.pendingAbsent === true && runtime.no20MinuteExpiry === true, 'ACTUAL_SNAPSHOT_READONLY_RUNTIME_SEMANTICS');
  assert(runtime.readTrace.every(r => !r.opened || r.closed), 'DEFAULT_RUNTIME_READ_HANDLES_CLOSED');
  return { graph, runtime, binding, sourceHashes: union, proofSha256: pins.finalGraph.proofSha256, runtimeProofSha256: graph.defaultRuntimeProofSha256 };
}
module.exports = { C, S, P, fs, ts, path, sha, assert, read, parse, nativeParse, walk, ROOT, W, OUT, HEAD, PIN, SERVICE, IMPORT_NAME, ORDER, AUTH_EVIDENCE_SHA256, json, output, progress, baseline, baselineSource, compileBaseline, priorAuthEvidence, parentRestoredEvidence, object, guard, imports, importGuard, rootGuard, initialization, dependencyPins, finalGraphEvidence };
