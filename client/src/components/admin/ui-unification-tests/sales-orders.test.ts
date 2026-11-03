// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import postcss from "postcss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  memory: {} as Record<string, unknown>,
  listInputs: [] as unknown[],
  list: {
    data: { items: [] as Record<string, unknown>[], total: 0 },
    isLoading: false, isError: false, isFetching: false,
    error: new Error("订单读取失败"), refetch: vi.fn(),
  },
  detail: { data: null as Record<string, unknown> | null, isLoading: false, isError: false },
}));

vi.mock("@/business/platform/client/src/hooks/usePageMemory", async () => {
  const { useState } = await import("react");
  return {
    usePageMemory: () => true,
    useRememberedState: <T,>(key: string, initial: T) => useState<T>(key in runtime.memory ? runtime.memory[key] as T : initial),
    freshListOptions: () => ({}),
    useRestoringListQuery: (query: unknown) => query,
    returnToPageSource: vi.fn(),
  };
});
vi.mock("wouter", () => ({ useLocation: () => ["/sales-orders", vi.fn()], useSearch: () => "" }));
vi.mock("@/business/BusinessContentFrame", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/business/api/business-trpc", () => {
  const mutation = { useMutation: () => ({ isPending: false, mutate: vi.fn() }) };
  const invalidate = vi.fn().mockResolvedValue(undefined);
  return {
    trpc: {
      useUtils: () => ({ crmSalesOrder: { list: { invalidate }, get: { invalidate }, candidates: { invalidate } } }),
      crmSalesOrder: {
        list: { useQuery: (input: unknown) => { runtime.listInputs.push(input); return runtime.list; } },
        get: { useQuery: () => runtime.detail },
        candidates: { useQuery: () => ({ data: { items: [], total: 0 }, isLoading: false, isError: false }) },
        create: mutation, cancel: mutation, recordPayment: mutation, ship: mutation,
      },
    },
  };
});
// Keep the actual page and shared presentation primitives; isolate Radix's portal transport for SSR.
vi.mock("@/business/platform/client/src/components/ui/dialog", async importOriginal => {
  const actual = await importOriginal<typeof import("@/business/platform/client/src/components/ui/dialog")>();
  const { createElement } = await import("react");
  const part = (tag: string, slot: string) => ({ children, className }: { children?: React.ReactNode; className?: string }) => createElement(tag, { className, "data-slot": slot }, children);
  return {
    ...actual,
    Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => open ? children : null,
    DialogContent: part("div", "dialog-content"),
    DialogHeader: part("div", "dialog-header"),
    DialogTitle: part("h2", "dialog-title"),
    DialogFooter: part("div", "dialog-footer"),
  };
});

import CrmSalesOrders from "@/business/platform/client/src/pages/CrmSalesOrders";

const pagePath = resolve(process.cwd(), "client/src/business/platform/client/src/pages/CrmSalesOrders.tsx");
const pageText = readFileSync(pagePath, "utf8");
const cssText = readFileSync(pagePath.replace(/\.tsx$/, ".css"), "utf8");
const source = ts.createSourceFile(pagePath, pageText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter({ removeComments: true });
const print = (node: ts.Node) => printer.printNode(ts.EmitHint.Unspecified, node, source);
const hash = (items: string[]) => createHash("sha256").update(JSON.stringify(items)).digest("hex");
function collect<T extends ts.Node>(predicate: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  function visit(node: ts.Node) { if (predicate(node)) found.push(node); ts.forEachChild(node, visit); }
  visit(source);
  return found;
}
function renderPage() {
  const document = globalThis.document.implementation.createHTMLDocument("sales-orders");
  document.body.innerHTML = renderToStaticMarkup(React.createElement(CrmSalesOrders));
  return document;
}
function buttons(element: Element | Document) { return [...element.querySelectorAll("button")].map(button => button.textContent?.trim()); }
function order(id: number, status: "confirmed" | "cancelled") {
  return {
    id, status, orderNumber: `SO-${id}`, customerName: "测试客户", demandNo: `D-${id}`,
    projectName: "保留项目", totalAmount: "120.0000", paymentStatus: "unpaid", shipmentStatus: "unshipped",
    createdAt: "2026-11-03T01:00:00.000Z",
  };
}
function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...order(11, "confirmed"), version: 3, dueDate: "2026-12-01", confirmationNote: "原客户确认说明",
    paidAmount: "0", monthlyAmount: "0", shippedQty: 0, orderedQty: 10,
    items: [{ id: 1, partNumber: "LM358", brand: "TI", pkg: "SOIC", orderedQty: 10, qtyUnit: "个", unitPrice: "12", lineAmount: "120", shippedQty: 0 }],
    payments: [], shipments: [], stockCandidates: [], ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("React", React);
  runtime.memory = {};
  runtime.listInputs = [];
  runtime.list.data = { items: [order(11, "confirmed"), order(12, "cancelled")], total: 41 };
  runtime.list.isLoading = false;
  runtime.list.isError = false;
  runtime.list.isFetching = false;
  runtime.detail.data = null;
});

