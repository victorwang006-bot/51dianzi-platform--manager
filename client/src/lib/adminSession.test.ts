import { describe, expect, it } from "vitest";
import { buildAdminAuthUser } from "./adminSession";

describe("buildAdminAuthUser", () => {
  it("将登录账号立即转换为 auth.me 缓存数据", () => {
    const createdAt = new Date("2026-08-03T00:00:00.000Z");
    const updatedAt = new Date("2026-08-03T00:01:00.000Z");
    const lastLoginAt = new Date("2026-08-03T00:02:00.000Z");

    expect(buildAdminAuthUser({
      id: 8,
      username: "admin",
      displayName: "系统管理员",
      email: "admin@51dianzi.com",
      adminRole: "super_admin",
      createdAt,
      updatedAt,
      lastLoginAt,
    })).toEqual({
      id: 8,
      openId: "local_admin:8",
      name: "系统管理员",
      email: "admin@51dianzi.com",
      loginMethod: "password",
      role: "admin",
      createdAt,
      updatedAt,
      lastSignedIn: lastLoginAt,
      adminRole: "super_admin",
      username: "admin",
    });
  });

  it("没有显示名称和最近登录时间时使用稳定回退值", () => {
    const createdAt = new Date("2026-08-03T00:00:00.000Z");
    const result = buildAdminAuthUser({
      id: 9,
      username: "operator",
      displayName: null,
      email: null,
      adminRole: "operator",
      createdAt,
      updatedAt: createdAt,
      lastLoginAt: null,
    });

    expect(result.name).toBe("operator");
    expect(result.lastSignedIn).toBe(createdAt);
  });
});
