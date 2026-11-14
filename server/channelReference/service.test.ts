import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { createChannelReferenceService, referenceCacheKey, validCachedReference } from "./service";
import { emptyReferenceQuote, parseReferenceQuote } from "./worker";
import { allowedReferencePageUrl, publicAddress, referenceSearchUrl, robotsAllows } from "./publicPage";
import type { ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";

// Native-parent tests use inert child events only: no process/browser/network.
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(), spawn: vi.fn(),
}));
const fixture = process.env.CHANNEL_REFERENCE_FIXTURE_DIR;
const expected = { partNumber: "P-1", brand: "Brand" };
const sources: ChannelReferenceSource[] = ["lcsc", "ickey"];
const positive = (source: ChannelReferenceSource, now: number): ChannelReferenceQuote => ({ ...emptyReferenceQuote(source, "ok"), matchedPartNumber: "P-1", matchedBrand: "Brand", productCode: "C123", pageUrl: source === "lcsc" ? "https://item.szlcsc.com/123.html" : "https://www.ickey.cn/detail/123/P-1.html", stockQuantity: 3, unitPrice: "0.0008750", tierQuantity: 100, tiers: [{ minQuantity: 5, unitPrice: "0.03" }, { minQuantity: 100, unitPrice: "0.0008750" }], currency: "CNY", unit: null, fetchedAt: new Date(now).toISOString(), expiresAt: new Date(now + 20 * 60_000).toISOString(), stockInsufficientForTier: true });
const wrongIdentities = [{ matchedPartNumber: "P-2" }, { matchedPartNumber: "P-1-TR" }, { matchedBrand: "Other" }];

