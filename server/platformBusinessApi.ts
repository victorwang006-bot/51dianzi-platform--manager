import { createHmac } from "node:crypto";
import { isBusinessFailure, type BusinessFailure } from "../shared/businessFailure";
import type { OfficialInventoryPermissions } from "../client/src/business/platform/shared/internalBusinessOfficialInventory";

export type PlatformBusinessBinding = {
  creditCode?: string;
  registrationIdentifier?: string;
  expectedOwnerUserId: number;
};

export type PlatformBusinessStaffPrincipal = {
  status: "ready";
  frontendUserId: number;
  /** Exact browser contract is supplied by the front AppRouter closure; never an admin/owner substitute. */
  user: {
    id: number;
    openId: string;
    username: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    role: "user" | "admin";
    loginDisabled: boolean;
    crmAccess: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastSignedIn: Date;
    hasPassword: boolean;
    emailVerified: boolean;
  };
  adminAccountId: number;
  enterpriseId: number;
  bindingVersion: number;
};

export type PlatformBusinessContext = {
  enterpriseId: number;
  companyName: string;
  dataOwnerUserId: number;
  ownerUserId: number;
  /** Opaque front-server authorization state, forwarded without browser influence. */
  authorizationVersion?: string;
  staffPrincipal: PlatformBusinessStaffPrincipal | {
    status: "required";
    reason: "ADMIN_STAFF_PRINCIPAL_NOT_BOUND";
  };
  enabledModules: readonly string[];
  /** Current portal-derived, display-only workbench projection; never adminPermissions. */
  workbenchCapabilities: readonly string[];
  /** Derived by the front internal service from the ready staff principal and real permission checks. */
  officialInventoryPermissions?: OfficialInventoryPermissions;
  sessionCapabilities: Readonly<{
    /** Full personal chat remains unavailable to the admin workbench. */
    chat: false;
    /** Narrow enterprise reception surface only. */
    receptionReady: boolean;
  }>;
};

export type PlatformBusinessStaffCandidate = {
  frontendUserId: number;
  user: PlatformBusinessStaffPrincipal["user"];
};

export type { OfficialInventoryPermissions };

export type PlatformBusinessCommand = {
  officialInventoryPermissions?: OfficialInventoryPermissions;
  binding: PlatformBusinessBinding;
  staffUserId: number;
  bindingVersion: number;
  adminActor: { id: number; name: string; role: string };
  requestId: string;
  method: string;
  params: unknown;
};

type TrpcEnvelope<T> = {
  result?: { data?: { json?: T } | T };
  error?: { json?: { message?: string; data?: { code?: string; message?: string; businessFailure?: unknown } }; message?: string };
};

/** Only domain-safe codes may cross the service-to-service error boundary. */
export const PLATFORM_BUSINESS_PUBLIC_ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "TOO_MANY_REQUESTS",
  "TIMEOUT",
] as const;

export type PlatformBusinessPublicErrorCode = (typeof PLATFORM_BUSINESS_PUBLIC_ERROR_CODES)[number];

export class PlatformBusinessPublicError extends Error {
  constructor(readonly code: PlatformBusinessPublicErrorCode, message: string, readonly businessFailure?: BusinessFailure) {
    super(message);
    this.name = "PlatformBusinessPublicError";
  }
}

/**
 * Non-domain transport/configuration failures are deliberately opaque.  Callers
 * may use `kind` for controlled handling and observability, never the upstream
 * exception message, response body or request secrets.
 */
export const PLATFORM_BUSINESS_FAILURE_KINDS = [
  "CONFIGURATION",
  "NETWORK",
  "TIMEOUT",
  "UPSTREAM_4XX",
  "UPSTREAM_5XX",
  "PARSE",
  "INVALID_RESPONSE",
  "UNKNOWN",
] as const;

export type PlatformBusinessFailureKind = (typeof PLATFORM_BUSINESS_FAILURE_KINDS)[number];

export type PlatformBusinessUpstreamTiming = Readonly<{
  configMs: number;
  requestMs: number;
  decodeMs: number;
}>;

export class PlatformBusinessServiceError extends Error {
  constructor(
    readonly kind: PlatformBusinessFailureKind,
    readonly timing: PlatformBusinessUpstreamTiming,
  ) {
    super("主站业务服务暂不可用，请稍后重试");
    this.name = "PlatformBusinessServiceError";
  }
}

export type PlatformBusinessCallOptions = Readonly<{
  /** Receives only phase durations, never a URL, response body, error or secret. */
  onUpstreamTiming?: (timing: PlatformBusinessUpstreamTiming) => void;
}>;

