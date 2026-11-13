// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
    isFetchedAfterMount: true,
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
vi.mock("@/business/BusinessScope", () => ({ useBusinessScope: () => ({
  merchantId: 17,
  contextVerification: { state: "verified", identity: "fixture-source", authorizationVersion: "v1", readVersion: "v1" },
  onAuthorizationError: vi.fn(),
}) }));
vi.mock("@/business/BusinessWorkbenchAccessGate", () => ({ useBusinessWorkbenchAccess: () => ({
  merchantId: 17, canWrite: false, readCapabilities: ["crm.sales_orders"], writeCapabilities: [],
}) }));
// Actual metadata/native transport is covered by its independent offline UI suite.
vi.mock("@/business/platform/client/src/components/businessSalesOrderMetadata", () => ({
  BusinessSalesOrderMetadataProvider: ({ children }: { children: React.ReactNode }) => children,
  BusinessSalesOrderReceiverCell: () => "未录入",
  BusinessSalesOrderAfterSaleCell: () => "未录入",
  BusinessSalesOrderMetadataActionItems: () => null,
  createBusinessSalesOrderMetadataExportReader: () => async (rows: readonly { id: number }[]) =>
    new Map(rows.map(row => [row.id, {
      receiver: "未录入", receiverPhone: "未录入", receiverAddress: "未录入", afterSales: "未录入",
    }])),
}));
vi.mock("wouter", () => ({ useLocation: () => ["/sales-orders", vi.fn()], useSearch: () => "" }));
vi.mock("@/business/BusinessContentFrame", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/business/api/business-trpc", () => {
  const mutation = { useMutation: () => ({ isPending: false, mutate: vi.fn() }) };
  const invalidate = vi.fn().mockResolvedValue(undefined);
  return {
    trpc: {
      useUtils: () => ({
        client: { crmSalesOrder: {
          list: { query: vi.fn(async () => runtime.list.data) },
          get: { query: vi.fn(async () => runtime.detail.data) },
        } },
        crmSalesOrder: { list: { invalidate }, get: { invalidate }, candidates: { invalidate } },
      }),
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
import { Button } from "@/business/platform/client/src/components/ui/button";

const pagePath = resolve(process.cwd(), "client/src/business/platform/client/src/pages/CrmSalesOrders.tsx");
const pageText = readFileSync(pagePath, "utf8");
const cssText = readFileSync(pagePath.replace(/\.tsx$/, ".css"), "utf8");
const source = ts.createSourceFile(pagePath, pageText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter({ removeComments: true });
const print = (node: ts.Node) => printer.printNode(ts.EmitHint.Unspecified, node, source);
// Evaluate only a selected AST expression from the real page, with explicit synthetic
// dependencies. No full-page reimplementation, count/hash snapshot or live transport.
function evaluate<T = any>(node: ts.Node, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(`const target = (${print(node)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return target;`)(...Object.values(dependencies));
}
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
    id, customerId: 1, status, orderNumber: `SO-${id}`, customerName: "虚构测试客户", demandNo: `D-${id}`,
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
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No production network or DB allowed"); }));
  runtime.memory = {};
  runtime.listInputs = [];
  runtime.list.data = { items: [order(11, "confirmed"), order(12, "cancelled")], total: 41 };
  runtime.list.isLoading = false;
  runtime.list.isError = false;
  runtime.list.isFetching = false;
  runtime.list.isFetchedAfterMount = true;
  runtime.detail.data = null;
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("sales-orders UI unification", () => {
  it("uses shared page, in-list filters and data panels without a standalone heading", () => {
    const names = collect((node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)).map(node => node.tagName.getText(source));
    expect(names.filter(name => name === "AdminPage")).toHaveLength(1);
    expect(names.filter(name => name === "AdminPageHeader")).toHaveLength(0);
    expect(names.filter(name => name === "AdminFilterBar")).toHaveLength(2);
    expect(names.filter(name => name === "AdminDataPanel")).toHaveLength(11);
    expect(pageText).not.toContain("text-[22px]");
    expect(names).not.toContain("Card");
    expect(ts.transpileModule(pageText, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext }, reportDiagnostics: true }).diagnostics).toEqual([]);
  });

  it("preserves four original mutation handlers/payloads, canonical precision, request keys and versions after shared-body extraction", async () => {
    const shared = await import("@/business/platform/shared/crmSalesOrders");
    const variables = collect(ts.isVariableDeclaration);
    const expression = (name: string) => variables.find(node => node.name.getText(source) === name)!.initializer!;
    const calls = collect(ts.isCallExpression).filter(node => /^(createMutation|cancelMutation|paymentMutation|shipMutation)\.mutate$/.test(node.expression.getText(source)));
    expect(calls.map(node => node.expression.getText(source)).sort()).toEqual([
      "cancelMutation.mutate", "createMutation.mutate", "paymentMutation.mutate", "shipMutation.mutate",
    ]);
    // Exact payload property contracts, independent of source layout/wrapper size.
    const payloadKeys = (name: string) => {
      const argument = calls.find(node => node.expression.getText(source) === `${name}.mutate`)!.arguments[0];
      expect(ts.isObjectLiteralExpression(argument)).toBe(true);
      return (argument as ts.ObjectLiteralExpression).properties.map(property => ts.isSpreadAssignment(property) ? `...${property.expression.getText(source)}` : property.name!.getText(source)).sort();
    };
    expect(payloadKeys("createMutation")).toEqual(["...parsed.data", "requestId"]);
    expect(payloadKeys("cancelMutation")).toEqual(["id", "reason", "version"]);
    expect(payloadKeys("paymentMutation")).toEqual(["amount", "id", "method", "note", "paymentDate", "requestId", "version"]);
    expect(payloadKeys("shipMutation")).toEqual(["deliveryMethod", "expressCo", "expressNo", "id", "items", "note", "requestId", "version"]);
    const requestKeysRef = { current: new Map<string, string>() };
    const savingRef = { current: false };
    const mutate = vi.fn();
    let sequence = 0;
    const environment: Record<string, any> = {
      session: { isWritable: () => true }, savingRef, candidateMismatch: false, embedded: undefined,
      candidatesQuery: { data: {} }, customerId: undefined, customerMatches: () => true,
      selectedDemand: { id: 21, demandRevision: 4, items: [{ id: 22, remainingQty: 8 }] },
      lines: [{ demandItemId: 22, qty: "3", agreedUnitPrice: " 12.3456 " }],
      customerConfirmed: true, confirmationNote: " 客户确认数量价格与交期 ", dueDate: "2026-12-01",
      requestIdRef: { current: "synthetic-request-initial" }, requestKeysRef, newRequestId: () => `synthetic-request-${++sequence}`,
      salesOrderCreateSchema: shared.salesOrderCreateSchema, canonicalSalesOrderCreatePayload: shared.canonicalSalesOrderCreatePayload,
      toast: { error: vi.fn() }, createMutation: { mutate },
    };
    const submit = () => evaluate<() => void>(expression("submitOrder"), environment)();
    submit();
    expect(mutate).toHaveBeenCalledWith({ demandId: 21, demandRevision: 4, requestId: "synthetic-request-1",
      items: [{ demandItemId: 22, qty: 3, agreedUnitPrice: "12.3456" }], dueDate: "2026-12-01",
      confirmationNote: "客户确认数量价格与交期", customerConfirmed: true });
    expect(shared.calculateSalesOrderAmounts(mutate.mock.calls[0][0].items).totalAmount).toBe("37.0368");
    savingRef.current = false; submit(); // An uncertain result retries the canonical request, not a fresh order.
    expect(mutate.mock.calls[1][0].requestId).toBe("synthetic-request-1");
    savingRef.current = false; environment.lines[0].agreedUnitPrice = "12.3466"; submit();
    expect(mutate.mock.calls[2][0].requestId).toBe("synthetic-request-2");
    const canonicalA = shared.canonicalSalesOrderCreatePayload({ ...mutate.mock.calls[0][0], items: [
      { demandItemId: 23, qty: 1, agreedUnitPrice: "1.2" }, { demandItemId: 22, qty: 3, agreedUnitPrice: "12.3456" },
    ] });
    const canonicalB = shared.canonicalSalesOrderCreatePayload({ ...mutate.mock.calls[0][0], requestId: "another-request", items: [
      { demandItemId: 22, qty: 3, agreedUnitPrice: "12.3456" }, { demandItemId: 23, qty: 1, agreedUnitPrice: "1.2000" },
    ] });
    expect(canonicalA).toEqual(canonicalB);
    for (const patch of [{ customerConfirmed: false }, { confirmationNote: " " }, { lines: [{ demandItemId: 22, qty: "9", agreedUnitPrice: "12.3456" }] },
      { lines: [{ demandItemId: 22, qty: "1.5", agreedUnitPrice: "12.3456" }] }, { lines: [{ demandItemId: 22, qty: "3", agreedUnitPrice: "12.34567" }] },
      { session: { isWritable: () => false } }]) {
      mutate.mockClear(); savingRef.current = false;
      evaluate<() => void>(expression("submitOrder"), { ...environment, ...patch })();
      expect(mutate).not.toHaveBeenCalled();
    }
    const detail = { id: 11, version: 7, status: "confirmed", stockCandidates: [{ inventoryId: 41, orderItemId: 31 }] };
    const cancel = vi.fn();
    const cancelEnv = { session: { isWritable: () => true }, detailQuery: { data: detail }, cancellingRef: { current: false },
      cancelReason: " 客户取消 ", setCancelError: vi.fn(), cancelMutation: { mutate: cancel } };
    evaluate<() => void>(expression("confirmCancel"), cancelEnv)();
    expect(cancel).toHaveBeenCalledWith({ id: 11, version: 7, reason: "客户取消" });
    for (const change of [{ cancelReason: " " }, { detailQuery: { data: { ...detail, status: "cancelled" } } }, { session: { isWritable: () => false } }]) {
      cancel.mockClear(); evaluate<() => void>(expression("confirmCancel"), { ...cancelEnv, cancellingRef: { current: false }, ...change })();
      expect(cancel).not.toHaveBeenCalled();
    }
    const inline = (name: string) => {
      let node: ts.Node = calls.find(node => node.expression.getText(source) === `${name}.mutate`)!;
      while (!ts.isArrowFunction(node)) node = node.parent;
      return node;
    };
    const payment = vi.fn();
    const paymentEnv = { session: { isWritable: () => true }, detailQuery: { data: detail }, paymentMutation: { mutate: payment },
      payRequestIdRef: { current: "synthetic-payment-key" }, payMethod: "monthly", payAmount: " 12.3456 ", payDate: "2026-12-01", payNote: " 月结登记 " };
    evaluate<() => void>(inline("paymentMutation"), paymentEnv)();
    expect(payment).toHaveBeenCalledWith({ id: 11, version: 7, requestId: "synthetic-payment-key", method: "monthly", amount: "12.3456", paymentDate: "2026-12-01", note: "月结登记" });
    evaluate<() => void>(inline("paymentMutation"), paymentEnv)();
    expect(payment.mock.calls[1][0].requestId).toBe("synthetic-payment-key");
    const shipment = vi.fn();
    const shipEnv = { session: { isWritable: () => true }, detailQuery: { data: detail }, shipMutation: { mutate: shipment },
      shipRequestIdRef: { current: "synthetic-shipment-key" }, shipQtys: { "31:41": "2", "31:42": "0", "31:43": "1.5" },
      shipMethod: "express", expressCo: " 顺丰 ", expressNo: " SYNTHETIC-ONLY ", shipNote: " 分批出货 ", toast: { error: vi.fn() } };
    evaluate<() => void>(inline("shipMutation"), shipEnv)();
    expect(shipment).toHaveBeenCalledWith({ id: 11, version: 7, requestId: "synthetic-shipment-key", deliveryMethod: "express", expressCo: "顺丰", expressNo: "SYNTHETIC-ONLY", note: "分批出货", items: [{ orderItemId: 31, inventoryId: 41, qty: 2 }] });
    evaluate<() => void>(inline("shipMutation"), shipEnv)();
    expect(shipment.mock.calls[1][0].requestId).toBe("synthetic-shipment-key");
    for (const [name, env, spy] of [["paymentMutation", paymentEnv, payment], ["shipMutation", shipEnv, shipment]] as const) {
      for (const change of [{ session: { isWritable: () => false } }, { detailQuery: { data: null } }, { detailQuery: { data: { ...detail, status: "cancelled" } } }]) {
        spy.mockClear(); evaluate<() => void>(inline(name), { ...env, ...change })(); expect(spy).not.toHaveBeenCalled();
      }
    }
    shipment.mockClear(); evaluate<() => void>(inline("shipMutation"), { ...shipEnv, shipQtys: { "31:41": "0", "31:42": "1.5" } })();
    expect(shipment).not.toHaveBeenCalled();
  });

  it("preserves semantic field limits/action availability and old route parameters/read filters without brittle JSX hashes", () => {
    const attributes = collect(ts.isJsxAttribute);
    const attrExpression = (element: ts.JsxOpeningElement | ts.JsxSelfClosingElement, name: string) => {
      const attr = element.attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(source) === name) as ts.JsxAttribute;
      expect(attr).toBeDefined(); expect(ts.isJsxExpression(attr.initializer!)).toBe(true);
      return (attr.initializer as ts.JsxExpression).expression!;
    };
    const openings = collect((node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node));
    const field = (text: string) => openings.find(node => node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "aria-label" && print(attr).includes(text)))!;
    const quantity = field("确认数量");
    expect(evaluate(attrExpression(quantity, "min"), {})).toBe(1);
    expect(evaluate(attrExpression(quantity, "step"), {})).toBe(1);
    expect(evaluate(attrExpression(quantity, "max"), { item: { remainingQty: 8 } })).toBe(8);
    expect(evaluate(attrExpression(quantity, "value"), { draft: { qty: "3" } })).toBe("3");
    const disabled = attrExpression(quantity, "disabled");
    const enabled = { draft: {}, item: { remainingQty: 8 }, createMutation: { isPending: false }, uncertainSave: false };
    expect(evaluate(disabled, enabled)).toBe(false);
    for (const patch of [{ draft: null }, { item: { remainingQty: 0 } }, { createMutation: { isPending: true } }, { uncertainSave: true }]) expect(evaluate(disabled, { ...enabled, ...patch })).toBe(true);
    expect(evaluate(attrExpression(field("含税单价"), "value"), { draft: { agreedUnitPrice: "12.3456" } })).toBe("12.3456");
    const confirmation = openings.find(node => node.attributes.properties.some(attr => ts.isJsxAttribute(attr) && attr.name.getText(source) === "id" && print(attr).includes("sales-order-confirmation")))!;
    expect(evaluate(attrExpression(confirmation, "maxLength"), {})).toBe(500);
    const cancelDisabled = attributes.find(attr => attr.name.getText(source) === "disabled" && print(attr).includes("monthlyAmount"))!;
    const cancelExpr = (cancelDisabled.initializer as ts.JsxExpression).expression!;
    const unpaid = { cancelMutation: { isPending: false }, detailQuery: { data: { paidAmount: "0.0000", monthlyAmount: "0.0000", shippedQty: 0 } } };
    expect(evaluate(cancelExpr, unpaid)).toBe(false);
    for (const data of [{ paidAmount: "0.0001", monthlyAmount: "0", shippedQty: 0 }, { paidAmount: "0", monthlyAmount: "120.0000", shippedQty: 0 }, { paidAmount: "0", monthlyAmount: "0", shippedQty: 1 }]) expect(evaluate(cancelExpr, { ...unpaid, detailQuery: { data } })).toBe(true);
    const payment = attributes.find(attr => attr.name.getText(source) === "onClick" && print(attr).includes("paymentMutation.mutate"))!.parent.parent as ts.JsxOpeningElement;
    const ship = attributes.find(attr => attr.name.getText(source) === "onClick" && print(attr).includes("shipMutation.mutate"))!.parent.parent as ts.JsxOpeningElement;
    const transaction = { canWrite: true, paymentMutation: { isPending: false }, shipMutation: { isPending: false }, detailQuery: { data: {
      status: "confirmed", paidAmount: "0", monthlyAmount: "0", items: [{ id: 31 }], stockCandidates: [{ orderItemId: 31 }],
    } } };
    expect(evaluate(attrExpression(payment, "disabled"), transaction)).toBe(false);
    expect(evaluate(attrExpression(ship, "disabled"), transaction)).toBe(false); // Shipment does not require prior payment.
    for (const element of [payment, ship]) {
      expect(evaluate(attrExpression(element, "disabled"), { ...transaction, canWrite: false })).toBe(true);
      expect(evaluate(attrExpression(element, "disabled"), { ...transaction, detailQuery: { data: { ...transaction.detailQuery.data, status: "cancelled" } } })).toBe(true);
    }
    expect(evaluate(attrExpression(ship, "disabled"), { ...transaction, detailQuery: { data: { ...transaction.detailQuery.data, stockCandidates: [] } } })).toBe(true);
    const calls = collect(ts.isCallExpression);
    const routeEffect = calls.find(node => node.expression.getText(source) === "useEffect" && print(node.arguments[0]).includes("new URLSearchParams(search)"))!.arguments[0];
    const navigation = vi.fn();
    const route = { embedded: undefined, search: "?demandNo=%20D-21%20&keyword=SO-11&keep=1", navigate: navigation,
      deepLinkedDemandNoRef: { current: "" }, setEntryOpen: vi.fn(), setCandidateKeyword: vi.fn(), setCandidateApplied: vi.fn(), setCandidatePage: vi.fn(),
      setDraftKeyword: vi.fn(), setKeyword: vi.fn(), setPage: vi.fn() };
    evaluate<() => void>(routeEffect, route)();
    expect(route.deepLinkedDemandNoRef.current).toBe("D-21"); expect(route.setCandidateApplied).toHaveBeenCalledWith("D-21");
    expect(navigation).toHaveBeenCalledWith(`/orders?keyword=SO-11&keep=1&orderSource=business${window.location.hash}`, { replace: true });
    expect(route.setKeyword).not.toHaveBeenCalled();
    navigation.mockClear(); evaluate<() => void>(routeEffect, { ...route, search: "?keyword=%20SO-11%20&keep=1" })();
    expect(route.setDraftKeyword).toHaveBeenCalledWith("SO-11"); expect(route.setKeyword).toHaveBeenCalledWith("SO-11"); expect(route.setPage).toHaveBeenCalledWith(1);
    expect(navigation).toHaveBeenCalledWith(`/orders?keep=1&orderSource=business${window.location.hash}`, { replace: true });
    navigation.mockClear(); evaluate<() => void>(routeEffect, { ...route, embedded: { customer: { id: 10 } } })(); expect(navigation).not.toHaveBeenCalled();
    const listMemo = collect(ts.isVariableDeclaration).find(node => node.name.getText(source) === "listInput")!.initializer as ts.CallExpression;
    const list = (env: Record<string, unknown>) => evaluate<() => unknown>(listMemo.arguments[0], { PAGE_SIZE: 20, keyword: "SO-11", page: 2, status: "cancelled", customerId: undefined, ...env })();
    expect(list({})).toEqual({ keyword: "SO-11", status: "cancelled", page: 2, pageSize: 20 });
    expect(list({ status: "all", customerId: 10 })).toEqual({ keyword: "SO-11", customerId: 10, page: 2, pageSize: 20 });
    const get = calls.find(node => node.expression.getText(source) === "trpc.crmSalesOrder.get.useQuery")!;
    const candidates = calls.find(node => node.expression.getText(source) === "trpc.crmSalesOrder.candidates.useQuery")!;
    expect(evaluate(get.arguments[0], { selectedId: 11, customerId: undefined })).toEqual({ id: 11 });
    expect(evaluate(get.arguments[0], { selectedId: 11, customerId: 10 })).toEqual({ id: 11, customerId: 10 });
    expect(evaluate(candidates.arguments[0], { candidateApplied: "D-21", candidatePage: 3, customerId: undefined })).toEqual({ keyword: "D-21", page: 3, pageSize: 10 });
    expect(evaluate(candidates.arguments[0], { candidateApplied: "D-21", candidatePage: 3, customerId: 10 })).toEqual({ keyword: "D-21", customerId: 10, page: 3, pageSize: 10 });
  });

  it("renders original state-specific actions, amount values and pagination in the shared skeleton", () => {
    const document = renderPage();
    expect(document.querySelector("section.aui-page")?.getAttribute("data-admin-ui-system")).toBe("channel-inventory");
    expect(document.querySelector("h1.aui-page-title")).toBeNull();
    expect(document.querySelector(".aui-filterbar input")?.getAttribute("aria-label")).toBe("搜索销售订单");
    expect(document.querySelector(".aui-data-panel .aui-filterbar")).not.toBeNull();
    expect(buttons(document.querySelector(".aui-filterbar")!)).toContain("录入销售订单");
    expect(buttons(document.querySelector(".aui-filterbar")!)).toContain("导出当前筛选全部");
    const rows = document.querySelectorAll(".crm-sales-orders-table tbody tr");
    expect(buttons(rows[0])).toEqual(["SO-11", "…"]);
    expect(buttons(rows[1])).toEqual(["SO-12", "…"]);
    for (const row of rows) expect(row.querySelector('[aria-haspopup="dialog"]')?.getAttribute("aria-expanded")).toBe("false");
    // SSR cannot open a body portal. Render only the real page's menu JSX with a
    // synthetic wrapper, keeping its original state/permission branches and buttons.
    const menu = collect(ts.isJsxElement).find(node => node.openingElement.tagName.getText(source) === "BusinessOrderRowActions")!;
    const menuButtons = (status: "confirmed" | "cancelled", canWrite: boolean) => {
      const content = evaluate<React.ReactNode>(menu, {
        React, Button, order: order(11, status), canWrite,
        BusinessOrderRowActions: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
      });
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(content);
      return buttons(container);
    };
    expect(menuButtons("confirmed", true)).toEqual(["查看", "收款", "出货"]);
    expect(menuButtons("cancelled", true)).toEqual(["查看"]);
    expect(menuButtons("confirmed", false)).toEqual(["查看"]);
    expect([...document.querySelectorAll(".crm-sales-orders-table th")].map(header => header.textContent)).toEqual(["", "订单 / 日期", "客户 / 收货人", "商品明细", "含税金额", "配送 / 物流", "状态", "操作"]);
    expect(rows[0].querySelectorAll("td")).toHaveLength(8);
    expect(rows[0].querySelectorAll("td")[4].classList.contains("text-right")).toBe(true);
    expect(rows[0].querySelectorAll("td")[4].querySelector(".font-medium")?.textContent).toBe("¥120");
    expect(document.querySelector(".crm-sales-orders-pagination")?.textContent).toContain("第 1 / 3 页");
    expect(document.querySelector(".crm-sales-orders-pagination")?.textContent).toContain("当前筛选含税金额");
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
    runtime.list.isFetching = state === "loading";
    runtime.list.isFetchedAfterMount = state !== "loading";
    if (state === "empty") runtime.list.data = { items: [], total: 0 };
    const document = renderPage();
    const panel = document.querySelector(".aui-data-panel")!;
    if (state === "loading") expect(panel.querySelector(".animate-spin")).not.toBeNull();
    if (state === "error") { expect(panel.textContent).toContain("订单读取失败"); expect(buttons(panel)).toContain("重试"); }
    if (state === "empty") expect(panel.textContent).toContain("暂无匹配的内部销售订单");
    expect(document.querySelector(".crm-sales-orders-table")).toBeNull();
    if (state === "error" || state === "loading") {
      // A failed refresh or pending fresh query must not leak cached DTOs/counts.
      expect(document.querySelector(".crm-sales-orders-pagination")).toBeNull();
      expect(panel.textContent).not.toContain("共 41 条");
      expect(panel.textContent).not.toContain("SO-11");
      expect(panel.textContent).not.toContain("虚构测试客户");
    } else {
      const footer = document.querySelector(".crm-sales-orders-pagination")!;
      expect(footer.textContent).toContain("共 0 条");
      expect(footer.textContent).toContain("当前筛选含税金额");
      expect(footer.textContent).toContain("第 1 / 1 页");
      expect([...footer.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
    }
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
    expect(values(".crm-sales-orders-control", "height")).toEqual(["var(--admin-content-control-height, 32px)"]);
    expect(values(".crm-sales-orders-control", "border-radius")).toEqual(["6px"]);
    expect(values(".crm-sales-orders-page .crm-sales-orders-table th", "font-size")).toEqual(["var(--admin-content-font-caption, 11px)"]);
    expect(values(".crm-sales-orders-page .crm-sales-orders-table td", "font-size")).toEqual(["var(--admin-content-font-body, 12px)"]);
    expect(values(".crm-sales-orders-dialog [data-slot=\"dialog-title\"]", "font-size")).toEqual(["var(--admin-content-dialog-title-size, 18px)"]);
    expect(cssText).not.toMatch(/!important|\bzoom\s*:|\btransform\s*:|--admin-font-(?:body|label|caption)|\b40px|font-size:\s*(?:14|16|20|22)px/);
  });
});
