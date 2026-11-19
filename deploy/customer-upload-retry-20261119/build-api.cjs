#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ts = require('typescript');
const esbuild = require('esbuild');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const parse = (name, text, kind = ts.ScriptKind.JS) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kind);
function nodes(root, match) { const found = []; function visit(n) { if (match(n)) found.push(n); ts.forEachChild(n, visit); } visit(root); return found; }
function one(values, label) { assert.equal(values.length, 1, label); return values[0]; }
function moduleTable(ast) { return nodes(ast, n => ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isExportAssignment(n) || ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword).map(n => n.getText(ast)); }
function owner(ast, name) { return one(nodes(ast, n => ts.isFunctionDeclaration(n) && n.name?.text === name), name); }
function build({ baseline, source, out }) {
  assert(!fs.existsSync(out), 'output must be new');
  const beforeBytes = fs.readFileSync(baseline), before = beforeBytes.toString('utf8');
  assert(Buffer.from(before).equals(beforeBytes), 'valid UTF8 baseline');
  const native = parse('front-index.js', before);
  const parserFile = path.join(source, 'client/src/business/platform/front-router-types/server/services/customerUploadPrivateStorage.ts');
  const historyFile = path.join(source, 'client/src/business/platform/front-router-types/server/services/customerUploadHistory.ts');
  const parserText = fs.readFileSync(parserFile, 'utf8'), historyText = fs.readFileSync(historyFile, 'utf8');
  const parser = parse(parserFile, parserText, ts.ScriptKind.TS), history = parse(historyFile, historyText, ts.ScriptKind.TS);
  const edits = [];
  const zipOwner = owner(native, 'checkedZip');
  const oldFlags = one(nodes(zipOwner, n => ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandToken && n.left.getText(native) === 'flags' && n.right.getText(native) === '~2056'), 'native restrictive flag check');
  const srcZip = owner(parser, 'checkedZip');
  const allowedDecl = one(nodes(srcZip, n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(parser) === 'allowedFlags')), 'source conditional allowedFlags');
  const allowedSource = allowedDecl.getText(parser);
  assert(allowedSource.includes('method === 8') && allowedSource.includes('0x0006'), 'DEFLATE-only flags');
  const compiled = esbuild.transformSync(allowedSource, { loader: 'ts', target: 'es2022', charset: 'utf8', minify: false, treeShaking: false }).code.trim();
  let condition = oldFlags; while (condition && !ts.isIfStatement(condition)) condition = condition.parent;
  assert(condition && condition.parent, 'native direct guard');
  assert(!nodes(zipOwner, n => ts.isVariableDeclaration(n) && n.name.getText(native) === 'allowedFlags').length, 'no binding collision');
  edits.push({ id: 'deflate-allowed-flags-declaration', owner: 'checkedZip', start: condition.getStart(native), end: condition.getStart(native), replacement: compiled + '\n    ' });
  edits.push({ id: 'deflate-options-condition', owner: 'checkedZip', start: oldFlags.getStart(native), end: oldFlags.end, replacement: 'flags & ~allowedFlags' });
  const nativeHistory = owner(native, 'createCustomerUploadHistoryService');
  const append = owner(nativeHistory, 'appendFile');
  const oldTry = one(nodes(append, n => ts.isTryStatement(n) && n.tryBlock.getText(native).includes('inspectCustomerUploadFile(input)')), 'native original inspection refusal');
  const srcAppend = owner(owner(history, 'createCustomerUploadHistoryService'), 'appendFile');
  const newTry = one(nodes(srcAppend, n => ts.isTryStatement(n) && n.tryBlock.getText(history).includes('inspectCustomerUploadFile(input)')), 'source original inspection refusal');
  const refusalInput = newTry.getText(history);
  assert(refusalInput.includes('原文件未保存：') && refusalInput.includes('kind === "original"'), 'original-only explicit refusal');
  const refusal = esbuild.transformSync(refusalInput, { loader: 'ts', target: 'es2022', charset: 'utf8', minify: false, treeShaking: false }).code.trim();
  edits.push({ id: 'original-inspection-refusal', owner: 'createCustomerUploadHistoryService.appendFile', start: oldTry.getStart(native), end: oldTry.end, replacement: refusal });
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < edits.length; i++) assert(edits[i].start >= edits[i - 1].end, 'non-overlap');
  let after = '', pos = 0;
  const partitions = [];
  for (const edit of edits) { const unchanged = before.slice(pos, edit.start); after += unchanged; partitions.push({ sha256: sha(unchanged), bytes: Buffer.byteLength(unchanged) }); edit.old = before.slice(edit.start, edit.end); edit.newStart = after.length; after += edit.replacement; edit.newEnd = after.length; pos = edit.end; }
  after += before.slice(pos); partitions.push({ sha256: sha(before.slice(pos)), bytes: Buffer.byteLength(before.slice(pos)) });
  let restored = after; for (const edit of [...edits].reverse()) restored = restored.slice(0, edit.newStart) + edit.old + restored.slice(edit.newEnd);
  assert.equal(restored, before, 'full byte inverse');
  const candidate = parse('candidate-index.js', after);
  assert.equal(candidate.parseDiagnostics.length, 0, 'candidate syntax');
  assert.deepEqual(moduleTable(candidate), moduleTable(native), 'unchanged module table');
  assert.equal(nodes(candidate, n => ts.isIdentifier(n) && n.text === 'allowedFlags').length, 2, 'declaration and sole guard reference');
  // Namespace additions by the other task must survive byte-for-byte.
  for (const name of ['officialMaterial', 'officialMaterialRouter', 'createOfficialMaterialRouter']) {
    for (const node of nodes(native, n => ts.isFunctionDeclaration(n) && n.name?.text === name)) {
      assert(after.includes(node.getText(native)), 'preserve other-task owner ' + name);
    }
  }
  fs.mkdirSync(out, { recursive: false, mode: 0o700 });
  fs.writeFileSync(path.join(out, 'front-index.js'), after);
  const proof = { scope: 'customer-upload-retry-20261119-api', baselineSha256: sha(beforeBytes), afterSha256: sha(after), sourceHashes: { [path.relative(source, parserFile)]: sha(parserText), [path.relative(source, historyFile)]: sha(historyText) }, sourceFragments: { allowedSource, refusalInput }, edits, partitions, inverseByteIdentical: true, moduleTableUnchanged: true, changedOwners: ['checkedZip', 'createCustomerUploadHistoryService.appendFile'], noAdminApiChanges: true, noDatabaseChanges: true };
  fs.writeFileSync(path.join(out, 'api-proof.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'BUILT_NOT_DEPLOYED', baselineSha256: proof.baselineSha256, afterSha256: proof.afterSha256, edits: edits.length, out }));
  return proof;
}
module.exports = { build, parse, nodes, owner, sha };
if (require.main === module) {
  const args = {}; for (let i = 2; i < process.argv.length; i += 2) { assert(process.argv[i].startsWith('--')); args[process.argv[i].slice(2)] = path.resolve(process.argv[i + 1]); }
  try { build(args); } catch (error) { console.error('BUILD_BLOCKED', error.message); process.exitCode = 1; }
}
