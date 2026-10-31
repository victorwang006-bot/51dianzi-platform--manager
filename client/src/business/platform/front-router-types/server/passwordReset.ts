import { createHmac, randomBytes, randomInt } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  accountSecurityEvents,
  passwordResetCodes,
  users,
} from "../drizzle/schema";
import { assertPasswordPolicy } from "../../shared/passwordPolicy";
import { getDb, getUserByEmail, getUserByPhone, getUserByUsername } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { sendAliyunSms, isSmsConfigured } from "./services/smsService";
import { trustedClientIp } from "./trustedClientIp";

export type ResetChannel = "email" | "phone";
export type SecurityCodePurpose =
  | "resetPassword"
  | "passwordRecoveryProof"
  | "changePassword"
  | "verifyEmail"
  /** 邮箱换绑第一步的旧身份凭证；绝不能拿去改密或找回。 */
  | "emailChangeIdentity"
  | "rebindWechat";
export type SecurityAuditContext = {
  clientType: "web" | "weapp" | "unknown";
  ipHash: string | null;
  userAgent: string | null;
};

const CODE_TTL_SECONDS = 10 * 60;
const RECOVERY_PROOF_TTL_SECONDS = 5 * 60;
const RESEND_INTERVAL_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;
const MAX_SENDS_PER_DAY = 10;
const GENERIC_RESET_ERROR = "验证码错误、已过期或账号信息不匹配";
const DUMMY_CODE_HASH = hashPassword("account-security-dummy-code");
const AUDIT_HASH_SECRET = process.env.JWT_SECRET
  || process.env.COOKIE_SECRET
  || randomBytes(32).toString("hex");

if (
  process.env.NODE_ENV === "production"
  && (process.env.RESET_CODE_DEV_MODE === "true" || process.env.SMS_DEV_MODE === "true")
) {
  throw new Error("生产环境禁止启用 RESET_CODE_DEV_MODE 或 SMS_DEV_MODE");
}

async function waitForUniformPublicResponse(startedAt: number, minimumMs: number, jitterMs: number) {
  const targetMs = minimumMs + randomInt(0, jitterMs + 1);
  const remaining = targetMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
}

/** 开发/演示模式：真实发送渠道未配置时，验证码随响应返回，便于隔离测试。 */
export function isDevCodeMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.RESET_CODE_DEV_MODE !== "true") return false;
  if (isSmsConfigured() && process.env.SMS_DEV_MODE !== "true") return false;
  if (process.env.SMTP_URL) return false;
  return true;
}

export function maskTarget(target: string, channel: ResetChannel): string {
  if (channel === "phone") {
    return target.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
  }
  const [local, domain] = target.split("@");
  if (!domain) return target;
  const maskedLocal =
    local.length <= 2 ? `${local[0] || "*"}*` : `${local.slice(0, 2)}${"*".repeat(Math.min(local.length - 2, 4))}`;
  return `${maskedLocal}@${domain}`;
}

export function buildSecurityAuditContext(req: {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string | null };
}): SecurityAuditContext {
  const ip = trustedClientIp(req as Parameters<typeof trustedClientIp>[0]);
  const userAgentValue = req.headers?.["user-agent"];
  const userAgent = (Array.isArray(userAgentValue) ? userAgentValue[0] : userAgentValue)?.slice(0, 512) || null;
  const clientHeader = req.headers?.["x-51dianzi-client"];
  const clientType = (Array.isArray(clientHeader) ? clientHeader[0] : clientHeader) === "weapp"
    ? "weapp"
    : userAgent
      ? "web"
      : "unknown";
  const ipHash = ip ? createHmac("sha256", AUDIT_HASH_SECRET).update(ip).digest("hex") : null;
  return { clientType, ipHash, userAgent };
}

/** 根据账号（用户名/手机号/邮箱）查找用户。 */
export async function findUserByAccount(account: string) {
  const normalized = account.trim();
  if (/^1[3-9]\d{9}$/.test(normalized)) {
    const byPhone = await getUserByPhone(normalized);
    if (byPhone) return byPhone;
  }
  if (normalized.includes("@")) {
    const byEmail = await getUserByEmail(normalized.toLowerCase());
    if (byEmail) return byEmail;
  }
  return getUserByUsername(normalized);
}

