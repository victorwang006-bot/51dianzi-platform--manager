// Isolated current-task tests: node --test client/src/business/platform/client/src/pages/CustomerList.teamScope.test.mjs
// Runtime imports in the real TSX remain unchanged. Only this page is compiled;
// all application/network/UI modules are synthetic bindings, React/ReactDOM are real.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(here, "CustomerList.tsx");
const source = readFileSync(sourcePath, "utf8");
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const modules = new Map();
for (const node of ast.statements) {
  if (!ts.isImportDeclaration(node)) continue;
  const clause = node.importClause;
  const exports = [];
  if (clause?.name) exports.push(`export default globalThis.__customerListBindings[${JSON.stringify(clause.name.text)}];`);
  if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const binding of clause.namedBindings.elements) {
      if (clause.isTypeOnly || binding.isTypeOnly) continue;
      exports.push(`export const ${binding.propertyName?.text ?? binding.name.text} = globalThis.__customerListBindings[${JSON.stringify(binding.name.text)}];`);
    }
  }
  modules.set(node.moduleSpecifier.text, exports.join("\n"));
}
const compiled = await build({
  stdin: { contents: source, sourcefile: sourcePath, resolveDir: here, loader: "tsx" },
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
  plugins: [{ name: "isolated-customer-page-bindings", setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path === "react" || args.path.startsWith("react/")) return { path: args.path, external: true };
      assert.ok(modules.has(args.path), `unexpected dependency: ${args.path}`);
      return { path: args.path, namespace: "customer-page-mock" };
    });
    builder.onLoad({ filter: /.*/, namespace: "customer-page-mock" }, args => ({ contents: modules.get(args.path), loader: "js" }));
  } }],
});
const require = createRequire(import.meta.url);
const jsdomRoot = process.env.CUSTOMER_LIST_TEST_RUNTIME || "/home/ubuntu/work/team-scope-identity-flatnav-20261116/frontend-test-runtime";
let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch { ({ JSDOM } = createRequire(resolve(jsdomRoot, "package.json"))("jsdom")); }

