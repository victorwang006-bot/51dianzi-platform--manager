// @vitest-environment jsdom
import { createRequire } from "node:module";
import { act, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BusinessWorkbenchPage, {
  __resetBusinessAuthorizationMemoryForTests,
} from "./BusinessWorkbenchPage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { trpc as adminTrpc } from "../lib/trpc";
import { AUTH_SESSION_CLEARED_EVENT } from "./platform/client/src/lib/authSessionEvents";
import {
  createBusinessRequestCancellation,
} from "./BusinessWorkbenchSession";
import {
  businessStorageScope,
  CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
} from "./BusinessScope";
import {
  BUSINESS_SCOPE_REQUEST_TIMEOUT_MS,
  createBusinessScopeTrpcClient,
} from "./api/business-trpc";

// The workbench, its gates, its real customer-list route and its real BFF
// clients remain unmocked below. Only unrelated admin chrome is omitted so its
// independent navigation/auth polling cannot alter this focused network test.
vi.mock("../components/DashboardLayout", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

const requireAdmin = createRequire(import.meta.url);
const { JSDOM } = requireAdmin("jsdom") as {
  JSDOM: new (
    html: string,
    options: { url: string }
  ) => {
    window: Window & typeof globalThis & { close(): void };
  };
};

const officialMerchant = {
  id: 30061,
  merchantNo: "verified-official-merchant",
  companyName: "已核验业务商户",
  crmStatus: "enabled",
  registrationRegion: "CN",
  canWrite: false,
};

const verifiedContext = {
  merchant: { id: 30061, canWrite: false },
  enterprise: { id: 88001, companyName: "已核验企业", dataOwnerUserId: 7001 },
  staffPrincipal: {
    status: "ready" as const,
    frontendUserId: 7002,
    adminAccountId: 6001,
    enterpriseId: 88001,
    bindingVersion: 4,
    user: {
      id: 7002,
      openId: "front-staff:7002",
      username: "verified-staff",
      name: "已核验业务员工",
      email: null,
      phone: null,
      role: "user" as const,
      loginDisabled: false,
      crmAccess: true,
      createdAt: "2026-11-02T00:00:00.000Z",
      updatedAt: "2026-11-02T00:00:00.000Z",
      lastSignedIn: "2026-11-02T00:00:00.000Z",
      hasPassword: true,
      emailVerified: true,
    },
  },
  sessionCapabilities: { chat: false as const, receptionReady: false },
  workbenchCapabilities: ["customers.manage"],
  writeCapabilities: [],
};

// Mirrors the preserved legacy channel-inventory scope: merchant 30061 is
// bound to the original portal data owner 397751 in enterprise 1. This is a
// route contract fixture only; the BFF remains the production authority.
const legacyChannelInventoryContext = {
  ...verifiedContext,
  enterprise: {
    id: 1,
    companyName: "旧渠道库存所属企业",
    dataOwnerUserId: 397751,
  },
  staffPrincipal: {
    ...verifiedContext.staffPrincipal,
    frontendUserId: 397751,
    enterpriseId: 1,
    user: {
      ...verifiedContext.staffPrincipal.user,
      id: 397751,
      openId: "front-staff:397751",
      username: "legacy-channel-owner",
    },
  },
  workbenchCapabilities: ["inventory.channel"],
  officialInventoryPermissions: { read: true, write: true, note: true, authorizationVersion: "native-grants-v1" },
};

type FetchCall = {
  url: string;
  pathname: string;
  headers: Headers;
  credentials: RequestCredentials | undefined;
  signal: AbortSignal | null | undefined;
};

type NetworkResponder = (call: FetchCall) => Promise<Response> | Response;

type MountedWorkbench = {
  container: HTMLElement;
  refreshAuth(): Promise<void>;
  clearAuth(): Promise<void>;
  navigate(path: string): Promise<void>;
  leaveWorkbench(): Promise<void>;
  returnToWorkbench(): Promise<void>;
  unmount(): Promise<void>;
};

function dispatchBusinessRestore() {
  const event = new window.Event("pageshow");
  Object.defineProperty(event, "persisted", { value: true });
  window.dispatchEvent(event);
}

function trpcResult(value: unknown): Response {
  return new Response(JSON.stringify([{ result: { data: { json: value } } }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function trpcBatchResult(...values: unknown[]): Response {
  return new Response(
    JSON.stringify(
      values.map(value => ({ result: { data: { json: value } } }))
    ),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function trpcError(status: number, code: string, message: string, businessFailure?: string): Response {
  return new Response(
    JSON.stringify([
      {
        error: {
          json: {
            message,
            code: -32003,
            data: { code, httpStatus: status, path: "merchants", businessFailure },
          },
        },
      },
    ]),
    {
      status,
      headers: { "content-type": "application/json" },
    }
  );
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof Request !== "undefined" && input instanceof Request
    ? input.url
    : String(input);
}

function requestPathname(input: RequestInfo | URL): string {
  return new URL(requestUrl(input), "http://workbench.test").pathname;
}

function customerRecord(id: number, name: string) {
  return {
    id,
    enterpriseId: 88001,
    name,
    contactName: "客户联系人",
    phone: "13800000000",
    email: "",
    province: "",
    city: "",
    district: "",
    address: "",
    scale: "unknown",
    grade: "C",
    stage: "new",
    source: "",
    nextFollowUpAt: null,
    assignedUserId: 7002,
    assignedName: "已核验业务员工",
    createdByUserId: 7002,
    createdByName: "已核验业务员工",
    createdAt: "2026-11-02T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    version: 1,
    archivedAt: null,
    archiveReason: null,
    lastFollowUpAt: null,
  };
}

async function mountWorkbench(
  initialPath = "/workbench/customers"
): Promise<MountedWorkbench> {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    {
      url: `http://workbench.test${initialPath}`,
    }
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
    Element: dom.window.Element,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLSelectElement: dom.window.HTMLSelectElement,
    DocumentFragment: dom.window.DocumentFragment,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    addEventListener: dom.window.addEventListener.bind(dom.window),
    removeEventListener: dom.window.removeEventListener.bind(dom.window),
    dispatchEvent: dom.window.dispatchEvent.bind(dom.window),
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: (handle: number) => clearTimeout(handle),
  });
  dom.window.scrollTo = () => undefined;
  dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const [reactModule, { createRoot }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
  ]);
  (globalThis as typeof globalThis & { React?: unknown }).React = reactModule;
  const container = dom.window.document.getElementById("root");
  if (!container) throw new Error("WORKBENCH_NETWORK_TEST_ROOT_MISSING");
  const root = createRoot(container);
  const rootQueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootTrpcClient = adminTrpc.createClient({
    links: [
      httpBatchLink({
        url: "/api/trpc",
        transformer: superjson,
        fetch: (input, init) =>
          globalThis.fetch(input, { ...init, credentials: "include" }),
      }),
    ],
  });
  function AuthBootstrap({ children }: { children: ReactNode }) {
    adminTrpc.auth.me.useQuery(undefined, {
      retry: false,
      refetchOnWindowFocus: false,
    });
    return children;
  }
  const render = (children: ReactNode) =>
    root.render(
      createElement(
        adminTrpc.Provider,
        { client: rootTrpcClient, queryClient: rootQueryClient },
        createElement(
          QueryClientProvider,
          { client: rootQueryClient },
          createElement(AuthBootstrap, null, children)
        )
      )
    );

  await act(async () => {
    render(createElement(BusinessWorkbenchPage, { routeBase: "/workbench" }));
  });

  return {
    container,
    async refreshAuth() {
      await act(async () => {
        await rootQueryClient.refetchQueries({
          queryKey: getQueryKey(adminTrpc.auth.me, undefined, "query"),
          exact: true,
        });
      });
    },
    async clearAuth() {
      await act(async () =>
        window.dispatchEvent(new window.Event(AUTH_SESSION_CLEARED_EVENT))
      );
    },
    async navigate(path: string) {
      await act(async () => {
        history.pushState({}, "", path);
        window.dispatchEvent(new window.Event("popstate"));
      });
    },
    async leaveWorkbench() {
      await act(async () => {
        history.pushState({}, "", "/users");
        render(createElement("h1", null, "其它后台页面"));
      });
    },
    async returnToWorkbench() {
      await act(async () => {
        history.pushState({}, "", "/workbench/customers");
        render(
          createElement(BusinessWorkbenchPage, { routeBase: "/workbench" })
        );
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
        __resetBusinessAuthorizationMemoryForTests();
        rootQueryClient.clear();
      });
      dom.window.close();
    },
  };
}

async function waitFor(
  expectation: () => void,
  timeoutMs = 1_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      expectation();
      return;
    } catch (error) {
      lastError = error;
    }
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });
  }
  throw lastError;
}

function installNetwork(
  responder: NetworkResponder,
  authResponder: NetworkResponder = () => trpcResult({ id: 6001 })
) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: requestUrl(input),
      pathname: requestPathname(input),
      headers: new Headers(init?.headers),
      credentials: init?.credentials,
      signal: init?.signal,
    };
    calls.push(call);
    return call.pathname === "/api/trpc/auth.me"
      ? authResponder(call)
      : responder(call);
  });
  vi.stubGlobal("fetch", fetch);
  return { calls, fetch };
}

function successfulWorkbenchResponse(call: FetchCall): Response {
  if (call.pathname === "/api/business-trpc/merchants") {
    return trpcResult({
      data: [officialMerchant],
      pageAvailableCount: 1,
      sourceTotal: 1,
    });
  }
  if (call.pathname === "/api/business-trpc/context")
    return trpcResult(verifiedContext);
  if (call.pathname === "/api/business-trpc/enterprise.me")
    return trpcResult({
      currentUserId: 7002,
      enterprise: { id: 88001 },
      isOwner: false,
      permissionKeys: [],
    });
  if (call.pathname === "/api/business-trpc/enterprise.me,customer.list")
    return trpcBatchResult(
      { currentUserId: 7002, enterprise: { id: 88001 }, isOwner: false, permissionKeys: [] },
      { items: [], total: 0 }
    );
  if (call.pathname === "/api/business-trpc/customer.context") {
    return trpcResult({ canManageAll: false, members: [] });
  }
  if (call.pathname === "/api/business-trpc/customer.list") {
    return trpcResult({ items: [], total: 0 });
  }
  throw new Error(`UNEXPECTED_NETWORK_STUB_PATH:${call.pathname}`);
}

const privateChannelMaterial = {
  id: 501,
  channelId: 201,
  channelName: "本人私有来源",
  channelType: "trade",
  channelActive: true,
  enterpriseId: 1,
  dataOwnerUserId: 397751,
  responsibleUserId: 397751,
  partNumber: "PRIVATE-TEST-501",
  brand: "测试品牌",
  qty: 10,
  dateCode: null,
  price: null,
  currency: "CNY",
  taxIncluded: null,
  leadTime: null,
  note: "本人私有备注不可共享",
  shareEnabled: false,
  canEdit: false,
  readOnly: true,
  revision: 1,
  createdAt: "2026-11-02T00:00:00.000Z",
  updatedAt: "2026-11-02T00:00:00.000Z",
};
const sharedChannelMaterial = {
  id: 502,
  partNumber: "SHARED-TEST-502",
  brand: "测试品牌",
  qty: 20,
  dateCode: null,
  price: null,
  currency: "CNY",
  taxIncluded: null,
  leadTime: null,
  revision: 1,
  updatedAt: "2026-11-02T00:00:00.000Z",
  canEdit: false,
  readOnly: true,
};

