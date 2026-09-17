import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    listMerchantInventories: vi.fn(),
    offshelfPlatformInventory: vi.fn(),
    bulkOffshelfPlatformInventories: vi.fn(),
    getPublisherPublishedInventoryCount: vi.fn(),
    bulkOffshelfPublisherInventories: vi.fn(),
    exportSelectedPlatformInventories: vi.fn(),
    getOwnedMerchantById: vi.fn(),
    getAdminUserSalesScopeCodes: vi.fn(),
    getScopedMerchantCreditCodes: vi.fn(),
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

function createScopedMerchantManagerContext(): TrpcContext {
  const ctx = createAdminContext();
  ctx.adminAccount = {
    id: 77,
    userId: 1,
    username: "scoped-material-manager",
    displayName: "范围物料管理员",
    email: null,
    phone: null,
    passwordHash: null,
    adminRole: "merchant_mgr",
    status: "active",
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  return ctx;
}

describe("platformMaterial 客户物料管理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getAdminUserSalesScopeCodes).mockResolvedValue([]);
    vi.mocked(db.getScopedMerchantCreditCodes).mockResolvedValue([]);
    vi.mocked(db.getOwnedMerchantById).mockResolvedValue({
      id: 30391,
      businessLicense: "91440300MA5F7X2K9T",
    } as Awaited<ReturnType<typeof db.getOwnedMerchantById>>);
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
      undefined,
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
      undefined,
    );
  });

  it("普通商户管理员将销售范围转换为企业信用代码并传给列表", async () => {
    vi.mocked(db.getAdminUserSalesScopeCodes).mockResolvedValue(["sales-a"]);
    vi.mocked(db.getScopedMerchantCreditCodes).mockResolvedValue([" 91440300MA5F7X2K9T "]);
    vi.mocked(db.listMerchantInventories).mockResolvedValue({ available: true, items: [], total: 0 });

    await appRouter.createCaller(createScopedMerchantManagerContext()).platformMaterial.list({
      page: 1,
      pageSize: 20,
    });

    expect(db.getAdminUserSalesScopeCodes).toHaveBeenCalledWith(77);
    expect(db.getScopedMerchantCreditCodes).toHaveBeenCalledWith(["sales-a"]);
    expect(db.listMerchantInventories).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 }),
      [" 91440300MA5F7X2K9T "],
    );
  });

  it("普通商户管理员下架时也必须携带企业信用代码范围", async () => {
    vi.mocked(db.getAdminUserSalesScopeCodes).mockResolvedValue(["sales-a"]);
    vi.mocked(db.getScopedMerchantCreditCodes).mockResolvedValue(["91440300MA5F7X2K9T"]);
    vi.mocked(db.offshelfPlatformInventory).mockResolvedValue({ success: true });

    await appRouter.createCaller(createScopedMerchantManagerContext()).platformMaterial.offshelf({
      id: 150464,
      reason: "范围内商户物料下架",
    });

    expect(db.offshelfPlatformInventory).toHaveBeenCalledWith(
      150464,
      "范围内商户物料下架",
      ["91440300MA5F7X2K9T"],
      expect.objectContaining({ operatorId: 1, operatorRole: "merchant_mgr" }),
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
    expect(db.offshelfPlatformInventory).toHaveBeenCalledWith(
      150464,
      "图片与型号不符，请更换实拍图",
      undefined,
      expect.objectContaining({ operatorId: 1, operatorName: "管理员" }),
    );
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

  it("list 接受正整数 publisherUserId 并返回发布者选项", async () => {
    vi.mocked(db.listMerchantInventories).mockResolvedValue({
      available: true,
      items: [],
      total: 0,
      publishers: [{ userId: 30002, name: "发布人", phone: "13800000000" }],
    });
    const result = await appRouter.createCaller(createAdminContext()).platformMaterial.list({
      publisherUserId: 30002,
      page: 1,
      pageSize: 20,
    });
    expect(db.listMerchantInventories).toHaveBeenCalledWith(
      expect.objectContaining({ publisherUserId: 30002 }),
      undefined,
    );
    expect(result.publishers).toEqual([{ userId: 30002, name: "发布人", phone: "13800000000" }]);
  });

  it("bulkOffshelf 限制 1..50 个不重复正整数", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    await expect(caller.platformMaterial.bulkOffshelf({ ids: [], reason: "测试" })).rejects.toThrow();
    await expect(caller.platformMaterial.bulkOffshelf({ ids: [1, 1], reason: "测试" })).rejects.toThrow();
    await expect(caller.platformMaterial.bulkOffshelf({
      ids: Array.from({ length: 51 }, (_, index) => index + 1),
      reason: "测试",
    })).rejects.toThrow();
    expect(db.bulkOffshelfPlatformInventories).not.toHaveBeenCalled();
  });

  it("bulkOffshelf 传入销售范围和审计身份并返回逐项结果", async () => {
    vi.mocked(db.getAdminUserSalesScopeCodes).mockResolvedValue(["sales-a"]);
    vi.mocked(db.getScopedMerchantCreditCodes).mockResolvedValue(["91440300MA5F7X2K9T"]);
    vi.mocked(db.bulkOffshelfPlatformInventories).mockResolvedValue({
      success: false,
      results: [
        { id: 1, success: true },
        { id: 2, success: false, error: "物料已不是发布状态" },
      ],
    });
    const result = await appRouter.createCaller(createScopedMerchantManagerContext()).platformMaterial.bulkOffshelf({
      ids: [1, 2],
      reason: " 批量合规下架 ",
    });
    expect(db.bulkOffshelfPlatformInventories).toHaveBeenCalledWith(
      [1, 2],
      "批量合规下架",
      ["91440300MA5F7X2K9T"],
      expect.objectContaining({ operatorId: 1, operatorRole: "merchant_mgr" }),
    );
    expect(result.results).toHaveLength(2);
  });

  it("publisherOffshelfPreview 从服务端商户记录派生信用代码并返回已发布数量", async () => {
    vi.mocked(db.getPublisherPublishedInventoryCount).mockResolvedValue({
      publisherUserId: 30002,
      publisherName: "发布人",
      publishedCount: 491,
    });
    const result = await appRouter.createCaller(createAdminContext()).platformMaterial.publisherOffshelfPreview({
      merchantId: 30391,
      publisherUserId: 30002,
    });
    expect(db.getPublisherPublishedInventoryCount).toHaveBeenCalledWith({
      creditCode: "91440300MA5F7X2K9T",
      publisherUserId: 30002,
      allowedCreditCodes: undefined,
    });
    expect(result.publishedCount).toBe(491);
  });

  it("bulkOffshelfByPublisher 按商户和发布人下架全部已发布库存并携带审计身份", async () => {
    vi.mocked(db.bulkOffshelfPublisherInventories).mockResolvedValue({
      success: true,
      publisherUserId: 30002,
      publisherName: "发布人",
      affected: 491,
    });
    const result = await appRouter.createCaller(createAdminContext()).platformMaterial.bulkOffshelfByPublisher({
      merchantId: 30391,
      publisherUserId: 30002,
      reason: " 违反平台物料规范 ",
    });
    expect(db.bulkOffshelfPublisherInventories).toHaveBeenCalledWith({
      merchantId: 30391,
      creditCode: "91440300MA5F7X2K9T",
      publisherUserId: 30002,
      reason: "违反平台物料规范",
      allowedCreditCodes: undefined,
      actor: expect.objectContaining({ operatorId: 1, operatorName: "管理员" }),
    });
    expect(result.affected).toBe(491);
  });

  it("exportSelected 限制 ID、重新传递销售范围且不接收手机号", async () => {
    vi.mocked(db.getAdminUserSalesScopeCodes).mockResolvedValue(["sales-a"]);
    vi.mocked(db.getScopedMerchantCreditCodes).mockResolvedValue(["91440300MA5F7X2K9T"]);
    vi.mocked(db.exportSelectedPlatformInventories).mockResolvedValue({
      filename: "platform-materials.csv",
      csv: "\uFEFFcsv",
    });
    const caller = appRouter.createCaller(createScopedMerchantManagerContext());
    await expect(caller.platformMaterial.exportSelected({ ids: [1, 1] })).rejects.toThrow();
    const result = await caller.platformMaterial.exportSelected({ ids: [3, 2] });
    expect(db.exportSelectedPlatformInventories).toHaveBeenCalledWith([3, 2], ["91440300MA5F7X2K9T"]);
    expect(result.csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("CSV 使用 UTF-8 BOM、RFC4180 引号并阻止 Excel 公式注入", () => {
    const csv = db.createPlatformInventoryCsv([{
      id: 1,
      userId: 2,
      userName: "=HYPERLINK(\"https://bad.example\")",
      partNumber: "A,\"B\"",
      brand: "+CMD",
      category: "IC",
      pkg: null,
      qtyOnSale: 10,
      priceEx: "1",
      priceIncl: "1.13",
      status: "published",
      publishedAt: new Date("2026-09-17T00:00:00Z"),
      createdAt: new Date("2026-09-16T00:00:00Z"),
      companyName: "测试公司",
      creditCode: "91440300TEST",
    }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"\'=HYPERLINK(""https://bad.example"")"');
    expect(csv).toContain('"A,""B"""');
    expect(csv).toContain('"\'+CMD"');
    expect(csv).not.toContain("Phone");
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
