/**
 * 微信小程序原生订阅消息通道。
 *
 * 用户点击 `wx.requestSubscribeMessage` 后，客户端结果只做即时提示；额度必须由
 * 微信服务器推送的 `subscribe_msg_popup_event` 验签后入账。Worker按小程序、
 * 服务号、短信顺序执行，并共用微信投递业务位点，避免同一消息重复触达。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  getDb,
  getWechatBindingByOpenid,
  getWechatBindingByUserId,
} from "../db";
import { exchangeWechatCode } from "./wechatMiniProgramAuth";
import { getServiceUserId } from "./customerService";
import { reminderMaxAgeHours } from "./chatReplyReminder";

const WECHAT_API_BASE = "https://api.weixin.qq.com";
const MINI_TEMPLATE_ENDPOINT = `${WECHAT_API_BASE}/cgi-bin/message/subscribe/send`;
const REQUEST_TTL_MINUTES = 10;
const DELIVERY_DELAY_MINUTES = 5;

let cachedAccessToken = "";
let cachedAccessTokenExpiresAt = 0;

type DbRow = Record<string, unknown>;

function rowsOf<T extends DbRow>(result: unknown): T[] {
  return (result as [T[], unknown])?.[0] ?? [];
}

export function miniProgramNotificationAppId(): string {
  return String(
    process.env.WECHAT_MINIPROGRAM_APP_ID ||
      process.env.WECHAT_PAY_MINIPROGRAM_APP_ID ||
      "",
  ).trim();
}

export function miniProgramNotificationAppSecret(): string {
  return String(process.env.WECHAT_MINIPROGRAM_APP_SECRET || "").trim();
}

export function miniProgramNotificationCallbackToken(): string {
  return String(process.env.WECHAT_MINIPROGRAM_CALLBACK_TOKEN || "").trim();
}

export function miniProgramNotificationTemplateId(): string {
  return String(process.env.WECHAT_MINIPROGRAM_CHAT_TEMPLATE_ID || "").trim();
}

export function miniProgramNotificationsEnabled(): boolean {
  return process.env.WECHAT_MINIPROGRAM_CHAT_NOTIFICATIONS_ENABLED === "1";
}

function validTemplateKey(value: string): boolean {
  return /^(thing|number|symbol|character_string|time|date|amount|phone_number|car_number|name|phrase|letter)\d+$/.test(value);
}

function configuredTemplateKey(envName: string): string {
  const value = String(process.env[envName] || "").trim();
  return validTemplateKey(value) ? value : "";
}

function templateKeys(): {
  subject: string;
  peer: string;
  count: string;
  time: string;
  remark: string;
} {
  return {
    subject: configuredTemplateKey("WECHAT_MINIPROGRAM_TEMPLATE_SUBJECT_KEY"),
    peer: configuredTemplateKey("WECHAT_MINIPROGRAM_TEMPLATE_PEER_KEY"),
    count: configuredTemplateKey("WECHAT_MINIPROGRAM_TEMPLATE_COUNT_KEY"),
    time: configuredTemplateKey("WECHAT_MINIPROGRAM_TEMPLATE_TIME_KEY"),
    remark: configuredTemplateKey("WECHAT_MINIPROGRAM_TEMPLATE_REMARK_KEY"),
  };
}

export function isWechatMiniProgramSubscriptionConfigured(): boolean {
  return Boolean(
    miniProgramNotificationAppId() &&
      miniProgramNotificationAppSecret() &&
      miniProgramNotificationCallbackToken() &&
      miniProgramNotificationTemplateId(),
  );
}

export function isWechatMiniProgramDeliveryConfigured(): boolean {
  const keys = templateKeys();
  return Boolean(
    miniProgramNotificationsEnabled() &&
      isWechatMiniProgramSubscriptionConfigured() &&
      keys.subject &&
      keys.peer &&
      keys.count &&
      keys.time &&
      keys.remark,
  );
}

function requestHash(token: string): string {
  return createHash("sha256")
    .update(`wechat-mini-subscription:${token}`)
    .digest("hex");
}

export function verifyWechatMiniProgramCallbackSignature(input: {
  signature: string;
  timestamp: string;
  nonce: string;
}): boolean {
  const token = miniProgramNotificationCallbackToken();
  if (!token || !input.signature || !input.timestamp || !input.nonce) return false;
  const expected = createHash("sha1")
    .update([token, input.timestamp, input.nonce].sort().join(""))
    .digest("hex");
  const actualBuffer = Buffer.from(input.signature.toLowerCase(), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function getWechatMiniProgramNotificationStatus(userId: number): Promise<{
  bound: boolean;
  subscriptionReady: boolean;
  deliveryReady: boolean;
  availableCredits: number;
  pendingCredits: number;
}> {
  const binding = await getWechatBindingByUserId(userId);
  const db = await getDb();
  if (!binding || !db) {
    return {
      bound: Boolean(binding),
      subscriptionReady: isWechatMiniProgramSubscriptionConfigured(),
      deliveryReady: isWechatMiniProgramDeliveryConfigured(),
      availableCredits: 0,
      pendingCredits: 0,
    };
  }
  const templateId = miniProgramNotificationTemplateId();
  const counts = rowsOf<{ status: string; count: number }>(await db.execute(sql`
    SELECT status, COUNT(*) AS count
      FROM wechat_miniprogram_subscription_grants
     WHERE userId = ${userId}
       AND openid = ${binding.openid}
       AND templateId = ${templateId}
       AND status IN ('available', 'pending')
     GROUP BY status
  `));
  return {
    bound: true,
    subscriptionReady: isWechatMiniProgramSubscriptionConfigured(),
    deliveryReady: isWechatMiniProgramDeliveryConfigured(),
    availableCredits: Number(counts.find(row => row.status === "available")?.count || 0),
    pendingCredits: Number(counts.find(row => row.status === "pending")?.count || 0),
  };
}

export async function prepareWechatMiniProgramSubscription(input: {
  userId: number;
  code: string;
}): Promise<{
  requestToken: string;
  templateId: string;
  expiresInSeconds: number;
}> {
  if (!isWechatMiniProgramSubscriptionConfigured()) {
    throw new Error("小程序提醒订阅配置中，请稍后再试");
  }
  const session = await exchangeWechatCode(input.code);
  const openid = session.openid.trim();
  const [openidBinding, userBinding] = await Promise.all([
    getWechatBindingByOpenid(openid),
    getWechatBindingByUserId(input.userId),
  ]);
  if (!openidBinding || !userBinding) {
    throw new Error("当前账号尚未完成微信绑定，请重新登录小程序");
  }
  if (openidBinding.userId !== input.userId || userBinding.openid !== openid) {
    throw new Error("当前微信与登录账号不一致，请重新登录后再试");
  }

  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const templateId = miniProgramNotificationTemplateId();
  const requestToken = randomBytes(24).toString("base64url");
  const hash = requestHash(requestToken);
  await db.transaction(async tx => {
    await tx.execute(sql`
      UPDATE wechat_miniprogram_subscription_grants
         SET status = 'expired', updatedAt = NOW()
       WHERE userId = ${input.userId}
         AND openid = ${openid}
         AND templateId = ${templateId}
         AND status = 'pending'
    `);
    await tx.execute(sql`
      INSERT INTO wechat_miniprogram_subscription_grants
        (userId, openid, templateId, requestHash, status, source, expiresAt)
      VALUES
        (${input.userId}, ${openid}, ${templateId}, ${hash}, 'pending', 'native_popup',
         DATE_ADD(NOW(), INTERVAL ${REQUEST_TTL_MINUTES} MINUTE))
    `);
  });
  return {
    requestToken,
    templateId,
    expiresInSeconds: REQUEST_TTL_MINUTES * 60,
  };
}

export async function getWechatMiniProgramSubscriptionRequestStatus(input: {
  userId: number;
  requestToken: string;
}): Promise<"pending" | "available" | "revoked" | "expired" | "unknown"> {
  const db = await getDb();
  if (!db || !input.requestToken) return "unknown";
  const row = rowsOf<{ status: string }>(await db.execute(sql`
    SELECT status
      FROM wechat_miniprogram_subscription_grants
     WHERE userId = ${input.userId}
       AND requestHash = ${requestHash(input.requestToken)}
     LIMIT 1
  `))[0];
  if (!row) return "unknown";
  const status = String(row.status);
  if (["pending", "available", "revoked", "expired"].includes(status)) {
    return status as "pending" | "available" | "revoked" | "expired";
  }
  return "unknown";
}

export async function recordWechatMiniProgramSubscriptionEvent(input: {
  openid: string;
  templateId: string;
  status: "accept" | "reject";
}): Promise<{ recorded: boolean; reason: string }> {
  if (!input.openid || input.templateId !== miniProgramNotificationTemplateId()) {
    return { recorded: false, reason: "TEMPLATE_MISMATCH" };
  }
  const binding = await getWechatBindingByOpenid(input.openid);
  if (!binding) return { recorded: false, reason: "NOT_BOUND" };
  const db = await getDb();
  if (!db) return { recorded: false, reason: "DB_UNAVAILABLE" };
  return db.transaction(async tx => {
    const row = rowsOf<{ id: number }>(await tx.execute(sql`
      SELECT id
        FROM wechat_miniprogram_subscription_grants
       WHERE userId = ${binding.userId}
         AND openid = ${input.openid}
         AND templateId = ${input.templateId}
         AND status = 'pending'
         AND expiresAt >= NOW()
       ORDER BY id DESC
       LIMIT 1
       FOR UPDATE
    `))[0];
    if (!row) return { recorded: false, reason: "NO_PENDING_REQUEST" };
    const status = input.status === "accept" ? "available" : "revoked";
    await tx.execute(sql`
      UPDATE wechat_miniprogram_subscription_grants
         SET status = ${status},
             authorizedAt = ${input.status === "accept" ? new Date() : null},
             updatedAt = NOW()
       WHERE id = ${Number(row.id)}
         AND status = 'pending'
    `);
    return { recorded: true, reason: status.toUpperCase() };
  });
}

export async function getWechatMiniProgramAccessToken(forceRefresh = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedAccessToken && cachedAccessTokenExpiresAt > now + 60_000) {
    return cachedAccessToken;
  }
  const params = new URLSearchParams({
    grant_type: "client_credential",
    appid: miniProgramNotificationAppId(),
    secret: miniProgramNotificationAppSecret(),
  });
  const response = await fetch(`${WECHAT_API_BASE}/cgi-bin/token?${params.toString()}`, {
    signal: AbortSignal.timeout(8_000),
  });
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
  };
  if (!response.ok || !body.access_token) {
    throw new Error(`微信小程序AccessToken获取失败:${body.errcode || response.status}`);
  }
  cachedAccessToken = body.access_token;
  cachedAccessTokenExpiresAt = now + Math.max(300, Number(body.expires_in || 7200) - 120) * 1000;
  return cachedAccessToken;
}

interface WechatMiniCandidate {
  userId: number;
  conversationId: number;
  lastMessageId: number;
  unreadCount: number;
  peerName: string;
  lastMessageAt: Date;
}

export interface WechatMiniReminderGroup {
  userId: number;
  openid: string;
  candidates: WechatMiniCandidate[];
  totalUnread: number;
  conversationCount: number;
  latestConversationId: number;
  latestMessageId: number;
  latestMessageAt: Date;
  peerLabel: string;
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

function miniprogramState(): "developer" | "trial" | "formal" {
  const value = String(process.env.WECHAT_MINIPROGRAM_CHAT_STATE || "formal").trim();
  return value === "developer" || value === "trial" ? value : "formal";
}

export function buildWechatMiniProgramTemplateRequest(group: WechatMiniReminderGroup): {
  deliveryKey: string;
  touser: string;
  template_id: string;
  page: string;
  miniprogram_state: "developer" | "trial" | "formal";
  lang: "zh_CN";
  data: Record<string, { value: string }>;
} {
  const keys = templateKeys();
  if (!keys.subject || !keys.peer || !keys.count || !keys.time || !keys.remark) {
    throw new Error("小程序订阅模板字段未配置");
  }
  const page = group.conversationCount === 1
    ? `pages/chat/chat?id=${group.latestConversationId}`
    : "pages/chat-list/chat-list";
  const rawDeliveryKey = `chat-mini-${group.userId}-${group.latestMessageId}`;
  const deliveryKey = rawDeliveryKey.length <= 64
    ? rawDeliveryKey
    : createHash("sha256").update(rawDeliveryKey).digest("hex");
  const data: Record<string, { value: string }> = {};
  data[keys.subject] = { value: "您有来自51电子网的询价新信息。" };
  data[keys.peer] = { value: group.peerLabel.slice(0, 20) };
  data[keys.count] = { value: String(group.totalUnread) };
  data[keys.time] = { value: beijingDateTime(group.latestMessageAt) };
  data[keys.remark] = { value: "请进入51电子网小程序查看" };
  return {
    deliveryKey,
    touser: group.openid,
    template_id: miniProgramNotificationTemplateId(),
    page,
    miniprogram_state: miniprogramState(),
    lang: "zh_CN",
    data,
  };
}

async function findPendingGroups(limit = 200): Promise<WechatMiniReminderGroup[]> {
  const db = await getDb();
  if (!db) return [];
  const serviceUserId = await getServiceUserId();
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
    JOIN wechat_account_bindings b ON b.userId = s.userId
    JOIN users peer ON peer.id = CASE WHEN c.user1Id = s.userId THEN c.user2Id ELSE c.user1Id END
    LEFT JOIN companies peerCo ON peerCo.userId = peer.id
    WHERE s.unreadCount > 0
      AND s.deleted = 0
      AND c.lastMessageAt <= DATE_SUB(NOW(), INTERVAL ${DELIVERY_DELAY_MINUTES} MINUTE)
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
          FROM wechat_miniprogram_subscription_grants g
         WHERE g.userId = s.userId
           AND g.openid = b.openid
           AND g.templateId = ${miniProgramNotificationTemplateId()}
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
             OR d.attemptCount >= 3
             OR (
               d.status IN ('claimed', 'failed')
               AND d.updatedAt > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
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
  const grouped = new Map<number, WechatMiniReminderGroup>();
  for (const row of rows) {
    const candidate: WechatMiniCandidate = {
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

async function claimDeliveries(group: WechatMiniReminderGroup, clientMsgId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  for (const candidate of group.candidates) {
    await db.execute(sql`
      INSERT INTO wechat_service_notification_deliveries
        (userId, conversationId, lastMessageId, unreadCount, channel, status,
         attemptCount, clientMsgId, lastAttemptAt)
      VALUES
        (${candidate.userId}, ${candidate.conversationId}, ${candidate.lastMessageId},
         ${candidate.unreadCount}, 'miniprogram', 'claimed', 1, ${clientMsgId}, NOW())
      ON DUPLICATE KEY UPDATE
        unreadCount = VALUES(unreadCount),
        channel = IF(status = 'sent', channel, 'miniprogram'),
        status = IF(status = 'sent', 'sent', 'claimed'),
        skipReason = IF(status = 'sent', skipReason, NULL),
        attemptCount = IF(status = 'sent', attemptCount, attemptCount + 1),
        clientMsgId = IF(status = 'sent', clientMsgId, VALUES(clientMsgId)),
        lastAttemptAt = IF(status = 'sent', lastAttemptAt, NOW()),
        updatedAt = NOW()
    `);
  }
}

async function claimGrant(group: WechatMiniReminderGroup, deliveryKey: string): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  return db.transaction(async tx => {
    const row = rowsOf<{ id: number }>(await tx.execute(sql`
      SELECT id
        FROM wechat_miniprogram_subscription_grants
       WHERE userId = ${group.userId}
         AND openid = ${group.openid}
         AND templateId = ${miniProgramNotificationTemplateId()}
         AND status = 'available'
       ORDER BY authorizedAt ASC, id ASC
       LIMIT 1
       FOR UPDATE
    `))[0];
    if (!row) return null;
    const id = Number(row.id);
    await tx.execute(sql`
      UPDATE wechat_miniprogram_subscription_grants
         SET status = 'claimed', deliveryKey = ${deliveryKey}, updatedAt = NOW()
       WHERE id = ${id} AND status = 'available'
    `);
    return id;
  });
}

async function recoverStaleClaims(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.execute(sql`
    UPDATE wechat_miniprogram_subscription_grants
       SET status = 'expired', updatedAt = NOW()
     WHERE status = 'pending' AND expiresAt < NOW()
  `);
  await db.execute(sql`
    UPDATE wechat_miniprogram_subscription_grants
       SET status = 'available', deliveryKey = NULL, updatedAt = NOW()
     WHERE status = 'claimed'
       AND updatedAt < DATE_SUB(NOW(), INTERVAL 30 MINUTE)
  `);
}

async function finalizeGrant(
  grantId: number,
  input: { sent: boolean; revoke?: boolean },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  if (input.sent) {
    await db.execute(sql`
      UPDATE wechat_miniprogram_subscription_grants
         SET status = 'consumed', consumedAt = NOW(), updatedAt = NOW()
       WHERE id = ${grantId} AND status = 'claimed'
    `);
    return;
  }
  await db.execute(sql`
    UPDATE wechat_miniprogram_subscription_grants
       SET status = ${input.revoke ? "revoked" : "available"},
           deliveryKey = NULL,
           updatedAt = NOW()
     WHERE id = ${grantId} AND status = 'claimed'
  `);
}

async function finalizeDeliveries(
  group: WechatMiniReminderGroup,
  status: "sent" | "failed",
  detail: string | null,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (const candidate of group.candidates) {
    await db.execute(sql`
      UPDATE wechat_service_notification_deliveries
         SET channel = 'miniprogram',
             status = ${status},
             skipReason = ${status === "failed" ? detail || "MINI_UNCERTAIN:SEND_FAILED" : null},
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

async function postTemplate(
  request: ReturnType<typeof buildWechatMiniProgramTemplateRequest>,
): Promise<{ ok: boolean; code?: string }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await getWechatMiniProgramAccessToken(attempt === 1);
    const { deliveryKey: _deliveryKey, ...payload } = request;
    const response = await fetch(
      `${MINI_TEMPLATE_ENDPOINT}?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8_000),
      },
    );
    const body = (await response.json()) as { errcode?: number; errmsg?: string };
    if (response.ok && Number(body.errcode || 0) === 0) return { ok: true };
    if (attempt === 0 && [40001, 40014, 42001].includes(Number(body.errcode))) continue;
    return { ok: false, code: String(body.errcode || response.status || "SEND_FAILED") };
  }
  return { ok: false, code: "SEND_FAILED" };
}

const DETERMINISTIC_FALLBACK_CODES = new Set(["40037", "43101", "43104", "47003"]);

export async function runWechatMiniProgramReminderSweep(limit = 200): Promise<{
  scanned: number;
  sent: number;
  skipped: Record<string, number>;
}> {
  if (!isWechatMiniProgramDeliveryConfigured()) {
    return { scanned: 0, sent: 0, skipped: { NOT_CONFIGURED: 1 } };
  }
  await recoverStaleClaims();
  const groups = await findPendingGroups(limit);
  const skipped: Record<string, number> = {};
  let sent = 0;
  for (const group of groups) {
    const request = buildWechatMiniProgramTemplateRequest(group);
    let grantId: number | null = null;
    try {
      grantId = await claimGrant(group, request.deliveryKey);
      if (!grantId) {
        skipped.NO_SUBSCRIPTION_CREDIT = (skipped.NO_SUBSCRIPTION_CREDIT || 0) + 1;
        continue;
      }
      await claimDeliveries(group, request.deliveryKey);
      const result = await postTemplate(request);
      if (!result.ok) {
        const code = result.code || "SEND_FAILED";
        const deterministic = DETERMINISTIC_FALLBACK_CODES.has(code);
        await finalizeGrant(grantId, { sent: false, revoke: code === "43101" || code === "43104" });
        await finalizeDeliveries(
          group,
          "failed",
          `${deterministic ? "MINI_FALLBACK" : "MINI_UNCERTAIN"}:${code}`,
        );
        skipped[code] = (skipped[code] || 0) + 1;
        continue;
      }
      await finalizeGrant(grantId, { sent: true });
      await finalizeDeliveries(group, "sent", null);
      sent += 1;
    } catch (error) {
      const type = error instanceof Error ? error.name : "UnknownError";
      if (grantId) await finalizeGrant(grantId, { sent: false }).catch(() => undefined);
      await finalizeDeliveries(group, "failed", `MINI_UNCERTAIN:${type}`).catch(() => undefined);
      skipped.EXCEPTION = (skipped.EXCEPTION || 0) + 1;
      console.error("[wechat-mini] unread reminder failed", { userId: group.userId, type });
    }
  }
  return { scanned: groups.length, sent, skipped };
}
