import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getServiceUserId } from "./customerService";

export const ERP_COFFEE_CAMPAIGN_CODE = "erp-launch-luckin-2026-08";
export const COFFEE_COUPON_MESSAGE_TYPE = "coffee_coupon";

type AwardResult =
  | { status: "awarded"; assignmentId: number; voucherId: number; messageId: number }
  | { status: "already_awarded"; assignmentId: number }
  | {
      status:
        | "campaign_inactive"
        | "user_ineligible"
        | "company_ineligible"
        | "erp_inactive"
        | "sold_out";
    };

type CampaignRow = {
  id: number;
  status: "draft" | "active" | "paused" | "exhausted" | "ended";
  startsAt: Date | string | null;
  endsAt: Date | string | null;
};

type EligibilityRow = {
  userId: number;
  role: string;
  userCreatedAt: Date | string;
  crmAccess: number;
  companyId: number | null;
  companyName: string | null;
  creditCode: string | null;
  reviewStatus: string | null;
};

type ExistingAssignmentRow = { id: number };
type VoucherRow = { id: number; assetKey: string };
type ConversationRow = { id: number };
type IdRow = { id: number };
type CountRow = { cnt: number | string };

function asRows<T>(value: unknown): T[] {
  return (value as [T[], unknown])[0] ?? [];
}

function normalizeEnterpriseKey(creditCode: string): string {
  return `credit:${creditCode.replace(/\s+/g, "").toUpperCase()}`;
}

function asTime(value: Date | string | null): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value).replace(" ", "T") + "+08:00");
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * ERP 正式启用后的幂等赠券入口。
 *
 * 调用方只传 userId；活动、注册时间、企业审核、信用代码与 CRM 权限全部在事务内复核。
 * 任何业务跳过都不创建会话、不占券；数据库异常向上抛出，由调用方记录但不得阻断 ERP 开通。
 */
