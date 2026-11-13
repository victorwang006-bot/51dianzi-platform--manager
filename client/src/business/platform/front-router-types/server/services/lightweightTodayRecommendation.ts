import { performance } from "node:perf_hooks";
import { sql, type SQL } from "drizzle-orm";
import { parseReferencePrice } from "../../../shared/referencePriceRange";
import { toTaxIncludedComparisonPrice } from "./searchRanking";

/** No connection creation, global state, writes, private preferences or marketRecommendation import. */
export const LIGHTWEIGHT_TODAY_ALGORITHM_VERSION = "lightweight-today-v2-price70-event20-supply10-enterprise10";
/** Maximum SQL page size, NOT a global candidate bound. */
export const LIGHTWEIGHT_TODAY_CANDIDATE_LIMIT = 600;
/** Legacy request default, NOT a public pool bound. Retained for import compatibility. */
export const LIGHTWEIGHT_TODAY_POOL_SIZE = 100;
export const LIGHTWEIGHT_TODAY_ENTERPRISE_LIMIT = 10;
export const LIGHTWEIGHT_TODAY_FORUM_ADVANTAGE_PCT = 5;
const HOUR_MS = 3_600_000;
const BUDGET_MS = 3000;
const REFERENCE_KEY_PAGE_SIZE = 500;

/** Drizzle DB/transaction execute(sql), or an adapter returning rows / [rows, fields]. */
export type LightweightTodayExecute = (query: SQL) => Promise<unknown>;
export type LightweightTodayExecutor = { execute: LightweightTodayExecute };
export type LightweightTodayReferenceSource = {
  /** Defaults to the inventory executor, preserving a same-connection cross-schema transaction. */
  executor?: LightweightTodayExecutor;
  /** Validated SQL identifier. Production front connection can SELECT dianzi51_admin tables. */
  schema?: string;
  /** Defaults to the existing recommendationValueBatch CNY/tax-included reference contract. */
  currency?: "CNY";
  taxIncluded?: boolean;
  termsEvidence?: string;
};
export type LightweightTodayInput = {
  now?: Date;
  /** Legacy positive integer accepted but ignored: display chunking belongs to the caller. */
  limit?: number;
  /** SQL page size (1..600); does not truncate the qualifying public pool. */
  candidateLimit?: number;
  /** False disables price evidence. Invalid explicitly supplied terms never produce price advantage. */
  reference?: LightweightTodayReferenceSource | false;
  /** Informational: this module always SELECTs only. Transaction ownership remains with the caller. */
  mode?: "preview" | "transaction";
};
export type LightweightTodayCandidate = {
  id: number;
  userId: number;
  enterpriseId: number | null;
  partNumber: string;
  brand: string;
  category: string;
  pkg: string | null;
  qtyOnSale: number;
  priceEx: string | null;
  taxIncluded: boolean;
  ladderPrices: unknown;
  moq: number | null;
  spq: number | null;
  leadTime: string | null;
  publishedAt: Date | string | null;
  refreshedAt: Date | string | null;
};
export type LightweightTodayReference = {
  partNumber: string;
  basePrice: number;
  quantityThreshold: number;
  batchId: number;
  taxIncluded: boolean;
  brand?: string | null;
  /** Validated original decimal source, retained by the reader for exact threshold decisions. */
  basePriceDecimal?: string;
};
export type LightweightTodayRow = LightweightTodayCandidate & {
  eventAt: Date;
  freshnessWindowHours: 24 | 48;
  priceBatchId: number | null;
  /** Actual active catalog batch timestamp, never generatedAt. Present on reader-produced rows. */
  referenceActivatedAt?: Date | null;
  comparisonQuantity: number | null;
  /** Both prices are CNY per unit including 13% VAT. Original seller price is unchanged. */
  comparablePrice: number | null;
  /** Actual seller tier price at comparisonQuantity, in the seller's ORIGINAL tax basis.
   * API/forum should display this alongside comparisonQuantity, never substitute a deep ladder priceEx.
   */
  sellerPriceAtComparisonQuantity: number | null;
  referencePrice: number | null;
  referenceMatchedBy: "exact" | null;
  priceReferenceStatus: "reliable" | "missing" | "quantity_not_comparable" | "price_invalid";
  advantagePct: number;
  priceAdvantagePct: number;
  hasPriceAdvantage: boolean;
  /** Commercial qualification only; authorization, public field validation and forum safety are caller-owned. */
  forumEligible: boolean;
  suspiciousPrice: boolean;
  priceScore: number;
  freshnessScore: number;
  leadScore: number;
  quantityScore: number;
  supplyScore: number;
  valueScore: number;
  rankingScore: number;
  priorityTier: 1 | 2 | 3;
  relevanceScore: 0;
};
export type LightweightTodayResult = {
  rows: LightweightTodayRow[];
  generatedAt: Date;
  algorithmVersion: string;
  status: "ready" | "partial" | "empty" | "degraded";
  mode: "preview" | "transaction";
  windowHours: 24 | 48;
  priceBatchId: number | null;
  referenceActivatedAt?: Date | null;
  referenceStatus: "ready" | "not_configured" | "no_active_batch" | "unavailable" | "changed";
  diagnostics: {
    candidateCount: number;
    recentCandidateCount: number;
    extendedCandidateCount: number;
    invalidCandidateCount: number;
    suspiciousCandidateCount: number;
    reliableReferenceCount: number;
    forumEligibleCount: number;
    /** Selected supplier identities; real enterpriseId wins, otherwise a namespaced userId. */
    enterpriseCount: number;
    maxEnterpriseRows: number;
    /** Reliable >=5% and <50% rows before model+brand deduplication / supplier quota. */
    qualifiedCount: number;
    /** Success requires the entire 48h keyset to be read and the active batch revalidated. */
    complete: boolean;
    /** Legacy global-cap diagnostics: always false with full keyset pagination. */
    candidateLimitReached: boolean;
    expansionBlockedByCandidateLimit: boolean;
    queryCount: number;
    elapsedMs: number;
  };
};

