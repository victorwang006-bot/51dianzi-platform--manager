import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// Fully synthetic DB and authority. Real execute, staff principal, original
// sales router, schemas, module-policy service and sales read SQL stay intact.
const fixture = vi.hoisted(() => ({
  db: null as any,
  disabled: false,
  memberStatus: "active",
  erp: true,
  enterpriseId: 51,
  dataOwnerId: 404,
  ownerId: 101,
  permissions: ["customers.manage", "sales.business_orders"] as string[],
  deniedModule: "",
  queries: [] as { sql: string; params: unknown[]; bound: string }[],
  permission: vi.fn(),
  user: vi.fn(),
  crm: vi.fn(),
}));
vi.mock("../../51dianzi-platform/server/db", () => ({
  getDb: async () => fixture.db,
  getUserById: (...args: unknown[]) => fixture.user(...args),
}));
vi.mock("../../51dianzi-platform/server/adminCrmGateway", () => ({
  getAdminCrmAccess: async () => ({ allowed: fixture.erp }),
  getAdminHkCrmAccess: async () => ({ allowed: fixture.erp }),
}));
vi.mock(
  "../../51dianzi-platform/server/services/enterpriseAccess",
  async original => ({
    ...(await original<
      typeof import("../../51dianzi-platform/server/services/enterpriseAccess")
    >()),
    requireCrmEnterpriseAccess: (...args: unknown[]) => fixture.crm(...args),
  })
);
vi.mock(
  "../../51dianzi-platform/server/services/enterprisePermissions",
  async original => ({
    ...(await original<
      typeof import("../../51dianzi-platform/server/services/enterprisePermissions")
    >()),
    requireEnterprisePermission: (...args: unknown[]) =>
      fixture.permission(...args),
  })
);
vi.mock("../../51dianzi-platform/server/publicAuthUser", () => ({
  toPublicAuthUser: (user: { id: number }) => ({ id: user.id }),
}));

