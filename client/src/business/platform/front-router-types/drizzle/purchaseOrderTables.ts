import { date, datetime, decimal, index, int, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** 企业采购单不等于商城买家订单或销售订单；原报价和入库单保持各自唯一真相。 */
export const crmPurchaseOrders = mysqlTable("crm_purchase_orders", {
  id: int("id").autoincrement().primaryKey(),
  enterpriseId: int("enterpriseId").notNull(),
  ownerUserId: int("ownerUserId").notNull(),
  orderNo: varchar("orderNo", { length: 40 }).notNull(),
  createdByUserId: int("createdByUserId").notNull(),
  createRequestId: varchar("createRequestId", { length: 80 }).notNull(),
  createPayloadHash: varchar("createPayloadHash", { length: 64 }).notNull(),
  sourceAcceptanceId: int("sourceAcceptanceId"),
  sourceQuoteVersion: int("sourceQuoteVersion"),
  supplierName: varchar("supplierName", { length: 128 }).notNull(),
  supplierOrderNo: varchar("supplierOrderNo", { length: 64 }).notNull().default(""),
  expectedDeliveryDate: date("expectedDeliveryDate", { mode: "string" }),
  note: text("note"),
  totalAmount: decimal("totalAmount", { precision: 18, scale: 2 }).notNull(),
  /** 采购员人工维护的履约进度，不是收款凭证或支付流水。 */
  paymentStatus: varchar("paymentStatus", { length: 16 }).notNull().default("pending"),
  paymentNote: varchar("paymentNote", { length: 500 }).notNull().default(""),
  paymentUpdatedAt: datetime("paymentUpdatedAt", { mode: "string" }),
  carrier: varchar("carrier", { length: 100 }).notNull().default(""),
  trackingNo: varchar("trackingNo", { length: 128 }).notNull().default(""),
  lifecycle: varchar("lifecycle", { length: 16 }).notNull().default("active"),
  cancelledAt: datetime("cancelledAt", { mode: "string" }),
  cancelReason: varchar("cancelReason", { length: 500 }),
  version: int("version").notNull().default(1),
  createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  updatedAt: datetime("updatedAt", { mode: "string" }).notNull(),
}, table => ({
  orderNoUnique: uniqueIndex("crm_po_enterprise_order_no_unique").on(table.enterpriseId, table.orderNo),
  sourceUnique: uniqueIndex("crm_po_acceptance_unique").on(table.enterpriseId, table.sourceAcceptanceId),
  createRequestUnique: uniqueIndex("crm_po_create_request_unique").on(table.enterpriseId, table.createdByUserId, table.createRequestId),
  enterpriseCreatedIdx: index("crm_po_enterprise_created_idx").on(table.enterpriseId, table.createdAt, table.id),
  ownerIdx: index("crm_po_owner_idx").on(table.ownerUserId, table.id),
}));

export const crmPurchaseOrderItems = mysqlTable("crm_purchase_order_items", {
  id: int("id").autoincrement().primaryKey(),
  enterpriseId: int("enterpriseId").notNull(),
  orderId: int("orderId").notNull(),
  demandItemId: int("demandItemId"),
  partNumber: varchar("partNumber", { length: 128 }).notNull(),
  brand: varchar("brand", { length: 64 }).notNull().default(""),
  pkg: varchar("pkg", { length: 64 }).notNull().default(""),
  qtyUnit: varchar("qtyUnit", { length: 8 }).notNull().default("片"),
  qty: int("qty").notNull(),
  unitPrice: decimal("unitPrice", { precision: 19, scale: 4 }).notNull(),
  shippedQty: int("shippedQty").notNull().default(0),
  createdAt: datetime("createdAt", { mode: "string" }).notNull(),
}, table => ({
  orderIdx: index("crm_po_items_order_idx").on(table.enterpriseId, table.orderId, table.id),
  partIdx: index("crm_po_items_part_idx").on(table.enterpriseId, table.partNumber, table.id),
}));

/** 入库单一对一归属采购明细；库存和付款仍由原入库单驱动。 */
export const crmPurchaseOrderInbounds = mysqlTable("crm_purchase_order_inbounds", {
  id: int("id").autoincrement().primaryKey(),
  enterpriseId: int("enterpriseId").notNull(),
  ownerUserId: int("ownerUserId").notNull(),
  orderId: int("orderId").notNull(),
  orderItemId: int("orderItemId").notNull(),
  inboundOrderId: int("inboundOrderId").notNull(),
  linkedByUserId: int("linkedByUserId").notNull(),
  createdAt: datetime("createdAt", { mode: "string" }).notNull(),
}, table => ({
  inboundUnique: uniqueIndex("crm_po_inbounds_owner_inbound_unique").on(table.ownerUserId, table.inboundOrderId),
  orderIdx: index("crm_po_inbounds_order_idx").on(table.enterpriseId, table.orderId, table.id),
}));

/** 收到的供应商发票，仅保存元数据；个人中心的发票抬头不是本表。 */
export const crmPurchaseOrderInvoices = mysqlTable("crm_purchase_order_invoices", {
  id: int("id").autoincrement().primaryKey(),
  enterpriseId: int("enterpriseId").notNull(),
  orderId: int("orderId").notNull(),
  actorUserId: int("actorUserId").notNull(),
  requestId: varchar("requestId", { length: 80 }).notNull(),
  invoiceNo: varchar("invoiceNo", { length: 64 }).notNull(),
  kind: varchar("kind", { length: 16 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 2 }).notNull(),
  issuedDate: date("issuedDate", { mode: "string" }).notNull(),
  note: varchar("note", { length: 500 }).notNull().default(""),
  voidedAt: datetime("voidedAt", { mode: "string" }),
  voidedByUserId: int("voidedByUserId"),
  voidReason: varchar("voidReason", { length: 500 }),
  createdAt: datetime("createdAt", { mode: "string" }).notNull(),
}, table => ({
  requestUnique: uniqueIndex("crm_po_invoice_request_unique").on(table.enterpriseId, table.actorUserId, table.requestId),
  orderIdx: index("crm_po_invoices_order_idx").on(table.enterpriseId, table.orderId, table.id),
}));

/** 修改和更正只增审计，取消采购单不会删除原入库、付款、库存或发票历史。 */
export const crmPurchaseOrderEvents = mysqlTable("crm_purchase_order_events", {
  id: int("id").autoincrement().primaryKey(),
  enterpriseId: int("enterpriseId").notNull(),
  orderId: int("orderId").notNull(),
  actorUserId: int("actorUserId").notNull(),
  requestId: varchar("requestId", { length: 80 }).notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  details: json("details"),
  createdAt: datetime("createdAt", { mode: "string" }).notNull(),
}, table => ({
  requestUnique: uniqueIndex("crm_po_event_request_unique").on(table.enterpriseId, table.actorUserId, table.requestId),
  orderIdx: index("crm_po_events_order_idx").on(table.enterpriseId, table.orderId, table.id),
}));