function normalizeRecoveryContact(contact: string, channel: ResetChannel) {
  return channel === "email" ? contact.trim().toLowerCase() : contact.trim();
}

/** 新流程只允许用真实绑定的联系方式定位用户，绝不回退到相似的用户名。 */
async function findUserByRecoveryContact(contact: string, channel: ResetChannel) {
  const normalized = normalizeRecoveryContact(contact, channel);
  if (channel === "phone") {
    if (!/^1[3-9]\d{9}$/.test(normalized)) return undefined;
    const user = await getUserByPhone(normalized);
    return user?.phone === normalized && !user.loginDisabled ? user : undefined;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return undefined;
  const user = await getUserByEmail(normalized);
  return user?.emailVerifiedAt && user.email?.trim().toLowerCase() === normalized && !user.loginDisabled
    ? user
    : undefined;
}

function usableChannels(user: typeof users.$inferSelect) {
  const channels: { channel: ResetChannel; maskedTarget: string }[] = [];
  if (user.phone && /^1[3-9]\d{9}$/.test(user.phone)) {
    channels.push({ channel: "phone", maskedTarget: maskTarget(user.phone, "phone") });
  }
  if (user.email && user.emailVerifiedAt) {
    channels.push({ channel: "email", maskedTarget: maskTarget(user.email, "email") });
  }
  return channels;
}

export async function getAccountSecurityStatus(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const rows = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      passwordChangedAt: users.passwordChangedAt,
      email: users.email,
      pendingEmail: users.pendingEmail,
      emailVerifiedAt: users.emailVerifiedAt,
      phone: users.phone,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) throw new Error("用户不存在");
  return {
    hasPassword: Boolean(user.passwordHash),
    passwordChangedAt: user.passwordChangedAt,
    email: user.email ? maskTarget(user.email, "email") : null,
    pendingEmail: user.pendingEmail ? maskTarget(user.pendingEmail, "email") : null,
    emailVerified: Boolean(user.email && user.emailVerifiedAt),
    channels: usableChannels(user as typeof users.$inferSelect),
  };
}

/** 仅供兼容已登录旧客户端；匿名找回不再先枚举渠道。 */
export async function getResetChannels(account: string) {
  const user = await findUserByAccount(account);
  if (!user) return null;
  return { userId: user.id, username: user.username, channels: usableChannels(user) };
}

async function recordSecurityEvent(
  executor: any,
  input: {
    userId: number;
    eventType: string;
    channel?: ResetChannel;
    audit?: SecurityAuditContext;
    success?: boolean;
  },
) {
  await executor.insert(accountSecurityEvents).values({
    userId: input.userId,
    eventType: input.eventType,
    channel: input.channel ?? null,
    clientType: input.audit?.clientType ?? "unknown",
    ipHash: input.audit?.ipHash ?? null,
    userAgent: input.audit?.userAgent ?? null,
    success: input.success ?? true,
  });
}

function channelTarget(
  user: Pick<typeof users.$inferSelect, "phone" | "email" | "pendingEmail" | "emailVerifiedAt" | "passwordHash">,
  channel: ResetChannel,
  purpose: SecurityCodePurpose,
): string | null {
  const trustedEmail = user.email && user.emailVerifiedAt
    ? user.email.trim().toLowerCase()
    : null;

  // 邮箱换绑的身份凭证有严格优先级：已验证旧邮箱优先；没有旧邮箱时可用
  // 当前密码；只有两者都没有才允许绑定手机。此处同时在签发层强制该规则，
  // 防止任何未来路由直接调用 issueSecurityCode 绕过服务层选择。
  if (purpose === "emailChangeIdentity") {
    if (trustedEmail) return channel === "email" ? trustedEmail : null;
    if (user.passwordHash) return null;
    return channel === "phone" && user.phone && /^1[3-9]\d{9}$/.test(user.phone)
      ? user.phone
      : null;
  }
  if (channel === "phone") {
    return user.phone && /^1[3-9]\d{9}$/.test(user.phone) ? user.phone : null;
  }
  const verificationEmail = user.pendingEmail || user.email;
  if (!verificationEmail) return null;
  // 待验证邮箱仅可接收 verifyEmail 验证码，不能在验证成功前参与改密或找回。
  if (purpose === "verifyEmail") return verificationEmail.trim().toLowerCase();
  return trustedEmail;
}

