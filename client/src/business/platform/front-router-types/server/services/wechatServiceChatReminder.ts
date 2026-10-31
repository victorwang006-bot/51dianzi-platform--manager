/**
 * 服务号「聊一聊」未读提醒通道。
 *
 * 与短信通道分表幂等、同一单实例 Worker 顺序执行：服务号发送成功后短信查询
 * 自动排除对应消息位点；未绑定、未配置或微信发送失败时，原短信提醒继续兜底。
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getServiceUserId } from "./customerService";
import {
  getWechatServiceAccessToken,
  serviceAccountAppId,
  serviceAccountAppSecret,
  serviceAccountSubscriptionTemplateId,
} from "./wechatServiceAccount";
import { reminderMaxAgeHours } from "./chatReplyReminder";

const WECHAT_TEMPLATE_ENDPOINT = "https://api.weixin.qq.com/cgi-bin/message/subscribe/bizsend";
const DEFAULT_TEMPLATE_KEYS = {
  subject: "thing30",
  peer: "thing4",
  count: "number5",
  time: "time3",
  remark: "thing7",
} as const;

type DbRow = Record<string, unknown>;

function rowsOf<T extends DbRow>(result: unknown): T[] {
  return (result as [T[], unknown])?.[0] ?? [];
}

export function wechatServiceTemplateId(): string {
  return serviceAccountSubscriptionTemplateId();
}

export function wechatServiceNotificationsEnabled(): boolean {
  return process.env.WECHAT_SERVICE_CHAT_NOTIFICATIONS_ENABLED === "1";
}

export function wechatServiceMiniProgramAppId(): string {
  const appId = String(
    process.env.WECHAT_SERVICE_MINIPROGRAM_APP_ID ||
      process.env.WECHAT_PAY_MINIPROGRAM_APP_ID ||
      "",
  ).trim();
  if (appId && !/^wx[0-9A-Za-z]{16}$/.test(appId)) {
    throw new Error("WECHAT_SERVICE_MINIPROGRAM_APP_ID格式不正确");
  }
  return appId;
}

export function isWechatServiceNotificationConfigured(): boolean {
  return Boolean(
      wechatServiceNotificationsEnabled() &&
      serviceAccountAppId() &&
      serviceAccountAppSecret() &&
      wechatServiceTemplateId() &&
      wechatServiceMiniProgramAppId(),
  );
}

export function wechatServiceReminderDelayMinutes(): number {
  const raw = Number(process.env.WECHAT_SERVICE_CHAT_DELAY_MINUTES);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 24 * 60) return Math.floor(raw);
  return 5;
}

interface WechatServiceCandidate {
  userId: number;
  conversationId: number;
  lastMessageId: number;
  unreadCount: number;
  peerName: string;
  lastMessageAt: Date;
}

export interface WechatServiceReminderGroup {
  userId: number;
  openid: string;
  candidates: WechatServiceCandidate[];
  totalUnread: number;
  conversationCount: number;
  latestConversationId: number;
  latestMessageId: number;
  latestMessageAt: Date;
  peerLabel: string;
}

function validTemplateKey(value: string): boolean {
  return /^(thing|number|symbol|character_string|time|date|amount|phone_number|car_number|name|phrase|letter)\d+$/.test(value);
}

function templateKey(envName: string, fallback: string): string {
  const value = String(process.env[envName] || fallback).trim();
  if (!validTemplateKey(value)) throw new Error(`${envName}格式不正确`);
  return value;
}

function miniprogramState(): "developer" | "trial" | "formal" {
  const value = String(process.env.WECHAT_SERVICE_MINIPROGRAM_STATE || "formal").trim();
  return value === "developer" || value === "trial" ? value : "formal";
}

function beijingDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}`;
}

export function buildWechatServiceTemplateRequest(group: WechatServiceReminderGroup): {
  deliveryKey: string;
  touser: string;
  template_id: string;
  page: string;
  miniprogram: {
    appid: string;
    pagepath: string;
  };
  miniprogram_state: "developer" | "trial" | "formal";
  lang: "zh_CN";
  data: Record<string, { value: string }>;
} {
  const subjectKey = templateKey("WECHAT_SERVICE_TEMPLATE_SUBJECT_KEY", DEFAULT_TEMPLATE_KEYS.subject);
  const peerKey = templateKey("WECHAT_SERVICE_TEMPLATE_PEER_KEY", DEFAULT_TEMPLATE_KEYS.peer);
  const countKey = templateKey("WECHAT_SERVICE_TEMPLATE_COUNT_KEY", DEFAULT_TEMPLATE_KEYS.count);
  const timeKey = templateKey("WECHAT_SERVICE_TEMPLATE_TIME_KEY", DEFAULT_TEMPLATE_KEYS.time);
  const remarkKey = templateKey("WECHAT_SERVICE_TEMPLATE_REMARK_KEY", DEFAULT_TEMPLATE_KEYS.remark);
  const pagepath = group.conversationCount === 1
    ? `pages/chat/chat?id=${group.latestConversationId}`
    : "pages/chat-list/chat-list";
  const rawDeliveryKey = `chat-unread-${group.userId}-${group.latestMessageId}`;
  const deliveryKey = rawDeliveryKey.length <= 64
    ? rawDeliveryKey
    : createHash("sha256").update(rawDeliveryKey).digest("hex");
  const data: Record<string, { value: string }> = {};
  data[subjectKey] = { value: "您有来自51电子网的询价新信息。" };
  data[peerKey] = { value: group.peerLabel.slice(0, 20) };
  data[countKey] = { value: String(group.totalUnread) };
  data[timeKey] = { value: beijingDateTime(group.latestMessageAt) };
  data[remarkKey] = { value: "请进入51电子网小程序查看" };
  return {
    deliveryKey,
    touser: group.openid,
    template_id: wechatServiceTemplateId(),
    page: "https://51dianzi.com/chat",
    miniprogram: {
      appid: wechatServiceMiniProgramAppId(),
      pagepath,
    },
    miniprogram_state: miniprogramState(),
    lang: "zh_CN",
    data,
  };
}

async function findPendingWechatServiceGroups(limit = 200): Promise<WechatServiceReminderGroup[]> {
  const db = await getDb();
  if (!db) return [];
  const serviceUserId = await getServiceUserId();
  const delay = wechatServiceReminderDelayMinutes();
  const maxAge = reminderMaxAgeHours();
  const result = await db.execute(sql`
    SELECT
      s.userId AS userId,
      s.conversationId AS conversationId,
      s.unreadCount AS unreadCount,
      b.openid AS openid,
      c.lastMessageAt AS lastMessageAt,
      (SELECT MAX(m.id) FROM messages m WHERE m.conversationId = c.id) AS lastMessageId,
      COALESCE(NULLIF(peerCo.companyName, ''), NULLIF(peer.name, ''), peer.username, '对方') AS peerName
    FROM conversation_user_settings s
    JOIN conversations c ON c.id = s.conversationId
    JOIN wechat_service_account_bindings b
      ON b.userId = s.userId
     AND b.reminderEnabled = 1
    JOIN users peer ON peer.id = CASE WHEN c.user1Id = s.userId THEN c.user2Id ELSE c.user1Id END
    LEFT JOIN companies peerCo ON peerCo.userId = peer.id
    WHERE s.unreadCount > 0
      AND s.deleted = 0
      AND c.lastMessageAt <= DATE_SUB(NOW(), INTERVAL ${delay} MINUTE)
      AND c.lastMessageAt >= DATE_SUB(NOW(), INTERVAL ${maxAge} HOUR)
      AND s.lastReadAt < c.lastMessageAt
      AND c.user1Id <> ${serviceUserId}
      AND c.user2Id <> ${serviceUserId}
      AND COALESCE((
        SELECT latest.msgType
          FROM messages latest
         WHERE latest.conversationId = c.id
         ORDER BY latest.id DESC
         LIMIT 1
      ), '') <> 'handoff_notice'
      AND EXISTS (
        SELECT 1
          FROM wechat_service_subscription_grants g
         WHERE g.userId = s.userId
           AND g.openid = b.openid
           AND g.templateId = ${wechatServiceTemplateId()}
           AND g.status = 'available'
      )
      AND NOT EXISTS (
        SELECT 1
          FROM wechat_service_notification_deliveries d
         WHERE d.userId = s.userId
           AND d.conversationId = s.conversationId
           AND d.lastMessageId = (
             SELECT MAX(m2.id) FROM messages m2 WHERE m2.conversationId = c.id
           )
           AND (
             d.status = 'sent'
             OR (d.channel = 'service_account' AND d.attemptCount >= 3)
             OR (
               d.status IN ('claimed', 'failed')
               AND d.updatedAt > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
               AND (d.skipReason IS NULL OR d.skipReason NOT LIKE 'MINI_FALLBACK:%')
             )
           )
      )
    ORDER BY s.userId ASC, c.lastMessageAt DESC
    LIMIT ${limit}
  `);
  const rows = rowsOf<{
    userId: number;
    conversationId: number;
    unreadCount: number;
    openid: string;
    lastMessageAt: Date | string;
    lastMessageId: number;
    peerName: string;
  }>(result);
  const grouped = new Map<number, WechatServiceReminderGroup>();
  for (const row of rows) {
    const candidate: WechatServiceCandidate = {
      userId: Number(row.userId),
      conversationId: Number(row.conversationId),
      lastMessageId: Number(row.lastMessageId || 0),
      unreadCount: Number(row.unreadCount || 0),
      peerName: String(row.peerName || "对方"),
      lastMessageAt: row.lastMessageAt instanceof Date
        ? row.lastMessageAt
        : new Date(String(row.lastMessageAt).replace(" ", "T") + "+08:00"),
    };
    if (!candidate.lastMessageId || !candidate.unreadCount) continue;
    const existing = grouped.get(candidate.userId);
    if (!existing) {
      grouped.set(candidate.userId, {
        userId: candidate.userId,
        openid: String(row.openid),
        candidates: [candidate],
        totalUnread: candidate.unreadCount,
        conversationCount: 1,
        latestConversationId: candidate.conversationId,
        latestMessageId: candidate.lastMessageId,
        latestMessageAt: candidate.lastMessageAt,
        peerLabel: candidate.peerName,
      });
      continue;
    }
    existing.candidates.push(candidate);
    existing.totalUnread += candidate.unreadCount;
    existing.conversationCount += 1;
    existing.peerLabel = `${existing.conversationCount}个会话`;
  }
  return Array.from(grouped.values());
}

async function claimDeliveries(group: WechatServiceReminderGroup, clientMsgId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  for (const candidate of group.candidates) {
    await db.execute(sql`
      INSERT INTO wechat_service_notification_deliveries
        (userId, conversationId, lastMessageId, unreadCount, channel, status,
         attemptCount, clientMsgId, lastAttemptAt)
      VALUES
        (${candidate.userId}, ${candidate.conversationId}, ${candidate.lastMessageId},
         ${candidate.unreadCount}, 'service_account', 'claimed', 1, ${clientMsgId}, NOW())
      ON DUPLICATE KEY UPDATE
        unreadCount = VALUES(unreadCount),
        channel = IF(status = 'sent', channel, 'service_account'),
        status = IF(status = 'sent', 'sent', 'claimed'),
        skipReason = IF(status = 'sent', skipReason, NULL),
        attemptCount = IF(status = 'sent', attemptCount, attemptCount + 1),
        clientMsgId = IF(status = 'sent', clientMsgId, VALUES(clientMsgId)),
        lastAttemptAt = IF(status = 'sent', lastAttemptAt, NOW()),
        updatedAt = NOW()
    `);
  }
}

async function claimSubscriptionGrant(
  group: WechatServiceReminderGroup,
  deliveryKey: string,
): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  return db.transaction(async tx => {
    const row = rowsOf<{ id: number }>(await tx.execute(sql`
      SELECT id
        FROM wechat_service_subscription_grants
       WHERE userId = ${group.userId}
         AND openid = ${group.openid}
         AND templateId = ${wechatServiceTemplateId()}
         AND status = 'available'
       ORDER BY authorizedAt ASC, id ASC
       LIMIT 1
       FOR UPDATE
    `))[0];
    if (!row) return null;
    const id = Number(row.id);
    await tx.execute(sql`
      UPDATE wechat_service_subscription_grants
         SET status = 'claimed', deliveryKey = ${deliveryKey}, updatedAt = NOW()
       WHERE id = ${id} AND status = 'available'
    `);
    return id;
  });
}

async function recoverStaleSubscriptionGrants(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    UPDATE wechat_service_subscription_grants
       SET status = 'available', deliveryKey = NULL, updatedAt = NOW()
     WHERE status = 'claimed'
       AND updatedAt < DATE_SUB(NOW(), INTERVAL 30 MINUTE)
  `);
}

async function finalizeSubscriptionGrant(
  grantId: number,
  input: { sent: boolean; code?: string },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (input.sent) {
    await db.execute(sql`
      UPDATE wechat_service_subscription_grants
         SET status = 'consumed', consumedAt = NOW(), updatedAt = NOW()
       WHERE id = ${grantId} AND status = 'claimed'
    `);
    return;
  }
  const revoked = [43101, 43104].includes(Number(input.code || 0));
  await db.execute(sql`
    UPDATE wechat_service_subscription_grants
       SET status = ${revoked ? "revoked" : "available"}, deliveryKey = NULL, updatedAt = NOW()
     WHERE id = ${grantId} AND status = 'claimed'
  `);
}

async function finalizeDeliveries(
  group: WechatServiceReminderGroup,
  status: "sent" | "failed",
  detail: string | null,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (const candidate of group.candidates) {
    await db.execute(sql`
      UPDATE wechat_service_notification_deliveries
         SET channel = 'service_account',
             status = ${status},
             skipReason = ${status === "failed" ? detail || "SEND_FAILED" : null},
             wechatMessageId = ${status === "sent" ? detail : null},
             sentAt = ${status === "sent" ? new Date() : null},
             updatedAt = NOW()
       WHERE userId = ${candidate.userId}
         AND conversationId = ${candidate.conversationId}
         AND lastMessageId = ${candidate.lastMessageId}
         AND status <> 'sent'
    `);
  }
}

async function postTemplate(request: ReturnType<typeof buildWechatServiceTemplateRequest>): Promise<{
  ok: boolean;
  messageId?: string;
  code?: string;
}> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getWechatServiceAccessToken(attempt === 1);
    const { deliveryKey: _deliveryKey, ...payload } = request;
    const response = await fetch(`${WECHAT_TEMPLATE_ENDPOINT}?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await response.json()) as { errcode?: number; errmsg?: string; msgid?: number | string };
    if (response.ok && Number(body.errcode || 0) === 0) {
      return { ok: true, messageId: String(body.msgid || "") };
    }
    const code = String(body.errcode || response.status || "SEND_FAILED");
    if (attempt === 0 && [40001, 40014, 42001].includes(Number(body.errcode))) continue;
    return { ok: false, code };
  }
  return { ok: false, code: "SEND_FAILED" };
}

export async function runWechatServiceReminderSweep(limit = 200): Promise<{
  scanned: number;
  sent: number;
  skipped: Record<string, number>;
}> {
  if (!isWechatServiceNotificationConfigured()) {
    return { scanned: 0, sent: 0, skipped: { NOT_CONFIGURED: 1 } };
  }
  await recoverStaleSubscriptionGrants();
  const groups = await findPendingWechatServiceGroups(limit);
  const skipped: Record<string, number> = {};
  let sent = 0;
  for (const group of groups) {
    const request = buildWechatServiceTemplateRequest(group);
    let grantId: number | null = null;
    try {
      grantId = await claimSubscriptionGrant(group, request.deliveryKey);
      if (!grantId) {
        skipped.NO_SUBSCRIPTION_CREDIT = (skipped.NO_SUBSCRIPTION_CREDIT || 0) + 1;
        continue;
      }
      await claimDeliveries(group, request.deliveryKey);
      const result = await postTemplate(request);
      if (!result.ok) {
        await finalizeSubscriptionGrant(grantId, { sent: false, code: result.code });
        await finalizeDeliveries(group, "failed", result.code || "SEND_FAILED");
        skipped[result.code || "SEND_FAILED"] = (skipped[result.code || "SEND_FAILED"] || 0) + 1;
        continue;
      }
      await finalizeSubscriptionGrant(grantId, { sent: true });
      await finalizeDeliveries(group, "sent", result.messageId || null);
      sent += 1;
    } catch (error) {
      const type = error instanceof Error ? error.name : "UnknownError";
      if (grantId) await finalizeSubscriptionGrant(grantId, { sent: false }).catch(() => undefined);
      await finalizeDeliveries(group, "failed", type).catch(() => undefined);
      skipped.EXCEPTION = (skipped.EXCEPTION || 0) + 1;
      console.error("[wechat-service] unread reminder failed", { userId: group.userId, type });
    }
  }
  return { scanned: groups.length, sent, skipped };
}
