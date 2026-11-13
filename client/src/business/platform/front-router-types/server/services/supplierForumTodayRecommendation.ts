import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { sql, type SQL } from "drizzle-orm";
import { maskForbiddenWords } from "../../../shared/contentModeration";
import { SUPPLIER_FORUM_CURRENT_ALLOWLIST } from "./supplierForumRecommendationAllowlist";
import type { SupplierForumSql } from "./supplierForumRecommendationStore";
import type { SupplierForumGrant, SupplierForumInventory, SupplierForumSourceVersion } from "./supplierForumRecommendationModel";
import { canonicalJson, shippingLeadTime } from "./supplierForumRecommendationModel";

import { LIGHTWEIGHT_TODAY_ALGORITHM_VERSION, LIGHTWEIGHT_TODAY_CANDIDATE_LIMIT,
  LIGHTWEIGHT_TODAY_FORUM_ADVANTAGE_PCT,
  readLightweightTodayRecommendations, type LightweightTodayRow } from "./lightweightTodayRecommendation";
/** Read-only adapter for the SAME complete public event/price pool. No legacy score reads. */
export const SUPPLIER_TODAY_ALGORITHM_VERSION = LIGHTWEIGHT_TODAY_ALGORITHM_VERSION;
export const SUPPLIER_TODAY_CANDIDATE_LIMIT = LIGHTWEIGHT_TODAY_CANDIDATE_LIMIT;
// Four complete collection reads share ONE eight-second transaction deadline;
// each source read retains its own three-second total and per-SQL timeouts.
export const SUPPLIER_TODAY_BUDGET_MS = 8000;
const HOUR = 3_600_000;
/** Persist verbatim per sourceVersion. Public version/dedup MUST NOT include this:
 * pool recomputation does not constitute an inventory publication/refresh event.
 * New-claim CAS proofHash must bind this JSON, separately from public version.
 */
export type SupplierTodayRecommendationProof = Readonly<{
  kind: "supplier-today-public-value-v1";
  algorithmVersion: string;
  recommendationDate: string;
  priceBatchId: number;
  /** Legacy history is readable, but these fields are never fabricated for new proofs. */
  scoreLastCompletedAt?: number;
  scoreLastInventoryUpdatedAt?: number | null;
  offerFingerprint?: string;
  referenceFingerprint?: string;
  comparisonQuantity?: number;
  comparablePrice?: number;
  referencePrice?: number;
  advantagePct?: number;
  candidatePoolHash: string;
  rankedPoolHash: string;
  inventoryId: number;
  poolRank: number;
  enterpriseId: number;
  authorUserId: number;
  dataOwnerUserId: number;
  companyId: number;
  authorizationHash: string;
}>;
export type SupplierTodayInventory = SupplierForumInventory & { todayRecommendationProof: SupplierTodayRecommendationProof };
export type SupplierTodaySourceVersion = SupplierForumSourceVersion & { todayRecommendationProof: SupplierTodayRecommendationProof };
/** Observation only: no batch/pool/auth digests or formal membership proof leave this API. */
export type SupplierTodayPreviewInventory = Omit<SupplierForumInventory, "todayRecommendationProof"> & {
  previewOnly: true; todayRecommendationProof?: never;
};
type Pool = { priceBatchId: number | null; candidatePoolHash: string; rankedPoolHash: string;
  ranked: readonly LightweightTodayRow[] };
