'use strict';
// Offline incremental compiler. No product edits, install, network, old runner,
// whole API bundling, production entrypoint execution, packaging or activation.
const H = require('./backend-helper.cjs');
const { C, S, fs, ts, path, sha, assert, read, parse, ROOT, W, HEAD, PIN, SERVICE, IMPORT_NAME, ORDER, json, output, progress } = H;
async function build() {
  progress('1/5 fresh baseline + frozen auth pins');
  const { capture, pins } = H.baseline();
  const text = read(path.join(W, 'baseline/admin-index.js')), old = H.nativeParse('fresh-admin-baseline.js', text);
  const [base, current, child] = await Promise.all([H.compileBaseline('server/businessRouter.ts'), S.compile(ROOT, 'server/businessRouter.ts'), S.compile(ROOT, 'server/channelReferenceRouter.ts')]);
  // Native runtime source pin guards, never run the previous pipeline runner.
  progress('2/5 compile actual sources; retained native canonical guards');
  const guardNames = ['withCurrentBusinessAuthorization', 'requireCurrentBusinessStaffBinding', 'businessMerchantIdFromContext', 'requireBusinessAdminAccount', 'businessAuditActor', 'currentOfficialInventoryPermissions', 'businessEnterpriseBindingFromMerchant', 'businessScopeAllows', 'assertBusinessMerchantAccess'];
  const accessBase = await H.compileBaseline('server/businessAccess.ts');
  const guards = guardNames.map(n => H.guard(old, base.p.byName(n).import ? accessBase : base, n));
  const profileBase = await H.compileBaseline('server/services/officialChannelProfileRead.ts');
  guards.push(H.guard(old, profileBase, 'withOfficialChannelProfileRead'));
  const frozenRetained = [...new Set([...guardNames, ...Object.keys(pins.preservedDeclarations)])];
  for (const name of frozenRetained) assert(base.p.byName(name).node.getText(base.p.sf) === current.p.byName(name).node.getText(current.p.sf), 'CURRENT_RETAINED_SOURCE_BYTES ' + name);
  for (const d of base.p.decls) if (d.name !== 'businessRouter') assert(d.node.getText(base.p.sf) === current.p.byName(d.name).node.getText(current.p.sf), 'ALL_ORIGINAL_COMPILED_DECLARATIONS_BYTES ' + d.name);
  assert(current.p.decls.length === base.p.decls.length + 5, 'SOURCE_ONLY_THREE_DECLARATIONS_TWO_IMPORT_BINDINGS_ADDED');
  // Every pre-existing BusinessRouter property is unchanged also in source.
  const baseObject = H.object(base.p), currentObject = H.object(current.p);
  for (const n of baseObject.properties) assert(n.getText(base.p.sf) === currentObject.properties.find(x => x.name?.text === n.name?.text)?.getText(current.p.sf), 'SOURCE_ROOT_BYTES ' + n.name?.text);
  assert(currentObject.properties.length === baseObject.properties.length + 1, 'SOURCE_ROOT_ADDITION_COUNT');
  // Bind exact actual source import identity to the fixed standalone ESM export.
  const serviceMeta = json(path.join(W, 'service-metafile.json'));
  const serviceOutput = Object.entries(serviceMeta.outputs).filter(([, x]) => x.entryPoint === 'server/channelReference/service.ts');
  assert(serviceOutput.length === 1 && serviceOutput[0][1].exports.includes('lookupChannelReferences'), 'SERVICE_BUILT_METADATA_EXPORT');
  assert(serviceMeta.inputs['server/channelReference/service.ts'], 'SERVICE_REAL_SOURCE_METAFILE');
  const sourcePins = { ...pins.pins, ...pins.retainedSourcePins };
  for (const g of guards) {
    const relative = g.source.relativeFile;
    if (relative === current.meta.relativeFile) {
      const before = base.p.byName(g.sourceName).node.getText(base.p.sf), now = current.p.byName(g.sourceName).node.getText(current.p.sf);
      assert(before === now, 'RETAINED_AUTH_DECLARATION_SOURCE_BYTES ' + g.sourceName);
      assert(sha(read(path.join(ROOT, relative))) === current.meta.sourceSha256, 'CURRENT_AUTH_SOURCE_PIN ' + relative);
      sourcePins[relative] = current.meta.sourceSha256;
      g.currentSourcePreservation = { sourceSha256: current.meta.sourceSha256, compiledDeclarationSha256: sha(now), baselineDeclarationByteIdentical: true };
    } else {
      assert(sha(read(path.join(ROOT, relative))) === g.source.sourceSha256, 'RETAINED_AUTH_SOURCE_PIN ' + relative);
      sourcePins[relative] = g.source.sourceSha256;
    }
  }
  for (const g of guards) for (const namespace of g.namespaceProofs || []) for (const member of namespace.members) sourcePins[member.runtimeModule] = member.sourceOwnerSha256;
  for (const file of Object.keys(serviceMeta.inputs)) sourcePins[file] = sha(fs.readFileSync(path.join(ROOT, file)));
  const serviceSource = await S.compile(ROOT, 'server/channelReference/service.ts');
  assert(serviceSource.p.byName('lookupChannelReferences') && serviceSource.p.sf.statements.some(n => ts.isExportDeclaration(n) && n.exportClause && ts.isNamedExports(n.exportClause) && n.exportClause.elements.some(e => e.name.text === 'lookupChannelReferences')), 'ACTUAL_SOURCE_SERVICE_EXPORT');
  assert(path.resolve(ROOT, serviceOutput[0][0]) === path.join(W, 'channel-reference-service.mjs'), 'SERVICE_METADATA_EXACT_LOCAL_OUTPUT_PATH');
  sourcePins[serviceSource.meta.relativeFile] = serviceSource.meta.sourceSha256;
  const finalEvidence = H.finalGraphEvidence(pins), graph = finalEvidence.graph;
  for (const [file, hash] of Object.entries(graph.sourceHashes)) { assert(sha(fs.readFileSync(path.join(ROOT, file))) === hash, 'FINAL_GRAPH_SOURCE_DRIFT ' + file); sourcePins[file] = hash; }
  assert(graph.service.sourceHashes['server/channelReference/service.ts'] === serviceSource.meta.sourceSha256 && graph.service.exports.includes('lookupChannelReferences'), 'FINAL_GRAPH_SOURCE_EXPORT_DRIFT');
  const serviceArtifact = { path: SERVICE, localArtifact: path.join(W, 'channel-reference-service.mjs'), sha256: graph.service.artifactSha256, metafileSha256: graph.service.metafileSha256, metadataEntry: serviceOutput[0][0], export: 'lookupChannelReferences', sourceSha256: serviceSource.meta.sourceSha256, snapshotSourceSha256: finalEvidence.binding.snapshotSourceSha256, defaultExportBinding: finalEvidence.binding, executed: true, executionScope: 'actual default export in byte-identical temporary NON-LIVE fixture copy only; no legacy factory invocation', defaultRuntimeProof: path.join(W, graph.defaultRuntimeProof), defaultRuntimeProofSha256: finalEvidence.runtimeProofSha256, snapshotOnlyDefaultLookup: true, readonlySnapshot: true, refreshIgnored: true, pendingAbsent: true, no20MinuteExpiry: true, noNETExecution: true, legacyNetworkCapableExportsPresent: true, workerUnusedNotDeployment: true, workerDeploymentRequired: false, liveEvidencePendingResearch: true, formalJSONNotReady: true, deploymentPresenceNotAssumed: true, currentSourceHashesAreObservationNotArtifactProvenance: false, sourceGraphReproductionProved: true, finalParentServiceGraphPinsRequired: false, finalGraphProofSha256: finalEvidence.proofSha256, finalization: 'Both actual source ESM graphs rebuilt twice with byte-exact output/metafile; strict exact source union pinned. Actual snapshot default lookup passed only synthetic offline fixture checks. Formal durable research JSON absent; not deploy-ready.' };
  const depMap = [
    ...ORDER.slice(0, 3).map(exported => ({ module: 'server/channelReferenceRouter.ts', exported, runtimeName: exported, new: true })),
    { module: 'server/channelReference/service.ts', exported: 'lookupChannelReferences', runtimeName: IMPORT_NAME, new: true }
  ];
  const childMapper = S.nativeMapper(old, child.p, ROOT, ORDER, ['merchantListInput', 'forwardBusinessMethod', 'withCurrentBusinessAuthorization'], depMap);
  const rootMapper = S.nativeMapper(old, current.p, ROOT, ORDER, ['merchantListInput', 'forwardBusinessMethod', 'withCurrentBusinessAuthorization'], depMap);
  const root = old.byName('businessRouter'), insertion = H.P.variableStatement(root.node).getStart(old.sf);
  const patches = [{ name: 'fixedStandaloneServiceImport', start: 0, end: 0, text: '// server/channelReference/service.ts\nimport { lookupChannelReferences as ' + IMPORT_NAME + ' } from ' + JSON.stringify(SERVICE) + ';\n', source: serviceArtifact }], records = [];
  progress('3/5 six source-compiled declarations + one root property only');
  for (let i = 0; i < ORDER.length; i++) {
    const name = ORDER[i], compiled = i < 3 ? child : current, mapper = i < 3 ? childMapper : rootMapper;
    assert(!old.decls.some(d => d.name === name), 'NEW_GLOBAL_COLLISION ' + name);
    const d = compiled.p.byName(name), e = mapper.extract(d.node), prefix = '\n// ' + compiled.p.module + '\n' + (ts.isVariableDeclaration(d.node) ? 'var ' : '');
    const code = prefix + e.text + (ts.isVariableDeclaration(d.node) ? ';' : '') + '\n';
    patches.push({ name, start: insertion, end: insertion, text: code, source: S.evidence(compiled, e) });
    records.push({ name, prefixLength: prefix.length, extracted: e });
  }
  const nativeObject = H.object(old), anchor = nativeObject.properties.find(n => n.name?.text === 'channelInventory');
  assert(anchor, 'ROOT_CHANNEL_INVENTORY_ANCHOR');
  const sourceField = currentObject.properties.find(n => n.name?.text === 'channelReference');
  const field = rootMapper.extract(sourceField), fieldPrefix = ',\n  ';
  // Insert ahead of the EXISTING comma after channelInventory. All its bytes,
  // all other properties and the router call are retained without replacement.
  patches.push({ name: 'businessRouter.channelReference', start: anchor.end, end: anchor.end, text: fieldPrefix + field.text, source: S.evidence(current, field) });
  records.push({ name: 'businessRouter.channelReference', prefixLength: fieldPrefix.length, extracted: field });
  const applied = C.applyPatches(text, patches), candidate = H.nativeParse('admin-candidate.js', applied.text);
  const importDelta = H.importGuard(old, candidate), rootProtection = H.rootGuard(old, candidate);
  const captures = S.captureChecks(candidate, records, applied.manifest);
  const initialization = H.initialization(candidate, records.filter(r => ORDER.includes(r.name)));
  const fieldRef = H.object(candidate).properties.find(n => n.name?.text === 'channelReference').initializer;
  assert(candidate.symbols.get(candidate.symbolAt(fieldRef)) === candidate.byName('channelReferenceBusinessRouter'), 'ROOT_CAPTURE');
  const protectedDecls = S.protections(old, candidate, applied.manifest);
  assert(protectedDecls.count === 1092 && protectedDecls.count === old.decls.filter(d => !d.import && d.name !== 'businessRouter').length, 'ALL_ORIGINAL_NATIVE_DECLARATIONS_PROTECTED_EXACT_COUNT');
  assert(rootProtection.protectedCount === 24 && importDelta.oldCount === 130 && applied.manifest.length === 8 && candidate.decls.length === old.decls.length + 7, 'EXACT_INCREMENTAL_DELTA_COUNTS');
  const originalApp = old.byName('appRouter').node.getText(old.sf), candidateApp = candidate.byName('appRouter').node.getText(candidate.sf);
  assert(originalApp === candidateApp, 'APP_ROUTER_INCLUDING_PROFILE_STAFF_CHANGED');
  assert(!applied.manifest.some(p => p.end > p.start), 'INSERTIONS_ONLY');
  progress('4/5 native import/root/capture/TDZ/inverse proofs; save artifact');
  const manifest = { status: 'PASS', baseHEAD: HEAD, baseline: PIN, capture: { capturedAtUtc: capture.capturedAtUtc, processCount: capture.processCount, sharedReleaseActive: capture.sharedReleaseActive }, candidateSha256: sha(applied.text), sourceBound: true, sourcePins, sourceCompileMetadata: [base.meta, current.meta, child.meta, serviceSource.meta], serviceImportBridge: { sourceModule: 'server/channelReference/service.ts', sourceExport: 'lookupChannelReferences', runtimeName: IMPORT_NAME, fixedImport: SERVICE, serviceArtifact, noServiceImplementationCopied: true }, nativePatches: applied.manifest, initializationOrder: ORDER, nativeDependencyMap: depMap, retainedNativeCanonicalGuards: guards, importDelta, rootProtection, protectedDeclarations: protectedDecls, captureChecks: captures, initializationChecks: initialization, inverse: applied.inverse, unrelatedBytesUnchanged: true, appRouterProfileStaffBytesUnchanged: true, frontUnchanged: true, frontSha256: PIN.front, entireApiBundled: false, productionEntryExecuted: false, oldRunnerExecuted: false, productSourceWritten: false, databaseAccess: false, networkAccess: false };
  const dependencySourceProofs = H.dependencyPins(old, records, guards);
  Object.assign(sourcePins, dependencySourceProofs.sourcePins);
  manifest.dependencySourceProofs = dependencySourceProofs;
  manifest.statusScope = 'backend eight-slot byte-incremental current-source binding plus snapshot default graph/runtime offline provenance only; formal live research JSON and production readiness pending';
  manifest.sourceBaselineReceipt = { ...pins.sourceReceipt, sourcePinsFileSha256: sha(read(path.join(W, 'backend-source-pins.json'))), inverseProof: base.meta.baselineSourceProof, gitExecuted: false };
  manifest.priorAuthEvidence = H.priorAuthEvidence();
  manifest.parentRestoredEvidence = H.parentRestoredEvidence();
  manifest.compilerSupportPins = pins.compilerSupportPins;
  manifest.parentServiceGraphIndependentlyBuiltTwice = true;
  manifest.serviceGraphRebuiltByThisBuilder = false;
  manifest.finalParentServiceGraphPinsRequired = false;
  manifest.actualDefaultSnapshotRuntimeEvidence = finalEvidence.runtime;
  manifest.snapshotCodeEvidence = pins.snapshotCodeEvidence;
  manifest.parentRestoredEvidence.currentDefaultLookupSourcePinSupport = false;
  manifest.noNETExecution = true;
  manifest.liveEvidencePendingResearch = true;
  manifest.formalJSONNotReady = true;
  for (const [file, hash] of Object.entries(sourcePins)) assert(sha(fs.readFileSync(path.join(ROOT, file))) === hash, 'SOURCE_MOVED_DURING_BUILD ' + file);
  output('baseline-businessRouter-source.ts', base.source);
  output('admin-index.js', applied.text);
  output('admin-manifest.json', manifest);
  output('source-compile-records.json', records);
  output('service-metafile.json', serviceMeta);
  output('summary.json', { status: 'BUILT_PENDING_OFFLINE_TEST', baseHEAD: HEAD, baselineSha256: PIN.admin, candidateSha256: manifest.candidateSha256, nativePatchCount: applied.manifest.length, protectedDeclarationCount: protectedDecls.count, oldRootPropertyCount: rootProtection.protectedCount, oldImportCount: importDelta.oldCount, byteInverse: applied.inverse.byteExact, sourceBound: true });
  H.baseline();
  progress('5/5 build PASS; production entry NOT executed');
  return manifest;
}
if (require.main === module) build().catch(e => { progress('BUILD FAILED ' + e.message); output('build-error.json', { status: 'FAIL', message: e.message, stack: e.stack }); process.exitCode = 1; });
module.exports = { build };
