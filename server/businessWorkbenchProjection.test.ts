import { describe, expect, it } from "vitest";
import {
  BUSINESS_WORKBENCH_CAPABILITIES,
  projectBusinessSessionCapabilities,
  projectBusinessWorkbenchCapabilities,
} from "./businessWorkbenchProjection";

function project(modulePermissions: string[], frontWorkbenchCapabilities = [...BUSINESS_WORKBENCH_CAPABILITIES]) {
  return projectBusinessWorkbenchCapabilities({
    scope: { modulePermissions },
    frontWorkbenchCapabilities,
  });
}

describe("业务工作台 scope capability 投影", () => {
  it("context.read 只能显示 company.read，不能把真实前台全量能力泄露到菜单", () => {
    const projection = project(["business.context.read"]);

    expect(projection.workbenchCapabilities).toEqual(["company.read"]);
    expect(projection.writeCapabilities).toEqual([]);
    expect(projection.canWrite).toBe(false);
    expect(projection.moduleAvailability.inventory).toEqual({ read: false, write: false });
    expect(projectBusinessSessionCapabilities({ frontReceptionReady: true, projection })).toEqual({
      chat: false,
      receptionReady: false,
    });
  });

  it("inventory.publish 仅在 inventory.write 下显示；其他前台列表能力按 read 显示、按 write 单列", () => {
    const readOnly = project(["business.inventory.read"], [
      "inventory.read",
      "inventory.channel",
      "inventory.publish",
      "inventory.inbound",
      "inquiry.receive",
    ]);
    expect(readOnly.workbenchCapabilities).toEqual([
      "inventory.read",
      "inventory.channel",
      "inventory.inbound",
      "inquiry.receive",
    ]);
    expect(readOnly.writeCapabilities).toEqual([]);

    const writable = project(["business.inventory.read", "business.inventory.write"], [
      "inventory.read",
      "inventory.channel",
      "inventory.publish",
      "inventory.inbound",
      "inquiry.receive",
    ]);
    expect(writable.workbenchCapabilities).toEqual([
      "inventory.read",
      "inventory.channel",
      "inventory.publish",
      "inventory.inbound",
      "inquiry.receive",
    ]);
    expect(writable.writeCapabilities).toEqual([
      "inventory.read",
      "inventory.channel",
      "inventory.publish",
      "inventory.inbound",
      "inquiry.receive",
    ]);
    expect(projectBusinessSessionCapabilities({ frontReceptionReady: true, projection: writable })).toEqual({
      chat: false,
      receptionReady: true,
    });
  });

  it("CRM、商城 seller、采购和成员管理分别映射其 BFF module，绝不由相邻前台细权混用", () => {
    const front = [
      "customers.manage",
      "crm.sales_orders",
      "procurement.demands",
      "procurement.orders",
      "enterprise.members.manage",
      "marketplace.seller",
    ];
    const readOnly = project([
      "business.customers.read",
      "business.orders.read",
      "business.procurement.read",
      "business.users.read",
    ], front);
    expect(readOnly.workbenchCapabilities).toEqual(front);
    expect(readOnly.writeCapabilities).toEqual([]);

    const writable = project([
      "business.customers.read", "business.customers.write",
      "business.orders.read", "business.orders.write",
      "business.procurement.read", "business.procurement.write",
      "business.users.read", "business.users.write",
    ], front);
    expect(writable.workbenchCapabilities).toEqual(front);
    expect(writable.writeCapabilities).toEqual(front);
    // Marketplace write remains only a display projection; the original front
    // sellerId row predicate is still enforced by the fixed command bridge.
    expect(writable.moduleAvailability.orders).toEqual({ read: true, write: true });
  });

  it("未知 capability 与没有对应 scope mode 的 capability 一律 fail closed", () => {
    const projection = project(["business.orders.write"], [
      "unknown.capability",
      "crm.sales_orders",
      "marketplace.seller",
      "inventory.publish",
    ]);
    expect(projection.workbenchCapabilities).toEqual([]);
    expect(projection.writeCapabilities).toEqual([]);
    expect(projection.canWrite).toBe(false);
  });
});

