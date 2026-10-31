import {
  date,
  datetime,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Internal, tenant-owned material demands. These definitions intentionally live in
 * a separate module until the application schema barrel exports them.
 * DATETIME values are written by the service as Beijing wall-clock values, in the
 * same convention as the existing CRM tables.
 */
export const crmCustomerDemands = mysqlTable(
  "crm_customer_demands",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    customerId: int("customerId").notNull(),
    demandNo: varchar("demandNo", { length: 32 }).notNull(),
    projectName: varchar("projectName", { length: 128 }).notNull().default(""),
    priority: mysqlEnum("priority", ["normal", "urgent"]).notNull().default("normal"),
    status: mysqlEnum("status", ["draft", "submitted", "processing"]).notNull().default("draft"),
    note: varchar("note", { length: 2000 }).notNull().default(""),
    replyDueAt: datetime("replyDueAt", { mode: "string" }),
    submittedAt: datetime("submittedAt", { mode: "string" }),
    createdByUserId: int("createdByUserId").notNull(),
    updatedByUserId: int("updatedByUserId").notNull(),
    procurementUserId: int("procurementUserId"),
    claimedAt: datetime("claimedAt", { mode: "string" }),
    version: int("version").notNull().default(1),
    /** Customer-facing business revision; independent from optimistic `version`. */
    revision: int("revision").notNull().default(1),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
    updatedAt: datetime("updatedAt", { mode: "string" }).notNull(),
  },
  table => ({
    enterpriseDemandNoUnique: uniqueIndex("crm_customer_demands_enterprise_no_unique").on(
      table.enterpriseId,
      table.demandNo,
    ),
    customerUpdatedIdx: index("crm_customer_demands_customer_updated_idx").on(
      table.enterpriseId,
      table.customerId,
      table.updatedAt,
      table.id,
    ),
    procurementQueueIdx: index("crm_customer_demands_procurement_queue_idx").on(
      table.enterpriseId,
      table.status,
      table.procurementUserId,
      table.updatedAt,
      table.id,
    ),
  }),
);

export const crmCustomerDemandItems = mysqlTable(
  "crm_customer_demand_items",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    demandId: int("demandId").notNull(),
    sortOrder: int("sortOrder").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull().default(""),
    brand: varchar("brand", { length: 64 }).notNull().default(""),
    pkg: varchar("pkg", { length: 64 }).notNull().default(""),
    qty: int("qty"),
    qtyUnit: mysqlEnum("qtyUnit", ["片", "只", "颗", "套", "盘", "个"]).notNull().default("片"),
    deliveryRequirement: varchar("deliveryRequirement", { length: 80 }).notNull().default(""),
    note: varchar("note", { length: 500 }).notNull().default(""),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
    updatedAt: datetime("updatedAt", { mode: "string" }).notNull(),
  },
  table => ({
    demandSortUnique: uniqueIndex("crm_customer_demand_items_demand_sort_unique").on(table.demandId, table.sortOrder),
    tenantDemandIdx: index("crm_customer_demand_items_tenant_demand_idx").on(table.enterpriseId, table.demandId, table.id),
    tenantPartNumberIdx: index("crm_customer_demand_items_tenant_part_number_idx").on(table.enterpriseId, table.partNumber),
  }),
);

export const crmCustomerDemandRequests = mysqlTable(
  "crm_customer_demand_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    requestId: varchar("requestId", { length: 80 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    demandId: int("demandId").notNull().default(0),
    resultStatus: mysqlEnum("resultStatus", ["draft", "submitted", "processing"]),
    resultVersion: int("resultVersion"),
    resultDemandRevision: int("resultDemandRevision"),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    actorRequestUnique: uniqueIndex("crm_customer_demand_requests_actor_request_unique").on(
      table.enterpriseId,
      table.actorUserId,
      table.requestId,
    ),
  }),
);

export const crmCustomerDemandSequences = mysqlTable(
  "crm_customer_demand_sequences",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    demandDay: date("demandDay", { mode: "string" }).notNull(),
    nextSequence: int("nextSequence").notNull().default(1),
    updatedAt: datetime("updatedAt", { mode: "string" }).notNull(),
  },
  table => ({
    enterpriseDayUnique: uniqueIndex("crm_customer_demand_sequences_enterprise_day_unique").on(
      table.enterpriseId,
      table.demandDay,
    ),
  }),
);

export const crmCustomerDemandAudits = mysqlTable(
  "crm_customer_demand_audits",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    customerId: int("customerId").notNull(),
    demandId: int("demandId").notNull(),
    actorUserId: int("actorUserId").notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    note: varchar("note", { length: 500 }).notNull().default(""),
    requestId: varchar("requestId", { length: 80 }),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    demandCreatedIdx: index("crm_customer_demand_audits_demand_created_idx").on(
      table.enterpriseId,
      table.demandId,
      table.createdAt,
      table.id,
    ),
    requestIdx: index("crm_customer_demand_audits_request_idx").on(table.enterpriseId, table.requestId),
  }),
);

export type CustomerDemandRow = typeof crmCustomerDemands.$inferSelect;
export type CustomerDemandItemRow = typeof crmCustomerDemandItems.$inferSelect;
export type CustomerDemandRequestRow = typeof crmCustomerDemandRequests.$inferSelect;
export type CustomerDemandSequenceRow = typeof crmCustomerDemandSequences.$inferSelect;
export type CustomerDemandAuditRow = typeof crmCustomerDemandAudits.$inferSelect;
