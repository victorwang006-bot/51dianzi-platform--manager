// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  permissions: ["materials.read", "messages.read", "orders.read"] as string[],
  unread: vi.fn(async () => ({ total: 7 })),
  queryOptions: {} as Record<string, unknown>,
  markSeen: vi.fn(),
  navigate: vi.fn(),
  preload: vi.fn(),
  utils: {
    client: { business: { navigation: { query: async () => ({}) } } },
    moduleNotification: { summary: {
      cancel: async () => {}, getData: () => undefined,
      setData: () => {}, invalidate: async () => {},
    } },
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({
  user: { id: 6001, role: "admin", adminRole: "operation", permissions: state.permissions },
  loading: false, logout: () => {},
}) }));
vi.mock("wouter", () => ({ useLocation: () => ["/materials", state.navigate], useSearch: () => "" }));
vi.mock("@/lib/trpc", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return { trpc: {
    useUtils: () => state.utils,
    message: { unreadCount: { useQuery: (_input: unknown, options: Record<string, unknown>) => {
      state.queryOptions = options;
      return useQuery({ queryKey: ["operations-unread"], queryFn: state.unread, ...options });
    } } },
    moduleNotification: {
      summary: { useQuery: () => ({ data: { counts: { merchants: 0, orders: 4, reviews: 0, portalUsers: 0 } } }) },
      markSeen: { useMutation: () => ({ mutate: state.markSeen }) },
    },
  } };
});
vi.mock("@/lib/businessNavigationQuery", () => ({
  getBusinessNavigationQueryKey: (id: number) => ["business-navigation", id],
  shouldRetryBusinessNavigation: () => false,
  getBusinessNavigationDisplayState: () => ({ status: "ready", workbenchCapabilities: [] }),
}));
vi.mock("@/lib/adminRouteChunks", () => ({ preloadAdminRoute: state.preload }));
vi.mock("./Logo", () => ({ Logo: () => React.createElement("span", null, "Logo") }));
// Test the supplied renderBadge defensively even if a caller accidentally asks
// for a now-invisible /messages item. Navigation itself belongs to other tests.
vi.mock("./admin/AdminWorkspaceNavigation", () => ({
  AdminWorkspaceLocation: () => null,
  AdminWorkspaceTabs: ({ renderBadge, onPreload }: {
    renderBadge: (item: { path: string; notificationModule?: string }) => React.ReactNode;
    onPreload: (item: { path: string; chunk: string }) => void;
  }) => React.createElement("div", null,
    React.createElement("div", { "data-count": "messages" }, renderBadge({ path: "/messages" })),
    React.createElement("div", { "data-count": "orders" }, renderBadge({ path: "/orders", notificationModule: "orders" })),
    React.createElement("button", { onMouseEnter: () => onPreload({ path: "/messages", chunk: "messages" }), onFocus: () => onPreload({ path: "/messages", chunk: "messages" }) }, "消息入口"),
  ),
}));
import DashboardLayout from "./DashboardLayout";

let root: Root;
let host: HTMLDivElement;
let cache: QueryClient;
async function render() {
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: cache }, React.createElement(DashboardLayout, null, "业务内容")));
    await new Promise(resolve => setTimeout(resolve, 10));
  });
}
async function focus() {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await new Promise(resolve => setTimeout(resolve, 15));
  });
}
function count(name = "messages") { return host.querySelector(`[data-count="${name}"]`)?.textContent; }

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  const forbidden = () => { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); };
  vi.stubGlobal("fetch", vi.fn(forbidden));
  vi.stubGlobal("XMLHttpRequest", vi.fn(forbidden));
  state.permissions = ["materials.read", "messages.read", "orders.read"];
  vi.clearAllMocks();
  state.unread.mockResolvedValue({ total: 7 });
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  cache.setQueryData(["operations-unread"], { total: 7 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  cache.clear();
  host.remove();
  focusManager.setFocused(undefined);
  expect(fetch).not.toHaveBeenCalled();
  expect(XMLHttpRequest).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("DashboardLayout operations message badge", () => {
  it("immediately suppresses old unread on permission revocation and preserves other module badges", async () => {
    await render();
    expect(count()).toBe("7");
    expect(count("orders")).toBe("4");
    state.permissions = ["materials.read", "orders.read"];
    await render();
    expect(count()).toBe("");
    expect(count("orders")).toBe("4");
    expect(cache.getQueryData(["operations-unread"])).toEqual({ total: 7 });
    await focus();
    expect(state.unread).not.toHaveBeenCalled();
    expect(state.queryOptions).toMatchObject({ enabled: false, refetchInterval: false });
  });

  it("refreshes even fresh cached unread when window regains focus, hiding failed old data until recovery", async () => {
    await render();
    expect(state.unread).not.toHaveBeenCalled();
    expect(state.queryOptions).toMatchObject({ enabled: true, refetchInterval: 30000, refetchOnWindowFocus: "always" });
    state.unread.mockRejectedValueOnce(new Error("temporary failure"));
    await focus();
    expect(state.unread).toHaveBeenCalledTimes(1);
    expect(cache.getQueryData(["operations-unread"])).toEqual({ total: 7 });
    expect(count()).toBe("");
    expect(count("orders")).toBe("4");
    state.unread.mockResolvedValue({ total: 2 });
    await focus();
    expect(state.unread).toHaveBeenCalledTimes(2);
    expect(count()).toBe("2");
  });

  it("hover/focus only preloads the entry and never marks operations messages as read", async () => {
    await render();
    const button = Array.from(host.querySelectorAll("button")).find(node => node.textContent === "消息入口")!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      button.focus();
    });
    expect(state.preload).toHaveBeenCalled();
    expect(state.markSeen).not.toHaveBeenCalled();
    expect(state.unread).not.toHaveBeenCalled();
    expect(count()).toBe("7");
  });
});
