// @vitest-environment jsdom
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminModuleTabs, AdminWorkspaceLocation, AdminWorkspaceTabs } from "./AdminWorkspaceNavigation";
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS, getAdminWorkbenchNavigationRoute } from "./adminWorkbenchNavigationModel";
import { CHANNEL_INVENTORY_ROUTE } from "@/lib/channelInventoryNavigation";
import { DEFAULT_ADMIN_PATH } from "@/lib/adminRoutes";

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
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});
async function render(location = "/workbench/customers", visibleItems: readonly Item[] = items) {
  await act(async () => root.render(createElement(React.Fragment, null,
    createElement(AdminWorkspaceTabs, { items: visibleItems, location, onNavigate, onPreload }),
    createElement(AdminWorkspaceLocation, { items: visibleItems, location }),
  )));
}
function button(target: string) {
  const node = host.querySelector<HTMLButtonElement>(`button[data-workspace-nav-target="${target}"]`);
  if (!node) throw new Error(`Missing ${target}`); return node;
}
async function click(target: string) { await act(async () => button(target).click()); }
async function key(target: string, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  await act(async () => button(target).dispatchEvent(event)); return event;
}
const primaryTargets = () => [...host.querySelectorAll<HTMLButtonElement>('button[data-navigation-level="1"]')].map(node => node.dataset.workspaceNavTarget);
const activeTargets = () => [...host.querySelectorAll<HTMLButtonElement>('button[data-navigation-level="1"][data-active="true"]')].map(node => node.dataset.workspaceNavTarget);
const locationLabels = () => [...host.querySelectorAll('[data-admin-navigation="current-location"] li')].map(node => node.lastElementChild?.textContent);
const panels = () => host.querySelectorAll('[data-workspace-dropdown="panel"]');