async function deliverCode(target: string, channel: ResetChannel, code: string): Promise<boolean> {
  if (channel === "email" && process.env.SMTP_URL) {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport(process.env.SMTP_URL);
      await transporter.sendMail({
        from: process.env.SMTP_FROM || "51电子网 <noreply@51dianzi.com>",
        to: target,
        subject: "【51电子网】账号安全验证码",
        text: `您的验证码是：${code}，10 分钟内有效。如非本人操作请忽略本邮件。`,
      });
      return true;
    } catch (error) {
      console.error("[AccountSecurity] 邮件发送失败", error);
      return false;
    }
  }
  if (channel === "phone" && isSmsConfigured() && process.env.SMS_DEV_MODE !== "true") {
    const result = await sendAliyunSms(target, { code });
    if (result.ok) return true;
    console.error(`[AccountSecurity] 短信发送失败: ${result.code} ${result.message}`);
    if (result.code === "isv.AMOUNT_NOT_ENOUGH") {
      throw new Error("短信服务暂时不可用，请稍后再试或联系客服");
    }
    if (result.code === "isv.BUSINESS_LIMIT_CONTROL") {
      throw new Error("发送过于频繁，已触发运营商限制，请稍后再试");
    }
    throw new Error("短信发送失败，请稍后再试");
  }
  return false;
}

/**
 * 向指定用户签发验证码。唯一键与行锁确保首次并发发送也只有一个请求成功；
 * 所有时限均由数据库 NOW() 计算，不受应用/数据库时区差异影响。
 */
