#!/usr/bin/env node
/** Server-local only. Default: plan. --snapshot reads PM2, --apply writes 0600 configs.
 * Never prints PM2 environment, stderr, or exception messages. No DB/SSH operations.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const names = ['dianzi51', 'dianzi51-admin'];
const oldRoot = '/opt/releases/20261104-admin-upload-stars-layout-v22';
const cwd = ['/opt/releases/20261031-forum-quote-v34/front', '/opt/releases/20261031-wechat-chat-entry-v33/admin'];
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, sort(value[k])]));
  return value;
}
function fail() { throw new Error('runtime-contract'); }
// PM2-generated bookkeeping is not an application environment setting.
const volatile = new Set(['NODE_APP_INSTANCE', 'pm_id', 'unique_id', 'restart_time', 'unstable_restarts', 'created_at', 'pm_uptime', 'status', 'pm_exec_path', 'script']);
function environment(p) {
  const env = p.pm2_env.env;
  if (!env || typeof env !== 'object') fail();
  return Object.fromEntries(Object.entries(env).filter(([k]) => !volatile.has(k)));
}
function list() {
  const r = spawnSync('pm2', ['jlist'], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0 || r.error) fail();
  const result = JSON.parse(r.stdout);
  if (!Array.isArray(result)) fail();
  return result;
}
function summary(p) {
  const e = p.pm2_env;
  return { name: p.name, pm_id: e.pm_id ?? p.pm_id, pid: p.pid, cwd: e.pm_cwd,
    script: e.pm_exec_path, status: e.status, exec_mode: e.exec_mode,
    envSha256: sha(canonical(environment(p))),
    runtimeSha256: sha(canonical(runtime(p))) };
}
// Copy configuration, not runtime counters. This allowlist covers PM2 launch, logs,
// timeouts, interpreter, clustering and restart/watch settings. Unknown keys in the
// environment are retained verbatim inside the private configuration.
const keys = ['args', 'node_args', 'exec_interpreter', 'exec_mode', 'instances', 'instance_var',
  'increment_var', 'append_env_to_name', 'autorestart', 'watch', 'ignore_watch', 'watch_options',
  'max_memory_restart', 'min_uptime', 'max_restarts', 'restart_delay', 'exp_backoff_restart_delay',
  'kill_timeout', 'listen_timeout', 'wait_ready', 'shutdown_with_message', 'treekill',
  'pm_out_log_path', 'pm_err_log_path', 'merge_logs', 'log_date_format', 'time',
  'cron_restart', 'vizion', 'source_map_support', 'disable_logs', 'uid', 'gid', 'namespace'];
function runtime(p) {
  const e = p.pm2_env;
  const values = Object.fromEntries(keys.filter(k => e[k] !== undefined).map(k => [k, e[k]]));
  // PM2 appends the instance pm_id to non-merged log and pid filenames. Feed
  // the common base back into PM2, rather than appending that suffix twice.
  const id = e.pm_id ?? p.pm_id;
  for (const key of ['pm_out_log_path', 'pm_err_log_path', 'pm_pid_path']) {
    // Older reloads left per-instance paths even with merge_logs=true.
    if (typeof values[key] === 'string') {
      values[key] = values[key].replace(new RegExp(`-${id}(\\.[^.\/]+)$`), '$1');
    }
  }
  return values;
}
function app(rows, name, script) {
  const p = rows[0], e = p.pm2_env;
  for (const q of rows) {
    if (canonical(environment(q)) !== canonical(environment(p)) || canonical(runtime(q)) !== canonical(runtime(p))) fail();
  }
  // Internal pm_exec_path/script fields would override the new entry during reload.
  const result = { ...runtime(p), name, cwd: e.pm_cwd, script, env: environment(p), instances: rows.length };
  result.interpreter = result.exec_interpreter;
  delete result.exec_interpreter;
  result.out_file = result.pm_out_log_path; result.error_file = result.pm_err_log_path;
  // Per-instance pid paths are PM2 bookkeeping, never an application pid_file.
  // Let PM2 retain generated instance logs rather than setting the first
  // instance's concrete filename as a new shared file for the cluster.
  const id = e.pm_id ?? p.pm_id;
  for (const [internal, external] of [['pm_out_log_path', 'out_file'], ['pm_err_log_path', 'error_file']]) {
    if (!e.merge_logs && typeof e[internal] === 'string' && new RegExp(`-${id}(\\.[^.\/]+)$`).test(e[internal])) delete result[external];
  }
  delete result.pm_out_log_path; delete result.pm_err_log_path; delete result.pm_pid_path;
  // PM2 uses cluster/fork rather than its internal *_mode spelling in ecosystem files.
  result.exec_mode = e.exec_mode === 'cluster_mode' ? 'cluster' : e.exec_mode === 'fork_mode' ? 'fork' : e.exec_mode;
  return result;
}
function privateFile(file, content) {
  if (fs.existsSync(file)) fail();
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.log('Plan only. Use --snapshot or --apply --release /opt/releases/<release>. No database access.'); return; }
  if (args.length === 1 && args[0] === '--snapshot') {
    console.log(JSON.stringify(list().map(summary).sort((a, b) => a.pm_id - b.pm_id))); return;
  }
  if (args.length !== 3 || args[0] !== '--apply' || args[1] !== '--release') fail();
  const release = path.resolve(args[2]);
  if (!/^\/opt\/releases\/[A-Za-z0-9_-]+-ci-management-v1$/.test(release)) fail();
  const records = path.join(release, 'records');
  if (!fs.statSync(records).isDirectory()) fail();
  const processes = list();
  const newApps = [], oldApps = [];
  for (let i = 0; i < names.length; i++) {
    const rows = processes.filter(p => p.name === names[i]);
    if (rows.length !== [4, 2][i]) fail();
    const side = ['front', 'admin'][i];
    for (const p of rows) {
      if (p.pm2_env.status !== 'online' || p.pm2_env.pm_cwd !== cwd[i] || p.pm2_env.exec_mode !== 'cluster_mode'
        || p.pm2_env.pm_exec_path !== `${oldRoot}/${side}/dist/index.js`) fail();
    }
    newApps.push(app(rows, names[i], `${release}/${side}/dist/index.js`));
    oldApps.push(app(rows, names[i], rows[0].pm2_env.pm_exec_path));
  }
  privateFile(path.join(records, 'runtime-new.config.cjs'), `module.exports = ${JSON.stringify({ apps: newApps }, null, 2)};\n`);
  privateFile(path.join(records, 'runtime-rollback.config.cjs'), `module.exports = ${JSON.stringify({ apps: oldApps }, null, 2)};\n`);
  privateFile(path.join(records, 'processes-original.json'), JSON.stringify(processes.map(summary).sort((a,b) => a.pm_id-b.pm_id), null, 2) + '\n');
  console.log('Private runtime configs and sanitized baseline created. No reload performed.');
}
try { main(); } catch { console.error('Runtime preparation failed; sensitive details suppressed. Check contracts and PM2 privately.'); process.exitCode = 1; }
