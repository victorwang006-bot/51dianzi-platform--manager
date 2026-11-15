import { sql, type SQL } from "drizzle-orm";
import { ChannelInventoryError, resolveChannelInventoryAuthority, type ChannelInventoryScope, type SqlExecutor } from "./channelInventory";
import { currentReadExecutor, resolveCustomerSupplyReadPolicy } from "./customerSupplyCompany";
import { crmCustomerPolicyWhere, resolveCrmCustomerPolicy } from "./crmCustomers";
import type { HistoryAccess } from "../../../shared/customerUploadHistory";
export type CustomerUploadHistoryPolicyDependencies = {
  resolveCustomerSupplyReadPolicy: typeof resolveCustomerSupplyReadPolicy;
  resolveChannelInventoryAuthority: typeof resolveChannelInventoryAuthority;
  resolveCrmCustomerPolicy: typeof resolveCrmCustomerPolicy;
};
const native: CustomerUploadHistoryPolicyDependencies = { resolveCustomerSupplyReadPolicy, resolveChannelInventoryAuthority, resolveCrmCustomerPolicy };
const records = (result: unknown): Record<string, unknown>[] => Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) as Record<string, unknown>[] : [];
export function historyActorIsSelf(scope: ChannelInventoryScope, record: { uploaded_by_user_id: unknown; uploaded_by_admin_account_id: unknown }): boolean {
  return Number(record.uploaded_by_user_id) === scope.actorUserId && (scope.officialActor
    ? Number(record.uploaded_by_admin_account_id) === scope.officialActor.adminAccountId
    : record.uploaded_by_admin_account_id == null);
}
/** Resolve real current guards BEFORE any history/file/row SELECT. Alias arguments are internal constants only. */
export async function resolveCustomerUploadHistoryPolicy(tx: SqlExecutor, scope: ChannelInventoryScope, write = false, deps: CustomerUploadHistoryPolicyDependencies = native) {
  const current = currentReadExecutor(tx);
  const crmRead = await deps.resolveCustomerSupplyReadPolicy(current, scope);
  const channels = await deps.resolveChannelInventoryAuthority(current, scope, "channels", write, true);
  const stocks = await deps.resolveChannelInventoryAuthority(current, scope, "stocks", write, true);
  const crm = write ? await deps.resolveCrmCustomerPolicy(current, scope, true) : crmRead;
  const qualifiedLeader = crm.read && (!write || crm.write) && crm.explicit && crm.scope === "team"
    && crm.teamRole === "leader" && crm.teamId != null && stocks.scope === "team" && stocks.teamRole === "leader"
    && stocks.teamId === crm.teamId;
  // scope=enterprise is produced only by current owner/manage_all under native CRM policy.
  // Still verify actual grant; generic admin roles or old inventoryDataScope never qualify.
  const actualManager = records(await tx.execute(sql`SELECT em.id FROM enterprise_members em
    INNER JOIN users u ON u.id = em.userId INNER JOIN enterprises e ON e.id = em.enterpriseId
    WHERE em.enterpriseId = ${scope.enterpriseId} AND em.userId = ${scope.actorUserId}
      AND em.status = 'active' AND u.loginDisabled = 0 AND e.crmDataOwnerUserId = ${scope.dataOwnerUserId}
      AND ((em.role = 'super_admin' AND e.superAdminUserId = em.userId) OR EXISTS
        (SELECT 1 FROM enterprise_member_permissions mp WHERE mp.enterpriseMemberId = em.id AND mp.permissionKey = 'customers.manage_all'))
    LIMIT 1 FOR UPDATE`)).length === 1;
  const enterpriseManager = actualManager && crm.scope === "enterprise" && crm.read && (!write || crm.write)
    && !(stocks.explicit && stocks.scope === "self");
  const canManage = enterpriseManager || qualifiedLeader;
  const selfWhere = (alias = "h") => { const h = sql.raw(alias); return sql`${h}.uploaded_by_user_id = ${scope.actorUserId} AND ${scope.officialActor
    ? sql`${h}.uploaded_by_admin_account_id = ${scope.officialActor.adminAccountId}`
    : sql`${h}.uploaded_by_admin_account_id IS NULL`}`; };
  const leaderWhere = (alias = "h"): SQL => {
    if (!qualifiedLeader) return sql`FALSE`;
    const h = sql.raw(alias);
    return sql`EXISTS (SELECT 1 FROM enterprise_team_members leader_tm
      INNER JOIN enterprise_teams live_team ON live_team.enterpriseId = leader_tm.enterpriseId AND live_team.id = leader_tm.teamId AND live_team.status = 'active'
      INNER JOIN enterprise_team_members uploader_tm ON uploader_tm.enterpriseId = leader_tm.enterpriseId AND uploader_tm.teamId = leader_tm.teamId
      INNER JOIN enterprise_members uploader_em ON uploader_em.enterpriseId = uploader_tm.enterpriseId AND uploader_em.userId = uploader_tm.userId AND uploader_em.status = 'active'
      INNER JOIN users uploader_user ON uploader_user.id = uploader_em.userId AND uploader_user.loginDisabled = 0
      WHERE leader_tm.enterpriseId = ${scope.enterpriseId} AND leader_tm.userId = ${scope.actorUserId} AND leader_tm.teamRole = 'leader'
        AND leader_tm.teamId = ${crm.teamId} AND uploader_tm.userId = ${h}.uploaded_by_user_id AND uploader_tm.teamRole IN ('leader','member')
        AND (SELECT COUNT(*) FROM enterprise_team_members unique_leader WHERE unique_leader.enterpriseId = leader_tm.enterpriseId AND unique_leader.userId = leader_tm.userId) = 1
        AND (SELECT COUNT(*) FROM enterprise_team_members unique_uploader WHERE unique_uploader.enterpriseId = uploader_tm.enterpriseId AND unique_uploader.userId = uploader_tm.userId) = 1)`;
  };
  const customerWhere = (alias = "c") => crmCustomerPolicyWhere(scope, crm, alias, write);
  const where = (alias = "h", managementOnly = false): SQL => {
    const h = sql.raw(alias);
    return sql`${h}.enterprise_id = ${scope.enterpriseId} AND ${h}.data_owner_user_id = ${scope.dataOwnerUserId}
      AND EXISTS (SELECT 1 FROM crm_customers history_customer WHERE history_customer.id = ${h}.customer_id AND ${customerWhere("history_customer")})
      AND (${managementOnly ? sql`FALSE` : selfWhere(alias)} OR ${enterpriseManager ? sql`TRUE` : leaderWhere(alias)})`;
  };
  return { crm, channels, stocks, qualifiedLeader, enterpriseManager, canManage, where, selfWhere, leaderWhere, customerWhere,
    access(record: { uploaded_by_user_id: unknown; uploaded_by_admin_account_id: unknown; leader_access?: unknown }): HistoryAccess {
      if (historyActorIsSelf(scope, record)) return "self";
      if (enterpriseManager) return "enterprise_manager";
      if (qualifiedLeader && [true, 1, "1"].includes(record.leader_access as boolean | number | string)) return "current_team_leader";
      throw new ChannelInventoryError("NOT_FOUND", "记录不存在或无权访问");
    } };
}
export type CustomerUploadHistoryPolicy = Awaited<ReturnType<typeof resolveCustomerUploadHistoryPolicy>>;
