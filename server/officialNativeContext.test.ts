import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";

function context(nativeAccount: boolean) {
  return {
    user: { id: 990001, role: "admin", name: "虚构认证夹具" },
    adminAccount: nativeAccount
      ? {
          id: 990001,
          sessionVersion: 1,
          status: "active",
          adminRole: "super_admin",
          username: "native-fixture",
        }
      : null,
    adminPermissions: [],
    req: { headers: {} },
    res: {},
  } as any;
}

describe("官方原生账号标记与旧OAuth兼容显示隔离", () => {
  it("保留OAuth既有兼容角色但不授予任何新增官方域权限", async () => {
    const data = await appRouter.createCaller(context(false)).auth.me();
    expect(data?.adminRole).toBe("super_admin");
    expect(data?.hasNativeAdminAccount).toBe(false);
    expect(
      data?.permissions.some(permission => permission.startsWith("official"))
    ).toBe(false);
    expect(data?.permissions).toContain("profile.manage");
  });

  it("真实本地超管认证响应包含官方权限和明确原生身份", async () => {
    const data = await appRouter.createCaller(context(true)).auth.me();
    expect(data?.hasNativeAdminAccount).toBe(true);
    expect(data?.permissions).toContain("officialInventory.read");
    expect(data?.permissions).toContain("officialTeams.manage");
  });

  it("兼容OAuth主体不能调用官方团队配置路由", async () => {
    await expect(
      appRouter.createCaller(context(false)).officialTeams.overview()
    ).rejects.toBeDefined();
  });
});
