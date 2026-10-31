import { createHmac, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { publicProcedure, router } from "../_core/trpc";
import { isMiniProgramClient, MINI_PROGRAM_HEADER } from "../../../shared/miniProgramClient";

const TRACKING_RETENTION_DAYS = 90;
let lastRetentionCleanupAt = 0;

const trackInput = z.object({
  eventId: z.string().trim().min(8).max(64),
  visitorId: z.string().trim().min(8).max(128),
  sessionId: z.string().trim().min(8).max(128),
  path: z.string().trim().min(1).max(255),
  referrer: z.string().trim().max(1000).optional(),
});

function trackingSecret() {
  const secret = (process.env.SITE_ANALYTICS_SECRET || process.env.JWT_SECRET || "").trim();
  if (!secret) throw new Error("SITE_ANALYTICS_SECRET/JWT_SECRET 未配置");
  return secret;
}

function hashIdentifier(kind: string, value: string) {
  return createHmac("sha256", trackingSecret()).update(`${kind}:${value}`).digest("hex");
}

function normalizedPath(raw: string) {
  let path = raw.split("?")[0].split("#")[0].trim();
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  if (/^\/product\/\d+$/.test(path)) path = "/product/:id";
  if (/^\/company\/\d+$/.test(path)) path = "/company/:id";
  if (/^\/publish\/\d+\/edit$/.test(path)) path = "/publish/:id/edit";
  return path.slice(0, 255) || "/";
}

function referrerInfo(raw: string | undefined) {
  if (!raw) return { source: "direct", referrerHost: null };
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "").slice(0, 255);
    if (!host) return { source: "direct", referrerHost: null };
    if (host === "51dianzi.com" || host.endsWith(".51dianzi.com")) {
      return { source: "internal", referrerHost: host };
    }
    if (/weixin|wechat|\.qq\.com$/.test(host)) return { source: "wechat", referrerHost: host };
    if (/baidu|bing|google|sogou|so\.com$|sm\.cn$/.test(host)) {
      return { source: "search", referrerHost: host };
    }
    return { source: "external", referrerHost: host };
  } catch {
    return { source: "direct", referrerHost: null };
  }
}

function deviceType(userAgent: string) {
  if (/ipad|tablet|playbook|silk/i.test(userAgent)) return "tablet";
  if (/mobile|iphone|ipod|android/i.test(userAgent)) return "mobile";
  return "desktop";
}

function looksLikeBot(userAgent: string) {
  return /bot|spider|crawler|slurp|headless|lighthouse|pagespeed|monitoring/i.test(userAgent);
}

function rangeStart(days: 7 | 30 | 90) {
  if (days === 7) return sql`DATE_SUB(CURDATE(), INTERVAL 6 DAY)`;
  if (days === 30) return sql`DATE_SUB(CURDATE(), INTERVAL 29 DAY)`;
  return sql`DATE_SUB(CURDATE(), INTERVAL 89 DAY)`;
}

function rowsOf<T>(result: unknown): T[] {
  return (result as [T[], unknown])[0];
}

function requirePortalKey(headers: Record<string, unknown> | undefined) {
  const expected = process.env.PORTAL_API_KEY?.trim() ?? "";
  const raw = headers?.["x-portal-key"];
  const provided = (Array.isArray(raw) ? raw[0] : raw)?.toString().trim() ?? "";
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  const authenticated = expectedBuffer.length > 0
    && expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
  if (!authenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "内部接口鉴权失败" });
  }
}

