import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

const oldIds = process.env.BUSINESS_WORKBENCH_MERCHANT_IDS;
const oldEnv = process.env.NODE_ENV;
const scope = { merchantId: 201, sellerUserId: 501 };
const merchant = {
  id: 201,
  merchantNo: "archive-mock-201",
  companyName: "归档集成测试企业",
  crmStatus: "enabled",
  registrationRegion: "CN",
  registrationIdentifier: null,
  businessLicense: "91310000MAH4E001XX",
  // Deliberately not the bound seller: owner impersonation must never be used.
  crmOwnerPortalUserId: "700",
};
const confirmedTuples = [
  [71001, "TEST-ORDER-0001"], [71003, "TEST-ORDER-0003"],
  [71004, "TEST-ORDER-0004"], [71005, "TEST-ORDER-0005"],
  [71006, "TEST-ORDER-0006"], [71007, "TEST-ORDER-0007"],
  [71008, "TEST-ORDER-0009"], [71009, "TEST-ORDER-0008"],
  [71010, "TEST-ORDER-0010"], [71011, "TEST-ORDER-0011"],
] as const;
function registry() {
  return confirmedTuples.map(([orderId, orderNo]) => ({ ...scope, orderId, orderNo, originalStatus: "cancel", isTest: 1, state: "archived" }));
}
function order(id = 71001, orderNo = "TEST-ORDER-0001", status = "cancel", sellerId = 501) {
  return { id, orderNo, sellerId, status, totalAmount: "100.00", properties: { original: true } };
}
function context(input: { merchantId?: number; session?: "local" | "oauth" | "anonymous" } = {}): TrpcContext {
  const now = new Date("2026-11-13T00:00:00.000Z");
  const session = input.session ?? "local";
  const local = session === "local";
  return {
    user: session === "anonymous" ? null : {
      id: local ? 303 : 404, openId: local ? "local_admin:303" : "oauth:404",
      name: "归档测试操作员", email: "archive@example.test", loginMethod: local ? "password" : "oauth",
      role: "admin", createdAt: now, updatedAt: now, lastSignedIn: now,
    },
    adminAccount: local ? {
      id: 303, userId: 0, username: "archive-test-operator", displayName: "归档测试操作员",
      email: "archive@example.test", phone: null, passwordHash: null, adminRole: "merchant_mgr",
      usernameCanonical: "archive-test-operator", sessionVersion: 1,
      lastLoginIpAddress: null, lastLoginIpHash: null, lastLoginLocation: null,
      lastLoginDevice: null, lastLoginDeviceHash: null, lastLoginMethod: null,
      securityRiskLevel: null, securityRiskReason: null, securityRiskAt: null,
      status: "active", mfaEnabled: false, lastLoginAt: now, createdAt: now, updatedAt: now,
    } : null,
    adminPermissions: [],
    req: { headers: { "x-business-merchant-id": String(input.merchantId ?? 201) }, protocol: "https", ip: "203.0.113.51" } as unknown as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

let permissions: string[] | null;
let staff: { adminUserId: number; frontUserId: number; bindingVersion: number } | null;
let dbMocks: Record<string, ReturnType<typeof vi.fn>>;
let execute: ReturnType<typeof vi.fn>;
let platformCall: ReturnType<typeof vi.fn>;
let businessRouter: typeof import("./businessRouter")["businessRouter"];
let publicError: typeof import("./platformBusinessApi")["PlatformBusinessPublicError"];
let events: string[];
let fenceHeld: boolean;

beforeEach(async () => {
  vi.resetModules();
  process.env.NODE_ENV = "test";
  process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = "201,30062";
  permissions = ["business.orders.read", "business.orders.write"];
  staff = { adminUserId: 303, frontUserId: 501, bindingVersion: 7 };
  events = [];
  fenceHeld = false;
  execute = vi.fn(async () => {
    expect(fenceHeld).toBe(true);
    events.push("metadata");
    return [registry(), []];
  });
  platformCall = vi.fn(async () => {
    expect(fenceHeld).toBe(true);
    events.push("platform");
    return [order()];
  });
  dbMocks = {
    withBusinessAuthorizationFence: vi.fn(async (_key: unknown, run: () => Promise<unknown>) => {
      fenceHeld = true;
      events.push("fence-enter");
      try { return await run(); } finally { fenceHeld = false; events.push("fence-exit"); }
    }),
    getActiveBusinessStaffBinding: vi.fn(async () => { events.push("staff"); return staff; }),
    getActiveBusinessMerchantScope: vi.fn(async (_adminId: number, merchantId: number) => {
      events.push("scope");
      return permissions === null ? null : { id: 10, adminUserId: 303, merchantId, scopeVersion: 3, modulePermissions: permissions };
    }),
    getBusinessWorkbenchMerchantById: vi.fn(async (id: number) => ({ ...merchant, id })),
    getDb: vi.fn(async () => ({ execute })),
    recordBusinessCommandAccess: vi.fn(async () => {
      expect(fenceHeld).toBe(true);
      events.push("audit");
    }),
  };
  vi.doMock("./db", () => dbMocks);
  // Original businessAccess, router, archive service and TRPCError remain real.
  // Only the DB and original platform transport are in-memory test doubles.
  vi.doMock("./platformBusinessApi", () => ({
    PlatformBusinessPublicError: class extends Error {
      constructor(readonly code: string, message: string) { super(message); }
    },
    PlatformBusinessServiceError: class extends Error {},
    callPlatformBusinessCommand: platformCall,
    getPlatformBusinessContext: vi.fn(),
    validatePlatformBusinessStaffCandidate: vi.fn(),
  }));
  ({ businessRouter } = await import("./businessRouter"));
  ({ PlatformBusinessPublicError: publicError } = await import("./platformBusinessApi"));
});

afterEach(() => {
  vi.doUnmock("./db");
  vi.doUnmock("./platformBusinessApi");
  vi.resetModules();
  if (oldIds === undefined) delete process.env.BUSINESS_WORKBENCH_MERCHANT_IDS;
  else process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = oldIds;
  if (oldEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = oldEnv;
});

describe("businessRouter sellerOrders archive integration (no real DB or platform)", () => {
  it("removes the 10 confirmed cancelled tuples while preserving the three shipped and all other rows", async () => {
    const shipped = [71002, 71012, 71013].map(id => order(id, `SHIPPED-${id}`, "shipped"));
    const other = [order(90200, "OTHER-90200"), order(71001, "WRONG-NUMBER"), order(71001, "TEST-ORDER-0001", "cancel", 397752)];
    const source = [...shipped.slice(0, 1), ...confirmedTuples.map(([id, no]) => order(id, no)), ...shipped.slice(1), ...other];
    platformCall.mockImplementation(async () => {
      expect(fenceHeld).toBe(true);
      events.push("platform");
      return source;
    });
    const result = await businessRouter.createCaller(context()).order.sellerOrders(undefined) as unknown[];
    expect(result).toEqual([...shipped, ...other]);
    result.forEach((row, index) => expect(row).toBe([...shipped, ...other][index]));
    expect(source).toHaveLength(16);
    expect(result).toHaveLength(6);
    expect(platformCall).toHaveBeenCalledWith(expect.objectContaining({ method: "order.sellerOrders", staffUserId: 501, bindingVersion: 7, binding: { creditCode: merchant.businessLicense, expectedOwnerUserId: 700 } }));
    expect(events).toEqual(["fence-enter", "staff", "scope", "scope", "platform", "metadata", "audit", "fence-exit"]);
    expect(dbMocks.recordBusinessCommandAccess).toHaveBeenCalledWith(expect.objectContaining({ merchantId: 201, staffUserId: 501, scopeVersion: 3, method: "order.sellerOrders" }));
  });

  it("uses proven merchant/bound seller, never forged browser params or owner/admin identity", async () => {
    const params = { merchantId: 30062, sellerId: 700, sellerUserId: 303, frontUserId: 1, method: "order.buyerOrders" };
    await expect(businessRouter.createCaller(context()).order.sellerOrders(params)).resolves.toEqual([]);
    const query = new MySqlDialect().sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(query.params).toEqual([201, 501]);
    expect(platformCall).toHaveBeenCalledWith(expect.objectContaining({ params, staffUserId: 501, method: "order.sellerOrders" }));
  });

  it("does not hide a registry tuple from another authorized merchant", async () => {
    const source = [order()];
    platformCall.mockResolvedValue(source);
    await expect(businessRouter.createCaller(context({ merchantId: 30062 })).order.sellerOrders(undefined)).resolves.toBe(source);
    expect(new MySqlDialect().sqlToQuery(execute.mock.calls[0][0] as SQL).params).toEqual([30062, 501]);
  });

  it("does not hide a registry tuple after the current staff binding changes seller", async () => {
    staff = { adminUserId: 303, frontUserId: 397752, bindingVersion: 8 };
    const source = [order()];
    platformCall.mockResolvedValue(source);
    await expect(businessRouter.createCaller(context()).order.sellerOrders(undefined)).resolves.toBe(source);
    expect(new MySqlDialect().sqlToQuery(execute.mock.calls[0][0] as SQL).params).toEqual([201, 397752]);
  });

  it("keeps restored rows and changed live status, with original properties intact", async () => {
    const source = [order(), order(71003, "TEST-ORDER-0003", "shipped")];
    platformCall.mockResolvedValue(source);
    execute.mockResolvedValue([registry().map(row => row.orderId === 71001 ? { ...row, state: "restored" } : row), []]);
    await expect(businessRouter.createCaller(context()).order.sellerOrders(undefined)).resolves.toBe(source);
  });

  it.each(["missing-db", "getDb-error", "query-error", "bad-shape", "bad-row"])("fails closed on metadata %s after platform success, before success audit", async kind => {
    if (kind === "missing-db") dbMocks.getDb.mockResolvedValue(null);
    if (kind === "getDb-error") dbMocks.getDb.mockRejectedValue(new Error("private-db-config"));
    if (kind === "query-error") execute.mockRejectedValue(new Error("missing business_test_order_archives; secret-password"));
    if (kind === "bad-shape") execute.mockResolvedValue([]);
    if (kind === "bad-row") execute.mockResolvedValue([[{ orderId: 71001 }], []]);
    await expect(businessRouter.createCaller(context()).order.sellerOrders(undefined)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(platformCall).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordBusinessCommandAccess).not.toHaveBeenCalled();
    expect(fenceHeld).toBe(false);
  });

  it.each([null, {}, { items: [order()] }])("rejects unexpected non-array original result %j before registry/audit", async result => {
    platformCall.mockResolvedValue(result);
    await expect(businessRouter.createCaller(context()).order.sellerOrders(undefined)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(execute).not.toHaveBeenCalled();
    expect(dbMocks.recordBusinessCommandAccess).not.toHaveBeenCalled();
  });

  it.each(["anonymous", "oauth"] as const)("retains %s session rejection without reading registry", async session => {
    await expect(businessRouter.createCaller(context({ session })).order.sellerOrders(undefined)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(platformCall).not.toHaveBeenCalled();
    expect(dbMocks.getDb).not.toHaveBeenCalled();
  });

  it.each(["missing-staff", "revoked-scope", "no-orders-permission", "wrong-merchant", "disabled-enterprise"])("retains original gate %s without platform/registry/audit", async kind => {
    if (kind === "missing-staff") staff = null;
    if (kind === "revoked-scope") permissions = null;
    if (kind === "no-orders-permission") permissions = ["business.inventory.read"];
    if (kind === "disabled-enterprise") dbMocks.getBusinessWorkbenchMerchantById.mockResolvedValue({ ...merchant, crmStatus: "disabled" });
    await expect(businessRouter.createCaller(context({ merchantId: kind === "wrong-merchant" ? 30063 : 201 })).order.sellerOrders(undefined)).rejects.toBeInstanceOf(Error);
    expect(platformCall).not.toHaveBeenCalled();
    expect(dbMocks.getDb).not.toHaveBeenCalled();
    expect(dbMocks.recordBusinessCommandAccess).not.toHaveBeenCalled();
  });

  it("retains real front seller permission failure; archive metadata cannot authorize it", async () => {
    platformCall.mockRejectedValue(new publicError("FORBIDDEN", "非卖方不可读"));
    await expect(businessRouter.createCaller(context()).order.sellerOrders(undefined)).rejects.toMatchObject({ code: "FORBIDDEN", message: "非卖方不可读" });
    expect(dbMocks.getDb).not.toHaveBeenCalled();
    expect(dbMocks.recordBusinessCommandAccess).not.toHaveBeenCalled();
  });

  it("retains upstream service failure without consulting registry", async () => {
    platformCall.mockRejectedValue(new Error("transport unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(businessRouter.createCaller(context()).order.sellerOrders(undefined)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      expect(dbMocks.getDb).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it.each(["tracks", "expressCos", "logistics", "refundDetail", "sellerCancel", "sellerConfirmPay", "ship"] as const)("does not query registry or filter other order method %s even if metadata DB is unavailable", async method => {
    const source = [order()];
    platformCall.mockResolvedValue(source);
    dbMocks.getDb.mockRejectedValue(new Error("metadata unavailable"));
    await expect(businessRouter.createCaller(context()).order[method]({ id: 71001 })).resolves.toBe(source);
    expect(dbMocks.getDb).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(dbMocks.recordBusinessCommandAccess).toHaveBeenCalledTimes(1);
  });

  it("does not affect other business modules", async () => {
    permissions = ["business.inventory.read"];
    const source = [order()];
    platformCall.mockResolvedValue(source);
    await expect(businessRouter.createCaller(context()).inventory.list(undefined)).resolves.toBe(source);
    expect(dbMocks.getDb).not.toHaveBeenCalled();
  });

  it("registers no new public archive/restore, buyer, contract or dynamic-method endpoint", () => {
    const procedures = businessRouter._def.procedures as unknown as Record<string, { _def: { type: string } }>;
    const names = Object.keys(procedures);
    expect(names).not.toContain("order.buyerOrders");
    expect(names).not.toContain("order.get");
    expect(names).not.toContain("order.contract");
    expect(names.filter(name => /testOrderArchive|^order\..*(archive|restore)|businessCommand|order\.\*/i.test(name))).toEqual([]);
    expect(procedures["order.sellerOrders"]._def.type).toBe("query");
  });
});
