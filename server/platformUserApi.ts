export type PlatformUserStats = {
  totalUsers: number;
  todayRegistered: number;
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
};

type BatchResponse<T> = Array<{
  result?: { data?: { json?: T } | T };
  error?: { json?: { message?: string }; message?: string };
}>;

function getConfig() {
  const baseUrl = process.env.PLATFORM_API_BASE?.trim()
    || (process.env.NODE_ENV === "production" ? "http://127.0.0.1:3000" : "");
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!baseUrl) throw new Error("PLATFORM_API_BASE 未配置，无法连接商城用户服务");
  if (!key) throw new Error("PORTAL_API_KEY 未配置，无法连接商城用户服务");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), key };
}

async function callPlatformUser<T>(
  procedure: "stats" | "list",
  input: Record<string, unknown>,
): Promise<T> {
  const { baseUrl, key } = getConfig();
  const headers = { "content-type": "application/json", "x-portal-key": key };
  const body = JSON.stringify({ "0": { json: input } });
  const url = `${baseUrl}/api/trpc/internalUser.${procedure}`;
  const response = await fetch(`${url}?batch=1&input=${encodeURIComponent(body)}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as BatchResponse<T> | null;
  const first = payload?.[0];
  if (!response.ok || first?.error) {
    const message = first?.error?.json?.message || first?.error?.message || `商城用户服务返回 ${response.status}`;
    throw new Error(message);
  }
  const data = first?.result?.data;
  if (!data) throw new Error("商城用户服务返回空响应");
  return ((typeof data === "object" && data !== null && "json" in data) ? data.json : data) as T;
}

export function getPlatformUserStats() {
  return callPlatformUser<PlatformUserStats>("stats", {});
}

export function listPlatformUsers(input: PlatformUserListInput) {
  return callPlatformUser<{ rows: PlatformUserListRow[]; total: number }>("list", input);
}