const h = React.createElement;
let runtime, dom, host, root, CustomerList;
const baseFilters = { keyword: "", grade: "", stage: "", scope: "mine", assignedUserId: "", due: "all", archived: false, starredOnly: false };
const teamOne = { teamId: 173, name: "合成团队·北区", members: [{ userId: 17, name: "陈示例（alpha）" }, { userId: 18, name: "李示例（beta）" }] };
const teamTwo = { teamId: 284, name: "合成团队·南区", members: [{ userId: 19, name: "赵示例（gamma）" }] };
function row(id, teamId, owner, extra = {}) {
  return { id, teamId, assignedUserId: owner, assignedName: `后台负责人${owner}（alias-${owner}）`, name: `合成客户${id}`, enterpriseId: 31,
    contactName: "真实联系人 alpha 不应被映射为负责人", phone: "010-00000000", industryCode: "electronic_components", grade: "B", stage: "following",
    version: 4, archivedAt: null, starUserId: owner, isStarred: false, ...extra };
}
function currentContext() {
  return { actorUserId: runtime.actorId, canManageAll: runtime.canManageAll, canReadAll: runtime.canReadAll,
    canReadEnterprise: runtime.canReadEnterprise, canReadTeam: runtime.canReadTeam, teams: runtime.teams,
    defaultTeamId: runtime.defaultTeamId, members: runtime.members };
}
function element(tag) {
  return ({ children, className, title, role, ...props }) => h(tag, { className, title, role,
    ...Object.fromEntries(Object.entries(props).filter(([key]) => key.startsWith("aria-") || key.startsWith("data-") || ["ref", "onClick", "tabIndex"].includes(key))) }, children);
}
function Select({ children, value, onValueChange }) {
  const childArray = React.Children.toArray(children);
  const trigger = childArray.find(child => child.type === bindings.SelectTrigger);
  const content = childArray.find(child => child.type === bindings.SelectContent);
  return h("select", { value, className: trigger?.props.className, "aria-label": trigger?.props["aria-label"],
    onChange: event => onValueChange(event.target.value) }, content?.props.children);
}
const bindings = {
  usePageMemory: () => runtime.identityReady,
  useRememberedState: (key, fallback) => {
    const [value, set] = React.useState(() => key in runtime.remembered ? runtime.remembered[key] : typeof fallback === "function" ? fallback() : fallback);
    return [value, update => set(previous => {
      const next = typeof update === "function" ? update(previous) : update;
      runtime.remembered[key] = next;
      return next;
    })];
  },
  freshListOptions: (options, ready) => ({ ...options, enabled: ready && options.enabled !== false }),
  useListPositionRestore: (_query, ready) => runtime.restoreCalls.push(ready),
  returnToPageSource: () => {},
  useCustomerCreateDraftIdentity: () => ({ key: `draft:${runtime.enterpriseId}:${runtime.actorId}` }),
  useCustomerCreateDraft: () => ({ completion: null, consumeCompletion: () => {} }),
  useCustomerStars: () => ({ ready: runtime.starsReady, failed: false, targets: [], observeRows: rows => { runtime.observedRows = rows; },
    canSet: () => false, blocked: false, busy: false, toggle: () => {}, refresh: () => {} }),
  useLocation: () => ["/customers", () => {}], useSearch: () => "", toast: { info: () => {}, warning: () => {} },
  CUSTOMER_GRADES: ["A", "B", "C"], CUSTOMER_STAGES: ["following", "quoted"], CUSTOMER_STAGE_LABELS: { following: "跟进中", quoted: "报价中" },
  customerNeedsCompletion: () => false, EMPTY_CUSTOMER_FORM: {}, errorMessage: error => error?.message || "error",
  PlatformLayout: ({ children }) => h(React.Fragment, null, children), AdminPage: element("main"), AdminDataPanel: element("section"),
  CompactListToolbar: ({ children, extra, actions }) => h("div", { "data-testid": "toolbar" }, actions, h("div", {}, children), extra),
  CustomerCreateForm: props => { runtime.createFormProps = props; return null; },
  CustomerContactsSummary: props => h("span", {}, props.contactName), CustomerSupplyCell: () => null,
  CustomerSupplyUploadDialog: () => null, CustomerDemandDialog: () => null,
  CustomerSupplyAction: ({ children, onClick }) => h("button", { onClick }, children),
  useCustomerContactScope: () => ({ scope: runtime.identityReady ? { actorUserId: runtime.actorId, enterpriseId: runtime.enterpriseId, canManageAll: runtime.canManageAll } : null,
    ready: runtime.identityReady, identityKey: `${runtime.actorId}:${runtime.enterpriseId}:${runtime.identityReady}` }),
  withCustomerContactScope: (scope, input) => ({ ...input, expectedActorUserId: scope.actorUserId, expectedEnterpriseId: scope.enterpriseId }),
  formatContactMethod: method => method.value,
  useCustomerSupplyAuthority: () => ({ identity: null, canRead: false, canWrite: false, failed: false }),
  supplyLocation: () => "", customerWorkbenchLocation: id => `/customers/${id}`,
  businessIndustryCodeSchema: { safeParse: () => ({ success: true }) }, getBusinessIndustryLabel: () => "电子元器件",
  Button: ({ children, variant, size, ...props }) => h("button", props, children), Input: props => h("input", props),
  Select, SelectTrigger: () => null, SelectContent: () => null, SelectValue: () => null,
  SelectItem: ({ value, children }) => h("option", { value }, children),
  Table: ({ children, containerClassName, ...props }) => h("table", props, children), TableBody: element("tbody"), TableCell: element("td"),
  TableHead: element("th"), TableHeader: element("thead"), TableRow: element("tr"),
};
for (const icon of ["ChevronDown", "ChevronUp", "Loader2", "Plus", "Star"]) bindings[icon] = () => h("svg", {});
bindings.trpc = {
  useUtils: () => runtime.utils,
  customer: {
    context: { useQuery: () => ({ data: currentContext(), isPending: runtime.contextPending, isLoading: runtime.contextPending,
      isFetching: runtime.contextFetching, isError: runtime.contextError, refetch: () => { runtime.contextRefetchCalls++; return runtime.contextRefetch(); } }) },
    list: { useQuery: (input, options) => {
      runtime.listInputs.push(input); runtime.listOptions.push(options);
      if (options.enabled) runtime.enabledInputs.push(input);
      let items = runtime.rows.filter(item => item.enterpriseId === runtime.enterpriseId);
      if (!runtime.cachedRows) {
        if (input.scope === "mine") items = items.filter(item => item.assignedUserId === runtime.actorId);
        if (input.scope === "team") items = items.filter(item => item.teamId === input.teamId);
        if (input.assignedUserId) items = items.filter(item => item.assignedUserId === input.assignedUserId);
      } else items = runtime.cachedRows;
      return { data: { items, total: runtime.cachedRows ? 999 : items.length }, isPending: false, isFetching: false,
        isError: runtime.listError, error: new Error("synthetic list retry must stay hidden"), refetch: () => { runtime.listRefetchCalls++; } };
    } },
    contactsSummary: { useQuery: (input, options) => { if (options.enabled) runtime.contactsInputs.push(input); return { data: { items: [] } }; } },
  },
};

