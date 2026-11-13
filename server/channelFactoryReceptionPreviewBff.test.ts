import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { signedOfficialInventoryGrantSchema, canonicalOfficialInventoryJson } from "../client/src/business/platform/shared/internalBusinessOfficialInventory";
const state = vi.hoisted(() => ({ permissions: [] as string[], scopes: [] as string[], binding: true, scope: true,
  accountActive: true, forwarded: [] as any[], result: undefined as unknown, audit: vi.fn() }));
vi.mock("./services/officialChannelProfileRead", () => ({ withOfficialChannelProfileRead: async (_ctx: unknown, _staff: number, run: (proof: unknown) => Promise<unknown>) => run(undefined) }));
vi.mock("./db", () => ({
  withBusinessAuthorizationFence: async (_key: unknown, run: () => Promise<unknown>) => run(),
  getActiveBusinessStaffBinding: async () => state.binding ? { frontUserId: 202, bindingVersion: 7 } : null,
  getAdminUserById: async () => ({ id: 303, status: state.accountActive ? "active" : "disabled", adminRole: "merchant_mgr", sessionVersion: 7 }),
  getAdminUserPermissions: async () => state.permissions,
  getActiveBusinessMerchantScope: async () => state.scope ? { scopeVersion: 4, modulePermissions: state.scopes } : null,
  getBusinessWorkbenchMerchantById: async () => ({ id: 51, crmStatus: "enabled", registrationRegion: "CN", businessLicense: "SYNTHETIC", crmOwnerPortalUserId: "101" }),
  recordBusinessCommandAccess: async (input: unknown) => state.audit(input),
}));
import { businessRouter } from "./businessRouter";
const ctx = { user: { id: 303, role: "admin" }, adminAccount: { id: 303, status: "active", sessionVersion: 7, adminRole: "merchant_mgr", username: "fixture" },
  req: { headers: { "x-business-merchant-id": "51" }, ip: "127.0.0.1" }, res: {} } as never;
const input = { materialId: 17, expectedRevision: 2, expectedEnterpriseId: 31, expectedActorUserId: 202 };
beforeEach(() => {
  state.permissions = ["officialInventory.read", "officialInventory.publish", "business.inventory.read", "business.inventory.write"];
  state.scopes = ["business.context.read", "business.inventory.read", "business.inventory.write"];
  state.binding = true; state.scope = true; state.accountActive = true; state.forwarded = []; state.audit.mockClear();
  state.result = { reception: { status: "ready", recipientName: "Actual employee", responsibilityVersion: 4, reason: null } };
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("BUSINESS_WORKBENCH_MERCHANT_IDS", "51");
  vi.stubEnv("PLATFORM_API_BASE", "https://synthetic-preview.invalid"); vi.stubEnv("PORTAL_API_KEY", "synthetic-preview-bff-key");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(String(url)).toMatch(/^https:\/\/synthetic-preview\.invalid\//);
    const payload = JSON.parse(String(init.body))["0"].json; state.forwarded.push(payload);
    expect(payload.method).toBe("channelInventory.previewFactoryMaterialReception");
    expect(payload.params).toEqual(input);
    const target = { creditCode: "SYNTHETIC", expectedOwnerUserId: 101, staffUserId: 202, adminAccountId: 303, bindingVersion: 7, method: payload.method, requestId: payload.requestId };
    const { signature, ...grant } = signedOfficialInventoryGrantSchema.parse(payload.officialInventoryGrant);
    expect(signature).toBe(createHmac("sha256", "synthetic-preview-bff-key").update(canonicalOfficialInventoryJson({ grant, target })).digest("hex"));
    expect(grant.expiresAt - grant.issuedAt).toBe(30_000);
    expect(grant.permissions).toMatchObject({ read: true, publish: true, write: false });
    return new Response(JSON.stringify([{ result: { data: { json: state.result } } }]), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("actual BFF selected material reception preview (no production transport or DB)", () => {
  it("forwards only fixed read query with fresh publish proof and returns strict summary without command-audit DML", async () => {
    expect(await businessRouter.createCaller(ctx).channelInventory.previewFactoryMaterialReception(input)).toEqual(state.result);
    expect(state.forwarded).toHaveLength(1); expect(state.audit).not.toHaveBeenCalled();
  });
  it.each(["publish", "read", "binding", "scope", "admin", "inventory-write", "context"])("current %s denial prevents forwarding", async denial => {
    if (denial === "publish") state.permissions = state.permissions.filter(k => k !== "officialInventory.publish");
    if (denial === "read") state.permissions = state.permissions.filter(k => k !== "officialInventory.read");
    if (denial === "binding") state.binding = false;
    if (denial === "scope") state.scope = false;
    if (denial === "admin") state.accountActive = false;
    if (denial === "inventory-write") state.scopes = state.scopes.filter(k => k !== "business.inventory.write");
    if (denial === "context") state.scopes = state.scopes.filter(k => k !== "business.context.read");
    await expect(businessRouter.createCaller(ctx).channelInventory.previewFactoryMaterialReception(input)).rejects.toMatchObject({
      code: denial === "binding" ? "PRECONDITION_FAILED" : denial === "admin" ? "UNAUTHORIZED" : "FORBIDDEN",
    });
    expect(state.forwarded).toHaveLength(0); expect(state.audit).not.toHaveBeenCalled();
  });
  it.each(["receiver", "sellerUserId", "recipientAdminUserId", "publicId", "method", "snapshot"])("strict parser refuses client %s and does not reach upstream", async key => {
    await expect(businessRouter.createCaller(ctx).channelInventory.previewFactoryMaterialReception({ ...input, [key]: 999 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.forwarded).toHaveLength(0); expect(state.audit).not.toHaveBeenCalled();
  });
  it("pending first-publication reason survives unchanged without inventing readiness", async () => {
    state.result = { reception: { status: "pending", recipientName: null, responsibilityVersion: 4, reason: "首次发布后须重新核验接待证据" } };
    expect(await businessRouter.createCaller(ctx).channelInventory.previewFactoryMaterialReception(input)).toEqual(state.result);
    expect(state.audit).not.toHaveBeenCalled();
  });
  it("rejects malformed/identity-bearing upstream summaries instead of serializing them", async () => {
    state.result = { reception: { status: "ready", recipientName: "Employee", responsibilityVersion: 4, recipientUserId: 202 } };
    await expect(businessRouter.createCaller(ctx).channelInventory.previewFactoryMaterialReception(input)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(state.audit).not.toHaveBeenCalled();
  });
});
