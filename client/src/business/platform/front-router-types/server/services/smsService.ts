/**
 * 阿里云短信发送服务 + 通用短信验证码（登录 / 注册 / 找回用户名 / 重置密码等公共场景）。
 *
 * 环境变量（生产 ECS 上通过 PM2 ecosystem 注入）：
 * - ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET  RAM 子账号密钥（仅授权 AliyunDysmsFullAccess）
 * - ALIYUN_SMS_SIGN_NAME       短信签名（当前：深圳市智捷创芯信息科技；「51电子网」过审后切换）
 * - ALIYUN_SMS_TEMPLATE_CODE   验证码模板 CODE（SMS_511070041，变量 ${code}）
 * - SMS_DEV_MODE               "true" 时不真实发送，验证码随响应返回（开发/演示）
 *
 * 开发模式必须在非生产环境显式启用；生产缺少凭证时一律失败关闭。
 */
import { createHash, createHmac, randomInt, randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 分钟有效
const RESEND_INTERVAL_MS = 60 * 1000; // 60 秒重发限制
const MAX_ATTEMPTS = 5; // 校验失败 5 次作废

/**
 * 验证码存储：数据库表 sms_verification_codes（PM2 cluster 多进程共享）。
 * 曾用进程内 Map 存储，在 4 进程 cluster 下发送与校验落到不同进程导致
 * "短信验证码错误"，故迁移到数据库（2026-07-25 修复）。
 */
async function getDbForSms() {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("数据库不可用，请稍后再试");
  return db;
}

function hashCode(code: string): string {
  const secret = process.env.JWT_SECRET || "sms-code-secret";
  return createHmac("sha256", secret).update(code).digest("hex");
}

export function isSmsConfigured(): boolean {
  return Boolean(
    process.env.ALIYUN_SMS_ACCESS_KEY_ID &&
      process.env.ALIYUN_SMS_ACCESS_KEY_SECRET &&
      process.env.ALIYUN_SMS_SIGN_NAME &&
      process.env.ALIYUN_SMS_TEMPLATE_CODE
  );
}

export function isSmsDevMode(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.SMS_DEV_MODE === "true";
}

/* ------------------------------------------------------------------ */
/* 阿里云短信 OpenAPI（RPC 签名 V1.0，无 SDK 依赖，直接 HTTPS 调用）        */
/* ------------------------------------------------------------------ */

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

/**
 * 调用阿里云 SendSms 接口。成功返回 { ok: true }；失败返回 { ok: false, code, message }。
 */
export async function sendAliyunSms(
  phone: string,
  templateParam: Record<string, string>,
  opts?: { signName?: string; templateCode?: string }
): Promise<{ ok: boolean; code?: string; message?: string; bizId?: string }> {
  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID || "";
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET || "";
  const signName = opts?.signName || process.env.ALIYUN_SMS_SIGN_NAME || "";
  const templateCode = opts?.templateCode || process.env.ALIYUN_SMS_TEMPLATE_CODE || "";
  if (!accessKeyId || !accessKeySecret || !signName || !templateCode) {
    return { ok: false, code: "NOT_CONFIGURED", message: "短信服务未配置" };
  }

  const params: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: phone,
    RegionId: "cn-hangzhou",
    SignName: signName,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: randomUUID(),
    SignatureVersion: "1.0",
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify(templateParam),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2017-05-25",
  };

  const sortedKeys = Object.keys(params).sort();
  const canonical = sortedKeys
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join("&");
  const stringToSign = `POST&${percentEncode("/")}&${percentEncode(canonical)}`;
  const signature = createHmac("sha1", `${accessKeySecret}&`)
    .update(stringToSign)
    .digest("base64");

  const body = `Signature=${percentEncode(signature)}&${canonical}`;
  try {
    const resp = await fetch("https://dysmsapi.aliyuncs.com/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await resp.json()) as { Code?: string; Message?: string; BizId?: string };
    if (data.Code === "OK") {
      return { ok: true, bizId: data.BizId };
    }
    console.error(`[SMS] SendSms failed: ${data.Code} ${data.Message}`);
    return { ok: false, code: data.Code, message: data.Message };
  } catch (e) {
    console.error("[SMS] SendSms network error:", e);
    return { ok: false, code: "NETWORK_ERROR", message: String(e) };
  }
}

/* ------------------------------------------------------------------ */
/* 通用验证码：发送 + 校验（登录 / 注册 / 找回用户名 / 手机重置密码）       */
/* ------------------------------------------------------------------ */

export type SmsScene =
  | "login"
  | "register"
  | "recoverUsername"
  | "resetPassword"
  | "changeUsername"
  | "changeEmail"
  | "changePhoneCurrent"
  | "changePhoneNew"
  /** 企业所有者转让时，向当前所有者本人发送的二次确认验证码。 */
  | "enterpriseOwnershipTransfer";

type VerificationCodeOptions = {
  /** 将高权限验证码绑定到具体操作；数据库只保存不可逆摘要。 */
  contextKey?: string;
};

function verificationStorageScene(scene: SmsScene, options: VerificationCodeOptions = {}) {
  if (scene === "enterpriseOwnershipTransfer" && !options.contextKey) {
    throw new Error("企业所有者转让验证码缺少操作绑定");
  }
  if (!options.contextKey) return scene;
  if (scene !== "enterpriseOwnershipTransfer") {
    throw new Error("当前短信验证码场景不支持操作绑定");
  }
  const digest = createHash("sha256").update(options.contextKey).digest("hex");
  return `ownerXfer:${digest.slice(0, 22)}`;
}

/** 生成并发送验证码。开发模式返回 devCode；生产模式真实发送。 */
export async function sendVerificationCode(scene: SmsScene, phone: string, options: VerificationCodeOptions = {}) {
  const db = await getDbForSms();
  const { smsVerificationCodes } = await import("../../drizzle/schema");
  const storageScene = verificationStorageScene(scene, options);
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  const codeHash = hashCode(code);

  await db.transaction(async tx => {
    if (options.contextKey) {
      // 具体验证码按请求绑定，但限流仍按“场景+手机号”共享，避免更换 requestId 绕过 60 秒频控。
      await tx
        .insert(smsVerificationCodes)
        .values({
          scene,
          phone,
          codeHash: "rate-limit-only",
          expiresAt: sql`NOW()` as any,
          createdAt: sql`DATE_SUB(NOW(), INTERVAL ${RESEND_INTERVAL_MS / 1000 + 1} SECOND)` as any,
        })
        .onDuplicateKeyUpdate({ set: { id: sql`${smsVerificationCodes.id}` } });
      const limiterRows = await tx
        .select({
          id: smsVerificationCodes.id,
          elapsedSeconds: sql<number>`TIMESTAMPDIFF(SECOND, ${smsVerificationCodes.createdAt}, NOW())`,
        })
        .from(smsVerificationCodes)
        .where(and(eq(smsVerificationCodes.scene, scene), eq(smsVerificationCodes.phone, phone)))
        .limit(1)
        .for("update");
      const limiter = limiterRows[0];
      if (!limiter) throw new Error("短信验证码限流状态初始化失败");
      const limiterElapsedMs = Number(limiter.elapsedSeconds) * 1000;
      if (limiterElapsedMs >= 0 && limiterElapsedMs < RESEND_INTERVAL_MS) {
        throw new Error(
          `发送过于频繁，请 ${Math.ceil((RESEND_INTERVAL_MS - limiterElapsedMs) / 1000)} 秒后再试`,
        );
      }
      await tx
        .update(smsVerificationCodes)
        .set({ createdAt: sql`NOW()` as any })
        .where(eq(smsVerificationCodes.id, limiter.id));
      await tx.execute(sql`
        DELETE FROM sms_verification_codes
        WHERE phone = ${phone}
          AND scene LIKE 'ownerXfer:%'
          AND scene <> ${storageScene}
      `);
    }

    // 先确保 scene+phone 锁定到唯一一行。并发首次发送时，唯一索引会让第二个
    // upsert 等待第一个事务提交；随后它会看到刚更新的 createdAt 并触发限频。
    await tx
      .insert(smsVerificationCodes)
      .values({
        scene: storageScene,
        phone,
        codeHash: "pending",
        expiresAt: sql`NOW()` as any,
        createdAt: sql`DATE_SUB(NOW(), INTERVAL ${RESEND_INTERVAL_MS / 1000 + 1} SECOND)` as any,
      })
      .onDuplicateKeyUpdate({
        set: { id: sql`${smsVerificationCodes.id}` },
      });

    const rows = await tx
      .select({
        id: smsVerificationCodes.id,
        elapsedSeconds: sql<number>`TIMESTAMPDIFF(SECOND, ${smsVerificationCodes.createdAt}, NOW())`,
      })
      .from(smsVerificationCodes)
      .where(and(eq(smsVerificationCodes.scene, storageScene), eq(smsVerificationCodes.phone, phone)))
      .limit(1)
      .for("update");
    const record = rows[0];
    if (!record) throw new Error("短信验证码状态初始化失败");

    const elapsedMs = Number(record.elapsedSeconds) * 1000;
    if (elapsedMs >= 0 && elapsedMs < RESEND_INTERVAL_MS) {
      throw new Error(
        `发送过于频繁，请 ${Math.ceil((RESEND_INTERVAL_MS - elapsedMs) / 1000)} 秒后再试`,
      );
    }

    // 所有时间都由数据库 NOW() 计算，避免 JS 与 MySQL 会话时区不一致。
    await tx
      .update(smsVerificationCodes)
      .set({
        codeHash,
        expiresAt: sql`DATE_ADD(NOW(), INTERVAL ${CODE_TTL_MS / 1000} SECOND)` as any,
        usedAt: null,
        attempts: 0,
        createdAt: sql`NOW()` as any,
      })
      .where(eq(smsVerificationCodes.id, record.id));
  });

  if (isSmsDevMode()) {
    // 验证码和完整手机号均不得进入日志；开发环境仍通过受控返回值供测试使用。
    console.log(`[SMS][dev] verification code issued for scene=${scene}`);
    return { sent: false, devCode: code, expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  const result = await sendAliyunSms(phone, { code });
  if (!result.ok) {
    // 仅删除本次发送对应的哈希，避免误删极端情况下稍后生成的新验证码。
    await db
      .delete(smsVerificationCodes)
      .where(and(
        eq(smsVerificationCodes.scene, storageScene),
        eq(smsVerificationCodes.phone, phone),
        eq(smsVerificationCodes.codeHash, codeHash),
      ));
    if (options.contextKey) {
      await db
        .delete(smsVerificationCodes)
        .where(and(eq(smsVerificationCodes.scene, scene), eq(smsVerificationCodes.phone, phone)));
    }
    if (result.code === "isv.AMOUNT_NOT_ENOUGH") {
      throw new Error("短信服务暂时不可用，请稍后再试或联系客服");
    }
    if (result.code === "isv.BUSINESS_LIMIT_CONTROL") {
      throw new Error("发送过于频繁，已触发运营商限制，请稍后再试");
    }
    throw new Error("短信发送失败，请稍后再试");
  }
  return { sent: true, devCode: undefined, expiresInSeconds: CODE_TTL_MS / 1000 };
}

/** 校验验证码。通过事务行锁确保并发请求最多一个成功。 */
export async function verifyCode(
  scene: SmsScene,
  phone: string,
  code: string,
  options: VerificationCodeOptions = {},
): Promise<boolean> {
  const db = await getDbForSms();
  const { smsVerificationCodes } = await import("../../drizzle/schema");
  const codeTrimmed = code.trim();
  const storageScene = verificationStorageScene(scene, options);

  return db.transaction(async tx => {
    const rows = await tx
      .select({
        id: smsVerificationCodes.id,
        codeHash: smsVerificationCodes.codeHash,
        usedAt: smsVerificationCodes.usedAt,
        attempts: smsVerificationCodes.attempts,
        isExpired: sql<number>`(${smsVerificationCodes.expiresAt} < NOW())`,
      })
      .from(smsVerificationCodes)
      .where(and(eq(smsVerificationCodes.scene, storageScene), eq(smsVerificationCodes.phone, phone)))
      .limit(1)
      .for("update");
    const record = rows[0];
    if (!record || record.usedAt) {
      console.warn(`[SMS][verify] fail scene=${scene} reason=${record ? "used" : "no_record"}`);
      return false;
    }
    if (Number(record.isExpired)) {
      await tx.delete(smsVerificationCodes).where(eq(smsVerificationCodes.id, record.id));
      console.warn(`[SMS][verify] fail scene=${scene} reason=expired`);
      return false;
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      await tx.delete(smsVerificationCodes).where(eq(smsVerificationCodes.id, record.id));
      console.warn(`[SMS][verify] fail scene=${scene} reason=max_attempts`);
      return false;
    }
    if (record.codeHash !== hashCode(codeTrimmed)) {
      await tx
        .update(smsVerificationCodes)
        .set({ attempts: record.attempts + 1 })
        .where(eq(smsVerificationCodes.id, record.id));
      console.warn(
        `[SMS][verify] fail scene=${scene} reason=mismatch attempts=${record.attempts + 1}`,
      );
      return false;
    }
    await tx.delete(smsVerificationCodes).where(eq(smsVerificationCodes.id, record.id));
    return true;
  });
}

/** 仅测试用：清空验证码存储 */
export async function __clearCodeStoreForTest() {
  const db = await getDbForSms();
  const { smsVerificationCodes } = await import("../../drizzle/schema");
  // 全表清空（仅测试环境使用）
  await db.delete(smsVerificationCodes);
}
