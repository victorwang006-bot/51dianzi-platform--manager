import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
vi.mock("./browserPage", () => ({ readPublicReferencePage: vi.fn() }));
import { readPublicReferencePage } from "./browserPage";
import { fetchPublicReferenceEvidence, fetchPublicReferenceQuote } from "./worker";
import { PublicPageRestrictedError } from "./publicPage";
import { validCachedReference } from "./quoteValidation";
import { syntheticLcscReferencePage } from "./fixtures/syntheticReferenceFixture";
const capturedFixture = new URL("./fixtures/lcsc-ste145n65m5-public-row.html", import.meta.url);
// Synthetic fallback is only for offline worker boundary tests, never a
// regenerated capture or evidence of real supplier/producer success.
const html = existsSync(capturedFixture) ? readFileSync(capturedFixture, "utf8") : syntheticLcscReferencePage();
const expected = { partNumber: "STE145N65M5", brand: "ST" };
const url = "https://so.szlcsc.com/global.html?k=STE145N65M5";
afterEach(() => { vi.clearAllMocks(); });
describe("native public worker complete quote/proof output (offline mocked synthetic/captured page boundary, NOT live proof)", () => {
  it("returns the full exact quote with an actual HTML digest and source URL, including largest tier and true stock", async () => {
    vi.mocked(readPublicReferencePage).mockResolvedValue({ html, url });
    const result = await fetchPublicReferenceEvidence("lcsc", expected);
    expect(validCachedReference(result.quote, "lcsc", expected)).toBe(true);
    expect(result).toMatchObject({ sourcePageUrl: url, sourceSha256: createHash("sha256").update(html).digest("hex"), quote: { status: "ok", matchedBrand: "ST(意法半导体)", stockQuantity: 44, unitPrice: "184.21", tiers: [{ minQuantity: 1, unitPrice: "191.09" }, { minQuantity: 30, unitPrice: "184.21" }] } });
    const settle = vi.mocked(readPublicReferencePage).mock.calls[0][4]!;
    expect(settle({ html, url })).toBe("quote");
    expect(settle({ html: "<html><title>Loading</title><body></body></html>", url })).toBe(false);
    expect(readPublicReferencePage).toHaveBeenCalledTimes(1);
  });
  it("challenge errors stop once with truthful restricted status and no fabricated source/stock", async () => {
    vi.mocked(readPublicReferencePage).mockRejectedValue(new PublicPageRestrictedError("Synthetic offline restriction"));
    const result = await fetchPublicReferenceEvidence("lcsc", expected);
    expect(result).toMatchObject({ quote: { status: "access_restricted", stockQuantity: null, unitPrice: null, pageUrl: null }, sourceSha256: null, sourcePageUrl: null });
    expect(validCachedReference(result.quote, "lcsc", expected)).toBe(true); expect(readPublicReferencePage).toHaveBeenCalledTimes(1);
  });
  it("retains the old quote-only function while preserving full suffix and wrong-brand guards", async () => {
    vi.mocked(readPublicReferencePage).mockResolvedValue({ html, url });
    const exact = await fetchPublicReferenceQuote("lcsc", expected);
    expect(exact.status).toBe("ok"); expect(exact).not.toHaveProperty("sourceSha256");
    for (const identity of [{ ...expected, partNumber: expected.partNumber + "/NOPB" }, { ...expected, brand: "ST(先科)" }]) {
      const rejected = await fetchPublicReferenceQuote("lcsc", identity);
      expect(rejected.status).toBe("not_found"); expect(rejected.stockQuantity).toBeNull(); expect(rejected.unitPrice).toBeNull();
    }
  });
});
