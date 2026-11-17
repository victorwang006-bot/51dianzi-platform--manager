import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const manifests = process.argv.slice(2);
assert(manifests.length, "usage: node check-customer-picker.mjs <candidate.manifest.json...>");
let passed = 0;
const check = (name, run) => { run(); passed++; };
const good = data => ({ data, isSuccess: true, isFetching: false, isError: false, isPlaceholderData: false, isFetchedAfterMount: true });
function harness(replacement) {
  const state = { cells: [], cursor: 0, calls: [], refetches: [], selected: [], writable: true, ready: true,
    context: good({ actorUserId: 397751, canManageAll: true, canReadEnterprise: true,
      salesOrderPicker: { scope: "team", teamId: 1, teamName: "智捷团队1", creationOrigin: "backend" } }),
    result: good({ total: 1, items: [{ id: 1359, name: "Synthetic fixture customer", assignedUserId: 415045, assignedName: "Jack", createdByUserId: 415045, createdByName: "Jack", archivedAt: null,
      pickerProvenance: { teamId: 1, teamName: "智捷团队1", creationOrigin: "backend", createdAdminAccountId: 30010 } }] }) };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const useQuery = kind => (input, options) => { state.calls.push({ kind, input, options }); const query = kind === "context" ? state.context : state.result;
    return { ...query, refetch: () => { state.refetches.push(kind); } }; };
  const context = vm.createContext({ pa: { useState: initial => { const i = state.cursor++; if (!(i in state.cells)) state.cells[i] = initial;
    return [state.cells[i], next => { state.cells[i] = typeof next === "function" ? next(state.cells[i]) : next; }]; } },
    ma: { customer: { context: { useQuery: useQuery("context") }, list: { useQuery: useQuery("list") } } },
    oe: () => ({ ready: state.ready }), Ne: () => ({ isWritable: () => state.writable && state.ready }), Q: jsx, Te: jsx,
    fetch: () => { throw new Error("NETWORK_FORBIDDEN"); } });
  vm.runInContext("globalThis.picker = " + replacement, context);
  const render = () => { state.cursor = 0; state.calls = []; state.tree = context.picker({ enabled: true, onSelect: row => state.selected.push(row) }); return state.tree; };
  const flat = () => { const out = []; const visit = x => { if (Array.isArray(x)) return x.forEach(visit); if (x && typeof x === "object") { out.push(x); visit(x.props?.children); } }; visit(state.tree); return out; };
  const input = () => flat().find(n => n.type === "input");
  const button = text => flat().find(n => n.type === "button" && n.props.children === text);
  const select = () => flat().find(n => n.type === "select");
  const text = () => { const p = x => Array.isArray(x) ? x.map(p).join(" ") : x && typeof x === "object" ? p(x.props?.children) : x == null ? "" : String(x); return p(state.tree); };
  const list = () => state.calls.find(c => c.kind === "list");
  const type = value => { input().props.onChange({ target: { value } }); render(); };
  const search = value => { type(value); button("搜索").props.onClick(); render(); };
  render(); return { state, render, flat, input, button, select, text, list, type, search };
}
for (const manifestPath of manifests) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert(manifest.checks.inverseVerified && manifest.checks.untouchedPublicFactory);
  for (const patch of manifest.patches) {
    const h = harness(patch.replacement);
    check("default range has no unapproved time limit", () => { assert(!h.text().includes("90天")); assert(h.text().includes("智捷团队1") && h.text().includes("后台来源")); assert.equal(h.list().input.updatedFrom, undefined); assert.equal(h.list().input.updatedTo, undefined); });
    check("opening with canManageAll does not load records", () => { assert.equal(h.list().options.enabled, false); assert(!h.button("选择客户")); assert(h.text().includes("请先输入关键词")); });
    check("draft is not a submitted search", () => { h.type("首航"); assert.equal(h.list().options.enabled, false); });
    check("submitted search uses new server picker flag and not canManageAll all", () => { h.button("搜索").props.onClick(); h.render(); assert.equal(h.list().options.enabled, true); assert.equal(h.list().input.salesOrderPicker, "current_team"); assert.equal(h.list().input.scope, "mine"); });
    check("results identify owner creator frozen team and trusted admin source", () => { assert(h.text().includes("Jack") && h.text().includes("智捷团队1") && h.text().includes("账号30010")); h.button("选择客户").props.onClick(); assert.equal(h.state.selected.length, 1); });
    check("editing/clearing hides stale rows and disables requests", () => { h.type(""); assert.equal(h.list().options.enabled, false); assert(!h.button("选择客户")); h.button("搜索").props.onClick(); assert.equal(h.state.refetches.length, 0); });
    check("enterprise switch is explicit and does not auto query", () => { h.select().props.onChange({ target: { value: "enterprise" } }); h.render(); assert.equal(h.list().options.enabled, false); h.search("首航"); assert.equal(h.list().input.salesOrderPicker, "enterprise"); assert.equal(h.list().options.enabled, true); });
    check("permission revocation hides enterprise rows immediately", () => { h.state.context.data.canReadEnterprise = false; h.render(); assert.equal(h.list().options.enabled, false); assert(!h.button("选择客户")); assert(!h.flat().some(n => n.type === "option" && n.props.value === "enterprise")); });
    check("old backend missing additive context guard never loads legacy directory", () => { delete h.state.context.data.salesOrderPicker; h.render(); assert.equal(h.list().options.enabled, false); assert(h.text().includes("服务尚未就绪")); });
    const h2 = harness(patch.replacement); h2.search("首航");
    check("fresh refetch placeholder and error do not expose stale matches", () => { for (const flag of ["isFetching", "isPlaceholderData", "isError"]) { h2.state.result[flag] = true; h2.render(); assert(!h2.button("选择客户")); h2.state.result[flag] = false; } });
    check("live authorization loss blocks an already rendered selection callback", () => { h2.render(); const select = h2.button("选择客户").props.onClick; h2.state.writable = false; select(); assert.equal(h2.state.selected.length, 0); });
    check("Enter is submit-safe and duplicate search refetches only active query", () => { h2.state.writable = true; h2.type("另一客户"); let prevented = false; h2.input().props.onKeyDown({ key: "Enter", preventDefault() { prevented = true; } }); h2.render(); assert(prevented); assert.equal(h2.list().input.keyword, "另一客户"); h2.button("搜索").props.onClick(); assert.deepEqual(h2.state.refetches, ["list"]); });
    const h3 = harness(patch.replacement); h3.state.context.isError = true; h3.state.context.error = { message: "fixture context unavailable" }; h3.render();
    check("context retry never invokes an empty customer list refetch", () => { h3.button("重试").props.onClick(); assert.deepEqual(h3.state.refetches, ["context"]); assert.equal(h3.list().options.enabled, false); });
  }
}
const result = { status: "PASS_OFFLINE_ACTUAL_CANDIDATE_FUNCTIONS", passed, failed: 0, manifests, noNetwork: true, noDB: true, noBrowser: true,
  limitations: "Persistent hook/JSX harness, not live RPC or browser acceptance. Executes exactly manifest replacement functions using reviewed native aliases." };
fs.writeFileSync(here + "/candidate-checks.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
