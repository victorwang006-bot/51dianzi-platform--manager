import {
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  varchar,
} from "drizzle-orm/mysql-core";
import { ADMIN_NEW_INFORMATION_MODULES } from "../shared/adminNewInformation";

/** New empty admin-only side tables; no business data, foreign keys or backfill. */
export const adminNewInformationStates = mysqlTable(
  "admin_new_information_states",
  {
    adminUserId: int("adminUserId", { unsigned: true }).notNull(),
    module: mysqlEnum("module", ADMIN_NEW_INFORMATION_MODULES).notNull(),
    initialized: int("initialized", { unsigned: true }).default(0).notNull(),
    lastCount: int("lastCount", { unsigned: true }).default(0).notNull(),
    lastChildren: json("lastChildren").$type<Record<string, number>>(),
  },
  table => ({ pk: primaryKey({ columns: [table.adminUserId, table.module] }) })
);

/** Exact creation/assignment event SHA-256; not a menu-level read cursor. */
export const adminNewInformationSeen = mysqlTable(
  "admin_new_information_seen",
  {
    adminUserId: int("adminUserId", { unsigned: true }).notNull(),
    module: mysqlEnum("module", ADMIN_NEW_INFORMATION_MODULES).notNull(),
    eventKey: varchar("eventKey", { length: 64 }).notNull(),
  },
  table => ({
    pk: primaryKey({
      columns: [table.adminUserId, table.module, table.eventKey],
    }),
  })
);
