import type { Express, Request } from "express";
import { isIP } from "node:net";

/**
 * Only the local Nginx reverse proxy is trusted to provide Express's `req.ip`.
 * Nginx overwrites forwarding headers with its peer address before proxying, and
 * production Node binds to IPv4 loopback. Direct callers therefore cannot
 * promote a forged X-Forwarded-For header into an application client address.
 */
const LOOPBACK_PROXIES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function normalizeIp(ip: string | undefined | null): string {
  const value = ip?.trim() || "";
  if (!value) return "unknown";
  return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
}

/**
 * `TRUSTED_PROXY_IPS` is deliberately an explicit comma-separated IP allowlist.
 * It must not accept a blanket `true`/CIDR setting that would re-enable header
 * spoofing when the topology changes. Loopback is always needed for local Nginx.
 */
export function trustedProxyIps(): Set<string> {
  const configured = (process.env.TRUSTED_PROXY_IPS ?? "")
    .split(",")
    .map(value => normalizeIp(value))
    .filter(value => value !== "unknown" && isIP(value) !== 0);
  return new Set(Array.from(LOOPBACK_PROXIES, normalizeIp).concat(configured));
}

export function isTrustedProxyAddress(address: string | undefined | null): boolean {
  return trustedProxyIps().has(normalizeIp(address));
}

/** Configure Express before any request middleware is registered. */
export function configureTrustedProxy(app: Express): void {
  app.set("trust proxy", (address: string) => isTrustedProxyAddress(address));
}

/**
 * Get the address selected by Express's trusted-proxy mechanism. This function
 * intentionally does not read X-Forwarded-For or X-Real-IP itself.
 */
export function trustedClientIp(
  req: Pick<Request, "ip" | "socket">,
): string {
  const expressIp = normalizeIp(req.ip);
  if (expressIp !== "unknown") return expressIp;
  return normalizeIp(req.socket?.remoteAddress);
}
