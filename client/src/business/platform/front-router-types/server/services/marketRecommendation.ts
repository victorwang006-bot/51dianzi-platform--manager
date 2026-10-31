import { marketPackagingLookupKeys, resolveMarketPackagingGroup, isMarketPackagingBrandCompatible, isMarketPackagingPackageCompatible, marketPackagingLabel, normalizeMarketPartNumber } from "../../../shared/marketPackaging";
import { readPublicHotSnapshot } from "./publicHotSnapshot";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import {
  companies,
  dailyRecommendations,
  enterpriseMembers,
  enterprises,
  forumMessages,
  forumSupplierQuotes,
  inventories,
  marketSnapshots,
  orderItems,
  orders,
  recommendationFavorites,
  recommendationInventoryScores,
  recommendationScoreState,
  scheduledJobs,
  searchEvents,
  users,
  type LadderTier,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { companyCatalogVisibleCondition } from "./inventoryVisibility";
import { SUPPLIER_NAME_FALLBACK } from "../../../shared/supplierDisplayName";
import { redactMarketInventoryLocation } from "./publicInventoryLocation";
import { type DictReferencePrice } from "../adminDb";

/**
 * 供应商展示名的统一 SQL 片段（与 server/db.ts 同口径）。
 * 调用方必须已 leftJoin companies 与 users。
 * 2026-08-17 自营平权：移除自营别名分支。
 */
const supplierDisplayNameSql = sql<string>`COALESCE(${companies.companyName}, ${users.name}, ${users.username}, ${SUPPLIER_NAME_FALLBACK})`;

const DAY_MS = 86_400_000;

export const MARKET_SNAPSHOT_JOB_KEY = "daily-market-snapshot";
export const RECOMMENDATION_JOB_KEY = "daily-recommendations-0900";

export function toDateKey(value: Date = new Date()) {
  return value.toISOString().slice(0, 10);
}

function toDateValue(value: Date = new Date()) {
  return new Date(`${toDateKey(value)}T00:00:00.000Z`);
}

export function parseLeadDays(value?: string | null) {
  if (!value) return 7;
  if (/现货|当天|立即/.test(value)) return 0;
  const number = Number(value.match(/\d+/)?.[0] ?? 0);
  if (/周/.test(value)) return Math.max(1, number || 1) * 7;
  if (/月/.test(value)) return Math.max(1, number || 1) * 30;
  return number || 7;
}

export const MARKET_QUOTE_QUANTITY = 1000;

export function resolveQuotePriceAtQuantity(
  priceEx: string | number | null | undefined,
  ladderPrices: LadderTier[] | null | undefined,
  quantity = MARKET_QUOTE_QUANTITY
) {
  const directPrice = Number(priceEx ?? 0);
  const tier = Array.isArray(ladderPrices)
    ? ladderPrices
        .filter(item => Number.isFinite(Number(item.minQty)) && Number.isFinite(Number(item.price)))
        .filter(item => Number(item.minQty) <= quantity && Number(item.price) > 0)
        .sort((a, b) => Number(b.minQty) - Number(a.minQty))[0]
    : undefined;

  return tier
    ? { price: Number(tier.price), source: "ladder" as const, matchedTierMinQty: Number(tier.minQty) }
    : { price: directPrice, source: "direct" as const, matchedTierMinQty: null };
}

export function isValidMarketPrice(value: unknown) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export const DISCOVERY_RECOMMENDATION_REASON = "为你发现 · 优势价格与交期优先";

export function stableDiscoveryScore(userId: number, dateKey: string, inventoryId: number, partNumber: string) {
  const value = stableHash(`${userId}:${dateKey}:${inventoryId}:${partNumber}`);
  return 50 + (10_000 - (value % 10_000)) / 1_000;
}

export const RECOMMENDATION_ALGORITHM_VERSION = "v5-datatong-direct-price-100";
export const RECOMMENDATION_FIRST_PAGE_SIZE = 10;
export const RECOMMENDATION_SNAPSHOT_SIZE = 100;
export const RECOMMENDATION_SUPPLIER_FREE_SLOTS = 2;
export const RECOMMENDATION_REPEAT_SUPPLIER_PENALTY = 8;
export const RECOMMENDATION_PUBLIC_CANDIDATE_LIMIT = 600;
export const RECOMMENDATION_PUBLIC_SUPPLIER_LIMIT = 30;
export const RECOMMENDATION_PUBLIC_ROWS_PER_SUPPLIER = 20;
const RECOMMENDATION_TAX_RATE = 1.13;
const RECOMMENDATION_SUSPICIOUS_PRICE_RATIO = 0.5;
const RECOMMENDATION_MEANINGFUL_ADVANTAGE_PCT = 2;

export function normalizeRecommendationPartNumber(value: string) {
  return value.normalize("NFKC").trim().toUpperCase().replace(/[\s_-]+/g, "");
}

/**
 * 推荐比较价只使用商家填写的直接单价。
 *
 * 阶梯价格目前覆盖率低、数量档口径也不统一；把它混入全站价值排序会让少量深阶梯价
 * 获得不成比例的曝光。阶梯价格仍在商品详情中正常展示，但不参与空搜索和今日推荐评分。
 */
export function resolveRecommendationPrice(
  priceEx: string | number | null | undefined,
  _ladderPrices: LadderTier[] | null | undefined,
): {
  price: number;
  source: "direct" | "ladder";
  matchedTierMinQty: number | null;
} {
  const directPrice = Number(priceEx ?? 0);
  return {
    price: isValidMarketPrice(directPrice) ? directPrice : 0,
    source: "direct" as const,
    matchedTierMinQty: null,
  };
}

export function recommendationComparablePrice(
  priceEx: string | number | null | undefined,
  ladderPrices: LadderTier[] | null | undefined,
  taxIncluded: boolean,
) {
  const resolved = resolveRecommendationPrice(priceEx, ladderPrices);
  if (!isValidMarketPrice(resolved.price)) return null;
  return resolved.price * (taxIncluded ? 1 : RECOMMENDATION_TAX_RATE);
}

export function recommendationFreshnessScore(updatedAt: Date | string, now = new Date()) {
  const ageHours = Math.max(0, (now.getTime() - new Date(updatedAt).getTime()) / 3_600_000);
  if (ageHours <= 24) return 100;
  if (ageHours <= 72) return 85;
  if (ageHours <= 7 * 24) return 65;
  if (ageHours <= 15 * 24) return 40;
  if (ageHours <= 30 * 24) return 20;
  return 0;
}

export type RecommendationRankingCandidate = {
  id: number;
  userId: number;
  partNumber: string;
  priceEx: string | null;
  ladderPrices: LadderTier[] | null;
  taxIncluded: boolean;
  qtyOnSale: number;
  leadTime?: string | null;
  updatedAt: Date;
  certLevel: "pending" | "certified" | "premium" | null;
  relevanceScore: number;
};

export type RankedRecommendationCandidate<T extends RecommendationRankingCandidate = RecommendationRankingCandidate> = T & {
  comparablePrice: number | null;
  priceScore: number;
  priceAdvantagePct: number;
  comparableSupplierCount: number;
  marketReferencePrice: number | null;
  suspiciousPrice: boolean;
  leadTimeScore: number;
  deliveryAdvantage: boolean;
  freshnessScore: number;
  rankingScore: number;
  advantageTier: 0 | 1 | 2;
  priceTier: 0 | 1 | 2;
};

/**
 * V3 排序：优先推荐有独立销售方比价证据的同型号最低价，并剔除明显异常低价。
 * 同型号只保留综合最优报价；不同型号允许同一销售方多条入选。
 * 同一销售方前两条不降权，第三条起轻度降低曝光分；真实价格、交期等优势足够强时仍可继续排在前列。
 * 权重：价格优势 50%、交期 15%、刷新 15%、用户相关性 10%、库存 5%、销售方质量 5%。
 */
export function rankRecommendationCandidates<T extends RecommendationRankingCandidate>(
  candidates: T[],
  now = new Date(),
  limit = 30,
) {
  const pricesByPartAndSupplier = new Map<string, Map<number, number>>();
  const leadDaysByPartAndSupplier = new Map<string, Map<number, number>>();
  const comparableById = new Map<number, number | null>();
  for (const candidate of candidates) {
    const comparable = recommendationComparablePrice(
      candidate.priceEx,
      candidate.ladderPrices,
      candidate.taxIncluded,
    );
    comparableById.set(candidate.id, comparable);
    const key = normalizeRecommendationPartNumber(candidate.partNumber);
    const supplierLeadDays = leadDaysByPartAndSupplier.get(key) ?? new Map<number, number>();
    const leadDays = parseLeadDays(candidate.leadTime);
    supplierLeadDays.set(
      candidate.userId,
      Math.min(supplierLeadDays.get(candidate.userId) ?? Number.POSITIVE_INFINITY, leadDays),
    );
    leadDaysByPartAndSupplier.set(key, supplierLeadDays);
    if (comparable === null) continue;
    const supplierPrices = pricesByPartAndSupplier.get(key) ?? new Map<number, number>();
    supplierPrices.set(
      candidate.userId,
      Math.min(supplierPrices.get(candidate.userId) ?? Number.POSITIVE_INFINITY, comparable),
    );
    pricesByPartAndSupplier.set(key, supplierPrices);
  }

  const priceMarketByPart = new Map<string, {
    medianPrice: number | null;
    trustworthyPrices: number[];
    lowest: { supplierId: number; price: number } | null;
    secondLowest: { supplierId: number; price: number } | null;
  }>();
  pricesByPartAndSupplier.forEach((supplierPrices, partKey) => {
    const sortedPrices = Array.from(supplierPrices.values()).sort((a, b) => a - b);
    const medianPrice = sortedPrices.length
      ? sortedPrices[Math.floor(sortedPrices.length / 2)]
      : null;
    const trustworthyEntries = Array.from(supplierPrices.entries())
      .filter(([, price]) => sortedPrices.length < 3 || medianPrice === null || price >= medianPrice * RECOMMENDATION_SUSPICIOUS_PRICE_RATIO)
      .map(([supplierId, price]) => ({ supplierId, price }))
      .sort((a, b) => a.price - b.price || a.supplierId - b.supplierId);
    priceMarketByPart.set(partKey, {
      medianPrice,
      trustworthyPrices: trustworthyEntries.map(entry => entry.price),
      lowest: trustworthyEntries[0] ?? null,
      secondLowest: trustworthyEntries[1] ?? null,
    });
  });
  const leadMarketByPart = new Map<string, {
    lowest: { supplierId: number; days: number } | null;
    secondLowest: { supplierId: number; days: number } | null;
  }>();
  leadDaysByPartAndSupplier.forEach((supplierLeadDays, partKey) => {
    const sortedLeadDays = Array.from(supplierLeadDays.entries())
      .map(([supplierId, days]) => ({ supplierId, days }))
      .sort((a, b) => a.days - b.days || a.supplierId - b.supplierId);
    leadMarketByPart.set(partKey, {
      lowest: sortedLeadDays[0] ?? null,
      secondLowest: sortedLeadDays[1] ?? null,
    });
  });

  const ranked: Array<RankedRecommendationCandidate<T>> = candidates.map(candidate => {
    const comparablePrice = comparableById.get(candidate.id) ?? null;
    const partKey = normalizeRecommendationPartNumber(candidate.partNumber);
    const priceMarket = priceMarketByPart.get(partKey);
    const medianPrice = priceMarket?.medianPrice ?? null;
    const comparableSupplierCount = priceMarket?.trustworthyPrices.length ?? 0;
    const suspiciousPrice = comparablePrice !== null
      && (pricesByPartAndSupplier.get(partKey)?.size ?? 0) >= 3
      && medianPrice !== null
      && comparablePrice < medianPrice * RECOMMENDATION_SUSPICIOUS_PRICE_RATIO;
    const bestTrustworthyPrice = priceMarket?.lowest?.price ?? null;
    const isBestTrustworthyPrice = comparablePrice !== null
      && !suspiciousPrice
      && bestTrustworthyPrice !== null
      && comparablePrice <= bestTrustworthyPrice * 1.000_001;
    const marketReferencePrice = priceMarket?.lowest?.supplierId === candidate.userId
      ? priceMarket.secondLowest?.price ?? null
      : priceMarket?.lowest?.price ?? null;
    const priceAdvantagePct = isBestTrustworthyPrice && marketReferencePrice !== null
      ? Math.max(0, (marketReferencePrice - comparablePrice) / marketReferencePrice * 100)
      : 0;
    const priceTier: 0 | 1 | 2 = comparablePrice === null
      ? 0
      : isBestTrustworthyPrice && comparableSupplierCount >= 2
        ? 2
        : 1;
    const priceScore = comparablePrice === null
      ? 0
      : priceTier === 2
        ? Math.min(100, 70 + priceAdvantagePct * 3)
        : bestTrustworthyPrice === null
          ? 35
          : Math.min(60, bestTrustworthyPrice / comparablePrice * 60);
    const candidateLeadDays = parseLeadDays(candidate.leadTime);
    const leadMarket = leadMarketByPart.get(partKey);
    const bestOtherLeadDays = leadMarket?.lowest?.supplierId === candidate.userId
      ? leadMarket.secondLowest?.days ?? null
      : leadMarket?.lowest?.days ?? null;
    const deliveryAdvantage = bestOtherLeadDays !== null && candidateLeadDays < bestOtherLeadDays;
    const leadTimeScore = Math.min(100,
      candidateLeadDays <= 0 ? 100
        : candidateLeadDays <= 3 ? 85
          : candidateLeadDays <= 7 ? 65
            : candidateLeadDays <= 15 ? 40
              : 15,
    );
    const freshnessScore = recommendationFreshnessScore(candidate.updatedAt, now);
    const inventoryScore = Math.min(100, Math.log10(Math.max(1, candidate.qtyOnSale) + 1) / 6 * 100);
    const sellerScore = candidate.certLevel === "premium" ? 100 : candidate.certLevel === "certified" ? 80 : candidate.certLevel === "pending" ? 20 : 0;
    const weightedScore = priceScore * 0.5
      + leadTimeScore * 0.15
      + freshnessScore * 0.15
      + Math.min(100, Math.max(0, candidate.relevanceScore)) * 0.1
      + inventoryScore * 0.05
      + sellerScore * 0.05;
    const advantageTier: 0 | 1 | 2 = priceTier === 2 || deliveryAdvantage
      ? 2
      : comparablePrice !== null
        ? 1
        : 0;
    return {
      ...candidate,
      comparablePrice,
      priceScore,
      priceAdvantagePct,
      comparableSupplierCount,
      marketReferencePrice,
      suspiciousPrice,
      leadTimeScore,
      deliveryAdvantage,
      freshnessScore,
      advantageTier,
      priceTier,
      rankingScore: advantageTier * 1000 + weightedScore,
    };
  });

  const selected: Array<RankedRecommendationCandidate<T>> = [];
  const supplierCounts = new Map<number, number>();
  const selectedParts = new Set<string>();
  const available = ranked.filter(candidate => !candidate.suspiciousPrice);
  while (selected.length < limit && available.length > 0) {
    let bestIndex = -1;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < available.length; index += 1) {
      const candidate = available[index];
      const partKey = normalizeRecommendationPartNumber(candidate.partNumber);
      if (selectedParts.has(partKey)) continue;
      const supplierCount = supplierCounts.get(candidate.userId) ?? 0;
      const hasMeasuredAdvantage = candidate.priceTier === 2 || candidate.deliveryAdvantage;
      const penalty = (hasMeasuredAdvantage
        ? 0
        : Math.max(0, supplierCount - RECOMMENDATION_SUPPLIER_FREE_SLOTS + 1))
        * RECOMMENDATION_REPEAT_SUPPLIER_PENALTY;
      const adjustedScore = candidate.rankingScore - penalty;
      const best = bestIndex >= 0 ? available[bestIndex] : null;
      if (
        adjustedScore > bestAdjustedScore
        || (adjustedScore === bestAdjustedScore && best !== null && candidate.priceAdvantagePct > best.priceAdvantagePct)
        || (adjustedScore === bestAdjustedScore && best !== null && candidate.priceAdvantagePct === best.priceAdvantagePct && candidate.freshnessScore > best.freshnessScore)
        || (adjustedScore === bestAdjustedScore && best !== null && candidate.priceAdvantagePct === best.priceAdvantagePct && candidate.freshnessScore === best.freshnessScore && candidate.id < best.id)
      ) {
        bestIndex = index;
        bestAdjustedScore = adjustedScore;
      }
    }
    if (bestIndex < 0) break;
    const [candidate] = available.splice(bestIndex, 1);
    const partKey = normalizeRecommendationPartNumber(candidate.partNumber);
    selected.push(candidate);
    supplierCounts.set(candidate.userId, (supplierCounts.get(candidate.userId) ?? 0) + 1);
    selectedParts.add(partKey);
  }

  return selected;
}

