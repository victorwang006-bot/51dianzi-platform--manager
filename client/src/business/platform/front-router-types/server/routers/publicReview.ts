import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import sharp from "sharp";
import { z } from "zod";
import { assertTextCompliant, maskForbiddenWords } from "../../../shared/contentModeration";
import { crmProcedure, dataViewProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { storageDelete, storagePut } from "../storage";
import { isServiceConversation } from "../services/customerService";
import { resolveEnterprisePermissionScope } from "../services/enterprisePermissions";
import { getPublicCompanyProfile } from "../services/companyPublicProfile";

const REVIEW_CONTENT_MAX = 500;
const REVIEW_IMAGE_LIMIT = 3;
const REVIEW_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const REVIEW_IMAGE_MAX_BASE64 = Math.ceil(REVIEW_IMAGE_MAX_BYTES * 4 / 3) + 16;
const GUEST_REVIEW_PLACEHOLDER = "[登录后查看评价详情]";

// 评论资格保持简单：双方均为认证企业即可；聊天入口额外校验会话归属，企业主页可直接评论。

const reviewContentSchema = z.string().trim().min(2, "评论至少填写2个字").max(REVIEW_CONTENT_MAX, "评论最多500字");
const reviewRequestIdSchema = z.string().min(16).max(64).regex(/^[A-Za-z0-9_-]+$/);
const reviewImagesSchema = z.array(z.object({
  base64: z.string().min(1).max(REVIEW_IMAGE_MAX_BASE64),
})).max(REVIEW_IMAGE_LIMIT, `最多上传${REVIEW_IMAGE_LIMIT}张图片`).default([]);

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库不可用" });
  return db;
}

type ReviewDb = Awaited<ReturnType<typeof requireDb>>;
type ReviewSqlExecutor = Pick<ReviewDb, "execute">;

type VerifiedCompany = {
  userId: number;
  companyId: number;
  companyName: string;
};

async function verifiedCompanyForUser(db: ReviewSqlExecutor, userId: number): Promise<VerifiedCompany | null> {
  const result = await db.execute(sql`
    SELECT c.id AS companyId, c.userId, c.companyName
      FROM companies c
     WHERE c.userId = ${userId}
       AND c.reviewStatus = 'approved'
       AND c.certLevel IN ('certified', 'premium')
       AND NULLIF(TRIM(c.companyName), '') IS NOT NULL
     LIMIT 1
  `);
  const rows = (result as unknown as [Array<{
    companyId: number;
    userId: number;
    companyName: string;
  }>, unknown])[0];
  const company = rows[0];
  return company
    ? {
        userId: Number(company.userId),
        companyId: Number(company.companyId),
        companyName: company.companyName.trim(),
      }
    : null;
}

async function requireReviewCompany(db: ReviewSqlExecutor, userId: number) {
  const company = await verifiedCompanyForUser(db, userId);
  if (!company) {
    throw new TRPCError({ code: "FORBIDDEN", message: "完成企业认证后可发布实名评论" });
  }
  return company;
}

type ReviewParty = VerifiedCompany & {
  actorUserId: number;
  stableUserId: number;
};

/** 将独立成员账号解析为不会随超级管理员转让变化的企业评论主体。 */
async function reviewPartyForUser(
  db: ReviewSqlExecutor,
  actorUserId: number,
): Promise<ReviewParty | null> {
  const scope = await resolveEnterprisePermissionScope(actorUserId);
  if (scope && scope.member.status !== "active") return null;
  const stableUserId = scope?.dataOwnerUserId ?? actorUserId;
  const company = await verifiedCompanyForUser(db, stableUserId);
  return company ? { ...company, actorUserId, stableUserId } : null;
}

async function requireReviewParty(db: ReviewSqlExecutor, actorUserId: number) {
  const party = await reviewPartyForUser(db, actorUserId);
  if (!party) {
    throw new TRPCError({ code: "FORBIDDEN", message: "完成企业认证后可发布实名评论" });
  }
  return party;
}

type ReviewInboxScope = {
  /** 公开评价仍以稳定 CRM 数据归属账号为目标，超级管理员转让后历史评论不丢失。 */
  ratedUserId: number;
  canReply: boolean;
};

