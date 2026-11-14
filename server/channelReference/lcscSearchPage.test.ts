import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseLcscSearchPage } from "./lcscSearchPage";

const URL = "https://so.szlcsc.com/global.html?k=GRM32EB31C476KE15L";
const ITEM = "https://item.szlcsc.com/173890.html";
const EXPECTED = { partNumber: "GRM32EB31C476KE15L", brand: "muRata(村田)" };
const TIERS = [
  { minQuantity: 5, unitPrice: "2.3068" },
  { minQuantity: 50, unitPrice: "1.865" },
  { minQuantity: 150, unitPrice: "1.6757" },
];
// SYNTHETIC semantic row shapes. These are NOT captured live search markup;
// the unmodified captured raw HTTP challenge is tested separately below.
function tier(quantity: string, price: string): string {
  return `<div><span>${quantity}</span><span>${price}</span><span>￥9999.00</span></div>`;
}
const TABLE = `<div class="pricing"><h4>梯度(含税)</h4><div>
  ${tier("5+", "￥2.3068")}${tier("50+", "￥1.865")}${tier("150+", "￥1.6757")}
</div></div>`;
function row(options: { mpn?: string; brand?: string; sku?: string; url?: string; stock?: string; table?: string; input?: string; more?: string } = {}): string {
  return `<li class="product-item"><dl>
    <div><dt>商品型号</dt><dd><a href="${options.url ?? ITEM}">${options.mpn ?? EXPECTED.partNumber}</a></dd></div>
    <div><dt>品牌</dt><dd><a href="https://list.szlcsc.com/brand/79.html">${options.brand ?? EXPECTED.brand}</a></dd></div>
    <div><dt>立创编号</dt><dd>${options.sku ?? "C162509"}</dd></div>
    <div><dt>封装</dt><dd>1210</dd></div>
    <div><dt>包装</dt><dd>1000个/圆盘</dd></div>
  </dl><div>现货${options.stock ?? "35"}个</div>
  ${options.table ?? TABLE}<div class="purchase">${options.input ?? '<input type="number" value="5"/><span>个</span>'}</div>
  <span>SMT库78</span><span>优惠92折</span><span>总额￥11.53</span><span>运费9元</span>${options.more ?? ""}</li>`;
}
function document(content: string, scripts = ""): string {
  return `<html><head><title>立创商城搜索</title>${scripts}</head><body>${content}</body></html>`;
}
function self(rows = row(), heading = "自营商品 1"): string {
  return `<section><h2>${heading}</h2><ul>${rows}</ul></section>`;
}
const parse = (html: string) => parseLcscSearchPage(html, URL, EXPECTED);

// SYNTHETIC reduced copy of the captured DOM's boundaries, not a live fixture.
const OBSERVED_HEADERS = ["型号/品牌/封装/类目", "参数/描述", "优惠券/标签", "价格梯度(含税)", "库存交期", "操作"];
function observedShape(options: { table?: string; unit?: string; header?: string; moreGroups?: string } = {}): string {
  const table = options.table ?? `<ul>${TIERS.map(tier => `<li><label>${tier.minQuantity}+<span></span></label><span>￥${tier.unitPrice}</span></li>`).join("")}</ul>`;
  const headers = OBSERVED_HEADERS.map(text => `<li><h2>${text === "价格梯度(含税)" ? options.header ?? text : text}</h2></li>`).join("");
  return document(`<span>自营结果数<span></span><span>1</span></span><div><div><ul>${headers}</ul></div>
    <div class="product-group-leader"><div data-custom-data='{"productType":"main","productId":"173890"}'>
    <section data-spm="zy"><div><div>
      <a href="${ITEM}"><span><span>${EXPECTED.partNumber}</span></span></a>
      <dl><dt>品牌</dt><span></span><dd>${EXPECTED.brand}</dd></dl>
      <dl><dt>封装</dt><span></span><dd>1210</dd></dl>
      <dl><dt>编号</dt><span></span><dd>C162509</dd></dl>
      <button>替代料（85）</button><span>SMT库存78</span>
    </div><div>${table}</div><div><dl><dt>现货</dt><span></span><dd>35</dd></dl><p>1000个/圆盘</p></div>
    <div><div class="ant-input-number-wrapper ant-input-number-group"><div><div><input role="spinbutton"/></div></div>
      <div class="ant-input-number-group-addon"><div><span class="ant-select-selection-item" title="${options.unit ?? "个"}">${options.unit ?? "个"}</span></div></div>
    </div><p>总额￥11.53</p></div></div></section></div></div>${options.moreGroups ?? ""}</div>`);
}

