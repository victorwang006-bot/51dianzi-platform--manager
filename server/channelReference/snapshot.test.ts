import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as childProcess from "node:child_process";
import type { ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";
import { ChannelReferenceSnapshotUnavailableError, createChannelReferenceSnapshotService, type ChannelReferenceSnapshotDocument, type ChannelReferenceSnapshotEvidence } from "./snapshot";

vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  open: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), rename: vi.fn(), lstat: vi.fn(), readdir: vi.fn(), unlink: vi.fn(), rm: vi.fn(),
}));
vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(), spawn: vi.fn(), exec: vi.fn(), execFile: vi.fn(), fork: vi.fn(),
}));
const NOW = Date.parse("2026-11-14T09:03:00.000Z");
const GENERATED = "2026-11-14T09:00:00.000Z";
const COLLECTED = "2026-11-14T08:00:00.000Z";
const expected = { partNumber: "P-1-TR", brand: "Murata" };
const materials = () => [{ materialId: 1, ...expected }];
const sources: ChannelReferenceSource[] = ["lcsc", "ickey"];
function empty(source: ChannelReferenceSource, status: ChannelReferenceQuote["status"] = "not_found"): ChannelReferenceQuote {
  return { source, status, matchedPartNumber: null, matchedBrand: null, productCode: null, pageUrl: null, stockQuantity: null, unitPrice: null, tierQuantity: null, tiers: [], currency: null, unit: null, taxStatus: "unknown", packaging: null, fetchedAt: null, expiresAt: null, stockInsufficientForTier: false, message: null };
}
function positive(source: ChannelReferenceSource): ChannelReferenceQuote {
  return { ...empty(source, "ok"), matchedPartNumber: expected.partNumber, matchedBrand: expected.brand, productCode: "C123", pageUrl: source === "lcsc" ? "https://item.szlcsc.com/123.html" : "https://www.ickey.cn/detail/123/P-1-TR.html", stockQuantity: 3, unitPrice: "0.0008750", tierQuantity: 100, tiers: [{ minQuantity: 5, unitPrice: "0.03" }, { minQuantity: 100, unitPrice: "0.0008750" }], currency: "CNY", fetchedAt: COLLECTED, stockInsufficientForTier: true };
}
function evidence(q: ChannelReferenceQuote, identity = expected): ChannelReferenceSnapshotEvidence {
  return { expectedPartNumber: identity.partNumber, observedPartNumber: q.matchedPartNumber!, expectedBrand: identity.brand, observedBrand: q.matchedBrand!, brandMatch: "exact", literalReason: null, pageUrl: q.pageUrl!, collectedAt: q.fetchedAt!, observedMaxQuantity: q.tierQuantity!, observedMaxUnitPrice: q.unitPrice!, maxTierConfirmed: true };
}
function document(): ChannelReferenceSnapshotDocument {
  const lcsc = positive("lcsc"), ickey = positive("ickey");
  return { schemaVersion: 1, collectionMode: "public-web-batch", generatedAt: GENERATED, records: [{ ...expected, references: { lcsc, ickey }, evidence: { lcsc: evidence(lcsc), ickey: evidence(ickey) } }] };
}
function service(doc: unknown) { return createChannelReferenceSnapshotService({ readSnapshot: vi.fn(async () => JSON.stringify(doc)) }); }
async function quote(doc: unknown, source: ChannelReferenceSource = "lcsc") { return (await service(doc).lookup(materials())).items[0].references[source]; }
function changeQuote(change: Record<string, unknown>, source: ChannelReferenceSource = "lcsc", syncEvidence = false) {
  const doc = document(); Object.assign(doc.records[0].references[source], change);
  if (syncEvidence) doc.records[0].evidence[source] = evidence(doc.records[0].references[source]);
  return doc;
}
function brandDocument(rawBrand: string, observed: string, brandMatch: ChannelReferenceSnapshotEvidence["brandMatch"] = "explicit_alias", literalReason: string | null = observed) {
  const doc = document(); doc.records[0].brand = rawBrand;
  const q = doc.records[0].references.lcsc; q.matchedBrand = observed;
  doc.records[0].evidence.lcsc = { ...evidence(q, { ...expected, brand: rawBrand }), brandMatch, literalReason };
  return doc;
}
async function brandQuote(rawBrand: string, observed: string, brandMatch: ChannelReferenceSnapshotEvidence["brandMatch"] = "explicit_alias", literalReason: string | null = observed) {
  return (await service(brandDocument(rawBrand, observed, brandMatch, literalReason)).lookup([{ materialId: 1, ...expected, brand: rawBrand }])).items[0].references.lcsc;
}
// Finite public-brand fixture copied from the actual 2026-11-14 pairs, no prices.
// Geehy's two complete Chinese names have NOT been proven equivalent.
const actualBrandCases = [
  ["Murata", "muRata(村田)", "explicit_alias", "ok"],
  ["ＫＯＡ", "KOA", "exact", "ok"],
  ["KOA", "KOA", "exact", "ok"],
  ["Yageo", "YAGEO(国巨)", "explicit_alias", "ok"],
  ["康奈特", "CNNT/康奈特", "explicit_alias", "ok"],
  ["伊萨普兰", "Isabellenhuette(伊萨普兰)", "explicit_alias", "ok"],
  ["VISHAY", "VISHAY(威世)", "explicit_alias", "ok"],
  ["华星机电", "华星机电", "exact", "ok"],
  ["FH", "FH(风华)", "explicit_alias", "ok"],
  ["FH", "FH/广东风华高科", "explicit_alias", "ok"],
  ["STE(松田)", "STE(松田)", "exact", "ok"],
  ["WALSIN", "Walsin(华新科)", "explicit_alias", "ok"],
  ["承兴", "Chengx(承兴)", "explicit_alias", "ok"],
  ["HUAWEI", "HUAWEI(华威集团)", "explicit_alias", "ok"],
  ["云星", "Yunxing(云星)", "explicit_alias", "ok"],
  ["WIMA", "WIMA", "exact", "ok"],
  ["WIMA", "Wima", "exact", "ok"],
  ["Wurth(伍尔特)", "Wurth(伍尔特)", "exact", "ok"],
  ["顺络", "Sunlord(顺络)", "explicit_alias", "ok"],
  ["SUNLORD", "Sunlord(顺络)", "explicit_alias", "ok"],
  ["YJYCOIN(益嘉源)", "YJYCOIN(益嘉源)", "exact", "ok"],
  ["VAC", "VAC", "exact", "ok"],
  ["CJIANG", "cjiang(长江微电)", "explicit_alias", "ok"],
  ["MORNSUN", "MORNSUN(金升阳)", "explicit_alias", "ok"],
  ["MORNSUN", "MORNSUN/广州金升阳科技", "explicit_alias", "ok"],
  ["金航标", "kinghelm(金航标)", "explicit_alias", "ok"],
  ["金航标", "KINGHELM/深圳金航标电子", "explicit_alias", "ok"],
  ["明硕", "MINTRON(明硕)", "explicit_alias", "ok"],
  ["RainSun", "Rainsun(霖昱微)", "explicit_alias", "ok"],
  ["Ckmtw(灿科盟)", "Ckmtw(灿科盟)", "exact", "ok"],
  ["JST", "JST", "exact", "ok"],
  ["灿科盟", "Ckmtw(灿科盟)", "explicit_alias", "ok"],
  ["Amphenol", "Amphenol", "exact", "ok"],
  ["康深", "康深", "exact", "ok"],
  ["Megastar(兆星)", "Megastar(兆星)", "exact", "ok"],
  ["HANRUN(汉仁)", "HANRUN(汉仁)", "exact", "ok"],
  ["TE", "TE", "exact", "ok"],
  ["HCTL(华灿天禄)", "HCTL(华灿天禄)", "exact", "ok"],
  ["SHOU HAN(首韩)", "SHOU HAN(首韩)", "exact", "ok"],
  ["DEALON(德艺隆)", "DEALON(德艺隆)", "exact", "ok"],
  ["XFCN", "XFCN(兴飞)", "explicit_alias", "ok"],
  ["兆星", "Megastar(兆星)", "explicit_alias", "ok"],
  ["Infineon", "Infineon(英飞凌)", "explicit_alias", "ok"],
  ["ST", "ST(意法半导体)", "explicit_alias", "ok"],
  ["先科", "ST(先科)", "explicit_alias", "ok"],
  ["PRISEMI", "Prisemi(芯导)", "explicit_alias", "ok"],
  ["PRISEMI", "Prisemi/上海芯导电子", "explicit_alias", "ok"],
  ["Brightking", "Brightking(君耀电子)", "explicit_alias", "ok"],
  ["扬杰", "YANGJIE(扬杰)", "explicit_alias", "ok"],
  ["MDD", "MDD(辰达半导体)", "explicit_alias", "ok"],
  ["FAILONG", "FAILONG/广东惠伦晶体", "explicit_alias", "ok"],
  ["EPSON", "EPSON", "exact", "ok"],
  ["TST", "TST(嘉硕)", "explicit_alias", "ok"],
  ["TI", "TI(德州仪器)", "explicit_alias", "ok"],
  ["ON", "ON(安森美)", "explicit_alias", "ok"],
  ["BROADCOM", "Broadcom(博通)", "explicit_alias", "ok"],
  ["2Pai Semi(荣湃)", "2Pai Semi(荣湃)", "exact", "ok"],
  ["Geehy(珠海极海)", "Geehy(极海半导体)", "explicit_alias", "unavailable"],
  ["LITEON", "LITEON(光宝)", "explicit_alias", "ok"],
  ["LITEON", "LITEON(台湾光宝)", "explicit_alias", "ok"],
  ["MICRONE", "MICRONE(南京微盟)", "explicit_alias", "ok"],
  ["HTC", "HTC", "exact", "ok"],
  ["3PEAK", "3PEAK(思瑞浦)", "explicit_alias", "ok"],
  ["UMW", "UMW(友台半导体)", "explicit_alias", "ok"],
  ["UMW", "UMW/友台半导体", "explicit_alias", "ok"],
  ["英飞凌", "Infineon(英飞凌)", "explicit_alias", "ok"],
  ["瑞隆源", "RUILON(瑞隆源)", "explicit_alias", "ok"],
  ["成都芯进", "CrossChip(成都芯进)", "explicit_alias", "ok"],
  ["金升阳", "MORNSUN(金升阳)", "explicit_alias", "ok"],
  ["ADI", "ADI(亚德诺)", "explicit_alias", "ok"],
  ["ADI", "ADI(亚德诺)/LINEAR", "explicit_alias", "ok"],
  ["昂宝", "OB(昂宝)", "explicit_alias", "ok"],
  ["台湾强茂", "PANJIT/台湾强茂", "explicit_alias", "ok"],
  ["NXP", "NXP(恩智浦)", "explicit_alias", "ok"],
  ["LEM", "LEM(莱姆)", "explicit_alias", "ok"],
  ["IXYS", "Littelfuse/IXYS", "explicit_alias", "ok"],
  ["长电", "CJ/江苏长晶(长电)", "explicit_alias", "ok"],
  ["圣邦微", "SGMICRO(圣邦微)", "explicit_alias", "ok"],
  ["INTEL", "Intel/Altera", "explicit_alias", "ok"],
] as const;
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(NOW); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden"); })); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("durable source-only public-web batch snapshot", () => {
  it("returns both sources and the largest tier without new shape keys", async () => {
    const result = await service(document()).lookup([{ materialId: 9, ...expected, privateStock: 200 } as ReturnType<typeof materials>[number]], { refresh: true });
    expect(result.items).toHaveLength(1); expect(result.items[0]).toEqual({ materialId: 9, ...expected, references: { lcsc: positive("lcsc"), ickey: positive("ickey") } });
    expect(result.items[0].references.lcsc.expiresAt).toBeNull(); expect(result.items[0].references.lcsc.unitPrice).toBe("0.0008750");
    expect(Object.keys(result.items[0])).toEqual(["materialId", "partNumber", "brand", "references"]);
  });
  it("does not expire early records after 20 minutes, days or refresh", async () => {
    const readSnapshot = vi.fn(async () => JSON.stringify(document())); const s = createChannelReferenceSnapshotService({ readSnapshot });
    expect((await s.lookup(materials())).items[0].references.lcsc.status).toBe("ok");
    vi.spyOn(Date, "now").mockReturnValue(NOW + 30 * 24 * 60 * 60_000);
    for (const refresh of [false, true]) expect((await s.lookup(materials(), { refresh })).items[0].references.lcsc).toEqual(positive("lcsc"));
    expect(readSnapshot).toHaveBeenCalledTimes(3);
  });
  it("reloads byte changes and does not leak returned mutable tiers into cache", async () => {
    let content = JSON.stringify(document()); const readSnapshot = vi.fn(async () => content); const s = createChannelReferenceSnapshotService({ readSnapshot });
    const first = await s.lookup(materials()); first.items[0].references.lcsc.tiers[1].unitPrice = "999"; first.items[0].references.ickey.status = "unavailable";
    expect((await s.lookup(materials())).items[0].references.lcsc.unitPrice).toBe("0.0008750");
    const next = document(); next.records[0].references.lcsc = empty("lcsc"); next.records[0].evidence.lcsc = null; content = JSON.stringify(next);
    const second = await s.lookup(materials()); expect(second.items[0].references.lcsc).toEqual(empty("lcsc")); expect(second.items[0].references.ickey.status).toBe("ok");
  });
  it.each(["p-1-tr", " P-1-TR ", "P-1", "P-1-TR-A", "Ｐ-1-TR", "P-1-TR/Other"])("raw binding cannot broaden model key %s", async partNumber => {
    const result = await service(document()).lookup([{ materialId: 1, partNumber, brand: expected.brand }]);
    expect(result.items[0].partNumber).toBe(partNumber); for (const source of sources) expect(result.items[0].references[source]).toEqual(empty(source));
  });
  it.each(["murata", " Murata ", "Murata(村田)", "村田", "Murata Other", ""])("raw binding cannot broaden brand key %s", async brand => {
    const result = await service(document()).lookup([{ materialId: 1, partNumber: expected.partNumber, brand }]);
    for (const source of sources) expect(result.items[0].references[source]).toEqual(empty(source));
  });
  it("shares the exact identity across authorized IDs but never leaks other records", async () => {
    const result = await service(document()).lookup([{ materialId: 2, ...expected }, { materialId: 4, ...expected }, { materialId: 5, partNumber: "Other", brand: "Other" }]);
    expect(result.items.map(i => i.materialId)).toEqual([2, 4, 5]); expect(result.items[0].references.lcsc.status).toBe("ok"); expect(result.items[1].references.lcsc.status).toBe("ok"); expect(result.items[2].references.lcsc).toEqual(empty("lcsc"));
  });
  it("captures approved identity before awaiting IO, ignoring late row/list mutation", async () => {
    let release!: (text: string) => void; const readSnapshot = vi.fn(() => new Promise<string>(resolve => { release = resolve; })); const s = createChannelReferenceSnapshotService({ readSnapshot });
    const input = materials(); const promise = s.lookup(input); input[0].materialId = 999; input[0].partNumber = "Other"; input[0].brand = "Other"; input.push({ materialId: 2, ...expected });
    release(JSON.stringify(document())); const result = await promise; expect(result.items).toHaveLength(1); expect(result.items[0]).toMatchObject({ materialId: 1, ...expected }); expect(result.items[0].references.lcsc.status).toBe("ok");
  });
  it("works with injected bytes and performs no file IO, network or process work", async () => {
    const readSnapshot = vi.fn(async () => Buffer.from(JSON.stringify(document()))); const s = createChannelReferenceSnapshotService({ readSnapshot });
    await s.lookup(materials(), { refresh: true });
    expect(readSnapshot).toHaveBeenCalledWith(); expect(fs.open).not.toHaveBeenCalled(); expect(fs.readFile).not.toHaveBeenCalled();
    for (const method of [fs.mkdir, fs.writeFile, fs.rename, fs.unlink, fs.rm, fs.readdir, fs.lstat, childProcess.spawn, childProcess.exec, childProcess.execFile, childProcess.fork, globalThis.fetch]) expect(method).not.toHaveBeenCalled();
  });
  it("allows an explicitly confirmed last-only tier", async () => {
    const doc = document(); for (const source of sources) doc.records[0].references[source].tiers = [doc.records[0].references[source].tiers[1]];
    expect((await quote(doc)).status).toBe("ok");
  });
});