function safety(condition: unknown, code: string): asserts condition {
  if (!condition) throw Object.assign(new Error(code), { name: "SupplierForumSafetyError", code });
}
function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return Array.isArray(result) ? result as T[] : [];
}
function hash(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
function instant(value: Date | string | null | undefined): number {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value.replace(" ", "T") + "+08:00");
}
function validateGrant(grant: SupplierForumGrant, now: Date): void {
  safety(SUPPLIER_FORUM_CURRENT_ALLOWLIST.some(entry => entry.enterpriseId === grant.enterpriseId && entry.authorUserId === grant.authorUserId
    && entry.dataOwnerUserId === grant.dataOwnerUserId && entry.companyId === grant.companyId), "NOT_FROZEN_ALLOWLIST");
  safety(!grant.revokedAt && instant(grant.authorizedAt) <= now.getTime()
    && (grant.expiresAt === null || instant(grant.expiresAt) > now.getTime()), "AUTHORIZATION_INVALID");
  safety(grant.publicExactQuantityPrice === true && Boolean(grant.evidenceRef?.trim()), "PUBLIC_FIELDS_UNAUTHORIZED");
  safety(grant.currency === "CNY" && Boolean(grant.currencyEvidenceRef?.trim()), "CURRENCY_UNKNOWN");
}
function validateGrants(grants: SupplierForumGrant[], now: Date): void {
  safety(Number.isFinite(now.getTime()), "TODAY_DATE_INVALID");
  safety(grants.length <= 3 && new Set(grants.map(item => item.enterpriseId)).size === grants.length, "TODAY_AUTHORIZATION_SCOPE_INVALID");
  grants.forEach(grant => validateGrant(grant, now));
}
const transactionDeadlines = new WeakMap<object, number>();
function budget(tx: SupplierForumSql) {
  // All choose/revalidate calls on the SAME transaction share the first deadline;
  // repeated membership checks cannot silently buy another three seconds.
  const deadline = transactionDeadlines.get(tx) ?? performance.now() + SUPPLIER_TODAY_BUDGET_MS;
  transactionDeadlines.set(tx, deadline);
  return readBudget(tx, deadline);
}
function readBudget(tx: SupplierForumSql, deadline: number) {
  const check = () => safety(performance.now() < deadline, "TODAY_SOURCE_BUDGET_EXCEEDED");
  const execute = async <T>(query: SQL): Promise<T[]> => {
    check();
    // No detached Promise.race: the caller must not commit while SQL remains in flight.
    const rows = rowsOf<T>(await tx.execute(query));
    check(); return rows;
  };
  return { check, execute };
}
type Budget = ReturnType<typeof budget>;

async function readPool(bound: Budget, now: Date): Promise<Pool> {
  // Caller owns this short transaction through publication/commit. Never resurrect
  // an old pool from a pre-existing REPEATABLE READ snapshot.
  const [connection] = await bound.execute<{ isolationLevel: string }>(sql`
    /* sf:today-connection */ SELECT /*+ MAX_EXECUTION_TIME(600) */
      @@transaction_isolation AS isolationLevel`);
  safety(connection && String(connection.isolationLevel).toUpperCase().replaceAll("_", "-") === "READ-COMMITTED",
    "TODAY_SOURCE_TRANSACTION_REQUIRED");
  return readValuePool(bound, now, "transaction");
}
/** Fingerprints contain stable selected facts, not elapsed-time scores/generatedAt.
 * Public inventory version remains separately unchanged for historical dedup. */
