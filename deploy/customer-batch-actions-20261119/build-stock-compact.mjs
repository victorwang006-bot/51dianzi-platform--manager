#!/usr/bin/env node
/** Current native assets only: two stock leaves + additive scoped CSS, no runtime entry execution. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as esbuild from 'esbuild';
import postcss from 'postcss';
import { common, inventory } from '../upload-manage-20261119/native-abi.mjs';
import { H, parse, nodes, one, declarations, noLoads, noFreeIdentifiers, inverseDelta, htmlDelta } from '../upload-manage-20261119/build-support.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.env.CUSTOMER_STOCK_BASE;
const OUT = process.env.CUSTOMER_STOCK_OUT;
assert(BASE && OUT, 'explicit current baseline and new output required');
assert(!fs.existsSync(OUT), 'fresh output required');
const C = 'client/src/business/platform/client/src/components/customers/';
const parent = { ...common, useId: 'go', useLayoutEffect: 'Ev', trpc: 'St', businessIndustryCodeSchema: 'dn', CustomerSupplyUploadDialog: 'jf', CustomerUploadHistoryDialog: 'fk', useCustomerSupplyAuthority: 'Cv', CustomerChannelInventory: 'mk', withCustomerContactScope: 'Jg', errorMessage: 'Qr' };
const specs = [
  { name: 'CustomerWorkbenchSupply', native: 'bk', file: C + 'CustomerWorkbenchSupply.tsx', bindings: parent },
  { name: 'CustomerChannelInventory', native: 'mk', file: C + 'CustomerChannelInventory.tsx', bindings: inventory },
];
function put(name, data) { const p = path.join(OUT, name); fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); fs.writeFileSync(p, data); }
function json(name, data) { put(name, JSON.stringify(data, null, 2) + '\n'); }
async function compile(spec) {
  const source = fs.readFileSync(path.join(ROOT, spec.file), 'utf8');
  const transformed = await esbuild.transform(source, { loader: 'tsx', jsx: 'automatic', format: 'esm', target: 'es2020', minify: false });
  const ast = parse(transformed.code, spec.file);
  const leaf = one(ast.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === spec.name), spec.name).getText(ast).replace(/^export\s+/, '');
  const aliases = Object.entries(spec.bindings).filter(([a,b]) => a !== b).map(([a,b]) => `${a}=${b}`).join(',');
  const wrapper = `function ${spec.native}(props){\nconst ${aliases};\n${leaf}\nreturn ${spec.name}(props);\n}`;
  noLoads(wrapper); noFreeIdentifiers(wrapper, spec.bindings);
  return { ...spec, wrapper, sourceSha256: H(source), compiledSha256: H(leaf) };
}
function scope(ast) {
  const history = one(nodes(ast, n => ts.isFunctionDeclaration(n) && n.name?.text === 'z3' && n.getText(ast).includes('customerUploadHistoryGet.query')), 'existing native history');
  const block = history.parent; assert(ts.isBlock(block));
  let owner = block; while (owner && !ts.isVariableDeclaration(owner)) owner = owner.parent;
  assert.equal(owner?.name?.getText(ast), '__CHANNEL_REFERENCE_HOST_EXPORTS'); return block;
}
function splitSelectors(text) {
  let depth = 0, start = 0; const out = [];
  for (let i = 0; i < text.length; i++) {
    if ('(['.includes(text[i])) depth++;
    if (')]'.includes(text[i])) depth--;
    if (text[i] === ',' && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  assert.equal(depth, 0); out.push(text.slice(start).trim()); return out;
}
function cssDelta(file, marker) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
  assert.equal(text.split(marker).length, 2, 'single explicit compact CSS delta marker');
  const delta = marker + text.split(marker)[1];
  const ast = postcss.parse(delta);
  ast.walkAtRules(n => assert.equal(n.name, 'media', 'no import/font/global new CSS'));
  ast.walkRules(n => {
    for (const selector of splitSelectors(n.selector)) assert(
      /^\.customer-channel-inventory(?=[\s.:#\[>+~]|$)/.test(selector) ||
      /^\.customer-stock-workbench(?=[\s.:#\[>+~]|$)/.test(selector) ||
      /^\.customer-supply-dialog(?=[\s.:#\[>+~]|$)/.test(selector) ||
      /^\.erp-ui\.customer-workbench \.customer-(stock-workbench|workbench-top-buttons)(?=[\s.:#\[>+~]|$)/.test(selector),
      'customer-only CSS: ' + selector);
  });
  assert(!/url\s*\(|@import|!\s*important\s*[^;}]*url/i.test(delta), 'no new asset loads');
  return { delta, sourceSha256: H(text), file };
}
const beforeHtml = fs.readFileSync(path.join(BASE, 'admin-index.html'));
const names = [...new Set(beforeHtml.toString().match(/assets\/BusinessWorkbenchPage-customer-batch-[a-f0-9]+\.js/g))].map(n => path.basename(n)).sort();
assert.equal(names.length, 2, 'two current referenced stock modules');
const compiled = await Promise.all(specs.map(compile)); const modules = [];
for (const name of names) {
  const bytes = fs.readFileSync(path.join(BASE, 'assets', name)); assert(H(bytes).startsWith(name.match(/([a-f0-9]+)\.js$/)[1]));
  const before = bytes.toString('utf8'); assert(Buffer.from(before).equals(bytes));
  const ast = parse(before, name), decls = declarations(scope(ast)), hunks = [], abi = {};
  for (const item of compiled) {
    const native = one(decls.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === item.native), item.native);
    for (const [key, name] of Object.entries(item.bindings)) {
      const binding = one(decls.filter(n => n.name?.getText(ast) === name), key + '=' + name);
      abi[key] = { native: name, sha256: H(binding.getText(ast)), head: binding.getText(ast).slice(0, 180) };
    }
    hunks.push({ name: item.native + '/' + item.name, start: native.getStart(ast), end: native.end, old: native.getText(ast), replacement: item.wrapper });
  }
  assert.equal(abi.React.head, 'Ct=__customerLive.React'); assert.equal(abi.trpc.head, 'St=__customerLive.bridge_0_trpc');
  const { after, records } = inverseDelta(before, hunks); const sha256 = H(after), relative = `assets/BusinessWorkbenchPage-customer-batch-${sha256.slice(0,16)}.js`;
  put('package/' + relative, after); json('package/evidence/' + name + '.delta.json', { input: 'assets/' + name, output: relative, beforeSha256: H(bytes), afterSha256: sha256, patches: records, inverseVerified: true, allBytesOutsideCustomerFunctionsUnchanged: true });
  json('package/evidence/' + name + '.abi.json', abi); modules.push({ before: 'assets/' + name, after: relative, sha256, size: Buffer.byteLength(after) });
}
const cssNames = [...new Set(beforeHtml.toString().match(/assets\/customer-batch-actions-[a-f0-9]+\.css/g))]; assert.equal(cssNames.length, 1);
const oldCss = fs.readFileSync(path.join(BASE, cssNames[0])); assert(H(oldCss).startsWith(cssNames[0].match(/([a-f0-9]+)\.css$/)[1]));
const deltas = [cssDelta(C + 'CustomerChannelInventory.css', '/* Confirmed compact customer stock treatment; no global shell or other modules. */'), cssDelta(C + 'CustomerSupplyUploadDialog.css', '/* Compact upload chrome; review/failed-row large-table sizing remains native. */')];
const css = Buffer.from(deltas.map(d => d.delta).join('\n'));
const cssRelative = `assets/customer-batch-actions-${H(css).slice(0,16)}.css`; put('package/' + cssRelative, css);
const html = htmlDelta(beforeHtml, modules, cssRelative);
assert(html.after.includes(Buffer.from('/' + cssNames[0])), 'original CSS link retained byte-exact');
put('package/before-index.html', beforeHtml); put('package/after-index.html', html.after);
const assets = modules.map(m => ({ relative: m.after, sha256: m.sha256, size: m.size })).concat({ relative: cssRelative, sha256: H(css), size: css.length });
json('modules.json', modules); json('assets.json', assets); json('replacements.json', modules.map(m => ({ before: '/' + m.before, after: '/' + m.after })));
json('package/evidence/html.json', { beforeSha256: H(beforeHtml), afterSha256: H(html.after), counts: html.counts, link: html.link, inverseVerified: true });
json('package/evidence/source-files.json', { sourceHashes: Object.fromEntries([...compiled.map(c => [c.file,c.sourceSha256]), ...deltas.map(d => [d.file,d.sourceSha256])]), sourceStableDuringBuild: true, embeddedFailuresIncluded: true, compiler: 'esbuild.transform', esbuildVersion: esbuild.version, builderSha256: H(fs.readFileSync(fileURLToPath(import.meta.url))) });
json('package/evidence/sources.json', compiled.map(({file,name,native,sourceSha256,compiledSha256}) => ({file,name,native,sourceSha256,compiledSha256})));
for (const c of [...compiled, ...deltas]) assert.equal(H(fs.readFileSync(path.join(ROOT,c.file))), c.sourceSha256);
console.log(JSON.stringify({ status: 'OFFLINE_NATIVE_STOCK_CANDIDATE_NOT_DEPLOYED', modules, assets }, null, 2));