export type RecommendationValueScore = {
  comparablePrice: number;
  referencePrice: number | null;
  advantagePct: number;
  priorityTier: 1 | 2 | 3;
  priceScore: number;
  leadScore: number;
  quantityScore: number;
  freshnessScore: number;
  sellerScore: number;
  valueScore: number;
  suspiciousPrice: boolean;
};

/** 价格吸引力采用封顶分段曲线，避免极低报价无限放大排名。 */
export function recommendationPriceAttractivenessScore(advantagePct: number) {
  const value = Math.max(0, advantagePct);
  if (value <= 5) return value * 5;
  if (value <= 15) return 25 + (value - 5) * 3.5;
  if (value <= 30) return 60 + (value - 15) * 2;
  return Math.min(100, 90 + (value - 30) * 0.5);
}

export function recommendationLeadScore(leadTime?: string | null) {
  const days = parseLeadDays(leadTime);
  return days <= 0 ? 100 : days <= 3 ? 85 : days <= 7 ? 65 : days <= 15 ? 40 : 15;
}

export function recommendationQuantityScore(quantity: number, referenceQuantity = 1) {
  const baseline = Math.max(1, referenceQuantity);
  return Math.min(100, 25 * Math.log2(1 + Math.max(0, quantity) / baseline));
}

