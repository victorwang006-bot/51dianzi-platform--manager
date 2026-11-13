#!/usr/bin/env node
// Pure VM tests: real fetched God/Utility slots, inert IO; no installed PM2 or service.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ROOT = '/opt/ops/20261114-customer-workbench-gP8f91';
const TASK = 'gP8f91DW2JzwK58yPyfj9B';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const digest = value => sha(JSON.stringify(canonical(value)));
const script = fs.readFileSync(path.join(__dirname, 'reload-customer-inventory-api-20261114.cjs'), 'utf8').replace('main().catch(', 'globalThis.__done = main().catch(');
const evidenceRoot = path.resolve(__dirname, '../../customer-workbench-20261114');
const utilitySource = fs.readFileSync(path.join(evidenceRoot, 'pm2-native-utility.js'), 'utf8');
const godSource = fs.readFileSync(path.join(evidenceRoot, 'pm2-native-recovery-contract.txt'), 'utf8').replace(/^\d+: /gm, '');
function slot(source, start, end) {
  const offset = source.indexOf(start);
  const limit = source.indexOf(end, offset + start.length);
  assert.ok(offset >= 0 && limit > offset, 'fetched native contract slot missing');
  return source.slice(offset, limit);
}
const utilitySlots = ['var Utility = {', slot(utilitySource, '  extendExtraConfig : function', '  formatCLU : function'),
  slot(utilitySource, '  extend : function', '  // Same as extend'),
  slot(utilitySource, '  extendMix : function', '  whichFileExists : function'), '};'].join('\n');
