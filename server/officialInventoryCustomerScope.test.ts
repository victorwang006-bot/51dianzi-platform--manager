import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPlatformBusinessContext, signOfficialInventoryGrant, type OfficialInventoryPermissions } from "./platformBusinessApi";
import { canonicalOfficialInventoryJson, officialInventoryPermissionsSchema, signedOfficialInventoryGrantSchema } from "../client/src/business/platform/shared/internalBusinessOfficialInventory";
import { verifyOfficialInventoryGrant } from "../client/src/business/platform/front-router-types/server/services/internalBusinessOfficialGrant";

const key = "synthetic-customer-scope-signature-key";
const native: OfficialInventoryPermissions = { read: true, write: false, note: true, authorizationVersion: "official-inventory-v1:synthetic-unchanged-native-version" };
const target = { creditCode: "SYNTHETIC-CREDIT", expectedOwnerUserId: 101, staffUserId: 202,
  adminAccountId: 303, bindingVersion: 7, method: "channelInventory.getChannel", requestId: "synthetic-scope-request-001" };

beforeEach(() => { vi.stubEnv("PORTAL_API_KEY", key); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("request-local customer scope in the real official signer/verifier contract", () => {
  it.each([undefined, false, true])("optional customerScopeRead=%s survives schema, JSON and verifier without rewriting native slots/version", customerScopeRead => {
    const permissions = customerScopeRead === undefined ? { ...native } : { ...native, customerScopeRead };
    const grant = signOfficialInventoryGrant(permissions, target, key);
    const wire = signedOfficialInventoryGrantSchema.parse(JSON.parse(JSON.stringify(grant)));
    expect(verifyOfficialInventoryGrant(wire, target)).toEqual(permissions);
    if (customerScopeRead === undefined) expect(wire.permissions).not.toHaveProperty("customerScopeRead");
    const { signature, ...unsigned } = wire;
    expect(signature).toBe(createHmac("sha256", key).update(canonicalOfficialInventoryJson({ grant: unsigned, target })).digest("hex"));
  });

  it.each([false, true])("flipping or deleting a signed %s customer-scope bit fails the actual signature", customerScopeRead => {
    const grant = signOfficialInventoryGrant({ ...native, customerScopeRead }, target, key);
    expect(() => verifyOfficialInventoryGrant({ ...grant, permissions: { ...grant.permissions, customerScopeRead: !customerScopeRead } }, target))
      .toThrow("渠道库存受信授权无效");
    const { customerScopeRead: _overlay, ...withoutOverlay } = grant.permissions;
    expect(() => verifyOfficialInventoryGrant({ ...grant, permissions: withoutOverlay }, target)).toThrow("渠道库存受信授权无效");
  });

  it("adding a customer bit to a valid pre-overlay grant cannot authorize it", () => {
    const grant = signOfficialInventoryGrant(native, target, key);
    expect(() => verifyOfficialInventoryGrant({ ...grant, permissions: { ...grant.permissions, customerScopeRead: true } }, target))
      .toThrow("渠道库存受信授权无效");
  });

  it.each(["true", "false", 1, 0, null, {}, []])("strict optional bool rejects browser/coercion value %j", value => {
    expect(officialInventoryPermissionsSchema.safeParse({ ...native, customerScopeRead: value }).success).toBe(false);
  });

  it("permission JSON remains closed; optional overlay is not a new native-permission key", () => {
    expect(officialInventoryPermissionsSchema.safeParse({ ...native, customerScopeRead: false, "officialInventory.customerScopeRead": true }).success).toBe(false);
    expect(officialInventoryPermissionsSchema.parse({ ...native, customerScopeRead: true }).authorizationVersion).toBe(native.authorizationVersion);
  });

  it.each([false, true])("real internalBusiness.context wire carries and verifies signed customerScopeRead=%s", async customerScopeRead => {
    vi.stubEnv("PLATFORM_API_BASE", "https://context-fixture.invalid");
    const permissions = { ...native, customerScopeRead };
    const contextTarget = { ...target, method: "internalBusiness.context", requestId: "context-grant" };
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const parsedUrl = new URL(url);
      expect(parsedUrl.pathname).toBe("/api/trpc/internalBusiness.context");
      expect(init.method).toBe("GET"); expect(init.body).toBeUndefined();
      expect(init.headers).not.toHaveProperty("Cookie"); expect(init.headers).not.toHaveProperty("Authorization");
      const payload = JSON.parse(parsedUrl.searchParams.get("input")!)["0"].json;
      expect(payload).not.toHaveProperty("officialInventoryPermissions");
      const grant = signedOfficialInventoryGrantSchema.parse(payload.officialInventoryGrant);
      expect(verifyOfficialInventoryGrant(grant, contextTarget)).toEqual(permissions);
      expect(() => verifyOfficialInventoryGrant({ ...grant, permissions: { ...grant.permissions, customerScopeRead: !customerScopeRead } }, contextTarget))
        .toThrow("渠道库存受信授权无效");
      return new Response(JSON.stringify([{ result: { data: { json: {
        enterpriseId: 501, companyName: "fixture", dataOwnerUserId: 404, ownerUserId: 101,
        staffPrincipal: { status: "ready", frontendUserId: 202, adminAccountId: 303, enterpriseId: 501, bindingVersion: 7 },
        officialInventoryPermissions: permissions, workbenchCapabilities: ["inventory.channel"], enabledModules: ["inventory.channel"],
        sessionCapabilities: { chat: false, receptionReady: false },
      } } } }]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const context = await getPlatformBusinessContext({ creditCode: target.creditCode, expectedOwnerUserId: 101 },
      { staffUserId: 202, adminAccountId: 303, bindingVersion: 7, officialInventoryPermissions: permissions });
    expect(context.officialInventoryPermissions).toEqual(permissions); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
