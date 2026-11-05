// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, writeFileSync } from "node:fs";
import postcss from "postcss";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  rows: [] as any[], summary: vi.fn(), context: vi.fn(), create: vi.fn(), navigate: vi.fn(),
  authorizationError: vi.fn(), utils: null as any, authVersion: "v1", enterpriseFailed: false,
  authorityRetry: vi.fn(), enterpriseId: 31, actorId: 7,
  starContext: vi.fn(), setStar: vi.fn(), targets: [] as { userId: number; name: string }[],
  starList: vi.fn(), delegatedRows: {} as Record<number, any[]>,
  listInputs: [] as any[], listPending: false, listFetching: false, customerContextError: false,
  listOptions: [] as any[],
  remembered: {} as Record<string, unknown>,
  canManageAll: false, canReadAll: false, members: [] as { userId: number; name: string }[],
  identityReady: true, restoreCalls: [] as boolean[],
}));
vi.mock("wouter", () => ({ useLocation: () => ["/customers", runtime.navigate], useSearch: () => "" }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), warning: vi.fn() } }));
vi.mock("../hooks/usePageMemory", async () => {
  const { useState } = await import("react");
  return { usePageMemory: () => runtime.identityReady,
    useRememberedState: (key: string, value: unknown) => useState(key in runtime.remembered ? runtime.remembered[key] : value),
    freshListOptions: (options: any, ready: boolean) => ({ ...options, enabled: ready && options.enabled !== false }),
    useListPositionRestore: (_query: unknown, active: boolean) => { runtime.restoreCalls.push(active); },
    returnToPageSource: vi.fn() };
});
vi.mock("../hooks/useCustomerCreateDraft", () => ({
  useCustomerCreateDraftIdentity: () => ({ key: "synthetic-once-identity" }),
  useCustomerCreateDraft: () => ({ completion: null, consumeCompletion: vi.fn() }),
}));
vi.mock("../components/customers/CustomerCreateForm", () => ({ CustomerCreateForm: () => null }));
vi.mock("../components/customerDemands/CustomerDemandDialog", () => ({ CustomerDemandDialog: ({ customer }: any) => React.createElement("div", { "data-testid": "synthetic-demand-open" }, customer.name) }));
vi.mock("../../../../api/business-auth", () => ({ useAuth: () => ({ user: { id: runtime.actorId }, loading: false, isAuthenticated: true }) }));
vi.mock("../../../../api/business-enterprise-session", () => ({ useOptionalEnterpriseSession: () => ({ activeEnterprise: { enterpriseId: runtime.enterpriseId, memberStatus: "active", accessStatus: "enabled" } }) }));
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => ({
  storageScope: `synthetic:${runtime.actorId}:${runtime.enterpriseId}`,
  contextVerification: { identity: `synthetic:${runtime.actorId}:${runtime.enterpriseId}`, authorizationVersion: runtime.authVersion, readVersion: runtime.authVersion },
  officialInventoryPermissions: { read: true, write: true, note: true, authorizationVersion: runtime.authVersion },
  onAuthorizationError: runtime.authorizationError,
}) }));
vi.mock("../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => runtime.utils,
  enterprise: { me: { useQuery: () => ({ data: { enterprise: { id: runtime.enterpriseId }, currentUserId: runtime.actorId, permissionKeys: ["inventory.manage"], member: { status: "active", permissionVersion: 1 } }, isError: runtime.enterpriseFailed, refetch: runtime.authorityRetry }) } },
  customer: {
    context: { useQuery: () => ({ data: { actorUserId: runtime.actorId, canManageAll: runtime.canManageAll, canReadAll: runtime.canReadAll || runtime.canManageAll, members: runtime.members }, isPending: false, isLoading: false, isError: runtime.customerContextError, refetch: vi.fn() }) },
    list: { useQuery: (input: any, options: any) => { runtime.listInputs.push(input); runtime.listOptions.push(options); return { data: { items: input.page === 1 ? runtime.rows : [{ ...runtime.rows[0], id: 804 }], total: 40 }, isPending: runtime.listPending, isFetching: runtime.listFetching, isError: false, refetch: vi.fn() }; } },
    contactsSummary: { useQuery: () => ({ data: { items: runtime.rows.map(row => ({ customerId: row.id, contactCount: row.id === 801 ? 8 : 1, primaryContact: { name: row.contactName, methods: [{ type: "landline", value: row.phone }] } })) } }) },
    contactsList: { useQuery: () => ({ data: { contacts: [] }, isPending: false, isError: false, refetch: vi.fn() }) },
  },
} }));

import CustomerList from "./CustomerList";

let host: HTMLDivElement;
let root: Root;
function row(id: number, changes: Record<string, unknown> = {}) {
  return { id, name: `合成客户${id}有限公司`, industryCode: "electronic_components", contactName: "合成较长联系人姓名完整保留", phone: "010-00000001 转 123456",
    assignedName: "合成负责人", assignedUserId: 7, enterpriseId: 31, grade: "B", stage: "following", nextFollowUpAt: "2026-11-06T08:30:00+08:00",
    version: 4, archivedAt: null, isStarred: false, starRevision: 0, starUserId: 7, canSetStar: true, ...changes };
}
function summaries() {
  return { items: runtime.rows.map(row => ({ customerId: row.id, channelId: row.id === 801 ? 411 : null,
    materialCount: row.id === 801 ? 123456 : 0, canUpload: !row.archivedAt && Boolean(row.industryCode),
    canViewStock: row.id === 801, disabledReason: row.archivedAt ? "该客户已归档" : null })), canWrite: true };
}
async function render() {
  await act(async () => { root.render(React.createElement("main", { className: "admin-workspace-shell__main admin-unified-content", "data-admin-ui-system": "channel-inventory" }, React.createElement(CustomerList))); });
}
function button(name: string, parent: Element = host): HTMLButtonElement {
  const found = Array.from(parent.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.trim() === name);
  if (!found) throw new Error(`missing button: ${name}`);
  return found;
}
async function click(element: Element) {
  await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}
