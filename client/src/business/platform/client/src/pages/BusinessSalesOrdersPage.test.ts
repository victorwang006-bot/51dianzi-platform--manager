// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ order: null as any, enabled: true, create: vi.fn(), revise: vi.fn(), fetch: vi.fn(), queries: [] as string[] }));
vi.mock("../../../../api/business-auth", () => ({ useAuth: () => ({ user: { id: 7, name: "合成销售员" } }) }));
vi.mock("../components/companyStock/useCompanyStockSession", () => ({ useCompanyStockScope: () => ({ ready: runtime.enabled, identityKey: "synthetic-identity", storageScope: "synthetic-scope" }) }));
vi.mock("../../../../api/business-trpc", () => {
  const query = (name: string) => ({
    useQuery: (input: any, options: any = {}) => { runtime.queries.push(name); return { data: name === "list" ? { items: runtime.order ? [runtime.order] : [], total: runtime.order ? 1 : 0 } : name === "get" && input?.id ? runtime.order : { items: [], total: 0 }, isSuccess: true, isFetching: false, isError: false, refetch: vi.fn() }; },
    useMutation: () => ({ mutateAsync: name === "createCompanyStock" ? runtime.create : name === "revise" ? runtime.revise : vi.fn().mockResolvedValue({}), isPending: false }),
    fetch: runtime.fetch, invalidate: vi.fn(),
  });
  const api = new Proxy({}, { get: (_, name: string) => query(name) });
  return { trpc: { useUtils: () => ({ crmSalesOrder: api }), crmSalesOrder: api } };
});
vi.mock("../components/ui/dialog", () => ({ Dialog: ({ open, children }: any) => open ? children : null, DialogContent: ({ children }: any) => createElement("section", { role: "dialog" }, children), DialogHeader: ({ children }: any) => children, DialogTitle: ({ children }: any) => createElement("h2", {}, children) }));
vi.mock("../components/companyStock/SalesCustomerPicker", () => ({ SalesCustomerPicker: () => null }));
vi.mock("../components/companyStock/CompanyStockShipmentForm", () => ({ CompanyStockShipmentForm: () => null }));
import { BusinessSalesOrdersPage, __sv2_Editor } from "./BusinessSalesOrdersPage";
import { __sv2_payload } from "../lib/businessSalesOrderMoney";
const frozen = () => ({ customerId: 1, customerName: "合成客户", source: "company_stock", owner: "销售员", orderDate: "2026-11-26", dueDate: "2026-12-10", salesTaxMode: "tax_included", customerConfirmed: true, confirmationNote: "合成确认", demand: null, lines: [{ partNumber: "PN", brand: "TI", qty: "3", price: "12.3400", allocations: [{ lotId: 1, qty: "3", availableQty: 10 }] }], expenses: [{ title: "运费", amount: "1.2345", note: "合成费用" }] });
function order() { return { id: 11, customerId: 1, customerName: "合成客户", createdByName: "销售员", sourceType: "company_stock", status: "confirmed", orderNumber: "SYNTHETIC-11", createdAt: "2026-11-26", dueDate: "2026-12-10", salesTaxMode: "tax_included", confirmationNote: "合成确认", orderedQty: 3, shippedQty: 0, totalAmount: "37.0200", paidAmount: "0", monthlyAmount: "0", version: 1, items: [{ id: 21, partNumber: "PN", brand: "TI", orderedQty: 3, shippedQty: 0, unitPrice: "12.3400" }], companyStockAllocations: [{ orderItemId: 21, lotId: 1, qty: 3, releasedQty: 0, consumedQty: 0 }], expenseItems: [], salesExpenses: "0", payments: [], shipments: [], audits: [] }; }
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true, IntersectionObserver: class { constructor(_: any) {} observe() {} disconnect() {} } });
  vi.clearAllMocks(); sessionStorage.clear(); runtime.order = order(); runtime.enabled = true; runtime.queries = [];
  runtime.fetch.mockImplementation(async () => runtime.order); runtime.create.mockResolvedValue({ id: 11, orderNumber: "SYNTHETIC-11" }); runtime.revise.mockResolvedValue({});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(session: any) { await act(async () => root.render(createElement(__sv2_Editor, { session, enabled: runtime.enabled, onClose: vi.fn(), onChanged: vi.fn() }))); }
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === text)!;
async function click(text: string) { await act(async () => button(text).click()); }
async function fill(label: string, text: string) { const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); }); }
function recovery() { const f = frozen(); return { new: true, recovery: { kind: "create", payload: __sv2_payload(f, "sv2_frozen_original"), frozen: f } }; }
describe("业务订单 v2 实际入口组件（仅合成传输）", () => {
  it("新建空表单没有利润占位或伪造成本，校验阻止创建", async () => {
    await render({ new: true }); await click("保存订单"); expect(runtime.create).not.toHaveBeenCalled(); expect(host.textContent).toContain("请选择客户"); expect(host.textContent).not.toContain("利润与提成");
  });
  it("已有订单无成本字段时隐藏整个利润面板，已发货客户锁定", async () => {
    runtime.order.shippedQty = 1; runtime.order.items[0].shippedQty = 1; await render({ id: 11 });
    expect(host.textContent).not.toContain("利润与提成"); expect(host.textContent).not.toContain("采购成本"); expect(host.textContent).toContain("客户：合成客户（锁定）");
  });
  it.each(["cancelled", "completed"])("%s 订单统一布局只读且没有保存/登记按钮", async status => {
    runtime.order.status = status; await render({ id: 11 }); expect(button("保存修改")).toBeUndefined(); expect(button("登记收款")).toBeUndefined(); expect(button("登记出货")).toBeUndefined();
  });
  it("冻结创建网络失败后重试的 payload 与 requestId 完全一致", async () => {
    runtime.create.mockRejectedValueOnce(new Error("NetworkError")); await render(recovery()); await click("重试原请求");
    expect(host.textContent).toContain("不要重复创建"); expect(button("关闭").disabled).toBe(true);
    await click("重试原请求"); expect(runtime.create).toHaveBeenCalledTimes(2); expect(runtime.create.mock.calls[1][0]).toEqual(runtime.create.mock.calls[0][0]);
  });
  it("创建成功费用失败转编辑且保留费用；补录成功不再 create", async () => {
    runtime.revise.mockRejectedValueOnce({ data: { code: "BAD_REQUEST" }, message: '[{"path":["expenses"]}]' });
    await render(recovery()); await click("重试原请求"); expect(runtime.create).toHaveBeenCalledOnce(); expect(host.textContent).toContain("订单已创建，但销售费用未保存"); expect(host.querySelector<HTMLInputElement>('[aria-label="费用第1行金额"]')!.value).toBe("1.2345");
    await click("保存修改"); await fill("修改原因", "补录创建费用"); await click("确认保存");
    expect(runtime.create).toHaveBeenCalledOnce(); expect(runtime.revise).toHaveBeenCalledTimes(2); expect(runtime.revise.mock.calls[1][0].expenses).toEqual([{ title: "运费", amount: "1.2345", note: "合成费用" }]);
  });
  it("未核验身份不发写请求", async () => {
    runtime.enabled = false; await render(recovery()); expect(button("重试原请求").disabled).toBe(true); expect(runtime.create).not.toHaveBeenCalled();
  });
  it("实际新版列表为五页签并明确当前页汇总，无成本利润列隐藏", async () => {
    await act(async () => root.render(createElement(BusinessSalesOrdersPage, { ready: true, state: {} })));
    expect([...host.querySelectorAll('[role="tab"]')].map(x => x.textContent)).toEqual(["全部", "待收款", "待出货", "已完成", "已取消"]);
    expect(host.textContent).toContain("当前页 · 当前页签汇总（非全库）"); expect([...host.querySelectorAll("th")].some(x => x.textContent === "净利润")).toBe(false);
  });
});
