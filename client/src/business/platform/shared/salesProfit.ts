export type SalesTaxMode = "tax_included" | "tax_excluded";
export type SalesCommissionPolicy = {
  version: string;
  bandMode: "whole" | "progressive";
  taxMode: "margin_deduct13" | "margin_removeVAT" | "sales_deduct13";
};

/** User confirmed A at 18:01 and whole per-order bands at 18:02 on 2026-11-17. */
export const SALES_PROFIT_TAX_MODE: SalesCommissionPolicy["taxMode"] | null = "margin_deduct13";
export const SALES_COMMISSION_POLICY: SalesCommissionPolicy | null = {
  version: "20261117-per-order-whole-margin87-after-expenses",
  bandMode: "whole",
  taxMode: "margin_deduct13",
};
export const SALES_COMMISSION_THRESHOLDS = ["50000", "100000"] as const;
export const SALES_COMMISSION_RATES = [15, 18, 20] as const;

export type SalesProfitInput = {
  salesAmount: string;
  /** Total actual batch cost in the SAME basis as the order; null is unknown, never zero. */
  costAmount: string | null;
  expenseAmount: string;
  salesTaxMode: SalesTaxMode;
  /** Sum of bank/cash collection records only; monthly terms are not cash. */
  bankCashPaidAmount: string;
  cancelled?: boolean;
};

const SCALE = BigInt(1000000);
const ZERO = BigInt(0);
function parseAmount(value: string): bigint {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,29})(?:\.\d{1,6})?$/.test(value.trim())) {
    throw new Error("金额须为非负十进制，最多六位小数");
  }
  const [whole, fraction = ""] = value.trim().split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, "0"));
}
function roundDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= ZERO) throw new Error("invalid money denominator");
  const sign = numerator < ZERO ? BigInt(-1) : BigInt(1);
  const absolute = numerator < ZERO ? -numerator : numerator;
  return sign * ((absolute * BigInt(2) + denominator) / (denominator * BigInt(2)));
}
function formatScaled(value: bigint, scale: number): string {
  const sign = value < ZERO ? "-" : "";
  const absolute = value < ZERO ? -value : value;
  let factor = BigInt(1);
  for (let index = 0; index < scale; index += 1) factor *= BigInt(10);
  return `${sign}${absolute / factor}.${(absolute % factor).toString().padStart(scale, "0")}`;
}
function formatMicro(value: bigint): string { return formatScaled(value, 6); }
function ratioAmount(numerator: bigint, denominator: bigint): string {
  return formatMicro(roundDivide(numerator, denominator));
}
function policyIsValid(policy: SalesCommissionPolicy): boolean {
  return typeof policy.version === "string" && policy.version.length > 0
    && ["whole", "progressive"].includes(policy.bandMode)
    && ["margin_deduct13", "margin_removeVAT", "sales_deduct13"].includes(policy.taxMode);
}

/**
 * Rational fixed-point arithmetic: tier comparisons use the unrounded net profit.
 * Monetary commission is rounded once to cents; costs retain six decimal places.
 * The policy is injected by the SERVER only, never accepted in a browser payload.
 * Default production policy is the explicitly confirmed whole per-order margin87 rule.
 */
export function calculateSalesProfit(
  input: SalesProfitInput,
  policy: SalesCommissionPolicy | null = SALES_COMMISSION_POLICY,
) {
  if (input.salesTaxMode !== "tax_included" && input.salesTaxMode !== "tax_excluded") {
    throw new Error("销售税务口径未确认");
  }
  const sales = parseAmount(input.salesAmount);
  const expenses = parseAmount(input.expenseAmount);
  const collected = parseAmount(input.bankCashPaidAmount);
  const cost = input.costAmount === null ? null : parseAmount(input.costAmount);
  if (policy !== null && !policyIsValid(policy)) throw new Error("提成规则无效");
  const collectionStatus = collected <= ZERO ? "uncollected" as const
    : sales > ZERO && collected >= sales ? "collected" as const : "partial" as const;
  const taxMode = policy?.taxMode ?? SALES_PROFIT_TAX_MODE;
  const taxPending = input.salesTaxMode === "tax_included" && taxMode === null;
  const status = cost === null ? "unknown_cost" as const : taxPending ? "tax_pending" as const : "ready" as const;
  const reason = input.cancelled ? "订单已取消，不计提成"
    : cost === null ? "采购成本待核，不按零成本计算"
    : taxPending ? "含税13%的计算口径待确认"
    : policy === null ? "全额或分段提成口径待确认" : null;
  const grossProfit = cost === null ? null : formatMicro(sales - cost);
  let netNumerator: bigint | null = null;
  let denominator = BigInt(1);
  let taxNumerator: bigint | null = null;
  if (cost !== null && !taxPending) {
    const margin = sales - cost;
    if (input.salesTaxMode === "tax_excluded") {
      netNumerator = margin - expenses;
      taxNumerator = ZERO;
    } else if (taxMode === "margin_deduct13") {
      denominator = BigInt(100);
      netNumerator = margin * BigInt(87) - expenses * denominator;
      taxNumerator = margin * BigInt(13);
    } else if (taxMode === "margin_removeVAT") {
      denominator = BigInt(113);
      netNumerator = margin * BigInt(100) - expenses * denominator;
      taxNumerator = margin * BigInt(13);
    } else if (taxMode === "sales_deduct13") {
      denominator = BigInt(100);
      netNumerator = sales * BigInt(87) - (cost + expenses) * denominator;
      taxNumerator = sales * BigInt(13);
    }
  }
  let estimatedAmount: string | null = null;
  let earnedAmount: string | null = input.cancelled ? "0.00" : null;
  let rate: number | null = null;
  if (netNumerator !== null && policy !== null) {
    const positive = netNumerator > ZERO ? netNumerator : ZERO;
    const first = BigInt(50000) * SCALE * denominator;
    const second = BigInt(100000) * SCALE * denominator;
    let commissionNumerator: bigint;
    if (policy.bandMode === "whole") {
      rate = positive <= first ? 15 : positive <= second ? 18 : 20;
      commissionNumerator = positive * BigInt(rate);
    } else {
      const bandOne = positive > first ? first : positive;
      const bandTwo = positive <= first ? ZERO : positive > second ? second - first : positive - first;
      const bandThree = positive <= second ? ZERO : positive - second;
      commissionNumerator = bandOne * BigInt(15) + bandTwo * BigInt(18) + bandThree * BigInt(20);
    }
    const cents = roundDivide(commissionNumerator * BigInt(100), denominator * SCALE * BigInt(100));
    estimatedAmount = input.cancelled ? "0.00" : formatScaled(cents, 2);
    earnedAmount = !input.cancelled && collectionStatus === "collected" ? estimatedAmount : "0.00";
  }
  return {
    profitBreakdown: {
      salesAmount: formatMicro(sales),
      costAmount: cost === null ? null : formatMicro(cost),
      expenseAmount: formatMicro(expenses),
      grossProfit,
      taxDeductionAmount: taxNumerator === null ? null : ratioAmount(taxNumerator, denominator),
      netProfit: netNumerator === null ? null : ratioAmount(netNumerator, denominator),
      salesTaxMode: input.salesTaxMode,
      status,
      policyVersion: policy?.version ?? null,
    },
    commissionPreview: {
      estimatedAmount,
      earnedAmount,
      configPending: policy === null,
      collectionStatus,
      reason,
      rate,
      bandMode: policy?.bandMode ?? null,
      thresholds: SALES_COMMISSION_THRESHOLDS,
      rates: SALES_COMMISSION_RATES,
      policyVersion: policy?.version ?? null,
    },
  };
}
