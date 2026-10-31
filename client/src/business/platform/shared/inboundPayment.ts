export const INBOUND_PAYMENT_UNPAID = "unpaid" as const;
export const INBOUND_PAYMENT_PARTIAL = "partial" as const;
export const INBOUND_PAYMENT_PAID = "paid" as const;
export const INBOUND_PAYMENT_MODES = [
  INBOUND_PAYMENT_UNPAID,
  INBOUND_PAYMENT_PARTIAL,
  INBOUND_PAYMENT_PAID,
] as const;
export type InboundPaymentMode = (typeof INBOUND_PAYMENT_MODES)[number];

export const MAX_INBOUND_PAYMENT_AMOUNT = 112_999_999_887_000;
export const MAX_INBOUND_QTY = 999_999_999;
const UNIT_COST_SCALE = BigInt(1_000_000);
const MONEY_SCALE = BigInt(100);
const MAX_PAYMENT_CENTS = BigInt("11299999988700000");

function divideAndRound(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / BigInt(2)) / denominator;
}

function decimalToScaled(value: number | string, scale: number, label: string) {
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0))
    throw new Error(`${label}无效`);
  const raw =
    typeof value === "number"
      ? String(value).toLowerCase().includes("e")
        ? value.toLocaleString("en-US", {
            useGrouping: false,
            maximumFractionDigits: 20,
          })
        : String(value)
      : value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new Error(`${label}无效`);
  const factor = BigInt(10 ** scale);
  const digits = match[2] ?? "";
  const kept = digits.slice(0, scale).padEnd(scale, "0");
  const shouldRound = Number(digits[scale] ?? "0") >= 5;
  return (
    BigInt(match[1]) * factor +
    BigInt(kept || "0") +
    (shouldRound ? BigInt(1) : BigInt(0))
  );
}

export function inboundMoneyCents(value: number | string) {
  const cents = decimalToScaled(value, 2, "付款金额");
  if (cents > MAX_PAYMENT_CENTS) throw new Error("付款金额过大");
  return cents;
}

export function roundInboundMoney(value: number | string) {
  return Number(inboundMoneyCents(value)) / Number(MONEY_SCALE);
}

export function normalizeInboundMoney(value: number | string) {
  return inboundMoneyStringFromCents(inboundMoneyCents(value));
}

export function formatInboundMoney(value: number | string) {
  const cents = inboundMoneyCents(value);
  const integer = cents / MONEY_SCALE;
  const fraction = String(cents % MONEY_SCALE).padStart(2, "0");
  return `${integer.toLocaleString("en-US")}.${fraction}`;
}

export function inboundMoneyStringFromCents(value: bigint) {
  const negative = value < BigInt(0);
  const absolute = negative ? -value : value;
  const integer = absolute / MONEY_SCALE;
  const fraction = String(absolute % MONEY_SCALE).padStart(2, "0");
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}

/** 按六位含税单价和整数数量计算应付货款，并四舍五入到人民币分。 */
export function inboundPayableCents(
  unitCostTaxIncluded: number | string,
  qty: number
) {
  if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error("采购数量无效");
  const unitCost = decimalToScaled(unitCostTaxIncluded, 6, "含税采购单价");
  const cents = divideAndRound(
    unitCost * BigInt(qty) * MONEY_SCALE,
    UNIT_COST_SCALE
  );
  if (cents > MAX_PAYMENT_CENTS) throw new Error("采购货款总额过大");
  return cents;
}

export function inboundPayableAmount(
  unitCostTaxIncluded: number | string,
  qty: number
) {
  return (
    Number(inboundPayableCents(unitCostTaxIncluded, qty)) / Number(MONEY_SCALE)
  );
}

export function inboundPayableString(
  unitCostTaxIncluded: number | string,
  qty: number
) {
  return inboundMoneyStringFromCents(
    inboundPayableCents(unitCostTaxIncluded, qty)
  );
}

export type InboundPaymentCategory =
  | "untracked"
  | "unpaid"
  | "partial"
  | "paid"
  | "overpaid"
  | "refunded"
  | "cancelled_pending";

export function classifyInboundPayment(input: {
  tracked: boolean;
  cancelled?: boolean;
  refunded?: boolean;
  payableAmount: number | string | null;
  paidAmount: number | string;
}): InboundPaymentCategory {
  if (!input.tracked) return "untracked";
  const paidCents = inboundMoneyCents(input.paidAmount);
  if (input.cancelled && paidCents > BigInt(0)) return "cancelled_pending";
  if (input.cancelled && input.refunded) return "refunded";
  if (paidCents === BigInt(0)) return "unpaid";
  if (input.payableAmount == null) return "overpaid";
  const payableCents = inboundMoneyCents(input.payableAmount);
  if (paidCents > payableCents) return "overpaid";
  if (paidCents === payableCents) return "paid";
  return "partial";
}

export function inboundPaymentPercentage(
  paidAmount: number | string,
  payableAmount: number | string | null
) {
  if (payableAmount == null) return null;
  const payableCents = inboundMoneyCents(payableAmount);
  if (payableCents === BigInt(0)) return null;
  const paidCents = inboundMoneyCents(paidAmount);
  return Math.round(Number((paidCents * BigInt(10_000)) / payableCents)) / 100;
}
