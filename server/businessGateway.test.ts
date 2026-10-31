import { describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { businessAccessTestUtils } from "./businessAccess";
import { businessGatewayAllowedOrigins, isBusinessGatewayOriginAllowed } from "./businessGateway";
import { businessRouter } from "./businessRouter";

function businessContext(input: { local?: boolean; permissions?: string[] } = {}): TrpcContext {
  const now = new Date("2026-10-29T00:00:00.000Z");
  const local = input.local ?? true;
  return {
    user: {
      id: 9123,
      openId: local ? "local_admin:9123" : "oauth:9123",
      name: "业务网关测试员工",
      email: "business-gateway@example.com",
      loginMethod: local ? "password" : "oauth",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    adminAccount: local ? {
      id: 9123,
      userId: 0,
      username: "business-gateway-test",
      displayName: "业务网关测试员工",
      email: "business-gateway@example.com",
      phone: null,
      passwordHash: null,
      adminRole: "merchant_mgr",
      status: "active",
      mfaEnabled: false,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    } : null,
    adminPermissions: input.permissions ?? [],
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("业务BFF安全边界", () => {
  it("BFF allowlist 默认空拒绝，生产仅精确接受商户 30061", () => {
    expect(businessAccessTestUtils.getBusinessWorkbenchMerchantIds({})).toEqual([]);
    expect(businessAccessTestUtils.getBusinessWorkbenchMerchantIds({
      NODE_ENV: "production",
      BUSINESS_WORKBENCH_MERCHANT_IDS: "30061",
    })).toEqual([30061]);
    expect(businessAccessTestUtils.getBusinessWorkbenchMerchantIds({
      NODE_ENV: "production",
      BUSINESS_WORKBENCH_MERCHANT_IDS: "30061,30062",
    })).toEqual([]);
    expect(businessAccessTestUtils.businessScopePermission("orders", "write")).toBe("business.orders.write");
    expect(businessAccessTestUtils.businessScopeAllows(
      { modulePermissions: ["business.orders.write"] },
      "orders",
      "write",
    )).toBe(true);
  });

  it("只接受单一正整数商户头，拒绝数组、逗号和零", () => {
    expect(businessAccessTestUtils.parseBusinessMerchantId("51")).toBe(51);
    for (const value of ["0", " 1,2", ["1", "2"], "abc", undefined]) {
      expect(() => businessAccessTestUtils.parseBusinessMerchantId(value)).toThrow();
    }
  });

  it("生产环境的非GET请求必须来自显式配置的同源白名单", () => {
    const env = {
      NODE_ENV: "production",
      ADMIN_BUSINESS_TRPC_ALLOWED_ORIGINS: "https://admin.51dianzi.com",
    } as NodeJS.ProcessEnv;
    expect(businessGatewayAllowedOrigins(env)).toEqual(new Set(["https://admin.51dianzi.com"]));
    expect(isBusinessGatewayOriginAllowed("POST", "https://admin.51dianzi.com", env)).toBe(true);
    expect(isBusinessGatewayOriginAllowed("POST", "https://evil.example", env)).toBe(false);
    expect(isBusinessGatewayOriginAllowed("POST", undefined, env)).toBe(false);
    expect(isBusinessGatewayOriginAllowed("GET", undefined, env)).toBe(true);
  });

  it("业务路由在访问任何 scope 或商户前拒绝 OAuth 兼容会话", async () => {
    await expect(businessRouter.createCaller(businessContext({ local: false })).merchants({}))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
