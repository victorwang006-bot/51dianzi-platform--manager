/**
 * 退款服务层：金额计算、渠道退款执行、状态流转。
 *
 * 设计原则：
 * 1. 金额一律由本模块计算，接口层与前端都不得传入金额，否则买家可篡改退款金额。
 * 2. 所有资金动作幂等：退款单号即渠道 out_refund_no，重复提交渠道不会二次退款。
 * 3. 库存回补以 stockRestored 标记保护，避免重试导致在售库存虚增。
 */
import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  orderRefunds,
  orders,
  paymentBatchOrders,
  paymentBatches,
  type Order,
  type OrderRefund,
  type RefundStatus,
} from "../../drizzle/schema";
import { restoreInventoryStockForOrders } from "./inventoryStock";
import {
  getWechatGateway,
  safeWechatError,
  WechatConfigurationError,
  WechatRequestError,
} from "./wechatGateway";

/** 未发货订单自动通过退款的等待时长（用户确认：24 小时）。 */
export const REFUND_AUTO_APPROVE_HOURS = 24;

/** 已完成订单的售后申请期限（用户确认：收货后 7 天）。 */
export const REFUND_AFTER_SALES_DAYS = 7;

/** 物流签收后自动确认收货的等待天数（用户确认：7 天）。 */
export const AUTO_CONFIRM_RECEIPT_DAYS = 7;

/**
 * 渠道退款最大尝试次数。超过后转 manual_review 等人工处理，
 * 而不是无限重试——退款接口每次调用都可能产生真实资金动作，
 * 无限重试在渠道侧异常时会掩盖问题。
 */
export const REFUND_MAX_ATTEMPTS = 5;

export class RefundError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RefundError";
    this.code = code;
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toMoney(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export type RefundAmountBreakdown = {
  /** 实退总额 */
  refundAmount: string;
  /** 退还的货款（含其对应税额） */
  goodsAmount: string;
  /** 退还的运费 */
  shippingFee: string;
  /** 是否因已发货而扣除运费，用于向买家解释金额 */
  shippingDeducted: boolean;
};

/**
 * 计算退款金额。
 *
 * 运费策略（用户确认方案 A）：
 * - 未发货：全额退还，含运费。运费尚未实际产生。
 * - 已发货：只退货款及其税额，运费不退。运费已被承运商收取，
 *   平台或卖家已实际支出，退还等于让卖家承担买家的反悔成本。
 *
 * 税额说明：全站价格口径为**含税价**，订单的 amountEx / taxAmount 是对
 * 含税货款做价内税拆分的结果，两者相加即等于买家实付的含税货款，
 * 故退货款时仍需两者相加，运费不含税。
 *
 * 关于 item 参数：预留给将来的部分退款。传入具体商品项时按该项金额计算，
 * 不传则为整单退款。运费在部分退款场景一律不退——只退其中一项时，
 * 整单运费仍然实际发生。
 */
export function calcRefundAmount(
  order: Pick<Order, "amountEx" | "taxAmount" | "shippingFee" | "totalAmount">,
  opts: {
    shipped: boolean;
    /** 预留：部分退款时传入该商品项的**含税**小计与数量占比 */
    item?: { subtotal: string | number; refundQty: number; totalQty: number } | null;
  },
): RefundAmountBreakdown {
  const orderShipping = round2(toMoney(order.shippingFee));

  // 部分退款：按商品项**含税**小计按数量占比计算货款，运费不退。
  //
  // order_items.subtotal 已为含税小计，直接按比例切分即为应退货款；
  // 若再乘 1.13 会退多，若取拆分后的未税额则会退少。
  if (opts.item) {
    const { subtotal, refundQty, totalQty } = opts.item;
    if (refundQty <= 0 || totalQty <= 0 || refundQty > totalQty) {
      throw new RefundError("INVALID_REFUND_QTY", "退货数量无效");
    }
    const goods = round2((toMoney(subtotal) * refundQty) / totalQty);
    return {
      refundAmount: goods.toFixed(2),
      goodsAmount: goods.toFixed(2),
      shippingFee: "0.00",
      shippingDeducted: orderShipping > 0,
    };
  }

  // 整单退款
  if (opts.shipped) {
    const goods = round2(toMoney(order.amountEx) + toMoney(order.taxAmount));
    return {
      refundAmount: goods.toFixed(2),
      goodsAmount: goods.toFixed(2),
      shippingFee: "0.00",
      shippingDeducted: orderShipping > 0,
    };
  }

  // 未发货全额退。以 totalAmount 为准而非重新累加，
  // 避免历史订单金额构成与当前计算规则不一致时出现分币差异。
  const total = round2(toMoney(order.totalAmount));
  const goods = round2(total - orderShipping);
  return {
    refundAmount: total.toFixed(2),
    goodsAmount: goods.toFixed(2),
    shippingFee: orderShipping.toFixed(2),
    shippingDeducted: false,
  };
}

/** 生成退款单号，同时作为渠道 out_refund_no。 */
export function buildRefundNo(orderId: number, now = new Date()): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  // 订单号 + 时间戳足以保证唯一；orderId 便于人工从退款单号反查订单
  return `RF${stamp}${pad(orderId, 6)}`;
}

