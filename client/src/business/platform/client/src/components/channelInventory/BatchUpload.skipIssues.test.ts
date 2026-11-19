// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { randomUUID, webcrypto } from "node:crypto";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchUpload, type CustomerConfirmRows } from "./BatchUpload";
import { emptyDraft, type Draft } from "./import";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const key = "d51-channel-inventory-batch-v1:7:31:skip-issues";
const create = vi.fn();
const prepare = vi.fn();
const persistOriginal = vi.fn();
const view = vi.fn();
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
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
function row(rowNumber: number, changes: Partial<Draft> = {}, issues: unknown[] = []) {
  return { row: rowNumber, draft: { ...emptyDraft, partNumber: `PART-${rowNumber}`, brand: "TI", ...changes },
    metadata: { row: rowNumber, rowId: randomUUID(), logicalRowId: randomUUID(), issues,
      sourceRefs: [{ sheetIndex: 0, sheetName: "首表", rowNumber, originalRowHash: "a".repeat(64) }] } };
}
function render(overrides: Partial<React.ComponentProps<typeof BatchUpload>> = {}) {
  act(() => root.render(React.createElement(BatchUpload, {
    key: ++generation, channels: [{ id: 11, name: "授权客户", active: true }], channelTotal: 1, initialChannelId: 11,
    enterpriseId: 31, actorUserId: 7, customerSourceReady: true, fixedSource: true, storageKeySuffix: "skip-issues",
    onClose: vi.fn(), onCreate: create, onCreateCustomerBatch: prepare, onOriginalFilePersist: persistOriginal, skipIssueRows: true,
    onComplete: vi.fn(), onViewResults: view, isCurrent: () => true, onDirtyChange: vi.fn(), onBusyChange: vi.fn(),
    onLoadMoreChannels: vi.fn(), loadingMoreChannels: false, ...overrides,
  })));
}
async function upload(rows: (string | number)[][]) {
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "首表");
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const file = new File([bytes], "private-original.xlsx"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  const control = required(document.querySelector<HTMLInputElement>('[aria-label="上传库存表格"]'));
  Object.defineProperty(control, "files", { configurable: true, value: [file] });
  await act(async () => { control.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 50)); });
  return file;
}
function confirmation(call = 0): CustomerConfirmRows { return required(prepare.mock.calls[call]?.[1]); }
beforeEach(() => {
  sessionStorage.clear(); vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal("prompt", vi.fn(() => { throw new Error("PROMPT_FORBIDDEN"); }));
  create.mockReset().mockResolvedValue({ idempotent: false }); prepare.mockReset().mockResolvedValue({ id: 81, channelId: 11, batchCode: randomUUID(), revision: 1 });
  persistOriginal.mockReset().mockResolvedValue({ sessionData: { history: { historyId: randomUUID() } }, rows: [] }); view.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("customer spreadsheet explicit problem skipping", () => {
  it("imports all 275 good rows while displaying and excluding 43 bad rows with original evidence", async () => {
    const serverRows = Array.from({ length: 318 }, (_, i) => row(i + 2));
    persistOriginal.mockResolvedValue({ sessionData: { history: { historyId: randomUUID() } }, rows: serverRows.map(item => ({ row: item.row, metadata: item.metadata })) });
    render(); const file = await upload([["型号", "品牌", "数量", "币种"], ...serverRows.map((item, i) => [item.draft.partNumber, "TI", i < 275 ? "2" : "数量未知", "CNY"])]);
    expect(persistOriginal).toHaveBeenCalledTimes(1); expect(persistOriginal).toHaveBeenCalledWith(file);
    expect(document.querySelector(".ci-batch-summary")?.textContent).toBe("可导入 275 条 · 问题 43 条");
    expect(button("导入275条").disabled).toBe(false); expect(document.querySelector(".ci-batch-footer")?.textContent).toContain("跳过43条");
    click(button("导入275条")); await settle();
    const captured = confirmation(); expect(captured.confirmedDrafts).toHaveLength(275); expect(captured.excludedRows).toHaveLength(43);
    expect(prepare.mock.calls[0][0].totalRows).toBe(275); expect(create).toHaveBeenCalledTimes(275);
    expect(captured.excludedRows.map(item => item.metadata)).toEqual(serverRows.slice(275).map(item => item.metadata));
    expect(captured.excludedRows.every(item => item.reason.startsWith("跳过问题行：") && item.reason.includes("数量格式无效"))).toBe(true);
    expect(new Set(captured.confirmedDrafts.map(item => item.rowRequestId)).size).toBe(275);
    expect(create.mock.calls.map(call => call[1])).toEqual(captured.confirmedDrafts.map(item => item.rowRequestId));
    expect(document.querySelector(".ci-batch-result h3")?.textContent).toBe("已导入275条 · 跳过43条");
    expect(sessionStorage.getItem(key)).toBeNull(); expect(window.prompt).not.toHaveBeenCalled();
    expect(view).not.toHaveBeenCalled(); click(button("查看物料")); expect(view.mock.calls[0][0]).toHaveLength(275);
  });

  it("removes problems in one action, supports undo, and preserves explicitly removed good rows as exclusions", async () => {
    const source = [row(2), row(3, { brand: "" }), row(4, { qty: "wrong" })]; render({ initialRows: source });
    click(required(document.querySelector('[aria-label="移除原表第2行"]')));
    expect(button("导入0条").disabled).toBe(true);
    click(button("移除全部问题行")); expect(document.querySelector(".ci-batch-summary")?.textContent).toContain("已移除 3 条");
    click(button("撤销移除")); expect(document.querySelector(".ci-batch-summary")?.textContent).toContain("问题 2 条");
    click(button("撤销移除")); expect(button("导入1条").disabled).toBe(false);
    click(required(document.querySelector('[aria-label="移除原表第3行"]')));
    click(button("导入1条")); await settle();
    expect(confirmation().excludedRows).toEqual([
      { row: 3, reason: "用户移除", metadata: source[1].metadata },
      { row: 4, reason: expect.stringContaining("数量格式无效"), metadata: source[2].metadata },
    ]);
    expect(document.querySelector(".ci-batch-result h3")?.textContent).toBe("已导入1条 · 跳过2条"); expect(window.prompt).not.toHaveBeenCalled();
  });

  it("records every bulk removed problem as user removal without asking for a reason", async () => {
    render({ initialRows: [row(2), row(3, { brand: "" }), row(4, { qty: "wrong" })] });
    click(button("移除全部问题行")); click(button("导入1条")); await settle();
    expect(confirmation().excludedRows.map(item => item.reason)).toEqual(["用户移除", "用户移除"]); expect(window.prompt).not.toHaveBeenCalled();
  });

  it("revalidates online edits and includes a repaired row only after it is actually valid", async () => {
    const source = [row(2), row(3, { brand: "" })]; render({ initialRows: source });
    expect(button("导入1条").disabled).toBe(false); input("核对第3行品牌", "ADI");
    expect(button("导入2条").disabled).toBe(false); expect(document.querySelector(".ci-batch-summary")?.textContent).toContain("问题 0 条");
    click(button("导入2条")); await settle(); expect(confirmation().excludedRows).toEqual([]);
    expect(confirmation().confirmedDrafts[1]).toMatchObject({ draft: { brand: "ADI" }, metadata: source[1].metadata });
  });

  it("never turns unresolved source/optional-field issues into good material or invents a manual resolution", async () => {
    const sourceIssue = { issueId: randomUUID(), field: "source", message: "来源待核实", resolved: false, resolution: null };
    const optionalIssue = { issueId: randomUUID(), field: "qty", message: "数量待核实", resolved: false, resolution: null };
    const source = [row(2), row(3, { sourceIssue: "原型号精度不可靠" }, [sourceIssue]), row(4, {}, [optionalIssue])];
    render({ initialRows: source }); expect(button("导入1条").disabled).toBe(false);
    expect(document.querySelector(".ci-batch-summary")?.textContent).toContain("问题 2 条");
    click(button("导入1条")); await settle(); expect(confirmation().confirmedDrafts).toHaveLength(1);
    expect(confirmation().excludedRows.map(item => item.metadata)).toEqual(source.slice(1).map(item => item.metadata));
    expect(sourceIssue).toMatchObject({ resolved: false, resolution: null }); expect(optionalIssue).toMatchObject({ resolved: false, resolution: null });
    expect(create.mock.calls.every(call => call[0].partNumber === "PART-2")).toBe(true); expect(window.prompt).not.toHaveBeenCalled();
  });

  it.each(["", "USD", "unknown"])("skips %s currency without defaulting or changing price on that row", async currency => {
    const source = [row(2), row(3)]; persistOriginal.mockResolvedValue({ sessionData: {}, rows: source.map(item => ({ row: item.row, metadata: item.metadata })) });
    render(); await upload([["型号", "品牌", "报价", "币种"], ["GOOD", "TI", "1.125", "CNY"], ["BAD", "TI", "12.345", currency]]);
    expect(button("导入1条").disabled).toBe(false); click(button("导入1条")); await settle();
    expect(confirmation().confirmedDrafts[0].draft).toMatchObject({ partNumber: "GOOD", currency: "CNY", price: "1.125" });
    expect(confirmation().excludedRows[0].reason).toContain("CNY"); expect(create).toHaveBeenCalledTimes(1);
  });

  it("freezes exclusions, operation reasons and original UUIDs across an unknown preparation and remount", async () => {
    const source = [row(2), row(3, { qty: "wrong" }), row(4, { brand: "" })];
    prepare.mockRejectedValueOnce(new Error("prepare receipt unknown")); render({ initialRows: source });
    click(required(document.querySelector('[aria-label="移除原表第4行"]'))); click(button("导入1条")); await settle();
    const originalCall = structuredClone(prepare.mock.calls[0]); const saved = JSON.parse(required(sessionStorage.getItem(key)));
    expect(saved.preparation.skippedRows).toBe(2); expect(saved.preparation.confirmation.excludedRows).toHaveLength(2);
    render(); click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(prepare.mock.calls[1]).toEqual(originalCall); expect(create.mock.calls[0][1]).toBe(saved.preparation.rows[0].requestId);
    expect(document.querySelector(".ci-batch-result h3")?.textContent).toBe("已导入1条 · 跳过2条");
  });

  it("restores unknown row receipts without losing skipped counts, changing IDs or allowing navigation", async () => {
    create.mockResolvedValueOnce({ idempotent: false }).mockRejectedValueOnce(new Error("row receipt unknown"));
    render({ initialRows: [row(2), row(3), row(4, { qty: "wrong" })] }); click(button("导入2条")); await settle();
    const original = structuredClone(create.mock.calls[1]); const saved = JSON.parse(required(sessionStorage.getItem(key)));
    expect(saved.skippedRows).toBe(1); expect(saved.entries[1].status).toBe("unknown");
    expect(button("查看物料").disabled).toBe(true); click(button("查看物料")); expect(view).not.toHaveBeenCalled();
    render(); click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(prepare).toHaveBeenCalledTimes(1); expect(create.mock.calls[2]).toEqual(original);
    expect(document.querySelector(".ci-batch-result h3")?.textContent).toBe("已导入2条 · 跳过1条"); expect(view).not.toHaveBeenCalled();
  });

  it("includes pre-excluded version rows in the displayed skip count without queuing them", async () => {
    render({ initialRows: [row(2), row(3, { qty: "wrong" })], initialExcludedRowCount: 2 });
    expect(document.querySelector(".ci-batch-footer")?.textContent).toContain("跳过3条"); click(button("导入1条")); await settle();
    expect(confirmation().excludedRows).toHaveLength(1); expect(document.querySelector(".ci-batch-result h3")?.textContent).toBe("已导入1条 · 跳过3条");
  });

  it.each(["only-problems", "removed-all"])("never prepares an empty batch for %s", async kind => {
    render({ initialRows: [row(2, { brand: "" })] });
    if (kind === "removed-all") click(button("移除全部问题行"));
    expect(button("导入0条").disabled).toBe(true); click(button("导入0条"));
    expect(prepare).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("keeps the original strict customer confirmation when the table skip opt-in is absent", () => {
    render({ initialRows: [row(2), row(3, { brand: "" })], skipIssueRows: false });
    expect(button("确认导入 2 条").disabled).toBe(true); expect(document.querySelector(".ci-batch-summary")?.textContent).toContain("1 条需要修正");
  });

  it("rejects a 1001-row source instead of truncating or skipping the excess", async () => {
    render(); await upload([["型号", "品牌", "币种"], ...Array.from({ length: 1001 }, () => ["ONE", "TI", "CNY"])]);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("每批最多1000行数据");
    expect(document.querySelector(".ci-batch-preview")).toBeNull(); expect(prepare).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
});
