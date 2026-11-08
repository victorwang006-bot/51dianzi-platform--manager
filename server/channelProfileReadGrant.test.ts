import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signOfficialInventoryGrant } from "./platformBusinessApi";
import { signedOfficialInventoryGrantSchema, officialInventoryPermissionsSchema } from "../client/src/business/platform/shared/internalBusinessOfficialInventory";
import { verifyOfficialInventoryGrant } from "../client/src/business/platform/front-router-types/server/services/internalBusinessOfficialGrant";
const target = { creditCode: "SYNTHETIC", expectedOwnerUserId: 101, staffUserId: 202, adminAccountId: 303, bindingVersion: 7, method: "channelInventory.listChannels", requestId: "synthetic-profile-001" };
const key = "synthetic-profile-signing-key";
const permissions = { read: true, write: false, note: false, authorizationVersion: "official-profile-fixture", channelProfileTeamRead: { ownerUserIds: [202, 203] } };
beforeEach(() => vi.stubEnv("PORTAL_API_KEY", key));
afterEach(() => vi.unstubAllEnvs());
describe("closed signed read-only channel profile projection", () => {
  it("round-trips actual signer and verifier with unchanged native write/note slots", () => {
    const wire = signedOfficialInventoryGrantSchema.parse(JSON.parse(JSON.stringify(signOfficialInventoryGrant(permissions, target, key))));
    expect(verifyOfficialInventoryGrant(wire, target)).toEqual(permissions);
    expect(() => verifyOfficialInventoryGrant(wire, { ...target, method: "channelInventory.updateChannel" })).toThrow();
    expect(() => verifyOfficialInventoryGrant(wire, { ...target, staffUserId: 203 })).toThrow();
    expect(() => verifyOfficialInventoryGrant(wire, { ...target, expectedOwnerUserId: 999 })).toThrow();
    expect(() => verifyOfficialInventoryGrant({ ...wire, permissions: { ...permissions, channelProfileTeamRead: { ownerUserIds: [202, 999] } } }, target)).toThrow();
  });
  it.each([{ ownerUserIds: [] }, { ownerUserIds: [202, 202] }, { ownerUserIds: ["202"] }, { ownerUserIds: [202], teamId: 44 }, true])("rejects forged/open/coerced projection %j", channelProfileTeamRead => {
    expect(officialInventoryPermissionsSchema.safeParse({ ...permissions, channelProfileTeamRead }).success).toBe(false);
  });
  it("old signatures have no default team read and cannot acquire one", () => {
    const { channelProfileTeamRead: _read, ...old } = permissions;
    const signed = signOfficialInventoryGrant(old, target, key);
    expect(verifyOfficialInventoryGrant(signed, target)).not.toHaveProperty("channelProfileTeamRead");
    expect(() => verifyOfficialInventoryGrant({ ...signed, permissions }, target)).toThrow();
  });
});
