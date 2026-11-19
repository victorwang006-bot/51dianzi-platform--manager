// @vitest-environment jsdom
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as XLSX from "xlsx";
import { webcrypto, createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCustomerMaterialSchema } from "../../../../shared/customerSupply";

const runtime = vi.hoisted(() => ({
  context: null as unknown, current: true, navigate: vi.fn(), close: vi.fn(), complete: vi.fn(),
  readContext: vi.fn(), create: vi.fn(), createBatch: vi.fn(), listChannels: vi.fn(), getChannel: vi.fn(), onAuthorizationError: vi.fn(),
  native: { read: true, write: true, note: true, authorizationVersion: "v1" },
  original: vi.fn(), historyGet: vi.fn(), prepare: vi.fn(), reconcile: vi.fn(), histories: new Map<string, any>(), committed: new Map<string, any>(),
  authorityOptions: vi.fn(),
  invalidateContext: vi.fn(), invalidateSummary: vi.fn(),
  invalidateMaterials: vi.fn(), invalidateChannels: vi.fn(), invalidateBatches: vi.fn(),
  suggest: vi.fn(), suggestions: {} as Record<string, { data: { id: number; partNumber: string; brand: string; package: string }[]; isFetching: boolean; isError: boolean }>,
}));
vi.mock("wouter", () => ({ useLocation: () => ["/customers", runtime.navigate] }));
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({
  storageScope: "real-bound-test", contextVerification: { identity: "real-bound-test", authorizationVersion: "v1", readVersion: "v1" },
  officialInventoryPermissions: runtime.native, onAuthorizationError: runtime.onAuthorizationError,
}) }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: {
  customerDemand: { suggestPartNumbers: { useQuery: (input: { keyword: string }, options: unknown) => {
    runtime.suggest(input, options); return runtime.suggestions[input.keyword] ?? { data: [], isFetching: false, isError: false };
  } } },
  enterprise: { me: { useQuery: (_: unknown, options: unknown) => { runtime.authorityOptions(options); return { data: { enterprise: { id: 31 }, currentUserId: 7, permissionKeys: ["inventory.manage"], member: { status: "active", permissionVersion: 1 } }, isError: false, refetch: vi.fn() }; } } },
  channelInventory: {
    customerSupplyContext: { useQuery: () => ({ data: runtime.context, isError: false, isFetching: false, isPlaceholderData: false, isFetchedAfterMount: true, refetch: runtime.readContext }) },
    customerSupplySummary: { useQuery: () => ({ data: { items: [{ customerId: 801, channelId: null, canViewStock: false, materialCount: 0 }] }, isError: false, isFetching: false, isPlaceholderData: false, isFetchedAfterMount: true, refetch: vi.fn() }) },
  },
  useUtils: () => ({ channelInventory: { customerSupplyContext: { invalidate: runtime.invalidateContext }, customerSupplySummary: { invalidate: runtime.invalidateSummary },
    listTeamMaterials: { invalidate: runtime.invalidateMaterials }, listChannels: { invalidate: runtime.invalidateChannels }, listUploadBatches: { invalidate: runtime.invalidateBatches } }, client: { channelInventory: {
    customerSupplyContext: { query: runtime.readContext }, createCustomerUploadBatch: { mutate: runtime.createBatch }, createCustomerMaterial: { mutate: async (...args: any[]) => { createCustomerMaterialSchema.parse(args[0]); const result = await runtime.create(...args); runtime.committed.set(args[0].requestId, result); return result; } },
    customerUploadOriginal: { mutate: runtime.original }, customerUploadHistoryGet: { query: runtime.historyGet }, customerUploadPrepareConfirmation: { mutate: runtime.prepare }, customerUploadReconcileBatch: { mutate: runtime.reconcile },
    listChannels: { query: runtime.listChannels }, getChannel: { query: runtime.getChannel },
  } } }),
} }));
import { CustomerSupplyUploadDialog } from "./CustomerSupplyUploadDialog";
import { CustomerSupplyCell } from "./CustomerSupplyCell";
vi.mock("./CustomerChannelInventory", () => ({ CustomerChannelInventory: () => React.createElement("div", { "data-customer-inventory": true }) }));
import { CustomerWorkbenchSupply } from "./CustomerWorkbenchSupply";
import { customerMaterialInput, customerSupplySessionSuffix, completedSupplyChannel, parseSupplyLocation, supplyReceipt, useCustomerSupplyAuthority,
  supplyLocation, type SupplyContext, type SupplyIdentity, type SupplySummary } from "./customerSupply";