const godSlots = ['reloadProcessId', 'restartProcessId'].map(method => {
  const start = godSource.indexOf(`  God.${method} = function`);
  const end = godSource.indexOf('\n  };', start);
  assert.ok(start >= 0 && end > start, 'native God method missing');
  return godSource.slice(start, end + '\n  };'.length);
}).join('\n');
async function check(options = {}) {
  const env = { Z: 'last', A: 'first', nested: { b: 2, a: '客户' } };
  const bytes = options.rollback ? 'before API' : 'candidate API';
  const backend = { processName: 'dianzi51', path: '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/front/dist/index.js', sha256: sha('candidate API'), beforeSha256: sha('before API') };
  const admin = { processName: 'dianzi51-admin', path: '/opt/releases/20261110-customer-workbench-b7f3a2a7e317/admin/dist/index.js', sha256: sha('candidate admin'), beforeSha256: sha('before admin') };
  const frozen = { id: 3, name: options.worker ? 'inventory-worker' : 'dianzi51', pid: 100, status: 'online',
    script: backend.path, cwd: '/original/front', execMode: 'cluster_mode', environmentHash: digest(env) };
  const others = [{ ...frozen, id: 4, pid: 104, name: 'dianzi51' },
    { ...frozen, id: 8, pid: 108, name: 'dianzi51-admin', script: admin.path, cwd: '/original/admin' },
    { ...frozen, id: 99, pid: 999, name: 'inventory-worker', script: '/original/worker', cwd: '/worker', execMode: 'fork_mode' }];
  const snapshot = [frozen, ...others];
  const row = { pm_id: 3, name: options.badName ? 'foreign-api' : 'dianzi51', pid: options.pid === undefined ? 100 : options.pid,
    pm2_env: { status: options.status || 'online', exec_mode: options.badMode ? 'fork_mode' : 'cluster_mode',
      pm_exec_path: options.badPath ? '/foreign/api' : backend.path, pm_cwd: options.badCwd ? '/foreign/cwd' : frozen.cwd,
      env: options.badEnv ? { ...env, A: 'changed' } : structuredClone(env) } };
  const rows = [row, ...others.map(original => ({ pm_id: original.id, name: original.name, pid: original.pid,
    pm2_env: { status: original.status, exec_mode: original.execMode, pm_exec_path: original.script,
      pm_cwd: original.cwd, env: structuredClone(env) } }))];
  if (options.badId) row.pm_id = 30;
  if (options.workerDrift) rows.at(-1).pid++;
  if (options.otherApiOffline) rows[1].pm2_env.status = 'errored';
  if (options.missingTarget) rows.shift();
  const calls = [];
  const envReference = row.pm2_env.env;
  const cachedConfig = digest({ env: row.pm2_env.env, path: row.pm2_env.pm_exec_path, cwd: row.pm2_env.pm_cwd, mode: row.pm2_env.exec_mode });
  const assertOriginalConfig = () => {
    assert.equal(row.pm2_env.env, envReference, 'empty payload must not replace the cached env object');
    assert.equal(digest({ env: row.pm2_env.env, path: row.pm2_env.pm_exec_path, cwd: row.pm2_env.pm_cwd, mode: row.pm2_env.exec_mode }), cachedConfig);
    assert.ok(!Object.hasOwn(row.pm2_env.env, 'LOCAL_SECRET'));
    assert.ok(!Object.hasOwn(row.pm2_env.env, 'D51_EXACT_ROLLBACK'));
    assert.ok(!Object.hasOwn(row.pm2_env.env, 'current_conf'));
  };
  const finish = done => {
    assertOriginalConfig();
    row.pid = options.finalZeroPid ? 0 : 1001;
    row.pm2_env.status = options.stillOffline ? 'errored' : 'online';
    if (options.afterDrift) row.pm2_env.pm_cwd = '/foreign/cwd';
    if (options.afterWorkerDrift) rows.at(-1).pid++;
    done();
  };
  const God = { clusters_db: Object.fromEntries(rows.map(value => [value.pm_id, value])),
    resetState: () => calls.push(['resetState']), deleteCron: id => assert.equal(id, 3),
    stopProcessId: (id, done) => { assert.equal(id, 3); row.pm2_env.status = 'stopped'; calls.push(['stop', id]); done(); },
    startProcessId: (id, done) => { assert.equal(id, 3); calls.push(['start', id]); finish(done); },
    logAndGenerateError: message => Error(message) };
  const nativeContext = { God, cst: { ONLINE_STATUS: 'online', LAUNCHING_STATUS: 'launching' },
    hardReload: (god, id, message, done) => { assert.equal(god, God); assert.equal(id, 3); calls.push(['hardReload', id]); finish(done); },
    console: { log() {} }, debug() {} };
  vm.runInNewContext(utilitySlots + '\n' + godSlots, nativeContext);
  const native = {
    connect: () => { throw Error('connect may spawn daemon and is forbidden'); },
    list: done => {
      assert.ok(native.Client.client && typeof native.Client.client.call === 'function');
      if (options.lostClient) native.Client.client = null;
      done(null, rows);
    },
    disconnect: () => calls.push(['disconnect']),
    Client: {
      start: () => { throw Error('new daemon forbidden'); },
      pingDaemon: done => { calls.push(['pingDaemon']); done(!options.noDaemon); },
      launchRPC: done => {
        calls.push(['launchRPC']);
        native.Client.client = options.noClient ? null : { call() {} };
        done(options.rpcFailure ? Error('synthetic existing RPC failure') : null);
      },
      executeRemote: (method, payload, done) => {
      assert.ok(native.Client.client && typeof native.Client.client.call === 'function', 'never start fallback');
      assert.ok(['reloadProcessId', 'restartProcessId'].includes(method));
      assert.equal(payload.id, 3);
      assert.deepEqual(Object.keys(payload).sort(), ['env', 'id']);
      assert.equal(Object.keys(payload.env).length, 0, 'no shell env/current_conf/new environment');
      calls.push(['remote', method, payload.id]);
      if (options.remoteFailure) return done(Error('synthetic remote failure'));
      God[method](payload, done);
    } },
  };
  const intent = { ownerTask: TASK, id: 3, name: 'dianzi51', apiHash: backend.sha256 };
  const intents = [intent];
  if (options.intentOwner) intent.ownerTask = 'foreign-task';
  if (options.intentId) intent.id = 4;
  if (options.intentName) intent.name = 'dianzi51-admin';
  if (options.intentHash) intent.apiHash = 'foreign hash';
  if (options.duplicateIntent) intents.push({ ...intent });
  if (options.emptyIntent) intents.length = 0;
  const files = { [`${ROOT}/manifest.json`]: JSON.stringify({ ownerTask: options.foreignManifest ? 'foreign-task' : TASK, backendFiles: [backend, admin] }),
    [`${ROOT}/process-before.json`]: JSON.stringify(snapshot), [backend.path]: options.badHash ? 'foreign API' : bytes,
    [`${ROOT}/before-dianzi51.js`]: options.badBackup ? 'foreign backup' : 'before API' };
  if (!options.noIntent) files[`${ROOT}/reload-intents.json`] = JSON.stringify(intents);
  const process = { argv: ['node', 'reload', '--id', options.invalidId ? 'x' : '3'], env: { LOCAL_SECRET: 'never forwarded', ...(options.rollback ? { D51_EXACT_ROLLBACK: '1' } : {}) } };
  const context = { require: name => name === 'node:crypto' ? crypto : name === 'node:fs' ? {
    readFileSync: filename => { assert.ok(filename in files, 'unapproved or missing file read'); return files[filename]; },
  } : name === '/usr/local/lib/node_modules/pm2' ? native : (() => { throw Error('unapproved dependency'); })(), process, console: { log() {}, error() {} }, Buffer };
  vm.runInNewContext(script, context);
  await context.__done;
  return { failed: process.exitCode === 1, reloads: calls.filter(value => value[0] === 'remote').length, calls };
}
(async () => {
  const tests = [
    ['native environment and path retained', {}, false, 1, 'reloadProcessId'],
    ['foreign environment refused before reload', { badEnv: true }, true, 0],
    ['independent worker refused', { worker: true }, true, 0],
    ['foreign API bytes refused', { badHash: true }, true, 0],
    ['owned baseline rollback reload', { rollback: true }, false, 1, 'reloadProcessId'],
    ['post reload cwd drift refused', { afterDrift: true }, true, 1, 'reloadProcessId'],
    ['invalid instance selector refused', { invalidId: true }, true, 0],
    ...['errored', 'stopped', 'launching', 'stopping'].map(status => [`owned ${status} original-id restart`, { rollback: true, status, pid: 0 }, false, 1, 'restartProcessId']),
    ['owned online zero-pid original-id restart', { rollback: true, pid: 0 }, false, 1, 'restartProcessId'],
    ...['errored', 'stopped', 'launching'].map(status => [`normal ${status} still refused`, { status, pid: 0 }, true, 0]),
    ['normal online zero-pid refused', { pid: 0 }, true, 0],
    ['rollback missing intent refused', { rollback: true, noIntent: true, status: 'errored', pid: 0 }, true, 0],
    ['rollback empty intents refused', { rollback: true, emptyIntent: true }, true, 0],
    ...['intentOwner', 'intentId', 'intentName', 'intentHash', 'duplicateIntent'].map(key => [`rollback ${key} refused`, { rollback: true, [key]: true, status: 'stopped', pid: 0 }, true, 0]),
    ...['badEnv', 'badPath', 'badCwd', 'badName', 'badId', 'badMode', 'workerDrift', 'otherApiOffline', 'missingTarget', 'badHash', 'badBackup', 'foreignManifest'].map(key => [`owned recovery ${key} refused`, { rollback: true, [key]: true, status: 'errored', pid: 0 }, true, 0]),
    ['restart still offline refused', { rollback: true, status: 'stopped', pid: 0, stillOffline: true }, true, 1, 'restartProcessId'],
    ['restart zero final pid refused', { rollback: true, status: 'stopped', pid: 0, finalZeroPid: true }, true, 1, 'restartProcessId'],
    ['restart post worker drift refused', { rollback: true, status: 'stopped', pid: 0, afterWorkerDrift: true }, true, 1, 'restartProcessId'],
    ['native remote recovery failure refused', { rollback: true, status: 'launching', pid: 0, remoteFailure: true }, true, 1, 'restartProcessId'],
    ['missing daemon refused without launching one', { noDaemon: true }, true, 0],
    ['existing RPC connection failure refused', { rpcFailure: true }, true, 0],
    ['missing existing client refused without start fallback', { noClient: true }, true, 0],
    ['lost existing client refused without start fallback', { lostClient: true }, true, 0],
  ];
  for (const [name, options, failed, count, method] of tests) {
    const result = await check(options);
    assert.equal(result.failed, failed, name);
    assert.equal(result.reloads, count, name);
    if (method) assert.equal(result.calls.find(value => value[0] === 'remote')[1], method, name);
    console.log('PASS ' + name);
  }
  console.log(JSON.stringify({ status: 'PASS', tests: tests.length, productionOperations: 0, environmentOverlay: false,
    nativeGodSlotsExecuted: ['reloadProcessId', 'restartProcessId'], nativeUtilitySlotsExecuted: ['extend', 'extendExtraConfig'],
    existingRpcOnly: true, globalRestart: false }));
})().catch(error => { console.error(error); process.exitCode = 1; });
