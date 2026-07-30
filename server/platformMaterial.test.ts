import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    listMerchantInventories: vi.fn(),
    offshelfPlatformInventory: vi.fn(),
  };
});

import { appRouter } from "./routers";
import * as db from "./db";

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-open-id",
      name: "管理员",
      email: "admin@test.com",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
  } as TrpcContext;
}

function createUserContext(): TrpcContext {
  const ctx = createAdminContext();
  (ctx.user as { role: string }).role = "user";
  return ctx;
}

describe("platformMaterial 客户物料管理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("list 返回前台物料列表（含企业名与信用代码）", async () => {
    const mockResult = {
      available: true,
      total: 1,
      items: [{
        id: 150464,
        userId: 30002,
        partNumber: "STM32F746NG",
        brand: "ST",
        category: "MCU",
        pkg: "LQFP144",
        qtyOnSale: 1000,
        priceEx: "10.5",
        priceIncl: "11.865",
        status: "published" as const,
        publishedAt: new Date(),
        createdAt: new Date(),
        companyName: "深圳市某某电子有限公司",
        creditCode: "91440300MA5EXAMPLE1",
      }],
    };
    vi.mocked(db.listMerchantInventories).mockResolvedValue(mockResult);

    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.platformMaterial.list({ keyword: "STM32", status: "published", page: 1, pageSize: 20 });

    expect(db.listMerchantInventories).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: "STM32", status: "published", page: 1, pageSize: 20 }),
    );
    expect(result.available).toBe(true);
    expect(result.total).toBe(1);
    expect(result.items[0].partNumber).toBe("STM32F746NG");
    expect(result.items[0].companyName).toBe("深圳市某某电子有限公司");
  });

  it("list 无参数调用时使用默认值", async () => {
    vi.mocked(db.listMerchantInventories).mockResolvedValue({ available: true, items: [], total: 0 });
    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.platformMaterial.list();
    expect(db.listMerchantInventories).toHaveBeenCalled();
    expect(result.items).toEqual([]);
  });

  it("list 支持按商户信用代码（creditCode）过滤——商户详情页物料管理场景", async () => {
    vi.mocked(db.listMerchantInventories).mockResolvedValue({ available: true, items: [], total: 0 });
    const caller = appRouter.createCaller(createAdminContext());
    await caller.platformMaterial.list({ creditCode: "91440300MA5EXAMPLE1", status: "all", page: 1, pageSize: 10 });
    expect(db.listMerchantInventories).toHaveBeenCalledWith(
      expect.objectContaining({ creditCode: "91440300MA5EXAMPLE1", status: "all", pageSize: 10 }),
    );
  });

  it("list 开发环境（前台库不可用）返回 available:false", async () => {
    vi.mocked(db.listMerchantInventories).mockResolvedValue({ available: false, items: [], total: 0 });
    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.platformMaterial.list({ page: 1, pageSize: 20 });
    expect(result.available).toBe(false);
    expect(result.total).toBe(0);
  });

  it("offshelf 携带下架原因调用下架并返回成功", async () => {
    vi.mocked(db.offshelfPlatformInventory).mockResolvedValue({ success: true });
    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.platformMaterial.offshelf({ id: 150464, reason: "图片与型号不符，请更换实拍图" });
    expect(db.offshelfPlatformInventory).toHaveBeenCalledWith(150464, "图片与型号不符，请更换实拍图");
    expect(result.success).toBe(true);
  });

  it("offshelf 缺少下架原因被拒绝", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    await expect(caller.platformMaterial.offshelf({ id: 1, reason: "" })).rejects.toThrow();
    await expect(caller.platformMaterial.offshelf({ id: 1, reason: "   " })).rejects.toThrow();
    expect(db.offshelfPlatformInventory).not.toHaveBeenCalled();
  });

  it("offshelf 下架原因超过255字被拒绝", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    await expect(
      caller.platformMaterial.offshelf({ id: 1, reason: "长".repeat(256) }),
    ).rejects.toThrow();
    expect(db.offshelfPlatformInventory).not.toHaveBeenCalled();
  });

  it("offshelf 对非发布状态物料抛出错误", async () => {
    vi.mocked(db.offshelfPlatformInventory).mockRejectedValue(new Error("物料不存在或已不是发布状态"));
    const caller = appRouter.createCaller(createAdminContext());
    await expect(caller.platformMaterial.offshelf({ id: 999999, reason: "测试原因" })).rejects.toThrow("物料不存在或已不是发布状态");
  });

  it("非管理员访问 list 被拒绝", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.platformMaterial.list({ page: 1, pageSize: 20 })).rejects.toThrow();
    expect(db.listMerchantInventories).not.toHaveBeenCalled();
  });

  it("非管理员访问 offshelf 被拒绝", async () => {
    const caller = appRouter.createCaller(createUserContext());
    await expect(caller.platformMaterial.offshelf({ id: 1, reason: "测试" })).rejects.toThrow();
    expect(db.offshelfPlatformInventory).not.toHaveBeenCalled();
  });
});
