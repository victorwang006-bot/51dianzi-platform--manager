import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRole } from "../shared/adminPermissions";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getAdminUserSalesScopeCodes: vi.fn(),
    getScopedMerchantCreditCodes: vi.fn(),
    getMerchants: vi.fn(),
    getMerchantById: vi.fn(),
    updateMerchantStatus: vi.fn(),
    listMerchantInventories: vi.fn(),
    offshelfPlatformInventory: vi.fn(),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";

function createContext(adminRole: AdminRole): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 7301,
      openId: "local_admin:7301",
      name: "销售范围测试账号",
      email: "scope@example.com",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    adminAccount: {
      id: 7301,
      userId: 7301,
      username: "scope-tester",
      displayName: "销售范围测试账号",
      email: "scope@example.com",
      phone: null,
      passwordHash: null,
      adminRole,
      status: "active",
      mfaEnabled: false,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("普通用户商户销售范围隔离", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getAdminUserSalesScopeCodes).mockResolvedValue(["victor"]);
    vi.mocked(db.getScopedMerchantCreditCodes).mockResolvedValue(["91440300MAEXAMPLE1"]);
    vi.mocked(db.getMerchants).mockResolvedValue({ data: [], total: 0 });
    vi.mocked(db.getMerchantById).mockResolvedValue({ id: 101, companyName: "可见商户" } as never);
    vi.mocked(db.updateMerchantStatus).mockResolvedValue(undefined);
    vi.mocked(db.listMerchantInventories).mockResolvedValue({ available: true, items: [], total: 0 });
    vi.mocked(db.offshelfPlatformInventory).mockResolvedValue({ success: true });
  });

  it("商户列表只把当前账号绑定的销售代码交给数据库查询", async () => {
    await appRouter.createCaller(createContext("merchant_mgr")).merchant.list({ page: 1, pageSize: 20 });
    expect(db.getAdminUserSalesScopeCodes).toHaveBeenCalledWith(7301);
    expect(db.getMerchants).toHaveBeenCalledWith(
      { page: 1, pageSize: 20 },
      ["victor"],
    );
  });

  it("范围外商户详情按不存在返回，且写操作不会执行", async () => {
    vi.mocked(db.getMerchantById).mockResolvedValue(null);
    const caller = appRouter.createCaller(createContext("merchant_mgr"));
    await expect(caller.merchant.detail({ id: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.merchant.review({ id: 999, action: "approve" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.getMerchantById).toHaveBeenCalledWith(999, ["victor"]);
    expect(db.updateMerchantStatus).not.toHaveBeenCalled();
  });

  it("范围内商户审核先校验可见性再执行", async () => {
    await appRouter.createCaller(createContext("merchant_mgr")).merchant.review({ id: 101, action: "approve" });
    expect(db.getMerchantById).toHaveBeenCalledWith(101, ["victor"]);
    expect(db.updateMerchantStatus).toHaveBeenCalledWith(101, "approved", undefined, 7301);
  });

  it("商户关联物料列表和下架操作使用同一信用代码范围", async () => {
    const caller = appRouter.createCaller(createContext("merchant_mgr"));
    await caller.platformMaterial.list({ creditCode: "91440300MAEXAMPLE1", page: 1, pageSize: 20 });
    expect(db.listMerchantInventories).toHaveBeenCalledWith(
      expect.objectContaining({ creditCode: "91440300MAEXAMPLE1" }),
      ["91440300MAEXAMPLE1"],
    );
    await caller.platformMaterial.offshelf({ id: 88, reason: "图片与型号不符" });
    expect(db.offshelfPlatformInventory).toHaveBeenCalledWith(88, "图片与型号不符", ["91440300MAEXAMPLE1"]);
  });

  it("超级管理员查询商户时不附加销售范围", async () => {
    await appRouter.createCaller(createContext("super_admin")).merchant.list({ page: 1, pageSize: 20 });
    expect(db.getAdminUserSalesScopeCodes).not.toHaveBeenCalled();
    expect(db.getMerchants).toHaveBeenCalledWith({ page: 1, pageSize: 20 }, undefined);
  });
});
