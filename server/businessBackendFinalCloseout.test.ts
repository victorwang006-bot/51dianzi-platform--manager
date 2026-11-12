import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import { getTableName } from "drizzle-orm";
import { validateBusinessCommandResourceCorrelation } from "./businessCommandAudit";
import type { TrpcContext } from "./_core/context";

const fixture = vi.hoisted(() => ({
  account: { id: 303, username: "fixture", displayName: "fixture", adminRole: "merchant_mgr", status: "active", sessionVersion: 1 },
  nativePermissions: ["officialInventory.read", "officialInventory.write"],
  accountLookup: vi.fn(),
  permissionLookup: vi.fn(),
  scope: { id: 10, adminUserId: 303, merchantId: 51, status: "active", scopeVersion: 3, modulePermissions: ["business.context.read", "business.inventory.read", "business.inventory.write"] },
  scopeLookup: vi.fn(),
  record: vi.fn(),
  profileLocks: vi.fn(),
}));
vi.mock("./db", () => ({
  // Exercise the real profile authority function against a transaction-shaped adapter.
  // This fixture is an active, unassigned ordinary member: no team leader proof is minted.
  getDb: async () => ({
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run({
      select: () => {
        let table: string | undefined;
        const query = {
          from(value: Parameters<typeof getTableName>[0]) { table = getTableName(value); return query; },
          where(_value: unknown) { return query; },
          orderBy(_value: unknown) { return query; },
          limit(_value: number) { return query; },
          innerJoin(_table: unknown, _condition: unknown) { return query; },
          async for(lock: string) {
            fixture.profileLocks(table, lock);
            if (table === "admin_users") return [fixture.account];
            if (table === "admin_user_permissions") return fixture.nativePermissions.map(permission => ({ permission }));
            if (table === "official_channel_team_members") return [];
            throw new Error(`Unexpected synthetic profile authority table: ${table}`);
          },
        };
        return query;
      },
    }),
  }),
  withBusinessAuthorizationFence: async (_key: unknown, operation: () => Promise<unknown>) => operation(),
  getAdminUserById: (...args: unknown[]) => fixture.accountLookup(...args),
  getAdminUserPermissions: (...args: unknown[]) => fixture.permissionLookup(...args),
  getActiveBusinessStaffBinding: async () => ({ id: 9, adminUserId: 303, frontUserId: 202, status: "active", bindingVersion: 7 }),
  getActiveBusinessMerchantScope: (...args: unknown[]) => fixture.scopeLookup(...args),
  getBusinessWorkbenchMerchantById: async () => ({ id: 51, merchantNo: "fixture", companyName: "fixture", crmStatus: "enabled", registrationRegion: "CN", businessLicense: "91310000MAH4E001XX", crmOwnerPortalUserId: "101" }),
  recordBusinessCommandAccess: (...args: unknown[]) => fixture.record(...args),
  recordBusinessContextAccess: vi.fn(),
}));

import { businessRouter, businessRouterTestUtils } from "./businessRouter";
import { router as frontRouter, publicProcedure as frontProcedure } from "../client/src/business/platform/front-router-types/server/_core/trpc";
import { BusinessFailureCause as FrontFailureCause, BusinessServiceAuthenticationCause as FrontServiceAuthenticationCause } from "../client/src/business/platform/shared/businessFailure";
import type { TrpcContext as FrontContext } from "../client/src/business/platform/front-router-types/server/_core/context";
import { PlatformBusinessPublicError, PlatformBusinessServiceError, callPlatformBusinessCommand, type OfficialInventoryPermissions } from "./platformBusinessApi";

const original = { base: process.env.PLATFORM_API_BASE, key: process.env.PORTAL_API_KEY, merchants: process.env.BUSINESS_WORKBENCH_MERCHANT_IDS };
let upstreamError: TRPCError | undefined;
const upstream = frontRouter({ internalBusiness: frontRouter({ execute: frontProcedure.input(z.unknown()).mutation(({ ctx }) => {
  if (ctx.req.headers["x-portal-key"] !== "fixture-service-key") {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "内部接口鉴权失败", cause: new FrontServiceAuthenticationCause() });
  }
  if (upstreamError) throw upstreamError;
  return { item: { id: 901, responsibleUserId: 909, createdByUserId: 202 } };
}), context: frontProcedure.input(z.unknown()).query(({ input }) => {
  const payload = input as { officialInventoryGrant: { permissions: OfficialInventoryPermissions } };
  expect(input).toMatchObject({
    staffUserId: 202, adminAccountId: 303, bindingVersion: 7,
    officialInventoryGrant: { permissions: { read: true, write: fixture.nativePermissions.includes("officialInventory.write"), note: false, publish: false, customerScopeRead: false, authorizationVersion: expect.stringMatching(/^official-inventory-v1:[a-f0-9]{64}$/) } },
  });
  return {
    enterpriseId: 51, companyName: "fixture", dataOwnerUserId: 404, ownerUserId: 101,
    authorizationVersion: "business-auth-v1:fixture-server-version",
    staffPrincipal: { status: "ready", frontendUserId: 202, adminAccountId: 303, bindingVersion: 7, enterpriseId: 51, user: { id: 202 } },
    officialInventoryPermissions: payload.officialInventoryGrant.permissions,
    workbenchCapabilities: ["company.read", "inventory.read"], enabledModules: ["company.read", "inventory.read"],
    sessionCapabilities: { chat: false, receptionReady: false },
  };
}) }) });

