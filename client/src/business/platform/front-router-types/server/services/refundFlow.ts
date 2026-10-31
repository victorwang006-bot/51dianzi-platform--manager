/**
 * 退款流程编排：把"渠道退款 + 状态落库 + 库存回补 + 通知"串成一个动作。
 *
 * 单独抽出的原因：卖家点"通过售后"（路由触发）与 24 小时自动退款
 * （Worker 触发）执行的是完全相同的资金动作。若两处各写一遍，
 * 迟早出现一处补库存另一处忘补、或一处发通知另一处不发的偏差——
 * 而这类偏差发生在资金链路上，事后极难对账追溯。
 */
import * as db from "../db";
import { type OrderRefund } from "../../drizzle/schema";
import { notifyRefund } from "./refundNotify";
import {
  assertBatchRefundWithinLimit,
  executeChannelRefund,
  REFUND_MAX_ATTEMPTS,
  RefundError,
  restoreRefundStock,
} from "./refundService";
import { transitionRefund, updateRefund } from "./refundRepository";

export type SettleResult = {
  status: OrderRefund["status"];
  message: string;
  /** 是否已实际动用资金通道，用于日志与测试断言 */
  channelCalled: boolean;
};

/**
 * 执行一笔已通过审核的退款。
 *
 * 调用前提：退款单状态已被抢占为 approved（用 transitionRefund 保证只有一方抢到），
 * 本函数不再做抢占，避免两层抢占语义互相干扰。
 *
 * @param approvedBy 批准人 userId；系统自动通过传 null
 */
export async function settleApprovedRefund(
  refund: OrderRefund,
  approvedBy: number | null,
): Promise<SettleResult> {
  // 出款前最后一道金额校验：批次累计退款不得超过批次实付总额。
  // 放在这里而不只放在申请环节，是因为申请到出款之间可能已产生
  // 同批次其他订单的退款，届时累计值才真正越界。
  if (refund.paymentBatchId) {
    try {
      await assertBatchRefundWithinLimit(
        refund.paymentBatchId,
        refund.refundAmount,
        refund.id,
      );
    } catch (err) {
      const message =
        err instanceof RefundError ? err.message : "退款金额校验失败，请人工核实";
      await updateRefund(refund.id, {
        status: "manual_review",
        lastError: message.slice(0, 255),
        lastAttemptAt: new Date(),
      });
      await db.addOrderTrack(refund.orderId, `退款金额校验未通过，转人工处理：${message}`);
      await notifyBuyer(refund, "manual_review");
      return { status: "manual_review", message, channelCalled: false };
    }
  }

  const attemptCount = (refund.attemptCount ?? 0) + 1;
  const outcome = await executeChannelRefund(refund);
  const now = new Date();

  // 渠道调用失败且仍可重试：记录错误后保持 approved，交给 Worker 下轮再试。
  // 超过上限则转人工，避免无限重试掩盖真实故障（如证书过期、余额不足）。
  if (outcome.status === "failed") {
    const exhausted = attemptCount >= REFUND_MAX_ATTEMPTS;
    await updateRefund(refund.id, {
      status: exhausted ? "manual_review" : "approved",
      attemptCount,
      lastAttemptAt: now,
      lastError: (outcome.errorMessage || "渠道退款失败").slice(0, 255),
      approvedBy: approvedBy ?? refund.approvedBy,
      approvedAt: refund.approvedAt ?? now,
    });
    if (exhausted) {
      await db.addOrderTrack(
        refund.orderId,
        `退款多次尝试失败，已转人工处理：${outcome.errorMessage || "渠道退款失败"}`,
      );
      await notifyBuyer(refund, "manual_review");
    }
    return {
      status: exhausted ? "manual_review" : "approved",
      message: outcome.errorMessage || "渠道退款失败",
      channelCalled: true,
    };
  }

  await updateRefund(refund.id, {
    status: outcome.status,
    providerRefundId: outcome.providerRefundId ?? null,
    providerStatus: outcome.providerStatus ?? null,
    attemptCount,
    lastAttemptAt: now,
    lastError: outcome.errorMessage ? outcome.errorMessage.slice(0, 255) : null,
    approvedBy: approvedBy ?? refund.approvedBy,
    approvedAt: refund.approvedAt ?? now,
    succeededAt: outcome.status === "succeeded" ? now : null,
  });

  // 未发货退款在资金进入退款通道后即可释放库存；已发货退款必须先确认
  // 退货验收入库。restoreRefundStock 内部统一校验资格并以事务保证幂等。
  if (["succeeded", "processing", "pending_offline"].includes(outcome.status)) {
    await restoreRefundStock(refund.id, refund.orderId);
  }

  await writeTrackAndNotify(refund, outcome.status);
  return {
    status: outcome.status,
    message: statusMessage(outcome.status),
    channelCalled: outcome.status !== "pending_offline",
  };
}

