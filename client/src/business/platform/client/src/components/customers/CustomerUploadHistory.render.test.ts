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
import { customerSupplySessionSuffix } from "./customerSupply";
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

describe("issue transport and explicit exclusion regressions", () => {
  it("sends edited row issues once through the actual service assertion while retaining unknown candidates", async () => {
    render(); await settle(); click(button("查看任务")); await settle();
    await upload("回传整理结果", [["型号", "品牌", "原工作表", "原行号", "原内容"], ["ONE", "TI", "原表", "8", "完整原文"]]);
    const editors = Array.from(document.querySelectorAll<HTMLInputElement>('input[aria-label^="问题解决依据"]'));
    expect(editors.length).toBeGreaterThan(0);
    change(editors[0], "管理员核对原文件；字段仍留未知供员工确认");
    click(button("按此任务UUID保存新结果版本")); await settle();
    const input = rt.result.mock.calls[0][0];
    expect(input.issues).toEqual([]); expect(input.rows[0].issues).toHaveLength(editors.length);
    expect(input.rows[0].issues[0]).toMatchObject({ resolved: true, resolution: "管理员核对原文件；字段仍留未知供员工确认" });
    expect(input.rows[0].candidate).toMatchObject({ qty: null, price: null, currency: null, taxIncluded: null });
    expect(rt.auth).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
    expect(rt.create).not.toHaveBeenCalled(); expect(rt.batch).not.toHaveBeenCalled();
  });
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
    await settle(); click(button("预览并校验"));
    if (manual) change(document.querySelector(`[aria-label="核对问题${issueId}"]`)!, "人工核对为外币，不作换算");
    click(document.querySelector('[aria-label="移除原表第3行"]')!);
    change(document.querySelector('[aria-label="核对客户来源类型"]')!, "trade");
    click(button("确认上传 1 条")); await settle();
    const input = rt.prepare.mock.calls[0][0];
    expect(input.resolvedIssues).toEqual([{ issueId, resolution: manual ? "人工核对为外币，不作换算" : "明确排除此行：原报价币种无法核实，本次明确不入库" }]);
    expect(input.confirmedRows).toHaveLength(1); expect(input.confirmedRows[0].rowId).toBe(firstId);
    expect(input.excludedRows).toEqual([{ logicalRowId: d.selectedVersion.rows[1].logicalRowId, reason: "原报价币种无法核实，本次明确不入库", sourceRefs: refs }]);
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
    render(element()); await settle(); click(button("预览并校验"));
    expect(document.querySelector('[aria-label="移除原表第3行"]')).toBeNull();
    expect(document.body.textContent).toContain("原版本员工明确排除非本次报价");
    expect(button("确认上传 1 条").disabled).toBe(true); click(button("确认上传 1 条")); expect(rt.prepare).not.toHaveBeenCalled();
    change(document.querySelector(`[aria-label="核对全局问题${globalId}"]`)!, "员工核实全部原工作表与本次导入范围");
    expect(button("确认上传 1 条").disabled).toBe(false); click(button("确认上传 1 条")); await settle();
    const input = rt.prepare.mock.calls[0][0];
    expect(input.resolvedIssues).toEqual([{ issueId: globalId, resolution: "员工核实全部原工作表与本次导入范围" }, { issueId, resolution: "明确排除此行：原版本员工明确排除非本次报价" }]);
    expect(input.excludedRows).toEqual([{ logicalRowId: d.selectedVersion.rows[1].logicalRowId, reason: "原版本员工明确排除非本次报价", sourceRefs: refs }]);
    expect(input.confirmedRows).toHaveLength(1); expect(input.expectedChannelId).toBe(411); expect(input.expectedChannelRevision).toBe(8);
    const saved = JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);
    expect(saved.preparation.sessionData.history.globalResolutions).toEqual([{ issueId: globalId, resolution: "员工核实全部原工作表与本次导入范围" }]);
    await act(async () => root?.unmount()); root = undefined;
    render(element()); await settle(); click(button("恢复原批次")); await settle();
    click(button("按原批次继续 / 重试")); await settle();
    expect(rt.prepare.mock.calls[1][0]).toEqual(input); expect(rt.create).not.toHaveBeenCalled(); expect(rt.batch).not.toHaveBeenCalled();
  });
});

