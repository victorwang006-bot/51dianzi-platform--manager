import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const router = read("server/routers.ts");
const api = read("server/platformEnterpriseApi.ts");
const panel = read("client/src/components/admin/MerchantEnterpriseUsersPanel.tsx");
const permissions = read("shared/erpPermissions.ts");

describe("商户详情企业用户管理", () => {
  it("只从服务端商户记录派生企业绑定，不接收浏览器信用代码、所有者或操作人", () => {
    const helperStart = router.indexOf("async function getPlatformEnterpriseBinding");
    const helperEnd = router.indexOf("// 前台对接鉴权", helperStart);
    const helper = router.slice(helperStart, helperEnd);
    expect(helper).toContain("await assertMerchantInSalesScope(ctx, merchantId)");
    expect(helper).toContain('merchant.crmStatus !== "enabled"');
    expect(helper).toContain("merchant.businessLicense");
    expect(helper).toContain("merchant.crmOwnerPortalUserId");
    expect(helper).toContain("expectedOwnerUserId: ownerUserId");

    const start = router.indexOf("enterpriseMembers: merchantReadProcedure");
    const end = router.indexOf("operationRecords:", start);
    const routes = router.slice(start, end);
    expect(routes).toContain("getPlatformEnterpriseBinding(ctx, input.merchantId)");
    expect(routes).toContain("platformEnterpriseOperatorFromContext(ctx)");
    expect(routes).not.toContain("creditCode: z.");
    expect(routes).not.toContain("expectedOwnerUserId: z.");
    expect(routes).not.toContain("operator: z.");
  });

  it("代理固定的成员、状态、权限、范围和网站登录过程并脱敏上游错误", () => {
    expect(api).toContain('internalEnterprise.${procedure}?batch=1');
    expect(api).toContain('expectedOwnerUserId: number');
    for (const procedure of [
      '"members"',
      '"setMemberStatus"',
      '"setMemberPermissions"',
      '"setMemberScope"',
      '"setLoginDisabled"',
    ]) {
      expect(api).toContain(procedure);
    }
    expect(api).toContain('raw.split(key).join("[REDACTED]")');
    expect(api).toContain("AbortSignal.timeout(10_000)");
    expect(api).toContain("maskedPhone: string | null");
    expect(api).toContain("loginDisabled: boolean");
  });

  it("所有成员写操作保持商户写权限、原因、幂等请求号与服务端范围复核", () => {
    for (const name of [
      "setEnterpriseMemberStatus",
      "setEnterpriseMemberPermissions",
      "setEnterpriseMemberScope",
    ]) {
      expect(router).toContain(`${name}: merchantWriteProcedure`);
    }
    expect(router).toContain("setEnterpriseMemberLoginDisabled: merchantUserLoginProcedure");
    expect(router).toContain('hasAdminPermission(role, "portalUsers.manage"');
    expect(router).toContain('reason: z.string().trim().min(1).max(500)');
    expect(router).toContain('requestId: z.string().trim().min(8).max(64)');
    expect(router).toContain("setPlatformEnterpriseLoginDisabled");
  });

  it("企业用户抽屉保护所有者企业权限，并允许超级管理员独立管控其网站登录", () => {
    expect(panel).toContain("data-owner-protection");
    expect(panel).toContain("managedMember.isOwner");
    expect(panel).toContain("企业所有者的权限、业务范围和成员状态不可修改");
    expect(panel).toContain("canOverrideOwnerLogin");
    expect(panel).toContain("canControlManagedLogin");
    expect(panel).toContain("merchantApi.setEnterpriseMemberLoginDisabled.useMutation()");
    expect(panel).toContain("const disabled = !managedMember.loginDisabled");
    expect(panel).toContain("disabled,");
    expect(panel).toContain("恢复网站登录");
    expect(panel).toContain("禁用网站登录");
    expect(panel).not.toContain("trpc.frontendUser");
    expect(panel).not.toContain("platformUser");
  });

  it("商户详情按后台权限返回登录控制和所有者处罚能力", () => {
    expect(router).toContain("canManageLogin");
    expect(router).toContain('hasAdminPermission(role, "portalUsers.manage"');
    expect(router).toContain("canOverrideOwnerLogin: canManageLogin && role === \"super_admin\"");
  });

  it("权限键与主站现行六项 ERP 权限一致", () => {
    for (const key of [
      "inventory.manage",
      "inventory.publish",
      "sales_orders.manage",
      "inventory.inbound",
      "inventory.dashboard",
      "enterprise.members.manage",
    ]) {
      expect(permissions).toContain(`"${key}"`);
    }
  });
});
