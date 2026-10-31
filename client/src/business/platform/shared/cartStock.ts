export type CartStockItem = {
  id: number;
  inventoryId: number;
  partNumber: string | null;
  qty: number;
  qtyOnSale: number | string | null;
  moq?: number | null;
  checked?: boolean;
};

export type CartStockIssue = {
  cartId: number;
  inventoryId: number;
  partNumber: string;
  requestedQty: number;
  availableQty: number;
  moq: number;
};

export function stockIssueFor(item: CartStockItem): CartStockIssue | null {
  const availableQty = Math.max(0, Number(item.qtyOnSale ?? 0));
  if (!Number.isFinite(availableQty) || item.qty <= availableQty) return null;
  return {
    cartId: item.id,
    inventoryId: item.inventoryId,
    partNumber: item.partNumber?.trim() || "商品",
    requestedQty: item.qty,
    availableQty,
    moq: Math.max(1, Number(item.moq ?? 1)),
  };
}

export function firstCheckedStockIssue(items: CartStockItem[]): CartStockIssue | null {
  for (const item of items) {
    if (!item.checked) continue;
    const issue = stockIssueFor(item);
    if (issue) return issue;
  }
  return null;
}

export function stockChangeMessage(partNumber: string, availableQty: number): string {
  return `${partNumber.trim() || "商品"} 当前可售 ${Math.max(0, Math.floor(availableQty))} 颗`;
}

export function parseStockChangeMessage(message: string): {
  partNumber: string;
  availableQty: number;
} | null {
  const match = message.trim().match(/^(.+?) 当前可售 ([\d,]+) 颗$/);
  if (!match) return null;
  const availableQty = Number(match[2].replace(/,/g, ""));
  if (!Number.isSafeInteger(availableQty) || availableQty < 0) return null;
  return { partNumber: match[1], availableQty };
}
