import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { adminUsers } from "../../drizzle/schema";
import {
  officialChannelAudits,
  officialChannelPublications,
  officialChannelSources,
  officialChannelStockNotes,
  officialChannelStocks,
  officialChannelTeamMembers,
  officialChannelTeams,
} from "../../drizzle/officialChannelSchema";
import { getDb } from "../db";
import {
  assertOfficialRecordAction,
  loadOfficialAccess,
  officialTeamPredicate,
} from "./officialChannelAccess";

/**
 * This module deliberately has no dependency on business-trpc, merchant scope,
 * ERP users, inventories, carts, or the public enquiry path.  It is the narrow
 * official-admin source of truth; a future public reader may read only the
 * dedicated official_channel_publications projection.
 */

export type OfficialInventoryActor = {
  adminUserId: number;
  sessionVersion: number;
};

type SourceType = "factory" | "agent" | "trade" | "other";
type StockStatus = "draft" | "published" | "offshelf";
type StockAction = "read" | "manage" | "publish" | "note";
type OfficialExecutor = any;
type OfficialAccess = any;
const OFFICIAL_PERMISSION_NAMES = new Set([
  "officialInventory.read",
  "officialInventory.write",
  "officialInventory.publish",
  "officialInventory.note",
]);

export class OfficialChannelInventoryError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OfficialChannelInventoryError";
  }
}