describe("finite actual brand directions and ASCII-width proof only", () => {
  it.each(actualBrandCases)("checks actual whole literal %s => %s (%s)", async (rawBrand, observed, brandMatch, status) => {
    const q = await brandQuote(rawBrand, observed, brandMatch, brandMatch === "exact" ? null : observed);
    expect(q.status).toBe(status);
    if (status === "ok") expect(q.matchedBrand).toBe(observed);
    else expect(q).toEqual(empty("lcsc", "unavailable"));
  });
  it.each([
    ["Murata", "村田(Murata)"], ["村田", "村田（Murata）"],
    ["TI", "德州仪器（TI）"], ["德州仪器", "德州仪器(TI)"],
    ["Texas Instruments", "德州仪器(Texas Instruments)"], ["德州仪器", "德州仪器（Texas Instruments）"],
    ["Murata", "Ｍｕｒａｔａ（村田）"], ["FH", "ＦＨ／广东风华高科"],
  ])("retains normal legacy reverse and ASCII-width literals %s => %s", async (raw, observed) => {
    expect((await brandQuote(raw, observed)).matchedBrand).toBe(observed);
  });
  it.each([
    ["ST", "ST(先科)"], ["先科", "ST(意法半导体)"], ["ST", "先科(ST)"], ["ST", "意法半导体(ST)"],
    ["TI", "TI(Infineon)"], ["TE", "TI(德州仪器)"], ["TST", "ST(意法半导体)"], ["ON", "ON(Honeywell)"],
    ["HUAWEI", "HUAWEI(华为)"], ["FH", "FH(Fairchild)"],
    ["ORMON", "OMRON(欧姆龙)"], ["INRINEON", "Infineon(英飞凌)"], ["WINBOD", "WINBOND(华邦)"], ["PHOENUX", "PHOENIX(菲尼克斯)"],
    ["Geehy(珠海极海)", "Geehy(极海半导体)"], ["Geehy", "Geehy(极海半导体)"],
    ["FH", "FH/风华"], ["金航标", "金航标/KINGHELM"], ["MORNSUN", "MORNSUN/金升阳"], ["UMW", "UMW/Other"],
    ["Yageo", "国巨(Yageo)"], ["Infineon", "Infineon/英飞凌"],
    ["Murata", "Ｍurata"], ["ＫＯＡ", "KOA"], ["KOA", "ⓀⓄⒶ"], ["KOA", "𝐊𝐎𝐀"],
    ["长电", "CJ(江苏长电/长晶)"], ["長電", "CJ/江苏长晶(长电)"],
    ["ON", "onsemi"], ["TI", "Texas Instruments"], ["MCHP", "Microchip"],
    ["ADI", "Analog Devices/Linear Technology"], ["ADI", "ADI/LINEAR"],
    ["瑞隆", "RUILON(瑞隆源)"], ["成都芯进", "CrossChip/成都芯进电子"],
    ["金升阳", "MORNSUN/广州金升阳科技"], ["LINEAR", "ADI(亚德诺)/LINEAR"],
    ["ALTERA", "Intel/Altera"], ["CJ", "CJ/江苏长晶(长电)"],
  ])("rejects cross-brand, unsupported direction, typo or implicit exact %s => %s", async (raw, observed) => {
    expect(await brandQuote(raw, observed)).toEqual(empty("lcsc", "unavailable"));
  });
  const actualAliases = actualBrandCases.filter(row => row[2] === "explicit_alias" && row[3] === "ok");
  it.each(actualAliases)("requires actual unnormalized literalReason for %s => %s", async (raw, observed) => {
    for (const reason of [null, observed + " ", observed.toLowerCase(), "guessed alias"]) {
      if (reason === observed) continue;
      expect(await brandQuote(raw, observed, "explicit_alias", reason)).toEqual(empty("lcsc", "unavailable"));
    }
    expect(await brandQuote(raw, observed, "exact", null)).toEqual(empty("lcsc", "unavailable"));
  });
  it.each(actualAliases)("does not recognize extra parenthesis/slash suffix for %s => %s", async (raw, observed) => {
    for (const suffix of ["(extra)", "/extra", "（extra）", "/other/name"]) {
      expect(await brandQuote(raw, observed + suffix)).toEqual(empty("lcsc", "unavailable"));
    }
  });
  it("ASCII-width exact still requires exact/null reason, not explicit_alias", async () => {
    expect((await brandQuote("ＫＯＡ", " k o a ", "exact", null)).matchedBrand).toBe(" k o a ");
    expect((await brandQuote("Murata", "Ｍurata", "exact", null)).matchedBrand).toBe("Ｍurata");
    expect(await brandQuote("ＫＯＡ", "KOA", "exact", "KOA")).toEqual(empty("lcsc", "unavailable"));
    for (const observed of ["ⓀⓄⒶ", "𝐊𝐎𝐀", "K\u0085OA"]) expect(await brandQuote("KOA", observed, "exact", null)).toEqual(empty("lcsc", "unavailable"));
  });
  it("never merges raw fullwidth, ASCII, case or whitespace identity keys", async () => {
    const doc = brandDocument("ＫＯＡ", "KOA", "exact", null);
    const ascii = brandDocument("KOA", "KOA", "exact", null).records[0];
    ascii.references.lcsc = empty("lcsc", "price_unavailable"); ascii.evidence.lcsc = null; doc.records.push(ascii);
    const inputs = ["ＫＯＡ", "KOA", "koa", " KOA "].map((brand, i) => ({ materialId: i + 1, ...expected, brand }));
    const result = await service(doc).lookup(inputs);
    expect(result.items.map(i => i.brand)).toEqual(["ＫＯＡ", "KOA", "koa", " KOA "]);
    expect(result.items.map(i => i.references.lcsc.status)).toEqual(["ok", "price_unavailable", "not_found", "not_found"]);
  });
});

