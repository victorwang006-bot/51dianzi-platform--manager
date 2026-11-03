import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "../../shared/const";
import { LOCAL_ADMIN_SESSION_APP_ID, parseLocalAdminId } from "../adminAuth";
import { sdk } from "../_core/sdk";
import type { TrpcContext } from "../_core/context";
import { publicProcedure, router } from "../_core/trpc";
import {
  staffOrganizationApplyTemplateInput,
  staffOrganizationAuditInput,
  staffOrganizationCreateTeamInput,
  staffOrganizationOverviewInput,
  staffOrganizationSetMemberInput,
  staffOrganizationUpdateTeamInput,
} from "../../shared/staffOrganization";
import {
  applyStaffOrganizationTemplate,
  createStaffOrganizationTeam,
  getStaffOrganizationAudit,
  getStaffOrganizationOverview,
  setStaffOrganizationMember,
  updateStaffOrganizationTeam,
  type StaffOrganizationActor,
} from "../services/staffOrganization";

/** Do not accept an OAuth compatibility admin, user-supplied actor, or a context snapshot alone. */
export async function staffOrganizationActorFromContext(
  ctx: TrpcContext
): Promise<StaffOrganizationActor> {
  const account = ctx.adminAccount;
  if (
    !ctx.user ||
    ctx.user.role !== "admin" ||
    !account ||
    account.status !== "active"
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "请使用有效的后台工作人员账号登录",
    });
  let token: string | null = null;
  try {
    const part = (ctx.req.headers.cookie ?? "")
      .split(";")
      .map(value => value.trim())
      .find(value => value.startsWith(`${COOKIE_NAME}=`));
    if (part) token = decodeURIComponent(part.slice(COOKIE_NAME.length + 1));
    const auth = ctx.req.headers.authorization;
    if (!token && typeof auth === "string" && auth.startsWith("Bearer "))
      token = auth.slice(7);
  } catch {
    /* Malformed cookie fails closed below. */
  }
  const session = token
    ? await sdk.verifySession(token).catch(() => null)
    : null;
  if (
    !session ||
    session.appId !== LOCAL_ADMIN_SESSION_APP_ID ||
    parseLocalAdminId(session.openId) !== account.id ||
    session.sessionVersion !== account.sessionVersion ||
    !Number.isSafeInteger(session.sessionVersion) ||
    Number(session.sessionVersion) < 1
  )
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "后台签名会话无效或已撤销，请重新登录",
    });
  return {
    adminUserId: account.id,
    sessionVersion: Number(session.sessionVersion),
  };
}
const localProcedure = publicProcedure.use(async ({ ctx, next }) =>
  next({
    ctx: {
      ...ctx,
      staffOrganizationActor: await staffOrganizationActorFromContext(ctx),
    },
  })
);
async function safe<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    // Never send raw SQL/DSN/password-bearing driver errors to the browser.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "运营组织操作失败，请重试；若版本冲突请先刷新",
    });
  }
}
/** Mounted by root as staffOrganization. No native permission flag substitutes for live super_admin. */
export const staffOrganizationRouter = router({
  overview: localProcedure
    .input(staffOrganizationOverviewInput)
    .query(({ ctx }) =>
      safe(() => getStaffOrganizationOverview(ctx.staffOrganizationActor))
    ),
  createTeam: localProcedure
    .input(staffOrganizationCreateTeamInput)
    .mutation(({ ctx, input }) =>
      safe(() => createStaffOrganizationTeam(ctx.staffOrganizationActor, input))
    ),
  updateTeam: localProcedure
    .input(staffOrganizationUpdateTeamInput)
    .mutation(({ ctx, input }) =>
      safe(() => updateStaffOrganizationTeam(ctx.staffOrganizationActor, input))
    ),
  setMember: localProcedure
    .input(staffOrganizationSetMemberInput)
    .mutation(({ ctx, input }) =>
      safe(() => setStaffOrganizationMember(ctx.staffOrganizationActor, input))
    ),
  applyTemplate: localProcedure
    .input(staffOrganizationApplyTemplateInput)
    .mutation(({ ctx, input }) =>
      safe(() =>
        applyStaffOrganizationTemplate(ctx.staffOrganizationActor, input)
      )
    ),
  audit: localProcedure
    .input(staffOrganizationAuditInput)
    .query(({ ctx, input }) =>
      safe(() => getStaffOrganizationAudit(ctx.staffOrganizationActor, input))
    ),
});
