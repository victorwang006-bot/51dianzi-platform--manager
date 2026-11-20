// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { BatchUpload, CustomerConfirmRows } from "../channelInventory/BatchUpload";
import { customerUploadRepairPrepareConfirmationSchema, type ConfirmationEntry } from "../../../../shared/customerUploadHistory";
import { canonicalConfirmationPayload } from "./customerUploadHistory";
import type { HistoryDetail } from "./customerUploadHistory";

const rt = vi.hoisted(() => ({ capture: vi.fn(), context: vi.fn(), prepare: vi.fn(), create: vi.fn(), get: vi.fn(), reconcile: vi.fn(), export: vi.fn(), current: true,
  close: vi.fn(), complete: vi.fn(), auth: vi.fn() }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: { useUtils: () => ({ client: { channelInventory: {
  customerSupplyContext: { query: rt.context }, customerUploadRepairPrepareConfirmation: { mutate: rt.prepare }, createCustomerMaterial: { mutate: rt.create },
  customerUploadHistoryGet: { query: rt.get }, customerUploadReconcileBatch: { mutate: rt.reconcile }, customerUploadProblemsExport: { mutate: rt.export },
} } }) } }));
// The actual repair wrapper, canonical helpers, schemas and Radix dialog are real.
// Capture only the reusable T6 queue boundary; invoke its actual supplied handlers.
vi.mock("../channelInventory/BatchUpload", async importOriginal => ({
  ...await importOriginal<typeof import("../channelInventory/BatchUpload")>(),
  BatchUpload: (props: unknown) => { rt.capture(props); return React.createElement("div", { "data-testid": "repair-queue" }, "T6 queue boundary"); },
}));
import { CustomerUploadFailuresDialog } from "./CustomerUploadFailuresDialog";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { enterpriseId: 31, actorUserId: 7, key: "AUTH-REPAIR" };
const expected = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
const batch = { id: 501, customerId: 801, channelId: 11, batchCode: "EXISTING-501", revision: 19 };
const candidate = { partNumber: "BROKEN", brand: "TI", qty: 9, price: "2.500000000001", currency: "CNY" as const, taxIncluded: null, dateCode: "0024", leadTime: null, note: "原备注" };
function ref(n: number) { return { sheetIndex: 3, sheetName: "原工作表", rowNumber: n, originalRowHash: "b".repeat(64) }; }
function entry(n: number, status: ConfirmationEntry["status"] = "unknown"): ConfirmationEntry {
  return { logicalRowId: uuid(n), rowId: uuid(100 + n), rowRequestId: uuid(200 + n), uploadBatchId: 501, sourceRefs: [ref(n + 2)], status,
    payload: { ...expected, customerId: 801, expectedCustomerVersion: 7, channelId: 11, uploadBatchId: 501, requestId: uuid(200 + n), ...candidate },
    ...(status === "success" ? { receipt: { logicalRowId: uuid(n), rowRequestId: uuid(200 + n), uploadBatchId: 501, channelId: 11, customerId: 801, materialId: 9001, materialRevision: 3, status: "success" as const } } : {}) };
}
function fixture(): HistoryDetail { return {
  history: { historyId: uuid(500), customerId: 801, customerName: "授权客户", mode: "standard", state: "partially_imported", revision: 11, batchClosed: false, uploadBatch: batch,
    uploadedBy: { frontUserId: 7, adminAccountId: 1, displayName: "本人" }, createdAt: "2026-11-19T08:00:00Z",
    originalFile: { fileId: uuid(600), kind: "original", fileName: "真实原表.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", byteSize: 3, sha256: "a".repeat(64), createdAt: "2026-11-19T08:00:00Z" },
    latestVersionId: null, latestVersionNo: 0, access: "self", capabilities: { canConfirm: true, canDownload: true, canManage: false, canUploadResult: false, canCancel: true },
    stats: { sourceRowCount: 5, resultRowCount: 0, pendingCount: 0, excludedCount: 3, successCount: 1, unknownCount: 1, failedCount: 0, repairableCount: 1, remainingMaterialCount: 1 } },
  versions: [], selectedVersion: null,
  originalSheets: [{ sheetIndex: 3, sheetName: "原工作表", rows: [
    { rowNumber: 1, cells: ["型号", "品牌", "数量", "报价", "币种", "Date Code", "备注"], originalRowHash: "a".repeat(64), originalContent: "表头" },
    { rowNumber: 4, cells: ["BROKEN", "TI", "bad", "2.500000000001", "CNY", "0024", "原备注"], originalRowHash: "b".repeat(64), originalContent: "完整原行" },
  ] }],
  confirmation: { confirmationId: uuid(700), batchRequestId: uuid(701), versionId: null, createdAt: "2026-11-19T08:00:00Z", batch, batchClosed: false,
    entries: [entry(1, "success"), entry(4)], excludedRows: [
      { logicalRowId: uuid(2), reason: "跳过问题行：数量格式无效", sourceRefs: [ref(4)] },
      { logicalRowId: uuid(3), reason: "用户明确移除", sourceRefs: [ref(5)] },
      { logicalRowId: uuid(4), reason: "跳过问题行：已拥有canonical请求", sourceRefs: [ref(6)] },
    ] },
}; }
let root: Root, host: HTMLDivElement, detail: HistoryDetail;
function queue(): ComponentProps<typeof BatchUpload> { const call = rt.capture.mock.calls.at(-1); if (!call) throw new Error(`Missing repair queue: ${document.body.textContent}`); return call[0]; }
async function render(d = detail) { await act(async () => root.render(React.createElement(CustomerUploadFailuresDialog, { customerId: 801, identity, detail: d,
  isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth }))); }
