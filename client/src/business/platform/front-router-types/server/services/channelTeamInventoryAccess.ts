import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { ChannelInventoryError, resolveChannelInventoryAuthority, type ChannelInventoryScope, type SqlExecutor, type SqlResultRow } from "./channelInventory";
import { resolveBusinessModuleAccess } from "./businessModuleAccess";
import { teamMaterialSourceEligibility } from "./channelInventorySource";

export const teamInventoryRows = (result: unknown): SqlResultRow[] => {
  if (Array.isArray(result)) return (Array.isArray(result[0]) ? result[0] : result) as SqlResultRow[];
  return result && typeof result === "object" && "rows" in result && Array.isArray(result.rows) ? result.rows as SqlResultRow[] : [];
};
export const teamInventoryAll = (predicates: SQL[]) => sql.join(predicates, sql` AND `);
export const TEAM_MATERIAL_FROM = sql`FROM channel_inventory_materials m INNER JOIN channel_inventory_channels c
 ON c.id = m.channel_id AND c.enterprise_id = m.enterprise_id
 AND c.data_owner_user_id = m.data_owner_user_id AND c.responsible_user_id = m.responsible_user_id`;

/** The original listTeamMaterials visibility algorithm, shared by collaboration operations.
 * Scope labels never confer sharing; current assignment revision, owner membership identity,
 * owner account/member/module access and explicit enabled share all remain mandatory.
 */
