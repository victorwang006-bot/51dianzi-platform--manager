import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import { COOKIE_NAME } from "../shared/const";
const native = vi.hoisted(() => ({
  getAdminUserById: vi.fn(),
  updateAdminUser: vi.fn(),
  profile: vi.fn(),
  changePassword: vi.fn(),
}));
vi.mock("./db", () => ({
  getAdminUserById: native.getAdminUserById,
  updateAdminUser: native.updateAdminUser,
}));
vi.mock("./personalCenterService", () => ({
  personalCenterService: {
    profile: native.profile,
    changePassword: native.changePassword,
  },
  getPersonalPerformance: vi.fn(),
}));
import { appRouter } from "./routers";
const account = {
  id: 998511,
  username: "fictional_owner",
  displayName: "本人",
  phone: "+8613900000001",
  email: null,
  adminRole: "finance",
  status: "active",
  passwordHash: "fictional-old-hash",
  sessionVersion: 8,
};
function context() {
  return {
    user: { id: account.id, role: "admin" },
    adminAccount: { ...account },
    adminPermissions: ["profile.manage"],
    req: { headers: {}, protocol: "https" },
    res: { clearCookie: vi.fn() },
  } as unknown as TrpcContext;
}
const profileInput = (phone = "13900000001") => ({
  displayName: "新本人",
  phone,
  email: "Owner@Example.com",
});
beforeEach(() => {
  vi.clearAllMocks();
  native.profile.mockResolvedValue({ ...account });
  native.getAdminUserById.mockResolvedValue({
    ...account,
    displayName: "新本人",
    email: "owner@example.com",
  });
  native.changePassword.mockResolvedValue({
    success: true,
    requiresRelogin: true,
  });
});
describe("legacy auth personal-center safety closure (fictional IO)", () => {
  it("rejects arbitrary phone takeover and clearing even when session has profile.manage", async () => {
    for (const phone of ["13900000002", ""]) {
      await expect(
        appRouter
          .createCaller(context())
          .auth.updateProfile(profileInput(phone))
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "请在个人中心验证手机号后绑定或更换",
      });
    }
    expect(native.updateAdminUser).not.toHaveBeenCalled();
  });
  it.each(["13900000001", "+8613900000001", "008613900000001"])(
    "permits equivalent fresh phone %s while never writing phone/grants and preserving old response shape",
    async phone => {
      const ctx = context();
      const result = await appRouter
        .createCaller(ctx)
        .auth.updateProfile(profileInput(phone));
      expect(native.profile).toHaveBeenCalledWith(ctx.adminAccount);
      expect(native.updateAdminUser).toHaveBeenCalledWith(account.id, {
        displayName: "新本人",
        email: "owner@example.com",
      });
      expect(result).toEqual({
        username: account.username,
        displayName: "新本人",
        phone: account.phone,
        email: "owner@example.com",
        adminRole: "merchant_mgr",
      });
    }
  );
  it("uses fresh bound phone instead of ctx phone; stale form cannot undo newly bound phone", async () => {
    native.profile.mockResolvedValue({ ...account, phone: "13900000002" });
    await expect(
      appRouter.createCaller(context()).auth.updateProfile(profileInput())
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(native.updateAdminUser).not.toHaveBeenCalled();
    await appRouter
      .createCaller(context())
      .auth.updateProfile(profileInput("13900000002"));
    expect(native.updateAdminUser.mock.calls[0][1]).not.toHaveProperty("phone");
  });
  it.each(["stale", "disabled", "archive"])(
    "rejects %s fresh profile session before names/email writes",
    async () => {
      native.profile.mockRejectedValueOnce(
        new TRPCError({
          code: "UNAUTHORIZED",
          message: "登录状态已失效，请重新登录",
        })
      );
      await expect(
        appRouter.createCaller(context()).auth.updateProfile(profileInput())
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(native.updateAdminUser).not.toHaveBeenCalled();
    }
  );
  it("preserves OAuth/non-native FORBIDDEN errors for both old handlers", async () => {
    const ctx = context();
    ctx.adminAccount = null;
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.auth.updateProfile(profileInput())
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "当前会话不支持编辑个人信息",
    });
    await expect(
      caller.auth.changePassword({
        oldPassword: "old-fictional",
        newPassword: "new-fictional",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "当前会话不支持修改密码",
    });
    expect(native.profile).not.toHaveBeenCalled();
    expect(native.changePassword).not.toHaveBeenCalled();
  });
  it("delegates old-password verification to fresh CAS service and clears cookie only after success", async () => {
    const ctx = context();
    ctx.adminPermissions = [];
    const input = {
      oldPassword: "old-fictional",
      newPassword: "new-fictional",
    };
    const result = await appRouter.createCaller(ctx).auth.changePassword(input);
    expect(native.changePassword).toHaveBeenCalledWith(ctx.adminAccount, input);
    expect(native.updateAdminUser).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, requiresRelogin: true });
    expect(ctx.res.clearCookie).toHaveBeenCalledWith(
      COOKIE_NAME,
      expect.objectContaining({
        maxAge: -1,
        httpOnly: true,
        sameSite: "none",
        secure: true,
        path: "/",
      })
    );
  });
  it("cannot overwrite a new password using stale ctx old hash or clear cookie after CAS rejection", async () => {
    native.changePassword.mockRejectedValueOnce(
      new TRPCError({
        code: "UNAUTHORIZED",
        message: "登录状态已失效，请重新登录",
      })
    );
    const ctx = context();
    await expect(
      appRouter
        .createCaller(ctx)
        .auth.changePassword({
          oldPassword: "old-fictional",
          newPassword: "new-fictional",
        })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(native.updateAdminUser).not.toHaveBeenCalled();
    expect(ctx.res.clearCookie).not.toHaveBeenCalled();
  });
  it("bounds oldPassword at 128 without changing existing input field names", async () => {
    await expect(
      appRouter
        .createCaller(context())
        .auth.changePassword({
          oldPassword: "x".repeat(129),
          newPassword: "new-fictional",
        })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(native.changePassword).not.toHaveBeenCalled();
  });
});
