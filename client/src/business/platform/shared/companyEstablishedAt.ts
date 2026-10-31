const CANONICAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function canonicalDate(year: number, month: number, day: number): string | null {
  if (!isCalendarDate(year, month, day)) return null;
  const value = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // 公司成立日期不可能晚于今天。允许 24 小时时区余量，避免 UTC 与北京时间日界线误判。
  const timestamp = Date.UTC(year, month - 1, day);
  if (timestamp > Date.now() + 24 * 60 * 60 * 1000) return null;
  return value;
}

/**
 * 把营业执照 OCR 常见日期格式统一为 YYYY-MM-DD。
 * 支持 `2017 年 01 月 04 日`、`2017.01.04`、`2017/1/4` 与 `20170104`；
 * 无效日期或未来日期返回 null，绝不以营业期限、发照日期或平台时间代替。
 */
export function normalizeCompanyEstablishedAt(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).normalize("NFKC").trim();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, "");
  if (/^\d{8}$/.test(compact)) {
    return canonicalDate(
      Number(compact.slice(0, 4)),
      Number(compact.slice(4, 6)),
      Number(compact.slice(6, 8)),
    );
  }

  const match = compact.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})(?:\D.*)?$/);
  if (!match) return null;
  return canonicalDate(Number(match[1]), Number(match[2]), Number(match[3]));
}

export function isValidCompanyEstablishedAt(value: string): boolean {
  const match = CANONICAL_DATE.exec(value);
  if (!match) return false;
  return canonicalDate(Number(match[1]), Number(match[2]), Number(match[3])) === value;
}

/** 日期列已经是无时区的 YYYY-MM-DD，直接本地化显示，避免 new Date() 带来的跨时区减一天。 */
export function displayCompanyEstablishedAt(value: string | null | undefined): string {
  const normalized = normalizeCompanyEstablishedAt(value ?? "");
  if (!normalized) return "—";
  const [year, month, day] = normalized.split("-");
  return `${year}-${month}-${day}`;
}
