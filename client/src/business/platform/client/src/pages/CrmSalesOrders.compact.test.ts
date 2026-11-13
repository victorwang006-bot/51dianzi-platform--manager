// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { Loader2, Plus, Search } from "lucide-react";
import { AdminPage, AdminPageHeader, AdminFilterBar, AdminDataPanel } from "@/components/admin/UnifiedAdminPage";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import * as select from "../components/ui/select";
import * as table from "../components/ui/table";
import {
  CRM_SALES_ORDER_STATUS_LABELS,
  CRM_SALES_PAYMENT_STATUS_LABELS,
  CRM_SALES_SHIPMENT_STATUS_LABELS,
  formatSalesOrderAmount,
} from "../../../shared/crmSalesOrders";

const relativePath = "client/src/business/platform/client/src/pages/CrmSalesOrders.tsx";
const currentText = readFileSync(relativePath, "utf8");
const baselineText = execFileSync("git", ["show", `e7975e5:${relativePath}`], { encoding: "utf8" });
const parse = (text: string) => ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const current = parse(currentText);
const baseline = parse(baselineText);
function collect<T extends ts.Node>(source: ts.SourceFile, predicate: (node: ts.Node) => node is T): T[] {
  const nodes: T[] = [];
  function visit(node: ts.Node) {
    if (predicate(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return nodes;
}
function jsx(source: ts.SourceFile, tag: string) {
  return collect(source, ts.isJsxElement).find(node => node.openingElement.tagName.getText(source) === tag)!;
}
// Evaluate selected genuine presentation JSX only, never query hooks or network.
function evaluate<T>(source: ts.SourceFile, node: ts.Node, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(`const target = (${node.getText(source)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return target;`)(...Object.values(dependencies));
}
const order = (status: "confirmed" | "cancelled" = "confirmed") => ({
  id: 11, orderNumber: "SO-11", customerName: "客户甲", demandNo: "D-21", projectName: "项目甲",
  status, totalAmount: "120.0000", paymentStatus: "unpaid", shipmentStatus: "partial", createdAt: "2026-11-10",
});
function environment(overrides: Record<string, unknown> = {}) {
  return {
    React, AdminPage, AdminPageHeader, AdminFilterBar, AdminDataPanel, Button, Input, Loader2, Plus, Search, ...select, ...table,
    CRM_SALES_ORDER_STATUS_LABELS, CRM_SALES_PAYMENT_STATUS_LABELS, CRM_SALES_SHIPMENT_STATUS_LABELS,
    formatSalesOrderAmount, beijingDate: () => "2026/11/10", statusDotClass: () => "text-[#185FA5]",
    paymentDotClass: () => "text-slate-400", shipmentDotClass: () => "text-amber-500",
    buttonClass: "crm-sales-orders-control bg-[#185FA5] px-3 text-xs text-white hover:bg-[#0C447C]",
    secondaryButtonClass: "crm-sales-orders-control border-slate-300 bg-white px-3 text-xs text-slate-700 shadow-none hover:bg-slate-50",
    embedded: undefined, canWrite: true, keyword: "", draftKeyword: "", status: "all", page: 1, totalPages: 3,
    listQuery: { data: { items: [order(), order("cancelled")], total: 41 }, isLoading: false, isError: false, isFetching: false },
    applyFilters: vi.fn(), setDraftKeyword: vi.fn(), setKeyword: vi.fn(), setStatus: vi.fn(), setPage: vi.fn(),
    setEntryOpen: vi.fn(), setSelectedId: vi.fn(), setPayAmount: vi.fn(), setPayDate: vi.fn(), setPayNote: vi.fn(),
    setPayMethod: vi.fn(), setPayOpen: vi.fn(), setShipQtys: vi.fn(), setExpressCo: vi.fn(), setExpressNo: vi.fn(),
    setShipNote: vi.fn(), setShipMethod: vi.fn(), setShipOpen: vi.fn(), todayLocal: () => "2026-11-14",
    ...overrides,
  };
}
function markup(source: ts.SourceFile, overrides: Record<string, unknown> = {}) {
  return renderToStaticMarkup(evaluate<React.ReactElement>(source, jsx(source, "AdminPage"), environment(overrides)));
}
function documentFor(html: string) {
  const result = document.implementation.createHTMLDocument("compact-orders");
  result.body.innerHTML = html;
  return result;
}
const embedded = { customer: { id: 1, name: "客户甲", archivedAt: null }, canRead: true, canWrite: true };

describe("approved standalone business-order compact presentation", () => {
  it("labels the page accessibly without any visible/hidden heading and keeps filters as its first child", () => {
    const page = documentFor(markup(current)).querySelector(".crm-sales-orders-page")!;
    expect(page.getAttribute("aria-label")).toBe("业务订单");
    expect(page.firstElementChild?.classList.contains("crm-sales-orders-filters")).toBe(true);
    expect(page.querySelector("header, h1, .aui-page-heading, .aui-page-description, [role='status']")).toBeNull();
    expect(collect(current, ts.isJsxElement).some(node => node.openingElement.tagName.getText(current) === "h1")).toBe(false);
    expect(currentText).not.toContain("客户需求形成的内部订单，不含网站自主下单。");
  });

  it("places the original blue create button immediately after Filter and before Reset with original click bytes", () => {
    const page = documentFor(markup(current, { keyword: "项目甲", draftKeyword: "项目甲" }));
    const controls = [...page.querySelectorAll<HTMLButtonElement>(".crm-sales-orders-filters button")];
    const filter = controls.find(button => button.textContent?.trim() === "筛选")!;
    const create = controls.find(button => button.textContent?.trim() === "录入销售订单")!;
    expect(filter.nextElementSibling).toBe(create);
    expect(create.nextElementSibling?.textContent?.trim()).toBe("重置");
    expect(create.classList.contains("bg-[#185FA5]")).toBe(true);
    expect(create.disabled).toBe(false);
    expect(create.parentElement?.classList.contains("flex-wrap")).toBe(true);
    const createNode = collect(current, ts.isJsxElement).find(node => node.openingElement.tagName.getText(current) === "Button" && node.getText(current).includes("录入销售订单"))!;
    const original = collect(baseline, ts.isJsxElement).find(node => node.openingElement.tagName.getText(baseline) === "Button" && node.getText(baseline).includes("录入销售订单"))!;
    const onClick = (node: ts.JsxElement, source: ts.SourceFile) => (node.openingElement.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "onClick") as ts.JsxAttribute).initializer as ts.JsxExpression;
    expect(onClick(createNode, current).getText(current)).toBe(onClick(original, baseline).getText(baseline));
    const setEntryOpen = vi.fn();
    evaluate<() => void>(current, onClick(createNode, current).expression!, { setEntryOpen })();
    expect(setEntryOpen).toHaveBeenCalledTimes(1);
    expect(setEntryOpen).toHaveBeenCalledWith(true);
  });

  it("renders the eight approved global columns and widths while retaining demandNo and project search", () => {
    const page = documentFor(markup(current));
    const main = page.querySelector(".crm-sales-orders-table")!;
    expect([...main.querySelectorAll("th")].map(node => node.textContent?.trim())).toEqual([
      "订单号", "客户", "金额（含税）", "状态", "收款", "出货", "录入时间", "操作",
    ]);
    const columns = [...main.querySelectorAll("col")];
    const widths = columns.map(node => Number.parseInt(node.style.width || node.className.match(/\d+/)![0], 10));
    expect(widths).toEqual([14, 22, 12, 9, 10, 9, 8, 16]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(100);
    expect(columns.map(node => node.className)).toEqual([
      "w-[14%]", "w-[18%]", "w-[10%]", "w-[9%]", "w-[10%]", "w-[9%]", "w-[8%]", "w-[14%]",
    ]);
    expect(columns.map(node => node.getAttribute("style"))).toEqual([
      null, "width:22%", "width:12%", null, null, null, null, "width:16%",
    ]);
    expect(currentText).not.toMatch(/w-\[(?:22|12|16)%\]/);
    for (const row of main.querySelectorAll("tbody tr")) {
      expect(row.querySelectorAll("td")).toHaveLength(8);
      expect(row.querySelectorAll("td")[1].textContent).toContain("D-21");
      expect(row.textContent).not.toContain("项目甲");
    }
    expect(page.querySelector("input")?.getAttribute("placeholder")).toBe("订单号、需求号、项目、客户、型号");
  });

  it.each([
    { name: "writable", change: {} },
    { name: "readonly", change: { canWrite: false, embedded: { ...embedded, readOnly: true } } },
    { name: "archived", change: { canWrite: false, embedded: { ...embedded, customer: { ...embedded.customer, archivedAt: "2026-11-10" } } } },
    { name: "active filters", change: { keyword: "D-21", draftKeyword: "D-21", status: "cancelled", page: 2 } },
    { name: "loading", change: { listQuery: { isLoading: true } } },
    { name: "error", change: { listQuery: { isError: true, error: { message: "读取失败" }, refetch: vi.fn() } } },
    { name: "empty", change: { listQuery: { data: { items: [], total: 0 } } } },
  ])("preserves exact baseline embedded nine-column table and approved customer header in $name state", ({ change }) => {
    const overrides = { embedded, ...change };
    // React useId encodes non-DOM JSX sibling slots; compare all DOM bytes except that opaque generated ID.
    const stableIds = (html: string) => html.replace(/radix-_R_[A-Za-z0-9]+_/g, "radix-GENERATED-ID");
    const page = documentFor(stableIds(markup(current, overrides)));
    const original = documentFor(stableIds(markup(baseline, overrides)));
    expect(page.querySelector(".crm-sales-orders-table")?.outerHTML).toBe(original.querySelector(".crm-sales-orders-table")?.outerHTML);
    expect(page.querySelector("h1")?.textContent).toBe("客户订单");
    expect(page.querySelector(".crm-sales-orders-page")?.getAttribute("aria-label")).toBe("客户甲客户订单");
    expect(page.querySelectorAll("col[style]")).toHaveLength(0);
    expect(page.querySelector(".crm-sales-orders-filters")?.textContent).not.toContain("录入销售订单");
    expect(page.body.textContent).not.toContain("成交确认 / 生成订单");
    expect(page.body.textContent?.includes("录入销售订单")).toBe(!("canWrite" in change) || change.canWrite !== false);
  });

  it("preserves every non-render callback/function body, query payload and complete dialog tail byte-for-byte", () => {
    const callbacks = (source: ts.SourceFile) => collect(source, ts.isArrowFunction)
      // The row-render expression is the sole presentation callback intentionally edited.
      .filter(node => {
        const body = ts.isParenthesizedExpression(node.body) ? node.body.expression : node.body;
        return !(ts.isJsxElement(body) && body.openingElement.tagName.getText(source) === "TableRow" && body.getText(source).includes("order.orderNumber"));
      })
      .map(node => node.getText(source)).sort();
    expect(callbacks(current)).toEqual(callbacks(baseline));
    const functions = (source: ts.SourceFile) => collect(source, ts.isFunctionDeclaration)
      .filter(node => node.name?.text !== "SalesOrdersContent").map(node => node.getText(source));
    expect(functions(current)).toEqual(functions(baseline));
    const queries = (source: ts.SourceFile) => collect(source, ts.isCallExpression)
      .filter(node => node.expression.getText(source).endsWith(".useQuery")).map(node => node.getText(source));
    expect(queries(current)).toEqual(queries(baseline));
    const listInput = (source: ts.SourceFile) => collect(source, ts.isVariableDeclaration).find(node => node.name.getText(source) === "listInput")!.getText(source);
    expect(listInput(current)).toBe(listInput(baseline));
    const dialogTail = (text: string) => text.slice(text.indexOf("      <Dialog\n        open={entryOpen}"));
    expect(dialogTail(currentText)).toBe(dialogTail(baselineText));
  });
});
