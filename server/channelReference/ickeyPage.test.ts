import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseIckeyProductPage, parseIckeySearchPage } from "./ickeyPage";

const MPN = "GRM32EB31C476KE15L";
const expected = { partNumber: MPN, brand: "Murata" };
const url = `https://search.ickey.cn/?keyword=${MPN}`;
const header = '<div class="result-header"><div class="search-w-price">价格梯度</div><div class="search-w-hk">中国香港交货</div><div class="search-w-home">内地交货(含增值税)</div></div>';

/** SYNTHETIC cases built from verified public doT template class/attributes.
 * Prices, unit labels, stocks and SKU values below are test data, NOT ICKey quotes.
 * Unmodified real rendered positive/negative fixtures are tested separately below. */
function row(options: {
  mpn?: string; brand?: string; sku?: string; inventory?: string;
  quantities?: string[]; cny?: string[]; usd?: string[]; selected?: string;
  package?: string; unit?: string; supplier?: string; hidden?: boolean;
} = {}): string {
  const q = options.quantities ?? ["1+", "100+", "1000+"];
  const cny = options.cny ?? ["0.008760", "0.0075", "0.006250"];
  const usd = options.usd ?? [];
  const cells = (values: string[], prefix = "") => values.map(v => `<div class="search-result-bor">${prefix}<span>${v}</span></div>`).join("");
  return `<div class="result-list clearfix" data-sno="${options.mpn ?? MPN}" data-maf="${options.brand ?? "Murata"}" data-sku="${options.sku ?? "SYNTHETIC-SKU-1"}" data-stock="${options.inventory ?? "12,345"}" data-real-supplier="${options.supplier ?? "SYNTHETIC-SUPPLIER"}" ${options.hidden ? 'style="display:none"' : ""}>
    <ul><li>厂牌：<span>${options.brand ?? "Murata"}</span></li><li>封装：<span>${options.package ?? "1210"}</span></li><li class="store-num">库&nbsp;&nbsp;&nbsp;存：<span class="store-num-detail">${options.inventory ?? "12,345"}</span></li>
    ${options.unit === "" ? "" : `<li>销售单位：<span>${options.unit ?? "片"}</span></li>`}</ul>
    <div class="search-w-price">${cells(q)}</div><div class="search-w-home">${cells(cny, "￥")}</div><div class="search-w-hk">${cells(usd, "$")}</div>
    ${options.selected ? `<div class="search-w-delivery"><input type="radio" value="${options.selected}" checked><span>${options.selected === "1" ? "内地" : "香港"}</span></div>` : ""}
    <div class="search-w-num">标准包装数量: 1000 <span>合计：￥876.0000</span><input max="12345" value="1000"></div>
  </div>`;
}
function parse(body: string, requested = expected) { return parseIckeySearchPage(header + body, url, requested); }

const syntheticShell = `<html><head><title>${MPN}价格_库存</title><script type="application/ld+json">{"@type":"CollectionPage","hasPart":{"itemListElement":[]}}</script></head><body><input value="${MPN}" name="keyword"><div id="searchResult"></div><div id="searchNoResultTmpl" class="d-n hide shengge-hide"><div class="search-no-result-news">很抱歉，未找到“${MPN}”相关商品</div></div><script type="text/x-dot-template">${row()}</script><template id="productItem"><div v-for="item in list">{{ item.stock || 0 }} ￥{{item.rmb}}</div></template><div style="display:none" id="captcha">请完成安全验证</div></body></html>`;

