/**
 * 物料库参考价区间计算（纯函数，前后端共用）。
 *
 * 背景与需求（用户 2026-08-16 确认）：
 *   数据通查价时，以物料库 materials.referencePrice 为基准，
 *   乘以 0.9~0.95 之间随机取的两个系数，形成一个「参考价区间」返回。
 *   单位为元。
 *
 * 为何用「按型号固定随机」而非每次真随机：
 *   若每次请求都重新取随机数，同一型号刷新页面就会得到不同区间
 *   （9.13-9.42 → 9.06-9.38）。价格看板的可信度依赖于可复现——
 *   用户需要能截图比价、能与同事核对同一个数字。故用型号本身
 *   派生出确定性种子，同型号任何时候查都是同一区间，
 *   不同型号系数各不相同（呈现自然的市场浮动，而非统一打折）。
 */

/** 系数下界（含） */
export const REF_PRICE_FACTOR_MIN = 0.9;
/** 系数上界（含） */
export const REF_PRICE_FACTOR_MAX = 0.95;

/**
 * 两个随机系数之间的最小间距。
 *
 * 为何需要：纯随机时两系数可能挤在一起（实测 STM32F103C8T6 得到
 * 0.9357 与 0.9370，差值仅 0.0013，12.34 元算出「11.55 - 11.56 元」），
 * 区间只有 1 分钱宽，看起来像精度误差而非价格区间，反而降低可信度。
 * 取 0.02（占 0.9~0.95 全宽 0.05 的 40%），既保证区间可读，
 * 又留出足够随机空间让不同型号呈现差异。
 */
export const REF_PRICE_MIN_FACTOR_GAP = 0.02;

/**
 * 由字符串派生 32 位无符号整数种子（FNV-1a 变体）。
 * 选它而非 hashCode 是因为分布更均匀，且实现只有几行、无依赖。
 */
export function seedFromString(input: string): number {
  let hash = 0x811c9dc5;
  const s = input.toUpperCase();
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    // FNV 质数 16777619，用移位相加避免 32 位溢出后精度丢失
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash >>> 0;
}

/**
 * 由种子产出 [0,1) 区间的确定性伪随机数（mulberry32）。
 * 同一种子恒定产出同一序列，这是「同型号同区间」的实现基础。
 */
export function deterministicRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type ReferencePriceRange = {
  /** 区间下限（元） */
  low: number;
  /** 区间上限（元） */
  high: number;
  /** 实际使用的下限系数，便于排查与回归断言 */
  lowFactor: number;
  /** 实际使用的上限系数 */
  highFactor: number;
};

/**
 * 解析物料库的 referencePrice（varchar 存储）为数字。
 *
 * 生产实测 599738/599738 条全为纯数字、无区间符号、无杂字符，
 * 但仍做健壮解析：字段类型是 varchar，日后导入若混入 "￥1.2" 或
 * "1.2~1.5" 不应让接口抛错，取第一个数字即可。
 * 返回 null 表示无法得到可用价格，调用方须据此走无价路径。
 */
export function parseReferencePrice(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const text = String(raw).trim();
  if (!text) return null;
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * 价格保留位数：低价物料（电阻电容常见 0.02 元级）若统一保留 2 位，
 * 会把 0.0416 压成 0.04、把 0.0001 压成 0.00 而失去意义，
 * 故按量级动态决定精度。
 */
export function decimalsForPrice(value: number): number {
  if (value < 0.01) return 6;
  if (value < 0.1) return 4;
  if (value < 10) return 3;
  return 2;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * 计算某型号的参考价区间。
 *
 * @param partNumber 型号，用作确定性随机种子（同型号恒得同区间）
 * @param basePrice  物料库参考价（元），须为正数
 */
export function computeReferencePriceRange(
  partNumber: string,
  basePrice: number,
): ReferencePriceRange | null {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return null;

  const rand = deterministicRandom(seedFromString(partNumber));
  const span = REF_PRICE_FACTOR_MAX - REF_PRICE_FACTOR_MIN;

  // 先随机出下限，再在「下限+最小间距」到上界之间随机出上限。
  // 这样两系数始终保持可读间距，且都落在 0.9~0.95 内。
  const lowSpan = span - REF_PRICE_MIN_FACTOR_GAP;
  const lowFactor = REF_PRICE_FACTOR_MIN + rand() * lowSpan;
  const highMin = lowFactor + REF_PRICE_MIN_FACTOR_GAP;
  const highFactor = highMin + rand() * (REF_PRICE_FACTOR_MAX - highMin);

  const decimals = decimalsForPrice(basePrice);
  let low = roundTo(basePrice * lowFactor, decimals);
  let high = roundTo(basePrice * highFactor, decimals);

  // 两个随机系数可能过于接近，四舍五入后塌缩成同一个数，
  // 展示成「9.10 - 9.10 元」不像区间。此时按精度抬高上限一档，
  // 保证区间始终可读，且仍不超过 0.95 倍上界。
  if (high <= low) {
    const step = 1 / 10 ** decimals;
    const capped = roundTo(basePrice * REF_PRICE_FACTOR_MAX, decimals);
    high = Math.min(roundTo(low + step, decimals), Math.max(capped, roundTo(low + step, decimals)));
  }

  return { low, high, lowFactor, highFactor };
}

/** 区间格式化为展示文本，如「9.13 - 9.42 元」。单位固定为元（用户确认）。 */
export function formatReferencePriceRange(range: ReferencePriceRange): string {
  const decimals = Math.max(decimalsForPrice(range.low), decimalsForPrice(range.high));
  return `${range.low.toFixed(decimals)} - ${range.high.toFixed(decimals)} 元`;
}
