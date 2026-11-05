import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";

export const STRICT_ARCHIVE_VERSION = "strict_archive_v1";
type Executor = { execute(query: SQL): Promise<unknown> };
export type ArchiveCoverageCheck = { key: string; label: string; reason: string; present: boolean; blocking: boolean };
export type ArchiveCoverage = { version: typeof STRICT_ARCHIVE_VERSION; checks: ArchiveCoverageCheck[] };
function resultRows(result: unknown): unknown[] {
  if (!Array.isArray(result)) throw new Error("Unexpected archive coverage result");
  if (Array.isArray(result[0])) return result[0];
  // Also support executors that return row arrays directly, but never mutation metadata.
  if (result.every(row => row && typeof row === "object" && !Array.isArray(row) && !("affectedRows" in row))) return result;
  throw new Error("Unexpected archive coverage result");
}
/** Caller supplies the verified enterprise, not a client tenant/data-owner guess.
 * Strict mutations hold enterprise + actor/target membership authority fences.
 * Jobs use current READ COMMITTED reads, never FOR UPDATE: workers lock job -> E.
 * Native responsibility producers must recheck active under the same E/member fence.
 */
export async function collectArchiveCoverage(dbOrTx: Executor, enterpriseId: number, targetUserId: number, lock = false): Promise<ArchiveCoverage> {
  if (![enterpriseId, targetUserId].every(id => Number.isSafeInteger(id) && id > 0)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "归档企业或成员身份无效" });
  }
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const E = enterpriseId, T = targetUserId;
  const specs: Array<{ key: string; label: string; query: SQL; transferable?: boolean }> = [
    { key: "inventory", label: "库存", transferable: true, query: sql`SELECT id FROM inventories WHERE enterpriseId = ${E} AND ownerUserId = ${T} ORDER BY id LIMIT 1${suffix}` },
    { key: "inquiries", label: "未结库存询价", transferable: true, query: sql`SELECT id FROM inventory_inquiries WHERE enterpriseId = ${E} AND assigneeUserId = ${T} AND status IN ('open', 'replied') ORDER BY id LIMIT 1${suffix}` },
    { key: "customers", label: "客户", transferable: true, query: sql`SELECT id FROM crm_customers WHERE enterpriseId = ${E} AND assignedUserId = ${T} ORDER BY id LIMIT 1${suffix}` },
    { key: "active_procurement_quotes", label: "活跃采购报价", query: sql`SELECT id FROM crm_customer_demand_quotes WHERE enterpriseId = ${E} AND procurementUserId = ${T} AND status = 'active' ORDER BY id LIMIT 1${suffix}` },
    { key: "future_inquiry_routes", label: "后续询价接待路由", query: sql`SELECT inventoryId FROM enterprise_inquiry_routes WHERE enterpriseId = ${E} AND assigneeUserId = ${T} ORDER BY inventoryId LIMIT 1${suffix}` },
    { key: "native_channels", label: "渠道档案负责人", query: sql`SELECT id FROM channel_inventory_channels WHERE enterprise_id = ${E} AND responsible_user_id = ${T} ORDER BY id LIMIT 1${suffix}` },
    { key: "native_materials", label: "渠道物料负责人", query: sql`SELECT id FROM channel_inventory_materials WHERE enterprise_id = ${E} AND responsible_user_id = ${T} ORDER BY id LIMIT 1${suffix}` },
    { key: "team_current_owner", label: "团队业务当前负责人", query: sql`SELECT id FROM enterprise_team_record_assignments WHERE enterpriseId = ${E} AND currentOwnerUserId = ${T} ORDER BY id LIMIT 1${suffix}` },
    { key: "active_team_leader", label: "在用团队主组长", query: sql`SELECT id FROM enterprise_teams WHERE enterpriseId = ${E} AND leaderUserId = ${T} AND status = 'active' ORDER BY id LIMIT 1${suffix}` },
    // NULL-tenant candidates are not guessed from stable enterprise dataOwner or team.
    // Even frozen mappings need a controlled legacy handoff; no history rewrite here.
    { key: "legacy_inventory_candidates", label: "企业归属待核验的遗留库存", query: sql`SELECT id FROM inventories WHERE enterpriseId IS NULL AND ownerUserId = ${T} ORDER BY id LIMIT 1${suffix}` },
    { key: "legacy_inquiry_candidates", label: "企业归属待核验的遗留询价", query: sql`SELECT id FROM inventory_inquiries WHERE enterpriseId IS NULL AND assigneeUserId = ${T} AND status IN ('open', 'replied') ORDER BY id LIMIT 1${suffix}` },
    { key: "active_import_jobs", label: "未结束库存导入任务", query: sql`SELECT id FROM inventory_import_jobs WHERE activeEnterpriseId = ${E} AND enterpriseId = ${E} AND status IN ('staging', 'queued', 'running', 'paused') AND (createdByUserId = ${T} OR ownerUserId = ${T}) LIMIT 1` },
    { key: "active_publish_jobs", label: "未结束库存发布任务", query: sql`SELECT id FROM inventory_publish_jobs WHERE activeEnterpriseId = ${E} AND enterpriseId = ${E} AND status IN ('queued', 'running', 'paused') AND (createdByUserId = ${T} OR scopeOwnerUserId = ${T}) LIMIT 1` },
  ];
  const checks: ArchiveCoverageCheck[] = [];
  for (const spec of specs) {
    try {
      const present = resultRows(await dbOrTx.execute(spec.query)).length > 0;
      checks.push({ key: spec.key, label: spec.label, present, blocking: present && !spec.transferable,
        reason: spec.transferable ? "复用现有受控交接并在事务末尾归零复查" : "存在当前责任，请先通过现有受控业务交接、撤回或任务取消/完成处理后重新盘点" });
    } catch (cause) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: `无法核验${spec.label}，不能完成员工归档`, cause });
    }
  }
  return { version: STRICT_ARCHIVE_VERSION, checks };
}
export function assertArchiveCoverage(coverage: ArchiveCoverage, requireZero = false): void {
  const blockers = coverage.checks.filter(check => check.blocking || (requireZero && check.present));
  if (blockers.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: `请先处理负责业务：${blockers.map(check => check.label).join("、")}` });
}
