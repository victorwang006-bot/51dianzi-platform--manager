import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";
import { adminProcedure, router } from "../_core/trpc";
import {
  adminNewInformationInspectSchema,
  adminNewInformationMarkSchema,
} from "../../shared/adminNewInformation";
import {
  createAdminNewInformationService,
  type AdminNewInformationDeps,
  type AdminNewInformationService,
  type AdminNewInformationSource,
  type AdminNewInformationViewer,
} from "../services/adminNewInformation";

/** createContext already verifies the local cookie signature/audience/revocation. */
export function adminNewInformationViewerFromContext(
  ctx: TrpcContext
): AdminNewInformationViewer {
  const account = ctx.adminAccount;
  if (
    !account ||
    account.status !== "active" ||
    !Number.isSafeInteger(account.id) ||
    account.id <= 0 ||
    !Number.isSafeInteger(account.sessionVersion) ||
    account.sessionVersion < 1 ||
    !ctx.user ||
    ctx.user.role !== "admin" ||
    ctx.user.id !== account.id ||
    ctx.user.openId !== `local_admin:${account.id}`
  ) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "请使用有效的本地后台账号登录",
    });
  }
  // Source.list/lookup must additionally recheck the CURRENT account/session and
  // authorization; context/user is not an employee/merchant principal substitute.
  return { adminUserId: account.id, sessionVersion: account.sessionVersion };
}
export type AdminNewInformationServiceForContext =
  | AdminNewInformationService
  | ((ctx: TrpcContext) => AdminNewInformationService);
export type AdminNewInformationNativeRouterABI = {
  router: typeof router;
  adminProcedure: typeof adminProcedure;
};

/** No default production provider or root registration: the native build supplies it. */
export function createAdminNewInformationRouter(
  service: AdminNewInformationServiceForContext,
  native: AdminNewInformationNativeRouterABI = { router, adminProcedure }
) {
  const localProcedure = native.adminProcedure.use(async ({ ctx, next }) =>
    next({
      ctx: {
        ...ctx,
        newInformationViewer: adminNewInformationViewerFromContext(ctx),
      },
    })
  );
  const resolve = (ctx: TrpcContext) =>
    typeof service === "function" ? service(ctx) : service;
  async function safe<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      // No SQL/RPC errors or secret-bearing causes are exposed to the client.
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "新增信息核验暂不可用，请稍后重试",
      });
    }
  }
  return native.router({
    summary: localProcedure.query(({ ctx }) =>
      safe(() => resolve(ctx).summary(ctx.newInformationViewer))
    ),
    inspect: localProcedure
      .input(adminNewInformationInspectSchema)
      .query(({ ctx, input }) =>
        safe(() => resolve(ctx).inspect(ctx.newInformationViewer, input))
      ),
    markDisplayed: localProcedure
      .input(adminNewInformationMarkSchema)
      .mutation(({ ctx, input }) =>
        safe(() => resolve(ctx).markDisplayed(ctx.newInformationViewer, input))
      ),
  });
}
export type AdminNewInformationContextDeps = Omit<
  AdminNewInformationDeps,
  "source"
> & {
  /** Bind the authenticated request ctx here; module/refs/baseline come from the core. */
  source: (ctx: TrpcContext) => AdminNewInformationSource;
};
export function createAdminNewInformationRouterForSource(
  deps: AdminNewInformationContextDeps,
  native?: AdminNewInformationNativeRouterABI
) {
  return createAdminNewInformationRouter(
    ctx =>
      createAdminNewInformationService({ ...deps, source: deps.source(ctx) }),
    native
  );
}
export const createRouter = createAdminNewInformationRouter;
