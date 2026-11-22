// @vitest-environment jsdom
import * as React from "react";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_NEW_INFORMATION_MODULES,
  type AdminNewInformationSummary,
  type AdminNewInformationInspection,
} from "@shared/adminNewInformation";
import {
  AdminNewInformationProvider,
  AdminNewInformationRowsProvider,
  adminNewInformationKeys,
  adminNewInformationRefKey,
  normalizeAdminNewInformationRefs,
  createAdminNewInformationHooks,
  useAdminNewInformationContext,
  useAdminNewInformationContextRows,
  useAdminNewInformationContextUnreadRefs,
  customerIdsFromAdminUnreadRefs,
  useAdminNewInformationRows,
  useAdminNewInformationSummary,
  isAdminNewInformationRowVisible,
  type AdminNewInformationClient,
  type AdminNewInformationRowsResult,
} from "./adminNewInformation";
import {
  AdminNewInformationBadge,
  AdminNewInformationRowBadge,
  formatAdminNewInformationCount,
} from "../components/admin/AdminNewInformationBadge";
import { AdminNewInformationMenuBadge } from "../components/admin/AdminNewInformationMenuBadge";
import { AdminNewInformationStatus } from "../components/admin/AdminNewInformationStatus";

function summary(count = 3, available = true): AdminNewInformationSummary {
  return {
    modules: Object.fromEntries(
      ADMIN_NEW_INFORMATION_MODULES.map(module => [
        module,
        { count, available },
      ])
    ) as AdminNewInformationSummary["modules"],
  };
}
function inspection(
  id = "source:1",
  receipt = "server.signed.receipt.1",
  version = "created:1"
): AdminNewInformationInspection {
  return { items: [{ id, version, isNew: true, receipt }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
class MockObserver {
  static instances: MockObserver[] = [];
  targets = new Set<Element>();
  constructor(public callback: IntersectionObserverCallback) {
    MockObserver.instances.push(this);
  }
  observe(element: Element) {
    this.targets.add(element);
  }
  unobserve(element: Element) {
    this.targets.delete(element);
  }
  disconnect() {
    this.targets.clear();
  }
  fire(visible = true) {
    this.callback(
      Array.from(this.targets).map(target => ({
        target,
        isIntersecting: visible,
        intersectionRatio: visible ? 1 : 0,
      })) as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver
    );
  }
}
class MockChannel {
  static instances: MockChannel[] = [];
  closed = false;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  constructor(public name: string) {
    MockChannel.instances.push(this);
  }
  postMessage(data: unknown) {
    MockChannel.instances
      .filter(
        other => other !== this && !other.closed && other.name === this.name
      )
      .forEach(other => other.onmessage?.({ data } as MessageEvent<unknown>));
  }
  close() {
    this.closed = true;
  }
}
let host: HTMLDivElement, root: Root, queryClient: QueryClient;
let api: AdminNewInformationClient;
let visibility: "visible" | "hidden";
let latestRows: AdminNewInformationRowsResult;
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 16)
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id)
  );
  vi.stubGlobal("IntersectionObserver", MockObserver);
  vi.stubGlobal("BroadcastChannel", MockChannel);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("OFFLINE_TEST_NO_NETWORK");
    })
  );
  MockObserver.instances = [];
  MockChannel.instances = [];
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top = Number(this.dataset.y ?? 20);
      return {
        x: 20,
        y: top,
        left: 20,
        top,
        width: 300,
        height: 24,
        right: 320,
        bottom: top + 24,
        toJSON() {},
      } as DOMRect;
    }
  );
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
  api = {
    summary: vi.fn(async () => summary()),
    inspect: vi.fn(async () => inspection()),
    markDisplayed: vi.fn(async input => ({ marked: input.receipts.length, accepted: input.receipts.length })),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  focusManager.setFocused(true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  queryClient.clear();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});