/**
 * ERP 企业评论收件箱作用域。
 *
 * 企业成员共享同一收件箱；超级管理员、admin 角色或获授“用户权限”管理能力的
 * 企业管理员可公开回复，普通成员只读。尚未迁入统一企业模型的老账号仍可管理
 * 自己原有的评论，避免升级期间入口中断。
 */
async function reviewInboxScopeForUser(
  db: ReviewSqlExecutor,
  userId: number,
): Promise<ReviewInboxScope> {
  const scope = await resolveEnterprisePermissionScope(userId);
  if (!scope) {
    await requireReviewParty(db, userId);
    return { ratedUserId: userId, canReply: true };
  }
  if (scope.member.status !== "active") {
    throw new TRPCError({ code: "FORBIDDEN", message: "企业成员身份已暂停" });
  }
  await requireReviewCompany(db, scope.dataOwnerUserId);
  return {
    ratedUserId: scope.dataOwnerUserId,
    canReply:
      scope.isOwner
      || scope.member.role === "admin"
      || scope.permissionKeys.includes("enterprise.members.manage"),
  };
}

async function conversationContext(db: ReviewSqlExecutor, conversationId: number, userId: number) {
  const result = await db.execute(sql`
    SELECT id, user1Id, user2Id
      FROM conversations
     WHERE id = ${conversationId}
       AND (user1Id = ${userId} OR user2Id = ${userId})
     LIMIT 1
  `);
  const rows = (result as unknown as [Array<{
    id: number;
    user1Id: number;
    user2Id: number;
  }>, unknown])[0];
  const conversation = rows[0];
  if (!conversation) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只能评论与您有会话的企业" });
  }
  const serviceConversation = (await isServiceConversation(conversation)).isService;
  const otherUserId = Number(conversation.user1Id) === userId
    ? Number(conversation.user2Id)
    : Number(conversation.user1Id);
  return { conversationId: Number(conversation.id), otherUserId, serviceConversation };
}

function assertCompliant(content: string, label: string) {
  try {
    assertTextCompliant(content, label);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : `${label}包含不合规内容`,
    });
  }
}

export async function decodeReviewImages(images: Array<{ base64: string }>) {
  const decoded: Buffer[] = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const buffer = Buffer.from(image.base64, "base64");
    const isWebp = buffer.length >= 12
      && buffer.subarray(0, 4).toString("ascii") === "RIFF"
      && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    const isJpeg = buffer.length >= 3
      && buffer[0] === 0xff
      && buffer[1] === 0xd8
      && buffer[2] === 0xff;
    const isPng = buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (!buffer.length || buffer.length > REVIEW_IMAGE_MAX_BYTES || (!isWebp && !isJpeg && !isPng)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `第${index + 1}张图片无效，请重新选择`,
      });
    }
    try {
      const normalized = await sharp(buffer, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      if (!normalized.length || normalized.length > REVIEW_IMAGE_MAX_BYTES) {
        throw new Error("normalized image is too large");
      }
      decoded.push(normalized);
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `第${index + 1}张图片处理失败，请重新选择`,
      });
    }
  }
  return decoded;
}

async function uploadReviewImages(input: {
  raterUserId: number;
  ratedUserId: number;
  buffers: Buffer[];
}) {
  const uploaded: Array<{ storageKey: string; url: string; byteSize: number; sortOrder: number }> = [];
  try {
    for (let index = 0; index < input.buffers.length; index += 1) {
      const buffer = input.buffers[index];
      const objectKey = `public-reviews/rated-${input.ratedUserId}/rater-${input.raterUserId}/${Date.now()}-${randomUUID()}.webp`;
      const stored = await storagePut(objectKey, buffer, "image/webp");
      uploaded.push({
        storageKey: stored.key,
        url: stored.url,
        byteSize: buffer.length,
        sortOrder: index,
      });
    }
    return uploaded;
  } catch (error) {
    await Promise.allSettled(uploaded.map(image => storageDelete(image.storageKey)));
    throw error;
  }
}

