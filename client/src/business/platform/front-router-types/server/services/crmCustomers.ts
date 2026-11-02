import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql, type SQLWrapper } from "drizzle-orm";
import type {
  CustomerAudit,
  CustomerData,
  CustomerFollowUp,
  CustomerMember,
  CustomerRecord,
} from "../../../shared/crmCustomers";
import { getDb } from "../db";
import { customerOwnershipQuerySchema, type CustomerOwnershipQuery, type CustomerOwnershipResult } from "../../../shared/customerOwnership";
import { consumeCustomerOwnershipQuota } from "../customerOwnershipQuota";
import { customerDataSchema } from "../../../shared/crmCustomers";
function validateWriteData(data: CustomerData): CustomerData {
  const checked = customerDataSchema.safeParse(data);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: checked.error.issues[0]?.message ?? "请检查客户信息", cause: checked.error });
  return checked.data;
}

/** Minimal SQL surface deliberately exposed to the additive customer-contacts service. */
export type CrmSqlExecutor = { execute: (query: string | SQLWrapper) => Promise<unknown> };

/** This scope is constructed only by the router from enterprisePermissionScope and ctx.user.id. */
export type CustomerServerScope = {
  enterpriseId: number;
  actorUserId: number;
  canManageAll: boolean;
};

type CustomerRow = {
  id: number;
  enterpriseId: number;
  assignedUserId: number;
  createdByUserId: number;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  scale: CustomerRecord["scale"];
  grade: CustomerRecord["grade"];
  stage: CustomerRecord["stage"];
  source: string | null;
  nextFollowUpAt: Date | string | null;
  lastFollowUpAt: Date | string | null;
  archivedAt: Date | string | null;
  archiveReason: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  version: number;
  assignedName: string | null;
  createdByName: string | null;
};

type MembershipRow = {
  id: number;
  userId: number;
  role: "super_admin" | "admin" | "member";
  status: "active" | "suspended";
  name: string | null;
  loginDisabled: number | boolean;
};

type LockedAccess = {
  canManageAll: boolean;
  actor: MembershipRow;
  members: Map<number, MembershipRow>;
  enterpriseOwnerUserId: number;
};

const CUSTOMER_PERMISSION = "customers.manage";
const CUSTOMER_ALL_PERMISSION = "customers.manage_all";
const BEIJING_TIME_ZONE = "Asia/Shanghai";
const EPOCH = "1970-01-01 00:00:00";
/** CRM DATETIME values are always explicit Beijing wall-clock values, never server defaults. */
export const CRM_NOW = sql`CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')`;

function resultRows<T>(result: unknown): T[] {
  return ((result as [T[], unknown] | undefined)?.[0] ?? []) as T[];
}

function resultHeader(result: unknown): { affectedRows?: number; insertId?: number } {
  return ((result as [{ affectedRows?: number; insertId?: number }, unknown] | undefined)?.[0] ?? {});
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

export function displayName(name: string | null | undefined, userId: number) {
  return name?.trim() || `用户${userId}`;
}

/** Keep matching conservative: trim/collapse whitespace, but never transliterate or remove punctuation. */
export function normalizeCustomerName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

/** Formatting spaces and common separators should not defeat a phone duplicate warning. */
export function normalizeCustomerPhone(value: string) {
  return value.trim().replace(/[\s\-()（）]/g, "");
}

export function normalizeCustomerEmail(value: string) {
  return value.trim().toLowerCase();
}

export function nullableText(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  return text || null;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  const parsed = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)
    ? new Date(raw.replace(" ", "T") + "+08:00")
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** CRM DATETIME columns intentionally hold Beijing wall-clock text, avoiding driver/session offset ambiguity. */
export function toBeijingSqlDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "时间格式无效" });
  }
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace("T", " ");
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function customerCreatePayloadHash(input: {
  data: CustomerData;
  initialFollowUp: string;
  confirmDuplicate: boolean;
}) {
  return hashPayload({
    kind: "create",
    data: canonicalData(input.data),
    initialFollowUp: input.initialFollowUp.trim(),
    confirmDuplicate: input.confirmDuplicate,
  });
}

export function customerFollowUpPayloadHash(input: {
  customerId: number;
  method: string;
  content: string;
  occurredAt: string;
  nextFollowUpAt: string | null;
  stage?: string;
  correctionOfId?: number;
}) {
  return hashPayload({
    kind: "followup",
    customerId: input.customerId,
    method: input.method,
    content: input.content.trim(),
    occurredAt: input.occurredAt,
    nextFollowUpAt: input.nextFollowUpAt,
    stage: input.stage ?? null,
    correctionOfId: input.correctionOfId ?? null,
  });
}

function canonicalData(data: CustomerData) {
  return {
    name: data.name.trim(),
    contactName: data.contactName.trim(),
    phone: data.phone.trim(),
    email: data.email.trim().toLowerCase(),
    province: data.province.trim(),
    city: data.city.trim(),
    district: data.district.trim(),
    address: data.address.trim(),
    scale: data.scale,
    grade: data.grade,
    stage: data.stage,
    source: data.source.trim(),
    nextFollowUpAt: data.nextFollowUpAt,
    assignedUserId: data.assignedUserId ?? null,
  };
}

function mapCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: Number(row.id),
    enterpriseId: Number(row.enterpriseId),
    assignedUserId: Number(row.assignedUserId),
    assignedName: displayName(row.assignedName, Number(row.assignedUserId)),
    createdByUserId: Number(row.createdByUserId),
    createdByName: displayName(row.createdByName, Number(row.createdByUserId)),
    name: row.name,
    contactName: row.contactName ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    province: row.province ?? "",
    city: row.city ?? "",
    district: row.district ?? "",
    address: row.address ?? "",
    scale: row.scale,
    grade: row.grade,
    stage: row.stage,
    source: row.source ?? "",
    nextFollowUpAt: iso(row.nextFollowUpAt),
    lastFollowUpAt: iso(row.lastFollowUpAt),
    archivedAt: iso(row.archivedAt),
    archiveReason: row.archiveReason ?? null,
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date(0).toISOString(),
    version: Number(row.version),
  };
}

