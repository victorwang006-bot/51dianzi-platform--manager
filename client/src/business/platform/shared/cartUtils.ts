import type { LadderTier } from "../front-router-types/drizzle/schema";

/**
 * 增值税率 13%。
 *
 * 全站价格口径：商家录入的价格即为**含税价**，平台不再在其上叠加税额。
 * 该税率仅用于「价内税拆分」——从含税金额反推未税额与税额，供开票使用，
 * 拆分后两者相加仍等于商家报价，不改变买家实付金额。
 */
export const CART_TAX_RATE = 0.13;
/** 免运费门槛（含税商品金额，与买家所见价格口径一致） */
export const FREE_SHIP_THRESHOLD = 500;
/** 未满门槛的运费 */
export const SHIP_FEE = 15;

function ladderRecords(ladderPrices: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(ladderPrices)) {
    return ladderPrices as Array<Record<string, unknown>>;
  }
  // MySQL 与 MariaDB 驱动对 JSON 列的返回形态不同：生产或测试环境
  // 可能返回已解析数组，也可能返回 JSON 字符串。金额计算必须兼容两者。
  if (typeof ladderPrices === "string" && ladderPrices.length <= 20_000) {
    try {
      const parsed = JSON.parse(ladderPrices);
      return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 标准化阶梯价：兼容 JSON 字符串、{minQty,price} 与 {qty,price} 两种历史格式，并按 minQty 升序 */
export function normalizeLadder(
  ladderPrices: unknown,
  priceEx: number | string | null | undefined,
  moq: number | null | undefined,
): LadderTier[] {
  const records = ladderRecords(ladderPrices);
  if (records.length > 0) {
    const tiers = records
      .map(t => ({
        minQty: Number(t.minQty ?? t.qty),
        price: Number(t.price),
      }))
      .filter(t => Number.isFinite(t.minQty) && Number.isFinite(t.price))
      .sort((a, b) => a.minQty - b.minQty);
    if (tiers.length > 0) return tiers;
  }
  // 供应商未填写阶梯价时，只使用实际填写的单一价格，不自动生成折扣档位
  const base = Number(priceEx ?? 0);
  const m = moq || 1;
  return [{ minQty: m, price: base }];
}

/**
 * 是否存在有效售价：含税单价 > 0，或存在任意 price > 0 的阶梯价档位。
 * 无有效售价的库存视为"价格面议"，前台仅展示"聊一聊"入口，不可加购/下单。
 */
export function hasSellingPrice(
  priceEx: number | string | null | undefined,
  ladderPrices?: unknown,
): boolean {
  const base = Number(priceEx ?? 0);
  if (Number.isFinite(base) && base > 0) return true;
  return ladderRecords(ladderPrices).some(t => {
    const p = Number(t?.price);
    return Number.isFinite(p) && p > 0;
  });
}

/** 按数量取当前生效档位下标 */
export function tierIndexOf(ladder: LadderTier[], qty: number): number {
  let idx = 0;
  ladder.forEach((t, i) => {
    if (qty >= t.minQty) idx = i;
  });
  return idx;
}

/** 按数量取阶梯含税单价 */
export function unitPriceOf(ladder: LadderTier[], qty: number): number {
  return ladder[tierIndexOf(ladder, qty)]?.price ?? 0;
}

/** 下一档提示（若存在数量更高的更优档位） */
export function nextTierOf(ladder: LadderTier[], qty: number): LadderTier | null {
  return ladder.find(t => t.minQty > qty) ?? null;
}

export type CartCalcItem = { qty: number; unitPrice: number };
export type DeliveryMethod = "express" | "pickup";

/**
 * 金额汇总。
 *
 * 单价为**含税价**，因此货款直接是「单价 × 数量」，不再叠加税额。
 * 返回的 `amountEx` 与 `tax` 是对含税货款做**价内税拆分**的结果，
 * 仅用于订单详情与出库单的税额栏、以及开具增值税专票，
 * 恒满足 `amountEx + tax === 含税货款`，故买家实付金额不受拆分影响。
 *
 * 运费按**含税货款**判定免运费门槛，与买家所见价格口径保持一致。
 */
export function calcSummary(
  items: CartCalcItem[],
  deliveryMethod: DeliveryMethod = "express",
) {
  let goodsIncl = 0;
  let totalQty = 0;
  for (const it of items) {
    goodsIncl += it.unitPrice * it.qty;
    totalQty += it.qty;
  }
  goodsIncl = round2(goodsIncl);
  // 价内税拆分：未税额 = 含税额 / 1.13，税额取差值以保证两者相加分毫不差
  const amountEx = round2(goodsIncl / (1 + CART_TAX_RATE));
  const tax = round2(goodsIncl - amountEx);
  const shipping =
    items.length === 0 || deliveryMethod === "pickup"
      ? 0
      : goodsIncl >= FREE_SHIP_THRESHOLD
        ? 0
        : SHIP_FEE;
  const total = round2(goodsIncl + shipping);
  return { goodsIncl, amountEx, tax, shipping, total, totalQty, kinds: items.length };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 数量步进步长：moq>=100→100, moq>=10→10, 否则1（与原型一致） */
export function stepOf(moq: number | null | undefined): number {
  const m = moq || 1;
  return m >= 100 ? 100 : m >= 10 ? 10 : 1;
}

/** 生成订单号：DZ + YYYYMMDD + "-" + 5位随机数字 */
export function genOrderNo(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 90000) + 10000);
  return `DZ${y}${m}${d}-${rand}`;
}

/** 订单状态元信息 */
export const ORDER_STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  pending: { label: "待付款", className: "st-pending" },
  paid: { label: "待发货", className: "st-paid" },
  shipped: { label: "已发货", className: "st-shipped" },
  done: { label: "已完成", className: "st-done" },
  refund: { label: "退款/售后", className: "st-refund" },
  cancel: { label: "已取消", className: "st-cancel" },
  /**
   * 退款已完成的终态。与 refund（处理中）分开展示，
   * 否则买家钱已退回却仍看到"退款/售后"，会重复咨询客服。
   */
  refunded: { label: "已退款", className: "st-refunded" },
};

/** 付款方式元信息 */
export const PAY_METHODS = [
  {
    key: "corp",
    name: "对公转账",
    desc: "企业网银汇款，支持开具 13% 增值税专票",
  },
  {
    key: "alipay",
    name: "支付宝",
    desc: "企业/个人支付宝均可，即时到账",
  },
  {
    key: "wechat",
    name: "微信支付",
    desc: "扫码支付，适合小额快速下单",
  },
] as const;
export type PayMethodKey = (typeof PAY_METHODS)[number]["key"];
