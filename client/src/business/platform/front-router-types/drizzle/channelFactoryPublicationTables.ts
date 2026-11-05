import { sql } from "drizzle-orm";
import { bigint, char, int, json, mysqlTable, datetime, varchar, primaryKey, index, uniqueIndex, check } from "drizzle-orm/mysql-core";
const id = (name: string) => bigint(name, { mode: "number", unsigned: true });
export const channelMaterialPublications = mysqlTable("channel_material_publications", {
  enterpriseId: id("enterprise_id").notNull(), materialId: id("material_id").notNull(), dataOwnerUserId: id("data_owner_user_id").notNull(),
  materialRevision: int("material_revision", { unsigned: true }).notNull(), channelId: id("channel_id").notNull(),
  channelRevision: int("channel_revision", { unsigned: true }).notNull(), ownerUserId: id("owner_user_id").notNull(),
  assignmentId: id("assignment_id").notNull(), assignmentRevision: int("assignment_revision", { unsigned: true }).notNull(),
  teamId: id("team_id").notNull(), ownerMembershipId: id("owner_membership_id").notNull(),
  publicId: char("public_id", { length: 36 }).notNull(), status: varchar("status", { length: 16 }).default("unpublished").notNull(),
  snapshot: json("snapshot").notNull(), publishedAt: datetime("published_at", { mode: "date", fsp: 3 }).notNull(),
}, t => [primaryKey({ columns: [t.enterpriseId, t.materialId] }), uniqueIndex("channel_publication_public_id_unique").on(t.publicId),
  index("channel_publication_recent_idx").on(t.status, t.publishedAt, t.publicId),
  check("channel_publication_status_valid", sql`${t.status} IN ('unpublished', 'published')`),
  check("channel_publication_revision_valid", sql`${t.materialRevision} >= 1 AND ${t.channelRevision} >= 1 AND ${t.assignmentRevision} >= 1`)]);
export const channelMaterialPublicationRequests = mysqlTable("channel_material_publication_requests", {
  enterpriseId: id("enterprise_id").notNull(), dataOwnerUserId: id("data_owner_user_id").notNull(), actorUserId: id("actor_user_id").notNull(),
  actorAdminAccountId: id("actor_admin_account_id").notNull(), materialId: id("material_id").notNull(), materialRevision: int("material_revision", { unsigned: true }).notNull(),
  requestId: char("request_id", { length: 36 }).notNull(), payloadHash: char("payload_hash", { length: 64 }).notNull(), publicId: char("public_id", { length: 36 }).notNull(),
  authorizationVersion: varchar("authorization_version", { length: 160 }).notNull(), bindingVersion: id("binding_version").notNull(),
  createdAt: datetime("created_at", { mode: "date", fsp: 3 }).default(sql`CURRENT_TIMESTAMP(3)`).notNull(),
}, t => [primaryKey({ columns: [t.enterpriseId, t.dataOwnerUserId, t.actorUserId, t.requestId] }),
  index("channel_publication_request_material_idx").on(t.enterpriseId, t.materialId, t.createdAt),
  check("channel_publication_request_revision_valid", sql`${t.materialRevision} >= 1 AND ${t.bindingVersion} >= 1`)]);
