// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { BatchUpload, CustomerConfirmRows } from "../channelInventory/BatchUpload";
import type { History, HistoryDetail } from "./customerUploadHistory";

const rt = vi.hoisted(() => ({ context: vi.fn(), get: vi.fn(), prepare: vi.fn(), create: vi.fn(), batch: vi.fn(), upload: vi.fn(), close: vi.fn(), auth: vi.fn(), channel: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/customers", vi.fn()] }));
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({ storageScope: "customer-bound", officialInventoryPermissions: { read: true, write: true, note: true } }) }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: { useUtils: () => ({ channelInventory: { listTeamMaterials: { invalidate: vi.fn() }, listChannels: { invalidate: vi.fn() }, listUploadBatches: { invalidate: vi.fn() } }, client: { channelInventory: { customerSupplyContext: { query: rt.context }, customerUploadHistoryGet: { query: rt.get }, customerUploadPrepareConfirmation: { mutate: rt.prepare }, createCustomerMaterial: { mutate: rt.create }, createCustomerUploadBatch: { mutate: rt.batch }, getChannel: { query: rt.channel } } } }) } }));
vi.mock("../channelInventory/BatchUpload", () => ({ batchUploadDialogStyle: {}, BatchUpload: (props: ComponentProps<typeof BatchUpload>) => { rt.upload(props); return React.createElement("div", { "data-testid": "bound-upload" }, props.renderConfirmationDetails?.()); } }));
import { CustomerSupplyUploadDialog } from "./CustomerSupplyUploadDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const identity = { enterpriseId: 31, actorUserId: 7, key: "customer-bound-auth" };
const expected = { expectedEnterpriseId: 31, expectedActorUserId: 7 };
const fields = { partNumber: "ONE", brand: "TI", qty: 2, price: "12.345", currency: "CNY" as const, taxIncluded: true, dateCode: null, leadTime: null, note: null };
const draft = { partNumber: "ONE", brand: "TI", qty: "2", price: "12.345", currency: "CNY", taxIncluded: "true", dateCode: "", leadTime: "", note: "" };
function context(type?: "factory" | "agent" | "trade" | "other") {
  return { customer: { id: 801, name: "绑定客户", version: 4, industryCode: "electronic_components", archivedAt: null }, channel: type ? { id: 411, active: true, revision: 8, type } : null, canUpload: true, disabledReason: null };
}
function detail(): HistoryDetail {
  const history: History = { historyId: randomUUID(), customerId: 801, customerName: "绑定客户", mode: "standard", state: "awaiting_confirmation", revision: 4, uploadedBy: { frontUserId: 7, adminAccountId: 1, displayName: "员工" }, createdAt: "2026-11-19T11:00:00Z", originalFile: { fileId: randomUUID(), kind: "original", fileName: "source.csv", mimeType: "text/csv", byteSize: 20, sha256: "a".repeat(64), createdAt: "2026-11-19T11:00:00Z" }, latestVersionId: null, latestVersionNo: 0, access: "self", stats: { sourceRowCount: 2, resultRowCount: 0, pendingCount: 0, excludedCount: 0, successCount: 0, unknownCount: 0, failedCount: 0, remainingMaterialCount: 0 }, capabilities: { canConfirm: true, canDownload: true, canManage: false, canUploadResult: false, canCancel: true } };
  return { history, selectedVersion: null, versions: [], confirmation: null, originalSheets: [{ sheetIndex: 0, sheetName: "首表", rows: [{ rowNumber: 1, originalRowHash: "b".repeat(64), originalContent: "型号,品牌", cells: ["型号", "品牌"] }, { rowNumber: 2, originalRowHash: "c".repeat(64), originalContent: "ONE,TI", cells: ["ONE", "TI"] }] }] };
}
function confirmation(d: HistoryDetail): CustomerConfirmRows {
  return { batchRequestId: randomUUID(), confirmedDrafts: [{ row: 2, rowRequestId: randomUUID(), draft, metadata: { logicalRowId: randomUUID(), rowId: randomUUID(), issues: [], sourceRefs: [{ sheetIndex: 0, sheetName: "首表", rowNumber: 2, originalRowHash: d.originalSheets[0].rows[1].originalRowHash }] } }], excludedRows: [] };
}
let root: Root | undefined;
function render(d?: HistoryDetail, file?: File) {
  if (!root) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); }
  act(() => root!.render(React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, initialHistory: d, initialFile: file, isCurrent: () => true, onClose: rt.close, onComplete: vi.fn(), onAuthorizationError: rt.auth })));
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function upload(): ComponentProps<typeof BatchUpload> { return rt.upload.mock.calls.at(-1)![0]; }
function click(control: Element) { act(() => control.dispatchEvent(new MouseEvent("click", { bubbles: true }))); }
function input(control: HTMLInputElement, value: string) { act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value); control.dispatchEvent(new Event("input", { bubbles: true })); }); }
beforeEach(() => {
  Object.values(rt).forEach(value => value.mockReset());
  rt.context.mockResolvedValue(context()); rt.prepare.mockRejectedValue(new Error("capture prepare")); sessionStorage.clear(); vi.stubGlobal("crypto", webcrypto);
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("customer-bound source without redundant type selection", () => {
  it("prepares an authorized first upload without a channel or a factory/source profile, retaining header evidence", async () => {
    const d = detail(); const file = new File(["型号,品牌\nONE,TI"], "source.csv"); rt.get.mockResolvedValue(d);
    render(d, file); await settle();
    expect(upload().customerSourceReady).toBe(true); expect(upload().sessionData).not.toHaveProperty("sourceProfile");
    await act(async () => { await upload().onOriginalFilePersist!(file); });
    expect(document.body.textContent).not.toContain("本次首表表头明确不入库"); expect(document.querySelector('[aria-label="核对客户来源类型"]')).toBeNull();
    const c = confirmation(d);
    await act(async () => { await expect(upload().onCreateCustomerBatch!({ fileName: "source.csv", totalRows: 1, requestId: c.batchRequestId }, c)).rejects.toThrow("capture prepare"); });
    const dto = rt.prepare.mock.calls[0][0];
    expect(dto).not.toHaveProperty("sourceProfile"); expect(dto).not.toHaveProperty("expectedChannelId");
    expect(dto).toMatchObject({ ...expected, historyId: d.history.historyId, expectedCustomerVersion: 4, expectedRevision: 4, batchRequestId: c.batchRequestId });
    expect(dto.excludedRows).toHaveLength(1); expect(dto.excludedRows[0]).toMatchObject({ reason: "标准首表第1行为表头，不作为库存入库", sourceRefs: [{ sheetIndex: 0, sheetName: "首表", rowNumber: 1, originalRowHash: "b".repeat(64) }] });
    expect(dto.confirmedRows[0].fields.price).toBe("12.345"); expect(rt.batch).not.toHaveBeenCalled(); expect(rt.create).not.toHaveBeenCalled();
  });
  it.each(["factory", "agent", "trade", "other"] as const)("uses the bound %s source without a type selector or override", async type => {
    rt.context.mockResolvedValue(context(type)); render(detail()); await settle();
    expect(upload().customerSourceReady).toBe(true); expect(upload().customerSourceDisabledReason).toBe("");
    expect(upload().sessionData).toMatchObject({ initialChannelId: 411, initialChannelRevision: 8 }); expect(upload().sessionData).not.toHaveProperty("sourceProfile");
    expect(document.querySelector("select")).toBeNull(); expect(document.body.textContent).not.toContain("本次客户来源渠道类型");
  });
  it("keeps the actual denied permission and no usable upload controls", async () => {
    rt.context.mockResolvedValue({ ...context(), canUpload: false, disabledReason: "真实来源只读：没有库存写权限" }); render(); await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("真实来源只读：没有库存写权限"); expect(rt.upload).not.toHaveBeenCalled(); expect(rt.prepare).not.toHaveBeenCalled();
  });
  it("blocks a real second sheet with a specific reason until its scope is explicitly selected", async () => {
    const d = detail(); d.originalSheets.push({ ...d.originalSheets[0], sheetIndex: 1, sheetName: "第二表" });
    const file = new File(["original"], "source.csv"); rt.get.mockResolvedValue(d); render(d, file); await settle();
    await act(async () => { await upload().onOriginalFilePersist!(file); });
    expect(upload().customerSourceReady).toBe(false); expect(upload().customerSourceDisabledReason).toBe("请明确确认本次仅导入首工作表。");
    const c = confirmation(d);
    await act(async () => { await expect(upload().onCreateCustomerBatch!({ fileName: file.name, totalRows: 1, requestId: c.batchRequestId }, c)).rejects.toThrow("仅导入首表"); });
    expect(rt.prepare).not.toHaveBeenCalled();
    click(document.querySelector('[aria-label="明确确认本次仅导入首工作表"]')!);
    expect(upload().customerSourceReady).toBe(true); expect(upload().customerSourceDisabledReason).toBe("");
    expect((upload().sessionData as any).history.sourceExclusions).toHaveLength(3);
  });
  it("requires a real global explanation but not a source type, preserving that resolution", async () => {
    const d = detail(); const issueId = randomUUID(); d.history.latestVersionId = randomUUID(); d.history.latestVersionNo = 1;
    d.selectedVersion = { versionId: d.history.latestVersionId, versionNo: 1, parentVersionId: null, createdAt: d.history.createdAt, normalizedFile: null, issuesFile: null, rows: [], issues: [{ issueId, rowId: null, field: "other", message: "第二页报价范围未核实", resolved: false, resolution: null }] };
    render(d); await settle(); expect(upload().customerSourceReady).toBe(false); expect(upload().customerSourceDisabledReason).toBe("请解决全局问题：第二页报价范围未核实");
    input(document.querySelector(`[aria-label="核对全局问题${issueId}"]`)!, "员工已核对报价范围");
    expect(upload().customerSourceReady).toBe(true); expect((upload().sessionData as any).history.globalResolutions).toEqual([{ issueId, resolution: "员工已核对报价范围" }]);
    expect(document.querySelector("select")).toBeNull();
  });
  it.each(["factory", "agent", "trade", "other"] as const)("retains the old frozen %s confirmation profile and exact request payload", async type => {
    const d = detail(); const c = confirmation(d); const row = c.confirmedDrafts[0]; const metadata = row.metadata as { logicalRowId: string; rowId: string };
    const originalPayload = { ...expected, ...fields, customerId: 801, expectedCustomerVersion: 4, sourceProfile: { type }, channelId: 411, uploadBatchId: 501, requestId: row.rowRequestId };
    d.confirmation = { confirmationId: randomUUID(), batchRequestId: c.batchRequestId, versionId: null, createdAt: d.history.createdAt, batch: { id: 501, batchCode: randomUUID(), revision: 1, channelId: 411, customerId: 801 }, excludedRows: [], entries: [{ ...metadata, rowRequestId: row.rowRequestId, uploadBatchId: 501, status: "unknown", payload: originalPayload }] };
    rt.context.mockResolvedValue(context(type)); rt.create.mockResolvedValue({ item: { id: 901, channelId: 411, uploadBatchId: 501 }, customerId: 801, channelId: 411, idempotent: false });
    render(d); await settle(); expect(rt.auth).not.toHaveBeenCalled(); const p = upload(); const recovered = p.initialRecovery!;
    expect(recovered.entries[0].payload).toEqual(originalPayload); expect(p.sessionData).toMatchObject({ sourceProfile: { type } });
    act(() => p.onRestoreSession!(p.sessionData, recovered.entries, recovered.uploadBatch));
    await act(async () => { await upload().onCreate({ channelId: 411, ...fields }, row.rowRequestId, 501); });
    const { channelId: _channelId, ...strictOriginal } = originalPayload;
    expect(rt.create.mock.calls[0][0]).toEqual(strictOriginal); expect(rt.prepare).not.toHaveBeenCalled(); expect(rt.batch).not.toHaveBeenCalled();
  });
});
