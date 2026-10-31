import { and, eq, inArray, sql } from "drizzle-orm";
import {
  companies,
  enterpriseMembers,
  enterprises,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { getPublicCompanyProfile } from "./companyPublicProfile";
import { getServiceUserId } from "./customerService";

export type CompanyLikeNotificationInput = {
  likeId: number;
  likerUserId: number;
  likedSupplierId: number;
  likedAt?: Date;
};

export type CompanyLikeNotificationCard = {
  version: 1;
  actorLabel: string;
  actorCompanyName: string | null;
  actorCompanySupplierId: number | null;
  targetCompanyName: string;
  likedAt: string;
};

type NotificationContext = {
  input: Required<CompanyLikeNotificationInput>;
  card: CompanyLikeNotificationCard;
  recipientUserIds: number[];
};

type NoticeDelivery = (context: NotificationContext, recipientUserId: number) => Promise<void>;

function accountLabel(user: { id: number; name: string | null; username: string | null }) {
  return user.name?.trim() || user.username?.trim() || `用户${user.id}`;
}

export function createCompanyLikeNotificationClientMessageId(likeId: number, recipientUserId: number) {
  return `company-like-${likeId}-${recipientUserId}`;
}

export function companyLikeNotificationContent(card: CompanyLikeNotificationCard) {
  return JSON.stringify(card);
}

async function findPublicActorCompany(likerUserId: number) {
  const direct = await getPublicCompanyProfile(likerUserId);
  if (direct) {
    return {
      supplierId: direct.basicInfo.supplierId,
      companyName: direct.basicInfo.companyName,
    };
  }

  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const candidates = await db
    .select({ supplierId: companies.userId })
    .from(enterpriseMembers)
    .innerJoin(companies, eq(companies.enterpriseId, enterpriseMembers.enterpriseId))
    .where(and(
      eq(enterpriseMembers.userId, likerUserId),
      eq(enterpriseMembers.status, "active"),
    ))
    .limit(3);

  for (const candidate of candidates) {
    const profile = await getPublicCompanyProfile(candidate.supplierId);
    if (profile) {
      return {
        supplierId: profile.basicInfo.supplierId,
        companyName: profile.basicInfo.companyName,
      };
    }
  }
  return null;
}

async function resolveNotificationContext(
  input: CompanyLikeNotificationInput,
): Promise<NotificationContext | null> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const likedAt = input.likedAt ?? new Date();

  const [targetCompany, liker, actorCompany] = await Promise.all([
    db
      .select({
        companyName: companies.companyName,
        enterpriseId: companies.enterpriseId,
      })
      .from(companies)
      .where(eq(companies.userId, input.likedSupplierId))
      .limit(1)
      .then(rows => rows[0] ?? null),
    db
      .select({ id: users.id, name: users.name, username: users.username })
      .from(users)
      .where(eq(users.id, input.likerUserId))
      .limit(1)
      .then(rows => rows[0] ?? null),
    findPublicActorCompany(input.likerUserId),
  ]);
  if (!targetCompany?.companyName?.trim() || !liker) return null;

  /* 自己或本企业成员给本企业点赞时不发系统提醒，避免企业内部操作制造噪声。 */
  if (actorCompany?.supplierId === input.likedSupplierId) return null;

  const recipientIds = new Set<number>();
  if (targetCompany.enterpriseId) {
    const [adminMembers, enterprise] = await Promise.all([
      db
        .select({ userId: enterpriseMembers.userId })
        .from(enterpriseMembers)
        .where(and(
          eq(enterpriseMembers.enterpriseId, targetCompany.enterpriseId),
          eq(enterpriseMembers.status, "active"),
          inArray(enterpriseMembers.role, ["super_admin", "admin"]),
        )),
      db
        .select({ superAdminUserId: enterprises.superAdminUserId })
        .from(enterprises)
        .where(eq(enterprises.id, targetCompany.enterpriseId))
        .limit(1)
        .then(rows => rows[0] ?? null),
    ]);
    for (const member of adminMembers) recipientIds.add(Number(member.userId));
    if (enterprise?.superAdminUserId) recipientIds.add(Number(enterprise.superAdminUserId));
  }
  /* 兼容尚未链接统一企业的历史公司账号。 */
  if (recipientIds.size === 0) recipientIds.add(input.likedSupplierId);

  const serviceUserId = await getServiceUserId();
  recipientIds.delete(input.likerUserId);
  recipientIds.delete(serviceUserId);
  if (recipientIds.size === 0) return null;

  return {
    input: {
      ...input,
      likedAt,
    },
    card: {
      version: 1,
      actorLabel: actorCompany?.companyName || accountLabel(liker),
      actorCompanyName: actorCompany?.companyName || null,
      actorCompanySupplierId: actorCompany?.supplierId || null,
      targetCompanyName: targetCompany.companyName.trim(),
      likedAt: likedAt.toISOString(),
    },
    recipientUserIds: Array.from(recipientIds),
  };
}

