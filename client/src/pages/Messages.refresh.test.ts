// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trpc } from "@/lib/trpc";

vi.mock("@/components/DashboardLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children) }));
vi.mock("@/components/MerchantOwnershipLookup", () => ({ default: () => null }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: 1, role: "admin", adminRole: "operation", permissions: ["messages.read", "messages.write"] } }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/messages", vi.fn()] }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import Messages from "./Messages";

const thread = {
  id: 4, threadNo: "MT0004", subject: "测试会话", threadType: "service", status: "open",
  adminUnreadCount: 7, lastMessagePreview: "客户留言", lastMessageAt: "2026-11-13T08:00:00Z",
  contactName: "离线客户", contactPhone: null, contactEmail: null,
};
const detail = { thread, messages: [{ id: 1, senderType: "portal", senderName: "客户", content: "需要报价", createdAt: "2026-11-13T08:00:00Z" }] };
const unreadKey = getQueryKey(trpc.message.unreadCount, undefined, "query");
const listKey = getQueryKey(trpc.message.threads, { page: 1, pageSize: 20 }, "query");
const filteredListKey = getQueryKey(trpc.message.threads, { page: 2, pageSize: 20, status: "closed", keyword: "x" }, "query");
const detailKey = getQueryKey(trpc.message.detail, { threadId: 4 }, "query");
const moduleKey = [["moduleNotification", "summary"], { type: "query" }];
let cache: QueryClient;
let unrelatedCache: QueryClient;
let root: Root;
let host: HTMLDivElement;
let calls: Record<string, number>;
let failDetail: boolean;
let failMutation: boolean;
let sharedUnread: number;
let currentStatus: string;

function BadgeProbe() {
  const query = trpc.message.unreadCount.useQuery();
  return React.createElement("output", { "data-shared-unread": true }, query.data?.total);
}
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
}
async function mount(deepLink = true) {
  window.history.replaceState(null, "", deepLink ? "/messages?thread=4" : "/messages");
  const client = trpc.createClient({ links: [() => ({ op }) => observable(observer => {
    calls[op.path] = (calls[op.path] ?? 0) + 1;
    if ((op.path === "message.detail" && failDetail) || (op.type === "mutation" && failMutation)) {
      observer.error(new Error("offline fixture failure"));
      return;
    }
    let data: unknown;
    if (op.path === "message.detail") {
      // Simulates the existing server-side clear-on-detail behavior; no new
      // mark-read procedure is introduced by this UI change.
      sharedUnread = 0;
      data = { ...detail, thread: { ...thread, status: currentStatus } };
    } else if (op.path === "message.threads") {
      data = { items: [{ ...thread, status: currentStatus, adminUnreadCount: sharedUnread }], total: 1 };
    } else if (op.path === "message.unreadCount") {
      data = { total: sharedUnread };
    } else if (op.path === "message.reply") {
      data = { success: true };
    } else if (op.path === "message.setStatus") {
      currentStatus = (op.input as { status: string }).status;
      data = { success: true };
    } else {
      throw new Error(`Unexpected procedure: ${op.path}`);
    }
    observer.next({ result: { data } });
    observer.complete();
  })] });
  await act(async () => {
    root.render(React.createElement(trpc.Provider, { client, queryClient: cache },
      React.createElement(QueryClientProvider, { client: cache },
        React.createElement(BadgeProbe), React.createElement(Messages))));
  });
  await settle();
}
function button(text: string) {
  return Array.from(host.querySelectorAll("button")).find(node => node.textContent?.includes(text))!;
}
function seedOtherCaches() {
  cache.setQueryData(filteredListKey, { items: [], total: 0 });
  cache.setQueryData(moduleKey, { counts: { orders: 4 } });
  unrelatedCache.setQueryData(unreadKey, { total: 99 });
  unrelatedCache.setQueryData(filteredListKey, { items: [], total: 0 });
}
function assertScope() {
  expect(cache.getQueryState(filteredListKey)?.isInvalidated).toBe(true);
  expect(cache.getQueryState(moduleKey)?.isInvalidated).toBe(false);
  expect(unrelatedCache.getQueryState(unreadKey)?.isInvalidated).toBe(false);
  expect(unrelatedCache.getQueryState(filteredListKey)?.isInvalidated).toBe(false);
}

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); }));
  vi.stubGlobal("XMLHttpRequest", vi.fn(() => { throw new Error("NETWORK_FORBIDDEN"); }));
  calls = {};
  failDetail = false;
  failMutation = false;
  sharedUnread = 7;
  currentStatus = "open";
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  unrelatedCache = new QueryClient();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  seedOtherCaches();
});
afterEach(async () => {
  await act(async () => root.unmount());
  cache.clear();
  unrelatedCache.clear();
  host.remove();
  expect(fetch).not.toHaveBeenCalled();
  expect(XMLHttpRequest).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("Messages successful read/action refresh on root QueryClient", () => {
  it("deep-linked detail immediately refreshes shared unread and every list filter without a detail loop", async () => {
    await mount();
    expect(host.textContent).toContain("需要报价");
    expect(cache.getQueryData(unreadKey)).toEqual({ total: 0 });
    expect(host.querySelector("[data-shared-unread]")?.textContent).toBe("0");
    expect(cache.getQueryData(listKey)).toMatchObject({ items: [{ adminUnreadCount: 0 }] });
    assertScope();
    expect(calls["message.detail"]).toBe(1);
    await settle();
    expect(calls["message.detail"]).toBe(1);
  });

  it("the 15-second detail poll refreshes summaries even for structurally identical responses", async () => {
    await mount();
    seedOtherCaches();
    const oldData = cache.getQueryData(detailKey);
    sharedUnread = 2;
    // Drive the same QueryObserver's refetch, then verify the configured poll
    // interval. Avoid a real 15s wait or fake timers affecting tRPC scheduling.
    const query = cache.getQueryCache().find({ queryKey: detailKey });
    expect(query?.options).toMatchObject({ refetchInterval: 15000 });
    await act(async () => { await query!.fetch(); });
    await settle();
    expect(cache.getQueryData(detailKey)).toBe(oldData);
    expect(cache.getQueryData(unreadKey)).toEqual({ total: 0 });
    assertScope();
    expect(calls["message.detail"]).toBe(2);
  });

  it("failed detail does not invalidate list caches or clear shared unread", async () => {
    failDetail = true;
    await mount();
    expect(cache.getQueryData(unreadKey)).toEqual({ total: 7 });
    expect(cache.getQueryState(filteredListKey)?.isInvalidated).toBe(false);
    expect(calls["message.detail"]).toBe(1);
  });

  it.each(["reply", "status"])("successful %s refreshes detail, unread and all list filters", async action => {
    await mount();
    seedOtherCaches();
    const previousUnreadFetches = calls["message.unreadCount"];
    if (action === "reply") {
      const input = host.querySelector("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "离线回复");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => button("发送回复").click());
    } else {
      await act(async () => button("关闭会话").click());
    }
    await settle();
    expect(calls[action === "reply" ? "message.reply" : "message.setStatus"]).toBe(1);
    expect(calls["message.detail"]).toBe(2);
    expect(calls["message.unreadCount"]).toBeGreaterThan(previousUnreadFetches);
    assertScope();
    if (action === "reply") expect(host.querySelector("textarea")?.value).toBe("");
    else expect(cache.getQueryData(listKey)).toMatchObject({ items: [{ status: "closed" }] });
    await settle();
    expect(calls["message.detail"]).toBe(2);
  });

  it("failed status mutation does not invalidate previously refreshed caches", async () => {
    await mount();
    seedOtherCaches();
    failMutation = true;
    await act(async () => button("关闭会话").click());
    await settle();
    expect(cache.getQueryState(filteredListKey)?.isInvalidated).toBe(false);
    expect(calls["message.detail"]).toBe(1);
  });

  it("hovering/focusing a list thread does not read detail; clicking does", async () => {
    await mount(false);
    const item = button("测试会话");
    await act(async () => {
      item.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      item.focus();
    });
    await settle();
    expect(calls["message.detail"]).toBeUndefined();
    expect(cache.getQueryData(unreadKey)).toEqual({ total: 7 });
    await act(async () => item.click());
    await settle();
    expect(calls["message.detail"]).toBe(1);
    expect(cache.getQueryData(unreadKey)).toEqual({ total: 0 });
  });
});