function tableRows() { return Array.from(host.querySelectorAll<HTMLTableRowElement>("tbody tr")); }
function star(id = 801) { return host.querySelector<HTMLButtonElement>(`button[data-star-customer="${id}"]`)!; }
function fixture(path: string) {
  writeFileSync(path, `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actual CustomerList synthetic v19 render</title></head><body data-admin-readability="true" data-business-native-fonts="true">${host.innerHTML}</body></html>\n`);
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  runtime.rows = [row(801, { name: "合成超长客户名称用于检验姓名截断后星标仍完整可达有限公司", isStarred: true, starRevision: 2 }), row(802, { industryCode: null, contactName: "合成补档联系人", nextFollowUpAt: null }), row(803, { archivedAt: "2026-11-01", nextFollowUpAt: "2026-11-02T09:00:00+08:00" })];
  runtime.authVersion = "v1"; runtime.enterpriseFailed = false; runtime.enterpriseId = 31; runtime.actorId = 7;
  runtime.targets = [{ userId: 7, name: "合成员工" }]; runtime.listInputs = []; runtime.listPending = false; runtime.listFetching = false; runtime.customerContextError = false;
  runtime.listOptions = [];
  runtime.remembered = {};
  runtime.canManageAll = false; runtime.canReadAll = false; runtime.members = [];
  runtime.identityReady = true; runtime.restoreCalls = [];
  runtime.delegatedRows = {};
  runtime.starContext.mockReset().mockImplementation(async () => ({ enterpriseId: runtime.enterpriseId, actorUserId: runtime.actorId, targets: runtime.targets }));
  runtime.setStar.mockReset().mockImplementation(async (input: any) => {
    const update = (items: any[]) => items.map(item => item.id === input.customerId ? { ...item, isStarred: input.starred, starRevision: input.expectedRevision + 1, starUserId: input.targetUserId } : item);
    const current = runtime.rows.find(item => item.id === input.customerId);
    if (current && current.assignedUserId !== input.targetUserId) throw Object.assign(new Error("负责人变化"), { data: { code: "NOT_FOUND" } });
    runtime.rows = update(runtime.rows);
    return { customerId: input.customerId, targetUserId: input.targetUserId, isStarred: input.starred, starRevision: input.expectedRevision + 1, requestId: input.requestId, idempotent: false };
  });
  runtime.summary.mockReset().mockImplementation(() => Promise.resolve(summaries()));
  runtime.context.mockReset().mockResolvedValue({ customer: { ...runtime.rows[0] }, channel: null, canUpload: true, disabledReason: null });
  runtime.create.mockReset().mockResolvedValue({ item: { id: 901 }, idempotent: false, channelId: 411, customerId: 801 });
  runtime.navigate.mockReset(); runtime.authorizationError.mockReset(); runtime.authorityRetry.mockReset();
  runtime.utils = { client: { customer: { starContext: { query: runtime.starContext }, setStar: { mutate: runtime.setStar }, list: { query: runtime.starList } }, channelInventory: { customerSupplySummary: { query: runtime.summary }, customerSupplyContext: { query: runtime.context }, createCustomerMaterial: { mutate: runtime.create } } },
    customer: { contactsSummary: { reset: vi.fn().mockResolvedValue(undefined) }, contactsList: { reset: vi.fn().mockResolvedValue(undefined) }, list: { invalidate: vi.fn().mockResolvedValue(undefined) } } };
  document.body.dataset.adminReadability = "true";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.replaceChildren(); delete document.body.dataset.adminReadability; vi.useRealTimers(); });

