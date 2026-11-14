import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CUSTOMER_WORKBENCH_TABS, customerWorkbenchLocation, customerWorkbenchTab } from "./customerWorkbench";

describe("customer workbench URL and scoped layout", () => {
  it("has exactly the approved four tabs and defaults invalid or absent links to the customer profile", () => {
    expect(CUSTOMER_WORKBENCH_TABS.map(tab => tab.label)).toEqual(["客户档案", "需求与报价", "客户订单", "渠道库存"]);
    for (const tab of CUSTOMER_WORKBENCH_TABS) expect(customerWorkbenchTab(`tab=${tab.id}`)).toBe(tab.id);
    expect(customerWorkbenchTab("tab=bad&follow=1")).toBe("company");
    expect(customerWorkbenchTab("tab=")).toBe("company");
    expect(customerWorkbenchTab("follow=1")).toBe("company");
    expect(customerWorkbenchTab("")).toBe("company");
  });
  it("maps legacy overview and follow-up bookmarks to the profile without restoring extra tabs", () => {
    expect(customerWorkbenchTab("tab=overview")).toBe("company");
    expect(customerWorkbenchTab("tab=followups")).toBe("company");
    expect(customerWorkbenchTab("tab=followups&follow=1")).toBe("company");
    expect(CUSTOMER_WORKBENCH_TABS.map(tab => tab.id)).toEqual(["company", "demands", "orders", "inventory"]);
  });
  it("preserves legacy materials bookmarks and normalizes to the customer inventory tab", () => {
    expect(customerWorkbenchTab("tab=materials&merchantId=30061")).toBe("inventory");
    expect(customerWorkbenchLocation(801, customerWorkbenchTab("tab=materials"), "merchantId=30061&tab=materials&source=list")).toBe("/customers/801?merchantId=30061&tab=inventory&source=list");
    expect(CUSTOMER_WORKBENCH_TABS.some(tab => (tab.id as string) === "materials")).toBe(false);
  });
  it("preserves merchant, source and follow intent in the profile while clearing follow on other modules", () => {
    expect(customerWorkbenchLocation(801, "company", "merchantId=30061&source=list&follow=1")).toBe("/customers/801?merchantId=30061&source=list&follow=1&tab=company");
    expect(customerWorkbenchLocation(801, "company", "merchantId=30061&tab=followups&follow=1")).toBe("/customers/801?merchantId=30061&tab=company&follow=1");
    expect(customerWorkbenchLocation(801, "company", "merchantId=30061&tab=bad&follow=1")).toBe("/customers/801?merchantId=30061&tab=company");
    expect(customerWorkbenchLocation(801, "demands", "merchantId=30061&follow=1")).toBe("/customers/801?merchantId=30061&tab=demands");
  });
  it("keeps existing customer-list URL callers compatible until the detail normalizes them", () => {
    expect(customerWorkbenchLocation(801, "overview")).toBe("/customers/801?tab=overview");
    expect(customerWorkbenchLocation(801, "followups", "follow=1")).toBe("/customers/801?follow=1&tab=followups");
  });
  it("uses scoped geometry and inner horizontal scroll, not global typography, scaling or blanket overflow suppression", () => {
    const css = readFileSync("client/src/business/platform/client/src/components/customers/CustomerWorkbench.css", "utf8");
    expect(css).toContain("padding: 12px 16px"); expect(css).toContain("overflow-x: auto");
    expect(css).toContain(".erp-ui.customer-workbench [hidden]");
    expect(css).not.toMatch(/font-size:|!important|zoom:|scale\(|body\s*\{/);
  });
});