describe("source-only shared cache", () => {
  it("returns pending immediately, deduplicates public same-MPN jobs, keeps unrelated rows and prices", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reference-test-")); let now = Date.now();
    const fetchQuote = vi.fn(async (source: ChannelReferenceSource) => positive(source, now));
    try {
      const svc = createChannelReferenceService({ cacheDirectory: dir, fetchQuote, now: () => now });
      const materials = [{ materialId: 1, ...expected }, { materialId: 2, ...expected }];
      const first = await svc.lookup(materials); expect(first.items[0].references.lcsc.status).toBe("pending");
      await svc.idle(); expect(fetchQuote).toHaveBeenCalledTimes(2);
      const cached = await svc.lookup(materials); expect(cached.items.map(x => x.materialId)).toEqual([1, 2]);
      expect(cached.items[0].references.lcsc.unitPrice).toBe("0.0008750"); expect(cached.items[0].references.ickey.unit).toBeNull();
      await svc.lookup(materials, { refresh: true }); await svc.idle(); expect(fetchQuote).toHaveBeenCalledTimes(2);
      now += 60_001; expect((await svc.lookup(materials, { refresh: true })).items[0].references.lcsc.status).toBe("pending");
      await svc.idle(); expect(fetchQuote).toHaveBeenCalledTimes(4);
      const files = await readdir(dir); expect(files.filter(f => f.endsWith(".json"))).toHaveLength(2);
      for (const f of files) { const value = await readFile(join(dir, f), "utf8"); expect(value).not.toContain("materialId"); expect(value).not.toContain("customerId"); expect(value).not.toContain("actorUserId"); }
      now += 20 * 60_000 + 1; expect((await svc.lookup(materials)).items[0].references.lcsc.status).toBe("pending"); await svc.idle();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("never searches missing identity; rejects unsafe lists and fixed URL injection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reference-test-")); const fetchQuote = vi.fn();
    try { const s = createChannelReferenceService({ cacheDirectory: dir, fetchQuote });
      const r = await s.lookup([{ materialId: 2, partNumber: "", brand: "B" }]); expect(r.items[0].references.lcsc.status).toBe("not_found"); expect(fetchQuote).not.toHaveBeenCalled();
      await expect(s.lookup([])).rejects.toThrow(); await expect(s.lookup([{ materialId: 0, partNumber: "P", brand: "B" }])).rejects.toThrow();
      await expect(s.lookup([{ materialId: 1, partNumber: "P\n", brand: "B" }])).rejects.toThrow();
      await expect(s.lookup([{ materialId: 1, partNumber: "P", brand: "B" }, { materialId: 1, partNumber: "P", brand: "B" }])).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("rejects forged or mismatched cached price tiers, stock, dates and URLs", () => {
    const q = positive("lcsc", Date.now()); expect(validCachedReference(q, "lcsc", expected)).toBe(true);
    for (const change of [{ source: "ickey" }, { stockQuantity: -1 }, { unitPrice: "0.03" }, { tierQuantity: 5 }, { pageUrl: "https://evil.example/" }, { expiresAt: "invalid" }, { stockInsufficientForTier: false }, { message: "untrusted HTML" }, { tiers: [{ minQuantity: 100, unitPrice: "0" }] }]) expect(validCachedReference({ ...q, ...change }, "lcsc", expected)).toBe(false);
  });
  it("releases cross-instance busy jobs for a later authorized poll", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reference-test-")); let busy = true; const now = Date.now();
    try { const s = createChannelReferenceService({ cacheDirectory: dir, fetchQuote: async source => busy ? null : positive(source, now) });
      const list = [{ materialId: 1, ...expected }]; await s.lookup(list); await s.idle(); expect((await s.lookup(list)).items[0].references.lcsc.status).toBe("pending"); await s.idle();
      busy = false; await s.lookup(list); await s.idle(); expect((await s.lookup(list)).items[0].references.lcsc.status).toBe("ok");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("retains FIFO per provider and independently progresses both sources", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reference-test-")); const now = Date.now();
    const calls: string[] = []; const release = new Map<string, () => void>();
    const fetchQuote = vi.fn(async (source: ChannelReferenceSource, identity: typeof expected) => {
      const key = `${source}:${identity.partNumber}`; calls.push(key);
      await new Promise<void>(resolve => release.set(key, resolve));
      return { ...positive(source, now), matchedPartNumber: identity.partNumber };
    });
    const svc = createChannelReferenceService({ cacheDirectory: dir, fetchQuote });
    try {
      const list = [{ materialId: 1, ...expected }, { materialId: 2, ...expected, partNumber: "P-2" }];
      await svc.lookup(list); await svc.lookup(list);
      await vi.waitFor(() => expect(calls).toEqual(["lcsc:P-1", "ickey:P-1"]));
      release.get("lcsc:P-1")!();
      await vi.waitFor(() => expect(calls).toContain("lcsc:P-2"));
      expect(calls).not.toContain("ickey:P-2");
      release.get("ickey:P-1")!();
      await vi.waitFor(() => expect(calls).toContain("ickey:P-2"));
      release.get("lcsc:P-2")!(); release.get("ickey:P-2")!(); await svc.idle();
      expect(fetchQuote).toHaveBeenCalledTimes(4);
      expect((await svc.lookup(list)).items.every(item => sources.every(source => item.references[source].status === "ok"))).toBe(true);
    } finally { for (const resolve of release.values()) resolve(); await svc.idle(); await rm(dir, { recursive: true, force: true }); }
  });
});

describe("IR-02 strict cache identity", () => {
  it("v2 keys only trim raw identity, preserving width, case, separators and source", () => {
    for (const source of sources) {
      const key = referenceCacheKey(source, expected.partNumber, expected.brand);
      expect(key).toBe(createHash("sha256").update(JSON.stringify(["page-reference-v2", source, "P-1", "Brand"])).digest("hex"));
      expect(referenceCacheKey(source, " P-1 ", " Brand ")).toBe(key);
      for (const mpn of ["Ｐ-1", "P1", "P-1-TR", "p-1"]) expect(referenceCacheKey(source, mpn, "Brand")).not.toBe(key);
      for (const brand of ["Ｂrand", "brand", "Brand Other"]) expect(referenceCacheKey(source, "P-1", brand)).not.toBe(key);
      const legacy = createHash("sha256").update(JSON.stringify(["page-reference-v1", source, "P-1", "brand"])).digest("hex");
      expect(key).not.toBe(legacy);
    }
    expect(referenceCacheKey("lcsc", "P-1", "Brand")).not.toBe(referenceCacheKey("ickey", "P-1", "Brand"));
  });
  it.each(sources)("%s checks complete matched identity including non-priced metadata", source => {
    const q = positive(source, Date.now());
    expect(validCachedReference(q, source, expected)).toBe(true);
    expect(validCachedReference({ ...q, matchedPartNumber: " p-1 ", matchedBrand: " bRaNd " }, source, expected)).toBe(true);
    for (const change of [...wrongIdentities, { matchedPartNumber: "P1" }, { matchedPartNumber: null }, { matchedBrand: null }]) {
      expect(validCachedReference({ ...q, ...change }, source, expected)).toBe(false);
      expect(validCachedReference({ ...q, status: "price_unavailable", unitPrice: null, tierQuantity: null, ...change }, source, expected)).toBe(false);
    }
    expect(validCachedReference({ ...q, matchedPartNumber: "Ｐ-1" }, source, expected)).toBe(source === "lcsc");
    expect(validCachedReference({ ...q, matchedBrand: "Ｂrand" }, source, expected)).toBe(source === "lcsc");
    const negative = { ...emptyReferenceQuote(source, "not_found"), fetchedAt: q.fetchedAt, expiresAt: q.expiresAt };
    expect(validCachedReference(negative, source, expected)).toBe(true);
  });
  it("ICKey never inherits LCSC brand aliases or strips internal identity characters", () => {
    const q = { ...positive("ickey", Date.now()), matchedBrand: "muRata(村田)" };
    expect(validCachedReference(q, "ickey", { ...expected, brand: "Murata" })).toBe(false);
    for (const brand of ["BrandOther", "Brand/Other", "Brand\u200bOther"]) {
      expect(validCachedReference({ ...q, matchedBrand: brand }, "ickey", { ...expected, brand: "Brand Other" })).toBe(false);
    }
    for (const mpn of ["P-1\u200b", "P -1", "P/1"]) expect(validCachedReference({ ...q, matchedBrand: "Brand", matchedPartNumber: mpn }, "ickey", expected)).toBe(false);
  });
  it("cached P-1 never supplies the distinct fullwidth Ｐ-1 row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reference-test-")); const now = Date.now();
    const fetchQuote = vi.fn(async (source: ChannelReferenceSource, identity: typeof expected) => identity.partNumber === "P-1" ? positive(source, now) : null);
    const svc = createChannelReferenceService({ cacheDirectory: dir, fetchQuote });
    try {
      await svc.lookup([{ materialId: 1, ...expected }]); await svc.idle();
      const list = [{ materialId: 1, ...expected }, { materialId: 2, ...expected, partNumber: "Ｐ-1" }];
      const result = await svc.lookup(list); expect(result.items[0].references.ickey.status).toBe("ok");
      for (const source of sources) { expect(result.items[1].references[source].status).toBe("pending"); expect(result.items[1].references[source].unitPrice).toBeNull(); }
      await svc.idle(); expect(fetchQuote).toHaveBeenCalledTimes(4);
      expect((await readdir(dir)).filter(f => f.endsWith(".json"))).toHaveLength(2);
    } finally { await svc.idle(); await rm(dir, { recursive: true, force: true }); }
  });
  it.each(wrongIdentities)("rejects wrong matched adapter identity on write: %j", async change => {
    const dir = await mkdtemp(join(tmpdir(), "reference-test-")); const now = Date.now();
    const fetchQuote = vi.fn(async (source: ChannelReferenceSource) => ({ ...positive(source, now), ...change }));
    const svc = createChannelReferenceService({ cacheDirectory: dir, fetchQuote });
    try {
      const list = [{ materialId: 1, ...expected }]; await svc.lookup(list); await svc.idle();
      expect(fetchQuote).toHaveBeenCalledTimes(2); expect((await readdir(dir)).filter(f => f.endsWith(".json"))).toEqual([]);
      const result = await svc.lookup(list); for (const source of sources) { expect(result.items[0].references[source].status).toBe("pending"); expect(result.items[0].references[source].unitPrice).toBeNull(); }
    } finally { await svc.idle(); await rm(dir, { recursive: true, force: true }); }
  });
  it.each([...wrongIdentities, { matchedBrand: "Ｂrand" }])("ignores polluted fresh cache and refetches instead of suppressing the job: %j", async change => {
    const dir = await mkdtemp(join(tmpdir(), "reference-test-")); const now = Date.now();
    // NFKC width is allowed by LCSC, but never by ICKey.
    const pollutedSources: ChannelReferenceSource[] = "matchedBrand" in change && change.matchedBrand === "Ｂrand" ? ["ickey"] : sources;
    for (const source of pollutedSources) await writeFile(join(dir, referenceCacheKey(source, "P-1", "Brand") + ".json"), JSON.stringify({ ...positive(source, now), ...change }));
    const fetchQuote = vi.fn(async (source: ChannelReferenceSource) => positive(source, now));
    const svc = createChannelReferenceService({ cacheDirectory: dir, fetchQuote, now: () => now });
    try {
      const list = [{ materialId: 1, ...expected }]; const result = await svc.lookup(list, { refresh: true });
      for (const source of pollutedSources) { expect(result.items[0].references[source].status).toBe("pending"); expect(result.items[0].references[source].unitPrice).toBeNull(); }
      await svc.idle(); expect(fetchQuote).toHaveBeenCalledTimes(2);
      const corrected = await svc.lookup(list); for (const source of sources) { expect(corrected.items[0].references[source].status).toBe("ok"); expect(corrected.items[0].references[source].matchedBrand).toBe("Brand"); }
    } finally { await svc.idle(); await rm(dir, { recursive: true, force: true }); }
  });
  it("does not read legacy v1 JSON in an explicitly reused cache directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reference-test-")); const now = Date.now();
    for (const source of sources) {
      const legacy = createHash("sha256").update(JSON.stringify(["page-reference-v1", source, "P-1", "brand"])).digest("hex");
      await writeFile(join(dir, legacy + ".json"), JSON.stringify(positive(source, now)));
    }
    const fetchQuote = vi.fn(async () => null); const svc = createChannelReferenceService({ cacheDirectory: dir, fetchQuote });
    try { const result = await svc.lookup([{ materialId: 1, ...expected }]); for (const source of sources) expect(result.items[0].references[source].status).toBe("pending"); await svc.idle(); expect(fetchQuote).toHaveBeenCalledTimes(2); }
    finally { await svc.idle(); await rm(dir, { recursive: true, force: true }); }
  });
  it.each(wrongIdentities)("native parent rejects wrong child identity without returning valid prices: %j", async change => {
    const dir = await mkdtemp(join(tmpdir(), "reference-test-")); const now = Date.now(); const spawnMock = vi.mocked(spawn);
    spawnMock.mockImplementation(((_command: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      const source = args[args.length - 3] as ChannelReferenceSource;
      setImmediate(() => { child.stdout.emit("data", Buffer.from(JSON.stringify({ ...positive(source, now), ...change }))); child.emit("exit", 0); });
      return child;
    }) as unknown as typeof spawn);
    const svc = createChannelReferenceService({ cacheDirectory: dir, now: () => now });
    try {
      const list = [{ materialId: 1, ...expected }]; await svc.lookup(list); await svc.idle();
      expect(spawnMock).toHaveBeenCalledTimes(2);
      for (const call of spawnMock.mock.calls) {
        expect(call[0]).toBe("/usr/bin/flock"); expect(call[1]).toContain("--public-reference-page");
        expect(call[2]).toEqual({ detached: true, stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", HOME: tmpdir(), LANG: "C.UTF-8" } });
      }
      const result = await svc.lookup(list);
      for (const source of sources) { const quote = result.items[0].references[source]; expect(quote.status).toBe("unavailable"); expect(quote.unitPrice).toBeNull(); expect(quote.matchedPartNumber).toBeNull(); }
    } finally { await svc.idle(); spawnMock.mockReset(); await rm(dir, { recursive: true, force: true }); }
  });
});

