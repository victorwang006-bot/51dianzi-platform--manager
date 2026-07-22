import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import * as db from "./db";
import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: "admin" | "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("material 权限控制", () => {
  it("非管理员访问物料列表应被拒绝", async () => {
    const caller = appRouter.createCaller(createContext("user"));
    await expect(caller.material.list({ page: 1, pageSize: 10 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("material 查询", () => {
  it("管理员可分页查询物料列表", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.material.list({ page: 1, pageSize: 5 });
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeLessThanOrEqual(5);
    expect(result.total).toBeGreaterThan(0);
  });

  it("支持按型号搜索物料", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.material.list({ page: 1, pageSize: 10, search: "STM32" });
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]?.partNumber).toContain("STM32");
  });

  it("支持按生命周期筛选物料", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.material.list({ page: 1, pageSize: 50, lifecycle: "obsolete" });
    for (const m of result.data) {
      expect(m.lifecycle).toBe("obsolete");
    }
  });

  it("可获取分类与品牌列表", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const categories = await caller.material.categories();
    const brands = await caller.material.brands();
    expect(categories.length).toBeGreaterThan(0);
    expect(brands.length).toBeGreaterThan(0);
    expect(categories).toContain("微控制器");
  });
});

describe("material CRUD", () => {
  it("可创建、更新、启停、删除物料", async () => {
    const caller = appRouter.createCaller(createContext("admin"));

    // 创建
    const created = await caller.material.create({
      partNumber: "TEST-PART-001",
      name: "单元测试物料",
      brand: "TestBrand",
      category: "测试分类",
      package: "TEST8",
      referencePrice: "1.00",
      rohs: "compliant",
      lifecycle: "active",
    });
    expect(created.success).toBe(true);
    expect(created.material).not.toBeNull();
    const id = created.material!.id;
    expect(created.material!.materialNo).toMatch(/^51E-[A-Z]{3}-\d{5}$/);

    try {
      // 更新
      await caller.material.update({ id, name: "单元测试物料-已更新", referencePrice: "2.50" });
      const afterUpdate = await caller.material.detail({ id });
      expect(afterUpdate?.name).toBe("单元测试物料-已更新");
      expect(afterUpdate?.referencePrice).toBe("2.50");

      // 停用
      await caller.material.toggleStatus({ id, status: "disabled" });
      const afterDisable = await caller.material.detail({ id });
      expect(afterDisable?.status).toBe("disabled");
    } finally {
      // 删除（清理测试数据）
      await caller.material.remove({ id });
      const afterDelete = await db.getMaterialById(id);
      expect(afterDelete).toBeNull();
    }
  });
});

describe("merchant 保留模块", () => {
  it("管理员可查询商户列表", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.merchant.list({ page: 1, pageSize: 5 });
    expect(result).toHaveProperty("data");
    expect(result).toHaveProperty("total");
  });
});

describe("admin 保留模块", () => {
  it("管理员可查询管理员列表", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.admin.list({ page: 1, pageSize: 5 });
    expect(result).toHaveProperty("data");
    expect(result.total).toBeGreaterThan(0);
  });
});
