import { describe, expect, it, beforeAll } from "vitest";
import type { Request, Response } from "express";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { hashPassword, maskEmail, maskPhone } from "./adminAuth";
import * as db from "./db";

/** 构造最小可用的 tRPC 调用上下文 */
function createCtx(): { ctx: TrpcContext; cookies: Record<string, unknown> } {
  const cookies: Record<string, unknown> = {};
  const req = {
    headers: { cookie: "" },
    protocol: "https",
    hostname: "test.local",
  } as unknown as Request;
  const res = {
    cookie: (name: string, value: string, options: unknown) => {
      cookies[name] = { value, options };
    },
    clearCookie: (name: string) => {
      delete cookies[name];
    },
  } as unknown as Response;
  return {
    ctx: { req, res, user: null, adminAccount: null },
    cookies,
  };
}

const TEST_USERNAME = "vitest_login_user";
const TEST_PASSWORD = "Vitest@12345678";

beforeAll(async () => {
  // 幂等准备测试账号
  const existing = await db.getAdminUserByUsername(TEST_USERNAME);
  if (!existing) {
    await db.createAdminUser({
      username: TEST_USERNAME,
      displayName: "登录测试账号",
      adminRole: "operation",
      passwordHash: await hashPassword(TEST_PASSWORD),
    });
  } else {
    await db.setAdminUserPassword(existing.id, await hashPassword(TEST_PASSWORD));
    await db.updateAdminUser(existing.id, { status: "active" });
  }
  // 绑定手机与邮箱用于找回密码测试
  const account = await db.getAdminUserByUsername(TEST_USERNAME);
  await db.updateAdminUser(account!.id, {
    phone: "13912345678",
    email: "vitest@51dianzi.com",
  });
});

describe("账号密码登录", () => {
  it("正确的用户名密码可登录并写入会话 cookie", async () => {
    const { ctx, cookies } = createCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.login({
      username: TEST_USERNAME,
      password: TEST_PASSWORD,
    });
    expect(result.success).toBe(true);
    expect(result.account.username).toBe(TEST_USERNAME);
    // 不应泄露密码哈希
    expect((result.account as Record<string, unknown>).passwordHash).toBeUndefined();
    expect(cookies["app_session_id"]).toBeDefined();
  });

  it("密码错误返回统一错误信息", async () => {
    const { ctx } = createCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.auth.login({ username: TEST_USERNAME, password: "WrongPass@999" })
    ).rejects.toThrow("用户名或密码错误");
  });

  it("不存在的用户返回统一错误信息", async () => {
    const { ctx } = createCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.auth.login({ username: "no_such_user_xyz", password: "whatever123" })
    ).rejects.toThrow("用户名或密码错误");
  });

  it("停用账号无法登录", async () => {
    const account = await db.getAdminUserByUsername(TEST_USERNAME);
    expect(account).not.toBeNull();
    await db.updateAdminUser(account!.id, { status: "disabled" });
    try {
      const { ctx } = createCtx();
      const caller = appRouter.createCaller(ctx);
      await expect(
        caller.auth.login({ username: TEST_USERNAME, password: TEST_PASSWORD })
      ).rejects.toThrow("账号已被停用");
    } finally {
      await db.updateAdminUser(account!.id, { status: "active" });
    }
  });

  it("登录后修改密码：原密码错误被拒绝，正确则生效", async () => {
    const account = await db.getAdminUserByUsername(TEST_USERNAME);
    expect(account).not.toBeNull();
    const { ctx } = createCtx();
    // 模拟账号密码登录会话上下文
    ctx.adminAccount = account!;
    ctx.user = {
      id: account!.id,
      openId: `local_admin:${account!.id}`,
      name: account!.displayName || account!.username,
      email: account!.email,
      loginMethod: "password",
      role: "admin",
      createdAt: account!.createdAt,
      updatedAt: account!.updatedAt,
      lastSignedIn: account!.createdAt,
    };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.auth.changePassword({ oldPassword: "WrongOld@123", newPassword: "NewPass@12345" })
    ).rejects.toThrow("原密码错误");

    const ok = await caller.auth.changePassword({
      oldPassword: TEST_PASSWORD,
      newPassword: "NewPass@12345",
    });
    expect(ok.success).toBe(true);

    // 新密码可登录
    const { ctx: ctx2 } = createCtx();
    const caller2 = appRouter.createCaller(ctx2);
    const result = await caller2.auth.login({
      username: TEST_USERNAME,
      password: "NewPass@12345",
    });
    expect(result.success).toBe(true);

    // 恢复原密码，保持测试幂等
    await db.setAdminUserPassword(account!.id, await hashPassword(TEST_PASSWORD));
  });
});

