/** Server-issued classification; never inferred from a message or browser input. */
export const BUSINESS_FAILURES = [
  "AUTH_SESSION_INVALID", "STAFF_BINDING_INVALID", "TENANT_ACCESS_REVOKED", "BUSINESS_RESOURCE_FORBIDDEN",
] as const;
export type BusinessFailure = (typeof BUSINESS_FAILURES)[number];
export function isBusinessFailure(value: unknown): value is BusinessFailure {
  return typeof value === "string" && (BUSINESS_FAILURES as readonly string[]).includes(value);
}
/** Error cause is created only by authenticated server authorization boundaries. */
export class BusinessFailureCause extends Error {
  constructor(readonly businessFailure: BusinessFailure) { super(businessFailure); this.name = "BusinessFailureCause"; }
}
/** A denied service credential is NOT the staff/browser login session expiring. */
export class BusinessServiceAuthenticationCause extends Error {
  constructor() { super("Internal business service authentication failed"); this.name = "BusinessServiceAuthenticationCause"; }
}
export function businessFailureOf(error: unknown): BusinessFailure | undefined {
  let current = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const value = current as { businessFailure?: unknown; cause?: unknown };
    if (isBusinessFailure(value.businessFailure)) return value.businessFailure;
    current = value.cause;
  }
  return undefined;
}
/** Only authorization codes receive defaults; business state CONFLICT etc remains local. */
export function businessFailureForError(error: { code: string; cause?: unknown }): BusinessFailure | undefined {
  let cause = error.cause;
  for (let depth = 0; depth < 6 && cause && typeof cause === "object"; depth++) {
    if (cause instanceof BusinessServiceAuthenticationCause) return undefined;
    cause = (cause as { cause?: unknown }).cause;
  }
  return businessFailureOf(error) ?? (error.code === "UNAUTHORIZED" ? "AUTH_SESSION_INVALID"
    : error.code === "FORBIDDEN" ? "BUSINESS_RESOURCE_FORBIDDEN" : undefined);
}
