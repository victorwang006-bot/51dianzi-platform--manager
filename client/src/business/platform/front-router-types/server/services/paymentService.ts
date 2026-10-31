import { randomBytes } from "node:crypto";
import type { PaymentBatch } from "../../drizzle/schema";
import {
  ALIPAY_PAYMENT_TIMEOUT_MINUTES,
  getAlipayGateway,
  isAlipaySuccessStatus,
  safeAlipayError,
  type AlipayGateway,
  type AlipayNotifySignatureContext,
  type AlipayQueryResult,
} from "./alipayGateway";
import { PaymentFlowError } from "./paymentErrors";
import {
  cancelBuyerWechatPayment,
  getBuyerWechatPaymentStatus,
} from "./wechatPaymentService";
import {
  activatePaymentBatch,
  claimNextExpiredPaymentBatch,
  claimPaymentBatchQuery,
  createAlipayCheckout,
  getPaymentBatchByNo,
  getPaymentBatchForBuyer,
  getPaymentBatchForOrder,
  markPaymentBatchClosed,
  markPaymentBatchPaid,
  restorePaymentBatchForRetry,
  serializePaymentBatch,
  updatePaymentBatchFailure,
  updatePaymentProviderStatus,
  type SellerDeliverySelection,
} from "./paymentRepository";

const QUERY_MIN_INTERVAL_MS = 3_000;
const DEFINITIVE_NO_TRADE_CODES = new Set(["ACQ.TRADE_NOT_EXIST"]);
const PRECREATE_NO_TRADE_CODES = new Set([
  "ACQ.TRADE_NOT_EXIST",
  "ACQ.ACCESS_FORBIDDEN",
  "ACQ.INVALID_PARAMETER",
  "ACQ.PARTNER_ERROR",
  "ACQ.MERCHANT_STATUS_NOT_NORMAL",
]);

export { PaymentFlowError };

function createPaymentNo(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `PAY${stamp}${randomBytes(8).toString("hex").toUpperCase()}`;
}

function amountMatches(expected: string, actual: string) {
  return Number(expected).toFixed(2) === Number(actual).toFixed(2);
}

function closedReason(source: "expired" | "buyer" | "precreate_failed") {
  if (source === "buyer") return "支付宝支付已关闭，关联待付款订单已取消并释放库存";
  if (source === "precreate_failed") return "支付宝二维码创建失败，订单已取消并释放库存";
  return "支付宝支付超时（5 分钟），订单已取消并释放库存";
}

async function applyQueryResult(batch: PaymentBatch, result: AlipayQueryResult) {
  if (result.paymentNo !== batch.paymentNo || !amountMatches(batch.amount, result.totalAmount)) {
    await updatePaymentBatchFailure({
      paymentBatchId: batch.id,
      status: "manual_review",
      code: "QUERY_DATA_MISMATCH",
      message: "支付宝查询结果的交易号或金额与本地支付批次不一致",
    });
    throw new PaymentFlowError("QUERY_DATA_MISMATCH", "支付状态异常，已转人工核查");
  }

  if (isAlipaySuccessStatus(result.tradeStatus)) {
    if (!result.tradeNo) {
      await updatePaymentBatchFailure({
        paymentBatchId: batch.id,
        status: "manual_review",
        code: "MISSING_TRADE_NO",
        message: "支付宝成功状态缺少交易号",
      });
      throw new PaymentFlowError("MISSING_TRADE_NO", "支付状态异常，已转人工核查");
    }
    await markPaymentBatchPaid({
      paymentNo: batch.paymentNo,
      providerTradeNo: result.tradeNo,
      providerStatus: result.tradeStatus,
      totalAmount: result.totalAmount,
    });
    return getPaymentBatchByNo(batch.paymentNo);
  }

  if (result.tradeStatus === "TRADE_CLOSED") {
    await markPaymentBatchClosed({
      paymentNo: batch.paymentNo,
      providerStatus: result.tradeStatus,
      reason: closedReason("expired"),
    });
    return getPaymentBatchByNo(batch.paymentNo);
  }

  await updatePaymentProviderStatus({
    paymentBatchId: batch.id,
    providerStatus: result.tradeStatus,
    providerTradeNo: result.tradeNo,
  });
  return getPaymentBatchByNo(batch.paymentNo);
}

