import { sql, type SQL } from "drizzle-orm";
import type { ChannelInventoryScope, SqlResultRow } from "./channelInventory";
import { originalActorClaims, officialMaterialCreator, officialMaterialRecorderAdminAccountId } from "./channelInventoryOriginalActor";
import { channelMaterialManagementSchema } from "../../../../../../../shared/internalBusinessOfficialInventory";
import { resolveTeamInventoryVisibility, TEAM_MATERIAL_FROM } from "./channelTeamInventoryAccess";
import { linkedCompanyReadGate } from "./customerSupplyCompany";
import { ChannelInventoryError, type SqlExecutor } from "./channelInventory";

/** Same immutable evidence validator; additionally reject ambiguous technical staff
 * identities for a single backend recorder. No present-day binding inference. */
export function officialMaterialRecorderStaffUserId(lock = false): SQL {
  const { original, conflict } = originalActorClaims();
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const staff = (alias: string) => sql`JSON_UNQUOTE(COALESCE(JSON_EXTRACT(${sql.raw(alias)}.after_data, '$.officialActor.staffUserId'), JSON_EXTRACT(${sql.raw(alias)}.after_data, '$.legacyOriginalActor.staffUserId')))`;
  return sql`(SELECT CAST(${staff("original_event")} AS UNSIGNED) FROM channel_inventory_material_share_audits original_event
    WHERE ${original.correlated} AND ${original.valid}
      AND NOT EXISTS (SELECT 1 FROM channel_inventory_material_share_audits conflicting_event
        WHERE ${conflict.correlated} AND ${conflict.candidate}
          AND ((${conflict.valid}) IS NOT TRUE OR BINARY ${conflict.admin} <> BINARY ${original.admin}
            OR BINARY ${staff("conflicting_event")} <> BINARY ${staff("original_event")})${suffix})
    LIMIT 1${suffix})`;
}

/** Called only after live enterprise/member/stocks-read authorization. This is
 * the SAME predicate for source DTO, edit SELECT and update authorization. It
 * never interprets current ownership, display names or read-only team proofs as
 * creation evidence. Existing immutable audit validation is reused unchanged. */