describe("fixed webpage and robots boundary", () => {
  it("retains exact part-number suffixes and query escaping", () => { const u = new URL(referenceSearchUrl("lcsc", "A/B#C+1")); expect(u.searchParams.get("k")).toBe("A/B#C+1"); expect(allowedReferencePageUrl("lcsc", u.href)).toBe(true); });
  it("only permits the observed source pages, never login/order/arbitrary URLs", () => {
    for (const u of ["http://item.szlcsc.com/123.html", "https://evil.example/123.html", "https://item.szlcsc.com:444/123.html", "https://user@item.szlcsc.com/123.html", "https://item.szlcsc.com/123.html?k=x", "https://so.szlcsc.com/member/", "https://so.szlcsc.com/global.html?k=P&url=https://localhost/", "https://www.ickey.cn/indent/index?sku=123"]) expect(allowedReferencePageUrl("lcsc", u)).toBe(false);
    expect(allowedReferencePageUrl("ickey", "https://search.ickey.cn/?keyword=P")).toBe(true); expect(allowedReferencePageUrl("ickey", "https://passport.ickey.cn/login")).toBe(false);
  });
  it("does not apply one subdomain's rules to another and honors longest allows", () => {
    expect(robotsAllows("User-agent: *\nDisallow: /member/", "https://so.szlcsc.com/global.html?k=P")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /*?*", "https://www.szlcsc.com/?k=P")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /\nAllow: /safe/", "https://x.example/safe/page")).toBe(true);
    expect(robotsAllows("User-agent: *\nAllow: /\nUser-agent: 51Dianzi-ChannelReference\nDisallow: /", "https://x.example/page")).toBe(false);
  });
  it("rejects private, metadata, loopback and mapped IPs", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "169.254.169.254", "172.16.2.4", "192.168.1.2", "100.64.1.1", "::1", "::ffff:127.0.0.1", "224.1.2.3"]) expect(publicAddress(ip)).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
  });
});

describe("real webpage adapter evidence", () => {
  it.skipIf(!fixture)("selects LCSC largest quantity tier, not SMT stock or the lowest unrelated price", async () => {
    const html = await readFile(join(fixture!, "lcsc-rendered-search-grm32eb31c476ke15l.html"), "utf8");
    const q = parseReferenceQuote("lcsc", html, referenceSearchUrl("lcsc", "GRM32EB31C476KE15L"), { partNumber: "GRM32EB31C476KE15L", brand: "Murata" });
    expect(q.status).toBe("ok"); expect(q.stockQuantity).toBe(35); expect(q.unitPrice).toBe("1.6757"); expect(q.tierQuantity).toBe(150); expect(q.taxStatus).toBe("included"); expect(q.stockInsufficientForTier).toBe(true);
  });
  it.skipIf(!fixture)("selects exact ICKey SKU and keeps unknown unit without guessing", async () => {
    const html = await readFile(join(fixture!, "ickey-local-headless-csa1210.html"), "utf8");
    const q = parseReferenceQuote("ickey", html, referenceSearchUrl("ickey", "CSA1210X5R476K160RT"), { partNumber: "CSA1210X5R476K160RT", brand: "HRE/江苏芯声" });
    expect(q.status).toBe("ok"); expect(q.stockQuantity).toBe(5000); expect(q.unitPrice).toBe("0.3026"); expect(q.tierQuantity).toBe(39000); expect(q.unit).toBeNull(); expect(q.taxStatus).toBe("unknown"); expect(q.stockInsufficientForTier).toBe(true);
  });
  it.skipIf(!fixture)("real muRata(村田) aliases/case survive service write and cache hit; wrong full MPN does not", async () => {
    const html = await readFile(join(fixture!, "lcsc-rendered-search-grm32eb31c476ke15l.html"), "utf8"); const now = Date.now();
    expect(createHash("sha256").update(html).digest("hex")).toBe("44114438a55361853364c3c3e7e30f7e0829021e907acda5498e6b04a5f7ec97");
    const dir = await mkdtemp(join(tmpdir(), "reference-test-"));
    const fetchQuote = vi.fn(async (source: ChannelReferenceSource, identity: typeof expected) => source === "lcsc" ? parseReferenceQuote(source, html, referenceSearchUrl(source, identity.partNumber), identity, new Date(now).toISOString()) : null);
    const svc = createChannelReferenceService({ cacheDirectory: dir, fetchQuote });
    try {
      for (const brand of ["Murata", "muRata", "muRata(村田)", "村田"]) {
        const identity = { partNumber: "GRM32EB31C476KE15L", brand }; const list = [{ materialId: 1, ...identity }];
        await svc.lookup(list); await svc.idle(); const quote = (await svc.lookup(list)).items[0].references.lcsc;
        expect(quote.status).toBe("ok"); expect(quote.matchedBrand).toBe("muRata(村田)"); expect(quote.unitPrice).toBe("1.6757");
        expect(validCachedReference(quote, "lcsc", identity)).toBe(true);
        expect(validCachedReference(quote, "lcsc", { ...identity, partNumber: identity.partNumber + "-TR" })).toBe(false);
        expect(validCachedReference(quote, "lcsc", { ...identity, brand: "Murata Electronics" })).toBe(false);
      }
    } finally { await svc.idle(); await rm(dir, { recursive: true, force: true }); }
  });
  it.skipIf(!fixture)("real HRE/江苏芯声 preserves complete brand, case and strict ICKey MPN through service", async () => {
    const html = await readFile(join(fixture!, "ickey-local-headless-csa1210.html"), "utf8"); const now = Date.now();
    expect(createHash("sha256").update(html).digest("hex")).toBe("defac4e01f34152b46612052477f122a51bb4318699d18144361c3413d3395f4");
    const dir = await mkdtemp(join(tmpdir(), "reference-test-"));
    const fetchQuote = vi.fn(async (source: ChannelReferenceSource, identity: typeof expected) => source === "ickey" ? parseReferenceQuote(source, html, referenceSearchUrl(source, identity.partNumber), identity, new Date(now).toISOString()) : null);
    const svc = createChannelReferenceService({ cacheDirectory: dir, fetchQuote });
    try {
      for (const brand of ["HRE/江苏芯声", "hre/江苏芯声"]) {
        const identity = { partNumber: "CSA1210X5R476K160RT", brand }; const list = [{ materialId: 1, ...identity }];
        await svc.lookup(list); await svc.idle(); const quote = (await svc.lookup(list)).items[0].references.ickey;
        expect(quote.status).toBe("ok"); expect(quote.matchedBrand).toBe("HRE/江苏芯声"); expect(quote.unitPrice).toBe("0.3026"); expect(quote.unit).toBeNull(); expect(quote.taxStatus).toBe("unknown");
        expect(validCachedReference(quote, "ickey", identity)).toBe(true);
        for (const wrongBrand of ["HRE", "江苏芯声", "HRE /江苏芯声", "ＨＲＥ/江苏芯声"]) expect(validCachedReference(quote, "ickey", { ...identity, brand: wrongBrand })).toBe(false);
        for (const wrongMpn of [identity.partNumber + "-TR", "ＣSA1210X5R476K160RT", identity.partNumber.slice(0, -1)]) expect(validCachedReference(quote, "ickey", { ...identity, partNumber: wrongMpn })).toBe(false);
      }
    } finally { await svc.idle(); await rm(dir, { recursive: true, force: true }); }
  });
});

describe("approved directed brand cache identities", () => {
  it.each(sources)("%s accepts XKB's exact approved whole literal, preserving quote identity", source => {
    const q = { ...positive(source, Date.now()), matchedBrand: "XKB Connection/中国星坤" };
    expect(validCachedReference(q, source, { ...expected, brand: "XKB" })).toBe(true);
    for (const brand of ["XKB Other/中国星坤", "XKB Connection/中国星坤/Other", "XKB Connection"]) {
      expect(validCachedReference({ ...q, matchedBrand: brand }, source, { ...expected, brand: "XKB" })).toBe(false);
    }
    expect(q.matchedBrand).toBe("XKB Connection/中国星坤");
    expect(validCachedReference({ ...q, matchedBrand: "ST(先科)" }, source, { ...expected, brand: "ST" })).toBe(false);
    expect(validCachedReference({ ...q, matchedBrand: "CJ/江苏长晶(长电)" }, source, { ...expected, brand: "JSCJ" })).toBe(false);
    for (const mpn of ["P-1-TR", "P/1", "P -1"]) expect(validCachedReference({ ...q, matchedPartNumber: mpn }, source, { ...expected, brand: "XKB" })).toBe(false);
  });
});
