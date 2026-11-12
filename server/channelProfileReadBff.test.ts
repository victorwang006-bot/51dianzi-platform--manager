import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyOfficialInventoryGrant } from "../../51dianzi-platform/server/services/internalBusinessOfficialGrant";
const state = vi.hoisted(() => ({ permissions: ["officialInventory.read"] as string[], projection: { ownerUserIds: [202, 203] } as { ownerUserIds: number[] } | undefined, scopes: [] as string[], binding: true, scope: true, upstreamFailure: false, helper: vi.fn(), audit: vi.fn(), forwarded: [] as any[] }));
vi.mock("./services/officialChannelProfileRead", () => ({ withOfficialChannelProfileRead: async (ctx: any, staff: number, run: (proof: unknown) => Promise<unknown>) => { state.helper(ctx.adminAccount.id, staff); return run(state.projection); } }));
vi.mock("./db", () => ({
  withBusinessAuthorizationFence: async (_key: unknown, run: () => Promise<unknown>) => run(),
  getActiveBusinessStaffBinding: async () => state.binding ? { frontUserId: 202, bindingVersion: 7 } : null,
  getAdminUserById: async () => ({ id: 303, status: "active", adminRole: "merchant_mgr", sessionVersion: 7 }),
  getAdminUserPermissions: async () => state.permissions,
  getActiveBusinessMerchantScope: async () => state.scope ? { scopeVersion: 4, modulePermissions: state.scopes } : null,
  getBusinessWorkbenchMerchantById: async () => ({ id: 51, crmStatus: "enabled", registrationRegion: "CN", businessLicense: "SYNTHETIC", crmOwnerPortalUserId: "101" }),
  recordBusinessCommandAccess: async (input: unknown) => state.audit(input),
}));
import { businessRouter } from "./businessRouter";
const ctx = { user: { id: 303, role: "admin" }, adminAccount: { id: 303, status: "active", sessionVersion: 7, adminRole: "merchant_mgr", username: "fixture" }, req: { headers: { "x-business-merchant-id": "51" }, ip: "127.0.0.1" }, res: {} } as never;
beforeEach(() => {
  state.permissions = ["officialInventory.read"]; state.projection = { ownerUserIds: [202, 203] }; state.scopes = ["business.context.read"]; state.binding = true; state.scope = true; state.upstreamFailure = false; state.helper.mockClear(); state.audit.mockClear(); state.forwarded = [];
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "51"); vi.stubEnv("PLATFORM_API_BASE", "https://synthetic.invalid"); vi.stubEnv("PORTAL_API_KEY", "synthetic-profile-bff-key");
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const payload = JSON.parse(String(init.body))["0"].json; state.forwarded.push(payload);
    const target = { creditCode: "SYNTHETIC", expectedOwnerUserId: 101, staffUserId: 202, adminAccountId: 303, bindingVersion: 7, method: payload.method, requestId: payload.requestId };
    const grant = verifyOfficialInventoryGrant(payload.officialInventoryGrant, target);
    expect(grant).toMatchObject({ read: true, write: false, note: false, ...(state.projection ? { channelProfileTeamRead: state.projection } : {}) });
    if (!state.projection) expect(grant).not.toHaveProperty("channelProfileTeamRead");
    expect(payload).not.toHaveProperty("officialInventoryPermissions");
    if (state.upstreamFailure) return new Response(JSON.stringify([{ error: { json: { message: "暂无权限查看", data: { code: "FORBIDDEN" } } } }]), { status: 403 });
    return new Response(JSON.stringify([{ result: { data: { json: ["channelInventory.listChannels", "channelInventory.listTeamMaterials"].includes(payload.method) ? { items: [{ id: 12, canEdit: false, readOnly: true }], total: 1 } : { id: 12, canEdit: false, readOnly: true } } } }]), { status: 200 });
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
  it("pure native-read ordinary member can request own profiles without ERP/local write or team proof", async () => {
    state.projection = undefined;
    await expect(businessRouter.createCaller(ctx).channelInventory.listChannels({})).resolves.toMatchObject({ total: 1 });
    expect(state.forwarded).toHaveLength(1);
    expect(state.forwarded[0].officialInventoryGrant.permissions).toMatchObject({ read: true, write: false });
    expect(state.forwarded[0].officialInventoryGrant.permissions).not.toHaveProperty("channelProfileTeamRead");
  });
  it("source/options/exact inventory requests carry fresh signed team projection, never a browser owner/team override", async () => {
    const caller = businessRouter.createCaller(ctx).channelInventory;
    await caller.listTeamMaterials({ channelId: 12 });
    await caller.listTeamSourceOptions({});
    await caller.getTeamMaterialSource({ materialId: 102 });
    expect(state.forwarded).toHaveLength(3); expect(state.helper).toHaveBeenCalledTimes(3);
    state.projection = { ownerUserIds: [202] };
    await caller.getTeamMaterialSource({ materialId: 102 });
    expect(state.forwarded[3].officialInventoryGrant.permissions.channelProfileTeamRead).toEqual({ ownerUserIds: [202] });
    expect(state.forwarded[3].officialInventoryGrant.signature).not.toBe(state.forwarded[2].officialInventoryGrant.signature);
    state.permissions = [];
    await expect(caller.listTeamSourceOptions({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.forwarded).toHaveLength(4);
  });
  it("team proof does not bypass independent export slot; explicitly authorized read export preserves the signed channel scope", async () => {
    const caller = businessRouter.createCaller(ctx).channelInventory;
    const input = { channelId: 12, expectedEnterpriseId: 31, expectedActorUserId: 202 };
    await expect(caller.exportChannelMaterials(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.forwarded).toEqual([]);
    state.permissions.push("business.inventory.read"); state.scopes.push("business.inventory.read");
    await caller.exportChannelMaterials(input);
    expect(state.forwarded).toHaveLength(1);
    expect(state.forwarded[0].officialInventoryGrant.permissions.channelProfileTeamRead).toEqual({ ownerUserIds: [202, 203] });
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
