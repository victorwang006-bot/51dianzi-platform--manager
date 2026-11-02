import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => ({
  createPortalMessage: vi.fn(),
  getMessageThreads: vi.fn(),
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    createPortalMessage: mocks.createPortalMessage,
    getMessageThreads: mocks.getMessageThreads,
  };
});

import { appRouter } from "./routers";

const originalPortalKey = process.env.PORTAL_API_KEY;
const portalKey = "order-consultation-router-test-key";
const orderInput = {
  clientMessageId: "order-42-20261102",
  subject: "订货咨询 - 测试用户",
  contactName: "测试用户",
  contactPhone: "13800138000",
  contactEmail: "test@example.com",
  portalUserId: "42",
  threadType: "order_consultation" as const,
  companyProfile: { companyName: "深圳测试电子有限公司" },
  content: "请工作人员联系确认所需型号、数量与期望交期。",
};

function portalContext(key?: string): TrpcContext {
  return {
    user: null,
    adminAccount: null,
    adminPermissions: [],
    req: { protocol: "https", headers: key ? { "x-portal-key": key } : {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function nativeAdminContext(permissions: string[]): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "local_admin:7",
      email: null,
      name: "受限后台用户",
      loginMethod: "password",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as NonNullable<TrpcContext["user"]>,
    adminAccount: {
      id: 7,
      userId: 7,
      username: "limited-admin",
      usernameCanonical: "limited-admin",
      displayName: "受限后台用户",
      email: null,
      phone: null,
      passwordHash: null,
      adminRole: "merchant_mgr",
      status: "active",
      sessionVersion: 1,
      mfaEnabled: false,
      lastLoginAt: null,
      lastLoginIpAddress: null,
      lastLoginIpHash: null,
      lastLoginLocation: null,
      lastLoginDevice: null,
      lastLoginDeviceHash: null,
      lastLoginMethod: null,
      securityRiskLevel: null,
      securityRiskReason: null,
      securityRiskAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    adminPermissions: permissions,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("订货咨询后台路由", () => {
  beforeAll(() => {
    process.env.PORTAL_API_KEY = portalKey;
  });

  afterAll(() => {
    process.env.PORTAL_API_KEY = originalPortalKey;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPortalMessage.mockResolvedValue({
      threadNo: "MT202611020001",
      threadId: 501,
      messageId: 601,
      deduplicated: false,
    });
    mocks.getMessageThreads.mockResolvedValue({ items: [], total: 0 });
  });

  it("缺少 portal key 时拒绝创建订货咨询", async () => {
    await expect(
      appRouter.createCaller(portalContext()).portal.submitMessage(orderInput),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.createPortalMessage).not.toHaveBeenCalled();
  });

  it("持有 portal key 时只把独立 order_consultation 交给持久化层", async () => {
    const result = await appRouter
      .createCaller(portalContext(portalKey))
      .portal.submitMessage(orderInput);

    expect(result).toMatchObject({ threadNo: "MT202611020001", deduplicated: false });
    expect(mocks.createPortalMessage).toHaveBeenCalledWith(orderInput);
  });

  it("订货咨询不能附加到或改写既有 service/inquiry 线程", async () => {
    await expect(
      appRouter.createCaller(portalContext(portalKey)).portal.submitMessage({
        ...orderInput,
        threadNo: "MT202611010001",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.createPortalMessage).not.toHaveBeenCalled();
  });

  it("消息列表将订货类型原样交给 messages.read 授权后的筛选器", async () => {
    const caller = appRouter.createCaller(nativeAdminContext(["messages.read"]));

    await expect(caller.message.threads({
      page: 1,
      pageSize: 20,
      threadType: "order_consultation",
    })).resolves.toEqual({ items: [], total: 0 });
    expect(mocks.getMessageThreads).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      status: undefined,
      threadType: "order_consultation",
      keyword: undefined,
    });
  });

  it("没有 messages.read 的后台账号不能筛选或读取订货咨询", async () => {
    const caller = appRouter.createCaller(nativeAdminContext(["orders.read"]));

    await expect(caller.message.threads({
      page: 1,
      pageSize: 20,
      threadType: "order_consultation",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getMessageThreads).not.toHaveBeenCalled();
  });
});