vi.mock("../../51dianzi-platform/server/antiScrape", () => ({
  anonViewExceeded: vi.fn(),
  clientIp: vi.fn(),
}));
vi.mock("../../51dianzi-platform/server/dailyQuota", () => ({
  DAILY_QUOTA_ERR_MSG: "synthetic",
  sharedDailyQuotaExceeded: vi.fn(),
}));
// Unrelated namespaces are unavailable by design; only the real sales router is exercised.
vi.mock("../../51dianzi-platform/server/routers/inventory", async () => ({
  inventoryRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock(
  "../../51dianzi-platform/server/routers/channelInventoryRuntime",
  async () => ({
    channelInventoryRouter: (
      await import("../../51dianzi-platform/server/_core/trpc")
    ).router({}),
  })
);
vi.mock("../../51dianzi-platform/server/routers/importInventory", async () => ({
  importInventoryRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/inbound", async () => ({
  inboundRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/customer", async () => ({
  customerRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/customerDemand", async () => ({
  customerDemandRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/purchaseOrder", async () => ({
  purchaseOrderRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/enterprise", async () => ({
  enterpriseRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/company", async () => ({
  companyRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/order", async () => ({
  orderRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/pickupPoint", async () => ({
  pickupPointRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/publicReview", async () => ({
  publicReviewRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/material", async () => ({
  materialRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/demand", async () => ({
  demandRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/chat", async () => ({
  chatRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock("../../51dianzi-platform/server/routers/cart", async () => ({
  cartRouter: (
    await import("../../51dianzi-platform/server/_core/trpc")
  ).router({}),
}));
vi.mock(
  "../../51dianzi-platform/server/routers/businessOrganization",
  async () => ({
    businessOrganizationRouter: (
      await import("../../51dianzi-platform/server/_core/trpc")
    ).router({}),
  })
);

import {
  BUSINESS_METHOD_IDS,
  BUSINESS_METHOD_CAPABILITIES,
  executeInternalBusinessMethod,
} from "../../51dianzi-platform/server/services/internalBusinessDelegation";
import { crmSalesOrderRouter } from "../../51dianzi-platform/server/routers/crmSalesOrder";
import { internalBusinessRouter } from "../../51dianzi-platform/server/routers/internalBusiness";
import { getEnterpriseRequestContext } from "../../51dianzi-platform/server/services/enterpriseRequestContext";

const dialect = new MySqlDialect();
const reads = ["customerSummary", "customerMaterials"] as const;
function execute(
  name: string,
  params: unknown = { customerId: 10 },
  binding = { creditCode: "91310000MAH4E001XX", expectedOwnerUserId: 101 }
) {
  return executeInternalBusinessMethod({
    method: `crmSalesOrder.${name}` as any,
    params,
    binding,
    staffUserId: 202,
    bindingVersion: 7,
    requestId: "synthetic-customer-read-001",
    adminActor: { id: 303, name: "synthetic", role: "operations" },
    req: { headers: {} } as any,
    res: {} as any,
  });
}
function setup() {
  fixture.db = {
    select: () => ({
      from: (table: any) => ({
        where: () => ({
          limit: async () => {
            // Drizzle schema table identity, not call-count-dependent fake authority.
            const { getTableName } = await import("drizzle-orm");
            return getTableName(table) === "enterprises"
              ? [
                  {
                    id: 51,
                    companyName: "synthetic",
                    superAdminUserId: fixture.ownerId,
                    crmDataOwnerUserId: 404,
                  },
                ]
              : [{ id: 1001, status: "active" }];
          },
        }),
      }),
    }),
    execute: async (query: any) => {
      const rendered = dialect.sqlToQuery(query);
      let index = 0;
      const bound = rendered.sql.replace(/\?/g, () =>
        JSON.stringify(rendered.params[index++])
      );
      fixture.queries.push({ ...rendered, bound });
      const result = (rows: unknown[]) => [rows, []];
      const member = {
        id: 1002,
        userId: 202,
        role: "member",
        status: fixture.memberStatus,
        loginDisabled: fixture.disabled ? 1 : 0,
        superAdminUserId: 101,
      };
      if (bound.includes("FROM enterprises e")) return result([member]);
      if (bound.includes("FROM enterprises WHERE"))
        return result([{ id: 51, superAdminUserId: 101 }]);
      if (bound.includes("FROM enterprise_members em")) return result([member]);
      if (bound.includes("FROM enterprise_member_permissions"))
        return result(
          fixture.permissions.map(permissionKey => ({ permissionKey }))
        );
      if (bound.includes("FROM enterprise_team_members")) return result([]);
      if (bound.includes("FROM enterprise_member_module_access"))
        return result(
          fixture.deniedModule &&
            bound.includes(`module = ${JSON.stringify(fixture.deniedModule)}`)
            ? [
                {
                  revision: 1,
                  readAllowed: 0,
                  writeAllowed: 0,
                  dataScope: "self",
                },
              ]
            : []
        );
      if (bound.includes("SELECT c.id FROM crm_customers c"))
        return result(bound.includes("c.id = 10") ? [{ id: 10 }] : []);
      if (bound.includes(") scoped"))
        return result([
          {
            totalOrders: "83",
            confirmedOrders: "80",
            cancelledOrders: "3",
            awaitingPaymentOrders: "17",
            awaitingShipmentOrders: "25",
            monthlyOrders: "12",
          },
        ]);
      if (bound.includes("FROM crm_sales_order_items i\n"))
        return result(bound.includes("COUNT(*)") ? [{ total: 61 }] : []);
      if (bound.includes("FROM crm_sales_orders o"))
        return result(bound.includes("COUNT(*)") ? [{ total: 0 }] : []);
      if (bound.includes("FROM crm_customer_demands d"))
        return result(bound.includes("COUNT(*)") ? [{ total: 0 }] : []);
      throw new Error(`Unexpected synthetic query: ${bound}`);
    },
  };
  fixture.user.mockImplementation(async (id: number) =>
    id === 202
      ? {
          id,
          role: "user",
          loginDisabled: fixture.disabled,
          lastSignedIn: new Date("2026-11-01"),
        }
      : undefined
  );
  fixture.crm.mockImplementation(async () => {
    if (!fixture.erp) throw new TRPCError({ code: "FORBIDDEN" });
    return { dataOwnerUserId: fixture.dataOwnerId };
  });
  fixture.permission.mockImplementation(
    async (id: number, permission: string) => {
      expect(id).toBe(202);
      if (
        fixture.memberStatus !== "active" ||
        !fixture.permissions.includes(permission)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "synthetic permission denied",
        });
      return {
        enterprise: { id: fixture.enterpriseId },
        member: {
          id: 1002,
          userId: id,
          enterpriseId: fixture.enterpriseId,
          status: fixture.memberStatus,
          role: "member",
        },
        permissionKeys: [...fixture.permissions],
        isOwner: false,
        dataOwnerUserId: fixture.dataOwnerId,
        portalOwnerUserId: fixture.dataOwnerId,
      };
    }
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(fixture, {
    disabled: false,
    memberStatus: "active",
    erp: true,
    enterpriseId: 51,
    dataOwnerId: 404,
    ownerId: 101,
    permissions: ["customers.manage", "sales.business_orders"],
    deniedModule: "",
    queries: [],
  });

  setup();
});

function noOrderReads() {
  expect(
    fixture.queries.some(query =>
      /FROM crm_(sales_order|customer_demand)/.test(query.sql)
    )
  ).toBe(false);
}

const local = vi.hoisted(() => ({
  account: {
    id: 303,
    username: "synthetic",
    displayName: "synthetic",
    adminRole: "merchant_mgr",
    status: "active",
    sessionVersion: 1,
  },
  binding: true,
  scope: true,
  merchantHeader: "51",
  crmStatus: "enabled",
  scopeCalls: 0,
  revokeSecondRead: false,
  scopes: ["business.orders.read"] as string[],
  audit: vi.fn(),
  contextAudit: vi.fn(),
  forwarded: [] as any[],
}));
vi.mock("./db", () => ({
  withBusinessAuthorizationFence: async (
    _: unknown,
    operation: () => Promise<unknown>
  ) => operation(),
  getActiveBusinessStaffBinding: async () =>
    local.binding
      ? {
          id: 9,
          adminUserId: 303,
          frontUserId: 202,
          bindingVersion: 7,
          status: "active",
        }
      : null,
  getActiveBusinessMerchantScope: async () => {
    local.scopeCalls++;
    return local.scope && !(local.revokeSecondRead && local.scopeCalls >= 2)
      ? {
          id: 10,
          adminUserId: 303,
          merchantId: 51,
          status: "active",
          scopeVersion: 3,
          modulePermissions: [...local.scopes],
        }
      : null;
  },
  getBusinessWorkbenchMerchantById: async (id: number) =>
    id === 51
      ? {
          id,
          merchantNo: "synthetic",
          companyName: "synthetic",
          crmStatus: local.crmStatus,
          registrationRegion: "CN",
          businessLicense: "91310000MAH4E001XX",
          crmOwnerPortalUserId: "101",
        }
      : null,
  recordBusinessCommandAccess: (...args: unknown[]) => local.audit(...args),
  recordBusinessContextAccess: (...args: unknown[]) =>
    local.contextAudit(...args),
}));
import {
  businessRouter,
  BUSINESS_METHOD_CAPABILITIES as BFF_CAPABILITIES,
} from "./businessRouter";
import { router as frontRouter } from "../../51dianzi-platform/server/_core/trpc";
const upstream = frontRouter({ internalBusiness: internalBusinessRouter });
const envKeys = [
  "PLATFORM_API_BASE",
  "PORTAL_API_KEY",
  "BUSINESS_WORKBENCH_MERCHANT_IDS",
] as const;
const originalEnv = Object.fromEntries(
  envKeys.map(name => [name, process.env[name]])
);
function context() {
  return {
    user: { id: 303, openId: "local_admin:303", role: "admin" },
    adminAccount: local.account,
    adminPermissions: [],
    req: {
      headers: { "x-business-merchant-id": local.merchantHeader },
      ip: "127.0.0.1",
    },
    res: {},
  } as any;
}
async function downstream(
  name: string,
  input: unknown = { customerId: 10 },
  method = "GET"
) {
  const encoded = encodeURIComponent(
    JSON.stringify(superjson.serialize(input))
  );
  const req = new Request(
    `https://admin.invalid/trpc/crmSalesOrder.${name}${method === "GET" ? `?input=${encoded}` : ""}`,
    {
      method,
      ...(method === "POST"
        ? {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(superjson.serialize(input)),
          }
        : {}),
    }
  );
  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    router: businessRouter,
    req,
    createContext: context,
  });
  return { status: response.status, body: await response.json() };
}
beforeEach(() => {
  Object.assign(local, {
    account: {
      id: 303,
      username: "synthetic",
      displayName: "synthetic",
      adminRole: "merchant_mgr",
      status: "active",
      sessionVersion: 1,
    },
    binding: true,
    scope: true,
    merchantHeader: "51",
    crmStatus: "enabled",
    scopeCalls: 0,
    revokeSecondRead: false,
    scopes: ["business.orders.read"],
    forwarded: [],
  });
  local.audit.mockReset().mockResolvedValue(undefined);
  local.contextAudit.mockReset().mockResolvedValue(undefined);
  process.env.PLATFORM_API_BASE = "https://front.invalid";
  process.env.PORTAL_API_KEY = "synthetic-service-key";
  process.env.BUSINESS_WORKBENCH_MERCHANT_IDS = "51";
  // No TCP request occurs: real transport serialisation is handled in-process.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      expect(req.url).toBe(
        "https://front.invalid/api/trpc/internalBusiness.execute?batch=1"
      );
      expect(req.method).toBe("POST");
      expect(req.headers.get("cookie")).toBeNull();
      expect(req.headers.get("authorization")).toBeNull();
      local.forwarded.push(await req.clone().json());
      return fetchRequestHandler({
        endpoint: "/api/trpc",
        router: upstream,
        req,
        createContext: () =>
          ({
            user: null,
            effectiveUserId: null,
            req: {
              headers: { "x-portal-key": req.headers.get("x-portal-key") },
            },
            res: {},
          }) as any,
      });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of envKeys) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
});

describe("customer workbench BFF -> actual internal execute -> original read SQL", () => {
  it.each(reads)(
    "%s exact BFF query does not 404 and keeps customerId through both real transports",
    async name => {
      const result = await downstream(name, {
        customerId: 10,
        keyword: "UNRELATED-NAME",
        enterpriseId: 999,
        actorUserId: 998,
        ownerUserId: 997,
      });
      expect(result.status).toBe(200);
      const value = superjson.deserialize(result.body.result.data) as any;
      expect(value).toEqual(
        name === "customerSummary"
          ? {
              customerId: 10,
              totalOrders: 83,
              confirmedOrders: 80,
              cancelledOrders: 3,
              awaitingPaymentOrders: 17,
              awaitingShipmentOrders: 25,
              monthlyOrders: 12,
            }
          : { items: [], total: 61, page: 1, pageSize: 20 }
      );
      expect(
        (businessRouter as any)._def.procedures[`crmSalesOrder.${name}`]._def
          .type
      ).toBe("query");
      expect(BUSINESS_METHOD_IDS).toContain(`crmSalesOrder.${name}`);
      expect(BUSINESS_METHOD_CAPABILITIES[`crmSalesOrder.${name}`]).toEqual({
        mode: "read",
        permission: "sales.business_orders",
      });
      expect(local.forwarded).toHaveLength(1);
      const payload = superjson.deserialize(local.forwarded[0]["0"]) as any;
      expect(payload).toMatchObject({
        method: `crmSalesOrder.${name}`,
        staffUserId: 202,
        bindingVersion: 7,
        expectedOwnerUserId: 101,
        creditCode: "91310000MAH4E001XX",
        adminActor: { id: 303 },
        params: { customerId: 10 },
      });
      expect(payload).not.toHaveProperty("enterpriseId");
      expect(payload).not.toHaveProperty("ownerUserId");
      expect(fixture.permission.mock.calls).toEqual([
        [202, "sales.business_orders"],
        [202, "sales.business_orders"],
      ]);
      const sql = fixture.queries.filter(q =>
        /(?:FROM|JOIN) crm_sales_orders o/.test(q.sql)
      );
      expect(sql.length).toBeGreaterThan(0);
      for (const query of sql) {
        expect(query.bound).toContain("o.customerId = 10");
        expect(query.bound).not.toContain("UNRELATED-NAME");
      }
      expect(fixture.queries.every(q => /^\s*SELECT\b/i.test(q.sql))).toBe(
        true
      );
    }
  );
  it.each(reads)(
    "%s is no-audit-DML read, never writes read body or command audit",
    async name => {
      expect((await downstream(name)).status).toBe(200);
      expect(local.audit).not.toHaveBeenCalled();
      expect(local.contextAudit).not.toHaveBeenCalled();
      expect(
        fixture.queries.some(q => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(q.sql))
      ).toBe(false);
    }
  );
  it.each([
    "customerOnly",
    "ordersWriteOnly",
    "bindingRevoked",
    "scopeRevoked",
    "fenceRevoked",
    "merchantDisabled",
    "wrongMerchant",
    "adminDisabled",
    "noActor",
  ])("local %s denies before any upstream network/DB", async failure => {
    if (failure === "customerOnly") local.scopes = ["business.customers.read"];
    if (failure === "ordersWriteOnly") local.scopes = ["business.orders.write"];
    if (failure === "bindingRevoked") local.binding = false;
    if (failure === "scopeRevoked") local.scope = false;
    if (failure === "fenceRevoked") local.revokeSecondRead = true;
    if (failure === "merchantDisabled") local.crmStatus = "disabled";
    if (failure === "wrongMerchant") local.merchantHeader = "52";
    if (failure === "adminDisabled") local.account.status = "disabled";
    if (failure === "noActor") local.account = null as any;
    for (const name of reads) {
      const result = await downstream(name);
      expect(result.status).toBeGreaterThanOrEqual(400);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(fixture.user).not.toHaveBeenCalled();
    expect(fixture.queries).toEqual([]);
    expect(local.audit).not.toHaveBeenCalled();
  });
  it.each([
    "customerPermissionOnly",
    "frontDisabled",
    "memberRevoked",
    "erpRevoked",
    "wrongEnterprise",
    "ownerChanged",
    "customersModule",
    "demandsModule",
  ])(
    "front %s propagates denial without order SQL, audit or secondary network",
    async failure => {
      if (failure === "customerPermissionOnly")
        fixture.permissions = ["customers.manage", "customers.manage_all"];
      if (failure === "frontDisabled") fixture.disabled = true;
      if (failure === "memberRevoked") fixture.memberStatus = "suspended";
      if (failure === "erpRevoked") fixture.erp = false;
      if (failure === "wrongEnterprise") fixture.enterpriseId = 52;
      if (failure === "ownerChanged") fixture.ownerId = 102;
      if (failure === "customersModule") fixture.deniedModule = "customers";
      if (failure === "demandsModule") fixture.deniedModule = "demands";
      for (const name of reads)
        expect((await downstream(name)).status).toBeGreaterThanOrEqual(400);
      expect(fetch).toHaveBeenCalledTimes(2);
      noOrderReads();
      expect(local.audit).not.toHaveBeenCalled();
    }
  );
  it.each(reads)(
    "%s requires exact typed positive customer and cannot use a keyword name instead",
    async name => {
      for (const params of [
        { keyword: "same-name" },
        { customerId: "10" },
        { customerId: 0 },
      ])
        expect((await downstream(name, params)).status).toBe(400);
      expect(
        (await downstream(name, { customerId: 11, keyword: "same-name" }))
          .status
      ).toBe(404);
      noOrderReads();
      expect(local.audit).not.toHaveBeenCalled();
    }
  );
  it("retains existing BFF order write scope and no browser-selected namespace expansion", async () => {
    expect(
      BFF_CAPABILITIES.find(cap => cap.method === "crmSalesOrder.*")
    ).toEqual({ method: "crmSalesOrder.*", module: "orders", mode: "write" });
    for (const name of ["create", "cancel", "recordPayment", "ship"]) {
      expect(
        (businessRouter as any)._def.procedures[`crmSalesOrder.${name}`]._def
          .type
      ).toBe("mutation");
      expect(
        (await downstream(name, { id: 1, version: 1 }, "POST")).status
      ).toBe(403);
    }
    expect((await downstream("customerWorkspace")).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("old list retains its previous successful generic command-audit policy", async () => {
    const result = await downstream("list", {
      keyword: "",
      page: 1,
      pageSize: 20,
      customerId: 10,
    });
    expect(result.status).toBe(200);
    expect(local.audit).toHaveBeenCalledTimes(1);
    const entry = local.audit.mock.calls[0][0];
    expect(entry.method).toBe("crmSalesOrder.list");
    expect(entry).not.toHaveProperty("params");
    expect(entry).not.toHaveProperty("result");
  });
});
