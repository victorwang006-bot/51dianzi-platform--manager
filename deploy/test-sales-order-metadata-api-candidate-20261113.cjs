#!/usr/bin/env node
'use strict';
// Tests extract only actual additive candidate bytes and selected unchanged native
// authorization functions. The complete API is NEVER imported/executed.
const assert = require('assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const ts = require('typescript');
const { initTRPC, TRPCError } = require('@trpc/server');
const { sql } = require('drizzle-orm');
const C = require('./build-sales-order-metadata-api-20261113.cjs');
const { ROOT, OUT, BASE, read, sha, parse, fn, variable } = C;
const plain = value => JSON.parse(JSON.stringify(value));
const results = [];
async function test(name, run) { await run(); results.push({ name, status: 'PASS' }); }
async function rejects(run, code) {
  await assert.rejects(run, error => {
    assert(error instanceof TRPCError, 'native actual TRPCError import identity is retained');
    if (code) assert.equal(error.code, code);
    return true;
  });
}
async function main() {
  const proof = JSON.parse(read(path.join(OUT, 'api-build-proof.json')));
  const patches = JSON.parse(read(path.join(OUT, 'api-patches.json')));
  const candidate = read(path.join(OUT, 'admin-index-candidate.js'));
  const baseline = read(BASE);
  assert.equal(proof.status, 'PASS');
  assert.equal(sha(candidate), proof.candidateSha256);
  assert.equal(sha(baseline), C.BASE_SHA256);
  assert.deepEqual(proof.sourceHashes, C.sourceHashes(), 'candidate corresponds to final source hashes');
  let inverse = candidate;
  for (const edit of [...patches].reverse()) {
    assert.equal(candidate.slice(edit.afterStart, edit.afterEnd), edit.after, 'actual candidate patch bytes');
    assert.equal(baseline.slice(edit.start, edit.end), edit.before);
    inverse = inverse.slice(0, edit.afterStart) + edit.before + inverse.slice(edit.afterEnd);
  }
  assert.equal(inverse, baseline);
  const tree = parse(candidate), oldTree = parse(baseline);
  const patchFactory = candidate.slice(patches[0].afterStart, patches[0].afterEnd);
  assert.equal(sha(fn(parse(patchFactory), 'withBusinessSalesOrderMetadata').getText(parse(patchFactory)) + '\n'), proof.compiledHelperSha256);
  const object = variable(tree, 'crmSalesOrderBusinessRouter').initializer.arguments[0];
  const actualProps = object.properties.filter(n => Object.hasOwn(C.METHODS, n.name?.getText(tree)));
  assert.equal(actualProps.length, 4);
  assert.equal(actualProps.map(n => n.name.getText(tree)).sort().join(','), Object.keys(C.METHODS).sort().join(','));
  for (const prop of actualProps) assert.equal(prop.initializer.expression.name.text, C.METHODS[prop.name.getText(tree)]);
  for (const { name } of proof.protectedFunctions) assert.equal(fn(tree, name).getText(tree), fn(oldTree, name).getText(oldTree));
  for (const { name } of proof.protectedVariables) assert.equal(variable(tree, name).getText(tree), variable(oldTree, name).getText(oldTree));

  // Only the fictional in-memory SQL fixture is compiled from source. The service,
  // contract, helper and route expressions all come from the final candidate bytes.
  const fixtureFile = path.join(ROOT, 'server/services/businessSalesOrderMetadata.fixture.ts');
  const compiledFixture = await esbuild.transform(read(fixtureFile), { loader: 'ts', target: 'node20', format: 'cjs' });
  const fixtureContext = vm.createContext({ module: { exports: {} }, exports: {}, Date, structuredClone,
    require: name => { assert.equal(name, 'drizzle-orm/mysql-core'); return require(name); } });
  vm.runInContext(compiledFixture.code, fixtureContext, { timeout: 3000, filename: 'fictional-metadata-fixture.cjs' });
  const { MetadataMemoryDb, METADATA_FIXTURE_PROVENANCE: p, METADATA_FIXTURE_ACTOR: actor } = fixtureContext.module.exports;
  const merchant = { id: p.merchantId, crmStatus: 'enabled', registrationRegion: 'CN', registrationIdentifier: null,
    businessLicense: 'FICTIONAL-METADATA-LICENSE', crmOwnerPortalUserId: '999700' };
  const nativeFunctions = [
    'businessScopePermission', 'businessScopeAllows', 'requireBusinessAdminAccount', 'getBusinessWorkbenchMerchantIds',
    'parseBusinessMerchantId', 'businessMerchantIdFromContext', 'assertBusinessMerchantAccess',
    'businessEnterpriseBindingFromMerchant', 'businessAuditActor', 'requireCurrentBusinessStaffBinding',
    'isCustomerSupplyBusinessMethod', 'withCurrentBusinessAuthorization',
  ];
  let db, permissions, staff, original, upstreamError, fenceError, fenceHeld, allowDirectService;
  let events, upstreamCalls, dbCalls, scopeCalls, existingInvocations;
  const t = initTRPC.create();
  const mockDb = {
    withBusinessAuthorizationFence: async (key, run) => {
      assert.equal(key.adminUserId, actor.adminUserId);
      assert(Number.isSafeInteger(key.merchantId) && key.merchantId > 0);
      if (fenceError) throw fenceError;
      fenceHeld = true; events.push('fence-enter');
      try { return await run(); } finally { fenceHeld = false; events.push('fence-exit'); }
    },
    getActiveBusinessStaffBinding: async id => { assert.equal(id, actor.adminUserId); events.push('staff'); return staff; },
    getActiveBusinessMerchantScope: async (id, merchantId) => {
      assert.equal(id, actor.adminUserId); assert.equal(merchantId, p.merchantId); events.push('scope'); scopeCalls++;
      return permissions === null ? null : { adminUserId: id, merchantId, scopeVersion: actor.scopeVersion, modulePermissions: permissions };
    },
  };
  const context = vm.createContext({
    Date, structuredClone, console,
    process: { env: { NODE_ENV: 'test', BUSINESS_WORKBENCH_MERCHANT_IDS: String(p.merchantId) } },
    sql4: sql, __ir_admin_d67f0938_import_TRPCError: TRPCError, TRPCError5: TRPCError,
    __ir_admin_d67f0938_import_createHash: crypto.createHash, __ir_admin_d67f0938_import_randomUUID: crypto.randomUUID,
    __ir_admin_d67f0938_namespace_db: mockDb,
    getActiveBusinessMerchantScope: (...args) => mockDb.getActiveBusinessMerchantScope(...args),
    getBusinessWorkbenchMerchantById: async id => { assert.equal(id, p.merchantId); return { ...merchant }; },
    getDb: async () => { assert(fenceHeld || allowDirectService, 'metadata DB must follow original auth/get'); dbCalls++; events.push('native-db'); return db; },
    callPlatformBusinessCommand: async command => {
      assert(fenceHeld, 'original command stays inside unchanged authorization fence');
      assert.equal(command.method, 'crmSalesOrder.get', 'no refund/payment/stock/cancel/or other original method');
      assert.equal(command.staffUserId, staff.frontUserId); assert.equal(command.bindingVersion, staff.bindingVersion);
      assert.deepEqual(plain(command.adminActor), { id: actor.adminUserId, name: '虚构操作员', role: 'merchant_mgr' });
      assert.deepEqual(plain(command.binding), { creditCode: merchant.businessLicense, expectedOwnerUserId: 999700 });
      upstreamCalls.push(plain(command)); events.push('original-get');
      if (upstreamError) throw upstreamError;
      return original;
    },
    router: t.router, publicProcedure: t.procedure,
    businessQuery: method => t.procedure.query(() => { existingInvocations.push(method); throw new Error('original procedure must not be invoked'); }),
    businessMutation: method => t.procedure.mutation(() => { existingInvocations.push(method); throw new Error('original procedure must not be invoked'); }),
    currentOfficialInventoryPermissions: () => { throw new Error('metadata must not invoke official inventory permissions'); },
    withOfficialChannelProfileRead: () => { throw new Error('metadata must not invoke channel profile'); },
  });
  const extracted = ['PlatformBusinessPublicError', 'BusinessFailureCause', 'CUSTOMER_SUPPLY_BUSINESS_METHOD_IDS']
    .map(name => 'var ' + variable(tree, name).getText(tree) + ';').join('\n') + '\n' +
    nativeFunctions.map(name => fn(tree, name).getText(tree)).join('\n') + '\n';
  const routerText = 'var ' + variable(tree, 'crmSalesOrderBusinessRouter').getText(tree) + ';';
  vm.runInContext(extracted + patchFactory + routerText +
    `\nglobalThis.actual={service:${C.SERVICE_NAME},contract:${C.CONTRACT_NAME},router:crmSalesOrderBusinessRouter,helper:withBusinessSalesOrderMetadata,PublicError:PlatformBusinessPublicError};`,
    context, { timeout: 10000, filename: 'actual-api-candidate-isolated.js' });
  const actual = context.actual;
  function reset() {
    db = new MetadataMemoryDb(); permissions = ['business.orders.read', 'business.orders.write', 'business.customers.read'];
    staff = { adminUserId: actor.adminUserId, frontUserId: actor.frontUserId, bindingVersion: actor.bindingVersion };
    original = { id: p.orderId, orderNumber: p.orderNumber, customerId: p.customerId };
    upstreamError = fenceError = null; fenceHeld = allowDirectService = false;
    merchant.crmStatus = 'enabled'; events = []; upstreamCalls = []; dbCalls = scopeCalls = 0; existingInvocations = [];
  }
  const ctx = changes => ({ user: { id: 998303, role: 'admin' }, adminAccount: { id: actor.adminUserId, status: 'active', adminRole: 'merchant_mgr', displayName: '虚构操作员' },
    adminPermissions: [], req: { headers: { 'x-business-merchant-id': String(p.merchantId) }, ip: '203.0.113.99' }, ...changes });
  const caller = changes => actual.router.createCaller(ctx(changes));
  const receiver = changes => ({ id: p.orderId, customerId: p.customerId, receiver: '虚构姓名', receiverPhone: '000-TEST', receiverAddress: '虚构测试地址', note: '', version: 0, requestId: 'fictional_receiver_0001', ...changes });
  const afterSale = changes => ({ id: p.orderId, customerId: p.customerId, kind: 'consultation', reason: '虚构咨询记录', requestId: 'fictional_after_sale_0001', ...changes });
  async function noIo(run, code) { await rejects(run, code); assert.equal(dbCalls, 0); assert.equal(db.calls.length, 0); assert.equal(db.state.audits.length, 0); }
  async function noOriginalOrIo(run, code) { await noIo(run, code); assert.equal(upstreamCalls.length, 0); }
  async function caseUpdate(added, changes) {
    return caller().updateAfterSale({ id: p.orderId, caseId: added.id, version: 1, status: 'closed', resolution: '仅结案登记，不退款不退库', requestId: 'fictional_update_0001', ...changes });
  }
  reset();
  await test('exact inverse, preserved native auth/imports/archive bytes and source hashes', async () => {
    assert.equal(inverse, baseline); assert.equal(proof.originalArchiveFactoryAndHookUnchanged, true);
  });
  await test('actual tRPC router has exactly four fixed metadata methods with correct query/mutation types', async () => {
    for (const [name, type] of Object.entries(C.METHODS)) assert.equal(actual.router._def.procedures[name]._def.type, type);
    assert.equal(actual.router._def.procedures.deleteAfterSale, undefined);
    assert.equal(Object.keys(actual.router._def.procedures).length, variable(oldTree, 'crmSalesOrderBusinessRouter').initializer.arguments[0].properties.length + 4);
    assert.equal(typeof actual.helper, 'function');
    for (const name of ['getBusinessSalesOrderMetadata', 'saveBusinessSalesOrderReceiver', 'addBusinessSalesOrderAfterSale', 'updateBusinessSalesOrderAfterSale']) assert.equal(typeof actual.service[name], 'function');
  });
  await test('actual metadata query executes unchanged native authorization and original get before SELECT-only DB', async () => {
    reset(); const promise = caller().metadataGet({ id: p.orderId, customerId: p.customerId }); assert.equal(typeof promise.then, 'function');
    assert.deepEqual(plain(await promise), { ...plain(p), receiver: null, afterSales: [] });
    assert.deepEqual(events, ['fence-enter', 'staff', 'scope', 'scope', 'original-get', 'native-db', 'fence-exit']);
    assert.equal(scopeCalls, 2); assert(db.calls.every(call => call.sql.startsWith('SELECT')));
    assert.deepEqual(upstreamCalls[0].params, { id: p.orderId, customerId: p.customerId });
  });
  await test('read mode succeeds without orders.write; all three metadata writes fail before get/SQL', async () => {
    reset(); permissions = ['business.orders.read', 'business.customers.read'];
    await caller().metadataGet({ id: p.orderId }); upstreamCalls = []; dbCalls = 0; db.calls = [];
    await noOriginalOrIo(() => caller().saveReceiver(receiver()), 'FORBIDDEN');
    await noOriginalOrIo(() => caller().addAfterSale(afterSale()), 'FORBIDDEN');
    await noOriginalOrIo(() => caller().updateAfterSale({ id: p.orderId, caseId: 992001, version: 1, status: 'closed', resolution: '', requestId: 'fictional_readonly_1' }), 'FORBIDDEN');
  });
  await test('write mode does not silently downgrade to read; write-only orders scope allows explicit save only', async () => {
    reset(); permissions = ['business.orders.write', 'business.customers.read'];
    await noOriginalOrIo(() => caller().metadataGet({ id: p.orderId }), 'FORBIDDEN');
    assert.equal((await caller().saveReceiver(receiver())).version, 1);
  });
  for (const scenario of ['missing-binding', 'revoked-scope', 'no-orders', 'no-customer-intersection', 'customer-write-only']) {
    await test('native authorization/customer read intersection rejects ' + scenario + ' before original get or metadata IO', async () => {
      reset();
      if (scenario === 'missing-binding') staff = null;
      if (scenario === 'revoked-scope') permissions = null;
      if (scenario === 'no-orders') permissions = ['business.customers.read'];
      if (scenario === 'no-customer-intersection') permissions = ['business.orders.read', 'business.orders.write'];
      if (scenario === 'customer-write-only') permissions = ['business.orders.read', 'business.orders.write', 'business.customers.write'];
      await noOriginalOrIo(() => caller().metadataGet({ id: p.orderId }));
      await noOriginalOrIo(() => caller().saveReceiver(receiver()));
    });
  }
  for (const session of ['anonymous', 'oauth', 'inactive']) await test('native account rejects ' + session + ' before SQL', async () => {
    reset(); const changes = session === 'anonymous' ? { user: null, adminAccount: null } : session === 'oauth' ? { adminAccount: null } : { adminAccount: { ...ctx().adminAccount, status: 'disabled' } };
    await noOriginalOrIo(() => caller(changes).metadataGet({ id: p.orderId }), session === 'inactive' ? 'FORBIDDEN' : 'UNAUTHORIZED');
  });
  await test('super-admin label cannot replace revoked native business scope', async () => {
    reset(); permissions = []; await noOriginalOrIo(() => caller({ adminAccount: { ...ctx().adminAccount, adminRole: 'super_admin' } }).saveReceiver(receiver()), 'FORBIDDEN');
  });
  await test('unchanged native merchant allowlist and strict header reject wrong merchant before scope/get/SQL', async () => {
    reset();
    await noOriginalOrIo(() => caller({ req: { headers: { 'x-business-merchant-id': String(p.merchantId + 1) } } }).metadataGet({ id: p.orderId }), 'NOT_FOUND');
    assert.equal(scopeCalls, 0);
    await noOriginalOrIo(() => caller({ req: { headers: { 'x-business-merchant-id': ['991201'] } } }).metadataGet({ id: p.orderId }), 'BAD_REQUEST');
  });
  await test('disabled original merchant enterprise binding rejects before get or native IO', async () => {
    reset(); merchant.crmStatus = 'disabled'; await noOriginalOrIo(() => caller().metadataGet({ id: p.orderId }), 'PRECONDITION_FAILED');
  });
  for (const code of ['FORBIDDEN', 'NOT_FOUND']) await test('original get ' + code + ' retains public error identity and metadata IO zero', async () => {
    reset(); upstreamError = new actual.PublicError(code, '虚构订单不可见');
    await noIo(() => caller().metadataGet({ id: p.orderId }), code);
    await noIo(() => caller().saveReceiver(receiver()), code);
  });
  await test('raw original transport/auth fence errors are bounded with no private cause', async () => {
    reset(); upstreamError = new Error('fictional-private-transport-path'); await noIo(() => caller().addAfterSale(afterSale()), 'SERVICE_UNAVAILABLE');
    reset(); fenceError = new Error('fictional-private-fence-path');
    await assert.rejects(() => caller().metadataGet({ id: p.orderId }), error => error.code === 'SERVICE_UNAVAILABLE' && error.cause === undefined && !String(error).includes('fictional-private'));
    assert.equal(dbCalls, 0);
  });
  const wrongOrders = [null, [], {}, { id: String(p.orderId), orderNumber: p.orderNumber, customerId: p.customerId },
    { id: p.orderId + 1, orderNumber: p.orderNumber, customerId: p.customerId },
    { id: p.orderId, orderNumber: p.orderNumber, customerId: p.customerId + 1 },
    { id: p.orderId, orderNumber: '', customerId: p.customerId },
    { id: p.orderId, orderNumber: p.orderNumber, customerId: p.customerId, merchantId: p.merchantId + 1 }];
  for (let i = 0; i < wrongOrders.length; i++) await test('wrong original tuple #' + i + ' fails closed before metadata SQL', async () => {
    reset(); original = wrongOrders[i]; await noIo(() => caller().saveReceiver(receiver()), 'SERVICE_UNAVAILABLE');
  });
  for (const key of ['merchantId', 'actorAdminId', 'frontUserId', 'bindingVersion', 'method', 'amount', 'refundEvidence']) await test('actual strict schema rejects forged ' + key + ' before auth/get/SQL', async () => {
    reset(); await noOriginalOrIo(() => caller().saveReceiver(receiver({ [key]: key === 'method' ? 'order.refund' : 1 })), 'BAD_REQUEST'); assert.deepEqual(events, []);
  });
  await test('all four actual procedure inputs reject unknown fields rather than stripping financial/identity fields', async () => {
    reset();
    await noOriginalOrIo(() => caller().metadataGet({ id: p.orderId, merchantId: p.merchantId }), 'BAD_REQUEST');
    await noOriginalOrIo(() => caller().addAfterSale(afterSale({ amount: '1.00' })), 'BAD_REQUEST');
    await noOriginalOrIo(() => caller().updateAfterSale({ id: p.orderId, caseId: 992001, version: 1, status: 'closed', resolution: '', requestId: 'fictional_strict_0001', method: 'order.refund' }), 'BAD_REQUEST');
    assert.deepEqual(events, []);
  });
  await test('actual contract bounds fields and rejects empty record, unknown kind and zero update version', async () => {
    reset(); await noOriginalOrIo(() => caller().saveReceiver(receiver({ receiver: ' ', receiverPhone: '', receiverAddress: '', note: '' })), 'BAD_REQUEST');
    await noOriginalOrIo(() => caller().saveReceiver(receiver({ note: 'x'.repeat(501) })), 'BAD_REQUEST');
    await noOriginalOrIo(() => caller().addAfterSale(afterSale({ kind: 'return' })), 'BAD_REQUEST');
    await noOriginalOrIo(() => caller().updateAfterSale({ id: p.orderId, caseId: 992001, version: 0, status: 'closed', resolution: '', requestId: 'fictional_version_0' }), 'BAD_REQUEST');
    assert.equal(actual.contract.BUSINESS_AFTER_SALE_STATUS_LABELS.open, '登记'); assert.equal(actual.contract.BUSINESS_AFTER_SALE_STATUS_LABELS.closed, '已结案');
  });
  await test('actual bundled receiver service saves version 0→1→2, parameterized SQL and fresh native audit', async () => {
    reset(); const note = "' ); DROP TABLE orders; -- 虚构测试";
    const first = await caller().saveReceiver(receiver({ note }));
    const second = await caller().saveReceiver(receiver({ version: 1, note: '新备注', requestId: 'fictional_receiver_0002' }));
    assert.equal(first.version, 1); assert.equal(second.version, 2); assert(first.createdAt.endsWith('Z'));
    assert.equal(db.state.audits.length, 2);
    assert.deepEqual(plain(db.state.audits.map(row => ({ adminUserId: row.actorAdminId, frontUserId: row.actorFrontUserId, bindingVersion: row.bindingVersion, scopeVersion: row.scopeVersion }))), [plain(actor), plain(actor)]);
    assert(db.calls.every(call => !call.sql.includes(note))); assert(db.calls.some(call => call.params.includes(note)));
    assert.equal(JSON.parse(db.state.audits[1].beforeJson).version, 1); assert.equal(JSON.parse(db.state.audits[1].afterJson).version, 2);
    assert.deepEqual(plain((await caller().metadataGet({ id: p.orderId })).receiver), plain(second));
  });
  await test('actual bundled receiver replay returns original result after later CAS update with no duplicate audit', async () => {
    reset(); const first = await caller().saveReceiver(receiver());
    await caller().saveReceiver(receiver({ version: 1, note: 'later', requestId: 'fictional_receiver_0002' }));
    assert.deepEqual(plain(await caller().saveReceiver(receiver())), plain(first));
    assert.equal(db.state.audits.length, 2); assert.equal(db.state.requests.length, 2); assert.equal(db.state.receivers[0].version, 2);
  });
  await test('same request changed payload/action, stale version and SQL CAS miss roll back atomically', async () => {
    reset(); await caller().saveReceiver(receiver()); const previous = plain(db.state);
    await rejects(() => caller().saveReceiver(receiver({ note: 'changed' })), 'CONFLICT');
    await rejects(() => caller().addAfterSale(afterSale({ requestId: receiver().requestId })), 'CONFLICT');
    await rejects(() => caller().saveReceiver(receiver({ requestId: 'fictional_stale_0001' })), 'CONFLICT');
    db.forceCasMiss = true; await rejects(() => caller().saveReceiver(receiver({ version: 1, requestId: 'fictional_cas_miss_0001' })), 'CONFLICT');
    assert.deepEqual(plain(db.state), previous);
  });
  for (const stage of ['audit', 'request-completion']) await test('actual bundle ' + stage + ' failure rolls back base/receiver/request/audit', async () => {
    reset(); db.failAudit = stage === 'audit'; db.failRequestCompletion = stage === 'request-completion';
    await rejects(() => caller().saveReceiver(receiver()), stage === 'audit' ? 'SERVICE_UNAVAILABLE' : 'CONFLICT');
    assert.deepEqual(plain(db.state), { bases: [], receivers: [], cases: [], requests: [], audits: [], nextCaseId: 992001 });
    assert.deepEqual(plain(db.events), ['begin', 'rollback']);
  });
  await test('actual bundle concurrent replay and distinct stale requests preserve one audited receiver', async () => {
    reset(); const [a, b] = await Promise.all([caller().saveReceiver(receiver()), caller().saveReceiver(receiver())]);
    assert.deepEqual(plain(a), plain(b)); assert.equal(db.state.audits.length, 1);
    reset(); const settled = await Promise.allSettled([caller().saveReceiver(receiver()), caller().saveReceiver(receiver({ requestId: 'fictional_other_0001' }))]);
    assert.equal(settled.filter(item => item.status === 'fulfilled').length, 1); assert.equal(settled.find(item => item.status === 'rejected').reason.code, 'CONFLICT');
    assert.equal(db.state.audits.length, 1); assert.equal(db.state.requests.length, 1);
  });
  for (const kind of ['consultation', 'repair', 'exchange', 'return_request', 'refund_request']) await test('actual bundle ' + kind + ' is intent-only, replayable, no financial/stock/original mutation', async () => {
    reset(); const first = await caller().addAfterSale(afterSale({ kind })); const second = await caller().addAfterSale(afterSale({ kind }));
    assert.deepEqual(plain(first), plain(second)); assert.equal(first.kind, kind); assert.equal(first.status, 'open'); assert.equal(first.closedAt, null);
    assert.equal(db.state.audits.length, 1); assert.equal(db.state.receivers.length, 0); assert.equal(first.amount, undefined);
    assert(upstreamCalls.every(call => call.method === 'crmSalesOrder.get')); assert.deepEqual(existingInvocations, []);
  });
  await test('actual after-sale update CAS/close/reopen/replay and rollback preserve independent audited records', async () => {
    reset(); const added = await caller().addAfterSale(afterSale({ kind: 'refund_request' }));
    const closed = await caseUpdate(added); assert.equal(closed.version, 2); assert(closed.closedAt.endsWith('Z'));
    assert.deepEqual(plain(await caseUpdate(added)), plain(closed));
    const noted = await caseUpdate(added, { version: 2, resolution: '备注', requestId: 'fictional_note_0001' }); assert.equal(noted.closedAt, closed.closedAt);
    const reopened = await caseUpdate(added, { version: 3, status: 'open', requestId: 'fictional_reopen_0001' }); assert.equal(reopened.closedAt, null);
    const previous = plain(db.state); db.failAudit = true;
    await rejects(() => caseUpdate(added, { version: 4, requestId: 'fictional_fail_audit_0001' }), 'SERVICE_UNAVAILABLE'); assert.deepEqual(plain(db.state), previous);
    assert.equal(db.state.audits.length, 4);
  });
  await test('current original visibility still required for replay; fresh binding determines next audit actor', async () => {
    reset(); await caller().saveReceiver(receiver()); const previous = plain(db.state); dbCalls = 0; db.calls = [];
    upstreamError = new actual.PublicError('FORBIDDEN', '虚构范围撤销'); await rejects(() => caller().saveReceiver(receiver()), 'FORBIDDEN');
    assert.equal(dbCalls, 0); assert.deepEqual(plain(db.state), previous);
    upstreamError = null; staff = { ...staff, frontUserId: actor.frontUserId + 1, bindingVersion: actor.bindingVersion + 1 };
    await caller().addAfterSale(afterSale()); assert.equal(db.state.audits[1].actorFrontUserId, staff.frontUserId); assert.equal(db.state.audits[1].bindingVersion, staff.bindingVersion);
  });
  await test('actual service malformed SQL rows and corrupt request replay fail closed', async () => {
    reset(); db.malformedSelect = true; await rejects(() => caller().metadataGet({ id: p.orderId }), 'SERVICE_UNAVAILABLE');
    reset(); await caller().saveReceiver(receiver()); db.state.requests[0].resultJson = '{bad-json';
    await rejects(() => caller().saveReceiver(receiver()), 'SERVICE_UNAVAILABLE');
  });
  await test('actual bundle unavailable transaction sanitizes native DB errors and emits no SQL', async () => {
    reset(); db.unavailableTransaction = true;
    await assert.rejects(() => caller().metadataGet({ id: p.orderId }), error => error instanceof TRPCError && error.code === 'SERVICE_UNAVAILABLE' && error.cause === undefined && !String(error).includes('fictional-private'));
    assert.equal(db.calls.length, 0);
  });
  await test('actual bundle stored wrong provenance read/write conflict and rollback', async () => {
    reset(); await caller().saveReceiver(receiver()); db.state.bases[0].customerId++;
    const previous = plain(db.state);
    await rejects(() => caller().metadataGet({ id: p.orderId }), 'CONFLICT');
    await rejects(() => caller().saveReceiver(receiver({ version: 1, requestId: 'fictional_collision_0001' })), 'CONFLICT'); assert.deepEqual(plain(db.state), previous);
  });
  await test('actual service SQL is restricted to five metadata tables and no DELETE or original business side effects', async () => {
    reset(); await caller().saveReceiver(receiver()); const added = await caller().addAfterSale(afterSale({ kind: 'return_request' })); await caseUpdate(added); await caller().metadataGet({ id: p.orderId });
    const allowed = new Set(['business_sales_order_metadata_orders', 'business_sales_order_receivers', 'business_sales_order_after_sales', 'business_sales_order_metadata_requests', 'business_sales_order_metadata_audits']);
    for (const call of db.calls) {
      assert(!/^DELETE\b/.test(call.sql));
      const match = call.sql.match(/(?:FROM|INTO|UPDATE)\s+(business_[a-z_]+)/); assert(match && allowed.has(match[1]));
      assert(!/\b(crm_sales_orders|orders|stocks|payments)\b/.test(call.sql));
      assert(call.transaction > 0);
    }
    assert(upstreamCalls.every(call => call.method === 'crmSalesOrder.get')); assert.deepEqual(existingInvocations, []);
  });
  assert.equal(sha(read(path.join(OUT, 'admin-index-candidate.js'))), proof.candidateSha256, 'candidate stable throughout tests');
  assert.deepEqual(C.sourceHashes(), proof.sourceHashes, 'sources stable throughout tests');
  const report = { status: 'PASS', actualCandidatePatchBytesExecuted: true, testCount: results.length,
    baselineSha256: sha(baseline), candidateSha256: sha(candidate), sourceHashes: proof.sourceHashes,
    patchFactorySha256: sha(patchFactory), actualRouterPropertiesSha256: sha(actualProps.map(p => p.getText(tree)).join('\n')),
    nativeAuthorizationFunctionsExecuted: nativeFunctions, results,
    exactInverse: true, allNonpatchBytesUnchanged: true, noLiveIo: true, noOriginalFinancialInventoryCancelCalls: true,
    diBoundary: 'Only final candidate factory/contract/helper and actual full crm router declaration plus listed unchanged native auth functions execute in isolated VM. Real installed tRPC procedure/schema semantics and native TRPCError identity; native DB/fence/staff/scope/merchant/ERP suppliers are fictional spies. Only fictional SQL fixture compiled from source. No complete API/package startup, listener, network, credentials, real DB or live order changes.',
    timezoneBoundary: proof.timezoneBoundary,
  };
  C.write('actual-api-candidate-tests.json', report);
  console.log(JSON.stringify({ status: 'PASS', phase: 'ACTUAL_CANDIDATE_TEST', tests: results.length, actualCandidatePatchBytesExecuted: true, candidateSha256: proof.candidateSha256 }));
}
module.exports = { main };
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