function getConfig() {
  const baseUrl = process.env.PLATFORM_API_BASE?.trim()
    || (process.env.NODE_ENV === "production" ? "http://127.0.0.1:3000" : "");
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!baseUrl) throw new Error("PLATFORM_API_BASE 未配置");
  if (!key) throw new Error("PORTAL_API_KEY 未配置");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), key };
}

function firstEnvelope<T>(payload: unknown): TrpcEnvelope<T> | null {
  if (Array.isArray(payload)) return (payload[0] as TrpcEnvelope<T> | undefined) ?? null;
  if (payload && typeof payload === "object") return payload as TrpcEnvelope<T>;
  return null;
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function reportTiming(options: PlatformBusinessCallOptions | undefined, timing: PlatformBusinessUpstreamTiming) {
  try {
    options?.onUpstreamTiming?.(timing);
  } catch {
    // Observability must never change the authorization or transport result.
  }
}

function isTimeout(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function serviceFailure(
  kind: PlatformBusinessFailureKind,
  timing: PlatformBusinessUpstreamTiming,
  options?: PlatformBusinessCallOptions,
): PlatformBusinessServiceError {
  reportTiming(options, timing);
  return new PlatformBusinessServiceError(kind, timing);
}

function withFailureKind(
  kind: PlatformBusinessFailureKind,
  timing: PlatformBusinessUpstreamTiming,
): PlatformBusinessServiceError {
  return new PlatformBusinessServiceError(kind, timing);
}

function publicUpstreamError(error: TrpcEnvelope<unknown>["error"]) {
  const code = error?.json?.data?.code;
  const message = error?.json?.message ?? error?.json?.data?.message ?? error?.message;
  if (
    typeof code !== "string"
    || !(PLATFORM_BUSINESS_PUBLIC_ERROR_CODES as readonly string[]).includes(code)
    || typeof message !== "string"
  ) return null;
  const safeMessage = message.trim().replace(/[\r\n\t]+/g, " ").slice(0, 512);
  // A valid domain message is normally Chinese/plain text. Reject accidental
  // implementation traces or configuration fragments even when an upstream
  // procedure mislabels the error code.
  if (!safeMessage || /(?:stack|password|secret|token|portal[_ -]?key|sql|select\s)/i.test(safeMessage)) return null;
  const failure = error?.json?.data?.businessFailure;
  // Only an authenticated internalBusiness request may report a real login
  // failure. A service-key denial is deliberately unmarked by the front router.
  if (code === "UNAUTHORIZED" && failure !== "AUTH_SESSION_INVALID") return null;
  return new PlatformBusinessPublicError(code as PlatformBusinessPublicErrorCode, safeMessage, isBusinessFailure(failure) ? failure : undefined);
}

function trpcInput(input: unknown) {
  return JSON.stringify({ "0": { json: input } });
}

async function callPlatformTrpc<T>(input: {
  procedure: string;
  kind: "query" | "mutation";
  payload: unknown;
}, options?: PlatformBusinessCallOptions): Promise<T> {
  const startedAt = Date.now();
  let configMs = 0;
  let requestMs = 0;
  let decodeMs = 0;
  const timing = () => ({ configMs, requestMs, decodeMs });

  let config: ReturnType<typeof getConfig>;
  try {
    config = getConfig();
    configMs = elapsedMs(startedAt);
  } catch {
    configMs = elapsedMs(startedAt);
    throw serviceFailure("CONFIGURATION", timing(), options);
  }

  let payloadToSend = input.payload;
  if ((input.procedure === "internalBusiness.context" || input.procedure === "internalBusiness.execute") && input.payload && typeof input.payload === "object") {
    const { officialInventoryPermissions, ...payload } = input.payload as Record<string, any>;
    if (officialInventoryPermissions) {
      const target = {
        ...(payload.creditCode ? { creditCode: payload.creditCode } : {}),
        ...(payload.registrationIdentifier ? { registrationIdentifier: payload.registrationIdentifier } : {}),
        expectedOwnerUserId: payload.expectedOwnerUserId, staffUserId: payload.staffUserId,
        adminAccountId: payload.adminActor?.id ?? payload.adminAccountId, bindingVersion: payload.bindingVersion,
        method: input.procedure === "internalBusiness.context" ? "internalBusiness.context" : payload.method,
        requestId: input.procedure === "internalBusiness.context" ? "context-grant" : payload.requestId,
      };
      payloadToSend = { ...payload, officialInventoryGrant: signOfficialInventoryGrant(officialInventoryPermissions, target, config.key) };
    }
  }
  const encoded = trpcInput(payloadToSend);
  const url = `${config.baseUrl}/api/trpc/${input.procedure}?batch=1${input.kind === "query" ? `&input=${encodeURIComponent(encoded)}` : ""}`;
  let response: Response;
  const requestStartedAt = Date.now();
  try {
    response = await fetch(url, {
      method: input.kind === "query" ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-portal-key": config.key,
      },
      // Only server-derived JSON is sent. No Cookie or Authorization is propagated.
      body: input.kind === "mutation" ? encoded : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    requestMs = elapsedMs(requestStartedAt);
  } catch (error) {
    requestMs = elapsedMs(requestStartedAt);
    throw serviceFailure(isTimeout(error) ? "TIMEOUT" : "NETWORK", timing(), options);
  }

  let payload: unknown;
  const decodeStartedAt = Date.now();
  try {
    payload = await response.json();
    decodeMs = elapsedMs(decodeStartedAt);
  } catch {
    decodeMs = elapsedMs(decodeStartedAt);
    throw serviceFailure("PARSE", timing(), options);
  }

  const envelope = firstEnvelope<T>(payload);
  // A 5xx response is not a trustworthy domain denial even if its body happens
  // to resemble a tRPC envelope. It must remain a controlled availability error.
  if (response.status >= 500) {
    throw serviceFailure("UPSTREAM_5XX", timing(), options);
  }
  if (envelope?.error) {
    const publicError = publicUpstreamError(envelope.error);
    if (publicError) {
      reportTiming(options, timing());
      throw publicError;
    }
    if (response.status === 429) {
      reportTiming(options, timing());
      throw new PlatformBusinessPublicError("TOO_MANY_REQUESTS", "业务服务请求过于频繁，请稍后重试");
    }
    throw serviceFailure("UPSTREAM_4XX", timing(), options);
  }
  if (!response.ok) {
    if (response.status === 429) {
      reportTiming(options, timing());
      throw new PlatformBusinessPublicError("TOO_MANY_REQUESTS", "业务服务请求过于频繁，请稍后重试");
    }
    throw serviceFailure("UPSTREAM_4XX", timing(), options);
  }

  const data = envelope?.result?.data;
  const result = (typeof data === "object" && data !== null && "json" in data ? data.json : data) as T | undefined;
  if (result === undefined) {
    throw serviceFailure("INVALID_RESPONSE", timing(), options);
  }
  reportTiming(options, timing());
  return result;
}

export async function getPlatformBusinessContext(
  input: PlatformBusinessBinding,
  trustedBinding?: { staffUserId: number; adminAccountId: number; bindingVersion: number; officialInventoryPermissions?: OfficialInventoryPermissions },
  options?: PlatformBusinessCallOptions,
): Promise<PlatformBusinessContext> {
  let upstreamTiming: PlatformBusinessUpstreamTiming = { configMs: 0, requestMs: 0, decodeMs: 0 };
  const result = await callPlatformTrpc<PlatformBusinessContext>({
    procedure: "internalBusiness.context",
    kind: "query",
    payload: { ...input, ...trustedBinding },
  }, {
    onUpstreamTiming: timing => {
      upstreamTiming = timing;
      options?.onUpstreamTiming?.(timing);
    },
  });
  if (!Number.isSafeInteger(result.enterpriseId) || result.enterpriseId <= 0) {
    throw withFailureKind("INVALID_RESPONSE", upstreamTiming);
  }
  if (result.staffPrincipal.status === "ready" && result.staffPrincipal.enterpriseId !== result.enterpriseId) {
    throw withFailureKind("INVALID_RESPONSE", upstreamTiming);
  }
  return result;
}

export async function validatePlatformBusinessStaffCandidate(staffUserId: number) {
  const result = await callPlatformTrpc<PlatformBusinessStaffCandidate>({
    procedure: "internalBusiness.staffBindingCandidate",
    kind: "query",
    payload: { staffUserId },
  });
  if (result.frontendUserId !== staffUserId || result.user.id !== staffUserId || result.user.loginDisabled) {
    throw withFailureKind("INVALID_RESPONSE", { configMs: 0, requestMs: 0, decodeMs: 0 });
  }
  return result;
}

/** A single fixed internal command endpoint; the front service accepts only its own static manifest. */
export async function callPlatformBusinessCommand(command: PlatformBusinessCommand): Promise<unknown> {
  const { binding, ...delegation } = command;
  return callPlatformTrpc<unknown>({
    procedure: "internalBusiness.execute",
    kind: "mutation",
    payload: { ...binding, ...delegation },
  });
}

function canonicalOfficialInventoryJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalOfficialInventoryJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalOfficialInventoryJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function signOfficialInventoryGrant(permissions: OfficialInventoryPermissions, target: Record<string, unknown>, key: string, issuedAt = Date.now()) {
  const grant = { schemaVersion: 1 as const, issuedAt, expiresAt: issuedAt + 30_000, permissions };
  return { ...grant, signature: createHmac("sha256", key).update(canonicalOfficialInventoryJson({ grant, target })).digest("hex") };
}
export const platformBusinessApiTestUtils = { publicUpstreamError };