function offerFingerprint(row: Pick<SupplierForumInventory, "id" | "userId" | "enterpriseId" | "partNumber" | "brand"
  | "qtyOnSale" | "taxIncluded" | "ladderPrices" | "moq" | "spq" | "leadTime" | "publishedAt" | "refreshedAt">
  & { priceEx: string | number | null }): string {
  let ladder = row.ladderPrices ?? null;
  if (typeof ladder === "string") { try { ladder = JSON.parse(ladder); } catch { /* fingerprint malformed input verbatim */ } }
  return hash([row.id, row.userId, row.enterpriseId, row.partNumber, row.brand, row.qtyOnSale,
    row.priceEx === null ? null : String(row.priceEx), row.taxIncluded === true || row.taxIncluded === 1,
    ladder, row.moq ?? null, row.spq ?? null, row.leadTime ?? null,
    row.publishedAt === null ? null : instant(row.publishedAt), row.refreshedAt === null ? null : instant(row.refreshedAt)]);
}
function referenceFingerprint(row: LightweightTodayRow): string {
  return hash([row.priceBatchId, row.partNumber.normalize("NFKC").trim().toUpperCase(), row.comparisonQuantity,
    row.referencePrice, row.referenceMatchedBy, row.priceReferenceStatus]);
}
function forumEligible(row: LightweightTodayRow): boolean {
  // Keep the normal supply formatter and historical public version unchanged.
  // A cheaper later tier must not qualify a post that quotes a different first tier.
  const posted = priceTerms(row as unknown as SupplierForumInventory);
  return Boolean(posted && Number(posted.price) === row.sellerPriceAtComparisonQuantity)
    && row.forumEligible === true && row.suspiciousPrice === false && row.referenceMatchedBy === "exact"
    && row.priceReferenceStatus === "reliable" && Number.isSafeInteger(row.priceBatchId) && Number(row.priceBatchId) > 0
    && Number.isSafeInteger(row.comparisonQuantity) && Number(row.comparisonQuantity) > 0
    && Number.isFinite(row.comparablePrice) && Number(row.comparablePrice) > 0
    && Number.isFinite(row.referencePrice) && Number(row.referencePrice) > 0
    && Number.isFinite(row.advantagePct) && row.advantagePct >= LIGHTWEIGHT_TODAY_FORUM_ADVANTAGE_PCT;
}
async function readValuePool(bound: Budget, now: Date, mode: "preview" | "transaction"): Promise<Pool> {
  const result = await readLightweightTodayRecommendations({ execute: query => bound.execute(query) }, { now,
    mode });
  bound.check();
  safety(result.algorithmVersion === SUPPLIER_TODAY_ALGORITHM_VERSION
    && result.diagnostics.complete === true, "TODAY_POOL_QUERY_BOUND_INVALID");
  // Bind ALL public members before allowlist filtering, never an API/UI slice.
  // Stable facts + algorithm version bind membership without score/clock refreshes.
  const facts = result.rows.map(row => [row.id, offerFingerprint(row), referenceFingerprint(row)]);
  return { priceBatchId: result.priceBatchId, ranked: result.rows,
    candidatePoolHash: hash([result.algorithmVersion, [...facts].sort((a, b) => Number(a[0]) - Number(b[0]))]),
    rankedPoolHash: hash([result.algorithmVersion, facts]) };
}
function proofFor(pool: Pool, row: SupplierForumInventory, grant: SupplierForumGrant, now: Date): SupplierTodayRecommendationProof {
  const poolRank = pool.ranked.findIndex(item => item.id === row.id && item.userId === grant.dataOwnerUserId);
  const member = pool.ranked[poolRank];
  safety(poolRank >= 0 && member && forumEligible(member), "TODAY_SOURCE_NOT_MEMBER");
  return Object.freeze({ kind: "supplier-today-public-value-v1", algorithmVersion: SUPPLIER_TODAY_ALGORITHM_VERSION,
    recommendationDate: now.toISOString().slice(0, 10), priceBatchId: member.priceBatchId!,
    offerFingerprint: offerFingerprint(member), referenceFingerprint: referenceFingerprint(member),
    comparisonQuantity: member.comparisonQuantity!, comparablePrice: member.comparablePrice!,
    referencePrice: member.referencePrice!, advantagePct: member.advantagePct,
    candidatePoolHash: pool.candidatePoolHash, rankedPoolHash: pool.rankedPoolHash,
    inventoryId: row.id, poolRank: poolRank + 1, enterpriseId: grant.enterpriseId, authorUserId: grant.authorUserId,
    dataOwnerUserId: grant.dataOwnerUserId, companyId: grant.companyId, authorizationHash: hash(grant) });
}
/** Formatting/qualification is the pure Model contract; its dedicated lead-time
 * helper is shared. AST tests pin these bodies; pool/time/price facts never change.
 */
