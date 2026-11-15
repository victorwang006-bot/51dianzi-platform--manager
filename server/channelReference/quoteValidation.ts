import { createHash } from "node:crypto";
import type { ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";
import { allowedReferencePageUrl } from "./publicPage";
import { matchesLcscBrand, normalizeLcscBrand, normalizeLcscPartNumber } from "./lcscPage";
import { matchChannelReferenceBrand } from "../../shared/channelReferenceBrand";
const CACHE_TTL = 20 * 60_000;
const QUOTE_KEYS = ["source", "status", "matchedPartNumber", "matchedBrand", "productCode", "pageUrl", "stockQuantity", "unitPrice", "tierQuantity", "tiers", "currency", "unit", "taxStatus", "packaging", "fetchedAt", "expiresAt", "stockInsufficientForTier", "message"];
const wholeTime = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function referenceCacheKey(source: ChannelReferenceSource, partNumber: string, brand: string): string {
  // Raw trimmed identities are never broader than either provider's matching.
  // Isolate old NFKC-folded cache entries, even in a caller-supplied directory.
  return createHash("sha256").update(JSON.stringify(["page-reference-v2", source, partNumber.trim(), brand.trim()])).digest("hex");
}
function matchesReferenceIdentity(source: ChannelReferenceSource, partNumber: string, brand: string, expected: { partNumber: string; brand: string }): boolean {
  if (source === "lcsc") {
    return !!normalizeLcscPartNumber(expected.partNumber) && !!normalizeLcscBrand(expected.brand)
      && normalizeLcscPartNumber(partNumber) === normalizeLcscPartNumber(expected.partNumber)
      && matchesLcscBrand(expected.brand, brand);
  }
  // Conservative subset of ickeyPage's clean+toUpperCase exact comparison:
  // no NFKC, entity decoding, zero-width or suffix removal. Only approved brand edges.
  const exact = (value: string) => value.replace(/\s+/g, " ").trim().toUpperCase();
  return !!exact(expected.partNumber) && !!exact(expected.brand)
    && exact(partNumber) === exact(expected.partNumber)
    && matchChannelReferenceBrand(expected.brand, brand, { profile: "ickey", normalize: exact }) !== null;
}
export function validCachedReference(value: unknown, source: ChannelReferenceSource, expected: { partNumber: string; brand: string }): value is ChannelReferenceQuote {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== QUOTE_KEYS.length || !QUOTE_KEYS.every(k => Object.hasOwn(value, k))) return false;
  const q = value as ChannelReferenceQuote;
  if (q.source !== source || !["ok", "not_found", "ambiguous", "price_unavailable", "access_restricted", "unavailable"].includes(q.status)) return false;
  if (!wholeTime(q.fetchedAt) || !wholeTime(q.expiresAt) || Date.parse(q.expiresAt) - Date.parse(q.fetchedAt) !== CACHE_TTL) return false;
  if (q.stockQuantity !== null && (!Number.isSafeInteger(q.stockQuantity) || q.stockQuantity < 0)) return false;
  if (!Array.isArray(q.tiers) || q.tiers.length > 50) return false;
  let previous = 0;
  for (const t of q.tiers) {
    if (!t || typeof t !== "object" || Object.keys(t).length !== 2 || !Object.hasOwn(t, "minQuantity") || !Object.hasOwn(t, "unitPrice")) return false;
    if (!Number.isSafeInteger(t.minQuantity) || t.minQuantity <= previous || typeof t.unitPrice !== "string" || t.unitPrice.length > 64 || !/^\d+(?:\.\d+)?$/.test(t.unitPrice) || !/[1-9]/.test(t.unitPrice)) return false;
    previous = t.minQuantity;
  }
  if (q.pageUrl !== null && (typeof q.pageUrl !== "string" || !allowedReferencePageUrl(source, q.pageUrl))) return false;
  for (const key of ["matchedPartNumber", "matchedBrand", "productCode", "packaging", "unit"] as const) if (q[key] !== null && (typeof q[key] !== "string" || q[key]!.length > 256 || /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/.test(q[key]!))) return false;
  // Matched identities also accompany price_unavailable: never reuse another
  // product's stock/metadata. Identity-free negative quotes remain cacheable.
  if (q.matchedPartNumber !== null || q.matchedBrand !== null) {
    if (!q.matchedPartNumber || !q.matchedBrand || !matchesReferenceIdentity(source, q.matchedPartNumber, q.matchedBrand, expected)) return false;
  }
  if (!["included", "excluded", "unknown"].includes(q.taxStatus) || ![null, "CNY", "USD", "HKD"].includes(q.currency) || typeof q.stockInsufficientForTier !== "boolean" || q.message !== null) return false;
  if (q.status === "ok") {
    const max = q.tiers.at(-1);
    if (!max || q.unitPrice !== max.unitPrice || q.tierQuantity !== max.minQuantity || !q.pageUrl || !q.currency || !q.matchedPartNumber || !q.matchedBrand || q.stockInsufficientForTier !== (q.stockQuantity !== null && q.stockQuantity < max.minQuantity)) return false;
  } else if (q.unitPrice !== null || q.tierQuantity !== null) return false;
  return true;
}
