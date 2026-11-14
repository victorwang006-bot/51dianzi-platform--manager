/**
 * ICKey public-page parser. No requests, DOM execution, storage or private APIs.
 * Verified raw search pages are shells; their hidden no-result and Vue/doT
 * templates are NOT product evidence. Feed a public, normally rendered HTML
 * snapshot when available. Only the observed search-row structures are supported;
 * an unverified standalone product-page layout deliberately fails closed.
 */
import { matchChannelReferenceBrand } from "../../shared/channelReferenceBrand";

export type IckeyPageStatus =
  | "ok" | "unmatched" | "ambiguous" | "price_unavailable"
  | "access_restricted" | "parse_error";
export type IckeyTaxStatus = "included" | "excluded" | "unknown";
export interface IckeyExpectedProduct { partNumber: string; brand: string }
export interface IckeyPageResult {
  source: "ickey";
  pageUrl: string;
  matchedPartNumber: string | null;
  matchedBrand: string | null;
  productCode: string | null;
  /** Public packaging/封装 text; never interpreted as a pricing quantity. */
  packaging: string | null;
  /** Count as shown for this one SKU, never a sum across suppliers or SKUs. */
  stockQuantity: number | null;
  /** Currency selected by the visible delivery option. No exchange conversion. */
  currency: string | null;
  /** Explicit inventory/pricing unit only. Unknown is null, not inferred PCS. */
  unit: string | null;
  taxStatus: IckeyTaxStatus;
  tiers: Array<{ minQuantity: number; unitPrice: string }>;
  status: IckeyPageStatus;
}

type Node = {
  tag: string; attrs: Record<string, string>; children: Array<Node | string>;
  parent: Node | null; hidden: boolean;
};
type Candidate = Omit<IckeyPageResult, "source" | "pageUrl" | "status"> & {
  supplier: string | null;
  detailUrl: string | null;
  ambiguous: boolean;
};
const VOID_TAGS = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const RAW_TAGS = new Set(["script", "style", "textarea", "title"]);
const HIDDEN_CLASSES = new Set(["d-n", "hide", "hidden", "off-p", "shengge-hide"]);
const MAX_HTML_LENGTH = 3_000_000;

function decode(text: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", yen: "¥",
  };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|yen);/gi, (all, key: string) => {
    if (key[0] !== "#") return named[key.toLowerCase()] ?? all;
    const value = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value) : "\ufffd";
  });
}
function clean(text: string): string { return decode(text).replace(/\s+/g, " ").trim(); }
function usable(text: string | undefined): string | null {
  const value = clean(text ?? "");
  return !value || /\{\{|\}\}|^--$/.test(value) ? null : value;
}
function exact(text: string): string { return clean(text).toUpperCase(); }
function classes(node: Node): string[] { return (node.attrs.class ?? "").split(/\s+/); }
function hasClass(node: Node, name: string): boolean { return classes(node).includes(name); }

