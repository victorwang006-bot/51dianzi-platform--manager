import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    updateAdminUser: vi.fn(),
    getAdminUserById: vi.fn(),
    setAdminUserPassword: vi.fn(),
  };
});

import { hashPassword, verifyPassword } from "./adminAuth";
import * as db from "./db";
import { appRouter } from "./routers";

const now = new Date("2026-08-13T00:00:00.000Z");

function createContext(role: "super_admin" | "merchant_mgr" = "merchant_mgr"): TrpcContext {
  return {
    user: {
      id: 701,
      openId: "local_admin:701",
      name: "原用户名称",
      email: "old@example.com",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    adminAccount: {
      id: 701,
      userId: 0,
      username: "profile-user",
      displayName: "原用户名称",
      email: "old@example.com",
      phone: "13800000000",
      passwordHash: null,
      adminRole: role,
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

const updatedAccount = {
  ...createContext().adminAccount!,
  displayName: "新用户名称",
  phone: "13900000000",
  email: "new@example.com",
};

describe("后台个人信息接口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.updateAdminUser).mockResolvedValue(undefined);
    vi.mocked(db.getAdminUserById).mockResolvedValue(updatedAccount);
    vi.mocked(db.setAdminUserPassword).mockResolvedValue(undefined);
  });

  it("普通用户可以读取本人资料且不返回密码哈希", async () => {
    const caller = appRouter.createCaller(createContext("merchant_mgr"));
    const profile = await caller.auth.profile();
    expect(profile).toEqual({
      username: "profile-user",
      displayName: "原用户名称",
      phone: "13800000000",
      email: "old@example.com",
      adminRole: "merchant_mgr",
    });
    expect(profile).not.toHaveProperty("passwordHash");
  });

  it("本人更新资料直接写入同一后台账号并规范化邮箱", async () => {
    const caller = appRouter.createCaller(createContext());
    const result = await caller.auth.updateProfile({
      displayName: " 新用户名称 ",
      phone: "13900000000",
      email: "NEW@EXAMPLE.COM",
    });
    expect(db.updateAdminUser).toHaveBeenCalledWith(701, {
      displayName: "新用户名称",
      phone: "13900000000",
      email: "new@example.com",
    });
    expect(db.getAdminUserById).toHaveBeenCalledWith(701);
    expect(result.displayName).toBe("新用户名称");
  });

  it("拒绝非法手机号、非法邮箱和OAuth兼容会话修改资料", async () => {
    const caller = appRouter.createCaller(createContext());
    await expect(caller.auth.updateProfile({
      displayName: "测试用户",
      phone: "abc",
      email: "test@example.com",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.auth.updateProfile({
      displayName: "测试用户",
      phone: "13800000000",
      email: "invalid-email",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const oauthContext = createContext("super_admin");
    oauthContext.adminAccount = null;
    const oauthCaller = appRouter.createCaller(oauthContext);
    await expect(oauthCaller.auth.profile()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("修改密码必须验证当前密码，并拒绝与当前密码相同的新密码", async () => {
    const context = createContext();
    context.adminAccount!.passwordHash = await hashPassword("CurrentPass123!");
    const caller = appRouter.createCaller(context);

    await expect(caller.auth.changePassword({
      oldPassword: "WrongPass123!",
      newPassword: "NewPass123!",
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    await expect(caller.auth.changePassword({
      oldPassword: "CurrentPass123!",
      newPassword: "CurrentPass123!",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await caller.auth.changePassword({
      oldPassword: "CurrentPass123!",
      newPassword: "NewPass123!",
    });
    expect(db.setAdminUserPassword).toHaveBeenCalledTimes(1);
    const storedHash = vi.mocked(db.setAdminUserPassword).mock.calls[0][1];
    expect(await verifyPassword("NewPass123!", storedHash)).toBe(true);
  });
});

describe("后台个人信息界面契约", () => {
  const root = path.resolve(__dirname, "..");
  const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");
  const profilePage = read("client/src/pages/Profile.tsx");
  const app = read("client/src/App.tsx");
  const dashboard = read("client/src/components/DashboardLayout.tsx");
  const permissions = read("shared/adminPermissions.ts");

  it("系统菜单和路由向两类后台账号提供个人信息页面", () => {
    expect(dashboard).toContain('label: "个人信息", path: "/profile", permission: "profile.manage"');
    expect(app).toContain('<Route path={"/profile"} component={ProfileRoute} />');
    expect(permissions).toContain('"profile.manage"');
    expect(permissions).toContain('merchant_mgr: ["merchants.read", "merchants.write", "orders.read", "profile.manage"]');
  });

  it("页面支持名称、手机、邮箱和密码，并在保存后刷新后台用户管理数据", () => {
    for (const text of ["用户名称", "绑定手机号", "绑定邮箱", "当前密码", "新密码", "确认新密码"]) {
      expect(profilePage).toContain(text);
    }
    expect(profilePage).toContain("trpc.auth.updateProfile.useMutation");
    expect(profilePage).toContain("trpc.auth.changePassword.useMutation");
    expect(profilePage).toContain("utils.adminUser.list.invalidate()");
    expect(profilePage).toContain("utils.auth.me.invalidate()");
  });
});
