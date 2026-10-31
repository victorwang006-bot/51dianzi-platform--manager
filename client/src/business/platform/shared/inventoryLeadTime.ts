export const INVENTORY_LEAD_TIME_REQUIRED_MESSAGE = "请输入货期";
export const INVENTORY_LEAD_TIME_FALLBACK = "联系确认";

/** 交期是发布库存的采购决策字段；空白不能被解释为“现货”。 */
export function hasInventoryLeadTime(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

/** 所有公开页面对历史空交期使用同一保守文案。 */
export function displayInventoryLeadTime(value: string | null | undefined): string {
  return value?.trim() || INVENTORY_LEAD_TIME_FALLBACK;
}

export function isSpotInventoryLeadTime(value: string | null | undefined): boolean {
  return hasInventoryLeadTime(value) && value!.includes("现货");
}
