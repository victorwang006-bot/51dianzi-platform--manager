// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchUpload, type CustomerConfirmRows } from "./BatchUpload";
import { emptyDraft } from "./import";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const key = "d51-channel-inventory-batch-v1:7:31:compact";
let root: Root;
let container: HTMLDivElement;
let generation = 0;
const create = vi.fn();
const createCustomer = vi.fn();
const persistOriginal = vi.fn();
const close = vi.fn();
const parse = vi.fn();
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("missing control"); return value; }
function button(name: string) { return required(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === name)); }
function click(element: Element) { act(() => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }); }
function select(label: string, value: string) {
  const control = required(document.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`));
  act(() => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(control, value); control.dispatchEvent(new Event("change", { bubbles: true })); });
}
function input(label: string, value: string) {
  const control = required(document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`));
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(control, value); control.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); }
function render(overrides: Partial<React.ComponentProps<typeof BatchUpload>> = {}) {
  act(() => root.render(React.createElement(BatchUpload, {
    key: ++generation, channels: [{ id: 11, name: "客户固定来源", active: true }], channelTotal: 1, initialChannelId: 11,
    enterpriseId: 31, actorUserId: 7, fixedSource: true, sourceLabel: "客户固定来源", customerSourceReady: true, storageKeySuffix: "compact",
    onClose: close, onCreate: create, onCreateCustomerBatch: createCustomer, onOriginalFilePersist: persistOriginal,
    onComplete: vi.fn(), isCurrent: () => true, onDirtyChange: vi.fn(), onBusyChange: vi.fn(), onLoadMoreChannels: vi.fn(), loadingMoreChannels: false,
    renderSingleEntry: () => React.createElement("div", null, "手动录入表单"), renderParseEntry: parse, ...overrides,
  })));
}
function fileFor(rows: (string | number)[][], fileName = "compact.xlsx") {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "首表");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
  const file = new File([bytes], fileName); Object.defineProperty(file, "arrayBuffer", { configurable: true, value: async () => bytes }); return file;
}
async function uploadFile(file: File) {
  const control = required(document.querySelector<HTMLInputElement>('[aria-label="上传库存表格"]'));
  Object.defineProperty(control, "files", { configurable: true, value: [file] });
  await act(async () => { control.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 50)); });
}
async function upload(rows: (string | number)[][]) { await uploadFile(fileFor(rows)); }
function metadata(row: number, issues: unknown[] = []) { return { row, logicalRowId: `logical-${row}`, sourceRefs: [{ rowNumber: row, originalRowHash: `hash-${row}`, sheetIndex: 0, sheetName: "首表" }], issues }; }
function confirmation(): CustomerConfirmRows { return required(createCustomer.mock.calls[0]?.[1]); }
function isCollapsed(element: Element) { return Boolean(element.closest("details:not([open])")); }

