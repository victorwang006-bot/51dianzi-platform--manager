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
}));
vi.mock("wouter", () => ({ useLocation: () => ["/customers", runtime.navigate], useSearch: () => "" }));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), warning: vi.fn() } }));
vi.mock("../hooks/usePageMemory", async () => {
  const { useState } = await import("react");
  return { usePageMemory: () => true,
    useRememberedState: (_key: string, value: unknown) => useState(value),
    freshListOptions: (options: unknown) => options, useRestoringListQuery: (query: unknown) => query,
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
    context: { useQuery: () => ({ data: { actorUserId: runtime.actorId, canManageAll: false, members: [] }, isPending: false, isLoading: false, isError: false, refetch: vi.fn() }) },
    list: { useQuery: (input: any) => ({ data: { items: input.page === 1 ? runtime.rows : [{ ...runtime.rows[0], id: 804 }], total: 40 }, isPending: false, isFetching: false, isError: false, refetch: vi.fn() }) },
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
    version: 4, archivedAt: null, ...changes };
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

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  runtime.rows = [row(801), row(802, { industryCode: null, contactName: "合成补档联系人", nextFollowUpAt: null }), row(803, { archivedAt: "2026-11-01", nextFollowUpAt: "2026-11-02T09:00:00+08:00" })];
  runtime.authVersion = "v1"; runtime.enterpriseFailed = false; runtime.enterpriseId = 31; runtime.actorId = 7;
  runtime.summary.mockReset().mockImplementation(() => Promise.resolve(summaries()));
  runtime.context.mockReset().mockResolvedValue({ customer: { ...runtime.rows[0] }, channel: null, canUpload: true, disabledReason: null });
  runtime.create.mockReset().mockResolvedValue({ item: { id: 901 }, idempotent: false, channelId: 411, customerId: 801 });
  runtime.navigate.mockReset(); runtime.authorizationError.mockReset(); runtime.authorityRetry.mockReset();
  runtime.utils = { client: { channelInventory: { customerSupplySummary: { query: runtime.summary }, customerSupplyContext: { query: runtime.context }, createCustomerMaterial: { mutate: runtime.create } } },
    customer: { contactsSummary: { reset: vi.fn().mockResolvedValue(undefined) }, contactsList: { reset: vi.fn().mockResolvedValue(undefined) }, list: { invalidate: vi.fn().mockResolvedValue(undefined) } } };
  document.body.dataset.adminReadability = "true";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.replaceChildren(); delete document.body.dataset.adminReadability; vi.useRealTimers(); });

describe("actual CustomerList supply layout and once-identity refresh", () => {
  it("renders all nine original data cells, complete text actions, long contacts and both fixed right columns", async () => {
    await render();
    const rows = tableRows(); expect(rows).toHaveLength(3); expect(rows.every(row => row.cells.length === 9)).toBe(true);
    expect(Array.from(host.querySelectorAll("thead th")).map(cell => cell.textContent)).toEqual(["客户名称", "所属行业", "联系人 / 电话", "等级 / 阶段", "负责人", "供应库存", "下次跟进", "需求录入", "跟进"]);
    expect(rows[0].cells[2].textContent).toContain("合成较长联系人姓名完整保留"); expect(rows[0].cells[2].textContent).toContain("010-00000001 转 123456");
    expect(rows[0].cells[5].textContent).toContain("查看库存（123456）"); expect(rows[1].cells[5].textContent).toContain("补全客户档案");
    expect(rows[0].cells[6].querySelector(".truncate")).toBeNull(); expect(rows[0].cells[7].className).toContain("customer-list-demand-column");
    expect(rows[0].cells[8].className).toContain("customer-list-actions-column");
    expect(host.querySelector('.customer-list-table-scroll[role="region"][tabindex="0"]')).not.toBeNull();
    for (const action of host.querySelectorAll<HTMLButtonElement>("tbody .customer-list-text-action")) {
      expect(action.getAttribute("type")).toBe("button"); expect(action.classList.contains("admin-row-action")).toBe(false); expect(action.hasAttribute("data-slot")).toBe(false);
    }
    // Optional private actual-DOM fixture for production-CSS browser measurements.
    if (process.env.CUSTOMER_LIST_FIXTURE_PATH) writeFileSync(process.env.CUSTOMER_LIST_FIXTURE_PATH,
      `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Actual CustomerList synthetic render</title></head><body data-admin-readability="true" data-business-native-fonts="true">${host.innerHTML}</body></html>\n`);
  });
  it("keeps all local CSS scoped, explicit column widths, a single horizontal scroller and unboxed standard text actions", () => {
    const css = readFileSync("client/src/business/platform/client/src/pages/CustomerList.css", "utf8");
    postcss.parse(css).walkRules(rule => expect(rule.selector).toMatch(/^\.customer-list-page/));
    expect(css).toContain("min-width: 1480px"); expect(css).toContain("table-layout: fixed"); expect(css).toContain("right: var(--customer-list-actions-width)");
    expect(css).toContain("width: 168px"); expect(css).toContain("width: 176px"); expect(css).toContain("overflow-x: auto"); expect(css).toContain("overflow: visible");
    expect(css).toContain("background: transparent"); expect(css).toContain("border: 0"); expect(css).toContain("font-family: inherit"); expect(css).toContain(":focus-visible");
    expect(css).not.toMatch(/!important|scale\(|zoom:/);
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
    runtime.enterpriseId = 32; runtime.actorId = 8; await render(); expect(old.aborted).toBe(true);
    await act(async () => { finish({ items: [{ customerId: 801, channelId: 999, materialCount: 999, canViewStock: true, canUpload: true }], canWrite: true }); });
    expect(host.textContent).not.toContain("查看库存（999）"); expect(runtime.summary.mock.calls[1][0]).toMatchObject({ expectedEnterpriseId: 32, expectedActorUserId: 8 });
  });
  it("exposes authority read error retry even before a summary identity is available", async () => {
    runtime.enterpriseFailed = true; await render(); expect(runtime.summary).not.toHaveBeenCalled();
    await click(button("重试供应权限")); expect(runtime.authorityRetry).toHaveBeenCalledTimes(1);
  });
});
