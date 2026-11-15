import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_BUSINESS_WORKBENCH_PATHS, ADMIN_WORKBENCH_NAVIGATION_GROUPS } from "./adminWorkbenchNavigationModel";
import { getClosedAdminEntryNavigationTarget, getAdminWorkspaceNavigationState, groupAdminBusinessNavigationItems } from "./adminWorkspaceNavigationModel";

const items = [{ path: "/workbench/inbound", label: "采购入库" }, { path: "/workbench/procurement-demands", label: "采购需求" }, { path: "/workbench/procurement-orders", label: "退役订单" }, { path: "/workbench/orders", label: "销售订单" }, { path: "/orders", label: "商城订单" }];

describe("procurement orders retired before mount", () => {
  it.each(["/workbench/procurement-orders", "/workbench/procurement-orders/quote", "/workbench/procurement-orders/accepted", "/workbench/procurement-orders/create", "/workbench/procurement-orders/99/deep", "/workbench/procurement/orders", "/workbench/procurement/orders/99"])("closes old prefix %s to live procurement inbound", path => {
    expect(getClosedAdminEntryNavigationTarget(`${path}?merchantId=30061&returnTo=https://evil.invalid&orderSource=mall#old`)).toBe("/workbench/inbound?merchantId=30061");
    expect(getAdminWorkspaceNavigationState(items, path).activeItem).toBe(items[0]);
    expect(getAdminWorkspaceNavigationState(items.filter(item => item !== items[0]), path).activeItem).toBeNull();
  });
  it.each(["merchantId=1&merchantId=2", "merchantId=not-number", "merchantId=9007199254740992", "merchantId=0", "returnTo=/orders"])("drops unsafe query %s instead of inferring identity", query => {
    expect(getClosedAdminEntryNavigationTarget(`/workbench/procurement-orders?${query}`)).toBe("/workbench/inbound");
  });
  it("never closes procurement demands, sales or mall routes or unrelated similar prefixes", () => {
    for (const path of ["/workbench/procurement-demands", "/workbench/procurement/demands", "/workbench/demand-quotes", "/workbench/orders", "/workbench/outbound", "/orders/88", "/workbench/procurement-orders-other"]) expect(getClosedAdminEntryNavigationTarget(path)).toBeNull();
    const grouped = groupAdminBusinessNavigationItems(items).flatMap(entry => entry.kind === "direct" ? [entry.item.path] : entry.items.map(item => item.path));
    expect(grouped).toContain("/workbench/procurement-demands"); expect(grouped).toContain("/workbench/orders"); expect(grouped).not.toContain("/workbench/procurement-orders");
    expect(ADMIN_BUSINESS_WORKBENCH_PATHS).not.toContain("/workbench/procurement-orders"); expect(ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths)).toContain("/orders");
  });
  it("App returns the existing redirect before any business route render and workbench cannot import or mount the old page", () => {
    const app = readFileSync("client/src/App.tsx", "utf8");
    const gate = app.indexOf("if (closedEntryTarget)"); const switchIndex = app.indexOf("<Switch>", gate);
    expect(gate).toBeGreaterThan(0); expect(switchIndex).toBeGreaterThan(gate);
    const guard = app.slice(gate, switchIndex); expect(guard).toContain("<DefaultAdminRoute target={closedEntryTarget}"); expect(guard).toContain("return (");
    expect(app).not.toContain('path={"/workbench/procurement-orders'); expect(app).not.toContain('path={"/workbench/procurement/orders');
    const workbench = readFileSync("client/src/business/BusinessWorkbenchPage.tsx", "utf8"); expect(workbench).not.toContain("ProcurementOrders"); expect(workbench).not.toContain('<Route path="/procurement-orders');
  });
});
