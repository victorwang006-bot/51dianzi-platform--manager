import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import superjson from "superjson";
import type { TrpcContext } from "./_core/context";
import type { SalesOrderDraftPayload, SalesOrderDraftResult } from "../client/src/business/platform/shared/crmSalesOrderDrafts";

const fixture = vi.hoisted(() => ({
  bindings: new Map<number, { frontUserId: number; bindingVersion: number }>(),
  scopes: new Map<string, string[]>(), scopeReads: 0, revokeSecondRead: false,
  fenceHeld: false, fence: vi.fn(), audit: vi.fn(),
}));
// Only current DB acquisition and remote HTTP are fixture adapters. The BFF,
// real businessAccess checks/fence callback, platformBusinessApi serialization,
// and both tRPC input/output runtime schemas are the original implementations.
vi.mock("./db", () => ({
  withBusinessAuthorizationFence: async (key: unknown, run: () => Promise<unknown>) => {
    fixture.fence(key); fixture.fenceHeld = true;
    try { return await run(); } finally { fixture.fenceHeld = false; }
  },
  getActiveBusinessStaffBinding: async (adminUserId: number) => {
    expect(fixture.fenceHeld).toBe(true);
    const binding = fixture.bindings.get(adminUserId);
    return binding ? { id: 9, status: "active", adminUserId, ...binding } : null;
  },
  getActiveBusinessMerchantScope: async (adminUserId: number, merchantId: number) => {
    expect(fixture.fenceHeld).toBe(true); fixture.scopeReads++;
    const permissions = fixture.scopes.get(`${adminUserId}:${merchantId}`);
    return permissions && !(fixture.revokeSecondRead && fixture.scopeReads >= 2)
      ? { id: 10, adminUserId, merchantId, status: "active", scopeVersion: 3, modulePermissions: [...permissions] } : null;
  },
  getBusinessWorkbenchMerchantById: async (id: number) => [51, 52].includes(id) ? {
    id, merchantNo: `SYNTHETIC-${id}`, companyName: `虚构草稿公司${id}`, crmStatus: "enabled",
    registrationRegion: "CN", businessLicense: id === 51 ? "91440300MA5F7X2K9T" : "91310000MAH4E001XX",
    crmOwnerPortalUserId: id === 51 ? "99" : "199",
  } : null,
  recordBusinessCommandAccess: (...args: unknown[]) => fixture.audit(...args),
}));
import { businessRouter, BUSINESS_METHOD_CAPABILITIES } from "./businessRouter";

const methods = [["orderDraftGet", "read", "GET"], ["orderDraftSave", "write", "POST"], ["orderDraftDelete", "write", "POST"]] as const;
type DraftMethod = typeof methods[number][0];
type Command = { method: `crmSalesOrder.${DraftMethod}`; params: unknown; creditCode: string; expectedOwnerUserId: number;
  staffUserId: number; bindingVersion: number; requestId: string; adminActor: { id: number; name: string; role: string } };
const payload: SalesOrderDraftPayload = {
  customer: { id: 10, name: "虚构草稿客户", missingPhone: "" }, source: "company_stock", demandId: null,
  company: { lines: [{ lot: { lotId: 999, partNumber: "ABC#%_=", qty: 17 }, qty: "", price: "", savedExtra: [false, null, { text: "001" }] }],
    salesTaxMode: "tax_excluded", dueDate: "", confirmationNote: "", customerConfirmed: false,
    uncertain: { requestId: "original_company_request", items: [] }, keyword: "ABC#", catchall: { nested: { untouched: true } } },
  form: { selectedDemand: null, lines: [], dueDate: "", requestId: "original_demand_request", uncertainSave: false, decimal: "0.0000" },
};
let forwarded: Command[], stored: Map<string, NonNullable<SalesOrderDraftResult>>, override: { value: unknown } | undefined;
const upstreamConflict = () => new Response(JSON.stringify([{ error: { json: {
  message: "草稿已在其他页面更新，请重新读取并保留当前表单，不能自动覆盖", data: { code: "CONFLICT" },
} } }]), { status: 409, headers: { "content-type": "application/json" } });
function context(adminId: number | null = 303, merchantId = 51, status = "active"): TrpcContext {
  return { user: adminId === null ? null : { id: 777, role: "admin" },
    adminAccount: adminId === null ? null : { id: adminId, username: "synthetic", displayName: "虚构草稿操作员", adminRole: "merchant_mgr", status },
    adminPermissions: ["business.orders.read", "business.orders.write"],
    req: { headers: { "x-business-merchant-id": String(merchantId), cookie: "untrusted-cookie", authorization: "Bearer untrusted-token" }, ip: "203.0.113.9" }, res: {} } as unknown as TrpcContext;
}
const caller = (ctx = context()) => businessRouter.createCaller(ctx).crmSalesOrder;
const actions = (ctx = context()) => [() => caller(ctx).orderDraftGet({}),
  () => caller(ctx).orderDraftSave({ expectedRevision: 1, payload }), () => caller(ctx).orderDraftDelete({ expectedRevision: 1 })];