/** Small inert tokenizer for the observed balanced HTML rows; not a browser. */
function tree(html: string): Node {
  const root: Node = { tag: "root", attrs: {}, children: [], parent: null, hidden: false };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+|</g;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = token.exec(html))) {
    if (++count > 150_000) throw new Error("too many HTML tokens");
    const value = match[0];
    if (value === "<") throw new Error("incomplete HTML tag");
    if (value.startsWith("<!")) continue;
    const current = stack[stack.length - 1];
    if (!value.startsWith("<")) { current.children.push(value); continue; }
    const tag = /^<\/?([\w:-]+)/.exec(value)?.[1].toLowerCase();
    if (!tag) throw new Error("invalid tag");
    if (value.startsWith("</")) {
      const index = stack.map(n => n.tag).lastIndexOf(tag);
      if (index > 0) stack.length = index;
      continue;
    }
    const attrs: Record<string, string> = Object.create(null);
    const attrText = value.slice(tag.length + 1, value.length - 1);
    const attr = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a: RegExpExecArray | null;
    while ((a = attr.exec(attrText))) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? "");
    const classNames = (attrs.class ?? "").split(/\s+/);
    const hidden = current.hidden || tag === "template" || tag === "noscript"
      || "hidden" in attrs || attrs["aria-hidden"] === "true"
      || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(attrs.style ?? "")
      || classNames.some(c => HIDDEN_CLASSES.has(c))
      // Directives in a raw Vue template have not established visibility.
      || "v-for" in attrs || "v-show" in attrs || "v-if" in attrs;
    const node: Node = { tag, attrs, children: [], parent: current, hidden };
    current.children.push(node);
    if (RAW_TAGS.has(tag)) {
      const end = new RegExp(`</${tag}\\s*>`, "ig");
      end.lastIndex = token.lastIndex;
      const close = end.exec(html);
      if (!close) throw new Error("unterminated raw-text element");
      if (tag === "title" || tag === "textarea") node.children.push(html.slice(token.lastIndex, close.index));
      else node.hidden = true;
      token.lastIndex = end.lastIndex;
    } else if (!VOID_TAGS.has(tag) && !/\/\s*>$/.test(value)) {
      if (stack.length >= 200) throw new Error("HTML nesting too deep");
      stack.push(node);
    }
  }
  return root;
}
function nodes(root: Node): Node[] {
  const found: Node[] = [], pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.hidden) continue;
    found.push(node);
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (typeof child !== "string") pending.push(child);
    }
  }
  return found;
}
function text(node: Node): string {
  if (node.hidden) return "";
  return clean(node.children.map(child => typeof child === "string" ? child : text(child)).join(" "));
}
function attrValue(node: Node, key: string): string | null { return usable(node.attrs[key]); }
function field(row: Node, label: string): string | null {
  // Labels in the observed templates occupy their own li/p. Do not search an
  // entire page and accidentally borrow a value from another SKU.
  for (const node of nodes(row)) {
    if (!["li", "p"].includes(node.tag)) continue;
    const value = text(node);
    const match = new RegExp(`^${label.split("").join("\\s*")}\\s*[：:]\\s*(.+)$`).exec(value);
    if (match) return usable(match[1]);
  }
  return null;
}
function integer(value: string | null): number | null {
  if (value === null || !/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(value)) return null;
  const number = Number(value.replace(/,/g, ""));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function unitName(value: string): string {
  return /^(?:pcs?|pieces?)$/i.test(value) ? "pcs" : value;
}
function stock(value: string | null): { count: number | null; unit: string | null } {
  if (value === null) return { count: null, unit: null };
  const match = /^([\d,]+)\s*(片|个|只|件|卷|盘|包|盒|pcs?|pieces?)?$/i.exec(value);
  return match ? { count: integer(match[1]), unit: match[2] ? unitName(match[2]) : null }
    : { count: null, unit: null };
}
function quantity(value: string): number | null {
  const match = /^([\d,]+)\s*\+$/.exec(value);
  const q = match ? integer(match[1]) : null;
  return q !== null && q > 0 ? q : null;
}
function price(value: string, currency: string): { value: string; unit: string | null } | null {
  const symbol = currency === "CNY" ? "[￥¥]" : "\\$";
  const match = new RegExp(`^${symbol}\\s*(\\d+(?:\\.\\d+)?)(?:\\s*/\\s*(片|个|只|件|卷|盘|包|盒|pcs?|pieces?))?$`, "i").exec(value);
  if (!match || !/[1-9]/.test(match[1])) return null;
  // Never convert a decimal through Number, toFixed or exponential notation.
  return { value: match[1], unit: match[2] ? unitName(match[2]) : null };
}
function blank(pageUrl: string, status: IckeyPageStatus): IckeyPageResult {
  return {
    source: "ickey", pageUrl, matchedPartNumber: null, matchedBrand: null,
    productCode: null, packaging: null, stockQuantity: null, currency: null,
    unit: null, taxStatus: "unknown", tiers: [], status,
  };
}
/** Use only the actual row URL, never invent a route or follow a buy/indent link. */
function detailUrl(value: string | null, sku: string | null, partNumber: string): string | null {
  if (!value || !sku) return null;
  try {
    const url = new URL(value, "https://www.ickey.cn/");
    const path = /^\/detail\/([^/]+)\/([^/]+)\.html$/.exec(url.pathname);
    if (url.protocol !== "https:" || url.hostname !== "www.ickey.cn" || url.username || url.password
      || (url.port && url.port !== "443") || url.search || url.hash || !path
      || decodeURIComponent(path[1]) !== sku || exact(decodeURIComponent(path[2])) !== exact(partNumber)) return null;
    return url.href;
  } catch { return null; }
}
function isRestricted(root: Node, pageUrl: string): boolean {
  let url: URL;
  try { url = new URL(pageUrl); } catch { return false; }
  if (url.hostname === "passport.ickey.cn" || /\/(?:login|captcha)(?:\/|$)/i.test(url.pathname)) return true;
  const all = nodes(root);
  const title = all.filter(n => n.tag === "title").map(text).join(" ");
  if (/403|access denied|访问受限|安全验证|人机验证|登录/i.test(title)) return true;
  // Hidden, always-included captcha/login modals in genuine pages are ignored.
  return all.some(n => ["h1", "h2", "h3", "p", "div"].includes(n.tag)
    && /^(?:请完成安全验证|请先完成验证|请先登录|登录后查看价格|登录后可见|访问受限|访问被拒绝|Access Denied|Forbidden|请点击验证身份)[！!。.]?$/i.test(text(n)))
    || (/安全验证|人机验证|验证码|点击验证/.test(text(root)) && text(root).length < 500
      && all.some(n => /captcha|nc-container|aliyun|verify/i.test(n.attrs.id ?? "")));
}
function candidate(row: Node, root: Node, kind: "normal" | "vue"): Candidate | null {
  const rowNodes = nodes(row);
  let partNumber = attrValue(row, "data-sno");
  if (!partNumber && kind === "vue") {
    const anchor = rowNodes.find(n => n.tag === "a" && hasClass(n, "fw-b") && hasClass(n, "theme-color"));
    partNumber = anchor ? usable(anchor.attrs.title) ?? usable(text(anchor)) : null;
  }
  if (!partNumber) return null;
  const brand = attrValue(row, "data-maf") ?? field(row, "厂牌");
  if (!brand) return null;
  const copy = rowNodes.find(n => hasClass(n, "js_btn_copy_product"));
  let packaging = copy ? attrValue(copy, "data-package") : null;
  if (packaging) { try { packaging = decodeURI(packaging); } catch { packaging = null; } }
  packaging ??= field(row, "封装");
  const stockNode = rowNodes.find(n => hasClass(n, "store-num-detail"));
  const displayedStock = stock(stockNode ? usable(text(stockNode)) : field(row, "库存"));
  const attributeStock = stock(attrValue(row, "data-stock"));
  const chosenStock = stockNode || displayedStock.count !== null ? displayedStock : attributeStock;
  const explicitUnit = field(row, "销售单位") ?? field(row, "计价单位");
  let unit = explicitUnit ? unitName(explicitUnit) : chosenStock.unit;
  let ambiguous = Boolean(chosenStock.unit && unit && chosenStock.unit !== unit);
  const supplierNode = (() => { let n = row.parent; while (n) { if (n.attrs["data-supid"]) return n; n = n.parent; } return null; })();
  const supplier = attrValue(row, "data-real-supplier") ?? (supplierNode ? attrValue(supplierNode, "data-supid") : null);
  const productCode = attrValue(row, "data-sku") ?? (copy ? attrValue(copy, "data-sku") : null);
  const rawDetailUrl = attrValue(row, "data-url");
  const boundDetailUrl = detailUrl(rawDetailUrl, productCode, partNumber);
  if (rawDetailUrl && !boundDetailUrl) ambiguous = true;
  const displayedBrand = field(row, "厂牌");
  if (displayedBrand && exact(displayedBrand) !== exact(brand)) ambiguous = true;
  if (copy && attrValue(copy, "data-sku") && attrValue(copy, "data-sku") !== productCode) ambiguous = true;
  if (rawDetailUrl) {
    const detailAnchors = rowNodes.filter(n => n.tag === "a" && n.attrs["data-tag"] === "商品详情");
    if (detailAnchors.some(n => detailUrl(attrValue(n, "href"), productCode, partNumber) !== boundDetailUrl
      || exact(text(n)) !== exact(partNumber))) ambiguous = true;
  }
  const base: Candidate = {
    matchedPartNumber: partNumber, matchedBrand: brand,
    productCode,
    packaging, stockQuantity: chosenStock.count, currency: null, unit,
    taxStatus: "unknown", tiers: [], supplier, detailUrl: boundDetailUrl, ambiguous,
  };
  // Captcha/login price gates inside the exact row are handled by the caller.
  if (/登录后|询价|询 价/.test(text(row)) && !rowNodes.some(n => hasClass(n, "search-w-home"))) return base;
  const home = rowNodes.find(n => hasClass(n, "search-w-home"));
  const hk = rowNodes.find(n => hasClass(n, "search-w-hk"));
  const quantityColumn = rowNodes.find(n => hasClass(n, "search-w-price"));
  // One visible column group for this SKU only. Never pick the first of
  // competing columns or borrow a price panel bound to another SKU.
  for (const name of ["search-w-price", "search-w-home", "search-w-hk"]) {
    if (rowNodes.filter(n => hasClass(n, name)).length > 1) ambiguous = true;
  }
  for (const column of [quantityColumn, home, hk]) {
    for (let node = column; node && node !== row; node = node.parent ?? undefined) {
      const panelSku = attrValue(node, "data-sku");
      if (panelSku && panelSku !== productCode) ambiguous = true;
    }
  }
  const entryNodes = (column: Node | undefined): Node[] => column
    ? nodes(column).filter(n => hasClass(n, "search-result-bor")) : [];
  let quantities = quantityColumn ? entryNodes(quantityColumn).map(n => quantity(text(n))) : [];
  let cny = entryNodes(home).map(text), usd = entryNodes(hk).map(text);
  // Vue productItem/productReplaceItem renders each tier as one li, not columns.
  if (kind === "vue" && !quantityColumn) {
    const tierRows = rowNodes.filter(n => n.tag === "li" && nodes(n).some(child => child.tag === "span" && quantity(text(child)) !== null));
    quantities = tierRows.map(n => quantity(text(nodes(n).find(child => child.tag === "span" && quantity(text(child)) !== null)!)));
    cny = tierRows.map(n => text(nodes(n).find(child => child.tag === "span" && /^[￥¥]/.test(text(child))) ?? { ...n, children: [] }));
    usd = tierRows.map(n => text(nodes(n).find(child => child.tag === "span" && /^\$/.test(text(child))) ?? { ...n, children: [] }));
  }
  cny = cny.filter(Boolean); usd = usd.filter(Boolean);
  let currency: "CNY" | "USD" | null = null;
  const checked = rowNodes.filter(n => n.tag === "input" && n.attrs.type === "radio" && "checked" in n.attrs
    && !n.parent?.attrs.js_linkage_sku).map(n => n.attrs.value);
  const vueChecked = rowNodes.filter(n => hasClass(n, "checkedRadio")).map(n => n.parent ? text(n.parent) : "");
  if (checked.length === 1) currency = checked[0] === "1" ? "CNY" : checked[0] === "2" ? "USD" : null;
  else if (checked.length > 1) ambiguous = true;
  else if (vueChecked.length === 1) currency = /内地/.test(vueChecked[0]) ? "CNY" : /香港/.test(vueChecked[0]) ? "USD" : null;
  else if (vueChecked.length > 1) ambiguous = true;
  if (!currency) {
    if (cny.length && usd.length) ambiguous = true;
    else currency = cny.length ? "CNY" : usd.length ? "USD" : null;
  }
  const values = currency === "CNY" ? cny : currency === "USD" ? usd : [];
  if (!quantities.length || !values.length || quantities.length !== values.length) return { ...base, ambiguous };
  const parsed = values.map(value => price(value, currency!));
  if (parsed.some(value => value === null) || quantities.some(value => value === null)) return { ...base, ambiguous };
  const units = new Set(parsed.map(p => p!.unit).filter((u): u is string => u !== null));
  if (units.size > 1 || (unit && Array.from(units).some(u => u !== unit))) ambiguous = true;
  unit ??= Array.from(units)[0] ?? null;
  const tiers = quantities.map((q, i) => ({ minQuantity: q!, unitPrice: parsed[i]!.value }));
  const unique = new Map<number, string>();
  for (const tier of tiers) {
    if (unique.has(tier.minQuantity) && unique.get(tier.minQuantity) !== tier.unitPrice) ambiguous = true;
    unique.set(tier.minQuantity, tier.unitPrice);
  }
  let scope = row.parent;
  while (scope && scope !== root && !hasClass(scope, "search-result-container")
    && !hasClass(scope, "replace-order-content") && scope.attrs.id !== "searchContent") scope = scope.parent;
  const headers = nodes(scope ?? root).filter(n => hasClass(n, "result-header") || hasClass(n, "js_table_header"));
  const header = headers.length === 1 ? headers[0] : undefined;
  const taxText = text(row) + " " + (header ? text(header) : "");
  let taxStatus: IckeyTaxStatus = "unknown";
  if (currency === "CNY") {
    if (/未税|不含(?:增值)?税/.test(taxText)) taxStatus = "excluded";
    const positiveTaxText = taxText.replace(/未税|不含(?:增值)?税/g, "");
    if (/含增值税|含税价/.test(positiveTaxText)) taxStatus = taxStatus === "excluded" ? "unknown" : "included";
  }
  // The verified normal layout has separate N+ and currency unit-price columns
  // for one SKU; the purchase total/package controls are outside this group.
  // Missing sales-unit text does not erase those public prices or imply PCS.
  // Unverified/mixed groups without a known unit still fail closed.
  const selectedColumn = currency === "CNY" ? home : hk;
  const knownUnitPriceGroup = kind === "normal" && Boolean(productCode && quantityColumn && selectedColumn
    && quantityColumn.parent === selectedColumn.parent);
  return { ...base, currency, unit, taxStatus, ambiguous,
    tiers: unit || knownUnitPriceGroup
      ? Array.from(unique).map(([minQuantity, unitPrice]) => ({ minQuantity, unitPrice })).sort((a, b) => a.minQuantity - b.minQuantity) : [] };
}

export function parseIckeySearchPage(html: string, pageUrl: string, expected: IckeyExpectedProduct): IckeyPageResult {
  const empty = (status: IckeyPageStatus) => blank(pageUrl, status);
  try {
    if (typeof html !== "string" || !html.trim() || html.length > MAX_HTML_LENGTH
      || !expected || !usable(expected.partNumber) || !usable(expected.brand)) return empty("parse_error");
    const url = new URL(pageUrl);
    // This is only a parse-time evidence guard, not the parent's SSRF/loader policy.
    if (url.protocol !== "https:" || !["search.ickey.cn", "www.ickey.cn", "passport.ickey.cn"].includes(url.hostname)
      || url.username || url.password || (url.port && url.port !== "443")) return empty("parse_error");
    const root = tree(html);
    if (isRestricted(root, pageUrl)) return empty("access_restricted");
    const all = nodes(root);
    const normalRows = all.filter(n => hasClass(n, "result-list") && attrValue(n, "data-sno"));
    const vueRows = all.filter(n => hasClass(n, "list") && hasClass(n, "clearfix") && hasClass(n, "fs-12"));
    const candidates = [...normalRows.map(n => candidate(n, root, "normal")), ...vueRows.map(n => candidate(n, root, "vue"))]
      .filter((c): c is Candidate => c !== null);
    const matches = candidates.filter(c => exact(c.matchedPartNumber!) === exact(expected.partNumber)
      && matchChannelReferenceBrand(expected.brand, c.matchedBrand!, { profile: "ickey", normalize: exact }) !== null);
    if (!matches.length) {
      if (candidates.length || normalRows.length || vueRows.length) return empty("unmatched");
      const confirmedNoResult = all.some(n => hasClass(n, "search-no-result-news")
        && /未(?:能)?找到/.test(text(n)) && text(n).toUpperCase().includes(exact(expected.partNumber)));
      if (confirmedNoResult) return empty("unmatched");
      // Input/title/keyword/CollectionPage metadata is not an exact product match.
      const shell = all.some(n => ["searchResult", "searchResultProList"].includes(n.attrs.id ?? "")
        || ["d-product", "d-replace-product", "no-data"].includes(n.tag))
        // The verified all-channel raw page hides its entire #searchContent.
        // A marker establishes only an unavailable shell, never product data.
        || /\bid\s*=\s*["'](?:productItem|searchResult|searchResultProList)["']/.test(html);
      return empty(shell ? "price_unavailable" : "parse_error");
    }
    const deduped: Candidate[] = [];
    for (const match of matches) {
      // Collapse only identical representations of a known SKU. Unknown SKU,
      // different packaging, supplier, stock or quotes remain separate evidence.
      if (!match.productCode || !deduped.some(c => c.productCode === match.productCode && JSON.stringify(c) === JSON.stringify(match))) deduped.push(match);
    }
    if (deduped.length !== 1 || deduped[0].ambiguous) {
      return { ...empty("ambiguous"), matchedPartNumber: matches[0].matchedPartNumber, matchedBrand: matches[0].matchedBrand };
    }
    const { ambiguous: _ambiguous, supplier: _supplier, detailUrl: productUrl, ...found } = deduped[0];
    return { source: "ickey", pageUrl: productUrl ?? pageUrl, ...found,
      status: found.tiers.length && found.currency ? "ok" : "price_unavailable" };
  } catch { return empty("parse_error"); }
}

/** Product layouts are not yet verified. Supported search-row fragments can be
 * parsed; unknown layouts return parse_error, never inferred SEO/JSON prices. */
export function parseIckeyProductPage(html: string, pageUrl: string, expected: IckeyExpectedProduct): IckeyPageResult {
  return parseIckeySearchPage(html, pageUrl, expected);
}