function statusMessage(status: OrderRefund["status"]): string {
  switch (status) {
    case "succeeded":
      return "退款已提交至支付渠道，预计 1-3 个工作日到账";
    case "processing":
      return "退款处理中，渠道确认后将自动更新状态";
    case "pending_offline":
      return "已审核通过，需财务线下打款";
    case "manual_review":
      return "已转人工核实处理";
    default:
      return "退款状态已更新";
  }
}

/**
 * 退款成功的收尾动作：订单终结 + 库存回补 + 轨迹 + 通知买家。
 *
 * **必须单独导出并被所有达到 succeeded 的路径调用。**
 *
 * 微信退款有两条达到 succeeded 的路径：
 *   1. 渠道同步返回 SUCCESS（executeRefundFlow 内）
 *   2. 先返回 PROCESSING，由 Worker 轮询对账后转 succeeded
 *
 * 上线首日即因只在路径 1 写了收尾动作而出错：实际走的是路径 2，
 * 钱已退给买家，但订单永远停在 refund、买家没收到退款成功通知、
 * 财务也分不清这笔到底退没退——即原“订单卡在 refund 没有出口”的翻版。
 *
 * 因此把收尾动作收敛到这一个函数，将来再增加路径（如微信退款回调）
 * 也只需调用它，不会再漏。
 *
 * 幂等：重复调用只会重写相同的订单状态；库存回补由
 * restoreRefundStock 内部的 stockRestored 原子占位保证只执行一次。
 */
export async function finalizeSucceededRefund(refund: OrderRefund): Promise<void> {
  const amount = refund.refundAmount;
  // 订单终结为 refunded，与"交易完成(done)"区分开，财务对账时一目了然
  await db.updateOrder(refund.orderId, {
    status: "refunded",
    statusNote: `退款 ¥${amount} 已完成`,
  });
  // 兼顾路径 2：Worker 对账路径上未必走过 settleApprovedRefund 的回补分支
  await restoreRefundStock(refund.id, refund.orderId);
  await db.addOrderTrack(
    refund.orderId,
    `退款 ¥${amount} 已提交至支付渠道${
      refund.shippedWhenRequested ? "（已发货订单，运费不退，仅退货款及税额）" : ""
    }，预计 1-3 个工作日到账`,
  );
  await notifyBuyer(refund, "succeeded");
}

/**
 * 确认对公转账退款已线下汇出：pending_offline → succeeded。
 *
 * 为何必须存在：系统能把对公转账退款标记为“待财务线下打款”，
 * 但若没有“确认已打款”的出口，财务从银行汇出后无处登记，
 * 退款单会永远停在 pending_offline、订单永远停在 refund、库存永远不回补，
 * 即“订单卡在 refund 无出口”问题在对公转账场景下的翻版。
 *
 * 资金安全要点：
 * 1. 仅允许 pending_offline 一个初始状态，防止误把线上退款单（wechat/alipay）
 *    或已完成的单子手工标记为已付；
 * 2. 强制录入银行流水号 + 经办人，否则日后无法对账与举证；
 * 3. 用 transitionRefund 原子抢占状态，并发点击只会成功一次；
 * 4. 收尾复用 finalizeSucceededRefund，让订单终结/轨迹/库存回补/买家通知
 *    与线上退款走完全相同的路径，不会再漏动作。
 *
 * @returns false 表示状态不符合（非 pending_offline 或已被其他请求处理）
 */
