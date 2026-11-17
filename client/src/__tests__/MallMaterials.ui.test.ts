// @vitest-environment jsdom
// All native API calls are mocks. No database, server, browser or product writes.
import React, { act } from "react";
import { QueryClient } from "@tanstack/react-query";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficialMallAccess, OfficialMallDuplicate, OfficialMallImportResult, OfficialMallMaterial, OfficialMallPreviewRow, OfficialMallSuggestion } from "@shared/officialMall";
import * as jsxRuntime from "react/jsx-runtime";
import { officialMallMaterialInputSchema } from "@shared/officialMall";
const h = vi.hoisted(() => ({
  authId: 7 as number | null, authUser: null as { id: number; hasNativeAdminAccount: boolean } | null, authError: null as Error | null,
  access: undefined as OfficialMallAccess | undefined, accessError: null as Error | null,
  rows: [] as OfficialMallMaterial[], suggestions: [] as OfficialMallSuggestion[], duplicates: [] as OfficialMallDuplicate[], matchStatus: "exact" as OfficialMallPreviewRow["matchStatus"],
  queries: [] as { input: Record<string, unknown>; options: { enabled: boolean } }[],
  suggestQueries: [] as { input: Record<string, unknown>; options: { enabled: boolean } }[],
  statusRead: vi.fn(), listRead: vi.fn(), suggestRead: vi.fn(), create: vi.fn(), update: vi.fn(), publish: vi.fn(), offshelf: vi.fn(), bulk: vi.fn(), receipt: vi.fn(), preview: vi.fn(), importRows: vi.fn(), invalidate: vi.fn(), refetch: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => {
  if (h.authUser?.id !== h.authId) h.authUser = h.authId ? { id: h.authId, hasNativeAdminAccount: true } : null;
  return { user: h.authUser, isAuthenticated: !!h.authId, loading: false, error: h.authError };
} }));
vi.mock("@/lib/trpc", () => ({ trpc: {
  useUtils: () => ({ client: { officialMall: {
    status: { query: h.statusRead }, list: { query: h.listRead }, suggest: { query: h.suggestRead },
    create: { mutate: h.create }, update: { mutate: h.update }, publish: { mutate: h.publish }, offshelf: { mutate: h.offshelf }, bulkAction: { mutate: h.bulk }, requestStatus: { query: h.receipt }, importPreview: { query: h.preview }, importRows: { mutate: h.importRows },
} } }),
} }));
vi.mock("@/lib/adminNewInformation", () => ({ useAdminNewInformationContextRows: () => ({ getRow: () => ({ isNew: false, ref: () => {} }) }) }));
vi.mock("@/components/admin/AdminNewInformationBadge", () => ({ AdminNewInformationRowBadge: () => null }));
import SourceMallMaterials from "../business/MallMaterials";
import { trpc as mockTrpc } from "@/lib/trpc";
import { useAuth as mockUseAuth } from "@/_core/hooks/useAuth";
const MallMaterials = process.env.MALL_REPAIR_LEAF
  ? new Function("__NI", readFileSync(process.env.MALL_REPAIR_LEAF, "utf8").replace(/^const __NI=.*\n/, "").replace("export function createNativeMallPage", "function createNativeMallPage") + "\nreturn createNativeMallPage;")({ useAdminNewInformationContextRows: () => ({ getRow: () => ({ isNew: false, ref: () => {} }) }), AdminNewInformationRowBadge: () => null })({ React, jsx: jsxRuntime, useAuth: mockUseAuth, trpc: mockTrpc, DashboardLayout: ({children}: {children: React.ReactNode}) => children })
  : SourceMallMaterials;