function customerSelect() {
  return sql`
    SELECT c.id, c.enterpriseId, c.assignedUserId, c.createdByUserId, c.name,
           cc.contactName, cc.phone, cc.email,
           c.province, c.city, c.district, c.address, c.scale, c.grade, c.stage, c.source,
           c.nextFollowUpAt, c.lastFollowUpAt, c.archivedAt, c.archiveReason,
           c.createdAt, c.updatedAt, c.version,
           COALESCE(assigned.name, assigned.username, CONCAT('用户', assigned.id)) AS assignedName,
           COALESCE(creator.name, creator.username, CONCAT('用户', creator.id)) AS createdByName
      FROM crm_customers c
      LEFT JOIN crm_customer_contacts cc ON cc.customerId = c.id AND cc.isPrimary = 1
      LEFT JOIN users assigned ON assigned.id = c.assignedUserId
      LEFT JOIN users creator ON creator.id = c.createdByUserId
  `;
}

function scopeWhere(scope: CustomerServerScope, alias = "c") {
  return scope.canManageAll
    ? sql`${sql.raw(alias)}.enterpriseId = ${scope.enterpriseId}`
    : sql`${sql.raw(alias)}.enterpriseId = ${scope.enterpriseId} AND ${sql.raw(alias)}.assignedUserId = ${scope.actorUserId}`;
}

async function lockEnterpriseAndMembers(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
): Promise<LockedAccess> {
  const enterprise = resultRows<{ id: number; superAdminUserId: number }>(await tx.execute(sql`
    SELECT id, superAdminUserId FROM enterprises WHERE id = ${scope.enterpriseId} LIMIT 1 FOR UPDATE
  `))[0];
  if (!enterprise) throw new TRPCError({ code: "FORBIDDEN", message: "企业归属已变化，请重新登录" });

  // Keep the member lock phase before every customer business-row lock. This is the
  // same order as enterprise member handoff/leave, so a revoked or departed member
  // cannot slip a stale scoped write in between its authorization check and mutation.
  const members = resultRows<MembershipRow>(await tx.execute(sql`
    SELECT em.id, em.userId, em.role, em.status,
           COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS name,
           u.loginDisabled
      FROM enterprise_members em
      INNER JOIN users u ON u.id = em.userId
     WHERE em.enterpriseId = ${scope.enterpriseId}
     ORDER BY em.userId
     FOR UPDATE
  `));
  const memberByUserId = new Map(members.map(member => [Number(member.userId), member]));
  const actor = memberByUserId.get(scope.actorUserId);
  if (!actor || actor.status !== "active" || Boolean(actor.loginDisabled)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "企业成员身份已暂停" });
  }

  const owner = actor.role === "super_admin" || Number(enterprise.superAdminUserId) === scope.actorUserId;
  const permissions = owner ? [CUSTOMER_PERMISSION, CUSTOMER_ALL_PERMISSION] : resultRows<{ permissionKey: string }>(
    await tx.execute(sql`
      SELECT permissionKey FROM enterprise_member_permissions
       WHERE enterpriseMemberId = ${actor.id}
       FOR UPDATE
    `),
  ).map(row => row.permissionKey);
  const canManage = owner || permissions.includes(CUSTOMER_PERMISSION) || permissions.includes(CUSTOMER_ALL_PERMISSION);
  if (!canManage) throw new TRPCError({ code: "FORBIDDEN", message: "您没有客户管理权限" });

  return {
    canManageAll: owner || permissions.includes(CUSTOMER_ALL_PERMISSION),
    actor,
    members: memberByUserId,
    enterpriseOwnerUserId: Number(enterprise.superAdminUserId),
  };
}

function assertTargetCanOwn(access: LockedAccess, targetUserId: number, enterpriseOwnerUserId?: number) {
  const target = access.members.get(targetUserId);
  const owner = target?.role === "super_admin" || targetUserId === enterpriseOwnerUserId;
  if (!target || target.status !== "active" || Boolean(target.loginDisabled)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "负责人必须是本企业可登录的活跃成员" });
  }
  if (owner) return;
  // Target permissions were not loaded by lockEnterpriseAndMembers because only actor needs a fresh permissions query.
  // The caller performs the explicitly locked per-target lookup before it calls this helper.
}

async function assertTargetHasCustomerPermission(
  tx: CrmSqlExecutor,
  scope: CustomerServerScope,
  access: LockedAccess,
  targetUserId: number,
) {
  assertTargetCanOwn(access, targetUserId, access.enterpriseOwnerUserId);
  const target = access.members.get(targetUserId)!;
  const owner = target.role === "super_admin" || targetUserId === access.enterpriseOwnerUserId;
  if (owner) return;
  const permissions = resultRows<{ permissionKey: string }>(await tx.execute(sql`
    SELECT permissionKey FROM enterprise_member_permissions
     WHERE enterpriseMemberId = ${target.id}
     FOR UPDATE
  `)).map(row => row.permissionKey);
  if (!permissions.includes(CUSTOMER_PERMISSION) && !permissions.includes(CUSTOMER_ALL_PERMISSION)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "负责人必须拥有客户管理权限" });
  }
}

async function lockCustomer(tx: CrmSqlExecutor, enterpriseId: number, id: number) {
  const row = resultRows<CustomerRow>(await tx.execute(sql`
    SELECT c.* FROM crm_customers c
     WHERE c.enterpriseId = ${enterpriseId} AND c.id = ${id}
     LIMIT 1 FOR UPDATE
  `))[0];
  return row;
}

