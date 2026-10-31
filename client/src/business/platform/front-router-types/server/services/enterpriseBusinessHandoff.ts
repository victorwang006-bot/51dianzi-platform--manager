import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { inquiryQuantityText } from "../../../shared/inquiryQuantity";
import { getDb } from "../db";
import { requireActiveEnterpriseScope } from "./enterprisePermissions";

/**
 * These tables intentionally use SQL rather than drizzle/schema.ts.  The rollout is
 * create-only and must not cause a generated schema migration or an historical backfill.
 */
const ACTIVE_INQUIRY_STATUSES = ["open", "replied"] as const;
const MAX_ENTERPRISE_INVENTORIES = 20_000;
const MAX_SELECTED_INVENTORIES = 500;
const MAX_PENDING_INQUIRIES = 500;
const MAX_INBOX_PAGE_SIZE = 100;

type Db = any;
type HandoffKind = "inquiry" | "inventory";
type HandoffScope = "enterprise" | "selected";
type ActiveInquiryStatus = (typeof ACTIVE_INQUIRY_STATUSES)[number];

type InventoryRow = {
  id: number;
  enterpriseId: number | null;
  userId: number;
  ownerUserId: number | null;
  ownershipVersion: number | null;
  status: string;
  partNumber: string;
  brand: string;
  quantity: number;
  ownerName: string | null;
  ownerPhone?: string | null;
};
type RouteRow = { inventoryId: number; assigneeUserId: number; policy: "explicit" | "preserved_legacy_owner"; version: number };
type InquiryRow = {
  id: number;
  inventoryId: number;
  buyerUserId: number;
  assigneeUserId: number;
  status: ActiveInquiryStatus | string;
  conversationId: number;
  messageId: number;
  requestedQty: number;
};
type MemberRow = {
  memberId: number;
  userId: number;
  role: string;
  status: string;
  permissionVersion: number;
  loginDisabled: number | boolean;
  name: string | null;
  username: string | null;
  phone: string | null;
  hasInquiryPermission: number | boolean;
  hasInventoryPermission: number | boolean;
};

type LockedEnterprise = { id: number; superAdminUserId: number };

type HandoffInput = {
  actorUserId: number;
  kind: HandoffKind;
  scope: HandoffScope;
  inventoryIds?: number[];
  nextUserId: number;
  transferFuture: boolean;
  transferPending: boolean;
  requestId: string;
  expectedRevision: string;
};

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0])) return result[0] as T[];
    return result as T[];
  }
  const candidate = result as { rows?: unknown } | null;
  return Array.isArray(candidate?.rows) ? candidate.rows as T[] : [];
}

