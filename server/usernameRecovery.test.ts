import { beforeAll, describe, expect, it } from "vitest";
import {
  hashPassword,
  recoverUsernameWithCode,
  requestUsernameRecovery,
} from "./adminAuth";
import * as db from "./db";

const TEST_USERNAME = "vitest_recover_user";
const TEST_PHONE = "13977778888";

let accountId: number;

beforeAll(async () => {
  // 准备测试账号（幂等）
  const existing = await db.getAdminUserByUsername(TEST_USERNAME);
  if (existing) {
    accountId = existing.id;
  } else {
    await db.createAdminUser({
      username: TEST_USERNAME,
      displayName: "找回用户名测试账号",
      role: "customer_service",
      phone: TEST_PHONE,
      email: "vitest_recover@51dianzi.com",
      status: "active",
      passwordHash: await hashPassword("Vitest@12345"),
    });
    const created = await db.getAdminUserByUsername(TEST_USERNAME);
    accountId = created!.id;
  }
  // 作废旧验证码，保证测试幂等（避免 60 秒频控）
  const active = await db.getActivePasswordResetCode(accountId);
  if (active) await db.markResetCodeUsed(active.id);
});

describe("找回用户名", () => {
  it("未绑定的手机号也返回统一响应（不暴露账号是否存在）", async () => {
    const res = await requestUsernameRecovery("sms", "19900001111");
    expect(res.success).toBe(true);
  });

  it("完整流程：发送验证码→正确验证码返回用户名", async () => {
    const res = await requestUsernameRecovery("sms", TEST_PHONE);
    expect(res.success).toBe(true);

    // 测试环境验证码不真实发送，从数据库记录中重建：直接注入已知验证码
    const record = await db.getActivePasswordResetCode(accountId);
    expect(record).toBeTruthy();
    // 用已知验证码替换 codeHash 以便校验
    await db.markResetCodeUsed(record!.id);
    await db.createPasswordResetCode({
      adminUserId: accountId,
      channel: "sms",
      target: TEST_PHONE,
      codeHash: await hashPassword("654321"),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const result = await recoverUsernameWithCode("sms", TEST_PHONE, "654321");
    expect(result.usernames.map(u => u.username)).toContain(TEST_USERNAME);
  });

  it("错误验证码被拒绝", async () => {
    await db.createPasswordResetCode({
      adminUserId: accountId,
      channel: "sms",
      target: TEST_PHONE,
      codeHash: await hashPassword("111222"),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    await expect(recoverUsernameWithCode("sms", TEST_PHONE, "999999")).rejects.toThrow(
      /验证码错误|已失效/
    );
    // 清理
    const rec = await db.getActivePasswordResetCode(accountId);
    if (rec) await db.markResetCodeUsed(rec.id);
  });
});
