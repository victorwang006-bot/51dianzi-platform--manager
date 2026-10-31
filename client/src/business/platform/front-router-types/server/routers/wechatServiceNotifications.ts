import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createWechatServiceBindCode,
  getWechatServiceBindingStatus,
  setWechatServiceReminderEnabled,
} from "../services/wechatServiceAccount";
import { isWechatServiceNotificationConfigured } from "../services/wechatServiceChatReminder";

export const wechatServiceNotificationsRouter = router({
  /** 只返回可展示状态，绝不把服务号 openid 或 UnionID 暴露给客户端。 */
  status: protectedProcedure.query(async ({ ctx }) => {
    const status = await getWechatServiceBindingStatus(ctx.user.id);
    return {
      ...status,
      deliveryReady: isWechatServiceNotificationConfigured(),
      serviceAccountOriginalId: "gh_8c0e7a837ba1",
    };
  }),

  /**
   * 生成十分钟有效的六位绑定码；新码会立即使该账号的旧待用码失效。
   * 明文只返回本次响应，数据库仅保存 HMAC 摘要。
   */
  createBindCode: protectedProcedure.mutation(async ({ ctx }) => {
    const current = await getWechatServiceBindingStatus(ctx.user.id);
    if (current.bound && current.subscribed) {
      return {
        alreadyBound: true as const,
        code: null,
        expiresInSeconds: 0,
        serviceAccountOriginalId: "gh_8c0e7a837ba1",
      };
    }
    const result = await createWechatServiceBindCode(ctx.user.id);
    return {
      alreadyBound: false as const,
      code: result.code,
      expiresInSeconds: result.expiresInSeconds,
      serviceAccountOriginalId: "gh_8c0e7a837ba1",
    };
  }),

  setEnabled: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return setWechatServiceReminderEnabled(ctx.user.id, input.enabled);
    }),
});
