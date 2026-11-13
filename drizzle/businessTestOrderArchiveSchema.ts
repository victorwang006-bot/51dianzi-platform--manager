import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

/** Admin metadata only. No FK or writes to the original platform orders database. */
export const businessTestOrderArchives = mysqlTable(
  "business_test_order_archives",
  {
    id: int("id", { unsigned: true }).autoincrement().primaryKey(),
    merchantId: int("merchantId", { unsigned: true }).notNull(),
    sellerUserId: int("sellerUserId", { unsigned: true }).notNull(),
    orderId: int("orderId", { unsigned: true }).notNull(),
    orderNo: varchar("orderNo", { length: 128 }).notNull(),
    originalStatus: mysqlEnum("originalStatus", ["cancel"]).notNull(),
    // Safe defaults: maintenance must explicitly confirm test + archived.
    isTest: int("isTest", { unsigned: true }).default(0).notNull(),
    state: mysqlEnum("state", ["archived", "restored"]).default("restored").notNull(),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    batchId: varchar("batchId", { length: 64 }).notNull(),
    reason: text("reason").notNull(),
    confirmedByAdminId: int("confirmedByAdminId", { unsigned: true }),
    confirmationTaskId: varchar("confirmationTaskId", { length: 64 }),
    confirmedAt: timestamp("confirmedAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    archivedAt: timestamp("archivedAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
    restoredAt: timestamp("restoredAt", { fsp: 3 }),
    restoredBatchId: varchar("restoredBatchId", { length: 64 }),
    snapshotSha256: varchar("snapshotSha256", { length: 64 }).notNull(),
    // Private backup location: never selected by the sellerOrders loader.
    backupReference: varchar("backupReference", { length: 1024 }).notNull(),
  },
  table => ({
    orderScopeUnique: uniqueIndex("btoa_order_scope_unique").on(
      table.merchantId, table.sellerUserId, table.orderId,
    ),
    numberScopeUnique: uniqueIndex("btoa_number_scope_unique").on(
      table.merchantId, table.sellerUserId, table.orderNo,
    ),
    activeScopeIdx: index("btoa_active_scope_idx").on(
      table.merchantId, table.sellerUserId, table.state, table.isTest,
    ),
    batchIdx: index("btoa_batch_idx").on(table.batchId),
  }),
);

/** Append-only by maintenance policy/DB grants; the request service never writes it. */
export const businessTestOrderArchiveAudits = mysqlTable(
  "business_test_order_archive_audits",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    archiveId: int("archiveId", { unsigned: true }).notNull(),
    batchId: varchar("batchId", { length: 64 }).notNull(),
    action: mysqlEnum("action", ["archive", "restore"]).notNull(),
    actorAdminId: int("actorAdminId", { unsigned: true }),
    actorKind: mysqlEnum("actorKind", ["user_task_confirmation", "admin_session", "maintenance_cli"]).notNull(),
    confirmationTaskId: varchar("confirmationTaskId", { length: 64 }),
    beforeState: mysqlEnum("beforeState", ["archived", "restored"]),
    afterState: mysqlEnum("afterState", ["archived", "restored"]).notNull(),
    revision: int("revision", { unsigned: true }).notNull(),
    reason: text("reason").notNull(),
    occurredAt: timestamp("occurredAt", { fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
  },
  table => ({
    batchActionUnique: uniqueIndex("btoaa_batch_action_unique").on(
      table.batchId, table.archiveId, table.action,
    ),
    archiveIdx: index("btoaa_archive_idx").on(table.archiveId, table.id),
  }),
);

export type BusinessTestOrderArchiveRecord = typeof businessTestOrderArchives.$inferSelect;
export type BusinessTestOrderArchiveAuditRecord = typeof businessTestOrderArchiveAudits.$inferSelect;
