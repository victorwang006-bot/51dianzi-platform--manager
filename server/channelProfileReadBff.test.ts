import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyOfficialInventoryGrant } from "../../51dianzi-platform/server/services/internalBusinessOfficialGrant";
const state = vi.hoisted(() => ({ projection: { ownerUserIds: [202, 203] } as { ownerUserIds: number[] } | undefined, scopes: [] as string[], binding: true, scope: true, upstreamFailure: false, helper: vi.fn(), audit: vi.fn(), forwarded: [] as any[] }));
vi.mock("./services/officialChannelProfileRead", () => ({ withOfficialChannelProfileRead: async (ctx: any, staff: number, run: (proof: unknown) => Promise<unknown>) => { state.helper(ctx.adminAccount.id, staff); return run(state.projection); } }));
vi.mock("./db", () => ({
  withBusinessAuthorizationFence: async (_key: unknown, run: () => Promise<unknown>) => run(),
  getActiveBusinessStaffBinding: async () => state.binding ? { frontUserId: 202, bindingVersion: 7 } : null,
  getAdminUserById: async () => ({ id: 303, status: "active", adminRole: "merchant_mgr", sessionVersion: 7 }),
  getAdminUserPermissions: async () => ["officialInventory.read"],
  getActiveBusinessMerchantScope: async () => state.scope ? { scopeVersion: 4, modulePermissions: state.scopes } : null,
  getBusinessWorkbenchMerchantById: async () => ({ id: 51, crmStatus: "enabled", registrationRegion: "CN", businessLicense: "SYNTHETIC", crmOwnerPortalUserId: "101" }),
  recordBusinessCommandAccess: async (input: unknown) => state.audit(input),
}));
import { businessRouter } from "./businessRouter";
const ctx = { user: { id: 303, role: "admin" }, adminAccount: { id: 303, status: "active", sessionVersion: 7, adminRole: "merchant_mgr", username: "fixture" }, req: { headers: { "x-business-merchant-id": "51" }, ip: "127.0.0.1" }, res: {} } as never;
beforeEach(() => {
  state.projection = { ownerUserIds: [202, 203] }; state.scopes = ["business.context.read"]; state.binding = true; state.scope = true; state.upstreamFailure = false; state.helper.mockClear(); state.audit.mockClear(); state.forwarded = [];
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "51"); vi.stubEnv("PLATFORM_API_BASE", "https://synthetic.invalid"); vi.stubEnv("PORTAL_API_KEY", "synthetic-profile-bff-key");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body))["0"].json; state.forwarded.push(payload);
    const target = { creditCode: "SYNTHETIC", expectedOwnerUserId: 101, staffUserId: 202, adminAccountId: 303, bindingVersion: 7, method: payload.method, requestId: payload.requestId };
    const grant = verifyOfficialInventoryGrant(payload.officialInventoryGrant, target);
    expect(grant).toMatchObject({ read: true, write: false, note: false, channelProfileTeamRead: state.projection });
    expect(payload).not.toHaveProperty("officialInventoryPermissions");
    if (state.upstreamFailure) return new Response(JSON.stringify([{ error: { json: { message: "暂无权限查看", data: { code: "FORBIDDEN" } } } }]), { status: 403 });
    return new Response(JSON.stringify([{ result: { data: { json: payload.method.endsWith("listChannels") ? { items: [{ id: 12, canEdit: false, readOnly: true }], total: 1 } : { id: 12, canEdit: false, readOnly: true } } } }]), { status: 200 });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("actual businessRouter list/detail closed signed bridge", () => {
  it("only official manager list/detail bypasses missing local inventory-read slot, never writes/grants", async () => {
    const caller = businessRouter.createCaller(ctx);
    expect(await caller.channelInventory.listChannels({ expectedActorUserId: 202, expectedEnterpriseId: 31, page: 1 })).toMatchObject({ total: 1, items: [{ readOnly: true, canEdit: false }] });
    expect(await caller.channelInventory.getChannel({ id: 12 })).toMatchObject({ readOnly: true });
    expect(state.helper).toHaveBeenCalledTimes(2); expect(state.helper).toHaveBeenCalledWith(303, 202);
    await expect(caller.channelInventory.updateChannel({ id: 12, expectedRevision: 1, name: "not-allowed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.channelInventory.exportChannelMaterials({ channelId: 12, expectedEnterpriseId: 31, expectedActorUserId: 202 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.forwarded).toHaveLength(2); expect(state.scopes).toEqual(["business.context.read"]);
  });
  it("ordinary member projection absence preserves the original local grant requirement", async () => {
    state.projection = undefined;
    await expect(businessRouter.createCaller(ctx).channelInventory.listChannels({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.forwarded).toEqual([]);
  });
  it.each(["binding", "scope"] as const)("revalidates revoked %s and never forwards or manufactures zero", async key => {
    state[key] = false;
    await expect(businessRouter.createCaller(ctx).channelInventory.listChannels({})).rejects.toBeDefined();
    expect(state.forwarded).toEqual([]); expect(state.audit).not.toHaveBeenCalled();
  });
  it("upstream denial survives unchanged, no items=[]/total=0 success substitute", async () => {
    state.upstreamFailure = true;
    await expect(businessRouter.createCaller(ctx).channelInventory.listChannels({})).rejects.toMatchObject({ code: "FORBIDDEN", message: "暂无权限查看" });
    expect(state.audit).not.toHaveBeenCalled();
  });
});
