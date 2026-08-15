import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRole } from "../shared/adminPermissions";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getPlatformUserStats: vi.fn(),
  listPlatformUsers: vi.fn(),
  getEnabledErpPortalUserIds: vi.fn(),
}));

vi.mock("./platformUserApi", () => ({
  getPlatformUserStats: mocks.getPlatformUserStats,
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
    mocks.listPlatformUsers.mockReset();
    mocks.getEnabledErpPortalUserIds.mockReset();
  });

  it("统计使用前台总用户并用后台已开通绑定计算ERP与普通用户", async () => {
    mocks.getPlatformUserStats.mockResolvedValue({ totalUsers: 20, todayRegistered: 0, sevenDayActive: 7 });
    mocks.getEnabledErpPortalUserIds.mockResolvedValue(["2", "6", "9", "18"]);
    const caller = appRouter.createCaller(createContext("auditor"));
    await expect(caller.frontendUser.stats()).resolves.toEqual({
      totalUsers: 20,
      todayRegistered: 0,
      sevenDayActive: 7,
      erpUsers: 4,
      ordinaryUsers: 16,
    });
  });

  it("分页列表按权威绑定账号标记ERP用户", async () => {
    mocks.listPlatformUsers.mockResolvedValue({
      total: 2,
      rows: [
        { id: 18, username: "erp-user", name: "ERP用户", phone: null, email: null, loginMethod: "password", companyName: "ERP企业", creditCode: null, createdAt: new Date(), lastSignedIn: new Date() },
        { id: 19, username: "ordinary-user", name: "普通用户", phone: null, email: null, loginMethod: "password", companyName: null, creditCode: null, createdAt: new Date(), lastSignedIn: new Date() },
      ],
    });
    mocks.getEnabledErpPortalUserIds.mockResolvedValue(["18"]);
    const caller = appRouter.createCaller(createContext("auditor"));
    const result = await caller.frontendUser.list({ page: 1, pageSize: 20, keyword: "用户" });
    expect(result.rows.map(row => [row.id, row.userType])).toEqual([[18, "erp"], [19, "ordinary"]]);
    expect(mocks.listPlatformUsers).toHaveBeenCalledWith({ page: 1, pageSize: 20, keyword: "用户" });
  });
});