describe("conservative full identity and literal brand proof", () => {
  it("permits only trim/case for complete MPN, and whole-brand case/whitespace", async () => {
    const doc = changeQuote({ matchedPartNumber: " p-1-tr ", matchedBrand: " mU rAtA " }, "lcsc", true);
    const q = await quote(doc); expect(q.status).toBe("ok"); expect(q.matchedBrand).toBe(" mU rAtA ");
  });
  it.each(["P-1", "P-1-TR-X", "P-1TR", "P -1-TR", "Ｐ-1-TR", "P-1-TR\u200b"])("rejects full MPN mismatch %s", async matchedPartNumber => {
    expect(await quote(changeQuote({ matchedPartNumber }, "lcsc", true))).toEqual(empty("lcsc", "unavailable"));
  });
  it.each([
    ["Murata", "Murata(村田)"], ["Murata", "村田（Murata）"], ["村田", "Murata(村田)"], ["TI", "TI(德州仪器)"], ["德州仪器", "TI（德州仪器）"], ["Texas Instruments", "Texas Instruments(德州仪器)"],
  ])("accepts observed explicit literal pair %s => %s", async (rawBrand, observed) => {
    const doc = document(); doc.records[0].brand = rawBrand; const q = doc.records[0].references.lcsc; q.matchedBrand = observed;
    const e = evidence(q, { ...expected, brand: rawBrand }); e.brandMatch = "explicit_alias"; e.literalReason = observed; doc.records[0].evidence.lcsc = e;
    const result = await service(doc).lookup([{ materialId: 1, ...expected, brand: rawBrand }]); expect(result.items[0].references.lcsc.status).toBe("ok"); expect(result.items[0].references.lcsc.matchedBrand).toBe(observed);
  });
  it.each(["Other", "Murata Other", "Other Murata", "Murata(TI)", "Other(Murata)", "Murata(村田) Other", "MurataOther(村田)", "村田", "Ｍurata", "Murata（村田)", "Murata(村田）"])("never accepts conflicting/substr/unsupported brand %s", async observed => {
    const doc = changeQuote({ matchedBrand: observed }, "lcsc", true); const e = doc.records[0].evidence.lcsc!; e.brandMatch = "explicit_alias"; e.literalReason = observed;
    expect(await quote(doc)).toEqual(empty("lcsc", "unavailable"));
  });
  it("does not accept TI(Infineon) just because TI is a substring", async () => {
    const doc = document(); doc.records[0].brand = "TI"; doc.records[0].references.lcsc.matchedBrand = "TI(Infineon)";
    doc.records[0].evidence.lcsc = { ...evidence(doc.records[0].references.lcsc, { ...expected, brand: "TI" }), brandMatch: "explicit_alias", literalReason: "TI(Infineon)" };
    const result = await service(doc).lookup([{ materialId: 1, ...expected, brand: "TI" }]); expect(result.items[0].references.lcsc).toEqual(empty("lcsc", "unavailable"));
  });
  it.each([{ expectedPartNumber: "P-1" }, { observedPartNumber: "P-2" }, { expectedBrand: "Other" }, { observedBrand: "Other" }, { pageUrl: "https://item.szlcsc.com/999.html" }, { collectedAt: GENERATED }, { brandMatch: "substring" }, { literalReason: "brand guessed" }, { maxTierConfirmed: false }, { observedMaxQuantity: 5 }, { observedMaxUnitPrice: "0.03" }, { extra: "drift" }])("rejects invalid brand/max-tier evidence %j", async change => {
    const doc = document(); Object.assign(doc.records[0].evidence.lcsc!, change); expect(await quote(doc)).toEqual(empty("lcsc", "unavailable"));
  });
  it("requires exact literal observed pair proof, not inferred alias prose", async () => {
    const doc = changeQuote({ matchedBrand: "Murata(村田)" }, "lcsc", true); doc.records[0].evidence.lcsc!.brandMatch = "explicit_alias"; doc.records[0].evidence.lcsc!.literalReason = "Murata is probably 村田";
    expect(await quote(doc)).toEqual(empty("lcsc", "unavailable"));
  });
});

