import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { promisify } from "node:util";
import type { Request } from "express";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { adminLoginEvents, adminUsers } from "../drizzle/schema";
import { canonicalAdminUsername } from "../shared/adminUsername";
import { ENV } from "./_core/env";
import { getDb, touchAdminUserLogin } from "./db";

const execFileAsync = promisify(execFile);
const GEO_DB_PATH = "/usr/share/GeoIP/GeoLite2-City.mmdb";
const EVENT_RETENTION_DAYS = 90;
const geoCache = new Map<string, { value: GeoResult; expiresAt: number }>();
let lastCleanupAt = 0;

type GeoResult = { countryCode: string | null; location: string | null };
type RiskLevel = "normal" | "attention" | "high";

type LoginSecurityInput = {
  adminUserId?: number | null;
  username: string;
  success: boolean;
  authMethod: "password" | "oauth";
  req: Request;
};

function normalizeIp(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/^\[|\]$/g, "") ?? "";
  const withoutPort = trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
  if (isIP(withoutPort)) return withoutPort;
  const ipv4WithPort = withoutPort.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/)?.[1];
  return ipv4WithPort && isIP(ipv4WithPort) ? ipv4WithPort : "unknown";
}

function isTrustedLocalProxy(ip: string) {
  return ip === "127.0.0.1" || ip === "::1" || ip.startsWith("10.")
    || ip.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/** 仅当直连来源为内网反向代理时才信任其转发头，避免客户端伪造IP。 */
export function trustedAdminClientIp(req: Request) {
  const remote = normalizeIp(req.socket?.remoteAddress);
  if (!isTrustedLocalProxy(remote)) return remote;
  const realHeader = req.headers["x-real-ip"];
  const realIp = normalizeIp(Array.isArray(realHeader) ? realHeader[0] : realHeader);
  if (realIp !== "unknown") return realIp;
  const forwarded = req.headers["x-forwarded-for"];
  const values = (Array.isArray(forwarded) ? forwarded.join(",") : forwarded ?? "")
    .split(",")
    .map(normalizeIp)
    .filter(ip => ip !== "unknown");
  return values.at(-1) ?? remote;
}

function auditHash(kind: "account" | "ip" | "device", value: string) {
  const secret = ENV.cookieSecret || (ENV.isProduction ? "" : "development-admin-login-audit");
  if (!secret) throw new Error("JWT_SECRET 未配置，无法生成登录审计摘要");
  return createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex");
}

function privateLocation(ip: string): string | null {
  if (ip === "unknown") return "未知网络";
  if (isTrustedLocalProxy(ip)) return "内网";
  return null;
}

function mmdbValue(output: string) {
  return output.match(/"([^"]+)"/)?.[1]?.trim() || null;
}

async function lookupGeo(ip: string): Promise<GeoResult> {
  const privateLabel = privateLocation(ip);
  if (privateLabel) return { countryCode: null, location: privateLabel };
  const cached = geoCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let result: GeoResult = { countryCode: null, location: null };
  try {
    const [country, subdivision, city] = await Promise.all([
      execFileAsync("mmdblookup", ["--file", GEO_DB_PATH, "--ip", ip, "country", "iso_code"], { timeout: 800 }),
      execFileAsync("mmdblookup", ["--file", GEO_DB_PATH, "--ip", ip, "subdivisions", "0", "names", "zh-CN"], { timeout: 800 }),
      execFileAsync("mmdblookup", ["--file", GEO_DB_PATH, "--ip", ip, "city", "names", "zh-CN"], { timeout: 800 }),
    ]);
    const countryCode = mmdbValue(country.stdout);
    const place = [mmdbValue(subdivision.stdout), mmdbValue(city.stdout)].filter(Boolean).join(" ");
    result = { countryCode, location: place || countryCode || null };
  } catch {
    result = { countryCode: null, location: null };
  }
  if (geoCache.size >= 5000) geoCache.delete(geoCache.keys().next().value as string);
  geoCache.set(ip, { value: result, expiresAt: Date.now() + 24 * 60 * 60_000 });
  return result;
}