export function scoreRecommendationValue(
  candidate: Omit<RecommendationRankingCandidate, "relevanceScore">,
  reference: DictReferencePrice | null,
  peerMedianPrice: number | null,
  peerSupplierCount: number,
  now = new Date(),
): RecommendationValueScore | null {
  const comparablePrice = recommendationComparablePrice(
    candidate.priceEx,
    candidate.ladderPrices,
    candidate.taxIncluded,
  );
  if (comparablePrice === null) return null;
  const referencePrice = reference?.basePrice ?? null;
  const advantagePct = referencePrice && referencePrice > 0
    ? (referencePrice - comparablePrice) / referencePrice * 100
    : 0;
  const suspiciousPrice = (
    referencePrice !== null
    && advantagePct >= 50
    && peerSupplierCount < 2
  ) || (
    peerSupplierCount >= 2
    && peerMedianPrice !== null
    && comparablePrice < peerMedianPrice * RECOMMENDATION_SUSPICIOUS_PRICE_RATIO
  );
  const priorityTier: 1 | 2 | 3 = referencePrice === null
    ? 2
    : advantagePct >= RECOMMENDATION_MEANINGFUL_ADVANTAGE_PCT
      ? 1
      : 3;
  const priceScore = priorityTier === 1
    ? recommendationPriceAttractivenessScore(advantagePct)
    : priorityTier === 3
      ? Math.max(0, Math.min(100, 100 + advantagePct * 2))
      : 0;
  const leadScore = recommendationLeadScore(candidate.leadTime);
  const quantityScore = recommendationQuantityScore(candidate.qtyOnSale, reference?.quantityThreshold ?? 1);
  const freshnessScore = recommendationFreshnessScore(candidate.updatedAt, now);
  const sellerScore = candidate.certLevel === "premium" ? 100 : candidate.certLevel === "certified" ? 80 : 20;
  const valueScore = priorityTier === 1
    ? priceScore * 0.65 + leadScore * 0.15 + quantityScore * 0.1 + freshnessScore * 0.05 + sellerScore * 0.05
    : priorityTier === 2
      ? leadScore * 0.30 + quantityScore * 0.25 + freshnessScore * 0.25 + sellerScore * 0.10
      : priceScore * 0.45 + leadScore * 0.25 + quantityScore * 0.15 + freshnessScore * 0.10 + sellerScore * 0.05;
  return {
    comparablePrice,
    referencePrice,
    advantagePct,
    priorityTier,
    priceScore,
    leadScore,
    quantityScore,
    freshnessScore,
    sellerScore,
    valueScore,
    suspiciousPrice,
  };
}

type ValueRankCandidate = {
  id: number;
  userId: number;
  partNumber: string;
  priorityTier: number;
  valueScore: number;
  advantagePct: number;
  relevanceScore: number;
  freshnessScore: number;
};

/** 严格先比价值层级，再在层内融合 95% 商业价值与 5% 用户相关性。 */
export function rankValueSnapshotCandidates<T extends ValueRankCandidate>(candidates: T[], limit: number) {
  const selected: T[] = [];
  const selectedParts = new Set<string>();
  const supplierCounts = new Map<number, number>();
  const available = [...candidates];
  while (selected.length < limit && available.length > 0) {
    let bestIndex = -1;
    let bestTier = Number.POSITIVE_INFINITY;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < available.length; index += 1) {
      const candidate = available[index];
      const partKey = normalizeRecommendationPartNumber(candidate.partNumber);
      if (selectedParts.has(partKey)) continue;
      const repeats = Math.max(0, (supplierCounts.get(candidate.userId) ?? 0) - RECOMMENDATION_SUPPLIER_FREE_SLOTS + 1);
      const adjustedScore = candidate.valueScore * 0.95
        + Math.min(100, Math.max(0, candidate.relevanceScore)) * 0.05
        - repeats * RECOMMENDATION_REPEAT_SUPPLIER_PENALTY;
      const best = bestIndex >= 0 ? available[bestIndex] : null;
      if (
        candidate.priorityTier < bestTier
        || (candidate.priorityTier === bestTier && adjustedScore > bestScore)
        || (candidate.priorityTier === bestTier && adjustedScore === bestScore && best !== null && candidate.advantagePct > best.advantagePct)
        || (candidate.priorityTier === bestTier && adjustedScore === bestScore && best !== null && candidate.advantagePct === best.advantagePct && candidate.freshnessScore > best.freshnessScore)
        || (candidate.priorityTier === bestTier && adjustedScore === bestScore && best !== null && candidate.advantagePct === best.advantagePct && candidate.freshnessScore === best.freshnessScore && candidate.id < best.id)
      ) {
        bestIndex = index;
        bestTier = candidate.priorityTier;
        bestScore = adjustedScore;
      }
    }
    if (bestIndex < 0) break;
    const [candidate] = available.splice(bestIndex, 1);
    selected.push(candidate);
    selectedParts.add(normalizeRecommendationPartNumber(candidate.partNumber));
    supplierCounts.set(candidate.userId, (supplierCounts.get(candidate.userId) ?? 0) + 1);
  }
  return selected;
}

function logRecommendationFailure(stage: string, error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "unknown")
    : "unknown";
  console.error("[recommendation] operation failed", {
    stage,
    type: error instanceof Error ? error.name : typeof error,
    code,
  });
}

const recommendationRefreshJobs = new Map<number, Promise<number>>();

function triggerRecommendationRefresh(userId: number) {
  if (recommendationRefreshJobs.has(userId)) return;
  // At most one bounded personal snapshot per Web instance, not one per visitor.
  if (recommendationRefreshJobs.size >= 1) return;
  const job = generateRecommendationsForUser(userId)
    .catch(error => {
      logRecommendationFailure("generate-user-recommendations-background", error);
      return 0;
    })
    .finally(() => {
      recommendationRefreshJobs.delete(userId);
    });
  recommendationRefreshJobs.set(userId, job);
}

function recommendationRowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] as T[] : [];
}

async function ensureScheduledJobRows() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(scheduledJobs)
    .values([
      {
        jobKey: MARKET_SNAPSHOT_JOB_KEY,
        cronExpression: "0 30 0 * * *",
      },
      {
        jobKey: RECOMMENDATION_JOB_KEY,
        cronExpression: "0 0 1 * * *",
      },
    ])
    .onDuplicateKeyUpdate({
      set: { cronExpression: sql`VALUES(${scheduledJobs.cronExpression})` },
    });
}

type CurrentAggregate = {
  partNumber: string;
  brand: string;
  category: string;
  pkg: string | null;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  inventoryQty: number;
  avgLeadDays: number;
  supplierCount: number;
  dealCount: number;
  dealQty: number;
};