describe("price/tier/stock/time/currency/URL integrity", () => {
  it.each(["0", "0.0000", "-1", "+1", "1e-3", "¥1", "1 CNY", " 1", "1.", ".1", "NaN", "Infinity", "1,000", "1".repeat(65)])("rejects invalid/non-positive decimal %s", async unitPrice => {
    const doc = document(); const q = doc.records[0].references.lcsc; q.unitPrice = unitPrice; q.tiers[1].unitPrice = unitPrice; doc.records[0].evidence.lcsc = evidence(q);
    expect(await quote(doc)).toEqual(empty("lcsc", "unavailable"));
  });
  it.each(["0.0000000000000000000001", "0001.000", "12", "0.0008750"])("preserves valid positive decimal string %s", async unitPrice => {
    const doc = document(); const q = doc.records[0].references.lcsc; q.unitPrice = unitPrice; q.tiers[1].unitPrice = unitPrice; doc.records[0].evidence.lcsc = evidence(q); expect((await quote(doc)).unitPrice).toBe(unitPrice);
  });
  it.each([{ source: "ickey" }, { unitPrice: "0.03" }, { tierQuantity: 5 }, { tierQuantity: 0 }, { currency: null }, { currency: "EUR" }, { currency: "cny" }, { stockQuantity: -1 }, { stockQuantity: 1.5 }, { stockQuantity: "3" }, { stockQuantity: Number.MAX_SAFE_INTEGER + 1 }, { stockInsufficientForTier: false }, { stockInsufficientForTier: "true" }, { taxStatus: "taxed" }, { message: "HTML" }, { expiresAt: GENERATED }, { fetchedAt: "invalid" }, { fetchedAt: "2026-11-14T09:01:00.000Z" }, { fetchedAt: "2026-11-15T00:00:00.000Z" }, { fetchedAt: "2026-02-30T00:00:00.000Z" }, { fetchedAt: null }, { matchedBrand: null }, { matchedPartNumber: null }, { productCode: "bad\n" }, { extra: "drift" }])("rejects invalid quote field %j and isolates source", async change => {
    const doc = changeQuote(change); const result = await service(doc).lookup(materials()); expect(result.items[0].references.lcsc).toEqual(empty("lcsc", "unavailable")); expect(result.items[0].references.ickey).toEqual(positive("ickey"));
  });
  it.each([null, 0, 100, 1000])("supports null/non-negative stock %s and correct insufficient flag", async stockQuantity => {
    const doc = changeQuote({ stockQuantity, stockInsufficientForTier: stockQuantity !== null && stockQuantity < 100 }); expect((await quote(doc)).status).toBe("ok");
  });
  it.each([
    [], [{ minQuantity: 0, unitPrice: "1" }], [{ minQuantity: -1, unitPrice: "1" }], [{ minQuantity: 0.5, unitPrice: "1" }], [{ minQuantity: "100", unitPrice: "1" }],
    [{ minQuantity: 100, unitPrice: "1" }, { minQuantity: 5, unitPrice: "0.03" }], [{ minQuantity: 100, unitPrice: "1" }, { minQuantity: 100, unitPrice: "1" }],
    [{ minQuantity: 100, unitPrice: "0" }], [{ minQuantity: 100, unitPrice: "1", extra: true }], Array.from({ length: 51 }, (_, i) => ({ minQuantity: i + 1, unitPrice: "1" })),
  ])("rejects malformed, duplicated, descending or oversized tiers %#", async tiers => { expect(await quote(changeQuote({ tiers }))).toEqual(empty("lcsc", "unavailable")); });
  it.each(["http://item.szlcsc.com/123.html", "https://evil.example/123.html", "https://item.szlcsc.com.evil.example/123.html", "https://user@item.szlcsc.com/123.html", "https://item.szlcsc.com:443/123.html", "https://item.szlcsc.com:8443/123.html", "https://item.szlcsc.com/123.html?k=x", "https://item.szlcsc.com/123.html#x", "https://so.szlcsc.com/global.html?k=P-1", "https://item.szlcsc.com/other/../123.html", "https://www.ickey.cn/detail/123/P-1.html", " https://item.szlcsc.com/123.html", "https://item.szlcsc.com/0.html"])("rejects noncanonical/wrong-source/non-detail URL %s", async pageUrl => {
    expect(await quote(changeQuote({ pageUrl }, "lcsc", true))).toEqual(empty("lcsc", "unavailable"));
  });
  it.each(["https://search.ickey.cn/?keyword=P-1", "https://www.ickey.cn/detail/123/P%2F1.html", "https://www.ickey.cn/detail/123/P%5C1.html", "https://www.ickey.cn/detail/123/P%252F1.html", "https://www.ickey.cn/detail/123/P%0A1.html", "https://www.ickey.cn/detail/123/../P-1.html", "https://www.ickey.cn/detail/123/P-1.html#x"])("rejects unsafe ICKey detail URL %s", async pageUrl => {
    expect(await quote(changeQuote({ pageUrl }, "ickey", true), "ickey")).toEqual(empty("ickey", "unavailable"));
  });
  it.each([
    ["lcsc", "https://item.szlcsc.com/mro/6710007.html"],
    ["ickey", "https://www.ickey.cn/detail/1003001031268591/LT3045IMSE%23TRPBF.html"],
  ] as const)("accepts only evidence-backed exact exception %s %s", async (source, pageUrl) => {
    const q = await quote(changeQuote({ pageUrl }, source, true), source);
    expect(q.status).toBe("ok"); expect(q.pageUrl).toBe(pageUrl);
  });
  it.each([
    ["lcsc", "https://item.szlcsc.com/mro/6710008.html"],
    ["lcsc", "https://item.szlcsc.com/mro/06710007.html"],
    ["lcsc", "https://item.szlcsc.com/mro/other/../6710007.html"],
    ["lcsc", "https://item.szlcsc.com/mro%2F6710007.html"],
    ["ickey", "https://www.ickey.cn/detail/1003001031268592/LT3045IMSE%23TRPBF.html"],
    ["ickey", "https://www.ickey.cn/detail/1003001031268591/LT3045IMSE%23OTHER.html"],
    ["ickey", "https://www.ickey.cn/detail/1003001031268591/LT3045IMSE%2523TRPBF.html"],
    ["ickey", "https://www.ickey.cn/detail/1003001031268591/LT3045IMSE%2FTRPBF.html"],
    ["ickey", "https://www.ickey.cn/detail/1003001031268591/LT3045IMSE%5CTRPBF.html"],
    ["ickey", "https://www.ickey.cn/detail/1003001031268591/LT3045IMSE#TRPBF.html"],
  ] as const)("does not broaden exact exception %s %s", async (source, pageUrl) => {
    expect(await quote(changeQuote({ pageUrl }, source, true), source)).toEqual(empty(source, "unavailable"));
  });
  it.each([
    ["lcsc", "https://item.szlcsc.com/mro/6710007.html"],
    ["ickey", "https://www.ickey.cn/detail/1003001031268591/LT3045IMSE%23TRPBF.html"],
  ] as const)("keeps public HTTPS/canonical restrictions for exact exception %s", async (source, pageUrl) => {
    for (const unsafe of [pageUrl.replace("https:", "http:"), pageUrl.replace("https://", "https://user:secret@"), pageUrl.replace(".com/", ".com:443/").replace(".cn/", ".cn:443/"), pageUrl + "?x=1", pageUrl + "#x", pageUrl + "#", pageUrl.replace(".html", "%2F.html"), pageUrl.replace(".html", "%252F.html")]) {
      expect(await quote(changeQuote({ pageUrl: unsafe }, source, true), source)).toEqual(empty(source, "unavailable"));
    }
  });
});