function affectedRows(result: unknown): number {
  const first = Array.isArray(result) ? result[0] : result;
  return Number((first as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

function bool(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function displayName(row: { name?: string | null; username?: string | null; userId: number }) {
  return String(row.name?.trim() || row.username?.trim() || `用户${row.userId}`);
}

function maskPhone(phone: string | null | undefined) {
  if (!phone) return "未绑定";
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${label}必须是正整数` });
  }
}

function assertKindScope(kind: unknown, scope: unknown): asserts kind is HandoffKind & (typeof scope extends HandoffScope ? unknown : never) {
  if (kind !== "inquiry" && kind !== "inventory") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "交接类型无效" });
  }
  if (scope !== "enterprise" && scope !== "selected") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "交接范围无效" });
  }
}

function normalizedInventoryIds(scope: HandoffScope, values?: number[]) {
  if (scope === "enterprise") {
    if (values != null && values.length > 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "全企业交接不能提交指定库存" });
    }
    return [] as number[];
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请选择至少一条库存" });
  }
  if (values.length > MAX_SELECTED_INVENTORIES) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `单次最多选择${MAX_SELECTED_INVENTORIES}条库存` });
  }
  const ids = values.map(value => Number(value));
  if (ids.some(value => !Number.isInteger(value) || value <= 0) || new Set(ids).size !== ids.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "库存选择包含无效或重复ID" });
  }
  return ids.sort((a, b) => a - b);
}

function idList(ids: number[]) {
  if (ids.length === 0) throw new Error("empty SQL IN list");
  return sql.join(ids.map(id => sql`${id}`), sql`, `);
}

function isRetriableTransactionError(error: unknown) {
  const value = error as { code?: string; errno?: number } | null;
  return value?.code === "ER_LOCK_DEADLOCK"
    || value?.code === "ER_LOCK_WAIT_TIMEOUT"
    || value?.errno === 1213
    || value?.errno === 1205;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db as Db;
}

function operationPayload(input: Omit<HandoffInput, "actorUserId" | "requestId"> & { inventoryIds: number[] }, enterpriseId: number, actorUserId: number) {
  return {
    enterpriseId,
    actorUserId,
    nextUserId: input.nextUserId,
    kind: input.kind,
    scope: input.scope,
    inventoryIds: input.inventoryIds,
    transferFuture: input.transferFuture,
    transferPending: input.transferPending,
    expectedRevision: input.expectedRevision,
  };
}

/** Exported for deterministic tests and request conflict detection. */
export function enterpriseBusinessHandoffPayloadHash(
  input: Omit<HandoffInput, "actorUserId" | "requestId"> & { inventoryIds: number[] },
  enterpriseId: number,
  actorUserId: number,
) {
  return createHash("sha256")
    .update(JSON.stringify(operationPayload(input, enterpriseId, actorUserId)))
    .digest("hex");
}

/** Revision includes all mutable collections that affect a confirmation, including rule versions. */
export function enterpriseBusinessHandoffRevision(input: {
  enterpriseId: number;
  scope: HandoffScope;
  inventoryIds: number[];
  inventories: Array<Pick<InventoryRow, "id" | "ownerUserId" | "ownershipVersion" | "status" | "quantity" | "partNumber" | "brand">>;
  routes: RouteRow[];
  inquiries: Array<Pick<InquiryRow, "id" | "inventoryId" | "assigneeUserId" | "status" | "conversationId" | "messageId">>;
}) {
  const snapshot = {
    enterpriseId: input.enterpriseId,
    scope: input.scope,
    inventoryIds: [...input.inventoryIds].sort((a, b) => a - b),
    inventories: input.inventories
      .map(row => [row.id, row.ownerUserId, Number(row.ownershipVersion ?? 0), row.status, Number(row.quantity ?? 0), row.partNumber, row.brand] as const)
      .sort((a, b) => a[0] - b[0]),
    routes: input.routes
      .map(row => [row.inventoryId, row.assigneeUserId, Number(row.version ?? 0)] as const)
      .sort((a, b) => a[0] - b[0]),
    inquiries: input.inquiries
      .map(row => [row.id, row.inventoryId, row.assigneeUserId, row.status, row.conversationId, row.messageId] as const)
      .sort((a, b) => a[0] - b[0]),
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/**
 * The pure plan is deliberately shared by execute and tests: it makes future-only,
 * pending-only and inventory-only semantics unambiguous before any SQL is issued.
 */
export function planEnterpriseBusinessHandoffMutation(input: {
  kind: HandoffKind;
  transferFuture: boolean;
  transferPending: boolean;
  inventoryCount: number;
  pendingInquiryCount: number;
}) {
  if (input.kind === "inquiry" && !input.transferFuture && !input.transferPending) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "转交询价至少选择后续新询价或已有未结询价" });
  }
  if (input.inventoryCount === 0 && input.transferFuture) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "当前没有可交接库存，不能设置后续询价分工" });
  }
  if (input.kind === "inventory" && input.transferFuture) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "转交库存不能改变后续新询价负责人" });
  }
  return {
    writeInventoryOwners: input.kind === "inventory" ? input.inventoryCount : 0,
    writeInquiryRoutes: input.kind === "inquiry" && input.transferFuture,
    writePendingInquiries: input.transferPending ? input.pendingInquiryCount : 0,
    requiresInquiryPermission: input.kind === "inquiry" || input.transferPending,
  };
}

async function allMembers(database: Db, enterpriseId: number, lock = false): Promise<MemberRow[]> {
  const result = await database.execute(sql`
    SELECT em.id AS memberId, em.userId, em.role, em.status, em.permissionVersion,
           u.loginDisabled, u.name, u.username, u.phone,
           EXISTS(
             SELECT 1 FROM enterprise_member_permissions ep
              WHERE ep.enterpriseMemberId = em.id AND ep.permissionKey = 'inquiry.receive'
           ) AS hasInquiryPermission,
           EXISTS(
             SELECT 1 FROM enterprise_member_permissions ep
              WHERE ep.enterpriseMemberId = em.id
                AND ep.permissionKey IN ('inventory.manage', 'inventory.publish')
           ) AS hasInventoryPermission
      FROM enterprise_members em
      INNER JOIN users u ON u.id = em.userId
     WHERE em.enterpriseId = ${enterpriseId}
     ORDER BY em.userId ASC
     ${lock ? sql`FOR UPDATE` : sql``}
  `);
  return rows<MemberRow>(result).map(row => ({ ...row, userId: Number(row.userId), memberId: Number(row.memberId) }));
}

function isEnterpriseOwner(member: MemberRow | undefined, enterprise: LockedEnterprise | { superAdminUserId: number }) {
  return !!member && Number(member.userId) === Number(enterprise.superAdminUserId);
}

function memberAccountActive(member: MemberRow | undefined) {
  return !!member && member.status === "active" && !bool(member.loginDisabled);
}

function memberCanReceiveNewInquiry(member: MemberRow | undefined, enterprise: LockedEnterprise | { superAdminUserId: number }) {
  return memberAccountActive(member) && (isEnterpriseOwner(member, enterprise) || bool(member?.hasInquiryPermission));
}

function memberCanManageInventory(member: MemberRow | undefined, enterprise: LockedEnterprise | { superAdminUserId: number }) {
  return memberAccountActive(member) && (isEnterpriseOwner(member, enterprise) || bool(member?.hasInventoryPermission));
}

function resolvedPreviewRecipient(
  inventory: InventoryRow,
  routes: Map<number, RouteRow>,
  members: Map<number, MemberRow>,
  enterprise: { superAdminUserId: number },
) {
  const enterpriseOwner = members.get(Number(enterprise.superAdminUserId));
  const fallbackEnterpriseOwner = () => memberAccountActive(enterpriseOwner) ? enterpriseOwner : undefined;
  const validRouteRecipient = (route: RouteRow | undefined) => {
    if (!route) return undefined;
    const assignee = members.get(Number(route.assigneeUserId));
    return route.policy === "preserved_legacy_owner"
      ? (memberAccountActive(assignee) ? assignee : undefined)
      : (memberCanReceiveNewInquiry(assignee, enterprise) ? assignee : undefined);
  };
  const individual = routes.get(inventory.id);
  if (individual) {
    const assignee = validRouteRecipient(individual);
    if (assignee) return assignee;
    // A broken per-stock decision cannot silently switch to an inventory owner/default rule.
    return fallbackEnterpriseOwner();
  } else {
    const defaultRoute = routes.get(0);
    if (defaultRoute) {
      const assignee = validRouteRecipient(defaultRoute);
      if (assignee) return assignee;
      return fallbackEnterpriseOwner();
    }
  }
  const owner = inventory.ownerUserId == null ? undefined : members.get(Number(inventory.ownerUserId));
  if (memberAccountActive(owner)) return owner;
  return fallbackEnterpriseOwner();
}

async function loadInventories(database: Db, enterpriseId: number, scope: HandoffScope, selectedIds: number[], lock = false) {
  const predicate = scope === "enterprise"
    ? sql`i.enterpriseId = ${enterpriseId}`
    : sql`i.enterpriseId = ${enterpriseId} AND i.id IN (${idList(selectedIds)})`;
  const result = await database.execute(sql`
    SELECT i.id, i.enterpriseId, i.userId, i.ownerUserId, i.ownershipVersion, i.status,
           i.partNumber, i.brand, COALESCE(i.qtyStock, i.qtyOnSale) AS quantity,
           COALESCE(NULLIF(TRIM(owner.name), ''), NULLIF(TRIM(owner.username), '')) AS ownerName
      FROM inventories i
      LEFT JOIN users owner ON owner.id = i.ownerUserId
     WHERE ${predicate}
     ORDER BY i.id ASC
     LIMIT ${MAX_ENTERPRISE_INVENTORIES + 1}
     ${lock ? sql`FOR UPDATE` : sql``}
  `);
  return rows<InventoryRow>(result).map(row => ({
    ...row,
    id: Number(row.id), enterpriseId: row.enterpriseId == null ? null : Number(row.enterpriseId),
    userId: Number(row.userId), ownerUserId: row.ownerUserId == null ? null : Number(row.ownerUserId),
    ownershipVersion: Number(row.ownershipVersion ?? 0), quantity: Number(row.quantity ?? 0),
  }));
}

async function loadRoutes(database: Db, enterpriseId: number, scope: HandoffScope, selectedIds: number[], lock = false) {
  const predicate = scope === "enterprise"
    ? sql`enterpriseId = ${enterpriseId}`
    : sql`enterpriseId = ${enterpriseId} AND inventoryId IN (0, ${idList(selectedIds)})`;
  const result = await database.execute(sql`
    SELECT inventoryId, assigneeUserId, policy, version
      FROM enterprise_inquiry_routes
     WHERE ${predicate}
     ORDER BY inventoryId ASC
     ${lock ? sql`FOR UPDATE` : sql``}
  `);
  return rows<RouteRow>(result).map(row => ({
    inventoryId: Number(row.inventoryId), assigneeUserId: Number(row.assigneeUserId),
    policy: (row.policy === "preserved_legacy_owner" ? "preserved_legacy_owner" : "explicit") as RouteRow["policy"],
    version: Number(row.version ?? 0),
  }));
}

async function loadActiveInquiries(database: Db, enterpriseId: number, inventoryIds: number[], lock = false) {
  if (inventoryIds.length === 0) return [] as InquiryRow[];
  const result = await database.execute(sql`
    SELECT id, inventoryId, buyerUserId, assigneeUserId, status, conversationId, messageId, requestedQty
      FROM inventory_inquiries
     WHERE enterpriseId = ${enterpriseId}
       AND inventoryId IN (${idList(inventoryIds)})
       AND status IN ('open', 'replied')
     ORDER BY id ASC
     LIMIT ${MAX_PENDING_INQUIRIES + 1}
     ${lock ? sql`FOR UPDATE` : sql``}
  `);
  return rows<InquiryRow>(result).map(row => ({
    ...row, id: Number(row.id), inventoryId: Number(row.inventoryId), buyerUserId: Number(row.buyerUserId),
    assigneeUserId: Number(row.assigneeUserId), conversationId: Number(row.conversationId),
    messageId: Number(row.messageId), requestedQty: Number(row.requestedQty),
  }));
}

function assertWithinSafetyLimits(inventories: InventoryRow[], inquiries: InquiryRow[]) {
  if (inventories.length > MAX_ENTERPRISE_INVENTORIES) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `库存超过单次安全上限${MAX_ENTERPRISE_INVENTORIES}条，请分批处理` });
  }
  if (inquiries.length > MAX_PENDING_INQUIRIES) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `未结询价超过单次安全上限${MAX_PENDING_INQUIRIES}条，请分批处理` });
  }
}

async function readPreviewData(database: Db, enterpriseId: number, scope: HandoffScope, selectedIds: number[]) {
  const inventories = await loadInventories(database, enterpriseId, scope, selectedIds);
  if (scope === "selected" && inventories.length !== selectedIds.length) {
    throw new TRPCError({ code: "FORBIDDEN", message: "选择中包含不存在、越权或其他企业的库存" });
  }
  const routes = inventories.length <= MAX_ENTERPRISE_INVENTORIES
    ? await loadRoutes(database, enterpriseId, scope, selectedIds)
    : [];
  const inquiries = inventories.length <= MAX_ENTERPRISE_INVENTORIES
    ? await loadActiveInquiries(database, enterpriseId, inventories.slice(0, MAX_ENTERPRISE_INVENTORIES).map(row => row.id))
    : [];
  const members = await allMembers(database, enterpriseId);
  return { inventories, routes, inquiries, members };
}

function assertOwner(scope: { isOwner: boolean }) {
  if (!scope.isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有企业所有者可以执行业务交接" });
  }
}

/** Preview the real enterprise inventory, live pending inquiries and eligible recipients. */
export async function previewEnterpriseBusinessHandoff(input: {
  actorUserId: number;
  kind: HandoffKind;
  scope: HandoffScope;
  inventoryIds?: number[];
}) {
  assertPositiveInteger(input.actorUserId, "操作者");
  assertKindScope(input.kind, input.scope);
  const selectedIds = normalizedInventoryIds(input.scope, input.inventoryIds);
  const actor = await requireActiveEnterpriseScope(input.actorUserId);
  assertOwner(actor);
  const db = await requireDb();
  const { inventories, routes, inquiries, members } = await readPreviewData(db, actor.enterprise.id, input.scope, selectedIds);
  const inventoryLimitExceeded = inventories.length > MAX_ENTERPRISE_INVENTORIES;
  const inquiryLimitExceeded = inquiries.length > MAX_PENDING_INQUIRIES;
  const memberMap = new Map(members.map(member => [member.userId, member]));
  const routeMap = new Map(routes.map(route => [route.inventoryId, route]));
  const pendingByInventory = new Map<number, number>();
  const buyerConflictByUser = new Map<number, number>();
  for (const inquiry of inquiries) {
    pendingByInventory.set(inquiry.inventoryId, (pendingByInventory.get(inquiry.inventoryId) ?? 0) + 1);
    buyerConflictByUser.set(inquiry.buyerUserId, (buyerConflictByUser.get(inquiry.buyerUserId) ?? 0) + 1);
  }
  const safeInventories = inventoryLimitExceeded ? [] : inventories;
  const safeInquiries = inquiryLimitExceeded ? [] : inquiries;
  const revision = enterpriseBusinessHandoffRevision({
    enterpriseId: actor.enterprise.id,
    scope: input.scope,
    inventoryIds: selectedIds,
    inventories: safeInventories,
    routes,
    inquiries: safeInquiries,
  });
  return {
    revision,
    inventoryCount: inventories.length,
    pendingInquiryCount: inquiries.length,
    inventories: safeInventories.map(inventory => {
      const recipient = resolvedPreviewRecipient(inventory, routeMap, memberMap, actor.enterprise);
      return {
        id: inventory.id,
        partNumber: inventory.partNumber,
        brand: inventory.brand,
        quantity: inventory.quantity,
        ownerUserId: inventory.ownerUserId,
        ownerName: inventory.ownerName || (inventory.ownerUserId ? `用户${inventory.ownerUserId}` : "待分配"),
        inquiryUserId: recipient?.userId ?? null,
        inquiryName: recipient ? displayName(recipient) : "待分配",
        pendingCount: pendingByInventory.get(inventory.id) ?? 0,
      };
    }),
    candidates: members.map(member => {
      const isActor = member.userId === input.actorUserId;
      const active = memberAccountActive(member);
      const hasInquiryPermission = isEnterpriseOwner(member, actor.enterprise) || bool(member.hasInquiryPermission);
      const hasInventoryPermission = isEnterpriseOwner(member, actor.enterprise) || bool(member.hasInventoryPermission);
      const buyerConflict = buyerConflictByUser.get(member.userId) ?? 0;
      const requiredPermission = input.kind === "inquiry" ? hasInquiryPermission : hasInventoryPermission;
      const unavailableReason = !active ? (bool(member.loginDisabled) ? "账号已停用" : "成员已暂停")
        : isActor ? "不能将业务转交给自己"
        : buyerConflict > 0 ? `本人是${buyerConflict}条待处理询价的采购方`
        : !requiredPermission ? input.kind === "inquiry" ? "没有询价接待权限，请在成员管理中授予" : "没有库存管理或发布权限，请在成员管理中授予"
        : null;
      return {
        userId: member.userId,
        displayName: displayName(member),
        phone: maskPhone(member.phone),
        eligible: unavailableReason == null,
        unavailableReason,
        hasInquiryPermission,
        hasInventoryPermission,
      };
    }),
    limits: {
      inventory: MAX_ENTERPRISE_INVENTORIES,
      pendingInquiry: MAX_PENDING_INQUIRIES,
      selectedMin: 1,
      selectedMax: MAX_SELECTED_INVENTORIES,
      exceeded: inventoryLimitExceeded || inquiryLimitExceeded,
      inventoryExceeded: inventoryLimitExceeded,
      pendingInquiryExceeded: inquiryLimitExceeded,
    },
  };
}

async function lockEnterprise(tx: Db, enterpriseId: number): Promise<LockedEnterprise> {
  const result = await tx.execute(sql`
    SELECT id, superAdminUserId FROM enterprises WHERE id = ${enterpriseId} LIMIT 1 FOR UPDATE
  `);
  const enterprise = rows<LockedEnterprise>(result)[0];
  if (!enterprise) throw new TRPCError({ code: "NOT_FOUND", message: "企业不存在" });
  return { id: Number(enterprise.id), superAdminUserId: Number(enterprise.superAdminUserId) };
}

function assertExpectedRevision(value: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "盘点版本无效，请重新核对" });
  }
}

function validateExecuteInput(input: HandoffInput) {
  assertPositiveInteger(input.actorUserId, "操作者");
  assertPositiveInteger(input.nextUserId, "接替人");
  assertKindScope(input.kind, input.scope);
  const inventoryIds = normalizedInventoryIds(input.scope, input.inventoryIds);
  if (typeof input.requestId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(input.requestId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请求号无效" });
  }
  if (typeof input.transferFuture !== "boolean" || typeof input.transferPending !== "boolean") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "交接选项无效" });
  }
  assertExpectedRevision(input.expectedRevision);
  return { ...input, inventoryIds };
}

async function findOrCreateHandoffConversation(tx: Db, buyerUserId: number, assigneeUserId: number) {
  const user1Id = Math.min(buyerUserId, assigneeUserId);
  const user2Id = Math.max(buyerUserId, assigneeUserId);
  await tx.execute(sql`
    INSERT INTO conversations (user1Id, user2Id, lastMessagePreview)
    VALUES (${user1Id}, ${user2Id}, '')
    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), updatedAt = CURRENT_TIMESTAMP
  `);
  const idResult = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
  let conversationId = Number(rows<{ id: number }>(idResult)[0]?.id ?? 0);
  if (!conversationId) {
    const existing = rows<{ id: number }>(await tx.execute(sql`
      SELECT id FROM conversations WHERE user1Id = ${user1Id} AND user2Id = ${user2Id} LIMIT 1 FOR UPDATE
    `))[0];
    conversationId = Number(existing?.id ?? 0);
  }
  if (!conversationId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "询价交接会话创建失败" });
  await tx.execute(sql`
    INSERT INTO conversation_user_settings (conversationId, userId)
    VALUES (${conversationId}, ${buyerUserId}), (${conversationId}, ${assigneeUserId})
    ON DUPLICATE KEY UPDATE deleted = 0, updatedAt = CURRENT_TIMESTAMP
  `);
  return conversationId;
}

async function assertHandoffConversationNotBlocked(tx: Db, userA: number, userB: number, knownConversationId?: number) {
  const user1Id = Math.min(userA, userB);
  const user2Id = Math.max(userA, userB);
  const conversationRows = knownConversationId
    ? rows<{ id: number }>(await tx.execute(sql`SELECT id FROM conversations WHERE id = ${knownConversationId} FOR UPDATE`))
    : rows<{ id: number }>(await tx.execute(sql`SELECT id FROM conversations WHERE user1Id = ${user1Id} AND user2Id = ${user2Id} LIMIT 1 FOR UPDATE`));
  const conversationId = Number(conversationRows[0]?.id ?? 0);
  if (!conversationId) return;
  const blocks = rows<{ blockerUserId: number }>(await tx.execute(sql`
    SELECT blockerUserId FROM chat_user_blocks
     WHERE conversationId = ${conversationId}
       AND ((blockerUserId = ${userA} AND blockedUserId = ${userB})
         OR (blockerUserId = ${userB} AND blockedUserId = ${userA}))
     ORDER BY blockerUserId ASC FOR UPDATE
  `));
  if (blocks.length) throw new TRPCError({ code: "FORBIDDEN", message: "该会话已被屏蔽，不能发送消息" });
}

async function transferPendingInquiry(tx: Db, args: {
  enterpriseId: number;
  actorUserId: number;
  nextUserId: number;
  requestId: string;
  inquiry: InquiryRow;
  partNumber: string;
  nextRecipientName: string;
}) {
  // Lock in the same conversation -> block-row order used by chat contact/block flows.
  // Check before creating/reactivating the contact conversation and again after the
  // insert, so a concurrent block cannot be bypassed by this handoff.
  await assertHandoffConversationNotBlocked(tx, args.inquiry.buyerUserId, args.nextUserId);
  const conversationId = await findOrCreateHandoffConversation(tx, args.inquiry.buyerUserId, args.nextUserId);
  await assertHandoffConversationNotBlocked(tx, args.inquiry.buyerUserId, args.nextUserId, conversationId);
  const content = JSON.stringify({
    kind: "business_handoff",
    partNumber: args.partNumber,
    quantity: inquiryQuantityText(args.inquiry.requestedQty),
    inventoryId: args.inquiry.inventoryId,
    sourceInquiryId: args.inquiry.id,
    targetName: args.nextRecipientName,
    nextConversationId: conversationId,
    requestId: args.requestId,
  });
  const clientMessageId = `handoff:${createHash("sha256").update(`${args.requestId}:${args.inquiry.id}`).digest("hex").slice(0, 48)}`;
  await tx.execute(sql`
    INSERT INTO messages (conversationId, senderId, clientMessageId, msgType, content)
    VALUES (${conversationId}, ${args.inquiry.buyerUserId}, ${clientMessageId}, 'handoff_notice', ${content})
    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
  `);
  const messageId = Number(rows<{ id: number }>(await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`))[0]?.id ?? 0);
  if (!messageId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "询价交接通知写入失败" });
  const preview = `[业务交接] ${args.partNumber}`.slice(0, 200);
  await tx.execute(sql`
    UPDATE conversations
       SET currentRound = CASE WHEN endedAt IS NULL THEN currentRound ELSE currentRound + 1 END,
           roundStartedAt = CASE WHEN endedAt IS NULL THEN roundStartedAt ELSE CURRENT_TIMESTAMP END,
           roundStartMessageId = CASE WHEN endedAt IS NULL THEN roundStartMessageId ELSE ${messageId} END,
           endedAt = NULL, endedByUserId = NULL,
           lastMessageAt = CURRENT_TIMESTAMP, lastMessagePreview = ${preview}, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ${conversationId}
  `);
  await tx.execute(sql`
    UPDATE conversation_user_settings
       SET deleted = 0,
           unreadCount = CASE WHEN deleted = 1 THEN 1 ELSE unreadCount + 1 END,
           updatedAt = CURRENT_TIMESTAMP
     WHERE conversationId = ${conversationId} AND userId = ${args.nextUserId}
  `);
  // This is a system-authored handoff card even though senderId is the buyer for the
  // existing card renderer; mark the buyer's new contact conversation unread as well.
  await tx.execute(sql`
    UPDATE conversation_user_settings
       SET deleted = 0,
           unreadCount = CASE WHEN deleted = 1 THEN 1 ELSE unreadCount + 1 END,
           updatedAt = CURRENT_TIMESTAMP
     WHERE conversationId = ${conversationId} AND userId = ${args.inquiry.buyerUserId}
  `);
  const updated = await tx.execute(sql`
    UPDATE inventory_inquiries
       SET assigneeUserId = ${args.nextUserId}, conversationId = ${conversationId}, messageId = ${messageId},
           transferredFromUserId = ${args.inquiry.assigneeUserId}, lastActivityAt = CURRENT_TIMESTAMP,
           updatedAt = CURRENT_TIMESTAMP
     WHERE id = ${args.inquiry.id} AND enterpriseId = ${args.enterpriseId}
       AND status IN ('open', 'replied') AND assigneeUserId = ${args.inquiry.assigneeUserId}
  `);
  if (affectedRows(updated) !== 1) {
    throw new TRPCError({ code: "CONFLICT", message: "询价负责人或状态在交接期间发生变化，请重新核对" });
  }
  await tx.execute(sql`
    INSERT INTO inventory_inquiry_assignment_logs
      (inquiryId, enterpriseId, previousAssigneeUserId, nextAssigneeUserId, actorUserId,
       previousConversationId, nextConversationId, previousMessageId, nextMessageId, reason, requestId)
    VALUES
      (${args.inquiry.id}, ${args.enterpriseId}, ${args.inquiry.assigneeUserId}, ${args.nextUserId}, ${args.actorUserId},
       ${args.inquiry.conversationId}, ${conversationId}, ${args.inquiry.messageId}, ${messageId}, '企业业务交接', ${args.requestId})
  `);
}