function assertCustomerAccess(customer: CustomerRow | undefined, scope: CustomerServerScope, canManageAll: boolean) {
  if (!customer || (!canManageAll && Number(customer.assignedUserId) !== scope.actorUserId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "客户不存在" });
  }
  return customer;
}

/** The locked customer shape intentionally exposes only fields required by contacts. */
export type CrmCustomerContactCustomer = Pick<
  CustomerRow,
  "id" | "assignedUserId" | "name" | "archivedAt" | "version"
>;

export type CrmCustomerContactTransaction = {
  tx: CrmSqlExecutor;
  customer: CrmCustomerContactCustomer;
  canManageAll: boolean;
};

/**
 * Reuses the established member-lock → customer-lock order before any contact mutation.
 * `scope.canManageAll` is deliberately ignored in favor of the freshly locked permission.
 */
export async function withCrmCustomerContactTransaction<T>(
  scope: CustomerServerScope,
  customerId: number,
  run: (context: CrmCustomerContactTransaction) => Promise<T>,
): Promise<T> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const access = await lockEnterpriseAndMembers(tx, scope);
    const customer = assertCustomerAccess(
      await lockCustomer(tx, scope.enterpriseId, customerId),
      scope,
      access.canManageAll,
    );
    return run({ tx, customer, canManageAll: access.canManageAll });
  });
}

/**
 * Read-only contact summaries still re-check the active enterprise member under the
 * normal member lock; no collaborator or member/grant data is returned to callers.
 */
export async function withCrmCustomerContactRead<T>(
  scope: CustomerServerScope,
  run: (context: { tx: CrmSqlExecutor; canManageAll: boolean }) => Promise<T>,
): Promise<T> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const access = await lockEnterpriseAndMembers(tx, scope);
    return run({ tx, canManageAll: access.canManageAll });
  });
}

async function insertAudit(
  tx: CrmSqlExecutor,
  input: { enterpriseId: number; customerId: number; actorUserId: number; action: string; note: string; requestId?: string | null },
) {
  await tx.execute(sql`
    INSERT INTO crm_customer_audits (enterpriseId, customerId, actorUserId, action, note, requestId, createdAt)
    VALUES (${input.enterpriseId}, ${input.customerId}, ${input.actorUserId}, ${input.action}, ${input.note.slice(0, 500)}, ${input.requestId ?? null}, ${CRM_NOW})
  `);
}

/** Narrow bridge for the additive contacts audit; no generic customer data is exposed. */
export async function insertCrmCustomerContactAudit(
  tx: CrmSqlExecutor,
  input: { enterpriseId: number; customerId: number; actorUserId: number; action: string; note: string; requestId?: string | null },
) {
  await insertAudit(tx, input);
}

async function reserveRequest(
  tx: CrmSqlExecutor,
  input: { enterpriseId: number; actorUserId: number; requestId: string; action: "create" | "followup"; payloadHash: string },
) {
  const existing = resultRows<{ action: string; payloadHash: string; customerId: number; recordId: number | null }>(await tx.execute(sql`
    SELECT action, payloadHash, customerId, recordId FROM crm_customer_requests
     WHERE enterpriseId = ${input.enterpriseId} AND actorUserId = ${input.actorUserId} AND requestId = ${input.requestId}
     LIMIT 1 FOR UPDATE
  `))[0];
  if (existing) {
    if (existing.action !== input.action || existing.payloadHash !== input.payloadHash) {
      throw new TRPCError({ code: "CONFLICT", message: "请求号已用于不同内容" });
    }
    if (Number(existing.customerId) > 0 && (input.action === "create" || existing.recordId != null)) {
      return { replayed: true as const, customerId: Number(existing.customerId), recordId: existing.recordId == null ? null : Number(existing.recordId) };
    }
    throw new TRPCError({ code: "CONFLICT", message: "请求正在处理中，请稍后重试" });
  }
  await tx.execute(sql`
    INSERT INTO crm_customer_requests (enterpriseId, actorUserId, requestId, action, payloadHash, customerId, recordId, createdAt)
    VALUES (${input.enterpriseId}, ${input.actorUserId}, ${input.requestId}, ${input.action}, ${input.payloadHash}, 0, NULL, ${CRM_NOW})
  `);
  return { replayed: false as const, customerId: 0, recordId: null };
}

type DuplicateMatchRow = { id: number; name: string; assignedName: string | null; archivedAt: Date | string | null; assignedUserId: number };

async function duplicateRows(
  executor: CrmSqlExecutor,
  scope: CustomerServerScope,
  input: { name: string; phone?: string; email?: string; excludeId?: number },
  canManageAll = scope.canManageAll,
) {
  const normalizedName = normalizeCustomerName(input.name);
  const normalizedPhone = normalizeCustomerPhone(input.phone ?? "");
  const normalizedEmail = normalizeCustomerEmail(input.email ?? "");
  const comparisons = [sql`c.nameNormalized = ${normalizedName}`];
  if (normalizedPhone) comparisons.push(sql`cc.phoneNormalized = ${normalizedPhone}`);
  if (normalizedEmail) comparisons.push(sql`cc.emailNormalized = ${normalizedEmail}`);
  const match = sql.join(comparisons.map(part => sql`(${part})`), sql` OR `);
  const exclude = input.excludeId
    ? (canManageAll
      ? sql`AND c.id <> ${input.excludeId}`
      : sql`AND (c.id <> ${input.excludeId} OR c.assignedUserId <> ${scope.actorUserId})`)
    : sql``;
  return resultRows<DuplicateMatchRow>(await executor.execute(sql`
    SELECT c.id, c.name, c.assignedUserId, c.archivedAt,
           COALESCE(assigned.name, assigned.username, CONCAT('用户', assigned.id)) AS assignedName
      FROM crm_customers c
      LEFT JOIN crm_customer_contacts cc ON cc.customerId = c.id AND cc.isPrimary = 1
      LEFT JOIN users assigned ON assigned.id = c.assignedUserId
     WHERE c.enterpriseId = ${scope.enterpriseId}
       AND (${match})
       ${exclude}
     ORDER BY c.updatedAt DESC, c.id DESC
     LIMIT 50
  `));
}

