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
  staffPrincipal: PlatformBusinessStaffPrincipal | {
    status: "required";
    reason: "ADMIN_STAFF_PRINCIPAL_NOT_BOUND";
  };
  enabledModules: readonly string[];
  /** Current portal-derived, display-only workbench projection; never adminPermissions. */
  workbenchCapabilities: readonly string[];
  /** Derived by the front internal service from the ready staff principal and real permission checks. */
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

export type PlatformBusinessCommand = {
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
  error?: { json?: { message?: string; data?: { code?: string; message?: string } }; message?: string };
};

/** Only domain-safe codes may cross the service-to-service error boundary. */
export const PLATFORM_BUSINESS_PUBLIC_ERROR_CODES = [
  "BAD_REQUEST",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "TOO_MANY_REQUESTS",
  "TIMEOUT",
] as const;

export type PlatformBusinessPublicErrorCode = (typeof PLATFORM_BUSINESS_PUBLIC_ERROR_CODES)[number];

export class PlatformBusinessPublicError extends Error {
  constructor(readonly code: PlatformBusinessPublicErrorCode, message: string) {
    super(message);
    this.name = "PlatformBusinessPublicError";
  }
}

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

/** Never forward remote implementation errors, secret values or service inputs to a browser. */
function upstreamFailure(status: number) {
  return new Error("主站业务服务暂不可用，请稍后重试");
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
  return new PlatformBusinessPublicError(code as PlatformBusinessPublicErrorCode, safeMessage);
}

function trpcInput(input: unknown) {
  return JSON.stringify({ "0": { json: input } });
}

async function callPlatformTrpc<T>(input: {
  procedure: string;
  kind: "query" | "mutation";
  payload: unknown;
}): Promise<T> {
  const { baseUrl, key } = getConfig();
  const encoded = trpcInput(input.payload);
  const url = `${baseUrl}/api/trpc/${input.procedure}?batch=1${input.kind === "query" ? `&input=${encodeURIComponent(encoded)}` : ""}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: input.kind === "query" ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        "x-portal-key": key,
      },
      // Only server-derived JSON is sent. No Cookie or Authorization is propagated.
      body: input.kind === "mutation" ? encoded : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("主站业务服务暂不可用，请稍后重试");
  }
  const payload = await response.json().catch(() => null) as unknown;
  const envelope = firstEnvelope<T>(payload);
  if (envelope?.error) throw publicUpstreamError(envelope.error) ?? upstreamFailure(response.status);
  if (!response.ok) throw upstreamFailure(response.status);
  const data = envelope?.result?.data;
  const result = (typeof data === "object" && data !== null && "json" in data ? data.json : data) as T | undefined;
  if (result === undefined) throw new Error("主站业务服务返回格式异常");
  return result;
}

export async function getPlatformBusinessContext(
  input: PlatformBusinessBinding,
  trustedBinding?: { staffUserId: number; adminAccountId: number; bindingVersion: number },
): Promise<PlatformBusinessContext> {
  const result = await callPlatformTrpc<PlatformBusinessContext>({
    procedure: "internalBusiness.context",
    kind: "query",
    payload: { ...input, ...trustedBinding },
  });
  if (!Number.isSafeInteger(result.enterpriseId) || result.enterpriseId <= 0) {
    throw new Error("主站业务服务返回格式异常");
  }
  if (result.staffPrincipal.status === "ready" && result.staffPrincipal.enterpriseId !== result.enterpriseId) {
    throw new Error("主站业务服务返回了不一致的员工企业范围");
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
    throw new Error("主站前台员工主体校验失败");
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

export const platformBusinessApiTestUtils = { publicUpstreamError };
