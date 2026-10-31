export type InventoryQuantityInput = {
  qtyOnSale?: number | null;
  qtyOrder?: number | null;
  leadTime?: string | null;
};

export type InventoryQuantityDisplay = {
  spotQuantity: number | null;
  orderQuantity: number | null;
};

function positiveQuantity(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Keeps saleable spot stock and order-only availability distinct in every client
 * surface. A missing or zero order quantity deliberately renders as unknown
 * rather than as a saleable quantity, preserving compatibility with old records.
 */
export function inventoryQuantityDisplay(
  value: InventoryQuantityInput
): InventoryQuantityDisplay {
  return {
    spotQuantity: positiveQuantity(value.qtyOnSale),
    orderQuantity: positiveQuantity(value.qtyOrder),
  };
}

export function formatInventoryQuantity(value: number | null): string {
  return value == null ? "—" : value.toLocaleString("zh-CN");
}

/** Returns independent, never-summed availability text for public client views. */
export function formatInventoryAvailability(
  value: InventoryQuantityInput
): string {
  const { spotQuantity, orderQuantity } = inventoryQuantityDisplay(value);
  const isZeroQuantityOrderListing =
    spotQuantity === null &&
    orderQuantity === null &&
    value.leadTime?.trim() === "订货";
  return [
    spotQuantity == null
      ? null
      : `现货 ${formatInventoryQuantity(spotQuantity)} 颗`,
    orderQuantity == null
      ? null
      : `订货 ${formatInventoryQuantity(orderQuantity)} 颗`,
    isZeroQuantityOrderListing ? "订货库存 —" : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(" · ");
}