async function duplicateState(
  executor: CrmSqlExecutor,
  scope: CustomerServerScope,
  input: { name: string; phone?: string; email?: string; excludeId?: number },
  canManageAll: boolean,
) {
  const rows = await duplicateRows(executor, scope, input, canManageAll);
  const visible = canManageAll ? rows : rows.filter(row => Number(row.assignedUserId) === scope.actorUserId);
  return { rows, visible, restricted: rows.length > visible.length };
}

function throwDuplicate(restricted: boolean): never {
  throw new TRPCError({
    code: "CONFLICT",
    message: restricted ? "检测到相似客户，请确认后继续" : "已存在相似客户，请确认后继续",
  });
}

/** Limited duplicate primitive needed by updateBasic; it preserves the original leak-safe wording. */
export async function crmCustomerDuplicateState(
  executor: CrmSqlExecutor,
  scope: CustomerServerScope,
  input: { name: string; phone?: string; email?: string; excludeId?: number },
  canManageAll: boolean,
) {
  return duplicateState(executor, scope, input, canManageAll);
}

export function throwCrmCustomerDuplicate(restricted: boolean): never {
  return throwDuplicate(restricted);
}

export type CrmCustomerCreateExtension = {
  readonly payloadHash: string;
  readonly afterCustomerCreated: (context: {
    tx: CrmSqlExecutor;
    scope: CustomerServerScope;
    customerId: number;
    requestId: string;
  }) => Promise<void>;
};

const trustedCustomerCreateExtensions = new WeakSet<CrmCustomerCreateExtension>();

/**
 * Only server modules can create this opaque hook. It lets createMulti stay in the
 * existing customer-create transaction without making contact internals HTTP input.
 */
export function prepareCrmCustomerCreateExtension(
  extension: CrmCustomerCreateExtension,
): CrmCustomerCreateExtension {
  if (!/^[a-f0-9]{64}$/.test(extension.payloadHash)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "联系人创建请求无效" });
  }
  trustedCustomerCreateExtensions.add(extension);
  return extension;
}

export async function getCustomerContext(scope: CustomerServerScope): Promise<{
  actorUserId: number;
  canManageAll: boolean;
  members: CustomerMember[];
}> {
  const db = await requireDb();
  const actor = resultRows<MembershipRow & { superAdminUserId: number }>(await db.execute(sql`
    SELECT em.id, em.userId, em.role, em.status,
           COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS name, u.loginDisabled,
           e.superAdminUserId
      FROM enterprise_members em INNER JOIN users u ON u.id = em.userId
      INNER JOIN enterprises e ON e.id = em.enterpriseId
     WHERE em.enterpriseId = ${scope.enterpriseId} AND em.userId = ${scope.actorUserId}
     LIMIT 1
  `))[0];
  if (!actor || actor.status !== "active" || Boolean(actor.loginDisabled)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前企业成员不可用" });
  }
  const owner = actor.role === "super_admin" || Number(actor.superAdminUserId) === scope.actorUserId;
  const permissionRows = owner ? [{ permissionKey: CUSTOMER_ALL_PERMISSION }] : resultRows<{ permissionKey: string }>(await db.execute(sql`
    SELECT p.permissionKey FROM enterprise_member_permissions p WHERE p.enterpriseMemberId = ${actor.id}
  `));
  const canManageAll = owner || permissionRows.some(row => row.permissionKey === CUSTOMER_ALL_PERMISSION);
  const canManage = canManageAll || permissionRows.some(row => row.permissionKey === CUSTOMER_PERMISSION);
  if (!canManage) throw new TRPCError({ code: "FORBIDDEN", message: "您没有客户管理权限" });
  if (!canManageAll) {
    return { actorUserId: scope.actorUserId, canManageAll: false, members: [{ userId: scope.actorUserId, name: displayName(actor.name, scope.actorUserId) }] };
  }
  const members = resultRows<{ userId: number; name: string | null }>(await db.execute(sql`
    SELECT em.userId, COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS name
      FROM enterprise_members em INNER JOIN users u ON u.id = em.userId
      INNER JOIN enterprises e ON e.id = em.enterpriseId
     WHERE em.enterpriseId = ${scope.enterpriseId}
       AND em.status = 'active' AND u.loginDisabled = 0
       AND (
         em.role = 'super_admin' OR em.userId = e.superAdminUserId
         OR EXISTS (
           SELECT 1 FROM enterprise_member_permissions p
            WHERE p.enterpriseMemberId = em.id
              AND p.permissionKey IN (${CUSTOMER_PERMISSION}, ${CUSTOMER_ALL_PERMISSION})
         )
       )
     ORDER BY em.userId
  `));
  return { actorUserId: scope.actorUserId, canManageAll: true, members: members.map(member => ({ userId: Number(member.userId), name: displayName(member.name, Number(member.userId)) })) };
}