async function recordOrLoadOperation(tx: Db, input: ReturnType<typeof validateExecuteInput>, enterpriseId: number) {
  const payloadHash = enterpriseBusinessHandoffPayloadHash(input, enterpriseId, input.actorUserId);
  await tx.execute(sql`
    INSERT INTO enterprise_business_handoff_operations
      (requestId, enterpriseId, actorUserId, nextUserId, kind, scope, inventoryIds, payloadHash, expectedRevision,
       transferFuture, transferPending, status)
    VALUES
      (${input.requestId}, ${enterpriseId}, ${input.actorUserId}, ${input.nextUserId}, ${input.kind}, ${input.scope},
       ${JSON.stringify(input.inventoryIds)}, ${payloadHash}, ${input.expectedRevision},
       ${input.transferFuture ? 1 : 0}, ${input.transferPending ? 1 : 0}, 'processing')
    ON DUPLICATE KEY UPDATE requestId = VALUES(requestId)
  `);
  const operation = rows<{
    enterpriseId: number; actorUserId: number; nextUserId: number; kind: HandoffKind; scope: HandoffScope;
    inventoryIds: string | number[]; payloadHash: string; expectedRevision: string; transferFuture: number | boolean;
    transferPending: number | boolean; status: string; inventoryCount: number; inquiryCount: number; routingCount: number;
  }>(await tx.execute(sql`
    SELECT enterpriseId, actorUserId, nextUserId, kind, scope, inventoryIds, payloadHash, expectedRevision,
           transferFuture, transferPending, status, inventoryCount, inquiryCount, routingCount
      FROM enterprise_business_handoff_operations WHERE requestId = ${input.requestId} LIMIT 1 FOR UPDATE
  `))[0];
  if (!operation) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "业务交接请求初始化失败" });
  if (operation.payloadHash !== payloadHash || Number(operation.enterpriseId) !== enterpriseId || Number(operation.actorUserId) !== input.actorUserId) {
    throw new TRPCError({ code: "CONFLICT", message: "请求号已用于其他企业业务交接" });
  }
  if (operation.status === "completed") {
    return {
      completed: true as const,
      result: {
        success: true as const,
        idempotent: true,
        inventoryCount: Number(operation.inventoryCount),
        inquiryCount: Number(operation.inquiryCount),
        routingCount: Number(operation.routingCount),
      },
    };
  }
  return { completed: false as const, payloadHash };
}

