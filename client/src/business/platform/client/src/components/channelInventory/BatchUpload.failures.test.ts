// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { randomUUID, webcrypto } from "node:crypto";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchUpload, type CustomerConfirmRows } from "./BatchUpload";
import { emptyDraft, fields, templateGrid, toPayload, type Draft } from "./import";
import type { BatchEntry } from "./queue";
import { readFileSync } from "node:fs";

const downloads = vi.hoisted(() => ({ files: [] as { name: string; bytes: Uint8Array }[] }));
vi.mock("xlsx", async importOriginal => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFileXLSX: (book: XLSX.WorkBook, name: string) => {
    downloads.files.push({ name, bytes: actual.write(book, { type: "buffer", bookType: "xlsx" }) });
  } };
});
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storageKey = "d51-channel-inventory-batch-v1:7:31:failures";
const create = vi.fn();
const prepare = vi.fn();
const persistOriginal = vi.fn();
let root: Root;
let host: HTMLDivElement;
let generation = 0;
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("missing control"); return value; }
function button(text: string) { return required(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === text)); }
function click(element: Element) { act(() => { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); }
function input(label: string, value: string) {
  const control = required(document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`));
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(control, value); control.dispatchEvent(new Event("input", { bubbles: true })); });
}
function select(label: string, value: string) {
  const control = required(document.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`));
  act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(control, value); control.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); }
