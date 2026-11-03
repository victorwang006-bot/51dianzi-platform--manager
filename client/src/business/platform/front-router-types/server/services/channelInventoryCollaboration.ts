import { sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ChannelInventoryError, channelInventoryPayloadHash, type ChannelInventoryScope, type SqlDatabase, type SqlExecutor, type SqlResultRow } from "./channelInventory";
import { resolveTeamInventoryVisibility, TEAM_MATERIAL_FROM, teamInventoryAll, teamInventoryRows as rows } from "./channelTeamInventoryAccess";
import { teamMaterialForEditSchema, teamMaterialUpdateSchema, collaborationNotesListSchema, collaborationNotesAddSchema, collaborationNotesEditSchema } from "../../../shared/channelInventoryCollaboration";

/** Closed public projection; private legacy material/note/channel-contact fields are never selected. */
export type TeamMaterialForEdit = {
  id: number; channelId: number; channelName: string; partNumber: string; brand: string;
  qty: number | null; dateCode: string | null; price: string | null; currency: "CNY";
  taxIncluded: boolean | null; leadTime: string | null; revision: number;
  createdAt: Date | string; updatedAt: Date | string; canEdit: true; readOnly: false;
};
export type CollaborationNote = {
  id: number; materialId: number; authorUserId: number; authorName: string; content: string;
  revision: number; createdAt: Date | string; updatedAt: Date | string; canEdit: boolean;
};
type Action = "updateTeamMaterial" | "collaborationNotesAdd" | "collaborationNotesEdit";
const bool = (value: unknown) => value === true || value === 1 || value === "1";
const text = (value: unknown) => value == null ? null : String(value);
const fail = (code: ConstructorParameters<typeof ChannelInventoryError>[0], message: string): never => { throw new ChannelInventoryError(code, message); };
const notFound = () => fail("NOT_FOUND", "资源不存在或无权访问");
const conflict = () => fail("CONFLICT", "数据已被其他人更新，请刷新后重试");
const header = (result: unknown): SqlResultRow => Array.isArray(result) ? result[0] as SqlResultRow : result as SqlResultRow;
function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) return fail("BAD_REQUEST", result.error.issues[0]?.message ?? "请求字段无效");
  return result.data;
}
function expected(scope: ChannelInventoryScope, input: { expectedEnterpriseId?: number; expectedActorUserId?: number }) {
  if ((input.expectedEnterpriseId !== undefined && input.expectedEnterpriseId !== scope.enterpriseId)
    || (input.expectedActorUserId !== undefined && input.expectedActorUserId !== scope.actorUserId)) fail("FORBIDDEN", "企业或账号上下文不匹配，请刷新后重试");
}
export function teamMaterialPublicFrom(row: SqlResultRow): TeamMaterialForEdit {
  if (String(row.currency) !== "CNY") fail("INTERNAL_SERVER_ERROR", "库存币种无效");
  return { id: Number(row.id), channelId: Number(row.channelId), channelName: String(row.channelName),
    partNumber: String(row.partNumber), brand: String(row.brand), qty: row.qty == null ? null : Number(row.qty),
    dateCode: text(row.dateCode), price: text(row.price), currency: "CNY", taxIncluded: row.taxIncluded == null ? null : bool(row.taxIncluded),
    leadTime: text(row.leadTime), revision: Number(row.revision), createdAt: row.createdAt as Date | string,
    updatedAt: row.updatedAt as Date | string, canEdit: true, readOnly: false };
}
export function collaborationNoteFrom(row: SqlResultRow, actorUserId: number): CollaborationNote {
  return { id: Number(row.id), materialId: Number(row.materialId), authorUserId: Number(row.authorUserId),
    authorName: row.authorName == null ? `用户#${Number(row.authorUserId)}` : String(row.authorName), content: String(row.content),
    revision: Number(row.revision), createdAt: row.createdAt as Date | string, updatedAt: row.updatedAt as Date | string,
    canEdit: Number(row.authorUserId) === actorUserId };
}
const PUBLIC_COLUMNS = sql`m.id, m.channel_id AS channelId, c.name AS channelName, c.active AS channelActive,
  m.part_number AS partNumber, m.brand, m.qty, m.date_code AS dateCode, m.price, m.currency,
  m.tax_included AS taxIncluded, m.lead_time AS leadTime, m.revision,
  m.created_at AS createdAt, m.updated_at AS updatedAt`;

