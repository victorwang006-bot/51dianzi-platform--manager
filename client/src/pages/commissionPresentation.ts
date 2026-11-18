import type { PersonalCommissionOrder, PersonalCommissionPendingReason } from "@shared/personalCommission";

const PENDING_REASONS: Record<PersonalCommissionPendingReason, string> = {
  unknown_policy: "历史规则版本待确认",
  missing_financial_audit: "缺少财务审计快照",
  audit_mismatch: "审计快照与订单不一致",
  missing_cost: "成本待核",
  incomplete_allocations: "批次成本分配不完整",
  unknown_tax_basis: "订单税务口径待核",
  invalid_financial_evidence: "财务证据待核",
};

export const COLLECTION_LABELS: Record<PersonalCommissionOrder["collectionStatus"], string> = {
  uncollected: "未回款", partial: "部分回款", collected: "足额回款",
};

/** Display rounding only. Decimal strings never pass through Number or floating point. */
export function commissionAmount(value: string | null | undefined, unavailable = "待核"): string {
  if (value == null || !/^-?\d+(?:\.\d+)?$/.test(value)) return unavailable;
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  let cents = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  if (fraction.length > 2 && fraction[2] >= "5") cents += BigInt(1);
  const grouped = (cents / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative && cents !== BigInt(0) ? "-" : ""}${grouped}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}

export function commissionPendingReason(reason: PersonalCommissionPendingReason | null): string {
  return reason ? PENDING_REASONS[reason] : "财务证据待核";
}

/** rate is already a percentage from the server, e.g. 15, NOT 0.15. */
export function commissionRate(rate: number | null): string {
  return rate !== null && Number.isFinite(rate) ? `${rate}%` : "比例待核";
}

export function businessDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

/** Immutable explanation of this saved version only; never fall back to a current policy. */
export function commissionFormula(order: Pick<PersonalCommissionOrder, "policyVersion" | "salesTaxMode">): string[] {
  if (order.policyVersion !== "20261117-per-order-whole-margin87-after-expenses") {
    return ["历史规则版本待确认，暂不解释计算公式。"];
  }
  if (order.salesTaxMode !== "tax_included" && order.salesTaxMode !== "tax_excluded") {
    return ["订单税务口径待核，暂不解释计算公式。"];
  }
  return [
    order.salesTaxMode === "tax_included" ? "净利润 =（销售额 − 采购成本）× 87% − 费用" : "净利润 = 销售额 − 采购成本 − 费用",
    "预计提成 = 正净利润 × 本单提成比例；净利润不大于零时提成为零。",
    "按单笔净利润全额套档：不超过 50,000.00 为 15%；超过 50,000.00 且不超过 100,000.00 为 18%；超过 100,000.00 为 20%。",
  ];
}