describe("ICKey strict product identity and SKU isolation", () => {
  it("synthetic approved XKB rows preserve whole brand and distinct goods remain ambiguous", () => {
    const request = { ...expected, brand: "XKB" };
    const found = parse(row({ brand: "XKB Connection/中国星坤" }), request);
    expect(found.status).toBe("ok"); expect(found.matchedBrand).toBe("XKB Connection/中国星坤");
    expect(parse(row({ brand: "XKB Connection/中国星坤/Other" }), request).status).toBe("unmatched");
    const multiple = parse(row({ brand: "XKB Connection/中国星坤", sku: "ONE" }) + row({ brand: "XKB CONNECTION/中国星坤", sku: "TWO" }), request);
    expect(multiple.status).toBe("ambiguous"); expect(multiple.stockQuantity).toBeNull(); expect(multiple.tiers).toEqual([]);
  });
  it("preserves the exact suffix and full decimal strings on a uniquely matched row", () => {
    const result = parse(row());
    expect(result).toEqual({ source: "ickey", pageUrl: url, matchedPartNumber: MPN, matchedBrand: "Murata", productCode: "SYNTHETIC-SKU-1", packaging: "1210", stockQuantity: 12345, currency: "CNY", unit: "片", taxStatus: "included", tiers: [{ minQuantity: 1, unitPrice: "0.008760" }, { minQuantity: 100, unitPrice: "0.0075" }, { minQuantity: 1000, unitPrice: "0.006250" }], status: "ok" });
  });
  it("allows case/outer whitespace, not fuzzy manufacturer aliases", () => {
    expect(parse(row({ brand: "MURATA", mpn: MPN.toLowerCase() })).status).toBe("ok");
    expect(parse(row({ brand: "Murata Electronics" })).status).toBe("unmatched");
  });
  it.each([MPN.slice(0, -1), MPN.slice(0, -1) + "K", MPN + "-TR", MPN.replace("EB", "EC")])("rejects similar or suffix-changed part %s", mpn => {
    expect(parse(row({ mpn })).status).toBe("unmatched");
  });
  it("does not borrow another brand's inventory or quote", () => {
    const result = parse(row({ brand: "Other", sku: "OTHER", inventory: "999999", cny: ["0.0001"] }) + row({ inventory: "4" }));
    expect(result.status).toBe("ok"); expect(result.stockQuantity).toBe(4);
    expect(parse(row({ brand: "KOA" })).status).toBe("unmatched");
  });
  it("multiple exact-brand SKUs are ambiguous and not summed", () => {
    const result = parse(row({ sku: "A", inventory: "10" }) + row({ sku: "B", inventory: "20" }));
    expect(result.status).toBe("ambiguous"); expect(result.stockQuantity).toBeNull(); expect(result.tiers).toEqual([]);
  });
  it.each([
    { supplier: "DIFFERENT" }, { package: "Cut tape" }, { inventory: "22" }, { cny: ["0.1", "0.2", "0.3"] },
  ])("same SKU with conflicting evidence remains ambiguous: %j", change => {
    expect(parse(row() + row(change)).status).toBe("ambiguous");
  });
  it("deduplicates identical desktop/mobile representations only for a known SKU", () => {
    expect(parse(row() + row()).status).toBe("ok");
    expect(parse(row({ sku: "" }) + row({ sku: "" })).status).toBe("ambiguous");
  });
  it("ignores hidden competing SKUs and doT/Vue templates", () => {
    expect(parse(row() + row({ sku: "OTHER", hidden: true })).status).toBe("ok");
    expect(parse(`<script type="text/x-dot-template">${row({ sku: "OTHER" })}</script>` + row()).status).toBe("ok");
    expect(parse(`<template>${row({ sku: "OTHER" })}</template>` + row()).status).toBe("ok");
  });
});

