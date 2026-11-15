// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ mountedPaths: [] as string[], fetch: vi.fn() }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 6001, role: "admin", adminRole: "super_admin", hasNativeAdminAccount: true }, loading: false }) }));
vi.mock("./lib/adminRouteChunks", () => {
  const page = () => null;
  return { LazyOrganization: page, LazyAdmins: page, LazyAnalytics: page, LazyBusinessWorkbench: () => { fixture.mountedPaths.push(window.location.pathname); return null; }, LazyExceptionLogs: page, LazyForbidden: page, LazyLogin: page, LazyMaterials: page, LazyMerchantDetail: page, LazyMerchants: page, LazyMessages: page, LazyNotFound: page, LazyOfficialChannelInventory: page, LazyOrders: page, LazyPortalUsers: page, LazyProfile: page, LazyReviews: page, LazyStaff: page };
});
vi.mock("./components/DashboardLayoutSkeleton", () => ({ DashboardLayoutSkeleton: () => null }));
vi.mock("./components/ErrorBoundary", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("./contexts/ThemeContext", () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/ui/tooltip", () => ({ TooltipProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
import App from "./App";

beforeEach(() => { Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true }); fixture.mountedPaths = []; fixture.fetch.mockReset().mockImplementation(() => { throw new Error("UNEXPECTED_RETIRED_PAGE_NETWORK"); }); vi.stubGlobal("fetch", fixture.fetch); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("App procurement orders pre-mount retirement", () => {
  it.each(["/workbench/procurement-orders", "/workbench/procurement-orders/quote", "/workbench/procurement-orders/accepted", "/workbench/procurement-orders/create", "/workbench/procurement-orders/99/deep", "/workbench/procurement/orders", "/workbench/procurement/orders/99"])("%s redirects before mounting a business page or requesting retired data", async path => {
    window.history.replaceState(null, "", `${path}?merchantId=30061&returnTo=/orders&legacyMode=invoice`);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(App)));
      expect(window.location.pathname).toBe("/workbench/inbound"); expect(window.location.search).toBe("?merchantId=30061");
      expect(fixture.mountedPaths.length).toBeGreaterThan(0); expect(fixture.mountedPaths.every(path => path === "/workbench/inbound")).toBe(true);
      expect(fixture.fetch).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
