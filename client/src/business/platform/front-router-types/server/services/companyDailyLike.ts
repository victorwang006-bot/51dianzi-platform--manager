import { and, eq, sql } from "drizzle-orm";
import { companyDailyLikes } from "../../drizzle/schema";
import { getDb } from "../db";

export const COMPANY_LIKE_TIME_ZONE = "Asia/Shanghai";

/** 将任意时刻稳定映射为北京时间自然日，避免服务器 UTC 日期跨日误判。 */
export function companyLikeDayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: COMPANY_LIKE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function getCompanyLikeSummary(input: {
  supplierId: number;
  userId?: number | null;
  now?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const likeDate = companyLikeDayKey(input.now);

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(companyDailyLikes)
    .where(eq(companyDailyLikes.supplierId, input.supplierId));

  let likedToday = false;
  if (input.userId) {
    const [existing] = await db
      .select({ id: companyDailyLikes.id })
      .from(companyDailyLikes)
      .where(and(
        eq(companyDailyLikes.userId, input.userId),
        eq(companyDailyLikes.supplierId, input.supplierId),
        eq(companyDailyLikes.likeDate, likeDate),
      ))
      .limit(1);
    likedToday = Boolean(existing);
  }

  return {
    total: Number(total ?? 0),
    likedToday,
    likeDate,
  };
}

/**
 * 依靠唯一索引原子防重；并发双击只会插入一条，不先查后写。
 * 返回 inserted=false 表示该用户今天已经为此公司点过赞。
 */
export async function addCompanyDailyLike(input: {
  supplierId: number;
  userId: number;
  now?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const likedAt = input.now ?? new Date();
  const likeDate = companyLikeDayKey(likedAt);
  const [result] = await db
    .insert(companyDailyLikes)
    .ignore()
    .values({
      userId: input.userId,
      supplierId: input.supplierId,
      likeDate,
    });
  const inserted = Number(result.affectedRows ?? 0) === 1;
  const likeId = inserted ? Number(result.insertId ?? 0) : null;
  const summary = await getCompanyLikeSummary({
    supplierId: input.supplierId,
    userId: input.userId,
    now: likedAt,
  });
  return { ...summary, inserted, likeId, likedAt };
}
