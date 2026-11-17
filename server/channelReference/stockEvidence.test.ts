import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";
import { channelReferenceQuoteSha256, createChannelReferenceSnapshotService, readFixedChannelReferenceStockEvidence, validateChannelReferenceSnapshot, type ChannelReferenceSnapshotDocument, type ChannelReferenceStockEvidenceDocument } from "./snapshot";
import { channelReferenceLookupResult } from "../../client/src/business/platform/client/src/pages/channelReferenceModel";
vi.mock("node:fs/promises", async original => ({ ...await original<typeof import("node:fs/promises")>(), open: vi.fn() }));
const OLD = "2026-11-14T01:00:00.000Z", NEW = "2026-11-17T01:00:00.123Z";
const raw = { partNumber: "TEST-FULL-MPN-123", brand: "TEST-Manufacturer" };
const materials = [{ materialId: 1, ...raw }];
const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
function quote(source: ChannelReferenceSource): ChannelReferenceQuote {
  return { source, status: "ok", matchedPartNumber: raw.partNumber, matchedBrand: raw.brand, productCode: "TEST-C1", pageUrl: source === "lcsc" ? "https://item.szlcsc.com/123.html" : "https://www.ickey.cn/detail/123/TEST-FULL-MPN-123.html", stockQuantity: null, unitPrice: "0.01000", tierQuantity: 100, tiers: [{ minQuantity: 1, unitPrice: "0.02000" }, { minQuantity: 100, unitPrice: "0.01000" }], currency: "CNY", unit: null, taxStatus: "unknown", packaging: null, fetchedAt: OLD, expiresAt: null, stockInsufficientForTier: false, message: null };
}
function document(): ChannelReferenceSnapshotDocument {
  const lcsc = quote("lcsc"), ickey = quote("ickey");
  const evidence = (q: ChannelReferenceQuote) => ({ expectedPartNumber: raw.partNumber, expectedBrand: raw.brand, observedPartNumber: q.matchedPartNumber!, observedBrand: q.matchedBrand!, brandMatch: "exact" as const, literalReason: null, pageUrl: q.pageUrl!, collectedAt: OLD, observedMaxQuantity: 100, observedMaxUnitPrice: "0.01000", maxTierConfirmed: true as const });
  return { schemaVersion: 1, collectionMode: "public-web-batch", generatedAt: OLD, records: [{ ...raw, references: { lcsc, ickey }, evidence: { lcsc: evidence(lcsc), ickey: evidence(ickey) } }] };
}
function sidecar(doc = document(), qty = 7): ChannelReferenceStockEvidenceDocument {
  const q = doc.records[0].references.lcsc, rawExcerpt = `${raw.partNumber}\n品牌名称：${raw.brand}\n现货：${qty}\n`;
  return { schemaVersion: 1, collectionMode: "public-web-batch", generatedAt: NEW, snapshotSha256: sha(JSON.stringify(doc)), records: [{ ...raw, source: "lcsc", quoteSha256: channelReferenceQuoteSha256(q), productCode: q.productCode, quotePageUrl: q.pageUrl!, quoteFetchedAt: q.fetchedAt!, observedPartNumber: raw.partNumber, observedBrand: raw.brand, stockQuantity: qty, pageUrl: q.pageUrl!, collectedAt: NEW, captureBasis: "actual-public-page-read", captureReason: "Synthetic fixture only: actual read, one exact product.", rawExcerpt, rawExcerptSha256: sha(rawExcerpt), rawHtmlSha256: null, rawHtmlUnavailableReason: "Synthetic fixture has an independent excerpt only, no DOM." }] };
}
function service(doc = document(), stock: unknown = sidecar(doc)) {
  return createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(doc), readIdentityBindings: async () => null, readStockEvidence: async () => stock === null ? null : JSON.stringify(stock) });
}
const output = async (s: ReturnType<typeof service>) => (await s.lookup(materials)).items[0].references;
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-17T02:00:00.000Z")); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); })); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("independent stock-only provenance", () => {
  it("clones only stock fields, preserving every original price/tiers/message/time and source", async () => {
    const doc = document(), unchanged = JSON.stringify(doc), s = service(doc), result = await s.lookup(materials), q = result.items[0].references.lcsc;
    expect(q).toEqual({ ...doc.records[0].references.lcsc, stockQuantity: 7, stockInsufficientForTier: true, stockFetchedAt: NEW, stockPageUrl: quote("lcsc").pageUrl });
    expect(result.items[0].references.ickey).toEqual(doc.records[0].references.ickey);
    expect(JSON.stringify(doc)).toBe(unchanged); expect(validateChannelReferenceSnapshot(Buffer.from(unchanged)).allValid).toBe(true);
    expect(channelReferenceLookupResult(result, [{ id: 1, ...raw }])).toEqual(result);
    q.unitPrice = "999"; q.tiers[0].unitPrice = "999"; q.stockQuantity = 999;
    expect((await output(s)).lcsc.unitPrice).toBe("0.01000"); expect((await output(s)).lcsc.stockQuantity).toBe(7);
  });
  it("distinguishes confirmed zero from unknown and refuses to overwrite any existing explicit stock", async () => {
    expect((await output(service(document(), sidecar(document(), 0)))).lcsc).toMatchObject({ stockQuantity: 0, stockInsufficientForTier: true, stockFetchedAt: NEW });
    expect((await output(service(document(), null))).lcsc.stockQuantity).toBeNull();
    for (const quantity of [0, 55]) {
      const doc = document(), proof = sidecar(doc); doc.records[0].references.lcsc.stockQuantity = quantity; doc.records[0].references.lcsc.stockInsufficientForTier = true;
      proof.snapshotSha256 = sha(JSON.stringify(doc)); proof.records[0].quoteSha256 = channelReferenceQuoteSha256(doc.records[0].references.lcsc);
      expect((await output(service(doc, proof))).lcsc).toEqual(doc.records[0].references.lcsc);
    }
  });
  it("corruption/missing/stale/read-error never caches last-good and a fresh valid read can recover", async () => {
    let stock: string | Uint8Array | null = JSON.stringify(sidecar()); let error: Error | undefined;
    const s = createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(document()), readIdentityBindings: async () => null, readStockEvidence: async () => { if (error) throw error; return stock; } });
    expect((await output(s)).lcsc.stockQuantity).toBe(7);
    for (stock of [null, "{", "", Buffer.from([0xff]), "x".repeat(512 * 1024 + 1), JSON.stringify({ ...sidecar(), snapshotSha256: "a".repeat(64) })]) expect(await output(s)).toEqual(document().records[0].references);
    stock = JSON.stringify(sidecar()); error = new Error("EACCES"); expect(await output(s)).toEqual(document().records[0].references);
    error = undefined; expect((await output(s)).lcsc.stockQuantity).toBe(7);
  });
  it("late good sidecar cannot revive after newer lookup sees deletion or a changed snapshot", async () => {
    let release!: (s: string) => void;
    const readStockEvidence = vi.fn().mockImplementationOnce(() => new Promise<string>(r => { release = r; })).mockResolvedValue(null);
    const s = createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(document()), readIdentityBindings: async () => null, readStockEvidence });
    const late = output(s); await vi.waitFor(() => expect(readStockEvidence).toHaveBeenCalledOnce());
    expect(await output(s)).toEqual(document().records[0].references); release(JSON.stringify(sidecar())); expect(await late).toEqual(document().records[0].references);
  });
  it("blocks raw/observed manufacturer, full-MPN/source/URL/time/qty/raw-hash/price-injection drift", async () => {
    const changes = [
      (d: any) => { d.records[0].brand = "OTHER"; }, (d: any) => { d.records[0].observedBrand = "OTHER"; },
      (d: any) => { d.records[0].observedPartNumber = "TEST-FULL-MPN"; }, (d: any) => { d.records[0].source = "ickey"; },
      (d: any) => { d.records[0].pageUrl += "?fromZone=realParameter"; }, (d: any) => { d.records[0].pageUrl = "https://evil.test/123"; },
      (d: any) => { d.records[0].quotePageUrl += "?fromZone=1"; }, (d: any) => { d.records[0].productCode = "TEST-C2"; },
      (d: any) => { d.records[0].quoteFetchedAt = NEW; }, (d: any) => { d.records[0].quoteSha256 = "a".repeat(64); },
      (d: any) => { d.records[0].stockQuantity = -1; }, (d: any) => { d.records[0].stockQuantity = 1.5; }, (d: any) => { d.records[0].stockQuantity = Number.MAX_SAFE_INTEGER + 1; },
      (d: any) => { d.records[0].stockQuantity = null; }, (d: any) => { d.records[0].collectedAt = "2026-02-30T01:00:00.123Z"; },
      (d: any) => { d.records[0].collectedAt = "2026-11-17T03:00:00.123Z"; }, (d: any) => { d.records[0].collectedAt = "2026-11-13T01:00:00.123Z"; },
      (d: any) => { d.records[0].rawExcerptSha256 = "a".repeat(64); }, (d: any) => { d.records[0].rawHtmlUnavailableReason = null; },
      (d: any) => { d.records[0].rawHtmlSha256 = "bad"; }, (d: any) => { d.records[0].captureBasis = "local-parser-time"; },
      (d: any) => { d.records[0].unitPrice = "0.00001"; }, (d: any) => { d.records[0].tiers = []; },
      (d: any) => { d.records.push(d.records[0]); }, (d: any) => { d.path = "/tmp/unsafe"; },
      (d: any) => { d.records[0].rawExcerpt += "现货：12\n"; d.records[0].rawExcerptSha256 = sha(d.records[0].rawExcerpt); },
      (d: any) => { d.records[0].stockQuantity = 8; },
    ];
    for (const change of changes) { const proof = sidecar(); change(proof); expect(await output(service(document(), proof))).toEqual(document().records[0].references); }
    const json = JSON.stringify(sidecar()).replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1');
    expect(await output(createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(document()), readIdentityBindings: async () => null, readStockEvidence: async () => json }))).toEqual(document().records[0].references);
  });
  it("rejects old quote SHA drift even if whole snapshot hash is updated, without losing the new price", async () => {
    const doc = document(), proof = sidecar(doc); doc.records[0].references.lcsc.tiers[1].unitPrice = "0.03000"; doc.records[0].references.lcsc.unitPrice = "0.03000"; doc.records[0].evidence.lcsc!.observedMaxUnitPrice = "0.03000";
    proof.snapshotSha256 = sha(JSON.stringify(doc)); const result = await output(service(doc, proof));
    expect(result.lcsc).toEqual(doc.records[0].references.lcsc); expect(result.lcsc.stockQuantity).toBeNull();
    const invalidSnapshot: any = document(); invalidSnapshot.records[0].references.lcsc.stockFetchedAt = NEW;
    expect(validateChannelReferenceSnapshot(Buffer.from(JSON.stringify(invalidSnapshot))).results.find(r => r.source === "lcsc")!.valid).toBe(false);
  });
});

