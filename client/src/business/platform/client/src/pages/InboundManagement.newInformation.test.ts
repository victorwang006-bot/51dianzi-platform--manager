// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

const runtime = vi.hoisted(() => ({
  rows: [] as any[], query: {} as Record<string, any>, options: [] as any[],
  newIds: new Set<string>(), witnessed: new Set<string>(),
  verified: true, activeScope: "scope-301", location: "/inbound", merchantId: 30061,
}));
vi.mock("../../../../BusinessContentFrame", () => ({ default: ({ children }: any) => children }));
vi.mock("../../../../BusinessScope", () => ({
  businessStorageScope: () => runtime.activeScope,
  useBusinessScope: () => ({ frontUser: { id: 201 }, merchantId: runtime.merchantId,
    staffPrincipal: { frontendUserId: 201 }, storageScope: "scope-301",
    contextVerification: { state: runtime.verified ? "verified" : "revalidating", identity: "scope-301" },
  }),
}));
vi.mock("../../../../../lib/adminNewInformation", async importOriginal => ({
  ...(await importOriginal<any>()),
  useAdminNewInformationContextRows: (options: any) => {
    runtime.options.push(options);
    return { getRow: (id: string) => ({
      isNew: options.listReady && runtime.newIds.has(id),
      ref: (node: HTMLElement | null) => { if (node) runtime.witnessed.add(id); },
    }) };
  },
}));
// Identity readiness is an independent dependency; this test does not mount
// the auth provider that useCompanyStockScope normally requires.
vi.mock("../components/companyStock/useCompanyStockSession", () => ({
  useCompanyStockScope: () => ({ ready: true, identityKey: "scope-301", storageScope: "scope-301" }),
}));
vi.mock("wouter", () => ({ useLocation: () => [runtime.location, vi.fn()] }));
vi.mock("../../../../api/business-trpc", () => {
  const query = (name: string) => ({
    useQuery: () => name === "list"
      ? { data: runtime.rows, isLoading: false, refetch: vi.fn(), ...runtime.query }
      : { data: undefined, isFetching: false, isLoading: false, isError: false },
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    invalidate: vi.fn(), cancel: vi.fn(), fetch: vi.fn(),
  });
  const domain = new Proxy({}, { get: (_target, name: string) => query(name) });
  const utils = new Proxy({}, { get: () => domain });
  return { trpc: new Proxy({ useUtils: () => utils }, { get: (target, name: string) => name === "useUtils" ? target.useUtils : domain }) };
});
import InboundManagement from "./InboundManagement";

let root: Root;
let host: HTMLDivElement;
const latest = () => runtime.options.at(-1);
async function renderPage() {
  await act(async () => root.render(createElement(InboundManagement)));
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  // The repository's base Vitest config uses classic JSX; production Vite is automatic.
  (globalThis as any).React = React;
  runtime.rows = Array.from({ length: 11 }, (_, index) => ({
    id: index + 1, slipNo: `RK-${index + 1}`, partNumber: `PART-${index + 1}`, brand: "Brand", qty: 1,
    status: "in_transit", paymentCategory: "unpaid", operator: "Buyer", inboundDate: "2026-11-17", paymentPercentage: null,
  }));
  runtime.query = { isSuccess: true, isError: false, isFetching: false, isPlaceholderData: false };
  runtime.options = []; runtime.witnessed = new Set(); runtime.newIds = new Set(["inbound:2", "inbound:11"]);
  runtime.verified = true; runtime.activeScope = "scope-301"; runtime.location = "/inbound"; runtime.merchantId = 30061;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("actual inbound page new information wiring (mock transport, no DB)", () => {
  it("inspects only the ten actual pageRows and attaches refs to actual table rows", async () => {
    await renderPage();
    expect(latest()).toMatchObject({ module: "inbound", scope: "30061", listReady: true });
    expect(latest().refs).toEqual(Array.from({ length: 10 }, (_, i) => `inbound:${i + 1}`));
    expect(runtime.witnessed).toEqual(new Set(latest().refs));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(host.querySelector("tbody tr")?.textContent).toContain("RK-2");
    expect(host.querySelector("tbody tr")?.querySelector('[role="status"]')?.textContent).toBe("新");
    expect(host.textContent).not.toContain("RK-11");
  });
  it("next page keeps membership/pagination and never marks the undisplayed full array", async () => {
    await renderPage();
    const next = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "下一页")!;
    await act(async () => next.click());
    expect(latest().refs).toEqual(["inbound:11"]);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(host.querySelector("tbody tr")?.textContent).toContain("RK-11");
    expect(host.textContent).toContain("第 2 / 2 页");
  });
  it.each([
    { isSuccess: false }, { isError: true }, { isFetching: true }, { isPlaceholderData: true },
  ])("does not allow receipts for pending/error/fetching/placeholder query %j", async flags => {
    runtime.query = { ...runtime.query, ...flags };
    await renderPage();
    expect(latest().listReady).toBe(false);
    expect(host.querySelector('tbody [role="status"]')).toBeNull();
  });
  it("revalidation, inactive identity and hidden route cannot confirm displayed rows", async () => {
    runtime.verified = false;
    await renderPage(); expect(latest().listReady).toBe(false);
    runtime.verified = true; runtime.activeScope = "different-account";
    await renderPage(); expect(latest().listReady).toBe(false);
    runtime.activeScope = "scope-301"; runtime.location = "/inventory";
    await renderPage(); expect(latest().listReady).toBe(false);
  });
  it("does not sort across pages or alter query filters just to prioritize new rows", async () => {
    runtime.newIds = new Set(["inbound:11"]);
    await renderPage();
    expect(host.querySelector("tbody tr")?.textContent).toContain("RK-1");
    expect(latest().refs).not.toContain("inbound:11");
    expect(host.querySelector("tbody")?.querySelector('[role="status"]')).toBeNull();
  });
});