async function queryProvider(batch: PaymentBatch, gateway: AlipayGateway) {
  try {
    return { kind: "result" as const, result: await gateway.query(batch.paymentNo) };
  } catch (error) {
    const safe = safeAlipayError(error);
    if (safe.code === "ACQ.TRADE_NOT_EXIST") {
      return { kind: "not_found" as const, error: safe };
    }
    return { kind: "error" as const, error: safe };
  }
}

async function closeWaitingBatch(
  batch: PaymentBatch,
  gateway: AlipayGateway,
  source: "expired" | "buyer" | "precreate_failed",
) {
  try {
    await gateway.close(batch.paymentNo);
  } catch (error) {
    const safe = safeAlipayError(error);
    if (!DEFINITIVE_NO_TRADE_CODES.has(safe.code)) {
      const retryQuery = await queryProvider(batch, gateway);
      if (retryQuery.kind === "result") {
        if (isAlipaySuccessStatus(retryQuery.result.tradeStatus)) {
          return applyQueryResult(batch, retryQuery.result);
        }
        if (retryQuery.result.tradeStatus !== "TRADE_CLOSED") {
          throw new PaymentFlowError(
            "ALIPAY_CLOSE_UNCONFIRMED",
            "支付宝关单状态确认中，请稍后刷新",
          );
        }
      } else if (retryQuery.kind === "error") {
        throw new PaymentFlowError(
          "ALIPAY_CLOSE_UNCONFIRMED",
          "支付宝关单状态确认中，请稍后刷新",
        );
      }
    }
  }

  await markPaymentBatchClosed({
    paymentNo: batch.paymentNo,
    providerStatus: "TRADE_CLOSED",
    reason: closedReason(source),
  });
  return getPaymentBatchByNo(batch.paymentNo);
}

async function reconcileExpiredBatch(batch: PaymentBatch, gateway: AlipayGateway) {
  const query = await queryProvider(batch, gateway);
  if (query.kind === "result") {
    if (isAlipaySuccessStatus(query.result.tradeStatus) || query.result.tradeStatus === "TRADE_CLOSED") {
      return applyQueryResult(batch, query.result);
    }
    if (query.result.tradeStatus === "WAIT_BUYER_PAY") {
      return closeWaitingBatch(batch, gateway, "expired");
    }
    throw new PaymentFlowError("UNKNOWN_TRADE_STATUS", "支付宝返回未知交易状态");
  }
  if (query.kind === "not_found") {
    return closeWaitingBatch(batch, gateway, "expired");
  }
  throw new PaymentFlowError(query.error.code, "支付宝状态查询失败，稍后自动重试");
}

