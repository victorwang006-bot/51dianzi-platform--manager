// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelInventoryNavigationTab, ChannelInventoryNavigationView } from "@/lib/channelInventoryNavigation";
import type { SalesOrderSource } from "@/lib/salesOrderWorkspace";

type NavigationItem = { path: string; workbenchCapability?: string; chunk?: string; notificationModule?: string };
type Navigate = (item: NavigationItem, tab?: ChannelInventoryNavigationTab, view?: ChannelInventoryNavigationView, source?: SalesOrderSource) => void;
const runtime = vi.hoisted(() => ({
  capabilities: [] as string[],
  items: [] as NavigationItem[],
  navigate: undefined as Navigate | undefined,
  setLocation: vi.fn(),
  buildTarget: vi.fn(),
  targetOverride: undefined as string | null | undefined,
  preload: vi.fn(),
  markSeen: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({
  user: { id: 6001, role: "admin", adminRole: "merchant_mgr", hasNativeAdminAccount: true, permissions: ["officialInventory.read", "messages.read"] },
  loading: false, logout: () => {},
}) }));
vi.mock("wouter", () => ({ useLocation: () => ["/workbench/orders", runtime.setLocation], useSearch: () => "merchantId=31" }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({
    client: { business: { navigation: { query: async () => ({}) } } },
    moduleNotification: { summary: { cancel: async () => {}, getData: () => undefined, setData: () => {}, invalidate: async () => {} } },
  }),
  message: { unreadCount: { useQuery: () => ({ data: { total: 0 } }) } },
  moduleNotification: {
    summary: { useQuery: () => ({}) },
    markSeen: { useMutation: () => ({ mutate: runtime.markSeen }) },
  },
} }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ isPending: false, isSuccess: true, isError: false, data: {}, isFetching: false }) }));
vi.mock("@/lib/businessNavigationQuery", () => ({
  getBusinessNavigationQueryKey: (id: unknown) => ["business-navigation", id],
  shouldRetryBusinessNavigation: () => false,
  getBusinessNavigationDisplayState: () => ({ status: "ready", workbenchCapabilities: runtime.capabilities }),
}));
vi.mock("@/lib/businessNavigation", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/businessNavigation")>();
  return { buildBusinessNavigationTarget: (current: string, target: string) => {
    runtime.buildTarget(current, target);
    return runtime.targetOverride === undefined ? original.buildBusinessNavigationTarget(current, target) : runtime.targetOverride;
  } };
});
vi.mock("@/lib/adminRouteChunks", () => ({ preloadAdminRoute: runtime.preload }));
vi.mock("./Logo", () => ({ Logo: () => React.createElement("span", null, "Logo") }));
vi.mock("./admin/AdminWorkspaceNavigation", () => ({
  AdminWorkspaceLocation: () => null,
  AdminWorkspaceTabs: ({ items, onNavigate }: { items: NavigationItem[]; onNavigate: Navigate }) => {
    runtime.items = items;
    runtime.navigate = onNavigate;
    return null;
  },
}));
import DashboardLayout from "./DashboardLayout";
let root: Root;
let host: HTMLDivElement;
let previousLocation: string;
async function render() {
  await act(async () => root.render(React.createElement(DashboardLayout, null, React.createElement("article", null, "虚构业务内容"))));
}
function original(path: string) {
  const item = runtime.items.find(item => item.path === path);
  expect(item).toBeDefined();
  return item!;
}
beforeEach(async () => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  const forbidden = () => { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); };
  vi.stubGlobal("fetch", vi.fn(forbidden));
  vi.stubGlobal("XMLHttpRequest", vi.fn(forbidden));
  vi.stubGlobal("WebSocket", vi.fn(forbidden));
  previousLocation = window.location.pathname + window.location.search + window.location.hash;
  window.history.replaceState({}, "", "/workbench/orders?merchantId=31&returnTo=%2Forders#detail-9");
  runtime.capabilities = ["marketplace.seller", "crm.sales_orders", "inventory.channel"];
  runtime.targetOverride = undefined;
  runtime.items = [];
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  window.history.replaceState({}, "", previousLocation);
  expect(fetch).not.toHaveBeenCalled();
  expect(XMLHttpRequest).not.toHaveBeenCalled();
  expect(WebSocket).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("DashboardLayout canonical sales source callback", () => {
  it.each([
    { path: "/workbench/outbound", capability: "marketplace.seller", source: "mall" as const },
    { path: "/workbench/orders", capability: "crm.sales_orders", source: "business" as const },
  ])("uses the original $path $capability object before appending $source", async ({ path, capability, source }) => {
    runtime.capabilities = [capability];
    await render();
    const item = original(path);
    expect(item.workbenchCapability).toBe(capability);
    const content = host.querySelector("article");
    await act(async () => runtime.navigate!(item, undefined, undefined, source));
    expect(runtime.buildTarget).toHaveBeenCalledWith("/workbench/orders?merchantId=31&returnTo=%2Forders", path);
    expect(runtime.setLocation.mock.calls).toEqual([[`/workbench/orders?merchantId=31&orderSource=${source}`]]);
    expect(item.path).toBe(path);
    expect(item.workbenchCapability).toBe(capability);
    expect(runtime.capabilities).toEqual([capability]);
    expect(host.querySelector("article")).toBe(content);
    expect(runtime.preload).not.toHaveBeenCalled();
    expect(runtime.markSeen).not.toHaveBeenCalled();
  });
  it.each(["mall", "business"] as const)("preserves raw authorized target query/hash and duplicate merchant candidates for %s", async source => {
    const path = source === "mall" ? "/workbench/outbound" : "/workbench/orders";
    // Model the already-authorized original target returned by the existing builder.
    runtime.targetOverride = `${path}?merchantId=31&merchantId=32&kw=XQ%20%2F%201&returnTo=%2Forders&orderSource=business#detail-9`;
    await act(async () => runtime.navigate!(original(path), undefined, undefined, source));
    expect(runtime.buildTarget.mock.calls[0][1]).toBe(path);
    expect(runtime.setLocation.mock.calls).toEqual([[`/workbench/orders?merchantId=31&merchantId=32&kw=XQ%20%2F%201&returnTo=%2Forders&orderSource=${source}#detail-9`]]);
  });
  it("does not rewrite an original outbound target when fourth intent is absent", async () => {
    const target = "/workbench/outbound?merchantId=31&returnTo=%2Forders#detail-9";
    runtime.targetOverride = target;
    await act(async () => runtime.navigate!(original("/workbench/outbound")));
    expect(runtime.setLocation).toHaveBeenCalledWith(target);
  });
  it("keeps the original channel tab/view three-argument callback", async () => {
    await act(async () => runtime.navigate!(original("/workbench/channel-inventory"), "materials", "channels"));
    expect(runtime.setLocation.mock.calls).toEqual([["/workbench/channel-inventory?ciTab=materials&ciView=channels"]]);
    expect(runtime.buildTarget).not.toHaveBeenCalled();
  });
  it.each(["mall", "business"] as const)("never converts a rejected original navigation target into %s access", async source => {
    runtime.targetOverride = null;
    await act(async () => runtime.navigate!(original(source === "mall" ? "/workbench/outbound" : "/workbench/orders"), undefined, undefined, source));
    expect(runtime.buildTarget).toHaveBeenCalledTimes(1);
    expect(runtime.setLocation).not.toHaveBeenCalled();
  });
  it("rejects a fabricated /orders object instead of borrowing the seller capability", async () => {
    const seller = original("/workbench/outbound");
    await act(async () => runtime.navigate!({ ...seller, path: "/workbench/orders" }, undefined, undefined, "mall"));
    expect(runtime.buildTarget).not.toHaveBeenCalled();
    expect(runtime.setLocation).not.toHaveBeenCalled();
    expect(seller.path).toBe("/workbench/outbound");
    expect(seller.workbenchCapability).toBe("marketplace.seller");
  });
  it("rejects an original menu object after its capability is revoked without expanding another scope", async () => {
    const seller = original("/workbench/outbound");
    runtime.capabilities = ["crm.sales_orders"];
    await render();
    await act(async () => runtime.navigate!(seller, undefined, undefined, "mall"));
    expect(runtime.buildTarget).not.toHaveBeenCalled();
    expect(runtime.setLocation).not.toHaveBeenCalled();
    expect(runtime.capabilities).toEqual(["crm.sales_orders"]);
  });
});
