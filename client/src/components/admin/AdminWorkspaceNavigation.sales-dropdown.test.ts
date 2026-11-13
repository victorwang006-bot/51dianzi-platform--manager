// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWorkspaceLocation, AdminWorkspaceTabs, type AdminModuleTabsProps } from "./AdminWorkspaceNavigation";

// Entirely fictional fixtures; no order numbers or customer data.
const context = Object.freeze({ merchantId: 900001, fixture: "navigation-test-only" });
const mall = Object.freeze({ path: "/workbench/outbound", label: "原商城入口", permission: "marketplace.seller", chunk: "fixture-mall", context });
const business = Object.freeze({ path: "/workbench/orders", label: "原业务入口", permission: "crm.sales_orders", chunk: "fixture-business", context });
const inbound = Object.freeze({ path: "/workbench/inbound", label: "入库管理", permission: "inventory.write", chunk: "fixture-inbound", context });
const messages = Object.freeze({ path: "/messages", label: "消息中心", permission: "message.read", chunk: "fixture-messages", context });
const all = [business, inbound, mall, messages];
type Item = typeof all[number];
let host: HTMLDivElement, root: Root;
const onNavigate = vi.fn(), onPreload = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  onNavigate.mockReset(); onPreload.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("OFFLINE_NAVIGATION_TEST"); }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});
async function render(location = "/workbench/orders?orderSource=business", props: Partial<AdminModuleTabsProps<Item>> = {}) {
  const items = props.items ?? all;
  await act(async () => root.render(createElement(React.Fragment, null,
    createElement(AdminWorkspaceTabs<Item>, { items, location, onNavigate, onPreload, ...props }),
    createElement(AdminWorkspaceLocation<Item>, { items, location }),
  )));
}
function button(target: string) {
  const element = host.querySelector<HTMLButtonElement>(`button[data-workspace-nav-target="${target}"]`);
  if (!element) throw new Error(`Missing ${target}`);
  return element;
}
const panel = () => host.querySelector<HTMLDivElement>('[data-workspace-dropdown="panel"][data-navigation-level="2"]');
const leaves = () => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-workspace-dropdown-item]'));
async function click(target: string) { await act(async () => button(target).click()); }
async function key(target: string, value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  await act(async () => button(target).dispatchEvent(event));
  return event;
}
async function pointer(element: Element, type: "pointerover" | "pointerout", pointerType = "mouse", relatedTarget: EventTarget | null = null) {
  const event = new MouseEvent(type, { bubbles: true, relatedTarget });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  await act(async () => element.dispatchEvent(event));
}

