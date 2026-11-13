import { describe, expect, it } from "vitest";
import { evaluateBffReadiness, type StaffAdminAccount, type StaffEnterpriseMember } from "./staffPermissionModel";
const admin = { id: 7, username: "reception", adminRole: "merchant_mgr", status: "active", permissions: ["profile.manage"], displayName: "接待员工", email: null, phone: null } as StaffAdminAccount;
const member = { memberId: 9, userId: 88, displayName: "接待员工", phone: null, role: "member", status: "active", permissionKeys: ["inquiry.receive"], inventoryDataScope: "own", isOwner: false } as StaffEnterpriseMember;
const evaluate = (modulePermissions: string[]) => evaluateBffReadiness({ admin, member, binding: { adminUserId: 7, frontUserId: 88, bindingVersion: 1 }, bindingState: "bound", scopeState: "ready", scope: { merchantId: 30061, modulePermissions }, expectedMerchantId: 30061 });
describe("inquiry-only staff readiness", () => {
  it("is ready with context plus independent reception without requiring inventory", () => {
    expect(evaluate(["business.context.read", "business.inquiries.read", "business.inquiries.write"]).state).toBe("ready");
  });
  it("does not use an adjacent inventory write to hide a missing explicit reception write", () => {
    const result = evaluate(["business.context.read", "business.inquiries.read", "business.inventory.read", "business.inventory.write"]);
    expect(result.state).toBe("scope-incomplete"); expect(result.missingPermissions).toEqual(["business.inquiries.write"]);
  });
  it("retains historic BFF scope only when the new reception family has not been configured", () => {
    expect(evaluate(["business.context.read", "business.inventory.read", "business.inventory.write"]).state).toBe("ready");
  });
});