// Customer-only original lock regressions: real dialog, BatchUpload and parse
// entry with the existing offline tRPC mocks. No network or database writes.
type OriginalMode = "standard" | "parse";
const notSaved = () => Object.assign(new Error("原文件未保存：表格格式无效，请更换有效文件。"), { data: { code: "BAD_REQUEST" } });
function originalFile(text = "型号,品牌\nONE,TI", name = "same-original.csv") {
  const bytes = new TextEncoder().encode(text); const file = new File([bytes], name);
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer }); return file;
}
function supplyElement(initial: { initialFile?: File; initialHistory?: HistoryDetail } = {}) {
  return React.createElement(CustomerSupplyUploadDialog, { ...initial, customerId: 801, identity, isCurrent: () => rt.current, onClose: rt.close, onComplete: rt.complete, onAuthorizationError: rt.auth });
}
async function openOriginal(mode: OriginalMode) { render(supplyElement()); await settle(); if (mode === "parse") click(button("解析上传")); }
async function selectOriginal(file: File, mode: OriginalMode) {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${mode === "parse" ? "上传待解析原表" : "上传库存表格"}"]`)!;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); });
}
async function submitOriginal(file: File, mode: OriginalMode) { await selectOriginal(file, mode); if (mode === "parse") { click(button("提交，等待解析")); await settle(); } }
function originalKey() { return Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)!).find(key => key.startsWith("customer-upload-original:"))!; }
function originalReceipt(mode: OriginalMode) { const h = history({ mode, ...(mode === "standard" ? { state: "awaiting_confirmation" } : {}) }); return { history: h, idempotent: true, duplicateWarning: false, submissionMessage: "已提交，等待解析" }; }

