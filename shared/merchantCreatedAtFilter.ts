import { getBeijingDateParts } from "./beijingTime";

export const MERCHANT_CREATED_AT_PRESETS = [
  "today",
  "last7Days",
  "last30Days",
  "thisMonth",
  "custom",
] as const;

export type MerchantCreatedAtPreset = typeof MERCHANT_CREATED_AT_PRESETS[number];

export type MerchantCreatedAtFilterInput = {
  createdAtPreset?: MerchantCreatedAtPreset;
  createdFrom?: string;
  createdTo?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function beijingDayStart(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - BEIJING_OFFSET_MS);
}

function parseBeijingDayStart(value: string): Date {
  if (!isValidCalendarDate(value)) throw new Error("INVALID_MERCHANT_CREATED_DATE");
  const [year, month, day] = value.split("-").map(Number);
  return beijingDayStart(year, month, day);
}

/**
 * 把商户页时间筛选转换为 [from, to) 的 UTC 时刻。
 * 所有“天”均以北京时间自然日为边界，而非服务器本地时区或滚动 24 小时。
 */
export function resolveMerchantCreatedAtBounds(
  input: MerchantCreatedAtFilterInput,
  now: Date = new Date(),
): { from: Date; to: Date } | null {
  const preset = input.createdAtPreset;
  if (!preset) return null;

  if (preset === "custom") {
    if (!input.createdFrom || !input.createdTo) throw new Error("MERCHANT_CREATED_RANGE_REQUIRED");
    if (!isValidCalendarDate(input.createdFrom) || !isValidCalendarDate(input.createdTo)) {
      throw new Error("INVALID_MERCHANT_CREATED_DATE");
    }
    if (input.createdFrom > input.createdTo) throw new Error("INVALID_MERCHANT_CREATED_RANGE");
    const from = parseBeijingDayStart(input.createdFrom);
    const to = new Date(parseBeijingDayStart(input.createdTo).getTime() + DAY_MS);
    return { from, to };
  }

  const today = getBeijingDateParts(now);
  if (!today) throw new Error("INVALID_CURRENT_TIME");
  const todayStart = beijingDayStart(today.year, today.month, today.day);

  if (preset === "today") {
    return { from: todayStart, to: new Date(todayStart.getTime() + DAY_MS) };
  }
  if (preset === "last7Days") {
    return { from: new Date(todayStart.getTime() - 6 * DAY_MS), to: new Date(todayStart.getTime() + DAY_MS) };
  }
  if (preset === "last30Days") {
    return { from: new Date(todayStart.getTime() - 29 * DAY_MS), to: new Date(todayStart.getTime() + DAY_MS) };
  }
  if (preset === "thisMonth") {
    return {
      from: beijingDayStart(today.year, today.month, 1),
      to: beijingDayStart(today.year, today.month + 1, 1),
    };
  }

  return null;
}
