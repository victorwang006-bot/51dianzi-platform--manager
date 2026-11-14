import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { verifyOfficialInventoryGrant } from "../client/src/business/platform/front-router-types/server/services/internalBusinessOfficialGrant";

const state = vi.hoisted(() => ({
  nativeStatus: "active", nativeSessionVersion: 7, permissions: ["officialInventory.read"] as string[],
  lockedPermissions: ["officialInventory.read"] as string[], membership: null as null | { teamId: number; role: string; teamStatus: string },
  peerIds: [202, 203], binding: true, scopes: ["business.inventory.read", "business.customers.read"] as string[],
  scope: true, scopeReads: 0, revokeAtFinal: false, merchantEnabled: true,
  fenceHeld: false, nativeLocksHeld: false, fence: vi.fn(), tables: [] as string[],
  audit: vi.fn(), forwarded: [] as any[], result: {} as unknown, upstreamCode: null as null | string,
  transportFailure: false, lookup: vi.fn(), serviceFailure: false,
}));

// All original authorization functions execute. Only database/network/service
// boundaries are mocked: never import a production entrypoint or open MySQL.
vi.mock("./db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const tx = {
    select: () => {
      let tableName = "";
      const query = {
        from: (table: any) => { tableName = getTableName(table); state.tables.push(tableName); return query; },
        where: () => query, limit: () => query, innerJoin: () => query, orderBy: () => query,
        for: async (lock: string) => {
          expect(lock).toBe("update"); expect(state.fenceHeld).toBe(true); expect(state.nativeLocksHeld).toBe(true);
          if (tableName === "admin_users") return [{ id: 303, adminRole: "merchant_mgr", status: state.nativeStatus, sessionVersion: state.nativeSessionVersion }];
          if (tableName === "admin_user_permissions") return state.lockedPermissions.map(permission => ({ permission }));
          if (tableName === "official_channel_team_members") return state.membership ? [state.membership] : [];
          throw new Error(`Unexpected authorization SELECT: ${tableName}`);
        },
      };
      return query;
    },
    execute: async () => { expect(state.nativeLocksHeld).toBe(true); return [state.peerIds.map(ownerUserId => ({ ownerUserId }))]; },
  };
  return {
    withBusinessAuthorizationFence: async (key: unknown, run: () => Promise<unknown>) => {
      state.fence(key); state.fenceHeld = true;
      try { return await run(); } finally { state.fenceHeld = false; }
    },
    getActiveBusinessStaffBinding: async () => state.binding ? { frontUserId: 202, bindingVersion: 7 } : null,
    getAdminUserById: async () => ({ id: 303, adminRole: "merchant_mgr", status: state.nativeStatus, sessionVersion: state.nativeSessionVersion }),
    getAdminUserPermissions: async () => state.permissions,
    getActiveBusinessMerchantScope: async () => {
      state.scopeReads++;
      return state.scope ? { scopeVersion: 9, modulePermissions: state.revokeAtFinal && state.scopeReads % 2 === 0
        ? state.scopes.filter(permission => permission !== "business.customers.read") : state.scopes } : null;
    },
    getBusinessWorkbenchMerchantById: async () => ({ id: 51, crmStatus: state.merchantEnabled ? "enabled" : "disabled", registrationRegion: "CN", businessLicense: "SYNTHETIC", crmOwnerPortalUserId: "101" }),
    getDb: async () => ({ transaction: async (run: (transaction: typeof tx) => Promise<unknown>) => {
      state.nativeLocksHeld = true;
      try { return await run(tx); } finally { state.nativeLocksHeld = false; }
    } }),
    recordBusinessCommandAccess: async (input: unknown) => state.audit(input),
  };
});
vi.mock("./channelReference/service", () => ({ lookupChannelReferences: async (materials: unknown, options: unknown) => {
  expect(state.fenceHeld).toBe(false); expect(state.nativeLocksHeld).toBe(false);
  state.lookup(materials, options);
  if (state.serviceFailure) throw new Error("PRIVATE SERVICE DETAILS MUST NOT LEAK");
  return { items: (materials as any[]).map(material => ({ ...material, references: {
    lcsc: quote("lcsc"), ickey: quote("ickey"),
  } })) };
} }));

