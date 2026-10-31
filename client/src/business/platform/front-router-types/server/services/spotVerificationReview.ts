import { and, desc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  enterprises,
  inventorySpotVerificationReviews,
  inventorySpotVerifications,
} from "../../drizzle/schema";
import { createHash } from "node:crypto";
import { createSpotInventoryVerification, getDb, listSpotVerificationInventories } from "../db";
import { SPOT_VERIFICATION_VALID_DAYS, selectSpotInventoryMatch } from "../../../shared/spotInventoryVerification";
import { storageGetAccessUrl } from "../storage";
import { getServiceUserId } from "./customerService";
import type { SpotMarkingSource } from "./materialLabelOcr";

export const SPOT_VERIFICATION_QUEUE_MESSAGE = "已提交人工核验";
export const SPOT_VERIFICATION_REJECT_NOTICE = (partNumber: string) =>
  `您的现货核验：料号：${partNumber}未通过，请重新上传核验。如有疑问请在此处留言。`;
export const SPOT_VERIFICATION_CANCEL_NOTICE = (partNumber: string) =>
  `您的现货核验：料号：${partNumber}已取消，请重新上传核验。如有疑问请在此处留言。`;

export type SpotVerificationReviewOperator = {
  id: number;
  name: string;
  role: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type SpotVerificationReviewStatus = "pending" | "approved" | "rejected" | "cancelled";

function normalizeCreditCode(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

async function resolveEnterprise(creditCode: string, expectedOwnerUserId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  const enterprise = (
    await db
      .select({
        id: enterprises.id,
        creditCode: enterprises.creditCode,
        crmDataOwnerUserId: enterprises.crmDataOwnerUserId,
        superAdminUserId: enterprises.superAdminUserId,
      })
      .from(enterprises)
      .where(eq(enterprises.creditCode, normalizeCreditCode(creditCode)))
      .limit(1)
  )[0];
  if (!enterprise) throw new TRPCError({ code: "NOT_FOUND", message: "企业不存在" });
  if (enterprise.crmDataOwnerUserId !== expectedOwnerUserId && enterprise.superAdminUserId !== expectedOwnerUserId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "商户企业绑定不匹配" });
  }
  return enterprise;
}

