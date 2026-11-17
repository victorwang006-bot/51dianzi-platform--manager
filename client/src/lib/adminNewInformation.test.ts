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
}: {
  account?: string;
  canRead?: boolean;
  ready?: boolean;
  ids?: string[];
  y?: number;
  duplicates?: boolean;
}) {
  latestRows = useAdminNewInformationRows({
    client: api,
    accountKey: account,
    canRead,
    module: "reception",
    scope: "original-team:42",
    refs: ids,
    listReady: ready,
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
    expect(badge('[data-module="customers"]').textContent).toBe("3");
    expect(badge('[data-module="customers"]').getAttribute("title")).toContain("上次成功");
    expect(badge('[data-module="inventory"]').textContent).toBe("7");
    expect(badge('[data-module="inventory"]').getAttribute("title")).not.toContain("上次成功");
    expect(badge('[data-module="sales"]').textContent).toBe("5");
    expect(badge('[data-source="business"]').textContent).toBe("2");
    expect(badge('[data-source="mall"]').textContent).toBe("3");
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
