import { describe, expect, it } from "vitest";
import { __sv2_micro, __sv2_money, __sv2_totals, __sv2_localFinance, __sv2_payload, __sv2_validate, __sv2_error, __sv2_complete, __sv2_editPreview } from "./businessSalesOrderMoney";
const form = () => ({ customerId: 9001, source: "company_stock", salesTaxMode: "tax_included", confirmationNote: "测试确认", customerConfirmed: true, dueDate: "2026-12-10", lines: [
  { partNumber: "PN", qty: "3", price: "26.1111", allocations: [{ lotId: 1, qty: "1", availableQty: 10 }, { lotId: 2, qty: "2", availableQty: 10 }] },
  { partNumber: "PN2", qty: "3", price: "31.2345", allocations: [{ lotId: 3, qty: "3", availableQty: 10 }] },
], expenses: [{ title: "运费", amount: "1.2345", note: "" }, { title: "返点", amount: "3.3333", note: "" }] });
describe("销售 v2 上线金额与校验", () => {
  it("逐行销售额、费用、净利润、佣金完全复用微单位算法", () => {
    const f = form(); const result = __sv2_totals(f);
    expect(result.sales).toBe(172036800n); expect(result.expense).toBe(4567800n);
    const finance = __sv2_localFinance({ profitBreakdown: { costAmount: "90.000000", netProfit: "66.804216" } }, f)!;
    expect(finance.net).toBe(66804216n); expect(finance.com).toBe(10020000n);
  });
  it("大数与负数半分舍入", () => { expect(__sv2_micro("999999999999.9999")).toBe(999999999999999900n); expect(__sv2_money("-0.005000")).toBe("¥-0.01"); });
  it("成本字段缺失时不推算、利润面板数据返回 null", () => expect(__sv2_localFinance({}, form())).toBeNull());
  it("半微元净利润独立舍入", () => {
    const f = { ...form(), lines: [{ qty: "1", price: "0.0001" }], expenses: [] };
    expect(__sv2_localFinance({ profitBreakdown: { costAmount: "0.000050", netProfit: "0.000044" } }, f)!.net).toBe(44n);
  });
  it.each([["50000", 15], ["50000.0001", 18], ["100000", 18], ["100000.0001", 20]])("整单未税净利润 %s 的档位", (amount, rate) => {
    const f = { ...form(), salesTaxMode: "tax_excluded", lines: [{ qty: "1", price: amount }], expenses: [] };
    expect(__sv2_localFinance({ profitBreakdown: { costAmount: "0", netProfit: amount } }, f)!.rate).toBe(rate);
  });
  it("新建多物料多批次 payload 不改变现有接口能力", () => {
    const f = form(); expect(__sv2_validate(f, null)).toEqual([]);
    expect(__sv2_payload(f, "sv2_test").items[0].allocations).toEqual([{ lotId: 1, qty: 1 }, { lotId: 2, qty: 2 }]);
    expect(__sv2_payload(f, "sv2_test")).not.toHaveProperty("expenses");
  });
  it("同批次跨物料重复占用按总量校验", () => {
    const f = form(); f.lines[1].allocations = [{ lotId: 1, qty: "3", availableQty: 3 }];
    expect(__sv2_validate(f, null)).toContain("PN2：超过批次可售 3");
  });
  it("批次合计必须等于销售数量", () => { const f = form(); f.lines[0].allocations[0].qty = "2"; expect(__sv2_validate(f, null)).toContain("PN：批次分配合计须等于销售数量"); });
  it("已出货与含月结已收金额下限", () => {
    const f = { ...form(), lines: [{ partNumber: "PN", qty: "1", price: "1", shippedQty: 2 }], expenses: [] };
    const errors = __sv2_validate(f, { paidAmount: "1", monthlyAmount: "1" });
    expect(errors.some(e => e.includes("少于已出货"))).toBe(true); expect(errors.some(e => e.includes("不能低于已收款"))).toBe(true);
  });
  it("超限金额与确认说明前置拒绝", () => {
    const f = { ...form(), confirmationNote: "", lines: [{ qty: "999999999", price: "99999999999999.9999" }] };
    const errors = __sv2_validate(f, null); expect(errors.some(e => e.includes("超出"))).toBe(true); expect(errors.some(e => e.includes("确认说明"))).toBe(true);
  });
  it("完成状态由足额收款（含月结）与全量出货派生", () => {
    const o = { status: "confirmed", totalAmount: "10", paidAmount: "4", monthlyAmount: "6", orderedQty: 3, shippedQty: 3 };
    expect(__sv2_complete(o)).toBe(true); expect(__sv2_complete({ ...o, shippedQty: 2 })).toBe(false); expect(__sv2_complete({ ...o, status: "cancelled" })).toBe(false);
  });
  it("编辑预估减少预留按批次倒序，不移除已消耗的数量", () => {
    const o = { sourceType: "company_stock", companyStockAllocations: [{ orderItemId: 1, lotId: 11, qty: 3, releasedQty: 0, consumedQty: 2 }, { orderItemId: 1, lotId: 12, qty: 3, releasedQty: 0, consumedQty: 0 }] };
    const f = { ...form(), lines: [{ orderItemId: 1, orderedQty: 6, qty: "3", price: "1" }] };
    expect(__sv2_editPreview(o, f)!.items[0].allocations).toEqual([{ lotId: 11, qty: 3 }]);
  });
  it("网络、权限、结构校验错误均为上线中文提示", () => {
    expect(__sv2_error({ data: { code: "BAD_REQUEST" }, message: '[{"path":["expenses"]}]' })).toContain("服务器校验");
    expect(__sv2_error({ data: { code: "FORBIDDEN" } })).toContain("权限");
    expect(__sv2_error(new Error("NetworkError"))).toContain("不要重复创建");
  });
});
