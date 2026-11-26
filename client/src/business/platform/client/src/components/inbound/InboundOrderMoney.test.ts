import { describe, expect, it } from "vitest";
import { __i2_scaled, __i2_fmt, __i2_figures, __i2_error, __i2_feeJson, __i2_historyDiff } from "../../lib/inboundOrderMoney";
describe("采购 v2 上线 BigInt 金额算法", () => {
  it.each([
    ["7680", 0, "7,680"], ["21", 4, "21.0000"],
    ["9999999999999.99", 2, "9,999,999,999,999.99"], ["-1.005", 2, "-1.01"],
  ])("格式化 %s / %s 位", (value, places, result) => expect(__i2_fmt(value, places)).toBe(result));
  it("六位微元不丢精度，超出位数返回无效而非浮点截断", () => {
    expect(__i2_scaled("0.123456", 6)).toBe(123456n);
    expect(__i2_scaled("0.1234567", 6)).toBeNull();
    expect(__i2_scaled("1e3", 6)).toBeNull();
  });
  it("多物料费用全部进成本，仅供应商费用进应付", () => {
    const result = __i2_figures([{ qty: "100", unitCost: "12.34" }, { qty: "30", unitCost: "0.38" }], "CNY_TAX_INCLUDED", "13", [{ amount: "10.25", payee: "supplier" }, { amount: "20.50", payee: "third_party" }]);
    expect(result.total).toBe(127615n); expect(result.payable).toBe(125565n); expect(result.unit).toBeNull();
  });
  it("单物料费用精确分摊到单位成本", () => {
    const result = __i2_figures([{ qty: "7680", unitCost: "21" }], "CNY_TAX_INCLUDED", "13", [{ amount: "180", payee: "third_party" }, { amount: "25", payee: "third_party" }]);
    expect(result.total).toBe(16148500n); expect(result.unit).toBe(21026693n);
  });
  it("先按上线规则换算含税微元，再逐行舍入到分", () => {
    expect(__i2_figures([{ qty: "100", unitCost: "1.01" }], "CNY_TAX_EXCLUDED", "13", []).goods).toBe(11413n);
  });
  it("费用比较归一化金额但不丢收款方与备注差异", () => {
    const fee = { title: " 运费 ", payee: "supplier", amount: "01.00", note: " 备注 " };
    expect(__i2_feeJson([fee])).toBe(__i2_feeJson([{ ...fee, title: "运费", amount: "1", note: "备注" }]));
    expect(__i2_feeJson([fee])).not.toBe(__i2_feeJson([{ ...fee, payee: "third_party" }]));
  });
  it("无成本权限时审计也隐藏金额字段", () => {
    const event = { snapshot: JSON.stringify({ before: { qty: 1, costTotal: "1.00" }, after: { qty: 2, costTotal: "2.00" } }) };
    expect(__i2_historyDiff(event, false)).toBe("数量：1 → 2");
    expect(__i2_historyDiff(event, true)).toContain("采购总成本");
  });
  it.each([
    [{ message: "403", data: { code: "FORBIDDEN" } }, "权限"],
    [{ message: "NetworkError" }, "网络"],
    [{ message: JSON.stringify([{ path: ["costs", 0, "amount"], message: "Invalid" }]) }, "采购费用 / 第1行 / 金额"],
  ])("错误响应转中文提示", (error, text) => expect(__i2_error(error)).toContain(text));
});