beforeEach(async () => {
  runtime = { actorId: 17, enterpriseId: 31, canManageAll: false, canReadAll: false, canReadEnterprise: false, canReadTeam: false,
    teams: [], members: [], defaultTeamId: null, remembered: {}, rows: [row(801, 173, 17), row(802, 173, 18), row(803, 284, 19)],
    identityReady: true, starsReady: true, contextPending: false, contextFetching: false, contextError: false, listError: false, cachedRows: null,
    listInputs: [], listOptions: [], enabledInputs: [], contactsInputs: [], restoreCalls: [], contextRefetchCalls: 0, listRefetchCalls: 0,
    fetchCalls: [], invalidateCalls: 0 };
  runtime.contextRefetch = async () => ({ data: currentContext(), isError: runtime.contextError });
  runtime.utils = { customer: { list: { invalidate: async () => { runtime.invalidateCalls++; }, fetch: async input => { runtime.fetchCalls.push(input); return { items: runtime.rows }; } },
    contactsSummary: { reset: async () => {} }, contactsList: { reset: async () => {} } } };
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://synthetic.invalid/customers" });
  for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Event", "MouseEvent", "KeyboardEvent"]) globalThis[key] = dom.window[key];
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true, __customerListBindings: bindings });
  const module = { exports: {} };
  new Function("module", "exports", "require", compiled.outputFiles[0].text)(module, module.exports, require);
  CustomerList = module.exports.default;
  const { createRoot } = await import("react-dom/client");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); dom.window.close();
  delete globalThis.__customerListBindings;
});
async function render() { await act(async () => { root.render(h(CustomerList)); }); }
function button(name) { const found = [...host.querySelectorAll("button")].find(item => item.textContent.trim() === name); assert.ok(found, `missing button ${name}`); return found; }
async function click(name) { await act(async () => { button(name).dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function control(label) { const item = host.querySelector(`[aria-label="${label}"]`); assert.ok(item, `missing control ${label}`); return item; }
async function choose(label, value) { await act(async () => { const select = control(label); select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function input(label, value) { await act(async () => { const node = control(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); }
function lastInput() { return runtime.listInputs.at(-1); }
function enabled() { return runtime.listOptions.at(-1).enabled; }
function teamRead(enterprise = false) {
  Object.assign(runtime, { canReadAll: true, canReadTeam: true, canReadEnterprise: enterprise, teams: [teamOne, teamTwo], defaultTeamId: teamOne.teamId,
    members: [...teamOne.members, ...teamTwo.members, { userId: 20, name: "企业额外成员（delta）" }] });
}
function remember(filters, extra = {}) { runtime.remembered = { appliedFilters: { ...baseFilters, ...filters }, draftFilters: { ...baseFilters, ...filters }, ...extra }; }
function assertPaused() { assert.equal(enabled(), false); assert.equal(host.querySelector("table"), null); assert.doesNotMatch(host.textContent, /共\s*999\s*条/); }

test("native single-page compiler: no additional runtime imports or top-level bindings", () => {
  const names = ast.statements.filter(node => ts.isFunctionDeclaration(node)).map(node => node.name?.text);
  assert.deepEqual(names, ["updatedDateError", "CustomerList", "gradeClass", "ErrorPanel"]);
  assert.equal(ast.statements.filter(node => ts.isImportDeclaration(node)).length, 29);
  assert.doesNotMatch(source, /407883|409506|智捷团队1|黄紫银|莫66/);
});
test("SSR shows real default team, all readable team names and enterprise only with explicit permission", () => {
  teamRead(true);
  const html = renderToStaticMarkup(h(CustomerList));
  assert.match(html, /合成团队·北区/); assert.match(html, /合成团队·南区/); assert.match(html, /全企业/);
  assert.doesNotMatch(html, /我的客户|授权组员客户/);
  assert.equal(runtime.enabledInputs.length, 0, "SSR must not consume an unverified context");
});
test("ordinary member stays mine, never gains a team label or enterprise permission from legacy flags", async () => {
  runtime.canReadAll = true; runtime.canManageAll = true; runtime.teams = [teamOne];
  await render(); assert.equal(lastInput().scope, "mine"); assert.equal(enabled(), true);
  assert.equal(host.querySelector('[aria-label="客户范围"]'), null); assert.equal(host.querySelector('[aria-label="按负责人筛选"]'), null);
  assert.match(host.textContent, /我负责的客户/); assert.doesNotMatch(host.textContent, /全企业|合成团队/);
  assert.equal(runtime.observedRows.length, 1); assert.equal(lastInput().starMode, "assignee");
});
test("old mine memories migrate only scope/team/owner, preserve dates and independent drafts, and reset page", async () => {
  teamRead();
  const applied = { ...baseFilters, keyword: "已应用", grade: "B", stage: "quoted", due: "overdue", archived: true, starredOnly: true,
    updatedFrom: "2024-02-29", updatedTo: "2024-02-29", assignedUserId: "18" };
  const draft = { ...applied, keyword: "未应用", updatedFrom: "2026-11-01", updatedTo: "2026-11-16" };
  runtime.remembered = { appliedFilters: applied, draftFilters: draft, page: 5 };
  await render();
  assert.deepEqual(runtime.remembered.appliedFilters, { ...applied, scope: "team", teamId: "173", assignedUserId: "" });
  assert.deepEqual(runtime.remembered.draftFilters, { ...draft, scope: "team", teamId: "173", assignedUserId: "" });
  assert.equal(runtime.remembered.page, 1); assert.ok(runtime.enabledInputs.every(input => input.scope === "team" && input.teamId === 173));
  assert.equal(lastInput().updatedFrom, "2024-02-29"); assert.equal(lastInput().starredOnly, true);
});
test("team roster stays team-local; enterprise roster includes only context members; display names remain backend-owned", async () => {
  teamRead(true); await render(); await click("更多筛选");
  assert.deepEqual([...control("按负责人筛选").options].map(option => option.text), ["全部负责人", "我", "陈示例（alpha）", "李示例（beta）"]);
  assert.match(host.querySelector("tbody").textContent, /后台负责人18（alias-18）/);
  assert.match(host.querySelector("tbody").textContent, /真实联系人 alpha 不应被映射为负责人/);
  await choose("客户范围", "all");
  assert.deepEqual([...control("按负责人筛选").options].map(option => option.text), ["全部负责人", "我", ...runtime.members.map(member => member.name)]);
  assert.equal(lastInput().scope, "all"); assert.ok(!("teamId" in lastInput()));
});
test("multiple-team selection uses actual ID/name, clears both assignee states and page but not date drafts", async () => {
  teamRead(true); remember({ scope: "team", teamId: "173", assignedUserId: "18", updatedFrom: "2026-10-01" }, { page: 4, moreFiltersOpen: true });
  runtime.remembered.draftFilters.updatedFrom = "2026-11-01";
  await render(); await choose("客户范围", "team:284");
  assert.equal(lastInput().scope, "team"); assert.equal(lastInput().teamId, 284); assert.equal(lastInput().page, 1); assert.equal(lastInput().updatedFrom, "2026-10-01");
  assert.equal(runtime.remembered.draftFilters.updatedFrom, "2026-11-01");
  assert.equal(runtime.remembered.draftFilters.assignedUserId, ""); assert.equal(runtime.remembered.appliedFilters.assignedUserId, "");
  assert.deepEqual([...control("按负责人筛选").options].map(option => option.text), ["全部负责人", "我", "赵示例（gamma）"]);
});
test("我 is a draft owner intersection, including a readable team where actor is absent, and can legitimately yield zero", async () => {
  teamRead(); await render(); await choose("客户范围", "team:284"); await click("更多筛选");
  const before = lastInput(); await choose("按负责人筛选", "me"); assert.equal(lastInput(), before);
  await click("搜索"); assert.equal(lastInput().assignedUserId, 17); assert.equal(lastInput().scope, "team"); assert.equal(lastInput().teamId, 284);
  assert.equal(enabled(), true); assert.equal(runtime.observedRows.length, 0); assert.match(host.textContent, /共\s*0\s*条/);
  await choose("按负责人筛选", "all"); await click("确定"); assert.ok(!("assignedUserId" in lastInput())); assert.equal(lastInput().teamId, 284);
});
test("enterprise 我 resolves actor ID without changing enterprise range", async () => {
  teamRead(true); remember({ scope: "all" }, { moreFiltersOpen: true }); await render();
  await choose("按负责人筛选", "me"); await click("确定");
  assert.equal(lastInput().scope, "all"); assert.equal(lastInput().assignedUserId, 17); assert.ok(!("teamId" in lastInput()));
});
for (const teamId of ["999", "", "0", "-1", "1.5", "173x", null, 173]) {
  test(`invalid/expired remembered teamId fails closed: ${JSON.stringify(teamId)}`, async () => {
    teamRead(true); remember({ scope: "team", teamId }); runtime.cachedRows = runtime.rows;
    await render(); assertPaused(); assert.equal(runtime.enabledInputs.length, 0); assert.equal(runtime.contactsInputs.length, 0);
    assert.match(host.textContent, /所选团队已失效或无查看权/); assert.ok(!runtime.restoreCalls.includes(true));
    await click("重置"); assert.equal(runtime.enabledInputs.length, 0);
    await choose("客户范围", "team:173"); assert.equal(enabled(), true); assert.equal(lastInput().teamId, 173);
  });
}
test("unauthorized remembered enterprise does not fall back to broad team or expose cached error retry/save fetch", async () => {
  teamRead(); remember({ scope: "all", keyword: "保留", updatedFrom: "2026-11-01" }); runtime.cachedRows = runtime.rows; runtime.listError = true;
  await render(); assertPaused(); assert.match(host.textContent, /没有全企业客户查看权/);
  assert.doesNotMatch(host.textContent, /synthetic list retry/); assert.equal(runtime.enabledInputs.length, 0);
  await click("录入客户"); await act(async () => runtime.createFormProps.onSaved({ id: 900, mode: "close" }));
  assert.equal(runtime.fetchCalls.length, 0); assert.equal(runtime.invalidateCalls, 0); assert.equal(runtime.listRefetchCalls, 0);
  runtime.listError = false; await choose("客户范围", "team:173"); assert.equal(enabled(), true);
  assert.equal(lastInput().keyword, "保留"); assert.equal(lastInput().updatedFrom, "2026-11-01");
});
test("member with stale all memory resumes only by explicitly choosing own customer action", async () => {
  remember({ scope: "all" }); runtime.cachedRows = runtime.rows; await render(); assertPaused();
  await click("查看我负责的客户"); assert.equal(enabled(), true); assert.equal(lastInput().scope, "mine"); assert.ok(!("teamId" in lastInput()));
});
test("missing/invalid current default team never invents or hardcodes a team; readable team can be chosen explicitly", async () => {
  teamRead(); runtime.defaultTeamId = 999; await render(); assertPaused(); assert.equal(runtime.enabledInputs.length, 0);
  await choose("客户范围", "team:284"); assert.equal(enabled(), true); assert.equal(lastInput().teamId, 284);
});
test("out-of-roster owner pauses rather than removing assignedUserId and querying everyone", async () => {
  teamRead(true); remember({ scope: "team", teamId: "173", assignedUserId: "19" }, { moreFiltersOpen: true }); runtime.cachedRows = runtime.rows;
  await render(); assertPaused(); assert.equal(lastInput().assignedUserId, 19); assert.match(host.textContent, /负责人不在当前可读范围/);
  await choose("按负责人筛选", "18"); assertPaused(); await click("确定"); assert.equal(enabled(), true); assert.equal(lastInput().assignedUserId, 18);
});
for (const dates of [ { updatedFrom: "2026-02-29" }, { updatedFrom: "2026-11-17", updatedTo: "2026-11-16" }, { updatedTo: "9999-12-31" }, { updatedFrom: null } ]) {
  test(`invalid remembered dates survive team migration and still pause reads/stats/save: ${JSON.stringify(dates)}`, async () => {
    teamRead(); remember(dates); runtime.cachedRows = runtime.rows;
    await render(); assertPaused(); assert.equal(runtime.enabledInputs.length, 0); assert.match(host.textContent, /查询已暂停/);
    for (const [key, value] of Object.entries(dates)) assert.equal(runtime.remembered.appliedFilters[key], value);
    assert.equal(runtime.remembered.appliedFilters.scope, "team");
    await click("录入客户"); await act(async () => runtime.createFormProps.onSaved({ id: 900, mode: "close" })); assert.equal(runtime.fetchCalls.length, 0);
    await click("重置"); assert.equal(enabled(), true); assert.equal(lastInput().scope, "team"); assert.equal(lastInput().teamId, 173);
  });
}
test("invalid date draft does not promote other drafts; valid dates are natural-day strings; star toggles applied only", async () => {
  teamRead(); remember({ scope: "team", teamId: "173", updatedFrom: "2026-10-01", updatedTo: "2026-10-31" }, { moreFiltersOpen: true });
  await render(); const before = lastInput();
  await input("更新时间开始日期", "2026-11-17"); await input("更新时间结束日期", "2026-11-16"); await input("搜索客户名称、联系人或电话", "未应用");
  await click("确定"); assert.equal(lastInput(), before); assert.equal(enabled(), true); assert.match(host.textContent, /开始日期不能晚于结束日期/);
  await act(async () => control("仅看重点客户").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  assert.equal(lastInput().updatedFrom, "2026-10-01"); assert.equal(lastInput().keyword, ""); assert.equal(lastInput().starredOnly, true); assert.equal(lastInput().starMode, "assignee");
  await input("更新时间开始日期", "2026-11-16"); await click("搜索");
  assert.equal(lastInput().updatedFrom, "2026-11-16"); assert.equal(lastInput().updatedTo, "2026-11-16"); assert.equal(lastInput().keyword, "未应用"); assert.equal(lastInput().starredOnly, true);
  assert.ok(!("starUserId" in lastInput()));
});
test("star-only authority gate cannot be bypassed by selecting team or all", async () => {
  teamRead(true); remember({ starredOnly: true }); runtime.starsReady = false; await render(); assertPaused();
  await choose("客户范围", "all"); assertPaused(); assert.equal(lastInput().starredOnly, true);
  runtime.starsReady = true; await render(); assert.equal(enabled(), true); assert.equal(lastInput().scope, "all");
});
test("reset clears date/owner/star filters but retains actual applied teamId and scope", async () => {
  teamRead(); remember({ scope: "team", teamId: "284", assignedUserId: "19", starredOnly: true, updatedFrom: "2026-11-01" });
  await render(); await click("重置"); assert.equal(lastInput().scope, "team"); assert.equal(lastInput().teamId, 284); assert.equal(lastInput().starredOnly, false);
  assert.ok(!("assignedUserId" in lastInput())); assert.ok(!("updatedFrom" in lastInput())); assert.equal(lastInput().page, 1);
});
test("same-actor enterprise switch waits for fresh context before using a stale roster; expired team remains paused", async () => {
  teamRead(true); await render(); let finish;
  runtime.contextRefetch = () => new Promise(resolve => { finish = resolve; });
  runtime.enterpriseId = 32; runtime.rows = [row(900, 173, 17, { enterpriseId: 32 })]; const requests = runtime.enabledInputs.length;
  await render(); assert.equal(enabled(), false); assert.equal(host.querySelector("table"), null); assert.equal(runtime.enabledInputs.length, requests);
  assert.equal(runtime.contextRefetchCalls, 1);
  runtime.teams = [teamTwo]; runtime.defaultTeamId = 284; runtime.canReadEnterprise = false;
  await act(async () => finish({ data: currentContext(), isError: false })); await render(); assertPaused();
  await choose("客户范围", "team:284"); assert.equal(enabled(), true); assert.equal(lastInput().expectedEnterpriseId, 32);
});
test("same-enterprise actor switch rechecks context, resolves 我 to new actor and does not reuse old expected identity", async () => {
  teamRead(); remember({ scope: "team", teamId: "173", assignedUserId: "me" }); await render(); assert.equal(lastInput().assignedUserId, 17);
  runtime.actorId = 18; await render(); assert.equal(runtime.contextRefetchCalls, 1); assert.equal(enabled(), true);
  assert.equal(lastInput().assignedUserId, 18); assert.equal(lastInput().expectedActorUserId, 18); assert.equal(lastInput().teamId, 173);
});
test("permission revocation keeps dates/star predicate and pauses, never promotes draft or old all to a broad default", async () => {
  teamRead(true); remember({ scope: "all", updatedFrom: "2026-10-01", starredOnly: true }); await render();
  runtime.canReadEnterprise = false; await render(); assertPaused(); assert.equal(lastInput().scope, "all"); assert.equal(lastInput().updatedFrom, "2026-10-01");
  await choose("客户范围", "team:173"); assert.equal(enabled(), true); assert.equal(lastInput().starredOnly, true);
});
test("context/identity failures hide rows, stats, contact summaries and list position restore", async () => {
  runtime.identityReady = false; await render(); assert.equal(enabled(), false); assert.equal(host.querySelector("table"), null);
  assert.doesNotMatch(host.textContent, /共\s*\d+\s*条/); assert.equal(runtime.contactsInputs.length, 0); assert.ok(!runtime.restoreCalls.includes(true));
  runtime.identityReady = true; runtime.contextError = true; await render(); assert.equal(enabled(), false); assert.equal(host.querySelector("table"), null);
});

test("first mount waits for cached context refetch to finish before migrating or consuming any rows", async () => {
  teamRead(true); runtime.contextFetching = true; await render();
  assert.equal(enabled(), false); assert.equal(runtime.enabledInputs.length, 0); assert.equal(runtime.remembered.appliedFilters, undefined);
  runtime.contextFetching = false; await render(); assert.equal(enabled(), true); assert.equal(lastInput().scope, "team");
  assert.ok(runtime.enabledInputs.every(item => item.scope === "team"));
});
test("identity context refetch is not cancelled or repeated when isFetching toggles", async () => {
  teamRead(); await render(); let finish;
  runtime.contextRefetch = () => new Promise(resolve => { finish = resolve; }); runtime.enterpriseId = 32;
  await render(); assert.equal(runtime.contextRefetchCalls, 1); assert.equal(enabled(), false);
  runtime.contextFetching = true; await render(); assert.equal(runtime.contextRefetchCalls, 1);
  runtime.contextFetching = false; await act(async () => finish({ data: currentContext(), isError: false })); await render();
  assert.equal(runtime.contextRefetchCalls, 1); assert.equal(enabled(), true); assert.equal(lastInput().expectedEnterpriseId, 32);
});
test("late prior-identity context response cannot verify a newer identity or show cached rows", async () => {
  teamRead(); await render(); const pending = [];
  runtime.contextRefetch = () => new Promise(resolve => pending.push(resolve));
  runtime.actorId = 18; await render(); assert.equal(enabled(), false);
  runtime.actorId = 19; await render(); assert.equal(enabled(), false); assert.equal(pending.length, 2);
  await act(async () => pending[0]({ data: { ...currentContext(), actorUserId: 18 }, isError: false }));
  assert.equal(enabled(), false); assert.equal(host.querySelector("table"), null);
  await act(async () => pending[1]({ data: currentContext(), isError: false })); assert.equal(enabled(), true);
  assert.equal(lastInput().expectedActorUserId, 19);
});
