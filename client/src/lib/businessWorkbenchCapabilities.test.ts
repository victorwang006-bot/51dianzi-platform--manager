import { describe, expect, it } from "vitest";
import {
  hasBusinessWorkbenchCapability,
} from "./businessWorkbenchCapabilities";

describe("工作台前台能力投影", () => {
  it("只接受 BFF 返回的能力，不读取或合入 native admin 权限", () => {
    expect(hasBusinessWorkbenchCapability(["inventory.read"], "inventory.read")).toBe(true);
    expect(hasBusinessWorkbenchCapability(["inventory.read"], "customers.manage")).toBe(false);
    expect(hasBusinessWorkbenchCapability(undefined, "inventory.read")).toBe(false);
  });

  it("商城 seller 入口是独立原生 actor 能力，不依赖 ERP 出库键", () => {
    expect(hasBusinessWorkbenchCapability(["marketplace.seller"], "marketplace.seller")).toBe(true);
    expect(hasBusinessWorkbenchCapability(["crm.sales_orders"], "marketplace.seller")).toBe(false);
  });
});
