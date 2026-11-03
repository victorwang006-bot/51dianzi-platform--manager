import { sql, type SQL } from "drizzle-orm";
import { businessFailureOf } from "../../../shared/businessFailure";
import { officialMaterialCreator } from "./channelInventoryOriginalActor";
import { TRPCError } from "@trpc/server";
import { ChannelInventoryError, type ChannelInventoryScope, type SqlDatabase } from "./channelInventory";
import { resolveTeamInventoryVisibility, TEAM_MATERIAL_FROM, teamInventoryAll, teamInventoryRows } from "./channelTeamInventoryAccess";
import { teamMaterialSourceSchema, type TeamMaterialSourceInput, type TeamMaterialSource } from "../../../shared/channelInventorySource";

export const SOURCE_FORBIDDEN_MESSAGE = "暂无权限查看";
/** Correlated to m. Caller MUST first enforce existing row visibility and stocks
 * read authority. Official-staff evidence does not replace current effective
 * membership of the material's team. The legacy front creator branch retains
 * its pre-existing identity rule; neither branch infers creator from owner.
 * lock=true makes each authority subquery a current read, even with an RR view.
 */
export function teamMaterialSourceEligibility(scope: ChannelInventoryScope, lock = false, leaderOnly = false): SQL {
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const creator = scope.officialActor ? sql`(${officialMaterialCreator(scope, lock)}
    AND EXISTS (SELECT 1 FROM enterprise_team_members original_reader
      INNER JOIN enterprise_teams original_team ON original_team.enterpriseId = original_reader.enterpriseId
       AND original_team.id = original_reader.teamId AND original_team.status = 'active'
      WHERE original_reader.enterpriseId = source_a.enterpriseId AND original_reader.teamId = source_a.teamId
       AND original_reader.userId = ${scope.actorUserId} AND original_reader.teamRole IN ('leader', 'member')${suffix}))`
    : sql`source_a.createdByUserId = ${scope.actorUserId}`;
  return sql`EXISTS (SELECT 1 FROM enterprise_team_record_assignments source_a
    WHERE source_a.enterpriseId = m.enterprise_id AND source_a.recordType = 'channel_material'
      AND source_a.recordId = m.id
      AND (${leaderOnly ? sql`FALSE` : creator} OR (
        source_a.currentOwnerUserId = m.responsible_user_id AND source_a.revision >= 1
        AND EXISTS (SELECT 1 FROM enterprise_teams source_t
          INNER JOIN enterprise_team_members source_owner ON source_owner.enterpriseId = source_t.enterpriseId
            AND source_owner.teamId = source_t.id AND source_owner.userId = source_a.currentOwnerUserId
            AND source_owner.teamRole IN ('leader', 'member')
          INNER JOIN enterprise_team_members source_reader ON source_reader.enterpriseId = source_t.enterpriseId
            AND source_reader.teamId = source_t.id AND source_reader.userId = ${scope.actorUserId}
            AND source_reader.teamRole = 'leader'
          WHERE source_t.enterpriseId = source_a.enterpriseId AND source_t.id = source_a.teamId AND source_t.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM enterprise_team_members duplicate_reader
              INNER JOIN enterprise_teams duplicate_team ON duplicate_team.enterpriseId = duplicate_reader.enterpriseId
                AND duplicate_team.id = duplicate_reader.teamId AND duplicate_team.status = 'active'
              WHERE duplicate_reader.enterpriseId = source_reader.enterpriseId
                AND duplicate_reader.userId = source_reader.userId AND duplicate_reader.id <> source_reader.id${suffix})${suffix})
      ))${suffix})`;
}

export function createChannelInventorySourceService({ getDb }: { getDb: () => Promise<SqlDatabase | null> }) {
  return {
    async getTeamMaterialSource(scope: ChannelInventoryScope, raw: TeamMaterialSourceInput): Promise<TeamMaterialSource> {
      const parsed = teamMaterialSourceSchema.safeParse(raw);
      if (!parsed.success) throw new ChannelInventoryError("BAD_REQUEST", "来源查询参数无效");
      const input = parsed.data;
      if ((input.expectedEnterpriseId !== undefined && input.expectedEnterpriseId !== scope.enterpriseId)
        || (input.expectedActorUserId !== undefined && input.expectedActorUserId !== scope.actorUserId)) {
        throw new ChannelInventoryError("FORBIDDEN", SOURCE_FORBIDDEN_MESSAGE);
      }
      const db = await getDb();
      if (!db) throw new ChannelInventoryError("INTERNAL_SERVER_ERROR", "渠道库存服务暂不可用，请稍后重试");
      try {
        // Logical read-only transaction. No audit DML or creator backfill.
        return await db.transaction(async tx => {
          const visibility = await resolveTeamInventoryVisibility(tx, scope, { lock: true, materialId: input.materialId });
          const found = teamInventoryRows(await tx.execute(sql`SELECT c.name ${TEAM_MATERIAL_FROM}
            WHERE ${teamInventoryAll([...visibility.predicates, teamMaterialSourceEligibility(scope, true)])}
            LIMIT 1 FOR UPDATE`))[0];
          if (!found) throw new ChannelInventoryError("FORBIDDEN", SOURCE_FORBIDDEN_MESSAGE);
          return { name: String(found.name) };
        });
      } catch (error) {
        if (businessFailureOf(error) && businessFailureOf(error) !== "BUSINESS_RESOURCE_FORBIDDEN") throw error;
        if (error instanceof TRPCError && error.code === "UNAUTHORIZED") throw error;
        if ((error instanceof ChannelInventoryError || error instanceof TRPCError)
          && ["FORBIDDEN", "NOT_FOUND"].includes(error.code)) {
          throw new ChannelInventoryError("FORBIDDEN", SOURCE_FORBIDDEN_MESSAGE);
        }
        if (error instanceof ChannelInventoryError) throw error;
        throw new ChannelInventoryError("INTERNAL_SERVER_ERROR", "渠道库存服务暂不可用，请稍后重试");
      }
    },
  };
}
