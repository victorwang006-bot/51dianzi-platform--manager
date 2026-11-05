#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [rootArg, outputArg, side] = process.argv.slice(2);
assert.ok(rootArg && outputArg && ['front','admin'].includes(side));
const root = path.resolve(rootArg), output = path.resolve(outputArg);
assert.ok(!output.startsWith(root + '/'));
const require = createRequire(path.join(root,'package.json'));
const { build } = await import(pathToFileURL(require.resolve('esbuild')).href);
const plugins = side === 'front' ? [{
  name: 'bundle-address-region-dictionary',
  setup(builder) {
    builder.onResolve({ filter: /^@province-city-china\/level\/level\.json$/ }, () => ({ path: require.resolve('@province-city-china/level/level.json') }));
  },
}] : [];
await fs.promises.mkdir(path.dirname(output), {recursive:true});
const result = await build({ absWorkingDir:root, entryPoints:[path.join(root,'server/_core/index.ts')], platform:'node',packages:'external',bundle:true,format:'esm',outfile:output,logLevel:'info',metafile:true,plugins,
  ...(side === 'admin' ? {external:['./vite-dev']} : {}),
});
await fs.promises.writeFile(output+'.metafile.json', JSON.stringify(result.metafile,null,2)+'\n');
console.log(`API entry built: ${side}. No worker, env, data or production operation.`);
