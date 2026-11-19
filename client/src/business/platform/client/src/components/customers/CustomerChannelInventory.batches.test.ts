// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listUploadBatchesSchema } from "../../../../shared/channelInventoryManagement";

const rt = vi.hoisted(() => {
  const list = vi.fn(), batches = vi.fn(), detail = vi.fn(), update = vi.fn(), remove = vi.fn(), lookup = vi.fn();
  return { list, batches, detail, update, remove, lookup, change: vi.fn(), auth: vi.fn(),
    utils: { client: { channelInventory: { listTeamMaterials: { query: list }, listUploadBatches: { query: batches }, getTeamMaterialForEdit: { query: detail } } },
      channelInventory: { listTeamMaterials: { invalidate: vi.fn() } } } };
});
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({ merchantId: 55, storageScope: "31:7",
  frontUser: { id: 7, role: "user" }, staffPrincipal: { frontendUserId: 7, enterpriseId: 31 },
  contextVerification: { identity: "31:7", state: "verified", authorizationVersion: "a1", readVersion: "r1" },
  officialInventoryPermissions: { read: true, write: true, note: true, publish: false, authorizationVersion: "n1" } }) }));
vi.mock("../../../../../api/business-trpc", () => ({
  createBusinessScopeTrpcClient: () => ({ channelReference: { lookup: { query: rt.lookup } } }),
  trpc: { useUtils: () => rt.utils, channelInventory: {
    updateTeamMaterial: { useMutation: () => ({ mutateAsync: rt.update }) }, deleteMaterials: { useMutation: () => ({ mutateAsync: rt.remove }) } } },
}));
vi.mock("../channelInventory/FactoryMaterialPublish", () => ({ useFactoryMaterialPublish: () => ({ dialog: null, action: () => React.createElement(React.Fragment) }) }));
import { CustomerChannelInventory, type CustomerChannelInventoryProps } from "./CustomerChannelInventory";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const identity = { enterpriseId: 31, actorUserId: 7, key: "AUTH-A" };
const expected = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
function batch(id: number) { return { id, batchCode: `B-${id}`, name: null, fileName: `批次-${id}.xlsx`, channelId: 11, channelName: "授权客户", uploadedByName: "本人",
  createdAt: "2026-11-19T08:00:00Z", totalRows: 1, successCount: 1, remainingCount: 1, revision: 4, archived: false, closed: false }; }
function batchPage(input: any, items = [batch(501), batch(502)], total = items.length) {
  return { items, total, page: input.page, pageSize: input.pageSize, pageCount: Math.ceil(total / input.pageSize) };
}
function stock(input: any, extra = {}) { return { id: 101, revision: 1, partNumber: `M-${input.customerId}-${input.uploadBatchId ?? "ALL"}-${input.page}`,
  brand: "TI", qty: 1, price: "1", currency: "CNY", taxIncluded: false, company: { id: input.customerId, name: "客户" }, channelSource: { id: 11 },
  canViewSource: true, canEditMaterial: true, canEdit: true, canDelete: false, readOnly: false, isMine: true, canPublish: false, noteCount: 0,
  uploadBatchId: input.uploadBatchId ?? null, ...extra }; }
function page(input: any, items = [stock(input)], total = 40) { return { items, customerId: input.customerId, customerVersion: 4, bindingCount: 1, canWrite: true,
  total, page: input.page, pageSize: input.pageSize, pageCount: Math.ceil(total / input.pageSize) }; }
