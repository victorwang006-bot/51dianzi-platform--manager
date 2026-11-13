import {
  bigint,
  boolean,
  check,
  customType,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * 与主后台 schema 相同的北京时间 DATETIME/TIMESTAMP 映射。
 * 官方渠道表和既有后台表共用一个 MySQL 库，不能让 Drizzle 默认 UTC 映射
 * 导致同一业务审计时间相差八小时。
 */
const beijingTime = customType<{ data: Date; driverData: string }>({
  dataType: () => "timestamp",
  fromDriver(value) {
    const raw = value as unknown;
    if (raw instanceof Date) return raw;
    return new Date(String(raw).replace(" ", "T") + "+08:00");
  },
  toDriver(value) {
    if (!(value instanceof Date)) return value;
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(value)
      .replace("T", " ");
  },
});

const timestamp = beijingTime;
const DEFAULT_NOW = sql`CURRENT_TIMESTAMP`;

/**
 * 官方后台团队。此表不关联 enterprise_teams，也不复用商户/ERP 团队。
 * name 故意不设全局唯一：同名不是安全边界，稳定主键和 revision 才是。
 */
export const officialChannelTeams = mysqlTable(
  "official_channel_teams",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    status: mysqlEnum("status", ["active", "archived"])
      .default("active")
      .notNull(),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    createdByAdminUserId: int("createdByAdminUserId").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt")
      .default(DEFAULT_NOW)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    statusUpdatedIdx: index("official_channel_teams_status_updated_idx").on(
      table.status,
      table.updatedAt
    ),
  })
);
export type OfficialChannelTeam = typeof officialChannelTeams.$inferSelect;
export type InsertOfficialChannelTeam =
  typeof officialChannelTeams.$inferInsert;

/**
 * 每个真实后台账号至多属于一个官方团队。leaderTeamId 是 MySQL 8 存储生成列：
 * 对 member 为 NULL，对 leader 为 teamId；UNIQUE 允许多个 NULL，从而在数据库层
 * 强制每队至多一位组长，不能只依赖应用层预检。
 */
export const officialChannelTeamMembers = mysqlTable(
  "official_channel_team_members",
  {
    id: int("id").autoincrement().primaryKey(),
    adminUserId: int("adminUserId").notNull(),
    teamId: int("teamId").notNull(),
    role: mysqlEnum("role", ["member", "leader"]).default("member").notNull(),
    leaderTeamId: int("leaderTeamId").generatedAlwaysAs(
      sql`CASE WHEN ${sql.identifier("role")} = 'leader' THEN ${sql.identifier("teamId")} ELSE NULL END`,
      { mode: "stored" }
    ),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    updatedByAdminUserId: int("updatedByAdminUserId").notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt")
      .default(DEFAULT_NOW)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    adminUserUnique: uniqueIndex(
      "official_channel_team_members_admin_user_unique"
    ).on(table.adminUserId),
    teamIdx: index("official_channel_team_members_team_idx").on(table.teamId),
    leaderTeamUnique: uniqueIndex(
      "official_channel_team_members_leader_team_unique"
    ).on(table.leaderTeamId),
  })
);
export type OfficialChannelTeamMember =
  typeof officialChannelTeamMembers.$inferSelect;
export type InsertOfficialChannelTeamMember =
  typeof officialChannelTeamMembers.$inferInsert;

