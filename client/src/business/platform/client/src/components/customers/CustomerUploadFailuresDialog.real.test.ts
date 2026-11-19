// @vitest-environment jsdom
// vitest.config.ts includes .test.ts, not .test.tsx. The dialog, T6 and queue are real.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { customerUploadRepairPrepareConfirmationSchema, customerUploadReconcileBatchSchema,
  type ConfirmationEntry, type CustomerUploadRepairPrepareConfirmationInput } from "../../../../shared/customerUploadHistory";
import { createCustomerMaterialSchema } from "../../../../shared/customerSupply";
import { CustomerUploadFailuresDialog } from "./CustomerUploadFailuresDialog";
import { canonicalConfirmationPayload, candidateDraft, type HistoryDetail } from "./customerUploadHistory";
import { fields } from "../channelInventory/import";

const api = vi.hoisted(() => ({ context: vi.fn(), prepare: vi.fn(), create: vi.fn(), get: vi.fn(), reconcile: vi.fn(),
  export: vi.fn(), close: vi.fn(), complete: vi.fn(), auth: vi.fn(), uuid: vi.fn() }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: { useUtils: () => ({ client: { channelInventory: {
  customerSupplyContext: { query: api.context }, customerUploadRepairPrepareConfirmation: { mutate: api.prepare },
  createCustomerMaterial: { mutate: api.create }, customerUploadHistoryGet: { query: api.get },
  customerUploadReconcileBatch: { mutate: api.reconcile }, customerUploadProblemsExport: { mutate: api.export },
} } }) } }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { enterpriseId: 31, actorUserId: 7, key: "AUTH-REAL-REPAIR" };
const expected = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
const batch = { id: 501, customerId: 801, channelId: 11, batchCode: "EXISTING-501", revision: 19 };
const context = { customer: { id: 801, version: 7, archivedAt: null }, channel: { id: 11, revision: 5 }, canUpload: true };
const storageKey = `d51-channel-inventory-batch-v1:7:31:customer:801:${identity.key}:repair:${uuid(500)}`;
const frozenFields = { partNumber: "BROKEN", brand: "ADI", qty: 9, price: "2.500000000001", currency: "CNY" as const,
  taxIncluded: null, dateCode: "0024", leadTime: "3天", note: "已核实备注" };
function ref(rowNumber: number) { return { sheetIndex: 3, sheetName: "原工作表", rowNumber, originalRowHash: "b".repeat(64) }; }
function existingSuccess(): ConfirmationEntry {
  return { logicalRowId: uuid(1), rowId: uuid(101), rowRequestId: uuid(201), uploadBatchId: 501, sourceRefs: [ref(3)], status: "success",
    payload: { ...expected, customerId: 801, expectedCustomerVersion: 7, channelId: 11, uploadBatchId: 501, requestId: uuid(201),
      ...frozenFields, partNumber: "ALREADY-SAVED" },
    receipt: { logicalRowId: uuid(1), rowRequestId: uuid(201), uploadBatchId: 501, channelId: 11, customerId: 801,
      materialId: 9001, materialRevision: 3, status: "success" } };
}
function fixture(): HistoryDetail { return {
  history: { historyId: uuid(500), customerId: 801, customerName: "授权客户", mode: "standard", state: "partially_imported", revision: 11,
    batchClosed: false, uploadBatch: { ...batch }, uploadedBy: { frontUserId: 7, adminAccountId: 1, displayName: "本人" }, createdAt: "2026-11-19T08:00:00Z",
    originalFile: { fileId: uuid(600), kind: "original", fileName: "真实原表.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      byteSize: 3, sha256: "a".repeat(64), createdAt: "2026-11-19T08:00:00Z" }, latestVersionId: null, latestVersionNo: 0, access: "self",
    capabilities: { canConfirm: true, canDownload: true, canManage: false, canUploadResult: false, canCancel: true },
    stats: { sourceRowCount: 3, resultRowCount: 0, pendingCount: 0, excludedCount: 2, successCount: 1, unknownCount: 0,
      failedCount: 0, repairableCount: 2, remainingMaterialCount: 1 } },
  versions: [], selectedVersion: null,
  originalSheets: [{ sheetIndex: 3, sheetName: "原工作表", rows: [
    { rowNumber: 1, cells: ["型号", "品牌", "数量", "报价", "币种", "Date Code", "交期", "备注"], originalRowHash: "a".repeat(64), originalContent: "表头" },
    { rowNumber: 3, cells: ["ALREADY-SAVED", "ADI", "9", "2.500000000001", "CNY", "0024", "3天", "已核实备注"], originalRowHash: "b".repeat(64), originalContent: "已保存原行" },
    { rowNumber: 4, cells: ["BROKEN", "", "bad", "2.500000000001", "CNY", "0024", "", "原备注"], originalRowHash: "b".repeat(64), originalContent: "完整原行4" },
    { rowNumber: 5, cells: ["OTHER-UNCLAIMED", "TI", "bad", "3.000000000001", "CNY", "0025", "", "另一行"], originalRowHash: "b".repeat(64), originalContent: "完整原行5" },
  ] }],
  confirmation: { confirmationId: uuid(700), batchRequestId: uuid(701), versionId: null, createdAt: "2026-11-19T08:00:00Z", batch: { ...batch },
    batchClosed: false, entries: [existingSuccess()], excludedRows: [
      { logicalRowId: uuid(2), reason: "跳过问题行：数量格式无效", sourceRefs: [ref(4)] },
      { logicalRowId: uuid(3), reason: "跳过问题行：数量格式无效", sourceRefs: [ref(5)] },
    ] },
}; }
let root: Root, host: HTMLDivElement, server: HistoryDetail;
let storageWrite: ReturnType<typeof vi.spyOn>;
function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Missing ${label}: ${document.body.textContent}`); return value;
}
function button(text: string) { return required([...document.querySelectorAll<HTMLButtonElement>("button")]
  .find(item => item.textContent?.trim() === text), text); }
function cell(label: string) { return required(document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`), label); }
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
async function input(label: string, value: string) {
  const control = cell(label);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function render(detail = structuredClone(server)) {
  await act(async () => { root.render(React.createElement(CustomerUploadFailuresDialog, { customerId: 801, identity, detail,
    isCurrent: () => true, onClose: api.close, onComplete: api.complete, onAuthorizationError: api.auth })); });
}
async function unmountDialog() { await act(async () => { root.render(null); }); }
async function until(check: () => void) {
  let error: unknown;
  for (let i = 0; i < 40; i++) { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    try { check(); return; } catch (e) { error = e; } }
  throw error;
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function saved() { return JSON.parse(required(sessionStorage.getItem(storageKey), "saved preparation")); }
// Invoke the REAL React element handler, bypassing native disabled dispatch, to test stale callbacks without mocking T6.
function realClickHandler(element: HTMLElement): () => void {
  const key = required(Object.keys(element).find(key => key.startsWith("__reactProps$")), "React DOM props");
  return (element as unknown as Record<string, { onClick: () => void }>)[key].onClick;
}
async function repairFirstRow() {
  await input("核对第2行品牌", "ADI"); await input("核对第2行可供数量", "9");
  await input("核对第2行交期", "3天"); await input("核对第2行备注", "已核实备注");
}
// API fixture represents a durable server commit. It is never a frontend-generated batch/material receipt.
function commitPreparation(raw: unknown) {
  const request = customerUploadRepairPrepareConfirmationSchema.parse(raw);
  const entries: ConfirmationEntry[] = request.rows.map((row, i) => ({ logicalRowId: row.logicalRowId, rowId: uuid(810 + i),
    rowRequestId: row.rowRequestId, uploadBatchId: 501, sourceRefs: structuredClone(row.sourceRefs), status: "pending",
    payload: { ...expected, customerId: 801, expectedCustomerVersion: request.expectedCustomerVersion, channelId: 11,
      uploadBatchId: 501, requestId: row.rowRequestId, ...row.fields } }));
  for (const entry of entries) canonicalConfirmationPayload(entry.payload);
  server.confirmation!.entries.push(...entries);
  server.history.revision = 12; server.history.uploadBatch!.revision = 20; server.confirmation!.batch.revision = 20;
  server.history.stats.repairableCount = server.confirmation!.excludedRows.filter(row => !server.confirmation!.entries.some(e => e.logicalRowId === row.logicalRowId)).length;
  return { historyId: server.history.historyId, confirmationId: server.confirmation!.confirmationId, revision: 12,
    batch: structuredClone(server.history.uploadBatch!), entries: structuredClone(entries) };
}
function serverCreate(raw: unknown) {
  const request = createCustomerMaterialSchema.parse(raw);
  const entry = required(server.confirmation!.entries.find(entry => entry.rowRequestId === request.requestId), "server canonical request");
  const { channelId: _channelId, ...wire } = canonicalConfirmationPayload(entry.payload);
  expect(request).toEqual(wire);
  const wasSuccess = entry.status === "success";
  entry.status = "success";
  entry.receipt = { logicalRowId: entry.logicalRowId, rowRequestId: entry.rowRequestId, uploadBatchId: 501, channelId: 11,
    customerId: 801, materialId: 9100 + server.confirmation!.entries.indexOf(entry), materialRevision: 1, status: "success" };
  return { item: { id: entry.receipt.materialId, revision: entry.receipt.materialRevision, channelId: 11, uploadBatchId: 501 },
    idempotent: wasSuccess, customerId: 801, channelId: 11, uploadBatchId: 501 };
}
function serverReconcile(raw: unknown) {
  expect(customerUploadReconcileBatchSchema.parse(raw)).toMatchObject({ ...expected, historyId: uuid(500), confirmationId: uuid(700) });
  return { history: structuredClone(server.history), batch: structuredClone(server.history.uploadBatch!),
    entries: server.confirmation!.entries.map(({ logicalRowId, rowRequestId, status, receipt }) => ({ logicalRowId, rowRequestId, status, ...(receipt ? { receipt: structuredClone(receipt) } : {}) })) };
}
beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset(); sessionStorage.clear(); server = fixture();
  api.context.mockResolvedValue(context); api.prepare.mockImplementation(async input => commitPreparation(input));
  api.get.mockImplementation(async () => structuredClone(server)); api.create.mockImplementation(async input => serverCreate(input));
  api.reconcile.mockImplementation(async input => serverReconcile(input)); api.export.mockRejectedValue(new Error("Export not expected"));
  api.uuid.mockImplementation(() => webcrypto.randomUUID());
  vi.stubGlobal("crypto", { randomUUID: api.uuid, subtle: webcrypto.subtle });
  vi.stubGlobal("confirm", vi.fn(() => true)); vi.stubGlobal("prompt", vi.fn(() => "本次先排除，保留原行以后修复"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("REAL_NETWORK_FORBIDDEN"); }));
  vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(() => { throw new Error("REAL_XHR_FORBIDDEN"); });
  storageWrite = vi.spyOn(Storage.prototype, "setItem");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { root.unmount(); }); host.remove(); document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled(); expect(XMLHttpRequest.prototype.open).not.toHaveBeenCalled();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear();
});

