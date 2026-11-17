#!/usr/bin/env node
// Private offline checks only. Uses the real compiled default export and exact
// fixed sibling files; never imports application entrypoints or executes worker.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import child from 'node:child_process';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const key = r => JSON.stringify([r.partNumber, r.brand]);
const SOURCES = ['lcsc', 'ickey'];
const DATA_NAMES = ['channel-reference-snapshot', 'channel-reference-identity-bindings', 'channel-reference-stock-evidence'];
const FIXED_CONFIG = '/var/lib/51dianzi/channel-reference-manual-v1/manual-refresh-config.json';
const BASELINE_SHA = 'a00f52da7e423addf6b40508c972ad34df0eecec71250b1206ce9cb35c5ae436';
function bytes(file) { assert(!fs.lstatSync(file).isSymbolicLink(), 'SYMLINK_INPUT_REFUSED'); assert(fs.statSync(file).isFile()); return fs.readFileSync(file); }
function inputFile(dir, name) {
  const candidates = [path.join(dir, name + '.json'), path.join(dir, name + '.staged.json')].filter(f => fs.existsSync(f));
  assert.equal(candidates.length, 1, 'ONE_UNAMBIGUOUS_DATA_INPUT_REQUIRED ' + name);
  return candidates[0];
}
function workOutput(buildDir, dir) {
  const p = path.resolve(dir);
  assert(p.startsWith(path.resolve(buildDir) + path.sep) && p !== path.join(buildDir, 'runtime'), 'PRIVATE_WORK_OUTPUT_ONLY');
  return p;
}
function networkGuard() {
  let active = false;
  const attempts = [], patches = [];
  const replace = (object, name, label) => {
    const prior = object[name];
    if (typeof prior !== 'function') return;
    object[name] = function (...args) {
      if (active) { attempts.push(label); throw Error('OFFLINE_FORBIDDEN_OPERATION ' + label); }
      return prior.apply(this, args);
    };
    patches.push(() => { object[name] = prior; });
  };
  for (const [object, names, label] of [
    [child, ['spawn', 'spawnSync', 'exec', 'execFile', 'execSync', 'execFileSync', 'fork'], 'child'],
    [dns, ['lookup', 'resolve', 'resolve4', 'resolve6'], 'dns'],
    [dnsPromises, ['lookup', 'resolve', 'resolve4', 'resolve6'], 'dnsPromises'],
    [http, ['request', 'get', 'createServer'], 'http'], [https, ['request', 'get', 'createServer'], 'https'],
    [net, ['connect', 'createConnection', 'createServer'], 'net'], [tls, ['connect', 'createServer'], 'tls'],
    [fsp, ['mkdir', 'mkdtemp', 'writeFile', 'rename', 'unlink', 'rm', 'chown'], 'fsPromisesWrite'],
    [fs, ['writeFileSync', 'mkdirSync', 'renameSync', 'unlinkSync', 'rmSync'], 'fsWrite'],
  ]) for (const name of names) replace(object, name, label + '.' + name);
  const fetch = globalThis.fetch;
  globalThis.fetch = function (...args) { if (active) { attempts.push('fetch'); throw Error('OFFLINE_FORBIDDEN_FETCH'); } return fetch(...args); };
  const open = fsp.open;
  fsp.open = function (file, flags, ...args) {
    if (active && (typeof flags === 'number' ? !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC)) : flags !== 'r')) {
      attempts.push('write-open'); throw Error('OFFLINE_FORBIDDEN_WRITE_OPEN');
    }
    return open.call(this, file, flags, ...args);
  };
  patches.push(() => { fsp.open = open; });
  syncBuiltinESMExports();
  return {
    attempts,
    run: async fn => { active = true; try { return await fn(); } finally { active = false; } },
    restore: () => { active = false; globalThis.fetch = fetch; for (const undo of patches.reverse()) undo(); syncBuiltinESMExports(); },
  };
}
function priceFields(q) {
  const clone = structuredClone(q);
  for (const n of ['stockQuantity', 'stockInsufficientForTier', 'stockFetchedAt', 'stockPageUrl']) delete clone[n];
  return clone;
}
export async function checkDefaultLoader({ buildDir, dataDir, outputDir, existingRuntimeDir = null }) {
  assert(!fs.existsSync(FIXED_CONFIG), 'CONFIG_PRESENT_OFFLINE_DEFAULT_DISABLED_PRECONDITION_FAILED');
  const manifest = JSON.parse(bytes(path.join(buildDir, 'manifest.json')));
  const reportDir = workOutput(buildDir, outputDir);
  fs.mkdirSync(reportDir, { recursive: true });
  const inputs = Object.fromEntries(DATA_NAMES.map(n => [n, bytes(inputFile(dataDir, n))]));
  const doc = JSON.parse(inputs['channel-reference-snapshot']);
  const bindingDoc = JSON.parse(inputs['channel-reference-identity-bindings']);
  const stockDoc = JSON.parse(inputs['channel-reference-stock-evidence']);
  const snapshotSha = sha(inputs['channel-reference-snapshot']);
  assert.equal(bindingDoc.snapshotSha256, snapshotSha, 'BINDINGS_EXACT_FINAL_SNAPSHOT_BYTES_REQUIRED');
  assert.equal(stockDoc.snapshotSha256, snapshotSha, 'STOCK_EXACT_FINAL_SNAPSHOT_BYTES_REQUIRED');
  const authorizationFile = path.join(buildDir, 'binding-authorization.json');
  const authorizationBytes = bytes(authorizationFile), authorization = JSON.parse(authorizationBytes);
  const baselineFile = '/home/ubuntu/work/channel-reference-fill-20261117/data/before-snapshot.exact.json';
  const baselineBytes = bytes(baselineFile);
  assert.equal(sha(baselineBytes), BASELINE_SHA, 'EXACT_CAPTURED_BASELINE_REQUIRED_NOT_APPLICATION_JSON');
  const baseline = JSON.parse(baselineBytes);
  const currentMap = new Map(doc.records.map(r => [key(r), r]));
  const oldMap = new Map(baseline.records.map(r => [key(r), r]));
  const approvedIdentities = new Set(authorization.allowedSnapshotIdentityKeys);
  assert(doc.records.every(r => approvedIdentities.has(key(r))), 'SNAPSHOT_IDENTITY_OUTSIDE_FINITE_REVIEWED_AUTHORIZATION');
  for (const k of oldMap.keys()) assert(currentMap.has(k), 'ORIGINAL_RAW_IDENTITY_REMOVED');
  const retained = [];
  for (const [k, old] of oldMap) for (const source of SOURCES) if (old.references[source].status === 'ok') {
    assert.deepEqual(currentMap.get(k).references[source], old.references[source], 'ORIGINAL_OK_QUOTE_CHANGED ' + k + ' ' + source);
    assert.deepEqual(currentMap.get(k).evidence[source], old.evidence[source], 'ORIGINAL_OK_EVIDENCE_CHANGED ' + k + ' ' + source);
    retained.push({ key: k, source, quoteSha256: sha(JSON.stringify(old.references[source])), evidenceSha256: sha(JSON.stringify(old.evidence[source])) });
  }
  assert.equal(retained.length, 213, 'ALL_213_OLD_SUCCESSFUL_QUOTES_AND_EVIDENCE_REQUIRED');
  const auditPath = manifest.artifacts.privateAudit.path;
  assert.equal(sha(bytes(auditPath)), manifest.artifacts.privateAudit.sha256, 'AUDIT_COMPILED_PIN_DRIFT');
  const audit = await import(pathToFileURL(auditPath).href);
  const strict = audit.validateChannelReferenceSnapshot(inputs['channel-reference-snapshot']);
  assert(strict.allValid, 'UNCHANGED_STRICT_SNAPSHOT_VALIDATOR_REJECTED_DATA');
  const bindings = audit.parseChannelReferenceIdentityBindings(inputs['channel-reference-identity-bindings'], snapshotSha);
  const authBindings = new Map(authorization.bindings.map(b => [key(b.raw), b]));
  for (const [k, binding] of bindings) {
    assert(authBindings.has(k), 'BINDING_OUTSIDE_FINITE_REVIEWED_AUTHORIZATION ' + k);
    assert.deepEqual(binding, authBindings.get(k), 'EXACT_REVIEWED_BINDING_CHANGED ' + k);
    assert(oldMap.has(k) || approvedIdentities.has(k), 'UNAPPROVED_RAW_BINDING');
    for (const source of binding.sources) assert.equal(currentMap.get(key(binding.canonical))?.references[source].status, 'ok', 'AUTHORIZED_CANONICAL_SOURCE_NOT_STRICT_OK');
  }
  const runtime = existingRuntimeDir ? path.resolve(existingRuntimeDir) : path.join(reportDir, 'runtime');
  if (existingRuntimeDir) {
    assert(runtime.startsWith('/home/ubuntu/work/'), 'READONLY_LOCAL_RUNTIME_ONLY');
    for (const name of DATA_NAMES) assert(bytes(path.join(runtime, name + '.json')).equals(inputs[name]), 'EXISTING_SIBLING_DATA_BYTES_DRIFT');
  } else {
    fs.mkdirSync(runtime, { recursive: true });
    for (const kind of ['service', 'worker']) fs.writeFileSync(path.join(runtime, 'channel-reference-' + kind + '.mjs'), bytes(path.join(manifest.buildOutput, 'channel-reference-' + kind + '.mjs')));
    for (const name of DATA_NAMES) fs.writeFileSync(path.join(runtime, name + '.json'), inputs[name]);
  }
  for (const kind of ['service', 'worker']) assert.equal(sha(bytes(path.join(runtime, 'channel-reference-' + kind + '.mjs'))), manifest.artifacts[kind].sha256, 'COMPILED_' + kind + '_PIN_DRIFT');
  const stockMap = new Map(stockDoc.records.map(r => [JSON.stringify([r.partNumber, r.brand, r.source]), r]));
  const samples = [...bindings.values()].map(b => b.raw);
  samples.push(...stockDoc.records.map(r => ({ partNumber: r.partNumber, brand: r.brand })));
  const unknowns = doc.records.flatMap(r => SOURCES.filter(s => r.references[s].status === 'ok' && r.references[s].stockQuantity === null && !stockMap.has(JSON.stringify([r.partNumber, r.brand, s]))).map(source => ({ ...r, source }))).slice(0, 2);
  assert(unknowns.length, 'UNKNOWN_STOCK_SAMPLE_REQUIRED');
  samples.push(...unknowns);
  const knownZero = doc.records.find(r => SOURCES.some(s => r.references[s].status === 'ok' && r.references[s].stockQuantity === 0));
  assert(knownZero, 'EXISTING_ZERO_STOCK_SAMPLE_REQUIRED');
  samples.push(knownZero);
  const materials = [...new Map(samples.map(r => [key(r), { partNumber: r.partNumber, brand: r.brand }])).values()].map((r, i) => ({ materialId: i + 1, ...r }));
  const guard = networkGuard();
  let lookup, items = [], calls = 0;
  try {
    const service = await guard.run(() => import(pathToFileURL(path.join(runtime, 'channel-reference-service.mjs')).href));
    lookup = async materials => { calls++; return guard.run(() => service.lookupChannelReferences(materials)); };
    for (let i = 0; i < materials.length; i += 20) items.push(...(await lookup(materials.slice(i, i + 20))).items);
    const hit = new Map(items.map(r => [key(r), r]));
    const bindingChecks = [];
    for (const [k, b] of bindings) for (const source of b.sources) {
      const out = hit.get(k), raw = currentMap.get(k)?.references[source];
      const expected = raw?.status === 'ok' ? raw : currentMap.get(key(b.canonical)).references[source];
      assert.equal(key(out), k, 'OUTER_RAW_IDENTITY_CHANGED');
      assert.equal(out.references[source].status, 'ok', 'DEFAULT_BINDING_NOT_OK');
      assert.deepEqual(priceFields(out.references[source]), priceFields(expected), 'BOUND_PRICE_FIELDS_CHANGED');
      const proof = stockMap.get(JSON.stringify([raw?.status === 'ok' ? b.raw.partNumber : b.canonical.partNumber, raw?.status === 'ok' ? b.raw.brand : b.canonical.brand, source]));
      if (!proof) assert.deepEqual(out.references[source], expected, 'BOUND_QUOTE_NOT_EXACT');
      bindingChecks.push({ raw: b.raw, canonical: b.canonical, source, status: 'ok', outerRawPreserved: true, originalPriceFieldsExact: true });
    }
    const stockChecks = [];
    for (const r of stockDoc.records) {
      const q = hit.get(key(r)).references[r.source], original = currentMap.get(key(r)).references[r.source];
      assert.equal(original.stockQuantity, null);
      assert.equal(q.stockQuantity, r.stockQuantity, 'DEFAULT_STOCK_NOT_FILLED');
      assert.equal(q.stockFetchedAt, r.collectedAt, 'ORIGINAL_CAPTURE_TIME_NOT_PRESERVED');
      assert.equal(q.stockPageUrl, r.pageUrl);
      assert.equal(q.stockInsufficientForTier, r.stockQuantity < original.tierQuantity);
      assert.deepEqual(priceFields(q), priceFields(original), 'PRICE_OR_ORIGINAL_FETCHED_AT_OVERWRITTEN');
      stockChecks.push({ partNumber: r.partNumber, brand: r.brand, source: r.source, stockQuantity: r.stockQuantity, originalPriceFetchedAt: q.fetchedAt, independentStockFetchedAt: q.stockFetchedAt, quoteFieldsExceptStockExact: true });
    }
    for (const r of unknowns) { assert.equal(hit.get(key(r)).references[r.source].stockQuantity, null); assert(!Object.hasOwn(hit.get(key(r)).references[r.source], 'stockFetchedAt')); }
    for (const source of SOURCES) if (knownZero.references[source].status === 'ok' && knownZero.references[source].stockQuantity === 0) assert.deepEqual(hit.get(key(knownZero)).references[source], knownZero.references[source], 'EXISTING_ZERO_OVERWRITTEN');
    const checks = { strictSnapshotValidator: true, all213OriginalQuoteAndEvidenceDeepEqual: true, finiteReviewedBindings: true, actualDefaultServiceExportCalled: true, fixedSiblingDefaultsRead: true, realStockCount: stockChecks.length, unknownNullNotInferredAsZero: true, existingZeroStockPreserved: true, noPriceOrQuoteFetchedAtOverwrite: true };
    // Two extra small tests mutate only the private copied sibling. Skip all
    // mutations when checking an existing final runtime directory read-only.
    if (!existingRuntimeDir && stockDoc.records.length) {
      const first = stockDoc.records[0], material = { materialId: 9001, partNumber: first.partNumber, brand: first.brand };
      const oldQuote = currentMap.get(key(first)).references[first.source];
      const firstHit = hit.get(key(first)).references[first.source];
      firstHit.unitPrice = '999999'; firstHit.tiers[0].unitPrice = '999999';
      const reloadedQuote = (await lookup([material])).items[0].references[first.source];
      assert.deepEqual(priceFields(reloadedQuote), priceFields(oldQuote), 'RETURN_VALUE_MUTATION_LEAKED_INTO_SNAPSHOT');
      hit.get(key(first)).references[first.source] = reloadedQuote;
      checks.returnCloneIsolated = true;
      const zeroDoc = structuredClone(stockDoc), z = zeroDoc.records[0];
      z.stockQuantity = 0;
      z.rawExcerpt = z.rawExcerpt.replace(z.source === 'lcsc' ? /现货[：:]\s*(0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?=\s|$)/ : /库存[：:]\s*(0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?=\s|$)/, z.source === 'lcsc' ? '现货：0' : '库存：0');
      z.rawExcerptSha256 = sha(z.rawExcerpt);
      const stockFile = path.join(runtime, 'channel-reference-stock-evidence.json');
      fs.writeFileSync(stockFile, JSON.stringify(zeroDoc, null, 2) + '\n');
      const zeroQuote = (await lookup([material])).items[0].references[first.source];
      assert.equal(zeroQuote.stockQuantity, 0, 'SYNTHETIC_OFFLINE_ZERO_NOT_DISTINCT_FROM_NULL');
      assert.equal(zeroQuote.stockFetchedAt, first.collectedAt);
      assert.deepEqual(priceFields(zeroQuote), priceFields(oldQuote));
      checks.syntheticZeroStockOnlyPrivateFixture = true;
      fs.unlinkSync(stockFile);
      const missingQuote = (await lookup([material])).items[0].references[first.source];
      assert.equal(missingQuote.stockQuantity, null, 'MISSING_SIDECAR_MUST_NOT_KEEP_LAST_GOOD_STOCK');
      assert(!Object.hasOwn(missingQuote, 'stockFetchedAt'));
      assert.deepEqual(priceFields(missingQuote), priceFields(oldQuote));
      checks.missingSidecarFailClosedToOriginalUnknown = true;
      fs.writeFileSync(stockFile, inputs['channel-reference-stock-evidence']);
      assert.equal((await lookup([material])).items[0].references[first.source].stockQuantity, first.stockQuantity);
      checks.restoredRealDataReloaded = true;
    }
    assert.equal(guard.attempts.length, 0, 'NO_NETWORK_PROCESS_OR_CACHE_WRITES_ALLOWED');
    const report = {
      version: 'channel-reference-default-disabled-offline-check-v1', buildOutput: manifest.buildOutput, runtimeUnderTest: runtime,
      actualProductionDefaultExport: 'lookupChannelReferences', fullActualServiceCompiled: true,
      sourceHashes: manifest.sourceHashes, sourceLockSha256: manifest.sourceLockSha256,
      inputHashes: Object.fromEntries(DATA_NAMES.map(n => [n + '.json', sha(inputs[n])])),
      finiteAuthorizationSha256: sha(authorizationBytes), capturedBaselineSha256: BASELINE_SHA,
      recordCount: strict.recordCount, sourceCount: strict.sourceCount, strictPositiveCount: strict.positiveCount,
      originalSuccessReferencesPreserved: retained.length, originalRawIdentitiesRetained: oldMap.size,
      bindingCount: bindings.size, bindingSourceCount: bindingChecks.length, defaultLoaderMaterialCount: materials.length,
      defaultLoaderOutputCount: items.length, defaultLoaderOutputSourceCount: items.length * 2, defaultLookupCallCount: calls,
      realStockCount: stockChecks.length, stockBySource: Object.fromEntries(SOURCES.map(s => [s, stockChecks.filter(r => r.source === s).length])),
      checks, bindingChecks, stockChecks, originalSuccessRetained: retained,
      unknownStockSamples: unknowns.map(r => ({ partNumber: r.partNumber, brand: r.brand, source: r.source, stockQuantity: null })),
      forbiddenOperationAttempts: guard.attempts, networkUsed: false, workerExecuted: false,
      configProvisioned: false, cacheProvisioned: false, activeProducerAccepted: false,
      appSourceModified: false, appJsonModified: false, collectionTimeReplaced: false,
      syntheticFixtureNote: 'Only one private-copy stock record was temporarily set to 0 with a synthetic excerpt, exclusively to test null/0 behavior. It is not real evidence and was restored to exact input bytes. Existing final runtime mode is read-only and skips fixture mutations.',
    };
    for (const n of DATA_NAMES) assert(bytes(path.join(runtime, n + '.json')).equals(inputs[n]), 'FINAL_OFFLINE_SIBLING_NOT_RESTORED');
    fs.writeFileSync(path.join(reportDir, 'default-loader-report.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(reportDir, 'default-loader-lookups.json'), JSON.stringify(items, null, 2) + '\n');
    console.log('Default actual loader PASS: ' + bindings.size + ' raw bindings / ' + bindingChecks.length + ' sources; ' + retained.length + ' old quotes+evidence exact; ' + stockChecks.length + ' real stock fills; ' + items.length + ' sample outputs in ' + calls + ' calls; no worker/network/cache writes.');
    return report;
  } finally {
    guard.restore();
    if (!existingRuntimeDir) for (const n of DATA_NAMES) fs.writeFileSync(path.join(runtime, n + '.json'), inputs[n]);
  }
}