afterEach(() => vi.unstubAllGlobals());

describe("sales-orders UI unification", () => {
  it("uses shared page, header, filters and data panels without the old oversized heading", () => {
    const names = collect((node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)).map(node => node.tagName.getText(source));
    expect(names.filter(name => name === "AdminPage")).toHaveLength(1);
    expect(names.filter(name => name === "AdminPageHeader")).toHaveLength(1);
    expect(names.filter(name => name === "AdminFilterBar")).toHaveLength(2);
    expect(names.filter(name => name === "AdminDataPanel")).toHaveLength(11);
    expect(pageText).not.toContain("text-[22px]");
    expect(names).not.toContain("Card");
    expect(ts.transpileModule(pageText, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext }, reportDiagnostics: true }).diagnostics).toEqual([]);
  });

  it("preserves all 68 original business statements, queries, route parameters, drafts and amount calculations", () => {
    const component = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "CrmSalesOrders");
    const logic = component!.body!.statements.filter(node => !ts.isReturnStatement(node)).map(print);
    expect(logic).toHaveLength(68);
    // Captured before this presentation-only change; whitespace and comments are ignored.
    expect(hash(logic)).toBe("e069c4d1c577b33977a4f79cf9e33d7258de4d3bfcd1a864fac8388317821650");
  });

  it("preserves all 114 original JSX event handlers, field values, validation limits and action availability attributes", () => {
    const attributes = collect(ts.isJsxAttribute).filter(node => /^(on[A-Z]|disabled$|checked$|value$|open$|showCloseButton$|min$|max$|step$|maxLength$)/.test(node.name.getText(source))).map(print);
    expect(attributes).toHaveLength(114);
    expect(hash(attributes)).toBe("34635f5900ac4a8ec6c100b91172902113653fbe65642b8adfc1579a42d9d265");
  });

  it("renders original state-specific actions, amount values and pagination in the shared skeleton", () => {
    const document = renderPage();
    expect(document.querySelector("section.aui-page")?.getAttribute("data-admin-ui-system")).toBe("channel-inventory");
    expect(document.querySelector("h1.aui-page-title")?.textContent).toBe("销售订单");
    expect(document.querySelector(".aui-filterbar input")?.getAttribute("aria-label")).toBe("搜索销售订单");
    const rows = document.querySelectorAll(".crm-sales-orders-table tbody tr");
    expect(buttons(rows[0])).toEqual(["SO-11", "查看", "收款", "出货"]);
    expect(buttons(rows[1])).toEqual(["SO-12", "查看"]);
    expect(rows[0].querySelectorAll("td")[3].classList.contains("text-right")).toBe(true);
    expect(rows[0].querySelectorAll("td")[3].textContent).toBe("¥120");
    expect(document.querySelector(".crm-sales-orders-pagination")?.textContent).toContain("第 1 / 3 页");
    expect(runtime.listInputs.at(-1)).toEqual({ keyword: "", page: 1, pageSize: 20 });
  });

  it("keeps remembered filter and pagination inputs unchanged", () => {
    runtime.memory = { keyword: "SO-12", draftKeyword: "SO-12", status: "cancelled", page: 2 };
    const document = renderPage();
    expect(runtime.listInputs.at(-1)).toEqual({ keyword: "SO-12", status: "cancelled", page: 2, pageSize: 20 });
    expect(document.querySelector<HTMLInputElement>('[aria-label="搜索销售订单"]')?.value).toBe("SO-12");
    expect(buttons(document)).toContain("重置");
    expect(document.querySelector(".crm-sales-orders-pagination")?.textContent).toContain("第 2 / 3 页");
  });

  it.each(["loading", "error", "empty"] as const)("keeps the %s list state inside the data panel", state => {
    runtime.list.isLoading = state === "loading";
    runtime.list.isError = state === "error";
    if (state === "empty") runtime.list.data = { items: [], total: 0 };
    const document = renderPage();
    const panel = document.querySelector(".aui-data-panel")!;
    if (state === "loading") expect(panel.querySelector(".animate-spin")).not.toBeNull();
    if (state === "error") { expect(panel.textContent).toContain("订单读取失败"); expect(buttons(panel)).toContain("重试"); }
    if (state === "empty") expect(panel.textContent).toContain("暂无匹配的内部销售订单");
    // Existing data keeps its pagination while loading or on a refresh error.
    if (state === "empty") expect(document.querySelector(".crm-sales-orders-pagination")).toBeNull();
    else expect(document.querySelector(".crm-sales-orders-pagination")?.textContent).toContain("共 41 条");
  });

  it.each([false, true])("keeps detail fields, right-aligned numeric columns and paid-order cancellation guard (paid=%s)", paid => {
    runtime.memory = { selectedId: 11 };
    runtime.detail.data = detail({ paidAmount: paid ? "12" : "0" });
    const document = renderPage();
    const dialog = document.querySelector('[data-slot="dialog-content"]')!;
    expect(dialog.textContent).toContain("销售订单详情");
    expect(dialog.textContent).toContain("原客户确认说明");
    expect(dialog.textContent).toContain("2026-12-01");
    expect(buttons(dialog)).toEqual(["登记收款", "出货", "取消订单", "关闭"]);
    const cancel = [...dialog.querySelectorAll("button")].find(button => button.textContent === "取消订单")!;
    expect(cancel.disabled).toBe(paid);
    expect([...dialog.querySelectorAll("th")].slice(1).every(header => header.classList.contains("text-right"))).toBe(true);
    expect([...dialog.querySelectorAll("tbody td")].slice(1).every(cell => cell.classList.contains("text-right"))).toBe(true);
  });

  it("keeps cancelled-order detail read-only with its cancellation reason", () => {
    runtime.memory = { selectedId: 11 };
    runtime.detail.data = detail({ status: "cancelled", cancelledReason: "客户取消采购" });
    const dialog = renderPage().querySelector('[data-slot="dialog-content"]')!;
    expect(dialog.textContent).toContain("客户取消采购");
    expect(buttons(dialog)).toEqual(["关闭"]);
  });

  it("uses the compact local specifications without scaling, blanket importance or oversized legacy tokens", () => {
    const css = postcss.parse(cssText);
    const values = (selector: string, property: string) => {
      const found: string[] = [];
      css.walkRules(rule => { if (rule.selectors.includes(selector)) rule.walkDecls(property, decl => { found.push(decl.value); }); });
      return found;
    };
    expect(values(".crm-sales-orders-control", "height")).toEqual(["32px"]);
    expect(values(".crm-sales-orders-control", "border-radius")).toEqual(["6px"]);
    expect(values(".crm-sales-orders-page .crm-sales-orders-table th", "font-size")).toEqual(["11px"]);
    expect(values(".crm-sales-orders-page .crm-sales-orders-table td", "font-size")).toEqual(["12px"]);
    expect(values(".crm-sales-orders-dialog [data-slot=\"dialog-title\"]", "font-size")).toEqual(["18px"]);
    expect(cssText).not.toMatch(/!important|\bzoom\s*:|\btransform\s*:|--admin-font-(?:body|label|caption)|\b40px|font-size:\s*(?:14|16|20|22)px/);
  });
});
