// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminModuleTabs, AdminWorkspaceLocation, AdminWorkspaceTabs } from "./AdminWorkspaceNavigation";
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS, getAdminWorkbenchNavigationRoute } from "./adminWorkbenchNavigationModel";
import { CHANNEL_INVENTORY_ROUTE } from "@/lib/channelInventoryNavigation";

const items = Object.freeze(ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths).map(path => Object.freeze({
  path, label: getAdminWorkbenchNavigationRoute(path)?.label ?? path,
  permission: `synthetic:${path}`, chunk: `chunk:${path}`,
  merchantContext: Object.freeze({ merchantId: 31, returnTo: "/orders" }),
})));
type Item = typeof items[number];
let host: HTMLDivElement, root: Root;
const onNavigate = vi.fn(), onPreload = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
  onNavigate.mockReset(); onPreload.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("OFFLINE_NETWORK_FORBIDDEN"); }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function render(location = "/workbench/customers", visibleItems: readonly Item[] = items) {
  await act(async () => root.render(createElement(React.Fragment, null,
    createElement(AdminWorkspaceTabs, { items: visibleItems, location, onNavigate, onPreload }),
    createElement(AdminWorkspaceLocation, { items: visibleItems, location }),
  )));
}
function button(target: string) { const n = host.querySelector<HTMLButtonElement>(`button[data-workspace-nav-target="${target}"]`); if (!n) throw new Error(`Missing ${target}`); return n; }
async function click(target: string) { await act(async () => button(target).click()); }
async function key(target: string, value: string) { const e = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }); await act(async () => button(target).dispatchEvent(e)); return e; }
const primaryTargets = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button[data-navigation-level="1"]')).map(n => n.dataset.workspaceNavTarget);
const activeTargets = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button[data-navigation-level="1"][data-active="true"]')).map(n => n.dataset.workspaceNavTarget);
const locationLabels = () => Array.from(host.querySelectorAll('[data-admin-navigation="current-location"] li')).map(n => n.lastElementChild?.textContent);
const panels = () => host.querySelectorAll('[data-workspace-dropdown="panel"]');

