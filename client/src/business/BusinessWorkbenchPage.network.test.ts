import { createRequire } from "node:module";
import { act, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BusinessWorkbenchPage from "./BusinessWorkbenchPage";
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
    user: {
      ...verifiedContext.staffPrincipal.user,
      id: 397751,
      openId: "front-staff:397751",
      username: "legacy-channel-owner",
    },
  },
  workbenchCapabilities: ["inventory.channel"],
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
  leaveWorkbench(): Promise<void>;
  returnToWorkbench(): Promise<void>;
  unmount(): Promise<void>;
};

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

function trpcError(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify([
      {
        error: {
          json: {
            message,
            code: -32003,
            data: { code, httpStatus: status, path: "merchants" },
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

  await act(async () => {
    root.render(
      createElement(BusinessWorkbenchPage, { routeBase: "/workbench" })
    );
  });

  return {
    container,
    async leaveWorkbench() {
      await act(async () => {
        history.pushState({}, "", "/users");
        root.render(createElement("h1", null, "其它后台页面"));
      });
    },
    async returnToWorkbench() {
      await act(async () => {
        history.pushState({}, "", "/workbench/customers");
        root.render(
          createElement(BusinessWorkbenchPage, { routeBase: "/workbench" })
        );
      });
    },
    async unmount() {
      await act(async () => root.unmount());
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

function installNetwork(responder: NetworkResponder) {
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
    return responder(call);
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

function legacyChannelInventoryResponse(call: FetchCall): Response {
  if (call.pathname === "/api/business-trpc/merchants") {
    return trpcResult({
      data: [officialMerchant],
      pageAvailableCount: 1,
      sourceTotal: 1,
    });
  }
  if (call.pathname === "/api/business-trpc/context")
    return trpcResult(legacyChannelInventoryContext);
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
      canWrite: false,
    });
  }
  throw new Error(
    `UNEXPECTED_LEGACY_CHANNEL_NETWORK_STUB_PATH:${call.pathname}`
  );
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
    await mounted?.unmount();
    mounted = undefined;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
        call.pathname.includes("channelInventory.listMaterials")
      )
    ).toBe(true);
    const batch = network.calls.find(
      call =>
        call.pathname ===
        "/api/business-trpc/channelInventory.listMaterials,channelInventory.listChannels"
    );
    expect(batch).toBeTruthy();
    const input = JSON.parse(
      new URL(batch!.url, "http://workbench.test").searchParams.get("input")!
    );
    expect(input["0"].json).toMatchObject({
      expectedEnterpriseId: 1,
      expectedActorUserId: 397751,
      page: 1,
      pageSize: 20,
    });
    expect(input["1"].json).toMatchObject({
      expectedEnterpriseId: 1,
      expectedActorUserId: 397751,
      page: 1,
      pageSize: 100,
    });
    expect(
      network.calls.some(call =>
        call.pathname.includes("channelInventory.listSharedMaterials")
      )
    ).toBe(false);
    expect(
      Array.from(
        mounted.container.querySelectorAll('[role="tab"][aria-selected="true"]')
      ).map(tab => tab.textContent)
    ).toEqual(["渠道库存", "本人库存"]);
    const addMaterial = Array.from(
      mounted.container.querySelectorAll<HTMLButtonElement>("button")
    ).find(button => button.textContent === "+ 新增库存");
    expect(addMaterial?.disabled).toBe(true);
    for (const call of network.calls) {
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

  it("keeps private notes read-only and starts the closed team DTO query only after selecting team sharing", async () => {
    const network = installNetwork(legacyChannelInventoryResponse);
    mounted = await mountWorkbench("/workbench/channel-inventory");
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("PRIVATE-TEST-501")
    );
    const notes = mounted.container.querySelector<HTMLButtonElement>(
      '[aria-label="打开库存 501 的备注"]'
    );
    expect(notes).toBeTruthy();
    await act(async () => notes!.click());
    await waitFor(() =>
      expect(
        mounted?.container.querySelector('[role="dialog"]')?.textContent
      ).toContain("当前库存为只读，不能新增或修改备注。")
    );
    expect(
      mounted.container.querySelector('[role="dialog"] textarea')
    ).toBeNull();
    const notesCall = network.calls.find(call =>
      call.pathname.endsWith("/channelInventory.notesList")
    );
    expect(notesCall?.headers.get("x-business-merchant-id")).toBe("30061");
    const notesInput = JSON.parse(
      new URL(notesCall!.url, "http://workbench.test").searchParams.get(
        "input"
      )!
    );
    expect(notesInput["0"].json).toEqual({
      expectedEnterpriseId: 1,
      expectedActorUserId: 397751,
      materialId: 501,
      page: 1,
      pageSize: 50,
    });
    const close = mounted.container.querySelector<HTMLButtonElement>(
      '[aria-label="关闭本人备注"]'
    );
    await act(async () => close!.click());
    const teamTab = Array.from(
      mounted.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    ).find(tab => tab.textContent === "团队共享（只读）");
    expect(teamTab?.getAttribute("aria-selected")).toBe("false");
    await act(async () => teamTab!.click());
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain("SHARED-TEST-502")
    );
    expect(teamTab?.getAttribute("aria-selected")).toBe("true");
    expect(mounted.container.textContent).toContain("7 条库存");
    expect(mounted.container.textContent).toContain("不共享任何备注");
    expect(mounted.container.textContent).not.toContain("本人私有备注不可共享");
    expect(mounted.container.textContent).not.toContain("本人私有来源");
    expect(
      mounted.container.querySelector('[aria-label="打开库存 502 的备注"]')
    ).toBeNull();
    const sharedCall = network.calls.find(call =>
      call.pathname.endsWith("/channelInventory.listSharedMaterials")
    );
    const sharedInput = JSON.parse(
      new URL(sharedCall!.url, "http://workbench.test").searchParams.get(
        "input"
      )!
    );
    expect(sharedInput["0"].json).toEqual({
      expectedEnterpriseId: 1,
      expectedActorUserId: 397751,
      partNumber: null,
      brand: null,
      page: 1,
      pageSize: 20,
    });
    expect(sharedInput["0"].meta.values).toEqual({
      partNumber: ["undefined"],
      brand: ["undefined"],
    });
    expect(
      network.calls.every(
        call =>
          call.pathname.startsWith("/api/business-trpc/") &&
          call.credentials === "include" &&
          !call.headers.has("cookie") &&
          !call.headers.has("x-admin-id")
      )
    ).toBe(true);
    expect(
      network.calls.some(call =>
        /notesAdd|notesEdit|setMaterialShare|officialChannelInventory/.test(
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
      expect(mounted?.container.textContent).toContain("业务上下文不可用");
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

  it("keeps the same verified customer tree inert during focus revalidation, then closes it when the binding disappears", async () => {
    const focusContext = deferred<Response>();
    const draftInvalidated = vi.fn();
    let contextAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextAttempts += 1;
        if (contextAttempts === 2) return focusContext.promise;
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
      window.dispatchEvent(new window.Event("focus"));
    });
    await waitFor(() => {
      const boundary = mounted?.container.querySelector(
        '[data-business-context-verification="revalidating"]'
      );
      expect(boundary?.textContent).toContain(
        "正在重新核验业务主体绑定；已暂停编辑和提交。"
      );
      expect(boundary?.querySelector("[inert]")).not.toBeNull();
      expect(boundary?.textContent).toContain("客户列表");
      expect(
        Array.from(mounted?.container.querySelectorAll("h1") ?? []).find(
          title => title.textContent === "客户列表"
        )
      ).toBe(initialCustomerTitle);
    });
    expect(draftInvalidated).not.toHaveBeenCalled();
    focusContext.resolve(
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

  it("fails closed after a focus recheck error even though React Query still retains the old successful context data", async () => {
    const focusContext = deferred<Response>();
    let contextAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextAttempts += 1;
        if (contextAttempts === 2) return focusContext.promise;
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
      window.dispatchEvent(new window.Event("focus"));
    });
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain(
        "正在重新核验业务主体绑定；已暂停编辑和提交。"
      )
    );
    focusContext.reject(
      new TypeError("focus-context-revalidation-unavailable")
    );
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain("业务上下文不可用");
      expect(mounted?.container.textContent).toContain(
        "focus-context-revalidation-unavailable"
      );
    });
    expect(mounted?.container.textContent).not.toContain("客户列表");
    expect(domainCalls(network.calls)).toHaveLength(initialDomainCallCount);
    expect(businessStorageScope()).toBeNull();
  });

  it("restores the same verified identity after focus without remounting its customer tree or invalidating drafts", async () => {
    const focusContext = deferred<Response>();
    const draftInvalidated = vi.fn();
    let contextAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextAttempts += 1;
        if (contextAttempts === 2) return focusContext.promise;
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
      window.dispatchEvent(new window.Event("focus"));
    });
    await waitFor(() =>
      expect(
        mounted?.container.querySelector(
          '[data-business-context-verification="revalidating"]'
        )
      ).not.toBeNull()
    );
    focusContext.resolve(trpcResult(verifiedContext));

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
    installNetwork(call => {
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
    await mounted.leaveWorkbench();
    expect(mounted.container.textContent).toContain("其它后台页面");
    expect(invalidated).not.toHaveBeenCalled();
    await mounted.returnToWorkbench();
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

  it("uses a new domain cache and storage namespace when a focus recheck returns a new bindingVersion", async () => {
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
      window.dispatchEvent(new window.Event("focus"));
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

  it("invalidates customer-entry drafts and remounts the branch when a successful focus recheck revokes customer write scope without changing identity", async () => {
    const focusContext = deferred<Response>();
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
        if (contextAttempts === 2) return focusContext.promise;
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
      window.dispatchEvent(new window.Event("focus"));
    });
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain(
        "正在重新核验业务主体绑定；已暂停编辑和提交。"
      )
    );
    expect(draftInvalidated).not.toHaveBeenCalled();
    focusContext.resolve(
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

  it("rebuilds the verified workbench branch when a same-identity focus check changes another BFF workbench capability", async () => {
    const focusContext = deferred<Response>();
    const draftInvalidated = vi.fn();
    let contextAttempts = 0;
    const network = installNetwork(call => {
      if (call.pathname === "/api/business-trpc/context") {
        contextAttempts += 1;
        if (contextAttempts === 2) return focusContext.promise;
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
      window.dispatchEvent(new window.Event("focus"));
    });
    await waitFor(() =>
      expect(mounted?.container.textContent).toContain(
        "正在重新核验业务主体绑定；已暂停编辑和提交。"
      )
    );
    focusContext.resolve(
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
});
