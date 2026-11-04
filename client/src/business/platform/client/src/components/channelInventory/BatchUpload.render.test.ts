// @vitest-environment jsdom
import React, { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BatchUpload } from "./BatchUpload";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./bridge";

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
function props(overrides: Partial<React.ComponentProps<typeof BatchUpload>> = {}): React.ComponentProps<typeof BatchUpload> {
  return { channels: [{ id: 11, name: "原渠道", active: true }], channelTotal: 1, initialChannelId: 11,
    enterpriseId: 31, actorUserId: 7, onClose: close, onCreate: create, onComplete: vi.fn(), isCurrent: () => true,
    onDirtyChange: vi.fn(), onBusyChange: vi.fn(), onLoadMoreChannels: vi.fn(), loadingMoreChannels: false, ...overrides };
}
function render(overrides: Partial<React.ComponentProps<typeof BatchUpload>> = {}) {
  act(() => { root.render(React.createElement(BatchUpload, { key: ++generation, ...props(overrides) })); });
}
async function selectFile(file: File) {
  const input = required(document.querySelector<HTMLInputElement>('[aria-label="上传库存表格"]'));
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); });
}
async function upload() {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["型号", "品牌"], ["ONE", "TI"]]), "synthetic");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
  const file = new File([bytes], "synthetic-channel.xlsx"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
  await selectFile(file);
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

function seedSaved() {
  const payload = { channelId: 11, partNumber: "原未知物料", brand: "TI", qty: null, price: null, currency: "CNY", taxIncluded: null, dateCode: null, leadTime: null, note: null };
  const saved = { version: 1, enterpriseId: 31, actorUserId: 7, channelId: 11, name: "原批次.xlsx",
    entries: [{ row: 2, requestId: "11111111-1111-4111-8111-111111111111", payload, status: "unknown" }] };
  sessionStorage.setItem(storageKey, JSON.stringify(saved));
  return saved;
}
describe("v22 first-frame recovery and reusable content", () => {
  it("reads recovery during render, before layout/passive effects, and keeps the standalone Portal stable", async () => {
    seedSaved();
    const read = vi.spyOn(Storage.prototype, "getItem"); const layoutReads: number[] = [];
    function Probe() { useLayoutEffect(() => { layoutReads.push(read.mock.calls.length); }, []); return React.createElement(BatchUpload, props()); }
    try {
      act(() => root.render(React.createElement(Probe)));
      expect(layoutReads[0]).toBeGreaterThan(0);
      const dialog = required(document.querySelector('[role="dialog"]'));
      const overlay = required(document.querySelector('[data-slot="dialog-overlay"]'));
      expect(button("选择库存表格").disabled).toBe(true); expect(button("恢复原批次")).toBeTruthy();
      await settle();
      expect(document.querySelector('[role="dialog"]')).toBe(dialog);
      expect(document.querySelector('[data-slot="dialog-overlay"]')).toBe(overlay);
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
      click(button("恢复原批次")); expect(document.querySelector('[role="dialog"]')).toBe(dialog);
      click(button("按原批次继续 / 重试")); await settle();
      expect(create.mock.calls[0][1]).toBe("11111111-1111-4111-8111-111111111111");
    } finally { read.mockRestore(); }
  });
  it("can render only importer content under a caller-owned Dialog without a second Portal", () => {
    act(() => root.render(React.createElement(Dialog, { open: true }, React.createElement(DialogContent, { "aria-describedby": undefined },
      React.createElement(DialogHeader, null, React.createElement(DialogTitle, null, "上传物料")),
      React.createElement(BatchUpload, props({ dialogMode: "content" }))))));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="dialog-overlay"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="dialog-title"]')).toHaveLength(1);
    expect(button("选择库存表格").disabled).toBe(false); expect(create).not.toHaveBeenCalled();
  });
  it("clears another actor's loaded recovery when the wrapper is reused without a caller key", () => {
    seedSaved();
    act(() => root.render(React.createElement(BatchUpload, props())));
    expect(button("恢复原批次")).toBeTruthy();
    act(() => root.render(React.createElement(BatchUpload, props({ actorUserId: 8 }))));
    expect(document.body.textContent).not.toContain("恢复原批次"); expect(button("选择库存表格").disabled).toBe(false);
    expect(sessionStorage.getItem(storageKey)).not.toBeNull(); expect(create).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
  it("blocks a rejected customer recovery record from its first render without creating a new batch", () => {
    const saved = seedSaved(); sessionStorage.setItem(`${storageKey}:customer-mock`, JSON.stringify(saved));
    render({ storageKeySuffix: "customer-mock", validateSavedSession: () => false });
    expect(button("选择库存表格").disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("原批次客户版本或回执已变化");
    expect(create).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain("恢复原批次");
  });
  it.each(["bad-extension", "over-5mb"])("retains real %s file validation despite concise hints", async kind => {
    render();
    const file = new File(["synthetic"], kind === "bad-extension" ? "synthetic.txt" : "synthetic.xlsx");
    if (kind === "over-5mb") Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 + 1 });
    const read = vi.fn(); Object.defineProperty(file, "arrayBuffer", { value: read });
    await selectFile(file);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(kind === "bad-extension" ? "请选择 Excel" : "最多 5MB");
    expect(read).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it.each(["over-1000", "header-only"])("retains real %s worksheet validation", async kind => {
    render();
    const rows = kind === "over-1000" ? [["型号", "品牌"], ...Array.from({ length: 1001 }, () => ["ONE", "TI"])] : [["型号", "品牌"]];
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "synthetic");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
    const file = new File([bytes], "synthetic.xlsx"); Object.defineProperty(file, "arrayBuffer", { value: async () => bytes });
    await selectFile(file);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(kind === "over-1000" ? "每批最多1000行数据" : "至少有一行库存数据");
    expect(document.querySelector(".ci-batch-mapping")).toBeNull(); expect(create).not.toHaveBeenCalled();
  });
});