describe("ICKey quantity, currency, unit and tax semantics", () => {
  it("sorts by minimum quantity, never treats the largest quantity as cheapest", () => {
    const result = parse(row({ quantities: ["1000+", "1+", "100+"], cny: ["0.90", "0.20", "0.10"] }));
    expect(result.tiers).toEqual([{ minQuantity: 1, unitPrice: "0.20" }, { minQuantity: 100, unitPrice: "0.10" }, { minQuantity: 1000, unitPrice: "0.90" }]);
  });
  it("does not use package count, selected purchase qty, max or total as tiers", () => {
    const result = parse(row());
    expect(result.tiers).toHaveLength(3); expect(result.tiers.some(t => t.minQuantity === 12345)).toBe(false);
    expect(result.tiers.some(t => t.unitPrice === "876.0000")).toBe(false);
  });
  it("requires one delivery/currency choice when both public price columns exist", () => {
    expect(parse(row({ usd: ["0.002", "0.0019", "0.0018"] })).status).toBe("ambiguous");
    const result = parse(row({ usd: ["0.002", "0.0019", "0.0018"], selected: "1" }));
    expect(result.status).toBe("ok"); expect(result.currency).toBe("CNY"); expect(result.tiers[0].unitPrice).toBe("0.008760");
  });
  it("selected Hong Kong prices keep USD and unknown tax; never convert to CNY", () => {
    const result = parse(row({ usd: ["0.00200", "0.0019", "0.0018"], selected: "2" }));
    expect(result.status).toBe("ok"); expect(result.currency).toBe("USD"); expect(result.taxStatus).toBe("unknown"); expect(result.tiers[0].unitPrice).toBe("0.00200");
  });
  it("does not invent a per-piece unit from an unlabeled stock integer", () => {
    const result = parse(row({ unit: "" }));
    expect(result.status).toBe("ok"); expect(result.unit).toBeNull(); expect(result.stockQuantity).toBe(12345);
    expect(result.currency).toBe("CNY"); expect(result.tiers).toEqual([
      { minQuantity: 1, unitPrice: "0.008760" }, { minQuantity: 100, unitPrice: "0.0075" }, { minQuantity: 1000, unitPrice: "0.006250" },
    ]);
  });
  it("unknown unit still requires a known SKU and the verified common price group", () => {
    expect(parse(row({ unit: "", sku: "" })).status).toBe("price_unavailable");
    const splitGroup = row({ unit: "" }).replace('<div class="search-w-home">', '<div><div class="search-w-home">')
      .replace('<div class="search-w-hk">', '</div><div class="search-w-hk">');
    expect(parse(splitGroup).status).toBe("price_unavailable");
  });
  it("competing price columns and a different price-panel SKU fail closed", () => {
    expect(parse(row().replace('<div class="search-w-num">', '<div class="search-w-home"><div class="search-result-bor">￥0.001</div></div><div class="search-w-num">')).status).toBe("ambiguous");
    expect(parse(row().replace('<div class="search-w-home">', '<div class="search-w-home" data-sku="OTHER">')).status).toBe("ambiguous");
  });
  it("accepts an explicit inventory unit without multiplying reel stock", () => {
    const result = parse(row({ inventory: "12卷", unit: "卷" }));
    expect(result.stockQuantity).toBe(12); expect(result.unit).toBe("卷");
  });
  it("conflicting inventory and pricing units fail closed", () => {
    expect(parse(row({ inventory: "12卷", unit: "片" })).status).toBe("ambiguous");
    expect(parse(row({ cny: ["0.10/卷", "0.09/卷", "0.08/卷"] })).status).toBe("ambiguous");
  });
  it.each(["99+", "10K", "约100", ">1000", "1.5", "9007199254740992", "12,34", "--"])('unknown/approximate/unsafe stock "%s" remains null', inventory => {
    expect(parse(row({ inventory })).stockQuantity).toBeNull();
  });
  it("zero is a real stock count, not missing", () => { expect(parse(row({ inventory: "0" })).stockQuantity).toBe(0); });
  it.each(["0.00", "-0.2", "1e-3", "面议", "0.1起", "1,234.56"])('does not fabricate decimal tiers for price "%s"', value => {
    const result = parse(row({ cny: [value, "0.02", "0.01"] }));
    expect(result.status).toBe("price_unavailable"); expect(result.tiers).toEqual([]);
  });
  it.each([{ quantities: ["0+", "100+", "1000+"] }, { quantities: ["1-99", "100+", "1000+"] }, { quantities: ["1+", "100+", "maxQty=1000"] }])("rejects unclear quantity lower bounds %j", ({ quantities }) => {
    expect(parse(row({ quantities })).status).toBe("price_unavailable");
  });
  it("does not zip mismatched quantity/price column lengths", () => {
    expect(parse(row({ cny: ["0.1"] })).status).toBe("price_unavailable");
  });
  it("conflicting prices at one minimum are ambiguous", () => {
    expect(parse(row({ quantities: ["1+", "1+", "100+"], cny: ["0.1", "0.2", "0.05"] })).status).toBe("ambiguous");
  });
  it("identical repeated tiers may be collapsed", () => {
    expect(parse(row({ quantities: ["1+", "1+", "100+"], cny: ["0.1", "0.1", "0.05"] })).tiers).toHaveLength(2);
  });
  it("without visible tax metadata does not assume included VAT", () => {
    expect(parseIckeySearchPage(row(), url, expected).taxStatus).toBe("unknown");
    expect(parseIckeySearchPage('<div class="result-header">内地交货(不含增值税)</div>' + row(), url, expected).taxStatus).toBe("excluded");
  });
  it("does not borrow tax claims from page agreement scripts", () => {
    expect(parseIckeySearchPage('<script>var note="含增值税";</script>' + row(), url, expected).taxStatus).toBe("unknown");
  });
  it("tax headers must be visible within the current result container", () => {
    expect(parseIckeySearchPage(header + `<div class="search-result-container">${row()}</div>`, url, expected).taxStatus).toBe("unknown");
    expect(parseIckeySearchPage(`<div class="search-result-container">${header}${row()}</div>`, url, expected).taxStatus).toBe("included");
    expect(parseIckeySearchPage(`<div class="search-result-container"><div hidden>${header}</div>${row()}</div>`, url, expected).taxStatus).toBe("unknown");
  });
  it("supports inert snapshots of the observed Vue productItem li structure", () => {
    const syntheticVue = `<div class="list rel fs-12 pt10 clearfix"><ul><li><a title="${MPN}" class="ellipsis fw-b theme-color">${MPN}</a></li><li>厂牌：<span>Murata</span></li><li>封装：1210</li><li>库&nbsp;&nbsp;&nbsp;存：<b>42片</b></li><li>起订量：1</li><li>标准包装数量：1000</li></ul><ul><li><div><span>1+</span></div><div><span>￥0.0008750</span></div></li><li><div><span>100+</span></div><div><span>￥0.0007500</span></div></li></ul><div><span class="checkedRadio"></span><span>内地2小时</span></div></div>`;
    const result = parse(syntheticVue);
    expect(result.status).toBe("ok"); expect(result.stockQuantity).toBe(42); expect(result.unit).toBe("片");
    expect(result.tiers).toEqual([{ minQuantity: 1, unitPrice: "0.0008750" }, { minQuantity: 100, unitPrice: "0.0007500" }]);
  });
  it("preserves internal manufacturer-name spaces in labeled DOM text", () => {
    const html = row({ brand: "Murata Electronics" }).replace('data-maf="Murata Electronics"', "");
    expect(parse(html, { partNumber: MPN, brand: "Murata Electronics" }).status).toBe("ok");
  });
});