/** Execute a business handoff in one transaction; retry only lock deadlocks/timeouts. */
export async function executeEnterpriseBusinessHandoff(input: HandoffInput) {
  const request = validateExecuteInput(input);
  const actorScope = await requireActiveEnterpriseScope(request.actorUserId);
  assertOwner(actorScope);
  const db = await requireDb();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await db.transaction(async (tx: Db) => {
        // Global order: enterprise -> all members/permissions -> inventories/routes -> old conversations -> inquiries.
        const enterprise = await lockEnterprise(tx, actorScope.enterprise.id);
        const operation = await recordOrLoadOperation(tx, request, enterprise.id);
        if (operation.completed) return operation.result;

        const members = await allMembers(tx, enterprise.id, true);
        const memberMap = new Map(members.map(member => [member.userId, member]));
        const actorMember = memberMap.get(request.actorUserId);
        const nextMember = memberMap.get(request.nextUserId);
        if (!memberAccountActive(actorMember) || !isEnterpriseOwner(actorMember, enterprise)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "当前账号已不再是企业所有者" });
        }
        if (!memberAccountActive(nextMember)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: bool(nextMember?.loginDisabled) ? "接替人账号已停用" : "接替人不是正常企业成员" });
        }
        if (request.nextUserId === request.actorUserId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "不能将业务转交给自己" });
        }

        const inventories = await loadInventories(tx, enterprise.id, request.scope, request.inventoryIds, true);
        if (request.scope === "selected" && inventories.length !== request.inventoryIds.length) {
          throw new TRPCError({ code: "FORBIDDEN", message: "选择中包含不存在、越权或其他企业的库存" });
        }
        const routes = await loadRoutes(tx, enterprise.id, request.scope, request.inventoryIds, true);
        const preliminaryInquiries = await loadActiveInquiries(tx, enterprise.id, inventories.map(row => row.id));
        assertWithinSafetyLimits(inventories, preliminaryInquiries);

        // Lock old conversations before locking their business records.  The enterprise lock serializes new routed inquiries.
        let inquiries = preliminaryInquiries;
        if (request.transferPending && preliminaryInquiries.length > 0) {
          const conversationIds = Array.from(new Set(preliminaryInquiries.map(row => row.conversationId))).sort((a, b) => a - b);
          await tx.execute(sql`
            SELECT id FROM conversations WHERE id IN (${idList(conversationIds)}) ORDER BY id ASC FOR UPDATE
          `);
          inquiries = await loadActiveInquiries(tx, enterprise.id, inventories.map(row => row.id), true);
          assertWithinSafetyLimits(inventories, inquiries);
        }

        const revision = enterpriseBusinessHandoffRevision({
          enterpriseId: enterprise.id,
          scope: request.scope,
          inventoryIds: request.inventoryIds,
          inventories,
          routes,
          inquiries,
        });
        if (revision !== request.expectedRevision) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "盘点集合、待处理询价或接待规则已变化，请返回重新核对" });
        }
        const plan = planEnterpriseBusinessHandoffMutation({
          kind: request.kind,
          transferFuture: request.transferFuture,
          transferPending: request.transferPending,
          inventoryCount: inventories.length,
          pendingInquiryCount: inquiries.length,
        });
        if (plan.requiresInquiryPermission && !memberCanReceiveNewInquiry(nextMember, enterprise)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "接替人没有询价接待权限，请在成员管理中明确授予" });
        }
        if (request.kind === "inventory" && !memberCanManageInventory(nextMember, enterprise)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "接替人没有库存管理或发布权限，请在成员管理中明确授予" });
        }
        if (request.transferPending && inquiries.some(inquiry => inquiry.buyerUserId === request.nextUserId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "接替人是部分待处理询价的采购方，请选择其他成员" });
        }

        const routeMap = new Map(routes.map(route => [route.inventoryId, route]));
        let routingCount = 0;
        if (request.kind === "inquiry" && request.transferFuture && (request.scope === "enterprise"
          ? !(routes.length === 1 && routes[0].inventoryId === 0 && routes[0].assigneeUserId === request.nextUserId && routes[0].policy === "explicit")
          : inventories.some(inventory => routeMap.get(inventory.id)?.assigneeUserId !== request.nextUserId))) {
          if (request.scope === "enterprise") {
            const overrides = routes.filter(route => route.inventoryId > 0);
            if (overrides.length) {
              await tx.execute(sql`DELETE FROM enterprise_inquiry_routes WHERE enterpriseId = ${enterprise.id} AND inventoryId > 0`);
            }
            await tx.execute(sql`
              INSERT INTO enterprise_inquiry_routes (enterpriseId, inventoryId, assigneeUserId, policy, version, updatedByUserId)
              VALUES (${enterprise.id}, 0, ${request.nextUserId}, 'explicit', 1, ${request.actorUserId})
              ON DUPLICATE KEY UPDATE assigneeUserId = VALUES(assigneeUserId), policy = 'explicit', version = version + 1,
                                      updatedByUserId = VALUES(updatedByUserId), updatedAt = CURRENT_TIMESTAMP
            `);
            routingCount = overrides.length + 1;
          } else {
            for (const inventory of inventories) {
              await tx.execute(sql`
                INSERT INTO enterprise_inquiry_routes (enterpriseId, inventoryId, assigneeUserId, policy, version, updatedByUserId)
                VALUES (${enterprise.id}, ${inventory.id}, ${request.nextUserId}, 'explicit', 1, ${request.actorUserId})
                ON DUPLICATE KEY UPDATE assigneeUserId = VALUES(assigneeUserId), policy = 'explicit', version = version + 1,
                                        updatedByUserId = VALUES(updatedByUserId), updatedAt = CURRENT_TIMESTAMP
              `);
            }
            routingCount = inventories.length;
          }
        }

        // A stock transfer never changes a pre-existing routing decision.  Where there is no rule at all,
        // freeze the pre-transfer valid receiver as an individual rule before changing ownerUserId.
        if (request.kind === "inventory") {
          for (const inventory of inventories) {
            if (routeMap.has(inventory.id) || routeMap.has(0) || inventory.ownerUserId === request.nextUserId) continue;
            const oldRecipient = await resolveInventoryInquiryRecipient(tx, {
              inventoryId: inventory.id,
              enterpriseId: enterprise.id,
              ownerUserId: inventory.ownerUserId,
              sellerUserId: inventory.userId,
            }, { lock: false });
            const oldMember = memberMap.get(oldRecipient);
            if (!memberAccountActive(oldMember)) {
              throw new TRPCError({ code: "PRECONDITION_FAILED", message: "原接待人账号已不可用，无法在不改变后续询价分工的前提下转交库存" });
            }
            await tx.execute(sql`
              INSERT INTO enterprise_inquiry_routes (enterpriseId, inventoryId, assigneeUserId, policy, version, updatedByUserId)
              VALUES (${enterprise.id}, ${inventory.id}, ${oldRecipient}, 'preserved_legacy_owner', 1, ${request.actorUserId})
            `);
            routeMap.set(inventory.id, { inventoryId: inventory.id, assigneeUserId: oldRecipient, policy: "preserved_legacy_owner", version: 1 });
            routingCount += 1;
          }
          const changedInventories = inventories.filter(inventory => inventory.ownerUserId !== request.nextUserId);
          for (const inventory of changedInventories) {
            await tx.execute(sql`
              INSERT INTO inventory_assignment_logs
                (inventoryId, enterpriseId, previousOwnerUserId, nextOwnerUserId, actorUserId, reason, batchId)
              VALUES (${inventory.id}, ${enterprise.id}, ${inventory.ownerUserId}, ${request.nextUserId}, ${request.actorUserId}, '企业业务交接', ${request.requestId})
            `);
            const update = await tx.execute(sql`
              UPDATE inventories
                 SET ownerUserId = ${request.nextUserId}, updatedByUserId = ${request.actorUserId},
                     ownerAssignedAt = CURRENT_TIMESTAMP, ownershipVersion = ownershipVersion + 1
               WHERE id = ${inventory.id} AND enterpriseId = ${enterprise.id}
                 AND ownerUserId ${inventory.ownerUserId == null ? sql`IS NULL` : sql`= ${inventory.ownerUserId}`}
                 AND ownershipVersion = ${inventory.ownershipVersion}
            `);
            if (affectedRows(update) !== 1) {
              throw new TRPCError({ code: "CONFLICT", message: "库存负责人在交接期间发生变化，请重新核对" });
            }
          }
        }

        let inquiryCount = 0;
        if (request.transferPending) {
          const partByInventory = new Map(inventories.map(inventory => [inventory.id, inventory.partNumber]));
          for (const inquiry of inquiries.filter(row => row.assigneeUserId !== request.nextUserId)) {
            await transferPendingInquiry(tx, {
              enterpriseId: enterprise.id,
              actorUserId: request.actorUserId,
              nextUserId: request.nextUserId,
              requestId: request.requestId,
              inquiry,
              partNumber: partByInventory.get(inquiry.inventoryId) || `库存 #${inquiry.inventoryId}`,
              nextRecipientName: displayName(nextMember!),
            });
          }
          inquiryCount = inquiries.filter(row => row.assigneeUserId !== request.nextUserId).length;
        }
        const inventoryCount = request.kind === "inventory" ? inventories.length : 0;
        const response = { success: true as const, idempotent: false, inventoryCount, inquiryCount, routingCount };
        await tx.execute(sql`
          UPDATE enterprise_business_handoff_operations
             SET status = 'completed', inventoryCount = ${inventoryCount}, inquiryCount = ${inquiryCount},
                 routingCount = ${routingCount}, resultJson = ${JSON.stringify(response)}, completedAt = CURRENT_TIMESTAMP,
                 updatedAt = CURRENT_TIMESTAMP
           WHERE requestId = ${request.requestId}
        `);
        return response;
      }, { isolationLevel: "read committed", accessMode: "read write" });
    } catch (error) {
      if (!isRetriableTransactionError(error) || attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 80));
    }
  }
  throw new TRPCError({ code: "TIMEOUT", message: "业务交接繁忙，请稍后重试" });
}

