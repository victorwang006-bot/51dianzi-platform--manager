import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { hashPassword, verifyPassword } from "../password";
import {
  getUserByUsername,
  getUserByOpenId,
  getUserByPhone,
  getUserById,
  createLocalUser,
  touchLastSignedIn,
  updateUserPhone,
  updateUserAvatar,
  AVATAR_DAILY_LIMIT,
  grantCrmAccess,
  changePrimaryUsername,
  isUsernameUnavailable,
} from "../db";
import { createAgreementSignature } from "../db";
import { COOKIE_NAME } from "../../../shared/const";
import { ONE_YEAR_MS } from "../../../shared/const";
import { clearLegacySessionCookies, getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import { isOssConfigured, ossPut, storageGetAccessUrl, storagePut, storagePutPrivate } from "../storage";
import {
  decodeAndValidateSignaturePng,
  MAX_SIGNATURE_BASE64_CHARS,
} from "../services/sensitiveDocument";
import {
  AGREEMENT_VERSION,
  AGREEMENT_NAME,
  AGREEMENT_HASH,
} from "../../../shared/agreementContent";
import {
  buildSecurityAuditContext,
  changeAuthenticatedPassword,
  findUserByAccount,
  getAccountSecurityStatus,
  getResetChannels,
  issueSecurityCode,
  requestPublicPasswordReset,
  requestContactRecoveryCode,
  verifyContactRecoveryCode,
  completeContactRecovery,
  sendResetCode,
  resetPasswordByCode,
  verifyCurrentEmail,
} from "../passwordReset";
import { sendVerificationCode, verifyCode } from "../services/smsService";
import { trustedClientIp } from "../trustedClientIp";
import { toPublicAuthUser } from "../publicAuthUser";
import { MINI_PROGRAM_HEADER, isMiniProgramClient } from "../../../shared/miniProgramClient";
import { isValidWechatContact, WECHAT_CONTACT_ERROR } from "../../../shared/wechatContact";
import { TRPCError } from "@trpc/server";
import {
  createPhoneChangeTicket,
  verifyPhoneChangeTicket,
  PHONE_CHANGE_TICKET_TTL_SECONDS,
} from "../services/phoneChangeTicket";
import {
  assertValidLoginUsername,
  normalizeLoginUsername,
} from "../services/usernamePolicy";
import {
  compensatePendingNewUserWelcome,
  ensureNewUserWelcome,
} from "../services/customerService";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordPolicyError,
} from "../../../shared/passwordPolicy";
import {
  getUserQqProfile,
  updateUserProfileWithQq,
  UserQqProfileError,
} from "../services/userQqProfile";
import {
  confirmEmailChange,
  getEmailChangeStatus,
  resendEmailChangeCode,
  sendEmailChangeIdentityCode,
  startEmailChange,
} from "../services/emailChange";

/** 登录范围：mall = 商城（买家）；crm = CRM 工作台（供应商） */
export type LoginScope = "mall" | "crm";

/**
 * 验证码发送的常见失败属于可预期的业务或外部服务状态，必须返回明确的
 * 4xx/429，而不是让前端看到无意义的500。未知异常仍保留为500，供运维排障。
 */
export function toSmsSendTrpcError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (
    message.includes("发送过于频繁")
    || message.includes("发送次数过多")
    || message.includes("今日验证码发送次数已达上限")
  ) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message });
  }
  if (
    message.includes("短信发送失败") ||
    message.includes("短信服务暂时不可用") ||
    message.includes("短信服务未配置") ||
    message.includes("邮件服务暂时不可用") ||
    message.includes("数据库不可用") ||
    message.includes("短信验证码状态初始化失败")
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "验证码服务暂时不可用，请稍后再试" });
  }
  throw error;
}

/** 邮箱换绑的身份、票据和目标验证码错误均是可恢复的 4xx 状态。 */
function toEmailChangeTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (isDuplicateEntryError(error)) {
    throw new TRPCError({ code: "CONFLICT", message: "该邮箱已绑定其他账号，请更换邮箱后重新验证" });
  }
  const message = error instanceof Error ? error.message : "邮箱换绑失败，请重新开始";
  if (message.includes("已绑定其他账号")) {
    throw new TRPCError({ code: "CONFLICT", message });
  }
  if (message.includes("发送过于频繁") || message.includes("发送次数过多") || message.includes("今日验证码")) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message });
  }
  if (
    message.includes("密码")
    || message.includes("验证码")
    || message.includes("邮箱换绑")
    || message.includes("身份验证")
    || message.includes("新邮箱")
    || message.includes("当前账号没有")
    || message.includes("账号已被暂停")
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
  return toSmsSendTrpcError(error);
}

/**
 * 签发会话。
 *
 * 返回值中的 sessionToken **仅当请求来自小程序时**才应回传给客户端。
 *
 * 缘由：会话 token 一直写入 httpOnly Cookie，
 * 而小程序没有浏览器 Cookie 机制，拿不到 httpOnly Cookie，
 * 登录后所有需鉴权接口会全部 401。
 * 鉴权层（sdk.authenticateRequest）本身已支持 Authorization: Bearer，
 * 因此只需把 token 交给小程序自行存储并带上即可。
 *
 * 为何不无条件返回：Web 端靠 httpOnly Cookie 就能工作，
 * httpOnly 的意义正在于 JS 读不到 token，从而降低 XSS 盗取会话的风险。
 * 若对所有客户端都把 token 写进响应体，等于为 Web 端白白新增一个泄露面。
 */