export async function awardCoffeeVoucherAfterErpActivation(userId: number): Promise<AwardResult> {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const serviceUserId = await getServiceUserId();

  return db.transaction(async tx => {
    const campaignResult = await tx.execute(sql`
      SELECT id, status, startsAt, endsAt
        FROM coffee_voucher_campaigns
       WHERE code = ${ERP_COFFEE_CAMPAIGN_CODE}
       LIMIT 1
       FOR UPDATE
    `);
    const campaign = asRows<CampaignRow>(campaignResult)[0];
    if (!campaign?.startsAt) return { status: "campaign_inactive" } as const;

    const eligibilityResult = await tx.execute(sql`
      SELECT
        u.id AS userId,
        u.role,
        u.createdAt AS userCreatedAt,
        u.crmAccess,
        c.id AS companyId,
        c.companyName,
        c.creditCode,
        c.reviewStatus
      FROM users u
      LEFT JOIN companies c ON c.userId = u.id
      WHERE u.id = ${userId}
      LIMIT 1
      FOR UPDATE
    `);
    const eligibility = asRows<EligibilityRow>(eligibilityResult)[0];
    if (!eligibility || eligibility.role !== "user") return { status: "user_ineligible" } as const;

    if (
      !eligibility.companyId ||
      eligibility.reviewStatus !== "approved" ||
      !eligibility.creditCode?.trim()
    ) {
      return { status: "company_ineligible" } as const;
    }

    const enterpriseKey = normalizeEnterpriseKey(eligibility.creditCode);
    const existingResult = await tx.execute(sql`
      SELECT id
        FROM coffee_voucher_assignments
       WHERE campaignId = ${campaign.id}
         AND (enterpriseKey = ${enterpriseKey} OR userId = ${userId})
       LIMIT 1
       FOR UPDATE
    `);
    const existing = asRows<ExistingAssignmentRow>(existingResult)[0];
    if (existing) return { status: "already_awarded", assignmentId: Number(existing.id) } as const;

    const startsAt = asTime(campaign.startsAt);
    const endsAt = asTime(campaign.endsAt);
    const registeredAt = asTime(eligibility.userCreatedAt);
    const now = Date.now();
    if (startsAt === null || registeredAt === null || registeredAt < startsAt || (endsAt && now >= endsAt)) {
      return { status: "user_ineligible" } as const;
    }
    if (!eligibility.crmAccess) return { status: "erp_inactive" } as const;
    if (campaign.status === "exhausted") return { status: "sold_out" } as const;
    if (campaign.status !== "active") return { status: "campaign_inactive" } as const;

    const voucherResult = await tx.execute(sql`
      SELECT id, assetKey
        FROM coffee_vouchers
       WHERE campaignId = ${campaign.id}
         AND status = 'available'
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE
    `);
    const voucher = asRows<VoucherRow>(voucherResult)[0];
    if (!voucher) {
      await tx.execute(sql`
        UPDATE coffee_voucher_campaigns
           SET status = 'exhausted', updatedAt = NOW()
         WHERE id = ${campaign.id} AND status = 'active'
      `);
      return { status: "sold_out" } as const;
    }

    await tx.execute(sql`
      INSERT INTO coffee_voucher_assignments (
        campaignId,
        voucherId,
        userId,
        companyId,
        enterpriseKey,
        notificationStatus,
        erpActivatedAt
      ) VALUES (
        ${campaign.id},
        ${voucher.id},
        ${userId},
        ${eligibility.companyId},
        ${enterpriseKey},
        'pending',
        NOW()
      )
    `);
    const assignmentIdResult = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
    const assignmentId = Number(asRows<IdRow>(assignmentIdResult)[0]?.id);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      throw new Error("coffee voucher assignment id unavailable");
    }

    const user1Id = Math.min(userId, serviceUserId);
    const user2Id = Math.max(userId, serviceUserId);
    const conversationResult = await tx.execute(sql`
      SELECT id
        FROM conversations
       WHERE user1Id = ${user1Id} AND user2Id = ${user2Id}
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE
    `);
    let conversationId = Number(asRows<ConversationRow>(conversationResult)[0]?.id ?? 0);
    if (!conversationId) {
      await tx.execute(sql`
        INSERT INTO conversations (user1Id, user2Id, lastMessageAt, lastMessagePreview)
        VALUES (${user1Id}, ${user2Id}, NOW(), '')
      `);
      const conversationIdResult = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
      conversationId = Number(asRows<IdRow>(conversationIdResult)[0]?.id);
    }
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new Error("coffee voucher conversation id unavailable");
    }

    await tx.execute(sql`
      INSERT INTO conversation_user_settings (
        conversationId, userId, pinned, groupName, unreadCount, deleted, lastReadAt, createdAt, updatedAt
      )
      SELECT ${conversationId}, ${userId}, 0, NULL, 0, 0, NOW(), NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM conversation_user_settings
         WHERE conversationId = ${conversationId} AND userId = ${userId}
      )
    `);
    await tx.execute(sql`
      INSERT INTO conversation_user_settings (
        conversationId, userId, pinned, groupName, unreadCount, deleted, lastReadAt, createdAt, updatedAt
      )
      SELECT ${conversationId}, ${serviceUserId}, 0, NULL, 0, 0, NOW(), NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM conversation_user_settings
         WHERE conversationId = ${conversationId} AND userId = ${serviceUserId}
      )
    `);

    const messageContent = JSON.stringify({
      assignmentId,
      title: "ERP开通礼｜瑞幸咖啡券",
      text: "恭喜您成功开通51电子网ERP，赠送瑞幸咖啡券1张。点击海报可放大扫码，每个企业限领1张。",
      imagePath: `/api/coffee-vouchers/${assignmentId}/image`,
      tips: ["51小电专属发放", "点击海报放大扫码", "每个企业限领1张"],
    });
    const clientMessageId = `coffee-voucher-${assignmentId}`;
    await tx.execute(sql`
      INSERT INTO messages (conversationId, senderId, clientMessageId, msgType, content)
      VALUES (
        ${conversationId},
        ${serviceUserId},
        ${clientMessageId},
        ${COFFEE_COUPON_MESSAGE_TYPE},
        ${messageContent}
      )
    `);
    const messageIdResult = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
    const messageId = Number(asRows<IdRow>(messageIdResult)[0]?.id);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      throw new Error("coffee voucher message id unavailable");
    }

    const preview = "[咖啡券] ERP开通礼已到账";
    await tx.execute(sql`
      UPDATE conversations
         SET lastMessageAt = NOW(), lastMessagePreview = ${preview}, updatedAt = NOW()
       WHERE id = ${conversationId}
    `);
    await tx.execute(sql`
      UPDATE conversation_user_settings
         SET unreadCount = unreadCount + 1, deleted = 0, updatedAt = NOW()
       WHERE conversationId = ${conversationId} AND userId = ${userId}
    `);
    await tx.execute(sql`
      UPDATE coffee_vouchers
         SET status = 'assigned', assignedAt = NOW(), updatedAt = NOW()
       WHERE id = ${voucher.id} AND status = 'available'
    `);
    await tx.execute(sql`
      UPDATE coffee_voucher_assignments
         SET notificationStatus = 'sent', messageId = ${messageId}, notifiedAt = NOW(), updatedAt = NOW()
       WHERE id = ${assignmentId}
    `);

    const remainingResult = await tx.execute(sql`
      SELECT COUNT(*) AS cnt
        FROM coffee_vouchers
       WHERE campaignId = ${campaign.id} AND status = 'available'
    `);
    const remaining = Number(asRows<CountRow>(remainingResult)[0]?.cnt ?? 0);
    if (remaining === 0) {
      await tx.execute(sql`
        UPDATE coffee_voucher_campaigns
           SET status = 'exhausted', updatedAt = NOW()
         WHERE id = ${campaign.id} AND status = 'active'
      `);
    }

    return {
      status: "awarded",
      assignmentId,
      voucherId: Number(voucher.id),
      messageId,
    } as const;
  });
}

