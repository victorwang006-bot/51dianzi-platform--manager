import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { MetadataMemoryDb, METADATA_FIXTURE_ACTOR as actor, METADATA_FIXTURE_PROVENANCE as provenance } from "./services/businessSalesOrderMetadata.fixture";

const oldIds = process.env.BUSINESS_WORKBENCH_MERCHANT_IDS;
const oldEnv = process.env.NODE_ENV;
const merchant = {
  id: provenance.merchantId, merchantNo: "FICTIONAL-MERCHANT", companyName: "虚构metadata测试企业",
  crmStatus: "enabled", registrationRegion: "CN", registrationIdentifier: null,
  businessLicense: "FICTIONAL-BUSINESS-LICENSE-NOT-LIVE", crmOwnerPortalUserId: "999700",
};
const ctx = (input: { merchantId?: number; session?: "local" | "oauth" | "anonymous"; role?: string } = {}) => ({
  user: input.session === "anonymous" ? null : { id: 998303, role: "admin" },
  adminAccount: input.session === "anonymous" || input.session === "oauth" ? null : {
    id: actor.adminUserId, username: "fictional_metadata_actor", displayName: "虚构metadata操作员", adminRole: input.role ?? "merchant_mgr", status: "active",
  },
  adminPermissions: [],
  req: { headers: { "x-business-merchant-id": String(input.merchantId ?? provenance.merchantId) }, ip: "203.0.113.99" }, res: {},
}) as unknown as TrpcContext;
const receiver = (changes = {}) => ({ id: provenance.orderId, customerId: provenance.customerId, receiver: "虚构姓名", receiverPhone: "", receiverAddress: "", note: "", version: 0, requestId: "fictional_native_receiver_1", ...changes });
const caseInput = (changes = {}) => ({ id: provenance.orderId, customerId: provenance.customerId, kind: "consultation" as const, reason: "虚构咨询", requestId: "fictional_native_case_1", ...changes });

let permissions: string[] | null;
let staff: { adminUserId: number; frontUserId: number; bindingVersion: number } | null;
let memory: MetadataMemoryDb;
let events: string[];
let fenceHeld: boolean;
let mocks: Record<string, ReturnType<typeof vi.fn>>;
let platformCall: ReturnType<typeof vi.fn>;
let businessRouter: typeof import("./businessRouter")["businessRouter"];
let PublicError: typeof import("./platformBusinessApi")["PlatformBusinessPublicError"];
beforeEach(async () => {
  vi.resetModules();
  process.env.NODE_ENV = "test";
  process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = `${provenance.merchantId},991202`;
  permissions = ["business.orders.read", "business.orders.write", "business.customers.read"];
  staff = { adminUserId: actor.adminUserId, frontUserId: actor.frontUserId, bindingVersion: actor.bindingVersion };
  memory = new MetadataMemoryDb();
  events = [];
  fenceHeld = false;
  platformCall = vi.fn(async () => {
    expect(fenceHeld).toBe(true);
    events.push("original-get");
    return { id: provenance.orderId, orderNumber: provenance.orderNumber, customerId: provenance.customerId, enterpriseId: 777001 };
  });
  mocks = {
    withBusinessAuthorizationFence: vi.fn(async (_key: unknown, run: () => Promise<unknown>) => {
      fenceHeld = true;
      events.push("fence-enter");
      try { return await run(); } finally { fenceHeld = false; events.push("fence-exit"); }
    }),
    getActiveBusinessStaffBinding: vi.fn(async () => { events.push("staff"); return staff; }),
    getActiveBusinessMerchantScope: vi.fn(async (_admin: number, merchantId: number) => {
      events.push("scope");
      return permissions === null ? null : { id: 991010, adminUserId: actor.adminUserId, merchantId, scopeVersion: 3, modulePermissions: permissions };
    }),
    getBusinessWorkbenchMerchantById: vi.fn(async (id: number) => ({ ...merchant, id })),
    getDb: vi.fn(async () => { expect(fenceHeld).toBe(true); events.push("native-db"); return memory; }),
    recordBusinessCommandAccess: vi.fn(),
  };
  vi.doMock("./db", () => mocks);
  vi.doMock("./platformBusinessApi", () => ({
    PlatformBusinessPublicError: class extends Error { constructor(readonly code: string, message: string) { super(message); } },
    PlatformBusinessServiceError: class extends Error {}, callPlatformBusinessCommand: platformCall,
    getPlatformBusinessContext: vi.fn(), validatePlatformBusinessStaffCandidate: vi.fn(),
  }));
  ({ businessRouter } = await import("./businessRouter"));
  ({ PlatformBusinessPublicError: PublicError } = await import("./platformBusinessApi"));
});
afterEach(() => {
  vi.doUnmock("./db"); vi.doUnmock("./platformBusinessApi"); vi.resetModules();
  if (oldIds === undefined) delete process.env.BUSINESS_WORKBENCH_MERCHANT_IDS; else process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = oldIds;
  if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
});

