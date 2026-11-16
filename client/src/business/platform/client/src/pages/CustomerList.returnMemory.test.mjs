// node --test client/src/business/platform/client/src/pages/CustomerList.returnMemory.test.mjs
// Actual CustomerList, usePageMemory and pageMemory; only application/UI/network dependencies are synthetic.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import React, { act } from 'react';
import { build } from 'esbuild';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const deps = createRequire('/home/ubuntu/work/team-scope-identity-flatnav-20261116/upload/deps/package.json');
const { JSDOM } = deps('jsdom');
const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, 'CustomerList.tsx');
const source = readFileSync(sourcePath, 'utf8');
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const modules = new Map();
for (const node of ast.statements) {
  if (!ts.isImportDeclaration(node)) continue;
  const clause = node.importClause, exports = [];
  if (clause?.name) exports.push(`export default globalThis.__customerReturnBindings[${JSON.stringify(clause.name.text)}];`);
  if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const binding of clause.namedBindings.elements) {
    if (clause.isTypeOnly || binding.isTypeOnly) continue;
    exports.push(`export const ${binding.propertyName?.text ?? binding.name.text} = globalThis.__customerReturnBindings[${JSON.stringify(binding.name.text)}];`);
  }
  modules.set(node.moduleSpecifier.text, exports.join('\n'));
}
const realSources = new Set([sourcePath, resolve(here, '../hooks/usePageMemory.ts'), resolve(here, '../lib/pageMemory.ts')]);
const compiled = await build({
  stdin: { contents: 'export { default as CustomerList } from "./CustomerList.tsx"; export * as memory from "../lib/pageMemory.ts";', sourcefile: resolve(here, 'return-memory-entry.ts'), resolveDir: here, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  plugins: [{ name: 'finite-offline-customer-memory', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'react' || args.path.startsWith('react/')) return { path: args.path, external: true };
      const actual = resolve(args.resolveDir || here, args.path);
      const file = realSources.has(actual) ? actual : ['.ts', '.tsx'].map(ext => actual + ext).find(path => realSources.has(path));
      if (file) return { path: file, namespace: 'actual-source' };
      if (args.path === './usePageIdentity') return { path: args.path, namespace: 'identity-mock' };
      assert.ok(modules.has(args.path), `unexpected runtime dependency ${args.path}`);
      return { path: args.path, namespace: 'customer-mock' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'actual-source' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts', resolveDir: dirname(args.path) }));
    builder.onLoad({ filter: /.*/, namespace: 'identity-mock' }, () => ({ contents: 'export const usePageIdentity = () => globalThis.__customerReturnBindings.identity();', loader: 'js' }));
    builder.onLoad({ filter: /.*/, namespace: 'customer-mock' }, args => ({ contents: modules.get(args.path), loader: 'js' }));
  } }],
});
const h = React.createElement, META = '__d51PageMemory', PREFIX = '51dianzi:page-memory:v1:';
let runtime, dom, host, root, CustomerList, memory, viewport, frames, frameId;
const defaults = { keyword: '', grade: '', stage: '', scope: 'mine', assignedUserId: '', due: 'all', archived: false, starredOnly: false, updatedFrom: '', updatedTo: '' };
const teamOne = { teamId: 173, name: 'SYNTHETIC TEAM ONE', members: [{ userId: 17, name: 'SYNTHETIC OWNER 17' }, { userId: 18, name: 'SYNTHETIC OWNER 18' }] };
const teamTwo = { teamId: 284, name: 'SYNTHETIC TEAM TWO', members: [{ userId: 19, name: 'SYNTHETIC OWNER 19' }] };
const applied = { ...defaults, keyword: 'applied UI', grade: 'B', stage: 'quoted', scope: 'team', teamId: '173', assignedUserId: '18', due: 'overdue', archived: true, starredOnly: true, updatedFrom: '2026-09-09', updatedTo: '2026-09-14' };
const draft = { ...applied, keyword: 'unapplied UI', grade: 'A', updatedFrom: '2026-10-01', updatedTo: '2026-10-31' };
function currentContext() { return { actorUserId: runtime.actorId, canReadEnterprise: runtime.canReadEnterprise, canReadTeam: runtime.canReadTeam, teams: runtime.teams, defaultTeamId: 173, members: [...teamOne.members, ...teamTwo.members] }; }
function element(tag) { return ({ children, className, title, role, ...props }) => h(tag, { className, title, role, ...Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith('aria-') || key.startsWith('data-') || ['ref', 'onClick', 'tabIndex'].includes(key))) }, children); }
function Select({ children, value, onValueChange }) {
  const items = React.Children.toArray(children), trigger = items.find(child => child.type === bindings.SelectTrigger), content = items.find(child => child.type === bindings.SelectContent);
  return h('select', { value, 'aria-label': trigger?.props['aria-label'], onChange: event => onValueChange(event.target.value) }, content?.props.children);
}
const bindings = {
  identity: () => runtime.ready ? runtime.identity : null,
  useLocation: () => [window.location.pathname, target => { history.pushState({}, '', '/workbench' + target); }], useSearch: () => '',
  useCustomerCreateDraftIdentity: () => ({ key: 'synthetic-create-draft' }), useCustomerCreateDraft: () => ({ completion: null, consumeCompletion: () => {} }),
  useCustomerStars: () => ({ ready: runtime.starsReady, failed: false, targets: [], observeRows: () => {}, canSet: () => false, blocked: false, busy: false, toggle: () => {}, refresh: () => {} }),
  toast: { info: () => {}, warning: () => {} }, CUSTOMER_GRADES: ['A', 'B', 'C'], CUSTOMER_STAGES: ['following', 'quoted'], CUSTOMER_STAGE_LABELS: { following: '跟进中', quoted: '报价中' },
  customerNeedsCompletion: () => false, EMPTY_CUSTOMER_FORM: {}, errorMessage: error => error?.message || 'error',
  PlatformLayout: ({ children }) => h(React.Fragment, null, children), AdminPage: element('main'), AdminDataPanel: element('section'),
  CompactListToolbar: ({ children, extra, actions }) => h('div', {}, actions, children, extra),
  CustomerCreateForm: props => { runtime.createFormProps = props; return null; }, CustomerContactsSummary: () => null, CustomerSupplyCell: () => null, CustomerSupplyUploadDialog: () => null, CustomerDemandDialog: () => null,
  CustomerSupplyAction: ({ children, onClick }) => h('button', { onClick }, children),
  useCustomerContactScope: () => ({ scope: runtime.ready ? { actorUserId: runtime.actorId, enterpriseId: runtime.enterpriseId, canManageAll: false } : null, ready: runtime.ready, identityKey: `${runtime.identity}:${runtime.actorId}:${runtime.enterpriseId}:${runtime.ready}` }),
  withCustomerContactScope: (scope, input) => ({ ...input, expectedActorUserId: scope.actorUserId, expectedEnterpriseId: scope.enterpriseId }), formatContactMethod: method => method.value,
  useCustomerSupplyAuthority: () => ({ identity: null, canRead: false, canWrite: false, failed: false }), supplyLocation: () => '', customerWorkbenchLocation: id => `/customers/${id}`,
  businessIndustryCodeSchema: { safeParse: () => ({ success: true }) }, getBusinessIndustryLabel: () => '电子元器件',
  Button: ({ children, variant, size, ...props }) => h('button', props, children), Input: props => h('input', props), Select, SelectTrigger: () => null, SelectContent: () => null, SelectValue: () => null, SelectItem: ({ value, children }) => h('option', { value }, children),
  Table: ({ children, containerClassName, ...props }) => h('table', props, children), TableBody: element('tbody'), TableCell: element('td'), TableHead: element('th'), TableHeader: element('thead'), TableRow: element('tr'),
};
for (const icon of ['ChevronDown', 'ChevronUp', 'Loader2', 'Plus', 'Star']) bindings[icon] = () => h('svg');
bindings.trpc = { useUtils: () => runtime.utils, customer: {
  context: { useQuery: () => ({ data: currentContext(), isPending: runtime.contextPending, isLoading: runtime.contextPending, isFetching: runtime.contextFetching, isError: runtime.contextError, isFetchedAfterMount: runtime.contextFetched, isPlaceholderData: runtime.contextPlaceholder, refetch: async () => ({ data: currentContext(), isError: runtime.contextError }) }) },
  list: { useQuery: (input, options) => {
    runtime.listInputs.push(input); runtime.listOptions.push(options); if (options.enabled) runtime.enabledInputs.push(input);
    return { data: { items: runtime.rows, total: runtime.total }, isPending: runtime.listPending, isLoading: runtime.listPending, isFetching: runtime.listFetching, isError: runtime.listError, isFetchedAfterMount: runtime.listFetched, isPlaceholderData: runtime.listPlaceholder, dataUpdatedAt: runtime.revision, error: new Error('synthetic list error'), refetch: () => { runtime.refetchCalls++; } };
  } }, contactsSummary: { useQuery: (_input, options) => { if (options.enabled) runtime.contactsCalls++; return { data: { items: [] } }; } },
} };
beforeEach(async () => {
  runtime = { identity: 'synthetic:staff:17:admin:101:enterprise:31:merchant:30061:binding:A', actorId: 17, enterpriseId: 31, ready: true, canReadTeam: true, canReadEnterprise: true, teams: [teamOne, teamTwo], starsReady: true,
    contextPending: false, contextFetching: false, contextError: false, contextFetched: true, contextPlaceholder: false, listPending: false, listFetching: false, listError: false, listFetched: true, listPlaceholder: false, revision: 1,
    listInputs: [], listOptions: [], enabledInputs: [], contactsCalls: 0, refetchCalls: 0, total: 80, rows: [{ id: 801, enterpriseId: 31, name: 'PRIVATE SYNTHETIC CUSTOMER', assignedUserId: 18, assignedName: 'PRIVATE SYNTHETIC OWNER', starUserId: 18, grade: 'B', stage: 'quoted', industryCode: 'electronic_components', version: 1, archivedAt: null }], fetchCalls: [] };
  runtime.utils = { customer: { list: { invalidate: async () => {}, fetch: async input => { runtime.fetchCalls.push(input); return { items: [] }; } }, contactsSummary: { reset: async () => {} }, contactsList: { reset: async () => {} } } };
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://synthetic.invalid/workbench/customers?merchantId=30061' });
  for (const key of ['window', 'document', 'history', 'History', 'sessionStorage', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'KeyboardEvent']) globalThis[key] = dom.window[key];
  viewport = { x: 0, y: 0 }; frames = new Map(); frameId = 0;
  globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; }; globalThis.cancelAnimationFrame = id => frames.delete(id);
  Object.defineProperties(window, { scrollX: { get: () => viewport.x }, scrollY: { get: () => viewport.y }, scrollTo: { value: options => { viewport = { x: options.left ?? viewport.x, y: options.top ?? viewport.y }; } } });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true, __customerReturnBindings: bindings, fetch: () => { throw new Error('OFFLINE_NETWORK_FORBIDDEN'); } });
  const module = { exports: {} }; new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
  ({ CustomerList, memory } = module.exports); memory.setPageMemoryScope(runtime.identity);
  const { createRoot } = await import('react-dom/client'); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); memory.setPageMemoryScope(null); frames.clear(); dom.window.close(); delete globalThis.__customerReturnBindings; });
