/**
 * Pure parser for permitted public so.szlcsc.com/global.html search HTML.
 * Reads visible, row-bound self-operated offers only; never evaluates scripts,
 * reads embedded/SEO prices, fetches URLs, or infers prices from pack/MOQ data.
 * A HTTP challenge or a JS shell is not evidence that a product is unmatched.
 */
import {
  matchesLcscBrand,
  normalizeLcscBrand,
  normalizeLcscPartNumber,
  type LcscExpectedProduct,
  type LcscProductPageResult,
} from "./lcscPage";

/** Same quote fields as the product parser, with honest search-row provenance. */
export type LcscSearchPageResult = Omit<LcscProductPageResult, "stockSource" | "priceSource"> & {
  sourcePageUrl: string;
  stockSource: "search_row" | "unavailable";
  priceSource: "search_row" | "unavailable";
};
type Node = {
  tag: string; attrs: Record<string, string>; children: Node[];
  parent: Node | null; text: string; hidden: boolean;
};
type Tier = LcscProductPageResult["tiers"][number];
const INTEGER = "(?:\\d{1,3}(?:,\\d{3})+|\\d+)";
const UNITS = /^(?:个|片|颗|只|米|套|支|卷|盘|包)$/;
const SKIP = new Set(["script", "style", "noscript", "template"]);