/**
 * 判断已完成订单是否仍在售后期内。
 * doneAt 为空时（历史数据缺失）按 createdAt 兜底，避免旧订单永久可退。
 */
export function isWithinAfterSalesWindow(
  order: Pick<Order, "status" | "doneAt" | "createdAt">,
  now = new Date(),
): boolean {
  if (order.status !== "done") return true;
  const base = order.doneAt ? new Date(order.doneAt) : new Date(order.createdAt);
  if (Number.isNaN(base.getTime())) return false;
  const deadline = base.getTime() + REFUND_AFTER_SALES_DAYS * 24 * 60 * 60 * 1000;
  return now.getTime() <= deadline;
}

/**
 * 校验支付批次的累计退款不超过批次总额。
 *
 * 这是资金安全的核心校验：一个支付批次（一个渠道交易号）可关联多张拆分订单，
 * 每张订单各自申请退款时都是渠道侧的部分退款。若不校验累计值，
 * 多笔部分退款累加可能超过实付金额，造成资金损失与对账混乱。
 *
 * 只统计未失败的退款单（排除 rejected/failed），因为这些不会实际出款。
 */
export async function assertBatchRefundWithinLimit(
  paymentBatchId: number,
  incomingAmount: string,
  excludeRefundId?: number,
) {
  const db = await getDb();
  if (!db) throw new RefundError("DB_UNAVAILABLE", "数据库不可用");
  const batch = await db
    .select({ amount: paymentBatches.amount })
    .from(paymentBatches)
    .where(eq(paymentBatches.id, paymentBatchId))
    .limit(1);
  if (!batch.length) {
    throw new RefundError("PAYMENT_BATCH_NOT_FOUND", "找不到对应的支付批次");
  }

  const conditions = [
    eq(orderRefunds.paymentBatchId, paymentBatchId),
    inArray(orderRefunds.status, [
      "requested",
      "awaiting_return",
      "approved",
      "processing",
      "succeeded",
      "pending_offline",
      "manual_review",
    ] as RefundStatus[]),
  ];
  if (excludeRefundId) conditions.push(ne(orderRefunds.id, excludeRefundId));

  const existing = await db
    .select({ refundAmount: orderRefunds.refundAmount })
    .from(orderRefunds)
    .where(and(...conditions));

  const already = existing.reduce(
    (sum: number, row: { refundAmount: string }) => sum + toMoney(row.refundAmount),
    0,
  );
  const next = round2(already + toMoney(incomingAmount));
  const limit = round2(toMoney(batch[0].amount));

  // 允许 1 分钱的浮点容差，避免因分币舍入把合法的全额退款判为超额
  if (next > limit + 0.01) {
    throw new RefundError(
      "REFUND_EXCEEDS_BATCH",
      `退款累计金额 ¥${next.toFixed(2)} 已超过支付批次总额 ¥${limit.toFixed(2)}`,
    );
  }
}

/** 查询订单关联的支付批次（微信/支付宝订单才有）。 */
export async function findPaymentBatchForOrder(orderId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      id: paymentBatches.id,
      paymentNo: paymentBatches.paymentNo,
      provider: paymentBatches.provider,
      status: paymentBatches.status,
      amount: paymentBatches.amount,
      providerTradeNo: paymentBatches.providerTradeNo,
    })
    .from(paymentBatchOrders)
    .innerJoin(paymentBatches, eq(paymentBatchOrders.paymentBatchId, paymentBatches.id))
    .where(and(eq(paymentBatchOrders.orderId, orderId), eq(paymentBatches.status, "paid")))
    .limit(1);
  return rows[0] || null;
}

