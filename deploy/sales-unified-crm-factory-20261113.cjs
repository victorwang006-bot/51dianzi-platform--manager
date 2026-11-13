'use strict';

/**
 * Compile the latest CRM route against the ORIGINAL production React/scope/tRPC.
 * Pure builder module: no CLI, deployment, candidate writes, Git, network or DB.
 * Caller scope: const __crmLive = __live; <code>; __SU_CRM_EXPORTS.CrmSalesOrders
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const ts = require('typescript');

const REPO = path.resolve(__dirname, '..');
const BINDING_MAP = '/home/ubuntu/work/sales-unified/live-binding-map.json';
const ENTRY = 'client/src/business/platform/client/src/pages/CrmSalesOrders.tsx';
const NATIVE_NS = 'su-crm-native';
const CSS_NS = 'su-crm-empty-css';
const SOURCE_BRIDGES = new Map([
  ['client/src/business/BusinessScope', 'scope'],
  ['client/src/business/BusinessWorkbenchSession', 'session'],
  ['client/src/business/BusinessContentFrame', 'frame'],
  ['client/src/business/BusinessWorkbenchPage', 'workbench'],
  ['client/src/business/BusinessWorkbenchAccessGate', 'access'],
  ['client/src/business/api/business-trpc', 'trpc'],
  ['client/src/business/api/business-wouter', 'business-wouter'],
]);
const DIRECT_EXPORTS = {
  scope: ['useBusinessScope', 'BusinessScopeProvider', 'BusinessScopeContext'],
  frame: ['default'],
  trpc: ['trpc', 'businessScopeTrpc', 'createBusinessScopeTrpcClient'],
  wouter: ['useLocation', 'useSearch', 'Link', 'Route', 'Router', 'Switch'],
  'business-wouter': ['businessNavigationHrefs', 'useBusinessLocation'],
  sonner: ['toast'],
  query: ['QueryClient', 'QueryClientProvider', 'useQuery'],
  jsx: ['jsx', 'jsxs', 'Fragment'],
};
const sha256 = content => crypto.createHash('sha256').update(content).digest('hex');
const slash = value => value.split(path.sep).join('/');
const stripExt = value => value.replace(/\.(?:[cm]?[jt]sx?)$/, '');
const loaderFor = file => /\.tsx$/.test(file) ? 'tsx' : /\.(?:ts|mts|cts)$/.test(file) ? 'ts' : /\.jsx$/.test(file) ? 'jsx' : 'js';

function resolveLocal(request, resolveDir) {
  if (request.startsWith('@/')) return path.resolve(REPO, 'client/src', request.slice(2));
  if (request.startsWith('@shared/')) return path.resolve(REPO, 'shared', request.slice(8));
  if (path.isAbsolute(request)) return path.normalize(request);
  if (request.startsWith('.')) return path.resolve(resolveDir, request);
  return null;
}

function runtimeImports(text, filename) {
  const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const imports = new Map();
  const add = (request, name) => {
    if (!imports.has(request)) imports.set(request, new Set());
    if (name) imports.get(request).add(name);
  };
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const request = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      add(request);
      if (clause?.name) add(request, 'default');
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) add(request, (item.propertyName || item.name).text);
      } else if (bindings) add(request, '*');
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      const request = statement.moduleSpecifier.text;
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const item of statement.exportClause.elements) add(request, (item.propertyName || item.name).text);
      } else add(request, '*');
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' &&
        node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text, '*');
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return imports;
}

function topLevelRuntimeNames(text, filename) {
  const ast = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set();
  for (const node of ast.statements) {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) names.add(node.name.text);
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }
  return names;
}

/**
 * @param {{minify?: boolean}} [options]
 * @returns {Promise<{code: string, metafile: object, sourceHashes: Record<string,string>}>}
 */