export async function startAlipayCheckout(input: {
  buyerId: number;
  checkoutToken?: string;
  addressId?: number;
  note?: string;
  deliveryMethod?: "express" | "pickup";
  deliveries?: SellerDeliverySelection[];
  clientIp?: string | null;
  gateway?: AlipayGateway;
}) {
  const gateway = input.gateway || getAlipayGateway();
  const paymentNo = createPaymentNo();
  const checkout = await createAlipayCheckout({
    buyerId: input.buyerId,
    checkoutToken: input.checkoutToken,
    addressId: input.addressId,
    note: input.note,
    deliveryMethod: input.deliveryMethod,
    deliveries: input.deliveries,
    paymentNo,
    expiresInSeconds: ALIPAY_PAYMENT_TIMEOUT_MINUTES * 60,
  });

  if (checkout.reused) {
    const existing = checkout.paymentNo
      ? await getPaymentBatchByNo(checkout.paymentNo)
      : null;
    return {
      mode: "alipay" as const,
      orders: checkout.orders,
      payment: existing ? serializePaymentBatch(existing) : null,
    };
  }
  if (!checkout.paymentBatchId) throw new Error("支付批次创建失败");

  try {
    const created = await gateway.precreate({
      paymentNo,
      amount: checkout.amount,
      subject:
        checkout.orders.length > 1
          ? `51电子网采购订单等${checkout.orders.length}单`
          : `51电子网采购订单${checkout.orders[0]?.orderNo || ""}`,
      clientIp: input.clientIp,
    });
    if (created.paymentNo !== paymentNo) {
      throw new PaymentFlowError("PAYMENT_NO_MISMATCH", "支付宝返回的支付号不一致");
    }
    const batch = await activatePaymentBatch({
      paymentBatchId: checkout.paymentBatchId,
      paymentNo,
      qrCode: created.qrCode,
    });
    return {
      mode: "alipay" as const,
      orders: checkout.orders,
      payment: serializePaymentBatch(batch),
    };
  } catch (error) {
    const safe = safeAlipayError(error);
    const batch = await getPaymentBatchByNo(paymentNo);
    if (!batch) throw error;

    const query = await queryProvider(batch, gateway);
    if (query.kind === "result") {
      if (isAlipaySuccessStatus(query.result.tradeStatus)) {
        const recovered = await applyQueryResult(batch, query.result);
        return {
          mode: "alipay" as const,
          orders: checkout.orders,
          payment: recovered ? serializePaymentBatch(recovered) : null,
        };
      }
      if (query.result.tradeStatus === "WAIT_BUYER_PAY") {
        await closeWaitingBatch(batch, gateway, "precreate_failed");
      } else if (query.result.tradeStatus === "TRADE_CLOSED") {
        await markPaymentBatchClosed({
          paymentNo,
          providerStatus: "TRADE_CLOSED",
          reason: closedReason("precreate_failed"),
        });
      } else {
        await updatePaymentBatchFailure({
          paymentBatchId: batch.id,
          status: "manual_review",
          code: "PRECREATE_UNKNOWN_STATUS",
          message: "二维码创建失败后查询到未知交易状态",
        });
      }
    } else if (query.kind === "not_found" || PRECREATE_NO_TRADE_CODES.has(safe.code)) {
      await markPaymentBatchClosed({
        paymentNo,
        providerStatus: "TRADE_CLOSED",
        reason: closedReason("precreate_failed"),
      });
    } else {
      await updatePaymentBatchFailure({
        paymentBatchId: batch.id,
        status: "manual_review",
        code: safe.code,
        message: "二维码创建结果不确定，已阻断自动取消并等待核查",
      });
    }
    throw new PaymentFlowError(safe.code, "支付宝二维码创建失败，请稍后重试");
  }
}

export async function getBuyerPaymentStatus(input: {
  buyerId: number;
  paymentNo: string;
  gateway?: AlipayGateway;
}) {
  const existing = await getPaymentBatchForBuyer(input.paymentNo, input.buyerId);
  if (!existing) throw new PaymentFlowError("PAYMENT_NOT_FOUND", "支付记录不存在");
  // 微信批次交由微信服务处理，保证两条链路的状态机互不干扰。
  if (existing.provider === "wechat") {
    return getBuyerWechatPaymentStatus({
      buyerId: input.buyerId,
      paymentNo: input.paymentNo,
    });
  }
  if (!["creating", "waiting", "closing"].includes(existing.status)) {
    return serializePaymentBatch(existing);
  }

  const claimed = await claimPaymentBatchQuery({
    paymentNo: input.paymentNo,
    buyerId: input.buyerId,
    minIntervalMs: QUERY_MIN_INTERVAL_MS,
  });
  if (!claimed?.claimed) return serializePaymentBatch(claimed?.batch || existing);

  const gateway = input.gateway || getAlipayGateway();
  if (claimed.batch.remainingSeconds <= 0) {
    try {
      const reconciled = await reconcileExpiredBatch(claimed.batch, gateway);
      return reconciled ? serializePaymentBatch(reconciled) : serializePaymentBatch(claimed.batch);
    } catch {
      return serializePaymentBatch((await getPaymentBatchByNo(input.paymentNo)) || claimed.batch);
    }
  }

  const query = await queryProvider(claimed.batch, gateway);
  if (query.kind === "result") {
    const reconciled = await applyQueryResult(claimed.batch, query.result);
    return serializePaymentBatch(reconciled || claimed.batch);
  }
  if (query.kind === "not_found") return serializePaymentBatch(claimed.batch);
  return serializePaymentBatch(claimed.batch);
}

