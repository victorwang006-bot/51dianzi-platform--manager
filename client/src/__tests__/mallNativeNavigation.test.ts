// @vitest-environment jsdom
// Offline regression: real DashboardLayout, navigation components/model and
// businessNavigationQuery; only auth, query snapshots and page body are mocked.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type NavigationSnapshot = {
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  isFetching: boolean;
  data: { workbenchCapabilities: readonly string[] } | undefined;
};
const runtime = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  location: "/workbench/mall-materials",
  snapshot: {} as NavigationSnapshot,
  queryOptions: vi.fn(),
  navigationRead: vi.fn(),
  refetch: vi.fn(),
  setLocation: vi.fn(),
  scopeMount: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: runtime.user, loading: false, logout: () => {} }),
}));
vi.mock("wouter", () => ({
  useLocation: () => [runtime.location.split(/[?#]/, 1)[0], runtime.setLocation],
  useSearch: () => runtime.location.includes("?")
    ? runtime.location.slice(runtime.location.indexOf("?") + 1).split("#", 1)[0]
    : "",
}));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({
    client: { business: { navigation: { query: runtime.navigationRead } } },
    moduleNotification: { summary: {
      cancel: async () => {}, getData: () => undefined,
      setData: () => {}, invalidate: async () => {},
    } },
  }),
  message: { unreadCount: { useQuery: () => ({ data: { total: 0 }, isError: false }) } },
  moduleNotification: {
    summary: { useQuery: () => ({}) },
    markSeen: { useMutation: () => ({ mutate: () => {} }) },
  },
} }));
vi.mock("@tanstack/react-query", async importOriginal => ({
  ...await importOriginal<typeof import("@tanstack/react-query")>(),
  useQuery: (options: unknown) => {
    runtime.queryOptions(options);
    // Deliberately retain data even when disabled/pending/error. The actual
    // display-state helper, not this mock, must decide whether it is authorized.
    return { ...runtime.snapshot, refetch: runtime.refetch };
  },
}));
vi.mock("@/lib/adminRouteChunks", () => ({ preloadAdminRoute: () => {} }));
vi.mock("@/components/Logo", () => ({
  Logo: () => React.createElement("span", null, "Logo"),
}));
vi.mock("@/business/MallMaterials", () => ({
  default: () => React.createElement("article", {
    "data-native-mall-child": "true",
  }, "原生商城页面内容"),
}));
vi.mock("@/business/BusinessScope", () => ({
  BusinessScopeProvider: ({ children }: { children: React.ReactNode }) => {
    runtime.scopeMount();
    return React.createElement("section", { "data-front-business-scope": "true" }, children);
  },
  useBusinessScope: () => {
    runtime.scopeMount();
    throw new Error("Native mall must not consume front BusinessScope");
  },
}));

import DashboardLayout from "../components/DashboardLayout";
import OfficialMall from "../pages/OfficialMall";

const authorizedCapabilities = Object.freeze([
  "customers.manage", "inventory.channel", "inquiry.receive",
  "procurement.demands", "inventory.inbound", "crm.sales_orders",
  "marketplace.seller",
]);
const businessTargets = [
  "customers", "inventory", "inquiries", "procurement-management",
  "inventory-management", "sales-orders",
];
const fullTargets = [
  "customers", "inventory", "mall-materials", "inquiries",
  "procurement-management", "inventory-management", "sales-orders", "personal",
];
let host: HTMLDivElement;
let root: Root;
let previousLocation: string;
let previousWidth: number;

