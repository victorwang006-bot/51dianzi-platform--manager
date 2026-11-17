// @vitest-environment jsdom
// Native API/client calls are mocks; no DB, browser, network or business write.
import React, { act } from "react";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficialMallMaterial } from "@shared/officialMall";
import { ADMIN_NEW_INFORMATION_MODULES } from "@shared/adminNewInformation";
import { AdminNewInformationProvider, type AdminNewInformationClient } from "@/lib/adminNewInformation";
const h = vi.hoisted(() => ({
  user: { id: 71, hasNativeAdminAccount: true },
  status: vi.fn(), list: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user, isAuthenticated: true, loading: false, error: null }) }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { officialMall: { status: { query: h.status }, list: { query: h.list } } } }) } }));
import MallMaterials from "./MallMaterials";
class Observer {
  static instances: Observer[] = [];
  targets = new Set<Element>();
  constructor(private callback: IntersectionObserverCallback) { Observer.instances.push(this); }
  observe(el: Element) { this.targets.add(el); }
  unobserve(el: Element) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
  fire(predicate: (el: Element) => boolean) {
    this.callback([...this.targets].map(target => ({ target, isIntersecting: predicate(target), intersectionRatio: predicate(target) ? 1 : 0 })) as IntersectionObserverEntry[], this as any);
  }
}
const row = (id: number): OfficialMallMaterial => ({
  id, partNumber: `LOCAL-${id}`, brand: "LOCAL-BRAND", pkg: "QFN", dateCode: "", qtyOnSale: 10, qtyStock: null, qtyOrder: null,
  priceEx: "1.230000", taxIncluded: true, moq: 1, spq: 1, leadTime: "人工确认3天", ladderPrices: [], note: "", revision: 1, status: "draft",
  teamId: 11, ownerAdminUserId: 72, createdByAdminUserId: 72, updatedByAdminUserId: 72, publishedByAdminUserId: null,
  createdAt: "2026-11-17T00:45:00Z", updatedAt: "2026-11-17T00:45:00Z", publishedAt: null,
});
let root: Root, host: HTMLDivElement, queryClient: QueryClient, api: AdminNewInformationClient;
let visible: boolean;
let apiAccount = 71;
let withProvider = true;
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); Observer.instances = []; visible = true; apiAccount = 71; withProvider = true;
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  h.user = { id: 71, hasNativeAdminAccount: true };
  h.status.mockResolvedValue({ available: true, permissions: { read: true, write: true, publish: true }, scope: { adminUserId: 71, teamId: 11, teamRole: "member", isSuperAdmin: false } });
  h.list.mockImplementation(async (input: { page: number }) => ({ items: input.page === 1 ? [row(1), row(2)] : [row(3)], total: 31, page: input.page, pageSize: 30 }));
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visible ? "visible" : "hidden");
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("OFFLINE_NO_NETWORK"); }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return { x: 10, y: 20, top: 20, left: 10, bottom: 44, right: 600, width: 590, height: 24, toJSON() {} } as DOMRect;
  });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  api = {
    summary: vi.fn(async () => ({ modules: Object.fromEntries(ADMIN_NEW_INFORMATION_MODULES.map(module => [module, { count: 3, available: true }])) as any })),
    inspect: vi.fn(async ({ refs }) => ({ items: refs.map(id => ({ id, version: "created:2026-11-17T00:45:00.000Z", isNew: id !== "mall-material:1", receipt: `signed:${id}` })) })),
    markDisplayed: vi.fn(async () => ({ accepted: 1, marked: 1 })),
  };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); focusManager.setFocused(true);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); queryClient.clear();
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); focusManager.setFocused(undefined);
});
async function tick(ms = 50) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function render() {
  const page = React.createElement(MallMaterials);
  const node = withProvider ? React.createElement(AdminNewInformationProvider, { client: api, accountKey: apiAccount, canRead: true, moduleCanRead: { mall: true }, children: page }) : page;
  await act(async () => root.render(React.createElement(QueryClientProvider, { client: queryClient }, node)));
  await tick(); await tick();
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(el => el.textContent === text)!;
  expect(button).toBeDefined(); await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true }))); await tick(); await tick();
}
async function intersect(predicate: (el: Element) => boolean) { await act(async () => Observer.instances.forEach(observer => observer.fire(predicate))); await tick(); }

