/**
 * 未回复消息短信兜底提醒服务。
 *
 * 业务目标：买家在「聊一聊」发出询价后，若卖家长时间未回复，卖家可能
 * 根本没登录平台、不知道有人在问价，商机就这样流失。本服务通过短信把
 * 站内未读消息推送到站外，让卖家离线也能知道。
 *
 * ── 为什么只发短信、不发站内信 ─────────────────────────────
 * 若通过客服会话发站内信提醒，会形成自我触发的死循环：
 * 提醒消息本身产生一条新未读 → 下一轮扫描发现该用户又有未读 → 再次提醒。
 * 而且用户本来就有未读红点，再塞一条站内通知没有新增信息量。
 * 服务号通道会在同一单实例 Worker 中优先执行；对应消息位点一旦通过服务号
 * 发送成功，本模块会自动排除。未绑定服务号或微信发送失败时继续短信兜底。
 *
 * ── 为什么必须排除客服会话 ────────────────────────────────
 * 平台自己发出的退款通知、询价卡片都躺在客服会话里，且用户通常不会
 * 「回复」这些通知。若不排除，每个收到平台通知的用户都会被判为
 * 「未回复」而收到短信轰炸。
 *
 * ── 四重节流（缺一条都会造成骚扰或功能瘫痪）────────────────
 * 1. 同一会话同一消息位点只提醒一次（chat_reply_reminders 唯一索引）
 * 2. 每人每日上限（默认 5 条）：阿里云通知类短信有账号级每日 50 条限制，
 *    触顶后当天所有通知短信（含退款到账通知）全部发不出去
 * 3. 静默时段（默认 22:00-08:00 不发）：深夜短信极易招致投诉，且经实测
 *    运营商在深夜本就压制通知类短信，发了也收不到，纯属浪费费用
 * 4. 最大回溯窗口（默认 24 小时）：见下方说明，防止存量积压被一次性引爆
 *
 * ── 为什么需要最大回溯窗口 ──────────────────────────────
 * 上线时库里已有大量长期未读会话（实测最久 18 天）。前三重节流只防重复，
 * 拦不住「存量首次触发」：功能一生效，首轮扫描就会把所有历史未读一次性
 * 全部发出，形成集体短信轰炸，并可能瞬间打满账号每日额度，
 * 连带把退款到账通知挤掉——那是直接涉及资金的通知，绝不能被挤占。
 * 且提醒一条 18 天前的询价对成交毫无价值，早已失去时效。
 * 因此超出窗口的消息只落库标记 TOO_OLD、不发短信，让存量安静消化，
 * 功能仅对新增询价生效。
 *
 * ── 短信模板降级 ────────────────────────────────────────
 * 阿里云短信是模板制，每种通知需单独申请审核。模板未配置时本服务
 * 静默跳过，不抛异常、不阻断任何主流程；配上环境变量即刻生效，无需改代码。
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getServiceUserId } from "./customerService";
import { sendAliyunSms } from "./smsService";

/** 未回复提醒阈值（分钟）。默认 30 分钟：B2B 场景下卖家白天在处理订单、
 * 接电话、盘库存，5 分钟未回属正常状态，阈值过短会造成骚扰与短信费激增。 */
export function reminderDelayMinutes(): number {
  const raw = Number(process.env.CHAT_REMINDER_DELAY_MINUTES);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 24 * 60) return Math.floor(raw);
  return 30;
}

/** 最大回溯窗口（小时）。超过此时长的未读消息不再发短信提醒，仅落库标记。
 * 默认 24 小时：隔天的询价对方多半已另寻供应商，提醒的商业价值趋零，
 * 而骚扰感与短信成本照旧。 */
export function reminderMaxAgeHours(): number {
  const raw = Number(process.env.CHAT_REMINDER_MAX_AGE_HOURS);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 24 * 30) return Math.floor(raw);
  return 24;
}

/** 每人每日提醒上限。 */
export function reminderDailyLimit(): number {
  const raw = Number(process.env.CHAT_REMINDER_DAILY_LIMIT);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 50) return Math.floor(raw);
  return 5;
}

/** 静默时段起始小时（含），默认 22 点。 */
export function quietHourStart(): number {
  const raw = Number(process.env.CHAT_REMINDER_QUIET_START);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 23) return Math.floor(raw);
  return 22;
}

/** 静默时段结束小时（不含），默认 8 点。 */
export function quietHourEnd(): number {
  const raw = Number(process.env.CHAT_REMINDER_QUIET_END);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 23) return Math.floor(raw);
  return 8;
}

/** 提醒短信模板 CODE。未配置时短信通道静默关闭。 */
export function reminderSmsTemplateCode(): string {
  return (process.env.ALIYUN_SMS_CHAT_REMINDER_TEMPLATE_CODE || "").trim();
}

export function isReminderSmsConfigured(): boolean {
  return Boolean(
    reminderSmsTemplateCode() &&
      process.env.ALIYUN_SMS_ACCESS_KEY_ID &&
      process.env.ALIYUN_SMS_ACCESS_KEY_SECRET &&
      process.env.ALIYUN_SMS_SIGN_NAME
  );
}