beforeEach(() => {
  create.mockReset().mockResolvedValue({ idempotent: false });
  createCustomer.mockReset().mockResolvedValue({ id: 81, channelId: 11, batchCode: "COMPACT-81", revision: 1 });
  persistOriginal.mockReset().mockResolvedValue({ sessionData: { history: { historyId: 91 }, sourceConfirmed: true }, rows: Array.from({ length: 5 }, (_, i) => ({ row: i + 2, metadata: metadata(i + 2) })) });
  close.mockReset(); parse.mockReset().mockReturnValue(React.createElement("div", null, "人工整理入口")); sessionStorage.clear(); vi.stubGlobal("confirm", vi.fn(() => true));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("customer compact upload", () => {
  it("defaults to spreadsheet/manual entry, recognizes the standard sheet directly into preview and never invokes parsing", async () => {
    render();
    expect(document.querySelector(".ci-batch-steps")?.textContent).toBe("1选文件2核对3结果");
    expect(button("手动录入")).toBeTruthy(); expect(parse).not.toHaveBeenCalled();
    expect(isCollapsed(button("提交原文件人工整理"))).toBe(true);
    await upload([["型号", "品牌", "数量", "报价", "币种"], ["ONE", "TI", "4,000", "0.125", "人民币"]]);
    expect(document.querySelector(".ci-batch-preview")).not.toBeNull();
    expect(document.body.textContent).not.toContain("预览并校验");
    expect(document.querySelector(".ci-batch-file strong")?.textContent).toContain("compact.xlsx");
    expect(document.querySelector(".ci-batch-file p")).toBeNull(); expect(document.querySelector(".ci-batch-preview-note")).toBeNull();
    expect(Array.from(document.querySelectorAll("summary")).some(item => item.textContent === "调整列匹配")).toBe(true);
    expect(document.querySelector('[aria-label="明确确认本次核对币种为CNY"]')).toBeNull();
    expect(button("确认导入 1 条").disabled).toBe(false);
    expect(isCollapsed(required(document.querySelector('[aria-label="核对第2行型号"]')))).toBe(true);
    click(button("确认导入 1 条")); await settle();
    expect(confirmation().confirmedDrafts[0]).toMatchObject({ row: 2, draft: { partNumber: "ONE", brand: "TI", qty: "4000", price: "0.125", currency: "CNY" }, metadata: metadata(2) });
    expect(create.mock.calls[0][0]).toMatchObject({ channelId: 11, currency: "CNY", price: "0.125", qty: 4000 });
    expect(create.mock.calls[0][1]).toBe(confirmation().confirmedDrafts[0].rowRequestId);
    expect(create.mock.calls[0][2]).toBe(81); expect(parse).not.toHaveBeenCalled();
  });

  it.each(["no-column", "blank", "USD", "unknown"])("requires explicit CNY selection for %s and never converts the original price", async currency => {
    render(); await upload(currency === "no-column" ? [["型号", "品牌", "报价"], ["ONE", "TI", "12.345"]] : [["型号", "品牌", "报价", "币种"], ["ONE", "TI", "12.345", currency === "blank" ? "" : currency]]);
    const control = required(document.querySelector<HTMLSelectElement>('[aria-label="明确确认本次核对币种为CNY"]'));
    expect(control.tagName).toBe("SELECT"); expect(control.value).toBe(""); expect(button("确认导入 1 条").disabled).toBe(true);
    expect(control.closest("label")?.querySelector("span")?.textContent).toBe("币种");
    expect(Array.from(control.options).map(option => option.textContent)).toEqual(["请选择", "CNY"]); expect(control.closest("label")?.querySelector("small")).toBeNull();
    for (const copy of ["明确本次候选币种（不自动换算外币）", "尚未确认，请核对原币种和报价", "已核对，本次候选币种为 CNY", "只明确币种，不修改报价数字", "优先展示需要核对的行（最多100条）", "已自动识别列并保留原表行号"]) expect(document.body.textContent).not.toContain(copy);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("CNY");
    click(button("确认导入 1 条")); expect(createCustomer).not.toHaveBeenCalled();
    select("明确确认本次核对币种为CNY", "CNY"); expect(button("确认导入 1 条").disabled).toBe(false);
    select("明确确认本次核对币种为CNY", ""); expect(button("确认导入 1 条").disabled).toBe(true);
    select("明确确认本次核对币种为CNY", "CNY"); click(button("确认导入 1 条")); await settle();
    expect(confirmation().confirmedDrafts[0].draft.price).toBe("12.345"); expect(create.mock.calls[0][0].price).toBe("12.345");
  });

  it("bulk fills whitespace/empty brands without overwriting existing brands, retaining source row metadata", async () => {
    render(); await upload([["型号", "品牌", "币种"], ["ONE", "", "CNY"], ["TWO", "ADI", "CNY"], ["THREE", "   ", "CNY"]]);
    expect(button("确认导入 3 条").disabled).toBe(true);
    expect(isCollapsed(required(document.querySelector('[aria-label="核对第2行品牌"]')))).toBe(false);
    expect(isCollapsed(required(document.querySelector('[aria-label="核对第3行品牌"]')))).toBe(true);
    input("空白行品牌", "TI"); click(button("仅填空白品牌"));
    expect(button("确认导入 3 条").disabled).toBe(false); click(button("确认导入 3 条")); await settle();
    expect(confirmation().confirmedDrafts.map(row => row.draft.brand)).toEqual(["TI", "ADI", "TI"]);
    expect(confirmation().confirmedDrafts.map(row => row.metadata)).toEqual([metadata(2), metadata(3), metadata(4)]);
  });

  it("lets a missing brand column be supplied in bulk while keeping the mandatory part-number mapping", async () => {
    render(); await upload([["型号", "币种"], ["ONE", "CNY"], ["TWO", "CNY"]]);
    expect(document.querySelector('[aria-label="需要调整的列匹配"] [aria-label="匹配品牌"]')).not.toBeNull();
    input("空白行品牌", "TI"); click(button("仅填空白品牌")); expect(button("确认导入 2 条").disabled).toBe(false);
    click(button("确认导入 2 条")); await settle(); expect(confirmation().confirmedDrafts.map(row => row.draft.brand)).toEqual(["TI", "TI"]);
  });

  it("does not guess between ambiguous recognized columns; shows the needed mapping in preview", async () => {
    render(); await upload([["型号", "品牌", "价格", "报价", "币种"], ["ONE", "TI", "10", "20", "CNY"]]);
    const control = required(document.querySelector<HTMLSelectElement>('[aria-label="需要调整的列匹配"] [aria-label="匹配报价（CNY）"]'));
    expect(control.value).toBe("-1"); expect(button("确认导入 1 条").disabled).toBe(true);
    expect(parse).not.toHaveBeenCalled(); select("匹配报价（CNY）", "3");
    expect(button("确认导入 1 条").disabled).toBe(false); click(button("确认导入 1 条")); await settle(); expect(confirmation().confirmedDrafts[0].draft.price).toBe("20");
  });

  it("offers mapping/manual organization for an unrecognized sheet, and returning to file never starts parsing", async () => {
    render(); await upload([["自定义物料", "自定义厂牌", "币种"], ["ONE", "TI", "CNY"]]);
    expect(document.querySelector('[aria-label="需要调整的列匹配"] [aria-label="匹配型号"]')).not.toBeNull();
    expect(button("确认导入 1 条").disabled).toBe(true); expect(isCollapsed(button("提交原文件人工整理"))).toBe(false);
    expect(parse).not.toHaveBeenCalled(); click(button("返回文件")); expect(button("选择库存表格")).toBeTruthy(); expect(parse).not.toHaveBeenCalled();
  });

  it("keeps source/global/source-scope requirements even after CNY selection", async () => {
    const issue = { issueId: "source-2", field: "source", message: "来源精度问题", resolved: false, resolution: null };
    persistOriginal.mockResolvedValue({ sessionData: { history: { historyId: 91 } }, rows: [{ row: 2, metadata: metadata(2, [issue]) }] });
    const details = vi.fn(() => React.createElement("p", { "data-testid": "global-source-scope" }, "原全局问题及非首表范围仍需确认"));
    render({ customerSourceReady: false, customerSourceDisabledReason: "请解决全局问题：原全表范围待明确", renderConfirmationDetails: details }); await upload([["型号", "品牌"], ["ONE", "TI"]]);
    select("明确确认本次核对币种为CNY", "CNY");
    expect(document.querySelector('[data-testid="global-source-scope"]')).not.toBeNull(); expect(button("确认导入 1 条").disabled).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toContain("请解决全局问题：原全表范围待明确"); expect(document.body.textContent).toContain("来源或其他问题尚未填写核实依据");
    input("核对问题source-2", "已核实原表文本"); expect(button("确认导入 1 条").disabled).toBe(true); expect(createCustomer).not.toHaveBeenCalled();
  });

  it.each(["真实来源只读：没有库存写权限", "请明确确认本次仅导入首工作表。", "请解决全局问题：报价范围未核实"])("shows the specific source blocker %s without a blanket reason", async reason => {
    render({ customerSourceReady: false, customerSourceDisabledReason: reason }); await upload([["型号", "品牌", "币种"], ["ONE", "TI", "CNY"]]);
    expect(button("确认导入 1 条").disabled).toBe(true); expect(document.querySelector('[role="status"]')?.textContent).toBe(`暂不能导入：${reason}`);
    expect(document.body.textContent).not.toContain("客户来源、工作表范围及全局问题"); click(button("确认导入 1 条")); expect(createCustomer).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });

  it("still blocks an unwritable selected source even when customer readiness is true", async () => {
    render({ channels: [{ id: 11, name: "来源只读", active: false }], customerSourceReady: true }); await upload([["型号", "品牌", "币种"], ["ONE", "TI", "CNY"]]);
    expect(button("确认导入 1 条").disabled).toBe(true); expect(document.querySelector('[role="status"]')?.textContent).toContain("所选来源不可写或已停用"); expect(createCustomer).not.toHaveBeenCalled();
  });

  it("shows explicit currency confirmation for a parse-result currency issue without removing its resolution control", async () => {
    render({ initialRows: [{ row: 28, draft: { ...emptyDraft, partNumber: "ONE", brand: "TI" }, metadata: metadata(28, [{ issueId: "currency-28", field: "currency", message: "币种待核实", resolved: false, resolution: null }]) }] });
    expect(document.querySelector('[aria-label="明确确认本次核对币种为CNY"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="核对问题currency-28"]')).not.toBeNull(); expect(button("确认导入 1 条").disabled).toBe(true);
    select("明确确认本次核对币种为CNY", "CNY"); expect(document.querySelector('[aria-label="核对问题currency-28"]')).not.toBeNull();
  });

  it("keeps all original queue UUIDs on close and continues only unfinished entries with real success counts", async () => {
    create.mockResolvedValueOnce({ idempotent: false }).mockRejectedValueOnce(new Error("second row result unknown"));
    render(); await upload([["型号", "品牌", "币种"], ["ONE", "TI", "CNY"], ["TWO", "ADI", "CNY"]]);
    click(button("确认导入 2 条")); await settle(); const before = required(sessionStorage.getItem(key)); const stored = JSON.parse(before);
    expect(document.querySelector(".ci-batch-result")?.textContent).toContain("已确认保存 1 / 2 条");
    expect(document.querySelector(".ci-batch-result")?.textContent).toContain("待确认 1 条；未完成 1 条");
    const original = create.mock.calls[1]; click(button("关闭")); expect(close).toHaveBeenCalledTimes(1); expect(sessionStorage.getItem(key)).toBe(before);
    render(); click(button("恢复原批次")); click(button("继续处理未完成（沿用原请求）")); await settle();
    expect(createCustomer).toHaveBeenCalledTimes(1); expect(create.mock.calls[2]).toEqual(original);
    expect(stored.entries[1].requestId).toBe(original[1]); expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("reuses the same persisted file result on local read retry instead of saving the original again", async () => {
    render(); const file = fileFor([["型号", "品牌", "币种"], ["ONE", "TI", "CNY"]]); const bytes = await file.arrayBuffer();
    Object.defineProperty(file, "arrayBuffer", { configurable: true, value: vi.fn().mockRejectedValueOnce(new Error("local read failed")).mockResolvedValue(bytes) });
    await uploadFile(file); expect(button("按原文件重试保存／读取")).toBeTruthy(); click(button("按原文件重试保存／读取")); await settle();
    expect(persistOriginal).toHaveBeenCalledTimes(1); expect(button("确认导入 1 条").disabled).toBe(false);
  });

  it("does not submit after identity change during customer batch preparation and retains the preparation UUID", async () => {
    let finish!: (result: { id: number; channelId: number }) => void; let valid = true;
    createCustomer.mockReturnValue(new Promise(resolve => { finish = resolve; })); render({ isCurrent: () => valid });
    await upload([["型号", "品牌", "币种"], ["ONE", "TI", "CNY"]]); click(button("确认导入 1 条"));
    const original = JSON.parse(required(sessionStorage.getItem(key))); valid = false;
    await act(async () => { finish({ id: 81, channelId: 11 }); }); await settle();
    expect(create).not.toHaveBeenCalled(); expect(JSON.parse(required(sessionStorage.getItem(key))).preparation.requestId).toBe(original.preparation.requestId);
  });

  it("blocks missing server row evidence even when the local sheet is otherwise valid", async () => {
    persistOriginal.mockResolvedValue({ sessionData: { history: { historyId: 91 } }, rows: [] });
    render(); await upload([["型号", "品牌", "币种"], ["ONE", "TI", "CNY"]]);
    expect(button("确认导入 1 条").disabled).toBe(true); expect(document.body.textContent).toContain("缺少服务端原行证据");
    expect(createCustomer).not.toHaveBeenCalled();
  });

  it("does not let bulk brand filling silently bypass an ambiguous original brand column", async () => {
    render(); await upload([["型号", "品牌", "厂牌", "币种"], ["ONE", "TI", "ADI", "CNY"]]);
    input("空白行品牌", "NXP"); click(button("仅填空白品牌")); expect(button("确认导入 1 条").disabled).toBe(true);
    select("匹配品牌", "2"); expect(button("确认导入 1 条").disabled).toBe(false);
    click(button("确认导入 1 条")); await settle(); expect(confirmation().confirmedDrafts[0].draft.brand).toBe("ADI");
  });

  it("prioritizes error rows past the old first-100 preview without losing original row numbers", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({ row: i + 2, draft: { ...emptyDraft, partNumber: `ONE-${i}`, brand: i === 100 ? "" : "TI" }, metadata: metadata(i + 2) }));
    render({ initialRows: rows });
    const body = required(document.querySelector(".ci-batch-preview tbody"));
    expect(body.querySelector("tr td")?.textContent).toBe("102");
    expect(isCollapsed(required(document.querySelector('[aria-label="核对第102行品牌"]')))).toBe(false);
    expect(body.querySelectorAll("tr")).toHaveLength(100); expect(button("确认导入 101 条").disabled).toBe(true);
    expect(document.querySelector(".ci-batch-preview-note")).toBeNull();
  });

  it("submits the exact server-prepared canonical entries rather than rebuilding local payloads", async () => {
    let canonical: ReturnType<NonNullable<React.ComponentProps<typeof BatchUpload>["preparedEntries"]>>;
    createCustomer.mockImplementation(async (_batch, confirmed: CustomerConfirmRows) => {
      canonical = confirmed.confirmedDrafts.map(row => ({ row: row.row, requestId: row.rowRequestId, status: "pending" as const, uploadBatchId: 81,
        payload: { channelId: 11, partNumber: "SERVER-CANONICAL", brand: "TI", qty: null, price: "2.500", currency: "CNY" as const, taxIncluded: null, dateCode: null, leadTime: null, note: "server-confirmed" } }));
      return { id: 81, channelId: 11, batchCode: "COMPACT-81", revision: 1 };
    });
    render({ preparedEntries: () => canonical }); await upload([["型号", "品牌", "币种"], ["LOCAL", "TI", "CNY"]]);
    click(button("确认导入 1 条")); await settle(); expect(create.mock.calls[0]).toEqual([canonical![0].payload, canonical![0].requestId, 81]);
  });

  it("leaves non-customer channel mode on the original mapping step and original controls", async () => {
    render({ onOriginalFilePersist: undefined, onCreateCustomerBatch: undefined, renderSingleEntry: undefined, renderParseEntry: undefined, customerSourceReady: undefined });
    expect(document.querySelector(".ci-batch-steps")?.textContent).toBe("1选文件2匹配字段3确认上传");
    await upload([["型号", "品牌"], ["ONE", "TI"]]); expect(document.querySelector(".ci-batch-preview")).toBeNull();
    click(button("预览并校验")); expect(button("确认上传 1 条").disabled).toBe(false);
    expect(document.querySelector('[aria-label="明确确认本次核对币种为CNY"]')).toBeNull(); expect(button("取消")).toBeTruthy();
    click(button("确认上传 1 条")); await settle(); expect(createCustomer).not.toHaveBeenCalled(); expect(create.mock.calls[0][0]).toMatchObject({ channelId: 11, currency: "CNY" });
  });
});
