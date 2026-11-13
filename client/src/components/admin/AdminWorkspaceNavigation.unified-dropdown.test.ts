// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminWorkspaceTabs, type AdminModuleTabsProps } from "./AdminWorkspaceNavigation";
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS, getAdminWorkbenchNavigationRoute } from "./adminWorkbenchNavigationModel";
const items = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(g => g.paths).map(path => Object.freeze({ path, label: getAdminWorkbenchNavigationRoute(path)?.label ?? path, chunk: path, merchantContext: Object.freeze({ merchantId: 31 }) }));
type Item = typeof items[number];
const management = { "inventory-management": ["/workbench/inbound", "/workbench/outbound"], "procurement-management": ["/workbench/procurement-demands", "/workbench/procurement-orders"] };
const operations = { "basic-data": ["/merchants", "/materials", "/portal-users"], "transactions-services": ["/orders", "/messages", "/reviews"], "data-monitoring": ["/analytics", "/exception-logs"] };
let host: HTMLDivElement, root: Root;
const onNavigate = vi.fn(), onPreload = vi.fn();
beforeEach(() => { Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true }); Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true }); Object.defineProperty(window, "innerHeight", { value: 800, configurable: true }); onNavigate.mockReset(); onPreload.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); });
async function render(location = "/workbench/orders?merchantId=31", overrides: Partial<AdminModuleTabsProps<Item>> = {}) { await act(async () => root.render(createElement(AdminWorkspaceTabs<Item>, { items, location, onNavigate, onPreload, ...overrides }))); }
function button(target: string) { const b = host.querySelector<HTMLButtonElement>(`button[data-workspace-nav-target="${target}"]`); if (!b) throw new Error(`Missing ${target}`); return b; }
function panel(level = 2) { return host.querySelector<HTMLDivElement>(`[data-workspace-dropdown="panel"][data-navigation-level="${level}"]`); }
const leaves = (level = 2) => [...(panel(level)?.querySelectorAll<HTMLButtonElement>('[data-workspace-dropdown-item]') ?? [])].map(n => n.dataset.workspaceDropdownItem);
const active = () => [...host.querySelectorAll<HTMLButtonElement>('button[data-navigation-level="1"][data-active="true"]')].map(n => n.dataset.workspaceNavTarget);
async function click(t: string) { await act(async () => button(t).click()); }
async function key(t: string, k: string) { const e = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }); await act(async () => button(t).dispatchEvent(e)); return e; }
async function pointer(n: Element, type: "pointerover" | "pointerout", pointerType = "mouse", relatedTarget: EventTarget | null = null) { const e = new MouseEvent(type, { bubbles: true, relatedTarget }); Object.defineProperty(e, "pointerType", { value: pointerType }); await act(async () => n.dispatchEvent(e)); }
const subset = (paths: string[]) => items.filter(i => paths.includes(i.path));

