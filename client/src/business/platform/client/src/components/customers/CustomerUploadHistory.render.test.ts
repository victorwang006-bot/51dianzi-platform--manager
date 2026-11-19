// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { webcrypto, randomUUID, createHash } from "node:crypto";
import * as XLSX from "xlsx";
// Only the actual pure assertion is used; no native DB/environment may be loaded.
vi.mock("../../../../front-router-types/server/db", () => ({ getDb: () => { throw new Error("REAL_DATABASE_FORBIDDEN"); } }));
vi.mock("../../../../front-router-types/server/services/crmCustomers", () => ({ crmCustomerPolicyWhere: vi.fn(), resolveCrmCustomerPolicy: vi.fn(), assertCrmCustomerPolicy: vi.fn() }));
vi.mock("../../../../front-router-types/server/services/channelFactoryPublication", () => ({ factoryMaterialPublicationMetadata: vi.fn(), createChannelFactoryPublicationService: vi.fn() }));
import { assertCustomerUploadRows } from "../../../../front-router-types/server/services/customerUploadHistory";
const rt = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), mark: vi.fn(), result: vi.fn(), download: vi.fn(), reconcile: vi.fn(), original: vi.fn(), prepare: vi.fn(), create: vi.fn(), batch: vi.fn(), context: vi.fn(), current: true, close: vi.fn(), complete: vi.fn(), auth: vi.fn() }));
vi.mock("wouter", () => ({ useLocation: () => ["/customers", vi.fn()] }));
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({ storageScope: "offline-history-scope", officialInventoryPermissions: { read: true, write: true, note: true } }) }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: { useUtils: () => ({ channelInventory: { listTeamMaterials: { invalidate: vi.fn() }, listChannels: { invalidate: vi.fn() }, listUploadBatches: { invalidate: vi.fn() } }, client: { channelInventory: { customerUploadHistoryList: { query: rt.list }, customerUploadHistoryGet: { query: rt.get }, customerUploadManageMark: { mutate: rt.mark }, customerUploadResult: { mutate: rt.result }, customerUploadDownload: { mutate: rt.download }, customerUploadReconcileBatch: { mutate: rt.reconcile }, customerUploadOriginal: { mutate: rt.original }, customerUploadPrepareConfirmation: { mutate: rt.prepare }, createCustomerMaterial: { mutate: rt.create }, createCustomerUploadBatch: { mutate: rt.batch }, customerSupplyContext: { query: rt.context } } } }), customerDemand: { suggestPartNumbers: { useQuery: () => ({ data: [], isFetching: false, isError: false }) } } } }));
import { CustomerUploadHistoryDialog } from "./CustomerUploadHistoryDialog";
import { CustomerSupplyUploadDialog } from "./CustomerSupplyUploadDialog";
import { CustomerParseUpload } from "./CustomerParseUpload";
import type { History, HistoryDetail } from "./customerUploadHistory";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const identity = { enterpriseId: 31, actorUserId: 7, key: "verified-root" };
const id = "11111111-1111-4111-8111-111111111111";
function history(changes: Partial<History> = {}): History { return { historyId: id, customerId: 801, customerName: "授权客户", mode: "parse", state: "pending_parse", revision: 4, uploadedBy: { frontUserId: 7, adminAccountId: 1, displayName: "真实上传人" }, createdAt: "2026-11-15T12:00:00+08:00", originalFile: { fileId: "22222222-2222-4222-8222-222222222222", kind: "original", fileName: "原表.csv", mimeType: "text/csv", byteSize: 3, sha256: "a".repeat(64), createdAt: "2026-11-15T12:00:00+08:00" }, latestVersionId: null, latestVersionNo: 0, access: "self", stats: { sourceRowCount: 2, resultRowCount: 0, pendingCount: 0, excludedCount: 0, successCount: 0, unknownCount: 0, failedCount: 0, remainingMaterialCount: 0 }, capabilities: { canDownload: true, canManage: true, canUploadResult: true, canConfirm: false, canCancel: true }, ...changes }; }
function detail(h = history()): HistoryDetail { return { history: h, versions: [], selectedVersion: null, confirmation: null, originalSheets: [{ sheetIndex: 0, sheetName: "原表", rows: [{ rowNumber: 1, cells: ["型号"], originalRowHash: createHash("sha256").update("表头原文").digest("hex"), originalContent: "表头原文" }, { rowNumber: 8, cells: ["ONE", "TI"], originalRowHash: createHash("sha256").update("完整原文").digest("hex"), originalContent: "完整原文" }] }] }; }
let root: Root | undefined; let host: HTMLElement;
function render(element?: React.ReactElement) { if (!root) { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); } act(() => root!.render(element ?? React.createElement(CustomerUploadHistoryDialog, { customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth }))); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
function button(text: string) { const b = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent?.trim() === text); if (!b) throw new Error(`missing ${text}: ${document.body.textContent}`); return b; }
function click(e: Element) { act(() => { e.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function change(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) { act(() => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }); }
async function upload(label: string, rows: (string | number)[][], multiple = false) { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "结果"); if (multiple) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "第二结果"); const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }); const file = new File([bytes], "同名但明确任务.xlsx"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes }); const input = document.body.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; Object.defineProperty(input, "files", { value: [file], configurable: true }); await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); }); return file; }
beforeEach(() => { rt.current = true; Object.values(rt).forEach(value => { if (typeof value === "function" && "mockReset" in value) value.mockReset(); }); rt.list.mockResolvedValue({ items: [history()], nextCursor: null, canManage: true }); rt.get.mockResolvedValue(detail()); rt.mark.mockResolvedValue({ history: history(), idempotent: false }); rt.download.mockResolvedValue({ fileName: "私有文件.csv", mimeType: "text/csv", byteSize: 3, sha256: "a".repeat(64), base64: btoa("abc") }); rt.context.mockResolvedValue({ customer: { id: 801, name: "授权客户", version: 4, industryCode: "electronic_components", archivedAt: null }, channel: null, canUpload: true, disabledReason: null }); sessionStorage.clear(); vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("confirm", vi.fn(() => true)); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:private") }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined); });
beforeEach(() => { rt.result.mockImplementation(async input => { assertCustomerUploadRows(input.rows, input.issues, { sheets: detail().originalSheets }); return { history: history(), version: {}, idempotent: false }; }); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("history ACL real portal", () => {
  it("lists only on open using exact verified scope and one real portal", async () => { render(); await settle(); expect(rt.list.mock.calls[0][0]).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, customerId: 801, view: "mine", pageSize: 50 }); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(document.querySelector(".history-list")?.textContent).toContain("原表.csv"); expect(document.querySelector(".history-list")?.textContent).not.toContain(id); expect(rt.get).not.toHaveBeenCalled(); });
  it("remains read-only with or without server management capability", async () => {
    render(); await settle(); click(button("原表.csv")); await settle();
    expect(document.body.textContent).not.toMatch(/解析管理|继续导入|继续处理|回传|标记解析/);
    expect(document.querySelector('input[type="file"], textarea')).toBeNull();
    for (const call of [rt.reconcile, rt.mark, rt.result, rt.prepare, rt.create, rt.batch, rt.original]) expect(call).not.toHaveBeenCalled();
  });
  it("uses ACL base64 original download, a short-lived blob URL and no public URL", async () => {
    render(); await settle(); click(button("原表.csv")); await settle(); click(button("下载")); await settle();
    expect(rt.download.mock.calls[0][0]).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, files: [{ historyId: id, fileId: history().originalFile.fileId }], includeManifest: false });
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(File)); expect(document.body.querySelector('a[href^="http"]')).toBeNull();
    expect(rt.get).toHaveBeenCalledTimes(1); expect(rt.prepare).not.toHaveBeenCalled(); expect(rt.create).not.toHaveBeenCalled();
  });
  it("stale root aborts an outstanding read and suppresses old data", async () => {
    let resolve!: (d: any) => void;
    rt.list.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    render(); await settle(); rt.current = false;
    await act(async () => root?.unmount()); root = undefined;
    expect(rt.list.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { resolve({ items: [history()], nextCursor: null, canManage: true }); });
    expect(document.body.textContent).not.toContain("原表.csv"); expect(rt.auth).not.toHaveBeenCalled();
  });
});
describe("parse-only upload and persistent original", () => {
  it("keeps standard/manual modes and advanced parse in the same portal without a formal queue", async () => { render(React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth })); await settle(); const group = document.querySelector('[aria-label="客户物料上传方式"]')!; expect(Array.from(group.querySelectorAll("button")).map(button => button.textContent)).toEqual(["表格上传", "手动录入"]); click(button("提交原文件人工整理")); const bytes = new TextEncoder().encode("型号,品牌\nONE,TI"); const file = new File([bytes], "source.csv"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer }); const input = document.querySelector<HTMLInputElement>('[aria-label="上传待解析原表"]')!; Object.defineProperty(input, "files", { value: [file], configurable: true }); act(() => input.dispatchEvent(new Event("change", { bubbles: true }))); rt.original.mockResolvedValue({ history: history(), idempotent: false, duplicateWarning: false, submissionMessage: "已提交，等待解析" }); click(button("提交，等待解析")); await settle(); expect(rt.original.mock.calls[0][0].mode).toBe("parse"); expect(document.body.textContent).toContain("已提交，等待解析"); expect(rt.create).not.toHaveBeenCalled(); expect(rt.batch).not.toHaveBeenCalled(); expect(rt.prepare).not.toHaveBeenCalled(); });
  it("parse retry preserves original operation UUID after unknown transport outcome", async () => { render(React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth })); await settle(); click(button("提交原文件人工整理")); const bytes = new TextEncoder().encode("型号,品牌\nONE,TI"); const file = new File([bytes], "source.csv"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer }); const input = document.querySelector<HTMLInputElement>('[aria-label="上传待解析原表"]')!; Object.defineProperty(input, "files", { value: [file], configurable: true }); act(() => input.dispatchEvent(new Event("change", { bubbles: true }))); rt.original.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({ history: history(), idempotent: true, duplicateWarning: false, submissionMessage: "已提交，等待解析" }); click(button("提交，等待解析")); await settle(); click(button("按原UUID重试提交")); await settle(); expect(rt.original.mock.calls[1][0]).toEqual(rt.original.mock.calls[0][0]); expect(sessionStorage.length).toBe(0); });
  it("private standard original save failure prevents map preview and formal submission", async () => { rt.original.mockRejectedValue(new Error("private store unavailable")); render(React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth })); await settle(); await upload("上传库存表格", [["型号", "品牌"], ["ONE", "TI"]]); expect(document.body.textContent).toContain("private store unavailable"); expect(document.body.textContent).not.toContain("预览并校验"); expect(rt.prepare).not.toHaveBeenCalled(); expect(rt.batch).not.toHaveBeenCalled(); expect(rt.create).not.toHaveBeenCalled(); });
});