describe("negative quotes contain no reference numbers or metadata and never pending", () => {
  it.each(["not_found", "ambiguous", "price_unavailable", "access_restricted", "unavailable"] as const)("returns clean %s without digits", async status => {
    const doc = document(); doc.records[0].references.lcsc = { ...empty("lcsc", status), fetchedAt: COLLECTED }; doc.records[0].evidence.lcsc = null;
    expect(await quote(doc)).toEqual({ ...empty("lcsc", status), fetchedAt: COLLECTED });
  });
  it.each([{ unitPrice: "1" }, { tierQuantity: 1 }, { tiers: [{ minQuantity: 1, unitPrice: "1" }] }, { stockQuantity: 0 }, { matchedPartNumber: "P-1-TR" }, { matchedBrand: "Murata" }, { pageUrl: "https://item.szlcsc.com/123.html" }, { currency: "CNY" }, { packaging: "Reel" }, { stockInsufficientForTier: true }, { message: "not found" }, { expiresAt: GENERATED }, { status: "pending" }, { status: "unknown" }])("rejects polluted negative quote %j", async change => {
    const doc = document(); doc.records[0].references.lcsc = Object.assign(empty("lcsc"), change); doc.records[0].evidence.lcsc = null; expect(await quote(doc)).toEqual(empty("lcsc", "unavailable"));
  });
  it("rejects evidence attached to a negative and future negative times", async () => {
    const doc = document(); doc.records[0].references.lcsc = empty("lcsc"); expect(await quote(doc)).toEqual(empty("lcsc", "unavailable"));
    doc.records[0].evidence.lcsc = null; doc.records[0].references.lcsc.fetchedAt = "2026-11-15T00:00:00.000Z"; expect(await quote(doc)).toEqual(empty("lcsc", "unavailable"));
  });
  it("empty valid batch or missing identity returns honest not_found, never pending", async () => {
    const doc = document(); doc.records = []; const result = await service(doc).lookup(materials()); for (const source of sources) expect(result.items[0].references[source]).toEqual(empty(source));
  });
});

