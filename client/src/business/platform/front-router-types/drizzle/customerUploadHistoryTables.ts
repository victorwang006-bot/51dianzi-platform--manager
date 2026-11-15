import { sql } from "drizzle-orm";
import { bigint, char, int, json, mysqlTable, datetime, varchar, primaryKey, index, uniqueIndex } from "drizzle-orm/mysql-core";
const id = (name: string) => bigint(name, { mode: "number", unsigned: true });
const created = () => datetime("created_at", { mode: "date", fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull();
const tuple = () => ({ enterpriseId: id("enterprise_id").notNull(), dataOwnerUserId: id("data_owner_user_id").notNull(), customerId: id("customer_id").notNull(), historyId: char("history_id", { length: 36 }).notNull() });
export const customerUploadHistories = mysqlTable("customer_upload_histories", {
  ...tuple(), mode: varchar("mode", { length: 16 }).notNull(), state: varchar("state", { length: 32 }).notNull(), revision: int("revision", { unsigned: true }).default(1).notNull(),
  uploadedByUserId: id("uploaded_by_user_id").notNull(), uploadedByAdminAccountId: id("uploaded_by_admin_account_id"), originalFileId: char("original_file_id", { length: 36 }).notNull(),
  latestVersionId: char("latest_version_id", { length: 36 }), latestVersionNo: int("latest_version_no", { unsigned: true }).default(0).notNull(),
  lastReason: varchar("last_reason", { length: 1000 }), createdAt: created(), updatedAt: datetime("updated_at", { mode: "date", fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, t => [primaryKey({ columns: [t.historyId] }), index("customer_history_scope_cursor").on(t.enterpriseId, t.dataOwnerUserId, t.uploadedByUserId, t.createdAt, t.historyId), index("customer_history_customer_state").on(t.enterpriseId, t.dataOwnerUserId, t.customerId, t.state, t.createdAt)]);
export const customerUploadFiles = mysqlTable("customer_upload_files", {
  ...tuple(), fileId: char("file_id", { length: 36 }).primaryKey(), kind: varchar("kind", { length: 16 }).notNull(), locator: varchar("locator", { length: 128 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(), mimeType: varchar("mime_type", { length: 128 }).notNull(), byteSize: int("byte_size", { unsigned: true }).notNull(), sha256: char("sha256", { length: 64 }).notNull(), originalManifest: json("original_manifest"), createdAt: created(),
}, t => [index("customer_file_exact_tuple").on(t.enterpriseId, t.dataOwnerUserId, t.customerId, t.historyId, t.fileId)]);
export const customerUploadVersions = mysqlTable("customer_upload_versions", {
  ...tuple(), versionId: char("version_id", { length: 36 }).primaryKey(), versionNo: int("version_no", { unsigned: true }).notNull(), parentVersionId: char("parent_version_id", { length: 36 }),
  normalizedFileId: char("normalized_file_id", { length: 36 }).notNull(), issuesFileId: char("issues_file_id", { length: 36 }), rowsData: json("rows_data").notNull(), issuesData: json("issues_data").notNull(), uploadedByUserId: id("uploaded_by_user_id").notNull(), uploadedByAdminAccountId: id("uploaded_by_admin_account_id"), createdAt: created(),
}, t => [uniqueIndex("customer_version_append_unique").on(t.historyId, t.versionNo), index("customer_version_exact_tuple").on(t.enterpriseId, t.dataOwnerUserId, t.customerId, t.historyId, t.versionId)]);
export const customerUploadConfirmations = mysqlTable("customer_upload_confirmations", {
  ...tuple(), confirmationId: char("confirmation_id", { length: 36 }).primaryKey(), actorUserId: id("actor_user_id").notNull(), batchRequestId: char("batch_request_id", { length: 36 }).notNull(),
  frozenData: json("frozen_data").notNull(), receiptsData: json("receipts_data").notNull(), remainingMaterialCount: int("remaining_material_count", { unsigned: true }), createdAt: created(),
}, t => [uniqueIndex("customer_confirmation_one_history").on(t.historyId), uniqueIndex("customer_confirmation_batch_unique").on(t.enterpriseId, t.actorUserId, t.batchRequestId)]);
/** row_claim/batch_claim entries use the SAME unique request namespace to fence cross-history UUID reuse. */
export const customerUploadRequests = mysqlTable("customer_upload_requests", {
  enterpriseId: id("enterprise_id").notNull(), dataOwnerUserId: id("data_owner_user_id").notNull(), actorUserId: id("actor_user_id").notNull(), requestId: char("request_id", { length: 36 }).notNull(),
  operation: varchar("operation", { length: 64 }).notNull(), historyId: char("history_id", { length: 36 }).notNull(), payloadHash: char("payload_hash", { length: 64 }).notNull(), resultData: json("result_data").notNull(), createdAt: created(),
}, t => [primaryKey({ columns: [t.enterpriseId, t.actorUserId, t.requestId] }), index("customer_request_history_audit").on(t.enterpriseId, t.dataOwnerUserId, t.historyId, t.createdAt)]);