async function loadCurrentAggregates(): Promise<CurrentAggregate[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const grouped = new Map<
    string,
    {
      partNumber: string;
      brand: string;
      category: string;
      pkg: string | null;
      prices: number[];
      inventoryQty: number;
      leadDays: number[];
      suppliers: Set<number>;
      dealCount: number;
      dealQty: number;
    }
  >();

  let inventoryCursor = 0;
  for (;;) {
  const inventoryRows = await db
    .select({
      id: inventories.id,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      category: inventories.category,
      pkg: inventories.pkg,
      price: inventories.priceEx,
      ladderPrices: inventories.ladderPrices,
      qty: inventories.qtyOnSale,
      userId: inventories.userId,
      leadTime: inventories.leadTime,
    })
    .from(inventories)
    .where(and(
      eq(inventories.status, "published"),
      gt(inventories.id, inventoryCursor),
      companyCatalogVisibleCondition(),
    )).orderBy(asc(inventories.id)).limit(2_000);

    if (!inventoryRows.length) break;
  for (const row of inventoryRows) {
    const resolvedPrice = resolveQuotePriceAtQuantity(row.price, row.ladderPrices).price;
    if (!isValidMarketPrice(resolvedPrice)) continue;
    const key = row.partNumber.toUpperCase();
    const item = grouped.get(key) ?? {
      partNumber: row.partNumber,
      brand: row.brand,
      category: row.category,
      pkg: row.pkg,
      prices: [],
      inventoryQty: 0,
      leadDays: [],
      suppliers: new Set<number>(),
      dealCount: 0,
      dealQty: 0,
    };
    // 零价、负价及无效价格不是有效报价，不进入价格、库存或供应商行情统计。
    if (isValidMarketPrice(resolvedPrice)) {
      item.prices.push(resolvedPrice);
      item.inventoryQty += row.qty;
      item.leadDays.push(parseLeadDays(row.leadTime));
      item.suppliers.add(row.userId);
    }
    grouped.set(key, item);
  }

    inventoryCursor = inventoryRows[inventoryRows.length - 1].id;
  }
  let dealCursor = 0;
  for (;;) {
  const dealRows = await db
    .select({
      id: orderItems.id,
      partNumber: orderItems.partNumber,
      price: orderItems.unitPrice,
      qty: orderItems.qty,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(notInArray(orders.status, ["cancel", "refund"]), gt(orderItems.id, dealCursor)))
    .orderBy(asc(orderItems.id)).limit(2_000);

    if (!dealRows.length) break;
  for (const row of dealRows) {
    const item = grouped.get(row.partNumber.toUpperCase());
    if (!item) continue;
    item.dealCount += 1;
    item.dealQty += row.qty;
  }

    dealCursor = dealRows[dealRows.length - 1].id;
  }
  return Array.from(grouped.values())
    .filter(item => item.prices.length > 0)
    .map(item => ({
    partNumber: item.partNumber,
    brand: item.brand,
    category: item.category,
    pkg: item.pkg,
    avgPrice: item.prices.reduce((sum: number, price: number) => sum + price, 0) / item.prices.length,
    minPrice: Math.min(...item.prices),
    maxPrice: Math.max(...item.prices),
    inventoryQty: item.inventoryQty,
    avgLeadDays: Math.round(item.leadDays.reduce((sum: number, days: number) => sum + days, 0) / item.leadDays.length),
    supplierCount: item.suppliers.size,
    dealCount: item.dealCount,
    dealQty: item.dealQty,
    }));
}

async function writeSnapshots(
  snapshotDate: Date,
  aggregates: CurrentAggregate[],
  priceFactor: (aggregate: CurrentAggregate) => number = () => 1
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = aggregates.map(aggregate => {
    const factor = priceFactor(aggregate);
    return {
      partNumber: aggregate.partNumber,
      brand: aggregate.brand,
      category: aggregate.category,
      pkg: aggregate.pkg,
      snapshotDate,
      avgPrice: (aggregate.avgPrice * factor).toFixed(4),
      minPrice: (aggregate.minPrice * factor * 0.995).toFixed(4),
      maxPrice: (aggregate.maxPrice * factor * 1.005).toFixed(4),
      inventoryQty: aggregate.inventoryQty,
      avgLeadDays: aggregate.avgLeadDays,
      supplierCount: aggregate.supplierCount,
      dealCount: aggregate.dealCount,
      dealQty: aggregate.dealQty,
    };
  });

  for (let index = 0; index < rows.length; index += 200) {
    const batch = rows.slice(index, index + 200);
    if (!batch.length) continue;
    await db
      .insert(marketSnapshots)
      .values(batch)
      .onDuplicateKeyUpdate({
        set: {
          brand: sql`VALUES(${marketSnapshots.brand})`,
          category: sql`VALUES(${marketSnapshots.category})`,
          pkg: sql`VALUES(${marketSnapshots.pkg})`,
          avgPrice: sql`VALUES(${marketSnapshots.avgPrice})`,
          minPrice: sql`VALUES(${marketSnapshots.minPrice})`,
          maxPrice: sql`VALUES(${marketSnapshots.maxPrice})`,
          inventoryQty: sql`VALUES(${marketSnapshots.inventoryQty})`,
          avgLeadDays: sql`VALUES(${marketSnapshots.avgLeadDays})`,
          supplierCount: sql`VALUES(${marketSnapshots.supplierCount})`,
          dealCount: sql`VALUES(${marketSnapshots.dealCount})`,
          dealQty: sql`VALUES(${marketSnapshots.dealQty})`,
          generatedAt: new Date(),
        },
      });
  }
  return rows.length;
}

export async function refreshMarketSnapshots(date = new Date()) {
  await ensureScheduledJobRows();
  const aggregates = await loadCurrentAggregates();
  const count = await writeSnapshots(toDateValue(date), aggregates);
  return { date: toDateKey(date), count };
}

export async function seedTwelveMonthMarketHistory(days = 365) {
  const aggregates = await loadCurrentAggregates();
  const today = new Date();
  let count = 0;
  for (let offset = days; offset >= 1; offset -= 1) {
    const date = new Date(today.getTime() - offset * DAY_MS);
    const dayIndex = Math.floor(date.getTime() / DAY_MS);
    count += await writeSnapshots(toDateValue(date), aggregates, aggregate => {
      const hash = stableHash(aggregate.partNumber);
      const seasonal = Math.sin((dayIndex + hash % 91) / 18) * 0.065;
      const drift = ((days - offset) / days) * 0.035;
      const variation = (((hash + dayIndex * 13) % 17) - 8) / 1000;
      return 1 + seasonal + drift + variation;
    });
  }
  return { days, count };
}

export async function recordSearchEvent(
  userId: number,
  keyword: string,
  match?: { partNumber?: string; brand?: string; category?: string }
) {
  const normalized = keyword.trim().toUpperCase();
  if (!normalized) return;
  const db = await getDb();
  if (!db) return;
  await db.insert(searchEvents).values({
    userId,
    searchType: "part",
    keyword: normalized.slice(0, 128),
    matchedPartNumber: match?.partNumber,
    matchedBrand: match?.brand,
    matchedCategory: match?.category,
  });
}

export async function getSearchHistory(userId: number, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  const safeLimit = Math.min(20, Math.max(1, limit));
  const rows = await db
    .select({
      keyword: searchEvents.keyword,
      searchedAt: searchEvents.searchedAt,
    })
    .from(searchEvents)
    .where(and(eq(searchEvents.userId, userId), eq(searchEvents.searchType, "part")))
    .orderBy(desc(searchEvents.searchedAt))
    .limit(safeLimit * 5);

  const seen = new Set<string>();
  const history: Array<{ keyword: string; searchedAt: Date }> = [];
  for (const row of rows) {
    const keyword = row.keyword.trim().toUpperCase();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    history.push({ keyword, searchedAt: row.searchedAt });
    if (history.length >= safeLimit) break;
  }
  return history;
}

/**
 * 搜索框热门料号：近 30 天搜索热度优先，并且只保留能精确命中在售库存的料号。
 *
 * 以独立搜索用户数为第一排序，并要求至少两个独立账号搜索，避免单一账号重复搜索
 * 放大热度；没有足够搜索样本时，再用真实在售库存量补齐。品牌、系列词和参数词
 * 不会进入结果。
 */
export async function getPopularSearchTerms(limit = 8) {
  const size = Math.min(12, Math.max(1, Math.trunc(limit)));
  return readPublicHotSnapshot()?.terms.slice(0, size) ?? [];
}
/** Scheduled worker only: HTTP handlers never invoke this calculation. */
export async function calculatePopularSearchTerms(limit: number, db: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select">) {
  const safeLimit = Math.min(12, Math.max(1, limit));
  const since = new Date(Date.now() - 30 * DAY_MS);
  const normalizedKeyword = sql<string>`UPPER(TRIM(${searchEvents.keyword}))`;
  const searchCandidates = await db
    .select({
      keyword: normalizedKeyword,
      userCount: sql<number>`COUNT(DISTINCT ${searchEvents.userId})`,
      searchCount: sql<number>`COUNT(*)`,
      lastSearchedAt: sql<Date>`MAX(${searchEvents.searchedAt})`,
    })
    .from(searchEvents)
    .where(and(eq(searchEvents.searchType, "part"), gte(searchEvents.searchedAt, since)))
    .groupBy(normalizedKeyword)
    .orderBy(
      desc(sql`COUNT(DISTINCT ${searchEvents.userId})`),
      desc(sql`COUNT(*)`),
      desc(sql`MAX(${searchEvents.searchedAt})`)
    )
    .limit(safeLimit * 5);

  const eligibleSearchCandidates = searchCandidates.filter(row => Number(row.userCount) >= 2);
  const candidateKeywords = Array.from(
    new Set(eligibleSearchCandidates.map(row => row.keyword?.trim().toUpperCase()).filter(Boolean))
  ) as string[];
  const exactInventoryTerms = new Set<string>();
  if (candidateKeywords.length > 0) {
    const normalizedPartNumber = sql<string>`UPPER(TRIM(${inventories.partNumber}))`;
    const exactRows = await db
      .select({ keyword: normalizedPartNumber })
      .from(inventories)
      .where(
        and(
          eq(inventories.status, "published"),
          gt(inventories.qtyOnSale, 0),
          companyCatalogVisibleCondition(),
          inArray(normalizedPartNumber, candidateKeywords)
        )
      )
      .groupBy(normalizedPartNumber);
    for (const row of exactRows) {
      const keyword = row.keyword?.trim().toUpperCase();
      if (keyword) exactInventoryTerms.add(keyword);
    }
  }
  const searchRows = eligibleSearchCandidates.filter(row => {
    const keyword = row.keyword?.trim().toUpperCase();
    return keyword ? exactInventoryTerms.has(keyword) : false;
  });

  // If search-derived candidates already fill the response, inventory fallback cannot affect output.
  if (searchRows.length >= safeLimit) return searchRows.slice(0, safeLimit).map(row => row.keyword!.trim().toUpperCase());
  const inventoryRows = await db
    .select({
      keyword: inventories.partNumber,
      totalQty: sql<number>`SUM(${inventories.qtyOnSale})`,
      lastPublishedAt: sql<Date>`MAX(${inventories.publishedAt})`,
    })
    .from(inventories)
    .where(and(
      eq(inventories.status, "published"),
      gt(inventories.qtyOnSale, 0),
      companyCatalogVisibleCondition(),
    ))
    .groupBy(inventories.partNumber)
    .orderBy(desc(sql`SUM(${inventories.qtyOnSale})`), desc(sql`MAX(${inventories.publishedAt})`))
    .limit(safeLimit * 2);

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const row of [...searchRows, ...inventoryRows]) {
    const keyword = row.keyword?.trim().toUpperCase();
    if (!keyword || seen.has(keyword)) continue;
    seen.add(keyword);
    terms.push(keyword);
    if (terms.length >= safeLimit) break;
  }
  return terms;
}

