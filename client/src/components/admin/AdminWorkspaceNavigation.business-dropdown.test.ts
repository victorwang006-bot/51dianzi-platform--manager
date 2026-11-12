// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { AdminWorkspaceTabs, ADMIN_SYSTEM_RELEASE, type AdminModuleTabsProps } from "./AdminWorkspaceNavigation";
import { ADMIN_WORKBENCH_NAVIGATION_GROUPS, getAdminWorkbenchNavigationRoute } from "./adminWorkbenchNavigationModel";
const items = ADMIN_WORKBENCH_NAVIGATION_GROUPS.flatMap(group => group.paths).map(path => Object.freeze({
  path, label: getAdminWorkbenchNavigationRoute(path)?.label ?? path,
  permission: `permission:${path}`, chunk: `chunk:${path}`,
  merchantContext: Object.freeze({ merchantId: 31, returnTo: "/orders" }),
}));
type Item = typeof items[number];
const groups = [
  ["customers", "/workbench/inquiries"], ["customers", "/workbench/orders"],
  ["inventory", "/workbench/inbound"], ["inventory", "/workbench/outbound"],
  ["procurement", "/workbench/procurement-demands"], ["procurement", "/workbench/procurement-orders"],
] as const;
let host: HTMLDivElement, root: Root;
const onNavigate = vi.fn(), onPreload = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(window, "innerWidth", { value: 1280, writable: true, configurable: true });
  onNavigate.mockReset(); onPreload.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(location = "/workbench/orders?merchantId=31", overrides: Partial<AdminModuleTabsProps<Item>> = {}) {
  await act(async () => root.render(createElement(AdminWorkspaceTabs<Item>, { items, location, onNavigate, onPreload, ...overrides })));
}
function button(target: string) {
  const b = host.querySelector<HTMLButtonElement>(`button[data-workspace-nav-target="${target}"]`);
  if (!b) throw new Error(`Missing ${target}`); return b;
}
async function click(target: string) { await act(async () => button(target).click()); }
async function key(target: string, key: string) { await act(async () => button(target).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))); }
function panel(level = 2) { return host.querySelector<HTMLDivElement>(`[data-workspace-dropdown="panel"][data-navigation-level="${level}"]`); }
function subset(paths: string[]) { return items.filter(item => paths.includes(item.path)); }

