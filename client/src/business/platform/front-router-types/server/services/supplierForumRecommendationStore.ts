import { sql } from "drizzle-orm";
import type { getDb } from "../db";
import { beijingDay, instant, safety, validateGrant,
  type SupplierForumGrant, type SupplierForumInventory, type SupplierForumSourceVersion } from "./supplierForumRecommendationModel";
import { SUPPLIER_FORUM_CURRENT_ALLOWLIST } from "./supplierForumRecommendationAllowlist";
import { loadSupplierTodayRecommendationCandidates } from "./supplierForumTodayRecommendation";
import { type SupplierForumRunKey } from "./supplierForumRecommendationSchedule";

export type SupplierForumDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type SupplierForumSql = Pick<SupplierForumDb, "execute">;
export type SupplierForumPolicy = { id: number; enabled: boolean | number; revision: number; grants: SupplierForumGrant[] | string;
  lastPublishedEnterpriseId: number | null; stoppedAt: Date | string | null };
export type SupplierForumRun = { id: number; policyId: number; policyRevision: number; publishDate: string | Date;
  slotNo: number; plannedAt: Date | string;
  status: "planned" | "claimed" | "published" | "skipped" | "failed"; enterpriseId: number | null; authorUserId: number | null;
  content: string | null; contentHash: string | null; sourceVersions: SupplierForumSourceVersion[] | string;
  authorizationSnapshot: SupplierForumGrant | string | null; ruleVersion: string | null;
  clientMessageId: string; messageId: number | null; leaseToken: string | null; leaseUntil: Date | string | null; attempts: number };
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0] as T[];
  return Array.isArray(result) ? result as T[] : [];
}
export function parseArray<T>(value: unknown): T[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  safety(Array.isArray(parsed), "PERSISTED_JSON_INVALID"); return parsed as T[];
}
export function dbDate(value: string | Date): string { return value instanceof Date ? beijingDay(value) : value.slice(0, 10); }
export function runKey(run: SupplierForumRun): SupplierForumRunKey {
  return { runId: run.id, day: dbDate(run.publishDate), slotNo: run.slotNo };
}
export function beijingSqlTime(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now);
}
/** This CLI's private transaction connection only; no global DB settings. */
export async function boundSupplierForumTransaction(tx: SupplierForumSql): Promise<void> {
  // db.transaction explicitly sets READ COMMITTED for the current transaction.
  // Align the private session variable as well: SET TRANSACTION alone does not
  // update @@transaction_isolation used by the locked recommendation proof.
  await tx.execute(sql`/* sf:bounds-isolation */ SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED`);
  await tx.execute(sql`/* sf:bounds-lock */ SET SESSION innodb_lock_wait_timeout = 5`);
  await tx.execute(sql`/* sf:bounds-query */ SET SESSION max_execution_time = 5000`);
}
export async function loadPolicy(tx: SupplierForumSql, lock = false): Promise<SupplierForumPolicy | null> {
  const rows = rowsOf<SupplierForumPolicy>(await tx.execute(sql`/* sf:policy */ SELECT * FROM supplier_forum_recommendation_policies WHERE id = 1 ${lock ? sql`FOR UPDATE` : sql``}`));
  return rows[0] ?? null;
}
/** The singleton policy row MUST be locked before any planning/claim/proof writes. */
export async function loadDayRuns(tx: SupplierForumSql, day: string, lock = false): Promise<SupplierForumRun[]> {
  return rowsOf<SupplierForumRun>(await tx.execute(sql`/* sf:day-runs */ SELECT * FROM supplier_forum_recommendation_runs
    WHERE publishDate = ${day} ORDER BY slotNo ${lock ? sql`FOR UPDATE` : sql``}`));
}
export const SUPPLIER_FORUM_ENTERPRISE_DAILY_LIMIT = 4;
/** Only automatic published runs count, never ordinary/manual forum messages.
 * Excluding the SAME run lets final audit checks/replays avoid double counting.
 * Publishing callers MUST hold the singleton policy row lock throughout. */
