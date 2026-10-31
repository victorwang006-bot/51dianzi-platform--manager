import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  conversations,
  enterpriseMembers,
  enterprises,
  forumAttachments,
  forumFollowedUsers,
  forumMessageChanges,
  forumMessageMentions,
  forumMessageUserHidden,
  forumMessageUserVisibilityChanges,
  forumMessages,
  forumQuoteJobs,
  forumReadReceiptState,
  forumRulesAcceptances,
  forumSupplierQuotes,
  forumUserSettings,
  inventories,
  marketReports,
  users,
} from "../../drizzle/schema";
import {
  encodeSharedReportContent,
  parseSharedReportContent,
  startsWithForumReportSharePrefix,
} from "../../../shared/forumReportShare";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getPublicCompanyProfile, getPublicCompanySupplierIds } from "../services/companyPublicProfile";
import { resolveActorBusinessIdentity } from "../services/actorBusinessIdentity";
import { companyCatalogVisibleCondition } from "../services/inventoryVisibility";
import { decodeAndScanForumAttachment } from "../services/forumAttachments";
import { storageDelete, storageGetAccessUrl, storagePutPrivate } from "../storage";
import { trustedClientIp } from "../trustedClientIp";
import { CHAT_STICKER_LABELS } from "./chat";
import { maskForbiddenWords } from "../../../shared/contentModeration";

export const FORUM_RULE_VERSION = "v2" as const;
export const FORUM_RULE_TITLE = "51电子网论坛公约" as const;
export const FORUM_RULE_CONTENT = [
  "友善、真实、专业地交流电子行业信息，尊重每一位论坛成员。",
  "不得发布违法违规、欺诈、骚扰、仇恨、色情、侵权的内容。",
  "报价、库存与供求信息应尽量准确；请勿刷屏、重复发言或冒充他人及平台工作人员。",
  "平台可依公约隐藏违规消息、禁言或暂停账号。请注意资金安全。",
] as const;

const FORUM_RATE_LIMIT_PER_MINUTE = 12;
const FORUM_DUPLICATE_WINDOW_SECONDS = 20;
const FORUM_ATTACHMENT_LIMIT_PER_MINUTE = 5;
const FORUM_ATTACHMENT_LIMIT_PER_DAY = 50;
const FORUM_ATTACHMENT_BYTES_PER_DAY = 200 * 1024 * 1024;
/**
 * 私有附件签名地址有效期。
 *
 * 存储层出于安全和兼容性要求只接受 60～3600 秒；这里使用 1 小时，
 * 可覆盖论坛长时间停留、图片懒加载和网络重试，页面仍会在加载失败时刷新短链。
 */
const FORUM_ATTACHMENT_URL_TTL_SECONDS = 60 * 60;
const FORUM_WITHDRAW_WINDOW_SECONDS = 120;
const FORUM_PERSONAL_DELETE_UNDO_WINDOW_SECONDS = 5;
const forumAttachmentScansInFlight = new Set<number>();
const MENTION_TOKEN_START = "\uE000";
const MENTION_TOKEN_LABEL = "\uE001";
const MENTION_TOKEN_END = "\uE002";
const MENTION_TOKEN_SEPARATOR_PATTERN = /[\uE000\uE001\uE002]/;
// Do not infer whether historical free text is safe with a pattern. Anonymous
// readers receive this neutral summary for every discussion type; product and
// stock details remain available after authentication.
const GUEST_FORUM_MESSAGE_PLACEHOLDER = "[登录后查看完整论坛内容]";
const GUEST_FORUM_REPLY_PLACEHOLDER = "[登录后查看引用内容]";

const forumAttachmentInput = z.object({
  kind: z.enum(["image", "file"]),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(128),
  base64: z.string().min(1),
});

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type MessageKind = "text" | "sticker" | "image" | "file";
type ParsedMentionPart =
  | { kind: "text"; value: string }
  | { kind: "mention"; value: string; userId: number; label: string };

function invalidMention(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function parseStructuredMentionContent(content: string) {
  const parts: ParsedMentionPart[] = [];
  const mentions: Array<{ userId: number; label: string }> = [];
  let cursor = 0;

  while (cursor < content.length) {
    const tokenStart = content.indexOf(MENTION_TOKEN_START, cursor);
    const textEnd = tokenStart < 0 ? content.length : tokenStart;
    const plainText = content.slice(cursor, textEnd);
    if (MENTION_TOKEN_SEPARATOR_PATTERN.test(plainText)) {
      invalidMention("@提及格式无效");
    }
    if (plainText) parts.push({ kind: "text", value: plainText });
    if (tokenStart < 0) break;

    const idEnd = content.indexOf(MENTION_TOKEN_LABEL, tokenStart + MENTION_TOKEN_START.length);
    const tokenEnd = idEnd < 0
      ? -1
      : content.indexOf(MENTION_TOKEN_END, idEnd + MENTION_TOKEN_LABEL.length);
    if (idEnd < 0 || tokenEnd < 0) invalidMention("@提及格式无效");
    const idText = content.slice(tokenStart + MENTION_TOKEN_START.length, idEnd);
    const label = content.slice(idEnd + MENTION_TOKEN_LABEL.length, tokenEnd);
    if (!/^[1-9]\d*$/.test(idText) || !label || MENTION_TOKEN_SEPARATOR_PATTERN.test(label)) {
      invalidMention("@提及格式无效");
    }
    const userId = Number(idText);
    if (!Number.isSafeInteger(userId) || userId <= 0) invalidMention("@提及用户ID无效");
    const canonicalToken = `${MENTION_TOKEN_START}${userId}${MENTION_TOKEN_LABEL}${label}${MENTION_TOKEN_END}`;
    parts.push({ kind: "mention", value: canonicalToken, userId, label });
    mentions.push({ userId, label });
    cursor = tokenEnd + MENTION_TOKEN_END.length;
  }

  if (mentions.length > 20) invalidMention("单条消息最多提及20位用户");
  return {
    parts,
    mentions,
    visibleContent: parts.map(part => part.kind === "mention" ? `@${part.label}` : part.value).join(""),
  };
}

function decodeStoredMentionContent(content: string) {
  return decodeStoredMentionEnvelope(content).visibleContent;
}

export function decodeStoredMentionEnvelope(content: string) {
  if (!MENTION_TOKEN_SEPARATOR_PATTERN.test(content)) {
    return { visibleContent: content, mentions: [] as Array<{ userId: number; name: string; start: number; end: number }> };
  }
  try {
    const parsed = parseStructuredMentionContent(content);
    const mentions: Array<{ userId: number; name: string; start: number; end: number }> = [];
    let visibleCursor = 0;
    for (const part of parsed.parts) {
      if (part.kind === "text") {
        visibleCursor += part.value.length;
        continue;
      }
      const visibleMention = `@${part.label}`;
      mentions.push({
        userId: part.userId,
        name: part.label,
        start: visibleCursor,
        end: visibleCursor + visibleMention.length,
      });
      visibleCursor += visibleMention.length;
    }
    return { visibleContent: parsed.visibleContent, mentions };
  } catch {
    // Never expose an internal protocol fragment if historical/corrupt data is malformed.
    return {
      visibleContent: "[消息内容格式异常]",
      mentions: [] as Array<{ userId: number; name: string; start: number; end: number }>,
    };
  }
}

export function validateMentionEnvelope(
  messageType: MessageKind,
  content: string,
  mentionUserIds: number[],
  senderUserId: number,
) {
  if (messageType !== "text") {
    if (mentionUserIds.length || MENTION_TOKEN_SEPARATOR_PATTERN.test(content)) {
      invalidMention("仅文字消息可以携带@提及");
    }
    return { parts: [{ kind: "text", value: content }] as ParsedMentionPart[], mentions: [], visibleContent: content };
  }

  const parsed = parseStructuredMentionContent(content);
  const requestedIds = new Set(mentionUserIds);
  const parsedIds = new Set(parsed.mentions.map(mention => mention.userId));
  if (parsed.mentions.some(mention => mention.userId === senderUserId)) invalidMention("不能提及自己");
  if (
    requestedIds.size !== parsedIds.size
    || Array.from(parsedIds).some(userId => !requestedIds.has(userId))
  ) {
    invalidMention("@提及内容与mentionUserIds不一致");
  }
  return parsed;
}

export function uniqueMentionUserIds(mentions: Array<{ userId: number }>) {
  return Array.from(new Set(mentions.map(mention => mention.userId)));
}

async function requireDb(): Promise<Db> {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库暂不可用" });
  return db;
}

function clientIp(req: Parameters<typeof trustedClientIp>[0] | undefined): string | null {
  return req ? trustedClientIp(req).slice(0, 64) : null;
}

async function postingState(db: Db, userId: number) {
  const [userRows, acceptanceRows] = await Promise.all([
    db
      .select({ mutedUntil: users.forumMutedUntil, muteReason: users.forumMuteReason })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    db
      .select({ id: forumRulesAcceptances.id })
      .from(forumRulesAcceptances)
      .where(and(
        eq(forumRulesAcceptances.userId, userId),
        eq(forumRulesAcceptances.ruleVersion, FORUM_RULE_VERSION),
      ))
      .limit(1),
  ]);
  const user = userRows[0];
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "用户不存在，请重新登录" });
  const now = new Date();
  return {
    accepted: Boolean(acceptanceRows[0]),
    mutedUntil: user.mutedUntil,
    muteReason: user.muteReason,
    muted: Boolean(user.mutedUntil && user.mutedUntil.getTime() > now.getTime()),
  };
}

