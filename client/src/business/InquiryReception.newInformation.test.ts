// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminNewInformationClient } from "../lib/adminNewInformation";

const state = vi.hoisted(() => {
  const timestamp = new Date("2026-11-17T01:00:00Z");
  const row = (id: number, conversationId = 11, partNumber = "LM358") => ({ id, conversationId, inventoryId: id,
    buyerName: `采购${id}`, partNumber, brand: "TI", status: "open", createdAt: timestamp, lastActivityAt: timestamp });
  const scope = { merchantId: 30061, storageScope: "staff:7:enterprise:41:merchant:30061:binding:1",
    contextVerification: { state: "verified", identity: "staff:7:enterprise:41:merchant:30061:binding:1", authorizationVersion: "a1" } };
  const success = (data: unknown) => ({ data, isSuccess: true, isError: false, isFetching: false, isPlaceholderData: false, isLoading: false, isPending: false, error: null });
  const data = { scope, enterprise: success({ isOwner: false }), inbox: success([row(1), row(2, 12, "NE555"), row(3, 99, "OTHER")]),
    query: success([]), conversations: [{ id: 11, otherUserName: "采购1", unreadCount: 4 }, { id: 12, otherUserName: "采购2", unreadCount: 0 }],
    canReceive: true, refresh: vi.fn() };
  let activeScope: string | null = scope.storageScope, search = "";
  return { data, row, get activeScope() { return activeScope; }, set activeScope(value: string | null) { activeScope = value; },
    get search() { return search; }, set search(value: string) { search = value; }, reset() {
      activeScope = scope.storageScope; search = ""; scope.contextVerification.state = "verified"; scope.contextVerification.identity = scope.storageScope;
      for (const query of [data.enterprise, data.inbox, data.query]) Object.assign(query, { isSuccess: true, isError: false, isFetching: false, isPlaceholderData: false, error: null });
      data.inbox.data = [row(1), row(2, 12, "NE555"), row(3, 99, "OTHER")]; data.canReceive = true;
    } };
});
vi.mock("./useInquiryReception", () => ({ useInquiryReception: () => state.data,
  useInquiryReceptionNotice: () => ({ notice: "", sound: false, dismiss: vi.fn(), setSound: vi.fn() }) }));
