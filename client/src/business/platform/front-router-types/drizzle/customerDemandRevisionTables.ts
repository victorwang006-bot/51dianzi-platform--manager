import {
  datetime,
  index,
  int,
  longtext,
  mysqlTable,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Immutable business-revision snapshots. This is deliberately separate from the
 * optimistic `version` column: quote status transitions may advance that column
 * without changing the customer-visible demand revision.
 */
export const crmCustomerDemandRevisions = mysqlTable(
  "crm_customer_demand_revisions",
  {
    id: int("id").autoincrement().primaryKey(),
    enterpriseId: int("enterpriseId").notNull(),
    customerId: int("customerId").notNull(),
    demandId: int("demandId").notNull(),
    revision: int("revision").notNull(),
    actorUserId: int("actorUserId").notNull(),
    changeReason: varchar("changeReason", { length: 500 }).notNull().default(""),
    /** JSON text is stored as an immutable full snapshot. */
    snapshot: longtext("snapshot").notNull(),
    createdAt: datetime("createdAt", { mode: "string" }).notNull(),
  },
  table => ({
    demandRevisionUnique: uniqueIndex("crm_customer_demand_revisions_demand_revision_unique").on(
      table.enterpriseId,
      table.demandId,
      table.revision,
    ),
    customerDemandCreatedIdx: index("crm_customer_demand_revisions_customer_demand_created_idx").on(
      table.enterpriseId,
      table.customerId,
      table.demandId,
      table.createdAt,
      table.id,
    ),
  }),
);

export type CustomerDemandRevisionRow = typeof crmCustomerDemandRevisions.$inferSelect;
