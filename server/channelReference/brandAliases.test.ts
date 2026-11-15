// Keep the existing shared pure suite within the unchanged Vitest include.
import "../../shared/channelReferenceBrand.test";
import { describe, expect, it } from "vitest";
import { matchChannelReferenceBrand, VERIFIED_HISTORICAL_CHANNEL_REFERENCE_BRAND_PAIRS, VERIFIED_CHANNEL_REFERENCE_BRAND_PAIRS } from "../../shared/channelReferenceBrand";
import { matchesLcscBrand } from "./lcscPage";
import { parseReferenceQuote } from "./worker";
import { validCachedReference } from "./quoteValidation";
import { syntheticLcscReferencePage, syntheticIckeyReferencePage, SYNTHETIC_REFERENCE_MPN, SYNTHETIC_LCSC_URL } from "./fixtures/syntheticReferenceFixture";

const time = "2026-11-14T16:46:27.438Z";
const exact = (value: string) => value.replace(/\s+/g, " ").trim().toUpperCase();
const newPairs = VERIFIED_CHANNEL_REFERENCE_BRAND_PAIRS.map(pair => [pair[0], pair[1], true] as const);
const oldPairs = VERIFIED_HISTORICAL_CHANNEL_REFERENCE_BRAND_PAIRS.map((pair, index) => [pair[0], pair[1], index >= 4] as const);
describe("restored approved whole-brand directions across parsers and cache (synthetic offline HTML only)", () => {
  it.each([...oldPairs, ...newPairs])("binds approved %s => %s without broadening identities", (brand, observed, allowedIckey) => {
    expect(matchChannelReferenceBrand(brand, observed, { profile: "snapshot" })).toBe("explicit_alias");
    expect(matchesLcscBrand(brand, observed)).toBe(true);
    expect(matchChannelReferenceBrand(brand, observed, { profile: "ickey", normalize: exact }) !== null).toBe(allowedIckey);
    for (const source of ["lcsc", "ickey"] as const) {
      const allowed = source === "lcsc" || allowedIckey;
      const url = source === "lcsc" ? SYNTHETIC_LCSC_URL : "https://search.ickey.cn/?keyword=STE145N65M5";
      const html = source === "lcsc" ? syntheticLcscReferencePage(observed) : syntheticIckeyReferencePage(observed);
      const quote = parseReferenceQuote(source, html, url, { partNumber: SYNTHETIC_REFERENCE_MPN, brand }, time);
      expect(quote.status).toBe(allowed ? "ok" : "not_found");
      expect(validCachedReference(quote, source, { partNumber: SYNTHETIC_REFERENCE_MPN, brand })).toBe(true);
      if (allowed) {
        expect(quote.matchedBrand).toBe(observed);
        expect(validCachedReference({ ...quote, matchedBrand: observed + "/Other" }, source, { partNumber: SYNTHETIC_REFERENCE_MPN, brand })).toBe(false);
        expect(validCachedReference(quote, source, { partNumber: SYNTHETIC_REFERENCE_MPN + "/NOPB", brand })).toBe(false);
      }
    }
  });
  it.each(["ST(意法半导体)", "ST MICROELECTRONICS", "STMicroelectronics"])("ST accepts approved Chinese/English literal %s but never 先科 or partial MPN", observed => {
    for (const source of ["lcsc", "ickey"] as const) {
      const url = source === "lcsc" ? SYNTHETIC_LCSC_URL : "https://search.ickey.cn/?keyword=STE145N65M5";
      const page = source === "lcsc" ? syntheticLcscReferencePage : syntheticIckeyReferencePage;
      expect(parseReferenceQuote(source, page(observed), url, { partNumber: SYNTHETIC_REFERENCE_MPN, brand: "ST" }, time).status).toBe("ok");
      expect(parseReferenceQuote(source, page("ST(先科)"), url, { partNumber: SYNTHETIC_REFERENCE_MPN, brand: "ST" }, time).status).toBe("not_found");
      for (const suffix of ["/NOPB", "-TR", "L"]) expect(parseReferenceQuote(source, page(observed), url, { partNumber: SYNTHETIC_REFERENCE_MPN + suffix, brand: "ST" }, time).status).toBe("not_found");
    }
  });
});
