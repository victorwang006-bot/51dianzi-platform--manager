import { randomUUID } from "node:crypto";

export type PlatformCompanyMediaOperator = {
  id: number;
  name: string;
  role: string;
  ipAddress: string | null;
  userAgent: string | null;
};

/** 主站是首页展示资格的唯一权威来源，后台不复制这些规则。 */
export type PlatformHomepageFeatureStatus = {
  featured: boolean;
  eligible: boolean;
  approvedPhotoCount: number;
  hasPublishedInventory: boolean;
  missingReasons: string[];
};

export type PlatformCompanyMediaBinding = {
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

type PlatformCompanyMediaProcedure =
  | "homepageFeatureStatus"
  | "setHomepageFeatured"
  | "clearHomepageFeatured";

function getConfig() {
  const baseUrl = process.env.PLATFORM_API_BASE?.trim()
    || (process.env.NODE_ENV === "production" ? "http://127.0.0.1:3000" : "");
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!baseUrl) throw new Error("PLATFORM_API_BASE 未配置，无法连接商城公司媒体服务");
  if (!key) throw new Error("PORTAL_API_KEY 未配置，无法连接商城公司媒体服务");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), key };
}

function firstEnvelope<T>(payload: unknown): TrpcEnvelope<T> | null {
  if (Array.isArray(payload)) return (payload[0] as TrpcEnvelope<T> | undefined) ?? null;
  if (payload && typeof payload === "object") return payload as TrpcEnvelope<T>;
  return null;
}

function upstreamErrorMessage<T>(envelope: TrpcEnvelope<T> | null, status: number, key: string) {
  const raw = envelope?.error?.json?.message
    || envelope?.error?.json?.data?.message
    || envelope?.error?.message
    || `商城公司媒体服务返回 ${status}`;
  return raw.split(key).join("[REDACTED]");
}

function operatorHeaders(operator?: PlatformCompanyMediaOperator): Record<string, string> {
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

async function callPlatformCompanyMedia<T>(
  procedure: PlatformCompanyMediaProcedure,
  input: Record<string, unknown>,
  method: "GET" | "POST",
  operator?: PlatformCompanyMediaOperator,
): Promise<T> {
  const { baseUrl, key } = getConfig();
  const body = JSON.stringify({ "0": { json: input } });
  const endpoint = `${baseUrl}/api/trpc/internalCompanyMedia.${procedure}?batch=1`;
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
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = await response.json().catch(() => null) as unknown;
  const envelope = firstEnvelope<T>(payload);
  if (!response.ok || envelope?.error) {
    throw new Error(upstreamErrorMessage(envelope, response.status, key));
  }
  const data = envelope?.result?.data;
  if (data === undefined) throw new Error("商城公司媒体服务返回空响应");
  return ((typeof data === "object" && data !== null && "json" in data) ? data.json : data) as T;
}

function normalizeHomepageFeatureStatus(value: unknown): PlatformHomepageFeatureStatus {
  if (!value || typeof value !== "object") {
    throw new Error("商城首页精选接口版本不兼容，请先完成主站发布");
  }
  const status = value as Record<string, unknown>;
  if (typeof status.featured !== "boolean"
    || typeof status.eligible !== "boolean"
    || !Number.isSafeInteger(status.approvedPhotoCount)
    || (status.approvedPhotoCount as number) < 0
    || typeof status.hasPublishedInventory !== "boolean"
    || !Array.isArray(status.missingReasons)
    || status.missingReasons.some(reason => typeof reason !== "string")) {
    throw new Error("商城首页精选接口版本不兼容，请先完成主站发布");
  }
  return {
    featured: status.featured,
    eligible: status.eligible,
    approvedPhotoCount: Number(status.approvedPhotoCount),
    hasPublishedInventory: status.hasPublishedInventory,
    missingReasons: status.missingReasons as string[],
  };
}

/** 读取主站权威状态；企业身份仅由后台服务端派生。 */
export function getPlatformHomepageFeatureStatus(input: PlatformCompanyMediaBinding) {
  return callPlatformCompanyMedia<unknown>("homepageFeatureStatus", input, "GET")
    .then(normalizeHomepageFeatureStatus);
}

/** 设置与取消调用不同的受保护过程；浏览器不能提供操作人、原因或幂等号。 */
export function setPlatformHomepageFeatured(input: PlatformCompanyMediaBinding & {
  featured: boolean;
  operator: PlatformCompanyMediaOperator;
}) {
  const procedure = input.featured ? "setHomepageFeatured" : "clearHomepageFeatured";
  const mutationInput = {
    creditCode: input.creditCode,
    expectedOwnerUserId: input.expectedOwnerUserId,
    reason: input.featured ? "后台设置为优质商家" : "后台取消优质商家",
    requestId: `homepage-feature:${randomUUID()}`,
  };
  return callPlatformCompanyMedia<unknown>(procedure, mutationInput, "POST", input.operator)
    .then(normalizeHomepageFeatureStatus);
}
