// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSalesOrderNavigationContext,
  readRememberedSalesOrderSource,
  rememberSalesOrderSource,
  resolveSalesOrderSource,
  salesOrderSourceStorageKey,
  salesOrderSourceTarget,
} from "./salesOrderWorkspace";

const both = { mall: true, business: true };
beforeEach(() => window.localStorage.clear());

describe("销售订单来源：显式意图不借权，默认仅查当前proof", () => {
  it.each([
    [both, undefined, "mall"],
    [{ mall: false, business: true }, undefined, "business"],
    [{ mall: true, business: false }, undefined, "mall"],
    [{ mall: false, business: false }, undefined, null],
    [both, "business", "business"],
    [both, "mall", "mall"],
    [{ mall: false, business: true }, "mall", "business"],
    [{ mall: true, business: false }, "business", "mall"],
    [both, "invalid", "mall"],
  ])("当前授权%s和记忆%s选择%s", (access, remembered, source) => {
    expect(resolveSalesOrderSource("/orders?merchantId=30061", access as typeof both, remembered).source).toBe(source);
  });
  it.each(["mall", "business"] as const)("显式%s无权限即拒绝，即使另一来源有权且被记忆", source => {
    const access = { mall: source !== "mall", business: source !== "business" };
    expect(resolveSalesOrderSource(`/orders?orderSource=${source}`, access, source === "mall" ? "business" : "mall"))
      .toEqual({ source, explicit: true, allowed: false });
  });
  it.each(["", "Mall", "owner", "all", "mall&orderSource=business", "mall&orderSource=mall"])("非法或重复显式参数%s不静默回退", value => {
    expect(resolveSalesOrderSource(`/orders?orderSource=${value}`, both, "business"))
      .toEqual({ source: null, explicit: true, allowed: false });
  });
  it.each(["/sales-orders", "/sales-orders?demandNo=XQ-1", "/orders?demandNo=XQ-1", "/orders?keyword=SO-1"])("旧CRM %s不被mall默认或记忆截获", location => {
    expect(resolveSalesOrderSource(location, both, "mall")).toEqual({ source: "business", explicit: false, allowed: true });
    expect(resolveSalesOrderSource(location, { mall: true, business: false }, "mall").allowed).toBe(false);
  });
  it("hash不能作为来源或能力证明", () => {
    expect(resolveSalesOrderSource("/orders?merchantId=30061#orderSource=business", both).source).toBe("mall");
  });
});

describe("仅改变来源字段和路径，其他URL数据保留", () => {
  it("旧商城链接保留全部原编码、商户候选、详情、筛选和hash", () => {
    const url = "/outbound?merchantId=30061&merchantId=31&orderId=9&status=paid&kw=XQ%20%2F%201&returnTo=%2Forders#detail-9";
    expect(salesOrderSourceTarget(url, "mall")).toBe("/orders?merchantId=30061&merchantId=31&orderId=9&status=paid&kw=XQ%20%2F%201&returnTo=%2Forders&orderSource=mall#detail-9");
  });
  it("来源切换替换全部旧来源参数，不能留下多值来源", () => {
    expect(salesOrderSourceTarget("/orders?orderSource=business&%6FrderSource=mall&filter=done#x", "mall"))
      .toBe("/orders?filter=done&orderSource=mall#x");
  });
  it("来源缺省与仅hash链接仍生成唯一显式来源", () => {
    expect(salesOrderSourceTarget("/outbound#x", "mall")).toBe("/orders?orderSource=mall#x");
  });
});

describe("identity记忆是UI偏好，不是授权", () => {
  it("按staff/admin/enterprise/merchant/binding所有真实identity维度隔离", () => {
    const base = "business-domain:v1:staff:2:admin:3:enterprise:4:merchant:30061:binding:5";
    rememberSalesOrderSource(base, "business");
    expect(readRememberedSalesOrderSource(base)).toBe("business");
    for (const dimension of ["staff:2", "admin:3", "enterprise:4", "merchant:30061", "binding:5"]) {
      expect(readRememberedSalesOrderSource(base.replace(dimension, `${dimension}0`))).toBeNull();
    }
    expect(readRememberedSalesOrderSource("")).toBeNull();
    window.localStorage.setItem(salesOrderSourceStorageKey(base), "owner");
    expect(readRememberedSalesOrderSource(base)).toBeNull();
  });
  it("浏览器禁用storage时仍可选择授权页面", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      expect(readRememberedSalesOrderSource("verified-identity")).toBeNull();
      expect(() => rememberSalesOrderSource("verified-identity", "mall")).not.toThrow();
    } finally { get.mockRestore(); set.mockRestore(); }
  });
});

describe("导航只复用原父授权对象", () => {
  const mall = Object.freeze({ path: "/workbench/outbound", permission: "seller", chunk: {} });
  const business = Object.freeze({ path: "/workbench/orders", permission: "crm", chunk: {} });
  it("seller-only一级目标是原outbound对象而不是合成orders item", () => {
    const result = getSalesOrderNavigationContext([mall], "/workbench/orders?orderSource=mall");
    expect(result.item).toBe(mall); expect(result.active).toBe(true); expect(result.label).toBe("商城订单");
    expect(getSalesOrderNavigationContext([mall], "/workbench/orders?orderSource=business").active).toBe(false);
  });
  it("默认优先原orders对象但显式mall不能借CRM授权", () => {
    expect(getSalesOrderNavigationContext([mall, business], "/workbench/outbound").item).toBe(business);
    expect(getSalesOrderNavigationContext([business], "/workbench/orders?orderSource=mall").active).toBe(false);
    expect(getSalesOrderNavigationContext([business], "/workbench/sales-orders").label).toBe("业务订单");
    expect(getSalesOrderNavigationContext([mall, business], "/orders").active).toBe(false);
  });
  it("dropdown entries 按商城/业务稳定排序，保留父原引用且不合成权限", () => {
    const result = getSalesOrderNavigationContext([business, mall], "/workbench/orders?orderSource=business");
    expect(result.entries.map(entry => [entry.source, entry.label])).toEqual([["mall", "商城订单"], ["business", "业务订单"]]);
    expect(result.entries[0].item).toBe(mall); expect(result.entries[1].item).toBe(business);
    expect(result.entries[0].item.chunk).toBe(mall.chunk); expect(result.entries[1].item.chunk).toBe(business.chunk);
    expect(result.source).toBe("business");
    expect(getSalesOrderNavigationContext([], "/workbench/orders").entries).toEqual([]);
  });
  it.each(["orderSource=business", "orderSource=unknown", "orderSource=mall&orderSource=business"])("seller-only %s 不产生无权来源 active", query => {
    const result = getSalesOrderNavigationContext([mall], `/workbench/orders?${query}`);
    expect(result.source).toBeNull(); expect(result.active).toBe(false); expect(result.label).toBeNull();
    expect(result.entries).toEqual([{ source: "mall", label: "商城订单", item: mall }]);
    expect(result.entries[0].item).toBe(mall);
  });
});
