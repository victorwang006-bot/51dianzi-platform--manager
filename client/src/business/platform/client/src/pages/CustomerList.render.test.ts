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
  listError: false, listRefetch: vi.fn(), createFormProps: null as any,
  listOptions: [] as any[],
  contactSummaryResult: null as any, contactSummaryRequests: [] as any[],
  remembered: {} as Record<string, unknown>,
  canManageAll: false, canReadAll: false, members: [] as { userId: number; name: string }[],
  canReadEnterprise: undefined as boolean | undefined, canReadTeam: undefined as boolean | undefined,
  teams: null as { teamId: number; name: string; members: { userId: number; name: string }[] }[] | null,
  defaultTeamId: null as number | null,
  identityReady: true, restoreCalls: [] as boolean[],
  unreadIds: [] as number[], unreadAvailable: true, unreadError: null as Error | null,
  unreadOptions: [] as any[], rowsOptions: [] as any[], unreadRowIds: [] as number[], unreadRetry: vi.fn(),
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
vi.mock("../components/customers/CustomerCreateForm", () => ({ CustomerCreateForm: (props: any) => { runtime.createFormProps = props; return null; } }));
vi.mock("../components/customerDemands/CustomerDemandDialog", () => ({ CustomerDemandDialog: ({ customer }: any) => React.createElement("div", { "data-testid": "synthetic-demand-open" }, customer.name) }));
vi.mock("../../../../../lib/adminNewInformation", () => ({
  useAdminNewInformationContextRows: (options: any) => {
    runtime.rowsOptions.push(options);
    return { query: { isError: false, refetch: vi.fn() }, getRow: (ref: string) => ({ isNew: runtime.unreadRowIds.includes(Number(ref.split(":")[1])), ref: () => undefined }) };
  },
  useAdminNewInformationContextUnreadRefs: (options: any) => {
    runtime.unreadOptions.push(options);
    const available = options.enabled && options.listReady && runtime.unreadAvailable && !runtime.unreadError;
    return { available, customerIds: available ? runtime.unreadIds : undefined, error: runtime.unreadError,
      query: { isError: Boolean(runtime.unreadError) }, retry: runtime.unreadRetry };
  },
  useAdminNewInformationRowContext: () => undefined,
}));
vi.mock("../../../../api/business-auth", () => ({ useAuth: () => ({ user: { id: runtime.actorId }, loading: false, isAuthenticated: true }) }));
vi.mock("../../../../api/business-enterprise-session", () => ({ useOptionalEnterpriseSession: () => ({ activeEnterprise: { enterpriseId: runtime.enterpriseId, memberStatus: "active", accessStatus: "enabled" } }) }));
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => ({
  storageScope: `synthetic:${runtime.actorId}:${runtime.enterpriseId}`,
  merchantId: 30061, staffPrincipal: { enterpriseId: runtime.enterpriseId, adminAccountId: 101 }, frontUser: { id: runtime.actorId },
  contextVerification: { state: "verified", identity: `synthetic:${runtime.actorId}:${runtime.enterpriseId}`, authorizationVersion: runtime.authVersion, readVersion: runtime.authVersion },
  officialInventoryPermissions: { read: true, write: true, note: true, authorizationVersion: runtime.authVersion },
  onAuthorizationError: runtime.authorizationError,
}) }));
vi.mock("../../../../api/business-trpc", () => ({ trpc: {
  customerDemand: { suggestPartNumbers: { useQuery: () => ({ data: [], isFetching: false, isError: false }) } },
  useUtils: () => runtime.utils,
  enterprise: { me: { useQuery: () => ({ data: { enterprise: { id: runtime.enterpriseId }, currentUserId: runtime.actorId, permissionKeys: ["inventory.manage"], member: { status: "active", permissionVersion: 1 } }, isError: runtime.enterpriseFailed, refetch: runtime.authorityRetry }) } },
  customer: {
    context: { useQuery: () => {
      const data = { actorUserId: runtime.actorId, canManageAll: runtime.canManageAll, canReadAll: runtime.canReadAll || runtime.canManageAll,
        canReadEnterprise: runtime.canReadEnterprise ?? runtime.canManageAll, canReadTeam: runtime.canReadTeam ?? (runtime.canReadAll && !runtime.canManageAll),
        teams: runtime.teams ?? [{ teamId: 173, name: "合成团队", members: runtime.targets }], defaultTeamId: runtime.defaultTeamId ?? 173, members: runtime.members };
      return { data, isSuccess: !runtime.customerContextError, isPending: false, isLoading: false, isError: runtime.customerContextError, refetch: vi.fn().mockResolvedValue({ data, isError: runtime.customerContextError }) };
    } },
    list: { useQuery: (input: any, options: any) => { runtime.listInputs.push(input); runtime.listOptions.push(options);
      const narrowed = input.customerIds ? runtime.rows.filter(row => input.customerIds.includes(row.id)) : undefined;
      return { data: { items: narrowed ?? (input.page === 1 ? runtime.rows : [{ ...runtime.rows[0], id: 804 }]), total: narrowed?.length ?? 40 }, isSuccess: !runtime.listPending && !runtime.listError, isPending: runtime.listPending, isFetching: runtime.listFetching, isError: runtime.listError, error: new Error("synthetic list error"), refetch: runtime.listRefetch }; } },
    contactsSummary: { useQuery: (input: any, options: any) => {
      runtime.contactSummaryRequests.push({ input, options });
      return runtime.contactSummaryResult ?? { isSuccess: true, isFetchedAfterMount: true, isPending: false, isFetching: false, isError: false, isPlaceholderData: false,
        data: { items: runtime.rows.map(row => ({ customerId: row.id, contactCount: row.id === 801 ? 8 : 1, primaryContact: { id: `synthetic-${row.id}`, legacy: false, name: row.contactName, methods: [{ type: "landline", value: row.phone }] } })) } };
    } },
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
  runtime.listError = false; runtime.listRefetch.mockReset(); runtime.createFormProps = null;
  runtime.listOptions = [];
  runtime.contactSummaryResult = null; runtime.contactSummaryRequests = [];
  runtime.remembered = {};
  runtime.canManageAll = false; runtime.canReadAll = false; runtime.members = [];
  runtime.canReadEnterprise = undefined; runtime.canReadTeam = undefined; runtime.teams = null; runtime.defaultTeamId = null;
  runtime.identityReady = true; runtime.restoreCalls = [];
  runtime.unreadIds = []; runtime.unreadAvailable = true; runtime.unreadError = null;
  runtime.unreadOptions = []; runtime.rowsOptions = []; runtime.unreadRowIds = []; runtime.unreadRetry.mockReset();
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
    channelInventory: { listTeamMaterials: { invalidate: vi.fn().mockResolvedValue(undefined) }, listChannels: { invalidate: vi.fn().mockResolvedValue(undefined) }, listUploadBatches: { invalidate: vi.fn().mockResolvedValue(undefined) } },
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
    postcss.parse(css).walkRules(rule => {
      expect(rule.selector.startsWith(".customer-list-page") ||
        (rule.selector.startsWith(".admin-workspace-shell__main:has(") &&
          rule.selector.includes(".customer-list-page") &&
          rule.selector.includes('[data-admin-navigation="current-location"]'))).toBe(true);
    });
    expect(css).toContain("min-width: 1304px"); expect(css).toContain("table-layout: fixed"); expect(css).toContain("right: var(--customer-list-actions-width)");
    expect(css).toContain("width: 168px"); expect(css).not.toContain("176px"); expect(css).not.toContain("col-followup"); expect(css).toContain("overflow-x: auto"); expect(css).toContain("overflow: visible");
    expect(css).toContain("flex-shrink: 0"); expect(css).toContain("width: 16px"); expect(css).toContain("fill: currentColor");
    expect(css).toContain("background: transparent"); expect(css).toContain("border: 0"); expect(css).toContain("font-family: inherit"); expect(css).toContain(":focus-visible");
    expect(css).not.toMatch(/!important|scale\(|zoom:/);
    postcss.parse(css).walkDecls(decl => {
      expect(decl.prop === "display" && decl.value === "contents").toBe(false);
    });
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
    // The protected importer now creates a real customer-bound upload batch
    // before row writes. Keep this test synthetic but provide that exact DTO.
    runtime.utils.client.channelInventory.createCustomerUploadBatch = { mutate: vi.fn().mockImplementation(async () => {
      runtime.context.mockResolvedValue({ customer: { ...runtime.rows[0] }, channel: { id: 411, revision: 1, active: true }, canUpload: true, disabledReason: null });
      return { id: 501, batchCode: "SYNTHETIC-BATCH", revision: 1, customerId: 801, channelId: 411 };
    }) };
    runtime.create.mockResolvedValue({ item: { id: 901, channelId: 411, uploadBatchId: 501 }, idempotent: false, channelId: 411, customerId: 801, uploadBatchId: 501 });
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
    expect(runtime.navigate).toHaveBeenLastCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=materials");
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
    await render(); await click(button("补全客户档案", tableRows()[1])); expect(runtime.navigate).toHaveBeenLastCalledWith("/customers/802?tab=company");
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
    const basic = host.querySelector('.d51-compact-list-toolbar__filters')!;
    const moreButton = button("更多筛选", basic);
    expect(moreButton.getAttribute("aria-controls")).toBe("customer-list-more-filters");
    expect(moreButton.getAttribute("aria-expanded")).toBe("false");
    expect(button("搜索", basic)).toBeDefined();
    await click(moreButton);
    const expanded = host.querySelector('#customer-list-more-filters[aria-label="更多筛选条件"]')!;
    expect(expanded.closest('.d51-compact-list-toolbar')).toBe(basic.closest('.d51-compact-list-toolbar'));
    expect(expanded.parentElement?.className).toBe('d51-compact-list-toolbar__extra');
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
    await click(host.querySelector(".customer-list-name")!); expect(runtime.navigate).toHaveBeenLastCalledWith("/customers/801?tab=overview");
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
  const filters = { keyword: "", grade: "", stage: "", scope: "team", teamId: "173", assignedUserId: "", due: "all", archived: false, starredOnly: false };
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
    expect(host.querySelector('[aria-label="客户范围"]')?.textContent).toBe("合成团队");
    expect([801, 802, 803].map(id => star(id).getAttribute("aria-pressed"))).toEqual(["true", "false", "true"]);
    expect(star(802).disabled).toBe(false);
    expect(runtime.listInputs.at(-1)).toMatchObject({ scope: "team", teamId: 173, starMode: "assignee", expectedEnterpriseId: 31, expectedActorUserId: 7 });
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
    expect(runtime.listOptions.at(-1).enabled).toBe(false); await click(button("查看我负责的客户"));
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
    expect(runtime.listOptions.at(-1).enabled).toBe(false); await click(button("查看我负责的客户"));
    expect(host.textContent).not.toContain("重试原重点客户请求"); expect(runtime.listInputs.at(-1)).toMatchObject({ scope: "mine", starMode: "assignee" });
    expect(runtime.setStar).toHaveBeenCalledTimes(1);
  });
  it("same enterprise account switch has a different list cache key and late receipt cannot invalidate B's current list", async () => {
    leaderRows(); let finish!: (value: unknown) => void;
    runtime.setStar.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render(); await click(star(802));
    const original = runtime.listInputs.at(-1); const command = runtime.setStar.mock.calls[0][0];
    runtime.actorId = 8; runtime.canReadAll = false; runtime.targets = [{ userId: 8, name: "B" }]; runtime.rows = [runtime.rows[1]]; await render();
    expect(runtime.listInputs.at(-1).expectedActorUserId).toBe(8); expect(runtime.listInputs.at(-1)).not.toEqual(original);
    expect(runtime.listOptions.at(-1).enabled).toBe(false); await click(button("查看我负责的客户"));
    await act(async () => { finish({ customerId: 802, targetUserId: 8, requestId: command.requestId, isStarred: true, starRevision: 18, idempotent: false }); });
    expect(runtime.utils.customer.list.invalidate).not.toHaveBeenCalled(); expect(star(802).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("authorized read-scope entry", () => {
  it("a non-enterprise leader can choose authorized employee customers through the real scope control", async () => {
    runtime.canReadAll = true; runtime.canManageAll = false;
    runtime.targets.push({ userId: 8, name: "员工B" });
    runtime.teams = [{ teamId: 173, name: "当前合成团队", members: runtime.targets }, { teamId: 284, name: "其他合成团队", members: [{ userId: 8, name: "员工B" }] }];
    await render(); expect(runtime.listInputs.at(-1)).toMatchObject({ scope: "team", teamId: 173 });
    const oldScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    try {
      const control = host.querySelector<HTMLButtonElement>('[aria-label="客户范围"]')!;
      await act(async () => { control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(item => item.textContent?.includes("其他合成团队"))!;
      expect(option).toBeDefined(); expect(document.body.textContent).not.toContain("替员工标星");
      await act(async () => { option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
      expect(runtime.listInputs.at(-1)).toMatchObject({ scope: "team", teamId: 284, starMode: "assignee", page: 1 });
      expect(runtime.canManageAll).toBe(false); expect(runtime.setStar).not.toHaveBeenCalled();
    } finally { HTMLElement.prototype.scrollIntoView = oldScroll; }
  });
});

describe("actual CustomerList updated-date filters", () => {
  const legacyFilters = { keyword: "", grade: "", stage: "", scope: "mine", assignedUserId: "", due: "all", archived: false, starredOnly: false };
  const appliedDates = { updatedFrom: "2026-10-01", updatedTo: "2026-10-31" };
  const draftDates = { updatedFrom: "2026-11-01", updatedTo: "2026-11-16" };
  function dateInput(side: "开始" | "结束") {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="更新时间${side}日期"]`);
    if (!input) throw new Error(`missing date input: ${side}`);
    return input;
  }
  async function changeDate(side: "开始" | "结束", value: string) {
    const input = dateInput(side);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function enter(element: Element) {
    await act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  }
  function noDates(input: unknown) {
    expect(input).not.toHaveProperty("updatedFrom");
    expect(input).not.toHaveProperty("updatedTo");
  }
  function restoredDates() {
    runtime.remembered = { appliedFilters: { ...legacyFilters, ...appliedDates }, draftFilters: { ...legacyFilters, ...draftDates }, moreFiltersOpen: true, page: 2 };
  }

  it("places one unobtrusive native date group after stage/owner/archive and before the original confirm button", async () => {
    runtime.canManageAll = true;
    runtime.remembered = { appliedFilters: { ...legacyFilters, scope: "all" }, draftFilters: { ...legacyFilters, scope: "all" } };
    await render(); expect(host.querySelector('input[type="date"]')).toBeNull();
    await click(button("更多筛选"));
    const expanded = host.querySelector("#customer-list-more-filters")!;
    const dateGroup = expanded.querySelector('.customer-list-updated-dates[role="group"][aria-label="更新时间"]')!;
    expect(Array.from(expanded.children)).toEqual([
      expanded.querySelector('[aria-label="按客户阶段筛选"]'),
      expanded.querySelector('[aria-label="按负责人筛选"]'),
      expanded.querySelector('[aria-label="按归档状态筛选"]'),
      dateGroup, button("确定", expanded),
    ]);
    expect(dateGroup.querySelector(".customer-list-caption")?.textContent).toBe("更新时间");
    expect(dateGroup.querySelectorAll('input[type="date"]')).toHaveLength(2);
    for (const side of ["开始", "结束"] as const) {
      expect(dateInput(side).type).toBe("date"); expect(dateInput(side).value).toBe("");
      expect(dateInput(side).classList.contains("customer-list-control")).toBe(true);
      expect(dateInput(side).getAttribute("aria-invalid")).toBeNull();
    }
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps edits and collapse/reopen as drafts without changing the applied query, page, summary or invalidation", async () => {
    runtime.remembered = { appliedFilters: { ...legacyFilters, ...appliedDates }, page: 2, moreFiltersOpen: true };
    await render(); const before = runtime.listInputs.at(-1); const summaryCalls = runtime.summary.mock.calls.length;
    await changeDate("开始", draftDates.updatedFrom); await changeDate("结束", draftDates.updatedTo);
    expect(runtime.listInputs.at(-1)).toBe(before); expect(before).toMatchObject({ ...appliedDates, page: 2 });
    await click(button("更多筛选")); expect(host.querySelector('input[type="date"]')).toBeNull();
    await click(button("更多筛选"));
    expect(dateInput("开始").value).toBe(draftDates.updatedFrom); expect(dateInput("结束").value).toBe(draftDates.updatedTo);
    expect(runtime.listInputs.at(-1)).toBe(before); expect(runtime.summary).toHaveBeenCalledTimes(summaryCalls);
    expect(runtime.utils.customer.list.invalidate).not.toHaveBeenCalled(); expect(runtime.setStar).not.toHaveBeenCalled();
  });

  it.each(["搜索", "确定", "搜索Enter", "开始Enter", "结束Enter"])("applies the same complete date draft with %s and returns to page one", async mode => {
    restoredDates();
    runtime.remembered.draftFilters = { ...legacyFilters, ...draftDates, keyword: "  日期客户  ", grade: "C", stage: "quoted", due: "today", archived: true };
    runtime.remembered.appliedFilters = { ...legacyFilters, ...appliedDates, starredOnly: true };
    await render(); expect(runtime.listInputs.at(-1)).toMatchObject({ ...appliedDates, page: 2, starredOnly: true });
    if (mode === "搜索Enter") await enter(host.querySelector(".customer-list-search")!);
    else if (mode === "开始Enter") await enter(dateInput("开始"));
    else if (mode === "结束Enter") await enter(dateInput("结束"));
    else await click(button(mode));
    expect(runtime.listInputs.at(-1)).toEqual({ keyword: "日期客户", grade: "C", stage: "quoted", ...draftDates,
      scope: "mine", starMode: "assignee", expectedEnterpriseId: 31, expectedActorUserId: 7,
      archived: true, due: "today", starredOnly: true, page: 1, pageSize: 20 });
    expect(dateInput("开始").value).toBe(draftDates.updatedFrom); expect(dateInput("结束").value).toBe(draftDates.updatedTo);
    expect(host.querySelector("#customer-list-date-error")).toBeNull();
  });

  it.each(["updatedFrom", "updatedTo"] as const)("allows a one-sided %s and omits the empty opposite field", async key => {
    runtime.remembered = { moreFiltersOpen: true, page: 2 };
    await render(); noDates(runtime.listInputs.at(-1));
    await changeDate(key === "updatedFrom" ? "开始" : "结束", "2026-11-16");
    noDates(runtime.listInputs.at(-1)); await click(button("确定"));
    expect(runtime.listInputs.at(-1)).toMatchObject({ [key]: "2026-11-16", page: 1 });
    expect(runtime.listInputs.at(-1)).not.toHaveProperty(key === "updatedFrom" ? "updatedTo" : "updatedFrom");
    expect(host.querySelector("#customer-list-date-error")).toBeNull();
  });

  it("applies clearing either or both dates only on submission, and reset remains available for applied dates", async () => {
    restoredDates(); runtime.remembered.draftFilters = { ...legacyFilters, ...appliedDates };
    await render(); const before = runtime.listInputs.at(-1);
    await changeDate("开始", ""); expect(runtime.listInputs.at(-1)).toBe(before);
    await click(button("搜索"));
    expect(runtime.listInputs.at(-1)).not.toHaveProperty("updatedFrom"); expect(runtime.listInputs.at(-1).updatedTo).toBe(appliedDates.updatedTo);
    const single = runtime.listInputs.at(-1);
    await changeDate("结束", ""); expect(runtime.listInputs.at(-1)).toBe(single); expect(button("重置").disabled).toBe(false);
    await click(button("确定")); noDates(runtime.listInputs.at(-1)); expect(button("重置").disabled).toBe(true);
  });

  it("resets both applied/draft dates and every condition while preserving all-company scope and original star semantics", async () => {
    runtime.canManageAll = true; runtime.targets.push({ userId: 8, name: "合成组员" });
    const filters = { ...legacyFilters, scope: "all", keyword: "客户", grade: "C", stage: "quoted", assignedUserId: "8", due: "overdue", archived: true, starredOnly: true };
    runtime.remembered = { appliedFilters: { ...filters, ...appliedDates }, draftFilters: { ...filters, ...draftDates }, page: 2, moreFiltersOpen: true };
    await render(); await click(button("重置"));
    expect(runtime.listInputs.at(-1)).toEqual({ keyword: "", scope: "all", starMode: "assignee", expectedEnterpriseId: 31, expectedActorUserId: 7,
      due: "all", archived: false, starredOnly: false, page: 1, pageSize: 20 });
    expect(dateInput("开始").value).toBe(""); expect(dateInput("结束").value).toBe(""); expect(button("重置").disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>(".customer-list-search")!.value).toBe("");
  });

  it("enables reset for date-only drafts and clears them without switching mine scope", async () => {
    runtime.remembered = { moreFiltersOpen: true }; await render(); expect(button("重置").disabled).toBe(true);
    await changeDate("开始", "2026-11-16"); expect(button("重置").disabled).toBe(false); noDates(runtime.listInputs.at(-1));
    await click(button("重置")); noDates(runtime.listInputs.at(-1)); expect(runtime.listInputs.at(-1).scope).toBe("mine");
    expect(dateInput("开始").value).toBe(""); expect(dateInput("结束").value).toBe(""); expect(button("重置").disabled).toBe(true);
  });

  it.each(["搜索", "确定", "搜索Enter", "开始Enter", "结束Enter"])("blocks a reversed range with %s without changing query/page or fetching a summary, then allows correction", async mode => {
    restoredDates(); runtime.remembered.draftFilters = { ...legacyFilters, keyword: "不得提交", updatedFrom: "2026-11-17", updatedTo: "2026-11-16" };
    await render(); const before = runtime.listInputs.at(-1); const summaryCalls = runtime.summary.mock.calls.length;
    if (mode === "搜索Enter") await enter(host.querySelector(".customer-list-search")!);
    else if (mode === "开始Enter") await enter(dateInput("开始"));
    else if (mode === "结束Enter") await enter(dateInput("结束"));
    else await click(button(mode));
    expect(runtime.listInputs.at(-1)).toBe(before); expect(before).toMatchObject({ ...appliedDates, keyword: "", page: 2 });
    expect(runtime.summary).toHaveBeenCalledTimes(summaryCalls); expect(runtime.utils.customer.list.invalidate).not.toHaveBeenCalled();
    const alert = host.querySelector('#customer-list-date-error[role="alert"]')!;
    expect(alert.textContent).toBe("更新时间开始日期不能晚于结束日期，请调整后再查询。");
    for (const side of ["开始", "结束"] as const) {
      expect(dateInput(side).getAttribute("aria-invalid")).toBe("true");
      expect(dateInput(side).getAttribute("aria-describedby")).toBe(alert.id);
    }
    await click(button("更多筛选")); expect(host.querySelector('#customer-list-date-error[role="alert"]')).not.toBeNull();
    await click(button("更多筛选")); await changeDate("开始", "2026-11-16");
    expect(host.querySelector("#customer-list-date-error")).toBeNull(); expect(runtime.listInputs.at(-1)).toBe(before);
    await click(button("搜索"));
    expect(runtime.listInputs.at(-1)).toMatchObject({ keyword: "不得提交", updatedFrom: "2026-11-16", updatedTo: "2026-11-16", page: 1 });
  });

  it("reset clears reversed drafts and their error without changing the chosen scope", async () => {
    restoredDates(); runtime.remembered.draftFilters = { ...legacyFilters, updatedFrom: "2026-11-17", updatedTo: "2026-11-16" };
    await render(); await click(button("确定")); expect(host.querySelector("#customer-list-date-error")).not.toBeNull();
    await click(button("重置")); noDates(runtime.listInputs.at(-1)); expect(host.querySelector("#customer-list-date-error")).toBeNull();
    expect(dateInput("开始").value).toBe(""); expect(dateInput("结束").value).toBe(""); expect(runtime.listInputs.at(-1).scope).toBe("mine");
  });

  it("restores legacy filter objects without new fields as empty controlled dates and preserves their complete original conditions", async () => {
    const old = { keyword: "  旧对象  ", grade: "B", stage: "quoted", scope: "mine", assignedUserId: "", due: "overdue", archived: true };
    runtime.remembered = { appliedFilters: old, draftFilters: old, moreFiltersOpen: true, page: 2 };
    await render(); noDates(runtime.listInputs.at(-1)); expect(dateInput("开始").value).toBe(""); expect(dateInput("结束").value).toBe("");
    await click(button("确定"));
    expect(runtime.listInputs.at(-1)).toEqual({ keyword: "旧对象", grade: "B", stage: "quoted", scope: "mine", starMode: "assignee",
      expectedEnterpriseId: 31, expectedActorUserId: 7, due: "overdue", archived: true, starredOnly: false, page: 1, pageSize: 20 });
    await click(button("重置")); noDates(runtime.listInputs.at(-1)); expect(button("重置").disabled).toBe(true);
  });

  it.each(["2026-02-29", "2026-11-31", "2026-1-01", "not-a-date", "0000-01-01", "0999-12-31", null, 0, false])("pauses invalid restored dates and rejects submission of %s without silently querying a broader range", async invalid => {
    runtime.remembered = { appliedFilters: { ...legacyFilters, updatedFrom: invalid }, draftFilters: { ...legacyFilters, updatedFrom: invalid, keyword: "不能应用" }, moreFiltersOpen: true, page: 2 };
    await render(); noDates(runtime.listInputs.at(-1)); const before = runtime.listInputs.at(-1);
    expect(runtime.listOptions.at(-1).enabled).toBe(false); expect(host.querySelector("table")).toBeNull();
    expect(host.textContent).not.toMatch(/共\s*40\s*条/); expect(runtime.restoreCalls).not.toContain(true);
    expect(runtime.summary).not.toHaveBeenCalled();
    await click(button("搜索")); expect(runtime.listInputs.at(-1)).toBe(before); expect(before.page).toBe(2);
    expect(host.querySelector('#customer-list-date-error[role="alert"]')?.textContent).toBe("请输入有效的更新时间日期（YYYY-MM-DD）。查询已暂停，请重置筛选或调整日期后重新查询。");
    expect(runtime.listOptions.at(-1).enabled).toBe(false);
    await click(button("重置")); expect(runtime.listOptions.at(-1).enabled).toBe(true); noDates(runtime.listInputs.at(-1));
    expect(host.querySelector("#customer-list-date-error")).toBeNull(); expect(tableRows()).toHaveLength(3);
  });

  it("rejects the maximum end date whose inclusive day would overflow the server next-day boundary", async () => {
    const invalid = { ...legacyFilters, updatedTo: "9999-12-31" };
    runtime.remembered = { appliedFilters: invalid, draftFilters: invalid, moreFiltersOpen: true };
    await render(); expect(runtime.listOptions.at(-1).enabled).toBe(false); expect(host.querySelector("table")).toBeNull();
    const before = runtime.listInputs.at(-1); await click(button("确定")); expect(runtime.listInputs.at(-1)).toBe(before);
    expect(host.querySelector("#customer-list-date-error")?.textContent).toContain("结束日期不能晚于9999-12-30");
    await click(button("重置")); expect(runtime.listOptions.at(-1).enabled).toBe(true); noDates(runtime.listInputs.at(-1));
  });

  it("uses server-consistent input limits and submits the representable date-domain boundaries", async () => {
    runtime.remembered = { moreFiltersOpen: true }; await render();
    expect(dateInput("开始").min).toBe("1000-01-01"); expect(dateInput("结束").min).toBe("1000-01-01");
    expect(dateInput("开始").max).toBe("9999-12-31"); expect(dateInput("结束").max).toBe("9999-12-30");
    await changeDate("开始", "1000-01-01"); await changeDate("结束", "9999-12-30"); await click(button("确定"));
    expect(runtime.listInputs.at(-1)).toMatchObject({ updatedFrom: "1000-01-01", updatedTo: "9999-12-30" });
    expect(host.querySelector("#customer-list-date-error")).toBeNull();
  });

  it("pauses a reversed applied memory range even when collapsed, then resumes only after a valid draft is submitted", async () => {
    const reversed = { ...legacyFilters, updatedFrom: "2026-11-17", updatedTo: "2026-11-16" };
    runtime.remembered = { appliedFilters: reversed, draftFilters: reversed, page: 2 };
    await render(); expect(host.querySelector('input[type="date"]')).toBeNull();
    expect(runtime.listOptions.at(-1).enabled).toBe(false); expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector('#customer-list-date-error[role="alert"]')?.textContent).toBe("更新时间开始日期不能晚于结束日期，请调整后再查询。查询已暂停，请重置筛选或调整日期后重新查询。");
    expect(runtime.restoreCalls).not.toContain(true); expect(runtime.summary).not.toHaveBeenCalled();
    await click(button("更多筛选")); await changeDate("开始", "2026-11-01");
    expect(runtime.listOptions.at(-1).enabled).toBe(false); expect(host.querySelector("#customer-list-date-error")?.textContent).toContain("查询已暂停");
    await click(button("确定")); expect(runtime.listOptions.at(-1).enabled).toBe(true);
    expect(runtime.listInputs.at(-1)).toMatchObject({ updatedFrom: "2026-11-01", updatedTo: "2026-11-16", page: 1 });
    expect(host.querySelector("#customer-list-date-error")).toBeNull(); expect(tableRows()).toHaveLength(3);
  });

  it("does not let a synthetic customer-save callback fetch a wider list while restored dates are invalid", async () => {
    runtime.remembered = { appliedFilters: { ...legacyFilters, updatedFrom: "2026-11-17", updatedTo: "2026-11-16" } };
    runtime.utils.customer.list.fetch = vi.fn().mockResolvedValue({ items: runtime.rows });
    await render(); await click(button("录入客户")); expect(runtime.createFormProps).not.toBeNull();
    await act(async () => { runtime.createFormProps.onSaved({ id: 899, mode: "close" }); });
    expect(runtime.utils.customer.list.fetch).not.toHaveBeenCalled(); expect(runtime.utils.customer.list.invalidate).not.toHaveBeenCalled();
    expect(runtime.listOptions.at(-1).enabled).toBe(false); expect(host.querySelector("#customer-list-date-error")?.textContent).toContain("查询已暂停");
    expect(button("录入客户").getAttribute("aria-expanded")).toBe("false");
  });

  it("does not expose a cached broad-query error retry while invalid memory dates pause the list", async () => {
    runtime.remembered = { appliedFilters: { ...legacyFilters, updatedFrom: "2026-11-31" } };
    runtime.listError = true; await render();
    expect(runtime.listOptions.at(-1).enabled).toBe(false); expect(host.textContent).not.toContain("synthetic list error");
    expect(Array.from(host.querySelectorAll("button")).some(element => element.textContent?.trim() === "重试")).toBe(false);
    expect(runtime.listRefetch).not.toHaveBeenCalled(); expect(host.querySelector("table")).toBeNull();
    expect(host.querySelector("#customer-list-date-error")?.textContent).toContain("查询已暂停");
  });

  it("passes a valid leap day and same-day boundaries unchanged, never browser-local timestamps", async () => {
    runtime.remembered = { moreFiltersOpen: true }; await render();
    await changeDate("开始", "2024-02-29"); await changeDate("结束", "2024-02-29"); await click(button("确定"));
    expect(runtime.listInputs.at(-1)).toMatchObject({ updatedFrom: "2024-02-29", updatedTo: "2024-02-29" });
    expect(host.querySelector("#customer-list-date-error")).toBeNull();
  });

  it("keeps applied dates across page/star/scope permission changes without promoting date drafts or changing identity guards", async () => {
    restoredDates(); runtime.canManageAll = true;
    runtime.members = [{ userId: 8, name: "合成负责人" }];
    runtime.remembered.appliedFilters = { ...legacyFilters, ...appliedDates, scope: "all", assignedUserId: "8" };
    runtime.remembered.draftFilters = { ...legacyFilters, ...draftDates, scope: "all", assignedUserId: "8" };
    await render(); await click(button("上一页"));
    expect(runtime.listInputs.at(-1)).toMatchObject({ ...appliedDates, scope: "all", assignedUserId: 8, page: 1 });
    await click(host.querySelector('button[aria-label="仅看重点客户"]')!);
    expect(runtime.listInputs.at(-1)).toMatchObject({ ...appliedDates, starredOnly: true, page: 1, starMode: "assignee" });
    expect(dateInput("开始").value).toBe(draftDates.updatedFrom);
    runtime.canManageAll = false; await render();
    expect(runtime.listOptions.at(-1).enabled).toBe(false); expect(runtime.listInputs.at(-1).scope).toBe("all");
    await click(button("查看我负责的客户"));
    expect(runtime.listInputs.at(-1)).toMatchObject({ ...appliedDates, scope: "mine", starredOnly: true, expectedEnterpriseId: 31, expectedActorUserId: 7 });
    expect(runtime.listInputs.at(-1)).not.toHaveProperty("assignedUserId"); expect(dateInput("结束").value).toBe(draftDates.updatedTo);
    expect(runtime.setStar).not.toHaveBeenCalled();
  });

  it("uses only local compact control geometry and allows the date group to wrap at narrow widths", () => {
    const parsed = postcss.parse(readFileSync("client/src/business/platform/client/src/pages/CustomerList.css", "utf8"));
    const declarations = (selector: string) => {
      const result: Record<string, string> = {};
      parsed.walkRules(rule => { if (rule.selector === selector) rule.walkDecls(decl => { result[decl.prop] = decl.value; }); });
      return result;
    };
    expect(declarations(".customer-list-page .customer-list-updated-dates")).toEqual({ display: "flex", "align-items": "center", "flex-wrap": "wrap", "min-width": "0", "max-width": "100%", gap: "6px" });
    expect(declarations(".customer-list-page .customer-list-date-input")).toEqual({ flex: "0 0 136px", width: "136px", "min-width": "0", "max-width": "100%", "padding-inline": "8px" });
    expect(declarations(".customer-list-page .customer-list-control")).toMatchObject({ height: "var(--admin-content-control-height, 32px)", "font-size": "var(--admin-content-font-body, 12px)", "border-radius": "6px" });
  });
});


describe("CustomerList contact completeness badges", () => {
  const primary = { id: "synthetic-primary", name: "合成微信主联系人", legacy: false, methods: [{ type: "wechat", value: "synthetic_wechat_only" }] };
  function result(primaryContact: any, overrides: any = {}, customerId = 801) {
    return { isSuccess: true, isFetchedAfterMount: true, isPending: false, isFetching: false, isError: false, isPlaceholderData: false,
      data: { items: [{ customerId, contactCount: primaryContact ? 1 : 0, primaryContact }] }, ...overrides };
  }
  it("does not mark a verified WeChat-only customer with empty old phone/name incomplete", async () => {
    runtime.rows = [row(801, { phone: "", contactName: "" })]; runtime.contactSummaryResult = result(primary);
    await render();
    expect(tableRows()[0].textContent).not.toContain("待补全");
    expect(tableRows()[0].textContent).toContain("微信：synthetic_wechat_only");
    expect(runtime.rows[0].phone).toBe("");
    expect(runtime.contactSummaryRequests.at(-1).input).toEqual({ customerIds: [801], expectedActorUserId: 7, expectedEnterpriseId: 31 });
    expect(runtime.contactSummaryRequests.at(-1).options).toMatchObject({ enabled: true, placeholderData: undefined, retry: false });
  });
  it.each([null, { ...primary, name: " " }, { ...primary, methods: [] }])("marks confirmed missing primary/name/methods incomplete, regardless of old valid phone", async primaryContact => {
    runtime.rows = [row(801)]; runtime.contactSummaryResult = result(primaryContact);
    await render(); expect(tableRows()[0].textContent).toContain("待补全");
  });
  it.each([{ isFetchedAfterMount: false }, { isPlaceholderData: true }, { isError: true }, { isPending: true }, { isFetching: true }, { isSuccess: false }])("does not derive a completion badge from an unverified query %j", async overrides => {
    runtime.rows = [row(801, { phone: "", contactName: "" })]; runtime.contactSummaryResult = result(null, overrides);
    await render(); expect(tableRows()[0].textContent).not.toContain("待补全");
    expect(tableRows()[0].textContent).not.toContain("已完整");
  });
  it("ignores old-page/missing summary rows rather than treating them as null or falling back", async () => {
    runtime.rows = [row(801, { phone: "", contactName: "" })]; runtime.contactSummaryResult = result(null, {}, 999);
    await render(); expect(tableRows()[0].textContent).not.toContain("待补全");
    runtime.contactSummaryResult = result(null, { data: { items: [] } });
    await render(); expect(tableRows()[0].textContent).not.toContain("待补全");
  });
  it("can establish missing customer name without a ready contacts summary", async () => {
    runtime.rows = [row(801, { name: " " })]; runtime.contactSummaryResult = result(null, { isPending: true });
    await render(); expect(tableRows()[0].textContent).toContain("待补全");
  });
});

describe("CustomerList authorized unread filter", () => {
  function unreadToggle() { return host.querySelector<HTMLInputElement>('.customer-list-unread-filter input')!; }
  it("preserves server order, shows explicit unread and light-row flag, and never enables visible acknowledgement", async () => {
    runtime.unreadRowIds = [802]; await render();
    expect(tableRows().map(row => row.dataset.pageMemoryRow)).toEqual(["801", "802", "803"]);
    expect(tableRows()[1].dataset.customerUnread).toBe("true");
    expect(tableRows()[1].querySelector('[data-admin-new-information="row"]')?.textContent).toBe("未读");
    expect(runtime.rowsOptions.at(-1)).toMatchObject({ module: "customers", scope: "30061", acknowledgeOnVisible: false, retainUnreadWhileVisible: false, expectedAccountKey: 101 });
    expect(runtime.unreadOptions.at(-1).enabled).toBe(false);
  });
  it("sends the FULL unread set before business pagination and intersects only applied search/grade/owner/star/date filters", async () => {
    runtime.canManageAll = true; runtime.members = [{ userId: 7, name: "合成负责人" }];
    runtime.unreadIds = [801, 802, 803, 804, 805];
    const filters = { keyword: " 已应用 ", grade: "B", stage: "following", scope: "all", assignedUserId: "7", due: "today", archived: false, starredOnly: true, updatedFrom: "2026-11-01", updatedTo: "2026-11-20" };
    runtime.remembered = { appliedFilters: filters, draftFilters: { ...filters, keyword: "未应用草稿" }, page: 2 };
    await render(); await click(unreadToggle());
    expect(runtime.listInputs.at(-1)).toMatchObject({ customerIds: [801, 802, 803, 804, 805], page: 1, pageSize: 20,
      keyword: "已应用", grade: "B", stage: "following", scope: "all", assignedUserId: 7, due: "today", starredOnly: true,
      updatedFrom: "2026-11-01", updatedTo: "2026-11-20" });
    expect(runtime.listOptions.at(-1).enabled).toBe(true); expect(runtime.unreadOptions.at(-1)).toMatchObject({ enabled: true, listReady: true });
    expect(host.querySelector<HTMLInputElement>(".customer-list-search")!.value).toBe("未应用草稿");
    await click(button("搜索")); expect(runtime.listInputs.at(-1).customerIds).toEqual(runtime.unreadIds);
    await click(button("重置")); expect(unreadToggle().checked).toBe(false); expect(runtime.listInputs.at(-1)).not.toHaveProperty("customerIds");
  });
  it("a verified empty unread set disables business list and shows explicit no-unread, not retained broad rows/total", async () => {
    runtime.remembered = { view: true }; await render();
    expect(runtime.listInputs.at(-1).customerIds).toEqual([]); expect(runtime.listOptions.at(-1).enabled).toBe(false);
    expect(host.textContent).toContain("没有未读客户"); expect(tableRows()).toHaveLength(0); expect(host.textContent).not.toMatch(/共\s*40\s*条/);
  });
  it("unknown/failed unread capability never queries all customers or displays fake empty; exposes retry", async () => {
    runtime.remembered = { view: true }; runtime.unreadAvailable = false; runtime.unreadError = new Error("未读筛选暂不可用"); await render();
    expect(runtime.listOptions.at(-1).enabled).toBe(false); expect(tableRows()).toHaveLength(0);
    expect(host.textContent).toContain("未读筛选暂不可用"); expect(host.textContent).not.toContain("没有未读客户");
    await click(button("重试")); expect(runtime.unreadRetry).toHaveBeenCalledOnce();
  });
});