import { readRequestHold, storeRequestHold } from "../lib/officialMallImport";
let root: Root | undefined, host: HTMLDivElement;
Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
const fixture = (override: Partial<OfficialMallMaterial> = {}): OfficialMallMaterial => ({ partNumber: "LOCAL-PART", brand: "LOCAL-BRAND", pkg: "QFN", dateCode: "LOCAL-DC", qtyStock: null, qtyOnSale: 500, qtyOrder: null, priceEx: "9.000000", moq: 101, spq: 50, leadTime: "人工确认3天", taxIncluded: true, note: "内部本地夹具", ladderPrices: [{ minQty: 1, price: "8" }, { minQty: 100, price: "5.123400" }, { minQty: 200, price: "2" }], id: 101, revision: 4, status: "draft", teamId: 3, ownerAdminUserId: 7, createdByAdminUserId: 7, updatedByAdminUserId: 7, publishedByAdminUserId: null, createdAt: "2026-01-01", updatedAt: "2026-01-01", publishedAt: null, ...override });
beforeEach(() => {
  vi.resetAllMocks(); sessionStorage.clear(); h.queries = []; h.suggestQueries = [];
  h.authId = 7; h.authUser = null; h.authError = null; h.accessError = null;
  h.access = { available: true, permissions: { read: true, write: true, publish: true }, scope: { adminUserId: 7, teamId: 3, teamRole: "member", isSuperAdmin: false } };
  h.rows = [fixture()]; h.suggestions = []; h.duplicates = []; h.matchStatus = "exact";
  h.statusRead.mockImplementation(async () => { if (h.accessError) throw h.accessError; return structuredClone(h.access); });
  h.listRead.mockImplementation(async (input: Record<string, unknown>) => { h.queries.push({ input, options: { enabled: true } }); return structuredClone({ items: h.rows, total: h.rows.length }); });
  h.suggestRead.mockImplementation(async (input: Record<string, unknown>) => { h.suggestQueries.push({ input, options: { enabled: true } }); return structuredClone({ items: h.suggestions }); });
  h.create.mockResolvedValue({ success: true, id: 909, revision: 1, status: "draft" });
  h.update.mockResolvedValue({ success: true, id: 101, revision: 5, status: "draft" });
  h.publish.mockResolvedValue({ success: true, id: 101, revision: 5, status: "published" });
  h.offshelf.mockResolvedValue({ success: true, id: 101, revision: 5, status: "offshelf" });
  h.bulk.mockResolvedValue({ success: true, successful: 1, errors: [] });
  h.receipt.mockResolvedValue({ state: "not_found", result: null });
  h.preview.mockImplementation(async ({ rows }: { rows: { rowNumber: number; data: unknown }[] }) => ({ rows: rows.map(row => {
    const parsed = officialMallMaterialInputSchema.safeParse(row.data);
    return { rowNumber: row.rowNumber, data: parsed.success ? parsed.data : undefined, errors: parsed.success ? [] : parsed.error.issues.map(i => i.message), duplicates: h.duplicates, matches: h.suggestions, matchStatus: h.matchStatus } satisfies OfficialMallPreviewRow;
  }) }));
  h.importRows.mockImplementation(async ({ rows }: { rows: { rowNumber: number }[] }) => ({ success: true, imported: rows.length, updated: 0, skipped: 0, errors: [], ids: rows.map((_, i) => i + 1000) } satisfies OfficialMallImportResult));
});
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = undefined; vi.useRealTimers(); });
async function mount() { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); await act(async () => root!.render(React.createElement(MallMaterials))); }
async function renderAgain() { await act(async () => root!.render(React.createElement(MallMaterials))); }
function button(text: string, within: Element = host): HTMLButtonElement {
  const found = Array.from(within.querySelectorAll("button")).find(b => b.textContent === text); expect(found, `button ${text}`).toBeDefined(); return found!;
}
async function click(el: Element) { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function enter(label: string, value: string) {
  const el = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`); expect(el).not.toBeNull();
  act(() => { const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(el, value); el!.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function select(label: string, value: string) {
  const el = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`); expect(el).not.toBeNull();
  await act(async () => { el!.value = value; el!.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function newForm() { await click(button("新增物料")); enter("型号", "LOCAL-NEW"); enter("品牌", "LOCAL-BRAND"); }
async function pasteRows(n = 1) {
  await click(button("新增物料")); await click(button("表格导入"));
  enter("粘贴商城物料数据", "型号\t品牌\t封装\t可售数量\t基础价\t货期\t含税\n" + Array.from({ length: n }, (_, i) => `LOCAL-${i}\tLOCAL-BRAND\tQFN\t10\t1.230000\t人工7天\t是`).join("\n"));
  await click(button("识别并校验"));
}
async function confirmValid() { await click(host.querySelector('[aria-label="人工核对全部有效行"]')!); }

describe("native official mall compact DOM", () => {
  it("has no title/layout frame or front inventory bridge, and a separate brand column", async () => {
    await mount(); expect(host.querySelector("header,h1")).toBeNull(); expect(host.querySelector('[data-official-mall="native"]')).not.toBeNull();
    const th = Array.from(host.querySelectorAll(".mall-main-table th")).map(e => e.textContent);
    expect(th).toEqual(["", "型号", "品牌", "封装", "批次/DC", "可售数量", "报价 CNY", "货期", "状态", "操作"]);
    expect(host.querySelector(".mall-main-table tbody tr")?.children[2].textContent).toBe("LOCAL-BRAND");
    expect(host.querySelector(".mall-action-cell button")?.textContent).toBe("上架");
    expect(host.querySelector('[aria-label="选中物料批量操作"]')).toBeNull();
    await click(button("新增物料")); expect(Array.from(host.querySelectorAll(".mall-create-modes button")).map(e => e.textContent)).toEqual(["手工录入", "表格导入", "粘贴识别"]);
    const source = readFileSync("client/src/business/MallMaterials.tsx", "utf8");
    expect(source).not.toMatch(/BusinessScope|business-trpc|front-router-types|DashboardLayout|merchantId|inventoryId|authorizationVersion|选择已有库存/);
  });
  it("shows a real empty list without hidden personal inventory candidates", async () => {
    h.rows = []; await mount(); expect(host.textContent).toContain("暂无官方商城物料");
    expect(h.queries.filter(q => q.options.enabled).every(q => !('visibility' in q.input))).toBe(true);
    await click(button("新增物料")); expect(host.textContent).not.toMatch(/选择已有库存|前台库存|库存候选/);
  });
  it("filters native model, brand and status with 30-row paging", async () => {
    await mount(); enter("搜索商城物料型号", " LOCAL "); enter("搜索商城物料品牌", " BRAND "); await click(button("筛选")); await select("商城上架状态", "draft");
    expect(h.queries.at(-1)?.input).toMatchObject({ partNumber: "LOCAL", brand: "BRAND", status: "draft", page: 1, pageSize: 30 });
  });
  it("requires the local admin identity and read permission, not an implicit superuser bypass", async () => {
    h.access!.scope.adminUserId = 8; h.access!.scope.isSuperAdmin = true; await mount();
    expect(button("新增物料").disabled).toBe(true); expect(host.textContent).not.toContain("LOCAL-PART"); expect(h.listRead).not.toHaveBeenCalled();
  });
  it("keeps write-only staff able to create draft without publish permission", async () => {
    h.access!.permissions.publish = false; await mount(); await newForm(); await click(button("保存到待上架"));
    expect(h.create).toHaveBeenCalledOnce(); expect(h.create.mock.calls[0][0]).toMatchObject({ requestId: expect.any(String), data: { qtyStock: null, qtyOnSale: null, priceEx: null, taxIncluded: null } });
    expect(h.publish).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled(); expect(host.textContent).toContain("未自动发布");
  });
  it("shows default MOQ/SPQ-adapted price with all exact gradient values expandable", async () => {
    await mount(); expect(host.querySelector(".mall-quote-main")?.textContent).toBe("150件 · ¥5.123400");
    const details = host.querySelector<HTMLDetailsElement>(".mall-quote details")!; expect(details.open).toBe(false); expect(details.textContent).toContain("200+　¥2"); expect(details.textContent).toContain("基础价　¥9.000000"); expect(host.textContent).toContain("实际 未知");
  });
  it("keeps exact inquiry quotes for unknown tax and does not reject native publication solely for tax unknown", async () => {
    h.rows = [fixture({ taxIncluded: null })]; await mount(); expect(host.querySelector(".mall-quote-main")?.textContent).toBe("150件 · ¥5.123400"); expect(host.textContent).toContain("税口径未知 · 仅询价");
    await click(button("上架")); await click(button("确认上架")); expect(h.publish).toHaveBeenCalledOnce();
  });
  it("clicking model edits full exact ladder and preserves unknown actual stock", async () => {
    await mount(); await click(button("LOCAL-PART")); expect(host.querySelectorAll(".mall-tier-row")).toHaveLength(3); expect(host.querySelector<HTMLInputElement>('[aria-label="实际库存（未知留空）"]')?.value).toBe("");
    enter("第2档单价", "5.000001"); await click(button("保存草稿"));
    expect(h.update).toHaveBeenCalledOnce(); expect(h.update.mock.calls[0][0]).toMatchObject({ id: 101, expectedRevision: 4, data: { qtyStock: null, ladderPrices: [{ minQty: 1, price: "8" }, { minQty: 100, price: "5.000001" }, { minQty: 200, price: "2" }] } });
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("rejects partial ladders and limits editing to ten complete pairs", async () => {
    await mount(); await click(button("LOCAL-PART")); enter("第1档单价", ""); await click(button("保存草稿")); expect(h.update).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("同时填写");
    for (let i = 0; i < 7; i++) await click(button("增加档位")); expect(host.querySelectorAll(".mall-tier-row")).toHaveLength(10); expect(button("增加档位").disabled).toBe(true);
  });
  it("blocks stale revision instead of switching or silently replacing the selected row", async () => {
    await mount(); await click(button("LOCAL-PART")); h.rows = [fixture({ revision: 5 })]; await click(button("刷新")); expect(button("保存草稿").disabled).toBe(true); await click(button("保存草稿")); expect(h.update).not.toHaveBeenCalled(); expect(host.textContent).toContain("版本已变化");
  });
  it("requires explicit offshelf before editing published records", async () => {
    h.rows = [fixture({ status: "published" })]; await mount(); await click(button("LOCAL-PART")); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(host.textContent).toContain("先下架");
    await click(button("下架")); await click(button("确认下架")); expect(h.offshelf.mock.calls[0][0]).toMatchObject({ id: 101, expectedRevision: 4 }); expect(h.update).not.toHaveBeenCalled();
  });
  it("debounced suggestions fill only metadata and allow unmatched manual data", async () => {
    h.suggestions = [{ partNumber: "CHOSEN-PART", brand: "CHOSEN-BRAND", pkg: "SOT" }]; await mount(); await newForm();
    enter("可售数量", "4"); enter("基础单价（面议留空）", "1.234500"); enter("货期", "人工3天"); await select("税口径", "false");
    expect(h.suggestQueries.filter(q => q.options.enabled)).toHaveLength(0);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 520)); });
    expect(h.suggestQueries.some(q => q.options.enabled && q.input.query === "LOCAL-NEW")).toBe(true);
    await click(host.querySelector('[aria-label="使用型号资料 CHOSEN-PART CHOSEN-BRAND SOT"]')!);
    expect(host.querySelector<HTMLInputElement>('[aria-label="可售数量"]')?.value).toBe("4"); expect(host.querySelector<HTMLInputElement>('[aria-label="基础单价（面议留空）"]')?.value).toBe("1.234500"); expect(host.querySelector<HTMLSelectElement>('[aria-label="税口径"]')?.value).toBe("false");
    await click(button("保存到待上架")); expect(h.create.mock.calls[0][0].data).toMatchObject({ partNumber: "CHOSEN-PART", brand: "CHOSEN-BRAND", pkg: "SOT", qtyOnSale: 4, qtyStock: null, priceEx: "1.234500", leadTime: "人工3天", taxIncluded: false });
  });
  it("checks publish quantity/lead/tax and sends only native id, revision and UUID", async () => {
    h.rows = [fixture({ qtyOnSale: null, qtyOrder: null })]; await mount(); await click(button("上架")); await click(button("确认上架")); expect(h.publish).not.toHaveBeenCalled(); expect(host.textContent).toContain("大于0");
    await click(button("关闭")); h.rows = [fixture()]; await click(button("刷新")); await click(button("上架")); await click(button("确认上架"));
    expect(h.publish.mock.calls[0][0]).toEqual({ id: 101, expectedRevision: 4, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
  });
  it("shows batch buttons only after explicit selection, using native draft revisions", async () => {
    await mount(); await click(host.querySelector('[aria-label="选择物料 LOCAL-PART 101"]')!); expect(button("批量上架")).toBeDefined(); await click(button("批量上架")); await click(button("确认批量上架"));
    expect(h.bulk.mock.calls[0][0]).toEqual({ action: "publish", requestId: expect.any(String), items: [{ id: 101, expectedRevision: 4 }] }); expect(h.create).not.toHaveBeenCalled();
  });
});
describe("native UUID holds and deterministic import DOM", () => {
  it("holds an incomplete success response rather than treating a missing created ID as final", async () => {
    h.create.mockResolvedValue({ success: true }); await mount(); await newForm(); await click(button("保存到待上架"));
    const id = h.create.mock.calls[0][0].requestId; expect(readRequestHold("7:3")?.requestId).toBe(id); expect(host.textContent).toContain("响应不完整"); expect(h.create).toHaveBeenCalledOnce();
  });
  it("preserves exact native import refusal on every rejected row and stops later batches", async () => {
    h.importRows.mockRejectedValueOnce(Object.assign(new Error("官方团队范围已撤销，事务明确拒绝"), { data: { code: "FORBIDDEN" } })); await mount(); await pasteRows(101); await confirmValid(); await click(button("导入已确认有效行（101）"));
    expect(h.importRows).toHaveBeenCalledOnce(); expect(readRequestHold("7:3")).toBeNull(); expect(host.querySelector(".mall-preview-table tbody tr")?.textContent).toContain("官方团队范围已撤销，事务明确拒绝"); expect(host.textContent).toContain("错误 100");
  });
  it("unknown create persists the same UUID across remount, and not_found receipt never authorizes resend", async () => {
    h.create.mockRejectedValue(new Error("LOCAL timeout")); await mount(); await newForm(); await click(button("保存到待上架")); const id = h.create.mock.calls[0][0].requestId;
    expect(readRequestHold("7:3")?.requestId).toBe(id); expect(button("保存到待上架").disabled).toBe(true);
    act(() => root!.unmount()); host.remove(); root = undefined; await mount(); expect(host.textContent).toContain(id);
    await click(button("核对原请求")); expect(h.receipt).toHaveBeenCalledWith({ requestId: id }); expect(readRequestHold("7:3")?.requestId).toBe(id); expect(button("新增物料").disabled).toBe(true); expect(h.create).toHaveBeenCalledOnce();
  });
  it("explicit transaction refusal preserves concrete server message but releases UUID for manual reselection", async () => {
    h.create.mockRejectedValue(Object.assign(new Error("品牌超过允许范围，拒绝创建"), { data: { code: "BAD_REQUEST" } })); await mount(); await newForm(); await click(button("保存到待上架"));
    expect(readRequestHold("7:3")).toBeNull(); expect(host.textContent).toContain("品牌超过允许范围，拒绝创建"); expect(button("新增物料").disabled).toBe(false); expect(h.create).toHaveBeenCalledOnce();
  });
  it("unknown 5xx and bulk operations keep original UUID, with completed-null still blocked", async () => {
    h.bulk.mockRejectedValue(Object.assign(new Error("LOCAL 5xx"), { data: { code: "INTERNAL_SERVER_ERROR" } })); await mount(); await click(host.querySelector('[aria-label="选择物料 LOCAL-PART 101"]')!); await click(button("批量上架")); await click(button("确认批量上架"));
    const id = h.bulk.mock.calls[0][0].requestId; expect(readRequestHold("7:3")?.requestId).toBe(id);
    h.receipt.mockResolvedValue({ state: "completed", result: null }); await click(button("核对原请求")); expect(readRequestHold("7:3")?.requestId).toBe(id); expect(h.bulk).toHaveBeenCalledOnce();
  });
  it("requires manual row confirmation, imports draft strings only and never automatically publishes", async () => {
    await mount(); await pasteRows(); expect(button("导入已确认有效行（0）").disabled).toBe(true); await confirmValid(); await click(button("导入已确认有效行（1）"));
    expect(h.importRows).toHaveBeenCalledOnce(); expect(h.importRows.mock.calls[0][0]).toMatchObject({ requestId: expect.any(String), rows: [{ rowNumber: 2, duplicatePolicy: "skip", data: { partNumber: "LOCAL-0", brand: "LOCAL-BRAND", qtyOnSale: 10, qtyStock: null, priceEx: "1.230000" } }] }); expect(h.publish).not.toHaveBeenCalled(); expect(h.create).not.toHaveBeenCalled(); expect(host.textContent).toContain("成功 1");
  });
  it("previews 501 rows in chunks no larger than 500", async () => {
    await mount(); await pasteRows(501); expect(h.preview.mock.calls.map(call => call[0].rows.length)).toEqual([500, 1]); expect(h.importRows).not.toHaveBeenCalled();
  });
  it("stops after unknown first 100-row batch, preserves UUID, and resumes only remaining rows after receipt", async () => {
    h.importRows.mockRejectedValueOnce(new Error("LOCAL import timeout")); await mount(); await pasteRows(101); await confirmValid(); await click(button("导入已确认有效行（101）"));
    expect(h.importRows).toHaveBeenCalledOnce(); expect(h.importRows.mock.calls[0][0].rows).toHaveLength(100); const id = h.importRows.mock.calls[0][0].requestId;
    expect(readRequestHold("7:3")?.requestId).toBe(id); await click(button("核对原请求")); expect(h.receipt).toHaveBeenCalledWith({ requestId: id }); expect(h.importRows).toHaveBeenCalledOnce();
    h.receipt.mockResolvedValue({ state: "completed", result: { success: true, imported: 100, updated: 0, skipped: 0, errors: [], ids: Array.from({ length: 100 }, (_, i) => 1000 + i) } });
    await click(button("核对原请求")); expect(readRequestHold("7:3")).toBeNull(); expect(host.textContent).toContain("成功 100");
    await click(button("导入已确认有效行（1）")); expect(h.importRows).toHaveBeenCalledTimes(2); expect(h.importRows.mock.calls[1][0].rows).toHaveLength(1); expect(h.importRows.mock.calls[1][0].rows[0].rowNumber).toBe(102); expect(h.importRows.mock.calls[1][0].requestId).not.toBe(id); expect(h.publish).not.toHaveBeenCalled();
  });
  it("duplicate update requires manual target plus exact revision, default stays skip", async () => {
    h.duplicates = [{ id: 88, revision: 3, partNumber: "LOCAL-0", brand: "LOCAL-BRAND", pkg: "QFN", dateCode: "" }]; await mount(); await pasteRows();
    expect(host.querySelector<HTMLSelectElement>('[aria-label="第2行重复策略"]')?.value).toBe("skip"); await select("第2行重复策略", "update"); expect(host.querySelector<HTMLInputElement>('[aria-label="确认第2行"]')?.disabled).toBe(true);
    await select("第2行更新目标", "88"); await confirmValid(); await click(button("导入已确认有效行（1）")); expect(h.importRows.mock.calls[0][0].rows[0]).toMatchObject({ duplicatePolicy: "update", duplicateId: 88, expectedRevision: 3 });
  });
  it("multiple/unmatched metadata remains manual; explicit choice never changes trading data", async () => {
    h.matchStatus = "multiple"; h.suggestions = [{ partNumber: "CHOSEN", brand: "CHOSEN-BRAND", pkg: "SOT" }]; await mount(); await pasteRows(); expect(host.textContent).toContain("多个候选");
    expect(host.querySelector(".mall-preview-table")?.textContent).toContain("LOCAL-0"); await select("第2行资料匹配", "0"); await confirmValid(); await click(button("导入已确认有效行（1）")); expect(h.importRows.mock.calls[0][0].rows[0].data).toMatchObject({ partNumber: "CHOSEN", brand: "CHOSEN-BRAND", pkg: "SOT", qtyOnSale: 10, qtyStock: null, priceEx: "1.230000", leadTime: "人工7天" });
  });
  it("allows failed-row correction and never resubmits already successful rows", async () => {
    h.importRows.mockResolvedValueOnce({ success: false, imported: 1, updated: 0, skipped: 0, errors: [{ rowNumber: 3, message: "LOCAL 精确业务拒绝" }], ids: [1000] }); await mount(); await pasteRows(2); await confirmValid(); await click(button("导入已确认有效行（2）"));
    expect(host.textContent).toContain("成功 1"); expect(host.textContent).toContain("LOCAL 精确业务拒绝"); expect(button("下载错误行（1）")).toBeDefined();
    const failure = host.querySelectorAll(".mall-preview-table tbody tr")[1]; await click(button("编辑 / 修正", failure)); await click(button("人工保存并重新校验")); await confirmValid(); await click(button("导入已确认有效行（1）"));
    expect(h.importRows.mock.calls[1][0].rows).toHaveLength(1); expect(h.importRows.mock.calls[1][0].rows[0].rowNumber).toBe(3); expect(h.importRows.mock.calls[1][0].requestId).not.toBe(h.importRows.mock.calls[0][0].requestId);
  });
  it("blocks whole-batch repaste once there is success, allowing only exact failure count", async () => {
    h.importRows.mockResolvedValueOnce({ success: false, imported: 1, updated: 0, skipped: 0, errors: [{ rowNumber: 3, message: "LOCAL conflict" }], ids: [1000] }); await mount(); await pasteRows(2); await confirmValid(); await click(button("导入已确认有效行（2）"));
    await click(button("识别失败行并校验")); expect(host.textContent).toContain("禁止重新上传整批已成功数据"); expect(h.importRows).toHaveBeenCalledOnce();
  });
  it("accepts uncertain supplier rows only after explicit manual mapping/correction", async () => {
    await mount(); await click(button("新增物料")); await click(button("粘贴识别")); enter("粘贴商城物料数据", "UNKNOWN-SKU  UNVERIFIED-BRAND  10K  CHEAP"); await click(button("识别并校验"));
    expect(host.textContent).toContain("无法确定型号列"); expect(button("导入已确认有效行（0）").disabled).toBe(true); expect(h.importRows).not.toHaveBeenCalled();
  });
});

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
describe("P1 scoped reads and complete receipts", () => {
  it("ignores retained shared QueryClient A cache while B status is pending/rejected and rejects late A status", async () => {
    const cache = new QueryClient(); const key = [["officialMall", "list"], { input: { page: 1, pageSize: 30 }, type: "query" }];
    cache.setQueryData(key, { items: [fixture({ partNumber: "A-PRIVATE-CACHE", note: "A-NOTE", priceEx: "999" })] });
    const old = deferred<OfficialMallAccess>(); h.statusRead.mockReturnValueOnce(old.promise);
    await mount(); h.authId = 8; h.access!.scope.adminUserId = 8; const next = deferred<OfficialMallAccess>(); h.statusRead.mockReturnValueOnce(next.promise); await renderAgain();
    expect(host.textContent).not.toContain("A-PRIVATE-CACHE"); expect(h.listRead).not.toHaveBeenCalled();
    await act(async () => old.resolve({ ...h.access!, scope: { ...h.access!.scope, adminUserId: 7 } }));
    expect(h.listRead).not.toHaveBeenCalled();
    await act(async () => next.reject(new Error("B status refused"))); expect(host.textContent).toContain("B status refused"); expect(host.textContent).not.toContain("LOCAL-PART");
    expect(cache.getQueryData(key)).toMatchObject({ items: [{ partNumber: "A-PRIVATE-CACHE" }] }); cache.clear();
  });
  it("team switch hides A list/suggestions/dialog and never accepts late A reads when B list fails", async () => {
    h.suggestions = [{ partNumber: "A-SUGGEST", brand: "A", pkg: "QFN" }]; await mount(); await newForm();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 520)); }); expect(host.textContent).toContain("A-SUGGEST");
    const old = deferred<{ items: OfficialMallMaterial[]; total: number }>(); h.listRead.mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error("B list refused"));
    h.access!.scope.teamId = 4; await click(button("刷新")); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(host.textContent).not.toContain("A-SUGGEST"); expect(host.textContent).not.toContain("LOCAL-PART");
    await act(async () => old.resolve({ items: [fixture({ partNumber: "LATE-A", note: "A-PRIVATE" })], total: 1 }));
    expect(host.textContent).not.toContain("LATE-A"); expect(host.textContent).toContain("B list refused");
  });
  it("actor unknown hold survives team3→4 and late busy end; another actor never sees it and switching back restores UUID", async () => {
    const write = deferred<{ success: boolean; id: number; revision: number; status: "draft" }>(); h.create.mockReturnValueOnce(write.promise); await mount(); await newForm();
    await click(button("保存到待上架")); const id = h.create.mock.calls[0][0].requestId;
    h.access!.scope.teamId = 4; await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => write.resolve({ success: true, id: 909, revision: 1, status: "draft" }));
    expect(host.textContent).toContain(id); expect(readRequestHold("7:4")).toMatchObject({ requestId: id, originalTeamId: 3 }); expect(button("新增物料").disabled).toBe(true);
    h.authId = 8; h.access!.scope.adminUserId = 8; await renderAgain(); expect(host.textContent).not.toContain(id); expect(button("新增物料").disabled).toBe(false);
    h.authId = 7; h.access!.scope.adminUserId = 7; await renderAgain(); expect(host.textContent).toContain(id); expect(button("新增物料").disabled).toBe(true); expect(h.create).toHaveBeenCalledOnce();
  });
  it("zero-coverage 100-row receipt keeps UUID, blocks close and stops subsequent chunk; recovery uses identical guard", async () => {
    const malformed = { success: true, imported: 0, updated: 0, skipped: 0, errors: [], ids: [] }; h.importRows.mockResolvedValueOnce(malformed);
    await mount(); await pasteRows(101); await confirmValid(); await click(button("导入已确认有效行（101）")); const id = h.importRows.mock.calls[0][0].requestId;
    expect(h.importRows).toHaveBeenCalledOnce(); expect(readRequestHold("7:3")?.rowNumbers).toHaveLength(100); expect(button("关闭").disabled).toBe(true); expect(host.textContent).toContain("进度 0 / 101");
    h.receipt.mockResolvedValue({ state: "completed", result: malformed }); await click(button("核对原请求")); expect(readRequestHold("7:3")?.requestId).toBe(id); expect(h.importRows).toHaveBeenCalledOnce();
    h.receipt.mockResolvedValue({ state: "completed", result: { success: true, imported: 0, updated: 0, skipped: 100, errors: [], ids: [] } }); await click(button("核对原请求"));
    expect(readRequestHold("7:3")).toBeNull(); expect(host.textContent).toContain("成功 0 · 跳过 100"); expect(host.querySelector(".mall-preview-table tbody tr")?.textContent).toContain("已处理（详见汇总）");
    await click(button("导入已确认有效行（1）")); expect(h.importRows).toHaveBeenCalledTimes(2); expect(h.importRows.mock.calls[1][0].rows[0].rowNumber).toBe(102);
  });
  it("legacy hold without original proof never unlocks even with plausible completed receipt", async () => {
    storeRequestHold({ kind: "import", requestId: "legacy-no-proof", scopeKey: "7:3", rowNumbers: [2] });
    h.receipt.mockResolvedValue({ state: "completed", result: { success: true, imported: 1, updated: 0, skipped: 0, errors: [], ids: [1000] } }); await mount(); await click(button("核对原请求"));
    expect(readRequestHold("7:3")?.requestId).toBe("legacy-no-proof"); expect(button("新增物料").disabled).toBe(true); expect(host.textContent).toContain("管理员核对");
  });
  it("single wrong ID stays held while complete bulk known-errors are authoritative normal results", async () => {
    h.update.mockResolvedValueOnce({ success: true, id: 909, revision: 5, status: "draft" }); await mount(); await click(button("LOCAL-PART")); await click(button("保存草稿")); expect(readRequestHold("7:3")?.expectedId).toBe(101);
    h.receipt.mockResolvedValue({ state: "completed", result: { success: true, id: 101, revision: 5, status: "draft" } }); await click(button("核对原请求")); expect(readRequestHold("7:3")).toBeNull();
    h.bulk.mockResolvedValueOnce({ success: false, successful: 0, errors: [{ id: 101, message: "版本冲突，明确未上架" }] }); await click(host.querySelector('[aria-label="选择物料 LOCAL-PART 101"]')!); await click(button("批量上架")); await click(button("确认批量上架"));
    expect(readRequestHold("7:3")).toBeNull(); expect(host.textContent).toContain("成功 0，失败 1"); expect(host.textContent).toContain("明确未上架");
  });
});


