import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: "admin" | "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "测试用户",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => undefined,
    } as unknown as TrpcContext["res"],
  };
}

describe("权限控制（RBAC）", () => {
  it("普通用户访问管理接口应被拒绝", async () => {
    const caller = appRouter.createCaller(createContext("user"));
    await expect(caller.dashboard.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("普通用户访问财务接口应被拒绝", async () => {
    const caller = appRouter.createCaller(createContext("user"));
    await expect(caller.finance.summary()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("管理员可以访问仪表盘统计", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const stats = await caller.dashboard.stats();
    expect(stats).not.toBeNull();
    expect(typeof stats?.totalOrders).toBe("number");
    expect(typeof stats?.totalMerchants).toBe("number");
  });
});

describe("商户管理", () => {
  it("管理员可以分页查询商户列表", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.merchant.list({ page: 1, pageSize: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("merchantNo");
    expect(result.data[0]).toHaveProperty("companyName");
  });

  it("支持按状态筛选待审核商户", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.merchant.list({ page: 1, pageSize: 10, status: "pending" });
    for (const m of result.data) {
      expect(m.status).toBe("pending");
    }
  });

  it("商户详情返回完整企业信息（营业执照/法人/联系人/结算账户）", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const list = await caller.merchant.list({ page: 1, pageSize: 1 });
    expect(list.data.length).toBeGreaterThan(0);
    const detail = await caller.merchant.detail({ id: list.data[0].id });
    expect(detail).not.toBeNull();
    expect(detail).toHaveProperty("businessLicense");
    expect(detail).toHaveProperty("licenseImageUrl");
    expect(detail).toHaveProperty("registeredCapital");
    expect(detail).toHaveProperty("registeredAddress");
    expect(detail).toHaveProperty("businessScope");
    expect(detail).toHaveProperty("legalPersonName");
    expect(detail).toHaveProperty("legalPersonIdNo");
    expect(detail).toHaveProperty("legalPersonPhone");
    expect(detail).toHaveProperty("contactName");
    expect(detail).toHaveProperty("contactPhone");
    expect(detail).toHaveProperty("settlementAccount");
    expect(detail).toHaveProperty("settlementBank");
    expect(detail).toHaveProperty("settlementAccountName");
  });
});

describe("商品治理", () => {
  it("管理员可以查询商品列表", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.product.list({ page: 1, pageSize: 10 });
    expect(result.total).toBeGreaterThan(0);
  });

  it("商品可按商户分组返回，含商户信息与商品清单", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const groups = await caller.product.listByMerchant({});
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g).toHaveProperty("merchantId");
      expect(g).toHaveProperty("companyName");
      expect(g).toHaveProperty("merchantNo");
      expect(g.products.length).toBeGreaterThan(0);
      expect(g.products[0]).toHaveProperty("productNo");
      expect(g.products[0]).toHaveProperty("status");
    }
    const pending = await caller.product.listByMerchant({ status: "pending_review" });
    for (const g of pending) {
      for (const p of g.products) {
        expect(p.status).toBe("pending_review");
      }
    }
  });

  it("支持筛选禁售商品且包含禁售原因", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.product.list({ page: 1, pageSize: 10, status: "banned" });
    for (const p of result.data) {
      expect(p.status).toBe("banned");
    }
    if (result.data.length > 0) {
      expect(result.data[0].banReason).toBeTruthy();
    }
  });

  it("可以查询类目列表", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const categories = await caller.product.categories();
    expect(categories.length).toBeGreaterThan(0);
  });
});

describe("订单中心", () => {
  it("管理员可以查询订单列表", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.order.list({ page: 1, pageSize: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("orderNo");
    expect(result.data[0]).toHaveProperty("totalAmount");
  });

  it("订单详情包含状态变更日志", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const list = await caller.order.list({ page: 1, pageSize: 1 });
    const first = list.data[0];
    const detail = await caller.order.detail({ id: first.id });
    expect(detail.order).not.toBeNull();
    expect(Array.isArray(detail.logs)).toBe(true);
  });
});

describe("售后退款", () => {
  it("管理员可以查询退款列表", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.refund.list({ page: 1, pageSize: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("refundNo");
    expect(result.data[0]).toHaveProperty("refundAmount");
  });
});

describe("财务账本", () => {
  it("财务汇总包含四项核心指标", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const summary = await caller.finance.summary();
    expect(summary).not.toBeNull();
    expect(typeof summary?.totalPayment).toBe("number");
    expect(typeof summary?.totalPlatformFee).toBe("number");
    expect(typeof summary?.totalRefund).toBe("number");
    expect(typeof summary?.pendingSettlement).toBe("number");
  });

  it("可以查询支付流水", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.finance.flows({ page: 1, pageSize: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("flowNo");
  });

  it("结算单生成逻辑正确（首次汇总金额或重复生成报错）", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    // 商户1有两笔已完成订单：42500 + 64000，服务费 1275 + 1920
    // 若此前已生成过结算单，则应报“无可结算订单”错误（幂等保护）
    try {
      const bill = await caller.finance.generateSettlement({ merchantId: 1 });
      expect(bill.orderCount).toBe(2);
      expect(bill.totalAmount).toBeCloseTo(106500, 1);
      expect(bill.feeAmount).toBeCloseTo(3195, 1);
      expect(bill.netAmount).toBeCloseTo(103305, 1);
    } catch (e: unknown) {
      expect((e as Error).message).toContain("暂无可结算");
    }

    // 再次生成应因无可结算订单而报错
    await expect(caller.finance.generateSettlement({ merchantId: 1 })).rejects.toThrow();
  });

  it("结算单可确认并推进状态", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const list = await caller.finance.settlements({ page: 1, pageSize: 10, status: "draft" });
    if (list.data.length > 0) {
      const res = await caller.finance.updateSettlement({ id: list.data[0].id, action: "confirm" });
      expect(res.success).toBe(true);
    }
  });
});

describe("告警中心", () => {
  it("可以查询告警列表", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.alert.list({ page: 1, pageSize: 10 });
    expect(result.total).toBeGreaterThan(0);
  });

  it("支持按严重程度筛选", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.alert.list({ page: 1, pageSize: 10, severity: "critical" });
    for (const a of result.data) {
      expect(a.severity).toBe("critical");
    }
  });
});

describe("审计中心", () => {
  it("可以查询审计日志", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.auditLog.list({ page: 1, pageSize: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("action");
    expect(result.data[0]).toHaveProperty("operatorName");
  });
});

describe("智能风控", () => {
  it("可以查询风控分析记录", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.risk.list({ page: 1, pageSize: 10 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("riskLevel");
    expect(result.data[0]).toHaveProperty("riskSummary");
    expect(result.data[0]).toHaveProperty("suggestions");
  });
});

describe("权限管理", () => {
  it("可以查询管理员账户列表", async () => {
    const caller = appRouter.createCaller(createContext("admin"));
    const result = await caller.admin.list({ page: 1, pageSize: 20 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.data[0]).toHaveProperty("adminRole");
  });
});
