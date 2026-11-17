import {
  CRM_COMPANY_STOCK_MAX_ALLOCATIONS,
  CRM_COMPANY_STOCK_MAX_QTY,
  decimalToScaled,
  formatSalesOrderAmount,
  type SalesOrderDetail,
} from "../../../../shared/crmSalesOrders";

/** Sale-safe projection fixed by stock-protocol.md. No purchase costs or owner IDs. */
export type CompanyLot = {
  lotId: number;
  inboundOrderId: number;
  partNumber: string;
  brand: string;
  pkg: string;
  dc: string;
  lotNumber: string;
  location: string;
  availableQty: number;
  version: number;
};
export type LotDraft = {
  lot: CompanyLot;
  qty: string;
  agreedUnitPrice: string;
};
export type AllocationDraft = { lot: CompanyLot; qty: string };
type AllocationOrder = Pick<
  SalesOrderDetail,
  | "sourceType"
  | "status"
  | "items"
  | "companyStockAllocated"
  | "companyStockAllocations"
>;
/** Exact identity bytes, including legacy missing optional DC as the empty snapshot. */
export function allocationLotMatches(
  item: SalesOrderDetail["items"][number],
  lot: CompanyLot
) {
  return (
    lot.partNumber === item.partNumber &&
    lot.brand === (item.brand ?? "") &&
    lot.pkg === (item.pkg ?? "") &&
    lot.dc === (item.dc ?? "")
  );
}
export function allocationOrderError(order: AllocationOrder) {
  if (order.sourceType !== "demand" || order.status !== "confirmed")
    return "仅可为待交付需求订单整单分配公司库存";
  if (
    order.companyStockAllocated ||
    (order.companyStockAllocations ?? []).length
  )
    return "本单已有公司预留记录，不可增量或重新分配";
  if (
    !order.items.length ||
    order.items.some(
      item =>
        !Number.isSafeInteger(item.orderedQty) ||
        item.orderedQty <= 0 ||
        item.orderedQty > CRM_COMPANY_STOCK_MAX_QTY ||
        !Number.isSafeInteger(item.shippedQty) ||
        item.shippedQty !== 0
    )
  )
    return "旧出货或订单数量无效，不能转公司批次";
  return "";
}
/** Used by the real submit: all order items, never the selected item or a partial remainder. */
export function companyStockAllocationItems(
  order: AllocationOrder,
  drafts: Record<number, AllocationDraft[]>
) {
  const failure = allocationOrderError(order);
  if (failure) throw new Error(failure);
  const ids = new Set(order.items.map(item => item.id));
  if (
    ids.size !== order.items.length ||
    Object.keys(drafts).some(key => !ids.has(Number(key)))
  )
    throw new Error("分配物料不属于本订单或重复");
  let count = 0;
  const totals = new Map<number, { qty: bigint; available: bigint }>();
  const items = order.items.map(item => {
    const rows = drafts[item.id] ?? [];
    if (!rows.length) throw new Error("须一次性分配本单全部物料的全部数量");
    const seen = new Set<number>();
    let total = BigInt(0);
    const allocations = rows.map(({ lot, qty: rawQty }) => {
      if (++count > CRM_COMPANY_STOCK_MAX_ALLOCATIONS)
        throw new Error("全单最多200项批次分配");
      if (
        !selectableLot(lot) ||
        !allocationLotMatches(item, lot) ||
        seen.has(lot.lotId)
      )
        throw new Error("批次无效、重复或与本行物料不符");
      seen.add(lot.lotId);
      if (typeof rawQty !== "string" || !/^\d+$/.test(rawQty))
        throw new Error("分配数量须为正整数");
      const qty = Number(rawQty);
      if (
        !Number.isSafeInteger(qty) ||
        qty <= 0 ||
        qty > CRM_COMPANY_STOCK_MAX_QTY ||
        qty > lot.availableQty
      )
        throw new Error("分配数量无效或超过批次可售");
      total += BigInt(qty);
      const previous = totals.get(lot.lotId);
      const available = BigInt(lot.availableQty);
      const aggregate = (previous?.qty ?? BigInt(0)) + BigInt(qty);
      const limit =
        previous && previous.available < available
          ? previous.available
          : available;
      if (aggregate > limit || aggregate > BigInt(CRM_COMPANY_STOCK_MAX_QTY))
        throw new Error("同批次全单合量超过可售数量或库存数量上限");
      totals.set(lot.lotId, { qty: aggregate, available: limit });
      return { lotId: lot.lotId, qty };
    });
    if (total !== BigInt(item.orderedQty))
      throw new Error("须一次性分配本行全部订单数量");
    return { orderItemId: item.id, allocations };
  });
  return items;
}
export function requestId() {
  return (
    globalThis.crypto?.randomUUID?.().replace(/-/g, "") ??
    `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`
  );
}
export function selectableLot(lot: CompanyLot) {
  return (
    Number.isSafeInteger(lot.lotId) &&
    lot.lotId > 0 &&
    Number.isSafeInteger(lot.availableQty) &&
    lot.availableQty > 0 &&
    Boolean(lot.partNumber)
  );
}
export function lotLabel(lot: CompanyLot) {
  return [
    lot.partNumber,
    lot.brand,
    lot.pkg,
    lot.dc && `DC ${lot.dc}`,
    lot.location,
    lot.lotNumber && `Lot ${lot.lotNumber}`,
    `入库 #${lot.inboundOrderId}`,
  ]
    .filter(Boolean)
    .join(" / ");
}
/** Separate rows retain real lot IDs even for identical PNs; snapshots are only comparison fields. */
export function companyOrderItems(lines: LotDraft[]) {
  if (!lines.length) throw new Error("请选择公司库存批次");
  const seen = new Set<number>();
  return lines.map(({ lot, qty: rawQty, agreedUnitPrice }) => {
    if (!selectableLot(lot) || seen.has(lot.lotId))
      throw new Error("批次已失效或重复，请重新选择");
    seen.add(lot.lotId);
    const qty = Number(rawQty);
    if (!Number.isSafeInteger(qty) || qty <= 0 || qty > lot.availableQty)
      throw new Error("数量须为正整数且不超过批次可售数量");
    decimalToScaled(agreedUnitPrice.trim());
    return {
      partNumber: lot.partNumber,
      brand: lot.brand,
      pkg: lot.pkg,
      dc: lot.dc,
      qty,
      agreedUnitPrice: agreedUnitPrice.trim(),
      allocations: [{ lotId: lot.lotId, qty }],
      qtyUnit: "个",
      deliveryRequirement: "",
      note: "",
    };
  });
}
export function expenseInput(amount: string, note: string) {
  const trimmed = amount.trim();
  if (!/^(?:0|[1-9]\d{0,14})(?:\.\d{1,4})?$/.test(trimmed))
    throw new Error("费用须为非负金额，最多4位小数");
  decimalToScaled(trimmed);
  if (!note.trim()) throw new Error("请填写费用说明");
  return { amount: trimmed, note: note.trim() };
}
export function serverMoney(value: string | null | undefined) {
  return value == null || !/^-?\d+(?:\.\d+)?$/.test(value)
    ? "待核"
    : formatSalesOrderAmount(value);
}
export function orderOwnerLabel(order: { createdByName?: string }) {
  return order.createdByName || "—";
}
export function orderMaterialLabel(order: {
  itemCount?: number;
  orderedQty?: number;
}) {
  return `${order.itemCount ?? "—"} 行物料 · ${order.orderedQty ?? "—"} 件`;
}
