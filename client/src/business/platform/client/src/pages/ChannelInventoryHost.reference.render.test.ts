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
const sourceLabels = { lcsc: "立创商城", ickey: "云汉芯城" } as const;
function readonlySourceOpener(cell: HTMLElement, source: ChannelReferenceSource) {
  const buttons = cell.querySelectorAll<HTMLButtonElement>("button"); expect(buttons).toHaveLength(1);
  const opener = required(buttons[0]); expect(opener.type).toBe("button"); expect(opener.disabled).toBe(false);
  expect(opener.classList.contains("ci-reference-evidence-button")).toBe(true);
  expect(opener.getAttribute("aria-label")).toBe(`查看${sourceLabels[source]}参考来源`);
  expect(opener.getAttribute("aria-expanded")).toBe("false"); expect(opener.textContent).toBe("");
  expect(opener.querySelectorAll("svg")).toHaveLength(1); expect(opener.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  const compact = required(cell.querySelector<HTMLElement>(`span[data-source="${source}"]`));
  expect(compact.style.whiteSpace).toBe("nowrap"); expect(compact.style.display).not.toBe("block");
  expect(compact.parentElement?.classList.contains("ci-reference-cell")).toBe(true);
  expect(compact.nextElementSibling).toBe(opener); expect(compact.parentElement?.querySelector("div")).toBeNull();
  expect(cell.querySelector("a, input, select, textarea, form, [title], [role=tooltip], [role=status], [role=dialog]")).toBeNull();
  expect(document.querySelector(".ci-reference-evidence-popover, .ci-reference-popover, .ci-reference-spinner")).toBeNull();
  return opener;
}
async function inspectReadonlySource(cell: HTMLElement, source: ChannelReferenceSource, status: ChannelReferenceStatus, pageUrl = quote(source).pageUrl, partNumber: string | null = "PART-1-1") {
  const opener = readonlySourceOpener(cell, source), compactText = cell.textContent;
  const calls = [runtime.lookup.mock.calls.length, runtime.mutation.mock.calls.length, runtime.invalidate.mock.calls.length, runtime.refetch.mock.calls.length];
  await act(async () => { opener.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
  expect(document.querySelector(".ci-reference-evidence-popover, [role=tooltip]")).toBeNull();
  await click(opener);
  const panels = document.querySelectorAll<HTMLElement>(".ci-reference-evidence-popover"); expect(panels).toHaveLength(1);
  const panel = required(panels[0]); expect(panel.getAttribute("aria-label")).toBe(`${sourceLabels[source]}参考来源`);
  expect(panel.querySelector("strong")?.textContent).toBe(sourceLabels[source]);
  expect(panel.textContent).not.toMatch(/保存记录|非实时|不修改|自营|合作|海外|采集时间|北京时间|2026-11-14|最近尝试|最早重查|参考版本|SHA256/);
  expect(panel.textContent).not.toMatch(/5000|39000|≥|数量档|不足此档|INTERNAL_DIAGNOSTIC_NOT_UI/);
  if (partNumber) expect(panel.textContent).not.toContain(partNumber);
  expect(panel.querySelector("button, input, select, textarea, form, [title], [role=tooltip]")).toBeNull();
  const links = [...panel.querySelectorAll<HTMLAnchorElement>("a")];
  const expectedLinks = [...(pageUrl ? [{ href: pageUrl, text: status === "ok" ? "商品页" : "来源页", label: `${sourceLabels[source]}${status === "ok" ? "准确匹配商品页（保存报价来源）" : "来源页面（非已匹配报价）"}` }] : [])];
  if (partNumber) {
    const search = new URL(source === "lcsc" ? "https://so.szlcsc.com/global.html" : "https://search.ickey.cn/");
    search.searchParams.set(source === "lcsc" ? "k" : "keyword", partNumber);
    expectedLinks.push({ href: search.href, text: "完整型号搜索", label: `${sourceLabels[source]}完整型号公开搜索（非匹配商品）` });
  }
  expect(links.map(link => ({ href: link.href, text: link.textContent, label: link.getAttribute("aria-label") }))).toEqual(expectedLinks);
  expect([...panel.children].map(element => element.tagName)).toEqual(["STRONG", ...expectedLinks.map(() => "P")]);
  expect(panel.textContent).toBe(sourceLabels[source] + expectedLinks.map(link => link.text).join(""));
  for (const link of links) { expect(link.target).toBe("_blank"); expect(link.rel).toBe("noopener noreferrer"); expect(link.getAttribute("referrerpolicy")).toBe("no-referrer"); }
  expect(cell.textContent).toBe(compactText); expect(cell.querySelector("a")).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  expect([runtime.lookup.mock.calls.length, runtime.mutation.mock.calls.length, runtime.invalidate.mock.calls.length, runtime.refetch.mock.calls.length]).toEqual(calls);
  await click(opener); readonlySourceOpener(cell, source);
}
function placeholders(count = 2, acceptedSource = false) {
  const cells = referenceCells(); expect(cells).toHaveLength(count);
  for (const cell of cells) {
    expect(cell.textContent).toBe("暂未匹配");
    if (acceptedSource) readonlySourceOpener(cell, cell.dataset.referenceSource as ChannelReferenceSource);
    else expect(cell.querySelector("button, a, [title], [role=tooltip], [role=status], [role=dialog]")).toBeNull();
  }
  expect(document.querySelector(".ci-reference-spinner, .ci-reference-popover, .ci-reference-evidence-popover")).toBeNull();
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
describe("BFF-only current authorized page: maximum-quantity price and quantity only", () => {
  it("uses the real merchant, exact native listInput/IDs and two compact maximum-tier quotes", async () => {
    await render(); expect(runtime.createClient).toHaveBeenCalledWith(55, undefined); expect(runtime.lookup).toHaveBeenCalledTimes(1);
    const [input, options] = runtime.lookup.mock.calls[0];
    expect(input).toEqual({ listInput: runtime.inputs.at(-1), materialIds: [1], refresh: false });
    expect(input.listInput).toMatchObject({ expectedEnterpriseId: 31, expectedActorUserId: 7, page: 1, pageSize: 20 });
    expect(options.signal).toBeInstanceOf(AbortSignal); expect(Object.keys(input)).toEqual(["listInput", "materialIds", "refresh"]);
    expect([...document.querySelectorAll("thead th")].map(cell => cell.textContent)).toEqual(["型号", "品牌", "负责人", "可供数量", "报价 CNY", "渠道参考一", "渠道参考二", "交期", "更新时间", "渠道来源", "操作"]);
    expect(referenceCells().map(cell => cell.textContent)).toEqual(["0.000000012345，库存5", "0.000000012345，库存5"]);
    for (const cell of referenceCells()) await inspectReadonlySource(cell, cell.dataset.referenceSource as ChannelReferenceSource, "ok");
    expect(document.body.textContent).not.toContain("INTERNAL_DIAGNOSTIC_NOT_UI"); expect(document.body.textContent).not.toContain("不足此档");
    expect(document.querySelector("td.ci-material-price-col")?.textContent).toBe("¥1.234567890123未税"); expect(document.querySelector("td.ci-material-qty-col")?.textContent).toBe("9");
    expect(runtime.invalidate).not.toHaveBeenCalled();
  });
  it("retains ICKey's 39000 tier and exact price without adding a unit or selecting a buyable/cheaper tier", async () => {
    runtime.lookup.mockImplementation(async input => {
      const result = response(input);
      result.items[0].references.ickey = { ...quote("ickey"), stockQuantity: 5000, unit: null,
        tiers: [{ minQuantity: 1000, unitPrice: "0.3334" }, { minQuantity: 3000, unitPrice: "0.3283" }, { minQuantity: 5000, unitPrice: "0.3206" }, { minQuantity: 39000, unitPrice: "0.3026" }] };
      result.items[0].references.lcsc.tiers[1].unitPrice = "0.099999999999"; return result;
    });
    await render(); expect(referenceCells()[1].textContent).toBe("0.3026，库存5000");
    expect(referenceCells()[0].textContent).toBe("0.099999999999，库存5");
    expect(referenceCells()[1].textContent).not.toContain("5,000"); expect(referenceCells()[1].textContent).not.toContain("/个");
  });
  it.each(["pending", "not_found", "ambiguous", "price_unavailable", "access_restricted", "unavailable"] as const)("%s keeps compact 暂未匹配 and only a readonly saved-source opener even if its payload contains a price", async status => {
    runtime.lookup.mockImplementation(async input => response(input, status)); await render(); placeholders(2, true);
    for (const cell of referenceCells()) await inspectReadonlySource(cell, cell.dataset.referenceSource as ChannelReferenceSource, status);
  });
  it("a successful response without a public price has no stock, link or detail opener", async () => {
    runtime.lookup.mockImplementation(async input => { const result = response(input); for (const row of result.items) for (const value of Object.values(row.references)) { value.unitPrice = null; value.tiers = []; value.tierQuantity = null; } return result; });
    await render(); placeholders();
  });
  it.each(["NaN", "-1", "1e-4", "", "Infinity", "0", "0.000"])("direct malformed price %s is noninteractive", async price => {
    const value = quote("lcsc"); value.tiers = []; value.unitPrice = price;
    await act(async () => root.render(React.createElement(ChannelReferenceCell, { source: "lcsc", quote: value })));
    expect(host.textContent).toBe("暂未匹配"); expect(host.querySelector("button, a")).toBeNull();
  });
  it.each(["lcsc", "ickey"] as const)("%s keeps native keyboard focus, real portalled click/Escape and row-event isolation without hover IO", async source => {
    const rowClick = vi.fn(), rowKey = vi.fn();
    await act(async () => root.render(React.createElement("div", { onClick: rowClick, onKeyDown: rowKey },
      React.createElement(ChannelReferenceCell, { source, quote: quote(source), partNumber: "Full/Part+Suffix" }))));
    const opener = readonlySourceOpener(host, source);
    act(() => opener.focus()); expect(document.activeElement).toBe(opener);
    act(() => opener.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(rowKey).not.toHaveBeenCalled(); expect(document.querySelector(".ci-reference-evidence-popover")).toBeNull();
    await act(async () => opener.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    expect(document.querySelector(".ci-reference-evidence-popover")).toBeNull();
    // jsdom has no native Enter -> click; use the native click to open the actual Radix primitive.
    await click(opener);
    const panel = required(document.querySelector<HTMLElement>(".ci-reference-evidence-popover"));
    expect(panel.getAttribute("role")).toBe("dialog"); expect(host.contains(panel)).toBe(false);
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(opener.getAttribute("aria-controls")).toBe(panel.id);
    const firstLink = required(panel.querySelector<HTMLAnchorElement>("a"));
    // The unchanged Radix FocusScope initially focuses its content container.
    expect(document.activeElement).toBe(panel);
    act(() => firstLink.focus());
    expect(document.activeElement).toBe(firstLink);
    await click(required(panel.querySelector("strong"))); expect(rowClick).not.toHaveBeenCalled();
    act(() => firstLink.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(rowKey).not.toHaveBeenCalled();
    await act(async () => panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(document.querySelector(".ci-reference-evidence-popover")).toBeNull();
    expect(opener.getAttribute("aria-expanded")).toBe("false"); expect(document.activeElement).toBe(opener);
    expect(rowClick).not.toHaveBeenCalled(); expect(rowKey).not.toHaveBeenCalled();
    expect(runtime.lookup).not.toHaveBeenCalled(); expect(runtime.mutation).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["lcsc", "ickey"] as const)("%s labels a saved search/root as source rather than matched product and encodes the complete model", async source => {
    const value = { ...quote(source), pageUrl: source === "lcsc" ? "https://www.szlcsc.com/" : "https://search.ickey.cn/" };
    const fullModel = "  Model/Rev-B+Suffix&品牌  ";
    await act(async () => root.render(React.createElement(ChannelReferenceCell, { source, quote: value, partNumber: fullModel })));
    await click(readonlySourceOpener(host, source));
    const panel = required(document.querySelector(".ci-reference-evidence-popover"));
    expect(panel.textContent).toBe(`${sourceLabels[source]}来源页完整型号搜索`);
    const links = [...panel.querySelectorAll<HTMLAnchorElement>("a")]; expect(links).toHaveLength(2);
    expect(links[0].getAttribute("aria-label")).toBe(`${sourceLabels[source]}来源页面（非已匹配报价）`);
    expect(links[1].getAttribute("aria-label")).toBe(`${sourceLabels[source]}完整型号公开搜索（非匹配商品）`);
    expect(new URL(links[1].href).searchParams.get(source === "lcsc" ? "k" : "keyword")).toBe(fullModel);
    expect(host.querySelector("a")).toBeNull(); expect(runtime.lookup).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("missing matched brand never displays a priced quote", async () => {
    const value = quote("ickey"); value.matchedBrand = null;
    await act(async () => root.render(React.createElement(ChannelReferenceCell, { source: "ickey", quote: value })));
    expect(host.textContent).toBe("暂未匹配"); expect(host.querySelector("button, a")).toBeNull();
  });
  it("does not infer stock 0, a unit or tax when maximum-tier price is available", async () => {
    const value = quote("lcsc"); value.stockQuantity = null; value.unit = null; value.taxStatus = "unknown";
    await act(async () => root.render(React.createElement(ChannelReferenceCell, { source: "lcsc", quote: value })));
    expect(host.textContent).toBe("0.000000012345，库存未披露"); readonlySourceOpener(host, "lcsc");
  });
  it("shows exact FNR/ICKey-like strings using marketplace stock, never native qty or maximum-tier thresholds", async () => {
    runtime.lookup.mockImplementation(async input => {
      const result = response(input);
      result.items[0].references.lcsc = { ...quote("lcsc"), stockQuantity: 0, tiers: [{ minQuantity: 5000, unitPrice: "1.0901" }] };
      result.items[0].references.ickey = { ...quote("ickey"), stockQuantity: 1550, tiers: [{ minQuantity: 100, unitPrice: "1.1234" }, { minQuantity: 39000, unitPrice: "1.9642" }] };
      return result;
    });
    await render(); expect(referenceCells().map(cell => cell.textContent)).toEqual(["1.0901，库存0", "1.9642，库存1550"]);
    for (const cell of referenceCells()) {
      readonlySourceOpener(cell, cell.dataset.referenceSource as ChannelReferenceSource);
      expect(cell.innerHTML).not.toMatch(/CNY|≥|39000|5000|\/个/);
      expect(cell.querySelector<HTMLElement>("span[data-source]")?.style.whiteSpace).toBe("nowrap");
    }
    expect(document.querySelector("td.ci-material-qty-col")?.textContent).toBe("9");
  });
  it.each(["loading", "fetching", "placeholder", "wrongPage", "error", "enterpriseLoading", "enterpriseError"] as const)("does not create a reference client while the native proof is %s", async field => {
    runtime[field] = true; await render(); expect(runtime.lookup).not.toHaveBeenCalled(); expect(runtime.createClient).not.toHaveBeenCalled();
    if (field === "error") expect(document.body.textContent).toContain("原库存真实权限错误");
    if (field === "enterpriseError") expect(document.body.textContent).toContain("原企业真实权限错误");
  });
  it.each(["actorMismatch", "enterpriseMismatch", "revalidating", "identityMismatch"] as const)("%s clears success and cancels without a new request", async field => {
    await render(); const signal = runtime.lookup.mock.calls[0][1].signal;
    if (field === "actorMismatch") runtime.scope.staffPrincipal.frontendUserId = 999;
    if (field === "enterpriseMismatch") runtime.scope.staffPrincipal.enterpriseId = 999;
    if (field === "revalidating") runtime.scope.contextVerification.state = "revalidating";
    if (field === "identityMismatch") runtime.scope.contextVerification.identity = "other-scope";
    await render(); expect(signal.aborted).toBe(true); expect(runtime.lookup).toHaveBeenCalledTimes(1); placeholders();
    expect(document.body.textContent).not.toContain("更新参考");
  });
  it("saved hidden columns never start reference IO, including first mount", async () => {
    localStorage.setItem(required(channelInventoryColumnsStorageKey(7, 31)), JSON.stringify(["partNumber", "brand", "qty", "price", "actions"]));
    await render(); expect(runtime.lookup).not.toHaveBeenCalled(); expect(runtime.createClient).not.toHaveBeenCalled(); placeholders(0);
  });
  it("changing columns cancels and clears snapshots; one shown column reads but cannot manually refresh", async () => {
    await render(); const signal = runtime.lookup.mock.calls[0][1].signal;
    await click(button("显示列")); await click(columnOption("渠道参考一"));
    expect(signal.aborted).toBe(true); expect(referenceCells()).toHaveLength(1); expect(document.body.textContent).not.toContain("更新参考");
    await click(columnOption("渠道参考二")); placeholders(0); const count = runtime.lookup.mock.calls.length;
    await render(); expect(runtime.lookup).toHaveBeenCalledTimes(count);
  });
  it.each([0, 21])("%s native rows never start reference IO", async count => {
    runtime.rowCount = count; await render(); expect(runtime.createClient).not.toHaveBeenCalled(); placeholders(count * 2); expect(document.body.textContent).not.toContain("更新参考");
  });
  it("binds all 20 IDs by materialId even when the returned order differs", async () => {
    runtime.rowCount = 20; runtime.lookup.mockImplementation(async input => { const result = response(input); for (const row of result.items) row.references.lcsc.tiers[1].unitPrice = `${row.materialId}.000000000001`; result.items.reverse(); return result; });
    await render(); expect(runtime.lookup.mock.calls[0][0].materialIds).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const cells = referenceCells().filter(cell => cell.dataset.referenceSource === "lcsc");
    expect(cells[0].textContent).toContain("1.000000000001"); expect(cells[19].textContent).toContain("20.000000000001");
  });
  it.each(["materialId", "partNumber", "brand"] as const)("rejects a mismatched response %s without applying any quote", async field => {
    runtime.lookup.mockImplementation(async input => { const result = response(input); if (field === "materialId") result.items[0].materialId = 999; else result.items[0][field] = "OTHER"; return result; });
    await render(); placeholders(); expect(runtime.scope.onAuthorizationError).toHaveBeenCalledTimes(1);
  });
  it("cancels page 1 and refuses a late success before the new page resolves", async () => {
    const first = deferred<ChannelReferenceLookupResult>(), second = deferred<ChannelReferenceLookupResult>();
    runtime.lookup.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    await render(); const input1 = runtime.lookup.mock.calls[0][0], signal1 = runtime.lookup.mock.calls[0][1].signal; placeholders();
    await click(button("下一页")); expect(signal1.aborted).toBe(true); expect(runtime.lookup.mock.calls[1][0].materialIds).toEqual([21]); placeholders();
    await act(async () => first.resolve(response(input1))); placeholders();
    await act(async () => second.resolve(response(runtime.lookup.mock.calls[1][0]))); expect(referenceCells()[0].textContent).toContain("0.000000012345");
  });
  it.each(["binding", "readVersion", "authorizationVersion", "nativeGrantVersion", "merchant", "writePermission"] as const)("%s cancels a pending same-row snapshot and rejects its late response", async field => {
    const old = deferred<ChannelReferenceLookupResult>(), fresh = deferred<ChannelReferenceLookupResult>();
    runtime.lookup.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
    await render(); const oldInput = runtime.lookup.mock.calls[0][0], signal = runtime.lookup.mock.calls[0][1].signal;
    if (field === "binding") { runtime.scope.storageScope = "scope-8-31"; runtime.scope.contextVerification.identity = "scope-8-31"; runtime.scope.frontUser.id = 8; runtime.scope.staffPrincipal.frontendUserId = 8; runtime.enterprise.currentUserId = 8; }
    if (field === "readVersion") runtime.scope.contextVerification.readVersion = "read-v2";
    if (field === "authorizationVersion") runtime.scope.contextVerification.authorizationVersion = "auth-v2";
    if (field === "nativeGrantVersion") runtime.scope.officialInventoryPermissions.authorizationVersion = "native-v2";
    if (field === "merchant") runtime.scope.merchantId = 56;
    if (field === "writePermission") runtime.scope.officialInventoryPermissions.write = true;
    await render(); expect(signal.aborted).toBe(true); placeholders(); expect(runtime.lookup).toHaveBeenCalledTimes(2);
    const stale = response(oldInput); stale.items[0].references.lcsc.tiers[1].unitPrice = "999999999.123";
    await act(async () => old.resolve(stale)); placeholders(); expect(document.body.textContent).not.toContain("999999999.123");
  });
  it("filter and sort changes cancel old requests and preserve the actual native input", async () => {
    const old = deferred<ChannelReferenceLookupResult>(); runtime.lookup.mockImplementationOnce(() => old.promise);
    await render(); const signal = runtime.lookup.mock.calls[0][1].signal;
    const input = required(document.querySelector<HTMLInputElement>('[aria-label="筛选库存型号"]'));
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "  EXACT-PART-SUFFIX  "); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(signal.aborted).toBe(false); await click(button("搜索")); expect(signal.aborted).toBe(true);
    expect(runtime.lookup.mock.calls.at(-1)?.[0].listInput).toMatchObject({ partNumber: "EXACT-PART-SUFFIX", page: 1 });
    await click(required(document.querySelector('[aria-label="按可供数量排序"]')));
    expect(runtime.lookup.mock.calls.at(-1)?.[0].listInput).toMatchObject({ partNumber: "EXACT-PART-SUFFIX", sortBy: "qty", sortDirection: "desc", page: 1 });
  });
  it("batch snapshots expose no manual reference refresh and page changes never request collection", async () => {
    await render(); expect(document.body.textContent).not.toContain("更新参考");
    expect(runtime.lookup).toHaveBeenCalledTimes(1); expect(runtime.lookup.mock.calls[0][0].refresh).toBe(false);
    await render(); expect(runtime.lookup).toHaveBeenCalledTimes(1);
    await click(button("下一页")); expect(runtime.lookup.mock.calls.at(-1)?.[0].refresh).toBe(false);
    await click(button("上一页")); expect(runtime.lookup.mock.calls.at(-1)?.[0].refresh).toBe(false); expect(runtime.invalidate).not.toHaveBeenCalled();
  });
  it("pending keeps compact 暂未匹配 with a readonly source opener, polls every 4s and stops at 90s without automatic collection", async () => {
    vi.useFakeTimers(); runtime.lookup.mockImplementation(async input => response(input, "pending")); await render(); placeholders(2, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(3999); }); expect(runtime.lookup).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(runtime.lookup).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(86000); }); placeholders(2, true); const count = runtime.lookup.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(120000); }); expect(runtime.lookup).toHaveBeenCalledTimes(count);
    expect(runtime.lookup.mock.calls.every(([input]) => input.refresh === false)).toBe(true);
    expect(vi.getTimerCount()).toBe(0); expect(document.body.textContent).not.toContain("更新参考");
  });
  it("a never-resolving request is aborted at 90s and late success is ignored", async () => {
    vi.useFakeTimers(); const pending = deferred<ChannelReferenceLookupResult>(); runtime.lookup.mockImplementationOnce(() => pending.promise);
    await render(); const input = runtime.lookup.mock.calls[0][0], signal = runtime.lookup.mock.calls[0][1].signal;
    await act(async () => { await vi.advanceTimersByTimeAsync(90000); }); expect(signal.aborted).toBe(true); expect(document.body.textContent).not.toContain("更新参考");
    await act(async () => pending.resolve(response(input))); placeholders(); expect(vi.getTimerCount()).toBe(0);
  });
  it("revoked read and actual unmount cancel without late authorization error reporting", async () => {
    const pending = deferred<ChannelReferenceLookupResult>(); runtime.lookup.mockImplementationOnce(() => pending.promise);
    await render(); const signal = runtime.lookup.mock.calls[0][1].signal; runtime.scope.officialInventoryPermissions.read = false;
    await render(); expect(signal.aborted).toBe(true); expect(document.body.textContent).toContain("当前账号没有渠道库存查看权限");
    expect(document.querySelector(".ci-part-copy-button")).toBeNull();
    await act(async () => pending.reject(new Error("LATE_AUTH_ERROR"))); expect(runtime.scope.onAuthorizationError).not.toHaveBeenCalled();
    runtime.scope.officialInventoryPermissions.read = true; const next = deferred<ChannelReferenceLookupResult>(); runtime.lookup.mockImplementationOnce(() => next.promise);
    await render(); const nextSignal = runtime.lookup.mock.calls.at(-1)?.[1].signal; await act(async () => root.render(null)); expect(nextSignal.aborted).toBe(true);
    await act(async () => next.reject(new Error("LATE_UNMOUNT_ERROR"))); expect(runtime.scope.onAuthorizationError).not.toHaveBeenCalled();
  });
  it("reports current reference authorization errors through scope without changing native stock or exposing text", async () => {
    const error = new Error("FORBIDDEN INTERNAL_NOT_FOR_UI"); runtime.lookup.mockRejectedValueOnce(error);
    await render(); expect(runtime.scope.onAuthorizationError).toHaveBeenCalledWith(error); placeholders();
    expect(document.body.textContent).not.toContain("INTERNAL_NOT_FOR_UI");
    expect(document.querySelector("td.ci-material-price-col")?.textContent).toBe("¥1.234567890123未税"); expect(document.querySelector("td.ci-material-qty-col")?.textContent).toBe("9");
  });
  it("original inventory refresh still invalidates exactly four native queries, never the reference scope", async () => {
    await render(); const count = runtime.lookup.mock.calls.length; await click(button("刷新"));
    expect(runtime.invalidate.mock.calls).toEqual([["listTeamMaterials"], ["listTeamSourceOptions"], ["notesList"], ["collaborationNotesList"]]);
    expect(runtime.lookup).toHaveBeenCalledTimes(count); expect(runtime.refetch).not.toHaveBeenCalled();
  });
  it("does not start reference IO in channels-only or channel-management navigation", async () => {
    window.history.replaceState({}, "", "/channel-inventory?ciView=channels"); await render(); expect(runtime.lookup).not.toHaveBeenCalled(); placeholders(0);
    await act(async () => { window.history.replaceState({}, "", "/channel-inventory?ciTab=channels"); window.dispatchEvent(new PopStateEvent("popstate")); });
    await render(); expect(runtime.lookup).not.toHaveBeenCalled();
  });
  it("preserves original business hashes, allowing only exact approved stronger edit guards without rebaselining", () => {
    const source = readFileSync("client/src/business/platform/client/src/pages/ChannelInventoryHost.tsx", "utf8");
    const pins = [
      ["  const materialInput:", "  const exactStockDenied", "444fd83744384098fbd7bedd3dca5b74d19db699b87b05e7c2b190bda0236525"],
      ["  const refreshMaterials =", "  const changeTab =", "7a0d658b6caeb69e57095fa08e12eca79652d1ae52a2ae21eda9025d627ca856"],
      ["  const downloadChannelMaterials =", "  const submitChannel =", "668c8d310196dfe2305fb73183490032e5d1b06f26178a34a53ca63bc998ac4f"],
      ["  const confirmMaterialFilters =", "  const changeInventoryView =", "68bb7bb8a407b166f9b7dc07a88b941aba1f9241fd5e5627914ad2fa619e72d8"],
      ["  const submitChannel =", "  const activeChannels =", "14f5253188cde50152cf02e98419bfa71176905dc74debfbe050488a038d5240"],
    ];
    // Keep the old hash as the authority. Require each approved hardening exactly
    // once, normalize only those five literal changes, then hash all other bytes.
    const editGuardHardening = [
      ["    if (material.canEdit !== true || material.readOnly || !expectedContext || busy !== null || materialSubmitPendingRef.current\n      || !contextCurrent || !sourceContextVerified || !isCurrent() || !editAllowedRef.current) return;", "    if (!material.canEdit || material.readOnly || !isCurrent() || !editAllowedRef.current) return;"],
      ["    if (!expectedContext || !isCurrent() || !materialEditor || busy || materialSubmitPendingRef.current || !sourceContextVerified || !contextCurrent) return;", "    if (!expectedContext || !isCurrent() || !materialEditor || busy) return;"],
      ["    materialSubmitPendingRef.current = true;\n    setBusy(\"material\");", "    setBusy(\"material\");"],
      ["      materialSubmitPendingRef.current = false;\n      materialUpdateRef.current = null;", "      materialUpdateRef.current = null;"],
      ["      if (current()) { materialSubmitPendingRef.current = false; setBusy(null); }", "      if (current()) setBusy(null);"],
    ];
    for (const [start, end, hash] of pins) {
      const index = source.indexOf(start); expect(index).toBeGreaterThanOrEqual(0);
      let protectedRegion = source.slice(index, source.indexOf(end, index));
      if (start === "  const submitChannel =") for (const [approved, original] of editGuardHardening) {
        expect(protectedRegion.split(approved)).toHaveLength(2);
        protectedRegion = protectedRegion.replace(approved, original);
      }
      expect(createHash("sha256").update(protectedRegion).digest("hex")).toBe(hash);
    }
  });
  it("source keeps BFF reads separate and permits only validated readonly source Popover links, without cell IO or business mutation", async () => {
    const source = readFileSync("client/src/business/platform/client/src/pages/ChannelInventoryHost.tsx", "utf8");
    const cell = readFileSync("client/src/business/platform/client/src/pages/ChannelReferenceCell.tsx", "utf8");
    expect(source).toContain("referenceClient.channelReference.lookup.query"); expect(source).not.toContain("utils.client.channelReference");
    expect(source).toContain("listInput: materialInput, materialIds: referenceRows.map(row => row.id), refresh");
    expect(cell).toContain('import { Popover, PopoverTrigger, PopoverContent } from "../components/ui/popover"');
    expect(cell).toContain("channelReferencePageUrl(quote.pageUrl, source)");
    expect(cell.match(/href=\{[^}]+\}/g)).toEqual(["href={safePage}", "href={search.href}"]);
    expect(cell.match(/rel="noopener noreferrer" referrerPolicy="no-referrer"/g)).toHaveLength(2);
    expect(cell).toContain("来源页面（非已匹配报价）"); expect(cell).toContain("完整型号公开搜索（非匹配商品）");
    expect(cell).toContain('align="start" collisionPadding={8}');
    expect(cell.match(/event => event\.stopPropagation\(\)/g)).toHaveLength(4);
    expect(cell).toContain("diagnostic?: ChannelReferenceRefreshDiagnostic");
    expect(cell).not.toMatch(/diagnostic\?\.|diagnostic\.|fetchedAt|formatBeijing|CHANNEL_REFERENCE_REFRESH_LABELS|ci-reference-evidence-hash/);
    expect(cell).not.toMatch(/stockQuantity|stockInsufficient|tiers\.map|fetch\s*\(|setInterval|spinner|useMutation|mutate(?:Async)?\s*\(|invalidate|refetch|createBusinessScopeTrpcClient|listTeamMaterials|materialDTO|download|export.*(?:csv|xlsx)/i);
    expect(source).toContain('<button type="button" className="ci-button" onClick={() => void refreshMaterials()}>刷新</button>');
    expect(source).not.toContain("更新参考"); expect(source).not.toContain("refreshReferences");
    expect(source).toContain("rows: referenceRows, refresh: manual, isCurrent: current");
    expect(source).toContain("if (referenceRunKey) runReferenceLookup(false)");
    const manualHandler = source.slice(source.indexOf("  const recheckUnmatchedReferences ="), source.indexOf("  useEffect(() => {", source.indexOf("  const recheckUnmatchedReferences =")));
    expect(manualHandler).toContain("if (!referenceAllowed || referencePendingRef.current || referenceCurrentRef.current !== referenceRunKey) return");
    expect(manualHandler).toContain("referencePendingRef.current = true"); expect(manualHandler).toContain("runReferenceLookup(true)");
    expect(source.match(/runReferenceLookup\(true\)/g)).toHaveLength(1);
    // Exercise rejected URLs in the existing source-guard case; no added test or network access.
    for (const provider of ["lcsc", "ickey"] as const) {
      const providerHost = provider === "lcsc" ? "item.szlcsc.com" : "search.ickey.cn";
      for (const url of [`http://${providerHost}/product`, `https://${providerHost}.evil.example/product`, `https://user:password@${providerHost}/product`, `https://${providerHost}:444/product`, quote(provider === "lcsc" ? "ickey" : "lcsc").pageUrl, ...(provider === "lcsc" ? ["https://so.szlcsc.com/global.html"] : [])]) {
        const value = { ...quote(provider), pageUrl: url };
        await act(async () => root.render(React.createElement(ChannelReferenceCell, { source: provider, quote: value })));
        await inspectReadonlySource(host, provider, "ok", null, null);
      }
    }
  });
});
