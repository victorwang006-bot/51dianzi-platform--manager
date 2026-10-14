import { sql } from "drizzle-orm";
import { merchants } from "../../drizzle/schema";

/** Only the effective registration blob is read; pending/review documents remain private. */
export function merchantEffectiveHkChineseNameSql() {
  const safeData = sql`IF(JSON_VALID(${merchants.registrationData}), ${merchants.registrationData}, JSON_OBJECT())`;
  const nested = sql`JSON_EXTRACT(${safeData}, '$.registration')`;
  const value = sql`CASE WHEN JSON_TYPE(${nested}) = 'OBJECT'
    THEN JSON_EXTRACT(${safeData}, '$.registration.chineseName')
    ELSE JSON_EXTRACT(${safeData}, '$.chineseName') END`;
  const text = sql`JSON_UNQUOTE(${value})`;
  return sql<string | null>`CASE WHEN ${merchants.registrationRegion} = 'HK'
    AND (${merchants.status} = 'approved' OR ${merchants.crmStatus} IN ('enabled', 'disabled'))
    AND JSON_TYPE(${value}) = 'STRING'
    AND REPLACE(REPLACE(REPLACE(REPLACE(TRIM(${text}), CHAR(9), ''), CHAR(10), ''), CHAR(13), ''), '　', '') <> ''
    THEN TRIM(${text}) ELSE NULL END`;
}

function merchantNameRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Admin-visible name; never writes the registered name or promotes the pending blob. */
export function effectiveHkChineseCompanyName(row: Pick<typeof merchants.$inferSelect, "registrationRegion" | "registrationData" | "status" | "crmStatus">): string | null {
  if (row.registrationRegion !== "HK" || !(row.status === "approved" || row.crmStatus === "enabled" || row.crmStatus === "disabled")) return null;
  let value: unknown = row.registrationData;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  const raw = merchantNameRecord(value);
  if (!raw) return null;
  const registration = merchantNameRecord(raw.registration) ?? raw;
  const name = registration.chineseName;
  return typeof name === "string" ? name.trim() || null : null;
}
