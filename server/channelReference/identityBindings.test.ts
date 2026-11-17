import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";
import { channelReferenceQuoteSha256, createChannelReferenceSnapshotService, type ChannelReferenceSnapshotDocument, type ChannelReferenceSnapshotEvidence, type ChannelReferenceStockEvidenceDocument } from "./snapshot";
import { ChannelReferenceIdentityBindingsUnavailableError, parseChannelReferenceIdentityBindings, readFixedChannelReferenceIdentityBindings, type ChannelReferenceIdentityBindingsDocument } from "./identityBindings";
import { channelReferenceLookupResult, channelReferencePrice } from "../../client/src/business/platform/client/src/pages/channelReferenceModel";

vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(), open: vi.fn(),
}));
const NOW = Date.parse("2026-11-17T05:00:00.000Z");
const TIME = "2026-11-16T05:00:00.000Z";
// Entirely synthetic: these fixtures do not authorize any real manufacturer mapping.
const raw = { partNumber: "TEST-MPN-12345(独立中文颜色/参数说明)", brand: "发光二极管" };
const canonical = { partNumber: "TEST-MPN-12345", brand: "FixtureManufacturer" };
const material = () => [{ materialId: 7, ...raw }];
function empty(source: ChannelReferenceSource, status: ChannelReferenceQuote["status"] = "not_found"): ChannelReferenceQuote {
  return { source, status, matchedPartNumber: null, matchedBrand: null, productCode: null, pageUrl: null, stockQuantity: null, unitPrice: null, tierQuantity: null, tiers: [], currency: null, unit: null, taxStatus: "unknown", packaging: null, fetchedAt: null, expiresAt: null, stockInsufficientForTier: false, message: null };
}
function positive(source: ChannelReferenceSource, identity = canonical): ChannelReferenceQuote {
  return { ...empty(source, "ok"), matchedPartNumber: identity.partNumber, matchedBrand: identity.brand, productCode: "TEST-C1", pageUrl: source === "lcsc" ? "https://item.szlcsc.com/123.html" : "https://www.ickey.cn/detail/123/TEST-MPN-12345.html", stockQuantity: 33, unitPrice: "0.01000", tierQuantity: 100, tiers: [{ minQuantity: 1, unitPrice: "0.02000" }, { minQuantity: 100, unitPrice: "0.01000" }], currency: "CNY", fetchedAt: TIME, stockInsufficientForTier: true };
}
function evidence(q: ChannelReferenceQuote, identity = canonical): ChannelReferenceSnapshotEvidence {
  return { expectedPartNumber: identity.partNumber, observedPartNumber: q.matchedPartNumber!, expectedBrand: identity.brand, observedBrand: q.matchedBrand!, brandMatch: "exact", literalReason: null, pageUrl: q.pageUrl!, collectedAt: q.fetchedAt!, observedMaxQuantity: q.tierQuantity!, observedMaxUnitPrice: q.unitPrice!, maxTierConfirmed: true };
}
function document(): ChannelReferenceSnapshotDocument {
  const lcsc = positive("lcsc"), ickey = positive("ickey");
  return { schemaVersion: 1, collectionMode: "public-web-batch", generatedAt: TIME, records: [
    { ...raw, references: { lcsc: empty("lcsc", "ambiguous"), ickey: empty("ickey", "price_unavailable") }, evidence: { lcsc: null, ickey: null } },
    { ...canonical, references: { lcsc, ickey }, evidence: { lcsc: evidence(lcsc), ickey: evidence(ickey) } },
  ] };
}
const sha = (content: string | Uint8Array) => createHash("sha256").update(content).digest("hex");
function bindings(content = JSON.stringify(document())): ChannelReferenceIdentityBindingsDocument {
  return { schemaVersion: 1, snapshotSha256: sha(content), bindings: [{ raw: { ...raw }, canonical: { ...canonical }, sources: ["lcsc"], confirmation: { reviewVersion: "synthetic-test-v1", manufacturerSpecificCompleteMpn: true, uniqueManufacturer: true, additionalSpecificationsMatch: true, basis: "Synthetic test only: full MPN, one manufacturer and all attached specifications explicitly confirmed." } }] };
}
function service(doc = document(), mapping: unknown = bindings(JSON.stringify(doc))) {
  return createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(doc), readIdentityBindings: async () => mapping === null ? null : JSON.stringify(mapping) });
}
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(NOW); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); })); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("finite audited raw-to-canonical enrichment", () => {
  it("shows the exact permitted source, preserving raw outer fields and real matched identity", async () => {
    const readSnapshot = vi.fn(async () => Buffer.from(JSON.stringify(document())));
    const readIdentityBindings = vi.fn(async () => Buffer.from(JSON.stringify(bindings())));
    const s = createChannelReferenceSnapshotService({ readSnapshot, readIdentityBindings });
    const input = [{ ...material()[0], privateStock: 99, path: "/tmp/unapproved.json" }];
    const result = await s.lookup(input, { refresh: true });
    expect(result.items[0]).toEqual({ materialId: 7, ...raw, references: { lcsc: positive("lcsc"), ickey: empty("ickey", "price_unavailable") } });
    expect(channelReferenceLookupResult(result, [{ id: 7, ...raw }])).toEqual(result);
    expect(channelReferencePrice(result.items[0].references.lcsc)).toBe("0.01000，库存33");
    expect(readSnapshot).toHaveBeenCalledWith(); expect(readIdentityBindings).toHaveBeenCalledWith();
    expect(fs.open).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
    result.items[0].references.lcsc.tiers[1].unitPrice = "999";
    expect((await s.lookup(material())).items[0].references.lcsc).toEqual(positive("lcsc"));
  });
  it("never overrides or rewrites an original ok quote while filling the other source", async () => {
    const doc = document(), original = positive("lcsc", raw);
    Object.assign(original, { stockQuantity: 2, stockInsufficientForTier: true, unit: "原包装单位" });
    doc.records[0].references.lcsc = original; doc.records[0].evidence.lcsc = evidence(original, raw);
    const map = bindings(JSON.stringify(doc)); map.bindings[0].sources = ["lcsc", "ickey"];
    expect((await service(doc, map).lookup(material())).items[0].references).toEqual({ lcsc: original, ickey: positive("ickey") });
    const broken = service(doc, { schemaVersion: 999 });
    expect((await broken.lookup(material())).items[0].references).toEqual(doc.records[0].references);
  });
  it("skips binding IO entirely if every original requested source is ok", async () => {
    const readIdentityBindings = vi.fn(async () => { throw new Error("should not read"); });
    const s = createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(document()), readIdentityBindings });
    expect((await s.lookup([{ materialId: 8, ...canonical }])).items[0].references).toEqual(document().records[1].references);
    expect(readIdentityBindings).not.toHaveBeenCalled();
  });
  it("does not infer a manufacturer for generic or related literals without explicit bindings", async () => {
    const doc = document();
    for (const pn of ["FR107W", "SS26", "MAX809"]) {
      for (const brand of ["FixtureManufacturer", "OtherFixtureManufacturer"]) {
        const identity = { partNumber: pn, brand }, lcsc = positive("lcsc", identity), ickey = positive("ickey", identity);
        doc.records.push({ ...identity, references: { lcsc, ickey }, evidence: { lcsc: evidence(lcsc, identity), ickey: evidence(ickey, identity) } });
      }
    }
    const inputs = ["FR107W", "SS26", "MAX809", canonical.partNumber, "TEST-MPN-12345(另一个颜色)", "TEST-MPN-123", "test-mpn-12345(独立中文颜色/参数说明)"].map((partNumber, i) => ({ materialId: i + 1, partNumber, brand: raw.brand }));
    const result = await service(doc, bindings(JSON.stringify(doc))).lookup(inputs);
    expect(result.items.every(item => item.references.lcsc.status === "not_found" && item.references.ickey.status === "not_found")).toBe(true);
  });
  it("does not broaden raw brand/case/whitespace, concatenate identities or chain bindings", async () => {
    const inputs = [
      { partNumber: raw.partNumber, brand: raw.brand + " " },
      { partNumber: " " + raw.partNumber, brand: raw.brand },
      { partNumber: raw.partNumber.toLowerCase(), brand: raw.brand },
      { partNumber: raw.partNumber + raw.brand, brand: "" },
    ].map((identity, i) => ({ materialId: i + 1, ...identity }));
    expect((await service().lookup(inputs)).items.every(i => i.references.lcsc.status === "not_found")).toBe(true);
    const map = bindings(); map.bindings[0].canonical = { partNumber: "INTERMEDIATE-TEST", brand: "FixtureManufacturer" };
    map.bindings.push({ ...structuredClone(map.bindings[0]), raw: { ...map.bindings[0].canonical }, canonical: { ...canonical } });
    expect((await service(document(), map).lookup(material())).items[0].references).toEqual(document().records[0].references);
  });
  it("rejects a changed quote or evidence even if the new snapshot quote is independently valid", async () => {
    const doc = document(), map = bindings();
    doc.records[1].references.lcsc.stockQuantity = 34;
    expect((await service(doc, map).lookup(material())).items[0].references).toEqual(doc.records[0].references);
    doc.records[1].evidence.lcsc!.observedMaxUnitPrice = "0.009";
    const rehashed = bindings(JSON.stringify(doc));
    expect((await service(doc, rehashed).lookup(material())).items[0].references).toEqual(doc.records[0].references);
  });
  it("still uses the original strict canonical quote/evidence validator, including source and complete MPN", async () => {
    for (const change of [{ source: "ickey" }, { matchedPartNumber: "TEST-MPN-123" }, { matchedBrand: "OtherFixtureManufacturer" }]) {
      const doc = document(); Object.assign(doc.records[1].references.lcsc, change);
      doc.records[1].evidence.lcsc = evidence(doc.records[1].references.lcsc);
      expect((await service(doc, bindings(JSON.stringify(doc))).lookup(material())).items[0].references).toEqual(doc.records[0].references);
    }
    const doc = document(); doc.records[1].references.lcsc = empty("lcsc"); doc.records[1].evidence.lcsc = null;
    expect((await service(doc, bindings(JSON.stringify(doc))).lookup(material())).items[0].references).toEqual(doc.records[0].references);
  });
  it("does not retain good mappings after corruption, deletion or read errors, and recovers", async () => {
    let content: string | Uint8Array | null = JSON.stringify(bindings());
    let failure: Error | undefined;
    const s = createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(document()), readIdentityBindings: async () => { if (failure) throw failure; return content; } });
    expect((await s.lookup(material())).items[0].references.lcsc.status).toBe("ok");
    for (const next of ["{", null, new Uint8Array([0xff]), "", "x".repeat(512 * 1024 + 1)]) {
      content = next; expect((await s.lookup(material())).items[0].references).toEqual(document().records[0].references);
    }
    content = JSON.stringify(bindings()); failure = Object.assign(new Error("missing"), { code: "ENOENT" });
    expect((await s.lookup(material())).items[0].references).toEqual(document().records[0].references);
    failure = new Error("EACCES"); expect((await s.lookup(material())).items[0].references).toEqual(document().records[0].references);
    failure = undefined; expect((await s.lookup(material())).items[0].references.lcsc).toEqual(positive("lcsc"));
  });
  it("captures approved input before a delayed mapping read and never leaks runtime-added fields", async () => {
    let release!: (value: string) => void;
    const readIdentityBindings = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const s = createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(document()), readIdentityBindings });
    const input = material(), promise = s.lookup(input);
    await vi.waitFor(() => expect(readIdentityBindings).toHaveBeenCalledOnce());
    input[0].materialId = 999; input[0].brand = "Other"; input[0].partNumber = "Other"; input.push({ materialId: 8, ...canonical });
    release(JSON.stringify(bindings()));
    expect((await promise).items).toEqual([{ materialId: 7, ...raw, references: { lcsc: positive("lcsc"), ickey: empty("ickey", "price_unavailable") } }]);
  });
  it("a late good read cannot resurrect bindings after a newer lookup sees deletion", async () => {
    let release!: (value: string) => void;
    const readIdentityBindings = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve; })).mockResolvedValue(null);
    const s = createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(document()), readIdentityBindings });
    const late = s.lookup(material()); await vi.waitFor(() => expect(readIdentityBindings).toHaveBeenCalledOnce());
    expect((await s.lookup(material())).items[0].references).toEqual(document().records[0].references);
    release(JSON.stringify(bindings())); expect((await late).items[0].references).toEqual(document().records[0].references);
    expect((await s.lookup(material())).items[0].references).toEqual(document().records[0].references);
  });
  it.each(["deleted", "corrupt", "stale"] as const)("accepted mapping waiting for stock cannot resurrect after newer lookup sees %s", async invalidation => {
    const doc = document(), originalIdentity = { partNumber: "TEST-ORIGINAL-PRICE", brand: "FixtureManufacturer" };
    const mapped = doc.records[1].references.lcsc;
    mapped.stockQuantity = null; mapped.stockInsufficientForTier = false;
    const original = positive("lcsc", originalIdentity);
    original.stockQuantity = null; original.stockInsufficientForTier = false;
    doc.records.push({ ...originalIdentity, references: { lcsc: original, ickey: empty("ickey") }, evidence: { lcsc: evidence(original, originalIdentity), ickey: null } });
    const content = JSON.stringify(doc), map = JSON.stringify(bindings(content)), before = JSON.stringify(doc);
    const collectedAt = "2026-11-17T04:00:00.123Z";
    const stock: ChannelReferenceStockEvidenceDocument = { schemaVersion: 1, collectionMode: "public-web-batch", generatedAt: collectedAt, snapshotSha256: sha(content), records: [
      [canonical, mapped], [originalIdentity, original],
    ].map(([identity, q]) => {
      const i = identity as typeof canonical, quote = q as ChannelReferenceQuote, rawExcerpt = `${i.partNumber}\n品牌名称：${i.brand}\n现货：7\n`;
      return { ...i, source: "lcsc" as const, quoteSha256: channelReferenceQuoteSha256(quote), productCode: quote.productCode, quotePageUrl: quote.pageUrl!, quoteFetchedAt: quote.fetchedAt!, observedPartNumber: i.partNumber, observedBrand: i.brand, stockQuantity: 7, pageUrl: quote.pageUrl!, collectedAt, captureBasis: "actual-public-page-read" as const, captureReason: "Synthetic combined interleaving fixture only.", rawExcerpt, rawExcerptSha256: sha(rawExcerpt), rawHtmlSha256: null, rawHtmlUnavailableReason: "Synthetic excerpt only." };
    }) };
    const input = [...material(), { materialId: 8, ...originalIdentity }];
    // Prove the exact fixture would otherwise select canonical and accept both stock proofs.
    const control = createChannelReferenceSnapshotService({ readSnapshot: async () => content, readIdentityBindings: async () => map, readStockEvidence: async () => JSON.stringify(stock) });
    const enriched = await control.lookup(input);
    expect(enriched.items[0].references.lcsc).toMatchObject({ status: "ok", matchedPartNumber: canonical.partNumber, stockQuantity: 7 });
    expect(enriched.items[1].references.lcsc.stockQuantity).toBe(7);
    let release!: (value: string) => void;
    const invalid = invalidation === "deleted" ? null : invalidation === "corrupt" ? "{" : JSON.stringify({ ...bindings(content), snapshotSha256: "a".repeat(64) });
    const readIdentityBindings = vi.fn().mockResolvedValueOnce(map).mockResolvedValue(invalid);
    const readStockEvidence = vi.fn().mockImplementationOnce(() => new Promise<string>(resolve => { release = resolve; })).mockResolvedValue(null);
    const s = createChannelReferenceSnapshotService({ readSnapshot: async () => content, readIdentityBindings, readStockEvidence });
    const late = s.lookup(input);
    await vi.waitFor(() => expect(readStockEvidence).toHaveBeenCalledOnce()); // A accepted mapping, now at final await.
    const expected = [{ materialId: 7, ...raw, references: doc.records[0].references }, { materialId: 8, ...originalIdentity, references: doc.records[2].references }];
    expect((await s.lookup(input)).items).toEqual(expected); // B completes invalidation before A resumes.
    release(JSON.stringify(stock));
    const result = await late;
    expect(result.items).toEqual(expected); // Neither canonical success nor either stock proof revives.
    expect(result.items[0].references.lcsc.status).toBe("ambiguous");
    expect(result.items[1].references.lcsc).toEqual(original); // Original successful price/tier/time untouched.
    expect(JSON.stringify(doc)).toBe(before);
    result.items[1].references.lcsc.tiers[1].unitPrice = "999";
    expect((await s.lookup(input)).items).toEqual(expected); // Returned clone does not mutate original raw price.
    expect(fs.open).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("invalid approved materials never trigger snapshot or binding reads", async () => {
    const readSnapshot = vi.fn(), readIdentityBindings = vi.fn();
    const s = createChannelReferenceSnapshotService({ readSnapshot, readIdentityBindings });
    await expect(s.lookup([{ materialId: 0, ...raw }])).rejects.toThrow("Invalid approved reference materials");
    expect(readSnapshot).not.toHaveBeenCalled(); expect(readIdentityBindings).not.toHaveBeenCalled();
  });
});