/** Operation records are management data, so only the owner or a member-permission manager may read them. */
export async function getEnterpriseBusinessHandoffState(input: { actorUserId: number }) {
  assertPositiveInteger(input.actorUserId, "操作者");
  const scope = await requireActiveEnterpriseScope(input.actorUserId);
  const mayRead = scope.isOwner;
  if (!mayRead) throw new TRPCError({ code: "FORBIDDEN", message: "您没有查看企业交接记录的权限" });
  const db = await requireDb();
  const enterpriseId = scope.enterprise.id;
  const inventories = await loadInventories(db, enterpriseId, "enterprise", []);
  const [routes, members, pendingRows, operationRows] = await Promise.all([
    loadRoutes(db, enterpriseId, "enterprise", []),
    allMembers(db, enterpriseId),
    loadActiveInquiries(db, enterpriseId, inventories.slice(0, MAX_ENTERPRISE_INVENTORIES).map(row => row.id)),
    db.execute(sql`
      SELECT o.requestId, o.kind, o.inventoryCount, o.inquiryCount, o.routingCount, o.createdAt,
             COALESCE(NULLIF(TRIM(actor.name), ''), NULLIF(TRIM(actor.username), ''), CONCAT('用户', o.actorUserId)) AS actorName,
             COALESCE(NULLIF(TRIM(target.name), ''), NULLIF(TRIM(target.username), ''), CONCAT('用户', o.nextUserId)) AS targetName
        FROM enterprise_business_handoff_operations o
        LEFT JOIN users actor ON actor.id = o.actorUserId
        LEFT JOIN users target ON target.id = o.nextUserId
       WHERE o.enterpriseId = ${enterpriseId} AND o.status = 'completed'
       ORDER BY o.id DESC LIMIT 100
    `),
  ]);
  const memberMap = new Map(members.map(member => [member.userId, member]));
  const routeMap = new Map(routes.map(route => [route.inventoryId, route]));
  const pendingCount = pendingRows.length;
  return {
    inventorySummary: `当前企业共有${inventories.length}条库存`,
    inquirySummary: `当前有${pendingCount}条待处理询价`,
    records: rows<any>(operationRows).map(row => ({
      requestId: String(row.requestId), kind: row.kind as HandoffKind, actorName: String(row.actorName), targetName: String(row.targetName),
      inventoryCount: Number(row.inventoryCount), inquiryCount: Number(row.inquiryCount), routingCount: Number(row.routingCount), createdAt: row.createdAt,
    })),
    details: inventories.slice(0, MAX_ENTERPRISE_INVENTORIES).map(inventory => {
      const recipient = resolvedPreviewRecipient(inventory, routeMap, memberMap, scope.enterprise);
      return {
        id: inventory.id,
        partNumber: inventory.partNumber,
        ownerName: inventory.ownerName || (inventory.ownerUserId ? `用户${inventory.ownerUserId}` : "待分配"),
        inquiryName: recipient ? displayName(recipient) : "待分配",
      };
    }),
  };
}

