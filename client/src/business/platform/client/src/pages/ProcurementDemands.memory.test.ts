// @vitest-environment jsdom
import React, { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProcurementDemands from "./ProcurementDemands";
import * as memory from "../lib/pageMemory";
const runtime = vi.hoisted(() => ({ identity: "", authorization: "grant:1", y: 0, query: vi.fn(), fresh: true }));
vi.mock("../hooks/usePageIdentity", () => ({ usePageIdentity: () => runtime.identity }));
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => ({ storageScope: runtime.identity, contextVerification: { authorizationVersion: runtime.authorization } }) }));
vi.mock("../../../../BusinessContentFrame", () => ({ default: ({ children }: React.PropsWithChildren) => h(React.Fragment, null, children) }));
vi.mock("../../../../../lib/adminNewInformation", () => ({ useAdminNewInformationContextRows: () => ({ getRow: () => ({ isNew: false, ref: () => {} }) }), useAdminNewInformationRowContext: () => undefined }));
vi.mock("../components/customerDemands/DemandQuoteDialog", () => ({ DemandQuoteDialog: () => null }));
vi.mock("../components/customerDemands/DemandQuoteList", () => ({ DemandQuoteList: () => null }));
vi.mock("../../../../api/business-trpc", () => ({ trpc: { customerDemand: {
  procurementList: { useQuery: (input: { page: number; pageSize: number }, options: any) => {
    if (input.pageSize === 20) runtime.query(input, options);
    return { data: { items: [], total: 80, page: input.page, pageSize: input.pageSize, latestSubmission: null }, isSuccess: runtime.fresh, isFetchedAfterMount: runtime.fresh, isFetching: !runtime.fresh, error: null, refetch: vi.fn().mockResolvedValue({}) };
  } },
} } }));
let host: HTMLDivElement, root: Root, serial = 0;
function render() { act(() => root.render(h(ProcurementDemands))); }
async function frames() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); }); }
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks();
  runtime.identity = `mock-memory-actor:${++serial}`; runtime.authorization = "grant:1"; runtime.fresh = true; runtime.y = 0;
  memory.setPageMemoryScope(runtime.identity); history.replaceState({}, "", "/procurement-demands");
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => runtime.y });
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 4000 });
  vi.spyOn(window, "scrollTo").mockImplementation((value: any) => { runtime.y = value?.top ?? 0; });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Synthetic memory test forbids production network"); }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); memory.setPageMemoryScope(null); expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("采购真实页面记忆接入", () => {
  it("restores view/sort/applied keyword/draft/page and a prior scroll position through the real hooks", async () => {
    memory.writePageSlot("view", "quoted"); memory.writePageSlot("sort", "urgent"); memory.writePageSlot("keyword", "OLD"); memory.writePageSlot("keywordInput", "NEW"); memory.writePageSlot("page", 3);
    runtime.y = 640; memory.flushPagePosition(); runtime.y = 0;
    render(); await frames();
    expect(runtime.query.mock.calls.at(-1)?.[0]).toEqual({ view: "quoted", sort: "urgent", keyword: "OLD", page: 3, pageSize: 20 });
    expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("NEW"); expect(host.textContent).toContain("输入尚未应用");
    expect(runtime.y).toBe(640);
  });
  it("does not restore scroll from unproven cached data; restores once the current first read succeeds", async () => {
    runtime.y = 560; memory.flushPagePosition(); runtime.y = 0; runtime.fresh = false;
    render(); await frames(); expect(runtime.y).toBe(0);
    runtime.fresh = true; render(); await frames(); expect(runtime.y).toBe(560);
  });
  it("查看最新 writes cleared conditions/page to actual identity-scoped memory and scrolls to the top", async () => {
    memory.writePageSlot("view", "reconfirm"); memory.writePageSlot("sort", "urgent"); memory.writePageSlot("keyword", "OLD"); memory.writePageSlot("keywordInput", "NEW"); memory.writePageSlot("page", 4);
    render(); await frames();
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "查看最新")!.click());
    expect(memory.readPageSlot("view", "unset")).toBe("all"); expect(memory.readPageSlot("sort", "unset")).toBe("latest");
    expect(memory.readPageSlot("keyword", "unset")).toBe(""); expect(memory.readPageSlot("keywordInput", "unset")).toBe(""); expect(memory.readPageSlot("page", 0)).toBe(1); expect(runtime.y).toBe(0);
  });
  it("another account never inherits previous account filters/page, while the original scoped memory remains intact", async () => {
    memory.writePageSlot("view", "quoted"); memory.writePageSlot("sort", "urgent"); memory.writePageSlot("keyword", "PRIVATE-MOCK"); memory.writePageSlot("page", 3);
    const original = runtime.identity; render(); await frames();
    runtime.identity = `${original}:other`; render(); await frames();
    expect(runtime.query.mock.calls.at(-1)?.[0]).toMatchObject({ view: "all", sort: "latest", keyword: "", page: 1 });
    expect(host.textContent).not.toContain("PRIVATE-MOCK");
    runtime.identity = original; render(); await frames(); expect(runtime.query.mock.calls.at(-1)?.[0]).toMatchObject({ view: "quoted", sort: "urgent", keyword: "PRIVATE-MOCK", page: 3 });
  });
});