describe("20261113 一级管理下拉与运营三级提醒", () => {
  it.each(Object.entries(management))("%s直接显示原子项，无业务工作台或额外三级", async (id, paths) => {
    await render(); await pointer(button(id), "pointerover"); expect(leaves()).toEqual(paths); expect(panel(3)).toBeNull(); expect(active()).toEqual(["sales-orders"]);
    await click(id); expect(panel()).not.toBeNull(); await click(id); expect(panel()).toBeNull(); expect(onNavigate).not.toHaveBeenCalled();
  });
  it.each(Object.entries(management).flatMap(([id, paths]) => paths.map(path => [id, path])))
    ("%s中%s保留原授权对象，父回调前同步隐藏且仅调用一次", async (id, path) => {
      const original = items.find(i => i.path === path)!;
      const navigate = vi.fn((item: Item) => { expect(item).toBe(original); expect(host.querySelector<HTMLDivElement>('[data-workspace-dropdown="layer"]')?.hidden).toBe(true); expect(button(id).getAttribute("aria-expanded")).toBe("false"); });
      await render(path, { onNavigate: navigate }); await click(id); onPreload.mockClear(); await act(async () => button(path).focus()); expect(onPreload).toHaveBeenCalledWith(original);
      await click(path); expect(navigate.mock.calls).toEqual([[original]]); expect(navigate.mock.calls[0][0].merchantContext).toBe(original.merchantContext); expect(panel()).toBeNull();
    });
  it("平台运营和交易与服务只上浮可见消息中心的同一badge，不合计模块待办", async () => {
    const badge = vi.fn((item: Item) => createElement("span", { "data-badge-source": item.path }, item.path === "/messages" ? "99+" : "7"));
    await render("/messages", { renderBadge: badge }); expect(button("operations").querySelector('[data-badge-source="/messages"]')?.textContent).toBe("99+");
    expect(button("operations").querySelector('[data-badge-source="/orders"]')).toBeNull();
    await click("operations"); const group = button("group:transactions-services"); expect(group.querySelector('[data-badge-source="/messages"]')?.textContent).toBe("99+");
    expect(button("group:basic-data").querySelector('[data-badge-source]')).toBeNull();
    await click("group:transactions-services"); expect(button("/messages").querySelector('[data-badge-source="/messages"]')?.textContent).toBe("99+");
    expect(onNavigate).not.toHaveBeenCalled();
    await render("/orders", { items: subset(["/orders", "/reviews"]), renderBadge: badge }); expect(button("operations").querySelector('[data-badge-source]')).toBeNull();
    await click("operations"); expect(button("group:transactions-services").querySelector('[data-badge-source]')).toBeNull();
  });
  it("消息为0时三层无角标，展开和悬停不导航也不触发已读", async () => {
    await render("/messages", { renderBadge: () => null }); await pointer(button("operations"), "pointerover"); await pointer(button("group:transactions-services"), "pointerover");
    expect(host.querySelector('[aria-label*="未读"]')).toBeNull(); expect(onNavigate).not.toHaveBeenCalled();
  });
  it.each(Object.entries(operations))("运营%s保持原三级路径，侧组不导航，叶子原对象不变", async (id, paths) => {
    await render(paths[0]); await pointer(button("operations"), "pointerover"); await pointer(button(`group:${id}`), "pointerover");
    expect(leaves(3)).toEqual(paths); expect(panel(3)?.dataset.submenuSide).toBe("right"); expect(active()).toEqual(["operations"]);
    const original = items.find(i => i.path === paths[0])!; await click(paths[0]); expect(onNavigate.mock.calls).toEqual([[original]]); expect(panel()).toBeNull();
  });
  it("在管理和运营之间切换只保留一个菜单，并清除旧三级", async () => {
    await render(); await click("operations"); await click("group:transactions-services"); expect(panel(3)).not.toBeNull();
    await click("inventory-management"); expect(panel(3)).toBeNull(); expect(leaves()).toEqual(management["inventory-management"]);
    await click("procurement-management"); expect(leaves()).toEqual(management["procurement-management"]); expect(host.querySelectorAll('[data-workspace-dropdown="layer"]')).toHaveLength(1);
  });
  it("桌面跨菜单短间隙不闪退，真正移出180ms才关闭", async () => {
    vi.useFakeTimers(); await render(); await pointer(button("operations"), "pointerover"); await pointer(button("operations"), "pointerout", "mouse", document.body);
    await act(async () => vi.advanceTimersByTime(179)); expect(panel()).not.toBeNull(); await pointer(panel()!, "pointerover"); await act(async () => vi.advanceTimersByTime(200)); expect(panel()).not.toBeNull();
    await pointer(button("group:transactions-services"), "pointerover"); await pointer(panel()!, "pointerout", "mouse", panel(3)); await act(async () => vi.advanceTimersByTime(200)); expect(panel(3)).not.toBeNull();
    await pointer(panel(3)!, "pointerout", "mouse", document.body); await act(async () => vi.advanceTimersByTime(180)); expect(panel()).toBeNull(); expect(panel(3)).toBeNull();
  });
  it.each(["touch", "pen"])("%s不启用桌面悬停，原点击路径可达", async type => {
    await render(); await pointer(button("inventory-management"), "pointerover", type); expect(panel()).toBeNull(); await click("inventory-management"); await click("/workbench/inbound"); expect(onNavigate).toHaveBeenCalledOnce();
  });
  it.each(["outside", "Escape", "leaf"])("%s同步关闭所有层，取消迟到计时器", async action => {
    vi.useFakeTimers(); await render(); await pointer(button("operations"), "pointerover"); await pointer(button("group:transactions-services"), "pointerover"); await pointer(panel(3)!, "pointerout", "mouse", document.body);
    if (action === "outside") await act(async () => document.body.click()); else if (action === "Escape") await key("/messages", "Escape"); else await click("/messages");
    expect(panel()).toBeNull(); await click("inventory-management"); await act(async () => vi.advanceTimersByTime(300)); expect(leaves()).toEqual(management["inventory-management"]);
  });
  it.each(["URL", "items"])("%s变化立即关闭原层，迟到任务不能重新打开", async kind => {
    vi.useFakeTimers(); await render(); await pointer(button("operations"), "pointerover"); await pointer(button("operations"), "pointerout", "mouse", document.body);
    await render(kind === "URL" ? "/workbench/orders?merchantId=32" : undefined, kind === "items" ? { items: [...items] } : {}); expect(panel()).toBeNull();
    await click("inventory-management"); await act(async () => vi.advanceTimersByTime(300)); expect(panel()?.dataset.workspace).toBe("inventory-management");
  });
  it("管理一级键盘直达二级，上下循环、Home/End、Esc回父，Tab无陷阱", async () => {
    await render(); await key("inventory-management", "ArrowDown"); expect(document.activeElement).toBe(button("/workbench/inbound"));
    await key("/workbench/inbound", "ArrowDown"); expect(document.activeElement).toBe(button("/workbench/outbound")); await key("/workbench/outbound", "ArrowDown"); expect(document.activeElement).toBe(button("/workbench/inbound"));
    await key("/workbench/inbound", "End"); expect(document.activeElement).toBe(button("/workbench/outbound")); expect((await key("/workbench/outbound", "Tab")).defaultPrevented).toBe(false);
    await key("/workbench/outbound", "Escape"); expect(panel()).toBeNull(); expect(document.activeElement).toBe(button("inventory-management")); await key("procurement-management", "ArrowUp"); expect(document.activeElement).toBe(button("/workbench/procurement-orders"));
  });
  it("运营原三级键盘进入、返回、Escape及移动返回不变", async () => {
    await render("/messages"); await key("operations", "ArrowDown"); expect(document.activeElement).toBe(button("group:basic-data")); await key("group:basic-data", "ArrowDown"); await key("group:transactions-services", "ArrowRight"); expect(document.activeElement).toBe(button("/orders"));
    await key("/orders", "End"); expect(document.activeElement).toBe(button("/reviews")); await key("/reviews", "ArrowLeft"); expect(document.activeElement).toBe(button("group:transactions-services")); await key("group:transactions-services", "Escape"); expect(document.activeElement).toBe(button("operations"));
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true }); await click("operations"); await click("group:data-monitoring"); expect(panel()?.hidden).toBe(true); expect(panel(3)).not.toBeNull();
    await act(async () => panel(3)!.querySelector<HTMLButtonElement>('[data-workspace-dropdown="back"]')!.click()); expect(panel(3)).toBeNull(); expect(panel()?.hidden).toBe(false); expect(document.activeElement).toBe(button("group:data-monitoring"));
  });
  it.each(["inventory-management", "procurement-management"])("窄屏%s无需三级，所有叶子可达且滚动不关抽屉", async id => {
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true }); await render(); await pointer(button(id), "pointerover"); expect(panel()).toBeNull(); await click(id); expect(host.querySelector('[data-drawer="true"]')).not.toBeNull(); expect(panel(3)).toBeNull();
    await act(async () => host.querySelector("nav")!.dispatchEvent(new Event("scroll", { bubbles: true }))); expect(panel()).not.toBeNull();
    await act(async () => panel()!.querySelector<HTMLButtonElement>('[data-workspace-dropdown="close"]')!.click()); expect(panel()).toBeNull(); expect(document.activeElement).toBe(button(id));
  });
  it("撤回原叶子权限不制造入口、fallback或旧消息徽标", async () => {
    await render("/messages", { items: subset(["/messages", "/workbench/inbound"]) }); await click("operations"); await click("group:transactions-services");
    await render("/messages", { items: subset(["/workbench/inbound"]) }); expect(panel()).toBeNull(); expect(host.querySelector('[data-workspace-nav-target="operations"]')).toBeNull(); expect(active()).toEqual([]);
    await click("inventory-management"); expect(leaves()).toEqual(["/workbench/inbound"]); expect(host.querySelector('[data-workspace-nav-target="/workbench/outbound"]')).toBeNull();
    await render("/workbench/company", { items: subset(["/workbench/company-info"]) }); expect(host.querySelector("nav")).toBeNull();
  });
  it("未知URL无active，打开菜单不替代真实路由", async () => { await render("/unknown"); for (const id of ["inventory-management", "procurement-management", "operations", "organization"]) { await click(id); expect(active()).toEqual([]); } expect(onNavigate).not.toHaveBeenCalled(); });
  it("外部焦点和resize关闭，菜单自身滚动保留", async () => {
    await render(); await click("inventory-management"); await act(async () => panel()!.dispatchEvent(new Event("scroll"))); expect(panel()).not.toBeNull(); await act(async () => window.dispatchEvent(new Event("resize"))); expect(panel()).toBeNull();
    await click("operations"); const external = document.createElement("button"); document.body.append(external); await act(async () => external.focus()); expect(panel()).toBeNull(); expect(document.activeElement).toBe(external); external.remove();
  });
  it("unmount取消未到期悬停任务", async () => { vi.useFakeTimers(); await render(); await pointer(button("operations"), "pointerover"); await pointer(button("operations"), "pointerout", "mouse", document.body); expect(vi.getTimerCount()).toBeGreaterThan(0); await act(async () => root.render(null)); expect(vi.getTimerCount()).toBe(0); });
});
