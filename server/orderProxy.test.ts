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
      page: 1,
      pageSize: 20,
      keyword: "DZ202607010001",
    });

    expect(result.rows[0]).toMatchObject({ orderNo: "DZ202607010001", batchNo: null });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/trpc/internalOrder.list");
    expect((init.headers as Record<string, string>)["x-portal-key"]).toBe("server-only-test-key");
    expect(createContext("auditor").req.headers["x-portal-key"]).toBeUndefined();
  });

  it("无订单写权限的角色在调用商城前即被拒绝", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(appRouter.createCaller(createContext("customer_svc")).order.transition({
      orderId: 17,
      action: "cancel",
      reason: "客户申请",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("平台运营可执行受控状态操作且操作人由后台会话注入", async () => {
    const fetchMock = vi.fn().mockResolvedValue(trpcResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await appRouter.createCaller(createContext("operation")).order.transition({
      orderId: 23,
      action: "ship",
      expressCo: "顺丰",
      expressNo: "SF123456",
    });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/trpc/internalOrder.transition?batch=1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))["0"].json).toMatchObject({
      orderId: 23,
      action: "ship",
      operator: "order-tester",
    });
  });

  it("商城服务错误以可读错误返回后台而非降级到独立订单表", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      error: { json: { message: "订单状态已变化，请刷新后重试" } },
    }]), { status: 409 })));
    await expect(appRouter.createCaller(createContext("operation")).order.transition({
      orderId: 23,
      action: "complete",
    })).rejects.toThrow("订单状态已变化，请刷新后重试");
  });
});
