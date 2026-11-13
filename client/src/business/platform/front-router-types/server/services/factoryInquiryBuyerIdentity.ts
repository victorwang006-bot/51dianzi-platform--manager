import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { Enterprise } from "../../drizzle/schema";
import type { BusinessIdentity, ChatSqlExecutor } from "./actorBusinessIdentity";
import { getEnterpriseBusinessRequestContext } from "./enterpriseRequestContext";
import { readAuthoritativeEnterpriseAccessStatus } from "./enterpriseListForCurrentUser";

/** Factory direct-entry requires an explicit, actor-bound existing business selection. */
export function requireFactoryBuyerEnterpriseRequest(actorUserId: number): number {
  if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "登录身份无效" });
  }
  // This rejects application/newApplication contexts and never inherits another actor's scope.
  const request = getEnterpriseBusinessRequestContext(actorUserId);
  const enterpriseId = request?.enterpriseId;
  if (typeof enterpriseId !== "number" || !Number.isSafeInteger(enterpriseId) || enterpriseId <= 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先明确选择经营买方企业，再发起工厂询价" });
  }
  return enterpriseId;
}

/** Read-only factory gate, after the existing actor resolver and before replay/source lease/transaction. */
export async function requireFactoryInquiryBuyerOperatingIdentity(
  executor: ChatSqlExecutor,
  actorUserId: number,
  identity: BusinessIdentity,
): Promise<void> {
  const enterpriseId = requireFactoryBuyerEnterpriseRequest(actorUserId);
  // The production handler already applied account/loginDisabled/active-member/canonical-name checks.
  if (identity.enterpriseId !== enterpriseId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前账号不是所选企业成员" });
  }
  const result = await executor.execute(sql`
    SELECT e.* FROM enterprises e
     WHERE e.id = ${enterpriseId}
     LIMIT 1
  `);
  const enterprise = (result as unknown as [Enterprise[], unknown])[0][0];
  if (!enterprise || Number(enterprise.id) !== enterpriseId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "所选经营企业不存在或已变化" });
  }
  // Reuse the enterprise switcher's authoritative status; no CRM synchronization writes or grants.
  if (await readAuthoritativeEnterpriseAccessStatus(enterprise) !== "enabled") {
    throw new TRPCError({ code: "FORBIDDEN", message: "所选企业尚未开通经营权限，不能发起工厂询价" });
  }
}
