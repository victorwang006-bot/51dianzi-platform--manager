import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import type { TrpcContext } from "../_core/context";
import { loadOfficialAccess, officialActorFromContext } from "./officialChannelAccess";
import type { OfficialInventoryPermissions } from "../platformBusinessApi";

type Projection = NonNullable<OfficialInventoryPermissions["channelProfileTeamRead"]>;
function officialChannelProfileAuthorityRows(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error("INVALID_PROFILE_AUTHORITY_RESULT");
  return result[0];
}

/** Official and ERP teams are different identity domains. Only current explicit
 * staff bindings cross that boundary. Hold the actor's native authority locks
 * through the remote read. Peer bindings are a fresh issuance-time snapshot,
 * not historical inference; do not lock all peer accounts after the team lock
 * (member administration locks target account before team and could deadlock).
 * No permission, role, assignment, stock or historical record is written here. */
export async function withOfficialChannelProfileRead<T>(ctx: TrpcContext, staffUserId: number,
  run: (projection: Projection | undefined) => Promise<T>, allowUnassignedPublicRead = false): Promise<T> {
  const database = await getDb();
  if (!database) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "渠道档案团队权限暂时无法核实" });
  return database.transaction(async tx => {
    const access = await loadOfficialAccess(tx, officialActorFromContext(ctx), "officialInventory.read");
    if (!access.teamId && !access.isSuperAdmin && !allowUnassignedPublicRead) throw new TRPCError({ code: "FORBIDDEN", message: "当前后台账号未配置有效官方团队" });
    if (access.teamRole !== "leader" || !access.teamId) return run(undefined);
    const found = officialChannelProfileAuthorityRows(await tx.execute(sql`SELECT b.frontUserId AS ownerUserId
      FROM official_channel_team_members tm
      INNER JOIN official_channel_teams t ON t.id = tm.teamId AND t.status = 'active'
      INNER JOIN admin_users a ON a.id = tm.adminUserId AND a.status = 'active'
      INNER JOIN admin_business_staff_bindings b ON b.adminUserId = a.id AND b.status = 'active'
      WHERE tm.teamId = ${access.teamId} AND tm.role IN ('leader', 'member')
      ORDER BY b.frontUserId LIMIT 501`));
    const ownerUserIds = found.map(row => Number(row.ownerUserId));
    if (ownerUserIds.length > 500 || ownerUserIds.some(id => !Number.isSafeInteger(id) || id <= 0)
      || new Set(ownerUserIds).size !== ownerUserIds.length || !ownerUserIds.includes(staffUserId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "渠道档案团队或员工绑定已变化" });
    }
    return run({ ownerUserIds });
  });
}