function effectiveNotificationMode(
  notificationMode: "all" | "mentions" | "muted" | null | undefined,
  notificationsMuted: boolean | null | undefined,
) {
  if (notificationMode === "mentions") return "mentions" as const;
  if (notificationsMuted) return "muted" as const;
  return "all" as const;
}

const FORUM_RESERVED_NICKNAME_TERMS = ["51小电", "51电子网", "官方", "管理员", "版主"] as const;

/** 去除大小写、全半角和空白差异后拦截平台及管理身份保留词。 */
export function validateForumGroupNickname(groupNickname: string | null | undefined) {
  const nickname = groupNickname?.trim();
  if (!nickname) return;
  const normalized = nickname
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g, "");
  const matchedTerm = FORUM_RESERVED_NICKNAME_TERMS.find(term => normalized.includes(term));
  if (matchedTerm) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `群昵称不得包含平台保留词“${matchedTerm}”，请勿冒充平台官方或管理人员`,
    });
  }
}

export function memberDisplayName(
  groupNickname: string | null | undefined,
  userName: string | null | undefined,
  username: string | null | undefined,
  userId: number,
) {
  // 群昵称是用户主动设置的论坛专属身份；未设置时必须跟随最新登录用户名。
  // users.name 是历史姓名资料，可能在用户名修改后仍保留旧值，不能继续压过 username。
  return groupNickname || username || userName || `用户${userId}`;
}

async function forumMessageReadCounts(db: Db, messageIds: number[]) {
  if (!messageIds.length) return [];
  return db
    .select({
      messageId: forumMessages.id,
      readCount: sql<number>`COUNT(${forumUserSettings.userId})`,
    })
    .from(forumMessages)
    .leftJoin(forumUserSettings, and(
      gte(forumUserSettings.lastViewedMessageId, forumMessages.id),
      ne(forumUserSettings.userId, forumMessages.userId),
    ))
    .where(and(
      inArray(forumMessages.id, Array.from(new Set(messageIds))),
      eq(forumMessages.isHidden, false),
      isNull(forumMessages.deletedAt),
    ))
    .groupBy(forumMessages.id)
    .orderBy(asc(forumMessages.id));
}

/** SQL predicate for content hidden only from the current forum viewer. */
function visibleToForumViewer(viewerUserId: number) {
  return sql<boolean>`NOT EXISTS (
    SELECT 1 FROM ${forumMessageUserHidden}
    WHERE ${forumMessageUserHidden.userId} = ${viewerUserId}
      AND ${forumMessageUserHidden.messageId} = ${forumMessages.id}
  )`;
}

