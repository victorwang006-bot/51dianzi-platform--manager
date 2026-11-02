import { createRequire } from "node:module";
import { act, createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BusinessWorkbenchPage from "./BusinessWorkbenchPage";
import { businessStorageScope } from "./BusinessScope";
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
  unmount(): Promise<void>;
};

function trpcResult(value: unknown): Response {
  return new Response(JSON.stringify([{ result: { data: { json: value } } }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
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

async function mountWorkbench(): Promise<MountedWorkbench> {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    {
      url: "http://workbench.test/workbench/customers",
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

  it("fails closed immediately on focus and a rechecked missing binding cannot retain the prior customer page", async () => {
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
    expect(businessStorageScope()).toBe(
      "business-domain:v1:staff:7002:admin:6001:enterprise:88001:merchant:30061:binding:4"
    );
    const initialDomainCallCount = domainCalls(network.calls).length;

    await act(async () => {
      window.dispatchEvent(new window.Event("focus"));
    });
    await waitFor(() => {
      expect(mounted?.container.textContent).toContain("正在核验业务主体绑定");
      expect(mounted?.container.textContent).not.toContain("客户列表");
    });
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