export async function deleteSearchHistoryEntry(userId: number, keyword: string) {
  const normalized = keyword.trim().toUpperCase();
  if (!normalized) return;
  const db = await getDb();
  if (!db) return;
  await db
    .delete(searchEvents)
    .where(
      and(
        eq(searchEvents.userId, userId),
        eq(searchEvents.searchType, "part"),
        sql`UPPER(TRIM(${searchEvents.keyword})) = ${normalized}`
      )
    );
}

export async function clearSearchHistory(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(searchEvents).where(and(
    eq(searchEvents.userId, userId),
    eq(searchEvents.searchType, "part"),
  ));
}

/** Only externally approved market aggregates; transaction counts/quantities stay server-side. */
const publicMarketSnapshotFields = {
  partNumber: marketSnapshots.partNumber,
  brand: marketSnapshots.brand,
  category: marketSnapshots.category,
  pkg: marketSnapshots.pkg,
  snapshotDate: marketSnapshots.snapshotDate,
  avgPrice: marketSnapshots.avgPrice,
  minPrice: marketSnapshots.minPrice,
  maxPrice: marketSnapshots.maxPrice,
  inventoryQty: marketSnapshots.inventoryQty,
  avgLeadDays: marketSnapshots.avgLeadDays,
  supplierCount: marketSnapshots.supplierCount,
};

const MARKET_SEARCH_DEFAULT_PAGE_SIZE = 20;
const MARKET_SEARCH_MAX_PAGE_SIZE = 20;
const MARKET_SEARCH_MAX_PAGE = 20;

type MarketSearchOptions = {
  page?: number;
  pageSize?: number;
};

export async function searchMarketModels(
  keyword = "",
  options: MarketSearchOptions = {}
) {
  const normalized = keyword.normalize("NFKC").trim().toLowerCase();
  if (normalized.length < 2 || /[\\%_]/.test(normalized)) return [];
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const today = toDateValue();
  const page = Number.isInteger(options.page)
    ? Math.min(MARKET_SEARCH_MAX_PAGE, Math.max(1, options.page!))
    : 1;
  const pageSize = Number.isInteger(options.pageSize)
    ? Math.min(MARKET_SEARCH_MAX_PAGE_SIZE, Math.max(1, options.pageSize!))
    : MARKET_SEARCH_DEFAULT_PAGE_SIZE;
  const pattern = `%${normalized}%`;
  const keywordCondition = normalized
    ? or(
        sql`LOWER(${marketSnapshots.partNumber}) LIKE ${pattern}`,
        sql`LOWER(${marketSnapshots.brand}) LIKE ${pattern}`,
        sql`LOWER(${marketSnapshots.category}) LIKE ${pattern}`
      )
    : undefined;
  const rows = await db
    .select(publicMarketSnapshotFields)
    .from(marketSnapshots)
    .where(and(eq(marketSnapshots.snapshotDate, today), keywordCondition))
    .orderBy(desc(marketSnapshots.inventoryQty), marketSnapshots.partNumber)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return rows;
}

