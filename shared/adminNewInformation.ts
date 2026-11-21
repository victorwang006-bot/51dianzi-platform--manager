import { z } from "zod";

export const ADMIN_NEW_INFORMATION_MODULES = [
  "customers", "inventory", "mall", "reception", "procurement", "inbound", "sales",
] as const;
export type AdminNewInformationModule = typeof ADMIN_NEW_INFORMATION_MODULES[number];
export const adminNewInformationModuleSchema = z.enum(ADMIN_NEW_INFORMATION_MODULES);
export const ADMIN_NEW_INFORMATION_REFRESH_MS = 15_000;

export type AdminNewInformationRef = {
  /** Server-defined scoped source key; never a front actor identity. */
  id: string;
  /** Creation/assignment event version, not the mutable product-price version. */
  version: string;
};
export type AdminNewInformationRow = AdminNewInformationRef & {
  occurredAt: string;
  actorKey?: string | null;
};
export type AdminNewInformationUnavailableReason = "denied" | "temporary";
export type AdminNewInformationModuleSummary = {
  count: number;
  available: boolean;
  /** Explicit lost authority vs unknown source/storage failure; absent fails closed. */
  reason?: AdminNewInformationUnavailableReason;
  /** An unavailable number is proven only by an earlier successful snapshot. */
  lastKnown?: boolean;
  /** Optional subroute counts; summed unique source IDs define the header total. */
  children?: Record<string, number>;
};
export type AdminNewInformationSummary = {
  modules: Record<AdminNewInformationModule, AdminNewInformationModuleSummary>;
};
/** Complete unread physical refs, never a first-page approximation. Overflow fails unavailable. */
export const ADMIN_NEW_INFORMATION_MAX_UNREAD_REFS = 2000;
export const adminNewInformationUnreadRefsSchema = z.object({
  module: adminNewInformationModuleSchema,
  scope: z.string().max(180).optional(),
});
export type AdminNewInformationUnreadRefs = { refs: string[]; available: true };
export const adminNewInformationInspectSchema = z.object({
  module: adminNewInformationModuleSchema,
  refs: z.array(z.string().min(1).max(180)).max(100),
  scope: z.string().max(180).optional(),
});
export const adminNewInformationMarkSchema = z.object({
  /** Short-lived server-issued receipt for a single inspected creation event. */
  receipts: z.array(z.string().min(1).max(4096)).max(100),
});
export type AdminNewInformationInspection = {
  items: Array<AdminNewInformationRef & { isNew: boolean; receipt?: string }>;
};
export const ADMIN_NEW_INFORMATION_PATH_MODULE: Record<string, AdminNewInformationModule> = {
  "/workbench/customers": "customers",
  "/workbench/channel-inventory": "inventory",
  "/workbench/mall-materials": "mall",
  "/workbench/inquiries": "reception",
  "/workbench/procurement-demands": "procurement",
  "/workbench/inbound": "inbound",
  "/workbench/orders": "sales",
  "/workbench/outbound": "sales",
  "/workbench/sales-orders": "sales",
};
