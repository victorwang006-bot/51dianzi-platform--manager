import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  bound: true, scopeActive: true, activeAccount: true,
  permissions: [] as string[], scope: [] as string[],
  merchant: { id: 51, merchantNo: "SYNTHETIC", companyName: "SYNTHETIC", crmStatus: "enabled", registrationRegion: "CN", businessLicense: "SYNTHETIC-CREDIT", crmOwnerPortalUserId: "99" },
  audit: vi.fn(), fence: vi.fn(), transport: vi.fn(),
}));
// Actual official-team SQL is covered separately; this isolates the BFF fence.
vi.mock("./services/officialChannelProfileRead", () => ({ withOfficialChannelProfileRead: async (_ctx: unknown, _staff: number, run: (proof: undefined) => Promise<unknown>) => run(undefined) }));
vi.mock("./db", async importOriginal => ({
  ...await importOriginal<object>(),
  getAdminUserById: async () => ({ id: 303, status: state.activeAccount ? "active" : "disabled", adminRole: "merchant_mgr", sessionVersion: 1 }),
  getAdminUserPermissions: async () => state.permissions,
  getActiveBusinessStaffBinding: async () => state.bound ? { frontUserId: 10, bindingVersion: 4 } : null,
  getActiveBusinessMerchantScope: async () => state.scopeActive ? { scopeVersion: 6, modulePermissions: state.scope } : null,
  getBusinessWorkbenchMerchantById: async () => state.merchant,
  withBusinessAuthorizationFence: async (key: unknown, operation: () => Promise<unknown>) => { state.fence(key); return operation(); },
  recordBusinessCommandAccess: async (input: unknown) => state.audit(input),
}));
import { businessRouter, BUSINESS_METHOD_CAPABILITIES } from "./businessRouter";
const ctx = () => ({ user: { id: 303, role: "admin" }, adminAccount: { id: 303, status: "active", username: "Synthetic", displayName: "Synthetic Operator", adminRole: "merchant_mgr" }, adminPermissions: ["inventory.manage"], req: { headers: { "x-business-merchant-id": "51" }, ip: "127.0.0.1" }, res: {} }) as never;
const requestId = "00000000-0000-4000-8000-000000000001";
const noteParams = { materialId: 101, content: "private synthetic note", requestId };
const managementReads = ["listMaterials", "getMaterial", "listSharedMaterials", "exportChannelMaterials"] as const;
const notesMethods = ["notesList", "notesAdd", "notesEdit", "collaborationNotesList", "collaborationNotesAdd", "collaborationNotesEdit"] as const;
const paramsForNote = (method: typeof notesMethods[number]) => method.endsWith("Edit")
  ? { noteId: 1, expectedRevision: 1, content: "edited synthetic note", requestId }
  : method.endsWith("List") ? { materialId: 101, page: 1, pageSize: 20 } : noteParams;
