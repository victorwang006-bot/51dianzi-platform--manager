import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import { validateBusinessCommandResourceCorrelation } from "./businessCommandAudit";
import { CHANNEL_INVENTORY_BUSINESS_METHOD_IDS, CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES } from "../client/src/business/platform/shared/channelInventoryBusinessPolicy";
import { NATIVE_TEAM_READ_METHODS, officialInventoryMethodRequirement } from "../client/src/business/platform/shared/internalBusinessOfficialInventory";
import { verifyOfficialInventoryGrant } from "../client/src/business/platform/front-router-types/server/services/internalBusinessOfficialGrant";
import { createCustomerMaterialSchema, customerSupplyContextSchema, customerSupplySummarySchema } from "./customerSupplyBusinessInput";
import * as canonicalCustomerSupply from "../client/src/business/platform/shared/customerSupply";

vi.mock("./services/officialChannelProfileRead", () => ({ withOfficialChannelProfileRead: async (_ctx: unknown, _staff: unknown, run: (projection: undefined) => unknown) => run(undefined) }));

const state = vi.hoisted(() => ({
  bound: true, scopeActive: true, accountActive: true,
  scope: [] as string[], native: [] as string[], bindingVersion: 7,
  role: "merchant_mgr", denyUpstream: false, scopeReads: 0, revokeCrmAtSecondRead: false,
  fence: vi.fn(), transport: vi.fn(), audit: vi.fn(), livePermissions: vi.fn(),
}));
vi.mock("./db", () => ({
  withBusinessAuthorizationFence: async (key: unknown, operation: () => Promise<unknown>) => { state.fence(key); return operation(); },
  getAdminUserById: async () => ({ id: 303, status: state.accountActive ? "active" : "disabled", adminRole: state.role, sessionVersion: 4 }),
  getAdminUserPermissions: async (id: number) => { state.livePermissions(id); return [...state.native]; },
  getActiveBusinessStaffBinding: async () => state.bound ? { frontUserId: 202, bindingVersion: state.bindingVersion } : null,
  getActiveBusinessMerchantScope: async () => {
    state.scopeReads++;
    const scope = state.revokeCrmAtSecondRead && state.scopeReads % 2 === 0 ? state.scope.filter(value => value !== "business.customers.read") : [...state.scope];
    return state.scopeActive ? { scopeVersion: 9, modulePermissions: scope } : null;
  },
  getBusinessWorkbenchMerchantById: async () => ({ id: 51, merchantNo: "fixture", companyName: "本地虚构企业", crmStatus: "enabled", registrationRegion: "CN", businessLicense: "SYNTHETIC-CREDIT", crmOwnerPortalUserId: "101" }),
  recordBusinessCommandAccess: async (input: unknown) => state.audit(input),
}));
import { BUSINESS_METHOD_CAPABILITIES, businessRouter, businessRouterTestUtils } from "./businessRouter";
const requestId = "00000000-0000-4000-8000-000000000001";
const identity = { expectedEnterpriseId: 501, expectedActorUserId: 202 };
const summary = { ...identity, customerIds: [11, 12] };
const contextInput = { ...identity, customerId: 11 };
const create = { ...identity, customerId: 11, expectedCustomerVersion: 2, sourceProfile: { type: "factory", existingChannelId: 31 }, partNumber: "ＡＢＣ123", brand: "本地测试品牌", qty: 0, dateCode: null, price: "0.00", currency: "CNY", taxIncluded: null, leadTime: null, note: "不应存入 BFF 审计的正文", requestId };
const batch = { ...identity, customerId: 11, expectedCustomerVersion: 2, sourceProfile: { type: "factory", existingChannelId: 31 }, fileName: "synthetic.xlsx", totalRows: 3, requestId };
const methods = ["customerSupplySummary", "customerSupplyContext", "createCustomerUploadBatch", "createCustomerMaterial"] as const;
const methodsInput = { customerSupplySummary: summary, customerSupplyContext: contextInput, createCustomerMaterial: create, createCustomerUploadBatch: batch };
const ctx = (): TrpcContext => ({ user: { id: 303, role: "admin" }, adminAccount: { id: 303, status: "active", username: "fixture", displayName: "本地员工", adminRole: state.role }, adminPermissions: ["officialInventory.read", "officialInventory.write"], req: { headers: { "x-business-merchant-id": "51" }, ip: "127.0.0.1" }, res: {} } as unknown as TrpcContext);