async function tick(ms = 40) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function render(node: React.ReactNode) {
  await act(async () =>
    root.render(h(QueryClientProvider, { client: queryClient }, node))
  );
  await tick();
}
async function intersect(visible = true) {
  await act(async () =>
    MockObserver.instances.forEach(observer => observer.fire(visible))
  );
  await tick();
}
async function setHidden(hidden: boolean) {
  await act(async () => {
    visibility = hidden ? "hidden" : "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await tick();
}
function SummaryView({
  account = "admin:1",
  canRead = true,
  moduleRead = true,
}: {
  account?: string | null;
  canRead?: boolean;
  moduleRead?: boolean;
}) {
  const result = useAdminNewInformationSummary({
    client: api,
    accountKey: account,
    canRead,
    moduleCanRead: { customers: moduleRead },
  });
  return h(
    "output",
    {
      "data-status": result.status,
      "data-last-known": String(result.isModuleLastKnown("customers")),
      "data-count": result.count("customers") ?? "unknown",
    },
    h(AdminNewInformationBadge, {
      count: result.count("customers"),
      lastKnown: result.isModuleLastKnown("customers"),
      placement: "inline",
    })
  );
}
function MenuView() {
  return h(AdminNewInformationProvider, {
    client: api, accountKey: "admin:1", canRead: true,
    children: h(React.Fragment, null,
      ...(["customers", "inventory", "sales"] as const).map(module =>
        h("div", { key: module, "data-module": module }, h(AdminNewInformationMenuBadge, { module }))),
      ...(["business", "mall"] as const).map(source =>
        h("div", { key: source, "data-source": source }, h(AdminNewInformationMenuBadge, { module: "sales", source })))),
  });
}
async function refetchSummary(value: AdminNewInformationSummary) {
  vi.mocked(api.summary).mockResolvedValue(value);
  await act(async () => { await queryClient.invalidateQueries({ queryKey: adminNewInformationKeys.account("admin:1") }); });
  await tick();
}
function RowsView({
  account = "admin:1",
  canRead = true,
  ready = true,
  ids = ["source:1"],
  y = 20,
  duplicates = false,
  acknowledgeOnVisible = true,
  retainUnreadWhileVisible = true,
  module = "reception",
  scope = "original-team:42",
}: {
  account?: string;
  canRead?: boolean;
  ready?: boolean;
  ids?: string[];
  y?: number;
  duplicates?: boolean;
  acknowledgeOnVisible?: boolean;
  retainUnreadWhileVisible?: boolean;
  module?: "reception" | "customers";
  scope?: string;
}) {
  latestRows = useAdminNewInformationRows({
    client: api,
    accountKey: account,
    canRead,
    module,
    scope,
    refs: ids,
    listReady: ready,
    acknowledgeOnVisible,
    retainUnreadWhileVisible,
  });
  const presentations = duplicates
    ? ["inquiry:list", "inquiry:dedup"]
    : ["inquiry:list"];
  return h(
    "div",
    null,
    ...presentations.map(key => {
      const row = latestRows.getRow(ids[0] ?? "source:1", key);
      return h(
        "div",
        {
          key,
          ref: row.ref,
          "data-row": ids[0],
          "data-y": y,
          "data-mark-error": String(Boolean(row.markError)),
        },
        h("button", { onClick() {}, type: "button" }, "原列表操作"),
        h(AdminNewInformationRowBadge, { isNew: row.isNew })
      );
    })
  );
}

describe("new information badge presentation", () => {
  it("hides 0/unknown and renders 1–99 and 99+, identical 18px count styling and accessible new-information labels", async () => {
    for (const count of [undefined, 0, -1, NaN]) {
      await render(h(AdminNewInformationBadge, { count }));
      expect(host.querySelector("[role=status]")).toBeNull();
    }
    for (const count of [1, 99, 100, 10000]) {
      await render(h(AdminNewInformationBadge, { count, placement: "nav" }));
      const badge = host.querySelector("[role=status]")!;
      expect(badge.textContent).toBe(count >= 100 ? "99+" : String(count));
      expect(badge.className).toContain("h-[18px]");
      expect(badge.className).toContain("bg-[#E5484D]");
      expect(badge.className).toContain("text-[11px]");
      expect(badge.className).toContain("font-semibold");
      expect(badge.className).toContain("ring-2 ring-white");
      expect(badge.getAttribute("aria-label")).toBe(`${count} 条新信息`);
      expect(badge.getAttribute("title")).toBe(`${count} 条新信息`);
    }
    expect(formatAdminNewInformationCount(100)).toBe("99+");
    await render(h(AdminNewInformationRowBadge, { isNew: true }));
    expect(host.textContent).toBe("新");
    expect(host.querySelector("[title]")!.getAttribute("title")).toContain(
      "新信息"
    );
  });
  it("normalizes canonical IDs/scope and never deduplicates by presentation ID", () => {
    expect(normalizeAdminNewInformationRefs(["b", "a", "a"])).toEqual([
      "a",
      "b",
    ]);
    expect(
      adminNewInformationKeys.inspect(
        "user",
        "reception",
        ["b", "a", "a"],
        "team"
      )
    ).toEqual(
      adminNewInformationKeys.inspect("user", "reception", ["a", "b"], "team")
    );
    expect(
      adminNewInformationRefKey("reception", "a", "creation", "team")
    ).not.toBe(
      adminNewInformationRefKey("reception", "a", "creation", "other-team")
    );
  });
});

describe("account-isolated summary", () => {
  it("does not query without readable permission/account and purges old account caches", async () => {
    await render(h(SummaryView, { canRead: false }));
    expect(api.summary).not.toHaveBeenCalled();
    await render(h(SummaryView, { account: null }));
    expect(api.summary).not.toHaveBeenCalled();
    await render(h(SummaryView));
    expect(host.querySelector("output")!.dataset.count).toBe("3");
    await render(h(SummaryView, { canRead: false }));
    expect(host.querySelector("[role=status]")).toBeNull();
    expect(
      queryClient.getQueryData(adminNewInformationKeys.summary("admin:1"))
    ).toBeUndefined();
  });
  it("polls at 15s only while page-visible and refetches on focus", async () => {
    await render(h(SummaryView));
    const initial = vi.mocked(api.summary).mock.calls.length;
    await tick(15000);
    expect(api.summary).toHaveBeenCalledTimes(initial + 1);
    await setHidden(true);
    const hiddenCalls = vi.mocked(api.summary).mock.calls.length;
    await tick(45000);
    expect(api.summary).toHaveBeenCalledTimes(hiddenCalls);
    await setHidden(false);
    expect(vi.mocked(api.summary).mock.calls.length).toBeGreaterThan(
      hiddenCalls
    );
    const beforeFocus = vi.mocked(api.summary).mock.calls.length;
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await tick();
    expect(vi.mocked(api.summary).mock.calls.length).toBeGreaterThan(
      beforeFocus
    );
  });
  it("preserves last-known count on network error, while first error remains unknown not zero", async () => {
    await render(h(SummaryView));
    vi.mocked(api.summary).mockRejectedValue(new Error("offline"));
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: adminNewInformationKeys.account("admin:1"),
      });
    });
    await tick();
    const output = host.querySelector("output")!;
    expect(output.dataset.status).toBe("error");
    expect(output.dataset.lastKnown).toBe("true");
    expect(output.dataset.count).toBe("3");
    expect(host.querySelector("[title]")!.getAttribute("title")).toContain(
      "上次成功"
    );
    await render(h(SummaryView, { account: "admin:2" }));
    expect(host.querySelector("output")!.dataset.count).toBe("unknown");
    expect(host.querySelector("output")!.dataset.status).toBe("error");
  });
  it("hides unavailable modules and FORBIDDEN immediately without a refetch loop", async () => {
    vi.mocked(api.summary).mockResolvedValue(summary(20, false));
    await render(h(SummaryView));
    expect(host.querySelector("[role=status]")).toBeNull();
    vi.mocked(api.summary).mockRejectedValue({ data: { code: "FORBIDDEN" } });
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: adminNewInformationKeys.account("admin:1"),
      });
    });
    await tick();
    const calls = vi.mocked(api.summary).mock.calls.length;
    expect(host.querySelector("output")!.dataset.status).toBe("disabled");
    await tick(45000);
    expect(api.summary).toHaveBeenCalledTimes(calls);
    expect(
      queryClient.getQueryData(adminNewInformationKeys.summary("admin:1"))
    ).toBeUndefined();
  });
  it("ignores late old-account responses and never retains somebody else's cache", async () => {
    const old = deferred<AdminNewInformationSummary>();
    vi.mocked(api.summary)
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(summary(2));
    await render(h(SummaryView));
    await render(h(SummaryView, { account: "admin:2" }));
    await act(async () => old.resolve(summary(99)));
    await tick();
    expect(host.querySelector("output")!.dataset.count).toBe("2");
    expect(
      queryClient.getQueryData(adminNewInformationKeys.summary("admin:1"))
    ).toBeUndefined();
  });
  it("remounted layout clears the former account cache instead of relying on same-hook switching", async () => {
    await render(h(SummaryView));
    await render(null);
    expect(
      queryClient.getQueryData(adminNewInformationKeys.summary("admin:1"))
    ).toBeDefined();
    await render(h(SummaryView, { account: "admin:2" }));
    expect(
      queryClient.getQueryData(adminNewInformationKeys.summary("admin:1"))
    ).toBeUndefined();
  });
  it("strict mode replay does not permanently revoke access", async () => {
    await render(h(React.StrictMode, null, h(SummaryView)));
    expect(host.querySelector("output")!.dataset.count).toBe("3");
    await tick(15000);
    expect(host.querySelector("output")!.dataset.status).toBe("success");
  });
  it("only a temporary module retains its last successful total/children and gets the menu tooltip, never unknown zero", async () => {
    const good = summary();
    good.modules.sales = { count: 5, available: true, children: { business: 2, mall: 3 } };
    vi.mocked(api.summary).mockResolvedValue(good);
    await render(h(MenuView));
    const failed = summary(7);
    failed.modules.customers = { count: 0, available: false, reason: "temporary", lastKnown: false };
    failed.modules.sales = { count: 0, available: false, reason: "temporary", lastKnown: false, children: { business: 0, mall: 0 } };
    await refetchSummary(failed);
    const badge = (selector: string) => host.querySelector(`${selector} [role=status]`)!;
    expect(badge('[data-module="customers"]').getAttribute("data-known-count")).toBe("3");
    expect(badge('[data-module="customers"]').getAttribute("data-admin-new-information")).toBe("update-status");
    expect(badge('[data-module="customers"]').getAttribute("title")).toContain("上次成功");
    expect(badge('[data-module="inventory"]').textContent).toBe("7");
    expect(badge('[data-module="inventory"]').getAttribute("title")).not.toContain("上次成功");
    expect(badge('[data-module="sales"]').getAttribute("data-known-count")).toBe("5");
    expect(badge('[data-source="business"]').getAttribute("data-known-count")).toBe("2");
    expect(badge('[data-source="mall"]').getAttribute("data-known-count")).toBe("3");
    expect(badge('[data-source="mall"]').getAttribute("title")).toContain("上次成功");
    await refetchSummary(good);
    expect(badge('[data-module="sales"]').getAttribute("title")).not.toContain("上次成功");
    expect(window.localStorage.length).toBe(0);
  });
  it("first temporary without a proved previous number stays unknown; a server-proven previous number is last-known", async () => {
    const failed = summary();
    failed.modules.customers = { count: 0, available: false, reason: "temporary", lastKnown: false };
    vi.mocked(api.summary).mockResolvedValue(failed);
    await render(h(SummaryView));
    expect(host.querySelector("output")!.dataset.count).toBe("unknown");
    expect(host.querySelector("output")!.dataset.lastKnown).toBe("false");
    failed.modules.customers = { count: 4, available: false, reason: "temporary", lastKnown: true };
    await refetchSummary({ ...failed, modules: { ...failed.modules } });
    expect(host.querySelector("output")!.dataset.count).toBe("4");
    expect(host.querySelector("output")!.dataset.lastKnown).toBe("true");
    failed.modules.customers = { count: 0, available: false, reason: "temporary", lastKnown: false };
    await refetchSummary({ ...failed, modules: { ...failed.modules } });
    expect(host.querySelector("output")!.dataset.count).toBe("4");
    expect(host.querySelector("output")!.dataset.lastKnown).toBe("true");
  });
  it.each(["denied", undefined] as const)("denied/legacy reason %s invalidates prior proof, so later temporary cannot resurrect it", async reason => {
    await render(h(SummaryView));
    const failed = summary();
    failed.modules.customers = { count: 9, available: false, lastKnown: true, ...(reason ? { reason } : {}) };
    await refetchSummary(failed);
    expect(host.querySelector("output")!.dataset.count).toBe("unknown");
    failed.modules.customers = { count: 9, available: false, reason: "temporary", lastKnown: true };
    await refetchSummary({ ...failed, modules: { ...failed.modules } });
    expect(host.querySelector("output")!.dataset.count).toBe("unknown");
    await refetchSummary(summary(4));
    expect(host.querySelector("output")!.dataset.count).toBe("4");
    failed.modules.customers.lastKnown = false;
    failed.modules.customers.count = 0;
    await refetchSummary({ ...failed, modules: { ...failed.modules } });
    expect(host.querySelector("output")!.dataset.count).toBe("4");
  });
  it("current module permission false clears proof until a fresh success, even when regranted before a temporary reply", async () => {
    await render(h(SummaryView));
    await render(h(SummaryView, { moduleRead: false }));
    expect(host.querySelector("output")!.dataset.count).toBe("unknown");
    await render(h(SummaryView));
    expect(host.querySelector("output")!.dataset.count).toBe("unknown");
    const failed = summary();
    failed.modules.customers = { count: 9, available: false, reason: "temporary", lastKnown: true };
    await refetchSummary(failed);
    expect(host.querySelector("output")!.dataset.count).toBe("unknown");
    await refetchSummary(summary(4));
    expect(host.querySelector("output")!.dataset.count).toBe("4");
  });
  it("a different account or remounted hook cannot reuse the prior session's successful fallback", async () => {
    await render(h(SummaryView));
    const failed = summary();
    failed.modules.customers = { count: 0, available: false, reason: "temporary", lastKnown: false };
    vi.mocked(api.summary).mockResolvedValue(failed);
    await render(h(SummaryView, { account: "admin:2" }));
    expect(host.querySelector("output")!.dataset.count).toBe("unknown");
    await render(null);
    await render(h(SummaryView));
    expect(host.querySelector("output")!.dataset.count).toBe("unknown");
  });
  it.each([{ data: { httpStatus: 401 } }, { data: { httpStatus: 403 } }, { data: { code: "UNAUTHORIZED" } }])("HTTP/auth denial %j clears successful temporary proof and disables queries", async error => {
    await render(h(SummaryView));
    vi.mocked(api.summary).mockRejectedValue(error);
    await act(async () => { await queryClient.invalidateQueries({ queryKey: adminNewInformationKeys.account("admin:1") }); });
    await tick();
    expect(host.querySelector("output")!.dataset.count).toBe("unknown");
    expect(host.querySelector("output")!.dataset.status).toBe("disabled");
    expect(queryClient.getQueryData(adminNewInformationKeys.summary("admin:1"))).toBeUndefined();
    const calls = vi.mocked(api.summary).mock.calls.length;
    await tick(45000);
    expect(api.summary).toHaveBeenCalledTimes(calls);
  });
  it("whole-request authorization loss cannot revive persisted old counts after local qualification returns", async () => {
    await render(h(SummaryView));
    vi.mocked(api.summary).mockRejectedValue({ data: { httpStatus: 403 } });
    await act(async () => { await queryClient.invalidateQueries({ queryKey: adminNewInformationKeys.account("admin:1") }); });
    await tick();
    await render(h(SummaryView, { canRead: false }));
    const failed = summary();
    failed.modules.customers = { count: 9, available: false, reason: "temporary", lastKnown: true };
    vi.mocked(api.summary).mockResolvedValue(failed);
    await render(h(SummaryView));
    expect(host.querySelector("output")!.dataset.count).toBe("unknown");
    await refetchSummary(summary(4));
    expect(host.querySelector("output")!.dataset.count).toBe("4");
  });
  it("provider has one summary query for header and multiple leaves; context rows need no extra summary", async () => {
    function Leaf() {
      const value = useAdminNewInformationContext();
      return h("i", null, value.summary.count("customers"));
    }
    const hooks = createAdminNewInformationHooks(api);
    expect(hooks.useSummary).toBeTypeOf("function");
    expect(hooks.useRows).toBeTypeOf("function");
    await render(
      h(AdminNewInformationProvider, {
        client: api,
        accountKey: "admin:1",
        canRead: true,
        moduleCanRead: { reception: true },
        children: h(
          React.Fragment,
          null,
          h(Leaf),
          h(Leaf),
          h(AdminNewInformationRowsProvider, {
            module: "reception",
            scope: "original-team:42",
            refs: ["source:1", "source:1"],
            listReady: true,
            children: h(
              "div",
              { "data-y": 20 },
              h(AdminNewInformationRowBadge, {
                module: "reception",
                scope: "original-team:42",
                id: "source:1",
              }),
              h(AdminNewInformationRowBadge, {
                module: "reception",
                scope: "original-team:42",
                id: "source:1",
              })
            ),
          })
        ),
      })
    );
    expect(api.summary).toHaveBeenCalledTimes(1);
    expect(api.inspect).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll("[role=status]")).toHaveLength(2);
    await intersect();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
  });
  it("standalone context rows render/click the real legacy buttons without provider, errors, requests or marks; provided behavior stays unchanged", async () => {
    const clicked = vi.fn();
    function LegacyRows() {
      latestRows = useAdminNewInformationContextRows({
        module: "reception",
        refs: ["source:1"],
        listReady: true,
      });
      const row = latestRows.getRow("source:1");
      return h(
        React.Fragment,
        null,
        h(
          "div",
          {
            ref: row.ref,
            "data-row": "source:1",
            "data-mark-error": String(Boolean(row.markError)),
          },
          h("button", { type: "button", onClick: clicked }, "原页面操作"),
          h(AdminNewInformationRowBadge, { isNew: row.isNew })
        ),
        h(AdminNewInformationRowsProvider, {
          module: "reception",
          refs: ["source:1"],
          listReady: true,
          children: h(
            "button",
            { type: "button", onClick: clicked },
            "原独立列表操作",
            h(AdminNewInformationRowBadge, {
              id: "source:1",
              module: "reception",
            })
          ),
        })
      );
    }
    await render(h(React.StrictMode, null, h(LegacyRows)));
    await intersect();
    await tick(45000);
    await act(async () => {
      host.querySelectorAll("button").forEach(button => button.click());
      latestRows.retryDisplayed();
    });
    await tick();
    expect(clicked).toHaveBeenCalledTimes(2);
    expect(host.querySelectorAll("button")).toHaveLength(2);
    expect(host.querySelector("[role=status]")).toBeNull();
    expect(
      host.querySelector<HTMLElement>("[data-row]")!.dataset.markError
    ).toBe("false");
    expect(latestRows.query.isError).toBe(false);
    expect(latestRows.query.fetchStatus).toBe("idle");
    expect(api.summary).not.toHaveBeenCalled();
    expect(api.inspect).not.toHaveBeenCalled();
    expect(api.markDisplayed).not.toHaveBeenCalled();
    // Do not emulate context with an empty provider. A real readable provider
    // still performs one shared inspect and marks the original visible row.
    await render(
      h(AdminNewInformationProvider, {
        client: api,
        accountKey: "admin:1",
        canRead: true,
        children: h(LegacyRows),
      })
    );
    expect(api.summary).toHaveBeenCalledTimes(1);
    expect(api.inspect).toHaveBeenCalledTimes(1);
    await intersect();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
  });
});

