import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminRole } from "../shared/adminPermissions";
import type { TrpcContext } from "./_core/context";
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

describe("商城真实订单后台代理", () => {
  beforeEach(() => {
    process.env.PLATFORM_API_BASE = "http://platform.internal";
    process.env.PORTAL_API_KEY = "server-only-test-key";
  });

  afterEach(() => {
    delete process.env.PLATFORM_API_BASE;
    delete process.env.PORTAL_API_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("审计角色可通过服务端代理读取历史 DZ 订单，浏览器上下文不接触服务密钥", async () => {
    const fetchMock = vi.fn().mockResolvedValue(trpcResponse({
      total: 1,
      rows: [{
        id: 17,
        orderNo: "DZ202607010001",
        batchId: null,
        batchSeq: null,
        batchNo: null,
        buyerId: 1,
        buyerName: "历史买家",
        buyerUsername: "legacy",
        sellerId: 2,
        sellerName: "历史供应商",
        status: "done",
        totalAmount: "120.00",
        payMethod: "corp",
        receiver: "张三",
        receiverPhone: "13800000000",
        expressCo: null,
        expressNo: null,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await appRouter.createCaller(createContext("auditor")).order.list({
      page: 2,
      pageSize: 15,
      keyword: "DZ202607010001",
      status: "done",
    });

    expect(result.total).toBe(1);
    expect(result.rows[0]).toMatchObject({
      orderNo: "DZ202607010001",
      batchNo: null,
      status: "done",
      buyerId: 1,
      buyerName: "历史买家",
      buyerUsername: "legacy",
      sellerId: 2,
      sellerName: "历史供应商",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/trpc/internalOrder.list");
    const upstreamInput = JSON.parse(new URL(url).searchParams.get("input") ?? "{}");
    expect(upstreamInput["0"].json).toMatchObject({
      page: 2,
      pageSize: 15,
      keyword: "DZ202607010001",
      status: "done",
    });
    expect((init.headers as Record<string, string>)["x-portal-key"]).toBe("server-only-test-key");
    expect(createContext("auditor").req.headers["x-portal-key"]).toBeUndefined();
  });

  it("客服角色可通过同一只读代理查看订单详情", async () => {
    const fetchMock = vi.fn().mockResolvedValue(trpcResponse({
      order: { id: 23, orderNo: "DZ202607010002", status: "paid" },
      items: [],
      tracks: [],
      siblings: [],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await appRouter.createCaller(createContext("customer_svc")).order.detail({ orderId: 23 });
    expect(result.order).toMatchObject({ id: 23, orderNo: "DZ202607010002" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/trpc/internalOrder.detail");
    expect(init.method).toBeUndefined();
    expect((init.headers as Record<string, string>)["x-portal-key"]).toBe("server-only-test-key");
  });

  it("缺少服务端共享密钥时拒绝调用上游商城", async () => {
    delete process.env.PORTAL_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(appRouter.createCaller(createContext("auditor")).order.list({
      page: 1,
      pageSize: 20,
    })).rejects.toThrow("PORTAL_API_KEY 未配置，无法连接商城订单服务");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("商城服务错误以可读错误返回后台而非降级到独立订单表", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      error: { json: { message: "订单状态已变化，请刷新后重试" } },
    }]), { status: 409 })));
    await expect(appRouter.createCaller(createContext("operation")).order.detail({ orderId: 23 }))
      .rejects.toThrow("订单状态已变化，请刷新后重试");
  });
});