describe("restored history conservative recovery regressions", () => {
  it("does not merge different same-name originals after manifest read failure", async () => {
    rt.get.mockRejectedValue(new Error("manifest unavailable"));
    rt.original.mockImplementation(async () => ({ history: history({ historyId: randomUUID(), mode: "standard", state: "awaiting_confirmation" }), idempotent: false, duplicateWarning: false, submissionMessage: "" }));
    render(React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth }));
    await settle();
    await upload("上传库存表格", [["型号", "品牌"], ["FIRST", "TI"]]);
    await upload("上传库存表格", [["型号", "品牌"], ["SECOND", "TI"]]);
    expect(rt.original).toHaveBeenCalledTimes(2);
    expect(rt.original.mock.calls[0][0].file.fileName).toBe(rt.original.mock.calls[1][0].file.fileName);
    expect(rt.original.mock.calls[0][0].file.base64).not.toBe(rt.original.mock.calls[1][0].file.base64);
    expect(rt.original.mock.calls[0][0].requestId).not.toBe(rt.original.mock.calls[1][0].requestId);
    expect(rt.prepare).not.toHaveBeenCalled(); expect(rt.create).not.toHaveBeenCalled();
  });
});

describe("issue transport and explicit exclusion regressions", () => {
  it.each([false, true])("includes excluded row issues and preserves manual resolutions (manual=%s)", async manual => {
    const d = detail(history({ state: "awaiting_confirmation", latestVersionId: randomUUID(), latestVersionNo: 1, capabilities: { ...history().capabilities, canConfirm: true } }));
    const firstId = randomUUID(); const excludedId = randomUUID(); const issueId = randomUUID();
    const fields = { partNumber: "ONE", brand: "TI", qty: 2, price: "1", currency: "CNY", taxIncluded: true, dateCode: null, leadTime: null, note: null };
    const refs = [{ sheetIndex: 0, sheetName: "原表", rowNumber: 8, originalRowHash: d.originalSheets[0].rows[1].originalRowHash }];
    d.selectedVersion = { versionId: d.history.latestVersionId!, versionNo: 1, parentVersionId: null, createdAt: new Date().toISOString(), normalizedFile: null, issuesFile: null, issues: [], rows: [
      { rowId: firstId, logicalRowId: randomUUID(), sourceRefs: refs, candidate: fields, disposition: "pending", excludeReason: null, issues: [] },
      { rowId: excludedId, logicalRowId: randomUUID(), sourceRefs: refs, candidate: { ...fields, partNumber: "BAD", currency: null }, disposition: "pending", excludeReason: null, issues: [{ issueId, rowId: excludedId, field: "currency", message: "币种未知", resolved: false, resolution: null }] },
    ] };
    rt.get.mockImplementation(async () => structuredClone(d));
    rt.prepare.mockRejectedValue(new Error("offline stop after payload capture"));
    vi.stubGlobal("prompt", vi.fn(() => "原报价币种无法核实，本次明确不入库"));
    render(React.createElement(CustomerSupplyUploadDialog, { initialHistory: d, customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth }));
    await settle(); expect(document.body.textContent).toContain("解析结果核对");
    if (manual) change(document.querySelector(`[aria-label="核对问题${issueId}"]`)!, "人工核对为外币，不作换算");
    click(document.querySelector('[aria-label="移除原表第3行"]')!);
    expect(document.querySelector('[aria-label="核对客户来源类型"]')).toBeNull();
    click(button("导入1条")); await settle();
    const input = rt.prepare.mock.calls[0][0];
    expect(input.resolvedIssues).toEqual([{ issueId, resolution: manual ? "人工核对为外币，不作换算" : "明确排除此行：用户移除" }]);
    expect(input.confirmedRows).toHaveLength(1); expect(input.confirmedRows[0].rowId).toBe(firstId);
    expect(input.excludedRows).toEqual([{ logicalRowId: d.selectedVersion.rows[1].logicalRowId, reason: "用户移除", sourceRefs: refs }]);
    expect(window.prompt).not.toHaveBeenCalled();
    expect(input).toMatchObject({ expectedEnterpriseId: 31, expectedActorUserId: 7, expectedCustomerVersion: 4, expectedRevision: 4, versionId: d.history.latestVersionId });
    expect(input.batchRequestId).not.toBe(input.requestId); expect(rt.create).not.toHaveBeenCalled();
  });
});

