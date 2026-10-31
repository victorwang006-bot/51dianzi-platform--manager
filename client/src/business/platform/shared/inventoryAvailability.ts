/** Order availability is separate from physically saleable stock. Null is unknown. */
export const MAX_INVENTORY_LADDER_TIERS = 64;
export const MAX_INVENTORY_QUANTITY = 2_147_483_647;
export function hasOrderAvailability(value: { qtyOrder?: number | null; leadTime?: string | null }): boolean {
  return Number.isSafeInteger(value.qtyOrder) && Number(value.qtyOrder) > 0;
}
export function canPublishInventoryAvailability(value: { qtyOnSale: number; qtyOrder?: number | null; leadTime?: string | null }): boolean {
  return value.qtyOnSale > 0 || (hasOrderAvailability(value) && value.leadTime?.trim() === "订货");
}
