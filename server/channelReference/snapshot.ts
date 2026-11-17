import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ChannelReferenceLookupResult, ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";
import { matchChannelReferenceBrand } from "../../shared/channelReferenceBrand";
import { channelReferenceIdentityKey, uniqueJsonMembers, parseChannelReferenceIdentityBindings, readFixedChannelReferenceIdentityBindings, type ChannelReferenceIdentityBinding } from "./identityBindings";

const SNAPSHOT_FILE = new URL("./channel-reference-snapshot.json", import.meta.url);
const STOCK_EVIDENCE_FILE = new URL("./channel-reference-stock-evidence.json", import.meta.url);
const MAX_STOCK_BYTES = 512 * 1024;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RECORDS = 5000;
const SOURCES: ChannelReferenceSource[] = ["lcsc", "ickey"];
type Material = { materialId: number; partNumber: string; brand: string };
export type ChannelReferenceSnapshotEvidence = {
  expectedPartNumber: string;
  observedPartNumber: string;
  expectedBrand: string;
  observedBrand: string;
  brandMatch: "exact" | "explicit_alias";
  literalReason: string | null;
  pageUrl: string;
  collectedAt: string;
  observedMaxQuantity: number;
  observedMaxUnitPrice: string;
  maxTierConfirmed: true;
};
export type ChannelReferenceSnapshotDocument = {
  schemaVersion: 1;
  collectionMode: "public-web-batch";
  generatedAt: string;
  records: Array<{
    partNumber: string;
    brand: string;
    references: Record<ChannelReferenceSource, ChannelReferenceQuote>;
    evidence: Record<ChannelReferenceSource, ChannelReferenceSnapshotEvidence | null>;
  }>;
};
export class ChannelReferenceSnapshotUnavailableError extends Error {
  constructor() { super("Channel reference snapshot unavailable"); this.name = "ChannelReferenceSnapshotUnavailableError"; }
}

// Keep the shared quote shape without importing the live worker/browser graph.
function emptyReferenceQuote(source: ChannelReferenceSource, status: ChannelReferenceQuote["status"]): ChannelReferenceQuote {
  return { source, status, matchedPartNumber: null, matchedBrand: null, productCode: null, pageUrl: null, stockQuantity: null, unitPrice: null, tierQuantity: null, tiers: [], currency: null, unit: null, taxStatus: "unknown", packaging: null, fetchedAt: null, expiresAt: null, stockInsufficientForTier: false, message: null };
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === expected.length && expected.every(k => Object.hasOwn(value, k));
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/.test(value);
}
function timestamp(value: unknown, latest: number): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= latest && new Date(parsed).toISOString() === value;
}
function price(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);
}
const mpn = (value: string) => value.trim().toUpperCase();
const identityKey = channelReferenceIdentityKey;

