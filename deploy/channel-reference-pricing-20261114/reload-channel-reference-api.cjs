#!/usr/bin/env node
'use strict';
// Existing daemon only; exact original ids/path/CWD/environment; empty env overlay.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = '/opt/ops/20261114-channel-reference-pricing-CKSZQ7s';
const COORD = '/opt/ops/51-project-release-coordination-20261027.json';
const TASK = 'CKSZQ7sVc7tADM21c3LWpu';
const ADMIN = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sha = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const fail = () => { throw Error('TARGETED_RELOAD_CONTRACT_FAILED'); };
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const project = row => ({ id: row.pm_id, name: row.name, pid: row.pid,
  status: row.pm2_env.status, script: row.pm2_env.pm_exec_path, cwd: row.pm2_env.pm_cwd,
  execMode: row.pm2_env.exec_mode, environmentHash: digest(row.pm2_env.env || {}) });
const config = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['pid', 'status'].includes(key)));
function helperPath(relative) {
  if (!['channel-reference-service.mjs', 'channel-reference-snapshot.json'].includes(relative)) fail();
  return path.join(ROOT, relative);
}
function safeFile(relative) {
  if (typeof relative !== 'string' || !/^[A-Za-z0-9._/-]{1,240}$/.test(relative) || relative.split('/').some(x => ['', '.', '..'].includes(x)) || path.isAbsolute(relative)) fail();
  const file = path.join(ROOT, relative);
  if (!fs.realpathSync(file).startsWith(fs.realpathSync(ROOT) + path.sep) || !fs.lstatSync(file).isFile()) fail();
  for (let p = file; p !== ROOT; p = path.dirname(p)) if (fs.lstatSync(p).isSymbolicLink()) fail();
  return file;
}
function verifyHelpers(manifest) {
  const items = manifest.standaloneHelpers;
  if (manifest.contractVersion !== 'snapshot-pricing-v1' || manifest.snapshotOnly !== true || 'browserPackage' in manifest
    || !Array.isArray(items) || items.length !== 2 || new Set(items.map(x => x.relative)).size !== 2 || digest(items) !== digest(manifest.runtimeHelpers)) fail();
  for (const item of items) {
    if (Object.keys(item).sort().join(',') !== 'relative,sha256' || !/^[0-9a-f]{64}$/.test(item.sha256)) fail();
    if (sha(safeFile(item.relative)) !== item.sha256 || safeFile(item.relative) !== helperPath(item.relative)) fail();
  }
  if (!manifest.packageHashes || !manifest.sourceHashes) fail();
  for (const [relative, hash] of Object.entries(manifest.packageHashes)) {
    if (relative === 'manifest.json' || /^(browser\/|channel-reference-worker|worker-metafile)/.test(relative) || !/^[0-9a-f]{64}$/.test(hash) || sha(safeFile(relative)) !== hash) fail();
  }
  for (const [relative, hash] of Object.entries(manifest.sourceHashes)) {
    const allowed = /^(client|server|shared)\//.test(relative)
      || (['package.json', 'pnpm-lock.yaml', 'tsconfig.json'].includes(relative)
        && manifest.priorSourceHashes?.[relative] === hash && Array.isArray(manifest.newSourceGraphPaths)
        && !manifest.newSourceGraphPaths.includes(relative));
    if (!allowed || !/^[0-9a-f]{64}$/.test(hash) || sha(safeFile('source-snapshot/' + relative)) !== hash) fail();
  }
  const binding = manifest.snapshotBinding, readiness = json(safeFile('snapshot-readiness-proof.json'));
  if (!binding || binding.snapshotFile !== 'channel-reference-snapshot.json' || binding.fileSha256 !== sha(helperPath(binding.snapshotFile))
    || readiness.status !== 'PASS' || readiness.ready !== true || readiness.snapshotBinding?.fileSha256 !== binding.fileSha256
    || digest(readiness.snapshotBinding) !== digest(binding) || readiness.recordCount !== 294 || readiness.capturedCount !== 299
    || binding.notGitPrivateInventory !== true) fail();
}
function verifyIntent(intents, snapshot, backend, attemptId) {
  if (!Array.isArray(intents)) fail();
  const ids = new Set();
  for (const intent of intents) {
    const original = snapshot.find(row => row.id === intent.id);
    if (!attemptId || intent.attemptId !== attemptId || intent.ownerTask !== TASK || ![191, 192].includes(intent.id) || !original || original.name !== 'dianzi51-admin'
      || intent.name !== original.name || original.script !== ADMIN || backend.path !== ADMIN || intent.apiHash !== backend.sha256 || ids.has(intent.id)) fail();
    ids.add(intent.id);
  }
  return ids;
}
function verifyRows(rows, snapshot, ownedIds, recovery) {
  const current = rows.map(project);
  if (snapshot.length !== 12 || current.length !== 12 || new Set(current.map(row => row.id)).size !== 12 || new Set(snapshot.map(row => row.id)).size !== 12) fail();
  for (const original of snapshot) {
    const row = current.find(row => row.id === original.id);
    if (!row) fail();
    if (![191, 192].includes(original.id)) {
      if (digest(row) !== digest(original)) fail();
    } else {
      if (original.name !== 'dianzi51-admin' || original.script !== ADMIN || original.execMode !== 'cluster_mode'
        || digest(config(row)) !== digest(config(original)) || original.status !== 'online' || !(original.pid > 0)) fail();
      if (!(recovery && ownedIds.has(original.id)) && (row.status !== 'online' || !(row.pid > 0))) fail();
      if (!ownedIds.has(original.id) && row.pid !== original.pid) fail();
    }
  }
  return current;
}
async function main(argv = process.argv.slice(2)) {
  const snapshotOnly = argv.length === 1 && argv[0] === '--snapshot';
  const recovery = argv.length === 3 && argv[0] === '--rollback';
  const args = recovery ? argv.slice(1) : argv;
  if (!snapshotOnly && (args.length !== 2 || args[0] !== '--id' || !/^(191|192)$/.test(args[1]))) fail();
  const id = snapshotOnly ? null : Number(args[1]);
  let manifest, snapshot, frozen, backend, ownedIds, manifestSha, coordSha, attemptId;
  const verifyOwnership = () => {
    if (sha(COORD) !== coordSha) fail();
    const state = json(COORD), started = json(`${ROOT}/activation-started.json`);
    if (state.shared_release_active !== true || state.window?.owner_task !== TASK || state.window?.task !== TASK
      || started.attemptId !== attemptId || state.window.attemptId !== attemptId || started.ownerTask !== TASK || started.openedAtUtc !== state.window.openedAtUtc
      || started.manifestSha256 !== manifestSha || sha(`${ROOT}/manifest.json`) !== manifestSha) fail();
  };
  const verifyBytes = () => {
    verifyOwnership();
    verifyHelpers(manifest);
    if (sha(backend.path) !== backend[recovery ? 'beforeSha256' : 'sha256']) fail();
    for (const item of manifest.protectedFiles || []) if (sha(item.path) !== item.sha256) fail();
  };
  if (!snapshotOnly) {
    manifest = json(`${ROOT}/manifest.json`); snapshot = json(`${ROOT}/process-before.json`);
    manifestSha = sha(`${ROOT}/manifest.json`); coordSha = sha(COORD);
    attemptId = json(`${ROOT}/activation-started.json`).attemptId;
    if (manifest.ownerTask !== TASK || !Array.isArray(snapshot) || !Array.isArray(manifest.backendFiles) || manifest.backendFiles.length !== 1) fail();
    backend = manifest.backendFiles[0]; frozen = snapshot.find(row => row.id === id);
    if (!frozen || frozen.name !== 'dianzi51-admin' || backend.processName !== frozen.name || backend.path !== ADMIN || backend.relative !== 'api/admin-index.js') fail();
    ownedIds = verifyIntent(json(`${ROOT}/reload-intents.json`), snapshot, backend, attemptId);
    if (!ownedIds.has(id)) fail(); // persisted intent required for both activation and recovery
    if (recovery && sha(`${ROOT}/before-dianzi51-admin.js`) !== backend.beforeSha256) fail();
    verifyBytes(); // no PM2 load/daemon interaction before helper/API hashes pass
  }
  const pm2 = require('/usr/local/lib/node_modules/pm2');
  if (typeof pm2.Client.pingDaemon !== 'function' || typeof pm2.Client.launchRPC !== 'function') fail();
  await new Promise((resolve, reject) => pm2.Client.pingDaemon(alive => alive === true ? resolve() : reject(Error('EXISTING_PM2_DAEMON_REQUIRED'))));
  try {
    await new Promise((resolve, reject) => pm2.Client.launchRPC(error => error ? reject(error) : resolve()));
    const existingClient = () => { if (!pm2.Client.client || typeof pm2.Client.client.call !== 'function') fail(); };
    const list = () => { existingClient(); return new Promise((resolve, reject) => pm2.Client.client.call('getMonitorData', {}, (error, rows) => error ? reject(error) : resolve(rows))); };
    const rows = await list();
    if (snapshotOnly) { console.log(JSON.stringify(rows.map(project).sort((a, b) => a.id - b.id))); return; }
    verifyRows(rows, snapshot, ownedIds, recovery);
    const before = rows.find(row => row.pm_id === id);
    // Only this original id may restart if a persisted owned reload failed offline.
    const method = recovery && (before.pm2_env.status !== 'online' || !(before.pid > 0)) ? 'restartProcessId' : 'reloadProcessId';
    verifyBytes(); existingClient();
    // Direct attached RPC: no executeRemote/connect/Client.start daemon fallback.
    await new Promise((resolve, reject) => pm2.Client.client.call(method, { id, env: {} }, error => error ? reject(error) : resolve()));
    const afterRows = await list(); verifyRows(afterRows, snapshot, ownedIds, recovery);
    const after = afterRows.find(row => row.pm_id === id);
    if (after.pm2_env.status !== 'online' || !(after.pid > 0)) fail();
    verifyBytes();
    console.log(`Verified exact API recovery/reload: ${frozen.name} instance ${id}; original path/environment retained.`);
  } finally { pm2.disconnect(); }
}
module.exports = { main, helperPath, verifyHelpers, verifyIntent, verifyRows, project, digest };
if (require.main === module) main().catch(() => { console.error('TARGETED_RELOAD_FAILED; sensitive details suppressed.'); process.exitCode = 1; });