async function render() { await act(async () => root.render(h(CustomerList))); }
async function unmountPage() { await act(async () => root.render(h('p', {}, 'synthetic detail'))); }
function control(label) { const item = host.querySelector(`[aria-label="${label}"]`); assert.ok(item, `missing control ${label}`); return item; }
function button(label) { const item = [...host.querySelectorAll('button')].find(item => item.textContent.trim() === label); assert.ok(item, `missing button ${label}`); return item; }
async function click(label) { await act(async () => button(label).click()); }
async function input(label, value) { await act(async () => { const node = control(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function choose(label, value) { await act(async () => { const node = control(label); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }); }
function drain(count = 4) { for (let index = 0; index < count; index++) { const queue = [...frames.values()]; frames.clear(); queue.forEach(fn => fn(index * 16)); } }
function enabled() { return runtime.listOptions.at(-1).enabled; }
function lastInput() { return runtime.listInputs.at(-1); }
function id() { return history.state[META].id; }
function stored() { return JSON.parse(sessionStorage.getItem(PREFIX + runtime.identity)); }
function remember(a = applied, d = draft, page = 4) { memory.writePageSlot('appliedFilters', a); memory.writePageSlot('draftFilters', d); memory.writePageSlot('page', page); memory.writePageSlot('moreFiltersOpen', true); }
function loadSnapshot(a, d = a, flag = false) {
  memory.setPageMemoryScope(null); runtime.identity += '-loaded';
  const entry = { id: 'loaded-entry', scope: runtime.identity, url: '/workbench/customers?merchantId=30061', from: null, at: Date.now(), state: { appliedFilters: a, draftFilters: d, page: 4, moreFiltersOpen: true }, ...(flag ? { customerFilterConfirmationRequired: true } : {}) };
  sessionStorage.setItem(PREFIX + runtime.identity, JSON.stringify({ entries: { [entry.id]: entry }, latest: { [entry.url]: entry.id } }));
  History.prototype.replaceState.call(history, { [META]: { id: entry.id, scope: runtime.identity } }, '', entry.url); memory.setPageMemoryScope(runtime.identity);
}
function assertPaused() { assert.equal(enabled(), false); assert.equal(host.querySelector('table'), null); assert.equal(runtime.enabledInputs.length, 0); }
function pop() { return new Promise(resolve => window.addEventListener('popstate', resolve, { once: true })); }

test('finite runtime compiles only actual list, original hook and original memory, with the two explicit new source APIs', () => {
  assert.equal(realSources.size, 3); assert.ok(source.includes('customerFiltersRequireConfirmation')); assert.ok(source.includes('confirmCustomerFilters'));
  assert.deepEqual(ast.statements.filter(ts.isFunctionDeclaration).map(node => node.name.text), ['updatedDateError', 'CustomerList', 'gradeClass', 'ErrorPanel']);
});
test('complete modern team snapshot restores exact confirmed query, independent drafts, page four and more-open', async () => {
  remember(); await render(); assert.equal(enabled(), true);
  assert.deepEqual(lastInput(), { keyword: 'applied UI', grade: 'B', stage: 'quoted', updatedFrom: '2026-09-09', updatedTo: '2026-09-14', scope: 'team', teamId: 173, assignedUserId: 18, starMode: 'assignee', expectedEnterpriseId: 31, expectedActorUserId: 17, archived: true, due: 'overdue', starredOnly: true, page: 4, pageSize: 20 });
  assert.equal(control('搜索客户名称、联系人或电话').value, 'unapplied UI'); assert.equal(control('更新时间开始日期').value, '2026-10-01'); assert.equal(memory.readPageSlot('page', 1), 4);
  assert.ok(runtime.enabledInputs.every(input => input.updatedFrom === '2026-09-09' && input.teamId === 173)); assert.equal(memory.customerFiltersRequireConfirmation(), false);
});
for (const scope of ['mine', 'all']) test(`optional teamId absent and present never defaults whole ${scope} filter object`, async () => {
  runtime.canReadTeam = false; const filters = { ...applied, scope, assignedUserId: scope === 'mine' ? '' : '18' }; delete filters.teamId;
  remember(filters, { ...filters, keyword: 'independent draft' }); await render(); assert.equal(enabled(), true); assert.equal(lastInput().scope, scope); assert.equal(lastInput().updatedTo, '2026-09-14'); assert.equal(lastInput().page, 4);
  await unmountPage(); remember({ ...filters, teamId: '' }); await render(); assert.equal(enabled(), true); assert.equal(lastInput().scope, scope); assert.equal(lastInput().keyword, 'applied UI');
});
for (const missing of ['both', 'from', 'to']) test(`old or modern raw snapshot missing ${missing} date stays paused until explicit confirmation`, async () => {
  const filters = { ...applied }; if (missing !== 'to') delete filters.updatedFrom; if (missing !== 'from') delete filters.updatedTo;
  loadSnapshot(filters, { ...filters, keyword: 'unapplied legacy draft' }); await render(); assertPaused(); assert.match(host.textContent, /旧版本丢失的日期无法恢复/); assert.equal(memory.readPageSlot('page', 1), 4);
  await input('搜索客户名称、联系人或电话', 'edited but not confirmed'); await choose('客户范围', 'all'); await act(async () => control('仅看重点客户').click()); assertPaused();
  await click('录入客户'); await act(async () => runtime.createFormProps.onSaved({ id: 900, mode: 'close' })); assert.equal(runtime.fetchCalls.length, 0);
  assert.equal(stored().entries[id()].customerFilterConfirmationRequired, true);
  await unmountPage(); await render(); assertPaused();
  await input('更新时间开始日期', '2026-09-09'); await input('更新时间结束日期', '2026-09-14'); assertPaused();
  await click('确定'); assert.equal(enabled(), true); assert.equal(memory.customerFiltersRequireConfirmation(), false); assert.equal(lastInput().updatedFrom, '2026-09-09'); assert.equal(lastInput().updatedTo, '2026-09-14'); assert.equal(lastInput().page, 1);
});
test('fresh writes with optional dates omitted are explicitly empty, whereas partial modern stored dates are not inferred', async () => {
  const filters = { ...applied }; delete filters.updatedFrom; delete filters.updatedTo;
  remember(filters, filters); assert.equal(stored().entries[id()].state.appliedFilters.updatedFrom, ''); assert.equal(memory.customerFiltersRequireConfirmation(), false);
  await render(); assert.equal(enabled(), true); assert.ok(!('updatedFrom' in lastInput()));
});
test('reset is an explicit legacy acknowledgement only for a still-readable range', async () => {
  const filters = { ...applied }; delete filters.updatedFrom; delete filters.updatedTo; loadSnapshot(filters); await render(); assertPaused();
  await click('重置'); assert.equal(enabled(), true); assert.equal(lastInput().teamId, 173); assert.equal(lastInput().scope, 'team'); assert.equal(lastInput().starredOnly, false); assert.equal(lastInput().page, 1); assert.ok(!('updatedFrom' in lastInput()));
});
for (const invalid of [{ scope: 'team', teamId: undefined }, { scope: 'team', teamId: '999' }, { scope: 'all', assignedUserId: '999' }, { scope: 'mine', assignedUserId: '999' }, { updatedFrom: '2026-02-29' }, { updatedFrom: '2026-09-15', updatedTo: '2026-09-14' }]) test(`invalid team/owner/date continues pausing without broadening: ${JSON.stringify(invalid)}`, async () => {
  runtime.canReadTeam = invalid.scope !== 'mine'; const filters = { ...applied, ...invalid }; if (filters.teamId === undefined) delete filters.teamId;
  remember(filters, filters); await render(); assertPaused(); assert.equal(lastInput().scope, filters.scope); assert.equal(memory.readPageSlot('page', 1), 4);
  await click('搜索'); assertPaused(); assert.equal(runtime.contactsCalls, 0);
});
test('fresh authoritative context is required before first enabled query, even with retained success cache', async () => {
  remember(); runtime.contextFetched = false; runtime.contextFetching = false; await render(); assertPaused();
  runtime.contextFetched = true; runtime.contextPlaceholder = true; await render(); assertPaused();
  runtime.contextPlaceholder = false; await render(); assert.equal(enabled(), true); assert.equal(lastInput().teamId, 173);
});
test('new inputs without Apply keep the exact old query through pagination and star intersections', async () => {
  remember(); await render(); const initial = lastInput(); await input('搜索客户名称、联系人或电话', 'new draft'); await input('更新时间开始日期', '2026-11-01'); await input('更新时间结束日期', '2026-11-16');
  assert.equal(lastInput(), initial); await act(async () => control('仅看重点客户').click()); assert.equal(lastInput().keyword, 'applied UI'); assert.equal(lastInput().updatedFrom, '2026-09-09'); assert.equal(lastInput().starredOnly, false);
  await click('搜索'); assert.equal(lastInput().keyword, 'new draft'); assert.equal(lastInput().updatedFrom, '2026-11-01'); assert.equal(lastInput().updatedTo, '2026-11-16');
});
test('invalid page clamps only after fresh current result, not pending/error/placeholder/retained total', async () => {
  remember(); runtime.total = 20; runtime.listFetched = false; runtime.listFetching = true; await render(); assert.equal(memory.readPageSlot('page', 1), 4);
  runtime.listFetching = false; await render(); assert.equal(memory.readPageSlot('page', 1), 4);
  runtime.listFetched = true; runtime.listPlaceholder = true; await render(); assert.equal(memory.readPageSlot('page', 1), 4);
  runtime.listPlaceholder = false; runtime.listPending = true; await render(); assert.equal(memory.readPageSlot('page', 1), 4);
  runtime.listPending = false; runtime.listError = true; await render(); assert.equal(memory.readPageSlot('page', 1), 4);
  runtime.listError = false; await render(); assert.equal(memory.readPageSlot('page', 1), 1);
});
for (const method of ['source-button', 'browser-back', 'refresh-replace']) test(`list → detail → ${method} restores the same source query and both horizontal/row positions`, async () => {
  remember(); await render(); const sourceId = id(); const scroller = host.querySelector('[data-page-memory-scroll]'), row = host.querySelector('[data-page-memory-row]'); assert.ok(row);
  Object.defineProperty(row, 'getBoundingClientRect', { value: () => ({ top: 820 - viewport.y }) }); viewport = { x: 18, y: 700 }; scroller.scrollLeft = 432; scroller.scrollTop = 12; await act(async () => row.querySelector('button').click());
  if (!window.location.pathname.includes('/801')) history.pushState({}, '', '/workbench/customers/801?merchantId=30061'); await unmountPage(); viewport = { x: 0, y: 0 };
  if (method === 'refresh-replace') History.prototype.replaceState.call(history, { [META]: { id: id(), scope: runtime.identity, previous: 'not-proven-adjacent' } }, '', window.location.href);
  if (method === 'refresh-replace') memory.returnToPageSource((target, options) => { assert.deepEqual(options, { replace: true }); history.replaceState({}, '', '/workbench' + target); }, '/customers');
  else { const done = pop(); if (method === 'browser-back') history.back(); else memory.returnToPageSource(() => assert.fail('proven source must back'), '/customers'); await done; assert.equal(id(), sourceId); }
  runtime.listFetched = false; runtime.listFetching = true; await render(); await act(async () => drain()); assert.equal(viewport.y, 0); assert.equal(stored().entries[id()].scroll.y, 700);
  runtime.listFetched = true; runtime.listFetching = false; await render(); const restoredRow = host.querySelector('[data-page-memory-row]'); Object.defineProperty(restoredRow, 'getBoundingClientRect', { value: () => ({ top: 820 - viewport.y }) }); await act(async () => drain());
  assert.deepEqual(viewport, { x: 18, y: 700 }); assert.equal(host.querySelector('[data-page-memory-scroll]').scrollLeft, 432); assert.equal(lastInput().page, 4); assert.equal(lastInput().updatedTo, '2026-09-14'); assert.equal(control('更新时间开始日期').value, '2026-10-01');
  assert.ok(!sessionStorage.getItem(PREFIX + runtime.identity).includes('PRIVATE'));
});
test('repeated same-path history entries retain distinct applied/draft snapshots rather than the latest visit', async () => {
  remember(); await render(); const originalId = id(); await unmountPage(); history.pushState({}, '', '/workbench/customers?merchantId=30061');
  remember({ ...applied, keyword: 'second visit', updatedFrom: '2026-11-01' }, { ...draft, keyword: 'second draft' }, 2); await render(); const secondId = id(); assert.notEqual(secondId, originalId);
  await unmountPage(); const done = pop(); history.back(); await done; await render(); assert.equal(id(), originalId); assert.equal(lastInput().page, 4); assert.equal(lastInput().keyword, 'applied UI'); assert.equal(control('搜索客户名称、联系人或电话').value, 'unapplied UI');
});
test('identity revoke and account/enterprise/binding changes never restore another identity query', async () => {
  remember(); await render(); runtime.ready = false; await render(); assert.equal(enabled(), false); assert.equal(host.querySelector('table'), null);
  runtime.identity += '-binding-B'; runtime.enterpriseId = 32; runtime.actorId = 19; runtime.ready = true; runtime.rows = []; await render(); assert.equal(memory.readPageSlot('page', 1), 1); assert.notEqual(lastInput().keyword, 'applied UI'); assert.equal(lastInput().expectedEnterpriseId, 32);
});

test('a missing-date draft snapshot never silently replaces a complete applied date range', async () => {
  const { updatedTo: _lost, ...partialDraft } = draft; loadSnapshot(applied, partialDraft); await render(); assertPaused();
  assert.equal(lastInput().updatedFrom, '2026-09-09'); assert.equal(lastInput().updatedTo, '2026-09-14');
  await input('更新时间结束日期', '2026-10-31'); assertPaused(); await click('搜索'); assert.equal(enabled(), true); assert.equal(lastInput().updatedTo, '2026-10-31');
});
test('persisted confirmation marker cannot be cleared by mount/range/star changes even when dates were filled by automatic migration', async () => {
  loadSnapshot(applied, draft, true); await render(); assertPaused(); await choose('客户范围', 'team:284'); assertPaused();
  await unmountPage(); await render(); assertPaused(); assert.equal(stored().entries[id()].customerFilterConfirmationRequired, true);
  await click('搜索'); assert.equal(enabled(), true); assert.equal(memory.customerFiltersRequireConfirmation(), false);
});
test('reset of a lost-date snapshot cannot authorize an expired team; explicit range correction alone still cannot acknowledge dates', async () => {
  const filters = { ...applied, teamId: '999' }; delete filters.updatedFrom; delete filters.updatedTo; loadSnapshot(filters); await render(); assertPaused();
  await click('重置'); assertPaused(); await choose('客户范围', 'team:173'); assertPaused(); await click('重置'); assert.equal(enabled(), true); assert.equal(lastInput().teamId, 173);
});
test('revoked enterprise/star authority keeps the complete applied date condition and cannot consume position restore', async () => {
  remember({ ...applied, scope: 'all' }); runtime.canReadEnterprise = false; await render(); assertPaused(); assert.equal(lastInput().updatedTo, '2026-09-14');
  runtime.canReadEnterprise = true; runtime.starsReady = false; await render(); assertPaused(); runtime.starsReady = true; await render(); assert.equal(enabled(), true);
});

// Exercise the untouched actual detail return guard bodies, not a synthetic substitute or a visual Detail E2E.
const detailSource = readFileSync(resolve(here, 'CustomerDetail.tsx'), 'utf8');
const detailAst = ts.createSourceFile('CustomerDetail.tsx', detailSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const detailFunction = detailAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'CustomerDetailPage');
assert.ok(detailFunction);
const guardNames = ['runApprovedAction', 'guardAction', 'requestBack'];
const guardBodies = guardNames.map(name => {
  const declaration = detailFunction.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(detailAst) === name));
  assert.ok(declaration, `actual detail guard ${name}`); return declaration.getText(detailAst);
}).join('\n');
const guardProbeCode = ts.transpileModule(`
function GuardProbe({ config, navigate, onBlocked, onDirty }) {
  const supplyOpen = React.useRef(config.supplyOpen); supplyOpen.current = config.supplyOpen;
  const approvedShellAction = React.useRef(false);
  const moduleBusyOrDirty = config.moduleBusyOrDirty, shellBusy = config.shellBusy;
  const followSubmitting = React.useRef(config.followSubmitting); followSubmitting.current = config.followSubmitting;
  const basicDirty = config.basicDirty, followDirty = config.followDirty;
  const updateMutation = { isPending: config.updatePending }, followMutation = { isPending: config.followPending };
  const setBlockedModuleLeave = onBlocked, setPendingLeaveAction = onDirty;
  ${guardBodies}
  return React.createElement('button', { onClick: requestBack }, 'actual-requestBack-body');
}
return GuardProbe;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const GuardProbe = new Function('React', 'returnToPageSource', guardProbeCode)(React, (...args) => memory.returnToPageSource(...args));
for (const condition of ['supplyOpen', 'moduleBusyOrDirty', 'shellBusy', 'followSubmitting', 'updatePending', 'followPending', 'basicDirty', 'followDirty', 'clean']) test(`actual unchanged detail requestBack/guardAction React bodies preserve source state for ${condition}`, async () => {
  remember(); const sourceId = id(); history.pushState({}, '', '/workbench/customers/801?merchantId=30061'); const detailId = id();
  let blocked = false, dirty = false;
  const config = { [condition]: true };
  await act(async () => root.render(h(GuardProbe, { config, navigate: () => assert.fail('adjacent source must use history back'), onBlocked: value => { blocked = value; }, onDirty: () => { dirty = true; } })));
  const done = condition === 'clean' ? pop() : null; await click('actual-requestBack-body'); if (done) await done;
  assert.equal(id(), condition === 'clean' ? sourceId : detailId);
  assert.equal(blocked, ['supplyOpen', 'moduleBusyOrDirty', 'shellBusy', 'followSubmitting'].includes(condition));
  assert.equal(dirty, ['basicDirty', 'followDirty'].includes(condition));
  assert.equal(stored().entries[sourceId].state.page, 4); assert.equal(stored().entries[sourceId].state.appliedFilters.updatedFrom, '2026-09-09'); assert.equal(stored().entries[sourceId].state.appliedFilters.updatedTo, '2026-09-14');
});

test('detail refresh with a fresh JS runtime reads its same-scope sessionStorage source chain and restores the exact dated list', async () => {
  remember(); await render(); await act(async () => drain()); viewport = { x: 18, y: 700 }; const scroller = host.querySelector('[data-page-memory-scroll]'); scroller.scrollLeft = 432; memory.flushPagePosition();
  await act(async () => history.pushState({}, '', '/workbench/customers/801?merchantId=30061'));
  const savedBook = sessionStorage.getItem(PREFIX + runtime.identity), savedMeta = structuredClone(history.state), savedUrl = window.location.href;
  await act(async () => root.unmount()); dom.window.close(); frames.clear(); viewport = { x: 0, y: 0 };
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: savedUrl });
  for (const key of ['window', 'document', 'history', 'History', 'sessionStorage', 'Element', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'Event', 'MouseEvent', 'KeyboardEvent']) globalThis[key] = dom.window[key];
  Object.defineProperties(window, { scrollX: { get: () => viewport.x }, scrollY: { get: () => viewport.y }, scrollTo: { value: options => { viewport = { x: options.left ?? viewport.x, y: options.top ?? viewport.y }; } } });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
  sessionStorage.setItem(PREFIX + runtime.identity, savedBook); History.prototype.replaceState.call(history, savedMeta, '', savedUrl);
  const module = { exports: {} }; new Function('module', 'exports', 'require', compiled.outputFiles[0].text)(module, module.exports, require);
  ({ CustomerList, memory } = module.exports); memory.setPageMemoryScope(runtime.identity);
  memory.returnToPageSource((target, options) => { assert.deepEqual(options, { replace: true }); history.replaceState({}, '', '/workbench' + target); }, '/customers');
  assert.equal(window.location.pathname, '/workbench/customers'); assert.equal(memory.readPageSlot('appliedFilters', defaults).updatedTo, '2026-09-14');
  const { createRoot } = await import('react-dom/client'); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  runtime.listFetched = false; runtime.listFetching = true; await render(); await act(async () => drain()); assert.equal(viewport.y, 0);
  runtime.listFetched = true; runtime.listFetching = false; await render(); await act(async () => drain());
  assert.deepEqual(viewport, { x: 18, y: 700 }); assert.equal(host.querySelector('[data-page-memory-scroll]').scrollLeft, 432); assert.equal(lastInput().page, 4); assert.equal(lastInput().updatedFrom, '2026-09-09'); assert.equal(lastInput().updatedTo, '2026-09-14'); assert.equal(control('搜索客户名称、联系人或电话').value, 'unapplied UI');
});
