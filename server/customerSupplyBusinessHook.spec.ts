import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../client/src/business/platform/front-router-types/server/routers";
import { createBusinessTrpcClient } from "../client/src/business/api/business-trpc";
import type { TrpcContext } from "./_core/context";
import { verifyOfficialInventoryGrant } from "../client/src/business/platform/front-router-types/server/services/internalBusinessOfficialGrant";
import { signedOfficialInventoryGrantSchema } from "../shared/internalBusinessOfficialInventory";

const state = vi.hoisted(() => ({
  crmScope: true, nativeWrite: true, lockedNativeRead: true, lockedSessionVersion: 1, archivedActor: false, leaderBound: true,
  fenceHeld: false, profileHeld: false, tables: [] as string[], authoritySql: [] as string[],
  paths: [] as string[], forwarded: [] as Record<string, unknown>[], audit: vi.fn(),
}));
// Exercise the actual withOfficialChannelProfileRead/loadOfficialAccess chain.
// Only the three fixed SELECT builders and two read-only authority SQL queries
// exist here: no MySQL connection, permissive query fallback or write methods.
vi.mock("./db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const { MySqlDialect } = await import("drizzle-orm/mysql-core");
  const dialect = new MySqlDialect();
  const permissions = () => ["officialInventory.read", ...(state.nativeWrite ? ["officialInventory.write"] : [])];
  const tx = {
    select: (projection: Record<string, unknown>) => {
      let tableName = "";
      let predicate: any;
      const query = {
        from: (table: any) => { tableName = getTableName(table); state.tables.push(tableName); return query; },
        where: (value: any) => { predicate = value; return query; },
        limit: (limit: number) => { expect(limit).toBe(1); return query; },
        innerJoin: (table: any, condition: any) => {
          expect(tableName).toBe("official_channel_team_members"); expect(getTableName(table)).toBe("official_channel_teams");
          expect(dialect.sqlToQuery(condition).params).toEqual([]); return query;
        },
        orderBy: () => { expect(tableName).toBe("admin_user_permissions"); return query; },
        for: async (lock: string) => {
          expect(lock).toBe("update"); expect(state.fenceHeld).toBe(true); expect(state.profileHeld).toBe(true);
          const compiled = dialect.sqlToQuery(predicate);
          expect(compiled.params).toEqual([303]);
          if (tableName === "admin_users") {
            expect(Object.keys(projection)).toEqual(["id", "adminRole", "status", "sessionVersion"]);
            expect(compiled.sql).toBe("`admin_users`.`id` = ?");
            return [{ id: 303, status: "active", adminRole: "merchant_mgr", sessionVersion: state.lockedSessionVersion }];
          }
          if (tableName === "admin_user_permissions") {
            expect(Object.keys(projection)).toEqual(["permission"]);
            expect(compiled.sql).toBe("`admin_user_permissions`.`adminUserId` = ?");
            return (state.lockedNativeRead ? permissions() : []).map(permission => ({ permission }));
          }
          if (tableName === "official_channel_team_members") {
            expect(Object.keys(projection)).toEqual(["teamId", "role", "teamStatus"]);
            expect(compiled.sql).toBe("`official_channel_team_members`.`adminUserId` = ?");
            return [{ teamId: 71, role: "leader", teamStatus: "active" }];
          }
          throw new Error(`Unexpected official authorization SELECT: ${tableName}`);
        },
      };
      return query;
    },
    execute: async (statement: any) => {
      expect(state.fenceHeld).toBe(true); expect(state.profileHeld).toBe(true);
      const compiled = dialect.sqlToQuery(statement), text = compiled.sql.replace(/\s+/g, " ").trim();
      state.authoritySql.push(text);
      if (text === "SELECT archived.id FROM admin_staff_archives archived WHERE archived.adminUserId = ? LIMIT 1 FOR UPDATE") {
        expect(compiled.params).toEqual([303]); return [state.archivedActor ? [{ id: 1 }] : []];
      }
      if (text.startsWith("SELECT b.frontUserId AS ownerUserId, a.id AS recorderAdminAccountId FROM official_channel_team_members tm")) {
        expect(compiled.params).toEqual([71]);
        expect(text).toContain("t.status = 'active'"); expect(text).toContain("a.status = 'active'");
        expect(text).toContain("b.status = 'active'"); expect(text).toContain("archived.adminUserId = a.id");
        expect(text).toContain("duplicate_tm.id <> tm.id"); expect(text).toContain("duplicate_b.id <> b.id");
        expect(text).toContain("ORDER BY b.frontUserId LIMIT 501");
        return [state.leaderBound ? [{ ownerUserId: 202, recorderAdminAccountId: 303 }] : []];
      }
      throw new Error(`Unexpected official authorization SQL (SELECT-only fixture): ${text}`);
    },
  };
  return {
    withBusinessAuthorizationFence: async (key: unknown, operation: () => Promise<unknown>) => {
      expect(key).toEqual({ adminUserId: 303, merchantId: 51 }); expect(state.fenceHeld).toBe(false); state.fenceHeld = true;
      try { return await operation(); } finally { state.fenceHeld = false; }
    },
    getDb: async () => ({ transaction: async (operation: (transaction: typeof tx) => Promise<unknown>) => {
      expect(state.fenceHeld).toBe(true); expect(state.profileHeld).toBe(false); state.profileHeld = true;
      try { return await operation(tx); } finally { state.profileHeld = false; }
    } }),
    getAdminUserById: async () => ({ id: 303, status: "active", adminRole: "merchant_mgr", sessionVersion: 1 }),
    getAdminUserPermissions: async () => permissions(),
    getActiveBusinessStaffBinding: async () => ({ frontUserId: 202, bindingVersion: 7 }),
    getActiveBusinessMerchantScope: async () => ({ scopeVersion: 4, modulePermissions: ["business.inventory.read", "business.inventory.write", ...(state.crmScope ? ["business.customers.read"] : [])] }),
    getBusinessWorkbenchMerchantById: async () => ({ id: 51, merchantNo: "fixture", companyName: "fixture", crmStatus: "enabled", registrationRegion: "CN", businessLicense: "SYNTHETIC-CREDIT", crmOwnerPortalUserId: "101" }),
    recordBusinessCommandAccess: async (input: unknown) => state.audit(input),
  };
});
import { businessRouter } from "./businessRouter";

