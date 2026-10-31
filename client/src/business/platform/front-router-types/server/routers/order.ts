import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  cancelBuyerPayment,
  PaymentFlowError,
} from "../services/paymentService";
import {
  CheckoutValidationError,
  createCorpCheckout,
  getPaymentBatchesForOrderIds,
} from "../services/paymentRepository";
import {
  buildCorporateTransferDetails,
  buildCorporateTransferPayments,
} from "../services/corporateTransfer";
import {
  cancelPendingCorpOrderAndRestore,
  cancelPendingSellerCorpOrderAndRestore,
} from "../services/inventoryStock";
import {
  confirmSellerCorpPayment,
  corpTransferTimeoutMinutes,
  declareCorpTransfer,
} from "../services/corpTransferService";
import { getLogisticsView, getLogisticsSummaries } from "../services/logisticsService";
import {
  isWaybillOcrAvailable,
  recognizeWaybill,
  WaybillOcrDisabledError,
  WaybillOcrRateLimitError,
} from "../services/waybillOcrService";
import { Kuaidi100OcrError } from "../services/kuaidi100OcrGateway";
import { EXPRESS_COMPANY_NAMES, expressCodeOf, expressNameOf } from "../../../shared/expressCompanies";
import { REFUND_STATUS_LABELS, RefundError } from "../services/refundService";
import {
  getRefundByOrderId,
  transitionRefund,
  updateRefund,
} from "../services/refundRepository";
import { claimAndSettle, confirmOfflineRefundPaid } from "../services/refundFlow";
import { notifyRefund, notifyUserBySiteMessage } from "../services/refundNotify";
import { createRefundRequest, REFUND_AFTER_SALES_DAYS } from "../services/refundRequestService";
import { withOrderItemImages } from "../services/orderItemImages";

// 快递公司列表改为从共享映射表取：下单表单与查询逻辑共用同一份数据，
// 避免出现“表单里能选但查询不支持”的不一致。

export const sellerDeliveryInput = z.object({
  sellerId: z.number().int().positive(),
  method: z.enum(["express", "pickup"]),
  addressId: z.number().int().positive().optional(),
  pickupPointId: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .transform(value => value ?? undefined),
  contactName: z.string().trim().max(64).optional(),
  contactPhone: z.string().trim().max(20).optional(),
});

