import React from "react";
import type { ChannelReferenceQuote, ChannelReferenceSource } from "@shared/channelReference";
import { channelReferenceHasPrice, channelReferenceMaximumTier, channelReferencePrice } from "./channelReferenceModel";

export function ChannelReferenceCell({ source, quote }: { source: ChannelReferenceSource; quote?: ChannelReferenceQuote }) {
  const tier = quote ? channelReferenceMaximumTier(quote) : null;
  const price = tier?.unitPrice ?? quote?.unitPrice;
  const threshold = tier?.minQuantity ?? quote?.tierQuantity;
  // The lookup model validates current-row binding. Direct cell use also fails closed.
  if (!quote || quote.source !== source || !channelReferenceHasPrice(quote)
    || !quote.matchedPartNumber?.trim() || !quote.matchedBrand?.trim()
    || typeof price !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(price) || !Number.isFinite(Number(price))
    || !/[1-9]/.test(price)
    || !Number.isSafeInteger(threshold) || (threshold ?? 0) <= 0) {
    return <span className="ci-reference-placeholder" data-source={source}>暂未匹配</span>;
  }
  return <span className="admin-cell-primary" data-source={source}
    style={{ display: "block", fontSize: 11, lineHeight: "16px", overflowWrap: "anywhere" }}>
    {channelReferencePrice(quote)}
  </span>;
}