/** ERP 开通路径调用的容错包装：赠券失败不得回滚已成功的 ERP 权限变更。 */
export async function triggerCoffeeVoucherAward(userId: number): Promise<void> {
  try {
    const result = await awardCoffeeVoucherAfterErpActivation(userId);
    if (result.status === "awarded") {
      console.info("[coffeeVoucher] awarded", {
        userId,
        assignmentId: result.assignmentId,
        voucherId: result.voucherId,
        messageId: result.messageId,
      });
    }
  } catch (error) {
    console.error("[coffeeVoucher] award failed", {
      userId,
      errorType: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "unknown",
    });
  }
}


type AssignmentNotificationRow = {
  id: number;
  userId: number;
  notificationStatus: string;
};
type MessageIdRow = { id: number };

/**
 * 管理员重试失败/待发送的咖啡券通知。
 * assignment 行锁和 senderId + clientMessageId 唯一键共同保证并发点击不会重复推送。
 */
export async function resendCoffeeVoucherNotification(assignmentId: number): Promise<{
  status: "sent" | "already_sent" | "not_found";
  messageId?: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("database not available");
  const serviceUserId = await getServiceUserId();

  return db.transaction(async tx => {
    const assignmentResult = await tx.execute(sql`
      SELECT id, userId, notificationStatus
        FROM coffee_voucher_assignments
       WHERE id = ${assignmentId}
       LIMIT 1
       FOR UPDATE
    `);
    const assignment = asRows<AssignmentNotificationRow>(assignmentResult)[0];
    if (!assignment) return { status: "not_found" } as const;
    if (assignment.notificationStatus === "sent") return { status: "already_sent" } as const;

    const userId = Number(assignment.userId);
    const user1Id = Math.min(userId, serviceUserId);
    const user2Id = Math.max(userId, serviceUserId);
    const conversationResult = await tx.execute(sql`
      SELECT id
        FROM conversations
       WHERE user1Id = ${user1Id} AND user2Id = ${user2Id}
       ORDER BY id ASC
       LIMIT 1
       FOR UPDATE
    `);
    let conversationId = Number(asRows<ConversationRow>(conversationResult)[0]?.id ?? 0);
    if (!conversationId) {
      await tx.execute(sql`
        INSERT INTO conversations (user1Id, user2Id, lastMessageAt, lastMessagePreview)
        VALUES (${user1Id}, ${user2Id}, NOW(), '')
      `);
      const conversationIdResult = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
      conversationId = Number(asRows<IdRow>(conversationIdResult)[0]?.id);
    }

    await tx.execute(sql`
      INSERT INTO conversation_user_settings (
        conversationId, userId, pinned, groupName, unreadCount, deleted, lastReadAt, createdAt, updatedAt
      )
      SELECT ${conversationId}, ${userId}, 0, NULL, 0, 0, NOW(), NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM conversation_user_settings
         WHERE conversationId = ${conversationId} AND userId = ${userId}
      )
    `);
    await tx.execute(sql`
      INSERT INTO conversation_user_settings (
        conversationId, userId, pinned, groupName, unreadCount, deleted, lastReadAt, createdAt, updatedAt
      )
      SELECT ${conversationId}, ${serviceUserId}, 0, NULL, 0, 0, NOW(), NOW(), NOW()
      WHERE NOT EXISTS (
        SELECT 1 FROM conversation_user_settings
         WHERE conversationId = ${conversationId} AND userId = ${serviceUserId}
      )
    `);

    const clientMessageId = `coffee-voucher-${assignmentId}`;
    const existingMessageResult = await tx.execute(sql`
      SELECT id
        FROM messages
       WHERE senderId = ${serviceUserId} AND clientMessageId = ${clientMessageId}
       LIMIT 1
    `);
    let messageId = Number(asRows<MessageIdRow>(existingMessageResult)[0]?.id ?? 0);
    const insertedNewMessage = !messageId;
    if (!messageId) {
      const messageContent = JSON.stringify({
        assignmentId,
        title: "ERP开通礼｜瑞幸咖啡券",
        text: "恭喜您成功开通51电子网ERP，赠送瑞幸咖啡券1张。点击海报可放大扫码，每个企业限领1张。",
        imagePath: `/api/coffee-vouchers/${assignmentId}/image`,
        tips: ["51小电专属发放", "点击海报放大扫码", "每个企业限领1张"],
      });
      await tx.execute(sql`
        INSERT INTO messages (conversationId, senderId, clientMessageId, msgType, content)
        VALUES (
          ${conversationId},
          ${serviceUserId},
          ${clientMessageId},
          ${COFFEE_COUPON_MESSAGE_TYPE},
          ${messageContent}
        )
      `);
      const messageIdResult = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
      messageId = Number(asRows<IdRow>(messageIdResult)[0]?.id);
    }
    if (!messageId) throw new Error("coffee voucher retry message id unavailable");

    const preview = "[咖啡券] ERP开通礼已到账";
    await tx.execute(sql`
      UPDATE conversations
         SET lastMessageAt = NOW(), lastMessagePreview = ${preview}, updatedAt = NOW()
       WHERE id = ${conversationId}
    `);
    if (insertedNewMessage) {
      await tx.execute(sql`
        UPDATE conversation_user_settings
           SET unreadCount = unreadCount + 1, deleted = 0, updatedAt = NOW()
         WHERE conversationId = ${conversationId} AND userId = ${userId}
      `);
    }
    await tx.execute(sql`
      UPDATE coffee_voucher_assignments
         SET notificationStatus = 'sent',
             messageId = ${messageId},
             notifiedAt = COALESCE(notifiedAt, NOW()),
             lastError = NULL,
             updatedAt = NOW()
       WHERE id = ${assignmentId}
    `);

    return { status: "sent", messageId } as const;
  });
}