describe("captured-DOM-shaped synthetic boundaries", () => {
  it("binds price to the real-style main row and its sibling list header", () => {
    expect(parse(observedShape())).toMatchObject({ status: "ok", stockQuantity: 35, tiers: TIERS,
      unit: "个", taxStatus: "included", productCode: "C162509", packaging: "1000个/圆盘", packageName: "1210" });
  });
  it("a main card still loading has no inferred SEO price", () => {
    expect(parse(observedShape({ table: "" }))).toMatchObject({ status: "price_unavailable", stockQuantity: 35, tiers: [] });
  });
  it("an empty real-style LI price invalidates the entire ladder, not just that tier", () => {
    const table = '<ul><li><label>5+<span></span></label><span>￥2.3068</span></li><li><label>50+<span></span></label><span></span></li></ul>';
    expect(parse(observedShape({ table }))).toMatchObject({ status: "price_unavailable", tiers: [] });
  });
  it("an unknown or missing global price header cannot qualify a sale tier", () => {
    expect(parse(observedShape({ header: "活动最低价" }))).toMatchObject({ status: "price_unavailable", tiers: [], taxStatus: "unknown" });
  });
  it("missing purchase selector unit cannot borrow stock or packaging 个", () => {
    expect(parse(observedShape({ unit: "" }))).toMatchObject({ status: "price_unavailable", tiers: [], unit: null });
  });
  it("global un-taxed header remains unknown rather than relying on site convention", () => {
    expect(parse(observedShape({ header: "价格梯度" }))).toMatchObject({ status: "ok", tiers: TIERS, taxStatus: "unknown" });
  });
  it("a supplier-typed lookalike main card is never accepted", () => {
    expect(parse(observedShape().replace('"productType":"main"', '"productType":"supplier"')).tiers).toEqual([]);
  });
});

