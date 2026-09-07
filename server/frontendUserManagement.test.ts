import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRole } from "../shared/adminPermissions";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getPlatformUserStats: vi.fn(),
  getPlatformErpUserIds: vi.fn(),
  listPlatformUsers: vi.fn(),
  getEnabledErpPortalUserIds: vi.fn(),
}));

vi.mock("./platformUserApi", () => ({
  getPlatformUserStats: mocks.getPlatformUserStats,
  getPlatformErpUserIds: mocks.getPlatformErpUserIds,
  listPlatformUsers: mocks.listPlatformUsers,
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return { ...actual, getEnabledErpPortalUserIds: mocks.getEnabledErpPortalUserIds };
});

import { appRouter } from "./routers";

function createContext(adminRole: AdminRole): TrpcContext {
  const now = new Date("2026-08-11T00:00:00.000Z");
  return {
    user: {
      id: 9001,
      openId: "local_admin:9001",
      name: "用户管理测试账号",
      email: "portal-users@example.com",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    adminAccount: {
      id: 9001,
      userId: 9001,
      username: "portal-users-test",
      displayName: "用户管理测试账号",
      email: "portal-users@example.com",
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

describe("后台前台用户管理", () => {
  beforeEach(() => {
    mocks.getPlatformUserStats.mockReset();
    mocks.getPlatformErpUserIds.mockReset();
    mocks.listPlatformUsers.mockReset();
    mocks.getEnabledErpPortalUserIds.mockReset();
  });

  it("统计使用主站真实权限分类，后台绑定只用于差异诊断", async () => {
    mocks.getPlatformUserStats.mockResolvedValue({
      totalUsers: 325,
      ordinaryUsers: 132,
      erpUsers: 193,
      todayRegistered: 29,
      todayWebsiteRegistered: 16,
      todayMiniProgramRegistered: 13,
      todayOtherRegistered: 0,
      sevenDayActive: 230,
    });
    mocks.getPlatformErpUserIds.mockResolvedValue(["2", "6", "9", "18"]);
    mocks.getEnabledErpPortalUserIds.mockResolvedValue(["2", "6", "20", "21"]);
    const caller = appRouter.createCaller(createContext("super_admin"));
    await expect(caller.frontendUser.stats()).resolves.toEqual({
      totalUsers: 325,
      ordinaryUsers: 132,
      erpUsers: 193,
      todayRegistered: 29,
      todayWebsiteRegistered: 16,
      todayMiniProgramRegistered: 13,
      todayOtherRegistered: 0,
      sevenDayActive: 230,
      erpBindingMismatch: { total: 4, managerOnly: 2, platformOnly: 2 },
    });
  });

  it("非超级管理员不查询也不接收ERP绑定差异", async () => {
    mocks.getPlatformUserStats.mockResolvedValue({
      totalUsers: 20,
      ordinaryUsers: 12,
      erpUsers: 8,
      todayRegistered: 3,
      todayWebsiteRegistered: 2,
      todayMiniProgramRegistered: 1,
      todayOtherRegistered: 0,
      sevenDayActive: 11,
    });
    const caller = appRouter.createCaller(createContext("auditor"));
    const result = await caller.frontendUser.stats();
    expect(result.erpBindingMismatch).toBeNull();
    expect(result).not.toHaveProperty("erpUserIds");
    expect(mocks.getPlatformErpUserIds).not.toHaveBeenCalled();
    expect(mocks.getEnabledErpPortalUserIds).not.toHaveBeenCalled();
  });

  it("分页列表直接使用主站权威ERP标记，不再按后台绑定覆盖", async () => {
    mocks.listPlatformUsers.mockResolvedValue({
      total: 2,
      rows: [
        { id: 18, username: "erp-user", name: "ERP用户", phone: null, email: null, loginMethod: "password", companyName: "ERP企业", creditCode: null, createdAt: new Date(), lastSignedIn: new Date(), userType: "erp" },
        { id: 19, username: "ordinary-user", name: "普通用户", phone: null, email: null, loginMethod: "password", companyName: null, creditCode: null, createdAt: new Date(), lastSignedIn: new Date(), userType: "ordinary" },
      ],
    });
    const caller = appRouter.createCaller(createContext("auditor"));
    const result = await caller.frontendUser.list({ page: 1, pageSize: 20, keyword: "用户" });
    expect(result.rows.map(row => [row.id, row.userType])).toEqual([[18, "erp"], [19, "ordinary"]]);
    expect(mocks.listPlatformUsers).toHaveBeenCalledWith({ page: 1, pageSize: 20, keyword: "用户" });
    expect(mocks.getEnabledErpPortalUserIds).not.toHaveBeenCalled();
  });
});