export async function getMarketDetail(partNumber: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const normalized = normalizeMarketPartNumber(partNumber);
  const packagingGroup = resolveMarketPackagingGroup(normalized);
  const lookupKeys = marketPackagingLookupKeys(normalized);
  // 近7天窗口：含今天在内的最近7个自然日快照（cutoff = 6天前的当日0点）
  const cutoff = new Date(Date.now() - 6 * DAY_MS);
  cutoff.setHours(0, 0, 0, 0);
  const history = await db
    .select(publicMarketSnapshotFields)
    .from(marketSnapshots)
    .where(
      and(
        inArray(marketSnapshots.partNumber, lookupKeys),
        gte(marketSnapshots.snapshotDate, toDateValue(cutoff))
      )
    )
    .orderBy(marketSnapshots.snapshotDate);
  // Empty history is a valid read result; only background jobs generate snapshots.
  const supplierRows = await db
    .select({
      inventoryId: inventories.id,
      inventoryStatus: inventories.status,
      supplierId: inventories.userId,
      /* 供应商名统一口径：早期只取 companies.companyName，未填企业资料的卖家在
         数据通供应商报价里会直接显示兜底文案，看不到具体是谁。 */
      supplierName: supplierDisplayNameSql,
      supplierAddress: companies.regAddress,
      certLevel: companies.certLevel,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      category: inventories.category,
      pkg: inventories.pkg,
      dateCode: inventories.dateCode,
      prodYear: inventories.prodYear,
      warehouseAddress: inventories.warehouseAddress,
      qtyOnSale: inventories.qtyOnSale,
      priceEx: inventories.priceEx,
      taxIncluded: inventories.taxIncluded,
      ladderPrices: inventories.ladderPrices,
      leadTime: inventories.leadTime,
      source: inventories.source,
      grade: inventories.grade,
      invoice: inventories.invoice,
      rohs: inventories.rohs,
      updatedAt: inventories.updatedAt,
    })
    .from(inventories)
    .leftJoin(companies, eq(inventories.userId, companies.userId))
    .leftJoin(users, eq(users.id, inventories.userId))
    .where(
      and(
        sql`(${inventories.status} = 'published' OR (${inventories.status} = 'offshelf' AND ${inventories.companyCatalogVisible} = 1))`,
        inArray(inventories.partNumberNormalized, lookupKeys)
      )
    )
    .orderBy(desc(inventories.updatedAt));

  const forumQuoteRows = await db
    .select({
      quoteId: forumSupplierQuotes.id,
      messageId: forumSupplierQuotes.messageId,
      supplierId: forumSupplierQuotes.senderUserId,
      supplierName: enterprises.companyName,
      partNumber: forumSupplierQuotes.partNumber,
      dateCode: forumSupplierQuotes.dateCode,
      quoteQuantity: forumSupplierQuotes.quantity,
      quotePrice: forumSupplierQuotes.price,
      taxStatus: forumSupplierQuotes.taxStatus,
      leadTime: forumSupplierQuotes.leadTime,
      updatedAt: forumSupplierQuotes.quotedAt,
    })
    .from(forumSupplierQuotes)
    .innerJoin(forumMessages, eq(forumMessages.id, forumSupplierQuotes.messageId))
    .innerJoin(enterprises, eq(enterprises.id, forumSupplierQuotes.enterpriseId))
    .innerJoin(users, eq(users.id, forumSupplierQuotes.senderUserId))
    .innerJoin(enterpriseMembers, and(
      eq(enterpriseMembers.userId, forumSupplierQuotes.senderUserId),
      eq(enterpriseMembers.enterpriseId, forumSupplierQuotes.enterpriseId),
      eq(enterpriseMembers.status, "active"),
    ))
    .where(and(
      eq(forumSupplierQuotes.isActive, true),
      inArray(forumSupplierQuotes.partNumberNormalized, lookupKeys),
      eq(forumMessages.isHidden, false),
      sql`${forumMessages.deletedAt} IS NULL`,
      eq(users.loginDisabled, false),
    ))
    .orderBy(desc(forumSupplierQuotes.quotedAt), desc(forumSupplierQuotes.id));

  const inventoryQuotes = supplierRows.flatMap(row => {
    if (packagingGroup && (!isMarketPackagingBrandCompatible(row.partNumber, row.brand) || !isMarketPackagingPackageCompatible(row.partNumber, row.pkg))) return [];
    const quoteQuantity = Number(row.qtyOnSale);
    if (!Number.isInteger(quoteQuantity) || quoteQuantity <= 0) return [];
    const resolved = resolveQuotePriceAtQuantity(row.priceEx, row.ladderPrices, quoteQuantity);
    if (!isValidMarketPrice(resolved.price)) return [];
    const publicRow = redactMarketInventoryLocation(row);
    return [{
      ...publicRow,
      quoteKey: `inventory:${row.inventoryId}`,
      packaging: marketPackagingLabel(row.partNumber),
      quoteKind: row.inventoryStatus === "published" ? "inventory" as const : "record" as const,
      supplierName: row.supplierName ?? SUPPLIER_NAME_FALLBACK,
      quoteQuantity,
      quotePrice: resolved.price.toFixed(4),
      taxStatus: row.taxIncluded ? "included" as const : "excluded" as const,
      priceSource: resolved.source,
      matchedTierMinQty: resolved.matchedTierMinQty,
    }];
  });

  const forumQuotes = forumQuoteRows.flatMap(row => {
    if (!isValidMarketPrice(row.quotePrice)) return [];
    return [{
      quoteKey: `forum:${row.quoteId}`,
      packaging: marketPackagingLabel(row.partNumber),
      quoteKind: "forum" as const,
      inventoryId: null,
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      inventoryLocation: null,
      inventoryLocationSource: "none" as const,
      partNumber: row.partNumber,
      brand: "",
      category: "",
      pkg: null,
      dateCode: row.dateCode,
      prodYear: null,
      qtyOnSale: row.quoteQuantity,
      quoteQuantity: row.quoteQuantity,
      quotePrice: Number(row.quotePrice).toFixed(4),
      taxIncluded: row.taxStatus === "unspecified" ? null : row.taxStatus === "included",
      taxStatus: row.taxStatus,
      leadTime: row.leadTime,
      source: null,
      grade: null,
      invoice: false,
      rohs: false,
      updatedAt: row.updatedAt,
      priceSource: "direct" as const,
      matchedTierMinQty: null,
      messageId: row.messageId,
    }];
  });

  const seenQuoteKeys = new Set<string>();
  const supplierQuotes = [...inventoryQuotes, ...forumQuotes]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .filter(row => {
      if (!packagingGroup) return true;
      if (seenQuoteKeys.has(row.quoteKey)) return false;
      seenQuoteKeys.add(row.quoteKey);
      return true;
    });

  const historyByPackaging = lookupKeys.map(key => {
    const points = history.filter(row => normalizeMarketPartNumber(row.partNumber) === key && (!packagingGroup || (isMarketPackagingBrandCompatible(row.partNumber, row.brand) && isMarketPackagingPackageCompatible(row.partNumber, row.pkg))));
    return { partNumber: key, packaging: marketPackagingLabel(key), history: points, latest: points.at(-1) ?? null };
  });
  // Shared legacy fields expose the same real records for any verified packaging input.
  // Packaging-specific history above is retained verbatim; no point is relabelled as TR.
  const seenHistoryKeys = new Set<string>();
  const sharedHistory = packagingGroup ? historyByPackaging.flatMap(row => row.history)
    .sort((left, right) => new Date(left.snapshotDate).getTime() - new Date(right.snapshotDate).getTime()
      || normalizeMarketPartNumber(left.partNumber).localeCompare(normalizeMarketPartNumber(right.partNumber)))
    .filter(row => {
      const key = `${normalizeMarketPartNumber(row.partNumber)}:${new Date(row.snapshotDate).getTime()}`;
      if (seenHistoryKeys.has(key)) return false;
      seenHistoryKeys.add(key);
      return true;
    }) : historyByPackaging.find(row => row.partNumber === normalized)?.history ?? [];
  return {
    packagingGroup,
    latest: sharedHistory.at(-1) ?? null,
    history: sharedHistory,
    historyByPackaging,
    supplierQuotes,
  };
}

type Candidate = {
  id: number;
  userId: number;
  partNumber: string;
  brand: string;
  category: string;
  pkg: string | null;
  grade: string | null;
  priceEx: string | null;
  ladderPrices: LadderTier[] | null;
  taxIncluded: boolean;
  qtyOnSale: number;
  leadTime: string | null;
  updatedAt: Date;
  certLevel: "pending" | "certified" | "premium" | null;
};

// Global value recomputation lives exclusively in recommendationValueBatch.ts.
// HTTP and daily recommendation handlers read the last committed scores only.

async function loadRecommendationValueCandidates(limit = 5000) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.select({
    id: inventories.id,
    userId: inventories.userId,
    partNumber: inventories.partNumber,
    brand: inventories.brand,
    category: inventories.category,
    pkg: inventories.pkg,
    grade: inventories.grade,
    priceEx: inventories.priceEx,
    ladderPrices: inventories.ladderPrices,
    taxIncluded: inventories.taxIncluded,
    qtyOnSale: inventories.qtyOnSale,
    leadTime: inventories.leadTime,
    updatedAt: inventories.updatedAt,
    certLevel: companies.certLevel,
    priorityTier: recommendationInventoryScores.priorityTier,
    valueScore: recommendationInventoryScores.valueScore,
    advantagePct: recommendationInventoryScores.advantagePct,
    freshnessScore: recommendationInventoryScores.freshnessScore,
  })
    .from(recommendationInventoryScores)
    .innerJoin(inventories, eq(recommendationInventoryScores.inventoryId, inventories.id))
    .leftJoin(companies, eq(inventories.userId, companies.userId))
    .where(and(
      eq(recommendationInventoryScores.suspiciousPrice, false),
      eq(inventories.status, "published"),
      gt(inventories.qtyOnSale, 0),
      companyCatalogVisibleCondition(),
    ))
    .orderBy(
      asc(recommendationInventoryScores.priorityTier),
      desc(recommendationInventoryScores.valueScore),
      desc(recommendationInventoryScores.inventoryId),
    )
    .limit(limit);
}

let personalRecommendationJob: { userId: number; job: Promise<number> } | null = null;
const personalRecommendationRecent = new Map<number, { at: number; count: number }>();

/** All manual and background callers share one per-Web-instance bounded slot. */
export async function generateRecommendationsForUser(userId: number, date = new Date()) {
  if (personalRecommendationJob) {
    return personalRecommendationJob.userId === userId ? personalRecommendationJob.job : 0;
  }
  const recent = personalRecommendationRecent.get(userId);
  if (recent && Date.now() - recent.at < 30_000) return recent.count;
  const job = calculateRecommendationsForUser(userId, date).then(count => {
    personalRecommendationRecent.set(userId, { at: Date.now(), count });
    if (personalRecommendationRecent.size > 100) personalRecommendationRecent.delete(personalRecommendationRecent.keys().next().value!);
    return count;
  }).finally(() => { personalRecommendationJob = null; });
  personalRecommendationJob = { userId, job };
  return job;
}