/**
 * 判断当前是否处于静默时段（按服务器本地时间，生产为北京时间）。
 *
 * 支持跨天区间（如 22:00-08:00）：此时区间被 0 点切成两段，
 * 判定条件为 hour >= start 或 hour < end。
 */
export function isQuietHours(now: Date = new Date()): boolean {
  const h = now.getHours();
  const start = quietHourStart();
  const end = quietHourEnd();
  if (start === end) return false;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

/** 待提醒的候选项。 */
export interface ReminderCandidate {
  userId: number;
  conversationId: number;
  lastMessageId: number;
  unreadCount: number;
  phone: string | null;
  /** 对方显示名（公司名优先，其次姓名/用户名） */
  peerName: string;
  /** 消息已等待分钟数，用于判定是否超出回溯窗口 */
  minsWaited: number;
}

/**
 * 扫描超过阈值仍未回复的会话。
 *
 * 判定条件逐条说明：
 * - unreadCount > 0：确实有未读
 * - lastMessageAt 距今 >= 阈值：给对方留足回复时间
 * - lastReadAt < lastMessageAt：确认用户没读过这批消息（读过则不该提醒）
 * - deleted = 0：用户删除的会话不提醒
 * - 排除客服会话：避免平台通知触发自我循环
 * - 未在 chat_reply_reminders 中记录过该消息位点：幂等
 *
 * 注意：公司名不在 users 表上，而在 companies 表（users.id = companies.userId）。
 * 必须用 LEFT JOIN——未认证企业的用户没有 companies 记录，用 INNER JOIN 会
 * 把这批用户整体漏掉，个人卖家将永远收不到提醒。
 */
export async function findPendingReminders(limit = 100): Promise<ReminderCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  const csUserId = await getServiceUserId();
  const delay = reminderDelayMinutes();

  const result = await db.execute(sql`
    SELECT
      s.userId              AS userId,
      s.conversationId      AS conversationId,
      s.unreadCount         AS unreadCount,
      (SELECT MAX(m.id) FROM messages m WHERE m.conversationId = c.id) AS lastMessageId,
      u.phone               AS phone,
      TIMESTAMPDIFF(MINUTE, c.lastMessageAt, NOW()) AS minsWaited,
      COALESCE(NULLIF(peerCo.companyName, ''), NULLIF(peer.name, ''), peer.username, '对方') AS peerName
    FROM conversation_user_settings s
    JOIN conversations c ON c.id = s.conversationId
    JOIN users u ON u.id = s.userId
    JOIN users peer ON peer.id = CASE WHEN c.user1Id = s.userId THEN c.user2Id ELSE c.user1Id END
    LEFT JOIN companies peerCo ON peerCo.userId = peer.id
    WHERE s.unreadCount > 0
      AND s.deleted = 0
      AND c.lastMessageAt <= DATE_SUB(NOW(), INTERVAL ${delay} MINUTE)
      AND s.lastReadAt < c.lastMessageAt
      AND c.user1Id <> ${csUserId}
      AND c.user2Id <> ${csUserId}
      AND COALESCE((
        SELECT latest.msgType
          FROM messages latest
         WHERE latest.conversationId = c.id
         ORDER BY latest.id DESC
         LIMIT 1
      ), '') <> 'handoff_notice'
      AND u.phone IS NOT NULL
      AND u.phone <> ''
      AND NOT EXISTS (
        SELECT 1 FROM chat_reply_reminders r
         WHERE r.userId = s.userId
           AND r.conversationId = s.conversationId
           AND r.lastMessageId = (SELECT MAX(m2.id) FROM messages m2 WHERE m2.conversationId = c.id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM wechat_service_notification_deliveries wd
         WHERE wd.userId = s.userId
           AND wd.conversationId = s.conversationId
           AND wd.lastMessageId = (SELECT MAX(m3.id) FROM messages m3 WHERE m3.conversationId = c.id)
           AND wd.status = 'sent'
      )
    ORDER BY c.lastMessageAt ASC
    LIMIT ${limit}
  `);
  const rows = (result as unknown as [Array<Record<string, unknown>>, unknown])[0];
  return rows
    .map(r => ({
      userId: Number(r.userId),
      conversationId: Number(r.conversationId),
      lastMessageId: Number(r.lastMessageId ?? 0),
      unreadCount: Number(r.unreadCount ?? 0),
      phone: r.phone ? String(r.phone) : null,
      peerName: String(r.peerName ?? "对方"),
      minsWaited: Number(r.minsWaited ?? 0),
    }))
    .filter(c => c.lastMessageId > 0);
}

/** 查询某用户当日已发送的提醒条数（用于每日上限判定）。 */
export async function countTodayReminders(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.execute(sql`
    SELECT COUNT(*) AS n
      FROM chat_reply_reminders
     WHERE userId = ${userId}
       AND smsSent = 1
       AND createdAt >= CURDATE()
  `);
  const rows = (result as unknown as [Array<{ n: number }>, unknown])[0];
  return Number(rows[0]?.n ?? 0);
}

