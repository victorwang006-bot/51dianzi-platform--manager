import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const staffOrganizationTeams = mysqlTable(
  "admin_organization_teams",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    notes: text("notes"),
    status: mysqlEnum("status", ["active", "archived"])
      .default("active")
      .notNull(),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    createdByAdminUserId: int("createdByAdminUserId").notNull(),
    createdAt: timestamp("createdAt")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updatedAt")
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({ statusIdx: index("admin_org_teams_status_idx").on(table.status) })
);

/** Removal retains a null-team tombstone, so CAS revisions cannot reset (ABA). Multiple leaders are legal. */
export const staffOrganizationMembers = mysqlTable(
  "admin_organization_members",
  {
    adminUserId: int("adminUserId").primaryKey(),
    teamId: int("teamId"),
    role: mysqlEnum("role", ["member", "leader"]),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    updatedByAdminUserId: int("updatedByAdminUserId").notNull(),
    createdAt: timestamp("createdAt")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: timestamp("updatedAt")
      .default(sql`CURRENT_TIMESTAMP`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({ teamIdx: index("admin_org_members_team_idx").on(table.teamId) })
);

export const staffOrganizationAudits = mysqlTable(
  "admin_organization_audits",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: mysqlEnum("targetType", ["team", "member"]).notNull(),
    targetId: int("targetId").notNull(),
    actorAdminUserId: int("actorAdminUserId").notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    beforeData: json("beforeData").$type<Record<string, unknown> | null>(),
    afterData: json("afterData").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  table => ({
    requestUnique: uniqueIndex("admin_org_audits_request_unique").on(
      table.requestId
    ),
    targetIdx: index("admin_org_audits_target_idx").on(
      table.targetType,
      table.targetId,
      table.id
    ),
  })
);
