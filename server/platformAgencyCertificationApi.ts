import { isValidCalendarDate } from "../shared/merchantCreatedAtFilter";

export type PlatformAgencyCertificationOperator = {
  id: number;
  name: string;
  role: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type PlatformAgencyCertificationBinding = {
  creditCode?: string;
  registrationRegion?: "CN" | "HK";
  registrationIdentifier?: string;
  expectedOwnerUserId: number;
};

export type PlatformAgencyCertificationFile = {
  fileName: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  base64: string;
};

export type PlatformAgencyCertification = {
  id: number;
  brands: string[];
  fileName: string;
  status: "active" | "cancelled" | "pending" | "rejected";
  revision: number;
  updatedAt: string | Date;
  authorizationIssuer?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  supplementalNote?: string | null;
  reviewReason?: string | null;
  submittedAt?: string | Date | null;
  reviewedAt?: string | Date | null;
  createdAt?: string | Date | null;
  supersedesCertificationId?: number | null;
  effectiveBrands?: string[];
};

export type PlatformAgencyCertificationList = {
  items: PlatformAgencyCertification[];
};

export type PlatformAgencyCertificationDocument = {
  url: string;
  expiresAt: number;
  fileName: string;
};

type TrpcEnvelope<T> = {
  result?: { data?: { json?: T } | T };
  error?: {
    json?: { message?: string; data?: { message?: string } };
    message?: string;
  };
};

type Procedure = "list" | "upsert" | "cancel" | "document" | "review";

function getConfig() {
  const baseUrl = process.env.PLATFORM_API_BASE?.trim()
    || (process.env.NODE_ENV === "production" ? "http://127.0.0.1:3000" : "");
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!baseUrl) throw new Error("PLATFORM_API_BASE 未配置，无法连接代理认证服务");
  if (!key) throw new Error("PORTAL_API_KEY 未配置，无法连接代理认证服务");
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
    || `代理认证服务返回 ${status}`;
  return raw.split(key).join("[REDACTED]");
}

/** 操作人仅能由后台认证会话派生，并以 ASCII header 传递给主站服务端。 */
function operatorHeaders(operator: PlatformAgencyCertificationOperator): Record<string, string> {
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
  operator: PlatformAgencyCertificationOperator,
): Promise<T> {
  const { baseUrl, key } = getConfig();
  const body = JSON.stringify({ "0": { json: input } });
  const endpoint = `${baseUrl}/api/trpc/internalAgencyCertification.${procedure}?batch=1`;
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
  if (!response.ok || envelope?.error) {
    throw new Error(upstreamErrorMessage(envelope, response.status, key));
  }
  const data = envelope?.result?.data;
  if (data === undefined) throw new Error("代理认证服务返回空响应");
  return ((typeof data === "object" && data !== null && "json" in data) ? data.json : data) as T;
}