type RawCandidate = Omit<LightweightTodayCandidate, "id" | "userId" | "enterpriseId" | "qtyOnSale" | "priceEx" | "taxIncluded" | "moq" | "spq"> & {
  id: number | string;
  userId: number | string;
  enterpriseId: number | string | null;
  qtyOnSale: number | string;
  priceEx: string | number | null;
  taxIncluded: boolean | number | string;
  moq: number | string | null;
  spq: number | string | null;
  status: string;
  companyCatalogVisible: boolean | number | string;
};
type RawReference = {
  partNumberKey: string;
  priceValue: string | number | null;
  quantityThresholdValue: number | string | null;
  brandRaw?: string | null;
};
type ActiveBatch = { id: number | string; activatedAt: Date | string | null };

function sourceError(code: string) {
  return Object.assign(new Error(code), { code });
}
function boundedInteger(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw sourceError("LIGHTWEIGHT_TODAY_OPTIONS_INVALID");
  return value;
}
function rowsOf<T>(result: unknown): T[] {
  if (!Array.isArray(result)) throw sourceError("LIGHTWEIGHT_TODAY_QUERY_RESULT_INVALID");
  return (Array.isArray(result[0]) ? result[0] : result) as T[];
}
/** Preserve ALL orderable suffixes and separators: no family/packaging/compact/alias price borrowing. */
export function normalizeLightweightTodayPartNumber(value: string) {
  return value.normalize("NFKC").trim().toUpperCase();
}
/** Same existing catalog convention: discard parenthetical descriptions, not real brand identifiers. */
export function normalizeLightweightTodayBrand(value: string | null | undefined) {
  return String(value ?? "").normalize("NFKC").split(/[（(]/, 1)[0].trim().toUpperCase();
}
/** MySQL naive datetime values follow the project's +08:00 connection convention, not host TZ. */
function instant(value: Date | string | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" || !value.trim()) return NaN;
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/i.test(value) ? value : value.replace(" ", "T") + "+08:00");
}
export function lightweightTodayEventAt(candidate: Pick<LightweightTodayCandidate, "publishedAt" | "refreshedAt">, now: Date): Date | null {
  const times = [candidate.publishedAt, candidate.refreshedAt].filter(value => value !== null && value !== undefined).map(instant);
  if (!times.length || times.some(time => !Number.isFinite(time) || time > now.getTime())) return null;
  return new Date(Math.max(...times));
}
function strictPrice(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  // Existing parser intentionally accepts ranges/prefixes; price advantage must not.
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  return parseReferencePrice(value);
}
type ExactDecimal = { coefficient: bigint; scale: number };
function decimalPower(scale: number): bigint {
  // Constructors, not bigint literals/exponentiation: this project has an ES5 TS target.
  return BigInt("1" + "0".repeat(scale));
}
function exactDecimal(value: string | number): ExactDecimal {
  // Callers have already validated positive prices. Numeric toString may use scientific notation.
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value).trim())!;
  const fraction = match[2] ?? "";
  const scale = fraction.length - Number(match[3] ?? 0);
  const coefficient = BigInt(match[1] + fraction);
  return scale < 0 ? { coefficient: coefficient * decimalPower(-scale), scale: 0 } : { coefficient, scale };
}
function exactPriceAdvantage(reference: LightweightTodayReference, sellerSource: string | number, sellerTaxIncluded: boolean) {
  const referenceSource = reference.basePriceDecimal !== undefined
    && strictPrice(reference.basePriceDecimal) === reference.basePrice ? reference.basePriceDecimal : reference.basePrice;
  const ref = exactDecimal(referenceSource), seller = exactDecimal(sellerSource);
  const scale = Math.max(ref.scale, seller.scale);
  // Both prices share a /100 denominator: multiply included prices by 100, excluded by 113.
  const refUnits = ref.coefficient * decimalPower(scale - ref.scale) * BigInt(reference.taxIncluded ? 100 : 113);
  const sellerUnits = seller.coefficient * decimalPower(scale - seller.scale) * BigInt(sellerTaxIncluded ? 100 : 113);
  const difference = refUnits - sellerUnits;
  const percentNumerator = difference * BigInt(100);
  // Truncate only the explanatory/sorting number, never the qualification comparisons.
  const pctUnits = percentNumerator * decimalPower(12) / refUnits;
  return {
    advantagePct: Number(pctUnits.toString() + "e-12"),
    positive: difference > BigInt(0),
    forumThresholdMet: percentNumerator >= refUnits * BigInt(LIGHTWEIGHT_TODAY_FORUM_ADVANTAGE_PCT),
    suspicious: percentNumerator >= refUnits * BigInt(50),
  };
}
function positiveInteger(value: unknown, fallback?: number): number | null {
  if (value === null || value === undefined) return fallback ?? null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function booleanValue(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}
function decodeCandidate(raw: RawCandidate, now: Date): LightweightTodayCandidate | null {
  const id = positiveInteger(raw.id), userId = positiveInteger(raw.userId), quantity = positiveInteger(raw.qtyOnSale);
  const taxIncluded = booleanValue(raw.taxIncluded);
  if (id === null || userId === null || quantity === null || taxIncluded === null
    || raw.status !== "published" || booleanValue(raw.companyCatalogVisible) !== true
    || typeof raw.partNumber !== "string" || !normalizeLightweightTodayPartNumber(raw.partNumber)
    || raw.partNumber.length > 128 || !lightweightTodayEventAt(raw, now)) return null;
  return {
    id, userId, enterpriseId: positiveInteger(raw.enterpriseId), partNumber: raw.partNumber,
    brand: typeof raw.brand === "string" ? raw.brand : "", category: typeof raw.category === "string" ? raw.category : "",
    pkg: raw.pkg ?? null, qtyOnSale: quantity, priceEx: raw.priceEx === null || raw.priceEx === undefined ? null : String(raw.priceEx), taxIncluded,
    ladderPrices: raw.ladderPrices ?? null, moq: raw.moq === null ? null : Number(raw.moq),
    spq: raw.spq === null ? null : Number(raw.spq), leadTime: raw.leadTime ?? null,
    publishedAt: raw.publishedAt ?? null, refreshedAt: raw.refreshedAt ?? null,
  };
}

/** At the EXACT reference quantity, respect MOQ, SPQ, availability and the active ladder tier.
 * A one-piece reference is not evidence for a 100-piece-only seller offer. Malformed ladders fail closed.
 */
function sellerPriceEvidenceAtQuantity(candidate: LightweightTodayCandidate, quantity: number): { price: number; source: string | number } | null {
  const moq = positiveInteger(candidate.moq, 1), spq = positiveInteger(candidate.spq, 1);
  if (moq === null || spq === null || !Number.isSafeInteger(quantity) || quantity < moq
    || quantity > candidate.qtyOnSale || quantity % spq !== 0) return null;
  let ladder: unknown = candidate.ladderPrices;
  if (typeof ladder === "string") {
    if (ladder.length > 20_000) return null;
    try { ladder = JSON.parse(ladder); } catch { return null; }
  }
  if (ladder !== null && ladder !== undefined && !Array.isArray(ladder)) return null;
  if (Array.isArray(ladder) && ladder.length) {
    if (ladder.length > 50) return null;
    const seen = new Set<number>();
    for (const item of ladder) {
      if (!item || typeof item !== "object") return null;
      const tier = item as Record<string, unknown>;
      const minQty = positiveInteger(tier.minQty ?? tier.qty);
      if (minQty === null || strictPrice(tier.price) === null || seen.has(minQty)) return null;
      if (tier.maxQty !== undefined && (!Number.isSafeInteger(Number(tier.maxQty)) || Number(tier.maxQty) <= minQty)) return null;
      seen.add(minQty);
    }
    const applicable = [...ladder].sort((a, b) => Number(b.minQty ?? b.qty) - Number(a.minQty ?? a.qty))
      .find(tier => Number(tier.minQty ?? tier.qty) <= quantity);
    if (!applicable || (applicable.maxQty !== undefined && quantity >= Number(applicable.maxQty))) return null;
    return { price: strictPrice(applicable.price)!, source: applicable.price as string | number };
  }
  const price = strictPrice(candidate.priceEx);
  return price === null ? null : { price, source: candidate.priceEx! };
}
export function lightweightTodaySellerPriceAtQuantity(candidate: LightweightTodayCandidate, quantity: number): number | null {
  return sellerPriceEvidenceAtQuantity(candidate, quantity)?.price ?? null;
}
export function lightweightTodayPriceAtQuantity(candidate: LightweightTodayCandidate, quantity: number): number | null {
  return toTaxIncludedComparisonPrice(lightweightTodaySellerPriceAtQuantity(candidate, quantity), candidate.taxIncluded);
}
/** Conservative lead scoring: unknown/marketing text is not treated as seven-day or spot stock. */
function leadScore(value: string | null): number {
  const text = String(value ?? "").trim();
  if (/^(?:现货|当天|当日)(?:可?发货|交货|到货)?$|^(?:in\s*stock|spot|same day|ready to ship)$/i.test(text)) return 100;
  const duration = /^(?:(?:预计|大约|约)\s*|(?:approx\.?|approximately|estimated|ships? in)\s+)?(\d+(?:\.\d+)?)(?:\s*[-–—~～至到]\s*(\d+(?:\.\d+)?))?\s*(个?工作日|天|日|小时|周|个月|月|days?|weeks?|hours?|months?)(?:\s*(?:内|左右|可?发货|交货|到货|交付))?$/i.exec(text);
  if (!duration) return 0;
  const lower = Number(duration[1]), upper = Number(duration[2] ?? duration[1]);
  if (lower <= 0 || upper < lower || upper > 17520) return 0;
  const days = upper * (/月|month/i.test(duration[3]) ? 30 : /周|week/i.test(duration[3]) ? 7 : /小时|hour/i.test(duration[3]) ? 1 / 24 : 1);
  return days <= 1 ? 95 : days <= 3 ? 85 : days <= 7 ? 65 : days <= 15 ? 40 : 15;
}
/** Capped monotone attraction curve; zero/missing evidence receives zero price score. */
function priceScore(advantagePct: number): number {
  const value = Math.max(0, advantagePct);
  if (value <= 5) return value * 5;
  if (value <= 15) return 25 + (value - 5) * 3.5;
  if (value <= 30) return 60 + (value - 15) * 2;
  return Math.min(100, 90 + (value - 30) * 0.5);
}
export function scoreLightweightTodayCandidate(candidate: LightweightTodayCandidate, reference: LightweightTodayReference | null, now: Date): LightweightTodayRow | null {
  const eventAt = lightweightTodayEventAt(candidate, now);
  if (!eventAt || now.getTime() - eventAt.getTime() > 48 * HOUR_MS) return null;
  const referenceBrand = normalizeLightweightTodayBrand(reference?.brand), sellerBrand = normalizeLightweightTodayBrand(candidate.brand);
  const exactReference = reference && normalizeLightweightTodayPartNumber(reference.partNumber) === normalizeLightweightTodayPartNumber(candidate.partNumber)
    && referenceBrand && sellerBrand && referenceBrand === sellerBrand
    && strictPrice(reference.basePrice) !== null && positiveInteger(reference.quantityThreshold) !== null
    && positiveInteger(reference.batchId) !== null && typeof reference.taxIncluded === "boolean" ? reference : null;
  const comparisonQuantity = exactReference?.quantityThreshold ?? null;
  const sellerEvidence = comparisonQuantity === null ? null : sellerPriceEvidenceAtQuantity(candidate, comparisonQuantity);
  const sellerPriceAtComparisonQuantity = sellerEvidence?.price ?? null;
  const quotedPrice = toTaxIncludedComparisonPrice(sellerPriceAtComparisonQuantity, candidate.taxIncluded);
  const taxReferencePrice = exactReference ? toTaxIncludedComparisonPrice(exactReference.basePrice, exactReference.taxIncluded) : null;
  const referencePrice = quotedPrice === null ? null : taxReferencePrice;
  const advantage = referencePrice !== null && exactReference && sellerEvidence
    ? exactPriceAdvantage(exactReference, sellerEvidence.source, candidate.taxIncluded) : null;
  const advantagePct = advantage?.advantagePct ?? 0;
  // No broad peer/full-table scan is needed. Extreme uncorroborated discounts are never promoted.
  const suspiciousPrice = advantage?.suspicious ?? false;
  const hasPriceAdvantage = Boolean(advantage?.positive) && !suspiciousPrice;
  const freshnessWindowHours = now.getTime() - eventAt.getTime() <= 24 * HOUR_MS ? 24 : 48;
  const freshnessScore = Math.max(0, 100 - (now.getTime() - eventAt.getTime()) / (48 * HOUR_MS) * 100);
  const scoredPrice = suspiciousPrice ? 0 : priceScore(advantagePct);
  const scoredLead = leadScore(candidate.leadTime);
  const quantityScore = Math.min(100, Math.log2(1 + candidate.qtyOnSale / Math.max(1, comparisonQuantity ?? 1)) * 25);
  const supplyScore = (scoredLead + quantityScore) / 2;
  const valueScore = scoredPrice * 0.7 + freshnessScore * 0.2 + supplyScore * 0.1;
  return {
    ...candidate, eventAt, freshnessWindowHours, priceBatchId: exactReference?.batchId ?? null,
    comparisonQuantity, comparablePrice: quotedPrice, referencePrice,
    sellerPriceAtComparisonQuantity,
    referenceMatchedBy: referencePrice === null ? null : "exact",
    priceReferenceStatus: !exactReference ? "missing" : quotedPrice !== null ? "reliable"
      : (positiveInteger(candidate.moq, 1) === null || positiveInteger(candidate.spq, 1) === null
        || comparisonQuantity! < (candidate.moq ?? 1) || comparisonQuantity! > candidate.qtyOnSale
        || comparisonQuantity! % (candidate.spq ?? 1) !== 0) ? "quantity_not_comparable" : "price_invalid",
    advantagePct, priceAdvantagePct: advantagePct, hasPriceAdvantage,
    forumEligible: hasPriceAdvantage && Boolean(advantage?.forumThresholdMet),
    suspiciousPrice, priceScore: scoredPrice, freshnessScore, leadScore: scoredLead, quantityScore, supplyScore,
    valueScore, rankingScore: valueScore, priorityTier: hasPriceAdvantage ? 1 : referencePrice === null ? 2 : 3, relevanceScore: 0,
  };
}
function enterpriseKey(row: Pick<LightweightTodayCandidate, "enterpriseId" | "userId">): string {
  return row.enterpriseId === null ? `user:${row.userId}` : `enterprise:${row.enterpriseId}`;
}
function qualified(row: LightweightTodayRow): boolean {
  return row.priceReferenceStatus === "reliable" && row.referenceMatchedBy === "exact"
    && row.hasPriceAdvantage && row.forumEligible && !row.suspiciousPrice
    && Number.isFinite(row.advantagePct) && row.advantagePct >= LIGHTWEIGHT_TODAY_FORUM_ADVANTAGE_PCT
    && row.advantagePct < 50;
}
function compareValue(a: LightweightTodayRow, b: LightweightTodayRow): number {
  // The 24/48 label is explanatory only; it must not override economic value.
  return b.valueScore - a.valueScore || b.advantagePct - a.advantagePct
    || b.eventAt.getTime() - a.eventAt.getTime() || a.id - b.id;
}
export function rankLightweightTodayCandidates(rows: LightweightTodayRow[], limit = LIGHTWEIGHT_TODAY_POOL_SIZE): LightweightTodayRow[] {
  boundedInteger(limit, LIGHTWEIGHT_TODAY_POOL_SIZE, Number.MAX_SAFE_INTEGER); // legacy argument, deliberately no slice
  const sorted = rows.filter(qualified).slice().sort(compareValue);
  const seen = new Set<string>(), groups = new Map<string, LightweightTodayRow[]>();
  for (const row of sorted) {
    const supplier = enterpriseKey(row);
    const group = groups.get(supplier) ?? [];
    // Do not mark a model as seen when this enterprise cannot take it: another may supply it.
    if (group.length >= LIGHTWEIGHT_TODAY_ENTERPRISE_LIMIT) continue;
    const part = normalizeLightweightTodayPartNumber(row.partNumber);
    const key = JSON.stringify([part, normalizeLightweightTodayBrand(row.brand)]);
    if (!part || seen.has(key)) continue;
    group.push(row); groups.set(supplier, group); seen.add(key);
  }
  // Map insertion order is the deterministic value order of each group's highest selected offer.
  const selected: LightweightTodayRow[] = [];
  const orderedGroups = Array.from(groups.values());
  for (let round = 0; round < LIGHTWEIGHT_TODAY_ENTERPRISE_LIMIT; round++)
    for (const group of orderedGroups) if (group[round]) selected.push(group[round]);
  return selected;
}

type CandidateQueryPage = {
  afterId?: number;
  batchId?: number;
  schema?: string;
  maxExecutionTimeMs?: number;
};
/** Both sargable event branches cover the WHOLE requested window (48h in the reader).
 * Price prefilters precede UNION; indexed exact-key scalar probes precede the page LIMIT.
 * ID keysets drain all pages. SQL collation is only a prefilter: JS exact/brand/duplicate checks remain mandatory.
 * Correlated scalar LIMIT 1 avoids EXISTS-to-semijoin catalog materialization; forced
 * (batchId, partNumberKey) probes inspect only event keys. No branch top-N or global scan.
 */
export function lightweightTodayCandidateQuery(now: Date, window: 24 | 48, limit: number, page: CandidateQueryPage = {}): SQL {
  boundedInteger(limit, LIGHTWEIGHT_TODAY_CANDIDATE_LIMIT, LIGHTWEIGHT_TODAY_CANDIDATE_LIMIT);
  const afterId = page.afterId ?? 0, schema = page.schema ?? "dianzi51_admin";
  const timeout = boundedInteger(page.maxExecutionTimeMs, 1000, 1000);
  if (!Number.isFinite(now.getTime()) || (window !== 24 && window !== 48)
    || !Number.isSafeInteger(afterId) || afterId < 0 || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(schema)
    || (page.batchId !== undefined && positiveInteger(page.batchId) === null))
    throw sourceError("LIGHTWEIGHT_TODAY_OPTIONS_INVALID");
  const lower = new Date(now.getTime() - window * HOUR_MS);
  // Reachable positive ladder prices are allowed; strict validation is still in JS.
  const sellingPrice = sql`AND (i.priceEx > 0 OR (i.ladderPrices IS NOT NULL AND JSON_TYPE(i.ladderPrices) = 'ARRAY' AND EXISTS (
    SELECT 1 FROM JSON_TABLE(
      IF(JSON_TYPE(i.ladderPrices) = 'ARRAY', i.ladderPrices, JSON_ARRAY()), '$[*]' COLUMNS (
        minQty BIGINT PATH '$.minQty' NULL ON EMPTY NULL ON ERROR,
        legacyQty BIGINT PATH '$.qty' NULL ON EMPTY NULL ON ERROR,
        tierPrice DECIMAL(20,6) PATH '$.price' NULL ON EMPTY NULL ON ERROR
      )
    ) AS selling_tiers
    WHERE selling_tiers.tierPrice > 0 AND COALESCE(selling_tiers.minQty, selling_tiers.legacyQty) > 0
      AND COALESCE(selling_tiers.minQty, selling_tiers.legacyQty) <= i.qtyOnSale
  )))`;
  const batchPredicate = page.batchId === undefined ? sql`r.batchId = (
    SELECT id FROM ${sql.identifier(schema)}.${sql.identifier("external_catalog_batches")}
    WHERE status = 'active' ORDER BY activatedAt DESC, id DESC LIMIT 1
  )` : sql`r.batchId = ${page.batchId}`;
  return sql`/* lt:today-candidates-${sql.raw(String(window))}h */
    SELECT /*+ MAX_EXECUTION_TIME(${sql.raw(String(timeout))}) */ i.id, i.userId, i.enterpriseId, i.partNumber, i.brand, i.category, i.pkg,
      i.qtyOnSale, i.priceEx, i.taxIncluded, i.ladderPrices, i.moq, i.spq, i.leadTime,
      i.publishedAt, i.refreshedAt, i.status, i.companyCatalogVisible
    FROM (
      SELECT id FROM inventories i FORCE INDEX (inventories_public_browse_idx)
        WHERE status = 'published' AND companyCatalogVisible = 1 AND qtyOnSale > 0
          AND refreshedAt >= ${lower} AND refreshedAt <= ${now} AND id > ${afterId}
          ${sellingPrice}
      UNION
      SELECT id FROM inventories i FORCE INDEX (inventories_public_published_idx)
        WHERE status = 'published' AND companyCatalogVisible = 1 AND qtyOnSale > 0
          AND publishedAt >= ${lower} AND publishedAt <= ${now} AND id > ${afterId}
          ${sellingPrice}
    ) event_candidates
    STRAIGHT_JOIN inventories i ON i.id = event_candidates.id
    WHERE i.status = 'published' AND i.companyCatalogVisible = 1 AND i.qtyOnSale > 0
      AND (
        SELECT r.id FROM ${sql.identifier(schema)}.${sql.identifier("external_catalog_entries")} r
          FORCE INDEX (external_catalog_entries_batch_part_idx)
        WHERE ${batchPredicate} AND r.partNumberKey = UPPER(TRIM(i.partNumber)) LIMIT 1
      ) IS NOT NULL
      AND i.id > ${afterId}
    ORDER BY i.id ASC LIMIT ${limit}`;
}

/** SELECT-only shared source. Preview is observation, not a publication lock or authorization proof.
 * Transaction callers choose isolation and pin/revalidate live facts before publication themselves.
 * A separate catalog adapter cannot be made atomically consistent with the inventory transaction;
 * a final active-batch read detects observed changes, but cannot promise absence of concurrent drift.
 * REQUIRED deployment index: inventories_public_published_idx(status, companyCatalogVisible, publishedAt, id, qtyOnSale).
 * REQUIRED catalog index: external_catalog_entries_batch_part_idx(batchId, partNumberKey).
 * FORCE INDEX fails closed if missing; no two-million-row publication scan fallback is permitted.
 */
export async function readLightweightTodayRecommendations(executor: LightweightTodayExecutor, input: LightweightTodayInput = {}): Promise<LightweightTodayResult> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime()) || ![undefined, "preview", "transaction"].includes(input.mode))
    throw sourceError("LIGHTWEIGHT_TODAY_OPTIONS_INVALID");
  boundedInteger(input.limit, LIGHTWEIGHT_TODAY_POOL_SIZE, Number.MAX_SAFE_INTEGER);
  const pageSize = boundedInteger(input.candidateLimit, LIGHTWEIGHT_TODAY_CANDIDATE_LIMIT, LIGHTWEIGHT_TODAY_CANDIDATE_LIMIT);
  const started = performance.now(), deadline = started + BUDGET_MS;
  let queryCount = 0;
  const checkBudget = () => {
    if (performance.now() >= deadline) throw sourceError("LIGHTWEIGHT_TODAY_BUDGET_EXCEEDED");
  };
  const timeoutMs = (maximum: number) => {
    checkBudget(); return Math.max(1, Math.min(maximum, Math.floor(deadline - performance.now())));
  };
  const execute = async <T>(runner: LightweightTodayExecute, query: SQL): Promise<T[]> => {
    checkBudget(); queryCount++;
    // No Promise.race / detached query: callers must never commit while reads remain in flight.
    const rows = rowsOf<T>(await runner(query));
    checkBudget(); return rows;
  };
  let priceBatchId: number | null = null;
  let referenceActivatedAt: Date | null = null;
  let batch: ActiveBatch | undefined;
  const config = input.reference === false ? null : input.reference ?? {};
  const source = config === null ? null : {
    execute: (query: SQL) => (config.executor ?? executor).execute(query),
    schema: config.schema ?? "dianzi51_admin",
    currency: config.currency ?? "CNY",
    taxIncluded: config.taxIncluded ?? true,
    termsEvidence: config.termsEvidence ?? "existing recommendationValueBatch CNY tax-included reference contract",
  };
  if (source && !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(source.schema))
    throw sourceError("LIGHTWEIGHT_TODAY_OPTIONS_INVALID");
  const termsVerified = source && source.currency === "CNY" && typeof source.taxIncluded === "boolean"
    && typeof source.termsEvidence === "string" && Boolean(source.termsEvidence.trim());
  let referenceStatus: LightweightTodayResult["referenceStatus"] = termsVerified ? "ready" : "not_configured";
  const references = new Map<string, LightweightTodayReference>();
  const checkedReferenceKeys = new Set<string>();
  const activeBatchQuery = () => sql`/* lt:today-reference-batch */ SELECT /*+ MAX_EXECUTION_TIME(${sql.raw(String(timeoutMs(500)))}) */ id, activatedAt
    FROM ${sql.identifier(source?.schema ?? "dianzi51_admin")}.${sql.identifier("external_catalog_batches")}
    WHERE status = 'active' ORDER BY activatedAt DESC, id DESC LIMIT 1`;
  if (termsVerified && source) {
    // Reference failures propagate. No supply-only pool may masquerade as a complete exact-value pool.
    const batchRows = await execute<ActiveBatch>(source.execute, activeBatchQuery());
    if (batchRows.length > 1) throw sourceError("LIGHTWEIGHT_TODAY_REFERENCE_BOUND_EXCEEDED");
    batch = batchRows[0];
    if (batch && (positiveInteger(batch.id) === null || !Number.isFinite(instant(batch.activatedAt))
      || instant(batch.activatedAt) > now.getTime())) throw sourceError("LIGHTWEIGHT_TODAY_REFERENCE_BATCH_INVALID");
    priceBatchId = positiveInteger(batch?.id);
    referenceActivatedAt = batch ? new Date(instant(batch.activatedAt)) : null;
    if (!batch) referenceStatus = "no_active_batch";
  }
  const loadReferences = async (pageCandidates: LightweightTodayCandidate[]) => {
    if (referenceStatus !== "ready" || !priceBatchId || !source) return;
    const keys = Array.from(new Set(pageCandidates.map(row => normalizeLightweightTodayPartNumber(row.partNumber))))
      .filter(key => !checkedReferenceKeys.has(key));
    for (let start = 0; start < keys.length; start += REFERENCE_KEY_PAGE_SIZE) {
      const page = keys.slice(start, start + REFERENCE_KEY_PAGE_SIZE), pageKeys = new Set(page);
      // Exact key quantity/brand evidence only. Excessive duplicates throw instead of truncating.
      const raw = await execute<RawReference>(source.execute, sql`/* lt:today-reference-exact */
        SELECT /*+ MAX_EXECUTION_TIME(${sql.raw(String(timeoutMs(600)))}) */ partNumberKey, priceValue, quantityThresholdValue, brandRaw
        FROM ${sql.identifier(source.schema)}.${sql.identifier("external_catalog_entries")}
          FORCE INDEX (external_catalog_entries_batch_part_idx) WHERE batchId = ${priceBatchId}
          AND partNumberKey IN (${sql.join(page.map(key => sql`${key}`), sql`,`)}) LIMIT ${page.length * 2 + 1}`);
      if (raw.length > page.length * 2) throw sourceError("LIGHTWEIGHT_TODAY_REFERENCE_BOUND_EXCEEDED");
      const groups = new Map<string, RawReference[]>();
      for (const row of raw) {
        const key = normalizeLightweightTodayPartNumber(String(row.partNumberKey ?? ""));
        if (!pageKeys.has(key)) continue; // DB collation equivalence is not exact identity.
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      for (const key of page) {
        checkedReferenceKeys.add(key);
        const hits = groups.get(key) ?? [];
        const price = hits.length === 1 ? strictPrice(hits[0].priceValue) : null;
        const quantity = hits.length === 1 ? positiveInteger(hits[0].quantityThresholdValue, 1) : null;
        if (price !== null && quantity !== null) references.set(key, {
          partNumber: key, basePrice: price, quantityThreshold: quantity, batchId: priceBatchId, taxIncluded: source.taxIncluded,
          brand: hits[0].brandRaw ?? null,
          basePriceDecimal: typeof hits[0].priceValue === "string" ? hits[0].priceValue : undefined,
        });
      }
      checkBudget();
    }
  };
  let candidateCount = 0, recentCandidateCount = 0, extendedCandidateCount = 0, invalidCandidateCount = 0;
  let suspiciousCandidateCount = 0, reliableReferenceCount = 0;
  const qualifyingRows: LightweightTodayRow[] = [];
  if (referenceStatus === "ready" && priceBatchId && source) {
    let afterId = 0;
    for (;;) {
      const raw = await execute<RawCandidate>(query => executor.execute(query), lightweightTodayCandidateQuery(now, 48, pageSize,
        { afterId, batchId: priceBatchId, schema: source.schema, maxExecutionTimeMs: timeoutMs(1000) }));
      if (raw.length > pageSize) throw sourceError("LIGHTWEIGHT_TODAY_CANDIDATE_BOUND_EXCEEDED");
      candidateCount += raw.length;
      const candidates: LightweightTodayCandidate[] = [];
      for (const row of raw) {
        const id = positiveInteger(row.id);
        if (id === null || id <= afterId) throw sourceError("LIGHTWEIGHT_TODAY_CANDIDATE_PAGE_INVALID");
        afterId = id; // Advance even when commercial/public fact validation rejects the row.
        const candidate = decodeCandidate(row, now);
        const event = candidate && lightweightTodayEventAt(candidate, now);
        const age = event ? now.getTime() - event.getTime() : NaN;
        if (!candidate || !Number.isFinite(age) || age > 48 * HOUR_MS) { invalidCandidateCount++; continue; }
        if (age <= 24 * HOUR_MS) recentCandidateCount++; else extendedCandidateCount++;
        candidates.push(candidate);
      }
      await loadReferences(candidates);
      for (const candidate of candidates) {
        const row = scoreLightweightTodayCandidate(candidate, references.get(normalizeLightweightTodayPartNumber(candidate.partNumber)) ?? null, now);
        if (!row) continue;
        if (row.suspiciousPrice) suspiciousCandidateCount++;
        if (row.priceReferenceStatus === "reliable") reliableReferenceCount++;
        if (qualified(row)) qualifyingRows.push({ ...row, referenceActivatedAt });
      }
      checkBudget();
      if (raw.length < pageSize) break; // A full page is NOT proof of completion: read the next one.
    }
  }
  if (referenceStatus === "ready" && source && batch) {
    const current = await execute<ActiveBatch>(source.execute, activeBatchQuery());
    if (current.length !== 1 || Number(current[0].id) !== priceBatchId || instant(current[0].activatedAt) !== instant(batch.activatedAt))
      throw sourceError("LIGHTWEIGHT_TODAY_REFERENCE_CHANGED");
  }
  checkBudget();
  const rows = rankLightweightTodayCandidates(qualifyingRows);
  const enterpriseRows = new Map<string, number>();
  let maxEnterpriseRows = 0;
  for (const row of rows) {
    const key = enterpriseKey(row), count = (enterpriseRows.get(key) ?? 0) + 1;
    enterpriseRows.set(key, count); maxEnterpriseRows = Math.max(maxEnterpriseRows, count);
  }
  checkBudget();
  return {
    rows, generatedAt: new Date(now), algorithmVersion: LIGHTWEIGHT_TODAY_ALGORITHM_VERSION,
    status: rows.length ? "ready" : "empty",
    mode: input.mode ?? "preview", windowHours: 48, priceBatchId, referenceActivatedAt, referenceStatus,
    diagnostics: {
      candidateCount, recentCandidateCount, extendedCandidateCount, invalidCandidateCount,
      suspiciousCandidateCount, reliableReferenceCount,
      forumEligibleCount: rows.filter(row => row.forumEligible).length,
      enterpriseCount: enterpriseRows.size, maxEnterpriseRows,
      qualifiedCount: qualifyingRows.length, complete: true,
      candidateLimitReached: false, expansionBlockedByCandidateLimit: false,
      queryCount, elapsedMs: Math.round(performance.now() - started),
    },
  };
}