export async function listCustomers(scope: CustomerServerScope, input: {
  keyword: string; grade?: CustomerRecord["grade"]; stage?: CustomerRecord["stage"];
  scope: "mine" | "all"; assignedUserId?: number; archived: boolean; due: "all" | "today" | "overdue";
  page: number; pageSize: number;
}) {
  const db = await requireDb();
  const conditions = [sql`c.enterpriseId = ${scope.enterpriseId}`];
  const effectiveAll = scope.canManageAll && input.scope === "all";
  if (!effectiveAll) conditions.push(sql`c.assignedUserId = ${scope.actorUserId}`);
  if (input.assignedUserId && effectiveAll) conditions.push(sql`c.assignedUserId = ${input.assignedUserId}`);
  conditions.push(input.archived ? sql`c.archivedAt IS NOT NULL` : sql`c.archivedAt IS NULL`);
  if (input.keyword) {
    const keyword = `%${input.keyword.trim()}%`;
    conditions.push(sql`(
      c.name LIKE ${keyword}
      OR cc.contactName LIKE ${keyword}
      OR cc.phone LIKE ${keyword}
      OR cc.email LIKE ${keyword}
      OR EXISTS(
        SELECT 1 FROM crm_customer_contact_profiles p
         WHERE p.enterpriseId = c.enterpriseId AND p.customerId = c.id AND p.stoppedAt IS NULL
           AND p.name LIKE ${keyword}
      )
      OR EXISTS(
        SELECT 1 FROM crm_customer_contact_methods m
        INNER JOIN crm_customer_contact_profiles p ON p.id = m.contactId
         WHERE m.enterpriseId = c.enterpriseId AND m.customerId = c.id AND m.stoppedAt IS NULL
           AND p.enterpriseId = c.enterpriseId AND p.customerId = c.id AND p.stoppedAt IS NULL
           AND m.value LIKE ${keyword}
      )
    )`);
  }
  if (input.grade) conditions.push(sql`c.grade = ${input.grade}`);
  if (input.stage) conditions.push(sql`c.stage = ${input.stage}`);
  const beijingToday = sql`DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))`;
  if (input.due === "today") conditions.push(sql`c.nextFollowUpAt IS NOT NULL AND DATE(c.nextFollowUpAt) = ${beijingToday}`);
  if (input.due === "overdue") conditions.push(sql`c.nextFollowUpAt IS NOT NULL AND DATE(c.nextFollowUpAt) < ${beijingToday}`);
  const where = sql.join(conditions, sql` AND `);
  const offset = (input.page - 1) * input.pageSize;
  const count = resultRows<{ total: number | string }>(await db.execute(sql`
    SELECT COUNT(*) AS total FROM crm_customers c
      LEFT JOIN crm_customer_contacts cc ON cc.customerId = c.id AND cc.isPrimary = 1
     WHERE ${where}
  `))[0];
  const rows = resultRows<CustomerRow>(await db.execute(sql`
    ${customerSelect()}
     WHERE ${where}
     ORDER BY c.updatedAt DESC, c.id DESC
     LIMIT ${input.pageSize} OFFSET ${offset}
  `));
  return { items: rows.map(mapCustomer), total: Number(count?.total ?? 0), page: input.page, pageSize: input.pageSize };
}

export async function getCustomer(scope: CustomerServerScope, id: number) {
  const db = await requireDb();
  const customer = resultRows<CustomerRow>(await db.execute(sql`
    ${customerSelect()}
     WHERE ${scopeWhere(scope)} AND c.id = ${id}
     LIMIT 1
  `))[0];
  if (!customer) throw new TRPCError({ code: "NOT_FOUND", message: "客户不存在" });
  const followUps = resultRows<{
    id: number; customerId: number; authorUserId: number; authorName: string | null; method: CustomerFollowUp["method"];
    content: string; occurredAt: Date | string; createdAt: Date | string; correctionOfId: number | null;
  }>(await db.execute(sql`
    SELECT f.id, f.customerId, f.authorUserId,
           COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS authorName,
           f.method, f.content, f.occurredAt, f.createdAt, f.correctionOfId
      FROM crm_customer_followups f LEFT JOIN users u ON u.id = f.authorUserId
     WHERE f.enterpriseId = ${scope.enterpriseId} AND f.customerId = ${id}
     ORDER BY f.occurredAt DESC, f.id DESC
  `));
  const audits = resultRows<{
    id: number; action: string; actorUserId: number; actorName: string | null; note: string; createdAt: Date | string;
  }>(await db.execute(sql`
    SELECT a.id, a.action, a.actorUserId,
           COALESCE(u.name, u.username, CONCAT('用户', u.id)) AS actorName,
           a.note, a.createdAt
      FROM crm_customer_audits a LEFT JOIN users u ON u.id = a.actorUserId
     WHERE a.enterpriseId = ${scope.enterpriseId} AND a.customerId = ${id}
     ORDER BY a.createdAt DESC, a.id DESC
  `));
  return {
    customer: mapCustomer(customer),
    followUps: followUps.map(row => ({ ...row, id: Number(row.id), customerId: Number(row.customerId), authorUserId: Number(row.authorUserId), authorName: displayName(row.authorName, Number(row.authorUserId)), occurredAt: iso(row.occurredAt)!, createdAt: iso(row.createdAt)!, correctionOfId: row.correctionOfId == null ? null : Number(row.correctionOfId) })),
    audits: audits.map(row => ({ ...row, id: Number(row.id), actorUserId: Number(row.actorUserId), actorName: displayName(row.actorName, Number(row.actorUserId)), createdAt: iso(row.createdAt)! })),
    canManageAll: scope.canManageAll,
  };
}

