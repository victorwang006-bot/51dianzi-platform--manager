#!/usr/bin/env node
// Server-only: exact original ids, no global PM2 restart/save or environment overlay.
const fs = require('node:fs');
const crypto = require('node:crypto');
const ROOT = '/opt/ops/20261114-profile-staff-CKSZQ7s';
const TASK = 'CKSZQ7sVc7tADM21c3LWpu';
const APIS = {
  'dianzi51-admin': '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js',
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const sha = filename => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const fail = () => { throw Error('TARGETED_RELOAD_CONTRACT_FAILED'); };
const project = row => ({ id: row.pm_id, name: row.name, pid: row.pid,
  status: row.pm2_env.status, script: row.pm2_env.pm_exec_path, cwd: row.pm2_env.pm_cwd,
  execMode: row.pm2_env.exec_mode, environmentHash: digest(row.pm2_env.env || {}) });
const config = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['pid', 'status'].includes(key)));
async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--id' || !/^\d+$/.test(process.argv[3])) fail();
  const id = Number(process.argv[3]);
  const manifest = JSON.parse(fs.readFileSync(`${ROOT}/manifest.json`, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(`${ROOT}/process-before.json`, 'utf8'));
  if (![191, 192].includes(id) || manifest.ownerTask !== TASK || !Array.isArray(snapshot) || new Set(snapshot.map(row => row.id)).size !== snapshot.length) fail();
  const frozen = snapshot.find(row => row.id === id);
  if (!frozen || !Object.hasOwn(APIS, frozen.name) || frozen.script !== APIS[frozen.name]
    || frozen.status !== 'online' || !(frozen.pid > 0) || frozen.execMode !== 'cluster_mode') fail();
  const backend = manifest.backendFiles.find(row => row.processName === frozen.name);
  if (!backend || backend.path !== frozen.script) fail();
  const rollback = process.env.D51_EXACT_ROLLBACK === '1';
  const ownedIds = new Set();
  if (rollback) {
    const intents = JSON.parse(fs.readFileSync(`${ROOT}/reload-intents.json`, 'utf8'));
    if (!Array.isArray(intents)) fail();
    for (const intent of intents) {
      const original = snapshot.find(row => row.id === intent.id);
      const item = manifest.backendFiles.find(row => row.processName === intent.name);
      if (intent.ownerTask !== TASK || !original || !item || original.name !== intent.name
        || !Object.hasOwn(APIS, original.name) || original.script !== item.path || item.path !== APIS[original.name]
        || intent.apiHash !== item.sha256 || ownedIds.has(intent.id)) fail();
      ownedIds.add(intent.id);
    }
    if (!ownedIds.has(id) || sha(`${ROOT}/before-${frozen.name}.js`) !== backend.beforeSha256) fail();
  }
  const verifyBytes = () => { if (sha(backend.path) !== backend[rollback ? 'beforeSha256' : 'sha256']) fail(); };
  const verifyRows = rows => {
    const current = rows.map(project);
    if (current.length !== snapshot.length || new Set(current.map(row => row.id)).size !== current.length) fail();
    for (const original of snapshot) {
      const row = current.find(row => row.id === original.id);
      if (!row) fail();
      if (!Object.hasOwn(APIS, original.name)) {
        if (digest(row) !== digest(original)) fail();
      } else {
        if (digest(config(row)) !== digest(config(original)) || original.status !== 'online' || !(original.pid > 0)) fail();
        if (!ownedIds.has(original.id) && (row.status !== 'online' || !(row.pid > 0))) fail();
      }
    }
    return rows.find(row => row.pm_id === id);
  };
  verifyBytes();
  const pm2 = require('/usr/local/lib/node_modules/pm2');
  const list = () => new Promise((resolve, reject) => pm2.list((error, rows) => error ? reject(error) : resolve(rows)));
  // connect()/Client.start() may launch a daemon when none exists. Only ping and
  // attach the existing RPC socket; never allow executeRemote's start fallback.
  if (typeof pm2.Client.pingDaemon !== 'function' || typeof pm2.Client.launchRPC !== 'function') fail();
  await new Promise((resolve, reject) => pm2.Client.pingDaemon(alive => alive === true ? resolve() : reject(Error('EXISTING_PM2_DAEMON_REQUIRED'))));
  try {
    await new Promise((resolve, reject) => pm2.Client.launchRPC(error => error ? reject(error) : resolve()));
    const existingClient = () => { if (!pm2.Client.client || typeof pm2.Client.client.call !== 'function') fail(); };
    existingClient();
    const before = verifyRows(await list());
    // Native God retains its verified cached path/CWD/env. Empty env has no overlay.
    // Offline (or missing-pid) recovery uses restartProcessId for this original id only.
    const method = rollback && (before.pm2_env.status !== 'online' || !(before.pid > 0)) ? 'restartProcessId' : 'reloadProcessId';
    existingClient();
    await new Promise((resolve, reject) => pm2.Client.executeRemote(method, { id, env: {} }, error => error ? reject(error) : resolve()));
    existingClient();
    const after = verifyRows(await list());
    if (after.pm2_env.status !== 'online' || !(after.pid > 0)) fail();
    verifyBytes();
    console.log(`Verified exact API recovery/reload: ${frozen.name} instance ${id}; original path/environment retained.`);
  } finally { pm2.disconnect(); }
}
main().catch(() => { console.error('TARGETED_RELOAD_FAILED; sensitive details suppressed.'); process.exitCode = 1; });
