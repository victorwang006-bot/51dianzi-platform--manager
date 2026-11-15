// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { webcrypto, randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
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
function detail(h = history()): HistoryDetail { return { history: h, versions: [], selectedVersion: null, confirmation: null, originalSheets: [{ sheetIndex: 0, sheetName: "原表", rows: [{ rowNumber: 1, cells: ["型号"], originalRowHash: "a".repeat(64), originalContent: "表头原文" }, { rowNumber: 8, cells: ["ONE", "TI"], originalRowHash: "b".repeat(64), originalContent: "完整原文" }] }] }; }
let root: Root | undefined; let host: HTMLElement;
function render(element?: React.ReactElement) { if (!root) { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); } act(() => root!.render(element ?? React.createElement(CustomerUploadHistoryDialog, { customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth }))); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
function button(text: string) { const b = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent?.trim() === text); if (!b) throw new Error(`missing ${text}: ${document.body.textContent}`); return b; }
function click(e: Element) { act(() => { e.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function change(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) { act(() => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); }); }
async function upload(label: string, rows: (string | number)[][], multiple = false) { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "结果"); if (multiple) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "第二结果"); const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }); const file = new File([bytes], "同名但明确任务.xlsx"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes }); const input = document.body.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; Object.defineProperty(input, "files", { value: [file], configurable: true }); await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); }); return file; }
beforeEach(() => { rt.current = true; Object.values(rt).forEach(value => { if (typeof value === "function" && "mockReset" in value) value.mockReset(); }); rt.list.mockResolvedValue({ items: [history()], nextCursor: null, canManage: true }); rt.get.mockResolvedValue(detail()); rt.mark.mockResolvedValue({ history: history(), idempotent: false }); rt.result.mockResolvedValue({ history: history(), version: {}, idempotent: false }); rt.download.mockResolvedValue({ fileName: "私有文件.csv", mimeType: "text/csv", byteSize: 3, sha256: "a".repeat(64), base64: btoa("abc") }); rt.context.mockResolvedValue({ customer: { id: 801, name: "授权客户", version: 4, industryCode: "electronic_components", archivedAt: null }, channel: null, canUpload: true, disabledReason: null }); sessionStorage.clear(); vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("confirm", vi.fn(() => true)); Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:private") }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("history ACL real portal", () => {
  it("lists only on open using exact verified scope and one real portal", async () => { render(); await settle(); expect(rt.list.mock.calls[0][0]).toMatchObject({ expectedEnterpriseId: 31, expectedActorUserId: 7, customerId: 801, view: "mine" }); expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1); expect(document.body.textContent).toContain(id); expect(rt.get).not.toHaveBeenCalled(); });
  it("only renders management tab with server canManage", async () => { rt.list.mockResolvedValue({ items: [history()], nextCursor: null, canManage: false }); render(); await settle(); expect(document.body.textContent).not.toContain("解析管理"); });
  it("management view drops fixed customer restriction and passes explicit filters, not actor impersonation", async () => { render(); await settle(); click(button("解析管理")); await settle(); expect(rt.list.mock.calls[1][0]).not.toHaveProperty("customerId"); change(document.querySelector('[aria-label="管理客户ID"]')!, "802"); change(document.querySelector('[aria-label="管理上传人ID"]')!, "12"); click(button("筛选")); await settle(); expect(rt.list.mock.calls.at(-1)![0]).toMatchObject({ view: "management", customerId: 802, uploadedByFrontUserId: 12, expectedActorUserId: 7 }); });
  it("uses ACL base64 download, creates only short-lived blob URL, no public URL", async () => { render(); await settle(); click(button("查看任务")); await settle(); click(button("下载原文件")); await settle(); expect(rt.download.mock.calls[0][0]).toEqual({ expectedEnterpriseId: 31, expectedActorUserId: 7, files: [{ historyId: id, fileId: history().originalFile.fileId }], includeManifest: false }); expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(File)); expect(document.body.querySelector('a[href^="http"]')).toBeNull(); });
  it("blocks bulk21files and explains explicit batching without sending download", async () => { rt.list.mockResolvedValue({ items: Array.from({ length: 21 }, () => history({ historyId: randomUUID() })), nextCursor: null, canManage: true }); render(); await settle(); document.querySelectorAll('input[type="checkbox"]').forEach(click); click(button("批量下载原文件＋任务清单ZIP（21）")); await settle(); expect(rt.download).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("明确分批"); });
  it("blocks bulk cumulative size over10MiB", async () => { const h = history(); h.originalFile.byteSize = 10485761; rt.list.mockResolvedValue({ items: [h], nextCursor: null, canManage: true }); render(); await settle(); click(document.querySelector('input[type="checkbox"]')!); click(button("批量下载原文件＋任务清单ZIP（1）")); expect(rt.download).not.toHaveBeenCalled(); });
  it("a management reader cannot impersonate uploader through confirm button", async () => { render(); await settle(); click(button("查看任务")); await settle(); expect(button("核对并上传").disabled).toBe(true); click(button("核对并上传")); expect(rt.prepare).not.toHaveBeenCalled(); expect(rt.create).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("不可正式确认"); });
  it("manage reason and revision CAS are preserved across unknown retry UUID", async () => { rt.mark.mockRejectedValueOnce(new Error("response lost")); render(); await settle(); click(button("查看任务")); await settle(); click(button("标记解析失败")); expect(rt.mark).not.toHaveBeenCalled(); change(document.querySelector('[aria-label="历史操作原因"]')!, "原表无法识别，需补充"); click(button("标记解析失败")); await settle(); const original = rt.mark.mock.calls[0][0]; expect(original).toMatchObject({ historyId: id, expectedRevision: 4, action: "fail_parse", reason: "原表无法识别，需补充" }); click(button("按原操作UUID重试（不换版本／任务）")); await settle(); expect(rt.mark.mock.calls[1][0]).toEqual(original); });
  it("result upload binds selected task UUID not filename and never directly creates inventory", async () => { render(); await settle(); click(button("查看任务")); await settle(); await upload("回传整理结果", [["型号", "品牌", "原工作表", "原行号", "原内容"], ["ONE", "TI", "原表", "8", "完整原文"]]); click(button("按此任务UUID保存新结果版本")); await settle(); expect(rt.result.mock.calls[0][0]).toMatchObject({ historyId: id, expectedRevision: 4, parentVersionId: null }); expect(rt.result.mock.calls[0][0].rows[0].sourceRefs[0].rowNumber).toBe(8); expect(rt.result.mock.calls[0][0].rows[0].candidate.currency).toBeNull(); expect(rt.result.mock.calls[0][0].rows[0].disposition).toBe("pending"); expect(rt.create).not.toHaveBeenCalled(); expect(rt.batch).not.toHaveBeenCalled(); });
  it("rejects result without source columns or with multiple sheets visibly", async () => { render(); await settle(); click(button("查看任务")); await settle(); await upload("回传整理结果", [["型号", "品牌"], ["ONE", "TI"]]); expect(document.body.textContent).toContain("来源列"); expect(rt.result).not.toHaveBeenCalled(); await upload("回传整理结果", [["型号", "品牌"], ["ONE", "TI"]], true); expect(document.body.textContent).toContain("一张结果"); });
  it("existing confirmation blocks result replacement and calls server reconciliation on reopen", async () => { const d = detail(); d.confirmation = { confirmationId: randomUUID(), batchRequestId: randomUUID(), batch: { id: 501, batchCode: randomUUID(), revision: 1, channelId: 411, customerId: 801 }, entries: [], versionId: null, excludedRows: [], createdAt: new Date().toISOString() }; rt.get.mockResolvedValue(d); rt.reconcile.mockResolvedValue({ history: d.history, entries: [], batch: d.confirmation.batch }); render(); await settle(); click(button("查看任务")); await settle(); expect(rt.reconcile).toHaveBeenCalledTimes(1); expect(document.querySelector('[aria-label="回传整理结果"]')).toBeNull(); expect(document.body.textContent).toContain("禁止回传新版本"); });
  it("stale root aborts outstanding read and suppresses old data", async () => {
    let resolve!: (d: any) => void;
    rt.list.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    render(); rt.current = false;
    // Abort must be checked while the read is still outstanding, not after finally removed it.
    await act(async () => root?.unmount()); root = undefined;
    expect(rt.list.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => { resolve({ items: [history()], nextCursor: null, canManage: true }); });
    expect(document.body.textContent).not.toContain(id);
  });
});
describe("parse-only upload and persistent original", () => {
  it("shows three modes in same existing portal and parse creates no formal queue", async () => { render(React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth })); await settle(); const group = document.querySelector('[aria-label="客户物料上传方式"]')!; expect(Array.from(group.querySelectorAll("button")).map(button => button.textContent)).toEqual(["表格上传", "单条上传", "解析上传"]); click(button("解析上传")); const bytes = new TextEncoder().encode("型号,品牌\nONE,TI"); const file = new File([bytes], "source.csv"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer }); const input = document.querySelector<HTMLInputElement>('[aria-label="上传待解析原表"]')!; Object.defineProperty(input, "files", { value: [file], configurable: true }); act(() => input.dispatchEvent(new Event("change", { bubbles: true }))); rt.original.mockResolvedValue({ history: history(), idempotent: false, duplicateWarning: false, submissionMessage: "已提交，等待解析" }); click(button("提交，等待解析")); await settle(); expect(rt.original.mock.calls[0][0].mode).toBe("parse"); expect(document.body.textContent).toContain("已提交，等待解析"); expect(rt.create).not.toHaveBeenCalled(); expect(rt.batch).not.toHaveBeenCalled(); expect(rt.prepare).not.toHaveBeenCalled(); });
  it("parse retry preserves original operation UUID after unknown transport outcome", async () => { render(React.createElement(CustomerSupplyUploadDialog, { customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth })); await settle(); click(button("解析上传")); const bytes = new TextEncoder().encode("型号,品牌\nONE,TI"); const file = new File([bytes], "source.csv"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer }); const input = document.querySelector<HTMLInputElement>('[aria-label="上传待解析原表"]')!; Object.defineProperty(input, "files", { value: [file], configurable: true }); act(() => input.dispatchEvent(new Event("change", { bubbles: true }))); rt.original.mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({ history: history(), idempotent: true, duplicateWarning: false, submissionMessage: "已提交，等待解析" }); click(button("提交，等待解析")); await settle(); click(button("按原UUID重试提交")); await settle(); expect(rt.original.mock.calls[1][0]).toEqual(rt.original.mock.calls[0][0]); expect(sessionStorage.length).toBe(0); });
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
  it("restores a lost mark reply after close using the same operation UUID and CAS", async () => {
    rt.mark.mockRejectedValueOnce(new Error("reply lost"));
    render(); await settle(); click(button("查看任务")); await settle();
    change(document.querySelector('[aria-label="历史操作原因"]')!, "原文件无法识别");
    click(button("标记解析失败")); await settle();
    const original = rt.mark.mock.calls[0][0];
    expect(sessionStorage.length).toBe(1);
    await act(async () => root?.unmount()); root = undefined;
    render(); await settle();
    expect(document.body.textContent).toContain(original.requestId);
    expect(rt.mark).toHaveBeenCalledTimes(1); // no automatic retry
    click(button("按原操作UUID重试（不换版本／任务）")); await settle();
    expect(rt.mark.mock.calls[1][0]).toEqual(original);
    expect(sessionStorage.length).toBe(0);
  });
  it("restores an uncertain result payload without new row IDs or another version request", async () => {
    rt.result.mockRejectedValueOnce(new Error("result reply lost"));
    render(); await settle(); click(button("查看任务")); await settle();
    await upload("回传整理结果", [["型号", "品牌", "原工作表", "原行号", "原内容"], ["ONE", "TI", "原表", "8", "完整原文"]]);
    click(button("按此任务UUID保存新结果版本")); await settle();
    const original = rt.result.mock.calls[0][0];
    await act(async () => root?.unmount()); root = undefined;
    render(); await settle();
    expect(rt.result).toHaveBeenCalledTimes(1);
    click(button("按原操作UUID重试（不换版本／任务）")); await settle();
    expect(rt.result.mock.calls[1][0]).toEqual(original);
    expect(rt.create).not.toHaveBeenCalled(); expect(rt.batch).not.toHaveBeenCalled();
  });
  it("does not send a management write when canonical recovery storage cannot be saved", async () => {
    render(); await settle(); click(button("查看任务")); await settle();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota denied"); });
    change(document.querySelector('[aria-label="历史操作原因"]')!, "需要补充原文件");
    click(button("标记解析失败")); await settle();
    expect(rt.mark).not.toHaveBeenCalled(); expect(rt.result).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("已阻止提交");
  });
});
