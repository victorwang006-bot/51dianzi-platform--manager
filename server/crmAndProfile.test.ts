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

const TEST_PREFIX = "【测试】R31";
const TEST_CREDIT_CODE = "91TEST31R000000001";

async function cleanup() {
  const conn = await db.getDb();
  if (!conn) return;
  const rows = await conn.select().from(messageThreads)
    .where(like(messageThreads.subject, `${TEST_PREFIX}%`));
  for (const t of rows) {
    await conn.delete(messages).where(eq(messages.threadId, t.id));
    await conn.delete(messageThreads).where(eq(messageThreads.id, t.id));
  }
  await conn.delete(merchants).where(eq(merchants.businessLicense, TEST_CREDIT_CODE));
}

describe("会话类型与公司资料展示（第三十一轮）", () => {
  beforeAll(async () => {
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
  });

  it("快速询价会话：threadType 与 companyProfile 全链路（提交 → 列表筛选 → 详情展示）", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const admin = appRouter.createCaller(adminCtx());

    const submitted = await portal.submitMessage({
      subject: `${TEST_PREFIX}-快速询价 - STM32F103C8T6`,
      contactName: "王先生",
      contactPhone: "15817256366",
      contactEmail: "wang@example.com",
      threadType: "inquiry",
      companyProfile: {
        companyName: "测试电子有限公司",
        creditCode: TEST_CREDIT_CODE,
        companyType: "有限责任公司",
        legalPerson: "王先生",
        companyRole: "采购商",
        regAddress: "深圳市南山区科技园",
        certLevel: "已认证",
      },
      content: "【快速询价】\n料号：STM32F103C8T6\n品牌：ST\n数量：10000",
    });
    expect(submitted.threadNo).toBeTruthy();

    // 列表按类型筛选能查到
    const list = await admin.message.threads({
      page: 1, pageSize: 50, threadType: "inquiry", keyword: `${TEST_PREFIX}-快速询价`,
    });
    const item = list.items.find(t => t.threadNo === submitted.threadNo);
    expect(item).toBeTruthy();
    expect(item!.threadType).toBe("inquiry");

    // 详情返回联系方式与公司资料快照
    const detail = await admin.message.detail({ threadId: item!.id });
    expect(detail).toBeTruthy();
    expect(detail!.thread.contactName).toBe("王先生");
    expect(detail!.thread.contactPhone).toBe("15817256366");
    const profile = detail!.thread.companyProfile as Record<string, string> | null;
    expect(profile).toBeTruthy();
    expect(profile!.companyName).toBe("测试电子有限公司");
    expect(profile!.creditCode).toBe(TEST_CREDIT_CODE);
  });

  it("在线客服会话：threadType=service，无公司资料时 companyProfile 为空", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const admin = appRouter.createCaller(adminCtx());

    const submitted = await portal.submitMessage({
      subject: `${TEST_PREFIX}-在线客服咨询 - 李女士`,
      contactName: "李女士",
      contactPhone: "13800138000",
      threadType: "service",
      content: "你好，想咨询发货问题",
    });

    const list = await admin.message.threads({
      page: 1, pageSize: 50, threadType: "service", keyword: `${TEST_PREFIX}-在线客服`,
    });
    const item = list.items.find(t => t.threadNo === submitted.threadNo);
    expect(item).toBeTruthy();
    expect(item!.threadType).toBe("service");

    const detail = await admin.message.detail({ threadId: item!.id });
    expect(detail!.thread.companyProfile ?? null).toBeNull();
  });

  it("未指定 threadType 时默认 general（兼容存量前台调用）", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const admin = appRouter.createCaller(adminCtx());

    const submitted = await portal.submitMessage({
      subject: `${TEST_PREFIX}-普通留言`,
      content: "普通留言内容",
    });
    const list = await admin.message.threads({ page: 1, pageSize: 50, keyword: `${TEST_PREFIX}-普通留言` });
    const item = list.items.find(t => t.threadNo === submitted.threadNo);
    expect(item).toBeTruthy();
    expect(item!.threadType).toBe("general");
  });
});

describe("企业开通 CRM 申请落商户管理（第三十一轮）", () => {
  it("完整链路：前台申请 → 商户管理待开通 → 管理员开通 → 重复申请不降级", async () => {
    const portal = appRouter.createCaller(portalCtx()).portal;
    const admin = appRouter.createCaller(adminCtx());

    // 1. 前台提交企业开通申请 → 创建商户（crmStatus=pending）
    const applied = await portal.submitCrmApplication({
      companyName: "测试电子有限公司",
      creditCode: TEST_CREDIT_CODE,
      portalUserId: "crm-profile-test-user",
      contactName: "王先生",
      contactPhone: "15817256366",
      legalPersonName: "王先生",
      registeredAddress: "深圳市南山区科技园",
      note: "希望开通 CRM 管理客户",
    });
    expect(applied.created).toBe(true);
    expect(applied.crmStatus).toBe("pending");
    expect(applied.merchantNo).toMatch(/^M\d+/);

    // 2. 商户列表能查到该商户且 crmStatus=pending
    const list = await admin.merchant.list({ page: 1, pageSize: 50, search: "测试电子有限公司" });
    const merchant = list.data.find(m => m.businessLicense === TEST_CREDIT_CODE);
    expect(merchant).toBeTruthy();
    expect(merchant!.crmStatus).toBe("pending");

    // 3. 管理员开通 CRM
    const enabled = await admin.merchant.setCrmStatus({
      id: merchant!.id,
      crmStatus: "enabled",
      portalUserId: "crm-profile-test-user",
      note: "资料齐全，同意开通",
    });
    expect(enabled.success).toBe(true);

    const after = await admin.merchant.detail({ id: merchant!.id });
    expect(after!.crmStatus).toBe("enabled");
    expect(after!.crmEnabledAt).toBeTruthy();

    // 4. 重复申请（幂等）：已开通状态不被降级回 pending
    const reapplied = await portal.submitCrmApplication({
      companyName: "测试电子有限公司",
      creditCode: TEST_CREDIT_CODE,
      portalUserId: "crm-profile-test-user",
      contactPhone: "15817256366",
    });
    expect(reapplied.created).toBe(false);
    expect(reapplied.crmStatus).toBe("enabled");

    // 5. 管理员停用 CRM
    await admin.merchant.setCrmStatus({ id: merchant!.id, crmStatus: "disabled", note: "违规停用" });
    const disabled = await admin.merchant.detail({ id: merchant!.id });
    expect(disabled!.crmStatus).toBe("disabled");
  });

  it("无 portal key 提交 CRM 申请应被拒绝", async () => {
    const noKey = appRouter.createCaller(portalCtx(false)).portal;
    await expect(noKey.submitCrmApplication({
      companyName: "测试公司",
      creditCode: "91XXXXXXXXXXXXXXXX",
    })).rejects.toMatchObject({ name: "TRPCError" });
  });
});