export async function issueSecurityCode(
  userId: number,
  purpose: SecurityCodePurpose,
  channel: ResetChannel,
  audit?: SecurityAuditContext,
  options: { expectedTarget?: string } = {},
) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  let code = "";
  let codeHash = "";
  let recordId = 0;
  let auditEventId = 0;
  let target = "";

  await db.transaction(async tx => {
    // 所有用途共用用户行锁，验证码小时/日配额在并发下严格串行。
    const userRows = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    const user = userRows[0];
    if (!user) throw new Error("用户不存在");
    if (purpose === "verifyEmail" && user.pendingEmail && !options.expectedTarget) {
      throw new Error("待验证新邮箱请重新进入更换邮箱流程完成本人验证");
    }
    target = channelTarget(user, channel, purpose) || "";
    if (!target) {
      if (purpose === "emailChangeIdentity") {
        throw new Error("当前账号没有可用的邮箱换绑身份验证方式，请联系客服");
      }
      if (channel === "email" && purpose !== "verifyEmail") {
        throw new Error("该账号没有已验证邮箱，请先验证邮箱或使用手机验证码");
      }
      throw new Error(channel === "phone" ? "该账号未绑定可验证手机号" : "该账号未设置邮箱");
    }
    const expectedTarget = options.expectedTarget?.trim().toLowerCase();
    if (expectedTarget && target.trim().toLowerCase() !== expectedTarget) {
      throw new Error("邮箱换绑状态已变化，请重新开始");
    }

    await tx
      .insert(passwordResetCodes)
      .values({
        userId,
        purpose,
        channel,
        target,
        codeHash: "pending",
        expiresAt: sql`NOW()` as any,
        createdAt: sql`DATE_SUB(NOW(), INTERVAL ${RESEND_INTERVAL_SECONDS + 1} SECOND)` as any,
      })
      .onDuplicateKeyUpdate({ set: { id: sql`${passwordResetCodes.id}` } });

    const rows = await tx
      .select({
        id: passwordResetCodes.id,
        elapsedSeconds: sql<number>`TIMESTAMPDIFF(SECOND, ${passwordResetCodes.createdAt}, NOW())`,
      })
      .from(passwordResetCodes)
      .where(and(
        eq(passwordResetCodes.userId, userId),
        eq(passwordResetCodes.purpose, purpose),
        eq(passwordResetCodes.channel, channel),
      ))
      .limit(1)
      .for("update");
    const record = rows[0];
    if (!record) throw new Error("验证码状态初始化失败");
    recordId = record.id;

    const elapsed = Number(record.elapsedSeconds);
    if (elapsed >= 0 && elapsed < RESEND_INTERVAL_SECONDS) {
      throw new Error(`发送过于频繁，请 ${RESEND_INTERVAL_SECONDS - elapsed} 秒后再试`);
    }

    const countRows = await tx
      .select({
        hourly: sql<number>`SUM(CASE WHEN ${accountSecurityEvents.createdAt} >= DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 1 ELSE 0 END)`,
        daily: sql<number>`COUNT(*)`,
      })
      .from(accountSecurityEvents)
      .where(and(
        eq(accountSecurityEvents.userId, userId),
        eq(accountSecurityEvents.eventType, "verification_code_sent"),
        eq(accountSecurityEvents.channel, channel),
        sql`${accountSecurityEvents.createdAt} >= DATE_SUB(NOW(), INTERVAL 1 DAY)`,
      ));
    if (Number(countRows[0]?.hourly || 0) >= MAX_SENDS_PER_HOUR) {
      throw new Error("验证码发送次数过多，请1小时后再试");
    }
    if (Number(countRows[0]?.daily || 0) >= MAX_SENDS_PER_DAY) {
      throw new Error("今日验证码发送次数已达上限，请明天再试");
    }

    code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    codeHash = hashPassword(code);

    await tx
      .update(passwordResetCodes)
      .set({
        target,
        codeHash,
        expiresAt: sql`DATE_ADD(NOW(), INTERVAL ${CODE_TTL_SECONDS} SECOND)` as any,
        usedAt: null,
        attempts: 0,
        createdAt: sql`NOW()` as any,
      })
      .where(eq(passwordResetCodes.id, record.id));

    const insertedEvent = await tx.insert(accountSecurityEvents).values({
      userId,
      eventType: "verification_code_sent",
      channel,
      clientType: audit?.clientType ?? "unknown",
      ipHash: audit?.ipHash ?? null,
      userAgent: audit?.userAgent ?? null,
      success: false,
    });
    auditEventId = Number((insertedEvent as unknown as [{ insertId?: number }])[0]?.insertId ?? 0);
    if (!auditEventId) throw new Error("验证码审计记录创建失败");
  });

  let sent = false;
  try {
    sent = await deliverCode(target, channel, code);
  } catch (error) {
    await db.delete(passwordResetCodes).where(and(
      eq(passwordResetCodes.id, recordId),
      eq(passwordResetCodes.codeHash, codeHash),
    ));
    throw error;
  }

  const devMode = !sent && isDevCodeMode();
  if (!sent && !devMode) {
    await db.delete(passwordResetCodes).where(and(
      eq(passwordResetCodes.id, recordId),
      eq(passwordResetCodes.codeHash, codeHash),
    ));
    throw new Error(
      channel === "email"
        ? "邮件服务暂时不可用，请使用手机验证码"
        : "短信服务暂时不可用，请稍后再试或联系客服",
    );
  }

  await db.update(accountSecurityEvents).set({ success: true }).where(eq(accountSecurityEvents.id, auditEventId));
  console.log(`[AccountSecurity] verification code issued user#${userId} purpose=${purpose} channel=${channel}`);
  return {
    maskedTarget: maskTarget(target, channel),
    expiresInSeconds: CODE_TTL_SECONDS,
    devCode: devMode ? code : undefined,
  };
}