export function parseAdminDevice(userAgentValue: string | null | undefined) {
  const ua = userAgentValue?.slice(0, 1000) || "";
  const operatingSystem = /Windows NT/i.test(ua) ? "Windows"
    : /Android/i.test(ua) ? "Android"
      : /iPhone|iPad|iPod/i.test(ua) ? "iOS"
        : /Mac OS X/i.test(ua) ? "macOS"
          : /Linux/i.test(ua) ? "Linux"
            : "未知系统";
  const browser = /Edg\//i.test(ua) ? "Edge"
    : /OPR\//i.test(ua) ? "Opera"
      : /Chrome\//i.test(ua) ? "Chrome"
        : /Firefox\//i.test(ua) ? "Firefox"
          : /Safari\//i.test(ua) ? "Safari"
            : "未知浏览器";
  const deviceType = /iPad|Tablet/i.test(ua) ? "平板"
    : /Mobile|Android|iPhone|iPod/i.test(ua) ? "手机"
      : "电脑";
  return {
    raw: ua || "unknown",
    deviceType,
    browser,
    operatingSystem,
    summary: `${operatingSystem} · ${browser} · ${deviceType}`,
  };
}

async function calculateRisk(input: {
  adminUserId: number | null;
  accountHash: string;
  success: boolean;
  ipHash: string;
  deviceHash: string;
  countryCode: string | null;
}) {
  const db = await getDb();
  if (!db) return { level: "normal" as RiskLevel, reason: "安全事件存储暂不可用" };
  const since = new Date(Date.now() - 30 * 60_000);
  const failedRows = await db
    .select({ id: adminLoginEvents.id })
    .from(adminLoginEvents)
    .where(and(
      eq(adminLoginEvents.accountHash, input.accountHash),
      eq(adminLoginEvents.success, false),
      gte(adminLoginEvents.occurredAt, since),
    ))
    .limit(6);
  if (!input.success) {
    const count = failedRows.length + 1;
    if (count >= 5) return { level: "high" as RiskLevel, reason: `30分钟内连续失败${count}次` };
    if (count >= 3) return { level: "attention" as RiskLevel, reason: `30分钟内连续失败${count}次` };
    return { level: "normal" as RiskLevel, reason: "单次登录失败" };
  }
  if (!input.adminUserId) return { level: "normal" as RiskLevel, reason: null };
  const previous = await db
    .select({
      ipHash: adminLoginEvents.ipHash,
      deviceHash: adminLoginEvents.deviceHash,
      countryCode: adminLoginEvents.countryCode,
    })
    .from(adminLoginEvents)
    .where(and(eq(adminLoginEvents.adminUserId, input.adminUserId), eq(adminLoginEvents.success, true)))
    .orderBy(desc(adminLoginEvents.occurredAt))
    .limit(20);
  if (previous.length === 0) return { level: "normal" as RiskLevel, reason: "已建立首次登录基线" };
  const knownDevice = previous.some(item => item.deviceHash === input.deviceHash);
  const knownIp = previous.some(item => item.ipHash === input.ipHash);
  const knownCountry = !input.countryCode || previous.some(item => item.countryCode === input.countryCode);
  if (!knownDevice && !knownCountry) return { level: "high" as RiskLevel, reason: "新设备且登录国家/地区变化" };
  if (!knownDevice) return { level: "attention" as RiskLevel, reason: "新设备登录" };
  if (!knownIp && !knownCountry) return { level: "attention" as RiskLevel, reason: "常用设备但登录国家/地区变化" };
  if (failedRows.length >= 3) return { level: "attention" as RiskLevel, reason: "登录前30分钟内存在多次失败" };
  return { level: "normal" as RiskLevel, reason: knownIp ? "常用设备与网络" : "常用设备，新网络" };
}