describe("original upload exact rollback contract and CAS", () => {
  it.each(["standard", "parse"] as const)("%s: deterministic rollback releases only its lock, keeps error and permits a different file/new UUID", async mode => {
    rt.original.mockRejectedValueOnce(notSaved()).mockResolvedValueOnce(originalReceipt(mode));
    await openOriginal(mode); await submitOriginal(originalFile(), mode);
    const first = rt.original.mock.calls[0][0]; expect(originalKey()).toBeUndefined();
    expect(document.body.textContent).toContain("原文件未保存：表格格式无效");
    if (mode === "parse") { expect(button("替换文件").disabled).toBe(false); expect(document.body.textContent).not.toContain("提交可能已到达服务端"); }
    const next = originalFile("型号,品牌\nTWO,ADI"); await selectOriginal(next, mode);
    if (mode === "parse") { expect(document.body.textContent).toContain("原文件未保存：表格格式无效"); click(button("提交，等待解析")); await settle(); }
    expect(rt.original).toHaveBeenCalledTimes(2); const second = rt.original.mock.calls[1][0];
    expect(second.requestId).not.toBe(first.requestId); expect(second.file.fileName).toBe(first.file.fileName); expect(second.file.base64).not.toBe(first.file.base64);
    expect(originalKey()).toBeUndefined(); expect(document.body.textContent).toContain(mode === "parse" ? "已提交，等待解析" : "预览并校验");
    expect(rt.batch).not.toHaveBeenCalled(); expect(rt.create).not.toHaveBeenCalled();
  });

  const unknownErrors = [
    ["timeout", () => new Error("timeout")],
    ["500", () => Object.assign(new Error("原文件未保存：service failed"), { data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } })],
    ["service-unknown", () => Object.assign(new Error("service unknown"), { data: { code: "SERVICE_UNAVAILABLE" } })],
    ["text-only fake", () => new Error("BAD_REQUEST 原文件未保存：fake text")],
    ["HTTP400-only fake", () => Object.assign(new Error("原文件未保存：fake HTTP"), { data: { httpStatus: 400 }, code: "BAD_REQUEST" })],
    ["other BAD_REQUEST", () => Object.assign(new Error("权限或客户版本校验失败"), { data: { code: "BAD_REQUEST" } })],
    ["embedded prefix", () => Object.assign(new Error("upstream 原文件未保存：not stable prefix"), { data: { code: "BAD_REQUEST" } })],
    ["empty explanation", () => Object.assign(new Error("原文件未保存："), { data: { code: "BAD_REQUEST" } })],
  ] as const;
  it.each((["standard", "parse"] as const).flatMap(mode => unknownErrors.map(([name, error]) => [mode, name, error] as const)))("%s: %s remains locked and retries exact UUID/content", async (mode, _name, makeError) => {
    rt.original.mockRejectedValueOnce(makeError()).mockResolvedValueOnce(originalReceipt(mode));
    await openOriginal(mode); const file = originalFile(); await submitOriginal(file, mode);
    const first = rt.original.mock.calls[0][0]; const key = originalKey(); const raw = sessionStorage.getItem(key);
    expect(JSON.parse(raw!).requestId).toBe(first.requestId);
    await selectOriginal(originalFile("型号,品牌\nDIFFERENT,TI"), mode);
    expect(rt.original).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(key)).toBe(raw);
    if (mode === "parse") { expect(button("替换文件").disabled).toBe(true); expect(document.body.textContent).toContain("提交可能已到达服务端"); click(button("按原UUID重试提交")); await settle(); }
    else await selectOriginal(file, mode);
    expect(rt.original.mock.calls[1][0]).toEqual(first); expect(originalKey()).toBeUndefined();
  });

  it.each(["success", "rejection"] as const)("late %s after current identity loss retains original lock and suppresses UI release", async outcome => {
    let complete!: (value: any) => void; rt.original.mockImplementationOnce(() => new Promise((resolve, reject) => { complete = outcome === "success" ? resolve : reject; }));
    await openOriginal("parse"); await submitOriginal(originalFile(), "parse"); const key = originalKey(); const raw = sessionStorage.getItem(key);
    rt.current = false; await act(async () => complete(outcome === "success" ? originalReceipt("parse") : notSaved())); await settle();
    expect(sessionStorage.getItem(key)).toBe(raw); expect(document.body.textContent).not.toContain("已提交，等待解析"); expect(rt.auth).not.toHaveBeenCalled();
  });
  it.each(["success", "rejection"] as const)("late %s after unmount aborts and does not delete a newer request lock", async outcome => {
    let complete!: (value: any) => void; rt.original.mockImplementationOnce(() => new Promise((resolve, reject) => { complete = outcome === "success" ? resolve : reject; }));
    await openOriginal("parse"); await submitOriginal(originalFile(), "parse"); const key = originalKey(); const next = { ...JSON.parse(sessionStorage.getItem(key)!), requestId: randomUUID() };
    await act(async () => root?.unmount()); root = undefined; expect(rt.original.mock.calls[0][1].signal.aborted).toBe(true);
    sessionStorage.setItem(key, JSON.stringify(next)); await act(async () => complete(outcome === "success" ? originalReceipt("parse") : notSaved())); await settle();
    expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual(next);
  });
  it.each((["success", "rejection"] as const).flatMap(outcome => ["requestId", "hash", "mode", "fileName", "customerVersion", "raw", "corrupt", "missing"].map(field => [outcome, field] as const)))("%s never clears a changed %s lock", async (outcome, field) => {
    let complete!: (value: any) => void; rt.original.mockImplementationOnce(() => new Promise((resolve, reject) => { complete = outcome === "success" ? resolve : reject; }));
    await openOriginal("parse"); await submitOriginal(originalFile(), "parse"); const key = originalKey(); const prior = JSON.parse(sessionStorage.getItem(key)!);
    const changes: Record<string, unknown> = { requestId: randomUUID(), hash: "b".repeat(64), mode: "standard", fileName: "another.csv", customerVersion: 5 };
    const changed = field === "raw" ? ` ${JSON.stringify(prior)}` : field === "corrupt" ? "{bad JSON" : JSON.stringify({ ...prior, [field]: changes[field] });
    if (field === "missing") sessionStorage.removeItem(key); else sessionStorage.setItem(key, changed);
    await act(async () => complete(outcome === "success" ? originalReceipt("parse") : notSaved())); await settle();
    expect(sessionStorage.getItem(key)).toBe(field === "missing" ? null : changed); expect(button("替换文件").disabled).toBe(true);
    // In-memory operation must not be recreated even if the external key vanished.
    click(button("按原UUID重试提交")); await settle(); expect(rt.original).toHaveBeenCalledTimes(1);
  });

  it.each(["read", "write", "bad-json", "silent-write"] as const)("%s storage failure blocks the original mutation and does not announce release", async failure => {
    await openOriginal("parse");
    if (failure === "read") vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage read denied"); });
    if (failure === "write") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage quota denied"); });
    if (failure === "silent-write") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => undefined);
    if (failure === "bad-json") sessionStorage.setItem(`customer-upload-original:${customerSupplySessionSuffix(identity, 801)}`, "not json");
    await submitOriginal(originalFile(), "parse"); expect(rt.original).not.toHaveBeenCalled(); expect(button("替换文件").disabled).toBe(true);
    expect(document.body.textContent).toContain("提交可能已到达服务端");
  });
  it.each((["success", "rejection"] as const).flatMap(outcome => ["read", "delete", "silent-delete"].map(failure => [outcome, failure] as const)))("%s plus cleanup %s failure stays fail-closed", async (outcome, failure) => {
    let complete!: (value: any) => void; rt.original.mockImplementationOnce(() => new Promise((resolve, reject) => { complete = outcome === "success" ? resolve : reject; }));
    await openOriginal("parse"); await submitOriginal(originalFile(), "parse"); const key = originalKey(); const raw = sessionStorage.getItem(key);
    let spy: ReturnType<typeof vi.spyOn>;
    if (failure === "read") spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("read denied"); });
    else spy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { if (failure === "delete") throw new Error("delete denied"); });
    await act(async () => complete(outcome === "success" ? originalReceipt("parse") : notSaved())); await settle(); spy.mockRestore();
    expect(sessionStorage.getItem(key)).toBe(raw); expect(button("替换文件").disabled).toBe(true); expect(document.body.textContent).not.toContain("已提交，等待解析");
  });
});