export async function issueSession(
  ctx: { req: any; res: any },
  openId: string,
  name: string,
  scopes: LoginScope[] = ["mall"]
) {
  const sessionUser = await getUserByOpenId(openId);
  if (sessionUser?.loginDisabled) {
    throw new TRPCError({ code: "FORBIDDEN", message: "账号已被暂停使用，请联系客服" });
  }
  // Use sdk.createSessionToken to produce a JWT that sdk.verifySession accepts
  // (payload must include openId, appId, name as non-empty strings)
  const sessionToken = await sdk.createSessionToken(openId, {
    name: name || "user",
    expiresInMs: ONE_YEAR_MS,
    sessionVersion: sessionUser?.sessionVersion ?? 0,
  });

  const cookieOptions = getSessionCookieOptions(ctx.req);
  clearLegacySessionCookies(ctx.req, ctx.res);
  ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
  // scope 存放在独立 cookie（非敏感，仅用于前端路由提示；后端鉴权仍以数据库 crmAccess 为准）
  ctx.res.cookie("login_scope", scopes.join(","), {
    ...cookieOptions,
    httpOnly: false,
    maxAge: ONE_YEAR_MS,
  });

  return { sessionToken };
}

/**
 * 微信小程序专用的会话签发。
 *
 * 与 `issueSession` 的区别：微信登录**只可能**来自小程序，
 * 因此 token 必需回传（小程序拿不到 httpOnly Cookie），
 * 无需再看请求头判定。单独封一层是为了避开一个陷阱：
 * 若微信登录路由错用 `sessionTokenPayload`，
 * 一旦小程序端漏带请求头，token 就会静默缺失，
 * 表现为「登录接口返回成功但后续全部 401」这类极难定位的问题。
 */
export async function issueMiniProgramSession(
  ctx: { req: any; res: any },
  openId: string,
  name: string,
) {
  return issueSession(ctx, openId, name, ["mall", "crm"]);
}

/**
 * 登录类接口的统一 token 回传字段。
 * 非小程序客户端返回空对象，字段直接不出现在响应体中。
 */
function sessionTokenPayload(
  ctx: { req: any },
  sessionToken: string,
): { sessionToken?: string } {
  if (!isMiniProgramClient(ctx.req?.headers?.[MINI_PROGRAM_HEADER])) return {};
  return { sessionToken };
}

async function verifyCredentials(username: string, password: string) {
  const user = await getUserByUsername(username);
  if (!user || !user.passwordHash) {
    throw new Error("用户名或密码错误");
  }
  if (!verifyPassword(password, user.passwordHash)) {
    throw new Error("用户名或密码错误");
  }
  return user;
}

function isDuplicateEntryError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const mysqlError = current as { errno?: number; code?: string; cause?: unknown };
    if (mysqlError.errno === 1062 || mysqlError.code === "ER_DUP_ENTRY") return true;
    current = mysqlError.cause;
  }
  return false;
}

function maskPhone(phone: string): string {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function loginUsernameOrBadRequest(value: string): string {
  try {
    return assertValidLoginUsername(value);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "用户名格式不正确",
    });
  }
}

function phoneChangeTicketOrBadRequest(
  ticket: string,
  stage: "current-verified" | "target-code-sent",
) {
  try {
    return verifyPhoneChangeTicket(ticket, stage);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "换号验证已失效，请重新开始",
    });
  }
}

async function requirePrimaryUserWithPhone(
  ctx: { user: { id: number } },
) {
  const current = await getUserById(ctx.user.id);
  const phone = String(current?.phone || "");
  if (!current || !/^1[3-9]\d{9}$/.test(phone)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "当前账号未绑定可验证手机号，请联系客服处理",
    });
  }
  return { current, phone };
}

