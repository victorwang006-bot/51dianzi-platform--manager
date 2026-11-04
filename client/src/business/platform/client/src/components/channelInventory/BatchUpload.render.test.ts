// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchUpload } from "./BatchUpload";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storageKey = "d51-channel-inventory-batch-v1:7:31";
let root: Root;
let container: HTMLDivElement;
let generation = 0;
const create = vi.fn();
const close = vi.fn();
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("missing control"); return value; }
function button(name: string) { return required(Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(control => control.textContent?.trim() === name)); }
function click(element: Element) { act(() => { element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
function render() {
  act(() => { root.render(React.createElement(BatchUpload, { key: ++generation, channels: [{ id: 11, name: "原渠道", active: true }], channelTotal: 1, initialChannelId: 11,
    enterpriseId: 31, actorUserId: 7, onClose: close, onCreate: create, onComplete: vi.fn(), isCurrent: () => true,
    onDirtyChange: vi.fn(), onBusyChange: vi.fn(), onLoadMoreChannels: vi.fn(), loadingMoreChannels: false })); });
}
async function upload() {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["型号", "品牌"], ["ONE", "TI"]]), "synthetic");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
  const file = new File([bytes], "synthetic-channel.xlsx"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  const input = required(document.querySelector<HTMLInputElement>('[aria-label="上传库存表格"]'));
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); });
  click(button("预览并校验"));
}
beforeEach(() => {
  create.mockReset().mockResolvedValue({ idempotent: false }); close.mockReset(); sessionStorage.clear(); vi.stubGlobal("confirm", vi.fn(() => true));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("channel batch opt-out regression after customer single entry extension", () => {
  it("does not add customer switches, manual forms or alter the original three-step entry", () => {
    render();
    expect(document.querySelector('[aria-label="客户物料上传方式"]')).toBeNull();
    expect(document.querySelector(".customer-supply-single")).toBeNull();
    expect(document.querySelector(".ci-batch-steps")?.textContent).toBe("1选文件2匹配字段3确认上传");
    expect(button("选择库存表格").disabled).toBe(false); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("表格上传渠道库存");
    click(button("取消")); expect(close).toHaveBeenCalledTimes(1); expect(window.confirm).not.toHaveBeenCalled();
  });
  it("keeps original file mapping/preview columns and independent channel payload", async () => {
    render(); await upload();
    expect(document.querySelectorAll(".ci-batch-preview th")).toHaveLength(7);
    expect(document.querySelector(".ci-batch-preview")?.textContent).not.toContain("备注（仅本人）");
    expect(create).not.toHaveBeenCalled(); click(button("确认上传 1 条")); await settle();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toEqual({ channelId: 11, partNumber: "ONE", brand: "TI", qty: null, price: null, currency: "CNY", taxIncluded: null, dateCode: null, leadTime: null, note: null });
    expect(create.mock.calls[0][0]).not.toHaveProperty("customerId"); expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
  it("keeps the legacy namespace and JSON metadata, with unknown recovery using the original request ID", async () => {
    create.mockRejectedValueOnce(new Error("original unknown response")); render(); await upload(); click(button("确认上传 1 条")); await settle();
    const original = create.mock.calls[0]; const saved = JSON.parse(required(sessionStorage.getItem(storageKey)));
    expect(saved).toMatchObject({ version: 1, enterpriseId: 31, actorUserId: 7, channelId: 11 });
    expect(saved).not.toHaveProperty("entryMode"); expect(saved).not.toHaveProperty("sessionData"); expect(saved.entries[0].status).toBe("unknown");
    render(); click(button("恢复原批次")); click(button("按原批次继续 / 重试")); await settle();
    expect(create.mock.calls[1]).toEqual(original); expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(document.querySelector('[aria-label="客户物料上传方式"]')).toBeNull();
  });
  it("still forbids creating a new file batch while a legacy unknown batch awaits restoration", async () => {
    create.mockRejectedValueOnce(new Error("unknown")); render(); await upload(); click(button("确认上传 1 条")); await settle(); render();
    expect(button("选择库存表格").disabled).toBe(true); expect(button("恢复原批次")).toBeTruthy(); expect(create).toHaveBeenCalledTimes(1);
  });
});
