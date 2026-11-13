import { createRequire } from "node:module";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: {
      id: 6001,
      adminRole: "super_admin",
      permissions: ["materials.read"],
      hasNativeAdminAccount: true,
    },
    loading: false,
  }),
}));

vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("./components/DashboardLayoutSkeleton", () => ({
  DashboardLayoutSkeleton: () => null,
}));
vi.mock("./components/ErrorBoundary", () => ({
  default: ({ children }: { children: unknown }) => children,
}));
vi.mock("./contexts/ThemeContext", () => ({
  ThemeProvider: ({ children }: { children: unknown }) => children,
}));
vi.mock("./lib/adminRouteChunks", async () => {
  const { createElement: element, useEffect } = await import("react");
  const EmptyScreen = () => null;
  const LazyBusinessWorkbench = () => {
    useEffect(() => {
      runtime.mounts += 1;
      return () => {
        runtime.unmounts += 1;
      };
    }, []);
    return element(
      "main",
      { "data-testid": "stable-business-workbench" },
      "稳定业务工作台"
    );
  };
  return {
    LazyAdmins: EmptyScreen,
    LazyAnalytics: EmptyScreen,
    LazyBusinessWorkbench,
    LazyExceptionLogs: EmptyScreen,
    LazyForbidden: EmptyScreen,
    LazyLogin: EmptyScreen,
    LazyMaterials: EmptyScreen,
    LazyMerchantDetail: EmptyScreen,
    LazyMerchants: EmptyScreen,
    LazyMessages: EmptyScreen,
    LazyNotFound: () => element("h1", null, "未找到页面"),
    LazyOfficialChannelInventory: EmptyScreen,
    LazyOrders: EmptyScreen,
    LazyPortalUsers: EmptyScreen,
    LazyProfile: EmptyScreen,
    LazyReviews: EmptyScreen,
    LazyStaff: EmptyScreen,
  };
});

import App from "./App";

const requireAdmin = createRequire(import.meta.url);
const { JSDOM } = requireAdmin("jsdom") as {
  JSDOM: new (
    html: string,
    options: { url: string }
  ) => {
    window: Window & typeof globalThis & { close(): void };
  };
};

const legalWorkbenchRoutes = [
  // Retired/default entry redirects are covered in App.closedEntries.test.ts;
  // only concrete open routes promise continuity without a redirect boundary.
  "/workbench/inbound",
  "/workbench/channel-inventory",
  "/workbench/customers/customer-12",
  "/workbench/customers",
  "/workbench/customer-demands",
  "/workbench/orders",
  "/workbench/outbound",
  "/workbench/inquiries",
  "/workbench/chat",
  "/workbench/procurement-demands",
  "/workbench/procurement-orders/quote",
  "/workbench/procurement-orders/accepted",
  "/workbench/procurement-orders/create",
  "/workbench/procurement-orders",
  "/workbench/add-user",
  "/workbench/user-records",
  "/workbench/company-info",
  "/workbench/customers/new/customer-12",
  "/workbench/sales-orders",
  "/workbench/procurement/demands",
  "/workbench/procurement/orders",
  "/workbench/demand-quotes",
  "/workbench/company",
] as const;

type MountedApp = {
  container: HTMLElement;
  navigate(path: string): Promise<void>;
  unmount(): Promise<void>;
};

async function mountApp(initialPath: string): Promise<MountedApp> {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: `http://admin.test${initialPath}` }
  );
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: dom.window.navigator,
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    history: dom.window.history,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    PopStateEvent: dom.window.PopStateEvent,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const [reactModule, { createRoot }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
  ]);
  (globalThis as typeof globalThis & { React?: unknown }).React = reactModule;
  const container = dom.window.document.getElementById("root");
  if (!container) throw new Error("APP_WORKBENCH_PERSISTENCE_ROOT_MISSING");
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(App));
  });

  return {
    container,
    async navigate(path: string) {
      await act(async () => {
        dom.window.history.pushState({}, "", path);
        dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

describe("App workbench route persistence", () => {
  let mounted: MountedApp | undefined;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = undefined;
    runtime.mounts = 0;
    runtime.unmounts = 0;
    vi.unstubAllGlobals();
  });

  it("keeps one workbench mount while walking every legal business route family", async () => {
    mounted = await mountApp(legalWorkbenchRoutes[0]);
    expect(
      mounted.container.querySelector('[data-testid="stable-business-workbench"]')
    ).not.toBeNull();
    expect(runtime.mounts).toBe(1);
    expect(runtime.unmounts).toBe(0);

    for (const route of legalWorkbenchRoutes.slice(1)) {
      await mounted.navigate(route);
      expect(
        mounted.container.querySelector(
          '[data-testid="stable-business-workbench"]'
        )
      ).not.toBeNull();
      expect(runtime.mounts).toBe(1);
      expect(runtime.unmounts).toBe(0);
    }
  });

  it("does not use the workbench component for an unknown workbench path", async () => {
    mounted = await mountApp("/workbench/not-a-registered-business-path");

    expect(
      mounted.container.querySelector('[data-testid="stable-business-workbench"]')
    ).toBeNull();
    expect(mounted.container.textContent).toContain("未找到页面");
    expect(runtime.mounts).toBe(0);
  });
});