beforeEach(() => {
  state.bound = true; state.scopeActive = true; state.accountActive = true; state.role = "merchant_mgr";
  state.scope = ["business.inventory.read", "business.inventory.write", "business.customers.read"];
  state.native = ["officialInventory.read", "officialInventory.write", "officialInventory.note"];
  state.bindingVersion = 7; state.denyUpstream = false; state.scopeReads = 0; state.revokeCrmAtSecondRead = false;
  for (const mock of [state.fence, state.transport, state.audit, state.livePermissions]) mock.mockReset();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "51");
  vi.stubEnv("PLATFORM_API_BASE", "https://synthetic.invalid"); vi.stubEnv("PORTAL_API_KEY", "synthetic-local-key");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    state.transport(url, init);
    if (state.denyUpstream) return new Response(JSON.stringify([{ error: { json: { message: "当前员工不可读取该客户", data: { code: "FORBIDDEN", businessFailure: "BUSINESS_RESOURCE_FORBIDDEN" } } } }]), { status: 403 });
    return new Response(JSON.stringify([{ result: { data: { json: { item: { id: 901, createdByUserId: 202, responsibleUserId: 909 }, idempotent: false, channelId: 31, customerId: 11 } } } }]), { status: 200 });
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function lastPayload() {
  const [url, init] = state.transport.mock.calls.at(-1)! as [string, RequestInit];
  expect(url).toBe("https://synthetic.invalid/api/trpc/internalBusiness.execute?batch=1");
  expect(init.method).toBe("POST");
  expect(init.headers).not.toHaveProperty("Cookie"); expect(init.headers).not.toHaveProperty("Authorization");
  return JSON.parse(String(init.body))["0"].json;
}

describe("customer-supply closed BFF transport", () => {
  it("four exact methods retain query/query/mutation and complete fixed capabilities, without wildcard or shortcut", async () => {
    const caller = businessRouter.createCaller(ctx()).channelInventory;
    for (const method of methods) {
      const full = `channelInventory.${method}`;
      const mode = method.startsWith("createCustomer") ? "write" : "read";
      expect(businessRouter._def.procedures[full]._def.type).toBe(mode === "write" ? "mutation" : "query");
      expect(BUSINESS_METHOD_CAPABILITIES.filter(value => value.method === full)).toEqual([{ method: full, module: "inventory", mode }]);
      expect(CHANNEL_INVENTORY_BUSINESS_METHOD_IDS.filter(value => value === full)).toHaveLength(1);
      expect(CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES[full]).toEqual({ mode, permission: "inventory.manage" });
      expect(officialInventoryMethodRequirement(full)).toBe(mode);
      // Front native-read membership is not the BFF's local scope shortcut:
      // the BFF still requires inventory scope AND customers.read for these reads.
      expect(NATIVE_TEAM_READ_METHODS.includes(full)).toBe(mode === "read");
      await caller[method](methodsInput[method]);
      const payload = lastPayload();
      expect(payload).toMatchObject({ method: full, staffUserId: 202, bindingVersion: 7, expectedOwnerUserId: 101, creditCode: "SYNTHETIC-CREDIT", adminActor: { id: 303, role: "merchant_mgr" } });
      expect(payload).not.toHaveProperty("officialInventoryPermissions");
      const permissions = verifyOfficialInventoryGrant(payload.officialInventoryGrant, { creditCode: payload.creditCode, expectedOwnerUserId: 101, staffUserId: 202, adminAccountId: 303, bindingVersion: 7, method: full, requestId: payload.requestId });
      expect(permissions).toEqual({ read: true, write: true, note: true, publish: false, customerScopeRead: true, authorizationVersion: expect.stringMatching(/^official-inventory-v1:[a-f0-9]{64}$/) });
      expect(payload.params).toEqual(method === "createCustomerMaterial" ? createCustomerMaterialSchema.parse(create) : methodsInput[method]);
    }
    expect(state.fence).toHaveBeenCalledTimes(4); expect(state.fence).toHaveBeenCalledWith({ adminUserId: 303, merchantId: 51 });
    expect(state.livePermissions).toHaveBeenCalledTimes(4); expect(state.audit).toHaveBeenCalledTimes(4);
    expect(businessRouter._def.procedures["channelInventory.*"]).toBeUndefined();
    expect(officialInventoryMethodRequirement("channelInventory.createCustomerMaterialFake")).toBeNull();
  });

  it("signed caller grant cannot be replayed against a different method, actor, scope version or request", async () => {
    await businessRouter.createCaller(ctx()).channelInventory.createCustomerMaterial(create);
    const payload = lastPayload();
    const target = { creditCode: "SYNTHETIC-CREDIT", expectedOwnerUserId: 101, staffUserId: 202, adminAccountId: 303, bindingVersion: 7, method: "channelInventory.createCustomerMaterial", requestId: payload.requestId };
    for (const change of [{ method: "channelInventory.customerSupplySummary" }, { staffUserId: 666 }, { adminAccountId: 666 }, { bindingVersion: 8 }, { expectedOwnerUserId: 666 }, { requestId: "unrelated-request" }]) {
      expect(() => verifyOfficialInventoryGrant(payload.officialInventoryGrant, { ...target, ...change })).toThrow("渠道库存受信授权无效");
    }
    expect(() => verifyOfficialInventoryGrant({ ...payload.officialInventoryGrant, permissions: { ...payload.officialInventoryGrant.permissions, authorizationVersion: "browser-forged-version" } }, target)).toThrow("渠道库存受信授权无效");
    expect(() => verifyOfficialInventoryGrant({ ...payload.officialInventoryGrant, permissions: { ...payload.officialInventoryGrant.permissions, customerScopeRead: false } }, target)).toThrow("渠道库存受信授权无效");
  });

  it("signed payload retains native permission slots/version, intersects write and adds the request-local CRM overlay", async () => {
    state.scope = ["business.inventory.read", "business.customers.read"];
    state.native = ["officialInventory.read", "officialInventory.note"];
    await businessRouter.createCaller(ctx()).channelInventory.customerSupplySummary(summary);
    const payload = lastPayload();
    expect(payload.officialInventoryGrant.permissions).toEqual({ read: true, write: false, note: true, publish: false, customerScopeRead: true, authorizationVersion: expect.stringMatching(/^official-inventory-v1:[a-f0-9]{64}$/) });
    expect(Object.keys(payload.officialInventoryGrant.permissions).sort()).toEqual(["authorizationVersion", "customerScopeRead", "note", "publish", "read", "write"]);
    await expect(businessRouter.createCaller(ctx()).channelInventory.createCustomerMaterial(create)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).toHaveBeenCalledTimes(1);
  });

  it("write permission is masked by merchant write scope even on a valid read command", async () => {
    state.scope = ["business.inventory.read", "business.customers.read"];
    await businessRouter.createCaller(ctx()).channelInventory.customerSupplyContext(contextInput);
    expect(lastPayload().officialInventoryGrant.permissions).toMatchObject({ read: true, write: false, note: true });
  });

  it("every method requires CRM read independently from CRM write, inventory and official grants", async () => {
    state.scope = ["business.inventory.read", "business.inventory.write", "business.customers.write"];
    for (const method of methods) await expect(businessRouter.createCaller(ctx()).channelInventory[method](methodsInput[method])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });

  it("official inventory read alone cannot open CRM summary/context or replace inventory scope", async () => {
    state.scope = ["business.customers.read"];
    for (const method of methods) await expect(businessRouter.createCaller(ctx()).channelInventory[method](methodsInput[method])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).not.toHaveBeenCalled();
  });

  it.each([{ native: [] }, { native: ["officialInventory.write"] }, { native: ["officialInventory.note"] }])("stale browser grants cannot replace live native read: %j", async ({ native }) => {
    state.native = native;
    for (const method of methods) await expect(businessRouter.createCaller(ctx()).channelInventory[method](methodsInput[method])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).not.toHaveBeenCalled();
  });

  it("live native write is additionally required for create", async () => {
    state.native = ["officialInventory.read"];
    await expect(businessRouter.createCaller(ctx()).channelInventory.createCustomerMaterial(create)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).not.toHaveBeenCalled();
  });

  it("CRM scope revoked at the final in-fence snapshot denies instead of relying on the first snapshot", async () => {
    state.revokeCrmAtSecondRead = true;
    await expect(businessRouter.createCaller(ctx()).channelInventory.customerSupplySummary(summary)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.scopeReads).toBe(2); expect(state.transport).not.toHaveBeenCalled();
  });

  it("no superadmin CRM/inventory scope bypass or binding bypass, and no auto-grant", async () => {
    state.role = "super_admin"; state.scope = [];
    await expect(businessRouter.createCaller(ctx()).channelInventory.customerSupplySummary(summary)).rejects.toMatchObject({ code: "FORBIDDEN" });
    state.scope = ["business.inventory.read", "business.inventory.write", "business.customers.read"]; state.bound = false;
    await expect(businessRouter.createCaller(ctx()).channelInventory.createCustomerMaterial(create)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    state.bound = true; state.scopeActive = false;
    await expect(businessRouter.createCaller(ctx()).channelInventory.customerSupplyContext(contextInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });

  it("binding/version and native grants refresh on every request", async () => {
    const caller = businessRouter.createCaller(ctx()).channelInventory;
    await caller.customerSupplySummary(summary); const first = lastPayload();
    state.bindingVersion = 8; state.native = ["officialInventory.read"];
    await caller.customerSupplyContext(contextInput); const second = lastPayload();
    expect(first.bindingVersion).toBe(7); expect(second.bindingVersion).toBe(8);
    expect(second.officialInventoryGrant.permissions.authorizationVersion).not.toBe(first.officialInventoryGrant.permissions.authorizationVersion);
    expect(state.livePermissions).toHaveBeenCalledTimes(2);
  });

  it("front CRM record denial is preserved and never audited as success", async () => {
    state.denyUpstream = true;
    await expect(businessRouter.createCaller(ctx()).channelInventory.customerSupplyContext(contextInput)).rejects.toMatchObject({ code: "FORBIDDEN", message: "当前员工不可读取该客户" });
    expect(state.transport).toHaveBeenCalledTimes(1); expect(state.audit).not.toHaveBeenCalled();
  });

  it("new denial does not break customer.list or unrelated inventory read", async () => {
    state.scope = ["business.customers.read", "business.inventory.read"]; state.native = [];
    const caller = businessRouter.createCaller(ctx());
    await caller.customer.list({ page: 1, pageSize: 20 }); await caller.inventory.list({});
    expect(state.transport).toHaveBeenCalledTimes(2);
    await expect(caller.channelInventory.customerSupplySummary(summary)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).toHaveBeenCalledTimes(2);
  });
});

describe("legacy channel commands carry the fresh signed customer-scope overlay", () => {
  it.each(["getChannel", "listChannels", "createMaterial"] as const)("%s remains inventory-only but signs false; browser bits cannot open linked CRM or the three new methods", async method => {
    state.scope = ["business.inventory.read", "business.inventory.write", "business.customers.write"];
    const caller = businessRouter.createCaller(ctx()).channelInventory;
    await caller[method]({ id: 31, channelId: 31, ...create, customerScopeRead: true,
      officialInventoryPermissions: { customerScopeRead: true }, officialInventoryGrant: { permissions: { customerScopeRead: true } } });
    const payload = lastPayload();
    const target = { creditCode: payload.creditCode, expectedOwnerUserId: 101, staffUserId: 202,
      adminAccountId: 303, bindingVersion: 7, method: `channelInventory.${method}`, requestId: payload.requestId };
    expect(verifyOfficialInventoryGrant(payload.officialInventoryGrant, target)).toEqual({
      read: true, write: true, note: true, publish: false, customerScopeRead: false,
      authorizationVersion: expect.stringMatching(/^official-inventory-v1:[a-f0-9]{64}$/),
    });
    expect(() => verifyOfficialInventoryGrant({ ...payload.officialInventoryGrant,
      permissions: { ...payload.officialInventoryGrant.permissions, customerScopeRead: true } }, target)).toThrow("渠道库存受信授权无效");
    for (const supplyMethod of methods) await expect(caller[supplyMethod](methodsInput[supplyMethod])).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).toHaveBeenCalledTimes(1); expect(state.audit).toHaveBeenCalledTimes(1);
  });

  it("legacy overlay uses the final in-fence snapshot and refreshes per request without changing native grants/version", async () => {
    const caller = businessRouter.createCaller(ctx()).channelInventory;
    await caller.getChannel({ id: 31 });
    const first = lastPayload().officialInventoryGrant.permissions;
    state.revokeCrmAtSecondRead = true;
    await caller.getChannel({ id: 31, customerScopeRead: true });
    const second = lastPayload().officialInventoryGrant.permissions;
    expect(first.customerScopeRead).toBe(true); expect(second.customerScopeRead).toBe(false);
    expect(second).toEqual({ ...first, customerScopeRead: false });
    expect(state.scopeReads).toBe(4); expect(state.fence).toHaveBeenCalledTimes(2);
  });

  it("superadmin native grants do not infer a local customer-scope bit", async () => {
    state.role = "super_admin"; state.native = [];
    state.scope = ["business.inventory.read", "business.inventory.write"];
    await businessRouter.createCaller(ctx()).channelInventory.createMaterial({ channelId: 31, ...create, customerScopeRead: true });
    expect(lastPayload().officialInventoryGrant.permissions).toMatchObject({ read: true, write: true, note: true, publish: true, customerScopeRead: false });
    await expect(businessRouter.createCaller(ctx()).channelInventory.createCustomerMaterial(create)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).toHaveBeenCalledTimes(1);
  });

  it("a front-linked CRM domain denial stays FORBIDDEN, with no successful receipt, source data or audit", async () => {
    state.scope = ["business.inventory.read", "business.inventory.write"]; state.denyUpstream = true;
    await expect(businessRouter.createCaller(ctx()).channelInventory.getChannel({ id: 31, customerScopeRead: true }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: "当前员工不可读取该客户" });
    expect(lastPayload().officialInventoryGrant.permissions.customerScopeRead).toBe(false);
    expect(state.transport).toHaveBeenCalledTimes(1); expect(state.audit).not.toHaveBeenCalled();
  });
});

describe("strict supply inputs and minimal audit", () => {
  it("BFF uses the actual shared schema objects, not a duplicate version of material rules", () => {
    expect(createCustomerMaterialSchema).toBe(canonicalCustomerSupply.createCustomerMaterialSchema);
    expect(customerSupplyContextSchema).toBe(canonicalCustomerSupply.customerSupplyContextSchema);
    expect(customerSupplySummarySchema).toBe(canonicalCustomerSupply.customerSupplySummarySchema);
    expect(createCustomerMaterialSchema.shape.qty).toBe(canonicalCustomerSupply.channelMaterialCreateFields.qty);
    expect(createCustomerMaterialSchema.shape.price).toBe(canonicalCustomerSupply.channelMaterialCreateFields.price);
    expect(createCustomerMaterialSchema.shape.taxIncluded).toBe(canonicalCustomerSupply.channelMaterialCreateFields.taxIncluded);
  });
  it.each(["channelId", "enterpriseId", "dataOwnerUserId", "ownerUserId", "actorUserId", "responsibleUserId", "createdByUserId", "companyName", "name", "phone", "contactName", "officialInventoryGrant", "officialInventoryPermissions", "customerScopeRead", "method", "shareEnabled"])("rejects injected top-level %s before forwarding", async field => {
    await expect(businessRouter.createCaller(ctx()).channelInventory.createCustomerMaterial({ ...create, [field]: 666 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.fence).not.toHaveBeenCalled(); expect(state.transport).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
  it.each(methods)("%s rejects an actual browser boolean instead of granting CRM authority", async method => {
    state.scope = ["business.inventory.read", "business.inventory.write"];
    await expect(businessRouter.createCaller(ctx()).channelInventory[method]({ ...methodsInput[method], customerScopeRead: true }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.fence).not.toHaveBeenCalled(); expect(state.transport).not.toHaveBeenCalled();
  });
  it.each(["name", "phone", "contactName", "industryCode", "responsibleUserId", "channelId", "active"])("rejects sourceProfile %s; only explicit type/existing ID admitted", async field => {
    await expect(businessRouter.createCaller(ctx()).channelInventory.createCustomerMaterial({ ...create, sourceProfile: { ...create.sourceProfile, [field]: "untrusted" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.transport).not.toHaveBeenCalled();
  });
  it("strict summary bounds and context guards reject unknown/injection/unsafe IDs", () => {
    expect(customerSupplySummarySchema.safeParse({ customerIds: Array(101).fill(1) }).success).toBe(false);
    expect(customerSupplySummarySchema.safeParse({ customerIds: [0] }).success).toBe(false);
    expect(customerSupplySummarySchema.safeParse({ ...summary, ownerUserId: 3 }).success).toBe(false);
    expect(customerSupplyContextSchema.safeParse({ customerId: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
    expect(customerSupplyContextSchema.safeParse({ ...contextInput, phone: "fixture" }).success).toBe(false);
  });
  it("all new methods require expected actor and enterprise as comparison guards", () => {
    for (const field of ["expectedEnterpriseId", "expectedActorUserId"] as const) {
      expect(customerSupplySummarySchema.safeParse({ ...summary, [field]: undefined }).success).toBe(false);
      expect(customerSupplyContextSchema.safeParse({ ...contextInput, [field]: undefined }).success).toBe(false);
      expect(createCustomerMaterialSchema.safeParse({ ...create, [field]: undefined }).success).toBe(false);
    }
  });
  it.each([{ qty: -1 }, { qty: 2_147_483_648 }, { qty: 0.1 }, { currency: "USD" }, { price: "1e3" }, { price: "01" }, { taxIncluded: undefined }, { requestId: "invalid" }, { expectedCustomerVersion: 0 }, { brand: "" }, { partNumber: "" }])("material parity rejects %j", change => {
    expect(createCustomerMaterialSchema.safeParse({ ...create, ...change }).success).toBe(false);
  });
  it("new audit stores only numeric front item ID and original request key, never company/contact/material or current owner", async () => {
    await businessRouter.createCaller(ctx()).channelInventory.createCustomerMaterial(create);
    const audit = state.audit.mock.calls[0][0];
    expect(audit).toMatchObject({ merchantId: 51, staffUserId: 202, bindingVersion: 7, scopeVersion: 9, method: "channelInventory.createCustomerMaterial", resourceCorrelation: { schemaVersion: 1, resourceType: "channel_material", resourceId: 901, actionRequestId: requestId } });
    expect(validateBusinessCommandResourceCorrelation(audit.resourceCorrelation)).toEqual(audit.resourceCorrelation);
    expect(audit).not.toHaveProperty("params"); expect(audit).not.toHaveProperty("result");
    const serialized = JSON.stringify(audit);
    for (const privateValue of [create.note, create.partNumber, create.brand, "companyName", "phone", "responsibleUserId", "createdByUserId", "customerId"]) expect(serialized).not.toContain(privateValue);
    const params = { id: 666, requestId, ownerUserId: 666 };
    for (const badResult of [{ id: 666 }, { materialId: 901 }, { item: { materialId: 901 } }, { item: { id: "901" } }, { item: { id: 0 } }]) expect(businessRouterTestUtils.channelCommandResource("channelInventory.createCustomerMaterial", params, badResult)).toBeUndefined();
    expect(businessRouterTestUtils.channelCommandResource("channelInventory.createCustomerMaterial", { id: 666 }, { item: { id: 901 } })).toBeUndefined();
    expect(businessRouterTestUtils.channelCommandResource("channelInventory.createCustomerMaterial", { requestId: "bad" }, { item: { id: 901 } })).toBeUndefined();
  });
});
