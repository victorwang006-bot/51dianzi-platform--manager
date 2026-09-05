export type AnalyticsRangeDays = 7 | 30 | 90;

export type PlatformAnalyticsOverview = {
  days: AnalyticsRangeDays;
  retentionDays: number;
  summary: {
    pageViews: number;
    visitors: number;
    sessions: number;
    guestVisitors: number;
    loggedInUsers: number;
    totalUsers: number;
    todayRegistered: number;
    rangeRegistered: number;
    sevenDayActive: number;
    thirtyDayActive: number;
  };
  daily: Array<{
    date: string;
    pageViews: number;
    visitors: number;
    sessions: number;
    guestVisitors: number;
    loggedInUsers: number;
  }>;
  topPages: Array<{ path: string; pageViews: number; visitors: number }>;
  sources: Array<{ source: string; visitors: number }>;
  devices: Array<{ deviceType: string; visitors: number }>;
  firstEventAt: string;
  lastEventAt: string;
};

type BatchResponse<T> = Array<{
  result?: { data?: { json?: T } | T };
  error?: { json?: { message?: string }; message?: string };
}>;

function getConfig() {
  const baseUrl = process.env.PLATFORM_API_BASE?.trim()
    || (process.env.NODE_ENV === "production" ? "http://127.0.0.1:3000" : "");
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!baseUrl) throw new Error("PLATFORM_API_BASE 未配置，无法连接商城统计服务");
  if (!key) throw new Error("PORTAL_API_KEY 未配置，无法连接商城统计服务");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), key };
}

export async function getPlatformAnalyticsOverview(days: AnalyticsRangeDays) {
  const { baseUrl, key } = getConfig();
  const headers = { "content-type": "application/json", "x-portal-key": key };
  const body = JSON.stringify({ "0": { json: { days } } });
  const url = `${baseUrl}/api/trpc/siteAnalytics.internalOverview`;
  const response = await fetch(`${url}?batch=1&input=${encodeURIComponent(body)}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as BatchResponse<PlatformAnalyticsOverview> | null;
  const first = payload?.[0];
  if (!response.ok || first?.error) {
    const message = first?.error?.json?.message || first?.error?.message || `商城统计服务返回 ${response.status}`;
    throw new Error(message);
  }
  const data = first?.result?.data;
  if (!data) throw new Error("商城统计服务返回空响应");
  return ((typeof data === "object" && data !== null && "json" in data) ? data.json : data) as PlatformAnalyticsOverview;
}
