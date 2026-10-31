import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { storageGetAccessUrl, storagePutPrivate } from "../storage";
import { enqueueChatSyncEvent } from "../services/chatSyncOutbox";
import {
  decodeChatAttachment,
  MAX_CHAT_ATTACHMENT_BASE64,
} from "../services/chatAttachments";
import {
  ensureGreetingMessage,
  getServiceUserId,
  isServiceConversation,
  submitAdminComplaint,
  submitAdminOnboardingLead,
  submitAdminZhuomuniaoCooperationLead,
} from "../services/customerService";
import { resolveCrmTargetForUser } from "../services/enterpriseAccess";
import { formatBeijingDateCompact } from "../../../shared/beijingTime";
import {
  displayInquiryPartNumber,
  normalizeInquiryPartNumber,
} from "../../../shared/inquiryGrouping";
import {
  mergeConversationGroupMemberStats,
  type ConversationGroupMemberSource,
} from "../../../shared/conversationGroupMerge";
import {
  INQUIRY_QUANTITY_UNIT,
  inquiryQuantityText,
  storedInquiryQuantity,
} from "../../../shared/inquiryQuantity";
import {
  resolveChatContactConversationCompanyContext,
  getChatContactInventory,
  getChatContactProfile,
} from "../services/chatContactPublicProfile";
import { resolveInventoryInquiryRecipient } from "../services/enterpriseBusinessHandoff";
import {
  actorIdentityContextKey,
  orderedConversationParties,
  conversationIdentityContextKey,
  type BusinessIdentity,
  type ConversationParty,
  conversationIdentityScopeSql,
  resolveActorBusinessIdentity,
  resolveConversationCounterpartyIdentity,
  type ChatSqlExecutor,
} from "../services/actorBusinessIdentity";
import { getOrCreateBusinessConversation } from "../services/businessConversation";
import {
  chatTransitionFindForConversation,
  chatTransitionResolveRead,
  chatTransitionResolveWrite,
  chatTransitionPendingListScopeSql,
  chatTransitionCanonicalizeListEntries,
  chatTransitionGetState,
  chatTransitionConfirmIdentity,
  attachmentConversationForActor,
  requireConversationContact,
  requireScopedConversation,
  resolveChatEntry,
  resolveLockedTransitionCanonicalAlias,
  runWithReadyWeappConversationScope,
} from "../services/chatConversationIdentity";

import { chatContactLabels } from "../../../shared/chatContactLabels";
import { getEnterpriseRequestContextForActor } from "../services/enterpriseRequestContext";
import {
  accountSupportConversationIds,
  getOrCreateAccountSupportConversation,
  resolveAccountSupportConversation,
} from "../services/accountSupportConversation";
import {
  resolveAccountSupportView,
  accountSupportIdsSql,
  supportSendIdentity,
  isWeappDefaultAccountSupportCompatibility,
  accountSupportDisplayedScopeIds,
  accountSupportMessageInViewSql,
  accountSupportMessageScopeIdSql,
  accountSupportMessageInDisplayedScopesSql,
  accountSupportMessageAfterViewDeleteSql,
  accountSupportAttachmentInDisplayedScopesSql,
} from "../services/accountSupportMessageScope";
import {
  isLegacyChatPreactivationCompatibilityEnabled,
  canWriteLegacyDirectConversationPreactivation,
} from "../services/legacyChatPreactivationCompatibility";

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库不可用",
    });
  return db;
}

async function conversationBlockState(
  db: ChatSqlExecutor,
  viewerUserId: number,
  conversationId: number,
  contactUserId: number
) {
  const result = await db.execute(sql`
    SELECT blockerUserId
      FROM chat_user_blocks
     WHERE conversationId = ${conversationId}
       AND (
         (blockerUserId = ${viewerUserId} AND blockedUserId = ${contactUserId})
         OR
         (blockerUserId = ${contactUserId} AND blockedUserId = ${viewerUserId})
       )
  `);
  const rows = (
    result as unknown as [Array<{ blockerUserId: number }>, unknown]
  )[0];
  return {
    blockedByMe: rows.some(row => Number(row.blockerUserId) === viewerUserId),
    blockedByContact: rows.some(
      row => Number(row.blockerUserId) === contactUserId
    ),
  };
}

async function assertConversationNotBlocked(
  db: ChatSqlExecutor,
  viewerUserId: number,
  conversationId: number,
  contactUserId: number
) {
  const state = await conversationBlockState(
    db,
    viewerUserId,
    conversationId,
    contactUserId
  );
  if (state.blockedByMe || state.blockedByContact) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "该会话已被屏蔽，不能发送消息",
    });
  }
}

/**
 * 产生评价资格所需的本轮最少消息数。
 *
 * 阈值存在的目的是防刷分：单方发一句“在吗”就能给对方打分时，
 * 评价就失去参考价值。同时还要求 distinctSenderCount >= 2，
 * 否则自己连发 3 条也能触发。
 */
const MIN_RATING_MESSAGE_COUNT = 3;

/** 普通用户消息允许在发送后十分钟内撤回；系统与业务通知卡片不可撤回。 */
export const CHAT_MESSAGE_RECALL_WINDOW_SECONDS = 10 * 60;
const RECALLABLE_CHAT_MESSAGE_TYPES = [
  "text",
  "quote",
  "sticker",
  "image",
  "file",
] as const;

/**
 * 平台内置 51 机器人表情白名单。
 *
 * 表情消息只保存稳定 ID，不允许客户端提交 URL 或任意 JSON，
 * 避免在官方聊天窗口中注入外部图片、钓鱼链接或未审核内容。
 */
export const CHAT_STICKER_LABELS = {
  "noto-grinning": "开心笑脸",
  "noto-beaming": "露齿笑",
  "noto-joy-tears": "笑哭",
  "noto-smiley": "开怀笑",
  "noto-smile": "微笑",
  "noto-sweat-smile": "流汗笑",
  "noto-laugh": "大笑",
  "noto-wink": "眨眼",
  "noto-blush": "害羞",
  "noto-smiling-hearts": "幸福",
  "noto-heart-eyes": "爱心眼",
  "noto-kiss": "飞吻",
  "noto-cool": "酷",
  "noto-party": "庆祝脸",
  "noto-thinking": "思考",
  "noto-raised-eyebrow": "挑眉",
  "noto-neutral": "平静",
  "noto-expressionless": "无语",
  "noto-no-mouth": "沉默",
  "noto-smirk": "得意",
  "noto-unamused": "不满",
  "noto-eye-roll": "白眼",
  "noto-shushing": "嘘",
  "noto-hugging": "拥抱",
  "noto-sad": "难过",
  "noto-worried": "担心",
  "noto-frown": "不开心",
  "noto-anguished": "苦恼",
  "noto-fearful": "害怕",
  "noto-scream": "尖叫",
  "noto-angry": "生气",
  "noto-rage": "愤怒",
  "noto-weary": "疲惫",
  "noto-loudly-crying": "大哭",
  "noto-pleading": "拜托脸",
  "noto-thumb-up": "点赞",
  "noto-thumb-down": "不赞同",
  "noto-ok-hand": "OK",
  "noto-clap": "鼓掌",
  "noto-handshake": "握手",
  "noto-folded-hands": "拜托",
  "noto-wave": "挥手",
  "noto-victory": "胜利",
  "noto-flexed-biceps": "加油",
  "noto-red-heart": "爱心",
  "noto-fire": "火",
  "noto-hundred": "满分",
  "noto-party-popper": "庆祝",
  "noto-relieved": "放心",
  "noto-sleepy": "困倦",
  "noto-sleeping": "睡觉",
  "noto-dizzy-face": "晕",
  "noto-medical-mask": "口罩",
  "noto-thermometer": "发烧",
  "noto-nauseated": "难受",
  "noto-flushed": "脸红",
  "noto-grimacing": "尴尬",
  "noto-lying": "说谎",
  "noto-angel": "天使",
  "noto-smiling-horns": "小恶魔",
  "noto-robot": "机器人",
  "noto-exploding-head": "震惊",
  "noto-raised-hand": "举手",
  "noto-raised-back-hand": "手背举手",
  "noto-crossed-fingers": "好运",
  "noto-love-you-gesture": "爱你",
  "noto-horns": "摇滚",
  "noto-call-me": "联系我",
  "noto-fist": "拳头",
  "noto-oncoming-fist": "碰拳",
  "noto-left-fist": "左碰拳",
  "noto-right-fist": "右碰拳",
  "noto-raising-hands": "欢呼",
  "noto-open-hands": "张开双手",
  "noto-check-mark": "已完成",
  "noto-cross-mark": "未通过",
  "noto-warning": "警告",
  "noto-information": "信息",
  "noto-alarm-clock": "提醒",
  "noto-hourglass": "等待",
  "noto-package": "包裹",
  "noto-delivery-truck": "配送",
  "noto-envelope": "邮件",
  "noto-mobile-phone": "手机",
  "noto-telephone": "电话",
  "noto-magnifying-glass": "搜索",
  "noto-light-bulb": "灵感",
  "noto-bell": "通知",
  "noto-calendar": "日历",
  "noto-locked": "已锁定",
  "noto-money-bag": "资金",
  "noto-gift": "礼物",
  "noto-trophy": "奖杯",
  "noto-rocket": "启动",
  "noto-star": "星标",
  "noto-sparkles": "闪亮",
  "emoji-smile": "微笑",
  "emoji-laugh": "大笑",
  "emoji-joy": "笑哭",
  "emoji-playful": "调皮",
  "emoji-wink": "眨眼",
  "emoji-shy": "害羞",
  "emoji-heart-eyes": "爱心眼",
  "emoji-kiss": "亲亲",
  "emoji-proud": "得意",
  "emoji-cool": "酷",
  "emoji-question": "疑问",
  "emoji-thinking": "思考",
  "emoji-awkward": "尴尬",
  "emoji-speechless": "无语",
  "emoji-eye-roll": "白眼",
  "emoji-sweat": "流汗",
  "emoji-sad": "难过",
  "emoji-cry": "哭泣",
  "emoji-sob": "大哭",
  "emoji-angry": "生气",
  "emoji-rage": "抓狂",
  "emoji-shocked": "震惊",
  "emoji-sleepy": "困倦",
  "emoji-dizzy": "晕了",
  "emoji-thumb-up": "点赞",
  "emoji-ok": "OK",
  "emoji-clap": "鼓掌",
  "emoji-handshake": "握手",
  "emoji-please": "拜托",
  "emoji-cheer": "加油",
  "emoji-salute": "敬礼",
  "emoji-bye": "再见",
  "yayatuan-hi": "嗨",
  "yayatuan-received": "收到",
  "yayatuan-okay": "好哒",
  "yayatuan-thanks": "谢谢",
  "yayatuan-hardwork": "辛苦啦",
  "yayatuan-cheer": "加油",
  "yayatuan-hug": "抱抱",
  "yayatuan-amazing": "太棒啦",
  "yayatuan-wronged": "委屈",
  "yayatuan-angry": "生气啦",
  "yayatuan-shocked": "震惊",
  "yayatuan-goodnight": "晚安",
  received: "收到",
  "quote-now": "马上报价",
  thanks: "感谢合作",
  "inventory-check": "库存确认中",
  "please-wait": "请稍等",
  shipped: "已发货",
  "happy-cooperation": "合作愉快",
  "holiday-greeting": "节日问候",
  "v2-received": "新·收到",
  "v2-checking": "新·正在查",
  "v2-thanks": "新·辛苦了",
  "stock-radar": "新·有货吗",
  "v2-wait": "新·请稍等",
  "close-loop": "新·闭个环",
  "v2-shipped": "新·已发货",
  progress: "新·推进中",
} as const;

function getStickerLabel(stickerId: string): string | null {
  return Object.prototype.hasOwnProperty.call(CHAT_STICKER_LABELS, stickerId)
    ? CHAT_STICKER_LABELS[stickerId as keyof typeof CHAT_STICKER_LABELS]
    : null;
}

/** 报价单卡片消息的 JSON 结构 */
export interface QuoteContent {
  partNumber: string;
  brand: string;
  qty: number;
  unit: string;
  price: number; // 含税单价（全站价格口径统一为含税）
  inventoryId?: number;
}

type ConversationRow = {
  id: number;
  user1Id: number;
  user2Id: number;
  lastMessageAt: Date;
  lastMessagePreview: string | null;
  createdAt: Date;
};

type SettingsRow = {
  id: number;
  conversationId: number;
  userId: number;
  pinned: number; // tinyint
  remarkName: string | null;
  groupName: string | null;
  unreadCount: number;
  deleted: number;
  lastReadAt: Date;
  lastReadMessageId: number | null;
};

type MessageRow = {
  id: number;
  conversationId: number;
  senderId: number;
  /** 客户端幂等键；历史消息可为 null */
  clientMessageId?: string | null;
  msgType:
    | "text"
    | "quote"
    | "sticker"
    | "image"
    | "file"
    | "inquiry"
    | "greeting"
    | "transfer_notice"
    | "handoff_notice";
  content: string;
  replyToMessageId: number | null;
  recalledAt: Date | null;
  recalledByUserId: number | null;
  createdAt: Date;
};

type MessageWithReplyRow = MessageRow & {
  quotedSenderId: number | null;
  quotedMsgType: MessageRow["msgType"] | null;
  quotedContent: string | null;
  quotedRecalledAt: Date | null;
  quotedHiddenId: number | null;
};

type GroupRow = {
  id: number;
  userId: number;
  ownerIdentityContextKey: string;
  groupName: string;
  groupType: "manual" | "inquiry";
  status: "active" | "trashed";
  autoAssign: number;
  memberCount: number;
  unreadCount: number;
  partNumbers: string | null;
  createdAt: Date;
};

/** Explicit raw-SQL row contracts: every restored projection remains checked by strict TS. */
type ChatPairRow = { id: number; user1Id: number; user2Id: number };
type ChatCurrentConversationRow = ChatPairRow & {
  currentRound: number | null;
  endedAt: Date | null;
  user1EnterpriseId: number | null;
  user2EnterpriseId: number | null;
};
type ChatAttachmentRow = {
  id: number;
  conversationId: number;
  uploaderUserId: number;
  kind: "image" | "file";
  storageKey: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  supportEnterpriseId: number | null;
};
type ChatConversationListRow = {
  id: number;
  identityContextKey: string | null;
  user1Id: number;
  user2Id: number;
  currentRound: number | null;
  endedAt: Date | null;
  endedByUserId: number | null;
  lastMessageAt: Date;
  lastMessagePreview: string | null;
  pinned: number;
  remarkName: string | null;
  groupName: string | null;
  groupIds: string | null;
  unreadCount: number;
  isSharedAccountHistory: number;
  legacyConversationId: number | null;
  legacyTransitionId: number | null;
  hasCurrentMessages: number | null;
  isIdentityTransition: number;
  requiresIdentityConfirmation: number;
  frozenSenderCompanyName: string | null;
  otherUserId: number;
  otherUserName: string | null;
  otherUsername: string | null;
  otherUserAvatar: string | null;
  otherCompanyName: string | null;
  otherCompanyProfileSupplierId: number | null;
  otherCompanyProfileCompanyId: number | null;
};
function requireResolvedChatScope<T>(scope: T | null): T {
  if (scope === null)
    throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
  return scope;
}

function chatSqlRows<Row>(result: unknown): Row[] {
  return (result as [Row[], unknown])[0];
}

function chatCompanySafeAlias(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))
    throw new Error("unsafe public inventory SQL alias");
  return alias;
}
function conversationPublicCompanyJoinSql(
  conversationAlias = "c",
  peerUserAlias = "u",
  companyAlias = "comp"
) {
  const conversation = chatCompanySafeAlias(conversationAlias);
  const peer = chatCompanySafeAlias(peerUserAlias);
  const company2 = chatCompanySafeAlias(companyAlias);
  return sql.raw(`LEFT JOIN companies ${company2} ON ${company2}.id = CASE
    WHEN EXISTS (SELECT 1 FROM inventory_inquiries ctx_evidence
      WHERE ctx_evidence.conversationId = ${conversation}.id
        AND (ctx_evidence.sellerUserId = ${peer}.id OR ctx_evidence.assigneeUserId = ${peer}.id))
    THEN (SELECT CASE
      WHEN COUNT(*) > 0
        AND COUNT(ctx_b.companyId) = COUNT(*)
        AND COUNT(DISTINCT ctx_b.companyId) = 1
        AND SUM(CASE WHEN ctx_bound_company.id IS NOT NULL AND (
          (ctx_i.enterpriseId IS NULL
            AND ctx_bound_company.userId = ctx_i.sellerUserId)
          OR (ctx_i.enterpriseId IS NOT NULL
            AND ctx_enterprise.crmDataOwnerUserId = ctx_i.sellerUserId
            AND ctx_bound_company.userId = ctx_enterprise.crmDataOwnerUserId
            AND (ctx_bound_company.enterpriseId = ctx_i.enterpriseId OR ctx_bound_company.enterpriseId IS NULL))
        ) THEN 1 ELSE 0 END) = COUNT(*)
      THEN MIN(ctx_b.companyId) ELSE NULL END
      FROM inventory_inquiries ctx_i
      LEFT JOIN public_inventory_company_bindings ctx_b ON ctx_b.inventoryId = ctx_i.inventoryId
      LEFT JOIN companies ctx_bound_company ON ctx_bound_company.id = ctx_b.companyId
      LEFT JOIN enterprises ctx_enterprise ON ctx_enterprise.id = ctx_i.enterpriseId
      WHERE ctx_i.conversationId = ${conversation}.id
        AND (ctx_i.sellerUserId = ${peer}.id OR ctx_i.assigneeUserId = ${peer}.id))
    ELSE (SELECT CASE
      WHEN COUNT(*) = 1
        AND MIN(ctx_c.createdAt) IS NOT NULL
        AND ${conversation}.createdAt IS NOT NULL
        AND MIN(ctx_c.createdAt) <= ${conversation}.createdAt
      THEN MIN(ctx_c.id) ELSE NULL END
      FROM companies ctx_c
      WHERE ctx_c.userId = ${peer}.id)
    END`);
}

/** Core L aliases need the same exact closeout proof as list/contact/settings aliases.
 * Do not use a global middleware: P/F read source sets remain owned by ResolveRead/Write.
 * Official support and formal conversations bypass this lookup entirely.
 */
async function resolveChatTransitionCoreConversationId(
  executor: ChatSqlExecutor,
  actorUserId: number,
  requestedConversationId: number,
  serviceUserId: number
): Promise<number> {
  const legacyRows = chatSqlRows<ChatPairRow>(
    await executor.execute(sql`
    SELECT id, user1Id, user2Id FROM conversations
     WHERE id = ${requestedConversationId}
       AND (user1Id = ${actorUserId} OR user2Id = ${actorUserId})
       AND (identityContextKey = 'legacy' OR identityContextKey IS NULL)
       AND user1Id <> ${serviceUserId} AND user2Id <> ${serviceUserId}
     LIMIT 1
  `)
  );
  if (!legacyRows[0]) return requestedConversationId;
  const alias = await resolveLockedTransitionCanonicalAlias(
    executor,
    actorUserId,
    requestedConversationId
  );
  return alias?.canonicalConversationId ?? requestedConversationId;
}

async function countDisplayedSupportUnread(
  db: ChatSqlExecutor,
  accountUserId: number,
  serviceUserId: number,
  sourceIds: readonly number[],
  enterpriseId: number | null
) {
  if (!sourceIds.length) return 0;
  const scopeIds =
    enterpriseId !== null && enterpriseId > 0 ? [enterpriseId, 0] : [0];
  const counts = await Promise.all(
    scopeIds.map(async scopeEnterpriseId => {
      const result = (await db.execute(sql`
      SELECT COUNT(*) AS total FROM messages support_messages
      INNER JOIN conversations support_source ON support_source.id = support_messages.conversationId
      LEFT JOIN account_support_view_settings support_settings
        ON support_settings.userId = ${accountUserId}
       AND support_settings.scopeEnterpriseId = ${scopeEnterpriseId}
      WHERE support_messages.conversationId IN (${accountSupportIdsSql(sourceIds)})
        AND support_messages.senderId <> ${accountUserId}
        AND ${accountSupportMessageInViewSql("support_messages", "support_source", accountUserId, serviceUserId, scopeEnterpriseId)}
        AND support_messages.id > COALESCE(support_settings.lastReadMessageId, 0)
        AND support_messages.id > COALESCE(support_settings.deletedBeforeMessageId, 0)
        AND NOT EXISTS (
          SELECT 1 FROM chat_message_user_hidden hidden
          WHERE hidden.messageId = support_messages.id AND hidden.userId = ${accountUserId}
        )
    `)) as unknown as [{ total: number }[], unknown];
      return Math.max(0, Number(result[0][0]?.total ?? 0));
    })
  );
  return counts.reduce((sum, count2) => sum + count2, 0);
}

function participantSnapshot(
  userId: number,
  identity: BusinessIdentity
): ConversationParty {
  return {
    userId,
    enterpriseId: identity.enterpriseId,
    companyId: identity.companyId,
    companyName: identity.companyName,
    displayName: identity.displayName,
  };
}
function groupIdentityScopeSql(
  alias: string,
  userId: number,
  identity: BusinessIdentity
) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias))
    throw new Error("unsafe group SQL alias");
  const table = sql.raw(alias);
  const currentContextKey = actorIdentityContextKey(userId, identity);
  if (identity.enterpriseId === null) {
    return sql`(
      ${table}.ownerIdentityContextKey = ${currentContextKey}
      OR ${table}.ownerIdentityContextKey = 'legacy'
    )`;
  }
  return sql`${table}.ownerIdentityContextKey = ${currentContextKey}`;
}

