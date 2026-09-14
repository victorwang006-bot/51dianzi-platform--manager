import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getAdminUserSalesScopeCodes: vi.fn(),
    getMerchantById: vi.fn(),
    getMerchantLicenseSource: vi.fn(),
    recordMerchantLicenseView: vi.fn(),
  };
});

vi.mock("./storage", () => ({
  storagePut: vi.fn(),
  storageGetOssSignedUrl: vi.fn(),
}));

import * as db from "./db";
import { storageGetOssSignedUrl } from "./storage";
import { appRouter } from "./routers";

function adminCtx(options: {
  role?: "super_admin" | "merchant_mgr";
  permissions?: TrpcContext["adminPermissions"];
} = {}): TrpcContext {
  const now = new Date();
  const role = options.role ?? "merchant_mgr";
  return {
    user: {
      id: 51,
      openId: "admin:merchant-license-test",
      email: null,
      name: "测试销售",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    } as NonNullable<TrpcContext["user"]>,
    adminAccount: {
      id: 51,
      userId: 51,
      username: "license-test",
      displayName: "测试销售",
      email: null,
      phone: null,
      passwordHash: null,
      adminRole: role,
      status: "active",
      mfaEnabled: false,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    },
    adminPermissions: options.permissions,
    req: {
      protocol: "https",
      ip: "127.0.0.1",
      headers: { "user-agent": "vitest" },
    } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const merchant = {
  id: 30004,
  businessLicense: "91440300MA5F7X2K9T",
  crmOwnerPortalUserId: "390005",
  licenseObjectKey: "licenses/user-390005-test.png",
  licenseImageUrl: null,
};

describe("merchant.licenseAccess 行为", () => {
  const getAdminUserSalesScopeCodes = vi.mocked(db.getAdminUserSalesScopeCodes);
  const getMerchantById = vi.mocked(db.getMerchantById);
  const getMerchantLicenseSource = vi.mocked(db.getMerchantLicenseSource);
  const recordMerchantLicenseView = vi.mocked(db.recordMerchantLicenseView);
  const signOss = vi.mocked(storageGetOssSignedUrl);

  beforeEach(() => {
    vi.resetAllMocks();
    getAdminUserSalesScopeCodes.mockResolvedValue(["jack"]);
    getMerchantById.mockResolvedValue(merchant as Awaited<ReturnType<typeof db.getMerchantById>>);
    getMerchantLicenseSource.mockResolvedValue({
      objectKey: merchant.licenseObjectKey,
      legacyUrl: null,
      fileName: "营业执照.png",
    });
    signOss.mockResolvedValue("https://bucket.oss-cn-hangzhou.aliyuncs.com/licenses/test.png?signed=1");
    recordMerchantLicenseView.mockResolvedValue(undefined);
  });

  it("没有 merchants.read 权限时直接拒绝且不查询商户", async () => {
    await expect(appRouter.createCaller(adminCtx({ permissions: ["profile.manage"] })).merchant.licenseAccess({
      id: merchant.id,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(getMerchantById).not.toHaveBeenCalled();
  });

  it("销售范围内查不到商户时返回 NOT_FOUND 且不签名", async () => {
    getMerchantById.mockResolvedValue(null);
    await expect(appRouter.createCaller(adminCtx()).merchant.licenseAccess({ id: merchant.id }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(getMerchantById).toHaveBeenCalledWith(merchant.id, ["jack"]);
    expect(signOss).not.toHaveBeenCalled();
  });

  it("负责人或已审批协作者命中读范围后可获得最少响应并写审计", async () => {
    const result = await appRouter.createCaller(adminCtx()).merchant.licenseAccess({ id: merchant.id });
    expect(getMerchantById).toHaveBeenCalledWith(merchant.id, ["jack"]);
    expect(signOss).toHaveBeenCalledWith(merchant.licenseObjectKey, 900);
    expect(recordMerchantLicenseView).toHaveBeenCalledWith(
      merchant.id,
      "private_object",
      expect.objectContaining({ operatorId: 51, operatorRole: "merchant_mgr" }),
    );
    expect(result).toMatchObject({
      url: expect.stringContaining("signed=1"),
      fileName: "营业执照.png",
    });
    expect(result).not.toHaveProperty("objectKey");
    expect(result).not.toHaveProperty("legacyUrl");
  });

  it("签名失败时不写成功审计，也不返回URL", async () => {
    signOss.mockRejectedValue(new Error("sign failed"));
    await expect(appRouter.createCaller(adminCtx()).merchant.licenseAccess({ id: merchant.id }))
      .rejects.toThrow("sign failed");
    expect(recordMerchantLicenseView).not.toHaveBeenCalled();
  });

  it("审计写入失败时失败关闭，不把已签名URL返回客户端", async () => {
    recordMerchantLicenseView.mockRejectedValue(new Error("audit unavailable"));
    await expect(appRouter.createCaller(adminCtx()).merchant.licenseAccess({ id: merchant.id }))
      .rejects.toThrow("audit unavailable");
  });
});
