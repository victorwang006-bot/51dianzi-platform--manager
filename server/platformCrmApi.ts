type BatchResponse<T> = Array<{
  result?: { data?: { json?: T } | T };
  error?: { json?: { message?: string }; message?: string };
}>;

type CrmRebindValidationResult = {
  valid: true;
  enterpriseId: number;
  creditCode: string;
  expectedSuperAdminUserId: number;
  targetUserId: number;
};

function getConfig() {
  const baseUrl = process.env.PLATFORM_API_BASE?.trim()
    || (process.env.NODE_ENV === "production" ? "http://127.0.0.1:3000" : "");
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!baseUrl) throw new Error("PLATFORM_API_BASE 未配置，无法校验前台企业成员");
  if (!key) throw new Error("PORTAL_API_KEY 未配置，无法校验前台企业成员");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), key };
}

export async function validatePlatformCrmRebindTarget(input: {
  creditCode: string;
  expectedPortalUserId: string;
  newPortalUserId: string;
}) {
  const { baseUrl, key } = getConfig();
  const body = JSON.stringify({ "0": { json: input } });
  const response = await fetch(
    `${baseUrl}/api/trpc/internalCrm.validateRebindTarget?batch=1&input=${encodeURIComponent(body)}`,
    {
      headers: { "content-type": "application/json", "x-portal-key": key },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const payload = await response.json().catch(() => null) as BatchResponse<CrmRebindValidationResult> | null;
  const first = payload?.[0];
  if (!response.ok || first?.error) {
    const message = first?.error?.json?.message
      || first?.error?.message
      || `前台企业成员校验返回 ${response.status}`;
    throw new Error(message);
  }
  const data = first?.result?.data;
  if (!data) throw new Error("前台企业成员校验返回空响应");
  const result = (typeof data === "object" && data !== null && "json" in data
    ? data.json
    : data) as CrmRebindValidationResult | undefined;
  if (!result?.valid) throw new Error("前台企业成员校验未通过");
  return result;
}
