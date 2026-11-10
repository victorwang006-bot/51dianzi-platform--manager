import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CUSTOMER_WORKBENCH_TABS, customerWorkbenchLocation, customerWorkbenchTab } from "./customerWorkbench";

describe("customer workbench URL and scoped layout", () => {
  it("has exactly the approved six tabs and fails invalid links to overview", () => {
    expect(CUSTOMER_WORKBENCH_TABS.map(tab => tab.label)).toEqual(["概览", "公司与联系人", "需求与报价", "订单与出货", "关联物料", "跟进记录"]);
    for (const tab of CUSTOMER_WORKBENCH_TABS) expect(customerWorkbenchTab(`tab=${tab.id}`)).toBe(tab.id);
    expect(customerWorkbenchTab("tab=bad&follow=1")).toBe("overview");
    expect(customerWorkbenchTab("tab=")).toBe("overview");
    expect(customerWorkbenchTab("follow=1")).toBe("followups");
    expect(customerWorkbenchTab("")).toBe("overview");
  });
  it("preserves merchant and source parameters without introducing another customer", () => {
    expect(customerWorkbenchLocation(801, "company", "merchantId=30061&source=list&follow=1")).toBe("/customers/801?merchantId=30061&source=list&tab=company");
    expect(customerWorkbenchLocation(801, "followups", "follow=1")).toBe("/customers/801?follow=1&tab=followups");
  });
  it("uses scoped geometry and inner horizontal scroll, not global typography, scaling or blanket overflow suppression", () => {
    const css = readFileSync("client/src/business/platform/client/src/components/customers/CustomerWorkbench.css", "utf8");
    expect(css).toContain("padding: 12px 16px"); expect(css).toContain("overflow-x: auto");
    expect(css).toContain(".erp-ui.customer-workbench [hidden]");
    expect(css).not.toMatch(/font-size:|!important|zoom:|scale\(|body\s*\{/);
  });
});