import { businessRouter, BUSINESS_METHOD_CAPABILITIES, readApprovedChannelReferenceMaterials } from "./businessRouter";
import { channelReferenceLookupInputSchema } from "./channelReferenceRouter";

function quote(source: "lcsc" | "ickey") {
  return { source, status: "pending", matchedPartNumber: null, matchedBrand: null, productCode: null,
    pageUrl: null, stockQuantity: null, unitPrice: null, tierQuantity: null, tiers: [], currency: null,
    unit: null, taxStatus: "unknown", packaging: null, fetchedAt: null, expiresAt: null,
    stockInsufficientForTier: false, message: null };
}
const ctx = (extra = {}) => ({ user: { id: 303, role: "admin" }, adminAccount: {
  id: 303, status: "active", sessionVersion: 7, adminRole: "merchant_mgr", username: "fixture",
}, req: { headers: { "x-business-merchant-id": "51" }, ip: "127.0.0.1" }, res: {}, ...extra } as never);
const row = (id = 102, extra = {}) => ({ id, partNumber: "STM32F103C8T6/TR", brand: "ST", canViewSource: true,
  company: { id: 1, name: "PRIVATE CUSTOMER" }, internalPrice: "321.09", qty: 900, recorderAdminAccountId: 987, ...extra });
const page = (items = [row()], extra = {}) => ({ items, total: items.length, page: 1, pageSize: 20,
  pageCount: items.length === 0 ? 0 : 1, ...extra });
const input = (listInput = {}, materialIds = [102], extra = {}) => ({ listInput, materialIds, ...extra });
const call = (value = input(), context = ctx()) => businessRouter.createCaller(context).channelReference.lookup(value);
const customerPage = (extra = {}) => page([row()], { customerId: 1, bindingCount: 1, ...extra });