export function publishedSupplierForumEnterpriseCount(runs: readonly SupplierForumRun[], day: string,
  enterpriseId: number, excludeRunId?: number): number {
  return runs.filter(run => run.policyId === 1 && run.status === "published" && dbDate(run.publishDate) === day
    && run.enterpriseId === enterpriseId && run.id !== excludeRunId).length;
}
/** Never resolve a delegation from a naked day: all three frozen coordinates match. */
export async function loadRun(tx: SupplierForumSql, key: SupplierForumRunKey, lock = false): Promise<SupplierForumRun | null> {
  safety(Number.isSafeInteger(key.runId) && key.runId > 0 && Number.isInteger(key.slotNo) && key.slotNo >= 1 && key.slotNo <= 12, "RUN_KEY_INVALID");
  return rowsOf<SupplierForumRun>(await tx.execute(sql`/* sf:run */ SELECT * FROM supplier_forum_recommendation_runs
    WHERE id = ${key.runId} AND publishDate = ${key.day} AND slotNo = ${key.slotNo} LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}`))[0] ?? null;
}
export function activeGrants(policy: SupplierForumPolicy, now: Date): SupplierForumGrant[] {
  const grants = parseArray<SupplierForumGrant>(policy.grants);
  safety(grants.length <= 64, "ALLOWLIST_TOO_LARGE");
  const ids = new Set<number>();
  for (const grant of grants) {
    safety(!ids.has(grant.enterpriseId), "MULTIPLE_AUTHORS_FOR_ENTERPRISE"); ids.add(grant.enterpriseId);
    // Even expired/revoked grants must refer to a frozen exact tuple; DB edits cannot enroll suppliers.
    safety(SUPPLIER_FORUM_CURRENT_ALLOWLIST.some(entry => entry.enterpriseId === grant.enterpriseId && entry.authorUserId === grant.authorUserId
      && entry.dataOwnerUserId === grant.dataOwnerUserId && entry.companyId === grant.companyId), "NOT_FROZEN_ALLOWLIST");
  }
  return grants.filter(grant => !grant.revokedAt && instant(grant.authorizedAt) <= now.getTime()
    && (grant.expiresAt === null || instant(grant.expiresAt) > now.getTime()))
    .map(grant => { validateGrant(grant, SUPPLIER_FORUM_CURRENT_ALLOWLIST, now); return grant; });
}
export async function loadSeen(tx: SupplierForumSql, now: Date): Promise<SupplierForumSourceVersion[]> {
  // <=48h public events can have appeared on these three Beijing dates. 12/day
  // means at most 36 source-bearing rows, not the old 3-row singleton history.
  const day = beijingDay(new Date(now.getTime() - 48 * 3_600_000));
  return rowsOf<{ sourceVersions: unknown }>(await tx.execute(sql`/* sf:seen */ SELECT sourceVersions FROM supplier_forum_recommendation_runs
    WHERE status = 'published' AND publishDate >= ${day} AND publishDate <= ${beijingDay(now)} ORDER BY publishDate DESC, slotNo DESC LIMIT 36`))
    .flatMap(row => parseArray<SupplierForumSourceVersion>(row.sourceVersions));
}
function inventoryColumns() { return sql`i.id, i.userId, i.enterpriseId, i.ownerUserId, i.ownershipVersion,
  i.partNumber, i.brand, i.status, i.companyCatalogVisible, i.qtyOnSale, i.priceEx, i.taxIncluded,
  i.ladderPrices, i.moq, i.spq, i.leadTime, i.publishedAt, i.refreshedAt`; }
