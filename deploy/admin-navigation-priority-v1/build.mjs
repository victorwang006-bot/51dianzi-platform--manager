#!/usr/bin/env node
/** Offline only. Never calls ssh/scp, pnpm build (which includes server), or deploy. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { assembleHtml, RELEASE, BASELINE, sha } from './lib.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const toolDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORK = '/home/ubuntu/backend-optimization/admin-navigation-priority-v1';
async function toolEvidence() {
  return Promise.all(['build.mjs', 'lib.mjs', 'vite-worker.mjs', 'publish.py'].map(async name => ({ path: `deploy/admin-navigation-priority-v1/${name}`, sha256: sha(await fs.readFile(path.join(toolDir, name))) })));
}
const roots = ['client', 'shared', 'server', 'drizzle', 'tests', 'patches', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts'];
const tests = [
  'client/src/components/DashboardLayout.navigation.test.ts',
  'client/src/components/admin/AdminWorkspaceNavigation.business-dropdown.test.ts',
  'client/src/components/admin/AdminWorkspaceNavigation.unified-dropdown.test.ts',
  'client/src/components/admin/AdminWorkspaceNavigation.location.test.ts',
  'client/src/components/admin/adminWorkspaceNavigation.render.test.ts',
  'client/src/components/admin/adminWorkspaceNavigationModel.test.ts',
  'client/src/business/platform/client/src/pages/CustomerList.render.test.ts',
  'client/src/business/platform/client/src/pages/ChannelInventoryHost.render.test.ts',
  'client/src/business/platform/client/src/pages/ChannelInventoryHost.navigation.render.test.ts',
  'client/src/business/platform/client/src/pages/ChannelInventoryHost.management.render.test.ts',
  'client/src/business/platform/client/src/components/channelInventory/BatchUpload.management.render.test.ts',
  'client/src/business/platform/client/src/components/channelInventory/ChannelInventoryBrowsePanel.render.test.ts',
  'client/src/business/platform/client/src/components/channelInventory/ChannelInventoryManagementPanel.render.test.ts',
  'client/src/business/platform/client/src/components/channelInventory/ChannelInventorySourcePanel.test.ts',
  'client/src/business/platform/client/src/components/customers/CustomerSupply.render.test.ts',
  'client/src/business/platform/client/src/components/customers/CustomerDraftIndustry.render.test.ts',
];
async function listFiles(root) {
  const files = [];
  async function visit(rel) {
    const p = path.join(root, rel), s = await fs.lstat(p);
    assert.ok(!s.isSymbolicLink(), `source symlink forbidden: ${rel}`);
    assert.ok(!/(^|\/)(?:\.env(?:\.|$)|\.git(?:\/|$))|\.(?:pem|key|p12)$/i.test(rel), 'secret/non-source filename forbidden');
    if (s.isDirectory()) { for (const n of (await fs.readdir(p)).sort()) await visit(path.join(rel, n)); }
    else { assert.ok(s.isFile(), `non-file source: ${rel}`); files.push({ path: rel, sha256: sha(await fs.readFile(p)), bytes: s.size }); }
  }
  for (const r of roots) { try { await visit(r); } catch (e) { if (e.code !== 'ENOENT' || r !== 'patches') throw e; } }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
const digestTree = files => sha(JSON.stringify(files));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
async function baseline(dir) {
  const result = {};
  for (const [name, expected] of Object.entries(BASELINE)) {
    const bytes = await fs.readFile(path.join(dir, name));
    assert.equal(sha(bytes), expected, `baseline drift: ${name}`); result[name] = bytes;
  }
  return result;
}
function cleanEnv(nodeEnv = 'production') {
  // Never load .env or pass injected credentials to the build/typecheck/test children.
  const allowed = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR'];
  const env = Object.fromEntries(allowed.filter(k => process.env[k]).map(k => [k, process.env[k]]));
  return { ...env, NODE_ENV: nodeEnv, VITE_BASE_PATH: '/', CI: 'true', NO_COLOR: '1', FORCE_COLOR: '0' };
}
async function run(command, args, cwd, logPath, nodeEnv = 'production') {
  console.log(`Running ${command} ${args.join(' ')} (log: ${logPath})`);
  const fd = await fs.open(logPath, 'w', 0o600), start = new Date().toISOString();
  let r;
  try { r = spawnSync(command, args, { cwd, env: cleanEnv(nodeEnv), stdio: ['ignore', fd.fd, fd.fd], timeout: 15 * 60 * 1000 }); }
  finally { await fd.close(); }
  const evidence = { command: [command, ...args], cwd, nodeEnv, startedAt: start, finishedAt: new Date().toISOString(), exitCode: r.status, signal: r.signal, log: path.basename(logPath), logSha256: sha(await fs.readFile(logPath)) };
  console.log(`Finished ${command}: exit ${r.status}`);
  if (r.error || r.status !== 0) { await fs.writeFile(logPath + '.result.json', JSON.stringify(evidence, null, 2) + '\n'); throw Error(`STOP: actual command failed; see ${logPath}`); }
  return evidence;
}
async function dependencyEvidence() {
  const rows = [];
  for (const name of ['vite', 'typescript', 'vitest', 'react', 'react-dom', 'esbuild', '@tailwindcss/vite', '@vitejs/plugin-react', '@builder.io/vite-plugin-jsx-loc', 'vite-plugin-manus-runtime', 'wouter']) {
    const p = path.join(repo, 'node_modules', name, 'package.json'), b = await fs.readFile(p);
    rows.push({ name, version: JSON.parse(b).version, manifestSha256: sha(b), realPath: await fs.realpath(path.dirname(p)) });
  }
  return rows;
}
async function freeze(work, baselineDir) {
  assert.ok(!work.startsWith(repo + '/'), 'work must be outside shared repository');
  const files = await listFiles(repo), treeSha256 = digestTree(files), deps = await dependencyEvidence();
  await baseline(baselineDir);
  const runDir = path.join(work, `${treeSha256.slice(0, 12)}-${Date.now()}`);
  await fs.mkdir(path.join(runDir, 'source'), { recursive: true });
  for (const f of files) {
    const dst = path.join(runDir, 'source', f.path); await fs.mkdir(path.dirname(dst), { recursive: true });
    const b = await fs.readFile(path.join(repo, f.path)); assert.equal(sha(b), f.sha256, `source changed during freeze: ${f.path}`); await fs.writeFile(dst, b);
  }
  assert.equal(digestTree(await listFiles(repo)), treeSha256, 'source changed during freeze; retry only after actual source freeze');
  assert.equal(digestTree(await listFiles(path.join(runDir, 'source'))), treeSha256, 'snapshot mismatch');
  await fs.symlink(path.join(repo, 'node_modules'), path.join(runDir, 'source/node_modules'), 'dir');
  await fs.mkdir(path.join(runDir, 'baseline'));
  const b = await baseline(baselineDir); for (const [name, bytes] of Object.entries(b)) await fs.writeFile(path.join(runDir, 'baseline', name), bytes);
  const record = { schemaVersion: 1, release: RELEASE, task: 'FCQEBhhCo90HxcTxZAQUMk', sourceRepository: repo, sourceCommit: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), gitStatus: git('status', '--short'), workingTreeSnapshotNotClaimedCommitted: true, frozenAt: new Date().toISOString(), sourceTreeSha256: treeSha256, sourceFiles: files, toolFiles: await toolEvidence(), dependencies: deps, baseline: BASELINE, buildEnvironment: { base: '/', mode: 'production', envFilesLoaded: false, inheritedViteValuesUsed: false, optionalAnalytics: false, serverEnvChanged: false } };
  record.runtimeVersions = { node: process.version, pnpm: execFileSync('pnpm', ['--version'], { cwd: repo, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() };
  const recordPath = path.join(runDir, 'freeze.json'); await fs.writeFile(recordPath, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'frozen-offline-source', freezeRecord: recordPath, sourceCommit: record.sourceCommit, sourceTreeSha256: treeSha256, files: files.length, command: `node ${path.join(toolDir, 'build.mjs')} --build --freeze-record ${recordPath}` }, null, 2));
}
async function build(recordPath) {
  const runDir = path.dirname(recordPath), source = path.join(runDir, 'source'), packageDir = path.join(runDir, 'package'), evidenceDir = path.join(packageDir, 'evidence');
  const recordBytes = await fs.readFile(recordPath), record = JSON.parse(recordBytes);
  assert.equal(record.release, RELEASE); assert.equal(record.schemaVersion, 1);
  assert.equal(digestTree(await listFiles(source)), record.sourceTreeSha256, 'frozen snapshot changed');
  assert.equal(digestTree(await listFiles(repo)), record.sourceTreeSha256, 'working source changed after freeze; re-freeze required');
  assert.equal(git('rev-parse', 'HEAD'), record.sourceCommit, 'HEAD moved after freeze');
  assert.deepEqual(await dependencyEvidence(), record.dependencies, 'installed dependency manifests changed');
  assert.deepEqual(await toolEvidence(), record.toolFiles, 'build/publish tool changed after freeze');
  const captured = await baseline(path.join(runDir, 'baseline'));
  assert.ok(!await fs.stat(path.join(packageDir, 'manifest.json')).then(() => true, () => false), 'final package already exists; do not replay');
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(path.join(evidenceDir, 'freeze.json'), recordBytes);
  const checks = [];
  checks.push(await run('pnpm', ['exec', 'tsc', '--noEmit', '--incremental', 'false'], source, path.join(evidenceDir, 'typecheck.log')));
  const existingTests = tests.filter(t => record.sourceFiles.some(f => f.path === t));
  assert.ok(existingTests.length >= 13, 'required regression test suite absent');
  // Include new render/spec tests in the exact customer/priority/inline area once agents finish.
  const added = record.sourceFiles.filter(f => /(?:CustomerList|CustomerPriority|CustomerDelegated|CustomerCreate|CustomerStars|CustomerActions|CustomerInline|customerPriority|customerStars|CustomerSupply|CustomerDemand|AdminWorkspaceNavigation|adminWorkspaceNavigation).*\.(?:test|spec)\.tsx?$/.test(f.path) || /^client\/src\/business\/platform\/client\/src\/components\/customers\/.*\.(?:test|spec)\.tsx?$/.test(f.path)).map(f => f.path);
  const regressionTests = [...new Set([...existingTests, ...added])].sort();
  await fs.writeFile(path.join(source, 'priority-vitest.config.mjs'), `import original from './vitest.config.ts';export default {...original,test:{...original.test,include:${JSON.stringify(regressionTests)}}};\n`);
  await fs.writeFile(path.join(evidenceDir, 'regression-test-files.json'), JSON.stringify(regressionTests, null, 2) + '\n');
  checks.push(await run('pnpm', ['exec', 'vitest', 'run', '--config', 'priority-vitest.config.mjs'], source, path.join(evidenceDir, 'regression-tests.log'), 'test'));
  const namespace = `${RELEASE}-${record.sourceTreeSha256.slice(0, 12)}`;
  checks.push(await run(process.execPath, [path.join(toolDir, 'vite-worker.mjs'), source, path.join(runDir, 'frontend'), namespace, path.join(evidenceDir, 'rollup-modules.json')], source, path.join(evidenceDir, 'frontend-build.log')));
  const modules = JSON.parse(await fs.readFile(path.join(evidenceDir, 'rollup-modules.json'), 'utf8'));
  const requiredModules = ['client/src/components/admin/AdminWorkspaceNavigation.tsx', 'client/src/components/admin/AdminWorkspaceNavigation.css', 'client/src/components/DashboardLayout.tsx', 'client/src/business/platform/client/src/pages/CustomerList.tsx', 'client/src/business/platform/client/src/pages/CustomerList.css', 'client/src/business/platform/client/src/hooks/useCustomerStars.ts', 'client/src/business/platform/client/src/pages/ChannelInventoryHost.tsx', 'client/src/business/platform/client/src/components/channelInventory/ChannelInventoryManagementPanel.tsx', 'client/src/business/platform/client/src/components/channelInventory/BatchUpload.tsx', 'client/src/lib/channelInventoryNavigation.ts'];
  const bundled = new Set(modules.flatMap(c => c.modules));
  for (const required of requiredModules) assert.ok(bundled.has(required), `required current source not bundled: ${required}`);
  assert.ok(![...bundled].some(p => p.startsWith('server/')), 'server runtime bundled');
  const frontend = path.join(runDir, 'frontend'), assetDir = path.join(frontend, 'assets', namespace), assets = [];
  async function copyAssets(rel = '') {
    for (const n of (await fs.readdir(path.join(assetDir, rel))).sort()) {
      const r = path.join(rel, n), p = path.join(assetDir, r), st = await fs.lstat(p);
      assert.ok(!st.isSymbolicLink()); if (st.isDirectory()) { await copyAssets(r); continue; }
      assert.ok(st.isFile()); const b = await fs.readFile(p), publicPath = `assets/${namespace}/${r}`;
      assert.ok(!/\.(?:map|html)$/.test(r), 'unexpected asset type');
      const dst = path.join(packageDir, publicPath); await fs.mkdir(path.dirname(dst), { recursive: true }); await fs.writeFile(dst, b);
      assets.push({ path: publicPath, sha256: sha(b), bytes: b.length });
    }
  }
  await copyAssets(); assert.ok(assets.length >= 2);
  const js = (await Promise.all(assets.filter(a => a.path.endsWith('.js')).map(a => fs.readFile(path.join(packageDir, a.path), 'utf8')))).join('\n');
  for (const token of ['deleteMaterials', 'restoreMaterial', 'listDeletedMaterials', 'listUploadBatches', 'deleteUploadBatch', 'previewDeleteUploadBatch', 'ciTab', '回收站', '上传批次', '/api/trpc', '/api/business-trpc']) assert.ok(js.includes(token), `feature/API marker absent: ${token}`);
  assert.ok(!js.includes('/admin/api/trpc'), 'wrong API base');
  const builtHtml = await fs.readFile(path.join(frontend, 'index.html'), 'utf8');
  const { html: candidate, edits } = assembleHtml(captured['index.html'].toString('utf8'), builtHtml, namespace);
  assert.ok(!/%VITE_[A-Z0-9_]+%/.test(candidate + js), 'unresolved Vite placeholder');
  const rootAssets = [];
  for (const f of record.sourceFiles.filter(f => f.path.startsWith('client/public/'))) rootAssets.push({ path: f.path.slice('client/public/'.length), sha256: f.sha256, bytes: f.bytes });
  for (const a of rootAssets) assert.equal(sha(await fs.readFile(path.join(frontend, a.path))), a.sha256, 'public file changed during build');
  assert.equal(digestTree(await listFiles(source)), record.sourceTreeSha256, 'snapshot drift during build');
  assert.equal(digestTree(await listFiles(repo)), record.sourceTreeSha256, 'shared source drift; candidate not releasable; re-freeze');
  assert.deepEqual(await dependencyEvidence(), record.dependencies, 'dependencies drift during build');
  assert.deepEqual(await toolEvidence(), record.toolFiles, 'build/publish tool changed during build');
  await fs.writeFile(path.join(packageDir, 'candidate-index.html'), candidate);
  await fs.writeFile(path.join(evidenceDir, 'html-edits.json'), JSON.stringify(edits, null, 2) + '\n');
  await fs.writeFile(path.join(evidenceDir, 'checks.json'), JSON.stringify(checks, null, 2) + '\n');
  await fs.copyFile(path.join(frontend, '.vite/manifest.json'), path.join(evidenceDir, 'vite-manifest.json'));
  const evidence = []; for (const n of (await fs.readdir(evidenceDir)).sort()) { const b = await fs.readFile(path.join(evidenceDir, n)); evidence.push({ path: `evidence/${n}`, sha256: sha(b), bytes: b.length }); }
  const manifest = { schemaVersion: 1, release: RELEASE, task: record.task, kind: 'frozen-full-production-frontend', sourceCommit: record.sourceCommit, sourceTreeSha256: record.sourceTreeSha256, sourceSnapshotContainsUncommittedChanges: record.gitStatus.length > 0, sourceFreezeSha256: sha(recordBytes), generatedAt: new Date().toISOString(), namespace, baseline: BASELINE, assets, rootAssetsMustRemainUnchanged: rootAssets, html: { path: 'candidate-index.html', sha256: sha(candidate), bytes: Buffer.byteLength(candidate) }, evidence, checks: checks.map(c => ({ command: c.command, exitCode: c.exitCode, logSha256: c.logSha256 })), requiredSourceModules: requiredModules, guard: { actualTypecheckPassed: true, actualRegressionTestsPassed: true, frontendOnlyProductionBuildPassed: true, sourceStable: true, isolatedNoEnvFiles: true, currentChannelFeaturesBundled: true, oldHtmlOtherBytesPreserved: true, oldAssetsNeverDeleted: true, serverBundleBuilt: false, productionDeploymentPerformed: false }, qaRequiredBeforeApply: ['Parent verifies exact frozen source and authorized-fixture navigation/customer interaction regressions; no production business writes.', 'Read-only fresh production baseline and effective server API compatibility check; no API migration is part of this release.'] };
  await fs.writeFile(path.join(packageDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ ok: true, offlineOnly: true, packageDir, manifest: path.join(packageDir, 'manifest.json'), sourceCommit: record.sourceCommit, sourceTreeSha256: record.sourceTreeSha256, assets: assets.length, htmlSha256: manifest.html.sha256 }, null, 2));
}
async function main() {
  const args = process.argv.slice(2); const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const known = new Set(['--help', '--freeze', '--build', '--work', '--baseline', '--freeze-record']);
  for (let i = 0; i < args.length; i++) { assert.ok(known.has(args[i]), `unknown option ${args[i]}`); if (['--work', '--baseline', '--freeze-record'].includes(args[i])) assert.ok(args[++i] && !args[i].startsWith('--'), 'option requires value'); }
  if (!args.length || args.includes('--help')) { console.log('Offline only. Usage:\n  node deploy/admin-navigation-priority-v1/build.mjs --freeze [--work /absolute/isolated/work] [--baseline /home/ubuntu/backend-optimization/baseline]\n  node deploy/admin-navigation-priority-v1/build.mjs --build --freeze-record /absolute/run/freeze.json\nFreeze only after other source agents finish. Build executes real tsc, selected tests and Vite frontend-only. No .env loading or server build.'); return; }
  assert.equal(Number(args.includes('--freeze')) + Number(args.includes('--build')), 1, 'choose exactly one operation');
  if (args.includes('--freeze')) await freeze(path.resolve(value('--work') || DEFAULT_WORK), path.resolve(value('--baseline') || '/home/ubuntu/backend-optimization/baseline'));
  else { assert.ok(value('--freeze-record'), '--freeze-record required'); await build(path.resolve(value('--freeze-record'))); }
}
main().catch(e => { console.error(`STOP: ${e.message}`); process.exitCode = 1; });