function fail(code: string): never {
  throw new OfficialChannelInventoryError(code);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Stable input canonicalization prevents key-order variants from bypassing request replay. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
    .join(",")}}`;
}

function requestPayloadHash(
  action: string,
  actor: OfficialInventoryActor,
  payload: unknown
): string {
  return createHash("sha256")
    .update(
      canonicalJson({ action, actorAdminUserId: actor.adminUserId, payload })
    )
    .digest("hex");
}

function assertExpectedRevision(
  actual: number,
  expected: number,
  conflictCode: string
) {
  if (
    !Number.isSafeInteger(actual) ||
    !Number.isSafeInteger(expected) ||
    actual !== expected
  ) {
    fail(conflictCode);
  }
}

function ensureKnownTeam(record: { teamId: number | null | undefined }) {
  if (!isPositiveInt(record.teamId))
    fail("OFFICIAL_CHANNEL_RECORD_TEAM_REQUIRED");
  return record.teamId;
}

function ensureCurrentTeam(access: OfficialAccess) {
  if (!isPositiveInt(access?.teamId))
    fail("OFFICIAL_CHANNEL_CURRENT_TEAM_REQUIRED");
  return access.teamId;
}

function hasNativePermission(
  access: OfficialAccess,
  permission: string
): boolean {
  return (
    Array.isArray(access?.permissions) &&
    access.permissions.includes(permission)
  );
}

/** A server-generated authority hint for the native admin UI; browser input never participates. */
function serverScope(access: OfficialAccess) {
  return {
    available: true,
    adminUserId: access.adminUserId,
    isSuperAdmin: access.isSuperAdmin === true,
    teamId: isPositiveInt(access.teamId) ? access.teamId : null,
    teamRole:
      access.teamRole === "leader" || access.teamRole === "member"
        ? access.teamRole
        : null,
    permissions: Array.isArray(access.permissions)
      ? access.permissions.filter(
          (permission: unknown) =>
            typeof permission === "string" &&
            OFFICIAL_PERMISSION_NAMES.has(permission)
        )
      : [],
  };
}

function canAct(
  access: OfficialAccess,
  record: { teamId: number | null; ownerAdminUserId: number | null },
  action: StockAction
): boolean {
  try {
    if (!isPositiveInt(record.teamId)) return false;
    assertOfficialRecordAction(access, record, action);
    return true;
  } catch {
    return false;
  }
}

function stockPermissions(
  access: OfficialAccess,
  stock: {
    teamId: number | null;
    ownerAdminUserId: number | null;
    status: string;
  }
) {
  const canEdit =
    hasNativePermission(access, "officialInventory.write") &&
    canAct(access, stock, "manage") &&
    stock.status !== "published";
  const canPublish =
    hasNativePermission(access, "officialInventory.publish") &&
    canAct(access, stock, "publish") &&
    stock.status !== "published";
  const canOffshelf =
    hasNativePermission(access, "officialInventory.publish") &&
    canAct(access, stock, "publish") &&
    stock.status === "published";
  const canAddNote =
    hasNativePermission(access, "officialInventory.note") &&
    canAct(access, stock, "note");
  return { canEdit, canPublish, canOffshelf, canAddNote };
}

function sourceOwnerRecord(source: any) {
  return {
    teamId: source.teamId,
    ownerAdminUserId: source.createdByAdminUserId,
  };
}

function sourceDto(source: any) {
  return {
    id: source.id,
    teamId: source.teamId,
    name: source.name,
    type: source.type as SourceType,
    contactName: source.contactName ?? null,
    phone: source.phone ?? null,
    wechat: source.wechat ?? null,
    qq: source.qq ?? null,
    notes: source.notes ?? null,
    active: Boolean(source.active),
    publicationApproved: Boolean(source.publicationApproved),
    everPublished: Boolean(source.everPublished),
    createdByAdminUserId: source.createdByAdminUserId,
    revision: source.revision,
    legacySourceId: source.legacySourceId ?? null,
    createdAt: toIso(source.createdAt),
    updatedAt: toIso(source.updatedAt),
  };
}

function stockDto(
  row: any,
  options: { detail?: boolean; access?: OfficialAccess } = {}
) {
  const stock = row.stock ?? row;
  const dto: Record<string, unknown> = {
    id: stock.id,
    sourceId: stock.sourceId,
    teamId: stock.teamId,
    ownerAdminUserId: stock.ownerAdminUserId,
    partNumber: stock.partNumber,
    brand: stock.brand,
    qty: stock.qty ?? null,
    dateCode: stock.dateCode ?? null,
    price: stock.price ?? null,
    currency: stock.currency,
    taxIncluded: stock.taxIncluded ?? null,
    leadTime: stock.leadTime ?? null,
    status: stock.status as StockStatus,
    revision: stock.revision,
    publishedAt: toIso(stock.publishedAt),
    createdAt: toIso(stock.createdAt),
    updatedAt: toIso(stock.updatedAt),
    sourceName: row.sourceName ?? null,
    sourceType: row.sourceType ?? null,
    responsibleName: row.responsibleName ?? null,
    // This is an internal-management summary only. It is deliberately absent from publication snapshots and CSV.
    latestNote: row.latestNoteBody
      ? {
          body: row.latestNoteBody,
          authorName: row.latestNoteAuthorName ?? null,
          createdAt: toIso(row.latestNoteCreatedAt),
        }
      : null,
    permissions: options.access
      ? stockPermissions(options.access, stock)
      : undefined,
  };
  if (options.detail) {
    dto.createdByAdminUserId = stock.createdByAdminUserId;
    dto.createdByName = row.createdByName ?? null;
    dto.note = stock.note ?? null;
    dto.createRequestId = stock.createRequestId;
    dto.legacyMaterialId = stock.legacyMaterialId ?? null;
  }
  return dto;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Excel/LibreOffice formula injection: prefix a literal apostrophe before RFC4180 escaping.
  const formulaSafe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

export function createOfficialChannelStocksCsv(
  rows: Array<Record<string, unknown>>
): string {
  const headers = [
    "库存ID",
    "来源",
    "来源类型",
    "型号",
    "品牌",
    "数量",
    "批次",
    "价格",
    "币种",
    "含税",
    "交期",
    "状态",
    "负责人",
    "创建时间",
    "发布时间",
  ];
  const lines = rows.map(row =>
    [
      row.id,
      row.sourceName,
      row.sourceType,
      row.partNumber,
      row.brand,
      row.qty,
      row.dateCode,
      row.price,
      row.currency,
      row.taxIncluded === null || row.taxIncluded === undefined
        ? ""
        : row.taxIncluded
          ? "是"
          : "否",
      row.leadTime,
      row.status,
      row.responsibleName,
      row.createdAt,
      row.publishedAt,
    ]
      .map(csvCell)
      .join(",")
  );
  return `\uFEFF${headers.map(csvCell).join(",")}\r\n${lines.join("\r\n")}`;
}

async function requireDb() {
  const db = await getDb();
  if (!db) fail("OFFICIAL_CHANNEL_DATABASE_NOT_AVAILABLE");
  return db;
}

async function withOfficialRead<T>(
  actor: OfficialInventoryActor,
  permission: "officialInventory.read" | "officialInventory.note",
  callback: (tx: OfficialExecutor, access: OfficialAccess) => Promise<T>
): Promise<T> {
  if (
    !isPositiveInt(actor.adminUserId) ||
    !isPositiveInt(actor.sessionVersion)
  ) {
    fail("OFFICIAL_CHANNEL_ACTOR_REQUIRED");
  }
  const db = await requireDb();
  return db.transaction(async tx => {
    // Read paths also reload the native account and current team before applying SQL scope.
    const access = await loadOfficialAccess(tx, actor, permission);
    return callback(tx, access);
  });
}

async function requestLock(tx: OfficialExecutor, requestId: string) {
  // MySQL GET_LOCK names are limited to 64 characters. Namespace before hashing
  // so every valid external requestId has an equally safe, collision-resistant key.
  const lockName = createHash("sha256")
    .update("official-channel-request:")
    .update(requestId)
    .digest("hex");
  const result = await tx.execute(
    sql`SELECT GET_LOCK(${lockName}, 10) AS acquired`
  );
  const row = (result as any)?.[0]?.[0] ?? (result as any)?.[0];
  if (Number(row?.acquired) !== 1)
    fail("OFFICIAL_CHANNEL_REQUEST_LOCK_UNAVAILABLE");
  return lockName;
}

async function releaseRequestLock(tx: OfficialExecutor, lockName: string) {
  // A named lock is connection-scoped on MySQL 8, not transaction-scoped.
  await tx.execute(sql`SELECT RELEASE_LOCK(${lockName}) AS released`);
}

async function priorRequestResult(
  tx: OfficialExecutor,
  requestId: string,
  payloadHash: string
) {
  const [prior] = await tx
    .select()
    .from(officialChannelAudits)
    .where(eq(officialChannelAudits.requestId, requestId))
    .limit(1)
    .for("update");
  if (!prior) return null;
  if (prior.payloadHash !== payloadHash)
    fail("OFFICIAL_CHANNEL_REQUEST_ID_REUSED");
  const after = jsonObject(prior.afterData);
  const result = after?.result;
  if (!result || typeof result !== "object" || Array.isArray(result))
    fail("OFFICIAL_CHANNEL_AUDIT_REPLAY_INVALID");
  return result as Record<string, unknown>;
}

async function writeAudit(
  tx: OfficialExecutor,
  input: {
    action: string;
    targetId: number | string;
    actor: OfficialInventoryActor;
    requestId: string;
    payloadHash: string;
    beforeData?: Record<string, unknown> | null;
    result: Record<string, unknown>;
    afterData?: Record<string, unknown> | null;
  }
) {
  await tx.insert(officialChannelAudits).values({
    action: input.action,
    targetId: String(input.targetId),
    actorAdminUserId: input.actor.adminUserId,
    requestId: input.requestId,
    payloadHash: input.payloadHash,
    beforeData: input.beforeData ?? null,
    afterData: { ...(input.afterData ?? {}), result: input.result },
  });
}

async function withOfficialWrite<T extends Record<string, unknown>>(
  actor: OfficialInventoryActor,
  permission:
    | "officialInventory.write"
    | "officialInventory.publish"
    | "officialInventory.note",
  action: string,
  requestId: string,
  payload: unknown,
  callback: (
    tx: OfficialExecutor,
    access: OfficialAccess,
    payloadHash: string
  ) => Promise<T>
): Promise<T & { idempotent: boolean }> {
  if (
    !isPositiveInt(actor.adminUserId) ||
    !isPositiveInt(actor.sessionVersion)
  ) {
    fail("OFFICIAL_CHANNEL_ACTOR_REQUIRED");
  }
  const db = await requireDb();
  const payloadHash = requestPayloadHash(action, actor, payload);
  return db.transaction(async tx => {
    const lockName = await requestLock(tx, requestId);
    try {
      // Reload/lock current backend account + native grants + team after the request lock.
      const access = await loadOfficialAccess(tx, actor, permission);
      const replay = await priorRequestResult(tx, requestId, payloadHash);
      if (replay)
        return { ...replay, idempotent: true } as T & { idempotent: boolean };
      const result = await callback(tx, access, payloadHash);
      return { ...result, idempotent: false };
    } finally {
      await releaseRequestLock(tx, lockName);
    }
  });
}

async function assertActiveTeam(tx: OfficialExecutor, teamId: number) {
  const [team] = await tx
    .select({ id: officialChannelTeams.id })
    .from(officialChannelTeams)
    .where(
      and(
        eq(officialChannelTeams.id, teamId),
        eq(officialChannelTeams.status, "active")
      )
    )
    .limit(1)
    .for("update");
  if (!team) fail("OFFICIAL_CHANNEL_TEAM_NOT_ACTIVE");
}

async function teamForNewSource(
  tx: OfficialExecutor,
  access: OfficialAccess,
  requestedTeamId?: number
) {
  const currentTeamId = access?.teamId;
  let teamId: number;
  if (access?.isSuperAdmin === true) {
    if (!isPositiveInt(requestedTeamId))
      fail("OFFICIAL_CHANNEL_SOURCE_TEAM_REQUIRED");
    teamId = requestedTeamId;
  } else {
    teamId = ensureCurrentTeam(access);
    if (requestedTeamId !== undefined && requestedTeamId !== teamId) {
      fail("OFFICIAL_CHANNEL_SOURCE_TEAM_FORBIDDEN");
    }
  }
  await assertActiveTeam(tx, teamId);
  // Explicitly use the local current-team assertion for ordinary employees.
  if (access?.isSuperAdmin !== true && currentTeamId !== teamId)
    fail("OFFICIAL_CHANNEL_CURRENT_TEAM_REQUIRED");
  return teamId;
}

async function sourceForCreateStock(
  tx: OfficialExecutor,
  access: OfficialAccess,
  sourceId: number
) {
  const [source] = await tx
    .select()
    .from(officialChannelSources)
    .where(
      and(
        eq(officialChannelSources.id, sourceId),
        eq(officialChannelSources.active, true),
        officialTeamPredicate(access, "official_channel_sources")
      )
    )
    .limit(1)
    .for("update");
  if (!source) fail("OFFICIAL_CHANNEL_SOURCE_NOT_FOUND_OR_INACTIVE");
  const teamId = ensureKnownTeam(source);
  // A super administrator may select an active source and derives the snapshot from it;
  // an ordinary employee must still be currently assigned to the source team.
  if (access?.isSuperAdmin !== true && ensureCurrentTeam(access) !== teamId) {
    fail("OFFICIAL_CHANNEL_SOURCE_OUT_OF_SCOPE");
  }
  await assertActiveTeam(tx, teamId);
  return source;
}

async function sourceForStockTeam(
  tx: OfficialExecutor,
  access: OfficialAccess,
  sourceId: number,
  teamId: number
) {
  const [source] = await tx
    .select()
    .from(officialChannelSources)
    .where(
      and(
        eq(officialChannelSources.id, sourceId),
        eq(officialChannelSources.teamId, teamId),
        eq(officialChannelSources.active, true),
        officialTeamPredicate(access, "official_channel_sources")
      )
    )
    .limit(1)
    .for("update");
  if (!source) fail("OFFICIAL_CHANNEL_SOURCE_NOT_FOUND_OR_INACTIVE");
  return source;
}

async function stockById(
  tx: OfficialExecutor,
  access: OfficialAccess,
  stockId: number,
  lock = false
) {
  let query = tx
    .select()
    .from(officialChannelStocks)
    .where(
      and(
        eq(officialChannelStocks.id, stockId),
        officialTeamPredicate(access, "official_channel_stocks")
      )
    )
    .limit(1);
  if (lock) query = query.for("update");
  const [stock] = await query;
  if (!stock) fail("OFFICIAL_CHANNEL_STOCK_NOT_FOUND");
  return stock;
}

async function sourceById(
  tx: OfficialExecutor,
  access: OfficialAccess,
  sourceId: number,
  lock = false
) {
  let query = tx
    .select()
    .from(officialChannelSources)
    .where(
      and(
        eq(officialChannelSources.id, sourceId),
        officialTeamPredicate(access, "official_channel_sources")
      )
    )
    .limit(1);
  if (lock) query = query.for("update");
  const [source] = await query;
  if (!source) fail("OFFICIAL_CHANNEL_SOURCE_NOT_FOUND");
  return source;
}

function assertManageSource(access: OfficialAccess, source: any) {
  ensureKnownTeam(source);
  assertOfficialRecordAction(access, sourceOwnerRecord(source), "manage");
}

function assertStockAction(
  access: OfficialAccess,
  stock: any,
  action: "manage" | "publish" | "note"
) {
  ensureKnownTeam(stock);
  assertOfficialRecordAction(
    access,
    {
      teamId: stock.teamId,
      ownerAdminUserId: stock.ownerAdminUserId,
    },
    action
  );
}

async function assertPublishableOwner(tx: OfficialExecutor, stock: any) {
  const teamId = ensureKnownTeam(stock);
  if (!isPositiveInt(stock.ownerAdminUserId))
    fail("OFFICIAL_CHANNEL_STOCK_OWNER_REQUIRED");
  const [owner] = await tx
    .select({ adminUserId: officialChannelTeamMembers.adminUserId })
    .from(officialChannelTeamMembers)
    .innerJoin(
      adminUsers,
      eq(adminUsers.id, officialChannelTeamMembers.adminUserId)
    )
    .innerJoin(
      officialChannelTeams,
      eq(officialChannelTeams.id, officialChannelTeamMembers.teamId)
    )
    .where(
      and(
        eq(officialChannelTeamMembers.teamId, teamId),
        eq(officialChannelTeamMembers.adminUserId, stock.ownerAdminUserId),
        eq(adminUsers.status, "active"),
        eq(officialChannelTeams.status, "active")
      )
    )
    .limit(1)
    .for("update");
  if (!owner) fail("OFFICIAL_CHANNEL_STOCK_OWNER_NOT_ACTIVE_IN_TEAM");
}

function assertStockPublishFields(stock: any) {
  if (!String(stock.partNumber ?? "").trim())
    fail("OFFICIAL_CHANNEL_STOCK_PART_NUMBER_REQUIRED");
  if (!String(stock.brand ?? "").trim())
    fail("OFFICIAL_CHANNEL_STOCK_BRAND_REQUIRED");
  if (!Number.isFinite(Number(stock.qty)) || Number(stock.qty) <= 0) {
    fail("OFFICIAL_CHANNEL_STOCK_QTY_REQUIRED_FOR_PUBLISH");
  }
}

/** Future public reads must use this snapshot, never a source/admin/team or normal-inventory join. */
export function buildOfficialChannelPublicProjection(
  stock: {
    partNumber: string;
    brand: string | null;
    qty: number | null;
    dateCode: string | null;
    price: string | null;
    currency: string;
    taxIncluded: boolean | null;
    leadTime: string | null;
  },
  publicId: string
) {
  return {
    listingKind: "factory_channel" as const,
    label: "工厂渠道",
    assistanceLabel: "平台协助询价",
    publicId,
    partNumber: stock.partNumber,
    brand: stock.brand,
    qty: stock.qty,
    dateCode: stock.dateCode ?? null,
    price: stock.price ?? null,
    currency: stock.currency,
    taxIncluded: stock.taxIncluded ?? null,
    leadTime: stock.leadTime ?? null,
  };
}

async function casStock(
  tx: OfficialExecutor,
  stock: any,
  values: Record<string, unknown>
) {
  const result = await tx
    .update(officialChannelStocks)
    .set({
      ...values,
      revision: sql`${officialChannelStocks.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(officialChannelStocks.id, stock.id),
        eq(officialChannelStocks.revision, stock.revision)
      )
    );
  if (Number((result as any)[0]?.affectedRows ?? 0) !== 1)
    fail("OFFICIAL_CHANNEL_STOCK_REVISION_CONFLICT");
  return stock.revision + 1;
}

