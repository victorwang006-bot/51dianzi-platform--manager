// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { BatchUpload } from "../channelInventory/BatchUpload";
import type { History, HistoryDetail } from "./customerUploadHistory";

const rt = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), download: vi.fn(), reconcile: vi.fn(), mark: vi.fn(), result: vi.fn(), original: vi.fn(), prepare: vi.fn(), create: vi.fn(), batch: vi.fn(), context: vi.fn(), upload: vi.fn(), close: vi.fn(), complete: vi.fn(), auth: vi.fn(), current: true }));
vi.mock("wouter", () => ({ useLocation: () => ["/customers", vi.fn()] }));
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({ storageScope: "compact-history", officialInventoryPermissions: { read: true, write: true, note: true } }) }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: { useUtils: () => ({ channelInventory: { listTeamMaterials: { invalidate: vi.fn() }, listChannels: { invalidate: vi.fn() }, listUploadBatches: { invalidate: vi.fn() } }, client: { channelInventory: { customerUploadHistoryList: { query: rt.list }, customerUploadHistoryGet: { query: rt.get }, customerUploadDownload: { mutate: rt.download }, customerUploadReconcileBatch: { mutate: rt.reconcile }, customerUploadManageMark: { mutate: rt.mark }, customerUploadResult: { mutate: rt.result }, customerUploadOriginal: { mutate: rt.original }, customerUploadPrepareConfirmation: { mutate: rt.prepare }, createCustomerMaterial: { mutate: rt.create }, createCustomerUploadBatch: { mutate: rt.batch }, customerSupplyContext: { query: rt.context } } } }), customerDemand: { suggestPartNumbers: { useQuery: () => ({ data: [], isFetching: false, isError: false }) } } } }));
// Keep the actual Supply wrapper: capture its BatchUpload contract without running a queue.
vi.mock("../channelInventory/BatchUpload", async () => {
  const { createElement } = await import("react");
  return { batchUploadDialogStyle: {}, BatchUpload: (props: unknown) => { rt.upload(props); return createElement("div", { "data-testid": "resumed-upload" }, "原记录导入"); } };
});
import { CustomerUploadHistoryDialog } from "./CustomerUploadHistoryDialog";
import { CustomerSupplyUploadDialog } from "./CustomerSupplyUploadDialog";
import { customerSupplySessionSuffix } from "./customerSupply";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const identity = { enterpriseId: 31, actorUserId: 7, key: "verified-compact" };
const expected = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
const id = "11111111-1111-4111-8111-111111111111";
const otherId = "99999999-9999-4999-8999-999999999999";
const fileId = "22222222-2222-4222-8222-222222222222";
const confirmationId = "33333333-3333-4333-8333-333333333333";
const batchRequestId = "44444444-4444-4444-8444-444444444444";
const rowRequestId = "55555555-5555-4555-8555-555555555555";
const operationKey = `customer-upload-history-operation:${customerSupplySessionSuffix(identity, 801)}`;
function history(changes: Partial<History> = {}): History {
  return { historyId: id, customerId: 801, customerName: "当前客户", mode: "standard", state: "awaiting_confirmation", revision: 4, uploadedBy: { frontUserId: 7, adminAccountId: 1, displayName: "真实上传人" }, createdAt: "2026-11-15T12:00:00+08:00", originalFile: { fileId, kind: "original", fileName: "原库存.csv", mimeType: "text/csv", byteSize: 3, sha256: "a".repeat(64), createdAt: "2026-11-15T12:00:00+08:00" }, latestVersionId: null, latestVersionNo: 0, access: "self", stats: { sourceRowCount: 6, resultRowCount: 0, pendingCount: 0, excludedCount: 0, successCount: 0, unknownCount: 0, failedCount: 0, remainingMaterialCount: 0 }, capabilities: { canDownload: true, canManage: true, canUploadResult: true, canConfirm: true, canCancel: true }, ...changes };
}
function detail(h = history()): HistoryDetail {
  return { history: h, selectedVersion: null, versions: [], confirmation: null, originalSheets: [{ sheetIndex: 0, sheetName: "库存", rows: Array.from({ length: 6 }, (_, i) => ({ rowNumber: i + 1, originalRowHash: "b".repeat(64), originalContent: i ? "ONE,TI" : "型号,品牌", cells: i ? ["ONE", "TI"] : ["型号", "品牌"] })) }] };
}
function confirmed(): HistoryDetail {
  const h = history({ state: "partially_imported" });
  h.stats.unknownCount = 1;
  const d = detail(h);
  d.confirmation = { confirmationId, batchRequestId, versionId: null, createdAt: h.createdAt, batch: { id: 501, batchCode: "66666666-6666-4666-8666-666666666666", revision: 1, channelId: 411, customerId: 801 }, excludedRows: [], entries: [{ logicalRowId: "77777777-7777-4777-8777-777777777777", rowId: "88888888-8888-4888-8888-888888888888", rowRequestId, uploadBatchId: 501, status: "unknown", payload: { ...expected, customerId: 801, expectedCustomerVersion: 4, channelId: 411, uploadBatchId: 501, requestId: rowRequestId, partNumber: "ONE", brand: "TI", qty: 2, price: "1", currency: "CNY", taxIncluded: true, dateCode: null, leadTime: null, note: null } }] };
  return d;
}
let root: Root | undefined;
function render(element?: React.ReactElement) {
  if (!root) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  act(() => root!.render(element ?? React.createElement(CustomerUploadHistoryDialog, { customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth })));
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
function buttons(text: string) { return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).filter(button => button.textContent?.trim() === text); }
function button(text: string) { const b = buttons(text)[0]; if (!b) throw new Error(`Missing ${text}: ${document.body.textContent}`); return b; }
function click(element: Element) { act(() => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function uploadProps(): ComponentProps<typeof BatchUpload> { return rt.upload.mock.calls.at(-1)![0]; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function assertNoNewWrites() { expect(rt.original).not.toHaveBeenCalled(); expect(rt.batch).not.toHaveBeenCalled(); expect(rt.prepare).not.toHaveBeenCalled(); expect(rt.create).not.toHaveBeenCalled(); }
function assertConfirmationBlocked() {
  expect(Array.from(document.querySelectorAll('[role="alert"]')).some(alert => alert.textContent?.includes("原确认映射已变化"))).toBe(true);
  const actions = [...buttons("继续导入"), ...buttons("继续处理")]; expect(actions.length).toBeGreaterThan(0); actions.forEach(action => { expect(action.disabled).toBe(true); click(action); });
  expect(rt.upload).not.toHaveBeenCalled(); expect(rt.download).not.toHaveBeenCalled(); expect(rt.mark).not.toHaveBeenCalled(); expect(rt.result).not.toHaveBeenCalled(); assertNoNewWrites();
}
beforeEach(() => {
  Object.values(rt).forEach(value => { if (typeof value === "function" && "mockReset" in value) value.mockReset(); });
  rt.current = true; sessionStorage.clear();
  rt.list.mockResolvedValue({ items: [history()], nextCursor: null, canManage: true });
  rt.get.mockResolvedValue(detail());
  rt.download.mockResolvedValue({ fileName: "原库存.csv", mimeType: "text/csv", byteSize: 3, base64: btoa("abc") });
  rt.context.mockResolvedValue({ customer: { id: 801, name: "当前客户", version: 4, industryCode: "electronic_components", archivedAt: null }, channel: null, canUpload: true, disabledReason: null });
  rt.mark.mockResolvedValue({ history: history(), idempotent: false });
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("compact upload history", () => {
  it("shows pending review and an em dash, never the six raw rows or v0/UUID/duplicate customer/actor IDs", async () => {
    render(); await settle();
    const row = document.querySelector(".history-list tbody tr")!;
    expect(row.children[4].textContent).toBe("待核对"); expect(row.children[5].textContent).toBe("—");
    expect(row.textContent).toContain("真实上传人"); expect(row.textContent).not.toMatch(/当前客户|#7|#801|成功0|待确认0|v0|独立历史/);
    expect(row.textContent).not.toContain(id); expect(document.querySelector("h2")?.textContent).toBe("上传记录");
    expect(button("刷新")).toBeTruthy(); expect(button("下载所选(0)").disabled).toBe(true); expect(button("关闭")).toBeTruthy();
    click(button("详情")); await settle();
    const technical = document.querySelector(".history-technical") as HTMLDetailsElement;
    expect(technical.open).toBe(false); expect(technical.textContent).toContain(id); expect(technical.textContent).toContain("含表头，非库存条数"); expect(technical.textContent).toContain("v0");
  });
  it("keeps important failed/cancelled states and actual unknown counts", async () => {
    const unknown = confirmed().history;
    rt.list.mockResolvedValue({ items: [history({ state: "parse_failed" }), history({ historyId: otherId, state: "cancelled" }), { ...unknown, historyId: confirmationId }], nextCursor: null, canManage: true });
    render(); await settle();
    expect(document.querySelector(".history-list")?.textContent).toContain("解析失败"); expect(document.querySelector(".history-list")?.textContent).toContain("已取消"); expect(document.querySelector(".history-list")?.textContent).toContain("1条待核实");
  });
  it("only retains customer names in management view and never impersonates the selected uploader", async () => {
    render(); await settle(); click(button("解析管理")); await settle();
    expect(document.querySelector(".history-list")?.textContent).toContain("当前客户"); expect(rt.list.mock.calls.at(-1)![0]).toMatchObject({ ...expected, view: "management" }); expect(rt.list.mock.calls.at(-1)![0]).not.toHaveProperty("customerId");
  });
  it("gets fresh authorization before download then resumes the original file/history without new records", async () => {
    const fresh = detail(history({ revision: 5 })); rt.get.mockResolvedValue(fresh);
    const authorization = deferred<HistoryDetail>(); rt.get.mockImplementationOnce(() => authorization.promise);
    render(); await settle(); click(button("继续导入"));
    expect(rt.get.mock.calls[0][0]).toEqual({ ...expected, historyId: id }); expect(rt.download).not.toHaveBeenCalled(); expect(rt.upload).not.toHaveBeenCalled();
    expect(button("继续导入").disabled).toBe(true); expect(button("详情").disabled).toBe(true); expect(button("刷新").disabled).toBe(true);
    await act(async () => { authorization.resolve(fresh); }); await settle();
    expect(rt.download.mock.calls[0][0]).toEqual({ ...expected, files: [{ historyId: id, fileId }], includeManifest: false });
    const p = uploadProps(); expect(p.initialFile).toBeInstanceOf(File); expect(p.initialFile?.name).toBe("原库存.csv"); expect(p.sessionData).toMatchObject({ customerId: 801, history: { historyId: id, revision: 5, originalFile: fresh.history.originalFile } });
    // The actual unchanged Supply wrapper must skip persistOriginal for this exact File.
    let attachment: unknown;
    await act(async () => { attachment = await p.onOriginalFilePersist!(p.initialFile!); });
    expect(attachment).toMatchObject({ sessionData: { history: { historyId: id } } }); assertNoNewWrites();
  });
  it("never exposes direct confirm action to a server-denied manager", async () => {
    const h = history({ uploadedBy: { frontUserId: 12, adminAccountId: 2, displayName: "其他上传人" }, access: "enterprise_manager", capabilities: { ...history().capabilities, canConfirm: false } });
    rt.list.mockResolvedValue({ items: [h], nextCursor: null, canManage: true }); rt.get.mockResolvedValue(detail(h)); render(); await settle();
    expect(buttons("继续导入")).toHaveLength(0); click(button("详情")); await settle(); expect(buttons("继续导入")).toHaveLength(0); expect(document.body.textContent).toContain("当前账号不可正式确认"); assertNoNewWrites();
  });
  it("fails closed when fresh service authorization was revoked", async () => {
    rt.get.mockResolvedValue(detail(history({ capabilities: { ...history().capabilities, canConfirm: false } })));
    render(); await settle(); click(button("继续导入")); await settle();
    expect(rt.download).not.toHaveBeenCalled(); expect(rt.reconcile).not.toHaveBeenCalled(); expect(rt.upload).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("当前账号不可确认"); assertNoNewWrites();
  });
  it("does not make parse-without-result confirmable even if a bad capability says yes", async () => {
    const h = history({ mode: "parse" }); rt.list.mockResolvedValue({ items: [h], nextCursor: null, canManage: true }); rt.get.mockResolvedValue(detail(h));
    render(); await settle(); expect(buttons("继续导入")).toHaveLength(0); click(button("详情")); await settle(); expect(buttons("继续导入")).toHaveLength(0); assertNoNewWrites();
  });
  it("blocks a fresh parse-without-result after a standard list action", async () => {
    rt.get.mockResolvedValue(detail(history({ mode: "parse" }))); render(); await settle(); click(button("继续导入")); await settle();
    expect(rt.download).not.toHaveBeenCalled(); expect(rt.upload).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("解析结果尚未就绪");
  });
  it("reconciles confirmation then passes the original request IDs, payload and unknown status to Supply recovery", async () => {
    const d = confirmed(); rt.list.mockResolvedValue({ items: [d.history], nextCursor: null, canManage: true }); rt.get.mockResolvedValue(d);
    rt.reconcile.mockResolvedValue({ history: d.history, entries: d.confirmation!.entries, batch: d.confirmation!.batch });
    render(); await settle(); click(button("继续处理")); await settle();
    expect(rt.get).toHaveBeenCalledTimes(2); expect(rt.reconcile).toHaveBeenCalledTimes(1); expect(rt.get.mock.invocationCallOrder[0]).toBeLessThan(rt.reconcile.mock.invocationCallOrder[0]); expect(rt.reconcile.mock.invocationCallOrder[0]).toBeLessThan(rt.get.mock.invocationCallOrder[1]);
    expect(rt.reconcile.mock.calls[0][0]).toMatchObject({ ...expected, historyId: id, confirmationId });
    const recovery = uploadProps().initialRecovery!; expect(recovery.uploadBatch).toMatchObject({ requestId: batchRequestId, id: 501, batchCode: d.confirmation!.batch.batchCode }); expect(recovery.entries[0]).toMatchObject({ requestId: rowRequestId, status: "unknown", payload: d.confirmation!.entries[0].payload, uploadBatchId: 501 });
    expect(rt.download).not.toHaveBeenCalled(); assertNoNewWrites();
  });
  it("labels a versionless frozen pending record as continue processing, not a new import", async () => {
    const h = history(); h.stats.pendingCount = 1;
    rt.list.mockResolvedValue({ items: [h], nextCursor: null, canManage: true });
    render(); await settle(); expect(buttons("继续导入")).toHaveLength(0); expect(button("继续处理")).toBeTruthy();
  });
  it("does not reconcile a confirmation before fresh canConfirm authorization", async () => {
    const d = confirmed(); d.history.capabilities.canConfirm = false; rt.get.mockResolvedValue(d);
    render(); await settle(); click(button("继续导入")); await settle(); expect(rt.reconcile).not.toHaveBeenCalled(); expect(rt.upload).not.toHaveBeenCalled(); assertNoNewWrites();
  });
  it("does not rebuild when confirmation mapping disappears after reconciliation", async () => {
    const d = confirmed(); rt.list.mockResolvedValue({ items: [d.history], nextCursor: null, canManage: true }); rt.get.mockResolvedValueOnce(d).mockResolvedValueOnce(detail()); rt.reconcile.mockResolvedValue({ history: d.history, entries: [], batch: d.confirmation!.batch });
    render(); await settle(); click(button("继续处理")); await settle(); expect(document.body.textContent).toContain("原确认映射已变化"); expect(rt.upload).not.toHaveBeenCalled(); expect(rt.download).not.toHaveBeenCalled(); assertNoNewWrites();
  });
  it("retains the witnessed detail and blocks all entry points when detail reconciliation loses confirmation", async () => {
    const d = confirmed(); rt.get.mockResolvedValueOnce(d).mockResolvedValue(detail());
    rt.reconcile.mockResolvedValue({ history: d.history, entries: [], batch: d.confirmation!.batch });
    render(); await settle(); click(document.querySelector('input[type="checkbox"]')!); click(button("详情")); await settle();
    expect(rt.get).toHaveBeenCalledTimes(2); expect(rt.reconcile).toHaveBeenCalledTimes(1);
    expect(rt.get.mock.invocationCallOrder[0]).toBeLessThan(rt.reconcile.mock.invocationCallOrder[0]); expect(rt.reconcile.mock.invocationCallOrder[0]).toBeLessThan(rt.get.mock.invocationCallOrder[1]);
    expect(document.querySelector(".history-detail")?.textContent).toContain(confirmationId); expect(document.querySelector('[aria-label="回传整理结果"]')).toBeNull();
    expect(button("下载原文件").disabled).toBe(true); click(button("下载原文件")); expect(button("下载所选(1)").disabled).toBe(true); click(button("下载所选(1)"));
    expect(button("标记解析中").disabled).toBe(true); click(button("标记解析中")); assertConfirmationBlocked();
    click(button("刷新")); await settle(); expect(document.body.textContent).toContain("刷新列表或详情不会解除阻断"); assertConfirmationBlocked();
    click(button("详情")); await settle(); expect(rt.reconcile).toHaveBeenCalledTimes(1); expect(document.querySelector(".history-detail")?.textContent).toContain(confirmationId); assertConfirmationBlocked();
  });
  it.each([
    ["confirmation ID", (d: HistoryDetail) => { d.confirmation!.confirmationId = otherId; }],
    ["batch request ID", (d: HistoryDetail) => { d.confirmation!.batchRequestId = otherId; }],
    ["batch ID", (d: HistoryDetail) => { d.confirmation!.batch.id = 502; d.confirmation!.entries[0].uploadBatchId = 502; d.confirmation!.entries[0].payload.uploadBatchId = 502; }],
    ["batch code", (d: HistoryDetail) => { d.confirmation!.batch.batchCode = otherId; }],
    ["channel", (d: HistoryDetail) => { d.confirmation!.batch.channelId = 412; d.confirmation!.entries[0].payload.channelId = 412; }],
    ["customer", (d: HistoryDetail) => { d.history.customerId = 802; d.confirmation!.batch.customerId = 802; d.confirmation!.entries[0].payload.customerId = 802; }],
    ["version ID", (d: HistoryDetail) => { d.confirmation!.versionId = otherId; }],
    ["row request identity with the same material payload", (d: HistoryDetail) => { d.confirmation!.entries[0].rowRequestId = otherId; d.confirmation!.entries[0].payload.requestId = otherId; }],
    ["logical row ID", (d: HistoryDetail) => { d.confirmation!.entries[0].logicalRowId = otherId; }],
    ["row ID", (d: HistoryDetail) => { d.confirmation!.entries[0].rowId = otherId; }],
    ["missing frozen entry", (d: HistoryDetail) => { d.confirmation!.entries = []; }],
    ["frozen payload", (d: HistoryDetail) => { d.confirmation!.entries[0].payload.qty = 3; }],
    ["payload request mismatch", (d: HistoryDetail) => { d.confirmation!.entries[0].payload.requestId = otherId; }],
  ] as const)("blocks changed %s after a detail reconciliation without replacing the original detail", async (_label, change) => {
    const d = confirmed(); const changed = structuredClone(d); change(changed);
    rt.get.mockResolvedValueOnce(d).mockResolvedValue(changed); rt.reconcile.mockResolvedValue({ history: d.history, entries: [], batch: d.confirmation!.batch });
    render(); await settle(); click(button("详情")); await settle();
    expect(document.querySelector(".history-detail")?.textContent).toContain(confirmationId); expect(document.querySelector(".history-detail")?.textContent).toContain(d.confirmation!.batch.batchCode);
    assertConfirmationBlocked(); expect(button("下载原文件").disabled).toBe(true); expect(document.querySelector('[aria-label="回传整理结果"]')).toBeNull();
  });
  it.each(["list", "detail"])("blocks confirmation loss in a later fresh continue read from the %s entry point", async entry => {
    const d = confirmed(); rt.get.mockResolvedValueOnce(d).mockResolvedValueOnce(d).mockResolvedValue(detail()); rt.reconcile.mockResolvedValue({ history: d.history, entries: [], batch: d.confirmation!.batch });
    render(); await settle(); click(button("详情")); await settle(); expect(buttons("继续处理")).toHaveLength(2);
    click(buttons("继续处理")[entry === "list" ? 0 : 1]); await settle();
    expect(rt.get).toHaveBeenCalledTimes(3); expect(rt.reconcile).toHaveBeenCalledTimes(1); assertConfirmationBlocked();
  });
  it("keeps the witness across a failed continue operation, then blocks a fresh null retry", async () => {
    const d = confirmed(); rt.get.mockResolvedValueOnce(d).mockResolvedValue(detail()); rt.reconcile.mockRejectedValue(new Error("核实回复丢失"));
    render(); await settle(); click(button("继续导入")); await settle(); expect(document.body.textContent).toContain("核实回复丢失");
    expect(button("继续处理").disabled).toBe(false); click(button("继续处理")); await settle();
    expect(rt.get).toHaveBeenCalledTimes(2); expect(rt.reconcile).toHaveBeenCalledTimes(1); assertConfirmationBlocked();
  });
  it("keeps per-history witnesses when details switch and a management view returns a changed customer", async () => {
    const d = confirmed(); const other = detail(history({ historyId: otherId })); const changed = structuredClone(d);
    changed.history.customerId = 802; changed.confirmation!.batch.customerId = 802; changed.confirmation!.entries[0].payload.customerId = 802;
    rt.list.mockResolvedValue({ items: [d.history, other.history], nextCursor: null, canManage: true });
    rt.get.mockResolvedValueOnce(d).mockResolvedValueOnce(d).mockResolvedValueOnce(other).mockResolvedValue(changed); rt.reconcile.mockResolvedValue({ history: d.history, entries: [], batch: d.confirmation!.batch });
    render(); await settle(); click(buttons("详情")[0]); await settle(); click(buttons("详情")[1]); await settle(); click(button("解析管理")); await settle(); click(buttons("详情")[0]); await settle();
    expect(document.querySelector(".history-detail")?.textContent).toContain(otherId); expect(button("继续处理").disabled).toBe(true);
    expect(buttons("继续导入")).toHaveLength(2); buttons("继续导入").forEach(action => expect(action.disabled).toBe(false));
    expect(document.body.textContent).toContain("原确认映射已变化"); expect(rt.reconcile).toHaveBeenCalledTimes(1); expect(rt.download).not.toHaveBeenCalled(); assertNoNewWrites();
  });
  it.each(["pending", "unknown"] as const)("allows original confirmation %s to success with a real receipt and changed revisions", async initialStatus => {
    const d = confirmed(); d.confirmation!.entries[0].status = initialStatus; const successful = structuredClone(d);
    successful.history.revision++; successful.history.state = "imported"; successful.history.stats.unknownCount = 0; successful.history.stats.successCount = 1; successful.confirmation!.batch.revision++;
    const e = successful.confirmation!.entries[0]; e.status = "success"; e.receipt = { logicalRowId: e.logicalRowId, rowRequestId: e.rowRequestId, uploadBatchId: 501, channelId: 411, customerId: 801, materialId: 601, materialRevision: 1, status: "success" };
    // Server property ordering is not a new payload/request identity.
    e.payload = Object.fromEntries(Object.entries(e.payload).reverse()) as typeof e.payload;
    rt.get.mockResolvedValueOnce(d).mockResolvedValue(successful); rt.reconcile.mockResolvedValue({ history: successful.history, entries: [], batch: successful.confirmation!.batch });
    render(); await settle(); click(button("详情")); await settle(); expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(button("继续处理").disabled).toBe(false); click(buttons("继续处理")[1]); await settle();
    expect(rt.get).toHaveBeenCalledTimes(4); expect(rt.reconcile).toHaveBeenCalledTimes(2); expect(rt.download).not.toHaveBeenCalled();
    const recovery = uploadProps().initialRecovery!; expect(recovery.uploadBatch).toMatchObject({ requestId: batchRequestId, id: 501 });
    expect(recovery.entries[0]).toMatchObject({ requestId: rowRequestId, status: "success", payload: d.confirmation!.entries[0].payload, receipt: { item: { id: 601, channelId: 411, uploadBatchId: 501 } } }); assertNoNewWrites();
  });
  it("blocks wrong history/customer ownership before download", async () => {
    rt.get.mockResolvedValue(detail(history({ historyId: otherId, customerId: 802 }))); render(); await settle(); click(button("继续导入")); await settle(); expect(document.body.textContent).toContain("归属不匹配"); expect(rt.download).not.toHaveBeenCalled(); assertNoNewWrites();
  });
  it("disables list actions while loading details and prevents another read in the same turn", async () => {
    const read = deferred<HistoryDetail>(); rt.get.mockImplementationOnce(() => read.promise); render(); await settle();
    act(() => { button("详情").click(); button("详情").click(); });
    expect(rt.get).toHaveBeenCalledTimes(1); expect(button("继续导入").disabled).toBe(true); expect(button("详情").disabled).toBe(true); expect(button("刷新").disabled).toBe(true); expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    click(button("关闭")); expect(rt.close).not.toHaveBeenCalled(); await act(async () => { read.resolve(detail()); }); await settle();
  });
  it("pending recovery disables list actions and retries only the original UUID/CAS", async () => {
    const input = { ...expected, historyId: id, expectedRevision: 4, requestId: rowRequestId, action: "fail_parse", reason: "原表待核实" }; sessionStorage.setItem(operationKey, JSON.stringify({ kind: "mark", input }));
    render(); await settle(); expect(button("继续导入").disabled).toBe(true); expect(button("详情").disabled).toBe(true); expect(button("刷新").disabled).toBe(true); expect(button("筛选").disabled).toBe(true);
    click(button("继续导入")); expect(rt.get).not.toHaveBeenCalled(); expect(rt.download).not.toHaveBeenCalled(); expect(document.body.textContent).toContain(rowRequestId);
    click(button("按原操作UUID重试（不换版本／任务）")); await settle(); expect(rt.mark.mock.calls[0][0]).toEqual(input); expect(sessionStorage.getItem(operationKey)).toBeNull(); assertNoNewWrites();
  });
  it("malformed recovery remains blocked without removing or replacing the original record", async () => {
    sessionStorage.setItem(operationKey, "not-json"); render(); await settle(); expect(button("继续导入").disabled).toBe(true); click(button("继续导入")); expect(rt.get).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("原操作恢复记录无效"); expect(sessionStorage.getItem(operationKey)).toBe("not-json"); assertNoNewWrites();
  });
  it("keeps dirty drafts before direct review or closing", async () => {
    render(); await settle(); click(button("详情")); await settle(); const reason = document.querySelector<HTMLTextAreaElement>('[aria-label="历史操作原因"]')!;
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(reason, "未保存草稿"); reason.dispatchEvent(new Event("input", { bubbles: true })); });
    buttons("继续导入").forEach(b => expect(b.disabled).toBe(true)); vi.mocked(window.confirm).mockReturnValue(false); click(button("关闭")); expect(rt.close).not.toHaveBeenCalled(); assertNoNewWrites();
  });
  it("normal upload stays in Supply and never opens the history list", async () => {
    render(React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth })); await settle(); expect(rt.upload).toHaveBeenCalled(); expect(rt.list).not.toHaveBeenCalled(); expect(rt.get).not.toHaveBeenCalled(); expect(uploadProps().initialFile).toBeUndefined();
  });
});
