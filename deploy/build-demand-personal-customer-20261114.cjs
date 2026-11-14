#!/usr/bin/env node
'use strict';
const C = require('./demand-personal-core-20261114.cjs');
const F = require('./demand-personal-factory-20261114.cjs');
const cp = require('node:child_process');
const { fs, assert, REPO, BASE, OUT, read, sha, parse, one, write, apply, top } = C;
const W = '/home/ubuntu/work/demand-personal-center';
const REV = '8bf6bd516dc16348f20769eb8292df287b7b4da0';
const P = 'client/src/business/platform/client/src/';
async function build() {
  const reproduction = JSON.parse(read(W + '/baseline-factory-reproduction.json'));
  assert(reproduction.proofs.every(p => p.exactBaselineReproduction));
  const r = await F.compileCustomerFactory({ includeProcurement: true });
  const a = parse(r.code);
  const newInit = one(a, n => C.ts.isVariableDeclaration(n) && n.name.getText(a) === '__CUSTOMER_WORKBENCH_EXPORTS', 'new source factory').initializer;
  const baselineHashes = { ...reproduction.sourceHashes };
  for (const f of Object.keys(r.sourceHashes)) if (!Object.hasOwn(baselineHashes, f)) {
    const bytes = cp.execFileSync('git', ['show', REV + ':' + f], { cwd: REPO, maxBuffer: 10 * 1024 * 1024 });
    baselineHashes[f] = sha(bytes);
  }
  const changed = Object.keys(r.sourceHashes).filter(f => r.sourceHashes[f] !== baselineHashes[f]).sort();
  const authorizedPages = new Set([P + 'pages/ChannelInventoryHost.tsx', P + 'pages/channelInventoryColumns.ts', P + 'pages/ProcurementDemands.tsx']);
  assert(changed.length > 0);
  assert(changed.every(f => f.startsWith(P + 'components/customerDemands/') || f === 'client/src/business/platform/shared/customerDemands.ts' || authorizedPages.has(f)), 'Customer scope exceeded user-approved demand/inventory/procurement files');
  write('customer-factory.js', r.code);
  write('customer-factory-metafile.json', r.metafile);
  write('customer-source-hashes.json', r.sourceHashes);
  const records = [], relocations = {}, proofs = [];
  for (const [idx, url] of JSON.parse(read(BASE + '/active-workbenches.json')).entries()) {
    const before = read(BASE + url), oldA = parse(before), getter = top(oldA, '__CW_CUSTOMER_GET');
    const oldInit = one(getter, n => C.ts.isVariableDeclaration(n) && n.name.getText(oldA) === '__CUSTOMER_WORKBENCH_EXPORTS', 'deployed source factory').initializer;
    const oldLive = one(getter, n => C.ts.isVariableDeclaration(n) && n.name.getText(oldA) === '__customerLive', 'live bridge').initializer;
    assert.equal(sha(oldInit.getText(oldA)), reproduction.proofs[idx].oldSha256);
    for (const [key, expression] of Object.entries(r.live)) {
      const prop = one(oldLive, n => C.ts.isPropertyAssignment(n) && n.parent === oldLive && n.name.text === key, 'bridge ' + key);
      assert.equal(prop.initializer.getText(oldA), expression);
    }
    const procurementPage = top(oldA, 'Cx');
    assert(procurementPage.getText(oldA).includes('customerDemand.procurementList.useQuery'));
    assert(procurementPage.getText(oldA).includes('firstPartNumber'));
    assert(procurementPage.getText(oldA).includes('ProcurementDemands.tsx'));
    const procurementRouteAfter = 'function Cx(){return ' + r.live.jsx + '.jsx(__CW_CUSTOMER_GET().ProcurementDemands,{})}';
    const edits = [
      { start: oldInit.getStart(oldA), end: oldInit.end, before: oldInit.getText(oldA), after: newInit.getText(a), reason: 'Source-bound demand confirmation, authorized stock source presentation, procurement full material access' },
      { start: procurementPage.getStart(oldA), end: procurementPage.end, before: procurementPage.getText(oldA), after: procurementRouteAfter, reason: 'Delegate only original procurement page to full source export using exact native JSX bridge; existing detail/quote/native owners retained byte-identically' },
    ];
    const result = apply(before, edits, 'workbench-' + idx);
    const afterA = parse(result.after), protectedFunctionHashes = {};
    for (const name of ['op', 'uI', 'Iw', 'I1', 'KI', 'Ty', 'Ly', 'Uy', '__d51_so_get', '__d51_ir_w_get', '__d51_rx_chat_helpers_get', 'wI', 'vI', 'Hb']) {
      assert.equal(top(oldA, name).getText(oldA), top(afterA, name).getText(afterA));
      protectedFunctionHashes[name] = sha(top(oldA, name).getText(oldA));
    }
    const nextLive = one(top(afterA, '__CW_CUSTOMER_GET'), n => C.ts.isVariableDeclaration(n) && n.name.getText(afterA) === '__customerLive', 'preserved bridge').initializer;
    assert.equal(nextLive.getText(afterA), oldLive.getText(oldA));
    assert.equal(top(afterA, 'Cx').getText(afterA), procurementRouteAfter);
    const to = '/assets/BusinessWorkbenchPage-demand-personal-' + idx + '-' + sha(result.after) + '.js';
    write(to, result.after); records.push({ relative: to.slice(1), sha256: sha(result.after) }); relocations[url] = to;
    const proof = { ...result.proof, beforeUrl: url, url: to, protectedFunctionHashes, factorySha256: sha(r.code), sourceHashes: r.sourceHashes, changedSourceFiles: changed, baselineSourceByteReproduced: true, allOutsideAuthorizedFactoryAndProcurementRouteBytesUnchanged: true, nativeSingletonBridgeByteIdentical: true, ordersAndBomHandlersPreserved: true, mallBytesUnchanged: true, procurementRouteSourceBound: true, retainedLegacyProcurementOwners: ['wI', 'vI', 'Hb'], procurementBeforeSha256: sha(procurementPage.getText(oldA)) };
    write('workbench-' + idx + '-build-proof.json', proof); proofs.push(proof);
  }
  for (const [f, hash] of Object.entries(r.sourceHashes)) assert.equal(sha(fs.readFileSync(REPO + '/' + f)), hash);
  write('customer-parts.json', { status: 'PASS', records, relocations, sourceHashes: r.sourceHashes, changedSourceFiles: changed, proofs });
  console.log(JSON.stringify({ status: 'PASS', files: records.length, changedSourceFiles: changed }));
}
if (require.main === module) build().catch(e => { console.error(e.stack); process.exitCode = 1; });
module.exports = { build };
