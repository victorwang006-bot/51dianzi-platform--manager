import { TRPCError } from "@trpc/server";
import { getUserById } from "../db";
import { toPublicAuthUser } from "../publicAuthUser";
import { requireEnterprisePermission } from "./enterprisePermissions";
import {
  resolveInternalBusinessEnterprise, runWithBoundBusinessStaffActor,
  type InternalBusinessBinding, type InternalBusinessStaffPrincipal,
} from "./internalBusinessAccess";

/** Exact closed personal-summary path only. Mirrors the normal trusted principal
 * proof but does NOT call requireCrmEnterpriseAccess (which writes status/owner synchronization).
 * Binding enterprise, expected owner, owner member and remote ERP authority remain real/fresh. */
export async function requireInternalPersonalSalesReadPrincipal(input: {
  binding: InternalBusinessBinding; staffUserId: number;
}): Promise<InternalBusinessStaffPrincipal> {
  if (!Number.isSafeInteger(input.staffUserId) || input.staffUserId <= 0)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "缺少经授权的企业员工业务主体" });
  const user = await getUserById(input.staffUserId);
  if (!user || user.loginDisabled || !user.lastSignedIn) throw new TRPCError({ code: "FORBIDDEN", message: "绑定员工账号当前不可用" });
  const enterprise = await resolveInternalBusinessEnterprise(input.binding);
  return runWithBoundBusinessStaffActor({ enterpriseId: enterprise.enterpriseId, actorUserId: user.id, action: async () => {
    const permissionScope = await requireEnterprisePermission(user.id, "sales.business_orders");
    if (permissionScope.enterprise.id !== enterprise.enterpriseId || permissionScope.member.userId !== user.id ||
        permissionScope.dataOwnerUserId !== enterprise.dataOwnerUserId ||
        !Number.isSafeInteger(enterprise.dataOwnerUserId) || enterprise.dataOwnerUserId <= 0)
      throw new TRPCError({ code: "CONFLICT", message: "企业成员归属或数据所有者已变化，请刷新后重试" });
    return { enterprise, permissionScope, actorUserId: user.id, user, publicUser: toPublicAuthUser(user) };
  } });
}