export async function getBuyerPaymentForOrder(input: {
  buyerId: number;
  orderId: number;
  gateway?: AlipayGateway;
}) {
  const batch = await getPaymentBatchForOrder(input.orderId, input.buyerId);
  if (!batch) throw new PaymentFlowError("PAYMENT_NOT_FOUND", "该订单没有在线支付记录");
  return getBuyerPaymentStatus({
    buyerId: input.buyerId,
    paymentNo: batch.paymentNo,
    gateway: input.gateway,
  });
}

/** 按批次 provider 分发取消请求，供路由层统一调用。 */
export async function cancelBuyerPayment(input: { buyerId: number; orderId: number }) {
  const batch = await getPaymentBatchForOrder(input.orderId, input.buyerId);
  if (!batch) throw new PaymentFlowError("PAYMENT_NOT_FOUND", "该订单没有在线支付记录");
  if (batch.provider === "wechat") return cancelBuyerWechatPayment(input);
  return cancelBuyerAlipayPayment(input);
}

export async function cancelBuyerAlipayPayment(input: {
  buyerId: number;
  orderId: number;
  gateway?: AlipayGateway;
}) {
  const batch = await getPaymentBatchForOrder(input.orderId, input.buyerId);
  if (!batch) throw new PaymentFlowError("PAYMENT_NOT_FOUND", "该订单没有支付宝支付记录");
  if (batch.status === "paid") throw new PaymentFlowError("PAYMENT_ALREADY_PAID", "订单已付款，不能取消");
  if (batch.status === "closed") return serializePaymentBatch(batch);
  if (batch.status === "manual_review") {
    throw new PaymentFlowError("PAYMENT_REVIEWING", "支付状态正在人工核查，暂不能取消");
  }

  const gateway = input.gateway || getAlipayGateway();
  const query = await queryProvider(batch, gateway);
  if (query.kind === "result") {
    if (isAlipaySuccessStatus(query.result.tradeStatus)) {
      const paid = await applyQueryResult(batch, query.result);
      throw new PaymentFlowError(
        "PAYMENT_ALREADY_PAID",
        paid ? "支付宝已确认付款，订单不能取消" : "订单已付款",
      );
    }
    if (query.result.tradeStatus === "TRADE_CLOSED") {
      await markPaymentBatchClosed({
        paymentNo: batch.paymentNo,
        providerStatus: "TRADE_CLOSED",
        reason: closedReason("buyer"),
      });
    } else if (query.result.tradeStatus === "WAIT_BUYER_PAY") {
      await closeWaitingBatch(batch, gateway, "buyer");
    } else {
      throw new PaymentFlowError("UNKNOWN_TRADE_STATUS", "支付宝返回未知交易状态，暂不能取消");
    }
  } else if (query.kind === "not_found") {
    await closeWaitingBatch(batch, gateway, "buyer");
  } else {
    throw new PaymentFlowError("PAYMENT_QUERY_FAILED", "支付状态确认失败，暂不能取消");
  }

  const closed = await getPaymentBatchByNo(batch.paymentNo);
  if (!closed) throw new PaymentFlowError("PAYMENT_NOT_FOUND", "支付记录不存在");
  return serializePaymentBatch(closed);
}

export type AlipayNotifyResult = {
  ok: boolean;
  httpStatus: number;
  responseText: "success" | "fail";
  reason: string;
};

