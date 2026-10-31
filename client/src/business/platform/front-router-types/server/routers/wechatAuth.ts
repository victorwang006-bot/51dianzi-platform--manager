/**
 * 微信小程序登录与账号绑定。
 *
 * ## 账号打通的核心设计：以手机号为唯一锚点
 *
 * 「同一个人从网站和小程序分别登录，如何认定是同一账号」是本模块的实质问题。
 * 处理不当的后果很严重：同一用户变成两个互不相干的账号，
 * 订单、库存、聊天记录、ERP 权限全部割裂，且这类数据产生后极难合并。
 *
 * **不能用 openid 直接建账号**：网站端用户没有 openid，两端从一开始就对不上。
 *
 * 选手机号的依据（2026-08-19 实测生产库）：
 * 58 个用户中 56 个已绑手机号（96.6%），且 `users.phone` 已有唯一约束。
 * 余下 2 个无手机号的历史账号走用户名密码登录后补绑，数量极少可人工处理。
 *
 * ## 两步式登录
 *
 * 第一步 `login`：code → openid，已绑定则直接签发会话；
 * 未绑定则返回 `needBind`，**不创建任何账号**。
 * 第二步 `bindPhone`：手机号 + 短信验证码，已存在则关联既有账号，
 * 不存在则建号，随后签发会话。
 *
 * 为何不在第一步就自动建号：没有手机号就无法与网站账号关联，
 * 自动建号会制造出永久孤立的账号，正是要避免的割裂。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  createLocalUser,
  createWechatBinding,
  fillWechatBindingUnionId,
  getUserByPhone,
  getUserById,
  getWechatBindingByOpenid,
  getWechatBindingByUserId,
  isUsernameUnavailable,
  touchLastSignedIn,
  touchWechatBindingLogin,
} from "../db";
import { toPublicAuthUser } from "../publicAuthUser";
import {
  exchangeWechatCode,
  isWechatMiniProgramLoginConfigured,
} from "../services/wechatMiniProgramAuth";
import { verifyCode } from "../services/smsService";
import {
  issueMiniProgramSession,
  toSmsSendTrpcError,
  type LoginScope,
} from "./localAuth";
import {
  compensatePendingNewUserWelcome,
  ensureNewUserWelcome,
} from "../services/customerService";
import {
  buildSecurityAuditContext,
  issueSecurityCode,
} from "../passwordReset";
import {
  createWechatRebindTicket,
  verifyWechatRebindTicket,
  WECHAT_REBIND_TICKET_TTL_SECONDS,
} from "../services/wechatRebindTicket";
import { confirmWechatAccountRebind } from "../services/wechatAccountRebind";

/** 微信 openid 长度上限，与数据库列宽一致，避免超长值触发落库错误 */
const OPENID_MAX = 64;

/**
 * 判断是否为数据库重复键错误。
 *
 * 与 localAuth 中同名逻辑一致：并发场景下应用层查重会双双通过，
 * 唯一约束才是最终仲裁，落败方需改走关联路径而非把 MySQL 错误抛给用户。
 */
function isDuplicateEntryError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const e = current as { errno?: number; code?: string; cause?: unknown };
    if (e.errno === 1062 || e.code === "ER_DUP_ENTRY") return true;
    current = e.cause;
  }
  return false;
}

function bindingConflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

function badBindingRequest(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function toWechatCodeTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  const message = error instanceof Error ? error.message : "微信登录失败，请稍后再试";
  if (message.includes("登录过于频繁")) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message });
  }
  if (message.includes("凭证已失效")) {
    badBindingRequest(message);
  }
  if (message.includes("暂未开通")) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message });
  }
  throw error;
}

async function exchangeWechatCodeForClient(code: string) {
  try {
    return await exchangeWechatCode(code);
  } catch (error) {
    return toWechatCodeTrpcError(error);
  }
}

/** 为微信登录生成平台账号用户名，并避开主账号、子账号及历史保留名。 */
async function buildWechatUsername(openid: string): Promise<string> {
  const stem = `wx_${openid.slice(0, 12).replace(/[^a-zA-Z0-9_]/g, "")}`;
  if (!(await isUsernameUnavailable(stem))) return stem;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 8);
    const candidate = `${stem.slice(0, 25)}_${suffix}`;
    if (!(await isUsernameUnavailable(candidate))) return candidate;
  }
  throw new Error("微信账号用户名生成失败，请重新提交");
}