function publicEventAt(row: SupplierForumInventory, now: Date): number {
  const times = [row.publishedAt, row.refreshedAt].filter(Boolean).map(value => instant(value));
  if (!times.length || times.some(time => !Number.isFinite(time) || time > now.getTime())) return NaN;
  return Math.max(...times);
}
function field(value: string | null, max: number): string | null {
  if (!value || value !== value.trim() || value.length > max || /[\r\n\t,，／\u0000-\u001f\u007f\uE000-\uE002]/.test(value)
    || /https?:|www\.|[<>]|\[[^\]]*\]\(/i.test(value)) return null;
  return value;
}
function decimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^\d{1,8}(?:\.\d{1,4})?$/.test(text) || !Number.isFinite(Number(text)) || Number(text) <= 0) return null;
  return text;
}
function priceTerms(row: SupplierForumInventory): { price: string; minQty: number; range: string } | null {
  const minimum = row.moq ?? 1;
  if (!Number.isSafeInteger(minimum) || minimum <= 0 || row.qtyOnSale < minimum) return null;
  if (row.spq !== null && (!Number.isSafeInteger(row.spq) || row.spq <= 0 || row.qtyOnSale < row.spq)) return null;
  const pack = row.spq ?? 1;
  const reachable = (lower: number) => Math.ceil(lower / pack) * pack;
  if (!Number.isSafeInteger(reachable(minimum)) || reachable(minimum) > row.qtyOnSale) return null;
  let tiers: unknown = row.ladderPrices;
  if (typeof tiers === "string") {
    if (tiers.length > 20_000) return null;
    try { tiers = JSON.parse(tiers); } catch { return null; }
  }
  if (tiers === null || tiers === undefined || (Array.isArray(tiers) && !tiers.length)) {
    const price = decimal(row.priceEx);
    return price ? { price, minQty: minimum, range: "" } : null;
  }
  if (!Array.isArray(tiers) || tiers.length > 50) return null;
  const normalized: { minQty: number; maxQty: number; price: string }[] = [];
  for (const tier of tiers) {
    if (!tier || typeof tier !== "object") return null;
    const minQty = Number(tier.minQty ?? tier.qty), price = decimal(tier.price);
    const maxQty = tier.maxQty === undefined ? Infinity : Number(tier.maxQty);
    if (!Number.isSafeInteger(minQty) || minQty <= 0 || !price
      || (tier.maxQty !== undefined && (!Number.isSafeInteger(maxQty) || maxQty <= minQty))) return null;
    normalized.push({ minQty, maxQty, price });
  }
  normalized.sort((a, b) => a.minQty - b.minQty);
  if (new Set(normalized.map(tier => tier.minQty)).size !== normalized.length) return null;
  for (let i = 0; i < normalized.length; i++) {
    const tier = normalized[i];
    const upper = Math.min(tier.maxQty, normalized[i + 1]?.minQty ?? Infinity);
    const firstQuantity = reachable(Math.max(minimum, tier.minQty));
    if (!Number.isSafeInteger(firstQuantity) || firstQuantity > row.qtyOnSale || firstQuantity >= upper) continue;
    return { price: tier.price, minQty: minimum,
      range: `；适用数量≥${firstQuantity}${upper === Infinity ? "" : `且<${upper}`}件` };
  }
  return null;
}
function inventoryLine(row: SupplierForumInventory, grant: SupplierForumGrant, now: Date): string | null {
  const event = publicEventAt(row, now);
  if (row.userId !== grant.dataOwnerUserId || row.enterpriseId !== grant.enterpriseId || row.status !== "published"
    || !(row.companyCatalogVisible === true || row.companyCatalogVisible === 1)
    || !Number.isSafeInteger(row.qtyOnSale) || row.qtyOnSale <= 0
    || !Number.isFinite(event) || now.getTime() - event > 48 * HOUR
    || row.suspiciousPrice === true || row.suspiciousPrice === 1) return null;
  const part = field(row.partNumber, 128), brand = field(row.brand, 64), lead = shippingLeadTime(row.leadTime);
  if (!part || !brand || !lead) return null;
  if (![true, false, 1, 0].includes(row.taxIncluded as boolean | number)) return null;
  const price = priceTerms(row);
  if (!price) return null;
  const tax = row.taxIncluded === true || row.taxIncluded === 1 ? "含税" : "未税";
  const condition = `${price.range}${price.minQty > 1 ? `；MOQ ${price.minQty}件` : ""}${row.spq && row.spq > 1 ? `；SPQ ${row.spq}件` : ""}`;
  const line = `${part}／${brand}，可售${row.qtyOnSale}件，单价CNY ${price.price}/件（${tax}${condition}），交期${lead}`;
  return maskForbiddenWords(line, { preserveCategories: ["contact"] }) === line ? line : null;
}
function publicVersion(row: SupplierForumInventory, grant: SupplierForumGrant, now: Date): string {
  return hash([row.id, row.userId, row.enterpriseId, publicEventAt(row, now), inventoryLine(row, grant, now)]);
}

export async function loadSupplierTodayRecommendationCandidates(tx: SupplierForumSql, grants: SupplierForumGrant[], now: Date,
  seen: SupplierForumSourceVersion[], lastPublishedEnterpriseId: number | null): Promise<SupplierForumInventory[]> {
  validateGrants(grants, now);
  if (!grants.length) return [];
  safety(seen.length <= 1200, "TODAY_SEEN_BOUND_INVALID");
  const bound = budget(tx), pool = await readPool(bound, now);
  const rows = await readQualifiedPoolCandidates(bound, pool, grants, now, seen, lastPublishedEnterpriseId);
  const selected = rows.map(row => ({ ...row, todayRecommendationProof: proofFor(pool, row,
    grants.find(grant => grant.enterpriseId === row.enterpriseId && grant.dataOwnerUserId === row.userId)!, now) }));
  bound.check(); return selected;
}

/** No transaction/session changes, locks, randomness or writes. Same public
 * complete pool, but only observation: preview cannot supply a formal proof.
 * Each preview has its own deadline; it cannot reset a formal tx's budget. */