export function teamMaterialManagementEligibility(scope: ChannelInventoryScope, lock = false): SQL {
  const actor = scope.officialActor;
  const permissions = actor?.inventoryPermissions;
  if (actor && (permissions?.read !== true || permissions.write !== true || permissions.inventoryScopeWrite !== true
    || !Number.isSafeInteger(actor.adminAccountId) || actor.adminAccountId <= 0)) return sql`FALSE`;
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  let leader: SQL = sql`FALSE`;
  if (actor) {
    const parsed = channelMaterialManagementSchema.safeParse(permissions?.channelMaterialManagement);
    if (parsed.success && parsed.data.leaderAdminAccountId === actor.adminAccountId
      && parsed.data.recorderBindings.some(row => row.adminAccountId === actor.adminAccountId && row.staffUserId === scope.actorUserId)) {
      const recorder = officialMaterialRecorderAdminAccountId(lock);
      leader = sql`(${sql.join(parsed.data.recorderBindings.map(binding => sql`(${recorder} = ${binding.adminAccountId}
        AND EXISTS (SELECT 1 FROM enterprise_team_members managed_recorder
          INNER JOIN enterprise_members recorder_em ON recorder_em.enterpriseId = managed_recorder.enterpriseId
            AND recorder_em.userId = managed_recorder.userId AND recorder_em.status = 'active'
          INNER JOIN users recorder_u ON recorder_u.id = recorder_em.userId AND recorder_u.loginDisabled = 0
          WHERE managed_recorder.enterpriseId = management_a.enterpriseId AND managed_recorder.teamId = management_a.teamId
            AND managed_recorder.userId = ${binding.staffUserId} AND managed_recorder.teamRole IN ('leader', 'member')
            AND NOT EXISTS (SELECT 1 FROM enterprise_team_members recorder_duplicate
              WHERE recorder_duplicate.enterpriseId = managed_recorder.enterpriseId AND recorder_duplicate.userId = managed_recorder.userId
                AND recorder_duplicate.id <> managed_recorder.id${suffix})${suffix}))`), sql` OR `)})`;
    }
  } else {
    // Native front path retains actual creation identity, never responsible_user_id.
    leader = sql`management_reader.teamRole = 'leader' AND EXISTS (SELECT 1 FROM enterprise_team_members managed_recorder
      WHERE managed_recorder.enterpriseId = management_a.enterpriseId AND managed_recorder.teamId = management_a.teamId
        AND managed_recorder.userId = management_a.createdByUserId AND managed_recorder.teamRole IN ('leader', 'member')${suffix})`;
  }
  const businessLeaderProof = permissions?.materialBusinessTeamLeaderWrite;
  if (actor && businessLeaderProof?.adminAccountId === actor.adminAccountId && businessLeaderProof.staffUserId === scope.actorUserId) {
    const businessLeader = sql`(management_reader.teamRole = 'leader' AND EXISTS (SELECT 1 FROM enterprise_team_members managed_recorder
      INNER JOIN enterprise_members recorder_em ON recorder_em.enterpriseId = managed_recorder.enterpriseId
        AND recorder_em.userId = managed_recorder.userId AND recorder_em.status = 'active'
      INNER JOIN users recorder_u ON recorder_u.id = recorder_em.userId AND recorder_u.loginDisabled = 0
      WHERE managed_recorder.enterpriseId = management_a.enterpriseId AND managed_recorder.teamId = management_a.teamId
        AND managed_recorder.userId = ${officialMaterialRecorderStaffUserId(lock)} AND managed_recorder.teamRole IN ('leader', 'member')
        AND NOT EXISTS (SELECT 1 FROM enterprise_team_members recorder_duplicate
          WHERE recorder_duplicate.enterpriseId = managed_recorder.enterpriseId AND recorder_duplicate.userId = managed_recorder.userId
            AND recorder_duplicate.id <> managed_recorder.id${suffix})${suffix}))`;
    leader = sql`(${leader} OR ${businessLeader})`;
  }
  const creator = actor ? officialMaterialCreator(scope, lock) : sql`management_a.createdByUserId = ${scope.actorUserId}`;
  // Match resolveBusinessModuleAccess's current stocks scope, never a signed
  // scope: absent setting defaults to team only inside the valid-team joins
  // below; enterprise/self/invalid settings cannot grant cross-recorder access.
  const leaderTeamScope = sql`COALESCE((SELECT CASE
      WHEN BINARY management_access.dataScope = BINARY 'team' AND management_access.revision >= 1
        AND management_access.revision = FLOOR(management_access.revision)
        AND management_access.revision <= 9007199254740991 THEN 'team' ELSE 'self' END
    FROM enterprise_member_module_access management_access
    WHERE management_access.enterpriseId = ${scope.enterpriseId}
      AND management_access.userId = ${scope.actorUserId} AND management_access.module = 'stocks'
    ORDER BY management_access.revision DESC, management_access.id DESC LIMIT 1${suffix}), 'team') = 'team'`;
  return sql`(m.enterprise_id = ${scope.enterpriseId} AND m.data_owner_user_id = ${scope.dataOwnerUserId} AND c.active = 1
    AND EXISTS (SELECT 1 FROM enterprise_team_record_assignments management_a
      INNER JOIN enterprise_teams management_t ON management_t.enterpriseId = management_a.enterpriseId
        AND management_t.id = management_a.teamId AND management_t.status = 'active'
      INNER JOIN enterprise_team_members management_reader ON management_reader.enterpriseId = management_a.enterpriseId
        AND management_reader.teamId = management_a.teamId AND management_reader.userId = ${scope.actorUserId}
        AND management_reader.teamRole IN ('leader', 'member')
      INNER JOIN enterprise_team_members management_owner ON management_owner.enterpriseId = management_a.enterpriseId
        AND management_owner.teamId = management_a.teamId AND management_owner.userId = management_a.currentOwnerUserId
        AND management_owner.teamRole IN ('leader', 'member')
      INNER JOIN enterprise_members owner_em ON owner_em.enterpriseId = management_owner.enterpriseId
        AND owner_em.userId = management_owner.userId AND owner_em.status = 'active'
      INNER JOIN users owner_u ON owner_u.id = owner_em.userId AND owner_u.loginDisabled = 0
      WHERE management_a.enterpriseId = m.enterprise_id AND management_a.recordType = 'channel_material'
        AND management_a.recordId = m.id AND management_a.currentOwnerUserId = m.responsible_user_id AND management_a.revision >= 1
        AND NOT EXISTS (SELECT 1 FROM enterprise_team_members reader_duplicate
          WHERE reader_duplicate.enterpriseId = management_reader.enterpriseId AND reader_duplicate.userId = management_reader.userId
            AND reader_duplicate.id <> management_reader.id${suffix})
        AND NOT EXISTS (SELECT 1 FROM enterprise_team_members owner_duplicate
          WHERE owner_duplicate.enterpriseId = management_owner.enterpriseId AND owner_duplicate.userId = management_owner.userId
            AND owner_duplicate.id <> management_owner.id${suffix})
        AND (${creator} OR (${leaderTeamScope} AND (${leader})))${suffix}))`;
}

