import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import * as schemas from "../../../shared/channelInventoryManagement";
import { ChannelInventoryError, channelInventoryPayloadHash, type ChannelInventoryScope, type SqlDatabase, type SqlExecutor, type SqlResultRow } from "./channelInventory";
import { resolveTeamInventoryVisibility, TEAM_MATERIAL_FROM, teamInventoryAll as all, teamInventoryRows as rows } from "./channelTeamInventoryAccess";
import { activeChannelMaterial, materialUploadBatchId } from "./channelInventoryManagementPersistence";
import { linkedCompany, linkedCompanyReadGate } from "./customerSupplyCompany";

export const MATERIAL_MANAGEMENT_SKIP_REASON = "库存不存在、权限或版本已变化，请刷新后重试";
const bool = (value: unknown) => value === true || value === 1 || value === "1";
const fail = (code: ConstructorParameters<typeof ChannelInventoryError>[0], message: string): never => { throw new ChannelInventoryError(code, message); };
const unavailable = () => fail("NOT_FOUND", "资源不存在或无权管理");
const conflict = () => fail("CONFLICT", "数据已变化，请刷新后重试");
const header = (result: unknown) => (Array.isArray(result) ? result[0] : result) as SqlResultRow;
const changed = (result: unknown) => Number(header(result)?.affectedRows ?? 0) === 1;
function parse<S extends z.ZodType>(schema: S, raw: unknown, scope: ChannelInventoryScope): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) return fail("BAD_REQUEST", result.error.issues[0]?.message ?? "请求字段无效");
  const input = result.data as { expectedEnterpriseId?: number; expectedActorUserId?: number };
  if ((input.expectedEnterpriseId !== undefined && input.expectedEnterpriseId !== scope.enterpriseId)
    || (input.expectedActorUserId !== undefined && input.expectedActorUserId !== scope.actorUserId)) fail("FORBIDDEN", "企业或账号上下文不匹配");
  return result.data;
}
async function writable(tx: SqlExecutor, scope: ChannelInventoryScope) {
  const visibility = await resolveTeamInventoryVisibility(tx, scope, { lock: true, includeDeleted: true });
  if (!visibility.access.write) fail("FORBIDDEN", "当前账号没有库存写权限");
  return visibility;
}
/** Same live visibility and leader/isMine rule as existing collaboration editing, including CRM link gate. */
async function manageableMaterial(tx: SqlExecutor, scope: ChannelInventoryScope, id: number) {
  const visibility = await resolveTeamInventoryVisibility(tx, scope, { lock: true, materialId: id, includeDeleted: true });
  const row = rows(await tx.execute(sql`SELECT m.id, m.channel_id AS channelId, m.revision,
    (m.responsible_user_id = ${scope.actorUserId}) AS isMine, dm.deleted_at AS deletedAt
    ${TEAM_MATERIAL_FROM} LEFT JOIN channel_inventory_material_management dm ON dm.enterprise_id = m.enterprise_id AND dm.material_id = m.id
    WHERE ${all(visibility.predicates)} LIMIT 1 FOR UPDATE`))[0];
  if (!row || !visibility.access.write || (!bool(row.isMine) && !visibility.leader)) unavailable();
  const company = await linkedCompany(tx, scope, Number(row.channelId));
  if (company.linked && !company.customer) unavailable();
  return row;
}
async function softDelete(tx: SqlExecutor, scope: ChannelInventoryScope, id: number, revision: number, requestId: string) {
  const result = await tx.execute(sql`UPDATE channel_inventory_materials SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${id} AND enterprise_id = ${scope.enterpriseId} AND data_owner_user_id = ${scope.dataOwnerUserId} AND revision = ${revision}
      AND NOT EXISTS (SELECT 1 FROM channel_inventory_material_management dm WHERE dm.enterprise_id = ${scope.enterpriseId}
        AND dm.material_id = ${id} AND dm.deleted_at IS NOT NULL)`);
  if (!changed(result)) return false;
  await tx.execute(sql`INSERT INTO channel_inventory_material_management (enterprise_id, material_id, deleted_at, deleted_by_user_id, delete_request_id)
    VALUES (${scope.enterpriseId}, ${id}, CURRENT_TIMESTAMP(3), ${scope.actorUserId}, ${requestId})
    ON DUPLICATE KEY UPDATE deleted_at = CURRENT_TIMESTAMP(3), deleted_by_user_id = ${scope.actorUserId}, delete_request_id = ${requestId}`);
  return true;
}
/** Source-bearing batch metadata remains current-responsible private, never expanded by enterprise/leader labels. */
async function ownBatch(tx: SqlExecutor, scope: ChannelInventoryScope, id: number) {
  const row = rows(await tx.execute(sql`SELECT b.id, b.revision, b.closed, b.archived, b.channel_id AS channelId,
    b.team_id AS teamId, b.owner_membership_id AS membershipId
    FROM channel_inventory_upload_batches b INNER JOIN channel_inventory_channels c ON c.id = b.channel_id
      AND c.enterprise_id = b.enterprise_id AND c.data_owner_user_id = b.data_owner_user_id
    WHERE b.id = ${id} AND b.enterprise_id = ${scope.enterpriseId} AND b.data_owner_user_id = ${scope.dataOwnerUserId}
      AND b.uploaded_by_user_id = ${scope.actorUserId} AND ${scope.officialActor ? sql`b.uploaded_by_admin_account_id = ${scope.officialActor.adminAccountId}` : sql`TRUE`} AND c.responsible_user_id = ${scope.actorUserId}
      AND ${await linkedCompanyReadGate(tx, scope)} LIMIT 1 FOR UPDATE`))[0];
  if (!row) unavailable();
  const member = rows(await tx.execute(sql`SELECT tm.id FROM enterprise_team_members tm INNER JOIN enterprise_teams t
    ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
    WHERE tm.enterpriseId = ${scope.enterpriseId} AND tm.userId = ${scope.actorUserId} AND tm.id = ${Number(row.membershipId)}
      AND tm.teamId = ${Number(row.teamId)} AND tm.teamRole IN ('leader', 'member') FOR UPDATE`));
  if (member.length !== 1) unavailable();
  return row;
}
const batchCurrentMembership = (scope: ChannelInventoryScope) => sql`EXISTS (SELECT 1 FROM enterprise_team_members batch_tm
  INNER JOIN enterprise_teams batch_t ON batch_t.id = batch_tm.teamId AND batch_t.enterpriseId = batch_tm.enterpriseId AND batch_t.status = 'active'
  WHERE batch_tm.enterpriseId = b.enterprise_id AND batch_tm.userId = ${scope.actorUserId} AND batch_tm.id = b.owner_membership_id
    AND batch_tm.teamId = b.team_id AND batch_tm.teamRole IN ('leader', 'member') FOR UPDATE)`;
