#!/usr/bin/env node
/**
 * Offline channel topnav overlay builder. ONLY writes /home/ubuntu/nav-hierarchy/channel-overlay.
 * Usage: node deploy/build-channel-topnav-overlay.mjs
 * Source must be frozen before the final run. Exit 2 means 构建器准备好待freeze.
 * Never imports/runs the old four-tab smoke; never writes source, HTML, CSS, baseline or deploy state.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineDir = '/home/ubuntu/nav-hierarchy/baseline';
const out = '/home/ubuntu/nav-hierarchy/channel-overlay';
const names = { chunk: 'BusinessWorkbenchPage-ci-management-948d4fff464c76cf.js', entry: 'index-CG0lkwm6.js' };
const expected = {
  chunk: '948d4fff464c76cf364014953446bd00ed3763b4cb8216a7fe2e47de37c660de',
  entry: '602034896c9cb13cf9ad805dc07aae113ea907cb4291cff09189398f2c727bd8',
};
const oldBinding = '__ci_management_overlay_v1';
const binding = '__ci_channel_topnav_overlay_v1';
const hostSource = path.join(repo, 'client/src/business/platform/client/src/pages/ChannelInventoryHost.tsx');
const urlHelper = path.join(repo, 'client/src/lib/channelInventoryNavigation.ts');
const managementCss = path.join(repo, 'client/src/business/platform/client/src/components/channelInventory/management.css');
const cssSha = '6180ba0776bef02e9c256c349be63feeb15235246fb3340121d9dbd2b7cd9980';
const cssAssetUrl = '/assets/channel-inventory-management-6180ba0776bef02e.css';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const walk = (node, fn) => { fn(node); ts.forEachChild(node, child => walk(child, fn)); };
const unique = (list, label) => { assert.equal(list.length, 1, `${label}: expected 1, got ${list.length}`); return list[0]; };
function parse(name, text, kind = ts.ScriptKind.JS) {
  const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kind);
  assert.equal(ast.parseDiagnostics.length, 0, `${name}: parse failed: ${ast.parseDiagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('; ')}`);
  return ast;
}
function pending(message) { const error = new Error(message); error.pendingFreeze = true; throw error; }
function assertPureUrlHelper(text) {
  const ast = parse(urlHelper, text, ts.ScriptKind.TS);
  const allowedStatements = n => ts.isVariableStatement(n) || ts.isFunctionDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n) || ts.isEmptyStatement(n);
  assert.ok(ast.statements.every(allowedStatements), 'STOP: URL helper must have only pure constants/functions/types (no runtime imports/re-exports)');
  const calls = new Set(['Number', 'Number.isSafeInteger', ...ast.statements.filter(ts.isFunctionDeclaration).map(n => n.name?.text)]);
  const methods = new Set(['replace', 'get', 'has', 'some']);
  walk(ast, n => {
    if (ts.isIdentifier(n)) assert.ok(!/^(?:window|document|globalThis|process|fetch|XMLHttpRequest|WebSocket|React|trpc|require|eval|setTimeout|setInterval)$/.test(n.text), `STOP: runtime access in URL helper: ${n.text}`);
    assert.ok(!ts.isAwaitExpression(n) && !ts.isYieldExpression(n) && !ts.isImportDeclaration(n) && !ts.isExportDeclaration(n), 'STOP: effect/runtime import in URL helper');
    if (ts.isNewExpression(n)) assert.equal(n.expression.getText(ast), 'URLSearchParams', 'STOP: URL helper may only construct URLSearchParams');
    if (ts.isCallExpression(n)) assert.ok(calls.has(n.expression.getText(ast)) || ts.isPropertyAccessExpression(n.expression) && (methods.has(n.expression.name.text) || n.expression.name.text === 'test' && ts.isRegularExpressionLiteral(n.expression.expression)), `STOP: non-pure URL helper call ${n.expression.getText(ast)}`);
    if (ts.isBinaryExpression(n)) assert.ok(n.operatorToken.kind < ts.SyntaxKind.FirstAssignment || n.operatorToken.kind > ts.SyntaxKind.LastAssignment, 'STOP: URL helper assignment/effect');
    assert.ok(!ts.isPostfixUnaryExpression(n) && !(ts.isPrefixUnaryExpression(n) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(n.operator)), 'STOP: URL helper mutation');
  });
}

/** Lightweight real-React SSR; no hooks are replaced, only lexical live dependencies are mocked. */
async function smokeFactory(factoryExpression) {
  const calls = { scope: 0, useLocation: 0, useSearch: 0, useUtils: 0, queries: [], mutationHookCalls: [], attemptedHttp: 0, attemptedClientCalls: 0, attemptedMutations: 0, attemptedNavigation: 0 };
  let nativeRead = true, nativeWrite = true, search = '?ciTab=materials', enterpriseState = 'ready';
  const scope = {
    officialInventoryPermissions: { read: true, write: true, note: true, authorizationVersion: 'native-v1' },
    storageScope: 'scope-31', frontUser: { role: 'user' },
    contextVerification: { state: 'verified', identity: 'scope-31', authorizationVersion: 'auth-v1', readVersion: 'read-v1' },
    onAuthorizationError() {},
  };
  const row = { id: 1, revision: 4, channelId: 11, partNumber: 'CI-TOPNAV-SSR', brand: 'TI', qty: 9, dateCode: null, price: null, taxIncluded: null, leadTime: null, industryCode: null, updatedAt: '2026-11-04T00:00:00Z', canDelete: true, canEdit: true, readOnly: false, canViewSource: false, isMine: true, noteCount: 0, originalRecorderName: '原负责人' };
  const channel = { id: 11, name: 'CI-TOPNAV-CHANNEL', enterpriseId: 31, active: true, canEdit: true, readOnly: false, type: 'factory', revision: 1 };
  const page = items => ({ items, total: items.length, page: 1, pageSize: 20, pageCount: 1, canWrite: true, canFilterSource: false });
  const query = data => ({ data, isLoading: false, isFetching: false, isError: false, refetch: async () => { calls.attemptedClientCalls++; throw new Error('SSR refetch forbidden'); } });
  const client = new Proxy({}, { get: (_, procedure) => ({
    query() { calls.attemptedClientCalls++; throw new Error(`SSR imperative query forbidden: ${String(procedure)}`); },
    mutate() { calls.attemptedMutations++; throw new Error(`SSR mutation forbidden: ${String(procedure)}`); },
  }) });
  const utils = { client: { channelInventory: client }, channelInventory: new Proxy({}, { get: () => ({ invalidate() { calls.attemptedClientCalls++; throw new Error('SSR invalidation forbidden'); } }) }) };
  const trpc = {
    useUtils() { calls.useUtils++; return utils; },
    enterprise: { me: { useQuery() {
      calls.queries.push({ procedure: 'enterprise.me' });
      return { ...query(enterpriseState === 'ready' ? { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: ['inventory.manage'], isOwner: true } : undefined), isLoading: enterpriseState === 'loading', isError: enterpriseState === 'error', error: enterpriseState === 'error' ? new Error('offline enterprise fixture error') : undefined };
    } } },
    channelInventory: new Proxy({}, { get: (_, procedure) => ({
      useQuery(input, options) { calls.queries.push({ procedure: String(procedure), input, enabled: options?.enabled }); return query(procedure === 'listChannels' ? page([channel]) : procedure === 'listTeamMaterials' ? page([row]) : page([])); },
      useMutation() { calls.mutationHookCalls.push(String(procedure)); return { mutateAsync() { calls.attemptedMutations++; throw new Error('SSR mutateAsync forbidden'); }, isPending: false }; },
    }) }),
  };
  const mockUI = (names, attr) => Object.fromEntries(names.map(name => [name, ({ children }) => React.createElement('div', { [attr]: name }, children)]));
  const live = {
    React, jsx, trpc,
    dropdown: mockUI(['DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem', 'DropdownMenuSeparator'], 'data-smoke-dropdown'),
    originalUI: mockUI(['Dialog', 'DialogContent', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogTitle', 'Button'], 'data-smoke-ui'),
    useBusinessScope() { calls.scope++; scope.officialInventoryPermissions.read = nativeRead; scope.officialInventoryPermissions.write = nativeWrite; return scope; },
    useLocation() { calls.useLocation++; return ['/channel-inventory', () => { calls.attemptedNavigation++; throw new Error('SSR navigation forbidden'); }]; },
    useSearch() { calls.useSearch++; return search; },
  };
  const forbidHttp = () => { calls.attemptedHttp++; throw new Error('Business HTTP/network forbidden in offline SSR'); };
  const context = vm.createContext({ console, AbortController, URL, URLSearchParams, TextEncoder, TextDecoder, fetch: forbidHttp,
    XMLHttpRequest: function () { return forbidHttp(); }, WebSocket: function () { return forbidHttp(); },
    setTimeout() { throw new Error('SSR timer forbidden'); }, clearTimeout() {},
  });
  const factory = new vm.Script(factoryExpression, { filename: 'channel-topnav-factory-smoke.js', importModuleDynamically: forbidHttp }).runInContext(context, { timeout: 10000 });
  const compiled = factory(live);
  assert.equal(typeof compiled.default, 'function', 'default Host export missing');
  const cases = [];
  const render = label => {
    const firstQuery = calls.queries.length;
    const html = renderToStaticMarkup(React.createElement(compiled.default));
    if (/role="tablist"/.test(html)) pending('compiled Host still renders old role=tablist');
    cases.push({ name: label, htmlSha256: sha(html), bytes: Buffer.byteLength(html), hostMarker: html.includes('data-channel-inventory-host'), noOldTablist: true, queries: calls.queries.slice(firstQuery) });
    return html;
  };
  let html = render('authorized materials URL intent');
  assert.ok(html.includes('data-channel-inventory-host') && html.includes('CI-TOPNAV-SSR'), 'authorized Host/inventory fixture missing');
  assert.ok(html.includes('渠道库存操作') && html.includes('单条上传'), 'authorized operation area missing');
  assert.ok(html.includes('全选当前页可删除库存'), 'authorized deletion UI missing');
  const stockQuery = calls.queries.find(q => q.procedure === 'listTeamMaterials');
  assert.equal(stockQuery.input.expectedEnterpriseId, 31); assert.equal(stockQuery.input.expectedActorUserId, 7);
  for (const [tab, expectedText] of [['channels', 'CI-TOPNAV-CHANNEL'], ['batches', '上传批次'], ['trash', '回收站']]) {
    search = `?ciTab=${tab}`;
    html = render(`authorized ${tab} URL intent (deep panels initial SSR only)`);
    assert.ok(html.includes('data-channel-inventory-host') && html.includes(expectedText), `${tab}: URL intent/default Host not rendered`);
    assert.ok(html.includes('ci-toolbar') || html.includes('正在加载') || html.includes('role="alert"'), `${tab}: operation/loading/error UI absent`);
    if (tab !== 'channels') assert.ok(!html.includes('CI-TOPNAV-SSR'), `${tab}: URL intent fell back to old materials tab`);
  }
  search = '?ciTab=materials'; nativeWrite = false;
  html = render('native write denied');
  assert.ok(html.includes('data-channel-inventory-host') && !html.includes('全选当前页可删除库存'), 'write denial not preserved');
  nativeRead = false;
  html = render('native read denied');
  assert.ok(html.includes('没有渠道库存查看权限') && html.includes('role="alert"'), 'native read denial absent');
  assert.ok(!html.includes('CI-TOPNAV-SSR'), 'read denial leaked inventory');
  assert.ok(cases.at(-1).queries.filter(q => q.procedure !== 'enterprise.me').every(q => q.enabled === false), 'read-denied scoped queries not disabled');
  nativeRead = true; nativeWrite = true; enterpriseState = 'loading';
  html = render('enterprise loading'); assert.ok(html.includes('aria-busy="true"') && html.includes('正在核对企业权限'), 'loading state absent');
  enterpriseState = 'error'; html = render('enterprise error'); assert.ok(html.includes('role="alert"') && html.includes('offline enterprise fixture error'), 'error state absent');
  for (const hook of ['scope', 'useLocation', 'useSearch', 'useUtils']) assert.equal(calls[hook], cases.length, `live hook not reused: ${hook}`);
  for (const guard of ['attemptedHttp', 'attemptedClientCalls', 'attemptedMutations', 'attemptedNavigation']) assert.equal(calls[guard], 0, `unexpected SSR effect: ${guard}`);
  return { passed: true, kind: 'offline-vm-real-react-SSR', realBusinessHttpRequests: 0, networkAccess: false, cases,
    singletonHookCalls: Object.fromEntries(['scope', 'useLocation', 'useSearch', 'useUtils'].map(k => [k, calls[k]])),
    fixtureIdentity: { enterpriseId: 31, actorUserId: 7 },
    runtimeReactBundled: false, notes: 'Actual compiled default Host uses real React hooks/SSR with mock lexical scope/native grants/trpc; deep panels are only tested at initial SSR, not full interactions. Early permission/loading/error states follow source and do not carry the authorized Host marker. Parent must perform real component and authenticated browser QA; this is not online evidence.' };
}

async function main() {
  if (process.argv.includes('--help')) { console.log('Usage: node deploy/build-channel-topnav-overlay.mjs\nOutput: /home/ubuntu/nav-hierarchy/channel-overlay\nExit 2: 构建器准备好待freeze; no polling. Re-run once after source freeze.'); return; }
  assert.equal(process.argv.length, 2, 'No flags supported other than --help');
  const baselineFiles = (await fs.readdir(baselineDir, { withFileTypes: true })).filter(n => n.isFile()).map(n => n.name).sort();
  const baseline = new Map();
  for (const name of baselineFiles) baseline.set(name, await fs.readFile(path.join(baselineDir, name)));
  for (const key of Object.keys(names)) assert.equal(sha(baseline.get(names[key])), expected[key], `STOP: baseline ${key} hash drift`);
  const chunkBuffer = baseline.get(names.chunk), text = chunkBuffer.toString('utf8');
  assert.ok(Buffer.from(text).equals(chunkBuffer), 'STOP: baseline UTF-8 roundtrip failed');
  const ast = parse(names.chunk, text), entryAst = parse(names.entry, baseline.get(names.entry).toString('utf8'));
  const functions = ast.statements.filter(ts.isFunctionDeclaration);
  const host = unique(functions.filter(n => n.name?.text === 'r1'), 'r1 wrapper');
  const oldFactory = unique(ast.statements.filter(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === oldBinding)), 'old top-level factory');
  assert.equal(ast.statements.indexOf(host), ast.statements.indexOf(oldFactory) + 1, 'STOP: old factory and wrapper are not adjacent');
  assert.equal(oldFactory.declarationList.declarations.length, 1, 'STOP: old factory shares its declaration');
  assert.ok(oldFactory.declarationList.flags & ts.NodeFlags.Const, 'STOP: old factory must be const');
  assert.equal(host.parameters.length, 0);
  assert.equal(host.getText(ast).replace(/\s/g, ''), `functionr1(){returnc.createElement(${oldBinding}.default);}`, 'STOP: r1 is not known default Host wrapper');
  const oldStart = oldFactory.getStart(ast), oldEnd = host.end;
  assert.deepEqual([oldStart, oldFactory.end, host.getStart(ast), oldEnd], [496434, 906065, 906066, 906140], 'STOP: old factory/wrapper range drift');
  assert.ok(/^\s*$/.test(text.slice(oldFactory.end, host.getStart(ast))), 'STOP: unrelated bytes between factory/wrapper');
  const oldIdentifiers = [];
  walk(ast, n => { if (ts.isIdentifier(n) && n.text === oldBinding) oldIdentifiers.push(n); if (ts.isIdentifier(n)) assert.notEqual(n.text, binding, 'STOP: new top-level factory binding collision'); });
  assert.equal(oldIdentifiers.length, 2, 'STOP: old factory binding unexpectedly used elsewhere');
  assert.ok(oldIdentifiers.every(n => n.getStart(ast) >= oldStart && n.end <= oldEnd));
  const entryImport = unique(ast.statements.filter(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === `./${names.entry}`), 'entry import');
  const importAliases = Object.fromEntries(entryImport.importClause.namedBindings.elements.map(n => [(n.propertyName ?? n.name).text, n.name.text]));
  const aliases = { React: importAliases.r, jsx: importAliases.j, trpc: importAliases.F, useLocation: importAliases.l, useSearch: importAliases.o };
  assert.deepEqual(aliases, { React: 'c', jsx: 'e', trpc: 'B', useLocation: 'tn', useSearch: 'Lr' });
  const exportsMap = Object.fromEntries(entryAst.statements.filter(ts.isExportDeclaration).flatMap(n => n.exportClause?.elements ?? []).map(n => [n.name.text, (n.propertyName ?? n.name).text]));
  for (const key of ['r', 'j', 'F', 'o', 'l']) assert.ok(exportsMap[key], `STOP: live export ${key} missing`);
  const scope = unique(functions.filter(n => n.name?.text === 'La'), 'scope hook'); assert.match(scope.getText(ast), /c\.useContext\(Kx\)/); aliases.useBusinessScope = 'La';
  const locateUI = (slots, sourcePath) => Object.fromEntries(Object.entries(slots).map(([name, slot]) => {
    const matches = functions.filter(n => { let found = false; walk(n, x => { if (ts.isPropertyAssignment(x) && ts.isStringLiteral(x.name) && x.name.text === 'data-slot' && ts.isStringLiteral(x.initializer) && x.initializer.text === slot) found = true; }); return found && n.getText(ast).includes(sourcePath(name)); });
    const func = unique(matches, name); assert.ok(func.end <= oldStart || func.getStart(ast) >= oldEnd, `STOP: ${name} is inside old factory`); return [name, func.name.text];
  }));
  const dropdown = locateUI({ DropdownMenu: 'dropdown-menu', DropdownMenuTrigger: 'dropdown-menu-trigger', DropdownMenuContent: 'dropdown-menu-content', DropdownMenuItem: 'dropdown-menu-item', DropdownMenuSeparator: 'dropdown-menu-separator' }, () => 'components/ui/dropdown-menu.tsx:');
  const originalUI = locateUI({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogDescription: 'dialog-description', DialogFooter: 'dialog-footer', DialogHeader: 'dialog-header', DialogTitle: 'dialog-title', Button: 'button' }, name => name === 'Button' ? 'components/ui/button.tsx:' : 'components/ui/dialog.tsx:');
  assert.ok(scope.end <= oldStart || scope.getStart(ast) >= oldEnd, 'STOP: scope hook inside factory');
  const factoryArgs = `{React:${aliases.React},jsx:${aliases.jsx},trpc:${aliases.trpc},useBusinessScope:${aliases.useBusinessScope},useLocation:${aliases.useLocation},useSearch:${aliases.useSearch},dropdown:{${Object.entries(dropdown).map(([k, v]) => `${k}:${v}`).join(',')}},originalUI:{${Object.entries(originalUI).map(([k, v]) => `${k}:${v}`).join(',')}}}`;
  const oldCall = oldFactory.declarationList.declarations[0].initializer;
  assert.ok(ts.isCallExpression(oldCall) && oldCall.arguments.length === 1 && ts.isParenthesizedExpression(oldCall.expression) && ts.isFunctionExpression(oldCall.expression.expression), 'STOP: unexpected old factory shape');
  assert.equal(oldCall.arguments[0].getText(ast).replace(/\s/g, ''), factoryArgs, 'STOP: bridge mapping differs from original factory');
  const xlsxImports = [];
  walk(oldFactory, n => { if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0]?.text?.includes('/xlsx-')) xlsxImports.push(n.arguments[0].text); });
  const xlsxPath = unique([...new Set(xlsxImports)], 'xlsx dynamic URL in old factory'); assert.equal(xlsxPath, './xlsx-DGuHH-KN.js');
  const hostText = await fs.readFile(hostSource, 'utf8'), helperText = await fs.readFile(urlHelper, 'utf8');
  const sourceAst = parse(hostSource, hostText, ts.ScriptKind.TSX); let hasOldTablist = false, hasHostMarker = false;
  walk(sourceAst, n => { if (ts.isJsxAttribute(n) && n.name.getText(sourceAst) === 'role' && ts.isStringLiteral(n.initializer) && n.initializer.text === 'tablist') hasOldTablist = true; if (ts.isJsxAttribute(n) && n.name.getText(sourceAst) === 'data-channel-inventory-host') hasHostMarker = true; });
  if (hasOldTablist || !hostText.includes('readChannelInventoryTabIntent') || !hostText.includes('channelInventoryTabLocation')) pending('current ChannelInventoryHost still has old tabs or lacks URL ciTab helper');
  assert.ok(hasHostMarker, 'STOP: actual Host marker missing'); assertPureUrlHelper(helperText);
  const cssBuffer = await fs.readFile(managementCss); assert.equal(sha(cssBuffer), cssSha, 'STOP: existing management CSS changed');
  const html = baseline.get('index.html')?.toString('utf8'); assert.ok(html?.includes(cssAssetUrl), 'STOP: baseline HTML does not reference existing management CSS');
  const deployedCssCapture = baseline.get(path.basename(cssAssetUrl)); if (deployedCssCapture) assert.equal(sha(deployedCssCapture), cssSha, 'STOP: captured CSS differs from frozen management CSS');
  const targets = {
    trpc: path.join(repo, 'client/src/business/api/business-trpc'), scope: path.join(repo, 'client/src/business/BusinessScope'),
    dropdown: path.join(repo, 'client/src/business/platform/client/src/components/ui/dropdown-menu'),
    bridge: path.join(repo, 'client/src/business/platform/client/src/components/channelInventory/bridge'),
  };
  const reactExports = ['Children', 'Component', 'Fragment', 'Profiler', 'PureComponent', 'StrictMode', 'Suspense', 'act', 'cache', 'cloneElement', 'createContext', 'createElement', 'createRef', 'forwardRef', 'isValidElement', 'lazy', 'memo', 'startTransition', 'use', 'useActionState', 'useCallback', 'useContext', 'useDebugValue', 'useDeferredValue', 'useEffect', 'useId', 'useImperativeHandle', 'useInsertionEffect', 'useLayoutEffect', 'useMemo', 'useOptimistic', 'useReducer', 'useRef', 'useState', 'useSyncExternalStore', 'useTransition', 'version'];
  const virtuals = {
    react: `const R=__ci_live.React; export default R; ${reactExports.map(n => `export const ${n}=R.${n};`).join('\n')}`,
    jsx: 'export const jsx=__ci_live.jsx.jsx; export const jsxs=__ci_live.jsx.jsxs; export const Fragment=__ci_live.jsx.Fragment;',
    wouter: 'export const useLocation=__ci_live.useLocation; export const useSearch=__ci_live.useSearch;',
    trpc: 'export const trpc=__ci_live.trpc;', scope: 'export const useBusinessScope=__ci_live.useBusinessScope;',
    dropdown: Object.keys(dropdown).map(n => `export const ${n}=__ci_live.dropdown.${n};`).join('\n'),
    bridge: 'export const trpc=__ci_live.trpc;\n' + Object.keys(originalUI).map(n => `export const ${n}=__ci_live.originalUI.${n};`).join('\n'),
  };
  const readSources = new Map([[hostSource, sha(hostText)], [urlHelper, sha(helperText)]]), cssDropped = new Map();
  const plugin = { name: 'channel-topnav-live-lexical-singletons', setup(build) {
    build.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'react') return { path: 'react', namespace: 'ci-live' };
      if (args.path === 'react/jsx-runtime') return { path: 'jsx', namespace: 'ci-live' };
      if (args.path === 'wouter') return { path: 'wouter', namespace: 'ci-live' };
      if (args.path === 'xlsx') return { path: xlsxPath, external: true };
      if (/\.css$/.test(args.path)) return { path: path.resolve(args.resolveDir, args.path), namespace: 'ci-drop-css' };
      if (args.path.startsWith('.') || path.isAbsolute(args.path)) {
        const normalized = path.resolve(args.resolveDir, args.path).replace(/\.(?:tsx?|jsx?)$/, '');
        for (const [key, target] of Object.entries(targets)) if (normalized === target) return { path: key, namespace: 'ci-live' };
      }
      if (/^(react(?:\/|$)|react-dom(?:\/|$)|@trpc\/|@tanstack\/(?:react-query|query-core)|wouter(?:\/|$)|@radix-ui\/)/.test(args.path)) throw new Error(`STOP: unbridged runtime dependency ${args.path}`);
    });
    build.onLoad({ filter: /.*/, namespace: 'ci-live' }, args => ({ contents: virtuals[args.path], loader: 'js' }));
    build.onLoad({ filter: /.*/, namespace: 'ci-drop-css' }, async args => { const bytes = await fs.readFile(args.path); cssDropped.set(args.path, sha(bytes)); return { contents: '', loader: 'js' }; });
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/, namespace: 'file' }, async args => {
      const bytes = await fs.readFile(args.path), contents = bytes.toString('utf8'), hash = sha(bytes);
      if (readSources.has(args.path) && readSources.get(args.path) !== hash) pending(`source changed before compilation: ${args.path}`);
      readSources.set(args.path, hash); if (args.path === urlHelper) assertPureUrlHelper(contents);
      return { contents, loader: /tsx$/.test(args.path) ? 'tsx' : /ts$/.test(args.path) ? 'ts' : /jsx$/.test(args.path) ? 'jsx' : 'js' };
    });
  } };
  console.log('Frozen baseline verified; compiling actual current Host with original lexical React/JSX/trpc/scope/router/UI bridges.');
  const result = await esbuild.build({ absWorkingDir: repo, entryPoints: [hostSource], bundle: true, write: false, format: 'iife', globalName: '__ci_module', platform: 'browser', target: 'es2020', jsx: 'automatic', minify: true, legalComments: 'none', metafile: true, sourcemap: false, plugins: [plugin], define: { 'process.env.NODE_ENV': '"production"' }, tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', esModuleInterop: true } } });
  assert.equal(result.outputFiles.length, 1, 'STOP: no new CSS/assets permitted');
  const bundle = result.outputFiles[0].text;
  const forbiddenInputs = Object.keys(result.metafile.inputs).filter(n => /node_modules\/(?:\.pnpm\/)?(?:react(?:@|\/)|react-dom(?:@|\/)|wouter(?:@|\/)|@trpc(?:\+|\/)|@tanstack(?:\+|\/)|@radix-ui(?:\+|\/))|business\/api\/business-trpc\.|BusinessScope\.[jt]sx?|server\//.test(n));
  assert.deepEqual(forbiddenInputs, [], `STOP: bundled runtime/provider/server inputs: ${forbiddenInputs}`);
  for (const token of ['createTRPCReact', 'createTRPCClient', 'httpBatchLink', 'react.production', 'react.development', 'react-dom.production', 'BusinessScopeProvider', '/api/business-trpc']) assert.ok(!bundle.includes(token), `STOP: bundled runtime token ${token}`);
  assert.ok(Object.keys(result.metafile.inputs).some(n => path.resolve(repo, n) === urlHelper), 'STOP: pure URL helper was not bundled');
  for (const output of Object.values(result.metafile.outputs)) for (const imp of output.imports) assert.ok(imp.external && imp.path === xlsxPath && imp.kind === 'dynamic-import', `STOP: unexpected output import ${JSON.stringify(imp)}`);
  const factoryExpression = `(function(__ci_live){${bundle}\nreturn __ci_module;})`;
  const smoke = await smokeFactory(factoryExpression);
  const replacement = `const ${binding}=${factoryExpression}(${factoryArgs});\nfunction r1(){return ${aliases.React}.createElement(${binding}.default);}`;
  const byteStart = Buffer.byteLength(text.slice(0, oldStart)), byteEnd = Buffer.byteLength(text.slice(0, oldEnd));
  assert.deepEqual([byteStart, byteEnd], [518208, 927928]);
  const before = chunkBuffer.subarray(0, byteStart), oldBytes = chunkBuffer.subarray(byteStart, byteEnd), after = chunkBuffer.subarray(byteEnd), replacementBytes = Buffer.from(replacement);
  const newBuffer = Buffer.concat([before, replacementBytes, after]);
  const newAst = parse('channel-topnav-overlay.js', newBuffer.toString('utf8'));
  assert.equal(newAst.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'r1').length, 1);
  const restored = Buffer.concat([newBuffer.subarray(0, byteStart), oldBytes, newBuffer.subarray(byteStart + replacementBytes.length)]);
  assert.ok(restored.equals(chunkBuffer), 'STOP: inverse byte preservation failed');
  assert.ok(newBuffer.subarray(0, byteStart).equals(before) && newBuffer.subarray(byteStart + replacementBytes.length).equals(after), 'STOP: other business declarations/table bytes changed');
  const declarations = tree => tree.statements.filter(n => ts.isImportDeclaration(n) || ts.isExportDeclaration(n)).map(n => n.getText(tree));
  assert.deepEqual(declarations(newAst), declarations(ast), 'STOP: import/export declarations changed');
  const jsHash = sha(newBuffer), jsName = `BusinessWorkbenchPage-channel-topnav-${jsHash.slice(0, 16)}.js`;
  const sourceFiles = [...new Map([...readSources, ...cssDropped, [managementCss, cssSha]])].sort(([a], [b]) => a.localeCompare(b)).map(([source, hash]) => ({ name: source, repoRelativePath: path.relative(repo, source), sha256: hash }));
  for (const { name: source, sha256 } of sourceFiles) if (sha(await fs.readFile(source)) !== sha256) pending(`source changed during build: ${source}`);
  for (const [cssPath, hash] of cssDropped) if (sha(await fs.readFile(cssPath)) !== hash) pending(`dropped CSS changed during build: ${cssPath}`);
  assert.equal(sha(await fs.readFile(managementCss)), cssSha, 'STOP: management CSS changed during build');
  const finalBaselineFiles = (await fs.readdir(baselineDir, { withFileTypes: true })).filter(n => n.isFile()).map(n => n.name).sort(); assert.deepEqual(finalBaselineFiles, baselineFiles, 'STOP: baseline file list changed');
  for (const [name, bytes] of baseline) assert.ok((await fs.readFile(path.join(baselineDir, name))).equals(bytes), `STOP: baseline bytes changed: ${name}`);
  const entryExports = Object.fromEntries(['r', 'j', 'F', 'o', 'l'].map(k => [k, exportsMap[k]]));
  const declarationTexts = declarations(ast);
  const manifest = {
    schemaVersion: 1, kind: 'channel-topnav-lexical-overlay', generatedAt: new Date().toISOString(), offlineOnly: true, deploymentPerformed: false,
    baseline: Object.fromEntries([...baseline].map(([name, bytes]) => [name, sha(bytes)])),
    baselineDetails: Object.fromEntries(Object.entries(names).map(([key, name]) => [key, { path: path.join(baselineDir, name), sha256: expected[key], bytes: baseline.get(name).length }])),
    outputs: { js: { name: jsName, path: path.join(out, jsName), assetUrl: `/assets/${jsName}`, sha256: jsHash, bytes: newBuffer.length } },
    artifacts: { factory: { path: path.join(out, 'factory-expression.js'), sha256: sha(factoryExpression + '\n') }, metafile: { path: path.join(out, 'overlay-metafile.json') }, manifest: { path: path.join(out, 'manifest.json') } },
    mappingForParentMergeOnly: { requestedPatchedChunk: `/assets/${names.chunk}`, originalEntryDynamicImport: '/assets/BusinessWorkbenchPage-DZYOmou-.js', replacement: `/assets/${jsName}`, htmlWritten: false, note: 'Parent merges/replaces the original import-map key with its topnav mapping; do not rely on an importmap mapping chain.' },
    bridges: { aliases, entryExports, dropdown, originalUI, xlsxPath, namespace: 'ci-live', bridgeSource: virtuals, factoryArgs, sameModuleLexicalBindings: true, noNewReactOrQueryTrpcProvider: true },
    replacedOnly: {
      oldFactory: { binding: oldBinding, utf16Range: [oldStart, oldFactory.end], byteRange: [byteStart, Buffer.byteLength(text.slice(0, oldFactory.end))], sha256: sha(oldFactory.getText(ast)) },
      oldWrapper: { name: 'r1', utf16Range: [host.getStart(ast), oldEnd], byteRange: [Buffer.byteLength(text.slice(0, host.getStart(ast))), byteEnd], sha256: sha(host.getText(ast)) },
      oldFactoryPlusWrapper: { utf16Range: [oldStart, oldEnd], byteRange: [byteStart, byteEnd], sha256: sha(oldBytes), bytes: oldBytes.length },
      replacement: { binding, name: 'r1', byteRange: [byteStart, byteStart + replacementBytes.length], sha256: sha(replacementBytes), bytes: replacementBytes.length, defaultHostCompatible: true, wrapperUsesOriginalReactCreateElement: true },
    },
    inverseBytePreservation: { passed: true, operation: 'Replace output replacement byteRange with baseline oldFactoryPlusWrapper byteRange; compare restored entire chunk byte-for-byte', restoredSha256: sha(restored), equalsBaselineSha256: expected.chunk, prefix: { byteRange: [0, byteStart], sha256: sha(before), unchanged: true }, suffix: { originalByteRange: [byteEnd, chunkBuffer.length], outputByteRange: [byteStart + replacementBytes.length, newBuffer.length], sha256: sha(after), unchanged: true }, allOtherBusinessDeclarationsTablesAndOriginalSourceMarkersPreserved: true },
    importsExportsUnchanged: true, originalImportsExportsPreserved: true, allOtherChunkBytesPreserved: true, noRuntimeOrServerDependencies: true, existingChannelManagementCssUnchanged: true,
    importsExportsEvidence: { passed: true, declarations: declarationTexts, sha256: sha(declarationTexts.join('\n')), count: declarationTexts.length },
    otherBaselineFilesByteUnchanged: [...baseline].filter(([name]) => name !== names.chunk).map(([name, bytes]) => ({ path: path.join(baselineDir, name), sha256: sha(bytes), bytes: bytes.length, byteComparisonPassed: true })),
    noBundledRuntimeProviders: { passed: true, forbiddenInputs, virtualBridges: Object.keys(virtuals), externalRuntimeImports: [], soleAllowedExternalDynamicAsset: xlsxPath, reactLibraryNotBundled: true, originalScopeAndUiRemainTopLevelOutsideReplacement: true },
    sourceFiles, sourceBinding: { sourceStableDuringBuild: true, parentMustBindTheseExactHashesToFinalCommit: true, sourceFreezeAndFinalCommitNotClaimed: true, pureUrlHelper: { path: urlHelper, sha256: readSources.get(urlHelper), pureAstGuardPassed: true } },
    existingChannelManagementCssEvidence: { passed: true, source: managementCss, sha256: cssSha, assetUrl: cssAssetUrl, readBackSha256: cssSha, baselineHtmlReferenceVerified: true, capturedDeployedCssByteVerified: Boolean(deployedCssCapture), newCssWritten: false, droppedImports: [...cssDropped].sort(([a], [b]) => a.localeCompare(b)).map(([cssPath, hash]) => ({ path: cssPath, sha256: hash, stableReadBack: true })), caveat: deployedCssCapture ? 'Captured baseline CSS hash equals frozen source hash.' : 'Baseline directory lacks the management CSS asset. Existing source full SHA and captured HTML asset name match and are guarded; this is not a new live CSS fetch/byte capture.' },
    smoke,
    requiredParentQA: ['Real component QA including URL ciTab switching/history/deep links and legacy exact-source authorization behavior.', 'Authenticated local browser integration QA against the actual combined topnav+channel candidate; SSR initial panels are not full interactions.', 'Final source freeze and bind sourceFiles hashes to final commit; re-run once if any bundled source/CSS changes.', 'Parent must verify deployed baseline/CSS and merge the two mappings; this tool writes no HTML/CSS and performs no deployment or online checks.'],
    guards: { baselineHashes: true, baselineDirectoryReadBackBytePreservation: true, inverseBytePreservation: true, importsExportsUnchanged: true, uniqueR1Wrapper: true, newOverlayParses: true, noBundledRuntimeProviders: true, pureUrlHelper: true, existingChannelManagementCssUnchanged: true, sourceStableDuringBuild: true, businessHttpRequests: 0 },
  };
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, jsName), newBuffer);
  await fs.writeFile(path.join(out, 'factory-expression.js'), factoryExpression + '\n');
  await fs.writeFile(path.join(out, 'overlay-metafile.json'), JSON.stringify(result.metafile, null, 2) + '\n');
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  assert.equal(sha(await fs.readFile(path.join(out, jsName))), jsHash, 'STOP: output readback mismatch');
  console.log(JSON.stringify({ success: true, offlineOnly: true, output: path.join(out, jsName), sha256: jsHash, manifest: path.join(out, 'manifest.json'), oldFactoryPlusWrapperByteRange: [byteStart, byteEnd], inverseBytePreservation: true, importsExportsUnchanged: true, smokePassed: smoke.passed, realBusinessHttpRequests: 0, requiredParentQA: true }, null, 2));
}
main().catch(error => {
  if (error.pendingFreeze) { console.error(JSON.stringify({ success: false, status: '构建器准备好待freeze', reason: error.message, builder: fileURLToPath(import.meta.url), action: 'No polling. Parent re-runs once after source freeze; any existing candidate must be treated as stale.' }, null, 2)); process.exitCode = 2; }
  else { console.error(error.stack ?? error); process.exitCode = 1; }
});
