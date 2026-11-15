import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import type { TrpcContext } from "../_core/context";
import { loadOfficialAccess, officialActorFromContext } from "./officialChannelAccess";
import type { OfficialInventoryPermissions } from "../platformBusinessApi";
import { channelMaterialManagementSchema } from "../../shared/internalBusinessOfficialInventory";
type Projection = NonNullable<OfficialInventoryPermissions["channelProfileTeamRead"]>;
type Management = NonNullable<OfficialInventoryPermissions["channelMaterialManagement"]>;
function officialChannelProfileAuthorityRows(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("INVALID_PROFILE_AUTHORITY_RESULT");
  return result[0];
}
/** Hold actor account/team locks through remote work. Peers are issuance-time
 * snapshots, not historical attribution; never lock peers after the team lock
 * (administration locks account -> team). This helper never writes data. */
export async function withOfficialChannelProfileRead<T>(ctx: TrpcContext, staffUserId: number,
  run: (projection: Projection | undefined, management?: Management) => Promise<T>, allowUnassignedPublicRead = false): Promise<T> {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "渠道档案团队权限暂时无法核实" });
  return database.transaction(async tx => {
    const access = await loadOfficialAccess(tx, officialActorFromContext(ctx), "officialInventory.read");
    // Any retirement receipt closes access, exactly like the peer archive rule.
    // loadOfficialAccess already locked the actor account; keep this current read
    // before every super-admin/member/unassigned early-return and remote signing.
    const archivedActor = officialChannelProfileAuthorityRows(await tx.execute(sql`SELECT archived.id FROM admin_staff_archives archived
      WHERE archived.adminUserId = ${access.adminUserId} LIMIT 1 FOR UPDATE`));
    if (archivedActor.length) throw new TRPCError({ code: "FORBIDDEN", message: "后台工作人员已归档" });
    if (!access.teamId && !access.isSuperAdmin && !allowUnassignedPublicRead) throw new TRPCError({ code: "FORBIDDEN", message: "当前后台账号未配置有效官方团队" });
    if (!Number.isSafeInteger(staffUserId) || staffUserId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "渠道档案员工绑定已变化" });
    const superRead = access.isSuperAdmin ? { ownerUserIds: [staffUserId], businessTeamLeaderRead: true as const } : undefined;
    // Super-admin identity alone retains ONLY the old actor-bound read proof.
    // Even super admins need an actual active official leader membership here.
    if (access.teamRole !== "leader" || !access.teamId) return run(superRead);
    const found = officialChannelProfileAuthorityRows(await tx.execute(sql`SELECT b.frontUserId AS ownerUserId, a.id AS recorderAdminAccountId
      FROM official_channel_team_members tm
      INNER JOIN official_channel_teams t ON t.id = tm.teamId AND t.status = 'active'
      INNER JOIN admin_users a ON a.id = tm.adminUserId AND a.status = 'active'
      INNER JOIN admin_business_staff_bindings b ON b.adminUserId = a.id AND b.status = 'active'
      WHERE tm.teamId = ${access.teamId} AND tm.role IN ('leader', 'member')
        AND NOT EXISTS (SELECT 1 FROM admin_staff_archives archived WHERE archived.adminUserId = a.id)
        AND NOT EXISTS (SELECT 1 FROM official_channel_team_members duplicate_tm
          INNER JOIN official_channel_teams duplicate_t ON duplicate_t.id = duplicate_tm.teamId AND duplicate_t.status = 'active'
          WHERE duplicate_tm.adminUserId = a.id AND duplicate_tm.id <> tm.id)
        AND NOT EXISTS (SELECT 1 FROM admin_business_staff_bindings duplicate_b
          WHERE duplicate_b.status = 'active' AND duplicate_b.id <> b.id
            AND (duplicate_b.adminUserId = b.adminUserId OR duplicate_b.frontUserId = b.frontUserId))
      ORDER BY b.frontUserId LIMIT 501`));
    const ownerUserIds = found.map(row => Number(row.ownerUserId));
    const parsed = channelMaterialManagementSchema.safeParse({ leaderAdminAccountId: access.adminUserId,
      recorderBindings: found.map(row => ({ adminAccountId: Number(row.recorderAdminAccountId), staffUserId: Number(row.ownerUserId) })) });
    if (!parsed.success || !ownerUserIds.includes(staffUserId)
      || !parsed.data.recorderBindings.some(row => row.adminAccountId === access.adminUserId && row.staffUserId === staffUserId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "渠道档案团队或员工绑定已变化" });
    }
    const management = access.permissions.includes("officialInventory.write") ? parsed.data : undefined;
    return run(superRead ?? { ownerUserIds }, management);
  });
}
