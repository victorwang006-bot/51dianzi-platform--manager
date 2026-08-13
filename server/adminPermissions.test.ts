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

describe("后台双角色权限矩阵", () => {
  it("超级管理员拥有全部权限", () => {
    for (const permission of ADMIN_PERMISSIONS) {
      expect(hasAdminPermission("super_admin", permission)).toBe(true);
    }
  });

  it("普通用户仅拥有商户读写和订单读取权限", () => {
    expect(hasAdminPermission("merchant_mgr", "merchants.read")).toBe(true);
    expect(hasAdminPermission("merchant_mgr", "merchants.write")).toBe(true);
    expect(hasAdminPermission("merchant_mgr", "orders.read")).toBe(true);
    expect(hasAdminPermission("merchant_mgr", "materials.read")).toBe(false);
    expect(hasAdminPermission("merchant_mgr", "materials.write")).toBe(false);
    expect(hasAdminPermission("merchant_mgr", "messages.read")).toBe(false);
    expect(hasAdminPermission("merchant_mgr", "messages.write")).toBe(false);
    expect(hasAdminPermission("merchant_mgr", "admins.manage")).toBe(false);
  });

  it("订单模块仅暴露读取权限", () => {
    expect(ADMIN_PERMISSIONS).toContain("orders.read");
    expect(ADMIN_PERMISSIONS).not.toContain("orders.write");
  });

  it("普通用户不能调用后台用户管理、前台用户管理或消息管理接口", async () => {
    const caller = appRouter.createCaller(createContext("merchant_mgr"));
    await expect(caller.adminUser.list({ page: 1, pageSize: 20 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.frontendUser.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.message.unreadCount()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("普通用户不能修改物料状态", async () => {
    const caller = appRouter.createCaller(createContext("merchant_mgr"));
    await expect(caller.material.toggleStatus({ id: 1, status: "disabled" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
