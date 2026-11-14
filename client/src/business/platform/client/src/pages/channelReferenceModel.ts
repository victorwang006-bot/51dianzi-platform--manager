import type { ChannelReferenceLookupResult, ChannelReferenceQuote, ChannelReferenceRow, ChannelReferenceSource, ChannelReferenceStatus } from "@shared/channelReference";

export const CHANNEL_REFERENCE_LABELS: Record<ChannelReferenceSource, string> = { lcsc: "立创商城", ickey: "云汉芯城" };
export const CHANNEL_REFERENCE_STATUS_LABELS: Record<ChannelReferenceStatus, string> = {
  pending: "查询中", ok: "已匹配", not_found: "未匹配", ambiguous: "匹配待确认",
  price_unavailable: "暂无公开价格", access_restricted: "访问受限", unavailable: "查询失败",
};
export const CHANNEL_REFERENCE_POLL_INTERVAL_MS = 4_000;
export const CHANNEL_REFERENCE_POLL_LIMIT_MS = 90_000;
const statuses = new Set(Object.keys(CHANNEL_REFERENCE_STATUS_LABELS));
const decimal = (value: unknown): value is string => typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
const nullableText = (value: unknown) => value === null || typeof value === "string";
const quantity = (value: unknown) => value === null || typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

/** Only public fixed-provider product links may become active anchors. No HTML is interpreted. */
export function channelReferencePageUrl(value: string | null, source: ChannelReferenceSource): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowed = source === "lcsc" ? ["szlcsc.com", "www.szlcsc.com", "item.szlcsc.com", "list.szlcsc.com", "lcsc.com", "www.lcsc.com"]
      : ["search.ickey.cn", "www.ickey.cn", "ickey.cn"];
    return url.protocol === "https:" && !url.username && !url.password && !url.port && allowed.includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
function isQuote(value: unknown, source: ChannelReferenceSource): value is ChannelReferenceQuote {
  if (!object(value) || value.source !== source || !statuses.has(String(value.status))) return false;
  if (!["matchedPartNumber", "matchedBrand", "productCode", "pageUrl", "unit", "packaging", "fetchedAt", "expiresAt", "message"].every(key => nullableText(value[key]))) return false;
  if (!quantity(value.stockQuantity) || !quantity(value.tierQuantity) || value.unitPrice !== null && !decimal(value.unitPrice)) return false;
  if (![null, "CNY", "USD", "HKD"].includes(value.currency as null) || !["included", "excluded", "unknown"].includes(String(value.taxStatus)) || typeof value.stockInsufficientForTier !== "boolean") return false;
  return Array.isArray(value.tiers) && value.tiers.every(tier => object(tier) && typeof tier.minQuantity === "number" && Number.isSafeInteger(tier.minQuantity) && tier.minQuantity > 0 && decimal(tier.unitPrice));
}

/** Strict shape and current-row binding: never apply arbitrary IDs or a late page's data. */
export function channelReferenceLookupResult(value: unknown, rows: readonly { id: number; partNumber: string; brand: string }[]): ChannelReferenceLookupResult {
  if (!object(value) || !Array.isArray(value.items) || value.items.length !== rows.length) throw new Error("参考响应格式或当前库存行不匹配");
  const expected = new Map(rows.map(row => [row.id, row]));
  const seen = new Set<number>();
  for (const item of value.items) {
    if (!object(item) || typeof item.materialId !== "number" || !Number.isSafeInteger(item.materialId) || seen.has(item.materialId)) throw new Error("参考响应库存行无效");
    const row = expected.get(item.materialId);
    if (!row || item.partNumber !== row.partNumber || item.brand !== row.brand || !object(item.references)
      || !isQuote(item.references.lcsc, "lcsc") || !isQuote(item.references.ickey, "ickey")) throw new Error("参考响应与当前库存行不匹配");
    seen.add(item.materialId);
  }
  return value as ChannelReferenceLookupResult;
}
export function channelReferenceMaximumTier(quote: ChannelReferenceQuote) {
  return quote.tiers.reduce<ChannelReferenceQuote["tiers"][number] | null>((max, tier) => !max || tier.minQuantity > max.minQuantity ? tier : max, null);
}
export function channelReferenceHasPrice(quote: ChannelReferenceQuote) {
  const tier = channelReferenceMaximumTier(quote);
  return quote.status === "ok" && (tier?.unitPrice ?? quote.unitPrice) !== null && (tier?.minQuantity ?? quote.tierQuantity ?? 0) > 0;
}
export function channelReferencePrice(quote: ChannelReferenceQuote) {
  if (!channelReferenceHasPrice(quote) || quote.currency !== "CNY") return "暂未匹配";
  const tier = channelReferenceMaximumTier(quote);
  const price = tier?.unitPrice ?? quote.unitPrice;
  // Keep the decimal verbatim; marketplace stock is unrelated to the material's qty or tier threshold.
  const stock = quote.stockQuantity === null ? "库存未披露" : `库存${quote.stockQuantity}`;
  return `${price}，${stock}`;
}
export function channelReferenceHasPending(result: ChannelReferenceLookupResult) {
  return result.items.some(row => row.references.lcsc.status === "pending" || row.references.ickey.status === "pending");
}

/** Finite current-page cache recheck only. Each start owns its cancellation and 90s deadline. */
export function startChannelReferenceLookup(options: {
  lookup: (refresh: boolean, signal: AbortSignal) => Promise<unknown>;
  rows: readonly { id: number; partNumber: string; brand: string }[];
  refresh: boolean; isCurrent: () => boolean;
  onData: (result: ChannelReferenceLookupResult) => void;
  onError: (error: unknown) => void;
  onBusy: (busy: boolean) => void; onStopped: () => void;
}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const startedAt = Date.now();
  const current = () => !disposed && !controller.signal.aborted && options.isCurrent();
  const deadline = setTimeout(() => {
    if (!current()) return;
    if (timer) clearTimeout(timer);
    options.onBusy(false); options.onStopped(); controller.abort();
  }, CHANNEL_REFERENCE_POLL_LIMIT_MS);
  const finish = () => { clearTimeout(deadline); if (timer) clearTimeout(timer); };
  const request = async (refresh: boolean) => {
    if (!current() || Date.now() - startedAt >= CHANNEL_REFERENCE_POLL_LIMIT_MS) return;
    options.onBusy(true);
    try {
      const value = await options.lookup(refresh, controller.signal);
      if (!current()) return;
      const result = channelReferenceLookupResult(value, options.rows);
      options.onData(result);
      if (channelReferenceHasPending(result) && Date.now() - startedAt < CHANNEL_REFERENCE_POLL_LIMIT_MS) {
        timer = setTimeout(() => { void request(false); }, CHANNEL_REFERENCE_POLL_INTERVAL_MS);
      } else finish();
    } catch (error) { if (current()) { finish(); options.onError(error); } }
    finally { if (current()) options.onBusy(false); }
  };
  void request(options.refresh);
  return () => { disposed = true; finish(); controller.abort(); };
}

export type ChannelReferenceView = {
  key: string; items: ChannelReferenceRow[]; busy: boolean; error: string; stopped: boolean;
};