describe("已批准独立客户/库存一级入口（离线真实DOM）", () => {
  it("即使父授权项逆序仍是客户、库存、业务、运营、组织，历史登录默认页不变", async () => {
    await render(undefined, [...items].reverse());
    expect(primaryTargets()).toEqual(["customers", "inventory", "business", "operations", "organization"]);
    expect(button("customers").textContent).toBe("客户列表"); expect(button("inventory").textContent).toBe("库存列表");
    expect(host.querySelector('[data-workspace-nav-target="channel"]')).toBeNull();
    expect(DEFAULT_ADMIN_PATH).toBe(CHANNEL_INVENTORY_ROUTE);
    await click("business"); await click("group:customers");
    expect([...host.querySelectorAll('[data-workspace-dropdown-item]')].map(node => node.getAttribute("data-workspace-dropdown-item")))
      .toEqual(["/workbench/inquiries", "/workbench/orders"]);
    expect(host.querySelector('[data-workspace-dropdown-item="/workbench/customers"]')).toBeNull();
    expect(host.querySelector(`[data-workspace-dropdown-item="${CHANNEL_INVENTORY_ROUTE}"]`)).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });
  it.each([1280, 390])("%s宽度客户点击同步关闭旧两层并回传同一个授权对象，不附加库存视图参数", async width => {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    await render("/staff"); await click("business"); await click("group:inventory");
    const original = items.find(item => item.path === "/workbench/customers")!;
    await act(async () => button("customers").focus());
    expect(onPreload).toHaveBeenCalledWith(original);
    await click("customers"); expect(onNavigate.mock.calls).toEqual([[original]]);
    expect(onNavigate.mock.calls[0][0]).toBe(original); expect(panels()).toHaveLength(0);
    expect(activeTargets()).toEqual(["organization"]); // Never optimistic local route selection.
  });
  it.each(["?ciTab=materials&ciView=channels", "?ciTab=channels", "?ciTab=trash", "?ciTab=batches", "?supplyChannelId=22&supplyTab=details"])
    ("所有库存视图和历史查询%s仅高亮库存一级，点击仍走原授权对象", async query => {
      await render(`${CHANNEL_INVENTORY_ROUTE}${query}`);
      expect(activeTargets()).toEqual(["inventory"]);
      const original = items.find(item => item.path === CHANNEL_INVENTORY_ROUTE)!;
      await click("inventory"); expect(onNavigate.mock.calls).toEqual([[original, "materials", "flat"]]);
      expect(onNavigate.mock.calls[0][0]).toBe(original);
    });
  it.each(["/workbench/customers", "/workbench/customers/88?merchantId=31#detail", "/workbench/customer-demands"])
    ("客户真实或历史路由%s独立高亮且不再归业务标题", async location => {
      await render(location); expect(activeTargets()).toEqual(["customers"]);
      expect(locationLabels()).toEqual(location === "/workbench/customer-demands" ? ["客户列表", "客户需求"] : ["客户列表"]);
      await click("business"); expect(activeTargets()).toEqual(["customers"]);
      expect(button("group:customers").dataset.active).toBe("false");
    });
  it("撤回客户或库存授权不制造入口或路由fallback；仅客户授权时不制造空工作台", async () => {
    const customer = items.find(item => item.path === "/workbench/customers")!;
    await render(undefined, [customer]); expect(primaryTargets()).toEqual(["customers"]);
    await click("customers"); expect(onNavigate.mock.calls[0][0]).toBe(customer);
    await render("/workbench/customers/88", items.filter(item => item.path !== customer.path));
    expect(host.querySelector('[data-workspace-nav-target="customers"]')).toBeNull();
    expect(activeTargets()).toEqual([]); expect(locationLabels()).toEqual([]);
    await render(`${CHANNEL_INVENTORY_ROUTE}?ciView=channels`, items.filter(item => item.path !== CHANNEL_INVENTORY_ROUTE));
    expect(host.querySelector('[data-workspace-nav-target="inventory"]')).toBeNull(); expect(activeTargets()).toEqual([]);
    await render(undefined, [{ ...customer, path: "/workbench/customers?grant=all" }]); expect(host.querySelector("nav")).toBeNull();
  });
  it("方向键/首尾只移动一级焦点；客户原生Enter/Space未被拦截，触发时仅回调一次", async () => {
    await render(); await act(async () => button("customers").focus());
    await key("customers", "ArrowRight"); expect(document.activeElement).toBe(button("inventory"));
    await key("inventory", "ArrowRight"); expect(document.activeElement).toBe(button("business"));
    await key("business", "End"); expect(document.activeElement).toBe(button("organization"));
    await key("organization", "ArrowRight"); expect(document.activeElement).toBe(button("customers"));
    await key("customers", "ArrowLeft"); expect(document.activeElement).toBe(button("organization"));
    await key("organization", "Home"); expect(document.activeElement).toBe(button("customers"));
    expect((await key("customers", "Enter")).defaultPrevented).toBe(false);
    expect((await key("customers", " ")).defaultPrevented).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled(); await click("customers"); expect(onNavigate).toHaveBeenCalledOnce();
  });
  it("URL/query与同权限新快照立即使旧下拉失效，返回旧快照不会迟到重开", async () => {
    await render(); await key("business", "Enter"); await key("group:customers", "ArrowRight"); expect(panels()).toHaveLength(2);
    await render("/workbench/customers?merchantId=32"); expect(panels()).toHaveLength(0);
    await click("business"); await click("group:customers");
    await render("/workbench/customers?merchantId=32", [...items]); expect(panels()).toHaveLength(0);
    await render(); expect(panels()).toHaveLength(0);
  });
  it("兼容ModuleTabs也不重复客户，快照改变取消菜单及延迟焦点", async () => {
    const view = (visibleItems: readonly Item[]) => createElement(AdminModuleTabs, { items: visibleItems, location: "/workbench/orders", onNavigate, onPreload });
    await act(async () => root.render(view(items))); await key("group:customers", "ArrowDown");
    expect(document.activeElement).toBe(button("/workbench/inquiries"));
    expect(host.querySelector('[data-workspace-nav-target="/workbench/customers"]')).toBeNull();
    await act(async () => root.render(view([...items]))); expect(host.querySelector('[role="group"]')).toBeNull();
    await act(async () => root.render(view(items))); expect(host.querySelector('[role="group"]')).toBeNull();
  });
});