async function calculateRecommendationsForUser(userId: number, date = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const candidates = await loadRecommendationValueCandidates();
  if (!candidates.length) return 0;
  const purchases = await db
    .select({
      inventoryId: orderItems.inventoryId,
      partNumber: orderItems.partNumber,
      brand: orderItems.brand,
      qty: orderItems.qty,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(and(eq(orders.buyerId, userId), notInArray(orders.status, ["cancel", "refund"])))
    .orderBy(desc(orderItems.id)).limit(2_000);
  const recentSearches = await db
    .select({ keyword: searchEvents.keyword, searchedAt: searchEvents.searchedAt })
    .from(searchEvents)
    .where(and(
      eq(searchEvents.userId, userId),
      eq(searchEvents.searchType, "part"),
      gte(searchEvents.searchedAt, new Date(Date.now() - 180 * DAY_MS)),
    ))
    .orderBy(desc(searchEvents.searchedAt)).limit(200);

  const purchasedParts = new Map<string, number>();
  const purchasedBrands = new Map<string, number>();
  const purchasedCategories = new Map<string, number>();
  const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));
  for (const purchase of purchases) {
    const part = normalizeRecommendationPartNumber(purchase.partNumber);
    purchasedParts.set(part, (purchasedParts.get(part) ?? 0) + purchase.qty);
    purchasedBrands.set(purchase.brand.toLowerCase(), (purchasedBrands.get(purchase.brand.toLowerCase()) ?? 0) + 1);
    const category = candidateById.get(purchase.inventoryId)?.category;
    if (category) purchasedCategories.set(category, (purchasedCategories.get(category) ?? 0) + 1);
  }

  const searchSignals = recentSearches.map(event => {
    const keyword = event.keyword.trim().toLowerCase();
    const ageDays = Math.max(0, Math.floor((date.getTime() - new Date(event.searchedAt).getTime()) / DAY_MS));
    return { keyword, weight: Math.max(2, 14 - Math.floor(ageDays / 15)) };
  }).filter(signal => signal.keyword.length > 0);
  const hasBehaviorSignals = purchases.length > 0 || searchSignals.length > 0;
  const discoveryDateKey = toDateKey(date);
  const scoredCandidates = candidates.map(candidate => {
      let relevanceScore = hasBehaviorSignals
        ? 5
        : stableDiscoveryScore(userId, discoveryDateKey, candidate.id, candidate.partNumber);
      const reasons: string[] = [];
      if (hasBehaviorSignals) {
        const purchasedQty = purchasedParts.get(normalizeRecommendationPartNumber(candidate.partNumber)) ?? 0;
        if (purchasedQty > 0) {
          relevanceScore += 60 + Math.min(15, Math.log10(Math.max(10, purchasedQty)) * 5);
          reasons.push(`采购过该型号 · ${purchasedQty.toLocaleString()}片`);
        }
        const brandWeight = purchasedBrands.get(candidate.brand.toLowerCase()) ?? 0;
        if (brandWeight) {
          relevanceScore += Math.min(20, brandWeight * 7);
          reasons.push(`偏好品牌 ${candidate.brand}`);
        }
        const categoryWeight = purchasedCategories.get(candidate.category) ?? 0;
        if (categoryWeight) {
          relevanceScore += Math.min(10, categoryWeight * 4);
          reasons.push(`常购品类 ${candidate.category}`);
        }
        const matchedSearches = searchSignals.filter(signal =>
          candidate.partNumber.toLowerCase().includes(signal.keyword) ||
          candidate.brand.toLowerCase().includes(signal.keyword) ||
          candidate.category.toLowerCase().includes(signal.keyword)
        );
        if (matchedSearches.length) {
          relevanceScore += Math.min(40, matchedSearches.reduce((sum, signal) => sum + signal.weight, 0));
          reasons.push(`匹配最近搜索“${matchedSearches[0].keyword}”`);
        }
        if (parseLeadDays(candidate.leadTime) <= 3) relevanceScore += 5;
      }
      const valueReason = Number(candidate.priorityTier) === 1
        ? `低于数据通参考价 ${Math.max(0, Math.round(Number(candidate.advantagePct)))}%`
        : Number(candidate.priorityTier) === 2
          ? "数据通暂无参考价，平台已有明价"
          : "平台公开明价";
      return {
        ...candidate,
        valueScore: Number(candidate.valueScore),
        advantagePct: Number(candidate.advantagePct),
        freshnessScore: Number(candidate.freshnessScore),
        relevanceScore: Math.min(100, relevanceScore),
        reason: `${RECOMMENDATION_ALGORITHM_VERSION}:${[valueReason, ...reasons].slice(0, 2).join("，")}`,
      };
    });
  const ranked = rankValueSnapshotCandidates(scoredCandidates, RECOMMENDATION_SNAPSHOT_SIZE);

  const recommendationDate = toDateKey(date);
  await db.delete(dailyRecommendations).where(
    and(eq(dailyRecommendations.userId, userId), eq(dailyRecommendations.recommendationDate, recommendationDate))
  );
  if (ranked.length) {
    await db
      .insert(dailyRecommendations)
      .values(
        ranked.map((item, index) => ({
          userId,
          inventoryId: item.id,
          recommendationDate,
          // 查询层按 score DESC 读取；用位置分数固化已完成的明价分层与首屏去重顺序。
          score: (10_000 - index).toFixed(3),
          reason: item.reason,
        }))
      )
      .onDuplicateKeyUpdate({
        set: {
          score: sql`VALUES(${dailyRecommendations.score})`,
          reason: sql`VALUES(${dailyRecommendations.reason})`,
          generatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
  }
  return ranked.length;
}

export async function refreshDailyRecommendations(date = new Date()) {
  await ensureScheduledJobRows();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const userRows = await db.select({ id: users.id }).from(users);
  let count = 0;
  for (const user of userRows) count += await generateRecommendationsForUser(user.id, date);
  return { date: toDateKey(date), users: userRows.length, count };
}

export type RecommendationFilters = {
  category?: string;
  brand?: string;
  leadTime?: "spot" | "3d" | "7d" | "15d";
  favoriteOnly?: boolean;
  limit?: number;
};

function leadTimeMatches(value: string | null, filter?: RecommendationFilters["leadTime"]) {
  if (!filter) return true;
  const days = parseLeadDays(value);
  const limit = filter === "spot" ? 0 : filter === "3d" ? 3 : filter === "7d" ? 7 : 15;
  return days <= limit;
}

export async function getTodayRecommendations(userId: number | null, filters: RecommendationFilters = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const recommendationDate = toDateKey();
  let refreshPending = false;

  if (userId) {
    const existing = await db
      .select({
        id: dailyRecommendations.id,
        reason: dailyRecommendations.reason,
        generatedAt: dailyRecommendations.generatedAt,
      })
      .from(dailyRecommendations)
      .where(and(eq(dailyRecommendations.userId, userId), eq(dailyRecommendations.recommendationDate, recommendationDate)))
      .limit(1);
    const [scoreState] = await db.select({ lastCompletedAt: recommendationScoreState.lastCompletedAt })
      .from(recommendationScoreState)
      .where(eq(recommendationScoreState.id, 1))
      .limit(1);
    const snapshotIsOlderThanValueScores = Boolean(
      existing[0]?.generatedAt
      && scoreState?.lastCompletedAt
      && new Date(existing[0].generatedAt).getTime() < new Date(scoreState.lastCompletedAt).getTime(),
    );
    if (!existing.length || !existing[0].reason.startsWith(`${RECOMMENDATION_ALGORITHM_VERSION}:`) || snapshotIsOlderThanValueScores) {
      triggerRecommendationRefresh(userId);
      refreshPending = true;
    }
  }

  const loadPublicRows = async () => {
    const valueRows = await db.select({
      id: inventories.id,
      supplierId: inventories.userId,
      partNumber: inventories.partNumber,
      brand: inventories.brand,
      category: inventories.category,
      pkg: inventories.pkg,
      grade: inventories.grade,
      priceEx: inventories.priceEx,
      ladderPrices: inventories.ladderPrices,
      taxIncluded: inventories.taxIncluded,
      qtyOnSale: inventories.qtyOnSale,
      leadTime: inventories.leadTime,
      updatedAt: inventories.updatedAt,
      certLevel: companies.certLevel,
      photos: inventories.photos,
      supplierName: supplierDisplayNameSql,
      priorityTier: recommendationInventoryScores.priorityTier,
      valueScore: recommendationInventoryScores.valueScore,
      advantagePct: recommendationInventoryScores.advantagePct,
      freshnessScore: recommendationInventoryScores.freshnessScore,
      generatedAt: recommendationInventoryScores.computedAt,
    })
      .from(recommendationInventoryScores)
      .innerJoin(inventories, eq(recommendationInventoryScores.inventoryId, inventories.id))
      .leftJoin(companies, eq(inventories.userId, companies.userId))
      .leftJoin(users, eq(users.id, inventories.userId))
      .where(and(
        eq(recommendationInventoryScores.suspiciousPrice, false),
        eq(inventories.status, "published"),
        gt(inventories.qtyOnSale, 0),
        companyCatalogVisibleCondition(),
      ))
      .orderBy(
        asc(recommendationInventoryScores.priorityTier),
        desc(recommendationInventoryScores.valueScore),
      )
      .limit(RECOMMENDATION_PUBLIC_CANDIDATE_LIMIT);
    if (valueRows.length) {
      return rankValueSnapshotCandidates(valueRows.map(row => ({
        ...row,
        userId: row.supplierId,
        priorityTier: Number(row.priorityTier),
        valueScore: Number(row.valueScore),
        advantagePct: Number(row.advantagePct),
        freshnessScore: Number(row.freshnessScore),
        relevanceScore: 50,
      })), RECOMMENDATION_SNAPSHOT_SIZE).map((row, index) => ({
        ...row,
        score: String(10_000 - index),
        reason: `${RECOMMENDATION_ALGORITHM_VERSION}:${row.priorityTier === 1
          ? `低于数据通参考价 ${Math.max(0, Math.round(row.advantagePct))}%`
          : row.priorityTier === 2
            ? "数据通暂无参考价，平台已有明价"
            : "平台公开明价"}`,
      }));
    }
    const balancedIds = recommendationRowsOf<{ id: number }>(await db.execute(sql`
      WITH recent_suppliers AS (
        SELECT userId, MAX(updatedAt) AS latestUpdatedAt
          FROM inventories
         WHERE status = 'published'
           AND qtyOnSale > 0
           AND companyCatalogVisible = 1
         GROUP BY userId
         ORDER BY latestUpdatedAt DESC, userId ASC
         LIMIT ${RECOMMENDATION_PUBLIC_SUPPLIER_LIMIT}
      ), ranked_supplier_inventory AS (
        SELECT inventory_pool.id,
               inventory_pool.userId,
               inventory_pool.updatedAt,
               CASE
                 WHEN CAST(COALESCE(inventory_pool.priceEx, '0') AS DECIMAL(20, 6)) > 0
                 THEN 1 ELSE 0
               END AS hasPrice,
               ROW_NUMBER() OVER (
                 PARTITION BY inventory_pool.userId
                 ORDER BY
                   CASE
                     WHEN CAST(COALESCE(inventory_pool.priceEx, '0') AS DECIMAL(20, 6)) > 0
                     THEN 0 ELSE 1
                   END ASC,
                   inventory_pool.updatedAt DESC,
                   inventory_pool.qtyOnSale DESC,
                   inventory_pool.id DESC
               ) AS supplierRow
          FROM inventories AS inventory_pool
          INNER JOIN recent_suppliers
                  ON recent_suppliers.userId = inventory_pool.userId
         WHERE inventory_pool.status = 'published'
           AND inventory_pool.qtyOnSale > 0
           AND inventory_pool.companyCatalogVisible = 1
      )
      SELECT id
        FROM ranked_supplier_inventory
       WHERE supplierRow <= ${RECOMMENDATION_PUBLIC_ROWS_PER_SUPPLIER}
       ORDER BY supplierRow ASC, hasPrice DESC, updatedAt DESC, id DESC
       LIMIT ${RECOMMENDATION_PUBLIC_CANDIDATE_LIMIT}
    `));
    const candidateIds = balancedIds.map(item => Number(item.id)).filter(Number.isSafeInteger);
    if (!candidateIds.length) return [];
    return db
      .select({
        id: inventories.id,
        supplierId: inventories.userId,
        partNumber: inventories.partNumber,
        brand: inventories.brand,
        category: inventories.category,
        pkg: inventories.pkg,
        grade: inventories.grade,
        priceEx: inventories.priceEx,
        ladderPrices: inventories.ladderPrices,
        taxIncluded: inventories.taxIncluded,
        qtyOnSale: inventories.qtyOnSale,
        leadTime: inventories.leadTime,
        updatedAt: inventories.updatedAt,
        certLevel: companies.certLevel,
        photos: inventories.photos,
        supplierName: supplierDisplayNameSql,
        score: sql<string>`0`,
        reason: sql<string>`${DISCOVERY_RECOMMENDATION_REASON}`,
        generatedAt: inventories.updatedAt,
      })
      .from(inventories)
      .leftJoin(companies, eq(inventories.userId, companies.userId))
      .leftJoin(users, eq(users.id, inventories.userId))
      .where(and(
        inArray(inventories.id, candidateIds),
        eq(inventories.status, "published"),
        gt(inventories.qtyOnSale, 0),
        companyCatalogVisibleCondition(),
      ))
      .orderBy(desc(inventories.updatedAt), desc(inventories.qtyOnSale));
  };

  let baseRows = userId
    ? await db
        .select({
          id: inventories.id,
          supplierId: inventories.userId,
          partNumber: inventories.partNumber,
          brand: inventories.brand,
          category: inventories.category,
          pkg: inventories.pkg,
          grade: inventories.grade,
          priceEx: inventories.priceEx,
          ladderPrices: inventories.ladderPrices,
          taxIncluded: inventories.taxIncluded,
          qtyOnSale: inventories.qtyOnSale,
          leadTime: inventories.leadTime,
          updatedAt: inventories.updatedAt,
          certLevel: companies.certLevel,
          photos: inventories.photos,
          supplierName: supplierDisplayNameSql,
          score: dailyRecommendations.score,
          reason: dailyRecommendations.reason,
          generatedAt: inventories.updatedAt,
        })
        .from(dailyRecommendations)
        .innerJoin(inventories, eq(dailyRecommendations.inventoryId, inventories.id))
        .leftJoin(companies, eq(inventories.userId, companies.userId))
        .leftJoin(users, eq(users.id, inventories.userId))
        .where(
          and(
            eq(dailyRecommendations.userId, userId),
            eq(dailyRecommendations.recommendationDate, recommendationDate),
            eq(inventories.status, "published"),
            gt(inventories.qtyOnSale, 0),
            companyCatalogVisibleCondition(),
          )
        )
        .orderBy(desc(dailyRecommendations.score))
    : await loadPublicRows();

  if (!baseRows.length) baseRows = await loadPublicRows();

  if (baseRows.every(item => !item.reason.startsWith(`${RECOMMENDATION_ALGORITHM_VERSION}:`))) {
    baseRows = rankRecommendationCandidates(
      baseRows.map(item => ({ ...item, userId: item.supplierId, relevanceScore: 50 })),
      new Date(),
      baseRows.length,
    );
  }

  const favorites = userId
    ? await db
        .select({ inventoryId: recommendationFavorites.inventoryId })
        .from(recommendationFavorites)
        .where(eq(recommendationFavorites.userId, userId))
    : [];
  const favoriteIds = new Set(favorites.map(item => item.inventoryId));
  const filtered = baseRows
    .map(item => {
      const resolvedPrice = resolveRecommendationPrice(item.priceEx, item.ladderPrices);
      return {
        ...item,
        priceEx: isValidMarketPrice(resolvedPrice.price) ? resolvedPrice.price.toFixed(4) : null,
        priceSource: isValidMarketPrice(resolvedPrice.price) ? resolvedPrice.source : null,
        matchedTierMinQty: isValidMarketPrice(resolvedPrice.price) ? resolvedPrice.matchedTierMinQty : null,
        reason: item.reason.startsWith(`${RECOMMENDATION_ALGORITHM_VERSION}:`)
          ? item.reason.slice(RECOMMENDATION_ALGORITHM_VERSION.length + 1)
          : item.reason,
        supplierName: item.supplierName ?? SUPPLIER_NAME_FALLBACK,
        favorite: favoriteIds.has(item.id),
      };
    })
    .filter(item => !filters.category || item.category === filters.category)
    .filter(item => !filters.brand || item.brand === filters.brand)
    .filter(item => leadTimeMatches(item.leadTime, filters.leadTime))
    .filter(item => !filters.favoriteOnly || item.favorite)
    .slice(0, filters.limit ?? 50);

  const discoveryReasons = new Set<string>([
    DISCOVERY_RECOMMENDATION_REASON,
    "库存充足且近期活跃",
    "热门现货",
  ]);
  const mode = userId && filtered.length > 0 && filtered.every(item => discoveryReasons.has(item.reason))
    ? "discovery"
    : "personalized";

  return {
    date: recommendationDate,
    updatedAt: filtered[0]?.generatedAt ?? null,
    algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
    refreshPending,
    mode,
    items: filtered.map(item => mode === "discovery" ? { ...item, reason: DISCOVERY_RECOMMENDATION_REASON } : item),
    categories: Array.from(new Set(baseRows.map(item => item.category))),
    brands: Array.from(new Set(baseRows.map(item => item.brand))),
  };
}

export async function toggleRecommendationFavorite(userId: number, inventoryId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await db
    .select({ id: recommendationFavorites.id })
    .from(recommendationFavorites)
    .where(and(eq(recommendationFavorites.userId, userId), eq(recommendationFavorites.inventoryId, inventoryId)))
    .limit(1);
  if (existing.length) {
    await db.delete(recommendationFavorites).where(eq(recommendationFavorites.id, existing[0].id));
    return { favorite: false };
  }
  await db.insert(recommendationFavorites).values({ userId, inventoryId });
  return { favorite: true };
}

export async function updateScheduledJobResult(taskUid: string, status: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(scheduledJobs)
    .set({ lastRunAt: new Date(), lastStatus: status })
    .where(eq(scheduledJobs.scheduleCronTaskUid, taskUid));
}
