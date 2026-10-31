import {
  date,
  datetime,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Tenant-owned internal sales orders created only from submitted customer demands.
 * They intentionally have no relation to marketplace orders, payments, inventory,
 * procurement POs, or shipment workflows.
 */
export const crmSalesOrders = mysqlTable(
  "crm_sales_orders",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    customerId: int("customerId").notNull(),
    customerName: varchar("customerName", { length: 128 }).notNull(),
    demandId: int("demandId").notNull(),
    demandNo: varchar("demandNo", { length: 32 }).notNull(),
    projectName: varchar("projectName", { length: 128 }).notNull().default(""),
    orderNumber: varchar("orderNumber", { length: 48 }).notNull(),
    status: mysqlEnum("status", ["confirmed", "cancelled"]).notNull().default("confirmed"),
    currency: varchar("currency", { length: 8 }).notNull().default("CNY"),
    totalAmount: decimal("totalAmount", { precision: 30, scale: 4 }).notNull(),
    dueDate: date("dueDate", { mode: "string" }),
    confirmationNote: varchar("confirmationNote", { length: 500 }).notNull(),
    createdByUserId: int("createdByUserId").notNull(),
    cancelledByUserId: int("cancelledByUserId"),
    cancelledAt: datetime("cancelledAt", { mode: "string" }),
    cancelledReason: varchar("cancelledReason", { length: 500 }),
    version: int("version").notNull().default(1),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
    updatedAt: datetime("updatedAt", { mode: "string" }).notNull(),
  },
  table => ({
    enterpriseOrderNumberUnique: uniqueIndex("crm_sales_orders_enterprise_number_unique").on(table.enterpriseId, table.orderNumber),
    enterpriseCustomerUpdatedIdx: index("crm_sales_orders_enterprise_customer_updated_idx").on(table.enterpriseId, table.customerId, table.updatedAt, table.id),
    enterpriseStatusUpdatedIdx: index("crm_sales_orders_enterprise_status_updated_idx").on(table.enterpriseId, table.status, table.updatedAt, table.id),
    enterpriseDemandIdx: index("crm_sales_orders_enterprise_demand_idx").on(table.enterpriseId, table.demandId, table.id),
  }),
);

export const crmSalesOrderItems = mysqlTable(
  "crm_sales_order_items",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    orderId: int("orderId").notNull(),
    sourceDemandItemId: int("sourceDemandItemId").notNull(),
    sortOrder: int("sortOrder").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    brand: varchar("brand", { length: 64 }).notNull().default(""),
    pkg: varchar("pkg", { length: 64 }).notNull().default(""),
    qtyUnit: varchar("qtyUnit", { length: 8 }).notNull(),
    demandQty: int("demandQty").notNull(),
    orderedQty: int("orderedQty").notNull(),
    unitPrice: decimal("unitPrice", { precision: 19, scale: 4 }).notNull(),
    lineAmount: decimal("lineAmount", { precision: 30, scale: 4 }).notNull(),
    deliveryRequirement: varchar("deliveryRequirement", { length: 80 }).notNull().default(""),
    note: varchar("note", { length: 500 }).notNull().default(""),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    orderSourceDemandItemUnique: uniqueIndex("crm_sales_order_items_order_source_unique").on(table.orderId, table.sourceDemandItemId),
    tenantSourceDemandItemIdx: index("crm_sales_order_items_tenant_source_idx").on(table.enterpriseId, table.sourceDemandItemId, table.orderId),
  }),
);

export const crmSalesOrderRequests = mysqlTable(
  "crm_sales_order_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    requestId: varchar("requestId", { length: 80 }).notNull(),
    action: varchar("action", { length: 24 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    orderId: int("orderId").notNull().default(0),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    actorRequestUnique: uniqueIndex("crm_sales_order_requests_actor_request_unique").on(table.enterpriseId, table.actorUserId, table.requestId),
  }),
);

export const crmSalesOrderAudits = mysqlTable(
  "crm_sales_order_audits",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    customerId: int("customerId").notNull(),
    orderId: int("orderId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    note: varchar("note", { length: 500 }).notNull().default(""),
    requestId: varchar("requestId", { length: 80 }),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    orderCreatedIdx: index("crm_sales_order_audits_order_created_idx").on(table.enterpriseId, table.orderId, table.createdAt, table.id),
    requestIdx: index("crm_sales_order_audits_request_idx").on(table.enterpriseId, table.requestId),
  }),
);

export type CrmSalesOrderRow = typeof crmSalesOrders.$inferSelect;
export type CrmSalesOrderItemRow = typeof crmSalesOrderItems.$inferSelect;
export type CrmSalesOrderRequestRow = typeof crmSalesOrderRequests.$inferSelect;
export type CrmSalesOrderAuditRow = typeof crmSalesOrderAudits.$inferSelect;

export const crmSalesOrderPayments = mysqlTable(
  "crm_sales_order_payments",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    orderId: int("orderId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    requestId: varchar("requestId", { length: 80 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    method: mysqlEnum("method", ["bank", "cash", "monthly"]).notNull(),
    amount: decimal("amount", { precision: 30, scale: 4 }).notNull(),
    paymentDate: date("paymentDate", { mode: "string" }).notNull(),
    note: varchar("note", { length: 255 }).notNull().default(""),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    actorRequestUnique: uniqueIndex("crm_sales_order_payments_actor_request_unique").on(table.enterpriseId, table.actorUserId, table.requestId),
    orderCreatedIdx: index("crm_sales_order_payments_order_created_idx").on(table.enterpriseId, table.orderId, table.id),
  }),
);

export const crmSalesOrderShipments = mysqlTable(
  "crm_sales_order_shipments",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    orderId: int("orderId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    requestId: varchar("requestId", { length: 80 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    deliveryMethod: mysqlEnum("deliveryMethod", ["express", "pickup"]).notNull(),
    expressCo: varchar("expressCo", { length: 64 }).notNull().default(""),
    expressNo: varchar("expressNo", { length: 64 }).notNull().default(""),
    note: varchar("note", { length: 255 }).notNull().default(""),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    actorRequestUnique: uniqueIndex("crm_sales_order_shipments_actor_request_unique").on(table.enterpriseId, table.actorUserId, table.requestId),
    orderCreatedIdx: index("crm_sales_order_shipments_order_created_idx").on(table.enterpriseId, table.orderId, table.id),
  }),
);

export const crmSalesOrderShipmentItems = mysqlTable(
  "crm_sales_order_shipment_items",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    shipmentId: int("shipmentId").notNull(),
    orderId: int("orderId").notNull(),
    orderItemId: int("orderItemId").notNull(),
    inventoryId: int("inventoryId").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    qty: int("qty").notNull(),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    shipmentIdx: index("crm_sales_order_shipment_items_shipment_idx").on(table.enterpriseId, table.shipmentId, table.id),
    orderItemIdx: index("crm_sales_order_shipment_items_order_item_idx").on(table.enterpriseId, table.orderItemId, table.id),
  }),
);
