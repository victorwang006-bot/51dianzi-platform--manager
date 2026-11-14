/**
 * Pure parser for public item.szlcsc.com product HTML (SSR or rendered DOM).
 * No network, DOM runtime, script evaluation, private endpoints or price inference.
 * The observed SSR SEO price has NO quantity threshold and is deliberately ignored.
 */
export type LcscPageStatus =
  | "ok"
  | "unmatched"
  | "ambiguous"
  | "price_unavailable"
  | "access_restricted"
  | "parse_error";

export type LcscProductPageResult = {
  source: "lcsc";
  pageUrl: string;
  matchedPartNumber: string | null;
  brand: string | null;
  productCode: string | null;
  packaging: string | null;
  /** Physical package, e.g. 1210; packaging above is the sale arrangement, e.g. 编带. */
  packageName: string | null;
  stockQuantity: number | null;
  currency: "CNY" | null;
  unit: string | null;
  taxStatus: "included" | "excluded" | "unknown";
  tiers: Array<{ minQuantity: number; unitPrice: string }>;
  status: LcscPageStatus;
  warnings: string[];
  stockSource: "purchase_panel" | "next_data_total" | "unavailable";
  priceSource: "purchase_panel" | "unavailable";
};

export type LcscExpectedProduct = { partNumber: string; brand: string };

type HtmlNode = {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlNode | null;
  text: string;
};
type Identity = {
  partNumber: string;
  brand: string;
  productCode: string | null;
  packaging: string | null;
  packageName: string | null;
  unit: string | null;
};
type JsonRecord = Record<string, unknown>;

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    yen: "¥", plus: "+", colon: ":", lpar: "(", rpar: ")",
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1].toLowerCase() === "x";
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : all;
    }
    return named[entity.toLowerCase()] ?? all;
  });
}

function clean(value: string): string {
  return decodeHtml(value).normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ").trim();
}

/** Full-string equality only; never removes hyphens, slashes or suffixes. */
export function normalizeLcscPartNumber(value: string): string {
  return clean(value).toUpperCase();
}

/** Explicit observed alias family only. Unknown brands remain strict full strings. */
export function normalizeLcscBrand(value: string): string {
  const normalized = clean(value).toLowerCase().replace(/\s+/g, "");
  if (["murata", "村田", "murata(村田)", "村田(murata)"].includes(normalized)) {
    return "murata";
  }
  return normalized;
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && clean(value) ? clean(value) : null;
}
function quantity(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || !/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value.trim())) return null;
  const number = Number(value.replace(/,/g, ""));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function productPageId(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "item.szlcsc.com" || url.port || url.username || url.password) return null;
    return /^\/(\d+)\.html$/.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
}