describe("businessRouter local crmSalesOrder metadata authorization (fictional IO only)", () => {
  it("uses unchanged fence and original get before native DB, returns strict provenance without front audit", async () => {
    const result = await businessRouter.createCaller(ctx()).crmSalesOrder.metadataGet({ id: provenance.orderId, customerId: provenance.customerId });
    expect(result).toEqual({ ...provenance, receiver: null, afterSales: [] });
    expect(events).toEqual(["fence-enter", "staff", "scope", "scope", "original-get", "native-db", "fence-exit"]);
    expect(platformCall).toHaveBeenCalledWith(expect.objectContaining({
      method: "crmSalesOrder.get", params: { id: provenance.orderId, customerId: provenance.customerId },
      staffUserId: actor.frontUserId, bindingVersion: 7,
      adminActor: { id: actor.adminUserId, name: "虚构metadata操作员", role: "merchant_mgr" },
      binding: { creditCode: merchant.businessLicense, expectedOwnerUserId: 999700 },
    }));
    expect(mocks.recordBusinessCommandAccess).not.toHaveBeenCalled();
  });
  it("all three writes call only original get and record actor from fresh callback, never owner/browser", async () => {
    const caller = businessRouter.createCaller(ctx()).crmSalesOrder;
    const saved = await caller.saveReceiver(receiver());
    const added = await caller.addAfterSale(caseInput({ kind: "refund_request" }));
    const changed = await caller.updateAfterSale({ id: provenance.orderId, caseId: added.id, version: 1, status: "closed", resolution: "关闭意向记录", requestId: "fictional_native_update_1" });
    expect(saved.version).toBe(1);
    expect(changed.status).toBe("closed");
    expect(platformCall.mock.calls.map(call => call[0].method)).toEqual(["crmSalesOrder.get", "crmSalesOrder.get", "crmSalesOrder.get"]);
    expect(memory.state.audits).toHaveLength(3);
    memory.state.audits.forEach(row => expect(row).toMatchObject({ actorAdminId: actor.adminUserId, actorFrontUserId: actor.frontUserId, bindingVersion: 7, scopeVersion: 3 }));
    expect(mocks.recordBusinessCommandAccess).not.toHaveBeenCalled();
  });
  it("read-only original get and metadataGet do not grant any metadata write", async () => {
    permissions = ["business.orders.read", "business.customers.read"];
    await expect(businessRouter.createCaller(ctx()).crmSalesOrder.metadataGet({ id: provenance.orderId })).resolves.toMatchObject({ receiver: null });
    platformCall.mockClear(); mocks.getDb.mockClear();
    const caller = businessRouter.createCaller(ctx()).crmSalesOrder;
    await expect(caller.saveReceiver(receiver())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.addAfterSale(caseInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.updateAfterSale({ id: provenance.orderId, caseId: 1, version: 1, status: "closed", resolution: "", requestId: "fictional_readonly_1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(platformCall).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each(["missing-binding", "revoked-scope", "no-orders", "no-customer-intersection", "merchant-not-allowed"])("retains %s rejection before original get or metadata IO", async kind => {
    if (kind === "missing-binding") staff = null;
    if (kind === "revoked-scope") permissions = null;
    if (kind === "no-orders") permissions = ["business.customers.read"];
    if (kind === "no-customer-intersection") permissions = ["business.orders.read", "business.orders.write"];
    const context = ctx({ merchantId: kind === "merchant-not-allowed" ? 991999 : provenance.merchantId });
    await expect(businessRouter.createCaller(context).crmSalesOrder.metadataGet({ id: provenance.orderId })).rejects.toBeInstanceOf(Error);
    await expect(businessRouter.createCaller(context).crmSalesOrder.saveReceiver(receiver())).rejects.toBeInstanceOf(Error);
    expect(platformCall).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each(["anonymous", "oauth"] as const)("retains %s account rejection before metadata IO", async session => {
    await expect(businessRouter.createCaller(ctx({ session })).crmSalesOrder.metadataGet({ id: provenance.orderId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(platformCall).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("super-admin label cannot override revoked business scope", async () => {
    permissions = [];
    await expect(businessRouter.createCaller(ctx({ role: "super_admin" })).crmSalesOrder.saveReceiver(receiver())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each(["FORBIDDEN", "NOT_FOUND"] as const)("original get %s remains denial with no metadata read/write", async code => {
    platformCall.mockRejectedValue(new PublicError(code, "虚构原订单不可见"));
    await expect(businessRouter.createCaller(ctx()).crmSalesOrder.metadataGet({ id: provenance.orderId })).rejects.toMatchObject({ code });
    await expect(businessRouter.createCaller(ctx()).crmSalesOrder.saveReceiver(receiver())).rejects.toMatchObject({ code });
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(memory.state.audits).toEqual([]);
  });
  it("unavailable original transport is bounded and never reaches native DB", async () => {
    platformCall.mockRejectedValue(new Error("fictional-private-db-sql-path"));
    await expect(businessRouter.createCaller(ctx()).crmSalesOrder.addAfterSale(caseInput())).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "业务订单核验暂时不可用，请稍后重试", cause: undefined });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each([
    {}, { id: "991701", customerId: provenance.customerId, orderNumber: provenance.orderNumber },
    { id: provenance.orderId + 1, customerId: provenance.customerId, orderNumber: provenance.orderNumber },
    { id: provenance.orderId, customerId: provenance.customerId + 1, orderNumber: provenance.orderNumber },
    { id: provenance.orderId, customerId: provenance.customerId, orderNumber: "" },
  ])("rejects malformed/mismatched original order %j before metadata IO", async result => {
    platformCall.mockResolvedValue(result);
    await expect(businessRouter.createCaller(ctx()).crmSalesOrder.saveReceiver(receiver())).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each(["merchantId", "actorAdminId", "frontUserId", "bindingVersion", "method", "amount", "refundEvidence"])("strict input rejects forged field %s before authorization or SQL", async key => {
    await expect(businessRouter.createCaller(ctx()).crmSalesOrder.saveReceiver(receiver({ [key]: key === "method" ? "order.refund" : 1 }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(platformCall).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("retains disabled original enterprise binding precondition before upstream or metadata DB", async () => {
    mocks.getBusinessWorkbenchMerchantById.mockResolvedValue({ ...merchant, crmStatus: "disabled" });
    await expect(businessRouter.createCaller(ctx()).crmSalesOrder.metadataGet({ id: provenance.orderId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(platformCall).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("bounds raw authorization-fence/database errors without SQL, credentials or cause", async () => {
    mocks.withBusinessAuthorizationFence.mockRejectedValue(new Error("fictional-private-fence-sql-password"));
    await expect(businessRouter.createCaller(ctx()).crmSalesOrder.metadataGet({ id: provenance.orderId })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE", message: "业务订单信息授权核验暂时不可用，请稍后重试", cause: undefined,
    });
    expect(platformCall).not.toHaveBeenCalled(); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("fresh binding re-read attributes each new write to current front staff, but never changes original orders", async () => {
    const caller = businessRouter.createCaller(ctx()).crmSalesOrder;
    await caller.addAfterSale(caseInput());
    staff = { adminUserId: actor.adminUserId, frontUserId: 991502, bindingVersion: 8 };
    await caller.addAfterSale(caseInput({ requestId: "fictional_native_case_2" }));
    expect(memory.state.audits.map(row => row.actorFrontUserId)).toEqual([991501, 991502]);
    expect(platformCall.mock.calls.map(call => call[0].staffUserId)).toEqual([991501, 991502]);
    permissions = ["business.customers.read"];
    await expect(caller.addAfterSale(caseInput({ requestId: "fictional_native_case_3" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memory.state.cases).toHaveLength(2);
  });
  it("replay still requires current original get visibility before reading metadata request result", async () => {
    const caller = businessRouter.createCaller(ctx()).crmSalesOrder;
    await caller.saveReceiver(receiver());
    const before = structuredClone(memory.state);
    mocks.getDb.mockClear();
    platformCall.mockRejectedValue(new PublicError("FORBIDDEN", "虚构客户范围已收回"));
    await expect(caller.saveReceiver(receiver())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(memory.state).toEqual(before);
  });
  it("new metadata paths are fixed, native query/mutations; no financial or delete metadata method exists", () => {
    const procedures = businessRouter._def.procedures as unknown as Record<string, { _def: { type: string } }>;
    expect(procedures["crmSalesOrder.metadataGet"]._def.type).toBe("query");
    for (const method of ["saveReceiver", "addAfterSale", "updateAfterSale"]) expect(procedures[`crmSalesOrder.${method}`]._def.type).toBe("mutation");
    expect(Object.keys(procedures).filter(name => /^crmSalesOrder\.(metadata|saveReceiver|.*AfterSale)/.test(name)).sort()).toEqual([
      "crmSalesOrder.addAfterSale", "crmSalesOrder.metadataGet", "crmSalesOrder.saveReceiver", "crmSalesOrder.updateAfterSale",
    ]);
    expect(procedures["crmSalesOrder.deleteAfterSale"]).toBeUndefined();
  });
});
