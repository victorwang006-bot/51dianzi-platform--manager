import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";

export const CHANNEL_INVENTORY_TYPES = ["factory", "agent", "trade", "other"] as const;
export type ChannelInventoryType = (typeof CHANNEL_INVENTORY_TYPES)[number];
export type ChannelInventoryErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "FORBIDDEN"
  | "PRECONDITION_FAILED"
  | "INTERNAL_SERVER_ERROR";

export class ChannelInventoryError extends Error {
  readonly code: ChannelInventoryErrorCode;

  constructor(code: ChannelInventoryErrorCode, message: string) {
    super(message);
    this.name = "ChannelInventoryError";
    this.code = code;
  }
}

type SqlResultRow = Record<string, unknown>;
type SqlExecutor = {
  execute(statement: SQL): Promise<unknown>;
};
type SqlDatabase = SqlExecutor & {
  transaction<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};

export type ChannelInventoryScope = {
  enterpriseId: number;
  dataOwnerUserId: number;
  actorUserId: number;
  isOwner: boolean;
  inventoryDataScope: "own" | "enterprise";
  /** Server-derived snapshot only; it is rechecked under locks for every write. */
  permissionSnapshot: boolean;
};

export type ChannelRecord = {
  id: number;
  enterpriseId: number;
  dataOwnerUserId: number;
  responsibleUserId: number;
  name: string;
  type: ChannelInventoryType;
  contactName: string | null;
  phone: string | null;
  wechat: string | null;
  qq: string | null;
  notes: string | null;
  active: boolean;
  revision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ChannelMaterialRecord = {
  id: number;
  channelId: number;
  channelName: string;
  channelType: ChannelInventoryType;
  channelActive: boolean;
  enterpriseId: number;
  dataOwnerUserId: number;
  responsibleUserId: number;
  partNumber: string;
  brand: string;
  qty: number | null;
  dateCode: string | null;
  price: string | null;
  currency: "CNY";
  taxIncluded: boolean | null;
  leadTime: string | null;
  note: string | null;
  revision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type ChannelCreateInput = {
  name: string;
  type: ChannelInventoryType;
  contactName: string | null;
  phone: string | null;
  wechat: string | null;
  qq: string | null;
  notes: string | null;
  active: boolean;
  requestId: string;
};

export type ChannelUpdateInput = {
  id: number;
  expectedRevision: number;
  name?: string;
  type?: ChannelInventoryType;
  contactName?: string | null;
  phone?: string | null;
  wechat?: string | null;
  qq?: string | null;
  notes?: string | null;
};

export type MaterialCreateInput = {
  channelId: number;
  partNumber: string;
  brand: string;
  qty: number | null;
  dateCode: string | null;
  price: string | null;
  currency: "CNY";
  taxIncluded: boolean | null;
  leadTime: string | null;
  note: string | null;
  requestId: string;
};

export type MaterialUpdateInput = {
  id: number;
  expectedRevision: number;
  channelId?: number;
  partNumber?: string;
  brand?: string;
  qty?: number | null;
  dateCode?: string | null;
  price?: string | null;
  currency?: "CNY";
  taxIncluded?: boolean | null;
  leadTime?: string | null;
  note?: string | null;
};

export type RegisterTeamRecord = (
  tx: SqlExecutor,
  record: {
    enterpriseId: number;
    recordType: "channel" | "channel_material";
    recordKey: number;
    actorUserId: number;
    currentOwnerUserId: number;
    parent?: { recordType: "channel"; recordKey: number };
  },
) => Promise<unknown>;

export type ChannelInventoryServiceDependencies = {
  getDb: () => Promise<SqlDatabase | null>;
  /**
   * Must be the real team-business adapter's transactional registration method.
   * There is intentionally no best-effort insert or no-op fallback: shared-note
   * visibility relies on immutable creator/current-owner assignment facts.
   */
  registerTeamRecord: RegisterTeamRecord;
};

const CHANNEL_COLUMNS = sql`
  id, enterprise_id AS enterpriseId, data_owner_user_id AS dataOwnerUserId,
  responsible_user_id AS responsibleUserId, name, channel_type AS type,
  contact_name AS contactName, phone, wechat, qq, notes, active, revision,
  created_at AS createdAt, updated_at AS updatedAt
`;
const MATERIAL_COLUMNS = sql`
  m.id AS id, m.channel_id AS channelId, c.name AS channelName,
  c.channel_type AS channelType, c.active AS channelActive,
  m.enterprise_id AS enterpriseId, m.data_owner_user_id AS dataOwnerUserId,
  m.responsible_user_id AS responsibleUserId, m.part_number AS partNumber,
  m.brand, m.qty, m.date_code AS dateCode, m.price, m.currency,
  m.tax_included AS taxIncluded, m.lead_time AS leadTime, m.note, m.revision,
  m.created_at AS createdAt, m.updated_at AS updatedAt
`;
const MATERIAL_WITH_CHANNEL_FROM = sql`
  FROM channel_inventory_materials m
  INNER JOIN channel_inventory_channels c
    ON c.id = m.channel_id
   AND c.enterprise_id = m.enterprise_id
   AND c.data_owner_user_id = m.data_owner_user_id
`;
const MAX_PAGE_SIZE = 100;

function appError(code: ChannelInventoryErrorCode, message: string): never {
  throw new ChannelInventoryError(code, message);
}

function databaseFailure(): ChannelInventoryError {
  return new ChannelInventoryError(
    "INTERNAL_SERVER_ERROR",
    "渠道库存服务暂不可用，请稍后重试",
  );
}

function rows(result: unknown): SqlResultRow[] {
  if (Array.isArray(result)) {
    const first = result[0];
    return Array.isArray(first) ? (first as SqlResultRow[]) : (result as SqlResultRow[]);
  }
  if (result && typeof result === "object" && "rows" in result) {
    const value = (result as { rows?: unknown }).rows;
    if (Array.isArray(value)) return value as SqlResultRow[];
  }
  return [];
}

function resultHeader(result: unknown): SqlResultRow {
  if (Array.isArray(result)) {
    const first = result[0];
    return first && !Array.isArray(first) && typeof first === "object"
      ? (first as SqlResultRow)
      : {};
  }
  return result && typeof result === "object" ? (result as SqlResultRow) : {};
}

function affectedRows(result: unknown): number {
  return Number(resultHeader(result).affectedRows ?? 0);
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

function isChannelType(value: string): value is ChannelInventoryType {
  return (CHANNEL_INVENTORY_TYPES as readonly string[]).includes(value);
}

function channelFrom(row: SqlResultRow): ChannelRecord {
  const type = String(row.type);
  if (!isChannelType(type)) throw databaseFailure();
  return {
    id: Number(row.id),
    enterpriseId: Number(row.enterpriseId),
    dataOwnerUserId: Number(row.dataOwnerUserId),
    responsibleUserId: Number(row.responsibleUserId),
    name: String(row.name),
    type,
    contactName: nullableString(row.contactName),
    phone: nullableString(row.phone),
    wechat: nullableString(row.wechat),
    qq: nullableString(row.qq),
    notes: nullableString(row.notes),
    active: bool(row.active),
    revision: Number(row.revision),
    createdAt: row.createdAt as Date | string,
    updatedAt: row.updatedAt as Date | string,
  };
}

function materialFrom(row: SqlResultRow): ChannelMaterialRecord {
  if (String(row.currency) !== "CNY") throw databaseFailure();
  const channelType = String(row.channelType);
  if (!isChannelType(channelType)) throw databaseFailure();
  return {
    id: Number(row.id),
    channelId: Number(row.channelId),
    channelName: String(row.channelName),
    channelType,
    channelActive: bool(row.channelActive),
    enterpriseId: Number(row.enterpriseId),
    dataOwnerUserId: Number(row.dataOwnerUserId),
    responsibleUserId: Number(row.responsibleUserId),
    partNumber: String(row.partNumber),
    brand: String(row.brand),
    qty: row.qty == null ? null : Number(row.qty),
    dateCode: nullableString(row.dateCode),
    price: nullableString(row.price),
    currency: "CNY",
    taxIncluded: row.taxIncluded == null ? null : bool(row.taxIncluded),
    leadTime: nullableString(row.leadTime),
    note: nullableString(row.note),
    revision: Number(row.revision),
    createdAt: row.createdAt as Date | string,
    updatedAt: row.updatedAt as Date | string,
  };
}

export function canonicalChannelInventoryJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalChannelInventoryJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalChannelInventoryJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function channelInventoryPayloadHash(value: unknown): string {
  return createHash("sha256")
    .update(canonicalChannelInventoryJson(value), "utf8")
    .digest("hex");
}

function ownScope(scope: ChannelInventoryScope): boolean {
  return !scope.isOwner && scope.inventoryDataScope === "own";
}

function channelScopePredicates(scope: ChannelInventoryScope, extra: SQL[] = []): SQL[] {
  return [
    sql`enterprise_id = ${scope.enterpriseId}`,
    sql`data_owner_user_id = ${scope.dataOwnerUserId}`,
    ...(ownScope(scope) ? [sql`responsible_user_id = ${scope.actorUserId}`] : []),
    ...extra,
  ];
}

function materialScopePredicates(scope: ChannelInventoryScope, extra: SQL[] = []): SQL[] {
  return [
    sql`enterprise_id = ${scope.enterpriseId}`,
    sql`data_owner_user_id = ${scope.dataOwnerUserId}`,
    ...(ownScope(scope) ? [sql`responsible_user_id = ${scope.actorUserId}`] : []),
    ...extra,
  ];
}

function materialWithChannelScopePredicates(scope: ChannelInventoryScope, extra: SQL[] = []): SQL[] {
  return [
    sql`m.enterprise_id = ${scope.enterpriseId}`,
    sql`m.data_owner_user_id = ${scope.dataOwnerUserId}`,
    sql`c.enterprise_id = ${scope.enterpriseId}`,
    sql`c.data_owner_user_id = ${scope.dataOwnerUserId}`,
    ...(ownScope(scope)
      ? [
          sql`m.responsible_user_id = ${scope.actorUserId}`,
          sql`c.responsible_user_id = ${scope.actorUserId}`,
        ]
      : []),
    ...extra,
  ];
}

function whereAll(predicates: SQL[]): SQL {
  return sql.join(predicates, sql` AND `);
}

function literalSearch(value: string): string {
  return `%${value.replace(/([=%_])/g, "=$1")}%`;
}

function assertPage(input: { page: number; pageSize: number }): void {
  if (!Number.isInteger(input.page) || input.page < 1 || input.page > 1_000_000) {
    appError("BAD_REQUEST", "页码无效");
  }
  if (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > MAX_PAGE_SIZE) {
    appError("BAD_REQUEST", `每页数量须在 1 到 ${MAX_PAGE_SIZE} 之间`);
  }
}

async function requiredDatabase(getDb: ChannelInventoryServiceDependencies["getDb"]): Promise<SqlDatabase> {
  try {
    const database = await getDb();
    if (!database) throw new Error("missing database");
    return database;
  } catch {
    throw databaseFailure();
  }
}

async function lockAndRevalidateMutationScope(tx: SqlExecutor, scope: ChannelInventoryScope): Promise<void> {
  const enterprise = rows(await tx.execute(sql`
    SELECT id, superAdminUserId, crmDataOwnerUserId
      FROM enterprises
     WHERE id = ${scope.enterpriseId}
     LIMIT 1
     FOR UPDATE
  `))[0];
  if (!enterprise || Number(enterprise.crmDataOwnerUserId) !== scope.dataOwnerUserId) {
    appError("CONFLICT", "企业数据归属已变化，请重新登录");
  }
  const actor = rows(await tx.execute(sql`
    SELECT em.id, em.userId, em.role, em.status, em.inventoryDataScope, u.loginDisabled
      FROM enterprise_members em
      INNER JOIN users u ON u.id = em.userId
     WHERE em.enterpriseId = ${scope.enterpriseId}
       AND em.userId = ${scope.actorUserId}
     LIMIT 1
     FOR UPDATE
  `))[0];
  if (!actor || String(actor.status) !== "active" || bool(actor.loginDisabled)) {
    appError("CONFLICT", "企业成员状态已变化，请重新登录");
  }
  if (String(actor.inventoryDataScope) !== scope.inventoryDataScope) {
    appError("CONFLICT", "库存数据范围已变化，请刷新后重试");
  }
  const currentOwner = String(actor.role) === "super_admin" && Number(enterprise.superAdminUserId) === scope.actorUserId;
  if (currentOwner !== scope.isOwner) {
    appError("CONFLICT", "企业权限状态已变化，请重新登录");
  }
  const permissions = rows(await tx.execute(sql`
    SELECT permissionKey
      FROM enterprise_member_permissions
     WHERE enterpriseMemberId = ${Number(actor.id)}
     FOR UPDATE
  `));
  const hasCurrentPermission = currentOwner || permissions.some(permission => String(permission.permissionKey) === "inventory.manage");
  if (!scope.permissionSnapshot || !hasCurrentPermission) {
    appError("CONFLICT", "企业权限状态已变化，请重新登录");
  }
}

async function findChannel(tx: SqlExecutor, scope: ChannelInventoryScope, id: number, lock = false): Promise<ChannelRecord | null> {
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const row = rows(await tx.execute(sql`
    SELECT ${CHANNEL_COLUMNS}
      FROM channel_inventory_channels
     WHERE ${whereAll(channelScopePredicates(scope, [sql`id = ${id}`]))}
     LIMIT 1${suffix}
  `))[0];
  return row ? channelFrom(row) : null;
}

async function findMaterial(tx: SqlExecutor, scope: ChannelInventoryScope, id: number, lock = false): Promise<ChannelMaterialRecord | null> {
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const row = rows(await tx.execute(sql`
    SELECT ${MATERIAL_COLUMNS}
      ${MATERIAL_WITH_CHANNEL_FROM}
     WHERE ${whereAll(materialWithChannelScopePredicates(scope, [sql`m.id = ${id}`]))}
     LIMIT 1${suffix}
  `))[0];
  return row ? materialFrom(row) : null;
}

async function lockActiveChannel(tx: SqlExecutor, scope: ChannelInventoryScope, id: number): Promise<ChannelRecord> {
  const channel = await findChannel(tx, scope, id, true);
  if (!channel) appError("NOT_FOUND", "渠道不存在或无权访问");
  if (!channel.active) appError("PRECONDITION_FAILED", "渠道已停用，不能新增或修改库存");
  return channel;
}

function duplicateKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && String((error as { code: unknown }).code) === "ER_DUP_ENTRY");
}

async function reconcileChannelCreate(db: SqlExecutor, scope: ChannelInventoryScope, requestId: string, payloadHash: string) {
  const row = rows(await db.execute(sql`
    SELECT ${CHANNEL_COLUMNS}, create_payload_hash AS createPayloadHash
      FROM channel_inventory_channels
     WHERE enterprise_id = ${scope.enterpriseId}
       AND data_owner_user_id = ${scope.dataOwnerUserId}
       AND create_request_id = ${requestId}
     LIMIT 1
  `))[0];
  if (!row) return null;
  if (String(row.createPayloadHash) !== payloadHash) appError("CONFLICT", "请求号已用于不同的渠道内容");
  const item = channelFrom(row);
  if (ownScope(scope) && item.responsibleUserId !== scope.actorUserId) appError("NOT_FOUND", "渠道不存在或无权访问");
  return { item, idempotent: true } as const;
}

async function reconcileMaterialCreate(db: SqlExecutor, scope: ChannelInventoryScope, requestId: string, payloadHash: string) {
  const row = rows(await db.execute(sql`
    SELECT ${MATERIAL_COLUMNS}, m.create_payload_hash AS createPayloadHash
      ${MATERIAL_WITH_CHANNEL_FROM}
     WHERE ${whereAll(materialWithChannelScopePredicates(scope, [sql`m.create_request_id = ${requestId}`]))}
     LIMIT 1
  `))[0];
  if (!row) return null;
  if (String(row.createPayloadHash) !== payloadHash) appError("CONFLICT", "请求号已用于不同的库存内容");
  const item = materialFrom(row);
  if (ownScope(scope) && item.responsibleUserId !== scope.actorUserId) appError("NOT_FOUND", "库存条目不存在或无权访问");
  return { item, idempotent: true } as const;
}

export function createChannelInventoryService(dependencies: ChannelInventoryServiceDependencies) {
  const { getDb, registerTeamRecord } = dependencies;

  async function transactional<T>(scope: ChannelInventoryScope, operation: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const db = await requiredDatabase(getDb);
    try {
      return await db.transaction(async tx => {
        await lockAndRevalidateMutationScope(tx, scope);
        return operation(tx);
      });
    } catch (error) {
      if (error instanceof ChannelInventoryError) throw error;
      throw databaseFailure();
    }
  }

  return {
    async listChannels(scope: ChannelInventoryScope, input: { name?: string; type?: ChannelInventoryType; active?: boolean; page: number; pageSize: number }) {
      assertPage(input);
      const db = await requiredDatabase(getDb);
      const predicates = channelScopePredicates(scope);
      if (input.name) predicates.push(sql`name LIKE ${literalSearch(input.name)} ESCAPE '='`);
      if (input.type) predicates.push(sql`channel_type = ${input.type}`);
      if (input.active !== undefined) predicates.push(sql`active = ${input.active}`);
      const where = whereAll(predicates);
      try {
        const total = Number(rows(await db.execute(sql`SELECT COUNT(*) AS total FROM channel_inventory_channels WHERE ${where}`))[0]?.total ?? 0);
        const items = rows(await db.execute(sql`
          SELECT ${CHANNEL_COLUMNS} FROM channel_inventory_channels
           WHERE ${where}
           ORDER BY id DESC
           LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
        `)).map(channelFrom);
        return { items, total, page: input.page, pageSize: input.pageSize, pageCount: Math.ceil(total / input.pageSize) };
      } catch (error) {
        if (error instanceof ChannelInventoryError) throw error;
        throw databaseFailure();
      }
    },

    async getChannel(scope: ChannelInventoryScope, id: number) {
      const db = await requiredDatabase(getDb);
      try {
        const item = await findChannel(db, scope, id);
        if (!item) appError("NOT_FOUND", "渠道不存在或无权访问");
        return item;
      } catch (error) {
        if (error instanceof ChannelInventoryError) throw error;
        throw databaseFailure();
      }
    },

    async createChannel(scope: ChannelInventoryScope, input: ChannelCreateInput) {
      const payloadHash = channelInventoryPayloadHash({
        name: input.name, type: input.type, contactName: input.contactName, phone: input.phone,
        wechat: input.wechat, qq: input.qq, notes: input.notes, active: input.active,
      });
      const db = await requiredDatabase(getDb);
      try {
        return await db.transaction(async tx => {
          await lockAndRevalidateMutationScope(tx, scope);
          const existing = rows(await tx.execute(sql`
            SELECT ${CHANNEL_COLUMNS}, create_payload_hash AS createPayloadHash
              FROM channel_inventory_channels
             WHERE enterprise_id = ${scope.enterpriseId}
               AND data_owner_user_id = ${scope.dataOwnerUserId}
               AND create_request_id = ${input.requestId}
             LIMIT 1 FOR UPDATE
          `))[0];
          if (existing) {
            if (String(existing.createPayloadHash) !== payloadHash) appError("CONFLICT", "请求号已用于不同的渠道内容");
            const item = channelFrom(existing);
            if (ownScope(scope) && item.responsibleUserId !== scope.actorUserId) appError("NOT_FOUND", "渠道不存在或无权访问");
            return { item, idempotent: true } as const;
          }
          await tx.execute(sql`
            INSERT INTO channel_inventory_channels (
              enterprise_id, data_owner_user_id, responsible_user_id, name, channel_type,
              contact_name, phone, wechat, qq, notes, active, revision, create_request_id, create_payload_hash
            ) VALUES (
              ${scope.enterpriseId}, ${scope.dataOwnerUserId}, ${scope.actorUserId}, ${input.name}, ${input.type},
              ${input.contactName}, ${input.phone}, ${input.wechat}, ${input.qq}, ${input.notes}, ${input.active}, 1,
              ${input.requestId}, ${payloadHash}
            )
          `);
          const created = rows(await tx.execute(sql`
            SELECT ${CHANNEL_COLUMNS} FROM channel_inventory_channels
             WHERE enterprise_id = ${scope.enterpriseId}
               AND data_owner_user_id = ${scope.dataOwnerUserId}
               AND create_request_id = ${input.requestId}
             LIMIT 1
          `))[0];
          if (!created) throw databaseFailure();
          await registerTeamRecord(tx, {
            enterpriseId: scope.enterpriseId, recordType: "channel", recordKey: Number(created.id),
            actorUserId: scope.actorUserId, currentOwnerUserId: scope.actorUserId,
          });
          return { item: channelFrom(created), idempotent: false } as const;
        });
      } catch (error) {
        if (error instanceof ChannelInventoryError) throw error;
        if (duplicateKey(error)) {
          try {
            const replay = await reconcileChannelCreate(db, scope, input.requestId, payloadHash);
            if (replay) return replay;
          } catch (reconcileError) {
            if (reconcileError instanceof ChannelInventoryError) throw reconcileError;
          }
        }
        throw databaseFailure();
      }
    },

    async updateChannel(scope: ChannelInventoryScope, input: ChannelUpdateInput) {
      return transactional(scope, async tx => {
        const current = await findChannel(tx, scope, input.id, true);
        if (!current) appError("NOT_FOUND", "渠道不存在或无权访问");
        if (current.revision !== input.expectedRevision) appError("CONFLICT", "渠道已被其他人更新，请刷新后重试");
        const assignments: SQL[] = [sql`revision = revision + 1`, sql`updated_at = CURRENT_TIMESTAMP(3)`];
        if (input.name !== undefined) assignments.push(sql`name = ${input.name}`);
        if (input.type !== undefined) assignments.push(sql`channel_type = ${input.type}`);
        if (input.contactName !== undefined) assignments.push(sql`contact_name = ${input.contactName}`);
        if (input.phone !== undefined) assignments.push(sql`phone = ${input.phone}`);
        if (input.wechat !== undefined) assignments.push(sql`wechat = ${input.wechat}`);
        if (input.qq !== undefined) assignments.push(sql`qq = ${input.qq}`);
        if (input.notes !== undefined) assignments.push(sql`notes = ${input.notes}`);
        const result = await tx.execute(sql`
          UPDATE channel_inventory_channels SET ${sql.join(assignments, sql`, `)}
           WHERE ${whereAll(channelScopePredicates(scope, [sql`id = ${input.id}`, sql`revision = ${input.expectedRevision}`]))}
        `);
        if (affectedRows(result) !== 1) appError("CONFLICT", "渠道已被其他人更新，请刷新后重试");
        const updated = await findChannel(tx, scope, input.id);
        if (!updated) throw databaseFailure();
        return updated;
      });
    },

    async setChannelActive(scope: ChannelInventoryScope, input: { id: number; active: boolean; expectedRevision: number }) {
      return transactional(scope, async tx => {
        const current = await findChannel(tx, scope, input.id, true);
        if (!current) appError("NOT_FOUND", "渠道不存在或无权访问");
        if (current.revision !== input.expectedRevision) appError("CONFLICT", "渠道已被其他人更新，请刷新后重试");
        const result = await tx.execute(sql`
          UPDATE channel_inventory_channels
             SET active = ${input.active}, revision = revision + 1, updated_at = CURRENT_TIMESTAMP(3)
           WHERE ${whereAll(channelScopePredicates(scope, [sql`id = ${input.id}`, sql`revision = ${input.expectedRevision}`]))}
        `);
        if (affectedRows(result) !== 1) appError("CONFLICT", "渠道已被其他人更新，请刷新后重试");
        const updated = await findChannel(tx, scope, input.id);
        if (!updated) throw databaseFailure();
        return updated;
      });
    },

    async listMaterials(scope: ChannelInventoryScope, input: { channelId?: number; partNumber?: string; brand?: string; page: number; pageSize: number }) {
      assertPage(input);
      const db = await requiredDatabase(getDb);
      const predicates = materialWithChannelScopePredicates(scope);
      if (input.channelId !== undefined) predicates.push(sql`m.channel_id = ${input.channelId}`);
      if (input.partNumber) predicates.push(sql`m.part_number LIKE ${literalSearch(input.partNumber)} ESCAPE '='`);
      if (input.brand) predicates.push(sql`m.brand LIKE ${literalSearch(input.brand)} ESCAPE '='`);
      const where = whereAll(predicates);
      try {
        const total = Number(rows(await db.execute(sql`SELECT COUNT(*) AS total ${MATERIAL_WITH_CHANNEL_FROM} WHERE ${where}`))[0]?.total ?? 0);
        const items = rows(await db.execute(sql`
          SELECT ${MATERIAL_COLUMNS} ${MATERIAL_WITH_CHANNEL_FROM}
           WHERE ${where}
           ORDER BY m.id DESC
           LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
        `)).map(materialFrom);
        return { items, total, page: input.page, pageSize: input.pageSize, pageCount: Math.ceil(total / input.pageSize) };
      } catch (error) {
        if (error instanceof ChannelInventoryError) throw error;
        throw databaseFailure();
      }
    },

    async getMaterial(scope: ChannelInventoryScope, id: number) {
      const db = await requiredDatabase(getDb);
      try {
        const item = await findMaterial(db, scope, id);
        if (!item) appError("NOT_FOUND", "库存条目不存在或无权访问");
        return item;
      } catch (error) {
        if (error instanceof ChannelInventoryError) throw error;
        throw databaseFailure();
      }
    },

    async createMaterial(scope: ChannelInventoryScope, input: MaterialCreateInput) {
      const payloadHash = channelInventoryPayloadHash({
        channelId: input.channelId, partNumber: input.partNumber, brand: input.brand, qty: input.qty,
        dateCode: input.dateCode, price: input.price, currency: input.currency,
        taxIncluded: input.taxIncluded, leadTime: input.leadTime, note: input.note,
      });
      const db = await requiredDatabase(getDb);
      try {
        return await db.transaction(async tx => {
          await lockAndRevalidateMutationScope(tx, scope);
          const existing = rows(await tx.execute(sql`
            SELECT ${MATERIAL_COLUMNS}, m.create_payload_hash AS createPayloadHash
              ${MATERIAL_WITH_CHANNEL_FROM}
             WHERE ${whereAll(materialWithChannelScopePredicates(scope, [sql`m.create_request_id = ${input.requestId}`]))}
             LIMIT 1 FOR UPDATE
          `))[0];
          if (existing) {
            if (String(existing.createPayloadHash) !== payloadHash) appError("CONFLICT", "请求号已用于不同的库存内容");
            const item = materialFrom(existing);
            if (ownScope(scope) && item.responsibleUserId !== scope.actorUserId) appError("NOT_FOUND", "库存条目不存在或无权访问");
            return { item, idempotent: true } as const;
          }
          await lockActiveChannel(tx, scope, input.channelId);
          await tx.execute(sql`
            INSERT INTO channel_inventory_materials (
              channel_id, enterprise_id, data_owner_user_id, responsible_user_id,
              part_number, brand, qty, date_code, price, currency, tax_included, lead_time, note,
              revision, create_request_id, create_payload_hash
            ) VALUES (
              ${input.channelId}, ${scope.enterpriseId}, ${scope.dataOwnerUserId}, ${scope.actorUserId},
              ${input.partNumber}, ${input.brand}, ${input.qty}, ${input.dateCode}, ${input.price},
              ${input.currency}, ${input.taxIncluded}, ${input.leadTime}, ${input.note},
              1, ${input.requestId}, ${payloadHash}
            )
          `);
          const created = rows(await tx.execute(sql`
            SELECT ${MATERIAL_COLUMNS} ${MATERIAL_WITH_CHANNEL_FROM}
             WHERE ${whereAll(materialWithChannelScopePredicates(scope, [sql`m.create_request_id = ${input.requestId}`]))}
             LIMIT 1
          `))[0];
          if (!created) throw databaseFailure();
          await registerTeamRecord(tx, {
            enterpriseId: scope.enterpriseId, recordType: "channel_material", recordKey: Number(created.id),
            actorUserId: scope.actorUserId, currentOwnerUserId: scope.actorUserId,
            parent: { recordType: "channel", recordKey: input.channelId },
          });
          return { item: materialFrom(created), idempotent: false } as const;
        });
      } catch (error) {
        if (error instanceof ChannelInventoryError) throw error;
        if (duplicateKey(error)) {
          try {
            const replay = await reconcileMaterialCreate(db, scope, input.requestId, payloadHash);
            if (replay) return replay;
          } catch (reconcileError) {
            if (reconcileError instanceof ChannelInventoryError) throw reconcileError;
          }
        }
        throw databaseFailure();
      }
    },

    async updateMaterial(scope: ChannelInventoryScope, input: MaterialUpdateInput) {
      return transactional(scope, async tx => {
        const current = await findMaterial(tx, scope, input.id, true);
        if (!current) appError("NOT_FOUND", "库存条目不存在或无权访问");
        if (current.revision !== input.expectedRevision) appError("CONFLICT", "库存条目已被其他人更新，请刷新后重试");
        await lockActiveChannel(tx, scope, input.channelId ?? current.channelId);
        const assignments: SQL[] = [sql`revision = revision + 1`, sql`updated_at = CURRENT_TIMESTAMP(3)`];
        if (input.channelId !== undefined) assignments.push(sql`channel_id = ${input.channelId}`);
        if (input.partNumber !== undefined) assignments.push(sql`part_number = ${input.partNumber}`);
        if (input.brand !== undefined) assignments.push(sql`brand = ${input.brand}`);
        if (input.qty !== undefined) assignments.push(sql`qty = ${input.qty}`);
        if (input.dateCode !== undefined) assignments.push(sql`date_code = ${input.dateCode}`);
        if (input.price !== undefined) assignments.push(sql`price = ${input.price}`);
        if (input.currency !== undefined) assignments.push(sql`currency = ${input.currency}`);
        if (input.taxIncluded !== undefined) assignments.push(sql`tax_included = ${input.taxIncluded}`);
        if (input.leadTime !== undefined) assignments.push(sql`lead_time = ${input.leadTime}`);
        if (input.note !== undefined) assignments.push(sql`note = ${input.note}`);
        const result = await tx.execute(sql`
          UPDATE channel_inventory_materials SET ${sql.join(assignments, sql`, `)}
           WHERE ${whereAll(materialScopePredicates(scope, [sql`id = ${input.id}`, sql`revision = ${input.expectedRevision}`]))}
        `);
        if (affectedRows(result) !== 1) appError("CONFLICT", "库存条目已被其他人更新，请刷新后重试");
        const updated = await findMaterial(tx, scope, input.id);
        if (!updated) throw databaseFailure();
        return updated;
      });
    },
  };
}