/** Small non-executing HTML tokenizer. Scripts are raw text, never HTML/eval. */
function parseHtml(html: string): { nodes: HtmlNode[]; scripts: HtmlNode[] } {
  const root: HtmlNode = { tag: "#root", attrs: {}, children: [], parent: null, text: "" };
  const nodes = [root];
  const scripts: HtmlNode[] = [];
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>/gi;
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  let previous = 0;
  let match: RegExpExecArray | null;
  const addText = (value: string) => {
    if (value) {
      const parent = stack[stack.length - 1];
      const node: HtmlNode = { tag: "#text", attrs: {}, children: [], parent, text: clean(value) };
      parent.children.push(node);
      nodes.push(node);
    }
  };
  while ((match = token.exec(html))) {
    addText(html.slice(previous, match.index));
    previous = token.lastIndex;
    const raw = match[0];
    if (raw.startsWith("<!")) continue;
    const tag = /^<\/?([a-z][\w:-]*)/i.exec(raw)?.[1].toLowerCase();
    if (!tag) continue;
    if (raw.startsWith("</")) {
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tag === tag) { stack.length = index; break; }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    const attributes = raw.slice(tag.length + 1, raw.length - 1);
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attribute: RegExpExecArray | null;
    while ((attribute = pattern.exec(attributes))) {
      attrs[attribute[1].toLowerCase()] = decodeHtml(attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    const parent = stack[stack.length - 1];
    const node: HtmlNode = { tag, attrs, children: [], parent, text: "" };
    parent.children.push(node);
    nodes.push(node);
    if (["script", "style", "textarea", "title"].includes(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, "gi");
      close.lastIndex = previous;
      const end = close.exec(html);
      node.text = html.slice(previous, end?.index ?? html.length);
      if (tag === "script") scripts.push(node);
      else node.text = clean(node.text);
      token.lastIndex = end ? close.lastIndex : html.length;
      previous = token.lastIndex;
    } else if (!voidTags.has(tag) && !/\/\s*>$/.test(raw)) stack.push(node);
  }
  addText(html.slice(previous));
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (node.children.length) node.text = node.children
      .filter(child => !["script", "style", "noscript"].includes(child.tag))
      .map(child => child.text).join(" ").replace(/\s+/g, " ").trim();
  }
  return { nodes, scripts };
}
function within(node: HtmlNode, ancestor: HtmlNode): boolean {
  for (let current: HtmlNode | null = node; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}
function elements(node: HtmlNode): HtmlNode[] {
  return node.children.filter(child => child.tag !== "#text");
}
function identityKey(identity: Identity): string {
  return `${normalizeLcscPartNumber(identity.partNumber)}|${normalizeLcscBrand(identity.brand)}`;
}

export function parseLcscProductPage(
  html: string,
  url: string,
  expected: LcscExpectedProduct,
): LcscProductPageResult {
  const result: LcscProductPageResult = {
    source: "lcsc", pageUrl: url, matchedPartNumber: null, brand: null,
    productCode: null, packaging: null, packageName: null,
    stockQuantity: null, currency: null, unit: null, taxStatus: "unknown",
    tiers: [], status: "parse_error", warnings: [],
    stockSource: "unavailable", priceSource: "unavailable",
  };
  try {
    if (typeof html !== "string" || !html.trim() || html.length > 8_000_000) return result;
    const { nodes, scripts } = parseHtml(html);
    const body = nodes.find(node => node.tag === "body") ?? nodes[0];
    const titles = nodes.filter(node => node.tag === "title").map(node => node.text).join(" ");
    if (/403\s*(?:forbidden)?|access denied|forbidden|just a moment|安全验证|访问受限|验证访问/i.test(titles)
      || /尝试太多了|访问过于频繁|请完成安全验证|请滑动.*验证|访问被拒绝|access denied|powered and protected by|processing your request/i.test(body.text)
      || (/^(?:403\s*)?forbidden$/i.test(body.text))) {
      result.status = "access_restricted";
      return result;
    }
    const id = productPageId(url);
    if (!id || !normalizeLcscPartNumber(expected.partNumber) || !normalizeLcscBrand(expected.brand)) return result;
    const identities: Identity[] = [];
    let webData: JsonRecord | null = null;
    let malformedJson = false;
    for (const script of scripts.filter(node => node.attrs.id === "__NEXT_DATA__")) {
      let json: JsonRecord | null;
      try { json = record(JSON.parse(script.text)); } catch { malformedJson = true; continue; }
      const pageProps = record(record(json?.props)?.pageProps);
      const web = record(pageProps?.webData);
      const product = record(web?.productRecord);
      if (!product) continue;
      if (String(product.productId) !== id || (typeof pageProps?.pageUrl === "string" && productPageId(pageProps.pageUrl) !== id)) {
        result.status = "ambiguous";
        result.warnings.push("embedded_product_url_mismatch");
        return result;
      }
      const partNumber = str(product.productModel);
      const brand = str(product.productGradePlateName) ?? str(record(web?.brandVO)?.brandName);
      if (partNumber && brand) {
        identities.push({ partNumber, brand, productCode: str(product.productCode),
          packaging: str(product.productArrange), packageName: str(product.encapsulationModel), unit: str(product.productUnit) });
        webData = web;
      }
    }
    for (const dl of nodes.filter(node => node.tag === "dl")) {
      const pairs = new Map<string, string>();
      for (const dt of nodes.filter(node => node.tag === "dt" && within(node, dl))) {
        const siblings = dt.parent ? elements(dt.parent) : [];
        const dd = siblings[siblings.indexOf(dt) + 1];
        if (dd?.tag === "dd") pairs.set(clean(dt.text), clean(dd.text));
      }
      const partNumber = pairs.get("商品型号");
      const brand = pairs.get("品牌名称");
      if (partNumber && brand) identities.push({ partNumber, brand,
        productCode: pairs.get("商品编号") ?? null, packaging: pairs.get("包装方式") ?? null,
        packageName: pairs.get("商品封装") ?? null, unit: null });
    }
    // JSON-LD can identify the main product, but its inventory/SEO single price
    // are NOT the current sale-panel stock or a quantity-qualified price tier.
    for (const script of scripts.filter(node => node.attrs.type === "application/ld+json")) {
      let json: unknown;
      try { json = JSON.parse(script.text); } catch { malformedJson = true; continue; }
      const top = record(json);
      const candidates = Array.isArray(json) ? json : Array.isArray(top?.["@graph"]) ? top["@graph"] as unknown[] : [json];
      for (const candidate of candidates) {
        const product = record(candidate);
        const type = product?.["@type"];
        if (!(type === "Product" || Array.isArray(type) && type.includes("Product"))) continue;
        const productUrl = str(product?.url) ?? str(product?.["@id"]);
        if (!productUrl || productPageId(productUrl) !== id) continue;
        const partNumber = str(product?.mpn);
        const brand = str(record(product?.brand)?.name) ?? str(product?.brand);
        if (partNumber && brand) identities.push({ partNumber, brand, productCode: str(product?.sku), packaging: null, packageName: null, unit: null });
      }
    }
    if (!identities.length) {
      result.status = malformedJson ? "parse_error" : "unmatched";
      return result;
    }
    const keys = new Set(identities.map(identityKey));
    const codes = new Set(identities.map(identity => identity.productCode?.toUpperCase()).filter(Boolean));
    if (keys.size !== 1 || codes.size > 1) {
      result.status = "ambiguous";
      result.warnings.push("conflicting_main_product_identity");
      return result;
    }
    const target = `${normalizeLcscPartNumber(expected.partNumber)}|${normalizeLcscBrand(expected.brand)}`;
    if (!keys.has(target)) { result.status = "unmatched"; return result; }
    result.matchedPartNumber = identities[0].partNumber;
    result.brand = identities[0].brand;
    result.productCode = identities.find(identity => identity.productCode)?.productCode ?? null;
    result.packaging = identities.find(identity => identity.packaging)?.packaging ?? null;
    result.packageName = identities.find(identity => identity.packageName)?.packageName ?? null;
    result.unit = identities.find(identity => identity.unit)?.unit ?? null;
    const embeddedStock = quantity(webData?.totalStockNumber);
    if (embeddedStock !== null) {
      result.stockQuantity = embeddedStock;
      result.stockSource = "next_data_total";
    }
    const panels = nodes.filter(node => node.tag === "section" && node.attrs["data-spm"] === "gm" && node.text.includes("最新价格"));
    if (panels.length > 1) {
      result.status = "ambiguous";
      result.tiers = [];
      result.warnings.push("multiple_purchase_panels");
      return result;
    }
    const panel = panels[0];
    if (panel) {
      const panelNodes = nodes.filter(node => within(node, panel));
      const stockHeadings = panelNodes.filter(node => /^h[1-6]$/.test(node.tag) && clean(node.text) === "库存总量");
      if (stockHeadings.length === 1) {
        const region = stockHeadings[0].parent?.parent;
        const stocks = Array.from((region?.text ?? "").matchAll(/现货\s*[：:]\s*(\d{1,3}(?:,\d{3})+|\d+)(?![\d,])/g))
          .map(match => quantity(match[1])).filter((value): value is number => value !== null);
        if (stocks.length === 1) {
          if (result.stockQuantity !== null && result.stockQuantity !== stocks[0]) result.warnings.push("dom_stock_overrides_embedded_total");
          result.stockQuantity = stocks[0];
          result.stockSource = "purchase_panel";
        } else {
          result.stockQuantity = null;
          result.stockSource = "unavailable";
          result.warnings.push(stocks.length > 1 ? "ambiguous_panel_stock" : "unreadable_panel_stock");
        }
        const unit = /单位\s*[：:]\s*([^()\s]+)/.exec(region?.text ?? "")?.[1];
        if (unit) result.unit = unit;
      } else if (stockHeadings.length > 1) {
        result.stockQuantity = null;
        result.stockSource = "unavailable";
        result.warnings.push("ambiguous_panel_stock");
      }
      const headers = panelNodes.filter(node => {
        const cells = elements(node).map(child => clean(child.text));
        return cells[0] === "梯度" && cells[1] === "售价";
      });
      if (headers.length === 1 && headers[0].parent) {
        const priceTable = headers[0].parent;
        const prices = new Map<number, string>();
        let invalidRow = false;
        let conflict = false;
        for (const row of panelNodes.filter(node => within(node, priceTable) && node !== headers[0])) {
          const cells = elements(row).map(child => clean(child.text));
          const threshold = /^((?:\d{1,3}(?:,\d{3})+|\d+))\s*\+$/.exec(cells[0] ?? "");
          if (!threshold) continue;
          const minQuantity = quantity(threshold[1]);
          const price = /^[¥￥]\s*((?:0|[1-9]\d*)(?:\.\d+)?)$/.exec(cells[1] ?? "")?.[1];
          // Zero quotations/empty cells are not invented as valid free unit prices.
          if (minQuantity === null || minQuantity < 1 || !price || !/[1-9]/.test(price)) { invalidRow = true; continue; }
          const previous = prices.get(minQuantity);
          if (previous !== undefined && previous !== price) conflict = true;
          prices.set(minQuantity, price);
        }
        if (conflict) {
          result.status = "ambiguous";
          result.warnings.push("conflicting_quantity_prices");
          return result;
        }
        if (invalidRow) result.warnings.push("unreadable_price_tier");
        else result.tiers = Array.from(prices).map(([minQuantity, unitPrice]) => ({ minQuantity, unitPrice }))
          .sort((left, right) => left.minQuantity - right.minQuantity);
      } else if (headers.length > 1) {
        result.status = "ambiguous";
        result.warnings.push("ambiguous_price_tables");
        return result;
      }
      if (result.tiers.length) {
        result.currency = "CNY";
        result.priceSource = "purchase_panel";
        const included = /(?:含税|税已含)/.test(panel.text.replace(/不含税/g, ""));
        const excluded = /(?:不含税|未税|税另计)/.test(panel.text);
        result.taxStatus = included !== excluded ? included ? "included" : "excluded" : "unknown";
      }
    }
    if (result.stockQuantity !== null) {
      for (const tier of result.tiers) {
        if (tier.minQuantity > result.stockQuantity) result.warnings.push(`tier_min_quantity_exceeds_stock:${tier.minQuantity}`);
      }
    }
    if (!result.tiers.length) result.warnings.push("quantity_qualified_prices_not_in_public_html");
    result.status = result.tiers.length ? "ok" : "price_unavailable";
    return result;
  } catch {
    // Fail closed even on malformed/unexpected markup or caller input.
    return { ...result, stockQuantity: null, currency: null, tiers: [], status: "parse_error",
      stockSource: "unavailable", priceSource: "unavailable" };
  }
}

/**
 * Candidate discovery from an already fetched permitted public page only.
 * Full anchor text/title must match the requested MPN. Brand is verified later
 * by parseLcscProductPage; a link alone is NEVER an accepted supplier match.
 * Does not construct search URLs or follow links.
 */
export function discoverLcscProductLinks(html: string, baseUrl: string, partNumber: string): string[] {
  try {
    const expected = normalizeLcscPartNumber(partNumber);
    if (!expected || html.length > 8_000_000) return [];
    const { nodes } = parseHtml(html);
    const urls = new Set<string>();
    for (const node of nodes.filter(node => node.tag === "a" && node.attrs.href)) {
      if (![node.text, node.attrs.title ?? ""].some(value => normalizeLcscPartNumber(value) === expected)) continue;
      const url = new URL(node.attrs.href, baseUrl);
      if (productPageId(url.href)) urls.add(`${url.origin}${url.pathname}`);
    }
    return Array.from(urls);
  } catch { return []; }
}
