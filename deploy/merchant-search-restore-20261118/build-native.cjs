#!/usr/bin/env node
'use strict';
// Offline candidate generation only. No Git, networking, database, browser or deployment.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const deps = process.env.MERCHANT_RESTORE_DEPS || '/home/ubuntu/diagnosis/fixrepo/node_modules';
const ts = require(path.join(deps, 'typescript'));
const EXPECTED = Object.freeze({
  current: '0a68c4c2b545c6d6b08cbbc795b538a003e69dc2fb1d5ae0799146f8204afc65',
  before: 'a095fae8f8a06b3601176d9132891619d137f296db8b5c2f941d3cac0ca1d6dc',
  css: '9890c0b19003a01cac0f379fd7ca781112b19ee71a68d0f717ca8032f17ceca1',
  html: 'a02a6cb6a770aec14680930766f76b054ede00e3b3a4e2473fb0534c24993e00',
  source: '86451e5f9e5254d721555ff52c576db5c8e6d76d446b65a2a8469d168ddaaa9d',
});
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function parse(s, filename = 'native.js', kind = ts.ScriptKind.JS) {
  const ast = ts.createSourceFile(filename, s, ts.ScriptTarget.Latest, true, kind);
  assert.equal(ast.parseDiagnostics.length, 0, `AST parse errors: ${filename}`); return ast;
}
function walk(n, fn) { fn(n); ts.forEachChild(n, c => walk(c, fn)); }
function func(ast, name) { const f = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert(f, name); return f; }
function property(n, name) { return n?.properties?.find(p => ts.isPropertyAssignment(p) && (p.name.text === name)); }
function byClass(root, ast, cls) {
  const found = []; walk(root, n => { if (ts.isCallExpression(n) && /^a\.jsx/.test(n.expression.getText(ast))) {
    const p = property(n.arguments[1], 'className'); if (p && p.initializer.getText(ast) === JSON.stringify(cls)) found.push(n);
  }}); assert.equal(found.length, 1, `unique class ${cls}`); return found[0];
}
function restorePatches(candidate, changes) {
  let s = candidate;
  for (const p of [...changes].sort((a,b) => b.afterStart-a.afterStart)) {
    assert.equal(s.slice(p.afterStart, p.afterEnd), p.after); s = s.slice(0,p.afterStart)+p.before+s.slice(p.afterEnd);
  } return s;
}
function patch(original, changes) {
  const sorted = [...changes].sort((a,b) => a.start-b.start); let offset = 0, cursor = 0, out = '';
  for (const p of sorted) {
    assert(p.start >= cursor); assert.equal(original.slice(p.start,p.end),p.before);
    out += original.slice(cursor,p.start)+p.after;
    p.afterStart=p.start+offset; p.afterEnd=p.afterStart+p.after.length;
    p.beforeByteStart=Buffer.byteLength(original.slice(0,p.start)); p.beforeByteEnd=Buffer.byteLength(original.slice(0,p.end));
    offset+=p.after.length-p.before.length; cursor=p.end;
  } out += original.slice(cursor); assert.equal(restorePatches(out, sorted),original,'exact inverse'); return {out,changes:sorted};
}
function generate(inputs) {
  const read = (filename, key) => { const bytes=fs.readFileSync(filename); assert.equal(sha(bytes),EXPECTED[key],`fresh local CAS ${key}`); return bytes.toString('utf8'); };
  const current=read(inputs.current,'current'), before=read(inputs.before,'before'), css=read(inputs.css,'css'), html=read(inputs.html,'html'), source=read(inputs.source,'source');
  const a=parse(current), old=parse(before); parse(source,'SearchPage.tsx',ts.ScriptKind.TSX);
  // Keep true/self expressions verbatim. Only these three native JSX nodes change.
  const changes=[];
  for (const cls of ['item-qtycol','item-action']) {
    const node=byClass(func(a,'r1'),a,cls), legacy=byClass(func(old,'r1'),old,cls);
    changes.push({label:`row:${cls}`,start:node.getStart(a),end:node.end,before:node.getText(a),after:`(e.isSelfOperated===true?${node.getText(a)}:${legacy.getText(old)})`});
  }
  const grid=byClass(func(a,'K1'),a,'grid-card'), legacyGrid=byClass(func(old,'K1'),old,'grid-card');
  changes.push({label:'grid:article',start:grid.getStart(a),end:grid.end,before:grid.getText(a),after:`(i.isSelfOperated===true?${grid.getText(a)}:${legacyGrid.getText(old)})`});
  const js=patch(current,changes); parse(js.out);
  assert.equal(func(parse(js.out),'__OfficialSearchRoute').getText(),func(a,'__OfficialSearchRoute').getText(),'official wrapper verbatim');
  assert.deepEqual(a.statements.filter(ts.isImportDeclaration).map(n=>n.getText(a)),parse(js.out).statements.filter(ts.isImportDeclaration).map(n=>n.getText()),'imports verbatim');
  // Scope ONLY the known appended mall CSS. Leave original page inline CSS untouched.
  const scopedCss=css.replaceAll('.result-grid:has(.inventory-purchase-actions)', '.result-grid:has(> .grid-card > .self-operated-badge):not(:has(> .grid-card > :first-child:not(.self-operated-badge)))').replaceAll('.item-card', '.item-card:has(> .self-operated-media)');
  const jsName=`SearchPage-merchant-restore-${sha(js.out).slice(0,16)}.js`, cssName=`SearchPage-merchant-scope-${sha(scopedCss).slice(0,16)}.css`;
  const oldJsUrl='/assets/SearchPage-official-mall-native-v10-0a68c4c2b545c6d6.js', oldCssUrl='/assets/SearchPage-self-operated-v7-9890c0b19003a01c.css';
  const replacements=[{from:oldJsUrl,to:`/assets/${jsName}`,count:13},{from:oldCssUrl,to:`/assets/${cssName}`,count:1}];
  let newHtml=html; for(const r of replacements) { assert.equal(newHtml.split(r.from).length-1,r.count,'exact HTML reference count'); newHtml=newHtml.split(r.from).join(r.to); }
  let inverseHtml=newHtml; for(const r of replacements) inverseHtml=inverseHtml.split(r.to).join(r.from); assert.equal(inverseHtml,html,'HTML exact inverse');
  fs.mkdirSync(inputs.out,{recursive:true,mode:0o700});
  for(const [name,s] of [[jsName,js.out],[cssName,scopedCss],['index.html',newHtml]])fs.writeFileSync(path.join(inputs.out,name),s,{mode:0o600});
  const manifest={schema:1,scope:'ordinary-merchant-only; offline candidate; no apply',baseline:EXPECTED,output:{js:{file:jsName,sha256:sha(js.out)},css:{file:cssName,sha256:sha(scopedCss)},html:{file:'index.html',sha256:sha(newHtml)}},sourceSha256:sha(source),nativeChanges:js.changes,htmlReplacements:replacements,invariants:{exactInverse:true,officialWrapperVerbatim:true,importsVerbatim:true,originalInlineCssVerbatim:true,unmodifiedOutsideThreeJsxNodes:true},caveats:['Specified old native row has cart in quantity column and chat/QQ in action column; buy position is an empty Fragment. Do not fabricate a Buy Now button.','Mixed grids keep old shared grid tracks; the new auto-fill sizing is restricted to all-self grids. Official Catalog is unchanged.']};
  fs.writeFileSync(path.join(inputs.out,'manifest.private.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({output:manifest.output,sourceSha256:manifest.sourceSha256,invariants:manifest.invariants},null,2)); return manifest;
}
module.exports={generate,parse,func,walk,byClass,property,restorePatches,patch,sha,EXPECTED,ts};
if(require.main===module){
  const [assets,html,source,out]=process.argv.slice(2); if(!out)throw Error('Usage: node build-native.cjs ASSETS CURRENT_HTML SOURCE OUT (offline only)');
  generate({current:path.join(assets,'current-search.js'),before:path.join(assets,'before-merchant-search.js'),css:path.join(assets,'current-search-additional.css'),html,source,out});
}
