import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getMerchantById: vi.fn(),
    setMerchantCrmStatus: vi.fn(),
    rebindMerchantCrmOwner: vi.fn(),
    getCrmOwnerRebindLog: vi.fn(),
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

function adminCtx(adminRole = "super_admin"): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 1,
      openId: "admin:crm-grant-test",
      email: null,
      name: "平台超管",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    } as NonNullable<TrpcContext["user"]>,
    adminAccount: {
      id: 1,
      userId: 1,
      username: "crm-grant-test",
      displayName: "平台超管",
      email: null,
      phone: null,
      passwordHash: null,
      adminRole: adminRole as NonNullable<TrpcContext["adminAccount"]>["adminRole"],
      status: "active",
      mfaEnabled: false,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    },
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const requestId = "crm-rebind-30004-001";
const creditCode = "91440300MA5F7X2K9T";
const ledger = {
  id: 1,
  requestId,
  merchantId: 30004,
  expectedOwnerPortalUserId: "390005",
  nextOwnerPortalUserId: "396297",
  creditCode,
  reason: "原管理员离职，企业已核验",
  platformSyncStatus: "pending" as const,
};

function rebindInput(overrides: Partial<{
  id: number;
  expectedPortalUserId: string;
  newPortalUserId: string;
  reason: string;
  requestId: string;
}> = {}) {
  return {
    id: 30004,
    expectedPortalUserId: "390005",
    newPortalUserId: "396297",
    reason: "原管理员离职，企业已核验",
    requestId,
    ...overrides,
  };
}