async function casSource(
  tx: OfficialExecutor,
  source: any,
  values: Record<string, unknown>
) {
  const result = await tx
    .update(officialChannelSources)
    .set({
      ...values,
      revision: sql`${officialChannelSources.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(officialChannelSources.id, source.id),
        eq(officialChannelSources.revision, source.revision)
      )
    );
  if (Number((result as any)[0]?.affectedRows ?? 0) !== 1)
    fail("OFFICIAL_CHANNEL_SOURCE_REVISION_CONFLICT");
  return source.revision + 1;
}

const stockOwner = alias(adminUsers, "official_channel_stock_owner");
const stockCreator = alias(adminUsers, "official_channel_stock_creator");
const noteAuthor = alias(adminUsers, "official_channel_note_author");

async function stockDetailRow(
  tx: OfficialExecutor,
  access: OfficialAccess,
  stockId: number
) {
  const [row] = await tx
    .select({
      stock: officialChannelStocks,
      sourceName: officialChannelSources.name,
      sourceType: officialChannelSources.type,
      responsibleName: sql<string>`COALESCE(${stockOwner.displayName}, ${stockOwner.username})`,
      createdByName: sql<string>`COALESCE(${stockCreator.displayName}, ${stockCreator.username})`,
    })
    .from(officialChannelStocks)
    .innerJoin(
      officialChannelSources,
      eq(officialChannelSources.id, officialChannelStocks.sourceId)
    )
    .leftJoin(
      stockOwner,
      eq(stockOwner.id, officialChannelStocks.ownerAdminUserId)
    )
    .leftJoin(
      stockCreator,
      eq(stockCreator.id, officialChannelStocks.createdByAdminUserId)
    )
    .where(
      and(
        eq(officialChannelStocks.id, stockId),
        officialTeamPredicate(access, "official_channel_stocks")
      )
    )
    .limit(1);
  if (!row) fail("OFFICIAL_CHANNEL_STOCK_NOT_FOUND");
  return row;
}

export async function listOfficialChannelSources(
  actor: OfficialInventoryActor,
  input: {
    query?: string;
    active?: boolean;
    type?: SourceType;
    limit?: number;
    offset?: number;
  } = {}
) {
  return withOfficialRead(
    actor,
    "officialInventory.read",
    async (tx, access) => {
      const conditions = [
        officialTeamPredicate(access, "official_channel_sources"),
      ];
      if (input.active !== undefined)
        conditions.push(eq(officialChannelSources.active, input.active));
      if (input.type)
        conditions.push(eq(officialChannelSources.type, input.type));
      if (input.query)
        conditions.push(like(officialChannelSources.name, `%${input.query}%`));
      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;
      const [totalRow] = await tx
        .select({ total: sql<number>`COUNT(*)` })
        .from(officialChannelSources)
        .where(and(...conditions));
      const sources = await tx
        .select()
        .from(officialChannelSources)
        .where(and(...conditions))
        .orderBy(
          desc(officialChannelSources.updatedAt),
          desc(officialChannelSources.id)
        )
        .limit(limit)
        .offset(offset);
      const total = Number(totalRow?.total ?? 0);
      const scope = serverScope(access);
      return {
        items: sources.map(sourceDto),
        total,
        pageCount: Math.max(1, Math.ceil(total / limit)),
        serverScope: scope,
        currentAccess: scope,
      };
    }
  );
}

export async function getOfficialChannelSource(
  actor: OfficialInventoryActor,
  sourceId: number
) {
  return withOfficialRead(
    actor,
    "officialInventory.read",
    async (tx, access) => {
      const source = await sourceById(tx, access, sourceId);
      return { source: sourceDto(source) };
    }
  );
}

export async function createOfficialChannelSource(
  actor: OfficialInventoryActor,
  input: {
    requestId: string;
    teamId?: number;
    name: string;
    type: SourceType;
    contactName?: string | null;
    phone?: string | null;
    wechat?: string | null;
    qq?: string | null;
    notes?: string | null;
  }
) {
  return withOfficialWrite(
    actor,
    "officialInventory.write",
    "official_source_create",
    input.requestId,
    input,
    async (tx, access, payloadHash) => {
      const teamId = await teamForNewSource(tx, access, input.teamId);
      const [created] = await tx
        .insert(officialChannelSources)
        .values({
          teamId,
          name: input.name,
          type: input.type,
          contactName: input.contactName ?? null,
          phone: input.phone ?? null,
          wechat: input.wechat ?? null,
          qq: input.qq ?? null,
          notes: input.notes ?? null,
          active: true,
          publicationApproved: false,
          everPublished: false,
          createdByAdminUserId: actor.adminUserId,
          revision: 1,
        })
        .$returningId();
      if (!created?.id) fail("OFFICIAL_CHANNEL_SOURCE_CREATE_FAILED");
      const source = await sourceById(tx, access, created.id, true);
      const result = { source: sourceDto(source) };
      await writeAudit(tx, {
        action: "official_source_create",
        targetId: created.id,
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: null,
        afterData: { teamId },
        result,
      });
      return result;
    }
  );
}

export async function updateOfficialChannelSource(
  actor: OfficialInventoryActor,
  input: {
    sourceId: number;
    expectedRevision: number;
    requestId: string;
    name?: string;
    type?: SourceType;
    contactName?: string | null;
    phone?: string | null;
    wechat?: string | null;
    qq?: string | null;
    notes?: string | null;
    publicationApproved?: boolean;
  }
) {
  return withOfficialWrite(
    actor,
    "officialInventory.write",
    "official_source_update",
    input.requestId,
    input,
    async (tx, access, payloadHash) => {
      const source = await sourceById(tx, access, input.sourceId, true);
      assertManageSource(access, source);
      assertExpectedRevision(
        source.revision,
        input.expectedRevision,
        "OFFICIAL_CHANNEL_SOURCE_REVISION_CONFLICT"
      );
      const nameChanged =
        input.name !== undefined && input.name !== source.name;
      const typeChanged =
        input.type !== undefined && input.type !== source.type;
      if (
        source.everPublished &&
        !access.isSuperAdmin &&
        (nameChanged || typeChanged)
      ) {
        fail("OFFICIAL_CHANNEL_PUBLISHED_SOURCE_IMMUTABLE");
      }
      if (input.publicationApproved !== undefined && !access.isSuperAdmin) {
        fail("OFFICIAL_CHANNEL_SOURCE_APPROVAL_SUPER_ADMIN_REQUIRED");
      }
      const patch: Record<string, unknown> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.type !== undefined) patch.type = input.type;
      if (input.contactName !== undefined)
        patch.contactName = input.contactName;
      if (input.phone !== undefined) patch.phone = input.phone;
      if (input.wechat !== undefined) patch.wechat = input.wechat;
      if (input.qq !== undefined) patch.qq = input.qq;
      if (input.notes !== undefined) patch.notes = input.notes;
      if (input.publicationApproved !== undefined)
        patch.publicationApproved = input.publicationApproved;
      if (Object.keys(patch).length === 0)
        fail("OFFICIAL_CHANNEL_SOURCE_PATCH_REQUIRED");
      const nextRevision = await casSource(tx, source, patch);
      const updated = {
        ...source,
        ...patch,
        revision: nextRevision,
        updatedAt: new Date(),
      };
      const result = { source: sourceDto(updated) };
      await writeAudit(tx, {
        action: "official_source_update",
        targetId: source.id,
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: sourceDto(source),
        result,
      });
      return result;
    }
  );
}

export async function setOfficialChannelSourceActive(
  actor: OfficialInventoryActor,
  input: {
    sourceId: number;
    active: boolean;
    expectedRevision: number;
    requestId: string;
  }
) {
  return withOfficialWrite(
    actor,
    "officialInventory.write",
    "official_source_set_active",
    input.requestId,
    input,
    async (tx, access, payloadHash) => {
      const source = await sourceById(tx, access, input.sourceId, true);
      assertManageSource(access, source);
      assertExpectedRevision(
        source.revision,
        input.expectedRevision,
        "OFFICIAL_CHANNEL_SOURCE_REVISION_CONFLICT"
      );
      if (!input.active) {
        const [published] = await tx
          .select({ id: officialChannelStocks.id })
          .from(officialChannelStocks)
          .where(
            and(
              eq(officialChannelStocks.sourceId, source.id),
              eq(officialChannelStocks.status, "published")
            )
          )
          .limit(1)
          .for("update");
        if (published) fail("OFFICIAL_CHANNEL_SOURCE_HAS_PUBLISHED_STOCKS");
      }
      const nextRevision = await casSource(tx, source, {
        active: input.active,
      });
      const updated = {
        ...source,
        active: input.active,
        revision: nextRevision,
        updatedAt: new Date(),
      };
      const result = { source: sourceDto(updated) };
      await writeAudit(tx, {
        action: "official_source_set_active",
        targetId: source.id,
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: sourceDto(source),
        result,
      });
      return result;
    }
  );
}

export async function listOfficialChannelStocks(
  actor: OfficialInventoryActor,
  input: {
    sourceId?: number;
    status?: StockStatus;
    query?: string;
    limit?: number;
    offset?: number;
  } = {}
) {
  return withOfficialRead(
    actor,
    "officialInventory.read",
    async (tx, access) => {
      const conditions = [
        officialTeamPredicate(access, "official_channel_stocks"),
      ];
      if (input.sourceId)
        conditions.push(eq(officialChannelStocks.sourceId, input.sourceId));
      if (input.status)
        conditions.push(eq(officialChannelStocks.status, input.status));
      if (input.query) {
        const queryPredicate = or(
          like(officialChannelStocks.partNumber, `%${input.query}%`),
          like(officialChannelStocks.brand, `%${input.query}%`),
          like(officialChannelSources.name, `%${input.query}%`)
        );
        if (queryPredicate) conditions.push(queryPredicate);
      }
      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;
      const [totalRow] = await tx
        .select({ total: sql<number>`COUNT(*)` })
        .from(officialChannelStocks)
        .innerJoin(
          officialChannelSources,
          eq(officialChannelSources.id, officialChannelStocks.sourceId)
        )
        .where(and(...conditions));
      const rows = await tx
        .select({
          stock: officialChannelStocks,
          sourceName: officialChannelSources.name,
          sourceType: officialChannelSources.type,
          responsibleName: sql<string>`COALESCE(${stockOwner.displayName}, ${stockOwner.username})`,
          latestNoteBody: sql<string | null>`(
        SELECT official_channel_latest_note.body
          FROM official_channel_stock_notes AS official_channel_latest_note
         WHERE official_channel_latest_note.stockId = ${officialChannelStocks.id}
         ORDER BY official_channel_latest_note.id DESC
         LIMIT 1
      )`,
          latestNoteCreatedAt: sql<Date | null>`(
        SELECT official_channel_latest_note.createdAt
          FROM official_channel_stock_notes AS official_channel_latest_note
         WHERE official_channel_latest_note.stockId = ${officialChannelStocks.id}
         ORDER BY official_channel_latest_note.id DESC
         LIMIT 1
      )`,
          latestNoteAuthorName: sql<string | null>`(
        SELECT COALESCE(official_channel_latest_author.displayName, official_channel_latest_author.username)
          FROM official_channel_stock_notes AS official_channel_latest_note
          LEFT JOIN admin_users AS official_channel_latest_author
            ON official_channel_latest_author.id = official_channel_latest_note.authorAdminUserId
         WHERE official_channel_latest_note.stockId = ${officialChannelStocks.id}
         ORDER BY official_channel_latest_note.id DESC
         LIMIT 1
      )`,
        })
        .from(officialChannelStocks)
        .innerJoin(
          officialChannelSources,
          eq(officialChannelSources.id, officialChannelStocks.sourceId)
        )
        .leftJoin(
          stockOwner,
          eq(stockOwner.id, officialChannelStocks.ownerAdminUserId)
        )
        .where(and(...conditions))
        .orderBy(
          desc(officialChannelStocks.updatedAt),
          desc(officialChannelStocks.id)
        )
        .limit(limit)
        .offset(offset);
      const total = Number(totalRow?.total ?? 0);
      const scope = serverScope(access);
      return {
        items: rows.map((row: any) => stockDto(row, { access })),
        total,
        pageCount: Math.max(1, Math.ceil(total / limit)),
        serverScope: scope,
        currentAccess: scope,
      };
    }
  );
}

export async function getOfficialChannelStock(
  actor: OfficialInventoryActor,
  stockId: number
) {
  return withOfficialRead(
    actor,
    "officialInventory.read",
    async (tx, access) => {
      const row = await stockDetailRow(tx, access, stockId);
      return { stock: stockDto(row, { detail: true, access }) };
    }
  );
}

export async function createOfficialChannelStock(
  actor: OfficialInventoryActor,
  input: {
    requestId: string;
    sourceId: number;
    partNumber: string;
    brand: string;
    qty?: number | null;
    dateCode?: string | null;
    price?: string | null;
    currency?: "CNY";
    taxIncluded?: boolean | null;
    leadTime?: string | null;
    note?: string | null;
  }
) {
  return withOfficialWrite(
    actor,
    "officialInventory.write",
    "official_stock_create",
    input.requestId,
    input,
    async (tx, access, payloadHash) => {
      const source = await sourceForCreateStock(tx, access, input.sourceId);
      const teamId = ensureKnownTeam(source);
      const [created] = await tx
        .insert(officialChannelStocks)
        .values({
          sourceId: source.id,
          teamId,
          createdByAdminUserId: actor.adminUserId,
          ownerAdminUserId: actor.adminUserId,
          partNumber: input.partNumber,
          brand: input.brand,
          qty: input.qty ?? null,
          dateCode: input.dateCode ?? null,
          price: input.price ?? null,
          currency: input.currency ?? "CNY",
          taxIncluded: input.taxIncluded ?? null,
          leadTime: input.leadTime ?? null,
          note: input.note ?? null,
          status: "draft",
          revision: 1,
          createRequestId: input.requestId,
          createPayloadHash: payloadHash,
        })
        .$returningId();
      if (!created?.id) fail("OFFICIAL_CHANNEL_STOCK_CREATE_FAILED");
      const row = await stockDetailRow(tx, access, created.id);
      const result = { stock: stockDto(row, { detail: true, access }) };
      await writeAudit(tx, {
        action: "official_stock_create",
        targetId: created.id,
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: null,
        afterData: { teamId, sourceId: source.id },
        result,
      });
      return result;
    }
  );
}

export async function updateOfficialChannelStock(
  actor: OfficialInventoryActor,
  input: {
    stockId: number;
    expectedRevision: number;
    requestId: string;
    sourceId?: number;
    partNumber?: string;
    brand?: string;
    qty?: number | null;
    dateCode?: string | null;
    price?: string | null;
    currency?: "CNY";
    taxIncluded?: boolean | null;
    leadTime?: string | null;
    note?: string | null;
  }
) {
  return withOfficialWrite(
    actor,
    "officialInventory.write",
    "official_stock_update",
    input.requestId,
    input,
    async (tx, access, payloadHash) => {
      const stock = await stockById(tx, access, input.stockId, true);
      assertStockAction(access, stock, "manage");
      assertExpectedRevision(
        stock.revision,
        input.expectedRevision,
        "OFFICIAL_CHANNEL_STOCK_REVISION_CONFLICT"
      );
      if (stock.status === "published")
        fail("OFFICIAL_CHANNEL_PUBLISHED_STOCK_IMMUTABLE");
      const teamId = ensureKnownTeam(stock);
      if (input.sourceId !== undefined && input.sourceId !== stock.sourceId) {
        await sourceForStockTeam(tx, access, input.sourceId, teamId);
      }
      const patch: Record<string, unknown> = {};
      for (const key of [
        "sourceId",
        "partNumber",
        "brand",
        "qty",
        "dateCode",
        "price",
        "currency",
        "taxIncluded",
        "leadTime",
        "note",
      ] as const) {
        if (input[key] !== undefined) patch[key] = input[key];
      }
      if (Object.keys(patch).length === 0)
        fail("OFFICIAL_CHANNEL_STOCK_PATCH_REQUIRED");
      const nextRevision = await casStock(tx, stock, patch);
      const updatedRow = await stockDetailRow(tx, access, stock.id);
      const result = {
        stock: stockDto(updatedRow, { detail: true, access }),
      };
      await writeAudit(tx, {
        action: "official_stock_update",
        targetId: stock.id,
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: stockDto(stock, { detail: true }),
        result,
      });
      return result;
    }
  );
}

export async function publishOfficialChannelStock(
  actor: OfficialInventoryActor,
  input: {
    stockId: number;
    expectedRevision: number;
    requestId: string;
  }
) {
  return withOfficialWrite(
    actor,
    "officialInventory.publish",
    "official_stock_publish",
    input.requestId,
    input,
    async (tx, access, payloadHash) => {
      const stock = await stockById(tx, access, input.stockId, true);
      assertStockAction(access, stock, "publish");
      assertExpectedRevision(
        stock.revision,
        input.expectedRevision,
        "OFFICIAL_CHANNEL_STOCK_REVISION_CONFLICT"
      );
      if (stock.status === "published")
        fail("OFFICIAL_CHANNEL_STOCK_ALREADY_PUBLISHED");
      assertStockPublishFields(stock);
      const teamId = ensureKnownTeam(stock);
      await assertPublishableOwner(tx, stock);
      const source = await sourceForStockTeam(
        tx,
        access,
        stock.sourceId,
        teamId
      );
      if (!source.publicationApproved)
        fail("OFFICIAL_CHANNEL_SOURCE_NOT_PUBLICATION_APPROVED");
      const [existingPublication] = await tx
        .select({ stockId: officialChannelPublications.stockId })
        .from(officialChannelPublications)
        .where(eq(officialChannelPublications.stockId, stock.id))
        .limit(1)
        .for("update");
      if (existingPublication)
        fail("OFFICIAL_CHANNEL_PUBLICATION_STATE_CONFLICT");
      const publishedAt = new Date();
      const publicId = `ocp_${randomUUID().replace(/-/g, "")}`;
      const batchId = `ocb_${randomUUID().replace(/-/g, "")}`;
      const snapshot = buildOfficialChannelPublicProjection(stock, publicId);
      await tx.insert(officialChannelPublications).values({
        stockId: stock.id,
        publicId,
        snapshot,
        batchId,
        revision: 1,
        publishedAt,
        updatedAt: publishedAt,
      });
      const nextRevision = await casStock(tx, stock, {
        status: "published",
        publishedAt,
      });
      if (!source.everPublished) {
        const sourceResult = await tx
          .update(officialChannelSources)
          .set({
            everPublished: true,
            revision: sql`${officialChannelSources.revision} + 1`,
            updatedAt: publishedAt,
          })
          .where(
            and(
              eq(officialChannelSources.id, source.id),
              eq(officialChannelSources.revision, source.revision)
            )
          );
        if (Number((sourceResult as any)[0]?.affectedRows ?? 0) !== 1)
          fail("OFFICIAL_CHANNEL_SOURCE_REVISION_CONFLICT");
      }
      const result = {
        stockId: stock.id,
        status: "published" as const,
        revision: nextRevision,
        publicId,
        batchId,
        publishedAt: publishedAt.toISOString(),
      };
      await writeAudit(tx, {
        action: "official_stock_publish",
        targetId: stock.id,
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: stockDto(stock, { detail: true }),
        afterData: { snapshot },
        result,
      });
      return result;
    }
  );
}

export async function offshelfOfficialChannelStock(
  actor: OfficialInventoryActor,
  input: {
    stockId: number;
    expectedRevision: number;
    requestId: string;
  }
) {
  return withOfficialWrite(
    actor,
    "officialInventory.publish",
    "official_stock_offshelf",
    input.requestId,
    input,
    async (tx, access, payloadHash) => {
      const stock = await stockById(tx, access, input.stockId, true);
      assertStockAction(access, stock, "publish");
      assertExpectedRevision(
        stock.revision,
        input.expectedRevision,
        "OFFICIAL_CHANNEL_STOCK_REVISION_CONFLICT"
      );
      if (stock.status !== "published")
        fail("OFFICIAL_CHANNEL_STOCK_NOT_PUBLISHED");
      const [publication] = await tx
        .select()
        .from(officialChannelPublications)
        .where(eq(officialChannelPublications.stockId, stock.id))
        .limit(1)
        .for("update");
      if (!publication) fail("OFFICIAL_CHANNEL_PUBLICATION_STATE_CONFLICT");
      await tx
        .delete(officialChannelPublications)
        .where(eq(officialChannelPublications.stockId, stock.id));
      const nextRevision = await casStock(tx, stock, { status: "offshelf" });
      const result = {
        stockId: stock.id,
        status: "offshelf" as const,
        revision: nextRevision,
        removedPublicId: publication.publicId,
      };
      await writeAudit(tx, {
        action: "official_stock_offshelf",
        targetId: stock.id,
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: {
          ...stockDto(stock, { detail: true }),
          publicId: publication.publicId,
        },
        result,
      });
      return result;
    }
  );
}

export async function listOfficialChannelStockNotes(
  actor: OfficialInventoryActor,
  input: { stockId: number; limit?: number; offset?: number }
) {
  return withOfficialRead(
    actor,
    "officialInventory.read",
    async (tx, access) => {
      const rows = await tx
        .select({
          id: officialChannelStockNotes.id,
          stockId: officialChannelStockNotes.stockId,
          authorAdminUserId: officialChannelStockNotes.authorAdminUserId,
          authorName: sql<string>`COALESCE(${noteAuthor.displayName}, ${noteAuthor.username})`,
          body: officialChannelStockNotes.body,
          createdAt: officialChannelStockNotes.createdAt,
        })
        .from(officialChannelStockNotes)
        .innerJoin(
          officialChannelStocks,
          eq(officialChannelStocks.id, officialChannelStockNotes.stockId)
        )
        .leftJoin(
          noteAuthor,
          eq(noteAuthor.id, officialChannelStockNotes.authorAdminUserId)
        )
        .where(
          and(
            eq(officialChannelStockNotes.stockId, input.stockId),
            officialTeamPredicate(access, "official_channel_stocks")
          )
        )
        .orderBy(asc(officialChannelStockNotes.id))
        .limit(input.limit ?? 100)
        .offset(input.offset ?? 0);
      return {
        items: rows.map((row: any) => ({
          ...row,
          createdAt: toIso(row.createdAt),
        })),
      };
    }
  );
}

export async function addOfficialChannelStockNote(
  actor: OfficialInventoryActor,
  input: {
    stockId: number;
    body: string;
    requestId: string;
  }
) {
  return withOfficialWrite(
    actor,
    "officialInventory.note",
    "official_stock_note_add",
    input.requestId,
    input,
    async (tx, access, payloadHash) => {
      const stock = await stockById(tx, access, input.stockId, true);
      assertStockAction(access, stock, "note");
      const [created] = await tx
        .insert(officialChannelStockNotes)
        .values({
          stockId: stock.id,
          authorAdminUserId: actor.adminUserId,
          body: input.body,
          requestId: input.requestId,
          payloadHash,
        })
        .$returningId();
      if (!created?.id) fail("OFFICIAL_CHANNEL_NOTE_CREATE_FAILED");
      const result = {
        noteId: created.id,
        stockId: stock.id,
        authorAdminUserId: actor.adminUserId,
      };
      await writeAudit(tx, {
        action: "official_stock_note_add",
        targetId: stock.id,
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: null,
        afterData: { noteId: created.id },
        result,
      });
      return result;
    }
  );
}

export async function exportOfficialChannelStocks(
  actor: OfficialInventoryActor,
  input: { stockIds?: number[]; status?: StockStatus; sourceId?: number } = {}
) {
  return withOfficialRead(
    actor,
    "officialInventory.read",
    async (tx, access) => {
      const conditions = [
        officialTeamPredicate(access, "official_channel_stocks"),
      ];
      if (input.stockIds?.length)
        conditions.push(inArray(officialChannelStocks.id, input.stockIds));
      if (input.status)
        conditions.push(eq(officialChannelStocks.status, input.status));
      if (input.sourceId)
        conditions.push(eq(officialChannelStocks.sourceId, input.sourceId));
      const rows = await tx
        .select({
          id: officialChannelStocks.id,
          sourceName: officialChannelSources.name,
          sourceType: officialChannelSources.type,
          partNumber: officialChannelStocks.partNumber,
          brand: officialChannelStocks.brand,
          qty: officialChannelStocks.qty,
          dateCode: officialChannelStocks.dateCode,
          price: officialChannelStocks.price,
          currency: officialChannelStocks.currency,
          taxIncluded: officialChannelStocks.taxIncluded,
          leadTime: officialChannelStocks.leadTime,
          status: officialChannelStocks.status,
          responsibleName: sql<string>`COALESCE(${stockOwner.displayName}, ${stockOwner.username})`,
          createdAt: officialChannelStocks.createdAt,
          publishedAt: officialChannelStocks.publishedAt,
        })
        .from(officialChannelStocks)
        .innerJoin(
          officialChannelSources,
          eq(officialChannelSources.id, officialChannelStocks.sourceId)
        )
        .leftJoin(
          stockOwner,
          eq(stockOwner.id, officialChannelStocks.ownerAdminUserId)
        )
        .where(and(...conditions))
        .orderBy(
          desc(officialChannelStocks.updatedAt),
          desc(officialChannelStocks.id)
        );
      const safeRows = rows.map((row: any) => ({
        ...row,
        createdAt: toIso(row.createdAt),
        publishedAt: toIso(row.publishedAt),
      }));
      const date = new Date().toISOString().slice(0, 10);
      return {
        filename: `official-channel-stocks-${date}.csv`,
        contentType: "text/csv; charset=utf-8",
        csv: createOfficialChannelStocksCsv(safeRows),
        count: safeRows.length,
      };
    }
  );
}

export async function transferOfficialChannelStockOwner(
  actor: OfficialInventoryActor,
  input: {
    stockId: number;
    targetAdminUserId: number;
    reason: string;
    expectedRevision: number;
    requestId: string;
  }
) {
  return withOfficialWrite(
    actor,
    "officialInventory.write",
    "official_stock_transfer_owner",
    input.requestId,
    input,
    async (tx, access, payloadHash) => {
      if (access?.isSuperAdmin !== true)
        fail("OFFICIAL_CHANNEL_TRANSFER_SUPER_ADMIN_REQUIRED");
      const stock = await stockById(tx, access, input.stockId, true);
      const teamId = ensureKnownTeam(stock);
      assertExpectedRevision(
        stock.revision,
        input.expectedRevision,
        "OFFICIAL_CHANNEL_STOCK_REVISION_CONFLICT"
      );
      const [target] = await tx
        .select({
          id: adminUsers.id,
          displayName: adminUsers.displayName,
          username: adminUsers.username,
        })
        .from(officialChannelTeamMembers)
        .innerJoin(
          adminUsers,
          eq(adminUsers.id, officialChannelTeamMembers.adminUserId)
        )
        .innerJoin(
          officialChannelTeams,
          eq(officialChannelTeams.id, officialChannelTeamMembers.teamId)
        )
        .where(
          and(
            eq(officialChannelTeamMembers.teamId, teamId),
            eq(officialChannelTeamMembers.adminUserId, input.targetAdminUserId),
            eq(adminUsers.status, "active"),
            eq(officialChannelTeams.status, "active")
          )
        )
        .limit(1)
        .for("update");
      if (!target)
        fail("OFFICIAL_CHANNEL_TRANSFER_TARGET_NOT_ACTIVE_IN_ORIGINAL_TEAM");
      const nextRevision = await casStock(tx, stock, {
        ownerAdminUserId: target.id,
      });
      const result = {
        stockId: stock.id,
        ownerAdminUserId: target.id,
        responsibleName: target.displayName || target.username,
        revision: nextRevision,
        // Historical team and createdBy are intentionally absent from the patch and remain immutable.
        teamId,
      };
      await writeAudit(tx, {
        action: "official_stock_transfer_owner",
        targetId: stock.id,
        actor,
        requestId: input.requestId,
        payloadHash,
        beforeData: {
          ownerAdminUserId: stock.ownerAdminUserId,
          teamId,
          createdByAdminUserId: stock.createdByAdminUserId,
        },
        afterData: {
          ownerAdminUserId: target.id,
          teamId,
          reason: input.reason,
        },
        result,
      });
      return result;
    }
  );
}

/** Pure production helpers exposed only for isolated regression coverage; no DB mock is a runtime fallback. */
export const officialChannelInventoryTestUtils = {
  requestPayloadHash,
  assertExpectedRevision,
  assertStockPublishFields,
  stockPermissions,
};
