import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ChannelReferenceLookupResult, ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";
import { matchChannelReferenceBrand } from "../../shared/channelReferenceBrand";

const SNAPSHOT_FILE = new URL("./channel-reference-snapshot.json", import.meta.url);
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
const identityKey = (partNumber: string, rawBrand: string) => JSON.stringify([partNumber, rawBrand]);

function detailUrl(source: ChannelReferenceSource, value: unknown): value is string {
  if (!text(value, 2048) || /[\s\\?#]/.test(value)) return false;
  try {
    const u = new URL(value);
    // Require canonical, literal HTTPS URLs. No parser-normalized paths/ports.
    if (u.href !== value || u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return false;
    // Actual positive evidence supports only these exact exceptional paths.
    if (source === "lcsc") return u.hostname === "item.szlcsc.com" && (u.pathname === "/mro/6710007.html" || /^\/[1-9]\d*\.html$/.test(u.pathname));
    if (u.hostname !== "www.ickey.cn" || !/^\/detail\/[1-9]\d*\/[^/]+\.html$/.test(u.pathname)) return false;
    if (u.pathname === "/detail/1003001031268591/LT3045IMSE%23TRPBF.html") return true;
    const segment = decodeURIComponent(u.pathname.split("/")[3]);
    return !/[\/\\?#%\s\u0000-\u001f\u007f]/.test(segment) && segment !== ".html" && !segment.includes("..");
  } catch { return false; }
}

function brandProof(expected: string, observed: string, evidence: ChannelReferenceSnapshotEvidence): boolean {
  const match = matchChannelReferenceBrand(expected, observed, { profile: "snapshot" });
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
    || !text(q.matchedBrand, 256) || !detailUrl(source, q.pageUrl)) return null;
  if (e.expectedPartNumber !== expected.partNumber || e.observedPartNumber !== q.matchedPartNumber || e.expectedBrand !== expected.brand || e.observedBrand !== q.matchedBrand
    || e.pageUrl !== q.pageUrl || e.collectedAt !== q.fetchedAt || e.maxTierConfirmed !== true || !brandProof(expected.brand, q.matchedBrand, e)) return null;
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
} = {}) {
  const readSnapshot = options.readSnapshot ?? readFixedSnapshot;
  let digest: string | undefined;
  let records = new Map<string, Record<ChannelReferenceSource, ChannelReferenceQuote>>();
  async function lookup(materials: Material[], _settings: { refresh?: boolean } = {}): Promise<ChannelReferenceLookupResult> {
    if (!Array.isArray(materials) || !materials.length || materials.length > 20 || new Set(materials.map(m => m?.materialId)).size !== materials.length
      || Array.from(materials).some(m => !object(m) || !Number.isSafeInteger(m.materialId) || m.materialId <= 0 || !text(m.partNumber, 128) || !text(m.brand, 64))) throw new Error("Invalid approved reference materials");
    const approved = materials.map(m => ({ materialId: m.materialId, partNumber: m.partNumber, brand: m.brand }));
    let current: Map<string, Record<ChannelReferenceSource, ChannelReferenceQuote>>;
    try {
      const content = await readSnapshot();
      if (typeof content !== "string" && !(content instanceof Uint8Array)) throw new ChannelReferenceSnapshotUnavailableError();
      const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
      if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new ChannelReferenceSnapshotUnavailableError();
      const nextDigest = createHash("sha256").update(bytes).digest("hex");
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
    return { items: approved.map(material => {
      const stored = current.get(identityKey(material.partNumber, material.brand));
      const references = {} as Record<ChannelReferenceSource, ChannelReferenceQuote>;
      for (const source of SOURCES) {
        const q = stored?.[source] ?? emptyReferenceQuote(source, "not_found");
        references[source] = { ...q, tiers: q.tiers.map(t => ({ ...t })) };
      }
      // Copy only the BFF-approved public fields, never runtime-added private keys.
      return { materialId: material.materialId, partNumber: material.partNumber, brand: material.brand, references };
    }) };
  }
  return { lookup };
}