function readableGroupIdentityScopeSql(
  alias: string,
  userId: number,
  identity: BusinessIdentity
) {
  const ownedScope = groupIdentityScopeSql(alias, userId, identity);
  if (identity.enterpriseId !== null) return ownedScope;
  const table = sql.raw(alias);
  return sql`(${ownedScope} OR ${table}.ownerIdentityContextKey = 'legacy')`;
}
function inquiryGroupRuleKey(
  ownerIdentityContextKey: string,
  normalized: string
) {
  if (ownerIdentityContextKey === "legacy") return normalized;
  return `scope:${createHash("sha256")
    .update(JSON.stringify([ownerIdentityContextKey, normalized]))
    .digest("hex")}`;
}
async function uniqueInquiryGroupName(
  db: ChatSqlExecutor,
  userId: number,
  ownerIdentityContextKey: string,
  preferred: string
) {
  const base = preferred.slice(0, 64) || "询价分组";
  for (let suffix = 1; suffix <= 1e3; suffix += 1) {
    const marker = suffix === 1 ? "" : ` · ${suffix}`;
    const candidate = `${base.slice(0, Math.max(1, 64 - marker.length))}${marker}`;
    const existing = (await db.execute(sql`
      SELECT id FROM conversation_groups
       WHERE userId = ${userId}
         AND ownerIdentityContextKey = ${ownerIdentityContextKey}
         AND groupName = ${candidate}
       LIMIT 1
    `)) as unknown as [{ id: number }[], unknown];
    const rows = existing[0];
    if (!rows[0]) return candidate;
  }
  throw new TRPCError({
    code: "CONFLICT",
    message: "询价分组名称冲突，请稍后重试",
  });
}
async function autoGroupInventoryInquiry(
  tx: ChatSqlExecutor,
  input: {
    userId: number;
    ownerIdentityContextKey: string;
    conversationId: number;
    messageId: number;
    partNumber: string;
  }
) {
  const partNumber = displayInquiryPartNumber(input.partNumber);
  const normalized = normalizeInquiryPartNumber(partNumber);
  if (!normalized) return null;
  const ruleKey = inquiryGroupRuleKey(
    input.ownerIdentityContextKey,
    normalized
  );
  await tx.execute(
    sql`SELECT id FROM users WHERE id = ${input.userId} LIMIT 1 FOR UPDATE`
  );
  const ruleResult = (await tx.execute(sql`
    SELECT r.groupId, g.status, g.trashedAt
      FROM conversation_group_part_rules r
      INNER JOIN conversation_groups g
        ON g.id = r.groupId AND g.userId = r.userId
       AND g.ownerIdentityContextKey = ${input.ownerIdentityContextKey}
     WHERE r.userId = ${input.userId}
       AND r.partNumberNormalized IN (${ruleKey}, ${normalized})
     ORDER BY (r.partNumberNormalized = ${ruleKey}) DESC
     LIMIT 1
     FOR UPDATE
  `)) as unknown as [
    { groupId: number; status: "active" | "trashed"; trashedAt: Date | null }[],
    unknown,
  ];
  const ruleRows = ruleResult[0];
  if (ruleRows[0]?.status === "trashed") {
    const expiresAt = ruleRows[0].trashedAt
      ? new Date(ruleRows[0].trashedAt).getTime() + 30 * 24 * 60 * 60 * 1e3
      : Number.POSITIVE_INFINITY;
    if (expiresAt > Date.now()) return null;
    const expiredGroupId = Number(ruleRows[0].groupId);
    await tx.execute(
      sql`DELETE FROM conversation_group_members WHERE groupId = ${expiredGroupId} AND userId = ${input.userId}`
    );
    await tx.execute(
      sql`DELETE FROM conversation_group_part_rules WHERE groupId = ${expiredGroupId} AND userId = ${input.userId}`
    );
    await tx.execute(sql`
      DELETE FROM conversation_groups
       WHERE id = ${expiredGroupId}
         AND userId = ${input.userId}
         AND ownerIdentityContextKey = ${input.ownerIdentityContextKey}
         AND status = 'trashed'
    `);
    ruleRows.length = 0;
  }
  let groupId = Number(ruleRows[0]?.groupId ?? 0);
  const historyResult = (await tx.execute(sql`
    SELECT conversationId,
           MIN(messageId) AS firstMessageId,
           MAX(messageId) AS lastMessageId,
           COUNT(*) AS inquiryCount
      FROM inventory_inquiries
     WHERE buyerUserId = ${input.userId}
       AND buyerIdentityContextKey = ${input.ownerIdentityContextKey}
       AND partNumberNormalized = ${normalized}
     GROUP BY conversationId
  `)) as unknown as [
    {
      conversationId: number;
      firstMessageId: number;
      lastMessageId: number;
      inquiryCount: number;
    }[],
    unknown,
  ];
  const historyRows = historyResult[0];
  if (!groupId && historyRows.length < 2) return null;
  if (!groupId) {
    const groupName = await uniqueInquiryGroupName(
      tx,
      input.userId,
      input.ownerIdentityContextKey,
      partNumber
    );
    await tx.execute(sql`
      INSERT INTO conversation_groups (userId, ownerIdentityContextKey, groupName, groupType, status, autoAssign)
      VALUES (${input.userId}, ${input.ownerIdentityContextKey}, ${groupName}, 'inquiry', 'active', 1)
    `);
    const insertedResult = (await tx.execute(
      sql`SELECT LAST_INSERT_ID() AS id`
    )) as unknown as [{ id: number }[], unknown];
    groupId = Number(insertedResult[0][0]?.id ?? 0);
    if (!groupId) throw new Error("自动询价分组创建失败");
    await tx.execute(sql`
      INSERT INTO conversation_group_part_rules
        (groupId, userId, partNumber, partNumberNormalized)
      VALUES (${groupId}, ${input.userId}, ${partNumber}, ${ruleKey})
    `);
  }
  for (const row of historyRows) {
    await tx.execute(sql`
      INSERT INTO conversation_group_members
        (groupId, userId, conversationId, source,
         firstInquiryMessageId, lastInquiryMessageId, inquiryCount)
      VALUES
        (${groupId}, ${input.userId}, ${Number(row.conversationId)}, 'inquiry_auto',
         ${Number(row.firstMessageId)}, ${Number(row.lastMessageId)}, ${Number(row.inquiryCount)})
      ON DUPLICATE KEY UPDATE
        firstInquiryMessageId = CASE
          WHEN firstInquiryMessageId IS NULL THEN VALUES(firstInquiryMessageId)
          ELSE LEAST(firstInquiryMessageId, VALUES(firstInquiryMessageId))
        END,
        lastInquiryMessageId = GREATEST(COALESCE(lastInquiryMessageId, 0), VALUES(lastInquiryMessageId)),
        inquiryCount = GREATEST(inquiryCount, VALUES(inquiryCount))
    `);
  }
  return groupId;
}
async function assertUserPairNotBlocked(
  db: ChatSqlExecutor,
  firstUserId: number,
  secondUserId: number
) {
  const result = (await db.execute(sql`
    SELECT blockerUserId
      FROM chat_user_blocks
     WHERE (blockerUserId = ${firstUserId} AND blockedUserId = ${secondUserId})
        OR (blockerUserId = ${secondUserId} AND blockedUserId = ${firstUserId})
     LIMIT 1
  `)) as unknown as [{ blockerUserId: number }[], unknown];
  const rows = result[0];
  if (rows.length) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "该会话已被屏蔽，不能发送消息",
    });
  }
}
function visibleConversationScopeSql(
  alias: string,
  actorUserId: number,
  identity: BusinessIdentity
) {
  return conversationIdentityScopeSql(alias, actorUserId, identity);
}

async function getOrCreateFrozenBusinessConversation(
  db: ChatSqlExecutor,
  left: ConversationParty,
  right: ConversationParty
) {
  const [first, second] = orderedConversationParties(left, right);
  const identityContextKey = conversationIdentityContextKey(first, second);
  const conversationId = await getOrCreateBusinessConversation(
    db,
    first,
    second
  );
  const result = (await db.execute(sql`
    SELECT id
      FROM conversations
     WHERE id = ${conversationId}
       AND user1Id = ${first.userId}
       AND user2Id = ${second.userId}
       AND user1EnterpriseId <=> ${first.enterpriseId}
       AND user2EnterpriseId <=> ${second.enterpriseId}
       AND user1CompanyId <=> ${first.companyId}
       AND user2CompanyId <=> ${second.companyId}
       AND identityContextKey = ${identityContextKey}
     LIMIT 1
  `)) as unknown as [{ id: number }[], unknown];
  const rows = result[0];
  if (!rows[0]) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "当前身份会话暂不可创建，请重新发起会话",
    });
  }
  return conversationId;
}