async function createPublicReviewRecord(input: {
  db: ReviewDb;
  actorUserId: number;
  targetUserId: number;
  conversationId: number | null;
  requestId: string;
  content: string;
  images: Array<{ base64: string }>;
}) {
  const rater = await requireReviewParty(input.db, input.actorUserId);
  const rated = await requireReviewParty(input.db, input.targetUserId);
  if (rater.stableUserId === rated.stableUserId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "不能评论本企业" });
  }
  assertCompliant(input.content, "评论内容");
  const buffers = await decodeReviewImages(input.images);
  const payloadHasher = createHash("sha256")
    .update(JSON.stringify({
      targetUserId: input.targetUserId,
      conversationId: input.conversationId,
      content: input.content,
      imageCount: buffers.length,
    }));
  for (const buffer of buffers) {
    payloadHasher.update(String(buffer.length)).update(":").update(buffer);
  }
  const requestPayloadHash = payloadHasher.digest("hex");

  type ExistingRequest = {
    id: number;
    ratedUserId: number;
    conversationId: number | null;
    content: string;
    requestPayloadHash: string | null;
    revision: number;
  };
  const validateExistingRequest = (review: ExistingRequest) => {
    if (
      Number(review.ratedUserId) !== input.targetUserId
      || Number(review.conversationId ?? 0) !== Number(input.conversationId ?? 0)
      || review.content !== input.content
      || review.requestPayloadHash !== requestPayloadHash
    ) {
      throw new TRPCError({ code: "CONFLICT", message: "评论请求标识已被其他内容使用，请重新打开评论窗口" });
    }
    return {
      success: true as const,
      reviewId: Number(review.id),
      revision: Number(review.revision) || 1,
      deduplicated: true as const,
    };
  };

  const existingResult = await input.db.execute(sql`
    SELECT id, ratedUserId, conversationId, content, requestPayloadHash, revision
      FROM public_company_reviews
     WHERE raterUserId = ${input.actorUserId}
       AND clientRequestId = ${input.requestId}
     LIMIT 1
  `);
  const existing = (existingResult as unknown as [ExistingRequest[], unknown])[0][0];
  if (existing) return validateExistingRequest(existing);

  const uploaded = await uploadReviewImages({
    raterUserId: rater.stableUserId,
    ratedUserId: rated.stableUserId,
    buffers,
  });
  let uploadedCleaned = false;
  const cleanupUploaded = async () => {
    if (uploadedCleaned) return;
    uploadedCleaned = true;
    await Promise.allSettled(uploaded.map(image => storageDelete(image.storageKey)));
  };

  const result = await input.db.transaction(async tx => {
    const lockedResult = await tx.execute(sql`
      SELECT id, ratedUserId, conversationId, content, requestPayloadHash, revision
        FROM public_company_reviews
       WHERE raterUserId = ${input.actorUserId}
         AND clientRequestId = ${input.requestId}
       LIMIT 1
    `);
    const locked = (lockedResult as unknown as [ExistingRequest[], unknown])[0][0];
    if (locked) return validateExistingRequest(locked);

    await tx.execute(sql`
      INSERT INTO public_company_reviews
        (conversationId, clientRequestId, requestPayloadHash, raterUserId, ratedUserId, raterCompanyName, content, revision, status)
      VALUES
        (${input.conversationId}, ${input.requestId}, ${requestPayloadHash}, ${input.actorUserId}, ${input.targetUserId}, ${rater.companyName}, ${input.content}, 1, 'published')
    `);
    const idResult = await tx.execute(sql`SELECT LAST_INSERT_ID() AS id`);
    const reviewId = Number((idResult as unknown as [Array<{ id: number }>, unknown])[0][0]?.id ?? 0);
    if (!reviewId) throw new Error("评论写入失败");
    for (const image of uploaded) {
      await tx.execute(sql`
        INSERT INTO public_company_review_images
          (reviewId, uploaderUserId, storageKey, url, mimeType, byteSize, sortOrder)
        VALUES
          (${reviewId}, ${input.actorUserId}, ${image.storageKey}, ${image.url}, 'image/webp', ${image.byteSize}, ${image.sortOrder})
      `);
    }
    await tx.execute(sql`
      INSERT INTO public_company_review_events (reviewId, raterUserId, ratedUserId, eventType)
      VALUES (${reviewId}, ${rater.stableUserId}, ${rated.stableUserId}, 'created')
    `);
    return { success: true as const, reviewId, revision: 1, deduplicated: false as const };
  }).catch(async error => {
    await cleanupUploaded();
    if ((error as { code?: string }).code === "ER_DUP_ENTRY") {
      const duplicateResult = await input.db.execute(sql`
        SELECT id, ratedUserId, conversationId, content, requestPayloadHash, revision
          FROM public_company_reviews
         WHERE raterUserId = ${input.actorUserId}
           AND clientRequestId = ${input.requestId}
         LIMIT 1
      `);
      const duplicate = (duplicateResult as unknown as [ExistingRequest[], unknown])[0][0];
      if (duplicate) return validateExistingRequest(duplicate);
    }
    throw error;
  });
  if (result.deduplicated) {
    await cleanupUploaded();
  }
  return result;
}

