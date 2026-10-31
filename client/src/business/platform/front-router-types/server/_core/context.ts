import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

/**
 * 仅能由 internalBusiness 的服务密钥边界构造的服务器内委派记录。
 * 这不是浏览器会话，也不会改变用户的前台选企状态；领域过程仍会逐请求重新
 * 解析真实成员权限。它只为审计与跨企业范围一致性提供不可伪造的来源事实。
 */
export type StaffDelegation = {
  kind: "business_bff";
  adminAccountId: number;
  adminActorName: string;
  adminActorRole: string;
  staffUserId: number;
  bindingVersion: number;
  requestId: string;
  enterpriseId: number;
};

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** 当前独立账号的业务身份；企业ERP数据归属由权限服务解析为企业owner。 */
  effectiveUserId: number | null;
  /** 仅内部服务密钥调用构造；任何浏览器请求始终为 undefined。 */
  staffDelegation?: StaffDelegation;
};

export async function createContext(
  opts: CreateExpressContextOptions,
): Promise<TrpcContext> {
  let user: User | null = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    effectiveUserId: user?.id ?? null,
  };
}