describe("ICKey shell, restrictions and inert input handling", () => {
  it("a true raw shell is unavailable, not unmatched, zero-stock, or an exact match", () => {
    const result = parseIckeySearchPage(syntheticShell, url, expected);
    expect(result.status).toBe("price_unavailable"); expect(result.matchedPartNumber).toBeNull(); expect(result.stockQuantity).toBeNull(); expect(result.tiers).toEqual([]);
  });
  it("a visible confirmed no-result message is unmatched (not stock=0)", () => {
    const result = parse(`<div class="search-no-result-news">很抱歉，未找到“${MPN}”相关商品</div>`);
    expect(result.status).toBe("unmatched"); expect(result.stockQuantity).toBeNull();
  });
  it("unresolved Vue no-result directives are not evidence", () => {
    expect(parseIckeySearchPage(`<div v-show="isNoData" class="search-no-result-news">未能找到${MPN}</div><d-product></d-product>`, url, expected).status).toBe("price_unavailable");
  });
  it.each([
    '<html><title>403 Forbidden</title><body>Access Denied</body></html>',
    '<html><title>请完成安全验证</title><div id="captcha">点击验证</div></html>',
    '<div>登录后查看价格</div>',
  ])("visible restrictions return access_restricted", html => {
    expect(parseIckeySearchPage(html, url, expected).status).toBe("access_restricted");
  });
  it("a passport redirect is restricted but navbar login links are not", () => {
    expect(parseIckeySearchPage('<div>登录</div>', 'https://passport.ickey.cn/login/index', expected).status).toBe("access_restricted");
    expect(parse('<a href="https://passport.ickey.cn/login/index">登录</a>' + row()).status).toBe("ok");
  });
  it("does not execute scripts or call fetch", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const html = '<script>throw new Error("execution forbidden"); fetch("https://example.invalid/private-api")</script>' + row();
    expect(parse(html).status).toBe("ok"); expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
  });
  it("does not parse product-looking JSON or assignment scripts as public DOM rows", () => {
    expect(parseIckeySearchPage(`<script type="application/json">{"pro_sno":"${MPN}","maf_name":"Murata","stock":999,"rmb":[0.1]}</script><div id="searchResult"></div>`, url, expected).status).toBe("price_unavailable");
  });
  it.each(["", "not HTML", "<div", '<script>unterminated', "<div>".repeat(201)])("invalid or unsupported content returns parse_error", html => {
    expect(parseIckeySearchPage(html, url, expected).status).toBe("parse_error");
  });
  it.each(["http://search.ickey.cn/", "https://search.ickey.cn.evil.invalid/", "https://user@search.ickey.cn/", "https://search.ickey.cn:8443/", "invalid"])('rejects an invalid evidence URL "%s"', pageUrl => {
    expect(parseIckeySearchPage(row(), pageUrl, expected).status).toBe("parse_error");
  });
  it("unknown standalone product layouts are unsupported rather than pretending completion", () => {
    expect(parseIckeyProductPage(`<h1>${MPN}</h1><p>Murata 库存100 ￥0.1</p>`, 'https://www.ickey.cn/unverified-layout', expected).status).toBe("parse_error");
  });
  it("decodes HTML entities in explicit known fields", () => {
    expect(parse(row({ brand: "M&#117;rata" })).status).toBe("ok");
  });
  it("binds only a real row detail URL to the exact SKU/full part number", () => {
    const productUrl = `https://www.ickey.cn/detail/SYNTHETIC-SKU-1/${MPN}.html`;
    const html = row().replace('data-stock="12,345"', `data-stock="12,345" data-url="//www.ickey.cn/detail/SYNTHETIC-SKU-1/${MPN}.html"`);
    expect(parse(html).pageUrl).toBe(productUrl);
    expect(parse(html.replace('/detail/SYNTHETIC-SKU-1/', '/detail/OTHER/')).status).toBe("ambiguous");
    expect(parse(html.replace(`${MPN}.html`, `${MPN}-TR.html`)).status).toBe("ambiguous");
    expect(parse(html.replace('www.ickey.cn/detail', 'www.ickey.cn.evil.invalid/detail')).status).toBe("ambiguous");
    expect(parse(html.replace(`//www.ickey.cn/detail/SYNTHETIC-SKU-1/${MPN}.html`, '//www.ickey.cn/indent/index?sku=SYNTHETIC-SKU-1')).status).toBe("ambiguous");
  });
  it("conflicting visible manufacturer text is not rescued by row attributes", () => {
    expect(parse(row().replace('厂牌：<span>Murata</span>', '厂牌：<span>Other</span>')).status).toBe("ambiguous");
  });
});