describe("successful list + real visible row receipts only", () => {
  it("never marks before actual IO visibility, marks only server receipt and keeps current-row new marker until leaving", async () => {
    await render(h(RowsView));
    expect(api.markDisplayed).not.toHaveBeenCalled();
    expect(host.textContent).toContain("新");
    vi.mocked(api.inspect).mockResolvedValue({
      items: [{ id: "source:1", version: "created:1", isNew: false }],
    });
    await intersect();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.markDisplayed).mock.calls[0][0]).toEqual({
      receipts: ["server.signed.receipt.1"],
    });
    expect(host.textContent).toContain("原列表操作");
    expect(host.textContent).toContain("新");
    await intersect(false);
    expect(host.querySelector("[role=status]")).toBeNull();
  });
  it("offscreen IO entries cannot mark even if incorrectly claiming intersection", async () => {
    await render(h(RowsView, { y: 2000 }));
    await intersect(true);
    expect(api.markDisplayed).not.toHaveBeenCalled();
    await render(h(RowsView, { y: 20 }));
    await intersect(true);
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
  });
  it("fallback without IO checks viewport rectangles, not all rows immediately", async () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    await render(h(RowsView, { y: 2000 }));
    await tick(1000);
    expect(api.markDisplayed).not.toHaveBeenCalled();
    await render(h(RowsView, { y: 20 }));
    await act(async () => window.dispatchEvent(new Event("scroll")));
    await tick();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
  });
  it("hidden tab does not inspect/mark, even with stale IO callbacks; visible tab resumes", async () => {
    visibility = "hidden";
    await render(h(RowsView));
    expect(api.inspect).not.toHaveBeenCalled();
    await intersect();
    expect(api.markDisplayed).not.toHaveBeenCalled();
    await setHidden(false);
    await intersect();
    expect(api.inspect).toHaveBeenCalled();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
  });
  it("CSS/HTML hidden rows and scroll clipping cannot mark", async () => {
    await render(h(RowsView));
    const row = host.querySelector<HTMLElement>("[data-row]")!;
    row.hidden = true;
    await intersect();
    expect(api.markDisplayed).not.toHaveBeenCalled();
    row.hidden = false;
    row.style.opacity = "0";
    await intersect();
    expect(api.markDisplayed).not.toHaveBeenCalled();
    row.style.opacity = "1";
    row.parentElement!.style.overflow = "hidden";
    row.dataset.y = "300";
    expect(isAdminNewInformationRowVisible(row)).toBe(false);
    await intersect();
    expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it("pending/error list cannot inspect/mark or clear; inspection error retains prior new marker", async () => {
    await render(h(RowsView, { ready: false }));
    expect(api.inspect).not.toHaveBeenCalled();
    await intersect();
    expect(api.markDisplayed).not.toHaveBeenCalled();
    await intersect(false);
    await render(h(RowsView));
    vi.mocked(api.inspect).mockRejectedValue(new Error("inspection failed"));
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: adminNewInformationKeys.account("admin:1"),
      });
    });
    await tick();
    expect(host.textContent).toContain("新");
    await intersect();
    expect(api.markDisplayed).not.toHaveBeenCalled();
    await render(h(RowsView, { ready: false }));
    await intersect();
    expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it("late failed/invalidated inspection or account switch cannot mark a stale receipt", async () => {
    const old = deferred<AdminNewInformationInspection>();
    vi.mocked(api.inspect)
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValue(inspection("source:1", "server.account2.receipt"));
    await render(h(RowsView));
    await intersect();
    await render(h(RowsView, { account: "admin:2" }));
    await act(async () =>
      old.resolve(inspection("source:1", "server.account1.stale"))
    );
    await tick();
    await intersect();
    expect(
      vi
        .mocked(api.markDisplayed)
        .mock.calls.every(
          call => !call[0].receipts.includes("server.account1.stale")
        )
    ).toBe(true);
    expect(
      queryClient.getQueriesData({
        queryKey: adminNewInformationKeys.account("admin:1"),
      })
    ).toEqual([]);
  });
  it("late inspection cancelled by list becoming pending cannot clear visible rows", async () => {
    const pending = deferred<AdminNewInformationInspection>();
    vi.mocked(api.inspect).mockReturnValue(pending.promise);
    await render(h(RowsView));
    await intersect();
    await render(h(RowsView, { ready: false }));
    await act(async () => pending.resolve(inspection()));
    await tick();
    await intersect();
    expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it("hidden page between inspection and presentation cannot clear until shown again", async () => {
    await render(h(RowsView));
    await setHidden(true);
    await intersect();
    expect(api.markDisplayed).not.toHaveBeenCalled();
    await setHidden(false);
    await intersect();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
  });
  it("revoked permission hides old row marker and cancels pending receipt without retry", async () => {
    const mark = deferred<unknown>();
    vi.mocked(api.markDisplayed).mockReturnValue(mark.promise);
    await render(h(RowsView));
    await intersect();
    await render(h(RowsView, { canRead: false }));
    expect(host.querySelector("[role=status]")).toBeNull();
    expect(vi.mocked(api.markDisplayed).mock.calls[0][1]?.signal?.aborted).toBe(
      true
    );
    await act(async () => mark.resolve({ marked: 1, accepted: 1 }));
    await tick(45000);
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
  });
  it("unmounted rows cancel in-flight mark and release the pending lock for a new visit", async () => {
    const mark = deferred<unknown>();
    vi.mocked(api.markDisplayed).mockReturnValue(mark.promise);
    await render(h(RowsView));
    await intersect();
    await render(null);
    expect(vi.mocked(api.markDisplayed).mock.calls[0][1]?.signal?.aborted).toBe(
      true
    );
    vi.mocked(api.markDisplayed).mockResolvedValue({ marked: 1, accepted: 1 });
    await render(h(RowsView));
    await intersect();
    expect(api.markDisplayed).toHaveBeenCalledTimes(2);
    await act(async () => mark.resolve({ marked: 1, accepted: 1 }));
    await tick();
  });
  it("FORBIDDEN mark hides old indicator and never retries with revoked permission", async () => {
    vi.mocked(api.markDisplayed).mockRejectedValue({
      data: { code: "FORBIDDEN" },
    });
    await render(h(RowsView));
    await intersect();
    expect(host.querySelector("[role=status]")).toBeNull();
    await tick(45000);
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
  });
  it("never fabricates a receipt from id/version when server withholds the receipt", async () => {
    vi.mocked(api.inspect).mockResolvedValue({
      items: [{ id: "source:1", version: "created:1", isNew: true }],
    });
    await render(h(RowsView));
    await intersect();
    expect(host.textContent).toContain("新");
    expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it.each([new Error("network refused"), { ok: false }])(
    "rejected mark restores/keeps the row indicator and never loops; explicit retry succeeds: %s",
    async failure => {
      if (failure instanceof Error)
        vi.mocked(api.markDisplayed).mockRejectedValue(failure);
      else vi.mocked(api.markDisplayed).mockResolvedValue(failure);
      await render(h(RowsView));
      await intersect();
      expect(api.markDisplayed).toHaveBeenCalledTimes(1);
      expect(host.textContent).toContain("新");
      expect(
        host.querySelector<HTMLElement>("[data-row]")!.dataset.markError
      ).toBe("true");
      await tick(45000);
      await intersect();
      expect(api.markDisplayed).toHaveBeenCalledTimes(1);
      vi.mocked(api.markDisplayed).mockResolvedValue({ marked: 1, accepted: 1 });
      await act(async () => latestRows.retryDisplayed());
      await tick();
      expect(api.markDisplayed).toHaveBeenCalledTimes(2);
    }
  );
  it("inquiry list/dedup presentations inspect canonical ID once and mark one receipt", async () => {
    await render(
      h(RowsView, { ids: ["source:1", "source:1"], duplicates: true })
    );
    expect(vi.mocked(api.inspect).mock.calls[0][0]).toEqual({
      module: "reception",
      refs: ["source:1"],
      scope: "original-team:42",
    });
    expect(host.querySelectorAll("[role=status]")).toHaveLength(2);
    await intersect();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll("[role=status]")).toHaveLength(2);
  });
  it("deduplicates pending marks across two list hooks sharing the singleton", async () => {
    const mark = deferred<unknown>();
    vi.mocked(api.markDisplayed).mockReturnValue(mark.promise);
    await render(h(React.Fragment, null, h(RowsView), h(RowsView)));
    await intersect();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
    await act(async () => mark.resolve({ marked: 1, accepted: 1 }));
    await tick();
  });
  it.each([
    undefined, null, {}, { ok: true }, { accepted: true }, true, false, [], "ok",
    { marked: 1 }, { accepted: 1 }, { marked: -1, accepted: 1 },
    { marked: 0.5, accepted: 1 }, { marked: NaN, accepted: 1 },
    { marked: Infinity, accepted: 1 }, { marked: Number.MAX_SAFE_INTEGER + 1, accepted: 1 },
    { marked: "1", accepted: 1 }, { marked: 1, accepted: "1" },
    { marked: 1, accepted: true }, { marked: 1, accepted: 1.5 },
    { marked: 1, accepted: Number.MAX_SAFE_INTEGER + 1 }, { marked: 1, accepted: 2 },
  ])("unknown/invalid native mark %j never broadcasts success, writes seen or auto-retries after leaving/reentering", async result => {
    vi.mocked(api.markDisplayed).mockResolvedValue(result);
    await render(h(React.Fragment, null, h(SummaryView), h(RowsView)));
    const invalidation = vi.spyOn(queryClient, "invalidateQueries");
    const broadcast = vi.spyOn(MockChannel.instances[0], "postMessage");
    await intersect();
    expect(host.querySelector<HTMLElement>("[data-row]")!.dataset.markError).toBe("true");
    expect(invalidation).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
    await intersect(false);
    await intersect(true);
    await tick(45000);
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-row] [role=status]")!.textContent).toBe("新");
    expect(host.querySelector("output")!.dataset.count).toBe("3");
  });
  it("full native acceptance is measured against actual deduplicated batch receipts, not row/event count", async () => {
    vi.mocked(api.inspect).mockResolvedValue({ items: ["source:1", "source:2"].map(id => ({
      id, version: "created:1", isNew: true, receipt: "server.same.signed.receipt",
    })) });
    vi.mocked(api.markDisplayed).mockResolvedValue({ marked: 3, accepted: 1 });
    function BothRows() {
      latestRows = useAdminNewInformationRows({ client: api, accountKey: "admin:1", canRead: true,
        module: "reception", refs: ["source:1", "source:2"], listReady: true });
      return h(React.Fragment, null, ...["source:1", "source:2"].map(id => {
        const row = latestRows.getRow(id);
        return h("div", { key: id, ref: row.ref, "data-row": id, "data-mark-error": String(Boolean(row.markError)) },
          h(AdminNewInformationRowBadge, { isNew: row.isNew }));
      }));
    }
    await render(h(BothRows));
    await intersect();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.markDisplayed).mock.calls[0][0]).toEqual({ receipts: ["server.same.signed.receipt"] });
    expect(Array.from(host.querySelectorAll<HTMLElement>("[data-row]")).every(row => row.dataset.markError === "false")).toBe(true);
    await intersect(false);
    expect(host.querySelector("[role=status]")).toBeNull();
  });
  it("never treats partial/missing native acceptance as seen, but permits marked:0 or expanded marked facts after full acceptance", async () => {
    vi.mocked(api.markDisplayed).mockResolvedValue({ marked: 0, accepted: 0 });
    await render(h(RowsView));
    await intersect();
    expect(
      host.querySelector<HTMLElement>("[data-row]")!.dataset.markError
    ).toBe("true");
    await tick(45000);
    await intersect();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
    vi.mocked(api.markDisplayed).mockResolvedValue({ marked: 0 });
    await act(async () => latestRows.retryDisplayed());
    await tick();
    expect(
      host.querySelector<HTMLElement>("[data-row]")!.dataset.markError
    ).toBe("true");
    vi.mocked(api.markDisplayed).mockResolvedValue({ marked: 0, accepted: 1 });
    await act(async () => latestRows.retryDisplayed());
    await tick();
    expect(api.markDisplayed).toHaveBeenCalledTimes(3);
    expect(
      host.querySelector<HTMLElement>("[data-row]")!.dataset.markError
    ).toBe("false");
    // A compound receipt can legitimately write more facts than input row receipts.
    await render(null);
    vi.mocked(api.inspect).mockResolvedValue(
      inspection("source:1", "server.compound.receipt", "compound:current")
    );
    vi.mocked(api.markDisplayed).mockResolvedValue({ marked: 2, accepted: 1 });
    await render(h(RowsView));
    await intersect();
    expect(api.markDisplayed).toHaveBeenCalledTimes(4);
    expect(
      host.querySelector<HTMLElement>("[data-row]")!.dataset.markError
    ).toBe("false");
  });
  it("batches >100 unique refs without truncation and never sends more than 100 per inspect", async () => {
    const refs = Array.from({ length: 205 }, (_, index) => `source:${index}`);
    vi.mocked(api.inspect).mockImplementation(async input => ({
      items: input.refs.map(id => ({
        id,
        version: "created:1",
        isNew: true,
        receipt: `server.${id}`,
      })),
    }));
    await render(h(RowsView, { ids: refs }));
    expect(
      vi.mocked(api.inspect).mock.calls.map(call => call[0].refs.length)
    ).toEqual([100, 100, 5]);
    expect(
      vi
        .mocked(api.inspect)
        .mock.calls.flatMap(call => call[0].refs)
        .sort()
    ).toEqual([...refs].sort());
  });
});

