/**
 * 搜索智能排名算法。
 *
 * 综合排序（sort=default）不再按发布时间倒序，而是对每条报价计算 0~100 的加权得分：
 *   明价优势 58 + 刷新新鲜度 29 + 平台成交 7 + 商户资历 6 = 100
 *
 * 得分之外还有三道独立的约束，优先级高于得分本身：
 *   1. 相关度分层（relevanceTier）：精确命中型号 > 前缀命中 > 包含命中 > 其他字段命中；
 *      经核验的完整包装型号配对同属精确命中层。跨层不允许用得分翻盘，
 *      避免"高分杂牌"挤掉用户真正搜的型号。
 *   2. 异常低价压制（suspiciousPrice）：同型号有 3 家以上报价、且本条低于组内均价一半时，
 *      整条沉到同层末尾。这类报价多为钓鱼或录错单位，直接给流量会伤害买家。
 *   3. 精确刷新时间：综合得分相同时，最近刷新库存优先。
 *   4. 每日轮转平票（tieHash）：综合分与精确刷新时间均相同时，按
 *      SHA2(当天日期:id) 排序，每天顺序不同，避免小 id 商户长期霸占首屏。
 *
 * 最后再做多样性重排（diversifyTopChannels），限制单一供应商在头部的占比。
 *
 * 空关键词默认读取数据通价值快照：先按参考价优势分层，再按每家 2 条一轮
 * 进行跨页稳定轮转；可疑价格保留内部标记但不隐藏、不降级。
 */

/**
 * 搜索排序统一使用 13% 增值税口径比较价格。
 * 页面仍展示供应商填写的原始含税/未税价，本常量只影响排序内部比较。
 */
export const STANDARD_VAT_RATE = 0.13;
export const UNTAXED_TO_TAX_INCLUDED_MULTIPLIER = 1 + STANDARD_VAT_RATE;

export function toTaxIncludedComparisonPrice(
  price: number | string | null | undefined,
  taxIncluded: boolean,
) {
  const numericPrice = Number(price ?? 0);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) return null;
  return taxIncluded
    ? numericPrice
    : numericPrice * UNTAXED_TO_TAX_INCLUDED_MULTIPLIER;
}

/** 明价优势权重：价格是采购决策的第一因子，占比最高。 */
export const PRICE_WEIGHT = 58;
/** 刷新新鲜度权重：久未刷新的库存往往已售罄，报价可信度随时间衰减。 */
export const FRESHNESS_WEIGHT = 29;
/** 平台成交权重：已完成订单数。 */
export const TRADE_WEIGHT = 7;
/** 商户资历权重：首次获准经营至今的时长。 */
export const TENURE_WEIGHT = 6;

/**
 * 价格衰减半衰期（相对最低价的溢价比例）。
 * 0.1 表示比最低价高 10% 得一半分，高 20% 得四分之一分，衰减陡峭以突出真实低价。
 */
export const PRICE_HALF_LIFE = 0.1;

/** 成交数饱和点：50 单达到满分，采用对数曲线避免大商户无限碾压。 */
export const TRADE_SATURATION_COUNT = 50;

/** 空搜索每轮每家最多进入 2 条，跨页稳定轮转，避免一次批量刷新占满多页。 */
export const EMPTY_BROWSE_SUPPLIER_BATCH_SIZE = 2;

/** 多样性重排作用范围：仅对前 20 条生效，深翻页不干预。 */
export const DIVERSITY_TOP_LIMIT = 20;
/** 单一供应商在已选结果中的最大占比。 */
export const DIVERSITY_MAX_SHARE = 0.4;
/** 允许为多样性让位的最大得分差；超过此差距则不牺牲相关性。 */
export const DIVERSITY_SCORE_TOLERANCE = 5;

/** 参与多样性重排的最小行结构。 */
export type DiversifiableRow = {
  supplierId: number;
  rankingScore: number;
};

export type DiversifyOptions = {
  limit?: number;
  maxShare?: number;
  scoreTolerance?: number;
};

/**
 * 头部结果供应商多样性重排。
 *
 * 输入必须是已按最终顺序排好的数组。逐位挑选时，若当前最优行所属供应商在已选结果中
 * 的数量已达配额，则在"得分差不超过 scoreTolerance"的范围内向后找一个不同供应商的行
 * 顶上；找不到就仍取最优行（宁可重复，也不放弃相关性）。
 * 超出 limit 的部分保持原顺序追加。
 */
export function diversifyTopChannels<T extends DiversifiableRow>(
  sorted: T[],
  options: DiversifyOptions = {}
): T[] {
  const limit = options.limit ?? DIVERSITY_TOP_LIMIT;
  const maxShare = options.maxShare ?? DIVERSITY_MAX_SHARE;
  const scoreTolerance = options.scoreTolerance ?? DIVERSITY_SCORE_TOLERANCE;
  if (sorted.length <= 1 || limit <= 1) return [...sorted];

  const remaining = [...sorted];
  const selected: T[] = [];
  const supplierCounts = new Map<number, number>();

  while (remaining.length && selected.length < limit) {
    // 配额随已选数量增长，保证前几位不会因为向上取整被过度限制
    const maxAllowed = Math.max(1, Math.ceil((selected.length + 1) * maxShare));
    const bestRemainingScore = remaining[0].rankingScore;
    let candidateIndex = remaining.findIndex(candidate => {
      const count = supplierCounts.get(candidate.supplierId) ?? 0;
      return candidate.rankingScore >= bestRemainingScore - scoreTolerance && count < maxAllowed;
    });
    if (candidateIndex < 0) candidateIndex = 0;
    const [candidate] = remaining.splice(candidateIndex, 1);
    selected.push(candidate);
    supplierCounts.set(candidate.supplierId, (supplierCounts.get(candidate.supplierId) ?? 0) + 1);
  }

  return selected.concat(remaining);
}

export type RecommendationReasonInput = {
  hasPrice: boolean;
  priceComponent: number;
  freshnessComponent: number;
  completedTradeCount: number;
  tenureDays: number;
};

/**
 * 生成前台展示的推荐理由标签（最多 3 条）。
 *
 * 阈值取得偏保守：只有明显达标才打标签，避免标签泛滥失去区分度。
 * 公开评价只负责真实展示，不打星、不参与排序，也不生成推荐理由。
 */
export function buildRecommendationReasons(input: RecommendationReasonInput): string[] {
  const reasons: string[] = [];
  if (input.hasPrice && input.priceComponent >= PRICE_WEIGHT * 0.85) {
    reasons.push("明价优势");
  }
  if (input.freshnessComponent >= FRESHNESS_WEIGHT * 0.8) {
    reasons.push("近期刷新");
  }
  if (input.completedTradeCount >= 5) reasons.push("平台成交良好");
  if (input.tenureDays >= 180) reasons.push("持续经营");
  return reasons.slice(0, 3);
}