// The two honest-UA raw fixtures live outside source by authorization. Ordinary
// CI can run all synthetic tests without them; this task ran these real-fixture
// tests too. Hash assertions prevent accidental replacement with made-up quotes.
const fixtureDir = process.env.ICKEY_FIXTURE_DIR ?? fileURLToPath(new URL("../../../navigation-channel-reference-20261114/", import.meta.url));
const fixtures = [
  ["ickey-search-grm32eb31c476ke15l.html", "4ac800b08394df5a2586c3974babe251440096d96af133d247597cecc7bfbf14", `https://search.ickey.cn/yuncang/search/index?keyword=${MPN}`],
  ["ickey-all-search-grm32eb31c476ke15l.html", "d37c0f67ccf13ab651e7e43b2e613162f63605d3cce0f955c624718564833aa6", url],
] as const;
for (const [filename, hash, pageUrl] of fixtures) {
  const path = `${fixtureDir}/${filename}`;
  it.skipIf(!existsSync(path))(`real public HTML ${filename}: hash and no fabricated data`, () => {
    const bytes = readFileSync(path);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(hash);
    const result = parseIckeySearchPage(bytes.toString("utf8"), pageUrl, expected);
    expect(result.status).toBe("price_unavailable"); expect(result.matchedPartNumber).toBeNull(); expect(result.stockQuantity).toBeNull(); expect(result.tiers).toEqual([]);
  });
}

