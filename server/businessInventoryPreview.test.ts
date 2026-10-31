import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const originalWorkbenchIds = process.env.BUSINESS_WORKBENCH_MERCHANT_IDS;
const originalNodeEnv = process.env.NODE_ENV;

const merchant = {
  id: 51,
  merchantNo: "inventory-preview-51",
  companyName: "库存预览测试企业",
  crmStatus: "enabled",
  registrationRegion: "CN",
  registrationIdentifier: null,
  businessLicense: "91310000MAH4E001XX",
  crmOwnerPortalUserId: "101",
};

function businessContext(input: {
  merchantId?: number;
  session?: "local" | "oauth" | "anonymous";
} = {}): TrpcContext {
  const now = new Date("2026-10-30T00:00:00.000Z");
  const session = input.session ?? "local";
  const local = session === "local";
  return {
    user: session === "anonymous" ? null : {
      id: local ? 303 : 404,
      openId: local ? "local_admin:303" : "oauth:404",
      name: local ? "后台库存操作员" : "OAuth 兼容管理员",
      email: local ? "inventory-operator@example.test" : "oauth@example.test",
      loginMethod: local ? "password" : "oauth",
      role: "admin",
      createdAt: now,
      updatedAt: now,
      lastSignedIn: now,
    },
    adminAccount: local ? {
      id: 303,
      userId: 0,
      username: "inventory-preview-operator",
      displayName: "后台库存操作员",
      email: "inventory-operator@example.test",
      phone: null,
      passwordHash: null,
      adminRole: "merchant_mgr",
      status: "active",
      mfaEnabled: false,
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
    } : null,
    adminPermissions: [],
    req: {
      headers: { "x-business-merchant-id": String(input.merchantId ?? 51) },
      protocol: "https",
      ip: "203.0.113.51",
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

let scopePermissions: string[] | null;
let staffBinding: { adminUserId: number; frontUserId: number; bindingVersion: number } | null;
let dbMocks: Record<string, ReturnType<typeof vi.fn>>;
let callPlatformBusinessCommand: ReturnType<typeof vi.fn>;
let businessRouter: typeof import("./businessRouter")["businessRouter"];

beforeEach(async () => {
  process.env.NODE_ENV = "test";
  process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = "51";
  scopePermissions = ["business.inventory.write"];
  staffBinding = { adminUserId: 303, frontUserId: 202, bindingVersion: 7 };
  callPlatformBusinessCommand = vi.fn().mockResolvedValue({ rows: [{ row: 1, valid: true }] });

  // These in-memory test doubles intentionally replace the MySQL db and platform
  // transport. businessAccess itself remains the original module and uses this db
  // shape only to exercise its real exact-merchant and scope gates.
  dbMocks = {
    withBusinessAuthorizationFence: vi.fn(async (_key: unknown, operation: () => Promise<unknown>) => operation()),
    getActiveBusinessStaffBinding: vi.fn().mockImplementation(async () => staffBinding),
    getActiveBusinessMerchantScope: vi.fn().mockImplementation(async () => scopePermissions === null ? null : ({
      id: 10,
      adminUserId: 303,
      merchantId: 51,
      scopeVersion: 3,
      modulePermissions: scopePermissions,
    })),
    getBusinessWorkbenchMerchantById: vi.fn().mockResolvedValue(merchant),
    recordBusinessCommandAccess: vi.fn().mockResolvedValue(undefined),
  };

  vi.resetModules();
  vi.doMock("./db", () => dbMocks);
  vi.doMock("./platformBusinessApi", () => ({
    PlatformBusinessPublicError: class PlatformBusinessPublicError extends Error {},
    callPlatformBusinessCommand,
    getPlatformBusinessContext: vi.fn(),
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
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("importInventory.previewRows 固定 BFF", () => {
  it("以真实 businessRouter.createCaller 注册固定 mutation，不存在动态或通配入口", async () => {
    const procedures = businessRouter._def.procedures as Record<string, { _def?: { type?: string } }>;

    expect(procedures["importInventory.previewRows"]?._def?.type).toBe("mutation");
    expect(procedures["importInventory.*"]).toBeUndefined();
    expect(procedures["importInventory.execute"]).toBeUndefined();

    await expect(businessRouter.createCaller(businessContext()).importInventory.previewRows({
      jobId: "preview-job-51",
    })).resolves.toEqual({ rows: [{ row: 1, valid: true }] });
  });

  it("仅转发固定方法、原 params，并使用绑定 frontUserId 而非后台账号或商户 owner", async () => {
    const params = {
      jobId: "preview-job-51",
      rowIds: [1, 3],
      // Browser-provided fields stay ordinary original params; none controls the
      // fixed command identity, namespace, original scope, or bound staff actor.
      namespace: "enterprise",
      method: "enterprise.transferOwnership",
      scope: { modulePermissions: ["business.users.write"] },
      staffUserId: 999,
      frontUserId: 998,
    };

    const result = await businessRouter.createCaller(businessContext()).importInventory.previewRows(params);

    expect(result).toEqual({ rows: [{ row: 1, valid: true }] });
    expect(callPlatformBusinessCommand).toHaveBeenCalledTimes(1);
    expect(callPlatformBusinessCommand).toHaveBeenCalledWith({
      binding: { creditCode: "91310000MAH4E001XX", expectedOwnerUserId: 101 },
      staffUserId: 202,
      bindingVersion: 7,
      adminActor: { id: 303, name: "后台库存操作员", role: "merchant_mgr" },
      requestId: expect.any(String),
      method: "importInventory.previewRows",
      params,
    });
    expect(callPlatformBusinessCommand.mock.calls[0][0]).toMatchObject({
      method: "importInventory.previewRows",
      staffUserId: 202,
    });
    expect(callPlatformBusinessCommand.mock.calls[0][0].staffUserId).not.toBe(303);
    expect(callPlatformBusinessCommand.mock.calls[0][0].staffUserId).not.toBe(101);

    // Success writes only the established command-access audit with authoritative
    // binding and scope versions; the browser cannot submit an audit identity.
    expect(dbMocks.recordBusinessCommandAccess).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordBusinessCommandAccess).toHaveBeenCalledWith({
      merchantId: 51,
      staffUserId: 202,
      bindingVersion: 7,
      scopeVersion: 3,
      method: "importInventory.previewRows",
      requestId: expect.any(String),
      actor: {
        operatorId: 303,
        operatorName: "后台库存操作员",
        operatorRole: "merchant_mgr",
        ipAddress: "203.0.113.51",
        userAgent: null,
      },
    });
  });

  it.each([
    ["匿名会话", "anonymous"],
    ["OAuth 兼容会话", "oauth"],
  ] as const)("沿用原 businessAccess 门卫拒绝%s", async (_label, session) => {
    await expect(businessRouter.createCaller(businessContext({ session })).importInventory.previewRows({ jobId: "p" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(callPlatformBusinessCommand).not.toHaveBeenCalled();
    expect(dbMocks.recordBusinessCommandAccess).not.toHaveBeenCalled();
  });

  it("未绑定前台员工主体时拒绝，不调用平台或记录审计", async () => {
    staffBinding = null;

    await expect(businessRouter.createCaller(businessContext()).importInventory.previewRows({ jobId: "p" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(callPlatformBusinessCommand).not.toHaveBeenCalled();
    expect(dbMocks.recordBusinessCommandAccess).not.toHaveBeenCalled();
  });

  it("没有原 business.inventory.write scope 时拒绝", async () => {
    scopePermissions = ["business.inventory.read"];

    await expect(businessRouter.createCaller(businessContext()).importInventory.previewRows({ jobId: "p" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(callPlatformBusinessCommand).not.toHaveBeenCalled();
    expect(dbMocks.recordBusinessCommandAccess).not.toHaveBeenCalled();
  });

  it("仅精确允许清单商户可用；清单外商户不会被请求参数越权", async () => {
    await expect(businessRouter.createCaller(businessContext({ merchantId: 52 })).importInventory.previewRows({
      jobId: "p",
      merchantId: 51,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(callPlatformBusinessCommand).not.toHaveBeenCalled();
    expect(dbMocks.recordBusinessCommandAccess).not.toHaveBeenCalled();
  });

  it("没有有效商户 scope 时拒绝，即使固定 allowlist 中存在该商户", async () => {
    scopePermissions = null;

    await expect(businessRouter.createCaller(businessContext()).importInventory.previewRows({ jobId: "p" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(callPlatformBusinessCommand).not.toHaveBeenCalled();
    expect(dbMocks.recordBusinessCommandAccess).not.toHaveBeenCalled();
  });

  it("持有原 business.inventory.write scope 时成功，且只记录原命令审计", async () => {
    await expect(businessRouter.createCaller(businessContext()).importInventory.previewRows({ jobId: "allowed" }))
      .resolves.toEqual({ rows: [{ row: 1, valid: true }] });

    expect(callPlatformBusinessCommand).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordBusinessCommandAccess).toHaveBeenCalledTimes(1);
    expect(Object.keys(dbMocks).filter(key => key.startsWith("record"))).toEqual(["recordBusinessCommandAccess"]);
  });
});
