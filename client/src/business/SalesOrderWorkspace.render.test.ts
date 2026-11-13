// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SalesOrderWorkspace, { LegacyOutboundRoute } from "./SalesOrderWorkspace";
import { BusinessScopeProvider } from "./BusinessScope";
import { BusinessWorkbenchAccessProvider } from "./BusinessWorkbenchAccessGate";
import { useBusinessLocation, businessNavigationHrefs } from "./api/business-wouter";
import { salesOrderSourceStorageKey, salesOrderSourceTarget } from "../lib/salesOrderWorkspace";

const runtime = vi.hoisted(() => ({ mall: vi.fn(), business: vi.fn() }));
vi.mock("./platform/client/src/pages/OutboundManagement", () => ({ default: (props: { readOnly?: boolean }) => {
  runtime.mall(props);
  return createElement("article", { "data-original-page": "mall", "data-read-only": String(props.readOnly) }, "原商城订单页");
} }));
vi.mock("./platform/client/src/pages/CrmSalesOrders", () => ({ default: () => {
  runtime.business();
  return createElement("article", { "data-original-page": "business" }, "原CRM订单页");
} }));

let root: Root, host: HTMLDivElement;
const identity = "business-domain:v1:staff:7002:admin:6001:enterprise:88001:merchant:30061:binding:4";
const principal = {
  status: "ready" as const, frontendUserId: 7002, adminAccountId: 6001, enterpriseId: 88001, bindingVersion: 4,
  user: { id: 7002, role: "user", crmAccess: true } as any,
};
const pages = () => [...host.querySelectorAll("[data-original-page]")].map(page => page.getAttribute("data-original-page"));
const tabs = () => [...host.querySelectorAll("[data-order-source-tab]")].map(tab => tab.getAttribute("data-order-source-tab"));
async function render(capabilities: string[], legacy = false, actor = principal) {
  await act(async () => root.render(createElement(BusinessScopeProvider, {
    merchantId: 30061, staffPrincipal: actor, contextVerificationState: "verified", children:
      createElement(BusinessWorkbenchAccessProvider, { merchantId: 30061, merchantCanWrite: false,
        workbenchCapabilities: capabilities, writeCapabilities: [], children:
          createElement(Router, { base: "/workbench", hook: useBusinessLocation, hrefs: businessNavigationHrefs },
            createElement(legacy ? LegacyOutboundRoute : SalesOrderWorkspace)),
      }),
  })));
}
async function navigate(path: string) {
  await act(async () => { window.history.pushState(null, "", path); window.dispatchEvent(new PopStateEvent("popstate")); });
}
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "/workbench/orders?merchantId=30061");
  window.localStorage.clear(); runtime.mall.mockClear(); runtime.business.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("ORDER_DATA_NETWORK_FORBIDDEN"); }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

