import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  companies,
  conversations,
  conversationUserSettings,
  enterprises,
  enterpriseMemberHandoffOperations,
  enterpriseMemberPermissions,
  enterpriseMembers,
  enterprisePermissionAuditLogs,
  inventories,
  inventoryAssignmentLogs,
  inventoryInquiries,
  inventoryInquiryAssignmentLogs,
  messages,
  users,
} from "../../drizzle/schema";
import {
  ERP_PERMISSION_DEFINITIONS,
  normalizeErpPermissions,
} from "../../../shared/erpPermissions";
import { inquiryQuantityText } from "../../../shared/inquiryQuantity";
import { getDb } from "../db";
import {
  requireActiveEnterpriseScope,
  requireEnterprisePermissionManager,
} from "./enterprisePermissions";
import {
  actorIdentityContextKey,
  conversationIdentityContextKey,
  resolveConversationCounterpartyIdentity,
  type ConversationParty,
} from "./actorBusinessIdentity";
import { getOrCreateBusinessConversation } from "./businessConversation";

import { MAX_HANDOFF_CUSTOMERS, listHandoffCustomers, replayedHandoffCustomerCount, transferHandoffCustomers, type HandoffCustomerRow } from "./crmCustomerHandoff";
import { collectArchiveCoverage, assertArchiveCoverage, STRICT_ARCHIVE_VERSION, type ArchiveCoverage } from "./enterpriseMemberArchiveCoverage";

const ACTIVE_INQUIRY_STATUSES = ["open", "replied"] as const;
const MAX_HANDOFF_INVENTORIES = 20_000;
const MAX_HANDOFF_INQUIRIES = 500;
type HandoffMode = "handoff_only" | "handoff_remove";

type HandoffRevisionInventory = {
  id: number;
  status: string;
  ownershipVersion: number | null;
};

type HandoffRevisionInquiry = {
  id: number;
  status: string;
  buyerUserId: number;
  previousConversationId: number;
  previousMessageId: number;
};