describe("standard original acknowledged history reuse", () => {
  it("original success plus historyGet failure retries only the manifest/history, not original", async () => {
    rt.original.mockResolvedValue(originalReceipt("standard")); rt.get.mockRejectedValueOnce(new Error("history unavailable")).mockResolvedValueOnce(detail(originalReceipt("standard").history));
    await openOriginal("standard"); await submitOriginal(originalFile(), "standard");
    expect(rt.original).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain("history unavailable");
    click(button("按原文件重试保存／读取")); await settle();
    expect(rt.original).toHaveBeenCalledTimes(1); expect(rt.get).toHaveBeenCalledTimes(2); expect(rt.get.mock.calls[1][0]).toEqual(rt.get.mock.calls[0][0]);
    expect(document.body.textContent).toContain("预览并校验");
  });
  it("same File with rows reuses the acknowledged history and row evidence even after local workbook read failure", async () => {
    rt.original.mockResolvedValue(originalReceipt("standard"));
    const bytes = new TextEncoder().encode("型号,品牌\nONE,TI"); const file = new File([bytes], "original.csv");
    const read = vi.fn().mockResolvedValueOnce(bytes.buffer).mockRejectedValueOnce(new Error("local read lost after manifest")).mockResolvedValue(bytes.buffer);
    Object.defineProperty(file, "arrayBuffer", { value: read }); await openOriginal("standard"); await submitOriginal(file, "standard");
    expect(document.body.textContent).toContain("local read lost after manifest"); expect(rt.original).toHaveBeenCalledTimes(1); expect(rt.get).toHaveBeenCalledTimes(1);
    click(button("按原文件重试保存／读取")); await settle(); expect(rt.original).toHaveBeenCalledTimes(1); expect(rt.get).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("预览并校验");
  });
  it("initialHistory plus exact initialFile never invokes customerUploadOriginal, including manifest retry", async () => {
    const file = originalFile(); const d = detail(history({ mode: "standard", state: "awaiting_confirmation", capabilities: { ...history().capabilities, canConfirm: true } }));
    rt.get.mockRejectedValueOnce(new Error("initial manifest unavailable")).mockResolvedValueOnce(d);
    render(supplyElement({ initialFile: file, initialHistory: d })); await settle(); await settle();
    expect(rt.original).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("initial manifest unavailable"); click(button("按原文件重试保存／读取")); await settle();
    expect(rt.original).not.toHaveBeenCalled(); expect(rt.get).toHaveBeenCalledTimes(2); expect(document.body.textContent).toContain("预览并校验");
  });
  it("a repeated synthetic same-File selection while in flight cannot produce a second request UUID/mutation", async () => {
    let complete!: (value: any) => void; rt.original.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    await openOriginal("standard"); const file = originalFile(); await submitOriginal(file, "standard"); const key = originalKey(); const raw = sessionStorage.getItem(key);
    await selectOriginal(file, "standard"); expect(rt.original).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(key)).toBe(raw);
    await act(async () => complete(originalReceipt("standard"))); await settle(); expect(rt.original).toHaveBeenCalledTimes(1); expect(originalKey()).toBeUndefined();
    expect(document.body.textContent).toContain("预览并校验");
  });
});