type PublicReviewListRow = {
  id: number;
  raterUserId: number;
  ratedUserId: number;
  raterCompanyName: string;
  content: string;
  replyContent: string | null;
  repliedAt: Date | null;
  followUpContent: string | null;
  followedUpAt: Date | null;
  createdAt: Date;
};

/**
 * Public company pages are viewable without a session, but review bodies and
 * participating-company identities are not anonymous data. Do not try to
 * classify historical free text with regexes: an unauthenticated caller gets
 * only neutral cards plus the aggregate count, while authenticated callers
 * retain the existing response contract.
 */
function serializePublicReviewListItem(
  review: PublicReviewListRow,
  images: Array<{ id: number; url: string }>,
  viewerUserId: number | null,
) {
  if (viewerUserId === null) {
    return {
      id: Number(review.id),
      raterUserId: 0,
      ratedUserId: 0,
      raterCompanyName: "认证企业评价",
      content: GUEST_REVIEW_PLACEHOLDER,
      replyContent: null,
      repliedAt: null,
      followUpContent: null,
      followedUpAt: null,
      createdAt: review.createdAt,
      images: [],
    };
  }
  return {
    id: Number(review.id),
    raterUserId: Number(review.raterUserId),
    ratedUserId: Number(review.ratedUserId),
    raterCompanyName: review.raterCompanyName,
    content: maskForbiddenWords(review.content),
    replyContent: review.replyContent ? maskForbiddenWords(review.replyContent) : null,
    repliedAt: review.repliedAt,
    followUpContent: review.followUpContent ? maskForbiddenWords(review.followUpContent) : null,
    followedUpAt: review.followedUpAt,
    createdAt: review.createdAt,
    images,
  };
}

