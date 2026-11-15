// @vitest-environment jsdom
import React, { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DemandPartNumberInput, type DemandPartSuggestion } from "./DemandPartNumberInput";

const runtime = vi.hoisted(() => ({
  query: vi.fn(), select: vi.fn(), change: vi.fn(), current: true,
  results: {} as Record<string, { data?: DemandPartSuggestion[]; isFetching: boolean; isError: boolean }>,
}));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: {
  customerDemand: { suggestPartNumbers: { useQuery: (input: { keyword: string; limit: number }, options: unknown) => {
    runtime.query(input, options);
    return runtime.results[input.keyword] ?? { data: [], isFetching: false, isError: false };
  } } },
} }));
const items: DemandPartSuggestion[] = [
  { id: 1, partNumber: "STM32F103", brand: "ST", package: "LQFP" },
  { id: 2, partNumber: "STM32F407", brand: "ST", package: "QFN" },
];
let root: Root, host: HTMLDivElement;
function Harness({ disabled = false, custom = false, guarded = false }: { disabled?: boolean; custom?: boolean; guarded?: boolean }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  return React.createElement(DemandPartNumberInput, {
    value, disabled, rowIndex: 2, className: "legacy-input",
    ...(custom ? { ariaLabel: "单条型号", testId: "single-model", required: true, autoFocus: true, inputRef } : {}),
    ...(guarded ? { isCurrent: () => runtime.current } : {}),
    onChange: next => { runtime.change(next); setValue(next); },
    onSelect: item => { runtime.select(item); setValue(item.partNumber); },
  });
}
function render(props: Parameters<typeof Harness>[0] = {}) { act(() => root.render(React.createElement(Harness, props))); }
function input() { return host.querySelector<HTMLInputElement>("input")!; }
function enter(value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value); input().dispatchEvent(new Event("input", { bubbles: true })); });
}
async function debounce(ms = 220) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function key(name: string) {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  act(() => input().dispatchEvent(event)); return event;
}
function options() { return Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')); }
function result(keyword: string, data = items) { runtime.results[keyword] = { data, isFetching: false, isError: false }; }
function handlers(element: Element): Record<string, (...args: any[]) => void> {
  return (element as any)[Object.keys(element).find(key => key.startsWith("__reactProps$"))!];
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.clearAllMocks(); runtime.current = true; runtime.results = {};
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.replaceChildren(); vi.useRealTimers(); });