describe("factory publication capability stays independent and scope-bound", () => {
  it.each([
    { nativeRead: true, nativeWrite: false, nativePublish: true, scopeWrite: true, allowed: true },
    { nativeRead: true, nativeWrite: true, nativePublish: false, scopeWrite: true, allowed: false },
    { nativeRead: true, nativeWrite: true, nativePublish: true, scopeWrite: false, allowed: false },
    { nativeRead: false, nativeWrite: true, nativePublish: true, scopeWrite: true, allowed: false },
  ])("projects only explicit publish with live native read and scope write: %s", testCase => {
    const result = projectBusinessWorkbenchCapabilities({
      scope: { modulePermissions: ["business.inventory.read", ...(testCase.scopeWrite ? ["business.inventory.write"] : [])] },
      frontWorkbenchCapabilities: ["inventory.channel"],
      officialInventoryPermissions: { read: testCase.nativeRead, write: testCase.nativeWrite, note: false, publish: testCase.nativePublish, authorizationVersion: "isolated-fixture-native-version" },
    });
    expect(result.officialInventoryPermissions?.publish).toBe(testCase.allowed);
  });
});

describe("recovered official channel projection intersects current official module capability", () => {
  it.each([
    { read: true, write: true, scopeWrite: true, expectedWrite: true },
    { read: true, write: false, scopeWrite: true, expectedWrite: false },
    { read: true, write: true, scopeWrite: false, expectedWrite: false },
    { read: false, write: true, scopeWrite: true, expectedWrite: false },
  ])("keeps official read/write and explicit BFF scope intersection: %j", vector => {
    const result = projectBusinessWorkbenchCapabilities({
      scope: { modulePermissions: vector.scopeWrite ? ["business.inventory.write"] : [] },
      // The platform now derives this capability from official module flags, not ERP ownership.
      frontWorkbenchCapabilities: ["inventory.channel"],
      officialInventoryPermissions: { read: vector.read, write: vector.write, note: true, authorizationVersion: "synthetic-official-projection" },
    });
    expect(result.workbenchCapabilities.includes("inventory.channel")).toBe(vector.read);
    expect(result.writeCapabilities.includes("inventory.channel")).toBe(vector.expectedWrite);
    expect(result.officialInventoryPermissions).toMatchObject({ read: vector.read, write: vector.expectedWrite, note: vector.read });
    expect(result.moduleAvailability.inventory.write).toBe(vector.scopeWrite);
    expect(result.workbenchCapabilities).not.toContain("inventory.read");
  });
  it("note-only grant is independent but never provides stock write or export authority", () => {
    const result = projectBusinessWorkbenchCapabilities({
      scope: { modulePermissions: ["business.inventory.read", "business.inventory.write"] },
      frontWorkbenchCapabilities: ["inventory.channel"],
      officialInventoryPermissions: { read: true, write: false, note: true, authorizationVersion: "synthetic-note-only-projection" },
    });
    expect(result.workbenchCapabilities).toEqual(["inventory.channel"]);
    expect(result.writeCapabilities).toEqual([]);
    expect(result.canWrite).toBe(false);
    expect(result.officialInventoryPermissions).toMatchObject({ read: true, write: false, note: true, publish: false });
  });
  it("explicit official deny cannot be rescued by full native capabilities and local write scope", () => {
    const result = projectBusinessWorkbenchCapabilities({
      scope: { modulePermissions: ["business.inventory.read", "business.inventory.write"] },
      frontWorkbenchCapabilities: ["inventory.channel"],
      officialInventoryPermissions: { read: false, write: false, note: false, authorizationVersion: "synthetic-official-deny" },
    });
    expect(result.workbenchCapabilities).toEqual([]); expect(result.writeCapabilities).toEqual([]);
    expect(result.officialInventoryPermissions).toMatchObject({ read: false, write: false, note: false });
  });
});