describe("original fail-closed pre-send and cleanup boundaries", () => {
  it.each(["throws", "silent"] as const)("storage write %s retains the allocated in-memory UUID and cannot recreate after storage recovery", async failure => {
    await openOriginal("parse"); const ids = vi.spyOn(crypto, "randomUUID");
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { if (failure === "throws") throw new Error("quota denied"); });
    await submitOriginal(originalFile(), "parse"); expect(ids).toHaveBeenCalledTimes(1); expect(rt.original).not.toHaveBeenCalled(); write.mockRestore();
    click(button("按原UUID重试提交")); await settle(); expect(ids).toHaveBeenCalledTimes(1); expect(rt.original).not.toHaveBeenCalled(); expect(originalKey()).toBeUndefined();
    expect(button("替换文件").disabled).toBe(true);
  });
  it.each(["success", "rejection"] as const)("%s with post-delete verification read failure keeps memory locked and never announces release", async outcome => {
    let complete!: (value: any) => void; rt.original.mockImplementationOnce(() => new Promise((resolve, reject) => { complete = outcome === "success" ? resolve : reject; }));
    await openOriginal("parse"); await submitOriginal(originalFile(), "parse"); const key = originalKey();
    const getItem = Storage.prototype.getItem;
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, name: string) {
      const value = getItem.call(this, name); if (name === key && value === null) throw new Error("verification denied"); return value;
    });
    await act(async () => complete(outcome === "success" ? originalReceipt("parse") : notSaved())); await settle(); read.mockRestore();
    expect(sessionStorage.getItem(key)).toBeNull(); expect(button("替换文件").disabled).toBe(true); expect(document.body.textContent).not.toContain("已提交，等待解析");
    click(button("按原UUID重试提交")); await settle(); expect(rt.original).toHaveBeenCalledTimes(1);
  });
  it("the same rollback-shaped error from customer context does not release original lock or notify parse as released", async () => {
    await openOriginal("parse"); rt.context.mockRejectedValueOnce(notSaved()); await submitOriginal(originalFile(), "parse");
    expect(rt.original).not.toHaveBeenCalled(); expect(originalKey()).toBeDefined(); expect(button("替换文件").disabled).toBe(true);
    expect(document.body.textContent).toContain("提交可能已到达服务端");
  });
  it("a changed customer version before mutation retains its exact lock and prevents the write", async () => {
    await openOriginal("parse"); rt.context.mockResolvedValueOnce({ customer: { id: 801, name: "授权客户", version: 5, industryCode: "electronic_components", archivedAt: null }, channel: null, canUpload: true, disabledReason: null });
    await submitOriginal(originalFile(), "parse"); expect(rt.original).not.toHaveBeenCalled(); expect(JSON.parse(sessionStorage.getItem(originalKey())!).customerVersion).toBe(4);
    expect(button("替换文件").disabled).toBe(true);
  });
  it("same-File concurrent selection already joins at the encoding stage before UUID allocation", async () => {
    await openOriginal("standard"); rt.original.mockResolvedValue(originalReceipt("standard"));
    const bytes = new TextEncoder().encode("型号,品牌\nONE,TI"); const file = new File([bytes], "original.csv"); let finish!: (bytes: ArrayBuffer) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise<ArrayBuffer>(resolve => { finish = resolve; })).mockResolvedValue(bytes.buffer);
    Object.defineProperty(file, "arrayBuffer", { value: read }); const ids = vi.spyOn(crypto, "randomUUID");
    await selectOriginal(file, "standard"); await selectOriginal(file, "standard"); expect(read).toHaveBeenCalledTimes(1); expect(ids).not.toHaveBeenCalled(); expect(rt.original).not.toHaveBeenCalled();
    await act(async () => { finish(bytes.buffer); await new Promise(resolve => setTimeout(resolve, 40)); });
    expect(rt.original).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain("预览并校验");
  });
});
