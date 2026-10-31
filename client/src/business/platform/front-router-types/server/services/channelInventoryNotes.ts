import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { ChannelInventoryScope } from "./channelInventory";

export type ChannelNotesErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "PRECONDITION_FAILED"
  | "INTERNAL_SERVER_ERROR";

export class ChannelNotesError extends Error {
  readonly code: ChannelNotesErrorCode;

  constructor(code: ChannelNotesErrorCode, message: string) {
    super(message);
    this.name = "ChannelNotesError";
    this.code = code;
  }
}

type SqlResultRow = Record<string, unknown>;
type SqlExecutor = { execute(statement: SQL): Promise<unknown> };
type SqlDatabase = SqlExecutor & { transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T> };

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
  channelType: "factory" | "agent" | "trade" | "other";
  channelActive: boolean;
  /** Null for a colleague's shared row, so it cannot become a private-channel probe. */
  channelId: number | null;
  /** Historical material note; it is read-only and has no fabricated author. */
  note: string | null;
  noteCount: number;
  latestNote: null | { id: number; content: string; authorName: string; updatedAt: Date | string };
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

const CHANNEL_TYPES = ["factory", "agent", "trade", "other"] as const;
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

function scopeValues(scope: ChannelInventoryScope) {
  return {
    enterpriseId: positiveId(scope.enterpriseId, "企业"),
    dataOwnerUserId: positiveId(scope.dataOwnerUserId, "企业数据归属"),
    actorUserId: positiveId(scope.actorUserId, "当前账号"),
    isOwner: scope.isOwner === true,
    inventoryDataScope: String(scope.inventoryDataScope),
    permissionSnapshot: scope.permissionSnapshot === true,
  };
}

/** Context scope is only a snapshot. Every read checks actual membership; every write repeats this under locks. */
async function currentAuthority(executor: SqlExecutor, rawScope: ChannelInventoryScope, options: { lock?: boolean; mutation?: boolean } = {}) {
  const scope = scopeValues(rawScope);
  const suffix = options.lock ? sql` FOR UPDATE` : sql``;
  const row = rows(await executor.execute(sql`
    SELECT e.id AS enterpriseId, e.superAdminUserId, e.crmDataOwnerUserId,
           em.id AS memberId, em.role AS memberRole, em.status AS memberStatus,
           em.inventoryDataScope, u.loginDisabled
      FROM enterprises e
      INNER JOIN enterprise_members em ON em.enterpriseId = e.id AND em.userId = ${scope.actorUserId}
      INNER JOIN users u ON u.id = em.userId
     WHERE e.id = ${scope.enterpriseId}
     LIMIT 1${suffix}
  `))[0];
  const staleCode: ChannelNotesErrorCode = options.mutation ? "CONFLICT" : "FORBIDDEN";
  const staleMessage = options.mutation ? "企业权限状态已变化，请刷新后重试" : "当前企业权限已变化，请刷新后重试";
  if (!row || Number(row.crmDataOwnerUserId) !== scope.dataOwnerUserId) fail(staleCode, staleMessage);
  if (String(row.memberStatus) !== "active" || bool(row.loginDisabled)) fail(staleCode, staleMessage);
  const permissions = rows(await executor.execute(sql`
    SELECT permissionKey FROM enterprise_member_permissions
     WHERE enterpriseMemberId = ${Number(row.memberId)}${suffix}
  `));
  const isOwner = String(row.memberRole) === "super_admin" && Number(row.superAdminUserId) === scope.actorUserId;
  const hasInventoryManage = isOwner || permissions.some(permission => String(permission.permissionKey) === "inventory.manage");
  if (!scope.permissionSnapshot || !hasInventoryManage) fail("FORBIDDEN", "当前账号没有渠道库存管理权限");
  if (options.mutation && String(row.inventoryDataScope ?? "") !== scope.inventoryDataScope) fail("CONFLICT", "库存数据范围已变化，请刷新后重试");
  if (options.mutation && isOwner !== scope.isOwner) fail("CONFLICT", "企业权限状态已变化，请刷新后重试");
  return {
    enterpriseId: scope.enterpriseId,
    dataOwnerUserId: Number(row.crmDataOwnerUserId),
    actorUserId: scope.actorUserId,
    isOwner,
    inventoryDataScope: String(row.inventoryDataScope ?? ""),
  };
}

type Authority = Awaited<ReturnType<typeof currentAuthority>>;

