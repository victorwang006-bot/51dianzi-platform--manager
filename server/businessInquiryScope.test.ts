import { describe, expect, it } from "vitest";
import { businessScopeAllows } from "./businessAccess";
import { projectBusinessSessionCapabilities, projectBusinessWorkbenchCapabilities } from "./businessWorkbenchProjection";
import { normalizeAssignedAdminPermissions, getAdminRolePermissions } from "../shared/adminPermissions";
const project = (permissions: string[], front = ["company.read", "inventory.read", "inquiry.receive"]) => projectBusinessWorkbenchCapabilities({ scope: { modulePermissions: permissions }, frontWorkbenchCapabilities: front });
describe("independent inquiry reception scope", () => {
  it("allows reception-only read and reply without any inventory/customer/personal chat grant", () => {
    const scope = { modulePermissions: ["business.context.read", "business.inquiries.read", "business.inquiries.write"] };
    expect(businessScopeAllows(scope, "inquiries", "read")).toBe(true);
    expect(businessScopeAllows(scope, "inquiries", "write")).toBe(true);
    expect(businessScopeAllows(scope, "inventory", "read")).toBe(false);
    expect(businessScopeAllows(scope, "inventory", "write")).toBe(false);
    const result = project(scope.modulePermissions);
    expect(result.workbenchCapabilities).toEqual(["company.read", "inquiry.receive"]);
    expect(result.writeCapabilities).toEqual(["inquiry.receive"]);
    expect(result.moduleAvailability.inventory).toEqual({ read: false, write: false });
    expect(projectBusinessSessionCapabilities({ projection: result, frontReceptionReady: true })).toEqual({ chat: false, receptionReady: true });
  });
  it("does not use adjacent inventory write to bypass explicit read-only reception", () => {
    const scope = { modulePermissions: ["business.inquiries.read", "business.inventory.read", "business.inventory.write"] };
    expect(businessScopeAllows(scope, "inquiries", "write")).toBe(false);
    expect(project(scope.modulePermissions).writeCapabilities).not.toContain("inquiry.receive");
  });
  it("preserves only pre-existing legacy scope modes when no explicit inquiry family exists", () => {
    expect(businessScopeAllows({ modulePermissions: ["business.inventory.read"] }, "inquiries", "read")).toBe(true);
    expect(businessScopeAllows({ modulePermissions: ["business.inventory.read"] }, "inquiries", "write")).toBe(false);
    expect(businessScopeAllows({ modulePermissions: ["business.context.read"] }, "inquiries", "read")).toBe(false);
  });
  it("still fails closed when the real frontend actor has no inquiry.receive", () => {
    const result = project(["business.inquiries.read", "business.inquiries.write"], ["inventory.read"]);
    expect(result.workbenchCapabilities).toEqual([]);
    expect(projectBusinessSessionCapabilities({ projection: result, frontReceptionReady: true }).receptionReady).toBe(false);
  });
  it("normalizes inquiry-write to inquiry-read without silently granting inventory", () => {
    const permissions = normalizeAssignedAdminPermissions(["business.inquiries.write"]);
    expect(permissions).toEqual(expect.arrayContaining(["business.inquiries.read", "business.inquiries.write"]));
    expect(permissions).not.toContain("business.inventory.read"); expect(permissions).not.toContain("business.inventory.write");
    expect(getAdminRolePermissions("merchant_mgr")).not.toContain("business.inquiries.write");
  });
});