/** Tenant-wide minimal ownership only; never returns contacts, followups or another salesperson's customer ID. */
export async function searchCustomerOwnership(scope: CustomerServerScope, input: CustomerOwnershipQuery): Promise<CustomerOwnershipResult> {
  const checked = customerOwnershipQuerySchema.safeParse(input);
  if (!checked.success) throw new TRPCError({ code: "BAD_REQUEST", message: checked.error.issues[0]?.message ?? "请输入客户公司名称" });
  const normalized = normalizeCustomerName(checked.data.companyName);
  const db = await requireDb();
  return db.transaction(async tx => {
    // Same lock order as member removal/permission changes and customer transfers.
    // Re-read permissions instead of trusting a stale scope.canManageAll flag.
    const access = await lockEnterpriseAndMembers(tx, scope);
    await consumeCustomerOwnershipQuota(scope);
    const rows = resultRows<DuplicateMatchRow>(await tx.execute(sql`
      SELECT c.id, c.name, c.assignedUserId, c.archivedAt,
             COALESCE(assigned.name, assigned.username, CONCAT('用户', assigned.id)) AS assignedName
        FROM crm_customers c
        LEFT JOIN users assigned ON assigned.id = c.assignedUserId
       WHERE c.enterpriseId = ${scope.enterpriseId}
         AND INSTR(c.nameNormalized, ${normalized}) > 0
       ORDER BY (c.nameNormalized = ${normalized}) DESC, (c.archivedAt IS NULL) DESC, c.updatedAt DESC, c.id DESC
       LIMIT 21
    `));
    return {
      query: checked.data.companyName,
      hasMore: rows.length > 20,
      matches: rows.slice(0, 20).map(row => ({
        companyName: row.name,
        ownerName: displayName(row.assignedName, Number(row.assignedUserId)),
        ownership: Number(row.assignedUserId) === scope.actorUserId ? "mine" as const : "colleague" as const,
        archived: Boolean(row.archivedAt),
        matchType: normalizeCustomerName(row.name) === normalized ? "exact" as const : "similar" as const,
        viewableCustomerId: access.canManageAll || Number(row.assignedUserId) === scope.actorUserId ? Number(row.id) : null,
      })),
    };
  });
}

export async function checkCustomerDuplicate(scope: CustomerServerScope, input: { name: string; phone?: string; email?: string; excludeId?: number }) {
  const db = await requireDb();
  const state = await duplicateState(db, scope, input, scope.canManageAll);
  return {
    hasDuplicate: state.rows.length > 0,
    restricted: state.restricted,
    matches: state.visible.slice(0, 20).map(row => ({ id: Number(row.id), name: row.name, assignedName: displayName(row.assignedName, Number(row.assignedUserId)), archived: Boolean(row.archivedAt) })),
  };
}

export async function createCustomer(
  scope: CustomerServerScope,
  input: { data: CustomerData; requestId: string; initialFollowUp: string; confirmDuplicate: boolean },
  extension?: CrmCustomerCreateExtension,
) {
  if (extension && !trustedCustomerCreateExtensions.has(extension)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无效的内部联系人创建能力" });
  }
  input = extension ? { ...input } : { ...input, data: validateWriteData(input.data) };
  const db = await requireDb();
  const payloadHash = extension?.payloadHash ?? customerCreatePayloadHash(input);
  return db.transaction(async tx => {
    const assignedUserId = input.data.assignedUserId ?? scope.actorUserId;
    const access = await lockEnterpriseAndMembers(tx, scope);
    if (!access.canManageAll && assignedUserId !== scope.actorUserId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只能创建并负责本人客户" });
    }
    await assertTargetHasCustomerPermission(tx, scope, access, assignedUserId);
    const reservation = await reserveRequest(tx, {
      enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId, requestId: input.requestId, action: "create", payloadHash,
    });
    if (reservation.replayed) return { id: reservation.customerId, replayed: true };
    const duplicates = await duplicateState(tx, scope, { name: input.data.name, phone: input.data.phone, email: input.data.email }, access.canManageAll);
    if (duplicates.rows.length && !input.confirmDuplicate) throwDuplicate(duplicates.restricted);
    const data = canonicalData(input.data);
    const inserted = resultHeader(await tx.execute(sql`
      INSERT INTO crm_customers
        (enterpriseId, assignedUserId, createdByUserId, updatedByUserId, name, nameNormalized,
         province, city, district, address, scale, grade, stage, source, nextFollowUpAt, createdAt, updatedAt)
      VALUES
        (${scope.enterpriseId}, ${assignedUserId}, ${scope.actorUserId}, ${scope.actorUserId}, ${data.name}, ${normalizeCustomerName(data.name)},
         ${nullableText(data.province)}, ${nullableText(data.city)}, ${nullableText(data.district)}, ${nullableText(data.address)},
         ${data.scale}, ${data.grade}, ${data.stage}, ${nullableText(data.source)}, ${data.nextFollowUpAt ? toBeijingSqlDate(data.nextFollowUpAt) : null}, ${CRM_NOW}, ${CRM_NOW})
    `));
    const customerId = Number(inserted.insertId ?? 0);
    if (!customerId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "客户创建失败" });
    await tx.execute(sql`
      INSERT INTO crm_customer_contacts (customerId, contactName, phone, phoneNormalized, email, emailNormalized, isPrimary, createdAt, updatedAt)
      VALUES (${customerId}, ${nullableText(data.contactName)}, ${nullableText(data.phone)}, ${normalizeCustomerPhone(data.phone)}, ${nullableText(data.email)}, ${normalizeCustomerEmail(data.email)}, 1, ${CRM_NOW}, ${CRM_NOW})
    `);
    if (extension) {
      await extension.afterCustomerCreated({ tx, scope, customerId, requestId: input.requestId });
    }
    if (input.initialFollowUp.trim()) {
      await tx.execute(sql`
        INSERT INTO crm_customer_followups
          (enterpriseId, customerId, authorUserId, method, content, occurredAt, requestId, payloadHash, createdAt)
        VALUES (${scope.enterpriseId}, ${customerId}, ${scope.actorUserId}, 'other', ${input.initialFollowUp.trim()}, ${CRM_NOW}, ${input.requestId}, ${payloadHash}, ${CRM_NOW})
      `);
      await tx.execute(sql`UPDATE crm_customers SET lastFollowUpAt = ${CRM_NOW} WHERE id = ${customerId} AND enterpriseId = ${scope.enterpriseId}`);
    }
    await tx.execute(sql`
      UPDATE crm_customer_requests SET customerId = ${customerId}, recordId = ${customerId}
       WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${input.requestId}
    `);
    await insertAudit(tx, { enterpriseId: scope.enterpriseId, customerId, actorUserId: scope.actorUserId, action: "created", note: "创建客户", requestId: input.requestId });
    return { id: customerId, replayed: false };
  });
}

