import type { ChannelReferenceQuote, ChannelReferenceSource } from "../../shared/channelReference";
import { parseLcscSearchPage } from "./lcscSearchPage";
import { parseIckeySearchPage } from "./ickeyPage";
import { referenceSearchUrl, allowedReferencePageUrl, PublicPageRestrictedError } from "./publicPage";
import { readPublicReferencePage } from "./browserPage";

export function emptyReferenceQuote(source: ChannelReferenceSource, status: ChannelReferenceQuote["status"] = "pending"): ChannelReferenceQuote {
  return { source, status, matchedPartNumber: null, matchedBrand: null, productCode: null, pageUrl: null, stockQuantity: null, unitPrice: null, tierQuantity: null, tiers: [], currency: null, unit: null, taxStatus: "unknown", packaging: null, fetchedAt: null, expiresAt: null, stockInsufficientForTier: false, message: null };
}
export function parseReferenceQuote(source: ChannelReferenceSource, html: string, url: string, expected: { partNumber: string; brand: string }, fetchedAt = new Date().toISOString()): ChannelReferenceQuote {
  const raw = source === "lcsc" ? parseLcscSearchPage(html, url, expected) : parseIckeySearchPage(html, url, expected);
  const quote = emptyReferenceQuote(source, raw.status === "unmatched" ? "not_found" : raw.status === "parse_error" ? "unavailable" : raw.status);
  quote.fetchedAt = fetchedAt; quote.expiresAt = new Date(Date.parse(fetchedAt) + 20 * 60_000).toISOString();
  if (raw.status === "unmatched" || raw.status === "ambiguous" || raw.status === "access_restricted" || raw.status === "parse_error") return quote;
  quote.matchedPartNumber = raw.matchedPartNumber;
  quote.matchedBrand = "brand" in raw ? raw.brand : raw.matchedBrand;
  quote.productCode = raw.productCode; quote.packaging = raw.packaging;
  quote.pageUrl = allowedReferencePageUrl(source, raw.pageUrl) ? raw.pageUrl : null;
  quote.stockQuantity = raw.stockQuantity;
  quote.currency = ["CNY", "USD", "HKD"].includes(raw.currency ?? "") ? raw.currency as ChannelReferenceQuote["currency"] : null;
  quote.unit = raw.unit; quote.taxStatus = raw.taxStatus;
  quote.tiers = raw.tiers.map(t => ({ ...t })).sort((a, b) => a.minQuantity - b.minQuantity);
  const max = quote.tiers.at(-1);
  if (raw.status === "ok" && max && quote.currency && quote.pageUrl) {
    quote.unitPrice = max.unitPrice; quote.tierQuantity = max.minQuantity;
    quote.stockInsufficientForTier = quote.stockQuantity !== null && quote.stockQuantity < max.minQuantity;
  } else quote.status = "price_unavailable";
  return quote;
}
export async function fetchPublicReferenceQuote(source: ChannelReferenceSource, expected: { partNumber: string; brand: string }): Promise<ChannelReferenceQuote> {
  try {
    const page = await readPublicReferencePage(source, referenceSearchUrl(source, expected.partNumber));
    return parseReferenceQuote(source, page.html, page.url, expected);
  } catch (e) {
    const quote = emptyReferenceQuote(source, e instanceof PublicPageRestrictedError ? "access_restricted" : "unavailable");
    const fetchedAt = Date.now();
    quote.fetchedAt = new Date(fetchedAt).toISOString(); quote.expiresAt = new Date(fetchedAt + 20 * 60_000).toISOString();
    return quote;
  }
}

// Dedicated finite child process. It has no application/database/account imports.
if (process.argv[2] === "--public-reference-page") {
  const source = process.argv[3], partNumber = process.argv[4] ?? "", brand = process.argv[5] ?? "";
  if (!["lcsc", "ickey"].includes(source) || !partNumber.trim() || !brand.trim() || partNumber.length > 128 || brand.length > 64 || /[\u0000-\u001f\u007f]/.test(partNumber + brand)) {
    process.stderr.write("Invalid public reference request\n"); process.exitCode = 2;
  } else {
    fetchPublicReferenceQuote(source as ChannelReferenceSource, { partNumber, brand }).then(q => { process.stdout.write(JSON.stringify(q) + "\n"); }).catch(() => { process.stderr.write("Public reference unavailable\n"); process.exitCode = 1; });
  }
}