async function cleanupOldEvents() {
  if (Date.now() - lastCleanupAt < 60 * 60_000) return;
  lastCleanupAt = Date.now();
  const db = await getDb();
  if (!db) return;
  await db.delete(adminLoginEvents).where(lt(
    adminLoginEvents.occurredAt,
    new Date(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60_000),
  ));
}

export async function recordAdminLoginEvent(input: LoginSecurityInput) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const ipAddress = trustedAdminClientIp(input.req);
  const device = parseAdminDevice(input.req.headers["user-agent"]);
  const accountHash = auditHash("account", canonicalAdminUsername(input.username));
  const ipHash = auditHash("ip", ipAddress);
  const deviceHash = auditHash("device", device.raw);
  const geo = await lookupGeo(ipAddress);
  const risk = await calculateRisk({
    adminUserId: input.adminUserId ?? null,
    accountHash,
    success: input.success,
    ipHash,
    deviceHash,
    countryCode: geo.countryCode,
  });
  const occurredAt = new Date();
  await db.transaction(async tx => {
    await tx.insert(adminLoginEvents).values({
      adminUserId: input.adminUserId ?? null,
      accountHash,
      success: input.success,
      authMethod: input.authMethod,
      ipAddress,
      ipHash,
      countryCode: geo.countryCode,
      location: geo.location,
      deviceHash,
      deviceType: device.deviceType,
      browser: device.browser,
      operatingSystem: device.operatingSystem,
      riskLevel: risk.level,
      riskReason: risk.reason,
      occurredAt,
    });
    if (input.adminUserId) {
      const summary = input.success
        ? {
            lastLoginAt: occurredAt,
            lastLoginIpAddress: ipAddress,
            lastLoginIpHash: ipHash,
            lastLoginLocation: geo.location,
            lastLoginDevice: device.summary,
            lastLoginDeviceHash: deviceHash,
            lastLoginMethod: input.authMethod,
            securityRiskLevel: risk.level,
            securityRiskReason: risk.reason,
            securityRiskAt: occurredAt,
          }
        : risk.level === "normal"
          ? {}
          : {
              securityRiskLevel: risk.level,
              securityRiskReason: risk.reason,
              securityRiskAt: occurredAt,
            };
      if (Object.keys(summary).length > 0) {
        await tx.update(adminUsers).set(summary).where(eq(adminUsers.id, input.adminUserId));
      }
    }
  });
  void cleanupOldEvents().catch(error => console.error("[AdminLoginSecurity] cleanup failed", error));
  return { success: true, occurredAt, riskLevel: risk.level };
}

/** 审计失败不能阻止合法员工登录；成功登录时间仍通过旧字段兜底写入。 */
export async function recordAdminLoginEventSafely(input: LoginSecurityInput) {
  try {
    return await recordAdminLoginEvent(input);
  } catch (error) {
    console.error("[AdminLoginSecurity] event write failed", error);
    if (input.success && input.adminUserId) {
      await touchAdminUserLogin(input.adminUserId).catch(fallbackError => {
        console.error("[AdminLoginSecurity] last login fallback failed", fallbackError);
      });
    }
    return null;
  }
}

export async function getAdminLoginHistory(adminUserId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: adminLoginEvents.id,
      success: adminLoginEvents.success,
      authMethod: adminLoginEvents.authMethod,
      ipAddress: adminLoginEvents.ipAddress,
      countryCode: adminLoginEvents.countryCode,
      location: adminLoginEvents.location,
      deviceType: adminLoginEvents.deviceType,
      browser: adminLoginEvents.browser,
      operatingSystem: adminLoginEvents.operatingSystem,
      riskLevel: adminLoginEvents.riskLevel,
      riskReason: adminLoginEvents.riskReason,
      occurredAt: adminLoginEvents.occurredAt,
    })
    .from(adminLoginEvents)
    .where(eq(adminLoginEvents.adminUserId, adminUserId))
    .orderBy(desc(adminLoginEvents.occurredAt))
    .limit(Math.min(100, Math.max(1, limit)));
}