export async function loadCandidates(tx: SupplierForumSql, grants: SupplierForumGrant[], now: Date,
  seen: SupplierForumSourceVersion[] = [], lastEnterpriseId: number | null = null): Promise<SupplierForumInventory[]> {
  return loadSupplierTodayRecommendationCandidates(tx, grants, now, seen, lastEnterpriseId);
}
export async function loadLiveInventory(tx: SupplierForumSql, ids: number[]): Promise<SupplierForumInventory[]> {
  safety(ids.length === 1 && Number.isSafeInteger(ids[0]) && ids[0] > 0, "SOURCE_COUNT_INVALID");
  return rowsOf<SupplierForumInventory>(await tx.execute(sql`/* sf:live-inventory */ SELECT ${inventoryColumns()}
    FROM inventories i
    WHERE i.id IN (${sql.join(ids.map(id => sql`${id}`), sql`,`)}) ORDER BY i.id FOR UPDATE`));
}
export async function assertLiveIdentity(tx: SupplierForumSql, grant: SupplierForumGrant, ruleVersion: string, now: Date, lock = true): Promise<{ companyName: string }> {
  // Lock order matches existing sendMessage: true user first, then business identity.
  const [user] = rowsOf<{ loginDisabled: boolean | number; forumMutedUntil: Date | string | null }>(await tx.execute(sql`/* sf:user */
    SELECT id, loginDisabled, forumMutedUntil FROM users WHERE id = ${grant.authorUserId} LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}`));
  safety(user && (user.loginDisabled === false || user.loginDisabled === 0), "AUTHOR_DISABLED_OR_MISSING");
  safety(!user.forumMutedUntil || instant(user.forumMutedUntil) <= now.getTime(), "AUTHOR_MUTED");
  const [identity] = rowsOf<{ companyName: string; crmDataOwnerUserId: number; memberStatus: string; companyId: number;
    companyCount: number; ownerEnterpriseCount: number; memberRole: string }>(await tx.execute(sql`/* sf:identity */
    SELECT e.companyName, e.crmDataOwnerUserId, em.status AS memberStatus, em.role AS memberRole,
      (SELECT MIN(c.id) FROM companies c WHERE c.enterpriseId = e.id AND c.userId = e.crmDataOwnerUserId) AS companyId,
      (SELECT COUNT(*) FROM companies c WHERE c.enterpriseId = e.id AND c.userId = e.crmDataOwnerUserId) AS companyCount,
      (SELECT COUNT(*) FROM enterprises other WHERE other.crmDataOwnerUserId = e.crmDataOwnerUserId) AS ownerEnterpriseCount
    FROM enterprises e INNER JOIN enterprise_members em ON em.enterpriseId = e.id AND em.userId = ${grant.authorUserId}
    WHERE e.id = ${grant.enterpriseId} LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}`));
  safety(identity && identity.memberStatus === "active" && ["super_admin", "admin", "member"].includes(identity.memberRole), "MEMBERSHIP_INVALID");
  safety(Number(identity.crmDataOwnerUserId) === grant.dataOwnerUserId && Number(identity.companyId) === grant.companyId
    && Number(identity.companyCount) === 1 && Number(identity.ownerEnterpriseCount) === 1 && Boolean(identity.companyName?.trim()), "BUSINESS_IDENTITY_CHANGED");
  const companies = rowsOf<{ id: number }>(await tx.execute(sql`/* sf:company-lock */ SELECT id FROM companies
    WHERE enterpriseId = ${grant.enterpriseId} AND userId = ${grant.dataOwnerUserId} ${lock ? sql`FOR UPDATE` : sql``}`));
  const owners = rowsOf<{ id: number }>(await tx.execute(sql`/* sf:owner-lock */ SELECT id FROM enterprises
    WHERE crmDataOwnerUserId = ${grant.dataOwnerUserId} ${lock ? sql`FOR UPDATE` : sql``}`));
  safety(companies.length === 1 && Number(companies[0].id) === grant.companyId
    && owners.length === 1 && Number(owners[0].id) === grant.enterpriseId, "BUSINESS_IDENTITY_CHANGED");
  safety(ruleVersion.length > 0, "RULE_VERSION_UNKNOWN");
  const acceptance = rowsOf<{ id: number }>(await tx.execute(sql`/* sf:rules */ SELECT id FROM forum_rules_acceptances
    WHERE userId = ${grant.authorUserId} AND ruleVersion = ${ruleVersion} LIMIT 1 ${lock ? sql`FOR UPDATE` : sql``}`));
  safety(acceptance.length === 1, "LATEST_RULES_NOT_ACCEPTED");
  return { companyName: identity.companyName };
}