export async function updateCustomer(scope: CustomerServerScope, input: { id: number; data: CustomerData; version: number; confirmDuplicate: boolean }) {
  input = { ...input, data: validateWriteData(input.data) };
  const db = await requireDb();
  return db.transaction(async tx => {
    const access = await lockEnterpriseAndMembers(tx, scope);
    const customer = assertCustomerAccess(await lockCustomer(tx, scope.enterpriseId, input.id), scope, access.canManageAll);
    if (Number(customer.version) !== input.version) throw new TRPCError({ code: "CONFLICT", message: "客户已被其他人更新，请刷新后重试" });
    const requestedAssignee = input.data.assignedUserId ?? Number(customer.assignedUserId);
    if (requestedAssignee !== Number(customer.assignedUserId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "请使用转移功能变更负责人" });
    }
    if (customer.archivedAt) throw new TRPCError({ code: "CONFLICT", message: "已归档客户不可编辑，请先恢复" });
    const duplicates = await duplicateState(tx, scope, { name: input.data.name, phone: input.data.phone, email: input.data.email, excludeId: input.id }, access.canManageAll);
    if (duplicates.rows.length && !input.confirmDuplicate) throwDuplicate(duplicates.restricted);
    const data = canonicalData(input.data);
    await tx.execute(sql`
      UPDATE crm_customers
         SET name = ${data.name}, nameNormalized = ${normalizeCustomerName(data.name)},
             province = ${nullableText(data.province)}, city = ${nullableText(data.city)}, district = ${nullableText(data.district)}, address = ${nullableText(data.address)},
             scale = ${data.scale}, grade = ${data.grade}, stage = ${data.stage}, source = ${nullableText(data.source)},
             nextFollowUpAt = ${data.nextFollowUpAt ? toBeijingSqlDate(data.nextFollowUpAt) : null},
             version = version + 1, updatedByUserId = ${scope.actorUserId}, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.id} AND version = ${input.version}
    `);
    await tx.execute(sql`
      UPDATE crm_customer_contacts
         SET contactName = ${nullableText(data.contactName)}, phone = ${nullableText(data.phone)}, phoneNormalized = ${normalizeCustomerPhone(data.phone)},
             email = ${nullableText(data.email)}, emailNormalized = ${normalizeCustomerEmail(data.email)}, updatedAt = ${CRM_NOW}
       WHERE customerId = ${input.id} AND isPrimary = 1
         AND NOT EXISTS(
           SELECT 1 FROM crm_customer_contact_primary p
            WHERE p.enterpriseId = ${scope.enterpriseId} AND p.customerId = ${input.id}
              AND p.legacyContactPresent = 0
         )
         AND NOT EXISTS(
           SELECT 1 FROM crm_customer_contact_profiles p
            WHERE p.enterpriseId = ${scope.enterpriseId} AND p.customerId = ${input.id}
         )
    `);
    const changes = [
      customer.grade === data.grade ? "" : `客户等级：${customer.grade}→${data.grade}`,
      customer.stage === data.stage ? "" : `客户阶段：${customer.stage}→${data.stage}`,
    ].filter(Boolean);
    await insertAudit(tx, {
      enterpriseId: scope.enterpriseId, customerId: input.id, actorUserId: scope.actorUserId, action: "updated",
      note: changes.length ? `更新客户资料；${changes.join("；")}` : "更新客户资料",
    });
    return { id: input.id };
  });
}

export async function addCustomerFollowUp(scope: CustomerServerScope, input: {
  customerId: number; requestId: string; method: CustomerFollowUp["method"]; content: string; occurredAt: string;
  nextFollowUpAt: string | null; stage?: CustomerRecord["stage"]; correctionOfId?: number;
}) {
  const db = await requireDb();
  const payloadHash = customerFollowUpPayloadHash(input);
  return db.transaction(async tx => {
    const access = await lockEnterpriseAndMembers(tx, scope);
    const customer = assertCustomerAccess(await lockCustomer(tx, scope.enterpriseId, input.customerId), scope, access.canManageAll);
    if (customer.archivedAt) throw new TRPCError({ code: "CONFLICT", message: "已归档客户不可追加跟进，请先恢复" });
    const reservation = await reserveRequest(tx, {
      enterpriseId: scope.enterpriseId, actorUserId: scope.actorUserId, requestId: input.requestId, action: "followup", payloadHash,
    });
    if (reservation.replayed) return { id: Number(reservation.recordId), replayed: true };
    if (input.correctionOfId) {
      const original = resultRows<{ id: number }>(await tx.execute(sql`
        SELECT id FROM crm_customer_followups
         WHERE id = ${input.correctionOfId} AND enterpriseId = ${scope.enterpriseId} AND customerId = ${input.customerId}
         LIMIT 1 FOR UPDATE
      `))[0];
      if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "待更正的跟进记录不存在" });
    }
    const occurredAt = toBeijingSqlDate(input.occurredAt);
    const inserted = resultHeader(await tx.execute(sql`
      INSERT INTO crm_customer_followups
        (enterpriseId, customerId, authorUserId, method, content, occurredAt, correctionOfId, requestId, payloadHash, createdAt)
      VALUES (${scope.enterpriseId}, ${input.customerId}, ${scope.actorUserId}, ${input.method}, ${input.content.trim()}, ${occurredAt}, ${input.correctionOfId ?? null}, ${input.requestId}, ${payloadHash}, ${CRM_NOW})
    `));
    const followUpId = Number(inserted.insertId ?? 0);
    if (!followUpId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "跟进记录创建失败" });
    await tx.execute(sql`
      UPDATE crm_customers
         SET nextFollowUpAt = ${input.nextFollowUpAt ? toBeijingSqlDate(input.nextFollowUpAt) : null},
             stage = ${input.stage ?? customer.stage},
             lastFollowUpAt = CASE WHEN lastFollowUpAt IS NULL OR lastFollowUpAt < ${occurredAt} THEN ${occurredAt} ELSE lastFollowUpAt END,
             version = version + 1, updatedByUserId = ${scope.actorUserId}, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.customerId}
    `);
    await tx.execute(sql`
      UPDATE crm_customer_requests SET customerId = ${input.customerId}, recordId = ${followUpId}
       WHERE enterpriseId = ${scope.enterpriseId} AND actorUserId = ${scope.actorUserId} AND requestId = ${input.requestId}
    `);
    await insertAudit(tx, { enterpriseId: scope.enterpriseId, customerId: input.customerId, actorUserId: scope.actorUserId, action: input.correctionOfId ? "followup_corrected" : "followup_added", note: input.correctionOfId ? `更正跟进 #${input.correctionOfId}` : "新增跟进", requestId: input.requestId });
    return { id: followUpId, replayed: false };
  });
}