async function writeCompanyLikeNotice(context: NotificationContext, recipientUserId: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const serviceUserId = await getServiceUserId();
  if (recipientUserId === serviceUserId) return;

  const user1Id = Math.min(serviceUserId, recipientUserId);
  const user2Id = Math.max(serviceUserId, recipientUserId);
  const clientMessageId = createCompanyLikeNotificationClientMessageId(
    context.input.likeId,
    recipientUserId,
  );
  const content = companyLikeNotificationContent(context.card);
  const preview = `${context.card.actorLabel}赞了您的公司主页`.slice(0, 200);

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
        SELECT id FROM conversations
        WHERE user1Id = ${user1Id} AND user2Id = ${user2Id}
        LIMIT 1
      `);
      const existingRows = (existingResult as unknown as [Array<{ id: number }>, unknown])[0];
      conversationId = Number(existingRows[0]?.id ?? 0);
    }
    if (!conversationId) throw new Error("公司点赞通知会话创建失败");

    await tx.execute(sql`
      INSERT INTO conversation_user_settings (conversationId, userId)
      VALUES (${conversationId}, ${serviceUserId}), (${conversationId}, ${recipientUserId})
      ON DUPLICATE KEY UPDATE conversationId = conversationId
    `);

    const insertResult = await tx.execute(sql`
      INSERT IGNORE INTO messages (conversationId, senderId, clientMessageId, msgType, content)
      VALUES (${conversationId}, ${serviceUserId}, ${clientMessageId}, 'company_like', ${content})
    `);
    const messageWasCreated = Number(
      (insertResult as unknown as [{ affectedRows?: number }, unknown])[0]?.affectedRows ?? 0,
    ) === 1;
    if (!messageWasCreated) return;

    const messageResult = await tx.execute(sql`
      SELECT id FROM messages
      WHERE senderId = ${serviceUserId} AND clientMessageId = ${clientMessageId}
      LIMIT 1
    `);
    const messageRows = (messageResult as unknown as [Array<{ id: number }>, unknown])[0];
    const messageId = Number(messageRows[0]?.id ?? 0);
    if (!messageId) throw new Error("公司点赞通知写入失败");

    await tx.execute(sql`
      UPDATE conversations
      SET lastMessageAt = NOW(), lastMessagePreview = ${preview}, updatedAt = NOW()
      WHERE id = ${conversationId}
    `);
    await tx.execute(sql`
      UPDATE conversation_user_settings
      SET unreadCount = CASE WHEN deleted = 1 THEN 1 ELSE unreadCount + 1 END,
          deleted = 0,
          updatedAt = NOW()
      WHERE conversationId = ${conversationId} AND userId = ${recipientUserId}
    `);
  });
}

/**
 * 点赞已经成功后再投递提醒。任何单个管理员的通知失败都不会回滚点赞，
 * clientMessageId 由 likeId + recipientId 唯一确定，重试也不会重复发消息。
 */
export async function notifyCompanyLikeAdministrators(
  input: CompanyLikeNotificationInput,
  options: { deliver?: NoticeDelivery } = {},
) {
  const context = await resolveNotificationContext(input);
  if (!context) return [];
  const deliver = options.deliver ?? writeCompanyLikeNotice;
  return Promise.all(context.recipientUserIds.map(async recipientUserId => {
    try {
      await deliver(context, recipientUserId);
      return { recipientUserId, delivered: true as const };
    } catch (error) {
      console.warn("[companyLike] 51小电通知写入失败", {
        likeId: input.likeId,
        likedSupplierId: input.likedSupplierId,
        recipientUserId,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      return { recipientUserId, delivered: false as const };
    }
  }));
}
