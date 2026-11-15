// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerSupplySingleEntry } from "./CustomerSupplySingleEntry";
import { emptyDraft } from "../channelInventory/import";
import type { DemandPartSuggestion } from "../customerDemands/DemandPartNumberInput";

const runtime = vi.hoisted(() => ({
  preview: vi.fn(), query: vi.fn(), note: true, current: true,
  data: [] as DemandPartSuggestion[], isError: false, isFetching: false,
}));
vi.mock("../../../../../BusinessScope", () => ({ useBusinessScope: () => ({ officialInventoryPermissions: { note: runtime.note } }) }));
vi.mock("../../../../../api/business-trpc", () => ({ trpc: {
  customerDemand: { suggestPartNumbers: { useQuery: (input: unknown, options: unknown) => {
    runtime.query(input, options); return { data: runtime.data, isError: runtime.isError, isFetching: runtime.isFetching };
  } } },
} }));
const item = { id: 1, partNumber: "STM32F103C8T6", brand: "ST", package: "LQFP48" };
let root: Root, host: HTMLDivElement;
function render(disabled = false, guarded = false) {
  act(() => root.render(React.createElement(CustomerSupplySingleEntry, { onPreview: runtime.preview, disabled,
    ...(guarded ? { isCurrent: () => runtime.current } : {}) })));
}
function field(label: string) { return host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!; }
function enter(label: string, value: string) {
  const node = field(label);
  act(() => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
}
function submit() { act(() => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
async function lookup() { await act(async () => { await vi.advanceTimersByTimeAsync(220); }); }
function option() { return document.body.querySelector<HTMLButtonElement>('[role="option"]')!; }
function choose() { act(() => option().click()); }
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers(); vi.clearAllMocks();
  runtime.note = true; runtime.current = true; runtime.data = [item]; runtime.isError = false; runtime.isFetching = false;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.replaceChildren(); vi.useRealTimers(); });

describe("customer single supply reuses part-number suggestions without writes", () => {
  it("focuses the accessible required model input, selects model/brand atomically and only calls the original preview", async () => {
    render(); expect(document.activeElement).toBe(field("单条型号")); expect((field("单条型号") as HTMLInputElement).required).toBe(true);
    enter("单条可供数量", "4,000"); enter("单条报价 CNY", "1.123456789012"); enter("单条交期", "7天"); enter("单条 Date Code", "0026+"); enter("单条备注（仅本人）", "个人备注");
    enter("单条型号", "st"); await lookup();
    expect(runtime.query).toHaveBeenLastCalledWith({ keyword: "ST", limit: 8 }, expect.objectContaining({ enabled: true }));
    expect(option().textContent).toContain("ST / LQFP48"); choose();
    expect(field("单条型号").value).toBe(item.partNumber); expect(field("单条品牌").value).toBe("ST");
    expect(document.activeElement).toBe(field("单条型号")); expect(runtime.preview).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("匹配型号");
    submit(); expect(runtime.preview).toHaveBeenCalledWith({ ...emptyDraft, partNumber: item.partNumber, brand: "ST", qty: "4,000", price: "1.123456789012", leadTime: "7天", dateCode: "0026+", note: "个人备注" });
    // This mock has no mutation APIs: preview/selection cannot introduce a network write.
  });

  it.each(["", "   "])("does not erase an already typed brand when a selected suggestion has missing brand %j", async brand => {
    runtime.data = [{ ...item, brand }]; render(); enter("单条品牌", "手填品牌"); enter("单条型号", "st"); await lookup(); choose();
    expect(field("单条品牌").value).toBe("手填品牌"); submit();
    expect(runtime.preview).toHaveBeenCalledWith(expect.objectContaining({ partNumber: item.partNumber, brand: "手填品牌" }));
  });

  it("fills a nonempty suggested brand over a previous value but still allows explicit brand editing", async () => {
    render(); enter("单条品牌", "原品牌"); enter("单条型号", "st"); await lookup(); choose();
    expect(field("单条品牌").value).toBe("ST"); enter("单条品牌", "人工修正"); submit();
    expect(runtime.preview).toHaveBeenCalledWith(expect.objectContaining({ brand: "人工修正" }));
  });

  it.each([false, true])("allows fully manual preview when no suggestions exist or lookup fails (%s)", async isError => {
    runtime.data = []; runtime.isError = isError; render(); enter("单条型号", "manual-part"); enter("单条品牌", "手工品牌"); await lookup();
    expect(document.body.textContent).toContain("可继续手动输入"); submit();
    expect(runtime.preview).toHaveBeenCalledWith({ ...emptyDraft, partNumber: "MANUAL-PART", brand: "手工品牌" });
  });

  it("retains original draft validation and clears its errors after model selection without auto-preview", async () => {
    render(); submit(); expect(host.querySelector('[role="alert"]')?.textContent).toBe("型号不能为空；品牌不能为空");
    enter("单条型号", "st"); await lookup(); choose(); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(runtime.preview).not.toHaveBeenCalled();
    enter("单条可供数量", "1.5"); submit(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("数量格式无效");
    expect(runtime.preview).not.toHaveBeenCalled(); enter("单条可供数量", "0"); submit();
    expect(runtime.preview).toHaveBeenCalledWith(expect.objectContaining({ qty: "0" }));
  });

  it("hides unauthorized notes and strips a previously filled note from the preview", async () => {
    render(); enter("单条备注（仅本人）", "原个人备注"); enter("单条型号", "st"); await lookup(); choose();
    runtime.note = false; render(); expect(field("单条备注（仅本人）")).toBeNull(); submit();
    expect(runtime.preview).toHaveBeenCalledWith(expect.objectContaining({ note: "" }));
  });

  it("ignores stale suggestions after typing a new keyword, preserving a manual brand", async () => {
    render(); enter("单条品牌", "保留品牌"); enter("单条型号", "st"); await lookup();
    enter("单条型号", "new"); runtime.isFetching = true; render(); expect(option()).toBeNull();
    act(() => field("单条型号").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(field("单条型号").value).toBe("NEW"); expect(field("单条品牌").value).toBe("保留品牌"); expect(runtime.preview).not.toHaveBeenCalled();
  });

  it("does not backfill or preview when disabled, and focuses the same input when reenabled", async () => {
    render(); enter("单条品牌", "保留品牌"); enter("单条型号", "st"); await lookup(); render(true);
    runtime.data = [{ ...item, brand: "LATE" }]; render(true); expect(option()).toBeNull(); submit();
    expect(field("单条型号").value).toBe("ST"); expect(field("单条品牌").value).toBe("保留品牌"); expect(runtime.preview).not.toHaveBeenCalled();
    render(); expect(document.activeElement).toBe(field("单条型号")); expect(field("单条品牌").value).toBe("保留品牌");
  });

  it("ignores a selection after isCurrent turns false even without rerendering", async () => {
    render(false, true); enter("单条品牌", "保留品牌"); enter("单条型号", "st"); await lookup();
    runtime.current = false; choose(); submit();
    expect(field("单条型号").value).toBe("ST"); expect(field("单条品牌").value).toBe("保留品牌"); expect(runtime.preview).not.toHaveBeenCalled();
    render(false, true); expect(option()).toBeNull();
  });

  it("cannot backfill or preview from late query data after unmounting", async () => {
    render(); enter("单条型号", "st"); await lookup(); act(() => root.render(null));
    runtime.data = [{ ...item, brand: "LATE" }]; await lookup();
    expect(option()).toBeNull(); expect(host.textContent).toBe(""); expect(runtime.preview).not.toHaveBeenCalled();
  });
});