export async function queueSpotVerificationReview(input: {
  enterpriseId: number;
  dataOwnerUserId: number;
  submittedByUserId: number;
  inventoryId?: number | null;
  recognizedPartNumber: string;
  inventoryPartNumber?: string | null;
  markingSource: SpotMarkingSource;
  photoKey: string;
  photoSha256: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  const existing = (
    await db
      .select({
        id: inventorySpotVerificationReviews.id,
        status: inventorySpotVerificationReviews.status,
        requestId: inventorySpotVerificationReviews.requestId,
        photoSha256: inventorySpotVerificationReviews.photoSha256,
        recognizedPartNumber: inventorySpotVerificationReviews.recognizedPartNumber,
      })
      .from(inventorySpotVerificationReviews)
      .where(
        sql`${inventorySpotVerificationReviews.photoSha256} = ${input.photoSha256}
          OR (${inventorySpotVerificationReviews.enterpriseId} = ${input.enterpriseId}
          AND ${inventorySpotVerificationReviews.submittedByUserId} = ${input.submittedByUserId}
          AND ${inventorySpotVerificationReviews.requestId} = ${input.requestId})`,
      )
      .limit(2)
  );
  const requestMatch = existing.find(row => row.requestId === input.requestId);
  if (requestMatch) {
    if (requestMatch.photoSha256 !== input.photoSha256) {
      throw new TRPCError({ code: "CONFLICT", message: "本次核验已失效，请重新拍摄" });
    }
    return { queued: true as const, reviewId: requestMatch.id, partNumber: requestMatch.recognizedPartNumber };
  }
  if (existing[0]) {
    throw new TRPCError({ code: "CONFLICT", message: "这张照片已提交核验，请重新拍摄" });
  }
  const inserted = await db.insert(inventorySpotVerificationReviews).values({
    enterpriseId: input.enterpriseId,
    dataOwnerUserId: input.dataOwnerUserId,
    submittedByUserId: input.submittedByUserId,
    inventoryId: input.inventoryId ?? null,
    recognizedPartNumber: input.recognizedPartNumber,
    inventoryPartNumber: input.inventoryPartNumber ?? null,
    markingSource: input.markingSource,
    photoKey: input.photoKey,
    photoSha256: input.photoSha256,
    requestId: input.requestId,
    status: "pending",
  });
  const reviewId = Number((inserted as { insertId?: number }).insertId || 0);
  return { queued: true as const, reviewId, partNumber: input.recognizedPartNumber };
}

async function sendXiaodianText(recipientUserId: number, clientMessageId: string, content: string) {
  const db = await getDb();
  if (!db) return;
  const serviceUserId = await getServiceUserId();
  if (!serviceUserId || recipientUserId === serviceUserId) return;
  const user1Id = Math.min(serviceUserId, recipientUserId);
  const user2Id = Math.max(serviceUserId, recipientUserId);
  const preview = content.slice(0, 200);
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
    if (!conversationId) throw new Error("51小电会话创建失败");
    await tx.execute(sql`
      INSERT INTO conversation_user_settings (conversationId, userId)
      VALUES (${conversationId}, ${serviceUserId}), (${conversationId}, ${recipientUserId})
      ON DUPLICATE KEY UPDATE conversationId = conversationId
    `);
    const insertResult = await tx.execute(sql`
      INSERT IGNORE INTO messages (conversationId, senderId, clientMessageId, msgType, content)
      VALUES (${conversationId}, ${serviceUserId}, ${clientMessageId}, 'text', ${content})
    `);
    const created = Number((insertResult as unknown as [{ affectedRows?: number }, unknown])[0]?.affectedRows ?? 0) === 1;
    if (!created) return;
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


export async function listEnterpriseSpotVerificationReviews(input: {
  creditCode: string;
  expectedOwnerUserId: number;
  status?: SpotVerificationReviewStatus | "all";
}) {
  const enterprise = await resolveEnterprise(input.creditCode, input.expectedOwnerUserId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  const status = input.status && input.status !== "all" ? input.status : undefined;
  const rows = await db
    .select({
      id: inventorySpotVerificationReviews.id,
      inventoryId: inventorySpotVerificationReviews.inventoryId,
      recognizedPartNumber: inventorySpotVerificationReviews.recognizedPartNumber,
      inventoryPartNumber: inventorySpotVerificationReviews.inventoryPartNumber,
      markingSource: inventorySpotVerificationReviews.markingSource,
      status: inventorySpotVerificationReviews.status,
      photoKey: inventorySpotVerificationReviews.photoKey,
      createdAt: inventorySpotVerificationReviews.createdAt,
      reviewedAt: inventorySpotVerificationReviews.reviewedAt,
      reviewedByAdminName: inventorySpotVerificationReviews.reviewedByAdminName,
      sourceVerificationId: inventorySpotVerificationReviews.sourceVerificationId,
    })
    .from(inventorySpotVerificationReviews)
    .where(
      status
        ? and(
            eq(inventorySpotVerificationReviews.enterpriseId, enterprise.id),
            eq(inventorySpotVerificationReviews.status, status),
          )
        : eq(inventorySpotVerificationReviews.enterpriseId, enterprise.id),
    )
    .orderBy(desc(inventorySpotVerificationReviews.id))
    .limit(100);

  const items = await Promise.all(rows.map(async row => ({
    id: row.id,
    inventoryId: row.inventoryId,
    recognizedPartNumber: row.recognizedPartNumber,
    inventoryPartNumber: row.inventoryPartNumber,
    markingSource: row.markingSource,
    status: row.status,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    reviewedByAdminName: row.reviewedByAdminName,
    sourceVerificationId: row.sourceVerificationId,
    photoUrl: row.photoKey ? await storageGetAccessUrl(row.photoKey, 600).catch(() => null) : null,
  })));
  return { items };
}

export async function listEnterpriseActiveSpotVerifications(input: {
  creditCode: string;
  expectedOwnerUserId: number;
}) {
  const enterprise = await resolveEnterprise(input.creditCode, input.expectedOwnerUserId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  const rows = await db.execute(sql`
    SELECT verification.id AS id,
           verification.inventoryId AS inventoryId,
           verification.inventoryPartNumber AS partNumber,
           verification.recognizedPartNumber AS recognizedPartNumber,
           verification.verifiedAt AS verifiedAt,
           verification.expiresAt AS expiresAt,
           verification.photoKey AS photoKey
      FROM ${inventorySpotVerifications} verification
      INNER JOIN (
        SELECT inventoryId, MAX(id) AS id
          FROM ${inventorySpotVerifications}
         WHERE enterpriseId = ${enterprise.id}
         GROUP BY inventoryId
      ) latest ON latest.id = verification.id
     WHERE verification.expiresAt > NOW()
     ORDER BY verification.id DESC
     LIMIT 100
  `);
  const list = ((rows as unknown as [Array<Record<string, unknown>>, unknown])[0] || []).map(row => ({
    id: Number(row.id),
    inventoryId: Number(row.inventoryId),
    partNumber: String(row.partNumber || ""),
    recognizedPartNumber: String(row.recognizedPartNumber || ""),
    verifiedAt: row.verifiedAt,
    expiresAt: row.expiresAt,
    photoKey: String(row.photoKey || ""),
  }));
  const items = await Promise.all(list.map(async row => ({
    ...row,
    photoUrl: row.photoKey ? await storageGetAccessUrl(row.photoKey, 600).catch(() => null) : null,
  })));
  return { items };
}

async function loadPendingReview(reviewId: number, enterpriseId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  const row = (
    await db
      .select()
      .from(inventorySpotVerificationReviews)
      .where(
        and(
          eq(inventorySpotVerificationReviews.id, reviewId),
          eq(inventorySpotVerificationReviews.enterpriseId, enterpriseId),
        ),
      )
      .limit(1)
  )[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "核验记录不存在" });
  return row;
}

export async function approveSpotVerificationReview(input: {
  creditCode: string;
  expectedOwnerUserId: number;
  reviewId: number;
  operator: SpotVerificationReviewOperator;
}) {
  const enterprise = await resolveEnterprise(input.creditCode, input.expectedOwnerUserId);
  const row = await loadPendingReview(input.reviewId, enterprise.id);
  if (row.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "该核验已处理" });
  const inventoriesInScope = await listSpotVerificationInventories(row.dataOwnerUserId, enterprise.id);
  const match = selectSpotInventoryMatch(
    row.recognizedPartNumber,
    inventoriesInScope.map(item => ({ id: item.id, partNumber: item.partNumber })),
  );
  if (!match) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "未匹配到唯一在售库存，无法通过" });
  }
  const verifiedAt = new Date();
  const expiresAt = new Date(verifiedAt.getTime() + SPOT_VERIFICATION_VALID_DAYS * 24 * 60 * 60 * 1000);
  const created = await createSpotInventoryVerification({
    inventoryId: match.inventoryId,
    dataOwnerUserId: row.dataOwnerUserId,
    enterpriseId: enterprise.id,
    verifiedByUserId: row.submittedByUserId,
    match,
    photo: { key: row.photoKey, sha256: row.photoSha256 },
    requestId: `admin-${row.requestId}`,
    modelName: "admin-review",
    verifiedAt,
    expiresAt,
  });
  if (!created.ok) {
    throw new TRPCError({ code: "CONFLICT", message: "库存状态已变化，请让商家重拍" });
  }
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  await db
    .update(inventorySpotVerificationReviews)
    .set({
      status: "approved",
      inventoryId: match.inventoryId,
      inventoryPartNumber: match.inventoryPartNumber,
      reviewedByAdminId: input.operator.id,
      reviewedByAdminName: input.operator.name.slice(0, 128),
      reviewedAt: new Date(),
    })
    .where(eq(inventorySpotVerificationReviews.id, row.id));
  return { success: true as const, partNumber: match.inventoryPartNumber };
}

