// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  user: { id: 400001, adminRole: "super_admin", permissions: ["materials.read"], hasNativeAdminAccount: true } as Record<string, unknown> | null,
  loading: false,
  capabilities: ["customers.manage"] as string[],
  invalidate: vi.fn(async () => {}),
  login: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: runtime.user, loading: runtime.loading }) }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: unknown }) => children }));
vi.mock("./components/DashboardLayoutSkeleton", () => ({ DashboardLayoutSkeleton: () => null }));
vi.mock("./components/ErrorBoundary", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("./contexts/ThemeContext", () => ({ ThemeProvider: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/ForgotPasswordDialog", () => ({ default: () => null }));
vi.mock("@/components/ForgotUsernameDialog", () => ({ default: () => null }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ invalidate: runtime.invalidate }),
  auth: { login: { useMutation: (options: { onSuccess: () => Promise<void> }) => ({
    isPending: false,
    mutate: (input: unknown) => { runtime.login(input); void options.onSuccess(); },
  }) } },
} }));
vi.mock("./lib/adminRouteChunks", async () => {
  const { createElement } = await import("react");
  const { default: Login } = await import("./pages/Login");
  const { BusinessWorkbenchAccessProvider, BusinessWorkbenchRouteGate } = await import("./business/BusinessWorkbenchAccessGate");
  const screen = (name: string) => () => createElement("main", { "data-screen": name }, name);
  const BusinessWorkbench = screen("BusinessWorkbench");
  return {
    ...Object.fromEntries(["Admins", "Analytics", "ExceptionLogs", "Forbidden", "Materials", "MerchantDetail", "Merchants", "Messages", "NotFound", "OfficialChannelInventory", "Orders", "PortalUsers", "Profile", "Reviews", "Staff", "Organization"].map(name => [`Lazy${name}`, screen(name)])),
    LazyLogin: Login,
    // Offline BFF projection fixture; use the real gate, not an invented native permission.
    LazyBusinessWorkbench: () => window.location.pathname === "/workbench/customers"
      ? createElement(BusinessWorkbenchAccessProvider, {
          merchantId: 31, merchantCanWrite: false,
          workbenchCapabilities: runtime.capabilities, writeCapabilities: [],
        }, createElement(BusinessWorkbenchRouteGate, { capability: "customers.manage" }, createElement(BusinessWorkbench)))
      : createElement(BusinessWorkbench),
  };
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
  const forbidden = () => { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); };
  vi.stubGlobal("fetch", vi.fn(forbidden));
  vi.stubGlobal("XMLHttpRequest", vi.fn(forbidden));
  vi.stubGlobal("WebSocket", vi.fn(forbidden));
  runtime.loading = false;
  runtime.user = { id: 400001, adminRole: "super_admin", permissions: ["materials.read"], hasNativeAdminAccount: true };
  runtime.capabilities = ["customers.manage"];
  runtime.invalidate.mockClear();
  runtime.login.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  expect(fetch).not.toHaveBeenCalled();
  expect(XMLHttpRequest).not.toHaveBeenCalled();
  expect(WebSocket).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("后台默认客户列表入口", () => {
  it.each(["/", "/workbench", "/login"])("已登录 %s 默认进入客户列表且不挂载旧物料首页", async path => {
    await renderAt(path);
    expect(window.location.pathname).toBe("/workbench/customers");
    expect(container.querySelector('[data-screen="BusinessWorkbench"]')).not.toBeNull();
    expect(container.querySelector('[data-screen="Materials"]')).toBeNull();
  });
  it("显式物料运营地址仍保留原权限页面", async () => {
    await renderAt("/materials");
    expect(window.location.pathname).toBe("/materials");
    expect(container.querySelector('[data-screen="Materials"]')).not.toBeNull();
  });
  it.each([
    "/messages?status=open#thread-12",
    "/workbench/orders?merchantId=31&merchantId=32&orderSource=mall&kw=XQ%20%2F%201#detail-9",
    "/workbench/customers/12?merchantId=31#detail-12",
    "/workbench/channel-inventory?ciTab=batches&ciBatchId=8#batch-8",
  ])("显式合法深链登录后继续原目标不覆盖：%s", async target => {
    await renderAt(`/login?next=${encodeURIComponent(target)}`);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(target);
  });
  it.each([
    "/workbench/orders?merchantId=31&orderSource=business#detail-9",
    "/workbench/inquiries?conversationId=88&merchantId=31#thread-88",
    "/workbench/channel-inventory?ciTab=trash#row-8",
  ])("刷新具体页面不跳客户：%s", async target => {
    await renderAt(target);
    await renderAt(target);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(target);
    expect(container.querySelector('[data-screen="BusinessWorkbench"]')).not.toBeNull();
  });
  it("未认证根入口只保留安全客户默认登录目标，不挂载业务页面", async () => {
    runtime.user = null;
    await renderAt("/");
    expect(window.location.pathname).toBe("/login");
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/workbench/customers");
    expect(container.querySelector('[data-screen="BusinessWorkbench"]')).toBeNull();
  });
  it.each(["/", "/workbench", "/login"])("无客户 BFF scope 的 %s 默认入口明确拒绝，不以 native role 补 grant", async path => {
    runtime.capabilities = ["crm.sales_orders", "inventory.channel"];
    await renderAt(path);
    expect(window.location.pathname).toBe("/workbench/customers");
    expect(container.textContent).toContain("当前商户未获该业务模块访问范围");
    expect(container.querySelector('[data-screen="BusinessWorkbench"]')).toBeNull();
    expect(runtime.capabilities).toEqual(["crm.sales_orders", "inventory.channel"]);
    expect(runtime.user?.permissions).toEqual(["materials.read"]);
  });
  it.each([
    { loginPath: "/login", target: "/workbench/customers" },
    { loginPath: `/login?next=${encodeURIComponent("/workbench/orders?merchantId=31&orderSource=business#detail-9")}`, target: "/workbench/orders?merchantId=31&orderSource=business#detail-9" },
  ])("进入后台 submit 刷新 auth 后继续统一 returnPath：$target", async ({ loginPath, target }) => {
    const authenticated = runtime.user;
    runtime.user = null;
    await renderAt(loginPath);
    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      for (const [selector, value] of [["#login-username", "offline-fixture"], ["#login-password", "fixture-not-a-secret"]]) {
        const input = container.querySelector<HTMLInputElement>(selector)!;
        inputValueSetter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(runtime.login).toHaveBeenCalledWith({ username: "offline-fixture", password: "fixture-not-a-secret" });
    expect(runtime.invalidate).toHaveBeenCalledTimes(1);
    runtime.user = authenticated; // Simulate the already existing auth.me revalidation.
    await renderAt(loginPath);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(target);
  });
});

describe("渠道库存独立native read路由门禁", () => {
  it("ERP业务管理授权不能代替native read挂载渠道工作台", async () => {
    runtime.user = { id: 6001, adminRole: "merchant_mgr", hasNativeAdminAccount: true, permissions: ["business.inventory.read", "business.inventory.write"] };
    await renderAt("/workbench/channel-inventory?merchantId=31");
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
