// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  initialState: {} as Record<string, unknown>,
  list: vi.fn(),
  refetch: vi.fn(),
  toastError: vi.fn(),
  fetching: false,
  enterprise: { isOwner: false, permissionKeys: ["procurement.demands"] as string[] },
}));

vi.mock("@/business/platform/client/src/hooks/usePageMemory", async () => {
  const { useState } = await import("react");
  return {
    usePageMemory: () => true,
    useRememberedState: <T,>(key: string, initial: T) => useState<T>(() =>
      Object.prototype.hasOwnProperty.call(runtime.initialState, key)
        ? runtime.initialState[key] as T
        : initial,
    ),
    freshListOptions: () => ({}),
    useRestoringListQuery: <T,>(query: T) => query,
    returnToPageSource: vi.fn(),
  };
});

vi.mock("@/business/BusinessContentFrame", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("sonner", () => ({ toast: { error: runtime.toastError } }));
vi.mock("@/business/api/business-trpc", () => ({
  trpc: {
    enterprise: { me: { useQuery: () => ({ data: runtime.enterprise }) } },
    customerDemand: { procurementList: { useQuery: runtime.list } },
  },
}));
vi.mock("@/business/platform/client/src/components/customerDemands/DemandQuoteDialog", () => ({
  DemandQuoteDialog: ({ demandId, quoteId }: { demandId: number; quoteId?: number }) =>
    React.createElement("div", { "data-test-quote-demand": demandId, "data-test-quote-id": quoteId }),
}));
vi.mock("@/business/platform/client/src/components/customerDemands/DemandQuoteList", () => ({
  DemandQuoteList: () => null,
}));

import ProcurementDemands from "@/business/platform/client/src/pages/ProcurementDemands";
import { ProcurementWorkspaceNav } from "@/business/platform/client/src/components/customerDemands/ProcurementWorkspaceNav";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement;

function render(element: React.ReactNode = React.createElement(ProcurementDemands)) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root!.render(element));
}
function control<T extends Element>(selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}
function button(text: string): HTMLButtonElement {
  const element = Array.from(container.querySelectorAll("button")).find(item => item.textContent?.trim() === text);
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}
function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}
function lastInput() {
  return runtime.list.mock.calls.at(-1)?.[0];
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  runtime.initialState = {};
  runtime.fetching = false;
  runtime.enterprise = { isOwner: false, permissionKeys: ["procurement.demands"] };
  runtime.refetch.mockReset().mockResolvedValue(undefined);
  runtime.toastError.mockReset();
  runtime.list.mockReset().mockImplementation((input: { page: number }) => ({
    data: {
      page: input.page,
      total: 60,
      items: [{
        id: 41, demandNo: "REQ-41", projectName: "原项目", priority: "normal",
        firstPartNumber: "LM358", firstBrand: "TI", firstQty: 1200,
        firstQtyUnit: "片", firstDeliveryRequirement: "3天", salesName: "原销售",
        itemCount: 1, status: "submitted", mySupplierCount: 0,
        myQuoteRoundCount: 0, myActiveQuoteCount: 0, currentQuoteCount: 2,
      }],
    },
    isLoading: false,
    isFetching: runtime.fetching,
    error: null,
    refetch: runtime.refetch,
  }));
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container?.remove();
  vi.unstubAllGlobals();
});

