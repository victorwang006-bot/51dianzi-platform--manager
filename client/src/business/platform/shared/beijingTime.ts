/**
 * 统一的北京时间格式化工具。
 *
 * 平台面向国内电子元器件贸易，所有对用户展示的时间都必须是北京时间
 * （Asia/Shanghai，UTC+8），不能随访问者所在时区漂移。
 *
 * 之前各页面直接调用 `toLocaleString("zh-CN")` 而不指定 timeZone，
 * 实际使用的是浏览器本地时区。海外用户或时区设置异常的机器上，
 * 订单时间、消息时间都会显示错误，且与后台记录、微信账单对不上。
 *
 * 本模块把时区固定为 Asia/Shanghai，并统一输出格式，
 * 所有前后端展示用时间格式化都应经由这里。
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
 * 聊天记录中的居中时间分隔：今天显示时分，昨天带时分，最近七天显示星期，
 * 今年更早显示月日，跨年显示完整年月日；所有判断固定使用北京时间。
 */
export function formatBeijingChatTime(
  value: Date | string | number | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (!date) return "";
  const target = formatBeijingDate(date);
  const today = formatBeijingDate(now);
  const time = formatBeijingTime(date);
  const targetDay = Date.parse(`${target}T00:00:00Z`);
  const todayDay = Date.parse(`${today}T00:00:00Z`);
  const dayDiff = Math.round((todayDay - targetDay) / (24 * 60 * 60 * 1_000));

  if (dayDiff === 0) return time;
  if (dayDiff === 1) return `昨天 ${time}`;
  if (dayDiff > 1 && dayDiff < 7) {
    const weekday = new Intl.DateTimeFormat(LOCALE, {
      timeZone: BEIJING_TIME_ZONE,
      weekday: "long",
    }).format(date);
    return `${weekday} ${time}`;
  }
  if (target.slice(0, 4) === today.slice(0, 4)) {
    const [, month, day] = target.split("-");
    return `${Number(month)}月${Number(day)}日 ${time}`;
  }
  const [year, month, day] = target.split("-");
  return `${year}年${Number(month)}月${Number(day)}日 ${time}`;
}

/** 微信式聊天时间分隔：首条、跨北京自然日或距离上一条至少5分钟时显示。 */
export function shouldShowBeijingChatTime(
  current: Date | string | number | null | undefined,
  previous?: Date | string | number | null,
  gapMs = 5 * 60 * 1_000,
): boolean {
  const currentDate = toDate(current);
  if (!currentDate) return false;
  const previousDate = toDate(previous);
  if (!previousDate) return true;
  if (formatBeijingDate(currentDate) !== formatBeijingDate(previousDate)) return true;
  return currentDate.getTime() - previousDate.getTime() >= gapMs;
}

/**
 * 以「N月第M周」表述数据时效，用于 AI 行情参考价等需要标注数据新鲜度的位置。
 *
 * 为什么必须动态计算：
 * AI 联网检索的行情数据本身有滞后性，必须向买家标注时效，否则买家会误以为
 * 是实时价格，据此谈判后发现价差会产生纠纷。但若把时效写成固定文案
 * （例如硬编码「8月1日-8月8日」），到了下个月仍显示上月，反而比不标注
 * 更容易误导——这正是搜索页此前存在的问题。
 *
 * 周次划分按自然月内的日期区间：1-7 日第一周，8-14 日第二周，
 * 15-21 日第三周，22 日及之后归入第四周（含月末 8-10 天）。
 * 不采用 ISO 周号，因为跨月的 ISO 周对普通用户不直观。
 *
 * @example formatBeijingDataPeriod("2026-08-16") // "8月第三周数据"
 */
export function formatBeijingDataPeriod(
  value?: Date | string | number | null,
): string {
  const date = toDate(value ?? new Date()) ?? new Date();
  // 必须取北京时间的月份与日号，不能用本地时区的 getMonth/getDate，
  // 否则海外访问者在月初或月末会看到错位的周次。
  const parts = date.toLocaleDateString("en-CA", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [, monthStr, dayStr] = parts.split("-");
  const month = Number(monthStr);
  const day = Number(dayStr);
  const weekIndex = day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4;
  const weekLabel = ["", "一", "二", "三", "四"][weekIndex];
  return `${month}月第${weekLabel}周数据`;
}
