// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchUpload } from "./BatchUpload";
import type { UploadBatchReceipt } from "./management";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storageKey = "d51-channel-inventory-batch-v1:7:31";
let root: Root; let container: HTMLDivElement; let generation = 0;
const create = vi.fn(); const createBatch = vi.fn();
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("missing control"); return value; }
function button(name: string) { return required(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(item => item.textContent?.trim() === name)); }
function click(element: Element) { act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function render(overrides: Partial<React.ComponentProps<typeof BatchUpload>> = {}) {
  act(() => root.render(React.createElement(BatchUpload, { key: ++generation, channels: [{ id: 11, name: "授权渠道", active: true }], channelTotal: 1, initialChannelId: 11, enterpriseId: 31, actorUserId: 7,
    onClose: vi.fn(), onDirtyChange: vi.fn(), onBusyChange: vi.fn(), onLoadMoreChannels: vi.fn(), loadingMoreChannels: false, onCreate: create, onCreateBatch: createBatch, onComplete: vi.fn(), isCurrent: () => true, ...overrides })));
}
async function prepare() {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["型号", "品牌"], ["ONE", "TI"], ["TWO", "ADI"]]), "synthetic");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }); const file = new File([bytes], "synthetic.xlsx"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  const input = required(document.querySelector<HTMLInputElement>('[aria-label="上传库存表格"]')); Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); });
  click(button("预览并校验"));
}
const saved = () => JSON.parse(required(sessionStorage.getItem(storageKey)));
beforeEach(() => {
  create.mockReset().mockResolvedValue({ idempotent: false }); createBatch.mockReset().mockResolvedValue({ id: 81, batchCode: "BATCH-81", revision: 1 }); sessionStorage.clear(); vi.stubGlobal("confirm", vi.fn(() => true));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("persistent upload batch attribution", () => {
  it("persists one batch request before any server write and assigns every new row to its returned ID", async () => {
    let finish!: (receipt: UploadBatchReceipt) => void; createBatch.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(); await prepare(); click(button("确认上传 2 条"));
    expect(create).not.toHaveBeenCalled(); const initial = saved();
    expect(initial.uploadBatch).toEqual({ requestId: expect.any(String) }); expect(initial.entries.every((entry: { uploadBatchId?: number }) => entry.uploadBatchId === undefined)).toBe(true);
    expect(createBatch).toHaveBeenCalledWith({ channelId: 11, fileName: "synthetic.xlsx · synthetic", totalRows: 2, requestId: initial.uploadBatch.requestId });
    await act(async () => finish({ id: 81, batchCode: "BATCH-81", revision: 1 })); await settle();
    expect(create).toHaveBeenCalledTimes(2); expect(create.mock.calls.map(call => call[2])).toEqual([81, 81]); expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
  it("restores the same ID and all row request IDs instead of creating another batch", async () => {
    create.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("unknown second row")); render(); await prepare(); click(button("确认上传 2 条")); await settle();
    const original = create.mock.calls[1]; const stored = saved();
    expect(stored.uploadBatch).toMatchObject({ id: 81, batchCode: "BATCH-81" }); expect(stored.entries.map((entry: { uploadBatchId: number }) => entry.uploadBatchId)).toEqual([81, 81]);
    render(); click(button("恢复原批次")); click(button("按原批次继续 / 重试")); await settle();
    expect(createBatch).toHaveBeenCalledTimes(1); expect(create.mock.calls[2]).toEqual(original); expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
  it("reuses the batch request UUID and frozen file metadata if create-batch result was uncertain", async () => {
    createBatch.mockRejectedValueOnce(new Error("batch network unknown")); render(); await prepare(); click(button("确认上传 2 条")); await settle();
    expect(create).not.toHaveBeenCalled(); const original = createBatch.mock.calls[0][0]; expect(saved().uploadBatch.requestId).toBe(original.requestId);
    render(); click(button("恢复原批次")); click(button("按原批次继续 / 重试")); await settle();
    expect(createBatch.mock.calls[1][0]).toEqual(original); expect(create.mock.calls.map(call => call[2])).toEqual([81, 81]);
  });
  it("pauses after batch creation without revoking saved metadata and resumes the original ID", async () => {
    let finish!: (receipt: UploadBatchReceipt) => void; createBatch.mockReturnValue(new Promise(resolve => { finish = resolve; })); render(); await prepare(); click(button("确认上传 2 条")); click(button("暂停上传"));
    await act(async () => finish({ id: 81, batchCode: "BATCH-81", revision: 1 })); await settle();
    expect(create).not.toHaveBeenCalled(); expect(saved().uploadBatch.id).toBe(81); expect(document.body.textContent).toContain("已保存记录不会撤回");
    click(button("按原批次继续 / 重试")); await settle(); expect(createBatch).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(2);
  });
  it("never submits rows after the authenticated context changes during batch creation", async () => {
    let finish!: (receipt: UploadBatchReceipt) => void; let valid = true;
    createBatch.mockReturnValue(new Promise(resolve => { finish = resolve; })); render({ isCurrent: () => valid }); await prepare(); click(button("确认上传 2 条")); valid = false;
    await act(async () => finish({ id: 81, batchCode: "BATCH-81", revision: 1 })); await settle();
    expect(create).not.toHaveBeenCalled(); expect(saved().uploadBatch.id).toBeUndefined(); expect(saved().entries).toHaveLength(2);
  });
  it("keeps legacy no-ID queues unassigned even when the new callback is provided", async () => {
    const payload = { channelId: 11, partNumber: "LEGACY", brand: "TI", qty: null, price: null, currency: "CNY", taxIncluded: null, dateCode: null, leadTime: null, note: null };
    sessionStorage.setItem(storageKey, JSON.stringify({ version: 1, enterpriseId: 31, actorUserId: 7, channelId: 11, name: "legacy.xlsx", entries: [{ row: 2, requestId: "11111111-1111-4111-8111-111111111111", payload, status: "unknown" }] }));
    render(); click(button("恢复原批次")); click(button("按原批次继续 / 重试")); await settle();
    expect(createBatch).not.toHaveBeenCalled(); expect(create.mock.calls[0]).toEqual([payload, "11111111-1111-4111-8111-111111111111"]);
  });
  it("preserves fixed customer source mode without a batch callback", async () => {
    render({ onCreateBatch: undefined, fixedSource: true, sourceLabel: "客户固定来源" }); await prepare(); click(button("确认上传 2 条")); await settle();
    expect(createBatch).not.toHaveBeenCalled(); expect(create.mock.calls.every(call => call.length === 2)).toBe(true);
    expect(required(document.querySelector<HTMLSelectElement>('[aria-label="批量关联渠道"]')).disabled).toBe(true);
  });
  it("blocks corrupt mixed attribution instead of inventing a new batch", async () => {
    create.mockRejectedValueOnce(new Error("unknown")); render(); await prepare(); click(button("确认上传 2 条")); await settle();
    const stored = saved(); stored.entries[0].uploadBatchId = 99; sessionStorage.setItem(storageKey, JSON.stringify(stored)); render();
    expect(button("选择库存表格").disabled).toBe(true); expect(document.body.textContent).toContain("原批次归属记录无效"); expect(createBatch).toHaveBeenCalledTimes(1);
  });
  it("does not start a server batch if idempotent queue storage is unavailable", async () => {
    render(); await prepare(); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage denied"); }); click(button("确认上传 2 条")); await settle();
    expect(createBatch).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("浏览器无法保存幂等恢复记录");
  });
});
