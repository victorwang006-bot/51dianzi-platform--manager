import { z } from "zod";
import { COOKIE_NAME } from "../shared/const";
import { router, protectedProcedure } from "./_core/trpc";
import { getSessionCookieOptions } from "./_core/cookies";
import { requireBusinessAdminAccount } from "./businessAccess";
import {
  getPersonalPerformance,
  personalCenterService,
} from "./personalCenterService";
import { personalMonthSchema } from "../client/src/business/platform/shared/personalPerformance";
const password = z.string().min(1).max(128);
const phone = z.string().trim().max(20);
const personalProcedure = protectedProcedure.use(({ ctx, next }) => {
  requireBusinessAdminAccount(ctx);
  return next({ ctx: { ...ctx, adminAccount: ctx.adminAccount! } });
});
export const personalCenterRouter = router({
  profile: personalProcedure.query(({ ctx }) =>
    personalCenterService.profile(ctx.adminAccount)
  ),
  updateProfile: personalProcedure
    .input(
      z
        .object({
          displayName: z.string().trim().min(1, "请输入用户名称").max(128),
          email: z
            .union([z.literal(""), z.email()])
            .transform(value => value.toLowerCase())
            .pipe(z.string().max(255)),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      personalCenterService.updateProfile(ctx.adminAccount, input)
    ),
  changePassword: personalProcedure
    .input(
      z
        .object({
          oldPassword: password,
          newPassword: z.string().min(8, "新密码至少8位").max(128),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const result = await personalCenterService.changePassword(
        ctx.adminAccount,
        input
      );
      ctx.res.clearCookie(COOKIE_NAME, getSessionCookieOptions(ctx.req));
      return result;
    }),
  requestPhoneCode: personalProcedure
    .input(z.object({ oldPassword: password, phone }).strict())
    .mutation(({ ctx, input }) =>
      personalCenterService.requestPhoneCode(ctx.adminAccount, input)
    ),
  bindPhone: personalProcedure
    .input(
      z
        .object({
          oldPassword: password,
          phone,
          ticketId: z.uuid(),
          code: z.string().regex(/^\d{6}$/, "请输入6位验证码"),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const result = await personalCenterService.bindPhone(
        ctx.adminAccount,
        input
      );
      ctx.res.clearCookie(COOKIE_NAME, getSessionCookieOptions(ctx.req));
      return result;
    }),
  performance: personalProcedure
    .input(
      z
        .object({
          month: personalMonthSchema,
          merchantId: z.number().int().positive().optional(),
          page: z.number().int().min(1).max(100000).default(1),
          pageSize: z.number().int().min(1).max(50).default(10),
        })
        .strict()
    )
    .query(({ ctx, input }) => getPersonalPerformance(ctx, input)),
  commission: personalProcedure
    .input(z.object({ month: personalMonthSchema }).strict())
    .query(({ input }) => ({
      status: "unconfigured" as const,
      month: input.month,
      amount: null,
      currency: "CNY" as const,
      reason: "未配置可核实的提成规则与结算来源，暂不能计算真实提成",
    })),
});