describe("procurement-demands unified page", () => {
  it("uses common wrappers and native quote filter without the duplicate workspace heading", () => {
    render();
    expect(control("section.aui-page").getAttribute("aria-label")).toBe("采购内部需求");
    expect(container.querySelector("h1")).toBeNull();
    expect(container.textContent).not.toContain("按供应商独立报价，修改自动保留历史轮次");
    expect(container.querySelector(".aui-data-panel table")).not.toBeNull();
    const select = control<HTMLSelectElement>('select[aria-label="采购报价视图"]');
    expect(Array.from(select.options).map(option => [option.value, option.text])).toEqual([
      ["all", "全部需求"], ["unquoted", "我未报价"], ["quoted", "我已报价"],
    ]);
    const toolbar = control(".aui-filterbar");
    for (const name of ["搜索", "重置", "手动刷新"]) expect(toolbar.contains(button(name))).toBe(true);
    expect(lastInput()).toEqual({ view: "all", keyword: "", page: 1, pageSize: 20 });
    expect(control("thead th:nth-child(4)").classList.contains("text-right")).toBe(true);
    expect(control("tbody td:nth-child(4)").classList.contains("text-right")).toBe(true);
    expect(control("tbody td:last-child").classList.contains("text-right")).toBe(true);
  });

  it.each(["all", "unquoted", "quoted"])("preserves %s as the original view query value and resets only its page", view => {
    runtime.initialState = { view: view === "all" ? "quoted" : "all", keyword: "原型号", page: 3 };
    render();
    change(control<HTMLSelectElement>("select"), view);
    expect(lastInput()).toEqual({ view, keyword: "原型号", page: 1, pageSize: 20 });
  });

  it("keeps unapplied keyword input separate and runs the existing search via Enter and button", () => {
    runtime.initialState = { view: "quoted", page: 3 };
    render();
    const input = control<HTMLInputElement>('input[aria-label="搜索需求编号或型号"]');
    change(input, "  LM358  ");
    expect(lastInput()).toEqual({ view: "quoted", keyword: "", page: 3, pageSize: 20 });
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(lastInput()).toEqual({ view: "quoted", keyword: "LM358", page: 1, pageSize: 20 });
    change(input, " REQ-41 ");
    click(button("搜索"));
    expect(lastInput()).toEqual({ view: "quoted", keyword: "REQ-41", page: 1, pageSize: 20 });
  });

  it("resets the native quote filter, both keyword states and page together", () => {
    runtime.initialState = { view: "unquoted", keyword: "TI", keywordInput: "待搜索", page: 3 };
    render();
    click(button("重置"));
    expect(lastInput()).toEqual({ view: "all", keyword: "", page: 1, pageSize: 20 });
    expect(control<HTMLSelectElement>("select").value).toBe("all");
    expect(control<HTMLInputElement>("input").value).toBe("");
  });

  it("refreshes without changing filters and retains refresh failure feedback", async () => {
    runtime.initialState = { view: "quoted", keyword: "TI", page: 2 };
    runtime.refetch.mockRejectedValueOnce(new Error("network"));
    render();
    await act(async () => {
      button("手动刷新").click();
      await Promise.resolve();
    });
    expect(runtime.refetch).toHaveBeenCalledTimes(1);
    expect(runtime.toastError).toHaveBeenCalledWith("刷新失败，请稍后重试");
    expect(lastInput()).toEqual({ view: "quoted", keyword: "TI", page: 2, pageSize: 20 });
  });

  it("preserves original pagination handlers and fetching disabled states", () => {
    render();
    expect(button("上一页").disabled).toBe(true);
    click(button("下一页"));
    expect(lastInput()).toEqual({ view: "all", keyword: "", page: 2, pageSize: 20 });
    click(button("上一页"));
    expect(lastInput().page).toBe(1);
    runtime.fetching = true;
    act(() => root!.render(React.createElement(ProcurementDemands)));
    expect(button("手动刷新").disabled).toBe(true);
    expect(button("下一页").disabled).toBe(true);
  });

  it("keeps independent supplier quotation on the existing demand id", () => {
    render();
    expect(button("查看")).toBeTruthy();
    click(button("报价"));
    expect(control("[data-test-quote-demand]").getAttribute("data-test-quote-demand")).toBe("41");
    expect(control("[data-test-quote-demand]").hasAttribute("data-test-quote-id")).toBe(false);
  });

  it("keeps original links, current-page semantics and internal permission gate in common tabs", () => {
    render(React.createElement(ProcurementWorkspaceNav, { active: "publish" }));
    const nav = control('nav.aui-page-tabs[aria-label="采购工作台功能"]');
    expect(Array.from(nav.querySelectorAll("a")).map(link => [link.textContent, link.getAttribute("href")])).toEqual([
      ["内部需求", "/procurement/demands"], ["发布需求", "/demand-publish"], ["收到的报价", "/demand-quotes"],
    ]);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe("发布需求");
    runtime.enterprise = { isOwner: false, permissionKeys: [] };
    act(() => root!.render(React.createElement(ProcurementWorkspaceNav, { active: "publish" })));
    expect(nav.textContent).not.toContain("内部需求");
    expect(nav.querySelectorAll("a")).toHaveLength(2);
    runtime.enterprise = { isOwner: true, permissionKeys: [] };
    act(() => root!.render(React.createElement(ProcurementWorkspaceNav, { active: "internal" })));
    expect(nav.querySelector('[aria-current="page"]')?.getAttribute("href")).toBe("/procurement/demands");
  });

  it("owns only compact page CSS without blanket important rules or scale hacks", () => {
    const css = readFileSync(resolve(process.cwd(), "client/src/business/platform/client/src/pages/ProcurementDemands.css"), "utf8");
    expect(css).toContain("height: var(--admin-control-height, 32px)");
    expect(css).toContain("font-size: var(--admin-font-body, 12px)");
    expect(css).toContain("font-size: var(--admin-font-caption, 11px)");
    expect(css).toContain("border-radius: 6px");
    expect(css).not.toMatch(/!important|\bzoom\s*:|\btransform\s*:/);
  });
});
