import { createHash } from "node:crypto";
import { z } from "zod";

export const LEGACY_CONFIRMATION_ACTION = "legacyOriginalActorConfirmation" as const;
const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const requestId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$(?![\s\S])/);
// Canonical UTC only: no locale/offset ambiguity and no invalid calendar dates.
const timestamp = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$(?![\s\S])/)
  .refine(value => { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value; });

/** Internal operations contract only. Never use as a browser input schema.
 * These attestations do NOT query/verify the backend account or the binding;
 * the authorized operator must fresh-check both before building/appending. */
export const legacyOriginalActorConfirmationSchema = z.object({
  action: z.literal(LEGACY_CONFIRMATION_ACTION),
  legacyOriginalActor: z.object({
    schemaVersion: z.literal(1),
    enterpriseId: positiveId,
    materialId: positiveId,
    originalCreateRequestId: requestId,
    identityNamespace: z.literal("backend-admin"),
    adminAccountId: positiveId,
    staffUserId: positiveId,
    bindingVersion: positiveId,
    confirmationRequestId: requestId,
    confirmationSource: z.literal("project-owner-confirmation"),
    evidence: z.object({
      taskId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$(?![\s\S])/),
      messageTimestamp: timestamp,
      messageTextSha256: z.string().regex(/^[a-f0-9]{64}$(?![\s\S])/),
      backendAccountStatus: z.literal("active"),
      backendAccountVerifiedAt: timestamp,
      bindingVerifiedAt: timestamp,
    }).strict(),
  }).strict(),
}).strict().superRefine((event, context) => {
  if (event.legacyOriginalActor.originalCreateRequestId === event.legacyOriginalActor.confirmationRequestId) {
    context.addIssue({ code: "custom", message: "Confirmation must use a separate idempotency key", path: ["legacyOriginalActor", "confirmationRequestId"] });
  }
});
export type LegacyOriginalActorConfirmation = z.infer<typeof legacyOriginalActorConfirmationSchema>;

/** Stable line-framed SHA256 contract. Every leaf is constrained to exclude LF.
 * SQL recomputes exactly this digest, not MySQL's JSON pretty serialization. */
export const LEGACY_CONFIRMATION_HASH_PATHS = [
  "action", "legacyOriginalActor.schemaVersion", "legacyOriginalActor.enterpriseId",
  "legacyOriginalActor.materialId", "legacyOriginalActor.originalCreateRequestId",
  "legacyOriginalActor.identityNamespace", "legacyOriginalActor.adminAccountId",
  "legacyOriginalActor.staffUserId", "legacyOriginalActor.bindingVersion",
  "legacyOriginalActor.confirmationRequestId", "legacyOriginalActor.confirmationSource",
  "legacyOriginalActor.evidence.taskId", "legacyOriginalActor.evidence.messageTimestamp",
  "legacyOriginalActor.evidence.messageTextSha256", "legacyOriginalActor.evidence.backendAccountStatus",
  "legacyOriginalActor.evidence.backendAccountVerifiedAt", "legacyOriginalActor.evidence.bindingVerifiedAt",
] as const;

export function validateLegacyOriginalActorConfirmation(value: unknown): LegacyOriginalActorConfirmation {
  return legacyOriginalActorConfirmationSchema.parse(value);
}

/** Builds data only; no connection, INSERT/UPDATE, execution or public endpoint.
 * payload_hash covers every after_data leaf. Idempotent append must independently
 * compare the complete existing row, never use ON DUPLICATE KEY UPDATE. */
export function buildLegacyOriginalActorConfirmation(value: unknown) {
  const after = validateLegacyOriginalActorConfirmation(value);
  const actor = after.legacyOriginalActor;
  const values = LEGACY_CONFIRMATION_HASH_PATHS.map(path => path.split(".").reduce<any>((item, key) => item[key], after));
  const payloadHash = createHash("sha256").update(values.join("\n"), "utf8").digest("hex");
  return {
    enterprise_id: actor.enterpriseId,
    material_id: actor.materialId,
    actor_user_id: actor.staffUserId,
    request_id: actor.confirmationRequestId,
    payload_hash: payloadHash,
    before_data: null,
    after_data: after,
  };
}
