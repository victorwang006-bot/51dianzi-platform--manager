import { sql, type SQL } from "drizzle-orm";
import type { ChannelInventoryScope } from "./channelInventory";

/** Read scope only. A share or an uploader/immutable creator is never a channel grant.
 * The signed official team projection is intersected with CURRENT ERP assignments,
 * membership and account status. Missing/ambiguous/stale facts fail closed.
 * Historical CRM supply-link inventoryResponsibleUserId is not current authority:
 * a valid handoff updates the channel and assignment, not that legacy mapping.
 * Sensitive linked customer fields retain their separate linkedCompanyReadGate.
 * No enterprise scope is inferred from adminRole, isOwner or inventoryDataScope.
 * All aliases are fixed service-owned identifiers, never browser values.
 */
export function channelSourceReadEligibility(scope: ChannelInventoryScope, lock = false, alias = "c", leaderOnly = false): SQL {
  if (!/^[a-z_]+$/.test(alias)) throw new Error("Invalid channel SQL alias");
  const c = sql.raw(alias);
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const proof = scope.officialActor?.inventoryPermissions?.channelProfileTeamRead;
  const officialTeam = proof && proof.ownerUserIds.includes(scope.actorUserId)
    ? proof.businessTeamLeaderRead === true
      ? proof.ownerUserIds.length === 1 ? sql`profile_reader.teamRole = 'leader'` : sql`FALSE`
      : sql`${c}.responsible_user_id IN (${sql.join(proof.ownerUserIds.map(id => sql`${id}`), sql`, `)})`
    : sql`FALSE`;
  const team = scope.officialActor ? officialTeam : sql`profile_reader.teamRole = 'leader'`;
  return sql`(${c}.enterprise_id = ${scope.enterpriseId} AND ${c}.data_owner_user_id = ${scope.dataOwnerUserId}
    AND EXISTS (SELECT 1 FROM enterprise_team_record_assignments profile_a
      INNER JOIN enterprise_team_members profile_owner ON profile_owner.enterpriseId = profile_a.enterpriseId
        AND profile_owner.teamId = profile_a.teamId AND profile_owner.userId = profile_a.currentOwnerUserId
        AND profile_owner.teamRole IN ('leader', 'member')
      INNER JOIN enterprise_teams profile_t ON profile_t.enterpriseId = profile_a.enterpriseId
        AND profile_t.id = profile_a.teamId AND profile_t.status = 'active'
      INNER JOIN enterprise_members profile_em ON profile_em.enterpriseId = profile_a.enterpriseId
        AND profile_em.userId = profile_a.currentOwnerUserId AND profile_em.status = 'active'
      INNER JOIN users profile_u ON profile_u.id = profile_em.userId AND profile_u.loginDisabled = 0
      INNER JOIN enterprise_team_members profile_reader ON profile_reader.enterpriseId = profile_a.enterpriseId
        AND profile_reader.teamId = profile_a.teamId AND profile_reader.userId = ${scope.actorUserId}
        AND profile_reader.teamRole IN ('leader', 'member')
      WHERE profile_a.enterpriseId = ${c}.enterprise_id AND profile_a.recordType = 'channel'
        AND profile_a.recordId = ${c}.id AND profile_a.currentOwnerUserId = ${c}.responsible_user_id
        AND profile_a.revision >= 1
        AND (${leaderOnly ? sql`FALSE` : sql`${c}.responsible_user_id = ${scope.actorUserId}`} OR ${team})
        AND NOT EXISTS (SELECT 1 FROM enterprise_team_members profile_duplicate
          WHERE profile_duplicate.enterpriseId = profile_owner.enterpriseId AND profile_duplicate.userId = profile_owner.userId
            AND profile_duplicate.id <> profile_owner.id${suffix})
        AND NOT EXISTS (SELECT 1 FROM enterprise_team_members profile_reader_duplicate
          WHERE profile_reader_duplicate.enterpriseId = profile_reader.enterpriseId AND profile_reader_duplicate.userId = profile_reader.userId
            AND profile_reader_duplicate.id <> profile_reader.id${suffix})${suffix}))`;
}

/** Native ERP leadership alone must not elevate a delegated ordinary official member. */
export function channelTeamReader(scope: ChannelInventoryScope, access: { teamId?: number | null; teamRole?: string | null }): boolean {
  const proof = scope.officialActor?.inventoryPermissions?.channelProfileTeamRead;
  return scope.officialActor
    ? Boolean(access.teamId && proof?.ownerUserIds.includes(scope.actorUserId)
      && (proof.businessTeamLeaderRead !== true || (proof.ownerUserIds.length === 1 && access.teamRole === "leader")))
    : Boolean(access.teamId && access.teamRole === "leader");
}
