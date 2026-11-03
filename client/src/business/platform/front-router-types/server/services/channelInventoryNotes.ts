import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { resolveChannelInventoryAuthority, ChannelInventoryError, type ChannelInventoryScope } from "./channelInventory";
import { resolveBusinessModuleAccess } from "./businessModuleAccess";
import type { BusinessFailure } from "../../../shared/businessFailure";

export type ChannelNotesErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "PRECONDITION_FAILED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_SERVER_ERROR";

export class ChannelNotesError extends Error {
  readonly code: ChannelNotesErrorCode;

  constructor(code: ChannelNotesErrorCode, message: string, readonly businessFailure?: BusinessFailure) {
    super(message);
    this.name = "ChannelNotesError";
    this.code = code;
  }
}

type SqlResultRow = Record<string, unknown>;
type SqlExecutor = { execute(statement: SQL): Promise<unknown> };
type SqlDatabase = SqlExecutor & { transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T> };

/** Explicit allowlist: no source identifiers, channel facts, contacts or notes. */
export type SharedChannelMaterial = {
  id: number;
  partNumber: string;
  brand: string;
  qty: number | null;
  dateCode: string | null;
  price: string | null;
  currency: "CNY";
  taxIncluded: boolean | null;
  leadTime: string | null;
  revision: number;
  updatedAt: Date | string;
  canEdit: false;
  readOnly: true;
};

