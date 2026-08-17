/**
 * 统一的北京时间格式化工具。
 *
 * 平台面向国内电子元器件贸易，所有对用户展示的时间都必须是北京时间
 * （Asia/Shanghai，UTC+8），不能随访问者所在时区漂移。
 *
 * 之前各页面直接调用 `toLocaleString("zh-CN")` 而不指定 timeZone，
 * 实际使用的是浏览器本地时区。海外用户或时区设置异常的机器上，
 * 订单时间、消息时间都会显示错误，且与后台记录、微信账单对不上。
 * `zh-CN` 只决定语言与格式习惯，**不决定时区**，这是该类问题的共同根因。
 *
 * 本模块把时区固定为 Asia/Shanghai，并统一输出格式，
 * 所有前后端展示用时间格式化都应经由这里。
 *
 * 【双仓一致】本文件与前台仓库 `51dianzi-platform` 的
 * `shared/beijingTime.ts` 保持同名同签名。前台已于早前修复本类问题，
 * 但管理端当时被遗漏，导致后台消息中心等页面的时间
 * 仍随访问者电脑的时区设置漂移。修改时请同步两仓，避免口径再次分岔。
 */

/** 平台统一业务时区。所有面向用户的时间展示都以此为准。 */
export const BEIJING_TIME_ZONE = "Asia/Shanghai";

/** 平台统一显示语言标签。 */
const LOCALE = "zh-CN";

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 只显示时分，用于聊天气泡等空间紧凑的位置。
 * @example formatBeijingTime("2026-08-13T01:50:36Z") // "09:50"
 */
export function formatBeijingTime(
  value: Date | string | number | null | undefined,
): string {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleTimeString(LOCALE, {
    timeZone: BEIJING_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 只显示日期，默认零填充的 `YYYY-MM-DD`。
 * @example formatBeijingDate("2026-08-13T01:50:36Z") // "2026-08-13"
 */
export function formatBeijingDate(
  value: Date | string | number | null | undefined,
): string {
  const date = toDate(value);
  if (!date) return "";
  return date
    .toLocaleDateString(LOCALE, {
      timeZone: BEIJING_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/\//g, "-");
}

/**
 * 只显示月日，用于图表坐标轴等需要短标签的位置。
 * @example formatBeijingMonthDay("2026-08-13T01:50:36Z") // "08-13"
 */
export function formatBeijingMonthDay(
  value: Date | string | number | null | undefined,
): string {
  const date = toDate(value);
  if (!date) return "";
  return date
    .toLocaleDateString(LOCALE, {
      timeZone: BEIJING_TIME_ZONE,
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/\//g, "-");
}

/**
 * 日期加时分，用于订单列表、审核记录等需要精确时刻的位置。
 * 统一输出 `YYYY-MM-DD HH:mm`，避免各页面出现斜杠与横线混用。
 * @example formatBeijingDateTime("2026-08-13T01:50:36Z") // "2026-08-13 09:50"
 */
export function formatBeijingDateTime(
  value: Date | string | number | null | undefined,
): string {
  const date = toDate(value);
  if (!date) return "";
  const datePart = formatBeijingDate(date);
  const timePart = formatBeijingTime(date);
  return `${datePart} ${timePart}`;
}

/**
 * 日期加时分秒，用于物流轨迹等需要秒级精度的位置。
 * @example formatBeijingDateTimeWithSeconds("2026-08-13T01:50:36Z")
 *          // "2026-08-13 09:50:36"
 */
export function formatBeijingDateTimeWithSeconds(
  value: Date | string | number | null | undefined,
): string {
  const date = toDate(value);
  if (!date) return "";
  const datePart = formatBeijingDate(date);
  const timePart = date.toLocaleTimeString(LOCALE, {
    timeZone: BEIJING_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart}`;
}

/**
 * 用于文件名的紧凑日期，无分隔符。
 * @example formatBeijingDateCompact("2026-08-13T01:50:36Z") // "20260813"
 */
export function formatBeijingDateCompact(
  value: Date | string | number | null | undefined,
): string {
  return formatBeijingDate(value).replace(/-/g, "");
}

/**
 * 聊天会话列表用的相对时间：
 * 当天显示时分，昨天显示「昨天」，今年内显示月日，跨年显示完整日期。
 *
 * 判断"是否同一天"必须在北京时区下比较，不能用本地的 getDate()，
 * 否则跨时区访问会把昨天的消息判成今天。
 */
export function formatBeijingRelativeTime(
  value: Date | string | number | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return "";

  const dayOf = (d: Date) => formatBeijingDate(d);
  const target = dayOf(date);
  const today = dayOf(now);
  if (target === today) return formatBeijingTime(date);

  const yesterday = dayOf(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (target === yesterday) return "昨天";

  // 同年只显示月日，跨年才显示年份，节省列表横向空间
  if (target.slice(0, 4) === today.slice(0, 4)) return target.slice(5);
  return target;
}

/**
 * 取北京时区下的年、月、日数值，用于需要参与计算（而非直接展示）的场景。
 *
 * 必须经由本函数而不能用 `date.getFullYear()` 等本地时区方法，
 * 否则访问者时区异常时会在跳日边界得到错位的日期。
 *
 * @example getBeijingDateParts("2026-08-17T16:24:59Z") // { year: 2026, month: 8, day: 18 }
 */
export function getBeijingDateParts(
  value: Date | string | number | null | undefined,
): { year: number; month: number; day: number } | null {
  const date = toDate(value);
  if (!date) return null;
  // en-CA 固定输出 YYYY-MM-DD，无需再处理分隔符差异
  const parts = date.toLocaleDateString("en-CA", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [yearStr, monthStr, dayStr] = parts.split("-");
  return {
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
  };
}
