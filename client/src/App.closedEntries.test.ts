import { createRequire } from "node:module";
import { act, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS } from "./components/admin/adminWorkbenchNavigationModel";
import {
  ADMIN_WORKSPACE_DEFINITIONS,
  getClosedAdminEntryNavigationTarget,
  getAdminWorkspaceNavigationRoute,
  getAdminWorkspaceNavigationTarget,
  groupAdminBusinessNavigationItems,
  groupAdminWorkspaceNavigationItems,
} from "./components/admin/adminWorkspaceNavigationModel";

const runtime = vi.hoisted(() => ({
  user: { id: 6001, adminRole: "super_admin", permissions: [] as string[], hasNativeAdminAccount: true } as {
    id: number; adminRole: string; permissions: string[]; hasNativeAdminAccount: boolean;
  } | null,
  loading: false,
  screens: [] as { kind: string; path: string }[],
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: runtime.user, loading: runtime.loading }) }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("./components/DashboardLayoutSkeleton", () => ({ DashboardLayoutSkeleton: () => null }));
vi.mock("./components/ErrorBoundary", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("./contexts/ThemeContext", () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("./lib/adminRouteChunks", async () => {
  const { createElement: element } = await import("react");
  const screen = (kind: string) => () => {
    runtime.screens.push({ kind, path: window.location.pathname });
    return element("main", { "data-screen": kind }, kind);
  };
  const empty = () => null;
  return {
    LazyAdmins: empty, LazyAnalytics: empty, LazyBusinessWorkbench: screen("workbench"),
    LazyExceptionLogs: empty, LazyForbidden: screen("forbidden"), LazyLogin: screen("login"),
    LazyMaterials: empty, LazyMerchantDetail: empty, LazyMerchants: empty, LazyMessages: empty,
    LazyNotFound: screen("not-found"), LazyOfficialChannelInventory: empty, LazyOrders: empty,
    LazyPortalUsers: empty, LazyProfile: empty, LazyReviews: empty,
    LazyStaff: screen("staff"), LazyOrganization: screen("organization"),
  };
});

import App from "./App";
import { AdminWorkspaceTabs } from "./components/admin/AdminWorkspaceNavigation";

const retired = ["/role-templates", "/permission-audit", "/workbench/inventory", "/workbench/publish"];
const oldUrls = [...retired, "/workbench/publish/item-12/edit", "/workbench"];
const inputs = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths).map(path => Object.freeze({
  path, label: path, permission: `unchanged:${path}`,
}));
const requireAdmin = createRequire(import.meta.url);
const { JSDOM } = requireAdmin("jsdom") as {
  JSDOM: new (html: string, options: { url: string }) => { window: Window & typeof globalThis & { close(): void } };
};
type Mounted = {
  container: HTMLElement;
  navigate(path: string): Promise<void>;
  click(selector: string): Promise<void>;
  unmount(): Promise<void>;
};
let mounted: Mounted | undefined;
async function mount(initialPath: string, content: ReactNode = createElement(App)): Promise<Mounted> {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: `http://admin.test${initialPath}` });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, location: dom.window.location,
    history: dom.window.history, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
    Event: dom.window.Event, MouseEvent: dom.window.MouseEvent, PopStateEvent: dom.window.PopStateEvent,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const [reactModule, { createRoot }] = await Promise.all([import("react"), import("react-dom/client")]);
  (globalThis as typeof globalThis & { React?: unknown }).React = reactModule;
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  await act(async () => root.render(content));
  return {
    container,
    async navigate(path) {
      await act(async () => {
        dom.window.history.pushState({}, "", path);
        dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
      });
    },
    async click(selector) {
      const button = container.querySelector<HTMLButtonElement>(selector);
      if (!button) throw new Error(`MISSING_NAVIGATION_BUTTON:${selector}`);
      await act(async () => button.click());
    },
    async unmount() { await act(async () => root.unmount()); dom.window.close(); },
  };
}

afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
  runtime.user = { id: 6001, adminRole: "super_admin", permissions: [], hasNativeAdminAccount: true };
  runtime.loading = false;
  runtime.screens = [];
  vi.unstubAllGlobals();
});