const BATCH_FROM = sql`FROM channel_inventory_upload_batches b INNER JOIN channel_inventory_channels c
  ON c.id = b.channel_id AND c.enterprise_id = b.enterprise_id AND c.data_owner_user_id = b.data_owner_user_id`;
/** All exact persistent associations count as total; inaccessible/transferred/changed/deleted rows count as conflicts. */
async function batchCandidates(tx: SqlExecutor, scope: ChannelInventoryScope, batchId: number) {
  const visibility = await writable(tx, scope);
  const links = rows(await tx.execute(sql`SELECT material_id AS id FROM channel_inventory_upload_batch_materials
    WHERE enterprise_id = ${scope.enterpriseId} AND batch_id = ${batchId} ORDER BY material_id ASC LIMIT 1001 FOR UPDATE`));
  if (links.length > 1000) fail("PRECONDITION_FAILED", "批次超过1000条关联上限，未删除任何库存");
  const candidates = rows(await tx.execute(sql`SELECT m.id, m.revision ${TEAM_MATERIAL_FROM}
    INNER JOIN channel_inventory_upload_batch_materials bm ON bm.enterprise_id = m.enterprise_id AND bm.material_id = m.id
    INNER JOIN enterprise_team_record_assignments a ON a.enterpriseId = m.enterprise_id AND a.recordType = 'channel_material' AND a.recordId = m.id
    INNER JOIN channel_inventory_material_shares s ON s.enterprise_id = m.enterprise_id AND s.material_id = m.id
    INNER JOIN enterprise_team_members tm ON tm.enterpriseId = m.enterprise_id AND tm.userId = m.responsible_user_id
      AND tm.id = bm.initial_membership_id AND tm.teamId = bm.initial_team_id
    INNER JOIN enterprise_teams t ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
    WHERE ${all([...visibility.predicates, activeChannelMaterial, await linkedCompanyReadGate(tx, scope)])}
      AND ${visibility.leader ? sql`TRUE` : sql`m.responsible_user_id = ${scope.actorUserId}`}
      AND bm.batch_id = ${batchId} AND m.revision = bm.initial_revision AND m.channel_id = bm.initial_channel_id
      AND m.responsible_user_id = bm.initial_owner_user_id AND a.id = bm.initial_assignment_id
      AND a.revision = bm.initial_assignment_revision AND a.teamId = bm.initial_team_id AND a.currentOwnerUserId = bm.initial_owner_user_id
      AND s.revision = bm.initial_share_revision AND s.enabled = 1 AND s.owner_membership_id = bm.initial_membership_id
      AND s.assignment_revision = bm.initial_assignment_revision AND s.share_team_id = bm.initial_team_id AND s.owner_user_id = bm.initial_owner_user_id
      AND tm.teamRole IN ('leader', 'member')
      AND NOT EXISTS (SELECT 1 FROM channel_inventory_collaboration_notes cn WHERE cn.enterpriseId = m.enterprise_id AND cn.materialId = m.id FOR UPDATE)
      AND NOT EXISTS (SELECT 1 FROM channel_inventory_notes ln WHERE ln.enterpriseId = m.enterprise_id AND ln.materialId = m.id FOR UPDATE)
    ORDER BY m.id ASC FOR UPDATE`));
  return { total: links.length, candidates };
}

