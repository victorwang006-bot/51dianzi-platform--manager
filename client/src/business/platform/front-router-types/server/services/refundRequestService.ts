import { and, eq, inArray, sql } from "drizzle-orm";
import {
  orderRefunds,
  orderTracks,
  orders,
  paymentBatchOrders,
  paymentBatches,
  type Order,
  type OrderRefund,
  type RefundStatus,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  buildRefundNo,
  calcRefundAmount,
  isOrderShipped,
  isWithinAfterSalesWindow,
  REFUND_AFTER_SALES_DAYS,
  REFUND_AUTO_APPROVE_HOURS,
  RefundError,
} from "./refundService";

/**
 * 退款申请的订单状态与退款单必须在同一事务中写入。
 *
 * 单靠 order_refunds.orderId 唯一索引只能阻止重复退款，不能阻止卖家同时把
 * paid 订单改为 shipped：两个请求若各自先读取 paid，再分别写入，就可能生成
 * "按未发货金额退款、实际却已发货" 的资金不一致。本服务先锁 orders 行，
 * 再锁同批 payment_batches 行，把订单状态、退款金额、批次额度与退款单作为
 * 一个原子决策提交。
 */

const REFUND_RESERVING_STATUSES: RefundStatus[] = [
  "requested",
  "awaiting_return",
  "approved",
  "processing",
  "succeeded",
  "pending_offline",
  "manual_review",
];

function moneyToCents(value: string | number) {
  const normalized = String(value).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new RefundError("INVALID_AMOUNT", "退款金额格式无效");
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RefundError("INVALID_AMOUNT", "退款金额无效");
  }
  return cents;
}

function rowsAffected(result: unknown) {
  return Number(
    (result as unknown as [{ affectedRows?: number }, unknown])?.[0]?.affectedRows ??
      (result as { rowsAffected?: number })?.rowsAffected ??
      0,
  );
}

export type RefundRequestOutcome =
  | { kind: "forbidden" }
  | { kind: "invalid_status"; status: Order["status"] }
  | { kind: "after_sales_expired" }
  | { kind: "duplicate"; refundNo: string }
  | { kind: "payment_missing" }
  | { kind: "created"; order: Order; refund: OrderRefund; shippingDeducted: boolean };

export async function createRefundRequest(input: {
  orderId: number;
  buyerId: number;
  reason: string;
  now?: Date;
}): Promise<RefundRequestOutcome> {
  const db = await getDb();
  if (!db) throw new RefundError("DB_UNAVAILABLE", "数据库不可用");

  const now = input.now || new Date();
  return db.transaction(async tx => {
    // 发货与退款必须抢同一把订单行锁；ship 使用 paid 条件更新，提交后只会有一方成功。
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.buyerId, input.buyerId)))
      .limit(1)
      .for("update");
    if (!order) return { kind: "forbidden" } as const;

    if (!["paid", "shipped", "done"].includes(order.status)) {
      return { kind: "invalid_status", status: order.status } as const;
    }
    if (!isWithinAfterSalesWindow(order, now)) {
      return { kind: "after_sales_expired" } as const;
    }

    const [existing] = await tx
      .select({ refundNo: orderRefunds.refundNo })
      .from(orderRefunds)
      .where(eq(orderRefunds.orderId, order.id))
      .limit(1);
    if (existing) return { kind: "duplicate", refundNo: existing.refundNo } as const;

    const shipped = isOrderShipped(order);
    const breakdown = calcRefundAmount(order, { shipped });

    let paymentBatchId: number | null = null;
    if (order.payMethod !== "corp") {
      /*
       * 锁住整个支付批次，而不是只锁当前订单。一个支付批次可关联多张拆分
       * 订单；两个订单同时退款时，这把锁使下面的 SUM + INSERT 串行，额度
       * 校验才不是“两个请求都看见旧余额”的摆设。
       */
      const [paymentLink] = await tx
        .select({ batch: paymentBatches })
        .from(paymentBatchOrders)
        .innerJoin(paymentBatches, eq(paymentBatchOrders.paymentBatchId, paymentBatches.id))
        .where(
          and(
            eq(paymentBatchOrders.orderId, order.id),
            eq(paymentBatches.status, "paid"),
          ),
        )
        .limit(1)
        .for("update");
      if (!paymentLink) return { kind: "payment_missing" } as const;
      paymentBatchId = paymentLink.batch.id;

      const [reserved] = await tx
        .select({ amount: sql<string>`COALESCE(SUM(${orderRefunds.refundAmount}), 0)` })
        .from(orderRefunds)
        .where(
          and(
            eq(orderRefunds.paymentBatchId, paymentBatchId),
            inArray(orderRefunds.status, REFUND_RESERVING_STATUSES),
          ),
        );
      const reservedCents = moneyToCents(reserved?.amount ?? "0");
      const refundCents = moneyToCents(breakdown.refundAmount);
      const batchCents = moneyToCents(paymentLink.batch.amount);
      if (reservedCents + refundCents > batchCents) {
        throw new RefundError(
          "REFUND_EXCEEDS_BATCH",
          `退款累计金额 ¥${((reservedCents + refundCents) / 100).toFixed(2)} 已超过支付批次总额 ¥${(
            batchCents / 100
          ).toFixed(2)}`,
        );
      }
    }

    const refundNo = buildRefundNo(order.id, now);
    const autoApproveAt = shipped
      ? null
      : new Date(now.getTime() + REFUND_AUTO_APPROVE_HOURS * 3600 * 1000);
    await tx.insert(orderRefunds).values({
      refundNo,
      orderId: order.id,
      buyerId: order.buyerId,
      sellerId: order.sellerId,
      status: "requested",
      orderStatusBefore: order.status,
      shippedWhenRequested: shipped,
      reason: input.reason,
      refundAmount: breakdown.refundAmount,
      goodsAmount: breakdown.goodsAmount,
      shippingFee: breakdown.shippingFee,
      payMethod: order.payMethod,
      paymentBatchId,
      autoApproveAt,
    });

    // 显式保留 paid/shipped/done 条件：即使未来有人移动了上方锁，状态机仍不会回退覆盖。
    const updated = await tx
      .update(orders)
      .set({
        status: "refund",
        statusNote: `${input.reason} · 退款 ¥${breakdown.refundAmount} 审核中`.slice(0, 255),
      })
      .where(
        and(
          eq(orders.id, order.id),
          eq(orders.buyerId, input.buyerId),
          inArray(orders.status, ["paid", "shipped", "done"]),
        ),
      );
    if (rowsAffected(updated) !== 1) {
      // 抛错会回滚刚插入的退款单，绝不留下退款单与订单状态脱节。
      throw new RefundError("ORDER_STATE_CONFLICT", "订单状态已变化，请刷新后重试");
    }

    await tx.insert(orderTracks).values({
      orderId: order.id,
      content:
        `买家发起售后申请：${input.reason}。申请退款 ¥${breakdown.refundAmount}` +
        `${
          breakdown.shippingDeducted
            ? `（商品已发货，运费 ¥${order.shippingFee} 不予退还）`
            : "（含运费全额退还）"
        }` +
        `${shipped ? "，等待卖家处理" : `，卖家 ${REFUND_AUTO_APPROVE_HOURS} 小时内未处理将自动退款`}`,
    });

    const [refund] = await tx
      .select()
      .from(orderRefunds)
      .where(eq(orderRefunds.refundNo, refundNo))
      .limit(1);
    if (!refund) throw new Error("退款申请创建失败");

    return { kind: "created", order, refund, shippingDeducted: breakdown.shippingDeducted } as const;
  });
}

export { REFUND_AFTER_SALES_DAYS };