function createHandoffRevision(
  inventoryRows: HandoffRevisionInventory[],
  inquiryRows: HandoffRevisionInquiry[],
  customerRows: HandoffCustomerRow[] = [],
  coverage?: ArchiveCoverage,
) {
  const snapshot = {
    ...(coverage ? { coverage } : {}),
    ...(customerRows.length ? { customers: customerRows.map(row => [row.id, row.version]).sort((a, b) => a[0] - b[0]) } : {}),
    inventories: inventoryRows
      .map(row => [row.id, row.status, Number(row.ownershipVersion ?? 0)] as const)
      .sort((left, right) => left[0] - right[0]),
    inquiries: inquiryRows
      .map(row => [row.id, row.status, row.previousConversationId, row.previousMessageId] as const)
      .sort((left, right) => left[0] - right[0]),
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

function displayName(row: { name?: string | null; username?: string | null; userId: number }) {
  return String(row.name || row.username || `用户${row.userId}`);
}

function maskPhone(phone: string | null | undefined) {
  if (!phone) return "未绑定";
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function chunks<T>(rows: T[], size = 500) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return (Array.isArray(result[0]) ? result[0] : result) as T[];
  const candidate = result as { rows?: unknown } | null;
  return Array.isArray(candidate?.rows) ? candidate.rows as T[] : [];
}

function affectedRows(result: unknown) {
  return Number((result as unknown as [{ affectedRows?: number }, unknown])?.[0]?.affectedRows ?? 0);
}

function isRetriableTransactionError(error: unknown) {
  const value = error as { code?: string; errno?: number } | null;
  return value?.code === "ER_LOCK_DEADLOCK"
    || value?.code === "ER_LOCK_WAIT_TIMEOUT"
    || value?.errno === 1213
    || value?.errno === 1205;
}

function resultFromOperation(operation: {
  enterpriseId: number;
  actorUserId: number;
  targetUserId: number;
  nextOwnerUserId: number | null;
  mode: HandoffMode;
  inventoryCount: number;
  inquiryCount: number;
}, input: {
  enterpriseId: number;
  actorUserId: number;
  targetUserId: number;
  nextOwnerUserId?: number;
  mode: HandoffMode;
}) {
  if (
    operation.enterpriseId !== input.enterpriseId
    || operation.actorUserId !== input.actorUserId
    || operation.targetUserId !== input.targetUserId
    || operation.nextOwnerUserId !== (input.nextOwnerUserId ?? null)
    || operation.mode !== input.mode
  ) {
    throw new TRPCError({ code: "CONFLICT", message: "请求号已用于其他业务交接" });
  }
  return {
    success: true as const,
    idempotent: true,
    inventoryCount: operation.inventoryCount,
    inquiryCount: operation.inquiryCount,
    removed: operation.mode === "handoff_remove",
  };
}

/**
 * 只读盘点待移除成员当前负责的一期业务，并返回可承担库存业务的同企业成员。
 * 采购需求和外部快速询价没有员工级负责人字段，必须明确标为暂不支持，不能假报为零。
 */
export async function previewEnterpriseMemberHandoff(input: {
  actorUserId: number;
  targetUserId: number;
  mode?: HandoffMode;
  requireCompleteResponsibilityCoverage?: boolean;
}) {
  const isSelfLeave = input.targetUserId === input.actorUserId && input.mode === "handoff_remove";
  if (input.targetUserId === input.actorUserId && !isSelfLeave) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能交接并移除自己" });
  }
  const actor = isSelfLeave
    ? await requireActiveEnterpriseScope(input.actorUserId)
    : await requireEnterprisePermissionManager(input.actorUserId);
  if (input.targetUserId === input.actorUserId && actor.isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "企业所有者请先转让企业所有者身份后再退出" });
  }
  const db = await requireDb();
  const target = (
    await db
      .select({
        memberId: enterpriseMembers.id,
        userId: enterpriseMembers.userId,
        role: enterpriseMembers.role,
        status: enterpriseMembers.status,
        name: users.name,
        username: users.username,
        phone: users.phone,
        loginDisabled: users.loginDisabled,
      })
      .from(enterpriseMembers)
      .innerJoin(users, eq(enterpriseMembers.userId, users.id))
      .where(
        and(
          eq(enterpriseMembers.enterpriseId, actor.enterprise.id),
          eq(enterpriseMembers.userId, input.targetUserId),
        ),
      )
      .limit(1)
  )[0];
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "企业成员不存在" });
  if (target.role === "super_admin" || target.userId === actor.enterprise.superAdminUserId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "企业所有者不能通过成员交接移除" });
  }

  const [memberRows, inventoryRevisionRows, inquiryRevisionRows] = await Promise.all([
    db
      .select({
        memberId: enterpriseMembers.id,
        userId: enterpriseMembers.userId,
        role: enterpriseMembers.role,
        status: enterpriseMembers.status,
        name: users.name,
        username: users.username,
        phone: users.phone,
        loginDisabled: users.loginDisabled,
      })
      .from(enterpriseMembers)
      .innerJoin(users, eq(enterpriseMembers.userId, users.id))
      .where(
        and(
          eq(enterpriseMembers.enterpriseId, actor.enterprise.id),
          eq(enterpriseMembers.status, "active"),
        ),
      ),
    db
      .select({
        id: inventories.id,
        status: inventories.status,
        ownershipVersion: inventories.ownershipVersion,
      })
      .from(inventories)
      .where(
        and(
          eq(inventories.enterpriseId, actor.enterprise.id),
          eq(inventories.ownerUserId, target.userId),
        ),
      )
      .orderBy(asc(inventories.id))
      .limit(MAX_HANDOFF_INVENTORIES + 1),
    db
      .select({
        id: inventoryInquiries.id,
        status: inventoryInquiries.status,
        buyerUserId: inventoryInquiries.buyerUserId,
        previousConversationId: inventoryInquiries.conversationId,
        previousMessageId: inventoryInquiries.messageId,
      })
      .from(inventoryInquiries)
      .where(
        and(
          eq(inventoryInquiries.enterpriseId, actor.enterprise.id),
          eq(inventoryInquiries.assigneeUserId, target.userId),
          inArray(inventoryInquiries.status, [...ACTIVE_INQUIRY_STATUSES]),
        ),
      )
      .orderBy(asc(inventoryInquiries.id))
      .limit(MAX_HANDOFF_INQUIRIES + 1),
  ]);

  const customerRows = await listHandoffCustomers(db, actor.enterprise.id, target.userId);
  const canTransferCustomers = isSelfLeave || actor.isOwner || actor.permissionKeys.includes("customers.manage_all");
  const candidateRows = memberRows.filter(row => row.userId !== target.userId);
  const permissionRows = candidateRows.length
    ? await db
        .select({
          memberId: enterpriseMemberPermissions.enterpriseMemberId,
          permissionKey: enterpriseMemberPermissions.permissionKey,
        })
        .from(enterpriseMemberPermissions)
        .where(inArray(enterpriseMemberPermissions.enterpriseMemberId, candidateRows.map(row => row.memberId)))
    : [];
  const permissionsByMember = new Map<number, string[]>();
  for (const row of permissionRows) {
    const current = permissionsByMember.get(row.memberId) ?? [];
    current.push(row.permissionKey);
    permissionsByMember.set(row.memberId, current);
  }
  const inquiryConflictsByUser = new Map<number, number>();
  for (const row of inquiryRevisionRows) {
    inquiryConflictsByUser.set(row.buyerUserId, (inquiryConflictsByUser.get(row.buyerUserId) ?? 0) + 1);
  }

  const inventoriesByStatus: Record<"draft" | "published" | "offshelf", number> = {
    draft: 0,
    published: 0,
    offshelf: 0,
  };
  for (const row of inventoryRevisionRows) inventoriesByStatus[row.status] += 1;
  const inquiriesByStatus: Record<"open" | "replied", number> = { open: 0, replied: 0 };
  for (const row of inquiryRevisionRows) {
    if (row.status === "open" || row.status === "replied") inquiriesByStatus[row.status] += 1;
  }
  const inventoryCount = inventoryRevisionRows.length;
  const inquiryCount = inquiryRevisionRows.length;
  const customerCount = customerRows.length;
  const coverage = input.requireCompleteResponsibilityCoverage
    ? await collectArchiveCoverage(db, actor.enterprise.id, target.userId) : undefined;

  return {
    enterpriseId: actor.enterprise.id,
    revision: createHandoffRevision(inventoryRevisionRows, inquiryRevisionRows, customerRows, coverage),
    ...(coverage ? { coverage } : {}),
    target: {
      memberId: target.memberId,
      userId: target.userId,
      displayName: displayName(target),
      phone: maskPhone(target.phone),
      status: target.status,
    },
    inventory: {
      total: inventoryCount,
      draft: Number(inventoriesByStatus.draft ?? 0),
      published: Number(inventoriesByStatus.published ?? 0),
      offshelf: Number(inventoriesByStatus.offshelf ?? 0),
    },
    inquiries: {
      total: inquiryCount,
      open: Number(inquiriesByStatus.open ?? 0),
      replied: Number(inquiriesByStatus.replied ?? 0),
    },
    customers: { total: customerCount, archived: customerRows.filter(row => row.archivedAt != null).length },
    limits: {
      customers: MAX_HANDOFF_CUSTOMERS,
      inventory: MAX_HANDOFF_INVENTORIES,
      inquiries: MAX_HANDOFF_INQUIRIES,
      exceeded: inventoryCount > MAX_HANDOFF_INVENTORIES || inquiryCount > MAX_HANDOFF_INQUIRIES || customerCount > MAX_HANDOFF_CUSTOMERS,
    },
    unsupported: [
      { key: "demands" as const, label: "发布的采购需求与收到的需求报价", reason: "公开需求归属稳定企业数据键，公开报价供应商为历史参与身份，不改写", blocking: false },
      { key: "quick_inquiries" as const, label: "网站快速询价", reason: "提交联系人与消息作者是历史身份，不是当前企业员工接待责任", blocking: false },
      ...(coverage?.checks.filter(check => check.blocking) ?? []),
    ],
    candidates: candidateRows.map(row => {
      const permissionKeys = row.role === "super_admin"
        ? Object.keys(ERP_PERMISSION_DEFINITIONS)
        : normalizeErpPermissions(permissionsByMember.get(row.memberId) ?? []);
      const hasInventoryPermission = row.role === "super_admin"
        || permissionKeys.includes("inventory.manage")
        || permissionKeys.includes("inventory.publish");
      const hasInquiryPermission = row.role === "super_admin" || permissionKeys.includes("inquiry.receive");
      const conflictingInquiryCount = inquiryConflictsByUser.get(row.userId) ?? 0;
      const needsInventoryPermission = inventoryCount > 0;
      const needsInquiryPermission = inquiryCount > 0;
      const hasCustomerPermission = row.role === "super_admin" || permissionKeys.includes("customers.manage") || permissionKeys.includes("customers.manage_all");
      const eligible = !row.loginDisabled && (!needsInventoryPermission || hasInventoryPermission) && (!needsInquiryPermission || hasInquiryPermission) && (!customerCount || (hasCustomerPermission && canTransferCustomers)) && conflictingInquiryCount === 0;
      const unavailableReason = row.loginDisabled ? "账号已停用"
        : customerCount && !canTransferCustomers ? "当前操作者需要全部客户管理权限"
        : customerCount && !hasCustomerPermission ? "没有客户列表 / 客户需求权限"
        : needsInventoryPermission && !hasInventoryPermission
        ? "没有库存模块权限"
        : needsInquiryPermission && !hasInquiryPermission
        ? "没有询价接待权限"

        : conflictingInquiryCount > 0
          ? `本人是${conflictingInquiryCount}条待交接询价的采购方`
          : null;
      return {
        userId: row.userId,
        displayName: displayName(row),
        phone: maskPhone(row.phone),
        role: row.role,
        permissionKeys,
        hasInquiryPermission,
        hasInventoryPermission,
        conflictingInquiryCount,
        eligible,
        unavailableReason,
      };
    }),
  };
}

