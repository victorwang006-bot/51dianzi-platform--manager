import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";

const originalWorkbenchIds = process.env.BUSINESS_WORKBENCH_MERCHANT_IDS;

class TestPlatformBusinessPublicError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

class TestPlatformBusinessServiceError extends Error {
  constructor(readonly kind: string) {
    super("主站业务服务暂不可用，请稍后重试");
  }
}

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
    PlatformBusinessPublicError: TestPlatformBusinessPublicError,
    PlatformBusinessServiceError: TestPlatformBusinessServiceError,
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

describe("BFF navigation availability", () => {
  it.each([
    ["network", new Error("network failure portal key=must-not-appear")],
    ["timeout", Object.assign(new Error("timeout cookie=must-not-appear"), { name: "TimeoutError" })],
    ["5xx", new Error("upstream 503 token=must-not-appear")],
    ["malformed upstream payload", new Error("invalid response SQL SELECT must-not-appear")],
  ])("单商户 %s 失败是受控 query error，而不是 HTTP200 空导航", async (_kind, upstreamError) => {
    getPlatformBusinessContext.mockRejectedValueOnce(upstreamError);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(businessRouter.createCaller(context()).navigation())
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "业务导航暂时不可用，请稍后重试" });

    const safeLog = JSON.stringify(log.mock.calls);
    expect(safeLog).not.toContain("must-not-appear");
    expect(safeLog).not.toContain("portal key");
    expect(safeLog).not.toContain("cookie");
    expect(safeLog).not.toContain("SELECT");
    expect(log).toHaveBeenCalledWith("[businessBff] navigation candidate", expect.objectContaining({
      candidateCount: 1,
      candidateOrdinal: 1,
      result: "UNAVAILABLE",
      identity: { adminAccountId: 303 },
      upstreamTiming: null,
    }));
  });

  it("成功候选日志记录关联 ID、身份、ordinal 和不含请求内容的上游分项耗时", async () => {
    getPlatformBusinessContext.mockImplementationOnce(async (
      _binding: unknown,
      _trustedBinding: unknown,
      options: { onUpstreamTiming?: (timing: { configMs: number; requestMs: number; decodeMs: number }) => void },
    ) => {
      options.onUpstreamTiming?.({ configMs: 1, requestMs: 8, decodeMs: 2 });
      return frontContext(["company.read"]);
    });
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    await expect(businessRouter.createCaller(context()).navigation()).resolves.toMatchObject({
      workbenchCapabilities: ["company.read"],
    });

    expect(log).toHaveBeenCalledWith("[businessBff] navigation candidate", expect.objectContaining({
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      identity: { adminAccountId: 303 },
      candidateCount: 1,
      candidateOrdinal: 1,
      result: "AVAILABLE",
      upstreamTiming: { configMs: 1, requestMs: 8, decodeMs: 2 },
    }));
  });

  it.each([
    ["真实上游 FORBIDDEN", () => getPlatformBusinessContext.mockRejectedValueOnce(new TestPlatformBusinessPublicError("FORBIDDEN", "无企业权限"))],
    ["scope 已撤销", () => dbMocks.getActiveBusinessMerchantScope.mockResolvedValueOnce(null)],
    ["ERP 未启用", () => dbMocks.getBusinessWorkbenchMerchantById.mockResolvedValueOnce({ ...merchant, crmStatus: "disabled" })],
    ["staff principal 未 ready", () => getPlatformBusinessContext.mockResolvedValueOnce({
      ...frontContext(["company.read"]),
      staffPrincipal: { status: "required", reason: "ADMIN_STAFF_PRINCIPAL_NOT_BOUND" },
    })],
    ["空 capability 投影", () => getPlatformBusinessContext.mockResolvedValueOnce(frontContext([]))],
  ])("%s 继续 fail closed，绝不授予业务入口", async (_kind, arrange) => {
    arrange();

    await expect(businessRouter.createCaller(context()).navigation()).resolves.toEqual({
      merchants: [],
      workbenchCapabilities: [],
      writeCapabilities: [],
    });
  });

  it("多商户有一方未知失败时拒绝整次导航，不能删除它后计算更宽交集", async () => {
    process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = "51,52";
    const secondMerchant = {
      ...merchant,
      id: 52,
      merchantNo: "scope-projection-52",
      companyName: "第二投影测试企业",
      businessLicense: "91310000MAH4E002XX",
      crmOwnerPortalUserId: "102",
    };
    dbMocks.listActiveBusinessMerchantScopes.mockResolvedValueOnce([
      { id: 10, adminUserId: 303, merchantId: 51, scopeVersion: 3, modulePermissions: scopePermissions },
      { id: 11, adminUserId: 303, merchantId: 52, scopeVersion: 4, modulePermissions: scopePermissions },
    ]);
    dbMocks.getActiveBusinessMerchantScope.mockImplementation(async (_accountId: number, merchantId: number) => ({
      id: merchantId === 51 ? 10 : 11,
      adminUserId: 303,
      merchantId,
      scopeVersion: merchantId === 51 ? 3 : 4,
      modulePermissions: scopePermissions,
    }));
    dbMocks.getBusinessWorkbenchMerchantById.mockImplementation(async (merchantId: number) => merchantId === 51 ? merchant : secondMerchant);
    getPlatformBusinessContext.mockImplementation(async (binding: { expectedOwnerUserId: number }) => {
      if (binding.expectedOwnerUserId === 102) throw new Error("unknown upstream failure");
      return frontContext(["company.read", "inventory.read"]);
    });

    await expect(businessRouter.createCaller(context()).navigation())
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("正常不同商户仍只返回精确 capability 交集", async () => {
    process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = "51,52";
    const secondMerchant = {
      ...merchant,
      id: 52,
      merchantNo: "scope-projection-52",
      companyName: "第二投影测试企业",
      businessLicense: "91310000MAH4E002XX",
      crmOwnerPortalUserId: "102",
    };
    scopePermissions = ["business.context.read", "business.inventory.read", "business.customers.read"];
    dbMocks.listActiveBusinessMerchantScopes.mockResolvedValueOnce([
      { id: 10, adminUserId: 303, merchantId: 51, scopeVersion: 3, modulePermissions: scopePermissions },
      { id: 11, adminUserId: 303, merchantId: 52, scopeVersion: 4, modulePermissions: scopePermissions },
    ]);
    dbMocks.getActiveBusinessMerchantScope.mockImplementation(async (_accountId: number, merchantId: number) => ({
      id: merchantId === 51 ? 10 : 11,
      adminUserId: 303,
      merchantId,
      scopeVersion: merchantId === 51 ? 3 : 4,
      modulePermissions: scopePermissions,
    }));
    dbMocks.getBusinessWorkbenchMerchantById.mockImplementation(async (merchantId: number) => merchantId === 51 ? merchant : secondMerchant);
    getPlatformBusinessContext.mockImplementation(async (binding: { expectedOwnerUserId: number }) => binding.expectedOwnerUserId === 101
      ? frontContext(["company.read", "inventory.read"])
      : frontContext(["company.read", "customers.manage"]));

    const navigation = await businessRouter.createCaller(context()).navigation();

    expect(navigation.merchants).toHaveLength(2);
    expect(navigation.workbenchCapabilities).toEqual(["company.read"]);
    expect(navigation.writeCapabilities).toEqual([]);
  });
});


describe("navigation scope lookup and observability safety", () => {
  it("候选范围读取失败受控返回503且不泄露原始错误或调用上游", async () => {
    dbMocks.listActiveBusinessMerchantScopes.mockRejectedValueOnce(new Error("SQL private-password private-cookie"));
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await expect(businessRouter.createCaller(context()).navigation()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE", message: "业务导航暂时不可用，请稍后重试",
    });
    expect(getPlatformBusinessContext).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|SQL/);
    expect(log).toHaveBeenCalledWith("[businessBff] navigation candidate", expect.objectContaining({
      candidateCount: 0, candidateOrdinal: 0, result: "UNAVAILABLE", scopeLookupMs: expect.any(Number),
    }));
  });
  it("日志不可用不改变原本成功的授权投影", async () => {
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("logging unavailable"); });
    const result = await businessRouter.createCaller(context()).navigation();
    expect(result.workbenchCapabilities).toEqual(["company.read", "inventory.read", "inquiry.receive"]);
  });
});