describe("bad file/limits/authorization fail closed", () => {
  it.each([null, [], {}, { schemaVersion: 2 }, { schemaVersion: 1, collectionMode: "ecs-live", generatedAt: GENERATED, records: [] }])("rejects malformed top-level schema %#", async doc => {
    await expect(service(doc).lookup(materials())).rejects.toBeInstanceOf(ChannelReferenceSnapshotUnavailableError);
  });
  it.each([{ generatedAt: "2026-11-15T00:00:00.000Z" }, { generatedAt: "2026-02-30T00:00:00.000Z" }, { generatedAt: "2026-11-14" }, { extra: "drift" }, { records: "bad" }])("rejects top-level date/shape mismatch %j", async change => {
    const doc = Object.assign(document(), change); await expect(service(doc).lookup(materials())).rejects.toThrow("Channel reference snapshot unavailable");
  });
  it.each([{ partNumber: 123 }, { brand: null }, { partNumber: "X".repeat(129) }, { brand: "X".repeat(65) }, { brand: "bad\n" }, { extra: "private" }, { references: {} }, { evidence: {} }])("rejects malformed record %j", async change => {
    const doc = document(); Object.assign(doc.records[0], change); await expect(service(doc).lookup(materials())).rejects.toThrow("snapshot unavailable");
  });
  it("rejects duplicate exact raw identity and >5000 records", async () => {
    const doc = document(); doc.records.push(structuredClone(doc.records[0])); await expect(service(doc).lookup(materials())).rejects.toThrow("snapshot unavailable");
    doc.records = Array.from({ length: 5001 }, (_, i) => ({ ...doc.records[0], partNumber: `P-${i}` })); await expect(service(doc).lookup(materials())).rejects.toThrow("snapshot unavailable");
  });
  it("allows 5000 bounded records and only returns requested items", async () => {
    const doc = document(); doc.records = Array.from({ length: 5000 }, (_, i) => ({ partNumber: `P-${i}`, brand: "Brand", references: { lcsc: empty("lcsc"), ickey: empty("ickey") }, evidence: { lcsc: null, ickey: null } }));
    const result = await service(doc).lookup([{ materialId: 2, partNumber: "P-4999", brand: "Brand" }]); expect(result.items).toHaveLength(1); expect(result.items[0].references.lcsc).toEqual(empty("lcsc"));
  });
  it.each(["", "{", "null", "x".repeat(5 * 1024 * 1024 + 1), "村".repeat(2 * 1024 * 1024)])("rejects invalid/oversized bytes %#", async content => {
    await expect(createChannelReferenceSnapshotService({ readSnapshot: async () => content }).lookup(materials())).rejects.toThrow("snapshot unavailable");
  });
  it("rejects malformed UTF-8, and missing/read error instead of pretending completed", async () => {
    await expect(createChannelReferenceSnapshotService({ readSnapshot: async () => new Uint8Array([0xff, 0xfe]) }).lookup(materials())).rejects.toThrow("snapshot unavailable");
    await expect(createChannelReferenceSnapshotService({ readSnapshot: async () => { throw new Error("ENOENT"); } }).lookup(materials())).rejects.toThrow("snapshot unavailable");
  });
  it("does not silently use a formerly good snapshot after corruption/deletion and recovers", async () => {
    let content = JSON.stringify(document()); const s = createChannelReferenceSnapshotService({ readSnapshot: async () => content });
    expect((await s.lookup(materials())).items[0].references.lcsc.status).toBe("ok"); content = "{"; await expect(s.lookup(materials())).rejects.toThrow("snapshot unavailable");
    content = JSON.stringify(document()); expect((await s.lookup(materials())).items[0].references.lcsc.status).toBe("ok");
  });
  it.each([[], Array.from({ length: 21 }, (_, i) => ({ materialId: i + 1, ...expected })), [{ materialId: 0, ...expected }], [{ materialId: 1.5, ...expected }], [{ materialId: 1, ...expected }, { materialId: 1, ...expected }], [{ materialId: 1, partNumber: "bad\n", brand: "B" }], [{ materialId: 1, partNumber: "P".repeat(129), brand: "B" }], [{ materialId: 1, partNumber: "P", brand: "B".repeat(65) }], [null], null])("rejects unapproved material list before any read %#", async input => {
    const readSnapshot = vi.fn(async () => JSON.stringify(document())); const s = createChannelReferenceSnapshotService({ readSnapshot });
    await expect(s.lookup(input as ReturnType<typeof materials>)).rejects.toThrow("Invalid approved reference materials"); expect(readSnapshot).not.toHaveBeenCalled(); expect(fs.open).not.toHaveBeenCalled();
  });
  it("rejects a sparse array even when its only slot has no material", async () => {
    const readSnapshot = vi.fn(async () => JSON.stringify(document()));
    await expect(createChannelReferenceSnapshotService({ readSnapshot }).lookup(new Array(1))).rejects.toThrow("Invalid approved reference materials");
    expect(readSnapshot).not.toHaveBeenCalled();
  });
  it("allows exactly 20 authorized distinct IDs", async () => {
    const input = Array.from({ length: 20 }, (_, i) => ({ materialId: i + 1, ...expected })); expect((await service(document()).lookup(input)).items).toHaveLength(20);
  });
});

