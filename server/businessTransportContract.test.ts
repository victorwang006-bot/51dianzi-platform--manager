import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { callPlatformBusinessCommand } from "./platformBusinessApi";

const testBaseUrl = "http://platform.invalid";
const testPortalKey = "stripenv-platform-business-key";
const originalBaseUrl = process.env.PLATFORM_API_BASE;
const originalPortalKey = process.env.PORTAL_API_KEY;

function trpcSuccess(data: unknown) {
  return new Response(JSON.stringify([{ result: { data: { json: data } } }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function projectionContext(): TrpcContext {
  const now = new Date("2026-10-29T00:00:00.000Z");
  return {
    user: {
      id: 303,
      openId: "local_admin:303",
      name: "后台业务人员",
      email: "operator@example.test",
      loginMethod: "password",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    adminAccount: {
      id: 303,
      userId: 0,
      username: "business-operator",
      displayName: "后台业务人员",
      email: "operator@example.test",
      phone: null,
      passwordHash: null,
      adminRole: "merchant_mgr",
      status: "active",
      sessionVersion: 1,
      mfaEnabled: false,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    },
    // Workbench scope is independent from this native permission array.
    adminPermissions: [],
    req: {
      headers: { "x-business-merchant-id": "51" },
      protocol: "https",
      ip: "203.0.113.51",
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => {
  process.env.PLATFORM_API_BASE = testBaseUrl;
  process.env.PORTAL_API_KEY = testPortalKey;
});

afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.PLATFORM_API_BASE;
  else process.env.PLATFORM_API_BASE = originalBaseUrl;
  if (originalPortalKey === undefined) delete process.env.PORTAL_API_KEY;
  else process.env.PORTAL_API_KEY = originalPortalKey;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock("./db");
  vi.doUnmock("./businessAccess");
  vi.doUnmock("./platformBusinessApi");
  vi.resetModules();
});

describe("业务 BFF 传输与投影契约", () => {
  it("把服务端企业 binding 扁平化到 internalBusiness.execute POST payload，绝不嵌套或带浏览器凭据", async () => {
    const fetchMock = vi.fn().mockResolvedValue(trpcSuccess({ accepted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(callPlatformBusinessCommand({
      binding: { creditCode: "91310000MAH4E001XX", expectedOwnerUserId: 101 },
      staffUserId: 202,
      bindingVersion: 7,
      adminActor: { id: 303, name: "后台业务人员", role: "merchant_mgr" },
      requestId: "request-0001",
      method: "inventory.refreshStatus",
      params: { inventoryId: 9 },
    })).resolves.toEqual({ accepted: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${testBaseUrl}/api/trpc/internalBusiness.execute?batch=1`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBeUndefined();
    expect((init.headers as Record<string, string>)["x-portal-key"]).toBe(testPortalKey);

    const payload = JSON.parse(String(init.body))["0"].json;
    expect(payload).toEqual({
      creditCode: "91310000MAH4E001XX",
      expectedOwnerUserId: 101,
      staffUserId: 202,
      bindingVersion: 7,
      adminActor: { id: 303, name: "后台业务人员", role: "merchant_mgr" },
      requestId: "request-0001",
      method: "inventory.refreshStatus",
      params: { inventoryId: 9 },
    });
    expect(payload).not.toHaveProperty("binding");
  });

  it("auth.me 是 front staffPrincipal.user 的只读投影，而不是可委托业务 method", async () => {
    const nativeAccount = projectionContext().adminAccount!;
    const getAdminUserById = vi.fn(async (id: number) => id === nativeAccount.id ? nativeAccount : undefined);
    // Profile projection has no native inventory grant: read/write/note all stay false.
    const getAdminUserPermissions = vi.fn(async (_id: number) => []);
    const getActiveBusinessStaffBinding = vi.fn().mockResolvedValue({ adminUserId: 303, frontUserId: 202, status: "active", bindingVersion: 7 });
    const getActiveBusinessMerchantScope = vi.fn().mockResolvedValue({
      adminUserId: 303,
      merchantId: 51,
      status: "active",
      scopeVersion: 3,
      modulePermissions: ["business.context.read"],
    });
    const withBusinessAuthorizationFence = vi.fn(async (_key: unknown, operation: () => Promise<unknown>) => operation());
    const frontStaffUser = {
      id: 202,
      openId: "front:202",
      username: "front-staff",
      name: "前台员工",
      email: "staff@example.test",
      phone: null,
      role: "user" as const,
      loginDisabled: false,
      crmAccess: true,
      createdAt: new Date("2026-10-29T00:00:00.000Z"),
      updatedAt: new Date("2026-10-29T00:00:00.000Z"),
      lastSignedIn: new Date("2026-10-29T00:00:00.000Z"),
      hasPassword: true,
      emailVerified: true,
    };
    const getPlatformBusinessContext = vi.fn().mockResolvedValue({
      enterpriseId: 501,
      companyName: "测试企业",
      dataOwnerUserId: 404,
      ownerUserId: 101,
      staffPrincipal: {
        status: "ready",
        frontendUserId: 202,
        user: frontStaffUser,
        adminAccountId: 303,
        enterpriseId: 501,
        bindingVersion: 7,
      },
      enabledModules: ["inventory.read"],
      workbenchCapabilities: ["inventory.read"],
      sessionCapabilities: { chat: false },
    });

    vi.resetModules();
    vi.doMock("./db", () => ({
      getAdminUserById,
      getAdminUserPermissions,
      getActiveBusinessStaffBinding,
      getActiveBusinessMerchantScope,
      withBusinessAuthorizationFence,
    }));
    vi.doMock("./businessAccess", async (importOriginal) => ({
      // Keep real active-account validation and live native read/write/note resolution.
      ...await importOriginal<typeof import("./businessAccess")>(),
      BUSINESS_ADMIN_PERMISSIONS: ["business.context.read"],
      assertBusinessMerchantAccess: vi.fn().mockResolvedValue({ id: 51 }),
      businessEnterpriseBindingFromMerchant: vi.fn().mockReturnValue({ creditCode: "91310000MAH4E001XX", expectedOwnerUserId: 101 }),
      businessMerchantIdFromContext: vi.fn().mockReturnValue(51),
      getBusinessWorkbenchMerchantIds: vi.fn().mockReturnValue([51]),
      requireBusinessBindingManager: vi.fn(),
      toBusinessMerchantChoice: vi.fn(),
    }));
    vi.doMock("./platformBusinessApi", () => ({
      PlatformBusinessPublicError: class PlatformBusinessPublicError extends Error {},
      callPlatformBusinessCommand: vi.fn(),
      getPlatformBusinessContext,
      validatePlatformBusinessStaffCandidate: vi.fn(),
    }));

    const { businessRouter } = await import("./businessRouter");
    const projection = await businessRouter.createCaller(projectionContext()).auth.me();

    expect(projection).toEqual(frontStaffUser);
    expect(getAdminUserById).toHaveBeenCalledWith(303);
    expect(getAdminUserPermissions).toHaveBeenCalledWith(303);
    expect(getActiveBusinessStaffBinding).toHaveBeenCalledWith(303);
    expect(getActiveBusinessMerchantScope).toHaveBeenCalledWith(303, 51);
    expect(getPlatformBusinessContext).toHaveBeenCalledWith(
      { creditCode: "91310000MAH4E001XX", expectedOwnerUserId: 101 },
      { staffUserId: 202, adminAccountId: 303, bindingVersion: 7 },
    );
    expect(projection).toMatchObject({ id: 202, role: "user" });
    expect(projection).not.toHaveProperty("dataOwnerUserId");
  });

  it("sellerCancel 与 approveRefund 只在 router metadata 中核对为 mutation，不执行金融 provider", async () => {
    const { businessRouter } = await import("./businessRouter");
    const procedures = businessRouter._def.procedures;

    expect(procedures["order.sellerCancel"]?._def.type).toBe("mutation");
    expect(procedures["order.approveRefund"]?._def.type).toBe("mutation");
  });
});
