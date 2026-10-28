import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getAdminUserSalesScopeCodes: vi.fn(),
    getOwnedMerchantById: vi.fn(),
    reviewMerchantStatus: vi.fn(),
    reviewHkRegistrationDraft: vi.fn(),
    setMerchantCrmStatus: vi.fn(),
    updateMerchantStatus: vi.fn(),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";

function context(): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 9,
      openId: "admin:cn-review-route",
      email: null,
      name: "审核员",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    } as NonNullable<TrpcContext["user"]>,
    adminAccount: {
      id: 9,
      userId: 9,
      username: "cn-review-route",
      displayName: "审核员",
      email: null,
      phone: null,
      passwordHash: null,
      adminRole: "merchant_mgr",
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

describe("CN pending generic merchant.review router guard", () => {
  const getAdminUserSalesScopeCodes = vi.mocked(db.getAdminUserSalesScopeCodes);
  const getOwnedMerchantById = vi.mocked(db.getOwnedMerchantById);
  const reviewMerchantStatus = vi.mocked(db.reviewMerchantStatus);
  const reviewHkRegistrationDraft = vi.mocked(db.reviewHkRegistrationDraft);
  const setMerchantCrmStatus = vi.mocked(db.setMerchantCrmStatus);
  const updateMerchantStatus = vi.mocked(db.updateMerchantStatus);

  beforeEach(() => {
    vi.resetAllMocks();
    getAdminUserSalesScopeCodes.mockResolvedValue(["sales-a"]);
    getOwnedMerchantById.mockResolvedValue({
      id: 511,
      registrationRegion: "CN",
      salesOwnerCode: "sales-a",
    } as Awaited<ReturnType<typeof db.getOwnedMerchantById>>);
    reviewMerchantStatus.mockRejectedValue(new Error("CN_REGISTRATION_REVIEW_PENDING"));
    reviewHkRegistrationDraft.mockResolvedValue({ success: true, decision: "approved", crmStatus: "pending" });
    setMerchantCrmStatus.mockResolvedValue({ success: true, crmOwnerPortalUserId: "7001" });
  });

  it.each(["approve", "supplement", "suspend", "reactivate"] as const)("M-06：generic %s 只能转到专用 CN 审核流程", async action => {
    await expect(appRouter.createCaller(context()).merchant.review({ id: 511, action }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(reviewMerchantStatus).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 511,
      allowedSalesStaffCodes: ["sales-a"],
      actor: expect.objectContaining({ operatorId: 9, operatorName: "审核员", operatorRole: "merchant_mgr" }),
    }));
    expect(updateMerchantStatus).not.toHaveBeenCalled();
  });

  it("B-01：HK 专用复核原样透传三态销售范围，供锁内复查", async () => {
    await expect(appRouter.createCaller(context()).merchant.reviewHkRegistrationDraft({
      id: 511,
      decision: "approved",
      expectedSubmissionId: "11111111-1111-4111-8111-111111111111",
      expectedPayloadHash: "a".repeat(64),
      confirmed: true,
    })).resolves.toMatchObject({ success: true });
    expect(reviewHkRegistrationDraft).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 511,
      allowedSalesStaffCodes: ["sales-a"],
      actor: expect.objectContaining({ operatorId: 9, operatorName: "审核员", operatorRole: "merchant_mgr" }),
    }));
  });

  it("B-01：CRM 状态变更原样透传销售范围，供锁内复查", async () => {
    await expect(appRouter.createCaller(context()).merchant.setCrmStatus({
      id: 511,
      crmStatus: "disabled",
      note: "运营暂停",
    })).resolves.toMatchObject({ success: true });
    expect(setMerchantCrmStatus).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 511,
      allowedSalesStaffCodes: ["sales-a"],
      actor: expect.objectContaining({ operatorId: 9, operatorName: "审核员", operatorRole: "merchant_mgr" }),
    }));
  });
});
