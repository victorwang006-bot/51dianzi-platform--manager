import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../client/src/business/platform/front-router-types/server/routers";
import { createBusinessTrpcClient } from "../client/src/business/api/business-trpc";
import { customerSetStarSchema, customerStarContextInputSchema, customerStarStateInputSchema } from "../client/src/business/platform/shared/customerStars";
import { customerListInputSchema as customerListSchema } from "../client/src/business/platform/front-router-types/server/customerListInput";
import type { TrpcContext } from "./_core/context";

const state = vi.hoisted(() => ({ read: true, binding: true, scope: true, paths: [] as string[], forwarded: [] as Record<string, any>[], audit: vi.fn(), fence: vi.fn() }));
vi.mock("./db", () => ({
  withBusinessAuthorizationFence: async (key: unknown, operation: () => Promise<unknown>) => { state.fence(key); return operation(); },
  getActiveBusinessStaffBinding: async () => state.binding ? { frontUserId: 202, bindingVersion: 7 } : null,
  getActiveBusinessMerchantScope: async () => state.scope ? { scopeVersion: 4, modulePermissions: state.read ? ["business.customers.read"] : [] } : null,
  getBusinessWorkbenchMerchantById: async () => ({ id: 51, merchantNo: "fixture", companyName: "fixture", crmStatus: "enabled", registrationRegion: "CN", businessLicense: "SYNTHETIC-CREDIT", crmOwnerPortalUserId: "101" }),
  recordBusinessCommandAccess: async (input: unknown) => state.audit(input),
}));
import { businessRouter, BUSINESS_METHOD_CAPABILITIES } from "./businessRouter";

type Inputs = inferRouterInputs<AppRouter>["customer"];
type Outputs = inferRouterOutputs<AppRouter>["customer"];
const contextInput: Inputs["starContext"] = undefined;
const setInput: Inputs["setStar"] = { customerId: 11, targetUserId: 202, starred: true, expectedRevision: 0,
  requestId: "00000000-0000-4000-8000-000000000001", expectedEnterpriseId: 501, expectedActorUserId: 202 };
const listInput: Inputs["list"] = { scope: "all", assignedUserId: 203, starUserId: 203, starredOnly: true, page: 1, pageSize: 20, keyword: "fixture", due: "overdue" };
function closedTypes() {
  // @ts-expect-error Strict star commands cannot select a merchant or grant role.
  const unknown: Inputs["setStar"] = { ...setInput, canManageAll: true };
  // @ts-expect-error There is no implicit toggle or optional revision.
  const revision: Inputs["setStar"] = { ...setInput, expectedRevision: undefined };
  // @ts-expect-error Every star command explicitly freezes its target boolean.
  const toggle: Inputs["setStar"] = { ...setInput, starred: undefined };
  // @ts-expect-error Every write includes the actor identity fence.
  const actor: Inputs["setStar"] = { ...setInput, expectedActorUserId: undefined };
  // @ts-expect-error Context is read without caller-selected actor/enterprise.
  const selectedContext: Inputs["starContext"] = { actorUserId: 999 };
  return [unknown, revision, toggle, actor, selectedContext];
}
void closedTypes;
function canonicalOutputs(context: Outputs["starContext"], result: Outputs["setStar"], list: Outputs["list"]) {
  const enterprise: number = context.enterpriseId;
  const target: number = context.targets[0].userId;
  const starred: boolean = result.isStarred;
  const revision: number = result.starRevision;
  const idempotent: boolean = result.idempotent;
  const rowStarred: boolean = list.items[0].isStarred;
  const rowRevision: number = list.items[0].starRevision;
  const rowTarget: number | null = list.items[0].starUserId;
  const allowed: boolean = list.items[0].canSetStar;
  // @ts-expect-error Output revisions are required numeric metadata, not optional.
  const absentRevision: undefined = list.items[0].starRevision;
  // @ts-expect-error Context does not project guessed team role or canManageAll.
  const inferredLeader = context.canManageAll;
  return { enterprise, target, starred, revision, idempotent, rowStarred, rowRevision, rowTarget, allowed, absentRevision, inferredLeader };
}
void canonicalOutputs;

