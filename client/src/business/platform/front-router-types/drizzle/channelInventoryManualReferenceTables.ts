import { sql } from "drizzle-orm";
import { bigint, mysqlTable, primaryKey, timestamp, varchar } from "drizzle-orm/mysql-core";

/** Install the accompanying manual SQL before deploying readers/writers.
 * Independent per-inventory override; not mall evidence, cache, stock price or source.
 */
export const channelInventoryManualReferences = mysqlTable("channel_inventory_manual_references", {
  enterpriseId: bigint("enterpriseId", { mode: "number", unsigned: true }).notNull(),
  dataOwnerUserId: bigint("dataOwnerUserId", { mode: "number", unsigned: true }).notNull(),
  materialId: bigint("materialId", { mode: "number", unsigned: true }).notNull(),
  manualReferenceLcsc: varchar("manualReferenceLcsc", { length: 32 }),
  manualReferenceIckey: varchar("manualReferenceIckey", { length: 32 }),
  updatedByUserId: bigint("updatedByUserId", { mode: "number", unsigned: true }).notNull(),
  updatedByAdminAccountId: bigint("updatedByAdminAccountId", { mode: "number", unsigned: true }),
  updatedAt: timestamp("updatedAt", { mode: "string", fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, table => [primaryKey({ columns: [table.enterpriseId, table.dataOwnerUserId, table.materialId] })]);

export type ChannelInventoryManualReferenceRow = typeof channelInventoryManualReferences.$inferSelect;
export type InsertChannelInventoryManualReferenceRow = typeof channelInventoryManualReferences.$inferInsert;
