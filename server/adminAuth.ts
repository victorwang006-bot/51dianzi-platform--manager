import bcrypt from "bcryptjs";
import { TRPCError } from "@trpc/server";
import type { Request, Response } from "express";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import * as db from "./db";
import { isSmsConfigured, sendSmsCode } from "./sms";

/**
 * 本地账号会话的 openId 前缀。
 * authenticateRequest 校验 JWT 后会以此前缀区分本地管理员会话与 Manus OAuth 会话。
 */
export const LOCAL_ADMIN_OPEN_ID_PREFIX = "local_admin:";

/**
 * 本地后台账号的会话命名空间。
 *
 * 本地账号登录不应依赖 Manus OAuth 的 VITE_APP_ID；生产环境未启用 OAuth 时，
 * 空 appId 会导致刚签发的 JWT 在下一次 auth.me 请求中被 verifySession 拒绝。
 */
export const LOCAL_ADMIN_SESSION_APP_ID = "51dianzi-admin";

export const BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function createLocalAdminSessionToken(account: {
  id: number;
  username: string;
  displayName?: string | null;
}): Promise<string> {
  return sdk.signSession(
    {
      openId: `${LOCAL_ADMIN_OPEN_ID_PREFIX}${account.id}`,
      appId: LOCAL_ADMIN_SESSION_APP_ID,
      name: account.displayName || account.username,
    },
    { expiresInMs: ONE_YEAR_MS }
  );
}

/** 账号密码校验并签发会话 cookie；返回账号信息（不含密码哈希） */
export async function loginWithPassword(
  req: Request,
  res: Response,
  username: string,
  password: string
) {
  const account = await db.getAdminUserByUsername(username.trim());
  // 统一的错误信息，避免暴露"用户是否存在"
  const invalidError = new TRPCError({
    code: "UNAUTHORIZED",
    message: "用户名或密码错误",
  });
  if (!account || !account.passwordHash) throw invalidError;
  const ok = await verifyPassword(password, account.passwordHash);
  if (!ok) throw invalidError;
  if (account.status !== "active") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: account.status === "locked" ? "账号已被锁定，请联系超级管理员" : "账号已被停用，请联系超级管理员",
    });
  }
  const sessionToken = await createLocalAdminSessionToken(account);
  const cookieOptions = getSessionCookieOptions(req);
  res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
  await db.touchAdminUserLogin(account.id);
  const { passwordHash: _ph, ...safe } = account;
  return safe;
}

/** 从本地会话 openId 中解析 admin_users.id；非本地会话返回 null */
export function parseLocalAdminId(openId: string): number | null {
  if (!openId.startsWith(LOCAL_ADMIN_OPEN_ID_PREFIX)) return null;
  const id = Number(openId.slice(LOCAL_ADMIN_OPEN_ID_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ─── 找回密码（手机/邮箱验证码）───────────────────────────────────────────────

/** 验证码有效期（10 分钟） */
const RESET_CODE_TTL_MS = 10 * 60 * 1000;
/** 同一账号两次发送的最小间隔（60 秒） */
const RESET_CODE_RESEND_INTERVAL_MS = 60 * 1000;
/** 单个验证码最大校验失败次数 */
const RESET_CODE_MAX_ATTEMPTS = 5;

export function maskPhone(phone: string): string {
  if (phone.length < 7) return phone.replace(/./g, "*");
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
}

/** 生成 6 位数字验证码 */
function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * 发送验证码。
 * 短信渠道：已接入阿里云短信服务（配置见 SMS_* 环境变量），未配置时回退到日志输出。
 * 邮件渠道：暂未接入网关，验证码输出到服务端日志。
 */
async function deliverResetCode(
  channel: "sms" | "email",
  target: string,
  code: string
): Promise<void> {
  // 测试环境不真实发送短信（避免消耗配额且测试号码为虚拟号）
  const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  if (channel === "sms" && isSmsConfigured() && !isTestEnv) {
    const result = await sendSmsCode(target, code);
    if (!result.ok) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "短信发送失败，请稍后重试或使用邮箱找回",
      });
    }
    console.log(`[PasswordReset] 短信验证码已发送 -> ${maskPhone(target)} RequestId=${result.requestId}`);
    return;
  }
  console.log(
    `[PasswordReset] 验证码发送 -> 渠道=${channel === "sms" ? "短信" : "邮件"} 目标=${target} 验证码=${code}（有效期 10 分钟）`
  );
}

/**
 * 查询账号可用的找回渠道（脱敏展示）。
 * 账号不存在时也返回空渠道列表，不暴露账号是否存在。
 */
export async function getResetChannels(username: string) {
  const account = await db.getAdminUserByUsername(username.trim());
  const channels: { channel: "sms" | "email"; maskedTarget: string }[] = [];
  if (account && account.status === "active") {
    if (account.phone) channels.push({ channel: "sms", maskedTarget: maskPhone(account.phone) });
    if (account.email) channels.push({ channel: "email", maskedTarget: maskEmail(account.email) });
  }
  return channels;
}

