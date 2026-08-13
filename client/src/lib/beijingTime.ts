export const BEIJING_TIME_ZONE = "Asia/Shanghai";

type DateInput = Date | string | number | null | undefined;
type DateParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

const MYSQL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseInstant(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string") {
    const mysqlMatch = value.match(MYSQL_DATETIME_RE);
    if (mysqlMatch) {
      const [, year, month, day, hour, minute, second, millis = "0"] = mysqlMatch;
      const normalizedMillis = millis.padEnd(3, "0");
      const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${normalizedMillis}+08:00`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const dateOnlyMatch = value.match(DATE_ONLY_RE);
    if (dateOnlyMatch) {
      const [, year, month, day] = dateOnlyMatch;
      const parsed = new Date(`${year}-${month}-${day}T00:00:00+08:00`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Drizzle MySQL timestamp(mode=date) currently maps a database wall-clock string
 * such as 2026-08-13 15:46:03 to 2026-08-13T15:46:03Z.  The UTC components
 * therefore carry the intended Beijing wall-clock values, not a real UTC instant.
 */
function parseDatabaseWallClock(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && (MYSQL_DATETIME_RE.test(value) || DATE_ONLY_RE.test(value))) {
    return parseInstant(value);
  }
  const encoded = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(encoded.getTime())) return null;
  const year = encoded.getUTCFullYear();
  const month = String(encoded.getUTCMonth() + 1).padStart(2, "0");
  const day = String(encoded.getUTCDate()).padStart(2, "0");
  const hour = String(encoded.getUTCHours()).padStart(2, "0");
  const minute = String(encoded.getUTCMinutes()).padStart(2, "0");
  const second = String(encoded.getUTCSeconds()).padStart(2, "0");
  const millis = String(encoded.getUTCMilliseconds()).padStart(3, "0");
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function partsOf(date: Date): DateParts {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: BEIJING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(part => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function renderDateTime(date: Date, includeSeconds = false): string {
  const parts = partsOf(date);
  const base = `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
  return includeSeconds ? `${base}:${parts.second}` : base;
}

function renderDate(date: Date): string {
  const parts = partsOf(date);
  return `${parts.year}/${parts.month}/${parts.day}`;
}

/** 格式化真实瞬时（ISO、Date或带时区字符串）为北京时间。 */
export function formatBeijingDateTime(value: DateInput, fallback = "-", includeSeconds = false): string {
  const date = parseInstant(value);
  return date ? renderDateTime(date, includeSeconds) : fallback;
}

export function formatBeijingDate(value: DateInput, fallback = "-"): string {
  const date = parseInstant(value);
  return date ? renderDate(date) : fallback;
}

export function databaseBeijingTimestamp(value: DateInput): number | null {
  const date = parseDatabaseWallClock(value);
  return date ? date.getTime() : null;
}

export function beijingTimestamp(value: DateInput): number | null {
  const date = parseInstant(value);
  return date ? date.getTime() : null;
}

/** 格式化经Drizzle timestamp(mode=date)读取的数据库北京时间墙上时间。 */
export function formatDatabaseBeijingDateTime(value: DateInput, fallback = "-", includeSeconds = false): string {
  const date = parseDatabaseWallClock(value);
  return date ? renderDateTime(date, includeSeconds) : fallback;
}

export function formatDatabaseBeijingDate(value: DateInput, fallback = "-"): string {
  const date = parseDatabaseWallClock(value);
  return date ? renderDate(date) : fallback;
}
