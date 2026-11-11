import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const mocks = vi.hoisted(() => ({ owned: vi.fn(), scope: vi.fn(), audit: vi.fn(), list: vi.fn(), save: vi.fn(), cancel: vi.fn(), review: vi.fn(), document: vi.fn() }));
vi.mock("./db", () => ({ getOwnedMerchantById: mocks.owned, getAdminUserSalesScopeCodes: mocks.scope, recordMerchantAgencyCertificationAudit: mocks.audit }));
vi.mock("./platformAgencyCertificationApi", () => ({ listPlatformAgencyCertifications: mocks.list, upsertPlatformAgencyCertification: mocks.save, cancelPlatformAgencyCertification: mocks.cancel, reviewPlatformAgencyCertification: mocks.review, getPlatformAgencyCertificationDocument: mocks.document }));
import { appRouter } from "./routers";
function context(write = true): TrpcContext {
  return { user: { id: 21, role: "admin", name: "会话操作人" },
    adminAccount: { id: 9, userId: 21, adminRole: "merchant_mgr", displayName: "可信审核员", username: "reviewer", status: "active" },
    adminPermissions: write ? ["merchants.read", "merchants.write"] : ["merchants.read"],
    req: { headers: { "user-agent": "mock-test" }, ip: "127.0.0.1" }, res: {} } as unknown as TrpcContext;
}
const input = { merchantId: 31, id: 81, expectedRevision: 3, decision: "approve" as const, reviewReason: "", requestId: "b6c8c1c6-a3b8-4c76-96a2-1ea2b6bf824f" };
const merchant = { id: 31, registrationRegion: "CN", businessLicense: "91440300MA5F7X2K9T", crmOwnerPortalUserId: "700001" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.owned.mockResolvedValue(merchant); mocks.scope.mockResolvedValue(["sales-a"]);
  mocks.list.mockResolvedValue({ items: [] }); mocks.review.mockResolvedValue({ success: true, id: 81 });
  mocks.save.mockResolvedValue({ success: true, id: 99 }); mocks.cancel.mockResolvedValue({ success: true });
  mocks.document.mockResolvedValue({ url: "https://private.invalid/signed", fileName: "proof.pdf", expiresAt: Date.now() + 600000 });
});
describe("后台代理认证隔离路由mock", () => {
  it("只读可看列表，但审核/认定/撤销/原件均被写权限门禁阻断", async () => {
    const caller = appRouter.createCaller(context(false)).merchant;
    await expect(caller.agencyCertifications({ merchantId: 31 })).resolves.toEqual({ items: [] });
    for (const action of [() => caller.reviewAgencyCertification(input), () => caller.agencyCertificationDocument({ merchantId: 31, id: 81 }),
      () => caller.cancelAgencyCertification(input), () => caller.saveAgencyCertification({ ...input, brands: ["TI"] })]) {
      await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const mock of [mocks.review, mocks.save, mocks.cancel, mocks.document]) expect(mock).not.toHaveBeenCalled();
  });
  it("申请审核CN信用码、owner和operator从ctx与商户派生，忽略客户端伪造字段", async () => {
    const forged = { ...input, operator: { id: 777, name: "伪造" }, expectedOwnerUserId: 777, creditCode: "FORGED" };
    await appRouter.createCaller(context()).merchant.reviewAgencyCertification(forged);
    expect(mocks.owned).toHaveBeenCalledWith(31, ["sales-a"]);
    expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({ creditCode: merchant.businessLicense, expectedOwnerUserId: 700001, id: 81, expectedRevision: 3,
      operator: expect.objectContaining({ id: 21, name: "会话操作人" }) }));
    expect(mocks.review.mock.calls[0][0].operator.id).not.toBe(777);
  });
  it("HK全五过程传registrationIdentifier和owner，不以信用码或公司名猜公司", async () => {
    mocks.owned.mockResolvedValue({ ...merchant, registrationRegion: "HK", registrationIdentifier: "hk:01234567", businessLicense: null });
    const caller = appRouter.createCaller(context()).merchant;
    await caller.agencyCertifications({ merchantId: 31 });
    await caller.reviewAgencyCertification({ ...input, decision: "reject", reviewReason: "授权范围不符" });
    await caller.agencyCertificationDocument({ merchantId: 31, id: 81 });
    await caller.cancelAgencyCertification(input);
    const result = await caller.saveAgencyCertification({ ...input, brands: ["TI"] });
    expect(result.id).toBe(99);
    for (const mock of [mocks.list, mocks.review, mocks.document, mocks.cancel, mocks.save]) {
      expect(mock.mock.calls[0][0]).toMatchObject({ registrationRegion: "HK", registrationIdentifier: "HK:01234567", expectedOwnerUserId: 700001 });
      expect(mock.mock.calls[0][0]).not.toHaveProperty("creditCode");
    }
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ certificationId: 99, action: "update" }));
  });
  it("无负责范围返回NOT_FOUND且所有上游过程均不调用", async () => {
    mocks.owned.mockResolvedValue(null);
    const caller = appRouter.createCaller(context()).merchant;
    for (const action of [() => caller.agencyCertifications({ merchantId: 31 }), () => caller.reviewAgencyCertification(input), () => caller.agencyCertificationDocument(input), () => caller.cancelAgencyCertification(input), () => caller.saveAgencyCertification({ ...input, brands: ["TI"] })]) {
      await expect(action()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    for (const mock of [mocks.list, mocks.review, mocks.document, mocks.cancel, mocks.save]) expect(mock).not.toHaveBeenCalled();
  });
  it("驳回原因空白、陈旧请求错误及编辑缺版本不触发错误提交", async () => {
    const caller = appRouter.createCaller(context()).merchant;
    await expect(caller.reviewAgencyCertification({ ...input, decision: "reject", reviewReason: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.review).not.toHaveBeenCalled();
    await expect(caller.saveAgencyCertification({ merchantId: 31, id: 81, brands: ["TI"], requestId: input.requestId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.save).not.toHaveBeenCalled();
    mocks.review.mockRejectedValue(new Error("版本已变化，请刷新"));
    await expect(caller.reviewAgencyCertification(input)).rejects.toThrow("版本已变化");
  });
  it.each([{ ...merchant, registrationRegion: "HK", registrationIdentifier: "HK:123" }, { ...merchant, crmOwnerPortalUserId: "姓名" }, { ...merchant, businessLicense: "invalid" }])("无效强身份或owner拒绝，且不调用上游", async fixture => {
    mocks.owned.mockResolvedValue(fixture);
    await expect(appRouter.createCaller(context()).merchant.reviewAgencyCertification(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.review).not.toHaveBeenCalled();
  });
});
