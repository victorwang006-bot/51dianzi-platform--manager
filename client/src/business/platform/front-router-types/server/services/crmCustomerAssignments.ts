import { sql } from "drizzle-orm";
import type { StaffDelegation } from "../_core/context";
import type { CrmSqlExecutor } from "./crmCustomers";

export type CustomerNewInformationDelegation = Pick<StaffDelegation,
  "kind" | "adminAccountId" | "staffUserId" | "enterpriseId" | "requestId">;
export type CustomerAssignmentIdentity = {
  enterpriseId: number; actorUserId: number; staffDelegation?: CustomerNewInformationDelegation;
};
/** The argument is server ctx provenance; NEVER pass a parsed HTTP property or infer IDs from names. */
export function trustedCustomerAdminAccountId(identity: CustomerAssignmentIdentity): number | null {
  const d = identity.staffDelegation;
  return d?.kind === "business_bff" && d.enterpriseId === identity.enterpriseId
    && d.staffUserId === identity.actorUserId && Number.isSafeInteger(d.adminAccountId) && d.adminAccountId > 0
    ? d.adminAccountId : null;
}
/** Called only AFTER an actual owner change while the original business transaction owns customer locks.
 * Version uniqueness fences replay. submitted/processing demand membership is frozen in this SAME transaction.
 * Existing demand writers lock the customer first; this does NOT write a demand or claim a procurement task.
 */
export async function recordCrmCustomerAssignmentFact(tx: CrmSqlExecutor, input: CustomerAssignmentIdentity & {
  customerId: number; fromUserId: number; toUserId: number; customerVersion: number;
  assignmentKind: "transfer" | "member_handoff"; requestId?: string | null;
}): Promise<void> {
  if (input.fromUserId === input.toUserId) return;
  const adminAccountId = trustedCustomerAdminAccountId(input);
  const requestId = input.requestId ?? (adminAccountId !== null ? input.staffDelegation?.requestId : null) ?? null;
  const result = await tx.execute(sql`
    INSERT INTO admin_new_information_customer_assignments
      (enterpriseId, customerId, fromUserId, toUserId, actorUserId, adminAccountId,
       requestId, assignmentKind, customerVersion, occurredAt)
    SELECT c.enterpriseId, c.id, ${input.fromUserId}, ${input.toUserId}, ${input.actorUserId},
           ${adminAccountId}, ${requestId},
           ${input.assignmentKind}, ${input.customerVersion}, c.updatedAt
      FROM crm_customers c
     WHERE c.enterpriseId = ${input.enterpriseId} AND c.id = ${input.customerId}
       AND c.assignedUserId = ${input.toUserId} AND c.version = ${input.customerVersion}
  `);
  const header = (result as [{ affectedRows?: number; insertId?: number | string | bigint }, unknown])[0];
  if (typeof header?.insertId === "number" && !Number.isSafeInteger(header.insertId)) throw new Error("Unsafe customer assignment fact ID");
  const assignmentId = String(header?.insertId ?? "0");
  if (Number(header?.affectedRows) !== 1 || !/^[1-9]\d*$/.test(assignmentId)) throw new Error("Customer assignment fact does not match the locked owner change");
  await tx.execute(sql`
    INSERT INTO admin_new_information_customer_assignment_demands (assignmentId, enterpriseId, customerId, demandId)
    SELECT ${assignmentId}, d.enterpriseId, d.customerId, d.id FROM crm_customer_demands d
     WHERE d.enterpriseId = ${input.enterpriseId} AND d.customerId = ${input.customerId}
       AND d.status IN ('submitted', 'processing')
  `);
}
/** No mapping => no actorKey, no guessed admin ID. create replay calls never reach this hook. */
export async function recordCrmCustomerCreationFact(tx: CrmSqlExecutor, input: CustomerAssignmentIdentity & {
  customerId: number; requestId: string;
}): Promise<void> {
  const adminAccountId = trustedCustomerAdminAccountId(input);
  if (adminAccountId === null) return;
  const result = await tx.execute(sql`
    INSERT INTO admin_new_information_customer_creations
      (customerId, enterpriseId, actorUserId, adminAccountId, requestId, occurredAt)
    SELECT c.id, c.enterpriseId, ${input.actorUserId}, ${adminAccountId}, ${input.requestId}, c.createdAt
      FROM crm_customers c WHERE c.enterpriseId = ${input.enterpriseId} AND c.id = ${input.customerId}
        AND c.createdByUserId = ${input.actorUserId}
  `);
  if (Number((result as [{ affectedRows?: number }, unknown])[0]?.affectedRows) !== 1) {
    throw new Error("Customer creation fact does not match the successful create");
  }
}
