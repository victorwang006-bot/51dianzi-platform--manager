#!/usr/bin/env node
'use strict';
// Evaluates only AST-extracted customer-original leaves, never the production bundle.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const B = require('./build-native.cjs');
const ts = require('typescript');
const UUID = '123e4567-e89b-42d3-a456-426614174000';
function verifyDelta(before, after, proof) {
  const old = Buffer.from(before), next = Buffer.from(after);
  assert.equal(B.sha(old), proof.beforeSha256); assert.equal(B.sha(next), proof.afterSha256);
  let reversed = next, last = -1;
  for (const e of proof.edits) {
    assert(e.byteStart >= last, 'Non-overlap'); last = e.byteEnd;
    const a = Buffer.from(e.oldBase64, 'base64'), b = Buffer.from(e.newBase64, 'base64');
    assert.equal(B.sha(a), e.oldSha256); assert.equal(B.sha(b), e.newSha256);
    assert(old.subarray(e.byteStart, e.byteEnd).equals(a)); assert(next.subarray(e.newByteStart, e.newByteEnd).equals(b));
  }
  for (const e of [...proof.edits].reverse()) reversed = Buffer.concat([reversed.subarray(0, e.newByteStart), Buffer.from(e.oldBase64, 'base64'), reversed.subarray(e.newByteEnd)]);
  assert(old.equals(reversed), 'Actual whole-file byte inverse');
  for (const p of proof.partitions) {
    const a = old.subarray(p.byteStart, p.byteEnd), b = next.subarray(p.newByteStart, p.newByteEnd);
    assert(a.equals(b)); assert.equal(B.sha(a), p.sha256);
  }
}
function candidateModels(text, instance) {
  const a = B.parse(text), pairs = B.locate(a);
  const pair = B.one(pairs.filter(p => p.originalDecl.name.text === instance.models.sendName && p.session.name.text === instance.session
    && p.chain.map(x => x.name).join('|') === instance.ownerChain.map(x => x.name).join('|')), 'actual candidate owner (unique send binding, not same-name guess)');
  const vars = B.nodes(pair.session, n => ts.isVariableDeclaration(n) && B.owner(n) === pair.session);
  const get = name => B.one(vars.filter(n => n.name.text === name), 'actual candidate variable ' + name).initializer.getText(a);
  const actual = { send: get(instance.models.sendName), persist: get(instance.models.persistName), cache: pair.cache.getText(a), parse: pair.parse.getText(a) };
  for (const key of Object.keys(actual)) assert.equal(actual[key], instance.models[key], 'Proof model is exact native candidate AST leaf: ' + key);
  const helperAst = B.parse(instance.models.helper);
  const declarationNames = statement => ts.isFunctionDeclaration(statement) ? [statement.name.text]
    : ts.isVariableStatement(statement) ? statement.declarationList.declarations.map(d => d.name.text) : [];
  for (const statement of helperAst.statements) {
    const names = declarationNames(statement);
    assert(names.length > 0 && names.every(n => n.startsWith(B.PREFIX)), 'Dedicated helper namespace only');
    const native = B.one(pair.session.parent.statements.filter(s => names.every(n => declarationNames(s).includes(n))), 'helper actual owner statement ' + names.join(','));
    assert.equal(native.getText(a), statement.getText(helperAst), 'Actual candidate helper is exact source-compiled declaration');
  }
  assert.deepEqual(pair.wrappers.map(n => ({ name: n.name.text, sha256: B.sha(n.getText(a)) })),
    instance.callers.map(n => ({ name: n.name, sha256: n.sha256 })), 'Existing Session callers remain byte-identical');
  return { ...instance.models, ...actual };
}
function storage() {
  const values = new Map(); return { values, getItem: k => values.has(k) ? values.get(k) : null,
    setItem: (k, v) => { values.set(k, String(v)); }, removeItem: k => { values.delete(k); } };
}
function harness(instance, models) {
  const state = { current: true, mutations: [], queries: 0, encodes: 0, ids: 0, refusal: null, queryFailure: null, mutate: null };
  const store = storage(), data = { customerId: 7, customerVersion: 3 }, fresh = { customer: { id: 7, version: 3 }, canUpload: true };
  const refs = { frozen: { current: data }, originalOperation: { current: null }, originalInFlight: { current: null },
    contextRef: { current: fresh }, standardAttachment: { current: null }, requests: { current: new Set() } };
  const props = { customerId: 7, identity: { enterpriseId: 8, actorUserId: 9, key: 'identity' }, isCurrent: () => state.current, onAuthorizationError() {} };
  const success = input => ({ history: { historyId: UUID, customerId: 7, mode: input.mode, originalFile: { fileName: input.file.fileName } } });
  const utils = { client: { channelInventory: {
    customerUploadOriginal: { mutate: async input => { state.mutations.push(input); if (state.mutate) return state.mutate(input); if (state.refusal) throw state.refusal; return success(input); } },
    customerUploadHistoryGet: { query: async () => { state.queries++; if (state.queryFailure) throw state.queryFailure; return { originalSheets: [{ sheetIndex: 0, sheetName: 'S1', rows: [] }] }; } }
  } } };
  const bindings = { ...refs, props, utils, expected: { expectedEnterpriseId: 8, expectedActorUserId: 9 }, current: () => state.current,
    fileInput: async file => { state.encodes++; return { base64: file.bytes, fileName: file.name, mimeType: 'text/csv', size: file.bytes.length }; },
    customerSupplySessionSuffix: () => '8:9:7', isUUID: x => typeof x === 'string' && /^[a-f0-9-]{36}$/i.test(x),
    uuid: () => { state.ids++; return UUID.slice(0, -4) + String(state.ids).padStart(4, '0'); }, readContext: async () => fresh,
    contextAllowed: x => x.canUpload && x.customer.version === refs.frozen.current.customerVersion,
    controller: () => { const c = new AbortController(); refs.requests.current.add(c); return c; }, setSessionData: x => { refs.frozen.current = x; },
    historySession: history => ({ historyId: history.historyId, revision: 1 }), originalReview: () => [{ row: 2, logicalRowId: UUID }], useRef: x => ({ current: x }) };
  const sandbox = { crypto: webcrypto, TextEncoder, AbortController, sessionStorage: store, Error, Promise, console };
  for (const [name, value] of Object.entries(bindings)) if (instance.ABI[name]) sandbox[instance.ABI[name]] = value;
  const context = vm.createContext(sandbox);
  const code = models.helper + '\nconst ' + models.sendName + '=' + models.send + ';\nconst ' + models.persistName + '=' + models.persist
    + ';\nconst __cache=' + models.cache + ';\nglobalThis.__test={persist:' + models.persistName + ',cache:__cache,helpers:{read:' + B.PREFIX + 'readOriginalLock,save:' + B.PREFIX
    + 'saveOriginalLock,clear:' + B.PREFIX + 'clearOriginalLock,isRefusal:' + B.PREFIX + 'isOriginalNotSavedResponse,release:' + B.PREFIX
    + 'originalNotSavedAfterRelease,isReleased:' + B.PREFIX + 'isReleasedOriginalRejection}};';
  vm.runInContext(code, context, { timeout: 3000 });
  return { state, store, refs, fresh, props, ...context.__test, context, success };
}
async function rejection(promise) { try { await promise; } catch (e) { return e; } throw Error('Expected rejection'); }
const tick = () => new Promise(resolve => setImmediate(resolve));
async function leafTests(instance, models) {
  let checks = 0; const test = condition => { assert(condition); checks++; };
  const file = { name: 'A.csv', bytes: 'QQ==' }, second = { name: 'B.csv', bytes: 'Qg==' };
  let h = harness(instance, models);
  const refusal = { message: '原文件未保存：客户版本已变化', data: { code: 'BAD_REQUEST' } };
  for (const invalid of [null, '原文件未保存：拒绝', new Error('原文件未保存：拒绝'), { ...refusal, data: { code: 'INTERNAL_SERVER_ERROR' } },
    { ...refusal, message: '原文件未保存： ' }, { ...refusal, message: 'x原文件未保存：拒绝' }, { message: 'BAD_REQUEST', status: 400 }]) test(h.helpers.isRefusal(invalid) === false);
  test(h.helpers.isRefusal(refusal)); test(!h.helpers.isReleased(refusal)); test(!h.helpers.isReleased({ message: refusal.message }));
  const released = h.helpers.release(refusal); test(h.helpers.isReleased(released)); test(!h.helpers.isReleased(new Error(refusal.message)));
  h.state.refusal = refusal; const error = await rejection(h.persist(file, 'parse'));
  test(h.helpers.isReleased(error)); test(h.store.values.size === 0); test(h.refs.originalOperation.current === null);
  h.state.refusal = null; await h.persist(second, 'parse'); test(h.state.ids === 2); test(h.state.mutations.length === 2);
  // Unknown transport failures preserve the original bytes/request and storage.
  h = harness(instance, models); h.state.refusal = new Error('timeout');
  await rejection(h.persist(file, 'parse')); const request = h.state.mutations[0].requestId;
  test(h.store.values.size === 1); test(h.refs.originalOperation.current.requestId === request);
  await rejection(h.persist(file, 'parse')); test(h.state.mutations[1].requestId === request); test(h.state.ids === 1);
  await rejection(h.persist(second, 'parse')); test(h.state.mutations.length === 2); test(h.state.ids === 1);
  h.state.refusal = null; await h.persist(file, 'parse'); test(h.state.mutations[2].requestId === request); test(h.store.values.size === 0);
  // Only a mutation rejection can release; matching context-query/local errors cannot.
  h = harness(instance, models); h.context[instance.ABI.readContext] = async () => { throw refusal; };
  const contextError = await rejection(h.persist(file, 'parse')); test(!h.helpers.isReleased(contextError)); test(h.state.mutations.length === 0); test(h.store.values.size === 1);
  // CAS failures, stale identity/version, malformed/undeletable storage fail closed.
  for (const mode of ['changed', 'undeletable', 'inaccessible', 'identity', 'version', 'receipt']) {
    h = harness(instance, models); h.state.mutate = async input => {
      if (mode === 'changed') { const key = [...h.store.values.keys()][0]; const v = JSON.parse(h.store.getItem(key)); v.fileName = 'other.csv'; h.store.setItem(key, JSON.stringify(v)); }
      if (mode === 'undeletable') h.store.removeItem = () => {};
      if (mode === 'inaccessible') h.store.getItem = () => { throw Error('denied'); };
      if (mode === 'identity') h.state.current = false;
      if (mode === 'version') h.fresh.customer.version++;
      if (mode === 'receipt') return { history: { ...h.success(input).history, customerId: 99 } };
      throw refusal;
    };
    const e = await rejection(h.persist(file, 'parse')); test(!h.helpers.isReleased(e)); test(h.refs.originalOperation.current !== null); test(h.store.values.size > 0);
  }
  h = harness(instance, models); h.store.setItem('customer-upload-original:8:9:7', '{broken');
  await rejection(h.persist(file, 'parse')); test(h.state.mutations.length === 0); test(h.state.ids === 0);
  h = harness(instance, models); h.store.setItem = () => { throw Error('quota'); };
  await rejection(h.persist(file, 'parse')); await rejection(h.persist(file, 'parse')); test(h.state.ids === 1); test(h.state.mutations.length === 0);
  // Exact same File/mode shares the actual promise before encoding completes.
  h = harness(instance, models); let release;
  h.state.mutate = input => new Promise(resolve => { release = () => resolve(h.success(input)); });
  const first = h.persist(file, 'standard'), same = h.persist(file, 'standard'); test(first === same);
  await rejection(h.persist(second, 'standard')); await rejection(h.persist(file, 'parse'));
  while (!release) await tick(); test(h.state.encodes === 1); test(h.state.mutations.length === 1); release(); await first; test(h.refs.originalInFlight.current === null);
  // Standard same-File history cache, both pre-rows query recovery and post-rows reuse.
  h = harness(instance, models); const initial = await h.cache(file); const cached = await h.cache(file);
  test(initial.rows === cached.rows); test(h.state.mutations.length === 1); test(h.state.queries === 1);
  h.refs.frozen.current.customerVersion = 4; await rejection(h.cache(file)); test(h.state.mutations.length === 1);
  h = harness(instance, models); h.state.queryFailure = Error('manifest timeout'); await rejection(h.cache(file));
  test(h.state.mutations.length === 1); h.state.queryFailure = null; await h.cache(file); test(h.state.mutations.length === 1); test(h.state.queries === 2);
  h.refs.originalOperation.current = { requestId: UUID }; await rejection(h.cache(file)); test(h.state.mutations.length === 1);
  return checks;
}
async function parseTests(instance, models) {
  const React = require('react'), { createRoot } = require('react-dom/client'), { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://offline.invalid/' });
  const old = {}; for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
    old[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key], configurable: true, writable: true });
  }
  let checks = 0; const test = v => { assert(v); checks++; }; const act = React.act;
  const sandbox = { Error, console }, map = instance.parseABI;
  const runtime = require('react/jsx-runtime');
  const mocks = { useEffect: React.useEffect, useRef: React.useRef, useState: React.useState,
    validateFile: file => { if (!file.name.endsWith('.csv')) throw Error('invalid'); }, Button: props => React.createElement('button', props), jsx: runtime.jsx, jsxs: runtime.jsxs, Fragment: React.Fragment };
  for (const [name, value] of Object.entries(mocks)) sandbox[map[name]] = value;
  const context = vm.createContext(sandbox);
  vm.runInContext(models.helper + '\n' + models.parse + '\nglobalThis.__Component=' + map.CustomerParseUpload + ';globalThis.__released=' + B.PREFIX + 'originalNotSavedAfterRelease;', context);
  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    let mode = 'pending', calls = 0, selected = [], dirty = [], busy = [], settle;
    const props = { isCurrent: () => true, onDirtyChange: x => dirty.push(x), onBusyChange: x => busy.push(x),
      persistOriginal: async file => { calls++; selected.push(file); if (mode === 'refuse') throw context.__released({ message: '原文件未保存：明确拒绝' });
        if (mode === 'pending') return new Promise((resolve, reject) => { settle = () => reject(context.__released({ message: '原文件未保存：明确拒绝' })); });
        if (mode === 'unknown') throw Error('timeout'); return { historyId: UUID, originalFile: { fileName: file.name } }; } };
    await act(async () => root.render(React.createElement(context.__Component, props)));
    const input = () => dom.window.document.querySelector('input[type=file]');
    const choose = async file => { Object.defineProperty(input(), 'files', { value: [file], configurable: true }); await act(async () => input().dispatchEvent(new dom.window.Event('change', { bubbles: true }))); };
    const button = text => [...dom.window.document.querySelectorAll('button')].find(b => b.textContent.includes(text));
    const submit = async () => { await act(async () => button('提交').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))); };
    const a = new dom.window.File(['A'], 'A.csv', { type: 'text/csv' }), b = new dom.window.File(['B'], 'B.csv', { type: 'text/csv' });
    await choose(a); test(input().value === '');
    await act(async () => { const target = button('提交'); target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    test(calls === 1); test(input().disabled === true); test(button('替换文件').disabled === true); test(busy.at(-1) === true);
    await act(async () => settle()); test(input().disabled === false);
    test(dom.window.document.querySelector('[role=alert]').textContent.includes('明确拒绝')); test(button('替换文件').disabled === false);
    await choose(b); test(dom.window.document.querySelector('[role=alert]').textContent.includes('明确拒绝'));
    mode = 'unknown'; await submit(); test(selected[1] === b); test(input().disabled === true); test(button('替换文件').disabled === true);
    await choose(a); mode = 'success'; await act(async () => button('按原UUID').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    test(selected[2] === b); test(dom.window.document.body.textContent.includes(UUID)); test(!input()); test(dirty.at(-1) === false); test(busy.at(-1) === false);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const key of Object.keys(old)) { if (old[key]) Object.defineProperty(globalThis, key, old[key]); else delete globalThis[key]; }
  }
  return checks;
}
async function checkRecords(records, html, baselineHTML, htmlProof) {
  let leafAssertions = 0, parseAssertions = 0;
  for (const p of records) {
    verifyDelta(p.before, p.after, p); B.parse(p.after, p.newURL);
    require('esbuild').transformSync(p.after, { loader: 'js', target: 'esnext', format: 'esm', logLevel: 'silent' });
    assert.deepEqual(B.moduleTable(p.after), B.moduleTable(p.before)); assert.deepEqual(B.moduleTable(p.after), p.moduleTable);
    assert.equal(B.sha(JSON.stringify(p.moduleTable)), p.moduleTableSHA);
    assert(p.newURL.includes(B.sha(p.after).slice(0, 16))); assert.equal(p.cssChanged, false);
    for (const i of p.instances) {
      const models = candidateModels(p.after, i);
      leafAssertions += await leafTests(i, models); parseAssertions += await parseTests(i, models);
      for (const e of p.edits) assert(e.target === i.session || e.target === i.parse || e.target === 'customerUploadOriginalLock.ts');
    }
    for (const e of p.edits) {
      if (e.target === 'customerUploadOriginalLock.ts') { assert.equal(e.byteStart, e.byteEnd); continue; }
      const i = B.one(p.instances.filter(i => e.target === i.session || e.target === i.parse), 'authorized target instance');
      const min = e.target === i.session ? i.sessionStart : i.parseStart, max = e.target === i.session ? i.sessionEnd : i.parseEnd;
      assert(e.start >= min && e.end <= max, 'No edit outside authorized function');
    }
  }
  verifyDelta(baselineHTML, html, htmlProof);
  const rebuiltHTML = B.finishHTML(baselineHTML, Object.fromEntries(records.map(p => [p.oldURL, p.newURL])), records);
  assert.equal(rebuiltHTML.after, html); assert.deepEqual(rebuiltHTML.clones, htmlProof.clones);
  return { status: 'PASS_OFFLINE_NOT_DEPLOYED', assets: records.length,
    instances: records.reduce((n, p) => n + p.instances.length, 0), leafAssertions, parseAssertions,
    syntax: true, inverse: true, outsidePartitionsIdentical: true, moduleTables: true, exactscopeDependencyResolution: true,
    actualCandidateLeafHarness: true, nativeParseJSDOM: true, noCSS: true, wholeBundleNeverExecuted: true };
}
async function checkPrepared(prepared) { return checkRecords(prepared.planned, prepared.html.after, prepared.base.html, prepared.html); }
async function checkCandidate(out, options = {}) {
  out = path.resolve(out); const manifest = JSON.parse(B.read(path.join(out, 'manifest.json')));
  const base = path.resolve(options.baseline || manifest.baseline), source = options.source || manifest.source.root;
  for (const [f, h] of Object.entries(manifest.source.sourceSHA)) assert.equal(B.sha(fs.readFileSync(path.join(source, f))), h, 'Frozen source hash differs: ' + f);
  const records = manifest.assets.map(asset => {
    const p = JSON.parse(B.read(path.join(out, asset.proof))), before = B.read(base + asset.oldURL), after = B.read(path.join(out, 'candidate', asset.relative));
    assert.equal(B.sha(before), asset.beforeSha256); assert.equal(B.sha(after), asset.afterSha256);
    return { ...p, before, after };
  });
  const html = B.read(path.join(out, 'candidate', manifest.htmlName)), baselineHTML = B.read(path.join(base, manifest.htmlName));
  assert.equal(B.sha(html), manifest.afterHTMLSHA); assert.equal(B.sha(baselineHTML), manifest.beforeHTMLSHA);
  const htmlProof = JSON.parse(B.read(path.join(out, manifest.htmlProof)));
  return checkRecords(records, html, baselineHTML, htmlProof);
}
module.exports = { verifyDelta, candidateModels, harness, leafTests, parseTests, checkRecords, checkPrepared, checkCandidate };
if (require.main === module) {
  (async () => { const o = B.options(process.argv.slice(2)); const result = o.candidate ? await checkCandidate(o.candidate, o) : await checkPrepared(B.prepare(o)); console.log(JSON.stringify(result, null, 2)); })()
    .catch(e => { console.error('BLOCKED: ' + e.stack); process.exitCode = 1; });
}
