// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import ts from "typescript";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), quotes: vi.fn(), candidates: vi.fn(),
  create: vi.fn(), payment: vi.fn(), shipping: vi.fn(), inbound: vi.fn(),
  invoice: vi.fn(), voidInvoice: vi.fn(), cancel: vi.fn(),
  refetch: vi.fn(), invalidate: vi.fn(),
}));
vi.mock("@/business/BusinessContentFrame", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/business/platform/client/src/hooks/usePageMemory", async () => {
  const react = await import("react");
  return {
    usePageMemory: () => true,
    useRememberedState: (_key: string, value: unknown) => react.useState(value),
    freshListOptions: (options: unknown) => options,
    useRestoringListQuery: (query: unknown) => query,
    returnToPageSource: vi.fn(),
  };
});
vi.mock("@/business/api/business-trpc", () => ({ trpc: {
  useUtils: () => ({ purchaseOrder: { list: { invalidate: mocks.invalidate }, get: { invalidate: mocks.invalidate } } }),
  purchaseOrder: {
    list: { useQuery: mocks.list }, get: { useQuery: mocks.get },
    acceptedQuoteOptions: { useQuery: mocks.quotes }, inboundCandidates: { useQuery: mocks.candidates },
    create: { useMutation: () => ({ mutateAsync: mocks.create, isPending: false }) },
    updatePayment: { useMutation: () => ({ mutateAsync: mocks.payment, isPending: false }) },
    updateShipping: { useMutation: () => ({ mutateAsync: mocks.shipping, isPending: false }) },
    linkInbound: { useMutation: () => ({ mutateAsync: mocks.inbound, isPending: false }) },
    recordInvoice: { useMutation: () => ({ mutateAsync: mocks.invoice, isPending: false }) },
    voidInvoice: { useMutation: () => ({ mutateAsync: mocks.voidInvoice, isPending: false }) },
    cancel: { useMutation: () => ({ mutateAsync: mocks.cancel, isPending: false }) },
  },
} }));
import ProcurementOrders from "@/business/platform/client/src/pages/ProcurementOrders";

let root: Root;
let host: HTMLDivElement;
let order: any;
const item = { id: 11, partNumber: "TEST-IC", brand: "测试品牌", pkg: "SOP8", qtyUnit: "片", qty: 10, unitPrice: "2.1234", shippedQty: 2, receivedQty: 1 };
const quote = { acceptanceId: 17, supplierName: "报价供应商", partSummary: "TEST-IC", acceptedQty: 10, demandId: 21, quoteId: 31, quoteVersion: 2 };
const result = (data: unknown) => ({ data, isLoading: false, isError: false, isFetching: false, refetch: mocks.refetch });

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  order = { id: 7, orderNo: "PO-TEST-007", supplierName: "测试供应商", supplierOrderNo: "S-7", lifecycle: "active", paymentStatus: "pending", shippingStatus: "partial", receiptStatus: "partial", invoiceStatus: "pending", totalAmount: "21.2340", totalQty: 10, itemCount: 1, firstPartNumber: "TEST-IC", version: 4, createdAt: "2026-11-01T01:00:00Z", items: [item], inbounds: [], invoices: [], events: [] };
  mocks.list.mockImplementation(() => result({ items: [order], total: 41 }));
  mocks.get.mockImplementation(() => result(order));
  mocks.quotes.mockImplementation(() => result({ items: [quote] }));
  mocks.candidates.mockImplementation(() => result({ items: [] }));
  mocks.create.mockResolvedValue({ id: 7, orderNo: order.orderNo });
  mocks.invalidate.mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(createElement(ProcurementOrders))); }
