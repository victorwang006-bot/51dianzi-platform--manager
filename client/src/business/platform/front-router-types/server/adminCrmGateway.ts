type AdminCrmStatus = "none" | "pending" | "enabled" | "disabled" | "rejected";

export type SubmitAdminCrmApplicationInput = {
  companyName: string;
  creditCode: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  legalPersonName?: string | null;
  registeredAddress?: string | null;
  businessScope?: string | null;
  licenseObjectKey?: string | null;
  licenseImageUrl?: string | null;
  portalUserId: string;
  note?: string | null;
};

export type SubmitAdminCrmApplicationResult = {
  accepted: boolean;
  created: boolean;
  code: string;
  crmStatus: AdminCrmStatus;
  message?: string | null;
  merchantId?: number;
  merchantNo?: string;
};

export type AdminCrmAccessResult = {
  allowed: boolean;
  code: string;
  crmStatus: AdminCrmStatus;
  message?: string | null;
  merchantNo?: string;
  crmThreadNo?: string | null;
};

export class AdminCrmGatewayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AdminCrmGatewayError";
  }
}

function getAdminCrmConfig() {
  const apiBase = (process.env.ADMIN_API_BASE || "http://47.97.108.147/admin").replace(/\/+$/, "");
  const portalApiKey = process.env.PORTAL_API_KEY?.trim() || "";
  if (!portalApiKey) {
    throw new AdminCrmGatewayError("ERP 审核后台连接未配置");
  }
  return { apiBase, portalApiKey };
}

function readBatchResult<T>(body: unknown): T {
  const batch = Array.isArray(body)
    ? body[0]
    : body && typeof body === "object"
      ? (body as Record<string, unknown>)["0"]
      : undefined;
  const entry = batch as
    | {
        result?: { data?: { json?: T } };
        error?: { message?: string; json?: { message?: string } };
      }
    | undefined;
  const errorMessage = entry?.error?.json?.message || entry?.error?.message;
  if (errorMessage) throw new AdminCrmGatewayError(errorMessage);
  if (entry?.result?.data?.json === undefined) {
    throw new AdminCrmGatewayError("ERP 审核后台返回格式异常");
  }
  return entry.result.data.json;
}

async function adminCrmApi<T>(
  procedure: "portal.submitCrmApplication" | "portal.getCrmAccess" | "portal.getHkCrmAccess",
  input: Record<string, unknown>,
  method: "query" | "mutation",
): Promise<T> {
  const { apiBase, portalApiKey } = getAdminCrmConfig();
  const headers = {
    "Content-Type": "application/json",
    "x-portal-key": portalApiKey,
  };
  const batchInput = { "0": { json: input } };
  const url = method === "query"
    ? `${apiBase}/api/trpc/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify(batchInput))}`
    : `${apiBase}/api/trpc/${procedure}?batch=1`;
  const response = await fetch(url, {
    ...(method === "mutation"
      ? { method: "POST", body: JSON.stringify(batchInput) }
      : {}),
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new AdminCrmGatewayError(
      `CRM 审核后台请求失败（HTTP ${response.status}）`,
      response.status,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AdminCrmGatewayError("ERP 审核后台返回了无效响应", response.status);
  }
  return readBatchResult<T>(body);
}

export function submitAdminCrmApplication(input: SubmitAdminCrmApplicationInput) {
  return adminCrmApi<SubmitAdminCrmApplicationResult>(
    "portal.submitCrmApplication",
    input,
    "mutation",
  );
}

export function getAdminCrmAccess(input: { creditCode: string; portalUserId: string }) {
  return adminCrmApi<AdminCrmAccessResult>("portal.getCrmAccess", input, "query");
}

/** HK uses its BRN union identity and must never be coerced into a mainland credit code. */
export function getAdminHkCrmAccess(input: { registrationIdentifier: string; portalUserId: string }) {
  return adminCrmApi<AdminCrmAccessResult>("portal.getHkCrmAccess", input, "query");
}