export const wechatAuthRouter = router({
  /** 小程序端先查询微信登录是否可用，避免把「未配置」呈现为「登录失败」 */
  availability: publicProcedure.query(() => ({
    enabled: isWechatMiniProgramLoginConfigured(),
  })),

  /**
   * 当前账号是否已绑定微信。
   *
   * 结算页需要提前知道这个：小程序内微信支付（JSAPI）必须有 openid，
   * 而 openid 只能从绑定关系取得。不提前探明的后果是：
   * 用户选完地址、选完支付方式、点了提交，才在最后一步被服务端驳回。
   *
   * **只返回布尔值，绝不返回 openid**：
   * openid 是可用于追踪用户的敏感标识，客户端拿到它没有任何正当用途
   * （下单时服务端会自行反查），且一旦泄露无法收回。
   *
   * 用 publicProcedure 而非 protectedProcedure：未登录时返回
   * `{bound:false}` 而不报错，避免前端为了一个探测请求而被迫跳登录。
   */
  bindingStatus: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return { bound: false, loggedIn: false };
    const binding = await getWechatBindingByUserId(ctx.user.id);
    return { bound: Boolean(binding?.openid), loggedIn: true };
  }),

  /**
   * 已通过手机号或账号密码登录的小程序用户，将当前微信安全关联到当前账号。
   *
   * 这是订阅消息与小程序微信支付的共同前置条件。接口必须同时证明：
   * 1. 请求携带有效的51电子网登录会话；
   * 2. `code` 可以换取当前微信的openid。
   *
   * 当前账号已绑定其他微信时只返回“需要换绑”，不会直接覆盖；真正换绑必须
   * 再经过当前手机号验证码。当前微信已属于其他账号时仍明确拒绝。
   */
  bindCurrentAccount: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(256) }))
    .mutation(async ({ input, ctx }) => {
      if (!isWechatMiniProgramLoginConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "微信绑定暂不可用，请稍后再试" });
      }
      const session = await exchangeWechatCodeForClient(input.code);
      const openid = session.openid.slice(0, OPENID_MAX);
      const userId = ctx.user.id;
      const [openidBinding, userBinding] = await Promise.all([
        getWechatBindingByOpenid(openid),
        getWechatBindingByUserId(userId),
      ]);

      if (userBinding) {
        if (userBinding.openid !== openid) {
          return {
            bound: false as const,
            alreadyBound: false as const,
            rebindRequired: true as const,
            message: "该账号已绑定其他微信，是否更换为当前微信？",
          };
        }
        if (session.unionId && !userBinding.unionId) {
          await fillWechatBindingUnionId(openid, session.unionId);
        }
        await touchWechatBindingLogin(openid);
        return { bound: true as const, alreadyBound: true as const, rebindRequired: false as const };
      }

      if (openidBinding && openidBinding.userId !== userId) {
        bindingConflict("当前微信已绑定其他51电子网账号");
      }

      const user = await getUserById(userId);
      if (!user) throw new Error("账号状态异常，请重新登录");
      try {
        await createWechatBinding({
          userId,
          openid,
          unionId: session.unionId || null,
          boundPhone: user.phone || null,
          lastLoginAt: new Date(),
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        const [settledOpenid, settledUser] = await Promise.all([
          getWechatBindingByOpenid(openid),
          getWechatBindingByUserId(userId),
        ]);
        if (!settledOpenid || !settledUser || settledOpenid.userId !== userId || settledUser.openid !== openid) {
          bindingConflict("微信绑定冲突，请重新登录后再试");
        }
      }
      return { bound: true as const, alreadyBound: false as const, rebindRequired: false as const };
    }),

  /**
   * 换绑第一步：重新证明当前微信身份，并向当前账号手机号发送验证码。
   * 仅签发加密短时票据，不修改任何绑定关系。
   */
  startRebind: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(256) }))
    .mutation(async ({ input, ctx }) => {
      const user = await getUserById(ctx.user.id);
      if (!user || !user.phone || !/^1[3-9]\d{9}$/.test(user.phone)) {
        badBindingRequest("该账号未绑定可验证手机号，请联系客服");
      }
      const session = await exchangeWechatCodeForClient(input.code);
      const newOpenid = session.openid.slice(0, OPENID_MAX);
      const [currentBinding, targetBinding] = await Promise.all([
        getWechatBindingByUserId(user.id),
        getWechatBindingByOpenid(newOpenid),
      ]);
      if (!currentBinding) {
        badBindingRequest("该账号尚未绑定微信，请重新登录");
      }
      if (currentBinding.openid === newOpenid) {
        await touchWechatBindingLogin(newOpenid);
        return {
          alreadyBound: true as const,
          message: "当前微信已绑定",
        };
      }
      if (targetBinding && targetBinding.userId !== user.id) {
        bindingConflict("当前微信已绑定其他51电子网账号");
      }

      let verification;
      try {
        verification = await issueSecurityCode(
          user.id,
          "rebindWechat",
          "phone",
          buildSecurityAuditContext(ctx.req),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("次数过多") || message.includes("今日验证码")) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message });
        }
        return toSmsSendTrpcError(error);
      }

      return {
        alreadyBound: false as const,
        rebindTicket: createWechatRebindTicket({
          userId: user.id,
          oldOpenid: currentBinding.openid,
          newOpenid,
          newUnionId: session.unionId || null,
        }),
        maskedPhone: verification.maskedTarget,
        expiresInSeconds: Math.min(
          verification.expiresInSeconds,
          WECHAT_REBIND_TICKET_TTL_SECONDS,
        ),
        devCode: verification.devCode,
      };
    }),

  /** 换绑第二步：验证码通过后原子替换绑定，并使全部旧会话失效。 */
  confirmRebind: protectedProcedure
    .input(z.object({
      rebindTicket: z.string().min(1).max(4096),
      smsCode: z.string().regex(/^\d{6}$/),
    }))
    .mutation(async ({ input, ctx }) => {
      let ticket;
      try {
        ticket = verifyWechatRebindTicket(input.rebindTicket);
      } catch {
        badBindingRequest("换绑验证已失效，请重新开始");
      }
      if (ticket.userId !== ctx.user.id) {
        badBindingRequest("换绑验证已失效，请重新开始");
      }

      let user;
      try {
        user = await confirmWechatAccountRebind(
          {
            userId: ticket.userId,
            oldOpenid: ticket.oldOpenid,
            newOpenid: ticket.newOpenid,
            newUnionId: ticket.newUnionId,
            smsCode: input.smsCode,
          },
          buildSecurityAuditContext(ctx.req),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "换绑失败，请稍后再试";
        if (message.includes("已绑定其他51电子网账号") || message.includes("绑定状态已变化")) {
          bindingConflict(message);
        }
        if (message.includes("验证码") || message.includes("未绑定可验证手机号")) {
          badBindingRequest(message);
        }
        throw error;
      }

      const { sessionToken } = await issueMiniProgramSession(
        ctx,
        user.openId,
        user.name || user.username || "user",
      );
      return {
        success: true as const,
        message: "微信已更换，原微信已退出登录。",
        scopes: ["mall", "crm"] as LoginScope[],
        crmAccess: Boolean(user.crmAccess),
        user: toPublicAuthUser(user),
        sessionToken,
      };
    }),

  /**
   * 第一步：用 wx.login 的 code 换 openid。
   *
   * 已绑定 → 直接登录成功并返回 token；
   * 未绑定 → 返回 needBind + bindTicket，由前端引导绑定手机号。
   */
  login: publicProcedure
    .input(z.object({ code: z.string().min(1).max(256) }))
    .mutation(async ({ input, ctx }) => {
      const session = await exchangeWechatCodeForClient(input.code);
      const openid = session.openid.slice(0, OPENID_MAX);

      const binding = await getWechatBindingByOpenid(openid);
      if (!binding) {
        /*
         * 不在此处建号：没有手机号就无法与网站既有账号关联，
         * 自动建号会制造永久孤立的账号。
         *
         * openid 回传给前端作为下一步的凭据。这样做是安全的：
         * openid 本身不是登录凭证，bindPhone 仍要求短信验证码，
         * 拿到别人的 openid 也无法在没有其手机验证码的情况下绑定。
         */
        return {
          success: false as const,
          needBind: true as const,
          bindTicket: openid,
        };
      }

      const user = await getUserById(binding.userId);
      if (!user) {
        /*
         * 绑定关系存在但账号已不存在（历史数据清理等原因）。
         * 此时不能静默放行，否则会签发一个指向空账号的会话，
         * 后续每个接口都报错且无从解释。
         */
        console.error("[WechatLogin] 绑定关系指向的账号不存在", {
          userId: binding.userId,
        });
        throw new Error("账号状态异常，请联系客服处理");
      }

      // unionId 补录：首次绑定时微信可能未返回，后续拿到即补
      if (session.unionId && !binding.unionId) {
        await fillWechatBindingUnionId(openid, session.unionId);
      }
      await touchWechatBindingLogin(openid);
      await touchLastSignedIn(user.id);
      await compensatePendingNewUserWelcome(user.id);

      const { sessionToken } = await issueMiniProgramSession(
        ctx,
        user.openId,
        user.name || user.username || "user",
      );
      return {
        success: true as const,
        needBind: false as const,
        scopes: ["mall", "crm"] as LoginScope[],
        crmAccess: Boolean(user.crmAccess),
        user: toPublicAuthUser(user),
        sessionToken,
      };
    }),

  /**
   * 第二步：绑定手机号并完成登录。
   *
   * 手机号已存在 → 关联到既有账号（这正是「网站与小程序打通」的实现点）；
   * 不存在 → 新建账号。
   */
  bindPhone: publicProcedure
    .input(
      z.object({
        bindTicket: z.string().min(1).max(OPENID_MAX),
        phone: z.string().regex(/^1[3-9]\d{9}$/),
        smsCode: z.string().length(6),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const openid = input.bindTicket;

      /*
       * 幂等处理：用户可能重复提交，或在网络重试中二次到达。
       * 若该 openid 已绑定，直接按已绑定账号登录，而不是报「已绑定」错误——
       * 后者会让用户卡在绑定页无法进入。
       */
      const existing = await getWechatBindingByOpenid(openid);
      if (existing) {
        const boundUser = await getUserById(existing.userId);
        if (!boundUser) throw new Error("账号状态异常，请联系客服处理");
        await compensatePendingNewUserWelcome(boundUser.id);
        const { sessionToken } = await issueMiniProgramSession(
          ctx,
          boundUser.openId,
          boundUser.name || boundUser.username || "user",
        );
        return {
          success: true as const,
          linked: true as const,
          scopes: ["mall", "crm"] as LoginScope[],
          crmAccess: Boolean(boundUser.crmAccess),
          user: toPublicAuthUser(boundUser),
          sessionToken,
        };
      }

      /*
       * 先查账号可用性，最后才消耗验证码。
       *
       * 沿用 register 的既有经验（代码注释记录了 2026-07-25 真机复现）：
       * 验证码是一次性的，若先验码再查重，冲突时会白白销毁验证码，
       * 用户修正后重试就会误报「短信验证码错误」。
       */
      let user = await getUserByPhone(input.phone);

      // 该手机号对应的账号若已绑过别的微信，必须拦下并说明原因
      if (user) {
        const bindingOfUser = await getWechatBindingByUserId(user.id);
        if (bindingOfUser) {
          bindingConflict("该账号已绑定其他微信，请先用手机号登录后更换");
        }
      }

      /*
       * 场景必须是 `register` 而非 `login`。
       *
       * 验证码按场景隔离校验，而 `sendSmsCode` 在 scene="login" 时
       * 会**先检查手机号是否已注册，未注册直接报错**。
       * 而本接口的设计是「手机号不存在则建号」，必须允许新用户。
       * 用 login 场景会导致新用户根本发不出验证码，
       * 即「新用户永远无法通过微信登录完成注册」——
       * 且这个缺陷很容易漏过测试：生产 96.6% 用户已有手机号，
       * 拿老用户试一切正常。
       */
      if (!(await verifyCode("register", input.phone, input.smsCode))) {
        badBindingRequest("短信验证码错误或已失效，请重新获取");
      }

      const linked = Boolean(user);
      if (!user) {
        // 新建账号：用户名由 openid 派生，用户后续可在个人资料中修改昵称
        const username = await buildWechatUsername(openid);
        try {
          user = await createLocalUser({
            openId: `local:${username}`,
            username,
            phone: input.phone,
            name: null,
            loginMethod: "wechat_miniprogram",
            role: "user",
            lastSignedIn: new Date(),
          });
        } catch (error) {
          if (!isDuplicateEntryError(error)) throw error;
          // 并发建号：唯一约束仲裁后重查，落败方改走关联既有账号
          user = await getUserByPhone(input.phone);
          if (!user) throw new Error("绑定失败，请重新提交");
        }
      }

      if (!user) throw new Error("绑定失败，请重新提交");

      try {
        await createWechatBinding({
          userId: user.id,
          openid,
          boundPhone: input.phone,
          lastLoginAt: new Date(),
        });
      } catch (error) {
        if (!isDuplicateEntryError(error)) throw error;
        /*
         * 并发绑定：openid 或 userId 唯一约束触发。
         * 重查确认最终落库的那条是否指向同一账号；
         * 若指向别的账号说明确有冲突，必须明确报错而非静默放行。
         */
        const settled = await getWechatBindingByOpenid(openid);
        if (!settled || settled.userId !== user.id) {
          bindingConflict("当前微信已绑定其他51电子网账号");
        }
      }

      if (!linked) {
        try {
          await ensureNewUserWelcome(user.id);
        } catch (error) {
          // 欢迎消息失败不能回滚已完成的微信绑定；下次登录会幂等补偿。
          console.error("[WechatBind] 51小电欢迎消息写入失败:", error);
        }
      }

      const { sessionToken } = await issueMiniProgramSession(
        ctx,
        user.openId,
        user.name || user.username || "user",
      );
      return {
        success: true as const,
        linked,
        scopes: ["mall", "crm"] as LoginScope[],
        crmAccess: Boolean(user.crmAccess),
        user: toPublicAuthUser(user),
        sessionToken,
      };
    }),
});
