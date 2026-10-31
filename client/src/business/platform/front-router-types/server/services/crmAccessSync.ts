import * as db from "../db";
import { getAdminCrmAccess, getAdminHkCrmAccess } from "./customerService";
import { triggerCoffeeVoucherAward } from "./coffeeVoucherCampaign";

type AuthUser = NonNullable<Awaited<ReturnType<typeof db.getUserByOpenId>>>;

/**
 * 登录态请求内对账：只在用户已有企业信用代码时查询后台，不使用轮询或后台常驻任务。
 * 后台不可用时保持商城登录可用；只有归属当前 portalUserId 的权威结果才会更新本地门禁。
 */
export async function reconcileCrmAccessForUser(user: AuthUser): Promise<AuthUser> {
  const company = await db.getCompanyByUserId(user.id);
  const creditCode = company?.creditCode;
  const hkRegistrationIdentifier = company?.registrationRegion === "HK"
    ? company.registrationIdentifier?.trim().toUpperCase()
    : null;
  if (!creditCode && !hkRegistrationIdentifier) return user;

  try {
    const result = hkRegistrationIdentifier
      ? await getAdminHkCrmAccess({ registrationIdentifier: hkRegistrationIdentifier, portalUserId: user.id })
      : await getAdminCrmAccess({ creditCode: creditCode!, portalUserId: user.id });
    await db.applyAdminCrmAccess(user.id, result);
    if (result.allowed && result.code === "CRM_ACCESS_GRANTED" && result.crmStatus === "enabled") {
      await triggerCoffeeVoucherAward(user.id);
    }
    return (await db.getUserByOpenId(user.openId)) ?? user;
  } catch (error) {
    console.error("[crmAccessSync] 后台 CRM 状态对账失败，保留本地登录状态:", error);
    return user;
  }
}
