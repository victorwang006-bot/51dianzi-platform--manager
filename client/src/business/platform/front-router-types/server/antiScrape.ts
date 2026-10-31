/**
 * 应用层反爬模块。
 *
 * API 限流与匿名数据查看频控正常使用 MySQL 共享存储，保证 PM2 cluster
 * 的所有实例计入同一窗口。短暂 MySQL 故障时，store 明确降级为有界的
 * 进程内限流；Nginx 的共享 emergency zone 同时提供跨 PM2 实例的硬兜底，
 * 避免整个站点因限流依赖抖动而不可用，也绝不完全放开。
 */
import type { NextFunction, Request, Response } from "express";
import { MINI_PROGRAM_HEADER, isMiniProgramClient } from "../../shared/miniProgramClient";
import {
  __resetRateLimitStoreForTests,
  getRateLimitStore,
  type RateLimitStore,
} from "./rateLimitStore";
import { trustedClientIp } from "./trustedClientIp";

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
/** 单 IP 每分钟 API 请求上限（登录与否都生效，防脚本轰炸） */
export const RATE_LIMIT_PER_MIN = num(process.env.ANTI_SCRAPE_RATE_LIMIT, 300);
/** 匿名用户每 10 分钟可查看"价格/参数"类数据接口的次数，超过要求登录 */
export const ANON_VIEW_LIMIT = num(process.env.ANTI_SCRAPE_ANON_VIEW_LIMIT, 60);
/** 匿名浏览计数窗口（毫秒） */
export const ANON_VIEW_WINDOW_MS = num(process.env.ANTI_SCRAPE_ANON_WINDOW_MS, 10 * 60 * 1000);
/** 限流窗口（毫秒） */
const RATE_WINDOW_MS = 60 * 1000;

const BLOCKED_UA_PATTERNS = [
  /python-requests/i, /python-urllib/i, /\bscrapy\b/i, /\bhttpclient\b/i,
  /\bjava\/[\d.]+/i, /\bgo-http-client\b/i, /\bokhttp\b/i, /\baiohttp\b/i,
  /\bnode-fetch\b/i, /\baxios\b/i, /\bcurl\b/i, /\bwget\b/i, /\bphantomjs\b/i,
  /\bheadlesschrome\b/i, /\bselenium\b/i, /\bpuppeteer\b/i, /\bplaywright\b/i,
  /\bcolly\b/i, /\bhttrack\b/i, /\bscraper\b/i, /\bspider\b/i, /\bcrawler\b/i,
];
const ALLOWED_BOT_PATTERNS = [
  /googlebot/i, /bingbot/i, /baiduspider/i, /sogou/i, /360spider/i, /bytespider/i, /yandexbot/i,
];

/** 判断 UA 是否为需要拦截的爬虫工具 */
export function isBlockedUserAgent(ua: string | undefined): boolean {
  if (!ua || ua.trim() === "") return true;
  if (ALLOWED_BOT_PATTERNS.some(pattern => pattern.test(ua))) return false;
  return BLOCKED_UA_PATTERNS.some(pattern => pattern.test(ua));
}

/**
 * Client IP comes only from Express's trusted-proxy calculation. Application
 * code must never parse X-Forwarded-For/X-Real-IP directly.
 */
export function clientIp(req: Request): string {
  return trustedClientIp(req);
}

function rateLimitKey(scope: "api" | "anon", ip: string): string {
  // `trustedClientIp` emits an address, but retain a bounded opaque key if a
  // custom test/request adapter passes an unexpected value.
  return `${scope}:${ip.slice(0, 160)}`;
}

async function hitShared(
  scope: "api" | "anon",
  ip: string,
  windowMs: number,
  store = getRateLimitStore(),
): Promise<number> {
  return store.increment(rateLimitKey(scope, ip), windowMs);
}

/** Test helper: non-production defaults to an isolated in-memory store. */
export function __resetCounters() {
  __resetRateLimitStoreForTests();
}

/** Returns true once the shared anonymous-view budget is exceeded. */
export async function anonViewExceeded(ip: string, store?: RateLimitStore): Promise<boolean> {
  const count = await hitShared("anon", ip, ANON_VIEW_WINDOW_MS, store);
  return count > ANON_VIEW_LIMIT;
}

/** Express 中间件：爬虫 UA 拦截（仅作用于 /api/ 路径） */
export function uaGuardMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith("/api/")) return next();
  // This header is not an identity credential; it only bypasses the UA heuristic.
  if (isMiniProgramClient(req.headers[MINI_PROGRAM_HEADER])) return next();
  if (isBlockedUserAgent(req.headers["user-agent"])) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}

/**
 * Factory is exported to prove multiple logical workers share one store in
 * tests. Do not pass InMemoryRateLimitStore in production.
 */
export function createRateLimitMiddleware(store?: RateLimitStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/")) return next();
    try {
      const count = await hitShared("api", clientIp(req), RATE_WINDOW_MS, store ?? getRateLimitStore());
      if (count > RATE_LIMIT_PER_MIN) {
        res.status(429).json({ error: "Too Many Requests" });
        return;
      }
      next();
    } catch {
      // This only reaches unrecoverable implementation failures. The production
      // store handles ordinary shared-DB failures with its bounded fallback.
      res.status(503).json({ error: "Rate limit service unavailable" });
    }
  };
}

/** Express 中间件：单 IP API 限流 */
export const rateLimitMiddleware = createRateLimitMiddleware();

export const ROBOTS_TXT = `User-agent: *
Disallow: /api/
Disallow: /account
Disallow: /cart
Disallow: /orders
Disallow: /chat
Disallow: /profile
Disallow: /company
Disallow: /bom
Disallow: /inventory
Disallow: /publish
Disallow: /inbound
Disallow: /outbound
Disallow: /crm-apply
Disallow: /add-user
Disallow: /demand-publish
Disallow: /demand-quotes
Disallow: /admin/
Crawl-delay: 5
`;

/** 注册 robots.txt 路由 */
export function registerRobotsTxt(app: { get: (path: string, handler: (req: Request, res: Response) => void) => void }) {
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send(ROBOTS_TXT);
  });
}
