import { sql, type SQL } from "drizzle-orm";
type Executor = { execute(query: SQL): Promise<unknown> };
function rows<T>(result: unknown): T[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("库存任务成员权限读取失败");
  return result[0] as T[];
}
/** Existing producer holds E first (quota); retries may hold job first, matching workers.
 * Only concrete creator/owner identities are checked; stable CRM owner is never an employee guess.
 */
export async function lockActiveInventoryJobMembers(tx: Executor, input: { enterpriseId: number; createdByUserId: number; ownerUserId?: number | null }) {
  const ids = Array.from(new Set([input.createdByUserId, ...(input.ownerUserId ? [input.ownerUserId] : [])])).sort((a, b) => a - b);
  if (![input.enterpriseId, ...ids].every(id => Number.isSafeInteger(id) && id > 0)) throw new Error("库存任务企业成员身份无效");
  const enterprise = rows<{ id: number; superAdminUserId: number }>(await tx.execute(sql`SELECT id, superAdminUserId FROM enterprises WHERE id = ${input.enterpriseId} LIMIT 1 FOR UPDATE`))[0];
  const members = rows<{ id: number; userId: number; status: string; role: string }>(await tx.execute(sql`
    SELECT id, userId, status, role FROM enterprise_members
    WHERE enterpriseId = ${input.enterpriseId} AND userId IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
    ORDER BY userId FOR UPDATE
  `));
  if (!enterprise || ids.some(id => !members.some(member => Number(member.userId) === id && member.status === "active"))) {
    throw new Error("库存任务创建人或负责人的当前企业资格已失效");
  }
  const creator = members.find(member => Number(member.userId) === input.createdByUserId)!;
  const permissions = rows<{ permissionKey: string }>(await tx.execute(sql`SELECT permissionKey FROM enterprise_member_permissions WHERE enterpriseMemberId = ${creator.id} FOR UPDATE`));
  if (!(creator.role === "super_admin" && Number(enterprise.superAdminUserId) === input.createdByUserId)
    && !permissions.some(row => row.permissionKey === "inventory.publish")) throw new Error("任务创建人的库存发布权限已失效");
}