describe("fixed stock evidence sibling loader", () => {
  function handle(content: string | Uint8Array, stat = { size: Buffer.byteLength(content), isFile: () => true }) {
    const bytes = Buffer.from(content), h = { stat: vi.fn(async () => stat), read: vi.fn(async (b: Buffer, off: number, len: number, pos: number) => ({ bytesRead: bytes.copy(b, off, pos, pos + len), buffer: b })), close: vi.fn(async () => {}) };
    vi.mocked(fs.open).mockResolvedValue(h as unknown as Awaited<ReturnType<typeof fs.open>>); return h;
  }
  it("uses only fixed URL and nofollow/nonblock with no production path setting", async () => {
    const h = handle(JSON.stringify(sidecar()));
    const s = createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(document()), readIdentityBindings: async () => null, stockEvidencePath: "/tmp/evil", stockEvidenceUrl: "https://evil.test/x" } as any);
    expect((await output(s)).lcsc.stockQuantity).toBe(7); expect(fs.open).toHaveBeenCalledOnce();
    expect(String(vi.mocked(fs.open).mock.calls[0][0])).toBe(new URL("./channel-reference-stock-evidence.json", import.meta.url).href);
    expect(vi.mocked(fs.open).mock.calls[0][1]).toBe(constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    expect(h.close).toHaveBeenCalledOnce(); expect(readFixedChannelReferenceStockEvidence.length).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects nonregular, oversized, empty, growing, BOM and permission/symlink errors", async () => {
    for (const stat of [{ size: 0, isFile: () => true }, { size: 512 * 1024 + 1, isFile: () => true }, { size: 1, isFile: () => false }]) {
      const h = handle("{}", stat); await expect(readFixedChannelReferenceStockEvidence()).rejects.toThrow(); expect(h.read).not.toHaveBeenCalled(); expect(h.close).toHaveBeenCalledOnce();
    }
    const growing = handle("x".repeat(512 * 1024 + 20), { size: 1, isFile: () => true }); await expect(readFixedChannelReferenceStockEvidence()).rejects.toThrow(); expect(growing.close).toHaveBeenCalledOnce();
    const broken = handle("{}"); broken.read.mockRejectedValue(new Error("read failure")); await expect(readFixedChannelReferenceStockEvidence()).rejects.toThrow(); expect(broken.close).toHaveBeenCalledOnce();
    handle(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(sidecar()))]));
    expect(await output(createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(document()), readIdentityBindings: async () => null }))).toEqual(document().records[0].references);
    for (const code of ["ELOOP", "EACCES"]) { vi.mocked(fs.open).mockRejectedValue(Object.assign(new Error("unsafe"), { code })); await expect(readFixedChannelReferenceStockEvidence()).rejects.toThrow(); }
    vi.mocked(fs.open).mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })); expect(await readFixedChannelReferenceStockEvidence()).toBeNull();
  });
});