export function materialManagementProjection(row: SqlResultRow, canWrite: boolean, company: { linked: boolean; customer: SqlResultRow | null }) {
  const qualified = row.canManageMaterial === true || row.canManageMaterial === 1 || row.canManageMaterial === "1";
  const customer = company.customer;
  const matched = customer !== null && Number.isSafeInteger(Number(customer.id)) && Number(customer.id) > 0
    && typeof customer.name === "string" && customer.name.trim().length > 0;
  const canEditMaterial = canWrite && qualified && (!company.linked || matched);
  const customerSource = canEditMaterial && company.linked && matched ? { id: Number(customer!.id), name: String(customer!.name) } : null;
  return { canEditMaterial, canEdit: canEditMaterial, readOnly: !canEditMaterial, canViewCustomerSource: canEditMaterial,
    customerSource, customerSourceState: !canEditMaterial ? "restricted" as const : company.linked ? "matched" as const : "unlinked" as const };
}

/** Host channel picker/profile reads may retain unlinked legacy profiles, but a
 * confirmed customer's name/contacts require at least one currently editable
 * material. Apply BEFORE search/count/detail selection to avoid a name oracle. */
export async function channelCustomerMaterialReadGate(tx: SqlExecutor, scope: ChannelInventoryScope): Promise<SQL> {
  const unlinked = sql`NOT EXISTS (SELECT 1 FROM crm_customer_supply_channels profile_link
    WHERE profile_link.enterpriseId = channel_inventory_channels.enterprise_id
      AND profile_link.dataOwnerUserId = channel_inventory_channels.data_owner_user_id
      AND profile_link.channelId = channel_inventory_channels.id FOR UPDATE)`;
  let visibility;
  try { visibility = await resolveTeamInventoryVisibility(tx, scope, { lock: true }); }
  catch (error) {
    if (error instanceof ChannelInventoryError && error.code === "FORBIDDEN") return unlinked;
    throw error;
  }
  if (!visibility.access.write) return unlinked;
  return sql`(${unlinked} OR EXISTS (SELECT 1 ${TEAM_MATERIAL_FROM}
    WHERE c.id = channel_inventory_channels.id
      AND ${sql.join([...visibility.predicates, teamMaterialManagementEligibility(scope, true), await linkedCompanyReadGate(tx, scope)], sql` AND `)}
      AND EXISTS (SELECT 1 FROM crm_customer_supply_channels profile_match
        INNER JOIN crm_customers profile_customer ON profile_customer.enterpriseId = profile_match.enterpriseId AND profile_customer.id = profile_match.customerId
        WHERE profile_match.enterpriseId = c.enterprise_id AND profile_match.dataOwnerUserId = c.data_owner_user_id AND profile_match.channelId = c.id
          AND profile_customer.id > 0 AND LENGTH(TRIM(profile_customer.name)) > 0 FOR UPDATE) FOR UPDATE))`;
}
