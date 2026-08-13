import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRole } from "../shared/adminPermissions";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async importOriginal => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getAdminUserSalesScopeCodes: vi.fn(),
    getScopedMerchantCreditCodes: vi.fn(),
  };
});

import * as db from "./db";
import { appRouter } from "./routers";

function createContext(adminRole: AdminRole): TrpcContext {
  const now = new Date();
  return {
    user: {
      id: 9901,
      openId: "local_admin:9901",
      name: "订单测试账号",
      email: "orders@example.com",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    adminAccount: {
      id: 9901,
      userId: 9901,
      username: "order-tester",
      displayName: "订单测试账号",
      email: "orders@example.com",
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

function trpcResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify([{ result: { data: { json: data } } }]), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function readUpstreamInput(fetchMock: ReturnType<typeof vi.fn>) {
  const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
  const payload = JSON.parse(new URL(url).searchParams.get("input") ?? "{}");
  return payload["0"].json as Record<string, unknown>;
}

describe("商城订单销售范围代理", () => {
  beforeEach(() => {
    process.env.PLATFORM_API_BASE = "http://platform.internal";
    process.env.PORTAL_API_KEY = "server-only-test-key";
    vi.mocked(db.getAdminUserSalesScopeCodes).mockResolvedValue(["victor"]);
    vi.mocked(db.getScopedMerchantCreditCodes).mockResolvedValue(["91440300MAEXAMPLE1"]);
  });

  afterEach(() => {
    delete process.env.PLATFORM_API_BASE;
    delete process.env.PORTAL_API_KEY;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("普通用户统计由服务端注入其销售范围信用代码，浏览器不能控制范围", async () => {
    const fetchMock = vi.fn().mockResolvedValue(trpcResponse({
      totalOrders: 19,
      grossAmount: "74229.03",
      buyerCount: 5,
      sellerCount: 3,
      todayOrders: 0,
      sevenDayOrders: 19,
      statusCounts: { pending: 3, paid: 4, shipped: 1, done: 0, refund: 1, cancel: 10 },
      statusAmounts: { pending: "51.11", paid: "57306.99", shipped: "376.60", done: "0", refund: "19.29", cancel: "16475.04" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await appRouter.createCaller(createContext("merchant_mgr")).order.stats();
    expect(result.totalOrders).toBe(19);
    expect(db.getAdminUserSalesScopeCodes).toHaveBeenCalledWith(9901);
    expect(db.getScopedMerchantCreditCodes).toHaveBeenCalledWith(["victor"]);
    expect(readUpstreamInput(fetchMock)).toEqual({ visibleCompanyCreditCodes: ["91440300MAEXAMPLE1"] });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-portal-key"]).toBe("server-only-test-key");
    expect(createContext("merchant_mgr").req.headers["x-portal-key"]).toBeUndefined();
  });

  it("普通用户订单列表与详情使用完全相同的销售范围", async () => {
    const listFetch = vi.fn().mockResolvedValue(trpcResponse({ total: 0, rows: [] }));
    vi.stubGlobal("fetch", listFetch);
    await appRouter.createCaller(createContext("merchant_mgr")).order.list({ page: 2, pageSize: 15, status: "done" });
    expect(readUpstreamInput(listFetch)).toMatchObject({
      page: 2,
      pageSize: 15,
      status: "done",
      visibleCompanyCreditCodes: ["91440300MAEXAMPLE1"],
    });

    const detailFetch = vi.fn().mockResolvedValue(trpcResponse({ order: { id: 23 }, items: [], tracks: [], siblings: [] }));
    vi.stubGlobal("fetch", detailFetch);
    await appRouter.createCaller(createContext("merchant_mgr")).order.detail({ orderId: 23 });
    expect(readUpstreamInput(detailFetch)).toEqual({
      orderId: 23,
      visibleCompanyCreditCodes: ["91440300MAEXAMPLE1"],
    });
  });

  it("无销售范围的普通用户向主站传空数组，因此统计、列表和详情均为零可见", async () => {
    vi.mocked(db.getAdminUserSalesScopeCodes).mockResolvedValue([]);
    vi.mocked(db.getScopedMerchantCreditCodes).mockResolvedValue([]);
    const fetchMock = vi.fn().mockResolvedValue(trpcResponse({ total: 0, rows: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await appRouter.createCaller(createContext("merchant_mgr")).order.list({ page: 1, pageSize: 20 });
    expect(readUpstreamInput(fetchMock)).toMatchObject({ visibleCompanyCreditCodes: [] });
  });

  it("超级管理员不附加销售范围，继续查看全部订单", async () => {
    const fetchMock = vi.fn().mockResolvedValue(trpcResponse({ total: 0, rows: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await appRouter.createCaller(createContext("super_admin")).order.list({ page: 1, pageSize: 20 });
    expect(readUpstreamInput(fetchMock)).toEqual({ page: 1, pageSize: 20 });
    expect(db.getAdminUserSalesScopeCodes).not.toHaveBeenCalled();
    expect(db.getScopedMerchantCreditCodes).not.toHaveBeenCalled();
  });

  it("缺少服务端共享密钥时拒绝调用主站订单服务", async () => {
    delete process.env.PORTAL_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(appRouter.createCaller(createContext("merchant_mgr")).order.list({ page: 1, pageSize: 20 }))
      .rejects.toThrow("PORTAL_API_KEY 未配置，无法连接商城订单服务");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