export async function handleAlipayNotify(
  payload: Record<string, string>,
  gatewayOverride?: AlipayGateway,
  signatureContext?: AlipayNotifySignatureContext,
): Promise<AlipayNotifyResult> {
  let gateway: AlipayGateway;
  try {
    gateway = gatewayOverride || getAlipayGateway();
  } catch {
    return { ok: false, httpStatus: 500, responseText: "fail", reason: "gateway_unavailable" };
  }

  if (!gateway.verifyNotify(payload, signatureContext)) {
    return { ok: false, httpStatus: 200, responseText: "fail", reason: "invalid_signature" };
  }
  if (payload.app_id !== gateway.appId) {
    return { ok: false, httpStatus: 200, responseText: "fail", reason: "app_id_mismatch" };
  }
  if (payload.seller_id !== gateway.sellerId) {
    return { ok: false, httpStatus: 200, responseText: "fail", reason: "seller_id_mismatch" };
  }

  const paymentNo = payload.out_trade_no?.trim();
  const tradeNo = payload.trade_no?.trim();
  const totalAmount = payload.total_amount?.trim();
  const tradeStatus = payload.trade_status?.trim();
  if (!paymentNo || !tradeNo || !totalAmount || !tradeStatus) {
    return { ok: false, httpStatus: 200, responseText: "fail", reason: "missing_fields" };
  }

  const batch = await getPaymentBatchByNo(paymentNo);
  if (!batch || !amountMatches(batch.amount, totalAmount)) {
    if (batch) {
      await updatePaymentBatchFailure({
        paymentBatchId: batch.id,
        status: "manual_review",
        code: "NOTIFY_DATA_MISMATCH",
        message: "支付宝通知金额与本地支付批次不一致",
      });
    }
    return { ok: false, httpStatus: 200, responseText: "fail", reason: "payment_mismatch" };
  }

  if (isAlipaySuccessStatus(tradeStatus)) {
    const settled = await markPaymentBatchPaid({
      paymentNo,
      providerTradeNo: tradeNo,
      providerStatus: tradeStatus,
      totalAmount,
      notifyId: payload.notify_id || null,
    });
    if (settled.outcome === "manual_review" || settled.outcome === "not_found") {
      return { ok: false, httpStatus: 200, responseText: "fail", reason: settled.outcome };
    }
  } else if (tradeStatus === "TRADE_CLOSED") {
    const closed = await markPaymentBatchClosed({
      paymentNo,
      providerStatus: tradeStatus,
      reason: closedReason("expired"),
    });
    if (closed.outcome === "already_paid" || closed.outcome === "manual_review") {
      return { ok: false, httpStatus: 200, responseText: "fail", reason: closed.outcome };
    }
  } else {
    await updatePaymentProviderStatus({
      paymentBatchId: batch.id,
      providerStatus: tradeStatus,
      providerTradeNo: tradeNo,
    });
  }

  return { ok: true, httpStatus: 200, responseText: "success", reason: "processed" };
}

export async function sweepExpiredAlipayPayments(input?: {
  maxBatches?: number;
  gateway?: AlipayGateway;
}) {
  const gateway = input?.gateway || getAlipayGateway();
  const maxBatches = Math.max(1, Math.min(input?.maxBatches ?? 20, 100));
  let processed = 0;
  let deferred = 0;

  while (processed < maxBatches) {
    /*
     * 必须限定 provider="alipay"。
     *
     * 不传参时本函数会认领**所有渠道**的到期批次，
     * 而 paymentExpiryWorker 中支付宝清扫先于微信执行，
     * 微信批次会先被这里抢走，再用支付宝网关去查微信交易：
     * 1) 支付宝查不到则按 not_found 关单，写入“支付宝支付超时”，
     *    导致微信订单显示支付宝文案（生产已出现 DZ20260815-28279）；
     * 2) 更严重的是资金风险：若买家在到期瞬间完成微信付款，
     *    支付宝网关永远查不到该交易，微信已收款而平台却关单退库存。
     */
    const batch = await claimNextExpiredPaymentBatch("alipay");
    if (!batch) break;
    processed++;
    try {
      await reconcileExpiredBatch(batch, gateway);
    } catch (error) {
      const safe = safeAlipayError(error);
      await restorePaymentBatchForRetry({
        paymentBatchId: batch.id,
        code: safe.code,
        message: "到期支付状态确认失败，等待下一轮重试",
      });
      deferred++;
    }
  }
  return { processed, deferred };
}

export async function getBuyerPaymentSnapshot(input: { buyerId: number; paymentNo: string }) {
  const batch = await getPaymentBatchForBuyer(input.paymentNo, input.buyerId);
  if (!batch) throw new PaymentFlowError("PAYMENT_NOT_FOUND", "支付记录不存在");
  return serializePaymentBatch(batch);
}

export async function getBuyerPaymentSnapshotForOrder(input: { buyerId: number; orderId: number }) {
  const batch = await getPaymentBatchForOrder(input.orderId, input.buyerId);
  if (!batch) throw new PaymentFlowError("PAYMENT_NOT_FOUND", "该订单没有支付宝支付记录");
  return serializePaymentBatch(batch);
}
