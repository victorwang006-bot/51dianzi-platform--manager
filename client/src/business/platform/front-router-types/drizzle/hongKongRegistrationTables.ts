import { int, json, mysqlEnum, mysqlTable, timestamp, varchar, index } from "drizzle-orm/mysql-core";
import type { HkExtractedFields } from "../../shared/hongKongRegistration";

/** 私有证件不出现在企业公开投影；数据库ID不具有访问授权含义。 */
export const hkRegistrationDocuments = mysqlTable("hk_registration_documents", {
  id: varchar("id", { length: 36 }).primaryKey(),
  userId: int("userId").notNull(),
  kind: mysqlEnum("kind", ["BR", "CI", "BANK"]).notNull(),
  objectKey: varchar("objectKey", { length: 512 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  mimeType: varchar("mimeType", { length: 32 }).notNull(),
  extracted: json("extracted").$type<HkExtractedFields>(),
  recognizedType: varchar("recognizedType", { length: 64 }),
  ocrStatus: mysqlEnum("ocrStatus", ["recognized", "failed"]).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ ownerKindIdx: index("hk_documents_owner_kind_idx").on(table.userId, table.kind, table.createdAt) }));