export async function resolveTeamInventoryVisibility(executor: SqlExecutor, scope: ChannelInventoryScope, options: { lock?: boolean; materialId?: number } = {}) {
    // Force the existing module helper to use current locking reads even through test/adaptor wrappers.
    const db = options.lock ? { execute: (query: SQL) => executor.execute(query), rollback: (): never => { throw new Error("authority-only transaction marker"); } } : executor;
    const suffix = options.lock ? sql` FOR UPDATE` : sql``;
    const access = await resolveChannelInventoryAuthority(db, scope, "stocks", false, options.lock === true);
    // Do not infer leadership from native adminRole, enterprise role or cached context.
    const memberships = teamInventoryRows(await db.execute(sql`SELECT tm.id, tm.teamId, tm.teamRole FROM enterprise_team_members tm
      INNER JOIN enterprise_teams t ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
      WHERE tm.enterpriseId = ${scope.enterpriseId} AND tm.userId = ${scope.actorUserId}${suffix}`));
    const member = memberships.length === 1 && ["leader", "member"].includes(String(memberships[0].teamRole)) ? memberships[0] : null;
    const leader = member?.teamRole === "leader";
    if (options.lock && options.materialId !== undefined) {
      // Lock source/material plus every mutable share fence explicitly: FOR UPDATE on
      // the outer EXISTS query alone does not lock its subquery's rows in MySQL.
      const target = teamInventoryRows(await db.execute(sql`SELECT m.id, m.responsible_user_id AS ownerUserId ${TEAM_MATERIAL_FROM}
        WHERE m.id = ${options.materialId} AND m.enterprise_id = ${scope.enterpriseId}
          AND m.data_owner_user_id = ${scope.dataOwnerUserId} LIMIT 1 FOR UPDATE`))[0];
      if (!target) throw new ChannelInventoryError("NOT_FOUND", "库存条目不存在或无权访问");
      await db.execute(sql`SELECT material_id FROM channel_inventory_material_shares
        WHERE enterprise_id = ${scope.enterpriseId} AND material_id = ${options.materialId} FOR UPDATE`);
      await db.execute(sql`SELECT id FROM enterprise_team_record_assignments WHERE enterpriseId = ${scope.enterpriseId}
        AND recordType = 'channel_material' AND recordId = ${options.materialId} FOR UPDATE`);
      await db.execute(sql`SELECT tm.id FROM enterprise_team_members tm INNER JOIN enterprise_teams t
        ON t.enterpriseId = tm.enterpriseId AND t.id = tm.teamId
        WHERE tm.enterpriseId = ${scope.enterpriseId} AND tm.userId = ${Number(target.ownerUserId)} FOR UPDATE`);
    }

    // A note reference may already have opened an RR view. Locking the parent
    // SELECT or these rows separately does not make a plain EXISTS current-read.
    const peer = member ? sql`EXISTS (SELECT 1 FROM channel_inventory_material_shares s
      INNER JOIN enterprise_team_record_assignments a ON a.enterpriseId = s.enterprise_id
       AND a.recordType = 'channel_material' AND a.recordId = s.material_id
       AND a.currentOwnerUserId = s.owner_user_id AND a.teamId = s.share_team_id AND a.revision = s.assignment_revision
      INNER JOIN enterprise_team_members owner_tm ON owner_tm.enterpriseId = s.enterprise_id
       AND owner_tm.userId = s.owner_user_id AND owner_tm.teamId = s.share_team_id AND owner_tm.id = s.owner_membership_id
       AND owner_tm.teamRole IN ('leader', 'member')
      INNER JOIN enterprise_teams t ON t.id = s.share_team_id AND t.enterpriseId = s.enterprise_id AND t.status = 'active'
      INNER JOIN enterprise_team_members reader_tm ON reader_tm.enterpriseId = s.enterprise_id
       AND reader_tm.teamId = s.share_team_id AND reader_tm.userId = ${scope.actorUserId} AND reader_tm.id = ${Number(member.id)}
      INNER JOIN enterprise_members owner_em ON owner_em.enterpriseId = s.enterprise_id AND owner_em.userId = s.owner_user_id AND owner_em.status = 'active'
      INNER JOIN users owner_u ON owner_u.id = owner_em.userId AND owner_u.loginDisabled = 0
      WHERE s.enterprise_id = m.enterprise_id AND s.material_id = m.id AND s.enabled = 1
       AND s.owner_user_id = m.responsible_user_id AND s.share_team_id = ${Number(member.teamId)}
       AND (EXISTS (SELECT 1 FROM enterprise_member_permissions p WHERE p.enterpriseMemberId = owner_em.id AND p.permissionKey = 'inventory.manage')
        OR (owner_em.role = 'super_admin' AND EXISTS (SELECT 1 FROM enterprises e WHERE e.id = s.enterprise_id AND e.superAdminUserId = owner_em.userId)))${suffix})` : sql`FALSE`;
    const base = [sql`m.enterprise_id = ${scope.enterpriseId}`, sql`m.data_owner_user_id = ${scope.dataOwnerUserId}`];
    if (options.materialId !== undefined) base.push(sql`m.id = ${options.materialId}`);
    const eligible: number[] = [];
    if (member) {
      const owners = teamInventoryRows(await db.execute(sql`SELECT DISTINCT m.responsible_user_id AS ownerUserId ${TEAM_MATERIAL_FROM}
        WHERE ${teamInventoryAll([...base, sql`m.responsible_user_id <> ${scope.actorUserId}`, peer])}`));
      for (const owner of owners) {
        const id = Number(owner.ownerUserId);
        try {
          const grant = await resolveBusinessModuleAccess(id, scope.enterpriseId, "stocks", db);
          if (grant.read && grant.write) eligible.push(id);
        } catch (error) {
          if (!(error instanceof TRPCError) || error.code !== "FORBIDDEN") throw error;
        }
      }
    }
    const shared = eligible.length ? sql`(${peer} AND m.responsible_user_id IN (${sql.join(eligible.map(id => sql`${id}`), sql`, `)}))` : sql`FALSE`;
    return { access, leader, predicates: [...base, sql`(m.responsible_user_id = ${scope.actorUserId} OR ${shared} OR ${scope.officialActor && member ? teamMaterialSourceEligibility(scope, options.lock === true) : sql`FALSE`})`] };
  }