beforeEach(() => {
  state.bound = true; state.scopeActive = true; state.activeAccount = true;
  state.permissions = ["officialInventory.read", "officialInventory.write", "officialInventory.note"];
  state.scope = ["business.inventory.read", "business.inventory.write"];
  state.merchant.crmStatus = "enabled"; state.merchant.crmOwnerPortalUserId = "99";
  state.audit.mockClear(); state.fence.mockClear(); state.transport.mockClear();
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "51");
  vi.stubEnv("PLATFORM_API_BASE", "http://synthetic.invalid"); vi.stubEnv("PORTAL_API_KEY", "synthetic-only-key");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    state.transport(url, init);
    return new Response(JSON.stringify([{ result: { data: { json: { item: { id: 1, authorUserId: 10, revision: 1 }, idempotent: false, items: [] } } } }]), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("recovered BFF official authorization without ERP rescue", () => {
  it.each(managementReads)("%s preserves its read DTO contract but rejects missing official write", async method => {
    state.permissions = ["officialInventory.read", "officialInventory.note"];
    expect(BUSINESS_METHOD_CAPABILITIES.find(item => item.method === `channelInventory.${method}`)?.mode).toBe("read");
    await expect(businessRouter.createCaller(ctx()).channelInventory[method]({ id: 101, channelId: 11 })).rejects.toMatchObject({ code: "FORBIDDEN", message: "未获渠道库存对应官方权限" });
    expect(state.transport).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
  it.each(managementReads)("%s also rejects official write without explicit management scope", async method => {
    state.scope = ["business.inventory.read"];
    await expect(businessRouter.createCaller(ctx()).channelInventory[method]({ id: 101, channelId: 11 })).rejects.toMatchObject({ code: "FORBIDDEN", message: "当前后台账号未获该商户的库存管理范围授权" });
    expect(state.transport).not.toHaveBeenCalled();
  });
  it.each(managementReads)("%s forwards current official write and management scope without checking native ERP role", async method => {
    await businessRouter.createCaller(ctx()).channelInventory[method]({ id: 101, channelId: 11 });
    expect(state.transport).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(state.transport.mock.calls[0][1].body))["0"].json;
    expect(payload).toMatchObject({ method: `channelInventory.${method}`, staffUserId: 10, bindingVersion: 4, expectedOwnerUserId: 99, officialInventoryGrant: { permissions: { read: true, write: true } } });
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ staffUserId: 10, scopeVersion: 6, method: `channelInventory.${method}` }));
  });
  it.each(notesMethods)("%s uses read+note, never official stock write, and retains its fixed scope mode", async method => {
    state.permissions = ["officialInventory.read", "officialInventory.note"];
    await businessRouter.createCaller(ctx()).channelInventory[method](paramsForNote(method));
    expect(state.transport).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(state.transport.mock.calls[0][1].body))["0"].json;
    expect(payload).toMatchObject({ method: `channelInventory.${method}`, officialInventoryGrant: { permissions: { read: true, write: false, note: true } } });
    expect(state.fence).toHaveBeenCalledWith({ adminUserId: 303, merchantId: 51 });
    expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ method: `channelInventory.${method}`, staffUserId: 10, bindingVersion: 4, scopeVersion: 6 }));
  });
  it.each(["notesAdd", "notesEdit"] as const)("%s still respects explicit private-note module write refusal", async method => {
    state.permissions = ["officialInventory.read", "officialInventory.note"];
    state.scope = ["business.inventory.read"];
    await expect(businessRouter.createCaller(ctx()).channelInventory[method](paramsForNote(method))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).not.toHaveBeenCalled();
  });
  it.each(notesMethods)("%s denies absent note even when stock write is present", async method => {
    state.permissions = ["officialInventory.read", "officialInventory.write"];
    await expect(businessRouter.createCaller(ctx()).channelInventory[method](paramsForNote(method))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.transport).not.toHaveBeenCalled();
  });
  it.each(["binding", "scope", "account", "CRM", "owner", "grant"])("fresh %s loss refuses forwarding, not cached official authority", async denial => {
    if (denial === "binding") state.bound = false;
    if (denial === "scope") state.scopeActive = false;
    if (denial === "account") state.activeAccount = false;
    if (denial === "CRM") state.merchant.crmStatus = "disabled";
    if (denial === "owner") state.merchant.crmOwnerPortalUserId = "invalid";
    if (denial === "grant") state.permissions = [];
    await expect(businessRouter.createCaller(ctx()).channelInventory.notesAdd(noteParams)).rejects.toMatchObject({ code: denial === "account" ? "UNAUTHORIZED" : denial === "binding" || denial === "CRM" || denial === "owner" ? "PRECONDITION_FAILED" : "FORBIDDEN" });
    expect(state.transport).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
  it("ordinary team inventory is still a read path and not a management/export write path", async () => {
    state.permissions = ["officialInventory.read"];
    state.scope = [];
    await businessRouter.createCaller(ctx()).channelInventory.listTeamMaterials({ page: 1, pageSize: 20 });
    expect(state.transport).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(state.transport.mock.calls[0][1].body))["0"].json;
    expect(payload).toMatchObject({ method: "channelInventory.listTeamMaterials", officialInventoryGrant: { permissions: { read: true, write: false, note: false } } });
  });
});