export type ExecuteRefundOutcome = {
  status: RefundStatus;
  providerRefundId?: string | null;
  providerStatus?: string | null;
  errorMessage?: string | null;
};

/**
 * 执行渠道退款。
 *
 * 只负责调用渠道并翻译结果，不做数据库写入——写入由调用方在同一事务里完成，
 * 避免"渠道已退款但本地状态未更新"这类最难排查的资金不一致。
 *
 * 幂等性依赖 refundNo 作为 out_refund_no：即便本函数被重复调用，
 * 渠道也不会二次出款，只会返回原退款单的当前状态。
 */
export async function executeChannelRefund(refund: OrderRefund): Promise<ExecuteRefundOutcome> {
  // 对公转账没有自动退款通道，转人工线下打款
  if (refund.payMethod === "corp") {
    return { status: "pending_offline" };
  }

  // 支付宝退款本轮未接入（生产仅 1 笔已付订单）。
  // 明确转人工而不是静默失败，否则退款单会在队列里无限重试。
  if (refund.payMethod === "alipay") {
    return {
      status: "manual_review",
      errorMessage: "支付宝退款尚未接入，请人工处理",
    };
  }

  if (!refund.paymentBatchId) {
    return { status: "manual_review", errorMessage: "退款单缺少支付批次，无法调用渠道退款" };
  }

  const db = await getDb();
  if (!db) return { status: "failed" as RefundStatus, errorMessage: "数据库不可用" };
  const batch = await db
    .select({
      paymentNo: paymentBatches.paymentNo,
      amount: paymentBatches.amount,
      providerTradeNo: paymentBatches.providerTradeNo,
    })
    .from(paymentBatches)
    .where(eq(paymentBatches.id, refund.paymentBatchId))
    .limit(1);
  if (!batch.length) {
    return { status: "manual_review", errorMessage: "找不到支付批次，无法调用渠道退款" };
  }
  if (!batch[0].providerTradeNo) {
    // 没有渠道交易号说明支付未真正完成，此时退款是危险操作
    return { status: "manual_review", errorMessage: "支付批次缺少渠道交易号，需人工核对" };
  }

  try {
    const gateway = getWechatGateway();
    const result = await gateway.refund({
      refundNo: refund.refundNo,
      paymentNo: batch[0].paymentNo,
      refundAmount: refund.refundAmount,
      // 微信要求传原交易总额，即整个支付批次的金额，而非本订单金额
      totalAmount: batch[0].amount,
      reason: refund.reason,
    });

    if (result.status === "SUCCESS") {
      return {
        status: "succeeded",
        providerRefundId: result.providerRefundId,
        providerStatus: result.status,
      };
    }
    if (result.status === "PROCESSING") {
      return {
        status: "processing",
        providerRefundId: result.providerRefundId,
        providerStatus: result.status,
      };
    }
    // ABNORMAL 通常是商户余额不足或收款账户异常，重试无用且会掩盖问题
    return {
      status: "manual_review",
      providerRefundId: result.providerRefundId,
      providerStatus: result.status,
      errorMessage: `微信退款状态异常：${result.status}`,
    };
  } catch (error) {
    // 配置类错误重试无用（证书缺失、开关未开），直接转人工
    if (error instanceof WechatConfigurationError) {
      return { status: "manual_review", errorMessage: safeWechatError(error).message };
    }
    const safe = safeWechatError(error);
    // 参数类错误重试同样无用，避免无意义地耗尽重试次数
    const permanentCodes = [
      "PARAM_ERROR",
      "REFUND_EXCEEDS_TOTAL",
      "INVALID_REFUND_NO",
      "INVALID_PAYMENT_NO",
      // 余额不足：微信实际返回 NOTENOUGH（无下划线），
      // 文档历史版本也出现过 NOT_ENOUGH，两种写法均纳入。
      // 2026-08-15 生产实测确认为 NOTENOUGH。
      "NOTENOUGH",
      "NOT_ENOUGH",
      "ORDER_NOT_EXIST",
      // 交易不存在、已全额退款：重试永远不会成功
      "RESOURCE_NOT_EXISTS",
      "REFUND_NOT_EXIST",
    ];
    if (error instanceof WechatRequestError && permanentCodes.includes(error.code)) {
      return { status: "manual_review", errorMessage: safe.message };
    }
    // 网络与超时类错误可重试，保持 failed 由 Worker 决定是否再试
    return { status: "failed", errorMessage: safe.message };
  }
}

