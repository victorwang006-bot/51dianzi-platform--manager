import { describe, expect, it } from "vitest";
import {
  ADMIN_PERMISSIONS,
  hasAdminPermission,
  type AdminRole,
} from "../shared/adminPermissions";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

function createContext(adminRole: AdminRole): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 9001,
      openId: "local_admin:9001",
      name: "权限测试账号",
      email: "permissions@example.com",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    adminAccount: {
      id: 9001,
      userId: 9001,
      username: "permission-test",
      displayName: "权限测试账号",
      email: "permissions@example.com",
      phone: null,
      passwordHash: null,
      adminRole,
      status: "active",
      mfaEnabled: false,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("后台角色权限矩阵", () => {
  it("超级管理员拥有全部权限", () => {
    for (const permission of ADMIN_PERMISSIONS) {
      expect(hasAdminPermission("super_admin", permission)).toBe(true);
    }
  });

  it("审计角色仅拥有业务模块只读权限", () => {
    expect(hasAdminPermission("auditor", "materials.read")).toBe(true);
    expect(hasAdminPermission("auditor", "merchants.read")).toBe(true);
    expect(hasAdminPermission("auditor", "messages.read")).toBe(true);
    expect(hasAdminPermission("auditor", "orders.read")).toBe(true);
    expect(hasAdminPermission("auditor", "orders.write")).toBe(false);
    expect(hasAdminPermission("auditor", "materials.write")).toBe(false);
    expect(hasAdminPermission("auditor", "admins.manage")).toBe(false);
  });

  it("仅超级管理员和平台运营拥有订单履约写权限", () => {
    expect(hasAdminPermission("super_admin", "orders.write")).toBe(true);
    expect(hasAdminPermission("operation", "orders.write")).toBe(true);
    expect(hasAdminPermission("merchant_mgr", "orders.write")).toBe(false);
    expect(hasAdminPermission("customer_svc", "orders.write")).toBe(false);
    expect(hasAdminPermission("finance", "orders.write")).toBe(false);
  });

  it("普通运营角色不能调用后台用户管理接口", async () => {
    const caller = appRouter.createCaller(createContext("operation"));
    await expect(caller.adminUser.list({ page: 1, pageSize: 20 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("审计角色不能修改物料状态", async () => {
    const caller = appRouter.createCaller(createContext("auditor"));
    await expect(
      caller.material.toggleStatus({ id: 1, status: "disabled" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