function ready(capabilities: readonly string[] = authorizedCapabilities): NavigationSnapshot {
  return {
    isPending: false, isSuccess: true, isError: false, isFetching: false,
    data: { workbenchCapabilities: capabilities },
  };
}
async function render(location = runtime.location, nativePage = false) {
  runtime.location = location;
  window.history.replaceState({}, "", location);
  await act(async () => root.render(nativePage
    ? React.createElement(OfficialMall)
    : React.createElement(DashboardLayout, null,
      React.createElement("article", { "data-page-child": "true" }, "业务页面内容"))));
}
function targets() {
  return Array.from(host.querySelectorAll<HTMLButtonElement>(
    'button[data-navigation-level="1"]',
  )).map(button => button.dataset.workspaceNavTarget);
}
function button(target: string) {
  const found = host.querySelector<HTMLButtonElement>(
    `button[data-workspace-nav-target="${target}"]`,
  );
  expect(found, `authorized navigation button ${target}`).not.toBeNull();
  return found!;
}
async function click(target: string) {
  await act(async () => button(target).click());
}
function lastQuery() {
  return runtime.queryOptions.mock.calls.at(-1)![0] as {
    enabled: boolean; queryKey: readonly unknown[];
  };
}
function expectNoBusinessEntries() {
  for (const target of businessTargets) {
    expect(host.querySelector(`button[data-workspace-nav-target="${target}"]`)).toBeNull();
  }
  expect(host.querySelector('[data-workspace-dropdown-item]')).toBeNull();
}

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  const forbidden = () => { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); };
  vi.stubGlobal("fetch", vi.fn(forbidden));
  vi.stubGlobal("XMLHttpRequest", vi.fn(forbidden));
  vi.stubGlobal("WebSocket", vi.fn(forbidden));
  runtime.navigationRead.mockResolvedValue({ workbenchCapabilities: authorizedCapabilities });
  runtime.refetch.mockResolvedValue({});
  runtime.user = {
    id: 6001, role: "admin", name: "同一登录账号", adminRole: "merchant_mgr",
    hasNativeAdminAccount: true,
    permissions: Object.freeze(["officialInventory.read"]),
  };
  runtime.location = "/workbench/mall-materials";
  runtime.snapshot = ready();
  previousLocation = window.location.pathname + window.location.search + window.location.hash;
  previousWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.history.replaceState({}, "", previousLocation);
  Object.defineProperty(window, "innerWidth", { value: previousWidth, configurable: true });
  expect(fetch).not.toHaveBeenCalled();
  expect(XMLHttpRequest).not.toHaveBeenCalled();
  expect(WebSocket).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("native mall keeps the current account's authorized top navigation", () => {
  it("商城与客户页使用同一账号查询且显示相同六类授权菜单及真实销售下拉", async () => {
    const menus: (string | undefined)[][] = [];
    for (const location of [
      "/workbench/mall-materials?keyword=LOCAL#list",
      "/workbench/customers?merchantId=31",
    ]) {
      await render(location);
      expect(lastQuery()).toMatchObject({
        enabled: true, queryKey: ["business", "navigation", 6001],
      });
      menus.push(targets());
      expect(targets()).toEqual(fullTargets);
      expect(button("inventory-management").textContent).toBe("采购入库");
      expect(button("procurement-management").dataset.workspaceDirectItem)
        .toBe("/workbench/procurement-demands");
      expect(button("inventory-management").dataset.workspaceDirectItem)
        .toBe("/workbench/inbound");
      await click("sales-orders");
      expect(Array.from(host.querySelectorAll('[data-order-source]')).map(node => [
        node.getAttribute("data-order-source"),
        node.getAttribute("data-workspace-dropdown-item"), node.textContent,
      ])).toEqual([
        ["mall", "/workbench/outbound", "商城订单"],
        ["business", "/workbench/orders", "业务订单"],
      ]);
      await click("sales-orders");
    }
    expect(menus[0]).toEqual(menus[1]);
    expect(runtime.setLocation).not.toHaveBeenCalled();
    expect(runtime.user.permissions).toEqual(["officialInventory.read"]);
    expect(runtime.snapshot.data?.workbenchCapabilities).toEqual(authorizedCapabilities);
  });

  it("商城只显示当前实际授权项，撤销业务能力不会借用原生库存读权", async () => {
    await render();
    runtime.snapshot = ready(Object.freeze(["customers.manage"]));
    await render();
    expect(targets()).toEqual(["customers", "mall-materials", "personal"]);
    expect(host.querySelector('[data-workspace-nav-target="inventory"]')).toBeNull();
    expect(host.querySelector('[data-workspace-nav-target="sales-orders"]')).toBeNull();
    expect(host.querySelector('[data-workspace-nav-target="inquiries"]')).toBeNull();
    expect(runtime.user.permissions).toEqual(["officialInventory.read"]);
  });

  it("成功空权限响应不从商城 URL、角色或菜单分组伪造业务入口", async () => {
    runtime.user = { ...runtime.user, adminRole: "", permissions: Object.freeze([]) };
    runtime.snapshot = ready(Object.freeze([]));
    await render("/workbench/mall-materials?merchantId=31&grant=all");
    expect(lastQuery().enabled).toBe(true);
    expectNoBusinessEntries();
    expect(targets()).toEqual(["personal"]);
    expect(host.querySelector('[data-workspace-nav-target="mall-materials"]')).toBeNull();
    expect(host.querySelector('[data-page-child]')?.textContent).toBe("业务页面内容");
    expect(runtime.setLocation).not.toHaveBeenCalled();
  });

  it("切换账号 pending 时丢弃旧授权快照和已打开菜单，查询 key 按账号隔离", async () => {
    await render();
    const firstKey = lastQuery().queryKey;
    await click("sales-orders");
    expect(host.querySelector('[data-workspace-dropdown-item]')).not.toBeNull();
    const child = host.querySelector('[data-page-child]');
    runtime.user = { ...runtime.user, id: 6002 };
    runtime.snapshot = { ...ready(), isPending: true, isSuccess: false, isFetching: true };
    await render();
    expect(firstKey).toEqual(["business", "navigation", 6001]);
    expect(lastQuery()).toMatchObject({
      enabled: true, queryKey: ["business", "navigation", 6002],
    });
    expectNoBusinessEntries();
    expect(targets()).toEqual(["mall-materials", "personal"]);
    expect(host.querySelector('[data-page-child]')).toBe(child);
    expect(runtime.snapshot.data?.workbenchCapabilities).toEqual(authorizedCapabilities);
  });

  it("导航查询 error 即使保留旧 cache 也不漏权限，child 保持渲染且可只读重试", async () => {
    await render();
    const child = host.querySelector('[data-page-child]');
    runtime.snapshot = { ...ready(), isError: true, isSuccess: false };
    await render();
    expectNoBusinessEntries();
    expect(targets()).toEqual(["mall-materials", "personal"]);
    expect(host.querySelector('[data-page-child]')).toBe(child);
    expect(host.querySelector('[data-business-navigation-state="error"]')).not.toBeNull();
    const retry = host.querySelector<HTMLButtonElement>(
      'button[aria-label="只读重新获取业务导航"]',
    );
    expect(retry).not.toBeNull();
    await act(async () => retry!.click());
    expect(runtime.refetch).toHaveBeenCalledOnce();
    runtime.snapshot = ready(Object.freeze(["customers.manage"]));
    await render();
    expect(targets()).toEqual(["customers", "mall-materials", "personal"]);
    expect(host.querySelector('[data-business-navigation-state="error"]')).toBeNull();
    expect(host.querySelector('[data-page-child]')).toBe(child);
    expect(runtime.setLocation).not.toHaveBeenCalled();
  });

  it("商城入口仍同时要求 native account 与官方库存读权，不接受业务能力或 write 替代", async () => {
    for (const permissions of [
      ["business.inventory.read"], ["officialInventory.write"],
    ]) {
      runtime.user = { ...runtime.user, permissions: Object.freeze(permissions) };
      await render();
      expect(host.querySelector('[data-workspace-nav-target="mall-materials"]')).toBeNull();
      expect(button("customers")).not.toBeNull();
      expect(runtime.user.permissions).toEqual(permissions);
    }
    runtime.user = { ...runtime.user, hasNativeAdminAccount: false,
      permissions: Object.freeze(["officialInventory.read"]) };
    await render();
    expect(host.querySelector('[data-workspace-nav-target="mall-materials"]')).toBeNull();
    runtime.user = { ...runtime.user, hasNativeAdminAccount: true };
    await render();
    expect(button("mall-materials").getAttribute("aria-current")).toBe("page");
    expect(runtime.user.permissions).toEqual(["officialInventory.read"]);
    expect(runtime.snapshot.data?.workbenchCapabilities).toEqual(authorizedCapabilities);
  });

  it("缺少当前账号时关闭查询并忽略 retained success 数据，不继承上一账号菜单", async () => {
    runtime.user = { ...runtime.user, id: undefined, adminRole: "", permissions: [] };
    await render();
    expect(lastQuery()).toMatchObject({
      enabled: false, queryKey: ["business", "navigation", "signed-out"],
    });
    expectNoBusinessEntries();
    expect(targets()).toEqual(["personal"]);
    expect(host.querySelector('[data-page-child]')).not.toBeNull();
  });

  it("真实 OfficialMall 只挂原生 DashboardLayout 与商城 child，不挂前台 BusinessScope", async () => {
    await render("/workbench/mall-materials", true);
    const shell = host.querySelector('[data-admin-layout="top-two-level-v1"]');
    const main = shell?.querySelector("main");
    expect(shell).not.toBeNull();
    expect(main?.querySelector('[data-native-mall-child]')?.textContent).toBe("原生商城页面内容");
    expect(targets()).toEqual(fullTargets);
    expect(lastQuery().enabled).toBe(true);
    expect(runtime.scopeMount).not.toHaveBeenCalled();
    expect(host.querySelector('[data-front-business-scope]')).toBeNull();
    runtime.snapshot = { ...ready(), isError: true, isSuccess: false };
    await render("/workbench/mall-materials", true);
    expect(main?.querySelector('[data-native-mall-child]')).not.toBeNull();
    expect(runtime.scopeMount).not.toHaveBeenCalled();
  });
});