function decode(value: string): string {
  const entities: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    yen: "¥", plus: "+", colon: ":", lpar: "(", rpar: ")",
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, entity: string) => {
    if (entity[0] !== "#") return entities[entity.toLowerCase()] ?? all;
    const hex = entity[1].toLowerCase() === "x";
    const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : all;
  });
}
function clean(value: string): string {
  return decode(value).normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ").trim();
}
function integer(value: string): number | null {
  if (!new RegExp(`^${INTEGER}$`).test(value)) return null;
  const number = Number(value.replace(/,/g, ""));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function parseHtml(html: string): Node[] {
  const root: Node = { tag: "#root", attrs: {}, children: [], parent: null, text: "", hidden: false };
  const nodes = [root];
  const stack = [root];
  const voidTags = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>/gi;
  let previous = 0;
  let match: RegExpExecArray | null;
  const text = (value: string) => {
    const parent = stack[stack.length - 1];
    if (!value) return;
    const node: Node = { tag: "#text", attrs: {}, children: [], parent, text: clean(value), hidden: parent.hidden };
    parent.children.push(node); nodes.push(node);
  };
  while ((match = tokens.exec(html))) {
    if (nodes.length > 120_000) throw new Error("html_node_limit");
    text(html.slice(previous, match.index)); previous = tokens.lastIndex;
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
    const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let attr: RegExpExecArray | null;
    while ((attr = pattern.exec(raw.slice(tag.length + 1, -1)))) {
      attrs[attr[1].toLowerCase()] = decode(attr[2] ?? attr[3] ?? attr[4] ?? "");
    }
    const parent = stack[stack.length - 1];
    const hidden = parent.hidden || "hidden" in attrs || attrs["aria-hidden"] === "true"
      || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style ?? "");
    const node: Node = { tag, attrs, children: [], parent, text: "", hidden };
    parent.children.push(node); nodes.push(node);
    if (["script", "style", "textarea", "title", "template", "noscript"].includes(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, "gi"); close.lastIndex = previous;
      const end = close.exec(html);
      node.text = html.slice(previous, end?.index ?? html.length);
      if (tag === "title" || tag === "textarea") node.text = clean(node.text);
      tokens.lastIndex = end ? close.lastIndex : html.length; previous = tokens.lastIndex;
    } else if (!voidTags.has(tag) && !/\/\s*>$/.test(raw)) stack.push(node);
  }
  text(html.slice(previous));
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    if (node.children.length) node.text = node.children
      .filter(child => !child.hidden && !SKIP.has(child.tag))
      .map(child => child.text).join(" ").replace(/\s+/g, " ").trim();
  }
  return nodes;
}
function within(node: Node, ancestor: Node): boolean {
  for (let current: Node | null = node; current; current = current.parent) if (current === ancestor) return true;
  return false;
}
function visible(node: Node): boolean { return !node.hidden && !SKIP.has(node.tag) && node.tag !== "#text"; }
function children(node: Node): Node[] { return node.children.filter(visible); }
function searchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "so.szlcsc.com" && !url.port
      && !url.username && !url.password && url.pathname === "/global.html"
      && url.searchParams.getAll("k").length === 1 && !!clean(url.searchParams.get("k") ?? "");
  } catch { return false; }
}
function itemUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (!["https:", "http:"].includes(url.protocol) || url.hostname !== "item.szlcsc.com"
      || url.port || url.username || url.password || !/^\/\d+\.html$/.test(url.pathname)) return null;
    return `https://item.szlcsc.com${url.pathname}`;
  } catch { return null; }
}
const SELF = /^(?:立创\s*)?自营(?:商品|商城|列表|结果数|商品数|结果)?(?:\s*[:：]?\s*\(?\d+\)?\s*(?:个|件|条|款)?)?$/;
const FOREIGN = /^(?:供应商|海外|境外|替代|相似|推荐)(?:商品|产品|结果|列表|商城|直供|现货|购)?(?:\s*[:：]?\s*\(?\d+\)?\s*(?:个|件|条|款)?)?$/;
function marker(node: Node, pattern: RegExp): boolean {
  return visible(node) && node.text.length < 80 && pattern.test(clean(node.text))
    && !["a", "input", "option", "title"].includes(node.tag)
    && node.attrs.role !== "tab" && !node.children.some(child => child.tag === "a" || child.attrs.role === "tab");
}
function foreignContext(row: Node, nodes: Node[]): boolean {
  for (let current: Node | null = row; current && !["body", "html", "#root"].includes(current.tag); current = current.parent) {
    if (/(?:^|[\s_-])(?:recommend(?:ation)?|similar|substitute|supplier|overseas?|oversea)(?:$|[\s_-])/i.test(current.attrs.class ?? "")) return true;
    const headings = children(current).filter(node => /^h[1-6]$/.test(node.tag) || node.tag === "header");
    if (headings.some(node => marker(node, FOREIGN))) return true;
    // A foreign badge in the offer itself also excludes it.
    if (current === row && nodes.some(node => within(node, row) && marker(node, FOREIGN))) return true;
  }
  return false;
}
function values(row: Node, nodes: Node[], labels: string[]): string[] {
  const found = new Set<string>();
  const labelSet = new Set(labels);
  for (const node of nodes.filter(node => visible(node) && within(node, row))) {
    const content = clean(node.text);
    if (content.length > 160) continue;
    const pair = /^([^:：]+)\s*[:：]\s*(.+)$/.exec(content);
    if (pair && labelSet.has(clean(pair[1]))) found.add(clean(pair[2]));
    if (!labelSet.has(content.replace(/[:：]$/, "")) || !node.parent) continue;
    const siblings = children(node.parent);
    // The observed DL inserts an empty Colon__Wrapper span between DT/DD.
    const next = siblings.slice(siblings.indexOf(node) + 1).find(sibling => !!sibling.text);
    if (next?.text && next.text.length < 120) found.add(clean(next.text));
  }
  return Array.from(found);
}
function productLinks(row: Node, nodes: Node[], base: string): Node[] {
  return nodes.filter(node => visible(node) && node.tag === "a" && within(node, row)
    && !!itemUrl(node.attrs.href ?? "", base));
}
function priceHeading(node: Node): boolean {
  return visible(node) && /^(?:价格梯度|梯度|阶梯(?:价格|价)?)(?:\s*\(\s*(?:含税|不含税|未税)\s*\))?(?:\s*(?:售价|单价|价格))?$/.test(clean(node.text));
}
/** Actual 2026-11-14 self-operated main-card boundary; not embedded price data. */
function observedMainRow(node: Node): boolean {
  if (!visible(node) || node.tag !== "section" || node.attrs["data-spm"] !== "zy") return false;
  const group = node.parent?.parent;
  if (!group || !(group.attrs.class ?? "").split(/\s+/).includes("product-group-leader")) return false;
  try {
    const data: unknown = JSON.parse(node.parent?.attrs["data-custom-data"] ?? "null");
    return data !== null && typeof data === "object" && !Array.isArray(data)
      && (data as Record<string, unknown>).productType === "main";
  } catch { return false; }
}
function observedPriceColumn(row: Node, nodes: Node[]): { container: Node; heading: Node } | null {
  if (!observedMainRow(row)) return null;
  const group = row.parent!.parent!;
  if (!group.parent) return null;
  const siblings = children(group.parent);
  for (const previous of siblings.slice(0, siblings.indexOf(group)).reverse()) {
    if ((previous.attrs.class ?? "").split(/\s+/).includes("product-group-leader")) continue;
    const headers = nodes.filter(node => visible(node) && within(node, previous) && node.tag === "h2");
    const texts = headers.map(node => clean(node.text));
    // The actual list header explicitly associates the final three columns.
    if (texts.length !== 6 || texts[0] !== "型号/品牌/封装/类目" || texts[1] !== "参数/描述"
      || texts[2] !== "优惠券/标签" || !priceHeading(headers[3]) || texts[4] !== "库存交期" || texts[5] !== "操作") return null;
    const columns = row.children.filter(visible)[0]?.children.filter(visible);
    if (!columns || columns.length !== 4) return null;
    return { container: columns[1], heading: headers[3] };
  }
  return null;
}
function locateRow(anchor: Node, scope: Node, nodes: Node[], base: string): Node | null {
  let fallback: Node | null = null;
  for (let current = anchor.parent; current && within(current, scope); current = current.parent) {
    const links = productLinks(current, nodes, base);
    if (new Set(links.map(node => itemUrl(node.attrs.href, base))).size > 1) break;
    if (observedMainRow(current)) return current;
    if (["tr", "li", "article"].includes(current.tag)
      || /(?:^|\s)(?:product[-_](?:row|item)|search[-_]item|list[-_]item)(?:\s|$)/i.test(current.attrs.class ?? "")) return current;
    const hasCode = nodes.some(node => visible(node) && within(node, current!) && /^C\d+$/i.test(clean(node.text)))
      || values(current, nodes, ["商品编号", "立创编号", "商品编码"]).length > 0;
    if (hasCode && nodes.some(node => within(node, current!) && priceHeading(node))) { fallback = current; break; }
    if (hasCode && !fallback) fallback = current;
    if (current === scope) break;
  }
  return fallback;
}
function prices(row: Node, nodes: Node[]): { tiers: Tier[]; tax: LcscSearchPageResult["taxStatus"]; warning?: string; ambiguous?: boolean } {
  // Keep the smallest genuine heading; a wrapper around it is not a second table.
  const observed = observedPriceColumn(row, nodes);
  const headings = nodes.filter(node => within(node, row) && priceHeading(node)
    && !node.children.some(priceHeading));
  if (headings.length > 1 || (observed && headings.length)) return { tiers: [], tax: "unknown", ambiguous: true, warning: "multiple_search_price_tables" };
  if (!headings.length && !observed) return { tiers: [], tax: "unknown", warning: "quantity_qualified_prices_not_in_public_html" };
  const heading = observed?.heading ?? headings[0];
  let container = observed?.container ?? heading.parent;
  if (!observed && (heading.tag === "th" || heading.tag === "td")) {
    for (let current = heading.parent; current && within(current, row); current = current.parent) {
      if (current.tag === "table") { container = current; break; }
    }
  }
  if (!container || !within(container, row)) return { tiers: [], tax: "unknown", warning: "unbounded_search_price_table" };
  const found = new Map<number, string>();
  let bad = false;
  for (const node of nodes.filter(node => visible(node) && node !== heading && within(node, container))) {
    // Observed tier labels have an empty colon span; they are quantity cells,
    // not tier rows. The owning LI still validates its possibly empty price.
    if (node.tag === "label") continue;
    // Preserve empty element columns: an empty unit price must NOT shift the
    // reel/total price from column three into column two.
    const cells = node.children.filter(child => !child.hidden && !SKIP.has(child.tag)
      && (child.tag !== "#text" || !!clean(child.text)));
    const texts = cells.map(child => clean(child.text));
    let threshold = texts[0] ?? "";
    let price = texts[1] ?? "";
    // A leaf "5+ ￥2.3068" is also an explicit tier; unrelated amounts are not.
    if (cells.every(child => child.tag === "#text")) {
      const pair = /^(\S+\s*\+)\s*([¥￥].+)$/.exec(clean(node.text));
      if (!pair) continue;
      threshold = pair[1]; price = pair[2];
    }
    if (!/^\S+\s*\+$/.test(threshold)) continue;
    const match = new RegExp(`^(${INTEGER})\\s*\\+$`).exec(threshold);
    const minQuantity = match ? integer(match[1]) : null;
    const decimal = /^(?:[¥￥]\s*|人民币\s*)((?:0|[1-9]\d*)(?:\.\d+)?)(?:\s*元)?$/.exec(price)?.[1];
    if (minQuantity === null || minQuantity < 1 || !decimal || !/[1-9]/.test(decimal)) { bad = true; continue; }
    const previous = found.get(minQuantity);
    if (previous !== undefined && previous !== decimal) return { tiers: [], tax: "unknown", ambiguous: true, warning: "conflicting_quantity_prices" };
    found.set(minQuantity, decimal);
  }
  const taxText = clean(heading.text);
  const excluded = /不含税|未税/.test(taxText);
  const included = /含税/.test(taxText.replace(/不含税/g, ""));
  const tax = included !== excluded ? included ? "included" : "excluded" : "unknown";
  if (bad) return { tiers: [], tax, warning: "unreadable_price_tier" };
  return { tiers: Array.from(found).map(([minQuantity, unitPrice]) => ({ minQuantity, unitPrice }))
    .sort((a, b) => a.minQuantity - b.minQuantity), tax,
    ...(!found.size ? { warning: "quantity_qualified_prices_not_in_public_html" } : {}) };
}
function units(row: Node, nodes: Node[]): string[] {
  const found = new Set(values(row, nodes, ["计价单位"]).filter(value => UNITS.test(value)));
  for (const input of nodes.filter(node => visible(node) && within(node, row) && node.tag === "input"
    && ["", "text", "number"].includes((node.attrs.type ?? "").toLowerCase()))) {
    // Only the purchase input's adjacent label, not stock/pack units or JSON.
    let current: Node | null = input;
    for (let depth = 0; depth < 2 && current?.parent && within(current.parent, row); depth++, current = current.parent) {
      const siblings = current.parent.children.filter(node => !node.hidden && !SKIP.has(node.tag) && (node.tag !== "#text" || !!clean(node.text)));
      const next = siblings[siblings.indexOf(current) + 1];
      if (next && UNITS.test(clean(next.text))) found.add(clean(next.text));
    }
    // The real input has a selected unit in its adjacent Ant group addon.
    // Bind to this input's group only; never to another row's selector.
    for (let group = input.parent; group && within(group, row); group = group.parent) {
      if (!(group.attrs.class ?? "").split(/\s+/).includes("ant-input-number-group")) continue;
      for (const label of nodes.filter(node => visible(node) && within(node, group!)
        && (node.attrs.class ?? "").split(/\s+/).includes("ant-select-selection-item"))) {
        if (UNITS.test(clean(label.text))) found.add(clean(label.text));
        if (label.attrs.title && UNITS.test(clean(label.attrs.title))) found.add(clean(label.attrs.title));
      }
      break;
    }
  }
  return Array.from(found);
}
function emptyResult(url: string): LcscSearchPageResult {
  return { source: "lcsc", pageUrl: url, sourcePageUrl: url, matchedPartNumber: null,
    brand: null, productCode: null, packaging: null, packageName: null, stockQuantity: null,
    currency: null, unit: null, taxStatus: "unknown", tiers: [], status: "parse_error",
    warnings: [], stockSource: "unavailable", priceSource: "unavailable" };
}

