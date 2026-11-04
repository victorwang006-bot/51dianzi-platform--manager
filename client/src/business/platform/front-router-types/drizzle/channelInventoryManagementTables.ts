import { sql } from "drizzle-orm";
import { bigint, char, int, json, mysqlTable, datetime, varchar, boolean, primaryKey, index, uniqueIndex } from "drizzle-orm/mysql-core";
const identifier = (name: string) => bigint(name, { mode: "number", unsigned: true });
const created = () => datetime("created_at", { mode: "date", fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull();
export const channelInventoryMaterialManagement = mysqlTable("channel_inventory_material_management", {
  enterpriseId: identifier("enterprise_id").notNull(), materialId: identifier("material_id").notNull(),
  deletedAt: datetime("deleted_at", { mode: "date", fsp: 3 }), deletedByUserId: identifier("deleted_by_user_id"), deleteRequestId: char("delete_request_id", { length: 36 }),
  createdAt: created(), updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, table => [primaryKey({ columns: [table.enterpriseId, table.materialId] }), index("channel_material_trash_idx").on(table.enterpriseId, table.deletedAt, table.materialId)]);
export const channelInventoryUploadBatches = mysqlTable("channel_inventory_upload_batches", {
  id: identifier("id").autoincrement().primaryKey(), enterpriseId: identifier("enterprise_id").notNull(), dataOwnerUserId: identifier("data_owner_user_id").notNull(),
  channelId: identifier("channel_id").notNull(), uploadedByUserId: identifier("uploaded_by_user_id").notNull(), uploadedByAdminAccountId: identifier("uploaded_by_admin_account_id"),
  teamId: identifier("team_id").notNull(), ownerMembershipId: identifier("owner_membership_id").notNull(), batchCode: char("batch_code", { length: 36 }).notNull(),
  name: varchar("name", { length: 128 }), fileName: varchar("file_name", { length: 255 }).notNull(), totalRows: int("total_rows", { unsigned: true }).notNull(),
  revision: int("revision", { unsigned: true }).default(1).notNull(), archived: boolean("archived").default(false).notNull(), closed: boolean("closed").default(false).notNull(),
  createdAt: created(), updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, table => [uniqueIndex("channel_upload_batch_code_unique").on(table.enterpriseId, table.batchCode), index("channel_upload_batch_owner_idx").on(table.enterpriseId, table.dataOwnerUserId, table.uploadedByUserId, table.archived, table.id)]);
export const channelInventoryUploadBatchMaterials = mysqlTable("channel_inventory_upload_batch_materials", {
  enterpriseId: identifier("enterprise_id").notNull(), batchId: identifier("batch_id").notNull(), materialId: identifier("material_id").notNull(),
  initialRevision: int("initial_revision", { unsigned: true }).notNull(), initialChannelId: identifier("initial_channel_id").notNull(), initialOwnerUserId: identifier("initial_owner_user_id").notNull(),
  initialAssignmentId: identifier("initial_assignment_id").notNull(), initialAssignmentRevision: int("initial_assignment_revision", { unsigned: true }).notNull(),
  initialTeamId: identifier("initial_team_id").notNull(), initialMembershipId: identifier("initial_membership_id").notNull(), initialShareRevision: int("initial_share_revision", { unsigned: true }).notNull(), createdAt: created(),
}, table => [primaryKey({ columns: [table.enterpriseId, table.materialId] }), index("channel_batch_material_idx").on(table.enterpriseId, table.batchId, table.materialId)]);
export const channelInventoryManagementRequests = mysqlTable("channel_inventory_management_requests", {
  enterpriseId: identifier("enterprise_id").notNull(), dataOwnerUserId: identifier("data_owner_user_id").notNull(), actorUserId: identifier("actor_user_id").notNull(),
  requestId: char("request_id", { length: 36 }).notNull(), action: varchar("action", { length: 48 }).notNull(), payloadHash: char("payload_hash", { length: 64 }).notNull(), resultData: json("result_data").notNull(), createdAt: created(),
}, table => [primaryKey({ columns: [table.enterpriseId, table.dataOwnerUserId, table.actorUserId, table.requestId] })]);
