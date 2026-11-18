import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "../_core/trpc";
import { getUserById } from "../db";
import { getAdminCrmAccess, getAdminHkCrmAccess } from "../adminCrmGateway";
import { requireEnterprisePermission } from "../services/enterprisePermissions";
import { normalizeEnterpriseCreditCode } from "../services/enterpriseAccess";
import { normalizeHkEnterpriseRegistrationIdentifier } from "../services/enterpriseRegistrationIdentity";

/** The general CRM middleware synchronizes crmAccess/owner records on reads.
 * Personal statistics must remain genuinely read-only: recheck authority, never synchronize or reconcile. */
export const personalSalesReadProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const user = await getUserById(ctx.user.id);
  if (!user || user.loginDisabled || !user.lastSignedIn) throw new TRPCError({ code: "FORBIDDEN", message: "当前员工账号不可用" });
  const scope = await requireEnterprisePermission(user.id, "sales.business_orders");
  if (ctx.staffDelegation && (ctx.staffDelegation.enterpriseId !== scope.enterprise.id || ctx.staffDelegation.staffUserId !== user.id))
    throw new TRPCError({ code: "FORBIDDEN", message: "当前员工企业范围不一致" });
  if (!Number.isSafeInteger(scope.dataOwnerUserId) || scope.dataOwnerUserId <= 0)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前企业数据归属不可用" });
  const enterprise = scope.enterprise;
  let allowed = false;
  try {
    if (enterprise.registrationRegion === "HK" && enterprise.registrationIdentifier) {
      const identity = normalizeHkEnterpriseRegistrationIdentifier(enterprise.registrationIdentifier);
      allowed = (await getAdminHkCrmAccess({ registrationIdentifier: identity, portalUserId: String(enterprise.superAdminUserId) })).allowed;
    } else if (enterprise.creditCode) {
      allowed = (await getAdminCrmAccess({ creditCode: normalizeEnterpriseCreditCode(enterprise.creditCode), portalUserId: String(enterprise.superAdminUserId) })).allowed;
    }
  } catch {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "企业ERP读取权限暂时无法确认" });
  }
  if (!allowed) throw new TRPCError({ code: "FORBIDDEN", message: "企业ERP当前未开通或已停用" });
  return next({ ctx: { ...ctx, user, enterprisePermissionScope: scope } });
});