export async function previewSupplierTodayRecommendationCandidates(db: SupplierForumSql, grants: SupplierForumGrant[], now: Date,
  seen: SupplierForumSourceVersion[], lastPublishedEnterpriseId: number | null): Promise<SupplierTodayPreviewInventory[]> {
  validateGrants(grants, now);
  if (!grants.length) return [];
  safety(seen.length <= 1200, "TODAY_SEEN_BOUND_INVALID");
  const bound = readBudget(db, performance.now() + SUPPLIER_TODAY_BUDGET_MS);
  const pool = await readValuePool(bound, now, "preview");
  const rows = await readQualifiedPoolCandidates(bound, pool, grants, now, seen, lastPublishedEnterpriseId);
  const selected = rows.map(row => {
    const { todayRecommendationProof: _discarded, ...facts } = row;
    return Object.freeze({ ...facts, previewOnly: true as const });
  });
  bound.check(); return selected;
}

async function readQualifiedPoolCandidates(bound: Budget, pool: Pool, grants: SupplierForumGrant[], now: Date,
  seen: SupplierForumSourceVersion[], lastPublishedEnterpriseId: number | null): Promise<SupplierForumInventory[]> {
  const eligibleIds = pool.ranked.filter(row => forumEligible(row)
    && grants.some(grant => grant.dataOwnerUserId === row.userId && grant.enterpriseId === row.enterpriseId)).map(row => row.id);
  if (!eligibleIds.length) return [];
  // Shared pool caps each enterprise at ten; frozen grants cover at most three.
  // LIMIT 100 below bounds only this authorized fact read, NEVER the public pool.
  safety(new Set(eligibleIds).size === eligibleIds.length && eligibleIds.length <= grants.length * 10
    && grants.every(grant => pool.ranked.filter(row => row.enterpriseId === grant.enterpriseId).length <= 10), "TODAY_FACT_QUERY_BOUND_INVALID");
  const scope = sql.join(grants.map(grant => sql`(i.enterpriseId = ${grant.enterpriseId} AND i.userId = ${grant.dataOwnerUserId})`), sql` OR `);
  const rows = await bound.execute<SupplierForumInventory>(sql`/* sf:today-authorized-facts */
    SELECT /*+ MAX_EXECUTION_TIME(1000) */ i.id, i.userId, i.enterpriseId, i.ownerUserId, i.ownershipVersion,
      i.partNumber, i.brand, i.status, i.companyCatalogVisible, i.qtyOnSale, i.priceEx, i.taxIncluded,
      i.ladderPrices, i.moq, i.spq, i.leadTime, i.publishedAt, i.refreshedAt
    FROM inventories i
    WHERE i.id IN (${sql.join(eligibleIds.map(id => sql`${id}`), sql`,`)}) AND (${scope})
      AND i.status = 'published' AND i.companyCatalogVisible = 1 AND i.qtyOnSale > 0
    ORDER BY i.id ASC LIMIT 100`);
  safety(rows.length <= eligibleIds.length && new Set(rows.map(row => row.id)).size === rows.length, "TODAY_FACT_QUERY_BOUND_INVALID");
  const already = new Set(seen.map(item => `${item.inventoryId}:${item.version}`));
  const sortedGrants = [...grants].sort((a, b) => a.enterpriseId - b.enterpriseId);
  const after = sortedGrants.filter(grant => grant.enterpriseId > (lastPublishedEnterpriseId ?? 0));
  const rotation = [...after, ...sortedGrants.filter(grant => !after.includes(grant))];
  const selected: SupplierForumInventory[] = [];
  for (const row of rows) {
    const grant = grants.find(item => item.enterpriseId === row.enterpriseId && item.dataOwnerUserId === row.userId);
    safety(grant && eligibleIds.includes(row.id), "TODAY_SOURCE_SCOPE_INVALID");
    const member = pool.ranked.find(item => item.id === row.id);
    safety(member && member.userId === row.userId && member.enterpriseId === row.enterpriseId
      && forumEligible(member) && offerFingerprint(member) === offerFingerprint(row), "TODAY_POOL_FACT_CHANGED");
    if (!inventoryLine(row, grant, now) || already.has(`${row.id}:${publicVersion(row, grant, now)}`)) continue;
    selected.push({ ...row, todayPoolRank: pool.ranked.findIndex(item => item.id === row.id) + 1 });
  }
  // No minimum/catch-up inventory fallback. Caller may publish fewer than twelve.
  // Freshness uses ONLY real publication/refresh events, never score/update clocks.
  selected.sort((a, b) => {
    return rotation.findIndex(grant => grant.enterpriseId === a.enterpriseId) - rotation.findIndex(grant => grant.enterpriseId === b.enterpriseId)
      || a.todayPoolRank! - b.todayPoolRank!;
  });
  bound.check(); return selected;
}

