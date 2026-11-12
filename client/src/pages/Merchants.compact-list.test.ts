// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), mutations: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/hooks/useAdminPageMemory", async () => {
  const { useState } = await import("react");
  return {
    useAdminPageMemory: () => true,
    useAdminUrlState: (_key: string, initial: unknown) => useState(initial),
    useAdminRememberedState: (_key: string, initial: unknown) => useState(initial),
    useAdminRestoringQuery: (value: unknown) => value,
    freshAdminListOptions: (value: unknown) => value,
    useAdminPageBounds: () => undefined,
  };
});
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { adminRole: "merchant_mgr" } }) }));
vi.mock("@/components/DashboardLayout", async () => {
  const { AdminWorkspaceLocation } = await import("@/components/admin/AdminWorkspaceNavigation");
  return { default: ({ children }: { children: React.ReactNode }) => createElement("main", { className: "admin-workspace-shell__main" },
    createElement(AdminWorkspaceLocation, { items: [{ path: "/merchants", label: "商户管理" }], location: "/merchants" }), children) };
});
vi.mock("@/components/merchant/CnRegistrationReviewQueue", () => ({ default: () => null }));
vi.mock("@/components/merchant/CnRegistrationReviewDetail", () => ({ default: () => null }));
vi.mock("@/components/MerchantOwnershipLookup", () => ({ default: () => null }));
vi.mock("@/components/MerchantCreatedAtFilter", () => ({ default: () => createElement("span", null, "全部入驻时间") }));
vi.mock("@/components/SalesOwnerFilterCombobox", () => ({ default: () => createElement("span", null, "全部销售负责人") }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ merchant: { list: { invalidate: mocks.invalidate }, salesOwnerFilterOptions: { invalidate: mocks.invalidate } } }),
  merchant: {
    list: { useQuery: mocks.list },
    salesOwnerFilterOptions: { useQuery: () => ({ data: { options: [], canViewUnassigned: false } }) },
    detail: { useQuery: () => ({ data: undefined }) },
    setSalesOwner: { useMutation: () => ({ mutate: mocks.mutations, isPending: false }) },
    setCrmStatus: { useMutation: () => ({ mutate: mocks.mutations, isPending: false }) },
    rebindCrmOwner: { useMutation: () => ({ mutate: mocks.mutations, isPending: false }) },
    sendMessage: { useMutation: () => ({ mutate: mocks.mutations, isPending: false }) },
  },
  salesStaff: { list: { useQuery: () => ({ data: [] }) } },
} }));
vi.mock("wouter", () => ({ Link: ({ href, children, ...props }: any) => createElement("a", { href, ...props }, children) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import Merchants from "./Merchants";
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  const forbidden = () => { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); };
  vi.stubGlobal("fetch", vi.fn(forbidden)); vi.stubGlobal("XMLHttpRequest", vi.fn(forbidden)); vi.stubGlobal("WebSocket", vi.fn(forbidden));
  mocks.list.mockReset().mockReturnValue({ data: { total: 41, data: [{ id: 7001, merchantNo: "SYNTHETIC-7001", companyName: "合成商户有限公司", canManage: false, agreementStatus: "unsigned", createdAt: "2026-11-03T01:00:00Z" }] }, isLoading: false });
  mocks.mutations.mockReset().mockImplementation(forbidden); mocks.invalidate.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(mocks.mutations).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled(); expect(globalThis.WebSocket).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
async function render() { await act(async () => root.render(createElement(Merchants))); }
function button(label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === label);
  if (!found) throw new Error(`Missing ${label}`); return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const latestInput = () => mocks.list.mock.calls.at(-1)?.[0];

describe("实际Merchants普通列表紧凑布局（离线，不加载凭据）", () => {
  it("共用紧凑工具栏保留唯一不可见可访问H1、只读二级定位、八列表头及详情真链接", async () => {
    await render(); expect(host.querySelectorAll("h1")).toHaveLength(1);
    expect(host.querySelector('h1.d51-compact-list-title')?.textContent).toBe("商户管理");
    expect(host.querySelectorAll(".d51-compact-list-toolbar")).toHaveLength(1);
    expect(host.querySelector("h1")?.closest('[hidden], [aria-hidden="true"]')).toBeNull();
    expect([...host.querySelectorAll("li")].map(node => node.lastElementChild?.textContent)).toEqual(["平台运营", "基础资料", "商户管理"]);
    expect([...host.querySelectorAll("th")].map(node => node.textContent)).toEqual(["商户编号", "公司名称", "用户名", "销售负责人", "ERP", "协议", "入驻时间", "操作"]);
    expect(host.querySelector('a[href="/merchants/7001"]')?.textContent).toBe("合成商户有限公司");
    expect(host.textContent).toContain("仅查看"); expect(latestInput()).toMatchObject({ page: 1, pageSize: 20 });
  });
  it("搜索草稿仍不查询，分页后Enter回第一页，原输入/焦点不丢且重置保留原业务", async () => {
    await render(); const input = host.querySelector<HTMLInputElement>('input[placeholder="搜索公司名称 / 商户编号"]')!;
    input.focus(); await type(input, "合成搜索"); expect(latestInput().search).toBeUndefined();
    await click("下一页"); expect(latestInput().page).toBe(2);
    expect(host.querySelector("input")).toBe(input); expect(document.activeElement).toBe(input);
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(latestInput()).toMatchObject({ page: 1, search: "合成搜索" });
    await click("重置"); expect(input.value).toBe(""); expect(latestInput().search).toBeUndefined(); expect(latestInput().page).toBe(1);
  });
  it("空数据仍显示真实空状态，列表标题保持可访问", async () => {
    mocks.list.mockReturnValue({ data: { total: 0, data: [] }, isLoading: false });
    await render(); expect(host.textContent).toContain("暂无商户数据");
    expect(host.querySelector('h1.d51-compact-list-title')?.textContent).toBe("商户管理");
  });
});
