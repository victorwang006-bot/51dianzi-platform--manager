import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

/** Selection tokens are intentionally short lived: the inventory snapshot is volatile. */
export const SPOT_VERIFICATION_SELECTION_TOKEN_TTL_MS = 10 * 60 * 1000;
export const SPOT_VERIFICATION_SELECTION_TOKEN_MAX_LENGTH = 8192;
export const SPOT_VERIFICATION_SELECTION_TOKEN_VERSION = "v1";
export const SPOT_VERIFICATION_SELECTION_TOKEN_INVALID_MESSAGE =
  "现货核验选择已失效，请重新拍摄";
export const SPOT_VERIFICATION_SELECTION_TOKEN_UNAVAILABLE_MESSAGE =
  "现货核验暂不可用，请稍后再试";

export class SpotVerificationSelectionTokenError extends Error {
  constructor(
    readonly reason: "invalid" | "unavailable",
    message = reason === "unavailable"
      ? SPOT_VERIFICATION_SELECTION_TOKEN_UNAVAILABLE_MESSAGE
      : SPOT_VERIFICATION_SELECTION_TOKEN_INVALID_MESSAGE
  ) {
    super(message);
    this.name = "SpotVerificationSelectionTokenError";
  }
}

const positiveIdSchema = z.number().int().positive().max(2_147_483_647);
const partNumberSchema = z.string().min(1).max(128);
// Exact matching is valid for historical rows with an empty brand. Packaging remains gated by
// selectSpotInventoryCandidates, which requires a separately approved non-empty brand alias.
const brandSchema = z.string().max(64);
const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const photoMimeTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

export const spotVerificationSelectionScopeSchema = z
  .object({
    dataOwnerUserId: positiveIdSchema,
    enterpriseId: positiveIdSchema,
    /** The authenticated actor that submitted the photo and must confirm the selection. */
    verifiedByUserId: positiveIdSchema,
    /** null deliberately differs from a scoped owner ID. */
    ownerUserId: positiveIdSchema.nullable(),
  })
  .strict();

const selectionCandidateSchema = z
  .object({
    id: positiveIdSchema,
    partNumber: partNumberSchema,
    brand: brandSchema,
    fingerprint: fingerprintSchema,
    matchKind: z.enum(["exact", "packaging"]),
  })
  .strict();

/**
 * The encrypted payload commits to photo bytes and MIME, but deliberately not an uploaded
 * object key: selection cancellation/expiry therefore cannot leave an unreferenced upload.
 */
export const spotVerificationSelectionTokenPayloadSchema = z
  .object({
    v: z.literal(1),
    iat: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    exp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    scope: spotVerificationSelectionScopeSchema,
    mimeType: photoMimeTypeSchema,
    photoSha256: sha256Schema,
    requestId: z
      .string()
      .min(8)
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/),
    recognizedPartNumber: partNumberSchema,
    markingSource: z.enum(["printed", "laser"]),
    modelName: z.string().min(1).max(128),
    candidates: z.array(selectionCandidateSchema).min(1).max(5),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (
      payload.exp - payload.iat !==
      SPOT_VERIFICATION_SELECTION_TOKEN_TTL_MS
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["exp"],
        message: "invalid selection token lifetime",
      });
    }
    const ids = new Set<number>();
    payload.candidates.forEach((candidate, index) => {
      if (ids.has(candidate.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["candidates", index, "id"],
          message: "duplicate selection candidate",
        });
      }
      ids.add(candidate.id);
    });
  });

export type SpotVerificationSelectionTokenPayload = z.infer<
  typeof spotVerificationSelectionTokenPayloadSchema
>;
export type SpotVerificationSelectionTokenScope = z.infer<
  typeof spotVerificationSelectionScopeSchema
>;

type TokenOptions = {
  /** Explicit injection makes tests deterministic and prevents a process-local fallback secret. */
  secret: string;
  now?: Date | number;
};

const TOKEN_AAD = Buffer.from("spot-verification-selection-token:v1", "utf8");
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function invalidToken(): never {
  throw new SpotVerificationSelectionTokenError("invalid");
}

