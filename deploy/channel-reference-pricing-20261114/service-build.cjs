'use strict';
// Offline source-graph builds plus actual default export tests using a temporary
// explicitly NON-LIVE fixture. Legacy network-capable exports remain bundled;
// only default lookup is snapshot-only. No application entry, DB or network IO.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { syncBuiltinESMExports } = require('node:module');
const ts = require('typescript');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '../..');
const W = '/home/ubuntu/work/channel-reference-phase2-20261114';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// Exact finite validation freeze; never accept other sources by scanning current bytes.
const FROZEN_SOURCE_HASHES = {
  'server/channelReference/browserPage.ts': '77f2be058b08c29ac30f919896f24e1c6697a377da14334af9ce4e752ec2ea67',
  'server/channelReference/ickeyPage.ts': 'daae88031964b8d7f22898124215c5bc459c01d21514df0506dbda68986d5b7c',
  'server/channelReference/lcscPage.ts': '9c62f903f1667901271a065005668075b7e1a36d26160719a5a0c6a289f41572',
  'server/channelReference/lcscSearchPage.ts': '05bd1e0a15364a1edabb8f8d84c443b580fd8f2d076050c8e8f5c357780b1a96',
  'server/channelReference/publicPage.ts': '6555e35fe6205441e68106c5fb77aeaaa38cbddf65116b2803de71ccd6135fcd',
  'server/channelReference/requestPacing.ts': '4a4cc549999d9ecd973d194ae4ebcb4e61903a4c29b344a249e0fafcf49494c8',
  'server/channelReference/service.ts': '90c770c12049938beacca69246f36a99b050595c2d19a4ae466ff48be057bb66',
  'server/channelReference/snapshot.ts': 'd7a2aae41574189e3c3a678885e4b86acb962f827eb7886991968072b2e0ff93',
  'server/channelReference/worker.ts': '1ed87b053db50d3691a9af36ac9a25d7e82d094c7314f19518bdafc1be439df9',
  'shared/channelReference.ts': '3ef41a6fce3cda655349aeb1f35af36d6933a9cb95df2a8d0f838ec04d53125d',
};
function observeFreeze() {
  for (const [file, hash] of Object.entries(FROZEN_SOURCE_HASHES)) assert.equal(sha(fs.readFileSync(path.join(ROOT, file))), hash, 'EXACT_FINITE_SOURCE_FREEZE ' + file);
}
const write = (name, value) => fs.writeFileSync(path.join(W, name), JSON.stringify(value, null, 2) + '\n');
function bindingProof() {
  const file = 'server/channelReference/service.ts', text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = sf.statements.flatMap(n => ts.isVariableStatement(n) ? [...n.declarationList.declarations] : []);
  const service = declarations.filter(d => d.name.getText(sf) === 'service');
  const lookup = declarations.filter(d => d.name.getText(sf) === 'lookupChannelReferences');
  const imports = sf.statements.filter(ts.isImportDeclaration).filter(n => n.moduleSpecifier.text === './snapshot');
  assert.equal(imports.length, 1, 'EXACT_SNAPSHOT_FACTORY_IMPORT');
  const named = imports[0].importClause?.namedBindings?.elements;
  assert(named?.length === 1 && named[0].name.text === 'createChannelReferenceSnapshotService' && !named[0].propertyName, 'SNAPSHOT_FACTORY_IMPORT_BINDING');
  assert(service.length === 1 && ts.isCallExpression(service[0].initializer) && service[0].initializer.expression.getText(sf) === 'createChannelReferenceSnapshotService' && service[0].initializer.arguments.length === 0, 'DEFAULT_SNAPSHOT_NO_DI');
  assert(lookup.length === 1 && ts.isPropertyAccessExpression(lookup[0].initializer) && lookup[0].initializer.expression.getText(sf) === 'service' && lookup[0].initializer.name.text === 'lookup', 'ACTUAL_DEFAULT_LOOKUP_BINDING');
  const exported = sf.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.includes(lookup[0]));
  assert(exported.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword), 'ACTUAL_DEFAULT_LOOKUP_EXPORTED');
  const legacy = sf.statements.filter(ts.isFunctionDeclaration).find(n => n.name?.text === 'createChannelReferenceService');
  assert(legacy?.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword), 'LEGACY_EXPORTED_FACTORY_RETAINED');
  const retained = text.split('\n').slice(0, 155).join('\n') + '\n';
  assert.equal(sha(retained), 'f0da316a7891813f051c5b16bc908b6bd6ac6148cedfee8fd596d26231d926cd', 'LEGACY_SAFETY_BLOCK_BYTES_UNCHANGED');
  return { sourceFile: file, sourceSha256: sha(text), snapshotSourceSha256: sha(fs.readFileSync(path.join(ROOT, 'server/channelReference/snapshot.ts'))), importSha256: sha(imports[0].getText(sf)), factoryBindingSha256: sha(service[0].getText(sf)), exportBindingSha256: sha(exported.getText(sf)), factory: 'createChannelReferenceSnapshotService()', defaultExport: 'lookupChannelReferences = service.lookup', legacyFactoryRetainedExported: true, legacyFirst155LinesSha256: sha(retained), legacySafetyBlocksByteUnchanged: true, defaultLookupCallsLegacyFactory: false };
}
async function buildGraph(entry, output, metaName) {
  const options = { absWorkingDir: ROOT, entryPoints: [entry], outfile: path.join(W, output), bundle: true, format: 'esm', platform: 'node', target: 'node22', metafile: true, write: false };
  observeFreeze();
  const first = await esbuild.build(options);
  const sourceHashes = {};
  for (const file of Object.keys(first.metafile.inputs)) {
    assert(file.startsWith('server/channelReference/'), 'NON_PUBLIC_GRAPH_IMPORT ' + file);
    assert.equal(sha(fs.readFileSync(path.join(ROOT, file))), FROZEN_SOURCE_HASHES[file], 'FROZEN_BUILD_INPUT ' + file);
    sourceHashes[file] = FROZEN_SOURCE_HASHES[file];
  }
  const second = await esbuild.build(options);
  assert.equal(first.outputFiles.length, 1);
  assert.equal(second.outputFiles.length, 1);
  assert.equal(sha(first.outputFiles[0].contents), sha(second.outputFiles[0].contents), 'GRAPH_NOT_REPRODUCIBLE');
  assert.deepEqual(first.metafile, second.metafile, 'METAFILE_NOT_REPRODUCIBLE');
  for (const [file, hash] of Object.entries(sourceHashes)) assert.equal(sha(fs.readFileSync(path.join(ROOT, file))), hash, 'SOURCE_MOVED ' + file);
  const metaOutput = Object.values(first.metafile.outputs);
  assert.equal(metaOutput.length, 1);
  for (const item of metaOutput[0].imports) assert(item.external && item.path.startsWith('node:'), 'NON_BUILTIN_EXTERNAL ' + item.path);
  const data = first.outputFiles[0].contents;
  fs.writeFileSync(path.join(W, output), data);
  write(metaName, first.metafile);
  return { entryPoint: entry, artifact: output, artifactSha256: sha(data), bytes: data.length, metafile: metaName, metafileSha256: sha(fs.readFileSync(path.join(W, metaName))), exports: metaOutput[0].exports, sourceHashes, independentlyBuiltTwice: true, outputAndMetafileReproductionByteExact: true, reproductionOutputSha256: [sha(first.outputFiles[0].contents), sha(second.outputFiles[0].contents)], reproductionMetafileSha256: [sha(JSON.stringify(first.metafile)), sha(JSON.stringify(second.metafile))], noApplicationDatabaseAccountGraph: true, executed: false };
}
async function verifyActualDefault(service) {
  assert(!process.argv.includes('--public-reference-page'), 'NEVER_EXECUTE_WORKER_CLI');
  const out = path.join(W, 'backend-candidate'); fs.mkdirSync(out, { recursive: true });
  const dir = fs.mkdtempSync(path.join(out, '.NON-LIVE-snapshot-default-test-'));
  const bundle = path.join(dir, 'channel-reference-service.mjs'), fixturePath = path.join(dir, 'channel-reference-snapshot.json');
  const artifactBytes = fs.readFileSync(path.join(W, service.artifact));
  fs.writeFileSync(bundle, artifactBytes);
  fs.writeFileSync(path.join(dir, 'NON-LIVE-TEST-ONLY.txt'), 'Synthetic temporary fixture only. NOT research evidence, NOT formal snapshot, NOT deployment. No DB.\n');
  const time = '2026-10-01T00:00:00.000Z';
  const material = { materialId: 1, partNumber: ' NON-LIVE-TEST/SUFFIX ', brand: ' TEST-ONLY ' };
  const negative = source => ({ source, status: 'not_found', matchedPartNumber: null, matchedBrand: null, productCode: null, pageUrl: null, stockQuantity: null, unitPrice: null, tierQuantity: null, tiers: [], currency: null, unit: null, taxStatus: 'unknown', packaging: null, fetchedAt: time, expiresAt: null, stockInsufficientForTier: false, message: null });
  const positive = { ...negative('lcsc'), status: 'ok', matchedPartNumber: 'NON-LIVE-TEST/SUFFIX', matchedBrand: 'TEST-ONLY', productCode: 'TEST-ONLY', pageUrl: 'https://item.szlcsc.com/123456789.html', stockQuantity: 7, unitPrice: '0.0123', tierQuantity: 10000, tiers: [{ minQuantity: 1, unitPrice: '0.5' }, { minQuantity: 10000, unitPrice: '0.0123' }], currency: 'CNY', stockInsufficientForTier: true };
  const evidence = { expectedPartNumber: material.partNumber, observedPartNumber: positive.matchedPartNumber, expectedBrand: material.brand, observedBrand: positive.matchedBrand, brandMatch: 'exact', literalReason: null, pageUrl: positive.pageUrl, collectedAt: time, observedMaxQuantity: 10000, observedMaxUnitPrice: '0.0123', maxTierConfirmed: true };
  const document = { schemaVersion: 1, collectionMode: 'public-web-batch', generatedAt: time, records: [{ partNumber: material.partNumber, brand: material.brand, references: { lcsc: positive, ickey: negative('ickey') }, evidence: { lcsc: evidence, ickey: null } }] };
  const fixtureBytes = Buffer.from(JSON.stringify(document) + '\n');
  const harnessOpen = fs.openSync.bind(fs), harnessWrite = fs.writeSync.bind(fs), harnessClose = fs.closeSync.bind(fs);
  const savedWrite = (file, content) => {
    assert.equal(file, fixturePath, 'HARNESS_WRITES_TEMP_TEST_FIXTURE_ONLY');
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content), fd = harnessOpen(file, 'w', 0o600);
    try { let at = 0; while (at < bytes.length) at += harnessWrite(fd, bytes, at, bytes.length - at); } finally { harnessClose(fd); }
  };
  const savedRead = fs.readFileSync.bind(fs), savedUnlink = fs.unlinkSync.bind(fs), savedRm = fs.rmSync.bind(fs);
  const restores = [], attempts = [], opens = [], checks = [];
  function replace(obj, name, fn) { if (typeof obj[name] !== 'function') return; const original = obj[name]; obj[name] = fn; restores.push(() => { obj[name] = original; }); }
  const deny = label => (...args) => { attempts.push(label); throw new Error('NON-LIVE TEST BLOCKED IO ' + label); };
  const modules = {
    'node:child_process': ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'],
    'node:http': ['request', 'get'], 'node:https': ['request', 'get'], 'node:http2': ['connect'],
    'node:net': ['connect', 'createConnection'], 'node:tls': ['connect'], 'node:dgram': ['createSocket'],
    'node:dns': ['lookup', 'resolve', 'resolve4', 'resolve6'], 'node:dns/promises': ['lookup', 'resolve', 'resolve4', 'resolve6']
  };
  for (const [mod, names] of Object.entries(modules)) { const obj = require(mod); for (const name of names) replace(obj, name, deny(mod + '.' + name)); }
  replace(require('node:net').Socket.prototype, 'connect', deny('net.Socket.connect'));
  replace(globalThis, 'fetch', deny('global.fetch'));
  const fsp = require('node:fs/promises'), originalOpen = fsp.open;
  for (const name of ['mkdir', 'readFile', 'writeFile', 'rename', 'lstat', 'readdir', 'unlink', 'rm', 'appendFile', 'truncate', 'copyFile', 'chmod', 'chown', 'link', 'symlink', 'rmdir']) replace(fsp, name, deny('fs.promises.' + name));
  for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'rmSync', 'truncateSync', 'copyFileSync', 'writeSync', 'createWriteStream']) replace(fs, name, deny('fs.' + name));
  const originalOpenSync = fs.openSync;
  replace(fs, 'openSync', (file, flags, ...rest) => {
    const actual = file instanceof URL ? fileURLToPath(file) : file;
    assert([bundle, fixturePath].includes(actual), 'ONLY_LOADER_BUNDLE_OR_TEST_HASH_SYNC_READ');
    assert(flags === 'r' || flags === fs.constants.O_RDONLY, 'SYNC_READ_ONLY');
    return originalOpenSync(file, flags, ...rest);
  });
  replace(fsp, 'open', async (file, flags, ...rest) => {
    const actual = file instanceof URL ? fileURLToPath(file) : file;
    assert.equal(actual, fixturePath, 'ONLY_FIXED_BUNDLE_SIBLING_READ');
    assert.equal(flags, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 'EXACT_READONLY_NOFOLLOW_NONBLOCK');
    const record = { relative: 'channel-reference-snapshot.json', flags, opened: false, closed: false, bytesRead: 0 }; opens.push(record);
    const handle = await originalOpen(file, flags, ...rest); record.opened = true;
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.read = async (...args) => { const result = await read(...args); record.bytesRead += result.bytesRead; return result; };
    handle.close = async (...args) => { try { return await close(...args); } finally { record.closed = true; } };
    for (const name of ['write', 'writev', 'writeFile', 'appendFile', 'truncate', 'chmod', 'chown', 'utimes']) if (typeof handle[name] === 'function') handle[name] = deny('FileHandle.' + name);
    return handle;
  });
  syncBuiltinESMExports();
  async function check(name, fn) { await fn(); checks.push({ name, status: 'PASS' }); }
  let result;
  try {
    const actual = await import(pathToFileURL(bundle).href);
    assert.equal(typeof actual.lookupChannelReferences, 'function');
    assert.equal(typeof actual.createChannelReferenceService, 'function');
    await check('actual default missing file fails explicitly without legacy fallback', () => assert.rejects(actual.lookupChannelReferences([material]), e => e.name === 'ChannelReferenceSnapshotUnavailableError'));
    savedWrite(fixturePath, fixtureBytes);
    await check('actual default positive and negative snapshot output; maximum tier; no pending', async () => {
      const value = await actual.lookupChannelReferences([{ ...material, PRIVATE: 'must-strip' }]);
      assert.equal(value.items[0].references.lcsc.status, 'ok'); assert.equal(value.items[0].references.lcsc.unitPrice, '0.0123'); assert.equal(value.items[0].references.lcsc.tierQuantity, 10000); assert.equal(value.items[0].references.ickey.status, 'not_found');
      assert.deepEqual(Object.keys(value.items[0]).sort(), ['brand', 'materialId', 'partNumber', 'references']);
      for (const q of Object.values(value.items[0].references)) { assert.notEqual(q.status, 'pending'); assert.equal(q.expiresAt, null); }
    });
    await check('refresh ignored; >30 day fixture has no 20-minute expiry and is not rewritten', async () => {
      assert(Date.now() - Date.parse(time) > 30 * 24 * 60 * 60_000);
      const a = await actual.lookupChannelReferences([material]), b = await actual.lookupChannelReferences([material], { refresh: true }); assert.deepEqual(a, b); assert.equal(sha(savedRead(fixturePath)), sha(fixtureBytes));
    });
    await check('returned values cannot mutate cached snapshot', async () => { const a = await actual.lookupChannelReferences([material]); a.items[0].references.lcsc.tiers[1].unitPrice = '999'; assert.equal((await actual.lookupChannelReferences([material])).items[0].references.lcsc.tiers[1].unitPrice, '0.0123'); });
    await check('raw identity is exact and has no materialId/private lookup expansion', async () => { const a = await actual.lookupChannelReferences([{ ...material, materialId: 2, partNumber: material.partNumber.trim() }]); assert.equal(a.items[0].references.lcsc.status, 'not_found'); const b = await actual.lookupChannelReferences([{ ...material, materialId: 3 }]); assert.equal(b.items[0].references.lcsc.status, 'ok'); });
    await check('byte SHA replacement reloads actual default cache', async () => { const changed = JSON.parse(JSON.stringify(document)); changed.records[0].references.lcsc.unitPrice = '0.0111'; changed.records[0].references.lcsc.tiers[1].unitPrice = '0.0111'; changed.records[0].evidence.lcsc.observedMaxUnitPrice = '0.0111'; savedWrite(fixturePath, JSON.stringify(changed)); assert.equal((await actual.lookupChannelReferences([material])).items[0].references.lcsc.unitPrice, '0.0111'); });
    await check('corrupt replacement clears cache and does not call nativeFetch', async () => { savedWrite(fixturePath, '{bad'); await assert.rejects(actual.lookupChannelReferences([material], { refresh: true }), e => e.name === 'ChannelReferenceSnapshotUnavailableError'); });
    await check('deleted snapshot explicitly fails with no cached fallback', async () => { savedWrite(fixturePath, fixtureBytes); await actual.lookupChannelReferences([material]); savedUnlink(fixturePath); await assert.rejects(actual.lookupChannelReferences([material]), e => e.name === 'ChannelReferenceSnapshotUnavailableError'); });
    assert.equal(attempts.length, 0, 'DEFAULT_LOOKUP_ATTEMPTED_FORBIDDEN_IO');
    assert(opens.every(o => !o.opened || o.closed), 'ALL_READ_HANDLES_CLOSED');
    result = { status: 'PASS', statusScope: 'actual byte-identical ESM default export, temporary synthetic NON-LIVE fixture only; NOT webpage research, NOT formal JSON or deployment', artifactSha256: sha(artifactBytes), actualDefaultExportInvoked: true, legacyFactoryExportPresentButNotInvoked: true, snapshotOnlyDefaultLookup: true, checks, count: checks.length, fixtureSyntheticNonLive: true, fixtureSha256: sha(fixtureBytes), fixtureIdentity: { partNumber: material.partNumber, brand: material.brand }, fixtureGeneratedAt: time, fixedSiblingLayoutProved: true, readonlyOpenFlags: fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, readTrace: opens, forbiddenIOAttemptCount: attempts.length, forbiddenIOAttempts: attempts, noNETExecution: true, networkExecution: false, spawnExecution: false, databaseAccess: false, defaultLookupFileWrites: false, refreshIgnored: true, pendingAbsent: true, no20MinuteExpiry: true, noApplicationEntryExecuted: true, formalJSONWritten: false, liveEvidencePendingResearch: true, formalJSONNotReady: true, fixtureRemoved: true };
  } catch (error) { result = { status: 'FAIL', message: error.message, stack: error.stack, checks, forbiddenIOAttempts: attempts, readTrace: opens, fixtureSyntheticNonLive: true, formalJSONWritten: false }; throw error; }
  finally { for (const restore of restores.reverse()) restore(); syncBuiltinESMExports(); savedRm(dir, { recursive: true, force: true }); write('service-default-runtime-proof.json', result); }
  return result;
}
async function run() {
  observeFreeze();
  const binding = bindingProof();
  const service = await buildGraph('server/channelReference/service.ts', 'channel-reference-service.mjs', 'service-metafile.json');
  const worker = await buildGraph('server/channelReference/worker.ts', 'channel-reference-worker.mjs', 'worker-metafile.json');
  assert(service.exports.includes('lookupChannelReferences') && service.exports.includes('createChannelReferenceService'));
  assert(service.sourceHashes['server/channelReference/snapshot.ts'], 'ACTUAL_SNAPSHOT_RUNTIME_SOURCE_REQUIRED');
  assert(worker.exports.includes('fetchPublicReferenceQuote') && worker.exports.includes('parseReferenceQuote'));
  const typeOnlySourceHashes = { 'shared/channelReference.ts': sha(fs.readFileSync(path.join(ROOT, 'shared/channelReference.ts'))) };
  const sourceHashes = Object.fromEntries(Object.entries({ ...service.sourceHashes, ...worker.sourceHashes, ...typeOnlySourceHashes }).sort(([a], [b]) => a.localeCompare(b)));
  assert.deepEqual(sourceHashes, Object.fromEntries(Object.entries(FROZEN_SOURCE_HASHES).sort(([a], [b]) => a.localeCompare(b))), 'EXACT_TEN_INPUT_FREEZE_REQUIRED');
  const runtime = await verifyActualDefault(service);
  service.executed = true; service.executionScope = 'actual default lookup in NON-LIVE temporary copy with exact artifact SHA; legacy exported factory never invoked';
  service.snapshotOnlyDefaultLookup = true; service.legacyNetworkCapableExportsPresent = true; service.liveEvidencePendingResearch = true; service.formalJSONNotReady = true;
  worker.unusedNotDeployment = true; worker.deploymentRequired = false;
  for (const [file, hash] of Object.entries(sourceHashes)) assert.equal(sha(fs.readFileSync(path.join(ROOT, file))), hash, 'FINAL_SOURCE_MOVED ' + file);
  const result = { status: 'PASS', sourceGraphReproductionProved: true, service, worker, sourceHashes, actualSourceUnion: Object.keys(sourceHashes), sourceFiles: Object.keys(sourceHashes).length, typeOnlySourceHashes, defaultBindingProof: binding, defaultRuntimeProof: 'service-default-runtime-proof.json', defaultRuntimeProofSha256: sha(fs.readFileSync(path.join(W, 'service-default-runtime-proof.json'))), actualDefaultRuntimePassed: runtime.status === 'PASS', noSecretOrApplicationImports: true, databaseAccess: false, noNETExecution: true, networkExecution: false, applicationEntryExecuted: false, defaultLookupSnapshotOnly: true, legacyNetworkCapableExportsPresent: true, workerUnusedNotDeployment: true, liveEvidencePendingResearch: true, formalJSONNotReady: true, runtimePublicReadinessNotAssumed: true };
  write('service-graph-proof.json', result);
  console.log(JSON.stringify({ status: result.status, sourceFiles: result.sourceFiles, serviceSha256: service.artifactSha256, workerSha256: worker.artifactSha256, actualDefaultRuntimeChecks: runtime.count }));
  return result;
}
module.exports = { run, bindingProof };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
