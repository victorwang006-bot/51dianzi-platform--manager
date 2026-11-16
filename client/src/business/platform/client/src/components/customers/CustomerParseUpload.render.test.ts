// @vitest-environment jsdom
// Isolated DOM tests: real component + real validateFile; UI bridge is a native
// button mock and persistOriginal is a mock. No DB, network or real upload records.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../channelInventory/bridge", () => ({ Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement("button", props) }));
import { CustomerParseUpload } from "./CustomerParseUpload";
import type { History } from "./customerUploadHistory";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement; let authorized: boolean;
let persist: ReturnType<typeof vi.fn>; let dirty: ReturnType<typeof vi.fn>; let busy: ReturnType<typeof vi.fn>;
const receipt = { historyId: "11111111-1111-4111-8111-111111111111", originalFile: { fileName: "original.csv" } } as History;
function render() { act(() => root.render(React.createElement(CustomerParseUpload, { persistOriginal: persist, isCurrent: () => authorized, onDirtyChange: dirty, onBusyChange: busy }))); }
function button(text: string) { const match = Array.from(host.querySelectorAll("button")).find(b => b.textContent === text); expect(match, `visible button ${text}`).toBeDefined(); return match!; }
function input() { return host.querySelector<HTMLInputElement>('input[type="file"][aria-label="上传待解析原表"]')!; }
function click(element: HTMLElement) { act(() => element.click()); }
function select(file?: File) { const field = input(); Object.defineProperty(field, "files", { value: file ? [file] : [], configurable: true }); act(() => field.dispatchEvent(new Event("change", { bubbles: true }))); }
async function settle() { await act(async () => { await Promise.resolve(); }); }
function file(name = "original.csv", size = 3) { return new File([new Uint8Array(size)], name); }
beforeEach(() => { authorized = true; persist = vi.fn().mockResolvedValue(receipt); dirty = vi.fn(); busy = vi.fn(); host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); render(); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
describe("CustomerParseUpload explicit file entry", () => {
  it("has a visible accessible button that clicks the same hidden named file input, with only a short format/size hint", () => {
    const field = input(); const picker = vi.spyOn(field, "click").mockImplementation(() => undefined);
    expect(field.hidden).toBe(true); expect(field.tabIndex).toBe(-1); expect(field.style.display).toBe("none"); expect(field.accept).toBe(".xlsx,.xls,.csv");
    expect(button("选择文件").disabled).toBe(false); expect(button("选择文件").type).toBe("button"); click(button("选择文件")); expect(picker).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain(".xlsx/.xls/.csv"); expect(host.textContent).toContain("10MiB"); expect(host.textContent).not.toContain("每日由管理员"); expect(host.textContent).not.toContain("使用 Manus"); expect(host.textContent).not.toContain("不创建正式库存"); expect(button("提交，等待解析").disabled).toBe(true);
  });
  it.each(["valid.xlsx", "valid.xls", "valid.CSV"])("selects %s, shows filename, enables submission and supports replacement through the same input", name => {
    const selected = file(name); select(selected); expect(host.textContent).toContain(`已选择：${name}`); expect(button("提交，等待解析").disabled).toBe(false); expect(dirty).toHaveBeenLastCalledWith(true);
    const picker = vi.spyOn(input(), "click").mockImplementation(() => undefined); click(button("替换文件")); expect(picker).toHaveBeenCalledTimes(1);
    select(file("replacement.csv")); expect(host.textContent).toContain("已选择：replacement.csv"); expect(host.textContent).not.toContain(name); expect(input().value).toBe("");
  });
  it("accepts the exact 10MiB boundary", () => { select(file("limit.xlsx", 10 * 1024 * 1024)); expect(button("提交，等待解析").disabled).toBe(false); expect(host.querySelector('[role="alert"]')).toBeNull(); });
  it.each([
    ["bad.txt", 3, ".xlsx/.xls/.csv"],
    ["empty.csv", 0, "文件须非空"],
    ["oversize.xlsx", 10 * 1024 * 1024 + 1, "不超过10MiB"],
  ] as const)("invalid %s clears a previous valid file rather than allowing accidental old-file submission", (name, size, message) => {
    select(file()); select(file(name, size)); expect(host.querySelector('[role="alert"]')?.textContent).toContain(message); expect(host.textContent).not.toContain("已选择：original.csv"); expect(dirty).toHaveBeenLastCalledWith(false); expect(button("选择文件").disabled).toBe(false); expect(button("提交，等待解析").disabled).toBe(true); click(button("提交，等待解析")); expect(persist).not.toHaveBeenCalled();
    select(file("recovered.csv")); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(button("提交，等待解析").disabled).toBe(false);
  });
  it("cancelling the picker preserves an existing valid selection", () => { select(file()); select(); expect(host.textContent).toContain("已选择：original.csv"); expect(button("提交，等待解析").disabled).toBe(false); expect(dirty).toHaveBeenCalledTimes(1); });
  it("busy disables replacement and duplicate submission, including synthetic change events", async () => {
    let resolve!: (value: History) => void; persist.mockImplementation(() => new Promise<History>(r => { resolve = r; })); const original = file(); select(original); click(button("提交，等待解析")); expect(button("替换文件").disabled).toBe(true); expect(input().disabled).toBe(true); expect(button("正在保存原文件…").disabled).toBe(true);
    select(file("cannot-replace.csv")); click(button("正在保存原文件…")); expect(persist).toHaveBeenCalledTimes(1); expect(persist).toHaveBeenCalledWith(original, "parse"); expect(host.textContent).not.toContain("cannot-replace"); expect(busy).toHaveBeenLastCalledWith(true);
    await act(async () => resolve(receipt)); expect(host.textContent).toContain("已提交，等待解析"); expect(host.textContent).toContain(receipt.historyId); expect(dirty).toHaveBeenLastCalledWith(false); expect(busy).toHaveBeenLastCalledWith(false);
  });
  it("unknown does not resend automatically and only retries the unchanged original File/mode; replacement events remain blocked", async () => {
    persist.mockRejectedValueOnce(new Error("response lost")); const original = file(); select(original); click(button("提交，等待解析")); await settle(); expect(persist).toHaveBeenCalledTimes(1); expect(button("替换文件").disabled).toBe(true); expect(input().disabled).toBe(true); expect(host.querySelector('[role="alert"]')?.textContent).toContain("response lost");
    const picker = vi.spyOn(input(), "click").mockImplementation(() => undefined); click(button("替换文件")); expect(picker).not.toHaveBeenCalled(); select(file("new.csv")); expect(host.textContent).not.toContain("new.csv"); render(); await settle(); expect(persist).toHaveBeenCalledTimes(1);
    click(button("按原UUID重试提交")); await settle(); expect(persist).toHaveBeenCalledTimes(2); expect(persist.mock.calls[1]).toEqual(persist.mock.calls[0]); expect(persist.mock.calls[1][0]).toBe(original); expect(persist.mock.calls[1][1]).toBe("parse");
  });
  it("authorization loss guards stale DOM handlers even without a rerender, and disables both controls on rerender", () => {
    select(file()); const oldSubmit = button("提交，等待解析"); const oldPicker = button("替换文件"); const picker = vi.spyOn(input(), "click").mockImplementation(() => undefined); authorized = false;
    click(oldSubmit); click(oldPicker); select(file("forbidden.csv")); expect(persist).not.toHaveBeenCalled(); expect(picker).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("forbidden.csv"); render(); expect(button("替换文件").disabled).toBe(true); expect(button("提交，等待解析").disabled).toBe(true); expect(input().disabled).toBe(true);
  });
  it("closing/unmounting prevents stale submit and suppresses a late response's dirty/busy callbacks", async () => {
    let resolve!: (value: History) => void; persist.mockImplementation(() => new Promise<History>(r => { resolve = r; })); select(file()); click(button("提交，等待解析")); const staleSubmit = button("正在保存原文件…"); act(() => root.unmount()); root = createRoot(host); click(staleSubmit); await act(async () => resolve(receipt)); expect(persist).toHaveBeenCalledTimes(1); expect(dirty).toHaveBeenCalledTimes(1); expect(dirty).toHaveBeenLastCalledWith(true); expect(busy).toHaveBeenCalledTimes(1); expect(host.textContent).toBe("");
  });
});
