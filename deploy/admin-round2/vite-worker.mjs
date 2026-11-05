#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [source, outDir, namespace, moduleEvidence] = process.argv.slice(2);
assert.ok(source && outDir && namespace && moduleEvidence);
assert.equal(process.env.NODE_ENV, 'production');
assert.equal(process.env.VITE_BASE_PATH, '/');
assert.ok(Object.keys(process.env).filter(k => k.startsWith('VITE_')).every(k => k === 'VITE_BASE_PATH'));
const require = createRequire(path.join(source, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
const envDir = path.join(source, '.round2-empty-env'); await fs.mkdir(envDir, { recursive: true });
assert.equal((await fs.readdir(envDir)).length, 0);
const modules = [];
await build({ configFile: path.join(source, 'vite.config.ts'), root: path.join(source, 'client'), envDir, base: '/', mode: 'production',
  build: { outDir, emptyOutDir: true, assetsDir: `assets/${namespace}`, manifest: true, sourcemap: false },
  plugins: [{ name: 'offline-source-to-chunk-evidence', generateBundle(_options, bundle) {
    for (const value of Object.values(bundle)) if (value.type === 'chunk') modules.push({ file: value.fileName, imports: value.imports, dynamicImports: value.dynamicImports, modules: Object.keys(value.modules).filter(p => p.startsWith(source + '/')).map(p => path.relative(source, p).replace(/\?.*$/, '')).sort() });
  } }],
});
await fs.writeFile(moduleEvidence, JSON.stringify(modules.sort((a, b) => a.file.localeCompare(b.file)), null, 2) + '\n');
console.log('Manager frontend-only Vite completed. Empty envDir. No deploy, install, worker build, or front UI build.');
