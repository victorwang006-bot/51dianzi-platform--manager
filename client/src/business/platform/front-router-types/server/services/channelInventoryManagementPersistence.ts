import { sql } from "drizzle-orm";
import { ChannelInventoryError, type ChannelInventoryScope, type SqlExecutor, type SqlResultRow } from "./channelInventory";
const rows = (result: unknown): SqlResultRow[] => Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) as SqlResultRow[] : [];
/** Sidecar absence means active. Never physically delete business stock or alter its sharing grants. */
export const activeChannelMaterial = sql`NOT EXISTS (SELECT 1 FROM channel_inventory_material_management deleted_material
  WHERE deleted_material.enterprise_id = m.enterprise_id AND deleted_material.material_id = m.id AND deleted_material.deleted_at IS NOT NULL)`;
export const activeUnaliasedChannelMaterial = sql`NOT EXISTS (SELECT 1 FROM channel_inventory_material_management deleted_material
  WHERE deleted_material.enterprise_id = channel_inventory_materials.enterprise_id AND deleted_material.material_id = channel_inventory_materials.id AND deleted_material.deleted_at IS NOT NULL)`;
export const materialUploadBatchId = sql`(SELECT batch_material.batch_id FROM channel_inventory_upload_batch_materials batch_material
  WHERE batch_material.enterprise_id = m.enterprise_id AND batch_material.material_id = m.id)`;

/** Must run after current authority and BEFORE row request replay, holding the batch until commit. */
export async function lockMaterialUploadBatch(tx: SqlExecutor, scope: ChannelInventoryScope, batchId: number | undefined, channelId: number) {
  if (batchId === undefined) return;
  if (!Number.isSafeInteger(batchId) || batchId <= 0) throw new ChannelInventoryError("BAD_REQUEST", "上传批次无效");
  const batch = rows(await tx.execute(sql`SELECT id, channel_id AS channelId, closed, archived, team_id AS teamId, owner_membership_id AS membershipId
    FROM channel_inventory_upload_batches WHERE id = ${batchId} AND enterprise_id = ${scope.enterpriseId}
      AND data_owner_user_id = ${scope.dataOwnerUserId} AND uploaded_by_user_id = ${scope.actorUserId}
      AND ${scope.officialActor ? sql`uploaded_by_admin_account_id = ${scope.officialActor.adminAccountId}` : sql`TRUE`} LIMIT 1 FOR UPDATE`))[0];
  if (!batch || Number(batch.channelId) !== channelId) throw new ChannelInventoryError("FORBIDDEN", "上传批次不存在或不可使用");
  if (Number(batch.closed) === 1) throw new ChannelInventoryError("CONFLICT", "上传批次已关闭，请创建新批次");
  const member = rows(await tx.execute(sql`SELECT tm.id FROM enterprise_team_members tm INNER JOIN enterprise_teams t
    ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
    WHERE tm.enterpriseId = ${scope.enterpriseId} AND tm.userId = ${scope.actorUserId} AND tm.teamId = ${Number(batch.teamId)}
      AND tm.id = ${Number(batch.membershipId)} AND tm.teamRole IN ('leader', 'member') FOR UPDATE`));
  if (member.length !== 1) throw new ChannelInventoryError("FORBIDDEN", "上传批次团队归属已变化");
}
export async function recordMaterialUploadBatch(tx: SqlExecutor, scope: ChannelInventoryScope, batchId: number | undefined, materialId: number, channelId: number, revision: number, assignment: SqlResultRow, membershipId: number) {
  if (batchId === undefined) return;
  const count = rows(await tx.execute(sql`SELECT COUNT(*) AS total FROM channel_inventory_upload_batch_materials
    WHERE enterprise_id = ${scope.enterpriseId} AND batch_id = ${batchId} FOR UPDATE`))[0];
  const batch = rows(await tx.execute(sql`SELECT total_rows AS totalRows, team_id AS teamId, owner_membership_id AS membershipId
    FROM channel_inventory_upload_batches WHERE id = ${batchId} AND enterprise_id = ${scope.enterpriseId} FOR UPDATE`))[0];
  if (!batch || Number(count?.total ?? 0) >= Math.min(1000, Number(batch.totalRows))) throw new ChannelInventoryError("CONFLICT", "上传批次已达到行数上限");
  if (Number(batch.teamId) !== Number(assignment.teamId) || Number(batch.membershipId) !== membershipId) throw new ChannelInventoryError("CONFLICT", "上传批次归属已变化");
  await tx.execute(sql`INSERT INTO channel_inventory_upload_batch_materials
    (enterprise_id, batch_id, material_id, initial_revision, initial_channel_id, initial_owner_user_id,
      initial_assignment_id, initial_assignment_revision, initial_team_id, initial_membership_id, initial_share_revision)
    VALUES (${scope.enterpriseId}, ${batchId}, ${materialId}, ${revision}, ${channelId}, ${scope.actorUserId},
      ${Number(assignment.id)}, ${Number(assignment.revision)}, ${Number(assignment.teamId)}, ${membershipId}, 1)`);
  // Batch membership is part of the deletion preview CAS fence.
  await tx.execute(sql`UPDATE channel_inventory_upload_batches SET revision = revision + 1
    WHERE id = ${batchId} AND enterprise_id = ${scope.enterpriseId}`);
}