describe("mall repair minimum input, failure fallback and active team choice",()=>{
  it("does not query one/two characters and coalesces model+brand typing for 500ms",async()=>{
    vi.useFakeTimers();await mount();await click(button("新增物料"));enter("型号","S");
    await act(async()=>{await vi.advanceTimersByTimeAsync(600)});expect(h.suggestRead).not.toHaveBeenCalled();
    enter("型号","ST");await act(async()=>{await vi.advanceTimersByTimeAsync(600)});expect(h.suggestRead).not.toHaveBeenCalled();
    enter("型号","STM");await act(async()=>{await vi.advanceTimersByTimeAsync(300)});enter("品牌","ST");
    await act(async()=>{await vi.advanceTimersByTimeAsync(499)});expect(h.suggestRead).not.toHaveBeenCalled();
    await act(async()=>{await vi.advanceTimersByTimeAsync(1)});expect(h.suggestRead).toHaveBeenCalledOnce();expect(h.suggestRead.mock.calls[0][0]).toEqual({query:"STM",brand:"ST"});
  });
  it("suggest failure still permits manual draft save without publication",async()=>{
    vi.useFakeTimers();h.suggestRead.mockRejectedValue(new Error("offline suggest failure"));await mount();await newForm();
    await act(async()=>{await vi.advanceTimersByTimeAsync(500)});expect(host.textContent).toContain("资料联想暂不可用");expect(button("保存到待上架").disabled).toBe(false);
    await click(button("保存到待上架"));expect(h.create).toHaveBeenCalledOnce();expect(h.create.mock.calls[0][0].data.partNumber).toBe("LOCAL-NEW");expect(h.publish).not.toHaveBeenCalled();
  });
  it("sole active team is visibly auto-selected and sent explicitly",async()=>{
    h.access!.scope={...h.access!.scope,isSuperAdmin:true,teamId:null,teamRole:null};h.access!.teams=[{id:11,name:"LOCAL-OFFICIAL"}];await mount();await newForm();
    const team=host.querySelector<HTMLSelectElement>('[aria-label="归属官方团队"]')!;expect(team.value).toBe("11");expect(team.disabled).toBe(true);expect(host.textContent).toContain("自动选择唯一");
    await click(button("保存到待上架"));expect(h.create.mock.calls[0][0].teamId).toBe(11);expect(h.publish).not.toHaveBeenCalled();
  });
  it("multiple teams require manual valid selection, no team has a precise blocking message",async()=>{
    h.access!.scope={...h.access!.scope,isSuperAdmin:true,teamId:null,teamRole:null};h.access!.teams=[{id:11,name:"ONE"},{id:12,name:"TWO"}];await mount();await newForm();
    expect(button("保存到待上架").disabled).toBe(true);expect(host.textContent).toContain("存在多个官方团队");await select("归属官方团队","12");expect(button("保存到待上架").disabled).toBe(false);
    await click(button("保存到待上架"));expect(h.create.mock.calls[0][0].teamId).toBe(12);
    h.access!.teams=[];await click(button("刷新"));await newForm();expect(host.textContent).toContain("没有有效官方团队");expect(button("保存到待上架").disabled).toBe(true);expect(h.create).toHaveBeenCalledOnce();
  });
});
