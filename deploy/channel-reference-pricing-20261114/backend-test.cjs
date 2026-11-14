'use strict';
// Evaluate ONLY six source-compiled candidate definitions and their pure native
// schemas. Never load candidate entrypoint, DB declarations or standalone service.
const vm = require('node:vm');
const A = require('node:assert/strict');
const H = require('./backend-helper.cjs');
const { C, S, fs, ts, path, sha, assert, read, parse, ROOT, W, OUT, HEAD, PIN, ORDER, json, output, progress } = H;
async function test() {
  progress('1/4 pins, candidate actual AST and source provenance');
  const { pins } = H.baseline();
  const m = json(path.join(OUT, 'admin-manifest.json')), text = read(path.join(OUT, 'admin-index.js'));
  assert(m.status === 'PASS' && m.sourceBound && m.baseHEAD === HEAD && sha(text) === m.candidateSha256, 'CANDIDATE_MANIFEST_PIN');
  assert(m.sourceBaselineReceipt.sourcePinsFileSha256 === sha(read(path.join(W, 'backend-source-pins.json'))) && H.baselineSource('server/businessRouter.ts').proof.fullByteInverseReceiptMatched === true, 'CURRENT_PHASE2_SOURCE_AND_RECEIPT_PINS');
  for (const [file, hash] of Object.entries(m.sourcePins)) assert(sha(fs.readFileSync(path.join(ROOT, file))) === hash, 'SOURCE_MOVED_REBUILD_REQUIRED ' + file);
  const old = H.nativeParse('test-baseline.js', read(path.join(W, 'baseline/admin-index.js'))), candidate = H.nativeParse('test-candidate.js', text), rootProof = H.rootGuard(old, candidate);
  H.importGuard(old, candidate);
  const protections = S.protections(old, candidate, m.nativePatches);
  assert(protections.count === 1092 && protections.digest === m.protectedDeclarations.digest && rootProof.protectedCount === 24 && m.nativePatches.length === 8 && m.nativePatches.every(p => p.start === p.end), 'INDEPENDENT_ALL_NATIVE_PRESERVATION_COUNTS');
  assert(old.byName('appRouter').node.getText(old.sf) === candidate.byName('appRouter').node.getText(candidate.sf), 'INDEPENDENT_APP_ROUTER_PROFILE_STAFF_BYTES');
  // Exact inverse independently replayed from disk artifact, not a builder flag.
  let restored = text;
  for (const p of [...m.nativePatches].reverse()) { assert(sha(restored.slice(p.newStart, p.newEnd)) === p.newSha256, 'PATCH_DISK_SHA'); restored = restored.slice(0, p.newStart) + old.text.slice(p.start, p.end) + restored.slice(p.newEnd); }
  assert(Buffer.from(restored).equals(Buffer.from(old.text)), 'INDEPENDENT_BYTE_INVERSE');
  const records = json(path.join(OUT, 'source-compile-records.json'));
  S.captureChecks(candidate, records, m.nativePatches);
  H.initialization(candidate, records.filter(r => ORDER.includes(r.name)));
  // Every new slot is re-extracted from current actual product source. No native
  // implementation or source snippet is maintained by hand in these tools.
  const [child, current] = await Promise.all([S.compile(ROOT, 'server/channelReferenceRouter.ts'), S.compile(ROOT, 'server/businessRouter.ts')]);
  for (let i = 0; i < ORDER.length; i++) {
    const name = ORDER[i], c = i < 3 ? child : current;
    const mapper = S.nativeMapper(old, c.p, ROOT, ORDER, ['merchantListInput', 'forwardBusinessMethod', 'withCurrentBusinessAuthorization'], m.nativeDependencyMap);
    const extracted = mapper.extract(c.p.byName(name).node), wrapped = ts.isVariableDeclaration(c.p.byName(name).node) ? 'var ' + extracted.text + ';' : extracted.text;
    const isolated = parse('actual-source-slot.js', wrapped, c.p.module);
    assert(H.P.canonical(isolated, isolated.byName(name).node) === H.P.canonical(candidate, candidate.byName(name).node), 'ACTUAL_SOURCE_COMPILED_SLOT ' + name);
  }
  progress('2/4 instantiate isolated candidate helpers; native framework IO stubs');
  const tests = [], sandbox = { console, Set, Map, Math, Number, Object, Array, Promise, Error, JSON, undefined };
  const state = { fence: false, native: false, deny: false, upstreamError: null, serviceError: false, upstreamCalls: [], serviceCalls: [], authCalls: 0, cache: new Map(), page: null };
  const TRPCError = require('@trpc/server').TRPCError;
  const z = require('zod').z;
  const router = value => value;
  const publicProcedure = { input: schema => ({ query: handler => ({ schema, handler }) }) };
  function binding(sourceName) { const names = [...new Set(records.flatMap(r => r.extracted.bindings.filter(b => b.sourceName === sourceName).map(b => b.runtimeName)))]; assert(names.length === 1, 'ISOLATED_NATIVE_BINDING ' + sourceName); return names[0]; }
  const put = (sourceName, value) => { sandbox[binding(sourceName)] = value; };
  put('z', z); put('TRPCError', TRPCError); put('router', router); put('publicProcedure', publicProcedure);
  class PlatformBusinessPublicError extends Error { constructor(code) { super('upstream denial'); this.code = code; } }
  put('PlatformBusinessPublicError', PlatformBusinessPublicError);
  put('businessMerchantIdFromContext', ctx => { if (!ctx.active || !ctx.local || ctx.version !== 7 || ctx.merchant !== 51) throw new TRPCError({ code: 'UNAUTHORIZED' }); return ctx.merchant; });
  put('businessEnterpriseBindingFromMerchant', merchant => ({ enterpriseId: 31, ownerUserId: 101, merchantId: merchant.id }));
  put('businessAuditActor', () => ({ operatorId: 303, operatorName: 'fixture', operatorRole: 'merchant_mgr' }));
  put('businessScopeAllows', (scope, module, mode) => scope.permissions.includes(module + '.' + mode));
  put('randomUUID', () => '00000000-0000-4000-8000-000000000001');
  put('withCurrentBusinessAuthorization', async (ctx, merchantId, capability, run) => {
    state.authCalls++; A.equal(merchantId, 51); A.equal(capability.method, 'channelInventory.listTeamMaterials'); A.equal(capability.module, 'inventory'); A.equal(capability.mode, 'read');
    if (state.deny || !ctx.scope || !ctx.official || (capability.customerInventory && !ctx.crm)) throw new TRPCError({ code: 'FORBIDDEN' });
    state.fence = true; state.native = true;
    try { return await run({ staffBinding: { frontUserId: 202, bindingVersion: 7 }, merchant: { id: 51 }, scope: { permissions: ['inventory.read'] }, officialInventoryPermissions: { read: true, write: true, publish: true, customerScopeRead: ctx.crm } }); }
    finally { state.fence = false; state.native = false; }
  });
  put('callPlatformBusinessCommand', async value => { A.equal(state.fence, true); A.equal(state.native, true); A.equal(value.method, 'channelInventory.listTeamMaterials'); equal(value.binding, { enterpriseId: 31, ownerUserId: 101, merchantId: 51 }); A.equal(value.staffUserId, 202); A.equal(value.bindingVersion, 7); equal(value.adminActor, { id: 303, name: 'fixture', role: 'merchant_mgr' }); A.equal(value.requestId, '00000000-0000-4000-8000-000000000001'); A.equal(value.officialInventoryPermissions.write, false); A.equal(value.officialInventoryPermissions.publish, false); state.upstreamCalls.push(value); if (state.upstreamError) throw state.upstreamError; return state.page; });
  put('lookupChannelReferences', async (materials, settings) => {
    A.equal(state.fence, false); A.equal(state.native, false);
    for (const row of materials) A.deepEqual(Object.keys(row).sort(), ['brand', 'materialId', 'partNumber']);
    state.serviceCalls.push({ materials, settings });
    if (state.serviceError) throw new Error('private service error');
    const key = JSON.stringify(materials);
    if (!settings.refresh && state.cache.has(key)) return state.cache.get(key);
    const value = { items: materials.map(row => ({ ...row, references: { lcsc: { status: 'not_found', stockQuantity: null, unitPrice: null }, ickey: { status: 'not_found', stockQuantity: null, unitPrice: null } } })) };
    state.cache.set(key, value); return value;
  });
  // Pure DTO native declarations are read directly from fresh baseline. Recursion
  // cannot enter DB/framework declarations; zod is the only dependency allowed.
  const schemaName = binding('channelInventoryListBusinessInputSchema'), seen = new Set(), nativeSchemaCode = [];
  function schema(d) {
    if (seen.has(d.name)) return; seen.add(d.name);
    if (d.import) { assert(d.import === 'zod' && d.exported === 'z', 'PURE_SCHEMA_EXTERNAL_ONLY ' + d.name); sandbox[d.name] = z; return; }
    assert(ts.isVariableDeclaration(d.node) && ['server/channelInventoryListBusinessInput.ts', 'client/src/business/platform/shared/businessIndustry.ts'].includes(d.module), 'PURE_SCHEMA_MODULE_ONLY ' + d.name + '@' + d.module);
    for (const dependency of C.refs(old, d.node)) if (dependency !== d) schema(dependency);
    nativeSchemaCode.push('var ' + d.node.getText(old.sf) + ';');
  }
  schema(old.byName(schemaName));
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(nativeSchemaCode.join('\n'), { filename: 'isolated-original-native-dto.js' }).runInContext(context, { timeout: 1000 });
  for (const name of ORDER) { const patch = m.nativePatches.find(p => p.name === name); new vm.Script(text.slice(patch.newStart, patch.newEnd), { filename: 'isolated-candidate-' + name + '.js' }).runInContext(context, { timeout: 1000 }); }
  const addedField = H.object(candidate).properties.find(n => n.name?.text === 'channelReference');
  const actualRegisteredRouter = sandbox[addedField.initializer.text];
  assert(actualRegisteredRouter === sandbox.channelReferenceBusinessRouter && actualRegisteredRouter.lookup?.handler, 'ACTUAL_NATIVE_ROOT_PROPERTY_REGISTERED');
  const ctx = () => ({ active: true, local: true, version: 7, merchant: 51, scope: true, official: true, crm: true });
  const row = (id = 102, extra = {}) => ({ id, partNumber: ' STM32F103C8T6/TR ', brand: ' ST ', canViewSource: true, company: null, internalPrice: '987.65', recorder: 'PRIVATE', customerName: 'PRIVATE', quantity: 888, ...extra });
  const page = (rows = [row()], extra = {}) => ({ items: rows, total: rows.length, page: 1, pageSize: 20, pageCount: rows.length ? 1 : 0, ...extra });
  const input = (extra = {}) => ({ listInput: {}, materialIds: [102], ...extra });
  const call = async (value = input(), account = ctx()) => { const parsed = actualRegisteredRouter.lookup.schema.parse(value); return actualRegisteredRouter.lookup.handler({ ctx: account, input: parsed }); };
  const equal = (a, b) => A.deepEqual(JSON.parse(JSON.stringify(a)), b);
  async function check(name, run) {
    state.fence = false; state.native = false; state.deny = false; state.upstreamError = null; state.serviceError = false; state.upstreamCalls = []; state.serviceCalls = []; state.authCalls = 0; state.cache.clear(); state.page = page();
    try { await run(); A.equal(state.fence, false); A.equal(state.native, false); tests.push({ name, status: 'PASS' }); } catch (error) { tests.push({ name, status: 'FAIL', error: error.message }); output('tests.json', { status: 'FAIL', count: tests.length, tests }); throw error; }
  }
  const rejected = (fn, code) => A.rejects(fn, error => !code || error.code === code);
  progress('3/4 candidate schema/router/callback/auth/cache/lock-release tests');
  await check('defaults and exact source-native root registration', async () => { await call(); equal(state.upstreamCalls[0].params, { page: 1, pageSize: 20 }); });
  await check('private fields stripped; complete part suffix retained; negative stub quote null', async () => { const result = await call(); equal(state.serviceCalls[0].materials, [{ materialId: 102, partNumber: 'STM32F103C8T6/TR', brand: 'ST' }]); A.equal(result.items[0].references.lcsc.unitPrice, null); A.equal(JSON.stringify(result).includes('PRIVATE'), false); });
  await check('complete filters/page forwarding and requested order', async () => { state.page = page([row(102), row(103)], { total: 22, page: 3, pageSize: 10, pageCount: 3 }); const filters = { expectedEnterpriseId: 31, expectedActorUserId: 202, channelId: 12, uploadBatchId: 88, industryCode: 'automotive', partNumber: ' STM32 ', brand: ' ST ', page: 3, pageSize: 10, sortBy: 'qty', sortDirection: 'desc' }; await call(input({ listInput: filters, materialIds: [103, 102], refresh: true })); equal(state.upstreamCalls[0].params, { ...filters, partNumber: 'STM32', brand: 'ST' }); equal(state.serviceCalls[0].materials.map(r => r.materialId), [103, 102]); equal(state.serviceCalls[0].settings, { refresh: true }); });
  for (const ids of [[], [102, 102], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], Array.from({ length: 21 }, (_, i) => i + 1)]) await check('reject IDs ' + JSON.stringify(ids), async () => { await rejected(() => call(input({ materialIds: ids }))); A.equal(state.serviceCalls.length, 0); A.equal(state.authCalls, 0); });
  await check('max20 accepted', async () => { const ids = Array.from({ length: 20 }, (_, i) => i + 1); state.page = page(ids.map(id => row(id))); await call(input({ materialIds: ids })); A.equal(state.serviceCalls[0].materials.length, 20); });
  for (const extra of [{ refresh: 'true' }, { url: 'https://example.invalid/' }, { materials: [row()] }, { listInput: { actorId: 1 } }, { listInput: { customerId: 0 } }]) await check('strict unknown/query input ' + JSON.stringify(extra), async () => { await rejected(() => call(input(extra))); A.equal(state.authCalls, 0); });
  await check('mixed current page and injected ID rejects whole batch', async () => { await rejected(() => call(input({ materialIds: [102, 999] })), 'FORBIDDEN'); A.equal(state.serviceCalls.length, 0); });
  await check('null identity remains empty public identity without guessing', async () => { state.page = page([row(102, { partNumber: null, brand: null })]); await call(); equal(state.serviceCalls[0].materials, [{ materialId: 102, partNumber: '', brand: '' }]); });
  for (const extra of [{ brand: 'x'.repeat(65) }, { partNumber: 'x'.repeat(129) }, { brand: 'ST\n' }, { partNumber: undefined }]) await check('invalid upstream identity rejected ' + JSON.stringify(extra), async () => { state.page = page([row(102, extra)]); await rejected(() => call(), 'INTERNAL_SERVER_ERROR'); A.equal(state.serviceCalls.length, 0); });
  for (const extra of [{ page: 2 }, { pageSize: 10 }, { pageCount: 9 }, { total: 0 }]) await check('upstream page proof rejected ' + JSON.stringify(extra), async () => { state.page = page([row()], extra); await rejected(() => call(), 'INTERNAL_SERVER_ERROR'); });
  await check('duplicate real-page IDs rejected', async () => { state.page = page([row(), row()]); await rejected(() => call(), 'INTERNAL_SERVER_ERROR'); });
  await check('exact customer proof accepts only confirmed visibility', async () => { state.page = page([row(102, { company: { id: 1 } })], { customerId: 1, bindingCount: 1 }); await call(input({ listInput: { customerId: 1 } })); });
  for (const invalid of ['customer', 'binding', 'hidden', 'company']) await check('customer proof denied ' + invalid, async () => { state.page = page([row(102, { canViewSource: invalid !== 'hidden', company: { id: invalid === 'company' ? 2 : 1 } })], { customerId: invalid === 'customer' ? 2 : 1, ...(invalid !== 'binding' ? { bindingCount: 1 } : {}) }); await rejected(() => call(input({ listInput: { customerId: 1 } })), 'INTERNAL_SERVER_ERROR'); A.equal(state.serviceCalls.length, 0); });
  await check('cache hit/poll/refresh reauthorize each time and release both locks', async () => { const a = await call(), b = await call(); A.equal(a, b); await call(input({ refresh: true })); A.equal(state.authCalls, 3); A.equal(state.upstreamCalls.length, 3); A.equal(state.serviceCalls.length, 3); A.equal(state.fence, false); A.equal(state.native, false); });
  await check('revoked authorization after cache hit never reaches service', async () => { await call(); state.deny = true; await rejected(() => call(), 'FORBIDDEN'); A.equal(state.serviceCalls.length, 1); });
  for (const invalid of [{ active: false }, { local: false }, { version: 8 }, { merchant: 52 }, { scope: false }, { official: false }]) await check('native authorization-boundary denial ' + JSON.stringify(invalid), async () => { await rejected(() => call(input(), { ...ctx(), ...invalid })); A.equal(state.serviceCalls.length, 0); });
  await check('customer read requires current CRM boundary', async () => { await rejected(() => call(input({ listInput: { customerId: 1 } }), { ...ctx(), crm: false }), 'FORBIDDEN'); A.equal(state.serviceCalls.length, 0); });
  await check('upstream public auth denial is retained', async () => { state.upstreamError = new PlatformBusinessPublicError('FORBIDDEN'); await rejected(() => call(), 'FORBIDDEN'); A.equal(state.serviceCalls.length, 0); });
  await check('upstream unknown failure is authorization SERVICE_UNAVAILABLE', async () => { state.upstreamError = new Error('private error'); await rejected(() => call(), 'SERVICE_UNAVAILABLE'); A.equal(state.serviceCalls.length, 0); });
  await check('service failure is independent SERVICE_UNAVAILABLE after lock release', async () => { state.serviceError = true; await rejected(() => call(), 'SERVICE_UNAVAILABLE'); A.equal(state.fence, false); A.equal(state.native, false); });
  progress('4/4 recheck preservation and reuse pinned original auth evidence');
  assert(tests.length === 44 && tests.every(t => t.status === 'PASS'), 'ALL_44_ACTUAL_NEW_CANDIDATE_TESTS_REQUIRED');
  const reusedEvidence = H.priorAuthEvidence(), parentRestoredEvidence = H.parentRestoredEvidence();
  for (const [file, hash] of Object.entries(m.sourcePins)) assert(sha(fs.readFileSync(path.join(ROOT, file))) === hash, 'SOURCE_MOVED_DURING_TEST ' + file);
  H.baseline();
  const result = { status: 'PASS', statusScope: '44 isolated source-bound new candidate tests only; no deployment or live webpage acceptance', tests, count: tests.length, executedAtUtc: new Date().toISOString(), testedCandidateSha256: sha(text), sourceBoundCandidateSlots: ORDER, actualNativeRootPropertyRegistered: true, candidateEntrypointExecuted: false, standaloneServiceExecutedOrEvaluated: false, nativeFrameworkIOStubs: true, nativeDtoSchemaBytesFromFreshBaseline: true, authBoundaryStubCaveat: 'The 44 focused candidate tests use native IO/authorization boundary stubs. Unmodified original 75 auth + 11 DTO + 10 SQL evidence is reused, not rerun. Parent current router/service/publicPage evidence is recorded separately and is not full legacy acceptance.', reusedEvidence, parentRestoredEvidence, independentInverse: true, independentNativeProtections: protections, rootProof, databaseAccess: false, networkAccess: false };
  const artifact = m.serviceImportBridge.serviceArtifact;
  const graph = JSON.parse(read(path.join(W, 'service-graph-proof.json')));
  assert(graph.status === 'PASS' && graph.sourceGraphReproductionProved === true && artifact.sourceGraphReproductionProved === true && m.finalParentServiceGraphPinsRequired === false, 'FINAL_PUBLIC_SERVICE_GRAPH_PROOF_REQUIRED');
  assert(artifact.sha256 === graph.service.artifactSha256 && artifact.metafileSha256 === graph.service.metafileSha256 && artifact.finalGraphProofSha256 === sha(read(path.join(W, 'service-graph-proof.json'))), 'FINAL_GRAPH_BRIDGE_METADATA_DRIFT');
  assert(sha(read(path.join(W, 'service-graph-proof.json'))) === pins.finalGraph.proofSha256 && graph.service.artifactSha256 === pins.finalGraph.serviceSha256 && graph.worker.artifactSha256 === pins.finalGraph.workerSha256, 'FROZEN_FINAL_PUBLIC_GRAPH_PIN');
  for (const part of [graph.service, graph.worker]) { assert(sha(fs.readFileSync(path.join(W, part.artifact))) === part.artifactSha256 && sha(read(path.join(W, part.metafile))) === part.metafileSha256 && part.independentlyBuiltTwice === true, 'FINAL_GRAPH_DISK_ARTIFACT_AND_METAFILE_PINS'); }
  result.finalParentServiceGraphPinsRequired = false;
  result.serviceGraphArtifactProvenanceProved = true;
  result.reusedEvidence.frozenSha256 = H.AUTH_EVIDENCE_SHA256;
  result.serviceGraphRebuiltByThisTest = false;
  const finalEvidence = H.finalGraphEvidence(pins);
  assert(artifact.snapshotOnlyDefaultLookup === true && artifact.legacyNetworkCapableExportsPresent === true && artifact.liveEvidencePendingResearch === true && artifact.formalJSONNotReady === true && artifact.defaultRuntimeProofSha256 === finalEvidence.runtimeProofSha256, 'NATIVE_SERVICE_IMPORT_ACTUAL_SNAPSHOT_RUNTIME_BINDING');
  result.actualDefaultSnapshotRuntimeEvidence = { path: path.join(W, graph.defaultRuntimeProof), sha256: finalEvidence.runtimeProofSha256, checks: finalEvidence.runtime.count, actualDefaultExportInvoked: true, fixtureSyntheticNonLive: true, standaloneServiceExecutedByThisNativeTest: false, executedBySeparateServiceBuildHarness: true };
  result.authBoundaryStubCaveat = '44 focused candidate tests use native IO/auth stubs and a synthetic negative service stub; cache/refresh stub behavior is router reauthorization coverage only, NOT actual snapshot semantics. Original unchanged 96 auth/DTO/SQL evidence reused. Archived parent service tests do not source-pin or prove the new default lookup; separate actual byte-identical default ESM runtime report does.';
  result.parentRestoredEvidence.currentDefaultLookupSourcePinSupport = false;
  result.noNETExecution = true;
  result.liveEvidencePendingResearch = true;
  result.formalJSONNotReady = true;
  output('tests.json', result);
  output('backend-candidate-proof.json', { status: 'PASS', statusScope: 'focused offline backend candidate plus independently reproducible public service graph; not deployment or live webpage execution', sourceBound: true, sourcePins: m.sourcePins, dependencySourceProofs: m.dependencySourceProofs, mappingCaptureChecks: m.captureChecks, initializationChecks: m.initializationChecks, inverse: m.inverse, independentDiskInverse: true, unrelatedBytesUnchanged: true, frontUnchanged: true, frontSha256: PIN.front, baselineAdminSha256: PIN.admin, candidateAdminSha256: m.candidateSha256, baseHEAD: HEAD, importDeltaCount: 1, rootDeltaCount: 1, declarationInsertCount: 6, retainedNativeCanonicalGuardCount: m.retainedNativeCanonicalGuards.length, protectedDeclarationCount: m.protectedDeclarations.count, oldRootPropertiesProtected: m.rootProtection.protectedCount, oldImportsProtected: m.importDelta.oldCount, TDZ: 'PASS', captureShadow: 'PASS', byteInverse: 'PASS', offlineCandidateTests: tests.length, reusedOriginalAuthAndContractTests: 96, frozenReusedEvidenceSha256: H.AUTH_EVIDENCE_SHA256, actualServiceSourceExportAndCallbackInvocation: true, actualServiceSourceContract: 'export AST + isolated stub invocation and independently rebuilt public ESM graphs; no live service/network execution', standaloneServiceImportMetadataExport: true, serviceImportPath: H.SERVICE, finalParentServiceGraphPinsRequired: false, serviceGraphArtifactProvenanceProved: true, productionEntrypointExecuted: false, serviceImplementationCopied: false, networkAccess: false, databaseAccess: false, packagingOrActivation: false, sourceBindOrGitWrite: false });
  const proof = json(path.join(OUT, 'backend-candidate-proof.json'));
  Object.assign(proof, { sourceBaselineReceipt: m.sourceBaselineReceipt, parentRestoredEvidence, priorAuthEvidence: reusedEvidence, testedCandidateSha256: sha(text), compilerSupportPins: m.compilerSupportPins, gitExecuted: false, liveAcceptanceClaimed: false, actualDefaultSnapshotRuntimeEvidence: result.actualDefaultSnapshotRuntimeEvidence, actualServiceSourceContract: 'current exact snapshot factory/export AST binding plus actual byte-identical ESM default export runtime against temporary NON-LIVE fixture; no live webpage/network execution; legacy network-capable exports remain present', snapshotOnlyDefaultLookup: true, legacyNetworkCapableExportsPresent: true, workerUnusedNotDeployment: true, noNETExecution: true, liveEvidencePendingResearch: true, formalJSONNotReady: true, parentLegacyServiceTestsSupportCurrentDefaultSourcePins: false });
  output('backend-candidate-proof.json', proof);
  output('summary.json', { status: 'PASS', statusScope: result.statusScope, baseHEAD: HEAD, baselineSha256: PIN.admin, candidateSha256: m.candidateSha256, nativePatchCount: m.nativePatches.length, protectedDeclarationCount: m.protectedDeclarations.count, offlineTests: tests.length, reusedTests: 96, reusedTestsRerun: false, parentReportedCurrentTests: { passed: parentRestoredEvidence.passed, skipped: parentRestoredEvidence.skipped, total: parentRestoredEvidence.total, rerunByThisTask: false }, sourceBound: true, byteInverse: true, frontUnchanged: true, gitExecuted: false, liveAcceptanceClaimed: false });
  progress('candidate focused tests PASS ' + tests.length + '; original auth evidence reused 96');
  return result;
}
if (require.main === module) test().catch(e => { progress('TEST FAILED ' + e.message); output('test-error.json', { status: 'FAIL', message: e.message, stack: e.stack }); process.exitCode = 1; });
module.exports = { test };
