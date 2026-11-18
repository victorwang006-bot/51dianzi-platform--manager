#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const b = require('./build.cjs');
const z = require('zod').z;
const GOOD = { isSuccess: true, isFetchedAfterMount: true, isError: false,
  isPending: false, isFetching: false, isPlaceholderData: false };
let assertions = 0;
function equal(actual, expected, message) { assertions++; assert.equal(actual, expected, message); }
function deep(actual, expected, message) { assertions++; assert.deepEqual(actual, expected, message); }
function ok(value, message) { assertions++; assert(value, message); }
function evaluate(text, context) { return vm.runInContext('(' + text + ')', context, { timeout: 1000 }); }
function syntheticSummary(id, type = 'wechat', value = 'synthetic-handle', name = 'Synthetic contact') {
  return { customerId: id, contactCount: 1, primaryContact: { id: 7, name,
    methods: [{ type, value }] } };
}
function proveBytes(before, after, proof) {
  equal(b.sha(before), (proof.proof || proof).beforeSha256, 'Baseline digest');
  equal(b.sha(after), (proof.proof || proof).sha256, 'Candidate digest');
  let restored = after;
  const edits = proof.edits;
  for (const edit of [...edits].reverse()) {
    equal(before.slice(edit.start, edit.end), edit.before, 'Exact old interval');
    equal(after.slice(edit.afterStart, edit.afterEnd), edit.after, 'Exact new interval');
    restored = restored.slice(0, edit.afterStart) + edit.before + restored.slice(edit.afterEnd);
  }
  ok(Buffer.from(restored).equals(Buffer.from(before)), 'Exact UTF-8 inverse');
  let oldCursor = 0, newCursor = 0;
  for (let i = 0; i < proof.partitions.length; i++) {
    const part = proof.partitions[i];
    equal(part.beforeStart, oldCursor, 'All untouched old partitions are contiguous with edits');
    equal(part.afterStart, newCursor, 'All untouched new partitions are contiguous with edits');
    const old = before.slice(part.beforeStart, part.beforeEnd);
    const next = after.slice(part.afterStart, part.afterEnd);
    ok(Buffer.from(old).equals(Buffer.from(next)), 'Nonpatch UTF-8 bytes unchanged');
    equal(b.sha(old), part.sha256, 'Partition digest');
    equal(Buffer.byteLength(old), part.utf8Bytes, 'Partition byte count');
    if (i < edits.length) {
      equal(part.beforeEnd, edits[i].start, 'Partition connects to old edit');
      equal(part.afterEnd, edits[i].afterStart, 'Partition connects to new edit');
      oldCursor = edits[i].end; newCursor = edits[i].afterEnd;
    } else { oldCursor = part.beforeEnd; newCursor = part.afterEnd; }
  }
  equal(oldCursor, before.length, 'Complete baseline coverage');
  equal(newCursor, after.length, 'Complete candidate coverage');
}
function helperTests(source) {
  const context = vm.createContext({ z });
  vm.runInContext(source.compiled, context, { timeout: 1000 });
  const needs = context.customerNeedsCompletion, verified = context[source.helperName];
  for (const flag of ['isError', 'isPending', 'isFetching', 'isPlaceholderData'])
    equal(verified({ ...GOOD, [flag]: true }, true), false, 'Reject ' + flag);
  for (const flag of ['isSuccess', 'isFetchedAfterMount']) {
    for (const value of [false, undefined]) equal(verified({ ...GOOD, [flag]: value }, true), false, 'Require strict true: ' + flag);
  }
  equal(verified(GOOD, true), true, 'Verified query');
  equal(verified(GOOD, false), false, 'Unready scope');
  const record = { name: 'Synthetic customer', contactName: '', phone: '' };
  equal(needs(record, undefined), undefined, 'Unverified summary is unknown, no legacy fallback');
  for (const [type, value] of [['wechat', 'synthetic-handle'], ['qq', 'synthetic-qq'],
    ['other', 'synthetic-channel'], ['email', 'synthetic@example.invalid'], ['mobile', '15500000000'],
    ['landline', '+1 (202) 555-0100']]) {
    equal(needs(record, syntheticSummary(101, type, value)), false, 'Accepted contact method ' + type);
  }
  for (const [type, value] of [['email', 'invalid-email'], ['mobile', 'bad-phone'],
    ['wechat', ' '], ['qq', ''], ['other', 'x'.repeat(255)], ['unsupported', 'channel']]) {
    equal(needs(record, syntheticSummary(101, type, value)), true, 'Invalid contact method ' + type);
  }
  equal(needs(record, null), true, 'Verified absent primary contact');
  equal(needs(record, syntheticSummary(101, 'wechat', 'synthetic', ' ')), true, 'Missing primary name');
  equal(needs({ ...record, name: '' }, syntheticSummary(101)), true, 'Verified missing customer name');
  equal(needs({ ...record, name: '' }, undefined), true, 'Actual source priority: missing customer name is already known incomplete');
  equal(needs({ ...record, name: ' ' }, undefined), true, 'Actual source priority: blank customer name is already known incomplete');
  equal(needs({ name: 'Synthetic', contactName: '', phone: '' }), true, 'One-argument historical compatibility retained outside patched sites');
  return context;
}
function modelContext(plan, model) {
  const context = vm.createContext({ [plan.nativeString]: z.string });
  vm.runInContext(plan.factory, context, { timeout: 1000 });
  context[b.LOCAL] = vm.runInContext(b.FACTORY + '()', context);
  context[model.context] = { ...GOOD };
  context[model.scope] = { ready: true, scope: { actorUserId: 303, enterpriseId: 202 }, identityKey: 'synthetic-scope' };
  const record = { id: 101, enterpriseId: 202, name: 'Synthetic customer', contactName: '', phone: '' };
  if (model.type === 'list') {
    context[model.row] = record;
    context[model.query] = { ...GOOD, data: { items: [syntheticSummary(101)] } };
    context[model.list] = { ...GOOD, data: { items: [record] } };
    context[model.input] = { customerIds: [101], expectedActorUserId: 303, expectedEnterpriseId: 202 };
    const optionsAst = b.parse('(' + model.queryOptions + ')');
    const ts = require('typescript');
    for (const access of b.nodes(optionsAst, node => ts.isPropertyAccessExpression(node)
      && node.name.text === 'length' && ts.isIdentifier(node.expression)))
      if (!(access.expression.text in context)) context[access.expression.text] = [101];
    let previousDeps, previousResult;
    const memo = (callback, deps) => {
      if (!previousDeps || previousDeps.length !== deps.length || deps.some((v, i) => !Object.is(v, previousDeps[i]))) {
        previousDeps = deps; previousResult = callback();
      }
      return previousResult;
    };
    const parts = model.useMemo.split('.');
    if (parts.length === 1) context[parts[0]] = memo;
    else { equal(parts.length, 2, 'Known existing memo ABI'); context[parts[0]] = { [parts[1]]: memo }; }
  } else {
    context[model.record] = record;
    context[model.id] = 101;
    context[model.get] = { ...GOOD, data: { customer: record } };
    const enabledAst = b.parse(model.getEnabled);
    for (const identifier of b.nodes(enabledAst, node => require('typescript').isIdentifier(node)))
      if (!(identifier.text in context)) context[identifier.text] = true;
    context[model.queryName] = { ...GOOD, data: { items: [syntheticSummary(101)] } };
    context[model.rpc] = { customer: { contactsSummary: { useQuery(input, options) {
      context.__capturedQuery = { input, options }; return context[model.queryName];
    } } } };
  }
  return context;
}
function listState(model, context) {
  context[model.readyName] = evaluate(model.readyExpression, context);
  context[model.map] = evaluate(model.mapExpression, context);
  return evaluate(model.condition, context);
}
function detailState(model, context) {
  context[model.inputName] = evaluate(model.inputExpression, context);
  evaluate(model.queryExpression, context);
  context[model.summaryName] = evaluate(model.summaryExpression, context);
  return evaluate(model.condition, context);
}
function runtimeTests(plan) {
  for (const model of plan.models) {
    const run = model.type === 'list' ? listState : detailState;
    const query = model.type === 'list' ? model.query : model.queryName;
    const record = model.type === 'list' ? model.row : model.record;
    const context = modelContext(plan, model);
    const label = model.type + ' ' + model.owner;
    equal(run(model, context), false, label + ': WeChat-only complete, no legacy phone requirement');
    for (const [type, value] of [['email', 'synthetic@example.invalid'], ['qq', 'synthetic-qq'],
      ['other', 'synthetic-channel'], ['mobile', '15500000000'], ['landline', '+1 (202) 555-0100']]) {
      context[query] = { ...GOOD, data: { items: [syntheticSummary(101, type, value)] } };
      equal(run(model, context), false, label + ': accepted ' + type);
    }
    context[query] = { ...GOOD, data: { items: [{ customerId: 101, primaryContact: null }] } };
    equal(run(model, context), true, label + ': verified missing primary is incomplete');
    // Every state is tested with retained old incomplete data. It must not leak a badge.
    for (const [flag, value] of [['isError', true], ['isPending', true], ['isFetching', true],
      ['isPlaceholderData', true], ['isFetchedAfterMount', false], ['isFetchedAfterMount', undefined],
      ['isSuccess', false], ['isSuccess', undefined]]) {
      context[query] = { ...GOOD, [flag]: value, data: { items: [{ customerId: 101, primaryContact: null }] } };
      equal(run(model, context), false, label + ': retained incomplete data hidden for ' + flag + '=' + value);
      context[record].name = '';
      equal(run(model, context), true, label + ': actual source missing-name priority is known incomplete, not contact unknown');
      context[record].name = 'Synthetic customer';
    }
    context[query] = { ...GOOD, data: { items: [] } };
    equal(run(model, context), false, label + ': missing summary unknown');
    context[query] = { ...GOOD, data: { items: [{ customerId: 999, primaryContact: null }] } };
    equal(run(model, context), false, label + ': foreign customer rejected');
    context[query] = { ...GOOD, data: { items: [{ customerId: 101, primaryContact: null }, { customerId: 101, primaryContact: null }] } };
    equal(run(model, context), false, label + ': duplicate customer rows rejected');
    context[query] = { ...GOOD, data: { items: [{ customerId: 101, primaryContact: null }] } };
    context[model.scope].ready = false;
    equal(run(model, context), false, label + ': unresolved scope unknown');
    context[model.scope].ready = true;
    context[model.scope].scope.enterpriseId = 888;
    equal(run(model, context), false, label + ': old enterprise data unknown');
    context[model.scope].scope.enterpriseId = 202;
    context[model.context].isError = true;
    equal(run(model, context), false, label + ': refused context unknown');
    context[model.context].isError = false;
    context[model.context].isPlaceholderData = true;
    equal(run(model, context), false, label + ': placeholder context unknown');
    context[model.context].isPlaceholderData = false;
    if (model.type === 'list') {
      context[model.list].isError = true;
      equal(run(model, context), false, label + ': refused list unknown');
      context[model.list].isError = false;
      context[model.input].expectedActorUserId = 999;
      equal(run(model, context), false, label + ': foreign actor input unknown');
      context[model.input].expectedActorUserId = 303;
      context[model.input].customerIds = [999];
      equal(run(model, context), false, label + ': previous page summaries unknown');
      context[model.input].customerIds = [101];
      equal(run(model, context), true, label + ': verified data recovers');
      // data reference is intentionally unchanged: memo must depend on ready flag, not just data.
      context[query].isFetching = true;
      equal(run(model, context), false, label + ': memo drops retained map on refetch');
      context[query].isFetching = false;
      equal(run(model, context), true, label + ': memo restores verified map after refetch');
      const options = evaluate(model.queryOptions, context);
      equal(options.refetchOnMount, 'always', label + ': native query always refetches on mount');
      equal(options.placeholderData, undefined, label + ': no placeholder data');
      equal(options.staleTime, 0, label + ': not stale-cache verified');
      equal(options.retry, false, label + ': refusal not retried');
    } else {
      for (const target of [model.context, model.get]) {
        for (const [flag, value] of [['isPlaceholderData', true], ['isError', true]]) {
          const original = context[target][flag]; context[target][flag] = value;
          equal(run(model, context), false, label + ': current detail/context guard ' + target + '.' + flag);
          equal(context.__capturedQuery.options.enabled, false, label + ': summary hook stays disabled before current detail/context verified');
          context[target][flag] = original;
        }
      }
      equal(run(model, context), true, label + ': verified current detail incomplete');
      const captured = context.__capturedQuery;
      equal(captured.options.refetchOnMount, 'always', label + ': always refetch');
      equal(captured.options.placeholderData, undefined, label + ': no placeholder');
      equal(captured.input.customerIds.length, 1, label + ': exactly current ID');
      equal(captured.input.customerIds[0], 101, label + ': bound current ID');
      equal(captured.input.expectedEnterpriseId, 202, label + ': expected enterprise');
      equal(captured.input.expectedActorUserId, 303, label + ': expected actor');
      context[model.id] = NaN;
      equal(run(model, context), false, label + ': invalid ID unknown');
      equal(context.__capturedQuery.options.enabled, false, label + ': invalid ID cannot fetch');
      equal(context.__capturedQuery.input.customerIds.length, 0, label + ': no invalid sentinel customer ID');
      context[model.id] = 101;
      context[record] = undefined;
      context[model.inputName] = evaluate(model.inputExpression, context);
      evaluate(model.queryExpression, context);
      equal(evaluate(model.summaryExpression, context), undefined, label + ': absent customer summary unknown');
      equal(context.__capturedQuery.options.enabled, false, label + ': absent customer cannot fetch');
    }
  }
}
function structuralTests(base, plans, html) {
  deep(plans.map(p => [p.counts.badges, p.counts.details]), [[1, 2], [1, 3]], 'All 2 list and 5 detail AST locations covered');
  for (const plan of plans) {
    proveBytes(plan.before, plan.after, plan);
    deep(b.moduleTable(plan.after), b.moduleTable(plan.before), 'Imports/exports/dynamic imports byte-identical');
    equal(plan.counts.newSummaryHooks - plan.counts.oldSummaryHooks, plan.counts.details, 'One new summary hook per detail');
    ok(plan.newURL.includes(b.sha(plan.after).slice(0, 16)), 'Each new asset name is content-addressed');
    ok(plan.oldURL !== plan.newURL, 'Old asset never overwritten');
    runtimeTests(plan);
  }
  proveBytes(base.html, html.after, html);
  const old = b.importMap(base.html), next = b.importMap(html.after);
  equal(base.html.slice(0, old.start), html.after.slice(0, next.start), 'HTML prefix byte-identical');
  equal(base.html.slice(old.start + old.text.length), html.after.slice(next.start + next.text.length), 'HTML suffix byte-identical');
  deep(Object.keys(next.map.imports), Object.keys(old.map.imports), 'All existing import keys retained without new aliases');
  ok(html.dependencyChecks.length > 0, 'Dependency resolution inspected');
  for (const check of html.dependencyChecks) equal(b.resolve(check.specifier, check.to, next.map), check.after, 'Effective dependency proof rechecked');
  // Deliberate mutation proves interval checks fail closed.
  const first = plans[0];
  assertions++;
  assert.throws(() => b.applyEdits(first.before, [{ ...first.edits[0], before: 'wrong old bytes' }], 'bad-old'), /Old bytes mismatch/);
  assertions++;
  const nonempty = first.edits.find(edit => edit.end > edit.start);
  assert.throws(() => b.applyEdits(first.before, [{ ...nonempty }, { ...nonempty }], 'overlap'), /Overlapping/);
}
function candidateTests(candidate, source, base, plans, html) {
  assert(candidate === b.OUT || candidate.startsWith('/home/ubuntu/diagnosis/completion-candidate-'), 'Private candidate directory required');
  const manifest = JSON.parse(b.read(path.join(candidate, 'manifest.json')));
  equal(manifest.status, 'BUILT_NOT_DEPLOYED', 'Candidate is not a deployment');
  equal(manifest.baselineHTMLSha256, b.sha(base.html), 'Candidate uses real baseline');
  deep(manifest.source.guards, source.guards, 'Actual source hashes unchanged since build');
  const relocations = Object.fromEntries(plans.map(p => [p.oldURL, p.newURL]));
  deep(manifest.relocations, relocations, 'Deterministically regenerated active relocations');
  equal(b.read(path.join(candidate, 'candidate/index.html')), html.after, 'Candidate HTML equals independently regenerated HTML');
  equal(b.read(path.join(candidate, 'baseline/index.html')), base.html, 'Exact baseline HTML packaged for CAS');
  deep(JSON.parse(b.read(path.join(candidate, 'candidate/active-workbenches.json'))), Object.values(relocations), 'Private active list');
  const files = manifest.files;
  for (const file of files) {
    assert(!file.relative.startsWith('/') && !file.relative.split('/').includes('..'), 'Safe manifest path');
    const bytes = fs.readFileSync(path.join(candidate, 'candidate', file.relative));
    equal(b.sha(bytes), file.sha256, 'Written artifact digest');
    equal(bytes.length, file.bytes, 'Written artifact byte count');
  }
  for (const plan of plans) {
    const asset = b.read(candidate + '/candidate' + plan.newURL);
    equal(asset, plan.after, 'Candidate full bundle equals regenerated source-bound interval edit');
    const proofPath = files.find(f => f.oldURL === plan.oldURL).proof;
    const proof = JSON.parse(b.read(path.join(candidate, proofPath)));
    proveBytes(plan.before, asset, proof);
    deep(proof.models, plan.models, 'Model evidence corresponds to actual generated patches');
    ok(!fs.existsSync(candidate + '/candidate' + plan.oldURL), 'Old active file not copied or overwritten');
  }
  const htmlProof = JSON.parse(b.read(path.join(candidate, 'proof/html.json')));
  proveBytes(base.html, html.after, htmlProof);
  ok((fs.statSync(candidate).mode & 0o077) === 0, 'Private output directory permissions');
  for (const name of ['candidate/index.html', 'manifest.json', 'candidate/active-workbenches.json', ...plans.map(p => 'candidate/' + p.newURL.slice(1))])
    ok((fs.statSync(path.join(candidate, name)).mode & 0o077) === 0, 'Private file permissions');
  const release = JSON.parse(b.read(path.join(candidate, 'release-manifest.json')));
  equal(release.ownerTask, 'WJQ7iBxDiifmPZ8w6QPWZp', 'Release owner');
  equal(release.scope, 'static-customer-completion-only', 'Release exact scope');
  equal(release.beforeHtmlSha256, b.sha(base.html), 'Release baseline HTML pin');
  equal(release.afterHtmlSha256, b.sha(html.after), 'Release candidate HTML pin');
  deep([release.apiWrites, release.databaseWrites, release.processReloads], [0, 0, 0], 'No backend writes/reloads');
  deep(release.assets, files.filter(f => f.oldURL).map(f => ({ relative: f.relative, sha256: f.sha256 })), 'Release assets');
  deep(release.baselineAssets, base.records.map(r => ({ relative: r.oldURL.slice(1), sha256: r.sha256 })), 'Release baseline pins');
  ok(Array.isArray(release.protectedApis), 'Protected API array is supplied for owner to fill before release');
}
function main(argv) {
  let candidate, planOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan') planOnly = true;
    else if (argv[i] === '--candidate') candidate = path.resolve(argv[++i]);
    else throw Error('Unknown argument: ' + argv[i]);
  }
  assert(!(candidate && planOnly), 'Choose --plan or --candidate');
  if (!planOnly && !candidate) candidate = b.OUT;
  const source = b.sourceBundle();
  helperTests(source);
  const base = b.baseline();
  const original = new Map(base.records.map(r => [r.oldURL, r.sha256]));
  const plans = base.records.map(record => {
    const plan = b.planBundle(record.before, source, record.oldURL);
    return { ...record, ...plan, newURL: '/assets/BusinessWorkbenchPage-customer-completion-' + b.sha(plan.after).slice(0, 16) + '.js' };
  });
  const relocations = Object.fromEntries(plans.map(p => [p.oldURL, p.newURL]));
  const html = b.finishHTML(base.html, relocations, plans);
  structuralTests(base, plans, html);
  if (candidate) {
    assert.equal(source.sourceErrors.length, 0, 'Source guard mismatch: ' + source.sourceErrors.join('; '));
    candidateTests(candidate, source, base, plans, html);
  }
  for (const [url, digest] of original) equal(b.sha(b.read(base.base + url)), digest, 'Original production bundle remains unchanged');
  equal(b.sha(b.read(path.join(base.base, 'index.html'))), b.EXPECTED_HTML, 'Original production HTML remains unchanged');
  console.log(JSON.stringify({ status: source.sourceErrors.length ? 'SOURCE_BLOCKED' : 'PASS',
    mode: planOnly ? 'in-memory plan (no candidate written)' : 'private candidate acceptance', assertions,
    listCallbacks: 2, detailWarnings: 5, dependencyChecks: html.dependencyChecks.length,
    scopeClones: html.clones.length, sourceErrors: source.sourceErrors,
    caveat: 'Offline structural/synthetic tests only; no live API, browser, deployment or real customer data access.' }, null, 2));
  if (source.sourceErrors.length) process.exitCode = 2;
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error('FAIL: ' + error.stack); process.exitCode = 1; }
}