/** Re-resolve real actor + complete original live share algorithm inside the actual transaction.
 * Locking reads include membership, team, owner permissions/module, share and assignment fences.
 */
async function authorizedMaterial(tx: SqlExecutor, scope: ChannelInventoryScope, materialId: number, write = false) {
  const visibility = await resolveTeamInventoryVisibility(tx, scope, { lock: true, materialId });
  const row = rows(await tx.execute(sql`SELECT ${PUBLIC_COLUMNS}, (m.responsible_user_id = ${scope.actorUserId}) AS isMine
    ${TEAM_MATERIAL_FROM} WHERE ${teamInventoryAll(visibility.predicates)} LIMIT 1 FOR UPDATE`))[0];
  if (!row) notFound();
  if (write && (!visibility.access.write || (!bool(row.isMine) && !visibility.leader))) fail("FORBIDDEN", "仅所属人或本库存团队有效组长且具备库存写权限可编辑");
  return row;
}
async function readNote(tx: SqlExecutor, scope: ChannelInventoryScope, noteId: number) {
  const row = rows(await tx.execute(sql`SELECT n.id, n.materialId, n.authorUserId, n.content, n.revision, n.createdAt, n.updatedAt,
    COALESCE(NULLIF(u.name, ''), CONCAT('用户#', n.authorUserId)) AS authorName
    FROM channel_inventory_collaboration_notes n LEFT JOIN users u ON u.id = n.authorUserId
    WHERE n.enterpriseId = ${scope.enterpriseId} AND n.id = ${noteId} LIMIT 1`))[0];
  if (!row) notFound();
  return collaborationNoteFrom(row, scope.actorUserId);
}
async function priorAudit(tx: SqlExecutor, scope: ChannelInventoryScope, requestId: string) {
  return rows(await tx.execute(sql`SELECT materialId, noteId, action, payloadHash, afterData
    FROM channel_inventory_collaboration_audit WHERE enterpriseId = ${scope.enterpriseId}
      AND actorUserId = ${scope.actorUserId} AND requestId = ${requestId} LIMIT 1 FOR UPDATE`))[0];
}
function replay<T extends TeamMaterialForEdit | CollaborationNote>(audit: SqlResultRow, action: Action, hash: string, actor: number): { item: T; idempotent: boolean } {
  if (String(audit.action) !== action || String(audit.payloadHash) !== hash) fail("CONFLICT", "该请求号已用于不同的协作操作");
  let data: SqlResultRow;
  try { data = typeof audit.afterData === "string" ? JSON.parse(audit.afterData) : audit.afterData as SqlResultRow; }
  catch { return fail("INTERNAL_SERVER_ERROR", "审计记录格式无效"); }
  if (!data || !Number.isSafeInteger(Number(data.id))) fail("INTERNAL_SERVER_ERROR", "审计记录格式无效");
  // Even replay is projected from a strict whitelist, never raw JSON/spread.
  const item = action === "updateTeamMaterial" ? teamMaterialPublicFrom(data) : collaborationNoteFrom(data, actor);
  if (action === "collaborationNotesEdit" && (item as CollaborationNote).authorUserId !== actor) fail("FORBIDDEN", "只能修改本人填写的协作备注");
  return { item: item as T, idempotent: true };
}
async function audit(tx: SqlExecutor, scope: ChannelInventoryScope, input: {
  materialId: number; noteId?: number; action: Action; requestId: string; payloadHash: string;
  expectedRevision?: number; beforeData: TeamMaterialForEdit | CollaborationNote | null; afterData: TeamMaterialForEdit | CollaborationNote;
}) {
  await tx.execute(sql`INSERT INTO channel_inventory_collaboration_audit
    (enterpriseId, materialId, noteId, actorUserId, action, requestId, payloadHash, expectedRevision, resultingRevision, beforeData, afterData)
    VALUES (${scope.enterpriseId}, ${input.materialId}, ${input.noteId ?? null}, ${scope.actorUserId}, ${input.action},
      ${input.requestId}, ${input.payloadHash}, ${input.expectedRevision ?? null}, ${input.afterData.revision},
      ${JSON.stringify(input.beforeData)}, ${JSON.stringify(input.afterData)})`);
}