import { runBatch, type BatchEntry } from "../channelInventory/queue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const identity: SupplyIdentity = { enterpriseId: 31, actorUserId: 7, key: "account7:binding1:auth1:enterprise31" };
const payload = { channelId: 801, partNumber: "ONE", brand: "TI", qty: null, dateCode: null, price: null, currency: "CNY" as const, taxIncluded: null, leadTime: null, note: null };
const channel = { id: 411, enterpriseId: 31, name: "同名渠道", type: "agent", industryCode: "electronic_components", active: true, revision: 1, canEdit: true, readOnly: false };
function context(): SupplyContext {
  return { customer: { id: 801, name: "同名客户", industryCode: "electronic_components", version: 4, contactName: "联系人", phone: "13800138000", archivedAt: null }, channel: null, canUpload: true, disabledReason: null };
}
function receipt(customerId = 801, channelId = 411) { return { item: { id: 901, partNumber: "ONE", channelId, uploadBatchId: 501 }, idempotent: false, channelId, customerId }; }
let root: Root | null = null;
let container: HTMLDivElement | null = null;
let generation = 0;
function required<T>(value: T | undefined | null): T { if (value == null) throw new Error("missing fixture control"); return value; }
function button(name: string) { return required(Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === name)); }
function click(element: Element) { act(() => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }); }
function change(element: HTMLSelectElement, value: string) { act(() => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(element, value); element.dispatchEvent(new Event("change", { bubbles: true })); }); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function Harness() {
  const [open, setOpen] = useState(true);
  return open ? React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, isCurrent: () => runtime.current,
    onClose: () => { runtime.close(); setOpen(false); }, onComplete: runtime.complete, onAuthorizationError: runtime.onAuthorizationError }) : null;
}
function render(element: React.ReactElement = React.createElement(Harness, { key: String(++generation) })) {
  if (!root) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  act(() => root?.render(element));
}
async function setupUpload() {
  await settle();
  expect(document.querySelector('[aria-label="首次渠道类型"]')).toBeNull();
  expect(document.body.textContent).not.toContain("继续选择物料表");
  expect(document.body.querySelector('[data-testid="channel-inventory-batch-dialog"]')).not.toBeNull();
  expect(container?.querySelector('[role="dialog"]')).toBeNull(); // real Radix portal, not a fake Dialog
}
async function upload(rows = [["型号", "品牌"], ["ONE", "TI"], ["TWO", "TI"], ["THREE", "TI"]]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows); const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "synthetic");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
  const file = new File([bytes], "synthetic-customer.xlsx"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  const input = required(document.body.querySelector<HTMLInputElement>('[aria-label="上传库存表格"]'));
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(document.querySelector(".ci-batch-preview")).not.toBeNull();
  const currency = document.body.querySelector<HTMLSelectElement>('[aria-label="明确确认本次核对币种为CNY"]');
  if (currency) change(currency, "CNY");
  expect(document.body.querySelector('[aria-label="核对客户来源类型"]')).toBeNull();
  for (const copy of ["本次首表表头明确不入库", "本次客户来源渠道类型", "请选择真实类型，不猜默认工厂", "优先展示需要核对的行（最多100条）", "已自动识别列并保留原表行号"]) expect(document.body.textContent).not.toContain(copy);
}
function seedHistoricalExisting(entryMode: "table" | "single", phase: "preparation" | "unknown" = "preparation") {
  const key = `d51-channel-inventory-batch-v1:7:31:${customerSupplySessionSuffix(identity, 801)}`;
  const sourceProfile = { type: "agent", existingChannelId: 411 };
  const sessionData = { customerId: 801, customerVersion: 4, sourceProfile, verifiedChannelRevision: 1 };
  const requestId = "11111111-1111-4111-8111-111111111111";
  const rowId = "22222222-2222-4222-8222-222222222222";
  const name = entryMode === "single" ? "单条手工录入" : "historical.xlsx";
  const draft = { partNumber: "ONE", brand: "TI", qty: "", price: "", currency: "CNY", taxIncluded: "unknown", leadTime: "", dateCode: "", note: "" };
  const saved = phase === "preparation"
    ? { version: 2, phase: "customer-source", enterpriseId: 31, actorUserId: 7,
      preparation: { requestId, name, entryMode, sessionData, rows: [{ row: 2, requestId: rowId, draft }] } }
    : { version: 1, enterpriseId: 31, actorUserId: 7, channelId: 411, name, entryMode, sessionData,
      uploadBatch: { requestId, id: 501, batchCode: "BATCH-501" },
      entries: [{ row: 2, requestId: rowId, payload: { ...payload, channelId: 411 }, uploadBatchId: 501, status: "unknown" }] };
  sessionStorage.setItem(key, JSON.stringify(saved));
  return { key, sourceProfile, requestId, rowId, name };
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  runtime.histories.clear(); runtime.committed.clear();
  runtime.original.mockReset().mockImplementation((dto: any) => {
    const historyId = randomUUID(); const fileId = randomUUID();
    const book = XLSX.read(Buffer.from(dto.file.base64, "base64"), { type: "buffer" });
    const originalSheets = book.SheetNames.map((sheetName, sheetIndex) => ({ sheetIndex, sheetName, rows: XLSX.utils.sheet_to_json<any[]>(book.Sheets[sheetName], { header: 1, defval: "", raw: true, blankrows: true, range: 0 }).map((cells, i) => ({ rowNumber: i + 1, cells, originalContent: JSON.stringify(cells), originalRowHash: createHash("sha256").update(JSON.stringify(cells)).digest("hex") })) }));
    const history = { historyId, customerId: 801, customerName: "同名客户", mode: dto.mode, state: dto.mode === "parse" ? "pending_parse" : "awaiting_confirmation", revision: 1, uploadedBy: { frontUserId: 7, adminAccountId: 1, displayName: "员工" }, createdAt: new Date().toISOString(), originalFile: { fileId, kind: "original", fileName: dto.file.fileName, byteSize: Buffer.from(dto.file.base64, "base64").length, mimeType: dto.file.mimeType, sha256: "a".repeat(64), createdAt: new Date().toISOString() }, latestVersionId: null, latestVersionNo: 0, access: "self", stats: { sourceRowCount: null, resultRowCount: 0, pendingCount: 0, excludedCount: 0, successCount: 0, unknownCount: 0, failedCount: 0, remainingMaterialCount: 0 }, capabilities: { canConfirm: true, canDownload: true, canManage: false, canUploadResult: false, canCancel: true } };
    runtime.histories.set(historyId, { history, selectedVersion: null, versions: [], originalSheets, confirmation: null });
    return Promise.resolve({ history, idempotent: false, duplicateWarning: false, submissionMessage: "已提交，等待解析" });
  });
  runtime.historyGet.mockReset().mockImplementation((dto: any) => Promise.resolve(runtime.histories.get(dto.historyId)));
  runtime.prepare.mockReset().mockImplementation(async (dto: any) => {
    const batch = await runtime.createBatch({ expectedEnterpriseId: dto.expectedEnterpriseId, expectedActorUserId: dto.expectedActorUserId, customerId: 801, expectedCustomerVersion: dto.expectedCustomerVersion, ...(dto.expectedChannelId ? { expectedChannelId: dto.expectedChannelId } : {}), ...(dto.expectedChannelRevision ? { expectedChannelRevision: dto.expectedChannelRevision } : {}), ...(dto.sourceProfile ? { sourceProfile: dto.sourceProfile } : {}), fileName: runtime.histories.get(dto.historyId).history.originalFile.fileName + " · synthetic", totalRows: dto.confirmedRows.length, requestId: dto.batchRequestId });
    batch.batchCode = randomUUID(); // old service display UUID differs from idempotency requestId
    const entries = dto.confirmedRows.map((row: any) => ({ logicalRowId: row.logicalRowId, rowId: row.rowId, rowRequestId: row.rowRequestId, uploadBatchId: batch.id, status: "pending", payload: { ...row.fields, expectedEnterpriseId: dto.expectedEnterpriseId, expectedActorUserId: dto.expectedActorUserId, customerId: 801, expectedCustomerVersion: dto.expectedCustomerVersion, ...(dto.sourceProfile ? { sourceProfile: dto.sourceProfile } : {}), channelId: batch.channelId, uploadBatchId: batch.id, requestId: row.rowRequestId } }));
    const confirmationId = randomUUID(); const detail = runtime.histories.get(dto.historyId); detail.confirmation = { confirmationId, batchRequestId: dto.batchRequestId, batch, entries, versionId: null, excludedRows: dto.excludedRows, createdAt: new Date().toISOString() }; detail.history.revision++;
    return { historyId: dto.historyId, revision: detail.history.revision, confirmationId, batch, entries };
  });
  runtime.reconcile.mockReset().mockImplementation((dto: any) => { const detail = runtime.histories.get(dto.historyId); const confirmation = detail.confirmation; const entries = confirmation.entries.map((entry: any) => { const actual = runtime.committed.get(entry.rowRequestId); return { ...entry, status: actual ? "success" : "unknown", ...(actual ? { receipt: { status: "success", materialId: actual.item.id, materialRevision: 1, channelId: actual.channelId, customerId: actual.customerId, uploadBatchId: 501, logicalRowId: entry.logicalRowId, rowRequestId: entry.rowRequestId } } : {}) }; }); confirmation.entries = entries; return Promise.resolve({ history: detail.history, batch: confirmation.batch, entries }); });
  runtime.current = true; runtime.context = context(); runtime.native = { read: true, write: true, note: true, authorizationVersion: "v1" };
  runtime.readContext.mockReset().mockImplementation(() => Promise.resolve(runtime.context));
  runtime.createBatch.mockReset().mockImplementation(dto => {
    runtime.context = { ...(runtime.context as SupplyContext), channel: { ...channel, type: dto.sourceProfile?.type ?? (runtime.context as SupplyContext).channel?.type ?? "other" } };
    return Promise.resolve({ id: 501, batchCode: "BATCH-501", revision: 1, channelId: 411, customerId: 801 });
  });
  runtime.create.mockReset().mockImplementation(() => {
    runtime.context = { ...(runtime.context as SupplyContext), channel };
    return Promise.resolve(receipt());
  });
  runtime.listChannels.mockReset().mockResolvedValue({ items: [channel], canWrite: true, page: 1, total: 1 });
  runtime.getChannel.mockReset().mockResolvedValue(channel);
  runtime.navigate.mockReset(); runtime.close.mockReset(); runtime.complete.mockReset(); runtime.onAuthorizationError.mockReset();
  runtime.authorityOptions.mockReset();
  runtime.invalidateContext.mockReset(); runtime.invalidateSummary.mockReset();
  runtime.invalidateMaterials.mockReset(); runtime.invalidateChannels.mockReset(); runtime.invalidateBatches.mockReset();
  runtime.suggest.mockReset(); runtime.suggestions = {};
  sessionStorage.clear(); vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(async () => { if (root) await act(async () => root?.unmount()); container?.remove(); root = null; container = null; document.body.replaceChildren(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("customer supply pure contracts", () => {
  it("drops local virtual channelId and all arbitrary owner/name/source fields from the wire", () => {
    const dto = customerMaterialInput({ ...payload, channelId: 999 }, "original-request", identity, 801, 4, { type: "agent" });
    expect(dto).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, customerId: 801, expectedCustomerVersion: 4, sourceProfile: { type: "agent" },
      partNumber: "ONE", brand: "TI", qty: null, dateCode: null, price: null, currency: "CNY", taxIncluded: null, leadTime: null, note: null, requestId: "original-request" });
    expect(dto).not.toHaveProperty("channelId"); expect(dto).not.toHaveProperty("sourceId"); expect(dto).not.toHaveProperty("name");
  });
  it("isolates mode, enterprise, actor, customer, binding and authorization storage namespaces", () => {
    const suffix = customerSupplySessionSuffix(identity, 801);
    expect(suffix).toContain("customer-supply-v15:31:7:801:");
    for (const altered of [{ ...identity, enterpriseId: 32 }, { ...identity, actorUserId: 8 }, { ...identity, key: "auth-revoked-v2" }]) expect(customerSupplySessionSuffix(altered, 801)).not.toBe(suffix);
    expect(customerSupplySessionSuffix(identity, 802)).not.toBe(suffix);
    expect(suffix).not.toBe("d51-channel-inventory-batch-v1:7:31");
  });
  it("rejects absent/mismatched receipts and cannot navigate mixed real channel IDs", () => {
    expect(() => supplyReceipt(receipt(802), 801)).toThrow(); expect(() => supplyReceipt({ ...receipt(), channelId: 0 }, 801)).toThrow();
    const entries: BatchEntry[] = [{ row: 2, requestId: "a", payload, status: "success", receipt: receipt() }, { row: 3, requestId: "b", payload, status: "success", receipt: receipt(801, 412) }];
    expect(completedSupplyChannel(entries, 801)).toBeNull(); expect(completedSupplyChannel(entries.slice(0, 1), 801)).toBe(411);
  });
  it("parses numeric exact UI intents only, never customer/channel names", () => {
    expect(parseSupplyLocation("?supplyChannelId=411&supplyTab=materials")).toEqual({ channelId: 411, tab: "materials" });
    expect(parseSupplyLocation("?supplyChannelId=同名客户&supplyTab=channels")?.channelId).toBe(0);
    expect(parseSupplyLocation("?supplyChannelId=1e3&supplyTab=channels")?.channelId).toBe(0);
    expect(parseSupplyLocation("?name=同名客户")).toBeNull();
  });
  it("stops a stale queue without leaking the old receipt or sending a second row", async () => {
    let current = true; const submit = vi.fn(async () => { current = false; return receipt(); }); const onProgress = vi.fn();
    const entries: BatchEntry[] = [2, 3].map(row => ({ row, requestId: String(row), payload, status: "pending" }));
    const result = await runBatch(entries, { submit, onProgress, isCurrent: () => current, shouldStop: () => false, receiptFromResult: value => supplyReceipt(value, 801) });
    expect(submit).toHaveBeenCalledTimes(1); expect(onProgress).not.toHaveBeenCalled(); expect(result.reason).toBe("context-changed"); expect(result.entries[0].receipt).toBeUndefined();
  });
});

describe("customer supply row and independent permissions", () => {
  const summary: SupplySummary = { customerId: 801, channelId: 411, materialCount: 3, canUpload: true, canViewStock: true, disabledReason: null };
  it("renders lightweight upload and authorized linked stock buttons with legal count", () => {
    const onUpload = vi.fn(); const onViewStock = vi.fn();
    render(React.createElement(CustomerSupplyCell, { summary, canWrite: true, archived: false, loading: false, failed: false, onUpload, onViewStock }));
    click(button("上传物料表")); click(button("查看库存（3）")); expect(onUpload).toHaveBeenCalledTimes(1); expect(onViewStock).toHaveBeenCalledWith(411);
  });
  it("fails closed on summary errors/archival and does not print an illegal count", () => {
    render(React.createElement(CustomerSupplyCell, { summary: { ...summary, materialCount: -1 }, canWrite: false, archived: true, loading: false, failed: false, onUpload: vi.fn(), onViewStock: vi.fn() }));
    expect(button("上传物料表").getAttribute("aria-disabled")).toBe("true"); expect(button("查看库存")).toBeTruthy();
    render(React.createElement(CustomerSupplyCell, { summary, canWrite: true, archived: false, loading: false, failed: true, onUpload: vi.fn(), onViewStock: vi.fn() }));
    expect(button("上传物料表").getAttribute("aria-disabled")).toBe("true"); expect(document.body.textContent).not.toContain("查看库存");
  });
  it("does not treat inventory source-read permission as write permission or vice versa", () => {
    function Authority() { const authority = useCustomerSupplyAuthority({ enterpriseId: 31, actorUserId: 7, canManageAll: false }, true); return React.createElement("p", null, `${authority.canWrite}:${authority.canRead}`); }
    runtime.native.read = false; render(React.createElement(Authority)); expect(container?.textContent).toBe("true:false");
    runtime.native.read = true; runtime.native.write = false; render(React.createElement(Authority)); expect(container?.textContent).toBe("false:true");
  });
  it("shares once-per-identity authority caching without focus, reconnect, mount or interval refresh", () => {
    function Authority() { useCustomerSupplyAuthority({ enterpriseId: 31, actorUserId: 7, canManageAll: false }, true); return null; }
    render(React.createElement(Authority));
    expect(runtime.authorityOptions).toHaveBeenLastCalledWith({ enabled: true, retry: false, staleTime: Infinity,
      refetchInterval: false, refetchOnWindowFocus: false, refetchOnReconnect: false, refetchOnMount: false });
  });
  it("keeps disabled upload keyboard-focusable, described and non-activating, with explicit retry", () => {
    const onUpload = vi.fn(); const onRetry = vi.fn();
    render(React.createElement(CustomerSupplyCell, { summary, canWrite: true, archived: false, loading: false, failed: true, onUpload, onRetry, onViewStock: vi.fn() }));
    const action = button("上传物料表"); action.focus();
    expect(document.activeElement).toBe(action); expect(action.disabled).toBe(false);
    expect(document.getElementById(required(action.getAttribute("aria-describedby")))?.textContent).toContain("读取失败");
    click(action); expect(onUpload).not.toHaveBeenCalled(); click(button("重试供应库存")); expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("prompts for missing industry without guessed data and keeps profile completion reachable", () => {
    const completeProfile = vi.fn(); const onUpload = vi.fn();
    render(React.createElement(CustomerSupplyCell, { summary, canWrite: true, archived: false, loading: false, failed: false, needsIndustry: true, onCompleteProfile: completeProfile, onUpload, onViewStock: vi.fn() }));
    click(button("上传物料表")); expect(onUpload).not.toHaveBeenCalled(); click(button("补全客户档案")); expect(completeProfile).toHaveBeenCalledTimes(1);
  });
});

describe("customer supply real portal and reused importer", () => {
  it("opens the existing file window directly with customer-bound neutral source, never creates/selects before upload", async () => {
    render(); await setupUpload();
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.listChannels).not.toHaveBeenCalled(); expect(runtime.getChannel).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="首次渠道类型"]')).toBeNull();
    expect(document.querySelector('[aria-label="批量关联渠道"]')).toBeNull();
    expect(document.querySelector(".customer-supply-existing")).toBeNull();
    for (const copy of ["客户供应来源", "选择现有渠道", "关联现有渠道", "请选择渠道", "同名客户"]) expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(copy);
    expect(button("选择库存表格").disabled).toBe(false); click(button("关闭")); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("requires CRM industry completion without providing a guessed industry", async () => {
    runtime.context = { ...context(), customer: { ...context().customer, industryCode: null }, canUpload: false };
    render(); await settle(); expect(document.body.textContent).toContain("客户缺少合法所属行业");
    expect(document.querySelector('[data-testid="channel-inventory-batch-dialog"]')).toBeNull(); expect(document.querySelector('[aria-label="首次渠道类型"]')).toBeNull();
    click(button("补全客户档案")); expect(runtime.navigate).toHaveBeenCalledWith("/customers/801"); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("never closes/navigates on first success and only closes the portal after all rows pass", async () => {
    let finish!: (value: unknown) => void;
    runtime.create.mockImplementationOnce(() => { runtime.context = { ...context(), channel }; return Promise.resolve(receipt()); })
      .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(); await setupUpload(); await upload(); click(button("确认导入 3 条")); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(2); expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => { finish(receipt()); }); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(3); expect(runtime.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=materials");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(sessionStorage.length).toBe(0);
    expect(runtime.invalidateMaterials).toHaveBeenCalledWith(); expect(runtime.invalidateChannels).toHaveBeenCalledWith(); expect(runtime.invalidateBatches).toHaveBeenCalledWith();
    for (const [dto] of runtime.create.mock.calls) { expect(dto).not.toHaveProperty("channelId"); expect(dto).toMatchObject({ customerId: 801, expectedCustomerVersion: 4 }); expect(dto).not.toHaveProperty("sourceProfile"); }
  });
  it("retains partial/unknown failures and receipts, restores original metadata and retries the exact request", async () => {
    runtime.create.mockImplementationOnce(() => { runtime.context = { ...context(), channel }; return Promise.resolve(receipt()); }).mockRejectedValueOnce(new Error("response lost"));
    render(); await setupUpload(); await upload(); click(button("确认导入 3 条")); await settle();
    expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("response lost");
    expect(runtime.invalidateMaterials).toHaveBeenCalled(); expect(runtime.invalidateChannels).toHaveBeenCalled(); expect(runtime.invalidateBatches).toHaveBeenCalled();
    const original = runtime.create.mock.calls[1][0]; const savedKey = required(sessionStorage.key(0));
    expect(savedKey).toContain(customerSupplySessionSuffix(identity, 801));
    const saved = JSON.parse(required(sessionStorage.getItem(savedKey)));
    expect(saved.entries[0].receipt).toMatchObject({ customerId: 801, channelId: 411 }); expect(saved.entries[1].status).toBe("unknown");
    click(button("关闭")); render(); await setupUpload(); click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(runtime.create.mock.calls[2][0]).toEqual(original); expect(runtime.create.mock.calls.map(([dto]) => dto.partNumber)).toEqual(["ONE", "TWO", "TWO", "THREE"]);
    expect(runtime.navigate).toHaveBeenCalledTimes(1); expect(sessionStorage.length).toBe(0);
  });
  it("requires explicit partial finish and leaves the failed original batch recoverable", async () => {
    runtime.create.mockImplementationOnce(() => { runtime.context = { ...context(), channel }; return Promise.resolve(receipt()); }).mockRejectedValueOnce(new Error("unknown"));
    render(); await setupUpload(); await upload(); click(button("确认导入 3 条")); await settle();
    click(button("查看已上传结果 / 完成")); expect(runtime.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=materials"); expect(sessionStorage.length).toBe(1);
  });
  it("all-fail and cancel cannot client-precreate or navigate an empty channel", async () => {
    runtime.create.mockRejectedValue(new Error("FORBIDDEN")); render(); await setupUpload(); await upload(); click(button("确认导入 3 条")); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(1); expect(runtime.navigate).not.toHaveBeenCalled(); expect(runtime.getChannel).not.toHaveBeenCalled(); expect(runtime.listChannels).not.toHaveBeenCalled();
    expect(Array.from(document.querySelectorAll("button")).some(item => item.textContent?.includes("查看已上传结果"))).toBe(false); click(button("关闭")); expect(runtime.navigate).not.toHaveBeenCalled();
  });
  it("recovers an explicitly confirmed existing-channel table preparation without restoring its redundant selector", async () => {
    const original = seedHistoricalExisting("table");
    render(); await setupUpload();
    expect(document.querySelector(".customer-supply-existing")).toBeNull();
    expect(runtime.getChannel).not.toHaveBeenCalled(); expect(runtime.createBatch).not.toHaveBeenCalled();
    click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(runtime.getChannel).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, id: 411 }, { signal: expect.any(AbortSignal) });
    expect(runtime.createBatch.mock.calls[0][0]).toMatchObject({ sourceProfile: original.sourceProfile, expectedChannelRevision: 1, requestId: original.requestId });
    expect(runtime.create.mock.calls[0][0]).toMatchObject({ sourceProfile: original.sourceProfile, requestId: original.rowId, uploadBatchId: 501 });
    expect(runtime.create.mock.calls[0][0]).not.toHaveProperty("channelId"); expect(sessionStorage.getItem(original.key)).toBeNull();
  });
  it.each(["archive", "version", "active", "permission"])("rechecks and stops before submitting when fresh %s context changes", async kind => {
    render(); await setupUpload(); await upload([["型号", "品牌"], ["ONE", "TI"]]);
    const data = context();
    runtime.context = kind === "archive" ? { ...data, customer: { ...data.customer, archivedAt: "2026-11-04" } }
      : kind === "version" ? { ...data, customer: { ...data.customer, version: 5 } }
      : kind === "active" ? { ...data, channel: { ...channel, active: false } } : { ...data, canUpload: false };
    click(button("确认导入 1 条")); await settle(); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("does not poll upload context on focus or after 30 seconds, but explicitly retries an initial error", async () => {
    runtime.readContext.mockRejectedValueOnce(new Error("synthetic read failure")); render(); await settle();
    expect(document.body.textContent).toContain("synthetic read failure"); click(button("重试核验")); await setupUpload();
    expect(runtime.readContext).toHaveBeenCalledTimes(2); vi.useFakeTimers();
    act(() => { window.dispatchEvent(new Event("focus")); vi.advanceTimersByTime(90_000); });
    expect(runtime.readContext).toHaveBeenCalledTimes(2);
  });
  it.each(["factory", "agent", "trade", "other"])("keeps already-linked %s channel type without sending a factory override", async type => {
    runtime.context = { ...context(), channel: { ...channel, type } }; render(); await setupUpload();
    await upload([["型号", "品牌"], ["ONE", "TI"]]); click(button("确认导入 1 条")); await settle();
    expect(runtime.create.mock.calls[0][0]).not.toHaveProperty("sourceProfile"); expect(runtime.listChannels).not.toHaveBeenCalled();
  });
  it("recovers a historical explicitly confirmed agent batch with original metadata and request ID", async () => {
    runtime.context = { ...context(), channel };
    const historical = seedHistoricalExisting("table", "unknown");
    render(); await setupUpload(); click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(runtime.prepare).not.toHaveBeenCalled(); expect(runtime.original).not.toHaveBeenCalled();
    expect(runtime.create.mock.calls[0][0]).toMatchObject({ requestId: historical.rowId, sourceProfile: historical.sourceProfile, expectedCustomerVersion: 4, uploadBatchId: 501 });
    expect(runtime.createBatch).not.toHaveBeenCalled();
  });
  it("keeps same-window partial retry enabled without recreating the importer or losing its queue", async () => {
    runtime.create.mockImplementationOnce(() => { runtime.context = { ...context(), channel }; return Promise.resolve(receipt()); }).mockRejectedValueOnce(new Error("unknown"));
    render(); await setupUpload(); await upload(); click(button("确认导入 3 条")); await settle();
    expect(button("继续处理未完成（沿用原请求）").disabled).toBe(false); const original = runtime.create.mock.calls[1][0];
    click(button("继续处理未完成（沿用原请求）")); await settle(); expect(runtime.create.mock.calls[2][0]).toEqual(original);
    expect(runtime.navigate).toHaveBeenCalledTimes(1);
  });
  it("reports a pre-submit authorization error to the root and does not mutate any material", async () => {
    render(); await setupUpload(); await upload([["型号", "品牌"], ["ONE", "TI"]]);
    const error = Object.assign(new Error("synthetic permission revoked"), { code: "FORBIDDEN" });
    runtime.readContext.mockRejectedValueOnce(error); click(button("确认导入 1 条")); await settle();
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.onAuthorizationError).toHaveBeenCalledWith(error);
    expect(runtime.navigate).not.toHaveBeenCalled();
  });
  it("suppresses a late context response after cancellation and aborts its real signal", async () => {
    let finish!: (value: SupplyContext) => void;
    runtime.readContext.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); render(); click(button("取消"));
    const signal = runtime.readContext.mock.calls[0][1].signal as AbortSignal; expect(signal.aborted).toBe(true);
    await act(async () => { finish(context()); }); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.navigate).not.toHaveBeenCalled();
  });
  it("does not leak a late material result after actor/authorization invalidation", async () => {
    let finish!: (value: unknown) => void; runtime.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(); await setupUpload(); await upload(); click(button("确认导入 3 条")); await settle();
    runtime.current = false; act(() => root?.render(React.createElement(Harness))); await act(async () => { finish(receipt()); }); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(1); expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("v22 stable customer upload portal and concise copy", () => {
  it("keeps the exact Dialog and overlay nodes from real permission loading to ready with no duplicate portals", async () => {
    let finish!: (value: SupplyContext) => void;
    runtime.readContext.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render();
    const dialog = required(document.querySelector('[role="dialog"]'));
    const overlay = required(document.querySelector('[data-slot="dialog-overlay"]'));
    const title = required(document.querySelector('[data-slot="dialog-title"]'));
    const labelledBy = dialog.getAttribute("aria-labelledby");
    const style = dialog.getAttribute("style");
    expect(dialog.textContent).toContain("正在核验上传权限");
    expect(document.querySelector('[aria-label="上传库存表格"]')).toBeNull();
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(next => records.push(...next));
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state"] });
    try {
      await act(async () => { finish(context()); }); await setupUpload();
      records.push(...observer.takeRecords());
      expect(document.querySelector('[role="dialog"]')).toBe(dialog);
      expect(document.querySelector('[data-slot="dialog-overlay"]')).toBe(overlay);
      expect(document.querySelector('[data-slot="dialog-title"]')).toBe(title);
      expect(dialog.getAttribute("aria-labelledby")).toBe(labelledBy);
      expect(dialog.getAttribute("style")).toBe(style);
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      expect(document.querySelectorAll('[data-slot="dialog-overlay"]')).toHaveLength(1);
      for (const record of records) {
        for (const removed of record.removedNodes) {
          expect(removed === dialog || removed === overlay || removed.contains(dialog) || removed.contains(overlay)).toBe(false);
        }
        for (const added of record.addedNodes) {
          if (added instanceof Element) expect(added.matches('[role="dialog"], [data-slot="dialog-overlay"]') || added.querySelector('[role="dialog"], [data-slot="dialog-overlay"]')).toBeFalsy();
        }
        if (record.type === "attributes") expect(record.target === dialog || record.target === overlay).toBe(false);
      }
    } finally { observer.disconnect(); }
    const fixture = process.env.UPLOAD_DOM_FIXTURE;
    if (fixture) {
      mkdirSync(dirname(fixture), { recursive: true });
      writeFileSync(fixture, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>${document.body.outerHTML}</html>\n`);
    }
    expect(title.textContent).toBe("上传客户物料");
    expect(dialog.textContent).not.toContain("同名客户");
    expect(dialog.querySelector(".ci-batch-channel")).toBeNull();
    for (const copy of ["客户档案：", "首次默认工厂", "客户身份固定", "Excel / CSV", "确认前不提交", "首张 sheet", "沿用幂等逐行上传"]) expect(dialog.textContent).not.toContain(copy);
    const note = required(Array.from(dialog.querySelectorAll(".ci-batch-note")).find(item => item.querySelector("summary")?.textContent === "填写说明"));
    expect(note.querySelector("summary")?.textContent).toBe("填写说明");
    expect(note.textContent).toContain("5MB内，最多1000条");
    expect(dialog.querySelector(".ci-batch-drop")?.textContent).not.toContain("5MB");
    click(button("手动录入"));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(document.querySelector(".customer-supply-single .ci-dialog-note")).toBeNull();
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it("keeps the same Dialog through a temporary network failure and explicit successful retry", async () => {
    const error = new Error("临时网络失败");
    runtime.readContext.mockRejectedValueOnce(error); render();
    const dialog = required(document.querySelector('[role="dialog"]'));
    await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(error.message);
    expect(document.querySelector('[aria-label="上传库存表格"]')).toBeNull();
    expect(runtime.onAuthorizationError).toHaveBeenCalledWith(error);
    click(button("重试核验")); await setupUpload();
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(runtime.readContext).toHaveBeenCalledTimes(2);
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it("shows the real denied permission instead of mounting usable upload controls", async () => {
    runtime.context = { ...context(), canUpload: false, disabledReason: "无上传授权" }; render();
    const dialog = required(document.querySelector('[role="dialog"]')); await settle();
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("无上传授权");
    expect(document.querySelector('[aria-label="上传库存表格"]')).toBeNull();
    expect(document.querySelector('[aria-label="客户物料上传方式"]')).toBeNull();
    expect(runtime.create).not.toHaveBeenCalled();
    click(button("取消")); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("routes the outer close button through the single preview confirmation rather than bypassing it", async () => {
    await openSingle(); previewSingle();
    const dialog = required(document.querySelector('[role="dialog"]'));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    click(required(dialog.querySelector('[data-slot="dialog-close"]')));
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(runtime.close).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
    click(required(dialog.querySelector('[data-slot="dialog-close"]')));
    expect(runtime.close).toHaveBeenCalledTimes(1); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("outer Escape stops a running queue without closing the Portal or submitting the next row", async () => {
    let finish!: (value: unknown) => void;
    runtime.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(); await setupUpload(); await upload();
    const dialog = required(document.querySelector('[role="dialog"]'));
    click(button("确认导入 3 条")); await settle();
    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(document.querySelector('[role="dialog"]')).toBe(dialog); expect(runtime.close).not.toHaveBeenCalled();
    runtime.context = { ...context(), channel };
    await act(async () => { finish(receipt()); }); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(1); expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(button("继续处理未完成（沿用原请求）").disabled).toBe(false); expect(runtime.navigate).not.toHaveBeenCalled();
  });
  it("isolates a changed actor even when the caller reuses the component without a key", async () => {
    let oldFinish!: (value: SupplyContext) => void; let newFinish!: (value: SupplyContext) => void;
    runtime.readContext.mockImplementationOnce(() => new Promise(resolve => { oldFinish = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { newFinish = resolve; }));
    const props = { customerId: 801, identity, isCurrent: () => runtime.current, onClose: runtime.close, onComplete: runtime.complete, onAuthorizationError: runtime.onAuthorizationError };
    render(React.createElement(CustomerSupplyUploadDialog, props));
    const oldSignal = runtime.readContext.mock.calls[0][1].signal as AbortSignal;
    render(React.createElement(CustomerSupplyUploadDialog, { ...props, identity: { ...identity, actorUserId: 8, key: "actor8-auth2" } }));
    expect(oldSignal.aborted).toBe(true);
    expect(runtime.readContext.mock.calls[1][0]).toMatchObject({ expectedActorUserId: 8 });
    await act(async () => { oldFinish({ ...context(), customer: { ...context().customer, name: "旧身份客户" } }); }); await settle();
    expect(document.body.textContent).not.toContain("旧身份客户");
    expect(document.querySelector('[aria-label="上传库存表格"]')).toBeNull();
    await act(async () => { newFinish({ ...context(), customer: { ...context().customer, name: "新身份客户" } }); }); await setupUpload();
    expect(document.body.textContent).not.toContain("新身份客户"); expect(document.body.textContent).not.toContain("旧身份客户");
    expect(button("选择库存表格").disabled).toBe(false);
    expect(document.querySelector('[aria-label="批量关联渠道"]')).toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(runtime.create).not.toHaveBeenCalled();
  });
});

function singleField(label: string) {
  return required(document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[aria-label="${label}"]`));
}
function enterSingle(label: string, value: string) {
  const element = singleField(label);
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")?.set?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function openSingle(values: Record<string, string> = {}) {
  render(); await setupUpload(); click(button("手动录入"));
  enterSingle("单条型号", "ONE"); enterSingle("单条品牌", "TI");
  for (const [field, value] of Object.entries(values)) enterSingle(field, value);
}
function previewSingle() { click(button("预览单条物料")); }

describe("real upload Dialog wires single-entry suggestion guards", () => {
  const candidate = { id: 21, partNumber: "STM32F103", brand: "ST", package: "LQFP" };
  async function suggest() {
    runtime.suggestions.ST = { data: [candidate], isFetching: false, isError: false };
    await openSingle({ "单条型号": "ST", "单条品牌": "MANUAL-BRAND" });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 240)); });
    expect(runtime.suggest).toHaveBeenLastCalledWith({ keyword: "ST", limit: 8 }, expect.objectContaining({ enabled: true }));
    expect(container?.querySelector('[role="option"]')).toBeNull(); // real Popover inside real Dialog Portal
    return required(document.body.querySelector<HTMLButtonElement>('[role="option"]'));
  }
  function oldClick(element: Element) {
    return (element as any)[Object.keys(element).find(key => key.startsWith("__reactProps$"))!].onClick as () => void;
  }
  it("selects a real candidate into the draft only, with the original controls disabled on preview", async () => {
    click(await suggest());
    expect(singleField("单条型号").value).toBe(candidate.partNumber); expect(singleField("单条品牌").value).toBe(candidate.brand);
    previewSingle(); expect(document.querySelector(".ci-batch-preview")?.textContent).toContain(candidate.partNumber);
    expect(document.querySelector<HTMLFieldSetElement>(".customer-supply-single fieldset")?.disabled).toBe(true);
    expect(singleField("单条型号").matches(":disabled")).toBe(true); expect(singleField("单条品牌").matches(":disabled")).toBe(true);
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it.each(["fetching", "network-error"])("blocks retained candidate data and its old click in actual Portal during %s, keeping manual entry", async state => {
    const option = await suggest(), staleClick = oldClick(option), data = runtime.suggestions.ST.data;
    runtime.suggestions.ST = { data, isFetching: state === "fetching", isError: state === "network-error" };
    act(() => root?.render(React.createElement(Harness, { key: String(generation) })));
    expect(runtime.suggestions.ST.data).toBe(data); expect(document.querySelector('[role="option"]')).toBeNull();
    act(() => staleClick());
    act(() => singleField("单条型号").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(singleField("单条型号").value).toBe("ST"); expect(singleField("单条品牌").value).toBe("MANUAL-BRAND");
    enterSingle("单条型号", "HAND-ENTERED"); enterSingle("单条品牌", "HAND-BRAND");
    expect(singleField("单条型号").value).toBe("HAND-ENTERED"); expect(singleField("单条品牌").value).toBe("HAND-BRAND");
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it("rejects current-invalidated candidate clicks before any Dialog rerender, without a test-injected single-entry isCurrent", async () => {
    const option = await suggest(), staleClick = oldClick(option);
    runtime.current = false; // Only the real Dialog's caller guard changes. No render/unmount.
    act(() => staleClick()); click(option);
    act(() => singleField("单条型号").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(singleField("单条型号").value).toBe("ST"); expect(singleField("单条品牌").value).toBe("MANUAL-BRAND");
    expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.createBatch).not.toHaveBeenCalled();
  });
});

describe("customer single material upload uses the customer batch transaction", () => {
  it("has explicit accessible table/single switches and defaults to unchanged file upload", async () => {
    render(); await setupUpload();
    expect(document.querySelector('[role="group"][aria-label="客户物料上传方式"]')).not.toBeNull();
    expect(button("表格上传").getAttribute("aria-pressed")).toBe("true");
    expect(button("手动录入").getAttribute("aria-pressed")).toBe("false");
    click(button("手动录入"));
    expect(button("手动录入").getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(singleField("单条型号"));
    expect(document.querySelector('[aria-label="上传库存表格"]')).toBeNull();
    expect(runtime.create).not.toHaveBeenCalled();
  });
  it("previews all supplied values without writing, then sends exact customer DTO and locates receipt ID", async () => {
    await openSingle({ "单条型号": "  ＯＮＥ  ", "单条品牌": " TI ", "单条可供数量": "4,000", "单条报价 CNY": "1.123456789012", "单条税务口径": "true", "单条交期": "7天", "单条 Date Code": "0026+", "单条备注（仅本人）": "个人说明" });
    const fixture = process.env.CUSTOMER_SUPPLY_DOM_FIXTURE;
    if (fixture) {
      mkdirSync(dirname(fixture), { recursive: true });
      writeFileSync(fixture, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>${document.body.outerHTML}</html>\n`);
    }
    previewSingle();
    expect(runtime.create).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
    const preview = required(document.querySelector(".ci-batch-preview"));
    for (const value of ["ONE", "TI", "4000", "1.123456789012", "含税", "7天", "0026+", "个人说明"]) expect(preview.textContent).toContain(value);
    click(button("确认导入 1 条")); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(1);
    expect(runtime.create.mock.calls[0][0]).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, customerId: 801, expectedCustomerVersion: 4,
      partNumber: "ONE", brand: "TI", qty: 4000, price: "1.123456789012", currency: "CNY", taxIncluded: true, leadTime: "7天", dateCode: "0026+", note: "个人说明", requestId: expect.stringMatching(/^[-0-9a-f]{36}$/i), uploadBatchId: 501 });
    expect(runtime.listChannels).not.toHaveBeenCalled(); expect(runtime.getChannel).not.toHaveBeenCalled();
    expect(runtime.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=materials");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(sessionStorage.length).toBe(0);
  });
  it.each(["unknown", "true", "false"])("preserves %s tax including nullable blank qty/price", async tax => {
    await openSingle({ "单条税务口径": tax }); previewSingle(); click(button("确认导入 1 条")); await settle();
    expect(runtime.create.mock.calls[0][0]).toMatchObject({ qty: null, price: null, dateCode: null, leadTime: null, note: null, taxIncluded: tax === "unknown" ? null : tax === "true" });
  });
  it("preserves zero quantity and zero decimal quote instead of converting them to blanks", async () => {
    await openSingle({ "单条可供数量": "0", "单条报价 CNY": "0.000000000001" }); previewSingle(); click(button("确认导入 1 条")); await settle();
    expect(runtime.create.mock.calls[0][0]).toMatchObject({ qty: 0, price: "0.000000000001" });
  });
  it.each([
    ["单条型号", " ", "型号不能为空"], ["单条品牌", " ", "品牌不能为空"],
    ["单条可供数量", "1.5", "数量格式无效"], ["单条可供数量", "2147483648", "数量不能超过2147483647"],
    ["单条报价 CNY", "1.1234567890123", "价格格式无效"],
  ])("rejects invalid %s=%s before preview or any write", async (field, value, error) => {
    await openSingle({ [field]: value }); previewSingle();
    expect(document.body.textContent).toContain(error);
    expect(document.querySelector(".ci-batch-preview")).toBeNull(); expect(runtime.create).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  });
  it("retains manual draft on unsubmitted mode switches and back from preview", async () => {
    await openSingle({ "单条交期": "保留草稿" }); click(button("表格上传")); click(button("手动录入"));
    expect(singleField("单条型号").value).toBe("ONE"); expect(singleField("单条交期").value).toBe("保留草稿");
    previewSingle(); click(button("返回录入")); expect(singleField("单条交期").value).toBe("保留草稿");
    previewSingle(); vi.mocked(window.confirm).mockReturnValueOnce(false); click(button("表格上传"));
    expect(button("确认导入 1 条")).toBeTruthy(); expect(button("手动录入").getAttribute("aria-pressed")).toBe("true");
    click(button("表格上传")); expect(button("选择库存表格")).toBeTruthy();
    click(button("手动录入")); expect(singleField("单条交期").value).toBe("保留草稿"); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("cancels manual draft or preview without creating a channel or material", async () => {
    await openSingle(); click(button("关闭")); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.create).not.toHaveBeenCalled();
    await openSingle(); previewSingle(); click(button("关闭")); expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.navigate).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  });
  it("locks switching, duplicate preview and duplicate submits while a request is running", async () => {
    let finish!: (value: unknown) => void; runtime.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await openSingle(); previewSingle(); click(button("确认导入 1 条")); await settle();
    expect(button("表格上传").disabled).toBe(true); expect(button("手动录入").disabled).toBe(true); expect(button("预览单条物料").disabled).toBe(true);
    click(button("表格上传")); click(button("继续处理未完成（沿用原请求）")); expect(runtime.create).toHaveBeenCalledTimes(1);
    expect(runtime.navigate).not.toHaveBeenCalled();
    await act(async () => { finish(receipt()); }); await settle(); expect(runtime.navigate).toHaveBeenCalledTimes(1);
  });
  it("retains a committed-but-lost result, prohibits switching and retries the whole original customer request", async () => {
    runtime.create.mockImplementationOnce(() => { runtime.context = { ...context(), channel }; return Promise.reject(new Error("committed response lost")); });
    await openSingle(); previewSingle(); click(button("确认导入 1 条")); await settle();
    const original = runtime.create.mock.calls[0][0]; const key = required(sessionStorage.key(0)); const saved = JSON.parse(required(sessionStorage.getItem(key)));
    expect(saved.entryMode).toBe("single"); expect(saved.entries).toHaveLength(1); expect(saved.entries[0].status).toBe("unknown");
    expect(button("表格上传").disabled).toBe(true); click(button("表格上传"));
    expect(button("继续处理未完成（沿用原请求）").disabled).toBe(false); expect(runtime.navigate).not.toHaveBeenCalled();
    click(button("继续处理未完成（沿用原请求）")); await settle(); expect(runtime.create.mock.calls[1][0]).toEqual(original); expect(runtime.navigate).toHaveBeenCalledTimes(1);
  });
  it("restores a single unknown request in the same recovery namespace and keeps modes blocked before restoration", async () => {
    runtime.create.mockRejectedValueOnce(new Error("unknown"));
    await openSingle(); previewSingle(); click(button("确认导入 1 条")); await settle(); const original = runtime.create.mock.calls[0][0];
    click(button("关闭")); render(); await setupUpload();
    expect(button("手动录入").disabled).toBe(true); expect(button("表格上传").disabled).toBe(true); expect(button("选择库存表格").disabled).toBe(true);
    click(button("恢复原批次")); expect(button("手动录入").getAttribute("aria-pressed")).toBe("true");
    click(button("继续处理未完成（沿用原请求）")); await settle(); expect(runtime.create.mock.calls[1][0]).toEqual(original); expect(sessionStorage.length).toBe(0);
  });
  it("keeps all-failed requests recoverable after explicit real source/batch creation without success navigation", async () => {
    runtime.create.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await openSingle(); previewSingle(); click(button("确认导入 1 条")); await settle();
    expect((runtime.context as SupplyContext).channel?.id).toBe(411); expect(runtime.createBatch).toHaveBeenCalledTimes(1); expect(runtime.create).toHaveBeenCalledTimes(1); expect(runtime.navigate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("FORBIDDEN"); expect(runtime.listChannels).not.toHaveBeenCalled(); expect(runtime.getChannel).not.toHaveBeenCalled();
  });
  it.each(["factory", "agent", "trade", "other"])("uses a real linked %s channel without overriding factory type", async type => {
    runtime.context = { ...context(), channel: { ...channel, type } }; await openSingle(); previewSingle(); click(button("确认导入 1 条")); await settle();
    expect(runtime.create.mock.calls[0][0]).not.toHaveProperty("sourceProfile"); expect(runtime.create.mock.calls[0][0]).not.toHaveProperty("channelId");
  });
  it("restores explicitly verified existing-channel single preparation with the same UUID and CAS transaction", async () => {
    const original = seedHistoricalExisting("single"); render(); await setupUpload();
    expect(button("手动录入").disabled).toBe(true); expect(runtime.getChannel).not.toHaveBeenCalled();
    click(button("恢复原批次")); expect(button("手动录入").getAttribute("aria-pressed")).toBe("true");
    click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(runtime.createBatch.mock.calls[0][0]).toMatchObject({ sourceProfile: original.sourceProfile, expectedChannelRevision: 1, requestId: original.requestId });
    expect(runtime.create.mock.calls[0][0]).toMatchObject({ customerId: 801, sourceProfile: original.sourceProfile, requestId: original.rowId, uploadBatchId: 501 });
    expect(runtime.getChannel).toHaveBeenCalledTimes(2); expect(sessionStorage.getItem(original.key)).toBeNull();
  });
  it.each(["archive", "version", "permission", "active"])("rechecks fresh %s customer state before the single write", async kind => {
    await openSingle(); previewSingle(); const data = context();
    runtime.context = kind === "archive" ? { ...data, customer: { ...data.customer, archivedAt: "2026-11-04" } }
      : kind === "version" ? { ...data, customer: { ...data.customer, version: 5 } }
      : kind === "permission" ? { ...data, canUpload: false } : { ...data, channel: { ...channel, active: false } };
    click(button("确认导入 1 条")); await settle(); expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("does not offer manual private notes without the independent note permission", async () => {
    runtime.native.note = false; await openSingle();
    expect(document.querySelector('[aria-label="单条备注（仅本人）"]')).toBeNull();
    previewSingle(); click(button("确认导入 1 条")); await settle(); expect(runtime.create.mock.calls[0][0].note).toBeNull();
  });
  it("refuses a mismatched single receipt and keeps its exact original request instead of navigating", async () => {
    runtime.create.mockResolvedValueOnce(receipt(802)); await openSingle(); previewSingle(); click(button("确认导入 1 条")); await settle();
    expect(runtime.navigate).not.toHaveBeenCalled(); expect(button("表格上传").disabled).toBe(true);
    const original = runtime.create.mock.calls[0][0]; click(button("继续处理未完成（沿用原请求）")); await settle(); expect(runtime.create.mock.calls[1][0]).toEqual(original);
  });
  it("does not leak a single result or navigate after identity/authorization invalidation", async () => {
    let finish!: (value: unknown) => void; runtime.create.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await openSingle(); previewSingle(); click(button("确认导入 1 条")); await settle();
    const signal = runtime.create.mock.calls[0][1].signal as AbortSignal;
    runtime.current = false; act(() => root?.render(React.createElement(Harness)));
    act(() => root?.render(React.createElement("div"))); expect(signal.aborted).toBe(true);
    await act(async () => { finish(receipt()); }); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(1); expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
    const saved = JSON.parse(required(sessionStorage.getItem(required(sessionStorage.key(0)))));
    expect(saved.entries[0].receipt).toBeUndefined(); expect(saved.entries[0].status).toBe("pending");
  });
  it.each(["enterprise", "actor", "customer", "authorization"])("never restores another %s single session", async kind => {
    runtime.create.mockRejectedValueOnce(new Error("unknown")); await openSingle(); previewSingle(); click(button("确认导入 1 条")); await settle(); click(button("关闭"));
    const alternate = kind === "enterprise" ? { ...identity, enterpriseId: 32 } : kind === "actor" ? { ...identity, actorUserId: 8 }
      : kind === "authorization" ? { ...identity, key: "new-authorization" } : identity;
    const customerId = kind === "customer" ? 802 : 801;
    runtime.context = { ...context(), customer: { ...context().customer, id: customerId } };
    render(React.createElement(CustomerSupplyUploadDialog, { key: String(++generation), customerId, identity: alternate, isCurrent: () => runtime.current,
      onClose: runtime.close, onComplete: runtime.complete, onAuthorizationError: runtime.onAuthorizationError })); await settle();
    expect(document.body.textContent).not.toContain("恢复原批次"); expect(button("手动录入").disabled).toBe(false);
    expect(runtime.create).toHaveBeenCalledTimes(1); expect(sessionStorage.length).toBe(1);
  });
});


describe("IR-01 directly mounted customer upload real batch regression", () => {
  it("uses the explicitly bound channel (never customer ID), creates one batch, and passes it to every table row", async () => {
    runtime.context = { ...context(), channel };
    render(); await setupUpload();
    expect(document.querySelector('[aria-label="批量关联渠道"]')).toBeNull();
    expect(document.querySelector(".ci-batch-channel")).toBeNull(); expect(runtime.listChannels).not.toHaveBeenCalled();
    await upload(); click(button("确认导入 3 条")); await settle();
    expect(runtime.createBatch).toHaveBeenCalledTimes(1);
    expect(runtime.createBatch.mock.calls[0][0]).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7,
      customerId: 801, expectedCustomerVersion: 4, expectedChannelId: 411, expectedChannelRevision: 1,
      fileName: "synthetic-customer.xlsx · synthetic", totalRows: 3, requestId: expect.any(String) });
    expect(runtime.create).toHaveBeenCalledTimes(3);
    for (const [dto] of runtime.create.mock.calls) { expect(dto.uploadBatchId).toBe(501); expect(dto).not.toHaveProperty("channelId"); }
    expect(runtime.createBatch.mock.invocationCallOrder[0]).toBeLessThan(runtime.create.mock.invocationCallOrder[0]);
  });
  it("unbound first upload persists no fake channel/placeholder material before confirmed source-and-batch creation", async () => {
    let finish!: (value: unknown) => void;
    runtime.createBatch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(); await setupUpload();
    expect(document.querySelector('[aria-label="批量关联渠道"] option[value="801"]')).toBeNull();
    await upload(); expect(runtime.createBatch).not.toHaveBeenCalled();
    click(button("确认导入 3 条")); await settle();
    const pending = JSON.parse(required(sessionStorage.getItem(required(sessionStorage.key(0)))));
    expect(pending).toMatchObject({ phase: "customer-source", preparation: { rows: expect.any(Array), requestId: expect.any(String) } });
    expect(pending).not.toHaveProperty("channelId"); expect(pending).not.toHaveProperty("entries");
    expect(runtime.create).not.toHaveBeenCalled();
    runtime.context = { ...context(), channel: { ...channel, type: "other" } };
    await act(async () => { finish({ id: 501, batchCode: "BATCH-501", revision: 1, channelId: 411, customerId: 801 }); }); await settle();
    expect(runtime.create).toHaveBeenCalledTimes(3);
    for (const [dto] of runtime.create.mock.calls) { expect(dto).toMatchObject({ uploadBatchId: 501 }); expect(dto).not.toHaveProperty("sourceProfile"); }
  });
  it("batch response loss refresh restores the exact requestId without opening a second batch", async () => {
    runtime.createBatch.mockImplementationOnce(dto => {
      runtime.context = { ...context(), channel: { ...channel, type: dto.sourceProfile?.type ?? "other" } };
      return Promise.reject(new Error("batch committed response lost"));
    });
    render(); await setupUpload(); await upload(); click(button("确认导入 3 条")); await settle();
    const original = runtime.createBatch.mock.calls[0][0];
    expect(runtime.create).not.toHaveBeenCalled(); expect(button("表格上传").disabled).toBe(true);
    const pending = JSON.parse(required(sessionStorage.getItem(required(sessionStorage.key(0)))));
    click(button("关闭")); render(); await setupUpload(); click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(runtime.createBatch.mock.calls[1][0]).toEqual(original);
    expect(runtime.create.mock.calls.map(([dto]) => dto.requestId)).toEqual(pending.preparation.rows.map((row: { requestId: string }) => row.requestId));
    for (const [dto] of runtime.create.mock.calls) expect(dto.uploadBatchId).toBe(501);
  });
  it("partial per-row refresh retries retain batch and row request ID without recreating a batch", async () => {
    runtime.create.mockResolvedValueOnce(receipt()).mockRejectedValueOnce(new Error("row response lost"));
    render(); await setupUpload(); await upload(); click(button("确认导入 3 条")); await settle();
    const original = runtime.create.mock.calls[1][0];
    const saved = JSON.parse(required(sessionStorage.getItem(required(sessionStorage.key(0)))));
    expect(saved.channelId).toBe(411); expect(saved.uploadBatch.id).toBe(501);
    for (const row of saved.entries) expect(row.uploadBatchId).toBe(501);
    click(button("关闭")); render(); await setupUpload(); click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(runtime.createBatch).toHaveBeenCalledTimes(1); expect(runtime.create.mock.calls[2][0]).toEqual(original);
  });
  it("single upload uses the same new real batch and ID allowlist", async () => {
    await openSingle(); previewSingle(); click(button("确认导入 1 条")); await settle();
    expect(runtime.createBatch).toHaveBeenCalledTimes(1);
    expect(runtime.createBatch.mock.calls[0][0]).toMatchObject({ fileName: "单条手工录入", totalRows: 1 });
    expect(runtime.create.mock.calls[0][0].uploadBatchId).toBe(501);
  });
  it("bound channel revision changes stop before creating a new batch", async () => {
    runtime.context = { ...context(), channel }; render(); await setupUpload(); await upload();
    runtime.context = { ...context(), channel: { ...channel, revision: 2 } };
    click(button("确认导入 3 条")); await settle();
    expect(runtime.createBatch).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("a bound batch-creation response loss cannot restore under a changed channel revision", async () => {
    runtime.context = { ...context(), channel }; runtime.createBatch.mockRejectedValueOnce(new Error("batch unknown"));
    render(); await setupUpload(); await upload(); click(button("确认导入 3 条")); await settle();
    click(button("关闭")); runtime.context = { ...context(), channel: { ...channel, revision: 2 } };
    render(); await setupUpload(); expect(button("选择库存表格").disabled).toBe(true);
    expect(document.body.textContent).toContain("阻止另起批次"); expect(runtime.createBatch).toHaveBeenCalledTimes(1); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("saved successful receipts must carry matching material channel and batch evidence", () => {
    const valid = { ...receipt(), uploadBatchId: 501 };
    const entry = { row: 2, requestId: "original", payload: { ...payload, channelId: 411 }, uploadBatchId: 501, status: "success" as const, receipt: valid };
    expect(completedSupplyChannel([entry], 801)).toBe(411);
    expect(completedSupplyChannel([{ ...entry, receipt: { ...valid, item: { ...valid.item, uploadBatchId: 502 } } }], 801)).toBeNull();
  });
  it("lost upload permission fails before any source/batch or row write", async () => {
    render(); await setupUpload(); await upload(); runtime.context = { ...context(), canUpload: false };
    click(button("确认导入 3 条")); await settle();
    expect(runtime.createBatch).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled(); expect(runtime.close).toHaveBeenCalled();
  });
  it.each(["channel", "batch"])("rejects a real material receipt with wrong %s attribution", async kind => {
    const bad = receipt();
    runtime.create.mockResolvedValueOnce({ ...bad, item: { ...bad.item, ...(kind === "channel" ? { channelId: 801 } : { uploadBatchId: 502 }) } });
    await openSingle(); previewSingle(); click(button("确认导入 1 条")); await settle();
    expect(runtime.navigate).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("回执");
    const original = runtime.create.mock.calls[0][0]; click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(runtime.createBatch).toHaveBeenCalledTimes(1); expect(runtime.create.mock.calls[1][0]).toEqual(original);
  });
  it("does not backfill legacy virtual customer queues with invented batch attribution", async () => {
    const key = `d51-channel-inventory-batch-v1:7:31:${customerSupplySessionSuffix(identity, 801)}`;
    sessionStorage.setItem(key, JSON.stringify({ version: 1, enterpriseId: 31, actorUserId: 7, channelId: 801,
      name: "legacy.xlsx", sessionData: { customerId: 801, customerVersion: 4, sourceProfile: { type: "factory" } },
      entries: [{ row: 2, requestId: "00000000-0000-4000-8000-000000000001", payload, status: "unknown" }] }));
    render(); await setupUpload(); expect(button("选择库存表格").disabled).toBe(true);
    expect(runtime.createBatch).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
  });
});

describe("historical existing-channel recovery after visible association removal", () => {
  it.each(["table", "single"] as const)("keeps the original %s unknown row UUID, sourceProfile and real batch without creating another batch", async mode => {
    const original = seedHistoricalExisting(mode, "unknown"); runtime.context = { ...context(), channel };
    render(); await setupUpload();
    expect(document.querySelector(".customer-supply-existing")).toBeNull(); expect(runtime.getChannel).not.toHaveBeenCalled();
    click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(runtime.createBatch).not.toHaveBeenCalled(); expect(runtime.create).toHaveBeenCalledTimes(1);
    expect(runtime.create.mock.calls[0][0]).toMatchObject({ sourceProfile: original.sourceProfile, requestId: original.rowId, uploadBatchId: 501 });
    expect(runtime.getChannel).toHaveBeenCalledWith({ expectedEnterpriseId: 31, expectedActorUserId: 7, id: 411 }, { signal: expect.any(AbortSignal) });
    expect(runtime.navigate).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(original.key)).toBeNull();
  });
  it.each(["type", "revision", "permission", "enterprise", "inactive", "id"])("still rejects changed historical existing-channel %s before batch or row writes", async kind => {
    const original = seedHistoricalExisting("table");
    const changed = { ...channel, ...(kind === "type" ? { type: "trade" } : kind === "revision" ? { revision: 2 }
      : kind === "permission" ? { canEdit: false } : kind === "enterprise" ? { enterpriseId: 32 }
      : kind === "inactive" ? { active: false } : { id: 412 }) };
    runtime.getChannel.mockResolvedValue(changed); render(); await setupUpload();
    click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(runtime.createBatch).not.toHaveBeenCalled(); expect(runtime.create).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(["type", "revision"].includes(kind) ? "所选渠道真实类型已变化" : "人工选择的渠道不可写或已停用");
    expect(runtime.onAuthorizationError).toHaveBeenCalled(); expect(runtime.navigate).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(original.key)).not.toBeNull(); expect(button("表格上传").disabled).toBe(true);
  });
});

describe("customer-detail supply entry uses the real existing upload portal", () => {
  it("opens the same real Portal through the original list supply cell upload action without any source selector", async () => {
    function ListEntry() {
      const [open, setOpen] = useState(false);
      return React.createElement(React.Fragment, null,
        React.createElement(CustomerSupplyCell, { summary: { customerId: 801, channelId: null, materialCount: 0, canUpload: true, canViewStock: false, disabledReason: null },
          canWrite: true, archived: false, loading: false, failed: false, onUpload: () => setOpen(true), onViewStock: vi.fn() }),
        open ? React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, isCurrent: () => runtime.current,
          onClose: () => setOpen(false), onComplete: runtime.complete, onAuthorizationError: runtime.onAuthorizationError }) : null);
    }
    render(React.createElement(ListEntry)); expect(document.querySelector('[role="dialog"]')).toBeNull();
    click(button("上传物料表")); await setupUpload(); expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelector('[aria-label="批量关联渠道"]')).toBeNull(); expect(runtime.listChannels).not.toHaveBeenCalled();
    await upload([["型号", "品牌"], ["ONE", "TI"]]); click(button("确认导入 1 条")); await settle();
    expect(runtime.createBatch).toHaveBeenCalledTimes(1); expect(runtime.create.mock.calls[0][0]).toMatchObject({ customerId: 801, uploadBatchId: 501 }); expect(runtime.create.mock.calls[0][0]).not.toHaveProperty("sourceProfile");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(runtime.navigate).toHaveBeenCalledTimes(1);
  });
  it("opens one existing portal from verified supply context and sends the original customer batch DTO", async () => {
    const onOpenChange = vi.fn();
    render(React.createElement(CustomerWorkbenchSupply, { customerId: 801, customerVersion: 4,
      scope: { enterpriseId: 31, actorUserId: 7, canManageAll: false }, scopeReady: true, onOpenChange }));
    expect(document.querySelector("h2")?.nextElementSibling).toBe(button("上传库存表"));
    expect(document.body.textContent).not.toContain("渠道设置"); expect(button("上传库存表").nextElementSibling).toBe(button("解析历史"));
    click(button("上传库存表")); await setupUpload();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(true); click(button("手动录入"));
    enterSingle("单条型号", "ONE"); enterSingle("单条品牌", "TI"); previewSingle(); click(button("确认导入 1 条")); await settle();
    expect(runtime.createBatch).toHaveBeenCalledTimes(1); expect(runtime.create.mock.calls[0][0]).toMatchObject({
      customerId: 801, expectedCustomerVersion: 4, expectedEnterpriseId: 31, expectedActorUserId: 7, uploadBatchId: 501,
    });
    expect(runtime.create.mock.calls[0][0]).not.toHaveProperty("channelId");
    expect(runtime.navigate).toHaveBeenCalledWith("/channel-inventory?supplyChannelId=411&supplyTab=materials");
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(runtime.invalidateContext).toHaveBeenCalled(); expect(runtime.invalidateSummary).toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  });
  it("preserves exact legacy channel/settings links and does not append an unrelated old source or customer URL", () => {
    expect(supplyLocation(411, "channels")).toBe("/channel-inventory?supplyChannelId=411&supplyTab=channels");
    expect(supplyLocation(411, "materials")).toBe("/channel-inventory?supplyChannelId=411&supplyTab=materials");
    expect(parseSupplyLocation(supplyLocation(411, "channels").split("?")[1])).toEqual({ channelId: 411, tab: "channels" });
    expect(() => supplyLocation(0, "materials")).toThrow();
  });
});

describe("real persisted batch code and strict create boundary", () => {
  it("keeps independent server batchCode and original idempotency UUID across unknown reopen", async () => {
    runtime.create.mockRejectedValueOnce(new Error("lost row receipt"));
    render(); await setupUpload(); await upload([["型号", "品牌"], ["ONE", "TI"]]);
    click(button("确认导入 1 条")); await settle();
    const confirmationInput = runtime.prepare.mock.calls[0][0];
    const detail = Array.from(runtime.histories.values())[0];
    expect(detail.confirmation.batch.batchCode).not.toBe(confirmationInput.batchRequestId);
    const key = required(sessionStorage.key(0)); const saved = JSON.parse(required(sessionStorage.getItem(key)));
    expect(saved.uploadBatch.requestId).toBe(confirmationInput.batchRequestId);
    expect(saved.uploadBatch.batchCode).toBe(detail.confirmation.batch.batchCode);
    const original = runtime.create.mock.calls[0][0];
    expect(() => createCustomerMaterialSchema.parse(original)).not.toThrow();
    expect(original).not.toHaveProperty("channelId");
    const frozen = detail.confirmation.entries[0].payload;
    const { channelId, ...strictPayload } = frozen;
    expect(original).toEqual(strictPayload);
    expect(createCustomerMaterialSchema.safeParse(frozen).success).toBe(false);
    click(button("关闭")); render(); await setupUpload();
    click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(runtime.create.mock.calls[1][0]).toEqual(original);
    expect(runtime.prepare).toHaveBeenCalledTimes(1); expect(runtime.createBatch).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0); expect(runtime.navigate).toHaveBeenCalledTimes(1);
  });
});