export async function consumeSecurityCode(
  tx: any,
  input: {
    userId: number;
    purpose: SecurityCodePurpose;
    channel: ResetChannel;
    target: string;
    code: string;
  },
) {
  const rows = await tx
    .select({
      id: passwordResetCodes.id,
      target: passwordResetCodes.target,
      codeHash: passwordResetCodes.codeHash,
      attempts: passwordResetCodes.attempts,
      usedAt: passwordResetCodes.usedAt,
      isExpired: sql<number>`(${passwordResetCodes.expiresAt} < NOW())`,
    })
    .from(passwordResetCodes)
    .where(and(
      eq(passwordResetCodes.userId, input.userId),
      eq(passwordResetCodes.purpose, input.purpose),
      eq(passwordResetCodes.channel, input.channel),
    ))
    .limit(1)
    .for("update");
  const record = rows[0];
  if (
    !record
    || record.usedAt
    || Number(record.isExpired)
    || record.attempts >= MAX_ATTEMPTS
    || record.target.toLowerCase() !== input.target.toLowerCase()
  ) {
    verifyPassword(input.code.trim(), DUMMY_CODE_HASH);
    return false;
  }
  if (!verifyPassword(input.code.trim(), record.codeHash)) {
    await tx
      .update(passwordResetCodes)
      .set({ attempts: sql`${passwordResetCodes.attempts} + 1` })
      .where(eq(passwordResetCodes.id, record.id));
    return false;
  }
  await tx.delete(passwordResetCodes).where(eq(passwordResetCodes.id, record.id));
  return true;
}

async function notifyPasswordChanged(user: typeof users.$inferSelect) {
  if (!user.email || !user.emailVerifiedAt || !process.env.SMTP_URL) return;
  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport(process.env.SMTP_URL);
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "51电子网 <noreply@51dianzi.com>",
      to: user.email,
      subject: "【51电子网】登录密码已更新",
      text: "您的51电子网登录密码刚刚已更新，其他设备的旧登录状态已失效。如非本人操作，请立即联系平台客服。",
    });
  } catch (error) {
    console.error("[AccountSecurity] 密码变更通知邮件发送失败", error);
  }
}

async function updatePasswordInTransaction(
  tx: any,
  user: typeof users.$inferSelect,
  passwordHash: string,
  eventType: string,
  audit?: SecurityAuditContext,
  channel?: ResetChannel,
) {
  const nextSessionVersion = user.sessionVersion + 1;
  await tx
    .update(users)
    .set({
      passwordHash,
      sessionVersion: nextSessionVersion,
      passwordChangedAt: sql`NOW()` as any,
    })
    .where(eq(users.id, user.id));
  await tx.delete(passwordResetCodes).where(eq(passwordResetCodes.userId, user.id));
  await recordSecurityEvent(tx, {
    userId: user.id,
    eventType,
    channel,
    audit,
  });
  return nextSessionVersion;
}