/** InnoDB 1213/40001 rolls back the entire transaction. Never infer it from a message,
 * a timeout (1205), or an application error. Drizzle may wrap the driver error in cause. */
function isInnoDbDeadlock(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const value = current as { errno?: unknown; code?: unknown; sqlState?: unknown; cause?: unknown };
    if (value.errno === 1213 && value.code === "ER_LOCK_DEADLOCK" && value.sqlState === "40001") return true;
    current = value.cause;
  }
  return false;
}

export function createChannelInventoryCollaborationService({ getDb }: { getDb: () => Promise<SqlDatabase | null> }) {
  async function transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const db = await getDb();
    if (!db) return fail("INTERNAL_SERVER_ERROR", "渠道库存协作服务暂不可用");
    for (let attempt = 1; ; attempt++) {
      let deadlock = false, operationRejected = false;
      let operationError: unknown;
      try {
        return await db.transaction(async tx => {
          // Observe the driver error before authority helpers wrap it. Do not change
          // their fences or grants. Every retry invokes the whole original operation.
          const observed: SqlExecutor = { execute: async query => {
            try { return await tx.execute(query); }
            catch (error) { if (isInnoDbDeadlock(error)) deadlock = true; throw error; }
          } };
          try { return await operation(observed); }
          catch (error) { operationRejected = true; operationError = error; throw error; }
        });
      } catch (error) {
        const denied = (error instanceof ChannelInventoryError || error instanceof TRPCError)
          && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT", "BAD_REQUEST"].includes(error.code);
        // The driver must reject with the callback failure AFTER its rollback. A
        // commit/rollback failure is not that callback failure and is never retried.
        if (attempt < 3 && deadlock && operationRejected && error === operationError && !denied) {
          await new Promise(resolve => setTimeout(resolve, 10 + Math.floor(Math.random() * 21)));
          continue;
        }
        if (error instanceof ChannelInventoryError) throw error;
        if (error instanceof TRPCError) fail(error.code === "FORBIDDEN" ? "FORBIDDEN" : "SERVICE_UNAVAILABLE", error.message);
        throw new ChannelInventoryError("INTERNAL_SERVER_ERROR", "渠道库存协作服务暂不可用，请稍后重试");
      }
    }
  }
  return {
    async getTeamMaterialForEdit(scope: ChannelInventoryScope, raw: z.input<typeof teamMaterialForEditSchema>): Promise<TeamMaterialForEdit> {
      const input = parse(teamMaterialForEditSchema, raw); expected(scope, input);
      return transaction(async tx => teamMaterialPublicFrom(await authorizedMaterial(tx, scope, input.id, true)));
    },
    async updateTeamMaterial(scope: ChannelInventoryScope, raw: z.input<typeof teamMaterialUpdateSchema>): Promise<{ item: TeamMaterialForEdit; idempotent: boolean }> {
      const input = parse(teamMaterialUpdateSchema, raw); expected(scope, input);
      const { expectedEnterpriseId: _e, expectedActorUserId: _a, requestId, ...payload } = input;
      const hash = channelInventoryPayloadHash({ action: "updateTeamMaterial", ...payload });
      return transaction(async tx => {
        const current = await authorizedMaterial(tx, scope, input.id, true);
        const prior = await priorAudit(tx, scope, requestId);
        if (prior) return replay<TeamMaterialForEdit>(prior, "updateTeamMaterial", hash, scope.actorUserId);
        if (Number(current.revision) !== input.expectedRevision) conflict();
        if (!bool(current.channelActive)) fail("PRECONDITION_FAILED", "关联渠道已停用，不能编辑库存");
        const assignments: SQL[] = [sql`revision = revision + 1`, sql`updated_at = CURRENT_TIMESTAMP(3)`];
        if (input.partNumber !== undefined) assignments.push(sql`part_number = ${input.partNumber}`);
        if (input.brand !== undefined) assignments.push(sql`brand = ${input.brand}`);
        if (input.qty !== undefined) assignments.push(sql`qty = ${input.qty}`);
        if (input.dateCode !== undefined) assignments.push(sql`date_code = ${input.dateCode}`);
        if (input.price !== undefined) assignments.push(sql`price = ${input.price}`);
        if (input.taxIncluded !== undefined) assignments.push(sql`tax_included = ${input.taxIncluded}`);
        if (input.leadTime !== undefined) assignments.push(sql`lead_time = ${input.leadTime}`);
        const changed = await tx.execute(sql`UPDATE channel_inventory_materials SET ${sql.join(assignments, sql`, `)}
          WHERE id = ${input.id} AND enterprise_id = ${scope.enterpriseId} AND data_owner_user_id = ${scope.dataOwnerUserId}
            AND revision = ${input.expectedRevision}`);
        if (Number(header(changed).affectedRows) !== 1) conflict();
        const updated = rows(await tx.execute(sql`SELECT ${PUBLIC_COLUMNS} ${TEAM_MATERIAL_FROM}
          WHERE m.id = ${input.id} AND m.enterprise_id = ${scope.enterpriseId} AND m.data_owner_user_id = ${scope.dataOwnerUserId} LIMIT 1`))[0];
        if (!updated) notFound();
        const item = teamMaterialPublicFrom(updated);
        await audit(tx, scope, { materialId: input.id, action: "updateTeamMaterial", requestId, payloadHash: hash,
          expectedRevision: input.expectedRevision, beforeData: teamMaterialPublicFrom(current), afterData: item });
        return { item, idempotent: false };
      });
    },
    async collaborationNotesList(scope: ChannelInventoryScope, raw: z.input<typeof collaborationNotesListSchema>) {
      const input = parse(collaborationNotesListSchema, raw); expected(scope, input);
      return transaction(async tx => {
        await authorizedMaterial(tx, scope, input.materialId);
        const where = sql`n.enterpriseId = ${scope.enterpriseId} AND n.materialId = ${input.materialId}`;
        const total = Number(rows(await tx.execute(sql`SELECT COUNT(*) AS total FROM channel_inventory_collaboration_notes n WHERE ${where}`))[0]?.total ?? 0);
        const items = rows(await tx.execute(sql`SELECT n.id, n.materialId, n.authorUserId, n.content, n.revision, n.createdAt, n.updatedAt,
          COALESCE(NULLIF(u.name, ''), CONCAT('用户#', n.authorUserId)) AS authorName
          FROM channel_inventory_collaboration_notes n LEFT JOIN users u ON u.id = n.authorUserId WHERE ${where}
          ORDER BY n.id DESC LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}`)).map(row => collaborationNoteFrom(row, scope.actorUserId));
        return { items, total, page: input.page, pageSize: input.pageSize, canAdd: true };
      });
    },
    async collaborationNotesAdd(scope: ChannelInventoryScope, raw: z.input<typeof collaborationNotesAddSchema>): Promise<{ item: CollaborationNote; idempotent: boolean }> {
      const input = parse(collaborationNotesAddSchema, raw); expected(scope, input);
      const hash = channelInventoryPayloadHash({ action: "collaborationNotesAdd", materialId: input.materialId, content: input.content });
      return transaction(async tx => {
        // Authorization precedes even idempotent replay. Read only: no stock write grant is synthesized.
        await authorizedMaterial(tx, scope, input.materialId);
        const prior = await priorAudit(tx, scope, input.requestId);
        if (prior) return replay<CollaborationNote>(prior, "collaborationNotesAdd", hash, scope.actorUserId);
        const inserted = await tx.execute(sql`INSERT INTO channel_inventory_collaboration_notes (enterpriseId, materialId, authorUserId, content)
          VALUES (${scope.enterpriseId}, ${input.materialId}, ${scope.actorUserId}, ${input.content})`);
        const noteId = Number(header(inserted).insertId);
        if (!Number.isSafeInteger(noteId) || noteId < 1) fail("INTERNAL_SERVER_ERROR", "备注保存失败");
        const item = await readNote(tx, scope, noteId);
        await audit(tx, scope, { materialId: input.materialId, noteId, action: "collaborationNotesAdd", requestId: input.requestId,
          payloadHash: hash, beforeData: null, afterData: item });
        return { item, idempotent: false };
      });
    },
    async collaborationNotesEdit(scope: ChannelInventoryScope, raw: z.input<typeof collaborationNotesEditSchema>): Promise<{ item: CollaborationNote; idempotent: boolean }> {
      const input = parse(collaborationNotesEditSchema, raw); expected(scope, input);
      const hash = channelInventoryPayloadHash({ action: "collaborationNotesEdit", noteId: input.noteId, expectedRevision: input.expectedRevision, content: input.content });
      return transaction(async tx => {
        // Metadata only; do not read content before the inventory visibility check.
        const reference = rows(await tx.execute(sql`SELECT materialId, authorUserId FROM channel_inventory_collaboration_notes
          WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.noteId} LIMIT 1`))[0];
        if (!reference) notFound();
        await authorizedMaterial(tx, scope, Number(reference.materialId));
        const note = rows(await tx.execute(sql`SELECT n.id, n.materialId, n.authorUserId, n.content, n.revision, n.createdAt, n.updatedAt,
          COALESCE(NULLIF(u.name, ''), CONCAT('用户#', n.authorUserId)) AS authorName
          FROM channel_inventory_collaboration_notes n LEFT JOIN users u ON u.id = n.authorUserId
          WHERE n.enterpriseId = ${scope.enterpriseId} AND n.id = ${input.noteId} LIMIT 1 FOR UPDATE`))[0];
        if (!note) notFound();
        if (Number(note.authorUserId) !== scope.actorUserId) fail("FORBIDDEN", "只能修改本人填写的协作备注");
        const prior = await priorAudit(tx, scope, input.requestId);
        if (prior) return replay<CollaborationNote>(prior, "collaborationNotesEdit", hash, scope.actorUserId);
        if (Number(note.revision) !== input.expectedRevision) conflict();
        // The metadata reference can establish an old RR view before authorization
        // waits. Audit the locked CAS row, never a later ordinary snapshot SELECT.
        const beforeData = collaborationNoteFrom(note, scope.actorUserId);
        const changed = await tx.execute(sql`UPDATE channel_inventory_collaboration_notes
          SET content = ${input.content}, revision = revision + 1, updatedAt = CURRENT_TIMESTAMP(3)
          WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.noteId}
            AND authorUserId = ${scope.actorUserId} AND revision = ${input.expectedRevision}`);
        if (Number(header(changed).affectedRows) !== 1) conflict();
        const item = await readNote(tx, scope, input.noteId);
        await audit(tx, scope, { materialId: Number(note.materialId), noteId: input.noteId, action: "collaborationNotesEdit", requestId: input.requestId,
          payloadHash: hash, expectedRevision: input.expectedRevision, beforeData, afterData: item });
        return { item, idempotent: false };
      });
    },
  };
}
