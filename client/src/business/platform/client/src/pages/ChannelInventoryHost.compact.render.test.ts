// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelInventoryCopyPartNumber, ChannelInventoryPartNumber, Pagination, channelInventoryPageNumbers } from "./ChannelInventoryHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement; let row: HTMLDivElement;
const part = "  FNR3015S100MT/Rev-B-TR+Suffix  ";
function required<T>(value: T | null | undefined): T { if (value == null) throw new Error("Missing isolated compact fixture"); return value; }
function copyButton() { return required(host.querySelector<HTMLButtonElement>(".ci-part-copy-button")); }
async function click(element: Element) { await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))); }
function renderCopy(value = part, resetKey = "actor-7-company-31") {
  act(() => root.render(React.createElement(ChannelInventoryCopyPartNumber, { partNumber: value, resetKey })));
}
function clipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}
beforeEach(() => {
  row = document.createElement("div"); host = document.createElement("div");
  row.append(host); document.body.append(row); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network or production writes in compact fixtures"); }));
  vi.stubGlobal("isSecureContext", true); clipboard(vi.fn().mockResolvedValue(undefined));
});
afterEach(() => {
  act(() => root.unmount()); row.remove(); document.body.replaceChildren();
  expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals();
  delete (navigator as unknown as { clipboard?: unknown }).clipboard;
  delete (document as unknown as { execCommand?: unknown }).execCommand;
});

describe("flat model copy is local, verbatim and compact", () => {
  it("copies the full original case/slash/space/suffix, stops row click propagation and emits a brief live success", async () => {
    vi.useFakeTimers(); const writeText = vi.fn().mockResolvedValue(undefined); clipboard(writeText);
    const rowClick = vi.fn(); row.addEventListener("click", rowClick);
    renderCopy(); expect(host.querySelector("[title], [role=tooltip], .ci-part-number-popover")).toBeNull();
    expect(host.querySelector(".ci-part-number-text")?.textContent).toBe(part);
    expect(host.querySelector(".ci-part-number-text")?.getAttribute("aria-label")).toBe(part);
    await click(copyButton()); expect(writeText).toHaveBeenCalledWith(part); expect(rowClick).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("已复制");
    await act(async () => { await vi.advanceTimersByTimeAsync(1800); });
    expect(host.querySelector('[role="status"]')?.textContent).toBe("");
  });
  it("uses a native keyboard-focusable button without bubbling Enter to row selection/filter handlers", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined); clipboard(writeText); renderCopy();
    const key = vi.fn(); row.addEventListener("keydown", key);
    act(() => copyButton().focus()); expect(document.activeElement).toBe(copyButton());
    act(() => copyButton().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(key).not.toHaveBeenCalled(); expect(copyButton().type).toBe("button");
    // jsdom does not implement native Enter -> click; invoke the native click explicitly.
    await click(copyButton()); expect(writeText).toHaveBeenCalledWith(part);
  });
  it("falls back locally after clipboard denial, restores focus and removes the temporary readonly field", async () => {
    clipboard(vi.fn().mockRejectedValue(new Error("permission denied")));
    const exec = vi.fn((command: string) => {
      const field = required(document.querySelector<HTMLTextAreaElement>("textarea"));
      expect(command).toBe("copy"); expect(field.value).toBe(part); expect(field.readOnly).toBe(true); return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    renderCopy(); await click(copyButton()); expect(exec).toHaveBeenCalledTimes(1);
    expect(document.querySelector("textarea")).toBeNull(); expect(document.activeElement).toBe(copyButton());
    expect(host.querySelector('[role="status"]')?.textContent).toBe("已复制");
  });
  it.each([false, "throw"] as const)("reports fallback %s as failure rather than fabricated success", async mode => {
    clipboard(vi.fn().mockRejectedValue(new Error("denied")));
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => { if (mode === "throw") throw new Error("denied"); return false; }) });
    renderCopy(); await click(copyButton()); expect(host.querySelector('[role="status"]')?.textContent).toBe("复制失败，请重试");
    expect(document.querySelector("textarea")).toBeNull();
  });
  it("never calls the secure API in an insecure context and fails clearly if no local copy is available", async () => {
    vi.stubGlobal("isSecureContext", false); const writeText = vi.fn(); clipboard(writeText);
    renderCopy(); await click(copyButton()); expect(writeText).not.toHaveBeenCalled();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("复制失败，请重试");
  });
  it.each(["scope", "part", "unmount"] as const)("ignores a late clipboard denial after %s changes, without fallback or a stale toast", async change => {
    let reject!: (error: Error) => void;
    clipboard(vi.fn(() => new Promise<void>((_, no) => { reject = no; })));
    const exec = vi.fn(() => true); Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
    renderCopy(); await click(copyButton());
    if (change === "scope") renderCopy(part, "actor-8-company-32");
    if (change === "part") renderCopy("OTHER-FULL-SUFFIX");
    if (change === "unmount") act(() => root.render(null));
    await act(async () => reject(new Error("late denial")));
    expect(exec).not.toHaveBeenCalled(); expect(host.textContent).not.toMatch(/已复制|复制失败/);
  });
  it("retains the original non-flat model tooltip component unchanged", async () => {
    act(() => root.render(React.createElement(ChannelInventoryPartNumber, { partNumber: part, resetKey: "non-flat" })));
    await click(required(host.querySelector(".ci-part-number-trigger")));
    expect(document.querySelector('[role="tooltip"][aria-label="完整型号"]')?.textContent).toBe(part);
    expect(host.querySelector(".ci-part-copy-button")).toBeNull();
  });
});