function review(): CustomerConfirmRows { const props = queue(); const row = structuredClone(props.initialRows![0]); return {
  sessionData: props.sessionData, confirmedDrafts: [{ ...row, draft: { ...row.draft, qty: "9" }, rowRequestId: uuid(800) }], excludedRows: [],
}; }
function batchInput() { return { requestId: uuid(900), channelId: 11, fileName: "repair.xlsx", totalRows: 1 }; }
async function prepare(r = review()) { let result: any; await act(async () => { result = await queue().onCreateCustomerBatch!(batchInput(), r); }); return result; }
function response(input: any) { return { historyId: uuid(500), confirmationId: uuid(700), revision: 12, batch,
  entries: input.rows.map((row: any) => ({ logicalRowId: row.logicalRowId, rowId: uuid(801), rowRequestId: row.rowRequestId, uploadBatchId: 501, sourceRefs: row.sourceRefs, status: "pending",
    payload: { ...expected, customerId: 801, expectedCustomerVersion: 7, requestId: row.rowRequestId, uploadBatchId: 501, channelId: 11, ...row.fields } })) }; }
function button(text: string) { const value = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text); if (!value) throw new Error(`Missing ${text}`); return value; }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true }))); }
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  for (const value of Object.values(rt)) if (typeof value === "function" && "mockReset" in value) value.mockReset(); rt.current = true; detail = fixture();
  rt.context.mockResolvedValue({ customer: { id: 801, version: 7, archivedAt: null }, channel: { id: 11, revision: 5 }, canUpload: true });
  rt.prepare.mockImplementation(async input => response(input)); rt.get.mockResolvedValue(detail);
  rt.create.mockResolvedValue({ item: { id: 909, revision: 1, channelId: 11, uploadBatchId: 501 }, idempotent: false, customerId: 801, channelId: 11, uploadBatchId: 501 });
  rt.export.mockRejectedValue(new Error("offline export")); rt.reconcile.mockRejectedValue(new Error("Unexpected reconcile"));
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("REAL_NETWORK_FORBIDDEN"); }));
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => { throw new Error("REAL_XHR_FORBIDDEN"); });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.replaceChildren(); expect(fetch).not.toHaveBeenCalled(); expect(XMLHttpRequest.prototype.open).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("customer failed-row repair wrapper", () => {
  it("uses a real portal with 90vw/85dvh and fullscreen, passes only genuine skipped rows and original refs to T6", async () => {
    await render(); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!; expect(dialog.style.width).toBe("90vw"); expect(dialog.style.height).toBe("85dvh");
    await click(button("全屏")); expect(dialog.style.width).toBe("100vw"); expect(dialog.style.height).toBe("100dvh"); await click(button("退出全屏"));
    const rows = queue().initialRows!; expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ row: 2, draft: { partNumber: "BROKEN", brand: "TI", qty: "bad" }, metadata: { logicalRowId: uuid(2), sourceRefs: [ref(4)] } });
    expect(rows.map(row => (row.metadata as any).logicalRowId)).not.toContain(uuid(1)); expect(rows.map(row => (row.metadata as any).logicalRowId)).not.toContain(uuid(4));
    expect(queue().skipIssueRows).toBe(false); expect(queue().fixedSource).toBe(true); expect(rt.prepare).not.toHaveBeenCalled();
  });
  it("repairs only the existing batch using customer/history/batch CAS and exact original refs; actual schema accepts the frozen request", async () => {
    await render(); const result = await prepare(); const input = rt.prepare.mock.calls[0][0];
    expect(input).toEqual({ ...expected, historyId: uuid(500), confirmationId: uuid(700), expectedRevision: 11, expectedBatchRevision: 19, expectedCustomerVersion: 7, requestId: uuid(900),
      rows: [{ logicalRowId: uuid(2), rowRequestId: uuid(800), sourceRefs: [ref(4)], fields: candidate }] });
    expect(customerUploadRepairPrepareConfirmationSchema.parse(input)).toEqual(input); expect(result.id).toBe(501);
    expect(rt.context).toHaveBeenCalledWith({ ...expected, customerId: 801 }); expect(rt.create).not.toHaveBeenCalled(); expect(queue().preparedEntries!()).toHaveLength(1);
  });
  it("unknown preparation retries the identical frozen UUID/rows/refs/CAS despite later editor changes", async () => {
    rt.prepare.mockRejectedValueOnce(new Error("lost prepare reply")); await render(); const originalReview = review();
    await expect(prepare(originalReview)).rejects.toThrow("lost prepare reply"); const input = rt.prepare.mock.calls[0][0];
    expect(rt.context).toHaveBeenCalledTimes(2); // initial mounted proof plus fresh pre-write proof
    const changed = structuredClone(originalReview); changed.confirmedDrafts[0].draft.partNumber = "MUST-NOT-RESEND";
    await prepare(changed); expect(rt.prepare.mock.calls[1][0]).toBe(input); expect(rt.context).toHaveBeenCalledTimes(3); expect(input.rows[0].fields.partNumber).toBe("BROKEN");
  });
  it.each(["logical-id", "hash", "row-number"])("rejects forged %s evidence without a repair write", async kind => {
    await render(); const r = review(); const metadata: any = r.confirmedDrafts[0].metadata;
    if (kind === "logical-id") metadata.logicalRowId = uuid(3); if (kind === "hash") metadata.sourceRefs = [{ ...ref(4), originalRowHash: "c".repeat(64) }]; if (kind === "row-number") metadata.sourceRefs = [ref(5)];
    await expect(prepare(r)).rejects.toThrow(kind === "logical-id" ? "原修复确认内容未能核实" : "来源已变化"); expect(rt.prepare).not.toHaveBeenCalled(); expect(rt.create).not.toHaveBeenCalled();
  });
  it("creates only the server-returned canonical entry and refuses an edited payload or another batch", async () => {
    await render(); await prepare(); const saved = queue().preparedEntries!()![0]; const responseEntry = rt.prepare.mock.results[0].value;
    const canonical = (await responseEntry).entries[0]; const wire = canonicalConfirmationPayload(canonical.payload);
    await act(async () => { await queue().onCreate(saved.payload, saved.requestId, 501); });
    const { channelId: _channel, ...input } = wire; expect(rt.create).toHaveBeenCalledTimes(1); expect(rt.create).toHaveBeenCalledWith(input);
    await expect(queue().onCreate({ ...saved.payload, partNumber: "FORGED" }, saved.requestId, 501)).rejects.toThrow("不能改写");
    await expect(queue().onCreate(saved.payload, saved.requestId, 502)).rejects.toThrow("已变化"); expect(rt.create).toHaveBeenCalledTimes(1);
  });
  it.each(["customer", "batch", "canonical-id"])("wrong %s prepare receipt cannot become a create entry", async kind => {
    rt.prepare.mockImplementation(async input => { const value = response(input); if (kind === "customer") value.batch = { ...batch, customerId: 802 }; if (kind === "batch") value.batch = { ...batch, id: 502 }; if (kind === "canonical-id") value.entries[0].payload.requestId = uuid(999); return value; });
    await render(); await expect(prepare()).rejects.toThrow(); expect(rt.create).not.toHaveBeenCalled(); expect(queue().preparedEntries!()).toHaveLength(0);
  });
  it.each([true, undefined])("closed or unproven batchClosed=%s never offers repair queue", async closed => {
    detail.history.batchClosed = closed; await render(); expect(rt.capture).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("该批次已关闭"); expect(rt.prepare).not.toHaveBeenCalled();
  });
  it("recovery validation rejects other batch/channel/session while preserving original request identity", async () => {
    await render(); await prepare(); const props = queue(), session = props.sessionData!, entries = props.preparedEntries!()!;
    expect(props.validateSavedSession!(session, entries)).toBe(true);
    expect(props.validateSavedSession!({ ...(session as object), customerId: 802 }, entries)).toBe(false);
    expect(props.validateSavedSession!(session, [{ ...entries[0], uploadBatchId: 502 }])).toBe(false);
    expect(props.validateSavedSession!(session, [{ ...entries[0], payload: { ...entries[0].payload, channelId: 22 } }])).toBe(false);
  });
  it("unmount during context read prevents a later preparation/write from starting", async () => {
    const pending = deferred(); await render(); rt.context.mockReturnValueOnce(pending.promise);
    const operation = queue().onCreateCustomerBatch!(batchInput(), review());
    const rejected = expect(operation).rejects.toThrow();
    await act(async () => root.unmount()); root = createRoot(host);
    pending.resolve({ customer: { id: 801, version: 7, archivedAt: null }, channel: { id: 11 }, canUpload: true });
    await rejected; expect(rt.prepare).not.toHaveBeenCalled(); expect(rt.create).not.toHaveBeenCalled();
  });
  it.each(["version", "permission"] as const)("unknown preparation cannot retry through a changed %s context or change its original frozen payload", async kind => {
    rt.prepare.mockRejectedValueOnce(new Error("lost reply")); await render(); const original = review();
    await expect(prepare(original)).rejects.toThrow("lost reply"); const frozen = structuredClone(rt.prepare.mock.calls[0][0]);
    rt.context.mockResolvedValue({ customer: { id: 801, version: kind === "version" ? 8 : 7, archivedAt: null }, channel: { id: 11 }, canUpload: kind !== "permission" });
    const changed = structuredClone(original); changed.confirmedDrafts[0].draft.partNumber = "FORGED-RETRY";
    await expect(prepare(changed)).rejects.toThrow(kind === "version" ? "客户版本已变化" : "上传权限已变化");
    expect(rt.prepare).toHaveBeenCalledTimes(1); expect(rt.prepare.mock.calls[0][0]).toEqual(frozen); expect(rt.create).not.toHaveBeenCalled();
  });
  it.each(["revision", "permission", "identity"] as const)("old callbacks stop after props %s changes", async kind => {
    await render(); const oldQueue = queue(), oldReview = review(); const changed = structuredClone(detail);
    if (kind === "revision") changed.history.revision++;
    if (kind === "permission") changed.history.capabilities.canConfirm = false;
    if (kind === "identity") {
      await act(async () => root.render(React.createElement(CustomerUploadFailuresDialog, { customerId: 801, identity: { ...identity, key: "OTHER-AUTH" }, detail: changed,
        isCurrent: () => true, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth })));
    } else await render(changed);
    await expect(oldQueue.onCreateCustomerBatch!(batchInput(), oldReview)).rejects.toThrow();
    expect(rt.prepare).not.toHaveBeenCalled(); expect(rt.create).not.toHaveBeenCalled();
  });
});
