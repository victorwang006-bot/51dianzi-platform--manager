import { createHmac, timingSafeEqual } from "node:crypto";
import { ENV } from "../_core/env";

const TOKEN_DOMAIN = "51dianzi.product-related-detail.v1";
export const RELATED_DETAIL_TOKEN_TTL_MS = 5 * 60 * 1000;

type RelatedDetailReadTokenPayload = {
  v: 1;
  userId: number;
  inventoryId: number;
  exp: number;
};

function signingSecret(): string {
  // ENV captures the usual JWT_SECRET configuration; the direct environment fallback
  // keeps this verifier testable and supports late-initialized worker environments.
  return ENV.cookieSecret || process.env.JWT_SECRET || "";
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${TOKEN_DOMAIN}.${payload}`, "utf8")
    .digest("base64url");
}

function validPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Signs one successful quota-backed product detail for a single logged-in user. */
export function issueRelatedDetailReadToken(input: {
  userId: number;
  inventoryId: number;
  now?: Date;
}): string {
  if (!validPositiveInteger(input.userId) || !validPositiveInteger(input.inventoryId)) {
    throw new Error("Invalid related detail read-token subject");
  }
  const secret = signingSecret();
  if (!secret) throw new Error("Related detail read-token signing secret is unavailable");

  const now = input.now ?? new Date();
  const payload: RelatedDetailReadTokenPayload = {
    v: 1,
    userId: input.userId,
    inventoryId: input.inventoryId,
    exp: now.getTime() + RELATED_DETAIL_TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded, secret)}`;
}

/**
 * Verifies the exact token context before any recommendation read. A token has no
 * database state, so short-term replay by its original user is intentionally allowed
 * only for the exact same published inventory it was issued for.
 */
export function verifyRelatedDetailReadToken(input: {
  token: string;
  userId: number;
  inventoryId: number;
  now?: Date;
}): boolean {
  if (!validPositiveInteger(input.userId) || !validPositiveInteger(input.inventoryId)) return false;
  const secret = signingSecret();
  if (!secret || typeof input.token !== "string" || input.token.length > 2048) return false;

  const pieces = input.token.split(".");
  if (pieces.length !== 2 || !pieces[0] || !pieces[1]) return false;
  const [encoded, suppliedSignature] = pieces;
  const expectedSignature = signature(encoded, secret);
  const supplied = Buffer.from(suppliedSignature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;

  let payload: RelatedDetailReadTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as RelatedDetailReadTokenPayload;
  } catch {
    return false;
  }
  if (
    payload?.v !== 1
    || !validPositiveInteger(payload.userId)
    || !validPositiveInteger(payload.inventoryId)
    || typeof payload.exp !== "number"
    || !Number.isSafeInteger(payload.exp)
  ) return false;

  const now = input.now ?? new Date();
  return payload.userId === input.userId
    && payload.inventoryId === input.inventoryId
    && payload.exp > now.getTime();
}
