#!/usr/bin/env node
'use strict';
// Offline leaf compiler. No bundle build, network, process reload, DB, Git or CSS writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ts = require('typescript');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '../..');
const BASE = '/home/ubuntu/customer-upload-fix/baseline';
const OLD = '/home/ubuntu/customer-debug/51dianzi-platform--manager/victorwang006-bot-51dianzi-platform--manager-a424d15';
const P = 'client/src/business/platform/client/src/components/customers/';
const PREFIX = '__customerUploadRetry20261119_';
const HELPER_NAMES = ['ORIGINAL_NOT_SAVED_PREFIX', 'requestUUID', 'sameLock', 'readOriginalLock', 'saveOriginalLock', 'clearOriginalLock', 'isOriginalNotSavedResponse', 'releasedRejections', 'originalNotSavedAfterRelease', 'isReleasedOriginalRejection'];
const GLOBALS = new Set(['Array', 'Uint8Array', 'crypto', 'TextEncoder', 'Error', 'JSON', 'Number', 'Object', 'Promise', 'WeakSet', 'sessionStorage', 'undefined', 'Boolean', 'Math', 'Set', 'Map']);
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const read = f => fs.readFileSync(f, 'utf8');
function parse(text, name = 'native.js', kind = ts.ScriptKind.JS) {
  const a = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kind);
  assert.equal(a.parseDiagnostics.length, 0, 'Syntax: ' + name); return a;
}
function nodes(root, predicate) {
  const out = []; function visit(n) { if (predicate(n)) out.push(n); ts.forEachChild(n, visit); } visit(root); return out;
}
function one(list, label) { assert.equal(list.length, 1, label + ': observed ' + list.length); return list[0]; }
function owner(n) { for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p; return null; }
function declarationOwner(n) { for (let p = n; p; p = p.parent) if (ts.isFunctionDeclaration(p)) return p; return null; }
function prop(n, name) { return one(n.properties.filter(p => p.name?.text === name), 'property ' + name); }
function variable(root, name) { return one(nodes(root, n => ts.isVariableDeclaration(n) && n.name.text === name), 'variable ' + name); }
function getFunction(a, name) { return one(nodes(a, n => ts.isFunctionDeclaration(n) && n.name?.text === name), 'function ' + name); }
function moduleTable(text) {
  const a = parse(text); return nodes(a, n => ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isExportAssignment(n)
    || ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword).map(n => n.getText(a));
}
function specifiers(text) {
  const a = parse(text); return [...new Set(nodes(a, n => (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier
    || ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword).map(n => {
    const s = n.moduleSpecifier || n.arguments[0]; assert(ts.isStringLiteral(s), 'Nonliteral dependency'); return s.text;
  }))];
}
function edit(a, n, after, reason, target) { return { start: n.getStart(a), end: n.end, before: n.getText(a), after, reason, target }; }
function insertion(start, after, reason, target) { return { start, end: start, before: '', after, reason, target }; }
function delta(before, edits, label) {
  const input = Buffer.isBuffer(before) ? before : Buffer.from(before); const text = input.toString('utf8');
  assert(input.equals(Buffer.from(text)), 'UTF8 round-trip ' + label);
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let shift = 0, cursor = 0, newCursor = 0; const partitions = [];
  const records = sorted.map((e, i) => {
    assert(e.start >= 0 && e.end >= e.start && e.end <= text.length, 'Interval ' + label);
    assert.equal(text.slice(e.start, e.end), e.before, 'Preimage ' + e.reason);
    if (i) assert(sorted[i - 1].end <= e.start && !(sorted[i - 1].start === e.start && sorted[i - 1].end === e.end), 'Non-overlap required');
    const byteStart = Buffer.byteLength(text.slice(0, e.start)), byteEnd = Buffer.byteLength(text.slice(0, e.end));
    const old = Buffer.from(e.before), next = Buffer.from(e.after), newByteStart = byteStart + shift;
    partitions.push({ byteStart: cursor, byteEnd: byteStart, newByteStart: newCursor, newByteEnd: newByteStart,
      sha256: sha(input.subarray(cursor, byteStart)) });
    cursor = byteEnd; newCursor = newByteStart + next.length; shift += next.length - old.length;
    return { ...e, byteStart, byteEnd, newByteStart, newByteEnd: newByteStart + next.length,
      oldSha256: sha(old), newSha256: sha(next), oldBase64: old.toString('base64'), newBase64: next.toString('base64') };
  });
  let candidate = input;
  for (const e of [...records].reverse()) candidate = Buffer.concat([candidate.subarray(0, e.byteStart), Buffer.from(e.newBase64, 'base64'), candidate.subarray(e.byteEnd)]);
  partitions.push({ byteStart: cursor, byteEnd: input.length, newByteStart: newCursor, newByteEnd: candidate.length, sha256: sha(input.subarray(cursor)) });
  let inverse = candidate;
  for (const e of [...records].reverse()) {
    assert(inverse.subarray(e.newByteStart, e.newByteEnd).equals(Buffer.from(e.newBase64, 'base64')), 'Inverse preimage');
    inverse = Buffer.concat([inverse.subarray(0, e.newByteStart), Buffer.from(e.oldBase64, 'base64'), inverse.subarray(e.newByteEnd)]);
  }
  assert(inverse.equals(input), 'Whole-file byte inverse ' + label);
  for (const p of partitions) assert(input.subarray(p.byteStart, p.byteEnd).equals(candidate.subarray(p.newByteStart, p.newByteEnd)), 'Outside partition equality');
  return { after: candidate.toString('utf8'), edits: records, partitions, beforeSha256: sha(input), afterSha256: sha(candidate), inverseVerified: true, outsidePartitionsIdentical: true };
}
// References only; property names are never renamed. Handles shorthand keys explicitly.
function isReference(n) {
  if (!ts.isIdentifier(n)) return false; const p = n.parent;
  return !(ts.isPropertyAccessExpression(p) && p.name === n || ts.isPropertyAssignment(p) && p.name === n
    || ts.isMethodDeclaration(p) && p.name === n || ts.isLabeledStatement(p) && p.label === n);
}
function adapt(code, map) {
  const a = parse(code); return delta(code, nodes(a, n => isReference(n) && Object.hasOwn(map, n.text) && map[n.text] !== n.text)
    .map(n => edit(a, n, ts.isShorthandPropertyAssignment(n.parent) ? n.text + ':' + map[n.text] : map[n.text], 'exact identifier ABI')), 'ABI').after;
}
// Local symbol binding is used only on small extracted leaves, never to execute the bundle.
function freeNames(code) {
  const file = '/offline-leaf.js', a = parse(code, file);
  const host = { getSourceFile: f => f === file ? a : undefined, getDefaultLibFileName: () => '', writeFile() {},
    getCurrentDirectory: () => '/', getDirectories: () => [], fileExists: f => f === file, readFile: f => f === file ? code : undefined,
    getCanonicalFileName: f => f, useCaseSensitiveFileNames: () => true, getNewLine: () => '\n' };
  const checker = ts.createProgram([file], { allowJs: true, noLib: true, noResolve: true, target: 99 }, host).getTypeChecker();
  return [...new Set(nodes(a, isReference).filter(n => {
    const symbol = ts.isShorthandPropertyAssignment(n.parent) ? checker.getShorthandAssignmentValueSymbol(n.parent) : checker.getSymbolAtLocation(n);
    return !symbol || !(symbol.declarations || []).some(d => d.getSourceFile() === a);
  }).map(n => n.text))].sort();
}
function compile(code, loader = 'ts', minify = false) {
  return esbuild.transformSync(code, { loader, target: 'es2020', jsx: 'automatic', format: 'esm', minify,
    legalComments: 'none', sourcemap: false }).code;
}
// Full old-source/native structural matching: ignore only parentheses and const/let
// grouping. All operators, keys, literals, calls, control flow and property access survive.
function structural(n) {
  if (ts.isParenthesizedExpression(n)) return structural(n.expression);
  if (ts.isIdentifier(n)) return [isReference(n) ? 'id' : 'key', n.text];
  if (ts.isStringLiteralLike(n)) return ['string', n.text];
  if (ts.isNumericLiteral(n)) return ['number', Number(n.text)];
  if (ts.isBlock(n)) {
    const r = []; for (const s of n.statements) {
      if (ts.isVariableStatement(s)) { if (r.at(-1)?.[0] !== 'vars') r.push(['vars']); r.at(-1).push(...s.declarationList.declarations.map(structural)); }
      else r.push(structural(s));
    } return ['block', ...r];
  }
  const children = []; ts.forEachChild(n, c => { children.push(structural(c)); }); return [n.kind, ...children];
}
function align(oldNode, nativeNode, label) {
  const map = {};
  function match(a, b, where) {
    if (!Array.isArray(a) || !Array.isArray(b)) { assert.equal(a, b, 'Old/native AST ' + label + ' ' + where); return; }
    if (a[0] === 'id' && b[0] === 'id') {
      if (Object.hasOwn(map, a[1])) assert.equal(map[a[1]], b[1], 'Binding conflict ' + label + ': ' + a[1]);
      map[a[1]] = b[1]; return;
    }
    assert.equal(a.length, b.length, 'Old/native AST arity ' + label + ' ' + where);
    for (let i = 0; i < a.length; i++) match(a[i], b[i], where + '/' + i);
  }
  match(structural(oldNode), structural(nativeNode), 'root'); return map;
}
function sourceBundle(source = ROOT, oldSource = OLD) {
  const files = ['CustomerSupplyUploadDialog.tsx', 'CustomerParseUpload.tsx', 'customerUploadOriginalLock.ts'];
  const sourceSHA = Object.fromEntries(files.map(f => [P + f, sha(read(path.join(source, P, f)))]));
  const oldSourceSHA = Object.fromEntries(files.slice(0, 2).map(f => [P + f, sha(read(path.join(oldSource, P, f)))]));
  const sessionAst = parse(compile(read(path.join(source, P, files[0])), 'tsx'));
  const session = getFunction(sessionAst, 'CustomerSupplyUploadSession');
  const send = variable(session, 'sendOriginal').initializer.getText(sessionAst);
  const persist = variable(session, 'persistOriginal').initializer.getText(sessionAst);
  const cache = one(nodes(session, n => ts.isPropertyAssignment(n) && n.name?.text === 'onOriginalFilePersist'), 'source cache callback').initializer.getText(sessionAst);
  const parseAst = parse(compile(read(path.join(source, P, files[1])), 'tsx'));
  const parseFunction = getFunction(parseAst, 'CustomerParseUpload').getText(parseAst).replace(/^export\s+/, '');
  const helperText = read(path.join(source, P, files[2])), helperAst = parse(helperText, files[2], ts.ScriptKind.TS);
  assert.equal(nodes(helperAst, ts.isImportDeclaration).length, 0, 'Helper must have no imports');
  const helper = compile(helperText).replace(/^export\s*\{[^}]*\};?\s*$/gm, '').replace(/^export\s+/gm, '');
  const ha = parse(helper), declarations = ha.statements.flatMap(s => ts.isFunctionDeclaration(s) ? [s.name.text]
    : ts.isVariableStatement(s) ? s.declarationList.declarations.map(d => d.name.text) : []);
  assert.deepEqual(declarations.sort(), [...HELPER_NAMES].sort(), 'Only dedicated customer-original helper declarations');
  assert.deepEqual(freeNames(helper).filter(n => !GLOBALS.has(n)), [], 'Helper must be self-contained and side-effect-free outside its own state');
  assert(!/\b(?:fetch|XMLHttpRequest|require|import|document|window|eval|trpc|React)\b/.test(helper), 'Helper cannot import/capture business infrastructure');
  const oldText = read(path.join(oldSource, P, files[0])), oldAst = parse(oldText, 'old.tsx', ts.ScriptKind.TSX);
  const oldSession = getFunction(oldAst, 'CustomerSupplyUploadSession');
  const oldPersist = variable(oldSession, 'persistOriginal');
  const oldPersistCode = compile('const persistOriginal=' + oldPersist.initializer.getText(oldAst) + ';', 'ts', true);
  const oldCache = one(nodes(oldSession, n => ts.isJsxAttribute(n) && n.name.text === 'onOriginalFilePersist'), 'old source cache');
  const oldCacheCode = compile('const cache=' + oldCache.initializer.expression.getText(oldAst) + ';', 'ts', true);
  return { source: path.resolve(source), oldSource: path.resolve(oldSource), sourceSHA, oldSourceSHA, send, persist, cache, parseFunction, helper,
    helperMap: Object.fromEntries(HELPER_NAMES.map(n => [n, PREFIX + n])), oldPersistCode, oldCacheCode,
    compiledSHA: { send: sha(send), persist: sha(persist), cache: sha(cache), parse: sha(parseFunction), helper: sha(helper) } };
}
function lexicalBinding(n, name, a) {
  for (let scope = n.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isFunctionLike(scope)) continue;
    if (ts.isFunctionLike(scope)) { const p = scope.parameters?.find(p => p.name.text === name); if (p) return { name, start: p.getStart(a), end: p.end, sha256: sha(p.getText(a)), kind: 'parameter' }; }
    const statements = scope.statements; if (!statements) continue;
    const ds = statements.flatMap(s => ts.isVariableStatement(s) ? [...s.declarationList.declarations] : ts.isFunctionDeclaration(s) ? [s] : ts.isImportDeclaration(s) ? nodes(s, ts.isImportSpecifier) : []);
    const found = ds.filter(d => d.name?.text === name || d.name && (ts.isArrayBindingPattern(d.name) || ts.isObjectBindingPattern(d.name))
      && nodes(d.name, x => ts.isBindingElement(x) && x.name.text === name).length > 0);
    if (found.length) { const d = one(found, 'lexical declaration ' + name); return { name, start: d.getStart(a), end: d.end, sha256: sha(d.getText(a)), kind: ts.SyntaxKind[d.kind] }; }
  }
  if (GLOBALS.has(name)) return { name, kind: 'existing browser global' };
  throw Error('Missing existing lexical native ABI binding: ' + name);
}
function directVariables(fn) { return nodes(fn, n => ts.isVariableDeclaration(n) && owner(n) === fn); }
function locate(a) {
  const mutations = nodes(a, n => ts.isCallExpression(n) && n.expression.getText(a).endsWith('.customerUploadOriginal.mutate'));
  assert(mutations.length > 0, 'No original-upload mutation evidence');
  const sessions = [...new Set(mutations.map(declarationOwner))]; assert(sessions.every(Boolean), 'Mutation must belong to function declaration');
  const parses = [...new Set(nodes(a, n => ts.isStringLiteral(n) && n.text === 'customer-parse-upload').map(declarationOwner))];
  assert(parses.length > 0 && parses.every(Boolean), 'No customer parse instance evidence');
  const pairs = sessions.map(session => {
    const calls = nodes(session, n => ts.isCallExpression(n) && n.expression.getText(a).endsWith('.customerUploadOriginal.mutate'));
    const mutation = one(calls, 'one original-upload mutation per session');
    const original = owner(mutation); assert(ts.isArrowFunction(original), 'Existing original-upload arrow');
    const originalDecl = original.parent; assert(ts.isVariableDeclaration(originalDecl), 'Existing original operation declaration');
    const cacheProperty = one(nodes(session, n => ts.isPropertyAssignment(n) && n.name?.text === 'onOriginalFilePersist'), 'native customer-only cache callback');
    const render = one(nodes(session, n => ts.isPropertyAssignment(n) && n.name?.text === 'renderParseEntry'), 'native parse render callback');
    const jsx = one(nodes(render.initializer, n => ts.isCallExpression(n) && n.arguments.length >= 2 && ts.isObjectLiteralExpression(n.arguments[1])), 'parse JSX invocation');
    assert(ts.isIdentifier(jsx.arguments[0]), 'Native parse binding must be identifier');
    const parse = one(parses.filter(p => p.name.text === jsx.arguments[0].text && p.parent === session.parent), 'parse declaration in exact same lexical block');
    const persistName = prop(jsx.arguments[1], 'persistOriginal').initializer.getText(a);
    if (originalDecl.name.text.startsWith(PREFIX)) {
      const wrapper = one(directVariables(session).filter(d => d.name.text === persistName), 'candidate real persist wrapper');
      assert(nodes(wrapper.initializer, n => ts.isCallExpression(n) && n.expression.getText(a) === originalDecl.name.text).length === 1, 'Live parse wrapper calls exact native send leaf');
    } else assert.equal(persistName, originalDecl.name.text, 'Live parse uses real original function');
    const wrappers = nodes(session.parent, n => ts.isFunctionDeclaration(n) && n.parent === session.parent && n !== session
      && nodes(n, x => ts.isCallExpression(x) && x.arguments[0]?.getText(a) === session.name.text).length > 0);
    assert(wrappers.length > 0, 'Session must have a real JSX caller in this owner');
    const chain = []; for (let n = session.parent; n; n = n.parent) if (ts.isFunctionLike(n)) chain.push({ name: n.name?.text || '(arrow)', start: n.getStart(a), end: n.end });
    assert(chain.some(n => n.name === '__CW_CUSTOMER_GET'), 'Actual customer getter ancestry required');
    return { session, parse, mutation, original, originalDecl, cache: cacheProperty.initializer, render, wrappers, chain };
  });
  assert.equal(new Set(pairs.map(p => p.parse)).size, parses.length, 'All actual parse instances covered exactly once');
  assert.equal(pairs.length, mutations.length, 'All actual original-upload instances covered exactly once');
  return pairs;
}
function planBundle(before, source, label) {
  assert(!before.includes(PREFIX), 'Already patched or helper namespace collision');
  const a = parse(before, label), pairs = locate(a), edits = [], instances = [], helperOwners = new Set();
  for (let index = 0; index < pairs.length; index++) {
    const p = pairs[index], oldPA = parse(source.oldPersistCode), oldCA = parse(source.oldCacheCode);
    const oldP = one(oldPA.statements[0].declarationList.declarations, 'old original compiled declaration').initializer;
    const oldC = one(oldCA.statements[0].declarationList.declarations, 'old cache compiled declaration').initializer;
    const aligned = align(oldP, p.original, 'entire original leaf');
    const cacheAligned = align(oldC, p.cache, 'entire standard cache leaf');
    const sourceFree = freeNames(source.oldPersistCode);
    const abi = Object.fromEntries(sourceFree.map(n => { assert(aligned[n], 'Unmapped original capture ' + n); if (GLOBALS.has(n)) assert.equal(aligned[n], n, 'Global ABI drift'); return [n, aligned[n]]; }));
    for (const n of freeNames(source.oldCacheCode)) {
      assert(cacheAligned[n], 'Unmapped cache capture ' + n);
      if (abi[n]) assert.equal(abi[n], cacheAligned[n], 'Original/cache ABI conflict ' + n);
      else abi[n] = cacheAligned[n];
    }
    const vs = directVariables(p.session), nativeContext = one(vs.filter(d => ts.isArrayBindingPattern(d.name) && d.name.elements[0]?.name?.text
      && p.session.getText(a).includes(d.name.elements[0].name.text + '.customer.name')), 'existing context state');
    const contextName = nativeContext.name.elements[0].name.text;
    const contextRef = one(vs.filter(d => ts.isCallExpression(d.initializer) && d.initializer.arguments[0]?.getText(a) === contextName), 'contextRef hook');
    abi.contextRef = contextRef.name.text;
    const operationRef = one(vs.filter(d => d.name.text === abi.originalOperation), 'original operation hook');
    assert(ts.isCallExpression(operationRef.initializer) && ts.isIdentifier(operationRef.initializer.expression), 'Existing native useRef');
    abi.useRef = operationRef.initializer.expression.text;
    const suffix = index + '_' + p.session.getStart(a);
    abi.originalInFlight = PREFIX + 'inFlight_' + suffix; abi.sendOriginal = PREFIX + 'send_' + suffix;
    const nativePersistName = p.originalDecl.name.text; abi.persistOriginal = nativePersistName;
    const sendCode = adapt('const __leaf=' + source.send + ';', { ...abi, ...source.helperMap });
    const persistCode = adapt('const __leaf=' + source.persist + ';', { ...abi, ...source.helperMap });
    const cacheCode = adapt('const __leaf=' + source.cache + ';', { ...abi, ...source.helperMap });
    const expression = code => variable(parse(code), '__leaf').initializer.getText(parse(code));
    const send = expression(sendCode), persist = expression(persistCode), cache = expression(cacheCode);
    for (const code of [sendCode, persistCode, cacheCode]) for (const n of freeNames(code)) assert(GLOBALS.has(n) || Object.values(abi).includes(n) || Object.values(source.helperMap).includes(n), 'New unbound capture ' + n);
    const bindings = Object.fromEntries(Object.entries(abi).filter(([n]) => !['originalInFlight', 'sendOriginal'].includes(n)).map(([n, value]) => [n, lexicalBinding(p.original, value, a)]));
    edits.push(insertion(p.originalDecl.getStart(a), abi.originalInFlight + '=' + abi.useRef + '(null),' + abi.sendOriginal + '=' + send + ',', 'add dedicated single-flight ref and source send arrow only', p.session.name.text));
    edits.push(edit(a, p.original, persist, 'replace original-upload arrow with source same-request single-flight wrapper', p.session.name.text));
    edits.push(edit(a, p.cache, cache, 'only customer standard File/history cached callback', p.session.name.text));
    // Parse free variables are resolved from concrete hook/JSX call sites, including
    // pre-existing local aliases inside one of the currently deployed parse functions.
    const pv = directVariables(p.parse), alias = name => {
      const d = pv.filter(d => d.name.text === name && ts.isIdentifier(d.initializer)); return d.length ? one(d, 'parse ABI alias').initializer.text : name;
    };
    const state = one(pv.filter(d => ts.isArrayBindingPattern(d.name) && d.initializer?.arguments?.[0]?.kind === ts.SyntaxKind.NullKeyword).slice(0, 1), 'parse file useState');
    const ref = one(pv.filter(d => ts.isCallExpression(d.initializer) && d.initializer.arguments[0]?.getText(a) === '!0').slice(0, 1), 'parse mounted useRef');
    const effect = one(nodes(p.parse, n => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.arguments.length === 2
      && ts.isArrowFunction(n.arguments[0]) && ts.isArrayLiteralExpression(n.arguments[1]) && !n.arguments[1].elements.length), 'parse mount useEffect');
    const section = one(nodes(p.parse, n => ts.isCallExpression(n) && n.arguments[0]?.text === 'section'), 'parse section JSX');
    const strong = one(nodes(p.parse, n => ts.isCallExpression(n) && n.arguments[0]?.text === 'strong'), 'parse strong JSX');
    const buttons = nodes(p.parse, n => ts.isCallExpression(n) && n.arguments.length >= 2 && ts.isIdentifier(n.arguments[0]) && ts.isObjectLiteralExpression(n.arguments[1])
      && n.arguments[1].properties.some(x => x.name?.text === 'onClick'));
    assert(buttons.length > 0, 'parse native Button evidence');
    const parsePersist = one(nodes(p.parse, n => ts.isCallExpression(n) && n.expression.getText(a).endsWith('.persistOriginal')), 'parse submit evidence');
    const submit = owner(parsePersist);
    const validator = one(nodes(submit, n => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.arguments.length === 1
      && n.arguments[0].getText(a) === parsePersist.arguments[0].getText(a)), 'parse native file validator');
    const details = one(nodes(p.session, n => ts.isPropertyAssignment(n) && n.name?.text === 'renderConfirmationDetails'), 'Fragment ABI witness');
    const fragment = one(nodes(details.initializer, n => ts.isCallExpression(n) && n.arguments.length >= 2 && ts.isIdentifier(n.arguments[0]) && ts.isObjectLiteralExpression(n.arguments[1])
      && n === details.initializer.body), 'native fragment JSX').arguments[0].text;
    const parseABI = { useState: alias(state.initializer.expression.text), useRef: alias(ref.initializer.expression.text), useEffect: alias(effect.expression.text),
      validateFile: alias(validator.expression.text), Button: alias(buttons[0].arguments[0].text), jsx: alias(strong.expression.text), jsxs: alias(section.expression.text), Fragment: fragment,
      CustomerParseUpload: p.parse.name.text };
    const parseReplacement = adapt(source.parseFunction, { ...parseABI, ...source.helperMap });
    for (const n of freeNames(parseReplacement)) assert(GLOBALS.has(n) || Object.values(parseABI).includes(n) || Object.values(source.helperMap).includes(n), 'Unbound parse ABI ' + n);
    const parseBindings = Object.fromEntries(Object.entries(parseABI).filter(([n]) => n !== 'CustomerParseUpload').map(([n, value]) => [n, lexicalBinding(p.parse, value, a)]));
    edits.push(edit(a, p.parse, parseReplacement, 'source-only customer parse function; original live React/JSX/Button/validator', p.parse.name.text));
    if (!helperOwners.has(p.session.parent)) {
      helperOwners.add(p.session.parent);
      edits.push(insertion(p.parse.getStart(a), adapt(source.helper, source.helperMap) + '\n', 'dedicated import-free customer-original helper declarations only', 'customerUploadOriginalLock.ts'));
    }
    instances.push({ index, session: p.session.name.text, sessionStart: p.session.getStart(a), sessionEnd: p.session.end,
      parse: p.parse.name.text, parseStart: p.parse.getStart(a), parseEnd: p.parse.end, ownerChain: p.chain,
      callers: p.wrappers.map(n => ({ name: n.name.text, start: n.getStart(a), end: n.end, sha256: sha(n.getText(a)) })),
      mutationStart: p.mutation.getStart(a), mutationSHA: sha(p.mutation.getText(a)), oldSourceNativeASTMatched: true,
      ABI: abi, ABIBindings: bindings, parseABI, parseABIBindings: parseBindings,
      models: { send, persist, cache, parse: parseReplacement, inFlight: abi.originalInFlight, sendName: abi.sendOriginal,
        persistName: nativePersistName, helper: adapt(source.helper, source.helperMap) } });
  }
  const result = delta(before, edits, label); parse(result.after, label + '-candidate');
  const beforeTable = moduleTable(before), afterTable = moduleTable(result.after);
  assert.deepEqual(afterTable, beforeTable, 'Exact import/export/static/dynamic table');
  const afterPairs = locate(parse(result.after));
  assert.equal(afterPairs.length, pairs.length, 'Actual candidate coverage');
  // locate() sees the new send arrow, while render persistOriginal names the wrapper.
  return { ...result, instances, counts: { sessions: pairs.length, parses: pairs.length, helperOwners: helperOwners.size },
    moduleTable: beforeTable, moduleTableSHA: sha(JSON.stringify(beforeTable)), cssChanged: false };
}
function importMap(html) {
  const m = one([...html.matchAll(/<script\b[^>]*\btype=["']importmap["'][^>]*>([\s\S]*?)<\/script>/g)], 'one importmap');
  return { text: m[1], map: JSON.parse(m[1]), start: m.index + m[0].indexOf(m[1]) };
}
const ORIGIN = 'https://offline.invalid';
const urlLike = s => /^(?:\.|\/|https?:)/.test(s);
const absolute = s => new URL(s, ORIGIN + '/').href;
function resolve(spec, from, map) {
  const key = urlLike(spec) ? new URL(spec, absolute(from)).href : spec;
  const tables = Object.keys(map.scopes || {}).filter(s => absolute(from).startsWith(absolute(s))).sort((a, b) => absolute(b).length - absolute(a).length).map(s => map.scopes[s]);
  tables.push(map.imports || {});
  for (const table of tables) for (const name of Object.keys(table).sort((a, b) => b.length - a.length)) {
    const normalized = urlLike(name) ? absolute(name) : name;
    if (key === normalized) return table[name];
    if (name.endsWith('/') && key.startsWith(normalized)) { assert(table[name].endsWith('/')); return table[name] + key.slice(normalized.length); }
  }
  assert(urlLike(spec), 'Unresolved bare import ' + spec); const u = new URL(key); return u.origin === ORIGIN ? u.pathname + u.search + u.hash : u.href;
}
function finishHTML(before, relocations, planned) {
  const im = importMap(before), a = ts.parseJsonText('importmap.json', im.text), edits = [], hits = {};
  assert.equal(a.parseDiagnostics.length, 0, 'Importmap JSON syntax');
  for (const n of nodes(a, n => ts.isPropertyAssignment(n) && ts.isStringLiteral(n.initializer) && Object.hasOwn(relocations, n.initializer.text))) {
    hits[n.initializer.text] = (hits[n.initializer.text] || 0) + 1;
    edits.push({ ...edit(a, n.initializer, JSON.stringify(relocations[n.initializer.text]), 'only exact oldURL JSON STRING VALUE'),
      start: im.start + n.initializer.getStart(a), end: im.start + n.initializer.end });
  }
  const scopes = prop(a.statements[0].expression, 'scopes').initializer, clones = [];
  for (const [from, to] of Object.entries(relocations)) {
    assert(hits[from] > 0, 'Effective URL value must exist'); assert(Object.hasOwn(im.map.scopes, from), 'Current exactscope required');
    assert(!Object.hasOwn(im.map.scopes, to), 'Scope collision');
    const table = Object.fromEntries(Object.entries(im.map.scopes[from]).map(([k, v]) => [k, relocations[v] || v]));
    clones.push({ from, to, entries: Object.keys(table).length, table });
  }
  edits.push(insertion(im.start + scopes.end - 1, (scopes.properties.length ? ',' : '') + clones.map(c => JSON.stringify(c.to) + ':' + JSON.stringify(c.table)).join(','), 'clone existing exactscopes to new asset URLs; no old key changes'));
  const result = delta(before, edits, 'HTML'), next = importMap(result.after), dependencyChecks = [];
  assert.equal(before.slice(0, im.start), result.after.slice(0, next.start), 'Before-map bytes');
  assert.equal(before.slice(im.start + im.text.length), result.after.slice(next.start + next.text.length), 'After-map bytes');
  assert.deepEqual(Object.keys(next.map.imports), Object.keys(im.map.imports), 'Import keys unchanged');
  for (const [k, v] of Object.entries(im.map.imports)) assert.equal(next.map.imports[k], relocations[v] || v);
  for (const [scope, table] of Object.entries(im.map.scopes)) {
    assert.deepEqual(Object.keys(next.map.scopes[scope]), Object.keys(table), 'Old exactscope keys unchanged');
    for (const [k, v] of Object.entries(table)) assert.equal(next.map.scopes[scope][k], relocations[v] || v);
  }
  assert.deepEqual(Object.keys(next.map.scopes).sort(), [...Object.keys(im.map.scopes), ...clones.map(c => c.to)].sort(), 'Only exactscope clones added');
  for (const p of planned) for (const spec of specifiers(p.before)) {
    const old = resolve(spec, p.oldURL, im.map), current = resolve(spec, p.newURL, next.map);
    assert.equal(current, relocations[old] || old, 'Dependency resolution ' + spec);
    dependencyChecks.push({ oldURL: p.oldURL, newURL: p.newURL, specifier: spec, before: old, after: current });
  }
  return { ...result, valueReplacementCounts: hits, clones, dependencyChecks, outsideImportmapByteIdentical: true, oldKeysPreserved: true, cssChanged: false };
}
function baseline(options = {}) {
  const base = path.resolve(options.baseline || BASE);
  const htmlName = options.html || (fs.existsSync(path.join(base, 'admin-index.html')) ? 'admin-index.html' : 'index.html');
  assert(['admin-index.html', 'index.html'].includes(htmlName), 'HTML filename');
  const html = read(path.join(base, htmlName)), im = importMap(html);
  const urls = [...new Set(Object.values(im.map.imports).filter(s => typeof s === 'string' && /\/assets\/BusinessWorkbenchPage[^/]*\.js$/.test(s)))];
  assert(urls.length > 0, 'No active workbench URLs in real importmap');
  return { base, html, htmlName, records: urls.map(oldURL => {
    assert(/^\/assets\/[A-Za-z0-9._-]+\.js$/.test(oldURL), 'Safe asset URL');
    const before = read(base + oldURL), digest = sha(before);
    assert(oldURL.includes(digest.slice(0, 16)), 'Actual native content-hash mismatch: ' + oldURL);
    return { oldURL, before, beforeSha256: digest };
  }) };
}
function prepare(options = {}) {
  const source = sourceBundle(options.source || ROOT, options.oldSource || OLD), base = baseline(options);
  const planned = base.records.map(r => {
    const p = planBundle(r.before, source, r.oldURL);
    const newURL = '/assets/BusinessWorkbenchPage-customer-upload-retry-' + p.afterSha256.slice(0, 16) + '.js';
    assert(newURL !== r.oldURL); return { ...r, ...p, newURL };
  });
  const relocations = Object.fromEntries(planned.map(p => [p.oldURL, p.newURL]));
  assert.equal(new Set(Object.values(relocations)).size, planned.length, 'Distinct assets');
  const html = finishHTML(base.html, relocations, planned);
  for (const [f, h] of Object.entries(source.sourceSHA)) assert.equal(sha(read(path.join(source.source, f))), h, 'SOURCE_CHANGED_DURING_BUILD; wait for final freeze');
  return { source, base, planned, relocations, html };
}
function writePrivate(out, relative, data) {
  const file = path.join(out, relative); assert(!path.isAbsolute(relative) && !relative.split('/').includes('..'));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
function build(options = {}) {
  const prepared = prepare(options), { source, base, planned, relocations, html } = prepared;
  const summary = { status: 'OFFLINE_CANDIDATE_NOT_DEPLOYED', baseline: base.base, source: source.source, sourceSHA: source.sourceSHA,
    beforeHTMLSHA: sha(base.html), afterHTMLSHA: html.afterSha256, relocations, counts: planned.map(p => ({ oldURL: p.oldURL, ...p.counts })) };
  if (!options.out || options.dryRun) return { ...prepared, summary };
  const out = path.resolve(options.out); assert(!fs.existsSync(out), 'Fresh --out required; never overwrite');
  for (const protectedRoot of [source.source, source.oldSource, base.base]) assert(out !== protectedRoot && !out.startsWith(protectedRoot + '/'), 'Outputs outside repo/old-source/baseline required');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const assets = [];
  for (const p of planned) {
    const proof = 'proof/' + path.basename(p.oldURL) + '.json';
    writePrivate(out, 'candidate/' + p.newURL.slice(1), p.after);
    const { before, after, ...proofData } = p; writePrivate(out, proof, { ...proofData, sourceSHA: source.sourceSHA, helper: { names: source.helperMap, sha256: sha(source.helper), compiled: source.helper } });
    assets.push({ oldURL: p.oldURL, newURL: p.newURL, relative: p.newURL.slice(1), proof, beforeSha256: p.beforeSha256, afterSha256: p.afterSha256, bytes: Buffer.byteLength(p.after), counts: p.counts });
  }
  writePrivate(out, 'candidate/' + base.htmlName, html.after);
  const { after, ...htmlProof } = html; writePrivate(out, 'proof/html.json', htmlProof);
  writePrivate(out, 'manifest.json', { ...summary, schemaVersion: 1, offline: true, htmlName: base.htmlName, assets, htmlProof: 'proof/html.json',
    source: { root: source.source, oldRoot: source.oldSource, sourceSHA: source.sourceSHA, oldSourceSHA: source.oldSourceSHA, compiledSHA: source.compiledSHA },
    tools: { node: process.version, typescript: ts.version, esbuild: esbuild.version, buildSHA: sha(fs.readFileSync(__filename)), testSHA: sha(fs.readFileSync(path.join(__dirname, 'test-native.cjs'))) },
    checks: { inverseVerified: true, outsidePartitionsIdentical: true, moduleTablesUnchanged: true, onlyCustomerOriginalAndParse: true, noCSS: true, noWholeBuild: true,
      noNewProviderReactTrpcXlsxTransport: true, finalSourceFreezeRequired: true, freshCaptureAfterBackendVerificationRequired: true } });
  return { ...prepared, summary: { ...summary, out } };
}
function options(argv) {
  const o = {}, names = { '--baseline': 'baseline', '--source': 'source', '--old-source': 'oldSource', '--out': 'out', '--html': 'html' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') { o.dryRun = true; if (argv[i + 1] && !argv[i + 1].startsWith('--')) o.candidate = argv[++i]; }
    else { assert(names[argv[i]], 'Unknown argument ' + argv[i]); assert(argv[i + 1], 'Missing value'); o[names[argv[i]]] = argv[++i]; }
  } return o;
}
module.exports = { ROOT, BASE, OLD, P, PREFIX, GLOBALS, sha, read, parse, nodes, one, owner, getFunction, variable, prop, delta, adapt, freeNames, structural,
  align, sourceBundle, locate, planBundle, importMap, resolve, moduleTable, specifiers, finishHTML, baseline, prepare, build, options };
if (require.main === module) {
  (async () => {
    const o = options(process.argv.slice(2));
    if (o.candidate) { const r = await require('./test-native.cjs').checkCandidate(o.candidate, o); console.log(JSON.stringify(r, null, 2)); }
    else { const result = build(o); if (o.dryRun) result.summary.validation = await require('./test-native.cjs').checkPrepared(result); console.log(JSON.stringify(result.summary, null, 2)); }
  })().catch(e => { console.error('BLOCKED: ' + e.stack); process.exitCode = 1; });
}
