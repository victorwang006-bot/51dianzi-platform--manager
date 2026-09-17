import type { ErpPermissionKey } from "../shared/erpPermissions";

export type PlatformEnterpriseOperator = {
  id: number;
  name: string;
  role: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export type PlatformEnterpriseMember = {
  memberId: number;
  userId: number;
  displayName: string;
  username?: string | null;
  maskedPhone: string | null;
  role: string;
  status: "active" | "suspended";
  permissionKeys: ErpPermissionKey[];
  inventoryDataScope: "own" | "enterprise";
  permissionVersion?: number;
  joinedAt?: Date | string | null;
  suspendedAt?: Date | string | null;
  isOwner: boolean;
  loginDisabled: boolean;
};

export type PlatformEnterpriseMembersResult = {
  enterpriseId: number;
  companyName: string;
  superAdminUserId: number;
  dataOwnerUserId: number;
  members: PlatformEnterpriseMember[];
};

type TrpcEnvelope<T> = {
  result?: { data?: { json?: T } | T };
  error?: {
    json?: { message?: string; data?: { message?: string } };
    message?: string;
  };
};

type PlatformEnterpriseProcedure =
  | "members"
  | "setMemberStatus"
  | "setMemberPermissions"
  | "setMemberScope"
  | "setLoginDisabled";

type EnterpriseBinding = {
  creditCode: string;
  expectedOwnerUserId: number;
};

function getConfig() {
  const baseUrl = process.env.PLATFORM_API_BASE?.trim()
    || (process.env.NODE_ENV === "production" ? "http://127.0.0.1:3000" : "");
  const key = process.env.PORTAL_API_KEY?.trim();
  if (!baseUrl) throw new Error("PLATFORM_API_BASE 未配置，无法连接商城企业成员服务");
  if (!key) throw new Error("PORTAL_API_KEY 未配置，无法连接商城企业成员服务");
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
    || `商城企业成员服务返回 ${status}`;
  return key ? raw.split(key).join("[REDACTED]") : raw;
}

async function callPlatformEnterprise<T>(
  procedure: PlatformEnterpriseProcedure,
  input: Record<string, unknown>,
  method: "GET" | "POST",
): Promise<T> {
  const { baseUrl, key } = getConfig();
  const headers = { "content-type": "application/json", "x-portal-key": key };
  const body = JSON.stringify({ "0": { json: input } });
  const endpoint = `${baseUrl}/api/trpc/internalEnterprise.${procedure}?batch=1`;
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
  if (data === undefined) throw new Error("商城企业成员服务返回空响应");
  return ((typeof data === "object" && data !== null && "json" in data) ? data.json : data) as T;
}

function queryPlatformEnterprise<T>(procedure: PlatformEnterpriseProcedure, input: Record<string, unknown>) {
  return callPlatformEnterprise<T>(procedure, input, "GET");
}

function mutatePlatformEnterprise<T>(procedure: PlatformEnterpriseProcedure, input: Record<string, unknown>) {
  return callPlatformEnterprise<T>(procedure, input, "POST");
}

export function listPlatformEnterpriseMembers(input: EnterpriseBinding) {
  return queryPlatformEnterprise<PlatformEnterpriseMembersResult>("members", input).then(result => {
    if (!result || !Array.isArray(result.members)) {
      throw new Error("商城企业成员列表接口版本不兼容，请先完成主站发布");
    }
    return result;
  });
}

export function setPlatformEnterpriseMemberStatus(input: EnterpriseBinding & {
  targetUserId: number;
  status: "active" | "suspended";
  reason: string;
  requestId: string;
  operator: PlatformEnterpriseOperator;
}) {
  return mutatePlatformEnterprise<unknown>("setMemberStatus", input);
}

export function setPlatformEnterpriseMemberPermissions(input: EnterpriseBinding & {
  targetUserId: number;
  permissionKeys: ErpPermissionKey[];
  reason: string;
  requestId: string;
  operator: PlatformEnterpriseOperator;
}) {
  return mutatePlatformEnterprise<unknown>("setMemberPermissions", input);
}

export function setPlatformEnterpriseMemberScope(input: EnterpriseBinding & {
  targetUserId: number;
  inventoryDataScope: "own" | "enterprise";
  reason: string;
  requestId: string;
  operator: PlatformEnterpriseOperator;
}) {
  return mutatePlatformEnterprise<unknown>("setMemberScope", input);
}

export function setPlatformEnterpriseLoginDisabled(input: EnterpriseBinding & {
  targetUserId: number;
  disabled: boolean;
  reason: string;
  requestId: string;
  operator: PlatformEnterpriseOperator;
}) {
  return mutatePlatformEnterprise<unknown>("setLoginDisabled", input);
}
