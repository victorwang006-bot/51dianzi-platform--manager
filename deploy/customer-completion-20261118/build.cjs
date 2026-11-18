#!/usr/bin/env node
'use strict';
// Offline only. Never executes the production bundle or imports its dependencies.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');
const esbuild = require('esbuild');
const REPO = path.resolve(__dirname, '../..');
const BASE = '/home/ubuntu/diagnosis/baseline';
const OUT = '/home/ubuntu/diagnosis/completion-candidate';
const PLATFORM = 'client/src/business/platform';
const EXPECTED_HTML = '955f15cdd3228abc810a7f12e8e122d945252b4c7cedaf2864423a890a62ac8d';
const EXPECTED_ACTIVE = 'd0f20b0bd088fb399573150170b354e73fb8f0d4d73a802d7e1bc036c5a77716';
const FACTORY = '__CC20261118Factory';
const LOCAL = '__cc20261118';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => fs.readFileSync(file, 'utf8');
const norm = value => value.replace(/\s+/g, '');
function parse(text, name = 'bundle.js', kind = ts.ScriptKind.JS) {
  const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, kind);
  assert.equal(ast.parseDiagnostics.length, 0, 'AST parse failed: ' + name);
  return ast;
}
function nodes(root, predicate) {
  const result = [];
  function visit(node) { if (predicate(node)) result.push(node); node.forEachChild(visit); }
  visit(root); return result;
}
function one(root, predicate, label) {
  const found = nodes(root, predicate);
  assert.equal(found.length, 1, label + ': expected exactly one AST node, got ' + found.length);
  return found[0];
}
function owner(node) {
  for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p;
  throw Error('Missing function owner');
}
function directNodes(fn, predicate) {
  return nodes(fn, predicate).filter(node => owner(node) === fn);
}
function queryCall(node, suffix, ast) {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && node.expression.getText(ast).endsWith('.customer.' + suffix + '.useQuery');
}
function queryVar(fn, suffix, ast) {
  return one(fn, node => ts.isVariableDeclaration(node) && node.initializer
    && queryCall(node.initializer, suffix, ast) && owner(node) === fn, suffix + ' native query');
}
function property(object, name) {
  assert(ts.isObjectLiteralExpression(object), 'Expected literal query options');
  return object.properties.find(p => p.name && (p.name.text || p.name.getText()) === name);
}
function queryOptions(call) {
  const candidate = call.arguments[1];
  if (ts.isObjectLiteralExpression(candidate)) return candidate;
  assert(ts.isCallExpression(candidate), 'Unexpected options wrapper');
  assert(ts.isObjectLiteralExpression(candidate.arguments[0]), 'Unexpected options argument');
  return candidate.arguments[0];
}
function moduleTable(text) {
  const ast = parse(text);
  return nodes(ast, node => ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
    || ts.isExportAssignment(node) || ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    .map(node => node.getText(ast));
}
function specifiers(text) {
  const ast = parse(text);
  return [...new Set(nodes(ast, node => (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
    || ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
    .map(node => node.moduleSpecifier || node.arguments[0]).map(node => {
      assert(ts.isStringLiteral(node), 'Nonliteral dependency requires review'); return node.text;
    }))];
}
function importMap(html) {
  const matches = [...html.matchAll(/<script\b[^>]*\btype=["']importmap["'][^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(matches.length, 1, 'Expected exactly one import map');
  const match = matches[0];
  return { text: match[1], map: JSON.parse(match[1]), start: match.index + match[0].indexOf(match[1]) };
}
// A synthetic origin is enough; no DNS/network request is made.
const ORIGIN = 'https://offline.invalid';
const urlLike = value => /^(?:\.|\/|https?:)/.test(value);
const absolute = value => new URL(value, ORIGIN + '/').href;
function resolve(spec, from, map) {
  const key = urlLike(spec) ? new URL(spec, ORIGIN + from).href : spec;
  const tables = Object.keys(map.scopes || {}).filter(scope => absolute(from).startsWith(absolute(scope)))
    .sort((a, b) => absolute(b).length - absolute(a).length).map(scope => map.scopes[scope]);
  tables.push(map.imports || {});
  for (const table of tables) {
    for (const name of Object.keys(table).sort((a, b) => b.length - a.length)) {
      const normalized = urlLike(name) ? absolute(name) : name;
      if (key === normalized) return table[name];
      if (name.endsWith('/') && key.startsWith(normalized)) {
        assert(table[name].endsWith('/'), 'Invalid import-map prefix target');
        return table[name] + key.slice(normalized.length);
      }
    }
  }
  if (!urlLike(spec)) throw Error('Unresolved bare dependency: ' + spec);
  const result = new URL(key);
  return result.origin === ORIGIN ? result.pathname + result.search + result.hash : result.href;
}
function applyEdits(before, edits, label) {
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < edits.length; i++) {
    const e = edits[i];
    assert(e.start >= 0 && e.end >= e.start && e.end <= before.length, 'Bad interval');
    assert.equal(before.slice(e.start, e.end), e.before, 'Old bytes mismatch: ' + e.reason);
    if (i) assert(e.start >= edits[i - 1].end, 'Overlapping patches');
  }
  let after = '', cursor = 0;
  const partitions = [];
  for (const e of edits) {
    const untouched = before.slice(cursor, e.start);
    const afterStart = after.length;
    after += untouched;
    partitions.push({ beforeStart: cursor, beforeEnd: e.start, afterStart, afterEnd: after.length,
      utf8Bytes: Buffer.byteLength(untouched), sha256: sha(untouched) });
    e.afterStart = after.length;
    after += e.after; e.afterEnd = after.length; cursor = e.end;
  }
  const tailStart = after.length, tail = before.slice(cursor);
  after += tail;
  partitions.push({ beforeStart: cursor, beforeEnd: before.length, afterStart: tailStart,
    afterEnd: after.length, utf8Bytes: Buffer.byteLength(tail), sha256: sha(tail) });
  let inverse = after;
  for (const e of [...edits].reverse()) inverse = inverse.slice(0, e.afterStart) + e.before + inverse.slice(e.afterEnd);
  assert(Buffer.from(inverse).equals(Buffer.from(before)), 'Inverse UTF-8 byte proof failed: ' + label);
  for (const p of partitions) assert(Buffer.from(before.slice(p.beforeStart, p.beforeEnd))
    .equals(Buffer.from(after.slice(p.afterStart, p.afterEnd))), 'Untouched partition changed');
  return { after, edits, partitions, proof: { beforeSha256: sha(before), sha256: sha(after),
    exactInverse: true, unchangedPartitions: true, offsets: 'UTF-16 code units; equality/hash checks use UTF-8 bytes' } };
}
function edit(node, ast, after, reason) {
  return { start: node.getStart(ast), end: node.end, before: node.getText(ast), after, reason };
}
function insert(position, after, reason) { return { start: position, end: position, before: '', after, reason }; }
function sourceBundle(options = {}) {
  const repo = options.repo || REPO;
  const shared = options.shared || path.join(repo, PLATFORM, 'shared/crmCustomers.ts');
  const helperName = options.helper || 'customerContactSummaryQueryVerified';
  assert(/^[A-Za-z_$][\w$]*$/.test(helperName), 'Unsafe helper identifier');
  const source = read(shared), ast = parse(source, shared, ts.ScriptKind.TS);
  const names = ['isCustomerPhone', 'customerNeedsCompletion', helperName];
  const declarations = names.map(name => one(ast, node => ts.isFunctionDeclaration(node)
    && node.name?.text === name && node.body && node.parent === ast, 'actual source helper ' + name));
  assert.equal(declarations[1].parameters.length, 2, 'Completion helper contract changed; manually adapt this script');
  assert.equal(declarations[2].parameters.length, 2, 'Query helper must accept (query, scopeReady); manually adapt');
  const extracted = declarations.map(node => node.getText(ast).replace(/^export\s+/, '')).join('\n');
  // Transform exact selected declarations only. No bundling, imports, provider, TRPC, React or Zod copy.
  const compiled = esbuild.transformSync(extracted, { loader: 'ts', target: 'es2022',
    minify: false, legalComments: 'none', sourcemap: false, sourcefile: shared }).code;
  const check = parse(compiled);
  assert.equal(nodes(check, n => ts.isImportDeclaration(n) || ts.isExportDeclaration(n)
    || ts.isCallExpression(n) && ['require', 'import'].includes(n.expression.getText(check))).length, 0, 'Helper must be pure and import-free');
  assert(!/\b(?:React|trpc|fetch|XMLHttpRequest|process|globalThis|window|document|eval)\b/.test(compiled), 'Unsupported helper side effects/dependency');
  // A full TS program would resolve types that are intentionally erased. Detect unexpected
  // runtime captures through esbuild's bundle-free JS lexical closure instead.
  const context = vm.createContext({ z: require('zod').z });
  vm.runInContext(compiled, context);
  assert.equal(typeof context.customerNeedsCompletion, 'function');
  assert.equal(typeof context[helperName], 'function');
  const files = [shared, path.join(repo, PLATFORM, 'client/src/pages/CustomerList.tsx'),
    path.join(repo, PLATFORM, 'client/src/pages/CustomerDetail.tsx'),
    path.join(repo, PLATFORM, 'client/src/hooks/usePageMemory.ts')];
  const guards = files.map(file => ({ file: path.relative(repo, file), sha256: sha(read(file)) }));
  const sourceErrors = [];
  // Actual source intentionally knows a missing customer name is incomplete without contacts.
  for (const name of ['Synthetic customer', '', '   ']) {
    const expected = name.trim() ? undefined : true;
    if (context.customerNeedsCompletion({ name }, undefined) !== expected)
      sourceErrors.push('customerNeedsCompletion explicit-undefined/name-priority source contract changed');
  }
  const ready = { isSuccess: true, isFetchedAfterMount: true, isError: false,
    isPending: false, isFetching: false, isPlaceholderData: false };
  if (context[helperName](ready, true) !== true || context[helperName](ready, false) !== false)
    sourceErrors.push('Query helper scopeReady contract mismatch');
  for (const flag of ['isError', 'isPending', 'isFetching', 'isPlaceholderData'])
    if (context[helperName]({ ...ready, [flag]: true }, true) !== false) sourceErrors.push('Query helper fails closed for ' + flag);
  for (const value of [false, undefined])
    if (context[helperName]({ ...ready, isFetchedAfterMount: value }, true) !== false) sourceErrors.push('Query helper must require isFetchedAfterMount === true');
  const warningText = '待补全：请补齐客户名称，并在“管理联系人”中补齐主联系人姓名及至少一种有效联系方式（手机、座机、微信、QQ、邮箱或其他）；历史查看和追加跟进不受影响。';
  for (const [index, page] of [['list', files[1]], ['detail', files[2]]]) {
    const text = read(page), a = parse(text, page, ts.ScriptKind.TSX), compact = norm(text);
    const summaries = nodes(a, node => queryCall(node, 'contactsSummary', a));
    if (summaries.length !== 1) sourceErrors.push(index + ': source must have exactly one contactsSummary useQuery');
    if (!compact.includes(helperName + '(contactsSummaryQuery,')) sourceErrors.push(index + ': source does not use configured query helper');
    if (!compact.includes('placeholderData:undefined')) sourceErrors.push(index + ': source placeholderData guard missing');
    if (!compact.includes('customerNeedsCompletion(customer,') || !compact.includes('===true')) sourceErrors.push(index + ': source completion two-argument/unknown guard missing');
    if (index === 'list' && (!compact.includes('pageCustomerIds.includes(summary.customerId)')
      || !compact.includes('newSet(contactsSummaryQuery.data.items.map(summary=>summary.customerId))')
      || !compact.includes('contactSummariesReady?contactsSummaryQuery.data?.items'))) sourceErrors.push('list: source current-ID/duplicate/map guards differ; manually adapt');
    if (index === 'detail' && (!compact.includes('contactsSummaryQuery.data?.items.length===1')
      || !compact.includes('contactsSummaryQuery.data.items[0]?.customerId===id'))) sourceErrors.push('detail: source current-ID summary guard differs; manually adapt');
    if (index === 'detail' && !text.includes(warningText)) sourceErrors.push('detail: warning text differs from requested source-bound text');
  }
  if (!norm(read(files[3])).includes('refetchOnMount:"always"')) sourceErrors.push('freshListOptions source no longer refetches always');
  return { compiled, helperName, warningText, sourceErrors: [...new Set(sourceErrors)], guards,
    excerpts: declarations.map(node => ({ name: node.name.text, start: node.getStart(ast), end: node.end,
      sha256: sha(node.getText(ast)) })), shared, factoryBody: 'const z={string:__NATIVE_STRING__};\n' + compiled
      + '\nreturn {needs:customerNeedsCompletion,verified:' + helperName + '};' };
}
function summaryScope(fn, ast) {
  const context = queryVar(fn, 'context', ast);
  const contextName = context.name.getText(ast);
  const scope = one(fn, node => ts.isVariableDeclaration(node) && owner(node) === fn
    && ts.isCallExpression(node.initializer) && node.initializer.arguments.length === 1
    && node.initializer.arguments[0].getText(ast) === contextName + '.data', 'scope helper tied to context');
  return { context: contextName, scope: scope.name.getText(ast), rpc: context.initializer.expression.getText(ast).split('.customer.')[0] };
}
function planBundle(before, source, label) {
  assert(!before.includes(FACTORY) && !before.includes(LOCAL), 'Candidate already patched/name collision');
  const ast = parse(before, label), edits = [], models = [];
  const root = one(ast, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === '__csRootSchema', 'deployed native schema bridge');
  const nativeObject = root.initializer.arguments?.[0];
  const stringProperty = property(nativeObject, 'string');
  assert(ts.isIdentifier(stringProperty.initializer), 'Native Zod string binding changed');
  const nativeString = stringProperty.initializer.text;
  const factoryBody = source.factoryBody.replace('__NATIVE_STRING__', nativeString);
  const factory = '\nvar __CC20261118Instance;\nfunction ' + FACTORY
    + '(){return __CC20261118Instance??=(function(){' + factoryBody + '})();}\n';
  const warnings = nodes(ast, node => ts.isStringLiteral(node) && node.text.startsWith('待补全：'));
  const badges = nodes(ast, node => ts.isStringLiteral(node) && node.text === '待补全');
  assert(warnings.length > 0 && badges.length > 0, 'Missing completion components');
  const owners = new Set();
  function init(fn) {
    assert(ts.isBlock(fn.body), 'Function body must be a block');
    if (!owners.has(fn)) { owners.add(fn); edits.push(insert(fn.body.getStart(ast) + 1,
      'const ' + LOCAL + '=' + FACTORY + '();', 'initialize source-bound pure helpers in existing owner')); }
  }
  for (const badge of badges) {
    const callback = owner(badge), fn = owner(callback);
    init(fn);
    assert(ts.isArrowFunction(callback) && callback.parameters.length === 1, 'Badge owner must be row callback');
    const row = callback.parameters[0].name.getText(ast);
    const completion = one(callback, node => ts.isVariableDeclaration(node) && owner(node) === callback
      && ts.isCallExpression(node.initializer) && node.initializer.arguments.length === 1
      && node.initializer.arguments[0].getText(ast) === row, 'row legacy completion callback');
    const q = queryVar(fn, 'contactsSummary', ast), query = q.name.getText(ast);
    const qcall = q.initializer, input = qcall.arguments[0].getText(ast);
    const options = queryOptions(qcall), oldEnabled = property(options, 'enabled').initializer.getText(ast);
    const { context, scope } = summaryScope(fn, ast);
    const list = queryVar(fn, 'list', ast).name.getText(ast);
    const map = one(fn, node => ts.isVariableDeclaration(node) && owner(node) === fn && node.initializer
      && node.initializer.getText(ast).includes('new Map((' + query + '.data?.items??[])'), 'existing contacts summary useMemo map');
    const mapName = map.name.getText(ast), readyName = '__ccSummaryReady20261118';
    const mapCall = map.initializer;
    assert(ts.isCallExpression(mapCall) && mapCall.arguments.length === 2, 'Expected existing useMemo map');
    const mapConstructor = one(mapCall, node => ts.isNewExpression(node) && node.expression.getText(ast) === 'Map', 'Map constructor');
    const mapItems = mapConstructor.arguments[0];
    const oldArray = one(mapItems, node => ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      && node.left.getText(ast) === query + '.data?.items', 'existing unguarded summary array');
    const scopeGuard = `${scope}.ready&&!!${scope}.scope&&!${context}.isError&&!${context}.isPending&&!${context}.isPlaceholderData&&!${list}.isError&&!${list}.isPending&&!${list}.isPlaceholderData&&!!${list}.data&&${input}.expectedActorUserId===${scope}.scope.actorUserId&&${input}.expectedEnterpriseId===${scope}.scope.enterpriseId`;
    const readyExpression = `${LOCAL}.verified(${query},Boolean(${scopeGuard}))&&Array.isArray(${query}.data?.items)&&${query}.data.items.every(__ccItem=>${input}.customerIds.includes(__ccItem.customerId))&&new Set(${query}.data.items.map(__ccItem=>__ccItem.customerId)).size===${query}.data.items.length`;
    edits.push(insert(map.getStart(ast), readyName + '=' + readyExpression + ',', 'guard current scoped summary map before reading data'));
    edits.push(edit(oldArray, ast, readyName + '?' + query + '.data.items:[]', 'replace cached summary array with verified-or-empty array'));
    const deps = mapCall.arguments[1];
    assert(ts.isArrayLiteralExpression(deps), 'Map deps must be literal');
    edits.push(insert(deps.end - 1, ',' + readyName, 'include current verification state in memo deps'));
    const newOptions = `{enabled:(${oldEnabled})&&!!${list}.data&&!${list}.isError&&!${list}.isPending&&!${list}.isPlaceholderData,retry:false,staleTime:0,refetchOnMount:"always",placeholderData:void 0}`;
    assert.deepEqual(options.properties.map(p => p.name.text).sort(), ['enabled', 'retry', 'staleTime'], 'List query options changed; do not drop extra options');
    edits.push(edit(options, ast, newOptions, 'refresh summary each mount and discard placeholder/unauthorized list'));
    const condition = `${LOCAL}.needs(${row},${mapName}.get(${row}.id))===true`;
    edits.push(edit(completion.initializer, ast, condition, 'replace old row completion with verified current-ID summary; unknown hidden'));
    const changedMap = applyEdits(map.initializer.getText(ast), [
      { start: oldArray.getStart(ast) - map.initializer.getStart(ast), end: oldArray.end - map.initializer.getStart(ast),
        before: oldArray.getText(ast), after: readyName + '?' + query + '.data.items:[]', reason: 'model array' },
      insert(deps.end - 1 - map.initializer.getStart(ast), ',' + readyName, 'model deps')
    ], 'map model').after;
    models.push({ type: 'list', owner: fn.name?.text, ownerStart: fn.getStart(ast), callbackStart: callback.getStart(ast),
      row, query, input, context, scope, list, map: mapName, readyName, readyExpression,
      mapExpression: changedMap, useMemo: mapCall.expression.getText(ast), condition, queryOptions: newOptions,
      oldCompletion: completion.initializer.getText(ast), rpc: qcall.expression.getText(ast).split('.customer.')[0] });
  }
  for (const warning of warnings) {
    const fn = owner(warning); init(fn);
    let expression = warning;
    while (expression.parent && !(ts.isBinaryExpression(expression.parent)
      && expression.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) expression = expression.parent;
    const binary = expression.parent;
    assert(ts.isBinaryExpression(binary) && ts.isCallExpression(binary.left) && binary.left.arguments.length === 1, 'Unexpected detail warning guard');
    const record = binary.left.arguments[0].getText(ast);
    assert(/^[\w$]+$/.test(record), 'Detail warning record must be bound identifier');
    const recordDecl = one(fn, node => ts.isVariableDeclaration(node) && owner(node) === fn && node.name.getText(ast) === record, 'detail customer variable');
    const get = queryVar(fn, 'get', ast), getName = get.name.getText(ast);
    const getInput = get.initializer.arguments[0];
    const id = property(getInput, 'id');
    const idName = ts.isShorthandPropertyAssignment(id) ? id.name.getText(ast) : id.initializer.getText(ast);
    const { context, scope, rpc } = summaryScope(fn, ast);
    const inputName = '__ccSummaryInput20261118', queryName = '__ccSummaryQuery20261118', summaryName = '__ccSummary20261118';
    const identity = `${scope}.ready&&!!${scope}.scope&&!!${record}&&Number.isSafeInteger(${idName})&&${idName}>0&&${record}.id===${idName}&&${record}.enterpriseId===${scope}.scope.enterpriseId`;
    const getEnabled = property(queryOptions(get.initializer), 'enabled').initializer.getText(ast);
    const current = `(${getEnabled})&&${identity}&&!${context}.isError&&!${context}.isPlaceholderData&&!${getName}.isError&&!${getName}.isPlaceholderData`;
    const inputExpression = `{customerIds:Number.isSafeInteger(${idName})&&${idName}>0?[${idName}]:[],expectedActorUserId:${scope}.ready&&${scope}.scope?${scope}.scope.actorUserId:0,expectedEnterpriseId:${scope}.ready&&${scope}.scope?${scope}.scope.enterpriseId:0}`;
    const optionsExpression = `{enabled:Boolean(${current}),retry:false,staleTime:0,refetchOnMount:"always",placeholderData:void 0}`;
    const queryExpression = `${rpc}.customer.contactsSummary.useQuery(${inputName},${optionsExpression})`;
    const summaryExpression = `${LOCAL}.verified(${queryName},Boolean(${current}))&&Array.isArray(${queryName}.data?.items)&&${queryName}.data.items.length===1&&${queryName}.data.items[0]?.customerId===${idName}?${queryName}.data.items[0]:void 0`;
    edits.push(insert(recordDecl.end, `,${inputName}=${inputExpression},${queryName}=${queryExpression},${summaryName}=${summaryExpression}`,
      'insert exactly one native scoped summary hook after existing customer binding'));
    const condition = `${LOCAL}.needs(${record},${summaryName})===true`;
    edits.push(edit(binary.left, ast, '(' + condition + ')', 'detail completion: verified current customer only; unknown hidden'));
    edits.push(edit(warning, ast, JSON.stringify(source.warningText), 'source-bound wording recognizes all supported contact methods'));
    models.push({ type: 'detail', owner: fn.name?.text, ownerStart: fn.getStart(ast), record, id: idName,
      context, scope, get: getName, rpc, inputName, queryName, summaryName, inputExpression,
      queryExpression, queryOptions: optionsExpression, getEnabled, summaryExpression, condition, oldCompletion: binary.left.getText(ast) });
  }
  edits.push(insert(before.length, factory, 'append pure helper factory compiled from actual shared source; no runtime imports'));
  const result = applyEdits(before, edits, label);
  parse(result.after, label + '-candidate');
  assert.deepEqual(moduleTable(result.after), moduleTable(before), 'All import/export/dynamic-import tables must remain byte-identical');
  const afterAst = parse(result.after);
  const oldHooks = nodes(ast, n => queryCall(n, 'contactsSummary', ast)).length;
  const newHooks = nodes(afterAst, n => queryCall(n, 'contactsSummary', afterAst)).length;
  assert.equal(newHooks, oldHooks + warnings.length, 'One added native hook per detail owner');
  return { ...result, models, factory, nativeString, counts: { badges: badges.length, details: warnings.length,
    oldSummaryHooks: oldHooks, newSummaryHooks: newHooks }, moduleTable: moduleTable(before) };
}
function replaceMapValues(text, relocations) {
  const ast = ts.parseJsonText('importmap.json', text), edits = [];
  assert.equal(ast.parseDiagnostics.length, 0);
  function visit(node) {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.initializer)
      && Object.hasOwn(relocations, node.initializer.text)) edits.push(edit(node.initializer, ast,
      JSON.stringify(relocations[node.initializer.text]), 'replace active-workbench URL value only'));
    node.forEachChild(visit);
  }
  visit(ast);
  for (const from of Object.keys(relocations)) assert(edits.some(e => JSON.parse(e.before) === from), 'Active URL absent from import map');
  return applyEdits(text, edits, 'import-map value edits');
}
function cloneScopes(text, fromMap, relocations) {
  const map = JSON.parse(text), clones = [];
  for (const [from, to] of Object.entries(relocations)) {
    const scopes = Object.keys(fromMap.scopes || {}).filter(scope => absolute(from).startsWith(absolute(scope))
      && !absolute(to).startsWith(absolute(scope))).sort((a, b) => absolute(a).length - absolute(b).length);
    if (!scopes.length) continue;
    assert(!Object.hasOwn(map.scopes, to), 'Scope collision');
    const table = Object.assign({}, ...scopes.map(scope => map.scopes[scope]));
    clones.push({ from, to, oldScopes: scopes, table });
  }
  if (!clones.length) return { text, clones };
  const ast = ts.parseJsonText('importmap.json', text);
  const scopes = ast.statements[0].expression.properties.find(p => p.name.text === 'scopes').initializer;
  assert(ts.isObjectLiteralExpression(scopes));
  const extra = (scopes.properties.length ? ',' : '') + clones.map(c => JSON.stringify(c.to) + ':' + JSON.stringify(c.table)).join(',');
  return { text: text.slice(0, scopes.end - 1) + extra + text.slice(scopes.end - 1), clones };
}
function finishHTML(before, relocations, planned) {
  const original = importMap(before), values = replaceMapValues(original.text, relocations);
  const cloned = cloneScopes(values.after, original.map, relocations), map = JSON.parse(cloned.text);
  assert.deepEqual(Object.keys(map.imports), Object.keys(original.map.imports), 'Never add/change import keys');
  for (const [key, value] of Object.entries(original.map.imports)) assert.equal(map.imports[key], relocations[value] || value);
  for (const [scope, table] of Object.entries(original.map.scopes || {})) {
    assert.deepEqual(Object.keys(map.scopes[scope]), Object.keys(table), 'Old scope keys preserved');
    for (const [key, value] of Object.entries(table)) assert.equal(map.scopes[scope][key], relocations[value] || value);
  }
  const allowedScopes = [...Object.keys(original.map.scopes || {}), ...cloned.clones.map(c => c.to)];
  assert.deepEqual(Object.keys(map.scopes || {}).sort(), allowedScopes.sort(), 'Only necessary dependency scope clones permitted');
  const checks = [];
  for (const record of planned) {
    for (const spec of specifiers(record.before)) {
      const old = resolve(spec, record.oldURL, original.map), next = resolve(spec, record.newURL, map);
      assert.equal(next, relocations[old] || old, 'Effective dependency drift: ' + spec);
      checks.push({ from: record.oldURL, to: record.newURL, specifier: spec, before: old, after: next });
    }
  }
  const result = applyEdits(before, [{ start: original.start, end: original.start + original.text.length,
    before: original.text, after: cloned.text, reason: 'active URL values and necessary inherited dependency scope clones only' }], 'HTML');
  assert.equal(result.after.slice(0, original.start), before.slice(0, original.start));
  assert.equal(result.after.slice(original.start + cloned.text.length), before.slice(original.start + original.text.length));
  return { ...result, changes: values.edits, clones: cloned.clones, dependencyChecks: checks,
    preservedOldImportsAndScopes: true, htmlOutsideImportmapByteIdentical: true };
}
function options(argv) {
  const result = {};
  const keys = { '--baseline': 'baseline', '--out': 'out', '--repo': 'repo', '--shared': 'shared', '--query-helper': 'helper' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check-source') result.checkSource = true;
    else { assert(keys[argv[i]], 'Unknown argument: ' + argv[i]); assert(argv[i + 1], 'Missing argument'); result[keys[argv[i]]] = argv[++i]; }
  }
  return result;
}
function baseline(options = {}) {
  const base = path.resolve(options.baseline || BASE), html = read(path.join(base, 'index.html'));
  assert.equal(sha(html), EXPECTED_HTML, 'Real baseline HTML drift; stop and review');
  const activeText = read(path.join(base, 'active-workbenches.json'));
  assert.equal(sha(activeText), EXPECTED_ACTIVE, 'Real active list drift; stop and review');
  const urls = JSON.parse(activeText);
  assert.equal(urls.length, 2, 'Expected two real active workbench bundles');
  return { base, html, urls, records: urls.map(oldURL => {
    assert(/^\/assets\/[A-Za-z0-9._-]+\.js$/.test(oldURL), 'Unsafe asset URL');
    const before = read(base + oldURL), digest = sha(before);
    assert(oldURL.includes(digest.slice(0, 16)), 'Content-hash baseline asset mismatch');
    return { oldURL, before, sha256: digest };
  }) };
}
function writePrivate(out, relative, content) {
  assert(!path.isAbsolute(relative) && !relative.split('/').includes('..'), 'Unsafe relative output');
  const file = path.join(out, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
function build(options = {}) {
  const source = sourceBundle(options);
  if (options.checkSource) {
    console.log(JSON.stringify({ status: source.sourceErrors.length ? 'BLOCKED' : 'PASS', errors: source.sourceErrors, sources: source.guards }, null, 2));
    if (source.sourceErrors.length) process.exitCode = 2;
    return;
  }
  assert.equal(source.sourceErrors.length, 0, 'Source guard mismatch; do not alter application source here:\n' + source.sourceErrors.join('\n'));
  const base = baseline(options), out = path.resolve(options.out || OUT), repo = path.resolve(options.repo || REPO);
  assert(out === OUT || out.startsWith('/home/ubuntu/diagnosis/completion-candidate-'), 'Outputs must be in the private diagnosis candidate path');
  assert(out !== repo && !out.startsWith(repo + '/') && out !== base.base && !out.startsWith(base.base + '/'), 'Never write production data into repository/baseline');
  assert(!fs.existsSync(out), 'Candidate already exists; choose a fresh private --out path, never overwrite');
  const planned = base.records.map(record => {
    const plan = planBundle(record.before, source, record.oldURL);
    const newURL = '/assets/BusinessWorkbenchPage-customer-completion-' + sha(plan.after).slice(0, 16) + '.js';
    assert(newURL !== record.oldURL, 'Must create a new content-hash asset');
    return { ...record, ...plan, newURL };
  });
  assert.deepEqual(planned.map(p => [p.counts.badges, p.counts.details]), [[1, 2], [1, 3]], 'AST observation coverage drift');
  const relocations = Object.fromEntries(planned.map(p => [p.oldURL, p.newURL]));
  assert.equal(new Set(Object.values(relocations)).size, 2, 'Per-oldURL assets must be distinct');
  const html = finishHTML(base.html, relocations, planned);
  for (const guard of source.guards) assert.equal(sha(read(path.join(repo, guard.file))), guard.sha256, 'Source changed during build; retry after source is ready');
  fs.mkdirSync(out, { mode: 0o700 });
  fs.chmodSync(out, 0o700);
  const files = [];
  for (const p of planned) {
    const relative = p.newURL.slice(1), proof = 'proof/' + path.basename(p.oldURL) + '.json';
    writePrivate(out, 'candidate/' + relative, p.after);
    writePrivate(out, proof, { oldURL: p.oldURL, newURL: p.newURL, ...p.proof, counts: p.counts,
      edits: p.edits, partitions: p.partitions, moduleTable: p.moduleTable, models: p.models,
      factory: p.factory, nativeString: p.nativeString });
    files.push({ relative, sha256: sha(p.after), bytes: Buffer.byteLength(p.after), oldURL: p.oldURL, proof });
  }
  writePrivate(out, 'candidate/index.html', html.after);
  writePrivate(out, 'candidate/active-workbenches.json', Object.values(relocations));
  writePrivate(out, 'baseline/index.html', base.html);
  writePrivate(out, 'proof/html.json', { ...html.proof, edits: html.edits, partitions: html.partitions,
    changes: html.changes, clones: html.clones, dependencyChecks: html.dependencyChecks,
    preservedOldImportsAndScopes: true, htmlOutsideImportmapByteIdentical: true });
  const manifest = { status: 'BUILT_NOT_DEPLOYED', offline: true, baseline: base.base,
    baselineHTMLSha256: sha(base.html), activeListSha256: EXPECTED_ACTIVE, relocations,
    source: { guards: source.guards, excerpts: source.excerpts, helperName: source.helperName,
      compiledSha256: sha(source.compiled), warningText: source.warningText },
    counts: { lists: 2, detailWarnings: 5 }, files: [...files,
      { relative: 'index.html', sha256: sha(html.after), bytes: Buffer.byteLength(html.after) }] };
  writePrivate(out, 'manifest.json', manifest);
  writePrivate(out, 'release-manifest.json', {
    ownerTask: 'WJQ7iBxDiifmPZ8w6QPWZp', scope: 'static-customer-completion-only',
    apiWrites: 0, databaseWrites: 0, processReloads: 0,
    beforeHtmlSha256: sha(base.html), afterHtmlSha256: sha(html.after),
    assets: files.map(file => ({ relative: file.relative, sha256: file.sha256 })),
    baselineAssets: base.records.map(record => ({ relative: record.oldURL.slice(1), sha256: record.sha256 })),
    protectedApis: [], protectedApisPendingOwnerFill: true
  });
  console.log(JSON.stringify({ status: manifest.status, out, lists: 2, details: 5,
    instructions: 'Run node deploy/customer-completion-20261118/test.cjs --candidate ' + out }, null, 2));
  return manifest;
}
module.exports = { REPO, BASE, OUT, EXPECTED_HTML, EXPECTED_ACTIVE, FACTORY, LOCAL, sha, read, norm,
  parse, nodes, one, owner, queryCall, moduleTable, specifiers, importMap, resolve, applyEdits,
  sourceBundle, planBundle, finishHTML, baseline, build };
if (require.main === module) {
  try { build(options(process.argv.slice(2))); }
  catch (error) { console.error('BLOCKED: ' + error.message); process.exitCode = 1; }
}
