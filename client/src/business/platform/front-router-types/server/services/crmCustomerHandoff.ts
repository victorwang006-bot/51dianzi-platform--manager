import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";

export const MAX_HANDOFF_CUSTOMERS = 5000;
export type HandoffCustomerRow = { id: number; version: number; archivedAt: Date | string | null };
type Executor = { execute: (query: any) => Promise<unknown> };
function rowsOf<T>(result: unknown): T[] { return (result as [T[], unknown])[0] ?? []; }
function missingCustomerTable(error: unknown): boolean {
  const e = error as { code?: string; cause?: unknown };
  return e?.code === "ER_NO_SUCH_TABLE" || (e?.cause ? missingCustomerTable(e.cause) : false);
}

/** Old installations without the new CRM tables have no CRM assets to transfer. All other DB errors propagate. */
export async function listHandoffCustomers(db: Executor, enterpriseId: number, userId: number, lock = false): Promise<HandoffCustomerRow[]> {
  try {
    return rowsOf<HandoffCustomerRow>(await db.execute(sql`
      SELECT id, version, archivedAt FROM crm_customers
      WHERE enterpriseId = ${enterpriseId} AND assignedUserId = ${userId}
      ORDER BY id LIMIT ${MAX_HANDOFF_CUSTOMERS + 1} ${lock ? sql`FOR UPDATE` : sql``}
    `));
  } catch (error) {
    if (missingCustomerTable(error)) return [];
    throw error;
  }
}

export async function replayedHandoffCustomerCount(db: Executor, enterpriseId: number, requestId: string): Promise<number> {
  try {
    const rows = rowsOf<{ count: number | string }>(await db.execute(sql`
      SELECT COUNT(*) AS count FROM crm_customer_audits
      WHERE enterpriseId = ${enterpriseId} AND requestId = ${requestId} AND action = 'member_handoff'
    `));
    return Number(rows[0]?.count ?? 0);
  } catch (error) {
    if (missingCustomerTable(error)) return 0;
    throw error;
  }
}

/** Caller holds enterprise, involved member and customer rows in that order. */
export async function transferHandoffCustomers(db: Executor, input: {
  enterpriseId: number; actorUserId: number; previousUserId: number; nextUserId: number;
  requestId: string; customers: HandoffCustomerRow[];
}): Promise<number> {
  if (!input.customers.length) return 0;
  const note = `成员业务交接：负责人 ${input.previousUserId} → ${input.nextUserId}`;
  await db.execute(sql`
    INSERT INTO crm_customer_audits (customerId, enterpriseId, actorUserId, action, note, requestId, createdAt)
    SELECT id, enterpriseId, ${input.actorUserId}, 'member_handoff', ${note}, ${input.requestId}, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
    FROM crm_customers WHERE enterpriseId = ${input.enterpriseId} AND assignedUserId = ${input.previousUserId}
  `);
  const changed = await db.execute(sql`
    UPDATE crm_customers SET assignedUserId = ${input.nextUserId},
      updatedByUserId = ${input.actorUserId}, version = version + 1, updatedAt = CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')
    WHERE enterpriseId = ${input.enterpriseId} AND assignedUserId = ${input.previousUserId}
  `);
  const count = Number((changed as [{ affectedRows?: number }, unknown])[0]?.affectedRows ?? 0);
  if (count !== input.customers.length) throw new TRPCError({ code: "CONFLICT", message: "客户归属在交接期间发生变化，请重新盘点" });
  return count;
}
