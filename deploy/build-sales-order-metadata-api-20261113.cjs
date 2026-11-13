#!/usr/bin/env node
'use strict';
// Offline additive API patch. Never execute the baseline or connect to any service.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const crypto = require('node:crypto');
const ts = require('typescript');
const esbuild = require('esbuild');
const ROOT = path.resolve(process.env.METADATA_ROOT || path.join(__dirname, '..'));
const OUT = path.resolve(process.env.METADATA_OUT || path.join(ROOT, '..', 'sales-unified', 'api-candidate'));
const BASE = path.resolve(process.env.METADATA_BASE || path.join(ROOT, '..', 'sales-unified', 'api-baseline', 'admin-index-before.js'));
const BASE_SHA256 = '56f9a8e50070c3a17601b5c95f9459e014861cffca9aba5a836580c563d5cf14';
const METHODS = { metadataGet: 'query', saveReceiver: 'mutation', addAfterSale: 'mutation', updateAfterSale: 'mutation' };
const SERVICE_NAME = '__D51_SALES_ORDER_METADATA_SERVICE';
const CONTRACT_NAME = '__D51_SALES_ORDER_METADATA_CONTRACT';
const LIVE_NAME = '__d51SalesOrderMetadataLive';
const read = p => fs.readFileSync(p, 'utf8');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function parse(text, kind = ts.ScriptKind.JS) {
  const tree = ts.createSourceFile(kind === ts.ScriptKind.TS ? 'source.ts' : 'api.js', text, ts.ScriptTarget.Latest, true, kind);
  assert.equal(tree.parseDiagnostics.length, 0, 'AST parse diagnostics');
  return tree;
}
function nodes(root, predicate) {
  const found = [];
  function visit(n) { if (predicate(n)) found.push(n); n.forEachChild(visit); }
  visit(root);
  return found;
}
function one(root, predicate, label) {
  const found = nodes(root, predicate);
  assert.equal(found.length, 1, label);
  return found[0];
}
function fn(tree, name) { return one(tree, n => ts.isFunctionDeclaration(n) && n.name?.text === name, 'function ' + name); }
function variable(tree, name) { return one(tree, n => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name, 'variable ' + name); }
function rootBinding(tree, name) {
  const matches = [];
  for (const statement of tree.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) matches.push(statement);
    if (ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === name) matches.push(d);
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name?.text === name) matches.push(clause.name);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const s of bindings.elements) if (s.name.text === name) matches.push(s);
      if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) matches.push(bindings);
    }
  }
  assert.equal(matches.length, 1, 'unique real root binding: ' + name);
  return matches[0];
}
function checkedImport(tree, moduleName, exportName, localName) {
  const imports = nodes(tree, n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === moduleName);
  const bindings = imports.flatMap(n => n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings) ? [...n.importClause.namedBindings.elements] : []);
  const match = bindings.filter(n => (n.propertyName?.text || n.name.text) === exportName && n.name.text === localName);
  assert.equal(match.length, 1, 'real import bridge ' + localName);
  rootBinding(tree, localName);
  return localName;
}
function write(file, value) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
}
function sourceHashes() {
  return Object.fromEntries([
    'shared/businessSalesOrderMetadata.ts', 'server/services/businessSalesOrderMetadata.ts',
    'server/businessRouter.ts', 'server/services/businessSalesOrderMetadata.fixture.ts',
    'drizzle/businessSalesOrderMetadataSchema.ts',
  ].map(file => [file, sha(read(path.join(ROOT, file)))]));
}
async function compileFragment(text, aliases) {
  const tree = parse(text, ts.ScriptKind.TS);
  const replacements = nodes(tree, n => ts.isIdentifier(n) && Object.hasOwn(aliases, n.text))
    .map(n => ({ start: n.getStart(tree), end: n.end, text: aliases[n.text] }));
  let changed = text;
  for (const edit of replacements.reverse()) changed = changed.slice(0, edit.start) + edit.text + changed.slice(edit.end);
  const result = await esbuild.transform(changed, { loader: 'ts', target: 'node20', format: 'esm', minify: false });
  assert(!result.code.includes('import ') && !result.code.includes('require('), 'fragment introduces no dependency imports');
  return result.code;
}
async function build() {
  const before = read(BASE);
  assert.equal(sha(before), BASE_SHA256, 'exact current production baseline required; archive filter must be present');
  const old = parse(before);
  const sourceRouter = read(path.join(ROOT, 'server/businessRouter.ts'));
  const source = parse(sourceRouter, ts.ScriptKind.TS);
  const trpcAlias = checkedImport(old, '@trpc/server', 'TRPCError', '__ir_admin_d67f0938_import_TRPCError');
  const sqlAlias = checkedImport(old, 'drizzle-orm', 'sql', 'sql4');
  const cryptoAlias = checkedImport(old, 'node:crypto', 'createHash', '__ir_admin_d67f0938_import_createHash');
  const uuidAlias = checkedImport(old, 'node:crypto', 'randomUUID', '__ir_admin_d67f0938_import_randomUUID');
  const requiredFunctions = ['getDb', 'withCurrentBusinessAuthorization', 'assertBusinessMerchantAccess', 'forwardBusinessMethod',
    'businessQuery', 'businessMutation', 'callPlatformBusinessCommand', 'recordBusinessCommandAccess',
    'businessScopeAllows', 'businessMerchantIdFromContext', 'businessEnterpriseBindingFromMerchant',
    'businessAuditActor', 'requireCurrentBusinessStaffBinding'];
  for (const name of requiredFunctions) { rootBinding(old, name); fn(old, name); }
  for (const name of ['router', 'publicProcedure', 'PlatformBusinessPublicError', 'BUSINESS_METHOD_CAPABILITIES']) rootBinding(old, name);
  assert(ts.isClassExpression(variable(old, 'PlatformBusinessPublicError').initializer), 'original error class expression');
  assert(fn(old, 'forwardBusinessMethod').getText(old).includes('__D51_TEST_ORDER_ARCHIVE.applyBusinessTestOrderArchives'), 'latest archive hook preserved');
  const serviceFile = path.join(ROOT, 'server/services/businessSalesOrderMetadata.ts');
  const contractFile = path.join(ROOT, 'shared/businessSalesOrderMetadata.ts');
  const bundle = async (entry, globalName) => esbuild.build({
    entryPoints: [entry], absWorkingDir: ROOT, bundle: true, write: false, format: 'iife', globalName,
    target: 'node20', platform: 'node', minify: true, metafile: true,
    plugins: [{ name: 'checked-original-native-bindings', setup(b) {
      b.onResolve({ filter: /^(\.\.\/db|drizzle-orm|@trpc\/server|node:crypto)$/ }, args => {
        if (args.path === '../db') { assert.equal(args.importer, serviceFile); return { path: 'db', namespace: 'native-bridge' }; }
        return { path: args.path, namespace: 'native-bridge' };
      });
      b.onLoad({ filter: /.*/, namespace: 'native-bridge' }, args => ({ loader: 'js', contents: {
        db: `export const getDb=${LIVE_NAME}.getDb;`,
        'drizzle-orm': `export const sql=${LIVE_NAME}.sql;`,
        '@trpc/server': `export const TRPCError=${LIVE_NAME}.TRPCError;`,
        'node:crypto': `export const createHash=${LIVE_NAME}.createHash;`,
      }[args.path] }));
    } }],
  });
  const service = await bundle(serviceFile, SERVICE_NAME);
  const contract = await bundle(contractFile, CONTRACT_NAME);
  for (const result of [service, contract]) {
    assert.equal(result.outputFiles.length, 1);
    assert(!/\brequire\s*\(/.test(result.outputFiles[0].text), 'no ESM incompatible require or dynamic dependency');
    for (const file of Object.keys(result.metafile.inputs)) {
      assert(file.startsWith('native-bridge:') || file.includes('node_modules/') && file.includes('/zod/') ||
        file === 'shared/businessSalesOrderMetadata.ts' || file === 'server/services/businessSalesOrderMetadata.ts', 'only metadata, zod and checked native bridges may bundle: ' + file);
    }
    for (const output of Object.values(result.metafile.outputs)) assert.equal(output.imports.length, 0, 'all builtin imports reuse checked root import identity');
  }
  const aliases = { TRPCError: trpcAlias, randomUUID: uuidAlias };
  for (const name of ['deriveBusinessSalesOrderMetadataProvenance', 'getBusinessSalesOrderMetadata', 'saveBusinessSalesOrderReceiver', 'addBusinessSalesOrderAfterSale', 'updateBusinessSalesOrderAfterSale']) aliases[name] = SERVICE_NAME + '.' + name;
  for (const name of ['businessSalesOrderMetadataGetSchema', 'businessSalesOrderSaveReceiverSchema', 'businessSalesOrderAddAfterSaleSchema', 'businessSalesOrderUpdateAfterSaleSchema']) aliases[name] = CONTRACT_NAME + '.' + name;
  assert.equal(nodes(old, n => ts.isIdentifier(n) && [LIVE_NAME, SERVICE_NAME, CONTRACT_NAME, 'withBusinessSalesOrderMetadata'].includes(n.text)).length, 0, 'new names cannot shadow live root');
  const helperSource = fn(source, 'withBusinessSalesOrderMetadata').getText(source);
  const helper = await compileFragment(helperSource, aliases);
  const sourceObject = variable(source, 'crmSalesOrderBusinessRouter').initializer.arguments[0];
  assert(ts.isObjectLiteralExpression(sourceObject));
  const sourceProperties = Object.entries(METHODS).map(([name, type]) => {
    const prop = one(sourceObject, n => ts.isPropertyAssignment(n) && n.name.getText(source) === name, 'source metadata property ' + name);
    assert(ts.isCallExpression(prop.initializer) && ts.isPropertyAccessExpression(prop.initializer.expression));
    assert.equal(prop.initializer.expression.name.text, type, 'query/mutation source type ' + name);
    return prop.getText(source);
  });
  // Compile only the four approved property expressions, never the original API.
  const propsCode = await compileFragment('const __metadataProps = {\n' + sourceProperties.join(',\n') + '\n};', aliases);
  const propsTree = parse(propsCode);
  const props = variable(propsTree, '__metadataProps').initializer.properties.map(n => n.getText(propsTree));
  assert.equal(props.length, 4);
  const live = `const ${LIVE_NAME}={getDb:getDb,sql:${sqlAlias},TRPCError:${trpcAlias},createHash:${cryptoAlias}};\n`;
  const factory = '\n' + live + service.outputFiles[0].text + '\n' + contract.outputFiles[0].text + '\n' + helper + '\n';
  const oldRouter = variable(old, 'crmSalesOrderBusinessRouter');
  assert(ts.isCallExpression(oldRouter.initializer) && oldRouter.initializer.expression.getText(old) === 'router');
  const object = oldRouter.initializer.arguments[0];
  assert(ts.isObjectLiteralExpression(object));
  assert(!object.properties.some(n => Object.hasOwn(METHODS, n.name?.getText(old))), 'no metadata method already present');
  const anchor = fn(old, 'forwardBusinessMethod').getStart(old);
  const edits = [
    { start: anchor, end: anchor, before: '', after: factory, reason: 'checked native bridges + independent metadata service/contract IIFEs + source transpiled authorization helper' },
    { start: object.getStart(old) + 1, end: object.getStart(old) + 1, before: '', after: '\n' + props.map(p => '    ' + p).join(',\n') + ',\n', reason: 'exactly four fixed metadata query/mutation properties; existing router properties unchanged' },
  ].sort((a, b) => a.start - b.start);
  let delta = 0;
  for (const e of edits) { e.afterStart = e.start + delta; e.afterEnd = e.afterStart + e.after.length; delta += e.after.length; }
  let candidate = before;
  for (const e of [...edits].reverse()) candidate = candidate.slice(0, e.start) + e.after + candidate.slice(e.end);
  let inverse = candidate;
  for (const e of [...edits].reverse()) { assert.equal(candidate.slice(e.afterStart, e.afterEnd), e.after); inverse = inverse.slice(0, e.afterStart) + e.before + inverse.slice(e.afterEnd); }
  assert.equal(inverse, before, 'exact inverse / all nonpatch bytes identical');
  const next = parse(candidate);
  const protectedFunctions = requiredFunctions.map(name => {
    const oldText = fn(old, name).getText(old);
    assert.equal(oldText, fn(next, name).getText(next), 'protected function unchanged: ' + name);
    return { name, sha256: sha(oldText) };
  });
  const protectedVariables = ['BUSINESS_METHOD_CAPABILITIES', 'PlatformBusinessPublicError', '__archiveLive', '__D51_TEST_ORDER_ARCHIVE', '__ir_admin_d67f0938_namespace_db'].map(name => {
    const text = variable(old, name).getText(old);
    assert.equal(text, variable(next, name).getText(next), 'protected original variable unchanged: ' + name);
    return { name, sha256: sha(text) };
  });
  const oldImports = old.statements.filter(ts.isImportDeclaration).map(n => n.getText(old));
  assert.deepEqual(oldImports, next.statements.filter(ts.isImportDeclaration).map(n => n.getText(next)));
  const nextObject = variable(next, 'crmSalesOrderBusinessRouter').initializer.arguments[0];
  assert.equal(nextObject.properties.length, object.properties.length + 4);
  assert.deepEqual(object.properties.map(n => n.getText(old)), nextObject.properties.filter(n => !Object.hasOwn(METHODS, n.name?.getText(next))).map(n => n.getText(next)));
  const hashes = sourceHashes();
  write('admin-index-candidate.js', candidate);
  write('api-patches.json', edits);
  write('api-service-metafile.json', { status: 'PASS', baselineSha256: sha(before), candidateSha256: sha(candidate), sourceHashes: hashes, service: service.metafile, contract: contract.metafile });
  const proof = {
    status: 'PASS', baselineSha256: sha(before), candidateSha256: sha(candidate), sourceHashes: hashes, patchCount: edits.length,
    exactInverse: true, allNonpatchBytesUnchanged: true, originalAuthorizationUnchanged: true,
    originalPlatformCommandUnchanged: true, originalImportsUnchanged: true, originalArchiveFactoryAndHookUnchanged: true,
    originalRouterPropertiesUnchanged: true, noApiRebuild: true, metadataMethods: METHODS,
    protectedFunctions, protectedVariables, rootImportsSha256: sha(oldImports.join('\n')),
    checkedNativeBindings: { getDb: 'getDb', sql: sqlAlias, TRPCError: trpcAlias, createHash: cryptoAlias, randomUUID: uuidAlias, publicError: 'PlatformBusinessPublicError' },
    compiledHelperSha256: sha(helper), sourceHelperSha256: sha(helperSource),
    getDbPreservedExactly: true, baselineGetDbHasExplicitTimezoneZ: fn(old, 'getDb').getText(old).includes('timezone: "Z"'),
    timezoneBoundary: 'Native root getDb is unchanged. Date values use service UTC serialization; live pool/session timezone is an activation-owner prerequisite, not inferred from fixtures.',
  };
  write('api-build-proof.json', proof);
  console.log(JSON.stringify({ status: 'PASS', phase: 'BUILD', patchCount: edits.length, candidateSha256: proof.candidateSha256, OUT }));
  return proof;
}
module.exports = { ROOT, REPO: ROOT, OUT, BASE, BASE_SHA256, METHODS, SERVICE_NAME, CONTRACT_NAME, LIVE_NAME, read, sha, parse, nodes, one, fn, variable, rootBinding, checkedImport, write, sourceHashes, compileFragment, build };
if (require.main === module) build().catch(error => { console.error(error.stack); process.exitCode = 1; });
