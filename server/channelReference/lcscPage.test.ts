import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  discoverLcscProductLinks,
  normalizeLcscBrand,
  normalizeLcscPartNumber,
  parseLcscProductPage,
} from "./lcscPage";

const URL = "https://item.szlcsc.com/173890.html";
const EXPECTED = { partNumber: "GRM32EB31C476KE15L", brand: "muRata(村田)" };

// Minimal shape copied from the public SSR __NEXT_DATA__ and rendered purchase
// panel saved on 2026-11-14. These fixtures contain no request/auth/token values.
const WEB_DATA = {
  productRecord: {
    productId: "173890", productModel: "GRM32EB31C476KE15L",
    productGradePlateName: "muRata(村田)", productCode: "C162509",
    productArrange: "编带", encapsulationModel: "1210", productUnit: "个",
    stockNumber: 39, validStockNumber: 7, encaptionPrice: 1271.1,
    minBuyNumber: 1, theRatio: 5,
  },
  totalStockNumber: 35, gdWarehouseStockNumber: 35, jsWarehouseStockNumber: 0,
  smtStockNumber: 78,
};
function embedded(webData: unknown = WEB_DATA, other: Record<string, unknown> = {}): string {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { webData, pageUrl: URL, price: 1.6757,
      similarProductRecommend: { similarProductList: [{ productModel: "GRM32EB31C476ME15L", productCode: "C162510", stockNumber: 23715, price: 0.01 }] },
      ...other,
    } },
  })}</script>`;
}
const IDENTITY_DOM = `<dl>
 <div><dt>品牌名称</dt><dd><a>muRata(村田)</a></dd></div>
 <div><dt>商品型号</dt><dd title="GRM32EB31C476KE15L">GRM32EB31C476KE15L</dd></div>
 <div><dt>商品编号</dt><dd>C162509</dd></div>
 <div><dt>商品封装</dt><dd>1210\u200b</dd></div>
 <div><dt>包装方式</dt><dd>编带</dd></div>
