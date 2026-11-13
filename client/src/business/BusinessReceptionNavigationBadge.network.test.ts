// @vitest-environment jsdom
import React, { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import InquiryReceptionNavigationBadge from "../components/admin/InquiryReceptionNavigationBadge";
import { trpc as adminTrpc } from "../lib/trpc";
import { businessScopeTrpc, trpc } from "./api/business-trpc";
import {
  resetBusinessWorkbenchSessionsForTests,
  useBusinessWorkbenchSession,
  type BusinessWorkbenchSession,
} from "./BusinessWorkbenchSession";
import { INQUIRY_RECEPTION_REFRESH_MS } from "./InquiryReceptionModel";

// Actual lazy wrapper, workbench identity gates, tRPC links, domain QueryClient,
// unread hook and badge remain intact. Only unrelated admin chrome is cut off.
// All fetches are synthetic, deny-listed outside this exact BFF origin/path.
vi.mock("../components/DashboardLayout", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

const authKey = getQueryKey(adminTrpc.auth.me, undefined, "query");
const contextKey = getQueryKey(businessScopeTrpc.context, undefined, "query");
const conversationsKey = getQueryKey(trpc.chat.listConversations, undefined, "query");
const personalTotalKey = getQueryKey(adminTrpc.messages.unreadCount, undefined, "query");
const merchant = {
  id: 30061, merchantNo: "verified-official", companyName: "已核验商户",
  crmStatus: "enabled", registrationRegion: "CN", canWrite: false,
};
function context(actor = 7002, enterprise = 88001, binding = 4, admin = 6001) {
  return {
    merchant: { id: 30061, canWrite: false }, enterprise: { id: enterprise },
    staffPrincipal: {
      status: "ready", frontendUserId: actor, adminAccountId: admin,
      enterpriseId: enterprise, bindingVersion: binding,
      user: { id: actor, name: "真实接待员工", role: "user", loginDisabled: false, crmAccess: true },
    },
    sessionCapabilities: { receptionReady: true },
    workbenchCapabilities: ["inquiry.receive"], writeCapabilities: [] as string[],
    authorizationVersion: "reception-grants-v1",
  };
}
function conversations(...counts: number[]) {
  return counts.map((unreadCount, index) => ({
    id: index + 11, unreadCount, otherUserId: index + 20,
    otherUserName: "已授权询价客户", lastMessageAt: "2026-11-13T08:00:00.000Z",
  }));
}
type Call = { path: string; headers: Headers; input: unknown; method: string };
let host: HTMLDivElement, root: Root, rootClient: QueryClient;
let session: BusinessWorkbenchSession | null;
let proof: ReturnType<typeof context>;
let rows: ReturnType<typeof conversations>;
let calls: Call[];
let listError: "transport" | "resource" | "security" | null;
let contextError: boolean;
let holdList: boolean;
let resolveList: (() => void) | null;

function CaptureSession() {
  session = useBusinessWorkbenchSession().session;
  return null;
}
function domainClient() {
  expect(session?.authorization).toBeTruthy();
  return session!.domainResources(session!.authorization!).client;
}
function listCalls() { return calls.filter(call => call.path === "chat.listConversations"); }
function badge() { return host.querySelector<HTMLSpanElement>(".inquiry-reception-nav-badge"); }
function errorEnvelope(kind: "transport" | "resource" | "security") {
  const forbidden = kind !== "transport";
  return { error: { json: {
    message: "离线核验拒绝", code: forbidden ? -32003 : -32603,
    data: {
      code: forbidden ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
      httpStatus: forbidden ? 403 : 500,
      ...(kind === "resource" ? { businessFailure: "BUSINESS_RESOURCE_FORBIDDEN" } : {}),
    },
  } } };
}
async function waitFor(assertion: () => void) {
  let last: unknown;
  for (let attempt = 0; attempt < 300; attempt++) {
    try { assertion(); return; } catch (error) { last = error; }
    await act(async () => {
      if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(10);
      else await new Promise(resolve => setTimeout(resolve, 10));
    });
  }
  throw last;
}
async function render() {
  await act(async () => root.render(createElement(QueryClientProvider, { client: rootClient },
    createElement(CaptureSession), createElement(InquiryReceptionNavigationBadge))));
}
async function mount(counts = [4]) {
  rows = conversations(...counts);
  await render();
  await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  await waitFor(() => expect(domainClient().getQueryState(conversationsKey)?.status).toBe("success"));
}
async function refreshList() {
  await act(async () => {
    await domainClient().invalidateQueries({ queryKey: conversationsKey, exact: true });
  });
}
async function refreshContext() {
  await act(async () => {
    await session!.context.refetchQueries({ queryKey: contextKey, exact: true });
  });
}

beforeAll(async () => { await import("./BusinessWorkbenchPage"); });
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  history.replaceState({}, "", "/users");
  proof = context(); rows = []; calls = []; session = null;
  listError = null; contextError = false; holdList = false; resolveList = null;
  rootClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  rootClient.setQueryData(authKey, { id: 6001 });
  // Root/global inbox counts cannot contaminate reception's domain cache.
  rootClient.setQueryData(personalTotalKey, { count: 888 });
  rootClient.setQueryData(conversationsKey, conversations(777));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/business-trpc/")) {
      throw new Error(`NON_SYNTHETIC_REQUEST_BLOCKED:${url.origin}${url.pathname}`);
    }
    const paths = url.pathname.split("/").at(-1)!.split(",");
    const inputs = JSON.parse(url.searchParams.get("input") ?? "{}");
    const envelopes = await Promise.all(paths.map(async (path, index) => {
      calls.push({ path, headers: new Headers(init?.headers), input: inputs[index]?.json, method: init?.method ?? "GET" });
      let data: unknown;
      if (path === "merchants") data = { data: [merchant], pageAvailableCount: 1, sourceTotal: 1 };
      else if (path === "context") {
        if (contextError) return errorEnvelope("transport");
        data = structuredClone(proof);
      } else if (path === "chat.listConversations") {
        if (holdList) await new Promise<void>(resolve => { resolveList = resolve; });
        if (listError) return errorEnvelope(listError);
        data = rows;
      } else throw new Error(`UNEXPECTED_RECEPTION_PROCEDURE:${path}`);
      return { result: { data: { json: data } } };
    }));
    return new Response(JSON.stringify(envelopes), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  vi.useRealTimers(); focusManager.setFocused(undefined);
  if (resolveList) { holdList = false; resolveList(); }
  await act(async () => { root.unmount(); resetBusinessWorkbenchSessionsForTests(); rootClient.clear(); });
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("询价导航徽标：实际懒加载与受信任接待缓存", () => {
  it("根 QueryClient 不存在时安静隐藏，不启动询价查询", async () => {
    await act(async () => root.render(createElement(InquiryReceptionNavigationBadge)));
    expect(host.textContent).toBe(""); expect(calls).toEqual([]);
  });
  it("有效的新询价消息出现才显示，零隐藏，不混入个人或全局未读、不自动已读", async () => {
    await mount([0]); expect(badge()).toBeNull();
    rows = conversations(2, 3); await refreshList();
    await waitFor(() => expect(badge()?.textContent).toBe("5"));
    expect(badge()?.getAttribute("aria-label")).toBe("5 条企业询价未读");
    rows = conversations(0, 0); await refreshList();
    await waitFor(() => expect(badge()).toBeNull());
    expect(new Set(calls.map(call => call.path))).toEqual(new Set(["merchants", "context", "chat.listConversations"]));
    for (const call of listCalls()) {
      expect(call.headers.get("x-business-merchant-id")).toBe("30061");
      expect(call.input == null).toBe(true); expect(call.method).toBe("GET");
      expect(call.headers.has("x-business-actor-id")).toBe(false);
    }
  });
  it("99保持数字，超过99只显示99+且保留真实无障碍未读总数", async () => {
    await mount([99]); await waitFor(() => expect(badge()?.textContent).toBe("99"));
    rows = conversations(90, 30); await refreshList();
    await waitFor(() => expect(badge()?.textContent).toBe("99+"));
    expect(badge()?.getAttribute("aria-label")).toBe("120 条企业询价未读");
  });
  it("通过短轮询和焦点恢复读取新消息，不需进入询价页面", async () => {
    vi.useFakeTimers();
    focusManager.setFocused(true);
    await mount([1]); await waitFor(() => expect(badge()?.textContent).toBe("1"));
    const query = domainClient().getQueryCache().find({ queryKey: conversationsKey, exact: true })!;
    expect(query.options).toMatchObject({
      staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true,
      refetchOnReconnect: "always", refetchInterval: INQUIRY_RECEPTION_REFRESH_MS,
      refetchIntervalInBackground: false, retry: false,
    });
    rows = conversations(6);
    await act(async () => { await vi.advanceTimersByTimeAsync(INQUIRY_RECEPTION_REFRESH_MS + 100); });
    await waitFor(() => expect(badge()?.textContent).toBe("6"));
    rows = conversations(7);
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await waitFor(() => expect(badge()?.textContent).toBe("7"));
    expect(location.pathname).toBe("/users");
  });
  it.each([
    ["真实员工", () => context(7003)],
    ["企业", () => context(7002, 88002)],
    ["员工绑定版本", () => context(7002, 88001, 5)],
  ] as const)("%s变更时清空旧cache，新主体查询完成前不显示旧徽标", async (_label, nextContext) => {
    await mount([4]); await waitFor(() => expect(badge()?.textContent).toBe("4"));
    const old = domainClient();
    proof = nextContext(); holdList = true; rows = conversations(2);
    await refreshContext();
    await waitFor(() => expect(resolveList).not.toBeNull());
    expect(badge()).toBeNull(); expect(old.getQueryData(conversationsKey)).toBeUndefined();
    expect(domainClient()).not.toBe(old);
    await act(async () => { holdList = false; resolveList!(); });
    await waitFor(() => expect(badge()?.textContent).toBe("2"));
  });
  it("商户URL切换到未授权商户时旧cache不可见，也不请求新商户域", async () => {
    await mount([4]); await waitFor(() => expect(badge()).not.toBeNull());
    const old = domainClient(); const count = listCalls().length;
    await act(async () => {
      history.pushState({}, "", "/users?merchantId=30062");
      window.dispatchEvent(new Event("popstate"));
    });
    await waitFor(() => expect(badge()).toBeNull());
    expect(old.getQueryData(conversationsKey)).toBeUndefined();
    expect(listCalls()).toHaveLength(count);
    expect(calls.some(call => call.headers.get("x-business-merchant-id") === "30062")).toBe(false);
  });
  it("后台账户变更不能冒充旧前台actor，旧cache不泄漏", async () => {
    await mount([4]); await waitFor(() => expect(badge()).not.toBeNull());
    const old = domainClient(); holdList = true; rows = conversations(1); proof = context(7003, 88001, 1, 6002);
    await act(async () => rootClient.setQueryData(authKey, { id: 6002 }));
    await waitFor(() => expect(resolveList).not.toBeNull());
    expect(badge()).toBeNull(); expect(old.getQueryData(conversationsKey)).toBeUndefined();
    await act(async () => { holdList = false; resolveList!(); });
    await waitFor(() => expect(badge()?.textContent).toBe("1"));
  });
  it.each(["permission", "readiness"] as const)("%s授权丢失隐藏缓存徽标，库存权限不能替代接待", async kind => {
    await mount([4]); await waitFor(() => expect(badge()).not.toBeNull());
    const old = domainClient(); const count = listCalls().length;
    if (kind === "permission") proof.workbenchCapabilities = ["inventory.channel"];
    else proof.sessionCapabilities.receptionReady = false;
    await refreshContext(); await waitFor(() => expect(badge()).toBeNull());
    expect(old.getQueryData(conversationsKey)).toBeUndefined(); expect(listCalls()).toHaveLength(count);
  });
  it("未读查询失败即隐藏React Query保留的旧数据，重试失败期间仍不显示", async () => {
    await mount([4]); await waitFor(() => expect(badge()).not.toBeNull());
    const client = domainClient(); listError = "transport"; await refreshList();
    await waitFor(() => expect(badge()).toBeNull());
    expect(client.getQueryData(conversationsKey)).toEqual(conversations(4));
    holdList = true;
    let pending: Promise<void>;
    await act(async () => { pending = client.invalidateQueries({ queryKey: conversationsKey, exact: true }); });
    await waitFor(() => expect(resolveList).not.toBeNull());
    expect(badge()).toBeNull();
    await act(async () => {
      holdList = false; listError = null; rows = conversations(2); resolveList!(); await pending!;
    });
    await waitFor(() => expect(badge()?.textContent).toBe("2"));
  });
  it("服务端资源拒绝隐藏并清空该资源；未分类403保守关闭整个旧域", async () => {
    await mount([4]); await waitFor(() => expect(badge()).not.toBeNull());
    const old = domainClient(); listError = "resource"; await refreshList();
    await waitFor(() => expect(badge()).toBeNull());
    expect(old.getQueryData(conversationsKey)).toBeUndefined(); expect(session!.denied).toBe(false);
    listError = null; rows = conversations(2); await refreshList();
    await waitFor(() => expect(badge()?.textContent).toBe("2"));
    listError = "security"; await refreshList();
    await waitFor(() => expect(badge()).toBeNull());
    expect(session!.denied).toBe(true); expect(old.getQueryCache().getAll()).toEqual([]);
    expect(host.textContent).toBe("");
  });
  it("上下文核验失败及根登录丢失均不显示旧badge", async () => {
    await mount([4]); await waitFor(() => expect(badge()).not.toBeNull());
    const old = domainClient(); contextError = true; await refreshContext();
    await waitFor(() => expect(badge()).toBeNull()); expect(old.getQueryData(conversationsKey)).toBeUndefined();
    expect(host.textContent).toBe("");
    await act(async () => rootClient.setQueryData(authKey, null));
    expect(badge()).toBeNull(); expect(session).toBeNull();
  });
  it("消费页面markRead相同query key：乐观读后立即清零，settled失效重查也保持零", async () => {
    await mount([4]); await waitFor(() => expect(badge()).not.toBeNull());
    const client = domainClient();
    // Native ChatPage.markRead onMutate uses listConversations.cancel + setData.
    await act(async () => {
      await client.cancelQueries({ queryKey: conversationsKey, exact: true });
      client.setQueryData(conversationsKey, conversations(0));
    });
    await waitFor(() => expect(badge()).toBeNull());
    // Native onSettled invalidates this same domain key, not the root inbox.
    rows = conversations(0); const before = listCalls().length; await refreshList();
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(before));
    expect(badge()).toBeNull();
    expect(rootClient.getQueryData(conversationsKey)).toEqual(conversations(777));
    expect(calls.some(call => call.path === "chat.markRead")).toBe(false);
  });
});