type FrozenConversation = {
  id: number;
  user1Id: number;
  user2Id: number;
  user1EnterpriseId: number | null;
  user2EnterpriseId: number | null;
  user1CompanyId: number | null;
  user2CompanyId: number | null;
  user1CompanyNameSnapshot: string | null;
  user2CompanyNameSnapshot: string | null;
  identityContextKey: string | null;
};

type FrozenInquiryBuyer = {
  buyerUserId: number;
  buyerEnterpriseId: number | null;
  buyerCompanyId: number | null;
  buyerCompanyNameSnapshot: string | null;
  buyerIdentityContextKey: string | null;
};

function nullableFrozenId(value: unknown): number | null {
  if (value == null) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function frozenConversationParty(input: {
  userId: number;
  enterpriseId: unknown;
  companyId: unknown;
  companyName: unknown;
}): ConversationParty {
  const enterpriseId = nullableFrozenId(input.enterpriseId);
  const companyId = nullableFrozenId(input.companyId);
  const companyName = typeof input.companyName === "string" && input.companyName.trim()
    ? input.companyName.trim()
    : null;
  if (
    !Number.isSafeInteger(input.userId) || input.userId <= 0
    || (input.enterpriseId != null && enterpriseId === null)
    || (input.companyId != null && companyId === null)
    || (enterpriseId === null && (companyId !== null || companyName !== null))
    || (enterpriseId !== null && companyName === null)
  ) {
    throw new TRPCError({ code: "CONFLICT", message: "询价冻结身份异常，不能创建交接会话" });
  }
  return {
    userId: input.userId,
    enterpriseId,
    companyId,
    companyName,
    displayName: companyName ?? `用户#${input.userId}`,
  };
}

function frozenBuyerPartyFromConversation(
  conversation: FrozenConversation,
  buyerUserId: number,
  expectedSeller: Pick<ConversationParty, "enterpriseId" | "companyId">,
): ConversationParty {
  if (conversation.identityContextKey === "legacy" || conversation.identityContextKey == null) {
    throw new TRPCError({ code: "CONFLICT", message: "询价冻结会话已降级，不能创建正式交接会话" });
  }
  const first = frozenConversationParty({
    userId: conversation.user1Id,
    enterpriseId: conversation.user1EnterpriseId,
    companyId: conversation.user1CompanyId,
    companyName: conversation.user1CompanyNameSnapshot,
  });
  const second = frozenConversationParty({
    userId: conversation.user2Id,
    enterpriseId: conversation.user2EnterpriseId,
    companyId: conversation.user2CompanyId,
    companyName: conversation.user2CompanyNameSnapshot,
  });
  if (conversation.identityContextKey !== conversationIdentityContextKey(first, second)) {
    throw new TRPCError({ code: "CONFLICT", message: "询价冻结会话身份不一致，不能创建交接会话" });
  }
  const buyer = first.userId === buyerUserId ? first : second.userId === buyerUserId ? second : null;
  if (!buyer) {
    throw new TRPCError({ code: "CONFLICT", message: "询价采购方与冻结会话不一致，不能创建交接会话" });
  }
  const seller = first.userId === buyer.userId ? second : first;
  if (
    seller.enterpriseId !== expectedSeller.enterpriseId
    || seller.companyId !== expectedSeller.companyId
  ) {
    throw new TRPCError({ code: "CONFLICT", message: "询价卖方冻结经营主体与接替人不一致，不能创建交接会话" });
  }
  return buyer;
}

function frozenBuyerPartyFromInquiry(inquiry: FrozenInquiryBuyer): ConversationParty {
  const buyer = frozenConversationParty({
    userId: inquiry.buyerUserId,
    enterpriseId: inquiry.buyerEnterpriseId,
    companyId: inquiry.buyerCompanyId,
    companyName: inquiry.buyerCompanyNameSnapshot,
  });
  if (inquiry.buyerIdentityContextKey !== actorIdentityContextKey(inquiry.buyerUserId, buyer)) {
    throw new TRPCError({ code: "CONFLICT", message: "询价采购方冻结身份不一致，不能创建交接会话" });
  }
  return buyer;
}

async function findOrCreateConversation(tx: any, userA: number, userB: number) {
  const user1Id = Math.min(userA, userB);
  const user2Id = Math.max(userA, userB);
  await tx.execute(sql`
    INSERT INTO conversations (user1Id, user2Id, lastMessagePreview)
    VALUES (${user1Id}, ${user2Id}, '')
    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), updatedAt = updatedAt
  `);
  const result = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
  let conversationId = Number(
    (result as unknown as [Array<{ id: number }>, unknown])[0][0]?.id ?? 0,
  );
  if (!conversationId) {
    const existing = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.user1Id, user1Id), eq(conversations.user2Id, user2Id)))
      .limit(1);
    conversationId = Number(existing[0]?.id ?? 0);
  }
  if (!conversationId) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "询价交接会话创建失败" });
  }
  await tx
    .insert(conversationUserSettings)
    .values([
      { conversationId, userId: userA },
      { conversationId, userId: userB },
    ])
    .onDuplicateKeyUpdate({ set: { deleted: false } });
  return conversationId;
}