describe("optional flat-only numbered pagination", () => {
  it.each([
    [1, [1, 2, 3, "ellipsis", 15]],
    [2, [1, 2, 3, 4, "ellipsis", 15]],
    [8, [1, "ellipsis", 6, 7, 8, 9, 10, "ellipsis", 15]],
    [15, [1, "ellipsis", 13, 14, 15]],
  ] as const)("generates first/last and current ±2 for page %s of 15", (page, expected) => {
    expect(channelInventoryPageNumbers(page, 15)).toEqual(expected);
  });
  it("has no duplicate pages or ellipses for a single page", () => {
    expect(channelInventoryPageNumbers(1, 1)).toEqual([1]);
    expect(channelInventoryPageNumbers(1, 3)).toEqual([1, 2, 3]);
  });
  it("renders the approved page-two example, noninteractive ellipsis and current aria state; direct clicks use exact targets", async () => {
    const onPage = vi.fn();
    act(() => root.render(React.createElement(Pagination, { page: 2, pageCount: 15, total: 299, onPage, label: "渠道库存", pageNumbers: true })));
    expect([...host.querySelectorAll(".ci-pagination-controls > *")].map(item => item.textContent)).toEqual(["上一页", "1", "2", "3", "4", "…", "15", "下一页"]);
    const current = required(host.querySelector<HTMLButtonElement>('[aria-current="page"]'));
    expect(current.textContent).toBe("2"); expect(current.disabled).toBe(true);
    const ellipsis = required(host.querySelector(".ci-pagination-ellipsis"));
    expect(ellipsis.tagName).toBe("SPAN"); expect(ellipsis.hasAttribute("tabindex")).toBe(false);
    await click(required(host.querySelector('[aria-label="第 15 页"]'))); expect(onPage).toHaveBeenLastCalledWith(15);
    await click(required([...host.querySelectorAll("button")].find(item => item.textContent === "上一页"))); expect(onPage).toHaveBeenLastCalledWith(1);
    await click(required([...host.querySelectorAll("button")].find(item => item.textContent === "下一页"))); expect(onPage).toHaveBeenLastCalledWith(3);
  });
  it("disables every page button while loading", () => {
    act(() => root.render(React.createElement(Pagination, { page: 2, pageCount: 15, total: 299, onPage: vi.fn(), label: "渠道库存", pageNumbers: true, loading: true })));
    expect([...host.querySelectorAll<HTMLButtonElement>("button")].every(item => item.disabled)).toBe(true);
    expect(host.querySelector("nav")?.getAttribute("aria-busy")).toBe("true");
  });
  it.each([1, 15])("disables the appropriate boundary on page %s", page => {
    act(() => root.render(React.createElement(Pagination, { page, pageCount: 15, total: 299, onPage: vi.fn(), label: "渠道库存", pageNumbers: true })));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>("button")];
    expect(required(buttons.find(item => item.textContent === (page === 1 ? "上一页" : "下一页"))).disabled).toBe(true);
  });
  it("does not alter the original channel-management pagination when the new prop is omitted", () => {
    act(() => root.render(React.createElement(Pagination, { page: 2, pageCount: 15, total: 299, onPage: vi.fn(), label: "渠道" })));
    expect([...host.querySelectorAll("button")].map(item => item.textContent)).toEqual(["上一页", "下一页"]);
    expect(host.querySelector(".ci-pagination-numbered, [aria-current]")).toBeNull();
  });
  it("scopes width/gutter constraints to the flat Host and preserves span/mobile pagination boundaries", () => {
    const css = readFileSync("client/src/business/platform/client/src/pages/ChannelInventoryHost.css", "utf8");
    const flat = css.slice(css.indexOf("/* Flat inventory only:"));
    expect(flat).toContain(".business-native-content:has(.ci-flat-host)");
    expect(flat).toMatch(/min-width: 0;\s*max-width: 100%;\s*width: 100%;/);
    expect(flat).toContain("width: max(100%, var(--ci-stock-min-width))");
    expect(flat).toContain("html:has([data-channel-inventory-host].ci-flat-host) { scrollbar-gutter: stable; }");
    expect(flat).not.toMatch(/100vw|17px|body\s*\{|^table\s*\{/m);
    expect(flat).toContain(".ci-pagination-numbered .ci-pagination-ellipsis { width: auto; margin: 0; }");
    expect(flat).toContain("@media (hover: none), (pointer: coarse)");
  });
});
