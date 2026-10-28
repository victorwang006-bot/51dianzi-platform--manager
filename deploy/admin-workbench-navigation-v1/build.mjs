import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import { build, transform } from 'esbuild';

const root = path.dirname(new URL(import.meta.url).pathname);
const sourceRoot = path.resolve(root, '../../client/src');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const assert = (x, message) => { if (!x) throw new Error(message); };
const main = '/assets/51-ordering-information-a40a0c1191ff8253/index-BOdW8NbX.js';
const key = '/assets/51-ordering-information-a40a0c1191ff8253/DashboardLayout-D56MNqM7.js';
const html = fs.readFileSync(path.join(root, 'baseline/index.html'), 'utf8');
const maps = [...html.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>(.*?)<\/script>/gs)];
assert(maps.length === 1, 'One original import map required');
const imports = JSON.parse(maps[0][1]).imports;
const oldTarget = imports[key];
assert(oldTarget === '/assets/DashboardLayout-review-dialog-notice-9573ac1aa6f57a51.js', 'Unknown live layout');
const original = fs.readFileSync(path.join(root, 'baseline/DashboardLayout-live.js'), 'utf8');
const originalHash = hash(original);
const saved = [];
function save(prefix, bytes, extension = 'js') {
  const name = `${prefix}-${hash(bytes).slice(0, 16)}.${extension}`;
  fs.writeFileSync(path.join(out, name), bytes);
  saved.push({ name, sha256: hash(bytes), bytes: Buffer.byteLength(bytes) });
  return '/assets/' + name;
}
const bridges = {
  react: `import{r as R}from${JSON.stringify(main)};export const{useState,useEffect,useMemo,useRef,useCallback,useLayoutEffect}=R;export default R;`,
  'react/jsx-runtime': `import{j as J}from${JSON.stringify(main)};export const{jsx,jsxs,Fragment}=J;`,
};
const result = await build({
  entryPoints: [path.join(sourceRoot, 'components/admin/AdminWorkbenchNavigation.tsx')],
  bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2020', minify: true, jsx: 'automatic',
  plugins: [{ name: 'actual-admin-react', setup(b) {
    b.onResolve({ filter: /^(react|react\/jsx-runtime)$/ }, x => ({ path: x.path, namespace: 'live' }));
    b.onLoad({ filter: /.*/, namespace: 'live' }, x => ({ contents: bridges[x.path], loader: 'js' }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
  } }],
  external: [main],
});
assert(result.outputFiles.length === 1, 'One self-contained navigation runtime required');
const runtime = save('AdminWorkbenchNavigation', result.outputFiles[0].contents);
const cssPath = path.join(sourceRoot, 'components/admin/AdminWorkbenchNavigation.css');
const css = await transform(fs.readFileSync(cssPath, 'utf8'), { loader: 'css', minify: true });
const stylesheet = save('AdminWorkbenchNavigation', css.code, 'css');
const sf = ts.createSourceFile('live.js', original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const edits = [];
function replace(node, text, reason) { edits.push({ start: node.getStart(sf), end: node.end, text, reason }); }
let nav = null;
function find(node) {
  if (ts.isCallExpression(node) && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
    const loc = node.arguments[1].properties.find(x => ts.isPropertyAssignment(x) && x.name.getText(sf) === '"data-loc"');
    if (loc?.initializer.text === 'client/src/components/DashboardLayout.tsx:391') { assert(!nav, 'Duplicate nav'); nav = node; }
  }
  node.forEachChild(find);
}
find(sf);
assert(nav && nav.expression.getText(sf) === 'n.jsx', 'Original sidebar content missing');
const children = nav.arguments[1].properties.find(x => ts.isPropertyAssignment(x) && x.name.getText(sf) === 'children');
assert(children && children.initializer.expression.getText(sf) === 'It.map', 'Unrecognized original grouping');
let itemMap;
function findItem(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map' &&
      ts.isCallExpression(node.expression.expression) && node.expression.expression.expression.getText(sf) === 'j.items.filter') {
    assert(!itemMap, 'Duplicate menu render callback'); itemMap = node;
  }
  node.forEachChild(findItem);
}
findItem(children.initializer);
assert(itemMap && itemMap.arguments.length === 1, 'Original item rendering missing');
const renderer = itemMap.arguments[0].getText(sf);
const permissionFilter = itemMap.expression.expression.arguments[0].getText(sf);
assert(permissionFilter === 'x=>me(D,x.permission,_)', 'Permission filter changed');
assert(renderer.includes('P.mutate') && renderer.includes('ze(x.chunk)') && renderer.includes('pendingCount'), 'Notification/preload callbacks not preserved');
let layoutFunction = nav;
while (layoutFunction && !ts.isFunctionDeclaration(layoutFunction)) layoutFunction = layoutFunction.parent;
const body = layoutFunction.getText(sf);
assert(body.includes('user:o') && body.includes('[r,l]=sa()') && body.includes('m=c==="collapsed"') && body.includes('b=Rt()'), 'Unknown actual context variables');
replace(children.initializer, `n.jsx(__D51WorkbenchNav,{key:String(o?.id??"anonymous"),items:It.flatMap(__group=>__group.items).filter(${permissionFilter}),renderItem:${renderer},location:r,accountId:o?.id??"anonymous",collapsed:m&&!b})`, 'replace grouping wrapper only; exact original item callback retained');
let widthCount = 0;
function width(node) {
  if (ts.isVariableDeclaration(node) && node.initializer && ts.isNumericLiteral(node.initializer) && node.initializer.text === '240') {
    replace(node.initializer, '220', 'new default width; preserve existing local saved width'); widthCount++;
  }
  node.forEachChild(width);
}
width(sf);
assert(widthCount === 1, 'Expected one sidebar default width');
edits.push({ start: 0, end: 0, text: `import{AdminWorkbenchNavigation as __D51WorkbenchNav}from${JSON.stringify(runtime)};\n`, reason: 'single shared React runtime navigation component' });
edits.sort((a, b) => b.start - a.start || b.end - a.end);
for (let i = 1; i < edits.length; i++) assert(edits[i].end <= edits[i - 1].start, 'Overlapping edits');
let modified = original;
for (const edit of edits) modified = modified.slice(0, edit.start) + edit.text + modified.slice(edit.end);
assert(modified.includes(renderer), 'Original render callback altered');
assert(modified.includes(permissionFilter), 'Original permission filter altered');
const parsed = ts.createSourceFile('candidate.js', modified, 99, true, 1);
assert(parsed.parseDiagnostics.length === 0, 'Invalid candidate JS');
const layout = save('DashboardLayout-workbench-navigation', modified);
const cssTag = `<link rel="stylesheet" href="${stylesheet}" data-admin-workbench-navigation="v1" />`;
assert(html.includes('</head>') && html.split(oldTarget).length === 2 && !html.includes('data-admin-workbench-navigation'), 'Original HTML not suitable');
const after = html.replace(oldTarget, layout).replace('</head>', cssTag + '\n</head>');
const mapAfter = JSON.parse([...after.matchAll(/<script\b[^>]*type=["']importmap["'][^>]*>(.*?)<\/script>/gs)][0][1]);
assert(JSON.stringify(mapAfter.imports) === JSON.stringify({ ...imports, [key]: layout }), 'Other module map changed');
assert(after.replace(cssTag + '\n', '').replace(layout, oldTarget) === html, 'HTML outside approved changes altered');
fs.writeFileSync(path.join(out, 'index.html'), after);
const manifest = {
  schema: 'admin-workbench-navigation-v1', files: saved, key, oldTarget, layout, runtime, stylesheet, cssTag,
  oldHtmlSha256: hash(html), newHtmlSha256: hash(after), oldLayoutSha256: originalHash,
  unchangedOriginalItemRendererSha256: hash(renderer), unchangedOriginalPermissionFilter: permissionFilter,
  edits: edits.map(e => ({ start: e.start, end: e.end, reason: e.reason })),
  exactHtmlOnlyOneMapKeyAndOneStyleTag: true,
  scope: 'left sidebar only; no API/database/service/Nginx/right-page changes; no Zhijie business',
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));