/**
 * 在一个数据库事务中交接该成员负责的全部库存与未结库存询价；可选在归零校验后移除成员。
 * 历史创建人、旧会话、订单经办人和企业主体均不改写。
 */
export async function handoffEnterpriseMemberBusiness(input: {
  actorUserId: number;
  targetUserId: number;
  nextOwnerUserId?: number;
  mode: HandoffMode;
  requestId: string;
  expectedRevision: string;
  /** Staff deletion must not misreport a legacy partial handoff as complete retirement. */
  requireCompleteResponsibilityCoverage?: boolean;
}) {
  if (input.requireCompleteResponsibilityCoverage && (input.actorUserId === input.targetUserId || input.mode !== "handoff_remove")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "严格归档不能删除自己或用于普通业务交接" });
  }
  const isSelfLeave = input.targetUserId === input.actorUserId && input.mode === "handoff_remove";
  if (input.targetUserId === input.actorUserId && !isSelfLeave) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能交接并移除自己" });
  }
  const actor = isSelfLeave
    ? await requireActiveEnterpriseScope(input.actorUserId)
    : await requireEnterprisePermissionManager(input.actorUserId);
  if (input.targetUserId === input.actorUserId && actor.isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "企业所有者请先转让企业所有者身份后再退出" });
  }
  if (input.nextOwnerUserId === input.targetUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "接替人不能是待交接成员本人" });
  }
  const db = await requireDb();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await db.transaction(async tx => {
    // 先抢占全局唯一 requestId，再锁定该记录；并发同键请求只会有一个执行数据变更。
    await tx
      .insert(enterpriseMemberHandoffOperations)
      .values({
        enterpriseId: actor.enterprise.id,
        actorUserId: input.actorUserId,
        targetUserId: input.targetUserId,
        nextOwnerUserId: input.nextOwnerUserId ?? null,
        mode: input.mode,
        status: "processing",
        inventoryCount: 0,
        inquiryCount: 0,
        requestId: input.requestId,
      })
      .onDuplicateKeyUpdate({ set: { requestId: input.requestId } });
    const requestOperation = (
      await tx
        .select()
        .from(enterpriseMemberHandoffOperations)
        .where(eq(enterpriseMemberHandoffOperations.requestId, input.requestId))
        .limit(1)
        .for("update")
    )[0];
    if (!requestOperation) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "业务交接请求初始化失败" });
    }
    const previousResult = resultFromOperation(requestOperation, {
      ...input,
      enterpriseId: actor.enterprise.id,
    });
    if (requestOperation.status === "completed" && !input.requireCompleteResponsibilityCoverage) return { ...previousResult, enterpriseId: actor.enterprise.id, targetUserId: input.targetUserId, customerCount: await replayedHandoffCustomerCount(tx, actor.enterprise.id, input.requestId) };

    // 与超级管理员转让统一采用“企业行 → 成员行 → 权限/业务行”的锁顺序。
    const lockedEnterprise = (
      await tx
        .select()
        .from(enterprises)
        .where(eq(enterprises.id, actor.enterprise.id))
        .limit(1)
        .for("update")
    )[0];
    if (!lockedEnterprise) {
      throw new TRPCError({ code: "NOT_FOUND", message: "企业不存在" });
    }

    // 待交接人与接替人按 userId 固定顺序一起加锁，避免 A→B 与 B→A 并发死锁。
    const involvedUserIds = Array.from(new Set([
      input.actorUserId,
      input.targetUserId,
      ...(input.nextOwnerUserId ? [input.nextOwnerUserId] : []),
    ])).sort((a, b) => a - b);
    const lockedMembers = await tx
      .select()
      .from(enterpriseMembers)
      .where(
        and(
          eq(enterpriseMembers.enterpriseId, actor.enterprise.id),
          inArray(enterpriseMembers.userId, involvedUserIds),
        ),
      )
      .orderBy(asc(enterpriseMembers.userId))
      .for("update");
    const actorMember = lockedMembers.find(member => member.userId === input.actorUserId);
    if (!actorMember || actorMember.status !== "active") {
      throw new TRPCError({ code: "FORBIDDEN", message: "当前账号已无企业成员管理权限" });
    }
    const actorIsOwner = actorMember.userId === lockedEnterprise.superAdminUserId;
    const lockedSelfLeave = input.targetUserId === input.actorUserId && input.mode === "handoff_remove";
    if (input.targetUserId === input.actorUserId && !lockedSelfLeave) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "不能交接并移除自己" });
    }
    if (lockedSelfLeave && actorIsOwner) {
      throw new TRPCError({ code: "FORBIDDEN", message: "企业所有者请先转让企业所有者身份后再退出" });
    }
    let canTransferCustomers = actorIsOwner || lockedSelfLeave;
    if (!actorIsOwner && !lockedSelfLeave) {
      const actorPermissions = await tx
        .select({ permissionKey: enterpriseMemberPermissions.permissionKey })
        .from(enterpriseMemberPermissions)
        .where(eq(enterpriseMemberPermissions.enterpriseMemberId, actorMember.id))
        .for("update");
      canTransferCustomers = actorPermissions.some(row => row.permissionKey === "customers.manage_all");
      if (!actorPermissions.some(row => row.permissionKey === "enterprise.members.manage")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "当前账号已无企业成员管理权限" });
      }
    }
    const target = lockedMembers.find(member => member.userId === input.targetUserId);
    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "企业成员不存在或已移除" });
    }
    if (target.role === "super_admin" || target.userId === lockedEnterprise.superAdminUserId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "企业所有者不能通过成员交接移除" });
    }

    // A legacy completed partial handoff is never a strict archive receipt.
    // Exact operation identity was checked above; marker and soft revoke commit together.
    if (requestOperation.status === "completed" && input.requireCompleteResponsibilityCoverage) {
      const proof = rows<{ id: number }>(await tx.execute(sql`
        SELECT id FROM enterprise_permission_audit_logs
         WHERE enterpriseId = ${actor.enterprise.id} AND actorUserId = ${input.actorUserId}
           AND targetUserId = ${input.targetUserId} AND requestId = ${input.requestId}
           AND action = 'member_removed' AND result = 'success'
           AND LEFT(note, ${STRICT_ARCHIVE_VERSION.length + 1}) = ${STRICT_ARCHIVE_VERSION + ":"}
         LIMIT 1 FOR UPDATE
      `));
      if (!proof.length) throw new TRPCError({ code: "CONFLICT", message: "请求号仅有旧版部分交接回执，请重新盘点并使用新的归档请求号" });
      return { ...previousResult, enterpriseId: actor.enterprise.id, targetUserId: input.targetUserId, customerCount: await replayedHandoffCustomerCount(tx, actor.enterprise.id, input.requestId), enterpriseAccessRevoked: true, responsibilityComplete: true };
    }
    const coverage = input.requireCompleteResponsibilityCoverage
      ? await collectArchiveCoverage(tx, actor.enterprise.id, target.userId, true) : undefined;
    if (coverage) assertArchiveCoverage(coverage);

    // New business-handoff routes are independent of legacy inventory ownership.
    // Refuse before any legacy inventory/inquiry/customer/membership write; the
    // enterprise lock above serializes this check with route mutations.
    const attachedFutureRoutes = await tx.execute(sql`
      SELECT inventoryId, assigneeUserId, policy, version
        FROM enterprise_inquiry_routes
       WHERE enterpriseId = ${actor.enterprise.id} AND assigneeUserId = ${target.userId}
       ORDER BY inventoryId ASC
       FOR UPDATE
    `);
    if (rows<{ inventoryId: number }>(attachedFutureRoutes).length > 0) {
      throw new TRPCError({ code: "CONFLICT", message: "此成员仍负责后续询价，请先在业务交接中转交询价" });
    }

    const inventoryRows = await tx
      .select({
        id: inventories.id,
        status: inventories.status,
        ownershipVersion: inventories.ownershipVersion,
      })
      .from(inventories)
      .where(
        and(
          eq(inventories.enterpriseId, actor.enterprise.id),
          eq(inventories.ownerUserId, target.userId),
        ),
      )
      .orderBy(asc(inventories.id))
      .limit(MAX_HANDOFF_INVENTORIES + 1)
      .for("update");
    const inquiryCandidates = await tx
      .select({
        id: inventoryInquiries.id,
        previousConversationId: inventoryInquiries.conversationId,
      })
      .from(inventoryInquiries)
      .where(
        and(
          eq(inventoryInquiries.enterpriseId, actor.enterprise.id),
          eq(inventoryInquiries.assigneeUserId, target.userId),
          inArray(inventoryInquiries.status, [...ACTIVE_INQUIRY_STATUSES]),
        ),
      )
      .orderBy(asc(inventoryInquiries.id))
      .limit(MAX_HANDOFF_INQUIRIES + 1);
    const previousConversationIds = Array.from(
      new Set(inquiryCandidates.map(row => row.previousConversationId)),
    ).sort((a, b) => a - b);
    const lockedConversations = new Map<number, FrozenConversation>();
    for (const conversationBatch of chunks(previousConversationIds)) {
      const lockedRows = await tx
        .select({
          id: conversations.id,
          user1Id: conversations.user1Id,
          user2Id: conversations.user2Id,
          user1EnterpriseId: conversations.user1EnterpriseId,
          user2EnterpriseId: conversations.user2EnterpriseId,
          user1CompanyId: conversations.user1CompanyId,
          user2CompanyId: conversations.user2CompanyId,
          user1CompanyNameSnapshot: conversations.user1CompanyNameSnapshot,
          user2CompanyNameSnapshot: conversations.user2CompanyNameSnapshot,
          identityContextKey: conversations.identityContextKey,
        })
        .from(conversations)
        .where(inArray(conversations.id, conversationBatch))
        .orderBy(asc(conversations.id))
        .for("update");
      for (const row of lockedRows) lockedConversations.set(row.id, row);
    }
    const inquiryRows = inquiryCandidates.length > 0 ? await tx
      .select({
        id: inventoryInquiries.id,
        inventoryId: inventoryInquiries.inventoryId,
        buyerUserId: inventoryInquiries.buyerUserId,
        assigneeUserId: inventoryInquiries.assigneeUserId,
        status: inventoryInquiries.status,
        requestedQty: inventoryInquiries.requestedQty,
        buyerEnterpriseId: inventoryInquiries.buyerEnterpriseId,
        buyerCompanyId: inventoryInquiries.buyerCompanyId,
        buyerCompanyNameSnapshot: inventoryInquiries.buyerCompanyNameSnapshot,
        buyerIdentityContextKey: inventoryInquiries.buyerIdentityContextKey,
        previousConversationId: inventoryInquiries.conversationId,
        previousMessageId: inventoryInquiries.messageId,
      })
      .from(inventoryInquiries)
      .where(
        and(
          inArray(inventoryInquiries.id, inquiryCandidates.map(row => row.id)),
          eq(inventoryInquiries.enterpriseId, actor.enterprise.id),
          eq(inventoryInquiries.assigneeUserId, target.userId),
          inArray(inventoryInquiries.status, [...ACTIVE_INQUIRY_STATUSES]),
        ),
      )
      .orderBy(asc(inventoryInquiries.id))
      .limit(MAX_HANDOFF_INQUIRIES + 1)
      .for("update") : [];
    const customerRows = await listHandoffCustomers(tx, actor.enterprise.id, target.userId, true);
    if (customerRows.length && !canTransferCustomers) {
      throw new TRPCError({ code: "FORBIDDEN", message: "交接客户需要全部客户管理权限，请由获授权的管理员处理" });
    }
    if (inventoryRows.length > MAX_HANDOFF_INVENTORIES || inquiryRows.length > MAX_HANDOFF_INQUIRIES || customerRows.length > MAX_HANDOFF_CUSTOMERS) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `业务量超过单次安全上限（库存${MAX_HANDOFF_INVENTORIES}条、未结询价${MAX_HANDOFF_INQUIRIES}条、客户${MAX_HANDOFF_CUSTOMERS}条），请联系平台管理员分批处理`,
      });
    }
    const currentRevision = coverage
      ? createHandoffRevision(inventoryRows, inquiryRows, customerRows, coverage)
      : createHandoffRevision(inventoryRows, inquiryRows, customerRows);
    if (currentRevision !== input.expectedRevision) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "成员业务集合已变化，请返回盘点步骤重新核对",
      });
    }
    if (inquiryRows.some(row => row.inventoryId == null)) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "含工厂库存接待单，请先通过受控工厂接待交接完成处理；不能按普通库存改派" });
    }
    const inquiryInventoryIds = Array.from(new Set(inquiryRows.map(row => row.inventoryId).filter((id): id is number => id != null)));
    const inquiryInventoryRows: Array<{ id: number; partNumber: string }> = [];
    for (const inventoryIdBatch of chunks(inquiryInventoryIds)) {
      const rows = await tx
          .select({ id: inventories.id, partNumber: inventories.partNumber })
          .from(inventories)
          .where(
            and(
              eq(inventories.enterpriseId, actor.enterprise.id),
              inArray(inventories.id, inventoryIdBatch),
            ),
          );
      inquiryInventoryRows.push(...rows);
    }
    if (inquiryInventoryRows.length !== inquiryInventoryIds.length) {
      throw new TRPCError({ code: "CONFLICT", message: "存在企业归属异常的库存询价，请联系平台管理员" });
    }
    const partNumberByInventoryId = new Map(
      inquiryInventoryRows.map(row => [row.id, row.partNumber]),
    );

    const inventoryCount = inventoryRows.length;
    const inquiryCount = inquiryRows.length;
    const customerCount = customerRows.length;
    if (!actorIsOwner && inquiryCount > 0) {
      const actorInquiryPermission = await tx
        .select({ permissionKey: enterpriseMemberPermissions.permissionKey })
        .from(enterpriseMemberPermissions)
        .where(eq(enterpriseMemberPermissions.enterpriseMemberId, actorMember.id))
        .for("update");
      if (!actorInquiryPermission.some(row => row.permissionKey === "inquiry.receive")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "当前账号没有询价接待权限，不能交接未结询价" });
      }
    }
    if ((inventoryCount > 0 || inquiryCount > 0 || customerCount > 0) && !input.nextOwnerUserId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请选择业务接替人" });
    }

    let nextOwner: typeof enterpriseMembers.$inferSelect | null = null;
    if (input.nextOwnerUserId) {
      nextOwner = lockedMembers.find(member => member.userId === input.nextOwnerUserId) ?? null;
      if (!nextOwner || nextOwner.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "接替人不是当前企业的正常成员" });
      }
      const recipientAccount = (await tx.select({ disabled: users.loginDisabled }).from(users).where(eq(users.id, nextOwner.userId)).limit(1))[0];
      if (!recipientAccount || recipientAccount.disabled) throw new TRPCError({ code: "BAD_REQUEST", message: "接替人账号不可用" });
      if (nextOwner.role !== "super_admin") {
        const permissionRows = await tx
          .select({ permissionKey: enterpriseMemberPermissions.permissionKey })
          .from(enterpriseMemberPermissions)
          .where(eq(enterpriseMemberPermissions.enterpriseMemberId, nextOwner.id));
        if (inventoryCount > 0 && !permissionRows.some(row => row.permissionKey === "inventory.manage" || row.permissionKey === "inventory.publish")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "接替人没有库存模块权限" });
        }
        if (inquiryCount > 0 && !permissionRows.some(row => row.permissionKey === "inquiry.receive")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "接替人没有询价接待权限" });
        }
        if (customerCount > 0 && !permissionRows.some(row => row.permissionKey === "customers.manage" || row.permissionKey === "customers.manage_all")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "接替人没有客户列表 / 客户需求权限" });
        }
      }
      if (inquiryRows.some(row => row.buyerUserId === nextOwner?.userId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "接替人是部分未结询价的采购方，请选择其他成员" });
      }
    }
    let nextOwnerParty: ConversationParty | null = null;
    const hasFormalInquiry = inquiryRows.some(row =>
      row.buyerIdentityContextKey !== "legacy" && row.buyerIdentityContextKey != null,
    );
    if (nextOwner && hasFormalInquiry) {
      nextOwnerParty = {
        userId: nextOwner.userId,
        ...await resolveConversationCounterpartyIdentity(tx, nextOwner.userId, actor.enterprise.id),
      };
    }

    if (nextOwner && customerCount > 0) {
      await transferHandoffCustomers(tx, { enterpriseId: actor.enterprise.id, actorUserId: input.actorUserId, previousUserId: target.userId, nextUserId: nextOwner.userId, requestId: input.requestId, customers: customerRows });
    }

    const batchId = input.requestId;
    if (nextOwner && inventoryCount > 0) {
      for (const inventoryBatch of chunks(inventoryRows)) {
        await tx.insert(inventoryAssignmentLogs).values(
          inventoryBatch.map(row => ({
            inventoryId: row.id,
            enterpriseId: actor.enterprise.id,
            previousOwnerUserId: target.userId,
            nextOwnerUserId: nextOwner!.userId,
            actorUserId: input.actorUserId,
            reason: "企业成员业务交接",
            batchId,
          })),
        );
      }
      const inventoryUpdate = await tx
        .update(inventories)
        .set({
          ownerUserId: nextOwner.userId,
          updatedByUserId: input.actorUserId,
          ownerAssignedAt: new Date(),
          ownershipVersion: sql`${inventories.ownershipVersion} + 1`,
        })
        .where(
          and(
            eq(inventories.enterpriseId, actor.enterprise.id),
            eq(inventories.ownerUserId, target.userId),
          ),
        );
      if (affectedRows(inventoryUpdate) !== inventoryCount) {
        throw new TRPCError({ code: "CONFLICT", message: "库存负责人在交接期间发生变化，请刷新后重试" });
      }
    }

    if (nextOwner) {
      for (const inquiry of inquiryRows) {
        let conversationId: number;
        if (inquiry.buyerIdentityContextKey === "legacy" || inquiry.buyerIdentityContextKey == null) {
          conversationId = await findOrCreateConversation(tx, inquiry.buyerUserId, nextOwner.userId);
        } else {
          const sourceConversation = lockedConversations.get(inquiry.previousConversationId);
          if (!sourceConversation || !nextOwnerParty) {
            throw new TRPCError({ code: "CONFLICT", message: "询价冻结会话异常，不能创建交接会话" });
          }
          const frozenBuyer = frozenBuyerPartyFromConversation(sourceConversation, inquiry.buyerUserId, nextOwnerParty);
          const storedBuyer = frozenBuyerPartyFromInquiry(inquiry);
          if (
            frozenBuyer.enterpriseId !== storedBuyer.enterpriseId
            || frozenBuyer.companyId !== storedBuyer.companyId
            || frozenBuyer.companyName !== storedBuyer.companyName
          ) {
            throw new TRPCError({ code: "CONFLICT", message: "询价采购方冻结身份与会话不一致，不能创建交接会话" });
          }
          conversationId = await getOrCreateBusinessConversation(tx, frozenBuyer, nextOwnerParty);
        }
        const partNumber = (inquiry.inventoryId == null ? null : partNumberByInventoryId.get(inquiry.inventoryId)) || `库存 #${inquiry.inventoryId}`;
        const content = JSON.stringify({
          kind: "member_handoff",
          partNumber,
          quantity: inquiryQuantityText(inquiry.requestedQty),
          inventoryId: inquiry.inventoryId,
          sourceInquiryId: inquiry.id,
          requestId: input.requestId,
        });
        const clientMessageId = `handoff:${createHash("sha256")
          .update(`${input.requestId}:${inquiry.id}`)
          .digest("hex")
          .slice(0, 48)}`;
        let message = (
          await tx
            .select({
              id: messages.id,
              conversationId: messages.conversationId,
              senderId: messages.senderId,
              msgType: messages.msgType,
              content: messages.content,
            })
            .from(messages)
            .where(
              and(
                eq(messages.senderId, inquiry.buyerUserId),
                eq(messages.clientMessageId, clientMessageId),
              ),
            )
            .limit(1)
            .for("update")
        )[0];
        const messageWasCreated = !message;
        if (!message) {
          await tx.insert(messages).values({
            conversationId,
            senderId: inquiry.buyerUserId,
            clientMessageId,
            msgType: "handoff_notice",
            content,
          });
          message = (
            await tx
              .select({
                id: messages.id,
                conversationId: messages.conversationId,
                senderId: messages.senderId,
                msgType: messages.msgType,
                content: messages.content,
              })
              .from(messages)
              .where(
                and(
                  eq(messages.senderId, inquiry.buyerUserId),
                  eq(messages.clientMessageId, clientMessageId),
                ),
              )
              .limit(1)
          )[0];
        }
        if (!message) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "询价交接通知写入失败" });
        }
        if (
          message.conversationId !== conversationId
          || message.senderId !== inquiry.buyerUserId
          || message.msgType !== "handoff_notice"
          || message.content !== content
        ) {
          throw new TRPCError({ code: "CONFLICT", message: "询价交接消息幂等键冲突" });
        }
        const preview = `[业务交接] ${partNumber}`.slice(0, 200);
        if (messageWasCreated) {
          await tx.execute(sql`
            UPDATE conversations
               SET currentRound = CASE WHEN endedAt IS NULL THEN currentRound ELSE currentRound + 1 END,
                   roundStartedAt = CASE WHEN endedAt IS NULL THEN roundStartedAt ELSE NOW() END,
                   roundStartMessageId = CASE WHEN endedAt IS NULL THEN roundStartMessageId ELSE ${message.id} END,
                   endedAt = NULL,
                   endedByUserId = NULL,
                   lastMessageAt = NOW(),
                   lastMessagePreview = ${preview},
                   updatedAt = NOW()
             WHERE id = ${conversationId}
          `);
          await tx.execute(sql`
            UPDATE conversation_user_settings
               SET deleted = 0,
                   unreadCount = CASE WHEN deleted = 1 THEN 1 ELSE unreadCount + 1 END,
                   updatedAt = NOW()
             WHERE conversationId = ${conversationId} AND userId = ${nextOwner.userId}
          `);
        }
        const inquiryUpdate = await tx
          .update(inventoryInquiries)
          .set({
            assigneeUserId: nextOwner.userId,
            conversationId,
            messageId: message.id,
            transferredFromUserId: target.userId,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(inventoryInquiries.id, inquiry.id),
              eq(inventoryInquiries.enterpriseId, actor.enterprise.id),
              eq(inventoryInquiries.assigneeUserId, target.userId),
              inArray(inventoryInquiries.status, [...ACTIVE_INQUIRY_STATUSES]),
            ),
          );
        if (affectedRows(inquiryUpdate) !== 1) {
          throw new TRPCError({ code: "CONFLICT", message: "询价负责人或状态在交接期间发生变化，请刷新后重试" });
        }
        await tx.insert(inventoryInquiryAssignmentLogs).values({
          inquiryId: inquiry.id,
          enterpriseId: actor.enterprise.id,
          previousAssigneeUserId: target.userId,
          nextAssigneeUserId: nextOwner.userId,
          actorUserId: input.actorUserId,
          previousConversationId: inquiry.previousConversationId,
          nextConversationId: conversationId,
          previousMessageId: inquiry.previousMessageId,
          nextMessageId: message.id,
          reason: "企业成员业务交接",
          requestId: input.requestId,
        });
      }
    }

    if (input.mode === "handoff_remove") {
      const remainingInventory = await tx
        .select({ id: inventories.id })
        .from(inventories)
        .where(
          and(
            eq(inventories.enterpriseId, actor.enterprise.id),
            eq(inventories.ownerUserId, target.userId),
          ),
        )
        .orderBy(asc(inventories.id))
        .for("update");
      const remainingInquiries = await tx
        .select({ id: inventoryInquiries.id })
        .from(inventoryInquiries)
        .where(
          and(
            eq(inventoryInquiries.enterpriseId, actor.enterprise.id),
            eq(inventoryInquiries.assigneeUserId, target.userId),
            inArray(inventoryInquiries.status, [...ACTIVE_INQUIRY_STATUSES]),
          ),
        )
        .orderBy(asc(inventoryInquiries.id))
        .for("update");
      const remainingCustomers = await listHandoffCustomers(tx, actor.enterprise.id, target.userId, true);
      if (remainingInventory.length > 0 || remainingInquiries.length > 0 || remainingCustomers.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "交接期间业务发生变化，请刷新后重试" });
      }
      if (input.requireCompleteResponsibilityCoverage) {
        assertArchiveCoverage(await collectArchiveCoverage(tx, actor.enterprise.id, target.userId, true), true);
      }

      const previous = await tx
        .select({ permissionKey: enterpriseMemberPermissions.permissionKey })
        .from(enterpriseMemberPermissions)
        .where(eq(enterpriseMemberPermissions.enterpriseMemberId, target.id));
      await tx.insert(enterprisePermissionAuditLogs).values({
        enterpriseId: actor.enterprise.id,
        actorUserId: input.actorUserId,
        targetUserId: target.userId,
        action: lockedSelfLeave ? "member_left" : "member_removed",
        beforePermissions: normalizeErpPermissions(previous.map(row => row.permissionKey)),
        requestId: input.requestId,
        note: `${input.requireCompleteResponsibilityCoverage ? STRICT_ARCHIVE_VERSION + ":当前企业资格软归档；" : ""}${lockedSelfLeave ? "主动退出企业" : "业务交接后移除"}：库存${inventoryCount}条，未结询价${inquiryCount}条，客户${customerCount}条`,
      });
      if (input.requireCompleteResponsibilityCoverage) {
        const revoked = await tx.update(enterpriseMembers).set({
          status: "suspended", suspendedAt: new Date(),
          permissionVersion: sql`${enterpriseMembers.permissionVersion} + 1`,
        }).where(and(eq(enterpriseMembers.id, target.id), eq(enterpriseMembers.enterpriseId, actor.enterprise.id)));
        if (affectedRows(revoked) !== 1) throw new TRPCError({ code: "CONFLICT", message: "企业成员资格在归档期间发生变化" });
        await tx.execute(sql`UPDATE enterprise_member_module_access
          SET readAllowed = FALSE, writeAllowed = FALSE, revision = revision + 1
          WHERE enterpriseId = ${actor.enterprise.id} AND userId = ${target.userId}`);
        // Keep permissions/team membership as history. Every authority resolver
        // intersects enterprise_members.active; explicit module denies also persist.
      } else {
        await tx
          .delete(enterpriseMemberPermissions)
          .where(eq(enterpriseMemberPermissions.enterpriseMemberId, target.id));
        await tx.delete(enterpriseMembers).where(eq(enterpriseMembers.id, target.id));
      }
      // Membership/permissions are the current-enterprise access authority.
      // Preserve company identity/history and the account's other enterprise identities;
      // do not globally disable crmAccess/loginDisabled or erase company ownership.
    }

    await tx
      .update(enterpriseMemberHandoffOperations)
      .set({ status: "completed", inventoryCount, inquiryCount })
      .where(eq(enterpriseMemberHandoffOperations.requestId, input.requestId));

    return {
      success: true as const,
      enterpriseId: actor.enterprise.id,
      targetUserId: input.targetUserId,
      idempotent: false,
      inventoryCount,
      inquiryCount,
      customerCount,
      removed: input.mode === "handoff_remove",
      ...(input.requireCompleteResponsibilityCoverage ? { enterpriseAccessRevoked: true, responsibilityComplete: true } : {}),
    };
      }, { isolationLevel: "read committed", accessMode: "read write" });
    } catch (error) {
      if (!isRetriableTransactionError(error) || attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 80));
    }
  }
  throw new TRPCError({ code: "TIMEOUT", message: "业务交接繁忙，请稍后重试" });
}