beforeEach(() => {
  state.nativeStatus = "active"; state.nativeSessionVersion = 7; state.permissions = ["officialInventory.read"];
  state.lockedPermissions = ["officialInventory.read"]; state.membership = null; state.peerIds = [202, 203];
  state.binding = true; state.scope = true; state.scopeReads = 0; state.revokeAtFinal = false;
  state.scopes = ["business.inventory.read", "business.customers.read"]; state.merchantEnabled = true;
  state.fenceHeld = false; state.nativeLocksHeld = false; state.result = page(); state.upstreamCode = null;
  state.transportFailure = false; state.serviceFailure = false; state.tables = []; state.forwarded = [];
  state.fence.mockClear(); state.audit.mockClear(); state.lookup.mockClear();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "51");
  vi.stubEnv("PLATFORM_API_BASE", "https://synthetic.invalid"); vi.stubEnv("PORTAL_API_KEY", "synthetic-channel-reference-key");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    expect(url).toBe("https://synthetic.invalid/api/trpc/internalBusiness.execute?batch=1");
    expect(init.method).toBe("POST"); expect(state.fenceHeld).toBe(true); expect(state.nativeLocksHeld).toBe(true);
    expect(init.headers).not.toHaveProperty("cookie"); expect(init.headers).not.toHaveProperty("authorization");
    const payload = JSON.parse(String(init.body))["0"].json; state.forwarded.push(payload);
    const target = { creditCode: "SYNTHETIC", expectedOwnerUserId: 101, staffUserId: 202, adminAccountId: 303,
      bindingVersion: 7, method: "channelInventory.listTeamMaterials", requestId: payload.requestId };
    expect(payload.method).toBe(target.method); expect(payload).not.toHaveProperty("officialInventoryPermissions");
    const grant = verifyOfficialInventoryGrant(payload.officialInventoryGrant, target);
    expect(grant.read).toBe(true); expect(grant.write).toBe(false); expect(grant.publish).toBe(false);
    if (state.transportFailure) throw new Error("PRIVATE NETWORK ERROR");
    if (state.upstreamCode) return new Response(JSON.stringify([{ error: { json: { message: "当前业务范围不可用", data: {
      code: state.upstreamCode, ...(state.upstreamCode === "UNAUTHORIZED" ? { businessFailure: "AUTH_SESSION_INVALID" } : {}),
    } } } }]), { status: 403 });
    return new Response(JSON.stringify([{ result: { data: { json: state.result } } }]), { status: 200 });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("channelReference.lookup fixed BFF and fresh current-page authorization", () => {
  it("re-reads the complete original filter/page context, derives identities, releases both locks, and sends ONLY three fields", async () => {
    const filters = { expectedEnterpriseId: 31, expectedActorUserId: 202, channelId: 12, uploadBatchId: 88,
      industryCode: "automotive", partNumber: " STM32 ", brand: " ST ", page: 3, pageSize: 10, sortBy: "qty", sortDirection: "desc" } as const;
    state.result = page([row(102), row(103, { partNumber: "ABC-TR", brand: "TI" })], { total: 22, page: 3, pageSize: 10, pageCount: 3 });
    const result = await call(input(filters, [103, 102], { refresh: true }));
    expect(state.forwarded).toHaveLength(1);
    expect(state.forwarded[0].params).toEqual({ ...filters, partNumber: "STM32", brand: "ST" });
    expect(state.lookup).toHaveBeenCalledWith([
      { materialId: 103, partNumber: "ABC-TR", brand: "TI" }, { materialId: 102, partNumber: "STM32F103C8T6/TR", brand: "ST" },
    ], { refresh: true });
    expect(state.fence).toHaveBeenCalledWith({ adminUserId: 303, merchantId: 51 });
    expect(state.tables).toEqual(["admin_users", "admin_user_permissions", "official_channel_team_members"]);
    expect(state.audit).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toMatch(/PRIVATE CUSTOMER|internalPrice|recorderAdminAccountId|321\.09/);
    expect(result.items[0].references.lcsc).toMatchObject({ status: "pending", stockQuantity: null, unitPrice: null });
  });
  it("preserves native official read without local inventory read globally, including source-hidden rows", async () => {
    state.scopes = []; state.result = page([row(102, { canViewSource: false, company: null })]);
    await expect(call()).resolves.toHaveProperty("items");
    expect(state.forwarded[0].officialInventoryGrant.permissions.customerScopeRead).toBe(false);
    expect(state.audit).not.toHaveBeenCalled();
  });
  it("reissues the real fresh official leader proof and ignores stale request-context grants", async () => {
    state.membership = { teamId: 9, role: "leader", teamStatus: "active" };
    await call();
    expect(state.forwarded[0].officialInventoryGrant.permissions.channelProfileTeamRead).toEqual({ ownerUserIds: [202, 203] });
    state.peerIds = [202]; await call();
    expect(state.forwarded[1].officialInventoryGrant.permissions.channelProfileTeamRead).toEqual({ ownerUserIds: [202] });
  });
  it("requires both unchanged local CRM/inventory scopes in customer mode, signs the final CRM overlay", async () => {
    state.result = customerPage();
    for (const scopes of [[], ["business.inventory.read"], ["business.customers.read"], ["business.inventory.read", "business.customers.write"]]) {
      state.scopes = scopes; await expect(call(input({ customerId: 1 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(state.lookup).not.toHaveBeenCalled(); expect(state.forwarded).toHaveLength(0);
    state.scopes = ["business.inventory.read", "business.customers.read"];
    await call(input({ customerId: 1 }));
    expect(state.forwarded[0].params).toEqual({ customerId: 1, page: 1, pageSize: 20 });
    expect(state.forwarded[0].officialInventoryGrant.permissions.customerScopeRead).toBe(true);
  });
  it("denies CRM revocation at the final in-fence read, before any upstream or cache lookup", async () => {
    state.revokeAtFinal = true; state.result = customerPage();
    await expect(call(input({ customerId: 1 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.scopeReads).toBe(2); expect(state.forwarded).toHaveLength(0); expect(state.lookup).not.toHaveBeenCalled();
  });
  it.each(["binding", "scope"] as const)("revalidates revoked %s even after a prior cache/pending result", async key => {
    await call(); state[key] = false;
    await expect(call()).rejects.toBeDefined(); expect(state.lookup).toHaveBeenCalledTimes(1); expect(state.forwarded).toHaveLength(1);
  });
  it.each(["native", "locked"] as const)("native permission revocation at %s stage cannot use cached reference data", async stage => {
    if (stage === "native") state.permissions = []; else state.lockedPermissions = ["dashboard.view"];
    await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.forwarded).toHaveLength(0); expect(state.lookup).not.toHaveBeenCalled();
  });
  it("checks the LAST current native session under real profile locks, not just stale active context", async () => {
    state.nativeSessionVersion = 8;
    await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN", message: "后台账号状态或会话已变化，请重新登录" });
    expect(state.forwarded).toHaveLength(0); expect(state.lookup).not.toHaveBeenCalled();
  });
  it("archived/disabled account and invalid native session cannot proceed", async () => {
    state.nativeStatus = "disabled";
    await expect(call()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    state.nativeStatus = "active";
    await expect(call(input(), ctx({ adminAccount: { id: 303, status: "active", sessionVersion: undefined } }))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(state.lookup).not.toHaveBeenCalled();
  });
  it("has no OAuth compatibility fallback or client-selected merchant grant", async () => {
    await expect(call(input(), ctx({ adminAccount: null }))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(call(input(), ctx({ req: { headers: { "x-business-merchant-id": "52" } } }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(call(input(), ctx({ req: { headers: { "x-business-merchant-id": ["51", "52"] } } }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    state.merchantEnabled = false; await expect(call()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(state.forwarded).toHaveLength(0); expect(state.lookup).not.toHaveBeenCalled();
  });
  it.each([{ ids: [999] }, { ids: [102, 999] }, { ids: [101] }])("rejects ALL missing, cross-page/tenant or client-injected IDs: %j", async ({ ids }) => {
    await expect(call(input({}, ids))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.forwarded).toHaveLength(1); expect(state.lookup).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
  it("never uses a static previous row when it disappeared under current filters/customer/page", async () => {
    await call(); state.result = page([]);
    await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.lookup).toHaveBeenCalledTimes(1); expect(state.forwarded).toHaveLength(2);
  });
  it("allows exactly 20 distinct current-page IDs without any expanded list/sample read", async () => {
    const ids = Array.from({ length: 20 }, (_, index) => 100 + index); state.result = page(ids.map(id => row(id)));
    await call(input({}, ids)); expect(state.lookup.mock.calls[0][0]).toHaveLength(20); expect(state.forwarded).toHaveLength(1);
    expect(state.forwarded[0].params.pageSize).toBe(20);
  });
  it.each([{}, null, { items: null }, page([row()], { page: 2 }), page([row()], { pageSize: 100 }),
    page([row()], { pageCount: 99 }), page([row()], { total: 0, pageCount: 0 }), page([row(), row()]),
    page([row(102, { id: "102" })]), page([row(102, { id: Number.MAX_SAFE_INTEGER + 1 })]), page([row(102, { canViewSource: undefined })]),
    page([row(102, { partNumber: "X".repeat(129) })]), page([row(102, { brand: "X".repeat(65) })]),
    page([row(102, { partNumber: "ABC\u0000" })]), page([row(102, { brand: "TI\n" })]), page([row(102, { brand: undefined })]),
  ])("fails closed on malformed/unproved page or identity DTO %j", async result => {
    state.result = result; await expect(call()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(state.lookup).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
  it("preserves bounded exact suffixes and represents real null/blank identity explicitly without guessing", async () => {
    state.result = page([row(102, { partNumber: null, brand: " " })]); await call();
    expect(state.lookup).toHaveBeenCalledWith([{ materialId: 102, partNumber: "", brand: "" }], { refresh: undefined });
    state.result = page([row(102, { partNumber: "X".repeat(128), brand: "B".repeat(64) })]); await call();
    expect(state.lookup.mock.calls[1][0][0].partNumber).toHaveLength(128);
  });
  it.each([{ customerId: 2 }, { bindingCount: -1 }, { bindingCount: 0 }, { bindingCount: 1.5 }, { bindingCount: undefined },
    { items: [row(102, { canViewSource: false })] }, { items: [row(102, { company: { id: 2 } })] }, { items: [row(102, { company: "wrong" })] },
  ])("repeats the exact existing customer binding/company/source proof: %j", async extra => {
    state.result = customerPage(extra);
    await expect(call(input({ customerId: 1 }))).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(state.lookup).not.toHaveBeenCalled();
  });
  it.each(["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND", "TOO_MANY_REQUESTS", "CONFLICT"])("preserves original upstream domain denial %s, not a webpage/cache success", async code => {
    state.upstreamCode = code; await expect(call()).rejects.toMatchObject({ code, message: "当前业务范围不可用" });
    expect(state.lookup).not.toHaveBeenCalled();
  });
  it("distinguishes upstream authorization-read outage from reference service outage, without leaking/faking zero", async () => {
    state.transportFailure = true;
    await expect(call()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "库存读取授权核验暂时不可用，请稍后重试" });
    expect(state.lookup).not.toHaveBeenCalled(); state.transportFailure = false; state.serviceFailure = true;
    await expect(call()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "渠道参考查询暂时不可用，请稍后重试" });
    expect(state.lookup).toHaveBeenCalledTimes(1); expect(state.audit).not.toHaveBeenCalled();
  });
  it("does not extend the fixed upstream capability allowlist or change old list audit/recorder mapping", async () => {
    expect(BUSINESS_METHOD_CAPABILITIES.some(capability => capability.method.startsWith("channelReference"))).toBe(false);
    state.result = page([row(102, { recorderAdminAccountId: null, originalRecorderName: "UNTRUSTED" })]);
    const original = await businessRouter.createCaller(ctx()).channelInventory.listTeamMaterials({}) as any;
    expect(original.items[0].originalRecorderName).toBeNull(); expect(original.items[0]).not.toHaveProperty("recorderAdminAccountId");
    expect(state.audit).toHaveBeenCalledTimes(1); expect(state.lookup).not.toHaveBeenCalled();
    await call(); expect(state.audit).toHaveBeenCalledTimes(1); expect(state.lookup).toHaveBeenCalledTimes(1);
  });
  it("has a real top-level native AST initializer and fixed root field, not a mirrored channelInventory method", () => {
    const source = ts.createSourceFile("businessRouter.ts", readFileSync(new URL("./businessRouter.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    const declarations = source.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []);
    const initializer = declarations.find(node => node.name.getText(source) === "channelReferenceBusinessRouter")?.initializer;
    expect(initializer?.getText(source)).toBe("createChannelReferenceRouter(readApprovedChannelReferenceMaterials)");
    const root = declarations.find(node => node.name.getText(source) === "businessRouter")?.initializer as ts.CallExpression;
    const fields = (root.arguments[0] as ts.ObjectLiteralExpression).properties;
    expect(fields.find(node => node.name?.getText(source) === "channelReference")?.getText(source)).toBe("channelReference: channelReferenceBusinessRouter");
    expect(typeof readApprovedChannelReferenceMaterials).toBe("function");
  });
});

describe("channelReference.lookup strict input contract", () => {
  it.each([
    input({}, []), input({}, [102, 102]), input({}, Array.from({ length: 21 }, (_, index) => index + 1)),
    input({}, [0]), input({}, [-1]), input({}, [1.5]), input({}, [Number.MAX_SAFE_INTEGER + 1]), input({}, ["102"] as never),
    input({}, [102], { refresh: "true" }), input({}, [102], { refresh: null }), input({}, [102], { partNumber: "GUESS" }),
    input({}, [102], { materials: [{ materialId: 999, partNumber: "GUESS", brand: "TI" }] }),
    input({}, [102], { url: "https://private.invalid" }), input({}, [102], { customerId: 2 }),
    input({ canManageAll: true }), input({ customerScopeRead: true }), input({ actorUserId: 999 }), input({ customerId: 0 }),
    input({ customerId: "1" }), input({ pageSize: 101 }), input({ page: 0 }), input({ sortDirection: "random" }),
    input({ partNumber: "X".repeat(129) }), input({ brand: "B".repeat(65) }),
  ])("rejects invalid/injected payload BEFORE any authorization/network/cache IO: %j", async value => {
    expect(channelReferenceLookupInputSchema.safeParse(value).success).toBe(false);
    await expect(call(value as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.fence).not.toHaveBeenCalled(); expect(state.forwarded).toHaveLength(0); expect(state.lookup).not.toHaveBeenCalled();
  });
  it("accepts both refresh booleans but never forwards refresh to the signed old list command", async () => {
    await call(input({}, [102], { refresh: false })); expect(state.lookup.mock.calls[0][1]).toEqual({ refresh: false });
    await call(input({}, [102], { refresh: true })); expect(state.lookup.mock.calls[1][1]).toEqual({ refresh: true });
    expect(state.forwarded.every(payload => payload.params.refresh === undefined)).toBe(true);
  });
});
