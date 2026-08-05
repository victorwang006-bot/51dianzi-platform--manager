import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { eq, like } from "drizzle-orm";
import { merchants, messages, messageThreads } from "../drizzle/schema";

if (!process.env.PORTAL_API_KEY) {
  process.env.PORTAL_API_KEY = "test-portal-key-local";
}
const PORTAL_KEY = process.env.PORTAL_API_KEY;

function portalCtx(withKey = true): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: withKey ? { "x-portal-key": PORTAL_KEY } : {},
    } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function adminCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin:1",
      email: null,
      name: "平台超管",
      loginMethod: "password",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as NonNullable<TrpcContext["user"]>,
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const TEST_CREDIT_CODE = "91TEST33R000000001";
const TEST_COMPANY = "【测试】R33CRM操作电子有限公司";
const TEST_PORTAL_USER_ID = "crm-actions-test-user";

async function cleanup() {
  const conn = await db.getDb();
  if (!conn) return;
  const rows = await conn.select().from(merchants)
    .where(eq(merchants.businessLicense, TEST_CREDIT_CODE));
  for (const m of rows) {
    if (m.crmThreadNo) {
      const tr = await conn.select().from(messageThreads)
        .where(eq(messageThreads.threadNo, m.crmThreadNo));
      for (const t of tr) {
        await conn.delete(messages).where(eq(messages.threadId, t.id));
        await conn.delete(messageThreads).where(eq(messageThreads.id, t.id));
      }
    }
  }
  const orphan = await conn.select().from(messageThreads)
    .where(like(messageThreads.subject, `平台通知 - ${TEST_COMPANY}%`));
  for (const t of orphan) {
    await conn.delete(messages).where(eq(messages.threadId, t.id));
    await conn.delete(messageThreads).where(eq(messageThreads.id, t.id));
  }
  await conn.delete(merchants).where(eq(merchants.businessLicense, TEST_CREDIT_CODE));
}

describe("商户 CRM 操作重构（第三十三轮）", () => {
  beforeAll(async () => { await cleanup(); });
  afterAll(async () => { await cleanup(); });

  it("提交 CRM 申请 → getCrmAccess 返回 pending 审核中提示", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const submitted = await portal.submitCrmApplication({
      companyName: TEST_COMPANY,
      creditCode: TEST_CREDIT_CODE,
      portalUserId: TEST_PORTAL_USER_ID,
      contactName: "测试联系人",
      contactPhone: "13800001111",
    });
    expect(submitted.crmStatus).toBe("pending");

    const access = await portal.getCrmAccess({
      creditCode: TEST_CREDIT_CODE,
      portalUserId: TEST_PORTAL_USER_ID,
    });
    expect(access.allowed).toBe(false);
    expect(access.crmStatus).toBe("pending");
    expect(access.message).toContain("审核中");
  });

  it("后台「发信」→ 创建 service 会话、前台未读 +1（红点）、复用同一会话", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const admin = appRouter.createCaller(adminCtx());
    const conn = await db.getDb();
    const m = (await conn!.select().from(merchants)
      .where(eq(merchants.businessLicense, TEST_CREDIT_CODE)))[0];
    expect(m).toBeTruthy();

    const first = await admin.merchant.sendMessage({ id: m.id, content: "请补充营业执照扫描件" });
    expect(first.threadNo).toBeTruthy();

    // 前台红点：未读数 =1
    const unread1 = await portal.getUnread({ threadNo: first.threadNo });
    expect(unread1.unreadCount).toBe(1);

    // 再次发信复用同一会话，未读累加
    const second = await admin.merchant.sendMessage({ id: m.id, content: "另需补充法人身份证明" });
    expect(second.threadNo).toBe(first.threadNo);
    const unread2 = await portal.getUnread({ threadNo: first.threadNo });
    expect(unread2.unreadCount).toBe(2);

    // getCrmAccess 返回 crmThreadNo 供前台轮询
    const access = await portal.getCrmAccess({
      creditCode: TEST_CREDIT_CODE,
      portalUserId: TEST_PORTAL_USER_ID,
    });
    expect(access.crmThreadNo).toBe(first.threadNo);

    // 前台拉取消息后未读清零
    const msgs = await portal.getMessages({ threadNo: first.threadNo });
    expect(msgs.messages.length).toBe(2);
    const unread3 = await portal.getUnread({ threadNo: first.threadNo });
    expect(unread3.unreadCount).toBe(0);
  });

  it("后台「拒绝」→ getCrmAccess 返回 rejected 提示", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const portal = appRouter.createCaller(portalCtx()).portal;
    const conn = await db.getDb();
    const m = (await conn!.select().from(merchants)
      .where(eq(merchants.businessLicense, TEST_CREDIT_CODE)))[0];
    await admin.merchant.setCrmStatus({ id: m.id, crmStatus: "rejected", note: "材料不齐" });
    const access = await portal.getCrmAccess({
      creditCode: TEST_CREDIT_CODE,
      portalUserId: TEST_PORTAL_USER_ID,
    });
    expect(access.allowed).toBe(false);
    expect(access.crmStatus).toBe("rejected");
    expect(access.message).toContain("未通过");
  });

  it("后台「通过」→ getCrmAccess allowed=true；「暂停」→ 返回暂停提示文案", async () => {
    const admin = appRouter.createCaller(adminCtx());
    const portal = appRouter.createCaller(portalCtx()).portal;
    const conn = await db.getDb();
    const m = (await conn!.select().from(merchants)
      .where(eq(merchants.businessLicense, TEST_CREDIT_CODE)))[0];

    await admin.merchant.setCrmStatus({
      id: m.id,
      crmStatus: "enabled",
      portalUserId: TEST_PORTAL_USER_ID,
    });
    const enabled = await portal.getCrmAccess({
      creditCode: TEST_CREDIT_CODE,
      portalUserId: TEST_PORTAL_USER_ID,
    });
    expect(enabled.allowed).toBe(true);
    expect(enabled.message).toBeNull();

    await admin.merchant.setCrmStatus({ id: m.id, crmStatus: "disabled", note: "违规暂停" });
    const disabled = await portal.getCrmAccess({
      creditCode: TEST_CREDIT_CODE,
      portalUserId: TEST_PORTAL_USER_ID,
    });
    expect(disabled.allowed).toBe(false);
    expect(disabled.crmStatus).toBe("disabled");
    expect(disabled.message).toBe("您的CRM权限已经被暂停，请联系客服");
  });

  it("未知信用代码 → 未开通提示；无 portal key → 拒绝访问", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const access = await portal.getCrmAccess({
      creditCode: "91UNKNOWN00000000X",
      portalUserId: TEST_PORTAL_USER_ID,
    });
    expect(access.allowed).toBe(false);
    expect(access.crmStatus).toBe("none");

    const noKey = appRouter.createCaller(portalCtx(false)).portal;
    await expect(noKey.getCrmAccess({
      creditCode: TEST_CREDIT_CODE,
      portalUserId: TEST_PORTAL_USER_ID,
    })).rejects.toThrow();
  });
});
