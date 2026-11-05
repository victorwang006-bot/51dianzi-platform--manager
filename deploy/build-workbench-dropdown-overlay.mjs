#!/usr/bin/env node
/** Offline only: compile the approved navigation, never touch live files. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import ts from 'typescript';
import postcss from 'postcss';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.dirname(repo);
const base = path.join(workspace, 'baseline');
const out = path.join(workspace, 'navigation-overlay');
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const baseline = {
  'index.html': 'f0db887956a41a3c1cb2457a4d65fb9b1156a2592bc923696bf7640f8dad764a',
  'DashboardLayout-QH4rPiOH.js': 'ca65eef2f6708d0848e1919ed092d872a22584ef710e108f9901348d6177b94b',
  'DashboardLayout-C5vzw2Fu.css': 'a06dc0fa661904578bed190f0b1fe12e98fa6e477c4da4f00cebd393ed2b430c',
  'index-CG0lkwm6.js': '602034896c9cb13cf9ad805dc07aae113ea907cb4291cff09189398f2c727bd8',
  'index-C0vPar7R.css': '871768387861545514e30d482d34a3cf7a15a0f783bde72c998ab89e2863b5d2',
};
const text = {};
for (const [name, digest] of Object.entries(baseline)) {
  const b = await fs.readFile(path.join(base, name));
  assert.equal(sha(b), digest, `baseline drift: ${name}`);
  text[name] = b.toString('utf8');
}
const parse = (name, s) => {
  const a = ts.createSourceFile(name, s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(a.parseDiagnostics.length, 0, `invalid JS ${name}`); return a;
};
const walk = (n, fn) => { fn(n); ts.forEachChild(n, c => walk(c, fn)); };
const one = (items, label) => { assert.equal(items.length, 1, `unique ${label}`); return items[0]; };
const liveText = text['DashboardLayout-QH4rPiOH.js'];
const ast = parse('DashboardLayout.js', liveText);
const functions = ast.statements.filter(ts.isFunctionDeclaration);
const top = one(functions.filter(n => n.getText(ast).includes('"workspace-tabs"')), 'WorkspaceTabs');
const modules = one(functions.filter(n => n.getText(ast).includes('"module-tabs"')), 'ModuleTabs');
const shell = one(functions.filter(n => n.getText(ast).includes('"top-two-level-v1"')), 'DashboardLayoutContent');
assert.equal(top.name.text, 'uo'); assert.equal(modules.name.text, 'lo');
const liveImports = one(ast.statements.filter(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === './index-CG0lkwm6.js'), 'entry import');
const imports = Object.fromEntries(liveImports.importClause.namedBindings.elements.map(n => [(n.propertyName ?? n.name).text, n.name.text]));
const aliases = { React: imports.r, jsx: imports.j, state: imports.ae, target: imports.af, groups: imports.ag };
assert.deepEqual(aliases, { React: 'c', jsx: 'o', state: 'Ze', target: 'Xt', groups: 'Qt' });
let zone;
walk(top, n => { if (ts.isPropertyAssignment(n) && ts.isStringLiteral(n.name) && n.name.text === 'data-display-time-zone') zone = n.initializer.getText(ast); });
assert.equal(zone, 'ce');
let calls = [];
walk(shell, n => {
  if (ts.isCallExpression(n) && n.expression.getText(ast) === `${aliases.jsx}.jsx` && n.arguments[0]?.getText(ast) === modules.name.text) calls.push(n);
});
const moduleCall = one(calls, 'shell module call');
const props = Object.fromEntries(moduleCall.arguments[1].properties.filter(ts.isPropertyAssignment).map(n => [(n.name.text ?? n.name.getText(ast)), n.initializer.getText(ast)]));
assert.equal(props.items, 'N'); assert.equal(props.location, 'a');
const nativeSource = path.join(repo, 'client/src/components/admin/AdminWorkspaceNavigation.tsx');
const cssSource = path.join(repo, 'client/src/components/admin/AdminWorkspaceNavigation.css');
const cssOld = execFileSync('git', ['show', 'd921f31ae62d66d3633477069fa47e91710ec6d7:client/src/components/admin/AdminWorkspaceNavigation.css'], { cwd: repo, encoding: 'utf8' });
const cssCurrent = await fs.readFile(cssSource, 'utf8');
assert.ok(cssCurrent.startsWith(cssOld), 'old navigation CSS must remain byte-identical');
const css = cssCurrent.slice(cssOld.length);
assert.ok(css.length > 300, 'new scoped panel CSS missing');
const cssAst = postcss.parse(css);
cssAst.walkRules(rule => assert.ok(rule.selector.split(',').every(s => s.trim().startsWith('.admin-workspace-nav__')), `unscoped CSS ${rule.selector}`));
cssAst.walkDecls(decl => {
  assert.ok(!decl.prop.startsWith('--'), 'no global design variable changes');
  assert.ok(!['zoom'].includes(decl.prop), 'no page zoom');
});
const reactNames = ['Children','Component','Fragment','StrictMode','Suspense','act','cloneElement','createContext','createElement','createRef','forwardRef','isValidElement','lazy','memo','startTransition','use','useCallback','useContext','useDebugValue','useDeferredValue','useEffect','useId','useImperativeHandle','useInsertionEffect','useLayoutEffect','useMemo','useReducer','useRef','useState','useSyncExternalStore','useTransition','version'];
const virtual = {
  react: `const R=__nav_live.React; export default R; ${reactNames.map(n => `export const ${n}=R.${n};`).join('\n')}`,
  jsx: 'export const jsx=__nav_live.jsx.jsx; export const jsxs=__nav_live.jsx.jsxs; export const Fragment=__nav_live.jsx.Fragment;',
  model: 'export const getAdminWorkspaceNavigationState=__nav_live.state; export const getAdminWorkspaceNavigationTarget=__nav_live.target; export const groupAdminBusinessNavigationItems=__nav_live.groups;',
  time: 'export const BEIJING_TIME_ZONE=__nav_live.zone;',
};
const readSources = new Map();
const plugin = { name: 'preserve-live-navigation-runtime', setup(build) {
  build.onResolve({ filter: /.*/ }, args => {
    if (args.path === 'react') return { path: 'react', namespace: 'nav-live' };
    if (args.path === 'react/jsx-runtime') return { path: 'jsx', namespace: 'nav-live' };
    if (args.path === './adminWorkspaceNavigationModel') return { path: 'model', namespace: 'nav-live' };
    if (args.path === '@shared/beijingTime') return { path: 'time', namespace: 'nav-live' };
    if (/\.css$/.test(args.path)) return { path: 'css', namespace: 'nav-empty' };
    if (args.path.startsWith('react-dom') || args.path.startsWith('@tanstack') || args.path.startsWith('@trpc') || args.path === 'wouter') throw Error(`unbridged runtime ${args.path}`);
  });
  build.onLoad({ filter: /.*/, namespace: 'nav-live' }, args => ({ contents: virtual[args.path], loader: 'js' }));
  build.onLoad({ filter: /.*/, namespace: 'nav-empty' }, () => ({ contents: '', loader: 'js' }));
  build.onLoad({ filter: /\.[jt]sx?$/, namespace: 'file' }, async args => {
    const contents = await fs.readFile(args.path, 'utf8'); readSources.set(args.path, sha(contents));
    return { contents, loader: args.path.endsWith('.tsx') ? 'tsx' : args.path.endsWith('.ts') ? 'ts' : 'js' };
  });
} };
const result = await esbuild.build({
  absWorkingDir: repo, stdin: { contents: `export {WorkspaceTabs} from ${JSON.stringify(nativeSource)};`, resolveDir: repo, sourcefile: 'navigation-approved-entry.ts', loader: 'ts' },
  bundle: true, write: false, format: 'iife', globalName: '__nav_exports', target: 'es2020', platform: 'browser', minify: true,
  legalComments: 'none', metafile: true, plugins: [plugin], jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
});
assert.equal(result.outputFiles.length, 1);
assert.ok(Object.keys(result.metafile.inputs).every(s => !s.includes('node_modules') && !s.includes('/server/')), 'runtime/server bundle forbidden');
const factory = `(function(__nav_live){${result.outputFiles[0].text}\nreturn __nav_exports;})`;
const binding = '__workbench_dropdown_navigation_v1';
assert.ok(!liveText.includes(binding), 'binding collision');
const args = `{React:${aliases.React},jsx:${aliases.jsx},state:${aliases.state},target:${aliases.target},groups:${aliases.groups},zone:${zone}}`;
const replacement = `const ${binding}=${factory}(${args});\nfunction ${top.name.text}(props){return ${aliases.React}.createElement(${binding}.WorkspaceTabs,props);}`;
const moduleReplacement = `(${aliases.state}(${props.items},${props.location}).route?.workspaceId!=="business"?${moduleCall.getText(ast)}:null)`;
const changes = [
  { start: top.getStart(ast), end: top.end, old: top.getText(ast), replacement },
  { start: moduleCall.getStart(ast), end: moduleCall.end, old: moduleCall.getText(ast), replacement: moduleReplacement },
].sort((a,b) => a.start-b.start);
let cursor = 0, candidate = '';
for (const c of changes) { candidate += liveText.slice(cursor, c.start) + c.replacement; c.newStart = candidate.length-c.replacement.length; c.newEnd = candidate.length; cursor=c.end; }
candidate += liveText.slice(cursor);
const candidateAst = parse('navigation-candidate.js', candidate);
let restored = candidate;
for (const c of [...changes].reverse()) restored = restored.slice(0,c.newStart)+c.old+restored.slice(c.newEnd);
assert.equal(restored, liveText, 'non-navigation chunk bytes changed');
const importsExports = tree => tree.statements.filter(n => ts.isImportDeclaration(n)||ts.isExportDeclaration(n)).map(n=>n.getText(tree));
assert.deepEqual(importsExports(ast), importsExports(candidateAst), 'imports/exports changed');
for (const [source, hash] of readSources) assert.equal(sha(await fs.readFile(source)), hash, 'source changed during build');
assert.equal(await fs.readFile(cssSource,'utf8'), cssCurrent, 'CSS changed during build');
const jsHash=sha(candidate),cssHash=sha(css);
const jsName=`DashboardLayout-workbench-dropdown-${jsHash.slice(0,16)}.js`;
const cssName=`workbench-dropdown-${cssHash.slice(0,16)}.css`;
const html=text['index.html'];
const maps=[...html.matchAll(/<script type="importmap">([\s\S]*?)<\/script>/g)];
const originalMap=one(maps,'existing importmap');
const map=JSON.parse(originalMap[1]);
const mapKey='/assets/DashboardLayout-QH4rPiOH.js';
assert.ok(!Object.hasOwn(map.imports,mapKey),'new map key already exists');
assert.equal(map.imports['/assets/BusinessWorkbenchPage-DZYOmou-.js'],'/assets/BusinessWorkbenchPage-ci-management-948d4fff464c76cf.js','latest channel inventory overlay must remain');
map.imports[mapKey]='/assets/'+jsName;
const newMap=`<script type="importmap">${JSON.stringify(map)}</script>`;
let candidateHtml=html.replace(originalMap[0],newMap);
const insertion=`<!-- workbench-dropdown-nav-v1:start -->\n<link rel="stylesheet" href="/assets/${cssName}">\n<!-- workbench-dropdown-nav-v1:end -->\n`;
const moduleTag=one([...candidateHtml.matchAll(/<script type="module"[^>]*src="\/assets\/index-CG0lkwm6\.js"[^>]*>/g)],'existing main module');
candidateHtml=candidateHtml.slice(0,moduleTag.index)+insertion+candidateHtml.slice(moduleTag.index);
assert.equal(candidateHtml.replace(insertion,'').replace(newMap,originalMap[0]),html,'unrelated HTML changed');
await fs.mkdir(out,{recursive:true});
await fs.writeFile(path.join(out,jsName),candidate);
await fs.writeFile(path.join(out,cssName),css);
await fs.writeFile(path.join(out,'candidate-index.html'),candidateHtml);
await fs.writeFile(path.join(out,'factory-expression.js'),factory);
const manifest={
  schemaVersion:1,release:'20261105-workbench-dropdown-nav-v2',generatedAt:new Date().toISOString(),sourceBase:'d921f31ae62d66d3633477069fa47e91710ec6d7',
  baseline,outputs:{js:{name:jsName,sha256:jsHash,bytes:Buffer.byteLength(candidate)},css:{name:cssName,sha256:cssHash,bytes:Buffer.byteLength(css)},html:{name:'candidate-index.html',sha256:sha(candidateHtml)}},
  changes:changes.map(({start,end,newStart,newEnd,old,replacement})=>({start,end,newStart,newEnd,oldSha256:sha(old),replacementSha256:sha(replacement)})),
  aliases,importMapKey:mapKey,previousChannelInventoryOverlayPreserved:true,importsExportsUnchanged:true,allOtherChunkBytesPreserved:true,allOtherHtmlBytesPreserved:true,oldCssBytesPreserved:true,
  noRuntimeOrServerDependencies:true,sourceFiles:[...readSources].map(([name,sha256])=>({name,sha256})),cssSource:{name:cssSource,sha256:sha(cssCurrent)},
};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({ok:true,outputs:manifest.outputs,changes:manifest.changes.length,inventoryOverlayPreserved:true,noRuntimeOrServerDependencies:true}));