/** 请求发送找回密码验证码 */
export async function requestPasswordReset(username: string, channel: "sms" | "email") {
  const account = await db.getAdminUserByUsername(username.trim());
  // 统一响应，不暴露账号是否存在
  const genericResponse = { success: true, message: "如果账号存在且已绑定该渠道，验证码已发送" } as const;
  if (!account || account.status !== "active") return genericResponse;
  const target = channel === "sms" ? account.phone : account.email;
  if (!target) return genericResponse;

  // 发送频率限制
  const active = await db.getActivePasswordResetCode(account.id);
  if (active && Date.now() - active.createdAt.getTime() < RESET_CODE_RESEND_INTERVAL_MS) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "发送过于频繁，请 1 分钟后再试" });
  }

  const code = generateCode();
  await db.createPasswordResetCode({
    adminUserId: account.id,
    channel,
    target,
    codeHash: await hashPassword(code),
    expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
  });
  await deliverResetCode(channel, target, code);
  return genericResponse;
}

/** 校验验证码并重置密码 */
export async function resetPasswordWithCode(
  username: string,
  code: string,
  newPassword: string
) {
  const invalidError = new TRPCError({
    code: "UNAUTHORIZED",
    message: "验证码错误或已失效",
  });
  const account = await db.getAdminUserByUsername(username.trim());
  if (!account || account.status !== "active") throw invalidError;
  const record = await db.getActivePasswordResetCode(account.id);
  if (!record) throw invalidError;
  if (record.attempts >= RESET_CODE_MAX_ATTEMPTS) {
    await db.markResetCodeUsed(record.id);
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "验证码错误次数过多，请重新获取" });
  }
  const ok = await verifyPassword(code, record.codeHash);
  if (!ok) {
    await db.incrementResetCodeAttempts(record.id);
    throw invalidError;
  }
  await db.markResetCodeUsed(record.id);
  await db.setAdminUserPassword(account.id, await hashPassword(newPassword));
  return { success: true } as const;
}

// ─── 找回用户名 ───────────────────────────────────────────────────────────────

/**
 * 请求发送找回用户名验证码。
 * 用户输入绑定的手机号或邮箱，向该目标发送验证码。
 * 统一响应，不暴露该手机/邮箱是否绑定了账号。
 */
export async function requestUsernameRecovery(channel: "sms" | "email", target: string) {
  const genericResponse = {
    success: true,
    message: "如果该手机号/邮箱已绑定账号，验证码已发送",
  } as const;
  const normalized = target.trim();
  const accounts =
    channel === "sms"
      ? await db.getAdminUsersByPhone(normalized)
      : await db.getAdminUsersByEmail(normalized);
  const activeAccounts = accounts.filter(a => a.status === "active");
  if (activeAccounts.length === 0) return genericResponse;

  // 频率限制：以第一个账号的验证码记录做 60 秒重发限制
  const primary = activeAccounts[0];
  const active = await db.getActivePasswordResetCode(primary.id);
  if (active && Date.now() - active.createdAt.getTime() < RESET_CODE_RESEND_INTERVAL_MS) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "发送过于频繁，请 1 分钟后再试" });
  }

  const code = generateCode();
  await db.createPasswordResetCode({
    adminUserId: primary.id,
    channel,
    target: normalized,
    codeHash: await hashPassword(code),
    expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS),
  });
  await deliverResetCode(channel, normalized, code);
  return genericResponse;
}

/**
 * 校验验证码并返回该手机号/邮箱绑定的用户名列表。
 */
export async function recoverUsernameWithCode(
  channel: "sms" | "email",
  target: string,
  code: string
) {
  const invalidError = new TRPCError({
    code: "UNAUTHORIZED",
    message: "验证码错误或已失效",
  });
  const normalized = target.trim();
  const accounts =
    channel === "sms"
      ? await db.getAdminUsersByPhone(normalized)
      : await db.getAdminUsersByEmail(normalized);
  const activeAccounts = accounts.filter(a => a.status === "active");
  if (activeAccounts.length === 0) throw invalidError;

  const primary = activeAccounts[0];
  const record = await db.getActivePasswordResetCode(primary.id);
  if (!record || record.target !== normalized) throw invalidError;
  if (record.attempts >= RESET_CODE_MAX_ATTEMPTS) {
    await db.markResetCodeUsed(record.id);
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "验证码错误次数过多，请重新获取" });
  }
  const ok = await verifyPassword(code, record.codeHash);
  if (!ok) {
    await db.incrementResetCodeAttempts(record.id);
    throw invalidError;
  }
  await db.markResetCodeUsed(record.id);
  return {
    usernames: activeAccounts.map(a => ({ username: a.username, displayName: a.displayName })),
  };
}