/**
 * 回补库存（幂等）。
 *
 * 通过 stockRestored 标记 + 条件更新保证只回补一次：
 * 退款可能因渠道异常重试多次，每次都回补会导致在售库存虚增，
 * 卖家库里 10 个而系统显示 30 个，最终引发无法履约的超卖订单。
 */
export async function restoreRefundStock(refundId: number, orderId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  return db.transaction(async tx => {
    /*
     * 原子占位与库存增加必须处于同一事务：否则进程在两步之间退出，会留下
     * stockRestored=true 但库存未增加的永久不一致。
     *
     * 未发货退款可直接回补；已发货退款只有卖家确认退货验收入库后才能回补。
     */
    const claimed = await tx
      .update(orderRefunds)
      .set({ stockRestored: true })
      .where(
        and(
          eq(orderRefunds.id, refundId),
          eq(orderRefunds.stockRestored, false),
          or(
            eq(orderRefunds.shippedWhenRequested, false),
            isNotNull(orderRefunds.returnReceivedAt),
          ),
        ),
      );
    const affected = Number(
      (claimed as unknown as [{ affectedRows?: number }])?.[0]?.affectedRows ?? 0,
    );
    if (affected !== 1) return false;

    await restoreInventoryStockForOrders(tx, [orderId]);
    return true;
  });
}

/** 退款状态的中文展示名，供前端与通知文案统一使用。 */
export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  requested: "退款申请中",
  awaiting_return: "待买家退货",
  approved: "退款已通过",
  processing: "退款处理中",
  succeeded: "退款成功",
  failed: "退款失败",
  rejected: "退款已驳回",
  pending_offline: "待财务线下打款",
  manual_review: "待人工处理",
};

/** 订单是否已发货（含已完成）。已完成必然经历过发货。 */
export function isOrderShipped(order: Pick<Order, "status" | "expressNo" | "shippedAt">): boolean {
  if (order.status === "shipped" || order.status === "done") return true;
  return Boolean(order.expressNo || order.shippedAt);
}

/**
 * 向渠道查询退款最终结果，用于 processing 状态的兜底对账。
 *
 * 微信退款受理后并非立即完成，回调也可能丢失。若不主动查询，
 * 退款单会永久停在 processing，买家看不到明确结果、财务也无法对账。
 *
 * 返回 null 表示本次无法判定（如渠道暂时不可用），调用方应保持原状态待下轮重试，
 * 绝不可因查询失败就把状态改成失败——钱可能已经退出去了。
 */
export async function queryChannelRefundStatus(
  refund: OrderRefund,
): Promise<ExecuteRefundOutcome | null> {
  // 非微信渠道没有可查询的接口：对公转账靠人工标记，支付宝本轮未接入
  if (refund.payMethod !== "wechat") return null;
  try {
    const gateway = getWechatGateway();
    const result = await gateway.queryRefund(refund.refundNo);
    if (result.status === "SUCCESS") {
      return {
        status: "succeeded",
        providerRefundId: result.providerRefundId,
        providerStatus: result.status,
      };
    }
    if (result.status === "PROCESSING") {
      return {
        status: "processing",
        providerRefundId: result.providerRefundId,
        providerStatus: result.status,
      };
    }
    // CLOSED 表示退款关闭（未实际出款），ABNORMAL 表示资金异常。
    // 两者都必须转人工核实，不能自动判为成功或失败。
    return {
      status: "manual_review",
      providerRefundId: result.providerRefundId,
      providerStatus: result.status,
      errorMessage: `微信退款状态为 ${result.status}，需人工核实`,
    };
  } catch (error) {
    if (error instanceof WechatConfigurationError) {
      return { status: "manual_review", errorMessage: safeWechatError(error).message };
    }
    // 查询失败不改变状态：保持 processing 等下轮重试，
    // 避免把"查不到"误判为"没退成"而重复出款。
    return null;
  }
}