// Full real rendered snapshots supplied by the parent: no HTML rewrite, injected
// unit labels, private JSON parsing, or invented product routes. Missing external
// evidence skips these tests in ordinary CI; hash assertions pin exact source bytes.
const browserFixtureDir = process.env.ICKEY_BROWSER_FIXTURE_DIR
  ?? fileURLToPath(new URL("../../../../browser_html/", import.meta.url));
const renderedGrmPath = `${browserFixtureDir}/search_ickey_cn_page_1794632436538.html`;
it.skipIf(!existsSync(renderedGrmPath))("real normal-browser GRM page: visible alternative is not the requested full MPN/brand", () => {
  const bytes = readFileSync(renderedGrmPath);
  expect(bytes.length).toBe(757647);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("0fcaf7049032d30750585ddbd4186241a99af022628ca04d068c18600a385352");
  const result = parseIckeySearchPage(bytes.toString("utf8"), url, expected);
  expect(result.status).toBe("unmatched");
  expect(result.matchedPartNumber).toBeNull(); expect(result.matchedBrand).toBeNull();
  expect(result.stockQuantity).toBeNull(); expect(result.tiers).toEqual([]);
  expect(result.pageUrl).toBe(url);
});

const csa = { partNumber: "CSA1210X5R476K160RT", brand: "HRE/江苏芯声" };
const renderedCsaPath = `${fixtureDir}/ickey-local-headless-csa1210.html`;
it.skipIf(!existsSync(renderedCsaPath))("real honest-UA non-stealth Chromium CSA page: unique SKU, visible CNY tiers, unknown unit/tax", () => {
  const bytes = readFileSync(renderedCsaPath);
  expect(bytes.length).toBe(800694);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("defac4e01f34152b46612052477f122a51bb4318699d18144361c3413d3395f4");
  const result = parseIckeySearchPage(bytes.toString("utf8"), `https://search.ickey.cn/?keyword=${csa.partNumber}`, csa);
  expect(result).toEqual({
    source: "ickey", pageUrl: "https://www.ickey.cn/detail/1003001041107739/CSA1210X5R476K160RT.html",
    matchedPartNumber: csa.partNumber, matchedBrand: csa.brand, productCode: "1003001041107739",
    packaging: null, stockQuantity: 5000, currency: "CNY", unit: null, taxStatus: "unknown", status: "ok",
    tiers: [{ minQuantity: 1000, unitPrice: "0.3334" }, { minQuantity: 3000, unitPrice: "0.3283" },
      { minQuantity: 5000, unitPrice: "0.3206" }, { minQuantity: 39000, unitPrice: "0.3026" }],
  });
  expect(result.tiers.at(-1)).toEqual({ minQuantity: 39000, unitPrice: "0.3026" });
  expect(parseIckeySearchPage(bytes.toString("utf8"), url, expected).status).toBe("unmatched");
});
