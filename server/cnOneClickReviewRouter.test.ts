import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
vi.mock("./db", async importOriginal => ({
  ...await importOriginal<typeof import("./db")>(),
  getAdminUserSalesScopeCodes: vi.fn(), getOwnedMerchantById: vi.fn(), setMerchantCrmStatus: vi.fn(),
}));
vi.mock("./cnRegistrationReview", async importOriginal => ({
  ...await importOriginal<typeof import("./cnRegistrationReview")>(), approveCnRegistrationAndEnableCrm: vi.fn(),
}));
import * as db from "./db";
import * as review from "./cnRegistrationReview";
import { appRouter } from "./routers";
function context(role = "merchant_mgr"): TrpcContext {
  const now = new Date();
  return {
    user: { id: 9, openId: "admin:synthetic-cn", name: "合成审核员", role: "admin", loginMethod: "password", createdAt: now, updatedAt: now, lastSignedIn: now, email: null } as any,
    adminAccount: { id: 9, userId: 9, username: "synthetic", displayName: "合成审核员", adminRole: role, status: "active", mfaEnabled: false, createdAt: now, updatedAt: now } as any,
    req: { protocol: "https", headers: {} } as any,
    res: { clearCookie: () => {}, cookie: () => {} } as any,
  };
}
const input = { id: 511, expectedVersion: "a".repeat(64), confirmed: true as const, portalUserId: "7001" };
const combined = vi.mocked(review.approveCnRegistrationAndEnableCrm);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(db.getAdminUserSalesScopeCodes).mockResolvedValue(["sales-a"]);
  vi.mocked(db.getOwnedMerchantById).mockResolvedValue({ id: 511, registrationRegion: "CN", salesOwnerCode: "sales-a" } as any);
  combined.mockResolvedValue({ success: true, decision: "approved", merchantId: 511, expectedVersion: input.expectedVersion, idempotent: false, reviewStatus: "approved", retainedEffectiveAccess: false });
});
describe("CN one-click router: write permission + formal owner scope + human confirmation", () => {
  it("forwards exact displayed version, confirmation, existing owner, actor and formal scope into one service", async () => {
    await expect(appRouter.createCaller(context()).merchant.approveCnRegistrationAndEnableCrm(input)).resolves.toMatchObject({ success: true });
    expect(combined).toHaveBeenCalledOnce();
    expect(combined).toHaveBeenCalledWith(expect.objectContaining({ merchantId: 511, expectedVersion: input.expectedVersion, confirmed: true, portalUserId: "7001", allowedSalesStaffCodes: ["sales-a"], actor: expect.objectContaining({ operatorId: 9, operatorRole: "merchant_mgr" }) }));
    expect(db.setMerchantCrmStatus).not.toHaveBeenCalled();
  });
  it("an account without merchants.write cannot reach the service", async () => {
    await expect(appRouter.createCaller(context("viewer")).merchant.approveCnRegistrationAndEnableCrm(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(combined).not.toHaveBeenCalled();
  });
  it("out-of-formal-scope merchant does not reach the service", async () => {
    vi.mocked(db.getOwnedMerchantById).mockResolvedValue(null);
    await expect(appRouter.createCaller(context()).merchant.approveCnRegistrationAndEnableCrm(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(combined).not.toHaveBeenCalled();
  });
  it.each([{ confirmed: false }, { confirmed: undefined }, { expectedVersion: "guessed" }, { id: 0 }])("invalid confirmation/version/id $confirmed $expectedVersion $id cannot reach the service", async invalid => {
    await expect(appRouter.createCaller(context()).merchant.approveCnRegistrationAndEnableCrm({ ...input, ...invalid } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(combined).not.toHaveBeenCalled();
  });
  it.each([
    ["CN_REVIEW_VERSION_CHANGED", "CONFLICT", "资料已变化"],
    ["CN_REVIEW_OWNER_OR_SUBJECT_INVALID", "PRECONDITION_FAILED", "负责人绑定不一致"],
    ["CRM_DUPLICATE_OPENING", "CONFLICT", "请勿重复开通"],
    ["CN_REVIEW_COMPLETION_CHANGED", "CONFLICT", "状态已变化"],
  ])("maps %s to a Chinese %s failure, not success", async (error, code, text) => {
    combined.mockRejectedValue(new Error(error));
    await expect(appRouter.createCaller(context()).merchant.approveCnRegistrationAndEnableCrm(input)).rejects.toMatchObject({ code, message: expect.stringContaining(text) });
  });
  it("original grant distinguishes pending registration from owner mismatch without bypassing it", async () => {
    vi.mocked(db.setMerchantCrmStatus).mockRejectedValue(Object.assign(new Error("CN_PLATFORM_REVIEW_OR_OWNER_INVALID"), { reason: "CN_REGISTRATION_NOT_APPROVED" }));
    await expect(appRouter.createCaller(context()).merchant.setCrmStatus({ id: 511, crmStatus: "enabled" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("尚未审核通过") });
    vi.mocked(db.setMerchantCrmStatus).mockRejectedValue(new Error("CN_PLATFORM_REVIEW_OR_OWNER_INVALID"));
    await expect(appRouter.createCaller(context()).merchant.setCrmStatus({ id: 511, crmStatus: "enabled" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("负责人绑定不一致") });
  });
});
