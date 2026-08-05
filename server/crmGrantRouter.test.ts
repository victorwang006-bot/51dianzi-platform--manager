import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getMerchantById: vi.fn(),
    setMerchantCrmStatus: vi.fn(),
    rebindMerchantCrmOwner: vi.fn(),
  };
});

vi.mock("./platformCrmApi", () => ({
  validatePlatformCrmRebindTarget: vi.fn(),
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

describe("后台商户 CRM 开通路由", () => {
  const setMerchantCrmStatus = vi.mocked(db.setMerchantCrmStatus);
  const rebindMerchantCrmOwner = vi.mocked(db.rebindMerchantCrmOwner);
  const getMerchantById = vi.mocked(db.getMerchantById);
  const validatePlatformCrmRebindTarget = vi.mocked(platformCrmApi.validatePlatformCrmRebindTarget);

  beforeEach(() => {
    setMerchantCrmStatus.mockReset();
    rebindMerchantCrmOwner.mockReset();
    getMerchantById.mockReset();
    validatePlatformCrmRebindTarget.mockReset();
    getMerchantById.mockResolvedValue({
      id: 30004,
      businessLicense: "91440300MA5F7X2K9T",
    } as Awaited<ReturnType<typeof db.getMerchantById>>);
    validatePlatformCrmRebindTarget.mockResolvedValue({
      valid: true,
      enterpriseId: 51,
      creditCode: "91440300MA5F7X2K9T",
      expectedSuperAdminUserId: 390005,
      targetUserId: 396297,
    });
  });

  it("规范化并转发管理员指定的前台用户 ID", async () => {
    setMerchantCrmStatus.mockResolvedValue({
      success: true,
      crmOwnerPortalUserId: "390005",
    });
    const caller = appRouter.createCaller(adminCtx());

    const result = await caller.merchant.setCrmStatus({
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
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.merchant.setCrmStatus({
      id: 30004,
      crmStatus: "enabled",
      portalUserId: "   ",
    })).rejects.toThrow("前台用户 ID 不能为空");
    expect(setMerchantCrmStatus).not.toHaveBeenCalled();
  });

  it("暂停操作不要求前台用户 ID", async () => {
    setMerchantCrmStatus.mockResolvedValue({
      success: true,
      crmOwnerPortalUserId: "390005",
    });
    const caller = appRouter.createCaller(adminCtx());

    await caller.merchant.setCrmStatus({
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
    const caller = appRouter.createCaller(adminCtx());

    await expect(caller.merchant.setCrmStatus({
      id: 2_147_483_647,
      crmStatus: "enabled",
      portalUserId: "390005",
    })).rejects.toThrow("商户不存在");
  });

  it("超级管理员专用换绑完整透传 expected owner、原因和幂等请求号", async () => {
    rebindMerchantCrmOwner.mockResolvedValue({
      success: true,
      idempotent: false,
      requestId: "crm-rebind-30004-001",
      merchantId: 30004,
      previousPortalUserId: "390005",
      crmOwnerPortalUserId: "396297",
    });
    const caller = appRouter.createCaller(adminCtx());

    const result = await caller.merchant.rebindCrmOwner({
      id: 30004,
      expectedPortalUserId: " 390005 ",
      newPortalUserId: " 396297 ",
      reason: " 原管理员离职，企业已核验 ",
      requestId: "crm-rebind-30004-001",
    });

    expect(result.crmOwnerPortalUserId).toBe("396297");
    expect(validatePlatformCrmRebindTarget).toHaveBeenCalledWith({
      creditCode: "91440300MA5F7X2K9T",
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
    });
    expect(rebindMerchantCrmOwner).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 30004,
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
      reason: "原管理员离职，企业已核验",
      requestId: "crm-rebind-30004-001",
      actor: expect.objectContaining({ operatorId: 1, operatorRole: "super_admin" }),
    }));
  });

  it("非超级管理员不可调用专用换绑", async () => {
    const caller = appRouter.createCaller(adminCtx("operation"));
    await expect(caller.merchant.rebindCrmOwner({
      id: 30004,
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
      reason: "企业已核验",
      requestId: "crm-rebind-30004-002",
    })).rejects.toThrow("只有超级管理员");
    expect(validatePlatformCrmRebindTarget).not.toHaveBeenCalled();
    expect(rebindMerchantCrmOwner).not.toHaveBeenCalled();
  });

  it("前台判定目标不是同企业有效独立成员时禁止落库换绑", async () => {
    validatePlatformCrmRebindTarget.mockRejectedValue(
      new Error("新超级管理员必须先以有效独立账号加入当前企业"),
    );
    const caller = appRouter.createCaller(adminCtx());

    await expect(caller.merchant.rebindCrmOwner({
      id: 30004,
      expectedPortalUserId: "390005",
      newPortalUserId: "396297",
      reason: "企业已核验",
      requestId: "crm-rebind-30004-003",
    })).rejects.toThrow("有效独立账号加入当前企业");
    expect(rebindMerchantCrmOwner).not.toHaveBeenCalled();
  });

  it("专用换绑拒绝空 expected owner、过短原因和无效请求号", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(caller.merchant.rebindCrmOwner({
      id: 30004,
      expectedPortalUserId: " ",
      newPortalUserId: "396297",
      reason: "x",
      requestId: "short",
    })).rejects.toThrow();
    expect(rebindMerchantCrmOwner).not.toHaveBeenCalled();
  });
});
