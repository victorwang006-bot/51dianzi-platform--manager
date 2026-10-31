import type { Express, Request, Response, NextFunction } from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { createContext } from "./_core/context";
import { businessRouter } from "./businessRouter";

const PRIVATE_NO_STORE_CACHE_CONTROL = "private, no-store, max-age=0";

function normalizedOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The production allow-list is explicit so an untrusted Host header cannot turn
 * into a CSRF exception.  Development accepts loopback only and still requires
 * Origin for unsafe methods.
 */
export function businessGatewayAllowedOrigins(env: NodeJS.ProcessEnv = process.env) {
  const configured = (env.ADMIN_BUSINESS_TRPC_ALLOWED_ORIGINS ?? env.ADMIN_PUBLIC_ORIGIN ?? "")
    .split(",")
    .map(value => normalizedOrigin(value.trim()))
    .filter((value): value is string => value !== null);
  if (configured.length > 0) return new Set(configured);
  if (env.NODE_ENV !== "production") {
    return new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
  }
  return new Set<string>();
}

export function isBusinessGatewayOriginAllowed(
  method: string | undefined,
  origin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
) {
  // GET is a read-only tRPC transport path.  Unsafe requests must carry a
  // configured same-origin Origin; the endpoint currently declares no mutation.
  if ((method ?? "GET").toUpperCase() === "GET") return true;
  const normalized = normalizedOrigin(origin);
  return normalized !== null && businessGatewayAllowedOrigins(env).has(normalized);
}

function businessGatewayRequestGuard(req: Request, res: Response, next: NextFunction) {
  if (!isBusinessGatewayOriginAllowed(req.method, req.header("origin"))) {
    res.status(403).json({ error: "业务接口仅接受受信任同源请求" });
    return;
  }
  res.setHeader("Cache-Control", PRIVATE_NO_STORE_CACHE_CONTROL);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
}

/** Parent must call this once after JSON body middleware and before SPA fallback. */
export function registerBusinessTrpcGateway(app: Express) {
  app.use(
    "/api/business-trpc",
    businessGatewayRequestGuard,
    createExpressMiddleware({
      router: businessRouter,
      createContext,
    }),
  );
}
