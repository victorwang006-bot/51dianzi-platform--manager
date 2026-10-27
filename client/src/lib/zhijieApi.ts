import type {
  ZhijieAccessInput,
  ZhijieAuditRow,
  ZhijieContext,
  ZhijieListResult,
  ZhijieModuleId,
  ZhijieSetup,
} from "@shared/zhijieBusiness";
import { ZHIJIE_API_PREFIX } from "@shared/zhijieBusiness";

/**
 * 智捷业务为独立 REST 边界。不要把服务器、数据库或 SQL 原文传回页面；
 * 页面只需要可操作的状态提示，详细信息应留在服务端日志。
 */
export class ZhijieApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ZhijieApiError";
  }
}

function clientMessage(status: number): string {
  if (status === 401) return "登录状态已失效，请重新登录后重试。";
  if (status === 403) return "当前账号没有访问此业务信息的权限。";
  if (status === 404) return "请求的业务资源不存在或尚未开放。";
  if (status === 409) return "数据已被其他操作更新，请刷新后确认最新信息。";
  if (status === 422 || status === 400) return "提交的信息未通过校验，请检查后重试。";
  if (status >= 500) return "智捷业务服务暂时不可用，请稍后重试。";
  return "请求未完成，请稍后重试。";
}

async function request<T>(path: string, init?: RequestInit, acceptedErrorStatuses: readonly number[] = []): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${ZHIJIE_API_PREFIX}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ZhijieApiError("无法连接智捷业务服务，请检查网络后重试。", 0);
  }

  if (!response.ok && !acceptedErrorStatuses.includes(response.status)) {
    throw new ZhijieApiError(clientMessage(response.status), response.status);
  }

  try {
    return await response.json() as T;
  } catch {
    throw new ZhijieApiError("智捷业务服务返回的数据无法识别，请稍后重试。", response.status);
  }
}

export function getZhijieContext(): Promise<ZhijieContext> {
  // 来源组织不可用时服务端仍返回严格的 deny-by-default context（含 canConfigure）。
  // 保留它以便超级管理员看到“禁止配置”的真实原因，而不是误显示成网络错误。
  return request<ZhijieContext>("/context", undefined, [503]);
}

export function getZhijieSetup(): Promise<ZhijieSetup> {
  return request<ZhijieSetup>("/setup");
}

/** 后端当前可直接返回数组；兼容 items 包装仅用于平滑 REST 演进，不生成任何本地数据。 */
export async function getZhijieAudit(): Promise<ZhijieAuditRow[]> {
  const payload = await request<ZhijieAuditRow[] | { items: ZhijieAuditRow[] }>("/audit");
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.items)) return payload.items;
  throw new ZhijieApiError("智捷审计服务返回的数据无法识别，请稍后重试。", 200);
}

export function getZhijieRecords(moduleId: ZhijieModuleId): Promise<ZhijieListResult> {
  return request<ZhijieListResult>(`/records/${encodeURIComponent(moduleId)}`);
}

export function saveZhijieAccess(input: ZhijieAccessInput): Promise<unknown> {
  return request<unknown>("/access", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
