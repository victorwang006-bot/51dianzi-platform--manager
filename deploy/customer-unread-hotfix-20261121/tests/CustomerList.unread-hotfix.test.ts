// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, writeFileSync } from "node:fs";
import postcss from "postcss";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  listDataUnavailable: false, ignoreUnreadNarrowing: false, rows: [] as any[], summary: vi.fn(), context: vi.fn(), create: vi.fn(), navigate: vi.fn(),
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
vi.mock("/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/hooks/usePageMemory", async () => {
  const { useState } = await import("react");
  return { usePageMemory: () => runtime.identityReady,
    useRememberedState: (key: string, value: unknown) => useState(key in runtime.remembered ? runtime.remembered[key] : value),
    freshListOptions: (options: any, ready: boolean) => ({ ...options, enabled: ready && options.enabled !== false }),
    useListPositionRestore: (_query: unknown, active: boolean) => { runtime.restoreCalls.push(active); },
    returnToPageSource: vi.fn() };
});
vi.mock("/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/hooks/useCustomerCreateDraft", () => ({
  useCustomerCreateDraftIdentity: () => ({ key: "synthetic-once-identity" }),
  useCustomerCreateDraft: () => ({ completion: null, consumeCompletion: vi.fn() }),
}));
vi.mock("/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/components/customers/CustomerCreateForm", () => ({ CustomerCreateForm: (props: any) => { runtime.createFormProps = props; return null; } }));
vi.mock("/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/components/customerDemands/CustomerDemandDialog", () => ({ CustomerDemandDialog: ({ customer }: any) => React.createElement("div", { "data-testid": "synthetic-demand-open" }, customer.name) }));
vi.mock("/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/lib/adminNewInformation", () => ({
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
vi.mock("/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/api/business-auth", () => ({ useAuth: () => ({ user: { id: runtime.actorId }, loading: false, isAuthenticated: true }) }));
vi.mock("/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/api/business-enterprise-session", () => ({ useOptionalEnterpriseSession: () => ({ activeEnterprise: { enterpriseId: runtime.enterpriseId, memberStatus: "active", accessStatus: "enabled" } }) }));
vi.mock("/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/BusinessScope", () => ({ useBusinessScope: () => ({
  storageScope: `synthetic:${runtime.actorId}:${runtime.enterpriseId}`,
  merchantId: 30061, staffPrincipal: { enterpriseId: runtime.enterpriseId, adminAccountId: 101 }, frontUser: { id: runtime.actorId },
  contextVerification: { state: "verified", identity: `synthetic:${runtime.actorId}:${runtime.enterpriseId}`, authorizationVersion: runtime.authVersion, readVersion: runtime.authVersion },
  officialInventoryPermissions: { read: true, write: true, note: true, authorizationVersion: runtime.authVersion },
  onAuthorizationError: runtime.authorizationError,
}) }));
vi.mock("/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/api/business-trpc", () => ({ trpc: {
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
      const narrowed = input.customerIds && !runtime.ignoreUnreadNarrowing ? runtime.rows.filter(row => input.customerIds.includes(row.id)) : undefined;
      return { data: runtime.listDataUnavailable ? undefined : { items: narrowed ?? (input.page === 1 ? runtime.rows : [{ ...runtime.rows[0], id: 804 }]), total: narrowed?.length ?? 40 }, isSuccess: !runtime.listPending && !runtime.listError, isPending: runtime.listPending, isFetching: runtime.listFetching, isError: runtime.listError, error: new Error("synthetic list error"), refetch: runtime.listRefetch }; } },
    contactsSummary: { useQuery: (input: any, options: any) => {
      runtime.contactSummaryRequests.push({ input, options });
      return runtime.contactSummaryResult ?? { isSuccess: true, isFetchedAfterMount: true, isPending: false, isFetching: false, isError: false, isPlaceholderData: false,
        data: { items: runtime.rows.map(row => ({ customerId: row.id, contactCount: row.id === 801 ? 8 : 1, primaryContact: { id: `synthetic-${row.id}`, legacy: false, name: row.contactName, methods: [{ type: "landline", value: row.phone }] } })) } };
    } },
    contactsList: { useQuery: () => ({ data: { contacts: [] }, isPending: false, isError: false, refetch: vi.fn() }) },
  },
} }));