function timestamp(now?: Date | number): number {
  const candidate = now instanceof Date ? now.getTime() : (now ?? Date.now());
  if (!Number.isSafeInteger(candidate) || candidate < 0) invalidToken();
  return candidate;
}

/**
 * Derive one stable AES-256-GCM key from the deployment cookie secret. A fixed domain
 * separator prevents reusing the cookie/JWT key material directly or across protocols.
 */
export function spotVerificationSelectionTokenKey(secret: string): Buffer {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 16) {
    throw new SpotVerificationSelectionTokenError("unavailable");
  }
  return createHash("sha256")
    .update("51dianzi:spot-verification-selection-token:v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

/** Validates deployment configuration before a photo/OCR operation is performed. */
export function assertSpotVerificationSelectionTokenSecret(
  secret: string
): void {
  spotVerificationSelectionTokenKey(secret);
}

function parsePayload(value: unknown): SpotVerificationSelectionTokenPayload {
  const parsed = spotVerificationSelectionTokenPayloadSchema.safeParse(value);
  if (!parsed.success) invalidToken();
  return parsed.data;
}

function decodeBase64Url(value: string): Buffer {
  if (!value || !BASE64URL.test(value)) invalidToken();
  const decoded = Buffer.from(value, "base64url");
  // Node tolerates malformed base64url; canonical re-encoding closes that parser gap.
  if (!decoded.length || decoded.toString("base64url") !== value)
    invalidToken();
  return decoded;
}

/** Encrypt and authenticate a bounded selection payload using AES-256-GCM. */
export function encodeSpotVerificationSelectionToken(
  input: Omit<SpotVerificationSelectionTokenPayload, "v" | "iat" | "exp">,
  options: TokenOptions
): string {
  const now = timestamp(options.now);
  const payload = parsePayload({
    ...input,
    v: 1,
    iat: now,
    exp: now + SPOT_VERIFICATION_SELECTION_TOKEN_TTL_MS,
  });
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  if (plaintext.length > 6144) invalidToken();

  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    spotVerificationSelectionTokenKey(options.secret),
    iv
  );
  cipher.setAAD(TOKEN_AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const token = [
    SPOT_VERIFICATION_SELECTION_TOKEN_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
  if (token.length > SPOT_VERIFICATION_SELECTION_TOKEN_MAX_LENGTH)
    invalidToken();
  return token;
}

/** Decrypt, strictly validate, and enforce the 10-minute lifetime of a selection token. */
export function decodeSpotVerificationSelectionToken(
  token: string,
  options: TokenOptions
): SpotVerificationSelectionTokenPayload {
  try {
    if (
      typeof token !== "string" ||
      token.length < 32 ||
      token.length > SPOT_VERIFICATION_SELECTION_TOKEN_MAX_LENGTH
    ) {
      invalidToken();
    }
    const [version, ivText, ciphertextText, tagText, extra] = token.split(".");
    if (
      version !== SPOT_VERIFICATION_SELECTION_TOKEN_VERSION ||
      !ivText ||
      !ciphertextText ||
      !tagText ||
      extra !== undefined
    ) {
      invalidToken();
    }
    const iv = decodeBase64Url(ivText);
    const ciphertext = decodeBase64Url(ciphertextText);
    const tag = decodeBase64Url(tagText);
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 6144)
      invalidToken();

    const decipher = createDecipheriv(
      "aes-256-gcm",
      spotVerificationSelectionTokenKey(options.secret),
      iv
    );
    decipher.setAAD(TOKEN_AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    if (!plaintext.length || plaintext.length > 6144) invalidToken();
    const payload = parsePayload(JSON.parse(plaintext.toString("utf8")));
    const now = timestamp(options.now);
    // Tokens are issued by our clock, so a future issue time is suspicious rather than tolerated.
    if (payload.iat > now || payload.exp <= now) invalidToken();
    return payload;
  } catch (error) {
    if (error instanceof SpotVerificationSelectionTokenError) throw error;
    invalidToken();
  }
}
