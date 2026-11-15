import { index, int, mysqlTable, timestamp } from "drizzle-orm/mysql-core";

/** Additive only. Front teamId and native admin staffTeamId are DISTINCT namespaces. */
export const inboundProcurementOwners = mysqlTable("inbound_procurement_owners", {
  inboundOrderId: int("inboundOrderId").primaryKey(),
  enterpriseId: int("enterpriseId").notNull(),
  ownerUserId: int("ownerUserId").notNull(),
  buyerUserId: int("buyerUserId").notNull(),
  teamId: int("teamId"),
  recordedByUserId: int("recordedByUserId").notNull(),
  staffTeamId: int("staffTeamId").notNull(),
  buyerAdminUserId: int("buyerAdminUserId").notNull(),
  recordedByAdminUserId: int("recordedByAdminUserId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  buyerIdx: index("inbound_procurement_buyer_idx").on(table.enterpriseId, table.buyerUserId, table.inboundOrderId),
  teamIdx: index("inbound_procurement_team_idx").on(table.enterpriseId, table.teamId, table.inboundOrderId),
  ownerIdx: index("inbound_procurement_owner_idx").on(table.ownerUserId, table.inboundOrderId),
  staffTeamIdx: index("inbound_procurement_staff_team_idx").on(table.enterpriseId, table.staffTeamId, table.inboundOrderId),
}));