describe("SalesOrderWorkspace verified来源整合", () => {
  it("首次双授权默认mall，仍是原完整readOnly=false商城页", async () => {
    await render(["marketplace.seller", "crm.sales_orders"]);
    expect(pages()).toEqual(["mall"]); expect(tabs()).toEqual([]);
    expect(host.querySelector('nav[aria-label="销售订单来源"]')).toBeNull();
    expect(runtime.mall).toHaveBeenCalledWith({ readOnly: false }); expect(runtime.business).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get("orderSource")).toBe("mall");
  });
  it.each([
    [["marketplace.seller"], "mall"], [["crm.sales_orders"], "business"],
  ] as const)("单来源授权%s只显示自身原页，无重复页签且不扩大能力", async (capabilities, source) => {
    await render([...capabilities]); expect(pages()).toEqual([source]); expect(tabs()).toEqual([]);
  });
  it("父菜单明确来源路由切换和再次进入保留同一verified identity的记忆、query与hash", async () => {
    window.history.replaceState(null, "", "/workbench/orders?merchantId=30061&orderId=9&status=paid#detail-9");
    await render(["marketplace.seller", "crm.sales_orders"]);
    await navigate(salesOrderSourceTarget(`${window.location.pathname}${window.location.search}${window.location.hash}`, "business", "/workbench/orders"));
    expect(pages()).toEqual(["business"]); expect(window.location.hash).toBe("#detail-9");
    expect(new URLSearchParams(window.location.search).get("orderId")).toBe("9");
    expect(window.localStorage.getItem(salesOrderSourceStorageKey(identity))).toBe("business");
    await navigate("/workbench/orders?merchantId=30061"); expect(pages()).toEqual(["business"]);
    await act(async () => root.render(null));
    await navigate("/workbench/orders?merchantId=30061");
    await render(["marketplace.seller", "crm.sales_orders"], false, { ...principal, bindingVersion: 5 });
    expect(pages()).toEqual(["mall"]);
  });
  it.each(["mall", "business"] as const)("显式%s未授权拒绝而非静默借用另一能力", async source => {
    await navigate(`/workbench/orders?orderSource=${source}`);
    await render([source === "mall" ? "crm.sales_orders" : "marketplace.seller"]);
    expect(pages()).toEqual([]); expect(host.textContent).toContain("当前商户未获该业务模块访问范围");
    expect(new URLSearchParams(window.location.search).get("orderSource")).toBe(source);
    expect(runtime.mall).not.toHaveBeenCalled(); expect(runtime.business).not.toHaveBeenCalled();
  });
  it.each(["orderSource=unknown", "orderSource=mall&orderSource=business", "orderSource="])("非法%s不渲染任一原页，也不改写URL", async query => {
    await navigate(`/workbench/orders?${query}`); await render(["marketplace.seller", "crm.sales_orders"]);
    expect(pages()).toEqual([]); expect(host.textContent).toContain("未识别的销售订单来源"); expect(window.location.search).toBe(`?${query}`);
  });
  it("撤销当前显式mall即拆除原mall页，不借CRM；再次缺省进入才选择仍获权business", async () => {
    await render(["marketplace.seller", "crm.sales_orders"]); expect(pages()).toEqual(["mall"]);
    await render(["crm.sales_orders"]); expect(pages()).toEqual([]); expect(tabs()).toEqual([]);
    await navigate("/workbench/orders"); expect(pages()).toEqual(["business"]);
  });
  it("CRM历史alias和demandNo/keyword意图不落入商城", async () => {
    for (const path of ["/workbench/sales-orders?demandNo=XQ-1", "/workbench/orders?keyword=SO-1"]) {
      await navigate(path); await render(["marketplace.seller", "crm.sales_orders"]);
      expect(pages()).toEqual(["business"]);
    }
  });
  it("无业务来源授权不加载订单页或写偏好", async () => {
    await render(["inventory.read", "inquiry.receive"]); expect(pages()).toEqual([]); expect(tabs()).toEqual([]);
    expect(host.textContent).toContain("当前商户未获销售订单访问范围"); expect(window.localStorage.length).toBe(0);
  });
  it("旧outbound仅sellerGate后跳新mall，保留原merchant候选、筛选、详情与hash", async () => {
    await navigate("/workbench/outbound?merchantId=30061&orderId=9&status=paid#detail-9");
    await render(["marketplace.seller"], true);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe("/workbench/orders?merchantId=30061&orderId=9&status=paid&orderSource=mall#detail-9");
    await render(["marketplace.seller"]); expect(pages()).toEqual(["mall"]);
  });
  it("旧outbound不能凭CRM权限跳转或显示订单", async () => {
    await navigate("/workbench/outbound?merchantId=30061#detail"); await render(["crm.sales_orders"], true);
    expect(window.location.pathname).toBe("/workbench/outbound"); expect(window.location.hash).toBe("#detail");
    expect(host.textContent).toContain("当前商户未获该业务模块访问范围"); expect(pages()).toEqual([]);
  });
});
