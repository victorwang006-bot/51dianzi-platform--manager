import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  createPortalOnboardingLead: vi.fn(),
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return { ...actual, createPortalOnboardingLead: mocks.createPortalOnboardingLead };
});

import { appRouter } from "./routers";

const originalPortalKey = process.env.PORTAL_API_KEY;
const portalKey = "onboarding-router-test-key";
const input = {
  clientMessageId: "onboarding-42-testrequest",
  portalUserId: "42",
  crmPortalUserId: "84",
  contactName: "入驻测试用户",
  contactPhone: "13800138000",
  contactEmail: "test@example.com",
  companyProfile: { companyName: "深圳测试电子有限公司" },
  content: "希望开通ERP并上传物料",
};

function context(key?: string): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: key ? { "x-portal-key": key } : {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("portal.submitOnboardingLead", () => {
  beforeAll(() => {
    process.env.PORTAL_API_KEY = portalKey;
  });

  afterAll(() => {
    process.env.PORTAL_API_KEY = originalPortalKey;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPortalOnboardingLead.mockResolvedValue({
      status: "created",
      threadNo: "MT202609070001",
      threadId: 501,
      messageId: 601,
    });
  });

  it("能力探针只对持有内部密钥的主站返回原子开通消息协议", async () => {
    await expect(
      appRouter.createCaller(context()).portal.capabilities(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      appRouter.createCaller(context(portalKey)).portal.capabilities(),
    ).resolves.toEqual({
      onboardingMessages: {
        version: 1,
        threadType: "onboarding",
        authority: "admin_transaction",
      },
    });
  });

  it("缺少内部密钥时拒绝创建开通消息", async () => {
    await expect(
      appRouter.createCaller(context()).portal.submitOnboardingLead(input),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.createPortalOnboardingLead).not.toHaveBeenCalled();
  });

  it("正确内部密钥时把独立开通消息交给原子数据库函数", async () => {
    const result = await appRouter
      .createCaller(context(portalKey))
      .portal.submitOnboardingLead(input);

    expect(result.status).toBe("created");
    expect(mocks.createPortalOnboardingLead).toHaveBeenCalledWith(input);
  });

  it("幂等键为必填且只允许安全字符", async () => {
    const caller = appRouter.createCaller(context(portalKey));
    await expect(caller.portal.submitOnboardingLead({
      ...input,
      clientMessageId: "invalid:key",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.createPortalOnboardingLead).not.toHaveBeenCalled();
  });
});