function deferred() { let resolve!: (value: any) => void, reject!: (error: any) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let root: Root, host: HTMLDivElement, props: CustomerChannelInventoryProps;
function Controlled(props: CustomerChannelInventoryProps) {
  const [selectedBatchId, setSelected] = useState(props.selectedBatchId);
  return React.createElement(CustomerChannelInventory, { ...props, selectedBatchId, onBatchChange: id => { rt.change(id); setSelected(id); } });
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render(overrides: Partial<CustomerChannelInventoryProps> = {}, controlled = false) {
  props = { customerId: 801, customerVersion: 4, identity, enabled: true, onAuthorizationError: rt.auth, onBatchChange: rt.change, ...overrides };
  await act(async () => root.render(React.createElement(controlled ? Controlled : CustomerChannelInventory, props))); await settle();
}
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("Missing batch fixture control"); return value; }
function select() { return required(host.querySelector<HTMLSelectElement>('[aria-label="按上传批次查看"]')); }
function named(text: string) { return required([...host.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text)); }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); await settle(); }
async function choose(value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select(), value); select().dispatchEvent(new Event("change", { bubbles: true })); }); await settle(); }
async function edit(label: string, value: string) { const input = required(host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`));
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
function handlers(element: Element) { return (element as any)[Object.keys(element).find(key => key.startsWith("__reactProps$"))!]; }
beforeEach(() => {
  rt.list.mockReset().mockImplementation(input => Promise.resolve(page(input)));
  rt.batches.mockReset().mockImplementation(input => Promise.resolve(batchPage(input)));
  rt.auth.mockReset(); rt.change.mockReset(); rt.lookup.mockReset().mockImplementation(async ({ listInput, materialIds }) => {
    const index = rt.list.mock.calls.findLastIndex(([input]) => JSON.stringify(input) === JSON.stringify(listInput));
    expect(index).toBeGreaterThanOrEqual(0);
    const served = await rt.list.mock.results[index].value;
    const quote = (source: string) => ({ source, status: "not_found", matchedPartNumber: null, matchedBrand: null, productCode: null, pageUrl: null,
      stockQuantity: null, unitPrice: null, tierQuantity: null, tiers: [], currency: null, unit: null, taxStatus: "unknown", packaging: null,
      fetchedAt: null, expiresAt: null, stockInsufficientForTier: false, message: null });
    return { items: materialIds.map((id: number) => { const item = required(served.items.find((row: any) => row.id === id));
      return { materialId: id, partNumber: item.partNumber, brand: item.brand, references: { lcsc: quote("lcsc"), ickey: quote("ickey") } }; }) };
  });
  for (const write of [rt.detail, rt.update, rt.remove]) write.mockReset().mockImplementation(() => { throw new Error("Unexpected write/detail in read-only batch fixtures"); });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("REAL_NETWORK_FORBIDDEN"); }));
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => { throw new Error("REAL_XHR_FORBIDDEN"); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled(); expect(XMLHttpRequest.prototype.open).not.toHaveBeenCalled();
  expect(rt.detail).not.toHaveBeenCalled(); expect(rt.update).not.toHaveBeenCalled(); expect(rt.remove).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("customer upload batch list and exact server filters", () => {
  it("reads both 100-row pages under the same exact customer/identity and publishes no partial options", async () => {
    const second = deferred();
    rt.batches.mockImplementation(input => input.page === 1 ? Promise.resolve(batchPage(input, Array.from({ length: 100 }, (_, i) => batch(501 + i)), 101)) : second.promise);
    await render(); expect(rt.batches).toHaveBeenCalledTimes(2); expect(select().options).toHaveLength(1);
    expect(rt.batches.mock.calls.map(([input]) => input)).toEqual([{ ...expected, customerId: 801, page: 1, pageSize: 100 }, { ...expected, customerId: 801, page: 2, pageSize: 100 }]);
    for (const [input, options] of rt.batches.mock.calls) { expect(listUploadBatchesSchema.parse(input)).toEqual(input); expect(options.signal).toBeInstanceOf(AbortSignal); }
    expect(rt.batches.mock.calls[1][1].signal).toBe(rt.batches.mock.calls[0][1].signal);
    await act(async () => second.resolve(batchPage({ page: 2, pageSize: 100 }, [batch(601)], 101))); await settle();
    expect(select().options).toHaveLength(102); expect(select().options[101].textContent).toContain("批次-601.xlsx"); expect(rt.auth).not.toHaveBeenCalled();
  });
  it("selects a batch through the real controlled callback, sends customerId plus uploadBatchId to inventory and references", async () => {
    await render({}, true); const count = rt.list.mock.calls.length; await choose("502");
    expect(rt.change).toHaveBeenLastCalledWith(502); expect(select().value).toBe("502");
    expect(rt.list.mock.calls.slice(count).every(([input]) => input.customerId === 801 && input.uploadBatchId === 502 && input.page === 1)).toBe(true);
    expect(rt.list.mock.calls.at(-1)?.[0]).toEqual({ ...expected, customerId: 801, uploadBatchId: 502, partNumber: undefined, brand: undefined, page: 1, pageSize: 20 });
    expect(rt.lookup.mock.calls.at(-1)?.[0].listInput).toEqual(rt.list.mock.calls.at(-1)?.[0]);
    expect(host.textContent).toContain("M-801-502-1"); expect(host.textContent).not.toContain("M-801-ALL");
  });
  it("preserves the selected batch during normalized search, page two and refresh, and explicitly clears to all batches", async () => {
    await render({}, true); await choose("501"); const since = rt.list.mock.calls.length;
    await edit("筛选客户库存型号", "  ＬＭ３５８  "); await edit("筛选客户库存品牌", " TI ");
    await act(async () => required(host.querySelector("form")).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await settle();
    expect(rt.list.mock.calls.at(-1)?.[0]).toMatchObject({ customerId: 801, uploadBatchId: 501, partNumber: "LM358", brand: "TI", page: 1 });
    await click(named("下一页")); expect(rt.list.mock.calls.at(-1)?.[0]).toMatchObject({ customerId: 801, uploadBatchId: 501, page: 2 });
    await click(named("刷新库存")); expect(rt.list.mock.calls.at(-1)?.[0]).toMatchObject({ uploadBatchId: 501, page: 2 });
    expect(rt.list.mock.calls.slice(since).every(([input]) => input.customerId === 801 && input.uploadBatchId === 501 && !input.channelId && !input.customerName)).toBe(true);
    await choose(""); expect(rt.change).toHaveBeenLastCalledWith(undefined); expect(select().value).toBe("");
    expect(rt.list.mock.calls.at(-1)?.[0]).toMatchObject({ customerId: 801, page: 1, partNumber: "LM358", brand: "TI" });
    expect(rt.list.mock.calls.at(-1)?.[0]).not.toHaveProperty("uploadBatchId");
  });
  it("a history-selected initial batch never sends a broad all-batch inventory read even once", async () => {
    await render({ selectedBatchId: 501 });
    expect(rt.list.mock.calls.length).toBeGreaterThan(0);
    expect(rt.list.mock.calls.every(([input]) => input.customerId === 801 && input.uploadBatchId === 501)).toBe(true);
  });
  it("an unchanged unselected batch never adds a second initial inventory query", async () => {
    await render(); expect(rt.list).toHaveBeenCalledTimes(1); expect(rt.auth).not.toHaveBeenCalled();
  });
  it("rejects a forged batch ID absent from the complete authorized options without query or callback", async () => {
    await render(); const count = rt.list.mock.calls.length;
    await act(async () => handlers(select()).onChange({ target: { value: "999" } }));
    expect(rt.change).not.toHaveBeenCalled(); expect(rt.list).toHaveBeenCalledTimes(count);
  });
  it.each([undefined, null, 502, "501"])("rejects wrong material uploadBatchId=%s, no local filtering or reference fallback", async uploadBatchId => {
    rt.list.mockImplementation(input => Promise.resolve(page(input, [stock(input, { uploadBatchId, partNumber: "FOREIGN-BATCH-SECRET" })])));
    await render({ selectedBatchId: 501 });
    expect(host.textContent).not.toContain("FOREIGN-BATCH-SECRET"); expect(host.querySelector('[role="alert"]')?.textContent).toContain("客户库存范围未能确认");
    expect(rt.lookup).not.toHaveBeenCalled(); expect(rt.auth).toHaveBeenCalledTimes(1);
  });
  it.each(["wrong-page", "wrong-size", "wrong-page-count"])("rejects malformed %s batch pagination before exposing an option", async kind => {
    rt.batches.mockImplementation(input => { const value = batchPage(input);
      if (kind === "wrong-page") value.page = 2; if (kind === "wrong-size") value.pageSize = 20; if (kind === "wrong-page-count") value.pageCount = 3;
      return Promise.resolve(value); });
    await render(); expect(select().options).toHaveLength(1); expect(host.textContent).toContain("批次读取未完成"); expect(rt.auth).toHaveBeenCalledTimes(1);
  });
  it.each(["negative-total", "duplicate-id", "unsafe-id", "oversized-page"])("fails closed on invalid %s batch list rather than enabling an unproven batch", async kind => {
    rt.batches.mockImplementation(input => { const value = batchPage(input);
      if (kind === "negative-total") { value.total = -1; value.pageCount = 0; }
      if (kind === "duplicate-id") value.items = [batch(501), batch(501)];
      if (kind === "unsafe-id") value.items = [batch(0)];
      if (kind === "oversized-page") { value.items = Array.from({ length: 101 }, (_, i) => batch(501 + i)); value.total = 101; value.pageCount = 2; }
      return Promise.resolve(value); });
    await render(); expect(select().options).toHaveLength(1); expect(rt.auth).toHaveBeenCalledTimes(1);
  });
  it.each(["success", "error"])("cross-customer change aborts old batch cursor and suppresses late %s/options/auth callbacks", async outcome => {
    const old = deferred(); rt.batches.mockReturnValueOnce(old.promise); await render(); const signal = rt.batches.mock.calls[0][1].signal;
    rt.batches.mockImplementation(input => Promise.resolve(batchPage(input, [batch(8021)])));
    await render({ customerId: 802, identity: { ...identity, key: "AUTH-B" } }); expect(signal.aborted).toBe(true);
    await act(async () => { if (outcome === "success") old.resolve(batchPage({ page: 1, pageSize: 100 }, [batch(8011)], 101)); else old.reject(new Error("OLD-AUTH")); }); await settle();
    expect([...select().options].map(item => item.value)).toEqual(["", "8021"]); expect(host.textContent).not.toContain("批次-8011"); expect(host.textContent).not.toContain("OLD-AUTH");
    expect(rt.batches.mock.calls.map(([input]) => input.customerId)).toEqual([801, 802]); expect(rt.auth).not.toHaveBeenCalled();
  });
  it("disabled or revoked parent scope sends neither batch nor inventory reads", async () => {
    await render({ enabled: false }); await render({ isCurrent: () => false });
    expect(rt.batches).not.toHaveBeenCalled(); expect(rt.list).not.toHaveBeenCalled(); expect(select().disabled).toBe(true);
  });
});
