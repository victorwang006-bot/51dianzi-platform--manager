import { sql, type SQLWrapper } from "drizzle-orm";
import { trustedCustomerAdminAccountId, type CustomerAssignmentIdentity } from "./crmCustomerAssignments";

export type AdminNewInformationOriginExecutor = { execute(query: SQLWrapper): Promise<unknown> };
export type AdminNewInformationOriginScope = CustomerAssignmentIdentity;
export type AdminNewInformationOriginDependencies = {
  trustedCustomerAdminAccountId: typeof trustedCustomerAdminAccountId;
};
type Origin = {
  resourceKind: "demand" | "crm-sales"; resourceId: number; enterpriseId: number;
  eventRef: string; adminAccountId: number; staffUserId: number; requestId: string; occurredAt: string;
};
function rows<T>(result: unknown): T[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("Invalid origin SQL result");
  return result[0] as T[];
}
/** Original CRM DATETIME is +08 wall time; driver Date already represents an instant. */
export function adminNewInformationOriginIso(value: Date | string): string {
  const raw = value instanceof Date ? value : String(value);
  const date = raw instanceof Date ? raw : new Date(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? `${raw.replace(" ", "T")}+08:00` : raw);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid original origin time");
  return date.toISOString();
}
/** No DB acquisition, network, authorization clone or business DML; bind this factory in native runtime. */
export function createAdminNewInformationOrigins(overrides: Partial<AdminNewInformationOriginDependencies> = {}) {
  const trusted = overrides.trustedCustomerAdminAccountId ?? trustedCustomerAdminAccountId;
  async function insertExact(tx: AdminNewInformationOriginExecutor, origin: Origin): Promise<void> {
    // Global physical PK fences even a different enterprise/admin. Caller still owns original resource locks.
    const existing = rows<Origin>(await tx.execute(sql`
      SELECT resourceKind, resourceId, enterpriseId, eventRef, adminAccountId, staffUserId, requestId,
             DATE_FORMAT(occurredAt, '%Y-%m-%d %H:%i:%s') AS occurredAt
        FROM admin_new_information_origins
       WHERE resourceKind = ${origin.resourceKind} AND resourceId = ${origin.resourceId} LIMIT 1 FOR UPDATE
    `))[0];
    if (existing) {
      if (existing.resourceKind !== origin.resourceKind || Number(existing.resourceId) !== origin.resourceId
        || Number(existing.enterpriseId) !== origin.enterpriseId || existing.eventRef !== origin.eventRef
        || Number(existing.adminAccountId) !== origin.adminAccountId || Number(existing.staffUserId) !== origin.staffUserId
        || existing.requestId !== origin.requestId || existing.occurredAt !== origin.occurredAt) {
        throw new Error("Conflicting immutable admin new information origin");
      }
      return;
    }
    const result = await tx.execute(sql`
      INSERT INTO admin_new_information_origins
        (resourceKind, resourceId, enterpriseId, eventRef, adminAccountId, staffUserId, requestId, occurredAt)
      VALUES (${origin.resourceKind}, ${origin.resourceId}, ${origin.enterpriseId}, ${origin.eventRef},
              ${origin.adminAccountId}, ${origin.staffUserId}, ${origin.requestId}, ${origin.occurredAt})
    `);
    if (Number((result as [{ affectedRows?: number }, unknown])[0]?.affectedRows) !== 1) {
      throw new Error("Admin new information origin was not inserted");
    }
  }
  async function recordDemandFirstSubmissionOrigin(tx: AdminNewInformationOriginExecutor, scope: AdminNewInformationOriginScope,
    input: { demandId: number; customerId: number; action: string; requestId: string }): Promise<void> {
    if (input.action !== "submitted") return;
    const adminAccountId = trusted(scope);
    if (adminAccountId === null) return;
    const first = rows<{ id: number | string; actorUserId: number; requestId: string | null; occurredAt: string }>(await tx.execute(sql`
      SELECT id, actorUserId, requestId, DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS occurredAt
        FROM crm_customer_demand_audits
       WHERE enterpriseId = ${scope.enterpriseId} AND customerId = ${input.customerId}
         AND demandId = ${input.demandId} AND action = 'submitted'
       ORDER BY createdAt ASC, id ASC LIMIT 1
    `))[0];
    // An old/absent first audit is not this submission: NEVER attribute legacy/resubmitted rows.
    if (!first || first.requestId !== input.requestId || Number(first.actorUserId) !== scope.actorUserId) return;
    const auditId = String(first.id);
    if (!/^[1-9]\d*$/.test(auditId) || (typeof first.id === "number" && !Number.isSafeInteger(first.id))) {
      throw new Error("Invalid first submission audit ID");
    }
    await insertExact(tx, { resourceKind: "demand", resourceId: input.demandId, enterpriseId: scope.enterpriseId,
      eventRef: `firstsubmitted:${auditId}:${adminNewInformationOriginIso(first.occurredAt)}`,
      adminAccountId, staffUserId: scope.actorUserId, requestId: input.requestId, occurredAt: first.occurredAt });
  }
  async function recordCrmSalesCreationOrigin(tx: AdminNewInformationOriginExecutor, scope: AdminNewInformationOriginScope,
    input: { orderId: number; requestId: string }): Promise<void> {
    const adminAccountId = trusted(scope);
    if (adminAccountId === null) return;
    // Called only after the real INSERT returns its orderId, never on create replay or after BFF success.
    const created = rows<{ occurredAt: string }>(await tx.execute(sql`
      SELECT DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s') AS occurredAt FROM crm_sales_orders
       WHERE id = ${input.orderId} AND enterpriseId = ${scope.enterpriseId} AND createdByUserId = ${scope.actorUserId} LIMIT 1
    `))[0];
    if (!created) throw new Error("Origin does not match the newly created CRM sales order");
    await insertExact(tx, { resourceKind: "crm-sales", resourceId: input.orderId, enterpriseId: scope.enterpriseId,
      eventRef: `created:${adminNewInformationOriginIso(created.occurredAt)}`,
      adminAccountId, staffUserId: scope.actorUserId, requestId: input.requestId, occurredAt: created.occurredAt });
  }
  return { recordDemandFirstSubmissionOrigin, recordCrmSalesCreationOrigin };
}
export const { recordDemandFirstSubmissionOrigin, recordCrmSalesCreationOrigin } = createAdminNewInformationOrigins();