</dl>`;
function priceRow(quantity: string, price: string, reelPrice = ""): string {
  return `<div><span>${quantity}</span><span>${price}</span><span>${reelPrice}</span></div>`;
}
const TABLE = `<div><div><span>梯度</span><span>售价</span><span>折合1圆盘</span></div>
 <div>${priceRow("5+", "￥2.3068")}${priceRow("50+", "￥1.865")}${priceRow("150+", "￥1.6757")}</div></div>`;
function panel(table = TABLE, stock = "35", more = ""): string {
  return `<section data-spm="gm" data-anchor-id="gm"><h3>最新价格</h3>${table}
   <div><div><h3>库存总量</h3><span>(单位：个)</span></div><div><span>现货：${stock}</span></div><div>最快4小时发货</div></div>
   <h3>优惠活动</h3><span>运 9元</span><h3>总价金额：</h3><span>￥ 0.00</span>${more}</section>`;
}
const RECOMMENDATIONS = `<table><tr><td>GRM32EB31C476ME15L</td><td>现货：23,715</td><td>￥0.01</td></tr></table>`;
function document(body: string, scripts = embedded()): string {
  return `<html><head><title>GRM32EB31C476KE15L-立创商城</title>${scripts}</head><body>${body}</body></html>`;
}
const RENDERED = document(`${IDENTITY_DOM}<span title="嘉立创库存78">SMT补贴 嘉立创库存78</span><span>下单最高享92折</span>${panel()}${RECOMMENDATIONS}`);
it("synthetic approved XKB full literal is matched without changing original MPN/observed brand", () => {
  const html = RENDERED.replaceAll("muRata(村田)", "XKB Connection(中国星坤)");
  const expected = { ...EXPECTED, brand: "XKB" };
  const found = parseLcscProductPage(html, URL, expected);
  expect(found.status).toBe("ok"); expect(found.brand).toBe("XKB Connection(中国星坤)");
  expect(found.matchedPartNumber).toBe(EXPECTED.partNumber);
  expect(parseLcscProductPage(html.replaceAll("XKB Connection(中国星坤)", "XKB Connection(中国星坤)/Other"), URL, expected).status).toBe("unmatched");
});
const TIERS = [
  { minQuantity: 5, unitPrice: "2.3068" },
  { minQuantity: 50, unitPrice: "1.865" },
  { minQuantity: 150, unitPrice: "1.6757" },
];
const parse = (html: string) => parseLcscProductPage(html, URL, EXPECTED);

describe("parseLcscProductPage public HTML", () => {
  it("extracts the observed correct SKU, sale stock and quantity-qualified prices", () => {
    expect(parse(RENDERED)).toMatchObject({
      source: "lcsc", pageUrl: URL, matchedPartNumber: EXPECTED.partNumber, brand: EXPECTED.brand,
      productCode: "C162509", packaging: "编带", packageName: "1210", stockQuantity: 35,
      currency: "CNY", unit: "个", taxStatus: "unknown", tiers: TIERS, status: "ok",
      stockSource: "purchase_panel", priceSource: "purchase_panel",
    });
  });
  it("marks ALL thresholds beyond stock, retaining rather than suppressing the maximum 150 tier", () => {
    expect(parse(RENDERED).warnings).toEqual([
      "tier_min_quantity_exceeds_stock:50", "tier_min_quantity_exceeds_stock:150",
    ]);
  });
  it("SSR stock is totalStockNumber, NOT stockNumber39, validStock7, SMT78 or warehouse inference", () => {
    expect(parse(document(IDENTITY_DOM))).toMatchObject({ status: "price_unavailable", stockQuantity: 35,
      stockSource: "next_data_total", currency: null, tiers: [], priceSource: "unavailable" });
  });
  it("does NOT fabricate quantity 1 for the SEO/pageProps.price 1.6757", () => {
    const result = parse(document(IDENTITY_DOM));
    expect(result.tiers).toEqual([]);
    expect(result.warnings).toContain("quantity_qualified_prices_not_in_public_html");
  });
  it("rendered DOM alone remains sufficient with strict labeled product identity", () => {
    expect(parse(document(IDENTITY_DOM + panel(), ""))).toMatchObject({ status: "ok", stockQuantity: 35,
      productCode: "C162509", packageName: "1210", packaging: "编带", unit: "个", tiers: TIERS });
  });
  it("unrelated script JS is never evaluated", () => {
    expect(parse(document(IDENTITY_DOM + panel(), `<script>throw new Error('must not execute');<div>broken</div></script>`)).status).toBe("ok");
  });
  it("preserves decimal strings including trailing zero and > JS number precision", () => {
    const table = TABLE.replace("￥2.3068", "￥2.306800000000000000000001");
    expect(parse(document(IDENTITY_DOM + panel(table))).tiers[0].unitPrice).toBe("2.306800000000000000000001");
  });
  it("uses price column 2, never the折合1圆盘 or total/freight/discount amounts", () => {
    const table = TABLE.replace("￥2.3068</span><span></span>", "￥2.3068</span><span>￥9999.00</span>");
    expect(parse(document(IDENTITY_DOM + panel(table), embedded())).tiers).toEqual(TIERS);
  });
  it("rejects a partial target MPN instead of substring matching", () => {
    expect(parseLcscProductPage(RENDERED, URL, { ...EXPECTED, partNumber: "GRM32EB31C476" }).status).toBe("unmatched");
  });
  it("rejects wrong brand and a blank expected brand", () => {
    expect(parseLcscProductPage(RENDERED, URL, { ...EXPECTED, brand: "TDK" }).status).toBe("unmatched");
    expect(parseLcscProductPage(RENDERED, URL, { ...EXPECTED, brand: "" }).status).toBe("parse_error");
  });
  it("normalizes case and full-width parentheses using an explicit Murata alias family", () => {
    expect(parseLcscProductPage(RENDERED, URL, { partNumber: " grm32eb31c476ke15l ", brand: "Murata（村田）" }).status).toBe("ok");
    expect(parseLcscProductPage(RENDERED, URL, { ...EXPECTED, brand: "村田" }).status).toBe("ok");
  });
  it("does not strip significant MPN suffix punctuation or internal spaces", () => {
    expect(parseLcscProductPage(RENDERED, URL, { ...EXPECTED, partNumber: `${EXPECTED.partNumber}-TR` }).status).toBe("unmatched");
    expect(normalizeLcscPartNumber("ABC -01")).not.toBe(normalizeLcscPartNumber("ABC-01"));
    expect(normalizeLcscBrand("TDK Corporation")).not.toBe(normalizeLcscBrand("TDK"));
  });
  it("reports conflicting DOM and embedded MPN as ambiguous, never taking recommendation identity", () => {
    expect(parse(document(IDENTITY_DOM.replaceAll(EXPECTED.partNumber, "GRM32EB31C476ME15L") + panel())).status).toBe("ambiguous");
  });
  it("reports conflicting main-product SKU as ambiguous", () => {
    expect(parse(document(IDENTITY_DOM.replace("C162509", "C162510") + panel())).status).toBe("ambiguous");
  });
  it("rejects embedded identity for a different product URL", () => {
    expect(parse(document(IDENTITY_DOM + panel(), embedded({ ...WEB_DATA,
      productRecord: { ...WEB_DATA.productRecord, productId: "173891" },
    }))).status).toBe("ambiguous");
  });
  it("rejects a mismatching SSR canonical pageUrl", () => {
    expect(parse(document(IDENTITY_DOM + panel(), embedded(WEB_DATA, { pageUrl: "https://item.szlcsc.com/173891.html" }))).status).toBe("ambiguous");
  });
  it("does not consider a target MPN only appearing in recommendations an accepted match", () => {
    expect(parse(document(`<a href="${URL}">${EXPECTED.partNumber}</a>`, "")).status).toBe("unmatched");
  });
  it("keeps missing stock unknown, not zero or SEO/SMT stock", () => {
    const { totalStockNumber: _total, ...webData } = WEB_DATA;
    expect(parse(document(IDENTITY_DOM, embedded(webData))).stockQuantity).toBeNull();
  });
  it("preserves explicitly observed zero stock", () => {
    expect(parse(document(IDENTITY_DOM + panel(TABLE, "0")))).toMatchObject({ status: "ok", stockQuantity: 0, tiers: TIERS });
  });
  it("prefers current rendered stock over stale embedded total and records the override", () => {
    const result = parse(document(IDENTITY_DOM + panel(TABLE, "34")));
    expect(result.stockQuantity).toBe(34);
    expect(result.warnings).toContain("dom_stock_overrides_embedded_total");
  });
  it("parses well-formed thousands-separated stock", () => {
    expect(parse(document(IDENTITY_DOM + panel(TABLE, "12,345"))).stockQuantity).toBe(12345);
  });
  it("ignores a malformed stock number instead of truncating it", () => {
    expect(parse(document(IDENTITY_DOM + panel(TABLE, "35,00"), "")).stockQuantity).toBeNull();
  });
  it("an unreadable visible stock region must not silently reuse the embedded snapshot", () => {
    const result = parse(document(IDENTITY_DOM + panel(TABLE, "--")));
    expect(result.stockQuantity).toBeNull();
    expect(result.stockSource).toBe("unavailable");
    expect(result.warnings).toContain("unreadable_panel_stock");
  });
  it("ignores an unsafe integer SSR stock", () => {
    expect(parse(document(IDENTITY_DOM, embedded({ ...WEB_DATA, totalStockNumber: "9007199254740992" }))).stockQuantity).toBeNull();
  });
  it("returns unavailable when one tier price is empty rather than presenting a partial table", () => {
    expect(parse(document(IDENTITY_DOM + panel(TABLE.replace("￥1.865", ""))))).toMatchObject({ status: "price_unavailable", tiers: [] });
  });
  it("does not treat zero total amount or zero quote as a unit price", () => {
    expect(parse(document(IDENTITY_DOM + panel(TABLE.replace("￥2.3068", "￥0.00"))))).toMatchObject({ status: "price_unavailable", tiers: [] });
  });
  it("rejects conflicting prices at the same minimum quantity", () => {
    const table = TABLE.replace("50+", "5+");
    expect(parse(document(IDENTITY_DOM + panel(table))).status).toBe("ambiguous");
  });
  it("sorts tiers by minimum quantity, NOT by cheapest price", () => {
    const table = TABLE.replace("￥1.6757", "￥9.9999");
    expect(parse(document(IDENTITY_DOM + panel(table))).tiers.at(-1)).toEqual({ minQuantity: 150, unitPrice: "9.9999" });
  });
  it("reports multiple purchasing panels as ambiguous", () => {
    expect(parse(document(IDENTITY_DOM + panel() + panel())).status).toBe("ambiguous");
  });
  it("reports multiple candidate price tables inside a purchase panel as ambiguous", () => {
    expect(parse(document(IDENTITY_DOM + panel(TABLE + TABLE))).status).toBe("ambiguous");
  });
  it.each(["含税", "不含税", "未税", "", "含税 不含税"])("tax status is explicit/unknown for %s", text => {
    const expected = text === "含税" ? "included" : ["不含税", "未税"].includes(text) ? "excluded" : "unknown";
    expect(parse(document(IDENTITY_DOM + panel(TABLE, "35", `<p>${text}</p>`))).taxStatus).toBe(expected);
  });
  it("JSON-LD identifies only a URL-bound exact main product but never supplies inferred sale tiers/stock", () => {
    const ld = `<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "Product", url: URL,
      mpn: EXPECTED.partNumber, sku: "C162509", brand: { name: EXPECTED.brand },
      offers: { price: 1.6757, priceCurrency: "CNY", inventoryLevel: { value: 39 } },
    }] })}</script>`;
    expect(parse(document("", ld))).toMatchObject({ status: "price_unavailable", productCode: "C162509", stockQuantity: null, currency: null, tiers: [] });
  });
  it.each([
    "<html><head><title>403 Forbidden</title></head><body>Forbidden</body></html>",
    "<html><body>尝试太多了 2s后自动为您刷新验证码</body></html>",
    "<html><body>Processing your request. Powered and protected by</body></html>",
  ])("reports public access challenge without trying to bypass it", html => {
    expect(parse(html)).toMatchObject({ status: "access_restricted", stockQuantity: null, tiers: [] });
  });
  it("empty HTML is a parse error, not a zero stock/no-match supplier", () => {
    expect(parse("")).toMatchObject({ status: "parse_error", stockQuantity: null, tiers: [] });
  });
  it("malformed embedded JSON without identity fails closed", () => {
    expect(parse(document("", '<script id="__NEXT_DATA__">{bad</script>')).status).toBe("parse_error");
  });
  it("allows valid DOM even when unused embedded JSON is malformed", () => {
    expect(parse(document(IDENTITY_DOM + panel(), '<script id="__NEXT_DATA__">{bad</script>')).status).toBe("ok");
  });
  it.each(["http://item.szlcsc.com/173890.html", "https://evil.example/173890.html", "https://api.szlcsc.com/173890.html"])("rejects unexpected/non-public item page URL %s", url => {
    expect(parseLcscProductPage(RENDERED, url, EXPECTED).status).toBe("parse_error");
  });
  it("decodes HTML decimal currency/entity and zero-width package characters", () => {
    const html = document(IDENTITY_DOM + panel(TABLE.replace("￥2.3068", "&#xffe5;2.3068")));
    expect(parse(html).tiers).toEqual(TIERS);
    expect(parse(html).packageName).toBe("1210");
  });
});

describe("discoverLcscProductLinks permitted HTML candidate extraction", () => {
  it("accepts only exact full-MPN anchor/title and strips tracking query from canonical item URLs", () => {
    const html = `<a href="${URL}?spm=sc.it.tj.2&amp;lcsc_vid=tracking">${EXPECTED.partNumber}</a>
      <a href="//item.szlcsc.com/173890.html" title="${EXPECTED.partNumber}">详情</a>
      <a href="https://item.szlcsc.com/173891.html">GRM32EB31C476ME15L</a>
      <a href="https://api.szlcsc.com/173890.html">${EXPECTED.partNumber}</a>
      <a href="https://evil.example/173890.html">${EXPECTED.partNumber}</a>`;
    expect(discoverLcscProductLinks(html, "https://list.szlcsc.com/brand/79.html", EXPECTED.partNumber)).toEqual([URL]);
  });
  it("rejects a substring target and a missing link", () => {
    expect(discoverLcscProductLinks(`<a href="${URL}">${EXPECTED.partNumber}</a>`, URL, "GRM32EB31C476")).toEqual([]);
    expect(discoverLcscProductLinks(`<span>${EXPECTED.partNumber}</span>`, URL, EXPECTED.partNumber)).toEqual([]);
  });
});

// Optional full, unmodified public fixtures live OUTSIDE the repository by task
// authorization. Default unit tests remain portable and network-free.
const fixtureDirectory = process.env.LCSC_FIXTURE_DIR;
describe.skipIf(!fixtureDirectory)("captured real public LCSC HTML fixtures", () => {
  it("parses the parent's actually rendered product page with 35 stock and 5/50/150 tiers", () => {
    const html = readFileSync(join(fixtureDirectory!, "lcsc-rendered-product-173890.html"), "utf8");
    expect(parse(html)).toMatchObject({ status: "ok", productCode: "C162509", stockQuantity: 35, tiers: TIERS, taxStatus: "unknown" });
  });
  it("raw HTTP SSR reports stock 35 but no quantity-qualified price tiers", () => {
    const html = readFileSync(join(fixtureDirectory!, "lcsc-raw-product-173890.html"), "utf8");
    expect(parse(html)).toMatchObject({ status: "price_unavailable", productCode: "C162509", stockQuantity: 35,
      stockSource: "next_data_total", tiers: [], currency: null });
  });
});
