#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const names = ['dianzi51', 'dianzi51-admin'];
const oldRoot = '/opt/releases/20261104-admin-upload-stars-layout-v22';
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const fail = () => { throw new Error('target-reload-contract'); };
function processes() { return JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 })); }
async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.log('Plan only. Explicit --apply --release <release> --name <target> required.'); return; }
  if (args.length !== 5 || args[0] !== '--apply' || args[1] !== '--release' || args[3] !== '--name') fail();
  const release = path.resolve(args[2]);
  const name = args[4];
  const index = names.indexOf(name);
  if (index < 0 || !/^\/opt\/releases\/[A-Za-z0-9_-]+-ci-management-v1$/.test(release)) fail();
  const side = ['front', 'admin'][index];
  const target = `${release}/${side}/dist/index.js`;
  const manifest = JSON.parse(fs.readFileSync(`${release}/manifest.json`, 'utf8'));
  if (sha(fs.readFileSync(target)) !== manifest.artifacts[`${side}/dist/index.js`]) fail();
  const rows = processes().filter(p => p.name === name).sort((a, b) => a.pm_id - b.pm_id);
  if (rows.length !== [4, 2][index]) fail();
  const expectedCwd = ['/opt/releases/20261031-forum-quote-v34/front', '/opt/releases/20261031-wechat-chat-entry-v33/admin'][index];
  for (const row of rows) {
    const e = row.pm2_env;
    if (e.status !== 'online' || e.exec_mode !== 'cluster_mode' || e.pm_cwd !== expectedCwd || ![`${oldRoot}/${side}/dist/index.js`, target].includes(e.pm_exec_path)) fail();
  }
  const pm2 = require('/usr/local/lib/node_modules/pm2');
  await new Promise((resolve, reject) => pm2.connect(error => error ? reject(error) : resolve()));
  try {
    for (const row of rows) {
      if (row.pm2_env.pm_exec_path === target) continue;
      // Verified against this server's PM2 Reload.js and Utility.extendExtraConfig.
      // env is restored verbatim so current_conf does not enter the application environment.
      await new Promise((resolve, reject) => pm2.Client.executeRemote('reloadProcessId', {
        id: row.pm_id,
        env: { current_conf: { pm_exec_path: target, env: row.pm2_env.env } },
      }, error => error ? reject(error) : resolve()));
      const fresh = processes().find(p => p.pm_id === row.pm_id);
      if (!fresh || fresh.name !== name || fresh.pm2_env.pm_exec_path !== target || fresh.pm2_env.status !== 'online'
        || fresh.pm2_env.pm_cwd !== row.pm2_env.pm_cwd || fresh.pm2_env.exec_mode !== row.pm2_env.exec_mode
        || canonical(fresh.pm2_env.env) !== canonical(row.pm2_env.env)) fail();
      console.log(`${name} instance ${row.pm_id}: verified entry switched, environment retained.`);
    }
  } finally { pm2.disconnect(); }
}
try { await main(); } catch { console.error('Targeted reload stopped; sensitive details suppressed. Inspect sanitized PM2 state before any retry.'); process.exitCode = 1; }
