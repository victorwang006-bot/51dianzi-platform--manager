export type PlatformUserStats = {
  totalUsers: number;
  ordinaryUsers: number;
  erpUsers: number;
  todayRegistered: number;
  todayWebsiteRegistered: number;
  todayMiniProgramRegistered: number;
  todayOtherRegistered: number;
  sevenDayActive: number;
};

export type PlatformUserListInput = {
  page: number;
  pageSize: number;
  keyword?: string;
};

export type PlatformUserListRow = {
  id: number;
  username: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  loginMethod: string | null;
  companyName: string | null;
  creditCode: string | null;
  createdAt: Date | string;
  lastSignedIn: Date | string;
  loginDisabled: boolean;
  loginDisabledAt: Date | string | null;
  loginDisabledReason: string | null;
  forumMutedUntil: Date | string | null;
  forumMuteReason: string | null;
  userType: "erp" | "ordinary";
};

export type PlatformUserOperator = {
  id: number;
  name: string;
  role: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type PlatformUserModerationHistoryRow = {
  id: number;
  action: string;
  reason: string | null;
  operatorId?: number | string | null;
  operatorName: string | null;
  operatorRole?: string | null;
  createdAt: Date | string;
};

export type PlatformUserForumMessageRow = {
  id: number;
  content: string;
  createdAt: Date | string;
  isHidden: boolean;
  hiddenAt?: Date | string | null;
  hiddenReason?: string | null;
  status?: string | null;
};

/**
 * 上游可以直接返回数组，也可以返回带 rows 的分页壳；后台 UI 对两种形式均兼容，
 * 以便 internalUser 在不破坏既有调用方的前提下逐步统一列表形态。
 */
export type PlatformUserCollection<T> = T[] | { rows: T[] };

type TrpcEnvelope<T> = {
  result?: { data?: { json?: T } | T };
  error?: {
    json?: { message?: string; data?: { message?: string } };
    message?: string;
  };
};

type PlatformUserProcedure =
  | "stats"
  | "erpUserIds"
  | "list"
  | "setLoginDisabled"
  | "setForumMute"
  | "moderationHistory"
  | "forumMessages"
  | "hideForumMessage";

function getConfig() {
  const baseUrl = process.env.PLATFORM_API_BASE?.trim()
    || (process.env.NODE_ENV === "production" ? "http://127.0.0.1:3000" : "");
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!baseUrl) throw new Error("PLATFORM_API_BASE 未配置，无法连接商城用户服务");
  if (!key) throw new Error("PORTAL_API_KEY 未配置，无法连接商城用户服务");
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
    || `商城用户服务返回 ${status}`;
  // 上游错误文本不应把只存在于服务端请求头中的共享密钥带回浏览器。
  return key ? raw.split(key).join("[REDACTED]") : raw;
}

async function callPlatformUser<T>(
  procedure: PlatformUserProcedure,
  input: Record<string, unknown>,
  method: "GET" | "POST",
): Promise<T> {
  const { baseUrl, key } = getConfig();
  const headers = { "content-type": "application/json", "x-portal-key": key };
  const body = JSON.stringify({ "0": { json: input } });
  const endpoint = `${baseUrl}/api/trpc/internalUser.${procedure}?batch=1`;
  const response = await fetch(
    method === "GET" ? `${endpoint}&input=${encodeURIComponent(body)}` : endpoint,
    {
      method,
      headers,
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
  if (data === undefined) throw new Error("商城用户服务返回空响应");
  return ((typeof data === "object" && data !== null && "json" in data) ? data.json : data) as T;
}

function queryPlatformUser<T>(procedure: PlatformUserProcedure, input: Record<string, unknown>) {
  return callPlatformUser<T>(procedure, input, "GET");
}

function mutatePlatformUser<T>(procedure: PlatformUserProcedure, input: Record<string, unknown>) {
  return callPlatformUser<T>(procedure, input, "POST");
}

export function getPlatformUserStats() {
  return queryPlatformUser<PlatformUserStats>("stats", {}).then(stats => {
    const required: Array<keyof PlatformUserStats> = [
      "totalUsers", "ordinaryUsers", "erpUsers", "todayRegistered",
      "todayWebsiteRegistered", "todayMiniProgramRegistered", "todayOtherRegistered",
      "sevenDayActive",
    ];
    if (!stats || required.some(field => typeof stats[field] !== "number")) {
      throw new Error("商城用户服务版本不兼容，请先完成主站发布");
    }
    return stats;
  });
}

export function getPlatformErpUserIds() {
  return queryPlatformUser<unknown>("erpUserIds", {}).then(value => {
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
      throw new Error("商城ERP用户接口版本不兼容，请先完成主站发布");
    }
    return value as string[];
  });
}

export function listPlatformUsers(input: PlatformUserListInput) {
  return queryPlatformUser<{ rows: PlatformUserListRow[]; total: number }>("list", input).then(result => {
    if (!result || !Array.isArray(result.rows) || typeof result.total !== "number"
      || result.rows.some(row => row.userType !== "erp" && row.userType !== "ordinary")) {
      throw new Error("商城用户列表接口版本不兼容，请先完成主站发布");
    }
    return result;
  });
}

export function setPlatformUserLoginDisabled(input: {
  userId: number;
  disabled: boolean;
  reason: string;
  operator: PlatformUserOperator;
}) {
  return mutatePlatformUser<unknown>("setLoginDisabled", input);
}

export function setPlatformUserForumMute(input: {
  userId: number;
  durationHours: 3 | 6 | 24 | 72 | 168 | null;
  reason: string;
  operator: PlatformUserOperator;
}) {
  return mutatePlatformUser<unknown>("setForumMute", input);
}

export function getPlatformUserModerationHistory(input: { userId: number; limit: number }) {
  return queryPlatformUser<PlatformUserCollection<PlatformUserModerationHistoryRow>>(
    "moderationHistory",
    input,
  );
}

export function getPlatformUserForumMessages(input: { userId: number; limit: number }) {
  return queryPlatformUser<PlatformUserCollection<PlatformUserForumMessageRow>>(
    "forumMessages",
    input,
  );
}

export function hidePlatformForumMessage(input: {
  messageId: number;
  reason: string;
  operator: PlatformUserOperator;
}) {
  return mutatePlatformUser<unknown>("hideForumMessage", input);
}