// These assignments are checked by pnpm check (the .spec.ts is intentionally
// included), using exactly the same AppRouter surface as the real React hook.
type Inputs = inferRouterInputs<AppRouter>["channelInventory"];
type Outputs = inferRouterOutputs<AppRouter>["channelInventory"];
const summaryInput: Inputs["customerSupplySummary"] = { customerIds: [11], expectedEnterpriseId: 501, expectedActorUserId: 202 };
const contextInput: Inputs["customerSupplyContext"] = { customerId: 11, expectedEnterpriseId: 501, expectedActorUserId: 202 };
const createInput: Inputs["createCustomerMaterial"] = { ...contextInput, expectedCustomerVersion: 2, sourceProfile: { type: "factory", existingChannelId: 31 }, partNumber: "FIXTURE-123", brand: "fixture", qty: 1, taxIncluded: false, requestId: "00000000-0000-4000-8000-000000000001" };
function assertClosedClientInput() {
  // @ts-expect-error Browser input has no channelId ownership/source decision.
  const invalidChannel: Inputs["createCustomerMaterial"] = { ...createInput, channelId: 31 };
  // @ts-expect-error CRM source company details cannot be supplied by the client.
  const invalidProfile: Inputs["createCustomerMaterial"] = { ...createInput, sourceProfile: { type: "factory", name: "untrusted company" } };
  // @ts-expect-error Expected actor and enterprise guards are mandatory on reads.
  const invalidRead: Inputs["customerSupplyContext"] = { customerId: 11 };
  // @ts-expect-error Customer version is mandatory on every material write.
  const invalidVersion: Inputs["createCustomerMaterial"] = { ...createInput, expectedCustomerVersion: undefined };
  // @ts-expect-error Material rules cannot infer an unspecified tax status.
  const invalidTax: Inputs["createCustomerMaterial"] = { ...createInput, taxIncluded: undefined };
  // @ts-expect-error CRM scope is signed server-side, never a browser input grant.
  const invalidScope: Inputs["createCustomerMaterial"] = { ...createInput, customerScopeRead: true };
  return [invalidChannel, invalidProfile, invalidRead, invalidVersion, invalidTax, invalidScope];
}
void assertClosedClientInput;

