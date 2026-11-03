// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  orders: [] as Array<Record<string, unknown>>,
  refundDetail: null as Record<string, unknown> | null,
  ship: vi.fn(),
  confirmPay: vi.fn(),
  cancel: vi.fn(),
  approveRefund: vi.fn(),
  rejectRefund: vi.fn(),
  agreeReturn: vi.fn(),
  confirmOfflineRefund: vi.fn(),
  error: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/business/api/business-trpc", () => ({
  trpc: {
    useUtils: () => ({ order: { sellerOrders: { invalidate: runtime.invalidate } } }),
    order: {
      sellerOrders: { useQuery: () => ({ data: runtime.orders, isLoading: false }) },
      expressCos: { useQuery: () => ({ data: ["顺丰速运", "圆通速递"] }) },
      tracks: { useQuery: () => ({ data: [] }) },
      refundDetail: { useQuery: () => ({ data: runtime.refundDetail, isLoading: false }) },
      ship: { useMutation: () => ({ mutate: runtime.ship, isPending: false }) },
      sellerConfirmPay: { useMutation: () => ({ mutate: runtime.confirmPay, isPending: false }) },
      sellerCancel: { useMutation: () => ({ mutate: runtime.cancel, isPending: false }) },
      approveRefund: { useMutation: () => ({ mutate: runtime.approveRefund, isPending: false }) },
      rejectRefund: { useMutation: () => ({ mutate: runtime.rejectRefund, isPending: false }) },
      agreeReturn: { useMutation: () => ({ mutate: runtime.agreeReturn, isPending: false }) },
      confirmOfflineRefund: { useMutation: () => ({ mutate: runtime.confirmOfflineRefund, isPending: false }) },
    },
  },
}));
vi.mock("@/business/BusinessContentFrame", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/business/platform/client/src/components/LogisticsDialog", () => ({ default: () => null }));
vi.mock("@/business/platform/client/src/components/WaybillOcrUploader", () => ({ default: () => null }));
vi.mock("sonner", () => ({ toast: { error: runtime.error, success: vi.fn(), warning: vi.fn() } }));

import OutboundManagement, { canMutateOutboundOrder } from "@/business/platform/client/src/pages/OutboundManagement";

let host: HTMLDivElement;
let root: Root;
function order(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id, orderNo: `TEST-${id}`, buyerCompanyName: "测试采购企业", buyerDisplayName: "测试买家",
    status: "paid", statusNote: null, totalAmount: "1200.00", taxAmount: "138.05", shippingFee: "0",
    receiver: "收货人", receiverPhone: "13800000000", receiverAddress: "测试收货地址",
    note: "原始买家备注", expressCo: null, expressNo: null, payMethod: "corp", transferDeclaredAt: null,
    corpPayeeMode: "seller_direct", payeeAccountName: "测试收款企业", payeeAccountNumber: "12345678", payeeBankName: "测试银行",
    deliveryMethod: "express", deliveryPlanMode: "seller_split", pickupPointName: "测试自提点",
    pickupAddress: "测试自提地址", pickupContact: "仓库联系人", pickupPhone: "13900000000", pickupBusinessHours: "09:00-18:00",
    pickupReadyAt: null, pickedUpAt: null, logistics: null, createdAt: new Date("2026-11-01T01:00:00Z"),
    items: [{ id: id * 10, partNumber: `PART-${id}`, unitPrice: "12.00", qty: 100 }],
    ...overrides,
  };
}
function button(label: string, scope: ParentNode = host) {
  const result = Array.from(scope.querySelectorAll("button")).find(element => element.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function click(element: HTMLElement) { await act(async () => element.click()); }
async function fill(selector: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!element) throw new Error(`Missing field: ${selector}`);
  await act(async () => {
    const prototype = element.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function render(readOnly = false) { await act(async () => root.render(createElement(OutboundManagement, { readOnly }))); }
async function openDetail(id = 1) { await click(button(`TEST-${id}`)); }
function dialog() { return host.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]')!; }

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  runtime.orders = [order(1)];
  runtime.refundDetail = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("outbound unified presentation", () => {
  it("uses shared page primitives and preserves status/tab-panel relationships and columns", async () => {
    await render();
    expect(host.querySelector("section.aui-page")?.getAttribute("data-admin-ui-system")).toBe("channel-inventory");
    expect(host.querySelector(".aui-page-header h1")?.textContent).toBe("线上订单");
    expect(host.querySelector("nav.aui-page-tabs")?.getAttribute("aria-label")).toBe("线上订单状态");
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(7);
    expect(host.querySelector(".aui-filterbar")).not.toBeNull();
    expect(host.querySelector(".aui-data-panel")?.getAttribute("aria-labelledby")).toBe("sales-order-tab-all");
    expect(Array.from(host.querySelectorAll("th")).map(node => node.textContent)).toEqual(["", "订单 / 日期", "客户 / 收货人", "商品明细", "含税金额", "配送 / 物流", "状态", "操作"]);
    expect(host.querySelector("th.sales-order-numeric")?.textContent).toBe("含税金额");
    expect(host.querySelector("td.sales-order-numeric")?.textContent).toContain("¥1,200.00");
    expect(button("导出选中").disabled).toBe(true);
  });

  it("keeps draft filters unapplied until Enter, then resets filters and selected orders", async () => {
    runtime.orders = [order(1), order(2)];
    await render();
    await click(host.querySelector<HTMLInputElement>('[aria-label="选择订单 TEST-1"]')!);
    expect(button("导出选中（1）").disabled).toBe(false);
    await fill('[placeholder="搜索订单号或型号"]', "PART-2");
    expect(button("TEST-1")).toBeTruthy();
    await act(async () => host.querySelector("input.crm-input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(host.querySelector("tbody")?.textContent).not.toContain("TEST-1");
    expect(host.querySelector("tbody")?.textContent).toContain("TEST-2");
    expect(button("导出选中").disabled).toBe(true);
    await click(button("重置"));
    expect(host.querySelector("tbody")?.textContent).toContain("TEST-1");
  });

  it("preserves page size, page selection, status keyboard navigation and after-sales aggregation", async () => {
    runtime.orders = Array.from({ length: 12 }, (_, index) => order(index + 1, { status: index === 10 ? "refund" : index === 11 ? "refunded" : "paid" }));
    await render();
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    await click(button("2", host.querySelector(".sales-order-pagination")!));
    expect(host.querySelector("tbody")?.textContent).toContain("TEST-11");
    await click(host.querySelector<HTMLInputElement>('[aria-label="选择本页全部订单"]')!);
    expect(button("导出选中（2）").disabled).toBe(false);
    await click(host.querySelector<HTMLElement>("#sales-order-tab-after_sales")!);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(host.querySelector("#sales-order-tab-after_sales")?.getAttribute("aria-selected")).toBe("true");
    expect(button("导出选中").disabled).toBe(true);
    expect(host.querySelector(".sales-order-pagination")?.textContent).toContain("第 1 / 1 页");
    await act(async () => host.querySelector("#sales-order-tab-after_sales")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(host.querySelector("#sales-order-tab-all")?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
  });

  it("retains advanced receiver, tracking and date filters", async () => {
    runtime.orders = [order(1, { expressNo: "SF123456" }), order(2, { receiver: "另一收货人", receiverPhone: "13999999999", createdAt: new Date("2026-10-01T01:00:00Z") })];
    await render();
    await click(button("更多筛选"));
    await fill('[placeholder="收货人或电话"]', "13800000000");
    await fill('[placeholder="快递单号"]', "SF123");
    await fill('[aria-label="订单开始日期"]', "2026-11-01");
    await fill('[aria-label="订单结束日期"]', "2026-11-02");
    await click(button("筛选"));
    expect(host.querySelector("tbody")?.textContent).toContain("TEST-1");
    expect(host.querySelector("tbody")?.textContent).not.toContain("TEST-2");
    await click(button("重置"));
    expect(host.querySelector('[data-testid="sales-order-advanced-filters"]')).toBeNull();
    expect(host.querySelector("tbody")?.textContent).toContain("TEST-2");
  });

  it("keeps all item quantities, receiver, buyer note and detail amounts visible", async () => {
    runtime.orders = [order(1, { items: [{ id: 10, partNumber: "PART-1", unitPrice: "12", qty: 100 }, { id: 11, partNumber: "PART-EXTRA", unitPrice: "20", qty: 8 }] })];
    await render();
    await click(host.querySelector<HTMLElement>('[aria-label="展开订单全部商品"]')!);
    expect(host.querySelector("tbody")?.textContent).toContain("PART-EXTRA");
    expect(host.querySelector("tbody")?.textContent).toContain("8 × ¥20.00");
    await openDetail();
    expect(dialog()?.getAttribute("aria-labelledby")).toBe("outbound-detail-title");
    for (const text of ["TEST-1", "PART-EXTRA", "100", "原始买家备注", "测试收货地址", "13800000000", "1,200.00", "138.05"]) expect(dialog().textContent).toContain(text);
    expect(dialog().querySelectorAll(".outbound-detail-item")).toHaveLength(2);
  });

  it("preserves express shipment validation and the original order association", async () => {
    await render();
    await openDetail();
    await click(button("发货", dialog()));
    expect(dialog().getAttribute("aria-labelledby")).toBe("outbound-ship-title");
    await fill('[placeholder="填写快递运单号"]', "12345");
    await click(button("确认发货", dialog()));
    expect(runtime.ship).not.toHaveBeenCalled();
    expect(runtime.error).toHaveBeenCalledWith("请填写正确的快递单号（至少 6 位）");
    await fill('[placeholder="填写快递运单号"]', "  SF12345678  ");
    await click(button("确认发货", dialog()));
    expect(runtime.ship.mock.calls).toEqual([[{ orderId: 1, deliveryMethod: "express", expressCo: "顺丰速运", expressNo: "SF12345678" }]]);
  });

  it("keeps pickup stock-ready action free of express fields and sends only the pickup payload", async () => {
    runtime.orders = [order(1, { deliveryMethod: "pickup" })];
    await render();
    await openDetail();
    await click(button("备货完成", dialog()));
    expect(dialog().textContent).toContain("测试自提地址");
    expect(dialog().textContent).toContain("仓库联系人");
    expect(dialog().querySelector('[placeholder="填写快递运单号"]')).toBeNull();
    await click(button("通知买家", dialog()));
    expect(runtime.ship.mock.calls).toEqual([[{ orderId: 1, deliveryMethod: "pickup" }]]);
  });

  it("preserves confirmation voucher normalization and original order id", async () => {
    runtime.orders = [order(1, { status: "pending" })];
    await render();
    await openDetail();
    await click(button("确认到账", dialog()));
    expect(dialog().getAttribute("aria-labelledby")).toBe("outbound-confirm-pay-title");
    await fill('[placeholder="银行流水号或转账附言，便于日后对账"]', "  BANK-1234  ");
    await click(button("确认已收款", dialog()));
    expect(runtime.confirmPay.mock.calls).toEqual([[{ orderId: 1, voucher: "BANK-1234" }]]);
  });

  it("keeps read-only pages unable to mutate while detail, contract and timeline remain available", async () => {
    runtime.orders = [order(1, { status: "pending" })];
    await render(true);
    expect(canMutateOutboundOrder(true)).toBe(false);
    expect(canMutateOutboundOrder(false)).toBe(true);
    expect(host.textContent).toContain("（只读）");
    await click(host.querySelector<HTMLElement>('[aria-label="操作 TEST-1"]')!);
    const menu = host.querySelector("#sales-order-actions-1")!;
    expect(menu.querySelector("a")?.getAttribute("href")).toBe("/api/orders/1/contract");
    expect(menu.textContent).toContain("订单动态");
    for (const text of ["确认到账", "取消订单", "填写快递", "通过售后"]) expect(menu.textContent).not.toContain(text);
    await click(button("查看详情", menu));
    expect(dialog().textContent).toContain("订单动态");
    expect(dialog().textContent).not.toContain("取消订单");
    expect(dialog().textContent).not.toContain("确认到账");
    await click(button("订单动态", dialog()));
    expect(host.querySelector("#outbound-tracks-title")?.textContent).toContain("订单动态");
    expect(runtime.ship).not.toHaveBeenCalled();
    expect(runtime.confirmPay).not.toHaveBeenCalled();
    expect(runtime.cancel).not.toHaveBeenCalled();
  });

  it("keeps refund rejection validation and offline bank-voucher confirmation", async () => {
    runtime.orders = [order(1, { status: "refund" })];
    runtime.refundDetail = { status: "requested", refundAmount: "1200", goodsAmount: "1200", shippingFee: "0", statusLabel: "申请中", reason: "买家原始退款理由" };
    await render();
    await click(host.querySelector<HTMLElement>('[aria-label="操作 TEST-1"]')!);
    await click(button("驳回退款", host.querySelector("#sales-order-actions-1")!));
    expect(dialog().getAttribute("aria-labelledby")).toBe("outbound-refund-title");
    await fill("textarea", "短");
    await click(button("确认驳回", dialog()));
    expect(runtime.rejectRefund).not.toHaveBeenCalled();
    expect(runtime.error).toHaveBeenCalledWith("请填写驳回理由");
    await fill("textarea", "  需要买家核对商品  ");
    await click(button("确认驳回", dialog()));
    expect(runtime.rejectRefund.mock.calls).toEqual([[{ orderId: 1, reason: "需要买家核对商品" }]]);
    runtime.refundDetail = { ...runtime.refundDetail, status: "pending_offline" };
    await render();
    const confirm = button("确认已线下汇出", dialog());
    expect(confirm.disabled).toBe(true);
    await fill('input[maxlength="64"]', " BANK-5678 ");
    await click(confirm);
    expect(runtime.confirmOfflineRefund.mock.calls).toEqual([[{ orderId: 1, voucherNo: "BANK-5678" }]]);
  });
});