describe("shared demand part number input: real Popover behavior", () => {
  it("preserves demand row attributes and delays normalized two-character lookup by 220ms with eight results", async () => {
    result("ST"); render();
    expect(input().getAttribute("aria-label")).toBe("第3行型号");
    expect(input().getAttribute("data-testid")).toBe("demand-item-2-partNumber");
    expect(input().className).toBe("legacy-input"); expect(input().maxLength).toBe(128); expect(input().required).toBe(false);
    enter("ｓ"); await debounce();
    expect(runtime.query).toHaveBeenLastCalledWith({ keyword: "S", limit: 8 }, expect.objectContaining({ enabled: false }));
    enter("ｓｔ"); await debounce(219);
    expect(runtime.query).toHaveBeenLastCalledWith({ keyword: "S", limit: 8 }, expect.objectContaining({ enabled: false }));
    expect(document.body.textContent).toContain("联想中"); expect(options()).toHaveLength(0);
    await debounce(1);
    expect(runtime.query).toHaveBeenLastCalledWith({ keyword: "ST", limit: 8 }, {
      enabled: true, staleTime: 60_000, refetchOnWindowFocus: false, retry: false,
    });
    expect(input().value).toBe("ST"); expect(options()).toHaveLength(2);
    expect(host.querySelector('[role="listbox"]')).toBeNull(); // real Radix portal
  });

  it("supports the optional input attributes, keyboard wrap-around and selection without losing input focus", async () => {
    result("ST"); render({ custom: true });
    expect(document.activeElement).toBe(input()); expect(input().required).toBe(true);
    expect(input().getAttribute("data-testid")).toBe("single-model");
    expect(input().getAttribute("aria-label")).toBe("单条型号");
    enter("st"); await debounce();
    expect(key("ArrowUp").defaultPrevented).toBe(true);
    expect(options()[1].getAttribute("aria-selected")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[1].id);
    key("ArrowDown"); expect(options()[0].getAttribute("aria-selected")).toBe("true");
    expect(key("Enter").defaultPrevented).toBe(true);
    expect(runtime.select).toHaveBeenCalledWith(items[0]); expect(input().value).toBe(items[0].partNumber);
    expect(input().getAttribute("aria-expanded")).toBe("false"); expect(document.activeElement).toBe(input());
  });

  it("hides old-keyword results immediately and never selects them while the new keyword is waiting or fetching", async () => {
    result("ST"); render(); enter("st"); await debounce(); key("ArrowDown");
    enter("NE"); expect(options()).toHaveLength(0); key("Enter"); expect(runtime.select).not.toHaveBeenCalled();
    runtime.results.ST = { data: [{ ...items[0], partNumber: "LATE-OLD" }], isFetching: false, isError: false };
    render(); expect(options()).toHaveLength(0);
    runtime.results.NE = { isFetching: true, isError: false }; await debounce();
    expect(options()).toHaveLength(0); expect(document.body.textContent).not.toContain("LATE-OLD");
    result("NE", [{ ...items[0], partNumber: "NEW" }]); render();
    expect(options()[0].textContent).toContain("NEW");
    key("Enter"); expect(runtime.select).not.toHaveBeenCalled(); // old active selection reset
    act(() => options()[0].click()); expect(runtime.select).toHaveBeenCalledWith(expect.objectContaining({ partNumber: "NEW" }));
  });

  it.each(["Escape", "Tab"])("closes on %s without selecting or clearing the manual value", async name => {
    result("ST"); render(); enter("st"); await debounce(); key("ArrowDown"); key(name);
    expect(input().getAttribute("aria-expanded")).toBe("false"); expect(input().value).toBe("ST"); expect(runtime.select).not.toHaveBeenCalled();
  });

  it.each([false, true])("keeps manual entry available with no matches or a query error (%s)", async isError => {
    runtime.results.MANUAL = { data: [], isFetching: false, isError };
    render(); enter("manual"); await debounce();
    expect(document.body.textContent).toContain(isError ? "联想暂不可用，可继续手动输入" : "未找到匹配型号，可继续手动输入");
    expect(input().disabled).toBe(false); key("Tab"); expect(input().value).toBe("MANUAL");
    enter("manual-extra"); expect(input().value).toBe("MANUAL-EXTRA"); expect(runtime.select).not.toHaveBeenCalled();
  });

  it.each(["fetching", "network-error", "permission-error"])("blocks retained same-key data and old mouse/keyboard closures during %s without blocking manual entry", async state => {
    result("ST"); render(); enter("ST"); await debounce(); key("ArrowDown");
    const oldOption = handlers(options()[0]), oldKeyboard = handlers(input()).onKeyDown;
    runtime.results.ST = { data: items, isFetching: state === "fetching", isError: state !== "fetching" };
    render();
    expect(runtime.results.ST.data).toBe(items); expect(options()).toHaveLength(0);
    expect(input().getAttribute("aria-activedescendant")).toBeNull(); expect(input().disabled).toBe(false);
    expect(document.body.textContent).toContain(state === "fetching" ? "联想中" : "联想暂不可用，可继续手动输入");
    act(() => { oldOption.onMouseEnter(); oldOption.onClick(); oldKeyboard({ key: "Enter", preventDefault: vi.fn() }); });
    key("ArrowDown"); key("Enter"); expect(runtime.select).not.toHaveBeenCalled(); expect(input().value).toBe("ST");
    result("ST"); render(); key("Enter"); expect(runtime.select).not.toHaveBeenCalled(); // blocked active item must not revive
    enter("manual-extra"); expect(input().value).toBe("MANUAL-EXTRA"); expect(runtime.change).toHaveBeenLastCalledWith("MANUAL-EXTRA");
  });

  it("rejects an old click after successful same-key data replacement, but permits the fresh candidate", async () => {
    result("ST"); render(); enter("ST"); await debounce(); const oldClick = handlers(options()[0]).onClick;
    const fresh = { ...items[0], partNumber: "STM32-NEW" }; result("ST", [fresh]); render();
    act(() => oldClick()); expect(runtime.select).not.toHaveBeenCalled();
    act(() => options()[0].click()); expect(runtime.select).toHaveBeenCalledWith(fresh);
  });

  it("closes and disables queries when disabled, ignoring late data without changing the value", async () => {
    result("ST"); render(); enter("st"); await debounce(); key("ArrowDown");
    render({ disabled: true }); result("ST", [{ ...items[0], partNumber: "LATE" }]); render({ disabled: true });
    expect(input().disabled).toBe(true); expect(input().getAttribute("aria-expanded")).toBe("false"); expect(options()).toHaveLength(0);
    key("Enter"); expect(input().value).toBe("ST"); expect(runtime.select).not.toHaveBeenCalled();
    expect(runtime.query).toHaveBeenLastCalledWith({ keyword: "ST", limit: 8 }, expect.objectContaining({ enabled: false }));
    render(); expect(input().value).toBe("ST"); expect(options()).toHaveLength(0);
  });

  it("checks isCurrent at selection time even before a rerender, then closes on invalidation", async () => {
    result("ST"); render({ guarded: true }); enter("st"); await debounce(); key("ArrowDown");
    runtime.current = false; act(() => options()[0].click()); key("Enter");
    expect(runtime.select).not.toHaveBeenCalled(); expect(input().value).toBe("ST");
    render({ guarded: true }); expect(options()).toHaveLength(0); expect(input().disabled).toBe(true);
    runtime.current = true; render({ guarded: true }); expect(input().value).toBe("ST"); expect(options()).toHaveLength(0);
  });
});