export const publicReviewRouter = router({
  /** 聊天页新评论入口：已有评论、回复或追加都不影响再次发布主评论。 */
  state: protectedProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const { otherUserId, serviceConversation } = await conversationContext(db, input.conversationId, ctx.user.id);
      if (serviceConversation) {
        return { available: false as const, reason: "service" as const, action: "unavailable" as const };
      }
      const [myParty, otherParty] = await Promise.all([
        reviewPartyForUser(db, ctx.user.id),
        reviewPartyForUser(db, otherUserId),
      ]);
      if (!myParty) {
        return { available: false as const, reason: "company_required" as const, action: "unavailable" as const };
      }
      if (!otherParty) {
        return { available: false as const, reason: "target_unavailable" as const, action: "unavailable" as const };
      }
      if (myParty.stableUserId === otherParty.stableUserId) {
        return { available: false as const, reason: "self" as const, action: "unavailable" as const };
      }
      return {
        available: true as const,
        action: "create" as const,
        reviewId: null,
        otherName: otherParty.companyName,
      };
    }),

  /** 企业详情页评论入口；按企业主体校验，不创建无消息聊天会话。 */
  stateForCompany: protectedProcedure
    .input(z.object({ supplierId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const profile = await getPublicCompanyProfile(input.supplierId);
      if (!profile) {
        return { available: false as const, reason: "target_unavailable" as const, action: "unavailable" as const };
      }
      const db = await requireDb();
      const [myParty, targetParty] = await Promise.all([
        reviewPartyForUser(db, ctx.user.id),
        reviewPartyForUser(db, input.supplierId),
      ]);
      if (!myParty) {
        return { available: false as const, reason: "company_required" as const, action: "unavailable" as const };
      }
      if (!targetParty) {
        return { available: false as const, reason: "target_unavailable" as const, action: "unavailable" as const };
      }
      if (myParty.stableUserId === targetParty.stableUserId) {
        return { available: false as const, reason: "self" as const, action: "unavailable" as const };
      }
      return {
        available: true as const,
        action: "create" as const,
        reviewId: null,
        otherName: targetParty.companyName,
      };
    }),

  /** 从聊天页发布新的实名主评论；历史评论不阻止本次交易再次评论。 */
  create: protectedProcedure
    .input(z.object({
      conversationId: z.number().int().positive(),
      requestId: reviewRequestIdSchema,
      content: reviewContentSchema,
      images: reviewImagesSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const { otherUserId, serviceConversation } = await conversationContext(db, input.conversationId, ctx.user.id);
      if (serviceConversation) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "官方客服不参与企业评论" });
      }
      return createPublicReviewRecord({
        db,
        actorUserId: ctx.user.id,
        targetUserId: otherUserId,
        conversationId: input.conversationId,
        requestId: input.requestId,
        content: input.content,
        images: input.images,
      });
    }),

  /** 从企业详情页直接发布新的实名主评论，不创建空聊天会话。 */
  createForCompany: protectedProcedure
    .input(z.object({
      supplierId: z.number().int().positive(),
      requestId: reviewRequestIdSchema,
      content: reviewContentSchema,
      images: reviewImagesSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const profile = await getPublicCompanyProfile(input.supplierId);
      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "企业资料暂不可查看" });
      }
      const db = await requireDb();
      return createPublicReviewRecord({
        db,
        actorUserId: ctx.user.id,
        targetUserId: input.supplierId,
        conversationId: null,
        requestId: input.requestId,
        content: input.content,
        images: input.images,
      });
    }),

  /** 发布者删除自己的评价：前台立即隐藏，历史内容、图片、回复和追加评价全部留存。 */
  removeOwn: protectedProcedure
    .input(z.object({ reviewId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      return db.transaction(async tx => {
        const result = await tx.execute(sql`
          SELECT id, raterUserId, status
            FROM public_company_reviews
           WHERE id = ${input.reviewId}
           LIMIT 1
           FOR UPDATE
        `);
        const review = (result as unknown as [Array<{
          id: number;
          raterUserId: number;
          status: "published" | "user_deleted" | "platform_hidden";
        }>, unknown])[0][0];
        if (!review || Number(review.raterUserId) !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只能删除自己发布的评论" });
        }
        if (review.status !== "published") {
          throw new TRPCError({ code: "CONFLICT", message: "该评论已不再公开" });
        }
        await tx.execute(sql`
          UPDATE public_company_reviews
             SET status = 'user_deleted', deletedByUserId = ${ctx.user.id}, deletedAt = NOW()
           WHERE id = ${input.reviewId} AND status = 'published'
        `);
        return { success: true as const };
      });
    }),

  /** 被评价企业公开回复一次。 */
  reply: crmProcedure
    .input(z.object({ reviewId: z.number().int().positive(), content: reviewContentSchema }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const inboxScope = await reviewInboxScopeForUser(db, ctx.user.id);
      if (!inboxScope.canReply) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有企业管理员可以回复评论" });
      }
      assertCompliant(input.content, "回复内容");
      return db.transaction(async tx => {
        const result = await tx.execute(sql`
          SELECT r.id, e.ratedUserId AS stableRatedUserId, r.status, r.replyContent
            FROM public_company_reviews r
            INNER JOIN public_company_review_events e
              ON e.reviewId = r.id AND e.eventType = 'created'
           WHERE r.id = ${input.reviewId}
           LIMIT 1
           FOR UPDATE
        `);
        const review = (result as unknown as [Array<{
          id: number;
          stableRatedUserId: number;
          status: "published" | "user_deleted" | "platform_hidden";
          replyContent: string | null;
        }>, unknown])[0][0];
        if (!review || Number(review.stableRatedUserId) !== inboxScope.ratedUserId || review.status !== "published") {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权回复该评论" });
        }
        if (review.replyContent) {
          throw new TRPCError({ code: "CONFLICT", message: "该评论已回复" });
        }
        await tx.execute(sql`
          UPDATE public_company_reviews
             SET replyContent = ${input.content}, repliedByUserId = ${ctx.user.id}, repliedAt = NOW()
           WHERE id = ${input.reviewId}
        `);
        return { success: true as const };
      });
    }),

  /** 评价企业在商家回复后追加一次。 */
  followUp: protectedProcedure
    .input(z.object({ reviewId: z.number().int().positive(), content: reviewContentSchema }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireReviewParty(db, ctx.user.id);
      assertCompliant(input.content, "追加评论");
      return db.transaction(async tx => {
        const result = await tx.execute(sql`
          SELECT r.id, r.raterUserId, e.raterUserId AS stableRaterUserId,
                 e.ratedUserId AS stableRatedUserId, r.status, r.replyContent, r.followUpContent
            FROM public_company_reviews r
            INNER JOIN public_company_review_events e
              ON e.reviewId = r.id AND e.eventType = 'created'
           WHERE r.id = ${input.reviewId}
           LIMIT 1
           FOR UPDATE
        `);
        const review = (result as unknown as [Array<{
          id: number;
          raterUserId: number;
          stableRaterUserId: number;
          stableRatedUserId: number;
          status: "published" | "user_deleted" | "platform_hidden";
          replyContent: string | null;
          followUpContent: string | null;
        }>, unknown])[0][0];
        if (!review || Number(review.raterUserId) !== ctx.user.id || review.status !== "published") {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权追加该评论" });
        }
        if (!review.replyContent) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "商家回复后才可追加评论" });
        }
        if (review.followUpContent) {
          throw new TRPCError({ code: "CONFLICT", message: "该评论已追加" });
        }
        await tx.execute(sql`
          UPDATE public_company_reviews
             SET followUpContent = ${input.content}, followedUpAt = NOW()
           WHERE id = ${input.reviewId}
        `);
        await tx.execute(sql`
          INSERT INTO public_company_review_events (reviewId, raterUserId, ratedUserId, eventType)
          VALUES (${input.reviewId}, ${review.stableRaterUserId}, ${review.stableRatedUserId}, 'follow_up')
        `);
        return { success: true as const };
      });
    }),

  /** ERP 左侧“企业信息”菜单的逐用户未读数量。新主评价和新追加评价均计入。 */
  unreadCount: crmProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const inboxScope = await reviewInboxScopeForUser(db, ctx.user.id);
    const result = await db.execute(sql`
      SELECT COUNT(*) AS total
        FROM public_company_review_events e
        INNER JOIN public_company_reviews r ON r.id = e.reviewId
        LEFT JOIN public_company_review_event_reads er
          ON er.eventId = e.id AND er.userId = ${ctx.user.id}
       WHERE e.ratedUserId = ${inboxScope.ratedUserId}
         AND e.notifyEligible = 1
         AND r.status = 'published'
         AND er.id IS NULL
    `);
    const row = (result as unknown as [Array<{ total: number }>, unknown])[0][0];
    return { total: Number(row?.total ?? 0) };
  }),

  /**
   * ERP 企业评论收件箱：待回复置顶，其余按主评价/追加评价的最近活动倒序。
   * 同企业成员可查看；canReply 由服务端按企业角色返回，不能由客户端自行判断。
   */
  inbox: crmProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(20).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const inboxScope = await reviewInboxScopeForUser(db, ctx.user.id);
      const offset = (input.page - 1) * input.pageSize;
      const countResult = await db.execute(sql`
        SELECT COUNT(*) AS total,
               SUM(r.replyContent IS NULL) AS pendingReplyCount
          FROM public_company_reviews r
          INNER JOIN public_company_review_events createdEvent
            ON createdEvent.reviewId = r.id AND createdEvent.eventType = 'created'
         WHERE createdEvent.ratedUserId = ${inboxScope.ratedUserId}
           AND r.status = 'published'
      `);
      const countRow = (countResult as unknown as [Array<{
        total: number;
        pendingReplyCount: number | null;
      }>, unknown])[0][0];

      const result = await db.execute(sql`
        SELECT r.id, r.raterUserId, r.ratedUserId, r.raterCompanyName,
               r.content, r.replyContent, r.repliedAt, r.followUpContent, r.followedUpAt, r.createdAt,
               GREATEST(r.createdAt, COALESCE(r.followedUpAt, r.createdAt)) AS activityAt,
               (
                 SELECT GROUP_CONCAT(e.id ORDER BY e.id)
                   FROM public_company_review_events e
                   LEFT JOIN public_company_review_event_reads er
                     ON er.eventId = e.id AND er.userId = ${ctx.user.id}
                  WHERE e.reviewId = r.id
                    AND e.ratedUserId = ${inboxScope.ratedUserId}
                    AND e.notifyEligible = 1
                    AND er.id IS NULL
               ) AS unreadEventIds
          FROM public_company_reviews r
          INNER JOIN public_company_review_events createdEvent
            ON createdEvent.reviewId = r.id AND createdEvent.eventType = 'created'
         WHERE createdEvent.ratedUserId = ${inboxScope.ratedUserId}
           AND r.status = 'published'
         ORDER BY (r.replyContent IS NULL) DESC, activityAt DESC, r.id DESC
         LIMIT ${input.pageSize} OFFSET ${offset}
      `);
      const reviews = (result as unknown as [Array<{
        id: number;
        raterUserId: number;
        ratedUserId: number;
        raterCompanyName: string;
        content: string;
        replyContent: string | null;
        repliedAt: Date | null;
        followUpContent: string | null;
        followedUpAt: Date | null;
        createdAt: Date;
        activityAt: Date;
        unreadEventIds: string | null;
      }>, unknown])[0];

      const imagesByReview = new Map<number, Array<{ id: number; url: string }>>();
      const unreadReviewIds = new Set<number>();
      const visibleUnreadEventIds: number[] = [];
      for (const review of reviews) {
        const eventIds = String(review.unreadEventIds ?? "")
          .split(",")
          .map(value => Number(value))
          .filter(value => Number.isSafeInteger(value) && value > 0);
        if (eventIds.length === 0) continue;
        unreadReviewIds.add(Number(review.id));
        visibleUnreadEventIds.push(...eventIds);
      }
      if (reviews.length > 0) {
        const ids = reviews.map(review => Number(review.id));
        const imageResult = await db.execute(sql`
          SELECT id, reviewId, url
            FROM public_company_review_images
           WHERE reviewId IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
           ORDER BY reviewId ASC, sortOrder ASC, id ASC
        `);
        const images = (imageResult as unknown as [Array<{
          id: number;
          reviewId: number;
          url: string;
        }>, unknown])[0];
        for (const image of images) {
          const reviewId = Number(image.reviewId);
          const list = imagesByReview.get(reviewId) ?? [];
          list.push({ id: Number(image.id), url: image.url });
          imagesByReview.set(reviewId, list);
        }
      }

      const total = Number(countRow?.total ?? 0);
      return {
        items: reviews.map(review => ({
          id: Number(review.id),
          raterCompanyName: review.raterCompanyName,
          content: maskForbiddenWords(review.content),
          replyContent: review.replyContent ? maskForbiddenWords(review.replyContent) : null,
          repliedAt: review.repliedAt,
          followUpContent: review.followUpContent ? maskForbiddenWords(review.followUpContent) : null,
          followedUpAt: review.followedUpAt,
          createdAt: review.createdAt,
          activityAt: review.activityAt,
          unread: unreadReviewIds.has(Number(review.id)),
          images: imagesByReview.get(Number(review.id)) ?? [],
        })),
        visibleUnreadEventIds,
        total,
        pendingReplyCount: Number(countRow?.pendingReplyCount ?? 0),
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
        canReply: inboxScope.canReply,
      };
    }),

  /** 只把客户端当前页实际展示的未读活动标为已读；并发新增事件不会被误清。 */
  markInboxRead: crmProcedure
    .input(z.object({
      eventIds: z.array(z.number().int().positive()).max(40).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.eventIds.length === 0) return { success: true as const, marked: 0 };
      const db = await requireDb();
      const inboxScope = await reviewInboxScopeForUser(db, ctx.user.id);
      const eventIds = Array.from(new Set(input.eventIds));
      const result = await db.execute(sql`
        INSERT IGNORE INTO public_company_review_event_reads (userId, eventId)
        SELECT ${ctx.user.id}, e.id
          FROM public_company_review_events e
          INNER JOIN public_company_reviews r ON r.id = e.reviewId
         WHERE e.ratedUserId = ${inboxScope.ratedUserId}
           AND e.notifyEligible = 1
           AND r.status = 'published'
           AND e.id IN (${sql.join(eventIds.map(id => sql`${id}`), sql`, `)})
      `);
      const header = (result as unknown as Array<{ affectedRows?: number }>)[0];
      return { success: true as const, marked: Number(header?.affectedRows ?? 0) };
    }),

  /** 企业公开主页：按时间倒序展示全部实名公开评价。 */
  list: dataViewProcedure
    .input(z.object({
      supplierId: z.number().int().positive(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(20).default(10),
    }))
    .query(async ({ ctx, input }) => {
      const viewerUserId = ctx.user?.id ?? null;
      const profile = await getPublicCompanyProfile(input.supplierId);
      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "企业资料暂不可查看" });
      }
      const db = await requireDb();
      const offset = (input.page - 1) * input.pageSize;
      const countResult = await db.execute(sql`
        SELECT COUNT(*) AS total
          FROM public_company_reviews r
          INNER JOIN public_company_review_events createdEvent
            ON createdEvent.reviewId = r.id AND createdEvent.eventType = 'created'
         WHERE createdEvent.ratedUserId = ${input.supplierId} AND r.status = 'published'
      `);
      const total = Number((countResult as unknown as [Array<{ total: number }>, unknown])[0][0]?.total ?? 0);
      const result = await db.execute(sql`
        SELECT r.id, r.raterUserId, r.ratedUserId, r.raterCompanyName,
               r.content, r.replyContent, r.repliedAt, r.followUpContent, r.followedUpAt, r.createdAt
          FROM public_company_reviews r
          INNER JOIN public_company_review_events createdEvent
            ON createdEvent.reviewId = r.id AND createdEvent.eventType = 'created'
         WHERE createdEvent.ratedUserId = ${input.supplierId} AND r.status = 'published'
         ORDER BY r.createdAt DESC, r.id DESC
         LIMIT ${input.pageSize} OFFSET ${offset}
      `);
      const reviews = (result as unknown as [PublicReviewListRow[], unknown])[0];

      const imagesByReview = new Map<number, Array<{ id: number; url: string }>>();
      // Image URLs are original media URLs. Guests must not receive them or
      // trigger an image read at all; authenticated viewers retain the
      // existing image list and URL contract.
      if (viewerUserId !== null && reviews.length > 0) {
        const ids = reviews.map(review => Number(review.id));
        const imageResult = await db.execute(sql`
          SELECT id, reviewId, url
            FROM public_company_review_images
           WHERE reviewId IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
           ORDER BY reviewId ASC, sortOrder ASC, id ASC
        `);
        const images = (imageResult as unknown as [Array<{
          id: number;
          reviewId: number;
          url: string;
        }>, unknown])[0];
        for (const image of images) {
          const reviewId = Number(image.reviewId);
          const list = imagesByReview.get(reviewId) ?? [];
          list.push({ id: Number(image.id), url: image.url });
          imagesByReview.set(reviewId, list);
        }
      }

      return {
        items: reviews.map(review => serializePublicReviewListItem(
          review,
          imagesByReview.get(Number(review.id)) ?? [],
          viewerUserId,
        )),
        total,
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
      };
    }),
});