export const orderRouter = router({
  /** 提交订单：勾选的购物车商品按卖家拆单 */
  create: protectedProcedure
    .input(
      z.object({
        /** 新版客户端传入：固定本次商品范围并作为幂等提交键。 */
        checkoutToken: z.string().min(16).max(64).optional(),
        addressId: z.number().int().positive().optional(),
        // 新订单仅允许企业对公转账；线上支付只保留既有批次的查单、取消、
        // 回调入账与退款状态机，绝不能由此公开入口重新创建。
        payMethod: z.literal("corp"),
        /** 旧客户端兼容；新客户端使用 deliveries 按卖家提交。 */
        deliveryMethod: z.enum(["express", "pickup"]).default("express"),
        deliveries: z.array(sellerDeliveryInput).max(100).optional(),
        note: z.string().trim().max(200).optional(),
        /**
         * 是否唤起小程序内支付（JSAPI）。
         *
         * 注意这里只接受一个布尔开关，**绝不接受客户端传入 openid**。
         * openid 由客户端提供意味着任何人都能替别人下单支付，
         * 或传入伪造值导致支付归属错乱。
         */
        inMiniProgram: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const checkedCartItems = input.checkoutToken
        ? []
        : (await db.getCartByUser(ctx.user.id)).filter(item => item.checked);
      if (checkedCartItems.some(item => item.taxIncluded === false)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "购物车中包含未税价商品，请通过聊一聊确认含税价格、发票、运费及交货方式",
        });
      }

      try {
        const checkout = await createCorpCheckout({
          buyerId: ctx.user.id,
          checkoutToken: input.checkoutToken,
          addressId: input.addressId,
          note: input.note,
          deliveryMethod: input.deliveryMethod,
          deliveries: input.deliveries,
        });
        const corporatePaymentGroup = buildCorporateTransferPayments(checkout.orders);
        return {
          mode: "order" as const,
          orders: checkout.orders,
          corporatePayments: corporatePaymentGroup.payments,
          corporatePaymentSummary: {
            sellerCount: corporatePaymentGroup.sellerCount,
            total: corporatePaymentGroup.total,
            notice: corporatePaymentGroup.notice,
          },
          // 兼容旧客户端：单卖家继续提供原字段；多卖家绝不合并为一个收款账户。
          corporatePayment:
            corporatePaymentGroup.payments.length === 1
              ? corporatePaymentGroup.payments[0]
              : null,
        };
      } catch (error) {
        if (error instanceof CheckoutValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "订单创建失败，请刷新库存后重试",
        });
      }
    }),

  /** 买家订单列表（含订单项） */
  myOrders: protectedProcedure.query(async ({ ctx }) => {
    const list = await db.getOrdersByBuyer(ctx.user.id);
    const orderIds = list.map(o => o.id);
    const [items, paymentLinks] = await Promise.all([
      db.getOrderItemsByOrderIds(orderIds),
      getPaymentBatchesForOrderIds(orderIds, ctx.user.id),
    ]);
    const imagedItems = await withOrderItemImages(items);
    const corpTimeoutMs = corpTransferTimeoutMinutes() * 60_000;
    return list.map(o => {
      const payment = paymentLinks.find(link => link.orderId === o.id)?.batch;
      /*
       * 对公转账的关单截止时间。
       *
       * 返回**绝对时间戳**而非剩余秒数：前端页面可能长时间停留（或休眠后唤醒），
       * 剩余秒数会随页面停留而漂移，绝对时间可随时重算。
       * 已声明转账的订单返回 null，因为它不再受超时约束。
       */
      const corpExpiresAt =
        o.payMethod === "corp" && o.status === "pending" && !o.transferDeclaredAt
          ? new Date(new Date(o.createdAt).getTime() + corpTimeoutMs)
          : null;
      return {
        ...o,
        items: imagedItems.filter(it => it.orderId === o.id),
        corpExpiresAt,
        corpTimeoutMinutes: corpTransferTimeoutMinutes(),
        payment: payment
          ? {
              paymentNo: payment.paymentNo,
              status: payment.status,
              expiresAt: payment.expiresAt,
              paidAt: payment.paidAt,
              closedAt: payment.closedAt,
            }
          : null,
      };
    });
  }),

  /**
   * 买家声明「我已转账，通知卖家确认到账」。
   *
   * 声明后订单转入待卖家确认，**不再被自动关单**：
   * 订单号已作为转账附言交给买家，款项可能已在路上，
   * 此时关单会导致钱到了账上却找不到对应订单。
   */
  declareTransfer: protectedProcedure
    .input(
      z.object({
        orderId: z.number().int(),
        /** 选填凭证：转账日期、付款账户后 4 位等，供财务比对 */
        transferNote: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const res = await declareCorpTransfer({
        orderId: input.orderId,
        userId: ctx.user.id,
        transferNote: input.transferNote,
      });
      if (!res.declared) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "该订单无法声明转账（仅待付款的对公转账订单可声明，且不可重复声明）",
        });
      }
      return { ok: true, orderNo: res.orderNo };
    }),

  /** 买家查看本人对公订单的收款账户快照与转账附言 */
  corporateTransferDetails: protectedProcedure
    .input(z.object({ orderId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.buyerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权查看该订单的付款信息" });
      }
      if (order.payMethod !== "corp") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该订单不是对公转账订单" });
      }
      return buildCorporateTransferDetails({
        id: order.id,
        orderNo: order.orderNo,
        sellerId: order.sellerId,
        sellerName: order.sellerName,
        total: Number(order.totalAmount),
        corpPayeeMode: order.corpPayeeMode,
        payeeCompanyId: order.payeeCompanyId,
        payeeAccountName: order.payeeAccountName,
        payeeAccountNumber: order.payeeAccountNumber,
        payeeBankName: order.payeeBankName,
        payeeReviewedAt: order.payeeReviewedAt,
      });
    }),

  /** 卖家收到的订单列表 */
  sellerOrders: protectedProcedure.query(async ({ ctx }) => {
    const list = await db.getOrdersBySeller(ctx.user.id);
    const [items, buyerIdentities] = await Promise.all([
      db.getOrderItemsByOrderIds(list.map(o => o.id)),
      db.getOrderBuyerIdentities(list.map(o => o.buyerId)),
    ]);
    // 物流概要只读缓存、不发起查询：列表可能一次展示几十个运单，
    // 逐个调接口会瞬间消耗大量单量并触发锁单。
    const summaries = await getLogisticsSummaries(list);
    const buyerIdentityById = new Map(buyerIdentities.map(row => [row.buyerId, row]));
    return list.map(o => {
      const buyer = buyerIdentityById.get(o.buyerId);
      const buyerCompanyName = buyer?.buyerCompanyName?.trim() || null;
      return {
        ...o,
        /** 订单公司：卖家视角展示买家企业名称；个人买家由前端回退展示。 */
        buyerCompanyName,
        buyerDisplayName:
          buyerCompanyName || buyer?.buyerName?.trim() || buyer?.buyerUsername?.trim() || "平台用户",
        items: items.filter(it => it.orderId === o.id),
        logistics: summaries[o.id] ?? null,
      };
    });
  }),

  /**
   * 卖家确认收款：pending → paid。
   *
   * 仅适用于对公转账订单。线上支付（支付宝/微信）的到账事实由渠道回调决定，
   * 若允许卖家手工确认，等于绕过渠道凭证直接改账，会造成买家未付款却进入发货
   * 流程的资金风险，因此这里明确拒绝。
   */
  sellerConfirmPay: protectedProcedure
    .input(
      z.object({
        orderId: z.number().int(),
        // 到账凭证备注：银行流水号或转账附言，便于日后对账追溯
        voucher: z.string().trim().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.sellerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      if (order.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            order.status === "paid"
              ? "该订单已是待发货状态，无需重复确认"
              : "仅待付款订单可确认收款",
        });
      }
      if (order.payMethod !== "corp") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            order.payMethod === "wechat"
              ? "微信支付订单由微信支付回调自动流转，不需也不得手工确认收款"
              : "支付宝订单由支付宝回调自动流转，不需也不得手工确认收款",
        });
      }

      const result = await confirmSellerCorpPayment({
        orderId: order.id,
        sellerId: ctx.user.id,
        voucher: input.voucher,
      });
      if (!result.confirmed) {
        throw new TRPCError({ code: "CONFLICT", message: "订单状态已变化，请刷新后重新核对" });
      }
      return { ok: true, paidAt: result.paidAt };
    }),

  /**
   * 卖家取消待付款订单。已付款/已发货不能走这里，需走售后退款。
   * 支付宝/微信先关支付通道；对公转账直接关单并回补库存。
   */
  sellerCancel: protectedProcedure
    .input(z.object({ orderId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.sellerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      if (order.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: order.status === "paid" ? "已付款订单请走售后处理" : "仅待付款订单可取消",
        });
      }
      if (order.payMethod === "alipay" || order.payMethod === "wechat") {
        try {
          const payment = await cancelBuyerPayment({
            buyerId: order.buyerId,
            orderId: order.id,
          });
          void notifyUserBySiteMessage(
            order.buyerId,
            `您的订单 ${order.orderNo} 已被卖家取消。如已付款请在聊一聊联系卖家。`,
          );
          return { ok: true, payment };
        } catch (error) {
          if (error instanceof PaymentFlowError) {
            throw new TRPCError({ code: "CONFLICT", message: error.message });
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "支付状态确认失败，请稍后重试" });
        }
      }
      const cancelled = await cancelPendingSellerCorpOrderAndRestore({
        orderId: order.id,
        sellerId: ctx.user.id,
        reason: "卖家取消订单",
      });
      if (!cancelled) {
        throw new TRPCError({ code: "CONFLICT", message: "订单状态已变化，请刷新后重试" });
      }
      void notifyUserBySiteMessage(
        order.buyerId,
        `您的订单 ${order.orderNo} 已被卖家取消。如已转账请在聊一聊联系卖家退款。`,
      );
      return { ok: true };
    }),

  /** 物流/状态轨迹 */
  tracks: protectedProcedure
    .input(z.object({ orderId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || (order.buyerId !== ctx.user.id && order.sellerId !== ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权查看该订单" });
      }
      return db.getOrderTracks(input.orderId);
    }),

  /** 非对公测试支付：pending → paid */
  pay: protectedProcedure
    .input(z.object({ orderId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.buyerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      if (order.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该订单当前不可付款" });
      }
      if (order.payMethod === "corp") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "对公转账需由平台财务到账核销，不能由买家自行确认付款",
        });
      }
      // 在线支付订单绝不能由买家自行确认付款，否则等于开放白嫖订单。
      if (order.payMethod === "alipay" || order.payMethod === "wechat") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            order.payMethod === "wechat"
              ? "微信支付订单必须扫码并由微信支付确认付款"
              : "支付宝订单必须扫码并由支付宝确认付款",
        });
      }
      await db.updateOrder(order.id, { status: "paid", paidAt: new Date() });
      await db.addOrderTrack(order.id, "买家已完成付款（模拟支付），等待卖家发货");
      return { ok: true };
    }),

  /** 取消订单：pending → cancel */
  cancel: protectedProcedure
    .input(z.object({ orderId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.buyerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      if (order.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "仅待付款订单可取消" });
      }
      // 在线支付订单的取消必须先反查渠道状态，不能直接改本地状态。
      if (order.payMethod === "alipay" || order.payMethod === "wechat") {
        try {
          const payment = await cancelBuyerPayment({
            buyerId: ctx.user.id,
            orderId: order.id,
          });
          return { ok: true, payment };
        } catch (error) {
          if (error instanceof PaymentFlowError) {
            throw new TRPCError({ code: "CONFLICT", message: error.message });
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "支付状态确认失败，请稍后重试" });
        }
      }
      const cancelled = await cancelPendingCorpOrderAndRestore({
        orderId: order.id,
        buyerId: ctx.user.id,
        reason: "买家主动取消",
      });
      if (!cancelled) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "订单状态已变化，或已声明转账，无法自行取消",
        });
      }
      return { ok: true };
    }),

  /** 卖家履约：严格遵循下单时固化的快递或自提方式。 */
  ship: protectedProcedure
    .input(
      z.object({
        orderId: z.number().int(),
        deliveryMethod: z.enum(["express", "pickup"]).default("express"),
        expressCo: z.string().trim().optional(),
        expressNo: z.string().trim().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.sellerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      if (order.status !== "paid") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "仅待发货订单可发货" });
      }

      if (order.deliveryMethod === "pickup") {
        if (input.deliveryMethod !== "pickup") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "该订单为上门自提" });
        }
        if (
          order.deliveryPlanMode === "seller_split" &&
          (!order.pickupAddress || !order.pickupContact || !order.pickupPhone)
        ) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "自提信息不完整，请联系平台" });
        }
        const readyAt = new Date();
        const shipped = await db.shipPaidOrder({
          orderId: order.id,
          sellerId: ctx.user.id,
          patch: {
            status: "shipped",
            expressCo: "自提",
            expressNo: null,
            pickupReadyAt: readyAt,
            shippedAt: readyAt,
          },
          track: "卖家已备货，等待买家自提",
        });
        if (!shipped) {
          throw new TRPCError({ code: "CONFLICT", message: "订单状态已变化，请刷新后重试" });
        }
        return { ok: true, deliveryMethod: "pickup" as const };
      }
      if (input.deliveryMethod !== "express") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该订单为快递配送" });
      }

      const expressCo = input.expressCo?.trim() || "";
      const expressNo = input.expressNo?.trim() || "";
      if (expressCo.length < 2) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请选择快递公司" });
      }
      if (expressNo.length < 6) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请填写正确的快递单号（至少 6 位）" });
      }
      // 录单时就校验快递公司是否在支持范围内。若等到查询时才发现不支持，
      // 买家已经看到一个无法跟踪的运单，体验更差也更难补救。
      if (!expressCodeOf(expressCo)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `暂不支持「${expressCo}」，请从列表中选择快递公司`,
        });
      }
      const shippedAt = new Date();
      const shipped = await db.shipPaidOrder({
        orderId: order.id,
        sellerId: ctx.user.id,
        patch: { status: "shipped", expressCo, expressNo, shippedAt },
        track:
          `卖家已录入发货信息：${expressCo}，运单号 ${expressNo}。` +
          "实际揽收与运输状态以承运商查询结果为准",
      });
      if (!shipped) {
        throw new TRPCError({ code: "CONFLICT", message: "订单状态已变化，请刷新后重试" });
      }
      return { ok: true, deliveryMethod: "express" as const };
    }),

  /** 确认收货：shipped → done */
  confirmReceive: protectedProcedure
    .input(z.object({ orderId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.buyerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      if (order.status !== "shipped") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "仅已发货订单可确认收货" });
      }
      const completedAt = new Date();
      await db.updateOrder(order.id, {
        status: "done",
        doneAt: completedAt,
        pickedUpAt: order.deliveryMethod === "pickup" ? completedAt : null,
      });
      await db.addOrderTrack(
        order.id,
        order.deliveryMethod === "pickup" ? "买家已确认提货，交易完成" : "买家已确认收货，交易完成",
      );
      return { ok: true };
    }),

  /**
   * 买家申请售后：paid/shipped/done → refund，并生成退款单。
   *
   * 金额一律服务端计算，绝不接受前端传入——否则买家可直接篡改退款金额。
   */
  requestRefund: protectedProcedure
    .input(
      z.object({
        orderId: z.number().int(),
        reason: z.string().trim().min(2, "请填写售后原因").max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await createRefundRequest({
          orderId: input.orderId,
          buyerId: ctx.user.id,
          reason: input.reason,
        });
        if (result.kind === "forbidden") {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
        }
        if (result.kind === "invalid_status") {
          throw new TRPCError({ code: "CONFLICT", message: "该订单当前不可申请售后，请刷新后重试" });
        }
        if (result.kind === "after_sales_expired") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `该订单已超过 ${REFUND_AFTER_SALES_DAYS} 天售后期，如需处理请联系客服`,
          });
        }
        if (result.kind === "duplicate") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `该订单已有退款申请（${result.refundNo}），请勿重复提交`,
          });
        }
        if (result.kind === "payment_missing") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "未找到该订单的支付记录，请联系客服核实" });
        }

        // 通知失败不阻断：退款与订单状态已在事务中一起落库。
        await notifyRefund({
          userId: result.order.sellerId,
          event: "requested",
          ctx: {
            orderNo: result.order.orderNo,
            refundNo: result.refund.refundNo,
            amount: result.refund.refundAmount,
            reason: input.reason,
          },
        });
        return {
          ok: true,
          refundNo: result.refund.refundNo,
          refundAmount: result.refund.refundAmount,
          shippingDeducted: result.shippingDeducted,
          autoApproveAt: result.refund.autoApproveAt,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message = error instanceof Error ? error.message : "退款申请创建失败，请重试";
        if (/duplicate|unique/i.test(message)) {
          throw new TRPCError({ code: "CONFLICT", message: "该订单已有退款申请，请勿重复提交" });
        }
        if (error instanceof RefundError && error.code === "ORDER_STATE_CONFLICT") {
          throw new TRPCError({ code: "CONFLICT", message });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
    }),

  /**
   * 卖家通过售后：提前放款，不必等 24 小时自动退款。
   *
   * 已发货订单允许直接退款，但未确认退货验收入库时不会回补库存；
   * 从 awaiting_return 通过则同时记录验收入库时间，随后才恢复可售库存。
   */
  approveRefund: protectedProcedure
    .input(z.object({ orderId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.sellerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      const refund = await getRefundByOrderId(order.id);
      if (!refund) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该订单没有退款申请" });
      }
      if (!["requested", "awaiting_return"].includes(refund.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `退款单当前状态为「${REFUND_STATUS_LABELS[refund.status]}」，无法执行通过操作`,
        });
      }
      // claimAndSettle 内部用状态抢占保证与 Worker 自动退款不会重复出款
      const result = await claimAndSettle(refund, ["requested", "awaiting_return"], ctx.user.id);
      if (!result) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该退款申请已被处理，请刷新查看最新状态",
        });
      }
      return { ok: true, status: result.status, message: result.message };
    }),

  /**
   * 卖家驳回退款：还原订单到申请前的状态。
   *
   * 驳回同时清掉 autoApproveAt，否则 24 小时自动退款仍会把已驳回的单退掉。
   */
  rejectRefund: protectedProcedure
    .input(
      z.object({
        orderId: z.number().int(),
        reason: z.string().trim().min(2, "请填写驳回理由").max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.sellerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      const refund = await getRefundByOrderId(order.id);
      if (!refund) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该订单没有退款申请" });
      }
      const ok = await transitionRefund(refund.id, ["requested", "awaiting_return"], {
        status: "rejected",
        rejectReason: input.reason,
        autoApproveAt: null,
        approvedBy: ctx.user.id,
      });
      if (!ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `退款单当前状态为「${REFUND_STATUS_LABELS[refund.status]}」，无法驳回`,
        });
      }
      await db.updateOrder(order.id, {
        status: refund.orderStatusBefore,
        statusNote: `退款申请未通过：${input.reason}`,
      });
      await db.addOrderTrack(order.id, `卖家驳回退款申请：${input.reason}`);
      await notifyRefund({
        userId: refund.buyerId,
        event: "rejected",
        ctx: {
          orderNo: order.orderNo,
          refundNo: refund.refundNo,
          amount: refund.refundAmount,
          rejectReason: input.reason,
        },
      });
      return { ok: true };
    }),

  /**
   * 卖家同意退货（已发货场景）：requested → awaiting_return。
   * 买家寄回并由卖家确认收货后，再走 approveRefund 放款。
   */
  agreeReturn: protectedProcedure
    .input(
      z.object({
        orderId: z.number().int(),
        returnAddress: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.sellerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      const refund = await getRefundByOrderId(order.id);
      if (!refund) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该订单没有退款申请" });
      }
      if (!refund.shippedWhenRequested) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "该订单尚未发货，无需退货，请直接通过或驳回",
        });
      }
      // 同意退货后清掉 autoApproveAt：此时放款条件改为"收到退货"，
      // 不能再按时间自动放款。
      const ok = await transitionRefund(refund.id, ["requested"], {
        status: "awaiting_return",
        autoApproveAt: null,
      });
      if (!ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `退款单当前状态为「${REFUND_STATUS_LABELS[refund.status]}」，无法执行该操作`,
        });
      }
      await db.addOrderTrack(
        order.id,
        `卖家同意退货，等待买家寄回商品${
          input.returnAddress ? `。退货地址：${input.returnAddress}` : ""
        }`,
      );
      await notifyRefund({
        userId: refund.buyerId,
        event: "agreed_return",
        ctx: {
          orderNo: order.orderNo,
          refundNo: refund.refundNo,
          amount: refund.refundAmount,
        },
      });
      return { ok: true };
    }),

  /** 买家填写退货运单（已发货退款场景） */
  submitReturnExpress: protectedProcedure
    .input(
      z.object({
        orderId: z.number().int(),
        expressCo: z.string().trim().min(2, "请填写快递公司"),
        expressNo: z.string().trim().min(6, "请填写快递单号"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.buyerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      const refund = await getRefundByOrderId(order.id);
      if (!refund || refund.status !== "awaiting_return") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "当前不可提交退货运单" });
      }
      await updateRefund(refund.id, {
        returnExpressCo: input.expressCo,
        returnExpressNo: input.expressNo,
      });
      await db.addOrderTrack(
        order.id,
        `买家已寄回商品：${input.expressCo}，运单号 ${input.expressNo}`,
      );
      return { ok: true };
    }),

  /** 退款单详情：买卖双方均可查看 */
  refundDetail: protectedProcedure
    .input(z.object({ orderId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || (order.buyerId !== ctx.user.id && order.sellerId !== ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权查看该订单" });
      }
      const refund = await getRefundByOrderId(order.id);
      if (!refund) return null;
      return {
        refundNo: refund.refundNo,
        status: refund.status,
        statusLabel: REFUND_STATUS_LABELS[refund.status],
        reason: refund.reason,
        refundAmount: refund.refundAmount,
        goodsAmount: refund.goodsAmount,
        shippingFee: refund.shippingFee,
        shippedWhenRequested: refund.shippedWhenRequested,
        payMethod: refund.payMethod,
        autoApproveAt: refund.autoApproveAt,
        rejectReason: refund.rejectReason,
        returnExpressCo: refund.returnExpressCo,
        returnExpressNo: refund.returnExpressNo,
        returnReceivedAt: refund.returnReceivedAt,
        succeededAt: refund.succeededAt,
        createdAt: refund.createdAt,
        // 对公转账退款的线下汇款凭据：买家需要它核对银行入账，卖家/财务需要它对账
        offlineVoucherNo: refund.offlineVoucherNo,
        offlinePaidAt: refund.offlinePaidAt,
        // lastError 属于内部排查信息，仅卖家与平台可见，不向买家暴露渠道细节
        lastError: order.sellerId === ctx.user.id ? refund.lastError : null,
      };
    }),

  /**
   * 确认对公转账退款已线下汇出（财务/卖家操作）。
   *
   * 对公转账没有退款 API，钱必须人工从银行汇出。没有本接口时，
   * 汇出后无处登记，退款单会永远停在“待财务线下打款”。
   *
   * 强制录入银行流水号：日后买家称未收到钱时，这是平台唯一的举证依据。
   */
  confirmOfflineRefund: protectedProcedure
    .input(
      z.object({
        orderId: z.number().int(),
        voucherNo: z
          .string()
          .trim()
          .min(4, "请填写银行流水号或回单号，以便日后对账与举证")
          .max(64),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.sellerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      const refund = await getRefundByOrderId(order.id);
      if (!refund) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "该订单没有退款申请" });
      }
      // 仅对公转账需要人工确认；线上渠道必须由系统回写，不开放手工标记，
      // 否则可能在实际未退款的情况下把订单标为已退款
      if (refund.payMethod !== "corp") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "仅对公转账退款需要人工确认打款，线上渠道由系统自动回写",
        });
      }
      const operator = ctx.user.name || ctx.user.username || `user#${ctx.user.id}`;
      const ok = await confirmOfflineRefundPaid(refund, {
        voucherNo: input.voucherNo,
        operator: String(operator).slice(0, 64),
      });
      if (!ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `退款单当前状态为「${REFUND_STATUS_LABELS[refund.status]}」，不可确认线下打款`,
        });
      }
      return { ok: true };
    }),

  /** 再次购买：订单商品重新加入购物车 */
  buyAgain: protectedProcedure
    .input(z.object({ orderId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || order.buyerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
      }
      const items = await db.getOrderItemsByOrderIds([order.id]);
      const invs = await db.getInventoriesByIds(items.map(i => i.inventoryId));
      let added = 0;
      const skipped: string[] = [];
      for (const it of items) {
        const inv = invs.find(v => v.id === it.inventoryId);
        if (!inv || inv.status !== "published" || inv.taxIncluded === false) {
          skipped.push(it.partNumber);
          continue;
        }
        await db.addToCart(ctx.user.id, it.inventoryId, it.qty);
        added++;
      }
      return { added, skipped, count: await db.getCartCount(ctx.user.id) };
    }),

  /** 快递公司选项（发货表单用） */
  expressCos: protectedProcedure.query(() => [...EXPRESS_COMPANY_NAMES]),

  /**
   * 订单物流轨迹（快递100 实时查询）。
   *
   * 买卖双方均可查看自己的订单。查询受缓存与频率限制保护，
   * 具体策略见 logisticsService。
   */
  logistics: protectedProcedure
    .input(
      z.object({
        orderId: z.number().int(),
        forceRefresh: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const order = await db.getOrderById(input.orderId);
      if (!order || (order.buyerId !== ctx.user.id && order.sellerId !== ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权查看该订单" });
      }
      return getLogisticsView({
        expressCo: order.expressCo,
        expressNo: order.expressNo,
        receiverPhone: order.receiverPhone,
        receiverAddress: order.receiverAddress,
        forceRefresh: input.forceRefresh,
      });
    }),

  /**
   * 面单识别能力是否可用。
   *
   * 前端据此决定是否展示上传入口，避免在未开通时让用户白白点开再报错。
   */
  waybillOcrAvailability: protectedProcedure.query(() => ({
    enabled: isWaybillOcrAvailable(),
  })),

  /**
   * 上传面单图片识别运单号与快递公司。
   *
   * 设计上的两个关键取向：
   *
   * 1. 用 mutation 而非 query。这不是一次可缓存的读取——快递100 面单 OCR
   *    是**实时扣费**的，每次真实调用都产生费用，语义上属于副作用操作。
   *    用 query 会被 tRPC 客户端自动缓存与重试，反而容易重复扣费。
   * 2. 只返回识别结果，**不直接写入订单**。快递100 官方声明无法保证
   *    100% 准确，要求使用方务必校验。因此由用户在界面确认后再提交发货。
   */
  recognizeWaybill: protectedProcedure
    .input(
      z.object({
        /** 图片 base64，可带或不带 data URI 头 */
        imageBase64: z.string().min(32, "图片内容不完整"),
        /** 关联订单，仅用于权限校验；不传则仅做识别 */
        orderId: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 传了订单时先校验归属：避免任意用户拿平台的付费额度做通用 OCR 工具
      if (input.orderId !== undefined) {
        const order = await db.getOrderById(input.orderId);
        if (!order || order.sellerId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该订单" });
        }
      }

      try {
        const view = await recognizeWaybill(input.imageBase64, ctx.user.id);
        return {
          ...view,
          // 同时返回中文名，前端发货表单用的是中文快递公司名
          expressName: view.expressCode ? expressNameOf(view.expressCode) : "",
        };
      } catch (error) {
        if (error instanceof WaybillOcrDisabledError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
        }
        if (error instanceof WaybillOcrRateLimitError) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
        }
        if (error instanceof Kuaidi100OcrError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),
});
