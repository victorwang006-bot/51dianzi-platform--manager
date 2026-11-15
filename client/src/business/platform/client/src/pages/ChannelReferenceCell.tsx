import React from "react";
import type { ChannelReferenceQuote, ChannelReferenceSource } from "@shared/channelReference";
import type { ChannelReferenceRefreshDiagnostic } from "@shared/channelReferenceRefresh";
import { channelReferenceHasPrice, channelReferenceMaximumTier, channelReferencePrice, channelReferencePageUrl, CHANNEL_REFERENCE_LABELS, CHANNEL_REFERENCE_STATUS_LABELS } from "./channelReferenceModel";
import { CHANNEL_REFERENCE_REFRESH_LABELS } from "./ChannelInventoryHost.referenceRefresh";
import { formatBeijingDateTimeWithSeconds } from "../../../shared/beijingTime";
import { Popover, PopoverTrigger, PopoverContent } from "../components/ui/popover";

export function ChannelReferenceCell({ source, quote, partNumber, diagnostic }: {
  source: ChannelReferenceSource; quote?: ChannelReferenceQuote; partNumber?: string; diagnostic?: ChannelReferenceRefreshDiagnostic;
}) {
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
  const date = (value: string | null | undefined) => value ? `${formatBeijingDateTimeWithSeconds(value) || "时间不可用"}（北京时间）` : "未记录";
  return <>
    <span className={priced ? "admin-cell-primary" : "ci-reference-placeholder"} data-source={source}
      style={{ display: "block", fontSize: 11, lineHeight: "16px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</span>
    {evidence && quote ? <div className="ci-reference-evidence-entry">
      <Popover>
        <PopoverTrigger asChild><button type="button" className="ci-reference-evidence-button" aria-label={`查看${CHANNEL_REFERENCE_LABELS[source]}参考来源`} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" /></svg>
        </button></PopoverTrigger>
        <PopoverContent className="ci-reference-evidence-popover" align="start" collisionPadding={8} aria-label={`${CHANNEL_REFERENCE_LABELS[source]}参考来源`} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
          <strong>{CHANNEL_REFERENCE_LABELS[source]} · {CHANNEL_REFERENCE_STATUS_LABELS[quote.status]}</strong>
          <p>保存记录，非实时库存或报价；不修改原库存和业务报价。</p>
          <p>{source === "lcsc" ? "立创自营公开商品参考；合作、海外货源不混入自营。" : "云汉公开商品参考，与立创自营分开；合作、海外货源不混入自营。"}</p>
          <p>采集时间：{date(quote.fetchedAt)}</p>
          {safePage ? <p><a href={safePage} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{product ? "准确匹配商品页（保存报价来源）" : "来源页面（非已匹配报价）"}</a></p> : null}
          {search ? <p><a href={search.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">完整型号公开搜索（非匹配商品）</a></p> : null}
          {diagnostic?.source === source ? <>
            <p>{CHANNEL_REFERENCE_REFRESH_LABELS[diagnostic.state]}</p>
            <p>最近尝试：{date(diagnostic.lastAttemptAt)}{diagnostic.lastAttemptStatus ? ` · ${CHANNEL_REFERENCE_STATUS_LABELS[diagnostic.lastAttemptStatus]}` : ""}</p>
            {diagnostic.nextAllowedAt ? <p>最早重查：{date(diagnostic.nextAllowedAt)}</p> : null}
            {diagnostic.referenceVersion ? <p className="ci-reference-evidence-hash">参考版本：{diagnostic.referenceVersion}</p> : null}
            {diagnostic.sourceSha256 ? <p className="ci-reference-evidence-hash">公开网页 SHA256：{diagnostic.sourceSha256}</p> : null}
          </> : null}
        </PopoverContent>
      </Popover>
    </div> : null}
  </>;
}