describe("fixed native file reader and default export binding", () => {
  function mockHandle(content: string, stat = { size: Buffer.byteLength(content), isFile: () => true }) {
    const bytes = Buffer.from(content); const handle = { stat: vi.fn(async () => stat), read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
      const copied = bytes.copy(buffer, offset, position, position + length); return { bytesRead: copied, buffer };
    }), close: vi.fn(async () => {}) };
    vi.mocked(fs.open).mockResolvedValue(handle as unknown as Awaited<ReturnType<typeof fs.open>>); return handle;
  }
  it("reads only canonical same-directory URL with readonly/no-follow flags and closes", async () => {
    const handle = mockHandle(JSON.stringify(document())); const s = createChannelReferenceSnapshotService(); expect((await s.lookup(materials())).items[0].references.lcsc.status).toBe("ok");
    expect(fs.open).toHaveBeenCalledTimes(1); const [url, flags] = vi.mocked(fs.open).mock.calls[0]; expect(url).toBeInstanceOf(URL); expect(String(url)).toBe(new URL("./channel-reference-snapshot.json", import.meta.url).href);
    expect(flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); expect(handle.close).toHaveBeenCalledTimes(1);
    for (const method of [fs.writeFile, fs.mkdir, fs.rename, fs.unlink, fs.rm, childProcess.spawn, globalThis.fetch]) expect(method).not.toHaveBeenCalled();
  });
  it.each([{ size: 0, isFile: () => true }, { size: 5 * 1024 * 1024 + 1, isFile: () => true }, { size: 123, isFile: () => false }])("rejects empty/oversize/nonregular stat before read %#", async stat => {
    const handle = mockHandle("{}", stat); await expect(createChannelReferenceSnapshotService().lookup(materials())).rejects.toThrow("snapshot unavailable"); expect(handle.read).not.toHaveBeenCalled(); expect(handle.close).toHaveBeenCalledOnce();
  });
  it("bounds bytes even when file grows after stat", async () => {
    const handle = mockHandle("x".repeat(5 * 1024 * 1024 + 100), { size: 10, isFile: () => true }); await expect(createChannelReferenceSnapshotService().lookup(materials())).rejects.toThrow("snapshot unavailable");
    expect(handle.read.mock.calls[0][2]).toBe(5 * 1024 * 1024 + 1); expect(handle.close).toHaveBeenCalledOnce();
  });
  it("read error closes handle; open ENOENT/symlink failure never triggers workers", async () => {
    const handle = mockHandle("{}"); handle.read.mockRejectedValue(new Error("read failed")); await expect(createChannelReferenceSnapshotService().lookup(materials())).rejects.toThrow("snapshot unavailable"); expect(handle.close).toHaveBeenCalledOnce();
    vi.mocked(fs.open).mockRejectedValue(new Error("ENOENT or ELOOP")); await expect(createChannelReferenceSnapshotService().lookup(materials())).rejects.toThrow("snapshot unavailable"); expect(childProcess.spawn).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("service default lookup is snapshot-only while old factory stays available", async () => {
    const handle = mockHandle(JSON.stringify(document())); const { lookupChannelReferences, createChannelReferenceService } = await import("./service");
    expect(typeof createChannelReferenceService).toBe("function"); const result = await lookupChannelReferences(materials(), { refresh: true }); expect(result.items[0].references.lcsc.status).toBe("ok"); expect(handle.close).toHaveBeenCalledOnce();
    for (const method of [fs.mkdir, fs.readFile, fs.writeFile, fs.rename, fs.readdir, childProcess.spawn, globalThis.fetch]) expect(method).not.toHaveBeenCalled();
  });
});