describe("销售来源复用统一 workspace dropdown", () => {
  it.each([1280, 390])("%spx 一级不导航、不改路由，来源标签来自 helper，权限对象原封不动", async width => {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    await render(); await click("operations"); await click("group:transactions-services");
    expect(host.querySelector('[data-navigation-level="3"]')).not.toBeNull();
    await click("sales-orders");
    expect(host.querySelector('[data-navigation-level="3"]')).toBeNull();
    expect(host.querySelectorAll('[data-workspace-dropdown="layer"]')).toHaveLength(1);
    expect(leaves().map(leaf => [leaf.dataset.workspaceDropdownItem, leaf.dataset.orderSource, leaf.textContent])).toEqual([
      [mall.path, "mall", "商城订单"], [business.path, "business", "业务订单"],
    ]);
    expect(panel()?.style.width).toBe("160px");
    expect(onNavigate).not.toHaveBeenCalled();
    expect(button("sales-orders").getAttribute("aria-current")).toBe("location");
    expect(button(business.path).getAttribute("aria-current")).toBe("page");
    expect(button(mall.path).dataset.active).toBe("false");
  });
  it.each([[mall, "mall"], [business, "business"]] as const)("%s来源 %s 的 callback 精确四参，回调前所有层同步隐藏", async (original, source) => {
    const navigate = vi.fn((item: Item) => {
      expect(item).toBe(original); expect(item.context).toBe(context);
      expect(host.querySelector<HTMLDivElement>('[data-workspace-dropdown="layer"]')?.hidden).toBe(true);
      expect(button("sales-orders").getAttribute("aria-expanded")).toBe("false");
    });
    await render(undefined, { onNavigate: navigate }); await click("sales-orders"); onPreload.mockClear();
    await act(async () => button(original.path).focus());
    expect(onPreload.mock.calls[0][0]).toBe(original);
    await click(original.path);
    expect(navigate.mock.calls).toEqual([[original, undefined, undefined, source]]);
    expect(panel()).toBeNull();
  });
  it.each([
    ["/workbench/orders?orderSource=mall", "mall"],
    ["/workbench/orders?orderSource=business", "business"],
    ["/workbench/outbound?fixture=1", "mall"],
    ["/workbench/sales-orders/fixture-detail", "business"],
    ["/workbench/orders?demandNo=TEST-DEMAND", "business"],
    ["/workbench/orders?keyword=TEST-ORDER", "business"],
  ])("%s 的 parent、leaf、breadcrumb 同源且点击不虚构当前 active", async (location, source) => {
    await render(location); await click("sales-orders");
    expect(leaves().filter(leaf => leaf.dataset.active === "true").map(leaf => leaf.dataset.orderSource)).toEqual([source]);
    expect(host.querySelector('[data-admin-navigation="current-location"] [aria-current="page"]')?.textContent).toBe(source === "mall" ? "商城订单" : "业务订单");
    await click(source === "mall" ? business.path : mall.path);
    expect(button("sales-orders").dataset.active).toBe("true");
    await click("sales-orders");
    expect(leaves().filter(leaf => leaf.dataset.active === "true").map(leaf => leaf.dataset.orderSource)).toEqual([source]);
  });
  it.each([[mall, "mall"], [business, "business"]] as const)("单授权 %s 仅有 %s 原 leaf，未知/无权来源 failclosed", async (original, source) => {
    const other = source === "mall" ? "business" : "mall";
    for (const query of [`orderSource=${other}`, "orderSource=unknown", "orderSource=mall&orderSource=business"]) {
      await render(`/workbench/orders?${query}`, { items: [original] });
      expect(host.querySelector('[data-active="true"]')).toBeNull();
      expect(host.querySelector('[data-admin-navigation="current-location"]')).toBeNull();
      await click("sales-orders");
      expect(leaves().map(leaf => leaf.dataset.workspaceDropdownItem)).toEqual([original.path]);
      expect(leaves()[0].dataset.active).toBe("false");
    }
    await render("/workbench/orders", { items: [] }); expect(host.querySelector("nav")).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });
  it("原 badge 与 preload 原对象保持，销售 label 不冒用原业务菜单文字", async () => {
    const badge = vi.fn((item: Item) => createElement("span", { "data-badge-source": item.chunk }, "2"));
    await render(undefined, { renderBadge: badge, renderItem: item => createElement("span", null, item.label) });
    await act(async () => button("sales-orders").focus()); expect(onPreload).toHaveBeenCalledWith(business);
    await click("sales-orders");
    for (const item of [mall, business]) expect(button(item.path).querySelector(`[data-badge-source="${item.chunk}"]`)).not.toBeNull();
    expect(button(mall.path).textContent).toBe("商城订单2"); expect(button(business.path).textContent).toBe("业务订单2");
    expect(button(mall.path).querySelector("button,a")).toBeNull();
  });
  it("销售键盘与采购一致：Enter/Space、上下循环、Home/End、Tab及Esc父焦点", async () => {
    await render();
    expect((await key("sales-orders", "Enter")).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button(mall.path));
    await key(mall.path, "ArrowUp"); expect(document.activeElement).toBe(button(business.path));
    await key(business.path, "ArrowDown"); expect(document.activeElement).toBe(button(mall.path));
    await key(mall.path, "End"); expect(document.activeElement).toBe(button(business.path));
    await key(business.path, "Home"); expect(document.activeElement).toBe(button(mall.path));
    expect((await key(mall.path, "Tab")).defaultPrevented).toBe(false);
    await key(mall.path, "Escape"); expect(panel()).toBeNull(); expect(document.activeElement).toBe(button("sales-orders"));
    await key("sales-orders", "ArrowUp"); expect(document.activeElement).toBe(button(business.path));
    await key(business.path, "Escape"); await key("sales-orders", " "); expect(document.activeElement).toBe(button(mall.path));
    expect(onNavigate).not.toHaveBeenCalled();
  });
  it("悬停180ms延迟和权限/URL快照取消工作不产生过时来源", async () => {
    vi.useFakeTimers(); await render();
    await pointer(button("sales-orders"), "pointerover"); await pointer(button("sales-orders"), "pointerout", "mouse", document.body);
    await act(async () => vi.advanceTimersByTime(179)); expect(panel()).not.toBeNull();
    await pointer(panel()!, "pointerover"); await act(async () => vi.advanceTimersByTime(200)); expect(panel()).not.toBeNull();
    await pointer(panel()!, "pointerout", "mouse", document.body);
    await render("/workbench/orders?orderSource=business", { items: [mall] }); expect(panel()).toBeNull();
    await click("sales-orders"); await act(async () => vi.advanceTimersByTime(300));
    expect(leaves().map(leaf => leaf.dataset.orderSource)).toEqual(["mall"]); expect(leaves()[0].dataset.active).toBe("false");
    await render("/workbench/orders?orderSource=mall&fixture=next", { items: [mall] }); expect(panel()).toBeNull();
    await click("sales-orders"); await pointer(panel()!, "pointerout", "mouse", document.body);
    await act(async () => vi.advanceTimersByTime(180)); expect(panel()).toBeNull(); expect(onNavigate).not.toHaveBeenCalled();
  });
  it.each(["touch", "pen"])("窄屏 %s 无悬停，360 抽屉 marker、滚动和关闭保留", async pointerType => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    await render(); await pointer(button("sales-orders"), "pointerover", pointerType); expect(panel()).toBeNull();
    await click("sales-orders"); expect(host.querySelector('[data-drawer="true"]')).not.toBeNull();
    expect(leaves()).toHaveLength(2); expect(host.querySelector('[data-navigation-level="3"]')).toBeNull();
    await act(async () => panel()!.dispatchEvent(new Event("scroll"))); expect(panel()).not.toBeNull();
    await act(async () => panel()!.querySelector<HTMLButtonElement>('[data-workspace-dropdown="close"]')!.click());
    expect(panel()).toBeNull(); expect(document.activeElement).toBe(button("sales-orders"));
  });
});
