import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  bound: true,
  scopeActive: true,
  scope: ["business.inventory.read", "business.inventory.write"] as string[],
  audit: vi.fn(),
  fence: vi.fn(),
  transport: vi.fn(),
}));
// The live official-team helper is independently exercised in officialChannelProfileRead.test.ts.
vi.mock("./services/officialChannelProfileRead", () => ({ withOfficialChannelProfileRead: async (_ctx: unknown, _staff: number, run: (proof: undefined) => Promise<unknown>) => run(undefined) }));
vi.mock("./db", async importOriginal => ({
  ...await importOriginal<object>(),
  getAdminUserById: async () => ({ id: 303, status: "active", adminRole: "super_admin", sessionVersion: 1 }),
  getAdminUserPermissions: async () => [],
  getActiveBusinessStaffBinding: async () => state.bound ? { frontUserId: 10, bindingVersion: 4 } : null,
  getActiveBusinessMerchantScope: async () => state.scopeActive ? { scopeVersion: 6, modulePermissions: state.scope } : null,
  getBusinessWorkbenchMerchantById: async () => ({ id: 51, merchantNo: "Synthetic", companyName: "Synthetic", crmStatus: "enabled", registrationRegion: "CN", businessLicense: "SYNTHETIC-CREDIT", crmOwnerPortalUserId: "99" }),
  withBusinessAuthorizationFence: async (key: unknown, fn: () => Promise<unknown>) => { state.fence(key); return fn(); },
  recordBusinessCommandAccess: async (input: unknown) => state.audit(input),
}));
import { businessRouter, BUSINESS_METHOD_CAPABILITIES } from "./businessRouter";
const ctx = () => ({ user: { id: 303, role: "admin" }, adminAccount: { id: 303, status: "active", username: "Synthetic", displayName: "Operator", adminRole: "super_admin" }, adminPermissions: [], req: { headers: { "x-business-merchant-id": "51" }, ip: "127.0.0.1" }, res: {} }) as never;
const requestId = "00000000-0000-4000-8000-000000000001";
const deletion = { items: [{ id: 101, expectedRevision: 1 }], requestId, expectedEnterpriseId: 99, expectedActorUserId: 10 };
beforeEach(() => {
  state.bound = true;
  state.scopeActive = true;
  state.scope = ["business.inventory.read", "business.inventory.write"];
  state.audit.mockClear(); state.fence.mockClear(); state.transport.mockClear();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "51");
  vi.stubEnv("PLATFORM_API_BASE", "http://synthetic.invalid");
  vi.stubEnv("PORTAL_API_KEY", "synthetic-key");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    state.transport(url, init);
    return new Response(JSON.stringify([{ result: { data: { json: { deletedCount: 1, skippedCount: 0, results: [{ id: 101, success: true }] } } } }]), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("channel inventory management BFF", () => {
  it("registers a closed, explicitly authorized management surface", () => {
    for (const name of ["deleteMaterials", "restoreMaterial", "createUploadBatch", "updateUploadBatch", "deleteUploadBatch"]) {
      expect(businessRouter._def.procedures[`channelInventory.${name}`]._def.type).toBe("mutation");
      expect(BUSINESS_METHOD_CAPABILITIES.find(c => c.method === `channelInventory.${name}`)?.mode).toBe("write");
    }
    for (const name of ["listDeletedMaterials", "listUploadBatches"]) {
      expect(businessRouter._def.procedures[`channelInventory.${name}`]._def.type).toBe("query");
      expect(BUSINESS_METHOD_CAPABILITIES.find(c => c.method === `channelInventory.${name}`)?.mode).toBe("read");
    }
    expect(businessRouter._def.procedures["channelInventory.previewDeleteUploadBatch"]._def.type).toBe("query");
    expect(BUSINESS_METHOD_CAPABILITIES.find(c => c.method === "channelInventory.previewDeleteUploadBatch")?.mode).toBe("write");
  });
  it("forwards an exact deletion under the existing binding fence and records staff identity", async () => {
    expect(await businessRouter.createCaller(ctx()).channelInventory.deleteMaterials(deletion)).toMatchObject({ deletedCount: 1 });
    expect(state.fence).toHaveBeenCalledWith({ adminUserId: 303, merchantId: 51 });
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ staffUserId: 10, merchantId: 51, method: "channelInventory.deleteMaterials", bindingVersion: 4, scopeVersion: 6 }));
    const [, init] = state.transport.mock.calls[0];
    const payload = JSON.parse(String(init.body))["0"].json;
    expect(payload).toMatchObject({ params: deletion, staffUserId: 10, expectedOwnerUserId: 99, bindingVersion: 4 });
    expect(init.headers).not.toHaveProperty("Cookie");
  });
  it("does not let a native super-admin bypass read-only merchant write scope", async () => {
    state.scope = ["business.inventory.read"];
    const caller = businessRouter.createCaller(ctx()).channelInventory;
    await expect(caller.deleteMaterials(deletion)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.restoreMaterial({ id: 101, expectedRevision: 1, requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.deleteUploadBatch({ id: 1, expectedRevision: 1, requestId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.previewDeleteUploadBatch({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).not.toHaveBeenCalled();
  });
  it.each(["enterpriseId", "ownerUserId", "teamId", "dataOwnerUserId", "method"])("rejects injected %s before transport", async field => {
    await expect(businessRouter.createCaller(ctx()).channelInventory.deleteMaterials({ ...deletion, [field]: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.transport).not.toHaveBeenCalled();
  });
  it("rejects empty or more-than-current-page deletion selections", async () => {
    const caller = businessRouter.createCaller(ctx()).channelInventory;
    await expect(caller.deleteMaterials({ ...deletion, items: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.deleteMaterials({ ...deletion, items: Array.from({ length: 101 }, (_, i) => ({ id: i + 1, expectedRevision: 1 })) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.transport).not.toHaveBeenCalled();
  });
  it("refuses a revoked binding or merchant scope", async () => {
    state.bound = false;
    await expect(businessRouter.createCaller(ctx()).channelInventory.deleteMaterials(deletion)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    state.bound = true; state.scopeActive = false;
    await expect(businessRouter.createCaller(ctx()).channelInventory.deleteMaterials(deletion)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).not.toHaveBeenCalled();
  });
});
