import { ANON_LIMIT_ERR_MSG, NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '../../../shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { BusinessFailureCause, businessFailureForError } from "../../../shared/businessFailure";
import { anonViewExceeded, clientIp } from "../antiScrape";
import { DAILY_QUOTA_ERR_MSG, sharedDailyQuotaExceeded } from "../dailyQuota";
import { requireCrmEnterpriseAccess } from "../services/enterpriseAccess";
import {
  requireAnyEnterprisePermission,
  requireEnterprisePermission,
} from "../services/enterprisePermissions";
import type { ErpPermissionKey } from "../../../shared/erpPermissions";
import {
  parseEnterpriseRequestHeaders,
  runWithEnterpriseRequestContext,
} from "../services/enterpriseRequestContext";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error, path }) {
    if (path?.startsWith("forum.") && error.code === "INTERNAL_SERVER_ERROR") {
      return {
        ...shape,
        message: "论坛暂不可用，请稍后重试",
        data: { ...shape.data, stack: undefined },
      };
    }
    return { ...shape, data: { ...shape.data, businessFailure: businessFailureForError(error) } };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  const user = ctx.user;
  const delegation = ctx.staffDelegation;
  if (delegation && delegation.staffUserId !== user.id) {
    throw new TRPCError({ code: "FORBIDDEN", message: "内部员工委派主体不一致", cause: new BusinessFailureCause("STAFF_BINDING_INVALID") });
  }
  // Only the service-key internal path can construct staffDelegation. It is more
  // authoritative than a header and has no relationship to the user's browser
  // selection. Ordinary browser callers keep the validated header contract.
  const enterpriseRequest = delegation
    ? { enterpriseId: delegation.enterpriseId, applicationId: null, newApplication: false }
    : parseEnterpriseRequestHeaders(ctx.req?.headers ?? {});
  return runWithEnterpriseRequestContext({
    ...enterpriseRequest,
    actorUserId: user.id,
  }, () => next({
    ctx: {
      ...ctx,
      user,
      effectiveUserId: ctx.effectiveUserId ?? user.id,
    },
  }));
});

export const protectedProcedure = t.procedure.use(requireUser);

/**
 * 匿名安全摘要与经审定的公开内容：仅对游客按 IP 限频。
 * 此过程绝非登录门禁，不能用于任何精确报价、数量或内部数据；
 * 后者必须先经 quotaProcedure 或更严格的企业权限过程。
 */
export const dataViewProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user && ctx.req) {
      const ip = clientIp(ctx.req);
      if (await anonViewExceeded(ip)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: ANON_LIMIT_ERR_MSG });
      }
    }
    return next();
  }),
);

async function enforceSharedExactReadQuota(userId: number) {
  let exceeded: boolean;
  try {
    exceeded = await sharedDailyQuotaExceeded(userId);
  } catch {
    // Precise commercial data must never fall back to per-worker memory.
    console.error("[quota] shared exact-read counter unavailable");
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "查询服务暂不可用，请稍后重试" });
  }
  if (exceeded) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: DAILY_QUOTA_ERR_MSG });
  }
}

/** Public preview for visitors; authenticated exact results count against the shared daily budget. */
export const previewOrQuotaProcedure = dataViewProcedure.use(
  t.middleware(async ({ ctx, next }) => {
    if (ctx.user) await enforceSharedExactReadQuota(ctx.user.id);
    return next();
  }),
);

/**
 * 需登录 + 计入每日查询配额。
 * 用于 BOM 配单等“登录后才能用、但会返回批量行情数据”的接口。
 * 一次调用计 1 次（不按行数），理由见 server/dailyQuota.ts。
 */
export const quotaProcedure = protectedProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    await enforceSharedExactReadQuota(ctx.user.id);
    return next();
  }),
);

export const crmProcedure = protectedProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    const access = await requireCrmEnterpriseAccess({ user: ctx.user });
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        effectiveUserId: access.dataOwnerUserId,
      },
    });
  }),
);

/**
 * ERP 模块级门禁。先确认企业总ERP状态，再按独立账号企业成员权限逐请求校验。
 * 前端菜单过滤仅改善体验，不能替代此服务端检查。
 */
function createCrmPermissionMiddleware(permissionKeys: readonly ErpPermissionKey[]) {
  return t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    const access = await requireCrmEnterpriseAccess({ user: ctx.user });
    const permissionScope = permissionKeys.length === 1
      ? await requireEnterprisePermission(ctx.user.id, permissionKeys[0])
      : await requireAnyEnterprisePermission(ctx.user.id, permissionKeys);
    if (permissionScope.dataOwnerUserId !== access.dataOwnerUserId) {
      throw new TRPCError({ code: "CONFLICT", message: "企业数据归属已变化，请重新登录" });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
        effectiveUserId: access.dataOwnerUserId,
        enterprisePermission: permissionKeys[0],
        enterprisePermissionScope: permissionScope,
      },
    });
  });
}

export function createCrmPermissionProcedure(permissionKey: ErpPermissionKey) {
  return protectedProcedure.use(createCrmPermissionMiddleware([permissionKey]));
}

export function createCrmAnyPermissionProcedure(permissionKeys: readonly ErpPermissionKey[]) {
  return protectedProcedure.use(createCrmPermissionMiddleware(permissionKeys));
}

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);