export const localAuthRouter = router({
  /**
   * 统一登录：注册即开通 51电子网账号，一次登录即可使用全部功能。
   * CRM 使用权限不再靠登录入口区分，而是由数据库 users.crmAccess 决定：
   * 未开通时前端引导去 /crm-apply 提交企业信息自动开通。
   */
  login: publicProcedure
    .input(
      z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await verifyCredentials(normalizeLoginUsername(input.username), input.password);
      await touchLastSignedIn(user.id);
      await compensatePendingNewUserWelcome(user.id);
      const { sessionToken } = await issueSession(
        ctx,
        user.openId,
        user.name || input.username,
        ["mall", "crm"],
      );
      return {
        success: true,
        scopes: ["mall", "crm"] as LoginScope[],
        crmAccess: Boolean(user.crmAccess),
        user: toPublicAuthUser(user),
        ...sessionTokenPayload(ctx, sessionToken),
      };
    }),

  /** 已绑定手机号 + 短信验证码登录；不自动注册新账号。 */
  phoneLogin: publicProcedure
    .input(
      z.object({
        phone: z.string().regex(/^1[3-9]\d{9}$/),
        smsCode: z.string().length(6),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await getUserByPhone(input.phone);
      if (!user) {
        throw new Error("该手机号未绑定账号，请先注册或使用用户名登录");
      }
      if (!(await verifyCode("login", input.phone, input.smsCode))) {
        throw new Error("短信验证码错误或已失效，请重新获取");
      }
      await touchLastSignedIn(user.id);
      await compensatePendingNewUserWelcome(user.id);
      const { sessionToken } = await issueSession(
        ctx,
        user.openId,
        user.name || user.username || "user",
        ["mall", "crm"],
      );
      return {
        success: true,
        scopes: ["mall", "crm"] as LoginScope[],
        crmAccess: Boolean(user.crmAccess),
        user: toPublicAuthUser(user),
        ...sessionTokenPayload(ctx, sessionToken),
      };
    }),

  /**
   * @deprecated CRM 不再有独立登录入口，保留此 API 仅为兼容，行为同 login。
   */
  crmLogin: publicProcedure
    .input(
      z.object({
        username: z.string().min(1),
        password: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const user = await verifyCredentials(normalizeLoginUsername(input.username), input.password);
      await touchLastSignedIn(user.id);
      await compensatePendingNewUserWelcome(user.id);
      const { sessionToken } = await issueSession(
        ctx,
        user.openId,
        user.name || input.username,
        ["mall", "crm"],
      );
      return {
        success: true,
        scopes: ["mall", "crm"] as LoginScope[],
        crmAccess: Boolean(user.crmAccess),
        user: toPublicAuthUser(user),
        ...sessionTokenPayload(ctx, sessionToken),
      };
    }),

  /** 注册：用户名 + 密码 + 手机号 + 短信验证码 */
  register: publicProcedure
    .input(
      z.object({
        username: z.string().min(3).max(64),
        password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
        phone: z.string().regex(/^1[3-9]\d{9}$/),
        smsCode: z.string().length(6),
        name: z.string().optional(),
        /**
         * 协议签署信息（在线阅读 + 手写签名）。
         * 2026-07-25 调整：普通买家注册不再强制签署协议（可选传入）；
         * 供应商/商家入驻等需要存证的流程仍可传入本字段完成签署存证。
         */
        agreement: z
          .object({
            /** 手写签名图像 dataURL（image/png base64） */
            signatureDataUrl: z
              .string()
              .regex(/^data:image\/png;base64,/, "签名数据格式不正确")
              .max("data:image/png;base64,".length + MAX_SIGNATURE_BASE64_CHARS, "签名图像过大"),
            /** 签署人类型：self 本人 / agent 单位授权代理人 */
            signerType: z.enum(["self", "agent"]).default("self"),
            /** 签署人姓名（手写签名对应的姓名） */
            signerName: z.string().max(64).optional(),
            /** 开始阅读时间（毫秒时间戳） */
            readStartAt: z.number().optional(),
            /** 阅读完成时间（毫秒时间戳） */
            readEndAt: z.number().optional(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const username = loginUsernameOrBadRequest(input.username);
      const passwordError = passwordPolicyError(input.password);
      if (passwordError) throw new TRPCError({ code: "BAD_REQUEST", message: passwordError });
      // 先做可用性检查，最后才消耗验证码：
      // 验证码为一次性，若先验码再查重，用户名/手机号冲突会白白销毁验证码，
      // 用户修正后重试就会误报「短信验证码错误」（2026-07-25 真机复现修复）
      const existingByUsername = await isUsernameUnavailable(username);
      if (existingByUsername) {
        throw new Error("用户名已被注册");
      }

      // 检查手机号是否已存在
      const existingByPhone = await getUserByPhone(input.phone);
      if (existingByPhone) {
        throw new Error("该手机号已被注册");
      }

      if (!(await verifyCode("register", input.phone, input.smsCode))) {
        throw new Error("短信验证码错误或已失效，请重新获取");
      }

      // Validate a supplied signature before creating the account. Otherwise a malformed
      // data URL would silently leave a newly created user without the requested evidence.
      let validatedSignature: Buffer | null = null;
      if (input.agreement) {
        try {
          validatedSignature = await decodeAndValidateSignaturePng(input.agreement.signatureDataUrl);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error instanceof Error ? error.message : "签名图像无效",
            cause: error,
          });
        }
      }

      const openId = `local:${username}`;
      const passwordHash = hashPassword(input.password);

      let user;
      try {
        user = await createLocalUser({
          openId,
          username,
          passwordHash,
          phone: input.phone,
          name: input.name || null,
          loginMethod: "local",
          role: "user",
          lastSignedIn: new Date(),
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;

        // 注册前查重只负责友好提示；数据库唯一索引才是并发请求的最终仲裁。
        // 冲突后重新查询，避免向用户暴露 MySQL 错误或错误判断冲突字段。
        if (await getUserByPhone(input.phone)) {
          throw new Error("该手机号已被注册，请直接登录或找回用户名");
        }
        if (await isUsernameUnavailable(username)) {
          throw new Error("用户名已被注册");
        }
        throw new Error("注册信息已被占用，请重新提交");
      }

      if (!user) {
        throw new Error("注册失败，请重试");
      }

      // 协议签署存证（可选）：已在建号前严格验证，私有对象和签署记录只保存稳定 key。
      if (input.agreement && validatedSignature) {
        try {
        const stored = await storagePutPrivate(
          `agreement-signatures/user-${user.id}/${Date.now()}.png`,
          validatedSignature,
          "image/png",
        );
        const req = ctx.req as any;
        const ip = trustedClientIp(req);
        const userAgent =
          (req.headers?.["user-agent"] as string | undefined)?.slice(0, 512) ||
          null;
        await createAgreementSignature({
          userId: user.id,
          openId: user.openId,
          agreementName: AGREEMENT_NAME,
          agreementVersion: AGREEMENT_VERSION,
          agreementHash: AGREEMENT_HASH,
          signatureObjectKey: stored.key,
          signerType: input.agreement.signerType,
          signerName: input.agreement.signerName || input.name || username,
          readStartAt: input.agreement.readStartAt
            ? new Date(input.agreement.readStartAt)
            : null,
          readEndAt: input.agreement.readEndAt
            ? new Date(input.agreement.readEndAt)
            : null,
          signedAt: new Date(),
          ip,
          userAgent,
        });
        } catch (e) {
          // 存证失败不阻断注册（用户已创建），但记录错误供排查
          console.error("[Agreement] 签署存证失败:", e);
        }
      }
      try {
        await ensureNewUserWelcome(user.id);
      } catch (error) {
        // 欢迎消息属于注册后的附属动作；失败由后续登录幂等补偿，不能回滚建号。
        console.error("[Register] 51小电欢迎消息写入失败:", error);
      }
      const { sessionToken } = await issueSession(
        ctx,
        user.openId,
        user.name || username,
        ["mall", "crm"],
      );
      return {
        success: true,
        scopes: ["mall", "crm"] as LoginScope[],
        crmAccess: Boolean(user.crmAccess),
        user: toPublicAuthUser(user),
        ...sessionTokenPayload(ctx, sessionToken),
      };
    }),

  /**
   * 协议签名读取只在所有者或平台管理员授权后签发短时 URL。
   * 旧记录没有 key 时保留其历史 URL，以免一次性破坏既有存证阅读。
   */
  agreementSignatures: protectedProcedure
    .input(z.object({ userId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const userId = input?.userId ?? ctx.user.id;
      if (userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权查看该签署存证" });
      }
      const records = await import("../db").then(module => module.getAgreementSignaturesByUser(userId));
      return Promise.all(records.map(async ({ signatureObjectKey, signatureImageUrl, ...record }) => ({
        ...record,
        signatureAccessUrl: signatureObjectKey
          ? await storageGetAccessUrl(signatureObjectKey, 15 * 60)
          : signatureImageUrl,
      })));
    }),

  /** 当前已登录账号的 QQ 资料；不向 auth.me 扩展，避免旧客户端扩大投影。 */
  qqProfile: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getUserQqProfile(ctx.user.id);
    } catch (error) {
      if (error instanceof UserQqProfileError) {
        throw new TRPCError({ code: error.kind === "forbidden" ? "FORBIDDEN" : error.kind === "conflict" ? "CONFLICT" : "BAD_REQUEST", message: error.message });
      }
      throw error;
    }
  }),

  /** 更新个人资料 */
  updateProfile: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        email: z.union([z.string().trim().email().max(320), z.literal("")]).optional(),
        jobTitle: z.string().optional(),
        wechatId: z
          .string()
          .trim()
          .max(20)
          .refine(
            isValidWechatContact,
            WECHAT_CONTACT_ERROR,
          )
          .optional(),
        qqId: z
          .string()
          .trim()
          .max(20)
          .refine(
            value => !value || /^\d{5,20}$/.test(value),
            "QQ号需为5-20位数字",
          )
          .optional(),
        qqProfile: z.object({
          numbers: z.array(z.string()).max(3),
          defaultQq: z.string().nullable(),
          isPublic: z.boolean(),
          version: z.number().int().min(1),
          scope: z.string().regex(/^enterprise:[1-9]\d*:qq:[1-9]\d*$/).optional(),
        }).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const currentUser = await getUserById(ctx.user.id);
      if (!currentUser) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
      if (input.email !== undefined) {
        const requestedEmail = input.email.trim().toLowerCase() || null;
        const currentEmail = currentUser.email?.trim().toLowerCase() || null;
        if (requestedEmail !== currentEmail) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "为保护账号安全，设置或更换登录邮箱请联系客服核验身份",
          });
        }
      }
      try {
        await updateUserProfileWithQq(ctx.user.id, {
          name: input.name,
          ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
          ...(input.wechatId !== undefined ? { wechatId: input.wechatId.trim() || null } : {}),
          ...(input.qqId !== undefined ? { qqId: input.qqId.trim() || null } : {}),
          ...(input.qqProfile !== undefined ? { qqProfile: input.qqProfile } : {}),
        });
      } catch (error) {
        if (error instanceof UserQqProfileError) {
          throw new TRPCError({
            code: error.kind === "forbidden" ? "FORBIDDEN" : error.kind === "conflict" ? "CONFLICT" : "BAD_REQUEST",
            message: error.message,
          });
        }
        if (isDuplicateEntryError(error)) {
          throw new TRPCError({ code: "CONFLICT", message: "该邮箱已绑定其他账号" });
        }
        throw error;
      }
      return { success: true };
    }),

  /** 向当前绑定手机号发送用户名修改验证码。 */
  sendUsernameChangeCode: protectedProcedure.mutation(async ({ ctx }) => {
    const { phone } = await requirePrimaryUserWithPhone(ctx);
    try {
      const result = await sendVerificationCode("changeUsername", phone);
      return {
        success: true,
        maskedPhone: maskPhone(phone),
        expiresInSeconds: result.expiresInSeconds,
        devCode: result.devCode,
      } as const;
    } catch (error) {
      return toSmsSendTrpcError(error);
    }
  }),

  /** 校验当前手机号验证码并原子修改登录用户名。 */
  changeUsername: protectedProcedure
    .input(
      z.object({
        newUsername: z.string().min(3).max(64),
        smsCode: z.string().regex(/^\d{6}$/),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { current, phone } = await requirePrimaryUserWithPhone(ctx);
      const newUsername = loginUsernameOrBadRequest(input.newUsername);
      if ((current.username || "").toLowerCase() === newUsername.toLowerCase()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "新用户名不能与当前用户名相同" });
      }
      if (await isUsernameUnavailable(newUsername)) {
        throw new TRPCError({ code: "CONFLICT", message: "用户名已被使用或属于历史保留名称" });
      }
      if (!(await verifyCode("changeUsername", phone, input.smsCode))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "短信验证码错误或已失效，请重新获取",
        });
      }
      try {
        const result = await changePrimaryUsername(ctx.user.id, newUsername);
        const updated = await getUserById(ctx.user.id);
        return {
          success: true,
          oldUsername: result.oldUsername,
          newUsername: result.newUsername,
          changedAt: result.changedAt,
          user: updated ? toPublicAuthUser(updated) : null,
        } as const;
      } catch (error) {
        if (isDuplicateEntryError(error)) {
          throw new TRPCError({ code: "CONFLICT", message: "用户名已被使用或属于历史保留名称" });
        }
        const message = error instanceof Error ? error.message : "用户名修改失败";
        const code = message.includes("30 天") ? "TOO_MANY_REQUESTS" : "BAD_REQUEST";
        throw new TRPCError({ code, message });
      }
    }),

  /** 向当前绑定手机号发送换号身份验证码。 */
  sendCurrentPhoneChangeCode: protectedProcedure.mutation(async ({ ctx }) => {
    const { phone } = await requirePrimaryUserWithPhone(ctx);
    try {
      const result = await sendVerificationCode("changePhoneCurrent", phone);
      return {
        success: true,
        maskedPhone: maskPhone(phone),
        expiresInSeconds: result.expiresInSeconds,
        devCode: result.devCode,
      } as const;
    } catch (error) {
      return toSmsSendTrpcError(error);
    }
  }),

  /** 校验当前手机号验证码并签发 15 分钟换号凭证。 */
  verifyCurrentPhoneChangeCode: protectedProcedure
    .input(z.object({ smsCode: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ input, ctx }) => {
      const { phone } = await requirePrimaryUserWithPhone(ctx);
      if (!(await verifyCode("changePhoneCurrent", phone, input.smsCode))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前手机号验证码错误或已失效，请重新获取",
        });
      }
      return {
        success: true,
        currentTicket: createPhoneChangeTicket({
          stage: "current-verified",
          userId: ctx.user.id,
          currentPhone: phone,
        }),
        expiresInSeconds: PHONE_CHANGE_TICKET_TTL_SECONDS,
      } as const;
    }),

  /** 校验短时凭证后，向未占用的新手机号发送验证码。 */
  sendNewPhoneChangeCode: protectedProcedure
    .input(
      z.object({
        newPhone: z.string().regex(/^1[3-9]\d{9}$/),
        currentTicket: z.string().min(1).max(2048),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { phone } = await requirePrimaryUserWithPhone(ctx);
      const ticket = phoneChangeTicketOrBadRequest(
        input.currentTicket,
        "current-verified",
      );
      if (ticket.userId !== ctx.user.id || ticket.currentPhone !== phone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "换号验证已失效，请重新开始" });
      }
      if (input.newPhone === phone) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "新手机号不能与当前手机号相同" });
      }
      if (await getUserByPhone(input.newPhone)) {
        throw new TRPCError({ code: "CONFLICT", message: "该手机号已绑定其他账号" });
      }
      try {
        const result = await sendVerificationCode("changePhoneNew", input.newPhone);
        return {
          success: true,
          maskedPhone: maskPhone(input.newPhone),
          targetTicket: createPhoneChangeTicket({
            stage: "target-code-sent",
            userId: ctx.user.id,
            currentPhone: phone,
            newPhone: input.newPhone,
          }),
          expiresInSeconds: result.expiresInSeconds,
          devCode: result.devCode,
        } as const;
      } catch (error) {
        return toSmsSendTrpcError(error);
      }
    }),

  /** 校验新手机号验证码并完成原子换绑。 */
  confirmPhoneChange: protectedProcedure
    .input(
      z.object({
        newPhone: z.string().regex(/^1[3-9]\d{9}$/),
        smsCode: z.string().regex(/^\d{6}$/),
        targetTicket: z.string().min(1).max(2048),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { phone } = await requirePrimaryUserWithPhone(ctx);
      const ticket = phoneChangeTicketOrBadRequest(
        input.targetTicket,
        "target-code-sent",
      );
      if (
        ticket.userId !== ctx.user.id ||
        ticket.currentPhone !== phone ||
        ticket.stage !== "target-code-sent" ||
        ticket.newPhone !== input.newPhone
      ) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "换号验证已失效，请重新开始" });
      }
      if (await getUserByPhone(input.newPhone)) {
        throw new TRPCError({ code: "CONFLICT", message: "该手机号已绑定其他账号" });
      }
      if (!(await verifyCode("changePhoneNew", input.newPhone, input.smsCode))) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "新手机号验证码错误或已失效，请重新获取",
        });
      }
      try {
        await updateUserPhone(ctx.user.id, input.newPhone);
      } catch (error) {
        if (isDuplicateEntryError(error)) {
          throw new TRPCError({ code: "CONFLICT", message: "该手机号已绑定其他账号" });
        }
        throw error;
      }
      const updated = await getUserById(ctx.user.id);
      return {
        success: true,
        user: updated ? toPublicAuthUser(updated) : null,
      } as const;
    }),

  /** 当前账号的邮箱换绑身份路径；手机号仅在无密码且没有可信旧邮箱时出现。 */
  emailChangeStatus: protectedProcedure
    .input(z.object({ cacheScope: z.string().max(80) }).optional())
    .query(async ({ ctx }) => {
      try {
        // 输入仅隔离客户端缓存；账号权限始终来自已认证上下文。
        return { ...await getEmailChangeStatus(ctx.user.id), accountScope: String(ctx.user.id) };
      } catch (error) {
        return toEmailChangeTrpcError(error);
      }
    }),

  /** 服务端依状态选择可信旧邮箱，或严格的无密码手机号回退，签发独立身份验证码。 */
  sendEmailIdentityCode: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const result = await sendEmailChangeIdentityCode(
        ctx.user.id,
        buildSecurityAuditContext(ctx.req),
      );
      return { success: true as const, ...result };
    } catch (error) {
      return toEmailChangeTrpcError(error);
    }
  }),

  /** 身份核验后仅暂存目标邮箱并向其发送 verifyEmail 验证码。 */
  startEmailChange: protectedProcedure
    .input(z.object({
      email: z.string().trim().email().max(320),
      method: z.enum(["emailCode", "currentPassword", "phoneCode"]),
      code: z.string().regex(/^\d{6}$/).optional(),
      currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await startEmailChange({
          userId: ctx.user.id,
          email: input.email,
          method: input.method,
          code: input.code,
          currentPassword: input.currentPassword,
          audit: buildSecurityAuditContext(ctx.req),
        });
      } catch (error) {
        return toEmailChangeTrpcError(error);
      }
    }),

  /** 仅允许仍绑定同一账号状态和同一 pending 目标的票据重发目标邮箱验证码。 */
  resendEmailChangeCode: protectedProcedure
    .input(z.object({
      email: z.string().trim().email().max(320),
      emailChangeTicket: z.string().min(1).max(2048),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await resendEmailChangeCode({
          userId: ctx.user.id,
          email: input.email,
          emailChangeTicket: input.emailChangeTicket,
          audit: buildSecurityAuditContext(ctx.req),
        });
      } catch (error) {
        return toEmailChangeTrpcError(error);
      }
    }),

  /** 目标验证码、签名票据和锁内账号快照均匹配后，才原子提升可信邮箱。 */
  confirmEmailChange: protectedProcedure
    .input(z.object({
      email: z.string().trim().email().max(320),
      code: z.string().regex(/^\d{6}$/),
      emailChangeTicket: z.string().min(1).max(2048),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await confirmEmailChange({
          userId: ctx.user.id,
          email: input.email,
          code: input.code,
          emailChangeTicket: input.emailChangeTicket,
          audit: buildSecurityAuditContext(ctx.req),
        });
      } catch (error) {
        return toEmailChangeTrpcError(error);
      }
    }),

  /**
   * @deprecated 兼容旧客户端的“先短信后暂存”形状；为避免它绕过新规则，
   * 仅在没有当前密码和可信旧邮箱时走手机号回退，目标验证仍由新服务完成。
   */
  sendEmailChangeCode: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const status = await getEmailChangeStatus(ctx.user.id);
      if (status.identityChannel !== "phone") {
        throw new Error("请使用当前登录密码或已验证旧邮箱验证码完成身份验证");
      }
      const result = await sendEmailChangeIdentityCode(
        ctx.user.id,
        buildSecurityAuditContext(ctx.req),
      );
      return {
        success: true as const,
        maskedPhone: result.maskedTarget,
        expiresInSeconds: result.expiresInSeconds,
        devCode: result.devCode,
      } as const;
    } catch (error) {
      return toEmailChangeTrpcError(error);
    }
  }),

  /**
   * @deprecated 保留旧输入和 pendingEmail 响应；内部进入新流程，手机号不再能
   * 覆盖旧邮箱或当前密码这两个更强的身份凭证。
   */
  beginEmailChange: protectedProcedure
    .input(z.object({
      email: z.string().trim().email().max(320),
      smsCode: z.string().regex(/^\d{6}$/),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const started = await startEmailChange({
          userId: ctx.user.id,
          email: input.email,
          method: "phoneCode",
          code: input.smsCode,
          audit: buildSecurityAuditContext(ctx.req),
        });
        return { ...started, pendingEmail: input.email.trim().toLowerCase() };
      } catch (error) {
        return toEmailChangeTrpcError(error);
      }
    }),

  /**
   * 上传头像。
   *
   * 头像会展示给聊天对手，因此：
   * - 只收图片，拒绝 PDF 等非图片格式
   * - 限制 5MB，前端已压缩至 512px，正常不会触发
   * - 每日限额，避免频繁更换干扰交易对手识别
   */
  uploadAvatar: protectedProcedure
    .input(
      z.object({
        fileName: z.string().min(1).max(255),
        /** base64 编码的图片内容（不含 data: 前缀） */
        base64: z.string().min(1),
        mimeType: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!input.mimeType.startsWith("image/")) {
        throw new Error("头像只支持图片格式，请上传 JPG 或 PNG");
      }
      const buffer = Buffer.from(input.base64, "base64");
      if (buffer.length > 5 * 1024 * 1024) {
        throw new Error("头像图片不能超过 5MB，请换一张小一点的图片");
      }
      const ext = input.fileName.includes(".")
        ? input.fileName.slice(input.fileName.lastIndexOf("."))
        : ".jpg";
      /*
       * 文件名带时间戳：头像会被浏览器与 CDN 缓存，
       * 若沿用同名覆盖，用户换了头像但看到的还是旧图。
       */
      const key = `avatars/user-${ctx.user.id}-${Date.now()}${ext}`;
      const { url } = isOssConfigured()
        ? await ossPut(key, buffer, input.mimeType)
        : await storagePut(key, buffer, input.mimeType);
      const { remaining } = await updateUserAvatar(ctx.user.id, url);
      return { success: true, url, remaining, dailyLimit: AVATAR_DAILY_LIMIT } as const;
    }),

  /** 当前账号的密码和可信验证渠道状态。 */
  securityStatus: protectedProcedure.query(async ({ ctx }) => {
    return getAccountSecurityStatus(ctx.user.id);
  }),

  /** 已登录用户发送改密或邮箱验证验证码。 */
  sendAccountSecurityCode: protectedProcedure
    .input(z.object({
      purpose: z.enum(["changePassword", "verifyEmail"]),
      channel: z.enum(["email", "phone"]),
    }))
    .mutation(async ({ input, ctx }) => {
      if (input.purpose === "verifyEmail" && input.channel !== "email") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "邮箱验证必须使用邮箱验证码" });
      }
      if (input.purpose === "verifyEmail") {
        const current = await getUserById(ctx.user.id);
        if (current?.pendingEmail) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "待验证新邮箱请重新进入更换邮箱流程完成本人验证" });
        }
      }
      try {
        const result = await issueSecurityCode(
          ctx.user.id,
          input.purpose,
          input.channel,
          buildSecurityAuditContext(ctx.req),
        );
        return {
          success: true,
          ...result,
          message: result.devCode
            ? `验证码已生成（演示模式）：${result.devCode}`
            : `验证码已发送至 ${result.maskedTarget}`,
        } as const;
      } catch (error) {
        return toSmsSendTrpcError(error);
      }
    }),

  /** 已登录用户修改或首次设置密码；成功后仅重签当前设备，其余旧会话失效。 */
  changePassword: protectedProcedure
    .input(z.discriminatedUnion("method", [
      z.object({
        method: z.literal("currentPassword"),
        currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
        newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
      }),
      z.object({
        method: z.literal("code"),
        channel: z.enum(["email", "phone"]),
        code: z.string().regex(/^\d{6}$/),
        newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
      }),
    ]))
    .mutation(async ({ input, ctx }) => {
      const passwordError = passwordPolicyError(input.newPassword);
      if (passwordError) throw new TRPCError({ code: "BAD_REQUEST", message: passwordError });
      const updated = await changeAuthenticatedPassword(
        ctx.user.id,
        input,
        buildSecurityAuditContext(ctx.req),
      );
      const { sessionToken } = await issueSession(
        ctx,
        updated.openId,
        updated.name || updated.username || "user",
        ["mall", "crm"],
      );
      return {
        success: true,
        user: toPublicAuthUser(updated),
        ...sessionTokenPayload(ctx, sessionToken),
      } as const;
    }),

  /** 验证当前资料中的邮箱；邮箱变更后必须重新验证。 */
  verifyEmail: protectedProcedure
    .input(z.object({ code: z.string().regex(/^\d{6}$/) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await verifyCurrentEmail(
          ctx.user.id,
          input.code,
          buildSecurityAuditContext(ctx.req),
        );
        return { success: true, ...result } as const;
      } catch (error) {
        // 多个账号可暂存同一地址，最终提升时由 users.email 的唯一键仲裁。
        // 将该预期竞争映射为可恢复的业务冲突，而不是返回 500。
        const message = error instanceof Error ? error.message : "";
        if (message.includes("待验证新邮箱")) {
          throw new TRPCError({ code: "BAD_REQUEST", message });
        }
        if (isDuplicateEntryError(error) || message.includes("该邮箱已绑定")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "该邮箱已绑定其他账号，请更换邮箱后重新验证",
          });
        }
        throw error;
      }
    }),

  /** 登录前找回密码：账号不存在、渠道不可用和限频均返回一致文案。 */
  requestPasswordReset: publicProcedure
    .input(z.object({
      account: z.string().trim().min(1).max(320),
      channel: z.enum(["email", "phone"]),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await requestPublicPasswordReset(
        input.account,
        input.channel,
        buildSecurityAuditContext(ctx.req),
      );
      return {
        success: true,
        expiresInSeconds: result.expiresInSeconds,
        devCode: result.devCode,
        message: "若账号及所选验证方式有效，验证码将发送至已绑定联系方式",
      } as const;
    }),

  /** 匿名找回账号或密码：输入本人掌握的绑定联系方式，响应不表示账号存在或送达成功。 */
  requestContactRecoveryCode: publicProcedure
    .input(z.object({
      contact: z.string().trim().min(1).max(320),
      channel: z.enum(["email", "phone"]),
    }).refine(value => value.channel === "phone"
      ? /^1[3-9]\d{9}$/.test(value.contact)
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.contact), {
      message: "请输入有效的手机号或邮箱",
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await requestContactRecoveryCode(
        input.contact, input.channel, buildSecurityAuditContext(ctx.req),
      );
      return {
        success: true,
        expiresInSeconds: result.expiresInSeconds,
        devCode: result.devCode,
        message: "若该联系方式绑定了账号，验证码将发送至你填写的联系方式",
      } as const;
    }),

  /** 仅验证码真实通过后返回当前登录名；一次性改密凭证不写入浏览器持久存储。 */
  verifyContactRecoveryCode: publicProcedure
    .input(z.object({
      contact: z.string().trim().min(1).max(320),
      channel: z.enum(["email", "phone"]),
      code: z.string().regex(/^\d{6}$/),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await verifyContactRecoveryCode(
        input.contact, input.channel, input.code, buildSecurityAuditContext(ctx.req),
      );
      return { success: true, ...result } as const;
    }),

  /** 凭验码后五分钟有效且只能使用一次的凭证重置，成功撤销旧会话。 */
  completeContactRecovery: publicProcedure
    .input(z.object({
      contact: z.string().trim().min(1).max(320),
      channel: z.enum(["email", "phone"]),
      recoveryTicket: z.string().regex(/^[0-9a-f]{64}$/),
      newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
    }))
    .mutation(async ({ input, ctx }) => {
      const passwordError = passwordPolicyError(input.newPassword);
      if (passwordError) throw new TRPCError({ code: "BAD_REQUEST", message: passwordError });
      const result = await completeContactRecovery(
        input.contact, input.channel, input.recoveryTicket, input.newPassword,
        buildSecurityAuditContext(ctx.req),
      );
      return { success: true, username: result.username } as const;
    }),

  /** 登录前完成密码找回；失败统一返回，不泄露账号或绑定状态。 */
  completePasswordReset: publicProcedure
    .input(z.object({
      account: z.string().trim().min(1).max(320),
      channel: z.enum(["email", "phone"]),
      code: z.string().regex(/^\d{6}$/),
      newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
    }))
    .mutation(async ({ input, ctx }) => {
      const passwordError = passwordPolicyError(input.newPassword);
      if (passwordError) throw new TRPCError({ code: "BAD_REQUEST", message: passwordError });
      const result = await resetPasswordByCode(
        input.account,
        input.channel,
        input.code,
        input.newPassword,
        buildSecurityAuditContext(ctx.req),
      );
      return { success: true, username: result.username } as const;
    }),

  /** @deprecated 旧版手机号找回入口；保留兼容并纳入统一会话撤销。 */
  resetPassword: publicProcedure
    .input(
      z.object({
        phone: z.string().regex(/^1[3-9]\d{9}$/),
        smsCode: z.string().length(6),
        newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const passwordError = passwordPolicyError(input.newPassword);
      if (passwordError) throw new TRPCError({ code: "BAD_REQUEST", message: passwordError });
      const result = await resetPasswordByCode(
        input.phone,
        "phone",
        input.smsCode,
        input.newPassword,
        buildSecurityAuditContext(ctx.req),
      );
      const user = ctx.user ? await getUserByPhone(input.phone) : null;
      if (!user || user.id !== ctx.user?.id) {
        return { success: true, username: result.username };
      }
      const updated = await getUserById(ctx.user.id);
      if (!updated) throw new Error("用户不存在");
      const { sessionToken } = await issueSession(
        ctx,
        updated.openId,
        updated.name || updated.username || "user",
        ["mall", "crm"],
      );
      return {
        success: true,
        username: result.username,
        user: toPublicAuthUser(updated),
        ...sessionTokenPayload(ctx, sessionToken),
      };
    }),

  /** @deprecated 兼容已缓存网站和旧版小程序；匿名调用只返回不含账号状态的通用选项。 */
  getResetChannels: publicProcedure
    .input(z.object({ account: z.string().min(1).max(320) }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        return {
          channels: [
            { channel: "phone" as const, maskedTarget: "已绑定手机（如适用）" },
            { channel: "email" as const, maskedTarget: "已验证邮箱（如适用）" },
          ],
        };
      }
      const result = await getResetChannels(input.account.trim());
      if (!result || result.userId !== ctx.user.id) throw new Error("只能查询当前账号的验证方式");
      if (result.channels.length === 0) {
        throw new Error("该账号未绑定手机号或邮箱，无法自助找回，请联系客服");
      }
      return { channels: result.channels };
    }),

  /** @deprecated 兼容旧客户端；匿名调用复用统一防枚举发送。 */
  sendResetCode: publicProcedure
    .input(
      z.object({
        account: z.string().min(1).max(320),
        channel: z.enum(["email", "phone"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const audit = buildSecurityAuditContext(ctx.req);
      const current = ctx.user ? await findUserByAccount(input.account.trim()) : null;
      const result = current && current.id === ctx.user?.id
        ? await sendResetCode(input.account.trim(), input.channel, audit)
        : await requestPublicPasswordReset(input.account.trim(), input.channel, audit);
      return {
        success: true,
        maskedTarget: "已绑定联系方式（如适用）",
        expiresInSeconds: result.expiresInSeconds,
        // 开发/演示模式下返回验证码；接入真实短信/邮件服务后为 undefined
        devCode: result.devCode,
        message: result.devCode
          ? `验证码已生成（演示模式）：${result.devCode}`
          : "若账号及所选验证方式有效，验证码将发送至已绑定联系方式",
      };
    }),

  /** @deprecated 兼容旧客户端；匿名可找回，已登录旧客户端成功后重签当前设备。 */
  resetPasswordByCode: publicProcedure
    .input(
      z.object({
        account: z.string().min(1).max(320),
        channel: z.enum(["email", "phone"]),
        code: z.string().length(6),
        newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const passwordError = passwordPolicyError(input.newPassword);
      if (passwordError) throw new TRPCError({ code: "BAD_REQUEST", message: passwordError });
      const result = await resetPasswordByCode(
        input.account.trim(),
        input.channel,
        input.code,
        input.newPassword,
        buildSecurityAuditContext(ctx.req),
      );
      const user = ctx.user ? await findUserByAccount(input.account.trim()) : null;
      if (!user || user.id !== ctx.user?.id) {
        return { success: true, username: result.username };
      }
      const updated = await getUserById(ctx.user.id);
      if (!updated) throw new Error("用户不存在");
      const { sessionToken } = await issueSession(
        ctx,
        updated.openId,
        updated.name || updated.username || "user",
        ["mall", "crm"],
      );
      return {
        success: true,
        username: result.username,
        user: toPublicAuthUser(updated),
        ...sessionTokenPayload(ctx, sessionToken),
      };
    }),

  /** 通过手机号找回用户名 */
  recoverUsername: publicProcedure
    .input(
      z.object({
        phone: z.string().regex(/^1[3-9]\d{9}$/),
        smsCode: z.string().length(6),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // 兼容旧客户端响应形状，但复用新版的用户级限额与原子消费，
      // 不允许继续通过旧短信场景绕过每小时/每天验证码配额。
      const verified = await verifyContactRecoveryCode(
        input.phone, "phone", input.smsCode, buildSecurityAuditContext(ctx.req),
      );
      // 返回部分脱敏的用户名
      const username = verified.username || "";
      let masked = username;
      if (username.length > 2) {
        masked = username[0] + "*".repeat(username.length - 2) + username[username.length - 1];
      }
      return { success: true, username, maskedUsername: masked };
    }),


  /** 发送短信验证码（阿里云短信；未配置凭证时为开发模式，返回 devCode） */
  sendSmsCode: publicProcedure
    .input(
      z.object({
        phone: z.string().regex(/^1[3-9]\d{9}$/),
        scene: z.enum(["login", "register", "recoverUsername", "resetPassword"]).default("register"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.scene === "resetPassword") {
        const result = await requestPublicPasswordReset(
          input.phone,
          "phone",
          buildSecurityAuditContext(ctx.req),
        );
        return {
          message: "若手机号已绑定账号，验证码将发送至该号码",
          devCode: result.devCode,
          expiresInSeconds: result.expiresInSeconds,
        };
      }
      if (input.scene === "login") {
        const user = await getUserByPhone(input.phone);
        if (!user) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "该手机号未绑定账号，请先注册或使用用户名登录",
          });
        }
      }
      if (input.scene === "recoverUsername") {
        const result = await requestContactRecoveryCode(
          input.phone, "phone", buildSecurityAuditContext(ctx.req),
        );
        return {
          message: "若手机号已绑定账号，验证码将发送至你填写的号码",
          devCode: result.devCode,
          expiresInSeconds: result.expiresInSeconds,
        };
      }
      try {
        const result = await sendVerificationCode(input.scene, input.phone);
        const masked = input.phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
        return {
          message: result.devCode
            ? `验证码已生成（演示模式）：${result.devCode}`
            : `验证码已发送至 ${masked}`,
          devCode: result.devCode,
          expiresInSeconds: result.expiresInSeconds,
        };
      } catch (error) {
        return toSmsSendTrpcError(error);
      }
    }),
});
