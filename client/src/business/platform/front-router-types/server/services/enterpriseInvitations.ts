import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import {
  companies,
  enterpriseMemberInvitations,
  enterpriseMemberPermissions,
  enterpriseMembers,
  enterprisePermissionAuditLogs,
  enterprises,
  users,
} from "../../drizzle/schema";
import {
  ERP_PERMISSION_DEFINITIONS,
  normalizeErpPermissions,
  type ErpPermissionKey,
} from "../../../shared/erpPermissions";
import { getDb } from "../db";
import { getServiceUserId } from "./customerService";
import {
  assertGrantSubset,
  listPermissionKeysByMemberIds,
  normalizePermissionInput,
  requireEnterprisePermissionManager,
} from "./enterprisePermissions";

export const INVITATION_TTL_HOURS = 24;
const INVITATION_TTL_MS = INVITATION_TTL_HOURS * 60 * 60 * 1000;
const ENTERPRISE_HOURLY_LIMIT = 20;
const TARGET_DAILY_LIMIT = 3;
const INVITATION_ERROR = "当前无法发送邀请，请核对手机号或让对方先完成51电子网注册";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

function normalizePhone(phone: string) {
  const normalized = phone.replace(/[\s-]/g, "");
  if (!/^1[3-9]\d{9}$/.test(normalized)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "请输入正确的11位手机号" });
  }
  return normalized;
}