describe("后台商户 CRM 开通与负责人换绑闭环", () => {
  const setMerchantCrmStatus = vi.mocked(db.setMerchantCrmStatus);
  const rebindMerchantCrmOwner = vi.mocked(db.rebindMerchantCrmOwner);
  const getMerchantById = vi.mocked(db.getMerchantById);
  const getCrmOwnerRebindLog = vi.mocked(db.getCrmOwnerRebindLog);
  const completeCrmOwnerRebindPlatformSync = vi.mocked(db.completeCrmOwnerRebindPlatformSync);
  const markCrmOwnerRebindPlatformSyncRetryable = vi.mocked(db.markCrmOwnerRebindPlatformSyncRetryable);
  const validatePlatformCrmRebindTarget = vi.mocked(platformCrmApi.validatePlatformCrmRebindTarget);
  const completePlatformCrmRebind = vi.mocked(platformCrmApi.completePlatformCrmRebind);

  beforeEach(() => {
    vi.resetAllMocks();
    getMerchantById.mockResolvedValue({
      id: 30004,
      businessLicense: creditCode,
    } as Awaited<ReturnType<typeof db.getMerchantById>>);
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

  it("规范化并转发管理员指定的前台用户 ID", async () => {
    setMerchantCrmStatus.mockResolvedValue({ success: true, crmOwnerPortalUserId: "390005" });
    const result = await appRouter.createCaller(adminCtx()).merchant.setCrmStatus({
      id: 30004,
      crmStatus: "enabled",
      portalUserId: " 390005 ",
      note: "企业授权已核验",
    });
    expect(result.crmOwnerPortalUserId).toBe("390005");
    expect(setMerchantCrmStatus).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 30004,
      crmStatus: "enabled",
      portalUserId: "390005",
      note: "企业授权已核验",
      actor: expect.objectContaining({ operatorId: 1, operatorRole: "super_admin" }),
    }));
  });

  it("拒绝空白前台用户 ID", async () => {
    await expect(appRouter.createCaller(adminCtx()).merchant.setCrmStatus({
      id: 30004,
      crmStatus: "enabled",
      portalUserId: "   ",
    })).rejects.toThrow("前台用户 ID 不能为空");
    expect(setMerchantCrmStatus).not.toHaveBeenCalled();
  });

  it("暂停操作不要求前台用户 ID", async () => {
    setMerchantCrmStatus.mockResolvedValue({ success: true, crmOwnerPortalUserId: "390005" });
    await appRouter.createCaller(adminCtx()).merchant.setCrmStatus({
      id: 30004,
      crmStatus: "disabled",
      note: "平台暂停",
    });
    expect(setMerchantCrmStatus).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 30004,
      crmStatus: "disabled",
      portalUserId: undefined,
      note: "平台暂停",
      actor: expect.objectContaining({ operatorId: 1, operatorRole: "super_admin" }),
    }));
  });

  it("商户不存在时向管理员返回明确错误", async () => {
    setMerchantCrmStatus.mockRejectedValue(new Error("商户不存在"));
    await expect(appRouter.createCaller(adminCtx()).merchant.setCrmStatus({
      id: 2_147_483_647,
      crmStatus: "enabled",
      portalUserId: "390005",
    })).rejects.toThrow("商户不存在");
  });

  it("新换绑先完成前台成员预检，再本地落账并请求平台原子确认", async () => {
    getCrmOwnerRebindLog
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ledger as Awaited<ReturnType<typeof db.getCrmOwnerRebindLog>>);
    const result = await appRouter.createCaller(adminCtx()).merchant.rebindCrmOwner(rebindInput({
      expectedPortalUserId: " 390005 ",
      newPortalUserId: " 396297 ",
      reason: " 原管理员离职，企业已核验 ",
    }));

    expect(validatePlatformCrmRebindTarget).toHaveBeenCalledWith({
      creditCode,
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
    });
    expect(rebindMerchantCrmOwner).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 30004,
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
      reason: "原管理员离职，企业已核验",
      requestId,
      actor: expect.objectContaining({ operatorId: 1, operatorRole: "super_admin" }),
    }));
    expect(validatePlatformCrmRebindTarget.mock.invocationCallOrder[0])
      .toBeLessThan(rebindMerchantCrmOwner.mock.invocationCallOrder[0]);
    expect(completePlatformCrmRebind).toHaveBeenCalledWith({
      creditCode,
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
      reason: "原管理员离职，企业已核验",
      requestId,
    });
    expect(completeCrmOwnerRebindPlatformSync).toHaveBeenCalledWith(requestId);
    expect(result).toMatchObject({
      success: true,
      crmOwnerPortalUserId: "396297",
      platformEnterpriseId: 51,
    });
  });

  it("前台预检拒绝目标时不写本地绑定", async () => {
    validatePlatformCrmRebindTarget.mockRejectedValue(
      new Error("新超级管理员必须先以有效独立账号加入当前企业"),
    );
    await expect(appRouter.createCaller(adminCtx()).merchant.rebindCrmOwner(rebindInput()))
      .rejects.toThrow("有效独立账号加入当前企业");
    expect(rebindMerchantCrmOwner).not.toHaveBeenCalled();
    expect(completePlatformCrmRebind).not.toHaveBeenCalled();
  });

  it("平台确认失败时不报告成功，并将同一 requestId 标记为 retryable", async () => {
    getCrmOwnerRebindLog
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(ledger as Awaited<ReturnType<typeof db.getCrmOwnerRebindLog>>);
    completePlatformCrmRebind.mockRejectedValue(new Error("前台暂不可用"));
    await expect(appRouter.createCaller(adminCtx()).merchant.rebindCrmOwner(rebindInput()))
      .rejects.toThrow("已标记为可重试");
    expect(markCrmOwnerRebindPlatformSyncRetryable).toHaveBeenCalledWith(requestId, expect.any(Error));
    expect(completeCrmOwnerRebindPlatformSync).not.toHaveBeenCalled();
  });

  it("已有同一 requestId 时跳过前置校验并重放平台确认", async () => {
    getCrmOwnerRebindLog.mockResolvedValue(ledger as Awaited<ReturnType<typeof db.getCrmOwnerRebindLog>>);
    await appRouter.createCaller(adminCtx()).merchant.rebindCrmOwner(rebindInput());
    expect(validatePlatformCrmRebindTarget).not.toHaveBeenCalled();
    expect(rebindMerchantCrmOwner).toHaveBeenCalledTimes(1);
    expect(completePlatformCrmRebind).toHaveBeenCalledTimes(1);
  });

  it("超级管理员可重试；已完成记录幂等返回且不再次调用平台", async () => {
    getCrmOwnerRebindLog.mockResolvedValueOnce({
      ...ledger,
      platformSyncStatus: "retryable",
    } as Awaited<ReturnType<typeof db.getCrmOwnerRebindLog>>);
    const retried = await appRouter.createCaller(adminCtx()).merchant.retryCrmOwnerRebind({ requestId });
    expect(retried).toMatchObject({ success: true, idempotent: false, platformEnterpriseId: 51 });
    expect(completePlatformCrmRebind).toHaveBeenCalledTimes(1);

    getCrmOwnerRebindLog.mockResolvedValueOnce({
      ...ledger,
      platformSyncStatus: "completed",
    } as Awaited<ReturnType<typeof db.getCrmOwnerRebindLog>>);
    const completed = await appRouter.createCaller(adminCtx()).merchant.retryCrmOwnerRebind({ requestId });
    expect(completed).toEqual({ success: true, idempotent: true, requestId });
    expect(completePlatformCrmRebind).toHaveBeenCalledTimes(1);
  });

  it("非超级管理员不可换绑或重试", async () => {
    const caller = appRouter.createCaller(adminCtx("operation"));
    await expect(caller.merchant.rebindCrmOwner(rebindInput())).rejects.toThrow("只有超级管理员");
    await expect(caller.merchant.retryCrmOwnerRebind({ requestId })).rejects.toThrow("只有超级管理员");
    expect(validatePlatformCrmRebindTarget).not.toHaveBeenCalled();
    expect(rebindMerchantCrmOwner).not.toHaveBeenCalled();
    expect(completePlatformCrmRebind).not.toHaveBeenCalled();
  });

  it("专用换绑拒绝空 expected owner、过短原因和无效请求号", async () => {
    await expect(appRouter.createCaller(adminCtx()).merchant.rebindCrmOwner(rebindInput({
      expectedPortalUserId: " ",
      reason: "x",
      requestId: "short",
    }))).rejects.toThrow();
    expect(rebindMerchantCrmOwner).not.toHaveBeenCalled();
  });
});