describe("multi-tab invalidation", () => {
  it("privacy-disabled broadcast still allows normal querying and visible marks", async () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new Error("privacy blocked");
        }
      }
    );
    await render(h(React.Fragment, null, h(SummaryView), h(RowsView)));
    await intersect();
    expect(api.summary).toHaveBeenCalled();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
  });
  it("broadcasts only invalidation and ignores another account, without persisted local read state", async () => {
    await render(h(SummaryView));
    const before = vi.mocked(api.summary).mock.calls.length;
    const remote = new MockChannel("51dianzi-admin-new-information-v1");
    await act(async () =>
      remote.postMessage({ type: "displayed", account: "string:admin:2" })
    );
    await tick();
    expect(api.summary).toHaveBeenCalledTimes(before);
    await act(async () =>
      remote.postMessage({ type: "displayed", account: "string:admin:1" })
    );
    await tick();
    expect(api.summary).toHaveBeenCalledTimes(before + 1);
    await setHidden(true);
    const hiddenCalls = vi.mocked(api.summary).mock.calls.length;
    await act(async () =>
      remote.postMessage({ type: "displayed", account: "string:admin:1" })
    );
    await tick();
    expect(api.summary).toHaveBeenCalledTimes(hiddenCalls);
    expect(window.localStorage.length).toBe(0);
    remote.close();
  });
});

