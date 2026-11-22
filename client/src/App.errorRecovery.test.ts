// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  user: { id: 6001, adminRole: "viewer", permissions: ["orders.read", "materials.read"], hasNativeAdminAccount: true } as Record<string, unknown> | null,
  loading: false, error: null as unknown, crashOrders: true, crashMaterials: false,
  ordersMounts: 0, workbenchMounts: 0,
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: runtime.user, loading: runtime.loading, error: runtime.error }) }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: unknown }) => children }));
vi.mock("./contexts/ThemeContext", () => ({ ThemeProvider: ({ children }: { children: unknown }) => children }));
vi.mock("./components/DashboardLayoutSkeleton", () => ({ DashboardLayoutSkeleton: () => React.createElement("p", null, "安全加载中") }));
vi.mock("./lib/adminRouteChunks", async () => {
  const { createElement: h, useEffect } = await import("react");
  const screen = (name: string) => () => h("main", null, name);
  return {
    ...Object.fromEntries(["Admins", "Analytics", "ExceptionLogs", "Forbidden", "Login", "MerchantDetail", "Merchants", "Messages", "NotFound", "OfficialChannelInventory", "OfficialMall", "PortalUsers", "Profile", "Reviews", "Staff", "Organization"].map(name => [`Lazy${name}`, screen(name)])),
    LazyOrders: () => { if (runtime.crashOrders) throw new Error("SYNTHETIC_ORDERS_STACK"); useEffect(() => { runtime.ordersMounts++; }, []); return h("main", null, `Orders:${runtime.user?.id}`); },
    LazyMaterials: () => { if (runtime.crashMaterials) throw new Error("SYNTHETIC_GLOBAL_STACK"); return h("main", null, "Materials"); },
    LazyBusinessWorkbench: () => { useEffect(() => { runtime.workbenchMounts++; }, []); return h("main", null, `Workbench:${runtime.user?.id}`); },
  };
});
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
async function render(path?: string) {
  await act(async () => { if (path) { window.history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); } root.render(React.createElement(App)); });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(node => node.textContent?.includes(text));
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
beforeEach(() => {
  runtime.user = { id: 6001, adminRole: "viewer", permissions: ["orders.read", "materials.read"], hasNativeAdminAccount: true };
  runtime.loading = false; runtime.error = null; runtime.crashOrders = true; runtime.crashMaterials = false; runtime.ordersMounts = 0; runtime.workbenchMounts = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("authenticated route and Orders error recovery", () => {
  it("renders short Chinese fallback, keeps diagnostics collapsed and retries without reload", async () => {
    await render("/orders");
    expect(container.textContent).toContain("页面暂时无法显示");
    expect(container.textContent).not.toContain("An unexpected error occurred");
    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.querySelector("pre")?.textContent).toContain("SYNTHETIC_ORDERS_STACK");
    expect(console.error).toHaveBeenCalled();
    runtime.crashOrders = false;
    await click("重试");
    expect(container.textContent).toContain("Orders:6001");
  });
  it("persistent error never auto-retries or reloads, explicit return reaches existing route gates", async () => {
    await render("/orders");
    await click("重试");
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    await click("返回其他页面");
    expect(window.location.pathname).toBe("/workbench/customers");
    expect(container.textContent).toContain("Workbench:6001");
  });
  it("a global page crash clears on route navigation rather than latching the entire backend", async () => {
    runtime.crashMaterials = true;
    await render("/materials");
    expect(container.textContent).toContain("页面暂时无法显示");
    await render("/profile");
    expect(container.textContent).toContain("Profile");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("account change safely remounts and removes prior error/old account page", async () => {
    await render("/orders");
    runtime.crashOrders = false;
    runtime.user = { ...runtime.user, id: 6002 };
    await render();
    expect(container.textContent).toContain("Orders:6002");
    expect(container.textContent).not.toContain("Orders:6001");
  });
  it("permission revocation does not turn reset into unguarded Orders mounting", async () => {
    await render("/orders");
    runtime.crashOrders = false;
    runtime.user = { ...runtime.user, permissions: ["materials.read"] };
    await render();
    expect(container.textContent).toContain("Forbidden");
    expect(runtime.ordersMounts).toBe(0);
  });
  it("logout from an error page remains protected and redirects to real login", async () => {
    await render("/orders");
    runtime.user = null;
    await render();
    expect(window.location.pathname).toBe("/login");
    expect(container.textContent).toContain("Login");
    expect(runtime.ordersMounts).toBe(0);
  });
  it("pending identity cannot recover into old Orders and normal workbench navigation stays mounted", async () => {
    await render("/orders");
    runtime.loading = true;
    await render();
    expect(container.textContent).toContain("安全加载中");
    expect(container.textContent).not.toContain("Orders:");
    runtime.loading = false;
    await render("/workbench/customers");
    await render("/workbench/inquiries");
    expect(runtime.workbenchMounts).toBe(1);
  });
  it("local Orders details/query navigation resets same route boundary", async () => {
    await render("/orders");
    runtime.crashOrders = false;
    await render("/orders/123?tab=items");
    expect(container.textContent).toContain("Orders:6001");
  });
});
describe("standalone boundary resetKeys", () => {
  it("does not retry on unrelated renders but clears on a new route key", async () => {
    let throws = true, attempts = 0;
    const Child = () => { attempts++; if (throws) throw new Error("SYNTHETIC"); return React.createElement("p", null, "recovered"); };
    const view = (key: string) => React.createElement(ErrorBoundary, { resetKeys: [key], children: React.createElement(Child) });
    await act(async () => root.render(view("a")));
    const before = attempts;
    throws = false;
    await act(async () => root.render(view("a")));
    expect(attempts).toBe(before);
    await act(async () => root.render(view("b")));
    expect(container.textContent).toContain("recovered");
  });
});
