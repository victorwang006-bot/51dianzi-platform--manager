import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getCrmBindingByCreditCode: vi.fn(),
    getCrmOwnerRebindLog: vi.fn(),
    rebindMerchantCrmOwner: vi.fn(),
    completeCrmOwnerRebindPlatformSync: vi.fn(),
    markCrmOwnerRebindPlatformSyncRetryable: vi.fn(),
  };
});

vi.mock("./platformCrmApi", () => ({
  validatePlatformCrmRebindTarget: vi.fn(),
  completePlatformCrmRebind: vi.fn(),
}));

import * as db from "./db";
import * as platformCrmApi from "./platformCrmApi";
import { appRouter } from "./routers";

const PORTAL_KEY = "portal-enterprise-owner-rebind-test-key";
const creditCode = "91440300MA5F7X2K9T";
const requestId = "portal-rebind-30004-001";

function portalCtx(portalKey = PORTAL_KEY): TrpcContext {
  return {
    user: null,
    adminAccount: null,
    req: {
      protocol: "https",
      ip: "198.51.100.9",
      headers: {
        ...(portalKey ? { "x-portal-key": portalKey } : {}),
        "x-forwarded-for": "203.0.113.9, 10.0.0.3",
        "user-agent": "portal-owner-rebind-test",
      },
    } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const binding = {
  found: true as const,
  merchantId: 30004,
  merchantNo: "M30004",
  companyName: "测试企业",
  creditCode,
  crmStatus: "enabled",
  crmOwnerPortalUserId: "390005",
};

const ledger = {
  id: 1,
  requestId,
  merchantId: 30004,
  expectedOwnerPortalUserId: "390005",
  nextOwnerPortalUserId: "396297",
  creditCode,
  reason: "原企业所有者离职，完成企业成员核验",
  platformSyncStatus: "pending" as const,
};

function input(overrides: Partial<{
  creditCode: string;
  expectedPortalUserId: string;
  newPortalUserId: string;
  reason: string;
  requestId: string;
  actorName: string;
}> = {}) {
  return {
    creditCode,
    expectedPortalUserId: "390005",
    newPortalUserId: "396297",
    reason: "原企业所有者离职，完成企业成员核验",
    requestId,
    ...overrides,
  };
}

describe("portal.rebindCrmOwnerByEnterpriseOwner", () => {
  const getCrmBindingByCreditCode = vi.mocked(db.getCrmBindingByCreditCode);
  const getCrmOwnerRebindLog = vi.mocked(db.getCrmOwnerRebindLog);
  const rebindMerchantCrmOwner = vi.mocked(db.rebindMerchantCrmOwner);
  const completeCrmOwnerRebindPlatformSync = vi.mocked(db.completeCrmOwnerRebindPlatformSync);
  const markCrmOwnerRebindPlatformSyncRetryable = vi.mocked(db.markCrmOwnerRebindPlatformSyncRetryable);
  const validatePlatformCrmRebindTarget = vi.mocked(platformCrmApi.validatePlatformCrmRebindTarget);
  const completePlatformCrmRebind = vi.mocked(platformCrmApi.completePlatformCrmRebind);

  beforeEach(() => {
    process.env.PORTAL_API_KEY = PORTAL_KEY;
    vi.resetAllMocks();
    getCrmBindingByCreditCode.mockResolvedValue(binding as Awaited<ReturnType<typeof db.getCrmBindingByCreditCode>>);
    getCrmOwnerRebindLog.mockResolvedValue(null);
    validatePlatformCrmRebindTarget.mockResolvedValue({
      valid: true,
      enterpriseId: 51,
      creditCode,
      expectedSuperAdminUserId: 390005,
      targetUserId: 396297,
    });
    rebindMerchantCrmOwner.mockResolvedValue({
      success: true,
      idempotent: false,
      requestId,
      merchantId: 30004,
      crmStatus: "enabled",
      previousPortalUserId: "390005",
      crmOwnerPortalUserId: "396297",
      platformSyncStatus: "pending",
    });
    completeCrmOwnerRebindPlatformSync.mockResolvedValue({
      ...ledger,
      platformSyncStatus: "completed",
    } as never);
    markCrmOwnerRebindPlatformSyncRetryable.mockResolvedValue({
      ...ledger,
      platformSyncStatus: "retryable",
    } as never);
    completePlatformCrmRebind.mockResolvedValue({
      success: true,
      idempotent: false,
      enterpriseId: 51,
      superAdminUserId: 396297,
    });
  });

  it("拒绝缺失或错误的 portal key，且不触碰绑定数据", async () => {
    await expect(appRouter.createCaller(portalCtx("")).portal.rebindCrmOwnerByEnterpriseOwner(input()))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(appRouter.createCaller(portalCtx("wrong-key")).portal.rebindCrmOwnerByEnterpriseOwner(input()))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(getCrmOwnerRebindLog).not.toHaveBeenCalled();
    expect(getCrmBindingByCreditCode).not.toHaveBeenCalled();
  });

  it("新请求先按信用代码核验当前 owner 与目标成员，再 CAS 落账并单向确认平台", async () => {
    getCrmOwnerRebindLog
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ledger as Awaited<ReturnType<typeof db.getCrmOwnerRebindLog>>);

    const result = await appRouter.createCaller(portalCtx()).portal.rebindCrmOwnerByEnterpriseOwner(input({
      creditCode: creditCode.toLowerCase(),
      actorName: "王企业所有者",
    }));

    expect(getCrmBindingByCreditCode).toHaveBeenCalledWith(creditCode);
    expect(validatePlatformCrmRebindTarget).toHaveBeenCalledWith({
      creditCode,
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
    });
    expect(rebindMerchantCrmOwner).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 30004,
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
      reason: "原企业所有者离职，完成企业成员核验",
      requestId,
      actor: {
        operatorId: 390005,
        operatorName: "王企业所有者",
        operatorRole: "enterprise_owner",
        ipAddress: "203.0.113.9",
        userAgent: "portal-owner-rebind-test",
      },
    }));
    expect(validatePlatformCrmRebindTarget.mock.invocationCallOrder[0])
      .toBeLessThan(rebindMerchantCrmOwner.mock.invocationCallOrder[0]);
    expect(rebindMerchantCrmOwner.mock.invocationCallOrder[0])
      .toBeLessThan(completePlatformCrmRebind.mock.invocationCallOrder[0]);
    expect(completePlatformCrmRebind).toHaveBeenCalledWith({
      creditCode,
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
      reason: "原企业所有者离职，完成企业成员核验",
      requestId,
    });
    expect(completeCrmOwnerRebindPlatformSync).toHaveBeenCalledWith(requestId);
    expect(result).toMatchObject({ success: true, crmOwnerPortalUserId: "396297", platformEnterpriseId: 51 });
  });

  it("当前 owner 与 expected 不一致时拒绝，不能伪造 expected owner 绕过当前绑定", async () => {
    getCrmBindingByCreditCode.mockResolvedValue({
      ...binding,
      crmOwnerPortalUserId: "other-enterprise-owner",
    } as Awaited<ReturnType<typeof db.getCrmBindingByCreditCode>>);

    await expect(appRouter.createCaller(portalCtx()).portal.rebindCrmOwnerByEnterpriseOwner(input()))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(validatePlatformCrmRebindTarget).not.toHaveBeenCalled();
    expect(rebindMerchantCrmOwner).not.toHaveBeenCalled();
    expect(completePlatformCrmRebind).not.toHaveBeenCalled();
  });

  it("平台确认失败时只在本地已落账后标记同一请求为 retryable，绝不报告成功", async () => {
    getCrmOwnerRebindLog
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ledger as Awaited<ReturnType<typeof db.getCrmOwnerRebindLog>>);
    completePlatformCrmRebind.mockRejectedValue(new Error("前台暂不可用"));

    await expect(appRouter.createCaller(portalCtx()).portal.rebindCrmOwnerByEnterpriseOwner(input()))
      .rejects.toThrow("已标记为可重试");
    expect(rebindMerchantCrmOwner).toHaveBeenCalledTimes(1);
    expect(markCrmOwnerRebindPlatformSyncRetryable).toHaveBeenCalledWith(requestId, expect.any(Error));
    expect(completeCrmOwnerRebindPlatformSync).not.toHaveBeenCalled();
  });

  it("同一未完成 requestId 跳过当前绑定和成员预检，只重放平台确认", async () => {
    getCrmOwnerRebindLog.mockResolvedValue({
      ...ledger,
      platformSyncStatus: "retryable",
    } as Awaited<ReturnType<typeof db.getCrmOwnerRebindLog>>);

    const result = await appRouter.createCaller(portalCtx()).portal.rebindCrmOwnerByEnterpriseOwner(input());

    expect(getCrmBindingByCreditCode).not.toHaveBeenCalled();
    expect(validatePlatformCrmRebindTarget).not.toHaveBeenCalled();
    expect(rebindMerchantCrmOwner).not.toHaveBeenCalled();
    expect(completePlatformCrmRebind).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, idempotent: true, requestId, platformEnterpriseId: 51 });
  });

  it("同一已完成 requestId 幂等返回，且不再次调用平台", async () => {
    getCrmOwnerRebindLog.mockResolvedValue({
      ...ledger,
      platformSyncStatus: "completed",
    } as Awaited<ReturnType<typeof db.getCrmOwnerRebindLog>>);

    await expect(appRouter.createCaller(portalCtx()).portal.rebindCrmOwnerByEnterpriseOwner(input()))
      .resolves.toEqual({ success: true, idempotent: true, requestId });
    expect(getCrmBindingByCreditCode).not.toHaveBeenCalled();
    expect(validatePlatformCrmRebindTarget).not.toHaveBeenCalled();
    expect(rebindMerchantCrmOwner).not.toHaveBeenCalled();
    expect(completePlatformCrmRebind).not.toHaveBeenCalled();
  });
});