describe("业务分级下拉回归：已批准替代上一轮平铺方案", () => {
  it("桌面业务悬停自动打开，点击确认不闪退，重复点击收起且route不变化", async () => {
    await render();
    const hover = new MouseEvent("pointerover", { bubbles: true });
    Object.defineProperty(hover, "pointerType", { value: "mouse" });
    await act(async () => button("business").dispatchEvent(hover));
    expect(panel()).not.toBeNull(); expect(onPreload).toHaveBeenCalledWith(items.find(item => item.path === "/workbench/orders"));
    await click("business"); expect(panel()).not.toBeNull();
    expect(onNavigate).not.toHaveBeenCalled(); await click("business"); expect(panel()).toBeNull();
  });
  it("二级仅三分组，点击后只出现所属三级，无重复渠道或公司信息", async () => {
    await render(); await click("business");
    expect(Array.from(panel()!.querySelectorAll<HTMLButtonElement>("[data-navigation-choice]")).map(b => b.dataset.workspaceNavTarget))
      .toEqual(["group:customers", "group:inventory", "group:procurement"]);
    expect(panel(3)).toBeNull(); expect(panel()!.textContent).not.toContain("渠道库存");
    await click("group:customers"); expect(panel(3)!.querySelectorAll("[data-workspace-dropdown-item]")).toHaveLength(2);
    await click("group:inventory"); expect(host.querySelector('[data-business-submenu="customers"]')).toBeNull();
    expect(panel(3)!.querySelectorAll("[data-workspace-dropdown-item]")).toHaveLength(2);
  });
  it.each(groups)("%s → %s 只回传原授权对象一次且保留预加载", async (group, path) => {
    await render(); await click("business"); await click(`group:${group}`);
    const original = items.find(item => item.path === path)!;
    await act(async () => button(path).focus()); expect(onPreload).toHaveBeenCalledWith(original);
    await click(path); expect(onNavigate).toHaveBeenCalledTimes(1); expect(onNavigate).toHaveBeenCalledWith(original);
    expect(onNavigate.mock.calls[0][0]).toBe(original); expect(panel()).toBeNull(); expect(panel(3)).toBeNull();
  });
  it("公司信息不再生成菜单，原条目仍由父菜单授权而非本组件改权", async () => {
    await render(); await click("business");
    expect(host.querySelector('[data-workspace-nav-target="/workbench/company-info"]')).toBeNull();
    expect(panel()!.textContent).not.toContain("公司信息"); expect(onNavigate).not.toHaveBeenCalled();
  });
  it("选项同步隐藏旧layer和expanded后才调用父导航", async () => {
    let hidden = false;
    await render(undefined, { onNavigate: () => { hidden = host.querySelector<HTMLDivElement>('[data-workspace-dropdown="layer"]')!.hidden && button("business").getAttribute("aria-expanded") === "false"; } });
    await click("business"); await click("group:customers"); await click("/workbench/orders"); expect(hidden).toBe(true);
  });
  it("空分组隐藏，授权交集不创建fallback；渠道仅保留独立顶栏", async () => {
    await render("/workbench/orders", { items: subset(["/workbench/channel-inventory", "/workbench/company-info", "/analytics"]) });
    expect(host.querySelector('[data-workspace-nav-target="business"]')).toBeNull();
    await click("operations"); expect(host.querySelectorAll("[data-business-group]")).toHaveLength(0);
    expect(panel()!.textContent).not.toContain("公司信息"); expect(panel()!.textContent).not.toContain("渠道库存");
    expect(host.querySelector("[aria-current=page]")).toBeNull();
  });
  it("只有渠道权限时不制造空业务工作台", async () => {
    await render("/workbench/channel-inventory", { items: subset(["/workbench/channel-inventory"]) });
    expect(host.querySelector('[data-workspace-nav-target="business"]')).toBeNull();
    expect(button("inventory").getAttribute("aria-current")).toBe("page");
    expect(host.querySelector('[data-workspace-nav-target="channel"]')).toBeNull();
    expect(host.querySelectorAll('[data-channel-view]')).toHaveLength(1);
  });
  it("ops页能展开business但只按真实route高亮ops", async () => {
    await render("/materials"); await click("business"); expect(button("operations").getAttribute("aria-current")).toBe("location");
    expect(button("business").hasAttribute("aria-current")).toBe(false); expect(host.querySelector("[data-navigation-level='3']")).toBeNull();
  });
  it("renderItem、badge和preload别名仍收到canonical原条目", async () => {
    const intent = vi.fn();
    await render("/workbench/sales-orders?merchantId=31", { onPreload: undefined, onItemIntent: intent,
      renderItem: (item, state) => createElement("span", { "data-render-active": String(state.isActive) }, item.label),
      renderBadge: () => createElement("span", { "data-badge": "yes" }, "2") });
    await click("business"); await click("group:customers");
    expect(button("/workbench/orders").getAttribute("aria-current")).toBe("page");
    expect(button("/workbench/orders").querySelector('[data-render-active="true"]')).not.toBeNull();
    expect(button("/workbench/orders").querySelector("[data-badge]")).not.toBeNull();
    await act(async () => button("/workbench/orders").focus()); expect(intent).toHaveBeenCalledWith(items.find(item => item.path === "/workbench/orders"));
  });
  it("移动抽屉逐级进入，可返回原组并关闭恢复顶栏焦点", async () => {
    window.innerWidth = 390; await render(); await click("business"); await click("group:inventory");
    expect(host.querySelector('[data-drawer="true"]')).not.toBeNull(); expect(panel()!.hidden).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-workspace-dropdown="back"]')!.click());
    expect(panel(3)).toBeNull(); expect(document.activeElement).toBe(button("group:inventory"));
    await key("group:inventory", "Escape"); expect(panel()).toBeNull(); expect(document.activeElement).toBe(button("business"));
  });

  it("document bubbling keeps an internal click open even when its original target was removed", async () => {
    await render(); await click("business"); await click("group:customers");
    const nav = host.querySelector("nav")!;
    const removed = document.createElement("button");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: removed });
    Object.defineProperty(event, "composedPath", { value: () => [removed, nav, document] });
    await act(async () => document.dispatchEvent(event));
    expect(panel()).not.toBeNull(); expect(panel(3)).not.toBeNull();
    await act(async () => document.body.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(panel()).toBeNull(); expect(onNavigate).not.toHaveBeenCalled();
  });

  it("mobile top-strip focus scrolling preserves the open drawer and selected third level", async () => {
    window.innerWidth = 390; await render(); await click("business"); await click("group:inventory");
    await act(async () => host.querySelector("nav")!.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(panel()).not.toBeNull(); expect(panel(3)).not.toBeNull();
    expect(host.querySelector('[data-business-submenu="inventory"]')).not.toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it.each(["/workbench/orders?merchantId=32", "/workbench/inventory", "/materials#detail"])("location/query/hash %s变化立即关闭，返回不迟到重开", async location => {
    await render(); await click("business"); await click("group:customers"); await render(location); expect(panel()).toBeNull();
    await render(); expect(panel()).toBeNull();
  });
  it("items引用和授权改变立即关闭，旧快照不会再次显示", async () => {
    await render(); await click("business"); await click("group:customers"); await render(undefined, { items: [...items] }); expect(panel()).toBeNull();
    await render(); expect(panel()).toBeNull();
  });
  it("键盘Enter进入二级、右键进入三级、左键返回、Escape关闭", async () => {
    await render(); await key("business", "Enter"); expect(document.activeElement).toBe(button("group:customers"));
    await key("group:customers", "ArrowRight"); expect(document.activeElement).toBe(button("/workbench/inquiries"));
    await key("/workbench/inquiries", "ArrowLeft"); expect(panel(3)).toBeNull(); expect(document.activeElement).toBe(button("group:customers"));
    await key("group:customers", "Escape"); expect(panel()).toBeNull(); expect(document.activeElement).toBe(button("business"));
  });
  it("面板内部滚动不关，窗口resize关闭；Tab不设置键盘陷阱", async () => {
    await render(); await click("business");
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }); await act(async () => panel()!.dispatchEvent(tab)); expect(tab.defaultPrevented).toBe(false);
    await act(async () => panel()!.dispatchEvent(new Event("scroll", { bubbles: true }))); expect(panel()).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event("resize"))); expect(panel()).toBeNull();
  });
  it("保留历史发布标记和旧CSS前缀，仅新增根标记限定样式", () => {
    const css = readFileSync(`${process.cwd()}/client/src/components/admin/AdminWorkspaceNavigation.css`, "utf8");
    expect(ADMIN_SYSTEM_RELEASE).toBe("20261103-channel-permission-owner-v13-a2");
    expect(css).toContain('Business primary dropdown only.'); expect(css).toContain('data-admin-navigation="unified-dropdown"');
    expect(css).not.toMatch(/(?:^|\n)\s*(?:html|body|:root|\*)\s*[{,]/);
  });
});
