import { describe, expect, it } from "vitest";
import { businessDate, commissionAmount, commissionFormula, commissionPendingReason, commissionRate } from "./commissionPresentation";

const knownVersion = "20261117-per-order-whole-margin87-after-expenses";

describe("commission display only: decimal strings and saved policy explanations", () => {
  it.each([
    ["0.000000", "0.00"], ["17", "17.00"], ["17.1", "17.10"], ["1234.125000", "1,234.13"],
    ["999.999999", "1,000.00"], ["1.004999", "1.00"], ["1.005000", "1.01"],
    ["-12.345000", "-12.35"], ["-0.000001", "0.00"], ["-0.005000", "-0.01"],
    ["12345678901234567890.123456", "12,345,678,901,234,567,890.12"],
    ["999999999999999999999999999999.995000", "1,000,000,000,000,000,000,000,000,000,000.00"],
  ])("formats %s to two decimals without binary float conversion", (source, expected) => {
    expect(commissionAmount(source)).toBe(expected);
  });
  it.each([null, undefined, "NaN", "Infinity", "1e4", "", " 3.00", "12,000.00"])("keeps invalid or unavailable value %s unknown", value => {
    expect(commissionAmount(value)).toBe("待核");
    expect(commissionAmount(value, "成本待核")).toBe("成本待核");
  });
  it("explains exactly the stored known version, without importing or recalculating a current rule", () => {
    const included = commissionFormula({ policyVersion: knownVersion, salesTaxMode: "tax_included" });
    expect(included[0]).toBe("净利润 =（销售额 − 采购成本）× 87% − 费用");
    expect(included.join(" ")).toContain("单笔净利润全额套档");
    expect(included.join(" ")).toContain("不超过 50,000.00 为 15%");
    expect(included.join(" ")).toContain("不超过 100,000.00 为 18%");
    expect(included.join(" ")).toContain("超过 100,000.00 为 20%");
    expect(commissionFormula({ policyVersion: knownVersion, salesTaxMode: "tax_excluded" })[0]).toBe("净利润 = 销售额 − 采购成本 − 费用");
  });
  it.each([null, "synthetic-historical-v0", `${knownVersion}-new`])("does not substitute current formulas for unknown version %s", policyVersion => {
    const lines = commissionFormula({ policyVersion, salesTaxMode: "tax_included" }).join(" ");
    expect(lines).toContain("历史规则版本待确认");
    expect(lines).not.toMatch(/87%|15%|18%|20%|净利润 =/);
  });
  it("does not assume tax basis or costs", () => {
    expect(commissionFormula({ policyVersion: knownVersion, salesTaxMode: null }).join(" ")).toContain("税务口径待核");
    expect(commissionPendingReason("missing_cost")).toBe("成本待核");
    expect(commissionPendingReason(null)).toBe("财务证据待核");
  });
  it("uses server percentages as percentages, not fractions", () => {
    expect(commissionRate(15)).toBe("15%");
    expect(commissionRate(18)).toBe("18%");
    expect(commissionRate(20)).toBe("20%");
    expect(commissionRate(0.125)).toBe("0.125%");
    expect(commissionRate(null)).toBe("比例待核");
    expect(commissionRate(NaN)).toBe("比例待核");
  });
  it("keeps the order creation time in Shanghai", () => {
    expect(businessDate("2026-10-31T16:01:00Z")).toContain("2026/11/01");
  });
});