export const chatRouter = router({
  getServiceUser: protectedProcedure.query(async () => {
    const csUserId = await getServiceUserId();
    return { userId: csUserId, name: "51小电", avatarUrl: null };
  }),

  requestErpOnboarding: protectedProcedure.mutation(async ({ ctx }) => {
    const myId = ctx.user.id;
    const db = await requireDb();
    const crmTarget = await resolveCrmTargetForUser(myId);
    const csUserId = await getServiceUserId();
    if (myId === csUserId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "客服账号不能提交入驻申请",
      });
    }

    const stored = await db.transaction(async tx => {
      const userResult = await tx.execute(sql`
        SELECT u.id, u.username, u.name, u.phone, u.email,
               c.companyName, c.creditCode, c.companyType, c.legalPerson,
               c.companyRole, c.regAddress, c.certLevel, c.reviewStatus
          FROM users u
          LEFT JOIN companies c ON c.userId = u.id
         WHERE u.id = ${myId}
         LIMIT 1
         FOR UPDATE
      `);
      const userRows = (
        userResult as unknown as [
          Array<{
            id: number;
            username: string | null;
            name: string | null;
            phone: string | null;
            email: string | null;
            companyName: string | null;
            creditCode: string | null;
            companyType: string | null;
            legalPerson: string | null;
            companyRole: string | null;
            regAddress: string | null;
            certLevel: string | null;
            reviewStatus: "pending" | "approved" | "rejected" | null;
          }>,
          unknown,
        ]
      )[0];
      const user = userRows[0];
      if (!user)
        throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });

      const existingResult = await tx.execute(sql`
        SELECT id, conversationId
          FROM messages
         WHERE senderId = ${myId}
           AND clientMessageId LIKE 'erp-onboarding:%'
           AND createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
         ORDER BY id DESC
         LIMIT 1
      `);
      const existingRows = (
        existingResult as unknown as [
          Array<{
            id: number;
            conversationId: number;
          }>,
          unknown,
        ]
      )[0];
      if (existingRows[0]) {
        return {
          status: "deduplicated" as const,
          conversationId: Number(existingRows[0].conversationId),
          messageId: Number(existingRows[0].id),
        };
      }

      const contactName =
        user.name?.trim() || user.username?.trim() || `用户#${myId}`;
      const content = [
        "【免费入驻意向】",
        "用户通过首页“免费入驻51电子网”广告申请入驻。",
        "",
        `用户：${contactName}`,
        `用户ID：${myId}`,
        `手机号：${user.phone || "未填写"}`,
        `邮箱：${user.email || "未填写"}`,
        `企业名称：${user.companyName || "未填写"}`,
        `当前ERP状态：${user.reviewStatus === "pending" ? "申请审核中" : "未开通"}`,
        "来源：首页入驻弹屏",
        "意向：开通ERP并上传物料",
        "",
        "请入驻顾问及时联系并协助完成企业认证。",
      ].join("\n");
      const adminResult = await submitAdminOnboardingLead({
        clientMessageId: `onboarding-${myId}-${randomUUID()}`,
        portalUserId: myId,
        crmPortalUserId: crmTarget.portalOwnerUserId,
        contactName,
        contactPhone: user.phone,
        contactEmail: user.email,
        companyProfile: {
          companyName: user.companyName,
          creditCode: user.creditCode,
          companyType: user.companyType,
          legalPerson: user.legalPerson,
          companyRole: user.companyRole,
          regAddress: user.regAddress,
          certLevel: user.certLevel,
        },
        content,
      });
      if (adminResult.status === "already_enabled") {
        return {
          status: "already_enabled" as const,
          conversationId: null,
          messageId: null,
        };
      }
      if (!adminResult.threadNo) throw new Error("后台未返回开通消息会话编号");

      const u1 = Math.min(myId, csUserId);
      const u2 = Math.max(myId, csUserId);
      await tx.execute(sql`
        INSERT INTO conversations (user1Id, user2Id)
        VALUES (${u1}, ${u2})
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
      `);
      const conversationResult = await tx.execute(
        sql`SELECT LAST_INSERT_ID() AS id`
      );
      const conversationId = Number(
        (
          conversationResult as unknown as [Array<{ id: number }>, unknown]
        )[0][0]?.id ?? 0
      );
      if (!conversationId) throw new Error("入驻客服会话创建失败");

      await tx.execute(sql`
        INSERT INTO conversation_user_settings (conversationId, userId, deleted)
        VALUES (${conversationId}, ${myId}, 0), (${conversationId}, ${csUserId}, 0)
        ON DUPLICATE KEY UPDATE deleted = 0
      `);

      const clientMessageId = `erp-onboarding:${randomUUID()}`;
      await tx.execute(sql`
        INSERT INTO messages
          (conversationId, senderId, senderEnterpriseId, senderCompanyId, senderCompanyNameSnapshot,
           senderIdentityContextKey, clientMessageId, msgType, content, supportScopeEnterpriseId)
        VALUES (${conversationId}, ${myId}, NULL, NULL, NULL,
          ${actorIdentityContextKey(myId, { enterpriseId: null, companyId: null })},
          ${clientMessageId}, 'text', ${content}, 0)
      `);
      const messageResult = await tx.execute(
        sql`SELECT LAST_INSERT_ID() AS id`
      );
      const messageId = Number(
        (messageResult as unknown as [Array<{ id: number }>, unknown])[0][0]
          ?.id ?? 0
      );
      if (!messageId) throw new Error("入驻客服消息创建失败");

      const preview = "[免费入驻意向] 希望开通ERP并上传物料";
      await tx.execute(sql`
        UPDATE conversations
           SET currentRound = CASE WHEN endedAt IS NULL THEN currentRound ELSE currentRound + 1 END,
               roundStartedAt = CASE WHEN endedAt IS NULL THEN roundStartedAt ELSE NOW() END,
               roundStartMessageId = CASE WHEN endedAt IS NULL THEN roundStartMessageId ELSE ${messageId} END,
               endedAt = NULL,
               endedByUserId = NULL,
               adminThreadNo = ${adminResult.threadNo},
               lastMessageAt = NOW(),
               lastMessagePreview = ${preview},
               updatedAt = NOW()
         WHERE id = ${conversationId}
      `);
      await tx.execute(sql`
        UPDATE conversation_user_settings
           SET unreadCount = CASE WHEN userId = ${csUserId}
                 THEN CASE WHEN deleted = 1 THEN 1 ELSE unreadCount + 1 END
                 ELSE unreadCount
               END,
               deleted = 0,
               updatedAt = NOW()
         WHERE conversationId = ${conversationId}
           AND userId IN (${myId}, ${csUserId})
      `);
      return { status: "created" as const, conversationId, messageId };
    });

    return { ok: true as const, ...stored };
  }),

  requestZhuomuniaoCooperation: protectedProcedure.mutation(async ({ ctx }) => {
    const myId = ctx.user.id;
    const db = await requireDb();
    const csUserId = await getServiceUserId();
    if (myId === csUserId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "客服账号不能提交合作咨询",
      });
    }

    const clientMessageId = `zmc-${myId}-${formatBeijingDateCompact(new Date())}`;
    const existingResult = await db.execute(sql`
      SELECT id, conversationId
        FROM messages
       WHERE senderId = ${myId}
         AND clientMessageId = ${clientMessageId}
       LIMIT 1
    `);
    const existingRows = (
      existingResult as unknown as [
        Array<{
          id: number;
          conversationId: number;
        }>,
        unknown,
      ]
    )[0];
    if (existingRows[0]) {
      return {
        ok: true as const,
        status: "deduplicated" as const,
        conversationId: Number(existingRows[0].conversationId),
        messageId: Number(existingRows[0].id),
      };
    }

    const userResult = await db.execute(sql`
      SELECT u.id, u.username, u.name, u.phone, u.email,
             c.companyName, c.creditCode, c.companyType, c.legalPerson,
             c.companyRole, c.regAddress, c.certLevel
        FROM users u
        LEFT JOIN companies c ON c.userId = u.id
       WHERE u.id = ${myId}
       LIMIT 1
    `);
    const userRows = (
      userResult as unknown as [
        Array<{
          id: number;
          username: string | null;
          name: string | null;
          phone: string | null;
          email: string | null;
          companyName: string | null;
          creditCode: string | null;
          companyType: string | null;
          legalPerson: string | null;
          companyRole: string | null;
          regAddress: string | null;
          certLevel: string | null;
        }>,
        unknown,
      ]
    )[0];
    const user = userRows[0];
    if (!user)
      throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });

    const contactName =
      user.name?.trim() || user.username?.trim() || `用户#${myId}`;
    const content = [
      "【啄木鸟检测合作咨询】",
      "用户通过51电子网合作专题点击“联系渠道经理”。",
      "",
      `用户：${contactName}`,
      `用户ID：${myId}`,
      `手机号：${user.phone || "未填写"}`,
      `邮箱：${user.email || "未填写"}`,
      `企业名称：${user.companyName || "未填写"}`,
      "来源：51电子网 × 啄木鸟检测合作专题",
      "咨询内容：检测方案及51电子网用户专享立减68元权益",
      "",
      "请渠道经理及时联系并协助确认检测项目、活动名额与送检方案。",
    ].join("\n");

    const adminResult = await submitAdminZhuomuniaoCooperationLead({
      clientMessageId,
      portalUserId: myId,
      contactName,
      contactPhone: user.phone,
      contactEmail: user.email,
      companyProfile: {
        companyName: user.companyName,
        creditCode: user.creditCode,
        companyType: user.companyType,
        legalPerson: user.legalPerson,
        companyRole: user.companyRole,
        regAddress: user.regAddress,
        certLevel: user.certLevel,
      },
      content,
    });

    const stored = await db.transaction(async tx => {
      const u1 = Math.min(myId, csUserId);
      const u2 = Math.max(myId, csUserId);
      await tx.execute(sql`
        INSERT INTO conversations (user1Id, user2Id)
        VALUES (${u1}, ${u2})
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
      `);
      const conversationResult = await tx.execute(
        sql`SELECT LAST_INSERT_ID() AS id`
      );
      const conversationId = Number(
        (
          conversationResult as unknown as [Array<{ id: number }>, unknown]
        )[0][0]?.id ?? 0
      );
      if (!conversationId) throw new Error("合作咨询客服会话创建失败");

      await tx.execute(sql`
        INSERT INTO conversation_user_settings (conversationId, userId, deleted)
        VALUES (${conversationId}, ${myId}, 0), (${conversationId}, ${csUserId}, 0)
        ON DUPLICATE KEY UPDATE deleted = 0
      `);
      await tx.execute(sql`
        INSERT INTO messages
          (conversationId, senderId, senderEnterpriseId, senderCompanyId, senderCompanyNameSnapshot,
           senderIdentityContextKey, clientMessageId, msgType, content, supportScopeEnterpriseId)
        VALUES (${conversationId}, ${myId}, NULL, NULL, NULL,
          ${actorIdentityContextKey(myId, { enterpriseId: null, companyId: null })},
          ${clientMessageId}, 'text', ${content}, 0)
        ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
      `);
      const messageResult = await tx.execute(
        sql`SELECT LAST_INSERT_ID() AS id`
      );
      const messageId = Number(
        (messageResult as unknown as [Array<{ id: number }>, unknown])[0][0]
          ?.id ?? 0
      );
      if (!messageId) throw new Error("合作咨询消息创建失败");

      const preview = "[啄木鸟检测合作咨询] 希望了解检测方案与68元权益";
      await tx.execute(sql`
        UPDATE conversations
           SET currentRound = CASE WHEN endedAt IS NULL THEN currentRound ELSE currentRound + 1 END,
               roundStartedAt = CASE WHEN endedAt IS NULL THEN roundStartedAt ELSE NOW() END,
               roundStartMessageId = CASE WHEN endedAt IS NULL THEN roundStartMessageId ELSE ${messageId} END,
               endedAt = NULL,
               endedByUserId = NULL,
               adminThreadNo = ${adminResult.threadNo},
               lastMessageAt = NOW(),
               lastMessagePreview = ${preview},
               updatedAt = NOW()
         WHERE id = ${conversationId}
      `);
      await tx.execute(sql`
        UPDATE conversation_user_settings
           SET unreadCount = CASE WHEN userId = ${csUserId}
                 THEN CASE WHEN deleted = 1 THEN 1 ELSE unreadCount + 1 END
                 ELSE unreadCount
               END,
               deleted = 0,
               updatedAt = NOW()
         WHERE conversationId = ${conversationId}
           AND userId IN (${myId}, ${csUserId})
      `);
      return { conversationId, messageId };
    });

    return {
      ok: true as const,
      status: adminResult.deduplicated
        ? ("deduplicated" as const)
        : ("created" as const),
      ...stored,
    };
  }),

  contactProfile: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        contactUserId: z.number().int().positive(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireConversationContact(
        db,
        ctx.user.id,
        input.conversationId,
        input.contactUserId
      );
      const contextConversation =
        await resolveChatContactConversationCompanyContext({
          viewerUserId: ctx.user.id,
          contactUserId: input.contactUserId,
          conversationId: input.conversationId,
        });
      const profile = await getChatContactProfile({
        viewerUserId: ctx.user.id,
        contactUserId: input.contactUserId,
        conversationId: input.conversationId,
        contextCompanyId: contextConversation,
      });
      if (!profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "联系人资料暂不可查看",
        });
      }
      return {
        ...profile,
        blockState: await conversationBlockState(
          db,
          ctx.user.id,
          input.conversationId,
          input.contactUserId
        ),
      };
    }),

  contactInventory: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        contactUserId: z.number().int().positive(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(30).default(20),
        keyword: z.string().trim().max(64).optional(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireConversationContact(
        db,
        ctx.user.id,
        input.conversationId,
        input.contactUserId
      );
      const contextConversation =
        await resolveChatContactConversationCompanyContext({
          viewerUserId: ctx.user.id,
          contactUserId: input.contactUserId,
          conversationId: input.conversationId,
        });
      const inventory = await getChatContactInventory({
        viewerUserId: ctx.user.id,
        ...input,
        contextCompanyId: contextConversation,
      });
      if (!inventory) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "联系人库存暂不可查看",
        });
      }
      return inventory;
    }),

  blockContact: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        contactUserId: z.number().int().positive(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireConversationContact(
        db,
        ctx.user.id,
        input.conversationId,
        input.contactUserId,
        { write: true }
      );
      await db.execute(sql`
        INSERT INTO chat_user_blocks (blockerUserId, blockedUserId, conversationId)
        VALUES (${ctx.user.id}, ${input.contactUserId}, ${input.conversationId})
        ON DUPLICATE KEY UPDATE conversationId = VALUES(conversationId)
      `);
      await db.execute(sql`
        UPDATE conversation_user_settings
           SET deleted = 1, unreadCount = 0
         WHERE conversationId = ${input.conversationId}
           AND userId = ${ctx.user.id}
      `);
      return { ok: true };
    }),

  unblockContact: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        contactUserId: z.number().int().positive(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireConversationContact(
        db,
        ctx.user.id,
        input.conversationId,
        input.contactUserId,
        { write: true }
      );
      await db.execute(sql`
        DELETE FROM chat_user_blocks
         WHERE blockerUserId = ${ctx.user.id}
           AND blockedUserId = ${input.contactUserId}
           AND conversationId = ${input.conversationId}
      `);
      await db.execute(sql`
        UPDATE conversation_user_settings
           SET deleted = 0
         WHERE conversationId = ${input.conversationId}
           AND userId = ${ctx.user.id}
      `);
      return { ok: true };
    }),

  reportContact: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        contactUserId: z.number().int().positive(),
        reason: z.enum([
          "fraud",
          "harassment",
          "false_inventory",
          "illegal",
          "other",
        ]),
        detail: z.string().trim().max(300).optional(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireConversationContact(
        db,
        ctx.user.id,
        input.conversationId,
        input.contactUserId,
        { write: true }
      );
      return db.transaction(async tx => {
        const recentResult = await tx.execute(sql`
          SELECT COUNT(*) AS count
            FROM chat_user_reports
           WHERE reporterUserId = ${ctx.user.id}
             AND reportedUserId = ${input.contactUserId}
             AND createdAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `);
        const recentRows = (
          recentResult as unknown as [Array<{ count: number }>, unknown]
        )[0];
        if (Number(recentRows[0]?.count ?? 0) >= 3) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "举报提交过于频繁，请稍后再试",
          });
        }
        await tx.execute(sql`
          INSERT INTO chat_user_reports
            (reporterUserId, reportedUserId, conversationId, reason, detail)
          VALUES
            (${ctx.user.id}, ${input.contactUserId}, ${input.conversationId}, ${input.reason}, ${input.detail || null})
        `);
        const reportIdResult = await tx.execute(
          sql`SELECT LAST_INSERT_ID() AS id`
        );
        const reportIdRows = (
          reportIdResult as unknown as [Array<{ id: number }>, unknown]
        )[0];
        const reportId = Number(reportIdRows[0]?.id ?? 0);
        if (!reportId) throw new Error("举报记录写入后读取失败");
        const userResult = await tx.execute(sql`
          SELECT u.id, u.name, u.username, u.phone, u.wechatId,
                 comp.companyName
            FROM users u
            LEFT JOIN companies comp ON comp.id = (SELECT CASE WHEN COUNT(*) = 1 THEN MIN(buyerCompany.id) ELSE NULL END FROM companies buyerCompany WHERE buyerCompany.userId = u.id)
           WHERE u.id IN (${ctx.user.id}, ${input.contactUserId})
        `);
        const userRows = (
          userResult as unknown as [
            Array<{
              id: number;
              name: string | null;
              username: string | null;
              phone: string | null;
              wechatId: string | null;
              companyName: string | null;
            }>,
            unknown,
          ]
        )[0];
        const reporter = userRows.find(user => Number(user.id) === ctx.user.id);
        const reported = userRows.find(
          user => Number(user.id) === input.contactUserId
        );
        const displayName = (user: typeof reporter, fallback: string) =>
          user?.companyName?.trim() ||
          user?.name?.trim() ||
          user?.username?.trim() ||
          fallback;
        const reporterName = displayName(reporter, `用户#${ctx.user.id}`);
        const reportedName = displayName(
          reported,
          `用户#${input.contactUserId}`
        );
        const adminThread = await submitAdminComplaint({
          reportId,
          reason: input.reason,
          detail: input.detail || null,
          conversationId: input.conversationId,
          reporter: {
            userId: ctx.user.id,
            name: reporterName,
            phone: reporter?.phone || null,
            wechatId: reporter?.wechatId || null,
            companyName: reporter?.companyName || null,
          },
          reported: {
            userId: input.contactUserId,
            name: reportedName,
            phone: reported?.phone || null,
            wechatId: reported?.wechatId || null,
            companyName: reported?.companyName || null,
          },
        });
        await tx.execute(sql`
          UPDATE chat_user_reports
             SET adminThreadNo = ${adminThread.threadNo}
           WHERE id = ${reportId}
        `);
        return { ok: true, reportId, threadNo: adminThread.threadNo };
      });
    }),

  getOrCreateConversation: protectedProcedure
    .input(
      z.object({
        otherUserId: z.number().int().positive(),
        /** 多企业联系人必须从其真实企业/库存卡片携带，不能用名称冒充。 */
        targetEnterpriseId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const myId = ctx.user.id;
      const otherId = input.otherUserId;
      if (myId === otherId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不能与自己创建会话",
        });
      }
      const serviceUserId = await getServiceUserId();
      if (otherId === serviceUserId) {
        if (getEnterpriseRequestContextForActor(myId)?.enterpriseId != null) {
          await resolveActorBusinessIdentity(db, myId);
        }
        const support = await getOrCreateAccountSupportConversation(
          db,
          myId,
          serviceUserId
        );
        await ensureGreetingMessage(support.canonicalId);
        return {
          conversationId: support.canonicalId,
          id: support.canonicalId,
          serviceConversationIds: support.sourceIds,
          aliasIds: support.sourceIds.filter(id => id !== support.canonicalId),
        };
      }
      const myIdentity = await resolveActorBusinessIdentity(db, myId);
      const otherIdentity = await resolveConversationCounterpartyIdentity(
        db,
        otherId,
        input.targetEnterpriseId
      );
      await assertUserPairNotBlocked(db, myId, otherId);
      const conversationId = await getOrCreateFrozenBusinessConversation(
        db,
        participantSnapshot(myId, myIdentity),
        participantSnapshot(otherId, otherIdentity)
      );
      return { conversationId, id: conversationId };
    }),

  listConversations: protectedProcedure
    .input(
      z
        .object({ supportView: z.enum(["enterprise", "general"]).optional() })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const myId = ctx.user.id;
      const requestedSupportView = await resolveAccountSupportView(
        db,
        myId,
        input?.supportView
      );
      const myIdentity = requestedSupportView.identity;
      const ordinaryConversationScope =
        requestedSupportView.supportOnlyWithoutEnterpriseSelection
          ? sql`FALSE`
          : sql`(
        ${visibleConversationScopeSql("c", myId, myIdentity)}
        OR ${chatTransitionPendingListScopeSql("c", myId, myIdentity)}
      )`;
      let serviceUserIdForSort: number | null = null;
      try {
        serviceUserIdForSort = await getServiceUserId();
      } catch (err) {
        console.error(
          "[chat.listConversations] 取客服用户失败，本次不置顶:",
          err
        );
      }
      const csIdForSort = serviceUserIdForSort ?? 0;
      const result = (await db.execute(sql`
      SELECT 
        c.id, c.identityContextKey, c.user1Id, c.user2Id, c.currentRound, c.endedAt, c.endedByUserId,
        c.lastMessageAt,
        CASE
          WHEN EXISTS (
            SELECT 1
              FROM chat_message_user_hidden hidden_last
             WHERE hidden_last.userId = ${myId}
               AND hidden_last.messageId = (
                 SELECT MAX(last_message.id)
                   FROM messages last_message
                  WHERE last_message.conversationId = c.id
               )
          ) THEN '[消息已删除]'
          ELSE c.lastMessagePreview
        END as lastMessagePreview,
        s.pinned, s.remarkName, s.groupName, s.unreadCount,
        (
          SELECT GROUP_CONCAT(gm.groupId ORDER BY gm.groupId SEPARATOR ',')
            FROM conversation_group_members gm
            INNER JOIN conversation_groups cg
              ON cg.id = gm.groupId
             AND cg.userId = gm.userId
             AND cg.status = 'active'
             AND ${readableGroupIdentityScopeSql("cg", myId, myIdentity)}
           WHERE gm.userId = ${myId}
             AND gm.conversationId = c.id
        ) AS groupIds,
        CASE WHEN c.identityContextKey = 'legacy' OR c.identityContextKey IS NULL THEN 1 ELSE 0 END
          AS isSharedAccountHistory,
        COALESCE(
          CASE WHEN c.identityContextKey = 'legacy' OR c.identityContextKey IS NULL THEN c.id ELSE NULL END,
          (SELECT transition_link.legacyConversationId
             FROM chat_conversation_identity_transitions transition_link
            WHERE (transition_link.pendingConversationId = c.id OR transition_link.finalConversationId = c.id)
              AND (transition_link.initiatorUserId = ${myId} OR transition_link.recipientUserId = ${myId})
            ORDER BY transition_link.id DESC LIMIT 1)
        ) AS legacyConversationId,
        (SELECT transition_link.id
           FROM chat_conversation_identity_transitions transition_link
          WHERE (transition_link.pendingConversationId = c.id OR transition_link.finalConversationId = c.id)
            AND (transition_link.initiatorUserId = ${myId} OR transition_link.recipientUserId = ${myId})
          ORDER BY transition_link.id DESC LIMIT 1) AS legacyTransitionId,
        EXISTS (
          SELECT 1 FROM chat_conversation_identity_transitions transition_pending
           WHERE transition_pending.pendingConversationId = c.id
             AND transition_pending.status = 'pending'
             AND transition_pending.finalConversationId IS NULL
             AND (transition_pending.initiatorUserId = ${myId} OR transition_pending.recipientUserId = ${myId})
        ) AS isIdentityTransition,
        EXISTS (
          SELECT 1 FROM chat_conversation_identity_transitions transition_pending
           WHERE transition_pending.pendingConversationId = c.id
             AND transition_pending.status = 'pending'
             AND transition_pending.finalConversationId IS NULL
             AND transition_pending.recipientUserId = ${myId}
             AND transition_pending.recipientConfirmedIdentityKey IS NULL
        ) AS requiresIdentityConfirmation,
        (SELECT transition_sender.initiatorCompanyName
           FROM chat_conversation_identity_transitions transition_sender
          WHERE transition_sender.pendingConversationId = c.id
            AND transition_sender.status = 'pending'
            AND transition_sender.finalConversationId IS NULL
            AND transition_sender.recipientUserId = ${myId}
          LIMIT 1) AS frozenSenderCompanyName,
        u.id as otherUserId, u.name as otherUserName, u.username as otherUsername,
        u.avatarUrl as otherUserAvatar,
          CASE WHEN c.identityContextKey LIKE 'pending:v1:%' THEN NULL ELSE COALESCE(
            CASE WHEN c.user1Id = ${myId} THEN c.user2CompanyNameSnapshot ELSE c.user1CompanyNameSnapshot END,
            comp.companyName
          ) END as otherCompanyName,
        CASE
          WHEN publicCompanyOwner.crmAccess = 1
            AND comp.reviewStatus = 'approved'
            AND comp.certLevel IN ('certified', 'premium')
            AND NULLIF(TRIM(comp.companyName), '') IS NOT NULL
            /* Mirror publicCompanyProfileEligibilityConditions; never infer a link from its name. */
            AND (
              (comp.registrationRegion = 'CN'
                AND NULLIF(TRIM(comp.creditCode), '') IS NOT NULL
                AND NULLIF(TRIM(comp.legalPerson), '') IS NOT NULL)
              OR
              (comp.registrationRegion = 'HK'
                AND REGEXP_LIKE(CONVERT(COALESCE(comp.registrationIdentifier, '') USING utf8mb4), '^HK:[0-9]{8}$', 'c'))
            )
            AND NULLIF(TRIM(comp.regAddress), '') IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM inventories publicInventory
              INNER JOIN public_inventory_company_bindings publicCompanyBinding ON publicCompanyBinding.inventoryId = publicInventory.id
              WHERE publicCompanyBinding.companyId = comp.id
                AND publicInventory.status = 'published'
              LIMIT 1
            )
          THEN CASE WHEN comp.userId = u.id AND (SELECT COUNT(*) FROM companies legacyCompany WHERE legacyCompany.userId = u.id) = 1 THEN u.id ELSE NULL END
          ELSE NULL
        END as otherCompanyProfileSupplierId,
        CASE
          WHEN publicCompanyOwner.crmAccess = 1
            AND comp.reviewStatus = 'approved'
            AND comp.certLevel IN ('certified', 'premium')
            AND NULLIF(TRIM(comp.companyName), '') IS NOT NULL
            /* Mirror publicCompanyProfileEligibilityConditions; never infer a link from its name. */
            AND (
              (comp.registrationRegion = 'CN'
                AND NULLIF(TRIM(comp.creditCode), '') IS NOT NULL
                AND NULLIF(TRIM(comp.legalPerson), '') IS NOT NULL)
              OR
              (comp.registrationRegion = 'HK'
                AND REGEXP_LIKE(CONVERT(COALESCE(comp.registrationIdentifier, '') USING utf8mb4), '^HK:[0-9]{8}$', 'c'))
            )
            AND NULLIF(TRIM(comp.regAddress), '') IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM inventories publicInventory
              INNER JOIN public_inventory_company_bindings publicCompanyBinding ON publicCompanyBinding.inventoryId = publicInventory.id
              WHERE publicCompanyBinding.companyId = comp.id
                AND publicInventory.status = 'published'
              LIMIT 1
            )
          THEN comp.id
          ELSE NULL
        END as otherCompanyProfileCompanyId
      FROM conversations c
      INNER JOIN conversation_user_settings s ON s.conversationId = c.id AND s.userId = ${myId}
      INNER JOIN users u ON u.id = IF(c.user1Id = ${myId}, c.user2Id, c.user1Id)
      ${conversationPublicCompanyJoinSql("c", "u", "comp")}
      LEFT JOIN users publicCompanyOwner ON publicCompanyOwner.id = comp.userId
      WHERE (
        (
          s.deleted = 0
          AND ${ordinaryConversationScope}
        )
        OR (
          ${csIdForSort} > 0
          AND ((c.user1Id = ${myId} AND c.user2Id = ${csIdForSort})
            OR (c.user2Id = ${myId} AND c.user1Id = ${csIdForSort}))
        )
      )
      ORDER BY (u.id = ${csIdForSort}) DESC, s.pinned DESC, c.lastMessageAt DESC
    `)) as unknown as [ChatConversationListRow[], unknown];
      const rows = result[0];
      const serviceUserId = serviceUserIdForSort;
      const entries = rows.map(r => {
        const labels = chatContactLabels({
          companyName: r.otherCompanyName,
          personName: r.otherUserName,
          username: r.otherUsername,
          remarkName: r.remarkName,
        });
        const otherUserOriginalName = labels.originalName;
        const remarkName = r.remarkName?.trim() || null;
        return {
          id: Number(r.id),
          canonicalConversationId: Number(r.id),
          aliasIds: new Array<number>(),
          /**
           * Legacy rows have no trustworthy business tuple and are read-only only
           * in a selected enterprise lane. Keep an unselected personal actor's
           * original direct-chat permission; the client must not infer otherwise.
           */
          isHistorical: Boolean(r.isSharedAccountHistory),
          /** A legacy row stays a shared account history; P is an independent current row. */
          isSharedAccountHistory: Boolean(r.isSharedAccountHistory),
          legacyConversationId:
            r.legacyConversationId == null
              ? null
              : Number(r.legacyConversationId),
          hasCurrentMessages:
            !(
              r.identityContextKey === "legacy" || r.identityContextKey == null
            ) && Boolean(r.hasCurrentMessages),
          isIdentityTransition: Boolean(r.isIdentityTransition),
          legacyTransitionId:
            r.legacyTransitionId == null ? null : Number(r.legacyTransitionId),
          requiresIdentityConfirmation: Boolean(r.requiresIdentityConfirmation),
          /** Display-only frozen sender label for P; it never assigns old history to a company. */
          frozenSenderCompanyName: r.frozenSenderCompanyName?.trim() || null,
          otherUserId: r.otherUserId,
          otherUserName: labels.displayName,
          otherUserOriginalName,
          otherContactPersonName: labels.contactPersonName,
          otherCompanyNameSnapshot: labels.companyName,
          /** 仅对满足企业公开页全部门禁的会话返回，前端不得根据名称猜测链接。 */
          otherCompanyProfileSupplierId:
            r.otherCompanyProfileSupplierId == null
              ? null
              : Number(r.otherCompanyProfileSupplierId),
          otherCompanyProfileCompanyId:
            r.otherCompanyProfileCompanyId == null
              ? null
              : Number(r.otherCompanyProfileCompanyId),
          /** 对方头像；为空时前端回退为首字母色块 */
          otherUserAvatar: r.otherUserAvatar,
          isService: serviceUserId !== null && r.otherUserId === serviceUserId,
          remarkName,
          lastMessageAt: r.lastMessageAt,
          lastMessagePreview: r.lastMessagePreview || "",
          /** 当前会话轮次；存量会话默认第 1 轮 */
          currentRound: Number(r.currentRound ?? 1),
          /** 本轮结束时间；非空表示已结束等待评价 */
          endedAt: r.endedAt,
          endedByUserId: r.endedByUserId,
          pinned: !!r.pinned,
          groupName: r.groupName,
          groupIds: (r.groupIds || "")
            .split(",")
            .map(value => Number(value))
            .filter(value => Number.isInteger(value) && value > 0),
          unreadCount: r.unreadCount,
          /** Non-official rows never carry account-support general unread. */
          supportGeneralUnreadCount: 0,
          supportView: null,
          supportEnterpriseId: null,
        };
      });
      const canonicalizedEntries = await chatTransitionCanonicalizeListEntries(
        db,
        myId,
        myIdentity,
        serviceUserId ?? 0,
        entries
      );
      const ordinaryEntries = canonicalizedEntries.filter(
        entry => !entry.isService
      );
      const supportEntries = canonicalizedEntries.filter(
        entry => entry.isService
      );
      if (supportEntries.length === 0) return ordinaryEntries;
      const sourceIds = supportEntries
        .map(entry => Number(entry.id))
        .sort((a, b) => a - b);
      const canonicalId = sourceIds[0];
      // Header is only a legacy-wire mode after the server found this actor's official-support row.
      const supportCompatibility = isWeappDefaultAccountSupportCompatibility(
        ctx,
        input?.supportView,
        supportEntries.length > 0
      );
      const displayedScopeEnterpriseIds = accountSupportDisplayedScopeIds(
        requestedSupportView,
        supportCompatibility
      );
      const representative =
        supportEntries.find(entry => Number(entry.id) === canonicalId) ??
        supportEntries[0];
      const unreadForScope = async (scopeEnterpriseId: number) => {
        const aggregate = (await db.execute(sql`
        SELECT COUNT(*) AS unreadCount
          FROM messages scoped_messages
          INNER JOIN conversations scoped_source ON scoped_source.id = scoped_messages.conversationId
          LEFT JOIN account_support_view_settings scoped_settings
            ON scoped_settings.userId = ${myId}
           AND scoped_settings.scopeEnterpriseId = ${scopeEnterpriseId}
         WHERE scoped_messages.conversationId IN (${accountSupportIdsSql(sourceIds)})
           AND scoped_messages.senderId <> ${myId}
           AND ${accountSupportMessageInViewSql("scoped_messages", "scoped_source", myId, Number(serviceUserId ?? 0), scopeEnterpriseId)}
           AND scoped_messages.id > COALESCE(scoped_settings.lastReadMessageId, 0)
           AND scoped_messages.id > COALESCE(scoped_settings.deletedBeforeMessageId, 0)
           AND NOT EXISTS (
             SELECT 1 FROM chat_message_user_hidden scoped_hidden
              WHERE scoped_hidden.messageId = scoped_messages.id AND scoped_hidden.userId = ${myId}
           )
      `)) as unknown as [{ unreadCount: number }[], unknown];
        return Number(aggregate[0][0]?.unreadCount ?? 0);
      };
      const latestResult = (await db.execute(sql`
      SELECT scoped_messages.createdAt, scoped_messages.content, scoped_messages.msgType, scoped_messages.id
        FROM messages scoped_messages
        INNER JOIN conversations scoped_source ON scoped_source.id = scoped_messages.conversationId
       WHERE scoped_messages.conversationId IN (${accountSupportIdsSql(sourceIds)})
         AND ${supportCompatibility ? accountSupportMessageInDisplayedScopesSql("scoped_messages", "scoped_source", myId, Number(serviceUserId ?? 0), displayedScopeEnterpriseIds) : accountSupportMessageInViewSql("scoped_messages", "scoped_source", myId, Number(serviceUserId ?? 0), requestedSupportView.scopeEnterpriseId)}
         AND ${
           supportCompatibility
             ? accountSupportMessageAfterViewDeleteSql(
                 "scoped_messages",
                 "scoped_source",
                 myId,
                 Number(serviceUserId ?? 0)
               )
             : sql`scoped_messages.id > COALESCE((
           SELECT list_settings.deletedBeforeMessageId
             FROM account_support_view_settings list_settings
            WHERE list_settings.userId = ${myId}
              AND list_settings.scopeEnterpriseId = ${requestedSupportView.scopeEnterpriseId}
            LIMIT 1
         ), 0)`
         }
         AND NOT EXISTS (
           SELECT 1 FROM chat_message_user_hidden latest_hidden
            WHERE latest_hidden.messageId = scoped_messages.id AND latest_hidden.userId = ${myId}
         )
       ORDER BY scoped_messages.createdAt DESC, scoped_messages.id DESC
       LIMIT 1
    `)) as unknown as [
        Pick<MessageRow, "id" | "createdAt" | "msgType" | "content">[],
        unknown,
      ];
      const latest = latestResult[0][0];
      const preview = !latest
        ? ""
        : latest.msgType === "image"
          ? "[图片]"
          : latest.msgType === "file"
            ? "[文件]"
            : latest.msgType === "inquiry"
              ? "[询价]"
              : latest.content.slice(0, 50);
      const [scopedUnreadCount, supportGeneralUnreadCount] = await Promise.all([
        Promise.all(displayedScopeEnterpriseIds.map(unreadForScope)).then(
          counts => counts.reduce((total, count) => total + count, 0)
        ),
        unreadForScope(0),
      ]);
      const canonical = {
        ...representative,
        id: canonicalId,
        isService: true,
        pinned: false,
        groupName: null,
        groupIds: new Array<number>(),
        lastMessageAt: latest?.createdAt ?? representative.lastMessageAt,
        lastMessagePreview: preview,
        unreadCount: scopedUnreadCount,
        supportView: requestedSupportView.supportView,
        supportEnterpriseId: requestedSupportView.scopeEnterpriseId || null,
        supportGeneralUnreadCount,
        serviceConversationIds: sourceIds,
        aliasIds: sourceIds.filter(id => id !== canonicalId),
      };
      return [canonical, ...ordinaryEntries];
    }),

  getMessages: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        cursor: z.number().int().optional(),
        // 最后一条消息 ID，用于分页
        limit: z.number().int().min(1).max(100).default(50),
        supportView: z.enum(["enterprise", "general"]).optional(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const db = await requireDb();
      return runWithReadyWeappConversationScope({
        executor: db,
        actorUserId: ctx.user.id,
        conversationId: input.conversationId,
        headers: ctx.req?.headers,
        action: () => next(),
      });
    })
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const myId = ctx.user.id;
      const serviceUserId = await getServiceUserId();
      const transitionConversationId =
        await resolveChatTransitionCoreConversationId(
          db,
          myId,
          input.conversationId,
          serviceUserId
        );
      const transitionRow = await chatTransitionFindForConversation(
        db,
        myId,
        transitionConversationId
      );
      const transitionRead = transitionRow
        ? await chatTransitionResolveRead(db, {
            actorUserId: myId,
            conversationId: transitionConversationId,
            currentIdentity: await resolveActorBusinessIdentity(db, myId),
            serviceUserId,
          })
        : null;
      const scoped = transitionRead
        ? null
        : await requireScopedConversation(db, myId, input.conversationId, {
            write: false,
          });
      if (!transitionRead && !scoped)
        throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
      const myIdentity = transitionRead
        ? await resolveActorBusinessIdentity(db, myId)
        : requireResolvedChatScope(scoped).identity;
      const otherUserId = transitionRead
        ? transitionRead.otherUserId
        : requireResolvedChatScope(scoped).otherUserId;
      const support =
        !transitionRead && otherUserId === serviceUserId
          ? await resolveAccountSupportConversation(
              db,
              myId,
              serviceUserId,
              input.conversationId
            )
          : null;
      const supportView = support
        ? await resolveAccountSupportView(db, myId, input.supportView)
        : null;
      const sourceConversationIds = transitionRead?.sourceConversationIds ??
        support?.sourceIds ?? [input.conversationId];
      // Reached only after requireScopedConversation and server-side official-account resolution.
      const supportCompatibility =
        Boolean(support && supportView) &&
        isWeappDefaultAccountSupportCompatibility(
          ctx,
          input.supportView,
          support
        );
      const displayedScopeEnterpriseIds = supportView
        ? accountSupportDisplayedScopeIds(supportView, supportCompatibility)
        : [];
      const canonicalConversationId =
        transitionRead?.canonicalConversationId ??
        support?.canonicalId ??
        input.conversationId;
      const convCheck = (await db.execute(sql`
        SELECT id, user1Id, user2Id FROM conversations 
        WHERE id = ${input.conversationId} AND (user1Id = ${myId} OR user2Id = ${myId})
          AND (
            ${transitionRead ? sql`TRUE` : conversationIdentityScopeSql("conversations", myId, myIdentity)}
            OR (user1Id = ${myId} AND user2Id = ${serviceUserId})
            OR (user2Id = ${myId} AND user1Id = ${serviceUserId})
          )
        LIMIT 1
      `)) as unknown as [ChatPairRow[], unknown];
      const convRows = convCheck[0];
      if (convRows.length === 0) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
      }
      const peerId =
        convRows[0].user1Id === myId
          ? convRows[0].user2Id
          : convRows[0].user1Id;
      const peerReadResult = (await db.execute(sql`
        SELECT peer.conversationId, peer.lastReadMessageId
          FROM conversation_user_settings peer
         WHERE peer.conversationId IN (${accountSupportIdsSql(sourceConversationIds)})
           AND peer.userId = ${peerId}
      `)) as unknown as [
        { conversationId: number; lastReadMessageId: number | null }[],
        unknown,
      ];
      const peerReadRows = peerReadResult[0];
      const peerLastReadMessageIds = Object.fromEntries(
        peerReadRows.map(row => [
          Number(row.conversationId),
          row.lastReadMessageId == null ? null : Number(row.lastReadMessageId),
        ])
      );
      const peerLastReadMessageId =
        peerLastReadMessageIds[input.conversationId] ?? null;
      try {
        const { isService } = await isServiceConversation(convRows[0]);
        if (isService) {
          const bucket = Math.floor(Date.now() / 6e4);
          await Promise.all(
            sourceConversationIds.map(conversationId =>
              enqueueChatSyncEvent({
                eventKey: `pull:${conversationId}:${bucket}`,
                eventType: "pull_service_replies",
                conversationId,
              })
            )
          );
        }
      } catch (err) {
        console.error("[chat.getMessages] 投递客服拉取事件失败:", err);
      }
      const conditions = [
        sql`messages.conversationId IN (${accountSupportIdsSql(sourceConversationIds)})`,
      ];
      if (support && supportView) {
        conditions.push(
          supportCompatibility
            ? accountSupportMessageInDisplayedScopesSql(
                "messages",
                "support_source",
                myId,
                serviceUserId,
                displayedScopeEnterpriseIds
              )
            : accountSupportMessageInViewSql(
                "messages",
                "support_source",
                myId,
                serviceUserId,
                supportView.scopeEnterpriseId
              )
        );
        conditions.push(
          supportCompatibility
            ? accountSupportMessageAfterViewDeleteSql(
                "messages",
                "support_source",
                myId,
                serviceUserId
              )
            : sql`messages.id > COALESCE((
          SELECT view_settings.deletedBeforeMessageId
            FROM account_support_view_settings view_settings
           WHERE view_settings.userId = ${myId}
             AND view_settings.scopeEnterpriseId = ${supportView.scopeEnterpriseId}
           LIMIT 1
        ), 0)`
        );
      } else {
        if (transitionRead) {
          conditions.push(sql`EXISTS (
            SELECT 1 FROM conversation_user_settings transition_view
             WHERE transition_view.conversationId = messages.conversationId
               AND transition_view.userId = ${myId}
               AND transition_view.deleted = 0
          )`);
        }
        conditions.push(sql`messages.id > COALESCE((
          SELECT mine.clearedBeforeMessageId
            FROM conversation_user_settings mine
           WHERE mine.conversationId = messages.conversationId
             AND mine.userId = ${myId}
           LIMIT 1
        ), 0)`);
      }
      if (input.cursor) {
        conditions.push(sql`messages.id < ${input.cursor}`);
      }
      conditions.push(sql`NOT EXISTS (
        SELECT 1
          FROM chat_message_user_hidden hidden_message
         WHERE hidden_message.messageId = messages.id
           AND hidden_message.userId = ${myId}
      )`);
      const result = (await db.execute(sql`
        /* Scope predicate is evaluated before ORDER BY/LIMIT, not a client filter. */
        SELECT messages.*,
               ${support && supportView ? accountSupportMessageScopeIdSql("messages", "support_source", myId, serviceUserId) : sql`NULL`} AS supportEnterpriseId,
               quoted.senderId AS quotedSenderId,
               quoted.msgType AS quotedMsgType,
               CASE
                 WHEN quoted.id IS NULL OR quoted.recalledAt IS NOT NULL OR quoted_hidden.id IS NOT NULL THEN NULL
                 ELSE quoted.content
               END AS quotedContent,
               quoted.recalledAt AS quotedRecalledAt,
               quoted_hidden.id AS quotedHiddenId
          FROM messages
          ${support && supportView ? sql`INNER JOIN conversations support_source ON support_source.id = messages.conversationId` : sql``}
          ${support && supportView ? sql`LEFT JOIN (messages quoted INNER JOIN conversations quoted_source ON quoted_source.id = quoted.conversationId)` : sql`LEFT JOIN messages quoted`}
            ON quoted.id = messages.replyToMessageId
           AND quoted.conversationId IN (${accountSupportIdsSql(sourceConversationIds)})
           ${support && supportView ? (supportCompatibility ? sql`AND ${accountSupportMessageInDisplayedScopesSql("quoted", "quoted_source", myId, serviceUserId, displayedScopeEnterpriseIds)}` : sql`AND ${accountSupportMessageInViewSql("quoted", "quoted_source", myId, serviceUserId, supportView.scopeEnterpriseId)}`) : sql``}
           AND ${support && supportView ? (supportCompatibility ? accountSupportMessageAfterViewDeleteSql("quoted", "quoted_source", myId, serviceUserId) : sql`quoted.id > COALESCE((SELECT quote_view.deletedBeforeMessageId FROM account_support_view_settings quote_view WHERE quote_view.userId = ${myId} AND quote_view.scopeEnterpriseId = ${supportView.scopeEnterpriseId} LIMIT 1), 0)`) : sql`quoted.id > COALESCE((SELECT quote_settings.clearedBeforeMessageId FROM conversation_user_settings quote_settings WHERE quote_settings.conversationId = quoted.conversationId AND quote_settings.userId = ${myId} LIMIT 1), 0)`}
          LEFT JOIN chat_message_user_hidden quoted_hidden
            ON quoted_hidden.messageId = quoted.id
            AND quoted_hidden.userId = ${myId}
         WHERE ${sql.join(conditions, sql` AND `)}
         ORDER BY messages.createdAt DESC, messages.id DESC
        LIMIT ${input.limit}
      `)) as unknown as [MessageWithReplyRow[], unknown];
      const messages = (
        result as unknown as [MessageWithReplyRow[], unknown]
      )[0];
      const nextCursor =
        messages.length === input.limit
          ? messages[messages.length - 1]?.id
          : void 0;
      const orderedMessages = messages.reverse();
      const attachmentIds = Array.from(
        new Set(
          orderedMessages.flatMap(message => {
            if (message.recalledAt) return [];
            if (message.msgType !== "image" && message.msgType !== "file")
              return [];
            try {
              const parsed = JSON.parse(message.content);
              const attachmentId = Number(parsed.attachmentId);
              return Number.isInteger(attachmentId) && attachmentId > 0
                ? [attachmentId]
                : [];
            } catch {
              return [];
            }
          })
        )
      );
      const attachmentMap = /* @__PURE__ */ new Map();
      if (attachmentIds.length > 0) {
        const attachmentResult = (await db.execute(sql`
          SELECT id, kind, storageKey, originalName, mimeType, byteSize
            FROM chat_attachments
           WHERE conversationId IN (${accountSupportIdsSql(sourceConversationIds)})
             AND id IN (${sql.join(
               attachmentIds.map(id => sql`${id}`),
               sql`, `
             )})
             AND ${
               support && supportView
                 ? supportCompatibility
                   ? accountSupportAttachmentInDisplayedScopesSql(
                       "chat_attachments",
                       "attachment_message",
                       "attachment_source",
                       myId,
                       serviceUserId,
                       support.sourceIds,
                       displayedScopeEnterpriseIds
                     )
                   : sql`(
               supportEnterpriseId = ${supportView.scopeEnterpriseId}
               OR (
                 supportEnterpriseId IS NULL
                 AND EXISTS (
                   SELECT 1
                     FROM messages attachment_message
                     INNER JOIN conversations attachment_source
                       ON attachment_source.id = attachment_message.conversationId
                    WHERE attachment_message.conversationId IN (${accountSupportIdsSql(requireResolvedChatScope(support).sourceIds)})
                      AND JSON_VALID(attachment_message.content)
                      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(attachment_message.content, '$.attachmentId')) AS UNSIGNED) = chat_attachments.id
                      AND ${accountSupportMessageInViewSql("attachment_message", "attachment_source", myId, serviceUserId, supportView.scopeEnterpriseId)}
                 )
               )
             )`
                 : sql`TRUE`
             }
        `)) as unknown as [ChatAttachmentRow[], unknown];
        const attachmentRows = (
          attachmentResult as unknown as [
            Array<{
              id: number;
              kind: "image" | "file";
              storageKey: string;
              originalName: string;
              mimeType: string;
              byteSize: number;
            }>,
            unknown,
          ]
        )[0];
        await Promise.all(
          attachmentRows.map(async attachment => {
            const url = await storageGetAccessUrl(
              attachment.storageKey,
              3600
            ).catch(() => null);
            attachmentMap.set(Number(attachment.id), {
              id: Number(attachment.id),
              kind: attachment.kind,
              originalName: attachment.originalName,
              mimeType: attachment.mimeType,
              byteSize: Number(attachment.byteSize),
              url,
            });
          })
        );
      }
      return {
        messages: orderedMessages.map(message => {
          const {
            quotedSenderId,
            quotedMsgType,
            quotedContent,
            quotedRecalledAt,
            quotedHiddenId,
            ...baseMessage
          } = message;
          const publicMessage = message.recalledAt
            ? {
                ...baseMessage,
                originConversationId: Number(message.conversationId),
                content: "",
                replyToMessageId: null,
                replyTo: null,
              }
            : {
                ...baseMessage,
                originConversationId: Number(message.conversationId),
                replyTo:
                  message.replyToMessageId == null
                    ? null
                    : {
                        id: Number(message.replyToMessageId),
                        senderId:
                          quotedSenderId == null
                            ? null
                            : Number(quotedSenderId),
                        msgType: quotedMsgType,
                        content: quotedContent,
                        unavailable:
                          quotedRecalledAt !== null ||
                          quotedHiddenId !== null ||
                          quotedContent === null,
                      },
              };
          if (
            message.recalledAt ||
            (message.msgType !== "image" && message.msgType !== "file")
          ) {
            return publicMessage;
          }
          try {
            const parsed = JSON.parse(message.content);
            const attachment = attachmentMap.get(Number(parsed.attachmentId));
            return attachment && attachment.kind === message.msgType
              ? { ...publicMessage, attachment }
              : { ...publicMessage, attachment: null };
          } catch {
            return { ...publicMessage, attachment: null };
          }
        }),
        nextCursor,
        canonicalConversationId,
        serviceConversationIds: support?.sourceIds,
        /** 对端已读到的最大消息 ID；发送方据此派生每条消息的已读/未读状态。 */
        peerLastReadMessageId,
        /** Aggregated official history must compare a message to its own source cursor. */
        peerLastReadMessageIds,
      };
    }),

  uploadAttachment: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        kind: z.enum(["image", "file"]),
        fileName: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().min(1).max(128),
        base64: z.string().min(1).max(MAX_CHAT_ATTACHMENT_BASE64),
        supportView: z.enum(["enterprise", "general"]).optional(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const db = await requireDb();
      return runWithReadyWeappConversationScope({
        executor: db,
        actorUserId: ctx.user.id,
        conversationId: input.conversationId,
        headers: ctx.req?.headers,
        action: () => next(),
      });
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const myId = ctx.user.id;
      const serviceUserId = await getServiceUserId();
      const transitionConversationId =
        await resolveChatTransitionCoreConversationId(
          db,
          myId,
          input.conversationId,
          serviceUserId
        );
      const transitionRow = await chatTransitionFindForConversation(
        db,
        myId,
        transitionConversationId
      );
      const transitionWrite = transitionRow
        ? await chatTransitionResolveWrite(db, {
            actorUserId: myId,
            conversationId: transitionConversationId,
            currentIdentity: await resolveActorBusinessIdentity(db, myId),
            serviceUserId,
          })
        : null;
      const scoped = transitionWrite
        ? null
        : await requireScopedConversation(db, myId, input.conversationId, {
            write: false,
          });
      if (!transitionWrite && !scoped)
        throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
      if (
        !transitionWrite &&
        (requireResolvedChatScope(scoped).conversation.identityContextKey ===
          "legacy" ||
          requireResolvedChatScope(scoped).conversation.identityContextKey ==
            null) &&
        requireResolvedChatScope(scoped).otherUserId !== serviceUserId
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "请先确认自己的企业身份后再上传附件",
        });
      }
      const myIdentity =
        transitionWrite?.messageIdentity ??
        requireResolvedChatScope(scoped).identity;
      const support =
        !transitionWrite &&
        requireResolvedChatScope(scoped).otherUserId === serviceUserId
          ? await resolveAccountSupportConversation(
              db,
              myId,
              serviceUserId,
              input.conversationId
            )
          : null;
      const supportView = support
        ? await resolveAccountSupportView(db, myId, input.supportView)
        : null;
      const attachmentConversationId =
        transitionWrite?.canonicalConversationId ??
        support?.canonicalId ??
        input.conversationId;
      const convResult = (await db.execute(sql`
        SELECT id, user1Id, user2Id FROM conversations
         WHERE id = ${attachmentConversationId}
           AND (user1Id = ${myId} OR user2Id = ${myId})
           AND (
             ${transitionWrite ? sql`TRUE` : conversationIdentityScopeSql("conversations", myId, myIdentity)}
             OR (user1Id = ${myId} AND user2Id = ${serviceUserId})
             OR (user2Id = ${myId} AND user1Id = ${serviceUserId})
           )
         LIMIT 1
      `)) as unknown as [ChatPairRow[], unknown];
      const convRows = convResult[0];
      const conversation = convRows[0];
      if (!conversation) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "无权向该会话上传文件",
        });
      }
      const contactUserId =
        conversation.user1Id === myId
          ? conversation.user2Id
          : conversation.user1Id;
      await assertConversationNotBlocked(
        db,
        myId,
        attachmentConversationId,
        contactUserId
      );
      const decoded = decodeChatAttachment(input);
      const relKey = `chat-attachments/conversation-${attachmentConversationId}/user-${myId}/${decoded.objectName}`;
      const stored = await storagePutPrivate(
        relKey,
        decoded.buffer,
        decoded.mimeType
      );
      await db.execute(sql`
        INSERT INTO chat_attachments
          (conversationId, uploaderUserId, kind, storageKey, originalName, mimeType, byteSize, sha256, supportEnterpriseId)
        VALUES
          (${attachmentConversationId}, ${myId}, ${input.kind}, ${stored.key}, ${decoded.originalName},
           ${decoded.mimeType}, ${decoded.byteSize}, ${decoded.sha256}, ${supportView?.scopeEnterpriseId ?? null})
      `);
      const idResult = (await db.execute(
        sql`SELECT LAST_INSERT_ID() AS id`
      )) as unknown as [{ id: number }[], unknown];
      const idRows = (
        idResult as unknown as [Array<{ id: number }>, unknown]
      )[0];
      const attachmentId = Number(idRows[0]?.id ?? 0);
      if (!attachmentId) throw new Error("附件写入后读取失败");
      return {
        attachmentId,
        kind: input.kind,
        originalName: decoded.originalName,
        mimeType: decoded.mimeType,
        byteSize: decoded.byteSize,
        url: await storageGetAccessUrl(stored.key, 3600),
      };
    }),

  getAttachmentUrl: protectedProcedure
    .input(
      z.object({
        attachmentId: z.number().int().positive(),
        supportView: z.enum(["enterprise", "general"]).optional(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const db = await requireDb();
      const conversationId = await attachmentConversationForActor(
        db,
        ctx.user.id,
        input.attachmentId
      );
      return runWithReadyWeappConversationScope({
        executor: db,
        actorUserId: ctx.user.id,
        conversationId,
        headers: ctx.req?.headers,
        action: () => next(),
      });
    })
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const initial = (await db.execute(sql`
        SELECT a.id, a.conversationId, a.kind, a.storageKey, a.originalName, a.mimeType, a.byteSize,
               a.supportEnterpriseId, c.user1Id, c.user2Id
          FROM chat_attachments a INNER JOIN conversations c ON c.id = a.conversationId
         WHERE a.id = ${input.attachmentId}
           AND (c.user1Id = ${ctx.user.id} OR c.user2Id = ${ctx.user.id}) LIMIT 1
      `)) as unknown as [(ChatAttachmentRow & ChatPairRow)[], unknown];
      const attachment = initial[0][0];
      if (!attachment)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "附件不存在或无权访问",
        });
      const serviceUserId = await getServiceUserId();
      const transitionConversationId =
        await resolveChatTransitionCoreConversationId(
          db,
          ctx.user.id,
          Number(attachment.conversationId),
          serviceUserId
        );
      const transitionRow = await chatTransitionFindForConversation(
        db,
        ctx.user.id,
        transitionConversationId
      );
      const transitionRead = transitionRow
        ? await chatTransitionResolveRead(db, {
            actorUserId: ctx.user.id,
            conversationId: transitionConversationId,
            currentIdentity: await resolveActorBusinessIdentity(
              db,
              ctx.user.id
            ),
            serviceUserId,
          })
        : null;
      const scoped = transitionRead
        ? null
        : await requireScopedConversation(
            db,
            ctx.user.id,
            Number(attachment.conversationId),
            { write: false }
          );
      if (!transitionRead && !scoped)
        throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
      if (
        !transitionRead &&
        requireResolvedChatScope(scoped).otherUserId === serviceUserId
      ) {
        const support = await resolveAccountSupportConversation(
          db,
          ctx.user.id,
          serviceUserId,
          Number(attachment.conversationId)
        );
        if (!support)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "附件不存在或无权访问",
          });
        const view = await resolveAccountSupportView(
          db,
          ctx.user.id,
          input.supportView
        );
        // Attachment access follows the exact same displayed support scopes as getMessages.
        const supportCompatibility = isWeappDefaultAccountSupportCompatibility(
          ctx,
          input.supportView,
          support
        );
        const displayedScopeEnterpriseIds = accountSupportDisplayedScopeIds(
          view,
          supportCompatibility
        );
        const allowed =
          attachment.supportEnterpriseId != null
            ? displayedScopeEnterpriseIds.includes(
                Number(attachment.supportEnterpriseId)
              )
            : await db
                .execute(
                  sql`
            SELECT 1 FROM messages attachment_message
            INNER JOIN conversations attachment_source ON attachment_source.id = attachment_message.conversationId
             WHERE attachment_message.conversationId IN (${accountSupportIdsSql(requireResolvedChatScope(support).sourceIds)})
               AND JSON_VALID(attachment_message.content)
               AND CAST(JSON_UNQUOTE(JSON_EXTRACT(attachment_message.content, '$.attachmentId')) AS UNSIGNED) = ${input.attachmentId}
               AND ${accountSupportMessageInDisplayedScopesSql("attachment_message", "attachment_source", ctx.user.id, serviceUserId, displayedScopeEnterpriseIds)}
             LIMIT 1
          `
                )
                .then(result =>
                  Boolean(chatSqlRows<{ found: number }>(result)[0])
                );
        if (!allowed)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "附件不属于当前客服范围",
          });
      }
      return {
        attachmentId: Number(attachment.id),
        kind: attachment.kind,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        byteSize: Number(attachment.byteSize),
        url: await storageGetAccessUrl(attachment.storageKey, 3600),
      };
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        msgType: z.enum(["text", "quote", "sticker", "image", "file"]),
        content: z.string().min(1).max(5e3),
        /** 可选引用目标；服务端只接受同一会话内、尚未撤回的消息。 */
        replyToMessageId: z.number().int().positive().optional(),
        /** 客户端生成的幂等键，旧版本客户端不传则由服务端生成。 */
        clientMessageId: z.string().min(1).max(64).optional(),
        supportView: z.enum(["enterprise", "general"]).optional(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const db = await requireDb();
      return runWithReadyWeappConversationScope({
        executor: db,
        actorUserId: ctx.user.id,
        conversationId: input.conversationId,
        headers: ctx.req?.headers,
        action: () => next(),
      });
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const myId = ctx.user.id;
      const serviceUserId = await getServiceUserId();
      const transitionConversationId =
        await resolveChatTransitionCoreConversationId(
          db,
          myId,
          input.conversationId,
          serviceUserId
        );
      const transitionRow = await chatTransitionFindForConversation(
        db,
        myId,
        transitionConversationId
      );
      const transitionWrite = transitionRow
        ? await chatTransitionResolveWrite(db, {
            actorUserId: myId,
            conversationId: transitionConversationId,
            currentIdentity: await resolveActorBusinessIdentity(db, myId),
            serviceUserId,
          })
        : null;
      const scoped = transitionWrite
        ? null
        : await requireScopedConversation(db, myId, input.conversationId, {
            write: false,
          });
      if (!transitionWrite && !scoped)
        throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
      if (
        !transitionWrite &&
        (requireResolvedChatScope(scoped).conversation.identityContextKey ===
          "legacy" ||
          requireResolvedChatScope(scoped).conversation.identityContextKey ==
            null) &&
        requireResolvedChatScope(scoped).otherUserId !== serviceUserId
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "请先确认自己的企业身份后再继续发送",
        });
      }
      const myIdentity =
        transitionWrite?.messageIdentity ??
        requireResolvedChatScope(scoped).identity;
      const clientMessageId = input.clientMessageId ?? randomUUID();
      const support =
        !transitionWrite &&
        requireResolvedChatScope(scoped).otherUserId === serviceUserId
          ? await resolveAccountSupportConversation(
              db,
              myId,
              serviceUserId,
              input.conversationId
            )
          : null;
      const supportView = support
        ? await resolveAccountSupportView(db, myId, input.supportView)
        : null;
      const messageIdentity =
        transitionWrite?.messageIdentity ??
        (supportView
          ? supportSendIdentity(myIdentity, supportView.supportView)
          : myIdentity);
      const senderIdentityContextKey =
        transitionWrite?.messageIdentity.identityKey ??
        actorIdentityContextKey(myId, messageIdentity);
      const conversationId =
        transitionWrite?.canonicalConversationId ??
        support?.canonicalId ??
        input.conversationId;
      const transitionMessageSourceConversationIds =
        transitionWrite?.messageSourceConversationIds ?? [conversationId];
      const transitionReadSourceConversationIds =
        transitionWrite?.sourceConversationIds ?? [conversationId];
      let content = input.content;
      let preview = input.content;
      if (input.msgType === "quote") {
        try {
          const quoteData = JSON.parse(input.content);
          preview = `[报价单] ${quoteData.partNumber} × ${quoteData.qty}${quoteData.unit}`;
        } catch {
          preview = "[报价单]";
        }
      } else if (input.msgType === "sticker") {
        const stickerLabel = getStickerLabel(input.content);
        if (!stickerLabel) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "该表情不可用" });
        }
        preview = `[表情] ${stickerLabel}`;
      } else if (input.msgType === "image" || input.msgType === "file") {
        let attachmentId = 0;
        try {
          const parsed = JSON.parse(input.content);
          attachmentId = Number(parsed.attachmentId);
        } catch {
          attachmentId = 0;
        }
        if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "附件引用无效，请重新上传",
          });
        }
        const attachmentResult = (await db.execute(sql`
          SELECT id, conversationId, uploaderUserId, kind, originalName
            FROM chat_attachments
           WHERE id = ${attachmentId}
             AND conversationId IN (${accountSupportIdsSql(support?.sourceIds ?? transitionMessageSourceConversationIds)})
             AND uploaderUserId = ${myId}
             AND ${
               supportView && support
                 ? sql`(
               supportEnterpriseId = ${supportView.scopeEnterpriseId}
               OR (
                 supportEnterpriseId IS NULL
                 AND EXISTS (
                   SELECT 1
                     FROM messages attachment_message
                     INNER JOIN conversations attachment_source
                       ON attachment_source.id = attachment_message.conversationId
                    WHERE attachment_message.conversationId IN (${accountSupportIdsSql(requireResolvedChatScope(support).sourceIds)})
                      AND JSON_VALID(attachment_message.content)
                      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(attachment_message.content, '$.attachmentId')) AS UNSIGNED) = ${attachmentId}
                      AND ${accountSupportMessageInViewSql("attachment_message", "attachment_source", myId, serviceUserId, supportView.scopeEnterpriseId)}
                 )
               )
             )`
                 : sql`supportEnterpriseId <=> NULL`
             }
           LIMIT 1
        `)) as unknown as [ChatAttachmentRow[], unknown];
        const attachmentRows = (
          attachmentResult as unknown as [
            Array<{
              id: number;
              conversationId: number;
              uploaderUserId: number;
              kind: "image" | "file";
              originalName: string;
            }>,
            unknown,
          ]
        )[0];
        const attachment = attachmentRows[0];
        if (!attachment || attachment.kind !== input.msgType) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "附件不存在、类型不符或不属于当前会话",
          });
        }
        content = JSON.stringify({ attachmentId: Number(attachment.id) });
        preview =
          input.msgType === "image"
            ? "[图片]"
            : `[文件] ${attachment.originalName}`;
        if (preview.length > 50) preview = preview.slice(0, 50) + "…";
      } else {
        preview =
          input.content.length > 50
            ? input.content.slice(0, 50) + "…"
            : input.content;
      }
      const stored = await db.transaction(async tx => {
        const convCheck = (await tx.execute(sql`
          SELECT id, user1Id, user2Id, currentRound, endedAt
            FROM conversations
           WHERE id = ${conversationId}
             AND (user1Id = ${myId} OR user2Id = ${myId})
             AND (
               ${transitionWrite ? sql`TRUE` : conversationIdentityScopeSql("conversations", myId, myIdentity)}
               OR (user1Id = ${myId} AND user2Id = ${serviceUserId})
               OR (user2Id = ${myId} AND user1Id = ${serviceUserId})
             )
           LIMIT 1
           FOR UPDATE
        `)) as unknown as [ChatCurrentConversationRow[], unknown];
        const convRows = convCheck[0];
        if (convRows.length === 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
        }
        const conv = convRows[0];
        const otherId = conv.user1Id === myId ? conv.user2Id : conv.user1Id;
        await assertConversationNotBlocked(tx, myId, conversationId, otherId);
        if (input.msgType === "sticker" && otherId === serviceUserId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "客服会话暂不支持发送表情",
          });
        }
        let replyTo: {
          id: number;
          senderId: number;
          msgType: MessageRow["msgType"];
          content: string;
          unavailable: false;
        } | null = null;
        if (input.replyToMessageId) {
          const quotedResult = (await tx.execute(sql`
            SELECT id, senderId, msgType, content
             FROM messages
              ${supportView ? sql`INNER JOIN conversations quote_source ON quote_source.id = messages.conversationId` : sql``}
             WHERE id = ${input.replyToMessageId}
               AND conversationId IN (${accountSupportIdsSql(support?.sourceIds ?? transitionReadSourceConversationIds)})
               ${supportView ? sql`AND ${accountSupportMessageInViewSql("messages", "quote_source", myId, serviceUserId, supportView.scopeEnterpriseId)}` : sql``}
               ${
                 transitionWrite
                   ? sql`AND EXISTS (
                 SELECT 1 FROM conversation_user_settings transition_quote_view
                  WHERE transition_quote_view.conversationId = messages.conversationId
                    AND transition_quote_view.userId = ${myId}
                    AND transition_quote_view.deleted = 0
               )`
                   : sql``
               }
               AND recalledAt IS NULL
               AND id > COALESCE((
                 SELECT ${
                   supportView
                     ? sql`quote_view.deletedBeforeMessageId
                     FROM account_support_view_settings quote_view
                    WHERE quote_view.userId = ${myId}
                      AND quote_view.scopeEnterpriseId = ${supportView.scopeEnterpriseId}`
                     : sql`quote_settings.clearedBeforeMessageId
                     FROM conversation_user_settings quote_settings
                    WHERE quote_settings.conversationId = messages.conversationId
                      AND quote_settings.userId = ${myId}`
                 }
                  LIMIT 1
               ), 0)
               AND NOT EXISTS (
                 SELECT 1 FROM chat_message_user_hidden hidden_quote
                  WHERE hidden_quote.messageId = messages.id AND hidden_quote.userId = ${myId}
               )
             LIMIT 1
          `)) as unknown as [
            Pick<MessageRow, "id" | "senderId" | "msgType" | "content">[],
            unknown,
          ];
          const quotedRows = (
            quotedResult as unknown as [
              Array<{
                id: number;
                senderId: number;
                msgType: MessageRow["msgType"];
                content: string;
              }>,
              unknown,
            ]
          )[0];
          const quoted = quotedRows[0];
          if (!quoted) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "引用的消息已不可用",
            });
          }
          replyTo = {
            id: Number(quoted.id),
            senderId: Number(quoted.senderId),
            msgType: quoted.msgType,
            content: quoted.content,
            unavailable: false,
          };
        }
        const existingResult = (await tx.execute(sql`
          SELECT id, conversationId, senderId, clientMessageId, msgType, content,
                 replyToMessageId, recalledAt, recalledByUserId, createdAt
            FROM messages
           WHERE senderId = ${myId}
               AND senderIdentityContextKey = ${senderIdentityContextKey}
               AND clientMessageId = ${clientMessageId}
           LIMIT 1
        `)) as unknown as [MessageRow[], unknown];
        const existingRows = (
          existingResult as unknown as [Array<MessageRow>, unknown]
        )[0];
        const existing = existingRows[0];
        if (existing) {
          if (
            (!transitionWrite && existing.conversationId !== conversationId) ||
            (transitionWrite &&
              !transitionMessageSourceConversationIds.includes(
                Number(existing.conversationId)
              )) ||
            existing.msgType !== input.msgType ||
            existing.content !== content ||
            Number(existing.replyToMessageId ?? 0) !==
              Number(input.replyToMessageId ?? 0)
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "消息幂等键与原请求不一致",
            });
          }
          return {
            message: { ...existing, replyTo },
            deduplicated: true,
            conv,
          };
        }
        await tx.execute(sql`
          INSERT INTO messages
            (conversationId, senderId, senderEnterpriseId, senderCompanyId, senderCompanyNameSnapshot,
             senderIdentityContextKey, clientMessageId, msgType, content, replyToMessageId, supportScopeEnterpriseId)
          VALUES
            (${conversationId}, ${myId}, ${messageIdentity.enterpriseId},
             ${messageIdentity.companyId}, ${messageIdentity.companyName},
             ${senderIdentityContextKey}, ${clientMessageId}, ${input.msgType}, ${content},
             ${input.replyToMessageId ?? null}, ${supportView?.scopeEnterpriseId ?? null})
        `);
        const insertedIdResult = (await tx.execute(
          sql`SELECT LAST_INSERT_ID() as id`
        )) as unknown as [{ id: number }[], unknown];
        const insertedId = Number(
          (
            insertedIdResult as unknown as [Array<{ id: number }>, unknown]
          )[0][0]?.id ?? 0
        );
        if (conv.endedAt) {
          await tx.execute(sql`
            UPDATE conversations
               SET currentRound = currentRound + 1,
                   roundStartedAt = NOW(),
                   roundStartMessageId = ${insertedId > 0 ? insertedId : null},
                   endedAt = NULL,
                   endedByUserId = NULL,
                   lastMessageAt = NOW(),
                   lastMessagePreview = ${preview}
             WHERE id = ${conversationId}
          `);
        } else {
          await tx.execute(sql`
            UPDATE conversations
               SET lastMessageAt = NOW(), lastMessagePreview = ${preview}
             WHERE id = ${conversationId}
          `);
        }
        if (supportView) {
          await tx.execute(sql`
            INSERT INTO account_support_view_settings
              (userId, scopeEnterpriseId, lastReadMessageId, deletedBeforeMessageId, deleted)
            VALUES (${myId}, ${supportView.scopeEnterpriseId}, 0, 0, 0)
            ON DUPLICATE KEY UPDATE deleted = 0, updatedAt = NOW()
          `);
        }
        await tx.execute(sql`
          UPDATE conversation_user_settings
             SET deleted = 0,
                 unreadCount = CASE WHEN deleted = 1 THEN 1 ELSE unreadCount + 1 END
           WHERE conversationId = ${conversationId} AND userId = ${otherId}
        `);
        await tx.execute(sql`
          UPDATE inventory_inquiries
             SET lastActivityAt = NOW(),
                 firstResponseAt = CASE
                   WHEN assigneeUserId = ${myId} AND firstResponseAt IS NULL THEN NOW()
                   ELSE firstResponseAt
                 END,
                 status = CASE
                   WHEN assigneeUserId = ${myId} AND status = 'open' THEN 'replied'
                   ELSE status
                 END
           WHERE conversationId = ${conversationId}
             AND status IN ('open', 'replied')
             AND (buyerUserId = ${myId} OR assigneeUserId = ${myId})
        `);
        const messageResult = (await tx.execute(sql`
          SELECT id, conversationId, senderId, clientMessageId, msgType, content,
                 replyToMessageId, recalledAt, recalledByUserId, createdAt
            FROM messages WHERE id = ${insertedId} LIMIT 1
        `)) as unknown as [MessageRow[], unknown];
        const messageRows = (
          messageResult as unknown as [Array<MessageRow>, unknown]
        )[0];
        const message = messageRows[0];
        if (!message) throw new Error("消息写入后读取失败");
        return { message: { ...message, replyTo }, deduplicated: false, conv };
      });
      if (
        input.msgType === "text" &&
        !stored.deduplicated &&
        Number(stored.message.id) > 0
      ) {
        try {
          const { isService } = await isServiceConversation(stored.conv);
          if (isService) {
            await enqueueChatSyncEvent({
              eventKey: `push:${Number(stored.message.id)}`,
              eventType: "push_service_message",
              conversationId,
              messageId: Number(stored.message.id),
            });
          }
        } catch (err) {
          console.error("[chat.sendMessage] 投递客服推送事件失败:", err);
        }
      }
      return {
        ok: true,
        message: stored.message,
        deduplicated: stored.deduplicated,
      };
    }),

  deleteMessageForMe: protectedProcedure
    .input(
      z.object({
        messageId: z.number().int().positive(),
        supportView: z.enum(["enterprise", "general"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const sourceResult = (await db.execute(sql`
        SELECT message_rows.conversationId
          FROM messages message_rows
          INNER JOIN conversations conversation_rows ON conversation_rows.id = message_rows.conversationId
         WHERE message_rows.id = ${input.messageId}
           AND (conversation_rows.user1Id = ${ctx.user.id} OR conversation_rows.user2Id = ${ctx.user.id})
         LIMIT 1
      `)) as unknown as [{ conversationId: number }[], unknown];
      const source = sourceResult[0][0];
      if (!source)
        throw new TRPCError({ code: "FORBIDDEN", message: "无权删除该消息" });
      const scoped = await requireScopedConversation(
        db,
        ctx.user.id,
        Number(source.conversationId),
        { write: false }
      );
      const identity = requireResolvedChatScope(scoped).identity;
      const serviceUserId = await getServiceUserId();
      const support =
        requireResolvedChatScope(scoped).otherUserId === serviceUserId
          ? await resolveAccountSupportConversation(
              db,
              ctx.user.id,
              serviceUserId,
              Number(source.conversationId)
            )
          : null;
      const supportView = support
        ? await resolveAccountSupportView(db, ctx.user.id, input.supportView)
        : null;
      return db.transaction(async tx => {
        const messageResult = (await tx.execute(sql`
          SELECT message_rows.id, message_rows.conversationId, message_rows.senderId,
                 ${supportView ? sql`NULL` : sql`settings.lastReadMessageId`} AS lastReadMessageId
            FROM messages message_rows
            INNER JOIN conversations conversation_rows
              ON conversation_rows.id = message_rows.conversationId
            ${
              supportView
                ? sql``
                : sql`INNER JOIN conversation_user_settings settings
              ON settings.conversationId = message_rows.conversationId
             AND settings.userId = ${ctx.user.id}`
            }
           WHERE message_rows.id = ${input.messageId}
             AND (conversation_rows.user1Id = ${ctx.user.id} OR conversation_rows.user2Id = ${ctx.user.id})
             AND ${
               supportView
                 ? sql`(
               message_rows.conversationId IN (${accountSupportIdsSql(requireResolvedChatScope(support).sourceIds)})
               AND ${accountSupportMessageInViewSql(
                 "message_rows",
                 "conversation_rows",
                 ctx.user.id,
                 serviceUserId,
                 supportView.scopeEnterpriseId
               )}
             )`
                 : sql`(
               ${conversationIdentityScopeSql("conversation_rows", ctx.user.id, identity)}
               OR (conversation_rows.user1Id = ${ctx.user.id} AND conversation_rows.user2Id = ${serviceUserId})
               OR (conversation_rows.user2Id = ${ctx.user.id} AND conversation_rows.user1Id = ${serviceUserId})
             )`
             }
           LIMIT 1
           FOR UPDATE
        `)) as unknown as [
          {
            id: number;
            conversationId: number;
            senderId: number;
            lastReadMessageId: number | null;
          }[],
          unknown,
        ];
        const message = (
          messageResult as unknown as [
            Array<{
              id: number;
              conversationId: number;
              senderId: number;
              lastReadMessageId: number | null;
            }>,
            unknown,
          ]
        )[0][0];
        if (!message) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权删除该消息" });
        }
        await tx.execute(sql`
          INSERT INTO chat_message_user_hidden (messageId, userId)
          VALUES (${input.messageId}, ${ctx.user.id})
          ON DUPLICATE KEY UPDATE hiddenAt = hiddenAt
        `);
        if (
          !supportView &&
          Number(message.senderId) !== ctx.user.id &&
          Number(message.id) > Number(message.lastReadMessageId ?? 0)
        ) {
          await tx.execute(sql`
            UPDATE conversation_user_settings
               SET unreadCount = GREATEST(unreadCount - 1, 0)
             WHERE conversationId = ${message.conversationId}
               AND userId = ${ctx.user.id}
          `);
        }
        return {
          ok: true,
          messageId: Number(message.id),
          conversationId: Number(message.conversationId),
        };
      });
    }),

  recallMessage: protectedProcedure
    .input(
      z.object({
        messageId: z.number().int().positive(),
        supportView: z.enum(["enterprise", "general"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const sourceResult = (await db.execute(sql`
        SELECT message_rows.conversationId
          FROM messages message_rows
          INNER JOIN conversations conversation_rows ON conversation_rows.id = message_rows.conversationId
         WHERE message_rows.id = ${input.messageId}
           AND (conversation_rows.user1Id = ${ctx.user.id} OR conversation_rows.user2Id = ${ctx.user.id})
         LIMIT 1
      `)) as unknown as [{ conversationId: number }[], unknown];
      const source = sourceResult[0][0];
      if (!source)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "只能撤回自己发送的消息",
        });
      const scoped = await requireScopedConversation(
        db,
        ctx.user.id,
        Number(source.conversationId),
        { write: false }
      );
      const identity = requireResolvedChatScope(scoped).identity;
      const serviceUserId = await getServiceUserId();
      const support =
        requireResolvedChatScope(scoped).otherUserId === serviceUserId
          ? await resolveAccountSupportConversation(
              db,
              ctx.user.id,
              serviceUserId,
              Number(source.conversationId)
            )
          : null;
      const supportView = support
        ? await resolveAccountSupportView(db, ctx.user.id, input.supportView)
        : null;
      return db.transaction(async tx => {
        const messageResult = await tx.execute(sql`
          SELECT message_rows.id, message_rows.conversationId, message_rows.senderId,
                 message_rows.msgType, message_rows.recalledAt,
                 TIMESTAMPDIFF(SECOND, message_rows.createdAt, NOW()) AS ageSeconds,
                 conversation_rows.user1Id, conversation_rows.user2Id
            FROM messages message_rows
            INNER JOIN conversations conversation_rows
              ON conversation_rows.id = message_rows.conversationId
           WHERE message_rows.id = ${input.messageId}
             AND (conversation_rows.user1Id = ${ctx.user.id} OR conversation_rows.user2Id = ${ctx.user.id})
             AND ${
               supportView
                 ? sql`(
               message_rows.conversationId IN (${accountSupportIdsSql(requireResolvedChatScope(support).sourceIds)})
               AND ${accountSupportMessageInViewSql(
                 "message_rows",
                 "conversation_rows",
                 ctx.user.id,
                 serviceUserId,
                 supportView.scopeEnterpriseId
               )}
             )`
                 : sql`(
               ${conversationIdentityScopeSql("conversation_rows", ctx.user.id, identity)}
               OR (conversation_rows.user1Id = ${ctx.user.id} AND conversation_rows.user2Id = ${serviceUserId})
               OR (conversation_rows.user2Id = ${ctx.user.id} AND conversation_rows.user1Id = ${serviceUserId})
             )`
             }
           LIMIT 1
           FOR UPDATE
        `);
        const message = (
          messageResult as unknown as [
            Array<{
              id: number;
              conversationId: number;
              senderId: number;
              msgType: string;
              recalledAt: Date | null;
              ageSeconds: number;
              user1Id: number;
              user2Id: number;
            }>,
            unknown,
          ]
        )[0][0];
        if (!message || Number(message.senderId) !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "只能撤回自己发送的消息",
          });
        }
        if (message.recalledAt) {
          return {
            ok: true,
            messageId: Number(message.id),
            recalledAt: message.recalledAt,
          };
        }
        if (
          Number(message.user1Id) === serviceUserId ||
          Number(message.user2Id) === serviceUserId
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "官方客服消息暂不支持撤回",
          });
        }
        if (
          !(RECALLABLE_CHAT_MESSAGE_TYPES as readonly string[]).includes(
            message.msgType
          )
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "该类型消息不可撤回",
          });
        }
        const ageSeconds = Number(message.ageSeconds);
        if (
          !Number.isFinite(ageSeconds) ||
          ageSeconds < 0 ||
          ageSeconds > CHAT_MESSAGE_RECALL_WINDOW_SECONDS
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "消息发送超过10分钟，不能撤回",
          });
        }
        await tx.execute(sql`
          UPDATE messages
             SET recalledAt = NOW(), recalledByUserId = ${ctx.user.id}
           WHERE id = ${input.messageId} AND recalledAt IS NULL
        `);
        await tx.execute(sql`
          UPDATE chat_sync_outbox
             SET status = 'succeeded',
                 lockedAt = NULL,
                 lockedBy = NULL,
                 lastError = '消息在投递前已撤回',
                 updatedAt = NOW()
           WHERE messageId = ${input.messageId}
             AND eventType = 'push_service_message'
             AND status = 'pending'
        `);
        await tx.execute(sql`
          UPDATE conversations
             SET lastMessagePreview = '[消息已撤回]', updatedAt = NOW()
           WHERE id = ${message.conversationId}
             AND NOT EXISTS (
               SELECT 1 FROM messages newer
                WHERE newer.conversationId = ${message.conversationId}
                  AND newer.id > ${input.messageId}
             )
        `);
        const recalledResult = await tx.execute(sql`
          SELECT recalledAt FROM messages WHERE id = ${input.messageId} LIMIT 1
        `);
        const recalledAt = (
          recalledResult as unknown as [Array<{ recalledAt: Date }>, unknown]
        )[0][0]?.recalledAt;
        return { ok: true, messageId: Number(message.id), recalledAt };
      });
    }),

  getInventoryInquiryStatus: protectedProcedure
    .input(
      z.object({
        inventoryId: z.number().int().positive(),
        clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
      })
    )
    .query(async ({ ctx, input }) => {
      ctx.res.setHeader("Cache-Control", "private, no-store");
      const db = await requireDb();
      const buyerIdentity = await resolveActorBusinessIdentity(db, ctx.user.id);
      const buyerIdentityContextKey = actorIdentityContextKey(
        ctx.user.id,
        buyerIdentity
      );
      const result = (await db.execute(sql`
        SELECT iq.inventoryId, iq.conversationId, m.senderId AS messageSenderId
          FROM inventory_inquiries iq
          LEFT JOIN messages m ON m.id = iq.messageId
         WHERE iq.buyerIdentityContextKey = ${buyerIdentityContextKey}
           AND iq.clientMessageId = ${input.clientMessageId}
         LIMIT 1
      `)) as unknown as [
        {
          inventoryId: number;
          conversationId: number;
          messageSenderId: number | null;
        }[],
        unknown,
      ];
      const found = (
        result as unknown as [
          Array<{
            inventoryId: number;
            conversationId: number;
            messageSenderId: number | null;
          }>,
          unknown,
        ]
      )[0][0];
      if (found) {
        if (Number(found.inventoryId) !== input.inventoryId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "询价标识与物料不匹配",
          });
        }
        return Number(found.messageSenderId) === ctx.user.id
          ? { status: "sent", conversationId: Number(found.conversationId) }
          : { status: "uncertain", conversationId: null };
      }
      if (
        buyerIdentity.enterpriseId === null &&
        isLegacyChatPreactivationCompatibilityEnabled()
      ) {
        const legacyResult = (await db.execute(sql`
          SELECT iq.inventoryId, iq.conversationId, m.senderId AS messageSenderId,
                 c.user1Id, c.user2Id
            FROM inventory_inquiries iq
            INNER JOIN conversations c ON c.id = iq.conversationId
            LEFT JOIN messages m ON m.id = iq.messageId
           WHERE iq.buyerUserId = ${ctx.user.id}
             AND iq.buyerIdentityContextKey = 'legacy'
             AND iq.clientMessageId = ${input.clientMessageId}
             AND (c.identityContextKey = 'legacy' OR c.identityContextKey IS NULL)
           LIMIT 2
        `)) as unknown as [
          {
            inventoryId: number;
            conversationId: number;
            messageSenderId: number | null;
            user1Id: number;
            user2Id: number;
          }[],
          unknown,
        ];
        const legacyRows = legacyResult[0];
        const legacy = legacyRows[0];
        if (legacyRows.length > 1) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "历史个人会话只读，请从当前企业身份重新发起会话",
          });
        }
        if (legacy) {
          if (
            Number(legacy.user1Id) !== ctx.user.id &&
            Number(legacy.user2Id) !== ctx.user.id
          ) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "历史询价与当前账号的会话归属不一致",
            });
          }
          const otherUserId =
            Number(legacy.user1Id) === ctx.user.id
              ? Number(legacy.user2Id)
              : Number(legacy.user1Id);
          if (
            !(await canWriteLegacyDirectConversationPreactivation(
              db,
              ctx.user.id,
              otherUserId
            ))
          ) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "历史个人会话只读，请从当前企业身份重新发起会话",
            });
          }
          if (Number(legacy.inventoryId) !== input.inventoryId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "询价标识与物料不匹配",
            });
          }
          return Number(legacy.messageSenderId) === ctx.user.id
            ? { status: "sent", conversationId: Number(legacy.conversationId) }
            : { status: "uncertain", conversationId: null };
        }
      }
      const stray = (await db.execute(sql`
        SELECT id FROM messages
         WHERE senderId = ${ctx.user.id}
           AND senderIdentityContextKey = ${buyerIdentityContextKey}
           AND clientMessageId = ${input.clientMessageId}
         LIMIT 1
      `)) as unknown as [{ id: number }[], unknown];
      const strayRows = (
        stray as unknown as [Array<{ id: number }>, unknown]
      )[0];
      return strayRows.length
        ? { status: "uncertain", conversationId: null }
        : { status: "unsent", conversationId: null };
    }),

  startInventoryInquiry: protectedProcedure
    .input(
      z.object({
        inventoryId: z.number().int().positive(),
        initiatorUserId: z.number().int().positive(),
        inquiryProtocol: z.literal("buyer-bound-v3"),
        qty: z.number().int().positive().max(1e9).nullable(),
        source: z
          .enum([
            "search",
            "detail",
            "recommend",
            "quote",
            "data_hub",
            "company",
          ])
          .optional(),
        clientMessageId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
      })
    )
    .mutation(async ({ ctx, input }) => {
      type ExistingInventoryInquiry = MessageRow & {
        inquiryId: number;
        inventoryId: number;
        conversationId: number;
        assigneeUserId: number;
        assigneeName: string | null;
        assigneeUsername: string | null;
        companyName: string | null;
      };
      type RoutedInventory = {
        id: number;
        sellerUserId: number;
        enterpriseId: number | null;
        ownerUserId: number | null;
        partNumber: string;
        brand: string;
        pkg: string | null;
        moq: number | null;
        qtyOnSale: number;
        companyName: string | null;
        superAdminUserId: number | null;
        ownerName: string | null;
        ownerUsername: string | null;
      };

      const buyerUserId = ctx.user.id;
      if (input.initiatorUserId !== buyerUserId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "询价账号已变化，请刷新后再试",
        });
      }
      const db = await requireDb();
      const buyerIdentity = await resolveActorBusinessIdentity(db, buyerUserId);
      const buyerIdentityContextKey = actorIdentityContextKey(
        buyerUserId,
        buyerIdentity
      );
      const clientMessageId = input.clientMessageId;
      const findExistingInquiry = async (
        executor: ChatSqlExecutor,
        identityContextKey = buyerIdentityContextKey
      ) => {
        const existingInquiryResult = await executor.execute(sql`
          SELECT iq.id AS inquiryId, iq.inventoryId, iq.conversationId, iq.assigneeUserId,
                 m.id, m.senderId, m.clientMessageId, m.msgType, m.content, m.createdAt,
                 assignee.name AS assigneeName, assignee.username AS assigneeUsername,
                 e.companyName, c.user1Id, c.user2Id,
                 c.identityContextKey AS conversationIdentityContextKey
            FROM inventory_inquiries iq
            INNER JOIN messages m ON m.id = iq.messageId
            INNER JOIN conversations c ON c.id = iq.conversationId
            LEFT JOIN users assignee ON assignee.id = iq.assigneeUserId
            LEFT JOIN enterprises e ON e.id = iq.enterpriseId
           WHERE iq.buyerUserId = ${buyerUserId}
             AND iq.buyerIdentityContextKey = ${identityContextKey}
             AND iq.clientMessageId = ${clientMessageId}
           LIMIT 1
        `);
        return (
          existingInquiryResult as unknown as [
            ExistingInventoryInquiry[],
            unknown,
          ]
        )[0][0];
      };
      const storedMessage = (
        existingInquiry: ExistingInventoryInquiry
      ): MessageRow => ({
        id: Number(existingInquiry.id),
        conversationId: Number(existingInquiry.conversationId),
        senderId: Number(existingInquiry.senderId),
        clientMessageId: existingInquiry.clientMessageId,
        msgType: existingInquiry.msgType,
        content: existingInquiry.content,
        createdAt: existingInquiry.createdAt,
        replyToMessageId: null,
        recalledAt: null,
        recalledByUserId: null,
      });
      const existingInquiryResponse = (
        existingInquiry: ExistingInventoryInquiry
      ) => {
        if (Number(existingInquiry.inventoryId) !== input.inventoryId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "询价标识与物料不匹配",
          });
        }
        return {
          inquiryId: Number(existingInquiry.inquiryId),
          conversationId: Number(existingInquiry.conversationId),
          assigneeUserId: Number(existingInquiry.assigneeUserId),
          assigneeName:
            existingInquiry.assigneeName?.trim() ||
            existingInquiry.assigneeUsername?.trim() ||
            existingInquiry.companyName ||
            "供应商",
          companyName: existingInquiry.companyName,
          message: storedMessage(existingInquiry),
          deduplicated: true,
        };
      };
      const existingBeforeRouting = await findExistingInquiry(db);
      if (existingBeforeRouting) {
        const existing = existingInquiryResponse(existingBeforeRouting);
        return { ok: true, ...existing };
      }
      const inventoryResult = await db.execute(sql`
        SELECT i.id, i.userId AS sellerUserId, i.enterpriseId, i.ownerUserId,
               i.partNumber, i.brand, i.pkg, i.moq, i.qtyOnSale,
               e.companyName, e.superAdminUserId,
               owner.name AS ownerName, owner.username AS ownerUsername
          FROM inventories i
          LEFT JOIN enterprises e ON e.id = i.enterpriseId
          LEFT JOIN users owner ON owner.id = i.ownerUserId
         WHERE i.id = ${input.inventoryId}
           AND i.status = 'published'
           AND i.qtyOnSale > 0
         LIMIT 1
      `);
      const inventoryRows = (
        inventoryResult as unknown as [RoutedInventory[], unknown]
      )[0];
      const inventory = inventoryRows[0];
      if (!inventory) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "该库存已下架或售罄",
        });
      }
      const assigneeUserId = await resolveInventoryInquiryRecipient(db, {
        inventoryId: Number(inventory.id),
        enterpriseId:
          inventory.enterpriseId == null
            ? null
            : Number(inventory.enterpriseId),
        ownerUserId:
          inventory.ownerUserId == null ? null : Number(inventory.ownerUserId),
        sellerUserId: Number(inventory.sellerUserId),
      });
      if (!assigneeUserId || assigneeUserId === buyerUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不能询价自己的库存",
        });
      }
      const assigneeIdentity = await resolveConversationCounterpartyIdentity(
        db,
        assigneeUserId,
        inventory.enterpriseId == null ? void 0 : Number(inventory.enterpriseId)
      );
      const [conversationUser1, conversationUser2] = orderedConversationParties(
        participantSnapshot(buyerUserId, buyerIdentity),
        participantSnapshot(assigneeUserId, assigneeIdentity)
      );
      const assigneeResult = await db.execute(sql`
        SELECT name, username FROM users WHERE id = ${assigneeUserId} LIMIT 1
      `);
      const assigneeRows = (
        assigneeResult as unknown as [
          Array<{ name: string | null; username: string | null }>,
          unknown,
        ]
      )[0];
      const assignee = assigneeRows[0];
      if (
        inventory.enterpriseId &&
        Number(buyerIdentity.enterpriseId ?? 0) ===
          Number(inventory.enterpriseId)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不能询价本公司的库存",
        });
      }
      const buyerResult = await db.execute(sql`
        SELECT u.name AS userName, u.username,
               comp.companyName, comp.certLevel, comp.reviewStatus
          FROM users u
          LEFT JOIN companies comp ON comp.id = ${buyerIdentity.companyId}
         WHERE u.id = ${buyerUserId}
         LIMIT 1
      `);
      const buyerRows = (
        buyerResult as unknown as [
          Array<{
            userName: string | null;
            username: string | null;
            companyName: string | null;
            certLevel: string | null;
            reviewStatus: string | null;
          }>,
          unknown,
        ]
      )[0];
      const buyer = buyerRows[0];
      const buyerName = buyerIdentity.displayName;
      const buyerCertified =
        (buyer?.certLevel === "certified" || buyer?.certLevel === "premium") &&
        buyer?.reviewStatus === "approved";
      let buyerTradeCount = 0;
      try {
        const tradeResult = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM orders
           WHERE buyerId = ${buyerUserId}
             AND doneAt IS NOT NULL
             AND status NOT IN ('cancel', 'refund')
        `);
        buyerTradeCount = Number(
          (tradeResult as unknown as [Array<{ cnt: number }>, unknown])[0][0]
            ?.cnt ?? 0
        );
      } catch {
        buyerTradeCount = 0;
      }
      const sourceLabels: Record<string, string> = {
        search: "搜索页",
        detail: "商品详情页",
        recommend: "今日推荐",
        quote: "需求报价",
        data_hub: "数据通",
        company: "企业主页",
      };
      const requestedQty = storedInquiryQuantity(input.qty);
      const quantityText = inquiryQuantityText(input.qty);
      const cardContent = JSON.stringify({
        kind: "quick",
        partNumber: inventory.partNumber,
        brand: inventory.brand || void 0,
        pkg: inventory.pkg || void 0,
        requestedQty: input.qty,
        unit: INQUIRY_QUANTITY_UNIT,
        buyerName,
        buyerCertified,
        buyerTradeCount,
        sourceLabel: input.source ? sourceLabels[input.source] : void 0,
        supplierQtyOnSale: Number(inventory.qtyOnSale),
      });
      const preview = `[询价单] ${inventory.partNumber} × ${quantityText}`;
      const user1Id = conversationUser1.userId;
      const user2Id = conversationUser2.userId;
      const pairLockName = `dianzi51_inquiry_pair_${user1Id}_${user2Id}`;
      const idempotencyLockName = `dianzi51_iq_${createHash("sha256").update(`${buyerIdentityContextKey}:${clientMessageId}`).digest("hex").slice(0, 48)}`;
      const stored = await db.transaction(async tx => {
        const idempotencyLockResult = await tx.execute(sql`
          SELECT GET_LOCK(${idempotencyLockName}, 10) AS acquired
        `);
        const idempotencyLockRows = (
          idempotencyLockResult as unknown as [
            Array<{ acquired: number }>,
            unknown,
          ]
        )[0];
        if (Number(idempotencyLockRows[0]?.acquired ?? 0) !== 1) {
          throw new TRPCError({
            code: "TIMEOUT",
            message: "询价提交繁忙，请重试",
          });
        }
        try {
          const existingInquiry = await findExistingInquiry(tx);
          if (existingInquiry) return existingInquiryResponse(existingInquiry);
          const lockResult = await tx.execute(
            sql`SELECT GET_LOCK(${pairLockName}, 10) AS acquired`
          );
          const lockRows = (
            lockResult as unknown as [Array<{ acquired: number }>, unknown]
          )[0];
          if (Number(lockRows[0]?.acquired ?? 0) !== 1) {
            throw new TRPCError({
              code: "TIMEOUT",
              message: "询价提交繁忙，请重试",
            });
          }
          try {
            if (inventory.enterpriseId) {
              const lockedEnterpriseResult = await tx.execute(sql`
                SELECT id FROM enterprises
                 WHERE id = ${inventory.enterpriseId}
                 LIMIT 1
                 FOR UPDATE
              `);
              const lockedEnterpriseRows = (
                lockedEnterpriseResult as unknown as [
                  Array<{ id: number }>,
                  unknown,
                ]
              )[0];
              if (!lockedEnterpriseRows[0]) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "库存所属企业已变化，请重试",
                });
              }
            }
            const lockedInventoryResult = await tx.execute(sql`
              SELECT enterpriseId, userId AS sellerUserId, ownerUserId, status, qtyOnSale
                FROM inventories
               WHERE id = ${inventory.id}
               LIMIT 1
               FOR UPDATE
            `);
            const lockedInventoryRows = (
              lockedInventoryResult as unknown as [
                Array<{
                  enterpriseId: number | null;
                  sellerUserId: number;
                  ownerUserId: number | null;
                  status: string;
                  qtyOnSale: number;
                }>,
                unknown,
              ]
            )[0];
            const lockedInventory = lockedInventoryRows[0];
            if (
              !lockedInventory ||
              lockedInventory.status !== "published" ||
              Number(lockedInventory.qtyOnSale) <= 0 ||
              Number(lockedInventory.enterpriseId ?? 0) !==
                Number(inventory.enterpriseId ?? 0) ||
              Number(lockedInventory.sellerUserId) !==
                Number(inventory.sellerUserId)
            ) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "库存所属或状态已变化，请重试",
              });
            }
            const verifiedAssigneeUserId =
              await resolveInventoryInquiryRecipient(
                tx,
                {
                  inventoryId: Number(inventory.id),
                  enterpriseId:
                    lockedInventory.enterpriseId == null
                      ? null
                      : Number(lockedInventory.enterpriseId),
                  ownerUserId:
                    lockedInventory.ownerUserId == null
                      ? null
                      : Number(lockedInventory.ownerUserId),
                  sellerUserId: Number(lockedInventory.sellerUserId),
                },
                { lock: true }
              );
            if (
              !verifiedAssigneeUserId ||
              verifiedAssigneeUserId === buyerUserId ||
              verifiedAssigneeUserId !== assigneeUserId
            ) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "询价接待规则或负责人已变化，请重试",
              });
            }
            const conversationId = await getOrCreateFrozenBusinessConversation(
              tx,
              conversationUser1,
              conversationUser2
            );
            const conversationResult = await tx.execute(sql`
              SELECT id, user1Id, user2Id, currentRound, endedAt
                FROM conversations
               WHERE id = ${conversationId}
               LIMIT 1
               FOR UPDATE
            `);
            const conversation = (
              conversationResult as unknown as [
                Array<
                  ConversationRow & {
                    currentRound: number | null;
                    endedAt: Date | null;
                  }
                >,
                unknown,
              ]
            )[0][0];
            if (!conversation) throw new Error("询价会话创建后读取失败");
            await assertConversationNotBlocked(
              tx,
              buyerUserId,
              conversationId,
              assigneeUserId
            );
            await tx.execute(sql`
            INSERT INTO messages
              (conversationId, senderId, senderEnterpriseId, senderCompanyId, senderCompanyNameSnapshot,
               senderIdentityContextKey, clientMessageId, msgType, content)
            VALUES
              (${conversationId}, ${buyerUserId}, ${buyerIdentity.enterpriseId},
               ${buyerIdentity.companyId}, ${buyerIdentity.companyName},
               ${buyerIdentityContextKey}, ${clientMessageId}, 'inquiry', ${cardContent})
          `);
            const insertedMessageResult = await tx.execute(
              sql`SELECT LAST_INSERT_ID() AS id`
            );
            const messageId = Number(
              (
                insertedMessageResult as unknown as [
                  Array<{ id: number }>,
                  unknown,
                ]
              )[0][0]?.id ?? 0
            );
            if (conversation.endedAt) {
              await tx.execute(sql`
              UPDATE conversations
                 SET currentRound = currentRound + 1,
                     roundStartedAt = NOW(), roundStartMessageId = ${messageId},
                     endedAt = NULL, endedByUserId = NULL,
                     lastMessageAt = NOW(), lastMessagePreview = ${preview}
               WHERE id = ${conversationId}
            `);
            } else {
              await tx.execute(sql`
              UPDATE conversations
                 SET lastMessageAt = NOW(), lastMessagePreview = ${preview}
               WHERE id = ${conversationId}
            `);
            }
            await tx.execute(sql`
            UPDATE conversation_user_settings
               SET deleted = 0,
                   unreadCount = CASE WHEN deleted = 1 THEN 1 ELSE unreadCount + 1 END
             WHERE conversationId = ${conversationId} AND userId = ${assigneeUserId}
          `);
            await tx.execute(sql`
            INSERT INTO inventory_inquiries
              (inventoryId, enterpriseId, sellerUserId, buyerUserId,
               buyerEnterpriseId, buyerCompanyId, buyerCompanyNameSnapshot, buyerIdentityContextKey, assigneeUserId,
               conversationId, messageId, partNumber, partNumberNormalized,
               requestedQty, source, clientMessageId)
            VALUES
              (${inventory.id}, ${inventory.enterpriseId}, ${inventory.sellerUserId},
               ${buyerUserId}, ${buyerIdentity.enterpriseId},
               ${buyerIdentity.companyId}, ${buyerIdentity.companyName},
               ${buyerIdentityContextKey},
               ${assigneeUserId}, ${conversationId}, ${messageId},
               ${displayInquiryPartNumber(inventory.partNumber)},
               ${normalizeInquiryPartNumber(inventory.partNumber)},
               ${requestedQty}, ${input.source ?? null}, ${clientMessageId})
          `);
            const insertedInquiryResult = await tx.execute(
              sql`SELECT LAST_INSERT_ID() AS id`
            );
            const inquiryId = Number(
              (
                insertedInquiryResult as unknown as [
                  Array<{ id: number }>,
                  unknown,
                ]
              )[0][0]?.id ?? 0
            );
            await autoGroupInventoryInquiry(tx, {
              userId: buyerUserId,
              ownerIdentityContextKey: buyerIdentityContextKey,
              conversationId,
              messageId,
              partNumber: inventory.partNumber,
            });
            const messageResult = await tx.execute(sql`
            SELECT id, conversationId, senderId, clientMessageId, msgType, content, createdAt
              FROM messages WHERE id = ${messageId} LIMIT 1
          `);
            const message = (
              messageResult as unknown as [MessageRow[], unknown]
            )[0][0];
            if (!message || !inquiryId) throw new Error("询价业务单写入失败");
            return {
              inquiryId,
              conversationId,
              assigneeUserId,
              assigneeName:
                assignee?.name?.trim() ||
                assignee?.username?.trim() ||
                inventory.companyName ||
                "供应商",
              companyName: inventory.companyName,
              message,
              deduplicated: false,
            };
          } finally {
            await tx
              .execute(sql`SELECT RELEASE_LOCK(${pairLockName})`)
              .catch(() => void 0);
          }
        } finally {
          await tx
            .execute(sql`SELECT RELEASE_LOCK(${idempotencyLockName})`)
            .catch(() => void 0);
        }
      }).catch(async (error: unknown) => {
        const duplicate = error as { code?: string; cause?: { code?: string } };
        if (duplicate?.code !== "ER_DUP_ENTRY" && duplicate?.cause?.code !== "ER_DUP_ENTRY") {
          throw error;
        }
        // Named locks are released before the transaction commits. A racing
        // retry can therefore retain an older snapshot, then hit the unique
        // message key after the winning transaction commits. The failed
        // transaction has rolled back; re-read only this actor/identity/key
        // through the existing replay validator, without changing lock order.
        const committedInquiry = await findExistingInquiry(db);
        if (!committedInquiry) throw error;
        return existingInquiryResponse(committedInquiry);
      });
      return { ok: true, ...stored };
    }),

  sendInquiryCard: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        partNumber: z.string().trim().min(1).max(64),
        brand: z.string().trim().max(64).optional(),
        pkg: z.string().trim().max(64).optional(),
        /** 用户明确填写的需求数量；未填写时在聊天中确认。 */
        qty: z.number().int().positive().max(1e9).nullable(),
        /**
         * 对应库存记录 ID。
         * 用于服务端现查起订量与卖家在售数量，不信任前端传入。
         */
        inventoryId: z.number().int().positive().optional(),
        /** 发起页面，仅用于卡片上的来源提示。 */
        source: z.enum(["search", "detail", "recommend", "quote"]).optional(),
        /** 客户端幂等键；同一次点击重试不会发出多条卡片 */
        clientMessageId: z.string().min(1).max(64).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const myId = ctx.user.id;
      const serviceUserId = await getServiceUserId();
      const transitionConversationId =
        await resolveChatTransitionCoreConversationId(
          db,
          myId,
          input.conversationId,
          serviceUserId
        );
      const transitionRow = await chatTransitionFindForConversation(
        db,
        myId,
        transitionConversationId
      );
      const transitionWrite = transitionRow
        ? await chatTransitionResolveWrite(db, {
            actorUserId: myId,
            conversationId: transitionConversationId,
            currentIdentity: await resolveActorBusinessIdentity(db, myId),
            serviceUserId,
          })
        : null;
      const scoped = transitionWrite
        ? null
        : await requireScopedConversation(db, myId, input.conversationId, {
            write: false,
          });
      if (
        !transitionWrite &&
        scoped &&
        (scoped.conversation.identityContextKey === "legacy" ||
          scoped.conversation.identityContextKey == null) &&
        scoped.otherUserId !== serviceUserId
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "请先确认自己的企业身份后再继续发送",
        });
      }
      const myIdentity =
        transitionWrite?.messageIdentity ??
        requireResolvedChatScope(scoped).identity;
      const conversationId =
        transitionWrite?.canonicalConversationId ?? input.conversationId;
      const messageSourceConversationIds =
        transitionWrite?.messageSourceConversationIds ?? [conversationId];
      const senderIdentityContextKey =
        transitionWrite?.messageIdentity.identityKey ??
        actorIdentityContextKey(myId, myIdentity);
      const clientMessageId = input.clientMessageId ?? randomUUID();
      const buyerResult = await db.execute(sql`
        SELECT u.name AS userName, u.username AS username,
               comp.companyName AS companyName,
               comp.certLevel AS certLevel,
               comp.reviewStatus AS reviewStatus
          FROM users u
          LEFT JOIN companies comp ON comp.id = ${myIdentity.companyId}
         WHERE u.id = ${myId}
         LIMIT 1
      `);
      const buyerRows = (
        buyerResult as unknown as [
          Array<{
            userName: string | null;
            username: string | null;
            companyName: string | null;
            certLevel: string | null;
            reviewStatus: string | null;
          }>,
          unknown,
        ]
      )[0];
      const buyer = buyerRows[0];
      const buyerName = myIdentity.displayName;
      const buyerCertified =
        (buyer?.certLevel === "certified" || buyer?.certLevel === "premium") &&
        buyer?.reviewStatus === "approved";
      let buyerTradeCount = 0;
      try {
        const tradeResult = await db.execute(sql`
          SELECT COUNT(*) AS cnt FROM orders
           WHERE buyerId = ${myId}
             AND doneAt IS NOT NULL
             AND status NOT IN ('cancel', 'refund')
        `);
        const tradeRows = (
          tradeResult as unknown as [Array<{ cnt: number }>, unknown]
        )[0];
        buyerTradeCount = Number(tradeRows[0]?.cnt ?? 0);
      } catch {
        buyerTradeCount = 0;
      }
      let supplierQtyOnSale: number | null = null;
      if (input.inventoryId) {
        try {
          const invResult = await db.execute(sql`
            SELECT qtyOnSale FROM inventories WHERE id = ${input.inventoryId} LIMIT 1
          `);
          const invRows = (
            invResult as unknown as [
              Array<{
                qtyOnSale: number | null;
              }>,
              unknown,
            ]
          )[0];
          const inv = invRows[0];
          if (inv) {
            supplierQtyOnSale =
              inv.qtyOnSale != null ? Number(inv.qtyOnSale) : null;
          }
        } catch {}
      }
      const quantityText = inquiryQuantityText(input.qty);
      const sourceLabels: Record<string, string> = {
        search: "搜索页",
        detail: "商品详情页",
        recommend: "今日推荐",
        quote: "需求报价",
      };
      const cardContent = JSON.stringify({
        kind: "quick",
        partNumber: input.partNumber,
        brand: input.brand || void 0,
        pkg: input.pkg || void 0,
        requestedQty: input.qty,
        unit: INQUIRY_QUANTITY_UNIT,
        /*
         * 不写 remark：品牌与封装已有独立字段展示，
         * 再拼一份「规格：ST · LQFP48」会在卡片上重复两遍。
         * remark 留给真正的补充说明（如 BOM 导入时的备注）。
         */
        buyerName,
        buyerCertified,
        buyerTradeCount,
        sourceLabel: input.source ? sourceLabels[input.source] : void 0,
        supplierQtyOnSale: supplierQtyOnSale ?? void 0,
      });
      const preview = `[询价单] ${input.partNumber} × ${quantityText}`;
      const stored = await db.transaction(async tx => {
        const convCheck = (await tx.execute(sql`
          SELECT id, user1Id, user2Id, user1EnterpriseId, user2EnterpriseId, currentRound, endedAt
            FROM conversations
           WHERE id = ${conversationId}
             AND (user1Id = ${myId} OR user2Id = ${myId})
             AND ${transitionWrite ? sql`TRUE` : conversationIdentityScopeSql("conversations", myId, myIdentity)}
           LIMIT 1
           FOR UPDATE
        `)) as unknown as [ChatCurrentConversationRow[], unknown];
        const convRows = convCheck[0];
        if (convRows.length === 0) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
        }
        const conv = convRows[0];
        const otherId = conv.user1Id === myId ? conv.user2Id : conv.user1Id;
        if (input.inventoryId) {
          const routeResult = (await tx.execute(sql`
            SELECT enterpriseId, ownerUserId, userId, status
              FROM inventories
             WHERE id = ${input.inventoryId}
             LIMIT 1
             FOR UPDATE
          `)) as unknown as [
            {
              enterpriseId: number | null;
              ownerUserId: number | null;
              userId: number;
              status: string;
            }[],
            unknown,
          ];
          const routeRows = routeResult[0];
          const route = routeRows[0];
          if (
            !route ||
            route.status !== "published" ||
            Number(route.ownerUserId || route.userId) !== Number(otherId)
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "库存负责人已变化，请返回商品页重新询价",
            });
          }
          const frozenTargetEnterpriseId = Number(
            conv.user1Id === myId
              ? conv.user2EnterpriseId
              : conv.user1EnterpriseId
          );
          if (Number(route.enterpriseId ?? 0) !== frozenTargetEnterpriseId) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "库存所属企业与当前会话不一致，请从商品页重新询价",
            });
          }
          const verifiedTarget = await resolveConversationCounterpartyIdentity(
            tx,
            Number(otherId),
            route.enterpriseId == null ? void 0 : Number(route.enterpriseId)
          );
          if (
            Number(verifiedTarget.enterpriseId ?? 0) !==
            frozenTargetEnterpriseId
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "库存接待企业已变化，请从商品页重新询价",
            });
          }
          if (
            route.enterpriseId != null &&
            Number(route.enterpriseId) === Number(myIdentity.enterpriseId ?? 0)
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "不能询价本公司的库存",
            });
          }
        }
        await assertConversationNotBlocked(tx, myId, conversationId, otherId);
        const existingResult = await tx.execute(sql`
          SELECT id, conversationId, senderId, clientMessageId, msgType, content, createdAt
            FROM messages
           WHERE senderId = ${myId}
               AND senderIdentityContextKey = ${senderIdentityContextKey}
               AND clientMessageId = ${clientMessageId}
           LIMIT 1
        `);
        const existingRows = (
          existingResult as unknown as [Array<MessageRow>, unknown]
        )[0];
        const existing = existingRows[0];
        if (existing) {
          if (
            !messageSourceConversationIds.includes(
              Number(existing.conversationId)
            ) ||
            existing.msgType !== "inquiry" ||
            existing.content !== cardContent
          ) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "消息幂等键与原请求不一致",
            });
          }
          return { message: existing, deduplicated: true };
        }
        await tx.execute(sql`
          INSERT INTO messages
            (conversationId, senderId, senderEnterpriseId, senderCompanyId, senderCompanyNameSnapshot,
             senderIdentityContextKey, clientMessageId, msgType, content)
          VALUES
            (${conversationId}, ${myId}, ${myIdentity.enterpriseId},
             ${myIdentity.companyId}, ${myIdentity.companyName},
             ${senderIdentityContextKey}, ${clientMessageId}, 'inquiry', ${cardContent})
        `);
        const insertedIdResult = await tx.execute(
          sql`SELECT LAST_INSERT_ID() as id`
        );
        const insertedId = Number(
          (
            insertedIdResult as unknown as [Array<{ id: number }>, unknown]
          )[0][0]?.id ?? 0
        );
        if (conv.endedAt) {
          await tx.execute(sql`
            UPDATE conversations
               SET currentRound = currentRound + 1,
                   roundStartedAt = NOW(),
                   roundStartMessageId = ${insertedId > 0 ? insertedId : null},
                   endedAt = NULL,
                   endedByUserId = NULL,
                   lastMessageAt = NOW(),
                   lastMessagePreview = ${preview}
             WHERE id = ${conversationId}
          `);
        } else {
          await tx.execute(sql`
            UPDATE conversations
               SET lastMessageAt = NOW(), lastMessagePreview = ${preview}
             WHERE id = ${conversationId}
          `);
        }
        await tx.execute(sql`
          UPDATE conversation_user_settings
             SET deleted = 0,
                 unreadCount = CASE WHEN deleted = 1 THEN 1 ELSE unreadCount + 1 END
           WHERE conversationId = ${conversationId} AND userId = ${otherId}
        `);
        const messageResult = await tx.execute(sql`
          SELECT id, conversationId, senderId, clientMessageId, msgType, content, createdAt
            FROM messages WHERE id = ${insertedId} LIMIT 1
        `);
        const messageRows = (
          messageResult as unknown as [Array<MessageRow>, unknown]
        )[0];
        const message = messageRows[0];
        if (!message) throw new Error("询价卡片写入后读取失败");
        return { message, deduplicated: false };
      });
      return {
        ok: true,
        message: stored.message,
        deduplicated: stored.deduplicated,
      };
    }),

  markRead: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        supportView: z.enum(["enterprise", "general"]).optional(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const db = await requireDb();
      return runWithReadyWeappConversationScope({
        executor: db,
        actorUserId: ctx.user.id,
        conversationId: input.conversationId,
        headers: ctx.req?.headers,
        action: () => next(),
      });
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const serviceUserId = await getServiceUserId();
      const transitionConversationId =
        await resolveChatTransitionCoreConversationId(
          db,
          ctx.user.id,
          input.conversationId,
          serviceUserId
        );
      const transitionRow = await chatTransitionFindForConversation(
        db,
        ctx.user.id,
        transitionConversationId
      );
      const transitionRead = transitionRow
        ? await chatTransitionResolveRead(db, {
            actorUserId: ctx.user.id,
            conversationId: transitionConversationId,
            currentIdentity: await resolveActorBusinessIdentity(
              db,
              ctx.user.id
            ),
            serviceUserId,
          })
        : null;
      const scoped = transitionRead
        ? null
        : await requireScopedConversation(
            db,
            ctx.user.id,
            input.conversationId,
            { write: false }
          );
      if (!transitionRead && !scoped)
        throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
      const support =
        !transitionRead &&
        requireResolvedChatScope(scoped).otherUserId === serviceUserId
          ? await resolveAccountSupportConversation(
              db,
              ctx.user.id,
              serviceUserId,
              input.conversationId
            )
          : null;
      const currentConversationId =
        transitionRead?.canonicalConversationId ?? input.conversationId;
      const sourceConversationIds = support?.sourceIds ?? [
        currentConversationId,
      ];
      const supportView = support
        ? await resolveAccountSupportView(db, ctx.user.id, input.supportView)
        : null;
      // This flag cannot authenticate: it is evaluated only after the server verified the official account conversation.
      const supportCompatibility =
        Boolean(support && supportView) &&
        isWeappDefaultAccountSupportCompatibility(
          ctx,
          input.supportView,
          support
        );
      const displayedScopeEnterpriseIds = supportView
        ? accountSupportDisplayedScopeIds(supportView, supportCompatibility)
        : [];
      const readState = await db.transaction(async tx => {
        if (support && supportView) {
          if (supportCompatibility) {
            // Compute and advance each displayed scope independently; never copy one scope's max ID to another.
            const latestReadByScope = new Map<number, number>();
            for (const scopeEnterpriseId of displayedScopeEnterpriseIds) {
              const scopedLatestResult = (await tx.execute(sql`
                SELECT MAX(support_messages.id) AS lastReadMessageId
                  FROM messages support_messages
                  INNER JOIN conversations support_source ON support_source.id = support_messages.conversationId
                 WHERE support_messages.conversationId IN (${accountSupportIdsSql(sourceConversationIds)})
                   AND ${accountSupportMessageInViewSql("support_messages", "support_source", ctx.user.id, serviceUserId, scopeEnterpriseId)}
              `)) as unknown as [
                { lastReadMessageId: number | null }[],
                unknown,
              ];
              const scopedLatestId =
                Number(scopedLatestResult[0][0]?.lastReadMessageId ?? 0) || 0;
              latestReadByScope.set(scopeEnterpriseId, scopedLatestId);
              await tx.execute(sql`
                INSERT INTO account_support_view_settings
                  (userId, scopeEnterpriseId, lastReadMessageId, deletedBeforeMessageId, deleted, lastReadAt)
                VALUES (${ctx.user.id}, ${scopeEnterpriseId}, ${scopedLatestId}, 0, 0, NOW())
                ON DUPLICATE KEY UPDATE
                  deleted = 0,
                  lastReadAt = NOW(),
                  lastReadMessageId = GREATEST(lastReadMessageId, VALUES(lastReadMessageId))
              `);
            }
            const latestId2 = Math.max(
              0,
              ...Array.from(latestReadByScope.values())
            );
            return {
              lastReadMessageId: latestId2 || null,
              lastReadMessageIds: Object.fromEntries(
                sourceConversationIds.map(conversationId => [
                  conversationId,
                  null,
                ])
              ),
            };
          }
          const latestResult2 = (await tx.execute(sql`
            SELECT MAX(support_messages.id) AS lastReadMessageId
              FROM messages support_messages
              INNER JOIN conversations support_source ON support_source.id = support_messages.conversationId
             WHERE support_messages.conversationId IN (${accountSupportIdsSql(sourceConversationIds)})
               AND ${accountSupportMessageInViewSql("support_messages", "support_source", ctx.user.id, serviceUserId, supportView.scopeEnterpriseId)}
          `)) as unknown as [{ lastReadMessageId: number | null }[], unknown];
          const latestId2 =
            Number(latestResult2[0][0]?.lastReadMessageId ?? 0) || 0;
          await tx.execute(sql`
            INSERT INTO account_support_view_settings
              (userId, scopeEnterpriseId, lastReadMessageId, deletedBeforeMessageId, deleted, lastReadAt)
            VALUES (${ctx.user.id}, ${supportView.scopeEnterpriseId}, ${latestId2}, 0, 0, NOW())
            ON DUPLICATE KEY UPDATE
              deleted = 0,
              lastReadAt = NOW(),
              lastReadMessageId = GREATEST(lastReadMessageId, VALUES(lastReadMessageId))
          `);
          return {
            lastReadMessageId: latestId2 || null,
            lastReadMessageIds: Object.fromEntries(
              sourceConversationIds.map(conversationId => [
                conversationId,
                null,
              ])
            ),
          };
        }
        const latestResult = await tx.execute(sql`
          SELECT MAX(id) AS lastReadMessageId FROM messages WHERE conversationId = ${currentConversationId}
        `);
        const latestId =
          Number(
            (
              latestResult as unknown as [
                Array<{ lastReadMessageId: number | null }>,
                unknown,
              ]
            )[0][0]?.lastReadMessageId ?? 0
          ) || 0;
        await tx.execute(sql`
          UPDATE conversation_user_settings
           SET unreadCount = 0,
                 lastReadAt = NOW(),
                 lastReadMessageId = GREATEST(COALESCE(lastReadMessageId, 0), ${latestId})
           WHERE conversationId = ${currentConversationId} AND userId = ${ctx.user.id}
        `);
        return {
          lastReadMessageId: latestId || null,
          lastReadMessageIds: { [currentConversationId]: latestId || null },
        };
      });
      const ordinaryScope = supportView?.supportOnlyWithoutEnterpriseSelection
        ? sql`FALSE`
        : sql`(
          ${visibleConversationScopeSql("conversation_rows", ctx.user.id, transitionRead ? await resolveActorBusinessIdentity(db, ctx.user.id) : requireResolvedChatScope(scoped).identity)}
          OR ${chatTransitionPendingListScopeSql("conversation_rows", ctx.user.id, transitionRead ? await resolveActorBusinessIdentity(db, ctx.user.id) : requireResolvedChatScope(scoped).identity)}
        )`;
      const ordinaryResult = (await db.execute(sql`
        SELECT COALESCE(SUM(settings.unreadCount), 0) AS total
          FROM conversation_user_settings settings
          INNER JOIN conversations conversation_rows ON conversation_rows.id = settings.conversationId
         WHERE settings.userId = ${ctx.user.id} AND settings.deleted = 0
           AND ${ordinaryScope}
           AND NOT ((conversation_rows.user1Id = ${ctx.user.id} AND conversation_rows.user2Id = ${serviceUserId})
                 OR (conversation_rows.user2Id = ${ctx.user.id} AND conversation_rows.user1Id = ${serviceUserId}))
      `)) as unknown as [{ total: number }[], unknown];
      const totalSupportIds =
        support?.sourceIds ??
        (await accountSupportConversationIds(db, ctx.user.id, serviceUserId));
      const supportUnread = await countDisplayedSupportUnread(
        db,
        ctx.user.id,
        serviceUserId,
        totalSupportIds,
        supportView
          ? supportView.identity.enterpriseId
          : transitionRead
            ? await resolveActorBusinessIdentity(db, ctx.user.id).then(
                identity => identity.enterpriseId
              )
            : requireResolvedChatScope(scoped).identity.enterpriseId
      );
      const ordinaryUnread = Number(ordinaryResult[0][0]?.total ?? 0);
      return {
        ok: true,
        ...readState,
        totalUnread: ordinaryUnread + supportUnread,
      };
    }),

  pinConversation: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        pinned: z.boolean(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireScopedConversation(db, ctx.user.id, input.conversationId, {
        write: false,
      });
      const convRows = chatSqlRows<{ user1Id: number; user2Id: number }>(
        await db.execute(sql`
        SELECT user1Id, user2Id FROM conversations WHERE id = ${input.conversationId} LIMIT 1
      `)
      );
      if (convRows.length > 0) {
        try {
          const csUserId = await getServiceUserId();
          if (
            convRows[0].user1Id === csUserId ||
            convRows[0].user2Id === csUserId
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "官方客服会话已固定在顶部，无需置顶",
            });
          }
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          console.error(
            "[chat.pinConversation] 取客服用户失败，跳过官方会话校验:",
            err
          );
        }
      }
      await db.execute(sql`
        UPDATE conversation_user_settings 
        SET pinned = ${input.pinned ? 1 : 0}
        WHERE conversationId = ${input.conversationId} AND userId = ${ctx.user.id}
      `);
      return { ok: true };
    }),

  setRemarkName: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        remarkName: z.string().trim().max(64).nullable(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireScopedConversation(db, ctx.user.id, input.conversationId, {
        write: false,
      });
      const remarkName = input.remarkName?.trim() || null;
      await db.execute(sql`
        UPDATE conversation_user_settings
        SET remarkName = ${remarkName}
        WHERE conversationId = ${input.conversationId} AND userId = ${ctx.user.id}
      `);
      return { ok: true, remarkName };
    }),

  setGroup: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        groupName: z.string().max(64).nullable(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      await requireScopedConversation(db, ctx.user.id, input.conversationId, {
        write: true,
      });
      await db.execute(sql`
        UPDATE conversation_user_settings 
        SET groupName = ${input.groupName}
        WHERE conversationId = ${input.conversationId} AND userId = ${ctx.user.id}
      `);
      return { ok: true };
    }),

  setGroupMembership: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        groupId: z.number().int().positive(),
        included: z.boolean(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const { identity } = await requireScopedConversation(
        db,
        ctx.user.id,
        input.conversationId,
        { write: true }
      );
      await db.transaction(async tx => {
        const accessResult = await tx.execute(sql`
          SELECT g.id
            FROM conversation_groups g
            INNER JOIN conversation_user_settings s
              ON s.userId = g.userId
             AND s.conversationId = ${input.conversationId}
           WHERE g.id = ${input.groupId}
             AND g.userId = ${ctx.user.id}
             AND ${groupIdentityScopeSql("g", ctx.user.id, identity)}
             AND g.status = 'active'
           LIMIT 1
           FOR UPDATE
        `);
        const accessRows = (
          accessResult as unknown as [Array<{ id: number }>, unknown]
        )[0];
        if (!accessRows[0]) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "无权修改该分组或会话",
          });
        }
        if (input.included) {
          await tx.execute(sql`
            INSERT INTO conversation_group_members
              (groupId, userId, conversationId, source)
            VALUES (${input.groupId}, ${ctx.user.id}, ${input.conversationId}, 'manual')
            ON DUPLICATE KEY UPDATE source = source
          `);
        } else {
          await tx.execute(sql`
            DELETE FROM conversation_group_members
             WHERE groupId = ${input.groupId}
               AND userId = ${ctx.user.id}
               AND conversationId = ${input.conversationId}
          `);
        }
      });
      return { ok: true };
    }),

  markUnread: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        supportView: z.enum(["enterprise", "general"]).optional(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const scoped = await requireScopedConversation(
        db,
        ctx.user.id,
        input.conversationId,
        { write: false }
      );
      if (
        requireResolvedChatScope(scoped).otherUserId ===
        (await getServiceUserId())
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "官方客服未读按当前范围的新消息自动计算",
        });
      }
      await db.execute(sql`
        UPDATE conversation_user_settings
           SET deleted = 0, unreadCount = GREATEST(unreadCount, 1)
         WHERE conversationId = ${input.conversationId} AND userId = ${ctx.user.id}
      `);
      return { ok: true, unreadCount: 1 };
    }),

  hideConversation: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        supportView: z.enum(["enterprise", "general"]).optional(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const scoped = await requireScopedConversation(
        db,
        ctx.user.id,
        input.conversationId,
        { write: false }
      );
      const serviceUserId = await getServiceUserId();
      const support =
        requireResolvedChatScope(scoped).otherUserId === serviceUserId
          ? await resolveAccountSupportConversation(
              db,
              ctx.user.id,
              serviceUserId,
              input.conversationId
            )
          : null;
      const supportView = support
        ? await resolveAccountSupportView(db, ctx.user.id, input.supportView)
        : null;
      if (supportView) {
        await db.execute(sql`
          INSERT INTO account_support_view_settings
            (userId, scopeEnterpriseId, lastReadMessageId, deletedBeforeMessageId, deleted)
          VALUES (${ctx.user.id}, ${supportView.scopeEnterpriseId}, 0, 0, 1)
          ON DUPLICATE KEY UPDATE deleted = 1, updatedAt = NOW()
        `);
      } else {
        await db.execute(sql`
          UPDATE conversation_user_settings
             SET deleted = 1, unreadCount = 0
           WHERE conversationId = ${input.conversationId} AND userId = ${ctx.user.id}
        `);
      }
      return { ok: true };
    }),

  deleteConversation: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        supportView: z.enum(["enterprise", "general"]).optional(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const scoped = await requireScopedConversation(
        db,
        ctx.user.id,
        input.conversationId,
        { write: false }
      );
      const serviceUserId = await getServiceUserId();
      const support =
        requireResolvedChatScope(scoped).otherUserId === serviceUserId
          ? await resolveAccountSupportConversation(
              db,
              ctx.user.id,
              serviceUserId,
              input.conversationId
            )
          : null;
      const supportView = support
        ? await resolveAccountSupportView(db, ctx.user.id, input.supportView)
        : null;
      if (supportView) {
        const clearedBeforeMessageId2 = await db.transaction(async tx => {
          const latestResult = await tx.execute(sql`
            SELECT MAX(support_messages.id) AS id
              FROM messages support_messages
              INNER JOIN conversations support_source ON support_source.id = support_messages.conversationId
             WHERE support_messages.conversationId IN (${accountSupportIdsSql(requireResolvedChatScope(support).sourceIds)})
               AND ${accountSupportMessageInViewSql(
                 "support_messages",
                 "support_source",
                 ctx.user.id,
                 serviceUserId,
                 supportView.scopeEnterpriseId
               )}
          `);
          const latestRows = (
            latestResult as unknown as [Array<{ id: number | null }>, unknown]
          )[0];
          const latestId =
            latestRows[0]?.id == null ? null : Number(latestRows[0].id);
          await tx.execute(sql`
            INSERT INTO account_support_view_settings
              (userId, scopeEnterpriseId, lastReadMessageId, deletedBeforeMessageId, deleted, lastReadAt)
            VALUES (${ctx.user.id}, ${supportView.scopeEnterpriseId}, ${latestId ?? 0}, ${latestId ?? 0}, 1, NOW())
            ON DUPLICATE KEY UPDATE
              deleted = 1,
              lastReadAt = NOW(),
              lastReadMessageId = CASE
                WHEN ${latestId} IS NULL THEN lastReadMessageId
                ELSE GREATEST(COALESCE(lastReadMessageId, 0), ${latestId})
              END,
              deletedBeforeMessageId = CASE
                WHEN ${latestId} IS NULL THEN deletedBeforeMessageId
                ELSE GREATEST(COALESCE(deletedBeforeMessageId, 0), ${latestId})
              END,
              updatedAt = NOW()
          `);
          return latestId;
        });
        return { ok: true, clearedBeforeMessageId: clearedBeforeMessageId2 };
      }
      const clearedBeforeMessageId = await db.transaction(async tx => {
        const convResult = await tx.execute(sql`
          SELECT id FROM conversations
           WHERE id = ${input.conversationId}
             AND (user1Id = ${ctx.user.id} OR user2Id = ${ctx.user.id})
           LIMIT 1
           FOR UPDATE
        `);
        const convRows = (
          convResult as unknown as [Array<{ id: number }>, unknown]
        )[0];
        if (!convRows[0]) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权删除该会话" });
        }
        const latestResult = await tx.execute(sql`
          SELECT MAX(id) AS id FROM messages WHERE conversationId = ${input.conversationId}
        `);
        const latestRows = (
          latestResult as unknown as [Array<{ id: number | null }>, unknown]
        )[0];
        const latestId =
          latestRows[0]?.id == null ? null : Number(latestRows[0].id);
        await tx.execute(sql`
          UPDATE conversation_user_settings
             SET deleted = 1,
                 unreadCount = 0,
                 lastReadAt = NOW(),
                 lastReadMessageId = CASE
                   WHEN ${latestId} IS NULL THEN lastReadMessageId
                   ELSE GREATEST(COALESCE(lastReadMessageId, 0), ${latestId})
                 END,
                 clearedBeforeMessageId = CASE
                   WHEN ${latestId} IS NULL THEN clearedBeforeMessageId
                   ELSE GREATEST(COALESCE(clearedBeforeMessageId, 0), ${latestId})
                 END
           WHERE conversationId = ${input.conversationId} AND userId = ${ctx.user.id}
        `);
        return latestId;
      });
      return { ok: true, clearedBeforeMessageId };
    }),

  listGroups: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const identity = await resolveActorBusinessIdentity(db, ctx.user.id);
    const groupIdentityContextKey = actorIdentityContextKey(
      ctx.user.id,
      identity
    );
    const result = (await db.execute(sql`
      SELECT g.id, g.userId, g.groupName, g.groupType, g.status, g.autoAssign,
             g.createdAt, g.ownerIdentityContextKey,
             (SELECT COUNT(*)
                FROM conversation_group_members gm
                INNER JOIN conversation_user_settings s
                  ON s.conversationId = gm.conversationId
                 AND s.userId = gm.userId
                 AND s.deleted = 0
               INNER JOIN conversations conversation_rows
                  ON conversation_rows.id = gm.conversationId
               WHERE gm.groupId = g.id
                 AND gm.userId = g.userId
                 AND ${visibleConversationScopeSql("conversation_rows", ctx.user.id, identity)}) AS memberCount,
             (SELECT COALESCE(SUM(s.unreadCount), 0)
                FROM conversation_group_members gm
                INNER JOIN conversation_user_settings s
                  ON s.conversationId = gm.conversationId
                 AND s.userId = gm.userId
                 AND s.deleted = 0
               INNER JOIN conversations unread_conversation_rows
                  ON unread_conversation_rows.id = gm.conversationId
               WHERE gm.groupId = g.id
                 AND gm.userId = g.userId
                 AND ${visibleConversationScopeSql("unread_conversation_rows", ctx.user.id, identity)}) AS unreadCount,
             (SELECT GROUP_CONCAT(r.partNumber ORDER BY r.id SEPARATOR '||')
                FROM conversation_group_part_rules r
               WHERE r.groupId = g.id AND r.userId = g.userId) AS partNumbers
        FROM conversation_groups g
       WHERE g.userId = ${ctx.user.id}
         AND ${readableGroupIdentityScopeSql("g", ctx.user.id, identity)}
         AND g.status = 'active'
       ORDER BY g.createdAt ASC, g.id ASC
    `)) as unknown as [GroupRow[], unknown];
    const rows = (result as unknown as [GroupRow[], unknown])[0];
    return rows.map(row => ({
      ...row,
      id: Number(row.id),
      autoAssign: Boolean(row.autoAssign),
      isHistorical: row.ownerIdentityContextKey === "legacy",
      memberCount: Number(row.memberCount ?? 0),
      unreadCount: Number(row.unreadCount ?? 0),
      partNumbers: row.partNumbers ? row.partNumbers.split("||") : [],
    }));
  }),

  createGroup: protectedProcedure
    .input(z.object({ groupName: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const identity = await resolveActorBusinessIdentity(db, ctx.user.id);
      const groupIdentityContextKey = actorIdentityContextKey(
        ctx.user.id,
        identity
      );
      const groupName = input.groupName.trim();
      if (!groupName)
        throw new TRPCError({ code: "BAD_REQUEST", message: "分组名不能为空" });
      const existing = await db.execute(sql`
        SELECT id FROM conversation_groups
           WHERE userId = ${ctx.user.id}
             AND ownerIdentityContextKey = ${groupIdentityContextKey}
             AND groupName = ${groupName}
      `);
      const existingRows = (
        existing as unknown as [Array<{ id: number }>, unknown]
      )[0];
      if (existingRows.length > 0) {
        throw new TRPCError({ code: "CONFLICT", message: "已存在同名分组" });
      }
      await db.execute(sql`
        INSERT INTO conversation_groups (userId, ownerIdentityContextKey, groupName, groupType, status, autoAssign)
        VALUES (${ctx.user.id}, ${groupIdentityContextKey}, ${groupName}, 'manual', 'active', 0)
      `);
      return { ok: true };
    }),

  renameGroup: protectedProcedure
    .input(
      z.object({
        groupId: z.number().int().positive(),
        newName: z.string().min(1).max(64),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const identity = await resolveActorBusinessIdentity(db, ctx.user.id);
      const newName = input.newName.trim();
      if (!newName)
        throw new TRPCError({ code: "BAD_REQUEST", message: "分组名不能为空" });
      return db.transaction(async tx => {
        const sourceResult = await tx.execute(sql`
          SELECT id, groupName FROM conversation_groups
           WHERE id = ${input.groupId}
             AND userId = ${ctx.user.id}
             AND ${groupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
             AND status = 'active'
           LIMIT 1 FOR UPDATE
        `);
        const sourceRows = (
          sourceResult as unknown as [
            Array<{ id: number; groupName: string }>,
            unknown,
          ]
        )[0];
        if (!sourceRows[0])
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "分组不存在或已被解散",
          });
        if (sourceRows[0].groupName === newName)
          return { ok: true, unchanged: true };
        const conflictResult = await tx.execute(sql`
          SELECT id FROM conversation_groups
           WHERE userId = ${ctx.user.id}
             AND ${groupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
             AND groupName = ${newName}
             AND id <> ${input.groupId}
           LIMIT 1
        `);
        const conflictRows = (
          conflictResult as unknown as [Array<{ id: number }>, unknown]
        )[0];
        if (conflictRows[0])
          throw new TRPCError({ code: "CONFLICT", message: "已存在同名分组" });
        await tx.execute(sql`
          UPDATE conversation_groups SET groupName = ${newName}
           WHERE id = ${input.groupId}
             AND userId = ${ctx.user.id}
             AND ${groupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
        `);
        return { ok: true, unchanged: false };
      });
    }),

  mergeGroups: protectedProcedure
    .input(
      z
        .object({
          sourceGroupId: z.number().int().positive(),
          targetGroupId: z.number().int().positive(),
        })
        .refine(
          value => value.sourceGroupId !== value.targetGroupId,
          "不能合并同一分组"
        )
    )
    .mutation(async ({ ctx, input }) => {
      type MemberRow = {
        id: number;
        groupId: number;
        conversationId: number;
        source: ConversationGroupMemberSource;
        firstInquiryMessageId: number | null;
        lastInquiryMessageId: number | null;
        inquiryCount: number;
      };

      const db = await requireDb();
      const identity = await resolveActorBusinessIdentity(db, ctx.user.id);
      try {
        return await db.transaction(async tx => {
          await tx.execute(
            sql`SELECT id FROM users WHERE id = ${ctx.user.id} LIMIT 1 FOR UPDATE`
          );
          const groupsResult = await tx.execute(sql`
            SELECT id FROM conversation_groups
             WHERE userId = ${ctx.user.id}
               AND ${groupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
               AND status = 'active'
               AND id IN (${input.sourceGroupId}, ${input.targetGroupId})
             ORDER BY id FOR UPDATE
          `);
          const groupRows = (
            groupsResult as unknown as [Array<{ id: number }>, unknown]
          )[0];
          if (groupRows.length !== 2)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "来源或目标分组不存在",
            });
          const membersResult = await tx.execute(sql`
            SELECT id, groupId, conversationId, source,
                   firstInquiryMessageId, lastInquiryMessageId, inquiryCount
              FROM conversation_group_members
             WHERE userId = ${ctx.user.id}
               AND groupId IN (${input.sourceGroupId}, ${input.targetGroupId})
             ORDER BY groupId, conversationId
             FOR UPDATE
          `);
          const memberRows = (
            membersResult as unknown as [MemberRow[], unknown]
          )[0];
          for (const conversationId of Array.from(
            new Set(memberRows.map(member => Number(member.conversationId)))
          )) {
            await requireScopedConversation(tx, ctx.user.id, conversationId, {
              write: true,
            });
          }
          const targetMembers = new Map(
            memberRows
              .filter(member => Number(member.groupId) === input.targetGroupId)
              .map(member => [Number(member.conversationId), member])
          );
          const sourceMembers = memberRows.filter(
            member => Number(member.groupId) === input.sourceGroupId
          );
          for (const sourceMember of sourceMembers) {
            const conversationId = Number(sourceMember.conversationId);
            const targetMember = targetMembers.get(conversationId);
            if (targetMember) {
              const merged = mergeConversationGroupMemberStats(
                {
                  source: targetMember.source,
                  firstInquiryMessageId: targetMember.firstInquiryMessageId,
                  lastInquiryMessageId: targetMember.lastInquiryMessageId,
                  inquiryCount: Number(targetMember.inquiryCount),
                },
                {
                  source: sourceMember.source,
                  firstInquiryMessageId: sourceMember.firstInquiryMessageId,
                  lastInquiryMessageId: sourceMember.lastInquiryMessageId,
                  inquiryCount: Number(sourceMember.inquiryCount),
                }
              );
              await tx.execute(sql`
                UPDATE conversation_group_members
                   SET source = ${merged.source},
                       firstInquiryMessageId = ${merged.firstInquiryMessageId},
                       lastInquiryMessageId = ${merged.lastInquiryMessageId},
                       inquiryCount = ${merged.inquiryCount}
                 WHERE id = ${targetMember.id}
                   AND groupId = ${input.targetGroupId}
                   AND userId = ${ctx.user.id}
              `);
              continue;
            }
            await tx.execute(sql`
              INSERT INTO conversation_group_members
                (groupId, userId, conversationId, source,
                 firstInquiryMessageId, lastInquiryMessageId, inquiryCount)
              VALUES
                (${input.targetGroupId}, ${ctx.user.id}, ${conversationId}, ${sourceMember.source},
                 ${sourceMember.firstInquiryMessageId}, ${sourceMember.lastInquiryMessageId},
                 ${Number(sourceMember.inquiryCount)})
            `);
          }
          await tx.execute(sql`
            UPDATE conversation_group_part_rules SET groupId = ${input.targetGroupId}
             WHERE groupId = ${input.sourceGroupId} AND userId = ${ctx.user.id}
          `);
          await tx.execute(sql`
            UPDATE conversation_groups target
            INNER JOIN conversation_groups source ON source.id = ${input.sourceGroupId}
             SET target.groupType = IF(target.groupType = 'inquiry' OR source.groupType = 'inquiry', 'inquiry', 'manual'),
                   target.autoAssign = IF(target.autoAssign = 1 OR source.autoAssign = 1, 1, 0)
             WHERE target.id = ${input.targetGroupId} AND target.userId = ${ctx.user.id}
               AND ${groupIdentityScopeSql("target", ctx.user.id, identity)}
               AND source.userId = ${ctx.user.id}
               AND ${groupIdentityScopeSql("source", ctx.user.id, identity)}
          `);
          await tx.execute(sql`
            DELETE FROM conversation_group_members
             WHERE groupId = ${input.sourceGroupId} AND userId = ${ctx.user.id}
          `);
          await tx.execute(sql`
            DELETE FROM conversation_groups
             WHERE id = ${input.sourceGroupId}
               AND userId = ${ctx.user.id}
               AND ${groupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
          `);
          return { ok: true, groupId: input.targetGroupId };
        });
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error(
          "[chat.mergeGroups] Failed to merge conversation groups",
          {
            userId: ctx.user.id,
            sourceGroupId: input.sourceGroupId,
            targetGroupId: input.targetGroupId,
            error,
          }
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "分组合并失败，请稍后重试",
        });
      }
    }),

  dissolveGroup: protectedProcedure
    .input(z.object({ groupId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const identity = await resolveActorBusinessIdentity(db, ctx.user.id);
      await db.transaction(async tx => {
        const groupResult = await tx.execute(sql`
          SELECT id FROM conversation_groups
           WHERE id = ${input.groupId}
             AND userId = ${ctx.user.id}
             AND ${groupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
             AND status = 'active'
           LIMIT 1 FOR UPDATE
        `);
        const groupRows = (
          groupResult as unknown as [Array<{ id: number }>, unknown]
        )[0];
        if (!groupRows[0])
          throw new TRPCError({ code: "NOT_FOUND", message: "分组不存在" });
        await tx.execute(
          sql`DELETE FROM conversation_group_members WHERE groupId = ${input.groupId} AND userId = ${ctx.user.id}`
        );
        await tx.execute(
          sql`DELETE FROM conversation_group_part_rules WHERE groupId = ${input.groupId} AND userId = ${ctx.user.id}`
        );
        await tx.execute(sql`
          DELETE FROM conversation_groups
           WHERE id = ${input.groupId}
             AND userId = ${ctx.user.id}
             AND ${groupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
        `);
      });
      return { ok: true };
    }),

  trashGroup: protectedProcedure
    .input(z.object({ groupId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const identity = await resolveActorBusinessIdentity(db, ctx.user.id);
      const result = await db.execute(sql`
        UPDATE conversation_groups SET status = 'trashed', trashedAt = NOW()
         WHERE id = ${input.groupId}
           AND userId = ${ctx.user.id}
           AND ${groupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
           AND status = 'active'
      `);
      const metadata = (
        result as unknown as [{ affectedRows?: number }, unknown]
      )[0];
      if (Number(metadata.affectedRows ?? 0) !== 1)
        throw new TRPCError({ code: "NOT_FOUND", message: "分组不存在" });
      return { ok: true };
    }),

  listTrashedGroups: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const identity = await resolveActorBusinessIdentity(db, ctx.user.id);
    const result = await db.execute(sql`
      SELECT id, groupName, groupType, autoAssign, trashedAt
        FROM conversation_groups
       WHERE userId = ${ctx.user.id}
         AND ${readableGroupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
         AND status = 'trashed'
         AND trashedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       ORDER BY trashedAt DESC, id DESC
    `);
    return (
      result as unknown as [
        Array<{
          id: number;
          groupName: string;
          groupType: "manual" | "inquiry";
          autoAssign: number;
          trashedAt: Date;
        }>,
        unknown,
      ]
    )[0].map(row => ({
      ...row,
      id: Number(row.id),
      autoAssign: Boolean(row.autoAssign),
    }));
  }),

  restoreGroup: protectedProcedure
    .input(z.object({ groupId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const identity = await resolveActorBusinessIdentity(db, ctx.user.id);
      await db.transaction(async tx => {
        const sourceResult = await tx.execute(sql`
          SELECT id, groupName FROM conversation_groups
           WHERE id = ${input.groupId} AND userId = ${ctx.user.id}
             AND ${groupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
             AND status = 'trashed' AND trashedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
           LIMIT 1 FOR UPDATE
        `);
        const sourceRows = (
          sourceResult as unknown as [
            Array<{ id: number; groupName: string }>,
            unknown,
          ]
        )[0];
        const sourceGroup = sourceRows[0];
        if (!sourceGroup)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "分组已超过恢复期限或不存在",
          });
        const conflictResult = await tx.execute(sql`
          SELECT id FROM conversation_groups
           WHERE userId = ${ctx.user.id}
             AND ${groupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
             AND status = 'active'
             AND groupName = ${sourceGroup.groupName}
           LIMIT 1
        `);
        const conflicts = (
          conflictResult as unknown as [Array<{ id: number }>, unknown]
        )[0];
        if (conflicts[0])
          throw new TRPCError({
            code: "CONFLICT",
            message: "已有同名分组，请先重命名",
          });
        await tx.execute(sql`
          UPDATE conversation_groups SET status = 'active', trashedAt = NULL
           WHERE id = ${input.groupId}
             AND userId = ${ctx.user.id}
             AND ${groupIdentityScopeSql("conversation_groups", ctx.user.id, identity)}
        `);
      });
      return { ok: true };
    }),

  deleteGroup: protectedProcedure
    .input(z.object({ groupName: z.string().trim().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const identity = await resolveActorBusinessIdentity(db, ctx.user.id);
      await db.transaction(async tx => {
        await tx.execute(sql`
          UPDATE conversation_user_settings settings
          INNER JOIN conversations conversation_rows
             ON conversation_rows.id = settings.conversationId
             SET settings.groupName = NULL
           WHERE settings.userId = ${ctx.user.id}
             AND settings.groupName = ${input.groupName}
             AND ${conversationIdentityScopeSql("conversation_rows", ctx.user.id, identity)}
        `);
        await tx.execute(sql`
          DELETE g, gm, r
            FROM conversation_groups g
            LEFT JOIN conversation_group_members gm ON gm.groupId = g.id AND gm.userId = g.userId
            LEFT JOIN conversation_group_part_rules r ON r.groupId = g.id AND r.userId = g.userId
           WHERE g.userId = ${ctx.user.id}
             AND ${groupIdentityScopeSql("g", ctx.user.id, identity)}
             AND g.groupName = ${input.groupName}
        `);
      });
      return { ok: true };
    }),

  getTotalUnread: protectedProcedure
    .input(
      z
        .object({ supportView: z.enum(["enterprise", "general"]).optional() })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const supportView = await resolveAccountSupportView(
        db,
        ctx.user.id,
        input?.supportView
      );
      const serviceUserId = await getServiceUserId();
      const ordinaryScope = supportView.supportOnlyWithoutEnterpriseSelection
        ? sql`FALSE`
        : sql`(
          ${visibleConversationScopeSql("conversation_rows", ctx.user.id, supportView.identity)}
          OR ${chatTransitionPendingListScopeSql("conversation_rows", ctx.user.id, supportView.identity)}
        )`;
      const ordinaryResult = (await db.execute(sql`
        SELECT COALESCE(SUM(settings.unreadCount), 0) AS total
          FROM conversation_user_settings settings
          INNER JOIN conversations conversation_rows ON conversation_rows.id = settings.conversationId
         WHERE settings.userId = ${ctx.user.id}
           AND settings.deleted = 0
           AND ${ordinaryScope}
           AND NOT (
             (conversation_rows.user1Id = ${ctx.user.id} AND conversation_rows.user2Id = ${serviceUserId})
             OR (conversation_rows.user2Id = ${ctx.user.id} AND conversation_rows.user1Id = ${serviceUserId})
           )
      `)) as unknown as [{ total: number }[], unknown];
      const ordinaryTotal = Number(ordinaryResult[0][0]?.total ?? 0);
      const sourceIds = await accountSupportConversationIds(
        db,
        ctx.user.id,
        serviceUserId
      );
      if (sourceIds.length === 0) return { total: ordinaryTotal };
      const supportTotal = await countDisplayedSupportUnread(
        db,
        ctx.user.id,
        serviceUserId,
        sourceIds,
        supportView.identity.enterpriseId
      );
      return { total: ordinaryTotal + supportTotal };
    }),

  endConversationRound: protectedProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const myId = ctx.user.id;
      const serviceUserId = await getServiceUserId();
      await requireScopedConversation(db, myId, input.conversationId, {
        write: true,
      });

      return db.transaction(async tx => {
        const convResult = await tx.execute(sql`
          SELECT id, user1Id, user2Id, currentRound, roundStartedAt,
                 roundStartMessageId, endedAt, endedByUserId
            FROM conversations
           WHERE id = ${input.conversationId}
             AND (user1Id = ${myId} OR user2Id = ${myId})
           LIMIT 1
           FOR UPDATE
        `);
        const conv = (
          convResult as unknown as [
            Array<{
              id: number;
              user1Id: number;
              user2Id: number;
              currentRound: number;
              roundStartedAt: Date;
              roundStartMessageId: number | null;
              endedAt: Date | null;
              endedByUserId: number | null;
            }>,
            unknown,
          ]
        )[0][0];
        if (!conv) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该会话" });
        }
        // 官方客服不是交易对手，不应计入商户信誉
        if (conv.user1Id === serviceUserId || conv.user2Id === serviceUserId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "官方客服会话不参与商户信誉评价",
          });
        }

        // 幂等：已结束则直接回放归档结果
        if (conv.endedAt) {
          const existingResult = await tx.execute(sql`
            SELECT conversationId, roundNo, startedAt, startMessageId, endedAt,
                   endedByUserId, participantMessageCount, distinctSenderCount
              FROM conversation_rounds
             WHERE conversationId = ${conv.id} AND roundNo = ${conv.currentRound}
             LIMIT 1
          `);
          const existing = (
            existingResult as unknown as [
              Array<{
                endedAt: Date;
                participantMessageCount: number;
                distinctSenderCount: number;
              }>,
              unknown,
            ]
          )[0][0];
          const msgCount = Number(existing?.participantMessageCount ?? 0);
          const senderCount = Number(existing?.distinctSenderCount ?? 0);
          return {
            success: true,
            alreadyEnded: true,
            roundNo: conv.currentRound,
            endedAt: existing?.endedAt ?? conv.endedAt,
            participantMessageCount: msgCount,
            distinctSenderCount: senderCount,
            canRate: msgCount >= MIN_RATING_MESSAGE_COUNT && senderCount >= 2,
          };
        }

        // 统计本轮双方消息量。roundStartMessageId 为 NULL 时代表存量首轮，
        // 从现有全部消息起算。
        const statsResult = await tx.execute(sql`
          SELECT COUNT(*) AS participantMessageCount,
                 COUNT(DISTINCT senderId) AS distinctSenderCount
            FROM messages
           WHERE conversationId = ${conv.id}
             AND senderId IN (${conv.user1Id}, ${conv.user2Id})
             AND recalledAt IS NULL
             AND (${conv.roundStartMessageId} IS NULL OR id >= ${conv.roundStartMessageId ?? 0})
        `);
        const stats = (
          statsResult as unknown as [
            Array<{
              participantMessageCount: number;
              distinctSenderCount: number;
            }>,
            unknown,
          ]
        )[0][0];
        const participantMessageCount = Number(
          stats?.participantMessageCount ?? 0
        );
        const distinctSenderCount = Number(stats?.distinctSenderCount ?? 0);

        // 卡住“单方刷消息刷评价”：既要求总数，也要求双方都发过言
        if (
          participantMessageCount < MIN_RATING_MESSAGE_COUNT ||
          distinctSenderCount < 2
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `双方真实交流且合计至少${MIN_RATING_MESSAGE_COUNT}条消息后才能结束并评价本轮会话`,
          });
        }

        await tx.execute(sql`
          INSERT INTO conversation_rounds (
            conversationId, roundNo, startedAt, startMessageId, endedAt,
            endedByUserId, participantMessageCount, distinctSenderCount
          ) VALUES (
            ${conv.id}, ${conv.currentRound}, ${conv.roundStartedAt},
            ${conv.roundStartMessageId}, NOW(), ${myId},
            ${participantMessageCount}, ${distinctSenderCount}
          )
        `);
        await tx.execute(sql`
          UPDATE conversations
             SET endedAt = NOW(), endedByUserId = ${myId}, updatedAt = NOW()
           WHERE id = ${conv.id}
        `);
        const endedResult = await tx.execute(sql`
          SELECT endedAt FROM conversations WHERE id = ${conv.id} LIMIT 1
        `);
        const endedAt = (
          endedResult as unknown as [Array<{ endedAt: Date }>, unknown]
        )[0][0]?.endedAt;

        return {
          success: true,
          alreadyEnded: false,
          roundNo: conv.currentRound,
          endedAt,
          participantMessageCount,
          distinctSenderCount,
          canRate: true,
        };
      });
    }),

  getRatingState: protectedProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .use(async ({ ctx, input, next }) => {
      const resolved = await resolveLockedTransitionCanonicalAlias(
        await requireDb(),
        ctx.user.id,
        input.conversationId
      );
      return resolved &&
        resolved.canonicalConversationId !== input.conversationId
        ? next({
            input: {
              ...input,
              conversationId: resolved.canonicalConversationId,
            },
          })
        : next();
    })
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const myId = ctx.user.id;
      await requireScopedConversation(db, myId, input.conversationId, {
        write: false,
      });

      const convResult = await db.execute(sql`
        SELECT id, user1Id, user2Id
          FROM conversations
         WHERE id = ${input.conversationId}
           AND (user1Id = ${myId} OR user2Id = ${myId})
         LIMIT 1
      `);
      const conv = (
        convResult as unknown as [
          Array<{
            id: number;
            user1Id: number;
            user2Id: number;
          }>,
          unknown,
        ]
      )[0][0];
      if (!conv) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权访问该会话" });
      }

      const serviceUserId = await getServiceUserId();
      if (conv.user1Id === serviceUserId || conv.user2Id === serviceUserId) {
        return { available: false as const, reason: "service" as const };
      }

      const roundResult = await db.execute(sql`
        SELECT r.conversationId, r.roundNo, r.startedAt, r.startMessageId, r.endedAt,
               r.endedByUserId, r.participantMessageCount, r.distinctSenderCount,
               rating.stars, rating.counted
          FROM conversation_rounds r
          LEFT JOIN conversation_ratings rating
            ON rating.conversationId = r.conversationId
           AND rating.roundNo = r.roundNo
           AND rating.raterUserId = ${myId}
         WHERE r.conversationId = ${conv.id}
         ORDER BY r.roundNo DESC
         LIMIT 1
      `);
      const round = (
        roundResult as unknown as [
          Array<{
            roundNo: number;
            endedAt: Date;
            participantMessageCount: number;
            distinctSenderCount: number;
            stars: number | null;
            counted: number | null;
          }>,
          unknown,
        ]
      )[0][0];
      if (!round) {
        return { available: false as const, reason: "none" as const };
      }

      const eligible =
        Number(round.participantMessageCount) >= MIN_RATING_MESSAGE_COUNT &&
        Number(round.distinctSenderCount) >= 2;
      return {
        available: true as const,
        roundNo: Number(round.roundNo),
        endedAt: round.endedAt,
        eligible,
        alreadyRated: round.stars != null,
        stars: round.stars == null ? null : Number(round.stars),
        counted: round.counted == null ? null : Boolean(round.counted),
        canRate: eligible && round.stars == null,
      };
    }),

  rateConversationRound: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        roundNo: z.number().int().positive(),
        stars: z.number().int().min(1).max(5),
      })
    )
    .mutation(() => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "星级评价已停用，请使用公开评价",
      });
    }),

  resolveEntry: protectedProcedure
    .input(z.object({ conversationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) =>
      resolveChatEntry(await requireDb(), ctx.user.id, input.conversationId)
    ),

  getLegacyTransitionState: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        transitionId: z.number().int().positive().optional(),
      })
    )
    .use(async ({ ctx, input, next }) => {
      const db = await requireDb();
      return runWithReadyWeappConversationScope({
        executor: db,
        actorUserId: ctx.user.id,
        conversationId: input.conversationId,
        headers: ctx.req?.headers,
        action: () => next(),
      });
    })
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      return chatTransitionGetState(db, {
        actorUserId: ctx.user.id,
        conversationId: input.conversationId,
        transitionId: input.transitionId,
        currentIdentity: await resolveActorBusinessIdentity(db, ctx.user.id),
        serviceUserId: await getServiceUserId(),
      });
    }),

  confirmLegacyTransitionIdentity: protectedProcedure
    .input(
      z.object({
        conversationId: z.number().int().positive(),
        enterpriseId: z.number().int().positive().nullable(),
        transitionId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const serviceUserId = await getServiceUserId();
      return db.transaction(tx =>
        chatTransitionConfirmIdentity(tx, {
          actorUserId: ctx.user.id,
          conversationId: input.conversationId,
          enterpriseId: input.enterpriseId,
          transitionId: input.transitionId,
          serviceUserId,
        })
      );
    }),

  getContactEnterprises: protectedProcedure
    .input(z.object({ otherUserId: z.number().int().positive() }))
    .output(
      z.object({
        enterprises: z.array(
          z.object({
            enterpriseId: z.number().int().positive(),
            companyName: z.string().min(1),
          })
        ),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await requireDb();
      const myId = ctx.user.id;
      if (myId === input.otherUserId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "联系人不能是当前用户",
        });
      }
      await resolveActorBusinessIdentity(db, myId);
      await assertUserPairNotBlocked(db, myId, input.otherUserId);
      const result = (await db.execute(sql`
        SELECT DISTINCT em.enterpriseId AS enterpriseId,
               TRIM(e.companyName) AS companyName
          FROM enterprise_members em
          INNER JOIN enterprises e ON e.id = em.enterpriseId
          INNER JOIN users contact_account ON contact_account.id = em.userId
         WHERE em.userId = ${input.otherUserId}
           AND em.status = 'active'
           AND contact_account.loginDisabled = 0
           AND NULLIF(TRIM(e.companyName), '') IS NOT NULL
           AND (
             /* A real legacy or v1 pair permits its contact to choose a real active enterprise. */
             EXISTS (
               SELECT 1 FROM conversations relationship
                WHERE (relationship.user1Id = ${myId} AND relationship.user2Id = ${input.otherUserId})
                   OR (relationship.user1Id = ${input.otherUserId} AND relationship.user2Id = ${myId})
             )
             OR EXISTS (
               /* Mirror the public-company contact qualification; do not expose a private membership. */
               SELECT 1
                 FROM companies public_company
                 INNER JOIN users public_company_owner ON public_company_owner.id = public_company.userId
                WHERE public_company.enterpriseId = e.id
                  AND public_company.userId = e.crmDataOwnerUserId
                  AND public_company_owner.loginDisabled = 0
                  AND public_company.reviewStatus = 'approved'
                  AND public_company.certLevel IN ('certified', 'premium')
                  AND COALESCE(public_company.enterpriseCrmAccess, public_company_owner.crmAccess) = 1
                  AND NULLIF(TRIM(public_company.companyName), '') IS NOT NULL
                  AND (
                    (public_company.registrationRegion = 'CN'
                      AND NULLIF(TRIM(public_company.creditCode), '') IS NOT NULL
                      AND NULLIF(TRIM(public_company.legalPerson), '') IS NOT NULL)
                    OR (public_company.registrationRegion = 'HK'
                      AND REGEXP_LIKE(
                        CONVERT(COALESCE(public_company.registrationIdentifier, '') USING utf8mb4),
                        '^HK:[0-9]{8}$', 'c'
                      ))
                  )
                  AND NULLIF(TRIM(public_company.regAddress), '') IS NOT NULL
             )
           )
         ORDER BY em.enterpriseId ASC
         LIMIT 50
      `)) as unknown as [
        { enterpriseId: number; companyName: string | null }[],
        unknown,
      ];
      const rows = result[0];
      const enterprises = rows.flatMap(row => {
        const enterpriseId = Number(row.enterpriseId);
        const companyName = row.companyName?.trim() || "";
        return Number.isSafeInteger(enterpriseId) &&
          enterpriseId > 0 &&
          companyName
          ? [{ enterpriseId, companyName }]
          : [];
      });
      if (enterprises.length === 0) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "该联系人没有可公开选择的企业",
        });
      }
      return { enterprises };
    }),
});