vi.mock("./BusinessScope", () => ({ businessStorageScope: () => state.activeScope }));
vi.mock("./platform/client/src/pages/ChatPage", () => ({ default: () => createElement("div", { "data-chat": true }) }));
vi.mock("./platform/client/src/components/UserAvatar", () => ({ default: () => null }));
vi.mock("./BusinessContentFrame", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("wouter", () => ({ useLocation: () => ["/workbench/inquiries", (value: string) => { state.search = value.split("?")[1] ?? ""; }], useSearch: () => state.search }));
import InquiryReception from "./InquiryReception";
import { AdminNewInformationProvider } from "../lib/adminNewInformation";
let host: HTMLDivElement, root: Root, queryClient: QueryClient;
let inspect: ReturnType<typeof vi.fn>, markDisplayed: ReturnType<typeof vi.fn>, client: AdminNewInformationClient;
async function render(provider = true) {
  await act(async () => {
    const page = createElement(InquiryReception);
    root.render(createElement(QueryClientProvider, { client: queryClient }, provider
      ? createElement(AdminNewInformationProvider, { accountKey: 71, canRead: true, client, children: page }) : page));
    await new Promise(resolve => setTimeout(resolve, 35));
  });
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 35)); }); }
beforeEach(() => {
  state.reset(); Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    // Only the first currently painted queue row is inside the viewport. Its
    // badge ref must live on the original button, not a sentinel/preview.
    const visible = this.dataset.inquiryId === "2" || !this.dataset.inquiryId;
    return { x: 0, y: visible ? 0 : 5000, left: 0, top: visible ? 0 : 5000, width: 100, height: 25,
      right: 100, bottom: visible ? 25 : 5025, toJSON: () => ({}) };
  });
  inspect = vi.fn(async ({ refs }) => ({ items: refs.map((id: string) => ({ id, version: "created:v1", isNew: id === "inquiry:2", receipt: `receipt:${id}` })) }));
  markDisplayed = vi.fn(async () => ({ accepted: true }));
  client = { summary: vi.fn(async () => ({ modules: {}, generatedAt: "2026-11-17T01:00:00Z" })) as AdminNewInformationClient["summary"], inspect, markDisplayed };
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); queryClient.clear(); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("reception canonical queue row integration", () => {
  it("inspects only actual authorized queue refs, attaches button witnesses and promotes new within queue", async () => {
    await render(); await settle(); await settle();
    expect(inspect).toHaveBeenCalledWith({ module: "reception", refs: ["inquiry:1", "inquiry:2"], scope: "30061" }, expect.any(Object));
    const rows = host.querySelectorAll<HTMLButtonElement>(".inquiry-reception__item");
    expect([...rows].map(item => item.dataset.inquiryId)).toEqual(["2", "1"]);
    expect(rows[0].textContent).toContain("新"); expect(host.querySelector('[data-inquiry-id="3"]')).toBeNull();
    expect(markDisplayed).toHaveBeenCalledWith({ receipts: ["receipt:inquiry:2"] }, expect.any(Object));
    expect(JSON.stringify(markDisplayed.mock.calls)).not.toContain("inquiry:1");
    // Existing unread messages stay separate: no rewriting message count (4).
    expect(host.querySelector('[data-inquiry-id="1"] .inquiry-reception__unread')?.textContent).toBe("4");
  });
  it("original material filter changes refs to only the displayed queue, never all inbox rows", async () => {
    await render(); await settle(); inspect.mockClear(); markDisplayed.mockClear();
    const group = host.querySelector<HTMLButtonElement>('.inquiry-reception__group-item[title*="LM358"]')!;
    await act(async () => group.click()); await settle();
    expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(1);
    expect(inspect).toHaveBeenCalledWith({ module: "reception", refs: ["inquiry:1"], scope: "30061" }, expect.any(Object));
    expect(markDisplayed).not.toHaveBeenCalled(); expect(state.search).toBe("");
  });
  it.each(["isSuccess", "isError", "isFetching", "isPlaceholderData"] as const)("not-ready inbox flag %s never inspects or marks", async flag => {
    state.data.inbox[flag] = flag !== "isSuccess"; await render(); await settle();
    expect(inspect).not.toHaveBeenCalled(); expect(markDisplayed).not.toHaveBeenCalled();
  });
  it.each(["isFetching", "isPlaceholderData"] as const)("not-ready conversation flag %s never clears a row", async flag => {
    state.data.query[flag] = true; await render(); await settle(); expect(markDisplayed).not.toHaveBeenCalled(); expect(inspect).not.toHaveBeenCalled();
  });
  it.each(["revalidating", "wrong-identity", "inactive"])("identity condition %s withdraws row facts", async condition => {
    if (condition === "revalidating") state.data.scope.contextVerification.state = "revalidating";
    if (condition === "wrong-identity") state.data.scope.contextVerification.identity = "old-scope";
    if (condition === "inactive") state.activeScope = "old-scope";
    await render(); await settle(); expect(inspect).not.toHaveBeenCalled(); expect(markDisplayed).not.toHaveBeenCalled();
  });
  it("no provider keeps the original page/queue functional with no inspect or badge", async () => {
    await render(false); await settle(); expect(host.querySelectorAll(".inquiry-reception__item")).toHaveLength(2);
    expect(inspect).not.toHaveBeenCalled(); expect(markDisplayed).not.toHaveBeenCalled();
  });
  it("original row click preserves conversation/inquiry and merchant URL without changing chat read policy", async () => {
    state.search = "merchantId=30061"; await render(); await settle();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-inquiry-id="1"]')!.click());
    expect(new URLSearchParams(state.search).get("conversationId")).toBe("11");
    expect(new URLSearchParams(state.search).get("inquiryId")).toBe("1"); expect(new URLSearchParams(state.search).get("merchantId")).toBe("30061");
  });
});