/** MUST run inside the publishing READ COMMITTED transaction before and after
 * source verification, using persisted proofs (not newly chosen replacements).
 * It re-reads the exact complete shared pool, not an old score snapshot or replacement.
 * Transaction must stay open through commit. Current grant/identity, locked live facts/version and forum
 * permissions remain the Delegation's independent mandatory checks.
 */
export async function assertSupplierTodayRecommendationMembership(tx: SupplierForumSql, inventoryIds: number[], now: Date,
  proofs: readonly SupplierTodayRecommendationProof[]): Promise<void> {
  safety(Number.isFinite(now.getTime()) && inventoryIds.length === 1
    && new Set(inventoryIds).size === inventoryIds.length && inventoryIds.every(id => Number.isSafeInteger(id) && id > 0)
    && Array.isArray(proofs) && proofs.length === inventoryIds.length, "TODAY_PROOF_COUNT_INVALID");
  const bound = budget(tx), pool = await readPool(bound, now);
  for (const id of inventoryIds) {
    const matching = proofs.filter(proof => proof && proof.inventoryId === id);
    safety(matching.length === 1, "TODAY_PROOF_MISSING");
    const proof = matching[0];
    safety(!("previewOnly" in proof) && proof.kind === "supplier-today-public-value-v1" && proof.algorithmVersion === SUPPLIER_TODAY_ALGORITHM_VERSION
      && proof.recommendationDate === now.toISOString().slice(0, 10)
      && SUPPLIER_FORUM_CURRENT_ALLOWLIST.some(entry => entry.enterpriseId === proof.enterpriseId && entry.authorUserId === proof.authorUserId
        && entry.dataOwnerUserId === proof.dataOwnerUserId && entry.companyId === proof.companyId)
      && /^[a-f0-9]{64}$/.test(proof.authorizationHash), "TODAY_PROOF_INVALID");
    safety(proof.priceBatchId === pool.priceBatchId
      && proof.candidatePoolHash === pool.candidatePoolHash && proof.rankedPoolHash === pool.rankedPoolHash, "TODAY_POOL_CHANGED");
    const member = pool.ranked[proof.poolRank - 1];
    safety(Number.isSafeInteger(proof.poolRank) && proof.poolRank >= 1 && member?.id === id && member.userId === proof.dataOwnerUserId
      && member.enterpriseId === proof.enterpriseId && forumEligible(member), "TODAY_SOURCE_NOT_MEMBER");
    safety(proof.offerFingerprint === offerFingerprint(member) && proof.referenceFingerprint === referenceFingerprint(member)
      && proof.comparisonQuantity === member.comparisonQuantity && proof.comparablePrice === member.comparablePrice
      && proof.referencePrice === member.referencePrice && proof.advantagePct === member.advantagePct
      && proof.advantagePct >= LIGHTWEIGHT_TODAY_FORUM_ADVANTAGE_PCT, "TODAY_SELECTED_FACTS_CHANGED");
  }
  bound.check();
}

/** Optional convenience: live authorization binding must also be checked by caller. */
export function assertSupplierTodayRecommendationAuthorization(proof: SupplierTodayRecommendationProof, grant: SupplierForumGrant, now: Date): void {
  validateGrant(grant, now);
  safety(proof && !("previewOnly" in proof) && proof.kind === "supplier-today-public-value-v1"
    && proof.algorithmVersion === SUPPLIER_TODAY_ALGORITHM_VERSION
    && /^[a-f0-9]{64}$/.test(proof.offerFingerprint ?? "") && /^[a-f0-9]{64}$/.test(proof.referenceFingerprint ?? ""), "TODAY_PROOF_INVALID");
  safety(proof.enterpriseId === grant.enterpriseId && proof.authorUserId === grant.authorUserId && proof.dataOwnerUserId === grant.dataOwnerUserId
    && proof.companyId === grant.companyId && proof.authorizationHash === hash(grant), "TODAY_AUTHORIZATION_CHANGED");
}
