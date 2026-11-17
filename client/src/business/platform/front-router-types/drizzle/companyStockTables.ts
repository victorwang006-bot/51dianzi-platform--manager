import { sql } from "drizzle-orm";
import { bigint, boolean, check, datetime, decimal, index, int, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
const cost = (name: string) => decimal(name, { precision: 18, scale: 6 });
const version = () => bigint("version", { mode: "number", unsigned: true }).notNull().default(1);

/** Empty sidecar at migration. NEVER backfill from inbound qty/effect automatically. */
export const companyStockLots = mysqlTable("company_stock_lots", {
  id: int("id").autoincrement().primaryKey(), enterpriseId: int("enterpriseId").notNull(), ownerUserId: int("ownerUserId").notNull(),
  inboundOrderId: int("inboundOrderId").notNull(), partNumber: varchar("partNumber", { length: 128 }).notNull(),
  brand: varchar("brand", { length: 64 }).notNull().default(""), pkg: varchar("pkg", { length: 64 }).notNull().default(""),
  dc: varchar("dc", { length: 16 }).notNull().default(""), lotNumber: varchar("lotNumber", { length: 64 }).notNull().default(""),
  location: varchar("location", { length: 64 }).notNull().default(""), receivedQty: int("receivedQty").notNull(),
  remainingQty: int("remainingQty").notNull(), reservedQty: int("reservedQty").notNull().default(0),
  verified: boolean("verified").notNull().default(false), frozen: boolean("frozen").notNull().default(false), version: version(),
  unitCostTaxIncluded: cost("unitCostTaxIncluded"), unitCostTaxExcluded: cost("unitCostTaxExcluded"),
  unitCostBasis: varchar("unitCostBasis", { length: 32 }), taxRate: decimal("taxRate", { precision: 5, scale: 2 }),
  receiptHash: varchar("receiptHash", { length: 64 }).notNull(), verifiedByUserId: int("verifiedByUserId"),
  reconciliationRequestId: varchar("reconciliationRequestId", { length: 64 }),
  verifiedAt: datetime("verifiedAt", { mode: "string" }), reversedAt: datetime("reversedAt", { mode: "string" }),
  createdAt: datetime("createdAt", { mode: "string" }).notNull(),
}, t => ({
  sourceUnique: uniqueIndex("company_stock_lots_source_unique").on(t.enterpriseId, t.ownerUserId, t.inboundOrderId),
  reconciliationRequestUnique: uniqueIndex("company_stock_lots_reconcile_request_unique").on(t.enterpriseId, t.ownerUserId, t.reconciliationRequestId),
  ownerPartIdx: index("company_stock_lots_owner_part_idx").on(t.ownerUserId, t.partNumber, t.id),
  candidateIdx: index("company_stock_lots_candidate_idx").on(t.enterpriseId, t.ownerUserId, t.verified, t.frozen, t.id),
  quantities: check("company_stock_lots_quantities", sql`${t.receivedQty} > 0 AND ${t.remainingQty} >= 0 AND ${t.remainingQty} <= ${t.receivedQty} AND ${t.reservedQty} >= 0 AND ${t.reservedQty} <= ${t.remainingQty}`),
}));
export const companyStockReservations = mysqlTable("company_stock_reservations", {
  id: int("id").autoincrement().primaryKey(), enterpriseId: int("enterpriseId").notNull(), ownerUserId: int("ownerUserId").notNull(),
  orderId: int("orderId").notNull(), orderItemId: int("orderItemId").notNull(), lotId: int("lotId").notNull(),
  qty: int("qty").notNull(), consumedQty: int("consumedQty").notNull().default(0), releasedQty: int("releasedQty").notNull().default(0),
  version: version(), createdByUserId: int("createdByUserId").notNull(), createdAt: datetime("createdAt", { mode: "string" }).notNull(),
}, t => ({
  allocationUnique: uniqueIndex("company_stock_reservations_allocation_unique").on(t.enterpriseId, t.orderId, t.orderItemId, t.lotId),
  orderIdx: index("company_stock_reservations_order_idx").on(t.enterpriseId, t.ownerUserId, t.orderId, t.lotId),
  quantities: check("company_stock_reservations_quantities", sql`${t.qty} > 0 AND ${t.consumedQty} >= 0 AND ${t.releasedQty} >= 0 AND ${t.consumedQty} + ${t.releasedQty} <= ${t.qty}`),
}));
export const companyStockConsumptions = mysqlTable("company_stock_consumptions", {
  id: int("id").autoincrement().primaryKey(), enterpriseId: int("enterpriseId").notNull(), ownerUserId: int("ownerUserId").notNull(),
  orderId: int("orderId"), shipmentId: int("shipmentId"), orderItemId: int("orderItemId"), lotId: int("lotId").notNull(),
  outboundOrderId: int("outboundOrderId").notNull(), qty: int("qty").notNull(),
  unitCostTaxIncluded: cost("unitCostTaxIncluded"), unitCostTaxExcluded: cost("unitCostTaxExcluded"),
  unitCostBasis: varchar("unitCostBasis", { length: 32 }), taxRate: decimal("taxRate", { precision: 5, scale: 2 }),
  actorUserId: int("actorUserId").notNull(), createdAt: datetime("createdAt", { mode: "string" }).notNull(),
}, t => ({
  shipmentLotUnique: uniqueIndex("company_stock_consumptions_shipment_lot_unique").on(t.enterpriseId, t.shipmentId, t.orderItemId, t.lotId),
  outboundLotUnique: uniqueIndex("company_stock_consumptions_outbound_lot_unique").on(t.outboundOrderId, t.lotId),
  orderIdx: index("company_stock_consumptions_order_idx").on(t.enterpriseId, t.ownerUserId, t.orderId),
}));
export const companyStockShipmentKeys = mysqlTable("company_stock_shipment_keys", {
  enterpriseId: int("enterpriseId").notNull(), ownerUserId: int("ownerUserId").notNull(), shipmentId: int("shipmentId").notNull(),
  orderId: int("orderId").notNull(), payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
  completed: boolean("completed").notNull().default(false), createdAt: datetime("createdAt", { mode: "string" }).notNull(),
}, t => ({ shipmentUnique: uniqueIndex("company_stock_shipment_keys_unique").on(t.enterpriseId, t.shipmentId) }));