export async function confirmOfflineRefundPaid(
  refund: OrderRefund,
  params: { voucherNo: string; operator: string },
): Promise<boolean> {
  const now = new Date();
  const ok = await transitionRefund(refund.id, ["pending_offline"], {
    status: "succeeded",
    offlineVoucherNo: params.voucherNo,
    offlineOperator: params.operator,
    offlinePaidAt: now,
    succeededAt: now,
  });
  if (!ok) return false;

  await db.addOrderTrack(
    refund.orderId,
    `财务已线下汇出退款 ¥${refund.refundAmount}（银行凭据：${params.voucherNo}，经办人：${params.operator}）`,
  );
  // 传入已更新后的副本，避免收尾函数押到旧状态
  await finalizeSucceededRefund({ ...refund, status: "succeeded", succeededAt: now });
  return true;
}

async function writeTrackAndNotify(refund: OrderRefund, status: OrderRefund["status"]) {
  const amount = refund.refundAmount;
  if (status === "succeeded") {
    await finalizeSucceededRefund(refund);
    return;
  }
  if (status === "processing") {
    await db.addOrderTrack(refund.orderId, `退款 ¥${amount} 已受理，等待支付渠道确认`);
    return;
  }
  if (status === "pending_offline") {
    await db.updateOrder(refund.orderId, {
      statusNote: `退款 ¥${amount} 待财务线下打款`,
    });
    await db.addOrderTrack(
      refund.orderId,
      `退款 ¥${amount} 已审核通过。该订单为对公转账支付，需财务线下打款`,
    );
    await notifyBuyer(refund, "pending_offline");
    return;
  }
  if (status === "manual_review") {
    await db.addOrderTrack(refund.orderId, `退款 ¥${amount} 转人工核实处理`);
    await notifyBuyer(refund, "manual_review");
  }
}

async function notifyBuyer(
  refund: OrderRefund,
  event: "succeeded" | "manual_review" | "pending_offline",
) {
  const order = await db.getOrderById(refund.orderId);
  await notifyRefund({
    userId: refund.buyerId,
    event,
    ctx: {
      orderNo: order?.orderNo || String(refund.orderId),
      refundNo: refund.refundNo,
      amount: refund.refundAmount,
      shippingDeducted: refund.shippedWhenRequested,
    },
  });
}

/**
 * 抢占并结算：把退款单从 expected 状态抢到 approved 后执行退款。
 *
 * 返回 null 表示未抢到（已被其他进程或卖家处理），调用方应静默跳过——
 * 这不是错误，而是并发下的正常结果。
 */
export async function claimAndSettle(
  refund: OrderRefund,
  expected: OrderRefund["status"][],
  approvedBy: number | null,
): Promise<SettleResult | null> {
  const now = new Date();
  /*
   * awaiting_return 只能由卖家确认处理；抢占成功即代表卖家确认退货已验收入库。
   * requested 直接退款（包括已发货但无需退货的协商退款）不会写入该字段，
   * 因而不会把未退回的商品重新加入可售库存。
   */
  const returnReceivedAt =
    refund.shippedWhenRequested && refund.status === "awaiting_return"
      ? now
      : refund.returnReceivedAt;
  const claimed = await transitionRefund(refund.id, expected, {
    status: "approved",
    approvedBy: approvedBy ?? undefined,
    approvedAt: now,
    ...(returnReceivedAt ? { returnReceivedAt } : {}),
  });
  if (!claimed) return null;
  const fresh: OrderRefund = {
    ...refund,
    status: "approved",
    approvedBy: approvedBy ?? refund.approvedBy,
    approvedAt: refund.approvedAt ?? now,
    returnReceivedAt: returnReceivedAt ?? null,
  };
  return settleApprovedRefund(fresh, approvedBy);
}
