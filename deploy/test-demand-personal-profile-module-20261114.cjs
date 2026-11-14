'use strict';
/** Test-only: execute final candidate Profile bytes, not compileProfileFactory. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const vm = require('vm');
const ts = require('typescript');
const React = require('react');
const jsx = require('react/jsx-runtime');
const { JSDOM } = require('jsdom');
const REPO = path.resolve(__dirname, '..');
const W = '/home/ubuntu/work/demand-personal-center';
const OUT = W + '/static-input';
const REPORT = OUT + '/actual-profile-module-tests.json';
const read = file => fs.readFileSync(file, 'utf8');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(read(file));
const parse = (source, name) => {
  const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, name);
  return ast;
};
const one = (items, label) => { assert.equal(items.length, 1, label); return items[0]; };
const plain = value => JSON.parse(JSON.stringify(value));
const starts = (key, prefix) => prefix.every((x, i) => key[i] === x);
const counts = {
  actualNetworkIO: 0, actualDatabaseIO: 0, actualSMSIO: 0,
  blockedNetworkAttempts: 0, nativeHookObserverConstructors: 0,
  mockedNativeMutationDispatches: 0, mockedRpcQueries: 0,
  mockedRpcMutations: 0, authRefreshFixtureCalls: 0, authLogoutFixtureCalls: 0,
  routerNavigationFixtureCalls: 0, queryFixtureHookCalls: 0,
  queryClientFixtureHookCalls: 0, sessionListenerInstallations: 0,
};
const report = {
  status: 'RUNNING', testScript: path.relative(REPO, __filename),
  actualCandidateProfileModuleExecuted: false, entryWholeSourceExecuted: false,
  sourceOrWrapperRecompiled: false, results: [], actualExecutedShas: {},
  mockedNativeIOCounts: counts,
  scope: { productSourceModified: false, buildersModified: false, gitUsed: false,
    sshUsed: false, databaseUsed: false, published: false, activation: false },
  coverageLimits: [
    'Only the final Profile module body, original G/default wrapper and initialization execute; ES imports are native fixtures and the export declaration is read by AST.',
    'Entry whole source does not execute. Its exact HS declaration executes in isolation with native React and an inert local MutationObserver fixture; ql, batchCalls, error helpers are fixtures.',
    'Auth/TRPC/business-scope/query provider implementations, transport, server authorization, credentials, SMS, DB and real login are not executed. No authentication/login acceptance claim.',
    'Query/mutation callbacks may be explicitly invoked against TEST_ONLY local namespaces to prove references. Mock call counts are not network or production mutations.',
    'jsdom establishes DOM/render/form behavior, not a real browser ESM loader, CSS visual acceptance, production provider correctness or end-to-end behavior.',
  ],
};
let root, dom, host, manifest, profileText, profileAst, entryText, entryAst, oldEntryText;
let ctx, runtime, observers = [], queryOptions = new Map(), rpcCalls = [], cleanup = [];
let currentProfile = { id: 810001, username: 'ACTUAL_MODULE_TEST_ONLY', displayName: '本地测试用户',
  email: '', phone: '13800000000', adminRole: 'operation', phoneBinding: 'legacy_unverified' };
let auth = { user: { id: 810001, username: 'ACTUAL_MODULE_TEST_ONLY', hasNativeAdminAccount: true },
  loading: false, error: null, refresh: async () => { counts.authRefreshFixtureCalls++; return { data: null, error: null }; },
  logout: async () => { counts.authLogoutFixtureCalls++; } };
let sessionListener;
let pins = [];
async function test(name, fn) {
  const before = { ...counts };
  try {
    const evidence = await fn();
    report.results.push({ name, status: 'PASS', actualExecutedShas: { ...report.actualExecutedShas },
      mockedNativeIOCounts: { ...counts }, mockCountDelta: Object.fromEntries(Object.keys(counts).map(k => [k, counts[k] - before[k]])),
      evidence: evidence || {} });
    console.log('PASS ' + name);
  } catch (error) {
    report.results.push({ name, status: 'FAIL', actualExecutedShas: { ...report.actualExecutedShas },
      mockedNativeIOCounts: { ...counts }, error: error.stack });
    console.error('FAIL ' + name + '\n' + error.stack);
    throw error;
  }
}
function blockNetwork() { counts.blockedNetworkAttempts++; throw new Error('Network forbidden in test'); }
function html(tag) {
  return function NativeComponentFixture({ children, size, variant, ...rest }) {
    return jsx.jsx(tag, { ...rest, children });
  };
}
function exportPairs(ast) {
  const node = one(ast.statements.filter(n => ts.isExportDeclaration(n) && !n.moduleSpecifier), 'single local export declaration');
  assert(ts.isNamedExports(node.exportClause));
  return { node, pairs: node.exportClause.elements.map(n => ({ local: (n.propertyName || n.name).text, exported: n.name.text })) };
}
function resolveImport(map, specifier, importer) {
  const origin = 'https://admin.51dianzi.com';
  const importerURL = new URL(importer, origin).href;
  const normalized = new URL(specifier, importerURL).href;
  function match(entries) {
    const keys = Object.keys(entries).map(k => ({ raw: k, absolute: new URL(k, origin).href })).sort((a, b) => b.absolute.length - a.absolute.length);
    for (const key of keys) {
      if (key.absolute === normalized || key.absolute.endsWith('/') && normalized.startsWith(key.absolute)) {
        const mapped = entries[key.raw]; assert.equal(typeof mapped, 'string');
        return { url: new URL(mapped, origin).pathname + (key.absolute.endsWith('/') ? normalized.slice(key.absolute.length) : ''), matchedKey: key.raw };
      }
    }
    return null;
  }
  const scopes = Object.keys(map.scopes || {}).filter(scope => {
    const absolute = new URL(scope, origin).href;
    return importerURL === absolute || absolute.endsWith('/') && importerURL.startsWith(absolute);
  }).sort((a, b) => b.length - a.length);
  for (const scope of scopes) { const found = match(map.scopes[scope]); if (found) return { ...found, method: 'scope', scope }; }
  const found = match(map.imports || {});
  return found ? { ...found, method: 'global-imports', scope: null } : { url: new URL(normalized).pathname, method: 'unmapped', scope: null };
}
function providerTree(Profile) {
  const p = runtime.fixtures;
  return jsx.jsx(p.AuthContext.Provider, { value: auth, children:
    jsx.jsx(p.TRPCContext.Provider, { value: p.trpc, children:
      jsx.jsx(p.BusinessScopeContext.Provider, { value: p.businessScope, children:
        jsx.jsx(p.QueryContext.Provider, { value: p.queryClient, children: jsx.jsx(Profile, {}) }) }) }) });
}
async function mount() { await React.act(async () => root.render(providerTree(runtime.default))); }
async function click(text) {
  const button = [...host.querySelectorAll('button')].find(el => el.textContent === text);
  assert(button, 'button ' + text); await React.act(async () => button.click());
}
async function tab(text) { await click(text); }
async function input(id, value) {
  const el = host.querySelector('#' + id); assert(el, id);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  assert.equal(el.value, value);
}
async function submit(selector) {
  const form = host.querySelector(selector); assert(form, selector);
  let prevented;
  await React.act(async () => { const e = new window.Event('submit', { bubbles: true, cancelable: true }); form.dispatchEvent(e); prevented = e.defaultPrevented; });
  assert.equal(prevented, true, 'actual bound onSubmit prevents default');
}
function observer(kind) { return one(observers.filter(o => o.options.mutationKey[3] === kind && !o.removed), 'active observer ' + kind); }
function query(kind) { const opts = queryOptions.get(kind); assert(opts, kind); return opts; }
(async () => {
  await test('current full BUILT candidate has four exact-hash records and current source pins', async () => {
    manifest = json(OUT + '/static-parts.json'); assert.equal(manifest.status, 'BUILT'); assert.equal(manifest.records.length, 4);
    for (const item of manifest.records) assert.equal(sha(read(OUT + '/' + item.relative)), item.sha256, item.relative);
    pins = Object.entries({ ...manifest.sourceHashes, ...manifest.profile.sourceHashes }).map(([relative, expected]) => {
      assert.equal(sha(read(path.join(REPO, relative))), expected, 'current source ' + relative); return { relative, sha256: expected };
    });
    profileText = read(OUT + manifest.profile.url); profileAst = parse(profileText, 'actual-candidate-Profile.js');
    entryText = read(OUT + manifest.proofs.entry.url); entryAst = parse(entryText, 'actual-candidate-Entry.js');
    oldEntryText = read(W + '/baseline' + manifest.proofs.entry.beforeUrl);
    report.inputs = manifest.records; report.sourcePins = pins;
    report.actualExecutedShas.profileWholeFile = sha(profileText);
    report.actualExecutedShas.entryWholeFileInspectedOnly = sha(entryText);
    return { profileSourcePin: manifest.profile.sourceHashes['client/src/pages/Profile.tsx'], profileUrl: manifest.profile.url };
  });
  await test('Entry HS implementation and every preexisting export remain byte-identical', async () => {
    const oldAst = parse(oldEntryText, 'baseline-Entry.js');
    const select = a => one(a.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'HS'), 'native HS');
    const oldHS = select(oldAst).getText(oldAst), HS = select(entryAst).getText(entryAst);
    assert.equal(HS, oldHS); assert(HS.includes('new ES(l,n)')); assert(HS.includes('ql(r)'));
    const before = exportPairs(oldAst), after = exportPairs(entryAst);
    assert.deepEqual(after.pairs.filter(p => p.exported !== '__personalNativeUseMutation'), before.pairs);
    assert.deepEqual(after.pairs.filter(p => p.exported === '__personalNativeUseMutation'), [{ local: 'HS', exported: '__personalNativeUseMutation' }]);
    assert.equal(after.node.getText(entryAst).replace(',HS as __personalNativeUseMutation', ''), before.node.getText(oldAst));
    for (const p of manifest.proofs.entry.unchangedPartitions) {
      const a = oldEntryText.slice(p.beforeStart, p.beforeEnd), b = entryText.slice(p.afterStart, p.afterEnd);
      assert.equal(a, b); assert.equal(sha(b), p.sha256);
    }
    report.entryProof = { originalHSsha256: sha(oldHS), actualHSsha256: sha(HS), otherExportCount: before.pairs.length,
      originalHSByteIdentical: true, otherExportsByteIdentical: true, wholeEntryExecuted: false };
    report.actualExecutedShas.entryHSDeclaration = sha(HS);
    report._HS = HS;
    return report.entryProof;
  });
  await test('old index specifier resolves to current Entry; existing scope mappings also target current Entry', async () => {
    const html = read(W + '/candidate/index.html');
    const map = JSON.parse(one([...html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)], 'HTML importmap')[1]);
    const imp = one(profileAst.statements.filter(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === './index-8jluR_FO.js'), 'same old index specifier');
    const resolution = resolveImport(map, imp.moduleSpecifier.text, manifest.profile.url);
    assert.equal(resolution.url, manifest.proofs.entry.url);
    const scopeCases = Object.keys(map.scopes).filter(scope => map.scopes[scope]['/assets/index-8jluR_FO.js']).map(scope => {
      const result = resolveImport(map, './index-8jluR_FO.js', scope); assert.equal(result.method, 'scope');
      assert.equal(result.url, manifest.proofs.entry.url); return { importer: scope, ...result };
    });
    assert(scopeCases.length > 0, 'existing scopes checked');
    const originalProfile = one(Object.entries(manifest.relocations).filter(([, value]) => value === manifest.profile.url), 'exact original Profile relocation')[0];
    const priorProfile = [originalProfile, map.imports[originalProfile]];
    assert.equal(priorProfile[1], manifest.profile.url, 'final HTML exact original Profile mapping must target current module');
    report.importMap = { htmlSha256Inspected: sha(html), actualProfileResolution: resolution,
      existingScopeCases: scopeCases, finalHTMLProfileMapping: priorProfile?.[1] || null,
      finalHTMLHasCurrentProfile: priorProfile?.[1] === manifest.profile.url };
    if (resolution.method !== 'scope') report.coverageLimits.push('Actual current Profile is in the versioned directory and resolves old index via global imports, not a Profile-specific scope. Existing relocated-root scopes are tested separately. No claim that actual Profile matched a scope.');
    return report.importMap;
  });
  await test('execute actual module body with import-only fixtures and actual Entry HS hook', async () => {
    dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', { url: 'https://admin.51dianzi.com/profile' });
    for (const name of ['window', 'document', 'Node', 'HTMLElement', 'Event']) global[name] = dom.window[name];
    global.IS_REACT_ACT_ENVIRONMENT = true; host = document.getElementById('host');
    window.fetch = blockNetwork; window.XMLHttpRequest = function () { blockNetwork(); }; window.WebSocket = function () { blockNetwork(); };
    const fixtures = { React, jsx, AuthContext: React.createContext(null), TRPCContext: React.createContext(null),
      BusinessScopeContext: React.createContext(null), QueryContext: React.createContext(null),
      businessScope: Object.freeze({ fixture: 'TEST_ONLY_NATIVE_EXISTING_SCOPE' }) };
    fixtures.queryClient = {
      cancelQueries: x => { cleanup.push({ action: 'cancel', key: plain(x.queryKey) }); return Promise.resolve(); },
      removeQueries: x => cleanup.push({ action: 'remove', key: plain(x.queryKey) }),
      getMutationCache: () => ({ findAll: x => observers.filter(o => !o.removed && starts(o.options.mutationKey, x.mutationKey)),
        remove: o => { o.removed = true; cleanup.push({ action: 'remove-mutation', key: plain(o.options.mutationKey) }); } }),
      setQueryData: () => { throw new Error('Success-side cache writes not permitted in this test'); },
    };
    fixtures.useQueryClient = function ql() {
      counts.queryClientFixtureHookCalls++;
      const value = React.useContext(fixtures.QueryContext); assert.equal(value, fixtures.queryClient); return value;
    };
    class NativeMutationObserverFixture {
      constructor(client, options) {
        assert.equal(client, fixtures.queryClient); counts.nativeHookObserverConstructors++;
        this.options = options; this.client = client; this.listeners = new Set();
        this.current = Object.freeze({ data: undefined, error: null, isPending: false,
          mutate: this.mutate.bind(this), reset: () => {} }); observers.push(this);
      }
      setOptions(options) { this.options = options; }
      subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
      getCurrentResult() { return this.current; }
      mutate(input, callOptions) {
        counts.mockedNativeMutationDispatches++;
        this.dispatches ||= []; this.dispatches.push({ input: plain(input), hasCallOptions: !!callOptions });
        return Promise.resolve(undefined); // never execute mutationFn/transport/success implicitly
      }
    }
    const nativeCtx = vm.createContext({ O: React, ql: fixtures.useQueryClient, ES: NativeMutationObserverFixture,
      Jt: { batchCalls: fn => fn }, Se: () => {}, Av: (value, args) => typeof value === 'function' ? value(...args) : !!value });
    vm.runInContext(report._HS, nativeCtx, { filename: manifest.proofs.entry.url + '#exact-HS-only' });
    const HS = vm.runInContext('HS', nativeCtx);
    const entryExports = {};
    const exportedMutation = one(exportPairs(entryAst).pairs.filter(p => p.exported === '__personalNativeUseMutation'), 'actual exported mutation');
    assert.equal(exportedMutation.local, 'HS'); entryExports[exportedMutation.exported] = HS;
    fixtures.useAuth = () => { const value = React.useContext(fixtures.AuthContext); assert.equal(value, auth); return value; };
    const rpc = {};
    for (const [name, method] of [['profile', 'query'], ['performance', 'query'], ['commission', 'query'],
      ['updateProfile', 'mutate'], ['changePassword', 'mutate'], ['requestPhoneCode', 'mutate'], ['bindPhone', 'mutate']]) {
      rpc[name] = { [method]: async (...args) => {
        counts[method === 'query' ? 'mockedRpcQueries' : 'mockedRpcMutations']++;
        rpcCalls.push({ namespace: 'personalCenter', name, method, args });
        return { TEST_ONLY_LOCAL_REFERENCE_PROBE: name };
      } };
    }
    fixtures.trpc = { useUtils: () => { assert.equal(React.useContext(fixtures.TRPCContext), fixtures.trpc); return { client: { personalCenter: rpc } }; } };
    fixtures.useQuery = opts => {
      counts.queryFixtureHookCalls++; assert.equal(React.useContext(fixtures.QueryContext), fixtures.queryClient);
      queryOptions.set(opts.queryKey[3], opts);
      return { data: opts.queryKey[3] === 'profile' ? currentProfile : { status: 'unavailable', reason:
        opts.queryKey[3] === 'commission' ? '尚未配置可核实规则' : '当前暂无可核实来源' },
        isPending: false, isError: false, isFetching: false, refetch: async () => {} };
    };
    fixtures.useLocation = () => ['/profile', () => { counts.routerNavigationFixtureCalls++; }];
    fixtures.installAuthSessionClearListener = fn => { counts.sessionListenerInstallations++; sessionListener = fn; return () => { sessionListener = null; }; };
    fixtures.createLucideIcon = (name, node) => { assert.equal(typeof name, 'string'); assert(Array.isArray(node)); return html('svg'); };
    fixtures.DashboardLayout = function NativeDashboardLayoutFixture({ children }) {
      assert.equal(React.useContext(fixtures.BusinessScopeContext), fixtures.businessScope);
      assert.equal(React.useContext(fixtures.AuthContext), auth);
      assert.equal(React.useContext(fixtures.TRPCContext), fixtures.trpc);
      assert.equal(React.useContext(fixtures.QueryContext), fixtures.queryClient);
      return jsx.jsx('main', { children });
    };
    Object.assign(fixtures, { Button: html('button'), Card: html('article'), CardHeader: html('header'), CardContent: html('div'),
      CardTitle: html('h2'), Input: html('input'), Label: html('label'), Skeleton: html('div'), User: html('svg'), Phone: html('svg'),
      Mail: html('svg'), Loader2: html('svg'), toast: { success: () => { throw new Error('Success-side toast must not execute'); } } });
    Object.assign(entryExports, { c: fixtures.createLucideIcon, t: fixtures.trpc, u: fixtures.useAuth, r: React,
      b: fixtures.toast, j: jsx, S: fixtures.Skeleton, s: fixtures.useQuery, p: fixtures.useQueryClient,
      l: fixtures.useLocation, q: fixtures.installAuthSessionClearListener });
    const modules = {
      './index-8jluR_FO.js': entryExports, './DashboardLayout-DfHnpqnr.js': { D: fixtures.DashboardLayout },
      './button-CJNcu3ZB.js': { B: fixtures.Button }, './card-CHbeaHH4.js': { C: fixtures.Card, a: fixtures.CardHeader, b: fixtures.CardContent, c: fixtures.CardTitle },
      './input-CQXSswZV.js': { I: fixtures.Input }, './label-gKwYwH3S.js': { L: fixtures.Label },
      './index-CKHSh4Pc.js': { U: fixtures.User }, './phone-BqXAsUMx.js': { P: fixtures.Phone },
      './mail-rvpPVrVf.js': { M: fixtures.Mail }, './loader-circle-DDYTq62H.js': { L: fixtures.Loader2 },
      './index-h_rcmx-z.js': {}, './index-Dp3hShr1.js': {}, './index-CisAFFfx.js': {},
    };
    const globals = { window, document, Node, HTMLElement, Date, Intl, console, URLSearchParams, Reflect,
      setTimeout, clearTimeout, fetch: blockNetwork, AbortController };
    const removals = [];
    for (const imp of profileAst.statements.filter(ts.isImportDeclaration)) {
      const module = modules[imp.moduleSpecifier.text]; assert(module, 'only declared native import fixture ' + imp.moduleSpecifier.text);
      if (imp.importClause) {
        assert(!imp.importClause.name, 'no unknown default imports');
        assert(ts.isNamedImports(imp.importClause.namedBindings));
        for (const binding of imp.importClause.namedBindings.elements) {
          const exported = (binding.propertyName || binding.name).text;
          assert(Object.hasOwn(module, exported), 'fixture export ' + exported);
          globals[binding.name.text] = module[exported];
        }
      }
      removals.push({ start: imp.getStart(profileAst), end: imp.end, kind: 'import' });
    }
    const actualExport = exportPairs(profileAst);
    assert.deepEqual(actualExport.pairs, [{ local: 'G', exported: 'default' }]);
    removals.push({ start: actualExport.node.getStart(profileAst), end: actualExport.node.end, kind: 'export-declaration-read-by-AST' });
    let body = profileText;
    for (const span of removals.sort((a, b) => b.start - a.start)) body = body.slice(0, span.start) + body.slice(span.end);
    ctx = vm.createContext(globals);
    vm.runInContext(body, ctx, { filename: manifest.profile.url, timeout: 5000 });
    const defaultExport = vm.runInContext(actualExport.pairs[0].local, ctx);
    assert.equal(defaultExport, vm.runInContext('G', ctx));
    assert.equal(vm.runInContext('typeof __personalProfileInstance', ctx), 'undefined', 'actual lazy init before render');
    const wrapper = one(profileAst.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'G'), 'actual wrapper G');
    assert.equal(wrapper.getText(profileAst), 'function G(){return __personalProfileGet().Profile();}');
    runtime = { default: defaultExport, fixtures, entryExports, rpc, live: { Actualnativeexports: { useMutation: HS } } };
    root = require('react-dom/client').createRoot(host); await mount();
    assert.equal(vm.runInContext('__personalProfileGet() === __personalProfileInstance', ctx), true);
    report.actualCandidateProfileModuleExecuted = true;
    report.actualExecutedShas.profileBodyWithESDeclarationsRemoved = sha(body);
    report.actualExecutedShas.actualGWrapper = sha(wrapper.getText(profileAst));
    report.actualExecutedShas.actualInitializationWrapper = sha(one(profileAst.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === '__personalProfileGet'), 'actual init').getText(profileAst));
    report.execution = { removedESDeclarations: removals.map(x => ({ ...x, sha256: sha(profileText.slice(x.start, x.end)) })),
      remainingModuleBytesPreserved: true, nativeMutationImportFromActualEntryExport: true,
      nativeMutationFunctionIsActualHS: runtime.live.Actualnativeexports.useMutation === entryExports.__personalNativeUseMutation,
      independentFactoryCompiledOrEvaluated: false, actualDefaultLocalName: actualExport.pairs[0].local };
    return report.execution;
  });
  await test('actual injected bridge references remain === native React/Auth/TRPC/scope/query fixtures', async () => {
    const init = one(profileAst.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === '__personalProfileGet'), 'init');
    const declarations = []; function visit(n) { if (ts.isVariableDeclaration(n) && n.name.getText(profileAst) === '__profileLive') declarations.push(n); n.forEachChild(visit); } visit(init);
    const bridge = one(declarations, 'actual __profileLive').initializer;
    assert(ts.isObjectLiteralExpression(bridge));
    // Read-only evaluate the already-executed wrapper's exact bridge object expression; no wrapper rewrite.
    const live = vm.runInContext('(' + bridge.getText(profileAst) + ')', ctx);
    const f = runtime.fixtures;
    for (const [name, fixture] of Object.entries({ React: React, jsx, useAuth: f.useAuth, trpc: f.trpc,
      DashboardLayout: f.DashboardLayout, useQuery: f.useQuery, useQueryClient: f.useQueryClient,
      useLocation: f.useLocation, installAuthSessionClearListener: f.installAuthSessionClearListener,
      useMutation: runtime.entryExports.__personalNativeUseMutation })) assert.equal(live[name], fixture, name + ' identity');
    assert.equal(live.useMutation, runtime.live.Actualnativeexports.useMutation);
    assert.equal(counts.nativeHookObserverConstructors, 4); assert.equal(counts.sessionListenerInstallations, 1);
    report.bridgeIdentities = { NativeR: true, Auth: true, TRPC: true, BusinessScopeInheritedUnchanged: true,
      QueryProviderInheritedUnchanged: true, QueryClient: true, MutationHookEqualsActualHSExport: true,
      proofMethod: 'Actual bridge AST bindings evaluated unchanged; actual default render observes same provider values and actual HS constructs four inert native observers.' };
    return report.bridgeIdentities;
  });
  await test('actual default G renders four tabs and verified/unverified native profile labels', async () => {
    assert.deepEqual([...host.querySelectorAll('[role="tab"]')].map(x => x.textContent), ['个人资料', '账号安全', '我的业绩', '我的提成']);
    assert.equal(host.querySelectorAll('.personal-center').length, 1);
    assert(host.textContent.includes('未设置')); assert.equal(host.querySelector('.pc-inline-status').textContent, '未验证');
    await tab('账号安全');
    assert.equal(host.querySelectorAll('input[type="password"]').length, 4);
    assert.equal(host.querySelector('label[for="pc-phone"]').textContent, '待验证手机号');
    assert.equal(host.querySelector('#pc-phone').placeholder, '可验证当前号码或绑定新号码');
    assert(host.textContent.includes('验证与绑定手机')); assert(host.textContent.includes('（未验证）'));
    assert(host.querySelector('#pc-phone-code').disabled); assert.equal(counts.mockedNativeMutationDispatches, 0);
    return { legacySameNumberAllowedByLabel: true, pendingVerificationPhoneLabel: '待验证手机号' };
  });
  await test('actual bound security forms reject invalid password/phone/ticket without mutation', async () => {
    await submit('form:has(#pc-old-password)'); assert(host.textContent.includes('请输入原密码'));
    await submit('form:has(#pc-phone)'); assert(host.textContent.includes('请填写原密码及有效的新手机号'));
    await input('pc-phone-password', 'TEST_ONLY_OLD_PASSWORD'); await input('pc-phone', '13800000000');
    const codeButton = [...host.querySelectorAll('button')].find(x => x.textContent === '获取验证码');
    assert.equal(codeButton.disabled, false, 'legacy current same-number can request verification');
    await submit('form:has(#pc-phone)'); assert(host.textContent.includes('请先获取当前新手机号的有效验证码'));
    assert.equal(counts.mockedNativeMutationDispatches, 0); assert.equal(counts.mockedRpcMutations, 0);
    return { invalidFormsPreventDefault: true, sameLegacyPhoneIsAcceptedAsVerificationCandidate: true, zeroMutationOnInvalidForms: true };
  });
  await test('actual native HS receives phone-code dispatch and bind form enforces current ticket binding', async () => {
    await click('获取验证码');
    assert.equal(counts.mockedNativeMutationDispatches, 1);
    assert.deepEqual(observer('phone-code').dispatches[0].input, { oldPassword: 'TEST_ONLY_OLD_PASSWORD', phone: '13800000000' });
    assert.equal(counts.mockedRpcMutations, 0, 'inert native observer does not execute transport');
    const request = observer('phone-code');
    await React.act(async () => request.options.onSuccess({ ticketId: 'TEST_ONLY_TICKET', maskedPhone: '138****0000', retryAfterSeconds: 0, expiresInSeconds: 120 }, request.dispatches[0].input));
    assert.equal(host.querySelector('#pc-phone-code').disabled, false);
    await input('pc-phone-code', '123456');
    const bindButton = [...host.querySelectorAll('button')].find(x => x.textContent === '验证并更换'); assert(bindButton); assert.equal(bindButton.disabled, false);
    await input('pc-phone', '13900000000');
    assert.equal(host.querySelector('#pc-phone-code').value, ''); assert.equal(host.querySelector('#pc-phone-code').disabled, true);
    await submit('form:has(#pc-phone)'); assert(host.textContent.includes('请先获取当前新手机号的有效验证码'));
    assert.equal(counts.mockedNativeMutationDispatches, 1); assert.equal(counts.authLogoutFixtureCalls, 0); assert.equal(counts.routerNavigationFixtureCalls, 0);
    return { nativeHookActualHSExecuted: true, onlyLocalDispatchCount: 1, localTicketInjectedViaActualOnSuccess: true,
      editedPhoneInvalidatesTicketAndCode: true, bindNotDispatchedForDifferentNumber: true, loginAcceptanceClaim: false };
  });
  await test('actual performance and commission tabs keep unavailable data without synthetic balances', async () => {
    await tab('我的业绩'); assert(host.textContent.includes('当前暂无可核实来源')); assert(!host.querySelector('.pc-stat')); assert.equal(query('performance').enabled, true);
    await tab('我的提成'); assert(host.textContent.includes('尚未配置可核实规则')); assert(!host.querySelector('.pc-stat')); assert.equal(query('commission').enabled, true);
    return { noSyntheticZeroBalances: true, realTabsAndEnableFlags: true };
  });
  await test('actual query/mutation callbacks reference seven real personalCenter API namespace names', async () => {
    const signal = new AbortController().signal;
    for (const name of ['profile', 'performance', 'commission']) {
      const result = await query(name).queryFn({ signal }); assert.equal(result.TEST_ONLY_LOCAL_REFERENCE_PROBE, name);
    }
    const probes = {
      'update-profile': ['updateProfile', { displayName: 'TEST_ONLY_REFERENCE', email: '' }],
      'change-password': ['changePassword', { oldPassword: 'TEST_ONLY', newPassword: 'TEST_ONLY_NEW' }],
      'phone-code': ['requestPhoneCode', { oldPassword: 'TEST_ONLY', phone: '13800000000' }],
      'bind-phone': ['bindPhone', { oldPassword: 'TEST_ONLY', phone: '13800000000', ticketId: 'TEST_ONLY', code: '123456' }],
    };
    for (const [kind, [name, input]] of Object.entries(probes)) {
      const result = await observer(kind).options.mutationFn(input); assert.equal(result.TEST_ONLY_LOCAL_REFERENCE_PROBE, name);
      assert.equal(rpcCalls.at(-1).args[0], input, 'input same reference forwarded by actual callback');
    }
    assert.deepEqual(rpcCalls.map(x => x.name), ['profile', 'performance', 'commission', 'updateProfile', 'changePassword', 'requestPhoneCode', 'bindPhone']);
    for (const call of rpcCalls.slice(0, 3)) assert.equal(call.args[1].signal, signal);
    assert.equal(rpcCalls[0].args[0], undefined);
    assert.deepEqual(plain(rpcCalls[1].args[0]), { month: query('performance').queryKey[4], page: 1, pageSize: 10 });
    assert.deepEqual(plain(rpcCalls[2].args[0]), { month: query('commission').queryKey[4] });
    report.apiReferenceProbes = rpcCalls.map(x => ({ namespace: x.namespace, name: x.name, method: x.method }));
    return { callbacksFromActualModule: true, references: report.apiReferenceProbes, mockedQueries: 3, mockedMutations: 4, actualIO: 0 };
  });
  await test('actual source-compatible key prefix isolates same-ID different username and invalidates old callbacks', async () => {
    const oldUser = auth.user;
    const oldIdentity = JSON.stringify(['native-admin', oldUser.id, oldUser.username, null]);
    const oldPrefix = ['personal-center-self', oldIdentity, 0];
    for (const opts of queryOptions.values()) assert.deepEqual(plain(opts.queryKey.slice(0, 3)), oldPrefix);
    for (const o of observers.filter(o => !o.removed)) assert.deepEqual(plain(o.options.mutationKey.slice(0, 3)), oldPrefix);
    const oldQuery = query('profile').queryFn, oldMutation = observer('bind-phone').options.mutationFn;
    const callsBefore = rpcCalls.length;
    auth = { ...auth, user: { ...oldUser, username: 'ACTUAL_MODULE_OTHER_TEST_ONLY' } };
    currentProfile = { ...currentProfile, username: auth.user.username, phoneBinding: 'verified_by_current_ticket' };
    await mount();
    const nextIdentity = JSON.stringify(['native-admin', oldUser.id, auth.user.username, null]);
    assert.notEqual(nextIdentity, oldIdentity);
    assert.deepEqual(plain(query('profile').queryKey.slice(0, 3)), ['personal-center-self', nextIdentity, 0]);
    assert(cleanup.some(x => x.action === 'cancel' && JSON.stringify(x.key) === JSON.stringify(oldPrefix)));
    assert(cleanup.some(x => x.action === 'remove' && JSON.stringify(x.key) === JSON.stringify(oldPrefix)));
    assert.equal(cleanup.filter(x => x.action === 'remove-mutation' && JSON.stringify(x.key.slice(0, 3)) === JSON.stringify(oldPrefix)).length, 4);
    assert.throws(() => oldQuery({ signal: new AbortController().signal }));
    assert.throws(() => oldMutation({ phone: 'TEST_ONLY' })); assert.equal(rpcCalls.length, callsBefore);
    assert.equal(host.querySelector('.pc-inline-status').textContent, '已验证');
    await tab('账号安全'); assert(host.textContent.includes('更换手机号')); assert.equal(host.querySelector('label[for="pc-phone"]').textContent, '待验证手机号');
    assert.equal(host.querySelector('#pc-phone').placeholder, '中国大陆新手机号');
    return { sameNumericId: true, changedUsernameChangesIdentity: true, sourceModelSha256: manifest.sourceHashes['client/src/pages/profileModel.ts'],
      sourceCompatibleRoot: 'personal-center-self', oldSubjectQueriesAndMutationVariablesRemoved: true, staleCallbacksNeverReachRPC: true };
  });
  await test('actual session-clear listener synchronously blocks old callbacks and preserves native contexts', async () => {
    const oldQuery = query('profile').queryFn, oldMutation = observer('change-password').options.mutationFn;
    const before = rpcCalls.length; assert.equal(typeof sessionListener, 'function');
    await React.act(async () => { sessionListener(); assert.throws(() => oldQuery({ signal: new AbortController().signal })); assert.throws(() => oldMutation({})); });
    assert(host.textContent.includes('登录状态已失效，请重新登录')); assert.equal(host.querySelectorAll('[role="tab"]').length, 0);
    assert.equal(rpcCalls.length, before); assert.equal(counts.authRefreshFixtureCalls, 1);
    assert.equal(counts.authLogoutFixtureCalls, 0); assert.equal(counts.routerNavigationFixtureCalls, 0);
    return { synchronouslyInvalidated: true, cachedAuthDoesNotResurrectPage: true, noLoginAcceptanceClaim: true };
  });
  await test('all candidate/source hashes remain frozen and every real IO count is zero', async () => {
    await React.act(async () => root.unmount()); root = null;
    for (const item of manifest.records) assert.equal(sha(read(OUT + '/' + item.relative)), item.sha256);
    for (const pin of pins) assert.equal(sha(read(path.join(REPO, pin.relative))), pin.sha256);
    assert.equal(counts.actualNetworkIO, 0); assert.equal(counts.actualDatabaseIO, 0); assert.equal(counts.actualSMSIO, 0);
    assert.equal(counts.blockedNetworkAttempts, 0); assert.equal(counts.authLogoutFixtureCalls, 0); assert.equal(counts.routerNavigationFixtureCalls, 0);
    return { onlyScriptAndRequestedReportWritten: true, actualNativeIO: 0, blockedAttempts: 0, unchangedCandidateAndPinnedSourceHashes: true };
  });
  report.status = 'PASS';
})().catch(error => { report.status = 'FAIL'; report.failure = error.stack; process.exitCode = 1; }).finally(async () => {
  if (root) { try { await React.act(async () => root.unmount()); } catch (e) { report.cleanupError = e.stack; } }
  if (dom) dom.window.close();
  delete report._HS;
  report.testScriptSha256 = sha(read(__filename));
  report.mockedNativeIOCounts = { ...counts };
  report.passed = report.results.filter(x => x.status === 'PASS').length;
  report.failed = report.results.filter(x => x.status === 'FAIL').length;
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, passed: report.passed, failed: report.failed, report: REPORT,
    profileSha256: report.actualExecutedShas.profileWholeFile, counts }));
});
