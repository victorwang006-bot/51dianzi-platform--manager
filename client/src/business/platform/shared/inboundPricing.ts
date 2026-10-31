export const CNY_TAX_INCLUDED = "CNY_TAX_INCLUDED" as const;
export const CNY_TAX_EXCLUDED = "CNY_TAX_EXCLUDED" as const;
export const INBOUND_PRICE_BASES = [
  CNY_TAX_INCLUDED,
  CNY_TAX_EXCLUDED,
] as const;
export type InboundPriceBasis = (typeof INBOUND_PRICE_BASES)[number];

export const DEFAULT_INBOUND_TAX_RATE = 13;
export const INBOUND_TAX_RATE_OPTIONS = [13, 9, 6, 3, 1, 0] as const;
export const MAX_INBOUND_UNIT_COST = 999_999_999;
export const MAX_INBOUND_TAX_RATE = 13;

const PRICE_SCALE = BigInt(1_000_000);
const ONE_HUNDRED_PERCENT_SCALED = BigInt(1000);

function divideAndRound(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / BigInt(2)) / denominator;
}

function toScaledPrice(value: number | string) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) throw new Error("采购单价无效");
  const fixed = numericValue.toFixed(6);
  const [integer, fraction = ""] = fixed.split(".");
  return BigInt(integer) * PRICE_SCALE + BigInt(fraction.padEnd(6, "0"));
}

function fromScaledPrice(value: bigint) {
  return Number(value) / Number(PRICE_SCALE);
}

export function roundInboundPrice(value: number) {
  return fromScaledPrice(toScaledPrice(value));
}

export function weightedInboundAverageCost(
  existingCost: number | string,
  existingQty: number,
  incomingCost: number | string,
  incomingQty: number
) {
  if (
    !Number.isSafeInteger(existingQty) ||
    existingQty < 0 ||
    !Number.isSafeInteger(incomingQty) ||
    incomingQty <= 0
  ) {
    throw new Error("库存数量无效");
  }
  const totalQty = existingQty + incomingQty;
  const weighted =
    toScaledPrice(existingCost) * BigInt(existingQty) +
    toScaledPrice(incomingCost) * BigInt(incomingQty);
  return fromScaledPrice(divideAndRound(weighted, BigInt(totalQty)));
}

export type NormalizedInboundPricing = {
  unitCost: number;
  unitCostBasis: InboundPriceBasis;
  taxRate: number;
  unitCostTaxIncluded: number;
  unitCostTaxExcluded: number;
};

/**
 * 按 6 位小数统一计算入库税价。所有整数运算都使用 BigInt，避免常见浮点误差。
 * 税率允许 0.0%—13.0%，精度为 0.1 个百分点。
 */
export function normalizeInboundPricing(
  unitCost: number,
  unitCostBasis: InboundPriceBasis,
  taxRate: number
): NormalizedInboundPricing {
  if (
    !Number.isFinite(unitCost) ||
    unitCost < 0 ||
    unitCost > MAX_INBOUND_UNIT_COST
  ) {
    throw new Error("采购单价无效");
  }
  if (
    !Number.isFinite(taxRate) ||
    taxRate < 0 ||
    taxRate > MAX_INBOUND_TAX_RATE ||
    Math.round(taxRate * 10) !== taxRate * 10
  ) {
    throw new Error("税率无效");
  }
  if (!INBOUND_PRICE_BASES.includes(unitCostBasis)) {
    throw new Error("价格类型无效");
  }

  const entered = toScaledPrice(unitCost);
  const rate = BigInt(Math.round(taxRate * 10));
  const factor = ONE_HUNDRED_PERCENT_SCALED + rate;
  const included =
    unitCostBasis === CNY_TAX_INCLUDED
      ? entered
      : divideAndRound(entered * factor, ONE_HUNDRED_PERCENT_SCALED);
  const excluded =
    unitCostBasis === CNY_TAX_EXCLUDED
      ? entered
      : divideAndRound(entered * ONE_HUNDRED_PERCENT_SCALED, factor);

  return {
    unitCost: fromScaledPrice(entered),
    unitCostBasis,
    taxRate,
    unitCostTaxIncluded: fromScaledPrice(included),
    unitCostTaxExcluded: fromScaledPrice(excluded),
  };
}