function maskPhone(phone: string) {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function maskName(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "51电子网用户";
  if (text.length === 1) return `${text}*`;
  return `${text.slice(0, 1)}${"*".repeat(Math.min(3, text.length - 1))}`;
}

function companyMatchesEnterpriseIdentity(
  company: { creditCode?: string | null; registrationRegion?: string | null; registrationIdentifier?: string | null },
  enterprise: { creditCode?: string | null; registrationRegion?: string | null; registrationIdentifier?: string | null },
) {
  if (enterprise.registrationRegion === "HK") {
    return company.registrationRegion === "HK"
      && Boolean(company.registrationIdentifier)
      && company.registrationIdentifier === enterprise.registrationIdentifier;
  }
  return Boolean(company.creditCode) && company.creditCode === enterprise.creditCode;
}

function companyHasEnterpriseIdentity(company: { creditCode?: string | null; registrationIdentifier?: string | null }) {
  return Boolean(company.creditCode || company.registrationIdentifier);
}

function createTokenHash() {
  return randomBytes(32).toString("hex");
}

function invitationContent(input: {
  invitationId: number;
  enterpriseName: string;
  inviterName: string;
  permissionKeys: ErpPermissionKey[];
  inventoryDataScope: "own" | "enterprise";
  expiresAt: Date;
}) {
  return JSON.stringify({
    version: 1,
    invitationId: input.invitationId,
    enterpriseName: input.enterpriseName,
    inviterName: input.inviterName,
    permissions: input.permissionKeys.map(key => ({
      key,
      label: ERP_PERMISSION_DEFINITIONS[key].label,
    })),
    inventoryDataScope: input.inventoryDataScope,
    inventoryDataScopeLabel:
      input.inventoryDataScope === "enterprise" ? "全企业业务" : "仅本人业务",
    expiresAt: input.expiresAt.toISOString(),
    validForHours: INVITATION_TTL_HOURS,
    status: "pending",
  });
}

async function insertInvitationMessage(
  tx: any,
  input: {
    serviceUserId: number;
    targetUserId: number;
    invitationId: number;
    enterpriseName: string;
    inviterName: string;
    permissionKeys: ErpPermissionKey[];
    inventoryDataScope: "own" | "enterprise";
    expiresAt: Date;
  },
) {
  const user1Id = Math.min(input.serviceUserId, input.targetUserId);
  const user2Id = Math.max(input.serviceUserId, input.targetUserId);
  await tx.execute(sql`
    INSERT INTO conversations (user1Id, user2Id)
    VALUES (${user1Id}, ${user2Id})
    ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id), updatedAt = updatedAt
  `);
  const conversationResult = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
  const conversationRows = (conversationResult as unknown as [Array<{ id: number }>, unknown])[0];
  let conversationId = Number(conversationRows[0]?.id ?? 0);
  if (!conversationId) {
    const existingResult = await tx.execute(sql`
      SELECT id FROM conversations
      WHERE user1Id = ${user1Id} AND user2Id = ${user2Id}
      LIMIT 1
    `);
    const existingRows = (existingResult as unknown as [Array<{ id: number }>, unknown])[0];
    conversationId = Number(existingRows[0]?.id ?? 0);
  }
  if (!conversationId) throw new Error("51小电邀请会话创建失败");

  await tx.execute(sql`
    INSERT INTO conversation_user_settings (conversationId, userId)
    VALUES (${conversationId}, ${input.targetUserId})
    ON DUPLICATE KEY UPDATE deleted = 0
  `);
  await tx.execute(sql`
    INSERT INTO conversation_user_settings (conversationId, userId)
    VALUES (${conversationId}, ${input.serviceUserId})
    ON DUPLICATE KEY UPDATE deleted = 0
  `);

  const clientMessageId = `erp-invite-${input.invitationId}`;
  const content = invitationContent(input);
  await tx.execute(sql`
    INSERT IGNORE INTO messages (conversationId, senderId, clientMessageId, msgType, content)
    VALUES (${conversationId}, ${input.serviceUserId}, ${clientMessageId}, 'erp_invite', ${content})
  `);
  const messageResult = await tx.execute(sql`
    SELECT id FROM messages
    WHERE senderId = ${input.serviceUserId} AND clientMessageId = ${clientMessageId}
    LIMIT 1
  `);
  const messageRows = (messageResult as unknown as [Array<{ id: number }>, unknown])[0];
  const messageId = Number(messageRows[0]?.id ?? 0);
  if (!messageId) throw new Error("51小电邀请卡写入失败");

  const preview = `${input.enterpriseName} 邀请您加入企业ERP`;
  await tx.execute(sql`
    UPDATE conversations
    SET lastMessageAt = NOW(), lastMessagePreview = ${preview}, updatedAt = NOW()
    WHERE id = ${conversationId}
  `);
  await tx.execute(sql`
    UPDATE conversation_user_settings
    SET unreadCount = CASE
          WHEN COALESCE(lastReadMessageId, 0) >= ${messageId} THEN 0
          ELSE GREATEST(unreadCount, 1)
        END,
        deleted = 0,
        updatedAt = NOW()
    WHERE conversationId = ${conversationId} AND userId = ${input.targetUserId}
  `);

  return { conversationId, messageId };
}

export async function createEnterpriseInvitation(input: {
  actorUserId: number;
  phone: string;
  permissionKeys: readonly string[];
  inventoryDataScope?: "own" | "enterprise";
  requestId: string;
}) {
  const actor = await requireEnterprisePermissionManager(input.actorUserId);
  const permissionKeys = normalizePermissionInput(input.permissionKeys);
  const inventoryDataScope = input.inventoryDataScope ?? "own";
  assertGrantSubset(actor, permissionKeys);
  const phone = normalizePhone(input.phone);
  const db = await requireDb();
  const serviceUserId = await getServiceUserId();

  const target = (
    await db
      .select({ id: users.id, name: users.name, username: users.username, phone: users.phone })
      .from(users)
      .where(eq(users.phone, phone))
      .limit(1)
  )[0];
  if (!target || target.id === input.actorUserId || target.id === serviceUserId) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: INVITATION_ERROR });
  }

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [enterpriseRecent, targetRecent] = await Promise.all([
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(enterpriseMemberInvitations)
      .where(
        and(
          eq(enterpriseMemberInvitations.enterpriseId, actor.enterprise.id),
          gt(enterpriseMemberInvitations.createdAt, hourAgo),
        ),
      ),
    db
      .select({ count: sql<number>`COUNT(*)` })
      .from(enterpriseMemberInvitations)
      .where(
        and(
          eq(enterpriseMemberInvitations.targetUserId, target.id),
          gt(enterpriseMemberInvitations.createdAt, dayAgo),
        ),
      ),
  ]);
  if (
    Number(enterpriseRecent[0]?.count ?? 0) >= ENTERPRISE_HOURLY_LIMIT
    || Number(targetRecent[0]?.count ?? 0) >= TARGET_DAILY_LIMIT
  ) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "邀请发送过于频繁，请稍后再试" });
  }

  return db.transaction(async tx => {
    const idempotent = (
      await tx
        .select()
        .from(enterpriseMemberInvitations)
        .where(eq(enterpriseMemberInvitations.requestId, input.requestId))
        .limit(1)
    )[0];
    if (idempotent) {
      if (
        idempotent.enterpriseId !== actor.enterprise.id
        || idempotent.targetUserId !== target.id
        || idempotent.inventoryDataScope !== inventoryDataScope
        || JSON.stringify(normalizePermissionInput(idempotent.permissionKeys ?? [])) !== JSON.stringify(permissionKeys)
      ) {
        throw new TRPCError({ code: "CONFLICT", message: "请求号已用于其他邀请" });
      }
      return {
        success: true,
        idempotent: true,
        invitationId: idempotent.id,
        target: { displayName: maskName(target.name || target.username), phone: maskPhone(phone) },
      } as const;
    }

    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, target.id))
      .limit(1)
      .for("update");

    const existingMember = (
      await tx
        .select()
        .from(enterpriseMembers)
        .where(eq(enterpriseMembers.userId, target.id))
        .limit(1)
        .for("update")
    )[0];
    if (existingMember) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: INVITATION_ERROR });
    }

    const targetCompany = (
      await tx.select().from(companies).where(eq(companies.userId, target.id)).limit(1)
    )[0];
    if (
      targetCompany?.enterpriseId
      || (targetCompany && companyHasEnterpriseIdentity(targetCompany)
        && !companyMatchesEnterpriseIdentity(targetCompany, actor.enterprise))
    ) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: INVITATION_ERROR });
    }

    const existingPending = (
      await tx
        .select()
        .from(enterpriseMemberInvitations)
        .where(
          and(
            eq(enterpriseMemberInvitations.enterpriseId, actor.enterprise.id),
            eq(enterpriseMemberInvitations.targetUserId, target.id),
            eq(enterpriseMemberInvitations.status, "pending"),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (existingPending) {
      throw new TRPCError({ code: "CONFLICT", message: "该用户已有待处理邀请，请撤销后重新发送" });
    }

    const insertResult = await tx.insert(enterpriseMemberInvitations).values({
      enterpriseId: actor.enterprise.id,
      targetUserId: target.id,
      targetPhoneSnapshot: phone,
      invitedByUserId: input.actorUserId,
      permissionKeys,
      inventoryDataScope,
      tokenHash: createTokenHash(),
      requestId: input.requestId,
      expiresAt: sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${INVITATION_TTL_HOURS} HOUR)`,
    });
    const insertHeader = (insertResult as unknown as Array<{ insertId?: number }>)[0];
    const invitationId = Number(insertHeader?.insertId ?? 0);
    if (!invitationId) throw new Error("企业邀请创建失败");

    const storedInvitation = (
      await tx
        .select({ expiresAt: enterpriseMemberInvitations.expiresAt })
        .from(enterpriseMemberInvitations)
        .where(eq(enterpriseMemberInvitations.id, invitationId))
        .limit(1)
    )[0];
    const expiresAt = storedInvitation?.expiresAt instanceof Date
      ? storedInvitation.expiresAt
      : new Date(storedInvitation?.expiresAt as unknown as string);
    const remainingMs = expiresAt.getTime() - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs < INVITATION_TTL_MS - 5 * 60 * 1000) {
      throw new Error("企业邀请有效期写入失败，已回滚");
    }

    const inviter = (
      await tx
        .select({ name: users.name, username: users.username })
        .from(users)
        .where(eq(users.id, input.actorUserId))
        .limit(1)
    )[0];
    const message = await insertInvitationMessage(tx, {
      serviceUserId,
      targetUserId: target.id,
      invitationId,
      enterpriseName: actor.enterprise.companyName,
      inviterName: inviter?.name || inviter?.username || "企业管理员",
      permissionKeys,
      inventoryDataScope,
      expiresAt,
    });
    await tx
      .update(enterpriseMemberInvitations)
      .set(message)
      .where(eq(enterpriseMemberInvitations.id, invitationId));
    await tx.insert(enterprisePermissionAuditLogs).values({
      enterpriseId: actor.enterprise.id,
      actorUserId: input.actorUserId,
      targetUserId: target.id,
      invitationId,
      action: "invite_created",
      afterPermissions: permissionKeys,
      requestId: `${input.requestId}:audit`,
    });

    return {
      success: true,
      idempotent: false,
      invitationId,
      target: { displayName: maskName(target.name || target.username), phone: maskPhone(phone) },
    } as const;
  });
}

export async function listEnterpriseInvitations(actorUserId: number) {
  const actor = await requireEnterprisePermissionManager(actorUserId);
  const db = await requireDb();
  const rows = await db
    .select({
      id: enterpriseMemberInvitations.id,
      targetUserId: enterpriseMemberInvitations.targetUserId,
      targetPhoneSnapshot: enterpriseMemberInvitations.targetPhoneSnapshot,
      permissionKeys: enterpriseMemberInvitations.permissionKeys,
      inventoryDataScope: enterpriseMemberInvitations.inventoryDataScope,
      status: enterpriseMemberInvitations.status,
      expiresAt: enterpriseMemberInvitations.expiresAt,
      createdAt: enterpriseMemberInvitations.createdAt,
      name: users.name,
      username: users.username,
    })
    .from(enterpriseMemberInvitations)
    .innerJoin(users, eq(enterpriseMemberInvitations.targetUserId, users.id))
    .where(eq(enterpriseMemberInvitations.enterpriseId, actor.enterprise.id))
    .orderBy(desc(enterpriseMemberInvitations.createdAt));
  return rows.map(row => ({
    ...row,
    displayName: maskName(row.name || row.username),
    phone: maskPhone(row.targetPhoneSnapshot),
    permissionKeys: normalizeErpPermissions(row.permissionKeys ?? []),
  }));
}

export async function revokeEnterpriseInvitation(input: {
  actorUserId: number;
  invitationId: number;
  requestId: string;
}) {
  const actor = await requireEnterprisePermissionManager(input.actorUserId);
  const db = await requireDb();
  return db.transaction(async tx => {
    const invitation = (
      await tx
        .select()
        .from(enterpriseMemberInvitations)
        .where(
          and(
            eq(enterpriseMemberInvitations.id, input.invitationId),
            eq(enterpriseMemberInvitations.enterpriseId, actor.enterprise.id),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (!invitation) throw new TRPCError({ code: "NOT_FOUND", message: "邀请不存在" });
    if (invitation.status === "revoked") return { success: true, idempotent: true } as const;
    if (invitation.status !== "pending") {
      throw new TRPCError({ code: "CONFLICT", message: "该邀请已处理，不能撤销" });
    }
    await tx
      .update(enterpriseMemberInvitations)
      .set({ status: "revoked", revokedAt: new Date() })
      .where(eq(enterpriseMemberInvitations.id, invitation.id));
    await tx.insert(enterprisePermissionAuditLogs).values({
      enterpriseId: actor.enterprise.id,
      actorUserId: input.actorUserId,
      targetUserId: invitation.targetUserId,
      invitationId: invitation.id,
      action: "invite_revoked",
      beforePermissions: invitation.permissionKeys,
      requestId: input.requestId,
    });
    return { success: true, idempotent: false } as const;
  });
}

export async function listMyEnterpriseInvitations(userId: number) {
  const db = await requireDb();
  const rows = await db
    .select({
      id: enterpriseMemberInvitations.id,
      enterpriseId: enterpriseMemberInvitations.enterpriseId,
      enterpriseName: enterprises.companyName,
      permissionKeys: enterpriseMemberInvitations.permissionKeys,
      inventoryDataScope: enterpriseMemberInvitations.inventoryDataScope,
      status: enterpriseMemberInvitations.status,
      expiresAt: enterpriseMemberInvitations.expiresAt,
      createdAt: enterpriseMemberInvitations.createdAt,
    })
    .from(enterpriseMemberInvitations)
    .innerJoin(enterprises, eq(enterpriseMemberInvitations.enterpriseId, enterprises.id))
    .where(eq(enterpriseMemberInvitations.targetUserId, userId))
    .orderBy(desc(enterpriseMemberInvitations.createdAt));
  return rows.map(row => ({
    ...row,
    permissionKeys: normalizeErpPermissions(row.permissionKeys ?? []),
  }));
}

export async function acceptEnterpriseInvitation(input: {
  userId: number;
  invitationId: number;
  requestId: string;
}) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const invitation = (
      await tx
        .select()
        .from(enterpriseMemberInvitations)
        .where(eq(enterpriseMemberInvitations.id, input.invitationId))
        .limit(1)
        .for("update")
    )[0];
    if (!invitation || invitation.targetUserId !== input.userId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "邀请不存在" });
    }
    if (invitation.status === "accepted") {
      return { success: true, idempotent: true, enterpriseId: invitation.enterpriseId } as const;
    }
    if (invitation.status !== "pending") {
      throw new TRPCError({ code: "CONFLICT", message: "该邀请已失效" });
    }
    const expiresAt = invitation.expiresAt instanceof Date
      ? invitation.expiresAt
      : new Date(invitation.expiresAt as unknown as string);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      await tx
        .update(enterpriseMemberInvitations)
        .set({ status: "expired" })
        .where(eq(enterpriseMemberInvitations.id, invitation.id));
      throw new TRPCError({ code: "CONFLICT", message: "该邀请已过期，请联系企业重新发送" });
    }

    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
      .for("update");

    const existingMembership = (
      await tx
        .select()
        .from(enterpriseMembers)
        .where(eq(enterpriseMembers.userId, input.userId))
        .limit(1)
        .for("update")
    )[0];
    if (existingMembership) {
      throw new TRPCError({
        code: "CONFLICT",
        message: existingMembership.enterpriseId === invitation.enterpriseId
          ? "您已经是该企业成员"
          : "当前账号已加入其他企业",
      });
    }

    const enterprise = (
      await tx.select().from(enterprises).where(eq(enterprises.id, invitation.enterpriseId)).limit(1)
    )[0];
    if (!enterprise) throw new TRPCError({ code: "NOT_FOUND", message: "受邀企业不存在" });

    const permissionKeys = normalizePermissionInput(invitation.permissionKeys ?? []);
    const insertResult = await tx.insert(enterpriseMembers).values({
      enterpriseId: enterprise.id,
      userId: input.userId,
      role: "member",
      status: "active",
      inventoryDataScope: invitation.inventoryDataScope,
      invitedByUserId: invitation.invitedByUserId,
    });
    const insertHeader = (insertResult as unknown as Array<{ insertId?: number }>)[0];
    const memberId = Number(insertHeader?.insertId ?? 0);
    if (!memberId) throw new Error("企业成员创建失败");

    await tx.insert(enterpriseMemberPermissions).values(
      permissionKeys.map(permissionKey => ({
        enterpriseMemberId: memberId,
        permissionKey,
        grantedByUserId: invitation.invitedByUserId,
      })),
    );
    await tx
      .update(companies)
      .set({ enterpriseId: enterprise.id })
      .where(eq(companies.userId, input.userId));
    const owner = (
      await tx
        .select({ crmAccess: users.crmAccess })
        .from(users)
        .where(eq(users.id, enterprise.superAdminUserId))
        .limit(1)
    )[0];
    await tx
      .update(users)
      .set({ crmAccess: owner?.crmAccess ?? false })
      .where(eq(users.id, input.userId));
    await tx
      .update(enterpriseMemberInvitations)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(enterpriseMemberInvitations.id, invitation.id));
    await tx
      .update(enterpriseMemberInvitations)
      .set({ status: "expired" })
      .where(
        and(
          eq(enterpriseMemberInvitations.targetUserId, input.userId),
          eq(enterpriseMemberInvitations.status, "pending"),
          ne(enterpriseMemberInvitations.id, invitation.id),
        ),
      );
    await tx.insert(enterprisePermissionAuditLogs).values({
      enterpriseId: enterprise.id,
      actorUserId: input.userId,
      targetUserId: input.userId,
      invitationId: invitation.id,
      action: "invite_accepted",
      afterPermissions: permissionKeys,
      requestId: input.requestId,
    });

    return { success: true, idempotent: false, enterpriseId: enterprise.id } as const;
  });
}

export async function rejectEnterpriseInvitation(input: {
  userId: number;
  invitationId: number;
  requestId: string;
}) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const invitation = (
      await tx
        .select()
        .from(enterpriseMemberInvitations)
        .where(eq(enterpriseMemberInvitations.id, input.invitationId))
        .limit(1)
        .for("update")
    )[0];
    if (!invitation || invitation.targetUserId !== input.userId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "邀请不存在" });
    }
    if (invitation.status === "rejected") return { success: true, idempotent: true } as const;
    if (invitation.status !== "pending") {
      throw new TRPCError({ code: "CONFLICT", message: "该邀请已处理" });
    }
    await tx
      .update(enterpriseMemberInvitations)
      .set({ status: "rejected", rejectedAt: new Date() })
      .where(eq(enterpriseMemberInvitations.id, invitation.id));
    await tx.insert(enterprisePermissionAuditLogs).values({
      enterpriseId: invitation.enterpriseId,
      actorUserId: input.userId,
      targetUserId: input.userId,
      invitationId: invitation.id,
      action: "invite_rejected",
      beforePermissions: invitation.permissionKeys,
      requestId: input.requestId,
    });
    return { success: true, idempotent: false } as const;
  });
}

export async function listEnterpriseMembersWithPermissions(actorUserId: number) {
  const actor = await requireEnterprisePermissionManager(actorUserId);
  const db = await requireDb();
  const rows = await db
    .select({
      memberId: enterpriseMembers.id,
      userId: enterpriseMembers.userId,
      role: enterpriseMembers.role,
      status: enterpriseMembers.status,
      inventoryDataScope: enterpriseMembers.inventoryDataScope,
      permissionVersion: enterpriseMembers.permissionVersion,
      joinedAt: enterpriseMembers.joinedAt,
      suspendedAt: enterpriseMembers.suspendedAt,
      name: users.name,
      username: users.username,
      phone: users.phone,
      avatarUrl: users.avatarUrl,
    })
    .from(enterpriseMembers)
    .innerJoin(users, eq(enterpriseMembers.userId, users.id))
    .where(eq(enterpriseMembers.enterpriseId, actor.enterprise.id))
    .orderBy(desc(enterpriseMembers.joinedAt));
  const permissions = await listPermissionKeysByMemberIds(rows.map(row => row.memberId));
  return {
    enterprise: actor.enterprise,
    actor: {
      isOwner: actor.isOwner,
      permissionKeys: actor.permissionKeys,
    },
    members: rows.map(row => ({
      ...row,
      isOwner: row.role === "super_admin" || row.userId === actor.enterprise.superAdminUserId,
      displayName: row.name || row.username || `用户${row.userId}`,
      phone: row.phone ? maskPhone(row.phone) : "未绑定",
      permissionKeys:
        row.role === "super_admin" || row.userId === actor.enterprise.superAdminUserId
          ? normalizeErpPermissions(Object.keys(ERP_PERMISSION_DEFINITIONS))
          : permissions.get(row.memberId) ?? [],
    })),
  };
}

export async function setEnterpriseMemberStatusV2(input: {
  actorUserId: number;
  targetUserId: number;
  status: "active" | "suspended";
  requestId: string;
}) {
  const actor = await requireEnterprisePermissionManager(input.actorUserId);
  if (input.targetUserId === input.actorUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能修改自己的企业成员状态" });
  }
  const db = await requireDb();
  return db.transaction(async tx => {
    const target = (
      await tx
        .select()
        .from(enterpriseMembers)
        .where(
          and(
            eq(enterpriseMembers.enterpriseId, actor.enterprise.id),
            eq(enterpriseMembers.userId, input.targetUserId),
          ),
        )
        .limit(1)
        .for("update")
    )[0];
    if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "企业成员不存在" });
    if (target.role === "super_admin" || target.userId === actor.enterprise.superAdminUserId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "企业所有者不能暂停或移除" });
    }
    if (target.status === input.status) return { success: true, idempotent: true } as const;

    await tx
      .update(enterpriseMembers)
      .set({
        status: input.status,
        suspendedAt: input.status === "suspended" ? new Date() : null,
        permissionVersion: sql`${enterpriseMembers.permissionVersion} + 1`,
      })
      .where(eq(enterpriseMembers.id, target.id));
    if (input.status === "suspended") {
      await tx.update(users).set({ crmAccess: false }).where(eq(users.id, target.userId));
    } else {
      const owner = (
        await tx
          .select({ crmAccess: users.crmAccess })
          .from(users)
          .where(eq(users.id, actor.enterprise.superAdminUserId))
          .limit(1)
      )[0];
      await tx
        .update(users)
        .set({ crmAccess: owner?.crmAccess ?? false })
        .where(eq(users.id, target.userId));
    }
    await tx.insert(enterprisePermissionAuditLogs).values({
      enterpriseId: actor.enterprise.id,
      actorUserId: input.actorUserId,
      targetUserId: target.userId,
      action: input.status === "suspended" ? "member_suspended" : "member_activated",
      requestId: input.requestId,
    });
    return { success: true, idempotent: false } as const;
  });
}