describe("parseLcscSearchPage synthetic semantic self-operated rows", () => {
  it("keeps product URL and separate actual source page provenance", () => {
    expect(parse(document(self()))).toMatchObject({ source: "lcsc", sourcePageUrl: URL, pageUrl: ITEM,
      matchedPartNumber: EXPECTED.partNumber, brand: EXPECTED.brand, productCode: "C162509", packageName: "1210",
      packaging: "1000个/圆盘", stockQuantity: 35, stockSource: "search_row", unit: "个", currency: "CNY",
      tiers: TIERS, taxStatus: "included", status: "ok", priceSource: "search_row" });
  });
  it("retains all tiers including maximum 150, flagging unavailable current stock", () => {
    const result = parse(document(self()));
    expect(result.tiers.at(-1)).toEqual(TIERS[2]);
    expect(result.warnings).toEqual(["tier_min_quantity_exceeds_stock:50", "tier_min_quantity_exceeds_stock:150"]);
  });
  it("changes actual values when the input changes; never returns hardcoded observed values", () => {
    expect(parse(document(self(row({ stock: "34", table: TABLE.replace("￥1.6757", "￥9.1234") }))))).toMatchObject({
      stockQuantity: 34, tiers: [TIERS[0], TIERS[1], { minQuantity: 150, unitPrice: "9.1234" }],
    });
  });
  it("ignores replacement, supplier and overseas rows even if their MPN/brand match", () => {
    const foreign = ["替代商品", "供应商商品", "海外商品"].map(heading => `<section><h2>${heading}</h2><ul>${row({ sku: "C999", stock: "23715", table: TABLE.replaceAll("2.3068", "0.01") })}</ul></section>`).join("");
    expect(parse(document(foreign + self()))).toMatchObject({ status: "ok", productCode: "C162509", stockQuantity: 35, tiers: TIERS });
  });
  it("ignores a recommendation region inside the self-operated scope", () => {
    const recommendation = `<div class="recommendation"><h3>推荐商品</h3><ul>${row({ sku: "C999" })}</ul></div>`;
    expect(parse(document(self(row() + recommendation)))).toMatchObject({ status: "ok", productCode: "C162509" });
  });
  it("never uses next-data, JSON-LD, SEO, freight, total, SMT stock or reel prices", () => {
    const scripts = '<script id="__NEXT_DATA__">{"price":0.01,"totalStockNumber":99999}</script><script type="application/ld+json">{"offers":{"price":0.01}}</script><meta itemprop="price" content="0.01"/>';
    expect(parse(document(self(), scripts))).toMatchObject({ stockQuantity: 35, tiers: TIERS });
  });
  it("does not infer tiers from a single SEO price or purchase MOQ", () => {
    expect(parse(document(self(row({ table: '<meta itemprop="price" content="1.6757"/>' }))))).toMatchObject({
      status: "price_unavailable", stockQuantity: 35, tiers: [], currency: null, priceSource: "unavailable",
    });
  });
  it("requires full MPN equality, preserving suffixes/punctuation", () => {
    for (const mpn of ["GRM32EB31C476", `${EXPECTED.partNumber}-TR`, "GRM32EB31C476ME15L"]) {
      expect(parse(document(self(row({ mpn })))).status).toBe("unmatched");
    }
  });
  it("matches only the explicit Murata alias family", () => {
    for (const brand of ["Murata", "村田", "Murata（村田）"]) {
      expect(parseLcscSearchPage(document(self()), URL, { ...EXPECTED, brand }).status).toBe("ok");
    }
    expect(parse(document(self(row({ brand: "TDK" })))).status).toBe("unmatched");
  });
  it("no recognizable brand is unavailable, not accepted or a definite negative", () => {
    const html = row().replace('<div><dt>品牌</dt><dd><a href="https://list.szlcsc.com/brand/79.html">muRata(村田)</a></dd></div>', "");
    expect(parse(document(self(html)))).toMatchObject({ status: "price_unavailable", tiers: [], matchedPartNumber: null });
  });
  it("conflicting brand labels in a target row are ambiguous", () => {
    expect(parse(document(self(row({ more: "<dl><dt>品牌</dt><dd>TDK</dd></dl>" })))).status).toBe("ambiguous");
  });
  it("conflicting labeled MPN and exact anchor are ambiguous", () => {
    expect(parse(document(self(row({ more: "<dl><dt>型号</dt><dd>DIFFERENT-01</dd></dl>" })))).status).toBe("ambiguous");
  });
  it("conflicting SKUs or multiple unique exact offers are ambiguous without merging", () => {
    expect(parse(document(self(row({ more: "<span>C162510</span>" })))).status).toBe("ambiguous");
    expect(parse(document(self(row() + row({ sku: "C162510", url: "https://item.szlcsc.com/173891.html" })))).status).toBe("ambiguous");
    expect(parse(document(self(row() + row({ stock: "34" })))).status).toBe("ambiguous");
    expect(parse(document(self(row() + row({ table: TABLE.replace("￥1.6757", "￥9.9") })))).status).toBe("ambiguous");
    expect(parse(document(self(row() + row({ table: "" })))).status).toBe("ambiguous");
  });
  it("allows wholly identical duplicate markup but never splices partial rows", () => {
    expect(parse(document(self(row() + row())))).toMatchObject({ status: "ok", stockQuantity: 35, tiers: TIERS });
  });
  it("normalizes official http/protocol-relative item links and strips tracking", () => {
    for (const url of ["http://item.szlcsc.com/173890.html?spm=tracking", "//item.szlcsc.com/173890.html?x=1&amp;y=2"]) {
      expect(parse(document(self(row({ url })))).pageUrl).toBe(ITEM);
    }
  });
  it.each(["https://item.szlcsc.com.evil.example/173890.html", "https://api.szlcsc.com/173890.html", "https://user:pass@item.szlcsc.com/173890.html", "javascript:alert(1)", "https://item.szlcsc.com:8443/173890.html", "https://item.szlcsc.com/member/173890.html"])("does not accept unverified item href %s", url => {
    expect(parse(document(self(row({ url })))).tiers).toEqual([]);
  });
  it("does not turn a missing/invalid SKU into a qualified price", () => {
    for (const sku of ["", "173890", "C12BAD"]) {
      expect(parse(document(self(row({ sku }))))).toMatchObject({ status: "price_unavailable", productCode: null, tiers: [] });
    }
  });
  it("does not use stock 个, pack 个, or hidden input to infer the price unit", () => {
    for (const input of ["", '<input type="hidden"/><span>个</span>', '<input type="number"/><span>数量</span>']) {
      expect(parse(document(self(row({ input }))))).toMatchObject({ status: "price_unavailable", unit: null, tiers: [], currency: null });
    }
  });
  it("reads a plain text 个 immediately after a purchase input", () => {
    expect(parse(document(self(row({ input: '<input type="text"/> 个' })))).unit).toBe("个");
  });
  it("conflicting purchase input units are ambiguous", () => {
    expect(parse(document(self(row({ input: '<input type="number"/><span>个</span><input type="text"/><span>盘</span>' })))).status).toBe("ambiguous");
  });
  it("keeps missing/invalid stock null, but preserves explicitly observed zero", () => {
    for (const stock of ["--", "35,00", "9007199254740992", "-1"]) {
      expect(parse(document(self(row({ stock }))))).toMatchObject({ status: "ok", stockQuantity: null, stockSource: "unavailable" });
    }
    expect(parse(document(self(row({ stock: "0" }))))).toMatchObject({ stockQuantity: 0, stockSource: "search_row" });
    expect(parse(document(self(row({ stock: "12,345" })))).stockQuantity).toBe(12345);
  });
  it("conflicting row-bound current stocks are ambiguous", () => {
    expect(parse(document(self(row({ more: "<div>现货34个</div>" })))).status).toBe("ambiguous");
  });
  it("preserves arbitrary decimal precision and trailing zeros", () => {
    const decimal = "2.30680000000000000000000100";
    expect(parse(document(self(row({ table: TABLE.replace("2.3068", decimal) })))).tiers[0].unitPrice).toBe(decimal);
  });
  it("sorts by quantity, not unit price, preserving the maximum quantity threshold", () => {
    expect(parse(document(self(row({ table: TABLE.replace("150+", "1000+").replace("1.6757", "99.999") })))).tiers.at(-1))
      .toEqual({ minQuantity: 1000, unitPrice: "99.999" });
  });
  it.each(["", "￥0.00", "￥NaN", "￥1e-3", "￥-1", "￥1,23", "1.865"])("rejects one invalid tier %s instead of outputting a partial ladder", price => {
    expect(parse(document(self(row({ table: TABLE.replace("￥1.865", price) }))))).toMatchObject({ status: "price_unavailable", tiers: [], currency: null });
  });
  it.each(["0+", "50,00+", "9007199254740992+"])("rejects an invalid quantity threshold %s", quantity => {
    expect(parse(document(self(row({ table: TABLE.replace("50+", quantity) }))))).toMatchObject({ status: "price_unavailable", tiers: [] });
  });
  it("conflicting quantity prices and multiple price tables are ambiguous", () => {
    expect(parse(document(self(row({ table: TABLE.replace("50+", "5+") })))).status).toBe("ambiguous");
    expect(parse(document(self(row({ table: TABLE + TABLE })))).status).toBe("ambiguous");
  });
  it.each(["含税", "不含税", "未税", ""])("tax comes only from the actual price header: %s", text => {
    const table = TABLE.replace("梯度(含税)", text ? `梯度(${text})` : "梯度");
    const taxStatus = text === "含税" ? "included" : text ? "excluded" : "unknown";
    expect(parse(document(self(row({ table, more: '<span>活动含税</span>' })))).taxStatus).toBe(taxStatus);
  });
  it("hidden alternate offer/tier markup cannot contaminate current visible prices", () => {
    const alternate = `<div hidden>${row({ sku: "C999" })}</div>`;
    const hiddenTier = '<div style="display:none"><span>5+</span><span>￥0.01</span></div>';
    expect(parse(document(self(row({ table: TABLE.replace("</h4>", `</h4>${hiddenTier}`) }) + alternate)))).toMatchObject({ status: "ok", tiers: TIERS });
  });
  it("does not execute scripts or treat HTML-like JS strings as sale DOM", () => {
    const scripts = `<script>throw new Error('must not run'); var html = '${row({ sku: "C999" })}';</script>`;
    expect(parse(document(self(), scripts))).toMatchObject({ status: "ok", tiers: TIERS });
  });
  it("unknown JS shell is unavailable, not unmatched or zero-stock", () => {
    expect(parse(document('<div id="app"></div>', '<script src="app.js"></script>'))).toMatchObject({
      status: "price_unavailable", matchedPartNumber: null, stockQuantity: null, tiers: [], currency: null,
    });
  });
  it("recognizable empty self results prove no match", () => {
    expect(parse(document(self("", "自营 0"))).status).toBe("unmatched");
  });
  it.each([
    '<html><head><title>403 Forbidden</title></head><body>Forbidden</body></html>',
    '<html><body>尝试太多了 2s后自动为您刷新验证码</body></html>',
    '<html><body>Processing your request. Powered and protected by</body></html>',
    '<html><head><script>var _xvasu=1;var _xvtsc=300;var _xvpfs="challenge";var _xvpts=1;</script></head><body></body></html>',
  ])("returns access_restricted for a challenge without solving/retrying it", html => {
    expect(parse(html)).toMatchObject({ status: "access_restricted", stockQuantity: null, tiers: [], currency: null });
  });
  it("empty HTML or invalid expected input fails closed", () => {
    expect(parse("").status).toBe("parse_error");
    expect(parseLcscSearchPage(document(self()), URL, { ...EXPECTED, brand: "" }).status).toBe("parse_error");
    expect(parseLcscSearchPage(document(self()), URL, { ...EXPECTED, partNumber: "" }).status).toBe("parse_error");
    expect(parse("x".repeat(8_000_001)).status).toBe("parse_error");
  });
  it.each(["http://so.szlcsc.com/global.html?k=x", "https://www.szlcsc.com/global.html?k=x", "https://api.szlcsc.com/global.html?k=x", "https://so.szlcsc.com/member/global.html?k=x", "https://user:pass@so.szlcsc.com/global.html?k=x", "https://so.szlcsc.com/global.html", "https://so.szlcsc.com/global.html?k=x&k=y"])("rejects non-search source URL %s", url => {
    expect(parseLcscSearchPage(document(self()), url, EXPECTED).status).toBe("parse_error");
  });
});