describe("strict binding schema", () => {
  it("rejects duplicate raw identity even when split by source, and duplicate escaped JSON keys", () => {
    const map = bindings(); map.bindings.push({ ...structuredClone(map.bindings[0]), sources: ["ickey"] });
    expect(() => parseChannelReferenceIdentityBindings(JSON.stringify(map), bindings().snapshotSha256)).toThrow(ChannelReferenceIdentityBindingsUnavailableError);
    const json = JSON.stringify(bindings());
    for (const duplicate of [json.replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1'), json.replace('"sources":["lcsc"]', '"sources":["lcsc"],"sources":["ickey"]')]) {
      expect(() => parseChannelReferenceIdentityBindings(duplicate, bindings().snapshotSha256)).toThrow(ChannelReferenceIdentityBindingsUnavailableError);
    }
  });
  it("rejects mismatch, wildcard, unauthorized source, missing audit, extra fields and wrong limits", async () => {
    const changes = [
      (m: any) => { m.schemaVersion = 2; }, (m: any) => { m.snapshotSha256 = "a".repeat(64); },
      (m: any) => { m.path = "/tmp/arbitrary.json"; }, (m: any) => { m.bindings[0].sources = ["lcsc", "lcsc"]; },
      (m: any) => { m.bindings[0].sources = ["other"]; }, (m: any) => { m.bindings[0].sources = []; },
      (m: any) => { m.bindings[0].canonical.partNumber = "TEST-MPN-*"; }, (m: any) => { m.bindings[0].canonical.partNumber = "^TEST-MPN"; },
      (m: any) => { m.bindings[0].canonical.partNumber = "TEST-MPN-12345(说明)"; },
      (m: any) => { m.bindings[0].canonical.brand = "FixtureManufacturer "; },
      (m: any) => { m.bindings[0].canonical.brand = ""; }, (m: any) => { m.bindings[0].canonical = { ...raw }; },
      (m: any) => { m.bindings[0].confirmation.uniqueManufacturer = false; },
      (m: any) => { m.bindings[0].confirmation.manufacturerSpecificCompleteMpn = false; },
      (m: any) => { m.bindings[0].confirmation.additionalSpecificationsMatch = false; },
      (m: any) => { m.bindings[0].confirmation.basis = ""; }, (m: any) => { m.bindings[0].confirmation.reviewVersion = ""; },
      (m: any) => { m.bindings[0].confirmation.extra = true; }, (m: any) => { m.bindings = Array.from({ length: 501 }, (_, i) => ({ ...m.bindings[0], raw: { partNumber: `TEST-${i}`, brand: raw.brand } })); },
    ];
    for (const change of changes) {
      const map = bindings(); change(map);
      expect(() => parseChannelReferenceIdentityBindings(JSON.stringify(map), bindings().snapshotSha256)).toThrow(ChannelReferenceIdentityBindingsUnavailableError);
      expect((await service(document(), map).lookup(material())).items[0].references).toEqual(document().records[0].references);
    }
  });
  it("does not weaken the existing snapshot schema or snapshot-unavailable errors", async () => {
    const doc = { ...document(), schemaVersion: 2 };
    const readIdentityBindings = vi.fn(async () => JSON.stringify(bindings()));
    await expect(createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(doc), readIdentityBindings }).lookup(material())).rejects.toThrow("snapshot unavailable");
    expect(readIdentityBindings).not.toHaveBeenCalled();
  });
});