import CustomerList from "/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/pages/CustomerList";

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
  runtime.listDataUnavailable = false; runtime.ignoreUnreadNarrowing = false;
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

describe("CustomerList inline unread hotfix source regressions", () => {
  function unreadToggle() { return host.querySelector<HTMLInputElement>('.customer-list-unread-filter input[type="checkbox"]')!; }
  const helper = "打开客户详情后确认已读，列表浏览不会清除";
  it("places the short checkbox before Search within the same existing action row as Reset and More", async () => {
    await render();
    const toolbar = host.querySelector('section.d51-compact-list-toolbar[role="search"]')!;
    const actions = toolbar.querySelector('.customer-list-filter-actions')!;
    const label = unreadToggle().closest('label')!;
    expect(label.parentElement).toBe(actions);
    expect(label.nextElementSibling).toBe(button("搜索", actions));
    expect(button("重置", actions).parentElement).toBe(actions);
    expect(button("更多筛选", actions).parentElement).toBe(actions);
    expect(label.textContent?.trim()).toBe("只看未读");
    expect(label.title).toBe(helper);
    expect(unreadToggle().getAttribute("aria-label")).toBe("只看未读");
    expect(unreadToggle().getAttribute("aria-description")).toBe(helper);
    expect(host.textContent).not.toContain(helper);
    expect(host.querySelector('.customer-list-unread-controls')).toBeNull();
    expect(host.querySelectorAll('.customer-list-unread-filter')).toHaveLength(1);
    expect(unreadToggle().disabled).toBe(false);
    expect(button("录入客户").closest('.d51-compact-list-toolbar__actions')).not.toBeNull();
  });
  it("clicking unread with zero unread IDs renders explicit empty without undefined.map, old rows, total or dependent fetches", async () => {
    await render(); runtime.summary.mockClear(); runtime.contactSummaryRequests = []; runtime.restoreCalls = [];
    await click(unreadToggle());
    expect(unreadToggle().checked).toBe(true);
    expect(runtime.listOptions.at(-1).enabled).toBe(false);
    expect(runtime.listInputs.at(-1)).toMatchObject({ customerIds: [], page: 1, pageSize: 20 });
    expect(host.textContent).toContain("没有未读客户");
    expect(tableRows()).toHaveLength(0);
    expect(host.textContent).not.toMatch(/共\s*40\s*条/);
    expect(runtime.summary).not.toHaveBeenCalled();
    expect(runtime.contactSummaryRequests.at(-1).options.enabled).toBe(false);
    expect(runtime.restoreCalls).not.toContain(true);
    await click(unreadToggle());
    expect(runtime.listOptions.at(-1).enabled).toBe(true);
    expect(runtime.listInputs.at(-1)).not.toHaveProperty("customerIds");
    expect(tableRows()).toHaveLength(3);
  });
  it("clicking unread while unread refs load hides retained broad rows and total without an error or fake empty", async () => {
    await render(); runtime.unreadAvailable = false; runtime.summary.mockClear(); runtime.restoreCalls = [];
    await click(unreadToggle());
    expect(host.querySelector('[role="status"]')?.textContent).toContain("正在核验未读客户");
    expect(host.textContent).not.toContain("没有未读客户");
    expect(host.textContent).not.toContain("查询失败");
    expect(host.textContent).not.toMatch(/共\s*40\s*条/);
    expect(tableRows()).toHaveLength(0);
    expect(runtime.listOptions.at(-1).enabled).toBe(false);
    expect(runtime.summary).not.toHaveBeenCalled();
    expect(runtime.restoreCalls).not.toContain(true);
    runtime.unreadAvailable = true; runtime.unreadIds = [802]; await render();
    expect(runtime.listOptions.at(-1).enabled).toBe(true);
    expect(tableRows().map(row => row.dataset.pageMemoryRow)).toEqual(["802"]);
  });
  it("clicking unread with failed refs stays fail-closed, retries only unread capability, and can switch back", async () => {
    await render(); runtime.unreadError = new Error("定向未读服务失败"); runtime.summary.mockClear();
    await click(unreadToggle());
    expect(host.textContent).toContain("定向未读服务失败");
    expect(host.textContent).not.toContain("没有未读客户");
    expect(tableRows()).toHaveLength(0);
    expect(runtime.listOptions.at(-1).enabled).toBe(false);
    expect(runtime.summary).not.toHaveBeenCalled();
    await click(button("重试"));
    expect(runtime.unreadRetry).toHaveBeenCalledOnce();
    expect(runtime.listRefetch).not.toHaveBeenCalled();
    await click(unreadToggle());
    expect(unreadToggle().checked).toBe(false);
    expect(runtime.listOptions.at(-1).enabled).toBe(true);
    expect(tableRows()).toHaveLength(3);
  });
  it("holds the page safely while the narrowed customer query itself loads and exposes its retry on failure", async () => {
    runtime.remembered = { view: true }; runtime.unreadIds = [802];
    runtime.listDataUnavailable = true; runtime.listPending = true; runtime.listFetching = true;
    await render();
    expect(runtime.listOptions.at(-1).enabled).toBe(true);
    expect(tableRows()).toHaveLength(0);
    expect(host.querySelector('.animate-spin')).not.toBeNull();
    expect(runtime.summary).not.toHaveBeenCalled();
    runtime.listPending = false; runtime.listFetching = false; runtime.listError = true; await render();
    expect(host.textContent).toContain("synthetic list error");
    await click(button("重试")); expect(runtime.listRefetch).toHaveBeenCalledOnce();
    runtime.listError = false; runtime.listDataUnavailable = false; await render();
    expect(tableRows().map(row => row.dataset.pageMemoryRow)).toEqual(["802"]);
  });
  it("rejects a service response that ignores unread narrowing instead of showing broad rows", async () => {
    runtime.remembered = { view: true }; runtime.unreadIds = [802]; runtime.ignoreUnreadNarrowing = true;
    await render();
    expect(host.textContent).toContain("后台未正确限定未读客户");
    expect(tableRows()).toHaveLength(0);
    expect(runtime.summary).not.toHaveBeenCalled();
    expect(host.textContent).not.toMatch(/共\s*40\s*条/);
    await click(button("重试"));
    expect(runtime.unreadRetry).toHaveBeenCalledOnce();
    expect(runtime.listRefetch).toHaveBeenCalledOnce();
  });
  it("toggles unread without submitting drafts or changing team, owner, dates, star, original create/upload/followup actions", async () => {
    runtime.canReadTeam = true;
    runtime.teams = [{ teamId: 173, name: "合成团队", members: [{ userId: 7, name: "合成负责人" }] }];
    const filters = { keyword: " 已应用 ", grade: "B", stage: "following", scope: "team", teamId: "173", assignedUserId: "7", due: "today", archived: false, starredOnly: true, updatedFrom: "2026-11-01", updatedTo: "2026-11-20" };
    runtime.remembered = { appliedFilters: filters, draftFilters: { ...filters, keyword: "未应用草稿" }, moreFiltersOpen: true, page: 2 };
    runtime.unreadIds = [801, 802, 803, 804, 805];
    await render(); await click(unreadToggle());
    const expected = { keyword: "已应用", grade: "B", stage: "following", scope: "team", teamId: 173, assignedUserId: 7, due: "today", archived: false, starredOnly: true, updatedFrom: "2026-11-01", updatedTo: "2026-11-20", starMode: "assignee", page: 1, pageSize: 20 };
    expect(runtime.listInputs.at(-1)).toMatchObject({ ...expected, customerIds: runtime.unreadIds });
    expect(host.querySelector<HTMLInputElement>('.customer-list-search')!.value).toBe("未应用草稿");
    expect(host.querySelector('[aria-label="按负责人筛选"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="更新时间开始日期"]')).not.toBeNull();
    await click(button("录入客户")); expect(button("收起录入")).toBeDefined();
    await click(button("收起录入"));
    expect(button("上传物料表", tableRows()[0]).getAttribute("aria-disabled")).not.toBe("true");
    expect(button("需求录入", tableRows()[0])).toBeDefined();
    expect(button("跟进", tableRows()[0])).toBeDefined();
    await click(unreadToggle());
    expect(runtime.listInputs.at(-1)).toMatchObject(expected);
    expect(runtime.listInputs.at(-1)).not.toHaveProperty("customerIds");
    expect(host.querySelector<HTMLInputElement>('.customer-list-search')!.value).toBe("未应用草稿");
    expect(runtime.setStar).not.toHaveBeenCalled();
    expect(runtime.rowsOptions.at(-1)).toMatchObject({ acknowledgeOnVisible: false, retainUnreadWhileVisible: false });
    expect(runtime.navigate).not.toHaveBeenCalled();
  });
  it("leaves source query/result logic and all JSX outside relocated unread and name table-width slots exactly unchanged; CSS is append-only and customer scoped", () => {
    const base = readFileSync('/home/ubuntu/work/customer-unread-hotfix-20261121-2353/baseline/CustomerList.tsx', 'utf8');
    const current = readFileSync('/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/pages/CustomerList.tsx', 'utf8');
    const oldBlock = /      <div className="customer-list-unread-controls">[\s\S]*?      <\/div>\n\n/;
    const newBlock = /            <label className="customer-list-unread-filter" title="[^"]+">[\s\S]*?            <\/label>\n/;
    const normalized = current.replace(newBlock, '').replace(/\n\s+style=\{\{ minWidth:[^\n]+ \}\}>/, '>');
    expect(normalized).toBe(base.replace(oldBlock, ''));
    const oldCss = readFileSync('/home/ubuntu/work/customer-unread-hotfix-20261121-2353/baseline/CustomerList.css', 'utf8');
    const css = readFileSync('/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/pages/CustomerList.css', 'utf8');
    expect(css.startsWith(oldCss)).toBe(true);
    const parsed = postcss.parse(css.slice(oldCss.length));
    const declarations: Record<string, string> = {};
    parsed.walkRules(rule => {
      expect(rule.selector.startsWith('.customer-list-page')).toBe(true);
      if (rule.selector === '.customer-list-page .customer-list-filter-actions .customer-list-unread-filter') rule.walkDecls(decl => { declarations[decl.prop] = decl.value; });
    });
    expect(declarations).toMatchObject({ flex: '0 0 auto', 'min-height': 'var(--admin-content-control-height, 32px)', padding: '0 4px', 'white-space': 'nowrap' });
    expect(css.slice(oldCss.length)).not.toMatch(/!important|position:\s*absolute|width:\s*100%|zoom:|scale\(/);
  });
});

