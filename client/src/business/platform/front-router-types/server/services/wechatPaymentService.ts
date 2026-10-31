import { randomBytes } from "node:crypto";
import type { PaymentBatch } from "../../drizzle/schema";
import { PaymentFlowError } from "./paymentErrors";
import {
  getWechatGateway,
  safeWechatError,
  WECHAT_PAYMENT_TIMEOUT_MINUTES,
  type WechatGateway,
  type WechatNotifyEnvelope,
  type WechatQueryResult,
  type WechatSignatureHeaders,
} from "./wechatGateway";
import {
  activatePaymentBatch,
  claimNextExpiredPaymentBatch,
  claimPaymentBatchQuery,
  createWechatCheckout,
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

/** 买家轮询查单的最小间隔，避免高频请求触发微信限流。 */
const QUERY_MIN_INTERVAL_MS = 3_000;

/** 微信明确表示"订单不存在"的错误码，可安全视为未下单。 */
const WECHAT_NOT_FOUND_CODES = new Set(["ORDER_NOT_EXIST"]);

/** 关单调用可以直接忽略的错误码：本身就代表订单已不可支付。 */
const WECHAT_DEFINITIVE_CLOSE_CODES = new Set(["ORDER_NOT_EXIST", "ORDER_CLOSED"]);

/** 微信侧待支付/支付中状态，可以主动关单。 */
const WECHAT_PENDING_STATES = ["NOTPAY", "USERPAYING"];

/** 微信侧终态（非成功），本地直接置为已关闭。 */
const WECHAT_TERMINAL_STATES = ["CLOSED", "REVOKED", "PAYERROR"];

export function createWechatPaymentNo(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `WX${stamp}${randomBytes(8).toString("hex").toUpperCase()}`;
}

function moneyToCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

function centsToMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

function closedReason(source: "expired" | "buyer" | "precreate_failed") {
  if (source === "buyer") return "微信支付已关闭，关联待付款订单已取消并释放库存";
  if (source === "precreate_failed") return "微信支付二维码创建失败，订单已取消并释放库存";
  return "微信支付超时（5 分钟），订单已取消并释放库存";
}

/**
 * 查单结果与本地批次的一致性校验。
 * 未支付时微信可能不返回交易类型/金额/币种，因此这些字段允许为 null，
 * 只有"存在且不一致"才判定为异常，避免把正常待支付误判成资金风险。
 */
function expectedWechatIdentity(batch: PaymentBatch, gateway: WechatGateway) {
  // 迁移前的历史批次均为 Native；新批次创建时必须显式持久化交易类型。
  const tradeType = batch.wechatTradeType ?? "NATIVE";
  return {
    tradeType,
    appId: tradeType === "JSAPI" ? gateway.miniProgramAppId : gateway.appId,
  } as const;
}

export function wechatQueryResultMatches(
  batch: PaymentBatch,
  result: WechatQueryResult,
  gateway: WechatGateway,
) {
  const expectedCents = moneyToCents(batch.amount);
  const expected = expectedWechatIdentity(batch, gateway);
  return (
    result.paymentNo === batch.paymentNo &&
    result.appId === expected.appId &&
    result.mchId === gateway.mchId &&
    (result.tradeType === null || result.tradeType === expected.tradeType) &&
    (result.currency === null || result.currency === "CNY") &&
    (result.totalCents === null || expectedCents === result.totalCents)
  );
}

async function markQueryMismatch(batch: PaymentBatch, message: string): Promise<never> {
  await updatePaymentBatchFailure({
    paymentBatchId: batch.id,
    status: "manual_review",
    code: "QUERY_DATA_MISMATCH",
    message,
  });
  throw new PaymentFlowError("QUERY_DATA_MISMATCH", "支付状态异常，已转人工核查");
}

/** 把微信查单结果落到本地批次。成功入账前会做一次严格的强字段校验。 */
export async function applyWechatQueryResult(
  batch: PaymentBatch,
  result: WechatQueryResult,
  gateway: WechatGateway,
) {
  if (!wechatQueryResultMatches(batch, result, gateway)) {
    return markQueryMismatch(
      batch,
      "微信查询结果的 AppID、商户号、交易类型、订单号或金额不一致",
    );
  }

  if (result.tradeState === "SUCCESS") {
    // 入账是不可逆动作，此处不再接受 null：交易类型、金额、币种必须齐全且吻合。
    const expected = expectedWechatIdentity(batch, gateway);
    if (
      result.tradeType !== expected.tradeType ||
      result.currency !== "CNY" ||
      result.totalCents === null ||
      moneyToCents(batch.amount) !== result.totalCents
    ) {
      return markQueryMismatch(
        batch,
        "微信支付成功查单缺少交易类型、金额或币种，或字段不一致",
      );
    }
    if (!result.transactionId) {
      await updatePaymentBatchFailure({
        paymentBatchId: batch.id,
        status: "manual_review",
        code: "MISSING_TRANSACTION_ID",
        message: "微信支付成功状态缺少交易号",
      });
      throw new PaymentFlowError("MISSING_TRANSACTION_ID", "支付状态异常，已转人工核查");
    }
    await markPaymentBatchPaid({
      paymentNo: batch.paymentNo,
      providerTradeNo: result.transactionId,
      providerStatus: result.tradeState,
      totalAmount: centsToMoney(result.totalCents),
      paidAt: result.successTime || undefined,
    });
    return getPaymentBatchByNo(batch.paymentNo);
  }

  if (WECHAT_TERMINAL_STATES.includes(result.tradeState)) {
    await markPaymentBatchClosed({
      paymentNo: batch.paymentNo,
      providerStatus: result.tradeState,
      reason: closedReason("expired"),
    });
    return getPaymentBatchByNo(batch.paymentNo);
  }

  await updatePaymentProviderStatus({
    paymentBatchId: batch.id,
    providerStatus: result.tradeState,
    providerTradeNo: result.transactionId,
  });
  return getPaymentBatchByNo(batch.paymentNo);
}

async function queryProvider(batch: PaymentBatch, gateway: WechatGateway) {
  try {
    return { kind: "result" as const, result: await gateway.query(batch.paymentNo) };
  } catch (error) {
    const safe = safeWechatError(error);
    if (WECHAT_NOT_FOUND_CODES.has(safe.code)) {
      return { kind: "not_found" as const, error: safe };
    }
    return { kind: "error" as const, error: safe };
  }
}

/**
 * 关闭一个仍在等待付款的批次。
 * 关单失败时必须再查一次微信：如果用户其实已经付款成功，
 * 绝不能因为关单动作把订单取消掉，而要转为正常入账。
 */
export async function closeWaitingWechatBatch(
  batch: PaymentBatch,
  gateway: WechatGateway,
  source: "expired" | "buyer" | "precreate_failed",
) {
  try {
    await gateway.close(batch.paymentNo);
  } catch (error) {
    const safe = safeWechatError(error);
    if (!WECHAT_DEFINITIVE_CLOSE_CODES.has(safe.code)) {
      const retryQuery = await queryProvider(batch, gateway);
      if (retryQuery.kind === "result") {
        if (retryQuery.result.tradeState === "SUCCESS") {
          return applyWechatQueryResult(batch, retryQuery.result, gateway);
        }
        if (!WECHAT_TERMINAL_STATES.includes(retryQuery.result.tradeState)) {
          throw new PaymentFlowError(
            "WECHAT_CLOSE_UNCONFIRMED",
            "微信支付关单状态确认中，请稍后刷新",
          );
        }
      } else if (retryQuery.kind === "error") {
        throw new PaymentFlowError(
          "WECHAT_CLOSE_UNCONFIRMED",
          "微信支付关单状态确认中，请稍后刷新",
        );
      }
    }
  }

  await markPaymentBatchClosed({
    paymentNo: batch.paymentNo,
    providerStatus: "CLOSED",
    reason: closedReason(source),
  });
  return getPaymentBatchByNo(batch.paymentNo);
}

/** 到期批次对账：以微信侧状态为准决定入账还是关单。 */
export async function reconcileExpiredWechatBatch(batch: PaymentBatch, gateway: WechatGateway) {
  const query = await queryProvider(batch, gateway);
  if (query.kind === "result") {
    if (
      query.result.tradeState === "SUCCESS" ||
      WECHAT_TERMINAL_STATES.includes(query.result.tradeState)
    ) {
      return applyWechatQueryResult(batch, query.result, gateway);
    }
    if (WECHAT_PENDING_STATES.includes(query.result.tradeState)) {
      return closeWaitingWechatBatch(batch, gateway, "expired");
    }
    throw new PaymentFlowError("UNKNOWN_TRADE_STATUS", "微信支付返回未知交易状态");
  }
  if (query.kind === "not_found") {
    return closeWaitingWechatBatch(batch, gateway, "expired");
  }
  throw new PaymentFlowError(query.error.code, "微信支付状态查询失败，稍后自动重试");
}

/**
 * 微信 Native 收银台下单。
 *
 * 顺序是"先落库再调微信"：本地批次先建好，二维码创建失败时才有据可查。
 * 失败分支不直接取消订单，而是先反查微信一次，确认资金状态后再决定
 * 入账 / 关单 / 转人工，避免"钱到了但订单被取消"这类资金事故。
 */
export async function startWechatCheckout(input: {
  buyerId: number;
  checkoutToken?: string;
  addressId?: number;
  note?: string;
  deliveryMethod?: "express" | "pickup";
  deliveries?: SellerDeliverySelection[];
  clientIp?: string | null;
  gateway?: WechatGateway;
  /**
   * 付款人 openid：传入则走小程序 JSAPI 下单，不传则走 Native 扫码。
   *
   * 两个场景共用本函数而不另写一份，是因为下方的异常分支
   * 承载着资金安全的核心逻辑（失败后反查微信确认资金状态
   * 再决定入账/关单/转人工，避免「钱到了但订单被取消」）。
   * 复制一份就是埋一颗雷：两边容错逻辑日后必然走样，
   * 而资金类缺陷的代价远高于一点参数分叉的复杂度。
   */
  payerOpenid?: string | null;
}) {
  const gateway = input.gateway || getWechatGateway();
  const paymentNo = createWechatPaymentNo();
  const isJsapi = Boolean(input.payerOpenid);
  const wechatTradeType = isJsapi ? "JSAPI" : "NATIVE";
  const checkout = await createWechatCheckout({
    buyerId: input.buyerId,
    checkoutToken: input.checkoutToken,
    addressId: input.addressId,
    note: input.note,
    deliveryMethod: input.deliveryMethod,
    deliveries: input.deliveries,
    paymentNo,
    expiresInSeconds: WECHAT_PAYMENT_TIMEOUT_MINUTES * 60,
    wechatTradeType,
  });

  if (checkout.reused) {
    const existing = checkout.paymentNo
      ? await getPaymentBatchByNo(checkout.paymentNo)
      : null;
    return {
      mode: "wechat" as const,
      orders: checkout.orders,
      payment: existing ? serializePaymentBatch(existing) : null,
      // JSAPI 签名参数不落库；重试时引导到订单中心继续支付，绝不重复建单。
      jsapi: null,
    };
  }
  if (!checkout.paymentBatchId) throw new Error("支付批次创建失败");

  try {
    const subject =
      checkout.orders.length > 1
        ? `51电子网采购订单等${checkout.orders.length}单`
        : `51电子网采购订单${checkout.orders[0]?.orderNo || ""}`;

    /*
     * JSAPI 与 Native 返回形式不同：前者是一组签名参数，后者是二维码。
     * JSAPI 参数**不写入 qrCode 字段**：
     * 一是语义不符（该字段存 weixin:// 开头的二维码串），
     * 二是塞进去就得序列化成 JSON 再解析，任何格式错误都会
     * 在小程序端表现为「支付面板不弹」这种无从排查的症状。
     */
    let jsapiParams: Awaited<ReturnType<WechatGateway["jsapiPrepay"]>> | null = null;
    let qrCode = "";
    if (isJsapi) {
      jsapiParams = await gateway.jsapiPrepay({
        paymentNo,
        amount: checkout.amount,
        subject,
        payerOpenid: String(input.payerOpenid),
        clientIp: input.clientIp,
        expiresInSeconds: WECHAT_PAYMENT_TIMEOUT_MINUTES * 60,
      });
      if (jsapiParams.paymentNo !== paymentNo) {
        throw new PaymentFlowError("PAYMENT_NO_MISMATCH", "微信返回的支付号不一致");
      }
    } else {
      const created = await gateway.precreate({
        paymentNo,
        amount: checkout.amount,
        subject,
        clientIp: input.clientIp,
      });
      if (created.paymentNo !== paymentNo) {
        throw new PaymentFlowError("PAYMENT_NO_MISMATCH", "微信返回的支付号不一致");
      }
      qrCode = created.qrCode;
    }

    /*
     * JSAPI 仍需 activate 把批次置为 waiting：
     * 轮询、到期对账、后台清扫均以该状态为前提，
     * 若停在 creating，订单会变成无人跟进的孤单。
     * qrCode 传空串即可（该列可为空）。
     */
    const batch = await activatePaymentBatch({
      paymentBatchId: checkout.paymentBatchId,
      paymentNo,
      qrCode,
    });
    return {
      mode: "wechat" as const,
      orders: checkout.orders,
      payment: serializePaymentBatch(batch),
      /** 仅 JSAPI 场景返回；可直接交给 wx.requestPayment */
      jsapi: jsapiParams,
    };
  } catch (error) {
    const safe = safeWechatError(error);
    const batch = await getPaymentBatchByNo(paymentNo);
    if (!batch) throw error;

    const query = await queryProvider(batch, gateway);
    if (query.kind === "result") {
      if (query.result.tradeState === "SUCCESS") {
        // 极端时序：下单响应丢失但用户已完成支付，此处补入账并按成功返回。
        const recovered = await applyWechatQueryResult(batch, query.result, gateway);
        return {
          mode: "wechat" as const,
          orders: checkout.orders,
          payment: recovered ? serializePaymentBatch(recovered) : null,
          /*
           * 此分支资金已到账，不需再唤起支付面板，故为 null。
           * 字段仍需出现：返回结构在各分支保持一致，
           * 小程序端才能统一用 `jsapi ? 唤起支付 : 直接跳订单` 判断，
           * 而不是靠 undefined 与 null 的差别猜测当前处于哪个分支。
           */
          jsapi: null,
        };
      }
      if (WECHAT_PENDING_STATES.includes(query.result.tradeState)) {
        await closeWaitingWechatBatch(batch, gateway, "precreate_failed");
      } else if (WECHAT_TERMINAL_STATES.includes(query.result.tradeState)) {
        await markPaymentBatchClosed({
          paymentNo,
          providerStatus: query.result.tradeState,
          reason: closedReason("precreate_failed"),
        });
      } else {
        await updatePaymentBatchFailure({
          paymentBatchId: batch.id,
          status: "manual_review",
          code: "PRECREATE_UNKNOWN_STATUS",
          message: "微信二维码创建失败后查询到未知交易状态",
        });
      }
    } else if (query.kind === "not_found" || WECHAT_NOT_FOUND_CODES.has(safe.code)) {
      await markPaymentBatchClosed({
        paymentNo,
        providerStatus: "CLOSED",
        reason: closedReason("precreate_failed"),
      });
    } else {
      // 状态不确定时宁可留单转人工，也不自动取消订单释放库存。
      await updatePaymentBatchFailure({
        paymentBatchId: batch.id,
        status: "manual_review",
        code: safe.code,
        message: "微信二维码创建结果不确定，已阻断自动取消并等待核查",
      });
    }
    throw new PaymentFlowError(safe.code, "微信支付二维码创建失败，请稍后重试");
  }
}

/** 买家轮询支付状态。带节流，且到期批次走对账而不是直接失败。 */
export async function getBuyerWechatPaymentStatus(input: {
  buyerId: number;
  paymentNo: string;
  gateway?: WechatGateway;
}) {
  const existing = await getPaymentBatchForBuyer(input.paymentNo, input.buyerId);
  if (!existing) throw new PaymentFlowError("PAYMENT_NOT_FOUND", "支付记录不存在");
  if (existing.provider !== "wechat") {
    throw new PaymentFlowError("PAYMENT_PROVIDER_MISMATCH", "该支付记录不是微信支付");
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

  const gateway = input.gateway || getWechatGateway();
  if (claimed.batch.remainingSeconds <= 0) {
    try {
      const reconciled = await reconcileExpiredWechatBatch(claimed.batch, gateway);
      return reconciled ? serializePaymentBatch(reconciled) : serializePaymentBatch(claimed.batch);
    } catch {
      // 对账失败不向买家抛错，返回最新快照即可，后台清扫会继续重试。
      return serializePaymentBatch((await getPaymentBatchByNo(input.paymentNo)) || claimed.batch);
    }
  }

  const query = await queryProvider(claimed.batch, gateway);
  if (query.kind === "result") {
    const reconciled = await applyWechatQueryResult(claimed.batch, query.result, gateway);
    return serializePaymentBatch(reconciled || claimed.batch);
  }
  return serializePaymentBatch(claimed.batch);
}

/** 买家主动取消。取消前必须确认微信侧未收款。 */
export async function cancelBuyerWechatPayment(input: {
  buyerId: number;
  orderId: number;
  gateway?: WechatGateway;
}) {
  const batch = await getPaymentBatchForOrder(input.orderId, input.buyerId);
  if (!batch) throw new PaymentFlowError("PAYMENT_NOT_FOUND", "该订单没有微信支付记录");
  if (batch.provider !== "wechat") {
    throw new PaymentFlowError("PAYMENT_PROVIDER_MISMATCH", "该订单不是微信支付订单");
  }
  if (batch.status === "paid") {
    throw new PaymentFlowError("PAYMENT_ALREADY_PAID", "订单已付款，不能取消");
  }
  if (batch.status === "closed") return serializePaymentBatch(batch);
  if (batch.status === "manual_review") {
    throw new PaymentFlowError("PAYMENT_REVIEWING", "支付状态正在人工核查，暂不能取消");
  }

  const gateway = input.gateway || getWechatGateway();
  const query = await queryProvider(batch, gateway);
  if (query.kind === "result") {
    if (query.result.tradeState === "SUCCESS") {
      const paid = await applyWechatQueryResult(batch, query.result, gateway);
      throw new PaymentFlowError(
        "PAYMENT_ALREADY_PAID",
        paid ? "微信支付已确认付款，订单不能取消" : "订单已付款",
      );
    }
    if (WECHAT_TERMINAL_STATES.includes(query.result.tradeState)) {
      await markPaymentBatchClosed({
        paymentNo: batch.paymentNo,
        providerStatus: query.result.tradeState,
        reason: closedReason("buyer"),
      });
    } else if (WECHAT_PENDING_STATES.includes(query.result.tradeState)) {
      await closeWaitingWechatBatch(batch, gateway, "buyer");
    } else {
      throw new PaymentFlowError("UNKNOWN_TRADE_STATUS", "微信支付返回未知交易状态，暂不能取消");
    }
  } else if (query.kind === "not_found") {
    await closeWaitingWechatBatch(batch, gateway, "buyer");
  } else {
    throw new PaymentFlowError("PAYMENT_QUERY_FAILED", "支付状态确认失败，暂不能取消");
  }

  const closed = await getPaymentBatchByNo(batch.paymentNo);
  if (!closed) throw new PaymentFlowError("PAYMENT_NOT_FOUND", "支付记录不存在");
  return serializePaymentBatch(closed);
}

function parseWechatNotifyEnvelope(rawBody: string): WechatNotifyEnvelope | null {
  try {
    const value = JSON.parse(rawBody);
    if (
      !value ||
      typeof value !== "object" ||
      !value.id ||
      !value.event_type ||
      !value.resource ||
      typeof value.resource !== "object" ||
      !value.resource.algorithm ||
      !value.resource.ciphertext ||
      !value.resource.nonce ||
      !value.resource.original_type
    ) {
      return null;
    }
    return value as WechatNotifyEnvelope;
  } catch {
    return null;
  }
}

/** 回调报文与本地批次的六项强一致校验，任何一项不符都不入账。 */
export function wechatNotifyTransactionMatches(
  transaction: Record<string, any>,
  batch: PaymentBatch,
  gateway: WechatGateway,
) {
  const expected = expectedWechatIdentity(batch, gateway);
  return (
    transaction.appid === expected.appId &&
    transaction.mchid === gateway.mchId &&
    transaction.out_trade_no === batch.paymentNo &&
    transaction.trade_type === expected.tradeType &&
    transaction.trade_state === "SUCCESS" &&
    transaction.amount?.currency === "CNY" &&
    Number.isSafeInteger(transaction.amount?.total) &&
    moneyToCents(batch.amount) === transaction.amount.total
  );
}

export type WechatNotifyOutcome = {
  ok: boolean;
  httpStatus: number;
  responseBody: { code: string; message: string };
  reason: string;
};

function notifyFailure(httpStatus: number, reason: string): WechatNotifyOutcome {
  return {
    ok: false,
    httpStatus,
    responseBody: { code: "FAIL", message: "支付通知处理失败" },
    reason,
  };
}

/**
 * 处理微信支付结果通知。
 *
 * 安全顺序不可调整：先校验签名头齐备 → 验签 → 解析信封 → 校验事件类型
 * → 解密 → 字段校验 → 与本地批次强一致比对 → 入账。
 * 任何一步不通过都不会写入资金状态。
 */
export async function handleWechatNotify(
  rawBody: string,
  headers: WechatSignatureHeaders,
  gatewayOverride?: WechatGateway,
): Promise<WechatNotifyOutcome> {
  if (!headers.serial || !headers.signature || !headers.timestamp || !headers.nonce) {
    return notifyFailure(401, "missing_signature_headers");
  }

  let gateway: WechatGateway;
  try {
    gateway = gatewayOverride || getWechatGateway();
  } catch {
    return notifyFailure(500, "gateway_unavailable");
  }

  if (!gateway.verifySignature(rawBody, headers)) {
    return notifyFailure(401, "invalid_signature");
  }

  const envelope = parseWechatNotifyEnvelope(rawBody);
  if (!envelope) return notifyFailure(400, "invalid_envelope");

  if (
    envelope.event_type !== "TRANSACTION.SUCCESS" ||
    envelope.resource_type !== "encrypt-resource" ||
    envelope.resource.original_type !== "transaction"
  ) {
    return notifyFailure(400, "unsupported_event");
  }

  let transaction: Record<string, any>;
  try {
    transaction = gateway.decryptNotify(envelope);
  } catch {
    return notifyFailure(400, "decrypt_failed");
  }

  const paymentNo = typeof transaction.out_trade_no === "string" ? transaction.out_trade_no.trim() : "";
  const transactionId =
    typeof transaction.transaction_id === "string" ? transaction.transaction_id.trim() : "";
  if (!paymentNo || !transactionId) return notifyFailure(400, "missing_fields");

  const batch = await getPaymentBatchByNo(paymentNo);
  if (!batch || batch.provider !== "wechat") {
    // 返回 5xx 让微信重试，覆盖"通知早于本地事务提交"的时序。
    return notifyFailure(500, "payment_not_found");
  }

  if (!wechatNotifyTransactionMatches(transaction, batch, gateway)) {
    await updatePaymentBatchFailure({
      paymentBatchId: batch.id,
      status: "manual_review",
      code: "NOTIFY_DATA_MISMATCH",
      message: "微信支付通知的 AppID、商户号、交易类型、订单号或金额不一致",
    });
    return notifyFailure(500, "payment_mismatch");
  }

  const successTime = transaction.success_time ? new Date(transaction.success_time) : null;
  const settled = await markPaymentBatchPaid({
    paymentNo,
    providerTradeNo: transactionId,
    providerStatus: transaction.trade_state,
    totalAmount: centsToMoney(transaction.amount.total),
    // notifyId 用于幂等：微信会重复推送同一通知。
    notifyId: envelope.id,
    paidAt: successTime && !Number.isNaN(successTime.getTime()) ? successTime : undefined,
  });

  if (settled.outcome === "manual_review" || settled.outcome === "not_found") {
    return notifyFailure(500, settled.outcome);
  }

  return {
    ok: true,
    httpStatus: 200,
    responseBody: { code: "SUCCESS", message: "成功" },
    reason: settled.outcome,
  };
}

/** 后台清扫到期未支付批次，释放库存。失败的批次退回等待下一轮。 */
export async function sweepExpiredWechatPayments(input?: {
  maxBatches?: number;
  gateway?: WechatGateway;
}) {
  const gateway = input?.gateway || getWechatGateway();
  const maxBatches = Math.max(1, Math.min(input?.maxBatches ?? 20, 100));
  let processed = 0;
  let deferred = 0;

  while (processed < maxBatches) {
    const batch = await claimNextExpiredPaymentBatch("wechat");
    if (!batch) break;
    processed++;
    try {
      await reconcileExpiredWechatBatch(batch, gateway);
    } catch (error) {
      const safe = safeWechatError(error);
      await restorePaymentBatchForRetry({
        paymentBatchId: batch.id,
        code: safe.code,
        message: "到期微信支付状态确认失败，等待下一轮重试",
      });
      deferred++;
    }
  }

  return { processed, deferred };
}