function context(): TrpcContext {
  return {
    user: { id: 303, openId: "local_admin:303", role: "admin" },
    adminAccount: fixture.account,
    adminPermissions: [], req: { headers: { "x-business-merchant-id": "51" }, ip: "127.0.0.1" }, res: {},
  } as unknown as TrpcContext;
}
async function downstream() {
  const response = await fetchRequestHandler({
    endpoint: "/trpc", router: businessRouter,
    req: new Request("https://admin.invalid/trpc/channelInventory.getMaterial?input=" + encodeURIComponent(JSON.stringify({ json: { id: 901 } }))),
    createContext: context,
  });
  return { status: response.status, body: await response.json() };
}
beforeEach(() => {
  process.env.PLATFORM_API_BASE = "https://front.invalid";
  process.env.PORTAL_API_KEY = "fixture-service-key";
  process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = "51";
  upstreamError = undefined;
  // Formatter fixtures must qualify for managerial getMaterial; a separate case proves read-only denial.
  fixture.nativePermissions.splice(0, fixture.nativePermissions.length, "officialInventory.read", "officialInventory.write");
  fixture.accountLookup.mockReset().mockImplementation(async (id: number) => id === fixture.account.id ? fixture.account : undefined);
  fixture.permissionLookup.mockReset().mockImplementation(async (id: number) => id === fixture.account.id ? [...fixture.nativePermissions] : []);
  fixture.scopeLookup.mockReset().mockImplementation(async () => fixture.scope);
  fixture.record.mockReset().mockResolvedValue(undefined);
  fixture.profileLocks.mockClear();
  // In-process HTTP adapters only. No TCP, database or production service exists.
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    return fetchRequestHandler({ endpoint: "/api/trpc", router: upstream, req, createContext: () => ({
      user: null, effectiveUserId: null, req: { headers: { "x-portal-key": req.headers.get("x-portal-key") } }, res: {},
    } as unknown as FrontContext) });
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [name, value] of [["PLATFORM_API_BASE", original.base], ["PORTAL_API_KEY", original.key], ["BUSINESS_WORKBENCH_MERCHANT_IDS", original.merchants]] as const) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

describe("front formatter -> service client -> admin business router -> admin formatter", () => {
  it.each([
    ["UNAUTHORIZED", undefined, "AUTH_SESSION_INVALID", 401],
    ["FORBIDDEN", "TENANT_ACCESS_REVOKED", "TENANT_ACCESS_REVOKED", 403],
    ["PRECONDITION_FAILED", "STAFF_BINDING_INVALID", "STAFF_BINDING_INVALID", 412],
    ["FORBIDDEN", undefined, "BUSINESS_RESOURCE_FORBIDDEN", 403],
  ] as const)("real %s + %s survives both formatters with %s", async (code, marker, expected, status) => {
    upstreamError = new TRPCError({ code, message: "fixture domain denial", cause: marker ? new FrontFailureCause(marker) : undefined });
    const result = await downstream();
    expect(result.status).toBe(status);
    expect(result.body.error.json.data).toMatchObject({ code, businessFailure: expected });
    expect(fixture.accountLookup).toHaveBeenCalledWith(303);
    expect(fixture.permissionLookup).toHaveBeenCalledWith(303);
    expect(fixture.profileLocks.mock.calls).toEqual([
      ["admin_users", "update"], ["admin_user_permissions", "update"], ["official_channel_team_members", "update"],
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fixture.record).not.toHaveBeenCalled();
  });

  it("a wrong service key stays denied/unavailable, never staff login invalid and never success", async () => {
    process.env.PORTAL_API_KEY = "wrong-service-key";
    const result = await downstream();
    expect(result.status).toBe(503);
    expect(result.body.error.json.data.code).toBe("SERVICE_UNAVAILABLE");
    expect(result.body.error.json.data.businessFailure == null).toBe(true);
    expect(fixture.record).not.toHaveBeenCalled();
  });

  it("scope disappearing at second read inside fence is tenant revoke, not resource denial", async () => {
    fixture.scopeLookup.mockResolvedValueOnce(fixture.scope).mockResolvedValueOnce(null);
    const result = await downstream();
    expect(result.status).toBe(403);
    expect(result.body.error.json.data.businessFailure).toBe("TENANT_ACCESS_REVOKED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("read-only official grant denies managerial getMaterial before any formatter or upstream call", async () => {
    fixture.nativePermissions.splice(0, fixture.nativePermissions.length, "officialInventory.read");
    const result = await downstream();
    expect(result.status).toBe(403);
    expect(result.body.error.json.data.businessFailure).toBe("BUSINESS_RESOURCE_FORBIDDEN");
    expect(fetch).not.toHaveBeenCalled();
    expect(fixture.record).not.toHaveBeenCalled();
  });

  it("service client preserves actual authenticated unauthorized instead of filtering to availability error", async () => {
    upstreamError = new TRPCError({ code: "UNAUTHORIZED", message: "真实登录已失效" });
    const promise = callPlatformBusinessCommand({ binding: { creditCode: "fixture", expectedOwnerUserId: 101 }, staffUserId: 202, bindingVersion: 7, adminActor: { id: 303, name: "fixture", role: "operations" }, method: "inventory.list", requestId: "fixture-request-001", params: {} });
    await expect(promise).rejects.toBeInstanceOf(PlatformBusinessPublicError);
    await expect(promise).rejects.not.toBeInstanceOf(PlatformBusinessServiceError);
    await expect(promise).rejects.toMatchObject({ code: "UNAUTHORIZED", businessFailure: "AUTH_SESSION_INVALID" });
  });

  it("BFF authorization revision retains server state and is stable across local scope array reorder", async () => {
    fixture.nativePermissions.splice(0, fixture.nativePermissions.length, "officialInventory.read");
    const first = await businessRouter.createCaller(context()).context();
    expect(first.authorizationVersion).toMatch(/^business-bff-auth-v1:[a-f0-9]{64}$/);
    expect(first.staffPrincipal).toMatchObject({ status: "ready", frontendUserId: 202, adminAccountId: 303, bindingVersion: 7, enterpriseId: 51 });
    expect(first.officialInventoryPermissions).toEqual({ read: true, write: false, note: false, publish: false, customerScopeRead: false, authorizationVersion: expect.stringMatching(/^official-inventory-v1:[a-f0-9]{64}$/) });
    fixture.scope.modulePermissions.reverse();
    const reordered = await businessRouter.createCaller(context()).context();
    expect(reordered.authorizationVersion).toBe(first.authorizationVersion);
    fixture.scope.scopeVersion++;
    const changed = await businessRouter.createCaller(context()).context();
    expect(changed.authorizationVersion).not.toBe(first.authorizationVersion);
    fixture.scope.scopeVersion--;
  });
});

describe("versioned closed audit resource correlation", () => {
  it("actual DB entry rejects unversioned/extended correlation before any database lookup", async () => {
    const { recordBusinessCommandAccess } = await vi.importActual<typeof import("./db")>("./db");
    await expect(recordBusinessCommandAccess({
      merchantId: 51, staffUserId: 202, bindingVersion: 7, scopeVersion: 3,
      method: "channelInventory.createMaterial", requestId: "bff-request-001",
      actor: { operatorId: 303, operatorName: "fixture", operatorRole: "merchant_mgr", ipAddress: null, userAgent: null },
      resourceCorrelation: { resourceType: "channel_material", resourceId: 901, actionRequestId: "domain-request-001", createdByUserId: 909 } as any,
    })).rejects.toThrow("BUSINESS_COMMAND_RESOURCE_CORRELATION_INVALID");
  });

  it("uses real result ID and original domain request; never client ID, creator or current owner", () => {
    const correlation = businessRouterTestUtils.channelCommandResource("channelInventory.createMaterial", {
      id: 666, resourceId: 666, createdByUserId: 666, responsibleUserId: 666, requestId: "domain-request-001",
    }, { item: { id: 901, createdByUserId: 202, responsibleUserId: 909 } });
    expect(correlation).toEqual({ schemaVersion: 1, resourceType: "channel_material", resourceId: 901, actionRequestId: "domain-request-001" });
    expect(validateBusinessCommandResourceCorrelation(correlation)).toEqual(correlation);
    expect(businessRouterTestUtils.channelCommandResource("channelInventory.createMaterial", { id: 666 }, { item: { id: "901" } })).toBeUndefined();
    expect(businessRouterTestUtils.channelCommandResource("channelInventory.getTeamMaterialSource", {}, { id: 901 })).toBeUndefined();
  });
  it.each([
    { schemaVersion: 2 }, { schemaVersion: undefined }, { resourceId: "901" }, { resourceId: 0 },
    { resourceType: "merchant" }, { actionRequestId: "bad" }, { creatorUserId: 202 }, { rawResult: { private: true } },
  ])("DB boundary rejects malformed/versionless/extended object %j", change => {
    const value = { schemaVersion: 1, resourceType: "channel_material", resourceId: 901, actionRequestId: "domain-request-001", ...change };
    expect(() => validateBusinessCommandResourceCorrelation(value)).toThrow("BUSINESS_COMMAND_RESOURCE_CORRELATION_INVALID");
  });
});