/** 提醒执行结果。 */
export interface ReminderResult {
  sent: boolean;
  skipReason?: string;
}

/**
 * 对单个候选项执行提醒。
 *
 * 落库与发送的顺序是刻意的：**先抢占唯一索引，再发短信**。
 * 若先发短信后落库，插入失败（如并发）时短信已经发出，无法回收，
 * 用户会收到重复短信。反之先落库，抢不到就直接跳过，最坏情况是
 * 少发一条提醒——这远比重复轰炸可接受。
 */
export async function sendReminder(candidate: ReminderCandidate): Promise<ReminderResult> {
  const db = await getDb();
  if (!db) return { sent: false, skipReason: "NO_DB" };

  // 静默时段：不发短信也不落库，等白天再提醒（落库会占掉幂等位点，
  // 导致白天永远不再提醒这批消息）
  if (isQuietHours()) return { sent: false, skipReason: "QUIET_HOURS" };

  const templateCode = reminderSmsTemplateCode();
  const configured = isReminderSmsConfigured();

  // 超出回溯窗口：必须落库占住幂等位点后直接返回，不发短信。
  // 不落库会让这批存量每轮扫描都被重复查出，白白消耗数据库资源。
  if (candidate.minsWaited > reminderMaxAgeHours() * 60) {
    try {
      await db.execute(sql`
        INSERT INTO chat_reply_reminders
          (userId, conversationId, lastMessageId, unreadCount, channel, smsSent, smsSkipReason)
        VALUES
          (${candidate.userId}, ${candidate.conversationId}, ${candidate.lastMessageId},
           ${candidate.unreadCount}, 'sms', 0, 'TOO_OLD')
      `);
    } catch {
      // 幂等冲突无需处理
    }
    return { sent: false, skipReason: "TOO_OLD" };
  }

  // 每日上限
  if (configured) {
    const todayCount = await countTodayReminders(candidate.userId);
    if (todayCount >= reminderDailyLimit()) {
      return { sent: false, skipReason: "DAILY_LIMIT" };
    }
  }

  // 先抢占幂等位点。唯一索引冲突说明已有其它进程处理过，直接放弃。
  try {
    await db.execute(sql`
      INSERT INTO chat_reply_reminders
        (userId, conversationId, lastMessageId, unreadCount, channel, smsSent, smsSkipReason)
      VALUES
        (${candidate.userId}, ${candidate.conversationId}, ${candidate.lastMessageId},
         ${candidate.unreadCount}, 'sms', 0, ${configured ? null : "NO_TEMPLATE"})
    `);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("Duplicate entry") || msg.includes("ER_DUP_ENTRY")) {
      return { sent: false, skipReason: "ALREADY_REMINDED" };
    }
    console.error("[chatReminder] 记录提醒失败:", err);
    return { sent: false, skipReason: "DB_ERROR" };
  }

  if (!configured) {
    return { sent: false, skipReason: "NO_TEMPLATE" };
  }
  if (!candidate.phone) {
    return { sent: false, skipReason: "NO_PHONE" };
  }

  // 通知失败绝不向上抛：提醒是增强功能，不能因短信异常影响 Worker 其它任务
  try {
    const res = await sendAliyunSms(
      candidate.phone,
      { name: candidate.peerName, count: String(candidate.unreadCount) },
      { templateCode }
    );
    await db.execute(sql`
      UPDATE chat_reply_reminders
         SET smsSent = ${res.ok ? 1 : 0},
             smsSkipReason = ${res.ok ? null : res.code || "SEND_FAILED"}
       WHERE userId = ${candidate.userId}
         AND conversationId = ${candidate.conversationId}
         AND lastMessageId = ${candidate.lastMessageId}
    `);
    if (!res.ok) {
      console.warn(
        `[chatReminder] 短信发送失败 user=${candidate.userId} conv=${candidate.conversationId} code=${res.code}`
      );
      return { sent: false, skipReason: res.code || "SEND_FAILED" };
    }
    return { sent: true };
  } catch (err) {
    console.error("[chatReminder] 短信发送异常:", err);
    return { sent: false, skipReason: "EXCEPTION" };
  }
}

/** 批量执行一轮提醒，返回统计结果。 */
export async function runReminderSweep(limit = 100): Promise<{
  scanned: number;
  sent: number;
  skipped: Record<string, number>;
}> {
  const skipped: Record<string, number> = {};
  // 静默时段整轮跳过，省去无意义的数据库扫描
  if (isQuietHours()) return { scanned: 0, sent: 0, skipped: { QUIET_HOURS: 1 } };

  const candidates = await findPendingReminders(limit);
  let sent = 0;
  for (const c of candidates) {
    const r = await sendReminder(c);
    if (r.sent) sent += 1;
    else if (r.skipReason) skipped[r.skipReason] = (skipped[r.skipReason] ?? 0) + 1;
  }
  return { scanned: candidates.length, sent, skipped };
}