describe("关闭四个独立入口的导航投影", () => {
  it("只删四项且保留原对象、入出库父组、组织与所有其余菜单", () => {
    const workspaces = groupAdminWorkspaceNavigationItems(inputs);
    const visiblePaths = workspaces.flatMap(workspace => workspace.items.map(item => item.path));
    expect(visiblePaths).not.toEqual(expect.arrayContaining(retired));
    for (const path of retired) expect(visiblePaths).not.toContain(path);
    const previouslyVisible = inputs.filter(item => item.path !== "/workbench/company-info");
    expect([...visiblePaths].sort()).toEqual(previouslyVisible.filter(item => !retired.includes(item.path)).map(item => item.path).sort());
    expect(ADMIN_WORKSPACE_DEFINITIONS.flatMap(workspace => workspace.paths)).not.toEqual(expect.arrayContaining(retired));
    for (const item of workspaces.flatMap(workspace => workspace.items)) expect(item).toBe(inputs.find(original => original.path === item.path));
    const inventory = groupAdminBusinessNavigationItems(inputs).find(entry => entry.kind === "group" && entry.id === "inventory");
    expect(inventory?.kind === "group" ? inventory.items.map(item => item.path) : []).toEqual(["/workbench/inbound", "/workbench/outbound"]);
    expect(workspaces.find(workspace => workspace.id === "organization")?.items.map(item => item.path)).toEqual(["/staff", "/teams", "/workbench/user-records"]);
  });

  it("权限不足或只剩关闭项时不补入目标页，也不向关闭路径fallback", () => {
    const closedOnly = inputs.filter(item => retired.includes(item.path));
    expect(groupAdminWorkspaceNavigationItems(closedOnly)).toEqual([]);
    expect(getAdminWorkspaceNavigationTarget(closedOnly, "business")).toBeNull();
    expect(getAdminWorkspaceNavigationTarget(closedOnly, "organization")).toBeNull();
    const inbound = inputs.filter(item => item.path === "/workbench/inbound");
    expect(getAdminWorkspaceNavigationTarget([...closedOnly, ...inbound], "business")).toBe(inbound[0]);
    expect(groupAdminBusinessNavigationItems(closedOnly)).toEqual([]);
  });

  it.each(oldUrls)("旧路径%s只保留仍可用的导航上下文", path => {
    const destination = path === "/workbench" ? "/workbench/customers" : path.startsWith("/workbench") ? "/workbench/channel-inventory" : "/staff";
    expect(getClosedAdminEntryNavigationTarget(`${path}/?merchantId=30061#old-page`)).toBe(`${destination}?merchantId=30061`);
    expect(getAdminWorkspaceNavigationRoute(`${path}?merchantId=30061`)?.canonicalPath).toBe(destination);
    expect(getAdminWorkspaceNavigationRoute(path)?.isAlias).toBe(true);
  });

  it.each(["0", "-1", "9007199254740992", "Infinity", "1.2", "1e3", "", "30061&merchantId=8", "30061&merchantId=30061"])("非法/重复merchantId=%s不传递", value => {
    expect(getClosedAdminEntryNavigationTarget(`/role-templates?merchantId=${value}`)).toBe("/staff");
    expect(getClosedAdminEntryNavigationTarget(`/workbench/publish?merchantId=${value}`)).toBe("/workbench/channel-inventory");
  });

  it("只传合法merchant候选，不把企业ID、权限、hash或外链当授权", () => {
    expect(getClosedAdminEntryNavigationTarget("/permission-audit?merchantId=30061&enterpriseId=8&permissions=all&returnTo=https://evil.test#old")).toBe("/staff?merchantId=30061");
    expect(getClosedAdminEntryNavigationTarget("/workbench/inventory#?merchantId=30061")).toBe("/workbench/channel-inventory");
    expect(getClosedAdminEntryNavigationTarget("https://evil.test/role-templates?merchantId=30061")).toBeNull();
    for (const path of ["/teams", "/staff", "/workbench/inbound", "/workbench/outbound", "/workbench/user-records", "/workbench/channel-inventory", "/workbench/publish-extra", "/workbench/publish/a/unknown"]) {
      expect(getClosedAdminEntryNavigationTarget(path)).toBeNull();
    }
  });

  it("真实菜单不渲染/预取关闭项，保留库存、销售原入口与其余组织入口", async () => {
    const preload = vi.fn();
    mounted = await mount("/workbench/inbound", createElement(AdminWorkspaceTabs, { items: inputs, location: "/workbench/inbound", onNavigate: vi.fn(), onPreload: preload }));
    await mounted.click('[data-workspace-dropdown-trigger="inventory-management"]');
    expect([...mounted.container.querySelectorAll('[data-workspace-dropdown-item]')].map(node => node.getAttribute("data-workspace-dropdown-item"))).toEqual(["/workbench/inbound"]);
    await mounted.click('[data-workspace-dropdown-trigger="sales-orders"]');
    expect([...mounted.container.querySelectorAll('[data-order-source]')].map(node => [node.getAttribute("data-order-source"), node.getAttribute("data-workspace-dropdown-item")])).toEqual([["mall", "/workbench/outbound"], ["business", "/workbench/orders"]]);
    await mounted.click('[data-workspace-dropdown-trigger="organization"]');
    expect([...mounted.container.querySelectorAll('[data-workspace="organization"] [data-workspace-dropdown-item]')].map(node => node.getAttribute("data-workspace-dropdown-item"))).toEqual(["/staff", "/teams", "/workbench/user-records"]);
    for (const path of retired) expect(mounted.container.querySelector(`[data-workspace-nav-target="${path}"]`)).toBeNull();
    expect(preload.mock.calls.every(([item]) => !retired.includes(item.path))).toBe(true);
  });
});

