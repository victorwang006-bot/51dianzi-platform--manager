import { describe, expect, it } from "vitest";
import { staffStatusAction } from "./staffStatusUi";
import type { StaffAdminAccount } from "./staffPermissionModel";
const account = (overrides: Partial<StaffAdminAccount> = {}): StaffAdminAccount => ({ id: 20, username: "native-target", displayName: "目标后台员工", email: null, phone: null, adminRole: "merchant_mgr", status: "active", permissions: ["merchants.read"], ...overrides });
describe("Staff native status UI hints", () => {
  it("shows no status action for pure frontend rows or accounts without admins.manage", () => {
    expect(staffStatusAction(undefined, 10, true, 2)).toBeNull();
    expect(staffStatusAction(account(), 10, false, 2)).toBeNull();
  });
  it("uses only native id/username/status for the request target, not phone/name identity matching", () => {
    expect(staffStatusAction(account(), 10, true, 2)).toMatchObject({ label: "停用", allowed: true, target: { id: 20, username: "native-target", name: "目标后台员工", expectedStatus: "active", status: "disabled" } });
    expect(staffStatusAction(account({ status: "disabled" }), 10, true, 2)).toMatchObject({ label: "启用", allowed: true, target: { expectedStatus: "disabled", status: "active" } });
  });
  it("blocks self, archived, locked, unknown state and an unverified/final active super", () => {
    for (const value of [account({ id: 10 }), account({ status: "locked" }), account({ status: "unknown" }), account({ archive: { state: "completed", archivedAt: new Date(), merchantId: null } })])
      expect(staffStatusAction(value, 10, true, 2)).toMatchObject({ allowed: false, target: null });
    for (const count of [null, 0, 1]) expect(staffStatusAction(account({ adminRole: "super_admin" }), 10, true, count)).toMatchObject({ allowed: false, target: null });
    expect(staffStatusAction(account({ adminRole: "super_admin" }), 10, true, 2)?.allowed).toBe(true);
  });
});