function button(label: string) {
  const node = [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === label);
  if (!node) throw new Error(`找不到按钮：${label}`);
  return node;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function change(node: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function details() { await render(); await click("查看详情"); }

const sourcePath = resolve(process.cwd(), "client/src/business/platform/client/src/pages/ProcurementOrders.tsx");
const cssPath = resolve(process.cwd(), "client/src/business/platform/client/src/pages/ProcurementOrders.css");
function baselineFingerprints() {
  const source = ts.createSourceFile("ProcurementOrders.tsx", readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const printer = ts.createPrinter({ removeComments: true });
  const functions = source.statements.filter(ts.isFunctionDeclaration);
  const transformed = ts.transform(functions, [context => root => ts.visitNode(root, function visit(node): ts.VisitResult<ts.Node> {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return ts.factory.createIdentifier("__PRESENTATION__");
    return ts.visitEachChild(node, visit, context);
  }) as ts.FunctionDeclaration]);
  const logic = transformed.transformed.map(node => printer.printNode(ts.EmitHint.Unspecified, node, source)).join("\n");
  const interactions: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && /^(on[A-Z]|disabled$|value$|checked$)/.test(node.name.getText(source))) interactions.push(`${node.name.getText(source)}=${node.initializer?.getText(source) ?? ""}`);
    ts.forEachChild(node, visit);
  }
  visit(source); transformed.dispose();
  const digest = (text: string) => createHash("sha256").update(text).digest("hex");
  return { logic: digest(logic), interactions: digest(interactions.sort().join("\n")), count: interactions.length };
}

describe("采购订单统一呈现与业务保留", () => {
  it("非 JSX 业务代码及全部 159 个事件、可用性、值与选中属性与实施前基线一致", () => {
    // Captured from the approved pre-change source, not generated from the new JSX.
    expect(baselineFingerprints()).toEqual({ logic: "b383e94b6bb86591e7890adea79cdbc1f7047d9097c1b5a05b3b9a20c9c897be", interactions: "4c394cafcbfb500b881b940c2f219953917adaedf84faf88b1e5bcef9fe067df", count: 159 });
  });
  it("列表采用公共骨架，原九列表头、金额精度和分页完整保留", async () => {
    await render();
    expect(host.querySelector(".aui-page[data-admin-ui-system] .aui-page-header")).not.toBeNull();
    expect(host.querySelector(".aui-filterbar")).not.toBeNull();
    expect(host.querySelector(".aui-data-panel table thead")?.querySelectorAll("th")).toHaveLength(9);
    expect(host.textContent).toContain("¥21.2340");
    expect(host.textContent).toContain("第 1/3 页");
    expect(button("上一页").disabled).toBe(true);
    await click("下一页");
    expect(mocks.list.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2, pageSize: 20 });
  });
  it("四个原状态筛选和刷新保持真实查询参数", async () => {
    await render();
    await change(host.querySelector('[aria-label="付款状态"]')!, "paid");
    await change(host.querySelector('[aria-label="发货状态"]')!, "shipped");
    await change(host.querySelector('[aria-label="发票状态"]')!, "received");
    await change(host.querySelector('[aria-label="订单生命周期"]')!, "cancelled");
    expect(mocks.list.mock.calls.at(-1)?.[0]).toEqual({ keyword: "", paymentStatus: "paid", shippingStatus: "shipped", invoiceStatus: "received", lifecycle: "cancelled", page: 1, pageSize: 20 });
    await click("刷新"); expect(mocks.refetch).toHaveBeenCalledOnce();
  });
  it("手工建单与报价来源切换保留草稿、物料增删和必填校验", async () => {
    await render(); await click("新建采购订单");
    expect(host.querySelector('[role="dialog"] .aui-page-tabs[aria-label="采购订单建单来源"]')).not.toBeNull();
    await change(host.querySelector('input[placeholder="请输入供应商名称"]')!, "草稿供应商");
    await click("添加一行"); expect(host.querySelectorAll('[aria-label="删除物料行"]')).toHaveLength(2);
    await act(async () => (host.querySelector('[aria-label="删除物料行"]') as HTMLButtonElement).click());
    await click("从已采用报价建单");
    expect(mocks.quotes.mock.calls.at(-1)?.[1]).toMatchObject({ enabled: true });
    await click("手工创建");
    expect((host.querySelector('input[placeholder="请输入供应商名称"]') as HTMLInputElement).value).toBe("草稿供应商");
    await click("创建订单");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("正整数数量");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("采用报价建单保留选择、二次确认、快照来源和请求幂等键", async () => {
    await render(); await click("新建采购订单"); await click("从已采用报价建单");
    await click("确认并建单"); expect(host.querySelector('[role="alert"]')?.textContent).toContain("请选择");
    await act(async () => (host.querySelector('input[type="radio"]') as HTMLInputElement).click());
    expect((host.querySelector('input[type="radio"]') as HTMLInputElement).checked).toBe(true);
    await click("确认并建单");
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith({ source: "accepted_quote", acceptanceId: 17, supplierOrderNo: "", expectedDeliveryDate: undefined, note: "", requestId: expect.any(String) });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('.procurement-order-detail')).not.toBeNull();
  });
  it("六个详情模式均保留原内容和活动导航", async () => {
    await details();
    const nav = host.querySelector('nav[aria-label="采购订单详情功能"]')!;
    expect(nav.querySelectorAll("button")).toHaveLength(6);
    for (const [tab, content] of [["订单明细", "累计入库"], ["付款登记", "不发起任何真实付款"], ["发货登记", "不是本次增量"], ["入库关联", "关联已有入库单"], ["供应商发票", "登记供应商发票"], ["操作历史", "暂无操作历史"]]) {
      await click(tab);
      expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe(tab);
      expect(host.textContent).toContain(content);
    }
    await click("收起"); expect(host.querySelector('.procurement-order-detail')).toBeNull();
  });
  it("付款登记仍只提交原付款状态、备注和订单版本", async () => {
    await details(); await click("付款登记");
    const panel = host.querySelector('.procurement-order-detail')!;
    await change(panel.querySelector('select')!, "paid");
    await change(panel.querySelector('textarea')!, "  已确认安排  ");
    await click("保存付款进度");
    expect(mocks.payment).toHaveBeenCalledWith({ id: 7, version: 4, status: "paid", note: "已确认安排", requestId: expect.any(String) });
  });
  it("累计发货保留数量上限和原负载，数量输入右对齐", async () => {
    await details(); await click("发货登记");
    const input = host.querySelector('.procurement-order-detail input[type="number"]') as HTMLInputElement;
    expect(input.classList.contains("text-right")).toBe(true);
    await change(input, "11"); await click("保存发货进度");
    expect(mocks.shipping).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("不超过采购数量");
    await change(input, "10"); await click("保存发货进度");
    expect(mocks.shipping).toHaveBeenCalledWith({ id: 7, version: 4, lines: [{ itemId: 11, shippedQty: 10 }], carrier: "", trackingNo: "", note: "", requestId: expect.any(String) });
  });
  it("取消订单状态下保留详情和记录但不启用付款、发货或开票登记", async () => {
    order.lifecycle = "cancelled"; await details();
    expect(host.textContent).not.toContain("取消订单");
    for (const [tab, action] of [["付款登记", "保存付款进度"], ["发货登记", "保存发货进度"], ["供应商发票", "登记发票"]]) {
      await click(tab); expect(button(action).disabled).toBe(true);
    }
  });
  it("取消弹层保留警示、原因校验和原确认事件", async () => {
    await details(); await click("取消订单");
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("记录不会被删除");
    await click("确认取消订单"); expect(mocks.cancel).not.toHaveBeenCalled();
    await change(host.querySelector('[role="dialog"] textarea')!, "测试取消原因");
    await click("确认取消订单");
    expect(mocks.cancel).toHaveBeenCalledWith({ id: 7, version: 4, reason: "测试取消原因", requestId: expect.any(String) });
  });
  it("独占样式消费34px控件、13px正文、12px表头、16px标签和18px弹层语义，保留前台fallback", () => {
    const css = readFileSync(cssPath, "utf8");
    expect(css).toMatch(/\.procurement-order-control \{[^}]*height: var\(--admin-content-control-height, 32px\);[^}]*font-size: var\(--admin-content-font-body, 12px\);/);
    expect(css).toMatch(/\.procurement-order-tab \{[^}]*font-size: var\(--admin-content-section-title-size, 15px\);/);
    expect(css).toMatch(/\) th \{[^}]*font-size: var\(--admin-content-font-caption, 11px\);/);
    expect(css).toMatch(/\.procurement-order-dialog-title \{[^}]*font-size: var\(--admin-content-dialog-title-size, 18px\);/);
    expect(css).not.toMatch(/!important|zoom:|transform:/);
    expect(readFileSync(sourcePath, "utf8")).not.toContain("text-[22px]");
  });
});