describe("CustomerList complete company and business action layout source regressions", () => {
  function cssDeclarations(selector: string) {
    const css = readFileSync('/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/pages/CustomerList.css', 'utf8');
    const result: Record<string, string> = {};
    postcss.parse(css).walkRules(rule => { if ((rule.selector === selector || rule.selector.startsWith(selector + ',')) && rule.parent?.type !== 'atrule') rule.walkDecls(decl => { result[decl.prop] = decl.value; }); });
    return result;
  }
  it("uses a locally scoped fixed customer table and name intrinsic width instead of clipping or company wrapping", () => {
    expect(cssDeclarations('.customer-list-page .customer-list-table')).toMatchObject({ width: '100%', 'table-layout': 'fixed', 'min-width': '1468px' });
    expect(cssDeclarations('.customer-list-page .customer-list-col-name').width).toBe('auto');
    expect(cssDeclarations('.customer-list-page .customer-list-name-line')).toMatchObject({ display: 'flex', 'flex-wrap': 'nowrap', 'min-width': 'max-content' });
    expect(cssDeclarations('.customer-list-page .customer-list-name-line .customer-list-name')).toMatchObject({ flex: '0 0 auto', width: 'max-content', 'max-width': 'none', overflow: 'visible', 'text-overflow': 'clip', 'white-space': 'nowrap', 'overflow-wrap': 'normal', 'word-break': 'keep-all' });
    expect(cssDeclarations('.customer-list-page .customer-list-table-scroll')).toMatchObject({ 'overflow-x': 'auto', 'max-width': '100%' });
    expect(cssDeclarations('.customer-list-page .customer-list-table-inner[data-slot="table-container"]').overflow).toBe('visible');
  });
  it("keeps supply and sticky demand/followup columns large enough for untruncated labels with consistent sticky offsets", () => {
    expect(cssDeclarations('.customer-list-page .customer-list-col-supply').width).toBe('192px');
    expect(cssDeclarations('.customer-list-page')['--customer-list-demand-width']).toBe('128px');
    expect(cssDeclarations('.customer-list-page .customer-list-table :is(th, td):nth-child(6)')).toMatchObject({ width: '192px', 'min-width': '192px', 'white-space': 'nowrap', overflow: 'visible', 'text-overflow': 'clip' });
    expect(cssDeclarations('.customer-list-page .customer-list-table :is(th, td):nth-child(7)')).toMatchObject({ 'min-width': 'var(--customer-list-demand-width)', 'white-space': 'nowrap', overflow: 'visible', 'text-overflow': 'clip' });
    expect(cssDeclarations('.customer-list-page .customer-list-table :is(th, td):nth-child(8)')).toMatchObject({ 'min-width': 'var(--customer-list-actions-width)', 'white-space': 'nowrap', overflow: 'visible', 'text-overflow': 'clip' });
    expect(cssDeclarations('.customer-list-page .customer-list-table th')).toMatchObject({ 'white-space': 'nowrap', overflow: 'visible', 'text-overflow': 'clip' });
    expect(cssDeclarations('.customer-list-page .customer-list-table .customer-list-text-action')).toMatchObject({ flex: '0 0 auto', width: 'max-content', 'max-width': 'none', overflow: 'visible', 'text-overflow': 'clip', 'white-space': 'nowrap' });
    expect(cssDeclarations('.customer-list-page .customer-list-table .customer-list-text-action-wrap')).toMatchObject({ 'flex-shrink': '0', 'min-width': 'max-content', 'max-width': 'none' });
    expect(cssDeclarations('.customer-list-page .customer-list-table .customer-list-demand-column').right).toBe('var(--customer-list-actions-width)');
    expect(cssDeclarations('.customer-list-page .customer-list-table .customer-list-actions-column').right).toBe('0');
  });
  it("retains the full reported company name and original title, independent star/unread badge, all eight table columns", async () => {
    const company = '深圳市宝龙达信息技术股份有限公司';
    runtime.rows = [row(801, { name: company })]; runtime.unreadRowIds = [801];
    await render();
    const name = host.querySelector<HTMLButtonElement>('.customer-list-name')!;
    expect(name.textContent?.trim()).toBe(company);
    expect(name.title).toBe(`打开客户工作台：${company}`);
    expect(name.getAttribute('aria-label')).toBe(`打开客户工作台：${company}`);
    expect(name.parentElement).toBe(star().parentElement);
    expect(star().getAttribute('aria-label')).toBe(`标记为重点客户：${company}`);
    expect(tableRows()[0].dataset.customerUnread).toBe('true');
    expect(tableRows()[0].querySelector('[data-admin-new-information="row"]')?.textContent).toBe('未读');
    expect(host.querySelectorAll('col')).toHaveLength(8);
    expect(tableRows()[0].cells).toHaveLength(8);
    await click(name); expect(runtime.navigate).toHaveBeenLastCalledWith('/customers/801?tab=overview');
    expect(runtime.setStar).not.toHaveBeenCalled();
  });
  it("keeps complete original supply titles/actions, upload portal, demand and followup behavior unchanged", async () => {
    await render();
    expect(host.querySelector('[data-testid="supply-header"]')?.textContent).toBe('供应库存');
    expect(host.querySelector('[data-testid="demand-header"]')?.textContent?.trim()).toBe('需求录入');
    expect(host.querySelector('[data-testid="actions-header"]')?.textContent?.trim()).toBe('跟进');
    const first = tableRows()[0];
    expect(button('上传物料表', first).classList.contains('customer-list-supply-upload')).toBe(true);
    expect(button('查看库存（123456）', first).classList.contains('customer-list-supply-view')).toBe(true);
    await click(button('查看库存（123456）', first));
    expect(runtime.navigate).toHaveBeenLastCalledWith('/channel-inventory?supplyChannelId=411&supplyTab=materials');
    await click(button('需求录入', first));
    expect(host.querySelector('[data-testid="synthetic-demand-open"]')?.textContent).toBe(runtime.rows[0].name);
    await click(button('跟进', first));
    expect(runtime.navigate).toHaveBeenLastCalledWith('/customers/801?follow=1&tab=followups');
    await click(button('上传物料表', first));
    expect(document.querySelector('[data-testid="channel-inventory-batch-dialog"]')).not.toBeNull();
    expect(runtime.context).toHaveBeenCalledOnce();
    expect(runtime.create).not.toHaveBeenCalled();
  });
});

