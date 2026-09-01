import { describe, expect, it } from "vitest";
import {
  ADMIN_PERMISSIONS,
  hasAdminPermission,
  normalizeAssignedAdminPermissions,
  resolveAdminPermissions,
  type AdminRole,
} from "../shared/adminPermissions";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

function createContext(adminRole: AdminRole, permissions: string[] = []): TrpcContext {
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
    adminPermissions: permissions,
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
    expect(hasAdminPermission("auditor", "materials.write")).toBe(false);
    expect(hasAdminPermission("auditor", "admins.manage")).toBe(false);
  });

  it("订单模块仅暴露读取权限，用户管理独立授权", () => {
    expect(ADMIN_PERMISSIONS).toContain("orders.read");
    expect(ADMIN_PERMISSIONS).not.toContain("orders.write");
    expect(ADMIN_PERMISSIONS).toContain("portalUsers.read");
  });

  it("普通用户优先使用数据库中的用户级模块权限", () => {
    expect(hasAdminPermission("merchant_mgr", "materials.read", ["materials.read"])).toBe(true);
    expect(hasAdminPermission("merchant_mgr", "merchants.read", ["materials.read"])).toBe(false);
    expect(resolveAdminPermissions("merchant_mgr", [])).toContain("merchants.read");
    expect(resolveAdminPermissions("super_admin", [])).toEqual(ADMIN_PERMISSIONS);
  });

  it("可分配权限不包含系统管理权限，写权限自动补齐读权限", () => {
    const normalized = normalizeAssignedAdminPermissions([
      "materials.write",
      "admins.manage",
      "logs.read",
      "orders.read",
    ]);
    expect(normalized).toContain("materials.read");
    expect(normalized).toContain("materials.write");
    expect(normalized).toContain("orders.read");
    expect(normalized).toContain("profile.manage");
    expect(normalized).not.toContain("admins.manage");
    expect(normalized).not.toContain("logs.read");
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