function legacyChannelInventoryResponse(
  call: FetchCall,
  { canWrite = false, canFilterSource = false } = {}
): Response {
  if (call.pathname === "/api/business-trpc/merchants") {
    return trpcResult({
      data: [{ ...officialMerchant, canWrite }],
      pageAvailableCount: 1,
      sourceTotal: 1,
    });
  }
  if (call.pathname === "/api/business-trpc/context")
    return trpcResult({
      ...legacyChannelInventoryContext,
      merchant: { ...legacyChannelInventoryContext.merchant, canWrite },
      writeCapabilities: canWrite ? ["inventory.channel"] : [],
    });
  if (call.pathname === "/api/business-trpc/enterprise.me") {
    return trpcResult({
      enterprise: {
        id: 1,
        companyName: "旧渠道库存所属企业",
        dataOwnerUserId: 397751,
      },
      currentUserId: 397751,
      isOwner: true,
      permissionKeys: ["inventory.manage"],
    });
  }
  if (call.pathname.includes("channelInventory.listTeam")) {
    const teamRows = [
      {
        ...sharedChannelMaterial,
        id: 501,
        partNumber: "PRIVATE-TEST-501",
        qty: 10,
        isMine: true,
        canViewSource: true,
        channelSource: null,
        noteCount: 0,
        canAddNote: false,
      },
      {
        ...sharedChannelMaterial,
        isMine: false,
        canViewSource: false,
        channelSource: null,
        noteCount: 0,
        canAddNote: false,
      },
    ];
    const results = call.pathname
      .split("/")
      .at(-1)!
      .split(",")
      .map(method => {
        if (method === "channelInventory.listTeamMaterials")
          return {
            items: teamRows,
            total: 33,
            page: 1,
            pageSize: 20,
            pageCount: 2,
            canWrite,
            canFilterSource,
          };
        if (method === "channelInventory.listTeamSourceOptions")
          return {
            items: canFilterSource
              ? [{ id: 201, name: "按需读取的团队来源" }]
              : [],
            canFilterSource,
          };
        if (method === "channelInventory.listChannels")
          return {
            items: [],
            total: 5,
            page: 1,
            pageSize: 100,
            pageCount: 1,
            canWrite: false,
          };
        throw new Error(`UNEXPECTED_TEAM_METHOD:${method}`);
      });
    return trpcBatchResult(...results);
  }
  if (
    call.pathname ===
    "/api/business-trpc/channelInventory.listMaterials,channelInventory.listChannels"
  ) {
    return trpcBatchResult(
      {
        items: [privateChannelMaterial],
        total: 33,
        page: 1,
        pageSize: 20,
        pageCount: 2,
        canWrite: false,
      },
      {
        items: [],
        total: 5,
        page: 1,
        pageSize: 100,
        pageCount: 1,
        canWrite: false,
      }
    );
  }
  if (call.pathname === "/api/business-trpc/channelInventory.listMaterials") {
    return trpcResult({
      items: [privateChannelMaterial],
      total: 33,
      page: 1,
      pageSize: 20,
      pageCount: 2,
      canWrite: false,
    });
  }
  if (
    call.pathname === "/api/business-trpc/channelInventory.listSharedMaterials"
  ) {
    return trpcResult({
      items: [sharedChannelMaterial],
      total: 7,
      page: 1,
      pageSize: 20,
    });
  }
  if (call.pathname === "/api/business-trpc/channelInventory.notesList") {
    return trpcResult({
      material: {
        id: 501,
        partNumber: "PRIVATE-TEST-501",
        brand: "测试品牌",
        channelType: "trade",
        updatedAt: "2026-11-02T00:00:00.000Z",
      },
      legacyNote: "本人私有备注不可共享",
      items: [],
      total: 0,
      page: 1,
      pageSize: 50,
      canEdit: false,
      readOnly: true,
    });
  }
  if (call.pathname === "/api/business-trpc/channelInventory.listChannels") {
    return trpcResult({
      items: [],
      total: 5,
      page: 1,
      pageSize: 100,
      pageCount: 1,
      canWrite,
    });
  }
  if (
    call.pathname ===
    "/api/business-trpc/channelInventory.getTeamMaterialSource"
  ) {
    return trpcResult({ name: "实时核验的渠道来源" });
  }
  throw new Error(
    `UNEXPECTED_LEGACY_CHANNEL_NETWORK_STUB_PATH:${call.pathname}`
  );
}