describe("CustomerUploadFailuresDialog with real Radix, T6, restore and queue", () => {
  it("edits actual invalid cells while context is pending; disabled and old callbacks cannot allocate preparation or store/write before numeric customerVersion", async () => {
    const pendingContext = deferred<typeof context>(); const pendingPrepare = deferred<void>();
    api.context.mockReturnValueOnce(pendingContext.promise);
    api.prepare.mockImplementationOnce(async input => { await pendingPrepare.promise; return commitPreparation(input); });
    await render();
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelectorAll("td.ci-batch-edit-cell")).toHaveLength(fields.length * 2);
    expect(cell("核对第2行品牌").disabled).toBe(false); expect(cell("核对第2行品牌").getAttribute("aria-invalid")).toBe("true");
    expect(cell("核对第2行品牌").closest("td")?.classList.contains("has-cell-error")).toBe(true);
    await repairFirstRow(); await input("核对第3行可供数量", "6");
    expect(cell("核对第2行品牌").value).toBe("ADI"); expect(cell("核对第2行可供数量").value).toBe("9");
    expect(document.querySelectorAll(".has-cell-error")).toHaveLength(0);
    const oldCallback = realClickHandler(button("重新提交")); expect(button("重新提交").disabled).toBe(true);
    await click(button("重新提交")); await act(async () => { oldCallback(); oldCallback(); });
    expect(api.uuid).not.toHaveBeenCalled(); expect(storageWrite).not.toHaveBeenCalled(); expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.create).not.toHaveBeenCalled();
    await act(async () => { pendingContext.resolve(context); }); expect(button("重新提交").disabled).toBe(false);
    // Even after the fresh render, a handler retained from pending context must stay unable to start.
    await act(async () => { oldCallback(); });
    expect(api.uuid).not.toHaveBeenCalled(); expect(storageWrite).not.toHaveBeenCalled(); expect(api.prepare).not.toHaveBeenCalled();
    await click(button("重新提交")); await until(() => expect(api.prepare).toHaveBeenCalledTimes(1));
    const preparation = saved().preparation;
    expect(saved()).toMatchObject({ version: 2, phase: "customer-source", enterpriseId: 31, actorUserId: 7 });
    expect(preparation.sessionData.customerVersion).toBe(7); expect(typeof preparation.sessionData.customerVersion).toBe("number");
    expect(preparation.confirmation.sessionData).toEqual(preparation.sessionData);
    expect(preparation.confirmation.confirmedDrafts[0]).toMatchObject({ draft: candidateDraft(frozenFields), metadata: { logicalRowId: uuid(2), sourceRefs: [ref(4)] } });
    expect(api.prepare.mock.calls[0][0]).toMatchObject({ ...expected, expectedCustomerVersion: 7, rows: [
      { logicalRowId: uuid(2), rowRequestId: preparation.rows[0].requestId, sourceRefs: [ref(4)], fields: frozenFields },
      { logicalRowId: uuid(3), rowRequestId: preparation.rows[1].requestId, sourceRefs: [ref(5)] },
    ] });
    expect(api.create).not.toHaveBeenCalled();
    await act(async () => { pendingPrepare.resolve(); });
    await until(() => expect(document.body.textContent).toContain("全部提交成功")); expect(api.create).toHaveBeenCalledTimes(2);
  });

  it("prepares only the retained excluded row, loses the committed reply, closes/reopens with another unclaimed row, then restores the original canonical UUID/batch without repair_prepare or duplicate success", async () => {
    api.prepare.mockImplementationOnce(async input => { commitPreparation(input); throw new Error("SERVER_COMMITTED_REPLY_LOST"); });
    await render(); await repairFirstRow(); await click(required(document.querySelector('[aria-label="移除原表第3行"]'), "remove second excluded row"));
    expect(prompt).toHaveBeenCalledTimes(1); expect(button("重新提交").disabled).toBe(false);
    await click(button("重新提交")); await until(() => expect(document.body.textContent).toContain("SERVER_COMMITTED_REPLY_LOST"));
    const raw = required(sessionStorage.getItem(storageKey), "version2 frozen preparation"); const preparation = saved().preparation;
    const input = customerUploadRepairPrepareConfirmationSchema.parse(api.prepare.mock.calls[0][0]);
    expect(input.rows).toEqual([{ logicalRowId: uuid(2), rowRequestId: preparation.rows[0].requestId, sourceRefs: [ref(4)], fields: frozenFields }]);
    expect(preparation.confirmation.excludedRows).toEqual([{ row: 3, reason: "本次先排除，保留原行以后修复", metadata: { logicalRowId: uuid(3), sourceRefs: [ref(5)] } }]);
    expect(saved().version).toBe(2); expect(api.create).not.toHaveBeenCalled();
    const originalCanonical = structuredClone(server.confirmation!.entries.find(entry => entry.logicalRowId === uuid(2))!);
    const originalSuccessful = structuredClone(server.confirmation!.entries[0]);
    await click(button("关闭")); expect(api.close).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(storageKey)).toBe(raw); await unmountDialog();
    await render(); expect(document.body.textContent).toContain("1 条失败"); expect(button("恢复原批次")).toBeDefined();
    await click(button("恢复原批次")); expect(document.querySelectorAll(".ci-batch-cell-control")).toHaveLength(0);
    const uuidCountBeforeRetry = api.uuid.mock.calls.length;
    await click(button("继续处理未完成（沿用原请求）"));
    await until(() => expect(document.body.textContent).toContain("全部提交成功"));
    expect(api.prepare).toHaveBeenCalledTimes(1);
    // One reconciliation request UUID is allowed; no fresh batch or row UUID is allocated.
    expect(api.uuid.mock.calls.length - uuidCountBeforeRetry).toBe(1); expect(api.reconcile).toHaveBeenCalledTimes(1);
    expect(api.get.mock.calls[0][0]).toEqual({ ...expected, historyId: uuid(500) });
    const { channelId: _channelId, ...wire } = canonicalConfirmationPayload(originalCanonical.payload);
    expect(api.create.mock.calls).toEqual([[wire]]);
    expect(wire.requestId).toBe(preparation.rows[0].requestId); expect(wire.uploadBatchId).toBe(501);
    expect(document.body.textContent).toContain("EXISTING-501"); expect(server.confirmation!.entries[0]).toEqual(originalSuccessful);
    expect(server.confirmation!.entries.find(entry => entry.logicalRowId === uuid(2))).toMatchObject({
      rowRequestId: originalCanonical.rowRequestId, logicalRowId: originalCanonical.logicalRowId, sourceRefs: originalCanonical.sourceRefs,
      payload: originalCanonical.payload, status: "success" });
    expect(server.confirmation!.entries.some(entry => entry.logicalRowId === uuid(3))).toBe(false);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    await click(button("关闭")); await unmountDialog(); await render();
    expect(cell("核对第2行型号").value).toBe("OTHER-UNCLAIMED"); expect(cell("核对第2行可供数量").value).toBe("bad");
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("restores a still-unclaimed old display row3 as current row2 by logicalId, preserving its original frozen request and source refs", async () => {
    const sessionData = { historyId: uuid(500), confirmationId: uuid(700), customerId: 801, batchId: 501,
      historyRevision: 11, batchRevision: 19, customerVersion: 7 };
    const draft = candidateDraft({ ...frozenFields, partNumber: "OTHER-UNCLAIMED", brand: "TI" });
    const preparation = { requestId: uuid(900), name: "old-row3.xlsx", entryMode: "table", sessionData,
      rows: [{ row: 3, requestId: uuid(823), draft }],
      confirmation: { batchRequestId: uuid(900), sessionData,
        confirmedDrafts: [{ row: 3, rowRequestId: uuid(823), draft, metadata: { logicalRowId: uuid(3), sourceRefs: [ref(5)] } }],
        excludedRows: [{ row: 2, reason: "本次排除", metadata: { logicalRowId: uuid(2), sourceRefs: [ref(4)] } }] } };
    // Another original row is now canonical/claimed; the retained logical row3 is still unclaimed,
    // so its current display index changes from 3 to 2 without changing its original-row evidence.
    const claimed = structuredClone(existingSuccess()); claimed.logicalRowId = uuid(2); claimed.rowRequestId = uuid(202);
    claimed.payload.requestId = uuid(202); claimed.sourceRefs = [ref(4)];
    claimed.receipt = { ...claimed.receipt!, logicalRowId: uuid(2), rowRequestId: uuid(202), materialId: 9002 };
    server.confirmation!.entries.push(claimed);
    sessionStorage.setItem(storageKey, JSON.stringify({ version: 2, phase: "customer-source", enterpriseId: 31, actorUserId: 7, preparation }));
    await render(); expect(document.body.textContent).toContain("1 条失败");
    await click(button("恢复原批次")); const count = api.uuid.mock.calls.length;
    await click(button("继续处理未完成（沿用原请求）"));
    await until(() => expect(document.body.textContent).toContain("全部提交成功"));
    expect(api.prepare.mock.calls).toEqual([[{ ...expected, historyId: uuid(500), confirmationId: uuid(700), expectedRevision: 11,
      expectedBatchRevision: 19, expectedCustomerVersion: 7, requestId: uuid(900), rows: [{ logicalRowId: uuid(3), rowRequestId: uuid(823),
        sourceRefs: [ref(5)], fields: { ...frozenFields, partNumber: "OTHER-UNCLAIMED", brand: "TI" } }] }]]);
    expect(api.create).toHaveBeenCalledTimes(1); expect(api.create.mock.calls[0][0]).toMatchObject({ requestId: uuid(823), uploadBatchId: 501 });
    expect(api.uuid.mock.calls.length - count).toBe(1); // only reconciliation, never a replacement row/batch UUID
    expect(server.confirmation!.entries.find(entry => entry.logicalRowId === uuid(2))).toEqual(claimed);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it.each(["logical-id", "row-request-id", "payload-request-id", "fields", "source-refs", "customer-version", "partial-missing"] as const)(
    "real version2 restore rejects %s canonical evidence before any repair/material write or version1 promotion", async kind => {
      const sessionData = { historyId: uuid(500), confirmationId: uuid(700), customerId: 801, batchId: 501, historyRevision: 11, batchRevision: 19, customerVersion: 7 };
      const rows = [2, 3].map((n, i) => ({ row: i + 2, requestId: uuid(820 + n), draft: candidateDraft({ ...frozenFields, partNumber: `FROZEN-${n}` }) }));
      const confirmation = { batchRequestId: uuid(900), sessionData, confirmedDrafts: rows.map((row, i) => ({ row: row.row,
        rowRequestId: row.requestId, draft: row.draft, metadata: { logicalRowId: uuid(i + 2), sourceRefs: [ref(i + 4)] } })), excludedRows: [] };
      const preparation = { requestId: uuid(900), name: "old-immutable-repair.xlsx", entryMode: "table", sessionData, confirmation, rows };
      const request: CustomerUploadRepairPrepareConfirmationInput = { ...expected, historyId: uuid(500), confirmationId: uuid(700), expectedRevision: 11,
        expectedBatchRevision: 19, expectedCustomerVersion: 7, requestId: uuid(900), rows: rows.map((row, i) => ({ logicalRowId: uuid(i + 2),
          rowRequestId: row.requestId, sourceRefs: [ref(i + 4)], fields: { ...frozenFields, partNumber: `FROZEN-${i + 2}` } })) };
      commitPreparation(request);
      // Keep a genuinely unclaimed third excluded row so the reopened dialog still exposes its real T6.
      server.confirmation!.excludedRows.push({ logicalRowId: uuid(4), reason: "跳过问题行：数量格式无效", sourceRefs: [ref(6)] });
      server.originalSheets[0].rows.push({ rowNumber: 6, cells: ["STILL-UNCLAIMED", "TI", "bad", "1", "CNY", "", "", ""], originalRowHash: "b".repeat(64), originalContent: "完整原行6" });
      sessionStorage.setItem(storageKey, JSON.stringify({ version: 2, phase: "customer-source", enterpriseId: 31, actorUserId: 7, preparation }));
      const validNewDetail = structuredClone(server); const entry = server.confirmation!.entries[1];
      if (kind === "logical-id") entry.logicalRowId = uuid(999);
      if (kind === "row-request-id") entry.rowRequestId = uuid(999);
      if (kind === "payload-request-id") entry.payload.requestId = uuid(999);
      if (kind === "fields") entry.payload.price = "2.500000000002";
      if (kind === "source-refs") entry.sourceRefs = [{ ...ref(4), originalRowHash: "c".repeat(64) }];
      if (kind === "customer-version") entry.payload.expectedCustomerVersion = 8;
      // The first row matches exactly; the second is absent. Never accept a matching partial subset.
      if (kind === "partial-missing") server.confirmation!.entries.splice(2, 1);
      const raw = sessionStorage.getItem(storageKey); storageWrite.mockClear(); api.uuid.mockClear();
      await render(validNewDetail); await click(button("恢复原批次")); await click(button("继续处理未完成（沿用原请求）"));
      await until(() => expect(document.body.textContent).toContain("原修复确认内容未能核实"));
      expect(api.get).toHaveBeenCalledTimes(1); expect(api.get).toHaveBeenCalledWith({ ...expected, historyId: uuid(500) });
      expect(api.prepare).not.toHaveBeenCalled(); expect(api.create).not.toHaveBeenCalled(); expect(api.reconcile).not.toHaveBeenCalled();
      expect(api.uuid).not.toHaveBeenCalled(); expect(sessionStorage.getItem(storageKey)).toBe(raw); expect(saved().version).toBe(2);
      expect(storageWrite.mock.calls.every(([, value]) => JSON.parse(String(value)).version === 2)).toBe(true);
      expect(document.body.textContent).not.toContain("全部提交成功");
    });
});