// Real fixtures remain outside the repo by explicit task authorization.
// No test mutates captured HTML to add or synthesize prices.
const fixtureDirectory = process.env.LCSC_FIXTURE_DIR;
describe.skipIf(!fixtureDirectory)("captured unmodified public LCSC search fixtures", () => {
  it("normal managed-browser rendered DOM really supplies 35 and 5/50/150 tax-inclusive tiers", () => {
    const buffer = readFileSync(join(fixtureDirectory!, "lcsc-rendered-search-grm32eb31c476ke15l.html"));
    expect(createHash("sha256").update(buffer).digest("hex")).toBe("44114438a55361853364c3c3e7e30f7e0829021e907acda5498e6b04a5f7ec97");
    expect(parse(buffer.toString("utf8"))).toMatchObject({ status: "ok", source: "lcsc", sourcePageUrl: URL,
      pageUrl: ITEM, matchedPartNumber: EXPECTED.partNumber, brand: EXPECTED.brand, productCode: "C162509",
      stockQuantity: 35, stockSource: "search_row", tiers: TIERS, priceSource: "search_row",
      currency: "CNY", unit: "个", packaging: "1000个/圆盘", packageName: "1210", taxStatus: "included",
      warnings: ["tier_min_quantity_exceeds_stock:50", "tier_min_quantity_exceeds_stock:150"],
    });
  });
  it("ordinary HTTP 203 challenge contains no current quote and is restricted", () => {
    const html = readFileSync(join(fixtureDirectory!, "lcsc-raw-search-grm32eb31c476ke15l.html"), "utf8");
    const meta = JSON.parse(readFileSync(join(fixtureDirectory!, "lcsc-raw-search-grm32eb31c476ke15l.meta.json"), "utf8"));
    expect(meta).toMatchObject({ status: 203, bytes: 4021 });
    expect(createHash("sha256").update(html).digest("hex")).toBe("35666bbd228cedb1d77ee9c01bd9e9be4f7849b4400e85160875100c033a17ff");
    expect(parse(html)).toMatchObject({ status: "access_restricted", matchedPartNumber: null, brand: null,
      productCode: null, stockQuantity: null, currency: null, tiers: [], priceSource: "unavailable", stockSource: "unavailable" });
  });
});
