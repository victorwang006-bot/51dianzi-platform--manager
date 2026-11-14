'use strict';
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const ROOT = '/opt/ops/20261114-profile-staff-CKSZQ7s', TASK = 'CKSZQ7sVc7tADM21c3LWpu';
const tool = __dirname + '/reload-profile-staff-api-20261114.cjs';
const text = fs.readFileSync(tool, 'utf8');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const digest = value => sha(JSON.stringify(canonical(value)));
async function run(options = {}) {
  const env = { A: 'original', Z: 'unchanged', unicode: '离线测试' };
  const admin = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js';
  const front = '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js';
  const backend = { processName: 'dianzi51-admin', path: admin, sha256: sha('candidate admin'), beforeSha256: sha('original admin') };
  const snapshot = [190, 191, 192, 193, 194, 200, 201].map(id => ({ id, name: [191, 192].includes(id) ? 'dianzi51-admin' : id === 201 ? 'worker' : 'dianzi51', pid: id + 1000, status: 'online', script: [191, 192].includes(id) ? admin : id === 201 ? '/worker.js' : front, cwd: '/original', execMode: id === 201 ? 'fork_mode' : 'cluster_mode', environmentHash: digest(env) }));
  const rows = snapshot.map(row => ({ pm_id: row.id, name: row.name, pid: row.pid, pm2_env: { status: row.status, pm_exec_path: row.script, pm_cwd: row.cwd, exec_mode: row.execMode, env: structuredClone(env) } }));
  const id = options.id ?? 191, row = rows.find(row => row.pm_id === id);
  if (options.badEnvironment) row.pm2_env.env.A = 'foreign';
  if (options.badPath) row.pm2_env.pm_exec_path = '/foreign.js';
  if (options.badCwd) row.pm2_env.pm_cwd = '/foreign';
  if (options.workerDrift) rows.at(-1).pid++;
  if (options.frontDrift) rows[0].pid++;
  if (options.unhealthy) { row.pid = 0; row.pm2_env.status = 'errored'; }
  if (options.otherAdminUnhealthy) { rows.find(row => row.pm_id === 192).pid = 0; rows.find(row => row.pm_id === 192).pm2_env.status = 'errored'; }
  const calls = [], originalEnv = row?.pm2_env.env;
  const intents = [{ ownerTask: options.foreignIntent ? 'foreign-task' : TASK, id, name: 'dianzi51-admin', apiHash: backend.sha256 }];
  if (options.duplicateIntent) intents.push({ ...intents[0] });
  if (options.noIntent) intents.length = 0;
  const files = { [`${ROOT}/manifest.json`]: JSON.stringify({ ownerTask: options.foreignManifest ? 'foreign' : TASK, backendFiles: [backend] }), [`${ROOT}/process-before.json`]: JSON.stringify(snapshot), [`${ROOT}/reload-intents.json`]: JSON.stringify(intents), [admin]: options.foreignBytes ? 'foreign admin' : options.rollback ? 'original admin' : 'candidate admin', [`${ROOT}/before-dianzi51-admin.js`]: options.foreignBackup ? 'foreign backup' : 'original admin' };
  const pm2 = { connect() { throw Error('daemon creation forbidden'); }, disconnect() { calls.push('disconnect'); }, list(done) { done(null, rows); }, Client: { start() { throw Error('daemon start forbidden'); }, pingDaemon(done) { done(!options.noDaemon); }, launchRPC(done) { pm2.Client.client = options.noClient ? null : { call() {} }; done(null); }, executeRemote(method, payload, done) {
    assert(['reloadProcessId', 'restartProcessId'].includes(method));
    assert([191, 192].includes(payload.id));
    assert.deepEqual(Object.keys(payload).sort(), ['env', 'id']); assert.equal(Object.keys(payload.env).length, 0);
    assert.equal(row.pm2_env.env, originalEnv, 'shell environment must not replace cached environment');
    assert(!Object.hasOwn(row.pm2_env.env, 'LOCAL_SECRET') && !Object.hasOwn(row.pm2_env.env, 'D51_EXACT_ROLLBACK'));
    calls.push(method);
    if (options.remoteFailure) return done(Error('offline remote error'));
    row.pid = options.stillUnhealthy ? 0 : row.pm_id + 3000; row.pm2_env.status = options.stillUnhealthy ? 'errored' : 'online';
    if (options.postFrontDrift) rows[0].pid++;
    done(null);
  } } };
  const process = { argv: ['node', tool, '--id', options.invalidSelector ? 'x' : String(id)], env: { LOCAL_SECRET: 'TEST_ONLY_NEVER_FORWARDED', ...(options.rollback ? { D51_EXACT_ROLLBACK: '1' } : {}) } };
  const context = { require(name) { if (name === 'node:crypto') return crypto; if (name === 'node:fs') return { readFileSync(file) { assert(Object.hasOwn(files, file), 'unknown file'); return files[file]; } }; if (name === '/usr/local/lib/node_modules/pm2') return pm2; throw Error('unknown dependency'); }, process, console: { log() {}, error() {} }, Buffer };
  vm.runInNewContext(text.replace('main().catch(', 'globalThis.__done = main().catch('), context);
  await context.__done;
  return { failed: process.exitCode === 1, calls: calls.filter(call => call !== 'disconnect') };
}
(async () => {
  const cases = [['original 191 empty-env reload', {}, false, ['reloadProcessId']], ['original 192 empty-env reload', { id: 192 }, false, ['reloadProcessId']], ['front id denied', { id: 190 }, true, []], ['worker id denied', { id: 201 }, true, []], ['invalid id denied', { invalidSelector: true }, true, []], ['original unhealthy denied without recovery', { unhealthy: true }, true, []], ['owned unhealthy original-id recovery', { rollback: true, unhealthy: true }, false, ['restartProcessId']], ['owned online original-id rollback', { rollback: true }, false, ['reloadProcessId']], ...['badEnvironment', 'badPath', 'badCwd', 'workerDrift', 'frontDrift', 'otherAdminUnhealthy', 'foreignBytes', 'foreignManifest', 'noDaemon', 'noClient'].map(key => [key + ' denied before reload', { [key]: true }, true, []]), ...['foreignIntent', 'duplicateIntent', 'noIntent', 'foreignBackup'].map(key => [key + ' denies exact recovery', { rollback: true, unhealthy: true, [key]: true }, true, []]), ['recovery remains unhealthy denied', { rollback: true, unhealthy: true, stillUnhealthy: true }, true, ['restartProcessId']], ['front PID drift after reload denied', { postFrontDrift: true }, true, ['reloadProcessId']], ['native remote error denied', { remoteFailure: true }, true, ['reloadProcessId']]];
  for (const [name, options, failed, calls] of cases) { const result = await run(options); assert.equal(result.failed, failed, name); assert.deepEqual(result.calls, calls, name); console.log('PASS ' + name); }
  const report = { status: 'PASS', passed: cases.length, failed: 0, reloadHelperSha256: sha(text), actualNetworkIO: 0, actualPM2Operations: 0, actualDatabaseIO: 0, environmentOverlay: false, actualHelperCodeExecuted: true, installedPM2OrNativeGodExecuted: false, scope: 'VM helper body with inert PM2 RPC fixtures only' };
  fs.writeFileSync('/home/ubuntu/work/profile-staff-20261114/reload-tests.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
})().catch(error => { console.error(error); process.exitCode = 1; });
