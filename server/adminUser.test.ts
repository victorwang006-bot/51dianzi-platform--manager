import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getAdminUserByUsername: vi.fn(),
    createAdminUser: vi.fn(),
    updateAdminUser: vi.fn(),
    setAdminUserPassword: vi.fn(),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";

function createSuperAdminContext(): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 9100,
      openId: "local_admin:9100",
      name: "超级管理员测试账号",
      email: "super-admin@example.com",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    adminAccount: {
      id: 9100,
      userId: 9100,
      username: "super-admin-test",
      displayName: "超级管理员测试账号",
      email: "super-admin@example.com",
      phone: null,
      passwordHash: null,
      adminRole: "super_admin",
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

describe("后台双角色与销售权限用户管理", () => {
  const caller = appRouter.createCaller(createSuperAdminContext());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getAdminUserByUsername).mockResolvedValue(null);
    vi.mocked(db.createAdminUser).mockResolvedValue({ id: 9200 } as never);
    vi.mocked(db.updateAdminUser).mockResolvedValue(undefined);
    vi.mocked(db.setAdminUserPassword).mockResolvedValue(undefined);
  });

  it("普通用户不选择追加范围也可创建，数据库层自动生成并绑定本人销售身份", async () => {
    await caller.adminUser.create({
      username: "ordinary-self",
      displayName: "普通用户",
      adminRole: "merchant_mgr",
      salesStaffCodes: [],
      password: "InitialPass123!",
    });
    expect(db.createAdminUser).toHaveBeenCalledWith(expect.objectContaining({
      username: "ordinary-self",
      adminRole: "merchant_mgr",
      salesStaffCodes: [],
    }));
  });

  it("可追加一名或多名其他普通用户，形成扩展销售范围或主管范围", async () => {
    await caller.adminUser.create({
      username: "ordinary-victor",
      displayName: "Victor账号",
      adminRole: "merchant_mgr",
      salesStaffCodes: ["victor"],
      password: "InitialPass123!",
    });
    expect(db.createAdminUser).toHaveBeenLastCalledWith(expect.objectContaining({
      adminRole: "merchant_mgr",
      salesStaffCodes: ["victor"],
    }));

    await caller.adminUser.create({
      username: "manager-victor-ocean",
      displayName: "销售主管",
      adminRole: "merchant_mgr",
      salesStaffCodes: ["victor", "ocean"],
      password: "InitialPass123!",
    });
    expect(db.createAdminUser).toHaveBeenLastCalledWith(expect.objectContaining({
      salesStaffCodes: ["victor", "ocean"],
    }));
  });

  it("超级管理员不需要销售权限并拥有全部范围", async () => {
    await caller.adminUser.create({
      username: "another-super",
      displayName: "第二超级管理员",
      adminRole: "super_admin",
      salesStaffCodes: [],
      password: "InitialPass123!",
    });
    expect(db.createAdminUser).toHaveBeenCalledWith(expect.objectContaining({
      adminRole: "super_admin",
      salesStaffCodes: [],
    }));
  });

  it("禁止当前登录超级管理员把自己降级或停用", async () => {
    await expect(caller.adminUser.update({
      id: 9100,
      adminRole: "merchant_mgr",
      salesStaffCodes: ["victor"],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.adminUser.update({ id: 9100, status: "disabled" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.updateAdminUser).not.toHaveBeenCalled();
  });
});