function normalizeCertification(value: unknown): PlatformAgencyCertification {
  if (!value || typeof value !== "object") {
    throw new Error("代理认证接口版本不兼容，请先完成主站发布");
  }
  const item = value as Record<string, unknown>;
  if (!Number.isSafeInteger(item.id) || Number(item.id) <= 0
    || !Array.isArray(item.brands) || item.brands.length > 30
    || item.brands.some(brand => typeof brand !== "string" || brand.length === 0 || brand.length > 80)
    || typeof item.fileName !== "string" || item.fileName.length === 0
    || !["active", "cancelled", "pending", "rejected"].includes(String(item.status))
    || !Number.isSafeInteger(item.revision) || Number(item.revision) < 0
    || (typeof item.updatedAt !== "string" && !(item.updatedAt instanceof Date))) {
    throw new Error("代理认证接口版本不兼容，请先完成主站发布");
  }
  // 仅投影合同字段。旧 active/cancelled 响应可缺少新增字段；未知私有字段不透传。
  const extra: Partial<PlatformAgencyCertification> = {};
  const incompatible = () => { throw new Error("代理认证接口版本不兼容，请先完成主站发布"); };
  for (const key of ["authorizationIssuer", "validFrom", "validUntil", "supplementalNote", "reviewReason"] as const) {
    const value = item[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") incompatible();
    if ((key === "validFrom" || key === "validUntil") && typeof value === "string"
      && !isValidCalendarDate(value)) incompatible();
    extra[key] = value as string | null;
  }
  for (const key of ["submittedAt", "reviewedAt", "createdAt"] as const) {
    const value = item[key];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string" && !(value instanceof Date)) incompatible();
    extra[key] = value as string | Date | null;
  }
  if (item.supersedesCertificationId !== undefined) {
    if (item.supersedesCertificationId !== null && (!Number.isSafeInteger(item.supersedesCertificationId)
      || Number(item.supersedesCertificationId) <= 0)) incompatible();
    extra.supersedesCertificationId = item.supersedesCertificationId as number | null;
  }
  if (item.effectiveBrands !== undefined) {
    if (!Array.isArray(item.effectiveBrands) || item.effectiveBrands.length > 30
      || item.effectiveBrands.some(brand => typeof brand !== "string" || !brand || brand.length > 80)) incompatible();
    extra.effectiveBrands = item.effectiveBrands as string[];
  }
  return {
    id: Number(item.id),
    brands: item.brands as string[],
    fileName: item.fileName,
    status: item.status as PlatformAgencyCertification["status"],
    revision: Number(item.revision),
    updatedAt: item.updatedAt as string | Date,
    ...extra,
  };
}

function normalizeList(value: unknown): PlatformAgencyCertificationList {
  if (!value || typeof value !== "object" || !Array.isArray((value as { items?: unknown }).items)) {
    throw new Error("代理认证接口版本不兼容，请先完成主站发布");
  }
  return { items: (value as { items: unknown[] }).items.map(normalizeCertification) };
}

function normalizeMutation(value: unknown): { success: true; id: number } {
  if (!value || typeof value !== "object" || (value as { success?: unknown }).success !== true
    || !Number.isSafeInteger((value as { id?: unknown }).id) || Number((value as { id: number }).id) <= 0) {
    throw new Error("代理认证接口版本不兼容，请先完成主站发布");
  }
  return { success: true, id: Number((value as { id: number }).id) };
}

function normalizeCancel(value: unknown): { success: true } {
  if (!value || typeof value !== "object" || (value as { success?: unknown }).success !== true) {
    throw new Error("代理认证接口版本不兼容，请先完成主站发布");
  }
  return { success: true };
}

function normalizeDocument(value: unknown): PlatformAgencyCertificationDocument {
  if (!value || typeof value !== "object") {
    throw new Error("代理认证接口版本不兼容，请先完成主站发布");
  }
  const document = value as Record<string, unknown>;
  if (typeof document.url !== "string" || document.url.length === 0
    || !Number.isSafeInteger(document.expiresAt) || Number(document.expiresAt) <= Date.now()
    || typeof document.fileName !== "string" || document.fileName.length === 0) {
    throw new Error("代理认证接口版本不兼容，请先完成主站发布");
  }
  return {
    url: document.url,
    expiresAt: Number(document.expiresAt),
    fileName: document.fileName,
  };
}

/** 列表只传服务端派生的公司绑定和后台操作人；不含任何原件 key 或 URL。 */
export function listPlatformAgencyCertifications(input: PlatformAgencyCertificationBinding & {
  operator: PlatformAgencyCertificationOperator;
}) {
  const { operator, ...binding } = input;
  return callPlatform<unknown>("list", binding, "GET", operator).then(normalizeList);
}

/** 新建必须带 file；编辑可省略 file 以保留主站私有原件。 */
export function upsertPlatformAgencyCertification(input: PlatformAgencyCertificationBinding & {
  id?: number;
  expectedRevision?: number;
  brands: string[];
  authorizationIssuer?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  supplementalNote?: string | null;
  file?: PlatformAgencyCertificationFile;
  requestId: string;
  operator: PlatformAgencyCertificationOperator;
}) {
  const { operator, ...payload } = input;
  return callPlatform<unknown>("upsert", payload, "POST", operator).then(normalizeMutation);
}

export function cancelPlatformAgencyCertification(input: PlatformAgencyCertificationBinding & {
  id: number;
  expectedRevision: number;
  requestId: string;
  operator: PlatformAgencyCertificationOperator;
}) {
  const { operator, ...payload } = input;
  return callPlatform<unknown>("cancel", payload, "POST", operator).then(normalizeCancel);
}

/** 人工审核只转发可信后台身份；requestId 和 revision 由权威服务校验并审计。 */
export function reviewPlatformAgencyCertification(input: PlatformAgencyCertificationBinding & {
  id: number;
  expectedRevision: number;
  decision: "approve" | "reject";
  reviewReason: string;
  requestId: string;
  operator: PlatformAgencyCertificationOperator;
}) {
  const { operator, ...payload } = input;
  return callPlatform<unknown>("review", payload, "POST", operator).then(normalizeMutation);
}

/** 原件仅在受控点击后由主站签发短时 URL，返回值不包含私有对象键。 */
export function getPlatformAgencyCertificationDocument(input: PlatformAgencyCertificationBinding & {
  id: number;
  operator: PlatformAgencyCertificationOperator;
}) {
  const { operator, ...payload } = input;
  return callPlatform<unknown>("document", payload, "GET", operator).then(normalizeDocument);
}
