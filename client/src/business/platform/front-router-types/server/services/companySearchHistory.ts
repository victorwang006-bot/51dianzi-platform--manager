import { readPublicHotSnapshot } from "./publicHotSnapshot";
import { and, asc, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import {
  companies,
  inventories,
  searchEvents,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  getPublicCompanyProfile,
  publicCompanyProfileEligibilityConditions,
} from "./companyPublicProfile";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 只记录最终能打开公开主页的企业，名称一律取服务端当前企业全称。 */
export async function recordCompanySearchEvent(
  userId: number,
  supplierId: number
) {
  const profile = await getPublicCompanyProfile(supplierId);
  if (!profile) return false;
  const db = await getDb();
  if (!db) return false;
  await db.insert(searchEvents).values({
    userId,
    searchType: "company",
    keyword: profile.basicInfo.companyName.slice(0, 128),
    matchedSupplierId: supplierId,
  });
  return true;
}

/** 当前账号最近访问的可公开企业；按企业ID去重并保留最近一次。 */
export async function getCompanySearchHistory(userId: number, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  const safeLimit = Math.min(20, Math.max(1, limit));
  const rows = await db
    .select({
      supplierId: companies.userId,
      companyName: companies.companyName,
      searchedAt: searchEvents.searchedAt,
    })
    .from(searchEvents)
    .innerJoin(companies, eq(companies.userId, searchEvents.matchedSupplierId))
    .innerJoin(users, eq(users.id, companies.userId))
    .where(
      and(
        eq(searchEvents.userId, userId),
        eq(searchEvents.searchType, "company"),
        ...publicCompanyProfileEligibilityConditions(),
        sql`EXISTS (
        SELECT 1 FROM ${inventories} company_history_inventory
        WHERE company_history_inventory.userId = ${companies.userId}
          AND company_history_inventory.status = 'published'
      )`
      )
    )
    .orderBy(desc(searchEvents.searchedAt))
    .limit(safeLimit * 5);

  const seen = new Set<number>();
  const history: Array<{
    supplierId: number;
    companyName: string;
    searchedAt: Date;
  }> = [];
  for (const row of rows) {
    const supplierId = Number(row.supplierId);
    const companyName = row.companyName?.trim();
    if (!supplierId || !companyName || seen.has(supplierId)) continue;
    seen.add(supplierId);
    history.push({ supplierId, companyName, searchedAt: row.searchedAt });
    if (history.length >= safeLimit) break;
  }
  return history;
}

/**
 * 近30天热门公司：以独立登录用户数优先，至少两个账号搜索过才公开。
 * 返回值再次套用公开企业资格和在售库存条件，失效企业不会继续展示。
 */
export async function getPopularCompanySearches(limit = 8) {
  const size = Math.min(12, Math.max(1, Math.trunc(limit)));
  return readPublicHotSnapshot()?.companies.slice(0, size) ?? [];
}
/** Scheduled worker only: HTTP handlers never invoke this calculation. */
export async function calculatePopularCompanySearches(limit: number, db: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "select">) {
  const safeLimit = Math.min(12, Math.max(1, limit));
  const since = new Date(Date.now() - 30 * DAY_MS);
  const rows = await db
    .select({
      supplierId: companies.userId,
      companyName: companies.companyName,
      userCount: sql<number>`COUNT(DISTINCT ${searchEvents.userId})`,
      searchCount: sql<number>`COUNT(*)`,
      lastSearchedAt: sql<Date>`MAX(${searchEvents.searchedAt})`,
    })
    .from(searchEvents)
    .innerJoin(companies, eq(companies.userId, searchEvents.matchedSupplierId))
    .innerJoin(users, eq(users.id, companies.userId))
    .where(
      and(
        eq(searchEvents.searchType, "company"),
        isNotNull(searchEvents.matchedSupplierId),
        gte(searchEvents.searchedAt, since),
        ...publicCompanyProfileEligibilityConditions(),
        sql`EXISTS (
        SELECT 1 FROM ${inventories} popular_company_inventory
        WHERE popular_company_inventory.userId = ${companies.userId}
          AND popular_company_inventory.status = 'published'
      )`
      )
    )
    .groupBy(companies.id, companies.userId, companies.companyName)
    .having(sql`COUNT(DISTINCT ${searchEvents.userId}) >= 2`)
    .orderBy(
      desc(sql`COUNT(DISTINCT ${searchEvents.userId})`),
      desc(sql`COUNT(*)`),
      desc(sql`MAX(${searchEvents.searchedAt})`)
    )
    .limit(safeLimit);

  const fallbackRows =
    rows.length >= safeLimit
      ? []
      : await db
          .select({
            supplierId: companies.userId,
            companyName: companies.companyName,
            listingCount: sql<number>`COUNT(${inventories.id})`,
          })
          .from(companies)
          .innerJoin(users, eq(users.id, companies.userId))
          .innerJoin(
            inventories,
            and(
              eq(inventories.userId, companies.userId),
              eq(inventories.status, "published"),
            )
          )
          .where(and(...publicCompanyProfileEligibilityConditions()))
          .groupBy(companies.id, companies.userId, companies.companyName)
          .orderBy(
            desc(sql`COUNT(${inventories.id})`),
            asc(companies.companyName)
          )
          .limit(safeLimit * 2);

  const result: Array<{ supplierId: number; companyName: string }> = [];
  const seen = new Set<number>();
  for (const row of [...rows, ...fallbackRows]) {
    const supplierId = Number(row.supplierId);
    const companyName = row.companyName?.trim() || "";
    if (supplierId <= 0 || !companyName || seen.has(supplierId)) continue;
    seen.add(supplierId);
    result.push({ supplierId, companyName });
    if (result.length >= safeLimit) break;
  }
  return result;
}

export async function clearCompanySearchHistory(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(searchEvents)
    .where(
      and(
        eq(searchEvents.userId, userId),
        eq(searchEvents.searchType, "company")
      )
    );
}
