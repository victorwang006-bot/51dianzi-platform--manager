import { createHash } from "node:crypto";
import { maskForbiddenWords } from "../../../shared/contentModeration";
import type { SupplierForumFrozenIdentity } from "./supplierForumRecommendationAllowlist";

export class SupplierForumSafetyError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "SupplierForumSafetyError"; }
}
export function safety(condition: unknown, code: string): asserts condition {
  if (!condition) throw new SupplierForumSafetyError(code);
}
export type SupplierForumGrant = SupplierForumFrozenIdentity & {
  authorizedAt: string; expiresAt: string | null; revokedAt: string | null;
  evidenceRef: string; publicExactQuantityPrice: true;
  /** Existing inventory schema has no currency column. Must be independently verified,
   * not inferred from a symbol or silently defaulted. Non-CNY/unknown rows are excluded. */
  currency: "CNY"; currencyEvidenceRef: string;
};
// Old published history may lack proofHash; only public version participates in
// dedup. Newly claimed runs MUST carry the separate live ownership/CAS proof.
export type SupplierForumSourceVersion = { inventoryId: number; version: string; proofHash?: string;
  todayRecommendationProof?: import("./supplierForumTodayRecommendation").SupplierTodayRecommendationProof };
export type SupplierForumInventory = {
  id: number; userId: number; enterpriseId: number | null;
  ownershipVersion: number; ownerUserId: number | null;
  partNumber: string; brand: string; status: string; companyCatalogVisible: boolean | number;
  qtyOnSale: number; priceEx: string | null; taxIncluded: boolean | number | null;
  ladderPrices: unknown; moq: number | null; spq: number | null; leadTime: string | null;
  publishedAt: Date | string | null; refreshedAt: Date | string | null;
  /** Legacy metadata is optional, never used to rank the new public pool. */
  priorityTier?: number | null; valueScore?: string | number | null;
  suspiciousPrice?: boolean | number | null;
  /** Observation rank only; formal authority always comes from the persisted proof. */
  todayPoolRank?: number;
  /** B's today-recommendation membership proof; frozen separately from public dedup. */
  todayRecommendationProof?: import("./supplierForumTodayRecommendation").SupplierTodayRecommendationProof;
};
export type SupplierForumSelection = {
  grant: SupplierForumGrant; content: string; contentHash: string;
  sourceVersions: SupplierForumSourceVersion[]; inventoryIds: number[];
};
const HOUR = 3_600_000;
export function instant(value: Date | string | null | undefined): number {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  // Raw MySQL literals are Beijing wall clock, never host-local/UTC by accident.
  return Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value.replace(" ", "T") + "+08:00");
}
export function beijingDay(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function inPublishWindow(now: Date): boolean {
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  // Exact persisted slot minute is checked separately; never publish outside 09–18.
  return local >= "09:00" && local < "18:00";
}
/** JSON semantic encoding: recursively sort object keys, never reorder arrays or
 * coerce invalid numbers to null. Undefined array slots retain JSON's null meaning;
 * undefined object fields are rejected, not silently omitted from a security scope. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    safety(Number.isFinite(value), "HASH_JSON_NUMBER_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${Array.from(value, item => item === undefined ? "null" : canonicalJson(item)).join(",")}]`;
  safety(value && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype
    || Object.getPrototypeOf(value) === null), "HASH_JSON_VALUE_INVALID");
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export function hash(value: unknown): string { return createHash("sha256").update(canonicalJson(value)).digest("hex"); }
export function validateGrant(grant: SupplierForumGrant, frozen: readonly SupplierForumFrozenIdentity[], now: Date): void {
  safety(frozen.some(entry => entry.enterpriseId === grant.enterpriseId && entry.authorUserId === grant.authorUserId
    && entry.dataOwnerUserId === grant.dataOwnerUserId && entry.companyId === grant.companyId), "NOT_FROZEN_ALLOWLIST");
  safety(!grant.revokedAt && instant(grant.authorizedAt) <= now.getTime()
    && (grant.expiresAt === null || instant(grant.expiresAt) > now.getTime()), "AUTHORIZATION_INVALID");
  safety(grant.publicExactQuantityPrice === true && Boolean(grant.evidenceRef?.trim()), "PUBLIC_FIELDS_UNAUTHORIZED");
  safety(grant.currency === "CNY" && Boolean(grant.currencyEvidenceRef?.trim()), "CURRENCY_UNKNOWN");
}
export function publicEventAt(row: SupplierForumInventory, now: Date): number {
  // Reject future timestamps altogether, not silently fall back to an older event.
  const times = [row.publishedAt, row.refreshedAt].filter(Boolean).map(value => instant(value));
  if (!times.length || times.some(time => !Number.isFinite(time) || time > now.getTime())) return NaN;
  return Math.max(...times);
}
function field(value: string | null, max: number): string | null {
  if (!value || value !== value.trim() || value.length > max || /[\r\n\t,，／\u0000-\u001f\u007f\uE000-\uE002]/.test(value)
    || /https?:|www\.|[<>]|\[[^\]]*\]\(/i.test(value)) return null;
  return value;
}
/** Validate the ENTIRE seller field, never extract a duration from marketing text.
 * Qualifiers/statuses are retained verbatim, including honest pending delivery. */
export function shippingLeadTime(value: string | null): string | null {
  const lead = field(value, 32);
  if (!lead) return null;
  if (/^(?:待确认|待定|tbd|pending confirmation)$/i.test(lead)) return lead;
  if (/^(?:现货|当天|当日)(?:可?发货|交货|到货)?$|^(?:in *stock|spot|same day|ready to ship)$/i.test(lead)) return lead;
  const duration = /^(?:(?:预计|大约|约) *|(?:approx\.?|approximately|estimated|ships? in) +)?(\d+(?:\.\d+)?)(?: *[-–—~～至到] *(\d+(?:\.\d+)?))? *(个?工作日|天|日|小时|周|个月|月|days?|weeks?|hours?|months?)(?: *(?:内|左右|可?发货|交货|到货|交付))?$/i.exec(lead);
  if (duration) {
    const lower = Number(duration[1]), upper = Number(duration[2] ?? duration[1]);
    const unit = duration[3].toLowerCase();
    const maximum = /月|month/.test(unit) ? 24 : /周|week/.test(unit) ? 104 : /小时|hour/.test(unit) ? 17520 : 730;
    return Number.isFinite(lower) && lower > 0 && lower <= upper && upper <= maximum ? lead : null;
  }
  // Legacy pure range has no unit: preserve it, never infer days or spot.
  const range = /^(\d{1,3}) *[-–—~～至到] *(\d{1,3})$/.exec(lead);
  if (range) return Number(range[1]) > 0 && Number(range[1]) <= Number(range[2]) && Number(range[2]) <= 730 ? lead : null;
  const date = /^(\d{4})-(\d{2})-(\d{2})(?: *(?:发货|交货|到货|交付))?$/.exec(lead);
  if (date) {
    const day = `${date[1]}-${date[2]}-${date[3]}`, parsed = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? lead : null;
  }
  return null;
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
  // Match cartUtils/ProductDetail: real ladders precede priceEx and accept the
  // legacy qty key. Be stricter on ambiguous records instead of inventing a price.
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
    // Both the explicit exclusive max AND the next purchasing tier cap the offer.
    const upper = Math.min(tier.maxQty, normalized[i + 1]?.minQty ?? Infinity);
    const firstQuantity = reachable(Math.max(minimum, tier.minQty));
    if (!Number.isSafeInteger(firstQuantity) || firstQuantity > row.qtyOnSale || firstQuantity >= upper) continue;
    return { price: tier.price, minQty: minimum,
      range: `；适用数量≥${firstQuantity}${upper === Infinity ? "" : `且<${upper}`}件` };
  }
  return null;
}
export function inventoryLine(row: SupplierForumInventory, grant: SupplierForumGrant, now: Date): string | null {
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
  // Sensitive-word mutation could corrupt a part/brand fact: skip rather than post a masked offer.
  return maskForbiddenWords(line, { preserveCategories: ["contact"] }) === line ? line : null;
}
export function sourceVersion(row: SupplierForumInventory, grant: SupplierForumGrant, now: Date): SupplierForumSourceVersion {
  const version = hash([row.id, row.userId, row.enterpriseId, publicEventAt(row, now), inventoryLine(row, grant, now)]);
  return { inventoryId: row.id, version, proofHash: hash([version, row.userId, row.enterpriseId, row.ownerUserId, row.ownershipVersion, row.todayRecommendationProof]),
    ...(row.todayRecommendationProof === undefined ? {} : { todayRecommendationProof: row.todayRecommendationProof }) };
}
export function rotateSupplierForumGrants(grants: SupplierForumGrant[], lastEnterpriseId: number | null): SupplierForumGrant[] {
  const sorted = [...grants].sort((a, b) => a.enterpriseId - b.enterpriseId);
  const after = sorted.filter(grant => grant.enterpriseId > (lastEnterpriseId ?? 0));
  return [...after, ...sorted.filter(grant => !after.includes(grant))];
}
export function qualifiedSupplierForumRows(grant: SupplierForumGrant, rows: SupplierForumInventory[],
  seen: SupplierForumSourceVersion[], now: Date): SupplierForumInventory[] {
    const already = new Set(seen.map(item => `${item.inventoryId}:${item.version}`));
    // Formal rows must carry B's scope-bound proof; preview remains observation only.
    // B's authoritative current pool/state revalidation is still mandatory later.
    const eligible = rows.filter(row => {
      const proof = row.todayRecommendationProof;
      return proof ? !("previewOnly" in row) && !("previewOnly" in proof)
        && proof.kind === "supplier-today-public-value-v1" && proof.inventoryId === row.id
        && proof.enterpriseId === grant.enterpriseId && proof.authorUserId === grant.authorUserId
        && proof.dataOwnerUserId === grant.dataOwnerUserId && proof.companyId === grant.companyId
        && proof.authorizationHash === hash(grant) && Number.isSafeInteger(proof.poolRank)
        && proof.poolRank >= 1
        : "previewOnly" in row && row.previewOnly === true;
    }).filter(row => Boolean(inventoryLine(row, grant, now)))
      .filter(row => { const version = sourceVersion(row, grant, now); return !already.has(`${version.inventoryId}:${version.version}`); })
      .sort((a, b) => {
        return (a.todayRecommendationProof?.poolRank ?? a.todayPoolRank ?? Number.MAX_SAFE_INTEGER)
            - (b.todayRecommendationProof?.poolRank ?? b.todayPoolRank ?? Number.MAX_SAFE_INTEGER)
          || publicEventAt(b, now) - publicEventAt(a, now) || a.id - b.id;
      });
    const distinct: SupplierForumInventory[] = [];
    const materials = new Set<string>();
    for (const row of eligible) {
      const material = `${row.partNumber.toUpperCase()}\u0000${row.brand.toUpperCase()}`;
      if (materials.has(material)) continue;
      materials.add(material); distinct.push(row);
      if (distinct.length === 5) break;
    }
    return distinct;
}
export function selectSupplierForumContent(grants: SupplierForumGrant[], rows: SupplierForumInventory[], seen: SupplierForumSourceVersion[],
  lastEnterpriseId: number | null, now: Date): SupplierForumSelection | null {
  const cohorts = rotateSupplierForumGrants(grants, lastEnterpriseId).map(grant => ({ grant,
    distinct: qualifiedSupplierForumRows(grant, rows, seen, now) }));
  // Enterprise rotation is PRIMARY among approved qualified suppliers, including
  // valid 48h stock. Only then pick that enterprise's best shared public rank.
  // Last enterprise wraps to the end; it may repeat only if no other qualifies.
  for (const { grant, distinct } of cohorts) {
    if (!distinct.length) continue;
    const selected = distinct.slice(0, 1);
    const content = inventoryLine(selected[0], grant, now)!;
    if (content.length > 2000) continue;
    return { grant, content, contentHash: hash(content), sourceVersions: selected.map(row => sourceVersion(row, grant, now)), inventoryIds: selected.map(row => row.id) };
  }
  return null;
}
