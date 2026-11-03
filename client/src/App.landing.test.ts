// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ user: { id: 400001, adminRole: "super_admin", permissions: ["materials.read"], hasNativeAdminAccount: true } as Record<string, unknown> | null, loading: false }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: runtime.user, loading: runtime.loading }) }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: unknown }) => children }));
vi.mock("./components/DashboardLayoutSkeleton", () => ({ DashboardLayoutSkeleton: () => null }));
vi.mock("./components/ErrorBoundary", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("./contexts/ThemeContext", () => ({ ThemeProvider: ({ children }: { children: unknown }) => children }));
vi.mock("./lib/adminRouteChunks", async () => {
  const { createElement } = await import("react");
  const screen = (name: string) => () => createElement("main", { "data-screen": name }, name);
  return Object.fromEntries(["Admins", "Analytics", "BusinessWorkbench", "ExceptionLogs", "Forbidden", "Login", "Materials", "MerchantDetail", "Merchants", "Messages", "NotFound", "OfficialChannelInventory", "Orders", "PortalUsers", "Profile", "Reviews", "Staff", "Organization"].map(name => [`Lazy${name}`, screen(name)]));
});
import App from "./App";
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
async function renderAt(path: string) {
  window.history.replaceState({}, "", path);
  await act(async () => { root.render(React.createElement(App)); });
}
beforeEach(() => {
  runtime.loading = false;
  runtime.user = { id: 400001, adminRole: "super_admin", permissions: ["materials.read"], hasNativeAdminAccount: true };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("后台默认渠道库存入口", () => {
  it("已登录根入口直接进入渠道库存且不挂载旧物料首页", async () => {
    await renderAt("/");
    expect(window.location.pathname).toBe("/workbench/channel-inventory");
    expect(container.querySelector('[data-screen="BusinessWorkbench"]')).not.toBeNull();
    expect(container.querySelector('[data-screen="Materials"]')).toBeNull();
  });
  it("无next参数的登录页登录态默认进入渠道库存", async () => {
    await renderAt("/login");
    expect(window.location.pathname).toBe("/workbench/channel-inventory");
    expect(container.querySelector('[data-screen="BusinessWorkbench"]')).not.toBeNull();
  });
  it("显式物料运营地址仍保留原权限页面", async () => {
    await renderAt("/materials");
    expect(window.location.pathname).toBe("/materials");
    expect(container.querySelector('[data-screen="Materials"]')).not.toBeNull();
  });
  it("显式合法深链登录后继续原目标不强制覆盖", async () => {
    await renderAt("/login?next=%2Fmessages%3Fstatus%3Dopen");
    expect(window.location.pathname + window.location.search).toBe("/messages?status=open");
    expect(container.querySelector('[data-screen="Messages"]')).not.toBeNull();
  });
  it("未认证不挂载业务页面，只保留安全默认登录目标", async () => {
    runtime.user = null;
    await renderAt("/");
    expect(window.location.pathname).toBe("/login");
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/workbench/channel-inventory");
    expect(container.querySelector('[data-screen="BusinessWorkbench"]')).toBeNull();
  });
});


describe("渠道库存独立native read路由门禁", () => {
  it("ERP业务管理授权不能代替native read挂载渠道工作台", async () => {
    runtime.user = { id: 6001, adminRole: "merchant_mgr", hasNativeAdminAccount: true, permissions: ["business.inventory.read", "business.inventory.write"] };
    await renderAt("/workbench/channel-inventory?merchantId=30061");
    expect(container.querySelector('[data-screen="Forbidden"]')).not.toBeNull();
    expect(container.querySelector('[data-screen="BusinessWorkbench"]')).toBeNull();
  });
  it("仅有真实native read可进入后续BFF绑定验证，不要求ERP编辑权限", async () => {
    runtime.user = { id: 6001, adminRole: "merchant_mgr", hasNativeAdminAccount: true, permissions: ["officialInventory.read"] };
    await renderAt("/workbench/channel-inventory");
    expect(container.querySelector('[data-screen="BusinessWorkbench"]')).not.toBeNull();
  });
  it("真实read撤回后立即卸载业务页，OAuth兼容superadmin不能绕过", async () => {
    await renderAt("/workbench/channel-inventory");
    runtime.user = { ...runtime.user, hasNativeAdminAccount: false };
    await renderAt("/workbench/channel-inventory");
    expect(container.querySelector('[data-screen="BusinessWorkbench"]')).toBeNull();
    expect(container.querySelector('[data-screen="Forbidden"]')).not.toBeNull();
  });
  it("不对其它ERP业务路由强加native库存门禁", async () => {
    runtime.user = { id: 6001, adminRole: "merchant_mgr", hasNativeAdminAccount: false, permissions: [] };
    await renderAt("/workbench/customers");
    expect(container.querySelector('[data-screen="BusinessWorkbench"]')).not.toBeNull();
    expect(container.querySelector('[data-screen="Forbidden"]')).toBeNull();
  });
});
