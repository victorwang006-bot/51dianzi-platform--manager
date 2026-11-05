// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router, Route } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  identity: "", ready: true, contextError: false, detailError: false,
  enterpriseId: 31, detail: null as any, getOptions: [] as any[],
}));
vi.mock("../hooks/usePageIdentity", () => ({ usePageIdentity: () => runtime.identity }));
vi.mock("../../../../BusinessContentFrame", () => ({ default: ({ children }: any) => children }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../components/customers/CustomerContactsManager", () => ({ CustomerContactsManager: () => null }));
vi.mock("../components/customerDemands/CustomerDemandHistory", () => ({ CustomerDemandHistory: () => null }));
vi.mock("../components/customers/CustomerFields", () => ({ CustomerFields: ({ value, onChange }: any) => React.createElement("div", {},
  React.createElement("span", { "data-editor-name": true }, value.name),
  React.createElement("button", { onClick: () => onChange({ ...value, name: "PRIVATE UNSAVED DRAFT" }) }, "synthetic-edit")) }));
vi.mock("../components/customers/customerContacts", () => ({
  useCustomerContactScope: () => ({ ready: runtime.ready, scope: runtime.ready ? { actorUserId: 7, enterpriseId: runtime.enterpriseId, canManageAll: false } : null,
    identityKey: `${runtime.identity}:${runtime.enterpriseId}:${runtime.ready}` }),
  contactErrorMessage: (error: Error) => error.message, customerContactBaseData: () => ({}),
  isDuplicateContactConflict: () => false, validateCustomerContactBase: () => ({}), withCustomerContactScope: (_scope: unknown, input: unknown) => input,
}));
vi.mock("../../../../api/business-trpc", () => ({ trpc: {
  useUtils: () => ({ customer: { get: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
  customer: {
    context: { useQuery: () => ({ data: { actorUserId: 7, canManageAll: false, members: [] }, isPending: false, isError: runtime.contextError, error: new Error("授权已撤销"), refetch: vi.fn() }) },
    get: { useQuery: (_input: unknown, options: any) => { runtime.getOptions.push(options); return { data: runtime.detail, isPending: false, isError: runtime.detailError, error: new Error("客户访问已撤销"), refetch: vi.fn() }; } },
    updateBasic: { useMutation: () => ({ isPending: false }) }, addFollowUp: { useMutation: () => ({ isPending: false }) },
    transfer: { useMutation: () => ({ isPending: false }) }, archive: { useMutation: () => ({ isPending: false }) }, restore: { useMutation: () => ({ isPending: false }) },
  },
} }));
import CustomerDetail from "./CustomerDetail";
import * as memory from "../lib/pageMemory";
const nativeReplace = History.prototype.replaceState;
const META = "__d51PageMemory";
const defaults = { keyword: "", grade: "", stage: "", scope: "mine", assignedUserId: "", due: "all", archived: false, starredOnly: false };
let root: Root;
let host: HTMLDivElement;
let serial = 0;
const record = (changes: any = {}) => ({ id: 801, enterpriseId: 31, name: "SYNTHETIC CURRENT CUSTOMER", contactName: "PRIVATE CONTACT", phone: "PRIVATE PHONE", email: "", address: "", province: "", city: "", district: "", source: "", scale: "unknown", grade: "A", stage: "following", industryCode: "electronic_components", nextFollowUpAt: null, version: 1, archivedAt: null, assignedUserId: 7, assignedName: "synthetic seller", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...changes });
function pop() { return new Promise<void>(resolve => window.addEventListener("popstate", () => resolve(), { once: true })); }
async function render() { await act(async () => root.render(React.createElement(Router, { base: "/workbench" }, React.createElement(Route, { path: "/customers/:id", component: CustomerDetail })))); }
function button(label: string) { const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.trim() === label); if (!found) throw new Error(`missing ${label}`); return found; }
async function click(label: string) { await act(async () => button(label).click()); }
async function prepareSource() {
  nativeReplace.call(history, {}, "", "/workbench/customers?merchantId=30061&source=actual"); memory.setPageMemoryScope(runtime.identity);
  memory.writePageSlot("appliedFilters", { ...defaults, keyword: "applied UI", starredOnly: true }); memory.writePageSlot("page", 4);
  history.pushState({}, "", "/workbench/customers/801?merchantId=30061"); await render();
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  runtime.identity = `synthetic-detail:staff:7:admin:101:enterprise:31:merchant:30061:binding:${++serial}`;
  runtime.ready = true; runtime.enterpriseId = 31; runtime.contextError = false; runtime.detailError = false; runtime.getOptions = [];
  runtime.detail = { customer: record(), followUps: [] };
  memory.setPageMemoryScope(null); nativeReplace.call(history, {}, "", "/workbench/customers/801?merchantId=30061");
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => window.clearTimeout(frame));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); memory.setPageMemoryScope(null); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.sequential("actual CustomerDetail memory and authorization rendering", () => {
  it("the detail back button and browser back restore the same exact page-4 starred source", async () => {
    await prepareSource(); const source = history.state[META].previous;
    const first = pop(); await click("返回上一页"); await act(async () => first);
    expect(history.state[META].id).toBe(source); expect(memory.readPageSlot("page", 1)).toBe(4);
    expect(memory.readPageSlot("appliedFilters", defaults)).toEqual({ ...defaults, keyword: "applied UI", starredOnly: true });
    await act(async () => history.pushState({}, "", "/workbench/customers/801?merchantId=30061")); await render();
    const second = pop(); await act(async () => { history.back(); await second; });
    expect(history.state[META].id).toBe(source); expect(memory.readPageSlot("page", 1)).toBe(4);
  });

  it("orphan detail back uses actual wouter /workbench+merchant bridge and the saved source URL snapshot", async () => {
    await prepareSource();
    memory.setPageMemoryScope(null);
    nativeReplace.call(history, { [META]: { id: "orphan-source", scope: runtime.identity } }, "", "/workbench/customers/801?merchantId=30061");
    const back = vi.spyOn(history, "back"); await render(); await click("返回上一页");
    expect(back).not.toHaveBeenCalled(); expect(window.location.pathname).toBe("/workbench/customers");
    expect(window.location.search).toBe("?merchantId=30061&source=actual"); expect(memory.readPageSlot("page", 1)).toBe(4);
  });

  it("does not render retained business data after context/get revocation or enterprise mismatch", async () => {
    await render(); expect(host.textContent).toContain("PRIVATE CONTACT");
    runtime.contextError = true; await render(); expect(host.textContent).not.toContain("PRIVATE CONTACT"); expect(host.textContent).toContain("授权已撤销");
    runtime.contextError = false; runtime.detailError = true; await render(); expect(host.textContent).not.toContain("PRIVATE CONTACT"); expect(host.textContent).toContain("客户访问已撤销");
    runtime.detailError = false; runtime.enterpriseId = 32; await render(); expect(host.textContent).not.toContain("SYNTHETIC CURRENT CUSTOMER");
  });

  it("binding/account identity changes cannot reuse a dirty editor for the same customer id", async () => {
    await render(); await click("展开"); await click("synthetic-edit"); expect(host.textContent).toContain("PRIVATE UNSAVED DRAFT");
    runtime.identity += "-new-binding"; runtime.detail = { customer: record({ name: "NEW IDENTITY DATA" }), followUps: [] };
    await render(); expect(host.textContent).not.toContain("PRIVATE UNSAVED DRAFT"); await click("展开");
    expect(host.querySelector("[data-editor-name]")?.textContent).toBe("NEW IDENTITY DATA");
    const raw = sessionStorage.getItem("51dianzi:page-memory:v1:" + runtime.identity)!;
    expect(raw).not.toContain("PRIVATE"); expect(raw).not.toContain("NEW IDENTITY DATA");
  });

  it("blocks reads/display while current contact authority is unavailable and clears private drafts", async () => {
    await render(); await click("展开"); await click("synthetic-edit");
    runtime.ready = false; await render(); expect(host.textContent).not.toContain("PRIVATE"); expect(runtime.getOptions.at(-1).enabled).toBe(false);
    runtime.ready = true; await render(); await click("展开"); expect(host.textContent).not.toContain("PRIVATE UNSAVED DRAFT");
    expect(runtime.getOptions.at(-1)).toMatchObject({ enabled: true, staleTime: 0, refetchOnMount: "always", placeholderData: undefined });
  });
});