/** 私有官方渠道/工厂来源；历史无法确认团队归属时 teamId 可以保持 NULL。 */
export const officialChannelSources = mysqlTable(
  "official_channel_sources",
  {
    id: int("id").autoincrement().primaryKey(),
    teamId: int("teamId"),
    name: varchar("name", { length: 128 }).notNull(),
    type: mysqlEnum("type", ["factory", "agent", "trade", "other"]).notNull(),
    contactName: varchar("contactName", { length: 128 }),
    phone: varchar("phone", { length: 64 }),
    wechat: varchar("wechat", { length: 128 }),
    qq: varchar("qq", { length: 64 }),
    notes: text("notes"),
    active: boolean("active").default(true).notNull(),
    publicationApproved: boolean("publicationApproved")
      .default(false)
      .notNull(),
    everPublished: boolean("everPublished").default(false).notNull(),
    createdByAdminUserId: int("createdByAdminUserId").notNull(),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    legacySourceId: varchar("legacySourceId", { length: 64 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt")
      .default(DEFAULT_NOW)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    teamActiveIdx: index("official_channel_sources_team_active_idx").on(
      table.teamId,
      table.active
    ),
    legacySourceUnique: uniqueIndex(
      "official_channel_sources_legacy_source_unique"
    ).on(table.legacySourceId),
  })
);
export type OfficialChannelSource = typeof officialChannelSources.$inferSelect;
export type InsertOfficialChannelSource =
  typeof officialChannelSources.$inferInsert;

/**
 * 官方渠道库存。teamId 是创建时的团队快照，迁移的未知归属可为 NULL；
 * 调整成员团队绝不能更新此列。createRequestId 仅用于创建幂等，和审计 requestId 独立。
 */
export const officialChannelStocks = mysqlTable(
  "official_channel_stocks",
  {
    id: int("id").autoincrement().primaryKey(),
    sourceId: int("sourceId").notNull(),
    teamId: int("teamId"),
    createdByAdminUserId: int("createdByAdminUserId").notNull(),
    ownerAdminUserId: int("ownerAdminUserId").notNull(),
    partNumber: varchar("partNumber", { length: 256 }).notNull(),
    brand: varchar("brand", { length: 128 }),
    qty: int("qty", { unsigned: true }),
    dateCode: varchar("dateCode", { length: 64 }),
    /** Preserve source precision rather than coercing a commercial price into JS number/decimal. */
    price: varchar("price", { length: 64 }),
    currency: varchar("currency", { length: 8 }).default("CNY").notNull(),
    taxIncluded: boolean("taxIncluded"),
    leadTime: varchar("leadTime", { length: 128 }),
    note: text("note"),
    status: mysqlEnum("status", ["draft", "published", "offshelf"])
      .default("draft")
      .notNull(),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    createRequestId: varchar("createRequestId", { length: 64 }).notNull(),
    createPayloadHash: varchar("createPayloadHash", { length: 64 }).notNull(),
    publishedAt: timestamp("publishedAt"),
    legacyMaterialId: varchar("legacyMaterialId", { length: 64 }),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt")
      .default(DEFAULT_NOW)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    sourceIdx: index("official_channel_stocks_source_idx").on(table.sourceId),
    teamStatusIdx: index("official_channel_stocks_team_status_idx").on(
      table.teamId,
      table.status,
      table.updatedAt
    ),
    teamOwnerIdx: index("official_channel_stocks_team_owner_idx").on(
      table.teamId,
      table.ownerAdminUserId,
      table.updatedAt
    ),
    createRequestUnique: uniqueIndex(
      "official_channel_stocks_create_request_unique"
    ).on(table.createRequestId),
    legacyMaterialUnique: uniqueIndex(
      "official_channel_stocks_legacy_material_unique"
    ).on(table.legacyMaterialId),
    qtyNonnegative: check(
      "official_channel_stocks_qty_nonnegative",
      sql`${table.qty} IS NULL OR ${table.qty} >= 0`
    ),
  })
);
export type OfficialChannelStock = typeof officialChannelStocks.$inferSelect;
export type InsertOfficialChannelStock =
  typeof officialChannelStocks.$inferInsert;