function forumReplySummary(messageType: MessageKind, content: string | null) {
  if (messageType === "image") return "[图片]";
  if (messageType === "sticker") return "[表情]";
  if (messageType === "file") return "[文件]";
  const reportShare = parseSharedReportContent(content || "");
  const text = reportShare
    ? `[行情报告] ${reportShare.title}${reportShare.note ? ` ${reportShare.note}` : ""}`
    : decodeStoredMentionEnvelope(content || "").visibleContent;
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

const FORUM_LATEST_MESSAGE_PREVIEW_MAX_LENGTH = 80;

/** A compact, safe preview for the chat-list entry point; never return stored protocol text. */
export function forumLatestMessagePreview(messageType: MessageKind, content: string | null) {
  if (messageType === "image") return "[图片]";
  if (messageType === "sticker") return "[表情]";
  if (messageType === "file") return "[文件]";
  const source = content || "";
  const reportShare = parseSharedReportContent(source);
  // A malformed report envelope, like a malformed mention envelope, is internal
  // stored content and must not be surfaced in a lightweight list preview.
  const visibleText = reportShare
    ? `[行情报告] ${reportShare.title}${reportShare.note ? ` ${reportShare.note}` : ""}`
    : startsWithForumReportSharePrefix(source)
      ? "[消息内容格式异常]"
      : decodeStoredMentionEnvelope(source).visibleContent;
  const oneLine = visibleText.replace(/[\r\n\u2028\u2029]+/g, " ").trim();
  return oneLine.length > FORUM_LATEST_MESSAGE_PREVIEW_MAX_LENGTH
    ? `${oneLine.slice(0, FORUM_LATEST_MESSAGE_PREVIEW_MAX_LENGTH)}…`
    : oneLine;
}

async function hydrateMessages(db: Db, messageIds: number[], viewerUserId: number | null) {
  if (!messageIds.length) return [];
  const isGuest = viewerUserId === null;
  const rows = await db
    .select({
      id: forumMessages.id,
      userId: forumMessages.userId,
      clientMessageId: forumMessages.clientMessageId,
      messageType: forumMessages.messageType,
      content: forumMessages.content,
      attachmentId: forumMessages.attachmentId,
      replyToMessageId: forumMessages.replyToMessageId,
      createdAt: forumMessages.createdAt,
      senderName: users.name,
      senderUsername: users.username,
      senderAvatarUrl: users.avatarUrl,
      senderJobTitle: users.jobTitle,
      senderGroupNickname: forumUserSettings.groupNickname,
      senderEnterpriseId: enterprises.id,
      senderCompanyName: enterprises.companyName,
      senderCompanySupplierId: enterprises.crmDataOwnerUserId,
      attachmentKind: forumAttachments.kind,
      attachmentOriginalName: forumAttachments.originalName,
      attachmentMimeType: forumAttachments.mimeType,
      attachmentByteSize: forumAttachments.byteSize,
      attachmentStorageKey: forumAttachments.storageKey,
      isHidden: forumMessages.isHidden,
    })
    .from(forumMessages)
    .innerJoin(users, eq(users.id, forumMessages.userId))
    .leftJoin(enterpriseMembers, and(
      eq(enterpriseMembers.userId, forumMessages.userId),
      eq(enterpriseMembers.status, "active"),
    ))
    .leftJoin(enterprises, eq(enterprises.id, enterpriseMembers.enterpriseId))
    .leftJoin(forumUserSettings, eq(forumUserSettings.userId, forumMessages.userId))
    .leftJoin(forumAttachments, eq(forumAttachments.id, forumMessages.attachmentId))
    .where(and(
      inArray(forumMessages.id, messageIds),
      isNull(forumMessages.deletedAt),
      viewerUserId === null ? undefined : visibleToForumViewer(viewerUserId),
    ))
    .orderBy(asc(forumMessages.id));
  const replyToMessageIds = Array.from(new Set(rows
    .map(row => row.replyToMessageId)
    .filter((messageId): messageId is number => messageId !== null)));
  const replyRows = replyToMessageIds.length
    ? await db
      .select({
        id: forumMessages.id,
        userId: forumMessages.userId,
        messageType: forumMessages.messageType,
        content: forumMessages.content,
        isHidden: forumMessages.isHidden,
        deletedAt: forumMessages.deletedAt,
        senderName: users.name,
        senderUsername: users.username,
        senderGroupNickname: forumUserSettings.groupNickname,
      })
      .from(forumMessages)
      .innerJoin(users, eq(users.id, forumMessages.userId))
      .leftJoin(forumUserSettings, eq(forumUserSettings.userId, forumMessages.userId))
      .where(and(
        inArray(forumMessages.id, replyToMessageIds),
        viewerUserId === null ? undefined : visibleToForumViewer(viewerUserId),
      ))
    : [];
  const repliesById = new Map(replyRows.map(reply => [reply.id, reply]));
  const mentionRows = await db
    .select({
      messageId: forumMessageMentions.messageId,
      userId: forumMessageMentions.mentionedUserId,
    })
    .from(forumMessageMentions)
    .where(inArray(forumMessageMentions.messageId, messageIds));
  const storedMentionUserIds = new Map<number, Set<number>>();
  for (const row of mentionRows) {
    const ids = storedMentionUserIds.get(row.messageId) ?? new Set<number>();
    ids.add(row.userId);
    storedMentionUserIds.set(row.messageId, ids);
  }
  const publicCompanySupplierIds = await getPublicCompanySupplierIds(
    rows.flatMap(row => row.senderCompanySupplierId === null ? [] : [row.senderCompanySupplierId]),
  ).catch(() => {
    // Optional company links must fail closed without taking down the message feed.
    // Do not log SQL, identities or query parameters from the underlying error.
    console.warn("[forum] public company eligibility unavailable; company links suppressed");
    return new Set<number>();
  });
  return Promise.all(rows.map(async row => {
    const decoded = row.isHidden
      ? { visibleContent: "", mentions: [] as Array<{ userId: number; name: string; start: number; end: number }> }
      : decodeStoredMentionEnvelope(row.content || "");
    const relationIds = storedMentionUserIds.get(row.id) ?? new Set<number>();
    const decodedIds = new Set(decoded.mentions.map(mention => mention.userId));
    const mentionEnvelopeMatchesRelations = row.isHidden || (
      relationIds.size === decodedIds.size
      && Array.from(decodedIds).every(userId => relationIds.has(userId))
    );
    const replyMessage = row.replyToMessageId === null ? null : repliesById.get(row.replyToMessageId);
    const reply = row.replyToMessageId === null
      ? null
      : !replyMessage || replyMessage.isHidden || replyMessage.deletedAt
        ? {
          messageId: row.replyToMessageId,
          senderName: null,
          messageType: null,
          summary: "",
          unavailable: true,
        }
        : {
          messageId: replyMessage.id,
          senderName: memberDisplayName(
            replyMessage.senderGroupNickname,
            replyMessage.senderName,
            replyMessage.senderUsername,
            replyMessage.userId,
          ),
          messageType: replyMessage.messageType,
          summary: forumReplySummary(replyMessage.messageType, replyMessage.content),
          unavailable: false,
        };
    return {
      id: row.id,
      // Anonymous readers must not receive unclassified historical free text,
      // user identity/contact cues, mention targets, or attachment metadata.
      // In particular, do not create a signed attachment URL for a guest.
      userId: isGuest ? 0 : row.userId,
      clientMessageId: isGuest ? null : row.clientMessageId,
      messageType: isGuest ? "text" as const : row.messageType,
      content: row.isHidden
        ? ""
        : isGuest
          ? GUEST_FORUM_MESSAGE_PLACEHOLDER
          : mentionEnvelopeMatchesRelations ? decoded.visibleContent : "[消息内容格式异常]",
      isHidden: Boolean(row.isHidden),
      reply: isGuest && reply && !reply.unavailable
        ? {
          ...reply,
          senderName: "论坛成员",
          messageType: "text" as const,
          summary: GUEST_FORUM_REPLY_PLACEHOLDER,
        }
        : reply,
      createdAt: row.createdAt,
      sender: isGuest ? {
        id: 0,
        name: "论坛成员",
        avatarUrl: null,
        companyName: null,
        companySupplierId: null,
        jobTitle: null,
        isErpMember: false,
      } : {
        id: row.userId,
        name: memberDisplayName(row.senderGroupNickname, row.senderName, row.senderUsername, row.userId),
        avatarUrl: row.senderAvatarUrl || null,
        companyName: row.senderEnterpriseId === null ? null : (row.senderCompanyName?.trim() || null),
        companySupplierId: row.senderCompanySupplierId !== null
          && publicCompanySupplierIds.has(row.senderCompanySupplierId)
          ? row.senderCompanySupplierId
          : null,
        jobTitle: row.senderJobTitle?.trim() || null,
        isErpMember: row.senderEnterpriseId !== null,
      },
      mentions: isGuest || row.isHidden ? [] : mentionEnvelopeMatchesRelations ? decoded.mentions : [],
      attachment: !isGuest && !row.isHidden && row.attachmentId && row.attachmentKind && row.attachmentStorageKey ? {
        id: row.attachmentId,
        kind: row.attachmentKind,
        originalName: row.attachmentOriginalName || "附件",
        mimeType: row.attachmentMimeType || "application/octet-stream",
        byteSize: Number(row.attachmentByteSize || 0),
        url: await storageGetAccessUrl(row.attachmentStorageKey, FORUM_ATTACHMENT_URL_TTL_SECONDS).catch(error => {
          console.error("[forum] Failed to sign attachment access URL", {
            messageId: row.id,
            attachmentId: row.attachmentId,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        }),
      } : null,
    };
  }));
}

const forumMessagesPageInput = z.object({
  afterId: z.number().int().positive().optional(),
  beforeId: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).refine(input => !(input.afterId && input.beforeId), "afterId 与 beforeId 不能同时提供");

async function readMessagePage(
  db: Db,
  input: z.infer<typeof forumMessagesPageInput>,
  viewerUserId: number | null,
) {
  // Read the change cursor before the snapshot. Authenticated clients use it
  // to reconcile later moderation changes; guest clients receive the same
  // harmless cursor so both responses keep one stable shape.
  const [changeBaseline] = await db
    .select({ id: forumMessageChanges.id })
    .from(forumMessageChanges)
    .orderBy(desc(forumMessageChanges.id))
    .limit(1);
  const [personalChangeBaseline] = viewerUserId === null
    ? []
    : await db
      .select({ id: forumMessageUserVisibilityChanges.id })
      .from(forumMessageUserVisibilityChanges)
      .where(eq(forumMessageUserVisibilityChanges.userId, viewerUserId))
      .orderBy(desc(forumMessageUserVisibilityChanges.id))
      .limit(1);
  const where = and(
    isNull(forumMessages.deletedAt),
    viewerUserId === null ? undefined : visibleToForumViewer(viewerUserId),
    input.afterId ? gt(forumMessages.id, input.afterId) : undefined,
    input.beforeId ? lt(forumMessages.id, input.beforeId) : undefined,
  );
  const rows = await db
    .select({ id: forumMessages.id })
    .from(forumMessages)
    .where(where)
    .orderBy(input.afterId ? asc(forumMessages.id) : desc(forumMessages.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const selected = rows.slice(0, input.limit).map(row => row.id);
  if (!input.afterId) selected.reverse();
  return {
    messages: await hydrateMessages(db, selected, viewerUserId),
    hasMore,
    baselineChangeId: Number(changeBaseline?.id || 0),
    baselinePersonalChangeId: Number(personalChangeBaseline?.id || 0),
  };
}

export const forumRouter = router({
  /**
   * 游客只读消息流。未登录响应仅包含中性占位和分页状态，绝不返回
   * 历史自由文本、身份/联系方式、附件元数据或私有附件签名地址。
   * 认证用户经此公开入口访问时仍按原完整论坛合同返回内容。
   */
  publicMessages: publicProcedure
    .input(forumMessagesPageInput)
    .query(async ({ ctx, input }) => ctx.user
      ? readMessagePage(await requireDb(), input, ctx.user.id)
      : readMessagePage(await requireDb(), input, null)),

  // Public readers already see forum messages. Expose only withdrawal IDs, never
  // content, attachments, moderation events or user-specific visibility changes.
  publicWithdrawals: publicProcedure
    .input(z.object({
      afterChangeId: z.number().int().nonnegative(),
      limit: z.number().int().min(1).max(100).default(100),
      messageIds: z.array(z.number().int().positive()).max(100).default([]),
    }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select({ id: forumMessageChanges.id, messageId: forumMessageChanges.messageId, changeType: forumMessageChanges.changeType })
        .from(forumMessageChanges)
        // Scan a bounded PRIMARY KEY range and advance across moderation events
        // too, but never return their IDs/types. No new index or migration needed.
        .where(gt(forumMessageChanges.id, input.afterChangeId))
        .orderBy(asc(forumMessageChanges.id))
        .limit(input.limit + 1);
      const changes = rows.slice(0, input.limit);
      // Reconcile only explicitly loaded IDs. This also covers historical
      // withdrawals without an event and commits arriving behind the event cursor.
      // Missing and withdrawn IDs are indistinguishable: do not expose historical
      // existence/deletion metadata for arbitrary caller-supplied IDs.
      const available = input.messageIds.length ? await db
        .select({ messageId: forumMessages.id })
        .from(forumMessages)
        .where(and(
          inArray(forumMessages.id, Array.from(new Set(input.messageIds))),
          isNull(forumMessages.deletedAt),
        ))
        .limit(100) : [];
      const availableIds = new Set(available.map(message => Number(message.messageId)));
      return {
        messageIds: Array.from(new Set([
          ...changes.filter(change => change.changeType === "withdrawn").map(change => Number(change.messageId)),
          ...input.messageIds.filter(id => !availableIds.has(id)),
        ])),
        nextChangeId: Number(changes[changes.length - 1]?.id || input.afterChangeId),
        hasMore: rows.length > input.limit,
      };
    }),

  rules: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const state = await postingState(db, ctx.user.id);
    return {
      title: FORUM_RULE_TITLE,
      version: FORUM_RULE_VERSION,
      content: FORUM_RULE_CONTENT,
      accepted: state.accepted,
      muted: state.muted,
      mutedUntil: state.mutedUntil,
      muteReason: state.muteReason,
    };
  }),

  acceptRules: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await requireDb();
    await db.insert(forumRulesAcceptances).values({
      userId: ctx.user.id,
      ruleVersion: FORUM_RULE_VERSION,
      ipAddress: clientIp(ctx.req as never),
      userAgent: String(ctx.req?.headers?.["user-agent"] || "").slice(0, 512) || null,
    }).onDuplicateKeyUpdate({ set: { acceptedAt: new Date() } });
    return { accepted: true as const, version: FORUM_RULE_VERSION };
  }),

  preferences: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const [settings] = await db
      .select({
        groupNickname: forumUserSettings.groupNickname,
        notificationMode: forumUserSettings.notificationMode,
        notificationsMuted: forumUserSettings.notificationsMuted,
      })
      .from(forumUserSettings)
      .where(eq(forumUserSettings.userId, ctx.user.id))
      .limit(1);
    const notificationMode = effectiveNotificationMode(settings?.notificationMode, settings?.notificationsMuted);
    return {
      groupNickname: settings?.groupNickname ?? null,
      notificationMode,
      notificationsMuted: notificationMode === "muted",
    };
  }),

  updatePreferences: protectedProcedure
    .input(z.object({
      groupNickname: z.string().trim().max(32, "群昵称最长32个字符").nullable().optional(),
      notificationMode: z.enum(["all", "mentions", "muted"]).optional(),
      notificationsMuted: z.boolean().optional(),
    }).refine(
      input => input.groupNickname !== undefined
        || input.notificationMode !== undefined
        || input.notificationsMuted !== undefined,
      "至少提供一项论坛设置",
    ).refine(
      input => input.notificationMode === undefined
        || input.notificationsMuted === undefined
        || (input.notificationMode === "muted") === input.notificationsMuted,
      "notificationMode与notificationsMuted语义不一致",
    ))
    .mutation(async ({ ctx, input }) => {
      validateForumGroupNickname(input.groupNickname);
      const db = await requireDb();
      const groupNickname = input.groupNickname === undefined
        ? undefined
        : (input.groupNickname || null);
      const requestedNotificationMode = input.notificationMode
        ?? (input.notificationsMuted === undefined ? undefined : (input.notificationsMuted ? "muted" : "all"));
      return db.transaction(async tx => {
        const [lockedUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1)
          .for("update");
        if (!lockedUser) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "用户不存在，请重新登录" });
        }
        const [existingSettings] = await tx
          .select({ id: forumUserSettings.id })
          .from(forumUserSettings)
          .where(eq(forumUserSettings.userId, ctx.user.id))
          .limit(1);
        let initialLastReadMessageId = 0;
        if (!existingSettings) {
          const [maxVisible] = await tx
            .select({ id: sql<number>`COALESCE(MAX(${forumMessages.id}), 0)` })
            .from(forumMessages)
            .where(and(
              eq(forumMessages.isHidden, false),
              isNull(forumMessages.deletedAt),
            ));
          initialLastReadMessageId = Number(maxVisible?.id || 0);
        }
        await tx.insert(forumUserSettings).values({
          userId: ctx.user.id,
          groupNickname: groupNickname ?? null,
          notificationMode: requestedNotificationMode ?? "all",
          notificationsMuted: requestedNotificationMode === "muted",
          lastReadMessageId: initialLastReadMessageId,
        }).onDuplicateKeyUpdate({
          set: {
            groupNickname: groupNickname === undefined
              ? sql`${forumUserSettings.groupNickname}`
              : groupNickname,
            notificationMode: requestedNotificationMode === undefined
              ? sql`${forumUserSettings.notificationMode}`
              : requestedNotificationMode,
            // Keep the legacy boolean in lockstep during rolling deploys/rollback. A
            // nickname-only update must preserve it rather than resetting the user.
            notificationsMuted: requestedNotificationMode === undefined
              ? sql`${forumUserSettings.notificationsMuted}`
              : requestedNotificationMode === "muted",
          },
        });
        const [settings] = await tx
          .select({
            groupNickname: forumUserSettings.groupNickname,
            notificationMode: forumUserSettings.notificationMode,
            notificationsMuted: forumUserSettings.notificationsMuted,
          })
          .from(forumUserSettings)
          .where(eq(forumUserSettings.userId, ctx.user.id))
          .limit(1);
        const notificationMode = effectiveNotificationMode(settings?.notificationMode, settings?.notificationsMuted);
        return {
          groupNickname: settings?.groupNickname ?? null,
          notificationMode,
          notificationsMuted: notificationMode === "muted",
        };
      });
    }),

  messages: protectedProcedure
    .input(forumMessagesPageInput)
    .query(async ({ ctx, input }) => readMessagePage(await requireDb(), input, ctx.user.id)),

  messageHead: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const [[latestVisible], [latestChange], [latestPersonalChange], [readReceipt]] = await Promise.all([
      db
        .select({ id: forumMessages.id })
        .from(forumMessages)
        .where(and(isNull(forumMessages.deletedAt), visibleToForumViewer(ctx.user.id)))
        .orderBy(desc(forumMessages.id))
        .limit(1),
      db
        .select({ id: forumMessageChanges.id })
        .from(forumMessageChanges)
        .orderBy(desc(forumMessageChanges.id))
        .limit(1),
      db
        .select({ id: forumMessageUserVisibilityChanges.id })
        .from(forumMessageUserVisibilityChanges)
        .where(eq(forumMessageUserVisibilityChanges.userId, ctx.user.id))
        .orderBy(desc(forumMessageUserVisibilityChanges.id))
        .limit(1),
      db
        .select({ version: forumReadReceiptState.revision })
        .from(forumReadReceiptState)
        .where(eq(forumReadReceiptState.id, 1))
        .limit(1),
    ]);
    return {
      latestMessageId: Number(latestVisible?.id || 0),
      latestChangeId: Number(latestChange?.id || 0),
      latestPersonalChangeId: Number(latestPersonalChange?.id || 0),
      readReceiptVersion: String(readReceipt?.version || "0"),
    };
  }),

  readCounts: protectedProcedure
    .input(z.object({ messageIds: z.array(z.number().int().positive()).min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const visibleRows = await db
        .select({ id: forumMessages.id })
        .from(forumMessages)
        .where(and(inArray(forumMessages.id, input.messageIds), visibleToForumViewer(ctx.user.id)));
      const rows = await forumMessageReadCounts(db, visibleRows.map(row => row.id));
      return rows.map(row => ({
        messageId: row.messageId,
        readCount: Number(row.readCount || 0),
      }));
    }),

  messageChanges: protectedProcedure
    .input(z.object({
      afterChangeId: z.number().int().nonnegative(),
      limit: z.number().int().min(1).max(100).default(100),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db
        .select({
          id: forumMessageChanges.id,
          messageId: forumMessageChanges.messageId,
          changeType: forumMessageChanges.changeType,
          userHiddenId: forumMessageUserHidden.id,
        })
        .from(forumMessageChanges)
        .innerJoin(forumMessages, eq(forumMessages.id, forumMessageChanges.messageId))
        .leftJoin(forumMessageUserHidden, and(
          eq(forumMessageUserHidden.messageId, forumMessages.id),
          eq(forumMessageUserHidden.userId, ctx.user.id),
        ))
        .where(gt(forumMessageChanges.id, input.afterChangeId))
        .orderBy(asc(forumMessageChanges.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const scanned = rows.slice(0, input.limit);
      const nextChangeId = Number(scanned[scanned.length - 1]?.id || input.afterChangeId);
      // Advance across every global change, but never expose a personally hidden
      // message in the returned change list or hydrated payload.
      const changes = scanned
        .filter(change => change.userHiddenId === null)
        .map(({ userHiddenId: _userHiddenId, ...change }) => change);
      const messageIds = Array.from(new Set(changes.map(change => change.messageId)));
      return {
        changes,
        messages: await hydrateMessages(db, messageIds, ctx.user.id),
        nextChangeId,
        hasMore,
      };
    }),

  personalMessageChanges: protectedProcedure
    .input(z.object({
      afterChangeId: z.number().int().nonnegative(),
      limit: z.number().int().min(1).max(100).default(100),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const rows = await db
        .select({
          id: forumMessageUserVisibilityChanges.id,
          messageId: forumMessageUserVisibilityChanges.messageId,
          changeType: forumMessageUserVisibilityChanges.changeType,
        })
        .from(forumMessageUserVisibilityChanges)
        .where(and(
          eq(forumMessageUserVisibilityChanges.userId, ctx.user.id),
          gt(forumMessageUserVisibilityChanges.id, input.afterChangeId),
        ))
        .orderBy(asc(forumMessageUserVisibilityChanges.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const changes = rows.slice(0, input.limit);
      const restoredIds = Array.from(new Set(changes
        .filter(change => change.changeType === "restored")
        .map(change => change.messageId)));
      return {
        changes,
        messages: await hydrateMessages(db, restoredIds, ctx.user.id),
        nextChangeId: Number(changes[changes.length - 1]?.id || input.afterChangeId),
        hasMore,
      };
    }),

  searchMessages: protectedProcedure
    .input(z.object({
      query: z.string().trim().min(2).max(64),
      range: z.enum(["7d", "30d", "all"]).default("all"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const pattern = `%${input.query}%`;
      const since = input.range === "7d"
        ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000)
        : input.range === "30d"
          ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000)
          : undefined;
      const rows = await db
        .select({ id: forumMessages.id })
        .from(forumMessages)
        .innerJoin(users, eq(users.id, forumMessages.userId))
        .leftJoin(forumUserSettings, eq(forumUserSettings.userId, users.id))
        .leftJoin(enterpriseMembers, and(
          eq(enterpriseMembers.userId, users.id),
          eq(enterpriseMembers.status, "active"),
        ))
        .leftJoin(enterprises, eq(enterprises.id, enterpriseMembers.enterpriseId))
        .where(and(
          eq(forumMessages.isHidden, false),
          isNull(forumMessages.deletedAt),
          visibleToForumViewer(ctx.user.id),
          since ? gte(forumMessages.createdAt, since) : undefined,
          or(
            sql<boolean>`COALESCE(${forumMessages.content}, '') LIKE ${pattern}`,
            likeSafe(forumUserSettings.groupNickname, pattern),
            likeSafe(users.name, pattern),
            likeSafe(users.username, pattern),
            likeSafe(enterprises.companyName, pattern),
          ),
        ))
        .orderBy(desc(forumMessages.id))
        .limit(50);
      const messages = await hydrateMessages(db, rows.map(row => row.id), ctx.user.id);
      return { messages: messages.reverse() };
    }),

  messageContext: protectedProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const visibleCondition = and(
        isNull(forumMessages.deletedAt),
        visibleToForumViewer(ctx.user.id),
      );
      const [target] = await db
        .select({ id: forumMessages.id })
        .from(forumMessages)
        .where(and(
          eq(forumMessages.id, input.messageId),
          eq(forumMessages.isHidden, false),
          visibleCondition,
        ))
        .limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "该消息已不可查看" });

      const beforeRows = await db
        .select({ id: forumMessages.id })
        .from(forumMessages)
        .where(and(visibleCondition, lte(forumMessages.id, input.messageId)))
        .orderBy(desc(forumMessages.id))
        .limit(26);
      const afterRows = await db
        .select({ id: forumMessages.id })
        .from(forumMessages)
        .where(and(visibleCondition, gt(forumMessages.id, input.messageId)))
        .orderBy(asc(forumMessages.id))
        .limit(25);
      const messageIds = [
        ...beforeRows.map(row => row.id).reverse(),
        ...afterRows.map(row => row.id),
      ];
      const firstMessageId = messageIds[0] ?? input.messageId;
      const [older] = await db
        .select({ id: forumMessages.id })
        .from(forumMessages)
        .where(and(visibleCondition, lt(forumMessages.id, firstMessageId)))
        .limit(1);
      return {
        targetId: input.messageId,
        messages: await hydrateMessages(db, messageIds, ctx.user.id),
        hasOlder: Boolean(older),
      };
    }),

  followedUsers: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db
      .select({
        id: users.id,
        userId: users.id,
        groupNickname: forumUserSettings.groupNickname,
        userName: users.name,
        username: users.username,
        avatarUrl: users.avatarUrl,
        jobTitle: users.jobTitle,
        enterpriseId: enterprises.id,
        companyName: enterprises.companyName,
      })
      .from(forumFollowedUsers)
      .innerJoin(users, eq(users.id, forumFollowedUsers.followedUserId))
      .leftJoin(forumUserSettings, eq(forumUserSettings.userId, users.id))
      .leftJoin(enterpriseMembers, and(
        eq(enterpriseMembers.userId, users.id),
        eq(enterpriseMembers.status, "active"),
      ))
      .leftJoin(enterprises, eq(enterprises.id, enterpriseMembers.enterpriseId))
      .where(and(
        eq(forumFollowedUsers.followerUserId, ctx.user.id),
        eq(users.loginDisabled, false),
      ))
      .orderBy(desc(forumFollowedUsers.id))
      .then(rows => rows.map(row => ({
        id: row.id,
        userId: row.userId,
        name: memberDisplayName(row.groupNickname, row.userName, row.username, row.id),
        username: row.username || null,
        avatarUrl: row.avatarUrl || null,
        companyName: row.enterpriseId === null ? null : (row.companyName?.trim() || null),
        jobTitle: row.jobTitle?.trim() || null,
        isErpMember: row.enterpriseId !== null,
      })));
  }),

  memberProfile: protectedProcedure
    .input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const [target] = await db
        .select({
          userId: users.id,
          userName: users.name,
          username: users.username,
          phone: users.phone,
          wechatId: users.wechatId,
          qqId: users.qqId,
          email: users.email,
          avatarUrl: users.avatarUrl,
          jobTitle: users.jobTitle,
          groupNickname: forumUserSettings.groupNickname,
          enterpriseId: enterprises.id,
          companyName: enterprises.companyName,
          crmDataOwnerUserId: enterprises.crmDataOwnerUserId,
          followedId: forumFollowedUsers.id,
        })
        .from(users)
        .leftJoin(forumUserSettings, eq(forumUserSettings.userId, users.id))
        .leftJoin(enterpriseMembers, and(
          eq(enterpriseMembers.userId, users.id),
          eq(enterpriseMembers.status, "active"),
        ))
        .leftJoin(enterprises, eq(enterprises.id, enterpriseMembers.enterpriseId))
        .leftJoin(forumFollowedUsers, and(
          eq(forumFollowedUsers.followerUserId, ctx.user.id),
          eq(forumFollowedUsers.followedUserId, users.id),
        ))
        .where(and(
          eq(users.id, input.userId),
          eq(users.loginDisabled, false),
        ))
        .limit(1);
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "论坛成员不存在或账号已停用" });
      }

      const isErpMember = target.enterpriseId !== null;
      const inventoryCondition = isErpMember
        ? eq(inventories.enterpriseId, target.enterpriseId!)
        : eq(inventories.userId, target.userId);
      const inventoryCountPromise = db
        .select({ inventoryCount: sql<number>`COUNT(*)` })
        .from(inventories)
        .where(and(
          inventoryCondition,
          eq(inventories.status, "published"),
          gt(inventories.qtyOnSale, 0),
          companyCatalogVisibleCondition(),
        ));
      const publicCompanyProfilePromise = isErpMember && target.crmDataOwnerUserId !== null
        ? getPublicCompanyProfile(target.crmDataOwnerUserId)
        : Promise.resolve(null);
      const viewerUserId = ctx.user.id;
      const user1Id = Math.min(viewerUserId, target.userId);
      const user2Id = Math.max(viewerUserId, target.userId);
      const directConversationPromise = viewerUserId === target.userId
        ? Promise.resolve([] as Array<{ id: number }>)
        : db
            .select({ id: conversations.id })
            .from(conversations)
            .where(and(
              eq(conversations.user1Id, user1Id),
              eq(conversations.user2Id, user2Id),
            ))
            .limit(1);
      const [[inventorySummary], publicCompanyProfile, directConversations] = await Promise.all([
        inventoryCountPromise,
        publicCompanyProfilePromise,
        directConversationPromise,
      ]);
      const directConversation = directConversations[0] ?? null;

      return {
        name: memberDisplayName(target.groupNickname, target.userName, target.username, target.userId),
        avatarUrl: target.avatarUrl || null,
        companyName: isErpMember ? (target.companyName?.trim() || null) : null,
        jobTitle: target.jobTitle?.trim() || null,
        isErpMember,
        inventoryCount: Number(inventorySummary?.inventoryCount ?? 0),
        companySupplierId: publicCompanyProfile ? target.crmDataOwnerUserId : null,
        followed: target.followedId !== null,
        // 51论坛定位为行业商务交流社区；已登录成员可直接查看用户主动
        // 维护的联系方式，以便询价和交易沟通。未填写字段统一返回 null。
        contact: {
          phone: target.phone?.trim() || null,
          wechatId: target.wechatId?.trim() || null,
          qqId: target.qqId?.trim() || null,
          email: target.email?.trim() || null,
        },
        contactAccess: "available" as const,
        conversationId: directConversation?.id ?? null,
      };
    }),

  setFollowedUser: protectedProcedure
    .input(z.object({ userId: z.number().int().positive(), followed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能关注自己" });
      }
      const db = await requireDb();
      if (input.followed) {
        await db.transaction(async tx => {
          const [target] = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, input.userId), eq(users.loginDisabled, false)))
            .limit(1)
            .for("update");
          if (!target) {
            throw new TRPCError({ code: "NOT_FOUND", message: "关注成员不存在或账号已停用" });
          }
          await tx.insert(forumFollowedUsers).values({
            followerUserId: ctx.user.id,
            followedUserId: input.userId,
          }).onDuplicateKeyUpdate({ set: { followedUserId: input.userId } });
        });
      } else {
        await db.delete(forumFollowedUsers).where(and(
          eq(forumFollowedUsers.followerUserId, ctx.user.id),
          eq(forumFollowedUsers.followedUserId, input.userId),
        ));
      }
      return { userId: input.userId, followed: input.followed };
    }),

  unreadState: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    return db.transaction(async tx => {
      // Serialize first-time initialization for a user, so a concurrent request
      // cannot advance the baseline past messages created after the first baseline.
      const [lockedUser] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1)
        .for("update");
      if (!lockedUser) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "用户不存在，请重新登录" });
      }

      // Keep the mini-program chat-list summary in this existing request. The
      // predicate intentionally mirrors unread visibility: no personal deletion,
      // administrator-hidden message, or withdrawn message can become a preview.
      const [latestVisibleMessage] = await tx
        .select({
          id: forumMessages.id,
          userId: forumMessages.userId,
          messageType: forumMessages.messageType,
          content: forumMessages.content,
          createdAt: forumMessages.createdAt,
          senderName: users.name,
          senderUsername: users.username,
          senderGroupNickname: forumUserSettings.groupNickname,
        })
        .from(forumMessages)
        .innerJoin(users, eq(users.id, forumMessages.userId))
        .leftJoin(forumUserSettings, eq(forumUserSettings.userId, forumMessages.userId))
        .where(and(
          eq(forumMessages.isHidden, false),
          isNull(forumMessages.deletedAt),
          visibleToForumViewer(ctx.user.id),
        ))
        .orderBy(desc(forumMessages.id))
        .limit(1);
      const latestMessage = latestVisibleMessage
        ? {
          id: latestVisibleMessage.id,
          senderName: memberDisplayName(
            latestVisibleMessage.senderGroupNickname,
            latestVisibleMessage.senderName,
            latestVisibleMessage.senderUsername,
            latestVisibleMessage.userId,
          ),
          messageType: latestVisibleMessage.messageType,
          preview: forumLatestMessagePreview(latestVisibleMessage.messageType, latestVisibleMessage.content),
          createdAt: latestVisibleMessage.createdAt,
        }
        : null;

      const [settings] = await tx
        .select({
          lastReadMessageId: forumUserSettings.lastReadMessageId,
          notificationMode: forumUserSettings.notificationMode,
          notificationsMuted: forumUserSettings.notificationsMuted,
        })
        .from(forumUserSettings)
        .where(eq(forumUserSettings.userId, ctx.user.id))
        .limit(1);

      if (!settings) {
        const [maxVisible] = await tx
          .select({ id: sql<number>`COALESCE(MAX(${forumMessages.id}), 0)` })
          .from(forumMessages)
          .where(and(
            eq(forumMessages.isHidden, false),
            isNull(forumMessages.deletedAt),
            visibleToForumViewer(ctx.user.id),
          ));
        const lastReadMessageId = Number(maxVisible?.id || 0);
        await tx.insert(forumUserSettings).values({
          userId: ctx.user.id,
          lastReadMessageId,
        });
        return {
          unreadCount: 0,
          notificationMode: "all" as const,
          notificationsMuted: false,
          lastReadMessageId,
          latestMessage,
        };
      }

      const lastReadMessageId = Number(settings.lastReadMessageId || 0);
      const notificationMode = effectiveNotificationMode(settings.notificationMode, settings.notificationsMuted);
      if (notificationMode === "muted") {
        return { unreadCount: 0, notificationMode, notificationsMuted: true, lastReadMessageId, latestMessage };
      }
      const [unread] = await tx
        .select({
          count: notificationMode === "mentions"
            ? sql<number>`COUNT(DISTINCT ${forumMessages.id})`
            : sql<number>`COUNT(*)`,
        })
        .from(forumMessages)
        .leftJoin(
          forumMessageMentions,
          notificationMode === "mentions"
            ? and(
              eq(forumMessageMentions.messageId, forumMessages.id),
              eq(forumMessageMentions.mentionedUserId, ctx.user.id),
            )
            : sql`FALSE`,
        )
        .where(and(
          gt(forumMessages.id, lastReadMessageId),
          ne(forumMessages.userId, ctx.user.id),
          eq(forumMessages.isHidden, false),
          isNull(forumMessages.deletedAt),
          visibleToForumViewer(ctx.user.id),
          notificationMode === "mentions"
            ? eq(forumMessageMentions.mentionedUserId, ctx.user.id)
            : undefined,
        ));
      return {
        unreadCount: Number(unread?.count || 0),
        notificationMode,
        notificationsMuted: false,
        lastReadMessageId,
        latestMessage,
      };
    });
  }),

  markRead: protectedProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      return db.transaction(async tx => {
        const [lockedUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1)
          .for("update");
        if (!lockedUser) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "用户不存在，请重新登录" });
        }
        const [maxVisible] = await tx
          .select({ id: sql<number>`COALESCE(MAX(${forumMessages.id}), 0)` })
          .from(forumMessages)
          .where(and(
            eq(forumMessages.isHidden, false),
            isNull(forumMessages.deletedAt),
            visibleToForumViewer(ctx.user.id),
          ));
        const boundedMessageId = Math.min(input.messageId, Number(maxVisible?.id || 0));
        const [previousSettings] = await tx
          .select({ lastViewedMessageId: forumUserSettings.lastViewedMessageId })
          .from(forumUserSettings)
          .where(eq(forumUserSettings.userId, ctx.user.id))
          .limit(1);
        const readReceiptAdvanced = boundedMessageId > Number(previousSettings?.lastViewedMessageId || 0);
        await tx.insert(forumUserSettings).values({
          userId: ctx.user.id,
          lastReadMessageId: boundedMessageId,
          lastViewedMessageId: boundedMessageId,
        }).onDuplicateKeyUpdate({
          set: {
            lastReadMessageId: sql`GREATEST(${forumUserSettings.lastReadMessageId}, ${boundedMessageId})`,
            lastViewedMessageId: sql`GREATEST(${forumUserSettings.lastViewedMessageId}, ${boundedMessageId})`,
          },
        });
        if (readReceiptAdvanced) {
          await tx.insert(forumReadReceiptState).values({
            id: 1,
            revision: 1,
          }).onDuplicateKeyUpdate({
            set: { revision: sql`${forumReadReceiptState.revision} + 1` },
          });
        }
        const [settings] = await tx
          .select({
            lastReadMessageId: forumUserSettings.lastReadMessageId,
            lastViewedMessageId: forumUserSettings.lastViewedMessageId,
          })
          .from(forumUserSettings)
          .where(eq(forumUserSettings.userId, ctx.user.id))
          .limit(1);
        return {
          lastReadMessageId: Number(settings?.lastReadMessageId || 0),
          lastViewedMessageId: Number(settings?.lastViewedMessageId || 0),
        };
      });
    }),

  searchUsers: protectedProcedure
    .input(z.object({ query: z.string().trim().max(64), limit: z.number().int().min(1).max(20).default(10) }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const selection = {
        id: users.id,
        groupNickname: forumUserSettings.groupNickname,
        userName: users.name,
        username: users.username,
        avatarUrl: users.avatarUrl,
        jobTitle: users.jobTitle,
        enterpriseId: enterprises.id,
        companyName: enterprises.companyName,
      };
      const mapRows = (rows: Array<{
        id: number;
        groupNickname: string | null;
        userName: string | null;
        username: string | null;
        avatarUrl: string | null;
        jobTitle: string | null;
        enterpriseId: number | null;
        companyName: string | null;
      }>) => rows.map(row => ({
        id: row.id,
        name: memberDisplayName(row.groupNickname, row.userName, row.username, row.id),
        username: row.username || null,
        avatarUrl: row.avatarUrl || null,
        companyName: row.enterpriseId === null ? null : (row.companyName?.trim() || null),
        jobTitle: row.jobTitle?.trim() || null,
        isErpMember: row.enterpriseId !== null,
      }));

      if (!input.query) {
        const recentForumMembers = db
          .select({
            userId: forumMessages.userId,
            latestMessageId: sql<number>`MAX(${forumMessages.id})`.as("latestMessageId"),
          })
          .from(forumMessages)
          .where(and(
            eq(forumMessages.isHidden, false),
            isNull(forumMessages.deletedAt),
          ))
          .groupBy(forumMessages.userId)
          .as("recent_forum_members");
        const rows = await db
          .select(selection)
          .from(recentForumMembers)
          .innerJoin(users, eq(users.id, recentForumMembers.userId))
          .leftJoin(forumUserSettings, eq(forumUserSettings.userId, users.id))
          .leftJoin(enterpriseMembers, and(
            eq(enterpriseMembers.userId, users.id),
            eq(enterpriseMembers.status, "active"),
          ))
          .leftJoin(enterprises, eq(enterprises.id, enterpriseMembers.enterpriseId))
          .where(and(
            ne(users.id, ctx.user.id),
            eq(users.loginDisabled, false),
          ))
          .orderBy(desc(recentForumMembers.latestMessageId))
          .limit(input.limit);
        return mapRows(rows);
      }

      const pattern = `%${input.query}%`;
      const rows = await db
        .select(selection)
        .from(users)
        .leftJoin(forumUserSettings, eq(forumUserSettings.userId, users.id))
        .leftJoin(enterpriseMembers, and(
          eq(enterpriseMembers.userId, users.id),
          eq(enterpriseMembers.status, "active"),
        ))
        .leftJoin(enterprises, eq(enterprises.id, enterpriseMembers.enterpriseId))
        .where(and(
          ne(users.id, ctx.user.id),
          eq(users.loginDisabled, false),
          or(
            likeSafe(forumUserSettings.groupNickname, pattern),
            likeSafe(users.name, pattern),
            likeSafe(users.username, pattern),
            sql<boolean>`COALESCE(${users.jobTitle}, '') LIKE ${pattern}`,
            likeSafe(enterprises.companyName, pattern),
          ),
        ))
        .orderBy(desc(users.lastSignedIn))
        .limit(input.limit);
      return mapRows(rows);
    }),

  attachmentUrl: protectedProcedure
    .input(z.object({ attachmentId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const [attachment] = await db
        .select({ storageKey: forumAttachments.storageKey })
        .from(forumAttachments)
        .innerJoin(forumMessages, eq(forumMessages.attachmentId, forumAttachments.id))
        .where(and(
          eq(forumAttachments.id, input.attachmentId),
          eq(forumMessages.isHidden, false),
          isNull(forumMessages.deletedAt),
          visibleToForumViewer(ctx.user.id),
        ))
        .limit(1);
      if (!attachment) throw new TRPCError({ code: "NOT_FOUND", message: "附件不存在或已被隐藏" });
      return { url: await storageGetAccessUrl(attachment.storageKey, FORUM_ATTACHMENT_URL_TTL_SECONDS) };
    }),

  hideMessageForMe: protectedProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      return db.transaction(async tx => {
        const now = new Date();
        const undoToken = randomUUID();
        const undoExpiresAtMs = now.getTime() + FORUM_PERSONAL_DELETE_UNDO_WINDOW_SECONDS * 1_000;
        const [message] = await tx
          .select({ id: forumMessages.id })
          .from(forumMessages)
          .where(eq(forumMessages.id, input.messageId))
          .limit(1)
          .for("update");
        if (!message) {
          throw new TRPCError({ code: "NOT_FOUND", message: "消息不存在" });
        }
        await tx.insert(forumMessageUserHidden).values({
          userId: ctx.user.id,
          messageId: message.id,
          restoreToken: undoToken,
          undoExpiresAtMs,
          hiddenAt: now,
        }).onDuplicateKeyUpdate({
          set: { restoreToken: undoToken, undoExpiresAtMs, hiddenAt: now },
        });
        const insertedChange = await tx.insert(forumMessageUserVisibilityChanges).values({
          userId: ctx.user.id,
          messageId: message.id,
          changeType: "hidden",
        }).$returningId();
        return {
          messageId: message.id,
          hidden: true as const,
          undoToken,
          undoExpiresAtMs,
          personalChangeId: Number(insertedChange[0]?.id || 0),
        };
      });
    }),

  restoreMessageForMe: protectedProcedure
    .input(z.object({
      messageId: z.number().int().positive(),
      undoToken: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      return db.transaction(async tx => {
        const [hidden] = await tx
          .select({
            id: forumMessageUserHidden.id,
            undoExpiresAtMs: forumMessageUserHidden.undoExpiresAtMs,
          })
          .from(forumMessageUserHidden)
          .where(and(
            eq(forumMessageUserHidden.userId, ctx.user.id),
            eq(forumMessageUserHidden.messageId, input.messageId),
            eq(forumMessageUserHidden.restoreToken, input.undoToken),
          ))
          .limit(1)
          .for("update");
        if (
          !hidden?.undoExpiresAtMs
          || Date.now() > hidden.undoExpiresAtMs
        ) {
          throw new TRPCError({ code: "FORBIDDEN", message: "撤销时间已过，请重新加载论坛" });
        }
        const [message] = await tx
          .select({
            id: forumMessages.id,
            isHidden: forumMessages.isHidden,
            deletedAt: forumMessages.deletedAt,
          })
          .from(forumMessages)
          .where(eq(forumMessages.id, input.messageId))
          .limit(1)
          .for("update");
        if (!message || message.isHidden || message.deletedAt) {
          throw new TRPCError({ code: "NOT_FOUND", message: "原消息已撤回或不可用" });
        }
        await tx.delete(forumMessageUserHidden).where(and(
          eq(forumMessageUserHidden.id, hidden.id),
          eq(forumMessageUserHidden.userId, ctx.user.id),
          eq(forumMessageUserHidden.messageId, message.id),
          eq(forumMessageUserHidden.restoreToken, input.undoToken),
        ));
        const insertedChange = await tx.insert(forumMessageUserVisibilityChanges).values({
          userId: ctx.user.id,
          messageId: message.id,
          changeType: "restored",
        }).$returningId();
        return {
          messageId: message.id,
          restored: true as const,
          personalChangeId: Number(insertedChange[0]?.id || 0),
        };
      });
    }),

  withdrawMessage: protectedProcedure
    .input(z.object({ messageId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const withdrawn = await db.transaction(async tx => {
        const [message] = await tx
          .select({
            id: forumMessages.id,
            userId: forumMessages.userId,
            isHidden: forumMessages.isHidden,
            deletedAt: forumMessages.deletedAt,
            createdAt: forumMessages.createdAt,
            storageKey: forumAttachments.storageKey,
          })
          .from(forumMessages)
          .leftJoin(forumAttachments, eq(forumAttachments.id, forumMessages.attachmentId))
          .where(eq(forumMessages.id, input.messageId))
          .limit(1)
          .for("update");
        if (!message) {
          throw new TRPCError({ code: "NOT_FOUND", message: "消息不存在" });
        }
        if (message.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "只能撤回自己发送的消息" });
        }
        if (message.isHidden) {
          throw new TRPCError({ code: "CONFLICT", message: "消息已被管理员隐藏，无法撤回" });
        }
        if (message.deletedAt) {
          throw new TRPCError({ code: "CONFLICT", message: "消息已撤回" });
        }
        const now = new Date();
        if (now.getTime() - message.createdAt.getTime() > FORUM_WITHDRAW_WINDOW_SECONDS * 1000) {
          throw new TRPCError({ code: "FORBIDDEN", message: "消息已超过2分钟，无法撤回" });
        }
        await tx.update(forumMessages).set({
          deletedAt: now,
          deletedByUserId: ctx.user.id,
        }).where(and(
          eq(forumMessages.id, input.messageId),
          eq(forumMessages.userId, ctx.user.id),
          eq(forumMessages.isHidden, false),
          isNull(forumMessages.deletedAt),
        ));
        await tx.update(forumSupplierQuotes).set({ isActive: false }).where(
          eq(forumSupplierQuotes.messageId, message.id),
        );
        await tx.insert(forumMessageChanges).values({
          messageId: message.id,
          changeType: "withdrawn",
        });
        return { messageId: message.id, storageKey: message.storageKey ?? null, deletedAt: now };
      });
      if (withdrawn.storageKey) {
        await storageDelete(withdrawn.storageKey).catch(error => {
          console.error("[Forum] Failed to remove withdrawn private attachment", {
            messageId: withdrawn.messageId,
            storageKey: withdrawn.storageKey,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        });
      }
      return { messageId: withdrawn.messageId, withdrawn: true as const, deletedAt: withdrawn.deletedAt };
    }),

  sendMessage: protectedProcedure
    .input(z.object({
      clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).default(() => randomUUID()),
      messageType: z.enum(["text", "sticker", "image", "file"]),
      // Structured mention tokens add protocol metadata beyond the 2000 visible characters.
      content: z.string().max(6000).default(""),
      attachment: forumAttachmentInput.optional(),
      mentionUserIds: z.array(z.number().int().positive()).max(20).default([]),
      replyToMessageId: z.number().int().positive().optional(),
      reportShare: z.object({
        reportSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,127}$/),
        note: z.string().max(300).default(""),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const requestedReportShare = input.reportShare;
      const submittedContent = input.content.trim();
      if (requestedReportShare && (
        input.messageType !== "text"
        || Boolean(submittedContent)
        || Boolean(input.attachment)
        || input.mentionUserIds.length > 0
        || input.replyToMessageId !== undefined
      )) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "行情报告转发参数不能与普通消息内容混用" });
      }
      if (input.replyToMessageId !== undefined && (
        input.messageType !== "text"
        || Boolean(input.attachment)
      )) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "仅普通文字消息可以引用" });
      }
      if (!requestedReportShare && startsWithForumReportSharePrefix(submittedContent)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不能通过普通文字伪造行情报告卡片" });
      }
      const sanitizedReportNote = requestedReportShare
        ? maskForbiddenWords(requestedReportShare.note.trim(), { preserveCategories: ["contact"] })
        : "";
      const parsedMentionContent = requestedReportShare
        ? { parts: [] as ParsedMentionPart[], mentions: [], visibleContent: "" }
        : validateMentionEnvelope(
          input.messageType,
          submittedContent,
          input.mentionUserIds,
          ctx.user.id,
        );
      let content = input.messageType === "text"
        ? parsedMentionContent.parts.map(part => part.kind === "mention"
          ? part.value
          : maskForbiddenWords(part.value, { preserveCategories: ["contact"] })).join("")
        : submittedContent;
      if (input.messageType === "text" && !requestedReportShare) {
        if (!parsedMentionContent.visibleContent.trim()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "消息内容不能为空" });
        }
        if (parsedMentionContent.visibleContent.length > 2000) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "消息内容不能超过2000个字符" });
        }
      }
      if (input.messageType === "sticker" && !Object.prototype.hasOwnProperty.call(CHAT_STICKER_LABELS, content)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "不支持的论坛表情" });
      }
      const isAttachmentMessage = input.messageType === "image" || input.messageType === "file";
      if (isAttachmentMessage !== Boolean(input.attachment) || (input.attachment && input.attachment.kind !== input.messageType)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "附件消息参数不完整" });
      }
      let decodedAttachment: Awaited<ReturnType<typeof decodeAndScanForumAttachment>> | null = null;
      if (input.attachment) {
        const preflight = await postingState(db, ctx.user.id);
        if (!preflight.accepted) {
          throw new TRPCError({ code: "FORBIDDEN", message: "请先确认《51电子网论坛公约》后再发言" });
        }
        if (preflight.muted) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `你已被禁言至 ${preflight.mutedUntil!.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}${preflight.muteReason ? `，原因：${preflight.muteReason}` : ""}`,
          });
        }
        if (forumAttachmentScansInFlight.has(ctx.user.id)) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "已有附件正在安全扫描，请稍后再试" });
        }
        if (forumAttachmentScansInFlight.size >= 1) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "附件安全扫描繁忙，请稍后再试" });
        }
        forumAttachmentScansInFlight.add(ctx.user.id);
        try {
          decodedAttachment = await decodeAndScanForumAttachment(input.attachment);
        } finally {
          forumAttachmentScansInFlight.delete(ctx.user.id);
        }
      }
      let storedKey: string | null = null;
      let result: { id: number; deduplicated: boolean };
      try {
        result = await db.transaction(async tx => {
        const [lockedUser] = await tx
          .select({
            id: users.id,
            mutedUntil: users.forumMutedUntil,
            muteReason: users.forumMuteReason,
          })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1)
          .for("update");
        if (!lockedUser) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "用户不存在，请重新登录" });
        }
        const [acceptance] = await tx
          .select({ id: forumRulesAcceptances.id })
          .from(forumRulesAcceptances)
          .where(and(
            eq(forumRulesAcceptances.userId, ctx.user.id),
            eq(forumRulesAcceptances.ruleVersion, FORUM_RULE_VERSION),
          ))
          .limit(1);
        if (!acceptance) {
          throw new TRPCError({ code: "FORBIDDEN", message: "请先确认《51电子网论坛公约》后再发言" });
        }
        if (lockedUser.mutedUntil && lockedUser.mutedUntil.getTime() > Date.now()) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `你已被禁言至 ${lockedUser.mutedUntil.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}${lockedUser.muteReason ? `，原因：${lockedUser.muteReason}` : ""}`,
          });
        }

        const [existing] = await tx
          .select({
            id: forumMessages.id,
            messageType: forumMessages.messageType,
            content: forumMessages.content,
            attachmentId: forumMessages.attachmentId,
            replyToMessageId: forumMessages.replyToMessageId,
          })
          .from(forumMessages)
          .where(and(
            eq(forumMessages.userId, ctx.user.id),
            eq(forumMessages.clientMessageId, input.clientMessageId),
          ))
          .limit(1)
          .for("update");
        if (existing) {
          const existingReportShare = requestedReportShare
            ? parseSharedReportContent(existing.content || "")
            : null;
          const sameRequest = requestedReportShare
            ? existing.messageType === "text"
              && !existing.attachmentId
              && existingReportShare?.slug === requestedReportShare.reportSlug
              && existingReportShare.note === sanitizedReportNote
            : existing.messageType === input.messageType
              && (existing.content || "") === content
              && Boolean(existing.attachmentId) === Boolean(decodedAttachment)
              && (existing.replyToMessageId ?? null) === (input.replyToMessageId ?? null);
          if (!sameRequest) {
            throw new TRPCError({ code: "CONFLICT", message: "消息幂等键与原请求不一致" });
          }
          return { id: existing.id, deduplicated: true };
        }

        // Freeze only this authenticated actor's verified selected identity. Replay
        // returns above without backfilling historical messages or re-enqueuing jobs.
        const authorIdentity = input.messageType === "text"
          ? await resolveActorBusinessIdentity(tx, ctx.user.id)
          : null;

        if (requestedReportShare) {
          const [report] = await tx
            .select({ slug: marketReports.slug, title: marketReports.title })
            .from(marketReports)
            .where(and(
              eq(marketReports.slug, requestedReportShare.reportSlug),
              eq(marketReports.status, "published"),
            ))
            .limit(1)
            .for("update");
          if (!report) {
            throw new TRPCError({ code: "NOT_FOUND", message: "行情报告不存在或已下线" });
          }
          content = encodeSharedReportContent(report, sanitizedReportNote);
          if (content.length > 2000) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "行情报告分享内容不能超过2000个字符" });
          }
        }

        if (input.replyToMessageId !== undefined) {
          const [replyTarget] = await tx
            .select({
              id: forumMessages.id,
              isHidden: forumMessages.isHidden,
              deletedAt: forumMessages.deletedAt,
              userHiddenId: forumMessageUserHidden.id,
            })
            .from(forumMessages)
            .leftJoin(forumMessageUserHidden, and(
              eq(forumMessageUserHidden.messageId, forumMessages.id),
              eq(forumMessageUserHidden.userId, ctx.user.id),
            ))
            .where(eq(forumMessages.id, input.replyToMessageId))
            .limit(1)
            .for("update");
          if (!replyTarget || replyTarget.isHidden || replyTarget.deletedAt || replyTarget.userHiddenId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "引用的消息不存在或当前不可用" });
          }
        }

        const minuteAgo = new Date(Date.now() - 60_000);
        const [rate] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(forumMessages)
          .where(and(eq(forumMessages.userId, ctx.user.id), gte(forumMessages.createdAt, minuteAgo)));
        if (Number(rate?.count || 0) >= FORUM_RATE_LIMIT_PER_MINUTE) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "发言过于频繁，请稍后再试" });
        }
        if (decodedAttachment) {
          const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const [attachmentUsage] = await tx
            .select({
              dailyCount: sql<number>`count(*)`,
              dailyBytes: sql<number>`COALESCE(SUM(${forumAttachments.byteSize}), 0)`,
              recentCount: sql<number>`SUM(CASE WHEN ${forumAttachments.createdAt} >= ${minuteAgo} THEN 1 ELSE 0 END)`,
            })
            .from(forumAttachments)
            .where(and(
              eq(forumAttachments.uploaderUserId, ctx.user.id),
              gte(forumAttachments.createdAt, dayAgo),
            ));
          if (Number(attachmentUsage?.recentCount || 0) >= FORUM_ATTACHMENT_LIMIT_PER_MINUTE) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "附件发送过于频繁，请稍后再试" });
          }
          if (Number(attachmentUsage?.dailyCount || 0) >= FORUM_ATTACHMENT_LIMIT_PER_DAY) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "今日附件发送数量已达上限" });
          }
          if (Number(attachmentUsage?.dailyBytes || 0) + decodedAttachment.byteSize > FORUM_ATTACHMENT_BYTES_PER_DAY) {
            throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "今日附件发送容量已达上限" });
          }
        }
        if (input.messageType === "text" || input.messageType === "sticker") {
          const duplicateSince = new Date(Date.now() - FORUM_DUPLICATE_WINDOW_SECONDS * 1000);
          const [duplicate] = await tx
            .select({ id: forumMessages.id })
            .from(forumMessages)
            .where(and(
              eq(forumMessages.userId, ctx.user.id),
              eq(forumMessages.messageType, input.messageType),
              eq(forumMessages.content, content),
              input.replyToMessageId === undefined
                ? isNull(forumMessages.replyToMessageId)
                : eq(forumMessages.replyToMessageId, input.replyToMessageId),
              gte(forumMessages.createdAt, duplicateSince),
            ))
            .limit(1);
          if (duplicate) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "请勿短时间重复发送相同内容" });
        }

        const mentionIds = uniqueMentionUserIds(parsedMentionContent.mentions);
        if (mentionIds.length) {
          const validUsers = await tx
            .select({
              id: users.id,
              name: users.name,
              username: users.username,
              groupNickname: forumUserSettings.groupNickname,
            })
            .from(users)
            .leftJoin(forumUserSettings, eq(forumUserSettings.userId, users.id))
            .where(and(inArray(users.id, mentionIds), eq(users.loginDisabled, false)));
          if (validUsers.length !== mentionIds.length) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "部分被提及用户不存在或不可用" });
          }
          const authoritativeLabels = new Map(validUsers.map(user => [
            user.id,
            memberDisplayName(user.groupNickname, user.name, user.username, user.id),
          ]));
          if (parsedMentionContent.mentions.some(mention => authoritativeLabels.get(mention.userId) !== mention.label)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "被提及用户显示名已变化，请重新选择" });
          }
        }

        let attachmentId: number | null = null;
        if (input.attachment && decodedAttachment) {
          const relKey = `forum-attachments/${ctx.user.id}/${decodedAttachment.objectName}`;
          const stored = await storagePutPrivate(relKey, decodedAttachment.buffer, decodedAttachment.mimeType);
          storedKey = stored.key;
          const attachmentRows = await tx.insert(forumAttachments).values({
            uploaderUserId: ctx.user.id,
            kind: input.attachment.kind,
            storageKey: stored.key,
            originalName: decodedAttachment.originalName,
            mimeType: decodedAttachment.mimeType,
            byteSize: decodedAttachment.byteSize,
            sha256: decodedAttachment.sha256,
          }).$returningId();
          attachmentId = Number(attachmentRows[0]?.id || 0);
          if (!attachmentId) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "附件记录写入失败" });
          }
        }

        const inserted = await tx.insert(forumMessages).values({
          userId: ctx.user.id,
          authorEnterpriseId: authorIdentity?.enterpriseId ?? null,
          authorCompanyId: authorIdentity?.companyId ?? null,
          authorCompanyNameSnapshot: authorIdentity?.companyName ?? null,
          clientMessageId: input.clientMessageId,
          messageType: input.messageType,
          content: content || null,
          attachmentId,
          replyToMessageId: input.replyToMessageId ?? null,
        }).$returningId();
        const id = Number(inserted[0]?.id || 0);
        if (!id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "论坛消息写入失败" });
        if (input.messageType === "text" && authorIdentity?.enterpriseId !== null && authorIdentity?.enterpriseId !== undefined) {
          await tx.insert(forumQuoteJobs).values({
            messageId: id,
            enterpriseId: authorIdentity.enterpriseId,
          });
        }
        if (attachmentId) {
          await tx.update(forumAttachments).set({ claimedMessageId: id }).where(eq(forumAttachments.id, attachmentId));
        }
        if (mentionIds.length) {
          await tx.insert(forumMessageMentions).values(mentionIds.map(mentionedUserId => ({
            messageId: id,
            mentionedUserId,
          })));
        }
        return { id, deduplicated: false };
        });
      } catch (error) {
        if (storedKey) {
          await storageDelete(storedKey).catch(cleanupError => {
            console.error("[Forum] Failed to remove rolled-back private attachment", {
              storageKey: storedKey,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            });
            return false;
          });
        }
        throw error;
      }
      const [message] = await hydrateMessages(db, [result.id], ctx.user.id);
      if (!message) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "论坛消息读取失败" });
      return { message, deduplicated: result.deduplicated };
    }),
});

/** Drizzle 的 like() 不接受 nullable 列类型差异时，用 SQL COALESCE 保持查询参数化。 */
function likeSafe(
  column:
    | typeof forumUserSettings.groupNickname
    | typeof users.name
    | typeof users.username
    | typeof enterprises.companyName,
  pattern: string,
) {
  return sql<boolean>`COALESCE(${column}, '') LIKE ${pattern}`;
}

export type ForumMessageKind = MessageKind;
