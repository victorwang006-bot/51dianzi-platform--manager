import { sql } from "drizzle-orm";
import { int, json, mysqlEnum, mysqlTable, timestamp, uniqueIndex, index, varchar, bigint } from "drizzle-orm/mysql-core";
import { BUSINESS_AFTER_SALE_KINDS, BUSINESS_AFTER_SALE_STATUSES } from "../shared/businessSalesOrderMetadata";

const tuple = () => ({
  merchantId: int("merchantId", { unsigned: true }).notNull(),
  orderId: int("orderId", { unsigned: true }).notNull(),
  orderNumber: varchar("orderNumber", { length: 128 }).notNull(),
  customerId: int("customerId", { unsigned: true }).notNull(),
});
const createdAt = () => timestamp("createdAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull();
const updatedAt = () => timestamp("updatedAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull();

/** Native-admin provenance registry / write lock. Populated only on a new metadata write, never by backfill. */
export const businessSalesOrderMetadataOrders = mysqlTable("business_sales_order_metadata_orders", {
  ...tuple(), createdAt: createdAt(),
}, table => ({
  orderUnique: uniqueIndex("bsomo_order_unique").on(table.merchantId, table.orderId),
  numberUnique: uniqueIndex("bsomo_number_unique").on(table.merchantId, table.orderNumber),
}));

export const businessSalesOrderReceivers = mysqlTable("business_sales_order_receivers", {
  ...tuple(), receiver: varchar("receiver", { length: 64 }).notNull(),
  receiverPhone: varchar("receiverPhone", { length: 40 }).notNull(),
  receiverAddress: varchar("receiverAddress", { length: 500 }).notNull(),
  note: varchar("note", { length: 500 }).notNull(), version: int("version", { unsigned: true }).default(1).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, table => ({ orderUnique: uniqueIndex("bsor_order_unique").on(table.merchantId, table.orderId) }));

/** A case is a record of intent, never a financial/refund/stock command. No delete endpoint. */
export const businessSalesOrderAfterSales = mysqlTable("business_sales_order_after_sales", {
  id: int("id", { unsigned: true }).autoincrement().primaryKey(), ...tuple(),
  kind: mysqlEnum("kind", BUSINESS_AFTER_SALE_KINDS).notNull(),
  reason: varchar("reason", { length: 500 }).notNull(),
  status: mysqlEnum("status", BUSINESS_AFTER_SALE_STATUSES).default("open").notNull(),
  resolution: varchar("resolution", { length: 500 }).default("").notNull(),
  version: int("version", { unsigned: true }).default(1).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(), closedAt: timestamp("closedAt", { fsp: 3 }),
}, table => ({ orderIdx: index("bsoas_order_idx").on(table.merchantId, table.orderId, table.id) }));

export const businessSalesOrderMetadataRequests = mysqlTable("business_sales_order_metadata_requests", {
  ...tuple(), actorAdminId: int("actorAdminId", { unsigned: true }).notNull(),
  requestId: varchar("requestId", { length: 80 }).notNull(),
  action: mysqlEnum("action", ["save_receiver", "add_after_sale", "update_after_sale"]).notNull(),
  payloadSha256: varchar("payloadSha256", { length: 64 }).notNull(), resultJson: json("resultJson"),
  createdAt: createdAt(),
}, table => ({ requestUnique: uniqueIndex("bsomr_request_unique").on(table.merchantId, table.orderId, table.actorAdminId, table.requestId) }));

/** Append-only; audit + request result + receiver/case share one Drizzle/mysql2 transaction. */
export const businessSalesOrderMetadataAudits = mysqlTable("business_sales_order_metadata_audits", {
  id: bigint("id", { unsigned: true, mode: "number" }).autoincrement().primaryKey(), ...tuple(),
  caseId: int("caseId", { unsigned: true }),
  action: mysqlEnum("action", ["save_receiver", "add_after_sale", "update_after_sale"]).notNull(),
  actorAdminId: int("actorAdminId", { unsigned: true }).notNull(),
  actorFrontUserId: int("actorFrontUserId", { unsigned: true }).notNull(),
  bindingVersion: int("bindingVersion", { unsigned: true }).notNull(),
  scopeVersion: int("scopeVersion", { unsigned: true }).notNull(),
  requestId: varchar("requestId", { length: 80 }).notNull(),
  beforeJson: json("beforeJson"), afterJson: json("afterJson").notNull(), createdAt: createdAt(),
}, table => ({
  requestUnique: uniqueIndex("bsoma_request_unique").on(table.merchantId, table.orderId, table.actorAdminId, table.requestId),
  orderIdx: index("bsoma_order_idx").on(table.merchantId, table.orderId, table.id),
}));
