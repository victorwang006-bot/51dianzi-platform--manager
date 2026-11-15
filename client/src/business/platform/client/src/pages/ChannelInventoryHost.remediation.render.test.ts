// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelReferenceLookupResult, ChannelReferenceQuote, ChannelReferenceSource, ChannelReferenceStatus } from "@shared/channelReference";
import { channelInventoryColumnsStorageKey } from "./channelInventoryColumns";
vi.mock("wouter", async importOriginal => ({
  ...await importOriginal<typeof import("wouter")>(),
  ...(await import("./ChannelInventoryHost.router-test-helper")).hostWouterHooks,
}));
const runtime = vi.hoisted(() => {
  const invalidate = vi.fn().mockResolvedValue(undefined);
  return {
    scope: { merchantId: 55, storageScope: "scope-7-31", frontUser: { id: 7, role: "user" }, staffPrincipal: { frontendUserId: 7, enterpriseId: 31 },
      officialInventoryPermissions: { read: true, write: false, note: false, publish: false, authorizationVersion: "native-v1" },
      contextVerification: { state: "verified", identity: "scope-7-31", authorizationVersion: "auth-v1", readVersion: "read-v1" }, onAuthorizationError: vi.fn() },
    enterprise: { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: [], isOwner: false },
    loading: false, fetching: false, error: false, enterpriseLoading: false, enterpriseError: false, placeholder: false, wrongPage: false, rowCount: 1,
    lookup: vi.fn(), createClient: vi.fn(), mutation: vi.fn(), refetch: vi.fn().mockResolvedValue(undefined), inputs: [] as Record<string, unknown>[], invalidate,
    utils: { client: { channelInventory: {} }, channelInventory: Object.fromEntries(["listTeamMaterials", "listTeamSourceOptions", "listChannels", "notesList", "collaborationNotesList"].map(name => [name, { invalidate: () => invalidate(name) }])) },
  };
});
vi.mock("../../../../BusinessScope", () => ({ useBusinessScope: () => runtime.scope }));
vi.mock("../../../../api/business-trpc", () => ({
  createBusinessScopeTrpcClient: (merchantId: number, options: unknown) => { runtime.createClient(merchantId, options); return { channelReference: { lookup: { query: runtime.lookup } } }; },
  trpc: {
    useUtils: () => runtime.utils,
    enterprise: { me: { useQuery: () => ({ data: runtime.enterprise, isLoading: runtime.enterpriseLoading, isError: runtime.enterpriseError, error: new Error("原企业真实权限错误") }) } },
    channelInventory: {
      listChannels: { useQuery: () => ({ data: { items: [], total: 0, pageCount: 1 }, isLoading: false, isError: false }) },
      listTeamMaterials: { useQuery: (input: Record<string, unknown>) => {
        runtime.inputs.push(input); const page = Number(input.page);
        const items = Array.from({ length: runtime.rowCount }, (_, index) => ({ id: (page - 1) * 20 + index + 1, revision: 1,
          partNumber: input.partNumber ? String(input.partNumber) : `PART-${page}-${index + 1}`, brand: "TI", qty: 9, price: "1.234567890123", taxIncluded: false, leadTime: "现货", updatedAt: "2026-11-10 12:34:56",
          canEdit: false, readOnly: true, canViewSource: false, isMine: false, noteCount: 0, industryCode: null }));
        return { data: { items, total: 40, page: runtime.wrongPage ? 99 : page, pageSize: 20, pageCount: 2, canWrite: false, canFilterSource: false }, isLoading: runtime.loading, isFetching: runtime.fetching,
          isError: runtime.error, isPlaceholderData: runtime.placeholder, error: new Error("原库存真实权限错误"), refetch: runtime.refetch };
      } },
      ...Object.fromEntries(["createChannel", "updateChannel", "setChannelActive", "createMaterial", "updateTeamMaterial"].map(name => [name, { useMutation: () => ({ mutateAsync: runtime.mutation }) }])),
    },
  },
}));
import ChannelInventoryHost from "./ChannelInventoryHost";
import { ChannelReferenceCell } from "./ChannelReferenceCell";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("Missing reference fixture element"); return value; }
function button(name: string) { return required([...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === name)); }
async function render() { await act(async () => root.render(React.createElement(ChannelInventoryHost))); }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
function quote(source: ChannelReferenceSource, status: ChannelReferenceStatus = "ok"): ChannelReferenceQuote {
  return { source, status, matchedPartNumber: "PART", matchedBrand: "TI", productCode: "C123", pageUrl: source === "lcsc" ? "https://item.szlcsc.com/173890.html" : "https://search.ickey.cn/detail/public.html",
    stockQuantity: 5, unitPrice: "0.000000012345", tierQuantity: 5000, tiers: [{ minQuantity: 1, unitPrice: "0.012345678900" }, { minQuantity: 5000, unitPrice: "0.000000012345" }], currency: "CNY", unit: "个", taxStatus: "included", packaging: "卷带", fetchedAt: "2026-11-14T04:00:00Z", expiresAt: "2026-11-14T04:20:00Z", stockInsufficientForTier: true, message: "INTERNAL_DIAGNOSTIC_NOT_UI" };
}
function response(input: { listInput: Record<string, unknown>; materialIds: number[] }, status: ChannelReferenceStatus = "ok"): ChannelReferenceLookupResult {
  return { items: input.materialIds.map((id, index) => ({ materialId: id, partNumber: input.listInput.partNumber ? String(input.listInput.partNumber) : `PART-${input.listInput.page}-${index + 1}`, brand: "TI", references: { lcsc: quote("lcsc", status), ickey: quote("ickey", status) } })) };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function referenceCells() { return [...document.querySelectorAll<HTMLElement>("tbody td[data-reference-source]")]; }
function placeholders(count = 2) {
  const cells = referenceCells(); expect(cells).toHaveLength(count);
  for (const cell of cells) { expect(cell.textContent).toBe("暂未匹配"); expect(cell.querySelector("button, a, [role=status], [role=dialog]")).toBeNull(); }
  expect(document.querySelector(".ci-reference-spinner, .ci-reference-popover")).toBeNull();
}
function columnOption(label: string) { return required([...document.querySelectorAll<HTMLLabelElement>(".ci-columns-options label")].find(item => item.querySelector("span")?.firstChild?.textContent === label)?.querySelector("input")); }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, "", "/channel-inventory");
  runtime.scope.merchantId = 55; runtime.scope.frontUser.id = 7; runtime.scope.frontUser.role = "user"; runtime.scope.staffPrincipal = { frontendUserId: 7, enterpriseId: 31 }; runtime.scope.storageScope = "scope-7-31";
  runtime.scope.contextVerification = { state: "verified", identity: "scope-7-31", authorizationVersion: "auth-v1", readVersion: "read-v1" };
  runtime.scope.officialInventoryPermissions = { read: true, write: false, note: false, publish: false, authorizationVersion: "native-v1" };
  runtime.enterprise = { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: [], isOwner: false };
  runtime.loading = false; runtime.fetching = false; runtime.error = false; runtime.enterpriseLoading = false; runtime.enterpriseError = false; runtime.placeholder = false; runtime.wrongPage = false; runtime.rowCount = 1;
  runtime.inputs = []; runtime.lookup.mockReset().mockImplementation(async input => response(input)); runtime.createClient.mockClear(); runtime.mutation.mockClear(); runtime.invalidate.mockClear(); runtime.refetch.mockClear(); runtime.scope.onAuthorizationError.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network or production writes allowed in UI fixtures"); }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled(); expect(runtime.mutation).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("restored approved manual refresh interaction", () => {
  it("clicks true once, rejects synchronous double click, polls false after4s and stays busy between polls", async () => {
    vi.useFakeTimers();
    runtime.lookup.mockImplementation(async input => response(input, "not_found")); await render();
    const pending = deferred<ChannelReferenceLookupResult>(); runtime.lookup.mockImplementationOnce(() => pending.promise).mockImplementation(async input => response(input, "pending"));
    const action = button("重查未匹配");
    await act(async () => { action.dispatchEvent(new MouseEvent("click", { bubbles: true })); action.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(runtime.lookup.mock.calls.map(c => c[0].refresh)).toEqual([false, true]); expect(action.disabled).toBe(true);
    const manualInput = runtime.lookup.mock.calls[1][0]; expect(manualInput).toEqual({ listInput: runtime.inputs.at(-1), materialIds: [1], refresh: true });
    expect(Object.keys(manualInput)).toEqual(["listInput", "materialIds", "refresh"]);
    await act(async () => pending.resolve(response(manualInput, "pending")));
    expect(button("重查未匹配").disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3999); }); expect(runtime.lookup).toHaveBeenCalledTimes(2); expect(button("重查未匹配").disabled).toBe(true);
    runtime.lookup.mockImplementation(async input => response(input, "not_found"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(runtime.lookup.mock.calls.map(c => c[0].refresh)).toEqual([false, true, false]); expect(button("重查未匹配").disabled).toBe(false);
    expect(document.body.textContent).toContain("未确认重查完成"); expect(runtime.invalidate).not.toHaveBeenCalled(); expect(runtime.refetch).not.toHaveBeenCalled();
  });
  it("keeps an existing successful quote while the other source is pending", async () => {
    vi.useFakeTimers(); runtime.lookup.mockImplementation(async input => { const r = response(input); r.items[0].references.ickey.status = "not_found"; return r; }); await render();
    runtime.lookup.mockImplementation(async input => response(input, "pending")); await click(button("重查未匹配"));
    expect(referenceCells()[0].textContent).toBe("0.000000012345，库存5"); expect(referenceCells()[1].textContent).toBe("暂未匹配"); expect(button("重查未匹配").disabled).toBe(true);
  });
  it("loading-only responses keep the manual session busy and poll without another true", async () => {
    vi.useFakeTimers(); await render(); runtime.lookup.mockImplementation(async input => ({ ...response(input), loading: true })); await click(button("重查未匹配"));
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); }); expect(runtime.lookup.mock.calls.map(c => c[0].refresh)).toEqual([false, true, false]); expect(button("重查未匹配").disabled).toBe(true);
  });
  it("ordinary page changes remain read-only, and a manual20-row call uses only current IDs", async () => {
    runtime.rowCount = 20; await render(); await click(button("下一页")); expect(runtime.lookup.mock.calls.map(c => c[0].refresh)).toEqual([false, false]);
    await click(button("重查未匹配")); const input = runtime.lookup.mock.calls.at(-1)?.[0]; expect(input.materialIds).toEqual(Array.from({ length: 20 }, (_, i) => 21 + i)); expect(input.refresh).toBe(true); expect(input.listInput.page).toBe(2);
  });
  it.each([0, 21])("%s unproven/invalid rows never enable manual requests", async count => {
    runtime.rowCount = count; await render(); expect(runtime.lookup).not.toHaveBeenCalled(); expect(button("重查未匹配").disabled).toBe(true); await click(button("重查未匹配")); expect(runtime.lookup).not.toHaveBeenCalled();
  });
  it.each(["loading", "fetching", "placeholder", "wrongPage", "error", "enterpriseLoading", "enterpriseError"] as const)("a %s native page never authorizes the button", async field => {
    runtime[field] = true; await render(); const action = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "重查未匹配"); if (action) { expect(action.disabled).toBe(true); await click(action); } else expect(["enterpriseLoading", "enterpriseError"]).toContain(field); expect(runtime.lookup).not.toHaveBeenCalled();
  });
  it.each(["page", "merchant", "readVersion", "authorizationVersion", "nativeGrantVersion", "columns", "sort", "filter", "URL", "binding"] as const)("%s change cancels an explicit manual request and refuses late data", async field => {
    await render(); const old = deferred<ChannelReferenceLookupResult>(); runtime.lookup.mockImplementationOnce(() => old.promise); await click(button("重查未匹配"));
    const oldInput = runtime.lookup.mock.calls[1][0], oldSignal = runtime.lookup.mock.calls[1][1].signal;
    if (field === "page") await click(button("下一页"));
    if (field === "merchant") { runtime.scope.merchantId = 56; await render(); }
    if (field === "readVersion") { runtime.scope.contextVerification.readVersion = "read-v2"; await render(); }
    if (field === "authorizationVersion") { runtime.scope.contextVerification.authorizationVersion = "auth-v2"; await render(); }
    if (field === "nativeGrantVersion") { runtime.scope.officialInventoryPermissions.authorizationVersion = "native-v2"; await render(); }
    if (field === "columns") { await click(button("显示列")); await click(columnOption("渠道参考一")); }
    if (field === "sort") await click(required(document.querySelector('[aria-label="按可供数量排序"]')));
    if (field === "filter") {
      const input = required(document.querySelector<HTMLInputElement>('[aria-label="筛选库存型号"]'));
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "EXACT-NEW-SUFFIX"); input.dispatchEvent(new Event("input", { bubbles: true })); }); await click(button("搜索"));
    }
    if (field === "URL") await act(async () => { window.history.replaceState({}, "", "/channel-inventory?ciView=flat&tracking=changed"); window.dispatchEvent(new PopStateEvent("popstate")); });
    if (field === "binding") { runtime.scope.storageScope = "scope-8-31"; runtime.scope.contextVerification.identity = "scope-8-31"; runtime.scope.frontUser.id = 8; runtime.scope.staffPrincipal.frontendUserId = 8; runtime.enterprise.currentUserId = 8; await render(); }
    expect(oldSignal.aborted).toBe(true);
    const late = response(oldInput); late.items[0].references.lcsc.tiers[1].unitPrice = "999999999.123";
    await act(async () => old.resolve(late)); expect(document.body.textContent).not.toContain("999999999.123");
    expect(runtime.lookup.mock.calls.slice(2).every(c => c[0].refresh === false)).toBe(true);
  });
  it("revoked read or unmount aborts manual work without late error callbacks", async () => {
    await render(); const old = deferred<ChannelReferenceLookupResult>(); runtime.lookup.mockImplementationOnce(() => old.promise); await click(button("重查未匹配"));
    const signal = runtime.lookup.mock.calls[1][1].signal; runtime.scope.officialInventoryPermissions.read = false; await render(); expect(signal.aborted).toBe(true);
    await act(async () => old.reject(new Error("late revoked"))); expect(runtime.scope.onAuthorizationError).not.toHaveBeenCalled(); expect(document.querySelector(".ci-reference-evidence-button")).toBeNull();
    runtime.scope.officialInventoryPermissions.read = true; await render(); const next = deferred<ChannelReferenceLookupResult>(); runtime.lookup.mockImplementationOnce(() => next.promise); await click(button("重查未匹配"));
    const nextSignal = runtime.lookup.mock.calls.at(-1)?.[1].signal; await act(async () => root.render(null)); expect(nextSignal.aborted).toBe(true); await act(async () => next.reject(new Error("late unmount"))); expect(runtime.scope.onAuthorizationError).not.toHaveBeenCalled();
  });
  it("at90s reports unconfirmed completion, aborts and rejects late success", async () => {
    vi.useFakeTimers(); await render(); const pending = deferred<ChannelReferenceLookupResult>(); runtime.lookup.mockImplementationOnce(() => pending.promise); await click(button("重查未匹配"));
    const input = runtime.lookup.mock.calls[1][0], signal = runtime.lookup.mock.calls[1][1].signal;
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); }); expect(signal.aborted).toBe(true); expect(button("重查未匹配").disabled).toBe(false); expect(document.body.textContent).toContain("未确认重查完成：已达到90秒");
    const late = response(input); late.items[0].references.lcsc.tiers[1].unitPrice = "999999999.123"; await act(async () => pending.resolve(late)); expect(document.body.textContent).not.toContain("999999999.123"); expect(vi.getTimerCount()).toBe(0);
  });
  it("a real request error retains a previous price and does not announce success or server text", async () => {
    await render(); runtime.lookup.mockRejectedValueOnce(new Error("INTERNAL_SECRET_DIAGNOSTIC")); await click(button("重查未匹配"));
    expect(referenceCells()[0].textContent).toBe("0.000000012345，库存5"); expect(document.body.textContent).toContain("未确认重查完成"); expect(document.body.textContent).not.toContain("INTERNAL_SECRET_DIAGNOSTIC");
  });
  it.each(["foreign", "duplicate", "hash"])("a %s diagnostic fails closed and clears existing references", async change => {
    await render(); runtime.lookup.mockImplementationOnce(async input => {
      const r = response(input) as any; const d = { materialId: change === "foreign" ? 999 : 1, source: "lcsc", state: "idle", lastAttemptAt: null, lastAttemptStatus: null, nextAllowedAt: null, referenceVersion: null, sourceSha256: change === "hash" ? "malformed" : null }; r.refreshDiagnostics = change === "duplicate" ? [d, d] : [d]; return r;
    }); await click(button("重查未匹配")); expect(referenceCells().map(c => c.textContent)).toEqual(["暂未匹配", "暂未匹配"]); expect(document.body.textContent).toContain("核验失败"); expect(runtime.scope.onAuthorizationError).toHaveBeenCalledOnce();
  });
  it.each([["disabled", "重查未启用"], ["cooldown", "重查冷却中"], ["blocked", "来源访问受限"], ["queue_full", "重查队列已满"], ["unavailable", "重查服务不可用"]])("shows the real%s reason without a successful refresh claim", async (state, label) => {
    await render(); runtime.lookup.mockImplementationOnce(async input => ({ ...response(input), refreshDiagnostics: [{ materialId: 1, source: "lcsc", state, lastAttemptAt: null, lastAttemptStatus: null, nextAllowedAt: null, referenceVersion: null, sourceSha256: null }] })); await click(button("重查未匹配")); expect(document.body.textContent).toContain(label); expect(document.body.textContent).not.toContain("已读取本次尝试结果");
  });
  it("opens only marketplace title and short links while retaining typed diagnostics offscreen", async () => {
    runtime.lookup.mockImplementation(async input => ({ ...response(input), refreshDiagnostics: [{ materialId: 1, source: "lcsc", state: "completed", lastAttemptAt: "2026-11-15T01:00:00Z", lastAttemptStatus: "ok", nextAllowedAt: "2026-11-15T01:20:00Z", referenceVersion: "reference-v1", sourceSha256: "a".repeat(64) }] })); await render();
    expect(referenceCells()[0].textContent).toBe("0.000000012345，库存5"); expect(referenceCells()[0].querySelector("[title]")).toBeNull();
    await click(required(document.querySelector('[aria-label="查看立创商城参考来源"]')));
    const panel = required(document.querySelector(".ci-reference-evidence-popover"));
    expect(panel.textContent).toBe("立创商城商品页完整型号搜索");
    expect(panel.textContent).not.toMatch(/保存记录|非实时|不修改|自营|合作|海外|采集时间|最近尝试|最早重查|参考版本|SHA256|2026-11|reference-v1/);
    expect(panel.textContent).not.toContain("a".repeat(64)); expect(panel.querySelector(".ci-reference-evidence-hash")).toBeNull();
    expect(panel.textContent).not.toMatch(/5000|≥|数量档|不足此档/);
    const links = [...panel.querySelectorAll<HTMLAnchorElement>("a")]; expect(links).toHaveLength(2);
    expect(links[0].href).toBe("https://item.szlcsc.com/173890.html"); expect(links[0].textContent).toBe("商品页");
    expect(links[0].getAttribute("aria-label")).toBe("立创商城准确匹配商品页（保存报价来源）");
    expect(links[1].textContent).toBe("完整型号搜索"); expect(links[1].getAttribute("aria-label")).toBe("立创商城完整型号公开搜索（非匹配商品）");
    expect(new URL(links[1].href).searchParams.get("k")).toBe("PART-1-1");
    for (const a of links) { expect(a.rel).toContain("noopener"); expect(a.rel).toContain("noreferrer"); expect(a.getAttribute("referrerpolicy")).toBe("no-referrer"); }
  });
  it("negative evidence labels a provider page/search as non-matched, never a quoted product", async () => {
    runtime.lookup.mockImplementation(async input => response(input, "not_found")); await render(); await click(required(document.querySelector('[aria-label="查看云汉芯城参考来源"]')));
    const panel = required(document.querySelector(".ci-reference-evidence-popover"));
    expect(panel.textContent).toBe("云汉芯城来源页完整型号搜索");
    const links = [...panel.querySelectorAll<HTMLAnchorElement>("a")]; expect(links).toHaveLength(2);
    expect(links[0].getAttribute("aria-label")).toBe("云汉芯城来源页面（非已匹配报价）");
    expect(links[1].getAttribute("aria-label")).toBe("云汉芯城完整型号公开搜索（非匹配商品）");
    expect(panel.textContent).not.toContain("准确匹配商品"); expect(referenceCells()[1].querySelector("a")).toBeNull();
  });
});
