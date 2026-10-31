export const INQUIRY_QUANTITY_UNIT = "片" as const;

/**
 * 库存询价未填写数量时以 0 写入业务表，表示“待确认”。
 * 业务表为历史非空整数列，使用稳定哨兵可避免为纯展示语义做破坏性迁移。
 */
export function storedInquiryQuantity(quantity: number | null | undefined) {
  return Number.isInteger(quantity) && Number(quantity) > 0 ? Number(quantity) : 0;
}

export function inquiryQuantityText(quantity: number | null | undefined) {
  const stored = storedInquiryQuantity(quantity);
  return stored > 0
    ? `${stored.toLocaleString("zh-CN")}${INQUIRY_QUANTITY_UNIT}`
    : "待确认";
}

/** 兼容历史询价卡片中的字符串数量，并统一新展示的单位。 */
export function legacyInquiryQuantityText(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized === "待确认") return "待确认";
  if (/^[\d,]+$/.test(normalized)) return `${normalized}${INQUIRY_QUANTITY_UNIT}`;
  return normalized
    .replace(/\s*颗(?=（|$)/g, INQUIRY_QUANTITY_UNIT)
    .replace(/\s+片(?=（|$)/g, INQUIRY_QUANTITY_UNIT);
}
