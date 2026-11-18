'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createHash } = require('node:crypto');
const b = require('./build-health.cjs');
const tests = [];
async function test(worker, name, fn) {
  await fn();
  tests.push({ worker: worker.role, name, passed: true });
}
const blocked = role => ({ worker: role, businessReady: false, reason: 'RELEASE_PERMIT_OR_READINESS_BLOCKED' });
const permitted = role => ({ worker: role, businessReady: true });
function states(values) { return values.map((ready, i) => ({ ready, at: i * 1000 })); }

async function runMain(worker, text, steps, options = {}) {
  const sf = b.parse(text), main = b.findMain(sf);
  const mainText = main.getText(sf);
  const helper = text.includes(b.HEALTH_NAME) ? b.helper(worker.role) : '';
  const trace = [], health = [], logs = [], sleeps = [], envReads = [];
  let clock = 0, checks = 0, context;
  const effects = { maintenance: 0, claims: 0, process: 0, records: 0, close: 0 };
  const env = new Proxy(Object.create(null), { get(_target, key) {
    envReads.push(String(key));
    if (key !== 'DATABASE_URL') throw new Error('unexpected secret/environment access');
    return options.missingDatabase ? undefined : 'offline-mock';
  } });
  function log(level, value) {
    assert.equal(typeof value, 'string');
    logs.push({ level, value });
    if (value.startsWith('{')) {
      const event = JSON.parse(value);
      assert.deepEqual(Object.keys(event).sort(), event.businessReady ? ['businessReady', 'worker'] : ['businessReady', 'reason', 'worker']);
      assert.equal(event.worker, worker.role);
      assert.equal(typeof event.businessReady, 'boolean');
      if (!event.businessReady) assert.equal(event.reason, 'RELEASE_PERMIT_OR_READINESS_BLOCKED');
      health.push({ at: clock, value: event });
      trace.push(event.businessReady ? 'health:true' : 'health:false');
    }
  }
  function forbid() { throw new Error('timer/network/module access forbidden in VM'); }
  async function maintenance() { effects.maintenance++; trace.push('maintenance'); return options.maintenanceChanges ? 1 : 0; }
  async function claim() {
    effects.claims++; trace.push('claim');
    if (options.claimError) throw new Error('offline polling failure');
    return options.withJob ? { id: 'offline-synthetic', totalRows: 0 } : null;
  }
  async function processBatch() {
    effects.process++; trace.push('process');
    if (options.processError) throw new Error('offline processing failure');
    if (checks >= steps.length) context.stopping = true;
    return { completed: true, processed: 0, success: 0, errors: 0 };
  }
  const sandbox = {
    Date: { now: () => clock }, process: { env }, workerId: 'offline-instance',
    stopping: !!options.initiallyStopping, nextMaintenanceAt: 0,
    IDLE_DELAY_MS: 1000, ERROR_DELAY_MS: 5000, BETWEEN_BATCHES_MS: 150, MAINTENANCE_INTERVAL_MS: 60000,
    console: { info: value => log('info', value), error: value => log('error', value) },
    require: forbid, fetch: forbid, setTimeout: forbid, setInterval: forbid,
    isEnterpriseWorkerBusinessPermitted: async role => {
      assert.equal(role, worker.role);
      assert.ok(checks < steps.length && checks < 10000, 'unexpected loop/guard bypass');
      const step = steps[checks++]; clock = step.at; trace.push(`guard:${step.ready}`);
      if (options.guardError) throw new Error('offline guard failure');
      return step.ready;
    },
    sleep: async ms => {
      assert.ok([1000, 5000, 150].includes(ms)); sleeps.push(ms); trace.push(`sleep:${ms}`);
      if (checks >= steps.length) context.stopping = true;
    },
    expireAbandonedInventoryImportJobs: maintenance,
    cleanupExpiredInventoryImportHistory: maintenance,
    cleanupExpiredInventoryPublishHistory: maintenance,
    claimNextInventoryImportJob: claim, claimNextInventoryPublishJob: claim,
    processInventoryImportBatch: processBatch, processInventoryPublishBatch: processBatch,
    recordInventoryImportFailure: async () => { effects.records++; trace.push('recordFailure'); },
    recordInventoryPublishFailure2: async () => { effects.records++; trace.push('recordFailure'); },
    closeDb: async () => { effects.close++; trace.push('close'); }
  };
  context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(helper + mainText + '\n__offlineResult = main();', { filename: 'extracted-native-main.offline.js' }).runInContext(context, { timeout: 1000 });
  let rejected = false;
  try { await context.__offlineResult; } catch { rejected = true; }
  assert.equal(rejected, !!(options.missingDatabase || options.guardError), 'native-main rejection behavior changed');
  if (!options.missingDatabase) assert.equal(effects.close, 1);
  assert.deepEqual(envReads, ['DATABASE_URL'], 'only the unchanged native main may read its existing required configuration');
  return { trace, health, logs, sleeps, checks, effects };
}
function withoutHealth(result) {
  return { trace: result.trace.filter(value => !value.startsWith('health:')), logs: result.logs.filter(item => !item.value.startsWith('{')), sleeps: result.sleeps, checks: result.checks, effects: result.effects };
}
function directHealth(worker, calls) {
  const health = []; let at = 0;
  const deny = () => { throw new Error('health helper touched forbidden capability'); };
  const context = vm.createContext({ Date: { now: () => at }, console: { info: value => health.push({ at, value: JSON.parse(value) }) }, process: new Proxy({}, { get: deny }), require: deny, fetch: deny, setTimeout: deny, setInterval: deny }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(b.helper(worker.role) + `\n__emit = ${b.HEALTH_NAME};`).runInContext(context, { timeout: 1000 });
  for (const call of calls) { at = call.at; context.__emit(call.ready); }
  return health;
}
async function runGuard(worker, source, scenario) {
  const sf = b.parse(source);
  const declaration = sf.statements.find(n => n.getText(sf).startsWith('var isEnterpriseWorkerBusinessPermitted ='));
  assert.ok(declaration);
  const permitSource = source.slice(source.indexOf('var ENTERPRISE_WORKER_ROLES = ['), declaration.getStart(sf));
  const calls = { db: 0, ready: 0, stat: 0, read: 0 };
  const invalidBytes = Buffer.from('{invalid-json');
  const deps = {
    readPreservedAuditEpochBinding: () => scenario.binding,
    getDb: async () => { calls.db++; if (scenario.dbError) throw new Error('offline db denied'); return scenario.dbMissing ? null : Object.freeze({ offline: true }); },
    isMultiEnterpriseCutoverReady: async () => { calls.ready++; return !!scenario.ready; },
    lstat: async target => {
      calls.stat++;
      if (scenario.statError) throw new Error('offline virtual filesystem denied');
      const file = target.endsWith('denied.json');
      return { uid: 0, mode: file ? 0o600 : 0o755, nlink: 1, dev: 1, ino: 1, size: invalidBytes.length, mtimeMs: 0, isDirectory: () => !file, isFile: () => file, isSymbolicLink: () => false };
    },
    readFile: async () => { calls.read++; return invalidBytes; },
    entryPath: () => `/offline-only/${worker.name}`,
    permitPath: () => '/offline-only/mock/denied.json', now: () => 0
  };
  const context = vm.createContext({ ...path, createHash4: createHash, __deps: deps, process: { argv: [] }, nodeLstat: async () => { throw new Error('no actual filesystem'); }, nodeReadFile: async () => { throw new Error('no actual filesystem'); } }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(permitSource + '\n__guard = createEnterpriseWorkerBusinessPermitGuard(__deps);').runInContext(context, { timeout: 1000 });
  const result = await context.__guard(scenario.role || worker.role);
  return { result, calls };
}
async function workerTests(worker) {
  const source = b.readBaseline(worker);
  const edits = b.plan(worker, source), candidate = b.apply(source, edits);
  const candidatePath = path.join(b.CANDIDATE_DIR, worker.name);
  assert.equal(fs.readFileSync(candidatePath, 'utf8'), candidate, 'on-disk candidate must be the exact tested bytes');
  await test(worker, 'pinned baseline and inverse byte/AST, unchanged permit/main, node --check, one hunk', () => {
    const verified = b.verify(worker, source, candidate, edits).report;
    assert.equal(verified.modifiedHunksCount, 1); assert.equal(verified.insertionRangesCount, 3);
    assert.equal(verified.inverseSha256, worker.expected); assert.equal(verified.removedBytes, 0);
    assert.equal(b.hash(candidate), b.hash(fs.readFileSync(candidatePath)));
  });
  await test(worker, 'baseline drift refuses blind rebase', () => assert.throws(() => b.assertBaseline(worker, Buffer.from(source + '\n')), /baseline SHA mismatch/));
  await test(worker, 'business mutation rejected', () => assert.throws(() => b.verify(worker, source, candidate.replace('      let job;', '      let job = null;')), /unapproved modifications/));
  await test(worker, 'health mutation rejected', () => assert.throws(() => b.verify(worker, source, candidate.replace('6e4))', '1))')), /unapproved modifications/));
  await test(worker, 'inverse rejects changed insertion', () => assert.throws(() => b.inverse(candidate.replace(`${b.HEALTH_NAME}(false)`, `${b.HEALTH_NAME}(true)`), edits), /inverse insertion mismatch/));
  await test(worker, 'initial blocked event immediately with exact anonymous keys', async () => {
    const result = await runMain(worker, candidate, states([false]));
    assert.deepEqual(result.health, [{ at: 0, value: blocked(worker.role) }]); assert.equal(result.checks, 1);
  });
  await test(worker, 'continuous one-second blocked loop throttled before 60 seconds', async () => {
    const result = await runMain(worker, candidate, states(Array(60).fill(false)));
    assert.equal(result.health.length, 1); assert.equal(result.sleeps.length, 60); assert.ok(result.sleeps.every(ms => ms === 1000));
  });
  await test(worker, 'exact 60-second and 120-second blocked boundaries', async () => {
    const result = await runMain(worker, candidate, [0, 59999, 60000, 60001, 120000].map(at => ({ at, ready: false })));
    assert.deepEqual(result.health.map(item => item.at), [0, 60000, 120000]);
  });
  await test(worker, 'blocked-to-permitted logs readiness before any business side effect', async () => {
    const result = await runMain(worker, candidate, states([false, true]));
    assert.deepEqual(result.health.map(item => item.value), [blocked(worker.role), permitted(worker.role)]);
    assert.ok(result.trace.indexOf('health:true') < result.trace.indexOf('maintenance'));
    assert.ok(result.trace.indexOf('health:true') < result.trace.indexOf('claim'));
  });
  await test(worker, 'initial permitted and successful idle polling log only once', async () => {
    const result = await runMain(worker, candidate, states(Array(125).fill(true)));
    assert.deepEqual(result.health, [{ at: 0, value: permitted(worker.role) }]); assert.equal(result.effects.claims, 125);
  });
  await test(worker, 'permit revocation logs immediately and blocks business again', async () => {
    const result = await runMain(worker, candidate, [{ at: 0, ready: true }, { at: 1, ready: false }, { at: 60000, ready: false }, { at: 60001, ready: false }, { at: 60002, ready: true }]);
    assert.deepEqual(result.health.map(item => item.at), [0, 1, 60001, 60002]);
    assert.deepEqual(result.health.map(item => item.value.businessReady), [true, false, false, true]); assert.equal(result.effects.claims, 2);
  });
  await test(worker, 'blocked loop cannot claim, process, maintain, or write failure records', async () => {
    const result = await runMain(worker, candidate, states(Array(121).fill(false)));
    assert.deepEqual(result.effects, { maintenance: 0, claims: 0, process: 0, records: 0, close: 1 }); assert.equal(result.health.length, 3);
  });
  await test(worker, 'wall-clock rollback does not produce log storm', async () => {
    const result = await runMain(worker, candidate, [100000, 90000, 159999, 160000].map(at => ({ at, ready: false })));
    assert.deepEqual(result.health.map(item => item.at), [100000, 160000]);
  });
  await test(worker, 'health state resets independently on restart', () => {
    const calls = [{ at: 0, ready: false }];
    assert.deepEqual(directHealth(worker, calls), directHealth(worker, calls)); assert.equal(directHealth(worker, calls).length, 1);
  });
  await test(worker, 'helper has no environment, identifier, filesystem, module, network, or timer access', () => {
    const events = directHealth(worker, [{ at: 0, ready: false }, { at: 60000, ready: false }, { at: 60001, ready: true }, { at: 120001, ready: true }]);
    assert.equal(events.length, 3);
    assert.ok(!/process|env|password|jobId|workerId|customer|contact|client|require|import|setTimeout|setInterval|fetch|readFile|writeFile/.test(b.helper(worker.role).replaceAll(worker.role, 'anonymous-role')));
    assert.deepEqual(events.map(item => item.value), [blocked(worker.role), blocked(worker.role), permitted(worker.role)]);
  });
  await test(worker, 'unconfigured native main still rejects before health or guard', async () => {
    const result = await runMain(worker, candidate, [], { missingDatabase: true }); assert.equal(result.health.length, 0); assert.equal(result.checks, 0); assert.equal(result.effects.close, 0);
  });
  await test(worker, 'stopped native main does not check guard or touch business', async () => {
    const result = await runMain(worker, candidate, [], { initiallyStopping: true }); assert.equal(result.health.length, 0); assert.equal(result.checks, 0); assert.equal(result.effects.claims, 0);
  });
  for (const [name, options, steps] of [
    ['native idle/maintenance byte-equivalent observable behavior', { maintenanceChanges: true }, states([false, true, true])],
    ['native claim/process behavior unchanged', { withJob: true }, states([false, true])],
    ['native polling failure/error delay unchanged', { claimError: true }, states([true])],
    ['native batch failure/failure record unchanged', { withJob: true, processError: true }, states([true])],
    ['native guard exception remains fail-closed with finally', { guardError: true }, states([false])]
  ]) {
    await test(worker, name, async () => {
      const original = await runMain(worker, source, steps, options), changed = await runMain(worker, candidate, steps, options);
      assert.deepEqual(withoutHealth(changed), withoutHealth(original));
      if (options.guardError) assert.equal(changed.health.length, 0);
    });
  }
  const binding = Object.freeze({ epochId: 'offline-denied', proofSha256: '0'.repeat(64) });
  for (const [name, scenario, expected, noFiles] of [
    ['unknown worker role denied before dependencies', { role: 'unapproved-role', binding: null }, false, true],
    ['false epoch binding denied without database', { binding: false }, false, true],
    ['missing database denied without filesystem', { binding, dbMissing: true }, false, true],
    ['database error fails closed', { binding, dbError: true }, false, true],
    ['readiness false denied without permit read', { binding, ready: false }, false, true],
    ['virtual permit filesystem error fails closed', { binding, ready: true, statError: true }, false, false],
    ['invalid JSON bytes denied without fabricated valid permit', { binding, ready: true }, false, false],
    ['unchanged baseline null-binding semantics preserved', { binding: null }, true, true]
  ]) {
    await test(worker, `original guard: ${name}`, async () => {
      const original = await runGuard(worker, source, scenario), changed = await runGuard(worker, candidate, scenario);
      assert.deepEqual(changed, original); assert.equal(changed.result, expected);
      if (noFiles) { assert.equal(changed.calls.stat, 0); assert.equal(changed.calls.read, 0); }
    });
  }
  return { worker: worker.role, baselineSha256: worker.expected, candidateSha256: b.hash(candidate), passed: tests.filter(item => item.worker === worker.role).length, failed: 0 };
}
async function main() {
  assert.equal(process.argv.length, 2, 'no CLI options or rebase overrides');
  const workers = [];
  for (const worker of b.WORKERS) workers.push(await workerTests(worker));
  const report = { offlineOnly: true, fullBundleExecuted: false, realDatabaseCalls: 0, realNetworkCalls: 0, realPermitFilesReadOrWritten: 0, productionActions: 0, pureVmMocks: true, passed: tests.length, failed: 0, workers, tests };
  b.writeCandidate('health-tests.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(`offline health test failed: ${error.message}`); process.exitCode = 1; });
