import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ENV } from "../_core/env";
import { protectedProcedure, router } from "../_core/trpc";
import {
  cancelBuyerPayment,
  getBuyerPaymentSnapshot,
  getBuyerPaymentSnapshotForOrder,
  getBuyerPaymentStatus,
  PaymentFlowError,
} from "../services/paymentService";

function paymentError(error: unknown): never {
  if (error instanceof PaymentFlowError) {
    const code = error.code === "PAYMENT_NOT_FOUND"
      ? "NOT_FOUND"
      : [
            "PAYMENT_ALREADY_PAID",
            "PAYMENT_REVIEWING",
            "ALIPAY_CLOSE_UNCONFIRMED",
            "WECHAT_CLOSE_UNCONFIRMED",
            "UNKNOWN_TRADE_STATUS",
          ].includes(error.code)
        ? "CONFLICT"
        : "BAD_REQUEST";
    throw new TRPCError({ code, message: error.message });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "支付服务暂不可用，请稍后重试" });
}

export const paymentRouter = router({
  /** 支付方式可用性只由服务端生产开关决定；前端在查询失败时保持关闭。 */
  availability: protectedProcedure.query(() => ({
    alipay: ENV.alipayEnabled,
    wechat: ENV.wechatPayEnabled,
  })),

  /** 只读本地支付快照，不调用支付宝。 */
  status: protectedProcedure
    .input(z.object({ paymentNo: z.string().trim().min(10).max(64) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getBuyerPaymentSnapshot({ buyerId: ctx.user.id, paymentNo: input.paymentNo });
      } catch (error) {
        paymentError(error);
      }
    }),

  /** 从订单中心恢复同一批次二维码；一次支付可能关联多张拆分订单。 */
  byOrder: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      try {
        return await getBuyerPaymentSnapshotForOrder({
          buyerId: ctx.user.id,
          orderId: input.orderId,
        });
      } catch (error) {
        paymentError(error);
      }
    }),

  /** 受服务端最短间隔限制的主动查询，用于补偿异步通知丢失。 */
  refresh: protectedProcedure
    .input(z.object({ paymentNo: z.string().trim().min(10).max(64) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await getBuyerPaymentStatus({ buyerId: ctx.user.id, paymentNo: input.paymentNo });
      } catch (error) {
        paymentError(error);
      }
    }),

  /** 取消任一关联订单即安全关闭整个支付批次，自动区分支付宝与微信。 */
  cancel: protectedProcedure
    .input(z.object({ orderId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await cancelBuyerPayment({
          buyerId: ctx.user.id,
          orderId: input.orderId,
        });
      } catch (error) {
        paymentError(error);
      }
    }),
});