export const siteAnalyticsRouter = router({
  track: publicProcedure.input(trackInput).mutation(async ({ ctx, input }) => {
    const userAgent = String(ctx.req.headers["user-agent"] || "").slice(0, 512);
    if (looksLikeBot(userAgent)) return { recorded: false, reason: "bot" } as const;
    const clientType = isMiniProgramClient(ctx.req.headers[MINI_PROGRAM_HEADER]) ? "miniapp" : "web";

    const db = await getDb();
    if (!db) throw new Error("数据库未连接");
    const path = normalizedPath(input.path);
    const referrer = clientType === "miniapp"
      ? { source: "wechat", referrerHost: null }
      : referrerInfo(input.referrer);

    const result = await db.execute(sql`
      INSERT IGNORE INTO site_page_views
        (eventId, visitorHash, sessionHash, userId, clientType, path, source, referrerHost, deviceType, occurredAt)
      VALUES
        (${hashIdentifier("event", input.eventId)},
         ${hashIdentifier("visitor", input.visitorId)},
         ${hashIdentifier("session", input.sessionId)},
         ${ctx.user?.id ?? null},
         ${clientType},
         ${path},
         ${referrer.source},
         ${referrer.referrerHost},
         ${deviceType(userAgent)},
         NOW())
    `);

    const now = Date.now();
    if (now - lastRetentionCleanupAt > 24 * 60 * 60 * 1000) {
      lastRetentionCleanupAt = now;
      void db.execute(sql`
        DELETE FROM site_page_views
         WHERE occurredAt < DATE_SUB(NOW(), INTERVAL 90 DAY)
      `).catch(error => console.error("[site-analytics] retention cleanup failed", error));
    }

    const affectedRows = Number((result as unknown as [{ affectedRows?: number }, unknown])[0]?.affectedRows ?? 0);
    return { recorded: affectedRows > 0 } as const;
  }),

  internalOverview: publicProcedure
    .input(z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) }))
    .query(async ({ ctx, input }) => {
      requirePortalKey(ctx.req?.headers as Record<string, unknown> | undefined);
      const db = await getDb();
      if (!db) throw new Error("数据库未连接");
      const start = rangeStart(input.days);

      const [
        summaryResult,
        userResult,
        dailyResult,
        pageResult,
        sourceResult,
        deviceResult,
        sinceResult,
        miniSummaryResult,
        miniDailyResult,
        miniSinceResult,
      ] = await Promise.all([
        db.execute(sql`
          SELECT COUNT(*) AS pageViews,
                 COUNT(DISTINCT visitorHash) AS visitors,
                 COUNT(DISTINCT sessionHash) AS sessions,
                 COUNT(DISTINCT CASE WHEN userId IS NULL THEN visitorHash END) AS guestVisitors,
                 COUNT(DISTINCT userId) AS loggedInUsers
            FROM site_page_views
           WHERE clientType = 'web' AND occurredAt >= ${start}
        `),
        db.execute(sql`
          SELECT COUNT(*) AS totalUsers,
                 SUM(CASE WHEN DATE(createdAt) = CURDATE() THEN 1 ELSE 0 END) AS todayRegistered,
                 SUM(CASE WHEN createdAt >= ${start} THEN 1 ELSE 0 END) AS rangeRegistered,
                 SUM(CASE WHEN lastSignedIn >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                   THEN 1 ELSE 0 END) AS sevenDayLoginUsers,
                 SUM(CASE WHEN lastSignedIn >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                   THEN 1 ELSE 0 END) AS thirtyDayLoginUsers
            FROM users
        `),
        db.execute(sql`
          SELECT DATE_FORMAT(occurredAt, '%Y-%m-%d') AS date,
                 COUNT(*) AS pageViews,
                 COUNT(DISTINCT visitorHash) AS visitors,
                 COUNT(DISTINCT sessionHash) AS sessions,
                 COUNT(DISTINCT CASE WHEN userId IS NULL THEN visitorHash END) AS guestVisitors,
                 COUNT(DISTINCT userId) AS loggedInUsers
            FROM site_page_views
           WHERE clientType = 'web' AND occurredAt >= ${start}
           GROUP BY DATE_FORMAT(occurredAt, '%Y-%m-%d')
           ORDER BY DATE_FORMAT(occurredAt, '%Y-%m-%d') ASC
        `),
        db.execute(sql`
          SELECT path, COUNT(*) AS pageViews, COUNT(DISTINCT visitorHash) AS visitors
            FROM site_page_views
           WHERE clientType = 'web' AND occurredAt >= ${start}
           GROUP BY path
           ORDER BY pageViews DESC, visitors DESC
           LIMIT 12
        `),
        db.execute(sql`
          SELECT source, COUNT(DISTINCT visitorHash) AS visitors
            FROM site_page_views
           WHERE clientType = 'web' AND occurredAt >= ${start}
           GROUP BY source
           ORDER BY visitors DESC
        `),
        db.execute(sql`
          SELECT deviceType, COUNT(DISTINCT visitorHash) AS visitors
            FROM site_page_views
           WHERE clientType = 'web' AND occurredAt >= ${start}
           GROUP BY deviceType
           ORDER BY visitors DESC
        `),
        db.execute(sql`
          SELECT DATE_FORMAT(MIN(occurredAt), '%Y-%m-%d %H:%i:%s') AS firstEventAt,
                 DATE_FORMAT(MAX(occurredAt), '%Y-%m-%d %H:%i:%s') AS lastEventAt
            FROM site_page_views
           WHERE clientType = 'web'
        `),
        db.execute(sql`
          SELECT COUNT(*) AS opens,
                 COUNT(DISTINCT visitorHash) AS visitors,
                 COUNT(DISTINCT sessionHash) AS sessions,
                 COUNT(DISTINCT userId) AS loggedInUsers
            FROM site_page_views
           WHERE clientType = 'miniapp' AND occurredAt >= ${start}
        `),
        db.execute(sql`
          SELECT DATE_FORMAT(occurredAt, '%Y-%m-%d') AS date,
                 COUNT(*) AS opens,
                 COUNT(DISTINCT visitorHash) AS visitors,
                 COUNT(DISTINCT sessionHash) AS sessions,
                 COUNT(DISTINCT userId) AS loggedInUsers
            FROM site_page_views
           WHERE clientType = 'miniapp' AND occurredAt >= ${start}
           GROUP BY DATE_FORMAT(occurredAt, '%Y-%m-%d')
           ORDER BY DATE_FORMAT(occurredAt, '%Y-%m-%d') ASC
        `),
        db.execute(sql`
          SELECT DATE_FORMAT(MIN(occurredAt), '%Y-%m-%d %H:%i:%s') AS firstEventAt,
                 DATE_FORMAT(MAX(occurredAt), '%Y-%m-%d %H:%i:%s') AS lastEventAt
            FROM site_page_views
           WHERE clientType = 'miniapp'
        `),
      ]);

      type SummaryRow = {
        pageViews: number; visitors: number; sessions: number; guestVisitors: number; loggedInUsers: number;
      };
      type UserRow = {
        totalUsers: number; todayRegistered: number; rangeRegistered: number;
        sevenDayLoginUsers: number; thirtyDayLoginUsers: number;
      };
      type MiniSummaryRow = {
        opens: number; visitors: number; sessions: number; loggedInUsers: number;
      };
      const summary = rowsOf<SummaryRow>(summaryResult)[0];
      const users = rowsOf<UserRow>(userResult)[0];
      const miniSummary = rowsOf<MiniSummaryRow>(miniSummaryResult)[0];
      const number = (value: unknown) => Number(value ?? 0);

      return {
        days: input.days,
        retentionDays: TRACKING_RETENTION_DAYS,
        summary: {
          pageViews: number(summary?.pageViews),
          visitors: number(summary?.visitors),
          sessions: number(summary?.sessions),
          guestVisitors: number(summary?.guestVisitors),
          loggedInUsers: number(summary?.loggedInUsers),
          totalUsers: number(users?.totalUsers),
          todayRegistered: number(users?.todayRegistered),
          rangeRegistered: number(users?.rangeRegistered),
          sevenDayLoginUsers: number(users?.sevenDayLoginUsers),
          thirtyDayLoginUsers: number(users?.thirtyDayLoginUsers),
        },
        daily: rowsOf<Record<string, unknown>>(dailyResult).map(row => ({
          date: String(row.date),
          pageViews: number(row.pageViews),
          visitors: number(row.visitors),
          sessions: number(row.sessions),
          guestVisitors: number(row.guestVisitors),
          loggedInUsers: number(row.loggedInUsers),
        })),
        topPages: rowsOf<Record<string, unknown>>(pageResult).map(row => ({
          path: String(row.path),
          pageViews: number(row.pageViews),
          visitors: number(row.visitors),
        })),
        sources: rowsOf<Record<string, unknown>>(sourceResult).map(row => ({
          source: String(row.source),
          visitors: number(row.visitors),
        })),
        devices: rowsOf<Record<string, unknown>>(deviceResult).map(row => ({
          deviceType: String(row.deviceType),
          visitors: number(row.visitors),
        })),
        firstEventAt: String(rowsOf<Record<string, unknown>>(sinceResult)[0]?.firstEventAt || ""),
        lastEventAt: String(rowsOf<Record<string, unknown>>(sinceResult)[0]?.lastEventAt || ""),
        miniProgram: {
          opens: number(miniSummary?.opens),
          visitors: number(miniSummary?.visitors),
          sessions: number(miniSummary?.sessions),
          loggedInUsers: number(miniSummary?.loggedInUsers),
          daily: rowsOf<Record<string, unknown>>(miniDailyResult).map(row => ({
            date: String(row.date),
            opens: number(row.opens),
            visitors: number(row.visitors),
            sessions: number(row.sessions),
            loggedInUsers: number(row.loggedInUsers),
          })),
          firstEventAt: String(rowsOf<Record<string, unknown>>(miniSinceResult)[0]?.firstEventAt || ""),
          lastEventAt: String(rowsOf<Record<string, unknown>>(miniSinceResult)[0]?.lastEventAt || ""),
        },
      };
    }),
});
