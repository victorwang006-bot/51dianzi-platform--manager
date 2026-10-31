export function createMarketQuoteChatUrl(quote: {
  supplierId: number;
  partNumber: string;
  quoteQuantity: number | null;
  packaging: string;
  quotePrice: string;
  taxStatus: string;
  quoteKind: string;
}) {
  const params = new URLSearchParams({
    userId: String(quote.supplierId),
    quoteSource: "data_hub",
    quotePart: quote.partNumber.slice(0, 128),
    quotePackaging: quote.packaging.slice(0, 40),
    quoteQty: quote.quoteQuantity == null ? "" : String(quote.quoteQuantity),
    quotePrice: quote.quotePrice.slice(0, 32),
    quoteTax: quote.taxStatus,
    quoteKind: quote.quoteKind,
  });
  return `/chat?${params.toString()}`;
}
export function readMarketQuoteChatDraft(params: URLSearchParams): string | null {
  if (params.get("quoteSource") !== "data_hub") return null;
  const part = params.get("quotePart")?.trim() ?? "";
  const packaging = params.get("quotePackaging")?.trim() ?? "";
  const qty = Number(params.get("quoteQty"));
  const price = Number(params.get("quotePrice"));
  if (!part || part.length > 128 || /[\x00-\x1f\x7f]/.test(part) || packaging.length > 40 || /[\x00-\x1f\x7f]/.test(packaging)) return null;
  if ((params.get("quoteQty") && (!Number.isSafeInteger(qty) || qty <= 0)) || !Number.isFinite(price) || price <= 0) return null;
  const tax = params.get("quoteTax") === "included" ? "含税" : params.get("quoteTax") === "excluded" ? "未税" : "税费待确认";
  const origin = params.get("quoteKind") === "forum" ? "论坛报价" : "报价记录";
  return `您好，我在数据通看到${origin}：${part}（${packaging || "包装待确认"}），${qty > 0 ? `数量${qty.toLocaleString("zh-CN")}片` : "数量待确认"}，报价¥${price.toFixed(4)}/片（${tax}）。请确认当前价格、供货包装、库存及交期。`;
}
