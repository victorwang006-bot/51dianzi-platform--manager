import type { DictReferencePrice } from "../adminDb";
import type { PublishedInventoryPriceCandidate } from "../db";
import { normalizeLadder } from "../../../shared/cartUtils";
import {
  computeReferencePriceRange,
  deterministicRandom,
  seedFromString,
} from "../../../shared/referencePriceRange";
import { toTaxIncludedComparisonPrice } from "./searchRanking";

export type UnifiedPriceSource = "inventory" | "database";

export type UnifiedReferencePrice =
  | {
      ok: true;
      partNumber: string;
      queriedPartNumber: string;
      brand: string;
      category: string;
      package: string;
      low: number;
      high: number;
      unit: "元";
      display: string;
      source: UnifiedPriceSource;
      sourceLabel: string;
      matchedBy: DictReferencePrice["matchedBy"] | "inventory_exact";
      quantityThreshold: number;
      inventoryMinPrice: number | null;
      inventoryOfferCount: number;
      databaseBasePrice: number | null;
      databaseLow: number | null;
      databaseHigh: number | null;
    }
  | {
      ok: false;
      reason: "no_reliable_data";
      queriedPartNumber: string;
      inventoryOfferCount: number;
    };

type LowestInventoryOffer = {
  candidate: PublishedInventoryPriceCandidate;
  price: number;
  minQty: number;
};

const USER_RANGE_MIN = 0.03;
const USER_RANGE_MAX = 0.05;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizePartNumber(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}

function formatRange(low: number, high: number): string {
  return `${low.toFixed(2)} - ${high.toFixed(2)} 元`;
}

function toTwoDecimalRange(lowRaw: number, highRaw: number): { low: number; high: number } | null {
  const low = round2(lowRaw);
  let high = round2(highRaw);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0) return null;
  if (high <= low) high = round2(low + 0.01);
  return { low, high };
}

/**
 * 单条库存的最低可成交价。
 *
 * 阶梯价格只有在当前上架数量足以覆盖该档位时才有效，避免把“万颗价”用于
 * 只有几百颗库存的条目。没有阶梯价时退回商家填写的单一价格；两类价格
 * 都依据 taxIncluded 标记统一换算为含税比较口径。
 */
export function lowestExecutableInventoryPrice(
  candidate: PublishedInventoryPriceCandidate,
): { price: number; minQty: number } | null {
  const qtyOnSale = Number(candidate.qtyOnSale ?? 0);
  if (!Number.isFinite(qtyOnSale) || qtyOnSale <= 0) return null;
  const valid = normalizeLadder(candidate.ladderPrices, candidate.priceEx, candidate.moq)
    .map(tier => ({
      price: toTaxIncludedComparisonPrice(tier.price, candidate.taxIncluded),
      minQty: Number(tier.minQty),
    }))
    .filter(
      (tier): tier is { price: number; minQty: number } =>
        tier.price !== null
        && Number.isFinite(tier.minQty)
        && tier.minQty > 0
        && tier.minQty <= qtyOnSale,
    );
  if (valid.length === 0) return null;
  return valid.sort((a, b) => a.price - b.price || b.minQty - a.minQty)[0];
}

export function findLowestInventoryOffer(
  candidates: PublishedInventoryPriceCandidate[],
): { best: LowestInventoryOffer | null; offerCount: number } {
  const offers = candidates
    .map(candidate => {
      const executable = lowestExecutableInventoryPrice(candidate);
      return executable ? { candidate, ...executable } : null;
    })
    .filter((offer): offer is LowestInventoryOffer => offer !== null)
    .sort((a, b) => a.price - b.price || b.candidate.qtyOnSale - a.candidate.qtyOnSale || a.candidate.id - b.candidate.id);
  return { best: offers[0] ?? null, offerCount: offers.length };
}

/** 用户最低上架价为区间下限，上限按型号稳定增加 3%～5%。 */
export function computeInventoryPriceRange(
  partNumber: string,
  minimumPrice: number,
): { low: number; high: number; spread: number } | null {
  if (!Number.isFinite(minimumPrice) || minimumPrice <= 0) return null;
  const random = deterministicRandom(seedFromString(`${normalizePartNumber(partNumber)}:inventory-range`));
  const spread = USER_RANGE_MIN + random() * (USER_RANGE_MAX - USER_RANGE_MIN);
  const range = toTwoDecimalRange(minimumPrice, minimumPrice * (1 + spread));
  return range ? { ...range, spread } : null;
}

export function buildUnifiedReferencePrice(input: {
  queriedPartNumber: string;
  inventoryCandidates: PublishedInventoryPriceCandidate[];
  databasePrice: DictReferencePrice | null;
}): UnifiedReferencePrice {
  const queriedPartNumber = normalizePartNumber(input.queriedPartNumber);
  const inventory = findLowestInventoryOffer(input.inventoryCandidates);
  const inventoryRange = inventory.best
    ? computeInventoryPriceRange(queriedPartNumber, inventory.best.price)
    : null;
  const databaseRawRange = input.databasePrice
    ? computeReferencePriceRange(input.databasePrice.partNumber, input.databasePrice.basePrice)
    : null;
  const databaseRange = databaseRawRange
    ? toTwoDecimalRange(databaseRawRange.low, databaseRawRange.high)
    : null;

  const useInventory = Boolean(
    inventory.best
      && inventoryRange
      && (!databaseRawRange || inventory.best.price < databaseRawRange.low),
  );

  if (!useInventory && input.databasePrice && databaseRange) {
    return {
      ok: true,
      partNumber: input.databasePrice.partNumber,
      queriedPartNumber,
      brand: input.databasePrice.brand,
      category: input.databasePrice.category,
      package: input.databasePrice.package,
      low: databaseRange.low,
      high: databaseRange.high,
      unit: "元",
      display: formatRange(databaseRange.low, databaseRange.high),
      source: "database",
      sourceLabel: "依据平台最新价格库测算",
      matchedBy: input.databasePrice.matchedBy,
      quantityThreshold: input.databasePrice.quantityThreshold,
      inventoryMinPrice: inventory.best ? round2(inventory.best.price) : null,
      inventoryOfferCount: inventory.offerCount,
      databaseBasePrice: round2(input.databasePrice.basePrice),
      databaseLow: databaseRange.low,
      databaseHigh: databaseRange.high,
    };
  }

  if (inventory.best && inventoryRange) {
    return {
      ok: true,
      partNumber: inventory.best.candidate.partNumber,
      queriedPartNumber,
      brand: inventory.best.candidate.brand,
      category: inventory.best.candidate.category,
      package: inventory.best.candidate.pkg ?? "",
      low: inventoryRange.low,
      high: inventoryRange.high,
      unit: "元",
      display: formatRange(inventoryRange.low, inventoryRange.high),
      source: "inventory",
      sourceLabel: "依据平台当前有效上架价格测算",
      matchedBy: "inventory_exact",
      quantityThreshold: inventory.best.minQty,
      inventoryMinPrice: round2(inventory.best.price),
      inventoryOfferCount: inventory.offerCount,
      databaseBasePrice: input.databasePrice ? round2(input.databasePrice.basePrice) : null,
      databaseLow: databaseRange?.low ?? null,
      databaseHigh: databaseRange?.high ?? null,
    };
  }

  return {
    ok: false,
    reason: "no_reliable_data",
    queriedPartNumber,
    inventoryOfferCount: inventory.offerCount,
  };
}