/** A receiver sees only their own inquiry assignments; inventoryDataScope never broadens this inbox. */
export async function listEnterpriseInquiryInbox(input: {
  actorUserId: number;
  status?: "all" | "open" | "replied" | "closed";
  page?: number;
  pageSize?: number;
}) {
  assertPositiveInteger(input.actorUserId, "操作者");
  const status = input.status ?? "all";
  if (!["all", "open", "replied", "closed"].includes(status)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "询价状态无效" });
  }
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.max(1, Math.min(MAX_INBOX_PAGE_SIZE, Math.floor(input.pageSize ?? 20)));
  const scope = await requireActiveEnterpriseScope(input.actorUserId);
  const hasReceivePermission = scope.isOwner || (scope.permissionKeys as readonly string[]).includes("inquiry.receive");
  if (!hasReceivePermission) throw new TRPCError({ code: "FORBIDDEN", message: "您没有询价接待权限" });
  const db = await requireDb();
  const assignee = scope.isOwner ? sql`` : sql`AND iq.assigneeUserId = ${input.actorUserId}`;
  const statusFilter = status === "all" ? sql`` : sql`AND iq.status = ${status}`;
  const totalRow = rows<{ total: number }>(await db.execute(sql`
    SELECT COUNT(*) AS total FROM inventory_inquiries iq
     WHERE iq.enterpriseId = ${scope.enterprise.id} ${assignee} ${statusFilter}
  `))[0];
  const result = await db.execute(sql`
    SELECT iq.id, iq.inventoryId, COALESCE(i.partNumber, iq.partNumber, CONCAT('库存 #', iq.inventoryId)) AS partNumber,
           COALESCE(i.brand, '') AS brand, COALESCE(i.qtyStock, i.qtyOnSale, 0) AS quantity,
           COALESCE(NULLIF(TRIM(buyer.name), ''), NULLIF(TRIM(buyer.username), ''), CONCAT('用户', iq.buyerUserId)) AS buyerName,
           iq.status, iq.createdAt, iq.lastActivityAt, iq.conversationId
      FROM inventory_inquiries iq
      LEFT JOIN inventories i ON i.id = iq.inventoryId AND i.enterpriseId = iq.enterpriseId
      LEFT JOIN users buyer ON buyer.id = iq.buyerUserId
     WHERE iq.enterpriseId = ${scope.enterprise.id} ${assignee} ${statusFilter}
     ORDER BY iq.lastActivityAt DESC, iq.id DESC
     LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);
  return {
    rows: rows<any>(result).map(row => ({
      id: Number(row.id), inventoryId: Number(row.inventoryId), partNumber: String(row.partNumber), brand: String(row.brand || ""),
      quantity: Number(row.quantity ?? 0), buyerName: String(row.buyerName), status: row.status as "open" | "replied" | "closed",
      createdAt: row.createdAt, lastActivityAt: row.lastActivityAt, conversationId: Number(row.conversationId),
    })),
    total: Number(totalRow?.total ?? 0), page, pageSize,
  };
}

async function validEnterpriseRecipient(database: Db, enterpriseId: number, userId: number, needsInquiryPermission: boolean, lock: boolean) {
  const result = await database.execute(sql`
    SELECT em.userId, em.role, em.status, u.loginDisabled,
           e.superAdminUserId,
           EXISTS(
             SELECT 1 FROM enterprise_member_permissions ep
              WHERE ep.enterpriseMemberId = em.id AND ep.permissionKey = 'inquiry.receive'
           ) AS hasInquiryPermission
      FROM enterprise_members em
      INNER JOIN users u ON u.id = em.userId
      INNER JOIN enterprises e ON e.id = em.enterpriseId
     WHERE em.enterpriseId = ${enterpriseId} AND em.userId = ${userId}
     LIMIT 1
     ${lock ? sql`FOR UPDATE` : sql``}
  `);
  const row = rows<any>(result)[0];
  if (!row || row.status !== "active" || bool(row.loginDisabled)) return false;
  if (!needsInquiryPermission) return true;
  return Number(row.userId) === Number(row.superAdminUserId) || bool(row.hasInquiryPermission);
}

/**
 * Resolve a recipient at the point of inquiry creation.  A caller that creates an inquiry
 * must pass lock:true inside its transaction; this locks the enterprise before inspecting
 * routing, so a handoff cannot send a new inquiry to the old recipient mid-transfer.
 */
export async function resolveInventoryInquiryRecipient(
  database: Db,
  input: { inventoryId: number; enterpriseId: number | null; ownerUserId: number | null; sellerUserId: number },
  options: { lock?: boolean } = {},
): Promise<number> {
  assertPositiveInteger(input.inventoryId, "库存");
  assertPositiveInteger(input.sellerUserId, "卖家");
  if (input.ownerUserId != null) assertPositiveInteger(input.ownerUserId, "库存负责人");
  if (input.enterpriseId != null) assertPositiveInteger(input.enterpriseId, "企业");
  const lock = options.lock === true;
  if (input.enterpriseId != null && lock) {
    const enterprise = rows<{ id: number }>(await database.execute(sql`
      SELECT id FROM enterprises WHERE id = ${input.enterpriseId} LIMIT 1 FOR UPDATE
    `))[0];
    if (!enterprise) throw new TRPCError({ code: "CONFLICT", message: "库存所属企业不存在" });
  }
  const inventory = rows<{ enterpriseId: number | null; ownerUserId: number | null; userId: number }>(await database.execute(sql`
    SELECT enterpriseId, ownerUserId, userId FROM inventories WHERE id = ${input.inventoryId} LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}
  `))[0];
  if (!inventory || (input.enterpriseId ?? null) !== (inventory.enterpriseId == null ? null : Number(inventory.enterpriseId))) {
    throw new TRPCError({ code: "CONFLICT", message: "库存归属已变化，请重新提交询价" });
  }
  const enterpriseId = inventory.enterpriseId == null ? null : Number(inventory.enterpriseId);
  const ownerUserId = inventory.ownerUserId == null ? null : Number(inventory.ownerUserId);
  const sellerUserId = Number(inventory.userId ?? input.sellerUserId);
  if (enterpriseId != null) {
    const ruleRows = rows<RouteRow>(await database.execute(sql`
      SELECT inventoryId, assigneeUserId, policy, version FROM enterprise_inquiry_routes
       WHERE enterpriseId = ${enterpriseId} AND inventoryId IN (0, ${input.inventoryId})
       ORDER BY inventoryId DESC
       ${lock ? sql`FOR UPDATE` : sql``}
    `));
    const individual = ruleRows.find(row => Number(row.inventoryId) === input.inventoryId);
    const defaultRule = ruleRows.find(row => Number(row.inventoryId) === 0);
    const explicit = individual ?? defaultRule;
    if (explicit) {
      const needsInquiryPermission = explicit.policy !== "preserved_legacy_owner";
      if (await validEnterpriseRecipient(database, enterpriseId, Number(explicit.assigneeUserId), needsInquiryPermission, lock)) {
        return Number(explicit.assigneeUserId);
      }
      const enterprise = rows<{ superAdminUserId: number }>(await database.execute(sql`
        SELECT superAdminUserId FROM enterprises WHERE id = ${enterpriseId} LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}
      `))[0];
      if (enterprise && await validEnterpriseRecipient(database, enterpriseId, Number(enterprise.superAdminUserId), false, lock)) {
        return Number(enterprise.superAdminUserId);
      }
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "接待规则已失效且企业所有者账号不可用，请先恢复账号" });
    }
    // No rule means legacy behavior: use a live stock owner first, never a removed seller account.
    if (ownerUserId != null && await validEnterpriseRecipient(database, enterpriseId, ownerUserId, false, lock)) {
      return ownerUserId;
    }
    const enterprise = rows<{ superAdminUserId: number }>(await database.execute(sql`
      SELECT superAdminUserId FROM enterprises WHERE id = ${enterpriseId} LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}
    `))[0];
    if (enterprise && await validEnterpriseRecipient(database, enterpriseId, Number(enterprise.superAdminUserId), false, lock)) {
      return Number(enterprise.superAdminUserId);
    }
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "企业没有可用的询价接待人，请先恢复企业所有者账号或设置接待人" });
  }
  const candidateIds = Array.from(new Set([ownerUserId, sellerUserId].filter((value): value is number => value != null)));
  if (candidateIds.length) {
    const accountRows = rows<{ id: number; loginDisabled: number | boolean }>(await database.execute(sql`
      SELECT id, loginDisabled FROM users WHERE id IN (${idList(candidateIds)}) ORDER BY FIELD(id, ${ownerUserId ?? 0}, ${sellerUserId})
      ${lock ? sql`FOR UPDATE` : sql``}
    `));
    const active = accountRows.find(row => !bool(row.loginDisabled));
    if (active) return Number(active.id);
  }
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: "库存原负责人账号不可用，无法安全接收新询价" });
}
