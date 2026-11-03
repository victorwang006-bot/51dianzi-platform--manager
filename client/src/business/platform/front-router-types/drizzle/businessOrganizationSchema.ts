import { bigint, boolean, char, datetime, index, int, json, mysqlEnum, mysqlTable, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { BUSINESS_MODULES } from "../../shared/businessOrganization";

/** These are new sidecars only. Existing enterprise/team/record assignment tables are authoritative. */
export const enterpriseMemberModuleAccess = mysqlTable("enterprise_member_module_access", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  enterpriseId: int("enterpriseId").notNull(), userId: int("userId").notNull(),
  module: mysqlEnum("module", BUSINESS_MODULES).notNull(),
  readAllowed: boolean("readAllowed").notNull(), writeAllowed: boolean("writeAllowed").notNull(),
  dataScope: mysqlEnum("dataScope", ["self", "team", "enterprise"]).notNull(),
  revision: int("revision", { unsigned: true }).notNull().default(1),
  templateId: varchar("templateId", { length: 32 }), templateVersion: int("templateVersion", { unsigned: true }),
  updatedByUserId: int("updatedByUserId").notNull(),
  createdAt: datetime("createdAt").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime("updatedAt").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => ({ memberModuleUnique: uniqueIndex("business_member_module_unique").on(table.enterpriseId, table.userId, table.module) }));

/** Append-only successful request receipts; replay requires the identical actor, action and canonical payload. */
export const enterpriseBusinessOrganizationRequests = mysqlTable("enterprise_business_organization_requests", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  enterpriseId: int("enterpriseId").notNull(), actorUserId: int("actorUserId").notNull(),
  requestId: varchar("requestId", { length: 64 }).notNull(), payloadHash: char("payloadHash", { length: 64 }).notNull(),
  action: varchar("action", { length: 48 }).notNull(), result: json("result").notNull(),
  createdAt: datetime("createdAt").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => ({ requestUnique: uniqueIndex("business_org_request_unique").on(table.enterpriseId, table.actorUserId, table.requestId) }));

/** Append-only: one event per changed module; team operations have module NULL. Never rewritten on retry. */
export const enterpriseBusinessOrganizationAudit = mysqlTable("enterprise_business_organization_audit", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  enterpriseId: int("enterpriseId").notNull(), actorUserId: int("actorUserId").notNull(),
  targetUserId: int("targetUserId"), teamId: bigint("teamId", { mode: "number", unsigned: true }),
  module: mysqlEnum("module", BUSINESS_MODULES), action: varchar("action", { length: 48 }).notNull(),
  requestId: varchar("requestId", { length: 64 }).notNull(), payloadHash: char("payloadHash", { length: 64 }).notNull(),
  templateId: varchar("templateId", { length: 32 }), templateVersion: int("templateVersion", { unsigned: true }),
  beforeData: json("beforeData"), afterData: json("afterData"),
  createdAt: datetime("createdAt").notNull().default(sql`CURRENT_TIMESTAMP`),
}, table => ({ enterpriseCreated: index("business_org_audit_enterprise_created").on(table.enterpriseId, table.createdAt, table.id), request: index("business_org_audit_request").on(table.enterpriseId, table.actorUserId, table.requestId) }));
