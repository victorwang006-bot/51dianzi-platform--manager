#!/usr/bin/env node
/** Offline only: never writes source, baseline, git, remote hosts or production. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import ts from 'typescript';
import postcss from 'postcss';
import { smokeFactory } from './smoke-overlay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const workspace = path.resolve(repo, '..');
const baselineDir = path.join(workspace, 'deploy-review');
const out = path.join(workspace, 'overlay-build');
const baselineNames = { chunk: 'BusinessWorkbenchPage-DZYOmou-.js', entry: 'index-CG0lkwm6.js', html: 'admin-live-index.html', css: 'BusinessWorkbenchPage-DnkGIroY.css' };
const expectedHashes = {
  chunk: 'e5ac178e1f375777e8b01ec67d02cb4a51964a159e983b49237a5102bf43e156',
  entry: '602034896c9cb13cf9ad805dc07aae113ea907cb4291cff09189398f2c727bd8',
  html: 'bda9ddbf37c704bdc5936542f7d64b618763c90f719f5415a3f82c5cf9b04135',
  css: 'c6d9560d767b681275ffa5600beb63411172847ac27b1c0296c1f6bc5355e7a7',
};
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const parse = (name, text) => {
  const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, `${name}: JS parse error ${ast.parseDiagnostics.map(d => `${d.start}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')} near ${text.slice(Math.max(0, d.start - 120), d.start + 120)}`).join('; ')}`);
  return ast;
};
const unique = (list, description) => { assert.equal(list.length, 1, `${description}: expected exactly one match, got ${list.length}`); return list[0]; };
const walk = (node, fn) => { fn(node); ts.forEachChild(node, child => walk(child, fn)); };
const buffers = {}, texts = {};
for (const [key, name] of Object.entries(baselineNames)) {
  buffers[key] = await fs.readFile(path.join(baselineDir, name));
  assert.equal(sha(buffers[key]), expectedHashes[key], `STOP: baseline ${key} drift`);
  texts[key] = buffers[key].toString('utf8');
}
const ast = parse(baselineNames.chunk, texts.chunk);
const entryAst = parse(baselineNames.entry, texts.entry);
const functions = ast.statements.filter(ts.isFunctionDeclaration);
const host = unique(functions.filter(n => n.name?.text === 'r1'), 'old host r1');
assert.equal(host.getStart(ast), 496433); assert.equal(host.end, 556550);
assert.equal(host.parameters.length, 0);
assert.ok(host.getText(ast).includes('ChannelInventoryHost.tsx:'));
const entryImport = unique(ast.statements.filter(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === './index-CG0lkwm6.js'), 'live entry import');
const importAliases = Object.fromEntries(entryImport.importClause.namedBindings.elements.map(n => [(n.propertyName ?? n.name).text, n.name.text]));
const aliases = { React: importAliases.r, jsx: importAliases.j, trpc: importAliases.F, useLocation: importAliases.l, useSearch: importAliases.o };
assert.deepEqual(aliases, { React: 'c', jsx: 'e', trpc: 'B', useLocation: 'tn', useSearch: 'Lr' });
const exportsMap = Object.fromEntries(entryAst.statements.filter(ts.isExportDeclaration).flatMap(n => n.exportClause?.elements ?? []).map(n => [n.name.text, (n.propertyName ?? n.name).text]));
for (const exported of ['r', 'j', 'F', 'o', 'l']) assert.ok(exportsMap[exported], `missing live export ${exported}`);
const scope = unique(functions.filter(n => n.name?.text === 'La'), 'scope hook');
assert.match(scope.getText(ast), /c\.useContext\(Kx\)/);
aliases.useBusinessScope = scope.name.text;
const hostCalls = new Set();
walk(host, n => { if (ts.isCallExpression(n)) hostCalls.add(n.expression.getText(ast)); });
for (const required of ['B.useUtils', 'B.enterprise.me.useQuery', 'La', 'tn', 'Lr', 'c.useState']) assert.ok(hostCalls.has(required), `old host missing ${required}`);
// JSX slot and original source path identify original dropdown components without guessing minified names.
const dropdown = {};
for (const [name, slot] of Object.entries({ DropdownMenu: 'dropdown-menu', DropdownMenuTrigger: 'dropdown-menu-trigger', DropdownMenuContent: 'dropdown-menu-content', DropdownMenuItem: 'dropdown-menu-item', DropdownMenuSeparator: 'dropdown-menu-separator' })) {
  const matches = functions.filter(n => { let found = false; walk(n, x => { if (ts.isPropertyAssignment(x) && ts.isStringLiteral(x.name) && x.name.text === 'data-slot' && ts.isStringLiteral(x.initializer) && x.initializer.text === slot) found = true; }); return found && n.getText(ast).includes('components/ui/dropdown-menu.tsx:'); });
  dropdown[name] = unique(matches, name).name.text;
}
const originalUI = {};
for (const [name, slot] of Object.entries({ Dialog: 'dialog', DialogContent: 'dialog-content', DialogDescription: 'dialog-description', DialogFooter: 'dialog-footer', DialogHeader: 'dialog-header', DialogTitle: 'dialog-title', Button: 'button' })) {
  const sourcePath = name === 'Button' ? 'components/ui/button.tsx:' : 'components/ui/dialog.tsx:';
  const matches = functions.filter(n => { let found = false; walk(n, x => { if (ts.isPropertyAssignment(x) && ts.isStringLiteral(x.name) && x.name.text === 'data-slot' && ts.isStringLiteral(x.initializer) && x.initializer.text === slot) found = true; }); return found && n.getText(ast).includes(sourcePath); });
  originalUI[name] = unique(matches, name).name.text;
}
let xlsxImports = [];
walk(host, n => { if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0]?.text?.includes('/xlsx-')) xlsxImports.push(n.arguments[0].text); });
const xlsxPath = unique([...new Set(xlsxImports)], 'original host xlsx import');
const hostSource = path.join(repo, 'client/src/business/platform/client/src/pages/ChannelInventoryHost.tsx');
const managementCss = path.join(repo, 'client/src/business/platform/client/src/components/channelInventory/management.css');
const targets = {
  trpc: path.join(repo, 'client/src/business/api/business-trpc'),
  scope: path.join(repo, 'client/src/business/BusinessScope'),
  dropdown: path.join(repo, 'client/src/business/platform/client/src/components/ui/dropdown-menu'),
  bridge: path.join(repo, 'client/src/business/platform/client/src/components/channelInventory/bridge'),
};
const reactExports = ['Children','Component','Fragment','Profiler','PureComponent','StrictMode','Suspense','act','cache','cloneElement','createContext','createElement','createRef','forwardRef','isValidElement','lazy','memo','startTransition','use','useActionState','useCallback','useContext','useDebugValue','useDeferredValue','useEffect','useId','useImperativeHandle','useInsertionEffect','useLayoutEffect','useMemo','useOptimistic','useReducer','useRef','useState','useSyncExternalStore','useTransition','version'];
const virtuals = {
  react: `const R=__ci_live.React; export default R; ${reactExports.map(n => `export const ${n}=R.${n};`).join('\n')}`,
  jsx: 'export const jsx=__ci_live.jsx.jsx; export const jsxs=__ci_live.jsx.jsxs; export const Fragment=__ci_live.jsx.Fragment;',
  wouter: 'export const useLocation=__ci_live.useLocation; export const useSearch=__ci_live.useSearch;',
  trpc: 'export const trpc=__ci_live.trpc;',
  scope: 'export const useBusinessScope=__ci_live.useBusinessScope;',
  dropdown: Object.keys(dropdown).map(n => `export const ${n}=__ci_live.dropdown.${n};`).join('\n'),
  bridge: 'export const trpc=__ci_live.trpc;\n' + Object.keys(originalUI).map(n => `export const ${n}=__ci_live.originalUI.${n};`).join('\n'),
};
const cssDropped = new Set();
const readSources = new Map();
const plugin = { name: 'reuse-live-lexical-singletons', setup(build) {
  build.onResolve({ filter: /.*/ }, args => {
    if (args.path === 'react') return { path: 'react', namespace: 'ci-live' };
    if (args.path === 'react/jsx-runtime') return { path: 'jsx', namespace: 'ci-live' };
    if (args.path === 'wouter') return { path: 'wouter', namespace: 'ci-live' };
    if (args.path === 'xlsx') return { path: xlsxPath, external: true };
    if (/\.css$/.test(args.path)) {
      const absolute = path.resolve(args.resolveDir, args.path); cssDropped.add(absolute);
      return { path: absolute, namespace: 'ci-drop-css' };
    }
    if (args.path.startsWith('.')) {
      const normalized = path.resolve(args.resolveDir, args.path).replace(/\.(?:tsx?|jsx?)$/, '');
      for (const [key, value] of Object.entries(targets)) if (normalized === value) return { path: key, namespace: 'ci-live' };
    }
    if (/^(react-dom(?:\/|$)|@trpc\/|@tanstack\/react-query|wouter\/)/.test(args.path)) throw new Error(`STOP: unbridged runtime dependency ${args.path}`);
  });
  build.onLoad({ filter: /.*/, namespace: 'ci-live' }, args => ({ contents: virtuals[args.path], loader: 'js' }));
  build.onLoad({ filter: /.*/, namespace: 'ci-drop-css' }, () => ({ contents: '', loader: 'js' }));
  build.onLoad({ filter: /\.[cm]?[jt]sx?$/, namespace: 'file' }, async args => {
    const contents = await fs.readFile(args.path, 'utf8'); readSources.set(args.path, sha(contents));
    return { contents, loader: /tsx$/.test(args.path) ? 'tsx' : /ts$/.test(args.path) ? 'ts' : /jsx$/.test(args.path) ? 'jsx' : 'js' };
  });
} };
console.log('Baseline verified; building source host with live lexical bridges.');
const result = await esbuild.build({
  absWorkingDir: repo, entryPoints: [hostSource], bundle: true, write: false, format: 'iife', globalName: '__ci_module', platform: 'browser', target: 'es2020', jsx: 'automatic',
  minify: true, legalComments: 'none', metafile: true, sourcemap: false, plugins: [plugin],
  define: { 'process.env.NODE_ENV': '"production"' },
  tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', esModuleInterop: true } },
});
assert.equal(result.outputFiles.length, 1, 'CSS/assets must not be bundled');
const bundle = result.outputFiles[0].text;
const forbiddenInputs = Object.keys(result.metafile.inputs).filter(n => /node_modules\/\.pnpm\/(?:react@|react-dom@|wouter@|@trpc\+|@tanstack\+react-query|@radix-ui\+)|business\/api\/business-trpc\.|BusinessScope\.[jt]sx?|server\//.test(n));
assert.deepEqual(forbiddenInputs, [], `STOP: runtime/provider/server modules bundled: ${forbiddenInputs}`);
for (const forbidden of ['createTRPCReact', 'createTRPCClient', 'httpBatchLink', 'react.production', 'react.development', 'react-dom.production', 'BusinessScopeProvider', '/api/business-trpc']) assert.ok(!bundle.includes(forbidden), `STOP: forbidden bundled runtime ${forbidden}`);
const cssBuffer = await fs.readFile(managementCss);
const cssText = cssBuffer.toString('utf8');
const cssAst = postcss.parse(cssText, { from: managementCss });
const topLevelSelectors = selector => {
  let depth = 0, start = 0; const parts = [];
  for (let i = 0; i < selector.length; i++) {
    if ('(['.includes(selector[i])) depth++;
    if (')]'.includes(selector[i])) depth--;
    if (selector[i] === ',' && depth === 0) { parts.push(selector.slice(start, i)); start = i + 1; }
  }
  parts.push(selector.slice(start)); return parts;
};
cssAst.walkRules(rule => {
  // This deliberate strict policy fails closed if new styles escape the inventory host.
  assert.ok(topLevelSelectors(rule.selector).every(selector => /^\s*\.ci-page\.ci-host\s/.test(selector)), `STOP: unscoped management CSS: ${rule.selector}`);
});
cssAst.walkAtRules(rule => assert.ok(['media', 'supports', 'container', 'layer'].includes(rule.name), `STOP: unsupported CSS @${rule.name}`));
cssAst.walkDecls(decl => {
  assert.ok(!decl.prop.startsWith('--'), `STOP: CSS must not override typography/theme variables: ${decl.prop}`);
  if (/^(font(?:-.+)?|line-height|letter-spacing)$/.test(decl.prop)) assert.ok(/^(inherit|var\(--admin-content-[\w-]+\))$/.test(decl.value), `STOP: typography override: ${decl.toString()}`);
});
const factoryExpression = `(function(__ci_live){${bundle}\nreturn __ci_module;})`;
const smoke = await smokeFactory(factoryExpression);
// Fail on a concurrent edit of an actually bundled source or the CSS. Caller may simply re-run.
for (const [source, initial] of readSources) assert.equal(sha(await fs.readFile(source)), initial, `STOP: source changed during build: ${source}; re-run`);
assert.equal(sha(await fs.readFile(managementCss)), sha(cssBuffer), 'STOP: CSS changed during build; re-run');
const binding = '__ci_management_overlay_v1';
let identifiers = new Set(); walk(ast, n => { if (ts.isIdentifier(n)) identifiers.add(n.text); });
assert.ok(!identifiers.has(binding), 'overlay top-level binding collision');
const factoryArgs = `{React:${aliases.React},jsx:${aliases.jsx},trpc:${aliases.trpc},useBusinessScope:${aliases.useBusinessScope},useLocation:${aliases.useLocation},useSearch:${aliases.useSearch},dropdown:{${Object.entries(dropdown).map(([key, value]) => `${key}:${value}`).join(',')}},originalUI:{${Object.entries(originalUI).map(([key, value]) => `${key}:${value}`).join(',')}}}`;
const replacement = `\nconst ${binding}=${factoryExpression}(${factoryArgs});\nfunction r1(){return ${aliases.React}.createElement(${binding}.default);}\n`;
const before = texts.chunk.slice(0, host.getStart(ast)), after = texts.chunk.slice(host.end);
const newChunk = before + replacement + after;
const newAst = parse('overlay.js', newChunk);
assert.equal(newAst.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'r1').length, 1);
const restoredChunk = newChunk.slice(0, before.length) + host.getText(ast) + newChunk.slice(before.length + replacement.length);
assert.ok(Buffer.from(restoredChunk).equals(buffers.chunk), 'STOP: preserved-byte guard failed');
const preservedStatements = tree => tree.statements.filter(n => ts.isImportDeclaration(n) || ts.isExportDeclaration(n)).map(n => n.getText(tree));
assert.deepEqual(preservedStatements(newAst), preservedStatements(ast), 'imports/exports changed');
const jsHash = sha(newChunk), cssHash = sha(cssBuffer);
const jsName = `BusinessWorkbenchPage-ci-management-${jsHash.slice(0, 16)}.js`;
const cssName = `channel-inventory-management-${cssHash.slice(0, 16)}.css`;
assert.ok(!/<script\b[^>]*\btype\s*=\s*["']importmap["']/i.test(texts.html), 'STOP: baseline now has importmap');
const moduleMatches = [...texts.html.matchAll(/<script\b(?=[^>]*\btype\s*=\s*["']module["'])[^>]*>/gi)];
assert.ok(moduleMatches.length > 0, 'no original module script');
const insertionIndex = moduleMatches[0].index;
const importMap = { imports: { [`/assets/${baselineNames.chunk}`]: `/assets/${jsName}` } };
const htmlInsertion = `<!-- ci-management-v1:start -->\n<script type="importmap">${JSON.stringify(importMap)}</script>\n<link rel="stylesheet" href="/assets/${cssName}">\n<!-- ci-management-v1:end -->\n`;
const candidateHtml = texts.html.slice(0, insertionIndex) + htmlInsertion + texts.html.slice(insertionIndex);
assert.ok(Buffer.from(candidateHtml.slice(0, insertionIndex) + candidateHtml.slice(insertionIndex + htmlInsertion.length)).equals(buffers.html), 'STOP: HTML/runtime byte preservation failed');
const documentBase = new URL('https://local.invalid/assets/index-CG0lkwm6.js');
assert.equal(new URL('./BusinessWorkbenchPage-DZYOmou-.js', documentBase).pathname, Object.keys(importMap.imports)[0], 'importmap key does not resolve original dynamic import');
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, jsName), newChunk);
await fs.writeFile(path.join(out, cssName), cssBuffer);
await fs.writeFile(path.join(out, 'candidate-index.html'), candidateHtml);
await fs.writeFile(path.join(out, 'overlay-metafile.json'), JSON.stringify(result.metafile, null, 2) + '\n');
const manifest = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), offlineOnly: true,
  baseline: Object.fromEntries(Object.entries(baselineNames).map(([key, name]) => [key, { path: path.join(baselineDir, name), sha256: expectedHashes[key] }])),
  outputs: { js: { path: path.join(out, jsName), assetUrl: `/assets/${jsName}`, sha256: jsHash, bytes: Buffer.byteLength(newChunk) }, css: { path: path.join(out, cssName), assetUrl: `/assets/${cssName}`, sha256: cssHash, bytes: cssBuffer.length }, html: { path: path.join(out, 'candidate-index.html'), sha256: sha(candidateHtml) } },
  onlyChangedFunction: { name: 'r1', oldRange: [host.getStart(ast), host.end], oldRangeKind: 'UTF-16 string offsets (not byte offsets)', oldFunctionSha256: sha(host.getText(ast)), replacementRange: [before.length, before.length + replacement.length], overlayBinding: binding, wrapperUsesCreateElement: true, separateBatchUploadPatch: false },
  bridges: { aliases, entryExports: Object.fromEntries(['r','j','F','o','l'].map(key => [key, exportsMap[key]])), dropdown, originalUI, xlsxPath, namespace: 'ci-live', bridgeSource: virtuals },
  css: { source: managementCss, existingCssPreserved: true, droppedImports: [...cssDropped].sort(), scopeCheckPassed: true, typographyGuardPassed: true },
  sources: [...readSources].map(([source, hash]) => ({ path: source, sha256: hash })),
  guards: { baselineHashes: true, chunkPreservedBytes: true, htmlPreservedBytes: true, importsExportsUnchanged: true, uniqueHostAst: true, overlayAstParse: true, noBundledRuntimeProviders: true, sourceStableDuringBuild: true },
  smoke, importMap, htmlInsertion: { index: insertionIndex, bytes: Buffer.byteLength(htmlInsertion), beforeFirstModule: true },
  publishCaveats: ['No deployment was performed.', 'Re-run after source freeze; source changes invalidate the candidate.', 'Before any release independently recapture and verify live baseline hashes.', 'Vite preload list still preloads original chunk/CSS; importmap redirects actual dynamic import. Original entry and all runtime bytes remain untouched.', 'Offline SSR and static resolution smoke do not replace an authenticated local browser integration test or live post-deployment health checks.'],
};
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ success: true, jsName, cssName, preservedBytes: true, smoke, manifest: path.join(out, 'manifest.json') }, null, 2));
