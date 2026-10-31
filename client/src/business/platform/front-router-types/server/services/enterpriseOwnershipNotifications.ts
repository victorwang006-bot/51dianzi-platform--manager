import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getServiceUserId } from "./customerService";

export type OwnershipTransferNotificationInput = {
  enterpriseId: number;
  enterpriseName: string;
  previousOwnerUserId: number;
  nextOwnerUserId: number;
  reason: string;
  requestId: string;
  completedAt: Date;
};

type RecipientNotice = OwnershipTransferNotificationInput & {
  recipientUserId: number;
};

type NoticeDelivery = (notice: RecipientNotice) => Promise<void>;

function accountLabel(user: { name: string | null; username: string | null; id: number }) {
  return user.name?.trim() || user.username?.trim() || `用户${user.id}`;
}

function beijingTime(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(value).replace(/\//g, "-");
}

/** requestId + recipientId have a stable, opaque mapping within messages.clientMessageId's 64-char limit. */
export function createOwnershipTransferNotificationClientMessageId(requestId: string, recipientUserId: number) {
  const digest = createHash("sha256")
    .update(`enterprise-owner-transfer:${requestId}:${recipientUserId}`)
    .digest("hex");
  return `owner-transfer-${digest.slice(0, 40)}`;
}

export function ownershipTransferNotificationContent(input: {
  enterpriseName: string;
  previousOwnerAccount: string;
  nextOwnerAccount: string;
  reason: string;
  completedAt: Date;
}) {
  return [
    "51小电提醒：企业所有者转让已完成。",
    `企业：${input.enterpriseName}`,
    `原所有者账号：${input.previousOwnerAccount}`,
    `新所有者账号：${input.nextOwnerAccount}`,
    `完成时间（北京时间）：${beijingTime(input.completedAt)}`,
    `转让原因：${input.reason}`,
  ].join("\n");
}

async function writeOwnershipTransferNotice(notice: RecipientNotice) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const serviceUserId = await getServiceUserId();
  if (notice.recipientUserId === serviceUserId) return;

  const [previousOwnerResult, nextOwnerResult] = await Promise.all([
    db.execute(sql`
      SELECT id, name, username FROM users WHERE id = ${notice.previousOwnerUserId} LIMIT 1
    `),
    db.execute(sql`
      SELECT id, name, username FROM users WHERE id = ${notice.nextOwnerUserId} LIMIT 1
    `),
  ]);
  const previousOwnerRows = (previousOwnerResult as unknown as [Array<{ id: number; name: string | null; username: string | null }>, unknown])[0];
  const nextOwnerRows = (nextOwnerResult as unknown as [Array<{ id: number; name: string | null; username: string | null }>, unknown])[0];
  const previousOwner = previousOwnerRows[0];
  const nextOwner = nextOwnerRows[0];
  if (!previousOwner || !nextOwner) throw new Error("企业所有者通知账号不存在");

  const content = ownershipTransferNotificationContent({
    enterpriseName: notice.enterpriseName,
    previousOwnerAccount: accountLabel(previousOwner),
    nextOwnerAccount: accountLabel(nextOwner),
    reason: notice.reason,
    completedAt: notice.completedAt,
  });
  const clientMessageId = createOwnershipTransferNotificationClientMessageId(
    notice.requestId,
    notice.recipientUserId,
  );
  const user1Id = Math.min(serviceUserId, notice.recipientUserId);
  const user2Id = Math.max(serviceUserId, notice.recipientUserId);
  const preview = "企业所有者转让已完成";

  await db.transaction(async tx => {
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
        SELECT id FROM conversations WHERE user1Id = ${user1Id} AND user2Id = ${user2Id} LIMIT 1
      `);
      const existingRows = (existingResult as unknown as [Array<{ id: number }>, unknown])[0];
      conversationId = Number(existingRows[0]?.id ?? 0);
    }
    if (!conversationId) throw new Error("企业所有者通知会话创建失败");

    const insertResult = await tx.execute(sql`
      INSERT IGNORE INTO messages (conversationId, senderId, clientMessageId, msgType, content)
      VALUES (${conversationId}, ${serviceUserId}, ${clientMessageId}, 'text', ${content})
    `);
    const messageWasCreated = Number(
      (insertResult as unknown as [{ affectedRows?: number }, unknown])[0]?.affectedRows ?? 0,
    ) === 1;
    const messageResult = await tx.execute(sql`
      SELECT id FROM messages
      WHERE senderId = ${serviceUserId} AND clientMessageId = ${clientMessageId}
      LIMIT 1
    `);
    const messageRows = (messageResult as unknown as [Array<{ id: number }>, unknown])[0];
    const messageId = Number(messageRows[0]?.id ?? 0);
    if (!messageId) throw new Error("企业所有者通知写入失败");
    if (!messageWasCreated) return;

    for (const userId of [serviceUserId, notice.recipientUserId]) {
      await tx.execute(sql`
        INSERT INTO conversation_user_settings (conversationId, userId)
        VALUES (${conversationId}, ${userId})
        ON DUPLICATE KEY UPDATE deleted = 0
      `);
    }

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
      WHERE conversationId = ${conversationId} AND userId = ${notice.recipientUserId}
    `);
  });
}

/**
 * Delivery is deliberately post-commit and per-recipient. A failed 51小电
 * notification is recorded safely and never rolls back an already completed transfer.
 */
export async function notifyEnterpriseOwnershipTransferRecipients(
  input: OwnershipTransferNotificationInput,
  options: { deliver?: NoticeDelivery } = {},
) {
  const deliver = options.deliver ?? writeOwnershipTransferNotice;
  const recipients = [input.previousOwnerUserId, input.nextOwnerUserId];
  const outcomes = await Promise.all(recipients.map(async recipientUserId => {
    try {
      await deliver({ ...input, recipientUserId });
      return { recipientUserId, delivered: true as const };
    } catch (error) {
      // Do not include phone numbers, verification tickets, codes, or free-form reason in logs.
      console.warn("[enterpriseOwnershipTransfer] 51小电通知写入失败", {
        enterpriseId: input.enterpriseId,
        recipientUserId,
        requestId: input.requestId,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      return { recipientUserId, delivered: false as const };
    }
  }));
  return outcomes;
}
