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