describe("旧URL首次render即阻止旧页面挂载", () => {
  it.each(oldUrls)("直接URL %s replace到安全目标，旧页面零render", async path => {
    mounted = await mount(`${path}/?merchantId=30061&returnTo=https://evil.test#stale`);
    const destination = path === "/workbench" ? "/workbench/customers" : path.startsWith("/workbench") ? "/workbench/channel-inventory" : "/staff";
    expect(window.location.pathname + window.location.search).toBe(`${destination}?merchantId=30061`);
    expect(window.location.hash).toBe("");
    expect(window.history.length).toBe(1);
    expect(runtime.screens).toEqual([{ kind: destination === "/staff" ? "staff" : "workbench", path: destination }]);
  });

  it.each(oldUrls)("站内切入%s也不能在effect跳转前触发旧页面render", async path => {
    mounted = await mount(path.startsWith("/workbench") ? "/workbench/inbound?merchantId=8" : "/teams");
    runtime.screens = [];
    await mounted.navigate(`${path}?merchantId=30061`);
    const destination = path === "/workbench" ? "/workbench/customers" : path.startsWith("/workbench") ? "/workbench/channel-inventory" : "/staff";
    expect(runtime.screens.every(screen => screen.path === destination)).toBe(true);
    expect(runtime.screens.length).toBeGreaterThan(0);
    expect(window.location.search).toBe("?merchantId=30061");
  });

  it.each(["/role-templates", "/permission-audit"])("%s保留原admins.manage权限围栏", async path => {
    runtime.user = { id: 6002, adminRole: "merchant_mgr", permissions: ["officialInventory.read"], hasNativeAdminAccount: true };
    mounted = await mount(`${path}?merchantId=30061`);
    expect(window.location.pathname).toBe(path);
    expect(mounted.container.textContent).toBe("forbidden");
    expect(runtime.screens.every(screen => screen.kind === "forbidden")).toBe(true);
  });

  it.each([
    { adminRole: "merchant_mgr", permissions: [] as string[], hasNativeAdminAccount: true },
    { adminRole: "super_admin", permissions: ["officialInventory.read"], hasNativeAdminAccount: false },
  ])("关闭库存跳转不越过目标页原生账户/read围栏：%j", async user => {
    runtime.user = { id: 6002, ...user };
    mounted = await mount("/workbench/publish/42/edit?merchantId=30061");
    expect(window.location.pathname).toBe("/workbench/channel-inventory");
    expect(mounted.container.textContent).toBe("forbidden");
    expect(runtime.screens.every(screen => screen.kind === "forbidden")).toBe(true);
  });

  it("员工级显式渠道read权限仍可用，不要求放宽任何business.*权限", async () => {
    runtime.user = { id: 6002, adminRole: "merchant_mgr", permissions: ["officialInventory.read"], hasNativeAdminAccount: true };
    mounted = await mount("/workbench/inventory?merchantId=30061");
    expect(runtime.screens).toEqual([{ kind: "workbench", path: "/workbench/channel-inventory" }]);
  });

  it("未登录旧URL仍走原登录returnTo且不挂载业务页面", async () => {
    runtime.user = null;
    mounted = await mount("/role-templates?merchantId=30061");
    expect(window.location.pathname).toBe("/login");
    expect(new URLSearchParams(window.location.search).get("next")).toBe("/role-templates?merchantId=30061");
    expect(runtime.screens.every(screen => screen.kind === "login")).toBe(true);
  });

  it("认证加载时既不跳转也不挂载任何旧/目标页面", async () => {
    runtime.loading = true;
    mounted = await mount("/workbench/inventory?merchantId=30061");
    expect(window.location.pathname).toBe("/workbench/inventory");
    expect(runtime.screens).toEqual([]);
  });

  it("保留入库、出库、员工操作记录及团队的原路由组件", async () => {
    mounted = await mount("/workbench/inbound");
    for (const path of ["/workbench/outbound", "/workbench/user-records", "/teams", "/staff"]) await mounted.navigate(path);
    expect(runtime.screens.map(screen => screen.path)).toEqual(["/workbench/inbound", "/workbench/outbound", "/workbench/user-records", "/teams", "/staff"]);
    expect(runtime.screens.find(screen => screen.path === "/teams")?.kind).toBe("organization");
  });
});