export async function rejectSpotVerificationReview(input: {
  creditCode: string;
  expectedOwnerUserId: number;
  reviewId: number;
  operator: SpotVerificationReviewOperator;
}) {
  const enterprise = await resolveEnterprise(input.creditCode, input.expectedOwnerUserId);
  const row = await loadPendingReview(input.reviewId, enterprise.id);
  if (row.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "该核验已处理" });
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  const message = SPOT_VERIFICATION_REJECT_NOTICE(row.recognizedPartNumber);
  await db
    .update(inventorySpotVerificationReviews)
    .set({
      status: "rejected",
      reviewedByAdminId: input.operator.id,
      reviewedByAdminName: input.operator.name.slice(0, 128),
      reviewedAt: new Date(),
      rejectMessage: message.slice(0, 255),
    })
    .where(eq(inventorySpotVerificationReviews.id, row.id));
  await sendXiaodianText(row.submittedByUserId, `spot-reject-${row.id}`, message);
  return { success: true as const };
}

export async function cancelActiveSpotVerification(input: {
  creditCode: string;
  expectedOwnerUserId: number;
  verificationId: number;
  operator: SpotVerificationReviewOperator;
}) {
  const enterprise = await resolveEnterprise(input.creditCode, input.expectedOwnerUserId);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  const row = (
    await db
      .select()
      .from(inventorySpotVerifications)
      .where(
        and(
          eq(inventorySpotVerifications.id, input.verificationId),
          eq(inventorySpotVerifications.enterpriseId, enterprise.id),
        ),
      )
      .limit(1)
  )[0];
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "核验记录不存在" });
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new TRPCError({ code: "CONFLICT", message: "该绿标已失效" });
  }
  const expiredAt = new Date();
  await db
    .update(inventorySpotVerifications)
    .set({ expiresAt: expiredAt })
    .where(eq(inventorySpotVerifications.id, row.id));
  const message = SPOT_VERIFICATION_CANCEL_NOTICE(row.inventoryPartNumber);
  const cancelHash = createHash("sha256").update(`cancel:${row.id}:${row.photoSha256}`).digest("hex");
  await db.insert(inventorySpotVerificationReviews).values({
    enterpriseId: enterprise.id,
    dataOwnerUserId: row.dataOwnerUserId,
    submittedByUserId: row.verifiedByUserId,
    inventoryId: row.inventoryId,
    recognizedPartNumber: row.recognizedPartNumber,
    inventoryPartNumber: row.inventoryPartNumber,
    markingSource: "printed",
    photoKey: row.photoKey,
    photoSha256: cancelHash,
    requestId: `cancel-${row.id}`,
    status: "cancelled",
    sourceVerificationId: row.id,
    reviewedByAdminId: input.operator.id,
    reviewedByAdminName: input.operator.name.slice(0, 128),
    reviewedAt: new Date(),
    rejectMessage: message.slice(0, 255),
  }).catch(() => undefined);
  await sendXiaodianText(row.verifiedByUserId, `spot-cancel-${row.id}`, message);
  return { success: true as const };
}