describe("fixed read-only sibling binding file", () => {
  function handle(content: string | Uint8Array, stat = { size: Buffer.byteLength(content), isFile: () => true }) {
    const bytes = Buffer.from(content), h = { stat: vi.fn(async () => stat), read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => ({ bytesRead: bytes.copy(buffer, offset, position, position + length), buffer })), close: vi.fn(async () => {}) };
    vi.mocked(fs.open).mockResolvedValue(h as unknown as Awaited<ReturnType<typeof fs.open>>); return h;
  }
  it("uses only the fixed sibling and ignores runtime path/URL settings in the old lookup method", async () => {
    const h = handle(JSON.stringify(bindings()));
    const s = createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(document()), identityBindingsPath: "/tmp/not-approved.json", identityBindingsUrl: "https://evil.example/map" } as Parameters<typeof createChannelReferenceSnapshotService>[0]);
    const result = await s.lookup(material(), { refresh: true, path: "/tmp/not-approved.json", url: "https://evil.example/map" } as { refresh?: boolean });
    expect(result.items[0].references.lcsc).toEqual(positive("lcsc"));
    expect(fs.open).toHaveBeenCalledOnce(); const [url, flags] = vi.mocked(fs.open).mock.calls[0];
    expect(String(url)).toBe(new URL("./channel-reference-identity-bindings.json", import.meta.url).href);
    expect(flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); expect(h.close).toHaveBeenCalledOnce();
    expect(readFixedChannelReferenceIdentityBindings.length).toBe(0); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each([{ size: 0, isFile: () => true }, { size: 512 * 1024 + 1, isFile: () => true }, { size: 2, isFile: () => false }])("rejects empty/oversize/nonregular file before reading %#", async stat => {
    const h = handle("{}", stat); await expect(readFixedChannelReferenceIdentityBindings()).rejects.toThrow("identity bindings unavailable");
    expect(h.read).not.toHaveBeenCalled(); expect(h.close).toHaveBeenCalledOnce();
  });
  it("bounds a growing file and closes on read failure", async () => {
    let h = handle("x".repeat(512 * 1024 + 100), { size: 1, isFile: () => true });
    await expect(readFixedChannelReferenceIdentityBindings()).rejects.toThrow("identity bindings unavailable");
    expect(h.read.mock.calls[0][2]).toBe(512 * 1024 + 1); expect(h.close).toHaveBeenCalledOnce();
    h = handle("{}"); h.read.mockRejectedValue(new Error("read failure"));
    await expect(readFixedChannelReferenceIdentityBindings()).rejects.toThrow(); expect(h.close).toHaveBeenCalledOnce();
  });
  it("only actual ENOENT means absent; symlink and permission failures are rejected", async () => {
    vi.mocked(fs.open).mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    expect(await readFixedChannelReferenceIdentityBindings()).toBeNull();
    for (const code of ["ELOOP", "EACCES"]) {
      vi.mocked(fs.open).mockRejectedValue(Object.assign(new Error("unsafe"), { code }));
      await expect(readFixedChannelReferenceIdentityBindings()).rejects.toThrow("identity bindings unavailable");
    }
  });
  it("rejects malformed UTF-8 and BOM rather than treating them as a valid mapping", async () => {
    for (const bytes of [new Uint8Array([0xff, 0xfe]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(bindings()))])]) {
      handle(bytes);
      expect((await createChannelReferenceSnapshotService({ readSnapshot: async () => JSON.stringify(document()) }).lookup(material())).items[0].references).toEqual(document().records[0].references);
    }
  });
});