describe("mall native new information real row integration", () => {
  it("inspects only current page, puts new first, and binds observer to actual main tr", async () => {
    await render();
    expect(api.inspect).toHaveBeenCalledWith({ module: "mall", refs: ["mall-material:1", "mall-material:2"], scope: undefined }, expect.anything());
    const rows = [...host.querySelectorAll(".mall-main-table tbody tr")];
    expect(rows.map(el => el.querySelector(".mall-model")?.textContent)).toEqual(["LOCAL-2", "LOCAL-1"]);
    expect(rows[0].textContent).toContain("新"); expect(rows[1].textContent).not.toContain("新");
    expect(Observer.instances.flatMap(observer => [...observer.targets])).toEqual(expect.arrayContaining(rows));
    expect(api.markDisplayed).not.toHaveBeenCalled();
    expect(h.list).toHaveBeenCalledTimes(1);
    expect(h.list.mock.calls[0][0]).toMatchObject({ page: 1, pageSize: 30 });
  });
  it("marks only displayed current-page rows, never unvisited page or non-new row", async () => {
    await render(); await intersect(el => el.textContent?.includes("LOCAL-2") === true);
    expect(api.markDisplayed).toHaveBeenCalledWith({ receipts: ["signed:mall-material:2"] }, expect.anything());
    expect(api.markDisplayed).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(api.markDisplayed).mock.calls)).not.toMatch(/mall-material:1|mall-material:3/);
  });
  it("does not clear page two until explicitly paged and displayed", async () => {
    await render(); await click("下一页");
    expect(h.list.mock.calls.map(call => call[0].page)).toEqual([1, 2]);
    expect(vi.mocked(api.inspect).mock.calls.at(-1)![0].refs).toEqual(["mall-material:3"]);
    expect(api.markDisplayed).not.toHaveBeenCalled();
    await intersect(el => el.textContent?.includes("LOCAL-3") === true);
    expect(api.markDisplayed).toHaveBeenCalledWith({ receipts: ["signed:mall-material:3"] }, expect.anything());
  });
  it("list pending/error are not ready and issue no inspect or marks", async () => {
    const pending = deferred<any>(); h.list.mockReturnValue(pending.promise); await render();
    expect(api.inspect).not.toHaveBeenCalled(); await intersect(() => true); expect(api.markDisplayed).not.toHaveBeenCalled();
    await act(async () => pending.reject(new Error("LOCAL_LIST_FAILURE"))); await tick();
    expect(host.textContent).toContain("LOCAL_LIST_FAILURE"); expect(api.inspect).not.toHaveBeenCalled(); expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it("refetch retains previous business rows but blocks inspect/mark while fetching", async () => {
    await render(); const pending = deferred<any>(); h.list.mockReturnValue(pending.promise);
    await click("刷新"); expect(host.textContent).toContain("LOCAL-2");
    await intersect(() => true); expect(api.markDisplayed).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ items: [row(2)], total: 1 })); await tick();
  });
  it("wrong current native identity never loads or inspects private rows", async () => {
    h.status.mockResolvedValue({ available: true, permissions: { read: true, write: true, publish: true }, scope: { adminUserId: 99, teamId: 11 } });
    await render(); expect(h.list).not.toHaveBeenCalled(); expect(api.inspect).not.toHaveBeenCalled(); expect(api.markDisplayed).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("LOCAL-1");
  });
  it("account switch removes previous rows immediately and rejects stale list generation", async () => {
    const pending = deferred<any>(); h.list.mockReturnValue(pending.promise); await render();
    h.user = { id: 73, hasNativeAdminAccount: true }; apiAccount = 73;
    h.status.mockResolvedValue({ available: true, permissions: { read: true, write: true, publish: true }, scope: { adminUserId: 73, teamId: 12 } });
    h.list.mockResolvedValue({ items: [row(8)], total: 1 }); await render();
    await act(async () => pending.resolve({ items: [row(1), row(2)], total: 2 })); await tick();
    expect(host.textContent).toContain("LOCAL-8"); expect(host.textContent).not.toContain("LOCAL-1");
    expect(vi.mocked(api.inspect).mock.calls.every(call => call[0].refs.every(id => id === "mall-material:8"))).toBe(true);
  });
  it("hidden tab cannot mark displayed rows", async () => {
    await render(); visible = false; await act(async () => document.dispatchEvent(new Event("visibilitychange"))); await intersect(() => true);
    expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it("standalone page without provider falls back to original rows and controls", async () => {
    withProvider = false;
    // React reports caught render errors to console in development; not a page crash.
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(render()).resolves.toBeUndefined();
    expect([...host.querySelectorAll(".mall-model")].map(el => el.textContent)).toEqual(["LOCAL-1", "LOCAL-2"]);
    expect(host.querySelectorAll("[role=status]")).toHaveLength(0);
    expect(host.querySelector(".mall-main-table")).not.toBeNull();
    expect(api.inspect).not.toHaveBeenCalled(); expect(api.markDisplayed).not.toHaveBeenCalled();
    await click("下一页"); expect(host.textContent).toContain("LOCAL-3");
  });
});