describe('CustomerList fixed sticky widths and legacy polish specificity', () => {
  it('overrides the legacy customer name polish with an equal-specificity selector without touching inventory names', () => {
    const css = readFileSync('/home/ubuntu/work/channel-release-20261121-1837/manager/client/src/business/platform/client/src/pages/CustomerList.css', 'utf8');
    const required = '.admin-workspace-shell[data-admin-layout="top-two-level-v1"] .customer-list-page .customer-list-name-line .customer-list-name';
    let found = false;
    postcss.parse(css).walkRules(rule => {
      if (!rule.selector.includes(required)) return;
      found = true;
      const values: Record<string, string> = {};
      rule.walkDecls(decl => { values[decl.prop] = decl.value; });
      expect(values).toMatchObject({ 'white-space': 'nowrap', 'overflow-wrap': 'normal', 'max-width': 'none', 'word-break': 'keep-all', overflow: 'visible', 'text-overflow': 'clip' });
      expect(rule.selector).not.toContain('ci-source');
    });
    expect(found).toBe(true);
    const delta = css.slice(readFileSync('/home/ubuntu/work/customer-unread-hotfix-20261121-2353/baseline/CustomerList.css', 'utf8').length);
    expect(delta).not.toContain('table-layout: auto');
    postcss.parse(delta).walkRules(rule => {
      expect(rule.selector.includes('.customer-list-page')).toBe(true);
      const values: Record<string, string> = {};
      rule.walkDecls(decl => { values[decl.prop] = decl.value; });
      if (/nth-child\([78]\)/.test(rule.selector)) {
        expect(values.width).toBe(values['min-width']);
        expect(values.width).toBe(values['max-width']);
        expect(values['box-sizing']).toBe('border-box');
      }
    });
  });
  it('expands the table for very long names without changing the fixed colgroup widths or original title', async () => {
    const company = '深圳市宝龙达信息技术股份有限公司'.repeat(4);
    runtime.rows = [row(801, { name: company })];
    await render();
    const table = host.querySelector<HTMLTableElement>('.customer-list-table')!;
    expect(table.style.minWidth).toBe(`calc(${Math.max(30, company.length + 4)}em + 1108px)`);
    expect(host.querySelector<HTMLButtonElement>('.customer-list-name')!.title).toBe(`打开客户工作台：${company}`);
    expect(host.querySelector('.customer-list-name')!.textContent?.trim()).toBe(company);
    expect(Array.from(host.querySelectorAll('col')).map(col => col.className)).toEqual(['customer-list-col-name', 'customer-list-col-industry', 'customer-list-col-contacts', 'customer-list-col-stage', 'customer-list-col-owner', 'customer-list-col-supply', 'customer-list-col-demand', 'customer-list-col-actions']);
  });
});