function ctx(req: Request): TrpcContext {
  return { user: { id: 303, role: "admin" }, adminAccount: { id: 303, status: "active", username: "fixture", adminRole: "merchant_mgr" },
    req: { headers: { "x-business-merchant-id": req.headers.get("x-business-merchant-id") ?? undefined }, ip: "127.0.0.1" }, res: {} } as unknown as TrpcContext;
}
beforeEach(() => {
  state.read = true; state.binding = true; state.scope = true; state.paths = []; state.forwarded = []; state.audit.mockReset(); state.fence.mockReset();
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
    expect(url.origin).toBe("https://front-fixture.invalid"); expect(url.pathname).toBe("/api/trpc/internalBusiness.execute");
    const payload = (await req.json())["0"].json; state.forwarded.push(payload);
    expect(payload).toMatchObject({ creditCode: "SYNTHETIC-CREDIT", expectedOwnerUserId: 101, staffUserId: 202, bindingVersion: 7, adminActor: { id: 303 } });
    expect(payload).not.toHaveProperty("officialInventoryGrant");
    const params = payload.params;
    const response = payload.method === "customer.starContext"
      ? { enterpriseId: 501, actorUserId: 202, targets: [{ userId: 202, name: "self" }, { userId: 203, name: "same-team member" }] }
      : payload.method === "customer.starState"
        ? { enterpriseId: 501, actorUserId: 202, customerId: params.customerId, assignedUserId: 203,
          isStarred: true, starRevision: 3, starUserId: 203, canSetStar: true }
      : payload.method === "customer.list"
        ? { items: [{ id: 11, isStarred: false, starRevision: 0, starUserId: 203, canSetStar: true }], total: 1, page: 1, pageSize: 20 }
        : { customerId: params.customerId, targetUserId: params.targetUserId, isStarred: params.starred, starRevision: params.expectedRevision + 1, requestId: params.requestId,
          idempotent: state.forwarded.filter(item => item.method === "customer.setStar").length > 1 };
    return new Response(JSON.stringify([{ result: { data: { json: response } } }]), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("personal stars fixed BFF preference surface", () => {
  it("forwards exact assignee state under customer read and retains mode on list and explicit writes", async () => {
    const client = createBusinessTrpcClient(51);
    const input = { customerId: 11, starMode: "assignee" as const, expectedEnterpriseId: 501, expectedActorUserId: 202 };
    expect(await client.customer.starState.query(input)).toMatchObject({ customerId: 11, assignedUserId: 203, starUserId: 203, isStarred: true });
    expect(state.forwarded[0].params).toEqual(customerStarStateInputSchema.parse(input));
    await client.customer.list.query({ scope: "all", starMode: "assignee", page: 1, pageSize: 20 });
    expect(state.forwarded[1].params.starMode).toBe("assignee");
    await client.customer.setStar.mutate({ ...setInput, targetUserId: 203, starMode: "assignee" });
    expect(state.forwarded[2].params).toMatchObject({ targetUserId: 203, starMode: "assignee", starred: true });
    expect(BUSINESS_METHOD_CAPABILITIES.find(item => item.method === "customer.starState")).toMatchObject({ mode: "read" });
  });

  it("rejects caller-selected target and unknown modes on state reads and denies revoked CRM access", async () => {
    const client = createBusinessTrpcClient(51);
    const input = { customerId: 11, starMode: "assignee" as const, expectedEnterpriseId: 501, expectedActorUserId: 202 };
    for (const extra of [{ targetUserId: 999 }, { method: "customer.archive" }, { starMode: "all" }, { customerId: 0 }]) {
      await expect(client.customer.starState.query({ ...input, ...extra } as never)).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    }
    state.read = false;
    await expect(client.customer.starState.query(input)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    expect(state.forwarded).toEqual([]);
  });

  it("serializes true/false and omitted-false with every original list condition and delegated target intact", async () => {
    const client = createBusinessTrpcClient(51);
    for (const starredOnly of [true, false, undefined]) {
      const params = { ...listInput, starredOnly, grade: "A" as const, stage: "quoted" as const, archived: true, page: 3 };
      await client.customer.list.query(params);
      expect(state.forwarded.at(-1)?.params).toEqual(customerListSchema.parse(params));
      expect(state.forwarded.at(-1)?.params.starredOnly).toBe(starredOnly === true);
    }
    expect(state.paths).toEqual(["customer.list", "customer.list", "customer.list"]);
  });

  it("rejects non-boolean only-star filters before upstream and keeps the legacy input compatible", async () => {
    expect(customerListSchema.parse({}).starredOnly).toBe(false);
    const client = createBusinessTrpcClient(51);
    for (const starredOnly of ["true", "false", 1, 0, null]) {
      await expect(client.customer.list.query({ ...listInput, starredOnly } as never)).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    }
    expect(state.forwarded).toEqual([]);
  });

  it("forwards exact context/list/set methods with current merchant/staff binding; read context adds no audit writes", async () => {
    const client = createBusinessTrpcClient(51);
    const context = await client.customer.starContext.query(contextInput);
    expect(context.targets.map(item => item.userId)).toEqual([202, 203]); expect(state.audit).not.toHaveBeenCalled();
    const list = await client.customer.list.query(listInput); expect(list.items[0]).toMatchObject({ starUserId: 203, starRevision: 0, canSetStar: true });
    const result = await client.customer.setStar.mutate(setInput); expect(result).toMatchObject({ customerId: 11, targetUserId: 202, isStarred: true, starRevision: 1, requestId: setInput.requestId });
    expect(state.paths).toEqual(["customer.starContext", "customer.list", "customer.setStar"]);
    expect(state.forwarded.map(item => item.method)).toEqual(state.paths);
    expect(state.forwarded[2].params).toEqual(setInput); expect(state.forwarded[1].params).toMatchObject(listInput);
    expect(state.fence).toHaveBeenCalledWith({ adminUserId: 303, merchantId: 51 });
    expect(state.audit.mock.calls.map(call => call[0].method)).toEqual(["customer.list", "customer.setStar"]);
  });

  it("allows only this narrow preference mutation on customer read while normal writes remain denied", async () => {
    const client = createBusinessTrpcClient(51); await client.customer.setStar.mutate(setInput);
    await expect(client.customer.archive.mutate({ id: 11, version: 1, reason: "fixture" })).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    expect(state.forwarded.map(item => item.method)).toEqual(["customer.setStar"]);
    expect(BUSINESS_METHOD_CAPABILITIES.find(item => item.method === "customer.setStar")).toMatchObject({ module: "customers", mode: "read" });
    expect(BUSINESS_METHOD_CAPABILITIES.find(item => item.method === "customer.*")).toMatchObject({ mode: "write" });
  });

  it("denies current CRM read revocation, staff binding revocation and missing merchant scope before any upstream call", async () => {
    const client = createBusinessTrpcClient(51); state.read = false;
    await expect(client.customer.setStar.mutate(setInput)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    state.read = true; state.binding = false;
    await expect(client.customer.starContext.query()).rejects.toMatchObject({ data: { code: "PRECONDITION_FAILED" } });
    state.binding = true; state.scope = false;
    await expect(client.customer.setStar.mutate(setInput)).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
    expect(state.forwarded).toEqual([]); expect(state.audit).not.toHaveBeenCalled();
  });

  it("rejects unknown fields/implicit toggles/identity-selected context at the fixed input boundary", async () => {
    for (const payload of [{ ...setInput, canManageAll: true }, { ...setInput, method: "customer.archive" }, { ...setInput, expectedRevision: undefined }, { ...setInput, starred: undefined }, { ...setInput, expectedActorUserId: undefined }]) {
      expect(customerSetStarSchema.safeParse(payload).success).toBe(false);
      await expect(businessRouter.createCaller(ctx(new Request("https://fixture.invalid", { headers: { "x-business-merchant-id": "51" } }))).customer.setStar(payload as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(customerStarContextInputSchema.safeParse({ actorUserId: 999 }).success).toBe(false);
    await expect(businessRouter.createCaller(ctx(new Request("https://fixture.invalid", { headers: { "x-business-merchant-id": "51" } }))).customer.starContext({ actorUserId: 999 } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.forwarded).toEqual([]); expect(state.audit).not.toHaveBeenCalled();
  });

  it("preserves the original action requestId/revision/boolean on transport retry, independently of BFF envelope IDs", async () => {
    const client = createBusinessTrpcClient(51); await client.customer.setStar.mutate(setInput);
    const retry = await client.customer.setStar.mutate(setInput); expect(retry.idempotent).toBe(true);
    expect(state.forwarded[0].params).toEqual(state.forwarded[1].params);
    expect(state.forwarded[0].requestId).not.toBe(state.forwarded[1].requestId);
    expect(retry.requestId).toBe(setInput.requestId);
  });
});
