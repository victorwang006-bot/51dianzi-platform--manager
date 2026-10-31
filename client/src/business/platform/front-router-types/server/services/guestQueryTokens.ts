import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { getSessionCookieOptions } from "../_core/cookies";
import { ENV } from "../_core/env";

const COOKIE_NAME = "guest_query_identity";
const COOKIE_DOMAIN = "51dianzi.guest-query.cookie.v1";
const TOKEN_DOMAIN = "51dianzi.guest-query.grant.v1";
export const GUEST_QUERY_GRANT_TTL_MS = 30 * 60 * 1000;

export type GuestQueryGrantToken = {
  v: 1;
  identityHash: string;
  grantId: string;
  scopeHash: string;
  exp: number;
};

function signingSecret(): string {
  // Read the process environment too: tests and workers may initialize it after
  // the ENV module was loaded. No configured secret means fail closed.
  return (ENV.cookieSecret || process.env.JWT_SECRET || process.env.COOKIE_SECRET || "").trim();
}

function sign(domain: string, payload: string, secret: string): string {
  return createHmac("sha256", secret).update(`${domain}.${payload}`, "utf8").digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function verifiedPayload<T>(domain: string, value: string): T | null {
  const secret = signingSecret();
  if (!secret || typeof value !== "string" || value.length < 3 || value.length > 2048) return null;
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encoded, suppliedSignature] = parts;
  if (!safeEqual(sign(domain, encoded, secret), suppliedSignature)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function cookieValues(req: Request, name: string): string[] {
  const header = req.headers.cookie;
  if (!header) return [];
  // Do not trust a parser's duplicate-cookie winner. Verify every same-name
  // candidate and accept only a valid signed value.
  return header.split(";").flatMap(chunk => {
    const index = chunk.indexOf("=");
    if (index < 1 || chunk.slice(0, index).trim() !== name) return [];
    try {
      return [decodeURIComponent(chunk.slice(index + 1).trim())];
    } catch {
      return [];
    }
  });
}

function validIdentity(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

/** Returns only an identity minted and HMAC-signed by this server. */
export function readGuestQueryIdentity(req: Request): string | null {
  for (const value of cookieValues(req, COOKIE_NAME)) {
    const payload = verifiedPayload<{ v: 1; id: string; exp: number }>(COOKIE_DOMAIN, value);
    if (
      payload?.v === 1 &&
      validIdentity(payload.id) &&
      Number.isSafeInteger(payload.exp) &&
      payload.exp > Date.now()
    ) return payload.id;
  }
  return null;
}

/** Issues an HttpOnly first-party identity using the site's existing cookie policy. */
export function issueGuestQueryIdentity(req: Request, res: Response, now = new Date()): string {
  const secret = signingSecret();
  if (!secret) throw new Error("Guest query signing secret is unavailable");
  const id = randomBytes(32).toString("base64url");
  // The cookie lives longer than one authorization. The persistent wallet—not
  // cookie expiry—owns the never-reset experience count.
  const exp = now.getTime() + 180 * 24 * 60 * 60 * 1000;
  const encoded = Buffer.from(JSON.stringify({ v: 1, id, exp }), "utf8").toString("base64url");
  res.cookie(COOKIE_NAME, `${encoded}.${sign(COOKIE_DOMAIN, encoded, secret)}`, {
    ...getSessionCookieOptions(req),
    maxAge: exp - now.getTime(),
  });
  return id;
}

export function issueGuestQueryGrantToken(input: Omit<GuestQueryGrantToken, "v">): string {
  const secret = signingSecret();
  if (!secret) throw new Error("Guest query signing secret is unavailable");
  const payload: GuestQueryGrantToken = { v: 1, ...input };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(TOKEN_DOMAIN, encoded, secret)}`;
}

export function verifyGuestQueryGrantToken(token: string, now = new Date()): GuestQueryGrantToken | null {
  const payload = verifiedPayload<GuestQueryGrantToken>(TOKEN_DOMAIN, token);
  if (
    payload?.v !== 1 ||
    !validIdentity(payload.grantId) ||
    !/^[a-f0-9]{64}$/.test(payload.identityHash) ||
    !/^[a-f0-9]{64}$/.test(payload.scopeHash) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= now.getTime()
  ) return null;
  return payload;
}