export type ChannelNote = {
  id: number;
  authorUserId: number;
  authorName: string;
  content: string;
  revision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ChannelNotesServiceDependencies = {
  getDb: () => Promise<SqlDatabase | null>;
};

const MAX_PAGE_SIZE = 100;
const NOT_FOUND_MESSAGE = "资源不存在或无权访问";

function fail(code: ChannelNotesErrorCode, message: string): never {
  throw new ChannelNotesError(code, message);
}

function unavailable(): ChannelNotesError {
  return new ChannelNotesError("INTERNAL_SERVER_ERROR", "渠道库存备注服务暂不可用，请稍后重试");
}

function rows(result: unknown): SqlResultRow[] {
  if (Array.isArray(result)) {
    const first = result[0];
    return Array.isArray(first) ? (first as SqlResultRow[]) : (result as SqlResultRow[]);
  }
  if (result && typeof result === "object" && "rows" in result) {
    const value = (result as { rows?: unknown }).rows;
    return Array.isArray(value) ? (value as SqlResultRow[]) : [];
  }
  return [];
}

function header(result: unknown): SqlResultRow {
  if (Array.isArray(result)) {
    const first = result[0];
    return first && !Array.isArray(first) && typeof first === "object" ? (first as SqlResultRow) : {};
  }
  return result && typeof result === "object" ? (result as SqlResultRow) : {};
}

function insertId(result: unknown): number | null {
  const id = Number(header(result).insertId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function affectedRows(result: unknown): number {
  return Number(header(result).affectedRows ?? 0);
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function whereAll(predicates: SQL[]): SQL {
  return sql.join(predicates, sql` AND `);
}

function literalSearch(value: string): string {
  return `%${value.replace(/([=%_])/g, "=$1")}%`;
}

export function canonicalChannelNoteJson(value: unknown): string {
  if (value === null) return "null";
  if (["string", "boolean", "number"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalChannelNoteJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalChannelNoteJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function channelNotePayloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalChannelNoteJson(value), "utf8").digest("hex");
}

function parseJson(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("INTERNAL_SERVER_ERROR", "渠道库存备注服务暂不可用，请稍后重试");
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ChannelNotesError) throw error;
    fail("INTERNAL_SERVER_ERROR", "渠道库存备注服务暂不可用，请稍后重试");
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function positiveId(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) fail("BAD_REQUEST", `${label}无效`);
  return number;
}

function normalizeContent(value: unknown): string {
  if (typeof value !== "string") fail("BAD_REQUEST", "备注内容无效");
  const content = value.trim();
  if (!content) fail("BAD_REQUEST", "请输入备注内容");
  if (content.length > 2000) fail("BAD_REQUEST", "备注内容不能超过 2000 个字符");
  return content;
}

function assertPage(input: { page?: unknown; pageSize?: unknown }, defaultPageSize: number) {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? defaultPageSize;
  if (!Number.isInteger(page) || Number(page) < 1 || Number(page) > 1_000_000) fail("BAD_REQUEST", "页码无效");
  if (!Number.isInteger(pageSize) || Number(pageSize) < 1 || Number(pageSize) > MAX_PAGE_SIZE) fail("BAD_REQUEST", `每页数量须在 1 到 ${MAX_PAGE_SIZE} 之间`);
  return { page: Number(page), pageSize: Number(pageSize) };
}

async function requiredDatabase(getDb: ChannelNotesServiceDependencies["getDb"]): Promise<SqlDatabase> {
  try {
    const database = await getDb();
    if (!database) throw new Error("missing database");
    return database;
  } catch {
    throw unavailable();
  }
}

/** Every entrypoint resolves actual membership, permission and stocks module access. */
async function currentAuthority(executor: SqlExecutor, scope: ChannelInventoryScope, options: { lock?: boolean; mutation?: boolean } = {}) {
  try {
    const access = await resolveChannelInventoryAuthority(executor, scope, "stocks", options.mutation === true, options.lock === true);
    return { ...scope, ...access };
  } catch (error) {
    if (error instanceof ChannelInventoryError) throw new ChannelNotesError(error.code, error.message, error.businessFailure);
    throw error;
  }
}

type Authority = Awaited<ReturnType<typeof currentAuthority>>;

/** Notes, including legacy text, are exclusively current-responsible private. */
function materialPredicates(authority: Authority): SQL[] {
  return [
    sql`m.enterprise_id = ${authority.enterpriseId}`,
    sql`m.data_owner_user_id = ${authority.dataOwnerUserId}`,
    sql`c.enterprise_id = ${authority.enterpriseId}`,
    sql`c.data_owner_user_id = ${authority.dataOwnerUserId}`,
    sql`m.responsible_user_id = ${authority.actorUserId}`,
    sql`c.responsible_user_id = ${authority.actorUserId}`,
  ];
}

// Live joins are mandatory. Assignment revision and membership identity fence
// old grants even after a transfer-away/return or leave/rejoin of the owner.
const SHARED_FROM = sql`
  FROM channel_inventory_materials m
  INNER JOIN channel_inventory_channels c ON c.id = m.channel_id
   AND c.enterprise_id = m.enterprise_id AND c.data_owner_user_id = m.data_owner_user_id
   AND c.responsible_user_id = m.responsible_user_id
  INNER JOIN channel_inventory_material_shares s ON s.enterprise_id = m.enterprise_id
   AND s.material_id = m.id AND s.enabled = 1 AND s.owner_user_id = m.responsible_user_id
  INNER JOIN enterprise_team_record_assignments a ON a.enterpriseId = m.enterprise_id
   AND a.recordType = 'channel_material' AND a.recordId = m.id
   AND a.currentOwnerUserId = s.owner_user_id AND a.teamId = s.share_team_id
   AND a.revision = s.assignment_revision
  INNER JOIN enterprise_team_members owner_tm ON owner_tm.enterpriseId = m.enterprise_id
   AND owner_tm.userId = s.owner_user_id AND owner_tm.teamId = s.share_team_id
   AND owner_tm.id = s.owner_membership_id
  INNER JOIN enterprise_teams t ON t.id = s.share_team_id
   AND t.enterpriseId = m.enterprise_id AND t.status = 'active'
  INNER JOIN enterprise_team_members reader_tm ON reader_tm.enterpriseId = m.enterprise_id
   AND reader_tm.teamId = s.share_team_id
  INNER JOIN enterprise_members owner_em ON owner_em.enterpriseId = m.enterprise_id
   AND owner_em.userId = s.owner_user_id AND owner_em.status = 'active'
  INNER JOIN users owner_u ON owner_u.id = owner_em.userId AND owner_u.loginDisabled = 0
`;

function sharedPredicates(authority: Authority): SQL[] {
  return [
    sql`m.enterprise_id = ${authority.enterpriseId}`,
    sql`m.data_owner_user_id = ${authority.dataOwnerUserId}`,
    sql`reader_tm.userId = ${authority.actorUserId}`,
    sql`reader_tm.teamId = ${authority.teamId}`,
    sql`m.responsible_user_id <> ${authority.actorUserId}`,
    sql`(EXISTS (SELECT 1 FROM enterprise_member_permissions owner_perm
      WHERE owner_perm.enterpriseMemberId = owner_em.id AND owner_perm.permissionKey = 'inventory.manage')
      OR (owner_em.role = 'super_admin' AND EXISTS (SELECT 1 FROM enterprises owner_e
        WHERE owner_e.id = m.enterprise_id AND owner_e.superAdminUserId = owner_em.userId)))`,
  ];
}

function noteFrom(row: SqlResultRow): ChannelNote {
  return {
    id: Number(row.id), authorUserId: Number(row.authorUserId),
    authorName: row.authorName == null ? "未知用户" : String(row.authorName),
    content: String(row.content), revision: Number(row.revision),
    createdAt: row.createdAt as Date | string, updatedAt: row.updatedAt as Date | string,
  };
}

export function sharedMaterialFrom(row: SqlResultRow): SharedChannelMaterial {
  if (String(row.currency) !== "CNY") throw unavailable();
  return {
    id: Number(row.id), partNumber: String(row.partNumber), brand: String(row.brand),
    qty: row.qty == null ? null : Number(row.qty), dateCode: nullableString(row.dateCode),
    price: nullableString(row.price), currency: "CNY", taxIncluded: row.taxIncluded == null ? null : bool(row.taxIncluded),
    leadTime: nullableString(row.leadTime), revision: Number(row.revision), updatedAt: row.updatedAt as Date | string,
    canEdit: false, readOnly: true,
  };
}

async function findReadableMaterial(executor: SqlExecutor, authority: Authority, materialId: number) {
  const predicates = materialPredicates(authority);
  predicates.push(sql`m.id = ${materialId}`);
  return rows(await executor.execute(sql`
    SELECT m.id AS id, m.part_number AS partNumber, m.brand AS brand, m.note AS legacyNote,
           m.updated_at AS updatedAt
      FROM channel_inventory_materials m
      INNER JOIN channel_inventory_channels c ON c.id = m.channel_id
       AND c.enterprise_id = m.enterprise_id AND c.data_owner_user_id = m.data_owner_user_id
     WHERE ${whereAll(predicates)}
     LIMIT 1
  `))[0] ?? null;
}

async function lockReadableMaterial(tx: SqlExecutor, authority: Authority, materialId: number): Promise<number> {
  const base = rows(await tx.execute(sql`
    SELECT m.id AS id FROM channel_inventory_materials m
    INNER JOIN channel_inventory_channels c ON c.id = m.channel_id
     AND c.enterprise_id = m.enterprise_id AND c.data_owner_user_id = m.data_owner_user_id
    WHERE ${whereAll([...materialPredicates(authority), sql`m.id = ${materialId}`])}
    LIMIT 1 FOR UPDATE
  `))[0];
  if (!base) fail("NOT_FOUND", NOT_FOUND_MESSAGE);
  return Number(base.id);
}

async function findAudit(executor: SqlExecutor, authority: Authority, requestId: string, lock = false) {
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  return rows(await executor.execute(sql`
    SELECT id, materialId, noteId, action, requestId, payloadHash, beforeData, afterData
      FROM channel_inventory_note_audit
     WHERE enterpriseId = ${authority.enterpriseId}
       AND actorUserId = ${authority.actorUserId}
       AND requestId = ${requestId}
     LIMIT 1${suffix}
  `))[0] ?? null;
}

function auditReplay(audit: SqlResultRow, action: "notesAdd" | "notesEdit", hash: string) {
  if (String(audit.action) !== action || String(audit.payloadHash) !== hash) fail("CONFLICT", "该请求号已用于不同的备注操作");
  const item = parseJson(audit.afterData);
  if (!item || !Number.isSafeInteger(Number(item.id))) fail("INTERNAL_SERVER_ERROR", "渠道库存备注服务暂不可用，请稍后重试");
  return { item: item as unknown as ChannelNote, idempotent: true } as const;
}

async function findNoteForUpdate(tx: SqlExecutor, authority: Authority, noteId: number) {
  return rows(await tx.execute(sql`
    SELECT id, materialId, enterpriseId, authorUserId, content, revision, createdAt, updatedAt
      FROM channel_inventory_notes
     WHERE id = ${noteId} AND enterpriseId = ${authority.enterpriseId}
     LIMIT 1 FOR UPDATE
  `))[0] ?? null;
}

async function readNoteById(executor: SqlExecutor, authority: Authority, noteId: number): Promise<ChannelNote> {
  const row = rows(await executor.execute(sql`
    SELECT n.id, n.authorUserId, n.content, n.revision, n.createdAt, n.updatedAt,
           COALESCE(NULLIF(u.name, ''), CONCAT('用户#', n.authorUserId)) AS authorName
      FROM channel_inventory_notes n
      LEFT JOIN users u ON u.id = n.authorUserId
     WHERE n.id = ${noteId} AND n.enterpriseId = ${authority.enterpriseId}
     LIMIT 1
  `))[0];
  if (!row) throw unavailable();
  return noteFrom(row);
}

async function insertAudit(tx: SqlExecutor, authority: Authority, values: {
  materialId: number; noteId: number; action: "notesAdd" | "notesEdit"; requestId: string;
  payloadHash: string; beforeData: unknown; afterData: unknown;
}) {
  await tx.execute(sql`
    INSERT INTO channel_inventory_note_audit (
      enterpriseId, materialId, noteId, actorUserId, action, requestId, payloadHash, beforeData, afterData
    ) VALUES (
      ${authority.enterpriseId}, ${values.materialId}, ${values.noteId}, ${authority.actorUserId}, ${values.action},
      ${values.requestId}, ${values.payloadHash}, ${JSON.stringify(values.beforeData)}, ${JSON.stringify(values.afterData)}
    )
  `);
}

function duplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && String((error as { code: unknown }).code) === "ER_DUP_ENTRY");
}

function serviceInputForAdd(input: { materialId: unknown; content: unknown; requestId: unknown }) {
  const materialId = positiveId(input.materialId, "库存");
  const content = normalizeContent(input.content);
  if (!isUuid(input.requestId)) fail("BAD_REQUEST", "请求号无效");
  return { materialId, content, requestId: input.requestId };
}

function serviceInputForEdit(input: { noteId: unknown; expectedRevision: unknown; content: unknown; requestId: unknown }) {
  const noteId = positiveId(input.noteId, "备注");
  const expectedRevision = positiveId(input.expectedRevision, "备注版本");
  const content = normalizeContent(input.content);
  if (!isUuid(input.requestId)) fail("BAD_REQUEST", "请求号无效");
  return { noteId, expectedRevision, content, requestId: input.requestId };
}

export function createChannelNotesService({ getDb }: ChannelNotesServiceDependencies) {
  async function replayAfterDuplicate(db: SqlDatabase, scope: ChannelInventoryScope, action: "notesAdd" | "notesEdit", requestId: string, hash: string) {
    const authority = await currentAuthority(db, scope, { mutation: true });
    const audit = await findAudit(db, authority, requestId);
    if (!audit) return null;
    const material = await findReadableMaterial(db, authority, Number(audit.materialId));
    if (!material) fail("NOT_FOUND", NOT_FOUND_MESSAGE);
    return auditReplay(audit, action, hash);
  }

  async function mutation<T>(scope: ChannelInventoryScope, action: "notesAdd" | "notesEdit", requestId: string, hash: string, operation: (tx: SqlExecutor, authority: Authority) => Promise<T>): Promise<T> {
    const db = await requiredDatabase(getDb);
    try {
      return await db.transaction(async tx => operation(tx, await currentAuthority(tx, scope, { lock: true, mutation: true })));
    } catch (error) {
      if (error instanceof ChannelNotesError) throw error;
      if (duplicateKey(error)) {
        try {
          const replay = await replayAfterDuplicate(db, scope, action, requestId, hash);
          if (replay) return replay as T;
        } catch (replayError) {
          if (replayError instanceof ChannelNotesError) throw replayError;
        }
      }
      throw unavailable();
    }
  }

  return {
    /** Team-only list. Own inventory is returned by listMaterials, never mixed into this DTO. */
    async listSharedMaterials(scope: ChannelInventoryScope, input: {
      partNumber?: string; brand?: string; page?: number; pageSize?: number;
    } = {}) {
      // Service-level rejection also protects callers that bypass Zod/BFF.
      const allowed = new Set(["partNumber", "brand", "page", "pageSize", "expectedEnterpriseId", "expectedActorUserId"]);
      if (Object.keys(input).some(key => !allowed.has(key))) fail("BAD_REQUEST", "团队共享库存不支持渠道来源筛选");
      const { page, pageSize } = assertPage(input, 20);
      const db = await requiredDatabase(getDb);
      try {
        const authority = await currentAuthority(db, scope);
        if (authority.scope === "self" || authority.teamId == null) return { items: [] as SharedChannelMaterial[], total: 0, page, pageSize };
        const predicates = sharedPredicates(authority);
        if (input.partNumber) predicates.push(sql`m.part_number LIKE ${literalSearch(input.partNumber)} ESCAPE '='`);
        if (input.brand) predicates.push(sql`m.brand LIKE ${literalSearch(input.brand)} ESCAPE '='`);
        // Resolve each distinct sharer's LIVE module grant through the one policy
        // helper before COUNT/pagination. Revoking stocks access invalidates sharing.
        const owners = rows(await db.execute(sql`SELECT DISTINCT s.owner_user_id AS ownerUserId ${SHARED_FROM} WHERE ${whereAll(predicates)}`));
        const eligible: number[] = [];
        for (const owner of owners) {
          const ownerId = Number(owner.ownerUserId);
          const access = await resolveBusinessModuleAccess(ownerId, scope.enterpriseId, "stocks", db);
          if (access.read && access.write) eligible.push(ownerId);
        }
        if (!eligible.length) return { items: [] as SharedChannelMaterial[], total: 0, page, pageSize };
        predicates.push(sql`m.responsible_user_id IN (${sql.join(eligible.map(id => sql`${id}`), sql`, `)})`);
        const where = whereAll(predicates);
        const total = Number(rows(await db.execute(sql`SELECT COUNT(*) AS total ${SHARED_FROM} WHERE ${where}`))[0]?.total ?? 0);
        const items = rows(await db.execute(sql`
          SELECT m.id AS id, m.part_number AS partNumber, m.brand, m.qty, m.date_code AS dateCode,
                 m.price, m.currency, m.tax_included AS taxIncluded, m.lead_time AS leadTime,
                 m.revision, m.updated_at AS updatedAt
            ${SHARED_FROM} WHERE ${where}
           ORDER BY m.updated_at DESC, m.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        `)).map(sharedMaterialFrom);
        return { items, total, page, pageSize };
      } catch (error) {
        if (error instanceof ChannelNotesError) throw error;
        throw unavailable();
      }
    },

    async setMaterialShare(scope: ChannelInventoryScope, rawInput: { materialId: unknown; enabled: unknown; expectedRevision: unknown; requestId: unknown }) {
      const materialId = positiveId(rawInput.materialId, "库存");
      const expectedRevision = positiveId(rawInput.expectedRevision, "库存版本");
      if (typeof rawInput.enabled !== "boolean" || !isUuid(rawInput.requestId)) fail("BAD_REQUEST", "共享设置或请求号无效");
      const enabled = rawInput.enabled;
      const requestId = rawInput.requestId;
      const hash = channelNotePayloadHash({ materialId, enabled, expectedRevision });
      const db = await requiredDatabase(getDb);
      try {
        return await db.transaction(async tx => {
          // Must run INSIDE this transaction; a preflight router check is insufficient.
          const authority = await currentAuthority(tx, scope, { lock: true, mutation: true });
          await lockReadableMaterial(tx, authority, materialId);
          const material = rows(await tx.execute(sql`SELECT revision FROM channel_inventory_materials WHERE id = ${materialId} AND enterprise_id = ${scope.enterpriseId} FOR UPDATE`))[0];
          if (!material) fail("NOT_FOUND", NOT_FOUND_MESSAGE);
          const assignment = rows(await tx.execute(sql`
            SELECT id, teamId, currentOwnerUserId, revision FROM enterprise_team_record_assignments
             WHERE enterpriseId = ${scope.enterpriseId} AND recordType = 'channel_material' AND recordId = ${materialId}
             LIMIT 1 FOR UPDATE
          `))[0];
          const member = rows(await tx.execute(sql`
            SELECT tm.id, tm.teamId FROM enterprise_team_members tm
            INNER JOIN enterprise_teams t ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
             WHERE tm.enterpriseId = ${scope.enterpriseId} AND tm.userId = ${scope.actorUserId} LIMIT 1 FOR UPDATE
          `))[0];
          const previous = rows(await tx.execute(sql`
            SELECT enabled, share_team_id AS shareTeamId, owner_user_id AS ownerUserId,
                   assignment_revision AS assignmentRevision, owner_membership_id AS ownerMembershipId
              FROM channel_inventory_material_shares WHERE enterprise_id = ${scope.enterpriseId} AND material_id = ${materialId} LIMIT 1 FOR UPDATE
          `))[0];
          const prior = rows(await tx.execute(sql`
            SELECT material_id AS materialId, payload_hash AS payloadHash, after_data AS afterData
              FROM channel_inventory_material_share_audits
             WHERE enterprise_id = ${scope.enterpriseId} AND actor_user_id = ${scope.actorUserId} AND request_id = ${requestId} LIMIT 1 FOR UPDATE
          `))[0];
          if (prior) {
            if (Number(prior.materialId) !== materialId || String(prior.payloadHash) !== hash) fail("CONFLICT", "该请求号已用于不同的共享设置");
            const stillValid = bool(previous?.enabled) && Number(previous?.ownerUserId) === scope.actorUserId
              && member != null && assignment != null && Number(assignment.currentOwnerUserId) === scope.actorUserId
              && Number(previous?.shareTeamId) === Number(member.teamId) && Number(assignment.teamId) === Number(member.teamId)
              && Number(previous?.assignmentRevision) === Number(assignment.revision) && Number(previous?.ownerMembershipId) === Number(member.id);
            return { item: { materialId, enabled: stillValid, revision: Number(material.revision) }, idempotent: true };
          }
          if (Number(material.revision) !== expectedRevision) fail("CONFLICT", "库存已被其他人更新，请刷新后重试");
          if (enabled && (!assignment || !member || assignment.teamId == null
            || Number(assignment.currentOwnerUserId) !== scope.actorUserId
            || Number(assignment.teamId) !== Number(member.teamId))) {
            fail("FORBIDDEN", "仅当前负责人可向库存创建时归属且本人仍在的团队共享");
          }
          const shareTeamId = enabled ? Number(assignment!.teamId) : null;
          const assignmentRevision = enabled ? Number(assignment!.revision) : null;
          const membershipId = enabled ? Number(member!.id) : null;
          await tx.execute(sql`
            INSERT INTO channel_inventory_material_shares
              (enterprise_id, material_id, owner_user_id, enabled, share_team_id, assignment_revision, owner_membership_id, revision)
            VALUES (${scope.enterpriseId}, ${materialId}, ${scope.actorUserId}, ${enabled}, ${shareTeamId}, ${assignmentRevision}, ${membershipId}, 1)
            ON DUPLICATE KEY UPDATE owner_user_id = ${scope.actorUserId}, enabled = ${enabled}, share_team_id = ${shareTeamId},
              assignment_revision = ${assignmentRevision}, owner_membership_id = ${membershipId}, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3)
          `);
          const changed = await tx.execute(sql`
            UPDATE channel_inventory_materials SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3)
             WHERE id = ${materialId} AND enterprise_id = ${scope.enterpriseId} AND responsible_user_id = ${scope.actorUserId} AND revision = ${expectedRevision}
          `);
          if (affectedRows(changed) !== 1) fail("CONFLICT", "库存已被其他人更新，请刷新后重试");
          const item = { materialId, enabled, revision: expectedRevision + 1 };
          await tx.execute(sql`
            INSERT INTO channel_inventory_material_share_audits
              (enterprise_id, material_id, actor_user_id, request_id, payload_hash, before_data, after_data)
            VALUES (${scope.enterpriseId}, ${materialId}, ${scope.actorUserId}, ${requestId}, ${hash}, ${JSON.stringify(previous ?? null)},
              ${JSON.stringify({ ...item, shareTeamId, assignmentRevision, ownerMembershipId: membershipId })})
          `);
          return { item, idempotent: false };
        });
      } catch (error) {
        if (error instanceof ChannelNotesError) throw error;
        throw unavailable();
      }
    },

    async notesList(scope: ChannelInventoryScope, input: { materialId: number; page?: number; pageSize?: number }) {
      const materialId = positiveId(input.materialId, "库存");
      const { page, pageSize } = assertPage(input, 50);
      const db = await requiredDatabase(getDb);
      try {
        const authority = await currentAuthority(db, scope);
        const material = await findReadableMaterial(db, authority, materialId);
        if (!material) fail("NOT_FOUND", NOT_FOUND_MESSAGE);
        const notePredicates = [sql`n.enterpriseId = ${authority.enterpriseId}`, sql`n.materialId = ${materialId}`, ...materialPredicates(authority)];
        const noteWhere = whereAll(notePredicates);
        const total = Number(rows(await db.execute(sql`
          SELECT COUNT(*) AS total FROM channel_inventory_notes n
          INNER JOIN channel_inventory_materials m ON m.id = n.materialId AND m.enterprise_id = n.enterpriseId
          INNER JOIN channel_inventory_channels c ON c.id = m.channel_id
           AND c.enterprise_id = m.enterprise_id AND c.data_owner_user_id = m.data_owner_user_id
          WHERE ${noteWhere}
        `))[0]?.total ?? 0);
        const items = rows(await db.execute(sql`
          SELECT n.id, n.authorUserId, n.content, n.revision, n.createdAt, n.updatedAt,
                 COALESCE(NULLIF(u.name, ''), CONCAT('用户#', n.authorUserId)) AS authorName
            FROM channel_inventory_notes n
            INNER JOIN channel_inventory_materials m ON m.id = n.materialId AND m.enterprise_id = n.enterpriseId
            INNER JOIN channel_inventory_channels c ON c.id = m.channel_id
             AND c.enterprise_id = m.enterprise_id AND c.data_owner_user_id = m.data_owner_user_id
            LEFT JOIN users u ON u.id = n.authorUserId
           WHERE ${noteWhere}
           ORDER BY n.updatedAt DESC, n.id DESC
           LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        `)).map(row => ({ ...noteFrom(row), canEdit: authority.write && Number(row.authorUserId) === authority.actorUserId }));
        return {
          material: { id: Number(material.id), partNumber: String(material.partNumber), brand: String(material.brand), updatedAt: material.updatedAt as Date | string },
          legacyNote: nullableString(material.legacyNote), items, total, page, pageSize,
          canEdit: authority.write, readOnly: !authority.write,
        };
      } catch (error) {
        if (error instanceof ChannelNotesError) throw error;
        throw unavailable();
      }
    },

    async notesAdd(scope: ChannelInventoryScope, rawInput: { materialId: unknown; content: unknown; requestId: unknown }) {
      const input = serviceInputForAdd(rawInput);
      const hash = channelNotePayloadHash({ action: "notesAdd", materialId: input.materialId, content: input.content });
      return mutation(scope, "notesAdd", input.requestId, hash, async (tx, authority) => {
        const prior = await findAudit(tx, authority, input.requestId, true);
        if (prior) {
          await lockReadableMaterial(tx, authority, Number(prior.materialId));
          return auditReplay(prior, "notesAdd", hash);
        }
        await lockReadableMaterial(tx, authority, input.materialId);
        const created = await tx.execute(sql`
          INSERT INTO channel_inventory_notes (materialId, enterpriseId, authorUserId, content, revision, createdAt, updatedAt)
          VALUES (${input.materialId}, ${authority.enterpriseId}, ${authority.actorUserId}, ${input.content}, 1, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        `);
        const noteId = insertId(created);
        if (!noteId) throw unavailable();
        const item = await readNoteById(tx, authority, noteId);
        await insertAudit(tx, authority, { materialId: input.materialId, noteId, action: "notesAdd", requestId: input.requestId, payloadHash: hash, beforeData: null, afterData: item });
        return { item, idempotent: false } as const;
      });
    },

    async notesEdit(scope: ChannelInventoryScope, rawInput: { noteId: unknown; expectedRevision: unknown; content: unknown; requestId: unknown }) {
      const input = serviceInputForEdit(rawInput);
      const hash = channelNotePayloadHash({ action: "notesEdit", noteId: input.noteId, content: input.content, expectedRevision: input.expectedRevision });
      return mutation(scope, "notesEdit", input.requestId, hash, async (tx, authority) => {
        const prior = await findAudit(tx, authority, input.requestId, true);
        if (prior) {
          await lockReadableMaterial(tx, authority, Number(prior.materialId));
          return auditReplay(prior, "notesEdit", hash);
        }
        const note = await findNoteForUpdate(tx, authority, input.noteId);
        if (!note) fail("NOT_FOUND", NOT_FOUND_MESSAGE);
        await lockReadableMaterial(tx, authority, Number(note.materialId));
        if (Number(note.authorUserId) !== authority.actorUserId) fail("FORBIDDEN", "只能修改本人填写的备注");
        if (Number(note.revision) !== input.expectedRevision) fail("CONFLICT", "备注已被其他人更新，请刷新后重试");
        const beforeData = { id: Number(note.id), authorUserId: Number(note.authorUserId), content: String(note.content), revision: Number(note.revision), createdAt: note.createdAt, updatedAt: note.updatedAt };
        const changed = await tx.execute(sql`
          UPDATE channel_inventory_notes SET content = ${input.content}, revision = revision + 1, updatedAt = CURRENT_TIMESTAMP(3)
           WHERE id = ${input.noteId} AND enterpriseId = ${authority.enterpriseId}
             AND authorUserId = ${authority.actorUserId} AND revision = ${input.expectedRevision}
        `);
        if (affectedRows(changed) !== 1) fail("CONFLICT", "备注已被其他人更新，请刷新后重试");
        const item = await readNoteById(tx, authority, input.noteId);
        await insertAudit(tx, authority, { materialId: Number(note.materialId), noteId: input.noteId, action: "notesEdit", requestId: input.requestId, payloadHash: hash, beforeData, afterData: item });
        return { item, idempotent: false } as const;
      });
    },
  };
}