/** Explicit trusted seller mapping and future-inquiry routing only; never mutates historical inquiries. */
export const officialChannelStockReception = mysqlTable(
  "official_channel_stock_reception",
  {
    stockId: int("stockId").primaryKey(),
    merchantId: int("merchantId").notNull(),
    sellerEnterpriseId: int("sellerEnterpriseId").notNull(),
    routingMode: mysqlEnum("routingMode", ["owner", "explicit"])
      .default("owner")
      .notNull(),
    recipientAdminUserId: int("recipientAdminUserId"),
    responsibilityVersion: int("responsibilityVersion", { unsigned: true })
      .default(1)
      .notNull(),
    updatedByAdminUserId: int("updatedByAdminUserId").notNull(),
    updatedAt: timestamp("updatedAt").default(DEFAULT_NOW).notNull(),
  }
);

/** V1 内部备注只追加，requestId 唯一以支持安全重试。 */
export const officialChannelStockNotes = mysqlTable(
  "official_channel_stock_notes",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    stockId: int("stockId").notNull(),
    authorAdminUserId: int("authorAdminUserId").notNull(),
    body: text("body").notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    stockCreatedIdx: index("official_channel_stock_notes_stock_created_idx").on(
      table.stockId,
      table.createdAt
    ),
    requestIdUnique: uniqueIndex(
      "official_channel_stock_notes_request_unique"
    ).on(table.requestId),
  })
);
export type OfficialChannelStockNote =
  typeof officialChannelStockNotes.$inferSelect;
export type InsertOfficialChannelStockNote =
  typeof officialChannelStockNotes.$inferInsert;

/** 独立公共投影；绝不与普通 inventoryId 或商户供应商身份混用。 */
export const officialChannelPublications = mysqlTable(
  "official_channel_publications",
  {
    id: int("id").autoincrement().primaryKey(),
    stockId: int("stockId").notNull(),
    publicId: varchar("publicId", { length: 64 }).notNull(),
    snapshot: json("snapshot").$type<Record<string, unknown>>().notNull(),
    /** Private server-to-server authority evidence, NEVER spread into a public DTO. */
    reception: json("reception").$type<Record<string, unknown> | null>(),
    batchId: varchar("batchId", { length: 64 }).notNull(),
    revision: int("revision", { unsigned: true }).default(1).notNull(),
    publishedAt: timestamp("publishedAt").default(DEFAULT_NOW).notNull(),
    updatedAt: timestamp("updatedAt")
      .default(DEFAULT_NOW)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  table => ({
    stockUnique: uniqueIndex("official_channel_publications_stock_unique").on(
      table.stockId
    ),
    publicIdUnique: uniqueIndex(
      "official_channel_publications_public_id_unique"
    ).on(table.publicId),
    publishedIdx: index("official_channel_publications_published_idx").on(
      table.publishedAt
    ),
  })
);
export type OfficialChannelPublication =
  typeof officialChannelPublications.$inferSelect;
export type InsertOfficialChannelPublication =
  typeof officialChannelPublications.$inferInsert;

/**
 * 官方域的不可变审计账本。requestId 在整个官方域唯一，payloadHash 绑定请求内容，
 * beforeData/afterData 记录 revision、成员与显式交接理由（如未来 transferOwner）等事实。
 */
export const officialChannelAudits = mysqlTable(
  "official_channel_audits",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    action: varchar("action", { length: 64 }).notNull(),
    targetId: varchar("targetId", { length: 64 }).notNull(),
    actorAdminUserId: int("actorAdminUserId").notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    beforeData: json("beforeData").$type<Record<string, unknown> | null>(),
    afterData: json("afterData").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("createdAt").default(DEFAULT_NOW).notNull(),
  },
  table => ({
    requestIdUnique: uniqueIndex("official_channel_audits_request_unique").on(
      table.requestId
    ),
    targetCreatedIdx: index("official_channel_audits_target_created_idx").on(
      table.targetId,
      table.createdAt
    ),
    actorCreatedIdx: index("official_channel_audits_actor_created_idx").on(
      table.actorAdminUserId,
      table.createdAt
    ),
  })
);
export type OfficialChannelAudit = typeof officialChannelAudits.$inferSelect;
export type InsertOfficialChannelAudit =
  typeof officialChannelAudits.$inferInsert;