function row(rowNumber: number, changes: Partial<Draft> = {}, issues: unknown[] = []) {
  return { row: rowNumber, draft: { ...emptyDraft, partNumber: `PART-${rowNumber}`, brand: "TI", ...changes }, metadata: { row: rowNumber, issues } };
}
function render(overrides: Partial<React.ComponentProps<typeof BatchUpload>> = {}) {
  act(() => root.render(React.createElement(BatchUpload, {
    key: ++generation, channels: [{ id: 11, name: "授权客户", active: true }], channelTotal: 1, initialChannelId: 11,
    enterpriseId: 31, actorUserId: 7, customerSourceReady: true, fixedSource: true, storageKeySuffix: "failures", dialogMode: "content",
    onClose: vi.fn(), onCreate: create, onCreateCustomerBatch: prepare, onOriginalFilePersist: persistOriginal, skipIssueRows: true,
    onComplete: vi.fn(), isCurrent: () => true, onDirtyChange: vi.fn(), onBusyChange: vi.fn(),
    onLoadMoreChannels: vi.fn(), loadingMoreChannels: false, ...overrides,
  })));
}
function exported(index = downloads.files.length - 1) {
  const file = required(downloads.files[index]);
  const workbook = XLSX.read(file.bytes, { type: "array" });
  return { name: file.name, cells: XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true }) };
}
function save(entries: BatchEntry[]) {
  sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, actorUserId: 7, enterpriseId: 31, channelId: 11, name: "frozen.xlsx", entries }));
}
beforeEach(() => {
  sessionStorage.clear(); downloads.files = [];
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("REAL_NETWORK_FORBIDDEN"); }));
  create.mockReset().mockResolvedValue({ idempotent: false }); prepare.mockReset().mockResolvedValue({ id: 81, channelId: 11, batchCode: "BATCH-81", revision: 1 });
  persistOriginal.mockReset().mockResolvedValue({ sessionData: {}, rows: [] });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.replaceChildren(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("customer inventory cell review and failure XLSX", () => {
  it("edits validation cells directly, highlights only invalid cells and reconfirms repaired values", async () => {
    render({ initialRows: [row(2, { brand: "", qty: "bad", price: "0.123456789012", dateCode: "0024", note: "原备注" })], skipIssueRows: false });
    const brand = required(document.querySelector<HTMLInputElement>('[aria-label="核对第2行品牌"]'));
    expect(brand.closest("details")).toBeNull(); expect(brand.closest("td")?.classList.contains("has-cell-error")).toBe(true);
    expect(brand.getAttribute("aria-invalid")).toBe("true");
    expect(document.querySelector('[aria-label="核对第2行型号"]')?.closest("td")?.classList.contains("has-cell-error")).toBe(false);
    expect(document.querySelector("thead")?.textContent).not.toContain("人工核对编辑");
    expect(document.querySelectorAll("tbody tr td.ci-batch-edit-cell")).toHaveLength(fields.length);
    expect(button("确认导入 1 条").disabled).toBe(true);
    input("核对第2行品牌", "ADI"); input("核对第2行可供数量", "25"); input("核对第2行交期", "3天"); input("核对第2行备注", "已修改备注");
    expect(document.querySelectorAll(".has-cell-error")).toHaveLength(0);
    expect(button("确认导入 1 条").disabled).toBe(false);
    click(button("确认导入 1 条")); await settle();
    const confirmed: CustomerConfirmRows = prepare.mock.calls[0][1];
    expect(confirmed.confirmedDrafts[0].draft).toMatchObject({ brand: "ADI", qty: "25", price: "0.123456789012", dateCode: "0024", leadTime: "3天", note: "已修改备注" });
    expect(create.mock.calls[0][0]).toMatchObject({ brand: "ADI", qty: 25, price: "0.123456789012", dateCode: "0024" });
  });

  it("serializes all 1000 problem rows in template order with edited last-page values and reasons", async () => {
    render({ initialRows: Array.from({ length: 1000 }, (_, i) => row(i + 2, { qty: "wrong", price: "0.123456789012", dateCode: "0024" })) });
    expect(document.querySelectorAll("tbody tr")).toHaveLength(100);
    select("核对表分页页码", "10");
    const last = required(document.querySelector<HTMLInputElement>('[aria-label="核对第1001行品牌"]'));
    expect(last.closest("details")).toBeNull(); input("核对第1001行品牌", "已修改末行");
    click(button("导出失败记录")); await settle();
    const file = exported(); expect(file.name).toMatch(/^库存_失败记录_\d{8}_\d{4}\.xlsx$/);
    expect(file.cells[0]).toEqual([...templateGrid()[0], "失败原因"]); expect(file.cells).toHaveLength(1001);
    expect(file.cells[1000]).toEqual(["PART-1001", "已修改末行", "wrong", "0024", "0.123456789012", "CNY", "待确认", "", "", expect.stringContaining("数量格式无效")]);
    expect(create).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(persistOriginal).not.toHaveBeenCalled(); expect(sessionStorage.getItem(storageKey)).toBeNull();
    input("核对第1001行可供数量", "1");
    expect(document.querySelector<HTMLInputElement>('[aria-label="核对第1001行品牌"]')?.value).toBe("已修改末行");
    expect(button("导入1条").disabled).toBe(false);
    select("核对表分页页码", "1"); select("核对表分页页码", "10");
    expect(document.querySelector<HTMLInputElement>('[aria-label="核对第1001行可供数量"]')?.value).toBe("1");
    click(button("导入1条")); await settle();
    expect(prepare.mock.calls[0][1].confirmedDrafts).toHaveLength(1);
    expect(prepare.mock.calls[0][1].confirmedDrafts[0]).toMatchObject({ row: 1001, draft: { brand: "已修改末行", qty: "1" } });
    expect(prepare.mock.calls[0][1].excludedRows).toHaveLength(999);
  });

  it("exports current invalid tax text, exact price text and explicit removals, never valid retained rows", async () => {
    render({ initialRows: [row(2), row(3, { qty: "wrong", taxIncluded: "税率未知" }), row(4)] });
    input("核对第3行报价（CNY）", "9.000000000001"); input("核对第3行备注", "修改后");
    click(required(document.querySelector('[aria-label="移除原表第4行"]')));
    click(button("导出失败记录")); await settle();
    const cells = exported().cells; expect(cells).toHaveLength(3);
    expect(cells[1]).toEqual(["PART-3", "TI", "wrong", "", "9.000000000001", "CNY", "税率未知", "", "修改后", expect.stringContaining("数量格式无效")]);
    expect(cells[2][0]).toBe("PART-4"); expect(cells[2][9]).toBe("已移除：用户移除");
    expect(cells.flat()).not.toContain("PART-2");
  });

  it("keeps skipped validation rows exportable after good rows succeed, without exporting successful queue rows", async () => {
    render({ initialRows: [row(2), row(3, { qty: "wrong" })] });
    input("核对第3行品牌", "核对后的品牌"); click(button("导入1条")); await settle();
    expect(document.querySelector(".ci-batch-result h3")?.textContent).toBe("已导入1条 · 跳过1条");
    expect(button("导出失败记录").disabled).toBe(false); click(button("导出失败记录")); await settle();
    const cells = exported().cells; expect(cells).toHaveLength(2); expect(cells[1][0]).toBe("PART-3"); expect(cells[1][1]).toBe("核对后的品牌");
    expect(cells[1][9]).toContain("数量格式无效"); expect(cells.flat()).not.toContain("PART-2"); expect(create).toHaveBeenCalledTimes(1);
  });

  it("allows per-cell currency confirmation without converting prices or resolving server issues implicitly", async () => {
    const issue = { issueId: "currency-2", field: "currency", message: "币种依据待核对", resolved: false, resolution: null };
    render({ initialRows: [row(2, { currency: "USD", price: "12.345" }, [issue])] });
    expect(button("导入0条").disabled).toBe(true);
    select("核对第2行币种", "CNY"); expect(button("导入0条").disabled).toBe(true); expect(issue.resolved).toBe(false);
    input("核对问题currency-2", "已核实原报价为人民币");
    expect(button("导入1条").disabled).toBe(false); click(button("导入1条")); await settle();
    expect(create.mock.calls[0][0]).toMatchObject({ currency: "CNY", price: "12.345" });
  });

  it("exports only non-success frozen entries, labels unknown honestly and retries the original UUID/payload after restore", async () => {
    const queue: BatchEntry[] = ["success", "unknown", "pending"].map((status, i) => ({ row: i + 2, requestId: randomUUID(),
      status: status as BatchEntry["status"], payload: toPayload(row(i + 2, { partNumber: `FROZEN-${i}`, qty: "4", price: "2.500000000001", note: "服务端冻结值" }).draft, 11),
      ...(status === "unknown" ? { error: "网络中断" } : {}),
    }));
    save(queue); render(); click(button("恢复原批次")); const before = sessionStorage.getItem(storageKey);
    expect(document.querySelector('[aria-label="核对第3行型号"]')).toBeNull();
    expect(document.body.textContent).toContain("待确认不代表已失败");
    click(button("导出失败记录")); await settle();
    expect(sessionStorage.getItem(storageKey)).toBe(before); expect(create).not.toHaveBeenCalled();
    const file = exported(); expect(file.cells).toHaveLength(3); expect(file.cells.flat()).not.toContain("FROZEN-0");
    expect(file.cells[1]).toEqual(["FROZEN-1", "TI", "4", "", "2.500000000001", "CNY", "待确认", "", "服务端冻结值", "待确认（非已确认失败），请按原请求重试：网络中断"]);
    expect(file.cells[2][9]).toBe("未完成 / 等待上传");
    render(); click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(create.mock.calls).toEqual([[queue[1].payload, queue[1].requestId], [queue[2].payload, queue[2].requestId]]);
    expect(prepare).not.toHaveBeenCalled(); expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(button("导出失败记录").disabled).toBe(true);
  });

  it("paginates every unfinished result and exports beyond the old 50-row result limit", async () => {
    const queue: BatchEntry[] = Array.from({ length: 1000 }, (_, i) => ({ row: i + 2, requestId: randomUUID(), status: "pending", payload: toPayload(row(i + 2).draft, 11) }));
    save(queue); render(); click(button("恢复原批次")); select("结果表分页页码", "10");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(100); expect(document.querySelector("tbody")?.textContent).toContain("PART-1001");
    click(button("导出失败记录")); await settle(); expect(exported().cells).toHaveLength(1001); expect(exported().cells[1000][0]).toBe("PART-1001");
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps an unknown customer preparation immutable and offers the original-request retry", async () => {
    prepare.mockRejectedValueOnce(new Error("prepare receipt unknown")); render({ initialRows: [row(2)] });
    click(button("导入1条")); await settle(); const original = structuredClone(prepare.mock.calls[0]);
    expect(document.body.textContent).toContain("客户批次结果待确认"); expect(document.querySelectorAll(".ci-batch-cell-control")).toHaveLength(0);
    expect(button("导出失败记录").disabled).toBe(true);
    render(); click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(prepare.mock.calls[1]).toEqual(original);
  });

  it("defines a scrollable table with a sticky header and red error-cell styling, without owning fullscreen", () => {
    const css = readFileSync(`${process.cwd()}/client/src/business/platform/client/src/components/channelInventory/batch.css`, "utf8");
    expect(css).toMatch(/\.ci-batch-preview\.ci-batch-review\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*auto;/);
    expect(css).toMatch(/\.ci-batch-review th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*2;/);
    expect(css).toMatch(/\.ci-batch-review \.has-cell-error > \.ci-batch-cell-control\s*\{[^}]*border-color:\s*#dc2626;/);
  });

  it("exports a real original XLSX in brand/model/CNY/quantity/annotation order with current mapped edits and unmapped annotations intact", async () => {
    const cells = [["品牌", "型号", "CNY", "数量", "附注"], ["TI", "RAW-MODEL", "CNY", "bad", "原附注：不能丢弃"]];
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(cells), "来源");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }); const file = new File([bytes], "原列顺序.xlsx");
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
    persistOriginal.mockResolvedValue({ sessionData: {}, rows: [{ row: 2, metadata: { logicalRowId: randomUUID(), sourceRefs: [{ sheetIndex: 0, sheetName: "来源", rowNumber: 2, originalRowHash: "a".repeat(64) }], issues: [] } }] });
    render(); const upload = required(document.querySelector<HTMLInputElement>('[aria-label="上传库存表格"]'));
    Object.defineProperty(upload, "files", { configurable: true, value: [file] });
    await act(async () => { upload.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 50)); });
    select("匹配币种", "2");
    input("核对第2行品牌", "ADI"); input("核对第2行型号", "EDITED-MODEL"); input("核对第2行可供数量", "still-invalid");
    click(button("导出失败记录")); await settle();
    const output = exported().cells;
    expect(output[0]).toEqual([...cells[0], "失败原因"]);
    expect(output[1]).toEqual(["ADI", "EDITED-MODEL", "CNY", "still-invalid", "原附注：不能丢弃", expect.stringContaining("数量格式无效")]);
    expect(create).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(persistOriginal).toHaveBeenCalledTimes(1);
  });

  it("retains both an unknown immutable queue row and edited skipped validation row in XLSX after close and restore", async () => {
    create.mockRejectedValueOnce(new Error("网络中断：回执未知")); const onClose = vi.fn();
    render({ onClose, initialRows: [row(2, { partNumber: "FROZEN-UNKNOWN", qty: "4", note: "冻结备注" }), row(3, { partNumber: "SKIPPED-BAD", qty: "wrong", note: "坏行原备注" })] });
    input("核对第3行品牌", "EDITED-BAD-BRAND"); input("核对第3行备注", "坏行已修改备注");
    click(button("导入1条")); await settle(); const originalCall = structuredClone(create.mock.calls[0]);
    const stored = required(sessionStorage.getItem(storageKey));
    click(button("导出失败记录")); await settle(); const beforeExport = exported().cells;
    expect(beforeExport).toHaveLength(3); expect(beforeExport.flat()).toContain("SKIPPED-BAD"); expect(beforeExport.flat()).toContain("FROZEN-UNKNOWN");
    click(button("关闭")); expect(onClose).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(storageKey)).toBe(stored);
    render({ onClose }); click(button("恢复原批次")); click(button("导出失败记录")); await settle();
    const restored = exported().cells; expect(restored).toEqual(beforeExport);
    const bad = required(restored.find(cells => cells[0] === "SKIPPED-BAD"));
    expect(bad[1]).toBe("EDITED-BAD-BRAND"); expect(bad[8]).toBe("坏行已修改备注"); expect(bad[9]).toContain("数量格式无效");
    const unknown = required(restored.find(cells => cells[0] === "FROZEN-UNKNOWN")); expect(unknown[9]).toContain("待确认（非已确认失败）");
    expect(create).toHaveBeenCalledTimes(1); expect(prepare).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(storageKey)).toBe(stored);
    click(button("继续处理未完成（沿用原请求）")); await settle(); expect(create.mock.calls[1]).toEqual(originalCall);
    expect(create.mock.calls.every(([payload]) => payload.partNumber === "FROZEN-UNKNOWN")).toBe(true);
  });
});
