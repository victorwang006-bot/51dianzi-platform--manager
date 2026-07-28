import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { eq, like } from "drizzle-orm";
import { messages, messageThreads } from "../drizzle/schema";

// 本地开发环境可能未配置 PORTAL_API_KEY（生产在 ECS ecosystem 中配置）。
// 测试中若未配置则临时注入一个，保证闭环测试可运行。
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

const TEST_PREFIX = "【测试】消息互通";

async function cleanupTestThreads() {
  const conn = await db.getDb();
  if (!conn) return;
  const rows = await conn.select().from(messageThreads)
    .where(like(messageThreads.subject, `${TEST_PREFIX}%`));
  for (const t of rows) {
    await conn.delete(messages).where(eq(messages.threadId, t.id));
    await conn.delete(messageThreads).where(eq(messageThreads.id, t.id));
  }
}

describe("消息互通（前台联系我们 ↔ 后台消息中心）", () => {
  beforeAll(async () => {
    await cleanupTestThreads();
  });

  it("无 portal key 提交留言应被拒绝", async () => {
    const caller = appRouter.createCaller(portalCtx(false));
    await expect(caller.portal.submitMessage({
      subject: `${TEST_PREFIX}-拒绝`,
      content: "should fail",
    })).rejects.toMatchObject({ name: "TRPCError" });
  });

  it("完整闭环：前台提交 → 后台列表/详情 → 后台回复 → 前台拉取回复", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const admin = appRouter.createCaller(adminCtx());

    // 1. 前台提交留言（新会话）
    const submitted = await portal.submitMessage({
      subject: `${TEST_PREFIX}-闭环`,
      contactName: "测试用户",
      contactPhone: "13900001111",
      contactEmail: "test@example.com",
      content: "你好，请问 STM32F103 有现货吗？",
    });
    expect(submitted.threadNo).toMatch(/^MT\d{8}\d{4}$/);

    // 2. 后台列表能看到该会话且未读数为 1
    const list = await admin.message.threads({ page: 1, pageSize: 50, keyword: `${TEST_PREFIX}-闭环` });
    const thread = list.items.find(t => t.threadNo === submitted.threadNo);
    expect(thread).toBeTruthy();
    expect(thread!.adminUnreadCount).toBe(1);

    // 3. 未读总数 >= 1
    const unread = await admin.message.unreadCount();
    expect(unread.total).toBeGreaterThanOrEqual(1);

    // 4. 后台打开详情（未读清零）
    const detail = await admin.message.detail({ threadId: thread!.id });
    expect(detail.messages).toHaveLength(1);
    expect(detail.messages[0]?.senderType).toBe("portal");
    const listAfter = await admin.message.threads({ page: 1, pageSize: 50, keyword: `${TEST_PREFIX}-闭环` });
    expect(listAfter.items.find(t => t.id === thread!.id)?.adminUnreadCount).toBe(0);

    // 5. 后台回复
    await admin.message.reply({ threadId: thread!.id, content: "您好，有现货，欢迎下单。" });

    // 6. 前台拉取到回复
    const portalView = await portal.getMessages({ threadNo: submitted.threadNo });
    expect(portalView.messages).toHaveLength(2);
    expect(portalView.messages[1]?.senderType).toBe("admin");
    expect(portalView.messages[1]?.content).toContain("有现货");

    // 7. 前台追加留言（同会话）
    await portal.submitMessage({
      threadNo: submitted.threadNo,
      content: "好的，价格能优惠吗？",
    });
    const detail2 = await admin.message.detail({ threadId: thread!.id });
    expect(detail2.messages).toHaveLength(3);

    // 8. 关闭会话
    await admin.message.setStatus({ threadId: thread!.id, status: "closed" });
    const closed = await admin.message.detail({ threadId: thread!.id });
    expect(closed.thread.status).toBe("closed");

    await cleanupTestThreads();
  });

  it("前台拉取不存在的会话应返回 NOT_FOUND", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    await expect(portal.getMessages({ threadNo: "MT00000000XXXX" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("前台未读角标：getUnread 不清零，getMessages 拉取后清零", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const admin = appRouter.createCaller(adminCtx());

    // 前台提交留言并由后台回复两条 → 前台未读数应为 2
    const submitted = await portal.submitMessage({
      subject: `${TEST_PREFIX}-角标`,
      contactName: "角标测试",
      content: "请问有 GD32 的替代料吗？",
    });
    const list = await admin.message.threads({ page: 1, pageSize: 50, keyword: `${TEST_PREFIX}-角标` });
    const thread = list.items.find(t => t.threadNo === submitted.threadNo)!;
    await admin.message.reply({ threadId: thread.id, content: "有的，GD32F103 系列可替代。" });
    await admin.message.reply({ threadId: thread.id, content: "需要的话我发规格书给您。" });

    // getUnread 查询未读数（不清零）
    const unread1 = await portal.getUnread({ threadNo: submitted.threadNo });
    expect(unread1.unreadCount).toBe(2);
    expect(unread1.status).toBe("open");

    // 再查一次仍为 2（确认不清零）
    const unread2 = await portal.getUnread({ threadNo: submitted.threadNo });
    expect(unread2.unreadCount).toBe(2);

    // getMessages 拉取后未读清零
    await portal.getMessages({ threadNo: submitted.threadNo });
    const unread3 = await portal.getUnread({ threadNo: submitted.threadNo });
    expect(unread3.unreadCount).toBe(0);

    await cleanupTestThreads();
  });

  it("getUnread：不存在会话返回 NOT_FOUND，无 key 被拒绝", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    await expect(portal.getUnread({ threadNo: "MT00000000XXXX" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    const noKey = appRouter.createCaller(portalCtx(false)).portal;
    await expect(noKey.getUnread({ threadNo: "MT00000000XXXX" }))
      .rejects.toMatchObject({ name: "TRPCError" });
  });
});
