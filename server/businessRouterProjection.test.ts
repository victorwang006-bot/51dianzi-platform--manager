import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const originalWorkbenchIds = process.env.BUSINESS_WORKBENCH_MERCHANT_IDS;

function context(): TrpcContext {
  const now = new Date("2026-10-30T00:00:00.000Z");
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
      username: "business-projection-operator",
      displayName: "后台业务人员",
      email: "operator@example.test",
      phone: null,
      passwordHash: null,
      adminRole: "merchant_mgr",
      status: "active",
      mfaEnabled: false,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    },
    adminPermissions: [],
    req: {
      headers: { "x-business-merchant-id": "51" },
      protocol: "https",
      ip: "203.0.113.51",
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const merchant = {
  id: 51,
  merchantNo: "scope-projection-51",
  companyName: "投影测试企业",
  crmStatus: "enabled",
  registrationRegion: "CN",
  registrationIdentifier: null,
  businessLicense: "91310000MAH4E001XX",
  crmOwnerPortalUserId: "101",
};

function frontContext(capabilities: string[]) {
  const now = new Date("2026-10-30T00:00:00.000Z");
  return {
    enterpriseId: 1,
    companyName: "投影测试企业",
    dataOwnerUserId: 404,
    ownerUserId: 101,
    staffPrincipal: {
      status: "ready" as const,
      frontendUserId: 202,
      user: {
        id: 202,
        openId: "front:202",
        username: "front-staff",
        name: "前台员工",
        email: "staff@example.test",
        phone: null,
        role: "user" as const,
        loginDisabled: false,
        crmAccess: true,
        createdAt: now,
        updatedAt: now,
        lastSignedIn: now,
        hasPassword: true,
        emailVerified: true,
      },
      adminAccountId: 303,
      enterpriseId: 1,
      bindingVersion: 7,
    },
    // Deliberately raw/full: the BFF must never return these arrays unchanged.
    enabledModules: capabilities,
    workbenchCapabilities: capabilities,
    sessionCapabilities: { chat: false as const, receptionReady: true },
  };
}

let scopePermissions: string[];
let dbMocks: Record<string, ReturnType<typeof vi.fn>>;
let getPlatformBusinessContext: ReturnType<typeof vi.fn>;
let businessRouter: typeof import("./businessRouter")["businessRouter"];

beforeEach(async () => {
  process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = "51";
  scopePermissions = ["business.context.read", "business.inventory.read"];
  getPlatformBusinessContext = vi.fn().mockResolvedValue(frontContext([
    "company.read",
    "inventory.read",
    "inventory.publish",
    "inquiry.receive",
    "customers.manage",
  ]));
  dbMocks = {
    withBusinessAuthorizationFence: vi.fn(async (_key: unknown, operation: () => Promise<unknown>) => operation()),
    getActiveBusinessStaffBinding: vi.fn().mockResolvedValue({
      id: 9,
      adminUserId: 303,
      frontUserId: 202,
      bindingVersion: 7,
    }),
    getActiveBusinessMerchantScope: vi.fn().mockImplementation(async () => ({
      id: 10,
      adminUserId: 303,
      merchantId: 51,
      scopeVersion: 3,
      modulePermissions: scopePermissions,
    })),
    listActiveBusinessMerchantScopes: vi.fn().mockImplementation(async () => [{
      id: 10,
      adminUserId: 303,
      merchantId: 51,
      scopeVersion: 3,
      modulePermissions: scopePermissions,
    }]),
    getBusinessWorkbenchMerchantById: vi.fn().mockResolvedValue(merchant),
    getBusinessWorkbenchMerchants: vi.fn().mockResolvedValue({ data: [merchant], total: 1 }),
    recordBusinessContextAccess: vi.fn().mockResolvedValue(undefined),
  };

  vi.resetModules();
  vi.doMock("./db", () => dbMocks);
  vi.doMock("./platformBusinessApi", () => ({
    PlatformBusinessPublicError: class PlatformBusinessPublicError extends Error {},
    callPlatformBusinessCommand: vi.fn(),
    getPlatformBusinessContext,
    validatePlatformBusinessStaffCandidate: vi.fn(),
  }));
  ({ businessRouter } = await import("./businessRouter"));
});

afterEach(() => {
  vi.doUnmock("./db");
  vi.doUnmock("./platformBusinessApi");
  vi.resetModules();
  if (originalWorkbenchIds === undefined) delete process.env.BUSINESS_WORKBENCH_MERCHANT_IDS;
  else process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = originalWorkbenchIds;
});

describe("BFF workbench projection response", () => {
  it("selected context 对 raw enabledModules/workbenchCapabilities 取 scope 交集，并把 receptionReady 一并收紧", async () => {
    const result = await businessRouter.createCaller(context()).context();

    expect(result.enabledModules).toEqual(["company.read", "inventory.read", "inquiry.receive"]);
    expect(result.workbenchCapabilities).toEqual(["company.read", "inventory.read", "inquiry.receive"]);
    expect(result.writeCapabilities).toEqual([]);
    expect(result.merchant).toMatchObject({
      available: true,
      canWrite: false,
      workbenchCapabilities: ["company.read", "inventory.read", "inquiry.receive"],
      writeCapabilities: [],
    });
    expect(result.sessionCapabilities).toEqual({ chat: false, receptionReady: true });
    expect(dbMocks.recordBusinessContextAccess).toHaveBeenCalledWith(51, expect.any(Object), {
      requestId: expect.any(String),
      bindingVersion: 7,
      scopeVersion: 3,
    });
  });

  it("navigation 和 merchant choice 返回单商户 exact read/write capability，不以 true 固定 canWrite", async () => {
    scopePermissions = ["business.context.read", "business.inventory.write"];
    getPlatformBusinessContext.mockResolvedValue(frontContext([
      "company.read",
      "inventory.read",
      "inventory.publish",
      "inventory.inbound",
    ]));

    const caller = businessRouter.createCaller(context());
    const [navigation, merchants] = await Promise.all([caller.navigation(), caller.merchants({})]);

    expect(navigation.workbenchCapabilities).toEqual(["company.read", "inventory.publish"]);
    expect(navigation.writeCapabilities).toEqual(["inventory.publish"]);
    expect(navigation.merchants).toHaveLength(1);
    expect(navigation.merchants[0]).toMatchObject({
      canWrite: true,
      workbenchCapabilities: ["company.read", "inventory.publish"],
      writeCapabilities: ["inventory.publish"],
    });
    expect(merchants.data[0]).toMatchObject({
      canWrite: true,
      workbenchCapabilities: ["company.read", "inventory.publish"],
      writeCapabilities: ["inventory.publish"],
    });
  });
});
