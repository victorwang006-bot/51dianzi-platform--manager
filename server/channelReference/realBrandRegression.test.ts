import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseReferenceQuote } from "./worker";
import { validCachedReference } from "./quoteValidation";
import { VERIFIED_HISTORICAL_CHANNEL_REFERENCE_BRAND_PAIRS } from "../../shared/channelReferenceBrand";
import { syntheticLcscReferencePage } from "./fixtures/syntheticReferenceFixture";
const capturedAt = "2026-11-14T16:46:27.438Z";
const original = process.env.CHANNEL_REFERENCE_ST_PROOF_HTML;
const reducedPath = new URL("./fixtures/lcsc-ste145n65m5-public-row.html", import.meta.url);
const capturedReduced = existsSync(reducedPath);
// Missing original capture is an explicit recovery blocker, not regenerated
// evidence. Only independent synthetic identity checks use the fallback.
const reduced = capturedReduced ? readFileSync(reducedPath, "utf8") : syntheticLcscReferencePage();
const url = "https://so.szlcsc.com/global.html?k=STE145N65M5";
function assertST(html: string) {
  const short = parseReferenceQuote("lcsc", html, url, { partNumber: "STE145N65M5", brand: "ST" }, capturedAt);
  const full = parseReferenceQuote("lcsc", html, url, { partNumber: "STE145N65M5", brand: "ST(意法半导体)" }, capturedAt);
  expect(short).toEqual(full);
  expect(short).toMatchObject({ status: "ok", matchedPartNumber: "STE145N65M5", matchedBrand: "ST(意法半导体)", productCode: "C2970194", pageUrl: "https://item.szlcsc.com/3362658.html", unitPrice: "184.21", stockQuantity: 44, tiers: [{ minQuantity: 1, unitPrice: "191.09" }, { minQuantity: 30, unitPrice: "184.21" }], tierQuantity: 30, currency: "CNY", taxStatus: "included", unit: "个", fetchedAt: capturedAt });
  expect(validCachedReference(short, "lcsc", { partNumber: "STE145N65M5", brand: "ST" })).toBe(true);
  expect(validCachedReference(short, "lcsc", { partNumber: "STE145N65M5/TR", brand: "ST" })).toBe(false);
  expect(parseReferenceQuote("lcsc", html, url, { partNumber: "STE145N65M5", brand: "ST(先科)" }, capturedAt).status).toBe("not_found");
  expect(parseReferenceQuote("lcsc", html.replaceAll("ST(意法半导体)", "ST(先科)"), url, { partNumber: "STE145N65M5", brand: "ST" }, capturedAt).status).toBe("not_found");
  for (const suffix of ["/NOPB", "-TR", "L"]) expect(parseReferenceQuote("lcsc", html, url, { partNumber: "STE145N65M5" + suffix, brand: "ST" }, capturedAt).status).toBe("not_found");
}
describe("captured real ST page identity regression, not live-worker reliability", () => {
  it.skipIf(!capturedReduced)("binds the verbatim reduced public product/header to its fixture SHA and accepts only the whole ST manufacturer (blocked if capture missing)", () => {
    expect(createHash("sha256").update(reduced).digest("hex")).toBe("556d16d5ba5ce7c8e1b015022a3d426fffab0ce5ebbcaa62976952e276c7b304");
    assertST(reduced);
  });
  it.skipIf(!original)("replays the unmodified actual full HTML with the approved root-cause proof hash", () => {
    const html = readFileSync(original!, "utf8");
    expect(createHash("sha256").update(html).digest("hex")).toBe("c704e60119310a5c7ae22416b4dfd9066c8be279e0a9199bdd5045ed02f24749");
    assertST(html);
  });
  it("independently verifies full ST identity with synthetic offline markup, not captured/live evidence", () => {
    assertST(syntheticLcscReferencePage());
  });
  it.each(VERIFIED_HISTORICAL_CHANNEL_REFERENCE_BRAND_PAIRS)("current quote/cache validation preserves historical directed %s => %s", (brand, observed) => {
    const base = parseReferenceQuote("lcsc", reduced, url, { partNumber: "STE145N65M5", brand: "ST" }, capturedAt);
    for (const source of ["lcsc", "ickey"] as const) {
      const quote = { ...base, source, matchedBrand: observed, pageUrl: source === "lcsc" ? base.pageUrl : "https://www.ickey.cn/detail/123/STE145N65M5.html" };
      expect(validCachedReference(quote, source, { partNumber: "STE145N65M5", brand })).toBe(source === "lcsc" || !(brand === "MURATA" || brand === "村田"));
      expect(validCachedReference({ ...quote, matchedBrand: observed + "/Other" }, source, { partNumber: "STE145N65M5", brand })).toBe(false);
    }
  });
});
