import {
  datetime,
  decimal,
  index,
  int,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Current procurement quotes are intentionally separate from demand rows. A demand can
 * have exactly one current quote per procurement user; immutable version snapshots live
 * in the audit tables so replacing current line items never destroys history.
 */
export const crmCustomerDemandQuotes = mysqlTable(
  "crm_customer_demand_quotes",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    customerId: int("customerId").notNull(),
    demandId: int("demandId").notNull(),
    procurementUserId: int("procurementUserId").notNull(),
    supplierName: varchar("supplierName", { length: 128 }).notNull().default(""),
    note: varchar("note", { length: 1000 }).notNull().default(""),
    version: int("version").notNull().default(1),
    /** The demand business revision this quote was last confirmed against. */
    demandRevision: int("demandRevision").notNull().default(1),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
    updatedAt: datetime("updatedAt", { mode: "string" }).notNull(),
  },
  table => ({
    demandProcurementUnique: uniqueIndex("crm_customer_demand_quotes_demand_procurement_unique").on(
      table.enterpriseId,
      table.demandId,
      table.procurementUserId,
    ),
    demandUpdatedIdx: index("crm_customer_demand_quotes_demand_updated_idx").on(
      table.enterpriseId,
      table.demandId,
      table.updatedAt,
      table.id,
    ),
    procurementUpdatedIdx: index("crm_customer_demand_quotes_procurement_updated_idx").on(
      table.enterpriseId,
      table.procurementUserId,
      table.updatedAt,
      table.id,
    ),
  }),
);

export const crmCustomerDemandQuoteItems = mysqlTable(
  "crm_customer_demand_quote_items",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    demandId: int("demandId").notNull(),
    quoteId: int("quoteId").notNull(),
    demandItemId: int("demandItemId").notNull(),
    sortOrder: int("sortOrder").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull().default(""),
    brand: varchar("brand", { length: 64 }).notNull().default(""),
    pkg: varchar("pkg", { length: 64 }).notNull().default(""),
    qty: int("qty").notNull(),
    qtyUnit: varchar("qtyUnit", { length: 8 }).notNull(),
    unitPrice: decimal("unitPrice", { precision: 19, scale: 4 }).notNull(),
    leadTime: varchar("leadTime", { length: 80 }).notNull(),
    note: varchar("note", { length: 500 }).notNull().default(""),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    quoteDemandItemUnique: uniqueIndex("crm_customer_demand_quote_items_quote_item_unique").on(
      table.quoteId,
      table.demandItemId,
    ),
    demandQuoteIdx: index("crm_customer_demand_quote_items_demand_quote_idx").on(
      table.enterpriseId,
      table.demandId,
      table.quoteId,
      table.id,
    ),
  }),
);

/** Each audit row is a complete immutable header snapshot for one quote version. */
export const crmCustomerDemandQuoteAudits = mysqlTable(
  "crm_customer_demand_quote_audits",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    customerId: int("customerId").notNull(),
    demandId: int("demandId").notNull(),
    quoteId: int("quoteId").notNull(),
    procurementUserId: int("procurementUserId").notNull(),
    version: int("version").notNull(),
    demandRevision: int("demandRevision").notNull().default(1),
    action: varchar("action", { length: 32 }).notNull(),
    requestId: varchar("requestId", { length: 80 }).notNull(),
    supplierName: varchar("supplierName", { length: 128 }).notNull().default(""),
    note: varchar("note", { length: 1000 }).notNull().default(""),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    quoteVersionUnique: uniqueIndex("crm_customer_demand_quote_audits_quote_version_unique").on(
      table.enterpriseId,
      table.quoteId,
      table.version,
    ),
    demandCreatedIdx: index("crm_customer_demand_quote_audits_demand_created_idx").on(
      table.enterpriseId,
      table.demandId,
      table.createdAt,
      table.id,
    ),
  }),
);

export const crmCustomerDemandQuoteAuditItems = mysqlTable(
  "crm_customer_demand_quote_audit_items",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    auditId: int("auditId").notNull(),
    demandItemId: int("demandItemId").notNull(),
    sortOrder: int("sortOrder").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull().default(""),
    brand: varchar("brand", { length: 64 }).notNull().default(""),
    pkg: varchar("pkg", { length: 64 }).notNull().default(""),
    qty: int("qty").notNull(),
    qtyUnit: varchar("qtyUnit", { length: 8 }).notNull(),
    unitPrice: decimal("unitPrice", { precision: 19, scale: 4 }).notNull(),
    leadTime: varchar("leadTime", { length: 80 }).notNull(),
    note: varchar("note", { length: 500 }).notNull().default(""),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    auditDemandItemUnique: uniqueIndex("crm_customer_demand_quote_audit_items_audit_item_unique").on(
      table.auditId,
      table.demandItemId,
    ),
  }),
);

/** Request IDs are actor-scoped and preserve successful mutation results for safe retries. */
export const crmCustomerDemandQuoteRequests = mysqlTable(
  "crm_customer_demand_quote_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    requestId: varchar("requestId", { length: 80 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    quoteId: int("quoteId").notNull().default(0),
    resultVersion: int("resultVersion"),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    actorRequestUnique: uniqueIndex("crm_customer_demand_quote_requests_actor_request_unique").on(
      table.enterpriseId,
      table.actorUserId,
      table.requestId,
    ),
  }),
);

export type CustomerDemandQuoteRow = typeof crmCustomerDemandQuotes.$inferSelect;
export type CustomerDemandQuoteItemRow = typeof crmCustomerDemandQuoteItems.$inferSelect;
export type CustomerDemandQuoteAuditRow = typeof crmCustomerDemandQuoteAudits.$inferSelect;
export type CustomerDemandQuoteAuditItemRow = typeof crmCustomerDemandQuoteAuditItems.$inferSelect;
export type CustomerDemandQuoteRequestRow = typeof crmCustomerDemandQuoteRequests.$inferSelect;