function assertCanonicalOutputTypes(summary: Outputs["customerSupplySummary"], context: Outputs["customerSupplyContext"], created: Outputs["createCustomerMaterial"]) {
  const materialCount: number = summary.items[0].materialCount;
  const channelId: number | null = summary.items[0].channelId;
  const canWrite: boolean = summary.canWrite;
  const version: number = context.customer.version;
  const phone: string | null = context.customer.phone;
  const industryCode: string | null = context.customer.industryCode;
  const active: boolean | undefined = context.channel?.active;
  const itemId: number = created.item.id;
  const customerId: number = created.customerId;
  const idempotent: boolean = created.idempotent;
  // @ts-expect-error Summary counts are numeric, never a client-side null mask.
  const invalidCount: null = summary.items[0].materialCount;
  // @ts-expect-error Source company data is not part of the material receipt.
  const invalidCompany = created.companyName;
  return { materialCount, channelId, canWrite, version, phone, industryCode, active, itemId, customerId, idempotent, invalidCount, invalidCompany };
}
void assertCanonicalOutputTypes;

function ctx(req: Request): TrpcContext {
  return { user: { id: 303, role: "admin" }, adminAccount: { id: 303, status: "active", sessionVersion: 1, username: "fixture", adminRole: "merchant_mgr" }, req: { headers: { "x-business-merchant-id": req.headers.get("x-business-merchant-id") ?? undefined }, ip: "127.0.0.1" }, res: {} } as unknown as TrpcContext;
}
beforeEach(() => {
  state.crmScope = true; state.nativeWrite = true; state.paths = []; state.forwarded = []; state.audit.mockReset();
  state.lockedNativeRead = true; state.lockedSessionVersion = 1; state.archivedActor = false; state.leaderBound = true;
  state.fenceHeld = false; state.profileHeld = false; state.tables = []; state.authoritySql = [];
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "51");
  vi.stubEnv("PLATFORM_API_BASE", "https://front-fixture.invalid"); vi.stubEnv("PORTAL_API_KEY", "synthetic-local-key");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(new URL(String(input), "https://admin-fixture.invalid"), init);
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/business-trpc/")) {
      state.paths.push(url.pathname.slice("/api/business-trpc/".length));
      expect(req.headers.get("x-business-merchant-id")).toBe("51");
      return fetchRequestHandler({ endpoint: "/api/business-trpc", router: businessRouter, req, createContext: () => ctx(req) });
    }
    expect(state.fenceHeld).toBe(true); expect(state.profileHeld).toBe(true);
    expect(url.origin).toBe("https://front-fixture.invalid");
    expect(url.pathname).toBe("/api/trpc/internalBusiness.execute");
    const payload = (await req.json())["0"].json as Record<string, unknown>;
    state.forwarded.push(payload);
    // Verify the real signer -> front verifier chain at the actual HTTP boundary.
    const target = { creditCode: "SYNTHETIC-CREDIT", expectedOwnerUserId: 101, staffUserId: 202,
      adminAccountId: 303, bindingVersion: 7, method: String(payload.method), requestId: String(payload.requestId) };
    const grant = signedOfficialInventoryGrantSchema.parse(payload.officialInventoryGrant);
    const permissions = verifyOfficialInventoryGrant(grant, target);
    expect(permissions).toMatchObject({ read: true, write: state.nativeWrite, note: false, customerScopeRead: true,
      authorizationVersion: expect.stringMatching(/^official-inventory-v1:/) });
    expect(permissions.channelProfileTeamRead).toEqual({ ownerUserIds: [202] });
    if (state.nativeWrite) expect(permissions.channelMaterialManagement).toEqual({ leaderAdminAccountId: 303, recorderBindings: [{ adminAccountId: 303, staffUserId: 202 }] });
    else expect(permissions.channelMaterialManagement).toBeUndefined();
    expect(() => verifyOfficialInventoryGrant(grant, { ...target, method: "channelInventory.createChannel" })).toThrow("渠道库存受信授权无效");
    expect(() => verifyOfficialInventoryGrant(grant, { ...target, requestId: "different-http-request" })).toThrow("渠道库存受信授权无效");
    expect(() => verifyOfficialInventoryGrant({ ...grant, permissions: { ...grant.permissions, customerScopeRead: false } }, target)).toThrow("渠道库存受信授权无效");
    const response = payload.method === "channelInventory.customerSupplySummary"
      ? { items: [{ customerId: 11, channelId: 31, materialCount: 1, canUpload: true, canViewStock: true, disabledReason: null }], canWrite: true }
      : payload.method === "channelInventory.customerSupplyContext"
        ? { customer: { id: 11, name: "fixture", industryCode: "semiconductor", version: 2, contactName: "fixture", phone: null, archivedAt: null }, channel: { id: 31, name: "fixture", type: "factory", industryCode: "semiconductor", active: true, revision: 1 }, canUpload: true, disabledReason: null }
        : { item: { id: 901 }, idempotent: false, customerId: 11, channelId: 31 };
    return new Response(JSON.stringify([{ result: { data: { json: response } } }]), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { expect(state.fenceHeld).toBe(false); expect(state.profileHeld).toBe(false); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("real typed business hook client -> HTTP BFF -> fixed signed RPC", () => {
  it("all three hooks have exact inferable inputs/outputs and use only the precise inventory RPC paths", async () => {
    const client = createBusinessTrpcClient(51);
    const summary: Outputs["customerSupplySummary"] = await client.channelInventory.customerSupplySummary.query(summaryInput);
    const context: Outputs["customerSupplyContext"] = await client.channelInventory.customerSupplyContext.query(contextInput);
    const created: Outputs["createCustomerMaterial"] = await client.channelInventory.createCustomerMaterial.mutate(createInput);
    expect(summary.items[0]).toMatchObject({ customerId: 11, canUpload: true, canViewStock: true });
    expect(context.customer.version).toBe(2); expect(context.channel?.id).toBe(31);
    expect(created).toMatchObject({ item: { id: 901 }, channelId: 31, customerId: 11 });
    expect(state.paths).toEqual(["channelInventory.customerSupplySummary", "channelInventory.customerSupplyContext", "channelInventory.createCustomerMaterial"]);
    expect(state.forwarded.map(value => value.method)).toEqual(state.paths);
    for (const payload of state.forwarded) expect(payload).toMatchObject({ staffUserId: 202, bindingVersion: 7, expectedOwnerUserId: 101, adminActor: { id: 303 }, officialInventoryGrant: { schemaVersion: 1, permissions: { read: true, write: true, note: false, customerScopeRead: true, authorizationVersion: expect.stringMatching(/^official-inventory-v1:/) } } });
    expect(state.audit.mock.calls[2][0]).toMatchObject({ resourceCorrelation: { resourceId: 901, resourceType: "channel_material", actionRequestId: createInput.requestId } });
  });

  it("typed summary RPC denies missing CRM scope before reaching front instead of treating native inventory read as CRM authority", async () => {
    state.crmScope = false;
    await expect(createBusinessTrpcClient(51).channelInventory.customerSupplySummary.query(summaryInput)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    expect(state.paths).toEqual(["channelInventory.customerSupplySummary"]);
    expect(state.forwarded).toEqual([]); expect(state.audit).not.toHaveBeenCalled();
  });

  it("typed write RPC denies native read-only and retains the read RPC", async () => {
    state.nativeWrite = false;
    const client = createBusinessTrpcClient(51);
    await client.channelInventory.customerSupplyContext.query(contextInput);
    await expect(client.channelInventory.createCustomerMaterial.mutate(createInput)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    expect(state.forwarded).toHaveLength(1);
  });

  it.each(["archived-actor", "stale-session", "locked-native-read", "missing-leader-binding"])("the real profile snapshot rejects %s before forwarding or audit", async failure => {
    if (failure === "archived-actor") state.archivedActor = true;
    if (failure === "stale-session") state.lockedSessionVersion = 2;
    if (failure === "locked-native-read") state.lockedNativeRead = false;
    if (failure === "missing-leader-binding") state.leaderBound = false;
    await expect(createBusinessTrpcClient(51).channelInventory.customerSupplyContext.query(contextInput)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    expect(state.paths).toEqual(["channelInventory.customerSupplyContext"]);
    expect(state.tables[0]).toBe("admin_users"); expect(state.forwarded).toEqual([]); expect(state.audit).not.toHaveBeenCalled();
  });
});