function businessProcedureInput(
  call: FetchCall | undefined,
  procedure: string
) {
  expect(call).toBeTruthy();
  expect(call!.pathname.startsWith("/api/business-trpc/")).toBe(true);
  const index = call!.pathname.split("/").at(-1)!.split(",").indexOf(procedure);
  expect(index).toBeGreaterThanOrEqual(0);
  const input = JSON.parse(
    new URL(call!.url, "http://workbench.test").searchParams.get("input")!
  );
  return input[String(index)].json;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function retryButton(container: HTMLElement, retryId: string) {
  return container.querySelector<HTMLButtonElement>(
    `[data-business-retry=\"${retryId}\"]`
  );
}

function domainCalls(calls: FetchCall[]) {
  return calls.filter(call =>
    call.pathname.startsWith("/api/business-trpc/customer.")
  );
}

describe("BusinessWorkbenchPage BFF bootstrap and context network behavior", () => {
  let mounted: MountedWorkbench | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    await mounted?.unmount();
    mounted = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["domain", "upstream"] as const)(
    "cancels requests from %s without AbortSignal.any and releases both listeners",
    source => {
      const domain = new AbortController();
      const upstream = new AbortController();
      const domainRemove = vi.spyOn(domain.signal, "removeEventListener");
      const upstreamRemove = vi.spyOn(upstream.signal, "removeEventListener");
      const { controller } = createBusinessRequestCancellation(
        domain,
        upstream.signal
      );
      (source === "domain" ? domain : upstream).abort("revoked");
      expect(controller.signal.aborted).toBe(true);
      expect(controller.signal.reason).toBe("revoked");
      expect(domainRemove).toHaveBeenCalledTimes(1);
      expect(upstreamRemove).toHaveBeenCalledTimes(1);
      expect((source === "domain" ? upstream : domain).signal.aborted).toBe(
        false
      );
    }
  );

  it("reuses an uncombined domain controller and cleans completed request listeners", () => {
    const domain = new AbortController();
    expect(createBusinessRequestCancellation(domain).controller).toBe(domain);
    const upstream = new AbortController();
    const domainRemove = vi.spyOn(domain.signal, "removeEventListener");
    const upstreamRemove = vi.spyOn(upstream.signal, "removeEventListener");
    const { controller, cleanup } = createBusinessRequestCancellation(
      domain,
      upstream.signal
    );
    cleanup();
    expect(domainRemove).toHaveBeenCalledTimes(1);
    expect(upstreamRemove).toHaveBeenCalledTimes(1);
    domain.abort();
    upstream.abort();
    expect(controller.signal.aborted).toBe(false);
  });

  it("does not attach listeners for an already canceled request", () => {
    const domain = new AbortController();
    const upstream = new AbortController();
    upstream.abort("already canceled");
    const domainAdd = vi.spyOn(domain.signal, "addEventListener");
    const upstreamAdd = vi.spyOn(upstream.signal, "addEventListener");
    const { controller } = createBusinessRequestCancellation(
      domain,
      upstream.signal
    );
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("already canceled");
    expect(domainAdd).not.toHaveBeenCalled();
    expect(upstreamAdd).not.toHaveBeenCalled();
  });

  it("uses the real bounded BFF merchants bootstrap and opens the original customer list only after an exact ready binding", async () => {
    const network = installNetwork(successfulWorkbenchResponse);
    mounted = await mountWorkbench();

    await waitFor(() => {
      expect(mounted?.container.textContent).toContain("客户列表");
      expect(mounted?.container.textContent).toContain("暂无匹配客户");
    });

    const discoveryRequest = network.calls.find(
      call => call.pathname === "/api/business-trpc/merchants"
    );
    expect(discoveryRequest?.url).toContain("batch=1");
    expect(decodeURIComponent(discoveryRequest?.url ?? "")).toContain(
      '"page":1'
    );
    expect(decodeURIComponent(discoveryRequest?.url ?? "")).toContain(
      '"pageSize":100'
    );
    expect(discoveryRequest?.headers.get("x-business-merchant-id")).toBeNull();
    expect(discoveryRequest?.headers.get("cookie")).toBeNull();
    expect(discoveryRequest?.credentials).toBe("include");
    expect(discoveryRequest?.signal).toBeInstanceOf(AbortSignal);
    const contextRequest = network.calls.find(
      call => call.pathname === "/api/business-trpc/context"
    );
    expect(contextRequest?.headers.get("x-business-merchant-id")).toBe("30061");
    expect(contextRequest?.headers.get("cookie")).toBeNull();
    expect(contextRequest?.credentials).toBe("include");
    expect(contextRequest?.signal).toBeInstanceOf(AbortSignal);
    expect(
      network.calls.some(
        call => call.pathname === "/api/trpc/business.merchants"
      )
    ).toBe(false);
    expect(
      network.calls.some(
        call => call.pathname === "/api/business-trpc/customer.context"
      )
    ).toBe(true);
    expect(
      network.calls.some(
        call => call.pathname === "/api/business-trpc/customer.list"
      )
    ).toBe(true);
  });

  it("opens the restored channel address through the BFF-bound legacy host and owner scope", async () => {
    const network = installNetwork(legacyChannelInventoryResponse);
    mounted = await mountWorkbench("/workbench/channel-inventory");

    await waitFor(() => {
      expect(mounted?.container.textContent).toContain("渠道库存");
      expect(mounted?.container.textContent).toContain("33 条库存");
    });
    const contextRequest = network.calls.find(
      call => call.pathname === "/api/business-trpc/context"
    );
    expect(contextRequest?.headers.get("x-business-merchant-id")).toBe("30061");
    expect(
      network.calls.some(
        call => call.pathname === "/api/business-trpc/enterprise.me"
      )
    ).toBe(true);
    expect(
      network.calls.some(call =>
        call.pathname.includes("channelInventory.listTeamMaterials")
      )
    ).toBe(true);
    const materialsRequest = network.calls.find(call =>
      call.pathname.includes("channelInventory.listTeamMaterials")
    );
    expect(
      businessProcedureInput(
        materialsRequest,
        "channelInventory.listTeamMaterials"
      )
    ).toMatchObject({
      expectedEnterpriseId: 1,
      expectedActorUserId: 397751,
      page: 1,
      pageSize: 20,
    });
    expect(
      network.calls.some(call =>
        /channelInventory\.(listTeamSourceOptions|listChannels|getTeamMaterialSource)/.test(
          call.pathname
        )
      )
    ).toBe(false);
    expect(
      network.calls.some(call =>
        call.pathname.includes("channelInventory.listSharedMaterials")
      )
    ).toBe(false);
    expect(
      Array.from(
        mounted.container.querySelectorAll('[role="tab"][aria-selected="true"]')
      ).map(tab => tab.textContent)
    ).toEqual(["渠道库存"]);
    const addMaterial = Array.from(
      mounted.container.querySelectorAll<HTMLButtonElement>("button")
    ).find(button => button.textContent === "单条上传");
    expect(addMaterial?.disabled).toBe(true);
    for (const call of network.calls.filter(
      call => call.pathname !== "/api/trpc/auth.me"
    )) {
      expect(call.pathname.startsWith("/api/business-trpc/")).toBe(true);
      expect(call.headers.get("cookie")).toBeNull();
      expect(call.headers.get("x-admin-id")).toBeNull();
      expect(call.credentials).toBe("include");
      if (call.pathname !== "/api/business-trpc/merchants") {
        expect(call.headers.get("x-business-merchant-id")).toBe("30061");
      }
    }
    expect(
      network.calls.some(call =>
        call.pathname.includes("officialChannelInventory")
      )
    ).toBe(false);
  });

  it("uses the closed team DTO without exposing private notes or enabling read-only inventory writes", async () => {
    const network = installNetwork(legacyChannelInventoryResponse);
    mounted = await mountWorkbench("/workbench/channel-inventory");
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain("PRIVATE-TEST-501");
      expect(mounted?.container.textContent).toContain("SHARED-TEST-502");
    });
    expect(mounted.container.textContent).not.toContain("本人私有备注不可共享");
    expect(
      mounted.container.querySelector('[aria-label="打开库存 501 的备注"]')
    ).toBeNull();
    expect(
      mounted.container
        .querySelector('[aria-label="筛选库存渠道来源"]')
        ?.hasAttribute("disabled")
    ).toBe(true);
    expect(mounted.container.querySelector('[role="dialog"]')).toBeNull();
    const materialsRequest = network.calls.find(call =>
      call.pathname.includes("channelInventory.listTeamMaterials")
    );
    expect(
      businessProcedureInput(
        materialsRequest,
        "channelInventory.listTeamMaterials"
      )
    ).toMatchObject({
      expectedEnterpriseId: 1,
      expectedActorUserId: 397751,
      page: 1,
      pageSize: 20,
    });
    expect(mounted.container.textContent).not.toContain("本人私有来源");
    expect(mounted.container.textContent).not.toContain("实时核验的渠道来源");
    expect(
      network.calls.some(call =>
        /channelInventory\.(listTeamSourceOptions|listChannels|getTeamMaterialSource)/.test(
          call.pathname
        )
      )
    ).toBe(false);
    expect(
      network.calls.some(call =>
        /notesList|notesAdd|notesEdit|getMaterial|updateMaterial|setMaterialShare|officialChannelInventory/.test(
          call.pathname
        )
      )
    ).toBe(false);
    expect(
      network.calls.every(
        call =>
          call.pathname === "/api/trpc/auth.me" ||
          (call.pathname.startsWith("/api/business-trpc/") &&
            call.credentials === "include" &&
            !call.headers.has("cookie") &&
            !call.headers.has("x-admin-id"))
      )
    ).toBe(true);
  });

  it.each(["单条上传", "上传库存"])(
    "reads source options only after filter focus and upload channels only after opening %s through the real BFF",
    async uploadLabel => {
      const network = installNetwork(call =>
        legacyChannelInventoryResponse(call, {
          canWrite: true,
          canFilterSource: true,
        })
      );
      mounted = await mountWorkbench("/workbench/channel-inventory");
      await waitFor(() =>
        expect(mounted?.container.textContent).toContain("33 条库存")
      );
      const sourceFilter = mounted.container.querySelector<HTMLSelectElement>(
        '[aria-label="筛选库存渠道来源"]'
      );
      expect(sourceFilter).toBeTruthy();
      expect(sourceFilter!.disabled).toBe(false);
      expect(
        network.calls.some(call =>
          /channelInventory\.(listTeamSourceOptions|listChannels|getTeamMaterialSource)/.test(
            call.pathname
          )
        )
      ).toBe(false);
      expect(mounted.container.textContent).not.toContain("按需读取的团队来源");

      await act(async () => sourceFilter!.focus());
      await waitFor(() =>
        expect(sourceFilter!.textContent).toContain("按需读取的团队来源")
      );
      const sourceRequests = network.calls.filter(call =>
        call.pathname.includes("channelInventory.listTeamSourceOptions")
      );
      expect(sourceRequests).toHaveLength(1);
      expect(
        businessProcedureInput(
          sourceRequests[0],
          "channelInventory.listTeamSourceOptions"
        )
      ).toEqual({
        expectedEnterpriseId: 1,
        expectedActorUserId: 397751,
      });
      expect(
        network.calls.some(call =>
          call.pathname.includes("channelInventory.listChannels")
        )
      ).toBe(false);

      const upload = Array.from(
        mounted.container.querySelectorAll<HTMLButtonElement>("button")
      ).find(button => button.textContent === uploadLabel);
      expect(upload).toBeTruthy();
      expect(upload!.disabled).toBe(false);
      await act(async () => upload!.click());
      await waitFor(() => {
        expect(document.querySelector('[role="dialog"]')).not.toBeNull();
        expect(
          network.calls.some(call =>
            call.pathname.includes("channelInventory.listChannels")
          )
        ).toBe(true);
      });
      const channelRequests = network.calls.filter(call =>
        call.pathname.includes("channelInventory.listChannels")
      );
      expect(channelRequests).toHaveLength(1);
      expect(
        businessProcedureInput(
          channelRequests[0],
          "channelInventory.listChannels"
        )
      ).toEqual({
        expectedEnterpriseId: 1,
        expectedActorUserId: 397751,
        active: true,
        page: 1,
        pageSize: 100,
      });
      for (const call of network.calls.filter(
        call => call.pathname !== "/api/trpc/auth.me"
      )) {
        expect(call.pathname.startsWith("/api/business-trpc/")).toBe(true);
        expect(call.credentials).toBe("include");
        expect(call.headers.get("cookie")).toBeNull();
        expect(call.headers.get("x-admin-id")).toBeNull();
        expect(call.signal).toBeInstanceOf(AbortSignal);
        if (call.pathname !== "/api/business-trpc/merchants") {
          expect(call.headers.get("x-business-merchant-id")).toBe("30061");
        }
      }
      expect(
        network.calls.some(call =>
          /getTeamMaterialSource|notesList|notesAdd|notesEdit|getMaterial|updateMaterial|createMaterial|setMaterialShare|officialChannelInventory/.test(
            call.pathname
          )
        )
      ).toBe(false);
    }
  );

  it("queries the BFF afresh on every source click even with a negative row hint, without enabling edits or private notes", async () => {
    const network = installNetwork(legacyChannelInventoryResponse);
    mounted = await mountWorkbench("/workbench/channel-inventory");
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("SHARED-TEST-502")
    );
    const row = Array.from(
      mounted.container.querySelectorAll<HTMLTableRowElement>("tbody tr")
    ).find(item => item.textContent?.includes("SHARED-TEST-502"));
    expect(row).toBeTruthy();
    const source = row!.querySelector<HTMLButtonElement>(".ci-source-link");
    expect(source).toBeTruthy();
    expect(source!.disabled).toBe(false);
    expect(source!.classList.contains("ci-source-link-muted")).toBe(true);
    expect(
      network.calls.some(call =>
        call.pathname.includes("getTeamMaterialSource")
      )
    ).toBe(false);

    for (let open = 1; open <= 2; open += 1) {
      await act(async () => source!.click());
      await waitFor(() =>
        expect(document.querySelector(".ci-source-name")?.textContent).toBe(
          "实时核验的渠道来源"
        )
      );
      const sourceRequests = network.calls.filter(call =>
        call.pathname.includes("getTeamMaterialSource")
      );
      expect(sourceRequests).toHaveLength(open);
      const request = sourceRequests.at(-1)!;
      expect(
        businessProcedureInput(
          request,
          "channelInventory.getTeamMaterialSource"
        )
      ).toEqual({
        materialId: 502,
        expectedEnterpriseId: 1,
        expectedActorUserId: 397751,
      });
      expect(request.headers.get("x-business-merchant-id")).toBe("30061");
      expect(request.headers.get("cookie")).toBeNull();
      expect(request.headers.get("x-admin-id")).toBeNull();
      expect(request.credentials).toBe("include");
      expect(request.signal).toBeInstanceOf(AbortSignal);
      const close = document.querySelector<HTMLButtonElement>(
        '[aria-label="关闭渠道来源"]'
      );
      expect(close).toBeTruthy();
      await act(async () => close!.click());
      expect(document.querySelector(".ci-source-dialog")).toBeNull();
      expect(mounted.container.textContent).not.toContain("实时核验的渠道来源");
    }
    expect(row!.textContent).toContain("备注（0）");
    expect(row!.textContent).not.toContain("编辑");
    expect(mounted.container.textContent).not.toContain("本人私有备注不可共享");
    expect(
      network.calls.some(call =>
        /listTeamSourceOptions|listChannels|notesList|notesAdd|notesEdit|getMaterial|updateMaterial|createMaterial|setMaterialShare|officialChannelInventory/.test(
          call.pathname
        )
      )
    ).toBe(false);
  });

  it("keeps the restored channel address closed without BFF inventory.channel scope", async () => {
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        return trpcResult({
          ...legacyChannelInventoryContext,
          workbenchCapabilities: [],
        });
      }
      return legacyChannelInventoryResponse(call);
    });
    mounted = await mountWorkbench("/workbench/channel-inventory");

    await waitFor(() =>
      expect(mounted?.container.textContent).toContain(
        "当前商户未获该业务模块访问范围"
      )
    );
    expect(
      network.calls.some(
        call =>
          call.pathname === "/api/business-trpc/enterprise.me" ||
          call.pathname.startsWith("/api/business-trpc/channelInventory.")
      )
    ).toBe(false);
  });

  it.each([
    [
      "missing identity",
      {
        ...verifiedContext,
        staffPrincipal: {
          status: "required",
          reason: "ADMIN_STAFF_PRINCIPAL_NOT_BOUND",
        },
      },
      "未绑定前台业务主体",
    ],
    [
      "missing binding version",
      {
        ...verifiedContext,
        staffPrincipal: {
          ...verifiedContext.staffPrincipal,
          bindingVersion: undefined,
        },
      },
      "未绑定前台业务主体",
    ],
    [
      "mismatched identity",
      {
        ...verifiedContext,
        staffPrincipal: {
          ...verifiedContext.staffPrincipal,
          user: { ...verifiedContext.staffPrincipal.user, id: 7999 },
        },
      },
      "未绑定前台业务主体",
    ],
    [
      "mismatched merchant",
      { ...verifiedContext, merchant: { id: 30062, canWrite: false } },
      "业务上下文与当前商户不一致",
    ],
  ])(
    "fails closed for %s and never starts a customer-domain request",
    async (_label, context, expectedTitle) => {
      const network = installNetwork(call => {
        if (call.pathname === "/api/business-trpc/context")
          return trpcResult(context);
        return successfulWorkbenchResponse(call);
      });
      mounted = await mountWorkbench();

      await waitFor(() =>
        expect(mounted?.container.textContent).toContain(expectedTitle)
      );
      expect(mounted?.container.textContent).not.toContain("客户列表");
      expect(domainCalls(network.calls)).toHaveLength(0);
    }
  );

  it("shows a bounded context error and retries the exact BFF context before opening customers", async () => {
    let contextAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextAttempts += 1;
        if (contextAttempts === 1)
          throw new TypeError("network-stub-context-unavailable");
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();

    await waitFor(() => {
      expect(mounted?.container.textContent).toContain(
        "业务上下文暂时无法核验"
      );
      expect(mounted?.container.textContent).toContain(
        "network-stub-context-unavailable"
      );
    });
    const retry = retryButton(mounted.container, "business-context-retry");
    expect(retry?.textContent).toBe("重新核验");
    await act(async () => {
      retry?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("客户列表")
    );
    expect(contextAttempts).toBe(2);
    expect(
      network.calls.filter(
        call => call.pathname === "/api/business-trpc/context"
      )
    ).toHaveLength(2);
  });

  it("turns a hanging context call into a timeout and allows an explicit retry through the same authenticated transport", async () => {
    let attempt = 0;
    const signals: AbortSignal[] = [];
    const client = createBusinessScopeTrpcClient(30061, {
      timeoutMs: 5,
      fetch: async (_input, init) => {
        attempt += 1;
        if (init?.signal) signals.push(init.signal);
        if (attempt === 1) {
          return await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true }
            );
          });
        }
        return trpcResult(verifiedContext);
      },
    });

    await expect(client.context.query()).rejects.toThrow(
      "业务主体绑定核验请求超时，请重试"
    );
    await expect(client.context.query()).resolves.toMatchObject({
      merchant: { id: 30061 },
      staffPrincipal: { status: "ready", frontendUserId: 7002 },
    });
    expect(attempt).toBe(2);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("keeps the BFF deadline through a real 200 Response whose JSON body never finishes", async () => {
    const signals: AbortSignal[] = [];
    const client = createBusinessScopeTrpcClient(30061, {
      timeoutMs: 5,
      fetch: async (_input, init) => {
        if (init?.signal) signals.push(init.signal);
        // fetch has already fulfilled with 200 headers. Only response.json(),
        // which actual tRPC runs after fetch(), is stalled here. The native
        // reader also errors as soon as the bounded fetch aborts, exercising
        // the AbortError-vs-timeout ordering race in real browsers.
        return new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
                "abort",
                () =>
                  controller.error(new DOMException("aborted", "AbortError")),
                { once: true }
              );
              // Intentionally do not enqueue or close the body.
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      },
    });

    await expect(client.context.query()).rejects.toThrow(
      "业务主体绑定核验请求超时，请重试"
    );
    expect(signals[0]?.aborted).toBe(true);
  });

  it("keeps an upstream cancellation as cancellation rather than converting it to a timeout", async () => {
    const caller = new AbortController();
    let bodyReaderStarted = false;
    const client = createBusinessScopeTrpcClient(30061, {
      timeoutMs: 50,
      fetch: async (_input, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              bodyReaderStarted = true;
              init?.signal?.addEventListener(
                "abort",
                () =>
                  controller.error(new DOMException("aborted", "AbortError")),
                { once: true }
              );
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
    });

    const request = client.context.query(undefined, { signal: caller.signal });
    await waitFor(() => expect(bodyReaderStarted).toBe(true));
    caller.abort();

    await expect(request).rejects.not.toThrow(
      "业务主体绑定核验请求超时，请重试"
    );
  });

  it("cancels an in-flight context request when the workbench unmounts", async () => {
    let contextSignal: AbortSignal | null | undefined;
    installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextSignal = call.signal;
        return new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        });
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();

    await waitFor(() => expect(contextSignal).toBeInstanceOf(AbortSignal));
    await mounted.unmount();
    mounted = undefined;
    expect(contextSignal?.aborted).toBe(true);
  });

  it("turns a hanging mounted merchants bootstrap into a timeout, keeps closed, then retries the same BFF DTO", async () => {
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) =>
      realSetTimeout(
        callback,
        delay === BUSINESS_SCOPE_REQUEST_TIMEOUT_MS ? 5 : delay,
        ...args
      )) as typeof globalThis.setTimeout);
    let merchantAttempts = 0;
    let merchantSignal: AbortSignal | null | undefined;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/merchants") {
        merchantAttempts += 1;
        if (merchantAttempts === 1) {
          merchantSignal = call.signal;
          return new Promise<Response>((_resolve, reject) => {
            call.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true }
            );
          });
        }
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();

    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("无法读取授权商户")
    );
    expect(mounted?.container.textContent).not.toContain("客户列表");
    expect(merchantSignal?.aborted).toBe(true);
    expect(
      network.calls.some(call => call.pathname === "/api/business-trpc/context")
    ).toBe(false);
    const retry = retryButton(mounted.container, "business-discovery-retry");
    expect(retry?.textContent).toBe("重新核验");
    await act(async () => {
      retry?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("客户列表")
    );
    expect(merchantAttempts).toBe(2);
    expect(
      network.calls.filter(
        call => call.pathname === "/api/business-trpc/merchants"
      )
    ).toHaveLength(2);
  });

  it.each([
    [
      "empty discovery",
      (call: FetchCall) =>
        call.pathname === "/api/business-trpc/merchants"
          ? trpcResult({ data: [], pageAvailableCount: 0, sourceTotal: 0 })
          : successfulWorkbenchResponse(call),
      "未取得可用授权",
    ],
    [
      "forbidden discovery",
      (call: FetchCall) =>
        call.pathname === "/api/business-trpc/merchants"
          ? trpcError(403, "FORBIDDEN", "当前后台账号未获业务工作台范围授权")
          : successfulWorkbenchResponse(call),
      "无法读取授权商户",
    ],
  ])(
    "keeps %s closed with a manual recheck and never substitutes merchant 30061",
    async (_label, responder, title) => {
      const network = installNetwork(responder);
      mounted = await mountWorkbench();

      await waitFor(() =>
        expect(mounted?.container.textContent).toContain(title)
      );
      expect(
        retryButton(mounted.container, "business-discovery-retry")?.textContent
      ).toBe("重新核验");
      expect(mounted?.container.textContent).not.toContain("客户列表");
      expect(
        network.calls.some(
          call => call.pathname === "/api/business-trpc/context"
        )
      ).toBe(false);
      expect(domainCalls(network.calls)).toHaveLength(0);
    }
  );

  it("rechecks an empty discovery only after an explicit click and opens only from the returned merchant DTO", async () => {
    let merchantAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/merchants") {
        merchantAttempts += 1;
        if (merchantAttempts === 1)
          return trpcResult({
            data: [],
            pageAvailableCount: 0,
            sourceTotal: 0,
          });
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();

    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("未取得可用授权")
    );
    expect(
      network.calls.some(call => call.pathname === "/api/business-trpc/context")
    ).toBe(false);
    const retry = retryButton(mounted.container, "business-discovery-retry");
    await act(async () => {
      retry?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("客户列表")
    );
    expect(merchantAttempts).toBe(2);
    expect(
      network.calls.filter(
        call => call.pathname === "/api/business-trpc/merchants"
      )
    ).toHaveLength(2);
  });

  it("keeps the same verified customer tree editable during BFCache restore revalidation, then closes it when the binding disappears", async () => {
    const restoreContext = deferred<Response>();
    const draftInvalidated = vi.fn();
    let contextAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextAttempts += 1;
        if (contextAttempts === 2) return restoreContext.promise;
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain("客户列表");
      expect(mounted?.container.textContent).toContain("暂无匹配客户");
    });
    expect(businessStorageScope()).toBe(
      "business-domain:v1:staff:7002:admin:6001:enterprise:88001:merchant:30061:binding:4"
    );
    const initialDomainCallCount = domainCalls(network.calls).length;
    const initialCustomerTitle = Array.from(
      mounted.container.querySelectorAll("h1")
    ).find(title => title.textContent === "客户列表");
    expect(initialCustomerTitle).toBeTruthy();
    window.addEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      draftInvalidated
    );

    await act(async () => {
      dispatchBusinessRestore();
    });
    await waitFor(() => {
      const boundary = mounted?.container.querySelector(
        '[data-business-context-verification="revalidating"]'
      );
      expect(boundary?.querySelector('[role="status"]')).toBeNull();
      expect(boundary?.textContent).not.toContain("正在后台核验业务主体绑定");
      expect(boundary?.querySelector("[inert]")).toBeNull();
      expect(boundary?.textContent).toContain("客户列表");
      expect(
        Array.from(mounted?.container.querySelectorAll("h1") ?? []).find(
          title => title.textContent === "客户列表"
        )
      ).toBe(initialCustomerTitle);
    });
    expect(draftInvalidated).not.toHaveBeenCalled();
    restoreContext.resolve(
      trpcResult({
        ...verifiedContext,
        staffPrincipal: {
          status: "required",
          reason: "ADMIN_STAFF_PRINCIPAL_NOT_BOUND",
        },
      })
    );

    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("未绑定前台业务主体")
    );
    expect(mounted?.container.textContent).not.toContain("客户列表");
    expect(contextAttempts).toBe(2);
    expect(domainCalls(network.calls)).toHaveLength(initialDomainCallCount);
    expect(businessStorageScope()).toBeNull();
    expect(draftInvalidated).toHaveBeenCalledTimes(1);
    window.removeEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      draftInvalidated
    );
  });

  it("fails closed after a BFCache restore recheck error even though React Query still retains the old successful context data", async () => {
    const restoreContext = deferred<Response>();
    let contextAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextAttempts += 1;
        if (contextAttempts === 2) return restoreContext.promise;
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain("客户列表");
      expect(mounted?.container.textContent).toContain("暂无匹配客户");
    });
    const initialDomainCallCount = domainCalls(network.calls).length;

    await act(async () => {
      dispatchBusinessRestore();
    });
    await waitFor(() =>
      expect(mounted?.container.querySelector(
        '[data-business-context-verification="revalidating"]'
      )).not.toBeNull()
    );
    restoreContext.reject(
      new TypeError("restore-context-revalidation-unavailable")
    );
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain(
        "业务上下文暂时无法核验"
      );
      expect(mounted?.container.textContent).toContain(
        "restore-context-revalidation-unavailable"
      );
    });
    expect(mounted?.container.textContent).not.toContain("客户列表");
    expect(domainCalls(network.calls)).toHaveLength(initialDomainCallCount);
    expect(businessStorageScope()).toBeNull();
  });

  it("restores the same verified identity after BFCache restore without remounting its customer tree or invalidating drafts", async () => {
    const restoreContext = deferred<Response>();
    const draftInvalidated = vi.fn();
    let contextAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextAttempts += 1;
        if (contextAttempts === 2) return restoreContext.promise;
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain("客户列表");
      expect(mounted?.container.textContent).toContain("暂无匹配客户");
    });
    const initialCustomerTitle = Array.from(
      mounted.container.querySelectorAll("h1")
    ).find(title => title.textContent === "客户列表");
    expect(initialCustomerTitle).toBeTruthy();
    window.addEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      draftInvalidated
    );

    await act(async () => {
      dispatchBusinessRestore();
    });
    await waitFor(() =>
      expect(
        mounted?.container.querySelector(
          '[data-business-context-verification="revalidating"]'
        )
      ).not.toBeNull()
    );
    restoreContext.resolve(trpcResult(verifiedContext));

    await waitFor(() => {
      expect(
        mounted?.container.querySelector(
          '[data-business-context-verification="verified"]'
        )
      ).not.toBeNull();
      expect(
        Array.from(mounted?.container.querySelectorAll("h1") ?? []).find(
          title => title.textContent === "客户列表"
        )
      ).toBe(initialCustomerTitle);
    });
    expect(contextAttempts).toBe(2);
    expect(draftInvalidated).not.toHaveBeenCalled();
    window.removeEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      draftInvalidated
    );
  });

  it("preserves the customer draft and expanded form after visiting another backend page with the same identity", async () => {
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/customer.context") {
        return trpcResult({
          canManageAll: false,
          actorUserId: verifiedContext.staffPrincipal.frontendUserId,
          members: [
            {
              userId: verifiedContext.staffPrincipal.frontendUserId,
              name: "虚构绑定员工",
            },
          ],
        });
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("暂无匹配客户")
    );
    const toggle = Array.from(
      mounted.container.querySelectorAll<HTMLButtonElement>("button")
    ).find(node => node.textContent?.trim() === "录入客户");
    expect(toggle).toBeTruthy();
    await act(async () => toggle!.click());
    const input = mounted.container.querySelector<HTMLInputElement>(
      '[data-customer-field="name"]'
    );
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, "跨后台页虚构测试客户");
      input!.dispatchEvent(new window.Event("input", { bubbles: true }));
      input!.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    expect(input!.value).toBe("跨后台页虚构测试客户");
    const invalidated = vi.fn();
    window.addEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      invalidated
    );
    const scopeCount = network.calls.filter(call =>
      /\/(merchants|context)$/.test(call.pathname)
    ).length;
    await mounted.leaveWorkbench();
    expect(mounted.container.textContent).toContain("其它后台页面");
    expect(invalidated).not.toHaveBeenCalled();
    await mounted.returnToWorkbench();
    expect(
      mounted.container.querySelector("[data-business-loading]")
    ).toBeNull();
    expect(
      network.calls.filter(call => /\/(merchants|context)$/.test(call.pathname))
    ).toHaveLength(scopeCount);
    await waitFor(() =>
      expect(
        mounted?.container.querySelector<HTMLInputElement>(
          '[data-customer-field="name"]'
        )?.value
      ).toBe("跨后台页虚构测试客户")
    );
    expect(invalidated).not.toHaveBeenCalled();
    window.removeEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      invalidated
    );
  });

  it("uses a new domain cache and storage namespace when a BFCache restore recheck returns a new bindingVersion", async () => {
    let contextAttempts = 0;
    let listAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextAttempts += 1;
        return trpcResult(
          contextAttempts === 1
            ? verifiedContext
            : {
                ...verifiedContext,
                staffPrincipal: {
                  ...verifiedContext.staffPrincipal,
                  bindingVersion: 5,
                },
              }
        );
      }
      if (call.pathname === "/api/business-trpc/customer.context") {
        return trpcResult({ canManageAll: false, members: [] });
      }
      if (call.pathname === "/api/business-trpc/customer.list") {
        listAttempts += 1;
        return trpcResult({
          items: [
            customerRecord(
              listAttempts,
              listAttempts === 1 ? "旧绑定客户" : "新绑定客户"
            ),
          ],
          total: 1,
        });
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("旧绑定客户")
    );
    expect(businessStorageScope()).toBe(
      "business-domain:v1:staff:7002:admin:6001:enterprise:88001:merchant:30061:binding:4"
    );

    await act(async () => {
      dispatchBusinessRestore();
    });

    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("新绑定客户")
    );
    expect(mounted?.container.textContent).not.toContain("旧绑定客户");
    expect(contextAttempts).toBe(2);
    expect(listAttempts).toBe(2);
    expect(businessStorageScope()).toBe(
      "business-domain:v1:staff:7002:admin:6001:enterprise:88001:merchant:30061:binding:5"
    );
  });

  it("invalidates customer-entry drafts and remounts the branch when a successful BFCache restore recheck revokes customer write scope without changing identity", async () => {
    const restoreContext = deferred<Response>();
    const draftInvalidated = vi.fn();
    const customerWriteContext = {
      ...verifiedContext,
      merchant: { id: 30061, canWrite: true },
      writeCapabilities: ["customers.manage"],
    };
    let contextAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextAttempts += 1;
        if (contextAttempts === 1) return trpcResult(customerWriteContext);
        if (contextAttempts === 2) return restoreContext.promise;
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain("客户列表");
      expect(mounted?.container.textContent).toContain("暂无匹配客户");
    });
    const initialCustomerTitle = Array.from(
      mounted.container.querySelectorAll("h1")
    ).find(title => title.textContent === "客户列表");
    expect(initialCustomerTitle).toBeTruthy();
    window.addEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      draftInvalidated
    );

    await act(async () => {
      dispatchBusinessRestore();
    });
    await waitFor(() =>
      expect(mounted?.container.querySelector(
        '[data-business-context-verification="revalidating"]'
      )).not.toBeNull()
    );
    expect(draftInvalidated).not.toHaveBeenCalled();
    restoreContext.resolve(
      trpcResult({
        ...customerWriteContext,
        merchant: { id: 30061, canWrite: false },
        writeCapabilities: [],
      })
    );

    await waitFor(() => {
      const currentCustomerTitle = Array.from(
        mounted?.container.querySelectorAll("h1") ?? []
      ).find(title => title.textContent === "客户列表");
      expect(currentCustomerTitle).toBeTruthy();
      expect(currentCustomerTitle).not.toBe(initialCustomerTitle);
      expect(mounted?.container.textContent).toContain("暂无匹配客户");
    });
    expect(contextAttempts).toBe(2);
    expect(businessStorageScope()).toBe(
      "business-domain:v1:staff:7002:admin:6001:enterprise:88001:merchant:30061:binding:4"
    );
    expect(draftInvalidated).toHaveBeenCalledTimes(1);
    window.removeEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      draftInvalidated
    );
  });

  it("rebuilds the verified workbench branch when a same-identity restore check changes another BFF workbench capability", async () => {
    const restoreContext = deferred<Response>();
    const draftInvalidated = vi.fn();
    let contextAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextAttempts += 1;
        if (contextAttempts === 2) return restoreContext.promise;
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("客户列表")
    );
    const initialCustomerTitle = Array.from(
      mounted.container.querySelectorAll("h1")
    ).find(title => title.textContent === "客户列表");
    expect(initialCustomerTitle).toBeTruthy();
    const initialDomainCallCount = domainCalls(network.calls).length;
    window.addEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      draftInvalidated
    );

    await act(async () => {
      dispatchBusinessRestore();
    });
    await waitFor(() =>
      expect(mounted?.container.querySelector(
        '[data-business-context-verification="revalidating"]'
      )).not.toBeNull()
    );
    restoreContext.resolve(
      trpcResult({
        ...verifiedContext,
        workbenchCapabilities: ["customers.manage", "inventory.read"],
      })
    );

    await waitFor(() => {
      const currentCustomerTitle = Array.from(
        mounted?.container.querySelectorAll("h1") ?? []
      ).find(title => title.textContent === "客户列表");
      expect(currentCustomerTitle).toBeTruthy();
      expect(currentCustomerTitle).not.toBe(initialCustomerTitle);
    });
    expect(contextAttempts).toBe(2);
    expect(domainCalls(network.calls).length).toBeGreaterThan(
      initialDomainCallCount
    );
    expect(draftInvalidated).toHaveBeenCalledTimes(1);
    window.removeEventListener(
      CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT,
      draftInvalidated
    );
  });

  it("cancels a live customer-domain request and clears its storage scope when the workbench unmounts", async () => {
    let customerContextSignal: AbortSignal | null | undefined;
    installNetwork(call => {
      if (call.pathname === "/api/business-trpc/customer.context") {
        customerContextSignal = call.signal;
        return new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          );
        });
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();

    await waitFor(() =>
      expect(customerContextSignal).toBeInstanceOf(AbortSignal)
    );
    expect(businessStorageScope()).toBe(
      "business-domain:v1:staff:7002:admin:6001:enterprise:88001:merchant:30061:binding:4"
    );
    await mounted.unmount();
    mounted = undefined;
    expect(customerContextSignal?.aborted).toBe(true);
    expect(businessStorageScope()).toBeNull();
  });
  it("keeps a real editable customer input and scroll position through coalesced restore checks and same-identity responses", async () => {
    const fresh = deferred<Response>();
    let checks = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context" && ++checks === 2)
        return fresh.promise;
      if (call.pathname === "/api/business-trpc/customer.context")
        return trpcResult({
          canManageAll: false,
          actorUserId: 7002,
          members: [{ userId: 7002, name: "虚构员工" }],
        });
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("暂无匹配客户")
    );
    const toggle = Array.from(
      mounted.container.querySelectorAll<HTMLButtonElement>("button")
    ).find(node => node.textContent?.trim() === "录入客户");
    await act(async () => toggle!.click());
    const input = mounted.container.querySelector<HTMLInputElement>(
      '[data-customer-field="name"]'
    )!;
    expect(input).toBeTruthy();
    const scroll = input.closest("section")!;
    scroll.scrollTop = 123;
    await act(async () => {
      dispatchBusinessRestore();
      dispatchBusinessRestore();
      dispatchBusinessRestore();
    });
    await waitFor(() => expect(checks).toBe(2));
    expect(mounted.container.querySelector("[inert]")).toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, "复核中继续输入的虚构客户");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    expect(input.value).toBe("复核中继续输入的虚构客户");
    // A bfcache event is not debounced away, but joins the in-flight request.
    await act(async () => {
      const event = new window.Event("pageshow");
      Object.defineProperty(event, "persisted", { value: true });
      window.dispatchEvent(event);
    });
    expect(checks).toBe(2);
    fresh.resolve(trpcResult(verifiedContext));
    await waitFor(() =>
      expect(
        mounted?.container.querySelector(
          '[data-business-context-verification="verified"]'
        )
      ).not.toBeNull()
    );
    expect(
      mounted.container.querySelector('[data-customer-field="name"]')
    ).toBe(input);
    expect(input.value).toBe("复核中继续输入的虚构客户");
    expect(scroll.scrollTop).toBe(123);
    expect(
      network.calls.filter(
        call => call.pathname === "/api/business-trpc/context"
      )
    ).toHaveLength(2);
  });

  it("retains a verified authenticated identity after 30 seconds and cache-GC age without another bootstrap read", async () => {
    const network = installNetwork(successfulWorkbenchResponse);
    mounted = await mountWorkbench();
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("暂无匹配客户")
    );
    const scope = businessStorageScope();
    const invalidated = vi.fn();
    window.addEventListener(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT, invalidated);
    vi.useFakeTimers();
    await mounted.leaveWorkbench();
    await act(async () => { await vi.advanceTimersByTimeAsync(6 * 60_000); });
    await mounted.returnToWorkbench();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    vi.useRealTimers();
    expect(mounted.container.textContent).toContain("客户列表");
    expect(mounted.container.querySelector("[data-business-loading]")).toBeNull();
    expect(mounted.container.querySelector('[data-business-context-verification="verified"]')).not.toBeNull();
    expect(mounted.container.textContent).not.toContain("正在后台核验业务主体绑定");
    expect(businessStorageScope()).toBe(scope);
    expect(invalidated).not.toHaveBeenCalled();
    for (const procedure of ["merchants", "context"])
      expect(network.calls.filter(call => call.pathname === `/api/business-trpc/${procedure}`)).toHaveLength(1);
    window.removeEventListener(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT, invalidated);
  });

  it("does not deserialize persisted ready context into authority while root authentication is UNKNOWN", async () => {
    const auth = deferred<Response>();
    const network = installNetwork(
      successfulWorkbenchResponse,
      () => auth.promise
    );
    mounted = await mountWorkbench();
    localStorage.setItem(
      "manus-runtime-user-info",
      JSON.stringify({ id: 6001 })
    );
    localStorage.setItem("business-context", JSON.stringify(verifiedContext));
    sessionStorage.setItem("business-context", JSON.stringify(verifiedContext));
    await mounted.leaveWorkbench();
    await mounted.returnToWorkbench();
    expect(
      mounted.container.querySelector(
        '[data-business-loading="business-session"]'
      )
    ).not.toBeNull();
    expect(mounted.container.textContent).toContain("正在加载工作区");
    expect(
      network.calls.filter(call =>
        call.pathname.startsWith("/api/business-trpc/")
      )
    ).toHaveLength(0);
    auth.resolve(trpcResult({ id: 6001 }));
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("客户列表")
    );
    expect(
      network.calls.filter(
        call => call.pathname === "/api/business-trpc/context"
      )
    ).toHaveLength(1);
  });

  it.each([401, 403])(
    "closes a verified context on HTTP %s and cancels a live old-domain request",
    async status => {
      const fresh = deferred<Response>();
      const oldList = deferred<Response>();
      let checks = 0;
      let oldSignal: AbortSignal | null | undefined;
      installNetwork(call => {
        if (call.pathname === "/api/business-trpc/context" && ++checks === 2)
          return fresh.promise;
        if (call.pathname === "/api/business-trpc/customer.list") {
          oldSignal = call.signal;
          return oldList.promise;
        }
        return successfulWorkbenchResponse(call);
      });
      mounted = await mountWorkbench();
      await waitFor(() => expect(oldSignal).toBeInstanceOf(AbortSignal));
      await act(async () => dispatchBusinessRestore());
      await waitFor(() => expect(checks).toBe(2));
      fresh.resolve(
        trpcError(
          status,
          status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
          "服务端已撤销业务访问",
          "STAFF_BINDING_INVALID"
        )
      );
      await waitFor(() =>
        expect(mounted?.container.textContent).toContain("业务访问授权已失效")
      );
      expect(oldSignal?.aborted).toBe(true);
      expect(businessStorageScope()).toBeNull();
      oldList.resolve(
        trpcResult({
          items: [customerRecord(91, "撤销后迟到的旧客户")],
          total: 1,
        })
      );
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
      });
      expect(mounted.container.textContent).not.toContain("撤销后迟到的旧客户");
      expect(mounted.container.textContent).not.toContain("客户列表");
    }
  );

  it.each([401, 403])(
    "also revokes on a real domain HTTP %s instead of retaining a successful context forever",
    async status => {
      const network = installNetwork(call =>
        call.pathname === "/api/business-trpc/customer.list"
          ? trpcError(
              status,
              status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
              "实时业务读取被拒绝",
              "STAFF_BINDING_INVALID"
            )
          : successfulWorkbenchResponse(call)
      );
      mounted = await mountWorkbench();
      await waitFor(() =>
        expect(mounted?.container.textContent).toContain("业务访问授权已失效")
      );
      expect(mounted.container.textContent).not.toContain("客户列表");
      expect(businessStorageScope()).toBeNull();
      expect(domainCalls(network.calls).length).toBeGreaterThan(0);
    }
  );

  it("clears the retained domain when changing merchant while a request is still pending", async () => {
    let signal: AbortSignal | null | undefined;
    installNetwork(call => {
      if (call.pathname === "/api/business-trpc/customer.list") {
        signal = call.signal;
        return new Promise<Response>((_resolve, reject) =>
          call.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true }
          )
        );
      }
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();
    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal));
    await mounted.navigate("/workbench/customers?merchantId=30062");
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("请求的业务商户不可用")
    );
    expect(signal?.aborted).toBe(true);
    expect(businessStorageScope()).toBeNull();
  });

  it("fences concurrent old requests and never reuses customer data after a real root account switch", async () => {
    let accountId = 6001;
    let oldSignal: AbortSignal | null | undefined;
    const oldList = deferred<Response>();
    const nextContext = deferred<Response>();
    const network = installNetwork(
      call => {
        if (
          call.pathname === "/api/business-trpc/context" &&
          accountId === 6002
        )
          return nextContext.promise;
        if (call.pathname === "/api/business-trpc/customer.list") {
          if (accountId === 6001) {
            oldSignal = call.signal;
            return oldList.promise;
          }
          return trpcResult({
            items: [customerRecord(92, "新账号客户")],
            total: 1,
          });
        }
        return successfulWorkbenchResponse(call);
      },
      () => trpcResult({ id: accountId })
    );
    mounted = await mountWorkbench();
    await waitFor(() => expect(oldSignal).toBeInstanceOf(AbortSignal));
    accountId = 6002;
    await mounted.refreshAuth();
    await waitFor(() =>
      expect(
        network.calls.filter(
          call => call.pathname === "/api/business-trpc/context"
        )
      ).toHaveLength(2)
    );
    expect(oldSignal?.aborted).toBe(true);
    expect(mounted.container.textContent).not.toContain("客户列表");
    oldList.resolve(
      trpcResult({ items: [customerRecord(93, "旧账号迟到客户")], total: 1 })
    );
    nextContext.resolve(
      trpcResult({
        ...verifiedContext,
        staffPrincipal: {
          ...verifiedContext.staffPrincipal,
          adminAccountId: 6002,
          frontendUserId: 7003,
          user: { ...verifiedContext.staffPrincipal.user, id: 7003 },
        },
      })
    );
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("新账号客户")
    );
    expect(mounted.container.textContent).not.toContain("旧账号迟到客户");
    expect(businessStorageScope()).toContain("staff:7003:admin:6002:");
  });

  it("observes logout outside the workbench and requires new BFF proofs even for the same account login", async () => {
    const network = installNetwork(successfulWorkbenchResponse);
    mounted = await mountWorkbench();
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("暂无匹配客户")
    );
    await mounted.leaveWorkbench();
    await mounted.clearAuth();
    await mounted.returnToWorkbench();
    expect(mounted.container.textContent).not.toContain("客户列表");
    expect(
      mounted.container.querySelector(
        '[data-business-loading="business-session"]'
      )
    ).not.toBeNull();
    // This is a new live auth.me response, not persisted user JSON.
    await mounted.refreshAuth();
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("暂无匹配客户")
    );
    expect(
      network.calls.filter(
        call => call.pathname === "/api/business-trpc/merchants"
      )
    ).toHaveLength(2);
    expect(
      network.calls.filter(
        call => call.pathname === "/api/business-trpc/context"
      )
    ).toHaveLength(2);
    expect(domainCalls(network.calls)).toHaveLength(4);
  });

  it("rejects an otherwise ready BFF principal belonging to another root admin account or enterprise", async () => {
    const network = installNetwork(call =>
      call.pathname === "/api/business-trpc/context"
        ? trpcResult({
            ...verifiedContext,
            staffPrincipal: {
              ...verifiedContext.staffPrincipal,
              adminAccountId: 6999,
              enterpriseId: 89999,
            },
          })
        : successfulWorkbenchResponse(call)
    );
    mounted = await mountWorkbench();
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("未绑定前台业务主体")
    );
    expect(domainCalls(network.calls)).toHaveLength(0);
  });
  it("still sends a real customer command to the BFF during background verification and closes on its 403", async () => {
    // Restore via afterEach, while exercising the actual BFF transport without any().
    vi.spyOn(AbortSignal, "any");
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      value: undefined,
    });
    const focus = deferred<Response>();
    let checks = 0;
    const writeContext = {
      ...verifiedContext,
      merchant: { id: 30061, canWrite: true },
      writeCapabilities: ["customers.manage"],
    };
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context")
        return ++checks === 1 ? trpcResult(writeContext) : focus.promise;
      if (call.pathname === "/api/business-trpc/customer.context")
        return trpcResult({
          canManageAll: false,
          actorUserId: 7002,
          members: [{ userId: 7002, name: "合成员工" }],
        });
      if (call.pathname === "/api/business-trpc/customer.createMulti")
        return trpcError(403, "FORBIDDEN", "实时写入鉴权拒绝", "TENANT_ACCESS_REVOKED");
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("暂无匹配客户")
    );
    const toggle = Array.from(
      mounted.container.querySelectorAll<HTMLButtonElement>("button")
    ).find(node => node.textContent?.trim() === "录入客户");
    await act(async () => toggle!.click());
    expect(
      mounted.container.querySelector<HTMLInputElement>(
        '[data-customer-field="name"]'
      )?.disabled
    ).toBe(false);
    const setValue = async (selector: string, value: string) => {
      const input = mounted!.container.querySelector<
        HTMLInputElement | HTMLSelectElement
      >(selector)!;
      expect(input).toBeTruthy();
      await act(async () => {
        const prototype =
          input.tagName === "SELECT"
            ? window.HTMLSelectElement.prototype
            : window.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
          input,
          value
        );
        input.dispatchEvent(
          new window.Event(input.tagName === "SELECT" ? "change" : "input", {
            bubbles: true,
          })
        );
        if (input.tagName !== "SELECT")
          input.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
    };
    await setValue('[data-customer-field="name"]', "仅本地网络桩虚构客户");
    await act(async () => {
      mounted!.container
        .querySelector('[data-customer-field="industryCode"]')!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", {
            key: "ArrowDown",
            bubbles: true,
          })
        );
    });
    const industry = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]')
    ).find(node => node.textContent === "汽车电子");
    expect(industry).toBeTruthy();
    await act(async () => industry!.click());
    expect(
      mounted.container.querySelector('[data-customer-field="industryCode"]')
        ?.textContent
    ).toContain("汽车电子");
    await setValue('input[aria-label="联系人1姓名"]', "虚构联系人");
    await setValue('input[aria-label="联系人1联系方式值"]', "13800138000");
    await act(async () => dispatchBusinessRestore());
    await waitFor(() => expect(checks).toBe(2));
    expect(
      mounted.container.querySelector(
        '[data-business-context-verification="revalidating"]'
      )
    ).not.toBeNull();
    const save = Array.from(
      mounted.container.querySelectorAll<HTMLButtonElement>("button")
    ).find(node => node.textContent?.trim() === "保存");
    expect(save?.disabled).toBe(false);
    await act(async () => save!.click());
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("业务访问授权已失效")
    );
    const command = network.calls.find(
      call => call.pathname === "/api/business-trpc/customer.createMulti"
    );
    expect(command).toBeTruthy();
    expect(command?.headers.get("x-business-merchant-id")).toBe("30061");
    expect(command?.credentials).toBe("include");
    expect(command?.headers.get("cookie")).toBeNull();
    expect(command?.headers.get("x-admin-id")).toBeNull();
    expect(
      network.calls.findLast(
        call => call.pathname === "/api/business-trpc/context"
      )?.signal?.aborted
    ).toBe(true);
    focus.resolve(trpcResult(writeContext));
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(mounted.container.textContent).not.toContain("客户列表");
    expect(businessStorageScope()).toBeNull();
  });

  it.each(["empty", "forbidden"] as const)(
    "requires a new context proof after %s merchant scope is revoked and later restored, without trusting retained identity proofs",
    async deniedScope => {
      let discoveryAttempts = 0;
      const revokedScope = deferred<Response>();
      const secondContext = deferred<Response>();
      const restoredContext = deferred<Response>();
      let contextAttempts = 0;
      const network = installNetwork(call => {
        if (
          call.pathname === "/api/business-trpc/merchants" &&
          ++discoveryAttempts === 2
        )
          return revokedScope.promise;
        if (call.pathname === "/api/business-trpc/context") {
          ++contextAttempts;
          if (contextAttempts === 2) return secondContext.promise;
          if (contextAttempts === 3) return restoredContext.promise;
        }
        return successfulWorkbenchResponse(call);
      });
      mounted = await mountWorkbench();
      await waitFor(() =>
        expect(mounted?.container.textContent).toContain("暂无匹配客户")
      );
      await act(async () => dispatchBusinessRestore());
      await waitFor(() => expect(contextAttempts).toBe(2));
      revokedScope.resolve(
        deniedScope === "empty"
          ? trpcResult({ data: [], pageAvailableCount: 0, sourceTotal: 0 })
          : trpcError(403, "FORBIDDEN", "商户范围已撤销")
      );
      await waitFor(() =>
        expect(mounted?.container.textContent).toContain(
          deniedScope === "empty" ? "未取得可用授权" : "无法读取授权商户"
        )
      );
      expect(businessStorageScope()).toBeNull();
      // The parallel restore context was canceled by discovery revocation.
      expect(
        network.calls
          .filter(call => call.pathname === "/api/business-trpc/context")
          .at(-1)?.signal?.aborted
      ).toBe(true);
      await act(async () =>
        retryButton(mounted!.container, "business-discovery-retry")!.click()
      );
      await waitFor(() => expect(contextAttempts).toBe(3));
      expect(discoveryAttempts).toBe(3);
      expect(mounted.container.textContent).not.toContain("客户列表");
      expect(businessStorageScope()).toBeNull();
      expect(domainCalls(network.calls)).toHaveLength(2);
      secondContext.resolve(trpcResult(verifiedContext));
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
      });
      expect(mounted.container.textContent).not.toContain("客户列表");
      expect(businessStorageScope()).toBeNull();
      expect(domainCalls(network.calls)).toHaveLength(2);
      restoredContext.resolve(
        trpcResult({
          ...verifiedContext,
          staffPrincipal: {
            ...verifiedContext.staffPrincipal,
            frontendUserId: 7003,
            bindingVersion: 5,
            user: { ...verifiedContext.staffPrincipal.user, id: 7003 },
          },
        })
      );
      await waitFor(() =>
        expect(mounted?.container.textContent).toContain("暂无匹配客户")
      );
      expect(mounted.container.textContent).toContain("客户列表");
      expect(businessStorageScope()).toContain("staff:7003:");
      expect(businessStorageScope()).toContain(":binding:5");
      expect(domainCalls(network.calls)).toHaveLength(4);
    }
  );

  it("replaces enterprise cache scope when the same bound account moves to another BFF-proven enterprise", async () => {
    let checks = 0;
    let lists = 0;
    installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context")
        return trpcResult(
          ++checks === 1
            ? verifiedContext
            : {
                ...verifiedContext,
                enterprise: { ...verifiedContext.enterprise, id: 88002 },
                staffPrincipal: {
                  ...verifiedContext.staffPrincipal,
                  enterpriseId: 88002,
                },
              }
        );
      if (call.pathname === "/api/business-trpc/customer.list")
        return trpcResult({
          items: [
            customerRecord(++lists, lists === 1 ? "原企业客户" : "新企业客户"),
          ],
          total: 1,
        });
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench();
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("原企业客户")
    );
    await act(async () => dispatchBusinessRestore());
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("新企业客户")
    );
    expect(mounted.container.textContent).not.toContain("原企业客户");
    expect(businessStorageScope()).toContain(":enterprise:88002:");
    expect(lists).toBe(2);
  });

  it("rejects a mismatched enterprise projection even with the exact root account and a ready staff binding", async () => {
    const network = installNetwork(call =>
      call.pathname === "/api/business-trpc/context"
        ? trpcResult({
            ...verifiedContext,
            enterprise: { ...verifiedContext.enterprise, id: 89999 },
          })
        : successfulWorkbenchResponse(call)
    );
    mounted = await mountWorkbench();
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("业务上下文不可用")
    );
    expect(domainCalls(network.calls)).toHaveLength(0);
  });

  it.each([
    ["review", "company-review-toggle", "publicReview.inbox", "暂无权限查看企业评论"],
    ["pickup", "pickup-point-toggle", "pickupPoint.mine", "暂无权限查看自提点"],
    ["photos", "company-photos-toggle", "company.profilePhotos", "暂无权限管理公司信息墙"],
  ])("keeps %s resource 403 local after an explicit module open and permits another route without a revoked banner", async (_label, toggle, procedure, message) => {
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") return trpcResult({
        ...verifiedContext, workbenchCapabilities: ["company.read", "customers.manage"],
      });
      if (call.pathname === "/api/business-trpc/company.get") return trpcResult({
        id: 601, companyName: "合成已认证企业", certLevel: "normal", reviewStatus: "approved",
      });
      if (call.pathname === `/api/business-trpc/${procedure}`)
        return trpcError(403, "FORBIDDEN", "服务端明确的局部业务拒绝", "BUSINESS_RESOURCE_FORBIDDEN");
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench("/workbench/company-info");
    await waitFor(() => expect(mounted?.container.textContent).toContain("企业信息"));
    const optionalCalls = () => network.calls.filter(call => /publicReview\.inbox|pickupPoint\.mine|company\.profilePhotos/.test(call.pathname));
    expect(optionalCalls()).toHaveLength(0);
    const invalidated = vi.fn();
    window.addEventListener(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT, invalidated);
    await act(async () => mounted!.container.querySelector<HTMLButtonElement>(`[data-testid="${toggle}"]`)!.click());
    await waitFor(() => expect(mounted?.container.textContent).toContain(message));
    expect(mounted.container.textContent).toContain("服务端明确的局部业务拒绝");
    expect(optionalCalls()).toHaveLength(1);
    expect(invalidated).not.toHaveBeenCalled();
    await mounted.navigate("/workbench/customers");
    await waitFor(() => expect(mounted?.container.textContent).toContain("暂无匹配客户"));
    expect(mounted.container.textContent).not.toContain("业务访问授权已失效");
    expect(mounted.container.textContent).not.toContain("业务请求安全核验未通过");
    expect(network.calls.filter(call => call.pathname === "/api/business-trpc/context")).toHaveLength(1);
    expect(invalidated).not.toHaveBeenCalled();
    window.removeEventListener(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT, invalidated);
  });

  it("does not request any optional company module when certification is not approved, even when opened", async () => {
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") return trpcResult({
        ...verifiedContext, workbenchCapabilities: ["company.read"],
      });
      if (call.pathname === "/api/business-trpc/company.get") return trpcResult({
        id: 602, companyName: "合成待审核企业", certLevel: "pending", reviewStatus: "pending",
      });
      return successfulWorkbenchResponse(call);
    });
    mounted = await mountWorkbench("/workbench/company-info");
    await waitFor(() => expect(mounted?.container.textContent).toContain("企业信息"));
    for (const toggle of ["company-review-toggle", "pickup-point-toggle", "company-photos-toggle"])
      await act(async () => mounted!.container.querySelector<HTMLButtonElement>(`[data-testid="${toggle}"]`)!.click());
    expect(mounted.container.textContent).toContain("企业审核通过后");
    expect(network.calls.some(call => /publicReview\.inbox|pickupPoint\.mine|company\.profilePhotos/.test(call.pathname))).toBe(false);
  });

  it("fails closed for an unclassified domain 403 without claiming a proven session revocation across routes", async () => {
    installNetwork(call => call.pathname === "/api/business-trpc/customer.list"
      ? trpcError(403, "FORBIDDEN", "未知安全拒绝") : successfulWorkbenchResponse(call));
    mounted = await mountWorkbench();
    await waitFor(() => expect(mounted?.container.textContent).toContain("业务请求安全核验未通过"));
    expect(mounted.container.textContent).not.toContain("业务访问授权已失效");
    expect(businessStorageScope()).toBeNull();
    await mounted.navigate("/workbench/company-info");
    expect(mounted.container.textContent).toContain("业务请求安全核验未通过");
    expect(mounted.container.textContent).not.toContain("企业信息");
  });

  it("destroys a domain on a marked binding failure even when its TRPC code is PRECONDITION_FAILED", async () => {
    installNetwork(call => call.pathname === "/api/business-trpc/customer.list"
      ? trpcError(412, "PRECONDITION_FAILED", "绑定已撤销", "STAFF_BINDING_INVALID") : successfulWorkbenchResponse(call));
    mounted = await mountWorkbench();
    await waitFor(() => expect(mounted?.container.textContent).toContain("业务访问授权已失效"));
    expect(businessStorageScope()).toBeNull();
    expect(mounted.container.textContent).not.toContain("客户列表");
    await mounted.leaveWorkbench();
    await mounted.returnToWorkbench();
    expect(mounted.container.textContent).toContain("业务访问授权已失效");
  });

  it.each(["same", "reordered-capabilities", "server-permission-revision", "native-role"] as const)(
    "uses a stable authorization version through a %s context recheck", async change => {
      let checks = 0;
      let lists = 0;
      const initial = { ...verifiedContext, authorizationVersion: "team-7:member:read-v1",
        workbenchCapabilities: ["customers.manage", "company.read"] };
      const refreshed = {
        ...initial,
        authorizationVersion: change === "server-permission-revision" ? "team-8:member:read-v2" : initial.authorizationVersion,
        workbenchCapabilities: change === "reordered-capabilities" ? ["company.read", "customers.manage"] : initial.workbenchCapabilities,
        staffPrincipal: { ...initial.staffPrincipal, user: { ...initial.staffPrincipal.user,
          role: change === "native-role" ? "admin" : "user" } },
      };
      installNetwork(call => {
        if (call.pathname === "/api/business-trpc/context") return trpcResult(++checks === 1 ? initial : refreshed);
        if (call.pathname === "/api/business-trpc/customer.list") return trpcResult({
          items: [customerRecord(++lists, lists === 1 ? "初始权限客户" : "新授权版本客户")], total: 1,
        });
        return successfulWorkbenchResponse(call);
      });
      mounted = await mountWorkbench();
      await waitFor(() => expect(mounted?.container.textContent).toContain("初始权限客户"));
      const title = mounted.container.querySelector("h1");
      const scope = businessStorageScope();
      const invalidated = vi.fn();
      window.addEventListener(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT, invalidated);
      await act(async () => dispatchBusinessRestore());
      await waitFor(() => expect(checks).toBe(2));
      await waitFor(() => expect(mounted?.container.querySelector('[data-business-context-verification="verified"]')).not.toBeNull());
      const changed = change === "server-permission-revision" || change === "native-role";
      expect(businessStorageScope()).toBe(scope);
      if (changed) {
        await waitFor(() => expect(mounted?.container.textContent).toContain("新授权版本客户"));
        expect(mounted.container.querySelector("h1")).not.toBe(title);
        expect(mounted.container.textContent).not.toContain("初始权限客户");
        expect(invalidated).toHaveBeenCalledTimes(1);
      } else {
        expect(mounted.container.querySelector("h1")).toBe(title);
        expect(lists).toBe(1);
        expect(invalidated).not.toHaveBeenCalled();
      }
      window.removeEventListener(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT, invalidated);
    },
  );

  it("v13 allows the real bound channel reader without ERP editing and renders the original recorder DTO", async () => {
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") return trpcResult({
        ...legacyChannelInventoryContext,
        merchant: { ...legacyChannelInventoryContext.merchant, canWrite: false },
        officialInventoryPermissions: { read: true, write: false, note: false, authorizationVersion: "reader-v1" },
      });
      if (call.pathname === "/api/business-trpc/enterprise.me") return trpcResult({
        currentUserId: 397751, enterprise: { id: 1 }, isOwner: false, permissionKeys: ["stocks.read"],
      });
      if (call.pathname === "/api/business-trpc/channelInventory.listTeamMaterials") return trpcResult({
        items: [{ ...sharedChannelMaterial, originalRecorderName: "Jack", noteCount: 0, canAddNote: false, isMine: false }],
        total: 1, page: 1, pageSize: 20, pageCount: 1, canWrite: false, canFilterSource: false,
      });
      return legacyChannelInventoryResponse(call);
    });
    mounted = await mountWorkbench("/workbench/channel-inventory");
    await waitFor(() => expect(mounted?.container.textContent).toContain("SHARED-TEST-502"));
    expect(mounted.container.querySelector("td.ci-material-recorder-col")?.textContent).toBe("Jack");
    expect(mounted.container.querySelectorAll("thead th")).toHaveLength(10);
    expect(mounted.container.querySelector("thead")?.textContent).toContain("所属行业");
    for (const label of ["单条上传", "上传库存"]) expect(Array.from(mounted.container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === label)?.disabled).toBe(true);
    expect(mounted.container.querySelector("textarea")).toBeNull();
    expect(network.calls.some(call => /officialChannelInventory|channelInventory\.(getTeamMaterialForEdit|createMaterial|notesList)/.test(call.pathname))).toBe(false);
  });

  it.each(["version", "read", "write", "note"] as const)("v13 rotates native %s proof without rendering prior cached channel inventory", async change => {
    let checks = 0;
    let reads = 0;
    const pending = deferred<Response>();
    const first = legacyChannelInventoryContext.officialInventoryPermissions;
    const second = { ...first,
      ...(change === "version" ? { authorizationVersion: "native-grants-v2" } : { [change]: false }),
    };
    installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") return trpcResult({
        ...legacyChannelInventoryContext,
        // Deliberately keep the outer version and route capability unchanged:
        // the dedicated native grant proof must be sufficient to invalidate.
        authorizationVersion: "outer-team-v1",
        officialInventoryPermissions: ++checks === 1 ? first : second,
      });
      if (call.pathname === "/api/business-trpc/channelInventory.listTeamMaterials" && ++reads > 1) return pending.promise;
      return legacyChannelInventoryResponse(call);
    });
    mounted = await mountWorkbench("/workbench/channel-inventory");
    await waitFor(() => expect(mounted?.container.textContent).toContain("SHARED-TEST-502"));
    await act(async () => dispatchBusinessRestore());
    await waitFor(() => expect(checks).toBe(2));
    await waitFor(() => expect(mounted?.container.textContent).not.toContain("SHARED-TEST-502"));
    if (change === "read") {
      expect(mounted.container.textContent).toContain("无渠道库存查看权限");
      expect(reads).toBe(1);
    } else {
      await waitFor(() => expect(reads).toBe(2));
      expect(mounted.container.textContent).toContain("正在加载渠道库存");
      await act(async () => pending.resolve(trpcResult({ items: [], total: 0, page: 1, pageSize: 20, pageCount: 1, canWrite: false, canFilterSource: false })));
      await waitFor(() => expect(mounted?.container.textContent).toContain("暂无符合筛选条件的渠道库存"));
    }
    expect(mounted.container.querySelector('[role="dialog"]')).toBeNull();
    expect(mounted.container.textContent).not.toContain("SHARED-TEST-502");
  });

  it.each([undefined, { read: true, write: true, note: true }, { read: "true", write: true, note: true, authorizationVersion: "native-v1" }])("v13 fails closed for an absent or malformed native proof %j", async proof => {
    const network = installNetwork(call => call.pathname === "/api/business-trpc/context"
      ? trpcResult({ ...legacyChannelInventoryContext, officialInventoryPermissions: proof })
      : legacyChannelInventoryResponse(call));
    mounted = await mountWorkbench("/workbench/channel-inventory");
    await waitFor(() => expect(mounted?.container.textContent).toContain("无渠道库存查看权限"));
    expect(network.calls.some(call => call.pathname.includes("channelInventory."))).toBe(false);
  });

  it("does not reverify during ordinary focus, visible browsing or same-identity auth refresh after the old 30-second lease", async () => {
    const network = installNetwork(call => call.pathname === "/api/business-trpc/context"
      ? trpcResult({
          ...verifiedContext,
          merchant: { id: 30061, canWrite: true },
          writeCapabilities: ["customers.manage"],
        })
      : call.pathname === "/api/business-trpc/customer.context"
        ? trpcResult({
            canManageAll: false,
            actorUserId: 7002,
            members: [{ userId: 7002, name: "虚构员工" }],
          })
      : successfulWorkbenchResponse(call));
    mounted = await mountWorkbench();
    await waitFor(() => expect(mounted?.container.textContent).toContain("暂无匹配客户"));
    const toggle = Array.from(mounted.container.querySelectorAll<HTMLButtonElement>("button"))
      .find(node => node.textContent?.trim() === "录入客户");
    await act(async () => toggle!.click());
    const input = mounted.container.querySelector<HTMLInputElement>('[data-customer-field="name"]')!;
    expect(input).toBeTruthy();
    await waitFor(() => expect(input.disabled).toBe(false));
    const scope = businessStorageScope();
    const scroll = input.closest("section")!;
    scroll.scrollTop = 123;
    const invalidated = vi.fn();
    window.addEventListener(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT, invalidated);
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
      window.dispatchEvent(new window.Event("focus"));
      window.dispatchEvent(new window.Event("focus"));
      window.dispatchEvent(new window.Event("pageshow"));
      input.focus();
    });
    vi.useRealTimers();
    await mounted.refreshAuth();
    await mounted.navigate("/workbench/customers?merchantId=30061");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "过旧时限仍可编辑的虚构客户");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
      input.dispatchEvent(new window.Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    expect(mounted.container.querySelector('[data-customer-field="name"]')).toBe(input);
    expect(input.disabled).toBe(false);
    expect(input.value).toBe("过旧时限仍可编辑的虚构客户");
    expect(scroll.scrollTop).toBe(123);
    expect(businessStorageScope()).toBe(scope);
    expect(mounted.container.querySelector("[data-business-loading]")).toBeNull();
    expect(mounted.container.querySelector('[data-business-context-verification="revalidating"]')).toBeNull();
    expect(mounted.container.textContent).not.toContain("正在后台核验业务主体绑定");
    expect(invalidated).not.toHaveBeenCalled();
    for (const procedure of ["merchants", "context"])
      expect(network.calls.filter(call => call.pathname === `/api/business-trpc/${procedure}`)).toHaveLength(1);
    window.removeEventListener(CUSTOMER_ENTRY_DRAFTS_INVALIDATED_EVENT, invalidated);
  });

  it("coalesces rapid BFCache restores and retains proof on ordinary route re-entry", async () => {
    const network = installNetwork(successfulWorkbenchResponse);
    mounted = await mountWorkbench();
    await waitFor(() => expect(mounted?.container.textContent).toContain("暂无匹配客户"));
    const fireRestore = async () => act(async () => {
      dispatchBusinessRestore();
      const restore = new window.Event("pageshow");
      Object.defineProperty(restore, "persisted", { value: true });
      window.dispatchEvent(restore);
      dispatchBusinessRestore();
    });
    await fireRestore();
    await waitFor(() => expect(network.calls.filter(call => call.pathname === "/api/business-trpc/context")).toHaveLength(2));
    await mounted.leaveWorkbench();
    await mounted.returnToWorkbench();
    await fireRestore();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    for (const procedure of ["merchants", "context"])
      expect(network.calls.filter(call => call.pathname === `/api/business-trpc/${procedure}`)).toHaveLength(2);
    expect(mounted.container.textContent).toContain("客户列表");
  });
});