async function request(name: DraftMethod, input: unknown, method: "GET" | "POST", ctx = context()) {
  const encoded = JSON.stringify(superjson.serialize(input));
  const req = new Request(`https://draft-bff.invalid/trpc/crmSalesOrder.${name}${method === "GET" ? `?input=${encodeURIComponent(encoded)}` : ""}`, {
    method, ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: encoded } : {}),
  });
  const response = await fetchRequestHandler({ endpoint: "/trpc", router: businessRouter, req, createContext: () => ctx });
  const body = await response.json() as { result?: { data: Parameters<typeof superjson.deserialize>[0] } };
  return { status: response.status, value: body.result ? superjson.deserialize(body.result.data) : null };
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("PLATFORM_API_BASE", "https://draft-upstream.invalid");
  vi.stubEnv("PORTAL_API_KEY", "synthetic-draft-bff-key"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "51,52");
  fixture.bindings = new Map([[303, { frontUserId: 7, bindingVersion: 3 }], [304, { frontUserId: 7, bindingVersion: 4 }]]);
  fixture.scopes = new Map([["303:51", ["business.orders.read", "business.orders.write"]], ["304:51", ["business.orders.read", "business.orders.write"]], ["303:52", ["business.orders.read", "business.orders.write"]]]);
  fixture.scopeReads = 0; fixture.revokeSecondRead = false; fixture.fenceHeld = false; fixture.fence.mockReset(); fixture.audit.mockReset().mockResolvedValue(undefined);
  forwarded = []; stored = new Map(); override = undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(fixture.fenceHeld).toBe(true);
    const req = new Request(input, init);
    expect(req.url).toBe("https://draft-upstream.invalid/api/trpc/internalBusiness.execute?batch=1");
    expect(req.method).toBe("POST"); expect(req.headers.get("x-portal-key")).toBe("synthetic-draft-bff-key");
    expect(req.headers.get("cookie")).toBeNull(); expect(req.headers.get("authorization")).toBeNull();
    const command = (await req.json() as Record<string, { json: Command }>)["0"].json;
    forwarded.push(command);
    let value: unknown;
    if (override) value = override.value;
    else {
      // Synthetic remote draft storage is only a BFF transport/identity oracle;
      // real SQL/CAS and native authorizations are covered by platform router tests.
      const key = `${command.creditCode}:${command.staffUserId}:${command.adminActor.id}`;
      const current = stored.get(key);
      if (command.method === "crmSalesOrder.orderDraftGet") value = current ?? null;
      else if (command.method === "crmSalesOrder.orderDraftSave") {
        const params = command.params as { expectedRevision: number; payload: SalesOrderDraftPayload };
        if ((current?.revision ?? 0) !== params.expectedRevision) return upstreamConflict();
        const result = { draftId: current?.draftId ?? stored.size + 1, revision: (current?.revision ?? 0) + 1,
          updatedAt: "2026-11-17T16:00:00Z", payload: params.payload };
        stored.set(key, result); value = { revision: result.revision, updatedAt: result.updatedAt };
      } else {
        const params = command.params as { expectedRevision: number };
        if (!current || current.payload === null || params.expectedRevision <= 0 || current.revision !== params.expectedRevision) return upstreamConflict();
        const result = { ...current, revision: current.revision + 1, updatedAt: "2026-11-17T16:01:00Z", payload: null };
        stored.set(key, result); value = { revision: result.revision, updatedAt: result.updatedAt };
      }
    }
    return new Response(JSON.stringify([{ result: { data: { json: value } } }]), { status: 200, headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("three fixed order-draft BFF methods / real schemas / current authorization fence", () => {
  it.each(methods)("%s has one exact %s capability, no method selector, and input/output runtime validators", (name, mode) => {
    expect(BUSINESS_METHOD_CAPABILITIES.filter(value => value.method === `crmSalesOrder.${name}`)).toEqual([{ method: `crmSalesOrder.${name}`, module: "orders", mode }]);
    const defs = businessRouter._def.procedures as unknown as Record<string, { _def: { type: string; inputs: unknown[]; output?: unknown } }>;
    const def = defs[`crmSalesOrder.${name}`]._def;
    expect(def.type).toBe(mode === "read" ? "query" : "mutation"); expect(def.inputs).toHaveLength(1); expect(def.output).toBeDefined();
    expect(defs[`crmSalesOrder.${name}.extra`]).toBeUndefined(); expect(defs["crmSalesOrder.orderDraftExecute"]).toBeUndefined();
  });
  it("real POST/GET JSON transports preserve every incomplete company/demand field and mutation output", async () => {
    const saved = await request("orderDraftSave", { expectedRevision: 0, payload }, "POST");
    expect(saved).toEqual({ status: 200, value: { revision: 1, updatedAt: "2026-11-17T16:00:00Z" } });
    expect(forwarded[0]).toMatchObject({ method: "crmSalesOrder.orderDraftSave", params: { expectedRevision: 0, payload },
      creditCode: "91440300MA5F7X2K9T", expectedOwnerUserId: 99, staffUserId: 7, bindingVersion: 3,
      adminActor: { id: 303, name: "虚构草稿操作员", role: "merchant_mgr" } });
    expect(forwarded[0].requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(forwarded[0]).not.toHaveProperty("enterpriseId"); expect(forwarded[0]).not.toHaveProperty("actorUserId");
    const loaded = await request("orderDraftGet", {}, "GET");
    expect(loaded).toEqual({ status: 200, value: { draftId: 1, revision: 1, updatedAt: "2026-11-17T16:00:00Z", payload } });
    expect(forwarded[1].params).toEqual({});
    const deleted = await request("orderDraftDelete", { expectedRevision: 1 }, "POST");
    expect(deleted).toEqual({ status: 200, value: { revision: 2, updatedAt: "2026-11-17T16:01:00Z" } });
    expect(forwarded.map(value => value.method)).toEqual(["crmSalesOrder.orderDraftSave", "crmSalesOrder.orderDraftGet", "crmSalesOrder.orderDraftDelete"]);
    expect(fixture.audit).toHaveBeenCalledTimes(2);
    for (const [entry] of fixture.audit.mock.calls) { expect(entry).not.toHaveProperty("params"); expect(entry).not.toHaveProperty("result"); }
  });
  it("real BFF GET keeps tombstone revision for emptyState while stale revision 0/1 writes propagate CONFLICT (ABA)", async () => {
    const aLoaded = await caller().orderDraftGet({});
    expect(aLoaded).toBeNull();
    const aRevision = aLoaded?.revision ?? 0;
    expect((await request("orderDraftDelete", { expectedRevision: 0 }, "POST")).status).toBe(409);
    expect((await request("orderDraftSave", { expectedRevision: 0, payload }, "POST")).value).toMatchObject({ revision: 1 });
    expect((await request("orderDraftDelete", { expectedRevision: 1 }, "POST")).value).toMatchObject({ revision: 2 });
    const before = [...stored.entries()];
    expect((await request("orderDraftSave", { expectedRevision: aRevision, payload: {} }, "POST")).status).toBe(409);
    await expect(caller().orderDraftSave({ expectedRevision: 1, payload: {} })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await request("orderDraftDelete", { expectedRevision: 2 }, "POST")).status).toBe(409);
    expect([...stored.entries()]).toEqual(before);
    const tombstone = await request("orderDraftGet", {}, "GET");
    expect(tombstone).toEqual({ status: 200, value: { draftId: 1, revision: 2, updatedAt: "2026-11-17T16:01:00Z", payload: null } });
    const loadedEmptyState = (await caller().orderDraftGet({}))!;
    expect(loadedEmptyState.payload).toBeNull();
    expect(await request("orderDraftSave", { expectedRevision: loadedEmptyState.revision, payload: {} }, "POST"))
      .toEqual({ status: 200, value: { revision: 3, updatedAt: "2026-11-17T16:00:00Z" } });
    expect(await caller().orderDraftGet({})).toEqual({ draftId: 1, revision: 3, updatedAt: "2026-11-17T16:00:00Z", payload: {} });
    expect(stored.size).toBe(1);
  });
  it("get uses raw nested JSON no-audit bypass but never bypasses authorization or output schema", async () => {
    await caller().orderDraftSave({ expectedRevision: 0, payload }); fixture.audit.mockClear();
    fixture.audit.mockRejectedValue(new Error("generic audit must never run for draft get"));
    expect((await caller().orderDraftGet({}))?.payload).toEqual(payload);
    expect(fixture.audit).not.toHaveBeenCalled();
    override = { value: { draftId: 1, revision: 1, updatedAt: "2026-11-17T16:00:00Z", payload, unvalidated: true } };
    await expect(caller().orderDraftGet({})).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    fixture.scopes.delete("303:51"); const count = forwarded.length;
    await expect(caller().orderDraftGet({})).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(forwarded).toHaveLength(count);
  });
  it("read-only orders permits only get, and write-only cannot grant get", async () => {
    fixture.scopes.set("303:51", ["business.orders.read"]);
    await expect(caller().orderDraftGet({})).resolves.toBeNull();
    for (const action of actions().slice(1)) await expect(action()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(forwarded).toHaveLength(1);
    fixture.scopes.set("303:51", ["business.orders.write"]);
    await expect(caller().orderDraftGet({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(forwarded).toHaveLength(1);
  });
  it("valid backend accounts and companies forward independently without using compatibility-user/owner identity", async () => {
    const identities = [context(303, 51), context(304, 51), context(303, 52)];
    for (let index = 0; index < identities.length; index++) {
      expect(await caller(identities[index]).orderDraftGet({})).toBeNull();
      await caller(identities[index]).orderDraftSave({ expectedRevision: 0, payload: { form: { marker: index } } });
    }
    for (let index = 0; index < identities.length; index++) expect((await caller(identities[index]).orderDraftGet({}))?.payload).toEqual({ form: { marker: index } });
    await caller(identities[1]).orderDraftDelete({ expectedRevision: 1 });
    expect(await caller(identities[1]).orderDraftGet({})).toMatchObject({ revision: 2, payload: null });
    expect((await caller(identities[0]).orderDraftGet({}))?.payload).toEqual({ form: { marker: 0 } });
    expect(forwarded.every(value => value.staffUserId === 7 && value.adminActor.id !== 777 && value.adminActor.id !== value.expectedOwnerUserId)).toBe(true);
  });
  it.each(["binding", "scope", "fence-second-read", "cross-company", "unlisted-company", "disabled", "anonymous"] as const)("fresh %s rejection blocks all three fixed methods before upstream", async kind => {
    await caller().orderDraftSave({ expectedRevision: 0, payload }); forwarded = []; fixture.audit.mockClear();
    if (kind === "binding") fixture.bindings.delete(303);
    if (kind === "scope") fixture.scopes.delete("303:51");
    if (kind === "cross-company") fixture.scopes.delete("303:52");
    if (kind === "fence-second-read") { fixture.revokeSecondRead = true; fixture.scopeReads = 0; }
    const ctx = context(kind === "anonymous" ? null : 303, kind === "cross-company" ? 52 : kind === "unlisted-company" ? 999 : 51, kind === "disabled" ? "disabled" : "active");
    for (const action of actions(ctx)) await expect(action()).rejects.toMatchObject({ code: kind === "binding" ? "PRECONDITION_FAILED" : kind === "anonymous" ? "UNAUTHORIZED" : kind === "unlisted-company" ? "NOT_FOUND" : "FORBIDDEN" });
    expect(forwarded).toEqual([]); expect(fixture.audit).not.toHaveBeenCalled(); expect(stored.size).toBe(1);
  });
  it.each(methods)("raw JSON %s cannot inject method/identity or invoke a write with GET", async (name, _mode, http) => {
    const input = name === "orderDraftGet" ? {} : name === "orderDraftSave" ? { expectedRevision: 0, payload } : { expectedRevision: 1 };
    for (const key of ["enterpriseId", "actorUserId", "adminAccountId", "merchantId", "method"]) expect((await request(name, { ...input, [key]: key === "method" ? "order.refund" : 999 }, http)).status).toBe(400);
    if (http === "POST") expect((await request(name, input, "GET")).status).toBe(405);
    expect(forwarded).toEqual([]); expect(fixture.audit).not.toHaveBeenCalled();
  });
  it.each(methods)("%s rejects malformed upstream output instead of casting unknown or stripping fields", async (name, _mode, http) => {
    override = { value: name === "orderDraftGet" ? { draftId: 1, revision: 0, updatedAt: "now", payload } : { revision: "1", updatedAt: "now" } };
    const input = name === "orderDraftGet" ? {} : name === "orderDraftSave" ? { expectedRevision: 0, payload } : { expectedRevision: 1 };
    expect((await request(name, input, http)).status).toBe(500);
  });
});