export function createChannelInventoryManagementService({ getDb }: { getDb: () => Promise<SqlDatabase | null> }) {
  async function transaction<T>(run: (tx: SqlExecutor) => Promise<T>) {
    const db = await getDb(); if (!db) return fail("INTERNAL_SERVER_ERROR", "库存管理服务暂不可用");
    try { return await db.transaction(run); }
    catch (error) { if (error instanceof ChannelInventoryError) throw error; return fail("INTERNAL_SERVER_ERROR", "库存管理服务暂不可用，请稍后重试"); }
  }
  async function mutation<T>(scope: ChannelInventoryScope, input: { requestId: string; expectedEnterpriseId?: number; expectedActorUserId?: number }, action: string,
    run: (tx: SqlExecutor) => Promise<T>, replayFence: (tx: SqlExecutor, result: T) => Promise<unknown>) {
    const { requestId, expectedEnterpriseId: _e, expectedActorUserId: _a, ...payload } = input;
    const hash = channelInventoryPayloadHash({ action, ...payload });
    return transaction(async tx => {
      await writable(tx, scope);
      const prior = rows(await tx.execute(sql`SELECT action, payload_hash AS payloadHash, result_data AS resultData
        FROM channel_inventory_management_requests WHERE enterprise_id = ${scope.enterpriseId} AND data_owner_user_id = ${scope.dataOwnerUserId}
          AND actor_user_id = ${scope.actorUserId} AND request_id = ${requestId} LIMIT 1 FOR UPDATE`))[0];
      if (prior) {
        if (String(prior.action) !== action || String(prior.payloadHash) !== hash) fail("CONFLICT", "请求号已用于不同的管理操作");
        const result: T = typeof prior.resultData === "string" ? JSON.parse(prior.resultData) : prior.resultData as T;
        await replayFence(tx, result);
        return result;
      }
      const result = await run(tx);
      await tx.execute(sql`INSERT INTO channel_inventory_management_requests
        (enterprise_id, data_owner_user_id, actor_user_id, request_id, action, payload_hash, result_data)
        VALUES (${scope.enterpriseId}, ${scope.dataOwnerUserId}, ${scope.actorUserId}, ${requestId}, ${action}, ${hash}, ${JSON.stringify(result)})`);
      return result;
    });
  }
  return {
    async deleteMaterials(scope: ChannelInventoryScope, raw: schemas.DeleteMaterialsInput): Promise<schemas.DeleteMaterialsResult> {
      const input = parse(schemas.deleteMaterialsSchema, raw, scope);
      return mutation(scope, input, "deleteMaterials", async tx => {
        const results: schemas.DeleteMaterialsResult["results"] = [];
        // Stable lock ordering without changing the user-visible result ordering.
        const outcomes = new Map<number, boolean>();
        for (const item of [...input.items].sort((a, b) => a.id - b.id)) {
          let current: SqlResultRow;
          try { current = await manageableMaterial(tx, scope, item.id); }
          catch (error) {
            if (error instanceof ChannelInventoryError && ["NOT_FOUND", "FORBIDDEN"].includes(error.code)) { outcomes.set(item.id, false); continue; }
            throw error;
          }
          if (current.deletedAt != null || Number(current.revision) !== item.expectedRevision) { outcomes.set(item.id, false); continue; }
          outcomes.set(item.id, await softDelete(tx, scope, item.id, item.expectedRevision, input.requestId));
        }
        for (const item of input.items) results.push(outcomes.get(item.id) ? { id: item.id, success: true } : { id: item.id, success: false, reason: MATERIAL_MANAGEMENT_SKIP_REASON });
        const deletedCount = results.filter(result => result.success).length;
        return { deletedCount, skippedCount: results.length - deletedCount, results };
      }, async (tx, result) => { for (const item of result.results) if (item.success) await manageableMaterial(tx, scope, item.id); });
    },
    async listDeletedMaterials(scope: ChannelInventoryScope, raw: z.input<typeof schemas.listDeletedMaterialsSchema>) {
      const input = parse(schemas.listDeletedMaterialsSchema, raw, scope);
      return transaction(async tx => {
        const visibility = await resolveTeamInventoryVisibility(tx, scope, { lock: true, includeDeleted: true });
        const where = all([...visibility.predicates, sql`dm.deleted_at IS NOT NULL`, visibility.access.write ? sql`TRUE` : sql`FALSE`,
          visibility.leader ? sql`TRUE` : sql`m.responsible_user_id = ${scope.actorUserId}`, await linkedCompanyReadGate(tx, scope)]);
        const from = sql`${TEAM_MATERIAL_FROM} INNER JOIN channel_inventory_material_management dm ON dm.enterprise_id = m.enterprise_id AND dm.material_id = m.id`;
        const total = Number(rows(await tx.execute(sql`SELECT COUNT(*) AS total ${from} WHERE ${where} FOR UPDATE`))[0]?.total ?? 0);
        const items: schemas.DeletedMaterial[] = rows(await tx.execute(sql`SELECT m.id, m.part_number AS partNumber, m.brand, m.revision, dm.deleted_at AS deletedAt,
          ${materialUploadBatchId} AS uploadBatchId ${from} WHERE ${where} ORDER BY dm.deleted_at DESC, m.id DESC
          LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize} FOR UPDATE`)).map(row => ({ id: Number(row.id), partNumber: String(row.partNumber), brand: String(row.brand), revision: Number(row.revision), deletedAt: row.deletedAt as Date | string, uploadBatchId: row.uploadBatchId == null ? null : Number(row.uploadBatchId), canRestore: true }));
        return { items, total, page: input.page, pageSize: input.pageSize, pageCount: Math.ceil(total / input.pageSize) };
      });
    },
    async restoreMaterial(scope: ChannelInventoryScope, raw: schemas.RestoreMaterialInput) {
      const input = parse(schemas.restoreMaterialSchema, raw, scope);
      return mutation(scope, input, "restoreMaterial", async tx => {
        const current = await manageableMaterial(tx, scope, input.id);
        if (current.deletedAt == null || Number(current.revision) !== input.expectedRevision) conflict();
        if (!changed(await tx.execute(sql`UPDATE channel_inventory_materials SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3)
          WHERE id = ${input.id} AND enterprise_id = ${scope.enterpriseId} AND data_owner_user_id = ${scope.dataOwnerUserId} AND revision = ${input.expectedRevision}`))) conflict();
        if (!changed(await tx.execute(sql`UPDATE channel_inventory_material_management SET deleted_at = NULL
          WHERE enterprise_id = ${scope.enterpriseId} AND material_id = ${input.id} AND deleted_at IS NOT NULL`))) conflict();
        // Intentionally NO share/assignment/channel/CRM write: old live grants are neither enlarged nor revived after transfer.
        return { id: input.id, restored: true as const };
      }, (tx) => manageableMaterial(tx, scope, input.id));
    },
    async createUploadBatch(scope: ChannelInventoryScope, raw: schemas.CreateUploadBatchInput) {
      const input = parse(schemas.createUploadBatchSchema, raw, scope);
      return mutation(scope, input, "createUploadBatch", async tx => {
        const channel = rows(await tx.execute(sql`SELECT c.id, c.active ${sql`FROM channel_inventory_channels c`}
          WHERE c.id = ${input.channelId} AND c.enterprise_id = ${scope.enterpriseId} AND c.data_owner_user_id = ${scope.dataOwnerUserId}
            AND c.responsible_user_id = ${scope.actorUserId} AND ${await linkedCompanyReadGate(tx, scope)} LIMIT 1 FOR UPDATE`))[0];
        if (!channel) unavailable();
        if (!bool(channel.active)) fail("PRECONDITION_FAILED", "渠道已停用");
        const members = rows(await tx.execute(sql`SELECT tm.id, tm.teamId FROM enterprise_team_members tm INNER JOIN enterprise_teams t
          ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
          WHERE tm.enterpriseId = ${scope.enterpriseId} AND tm.userId = ${scope.actorUserId} AND tm.teamRole IN ('leader', 'member') FOR UPDATE`));
        if (members.length !== 1) fail("PRECONDITION_FAILED", "请先加入当前有效业务团队");
        const assignment = rows(await tx.execute(sql`SELECT id FROM enterprise_team_record_assignments WHERE enterpriseId = ${scope.enterpriseId}
          AND recordType = 'channel' AND recordId = ${input.channelId} AND teamId = ${Number(members[0].teamId)}
          AND currentOwnerUserId = ${scope.actorUserId} AND revision >= 1 LIMIT 1 FOR UPDATE`))[0];
        if (!assignment) fail("PRECONDITION_FAILED", "渠道团队归属已变化");
        const batchCode = randomUUID();
        const result = await tx.execute(sql`INSERT INTO channel_inventory_upload_batches
          (enterprise_id, data_owner_user_id, channel_id, uploaded_by_user_id, team_id, owner_membership_id, uploaded_by_admin_account_id, batch_code, file_name, total_rows, revision, archived, closed)
          VALUES (${scope.enterpriseId}, ${scope.dataOwnerUserId}, ${input.channelId}, ${scope.actorUserId}, ${Number(members[0].teamId)}, ${Number(members[0].id)}, ${scope.officialActor?.adminAccountId ?? null}, ${batchCode}, ${input.fileName}, ${input.totalRows}, 1, 0, 0)`);
        const id = Number(header(result)?.insertId); if (!Number.isSafeInteger(id) || id <= 0) fail("INTERNAL_SERVER_ERROR", "批次保存失败");
        return { id, batchCode, revision: 1 };
      }, (tx, result) => ownBatch(tx, scope, result.id));
    },
    async listUploadBatches(scope: ChannelInventoryScope, raw: schemas.ListUploadBatchesInput) {
      const input = parse(schemas.listUploadBatchesSchema, raw, scope);
      return transaction(async tx => {
        await resolveTeamInventoryVisibility(tx, scope, { lock: true });
        const predicates: SQL[] = [sql`b.enterprise_id = ${scope.enterpriseId}`, sql`b.data_owner_user_id = ${scope.dataOwnerUserId}`,
          sql`b.uploaded_by_user_id = ${scope.actorUserId}`, scope.officialActor ? sql`b.uploaded_by_admin_account_id = ${scope.officialActor.adminAccountId}` : sql`TRUE`, sql`c.responsible_user_id = ${scope.actorUserId}`, batchCurrentMembership(scope), await linkedCompanyReadGate(tx, scope)];
        if (input.channelId !== undefined) predicates.push(sql`b.channel_id = ${input.channelId}`);
        if (input.archived !== undefined) predicates.push(sql`b.archived = ${input.archived}`);
        const where = all(predicates);
        const total = Number(rows(await tx.execute(sql`SELECT COUNT(*) AS total ${BATCH_FROM} WHERE ${where} FOR UPDATE`))[0]?.total ?? 0);
        const found = rows(await tx.execute(sql`SELECT b.id, b.batch_code AS batchCode, b.name, b.file_name AS fileName, b.channel_id AS channelId, c.name AS channelName,
          COALESCE(NULLIF(u.name, ''), CONCAT('用户#', b.uploaded_by_user_id)) AS uploadedByName,
          b.created_at AS createdAt, b.total_rows AS totalRows, b.revision, b.archived,
          (SELECT COUNT(*) FROM channel_inventory_upload_batch_materials bm WHERE bm.enterprise_id = b.enterprise_id AND bm.batch_id = b.id) AS successCount,
          (SELECT COUNT(*) FROM channel_inventory_upload_batch_materials bm INNER JOIN channel_inventory_materials m ON m.id = bm.material_id AND m.enterprise_id = bm.enterprise_id
            WHERE bm.enterprise_id = b.enterprise_id AND bm.batch_id = b.id AND ${activeChannelMaterial}) AS remainingCount
          ${BATCH_FROM} LEFT JOIN users u ON u.id = b.uploaded_by_user_id WHERE ${where}
          ORDER BY b.id DESC LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize} FOR UPDATE`));
        const items: schemas.UploadBatch[] = [];
        for (const row of found) {
          const company = await linkedCompany(tx, scope, Number(row.channelId));
          if (company.linked && !company.customer) unavailable();
          items.push({ id: Number(row.id), batchCode: String(row.batchCode), name: row.name == null ? null : String(row.name), fileName: String(row.fileName), channelId: Number(row.channelId), channelName: company.linked ? String(company.customer!.name) : String(row.channelName), uploadedByName: String(row.uploadedByName), createdAt: row.createdAt as Date | string, totalRows: Number(row.totalRows), successCount: Number(row.successCount), remainingCount: Number(row.remainingCount), revision: Number(row.revision), archived: bool(row.archived) });
        }
        return { items, total, page: input.page, pageSize: input.pageSize, pageCount: Math.ceil(total / input.pageSize) };
      });
    },
    async updateUploadBatch(scope: ChannelInventoryScope, raw: schemas.UpdateUploadBatchInput) {
      const input = parse(schemas.updateUploadBatchSchema, raw, scope);
      return mutation(scope, input, "updateUploadBatch", async tx => {
        const batch = await ownBatch(tx, scope, input.id);
        if (Number(batch.revision) !== input.expectedRevision) conflict();
        const assignments = [sql`revision = revision + 1`];
        if (input.name !== undefined) assignments.push(sql`name = ${input.name}`);
        if (input.archived !== undefined) assignments.push(sql`archived = ${input.archived}`);
        // Archiving only organizes upload history; deletion alone closes a queue.
        if (!changed(await tx.execute(sql`UPDATE channel_inventory_upload_batches SET ${sql.join(assignments, sql`, `)}
          WHERE id = ${input.id} AND enterprise_id = ${scope.enterpriseId} AND revision = ${input.expectedRevision}`))) conflict();
        return { id: input.id, revision: input.expectedRevision + 1 };
      }, (tx) => ownBatch(tx, scope, input.id));
    },
    async previewDeleteUploadBatch(scope: ChannelInventoryScope, raw: schemas.PreviewDeleteUploadBatchInput) {
      const input = parse(schemas.previewDeleteUploadBatchSchema, raw, scope);
      return transaction(async tx => {
        await writable(tx, scope); const batch = await ownBatch(tx, scope, input.id);
        const { total, candidates } = await batchCandidates(tx, scope, input.id);
        return { total, eligibleCount: candidates.length, conflictCount: total - candidates.length, revision: Number(batch.revision) };
      });
    },
    async deleteUploadBatch(scope: ChannelInventoryScope, raw: schemas.DeleteUploadBatchInput) {
      const input = parse(schemas.deleteUploadBatchSchema, raw, scope);
      return mutation(scope, input, "deleteUploadBatch", async tx => {
        const batch = await ownBatch(tx, scope, input.id);
        if (Number(batch.revision) !== input.expectedRevision) conflict();
        const { total, candidates } = await batchCandidates(tx, scope, input.id);
        if (!changed(await tx.execute(sql`UPDATE channel_inventory_upload_batches SET closed = 1, revision = revision + 1
          WHERE id = ${input.id} AND enterprise_id = ${scope.enterpriseId} AND revision = ${input.expectedRevision}`))) conflict();
        let deletedCount = 0;
        for (const row of candidates) if (await softDelete(tx, scope, Number(row.id), Number(row.revision), input.requestId)) deletedCount++;
        return { deletedCount, skippedCount: total - deletedCount };
      }, (tx) => ownBatch(tx, scope, input.id));
    },
  };
}
