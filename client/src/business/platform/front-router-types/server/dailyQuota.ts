/**
 * 账户级每日查询配额。
 *
 * 背景：`antiScrape.ts` 的匿名限频只对未登录请求生效，登录后完全放行。
 * 因此批量注册小号即可持续拉取库存与报价数据 —— 这是当前最易被利用的口子。
 *
 * 配额口径（用户 2026-08-18 确认）：
 * - 每账号每日 500 次，搜索与 BOM 配单共用同一账本
 * - BOM 按「配单次数」计费：一次上传算 1 次，不按行数。
 *   若按行计数，上传一张 300 行的 BOM 就吃掉 60% 配额、两张表封顶，
 *   正常采购员完全无法使用 —— 而 BOM 配单恰是平台希望用户多用的核心功能。
 *   爬虫想借 BOM 接口取数，每次也只能拿一张表的量，且同受总配额约束。
 * - 北京时间零点重置。不能用 UTC 零点：那对应北京时间早上 8 点，
 *   会把重置点切在工作时间开始处，用户上午刚开工就遇到额度未清的怪状态。
 *
 * 商业数据读使用现有 MySQL 原子限流桶跨 PM2 实例共享；依赖不可用时
 * 拒绝精确读取，不降级为进程内配额。下方同步计数器仅供旧版单元测试。
 */

import { DAILY_QUOTA_ERR_MSG } from "../../shared/const";
import { getStrictSharedRateLimitStore } from "./rateLimitStore";

export { DAILY_QUOTA_ERR_MSG };

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

/** 每账号每日查询次数上限（搜索 + BOM 配单合计） */
export const DAILY_QUERY_QUOTA = num(process.env.DAILY_QUERY_QUOTA, 500);



type DayBucket = { count: number; day: string };

const quotaBuckets = new Map<number, DayBucket>();

/**
 * 取北京时间的日期字符串（YYYY-MM-DD），作为配额账本的分桶键。
 * 项目统一以北京时间为准（见 shared/beijingTime.ts）。
 */
export function beijingDayKey(now: Date = new Date()): string {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return beijing.toISOString().slice(0, 10);
}

/**
 * 一账号一北京时间自然日的原子预算：日键隔离午夜前后，24h 桶寿命
 * 确保当天首次读取无论发生在几点都不会提前重置。
 */
export async function sharedDailyQuotaExceeded(userId: number, now: Date = new Date()): Promise<boolean> {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new RangeError("invalid user id");
  const key = `exact-read:v1:${beijingDayKey(now)}:${userId}`;
  const count = await getStrictSharedRateLimitStore().increment(key, 24 * 60 * 60 * 1000, now.getTime());
  return count > DAILY_QUERY_QUOTA;
}

/**
 * 记录一次查询并判断是否超限。
 * 返回 true 表示已超出当日配额，调用方应拒绝本次请求。
 */
export function dailyQuotaExceeded(userId: number, now: Date = new Date()): boolean {
  const day = beijingDayKey(now);
  const bucket = quotaBuckets.get(userId);
  if (!bucket || bucket.day !== day) {
    quotaBuckets.set(userId, { count: 1, day });
    return 1 > DAILY_QUERY_QUOTA;
  }
  bucket.count += 1;
  return bucket.count > DAILY_QUERY_QUOTA;
}

/** 查询当前已用次数（不计数；供剩余额度展示或排查使用） */
export function dailyQuotaUsed(userId: number, now: Date = new Date()): number {
  const bucket = quotaBuckets.get(userId);
  if (!bucket || bucket.day !== beijingDayKey(now)) return 0;
  return bucket.count;
}

/**
 * 清理非当日账本，防内存膨胀。
 * 活跃用户数可能很大，不清理会让 Map 无上限增长。
 */
function sweep(now: Date = new Date()) {
  const day = beijingDayKey(now);
  quotaBuckets.forEach((bucket, userId) => {
    if (bucket.day !== day) quotaBuckets.delete(userId);
  });
}

setInterval(() => sweep(), 30 * 60 * 1000).unref?.();

/** 测试辅助：清空配额账本 */
export function __resetQuota() {
  quotaBuckets.clear();
}
