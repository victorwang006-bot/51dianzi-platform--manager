import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const native = vi.hoisted(() => ({ updateAdminUser: vi.fn(), toggleAdminUserStatus: vi.fn(), getAdminUserById: vi.fn() }));
vi.mock("./db", () => native);
import { appRouter } from "./routers";
const now = new Date("2026-11-14T00:00:00Z");
function context(role = "super_admin"): TrpcContext {
  return {
    user: { id: 10, openId: "local_admin:10", name: "真实操作者", email: null, loginMethod: "password", role: "admin", createdAt: now, updatedAt: now, lastSignedIn: now },
    adminAccount: { id: 10, userId: 10, username: "native-10", usernameCanonical: "native-10", displayName: "真实操作者", email: null, phone: null, passwordHash: null, adminRole: role, status: "active", sessionVersion: 7, mfaEnabled: false, lastLoginAt: null, createdAt: now, updatedAt: now } as TrpcContext["adminAccount"],
    adminPermissions: [],
    req: { protocol: "https", headers: { "user-agent": "mock-ui", "x-forwarded-for": "127.0.0.1" } } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
const valid = { id: 20, status: "disabled" as const, expectedStatus: "active" as const, reason: "实际停用原因" };
beforeEach(() => { vi.clearAllMocks(); native.updateAdminUser.mockResolvedValue(undefined); native.toggleAdminUserStatus.mockResolvedValue(undefined); });
describe("Staff account status router (native DB fully mocked)", () => {
  it("supplies authenticated actor/version/audit and the exact CAS DTO on toggle", async () => {
    const result = await appRouter.createCaller(context()).adminUser.toggleStatus(valid);
    expect(result).toEqual({ success: true });
    expect(native.toggleAdminUserStatus).toHaveBeenCalledWith(20, "disabled", 10, expect.objectContaining({ expectedStatus: "active", reason: valid.reason, actorSessionVersion: 7, statusAudit: { operatorId: 10, operatorName: "真实操作者", operatorRole: "super_admin", ipAddress: "127.0.0.1", userAgent: "mock-ui" } }));
  });
  it("generic status update uses the same authenticated actor/baseline/reason boundary", async () => {
    await appRouter.createCaller(context()).adminUser.update(valid);
    expect(native.updateAdminUser).toHaveBeenCalledWith(20, expect.objectContaining({ status: "disabled", expectedStatus: "active", reason: valid.reason, actorAdminUserId: 10, actorSessionVersion: 7, statusAudit: expect.objectContaining({ operatorId: 10 }) }));
  });
  it.each(["toggleStatus", "update"] as const)("%s rejects old baseline-free or reason-free calls before any DB write", async route => {
    const caller = appRouter.createCaller(context());
    for (const input of [{ id: 20, status: "disabled" as const }, { ...valid, expectedStatus: undefined }, { ...valid, reason: undefined }, { ...valid, reason: " " }])
      await expect(caller.adminUser[route](input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(native.updateAdminUser).not.toHaveBeenCalled(); expect(native.toggleAdminUserStatus).not.toHaveBeenCalled();
  });
  it.each(["toggleStatus", "update"] as const)("%s preserves admins.manage middleware denial for ordinary accounts", async route => {
    await expect(appRouter.createCaller(context("merchant_mgr")).adminUser[route](valid)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(native.updateAdminUser).not.toHaveBeenCalled(); expect(native.toggleAdminUserStatus).not.toHaveBeenCalled();
  });
  it.each([
    ["ADMIN_STATUS_CONFLICT", "CONFLICT"], ["ADMIN_USER_LOCKED", "PRECONDITION_FAILED"],
    ["ADMIN_ACTOR_FORBIDDEN", "FORBIDDEN"], ["ADMIN_ACTOR_SESSION_STALE", "UNAUTHORIZED"],
    ["ADMIN_USER_ARCHIVED", "PRECONDITION_FAILED"], ["ADMIN_SELF_DISABLE_FORBIDDEN", "BAD_REQUEST"],
    ["LAST_SUPER_ADMIN_FORBIDDEN", "BAD_REQUEST"], ["ADMIN_STATUS_EXPECTED_REQUIRED", "BAD_REQUEST"],
    ["ADMIN_STATUS_REASON_REQUIRED", "BAD_REQUEST"], ["ADMIN_USER_NOT_FOUND", "NOT_FOUND"],
  ])("maps %s to %s on both status paths", async (error, code) => {
    native.updateAdminUser.mockRejectedValue(new Error(error)); native.toggleAdminUserStatus.mockRejectedValue(new Error(error));
    const caller = appRouter.createCaller(context());
    await expect(caller.adminUser.toggleStatus(valid)).rejects.toMatchObject({ code });
    await expect(caller.adminUser.update(valid)).rejects.toMatchObject({ code });
  });
  it("permissions/role/password-only updates still accept existing inputs without status/reason", async () => {
    native.getAdminUserById.mockResolvedValue({ id: 20, adminRole: "merchant_mgr" });
    await appRouter.createCaller(context()).adminUser.update({ id: 20, adminRole: "merchant_mgr", permissions: ["merchants.read", "profile.manage"], password: "ResetPass@123" });
    const input = native.updateAdminUser.mock.calls[0][1];
    expect(input.permissions).toContain("merchants.read"); expect(input.permissions).toContain("profile.manage");
    expect(input.passwordHash).toMatch(/^\$2/); expect(input.status).toBeUndefined(); expect(input.reason).toBeUndefined();
  });
});
