import { createHmac, timingSafeEqual } from "node:crypto";

export const OWNERSHIP_TRANSFER_SMS_SCENE = "enterpriseOwnershipTransfer" as const;
export const OWNERSHIP_TRANSFER_TICKET_TTL_SECONDS = 10 * 60;

type OwnershipTransferTicketClaims = {
  version: 1;
  actorUserId: number;
  enterpriseId: number;
  expectedOwnerUserId: number;
  targetUserId: number;
  requestId: string;
  issuedAt: number;
  expiresAt: number;
};

export type OwnershipTransferTicketBinding = Pick<
  OwnershipTransferTicketClaims,
  "actorUserId" | "enterpriseId" | "expectedOwnerUserId" | "targetUserId" | "requestId"
>;

/** 同一绑定生成相同上下文，不同企业、所有者、目标或请求号均不可复用验证码。 */
export function ownershipTransferVerificationContextKey(binding: OwnershipTransferTicketBinding) {
  return JSON.stringify({
    actorUserId: binding.actorUserId,
    enterpriseId: binding.enterpriseId,
    expectedOwnerUserId: binding.expectedOwnerUserId,
    targetUserId: binding.targetUserId,
    requestId: binding.requestId,
  });
}

type TicketOptions = {
  /** Test-only dependency injection; production resolves a server-side secret. */
  secret?: string;
  now?: Date;
};

function ticketSecret(explicitSecret?: string) {
  if (explicitSecret) return explicitSecret;
  const configured = process.env.OWNERSHIP_TRANSFER_TICKET_SECRET?.trim()
    || process.env.JWT_SECRET?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("企业所有者转让确认服务未配置签名密钥");
  }
  // Local/test-only fallback. Production must supply a secret above.
  return "development-only-ownership-transfer-ticket-secret";
}

function encode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function signatureMatches(encodedPayload: string, suppliedSignature: string, secret: string) {
  const expected = Buffer.from(sign(encodedPayload, secret));
  const supplied = Buffer.from(suppliedSignature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function isValidClaimShape(value: unknown): value is OwnershipTransferTicketClaims {
  const claims = value as Partial<OwnershipTransferTicketClaims> | null;
  return Boolean(
    claims
    && claims.version === 1
    && Number.isSafeInteger(claims.actorUserId) && (claims.actorUserId ?? 0) > 0
    && Number.isSafeInteger(claims.enterpriseId) && (claims.enterpriseId ?? 0) > 0
    && Number.isSafeInteger(claims.expectedOwnerUserId) && (claims.expectedOwnerUserId ?? 0) > 0
    && Number.isSafeInteger(claims.targetUserId) && (claims.targetUserId ?? 0) > 0
    && typeof claims.requestId === "string" && claims.requestId.length >= 8 && claims.requestId.length <= 64
    && Number.isSafeInteger(claims.issuedAt)
    && Number.isSafeInteger(claims.expiresAt)
    && (claims.expiresAt ?? 0) > (claims.issuedAt ?? 0),
  );
}

/**
 * Mints an opaque, HMAC-signed verification ticket. The authorization-critical
 * binding is in the signed payload, never in a client-provided boolean.
 */
export function createOwnershipTransferVerificationTicket(
  binding: OwnershipTransferTicketBinding,
  options: TicketOptions = {},
) {
  const issuedAt = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const claims: OwnershipTransferTicketClaims = {
    version: 1,
    ...binding,
    issuedAt,
    expiresAt: issuedAt + OWNERSHIP_TRANSFER_TICKET_TTL_SECONDS,
  };
  const encodedPayload = encode(JSON.stringify(claims));
  return `${encodedPayload}.${sign(encodedPayload, ticketSecret(options.secret))}`;
}

/**
 * Returns verified claims only when the HMAC, expiry, and every expected
 * transfer binding match. Invalid tickets intentionally reveal no cause.
 */
export function verifyOwnershipTransferVerificationTicket(
  ticket: string,
  expected: OwnershipTransferTicketBinding,
  options: TicketOptions = {},
): OwnershipTransferTicketBinding | null {
  const parts = ticket.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!signatureMatches(parts[0], parts[1], ticketSecret(options.secret))) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(decode(parts[0]));
  } catch {
    return null;
  }
  if (!isValidClaimShape(claims)) return null;

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (claims.expiresAt <= nowSeconds) return null;
  if (
    claims.actorUserId !== expected.actorUserId
    || claims.enterpriseId !== expected.enterpriseId
    || claims.expectedOwnerUserId !== expected.expectedOwnerUserId
    || claims.targetUserId !== expected.targetUserId
    || claims.requestId !== expected.requestId
  ) {
    return null;
  }
  return {
    actorUserId: claims.actorUserId,
    enterpriseId: claims.enterpriseId,
    expectedOwnerUserId: claims.expectedOwnerUserId,
    targetUserId: claims.targetUserId,
    requestId: claims.requestId,
  };
}

export function maskOwnershipTransferPhone(phone: string) {
  const normalized = phone.trim();
  if (normalized.length >= 8) {
    return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
  }
  // Never degrade to returning a malformed/legacy full phone number.
  return "****";
}