async function compileCrmFactory(options = {}) {
  const { minify = true } = options;
  if (typeof minify !== 'boolean') throw new TypeError('minify must be boolean');
  const snapshots = new Map();
  const importCache = new Map();
  const bridgeRecords = new Map();
  const cssPaths = new Set();
  const nativeSourcePaths = new Set();
  const snapshot = filename => {
    const absolute = path.resolve(filename);
    if (!snapshots.has(absolute)) snapshots.set(absolute, fs.readFileSync(absolute));
    return snapshots.get(absolute);
  };
  const bindings = JSON.parse(snapshot(BINDING_MAP).toString('utf8'));
  for (const key of ['React', 'jsx', 'trpc', 'useBusinessScope', 'BusinessContentFrame']) {
    if (!Object.hasOwn(bindings, key)) throw new Error(`Native binding map missing mandatory key: ${key}`);
  }
  const sourceNames = new Map();

  function bridge(kind, args, sourcePath) {
    const imports = importCache.get(args.importer);
    const requested = [...(imports?.get(args.path) || [])].sort();
    if (!imports || !imports.has(args.path)) {
      throw new Error(`Cannot prove runtime imports for native ${kind}: ${args.path} from ${args.importer}`);
    }
    if (kind !== 'react' && kind !== 'jsx' && requested.includes('*')) {
      throw new Error(`Native ${kind} namespace import is not authorized; import exact runtime keys: ${args.importer}`);
    }
    if (['session', 'workbench', 'access'].includes(kind) && !sourceNames.has(kind)) {
      const filename = [sourcePath, sourcePath + '.ts', sourcePath + '.tsx']
        .find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (!filename) throw new Error(`Missing native source for ${kind}: ${sourcePath}`);
      sourceNames.set(kind, topLevelRuntimeNames(snapshot(filename).toString('utf8'), filename));
    }
    if (kind !== 'react') {
      for (const name of requested) {
        if (name === '*' && kind === 'jsx') continue;
        const allowed = DIRECT_EXPORTS[kind]?.includes(name) || sourceNames.get(kind)?.has(name);
        if (!allowed) throw new Error(`Unknown native ${kind} export ${name}, imported by ${args.importer}`);
        const key = kind === 'frame' && name === 'default' ? 'BusinessContentFrame' : name;
        if (kind !== 'jsx' && !Object.hasOwn(bindings, key)) {
          throw new Error(`Missing __live.${key}: ${kind} ${args.path}, imported by ${args.importer}; cannot bundle a second native context/API`);
        }
      }
    }
    const id = ['react', 'jsx'].includes(kind) ? kind : `${kind}:${Buffer.from(JSON.stringify(requested)).toString('base64url')}`;
    if (!bridgeRecords.has(id)) bridgeRecords.set(id, { kind, requested, importers: new Set(), sourcePath });
    else bridgeRecords.get(id).requested = [...new Set([...bridgeRecords.get(id).requested, ...requested])].sort();
    bridgeRecords.get(id).importers.add(slash(path.relative(REPO, args.importer)));
    if (sourcePath) {
      const nativeFile = [sourcePath, sourcePath + '.ts', sourcePath + '.tsx', sourcePath + '.js']
        .find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (nativeFile) { snapshot(nativeFile); nativeSourcePaths.add(nativeFile); }
    }
    return { path: id, namespace: NATIVE_NS };
  }

  const result = await esbuild.build({
    absWorkingDir: REPO,
    stdin: {
      contents: `export { default as CrmSalesOrders, CustomerSalesOrders } from ${JSON.stringify('./' + ENTRY)};`,
      sourcefile: 'sales-unified-crm-entry.mjs', resolveDir: REPO, loader: 'js',
    },
    alias: { '@': path.join(REPO, 'client/src'), '@shared': path.join(REPO, 'shared') },
    bundle: true, write: false, format: 'iife', globalName: '__SU_CRM_EXPORTS',
    platform: 'browser', target: 'es2020', jsx: 'automatic', minify,
    treeShaking: true, metafile: true, sourcemap: false, legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    plugins: [{
      name: 'sales-unified-crm-reuse-production-native-bindings',
      setup(build) {
        build.onResolve({ filter: /.*/ }, args => {
          if (args.namespace === NATIVE_NS || args.namespace === CSS_NS) return;
          const local = resolveLocal(args.path, args.resolveDir);
          if (/\.css(?:\?.*)?$/.test(args.path)) {
            const filename = local?.replace(/\?.*$/, '');
            if (!filename || !fs.existsSync(filename)) throw new Error(`Missing CSS dependency: ${args.path}`);
            snapshot(filename); cssPaths.add(filename);
            return { path: filename, namespace: CSS_NS };
          }
          if (args.path === 'react') return bridge('react', args);
          if (args.path === 'react/jsx-runtime') return bridge('jsx', args);
          if (args.path.startsWith('react/')) throw new Error(`Unsupported React subpath: ${args.path}`);
          if (args.path === 'wouter') return bridge('wouter', args);
          if (args.path.startsWith('wouter/')) throw new Error(`Unsupported wouter subpath: ${args.path}`);
          if (args.path === 'sonner') return bridge('sonner', args);
          if (args.path === '@tanstack/react-query') return bridge('query', args);
          if (args.path === 'react-dom/client' || args.path === 'react-dom/server' || args.path.startsWith('@trpc/')) {
            throw new Error(`Forbidden new React root/server/API dependency: ${args.path}, importer ${args.importer}`);
          }
          if (local) {
            const relative = slash(path.relative(REPO, stripExt(local)));
            const kind = SOURCE_BRIDGES.get(relative);
            if (kind) return bridge(kind, args, local);
            if (/(?:^|\/)(?:lib|api)\/(?:business-)?trpc(?:$|\/)/i.test(relative) ||
                /^client\/src\/business\/platform\/(?:front-router-types|server)\//.test(relative) ||
                /^server\//.test(relative)) {
              throw new Error(`Unbridged API/server dependency: ${relative}, importer ${args.importer}`);
            }
            if (/^client\/src\/(?:business\/platform\/client\/src\/)?pages\//.test(relative) && stripExt(local) !== stripExt(path.join(REPO, ENTRY))) {
              throw new Error(`CRM-only builder cannot bundle another page: ${relative}`);
            }
          }
        });
        build.onLoad({ filter: /.*/, namespace: CSS_NS }, () => ({ contents: '', loader: 'js' }));
        build.onLoad({ filter: /.*/, namespace: NATIVE_NS }, args => {
          const { kind, requested } = bridgeRecords.get(args.path);
          if (kind === 'react') {
            return { loader: 'js', contents: `if (!__crmLive.React) throw new Error("Missing __live.React"); module.exports = __crmLive.React.default || __crmLive.React;` };
          }
          if (kind === 'jsx') {
            return { loader: 'js', contents: `if (!__crmLive.jsx) throw new Error("Missing __live.jsx"); module.exports = __crmLive.jsx;` };
          }
          const lines = [];
          for (const [index, name] of requested.entries()) {
            const key = kind === 'frame' && name === 'default' ? 'BusinessContentFrame' : name;
            const expression = kind === 'jsx' ? `__crmLive.jsx[${JSON.stringify(name)}]` : `__crmLive[${JSON.stringify(key)}]`;
            const variable = `__binding${index}`;
            lines.push(`const ${variable} = ${expression}; if (${variable} === undefined) throw new Error(${JSON.stringify('Missing native binding: ' + (kind === 'jsx' ? 'jsx.' : '') + key)});`);
            lines.push(name === 'default' ? `export default ${variable};` : `export { ${variable} as ${name} };`);
          }
          return { contents: lines.join('\n'), loader: 'js' };
        });
        build.onLoad({ filter: /\.(?:[cm]?[jt]sx?)$/, namespace: 'file' }, async args => {
          const contents = snapshot(args.path).toString('utf8');
          const loader = loaderFor(args.path);
          const emitted = loader === 'js' ? contents : (await esbuild.transform(contents, {
            loader, jsx: 'automatic', target: 'es2020', format: 'esm',
          })).code;
          importCache.set(args.path, runtimeImports(emitted, args.path));
          return { contents, loader, resolveDir: path.dirname(args.path) };
        });
      },
    }],
  });

  if (result.outputFiles.length !== 1) throw new Error('Expected exactly one in-memory JavaScript output');
  const code = result.outputFiles[0].text;
  const forbiddenInputs = Object.keys(result.metafile.inputs).filter(input => {
    if (input.startsWith(NATIVE_NS + ':') || input.startsWith(CSS_NS + ':')) return false;
    return /(?:^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:react(?:\/|$)|wouter(?:\/|$)|sonner(?:\/|$)|@trpc\/|@tanstack\/react-query\/)/.test(input) ||
      /(?:^|\/)BusinessScope\.[jt]sx?$/.test(input) ||
      /(?:^|\/)BusinessWorkbench(?:Session|Page|AccessGate)\.[jt]sx?$/.test(input) ||
      /(?:^|\/)BusinessContentFrame\.[jt]sx?$/.test(input) ||
      /(?:^|\/)business-trpc\.[jt]sx?$/.test(input) ||
      /(?:^|\/)react-dom\/(?:client|server)(?:\.|\/|$)/.test(input) ||
      /(?:^|\/)react-dom\/cjs\/react-dom-(?:client|server)/.test(input) ||
      /(?:^|\/)server\//.test(input);
  });
  if (forbiddenInputs.length) throw new Error('Forbidden duplicated native/API inputs: ' + forbiddenInputs.join(', '));
  for (const output of Object.values(result.metafile.outputs)) {
    if (output.imports.length) throw new Error('Factory must be self-contained: ' + JSON.stringify(output.imports));
    if (output.exports.length && output.exports.some(name => name !== 'CrmSalesOrders')) throw new Error('Unexpected factory exports');
  }
  if (/\b(?:createRoot|hydrateRoot|createTRPCReact|createTRPCClient|QueryClientProvider)\s*\(/.test(code)) {
    throw new Error('Factory appears to create a second root or query/API provider');
  }
  const sourceHashes = {};
  for (const [filename, bytes] of snapshots) {
    if (!fs.readFileSync(filename).equals(bytes)) throw new Error(`Source changed during compilation; rerun compileCrmFactory(): ${filename}`);
    if (filename.startsWith(REPO + path.sep) && !filename.includes(path.sep + 'node_modules' + path.sep)) {
      sourceHashes[slash(path.relative(REPO, filename))] = sha256(bytes);
    } else if (filename === BINDING_MAP) sourceHashes[filename] = sha256(bytes);
  }
  const inputs = Object.keys(result.metafile.inputs);
  const retainedInputs = Object.keys(Object.values(result.metafile.outputs)[0].inputs)
    .filter(input => Object.values(result.metafile.outputs)[0].inputs[input].bytesInOutput > 0);
  result.metafile.crmFactory = {
    globalName: '__SU_CRM_EXPORTS', exports: ['CrmSalesOrders'], nativeReference: '__crmLive',
    builderSha256: sha256(fs.readFileSync(__filename)), entry: ENTRY,
    bridges: [...bridgeRecords.values()].map(record => ({
      kind: record.kind, exports: record.requested, importers: [...record.importers].sort(),
    })).sort((a, b) => (a.kind + a.exports.join(',')).localeCompare(b.kind + b.exports.join(','))),
    nativeSourcePathsNotBundled: [...nativeSourcePaths].map(file => slash(path.relative(REPO, file))).sort(),
    cssImports: [...cssPaths].map(file => slash(path.relative(REPO, file))).sort(),
    counts: {
      inputs: inputs.length,
      nativeBridgeModules: inputs.filter(input => input.startsWith(NATIVE_NS + ':')).length,
      emptyCssModules: inputs.filter(input => input.startsWith(CSS_NS + ':')).length,
      sourceModules: inputs.filter(input => input.startsWith('client/') || input.startsWith('shared/')).length,
      nodeModules: inputs.filter(input => input.includes('node_modules/')).length,
      sourceHashes: Object.keys(sourceHashes).length, codeBytes: Buffer.byteLength(code),
      retainedModules: retainedInputs.length,
      retainedSourceModules: retainedInputs.filter(input => input.startsWith('client/') || input.startsWith('shared/')).length,
      retainedNodeModules: retainedInputs.filter(input => input.includes('node_modules/')).length,
      forbiddenNativeApiInputs: forbiddenInputs.length,
    },
    metadataPageIntegrated: inputs.some(input => /components\/businessSalesOrderMetadata\.tsx$/.test(input)),
    checks: { noCopiedReact: true, noCopiedScope: true, noCopiedApi: true, noNewRoot: true, noOutputImports: true, sourceSnapshotStable: true },
  };
  return { code, metafile: result.metafile, sourceHashes: Object.fromEntries(Object.entries(sourceHashes).sort(([a], [b]) => a.localeCompare(b))) };
}

module.exports = { compileCrmFactory };