function materialPredicates(authority: Authority): SQL[] {
  const predicates = [
    sql`m.enterprise_id = ${authority.enterpriseId}`,
    sql`m.data_owner_user_id = ${authority.dataOwnerUserId}`,
    sql`c.enterprise_id = ${authority.enterpriseId}`,
    sql`c.data_owner_user_id = ${authority.dataOwnerUserId}`,
  ];
  if (!authority.isOwner) {
    predicates.push(sql`(
      m.responsible_user_id = ${authority.actorUserId}
      OR EXISTS (
        SELECT 1 FROM enterprise_team_record_assignments own_record
         WHERE own_record.enterpriseId = m.enterprise_id
           AND own_record.recordType = 'channel_material'
           AND own_record.recordId = m.id
           AND (own_record.createdByUserId = ${authority.actorUserId} OR own_record.currentOwnerUserId = ${authority.actorUserId})
      )
      OR EXISTS (
        SELECT 1 FROM enterprise_team_record_assignments a
        INNER JOIN enterprise_team_members tm ON tm.enterpriseId = a.enterpriseId AND tm.userId = ${authority.actorUserId}
        INNER JOIN enterprise_teams t ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
         WHERE a.enterpriseId = m.enterprise_id
           AND a.recordType = 'channel_material'
           AND a.recordId = m.id
           AND a.teamId = tm.teamId
      )
    )`);
  }
  return predicates;
}

function visibleChannelIdExpression(authority: Authority): SQL {
  if (authority.isOwner) return sql`TRUE`;
  return sql`m.responsible_user_id = ${authority.actorUserId} AND c.responsible_user_id = ${authority.actorUserId}`;
}

function noteFrom(row: SqlResultRow): ChannelNote {
  return {
    id: Number(row.id), authorUserId: Number(row.authorUserId),
    authorName: row.authorName == null ? "未知用户" : String(row.authorName),
    content: String(row.content), revision: Number(row.revision),
    createdAt: row.createdAt as Date | string, updatedAt: row.updatedAt as Date | string,
  };
}

function sharedMaterialFrom(row: SqlResultRow): SharedChannelMaterial {
  const channelType = String(row.channelType);
  if (!(CHANNEL_TYPES as readonly string[]).includes(channelType)) throw unavailable();
  const latestNote = row.latestNoteId == null ? null : {
    id: Number(row.latestNoteId), content: String(row.latestNoteContent),
    authorName: row.latestNoteAuthorName == null ? "未知用户" : String(row.latestNoteAuthorName),
    updatedAt: row.latestNoteUpdatedAt as Date | string,
  };
  return {
    id: Number(row.id), partNumber: String(row.partNumber), brand: String(row.brand),
    qty: row.qty == null ? null : Number(row.qty), dateCode: nullableString(row.dateCode),
    price: nullableString(row.price), currency: "CNY", taxIncluded: row.taxIncluded == null ? null : bool(row.taxIncluded),
    leadTime: nullableString(row.leadTime), revision: Number(row.revision), updatedAt: row.updatedAt as Date | string,
    channelType: channelType as SharedChannelMaterial["channelType"], channelActive: bool(row.channelActive),
    channelId: row.channelId == null ? null : Number(row.channelId), note: nullableString(row.note),
    noteCount: Number(row.noteCount ?? 0), latestNote,
  };
}

async function findReadableMaterial(executor: SqlExecutor, authority: Authority, materialId: number) {
  const predicates = materialPredicates(authority);
  predicates.push(sql`m.id = ${materialId}`);
  return rows(await executor.execute(sql`
    SELECT m.id AS id, m.part_number AS partNumber, m.brand AS brand, m.note AS legacyNote,
           m.updated_at AS updatedAt, c.channel_type AS channelType
      FROM channel_inventory_materials m
      INNER JOIN channel_inventory_channels c ON c.id = m.channel_id
       AND c.enterprise_id = m.enterprise_id AND c.data_owner_user_id = m.data_owner_user_id
     WHERE ${whereAll(predicates)}
     LIMIT 1
  `))[0] ?? null;
}