describe("20261113 已批准八项一级入口", () => {
  it("父授权项逆序不改变一级顺序，取消业务工作台且销售统一下拉", async () => {
    await render(undefined, [...items].reverse());
    expect(primaryTargets()).toEqual(["customers", "inventory", "inquiries", "sales-orders", "inventory-management", "procurement-management", "operations", "organization"]);
    expect(button("sales-orders").textContent).toBe("销售订单▾");
    expect(button("sales-orders").dataset.workspaceDropdownTrigger).toBe("sales-orders");
    expect(button("inventory").title).toBe("渠道物料查询"); expect(button("inventory-management").title).toBe("入库管理");
    expect(host.querySelector('[data-workspace-nav-target="business"]')).toBeNull();
    await click("inventory-management");
    expect(button("inventory-management").textContent).toBe("入库管理");
    expect(button("inventory-management").hasAttribute("aria-expanded")).toBe(false);
    expect(panels()).toHaveLength(0);
    for (const path of ["/workbench/orders", "/workbench/outbound", "/workbench/customers", CHANNEL_INVENTORY_ROUTE, "/workbench/inquiries"]) expect(host.querySelector(`[data-workspace-dropdown-item="${path}"]`)).toBeNull();
    expect(onNavigate.mock.calls).toEqual([[items.find(item => item.path === "/workbench/inbound")]]);
  });
  it.each([1280, 390].flatMap(width => ["customers", "inquiries"].map(target => [width, target] as const)))
    ("%s宽度%s点击同步关闭旧层并保留同一授权对象与上下文", async (width, target) => {
      Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
      await render("/staff"); await click("operations"); await click("group:transactions-services");
      const path = target === "customers" ? "/workbench/customers" : "/workbench/inquiries";
      const original = items.find(item => item.path === path)!;
      await act(async () => button(target).focus()); expect(onPreload).toHaveBeenCalledWith(original);
      for (const value of ["Enter", " "]) expect((await key(target, value)).defaultPrevented).toBe(false);
      await click(target); expect(onNavigate.mock.calls).toEqual([[original]]); expect(onNavigate.mock.calls[0][0]).toBe(original);
      expect(onNavigate.mock.calls[0][0].merchantContext).toBe(original.merchantContext); expect(panels()).toHaveLength(0); expect(activeTargets()).toEqual(["organization"]);
    });
  it.each(["?ciTab=materials&ciView=channels", "?ciTab=channels", "?ciTab=trash", "?ciTab=batches", "?supplyChannelId=22&supplyTab=details"])
    ("库存历史视图%s仍只高亮库存列表，原选择参数不变", async query => {
      await render(`${CHANNEL_INVENTORY_ROUTE}${query}`); expect(activeTargets()).toEqual(["inventory"]);
      const original = items.find(item => item.path === CHANNEL_INVENTORY_ROUTE)!;
      await click("inventory"); expect(onNavigate.mock.calls).toEqual([[original, "materials", "flat"]]); expect(onNavigate.mock.calls[0][0]).toBe(original);
    });
  it.each([
    ["/workbench/customers/88?merchantId=31", "customers", ["客户列表"]],
    ["/workbench/customer-demands", "customers", ["客户列表", "客户需求"]],
    ["/workbench/orders", "sales-orders", ["销售订单", "商城订单"]],
    ["/workbench/orders?orderSource=business", "sales-orders", ["销售订单", "业务订单"]],
    ["/workbench/sales-orders/88?merchantId=31", "sales-orders", ["销售订单", "业务订单"]],
    ["/workbench/inbound", "inventory-management", ["入库管理"]],
    ["/workbench/outbound", "sales-orders", ["销售订单", "商城订单"]],
    ["/workbench/procurement/orders/88", "procurement-management", ["采购管理", "采购订单"]],
    ["/workbench/procurement-demands", "procurement-management", ["采购管理", "采购需求"]],
    ["/workbench/inquiries/88", "inquiries", ["询价接待"]],
    ["/workbench/chat/88", "inquiries", ["询价接待"]],
  ])("%s 路由高亮%s且面包屑移除业务工作台", async (location, target, labels) => {
    await render(location as string); expect(activeTargets()).toEqual([target]); expect(locationLabels()).toEqual(labels);
  });
  it.each(["/workbench/customers", CHANNEL_INVENTORY_ROUTE, "/workbench/inquiries", "/workbench/orders", "/workbench/inbound", "/workbench/procurement-orders"])
    ("%s撤权不制造目标、默认跳转或空业务菜单", async path => {
      await render(path === "/workbench/orders" ? `${path}?orderSource=business` : path, items.filter(item => item.path !== path)); expect(activeTargets()).toEqual([]); expect(locationLabels()).toEqual([]);
      await render(path, []); expect(host.querySelector("nav")).toBeNull(); expect(onNavigate).not.toHaveBeenCalled();
    });
  it.each([1280, 390])("%s宽度seller-only保留原outbound对象、preload与上下文", async width => {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    const seller = items.find(item => item.path === "/workbench/outbound")!;
    await render("/workbench/orders?orderSource=mall&merchantId=31#detail", [seller]);
    expect(primaryTargets()).toEqual(["sales-orders"]); expect(activeTargets()).toEqual(["sales-orders"]); expect(locationLabels()).toEqual(["销售订单", "商城订单"]);
    await act(async () => button("sales-orders").focus()); expect(onPreload.mock.calls[0][0]).toBe(seller);
    await click("sales-orders"); expect(onNavigate).not.toHaveBeenCalled();
    expect(Array.from(host.querySelectorAll('[data-workspace-dropdown-item]')).map(n => n.textContent)).toEqual(["商城订单"]);
    await click(seller.path); expect(onNavigate.mock.calls).toEqual([[seller, undefined, undefined, "mall"]]); expect(onNavigate.mock.calls[0][0]).toBe(seller);
    await render("/workbench/orders?orderSource=business", [seller]); expect(activeTargets()).toEqual([]); expect(locationLabels()).toEqual([]);
    await render("/workbench/outbound", items.filter(item => item !== seller)); expect(activeTargets()).toEqual([]); expect(locationLabels()).toEqual([]);
  });
  it("单销售、单入库授权只出现原允许入口", async () => {
    const sale = items.find(item => item.path === "/workbench/orders")!;
    await render(sale.path, [sale]); expect(primaryTargets()).toEqual(["sales-orders"]); await click("sales-orders"); expect(onNavigate).not.toHaveBeenCalled();
    expect(Array.from(host.querySelectorAll('[data-workspace-dropdown-item]')).map(n => n.textContent)).toEqual(["业务订单"]);
    await click(sale.path); expect(onNavigate.mock.calls).toEqual([[sale, undefined, undefined, "business"]]); expect(onNavigate.mock.calls[0][0]).toBe(sale);
    const inbound = items.find(item => item.path === "/workbench/inbound")!;
    await render(inbound.path, [inbound]); expect(primaryTargets()).toEqual(["inventory-management"]); await click("inventory-management");
    expect(panels()).toHaveLength(0); expect(onNavigate.mock.calls[1]).toEqual([inbound]); expect(onNavigate.mock.calls[1][0]).toBe(inbound);
    await render(inbound.path, [{ ...inbound, path: `${inbound.path}?grant=all` }]); expect(host.querySelector("nav")).toBeNull();
  });
  it("一级方向键只移焦点，销售与其他 workspace 使用同一键盘菜单", async () => {
    await render(); await act(async () => button("inquiries").focus()); await key("inquiries", "ArrowRight"); expect(document.activeElement).toBe(button("sales-orders"));
    await key("sales-orders", "ArrowRight"); expect(document.activeElement).toBe(button("inventory-management"));
    await key("inventory-management", "End"); expect(document.activeElement).toBe(button("organization"));
    await key("organization", "ArrowRight"); expect(document.activeElement).toBe(button("customers"));
    await key("customers", "ArrowLeft"); expect(document.activeElement).toBe(button("organization"));
    await key("organization", "Home"); expect(document.activeElement).toBe(button("customers")); expect(onNavigate).not.toHaveBeenCalled();
  });
  it("URL或父权限新快照立即关闭旧菜单，旧快照返回不迟到重开", async () => {
    await render(); await key("procurement-management", "Enter"); expect(panels()).toHaveLength(1);
    await render("/workbench/customers?merchantId=32"); expect(panels()).toHaveLength(0);
    await click("procurement-management"); await render("/workbench/customers?merchantId=32", [...items]); expect(panels()).toHaveLength(0);
    await render(); expect(panels()).toHaveLength(0);
  });
  it("ModuleTabs兼容API仍使用原授权条目和分组", async () => {
    await act(async () => root.render(createElement(AdminModuleTabs, { items, location: "/workbench/orders", onNavigate })));
    await key("group:customers", "ArrowDown"); expect(document.activeElement).toBe(button("/workbench/orders")); expect(host.querySelector('[data-workspace-nav-target="/workbench/customers"]')).toBeNull();
  });
});
