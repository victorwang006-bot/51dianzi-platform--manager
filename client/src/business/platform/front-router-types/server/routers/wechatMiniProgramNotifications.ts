import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getWechatMiniProgramNotificationStatus,
  getWechatMiniProgramSubscriptionRequestStatus,
  prepareWechatMiniProgramSubscription,
} from "../services/wechatMiniProgramChatReminder";
import { getWechatServiceBindingStatus } from "../services/wechatServiceAccount";

export const wechatMiniProgramNotificationsRouter = router({
  /** 只返回当前登录账号可展示的额度汇总，不暴露OpenID或授权明细。 */
  status: protectedProcedure.query(async ({ ctx }) => {
    const [mini, service] = await Promise.all([
      getWechatMiniProgramNotificationStatus(ctx.user.id),
      getWechatServiceBindingStatus(ctx.user.id),
    ]);
    const serviceAvailableCredits = service.reminderEnabled
      ? Math.max(0, Number(service.availableCredits || 0))
      : 0;
    return {
      ...mini,
      serviceAvailableCredits,
      totalAvailableCredits: mini.availableCredits + serviceAvailableCredits,
    };
  }),

  /**
   * 每次用户主动点击订阅按钮后，用新的 wx.login code 核对当前微信身份，
   * 再创建短时pending记录。模板ID由服务端返回，避免客户端配置漂移。
   */
  prepare: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      return prepareWechatMiniProgramSubscription({
        userId: ctx.user.id,
        code: input.code,
      });
    }),

  /** 客户端允许后仅轮询微信可信事件结果，不能通过本接口自行确认额度。 */
  requestStatus: protectedProcedure
    .input(z.object({ requestToken: z.string().min(16).max(128) }))
    .query(async ({ ctx, input }) => {
      return {
        status: await getWechatMiniProgramSubscriptionRequestStatus({
          userId: ctx.user.id,
          requestToken: input.requestToken,
        }),
      };
    }),
});