describe("version-source exclusions and explicit global evidence", () => {
  it("blocks a linked channel until global explanation, includes original excluded issues, and restores the same frozen evidence/UUIDs", async () => {
    const d = detail(history({ state: "awaiting_confirmation", latestVersionId: randomUUID(), latestVersionNo: 1, capabilities: { ...history().capabilities, canConfirm: true } }));
    const firstId = randomUUID(); const excludedId = randomUUID(); const issueId = randomUUID(); const globalId = randomUUID();
    const fields = { partNumber: "ONE", brand: "TI", qty: 2, price: "1", currency: "CNY", taxIncluded: true, dateCode: null, leadTime: null, note: null };
    const refs = [{ sheetIndex: 0, sheetName: "原表", rowNumber: 8, originalRowHash: d.originalSheets[0].rows[1].originalRowHash }];
    d.selectedVersion = { versionId: d.history.latestVersionId!, versionNo: 1, parentVersionId: null, createdAt: new Date().toISOString(), normalizedFile: null, issuesFile: null, issues: [{ issueId: globalId, rowId: null, field: "other", message: "全表导入范围待明确", resolved: false, resolution: null }], rows: [
      { rowId: firstId, logicalRowId: randomUUID(), sourceRefs: refs, candidate: fields, disposition: "pending", excludeReason: null, issues: [] },
      { rowId: excludedId, logicalRowId: randomUUID(), sourceRefs: refs, candidate: { ...fields, currency: null }, disposition: "excluded", excludeReason: "原版本员工明确排除非本次报价", issues: [{ issueId, rowId: excludedId, field: "currency", message: "币种未知", resolved: false, resolution: null }] },
    ] };
    rt.context.mockResolvedValue({ customer: { id: 801, name: "授权客户", version: 4, industryCode: "electronic_components", archivedAt: null }, channel: { id: 411, active: true, revision: 8 }, canUpload: true, disabledReason: null });
    rt.get.mockImplementation(async () => structuredClone(d)); rt.prepare.mockRejectedValue(new Error("offline lost prepare reply"));
    const element = () => React.createElement(CustomerSupplyUploadDialog, { initialHistory: d, customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth });
    render(element()); await settle(); expect(document.body.textContent).toContain("解析结果核对");
    expect(document.querySelector('[aria-label="移除原表第3行"]')).toBeNull();
    expect(document.body.textContent).toContain("原版本员工明确排除非本次报价");
    expect(button("导入1条").disabled).toBe(true); click(button("导入1条")); expect(rt.prepare).not.toHaveBeenCalled();
    change(document.querySelector(`[aria-label="核对全局问题${globalId}"]`)!, "员工核实全部原工作表与本次导入范围");
    expect(button("导入1条").disabled).toBe(false); click(button("导入1条")); await settle();
    const input = rt.prepare.mock.calls[0][0];
    expect(input.resolvedIssues).toEqual([{ issueId: globalId, resolution: "员工核实全部原工作表与本次导入范围" }, { issueId, resolution: "明确排除此行：原版本员工明确排除非本次报价" }]);
    expect(input.excludedRows).toEqual([{ logicalRowId: d.selectedVersion.rows[1].logicalRowId, reason: "原版本员工明确排除非本次报价", sourceRefs: refs }]);
    expect(input.confirmedRows).toHaveLength(1); expect(input.expectedChannelId).toBe(411); expect(input.expectedChannelRevision).toBe(8);
    const saved = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
    expect(saved.preparation.sessionData.history.globalResolutions).toEqual([{ issueId: globalId, resolution: "员工核实全部原工作表与本次导入范围" }]);
    await act(async () => root?.unmount()); root = undefined;
    render(element()); await settle(); click(button("恢复原批次")); await settle();
    click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(rt.prepare.mock.calls[1][0]).toEqual(input); expect(rt.create).not.toHaveBeenCalled(); expect(rt.batch).not.toHaveBeenCalled();
  });
});