async function lockReadableMaterial(tx: SqlExecutor, authority: Authority, materialId: number): Promise<number> {
  const base = rows(await tx.execute(sql`
    SELECT m.id AS id, m.responsible_user_id AS responsibleUserId
      FROM channel_inventory_materials m
      INNER JOIN channel_inventory_channels c ON c.id = m.channel_id
       AND c.enterprise_id = m.enterprise_id AND c.data_owner_user_id = m.data_owner_user_id
     WHERE m.id = ${materialId}
       AND m.enterprise_id = ${authority.enterpriseId} AND m.data_owner_user_id = ${authority.dataOwnerUserId}
       AND c.enterprise_id = ${authority.enterpriseId} AND c.data_owner_user_id = ${authority.dataOwnerUserId}
     LIMIT 1 FOR UPDATE
  `))[0];
  if (!base) fail("NOT_FOUND", NOT_FOUND_MESSAGE);
  if (authority.isOwner || Number(base.responsibleUserId) === authority.actorUserId) return Number(base.id);
  const team = rows(await tx.execute(sql`
    SELECT tm.teamId FROM enterprise_team_members tm
    INNER JOIN enterprise_teams t ON t.id = tm.teamId AND t.enterpriseId = tm.enterpriseId AND t.status = 'active'
     WHERE tm.enterpriseId = ${authority.enterpriseId} AND tm.userId = ${authority.actorUserId}
     LIMIT 1 FOR UPDATE
  `))[0];
  const assignment = rows(await tx.execute(sql`
    SELECT a.teamId, a.createdByUserId, a.currentOwnerUserId
      FROM enterprise_team_record_assignments a
     WHERE a.enterpriseId = ${authority.enterpriseId} AND a.recordType = 'channel_material' AND a.recordId = ${materialId}
     LIMIT 1 FOR UPDATE
  `))[0];
  if (!assignment) fail("NOT_FOUND", NOT_FOUND_MESSAGE);
  const readable = Number(assignment.createdByUserId) === authority.actorUserId
    || Number(assignment.currentOwnerUserId) === authority.actorUserId
    || (team !== undefined && Number(assignment.teamId) === Number(team.teamId));
  if (!readable) fail("NOT_FOUND", NOT_FOUND_MESSAGE);
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
    async listSharedMaterials(scope: ChannelInventoryScope, input: {
      partNumber?: string; brand?: string; channelId?: number; type?: SharedChannelMaterial["channelType"]; page?: number; pageSize?: number;
    } = {}) {
      const { page, pageSize } = assertPage(input, 20);
      const db = await requiredDatabase(getDb);
      try {
        const authority = await currentAuthority(db, scope);
        const predicates = materialPredicates(authority);
        if (input.partNumber) predicates.push(sql`m.part_number LIKE ${literalSearch(input.partNumber)} ESCAPE '='`);
        if (input.brand) predicates.push(sql`m.brand LIKE ${literalSearch(input.brand)} ESCAPE '='`);
        if (input.type !== undefined) {
          if (!(CHANNEL_TYPES as readonly string[]).includes(input.type)) fail("BAD_REQUEST", "渠道类型无效");
          predicates.push(sql`c.channel_type = ${input.type}`);
        }
        if (input.channelId !== undefined) {
          const channelId = positiveId(input.channelId, "渠道");
          if (!authority.isOwner) {
            predicates.push(sql`m.responsible_user_id = ${authority.actorUserId}`);
            predicates.push(sql`c.responsible_user_id = ${authority.actorUserId}`);
          }
          predicates.push(sql`m.channel_id = ${channelId}`);
        }
        const where = whereAll(predicates);
        const total = Number(rows(await db.execute(sql`
          SELECT COUNT(*) AS total FROM channel_inventory_materials m
          INNER JOIN channel_inventory_channels c ON c.id = m.channel_id
           AND c.enterprise_id = m.enterprise_id AND c.data_owner_user_id = m.data_owner_user_id
          WHERE ${where}
        `))[0]?.total ?? 0);
        const visibleChannelId = visibleChannelIdExpression(authority);
        const items = rows(await db.execute(sql`
          SELECT m.id AS id, m.part_number AS partNumber, m.brand, m.qty, m.date_code AS dateCode,
                 m.price, m.currency, m.tax_included AS taxIncluded, m.lead_time AS leadTime, m.note,
                 m.revision, m.updated_at AS updatedAt, c.channel_type AS channelType, c.active AS channelActive,
                 CASE WHEN ${visibleChannelId} THEN m.channel_id ELSE NULL END AS channelId,
                 (SELECT COUNT(*) FROM channel_inventory_notes note_count
                   WHERE note_count.enterpriseId = m.enterprise_id AND note_count.materialId = m.id) AS noteCount,
                 latest.id AS latestNoteId, latest.content AS latestNoteContent, latest.updatedAt AS latestNoteUpdatedAt,
                 COALESCE(NULLIF(latest_user.name, ''), CONCAT('用户#', latest.authorUserId)) AS latestNoteAuthorName
            FROM channel_inventory_materials m
            INNER JOIN channel_inventory_channels c ON c.id = m.channel_id
             AND c.enterprise_id = m.enterprise_id AND c.data_owner_user_id = m.data_owner_user_id
            LEFT JOIN channel_inventory_notes latest ON latest.id = (
              SELECT newest.id FROM channel_inventory_notes newest
               WHERE newest.enterpriseId = m.enterprise_id AND newest.materialId = m.id
               ORDER BY newest.updatedAt DESC, newest.id DESC LIMIT 1
            )
            LEFT JOIN users latest_user ON latest_user.id = latest.authorUserId
           WHERE ${where}
           ORDER BY m.updated_at DESC, m.id DESC
           LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
        `)).map(sharedMaterialFrom);
        return { items, total, page, pageSize };
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
        `)).map(row => ({ ...noteFrom(row), canEdit: Number(row.authorUserId) === authority.actorUserId }));
        return {
          material: { id: Number(material.id), partNumber: String(material.partNumber), brand: String(material.brand), channelType: String(material.channelType), updatedAt: material.updatedAt as Date | string },
          legacyNote: nullableString(material.legacyNote), items, total, page, pageSize,
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