async function adminCustomerMutation(
  scope: CustomerServerScope,
  input: { id: number; version: number },
  mutate: (tx: CrmSqlExecutor, access: LockedAccess, customer: CustomerRow) => Promise<void>,
) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const access = await lockEnterpriseAndMembers(tx, scope);
    if (!access.canManageAll) throw new TRPCError({ code: "FORBIDDEN", message: "需要全部客户管理权限" });
    const customer = assertCustomerAccess(await lockCustomer(tx, scope.enterpriseId, input.id), scope, true);
    if (Number(customer.version) !== input.version) throw new TRPCError({ code: "CONFLICT", message: "客户已被其他人更新，请刷新后重试" });
    await mutate(tx, access, customer);
    return { success: true as const };
  });
}

export async function archiveCustomer(scope: CustomerServerScope, input: { id: number; version: number; reason: string }) {
  if (!input.reason.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "请输入归档原因" });
  return adminCustomerMutation(scope, input, async (tx, _access, customer) => {
    if (customer.archivedAt) return;
    await tx.execute(sql`
      UPDATE crm_customers SET archivedAt = ${CRM_NOW}, archiveReason = ${input.reason.trim()}, archivedByUserId = ${scope.actorUserId},
          version = version + 1, updatedByUserId = ${scope.actorUserId}, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND id = ${customer.id}
    `);
    await insertAudit(tx, { enterpriseId: scope.enterpriseId, customerId: Number(customer.id), actorUserId: scope.actorUserId, action: "archived", note: input.reason.trim() });
  });
}

export async function restoreCustomer(scope: CustomerServerScope, input: { id: number; version: number }) {
  return adminCustomerMutation(scope, input, async (tx, _access, customer) => {
    if (!customer.archivedAt) return;
    await tx.execute(sql`
      UPDATE crm_customers SET archivedAt = NULL, archiveReason = NULL, archivedByUserId = NULL,
          version = version + 1, updatedByUserId = ${scope.actorUserId}, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND id = ${customer.id}
    `);
    await insertAudit(tx, { enterpriseId: scope.enterpriseId, customerId: Number(customer.id), actorUserId: scope.actorUserId, action: "restored", note: "恢复客户" });
  });
}

export async function transferCustomer(scope: CustomerServerScope, input: { id: number; version: number; assignedUserId: number; reason: string }) {
  if (!input.reason.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "请输入转移原因" });
  const db = await requireDb();
  return db.transaction(async tx => {
    const access = await lockEnterpriseAndMembers(tx, scope);
    if (!access.canManageAll) throw new TRPCError({ code: "FORBIDDEN", message: "需要全部客户管理权限" });
    await assertTargetHasCustomerPermission(tx, scope, access, input.assignedUserId);
    const customer = assertCustomerAccess(await lockCustomer(tx, scope.enterpriseId, input.id), scope, true);
    if (Number(customer.version) !== input.version) throw new TRPCError({ code: "CONFLICT", message: "客户已被其他人更新，请刷新后重试" });
    if (customer.archivedAt) throw new TRPCError({ code: "CONFLICT", message: "已归档客户不可转移，请先恢复" });
    if (Number(customer.assignedUserId) === input.assignedUserId) return { success: true as const };
    await tx.execute(sql`
      UPDATE crm_customers SET assignedUserId = ${input.assignedUserId}, version = version + 1,
          updatedByUserId = ${scope.actorUserId}, updatedAt = ${CRM_NOW}
       WHERE enterpriseId = ${scope.enterpriseId} AND id = ${input.id}
    `);
    await insertAudit(tx, { enterpriseId: scope.enterpriseId, customerId: input.id, actorUserId: scope.actorUserId, action: "transferred", note: `负责人 ${customer.assignedUserId}→${input.assignedUserId}；${input.reason.trim()}` });
    return { success: true as const };
  });
}

// Kept for migration/handoff verification and focused tests; no normal API performs hard deletes.
export const CRM_CUSTOMER_TABLES = ["crm_customers", "crm_customer_contacts", "crm_customer_followups", "crm_customer_audits", "crm_customer_requests"] as const;
export const CRM_CUSTOMER_EPOCH = EPOCH;