let latestUnread: ReturnType<typeof useAdminNewInformationContextUnreadRefs>;
function UnreadView({ scope = "30061", enabled = true, ready = true }: { scope?: string; enabled?: boolean; ready?: boolean }) {
  latestUnread = useAdminNewInformationContextUnreadRefs({ module: "customers", scope, enabled, listReady: ready });
  return h("output", { "data-available": String(latestUnread.available), "data-error": String(Boolean(latestUnread.error)),
    "data-ids": latestUnread.customerIds === undefined ? "unknown" : JSON.stringify(latestUnread.customerIds) });
}
function UnreadProvider({ scope = "30061", account = "admin:1", enabled = true, ready = true }: { scope?: string; account?: string; enabled?: boolean; ready?: boolean }) {
  return h(AdminNewInformationProvider, { client: api, accountKey: account, canRead: true,
    children: h(UnreadView, { scope, enabled, ready }) });
}
describe("customer detail acknowledgement and full-set unread filter", () => {
  it("visible customer list only inspects, including retry/focus/poll; never marks", async () => {
    vi.mocked(api.inspect).mockResolvedValue(inspection("customer:801"));
    await render(h(RowsView, { ids: ["customer:801"], module: "customers", scope: "30061", acknowledgeOnVisible: false, retainUnreadWhileVisible: false }));
    await intersect(); await tick(45000);
    await act(async () => latestRows.retryDisplayed()); await tick();
    expect(api.inspect).toHaveBeenCalled(); expect(api.markDisplayed).not.toHaveBeenCalled();
    expect(host.querySelector("[role=status]")).not.toBeNull();
  });
  it("successful single-customer native receipt removes visible latch immediately and invalidates ALL account queries", async () => {
    vi.mocked(api.inspect).mockResolvedValue(inspection("customer:801"));
    await render(h(RowsView, { ids: ["customer:801"], module: "customers", scope: "30061", retainUnreadWhileVisible: false }));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await intersect();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.markDisplayed).mock.calls[0][0].receipts).toEqual(["server.signed.receipt.1"]);
    expect(host.querySelector("[role=status]")).toBeNull();
    expect(latestRows.getRow("customer:801").markState).toBe("seen");
    expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ["adminNewInformation", "string:admin:1"], predicate: expect.any(Function),
    }));
  });
  it("failed/expired confirmation keeps unread and retries ONLY after fresh inspection, never the old token", async () => {
    vi.mocked(api.inspect).mockResolvedValue(inspection("customer:801", "expired.token"));
    vi.mocked(api.markDisplayed).mockRejectedValueOnce(new Error("expired"));
    await render(h(RowsView, { ids: ["customer:801"], module: "customers", scope: "30061", retainUnreadWhileVisible: false }));
    await intersect(); expect(latestRows.getRow("customer:801").markError).toBeTruthy();
    const fresh = deferred<AdminNewInformationInspection>();
    vi.mocked(api.inspect).mockReturnValueOnce(fresh.promise);
    vi.mocked(api.markDisplayed).mockResolvedValue({ marked: 1, accepted: 1 });
    await act(async () => { void latestRows.retryDisplayed(); }); await tick();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1); expect(host.querySelector("[role=status]")).not.toBeNull();
    await act(async () => fresh.resolve(inspection("customer:801", "fresh.token"))); await tick();
    expect(api.markDisplayed).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.markDisplayed).mock.calls[1][0].receipts).toEqual(["fresh.token"]);
    expect(host.querySelector("[role=status]")).toBeNull();
  });
  it("fresh retry inspection failure preserves old failure and does not submit the stale receipt", async () => {
    vi.mocked(api.inspect).mockResolvedValue(inspection("customer:801"));
    vi.mocked(api.markDisplayed).mockRejectedValue(new Error("network"));
    await render(h(RowsView, { ids: ["customer:801"], module: "customers", retainUnreadWhileVisible: false })); await intersect();
    vi.mocked(api.inspect).mockRejectedValue(new Error("inspect failed"));
    await act(async () => { await latestRows.retryDisplayed(); }); await tick();
    expect(api.markDisplayed).toHaveBeenCalledTimes(1); expect(latestRows.getRow("customer:801").markError).toBeTruthy();
    expect(host.querySelector("[role=status]")).not.toBeNull();
  });
  it("a merchant swap aborts pending detail receipt and never reuses old scope evidence", async () => {
    const pending = deferred<unknown>(); vi.mocked(api.markDisplayed).mockReturnValueOnce(pending.promise);
    vi.mocked(api.inspect).mockResolvedValue(inspection("customer:801"));
    await render(h(RowsView, { ids: ["customer:801"], module: "customers", scope: "30061", retainUnreadWhileVisible: false })); await intersect();
    const signal = vi.mocked(api.markDisplayed).mock.calls[0][1]?.signal;
    await render(h(RowsView, { ids: ["customer:801"], module: "customers", scope: "30062", retainUnreadWhileVisible: false, acknowledgeOnVisible: false }));
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve({ marked: 1, accepted: 1 })); await tick();
    expect(queryClient.getQueriesData({ queryKey: adminNewInformationKeys.rows("admin:1", "customers", "30061") })).toEqual([]);
    expect(latestRows.getRow("customer:801").markState).not.toBe("seen");
  });
  it("does not obtain full unread IDs unless explicitly enabled and authority ready; empty is a proved success", async () => {
    api.unreadRefs = vi.fn(async () => ({ refs: [], available: true }));
    await render(h(UnreadProvider, { enabled: false })); expect(api.unreadRefs).not.toHaveBeenCalled();
    await render(h(UnreadProvider, { ready: false })); expect(api.unreadRefs).not.toHaveBeenCalled();
    await render(h(UnreadProvider));
    expect(api.unreadRefs).toHaveBeenCalledWith({ module: "customers", scope: "30061" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(latestUnread.customerIds).toEqual([]); expect(latestUnread.available).toBe(true);
    expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it("legacy client without optional capability and a query failure remain unknown/errors, never fake empty; explicit retry works", async () => {
    await render(h(UnreadProvider)); expect(latestUnread.error).toBeTruthy(); expect(latestUnread.customerIds).toBeUndefined();
    api.unreadRefs = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue({ refs: ["customer:802", "customer:801"], available: true });
    await render(h(UnreadProvider)); await act(async () => { await latestUnread.retry(); }); await tick();
    expect(latestUnread.error).toBeTruthy(); expect(latestUnread.customerIds).toBeUndefined();
    await act(async () => { await latestUnread.retry(); }); await tick();
    expect(latestUnread.customerIds).toEqual([801, 802]);
  });
  it("scope/account switch rejects a late old response; disabling clears the authorized unread set", async () => {
    const old = deferred<{ refs: string[]; available: true }>();
    api.unreadRefs = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({ refs: ["customer:802"], available: true });
    await render(h(UnreadProvider)); await render(h(UnreadProvider, { scope: "30062", account: "admin:2" }));
    await act(async () => old.resolve({ refs: ["customer:801"], available: true })); await tick();
    expect(latestUnread.customerIds).toEqual([802]);
    expect(queryClient.getQueriesData({ queryKey: adminNewInformationKeys.account("admin:1") })).toEqual([]);
    await render(h(UnreadProvider, { scope: "30062", account: "admin:2", enabled: false }));
    expect(latestUnread.customerIds).toBeUndefined();
    expect(queryClient.getQueryData(adminNewInformationKeys.unreadRefs("admin:2", "customers", "30062"))).toBeUndefined();
  });
  it.each([["customer:0"], ["customer:-1"], ["customer:01"], ["customer:1.5"], ["channel:1"], ["customer:9007199254740992"]])("rejects unsafe/non-customer refs %j", refs => {
    expect(() => customerIdsFromAdminUnreadRefs(refs)).toThrow();
  });
  it("safely deduplicates positive IDs and rejects input over 2000 without truncation", () => {
    expect(customerIdsFromAdminUnreadRefs(["customer:3", "customer:1", "customer:3"])).toEqual([1, 3]);
    expect(() => customerIdsFromAdminUnreadRefs(Array.from({ length: 2001 }, (_, n) => `customer:${n + 1}`))).toThrow("2000");
  });
});

describe("customer bound-admin identity", () => {
  it("a provided expectedAccountKey must match the original admin provider before any inspect/mark", async () => {
    function Bound({ expected }: { expected: string }) {
      latestRows = useAdminNewInformationContextRows({ module: "customers", scope: "30061", refs: ["customer:801"],
        listReady: true, expectedAccountKey: expected, retainUnreadWhileVisible: false });
      const row = latestRows.getRow("customer:801");
      return h("div", { ref: row.ref }, h(AdminNewInformationRowBadge, { isNew: row.isNew }));
    }
    const view = (expected: string) => h(AdminNewInformationProvider, { client: api, accountKey: "admin:1", canRead: true, children: h(Bound, { expected }) });
    vi.mocked(api.inspect).mockResolvedValue(inspection("customer:801"));
    await render(view("admin:2")); await intersect();
    expect(api.inspect).not.toHaveBeenCalled(); expect(api.markDisplayed).not.toHaveBeenCalled();
    await render(view("admin:1")); await intersect();
    expect(api.inspect).toHaveBeenCalled(); expect(api.markDisplayed).toHaveBeenCalledTimes(1);
  });
});

describe("notification verification status is not a red unread count", () => {
  it.each([
    [undefined, "pending", "?"],
    [0, "pending", "↻"],
    [undefined, "failed", "!"],
    [0, "failed", "!"],
    [3, "failed", "3!"],
    [9, "blocked", "⊘"],
  ] as const)("neutral count=%s state=%s preserves uncertainty", async (count, updateState, text) => {
    await render(h(AdminNewInformationBadge, { count, updateState, placement: "nav" }));
    expect(host.querySelector('[data-admin-new-information="count"]')).toBeNull();
    const status = host.querySelector<HTMLElement>('[data-admin-new-information="update-status"]')!;
    expect(status.textContent).toBe(text);
    expect(status.style.background).toBe("rgb(241, 245, 249)");
    expect(status.textContent).not.toContain("…");
    expect(status.textContent).not.toMatch(/^0/);
    if (updateState === "blocked") expect(status.hasAttribute("data-known-count")).toBe(false);
    expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it("shared initial request shows neutral verification status, then verified zero disappears", async () => {
    const first = deferred<AdminNewInformationSummary>();
    vi.mocked(api.summary).mockReturnValue(first.promise);
    await render(h(MenuView));
    expect(host.querySelector('[data-admin-new-information="count"]')).toBeNull();
    expect(host.textContent).toContain("?");
    expect(host.querySelector('[title]')!.getAttribute("title")).toContain("核验中");
    await act(async () => first.resolve(summary(0))); await tick();
    expect(host.querySelector('[data-admin-new-information]')).toBeNull();
    expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it("source denial stays blocked until fresh authorized success and never resurrects old proof", async () => {
    const denied = summary(0);
    denied.modules.customers = { count: 9, available: false, reason: "denied", lastKnown: true };
    vi.mocked(api.summary).mockResolvedValue(denied);
    await render(h(MenuView));
    const customer = () => host.querySelector('[data-module="customers"]')!;
    expect(customer().textContent).toBe("⊘");
    expect(customer().querySelector('[title]')!.getAttribute("title")).toContain("权限");
    expect(customer().querySelector('[data-update-state="blocked"]')).not.toBeNull();
    expect(customer().textContent).not.toContain("9");
    const temporary = summary(0);
    temporary.modules.customers = { count: 9, available: false, reason: "temporary", lastKnown: true };
    await refetchSummary(temporary);
    expect(customer().textContent).toBe("!");
    expect(customer().querySelector('[title]')!.getAttribute("title")).toContain("暂不可用");
    expect(customer().querySelector('[data-known-count]')).toBeNull();
    await refetchSummary(summary(2));
    expect(customer().querySelector('[data-admin-new-information="count"]')!.textContent).toBe("2");
    expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it("a proved zero remains neutral during refetch instead of reappearing as red zero", async () => {
    vi.mocked(api.summary).mockResolvedValue(summary(0));
    await render(h(MenuView));
    const next = deferred<AdminNewInformationSummary>();
    vi.mocked(api.summary).mockReturnValue(next.promise);
    let pending!: Promise<void>;
    await act(async () => { pending = queryClient.invalidateQueries({ queryKey: adminNewInformationKeys.account("admin:1") }); });
    await tick();
    expect(host.querySelector('[data-admin-new-information="count"]')).toBeNull();
    expect(host.textContent).toContain("↻");
    expect(host.querySelector('[title]')!.getAttribute("title")).toContain("待更新");
    expect(host.textContent).not.toContain("0");
    await act(async () => { next.resolve(summary(0)); await pending; }); await tick();
    expect(host.querySelector('[data-admin-new-information]')).toBeNull();
  });
});

let latestSummary: ReturnType<typeof useAdminNewInformationSummary>;
function NotificationProbe() {
  latestSummary = useAdminNewInformationContext().summary;
  return h(AdminNewInformationStatus);
}
function StatusMenuView({ account = "admin:1", moduleRead = true }: { account?: string; moduleRead?: boolean }) {
  return h(AdminNewInformationProvider, { client: api, accountKey: account, canRead: true,
    moduleCanRead: { customers: moduleRead }, children: h(React.Fragment, null,
      h(NotificationProbe), h("div", { "data-module": "customers" }, h(AdminNewInformationMenuBadge, { module: "customers" }))) });
}
const customerBadge = () => host.querySelector<HTMLElement>('[data-module="customers"] [data-admin-new-information]');
const globalStatus = () => host.querySelector<HTMLElement>('[data-admin-new-information-global]')!;
describe("ordinary fetch presentation never changes business acknowledgement semantics", () => {
  it.each([0, 3, 100])("known %s stays stable and explicitly old during the unchanged 15s poll", async count => {
    vi.mocked(api.summary).mockResolvedValue(summary(count));
    await render(h(StatusMenuView));
    const time = latestSummary.moduleLastSuccessfulAt("customers");
    expect(time).toBeTypeOf("number");
    const next = deferred<AdminNewInformationSummary>();
    vi.mocked(api.summary).mockReturnValue(next.promise);
    await tick(15000);
    expect(latestSummary.syncState("customers")).toBe("pending");
    expect(latestSummary.presentationState("customers")).toBe("refreshing");
    expect(latestSummary.count("customers")).toBe(count);
    expect(latestSummary.moduleLastSuccessfulAt("customers")).toBe(time);
    expect(globalStatus().dataset.adminNewInformationGlobal).toBe("refreshing");
    expect(globalStatus().querySelector("summary")!.textContent).toBe("更新中");
    if (count === 0) expect(customerBadge()).toBeNull();
    else {
      expect(customerBadge()!.textContent).toBe(formatAdminNewInformationCount(count));
      expect(customerBadge()!.title).toContain("上次成功核验值，非本次实时数量");
      expect(customerBadge()!.title).toContain("上次成功更新时间");
      expect(customerBadge()!.textContent).not.toContain("待更新");
    }
    await act(async () => next.resolve(summary(count))); await tick();
    expect(latestSummary.syncState("customers")).toBe("synced");
    expect(latestSummary.presentationState("customers")).toBe("synced");
    expect(latestSummary.moduleLastSuccessfulAt("customers")!).toBeGreaterThan(time!);
    expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it("successful focus refresh is ordinary too, but explicit invalidate is truly pending even with a known positive", async () => {
    await render(h(StatusMenuView));
    const next = deferred<AdminNewInformationSummary>();
    vi.mocked(api.summary).mockReturnValue(next.promise);
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); }); await tick();
    expect(latestSummary.presentationState("customers")).toBe("refreshing");
    await act(async () => next.resolve(summary(3))); await tick();
    const invalidated = deferred<AdminNewInformationSummary>();
    vi.mocked(api.summary).mockReturnValue(invalidated.promise);
    await act(async () => { void queryClient.invalidateQueries({ queryKey: adminNewInformationKeys.summary("admin:1") }); }); await tick();
    expect(latestSummary.syncState("customers")).toBe("pending");
    expect(latestSummary.presentationState("customers")).toBe("pending");
    expect(customerBadge()!.textContent).toBe("3↻");
    expect(customerBadge()!.title).toContain("上次成功核验值");
    await act(async () => invalidated.resolve(summary(2))); await tick();
    expect(latestSummary.count("customers")).toBe(2);
    expect(latestSummary.presentationState("customers")).toBe("synced");
  });
  it("initial unknown exposes a compact marker and global explanation, never refreshing or fake zero", async () => {
    const first = deferred<AdminNewInformationSummary>(); vi.mocked(api.summary).mockReturnValue(first.promise);
    await render(h(StatusMenuView));
    expect(latestSummary.presentationState("customers")).toBe("pending");
    expect(latestSummary.count("customers")).toBeUndefined();
    expect(latestSummary.moduleLastSuccessfulAt("customers")).toBeUndefined();
    expect(customerBadge()!.textContent).toBe("?");
    expect(customerBadge()!.dataset.knownCount).toBeUndefined();
    expect(globalStatus().querySelector("summary")!.title).toContain("未知数量不是零");
    await act(async () => first.resolve(summary(0))); await tick();
    expect(customerBadge()).toBeNull();
  });
  it.each([0, 3])("whole request failure preserves known %s neutrally with one clear reachable retry", async count => {
    vi.mocked(api.summary).mockResolvedValue(summary(count)); await render(h(StatusMenuView));
    vi.mocked(api.summary).mockRejectedValue(new Error("offline synthetic")); await tick(15000);
    expect(latestSummary.presentationState("customers")).toBe("failed");
    expect(customerBadge()!.textContent).toBe(count ? "3!" : "!");
    expect(customerBadge()!.dataset.knownCount).toBe(String(count));
    expect(globalStatus().querySelector("summary")!.textContent).toBe("!更新失败");
    expect(host.querySelectorAll('button[aria-label="只读重试新信息核验"]')).toHaveLength(1);
    const retry = deferred<AdminNewInformationSummary>(); vi.mocked(api.summary).mockReturnValue(retry.promise);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="只读重试新信息核验"]')!.click()); await tick();
    expect(latestSummary.presentationState("customers")).not.toBe("refreshing");
    expect(globalStatus().dataset.adminNewInformationGlobal).toBe("failed");
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="只读重试新信息核验"]')!.disabled).toBe(true);
    await act(async () => retry.resolve(summary(0))); await tick();
    expect(latestSummary.presentationState("customers")).toBe("synced"); expect(customerBadge()).toBeNull();
    expect(api.inspect).not.toHaveBeenCalled(); expect(api.markDisplayed).not.toHaveBeenCalled();
  });
  it("first failure is discoverable without a known count, not a hidden empty summary", async () => {
    vi.mocked(api.summary).mockRejectedValue(new Error("first synthetic failure")); await render(h(StatusMenuView));
    expect(latestSummary.count("customers")).toBeUndefined();
    expect(customerBadge()!.textContent).toBe("!");
    expect(globalStatus().dataset.adminNewInformationGlobal).toBe("failed");
    expect(globalStatus().textContent).toContain("数量未知");
  });
  it("temporary and denied stay module-specific; denied old proof/time cannot return during retry", async () => {
    await render(h(StatusMenuView));
    const mixed = summary(0); mixed.modules.customers = { count: 0, available: false, reason: "temporary", lastKnown: false };
    await refetchSummary(mixed);
    expect(latestSummary.count("customers")).toBe(3); expect(customerBadge()!.textContent).toBe("3!");
    mixed.modules.customers = { count: 99, available: false, reason: "denied", lastKnown: true };
    await refetchSummary({ ...mixed, modules: { ...mixed.modules } });
    expect(latestSummary.count("customers")).toBeUndefined(); expect(latestSummary.moduleLastSuccessfulAt("customers")).toBeUndefined();
    expect(customerBadge()!.textContent).toBe("⊘"); expect(globalStatus().dataset.adminNewInformationGlobal).toBe("blocked");
    const next = deferred<AdminNewInformationSummary>(); vi.mocked(api.summary).mockReturnValue(next.promise); await tick(15000);
    expect(latestSummary.presentationState("customers")).toBe("blocked"); expect(customerBadge()!.textContent).toBe("⊘");
    await act(async () => next.resolve(summary(4))); await tick(); expect(latestSummary.count("customers")).toBe(4);
  });
  it("account switch during ordinary fetch drops old count/time and rejects the late result", async () => {
    await render(h(StatusMenuView));
    const old = deferred<AdminNewInformationSummary>(), current = deferred<AdminNewInformationSummary>();
    vi.mocked(api.summary).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    await tick(15000); expect(latestSummary.presentationState("customers")).toBe("refreshing");
    await render(h(StatusMenuView, { account: "admin:2" }));
    expect(latestSummary.count("customers")).toBeUndefined(); expect(latestSummary.moduleLastSuccessfulAt("customers")).toBeUndefined();
    expect(latestSummary.presentationState("customers")).toBe("pending"); expect(customerBadge()!.textContent).toBe("?");
    await act(async () => old.resolve(summary(99))); await tick(); expect(latestSummary.count("customers")).toBeUndefined();
    await act(async () => current.resolve(summary(2))); await tick(); expect(latestSummary.count("customers")).toBe(2);
  });
  it("permission removal during ordinary fetch removes proof/time, then only fresh success restores them", async () => {
    await render(h(StatusMenuView));
    const next = deferred<AdminNewInformationSummary>(); vi.mocked(api.summary).mockReturnValue(next.promise); await tick(15000);
    await render(h(StatusMenuView, { moduleRead: false }));
    expect(customerBadge()).toBeNull(); expect(latestSummary.count("customers")).toBeUndefined(); expect(latestSummary.moduleLastSuccessfulAt("customers")).toBeUndefined();
    await act(async () => next.resolve(summary(8))); await tick();
    await render(h(StatusMenuView)); expect(latestSummary.count("customers")).toBeUndefined();
    await refetchSummary(summary(4)); expect(latestSummary.count("customers")).toBe(4);
  });
  it("authorization loss concentrates restriction and exposes no useless retry or former proof", async () => {
    await render(h(StatusMenuView)); vi.mocked(api.summary).mockRejectedValue({ data: { httpStatus: 403 } }); await tick(15000);
    expect(latestSummary.status).toBe("disabled"); expect(latestSummary.count("customers")).toBeUndefined();
    expect(customerBadge()).toBeNull(); expect(globalStatus().dataset.adminNewInformationGlobal).toBe("blocked");
    expect(host.querySelector('button[aria-label="只读重试新信息核验"]')).toBeNull();
  });
  it("same-page cross-QC fresh acknowledgement cancels ordinary reads and requires EACH new epoch receipt", async () => {
    const secondClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const secondAPI: AdminNewInformationClient = { ...api, summary: vi.fn(async () => summary(5)) };
    let a!: typeof latestSummary, b!: typeof latestSummary;
    function Probe({ side }: { side: "a" | "b" }) {
      const value = useAdminNewInformationContext().summary; if (side === "a") a = value; else b = value;
      return h("div", { "data-module": side }, h(AdminNewInformationMenuBadge, { module: "customers" }));
    }
    const provider = (client: AdminNewInformationClient, side: "a" | "b") => h(AdminNewInformationProvider, { client, accountKey: "admin:1", canRead: true,
      children: h(React.Fragment, null, h(Probe, { side }), side === "a" ? h(RowsView, { module: "customers", scope: "30061", ids: ["customer:801"], retainUnreadWhileVisible: false }) : null) });
    vi.mocked(api.inspect).mockResolvedValue(inspection("customer:801"));
    try {
      await render(h(React.Fragment, null, provider(api, "a"), h(QueryClientProvider, { client: secondClient }, provider(secondAPI, "b"))));
      const oldA = deferred<AdminNewInformationSummary>(), oldB = deferred<AdminNewInformationSummary>();
      const freshA = deferred<AdminNewInformationSummary>(), freshB = deferred<AdminNewInformationSummary>();
      vi.mocked(api.summary).mockReturnValueOnce(oldA.promise).mockReturnValueOnce(freshA.promise);
      vi.mocked(secondAPI.summary).mockReturnValueOnce(oldB.promise).mockReturnValueOnce(freshB.promise);
      await tick(15000); expect(a.presentationState("customers")).toBe("refreshing"); expect(b.presentationState("customers")).toBe("refreshing");
      const signalA = vi.mocked(api.summary).mock.calls.at(-1)![0]!.signal;
      const signalB = vi.mocked(secondAPI.summary).mock.calls.at(-1)![0]!.signal;
      await intersect(); expect(api.markDisplayed).toHaveBeenCalledTimes(1);
      expect(signalA!.aborted).toBe(true); expect(signalB!.aborted).toBe(true);
      expect(a.syncState("customers")).toBe("pending"); expect(b.syncState("customers")).toBe("pending");
      expect(a.presentationState("customers")).toBe("pending"); expect(b.presentationState("customers")).toBe("pending");
      await act(async () => { oldA.resolve(summary(99)); oldB.resolve(summary(99)); }); await tick();
      expect(a.count("customers")).toBe(3); expect(b.count("customers")).toBe(5);
      expect(a.presentationState("customers")).toBe("pending"); expect(b.presentationState("customers")).toBe("pending");
      await act(async () => freshA.resolve(summary(2))); await tick();
      expect(a.syncState("customers")).toBe("synced"); expect(b.syncState("customers")).toBe("pending");
      await act(async () => freshB.resolve(summary(4))); await tick();
      expect(b.syncState("customers")).toBe("synced"); expect(a.count("customers")).toBe(2); expect(b.count("customers")).toBe(4);
      expect(queryClient).not.toBe(secondClient); expect(api.markDisplayed).toHaveBeenCalledTimes(1);
    } finally { await render(null); secondClient.clear(); }
  });
});

describe("refresh metadata does not manufacture historical or fresh proof", () => {
  it("a replacement server lastKnown count keeps its provenance but cannot borrow the previous count timestamp", async () => {
    await render(h(StatusMenuView));
    expect(latestSummary.moduleLastSuccessfulAt("customers")).toBeTypeOf("number");
    const temporary = summary(0); temporary.modules.customers = { count: 7, available: false, reason: "temporary", lastKnown: true };
    await refetchSummary(temporary);
    expect(latestSummary.count("customers")).toBe(7);
    expect(latestSummary.isModuleLastKnown("customers")).toBe(true);
    expect(latestSummary.moduleLastSuccessfulAt("customers")).toBeUndefined();
    expect(customerBadge()!.title).toContain("上次成功核验值");
    expect(customerBadge()!.title).not.toContain("更新时间");
  });
  it("an accepted cross-tab invalidation while hidden remains genuinely pending until a visible fresh read", async () => {
    await render(h(StatusMenuView)); await setHidden(true);
    const remote = new MockChannel("51dianzi-admin-new-information-v1");
    const calls = vi.mocked(api.summary).mock.calls.length;
    await act(async () => remote.postMessage({ type: "displayed", account: "string:admin:1", module: "customers", scope: "30061" })); await tick();
    expect(api.summary).toHaveBeenCalledTimes(calls);
    expect(latestSummary.syncState("customers")).toBe("pending");
    expect(latestSummary.presentationState("customers")).toBe("pending");
    expect(latestSummary.count("customers")).toBe(3);
    await act(async () => { await latestSummary.retrySummary(); });
    expect(api.summary).toHaveBeenCalledTimes(calls);
    const fresh = deferred<AdminNewInformationSummary>(); vi.mocked(api.summary).mockReturnValue(fresh.promise);
    await setHidden(false); expect(latestSummary.presentationState("customers")).toBe("pending");
    await act(async () => fresh.resolve(summary(2))); await tick();
    expect(latestSummary.syncState("customers")).toBe("synced"); expect(latestSummary.count("customers")).toBe(2);
    remote.close(); expect(api.markDisplayed).not.toHaveBeenCalled();
  });
});