describe("找回密码（手机/邮箱验证码）", () => {
  /** 作废账号所有未使用验证码，保证测试可重复运行（绕过 60 秒重发限制） */
  async function clearActiveResetCodes(adminUserId: number) {
    const dbConn = await db.getDb();
    const { passwordResetCodes } = await import("../drizzle/schema");
    const { eq, isNull, and } = await import("drizzle-orm");
    await dbConn!
      .update(passwordResetCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetCodes.adminUserId, adminUserId), isNull(passwordResetCodes.usedAt)));
  }

  it("脱敏函数正确处理手机号与邮箱", () => {
    expect(maskPhone("13912345678")).toBe("139****5678");
    expect(maskEmail("vitest@51dianzi.com")).toBe("vi***@51dianzi.com");
  });

  it("resetChannels 返回脱敏渠道；不存在账号返回空数组", async () => {
    const { ctx } = createCtx();
    const caller = appRouter.createCaller(ctx);
    const channels = await caller.auth.resetChannels({ username: TEST_USERNAME });
    expect(channels.map(c => c.channel).sort()).toEqual(["email", "sms"]);
    expect(channels.find(c => c.channel === "sms")?.maskedTarget).toBe("139****5678");
    const empty = await caller.auth.resetChannels({ username: "no_such_user_xyz" });
    expect(empty).toEqual([]);
  });

  it("完整找回流程：发送验证码→用正确验证码重置密码→新密码可登录", async () => {
    const account = await db.getAdminUserByUsername(TEST_USERNAME);
    await clearActiveResetCodes(account!.id);
    const { ctx } = createCtx();
    const caller = appRouter.createCaller(ctx);

    const sent = await caller.auth.requestReset({ username: TEST_USERNAME, channel: "sms" });
    expect(sent.success).toBe(true);

    // 测试环境直接从数据库替换验证码哈希以获得已知验证码
    const record = await db.getActivePasswordResetCode(account!.id);
    expect(record).not.toBeNull();

    // 错误验证码被拒绝并累计失败次数
    await expect(
      caller.auth.resetPassword({ username: TEST_USERNAME, code: "000000", newPassword: "ResetPass@123" })
    ).rejects.toThrow("验证码错误或已失效");

    // 模拟已知验证码（重新写入哈希）
    const KNOWN_CODE = "654321";
    const dbConn = await db.getDb();
    expect(dbConn).not.toBeNull();
    const { passwordResetCodes } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await dbConn!
      .update(passwordResetCodes)
      .set({ codeHash: await hashPassword(KNOWN_CODE) })
      .where(eq(passwordResetCodes.id, record!.id));

    const result = await caller.auth.resetPassword({
      username: TEST_USERNAME,
      code: KNOWN_CODE,
      newPassword: "ResetPass@123",
    });
    expect(result.success).toBe(true);

    // 新密码可登录
    const { ctx: loginCtx } = createCtx();
    const loginCaller = appRouter.createCaller(loginCtx);
    const login = await loginCaller.auth.login({ username: TEST_USERNAME, password: "ResetPass@123" });
    expect(login.success).toBe(true);

    // 验证码一次性：同一验证码不能重复使用
    await expect(
      caller.auth.resetPassword({ username: TEST_USERNAME, code: KNOWN_CODE, newPassword: "Another@123" })
    ).rejects.toThrow("验证码错误或已失效");

    // 恢复原密码保持幂等
    await db.setAdminUserPassword(account!.id, await hashPassword(TEST_PASSWORD));
  });

  it("发送频率限制：60 秒内重复发送被拒绝", async () => {
    const account = await db.getAdminUserByUsername(TEST_USERNAME);
    await clearActiveResetCodes(account!.id);
    const { ctx } = createCtx();
    const caller = appRouter.createCaller(ctx);
    await caller.auth.requestReset({ username: TEST_USERNAME, channel: "email" });
    await expect(
      caller.auth.requestReset({ username: TEST_USERNAME, channel: "email" })
    ).rejects.toThrow("发送过于频繁");
  });
});