export async function changeAuthenticatedPassword(
  userId: number,
  input:
    | { method: "currentPassword"; currentPassword: string; newPassword: string }
    | { method: "code"; channel: ResetChannel; code: string; newPassword: string },
  audit?: SecurityAuditContext,
) {
  assertPasswordPolicy(input.newPassword);
  const passwordHash = hashPassword(input.newPassword);
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");

  const result = await db.transaction(async tx => {
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    const user = rows[0];
    if (!user) throw new Error("用户不存在");

    let channel: ResetChannel | undefined;
    if (input.method === "currentPassword") {
      const failedRows = await tx
        .select({ total: sql<number>`COUNT(*)` })
        .from(accountSecurityEvents)
        .where(and(
          eq(accountSecurityEvents.userId, userId),
          eq(accountSecurityEvents.eventType, "password_change_failed_current"),
          sql`${accountSecurityEvents.createdAt} >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
        ));
      if (Number(failedRows[0]?.total || 0) >= MAX_ATTEMPTS) {
        throw new Error("当前密码验证失败次数过多，请稍后再试或使用验证码");
      }
      if (!user.passwordHash || !verifyPassword(input.currentPassword, user.passwordHash)) {
        await recordSecurityEvent(tx, {
          userId,
          eventType: "password_change_failed_current",
          audit,
          success: false,
        });
        return { ok: false as const, reason: "current" as const };
      }
    } else {
      channel = input.channel;
      const target = channelTarget(user, input.channel, "changePassword");
      if (!target) throw new Error(GENERIC_RESET_ERROR);
      const verified = await consumeSecurityCode(tx, {
        userId,
        purpose: "changePassword",
        channel: input.channel,
        target,
        code: input.code,
      });
      if (!verified) {
        await recordSecurityEvent(tx, {
          userId,
          eventType: "password_change_failed_code",
          channel: input.channel,
          audit,
          success: false,
        });
        return { ok: false as const, reason: "code" as const };
      }
    }

    if (user.passwordHash && verifyPassword(input.newPassword, user.passwordHash)) {
      throw new Error("新密码不能与当前密码相同");
    }

    const sessionVersion = await updatePasswordInTransaction(
      tx,
      user,
      passwordHash,
      input.method === "currentPassword" ? "password_changed_current" : "password_changed_code",
      audit,
      channel,
    );
    return {
      ok: true as const,
      user: { ...user, passwordHash, sessionVersion, passwordChangedAt: new Date() },
    };
  });
  if (!result.ok) {
    throw new Error(result.reason === "current" ? "当前密码不正确" : GENERIC_RESET_ERROR);
  }
  void notifyPasswordChanged(result.user);
  return result.user;
}

export async function resetPasswordForUserWithCode(
  userId: number,
  channel: ResetChannel,
  code: string,
  newPassword: string,
  audit?: SecurityAuditContext,
  purpose: "resetPassword" | "passwordRecoveryProof" = "resetPassword",
) {
  assertPasswordPolicy(newPassword);
  const passwordHash = hashPassword(newPassword);
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const result = await db.transaction(async tx => {
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    const user = rows[0];
    if (!user) throw new Error(GENERIC_RESET_ERROR);
    const target = channelTarget(user, channel, purpose);
    if (!target) throw new Error(GENERIC_RESET_ERROR);
    const verified = await consumeSecurityCode(tx, {
      userId,
      purpose,
      channel,
      target,
      code,
    });
    if (!verified) {
      await recordSecurityEvent(tx, {
        userId,
        eventType: "password_reset_failed_code",
        channel,
        audit,
        success: false,
      });
      return { ok: false as const };
    }
    if (user.passwordHash && verifyPassword(newPassword, user.passwordHash)) {
      throw new Error("新密码不能与原密码相同");
    }
    const sessionVersion = await updatePasswordInTransaction(
      tx,
      user,
      passwordHash,
      "password_reset",
      audit,
      channel,
    );
    return {
      ok: true as const,
      user: { ...user, passwordHash, sessionVersion, passwordChangedAt: new Date() },
    };
  });
  if (!result.ok) throw new Error(GENERIC_RESET_ERROR);
  void notifyPasswordChanged(result.user);
  return result.user;
}

/** 已通过通用短信服务验证手机号时使用；仍会撤销全部旧会话。 */
export async function replacePasswordAfterTrustedVerification(
  userId: number,
  newPassword: string,
  audit?: SecurityAuditContext,
) {
  assertPasswordPolicy(newPassword);
  const passwordHash = hashPassword(newPassword);
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const result = await db.transaction(async tx => {
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    const user = rows[0];
    if (!user) throw new Error(GENERIC_RESET_ERROR);
    if (user.passwordHash && verifyPassword(newPassword, user.passwordHash)) {
      throw new Error("新密码不能与原密码相同");
    }
    const sessionVersion = await updatePasswordInTransaction(
      tx,
      user,
      passwordHash,
      "password_reset",
      audit,
      "phone",
    );
    return { ...user, passwordHash, sessionVersion, passwordChangedAt: new Date() };
  });
  void notifyPasswordChanged(result);
  return result;
}

export async function verifyCurrentEmail(
  userId: number,
  code: string,
  audit?: SecurityAuditContext,
) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const result = await db.transaction(async tx => {
    const rows = await tx.select().from(users).where(eq(users.id, userId)).limit(1).for("update");
    const user = rows[0];
    if (user?.pendingEmail) {
      throw new Error("待验证新邮箱请重新进入更换邮箱流程完成本人验证");
    }
    const target = user ? channelTarget(user, "email", "verifyEmail") : null;
    if (!user || !target) throw new Error(GENERIC_RESET_ERROR);
    const verified = await consumeSecurityCode(tx, {
      userId,
      purpose: "verifyEmail",
      channel: "email",
      target,
      code,
    });
    if (!verified) {
      await recordSecurityEvent(tx, {
        userId,
        eventType: "email_verify_failed_code",
        channel: "email",
        audit,
        success: false,
      });
      return { ok: false as const };
    }
    const verifiedEmail = user.pendingEmail?.trim().toLowerCase() || user.email?.trim().toLowerCase();
    if (!verifiedEmail) throw new Error(GENERIC_RESET_ERROR);
    // pendingEmail 故意不唯一；验证事务内再次检查正式邮箱占用，避免在
    // 两个暂存请求竞争时把任一地址错误提升或泄漏为可找回渠道。
    const emailConflict = (
      await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.email, verifiedEmail), sql`${users.id} <> ${userId}`))
        .limit(1)
        .for("update")
    )[0];
    if (emailConflict) throw new Error("该邮箱已绑定其他账号");
    await tx
      .update(users)
      .set({ email: verifiedEmail, pendingEmail: null, emailVerifiedAt: sql`NOW()` as any })
      .where(eq(users.id, userId));
    await recordSecurityEvent(tx, {
      userId,
      eventType: "email_verified",
      channel: "email",
      audit,
    });
    return { ok: true as const, email: maskTarget(target, "email"), verified: true as const };
  });
  if (!result.ok) throw new Error(GENERIC_RESET_ERROR);
  return { email: result.email, verified: result.verified };
}

/** 兼容已登录旧客户端的渠道发送。 */
export async function sendResetCode(account: string, channel: ResetChannel, audit?: SecurityAuditContext) {
  const user = await findUserByAccount(account);
  if (!user) throw new Error("账号不存在，请检查用户名/手机号/邮箱");
  return issueSecurityCode(user.id, "resetPassword", channel, audit);
}

/** 登录前找回密码：无论账号是否存在都返回一致结果，防止账号枚举。 */
export async function requestPublicPasswordReset(
  account: string,
  channel: ResetChannel,
  audit?: SecurityAuditContext,
  contactOnly = false,
) {
  const startedAt = Date.now();
  let result: { expiresInSeconds: number; devCode?: string } = {
    expiresInSeconds: CODE_TTL_SECONDS,
    devCode: undefined,
  };
  let user: Awaited<ReturnType<typeof findUserByAccount>>;
  if (contactOnly) {
    try {
      user = await findUserByRecoveryContact(account, channel);
    } catch (error) {
      // 历史重复绑定、暂时性查询问题都不能成为匿名枚举信号。
      console.error("[AccountSecurity] recovery contact lookup failed", String(error));
    }
  } else {
    user = await findUserByAccount(account);
  }
  const target = user && channelTarget(user, channel, "resetPassword");
  if (user && target && (!contactOnly || target === normalizeRecoveryContact(account, channel))) {
    if (isDevCodeMode()) {
      try {
        const issued = await issueSecurityCode(user.id, "resetPassword", channel, audit);
        result = { expiresInSeconds: issued.expiresInSeconds, devCode: issued.devCode };
      } catch {
        // 开发环境也保持统一响应。
      }
    } else {
      // 生产发送不阻塞匿名响应，外部网络耗时不会成为账号枚举信号。
      void issueSecurityCode(user.id, "resetPassword", channel, audit).catch(error => {
        console.error("[AccountSecurity] public reset delivery failed", String(error));
      });
    }
  }
  await waitForUniformPublicResponse(startedAt, 800, 200);
  return result;
}

/** 仅本人填入的绑定手机号/已验证邮箱可进入新流程；返回值不泄露账号或真实送达状态。 */
export async function requestContactRecoveryCode(
  contact: string,
  channel: ResetChannel,
  audit?: SecurityAuditContext,
) {
  return requestPublicPasswordReset(normalizeRecoveryContact(contact, channel), channel, audit, true);
}

/** 一次性消费短信/邮件验证码后，原子签发五分钟的单次改密凭证。 */
export async function verifyContactRecoveryCode(
  contact: string,
  channel: ResetChannel,
  code: string,
  audit?: SecurityAuditContext,
) {
  const startedAt = Date.now();
  const normalized = normalizeRecoveryContact(contact, channel);
  try {
    const user = await findUserByRecoveryContact(normalized, channel);
    if (!user) {
      verifyPassword(code, DUMMY_CODE_HASH);
      throw new Error(GENERIC_RESET_ERROR);
    }
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const recoveryTicket = randomBytes(32).toString("hex");
    const ticketHash = hashPassword(recoveryTicket);
    const result = await db.transaction(async tx => {
      const rows = await tx.select().from(users).where(eq(users.id, user.id)).limit(1).for("update");
      const current = rows[0];
      if (!current || current.loginDisabled || channelTarget(current, channel, "resetPassword") !== normalized) {
        verifyPassword(code, DUMMY_CODE_HASH);
        return { ok: false as const };
      }
      const verified = await consumeSecurityCode(tx, {
        userId: user.id,
        purpose: "resetPassword",
        channel,
        target: normalized,
        code,
      });
      if (!verified) {
        await recordSecurityEvent(tx, {
          userId: user.id,
          eventType: "account_recovery_failed_code",
          channel,
          audit,
          success: false,
        });
        return { ok: false as const };
      }
      await tx.insert(passwordResetCodes).values({
        userId: current.id,
        purpose: "passwordRecoveryProof",
        channel,
        target: normalized,
        codeHash: ticketHash,
        expiresAt: sql`DATE_ADD(NOW(), INTERVAL ${RECOVERY_PROOF_TTL_SECONDS} SECOND)` as any,
        createdAt: sql`NOW()` as any,
      }).onDuplicateKeyUpdate({ set: {
        target: normalized,
        codeHash: ticketHash,
        expiresAt: sql`DATE_ADD(NOW(), INTERVAL ${RECOVERY_PROOF_TTL_SECONDS} SECOND)` as any,
        createdAt: sql`NOW()` as any,
        usedAt: null,
        attempts: 0,
      } });
      await recordSecurityEvent(tx, {
        userId: current.id,
        eventType: "account_recovery_verified",
        channel,
        audit,
      });
      return { ok: true as const, username: current.username || "" };
    });
    if (!result.ok) throw new Error(GENERIC_RESET_ERROR);
    await waitForUniformPublicResponse(startedAt, 500, 150);
    return { username: result.username, recoveryTicket, expiresInSeconds: RECOVERY_PROOF_TTL_SECONDS };
  } catch {
    await waitForUniformPublicResponse(startedAt, 500, 150);
    throw new Error(GENERIC_RESET_ERROR);
  }
}

/** 凭证与账号、当前联系方式及渠道匹配才可消费；成功后旧会话立即全部失效。 */
export async function completeContactRecovery(
  contact: string,
  channel: ResetChannel,
  recoveryTicket: string,
  newPassword: string,
  audit?: SecurityAuditContext,
) {
  const startedAt = Date.now();
  try {
    const normalized = normalizeRecoveryContact(contact, channel);
    const user = await findUserByRecoveryContact(normalized, channel);
    if (!user) {
      verifyPassword(recoveryTicket, DUMMY_CODE_HASH);
      throw new Error(GENERIC_RESET_ERROR);
    }
    const updated = await resetPasswordForUserWithCode(
      user.id, channel, recoveryTicket, newPassword, audit, "passwordRecoveryProof",
    );
    await waitForUniformPublicResponse(startedAt, 500, 150);
    return { username: updated.username, sessionVersion: updated.sessionVersion };
  } catch {
    await waitForUniformPublicResponse(startedAt, 500, 150);
    throw new Error(GENERIC_RESET_ERROR);
  }
}

/** 登录前找回密码：错误统一，成功后不自动登录。 */
export async function resetPasswordByCode(
  account: string,
  channel: ResetChannel,
  code: string,
  newPassword: string,
  audit?: SecurityAuditContext,
) {
  const startedAt = Date.now();
  try {
    const user = await findUserByAccount(account);
    if (!user) {
      verifyPassword(code, DUMMY_CODE_HASH);
      throw new Error(GENERIC_RESET_ERROR);
    }
    const updated = await resetPasswordForUserWithCode(user.id, channel, code, newPassword, audit);
    await waitForUniformPublicResponse(startedAt, 500, 150);
    return { username: updated.username, sessionVersion: updated.sessionVersion };
  } catch {
    await waitForUniformPublicResponse(startedAt, 500, 150);
    throw new Error(GENERIC_RESET_ERROR);
  }
}
