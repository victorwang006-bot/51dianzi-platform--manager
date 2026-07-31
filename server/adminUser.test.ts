import { afterAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
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

describe("后台用户管理", () => {
  const caller = appRouter.createCaller(createSuperAdminContext());
  const username = `vitest-admin-${Date.now()}`;
  let createdId: number | null = null;

  afterAll(async () => {
    if (createdId !== null) {
      const existing = await db.getAdminUserByUsername(username);
      if (existing) await caller.adminUser.remove({ id: createdId });
    }
  });

  it("超级管理员可新增、编辑并禁用后台用户", async () => {
    const created = await caller.adminUser.create({
      username,
      displayName: "待编辑管理员",
      email: `${username}@example.com`,
      phone: "13900001111",
      adminRole: "operation",
      password: "InitialPass123!",
    });
    createdId = created.id;

    let account = await db.getAdminUserByUsername(username);
    expect(account).toMatchObject({
      id: createdId,
      displayName: "待编辑管理员",
      adminRole: "operation",
      status: "active",
    });
    expect(account?.passwordHash).toBeTruthy();

    await caller.adminUser.update({
      id: createdId,
      displayName: "已编辑管理员",
      adminRole: "customer_svc",
    });
    account = await db.getAdminUserByUsername(username);
    expect(account).toMatchObject({
      displayName: "已编辑管理员",
      adminRole: "customer_svc",
    });

    await caller.adminUser.toggleStatus({ id: createdId, status: "disabled" });
    account = await db.getAdminUserByUsername(username);
    expect(account?.status).toBe("disabled");

    const list = await caller.adminUser.list({ page: 1, pageSize: 100 });
    expect(list.data.some(item => item.id === createdId)).toBe(true);

    await caller.adminUser.remove({ id: createdId });
    expect(await db.getAdminUserByUsername(username)).toBeNull();
    createdId = null;
  });
});
