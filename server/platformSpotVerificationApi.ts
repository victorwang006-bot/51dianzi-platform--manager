export type PlatformSpotVerificationOperator = {
  id: number;
  name: string;
  role: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type PlatformCompanyBinding = {
  creditCode: string;
  expectedOwnerUserId: number;
};

type TrpcEnvelope<T> = {
  result?: { data?: { json?: T } | T };
  error?: {
    json?: { message?: string; data?: { message?: string } };
    message?: string;
  };
};

type Procedure =
  | "listReviews"
  | "listActive"
  | "approve"
  | "reject"
  | "cancel";

function getConfig() {
  const baseUrl = process.env.PLATFORM_API_BASE?.trim()
    || (process.env.NODE_ENV === "production" ? "http://127.0.0.1:3000" : "");
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!baseUrl) throw new Error("PLATFORM_API_BASE 未配置，无法连接现货核验服务");
  if (!key) throw new Error("PORTAL_API_KEY 未配置，无法连接现货核验服务");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), key };
}

function firstEnvelope<T>(payload: unknown): TrpcEnvelope<T> | null {
  if (Array.isArray(payload)) return (payload[0] as TrpcEnvelope<T> | undefined) ?? null;
  if (payload && typeof payload === "object") return payload as TrpcEnvelope<T>;
  return null;
}

function operatorHeaders(operator?: PlatformSpotVerificationOperator): Record<string, string> {
  if (!operator) return {};
  const encode = (value: string | number | null) =>
    `b64.${Buffer.from(value === null ? "" : String(value), "utf8").toString("base64url")}`;
  return {
    "x-internal-operator-id": encode(operator.id),
    "x-internal-operator-name": encode(operator.name),
    "x-internal-operator-role": encode(operator.role),
    "x-internal-operator-ip": encode(operator.ipAddress),
    "x-internal-operator-user-agent": encode(operator.userAgent),
  };
}

async function callPlatform<T>(
  procedure: Procedure,
  input: Record<string, unknown>,
  method: "GET" | "POST",
  operator?: PlatformSpotVerificationOperator,
): Promise<T> {
  const { baseUrl, key } = getConfig();
  const body = JSON.stringify({ "0": { json: input } });
  const endpoint = `${baseUrl}/api/trpc/internalSpotVerification.${procedure}?batch=1`;
  const response = await fetch(
    method === "GET" ? `${endpoint}&input=${encodeURIComponent(body)}` : endpoint,
    {
      method,
      headers: {
        "content-type": "application/json",
        "x-portal-key": key,
        ...operatorHeaders(operator),
      },
      ...(method === "POST" ? { body } : {}),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => null) as unknown;
  const envelope = firstEnvelope<T>(payload);
  const raw = envelope?.error?.json?.message
    || envelope?.error?.json?.data?.message
    || envelope?.error?.message
    || `现货核验服务返回 ${response.status}`;
  if (!response.ok || envelope?.error) throw new Error(String(raw).split(key).join("[REDACTED]"));
  const data = envelope?.result?.data;
  if (data === undefined) throw new Error("现货核验服务返回空响应");
  return ((typeof data === "object" && data !== null && "json" in data) ? data.json : data) as T;
}

export function listPlatformSpotVerificationReviews(
  binding: PlatformCompanyBinding & { status?: "pending" | "approved" | "rejected" | "cancelled" | "all" },
) {
  return callPlatform("listReviews", binding, "GET");
}

export function listPlatformActiveSpotVerifications(binding: PlatformCompanyBinding) {
  return callPlatform("listActive", binding, "GET");
}

export function approvePlatformSpotVerificationReview(input: PlatformCompanyBinding & {
  reviewId: number;
  operator: PlatformSpotVerificationOperator;
}) {
  const { operator, ...rest } = input;
  return callPlatform("approve", rest, "POST", operator);
}

export function rejectPlatformSpotVerificationReview(input: PlatformCompanyBinding & {
  reviewId: number;
  operator: PlatformSpotVerificationOperator;
}) {
  const { operator, ...rest } = input;
  return callPlatform("reject", rest, "POST", operator);
}

export function cancelPlatformSpotVerification(input: PlatformCompanyBinding & {
  verificationId: number;
  operator: PlatformSpotVerificationOperator;
}) {
  const { operator, ...rest } = input;
  return callPlatform("cancel", rest, "POST", operator);
}