function evidenceUrl(source: ChannelReferenceSource, value: unknown, expectedPartNumber: string): value is string {
  if (!text(value, 2048) || /[\s\\#]/.test(value)) return false;
  try {
    const u = new URL(value);
    // Require canonical, literal HTTPS URLs. No parser-normalized paths/ports.
    if (u.href !== value || u.protocol !== "https:" || u.username || u.password || u.port || u.hash) return false;
    // Search evidence is limited to canonical complete-MPN queries, never a
    // prefix, alternate model, arbitrary query, or an unvisited detail substitute.
    if (u.search) {
      if (!text(expectedPartNumber, 128) || /[\s\\]/.test(expectedPartNumber)) return false;
      const fullMpn = encodeURIComponent(expectedPartNumber);
      if (source === "lcsc") return u.hostname === "so.szlcsc.com" && u.pathname === "/global.html" && u.search === `?k=${fullMpn}`;
      return u.hostname === "search.ickey.cn" && u.pathname === "/"
        && (u.search === `?keyword=${fullMpn}` || u.search === `?keyword=${fullMpn}&bom_ab=null`);
    }
    if (value.includes("?")) return false;
    if (source === "lcsc") return u.hostname === "item.szlcsc.com" && /^\/(?:mro\/)?[1-9]\d*\.html$/.test(u.pathname);
    if (u.hostname !== "www.ickey.cn" || !/^\/detail\/[1-9]\d*\/[^/]+\.html$/.test(u.pathname)) return false;
    if (u.pathname === "/detail/1003001031268591/LT3045IMSE%23TRPBF.html") return true;
    const segment = decodeURIComponent(u.pathname.split("/")[3]);
    return !/[\/\\?#%\s\u0000-\u001f\u007f]/.test(segment) && segment !== ".html" && !segment.includes("..");
  } catch { return false; }
}

function brandProof(expected: string, observed: string, evidence: ChannelReferenceSnapshotEvidence, source: ChannelReferenceSource): boolean {
  const match = matchChannelReferenceBrand(expected, observed, { profile: "snapshot", allowIckeyEquivalences: source === "ickey" });
  return match === "exact" ? evidence.brandMatch === "exact" && evidence.literalReason === null
    : match === "explicit_alias" && evidence.brandMatch === "explicit_alias" && evidence.literalReason === observed;
}

const QUOTE_KEYS = ["source", "status", "matchedPartNumber", "matchedBrand", "productCode", "pageUrl", "stockQuantity", "unitPrice", "tierQuantity", "tiers", "currency", "unit", "taxStatus", "packaging", "fetchedAt", "expiresAt", "stockInsufficientForTier", "message"] as const;
const EVIDENCE_KEYS = ["expectedPartNumber", "observedPartNumber", "expectedBrand", "observedBrand", "brandMatch", "literalReason", "pageUrl", "collectedAt", "observedMaxQuantity", "observedMaxUnitPrice", "maxTierConfirmed"] as const;
const NEGATIVE = ["not_found", "ambiguous", "price_unavailable", "access_restricted", "unavailable"] as const;
function validateQuote(value: unknown, proof: unknown, source: ChannelReferenceSource, expected: { partNumber: string; brand: string }, generatedAt: number): ChannelReferenceQuote | null {
  if (!keys(value, QUOTE_KEYS)) return null;
  const q = value as unknown as ChannelReferenceQuote;
  if (q.source !== source || q.expiresAt !== null || q.message !== null || (q.fetchedAt !== null && !timestamp(q.fetchedAt, generatedAt))) return null;
  if (NEGATIVE.some(status => status === q.status)) {
    if (proof !== null) return null;
    const empty = emptyReferenceQuote(source, q.status);
    for (const key of QUOTE_KEYS) {
      if (key === "fetchedAt" || key === "tiers") continue;
      if (q[key] !== empty[key]) return null;
    }
    if (!Array.isArray(q.tiers) || q.tiers.length !== 0) return null;
    empty.fetchedAt = q.fetchedAt;
    return empty;
  }
  if (q.status !== "ok" || !keys(proof, EVIDENCE_KEYS) || !timestamp(q.fetchedAt, generatedAt)) return null;
  const e = proof as unknown as ChannelReferenceSnapshotEvidence;
  if (!text(q.matchedPartNumber, 128) || !mpn(expected.partNumber) || mpn(q.matchedPartNumber) !== mpn(expected.partNumber)
    || !text(q.matchedBrand, 256) || !evidenceUrl(source, q.pageUrl, expected.partNumber)) return null;
  if (e.expectedPartNumber !== expected.partNumber || e.observedPartNumber !== q.matchedPartNumber || e.expectedBrand !== expected.brand || e.observedBrand !== q.matchedBrand
    || e.pageUrl !== q.pageUrl || e.collectedAt !== q.fetchedAt || e.maxTierConfirmed !== true || !brandProof(expected.brand, q.matchedBrand, e, source)) return null;
  for (const field of ["productCode", "unit", "packaging"] as const) if (q[field] !== null && !text(q[field], 256)) return null;
  if (!["CNY", "USD", "HKD"].includes(q.currency ?? "") || !["included", "excluded", "unknown"].includes(q.taxStatus)
    || (q.stockQuantity !== null && (!Number.isSafeInteger(q.stockQuantity) || q.stockQuantity < 0))
    || !Array.isArray(q.tiers) || q.tiers.length < 1 || q.tiers.length > 50) return null;
  let previous = 0;
  for (const t of q.tiers) {
    if (!keys(t, ["minQuantity", "unitPrice"]) || !Number.isSafeInteger(t.minQuantity) || t.minQuantity <= previous || !price(t.unitPrice)) return null;
    previous = t.minQuantity;
  }
  const max = q.tiers[q.tiers.length - 1];
  if (q.unitPrice !== max.unitPrice || q.tierQuantity !== max.minQuantity || e.observedMaxQuantity !== max.minQuantity || e.observedMaxUnitPrice !== max.unitPrice
    || q.stockInsufficientForTier !== (q.stockQuantity !== null && q.stockQuantity < max.minQuantity)) return null;
  return { ...q, tiers: q.tiers.map(t => ({ minQuantity: t.minQuantity, unitPrice: t.unitPrice })) };
}

async function readFixedSnapshot(): Promise<Uint8Array> {
  const handle = await open(SNAPSHOT_FILE, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BYTES) throw new ChannelReferenceSnapshotUnavailableError();
    // Bounded even if another process grows the file after stat. No write/rename.
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (!length || length > MAX_BYTES) throw new ChannelReferenceSnapshotUnavailableError();
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

export type ChannelReferenceStockEvidenceRecord = {
  partNumber: string; brand: string; source: ChannelReferenceSource;
  quoteSha256: string; productCode: string | null; quotePageUrl: string; quoteFetchedAt: string;
  observedPartNumber: string; observedBrand: string; stockQuantity: number;
  pageUrl: string; collectedAt: string;
  captureBasis: "actual-public-page-read"; captureReason: string;
  rawExcerpt: string; rawExcerptSha256: string;
  rawHtmlSha256: string | null; rawHtmlUnavailableReason: string | null;
};
export type ChannelReferenceStockEvidenceDocument = {
  schemaVersion: 1; collectionMode: "public-web-batch"; generatedAt: string;
  snapshotSha256: string; records: ChannelReferenceStockEvidenceRecord[];
};
export class ChannelReferenceStockEvidenceUnavailableError extends Error {
  constructor() { super("Channel reference stock evidence unavailable"); this.name = "ChannelReferenceStockEvidenceUnavailableError"; }
}
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const stockKey = (partNumber: string, brand: string, source: ChannelReferenceSource) => JSON.stringify([partNumber, brand, source]);
/** Semantic SHA of all original quote fields and every tier, sorted JSON keys;
 * key ordering is irrelevant, decimal strings and tier order remain exact. */
export function channelReferenceQuoteSha256(quote: ChannelReferenceQuote): string {
  return sha256(JSON.stringify(quote, [...QUOTE_KEYS, "minQuantity"].sort()));
}
const STOCK_KEYS = ["partNumber", "brand", "source", "quoteSha256", "productCode", "quotePageUrl", "quoteFetchedAt", "observedPartNumber", "observedBrand", "stockQuantity", "pageUrl", "collectedAt", "captureBasis", "captureReason", "rawExcerpt", "rawExcerptSha256", "rawHtmlSha256", "rawHtmlUnavailableReason"] as const;
/** Finite reviewed stock-only observations. Any malformed/stale record disables
 * this sidecar; it never changes snapshot validation or authorizes a new price. */
function parseStockEvidence(content: string | Uint8Array, snapshotSha256: string, current: Map<string, Record<ChannelReferenceSource, ChannelReferenceQuote>>, now: number) {
  try {
    if (typeof content !== "string" && !(content instanceof Uint8Array)) throw new Error("Invalid bytes");
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    if (!bytes.byteLength || bytes.byteLength > MAX_STOCK_BYTES) throw new Error("Invalid size");
    const json = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const doc: unknown = JSON.parse(json); uniqueJsonMembers(json);
    if (!keys(doc, ["schemaVersion", "collectionMode", "generatedAt", "snapshotSha256", "records"]) || doc.schemaVersion !== 1
      || doc.collectionMode !== "public-web-batch" || !timestamp(doc.generatedAt, now) || !hash(doc.snapshotSha256)
      || doc.snapshotSha256 !== snapshotSha256 || !Array.isArray(doc.records) || doc.records.length > 500) throw new Error("Invalid document");
    const result = new Map<string, ChannelReferenceStockEvidenceRecord>();
    for (const value of doc.records) {
      if (!keys(value, STOCK_KEYS) || !text(value.partNumber, 128) || !value.partNumber.trim() || !text(value.brand, 64) || !value.brand.trim()
        || !SOURCES.includes(value.source as ChannelReferenceSource)) throw new Error("Invalid identity");
      const r = value as unknown as ChannelReferenceStockEvidenceRecord;
      const q = current.get(identityKey(r.partNumber, r.brand))?.[r.source];
      if (!q || q.status !== "ok" || q.stockQuantity !== null || !hash(r.quoteSha256) || r.quoteSha256 !== channelReferenceQuoteSha256(q)
        || r.productCode !== q.productCode || r.quotePageUrl !== q.pageUrl || r.quoteFetchedAt !== q.fetchedAt
        || !text(r.observedPartNumber, 128) || !/^[A-Za-z0-9][A-Za-z0-9._+#/\-]*$/.test(r.observedPartNumber)
        || mpn(r.observedPartNumber) !== mpn(r.partNumber) || r.observedPartNumber !== q.matchedPartNumber
        || !text(r.observedBrand, 256) || r.observedBrand !== q.matchedBrand
        || !["exact", "explicit_alias"].includes(matchChannelReferenceBrand(r.brand, r.observedBrand, { profile: "snapshot", allowIckeyEquivalences: r.source === "ickey" }) ?? "")
        || !Number.isSafeInteger(r.stockQuantity) || r.stockQuantity < 0
        // One exact already-confirmed product/source, not a search or other seller.
        || r.pageUrl !== q.pageUrl || !evidenceUrl(r.source, r.pageUrl, r.partNumber)
        || !timestamp(r.collectedAt, Date.parse(doc.generatedAt)) || Date.parse(r.collectedAt) < Date.parse(r.quoteFetchedAt)
        || r.captureBasis !== "actual-public-page-read" || !text(r.captureReason, 4096) || !r.captureReason.trim()
        || typeof r.rawExcerpt !== "string" || !r.rawExcerpt.trim() || r.rawExcerpt.length > 32768 || r.rawExcerpt.includes("\u0000")
        || !r.rawExcerpt.includes(r.observedPartNumber) || !r.rawExcerpt.includes(r.observedBrand)
        || !hash(r.rawExcerptSha256) || sha256(r.rawExcerpt) !== r.rawExcerptSha256
        || (r.rawHtmlSha256 === null ? !text(r.rawHtmlUnavailableReason, 4096) || !r.rawHtmlUnavailableReason.trim()
          : !hash(r.rawHtmlSha256) || r.rawHtmlUnavailableReason !== null)) throw new Error("Invalid proof");
      // The original excerpt must itself disclose this source's single actual
      // stock number, not MOQ, packaging, SMT quantity or sum of seller rows.
      const matches = Array.from(r.rawExcerpt.matchAll(r.source === "lcsc" ? /现货[：:]\s*(0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?=\s|$)/g : /库存[：:]\s*(0|[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d*)(?=\s|$)/g));
      if (matches.length !== 1 || Number(matches[0][1].replaceAll(",", "")) !== r.stockQuantity) throw new Error("Stock excerpt mismatch");
      const key = stockKey(r.partNumber, r.brand, r.source);
      if (result.has(key)) throw new Error("Duplicate stock source");
      result.set(key, r);
    }
    return result;
  } catch { throw new ChannelReferenceStockEvidenceUnavailableError(); }
}
/** No runtime path/env setting, network fallback, watcher or last-good cache. */
export async function readFixedChannelReferenceStockEvidence(): Promise<Uint8Array | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(STOCK_EVIDENCE_FILE, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw new ChannelReferenceStockEvidenceUnavailableError();
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_STOCK_BYTES) throw new ChannelReferenceStockEvidenceUnavailableError();
    const bytes = Buffer.alloc(MAX_STOCK_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (!length || length > MAX_STOCK_BYTES) throw new ChannelReferenceStockEvidenceUnavailableError();
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

function parseSnapshot(bytes: Uint8Array, now: number): Map<string, Record<ChannelReferenceSource, ChannelReferenceQuote>> {
  const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!keys(raw, ["schemaVersion", "collectionMode", "generatedAt", "records"]) || raw.schemaVersion !== 1 || raw.collectionMode !== "public-web-batch"
    || !timestamp(raw.generatedAt, now) || !Array.isArray(raw.records) || raw.records.length > MAX_RECORDS) throw new ChannelReferenceSnapshotUnavailableError();
  const generatedAt = Date.parse(raw.generatedAt);
  const records = new Map<string, Record<ChannelReferenceSource, ChannelReferenceQuote>>();
  for (const record of raw.records) {
    if (!keys(record, ["partNumber", "brand", "references", "evidence"]) || !text(record.partNumber, 128) || !text(record.brand, 64)
      || !keys(record.references, SOURCES) || !keys(record.evidence, SOURCES)) throw new ChannelReferenceSnapshotUnavailableError();
    const key = identityKey(record.partNumber, record.brand);
    if (records.has(key)) throw new ChannelReferenceSnapshotUnavailableError();
    const references = {} as Record<ChannelReferenceSource, ChannelReferenceQuote>;
    for (const source of SOURCES) references[source] = validateQuote(record.references[source], record.evidence[source], source, { partNumber: record.partNumber, brand: record.brand }, generatedAt) ?? emptyReferenceQuote(source, "unavailable");
    records.set(key, references);
  }
  return records;
}

/** Read-only offline audit. Unlike lookup's fail-closed fallback, reports every
 * rejected target/source explicitly using the very same quote/schema validator. */
export function validateChannelReferenceSnapshot(bytes: Uint8Array, now = Date.now()) {
  parseSnapshot(bytes, now); // Actual document/identity/limit checks; throws on malformed input.
  const doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as ChannelReferenceSnapshotDocument;
  const results = doc.records.flatMap(record => SOURCES.map(source => {
    const quote = validateQuote(record.references[source], record.evidence[source], source, record, Date.parse(doc.generatedAt));
    return { partNumber: record.partNumber, brand: record.brand, source,
      inputStatus: record.references[source].status, valid: quote !== null,
      why: quote === null ? "actual validateQuote rejected quote/evidence identity, shape, URL, time or tier proof"
        : quote.status === "ok" ? "actual validateQuote accepted whole identity, literal proof, URL, original time and maximum-tier consistency"
          : "actual validateQuote accepted clean negative source with null evidence" };
  }));
  return { recordCount: doc.records.length, sourceCount: results.length,
    positiveCount: results.filter(r => r.valid && r.inputStatus === "ok").length,
    allValid: results.every(r => r.valid), results };
}

export function createChannelReferenceSnapshotService(options: {
  /** Dependency injection for pure tests; production always uses the fixed URL. */
  readSnapshot?: () => Promise<string | Uint8Array>;
  /** Pure tests only; no path or URL setting. Null means no identity bindings. */
  readIdentityBindings?: () => Promise<string | Uint8Array | null>;
  /** Pure tests only; production reads the fixed sibling with no path setting. */
  readStockEvidence?: () => Promise<string | Uint8Array | null>;
} = {}) {
  const readSnapshot = options.readSnapshot ?? readFixedSnapshot;
  const readIdentityBindings = options.readIdentityBindings ?? readFixedChannelReferenceIdentityBindings;
  const readStockEvidence = options.readStockEvidence ?? readFixedChannelReferenceStockEvidence;
  let lookupRevision = 0;
  let digest: string | undefined;
  let records = new Map<string, Record<ChannelReferenceSource, ChannelReferenceQuote>>();
  async function lookup(materials: Material[], _settings: { refresh?: boolean } = {}): Promise<ChannelReferenceLookupResult> {
    if (!Array.isArray(materials) || !materials.length || materials.length > 20 || new Set(materials.map(m => m?.materialId)).size !== materials.length
      || Array.from(materials).some(m => !object(m) || !Number.isSafeInteger(m.materialId) || m.materialId <= 0 || !text(m.partNumber, 128) || !text(m.brand, 64))) throw new Error("Invalid approved reference materials");
    const approved = materials.map(m => ({ materialId: m.materialId, partNumber: m.partNumber, brand: m.brand }));
    const revision = ++lookupRevision;
    let snapshotSha256: string;
    let current: Map<string, Record<ChannelReferenceSource, ChannelReferenceQuote>>;
    try {
      const content = await readSnapshot();
      if (typeof content !== "string" && !(content instanceof Uint8Array)) throw new ChannelReferenceSnapshotUnavailableError();
      const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
      if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new ChannelReferenceSnapshotUnavailableError();
      const nextDigest = createHash("sha256").update(bytes).digest("hex");
      snapshotSha256 = nextDigest;
      if (digest !== nextDigest) {
        const parsed = parseSnapshot(bytes, Date.now());
        records = parsed;
        digest = nextDigest;
      }
      current = records;
    } catch {
      // Never retain a previous good result after missing/corrupt replacement.
      digest = undefined;
      records = new Map();
      throw new ChannelReferenceSnapshotUnavailableError();
    }
    let bindings = new Map<string, ChannelReferenceIdentityBinding>();
    if (approved.some(m => SOURCES.some(source => current.get(identityKey(m.partNumber, m.brand))?.[source].status !== "ok"))) {
      try {
        const content = await readIdentityBindings();
        // A late read cannot resurrect bindings after a newer lookup observed
        // deletion/corruption. Never publish/cache a last-known-good mapping.
        if (content !== null && revision === lookupRevision) bindings = parseChannelReferenceIdentityBindings(content, snapshotSha256);
      } catch {
        // Only enrichment is disabled: preserve every original raw source's
        // quote/status, including successful references, with no live fallback.
      }
    }
    let stock = new Map<string, ChannelReferenceStockEvidenceRecord>();
    const needsStock = approved.some(material => SOURCES.some(source => {
      const key = identityKey(material.partNumber, material.brand), binding = bindings.get(key);
      let q = current.get(key)?.[source];
      if (q?.status !== "ok" && binding?.sources.includes(source)) q = current.get(identityKey(binding.canonical.partNumber, binding.canonical.brand))?.[source];
      return q?.status === "ok" && q.stockQuantity === null;
    }));
    if (needsStock) {
      try {
        const content = await readStockEvidence();
        if (content !== null && revision === lookupRevision) stock = parseStockEvidence(content, snapshotSha256, current, Date.now());
      } catch {
        // Stock-only failure: old prices and unknown-stock semantics are preserved.
      }
    }
    return { items: approved.map(material => {
      const key = identityKey(material.partNumber, material.brand);
      const stored = current.get(key), binding = revision === lookupRevision ? bindings.get(key) : undefined;
      const references = {} as Record<ChannelReferenceSource, ChannelReferenceQuote>;
      for (const source of SOURCES) {
        let q = stored?.[source] ?? emptyReferenceQuote(source, "not_found");
        let quoteIdentity = material;
        if (q.status !== "ok" && binding?.sources.includes(source)) {
          const canonical = current.get(identityKey(binding.canonical.partNumber, binding.canonical.brand))?.[source];
          if (canonical?.status === "ok") { q = canonical; quoteIdentity = { ...material, ...binding.canonical }; }
        }
        const cloned = { ...q, tiers: q.tiers.map(t => ({ ...t })) };
        const proof = revision === lookupRevision ? stock.get(stockKey(quoteIdentity.partNumber, quoteIdentity.brand, source)) : undefined;
        if (q.status === "ok" && q.stockQuantity === null && proof) {
          cloned.stockQuantity = proof.stockQuantity;
          cloned.stockInsufficientForTier = proof.stockQuantity < q.tiers[q.tiers.length - 1].minQuantity;
          cloned.stockFetchedAt = proof.collectedAt;
          cloned.stockPageUrl = proof.pageUrl;
        }
        references[source] = cloned;
      }
      // Copy only the BFF-approved public fields, never runtime-added private keys.
      return { materialId: material.materialId, partNumber: material.partNumber, brand: material.brand, references };
    }) };
  }
  return { lookup };
}