export function parseLcscSearchPage(html: string, url: string, expected: LcscExpectedProduct): LcscSearchPageResult {
  const result = emptyResult(url);
  try {
    if (typeof html !== "string" || !html.trim() || html.length > 8_000_000) return result;
    if (!searchUrl(url) || !normalizeLcscPartNumber(expected.partNumber) || !normalizeLcscBrand(expected.brand)) return result;
    const nodes = parseHtml(html);
    const body = nodes.find(node => node.tag === "body") ?? nodes[0];
    const titles = nodes.filter(node => node.tag === "title").map(node => node.text).join(" ");
    const scripts = nodes.filter(node => node.tag === "script").map(node => node.text).join("\n");
    const cookieChallenge = !body.text && /\b_xvasu\b/.test(scripts) && /\b_xvtsc\b/.test(scripts)
      && /\b_xvpfs\b/.test(scripts) && /\b_xvpts\b/.test(scripts);
    if (cookieChallenge || /403\s*(?:forbidden)?|access denied|forbidden|just a moment|安全验证|访问受限|验证访问/i.test(titles)
      || /尝试太多了|访问过于频繁|请完成安全验证|请滑动.*验证|访问被拒绝|access denied|powered and protected by|processing your request/i.test(body.text)
      || /^(?:403\s*)?forbidden$/i.test(body.text)) {
      return { ...result, status: "access_restricted", warnings: ["public_search_access_challenge"] };
    }
    const selfMarkers = nodes.filter(node => marker(node, SELF) && !node.children.some(child => marker(child, SELF)));
    const mainRows = nodes.filter(observedMainRow);
    const scopes = Array.from(new Set(selfMarkers.map(node => node.parent).filter((node): node is Node => !!node)))
      .filter(scope => !children(scope).some(node => marker(node, FOREIGN)));
    // The result-count toolbar is a sibling of the real main cards. It is not
    // their ancestor; use their observed explicit self-operated boundaries.
    if (selfMarkers.length) scopes.push(...mainRows);
    const allLinks = nodes.filter(node => visible(node) && node.tag === "a" && itemUrl(node.attrs.href ?? "", url));
    const target = normalizeLcscPartNumber(expected.partNumber);
    const anchors = allLinks.filter(node => [node.text, node.attrs.title ?? ""].some(value => normalizeLcscPartNumber(value) === target));
    const rows = new Set<Node>();
    for (const anchor of anchors) {
      const scope = scopes.filter(scope => within(anchor, scope)).sort((a, b) => within(a, b) ? -1 : 1)[0];
      if (!scope) continue;
      const row = locateRow(anchor, scope, nodes, url);
      if (row && !foreignContext(row, nodes)) rows.add(row);
    }
    const offers: LcscSearchPageResult[] = [];
    for (const row of Array.from(rows)) {
      const brandValues = new Set(values(row, nodes, ["品牌", "品牌名称"]));
      for (const link of nodes.filter(node => visible(node) && node.tag === "a" && within(node, row))) {
        try {
          const brandUrl = new URL(link.attrs.href ?? "", url);
          if (brandUrl.hostname === "list.szlcsc.com" && /^\/brand\/\d+\.html$/.test(brandUrl.pathname)) brandValues.add(clean(link.text));
        } catch { /* Not a brand link. */ }
      }
      if (!brandValues.size) continue;
      if (!Array.from(brandValues).some(value => matchesLcscBrand(expected.brand, value))) continue;
      if (new Set(Array.from(brandValues).map(normalizeLcscBrand)).size > 1) return { ...result, status: "ambiguous", warnings: ["conflicting_search_row_brand"] };
      const links = productLinks(row, nodes, url);
      const exact = links.filter(node => [node.text, node.attrs.title ?? ""].some(value => normalizeLcscPartNumber(value) === target));
      const mpns = values(row, nodes, ["型号", "商品型号"]);
      for (const link of exact) {
        for (const value of [link.text, link.attrs.title ?? ""]) {
          if (value && /^[\w./ -]+$/.test(clean(value))) mpns.push(clean(value));
        }
      }
      if (mpns.some(value => normalizeLcscPartNumber(value) !== target)) return { ...result, status: "ambiguous", warnings: ["conflicting_search_row_mpn"] };
      const codes = new Set(values(row, nodes, ["商品编号", "立创编号", "商品编码"]).filter(value => /^C\d+$/i.test(value)).map(value => value.toUpperCase()));
      for (const node of nodes.filter(node => visible(node) && within(node, row) && /^C\d+$/i.test(clean(node.text)))) codes.add(clean(node.text).toUpperCase());
      const urls = new Set(exact.map(link => itemUrl(link.attrs.href, url)));
      if (codes.size > 1 || urls.size > 1) return { ...result, status: "ambiguous", warnings: ["conflicting_search_row_sku_or_url"] };
      const quote = { ...emptyResult(url), pageUrl: Array.from(urls)[0] ?? url, matchedPartNumber: clean(exact[0]?.text || exact[0]?.attrs.title || expected.partNumber),
        brand: Array.from(brandValues)[0], productCode: Array.from(codes)[0] ?? null, status: "price_unavailable" as const } as LcscSearchPageResult;
      const packs = values(row, nodes, ["包装方式", "包装"]);
      const packageNames = values(row, nodes, ["商品封装", "封装"]);
      for (const node of nodes.filter(node => visible(node) && within(node, row))) {
        if (new RegExp(`^${INTEGER}\\s*(?:个|片|颗|只)\\s*/\\s*(?:圆盘|编带|托盘|管|袋|盒)$`).test(clean(node.text))) packs.push(clean(node.text));
      }
      if (new Set(packs).size > 1 || new Set(packageNames).size > 1) return { ...result, status: "ambiguous", warnings: ["conflicting_search_row_packaging"] };
      quote.packaging = packs[0] ?? null; quote.packageName = packageNames[0] ?? null;
      const stocks = new Set<number>();
      for (const value of values(row, nodes, ["现货"])) {
        const stock = integer(value);
        if (stock !== null) stocks.add(stock);
      }
      for (const node of nodes.filter(node => visible(node) && within(node, row))) {
        const match = new RegExp(`^现货\\s*[:：]?\\s*(${INTEGER})\\s*(?:个|片|颗|只)?$`).exec(clean(node.text));
        const stock = match ? integer(match[1]) : null;
        if (stock !== null) stocks.add(stock);
      }
      if (stocks.size > 1) return { ...result, status: "ambiguous", warnings: ["conflicting_search_row_stock"] };
      if (stocks.size) { quote.stockQuantity = Array.from(stocks)[0]; quote.stockSource = "search_row"; }
      const unitValues = units(row, nodes);
      if (unitValues.length > 1) return { ...result, status: "ambiguous", warnings: ["conflicting_search_row_units"] };
      quote.unit = unitValues[0] ?? null;
      const pricing = prices(row, nodes);
      if (pricing.ambiguous) return { ...result, status: "ambiguous", warnings: [pricing.warning!] };
      quote.taxStatus = pricing.tax;
      if (pricing.warning) quote.warnings.push(pricing.warning);
      if (!quote.productCode) quote.warnings.push("search_row_sku_unavailable");
      if (!quote.unit) quote.warnings.push("explicit_purchase_unit_not_in_public_html");
      if (quote.productCode && quote.unit && pricing.tiers.length) {
        quote.tiers = pricing.tiers; quote.currency = "CNY"; quote.priceSource = "search_row"; quote.status = "ok";
        if (quote.stockQuantity !== null) for (const tier of quote.tiers) {
          if (tier.minQuantity > quote.stockQuantity) quote.warnings.push(`tier_min_quantity_exceeds_stock:${tier.minQuantity}`);
        }
      }
      offers.push(quote);
    }
    if (offers.length) {
      // Identical duplicate markup is harmless. Never splice data across rows.
      const signatures = new Set(offers.map(offer => JSON.stringify(offer)));
      if (signatures.size > 1) return { ...result, status: "ambiguous", warnings: ["multiple_exact_search_offers"] };
      return offers[0];
    }
    const selfLinks = allLinks.filter(link => scopes.some(scope => within(link, scope)));
    const explicitEmpty = selfMarkers.some(node => /\b0\)?(?:\s*(?:个|件|条|款))?$/.test(node.text))
      || scopes.some(scope => /未找到(?:相关|匹配)?(?:商品|结果)|暂无(?:相关)?(?:商品|结果)/.test(scope.text));
    // A complete recognizable self-operated list can prove no exact match.
    // A shell, unknown structure, or a row with missing brand cannot.
    const definitelyAbsent = explicitEmpty || (selfLinks.length > 0 && !anchors.some(anchor => selfLinks.includes(anchor)))
      || (rows.size > 0 && Array.from(rows).every(row => {
        const brands = values(row, nodes, ["品牌", "品牌名称"]);
        return brands.length > 0 && brands.every(brand => !matchesLcscBrand(expected.brand, brand));
      }));
    return { ...result, status: definitelyAbsent ? "unmatched" : "price_unavailable",
      warnings: definitelyAbsent ? [] : ["recognizable_exact_self_operated_offer_not_in_public_html"] };
  } catch {
    return { ...emptyResult(url), status: "parse_error", warnings: ["invalid_search_html_or_input"] };
  }
}