describe("actual CustomerList supply layout and once-identity refresh", () => {
  it("renders exactly eight headers/cols/cells, both star states, long names and complete fixed right actions", async () => {
    await render();
    const rows = tableRows(); expect(rows).toHaveLength(3); expect(rows.every(row => row.cells.length === 8)).toBe(true);
    expect(host.querySelectorAll("col")).toHaveLength(8); expect(host.querySelectorAll("[colspan]")).toHaveLength(0);
    expect(Array.from(host.querySelectorAll("thead th")).map(cell => cell.textContent)).toEqual(["客户名称", "所属行业", "联系人 / 电话", "等级 / 阶段", "负责人", "供应库存", "需求录入", "跟进"]);
    expect(rows[0].cells[2].textContent).toContain("合成较长联系人姓名完整保留"); expect(rows[0].cells[2].textContent).toContain("010-00000001 转 123456");
    expect(rows[0].cells[5].textContent).toContain("查看库存（123456）"); expect(rows[1].cells[5].textContent).toContain("补全客户档案");
    expect(rows[0].cells[6].className).toContain("customer-list-demand-column");
    expect(rows[0].cells[7].className).toContain("customer-list-actions-column");
    expect(star().getAttribute("aria-pressed")).toBe("true"); expect(star(802).getAttribute("aria-pressed")).toBe("false");
    expect(rows[0].querySelector(".customer-list-name-line .customer-list-name")?.textContent).toBe(runtime.rows[0].name);
    expect(host.querySelector('.customer-list-table-scroll[role="region"][tabindex="0"]')).not.toBeNull();
    for (const action of host.querySelectorAll<HTMLButtonElement>("tbody .customer-list-text-action")) {
      expect(action.getAttribute("type")).toBe("button"); expect(action.classList.contains("admin-row-action")).toBe(false); expect(action.hasAttribute("data-slot")).toBe(false);
    }
    // Optional private actual-DOM fixture for production-CSS browser measurements.
    if (process.env.CUSTOMER_LIST_FIXTURE_PATH) fixture(process.env.CUSTOMER_LIST_FIXTURE_PATH);
  });
  it("keeps all local CSS scoped, explicit column widths, a single horizontal scroller and unboxed standard text actions", () => {
    const css = readFileSync("client/src/business/platform/client/src/pages/CustomerList.css", "utf8");
    postcss.parse(css).walkRules(rule => expect(rule.selector).toMatch(/^\.customer-list-page/));
    expect(css).toContain("min-width: 1304px"); expect(css).toContain("table-layout: fixed"); expect(css).toContain("right: var(--customer-list-actions-width)");
    expect(css).toContain("width: 168px"); expect(css).not.toContain("176px"); expect(css).not.toContain("col-followup"); expect(css).toContain("overflow-x: auto"); expect(css).toContain("overflow: visible");
    expect(css).toContain("flex-shrink: 0"); expect(css).toContain("width: 16px"); expect(css).toContain("fill: currentColor");
    expect(css).toContain("background: transparent"); expect(css).toContain("border: 0"); expect(css).toContain("font-family: inherit"); expect(css).toContain(":focus-visible");
    expect(css).not.toMatch(/!important|scale\(|zoom:/);
  });
  it("restores position only after a current authorized list is actually rendered", async () => {
    runtime.identityReady = false;
    await render();
    expect(runtime.restoreCalls).not.toContain(true);
    expect(runtime.listOptions.at(-1)?.enabled).toBe(false);
    expect(host.textContent).not.toContain(runtime.rows[0].name);
    runtime.identityReady = true; runtime.restoreCalls = [];
    await render();
    expect(runtime.restoreCalls.at(-1)).toBe(true);
    expect(tableRows()[0]?.textContent).toContain(runtime.rows[0].name);
    expect(host.querySelector('[data-page-memory-scroll="customer-list-table"]')).not.toBeNull();
  });
  it("does not consume restore or reveal a cached empty-page total when CRM authority is revoked", async () => {
    runtime.rows = []; runtime.customerContextError = true;
    await render();
    expect(runtime.restoreCalls).not.toContain(true);
    expect(runtime.listOptions.at(-1)?.enabled).toBe(false);
    expect(host.textContent).not.toMatch(/共\s*40\s*条/);
  });
  it("renders a directly usable original file portal from upload without the first-source confirmation", async () => {
    await render(); await click(button("上传物料表", tableRows()[0]));
    expect(document.querySelector('[data-testid="channel-inventory-batch-dialog"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="首次渠道类型"]')).toBeNull(); expect(runtime.context).toHaveBeenCalledTimes(1);
  });
  it("refreshes the bounded summary after the real importer completion event and locates the real channel", async () => {
    await render(); await click(button("上传物料表", tableRows()[0]));
    const sheet = XLSX.utils.aoa_to_sheet([["型号", "品牌"], ["SYNTHETIC", "TI"]]);
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "synthetic");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }); const file = new File([bytes], "synthetic-only.xlsx");
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
    const input = document.querySelector<HTMLInputElement>('[aria-label="上传库存表格"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); });
    await click(button("预览并校验", document.body)); await click(button("确认上传 1 条", document.body));
    expect(runtime.create).toHaveBeenCalledTimes(1); expect(runtime.create.mock.calls[0][0].sourceProfile).toEqual({ type: "factory" });
    expect(runtime.summary).toHaveBeenCalledTimes(2); expect(runtime.summary.mock.calls[1][0].customerIds).toEqual([801, 802, 803]);
    expect(runtime.navigate).toHaveBeenLastCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=channels");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("does not refresh summary on focus or after 90 seconds, but page and authorization changes refresh", async () => {
    await render(); expect(runtime.summary).toHaveBeenCalledTimes(1); vi.useFakeTimers();
    await act(async () => { window.dispatchEvent(new Event("focus")); vi.advanceTimersByTime(90_000); });
    expect(runtime.summary).toHaveBeenCalledTimes(1); vi.useRealTimers();
    await click(button("下一页")); expect(runtime.summary).toHaveBeenCalledTimes(2);
    expect(runtime.summary.mock.calls[1][0].customerIds).toEqual([804]);
    runtime.authVersion = "v2"; await render(); expect(runtime.summary).toHaveBeenCalledTimes(3);
  });
  it("offers an explicit summary error retry and preserves exact record/version input", async () => {
    runtime.summary.mockRejectedValueOnce(new Error("synthetic summary failure")); await render();
    expect(button("上传物料表", tableRows()[0]).getAttribute("aria-disabled")).toBe("true");
    await click(button("重试供应库存", tableRows()[0])); expect(runtime.summary).toHaveBeenCalledTimes(2);
    expect(runtime.summary.mock.calls[1][0]).toEqual({ customerIds: [801, 802, 803], expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(button("上传物料表", tableRows()[0]).hasAttribute("aria-disabled")).toBe(false);
  });
  it("keeps archive reasons keyboard-described and prevents disabled demand/followup activation", async () => {
    await render(); const row = tableRows()[2];
    for (const name of ["需求录入", "跟进"]) {
      const action = button(name, row); action.focus(); expect(document.activeElement).toBe(action);
      expect(document.getElementById(action.getAttribute("aria-describedby")!)?.textContent).toContain("已归档"); await click(action);
    }
    expect(runtime.navigate).not.toHaveBeenCalled(); expect(host.querySelector('[data-testid="synthetic-demand-open"]')).toBeNull();
  });
  it("keeps profile completion and exact authorized stock location clickable, and primary create button unchanged", async () => {
    await render(); await click(button("补全客户档案", tableRows()[1])); expect(runtime.navigate).toHaveBeenLastCalledWith("/customers/802");
    await click(button("查看库存（123456）", tableRows()[0])); expect(runtime.navigate).toHaveBeenLastCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=materials");
    const create = button("录入客户"); expect(create.className).toContain("customer-list-control"); expect(create.className).not.toContain("customer-list-text-action");
    await click(button("需求录入", tableRows()[0])); expect(host.querySelector('[data-testid="synthetic-demand-open"]')?.textContent).toBe(runtime.rows[0].name);
  });
  it("rejects an old summary response on identity switch and aborts its original signal", async () => {
    let finish!: (value: unknown) => void;
    runtime.summary.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render();
    const old = runtime.summary.mock.calls[0][1].signal as AbortSignal;
    runtime.enterpriseId = 32; runtime.actorId = 8;
    // A real fresh list belongs to the new tenant/actor. Do not keep the prior
    // tenant's rows and star target as a supposed newly authorized response.
    runtime.targets = [{ userId: 8, name: "新身份合成员工" }];
    runtime.rows = [row(804, { enterpriseId: 32, assignedUserId: 8, starUserId: 8 })];
    await render(); expect(old.aborted).toBe(true);
    await act(async () => { finish({ items: [{ customerId: 801, channelId: 999, materialCount: 999, canViewStock: true, canUpload: true }], canWrite: true }); });
    expect(host.textContent).not.toContain("查看库存（999）"); expect(runtime.summary.mock.calls[1][0]).toMatchObject({ expectedEnterpriseId: 32, expectedActorUserId: 8 });
  });
  it("exposes authority read error retry even before a summary identity is available", async () => {
    runtime.enterpriseFailed = true; await render(); expect(runtime.summary).not.toHaveBeenCalled();
    await click(button("重试供应权限")); expect(runtime.authorityRetry).toHaveBeenCalledTimes(1);
  });
});

describe("actual CustomerList layered filters v20", () => {
  it("keeps basic and expanded controls in separate full-width groups, preserving drafts on collapse", async () => {
    const draft = { keyword: "待应用", grade: "B", stage: "quoted", scope: "mine", assignedUserId: "", due: "today", archived: true };
    runtime.remembered = { draftFilters: draft, page: 2 };
    await render();
    const basic = host.querySelector('.customer-list-basic-filters[aria-label="基础筛选"]')!;
    const moreButton = button("更多筛选", basic);
    expect(moreButton.getAttribute("aria-controls")).toBe("customer-list-more-filters");
    expect(moreButton.getAttribute("aria-expanded")).toBe("false");
    expect(button("搜索", basic)).toBeDefined();
    await click(moreButton);
    const expanded = host.querySelector('#customer-list-more-filters[aria-label="更多筛选条件"]')!;
    expect(expanded.parentElement).toBe(basic.parentElement);
    expect(basic.contains(expanded)).toBe(false);
    expect(expanded.querySelector('[aria-label="按客户阶段筛选"]')?.textContent).toBe("报价中");
    expect(expanded.querySelector('[aria-label="按负责人筛选"]')).toBeNull();
    expect(expanded.querySelector('[aria-label="按归档状态筛选"]')?.textContent).toBe("已归档客户");
    expect(runtime.listInputs.at(-1)).toMatchObject({ keyword: "", page: 2, archived: false, starMode: "assignee" });
    await click(moreButton); await click(moreButton);
    expect(host.querySelector('[aria-label="按客户阶段筛选"]')?.textContent).toBe("报价中");
    await click(button("确定"));
    expect(runtime.listInputs.at(-1)).toMatchObject({ keyword: "待应用", grade: "B", stage: "quoted", due: "today", archived: true, scope: "mine", page: 1, starMode: "assignee" });
  });

  it.each(["搜索按钮", "Enter"])("applies the same complete restored draft with %s and retains legitimate all-company scope on reset", async mode => {
    runtime.canManageAll = true; runtime.members = [{ userId: 8, name: "合成负责人" }];
    runtime.targets.push({ userId: 8, name: "合成组员" });
    const draft = { keyword: "  客户  ", grade: "C", stage: "quoted", scope: "all", assignedUserId: "8", due: "overdue", archived: true };
    runtime.remembered = { draftFilters: draft, appliedFilters: { ...draft, keyword: "原查询" }, page: 2, moreFiltersOpen: true };
    await render();
    expect(host.querySelector('[aria-label="客户范围"]')?.textContent).toBe("全企业");
    expect(host.querySelector('#customer-list-more-filters [aria-label="按负责人筛选"]')).not.toBeNull();
    if (mode === "搜索按钮") await click(button("搜索"));
    else await act(async () => { host.querySelector(".customer-list-search")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(runtime.listInputs.at(-1)).toMatchObject({ keyword: "客户", grade: "C", stage: "quoted", scope: "all", assignedUserId: 8, due: "overdue", archived: true, page: 1, pageSize: 20, starMode: "assignee" });
    expect(host.querySelector<HTMLInputElement>(".customer-list-search")!.value).toBe("客户");
    if (mode === "搜索按钮" && process.env.CUSTOMER_FILTERS_FIXTURE_PATH) fixture(process.env.CUSTOMER_FILTERS_FIXTURE_PATH);
    await click(button("重置"));
    expect(runtime.listInputs.at(-1)).toMatchObject({ keyword: "", scope: "all", due: "all", archived: false, page: 1, starMode: "assignee" });
    for (const key of ["assignedUserId", "grade", "stage"]) expect(runtime.listInputs.at(-1)).not.toHaveProperty(key);
    expect(button("重置").disabled).toBe(true);
  });

  it("stacks the shared flex bar locally and allows both controls and actions to wrap without changing design tokens", () => {
    const css = readFileSync("client/src/business/platform/client/src/pages/CustomerList.css", "utf8");
    const parsed = postcss.parse(css);
    const declarations = (selector: string) => {
      const result: Record<string, string> = {};
      parsed.walkRules(rule => { if (rule.selector === selector && rule.parent?.type !== "atrule") rule.walkDecls(decl => { result[decl.prop] = decl.value; }); });
      return result;
    };
    expect(declarations(".customer-list-page .customer-list-filters")).toMatchObject({ "flex-direction": "column", "align-items": "stretch", gap: "0" });
    expect(declarations(".customer-list-page .customer-list-filter-row")).toMatchObject({ display: "flex", "align-items": "center", "flex-wrap": "wrap", width: "100%", "min-width": "0" });
    expect(declarations(".customer-list-page .customer-list-filter-actions")["flex-wrap"]).toBe("wrap");
    expect(declarations(".customer-list-page .customer-list-search-group")).toMatchObject({ flex: "1 1 360px", "min-width": "min(240px, 100%)", "max-width": "520px" });
    expect(css).toContain("@media (max-width: 680px)"); expect(css).toContain("flex-basis: 100%");
    expect(declarations(".customer-list-page .customer-list-control")).toMatchObject({ height: "var(--admin-content-control-height, 32px)", "font-size": "var(--admin-content-font-body, 12px)", "border-radius": "6px" });
  });
});

describe("actual CustomerList personal stars", () => {
  it("renders absent preferences as an enabled grey empty native star, without a self-only selector", async () => {
    runtime.rows = [row(801)]; await render();
    expect(star().getAttribute("type")).toBe("button"); expect(star().getAttribute("aria-pressed")).toBe("false");
    expect(star().getAttribute("aria-disabled")).toBe("false"); expect(star().getAttribute("aria-label")).toBe(`标记为重点客户：${runtime.rows[0].name}`);
    expect(star().querySelector("svg")?.getAttribute("width")).toBe("16");
    expect(host.querySelector('select[aria-label="星标归属"]')).toBeNull();
    expect(runtime.starContext.mock.calls[0][0]).toBeUndefined(); expect(runtime.setStar).not.toHaveBeenCalled();
  });

  it("adds and removes using authoritative revisions, keeps name/navigation separate and focuses the same native star", async () => {
    runtime.rows = [row(801)]; await render(); star().focus();
    await act(async () => { star().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })); });
    expect(runtime.setStar.mock.calls[0][0]).toEqual({ customerId: 801, targetUserId: 7, starred: true, expectedRevision: 0,
      expectedEnterpriseId: 31, expectedActorUserId: 7, starMode: "assignee", requestId: expect.any(String) });
    expect(star().getAttribute("aria-pressed")).toBe("true"); expect(runtime.navigate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(star());
    await click(star()); expect(runtime.setStar.mock.calls[1][0]).toMatchObject({ starred: false, expectedRevision: 1, targetUserId: 7 });
    expect(star().getAttribute("aria-pressed")).toBe("false");
    await click(host.querySelector(".customer-list-name")!); expect(runtime.navigate).toHaveBeenLastCalledWith("/customers/801");
    expect(runtime.setStar).toHaveBeenCalledTimes(2); expect(host.querySelector("tbody tr a")).toBeNull();
    expect(runtime.utils.customer.list.invalidate).toHaveBeenCalledTimes(2);
  });

  it("retains the server order, returns to page one on star success and preserves keyword/due filters", async () => {
    runtime.rows = [row(801), row(802, { isStarred: true, starRevision: 8 })]; await render();
    expect(tableRows().map(row => row.dataset.pageMemoryRow)).toEqual(["801", "802"]);
    await click(button("下一页")); expect(runtime.listInputs.at(-1).page).toBe(2);
    await click(star(804)); expect(runtime.listInputs.at(-1)).toMatchObject({ page: 1, due: "all", starMode: "assignee" });
    const input = host.querySelector<HTMLInputElement>('input[aria-label="搜索客户名称、联系人或电话"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  合成  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(button("搜索")); expect(runtime.listInputs.at(-1)).toMatchObject({ keyword: "合成", page: 1, starMode: "assignee" });
  });

  it("shows loader and prevents duplicate personal commands without optimistic toggling or a global selector", async () => {
    runtime.targets.push({ userId: 8, name: "合成组员" });
    let finish!: (value: unknown) => void;
    runtime.setStar.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render();
    await click(star(802)); expect(star(802).getAttribute("aria-busy")).toBe("true"); expect(star(802).getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector('select[aria-label="星标归属"]')).toBeNull();
    await click(star()); await click(star(802)); expect(runtime.setStar).toHaveBeenCalledTimes(1);
    expect(runtime.listInputs.at(-1).starMode).toBe("assignee"); expect(runtime.listInputs.at(-1)).not.toHaveProperty("starUserId");
    const input = runtime.setStar.mock.calls[0][0];
    await act(async () => { finish({ customerId: 802, targetUserId: 7, isStarred: true, starRevision: 1, requestId: input.requestId, idempotent: false }); });
    expect(star(802).getAttribute("aria-busy")).toBe("false");
  });

  it("retries an unknown HTTP/network outcome with exactly the original frozen payload, never a new toggle", async () => {
    runtime.setStar.mockRejectedValueOnce(Object.assign(new Error("504 network error"), { data: { code: "TIMEOUT" } }));
    await render(); await click(star(802)); const frozen = runtime.setStar.mock.calls[0][0];
    expect(host.textContent).toContain("结果未知"); expect(star(802).getAttribute("aria-pressed")).toBe("false");
    await click(star()); expect(runtime.setStar).toHaveBeenCalledTimes(1);
    await click(button("重试原重点客户请求")); expect(runtime.setStar.mock.calls[1][0]).toEqual(frozen);
    expect(runtime.setStar.mock.calls[1][0]).toBe(frozen); expect(star(802).getAttribute("aria-pressed")).toBe("true");
  });

  it("clears a definitive error and refreshes/reselects on revision conflict rather than overwriting the current state", async () => {
    runtime.setStar.mockRejectedValueOnce(Object.assign(new Error("版本冲突"), { data: { code: "CONFLICT" } }));
    await render(); await click(star());
    expect(host.textContent).toContain("未覆盖最新状态"); expect(runtime.starContext).toHaveBeenCalledTimes(2);
    expect(runtime.utils.customer.list.invalidate).toHaveBeenCalledTimes(1); expect(runtime.setStar).toHaveBeenCalledTimes(1);
    runtime.rows = runtime.rows.map(item => ({ ...item, isStarred: false, starRevision: 9 })); await render();
    await click(star()); expect(runtime.setStar.mock.calls[1][0]).toMatchObject({ expectedRevision: 9, starred: true });
    expect(runtime.setStar.mock.calls[1][0].requestId).not.toBe(runtime.setStar.mock.calls[0][0].requestId);
    runtime.setStar.mockRejectedValueOnce(Object.assign(new Error("校验失败"), { data: { code: "BAD_REQUEST" } }));
    await click(star()); expect(host.textContent).toContain("重点客户操作失败"); expect(host.textContent).not.toContain("重试原重点客户请求");
  });

});

describe("pureUICustomerStars starred-only filter v22", () => {
  function filterStar() { return host.querySelector<HTMLButtonElement>('button[aria-label="仅看重点客户"]')!; }
  const applied = { keyword: " 已应用 ", grade: "A", stage: "quoted", scope: "all", assignedUserId: "8", due: "overdue", archived: true, starredOnly: false };
  const draft = { ...applied, keyword: "未应用草稿", grade: "B", stage: "following", due: "today", archived: false };
  function adminFilters() {
    runtime.canManageAll = true; runtime.members = [{ userId: 8, name: "合成负责人" }];
    runtime.remembered = { appliedFilters: applied, draftFilters: draft, page: 2 };
  }
  it("places the native grey/yellow toggle directly after search and intersects only the applied filters without submitting or clearing drafts", async () => {
    adminFilters(); await render();
    const group = host.querySelector(".customer-list-search-group")!;
    expect(group.children[0].classList.contains("customer-list-search")).toBe(true);
    expect(group.children[1]).toBe(filterStar()); expect(filterStar().getAttribute("type")).toBe("button");
    expect(filterStar().getAttribute("aria-pressed")).toBe("false");
    await click(filterStar());
    expect(runtime.listInputs.at(-1)).toMatchObject({ keyword: "已应用", grade: "A", stage: "quoted", scope: "all", assignedUserId: 8,
      due: "overdue", archived: true, starredOnly: true, starMode: "assignee", page: 1, pageSize: 20 });
    expect(host.querySelector<HTMLInputElement>(".customer-list-search")!.value).toBe("未应用草稿");
    expect(filterStar().getAttribute("aria-pressed")).toBe("true");
    expect(filterStar().title).toContain("保留其他条件");
    // The UI must not locally remove false rows: mocked server order/data is untouched.
    expect(tableRows().map(row => row.dataset.pageMemoryRow)).toEqual(["801", "802", "803"]);
    expect(runtime.setStar).not.toHaveBeenCalled();
    await click(button("下一页")); expect(runtime.listInputs.at(-1)).toMatchObject({ page: 2, starredOnly: true });
    await click(filterStar()); expect(runtime.listInputs.at(-1)).toMatchObject({ keyword: "已应用", grade: "A", stage: "quoted", due: "overdue", archived: true,
      scope: "all", starredOnly: false, page: 1, assignedUserId: 8 });
    expect(host.querySelector<HTMLInputElement>(".customer-list-search")!.value).toBe("未应用草稿");
  });
  it.each(["搜索", "Enter", "确定"])("retains true when applying later drafts with %s; collapse keeps both copies and reset clears only the filter not assignee semantics", async mode => {
    adminFilters(); runtime.targets.push({ userId: 8, name: "合成组员" }); await render();
    await click(filterStar()); await click(button("更多筛选")); await click(button("更多筛选")); await click(button("更多筛选"));
    if (mode === "Enter") await act(async () => { host.querySelector(".customer-list-search")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    else await click(button(mode));
    expect(runtime.listInputs.at(-1)).toMatchObject({ keyword: "未应用草稿", grade: "B", stage: "following", due: "today", archived: false,
      scope: "all", assignedUserId: 8, starredOnly: true, page: 1 });
    expect(runtime.listInputs.at(-1)).toMatchObject({ starMode: "assignee", assignedUserId: 8, starredOnly: true, page: 1 });
    await click(button("重置")); expect(runtime.listInputs.at(-1)).toMatchObject({ keyword: "", due: "all", archived: false, starredOnly: false,
      starMode: "assignee", scope: "all", page: 1 });
    expect(runtime.listInputs.at(-1)).not.toHaveProperty("assignedUserId");
    expect(button("重置").disabled).toBe(true);
  });
  it("treats legacy restored state without the field as false and reset remains available when only the star filter is active", async () => {
    runtime.remembered = { appliedFilters: { keyword: "", grade: "", stage: "", scope: "mine", assignedUserId: "", due: "all", archived: false } };
    await render(); expect(runtime.listInputs.at(-1).starredOnly).toBe(false); expect(filterStar().getAttribute("aria-pressed")).toBe("false");
    expect(button("重置").disabled).toBe(true); await click(filterStar()); expect(button("重置").disabled).toBe(false);
    await click(button("重置")); expect(runtime.listInputs.at(-1).starredOnly).toBe(false); expect(button("重置").disabled).toBe(true);
  });
  it("uses the current applied true predicate even if a separately restored old draft has no starredOnly field", async () => {
    adminFilters(); runtime.remembered = { appliedFilters: { ...applied, starredOnly: true }, draftFilters: { ...draft, starredOnly: undefined } };
    await render(); await click(button("搜索"));
    expect(runtime.listInputs.at(-1)).toMatchObject({ starredOnly: true, keyword: "未应用草稿", grade: "B", stage: "following" });
  });
  it("does not render an old enterprise result or consume its total when account/enterprise switches, even if a late list result has the same target id", async () => {
    await render(); await click(filterStar()); const previousKey = JSON.stringify(runtime.listInputs.at(-1));
    runtime.enterpriseId = 32; runtime.actorId = 8; runtime.targets = [{ userId: 8, name: "新员工" }];
    await render();
    expect(JSON.stringify(runtime.listInputs.at(-1))).not.toBe(previousKey); expect(host.querySelector("table")).toBeNull();
    expect(runtime.setStar).not.toHaveBeenCalled();
    runtime.rows = [row(805, { enterpriseId: 32, assignedUserId: 8, starUserId: 8 })]; await render(); expect(tableRows()).toHaveLength(1);
  });
  it("pauses true-filter reads until star target authority is ready and keeps the predicate/explicit target after a failed read", async () => {
    let finish!: (value: unknown) => void;
    runtime.starContext.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render(); await click(filterStar());
    expect(runtime.listOptions.at(-1).enabled).toBe(false); expect(host.querySelector("table")).toBeNull();
    expect(host.textContent).toContain("仅看重点客户筛选已保留");
    expect(runtime.listInputs.at(-1)).toMatchObject({ starredOnly: true, starMode: "assignee" });
    await act(async () => { finish({ enterpriseId: 31, actorUserId: 7, targets: runtime.targets }); });
    expect(runtime.listOptions.at(-1).enabled).toBe(true); expect(tableRows()).toHaveLength(3);
    runtime.starContext.mockRejectedValueOnce(new Error("synthetic unavailable")); await click(button("更多筛选"));
    runtime.authVersion = "star-read-failed-v22"; await render();
    expect(runtime.listOptions.at(-1).enabled).toBe(false); expect(host.querySelector("table")).toBeNull();
    expect(runtime.listInputs.at(-1)).toMatchObject({ starredOnly: true, starMode: "assignee" });
    expect(host.textContent).toContain("重点客户权限读取失败");
    await click(filterStar()); expect(runtime.listInputs.at(-1).starredOnly).toBe(false);
    expect(runtime.listOptions.at(-1).enabled).toBe(true); expect(tableRows()).toHaveLength(3);
  });
  it("exports only direct row/search stars without any delegation entry or window", async () => {
    runtime.canManageAll = true; runtime.targets.push({ userId: 8, name: "合成组员" }); await render(); await click(filterStar());
    expect(host.querySelector('select[aria-label="星标归属"]')).toBeNull();
    expect(host.textContent).not.toContain("替员工标星"); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(filterStar().getAttribute("aria-pressed")).toBe("true");
    if (process.env.CUSTOMER_V22_FIXTURE_PATH) fixture(process.env.CUSTOMER_V22_FIXTURE_PATH);
  });
});

describe("direct current-assignee focus stars", () => {
  const filters = { keyword: "", grade: "", stage: "", scope: "all", assignedUserId: "", due: "all", archived: false, starredOnly: false };
  function leaderRows() {
    runtime.canReadAll = true; runtime.canManageAll = false;
    runtime.targets = [{ userId: 7, name: "组长A" }, { userId: 8, name: "员工B" }, { userId: 9, name: "员工C" }];
    runtime.rows = [row(801, { assignedUserId: 7, starUserId: 7, isStarred: true, starRevision: 2 }),
      row(802, { assignedUserId: 8, starUserId: 8, isStarred: false, starRevision: 17 }),
      row(803, { assignedUserId: 9, starUserId: 9, isStarred: true, starRevision: 5 })];
    runtime.remembered = { appliedFilters: filters, draftFilters: filters };
  }
  it("shows A/B/C actual differing states and directly writes B with B revision, never self", async () => {
    leaderRows(); await render();
    expect(runtime.canManageAll).toBe(false);
    expect(host.querySelector('[aria-label="客户范围"]')?.textContent).toBe("授权组员客户");
    expect([801, 802, 803].map(id => star(id).getAttribute("aria-pressed"))).toEqual(["true", "false", "true"]);
    expect(star(802).disabled).toBe(false);
    expect(runtime.listInputs.at(-1)).toMatchObject({ scope: "all", starMode: "assignee", expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(runtime.listInputs.at(-1)).not.toHaveProperty("starUserId");
    await click(star(802)); expect(runtime.setStar.mock.calls[0][0]).toMatchObject({ customerId: 802, targetUserId: 8, expectedRevision: 17, starred: true, starMode: "assignee" });
    expect(star(802).getAttribute("aria-pressed")).toBe("true");
    expect(runtime.rows[1].assignedUserId).toBe(8); expect(runtime.rows[0].starRevision).toBe(2); expect(runtime.rows[2].starRevision).toBe(5);
    expect(host.textContent).not.toContain("替员工标星"); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(runtime.starList).not.toHaveBeenCalled();
  });
  it("employee B reads the same persisted B state and cancels with matching revision", async () => {
    leaderRows(); await render(); await click(star(802)); const actualB = { ...runtime.rows[1] };
    runtime.actorId = 8; runtime.canReadAll = false; runtime.targets = [{ userId: 8, name: "员工B" }]; runtime.rows = [actualB]; await render();
    expect(star(802).getAttribute("aria-pressed")).toBe("true"); expect(star(802).disabled).toBe(false);
    expect(runtime.listInputs.at(-1)).toMatchObject({ scope: "mine", starMode: "assignee", expectedActorUserId: 8 });
    await click(star(802)); expect(runtime.setStar.mock.calls[1][0]).toMatchObject({ targetUserId: 8, expectedRevision: 18, starred: false });
  });
  it("offers read-only authorized owner filters without calling them enterprise-write permissions", async () => {
    leaderRows(); runtime.remembered.moreFiltersOpen = true; await render();
    expect(host.querySelector('[aria-label="按负责人筛选"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="客户范围"]')?.textContent).not.toContain("全企业");
    expect(runtime.members).toEqual([]); expect(runtime.setStar).not.toHaveBeenCalled();
    expect(host.querySelector('.customer-list-table-scroll')?.getAttribute("data-page-memory-scroll")).toBe("customer-list-table");
    expect(tableRows().map(item => item.dataset.pageMemoryRow)).toEqual(["801", "802", "803"]);
  });
  it("nonleader's stale employee row is disabled instead of silently writing self even with admin label", async () => {
    runtime.canManageAll = true;
    runtime.rows = [row(802, { assignedUserId: 8, starUserId: 8, canSetStar: false })]; await render();
    expect(star(802).disabled).toBe(true); await click(star(802)); expect(runtime.setStar).not.toHaveBeenCalled();
    expect(star(802).title).toContain("不在合法重点标记范围");
  });
  it.each([{ assignedUserId: 0, starUserId: null }, { assignedUserId: 8, starUserId: 8, canSetStar: false }, { assignedUserId: 7, starUserId: 7, starRevision: undefined }])("missing/invalid/unavailable assignee metadata fails closed: %j", async changes => {
    runtime.rows = [row(802, changes)]; await render();
    expect(star(802).disabled).toBe(true); await click(star(802)); expect(runtime.setStar).not.toHaveBeenCalled();
  });
  it("does not consume an old self-projected star row as current employee metadata", async () => {
    leaderRows(); runtime.rows[1] = { ...runtime.rows[1], starUserId: 7, isStarred: true, starRevision: 99 }; await render();
    expect(host.querySelector("table")).toBeNull(); expect(runtime.setStar).not.toHaveBeenCalled();
  });
  it("delegated unknown outcome retries the identical complete command and never toggles another row", async () => {
    leaderRows(); runtime.setStar.mockRejectedValueOnce(Object.assign(new Error("network timeout"), { data: { code: "TIMEOUT" } })); await render();
    await click(star(802)); const frozen = runtime.setStar.mock.calls[0][0];
    expect(frozen).toMatchObject({ customerId: 802, targetUserId: 8, starMode: "assignee", expectedRevision: 17, expectedActorUserId: 7, expectedEnterpriseId: 31 });
    expect(host.textContent).toContain("结果未知"); await click(star(803)); expect(runtime.setStar).toHaveBeenCalledTimes(1);
    await click(button("重试原重点客户请求")); expect(runtime.setStar.mock.calls[1][0]).toBe(frozen);
    expect(star(802).getAttribute("aria-pressed")).toBe("true"); expect(star(803).getAttribute("aria-pressed")).toBe("true");
  });
  it("assignment changes fence a late receipt and prohibit retry against the old employee", async () => {
    leaderRows(); let finish!: (value: unknown) => void;
    runtime.setStar.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render(); await click(star(802));
    const command = runtime.setStar.mock.calls[0][0]; const signal = runtime.setStar.mock.calls[0][1].signal;
    runtime.rows[1] = row(802, { assignedUserId: 9, starUserId: 9, isStarred: false, starRevision: 3 }); await render();
    await act(async () => { finish({ customerId: 802, targetUserId: 8, requestId: command.requestId, isStarred: true, starRevision: 18, idempotent: false }); });
    expect(runtime.utils.customer.list.invalidate).not.toHaveBeenCalled(); expect(star(802).getAttribute("aria-pressed")).toBe("false");
    expect(signal.aborted).toBe(true); expect(host.textContent).not.toContain("重试原重点客户请求");
  });
  it("revocation clears unknown delegated command and does not fallback self", async () => {
    leaderRows(); runtime.setStar.mockRejectedValueOnce(Object.assign(new Error("timeout"), { data: { code: "TIMEOUT" } })); await render(); await click(star(802));
    runtime.targets = [{ userId: 7, name: "A" }]; runtime.authVersion = "revoked-assignee"; runtime.canReadAll = false;
    runtime.rows = [row(801)]; await render();
    expect(host.textContent).not.toContain("重试原重点客户请求"); expect(runtime.listInputs.at(-1)).toMatchObject({ scope: "mine", starMode: "assignee" });
    expect(runtime.setStar).toHaveBeenCalledTimes(1);
  });
  it("same enterprise account switch has a different list cache key and late receipt cannot invalidate B's current list", async () => {
    leaderRows(); let finish!: (value: unknown) => void;
    runtime.setStar.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render(); await click(star(802));
    const original = runtime.listInputs.at(-1); const command = runtime.setStar.mock.calls[0][0];
    runtime.actorId = 8; runtime.canReadAll = false; runtime.targets = [{ userId: 8, name: "B" }]; runtime.rows = [runtime.rows[1]]; await render();
    expect(runtime.listInputs.at(-1).expectedActorUserId).toBe(8); expect(runtime.listInputs.at(-1)).not.toEqual(original);
    await act(async () => { finish({ customerId: 802, targetUserId: 8, requestId: command.requestId, isStarred: true, starRevision: 18, idempotent: false }); });
    expect(runtime.utils.customer.list.invalidate).not.toHaveBeenCalled(); expect(star(802).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("authorized read-scope entry", () => {
  it("a non-enterprise leader can choose authorized employee customers through the real scope control", async () => {
    runtime.canReadAll = true; runtime.canManageAll = false;
    runtime.targets.push({ userId: 8, name: "员工B" });
    await render(); expect(runtime.listInputs.at(-1).scope).toBe("mine");
    const oldScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    try {
      const control = host.querySelector<HTMLButtonElement>('[aria-label="客户范围"]')!;
      await act(async () => { control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(item => item.textContent?.includes("授权组员客户"))!;
      expect(option).toBeDefined(); expect(document.body.textContent).not.toContain("替员工标星");
      await act(async () => { option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      expect(runtime.listInputs.at(-1)).toMatchObject({ scope: "all", starMode: "assignee", page: 1 });
      expect(runtime.canManageAll).toBe(false); expect(runtime.setStar).not.toHaveBeenCalled();
    } finally { HTMLElement.prototype.scrollIntoView = oldScroll; }
  });
});
