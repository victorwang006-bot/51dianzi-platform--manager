// @vitest-environment jsdom
import * as React from "react";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync, existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminWorkspaceTabs } from "./AdminWorkspaceNavigation";

const items = Object.freeze([
  ["/workbench/customers", "客户列表"], ["/workbench/channel-inventory", "库存列表"],
  ["/workbench/inquiries", "询价接待"], ["/workbench/procurement-demands", "采购需求"],
  ["/workbench/inbound", "采购入库"], ["/workbench/orders", "销售订单"],
  ["/profile", "个人中心"], ["/messages", "消息管理"], ["/staff", "员工管理"],
].map(([path, label]) => Object.freeze({ path, label, context: Object.freeze({ fixture: true }) })));
let host: HTMLDivElement, root: Root, width: number;
const onNavigate = vi.fn(), observers = new Set<() => void>();
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  width = 1700; onNavigate.mockReset(); observers.clear();
  Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("OFFLINE_TEST_NO_NETWORK"); }));
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function(this: HTMLElement) { return this.matches('[data-admin-navigation="unified-dropdown"]') ? width : 0; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const w = this.classList.contains("admin-workspace-nav__account") ? 28 : 124;
    return { left: 10, right: 10 + w, top: 0, bottom: 52, width: w, height: 52, x: 10, y: 0, toJSON() {} };
  });
  vi.stubGlobal("ResizeObserver", class { constructor(private callback: () => void) { observers.add(callback); } observe() {} disconnect() { observers.delete(this.callback); } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); expect(globalThis.fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(visible = items, location = "/workbench/customers") {
  await act(async () => root.render(h(AdminWorkspaceTabs, { items: visible, location, onNavigate, accountMenu: h("button", { "data-account-test": true }, "账号") })));
}
const target = (id: string) => host.querySelector<HTMLButtonElement>(`button[data-workspace-nav-target="${id}"]`)!;
async function click(id: string) { await act(async () => target(id).click()); }
async function resize(next: number) { width = next; await act(async () => Array.from(observers).forEach(fn => fn())); }
const businessTargets = () => Array.from(host.querySelectorAll('[data-admin-navigation-group="business"] [data-navigation-level="1"]')).map(n => n.getAttribute("data-workspace-nav-target"));

describe("顶部局部恢复与提示完整移除", () => {
  it("宽屏业务/右侧功能分别分组，账号在固定右组", async () => {
    await render();
    expect(businessTargets()).toEqual(["customers", "inventory", "inquiries", "procurement-management", "inventory-management", "sales-orders"]);
    const utility = host.querySelector('[data-admin-navigation-group="utilities"]')!;
    expect(Array.from(utility.querySelectorAll('[data-navigation-level="1"]')).map(n => n.getAttribute("data-workspace-nav-target"))).toEqual(["personal", "operations", "organization"]);
    expect(utility.querySelector('[data-account-test]')).not.toBeNull(); expect(target("more")).toBeNull();
  });
  it("中屏更多承载完整业务原入口，点击单项仍调用原对象一次", async () => {
    width = 1050; await render();
    expect(businessTargets().at(-1)).toBe("more"); await click("more");
    expect(host.querySelector('[data-workspace-dropdown="panel"][data-workspace="more"]')).not.toBeNull();
    await click("inventory-management");
    expect(onNavigate.mock.calls).toEqual([[items.find(item => item.path === "/workbench/inbound")]]);
    expect(onNavigate.mock.calls[0][0]).toBe(items.find(item => item.path === "/workbench/inbound"));
  });
  it.each(["customers", "inventory", "inquiries", "procurement-management", "inventory-management", "personal"])("桌面更多内%s鼠标进入不会先关闭，仍可点击原入口", async id => {
    width = 150; await render(); await click("more");
    const original = target(id);
    const event = new MouseEvent("pointerover", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    await act(async () => original.dispatchEvent(event));
    expect(host.querySelector('[data-workspace="more"][data-workspace-dropdown="panel"]')).not.toBeNull();
    expect(target(id)).toBe(original);
    await click(id); expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(items.includes(onNavigate.mock.calls[0][0])).toBe(true);
  });
  it("窄屏功能也收进同一个更多，销售来源与原授权对象保留", async () => {
    width = 300; Object.defineProperty(window, "innerWidth", { value: 390, configurable: true }); await render();
    expect(businessTargets()).toEqual(["customers", "more"]);
    expect(host.querySelector('[data-admin-navigation-group="utilities"] [data-workspace-nav-target]')).toBeNull();
    await click("more"); expect(target("personal")).not.toBeNull(); expect(target("operations")).not.toBeNull();
    await click("sales-orders"); expect(host.querySelector('[data-workspace="sales-orders"][data-workspace-dropdown="panel"]')!.getAttribute("aria-label")).toBe("销售订单");
    await click("/workbench/orders");
    expect(onNavigate.mock.calls).toEqual([[items.find(item => item.path === "/workbench/orders"), undefined, undefined, "business"]]);
  });
  it("更多下的运营仍用原三级菜单，并可Escape回到更多焦点", async () => {
    width = 300; await render(); await click("more"); await click("operations"); await click("group:transactions-services");
    expect(host.querySelector('[data-navigation-level="3"][data-workspace-dropdown="panel"]')).not.toBeNull();
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(host.querySelector('[data-workspace-dropdown="panel"]')).toBeNull(); expect(document.activeElement).toBe(target("more"));
  });
  it("调整宽度只重排并关闭旧菜单，不调用导航或隐藏账号", async () => {
    await render(); await click("operations"); await resize(300);
    expect(host.querySelector('[data-workspace-dropdown="panel"]')).toBeNull(); expect(target("more")).not.toBeNull();
    await resize(1700); expect(target("more")).toBeNull(); expect(target("operations")).not.toBeNull();
    expect(host.querySelector('[data-account-test]')).not.toBeNull(); expect(onNavigate).not.toHaveBeenCalled();
  });
  it("撤权后更多不残留入口，零菜单权限仍可操作账号", async () => {
    width = 300; await render(); await click("more");
    await render(items.filter(item => item.path !== "/workbench/orders")); await click("more"); expect(target("sales-orders")).toBeNull();
    await render([]); expect(target("more")).toBeNull(); expect(host.querySelector('[data-account-test]')).not.toBeNull(); expect(onNavigate).not.toHaveBeenCalled();
  });
  it("每个一级入口保留等尺寸角标和箭头槽，数字变化不改变入口集合", async () => {
    await render();
    const buttons = host.querySelectorAll('[data-navigation-level="1"]');
    buttons.forEach(button => { expect(button.querySelector('.admin-workspace-nav__badge-slot')).not.toBeNull(); expect(button.querySelector('.admin-workspace-nav__arrow-slot')).not.toBeNull(); });
  });
  it("真实Dashboard已无失败功能，专用组件和样式均删除，Provider未删除", () => {
    const base = process.cwd() + "/client/src/components/";
    const source = readFileSync(base + "DashboardLayout.tsx", "utf8");
    expect(source).not.toContain("AdminNewInformationStatus");
    expect(existsSync(base + "admin/AdminNewInformationStatus.tsx")).toBe(false);
    expect(existsSync(base + "admin/AdminNewInformationStatus.css")).toBe(false);
    expect(source).toContain("<AdminNewInformationProvider"); expect(source).toContain("renderBadge={renderBadge}"); expect(source).toContain("accountMenu={");
    const css = readFileSync(base + "admin/AdminHeaderNavigation.css", "utf8");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr) 32px 8px");
    expect(css).not.toMatch(/(?:^|\n)\s*(?:html|body|:root|\*)\s*[{,]/);
  });
});
