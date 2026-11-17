#!/usr/bin/env node
'use strict';
// Offline only. No application source/JSON writes, main/API bundle, SSH/browser/Git,
// worker execution, credentials, config/cache provisioning or public requests.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { createRequire, builtinModules } = require('node:module');
const { spawnSync } = require('node:child_process');
const ROOT = '/home/ubuntu/work/51dianzi-platform--manager';
const OUT = __dirname;
const TOOLS = path.join(ROOT, 'deploy/channel-reference-remediation-20261115/v4-brand');
const DATA = '/home/ubuntu/work/channel-reference-fill-20261117/data';
const LOCK = path.join(OUT, 'runtime-source-lock.json');
const projectRequire = createRequire(path.join(ROOT, 'package.json'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const sorted = value => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
const SERVICE_FILES = Object.freeze([
  'server/channelReference/browserPage.ts', 'server/channelReference/ickeyPage.ts',
  'server/channelReference/identityBindings.ts', 'server/channelReference/lcscPage.ts',
  'server/channelReference/lcscSearchPage.ts', 'server/channelReference/manualRefresh.ts',
  'server/channelReference/manualRefreshConfig.ts', 'server/channelReference/nativeWorker.ts',
  'server/channelReference/publicPage.ts', 'server/channelReference/quoteValidation.ts',
  'server/channelReference/referenceStore.ts', 'server/channelReference/requestPacing.ts',
  'server/channelReference/service.ts', 'server/channelReference/snapshot.ts',
  'server/channelReference/worker.ts', 'shared/channelReferenceBrand.ts',
]);
const WORKER_FILES = Object.freeze([
  'server/channelReference/browserPage.ts', 'server/channelReference/ickeyPage.ts',
  'server/channelReference/lcscPage.ts', 'server/channelReference/lcscSearchPage.ts',
  'server/channelReference/publicPage.ts', 'server/channelReference/quoteValidation.ts',
  'server/channelReference/requestPacing.ts', 'server/channelReference/worker.ts',
  'shared/channelReferenceBrand.ts',
]);
// These are type-only dependencies, erased by esbuild: frozen separately, not
// falsely included in either metafile's actual loaded source graph.
const TYPE_ONLY = Object.freeze(['shared/channelReference.ts', 'shared/channelReferenceRefresh.ts']);
const ELIGIBLE = new Set([...SERVICE_FILES, ...TYPE_ONLY]);
const BUILTINS = Object.freeze([
  'node:child_process', 'node:crypto', 'node:dns/promises', 'node:fs',
  'node:fs/promises', 'node:http', 'node:https', 'node:net', 'node:os',
  'node:path', 'node:url',
]);
const WORKER_BUILTINS = Object.freeze(BUILTINS.filter(n => n !== 'node:fs'));
function regular(file) {
  const resolved = path.resolve(file);
  for (let p = resolved; ; p = path.dirname(p)) {
    assert(!fs.lstatSync(p).isSymbolicLink(), 'SYMLINK_REFUSED ' + p);
    if (path.dirname(p) === p) break;
  }
  assert(fs.statSync(resolved).isFile(), 'REGULAR_FILE_REQUIRED ' + resolved);
  return fs.readFileSync(resolved);
}
function pinned(file, hash) {
  assert(/^[a-f0-9]{64}$/.test(hash), 'EXACT_SHA_REQUIRED');
  const bytes = regular(file);
  assert.equal(sha(bytes), hash, 'PIN_DRIFT ' + file);
  return bytes;
}
function write(name, value) { fs.writeFileSync(path.join(OUT, name), jsonBytes(value)); }
function sourceHashes(files) { return sorted(Object.fromEntries(files.map(n => [n, sha(regular(path.join(ROOT, n)))]))); }
function toolPins() {
  assert(!process.env.ESBUILD_BINARY_PATH, 'UNPINNED_COMPILER_BINARY_ENV_REFUSED');
  const rows = {};
  const add = file => { const p = fs.realpathSync(file); rows[p] = sha(regular(p)); };
  for (const name of ['esbuild', 'typescript']) {
    add(projectRequire.resolve(name + '/package.json'));
    add(projectRequire.resolve(name));
  }
  const esbuildRequire = createRequire(projectRequire.resolve('esbuild/package.json'));
  const native = '@esbuild/' + process.platform + '-' + process.arch;
  add(esbuildRequire.resolve(native + '/package.json'));
  add(path.join(path.dirname(esbuildRequire.resolve(native + '/package.json')), 'bin/esbuild'));
  for (const n of ['runtime-scoped.cjs', 'source-contract.cjs', 'scoped-core.cjs']) add(path.join(TOOLS, n));
  // Compiler resolution context and dependency lock are read-only, not bundled.
  add(path.join(ROOT, 'package.json'));
  add(path.join(ROOT, 'pnpm-lock.yaml'));
  add(path.join(ROOT, 'tsconfig.json'));
  return sorted(rows);
}
function checkSyntax(file) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, 'NODE_CHECK_FAILED ' + file + '\n' + r.stderr);
  return { file, command: 'node --check', passed: true, executed: false };
}
function inspectImports(ts, text, relative) {
  const ast = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(ast.parseDiagnostics.length, 0, 'TS_PARSE_DIAGNOSTICS ' + relative);
  function check(specifier) {
    assert(typeof specifier === 'string', 'NONLITERAL_IMPORT_REFUSED ' + relative);
    if (specifier.startsWith('node:')) assert(BUILTINS.includes(specifier) && builtinModules.includes(specifier.slice(5)), 'UNAPPROVED_BUILTIN ' + specifier);
    else {
      assert(specifier.startsWith('./') || specifier.startsWith('../'), 'NON_BUILTIN_PACKAGE_IMPORT_REFUSED ' + relative + ' ' + specifier);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier)) + '.ts';
      assert(ELIGIBLE.has(target), 'IMPORT_OUTSIDE_EXACT_FILE_ALLOWLIST ' + target);
    }
  }
  function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) check(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(n.expression) && n.expression.text === 'require')) {
      assert.equal(n.arguments.length, 1, 'INDIRECT_PACKAGE_LOAD_REFUSED');
      assert(ts.isStringLiteral(n.arguments[0]), 'NONLITERAL_PACKAGE_LOAD_REFUSED');
      check(n.arguments[0].text);
    }
    if (ts.isPropertyAccessExpression(n) && n.expression.getText(ast) === 'process' && n.name.text === 'env') throw Error('ENV_REFERENCE_REFUSED ' + relative);
    if (ts.isElementAccessExpression(n) && n.expression.getText(ast) === 'process') throw Error('INDIRECT_PROCESS_ACCESS_REFUSED ' + relative);
    n.forEachChild(visit);
  }
  visit(ast);
}
function strictPlugin(pins, expected, externalBuiltins, reads) {
  const ext = new Set(externalBuiltins);
  return { name: 'exact-frozen-reference-files-only', setup(build) {
    build.onResolve({ filter: /^node:/ }, a => {
      assert(ext.has(a.path) && builtinModules.includes(a.path.slice(5)), 'UNAPPROVED_NODE_BUILTIN ' + a.path);
      return { path: a.path, external: true };
    });
    build.onResolve({ filter: /^[^./]/ }, a => {
      if (!a.path.startsWith('node:') && !path.isAbsolute(a.path)) throw Error('NON_BUILTIN_PACKAGE_OR_ALIAS_REFUSED ' + a.path);
    });
    build.onLoad({ filter: /.*/, namespace: 'file' }, a => {
      const n = path.relative(ROOT, a.path).split(path.sep).join('/');
      assert(ELIGIBLE.has(n) && Object.hasOwn(expected, n), 'SOURCE_OUTSIDE_EXACT_REFERENCE_GRAPH ' + n);
      const bytes = pinned(a.path, expected[n]);
      assert.equal(pins[n], expected[n]);
      reads[n] = sha(bytes);
      return { contents: bytes.toString('utf8'), loader: 'ts', resolveDir: path.dirname(a.path) };
    });
  } };
}
function verifyMetafile(meta, expectedFiles, expectedBuiltins) {
  assert.deepEqual(Object.keys(meta.inputs).sort(), [...expectedFiles].sort(), 'EXACT_ACTUAL_METAFILE_GRAPH_REQUIRED');
  for (const [name, input] of Object.entries(meta.inputs)) for (const imp of input.imports) {
    if (imp.external) assert(imp.path.startsWith('node:') && expectedBuiltins.includes(imp.path), 'NON_BUILTIN_NODE_PACKAGE_IMPORT_REFUSED ' + name);
    else assert(expectedFiles.includes(imp.path), 'OUTSIDE_GRAPH_IMPORT ' + imp.path);
  }
  const outputs = Object.values(meta.outputs);
  assert.equal(outputs.length, 1);
  assert.deepEqual([...new Set(outputs[0].imports.map(i => i.path))].sort(), [...expectedBuiltins].sort(), 'EXACT_EXTERNAL_BUILTIN_SET_REQUIRED');
  assert(outputs[0].imports.every(i => i.external), 'UNBUNDLED_NONBUILTIN_IMPORT_REFUSED');
}
async function discover() {
  assert(!fs.existsSync(LOCK), 'LOCK_ALREADY_EXISTS_NO_AUTO_REPIN');
  const compilerPins = toolPins();
  const ts = projectRequire('typescript'), esbuild = projectRequire('esbuild');
  const pins = sourceHashes([...ELIGIBLE]);
  for (const n of ELIGIBLE) inspectImports(ts, pinned(path.join(ROOT, n), pins[n]).toString('utf8'), n);
  const graph = {};
  for (const [kind, files, ext] of [['service', SERVICE_FILES, BUILTINS], ['worker', WORKER_FILES, WORKER_BUILTINS]]) {
    const expected = sorted(Object.fromEntries(files.map(n => [n, pins[n]]))), reads = {};
    const result = await esbuild.build({ absWorkingDir: ROOT, entryPoints: ['server/channelReference/' + kind + '.ts'], bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22', metafile: true, logLevel: 'silent', legalComments: 'none', plugins: [strictPlugin(pins, expected, ext, reads)] });
    assert.deepEqual(sorted(reads), expected);
    verifyMetafile(result.metafile, files, ext);
    write(kind + '.discovered-metafile.json', result.metafile);
    graph[kind] = { sourceHashes: expected, graphSha256: sha(jsonBytes(expected)), sourceFileCount: files.length, externalBuiltins: ext, discoveredMetafileSha256: sha(jsonBytes(result.metafile)) };
  }
  assert.deepEqual(sourceHashes([...ELIGIBLE]), pins);
  assert.deepEqual(toolPins(), compilerPins);
  const wrapperHashes = sorted(Object.fromEntries(['build-runtime.cjs', 'default-loader-check.mjs'].map(n => [n, sha(regular(path.join(OUT, n)))])));
  const lock = { lockVersion: 'channel-reference-runtime-exact-source-freeze-v1', sourceRoot: ROOT, sourceHashes: pins, eligibleSourceFiles: [...ELIGIBLE].sort(), typeOnlySourceHashes: sorted(Object.fromEntries(TYPE_ONLY.map(n => [n, pins[n]]))), exactServiceGraph: graph.service, exactWorkerGraph: graph.worker, compiler: { esbuildVersion: projectRequire('esbuild/package.json').version, typescriptVersion: projectRequire('typescript/package.json').version, platform: process.platform, arch: process.arch, pinnedFiles: compilerPins }, wrapperHashes };
  write('runtime-source-lock.json', lock);
  console.log('Frozen actual service graph: ' + SERVICE_FILES.length + '; worker: ' + WORKER_FILES.length + '; eligible files: ' + ELIGIBLE.size);
  return lock;
}
function readLock() {
  const lock = JSON.parse(regular(LOCK));
  assert.equal(lock.sourceRoot, ROOT);
  assert.deepEqual(lock.eligibleSourceFiles, [...ELIGIBLE].sort());
  assert.deepEqual(Object.keys(lock.exactServiceGraph.sourceHashes).sort(), [...SERVICE_FILES].sort());
  assert.deepEqual(Object.keys(lock.exactWorkerGraph.sourceHashes).sort(), [...WORKER_FILES].sort());
  assert.deepEqual(lock.exactServiceGraph.externalBuiltins, BUILTINS);
  assert.deepEqual(lock.exactWorkerGraph.externalBuiltins, WORKER_BUILTINS);
  for (const [n, hash] of Object.entries(lock.sourceHashes)) pinned(path.join(ROOT, n), hash);
  for (const [n, hash] of Object.entries(lock.compiler.pinnedFiles)) pinned(n, hash);
  for (const [n, hash] of Object.entries(lock.wrapperHashes)) pinned(path.join(OUT, n), hash);
  assert.deepEqual(toolPins(), lock.compiler.pinnedFiles);
  return lock;
}
function matureCompiler(lock) {
  // Load the exact unchanged mature module in a private CommonJS wrapper. Only
  // its eligibility provider is adapted, with a finite list; no require.cache
  // mutations, edits, wildcard eligibility or old release driver imports.
  const C = projectRequire(path.join(TOOLS, 'scoped-core.cjs'));
  const original = projectRequire(path.join(TOOLS, 'source-contract.cjs'));
  const localContract = Object.freeze({ ...original, eligible: n => ELIGIBLE.has(n) && !n.includes('.test.') });
  const module = { exports: {} };
  const code = pinned(path.join(TOOLS, 'runtime-scoped.cjs'), lock.compiler.pinnedFiles[path.join(TOOLS, 'runtime-scoped.cjs')]).toString('utf8');
  const load = name => {
    if (name === './scoped-core.cjs') return C;
    if (name === './source-contract.cjs') return localContract;
    if (name === 'esbuild') return projectRequire('esbuild');
    throw Error('UNAPPROVED_COMPILER_MODULE ' + name);
  };
  vm.runInThisContext('(function(require,module,exports){\n' + code + '\n})', { filename: path.join(TOOLS, 'runtime-scoped.cjs') })(load, module, module.exports);
  return module.exports;
}
async function build() {
  const lock = readLock(), pins = lock.sourceHashes;
  const ts = projectRequire('typescript');
  for (const n of ELIGIBLE) inspectImports(ts, pinned(path.join(ROOT, n), pins[n]).toString('utf8'), n);
  const contract = {
    contractVersion: 'channel-remediation-disabled-runtime-build-v1', mode: 'manual-default-disabled',
    serviceEntry: 'server/channelReference/service.ts', workerEntry: 'server/channelReference/worker.ts',
    workerBasename: 'channel-reference-worker.mjs', effectiveServiceExport: 'lookupChannelReferences',
    configProvisioned: false, cacheProvisioned: false, activeProducerAccepted: false,
    externalBuiltins: BUILTINS, serviceGraphSourceHashes: lock.exactServiceGraph.sourceHashes,
    workerGraphSourceHashes: lock.exactWorkerGraph.sourceHashes,
  };
  const result = await matureCompiler(lock).compileRuntime(ROOT, pins, contract);
  verifyMetafile(result.metafile, SERVICE_FILES, BUILTINS);
  verifyMetafile(result.workerMetafile, WORKER_FILES, WORKER_BUILTINS);
  assert.equal(result.binding.fullActualEntryCompiled, true);
  const runtime = path.join(OUT, 'runtime');
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'channel-reference-service.mjs'), result.bytes);
  fs.writeFileSync(path.join(runtime, 'channel-reference-worker.mjs'), result.workerBytes);
  write('service.metafile.json', result.metafile);
  write('worker.metafile.json', result.workerMetafile);
  // A private audit-only artifact exports unchanged validators. It is never the
  // default service replacement and is never copied into buildOutput/runtime.
  const auditDir = path.join(OUT, 'offline-test', 'audit');
  fs.mkdirSync(auditDir, { recursive: true });
  const auditPins = sorted(Object.fromEntries(['server/channelReference/snapshot.ts', 'server/channelReference/identityBindings.ts', 'shared/channelReferenceBrand.ts'].map(n => [n, pins[n]])));
  const auditReads = {};
  const audit = await projectRequire('esbuild').build({ absWorkingDir: ROOT, stdin: { contents: 'export { validateChannelReferenceSnapshot } from "./server/channelReference/snapshot";\nexport { parseChannelReferenceIdentityBindings } from "./server/channelReference/identityBindings";\n', resolveDir: ROOT, sourcefile: 'offline-audit-entry.ts', loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', target: 'node22', metafile: true, logLevel: 'silent', legalComments: 'none', plugins: [strictPlugin(pins, auditPins, ['node:fs', 'node:fs/promises', 'node:crypto'], auditReads)] });
  assert.deepEqual(sorted(auditReads), auditPins);
  assert.equal(audit.outputFiles.length, 1);
  fs.writeFileSync(path.join(auditDir, 'runtime-audit.mjs'), audit.outputFiles[0].contents);
  write('audit.metafile.json', audit.metafile);
  const scope = JSON.parse(regular('/home/ubuntu/work/channel-reference-fill-20261117/scope-private.json'));
  const checks = [checkSyntax(path.join(runtime, 'channel-reference-service.mjs')), checkSyntax(path.join(runtime, 'channel-reference-worker.mjs')), checkSyntax(path.join(auditDir, 'runtime-audit.mjs'))];
  readLock();
  const manifest = {
    manifestVersion: 'channel-reference-isolated-runtime-build-v1', sourceRoot: ROOT,
    buildOutput: runtime, scope: result.scope, runtimeContract: contract,
    sourceLockSha256: sha(regular(LOCK)), sourceHashes: pins,
    exactServiceGraph: lock.exactServiceGraph, exactWorkerGraph: lock.exactWorkerGraph,
    compiler: lock.compiler, externalBuiltins: BUILTINS,
    sourceDefaultBinding: { ...result.binding, fullActualCompiled: true },
    artifacts: {
      service: { basename: 'channel-reference-service.mjs', sha256: sha(result.bytes), bytes: result.bytes.length, exports: result.exports, externalImports: Object.values(result.metafile.outputs)[0].imports },
      worker: { basename: 'channel-reference-worker.mjs', sha256: sha(result.workerBytes), bytes: result.workerBytes.length, externalImports: Object.values(result.workerMetafile.outputs)[0].imports, compiledRequiredDependency: true, executed: false },
      privateAudit: { path: path.join(auditDir, 'runtime-audit.mjs'), sha256: sha(audit.outputFiles[0].contents), sourceHashes: auditPins, syntheticAuditExportsOnly: true, productionReplacement: false },
    },
    fixedSiblingDefaults: ['channel-reference-snapshot.json', 'channel-reference-identity-bindings.json', 'channel-reference-stock-evidence.json', 'channel-reference-worker.mjs'],
    productionCurrentScope: { referenceRuntimeImports: scope.referenceRuntimeImports, runtime: scope.runtime },
    mainApiCompiled: false, mainApiGenerated: false, appSourceModified: false, appJsonModified: false,
    configProvisioned: false, cacheProvisioned: false, activeProducerAccepted: false,
    workerExecuted: false, noCollectionTimeGenerated: true, checks,
    followUp: 'Parent may patch only the current existing adminAPI module string to its approved new isolated root; original BFF call/permission binding stays unchanged. Copy final data as exact sibling names after final sidecar regeneration. Code does not depend on snapshot/data hashes.',
  };
  write('manifest.json', manifest);
  console.log('Built independent standard service + sibling worker; node --check PASS; worker NOT executed.');
  return manifest;
}
async function checkData(dataDir = DATA, outputDir = path.join(OUT, 'offline-test'), options = {}) {
  readLock();
  const checker = await import(require('node:url').pathToFileURL(path.join(OUT, 'default-loader-check.mjs')).href);
  return checker.checkDefaultLoader({ buildDir: OUT, dataDir: path.resolve(dataDir), outputDir: path.resolve(outputDir), ...options });
}
module.exports = { discover, build, checkData, readLock, SERVICE_FILES, WORKER_FILES, BUILTINS };
if (require.main === module) (async () => {
  const [mode = 'build', dataDir, outputDir] = process.argv.slice(2);
  assert(['freeze', 'build', 'check-data'].includes(mode), 'Usage: build-runtime.cjs freeze|build|check-data [DATA_DIR] [WORK_OUTPUT_DIR]');
  if (mode === 'freeze') await discover();
  else if (mode === 'build') await build();
  else await checkData(dataDir, outputDir);
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
