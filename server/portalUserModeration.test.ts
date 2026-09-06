import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRole } from "../shared/adminPermissions";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  getPlatformUserStats: vi.fn(),
  listPlatformUsers: vi.fn(),
  setPlatformUserLoginDisabled: vi.fn(),
  setPlatformUserForumMute: vi.fn(),
  getPlatformUserModerationHistory: vi.fn(),
  getPlatformUserForumMessages: vi.fn(),
  hidePlatformForumMessage: vi.fn(),
}));

vi.mock("./platformUserApi", () => mocks);

import {
  ADMIN_PERMISSIONS,
  hasAdminPermission,
  normalizeAssignedAdminPermissions,
} from "../shared/adminPermissions";
import { appRouter } from "./routers";

function createContext(adminRole: AdminRole, permissions?: string[]): TrpcContext {
  const now = new Date("2026-09-01T00:00:00.000Z");
  return {
    user: {
      id: 9001,
      openId: "local_admin:9001",
      name: "安全运营",
      email: "operator@example.com",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    adminAccount: {
      id: 88,
      userId: 9001,
      username: "security-operator",
      displayName: "安全运营",
      email: "operator@example.com",
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
    req: {
      protocol: "https",
      ip: "10.0.0.8",
      headers: {
        "x-forwarded-for": "203.0.113.12, 10.0.0.8",
        "user-agent": "moderation-test-agent",
      },
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("前台用户管控权限与路由", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.setPlatformUserLoginDisabled.mockResolvedValue({ success: true });
    mocks.setPlatformUserForumMute.mockResolvedValue({ success: true });
    mocks.hidePlatformForumMessage.mockResolvedValue({ success: true });
  });

  it("登记可分配的管理权限并自动补齐查看权限", () => {
    expect(ADMIN_PERMISSIONS).toContain("portalUsers.manage");
    expect(normalizeAssignedAdminPermissions(["portalUsers.manage"])).toEqual(
      expect.arrayContaining(["portalUsers.manage", "portalUsers.read", "profile.manage"]),
    );
    expect(hasAdminPermission("operation", "portalUsers.manage")).toBe(true);
    expect(hasAdminPermission("customer_svc", "portalUsers.manage")).toBe(true);
    expect(hasAdminPermission("risk_control", "portalUsers.manage")).toBe(true);
    expect(hasAdminPermission("merchant_mgr", "portalUsers.manage")).toBe(false);
  });

  it("忽略浏览器伪造的 operator，始终从认证上下文构造操作人", async () => {
    const caller = appRouter.createCaller(createContext("operation"));
    await caller.frontendUser.setLoginDisabled({
      userId: 42,
      disabled: true,
      reason: "异常登录风险",
      operator: { id: 1, name: "伪造管理员", role: "super_admin" },
    } as never);

    expect(mocks.setPlatformUserLoginDisabled).toHaveBeenCalledWith({
      userId: 42,
      disabled: true,
      reason: "异常登录风险",
      operator: {
        id: 9001,
        name: "安全运营",
        role: "operation",
        ipAddress: "203.0.113.12",
        userAgent: "moderation-test-agent",
      },
    });
  });

  it("仅有查看权限时所有管控和记录接口均拒绝", async () => {
    const caller = appRouter.createCaller(createContext("merchant_mgr", ["portalUsers.read"]));
    await expect(caller.frontendUser.setForumMute({ userId: 2, durationHours: 3, reason: "刷屏" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.frontendUser.moderationHistory({ userId: 2, limit: 20 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.frontendUser.forumMessages({ userId: 2, limit: 20 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.frontendUser.hideForumMessage({ messageId: 3, reason: "违规" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("严格校验正整数、原因和禁言时长白名单", async () => {
    const caller = appRouter.createCaller(createContext("operation"));
    await expect(caller.frontendUser.setLoginDisabled({ userId: 0, disabled: true, reason: "风险" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.frontendUser.setLoginDisabled({ userId: 1, disabled: true, reason: "   " }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.frontendUser.setForumMute({ userId: 1, durationHours: 12, reason: "刷屏" } as never))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.frontendUser.hideForumMessage({ messageId: -1, reason: "违规" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.setPlatformUserLoginDisabled).not.toHaveBeenCalled();
    expect(mocks.setPlatformUserForumMute).not.toHaveBeenCalled();
    expect(mocks.hidePlatformForumMessage).not.toHaveBeenCalled();
  });

  it("允许严格时长和 null 解除，并代理两类记录查询及撤回", async () => {
    mocks.getPlatformUserModerationHistory.mockResolvedValue([{ id: 1 }]);
    mocks.getPlatformUserForumMessages.mockResolvedValue({ rows: [{ id: 9 }] });
    const caller = appRouter.createCaller(createContext("risk_control"));

    for (const durationHours of [3, 6, 24, 72, 168, null] as const) {
      await caller.frontendUser.setForumMute({ userId: 7, durationHours, reason: durationHours === null ? "管理员解除禁言" : "持续刷屏" });
    }
    await expect(caller.frontendUser.moderationHistory({ userId: 7, limit: 50 })).resolves.toEqual([{ id: 1 }]);
    await expect(caller.frontendUser.forumMessages({ userId: 7, limit: 50 })).resolves.toEqual({ rows: [{ id: 9 }] });
    await caller.frontendUser.hideForumMessage({ messageId: 9, reason: "包含违规内容" });

    expect(mocks.setPlatformUserForumMute).toHaveBeenCalledTimes(6);
    expect(mocks.getPlatformUserModerationHistory).toHaveBeenCalledWith({ userId: 7, limit: 50 });
    expect(mocks.getPlatformUserForumMessages).toHaveBeenCalledWith({ userId: 7, limit: 50 });
    expect(mocks.hidePlatformForumMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageId: 9,
      reason: "包含违规内容",
      operator: expect.objectContaining({ id: 9001, role: "risk_control" }),
    }));
  });
});
