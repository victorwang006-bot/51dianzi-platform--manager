import React from "react";
import type { ChannelReferenceQuote, ChannelReferenceSource } from "@shared/channelReference";
import type { ChannelReferenceRefreshDiagnostic } from "@shared/channelReferenceRefresh";
import { channelReferenceHasPrice, channelReferenceMaximumTier, channelReferencePrice, channelReferencePageUrl, validDate, CHANNEL_REFERENCE_LABELS, CHANNEL_REFERENCE_STATUS_LABELS } from "./channelReferenceModel";
import { Popover, PopoverTrigger, PopoverContent } from "../components/ui/popover";
import { manualReferencePriceValid } from "./manualReferenceEdit";

export function ChannelReferenceCell({ source, quote, partNumber, manualPrice }: {
  // Diagnostics remain a typed input; operational details are not reference-link presentation.
  source: ChannelReferenceSource; quote?: ChannelReferenceQuote; partNumber?: string; diagnostic?: ChannelReferenceRefreshDiagnostic; manualPrice?: string | null;
}) {
  // A manual override is not a marketplace quote or evidence. Preserve every decimal digit, including zero.
  if (manualReferencePriceValid(manualPrice)) return <span className="ci-reference-cell ci-reference-manual">
    <span className="ci-reference-text admin-cell-primary" data-source={source} title={`¥${manualPrice}`} style={{ whiteSpace: "nowrap" }}>¥{manualPrice}</span>
    <small className="ci-reference-manual-tag">手填</small>
  </span>;
  const tier = quote ? channelReferenceMaximumTier(quote) : null;
  const price = tier?.unitPrice ?? quote?.unitPrice;
  const threshold = tier?.minQuantity ?? quote?.tierQuantity;
  const priced = Boolean(quote && quote.source === source && quote.currency === "CNY" && channelReferenceHasPrice(quote)
    && quote.matchedPartNumber?.trim() && quote.matchedBrand?.trim()
    && typeof price === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price) && Number.isFinite(Number(price)) && /[1-9]/.test(price)
    && Number.isSafeInteger(threshold) && (threshold ?? 0) > 0);
  const text = priced && quote ? channelReferencePrice(quote) : "暂未匹配";
  // Invalid direct use has no evidence control; the Host additionally validates the whole response.
  const evidence = quote && quote.source === source && (priced || quote.status !== "ok" && Object.hasOwn(CHANNEL_REFERENCE_STATUS_LABELS, quote.status));
  const safePage = evidence && quote ? channelReferencePageUrl(quote.pageUrl, source) : null;
  const product = Boolean(priced && safePage && new URL(safePage).pathname !== "/"
    && !/search|global\.html/i.test(new URL(safePage).pathname) && !new URL(safePage).searchParams.has("keyword"));
  const search = evidence && partNumber ? new URL(source === "lcsc" ? "https://so.szlcsc.com/global.html" : "https://search.ickey.cn/") : null;
  if (search) search.searchParams.set(source === "lcsc" ? "k" : "keyword", partNumber!);
  const label = CHANNEL_REFERENCE_LABELS[source];
  const collectedAt = (value: unknown) => validDate(value) ? `${new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  })}（北京时间）` : null;
  const priceCollectedAt = priced && quote ? collectedAt(quote.fetchedAt) : null;
  const stockCollectedAt = priced && quote && quote.stockQuantity !== null ? collectedAt(quote.stockFetchedAt ?? quote.fetchedAt) : null;
  const safeStockPage = stockCollectedAt && quote ? channelReferencePageUrl(quote.stockPageUrl ?? null, source) : null;
  return <span className="ci-reference-cell">
    <span className={`ci-reference-text ${priced ? "admin-cell-primary" : "ci-reference-placeholder"}`} data-source={source}
      style={{ whiteSpace: "nowrap" }}>{text}</span>
    {evidence && quote ? <Popover>
      <PopoverTrigger asChild><button type="button" className="ci-reference-evidence-button" aria-label={`查看${label}参考来源`} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" /></svg>
      </button></PopoverTrigger>
      <PopoverContent className="ci-reference-evidence-popover" align="start" collisionPadding={8} aria-label={`${label}参考来源`} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
        <strong>{label}</strong>
        {priceCollectedAt ? <p>价格采集：{priceCollectedAt}</p> : null}
        {stockCollectedAt ? <p>库存采集：{stockCollectedAt}</p> : null}
        {safePage ? <p><a href={safePage} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`${label}${product ? "准确匹配商品页（保存报价来源）" : "来源页面（非已匹配报价）"}`}>{product ? "商品页" : "来源页"}</a></p> : null}
        {safeStockPage && safeStockPage !== safePage ? <p><a href={safeStockPage} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`${label}独立库存来源`}>库存来源</a></p> : null}
        {search ? <p><a href={search.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`${label}完整型号公开搜索（非匹配商品）`}>完整型号搜索</a></p> : null}
      </PopoverContent>
    </Popover> : null}
  </span>;
}
