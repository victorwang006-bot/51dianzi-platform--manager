import { sql } from "drizzle-orm";
import {
  boolean,
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
import type {
  OfficialMallTier,
  OfficialMallPublicMaterial,
} from "../shared/officialMall";

// Match the native backend's Asia/Shanghai MySQL timestamp mapping.
const localTimestamp = customType<{ data: Date; driverData: string }>({
  dataType: () => "timestamp",
  fromDriver(value) {
    const raw: unknown = value;
    return raw instanceof Date
      ? raw
      : new Date(String(raw).replace(" ", "T") + "+08:00");
  },
  toDriver(value) {
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
const now = sql`CURRENT_TIMESTAMP`;

/** Empty, independent self-operated records. No source inventory or merchant IDs. */
export const officialMallMaterials = mysqlTable(
  "official_mall_materials",
  {
    id: int("id").autoincrement().primaryKey(),
    publicId: varchar("publicId", { length: 40 }).notNull(),
    teamId: int("teamId"),
    ownerAdminUserId: int("ownerAdminUserId").notNull(),
    createdByAdminUserId: int("createdByAdminUserId").notNull(),
    updatedByAdminUserId: int("updatedByAdminUserId").notNull(),
    publishedByAdminUserId: int("publishedByAdminUserId"),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    brand: varchar("brand", { length: 128 }).notNull(),
    pkg: varchar("pkg", { length: 128 }).default("").notNull(),
    dateCode: varchar("dateCode", { length: 64 }).default("").notNull(),
    qtyOnSale: int("qtyOnSale"),
    qtyStock: int("qtyStock"),
    qtyOrder: int("qtyOrder"),
    leadTime: varchar("leadTime", { length: 128 }).default("").notNull(),
    priceEx: varchar("priceEx", { length: 32 }),
    taxIncluded: boolean("taxIncluded"),
    moq: int("moq"),
    spq: int("spq"),
    ladderPrices: json("ladderPrices").$type<OfficialMallTier[]>().notNull(),
    note: text("note").notNull(),
    status: mysqlEnum("status", ["draft", "published", "offshelf"])
      .default("draft")
      .notNull(),
    revision: int("revision").default(1).notNull(),
    createdAt: localTimestamp("createdAt").default(now).notNull(),
    updatedAt: localTimestamp("updatedAt").default(now).notNull(),
    publishedAt: localTimestamp("publishedAt"),
  },
  table => ({
    publicIdUnique: uniqueIndex("om_material_public_id_uq").on(table.publicId),
    scopeStatus: index("om_material_scope_status_idx").on(
      table.teamId,
      table.status,
      table.id
    ),
    duplicateScope: index("om_material_duplicate_idx").on(
      table.teamId,
      table.partNumber,
      table.brand,
      table.pkg,
      table.dateCode
    ),
  })
);

/** Explicit public whitelist only. Readers MUST join current status and revision. */
export const officialMallPublications = mysqlTable(
  "official_mall_publications",
  {
    materialId: int("materialId").primaryKey(),
    publicId: varchar("publicId", { length: 40 }).notNull(),
    revision: int("revision").notNull(),
    partNumber: varchar("partNumber", { length: 128 }).notNull(),
    brand: varchar("brand", { length: 128 }).notNull(),
    snapshot: json("snapshot").$type<OfficialMallPublicMaterial>().notNull(),
    publishedAt: localTimestamp("publishedAt").notNull(),
  },
  table => ({
    publicIdUnique: uniqueIndex("om_publication_public_id_uq").on(
      table.publicId
    ),
    search: index("om_publication_search_idx").on(
      table.partNumber,
      table.brand
    ),
  })
);

/** Actor-scoped original UUID receipt + audit, committed atomically with all changes. */
export const officialMallRequests = mysqlTable(
  "official_mall_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    actorAdminUserId: int("actorAdminUserId").notNull(),
    requestId: varchar("requestId", { length: 64 }).notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    state: mysqlEnum("state", ["pending", "completed"]).notNull(),
    result: json("result").$type<Record<string, unknown>>(),
    before: json("before").$type<unknown[]>(),
    after: json("after").$type<unknown[]>(),
    createdAt: localTimestamp("createdAt").default(now).notNull(),
    completedAt: localTimestamp("completedAt"),
  },
  table => ({
    actorRequest: uniqueIndex("om_request_actor_uuid_uq").on(
      table.actorAdminUserId,
      table.requestId
    ),
  })
);

export type OfficialMallMaterialRow = typeof officialMallMaterials.$inferSelect;
